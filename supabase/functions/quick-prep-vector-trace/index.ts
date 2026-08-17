// ============================================================
// QUICK-PREP: Vector Trace (Silhouette + Vector Rebuild)
// Wraps vectorize-it for the quick prep pipeline.
// step_key=trace_silhouette → silhouette mode
// step_key=vector_rebuild → detailed mode
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
    const { user_id, file_url, file_name, step_key, action_id, options } = await req.json()
    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    const mode = step_key === 'vector_rebuild' ? 'detailed' : 'silhouette'
    console.log(`[VECTOR-TRACE] ${mode} trace: ${file_name || 'file'}`)

    const resp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/QuickPrep' } })
    if (!resp.ok) return fail(`Cannot fetch: ${resp.status}`)

    const bytes = new Uint8Array(await resp.arrayBuffer())
    const img = await Image.decode(bytes)
    const w = img.width, h = img.height

    // Scale down for memory safety
    let processImg = img
    let scaleFactor = 1
    if (w > 1500 || h > 1500) {
      scaleFactor = Math.min(1500 / w, 1500 / h)
      processImg = img.resize(Math.round(w * scaleFactor), Math.round(h * scaleFactor))
    }
    const pw = processImg.width, ph = processImg.height

    // Build mask and trace edges
    const contourPoints: Array<{ x: number; y: number }> = []
    for (let y = 1; y < ph - 1; y++) {
      for (let x = 1; x < pw - 1; x++) {
        const px = processImg.getPixelAt(x + 1, y + 1)
        const a = px & 0xFF
        const r = (px >> 24) & 0xFF, g = (px >> 16) & 0xFF, b = (px >> 8) & 0xFF
        const lum = 0.299 * r + 0.587 * g + 0.114 * b
        const isFg = a > 20 && lum < 245

        if (isFg) {
          // Check if edge pixel
          const checkNeighbor = (nx: number, ny: number) => {
            if (nx < 0 || nx >= pw || ny < 0 || ny >= ph) return false
            const np = processImg.getPixelAt(nx + 1, ny + 1)
            const na = np & 0xFF
            const nr = (np >> 24) & 0xFF, ng = (np >> 16) & 0xFF, nb = (np >> 8) & 0xFF
            const nl = 0.299 * nr + 0.587 * ng + 0.114 * nb
            return na > 20 && nl < 245
          }
          if (!checkNeighbor(x - 1, y) || !checkNeighbor(x + 1, y) ||
              !checkNeighbor(x, y - 1) || !checkNeighbor(x, y + 1)) {
            contourPoints.push({ x: Math.round(x / scaleFactor), y: Math.round(y / scaleFactor) })
          }
        }
      }
    }

    // Build SVG
    const simplified = contourPoints.filter((_, i) => i % Math.max(1, Math.floor(contourPoints.length / 1500)) === 0)
    let pathD = ''
    if (simplified.length > 0) {
      pathD = `M ${simplified[0].x} ${simplified[0].y}`
      for (let i = 1; i < simplified.length; i++) pathD += ` L ${simplified[i].x} ${simplified[i].y}`
      pathD += ' Z'
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <g id="${mode}-trace" fill="${mode === 'detailed' ? '#000' : 'none'}" stroke="#000" stroke-width="1">
    <path d="${pathD}" />
  </g>
</svg>`

    const userId = user_id || 'anonymous'
    const ts = Date.now()
    const svgPath = `file-services/${userId}/${ts}/vector-trace.svg`
    await supabase.storage.from(BUCKET).upload(svgPath, new TextEncoder().encode(svg), { contentType: 'image/svg+xml', upsert: true })
    const { data: url } = supabase.storage.from(BUCKET).getPublicUrl(svgPath)

    const ms = Date.now() - startMs
    console.log(`[VECTOR-TRACE] Done: ${contourPoints.length} points, ${ms}ms`)

    return ok({
      output_url: url?.publicUrl || '',
      file_url: url?.publicUrl || '',
      trace_mode: mode,
      contour_points: contourPoints.length,
      step: step_key || 'vector_trace',
      metrics: { contour_points: contourPoints.length, processing_ms: ms },
    })
  } catch (err) {
    console.error('[VECTOR-TRACE] Error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err), step: 'vector_trace' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

function ok(d: any) { return new Response(JSON.stringify({ success: true, ...d }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
function fail(m: string) { return new Response(JSON.stringify({ success: false, error: m }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
