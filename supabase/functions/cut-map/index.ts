// ============================================================
// CUT-MAP™ — Cut Contour LOGO PACK Generator
//
// Real, RIP-compatible PACK of cut paths — one per element.
//
// Pipeline (per upload):
//   1. Gemini Vision detects discrete elements (logos, text, phone,
//      URLs, graphics) with bounding boxes.
//   2. Per element:
//        a. Crop the source image to the bounding box.
//        b. Replicate BiRefNet on the crop → clean alpha matte.
//        c. Binary mask → dilation (offset) → connected components.
//        d. Moore-neighbor boundary trace + RDP simplification.
//        e. Build an SVG with magenta CutContour (#FF00FF) spot color
//           layered over the bg-removed art.
//   3. Bundle every element SVG + bg-removed PNG into a ZIP plus a
//      combined preview SVG (bbox index over the source) and a
//      manifest.json describing the pack.
//
// Modes: contour | kiss_cut | perf_cut | through (stroke style only)
//
// Revenue: Standalone service. 3 tokens per file.
// Deploy: supabase functions deploy cut-map
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'
import JSZip from 'https://esm.sh/jszip@3.10.1'
import { replicateBgRemove } from '../_shared/replicate-bg-remove.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const BUCKET = 'wrap-files'
const MAX_TRACE_PIXELS = 2_500_000
const MAX_INPUT_BYTES = 15 * 1024 * 1024
const MAX_PARALLEL_BIREFNET = 4

interface DetectedElement {
  id: number
  type: string                                              // logo|text|phone|url|graphic
  label: string
  content: string | null
  bbox: { x: number; y: number; w: number; h: number }      // PIXELS in original image
  confidence: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const body = await req.json()
    const {
      user_id,
      file_url,
      file_name,
      cut_mode = 'contour',
      offset_inches = 0.0625,
      bleed_inches = 0.125,
      order_number,
      // 'single' = legacy single-subject SVG (backwards-compatible — used by
      // GraphicsPro). 'pack' = new Gemini-detected per-element ZIP. Default to
      // 'single' so any existing caller keeps the old response shape; the new
      // Cut Contour Logo Pack button explicitly opts in via mode: 'pack'.
      mode = 'single',
    } = body

    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    console.log(`[CUT-MAP/PACK] ${file_name || 'file'} | mode=${cut_mode}`)

    // ── 1. Fetch source bytes ────────────────────────────────────
    // Contour tracing is resolution-independent (the traced path is scaled to
    // the output dims), so pull Supabase Storage sources through the image
    // transform at 2000px: a raw post-ESRGAN 8K-class artwork decodes to
    // hundreds of MB RGBA and kills the worker (WORKER_RESOURCE_LIMIT — the
    // GraphicsPro run_production stage 2 failure). Raw URL is the fallback for
    // non-storage sources / transform hiccups.
    const cutSrcUrl = String(file_url).includes('/storage/v1/object/')
      ? String(file_url).replace('/storage/v1/object/', '/storage/v1/render/image/') + (String(file_url).includes('?') ? '&' : '?') + 'width=2000&height=2000&resize=contain&format=origin'
      : file_url
    let srcResp = await fetch(cutSrcUrl, { headers: { 'User-Agent': 'Deno/CutMap' } })
    if (!srcResp.ok && cutSrcUrl !== file_url) srcResp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/CutMap' } })
    if (!srcResp.ok) return fail(`Cannot fetch source: ${srcResp.status}`)
    const srcBytes = new Uint8Array(await srcResp.arrayBuffer())

    if (srcBytes.length > MAX_INPUT_BYTES) {
      const mb = (srcBytes.length / 1024 / 1024).toFixed(1)
      return fail(`File is ${mb} MB which is too large. Save under 15 MB and try again.`)
    }
    if (isTiff(srcBytes)) {
      return fail('TIFF too memory-heavy. Save as PNG or JPG and try again.')
    }

    let sourceImg: Image
    try {
      sourceImg = await Image.decode(srcBytes)
    } catch (_e) {
      return fail(`Could not decode "${file_name || 'file'}". Save as PNG or JPG and try again.`)
    }
    const W = sourceImg.width
    const H = sourceImg.height
    const sourcePngBytes = await sourceImg.encode()
    const sourceB64 = encodeBase64(sourcePngBytes)

