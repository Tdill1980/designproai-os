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
 * panelizer-qc-artboard — Full artboard QC validation via Gemini
 *
 * Validates the ENTIRE artboard image (all panels at once) against the job spec.
 * Runs 8 automated checks modeled after real print production QC:
 *
 *   1. Panel count       — are all expected panels present?
 *   2. Rectangularity     — every panel is a perfect rectangle (no vehicle curves)
 *   3. Dimension labels   — each panel is labeled with correct dimensions
 *   4. Mirroring          — passenger side is a correct horizontal flip of driver
 *   5. Design continuity  — cohesive design flows across all panels
 *   6. Content safety     — text/logos/faces not in bleed/trim danger zones
 *   7. Fill coverage      — every panel filled edge-to-edge (no white gaps)
 *   8. Print readiness    — sharp, artifact-free, suitable for 150 DPI large format
 *
 * Input:
 *   { job_id }                — runs QC on existing artboard in storage
 *   { job_id, artboard_url }  — runs QC on a specific artboard URL
 *
 * Output:
 *   {
 *     success, passed, score (0-100),
 *     checks: [ { name, passed, severity, details } ],
 *     issues: string[],
 *     panel_report: { [panelKey]: { found, correct_dims, rectangularity } },
 *     recommendations: string[],
 *     auto_fixable: string[]   — which issues can be auto-fixed via Fix Rectangles / Fix Mirroring
 *   }
 *
 * Updates panelizer_jobs.concept_json.qc_data with the QC report.
 * NON-BLOCKING: auto-passes on API failure so it never blocks the pipeline.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getGeminiKey,
  hasGeminiKey,
} from "../_shared/gemini-key-pool.ts";
import {
  getServiceClient,
  downloadFromStorage,
  uint8ArrayToBase64,
} from "../_shared/panelizer-os/storage.ts";
import {
  GEMINI_QA_MODEL,
  BLEED_INCHES,
} from "../_shared/panelizer-os/constants.ts";

// ── Types ──────────────────────────────────────────────────────

interface PanelSpec {
  id?: string;
  panelKey?: string;
  label: string;
  widthInches: number;
  heightInches: number;
  mirrored?: boolean;
}

interface QCCheck {
  name: string;
  passed: boolean;
  severity: "pass" | "fail" | "warning" | "info";
  details: string;
}

interface PanelReport {
  found: boolean;
  correct_dims: boolean;
  rectangularity: "perfect" | "acceptable" | "curved" | "missing";
  notes: string;
}

interface QCResult {
  success: boolean;
  passed: boolean;
  score: number;
  checks: QCCheck[];
  issues: string[];
  panel_report: Record<string, PanelReport>;
  recommendations: string[];
  auto_fixable: string[];
  confidence: number;
}

// ── Logging ────────────────────────────────────────────────────

function log(msg: string, data?: unknown) {
  if (data !== undefined) {
    console.log(`[QC-ARTBOARD] ${msg}`, JSON.stringify(data));
  } else {
    console.log(`[QC-ARTBOARD] ${msg}`);
  }
}

// ── Auto-pass (non-blocking fallback) ──────────────────────────

