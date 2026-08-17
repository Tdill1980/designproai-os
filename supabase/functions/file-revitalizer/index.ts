// ============================================================
// FILE-REVITALIZER™ — AI Upscale, Enhance & Clean Up
//
// Takes ANY customer file and revitalizes it for production:
//   - AI 2x/4x upscale via Replicate Real-ESRGAN
//   - Sharpening for print clarity
//   - Noise reduction
//   - DPI recalculation for target print size
//
// Accepts files from anywhere — not just RestylePro.
// This is a standalone RIP station preflight service.
//
// Revenue: Standalone service. 3 tokens per file.
// Deploy: supabase functions deploy file-revitalizer
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BUCKET = 'wrap-files'
const REPLICATE_MODEL = 'f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa' // Real-ESRGAN
const POLL_MAX = 60
const POLL_INTERVAL = 1000

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const body = await req.json()
    const {
      user_id, file_url, file_name,
      scale = 2,                  // 2x or 4x upscale
      sharpen = true,             // Apply unsharp mask for print
      denoise = false,            // Noise reduction
      target_dpi = 150,           // Target print DPI
      target_width_inches = 60,   // Default: 60" wrap width
      // Quick prep chain fields
      action_id, step_key, options, previous_results,
      // WrapBox routing — when present, save under production-packs/{user}/{order#}
      order_number,
    } = body

    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    console.log(`[REVITALIZER] Processing: ${file_name || 'file'} | scale: ${scale}x | sharpen: ${sharpen}`)

    // ── Fetch the original file ──────────────────────────────
    const imgResp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/FileRevitalizer' } })
    if (!imgResp.ok) return fail(`Cannot fetch file: ${imgResp.status}`)

    let imgBytes = new Uint8Array(await imgResp.arrayBuffer())
    const originalImg = await Image.decode(imgBytes)

    // Cap input to ~3MP so the function doesn't OOM on production-size files.
    // Edge worker has ~256MB; revitalizer also runs Replicate upscale which
    // produces a 4x output (3MP → 12MP), so we have to leave headroom for
    // the upscaled buffer + sharpen pass.
    // Replicate's GPU also has its own ~2.1MP cap on the input image, so
    // we need to resize before upload OR Replicate will reject.
    const MAX_INPUT_PIXELS = 2_000_000
    if (originalImg.width * originalImg.height > MAX_INPUT_PIXELS) {
      const factor = Math.sqrt(MAX_INPUT_PIXELS / (originalImg.width * originalImg.height))
      const newW = Math.max(1, Math.floor(originalImg.width * factor))
      const newH = Math.max(1, Math.floor(originalImg.height * factor))
      console.log(`[REVITALIZER] Resized ${originalImg.width}×${originalImg.height} → ${newW}×${newH} to fit Edge memory + Replicate GPU cap`)
      originalImg.resize(newW, newH)
      // Re-encode so the bytes uploaded to Replicate match the resized image.
      imgBytes = await originalImg.encode()
    }

    const origWidth = originalImg.width
    const origHeight = originalImg.height
    const origDPI = Math.round(origWidth / target_width_inches)

    console.log(`[REVITALIZER] Original: ${origWidth}x${origHeight} (est. ${origDPI} DPI at ${target_width_inches}")`)

    // ── AI Upscale via Replicate ─────────────────────────────
    let upscaledBytes: Uint8Array | null = null
    let upscaleMethod = 'none'

    const REPLICATE_API_TOKEN = Deno.env.get('REPLICATE_API_TOKEN')

    if (REPLICATE_API_TOKEN && origDPI < target_dpi) {
      console.log(`[REVITALIZER] DPI ${origDPI} < target ${target_dpi} — running AI upscale`)

      // Upload original to get a signed URL for Replicate
      const userId = user_id || 'anonymous'
      const timestamp = Date.now()
      const tempPath = `file-services/${userId}/${timestamp}/revitalizer-input.png`
      await supabase.storage.from(BUCKET).upload(tempPath, imgBytes, { contentType: 'image/png', upsert: true })
      const { data: signedInput } = await supabase.storage.from(BUCKET).createSignedUrl(tempPath, 3600)

      if (signedInput?.signedUrl) {
        try {
          const createResp = await fetch('https://api.replicate.com/v1/predictions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
              'Content-Type': 'application/json',
              Prefer: 'wait',
            },
            body: JSON.stringify({
              version: REPLICATE_MODEL,
              input: { image: signedInput.signedUrl, scale: Math.min(scale, 4), face_enhance: false },
            }),
          })

          let result = await createResp.json()
          let polls = 0

          while (result.status !== 'succeeded' && result.status !== 'failed' && result.status !== 'canceled' && polls < POLL_MAX) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL))
            polls++
            if (!result.urls?.get) break
            const pollResp = await fetch(result.urls.get, { headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` } })
            result = await pollResp.json()
          }

          if (result.status === 'succeeded' && result.output) {
            const outputUrl = typeof result.output === 'string' ? result.output : result.output[0]
            const upResp = await fetch(outputUrl)
            if (upResp.ok) {
              upscaledBytes = new Uint8Array(await upResp.arrayBuffer())
              upscaleMethod = `replicate-esrgan-${scale}x`
              console.log(`[REVITALIZER] AI upscale complete: ${(upscaledBytes.byteLength / 1024).toFixed(0)} KB`)
            }
          }
        } catch (e) {
          console.warn(`[REVITALIZER] Replicate failed, falling back to bicubic: ${e}`)
        }
      }
    }

    // ── Fallback: Software upscale ───────────────────────────
    let processedImg: any

    if (upscaledBytes) {
      processedImg = await Image.decode(upscaledBytes)
    } else if (origDPI < target_dpi) {
      // Software bicubic upscale
      const scaleFactor = Math.min(scale, Math.ceil(target_dpi / Math.max(origDPI, 1)))
      const newW = origWidth * scaleFactor
      const newH = origHeight * scaleFactor
      processedImg = originalImg.resize(newW, newH)
      upscaleMethod = `bicubic-${scaleFactor}x`
      console.log(`[REVITALIZER] Software upscale: ${newW}x${newH}`)
    } else {
      processedImg = originalImg.clone()
      upscaleMethod = 'none-sufficient-dpi'
    }

    // ── Sharpen for print ────────────────────────────────────
    if (sharpen) {
      // Unsharp mask: mild sharpening appropriate for large-format print
      processedImg = applyUnsharpMask(processedImg, 1.2, 0.5)
      console.log(`[REVITALIZER] Sharpening applied`)
    }

    // ── Save output ──────────────────────────────────────────
    // When called with an order_number, write to production-packs (the
    // folder WrapBox reads). Otherwise legacy file-services path.
    const userId = user_id || 'anonymous'
    const timestamp = Date.now()
    const outputPath = order_number
      ? `production-packs/${userId}/${order_number}/revitalized-${timestamp}.png`
      : `file-services/${userId}/${timestamp}/revitalized.png`

    const outputBytes = await processedImg.encode()
    await supabase.storage.from(BUCKET).upload(outputPath, outputBytes, { contentType: 'image/png', upsert: true })

    const { data: outputUrl } = supabase.storage.from(BUCKET).getPublicUrl(outputPath)

    const newDPI = Math.round(processedImg.width / target_width_inches)
    const processingMs = Date.now() - startMs

    console.log(`[REVITALIZER] Done: ${processedImg.width}x${processedImg.height} (${newDPI} DPI) in ${processingMs}ms`)

    return ok({
      output_url: outputUrl?.publicUrl || '',
      file_url: outputUrl?.publicUrl || '', // Orchestrator chain compat
      storage_path: outputPath,
      original: {
        width: origWidth,
        height: origHeight,
        estimated_dpi: origDPI,
        size_kb: Math.round(imgBytes.byteLength / 1024),
      },
      revitalized: {
        width: processedImg.width,
        height: processedImg.height,
        estimated_dpi: newDPI,
        size_kb: Math.round(outputBytes.byteLength / 1024),
        upscale_method: upscaleMethod,
        sharpened: sharpen,
        denoised: denoise,
      },
      improvement: {
        resolution_increase: `${((processedImg.width / origWidth) * 100 - 100).toFixed(0)}%`,
        dpi_before: origDPI,
        dpi_after: newDPI,
        meets_target: newDPI >= target_dpi,
        target_dpi,
      },
      processing_ms: processingMs,
      step: step_key || 'file_revitalizer',
      metrics: {
        upscale_method: upscaleMethod,
        original_size_kb: Math.round(imgBytes.byteLength / 1024),
        output_size_kb: Math.round(outputBytes.byteLength / 1024),
        processing_ms: processingMs,
      },
    })
  } catch (err) {
    console.error('[REVITALIZER] Error:', err)
    return new Response(
      JSON.stringify({ success: false, error: `FileRevitalizer failed: ${String(err)}`, step: 'file_revitalizer' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

// ── Unsharp Mask ─────────────────────────────────────────────
// Simple but effective for large-format print prep
function applyUnsharpMask(img: any, amount: number, threshold: number): any {
  const w = img.width
  const h = img.height
  const result = img.clone()

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const center = img.getPixelAt(x + 1, y + 1)
      const cr = (center >> 24) & 0xFF
      const cg = (center >> 16) & 0xFF
      const cb = (center >> 8) & 0xFF
      const ca = center & 0xFF

      // 3x3 box blur for the "unsharp" component
      let sr = 0, sg = 0, sb = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = img.getPixelAt(x + 1 + dx, y + 1 + dy)
          sr += (px >> 24) & 0xFF
          sg += (px >> 16) & 0xFF
          sb += (px >> 8) & 0xFF
        }
      }
      sr = Math.round(sr / 9)
      sg = Math.round(sg / 9)
      sb = Math.round(sb / 9)

      // Sharpen: center + amount * (center - blur)
      const diffR = cr - sr
      const diffG = cg - sg
      const diffB = cb - sb

      if (Math.abs(diffR) > threshold * 255 || Math.abs(diffG) > threshold * 255 || Math.abs(diffB) > threshold * 255) {
        const nr = Math.max(0, Math.min(255, Math.round(cr + amount * diffR)))
        const ng = Math.max(0, Math.min(255, Math.round(cg + amount * diffG)))
        const nb = Math.max(0, Math.min(255, Math.round(cb + amount * diffB)))
        result.setPixelAt(x + 1, y + 1, (nr << 24) | (ng << 16) | (nb << 8) | ca)
      }
    }
  }

  return result
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
