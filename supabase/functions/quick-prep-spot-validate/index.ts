// ============================================================
// QUICK-PREP: Spot Color Validation
// Validates CutContour spot colors are correctly named and
// configured for RIP software recognition.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Known RIP spot color names
const VALID_SPOT_NAMES = ['CutContour', 'CutPath', 'DieCut', 'PerfCut', 'ThruCut', 'KissCut']
const SPOT_COLOR_MAGENTA = '#FF00FF'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { file_url, file_name, step_key, user_id, options } = await req.json()
    if (!file_url) return fail('file_url required')

    const startMs = Date.now()
    console.log(`[SPOT-VALIDATE] Validating: ${file_name || 'file'}`)

    const resp = await fetch(file_url, { headers: { 'User-Agent': 'Deno/QuickPrep' } })
    if (!resp.ok) return fail(`Cannot fetch: ${resp.status}`)

    const content = await resp.text()

    const issues: Array<{ issue: string; severity: string; auto_fixable: boolean }> = []
    let hasCutContour = false
    let spotColorCorrect = false

    // Check for CutContour layer
    for (const name of VALID_SPOT_NAMES) {
      if (content.includes(`id="${name}"`)) {
        hasCutContour = true
        break
      }
    }

    if (!hasCutContour) {
      issues.push({
        issue: 'No CutContour spot layer found. RIP software will not detect cut paths.',
        severity: 'critical',
        auto_fixable: true,
      })
    }

    // Check spot color value
    if (content.includes(SPOT_COLOR_MAGENTA) || content.includes('#ff00ff')) {
      spotColorCorrect = true
    } else if (hasCutContour) {
      issues.push({
        issue: 'CutContour layer exists but uses non-standard color. Should be #FF00FF (Magenta).',
        severity: 'warning',
        auto_fixable: true,
      })
    }

    // Check stroke width (should be hairline for cut)
    const strokeMatch = content.match(/stroke-width="([^"]+)"/)
    if (strokeMatch && parseFloat(strokeMatch[1]) > 1) {
      issues.push({
        issue: `Cut path stroke width is ${strokeMatch[1]}. Should be 0.5pt or less for clean cuts.`,
        severity: 'warning',
        auto_fixable: true,
      })
    }

    // Check for fill on cut path (should be none)
    if (hasCutContour && content.includes('id="CutContour"')) {
      const cutSection = content.split('id="CutContour"')[1]?.split('</g>')[0] || ''
      if (cutSection.includes('fill="') && !cutSection.includes('fill="none"')) {
        issues.push({
          issue: 'CutContour path has fill. Cut paths should have fill="none".',
          severity: 'warning',
          auto_fixable: true,
        })
      }
    }

    const passed = issues.filter(i => i.severity === 'critical').length === 0
    const ms = Date.now() - startMs

    console.log(`[SPOT-VALIDATE] ${passed ? 'PASSED' : 'FAILED'}: ${issues.length} issues in ${ms}ms`)

    return ok({
      output_url: file_url, // Pass through — validation only
      file_url: file_url,
      validation: {
        passed,
        has_cut_contour: hasCutContour,
        spot_color_correct: spotColorCorrect,
        issues,
        issues_count: issues.length,
      },
      rip_ready: passed && hasCutContour && spotColorCorrect,
      step: step_key || 'spot_color_validate',
      metrics: { issues_found: issues.length, processing_ms: ms },
    })
  } catch (err) {
    console.error('[SPOT-VALIDATE] Error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err), step: 'spot_color_validate' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

function ok(d: any) { return new Response(JSON.stringify({ success: true, ...d }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
function fail(m: string) { return new Response(JSON.stringify({ success: false, error: m }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