    // ── Single-subject mode (legacy backwards-compatible path) ─────
    // GraphicsPro and any historical caller hits this branch and gets
    // back the old shape: { svg_url, output_url=combinedSvg, art_url, ... }.
    if (mode !== 'pack') {
      const userId = user_id || 'anonymous'
      const ts = Date.now()
      const single = await processElement(
        { id: 1, type: 'graphic', label: 'subject', content: null,
          bbox: { x: 0, y: 0, w: W, h: H }, confidence: 1 },
        sourceImg, supabase, userId, ts,
        `file-services/${userId}/${ts}/cut-single`,
        cut_mode, offset_inches,
      )
      if (single.error || single.subpaths === 0) {
        return fail(`Single-subject cut failed: ${single.error || 'no usable paths'}`)
      }

      const basePath = order_number
        ? `production-packs/${userId}/${order_number}`
        : `file-services/${userId}/${ts}`
      const fileSuffix = order_number ? `-${ts}` : ''

      // 6a. bg-removed art PNG
      const artPath = `${basePath}/cut-art${fileSuffix}.png`
      await supabase.storage.from(BUCKET).upload(artPath, single.cropPng, {
        contentType: 'image/png', upsert: true,
      })
      const { data: artUrl } = supabase.storage.from(BUCKET).getPublicUrl(artPath)

      // 6b. path-only SVG (GraphicsPro plotter input)
      const pathSvgPath = `${basePath}/cut-path${fileSuffix}.svg`
      await supabase.storage.from(BUCKET).upload(
        pathSvgPath, new TextEncoder().encode(single.cutPathSvg),
        { contentType: 'image/svg+xml', upsert: true },
      )
      const { data: pathUrl } = supabase.storage.from(BUCKET).getPublicUrl(pathSvgPath)

      // 6c. combined SVG (Illustrator-ready overlay)
      const combinedPath = `${basePath}/cut-contour-pack${fileSuffix}.svg`
      await supabase.storage.from(BUCKET).upload(
        combinedPath, new TextEncoder().encode(single.svg),
        { contentType: 'image/svg+xml', upsert: true },
      )
      const { data: combinedUrl } = supabase.storage.from(BUCKET).getPublicUrl(combinedPath)

      const processingMs = Date.now() - startMs
      console.log(`[CUT-MAP/SINGLE] Done in ${processingMs}ms — ${single.subpaths} subpaths`)
      return ok({
        output_url: combinedUrl?.publicUrl || '',
        file_url: combinedUrl?.publicUrl || '',
        storage_path: combinedPath,
        art_url: artUrl?.publicUrl || '',
        art_storage_path: artPath,
        svg_url: pathUrl?.publicUrl || '',
        svg_storage_path: pathSvgPath,
        cut_mode,
        contour_subpaths: single.subpaths,
        contour_points: single.points,
        offset_inches,
        bleed_inches,
        image_dimensions: { width: single.width, height: single.height },
        bg_removal_method: 'replicate-birefnet',
        processing_ms: processingMs,
        rip_compatible: ['VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi', 'EFI Fiery'],
        spot_color: 'CutContour (Magenta #FF00FF)',
        step: 'cut_map',
        metrics: {
          subpaths: single.subpaths,
          contour_points: single.points,
          offset_px: single.offsetPx,
          processing_ms: processingMs,
        },
      })
    }

    // ── 2. PACK MODE: Gemini detects discrete elements ───────────
    const elementsPercent = await detectElements(sourceB64, file_name || 'artwork')
    console.log(`[CUT-MAP/PACK] Gemini detected ${elementsPercent.length} element(s)`)

    // Convert percent bboxes → pixel bboxes against the source dimensions.
    const elementsPx: DetectedElement[] = elementsPercent.map((el, idx) => ({
      id: idx + 1,
      type: el.type,
      label: el.label,
      content: el.content,
      confidence: el.confidence,
      bbox: {
        x: Math.max(0, Math.min(W - 1, Math.round(el.bbox.x * W))),
        y: Math.max(0, Math.min(H - 1, Math.round(el.bbox.y * H))),
        w: Math.max(1, Math.min(W, Math.round(el.bbox.w * W))),
        h: Math.max(1, Math.min(H, Math.round(el.bbox.h * H))),
      },
    }))

