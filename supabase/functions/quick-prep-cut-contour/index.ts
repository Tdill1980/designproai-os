// ============================================================
// QUICK-PREP: Cut Contour (Offset Contour Path)
// Generates a real cut path from an already-bg-removed PNG.
//
// Used as a chained step inside prep packages where bg_remove ran
// first. The standalone tool is cut-map/index.ts (which runs bg
// removal up front).
//
// Pipeline: alpha mask → separable dilation (offset) →
// connected components → Moore-neighbor trace → RDP simplify → SVG.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const BUCKET = 'wrap-files'
const MAX_TRACE_PIXELS = 2_500_000

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    const { user_id, file_url, file_name, step_key, action_id, options, order_number } = await req.json()
    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    const offsetInches = (options?.offset_inches as number) ?? 0.0625
    console.log(`[CUT-CONTOUR] ${file_name || 'file'} | offset=${offsetInches}"`)

    const resp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/QuickPrep' } })
    if (!resp.ok) return fail(`Cannot fetch: ${resp.status}`)
    const bytes = new Uint8Array(await resp.arrayBuffer())

    const fullImg = await Image.decode(bytes)
    const origW = fullImg.width
    const origH = fullImg.height

    // Downscale for tracing if needed
    let traceImg = fullImg
    let scaleFactor = 1
    if (origW * origH > MAX_TRACE_PIXELS) {
      scaleFactor = Math.sqrt(MAX_TRACE_PIXELS / (origW * origH))
      const tw = Math.max(1, Math.floor(origW * scaleFactor))
      const th = Math.max(1, Math.floor(origH * scaleFactor))
      traceImg = fullImg.clone().resize(tw, th)
    }
    const w = traceImg.width
    const h = traceImg.height

    // Binary mask from alpha
    const mask = new Uint8Array(w * h)
    let fg = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = traceImg.getPixelAt(x + 1, y + 1)
        const a = px & 0xFF
        if (a > 32) { mask[y * w + x] = 1; fg++ }
      }
    }
    if (fg === 0) return fail('No foreground (alpha) — cut-contour requires a bg-removed input')

    // Offset dilation
    const dpi = 150
    const offsetPxOrig = Math.max(0, Math.round(offsetInches * dpi))
    const offsetPxTrace = Math.max(0, Math.round(offsetPxOrig * scaleFactor))
    const dilated = offsetPxTrace > 0 ? dilateBinary(mask, w, h, offsetPxTrace) : mask

    // Components → boundary trace → simplify
    const components = findComponents(dilated, w, h)
    const minArea = Math.max(64, Math.floor(w * h * 0.0005))
    const significant = components.filter(c => c.area >= minArea)
    if (significant.length === 0) return fail('No significant shapes found')

    const epsilon = Math.max(0.6, 0.0008 * Math.max(origW, origH))
    const subpaths: string[] = []
    let totalPoints = 0
    for (const comp of significant) {
      const traced = traceBoundary(dilated, w, h, comp.startX, comp.startY)
      if (traced.length < 8) continue
      const scaled = traced.map(p => ({ x: Math.round(p.x / scaleFactor), y: Math.round(p.y / scaleFactor) }))
      const simplified = rdpSimplify(scaled, epsilon)
      if (simplified.length < 3) continue
      let d = `M ${simplified[0].x} ${simplified[0].y}`
      for (let i = 1; i < simplified.length; i++) d += ` L ${simplified[i].x} ${simplified[i].y}`
      d += ' Z'
      subpaths.push(d)
      totalPoints += simplified.length
    }
    if (subpaths.length === 0) return fail('Boundary trace produced no usable paths')

    const userId = user_id || 'anonymous'
    const ts = Date.now()
    const basePath = order_number
      ? `production-packs/${userId}/${order_number}`
      : `file-services/${userId}/${ts}`
    const fileSuffix = order_number ? `-${ts}` : ''
    const svgPath = `${basePath}/cut-contour${fileSuffix}.svg`

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${origW} ${origH}" width="${origW}" height="${origH}">
  <g id="CutContour" fill="none" stroke="#FF00FF" stroke-width="1">
${subpaths.map(d => `    <path d="${d}" />`).join('\n')}
  </g>
</svg>`

    await supabase.storage.from(BUCKET).upload(
      svgPath,
      new TextEncoder().encode(svg),
      { contentType: 'image/svg+xml', upsert: true },
    )
    const { data: url } = supabase.storage.from(BUCKET).getPublicUrl(svgPath)

    const ms = Date.now() - startMs
    console.log(`[CUT-CONTOUR] Done ${subpaths.length} subpath(s), ${totalPoints} pts, ${ms}ms`)

    return ok({
      output_url: url?.publicUrl || '',
      file_url: url?.publicUrl || '',
      contour_subpaths: subpaths.length,
      contour_points: totalPoints,
      offset_inches: offsetInches,
      offset_px: offsetPxOrig,
      spot_color: 'CutContour (#FF00FF)',
      step: step_key || 'offset_contour',
      metrics: { subpaths: subpaths.length, contour_points: totalPoints, processing_ms: ms },
    })
  } catch (err) {
    console.error('[CUT-CONTOUR] Error:', err)
    return new Response(
      JSON.stringify({ success: false, error: String(err), step: 'offset_contour' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

// ── shared algorithms ───────────────────────────────────────────

function dilateBinary(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src
  const tmp = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r)
      let v = 0
      for (let xi = x0; xi <= x1; xi++) if (src[row + xi]) { v = 1; break }
      tmp[row + x] = v
    }
  }
  const out = new Uint8Array(w * h)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r)
      let v = 0
      for (let yi = y0; yi <= y1; yi++) if (tmp[yi * w + x]) { v = 1; break }
      out[y * w + x] = v
    }
  }
  return out
}

function findComponents(mask: Uint8Array, w: number, h: number) {
  const visited = new Uint8Array(w * h)
  const out: Array<{ area: number; startX: number; startY: number }> = []
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
        const cx = i % w, cy = (i - cx) / w
        if (cx > 0)     stack.push(i - 1)
        if (cx < w - 1) stack.push(i + 1)
        if (cy > 0)     stack.push(i - w)
        if (cy < h - 1) stack.push(i + w)
      }
      out.push({ area, startX: x, startY: y })
    }
  }
  return out
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
      const nx = cx + dx[dir], ny = cy + dy[dir]
      if (isFg(nx, ny)) { foundDir = dir; break }
    }
    if (foundDir < 0) break
    cx += dx[foundDir]
    cy += dy[foundDir]
    boundary.push({ x: cx, y: cy })
    backtrack = (foundDir + 4) & 7
    if (!firstMove) firstMove = { x: cx, y: cy }
    if (cx === startX && cy === startY && boundary.length > 2 && firstMove) {
      let nextDir = -1
      for (let i = 1; i <= 8; i++) {
        const dir = (backtrack + i) & 7
        const nx = cx + dx[dir], ny = cy + dy[dir]
        if (isFg(nx, ny)) { nextDir = dir; break }
      }
      if (nextDir >= 0) {
        const nx = cx + dx[nextDir], ny = cy + dy[nextDir]
        if (nx === firstMove.x && ny === firstMove.y) break
      } else break
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
      const d = perpDist(points[i], a, b)
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

function perpDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)
  const projX = a.x + t * dx, projY = a.y + t * dy
  return Math.hypot(p.x - projX, p.y - projY)
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