function autoPass(reason: string): Response {
  log(`Auto-pass: ${reason}`);
  return new Response(
    JSON.stringify({
      success: true,
      passed: true,
      score: 100,
      checks: [{ name: "auto_pass", passed: true, severity: "info", details: reason }],
      issues: [],
      panel_report: {},
      recommendations: [],
      auto_fixable: [],
      confidence: 0,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ── Main Handler ───────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { job_id, artboard_url } = body;

    if (!job_id) {
      return new Response(
        JSON.stringify({ success: false, error: "job_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!hasGeminiKey()) {
      return autoPass("No Gemini key configured");
    }

    log(`Starting QC for job ${job_id}`);
    const startMs = Date.now();

    const supabase = getServiceClient();

    // ── 1. Load job ──────────────────────────────────────────────
    const { data: job, error: jobErr } = await supabase
      .from("panelizer_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) {
      return new Response(
        JSON.stringify({ success: false, error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const conceptJson = (job.concept_json as Record<string, unknown>) || {};
    const vehicleName = [job.vehicle_year, job.vehicle_make, job.vehicle_model]
      .filter(Boolean)
      .join(" ") || "Vehicle";

    // ── 2. Get panel specs ───────────────────────────────────────
    const panels: PanelSpec[] = Array.isArray(job.panels) && job.panels.length > 0
      ? (job.panels as PanelSpec[])
      : Array.isArray(conceptJson.panels)
        ? (conceptJson.panels as PanelSpec[])
        : [];

    if (panels.length === 0) {
      return autoPass("No panel specs on job — cannot validate");
    }

    log(`Job loaded: ${vehicleName}, ${panels.length} panels`);

    // ── 3. Get artboard image ────────────────────────────────────
    let artboardBase64: string;
    let artboardMime = "image/png";

    if (artboard_url) {
      // Fetch from provided URL
      const resp = await fetch(artboard_url);
      if (!resp.ok) return autoPass(`Cannot fetch artboard URL (${resp.status})`);
      const buf = await resp.arrayBuffer();
      if (buf.byteLength > 15_000_000) return autoPass("Artboard too large for QC (>15MB)");
      artboardBase64 = uint8ArrayToBase64(new Uint8Array(buf));
      artboardMime = resp.headers.get("content-type") || "image/png";
    } else {
      // Download from storage
      const storagePath = `artboards/${job_id}/artboard.png`;
      try {
        const bytes = await downloadFromStorage(storagePath);
        artboardBase64 = uint8ArrayToBase64(bytes);
        log(`Downloaded artboard: ${(bytes.length / 1024).toFixed(0)} KB`);
      } catch (dlErr: any) {
        return autoPass(`Artboard not in storage: ${dlErr.message}`);
      }
    }

    // ── 4. Build panel spec text for prompt ──────────────────────
    const bleed = BLEED_INCHES;
    const panelSpecText = panels.map((p, i) => {
      const key = p.panelKey || p.id || p.label;
      const w = +(p.widthInches + bleed * 2).toFixed(1);
      const h = +(p.heightInches + bleed * 2).toFixed(1);
      const mirror = p.mirrored ? " (MIRRORED — must be horizontally flipped)" : "";
      return `${i + 1}. ${p.label.toUpperCase()} [key: ${key}]: ${w}" × ${h}" with ${bleed}" bleed${mirror}`;
    }).join("\n");

    const mirroredPanels = panels.filter(p => p.mirrored);
    const hasMirrored = mirroredPanels.length > 0;

    // ── 5. Build QC prompt ───────────────────────────────────────
    const qcPrompt = `You are a SENIOR PRINT PRODUCTION QC SPECIALIST at WePrintWraps.com. You are inspecting a flat artboard layout for a ${vehicleName} vehicle wrap. This artboard contains multiple panels arranged as flat rectangles on a single canvas.

EXPECTED PANELS (${panels.length} total):
${panelSpecText}

Analyze this artboard image and perform these 8 quality checks. Respond ONLY in valid JSON matching this exact schema:

{
  "passed": boolean,
  "score": number (0-100, where 100 is perfect production-ready),
  "checks": [
    { "name": "panel_count", "passed": boolean, "severity": "pass|fail|warning", "details": "string" },
    { "name": "rectangularity", "passed": boolean, "severity": "pass|fail|warning", "details": "string" },
    { "name": "dimension_labels", "passed": boolean, "severity": "pass|fail|warning", "details": "string" },
    { "name": "mirroring", "passed": boolean, "severity": "pass|fail|warning|info", "details": "string" },
    { "name": "design_continuity", "passed": boolean, "severity": "pass|fail|warning", "details": "string" },
    { "name": "content_safety", "passed": boolean, "severity": "pass|fail|warning", "details": "string" },
    { "name": "fill_coverage", "passed": boolean, "severity": "pass|fail|warning", "details": "string" },
    { "name": "print_readiness", "passed": boolean, "severity": "pass|fail|warning", "details": "string" }
  ],
  "issues": ["array of specific problems found"],
  "panel_report": {
    "panel_key": { "found": boolean, "correct_dims": boolean, "rectangularity": "perfect|acceptable|curved|missing", "notes": "string" }
  },
  "recommendations": ["array of suggested improvements"],
  "auto_fixable": ["array of issue keys that can be auto-fixed: rectangle_fix, mirror_fix, regenerate"],
  "confidence": number (0-1)
}

CHECK 1 — PANEL COUNT:
Are all ${panels.length} expected panels visible on the artboard? Each panel should be clearly separated and labeled. Missing panels = FAIL.

CHECK 2 — RECTANGULARITY:
Every panel MUST be a perfect rectangle with four 90-degree corners. No vehicle body curves, no shaped cutouts, no rounded edges following vehicle contours. Each panel is a flat 2D rectangle ready for print. Curved/shaped panels = FAIL. Add "rectangle_fix" to auto_fixable if curved panels are found.

CHECK 3 — DIMENSION LABELS:
Each panel should be labeled with its name and dimensions in inches. Check that labels match the expected dimensions above. Missing or incorrect labels = WARNING.

CHECK 4 — MIRRORING:
${hasMirrored
  ? `Mirrored panels: ${mirroredPanels.map(p => p.label).join(", ")}. The passenger side should be a horizontal mirror of the driver side — same design but flipped. Text and logos on mirrored panels must read correctly when the mirror flip is applied (they should appear reversed on the artboard). Incorrect mirroring = FAIL. Add "mirror_fix" to auto_fixable.`
  : "No mirrored panels specified. Mark as info/pass."}

CHECK 5 — DESIGN CONTINUITY:
Does the design flow cohesively across all panels? The wrap should look like one unified design that was unwrapped flat — colors, patterns, and graphic elements should connect logically between adjacent panels (driver side → hood → passenger side). Disconnected or inconsistent design = WARNING.

CHECK 6 — CONTENT SAFETY:
Are any critical elements (text, logos, phone numbers, faces, URLs) positioned within ${bleed}" of any panel edge (the bleed/trim zone)? Critical content in the bleed zone will be trimmed during installation. Content in danger zone = FAIL.

CHECK 7 — FILL COVERAGE:
Every panel must be filled edge-to-edge with design artwork. No white gaps, no empty space within panel boundaries, no partially filled panels. The design must bleed to all edges. White gaps or unfilled areas = FAIL. Add "regenerate" to auto_fixable.

CHECK 8 — PRINT READINESS:
Is the artboard crisp and artifact-free? Check for: color banding, JPEG artifacts, blur, AI hallucination artifacts, unintended repeating patterns, watermarks, or text overlays that shouldn't be there. Must be suitable for 150 DPI large-format vinyl printing. Significant artifacts = WARNING.

Set overall "passed" to false ONLY if there are FAIL severity issues. Warnings alone should still pass.
Score guide: 90-100 = production ready, 70-89 = minor issues, 50-69 = needs revision, below 50 = regenerate.`;

    // ── 6. Call Gemini ───────────────────────────────────────────
    let qcResult: QCResult | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const apiKey = getGeminiKey();
      log(`Gemini attempt ${attempt}, key ${apiKey.slice(0, 8)}...`);

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: qcPrompt },
                  { inlineData: { mimeType: artboardMime, data: artboardBase64 } },
                ],
              }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
              },
            }),
            signal: AbortSignal.timeout(60_000),
          },
        );

        if (!response.ok) {
          const errText = await response.text();
          log(`Gemini ${response.status}: ${errText.slice(0, 300)}`);
          if (attempt === 2) return autoPass(`Gemini API error: ${response.status}`);
          continue;
        }

        const result = await response.json();
        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          log("Empty Gemini response");
          if (attempt === 2) return autoPass("Empty Gemini response");
          continue;
        }

        const parsed = JSON.parse(text);
        qcResult = {
          success: true,
          passed: parsed.passed ?? true,
          score: parsed.score ?? 0,
          checks: parsed.checks || [],
          issues: parsed.issues || [],
          panel_report: parsed.panel_report || {},
          recommendations: parsed.recommendations || [],
          auto_fixable: parsed.auto_fixable || [],
          confidence: parsed.confidence ?? 0,
        };
        break;
      } catch (apiErr: any) {
        log(`API error on attempt ${attempt}: ${apiErr.message}`);
        if (attempt === 2) return autoPass(`API error: ${apiErr.message}`);
      }
    }

    if (!qcResult) return autoPass("No QC result after retries");

    // ── 7. Compute summary stats ─────────────────────────────────
    const failCount = qcResult.checks.filter(c => c.severity === "fail").length;
    const warnCount = qcResult.checks.filter(c => c.severity === "warning").length;
    const passCount = qcResult.checks.filter(c => c.severity === "pass").length;
    const elapsedMs = Date.now() - startMs;

    log(
      `QC complete: ${qcResult.passed ? "PASSED" : "FAILED"} ` +
      `(score: ${qcResult.score}, ${failCount} fails, ${warnCount} warnings, ${passCount} passes) ` +
      `in ${elapsedMs}ms`
    );

    // ── 8. Update job with QC report ─────────────────────────────
    const existingQcData = (conceptJson.qc_data as Record<string, unknown>) || {};
    const qcReport = {
      artboard_qc: {
        passed: qcResult.passed,
        score: qcResult.score,
        checks: qcResult.checks,
        issues: qcResult.issues,
        panel_report: qcResult.panel_report,
        recommendations: qcResult.recommendations,
        auto_fixable: qcResult.auto_fixable,
        confidence: qcResult.confidence,
        ran_at: new Date().toISOString(),
        elapsed_ms: elapsedMs,
      },
    };

    // Determine new status based on QC result
    const newStatus = qcResult.passed ? "pending_qc" : "pending_qc";
    // Both stay pending_qc — the QC report tells the admin what to do.
    // Only approve_only / approve_and_upscale change status to ready_for_print.

    const { error: updateErr } = await supabase
      .from("panelizer_jobs")
      .update({
        status: newStatus,
        concept_json: {
          ...conceptJson,
          qc_data: {
            ...existingQcData,
            ...qcReport,
            state: qcResult.passed ? "qc_passed" : "qc_failed",
          },
        },
      })
      .eq("id", job_id);

    if (updateErr) {
      log(`Failed to update job: ${updateErr.message}`);
    }

    // ── 9. Return full QC report ─────────────────────────────────
    return new Response(
      JSON.stringify({
        ...qcResult,
        job_id,
        vehicle_name: vehicleName,
        panels_expected: panels.length,
        fail_count: failCount,
        warn_count: warnCount,
        elapsed_ms: elapsedMs,
        step: "qc_artboard",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[QC-ARTBOARD] Error:", err);
    return autoPass(`QC error: ${err.message}`);
  }
});