    const useFallback = elementsPx.length === 0
    const workItems: DetectedElement[] = useFallback
      ? [{ id: 1, type: 'graphic', label: 'Full artwork', content: null,
           bbox: { x: 0, y: 0, w: W, h: H }, confidence: 0 }]
      : elementsPx

    // ── 3. Per-element pipeline ──────────────────────────────────
    const userId = user_id || 'anonymous'
    const ts = Date.now()
    const tempBase = `file-services/${userId}/${ts}/cut-pack-elements`

    const results: Array<{
      el: DetectedElement
      cropPng: Uint8Array
      width: number
      height: number
      offsetPx: number
      svg: string
      cutPathSvg: string
      subpaths: number
      points: number
      error?: string
    }> = []

    for (let i = 0; i < workItems.length; i += MAX_PARALLEL_BIREFNET) {
      const batch = workItems.slice(i, i + MAX_PARALLEL_BIREFNET)
      const batchResults = await Promise.all(batch.map(el =>
        processElement(el, sourceImg, supabase, userId, ts, tempBase, cut_mode, offset_inches)
      ))
      results.push(...batchResults)
    }

    const successful = results.filter(r => !r.error && r.subpaths > 0)
    if (successful.length === 0) {
      const sample = results.slice(0, 3).map(r => `${r.el.label}: ${r.error || 'no paths'}`).join(' | ')
      return fail(`No elements could be cut-traced (${sample}). Try a higher-contrast image or a single logo.`)
    }
    console.log(`[CUT-MAP/PACK] ${successful.length}/${workItems.length} elements traced`)

    // ── 4. Build the ZIP ─────────────────────────────────────────
    const zip = new JSZip()
    const svgFolder = zip.folder('svg')!
    const pngFolder = zip.folder('png')!
    const cutPathFolder = zip.folder('cut-paths-only')!

    for (const r of successful) {
      const safe = sanitizeName(`${String(r.el.id).padStart(2, '0')}_${r.el.label || r.el.type}`)
      svgFolder.file(`${safe}.svg`, r.svg)
      pngFolder.file(`${safe}.png`, r.cropPng)
      cutPathFolder.file(`${safe}-cut-path.svg`, r.cutPathSvg)
    }

    const combinedSvg = buildCombinedPackSvg(sourcePngBytes, W, H, successful, cut_mode)
    zip.file('cut-contour-pack.svg', combinedSvg)

