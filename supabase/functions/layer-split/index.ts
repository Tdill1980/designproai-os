// ============================================================
// LAYER SPLIT™ — Separated Subject + Background Plate
//
// Drop in any wrap render or photo. Get back:
//   1. Subject as a transparent PNG (logo / element / person extracted)
//   2. Background plate with the subject erased and filled in (LaMa)
//
// Two passes, two API calls, two output files. Nothing else bundled.
// (Use cut-map for cut paths — keep tools focused so they don't all
// fail together when one model has a bad day.)
//
// Pipeline:
//   1. Replicate BiRefNet → subject cutout (transparent PNG)
//   2. Build inverse-alpha mask from the cutout
//   3. Replicate LaMa-style inpaint → background plate
//
// Standalone service. Tokens gated upstream by run-production-flow.
// Deploy: supabase functions deploy layer-split
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts'
import { replicateBgRemove, replicateInpaintBackground } from '../_shared/replicate-bg-remove.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const BUCKET = 'wrap-files'

// LaMa quality holds well at moderate res; bigger inputs blow latency
// and edge memory without much quality gain. We downscale if needed.
const MAX_INPAINT_PIXELS = 1_500_000

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const body = await req.json()
    const { user_id, file_url, file_name, step_key, options, order_number } = body
    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    console.log(`[LAYER-SPLIT] ${file_name || 'file'}`)

    // ── 1. Fetch source ──────────────────────────────────────────
    const srcResp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/LayerSplit' } })
    if (!srcResp.ok) return fail(`Cannot fetch source: ${srcResp.status}`)
    const srcBytes = new Uint8Array(await srcResp.arrayBuffer())

    const lowerName = (file_name || '').toLowerCase()
    const headerCt = srcResp.headers.get('content-type') || ''
    let srcContentType = 'image/png'
    let srcExt = 'png'
    if (headerCt.includes('jpeg') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
      srcContentType = 'image/jpeg'; srcExt = 'jpg'
    } else if (headerCt.includes('webp') || lowerName.endsWith('.webp')) {
      srcContentType = 'image/webp'; srcExt = 'webp'
    }

    // ALWAYS decode → re-encode as PNG before sending to Replicate. This
    // covers TIFF/HEIC/etc that customers upload (Replicate models accept
    // PNG/JPG/WEBP only). Also handles the downscale for big files.
    let workingBytes: Uint8Array
    let workingContentType = 'image/png'
    let workingExt = 'png'
    try {
      let probe = await Image.decode(srcBytes)
      if (probe.width * probe.height > MAX_INPAINT_PIXELS) {
        const factor = Math.sqrt(MAX_INPAINT_PIXELS / (probe.width * probe.height))
        const nw = Math.max(1, Math.floor(probe.width * factor))
        const nh = Math.max(1, Math.floor(probe.height * factor))
        console.log(`[LAYER-SPLIT] Downscale ${probe.width}×${probe.height} → ${nw}×${nh}`)
        probe = probe.clone().resize(nw, nh)
      }
      workingBytes = await probe.encode()
    } catch (e) {
      console.error(`[LAYER-SPLIT] decode failed:`, e instanceof Error ? e.message : e)
      return fail(`Could not decode "${file_name || 'file'}". Supported formats: PNG, JPG, JPEG, WEBP, TIFF, BMP, GIF. Save as PNG or JPG and try again.`)
    }
    // Suppress unused-warning for srcContentType / srcExt (kept for future routing)
    void srcContentType; void srcExt;

    const userId = user_id || 'anonymous'
    const ts = Date.now()
    const tempInputPath = `file-services/${userId}/${ts}/layer-split-input.${workingExt}`
    const { error: tempUpErr } = await supabase.storage
      .from(BUCKET)
      .upload(tempInputPath, workingBytes, { contentType: workingContentType, upsert: true })
    if (tempUpErr) return fail(`Temp upload failed: ${tempUpErr.message}`)

    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET).createSignedUrl(tempInputPath, 600)
    if (signErr || !signed?.signedUrl) {
      await supabase.storage.from(BUCKET).remove([tempInputPath])
      return fail(`Signed URL failed: ${signErr?.message || 'no url'}`)
    }

    // ── 2. BiRefNet → subject cutout ─────────────────────────────
    const bgResult = await replicateBgRemove(signed.signedUrl)
    if (!bgResult.removed || bgResult.imageBytes.length === 0) {
      await supabase.storage.from(BUCKET).remove([tempInputPath])
      return fail(`Subject extraction failed: ${bgResult.error || 'no output'}`)
    }
    console.log(`[LAYER-SPLIT] subject extracted in ${bgResult.elapsedMs}ms`)

    // ── 3. Build inverse-alpha mask (white = remove, black = keep) ──
    const cutoutImg = await Image.decode(bgResult.imageBytes)
    const W = cutoutImg.width, H = cutoutImg.height
    const maskImg = new Image(W, H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const px = cutoutImg.getPixelAt(x + 1, y + 1)
        const a = px & 0xFF
        maskImg.setPixelAt(x + 1, y + 1, a > 32 ? 0xFFFFFFFF : 0x000000FF)
      }
    }
    const maskBytes = await maskImg.encode()
    const maskPath = `file-services/${userId}/${ts}/layer-split-mask.png`
    const { error: maskUpErr } = await supabase.storage
      .from(BUCKET).upload(maskPath, maskBytes, { contentType: 'image/png', upsert: true })
    if (maskUpErr) {
      await supabase.storage.from(BUCKET).remove([tempInputPath])
      return fail(`Mask upload failed: ${maskUpErr.message}`)
    }
    const { data: maskSigned, error: maskSignErr } = await supabase.storage
      .from(BUCKET).createSignedUrl(maskPath, 600)
    if (maskSignErr || !maskSigned?.signedUrl) {
      await supabase.storage.from(BUCKET).remove([tempInputPath, maskPath])
      return fail(`Mask sign failed: ${maskSignErr?.message || 'no url'}`)
    }

    // ── 4. LaMa inpaint → clean background plate ────────────────
    const inpaint = await replicateInpaintBackground(signed.signedUrl, maskSigned.signedUrl)
    // Clean up temp input + mask whether inpaint succeeded or failed
    await supabase.storage.from(BUCKET).remove([tempInputPath, maskPath])
    if (!inpaint.inpainted || inpaint.imageBytes.length === 0) {
      return fail(`Background inpaint failed: ${inpaint.error || 'no output'}`)
    }
    console.log(`[LAYER-SPLIT] BG plate inpainted in ${inpaint.elapsedMs}ms`)

    // ── 5. Save outputs ─────────────────────────────────────────
    const basePath = order_number
      ? `production-packs/${userId}/${order_number}`
      : `file-services/${userId}/${ts}`
    const fileSuffix = order_number ? `-${ts}` : ''

    const subjectPath = `${basePath}/subject${fileSuffix}.png`
    await supabase.storage.from(BUCKET).upload(subjectPath, bgResult.imageBytes, {
      contentType: 'image/png', upsert: true,
    })
    const { data: subjectUrlData } = supabase.storage.from(BUCKET).getPublicUrl(subjectPath)

    const backgroundPath = `${basePath}/background${fileSuffix}.png`
    await supabase.storage.from(BUCKET).upload(backgroundPath, inpaint.imageBytes, {
      contentType: 'image/png', upsert: true,
    })
    const { data: backgroundUrlData } = supabase.storage.from(BUCKET).getPublicUrl(backgroundPath)

    const totalMs = Date.now() - startMs
    console.log(`[LAYER-SPLIT] Done in ${totalMs}ms`)

    return ok({
      // primary download for the dashboard — the subject cutout
      output_url: subjectUrlData?.publicUrl || '',
      file_url: subjectUrlData?.publicUrl || '',
      // both layers explicitly
      subject_url: subjectUrlData?.publicUrl || '',
      subject_storage_path: subjectPath,
      background_url: backgroundUrlData?.publicUrl || '',
      background_storage_path: backgroundPath,
      image_dimensions: { width: W, height: H },
      bg_removal_method: bgResult.method,
      bg_removal_ms: bgResult.elapsedMs,
      inpaint_method: inpaint.method,
      inpaint_ms: inpaint.elapsedMs,
      processing_ms: totalMs,
      step: step_key || 'layer_split',
      metrics: {
        bg_removal_ms: bgResult.elapsedMs,
        inpaint_ms: inpaint.elapsedMs,
        processing_ms: totalMs,
      },
    })
  } catch (err) {
    console.error('[LAYER-SPLIT] Error:', err)
    return new Response(
      JSON.stringify({ success: false, error: `Layer split failed: ${String(err)}`, step: 'layer_split' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

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
