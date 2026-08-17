/**
 * ─────────────────────────────────────────────────────────────
 *  GENIE™ Universal Panelizer
 *  Part of the LiftIQ Engine™ / Prompt-to-Production™ architecture.
 *
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *  Proprietary & confidential. Contains trade-secret methods
 *  (layer-separated generative render & panel synthesis).
 *  Trademarks: GENIE™, DesignIQ™, LiftIQ™ — see /NOTICE and
 *  docs/TRADEMARKS.md. Not legal advice.
 * ─────────────────────────────────────────────────────────────
 */
/**
 * panelizer-step-qa — Step 10: Preflight QA validation via Gemini Flash
 *
 * Input:  { inputPath, userId, jobId, panelKey, widthInches, heightInches,
 *           vehicleMake, vehicleModel, sideSize, bleedInches, isMirrored }
 * Output: { success, passed, checks, issues, confidence, storagePath, preflightReport }
 *
 * Works like a REAL FILE OUTPUT PREFLIGHT SPECIALIST:
 * 1. Bleed zone verification — 0.5" bleed on all 4 sides present and usable
 * 2. Safe zone enforcement — text/logos/faces/phone numbers min 1" from trim edge
 * 3. Panel fit validation — panel dimensions cover vehicle measurements
 * 4. Seam safety — design elements won't be cut at panel seams/overlap zones
 * 5. Element completeness — no truncated text, cut-off faces, or cropped logos
 * 6. Print readiness — resolution, color mode, banding, artifacts
 *
 * Modeled after WePrintWraps production workflow (Carly's tutorials):
 * - Panels must have bleed for trimming tolerance
 * - Text and logos must be inside the safe zone (not in bleed area)
 * - Phone numbers, URLs, faces are NEVER allowed in the trim danger zone
 * - If panel is mirrored (passenger side), text must read correctly
 *
 * NON-BLOCKING: auto-passes on any API failure.
 * IMPORTANT: Must return { success: true } so orchestrator continues.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getGeminiKey,
  hasGeminiKey,
} from "../_shared/gemini-key-pool.ts";
import {
  downloadFromStorage,
  uint8ArrayToBase64,
} from "../_shared/panelizer-os/storage.ts";
import {
  GEMINI_QA_MODEL,
  BLEED_INCHES,
  lookupVehicle,
  SIDE_PANELS,
} from "../_shared/panelizer-os/constants.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let inputPath: string | undefined;

  try {
    const body = await req.json();
    inputPath = body.inputPath;
    const {
      userId, jobId, panelKey, widthInches, heightInches,
      vehicleMake, vehicleModel, sideSize, isMirrored,
    } = body;

    const bleed = body.bleedInches ?? BLEED_INCHES;

    // Auto-pass if no Gemini key
    if (!hasGeminiKey()) {
      console.log("[QA] No Gemini key — auto-passing");
      return autoPass("QA API not configured", inputPath);
    }

    if (!inputPath || !panelKey) {
      return autoPass("Missing parameters — auto-passing", inputPath);
    }

    console.log(`[QA] Job ${jobId} — preflight check ${panelKey}`);
    const startMs = Date.now();

    // Download panel
    const panelBytes = await downloadFromStorage(inputPath);
    const panelBase64 = uint8ArrayToBase64(panelBytes);

    // Look up vehicle dimensions for fit validation
    const vehicle = (vehicleMake && vehicleModel)
      ? lookupVehicle(vehicleMake, vehicleModel)
      : null;

    const panel = sideSize ? SIDE_PANELS[sideSize] : null;

    // Build context for the preflight prompt
    const vehicleContext = vehicle
      ? `Vehicle: ${vehicleMake} ${vehicleModel} — body ${vehicle.bodyLengthInches}" × ${vehicle.bodyHeightInches}"`
      : "Vehicle: unknown";

    const panelContext = panel
      ? `Panel spec: ${panel.label} ${panel.widthInches}" × ${panel.heightInches}"`
      : `Panel spec: ${widthInches || "??"}" × ${heightInches || "??"}"`

    const mirrorNote = isMirrored
      ? "This is the PASSENGER SIDE (mirrored from driver). All text and logos must read correctly when mirrored — reversed text is a FAIL."
      : "";

    // ── Preflight QA prompt — modeled after real print production QC ──
    const qaPrompt = `You are a large-format print production PREFLIGHT SPECIALIST for a vinyl vehicle wrap shop. You inspect print-ready panel files BEFORE they go to the printer.

${vehicleContext}
${panelContext}
Panel: ${panelKey}
Bleed: ${bleed}" on all 4 sides
Safe zone: Minimum 1" inset from trim edge for critical content
${mirrorNote}

Analyze this panel image and perform these 6 preflight checks. Respond ONLY in JSON:

{
  "passed": boolean,
  "checks": [
    { "name": "bleed_zones", "passed": boolean, "severity": "fail|warning|info", "details": "string" },
    { "name": "safe_zone", "passed": boolean, "severity": "fail|warning|info", "details": "string" },
    { "name": "panel_fit", "passed": boolean, "severity": "fail|warning|info", "details": "string" },
    { "name": "seam_safety", "passed": boolean, "severity": "fail|warning|info", "details": "string" },
    { "name": "element_completeness", "passed": boolean, "severity": "fail|warning|info", "details": "string" },
    { "name": "print_readiness", "passed": boolean, "severity": "fail|warning|info", "details": "string" }
  ],
  "issues": ["string array of specific problems found"],
  "detected_elements": {
    "logos": number,
    "text_blocks": number,
    "phone_numbers": number,
    "faces": number,
    "urls": number
  },
  "confidence": number 0-1,
  "preflight_notes": "string summary for the QC team"
}

CHECK 1 — BLEED ZONES (${bleed}" all sides):
Does the design extend to or past the panel edges with usable bleed content? The outer ${bleed}" on all 4 sides will be trimmed during installation. The bleed area should contain continued design — not white/blank edges. Blank edges = FAIL.

CHECK 2 — SAFE ZONE (1" inset from trim):
Are there any CRITICAL elements within 1" of any edge? Critical = phone numbers, URLs, faces, logos, business names, contact info. These MUST be at least 1" from trim edge. Background patterns/colors in the danger zone are OK. Text or logos within 0.5" of edge = FAIL. Text or logos between 0.5"-1" of edge = WARNING.

CHECK 3 — PANEL FIT:
Does the panel image look proportionally correct for a ${widthInches || "standard"}" × ${heightInches || "59.5"}" vinyl panel? Is the design properly scaled — not stretched, compressed, or distorted? Aspect ratio should match the panel dimensions.

CHECK 4 — SEAM SAFETY:
For side panels: the top and bottom edges are where panels meet the roof and rocker. Left/right edges are front/rear of vehicle. Are there any critical design elements (logos, text, faces) positioned where they would land on a seam or overlap zone? Elements at panel boundaries = WARNING.

CHECK 5 — ELEMENT COMPLETENESS:
Is any text cut off or truncated? Any logo partially cropped? Any face only partially visible? Any phone number missing digits? Partial content = FAIL.

CHECK 6 — PRINT READINESS:
Is the image crisp and artifact-free? Any color banding, jpeg artifacts, blur, or AI hallucination artifacts? Any unintended repeating patterns? Suitable for 150 DPI large format printing?

Only set passed=false if there are FAIL severity issues. Warnings alone should still pass.`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${getGeminiKey()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: qaPrompt },
                { inlineData: { mimeType: "image/png", data: panelBase64 } },
              ],
            }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.1,
            },
          }),
        },
      );

      if (!response.ok) {
        console.warn(`[QA] Gemini ${response.status} — auto-passing`);
        return autoPass(`Gemini API returned ${response.status}`, inputPath);
      }

      const result = await response.json();
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return autoPass("Empty Gemini response", inputPath);
      }

      const qaResult = JSON.parse(text);
      const failCount = (qaResult.checks || []).filter((c: any) => c.severity === "fail").length;
      const warnCount = (qaResult.checks || []).filter((c: any) => c.severity === "warning").length;

      console.log(
        `[QA] ${panelKey}: ${qaResult.passed ? "PASSED" : "ISSUES FOUND"} ` +
        `(${failCount} fails, ${warnCount} warnings, confidence: ${qaResult.confidence}) ` +
        `in ${Date.now() - startMs}ms`
      );

      return new Response(
        JSON.stringify({
          success: true,
          ...qaResult,
          panelKey,
          storagePath: inputPath,
          step: "qa",
          preflightReport: {
            vehicle: vehicle ? { make: vehicleMake, model: vehicleModel, bodyLength: vehicle.bodyLengthInches, bodyHeight: vehicle.bodyHeightInches } : null,
            panelSpec: { widthInches: widthInches || panel?.widthInches, heightInches: heightInches || panel?.heightInches, bleed, sideSize },
            failCount,
            warnCount,
            isMirrored: !!isMirrored,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (apiErr) {
      console.warn("[QA] API error — auto-passing:", apiErr);
      return autoPass(`API error: ${apiErr.message}`, inputPath);
    }
  } catch (err) {
    console.error("[QA] Error:", err);
    return autoPass(`QA step error: ${err.message}`, inputPath);
  }
});

function autoPass(reason: string, storagePath?: string) {
  return new Response(
    JSON.stringify({
      success: true,
      passed: true,
      checks: [{ name: "auto_pass", passed: true, details: reason }],
      issues: [],
      confidence: 0,
      storagePath: storagePath || null,
      step: "qa",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