    const manifest = {
      generated_at: new Date().toISOString(),
      source_file: file_name || 'artwork',
      source_dimensions: { width: W, height: H },
      cut_mode,
      offset_inches,
      bleed_inches,
      spot_color: 'CutContour (Magenta #FF00FF)',
      rip_compatible: ['VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi', 'EFI Fiery'],
      detection_mode: useFallback ? 'fallback_single_subject' : 'gemini_multi_element',
      elements: successful.map(r => ({
        id: r.el.id,
        type: r.el.type,
        label: r.el.label,
        content: r.el.content,
        bbox_pixels: r.el.bbox,
        confidence: r.el.confidence,
        subpaths: r.subpaths,
        points: r.points,
        offset_px: r.offsetPx,
      })),
    }
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))

    const zipBytes = await zip.generateAsync({ type: 'uint8array' })

    // ── 5. Save ZIP + preview SVG ───────────────────────────────
    const basePath = order_number
      ? `production-packs/${userId}/${order_number}`
      : `file-services/${userId}/${ts}`
    const fileSuffix = order_number ? `-${ts}` : ''

    const zipPath = `${basePath}/cut-contour-logo-pack${fileSuffix}.zip`
    await supabase.storage.from(BUCKET).upload(zipPath, zipBytes, {
      contentType: 'application/zip', upsert: true,
    })
    const { data: zipUrl } = supabase.storage.from(BUCKET).getPublicUrl(zipPath)

    const previewSvgPath = `${basePath}/cut-contour-pack-preview${fileSuffix}.svg`
    await supabase.storage.from(BUCKET).upload(
      previewSvgPath,
      new TextEncoder().encode(combinedSvg),
      { contentType: 'image/svg+xml', upsert: true },
    )
    const { data: previewUrl } = supabase.storage.from(BUCKET).getPublicUrl(previewSvgPath)

    const processingMs = Date.now() - startMs
    console.log(`[CUT-MAP/PACK] Done in ${processingMs}ms — ${successful.length} elements`)

    return ok({
      output_url: zipUrl?.publicUrl || '',
      file_url: zipUrl?.publicUrl || '',
      storage_path: zipPath,
      preview_url: previewUrl?.publicUrl || '',
      preview_storage_path: previewSvgPath,
      cut_mode,
      elements_count: successful.length,
      elements_attempted: workItems.length,
      detection_mode: useFallback ? 'fallback_single_subject' : 'gemini_multi_element',
      elements: successful.map(r => ({
        id: r.el.id, type: r.el.type, label: r.el.label,
        bbox: r.el.bbox, subpaths: r.subpaths, points: r.points,
      })),
      contour_subpaths: successful.reduce((s, r) => s + r.subpaths, 0),
      contour_points: successful.reduce((s, r) => s + r.points, 0),
      offset_inches,
      bleed_inches,
      image_dimensions: { width: W, height: H },
      processing_ms: processingMs,
      rip_compatible: ['VersaWorks', 'Onyx', 'Caldera', 'Flexi', 'SAi', 'EFI Fiery'],
      spot_color: 'CutContour (Magenta #FF00FF)',
      step: 'cut_map',
      metrics: {
        elements: successful.length,
        elements_attempted: workItems.length,
        total_subpaths: successful.reduce((s, r) => s + r.subpaths, 0),
        total_points: successful.reduce((s, r) => s + r.points, 0),
        processing_ms: processingMs,
      },
    })
  } catch (err) {
    console.error('[CUT-MAP/PACK] Error:', err)
    return new Response(
      JSON.stringify({ success: false, error: `CutMap pack failed: ${String(err)}`, step: 'cut_map' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

// ── Per-element processing ────────────────────────────────────────

async function processElement(
  el: DetectedElement,
  sourceImg: Image,
  supabase: any,
  _userId: string,
  _ts: number,
  tempBase: string,
  cutMode: string,
  offsetInches: number,
) {
  const empty = {
    el, cropPng: new Uint8Array(), width: 0, height: 0,
    offsetPx: 0, svg: '', cutPathSvg: '', subpaths: 0, points: 0,
  }
  try {
    const x = el.bbox.x, y = el.bbox.y, w = el.bbox.w, h = el.bbox.h
    const crop = sourceImg.clone().crop(x, y, w, h)
    const cropBytes = await crop.encode()

    const cropPath = `${tempBase}/elem-${el.id}.png`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(cropPath, cropBytes, { contentType: 'image/png', upsert: true })
    if (upErr) return { ...empty, error: `crop upload: ${upErr.message}` }

    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(cropPath, 600)
    if (signErr || !signed?.signedUrl) {
      await supabase.storage.from(BUCKET).remove([cropPath])
      return { ...empty, error: `signed url: ${signErr?.message || 'no url'}` }
    }

    const bg = await replicateBgRemove(signed.signedUrl)
    await supabase.storage.from(BUCKET).remove([cropPath])
    if (!bg.removed || bg.imageBytes.length === 0) {
      return { ...empty, error: bg.error || 'bg removal returned no bytes' }
    }

    const cutout = await Image.decode(bg.imageBytes)
    const oW = cutout.width
    const oH = cutout.height

    let traceImg = cutout
    let scaleFactor = 1
    if (oW * oH > MAX_TRACE_PIXELS) {
      scaleFactor = Math.sqrt(MAX_TRACE_PIXELS / (oW * oH))
      const tw = Math.max(1, Math.floor(oW * scaleFactor))
      const th = Math.max(1, Math.floor(oH * scaleFactor))
      traceImg = cutout.clone().resize(tw, th)
    }
    const tW = traceImg.width
    const tH = traceImg.height

    const mask = new Uint8Array(tW * tH)
    let fg = 0
    for (let yy = 0; yy < tH; yy++) {
      for (let xx = 0; xx < tW; xx++) {
        const px = traceImg.getPixelAt(xx + 1, yy + 1)
        const a = px & 0xFF
        if (a > 32) { mask[yy * tW + xx] = 1; fg++ }
      }
    }
    if (fg === 0) return { ...empty, error: 'no foreground after bg removal' }

    const dpi = 150
    const offsetPxOrig = Math.max(0, Math.round(offsetInches * dpi))
    const offsetPxTrace = Math.max(0, Math.round(offsetPxOrig * scaleFactor))
    const dilated = offsetPxTrace > 0 ? dilateBinary(mask, tW, tH, offsetPxTrace) : mask

    const components = findComponents(dilated, tW, tH)
    const minArea = Math.max(64, Math.floor(tW * tH * 0.0005))
    const significant = components.filter(c => c.area >= minArea)
    if (significant.length === 0) return { ...empty, error: 'no significant shapes' }

    const epsilon = Math.max(0.6, 0.0008 * Math.max(oW, oH))
    const subpaths: string[] = []
    let totalPoints = 0
    for (const comp of significant) {
      const traced = traceBoundary(dilated, tW, tH, comp.startX, comp.startY)
      if (traced.length < 8) continue
      const scaled = traced.map(p => ({
        x: Math.round(p.x / scaleFactor),
        y: Math.round(p.y / scaleFactor),
      }))
      const simplified = rdpSimplify(scaled, epsilon)
      if (simplified.length < 3) continue
      let d = `M ${simplified[0].x} ${simplified[0].y}`
      for (let i = 1; i < simplified.length; i++) d += ` L ${simplified[i].x} ${simplified[i].y}`
      d += ' Z'
      subpaths.push(d)
      totalPoints += simplified.length
    }
    if (subpaths.length === 0) return { ...empty, error: 'trace produced no usable paths' }

    const strokeWidth = cutMode === 'kiss_cut' ? 0.5 : cutMode === 'through' ? 1.5 : 1
    const dashAttr = cutMode === 'perf_cut' ? ' stroke-dasharray="10 5"' : ''
    const svg = buildElementSvg(bg.imageBytes, subpaths, oW, oH, strokeWidth, dashAttr)
    const cutPathSvg = buildCutPathOnlySvg(subpaths, oW, oH, strokeWidth, dashAttr, cutMode, offsetPxOrig, el)

    return {
      el, cropPng: bg.imageBytes,
      width: oW, height: oH,
      offsetPx: offsetPxOrig,
      svg, cutPathSvg,
      subpaths: subpaths.length,
      points: totalPoints,
    }
  } catch (e) {
    return { ...empty, error: `processElement: ${String((e as Error)?.message || e)}` }
  }
}

// ── Gemini element detection ──────────────────────────────────────

async function detectElements(srcBase64: string, fileName: string): Promise<DetectedElement[]> {
  const gk = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!gk) {
    console.warn('[CUT-MAP/PACK] GOOGLE_AI_API_KEY missing — skipping detection')
    return []
  }

  const prompt = `You are a vehicle wrap production specialist. Analyze this artwork and identify ALL discrete elements that should be extracted as SEPARATE cut-ready cut-contour assets.

Find:
1. LOGOS — company logos, brand marks, emblems
2. TEXT — business names, taglines, slogans, license/legal info, addresses (group nearby words/lines that belong together visually)
3. PHONE NUMBERS — group all digits and separators of one phone number into ONE element
4. URLS — websites, social handles
5. GRAPHICS — standalone icons, mascots, swooshes, shape elements

Do NOT include:
- Background textures, gradients, color fields
- Photographs of real-world subjects (cars, buildings, people) unless they are clearly a logo asset
- Elements that span the entire canvas as a backdrop

Respond ONLY with valid JSON (no markdown):
{
  "elements": [
    {
      "type": "logo|text|phone|url|graphic",
      "label": "short human-readable name e.g. 'Galvin Logo'",
      "content": "actual text if readable, or null",
      "bounding_box": { "x_percent": 0.0, "y_percent": 0.0, "width_percent": 0.0, "height_percent": 0.0 },
      "confidence": 0.95
    }
  ]
}

Coordinates are 0-1 fractions of the image. File name: "${fileName}"`

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${gk}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inlineData: { mimeType: 'image/png', data: srcBase64 } },
            { text: prompt },
          ] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    )
    if (!resp.ok) {
      console.warn(`[CUT-MAP/PACK] Gemini ${resp.status}`)
      return []
    }
    const data = await resp.json()
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const clean = raw.replace(/```json\s*|```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    const list = Array.isArray(parsed?.elements) ? parsed.elements : []
    return list.slice(0, 30).map((el: any, idx: number) => {
      const bb = el.bounding_box || {}
      return {
        id: idx + 1,
        type: String(el.type || 'graphic'),
        label: String(el.label || `Element ${idx + 1}`).slice(0, 60),
        content: el.content ?? null,
        bbox: {
          x: clamp01(bb.x_percent),
          y: clamp01(bb.y_percent),
          w: clamp01(bb.width_percent),
          h: clamp01(bb.height_percent),
        },
        confidence: Number(el.confidence) || 0.5,
      } as DetectedElement
    }).filter((el: DetectedElement) => el.bbox.w > 0.01 && el.bbox.h > 0.01)
  } catch (e) {
    console.warn('[CUT-MAP/PACK] Gemini detect failed:', e)
    return []
  }
}

