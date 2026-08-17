// ============================================================
// QUICK-PREP: Bleed Extension
// Extends image edges by mirroring to add print bleed.
// Standard 0.125" (1/8") bleed for production output.
// Same algorithm as panelizer-step-bleed.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const BUCKET = 'wrap-files'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    const { user_id, file_url, file_name, step_key, options } = await req.json()
    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    const bleedInches = (options?.bleed_inches as number) || 0.125
    const dpi = (options?.dpi as number) || 150
    const bleedPx = Math.round(bleedInches * dpi)

    console.log(`[BLEED] Processing: ${file_name || 'file'} | bleed: ${bleedInches}" (${bleedPx}px)`)

    const resp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/QuickPrep' } })
    if (!resp.ok) return fail(`Cannot fetch: ${resp.status}`)

    const bytes = new Uint8Array(await resp.arrayBuffer())
    const img = await Image.decode(bytes)
    const { width, height } = img

    // Create new canvas with bleed
    const newW = width + bleedPx * 2
    const newH = height + bleedPx * 2
    const result = new Image(newW, newH)

    // Copy original centered
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        result.setPixelAt(x + bleedPx + 1, y + bleedPx + 1, img.getPixelAt(x + 1, y + 1))
      }
    }

    // Mirror edges into bleed zone
    // Top edge
    for (let y = 0; y < bleedPx; y++) {
      for (let x = 0; x < width; x++) {
        const srcY = Math.min(bleedPx - y, height - 1)
        result.setPixelAt(x + bleedPx + 1, y + 1, img.getPixelAt(x + 1, srcY + 1))
      }
    }
    // Bottom edge
    for (let y = 0; y < bleedPx; y++) {
      for (let x = 0; x < width; x++) {
        const srcY = Math.max(0, height - 1 - y)
        result.setPixelAt(x + bleedPx + 1, height + bleedPx + y + 1, img.getPixelAt(x + 1, srcY + 1))
      }
    }
    // Left edge
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < bleedPx; x++) {
        const srcX = bleedPx + Math.min(bleedPx - x, width - 1)
        result.setPixelAt(x + 1, y + 1, result.getPixelAt(srcX + 1, y + 1))
      }
    }
    // Right edge
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < bleedPx; x++) {
        const srcX = bleedPx + Math.max(0, width - 1 - x)
        result.setPixelAt(width + bleedPx + x + 1, y + 1, result.getPixelAt(srcX + 1, y + 1))
      }
    }

    // Save
    const userId = user_id || 'anonymous'
    const ts = Date.now()
    const outPath = `file-services/${userId}/${ts}/bleed-extended.png`
    const outBytes = await result.encode()
    await supabase.storage.from(BUCKET).upload(outPath, outBytes, { contentType: 'image/png', upsert: true })
    const { data: url } = supabase.storage.from(BUCKET).getPublicUrl(outPath)

    const ms = Date.now() - startMs
    console.log(`[BLEED] Done: ${width}x${height} → ${newW}x${newH} in ${ms}ms`)

    return ok({
      output_url: url?.publicUrl || '',
      file_url: url?.publicUrl || '',
      original: { width, height },
      with_bleed: { width: newW, height: newH },
      bleed_inches: bleedInches,
      bleed_px: bleedPx,
      step: step_key || 'bleed_extend',
      metrics: { bleed_px: bleedPx, processing_ms: ms },
    })
  } catch (err) {
    console.error('[BLEED] Error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err), step: 'bleed_extend' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

function ok(d: any) { return new Response(JSON.stringify({ success: true, ...d }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
function fail(m: string) { return new Response(JSON.stringify({ success: false, error: m }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
