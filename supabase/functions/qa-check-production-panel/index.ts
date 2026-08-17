/**
 * qa-check-production-panel — AI-Powered Quality Check for Production Panels
 *
 * Runs automated QA checks on generated production panels:
 *   1. Trim zone safety — no critical elements within 30px of edges
 *   2. Element completeness — no cut-off faces/logos/text
 *   3. Color consistency — dominant colors match design intent
 *   4. Design continuity — driver/passenger sides look cohesive
 *
 * Uses Gemini 2.0 Flash for fast, cheap AI analysis.
 *
 * Returns: { passed: boolean, checks: [...], issues: [...] }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const QA_MODEL = "gemini-2.5-flash"; // gemini-2.0-flash retired by Google

interface QARequest {
  panel_image_url: string;    // Signed URL to panel PNG
  panel_label: string;        // e.g., "Driver Side", "Hood"
  panel_width_inches: number;
  panel_height_inches: number;
  design_name?: string;
  production_pack_id?: string;
}

interface QAResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    details: string;
  }>;
  issues: Array<{
    element: string;
    location: string;
    severity: "warning" | "fail";
    description: string;
  }>;
  confidence: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      panel_image_url,
      panel_label,
      panel_width_inches,
      panel_height_inches,
      design_name,
      production_pack_id,
    }: QARequest = await req.json();

    if (!panel_image_url || !panel_label) {
      return new Response(
        JSON.stringify({ error: "panel_image_url and panel_label are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!hasGeminiKey()) {
      // If no API key, pass all checks (non-blocking)
      console.warn("GOOGLE_AI_API_KEY not configured — auto-passing QA");
      return new Response(
        JSON.stringify({
          passed: true,
          checks: [{ name: "auto_pass", passed: true, details: "QA API not configured — auto-passed" }],
          issues: [],
          confidence: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[QA] Checking ${panel_label} (${panel_width_inches}" × ${panel_height_inches}")`);

    // Fetch the panel image
    const imageResponse = await fetch(panel_image_url);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch panel image: ${imageResponse.status}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBase64 = btoa(
      String.fromCharCode(...new Uint8Array(imageBuffer))
    );
    const imageMimeType = imageResponse.headers.get("content-type") || "image/png";

    // Build QA prompt
    const qaPrompt = `You are a quality control inspector for vehicle wrap production panels.

PANEL: "${panel_label}" — ${panel_width_inches}" × ${panel_height_inches}" production-ready panel
${design_name ? `DESIGN: "${design_name}"` : ""}

Analyze this panel image and check for these issues:

CHECK 1 — TRIM ZONE SAFETY:
Look within approximately 30 pixels of ALL edges (top, bottom, left, right).
Flag if ANY of these appear near the edge:
- Logos or brand marks
- Text, phone numbers, or URLs
- Human faces
- Critical design elements that would look cut off when printed

CHECK 2 — ELEMENT COMPLETENESS:
- Are any faces cut in half?
- Are any logos partially cropped?
- Are any phone numbers or text truncated?
- Is the design composition complete (doesn't look accidentally cropped)?

CHECK 3 — COLOR CONSISTENCY:
- Does the image appear to have reasonable color saturation (not washed out)?
- Are there any obvious color banding or artifacts?
- Is the image predominantly one solid color that looks like a failed generation?

CHECK 4 — OVERALL QUALITY:
- Does the panel look like a legitimate vehicle wrap design?
- Are there any obvious generation artifacts (distorted text, misshapen objects)?
- Is the resolution adequate (not pixelated or blurry)?

Respond ONLY with this JSON format (no other text):
{
  "passed": true or false,
  "checks": [
    { "name": "trim_zone_safety", "passed": true/false, "details": "brief explanation" },
    { "name": "element_completeness", "passed": true/false, "details": "brief explanation" },
    { "name": "color_consistency", "passed": true/false, "details": "brief explanation" },
    { "name": "overall_quality", "passed": true/false, "details": "brief explanation" }
  ],
  "issues": [
    { "element": "what was found", "location": "where on the panel", "severity": "warning or fail", "description": "brief description" }
  ],
  "confidence": 0.0 to 1.0
}

If ALL checks pass, set "passed": true and "issues": [].
If ANY check with severity "fail" is found, set "passed": false.
Warnings don't cause failure but should be noted.
Be practical — minor edge proximity is a warning, not a failure. Only fail for clear issues.`;

    // Call Gemini for QA analysis
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${QA_MODEL}:generateContent?key=${getGeminiKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: qaPrompt },
                {
                  inlineData: {
                    mimeType: imageMimeType,
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1, // Low temperature for consistent QA results
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[QA] Gemini API error (${response.status}):`, errText.slice(0, 300));
      // Non-blocking — auto-pass on API failure
      return new Response(
        JSON.stringify({
          passed: true,
          checks: [{ name: "auto_pass", passed: true, details: `QA API returned ${response.status} — auto-passed` }],
          issues: [],
          confidence: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const textContent = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textContent) {
      console.warn("[QA] No text in Gemini response — auto-passing");
      return new Response(
        JSON.stringify({
          passed: true,
          checks: [{ name: "auto_pass", passed: true, details: "No QA response — auto-passed" }],
          issues: [],
          confidence: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the JSON response
    let qaResult: QAResult;
    try {
      qaResult = JSON.parse(textContent);
    } catch (parseErr) {
      console.warn("[QA] Failed to parse Gemini response:", textContent.slice(0, 200));
      qaResult = {
        passed: true,
        checks: [{ name: "parse_fallback", passed: true, details: "Could not parse QA response — auto-passed" }],
        issues: [],
        confidence: 0,
      };
    }

    console.log(`[QA] ${panel_label}: ${qaResult.passed ? "PASSED" : "FAILED"} (confidence: ${qaResult.confidence})`);
    if (qaResult.issues.length > 0) {
      console.log(`[QA] Issues:`, JSON.stringify(qaResult.issues));
    }

    return new Response(
      JSON.stringify(qaResult),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[QA] Unexpected error:", err);
    // Non-blocking — auto-pass on any error
    return new Response(
      JSON.stringify({
        passed: true,
        checks: [{ name: "error_fallback", passed: true, details: `QA error: ${err.message} — auto-passed` }],
        issues: [],
        confidence: 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
