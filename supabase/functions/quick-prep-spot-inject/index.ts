// ============================================================
// QUICK-PREP: CutContour Spot Layer Injection
// Injects CutContour spot color layer into SVG/PDF output.
// The spot color tells RIP software where to cut.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const BUCKET = 'wrap-files'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    const { user_id, file_url, file_name, step_key, action_id, options, previous_results } = await req.json()
    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    console.log(`[SPOT-INJECT] Processing: ${file_name || 'file'}`)

    // Fetch current SVG content
    const resp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/QuickPrep' } })
    if (!resp.ok) return fail(`Cannot fetch: ${resp.status}`)

    const content = await resp.text()

    // Check if CutContour layer already exists
    if (content.includes('id="CutContour"')) {
      console.log(`[SPOT-INJECT] CutContour layer already exists — pass through`)
      return ok({
        output_url: file_url,
        file_url: file_url,
        injected: false,
        reason: 'CutContour layer already present',
        step: step_key || 'spot_layer_inject',
        metrics: { processing_ms: Date.now() - startMs },
      })
    }

    // Find existing path data to use as contour
    const pathMatch = content.match(/d="([^"]+)"/)
    if (!pathMatch) {
      // No paths found — create a rectangular cut contour from viewBox
      const viewBoxMatch = content.match(/viewBox="0 0 (\d+) (\d+)"/)
      const w = viewBoxMatch ? parseInt(viewBoxMatch[1]) : 500
      const h = viewBoxMatch ? parseInt(viewBoxMatch[2]) : 500

      const cutLayer = `\n  <g id="CutContour" fill="none" stroke="#FF00FF" stroke-width="0.5">\n    <rect x="0" y="0" width="${w}" height="${h}" />\n  </g>`
      const injected = content.replace('</svg>', `${cutLayer}\n</svg>`)

      const userId = user_id || 'anonymous'
      const ts = Date.now()
      const outPath = `file-services/${userId}/${ts}/spot-injected.svg`
      await supabase.storage.from(BUCKET).upload(outPath, new TextEncoder().encode(injected), { contentType: 'image/svg+xml', upsert: true })
      const { data: url } = supabase.storage.from(BUCKET).getPublicUrl(outPath)

      return ok({
        output_url: url?.publicUrl || '',
        file_url: url?.publicUrl || '',
        injected: true,
        cut_type: 'rectangle',
        spot_color: 'CutContour (#FF00FF)',
        step: step_key || 'spot_layer_inject',
        metrics: { processing_ms: Date.now() - startMs },
      })
    }

    // Duplicate existing path as CutContour spot layer
    const cutLayer = `\n  <g id="CutContour" fill="none" stroke="#FF00FF" stroke-width="0.5">\n    <path d="${pathMatch[1]}" />\n  </g>`
    const injected = content.replace('</svg>', `${cutLayer}\n</svg>`)

    const userId = user_id || 'anonymous'
    const ts = Date.now()
    const outPath = `file-services/${userId}/${ts}/spot-injected.svg`
    await supabase.storage.from(BUCKET).upload(outPath, new TextEncoder().encode(injected), { contentType: 'image/svg+xml', upsert: true })
    const { data: url } = supabase.storage.from(BUCKET).getPublicUrl(outPath)

    const ms = Date.now() - startMs
    console.log(`[SPOT-INJECT] Done: CutContour layer injected in ${ms}ms`)

    return ok({
      output_url: url?.publicUrl || '',
      file_url: url?.publicUrl || '',
      injected: true,
      cut_type: 'contour',
      spot_color: 'CutContour (#FF00FF)',
      step: step_key || 'spot_layer_inject',
      metrics: { processing_ms: ms },
    })
  } catch (err) {
    console.error('[SPOT-INJECT] Error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err), step: 'spot_layer_inject' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

function ok(d: any) { return new Response(JSON.stringify({ success: true, ...d }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
function fail(m: string) { return new Response(JSON.stringify({ success: false, error: m }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
