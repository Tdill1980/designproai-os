// ============================================================
// QA-VALIDATE-PANELS
// Edge Function: qa-validate-panels
// Checks each panel for print quality issues using AI vision
// Called by: run-production-flow orchestrator (Stage 2)
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface QAIssue {
  id: string
  panel_name: string
  check_type: string        // trim_zone | completeness | color | continuity
  severity: 'fail' | 'warning' | 'info'
  message: string
  customer_message: string  // friendly version for the customer
  requires_input: boolean   // true = pause pipeline for customer decision
  options?: string[]
  fix_cost?: number
  preview_url?: string
  details: any
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const googleApiKey = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!googleApiKey) {
    return new Response(
      JSON.stringify({ success: false, error: 'GOOGLE_AI_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { job_id, panels, vehicle } = await req.json()

    if (!panels || panels.length === 0) {
      return new Response(
        JSON.stringify({ success: true, all_passed: true, issues: [], total_issues: 0, requires_input: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const allIssues: QAIssue[] = []

    // Run QA checks on each panel
    for (const panel of panels) {
      if (!panel.signed_url && !panel.storage_path) continue

      const panelUrl = panel.signed_url || panel.storage_path
      const panelIssues = await checkPanel(panelUrl, panel, vehicle, googleApiKey)
      allIssues.push(...panelIssues)
    }

    // Run cross-panel checks (driver vs passenger continuity)
    const driverPanel = panels.find((p: any) => p.name === 'driver-side')
    const passengerPanel = panels.find((p: any) => p.name === 'passenger-side')
    if (driverPanel && passengerPanel) {
      const continuityIssues = await checkContinuity(driverPanel, passengerPanel, googleApiKey)
      allIssues.push(...continuityIssues)
    }

    const allPassed = allIssues.filter(i => i.severity === 'fail').length === 0
    const requiresInput = allIssues.some(i => i.requires_input)

    return new Response(
      JSON.stringify({
        success: true,
        all_passed: allPassed,
        issues: allIssues,
        total_issues: allIssues.length,
        fail_count: allIssues.filter(i => i.severity === 'fail').length,
        warning_count: allIssues.filter(i => i.severity === 'warning').length,
        requires_input: requiresInput,
        checked_panels: panels.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('QA validation error:', err)
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ── PER-PANEL PREFLIGHT QA ────────────────────────────────────
// Modeled after WePrintWraps production preflight workflow:
// - 0.5" bleed on all sides (gets trimmed during installation)
// - 1" safe zone for critical content (text, logos, faces, phone numbers)
// - Panel must cover vehicle zone dimensions
// - Mirrored panels (passenger) must have correct text orientation
// - Seam zones where panels meet must be clean

const BLEED_INCHES = 1.5
const SAFE_ZONE_INCHES = 1.0

async function checkPanel(panelUrl: string, panel: any, vehicle: any, apiKey: string): Promise<QAIssue[]> {
  const issues: QAIssue[] = []

  try {
    // Fetch panel image as base64
    const imageResponse = await fetch(panelUrl)
    if (!imageResponse.ok) {
      issues.push({
        id: `${panel.name}-fetch-fail`,
        panel_name: panel.name,
        check_type: 'fetch',
        severity: 'fail',
        message: `Could not fetch panel image: ${imageResponse.status}`,
        customer_message: `We had trouble loading your ${panel.label} panel. Our team will review.`,
        requires_input: false,
        details: { status: imageResponse.status }
      })
      return issues
    }

    const imageBuffer = await imageResponse.arrayBuffer()
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)))

    const isMirrored = panel.mirrored || panel.name?.includes('passenger')
    const mirrorNote = isMirrored
      ? `\nMIRROR CHECK: This is the PASSENGER SIDE (mirrored). All text MUST read left-to-right. Reversed/backwards text = FAIL.`
      : ''

    // Production preflight prompt — like a real print shop QC specialist
    const qaPrompt = `You are a PREFLIGHT SPECIALIST at a large-format vinyl wrap print shop. Inspect this print-ready panel file before it goes to the printer.

Vehicle: ${vehicle?.year || ''} ${vehicle?.make || ''} ${vehicle?.model || ''}
Panel: ${panel.label} (${panel.width_inches || '?'}" × ${panel.height_inches || '?'}")
Bleed: ${BLEED_INCHES}" on all 4 sides (will be trimmed during installation)
Safe zone: ${SAFE_ZONE_INCHES}" inset from trim line for critical elements
${mirrorNote}

Respond ONLY with valid JSON (no markdown, no backticks):

{
  "issues": [
    {
      "check_type": "bleed_zone | safe_zone | completeness | color | resolution | seam_safety | mirror_text",
      "severity": "fail | warning | info",
      "element": "what element has the issue",
      "location": "where on the panel (top/bottom/left/right edge, center, etc)",
      "description": "technical description for QC team",
      "customer_description": "friendly description for the customer",
      "fixable_by_ai": true/false,
      "fix_cost_suggestion": 0-19
    }
  ],
  "overall_quality": "pass | marginal | fail",
  "detected_elements": {
    "logos": 0,
    "text_elements": 0,
    "phone_numbers": 0,
    "faces": 0,
    "urls": 0
  },
  "notes": "preflight summary for QC team"
}

PREFLIGHT CHECK 1 — BLEED ZONES (${BLEED_INCHES}" all sides):
Does the design extend ${BLEED_INCHES}" past where the trim line would be on all 4 edges? The bleed area must contain continued design content — NOT blank/white space. White or blank edges where bleed should be = FAIL.

PREFLIGHT CHECK 2 — SAFE ZONE (${SAFE_ZONE_INCHES}" from trim):
Are phone numbers, URLs, faces, logos, business names, or contact info within ${SAFE_ZONE_INCHES}" of any edge? These get cut off during installation if they're in the trim zone. Critical content within 0.5" = FAIL. Critical content between 0.5"-1.0" = WARNING. Background colors/patterns in the zone are fine.

PREFLIGHT CHECK 3 — ELEMENT COMPLETENESS:
Is any text truncated or cut off? Any phone number missing digits? Any logo cropped? Any face only partially visible? Any URL cut off? Partial critical content = FAIL.

PREFLIGHT CHECK 4 — COLOR & PRINT QUALITY:
Any color banding, jpeg compression artifacts, blur, pixelation, or AI generation artifacts? Would this look professional on a vehicle at 150 DPI full scale? Quality issues = WARNING.

PREFLIGHT CHECK 5 — SEAM SAFETY:
Top/bottom edges = where panel meets roof and rocker panel. Left/right edges = front/rear of vehicle. Are logos, phone numbers, or faces positioned right at these boundaries where they'd land on an overlap seam? Elements at seam boundaries = WARNING.

PREFLIGHT CHECK 6 — MIRROR/TEXT ORIENTATION:
${isMirrored ? 'CRITICAL: This is a MIRRORED (passenger side) panel. Check that ALL text reads correctly left-to-right. If any text appears backwards/reversed, that is a FAIL — the mirror operation broke the text.' : 'Standard orientation check — does text read correctly and is it right-side up?'}

If no issues found, return empty issues array with overall_quality "pass".`

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: base64Image,
                }
              },
              { text: qaPrompt }
            ]
          }],
          generationConfig: {
            temperature: 0.1, // Low creativity — we want factual QA
            maxOutputTokens: 2048,
          }
        })
      }
    )

    if (!geminiResponse.ok) {
      console.error(`Gemini QA failed for ${panel.name}:`, await geminiResponse.text())
      // Non-blocking — if AI QA fails, pass the panel through with a warning
      issues.push({
        id: `${panel.name}-qa-unavailable`,
        panel_name: panel.name,
        check_type: 'system',
        severity: 'warning',
        message: 'AI QA check unavailable — panel passed with manual review recommended',
        customer_message: 'Automated quality check unavailable. Your panel has been flagged for manual review.',
        requires_input: false,
        details: { reason: 'gemini_api_error' }
      })
      return issues
    }

    const geminiData = await geminiResponse.json()
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || ''

    // Parse JSON from Gemini response (strip markdown fences if present)
    const cleanJson = rawText.replace(/```json\s*|```\s*/g, '').trim()
    let qaResult: any

    try {
      qaResult = JSON.parse(cleanJson)
    } catch (parseErr) {
      console.error(`Failed to parse QA response for ${panel.name}:`, cleanJson)
      return issues // Skip this panel's QA gracefully
    }

    // Convert Gemini issues to our QAIssue format
    for (const issue of (qaResult.issues || [])) {
      const isActionable = issue.severity === 'fail' || (issue.severity === 'warning' && issue.fixable_by_ai)

      issues.push({
        id: `${panel.name}-${issue.check_type}-${issues.length}`,
        panel_name: panel.name,
        check_type: issue.check_type,
        severity: issue.severity,
        message: issue.description,
        customer_message: issue.customer_description,
        requires_input: isActionable && issue.fixable_by_ai,
        options: isActionable ? ['auto_fix', 'keep_as_is'] : undefined,
        fix_cost: issue.fixable_by_ai ? (issue.fix_cost_suggestion || 9) : undefined,
        details: {
          element: issue.element,
          location: issue.location,
          fixable: issue.fixable_by_ai,
        }
      })
    }

    // Store detected elements count on the panel for the extract stage
    panel.detected_elements = qaResult.detected_elements || {}

  } catch (err) {
    console.error(`QA check failed for ${panel.name}:`, err)
    issues.push({
      id: `${panel.name}-error`,
      panel_name: panel.name,
      check_type: 'system',
      severity: 'warning',
      message: `QA check error: ${String(err)}`,
      customer_message: 'Quality check encountered an issue. Panel flagged for manual review.',
      requires_input: false,
      details: { error: String(err) }
    })
  }

  return issues
}

