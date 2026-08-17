// ============================================================
// QUICK-PREP: AI Upscale  (ProductionFlow "AI Upscale" tool)
// PRIMARY engine: Topaz Image Enhance API (most powerful model).
//   Default model = "High Fidelity V2" — Topaz's highest-detail,
//   NON-generative model. It sharpens/upscales without reinventing
//   the artwork, so a print panel stays the EXACT design (no
//   hallucinated detail). Up to 6× in one pass, capped at 32,000px.
// FALLBACKS (so an upload always returns a file): Replicate
//   Real-ESRGAN → bicubic, only if Topaz has no key or errors.
//
// MEMORY: the hot path (Topaz success) NEVER decodes the image — dims
// are read straight from the PNG/JPEG header — so a large upscaled
// output can't OOM the 256MB worker (the 546 limit). imagescript is
// only decoded in the ESRGAN/bicubic fallbacks.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts'
import { upscaleImageBytes } from '../_shared/topaz-upscale.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const BUCKET = 'wrap-files'
const REPLICATE_MODEL = 'f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa'
// Topaz's most powerful detail model for print artwork. Overridable per-call
// via options.topazModel (e.g. "Standard V2", "CGI", "Recovery", "Redefine").
const TOPAZ_MODEL = 'High Fidelity V2'

