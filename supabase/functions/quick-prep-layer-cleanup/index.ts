// ============================================================
// QUICK-PREP: Layer Cleanup
// Cleans up SVG layer structure for RIP compatibility.
// Ensures proper naming, removes empty groups, flattens
// unnecessary nesting.
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
    const { user_id, file_url, file_name, step_key, options } = await req.json()
    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    console.log(`[LAYER-CLEANUP] Processing: ${file_name || 'file'}`)

    const resp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/QuickPrep' } })
    if (!resp.ok) return fail(`Cannot fetch: ${resp.status}`)

    let svg = await resp.text()
    const originalSize = svg.length

    // Remove empty groups
    let beforeSize: number
    do {
      beforeSize = svg.length
      svg = svg.replace(/<g[^>]*>\s*<\/g>/g, '')
    } while (svg.length < beforeSize)

    // Remove unnecessary attributes
    svg = svg.replace(/\s+data-[a-z-]+="[^"]*"/g, '') // Remove data-* attributes
    svg = svg.replace(/\s+class="[^"]*"/g, '')          // Remove classes (inline styles preferred for RIP)
    svg = svg.replace(/<!--[\s\S]*?-->/g, '')           // Remove comments (except our own)

    // Ensure proper layer naming for RIP
    if (!svg.includes('id="Artwork"') && !svg.includes('id="CutContour"')) {
      // Wrap all content in an "Artwork" layer
      svg = svg.replace(
        /(<svg[^>]*>)/,
        '$1\n  <g id="Artwork">'
      ).replace(
        /<\/svg>/,
        '  </g>\n</svg>'
      )
    }

    // Add ProductionFlow metadata
    if (!svg.includes('ProductionFlow')) {
      svg = svg.replace(
        /(<svg[^>]*>)/,
        '$1\n  <!-- Cleaned by ProductionFlow™ Layer Cleanup -->'
      )
    }

    const cleanedSize = svg.length
    const reduction = ((1 - cleanedSize / originalSize) * 100).toFixed(1)

    // Save
    const userId = user_id || 'anonymous'
    const ts = Date.now()
    const outPath = `file-services/${userId}/${ts}/layer-cleaned.svg`
    await supabase.storage.from(BUCKET).upload(outPath, new TextEncoder().encode(svg), { contentType: 'image/svg+xml', upsert: true })
    const { data: url } = supabase.storage.from(BUCKET).getPublicUrl(outPath)

    const ms = Date.now() - startMs
    console.log(`[LAYER-CLEANUP] Done: ${originalSize} → ${cleanedSize} bytes (${reduction}% reduction) in ${ms}ms`)

    return ok({
      output_url: url?.publicUrl || '',
      file_url: url?.publicUrl || '',
      original_size: originalSize,
      cleaned_size: cleanedSize,
      reduction_percent: `${reduction}%`,
      step: step_key || 'layer_cleanup',
      metrics: { original_size: originalSize, cleaned_size: cleanedSize, processing_ms: ms },
    })
  } catch (err) {
    console.error('[LAYER-CLEANUP] Error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err), step: 'layer_cleanup' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

function ok(d: any) { return new Response(JSON.stringify({ success: true, ...d }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
function fail(m: string) { return new Response(JSON.stringify({ success: false, error: m }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