// ── CROSS-PANEL CONTINUITY CHECK ─────────────────────────────

async function checkContinuity(driver: any, passenger: any, apiKey: string): Promise<QAIssue[]> {
  const issues: QAIssue[] = []

  // Skip if we can't fetch both panels
  if ((!driver.signed_url && !driver.storage_path) || (!passenger.signed_url && !passenger.storage_path)) {
    return issues
  }

  try {
    // Fetch both panels
    const [driverRes, passengerRes] = await Promise.all([
      fetch(driver.signed_url || driver.storage_path),
      fetch(passenger.signed_url || passenger.storage_path),
    ])

    if (!driverRes.ok || !passengerRes.ok) return issues

    const [driverBuf, passengerBuf] = await Promise.all([
      driverRes.arrayBuffer(),
      passengerRes.arrayBuffer(),
    ])

    const driverB64 = btoa(String.fromCharCode(...new Uint8Array(driverBuf)))
    const passengerB64 = btoa(String.fromCharCode(...new Uint8Array(passengerBuf)))

    const continuityPrompt = `You are a PREFLIGHT SPECIALIST at a vinyl wrap print shop. Compare these two panels — Image 1 is the DRIVER SIDE, Image 2 is the PASSENGER SIDE of the same vehicle wrap.

The passenger side should be a MIRRORED version of the driver side. Respond ONLY with valid JSON:

{
  "same_design": true/false,
  "color_match": true/false,
  "style_match": true/false,
  "mirror_correct": true/false,
  "text_readable_both_sides": true/false,
  "issues": [
    {
      "description": "what doesn't match",
      "severity": "fail | warning",
      "location": "where the mismatch is"
    }
  ]
}

PREFLIGHT CHECKS:
1. DESIGN CONTINUITY: Do both sides look like the same wrap design? Same colors, patterns, elements?
2. MIRROR VERIFICATION: Passenger side should be horizontally mirrored. Is it properly flipped?
3. TEXT ORIENTATION: All text on BOTH sides must read left-to-right. If the passenger side has backwards text (from incorrect mirroring), that is a FAIL.
4. ELEMENT PLACEMENT: Are logos, phone numbers, and key design elements in equivalent positions on both sides?
5. COLOR CONSISTENCY: Do the colors match between both panels? Same tones, no shift?
6. SEAM ALIGNMENT: When these panels are installed, the front and rear edges meet bumpers/fenders. Do the design edges look like they'll transition cleanly?`

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: 'image/png', data: driverB64 } },
              { inlineData: { mimeType: 'image/png', data: passengerB64 } },
              { text: continuityPrompt }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
        })
      }
    )

    if (!geminiResponse.ok) return issues

    const geminiData = await geminiResponse.json()
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const cleanJson = rawText.replace(/```json\s*|```\s*/g, '').trim()

    try {
      const result = JSON.parse(cleanJson)

      // Check for design mismatch
      if (!result.same_design || !result.color_match) {
        issues.push({
          id: 'continuity-mismatch',
          panel_name: 'driver-side vs passenger-side',
          check_type: 'continuity',
          severity: 'warning',
          message: 'Driver and passenger sides may not match',
          customer_message: 'We detected a potential mismatch between your driver and passenger side designs. Would you like us to review?',
          requires_input: true,
          options: ['request_review', 'looks_fine'],
          details: result,
        })
      }

      // Check for reversed text on passenger side (mirroring broke text)
      if (result.text_readable_both_sides === false) {
        issues.push({
          id: 'mirror-text-reversed',
          panel_name: 'passenger-side',
          check_type: 'mirror_text',
          severity: 'fail',
          message: 'Passenger side has reversed/backwards text from mirroring',
          customer_message: 'The text on your passenger side appears backwards. This happens when the mirror operation flips text. Our team will fix this before printing.',
          requires_input: false,
          details: result,
        })
      }

      // Check for incorrect mirror
      if (result.mirror_correct === false) {
        issues.push({
          id: 'mirror-incorrect',
          panel_name: 'passenger-side',
          check_type: 'continuity',
          severity: 'warning',
          message: 'Passenger side may not be correctly mirrored from driver side',
          customer_message: 'The passenger side design may need adjustment to properly mirror the driver side.',
          requires_input: true,
          options: ['request_review', 'looks_fine'],
          details: result,
        })
      }

      // Add detected issues from AI
      for (const issue of (result.issues || [])) {
        issues.push({
          id: `continuity-${issues.length}`,
          panel_name: 'driver-side vs passenger-side',
          check_type: 'continuity',
          severity: issue.severity || 'warning',
          message: issue.description,
          customer_message: issue.description,
          requires_input: issue.severity === 'fail',
          details: { location: issue.location },
        })
      }
    } catch {
      // Parse fail — skip continuity check gracefully
    }

  } catch (err) {
    console.error('Continuity check error:', err)
  }

  return issues
}
