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
 * panelizer-qc-edit-panel — Regenerate a single panel via Gemini
 *
 * Takes: job_id, panel_key, edit_instruction, optional reference_image
 * Returns: { success, panel_url, storage_path }
 *
 * Uses gemini-3-pro-image-preview to regenerate ONE panel only.
 * Does NOT touch other panels or the full artboard.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Inlined gemini-key-pool (MCP deploy can't resolve _shared imports) ──
const _pool: string[] = [];
let _loaded = false;
let _idx = 0;
function _loadKeys(): void {
  if (_loaded) return;
  const primary = Deno.env.get("GOOGLE_AI_API_KEY");
  if (primary) _pool.push(primary);
  for (let i = 2; i <= 5; i++) {
    const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`);
    if (k) _pool.push(k);
  }
  _loaded = true;
}
function getGeminiKey(): string {
  _loadKeys();
  if (_pool.length === 0) throw new Error("No GOOGLE_AI_API_KEY configured");
  const key = _pool[_idx % _pool.length];
  _idx++;
  return key;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3-pro-image-preview";
const GEMINI_MODEL_FALLBACK = "gemini-2.5-flash-image-preview";
const BUCKET = "wrap-files";
const BLEED = 0.5;

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function fetchImage(url: string, maxBytes = 4_194_304): Promise<{ base64: string; mime: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) { console.warn(`[EDIT-PANEL] fetchImage failed: ${resp.status} for ${url.slice(0, 80)}`); return null; }
    const buf = await resp.arrayBuffer();
    const sizeKB = (buf.byteLength / 1024).toFixed(0);
    if (buf.byteLength > maxBytes) {
      console.warn(`[EDIT-PANEL] Image too large (${sizeKB} KB > ${(maxBytes/1024).toFixed(0)} KB limit), skipping: ${url.slice(0, 80)}`);
      return null;
    }
    console.log(`[EDIT-PANEL] Fetched image: ${sizeKB} KB`);
    const bytes = new Uint8Array(buf);
    return { base64: uint8ToBase64(bytes), mime: resp.headers.get("content-type") || "image/jpeg" };
  } catch (e: any) { console.warn(`[EDIT-PANEL] fetchImage error: ${e.message}`); return null; }
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * Single call to a Gemini image model with key rotation across attempts.
 * Returns the base64 image or null if every attempt fails / no image returned.
 */
async function tryGeminiImage(
  label: string,
  model: string,
  parts: GeminiPart[],
  systemInstruction: string,
  aspectRatio: string,
  temperature: number,
  topP: number,
  maxAttempts = 2,
): Promise<string | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const currentKey = getGeminiKey();
    console.log(`[EDIT-PANEL] [${label}] ${model} attempt ${attempt}/${maxAttempts}, key ${currentKey.slice(0, 8)}...`);
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: { aspectRatio, imageSize: "4K" },
              temperature,
              topP,
            },
          }),
          signal: AbortSignal.timeout(90_000),
        },
      );
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.warn(`[EDIT-PANEL] [${label}] ${model} HTTP ${resp.status}: ${errText.slice(0, 200)}`);
        continue;
      }
      const data = await resp.json();
      for (const candidate of data.candidates || []) {
        for (const part of candidate.content?.parts || []) {
          if (part.inlineData?.data) return part.inlineData.data;
        }
      }
      const reason = data.candidates?.[0]?.finishReason;
      console.warn(`[EDIT-PANEL] [${label}] ${model} returned no image, finishReason=${reason}`);
    } catch (e: any) {
      console.warn(`[EDIT-PANEL] [${label}] ${model} threw: ${e.message}`);
    }
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { job_id, panel_key, edit_instruction, reference_image_base64, reference_image_mime } = body;

    if (!job_id || !panel_key || !edit_instruction) {
      return new Response(
        JSON.stringify({ error: "Required: job_id, panel_key, edit_instruction" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    console.log(`[EDIT-PANEL] Job ${job_id}, panel: ${panel_key}`);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Load job
    const { data: job, error: jobErr } = await sb.from("panelizer_jobs").select("*").eq("id", job_id).single();
    if (jobErr || !job) throw new Error("Job not found");

    // Find the panel
    const panels = (job.panels || []) as Array<{ id?: string; panelKey?: string; label: string; widthInches: number; heightInches: number; mirrored?: boolean }>;
    const panel = panels.find(p => (p.id || p.panelKey) === panel_key || p.label.toLowerCase().replace(/\s+/g, '_') === panel_key);
    if (!panel) throw new Error(`Panel "${panel_key}" not found in job`);

    const w = +(panel.widthInches + BLEED * 2).toFixed(1);
    const h = +(panel.heightInches + BLEED * 2).toFixed(1);
    const vehicleName = `${job.vehicle_year || ''} ${job.vehicle_make || ''} ${job.vehicle_model || ''}`.trim() || 'Vehicle';
    const cj = job.concept_json || {};
    const designDesc = cj.designDescription || cj.design_name || 'Custom vehicle wrap design';

    // Fetch the BEST matching render angle for this panel
    const PANEL_VIEW_MAP: Record<string, string[]> = {
      "driver-side": ["side", "driver-side"],
      "driver_side": ["side", "driver-side"],
      "passenger-side": ["passenger-side"],
      "passenger_side": ["passenger-side"],
      "hood": ["hood_detail", "hood", "front"],
      "rear": ["rear"],
      "front-bumper": ["front"],
      "front_bumper": ["front"],
      "rear-bumper": ["rear"],
      "rear_bumper": ["rear"],
      "roof": ["roof"],
    };

    const allViews = job.all_view_urls || cj.all_view_urls || {};
    const viewUrls: Record<string, string> = typeof allViews === "object" ? allViews : {};
    const preferredKeys = PANEL_VIEW_MAP[panel_key] || [panel_key];

    const imageParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    // ══════════════════════════════════════════════════════════════════
    //  PRECISION EDIT MODE
    //  Gemini 3 Pro Image regenerates instead of edits when it sees
    //  multi-image inputs with a 3D render for "context" — the render
    //  biases the output toward a brand-new composition. Fix:
    //    1. Fetch ONLY the base panel artwork (no 3D render context)
    //    2. Put the base image LAST so Gemini's attention lands on it
    //    3. Use minimal, directive prompt text
    //    4. Lock temperature = 0
    // ══════════════════════════════════════════════════════════════════

    let baseAttached = false;
    let baseImage: { base64: string; mime: string } | null = null;

    // Try the existing flat panel PNG first (output of a previous edit)
    const existingPanelPath = `artboards/${job_id}/panel-${panel_key}.png`;
    const { data: existingPanelSigned } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(existingPanelPath, 3600);
    if (existingPanelSigned?.signedUrl) {
      baseImage = await fetchImage(existingPanelSigned.signedUrl);
      if (baseImage) {
        console.log(`[EDIT-PANEL] Base: existing panel PNG at ${existingPanelPath}`);
        baseAttached = true;
      }
    }

    // Fallback to the full artboard if no panel PNG exists yet
    if (!baseAttached && job.artboard_url) {
      baseImage = await fetchImage(job.artboard_url);
      if (baseImage) {
        console.log(`[EDIT-PANEL] Base: full artboard (no panel PNG exists yet)`);
        baseAttached = true;
      }
    }

    // Optional: user-supplied reference image goes FIRST as inspiration
    if (reference_image_base64) {
      imageParts.push({ text: "REFERENCE — visual inspiration only, do NOT copy the composition:" });
      imageParts.push({ inlineData: { mimeType: reference_image_mime || "image/png", data: reference_image_base64 } });
    }

    // Base image goes LAST, immediately before the prompt, for max attention weight
    if (baseImage) {
      imageParts.push({
        text: baseAttached && existingPanelSigned?.signedUrl
          ? `SOURCE PANEL — this is the exact ${panel.label} panel to edit. Your output must be pixel-identical to this EXCEPT for the specific change requested below. Keep every color, shape, layout element, typography, and stylistic choice intact.`
          : `SOURCE ARTBOARD — find the ${panel.label} section in this artboard. Your output must match that section pixel-for-pixel EXCEPT for the specific change requested below.`,
      });
      imageParts.push({ inlineData: { mimeType: baseImage.mime, data: baseImage.base64 } });
    }

    // ── Minimal directive prompt. Treat this as a localized EDIT, not a
    //    regeneration. Gemini 3 Pro will regenerate the whole image if the
    //    prompt gets long, creative, or mentions "design". Keep it surgical.
    const prompt = baseAttached
      ? `EDIT the ${panel.label} panel shown above.

Change to apply: ${edit_instruction}

Rules:
- Output must be identical to the source image in every way EXCEPT the specific change above.
- Preserve every color, every shape, every layout element, every typographic choice, every stylistic decision.
- Do not redesign. Do not reinterpret. Do not add new elements unless the instruction explicitly asks for them. Do not remove elements unless the instruction explicitly asks for them.
- Output a perfect rectangle, 90° corners, flat 2D panel artwork, no vehicle curves.
- CRITICAL: Fill the ENTIRE canvas edge-to-edge with the artwork. Do NOT add any text labels, dimension labels, size strips, captions, or white bars at the top or bottom of the image. If the source image has a bottom white strip with text like "Hood 61\\" x 36\\"" or similar, REMOVE that strip entirely and extend the artwork to the full canvas edge.${panel.mirrored ? `\n- Panel is MIRRORED — flip any text/logos so they read correctly when mirror-applied.` : ``}`
      : `Create one flat rectangular panel for the ${panel.label} of a ${vehicleName}.
Design context: ${designDesc}
Instruction: ${edit_instruction}
Output: flat 2D panel, 90° corners, artwork edge-to-edge, no vehicle curves, NO text labels, NO size caption, NO white bars.${panel.mirrored ? ` Panel is MIRRORED — flip text/logos.` : ``}`;

    // Compute aspect ratio for this panel.
    // Gemini's imageConfig only accepts a fixed set of aspect ratios:
    //   1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
    // Passing unsupported ratios like "3:1" or "4:1" (which was happening for
    // bumpers at ~3.17:1) causes Gemini to return a 400/edge error and no image,
    // surfacing in the UI as the "edge fail" on bumper precision edits.
    // We clamp to 21:9 (widest supported) for any panel with ratio > ~2.1.
    const ratio = w / h;
    let aspectRatio = "16:9";
    if (ratio > 2.1) aspectRatio = "21:9";
    else if (ratio > 1.7) aspectRatio = "16:9";
    else if (ratio > 1.4) aspectRatio = "3:2";
    else if (ratio > 1.1) aspectRatio = "4:3";
    else if (ratio > 0.9) aspectRatio = "1:1";
    else if (ratio > 0.7) aspectRatio = "3:4";
    else if (ratio > 0.5) aspectRatio = "2:3";
    else aspectRatio = "9:16";

    // Minimal system instruction — long system instructions pollute Gemini's
    // attention on image edit tasks. Keep it to the essential identity + the
    // one non-negotiable rule (flat panel output).
    const fullSystemInstruction = baseAttached
      ? "You perform precision edits on flat vehicle wrap panel artwork. When given a source image and a change request, you output the source image with EXACTLY that one change applied — nothing else. You never redesign, reinterpret, or add creative variations. Output is always a flat 2D rectangular panel, never a 3D render or vehicle photo."
      : "You generate flat 2D rectangular panel artwork for vehicle wraps. Output is always a flat rectangular panel, never a 3D render or vehicle photo.";

    // Shorter system instruction for the degraded-prompt tiers. Gemini's
    // attention has a hard cap — when tier 1/2 couldn't produce an image,
    // cutting the system message down often unblocks a retry.
    const minimalSystemInstruction = "Output a flat 2D rectangular vehicle wrap panel. Never output a 3D render or vehicle photo.";

    // Minimal user prompt used by tier 3 — strips the multi-rule block so
    // Gemini sees just the change and the "keep everything else" constraint.
    const minimalPrompt = baseAttached
      ? `Apply this change to the ${panel.label} panel shown above: ${edit_instruction}. Keep every other detail identical. Output a flat rectangular panel, 90° corners, edge-to-edge artwork, no caption bar.${panel.mirrored ? " Panel is MIRRORED — flip any text/logos so they read correctly." : ""}`
      : `Flat 2D ${panel.label} panel for ${vehicleName}. ${edit_instruction}. 90° corners, edge-to-edge artwork, no caption bar.${panel.mirrored ? " Mirrored — flip text/logos." : ""}`;

    // Tier 4 payload: no source image. Reference image (if any) is kept for
    // inspiration, but the base panel is removed so Gemini falls back to
    // pure text-to-image. Lowest fidelity to the original panel but at least
    // produces a panel-shaped image the operator can accept or edit further.
    const textOnlyPrompt = `Flat 2D vehicle wrap panel for the ${panel.label} of a ${vehicleName}. Design context: ${designDesc}. Specific requirement: ${edit_instruction}. 90° corners, edge-to-edge artwork, no caption bar, no dimension labels, no vehicle curves.${panel.mirrored ? " Panel is MIRRORED — flip text/logos." : ""}`;
    const textOnlyParts: GeminiPart[] = reference_image_base64
      ? [
          { text: "REFERENCE — visual inspiration only, do NOT copy the composition:" },
          { inlineData: { mimeType: reference_image_mime || "image/png", data: reference_image_base64 } },
          { text: textOnlyPrompt },
        ]
      : [{ text: textOnlyPrompt }];

    // ── AI fallback chain ──
    // Tier 1: Gemini 3 Pro, full prompt + source image   — best fidelity
    // Tier 2: Gemini 2.5 Flash, full prompt               — model fallback
    // Tier 3: Gemini 3 Pro, minimal prompt                — prompt fallback
    // Tier 4: Gemini 3 Pro, no source image (text-only)   — last-ditch
    // If all four fail we return a 503 with a hint that the UI should surface
    // the Deterministic Editor (Konva canvas — zero AI, fully manual).
    const precisionTemp = baseAttached ? 0.0 : 0.4;
    const precisionTopP = baseAttached ? 0.1 : 0.95;
    const fullParts: GeminiPart[] = [...imageParts, { text: prompt }];

    let imageBase64: string | null = null;
    let tierUsed = 0;

    imageBase64 = await tryGeminiImage("tier1/3pro-full", GEMINI_MODEL, fullParts, fullSystemInstruction, aspectRatio, precisionTemp, precisionTopP, 3);
    if (imageBase64) tierUsed = 1;

    if (!imageBase64) {
      console.warn(`[EDIT-PANEL] Tier 1 (${GEMINI_MODEL}) failed — falling back to ${GEMINI_MODEL_FALLBACK}`);
      imageBase64 = await tryGeminiImage("tier2/flash-full", GEMINI_MODEL_FALLBACK, fullParts, fullSystemInstruction, aspectRatio, precisionTemp, precisionTopP, 2);
      if (imageBase64) tierUsed = 2;
    }

    if (!imageBase64) {
      console.warn(`[EDIT-PANEL] Tier 2 failed — retrying ${GEMINI_MODEL} with minimal prompt`);
      const minimalParts: GeminiPart[] = [...imageParts, { text: minimalPrompt }];
      imageBase64 = await tryGeminiImage("tier3/3pro-minimal", GEMINI_MODEL, minimalParts, minimalSystemInstruction, aspectRatio, 0.0, 0.1, 2);
      if (imageBase64) tierUsed = 3;
    }

    if (!imageBase64) {
      console.warn(`[EDIT-PANEL] Tier 3 failed — text-only fallback (no source panel)`);
      imageBase64 = await tryGeminiImage("tier4/3pro-textonly", GEMINI_MODEL, textOnlyParts, minimalSystemInstruction, aspectRatio, 0.4, 0.95, 2);
      if (imageBase64) tierUsed = 4;
    }

    if (!imageBase64) {
      console.error(`[EDIT-PANEL] All 4 AI fallback tiers exhausted for panel ${panel_key}`);
      return new Response(
        JSON.stringify({
          error: "AI fallback chain exhausted (tried Gemini 3 Pro full, Gemini 2.5 Flash, Gemini 3 Pro minimal, Gemini 3 Pro text-only).",
          fallback: "deterministic_editor",
          hint: "Open the Deterministic Editor below (Konva canvas, zero AI) to edit this panel manually.",
          panel_key,
          panel_label: panel.label,
        }),
        { status: 503, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    console.log(`[EDIT-PANEL] Got panel image from Gemini (tier ${tierUsed})`);

    // Upload new panel image
    const imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    const storagePath = `artboards/${job_id}/panel-${panel_key}.png`;

    const { error: uploadError } = await sb.storage.from(BUCKET).upload(storagePath, imageBytes, {
      contentType: "image/png", cacheControl: "3600", upsert: true,
    });
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: signedData } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, 3600);

    // Save to concept_json.edited_panels (append, don't overwrite other panels)
    const existingCj = job.concept_json || {};
    const editedPanels = existingCj.edited_panels || {};
    editedPanels[panel_key] = {
      storage_path: storagePath,
      edited_at: new Date().toISOString(),
      instruction: edit_instruction,
    };

    await sb.from("panelizer_jobs").update({
      concept_json: { ...existingCj, edited_panels: editedPanels },
    }).eq("id", job_id);

    console.log(`[EDIT-PANEL] Done: ${storagePath}`);

    return new Response(
      JSON.stringify({
        success: true,
        panel_url: signedData?.signedUrl || "",
        storage_path: storagePath,
        panel_key,
        panel_label: panel.label,
        tier: tierUsed,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(`[EDIT-PANEL] Error:`, err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