function clamp01(n: any) {
  const v = Number(n)
  if (!isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

// ── Image processing primitives ───────────────────────────────────

function dilateBinary(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src
  const tmp = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w - 1, x + r)
      let v = 0
      for (let xi = x0; xi <= x1; xi++) {
        if (src[row + xi]) { v = 1; break }
      }
      tmp[row + x] = v
    }
  }
  const out = new Uint8Array(w * h)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r)
      const y1 = Math.min(h - 1, y + r)
      let v = 0
      for (let yi = y0; yi <= y1; yi++) {
        if (tmp[yi * w + x]) { v = 1; break }
      }
      out[y * w + x] = v
    }
  }
  return out
}

function findComponents(mask: Uint8Array, w: number, h: number) {
  const visited = new Uint8Array(w * h)
  const components: Array<{ area: number; startX: number; startY: number }> = []
  const stack: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (!mask[idx] || visited[idx]) continue
      let area = 0
      stack.length = 0
      stack.push(idx)
      while (stack.length) {
        const i = stack.pop()!
        if (visited[i] || !mask[i]) continue
        visited[i] = 1
        area++
        const cx = i % w
        const cy = (i - cx) / w
        if (cx > 0)     stack.push(i - 1)
        if (cx < w - 1) stack.push(i + 1)
        if (cy > 0)     stack.push(i - w)
        if (cy < h - 1) stack.push(i + w)
      }
      components.push({ area, startX: x, startY: y })
    }
  }
  return components
}