/** Read W×H from a PNG/JPEG header without decoding the pixels (cheap, OOM-safe). */
function readDims(b: Uint8Array): { width: number; height: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) }
  }
  if (b.length >= 4 && b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2
    while (i < b.length - 8) {
      if (b[i] !== 0xFF) { i++; continue }
      const m = b[i + 1]; i += 2
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD9)) continue
      if (i + 1 >= b.length) break
      const segLen = (b[i] << 8) | b[i + 1]
      const isSOF = m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC
      if (isSOF && i + 6 < b.length) return { height: (b[i + 3] << 8) | b[i + 4], width: (b[i + 5] << 8) | b[i + 6] }
      if (segLen < 2) break
      i += segLen
    }
  }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    const { user_id, file_url, file_name, step_key, options, order_number } = await req.json()
    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    const scale = Math.max(2, Math.min((options?.scale as number) || 4, 6))
    const topazModel = (options?.topazModel as string) || TOPAZ_MODEL
    console.log(`[UPSCALE-QP] ${file_name || 'file'} | target ${scale}x | primary: Topaz "${topazModel}"`)

    const resp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/QuickPrep' } })
    if (!resp.ok) return fail(`Cannot fetch: ${resp.status}`)
    const inputBytes = new Uint8Array(await resp.arrayBuffer())

    const isJpeg = inputBytes[0] === 0xFF && inputBytes[1] === 0xD8
    const mime = isJpeg ? 'image/jpeg' : 'image/png'
    const inDims = readDims(inputBytes)
    const origW = inDims?.width || 0, origH = inDims?.height || 0

    let outputBytes: Uint8Array | undefined
    let method = ''

    // ── 1) PRIMARY: Topaz Image Enhance (most powerful model) — no decode ──
    try {
      const tz = await upscaleImageBytes(inputBytes, mime, supabase, {
        userId: user_id || 'anonymous',
        scale, passes: 1,
        model: topazModel,
        label: `quick-prep ${file_name || 'file'}`.trim(),
        timeoutMs: 120_000,
        outputFormat: 'png',
      })
      if (tz.upscaled && tz.imageBytes?.length) {
        outputBytes = tz.imageBytes
        method = `topaz-${topazModel}-${scale}x`
      } else {
        console.warn(`[UPSCALE-QP] Topaz did not upscale (${tz.method}) — falling back`)
      }
    } catch (e) {
      console.warn(`[UPSCALE-QP] Topaz failed: ${e} — falling back`)
    }

    // ── 2) FALLBACK: Replicate Real-ESRGAN (decodes only to cap input) ─────
    if (!outputBytes) {
      const REPLICATE_API_TOKEN = Deno.env.get('REPLICATE_API_TOKEN')
      const maxInputForScale = scale >= 6 ? 800_000 : 2_000_000
      let fbBytes = inputBytes
      if (origW * origH > maxInputForScale) {
        const factor = Math.sqrt(maxInputForScale / (origW * origH))
        const r = (await Image.decode(inputBytes)).resize(
          Math.max(1, Math.floor(origW * factor)),
          Math.max(1, Math.floor(origH * factor)),
        )
        fbBytes = await r.encode()
      }
      if (REPLICATE_API_TOKEN) {
        try {
          const ts = Date.now()
          const tempPath = `file-services/${user_id || 'anonymous'}/${ts}/upscale-input.png`
          await supabase.storage.from(BUCKET).upload(tempPath, fbBytes, { contentType: 'image/png', upsert: true })
          const { data: signedInput } = supabase.storage.from(BUCKET).getPublicUrl(tempPath)
          if (signedInput?.publicUrl) {
            const createResp = await fetch('https://api.replicate.com/v1/predictions', {
              method: 'POST',
              headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json', Prefer: 'wait' },
              body: JSON.stringify({ version: REPLICATE_MODEL, input: { image: signedInput.publicUrl, scale: Math.min(scale, 4), face_enhance: false } }),
            })
            let result = await createResp.json()
            let polls = 0
            while (result.status !== 'succeeded' && result.status !== 'failed' && polls < 60) {
              await new Promise(r => setTimeout(r, 1000)); polls++
              if (!result.urls?.get) break
              result = await (await fetch(result.urls.get, { headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` } })).json()
            }
            if (result.status === 'succeeded' && result.output) {
              const outUrl = typeof result.output === 'string' ? result.output : result.output[0]
              const upResp = await fetch(outUrl)
              if (upResp.ok) { outputBytes = new Uint8Array(await upResp.arrayBuffer()); method = `replicate-esrgan-${Math.min(scale, 4)}x` }
            }
          }
        } catch (e) { console.warn(`[UPSCALE-QP] Replicate fallback failed: ${e}`) }
      }
    }

    // ── 3) LAST-RESORT FALLBACK: bicubic ───────────────────────────────────
    if (!outputBytes) {
      const upscaled = (await Image.decode(inputBytes)).resize(Math.max(1, origW || 1024) * scale, Math.max(1, origH || 1024) * scale)
      outputBytes = await upscaled.encode()
      method = `bicubic-${scale}x`
    }

    const outDims = readDims(outputBytes)
    const userId = user_id || 'anonymous'
    const ts = Date.now()
    const outPath = order_number
      ? `production-packs/${userId}/${order_number}/upscaled-${scale}x-${ts}.png`
      : `file-services/${userId}/${ts}/upscaled-${scale}x.png`
    await supabase.storage.from(BUCKET).upload(outPath, outputBytes, { contentType: 'image/png', upsert: true })
    const { data: url } = supabase.storage.from(BUCKET).getPublicUrl(outPath)

    const ms = Date.now() - startMs
    console.log(`[UPSCALE-QP] Done: ${origW}x${origH} → ${outDims?.width}x${outDims?.height} (${method}) in ${ms}ms → ${outPath}`)

    return ok({
      output_url: url?.publicUrl || '',
      file_url: url?.publicUrl || '',
      storage_path: outPath,
      original: { width: origW, height: origH },
      upscaled: { width: outDims?.width || 0, height: outDims?.height || 0 },
      scale,
      method,
      engine: method.startsWith('topaz') ? 'topaz' : method.startsWith('replicate') ? 'replicate' : 'bicubic',
      topaz_model: method.startsWith('topaz') ? topazModel : null,
      step: step_key || 'upscale_4x',
      metrics: { method, processing_ms: ms },
    })
  } catch (err) {
    console.error('[UPSCALE-QP] Error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err), step: 'upscale_4x' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

function ok(d: any) { return new Response(JSON.stringify({ success: true, ...d }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
function fail(m: string) { return new Response(JSON.stringify({ success: false, error: m }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
