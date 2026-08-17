// ============================================================
// QUICK-PREP: Background Removal
// Real subject segmentation via Replicate BiRefNet.
// Outputs a transparent PNG with proper alpha matting (hair, text,
// logos, photographic subjects). Replaces the prior corner-color
// flood-fill which produced ~1.5% removal on real artwork.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { replicateBgRemove } from '../_shared/replicate-bg-remove.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const BUCKET = 'wrap-files'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    const { user_id, file_url, file_name, step_key, order_number } = await req.json()
    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    console.log(`[BG-REMOVE] Processing: ${file_name || 'file'}`)

    // Fetch source bytes so we can re-host them on a signed URL Replicate can read.
    // (The original file_url may already be public, but signing keeps it consistent
    // and lets the function be called with private storage paths too.)
    const resp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/QuickPrep' } })
    if (!resp.ok) return fail(`Cannot fetch source: ${resp.status}`)
    const bytes = new Uint8Array(await resp.arrayBuffer())

    // Detect content type from response headers, fall back to extension, then PNG.
    const lowerName = (file_name || '').toLowerCase()
    const headerCt = resp.headers.get('content-type') || ''
    let contentType = 'image/png'
    let ext = 'png'
    if (headerCt.includes('jpeg') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
      contentType = 'image/jpeg'
      ext = 'jpg'
    } else if (headerCt.includes('webp') || lowerName.endsWith('.webp')) {
      contentType = 'image/webp'
      ext = 'webp'
    }

    const userId = user_id || 'anonymous'
    const ts = Date.now()
    const tempInputPath = `file-services/${userId}/${ts}/bg-input.${ext}`

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(tempInputPath, bytes, { contentType, upsert: true })
    if (upErr) return fail(`Temp input upload failed: ${upErr.message}`)

    const { data: signedData, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(tempInputPath, 600)
    if (signErr || !signedData?.signedUrl) {
      await supabase.storage.from(BUCKET).remove([tempInputPath])
      return fail(`Signed URL failed: ${signErr?.message || 'no url'}`)
    }

    const result = await replicateBgRemove(signedData.signedUrl)

    // Clean up temp input regardless of outcome
    await supabase.storage.from(BUCKET).remove([tempInputPath])

    if (!result.removed || result.imageBytes.length === 0) {
      console.error(`[BG-REMOVE] Failed: ${result.error}`)
      return fail(`Background removal failed: ${result.error || 'no output'}`)
    }

    const outPath = order_number
      ? `production-packs/${userId}/${order_number}/bg-removed-${ts}.png`
      : `file-services/${userId}/${ts}/bg-removed.png`

    const { error: outErr } = await supabase.storage
      .from(BUCKET)
      .upload(outPath, result.imageBytes, { contentType: 'image/png', upsert: true })
    if (outErr) return fail(`Output upload failed: ${outErr.message}`)

    const { data: url } = supabase.storage.from(BUCKET).getPublicUrl(outPath)
    const ms = Date.now() - startMs
    console.log(`[BG-REMOVE] Done via ${result.method} in ${ms}ms (${(result.imageBytes.length / 1024).toFixed(0)} KB) → ${outPath}`)

    return ok({
      output_url: url?.publicUrl || '',
      file_url: url?.publicUrl || '',
      storage_path: outPath,
      method: result.method,
      step: step_key || 'bg_remove',
      metrics: { method: result.method, processing_ms: ms, replicate_ms: result.elapsedMs },
    })
  } catch (err) {
    console.error('[BG-REMOVE] Error:', err)
    return new Response(
      JSON.stringify({ success: false, error: String(err), step: 'bg_remove' }),
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