function traceBoundary(mask: Uint8Array, w: number, h: number, startX: number, startY: number) {
  const dx = [-1, -1,  0,  1, 1, 1, 0, -1]
  const dy = [ 0, -1, -1, -1, 0, 1, 1,  1]
  const isFg = (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < h && mask[y * w + x] === 1
  const boundary: Array<{ x: number; y: number }> = [{ x: startX, y: startY }]
  let cx = startX, cy = startY
  let backtrack = 0
  const maxSteps = w * h * 4
  let steps = 0
  let firstMove: { x: number; y: number } | null = null
  while (steps++ < maxSteps) {
    let foundDir = -1
    for (let i = 1; i <= 8; i++) {
      const dir = (backtrack + i) & 7
      const nx = cx + dx[dir]
      const ny = cy + dy[dir]
      if (isFg(nx, ny)) { foundDir = dir; break }
    }
    if (foundDir < 0) break
    cx = cx + dx[foundDir]
    cy = cy + dy[foundDir]
    boundary.push({ x: cx, y: cy })
    backtrack = (foundDir + 4) & 7
    if (!firstMove) firstMove = { x: cx, y: cy }
    if (cx === startX && cy === startY && boundary.length > 2 && firstMove) {
      let nextDir = -1
      for (let i = 1; i <= 8; i++) {
        const dir = (backtrack + i) & 7
        const nx = cx + dx[dir]
        const ny = cy + dy[dir]
        if (isFg(nx, ny)) { nextDir = dir; break }
      }
      if (nextDir >= 0) {
        const nx = cx + dx[nextDir]
        const ny = cy + dy[nextDir]
        if (nx === firstMove.x && ny === firstMove.y) break
      } else {
        break
      }
    }
  }
  return boundary
}

function rdpSimplify(points: Array<{ x: number; y: number }>, epsilon: number) {
  if (points.length < 3) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()!
    if (hi - lo < 2) continue
    const a = points[lo], b = points[hi]
    let maxDist = 0, maxIdx = -1
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistance(points[i], a, b)
      if (d > maxDist) { maxDist = d; maxIdx = i }
    }
    if (maxDist > epsilon && maxIdx > 0) {
      keep[maxIdx] = 1
      stack.push([lo, maxIdx])
      stack.push([maxIdx, hi])
    }
  }
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i])
  return out
}

function perpDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)
  const projX = a.x + t * dx, projY = a.y + t * dy
  return Math.hypot(p.x - projX, p.y - projY)
}

// ── SVG builders ──────────────────────────────────────────────────

function buildElementSvg(
  artBytes: Uint8Array, subpaths: string[],
  width: number, height: number, strokeWidth: number, dashAttr: string,
): string {
  const b64 = encodeBase64(artBytes)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <g id="Artwork">
    <image x="0" y="0" width="${width}" height="${height}" xlink:href="data:image/png;base64,${b64}" />
  </g>
  <g id="CutContour" fill="none" stroke="#FF00FF" stroke-width="${strokeWidth}"${dashAttr}>
${subpaths.map(d => `    <path d="${d}" />`).join('\n')}
  </g>
</svg>`
}

function buildCutPathOnlySvg(
  subpaths: string[], width: number, height: number,
  strokeWidth: number, dashAttr: string, mode: string, offsetPx: number,
  el: DetectedElement,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <!-- ${el.type}: ${el.label} -->
  <!-- mode=${mode} | offset=${offsetPx}px | subpaths=${subpaths.length} -->
  <g id="CutContour" fill="none" stroke="#FF00FF" stroke-width="${strokeWidth}"${dashAttr}>
${subpaths.map(d => `    <path d="${d}" />`).join('\n')}
  </g>
</svg>`
}

function buildCombinedPackSvg(
  sourcePngBytes: Uint8Array,
  W: number, H: number,
  successful: Array<{ el: DetectedElement }>,
  cutMode: string,
): string {
  const b64 = encodeBase64(sourcePngBytes)
  const strokeWidth = cutMode === 'kiss_cut' ? 0.5 : cutMode === 'through' ? 1.5 : 1
  const dashAttr = cutMode === 'perf_cut' ? ' stroke-dasharray="10 5"' : ''
  const boxes = successful.map(r => {
    const x = Math.round(r.el.bbox.x)
    const y = Math.round(r.el.bbox.y)
    const w = Math.round(r.el.bbox.w)
    const h = Math.round(r.el.bbox.h)
    const labelEsc = (r.el.label || `${r.el.type} ${r.el.id}`)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#FF00FF" stroke-width="${strokeWidth * 2}"${dashAttr} />
      <text x="${x + 6}" y="${y + 22}" font-family="sans-serif" font-size="20" fill="#FF00FF" stroke="#fff" stroke-width="0.6" paint-order="stroke">${r.el.id}. ${labelEsc}</text>
    </g>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <g id="Artwork">
    <image x="0" y="0" width="${W}" height="${H}" xlink:href="data:image/png;base64,${b64}" />
  </g>
  <g id="ElementBoxes">
${boxes}
  </g>
</svg>`
}

// ── Helpers ───────────────────────────────────────────────────────

function isTiff(b: Uint8Array): boolean {
  if (b.length < 4) return false
  if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A && b[3] === 0x00) return true
  if (b[0] === 0x4D && b[1] === 0x4D && b[2] === 0x00 && b[3] === 0x2A) return true
  return false
}

function sanitizeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 60) || 'element'
}

function ok(d: any) {
  return new Response(JSON.stringify({ success: true, ...d }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function fail(m: string) {
  return new Response(JSON.stringify({ success: false, error: m }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
