/**
 * generate-flat-panel-from-file
 *
 * Takes ONE source image of a vehicle that already has a wrap on it (a 3D
 * render or photo) and reproduces the wrap from a SPECIFIC side of that
 * vehicle as a flat printable panel — 16:9, edge-to-edge, no vehicle body.
 *
 * FIDELITY-LOCKED: this function does NOT add creative variation. It
 * extracts the wrap that's actually visible on the requested side of the
 * source render and flattens it. The frontend calls this 6 times — once
 * per side (driver, passenger, hood, roof, front, rear) — to build a
 * panel set that exactly matches the source vehicle.
 *
 * Inputs:
 *   referenceImageUrl   — public URL of the source wrapped-vehicle image
 *   panelSide?          — "driver" | "passenger" | "hood" | "roof" | "front" | "rear"
 *                         (drives which area of the source to extract)
 *   userPrompt?         — optional revision notes (used by Revise flow)
 *   variationIndex?     — kept for API compat; no longer drives drift
 *   category            — "restyle" | "commercial"
 *   finish              — "Gloss" | "Satin" | "Matte"
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

// 10%-scale print convention (matches _shared/panelizer-os/constants.ts):
// pixels = inches × (PRINT_DPI 1500 × OUTPUT_SCALE 0.10) = inches × 150.
const PPI = 150;
const BLEED_INCHES = 2;            // 2" exterior print bleed on every edge
const MAX_MEGAPIXELS = 4;          // edge-worker memory ceiling
const SOURCE_FETCH_WIDTH = 3000;   // downscale the proof on fetch so decode fits memory

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── GENIE before/after teaching examples ───────────────────────────
// These pairs show 3D wrapped vehicles next to the corresponding flat
// panel artwork — exactly the transformation we need Gemini to perform
// on the user's uploaded image. Same set used by panelizer-step-fill.
const GENIE_EXAMPLE_PATHS = [
  "genie-examples/07-3d-to-flat-dragon-livery.jpg",
  "genie-examples/08-3d-to-flat-shark-mouth.jpg",
  "genie-examples/10-3d-to-flat-orange-van.jpg",
  "genie-examples/11-3d-to-flat-captain-america.jpg",
  "genie-examples/13-golden-flat-panel-sipco.jpg",
];

let _cachedExamples: Array<{ base64: string; mime: string }> | null = null;

// ── Per-side targeting ─────────────────────────────────────────────
// Tells Gemini WHICH region of the source render to extract. The output
// is the wrap visible on that ONE side, flattened — not a reinterpretation,
// not a variation. Each side produces a distinct panel because each side
// of the source vehicle has different artwork.
const SIDE_TARGETING: Record<string, { label: string; locator: string }> = {
  driver: {
    label: "Driver Side",
    locator: "the LEFT side of the vehicle (driver door, driver fender, driver quarter panel, driver rocker)",
  },
  passenger: {
    label: "Passenger Side",
    locator: "the RIGHT side of the vehicle (passenger door, passenger fender, passenger quarter panel, passenger rocker)",
  },
  hood: {
    label: "Hood",
    locator: "the HOOD surface (the flat top panel between the windshield and the front grille)",
  },
  roof: {
    label: "Roof",
    locator: "the ROOF surface (the flat top panel above the cabin)",
  },
  front: {
    label: "Front",
    locator: "the FRONT of the vehicle (front bumper, grille surround, front fascia visible head-on)",
  },
  rear: {
    label: "Rear",
    locator: "the REAR of the vehicle (rear bumper, tailgate, trunk, or rear fascia)",
  },
};

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function loadExampleImages(
  supabase: any,
): Promise<Array<{ base64: string; mime: string }>> {
  if (_cachedExamples) return _cachedExamples;

  const examples: Array<{ base64: string; mime: string }> = [];
  for (const path of GENIE_EXAMPLE_PATHS) {
    try {
      const { data, error } = await supabase.storage
        .from("wrap-files")
        .download(path);
      if (error || !data) {
        console.warn(`[FlatPanelFromFile] Example missing: ${path}`);
        continue;
      }
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.length > 5_000_000) {
        console.warn(`[FlatPanelFromFile] Example too large, skipping: ${path}`);
        continue;
      }
      const mime = path.endsWith(".png") ? "image/png" : "image/jpeg";
      examples.push({ base64: uint8ArrayToBase64(bytes), mime });
    } catch (err: any) {
      console.warn(`[FlatPanelFromFile] Example load failed: ${path}`, err?.message);
    }
  }

  _cachedExamples = examples;
  console.log(`[FlatPanelFromFile] Loaded ${examples.length} GENIE before/after examples`);
  return examples;
}

async function fetchReferenceImage(
  url: string,
): Promise<{ base64: string; mime: string }> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) {
    throw new Error(`Reference image fetch failed (HTTP ${resp.status})`);
  }
  const mimeHeader = resp.headers.get("content-type") || "image/png";
  const mime = mimeHeader.split(";")[0].trim() || "image/png";
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.length > 12_000_000) {
    throw new Error("Reference image is larger than 12MB");
  }
  return { base64: uint8ArrayToBase64(bytes), mime };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// PHASE 1 — deterministically ISOLATE the requested side off the 2D proof using
// its normalized bounding box, so the surgical AI pass only sees that one side.
// Memory-safe: downscaled fetch + crop only the box region (never clone the
// whole proof bitmap → no HTTP 546 OOM).
async function isolateSideFromProof(
  proofUrl: string,
  box: { x: number; y: number; w: number; h: number } | null | undefined,
): Promise<{ base64: string; mime: string }> {
  const fetchUrl = proofUrl.includes("/storage/v1/object/")
    ? proofUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") +
      (proofUrl.includes("?") ? "&" : "?") + `width=${SOURCE_FETCH_WIDTH}&quality=92`
    : proofUrl;
  let resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok && fetchUrl !== proofUrl) resp = await fetch(proofUrl, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`Proof fetch failed (HTTP ${resp.status})`);
  const proof = await Image.decode(new Uint8Array(await resp.arrayBuffer()));
  let img = proof;
  if (box && typeof box === "object") {
    const bx = Math.max(0, Math.min(1, Number(box.x) || 0));
    const by = Math.max(0, Math.min(1, Number(box.y) || 0));
    const bw = Math.max(0, Math.min(1 - bx, Number(box.w) || 1));
    const bh = Math.max(0, Math.min(1 - by, Number(box.h) || 1));
    const cx = Math.round(bx * proof.width);
    const cy = Math.round(by * proof.height);
    const cw = Math.max(1, Math.min(proof.width - cx, Math.round(bw * proof.width)));
    const ch = Math.max(1, Math.min(proof.height - cy, Math.round(bh * proof.height)));
    if (cw >= 8 && ch >= 8) {
      const out = new Image(cw, ch);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          out.setPixelAt(x + 1, y + 1, proof.getPixelAt(cx + x + 1, cy + y + 1));
        }
      }
      img = out;
    }
  }
  return { base64: uint8ArrayToBase64(new Uint8Array(await img.encode())), mime: "image/png" };
}

// PHASE 3 — scale the AI-flattened panel to the EXACT GENIE print dimensions
// (trim inches + 2" bleed) × 150 PPI, capped for edge-worker memory. Returns PNG.
async function resizeToGenieDims(base64: string, widthInches: number, heightInches: number): Promise<Uint8Array> {
  let img = await Image.decode(base64ToBytes(base64));
  if (widthInches > 0 && heightInches > 0) {
    let tW = Math.round((widthInches + BLEED_INCHES * 2) * PPI);
    let tH = Math.round((heightInches + BLEED_INCHES * 2) * PPI);
    const mp = (tW * tH) / 1_000_000;
    if (mp > MAX_MEGAPIXELS) {
      const f = Math.sqrt(MAX_MEGAPIXELS / mp);
      tW = Math.max(1, Math.round(tW * f));
      tH = Math.max(1, Math.round(tH * f));
    }
    img = img.resize(tW, tH);
  }
  // JPEG encode (not PNG): imagescript's PNG deflate of a multi-MP image spikes
  // memory enough to OOM the worker; JPEG is far lighter. These are working
  // source files (upscaled downstream), so JPEG is fine.
  return new Uint8Array(await img.encodeJPEG(90));
}

/**
 * Build multimodal parts: image-FIRST so Gemini's attention lands on the
 * source render. Teaching examples come second (format reference only).
 * Text prompt comes last. This ordering plus low temperature is the same
 * "precision edit" pattern used by panelizer-qc-edit-panel which fixed
 * drift on the QC pipeline.
 */
function buildParts(
  examples: Array<{ base64: string; mime: string }>,
  reference: { base64: string; mime: string },
  promptText: string,
  isProofSheet = false,
): any[] {
  const parts: any[] = [];

  // SOURCE FIRST — maximum attention weight on what we want to reproduce
  parts.push({
    text: isProofSheet
      ? "SOURCE PROOF SHEET — this is a multi-view design-approval proof. It contains several labeled thumbnails (Driver Side, Passenger Side, Front, Rear, Hood, Roof) of the SAME wrapped vehicle. Study the wrap's colors, motifs, typography, and layout exactly as they appear:"
      : "SOURCE VEHICLE — this is the wrapped vehicle whose wrap you must reproduce. Study its colors, motifs, typography, and layout exactly as they appear:",
  });
  parts.push({ inlineData: { mimeType: reference.mime, data: reference.base64 } });

  // Format-only teaching examples (kept brief; explicitly NOT design inspiration)
  if (examples.length > 0) {
    parts.push({
      text:
        "FORMAT REFERENCE ONLY — the next images show what a flat panel OUTPUT looks like (rectangular, edge-to-edge, no vehicle body, no perspective). Do NOT borrow any design content, colors, motifs, typography, or composition from these — they are unrelated vehicles. Use them ONLY to understand the output shape:",
    });
    for (let i = 0; i < examples.length; i++) {
      parts.push({ inlineData: { mimeType: examples[i].mime, data: examples[i].base64 } });
    }
  }

  parts.push({ text: "\n" + promptText });
  return parts;
}

// ── Main handler ────────────────────────────────────────────────────

// Closest Gemini-supported aspect ratio for a panel's true inches. Gemini only
// supports a fixed set (widest is 21:9), so a 4:1 side panel renders at 21:9 —
// far closer to its real shape than the old fixed 16:9.
const GEMINI_RATIOS: Array<[string, number]> = [
  ["1:1", 1], ["2:3", 2 / 3], ["3:2", 3 / 2], ["3:4", 3 / 4], ["4:3", 4 / 3],
  ["4:5", 4 / 5], ["5:4", 5 / 4], ["9:16", 9 / 16], ["16:9", 16 / 9], ["21:9", 21 / 9],
];
function bestGeminiAspect(w?: number, h?: number): string {
  if (!w || !h || w <= 0 || h <= 0) return "16:9";
  const target = w / h;
  let best = "16:9", diff = Infinity;
  for (const [label, r] of GEMINI_RATIOS) {
    const d = Math.abs(r - target);
    if (d < diff) { diff = d; best = label; }
  }
  return best;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      referenceImageUrl,
      panelSide,                  // NEW — "driver" | "passenger" | "hood" | "roof" | "front" | "rear"
      userPrompt = "",            // optional revision notes (Revise flow)
      variationIndex = 0,         // kept for API compat / file naming — no longer drives drift
      category = "restyle",
      finish = "Gloss",
      sourceType = "vehicle",     // "vehicle" (single wrapped vehicle) | "proof_sheet" (multi-view approval proof)
      skipPublish = false,        // when true, do NOT insert into designpanelpro_patterns (orchestrated artboard flow)
      widthInches = 0,            // panel's REAL width (GENIE) — drives output aspect + final size
      heightInches = 0,           // panel's REAL height (GENIE)
      box,                        // normalized {x,y,w,h} 0..1 — the side's bounding box on the proof
    } = body;

    // Render at the panel's TRUE aspect (closest Gemini-supported ratio) instead
    // of a fixed 16:9 — a side wrap is ~4:1, a hood ~16:9, etc. A 16:9 side panel
    // was the "wrong dimensions" bug: faithful artwork but the wrong shape.
    const panelAspect = bestGeminiAspect(widthInches, heightInches);

    if (!referenceImageUrl) {
      return new Response(
        JSON.stringify({ error: "Missing referenceImageUrl" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Auth — accept a signed-in user OR a trusted service-role call (the
    // orchestrators forward Bearer <serviceKey>, which has no end-user JWT).
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let userId: string | null = null;
    const bearer = authHeader?.replace(/^Bearer\s+/i, "").trim();
    // Trust a service-role JWT by its role claim (robust to key value/rotation),
    // or an exact env-key match.
    let isServiceRole = bearer === serviceKey;
    if (!isServiceRole && bearer && bearer.split(".").length === 3) {
      try { isServiceRole = JSON.parse(atob(bearer.split(".")[1])).role === "service_role"; } catch { /* not a jwt */ }
    }
    if (isServiceRole) {
      userId = body.userId || "service";
    } else if (authHeader) {
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await authClient.auth.getUser();
      userId = user?.id || null;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // PHASE 1 — isolate the requested side off the 2D proof (deterministic crop
    // by its bounding box). The surgical AI pass then only sees that one side,
    // so it flattens THAT side's wrap instead of guessing across the whole sheet.
    // No few-shot examples here: they add ~33MB to the request and the side is
    // already isolated, so they're unnecessary — and the memory headroom matters
    // (a 4K decode + resize + examples together OOM'd the 256MB worker, HTTP 546).
    const examples: Array<{ base64: string; mime: string }> = [];
    const reference = box
      ? await isolateSideFromProof(referenceImageUrl, box)
      : await fetchReferenceImage(referenceImageUrl);

    // Resolve which side of the source we're targeting.
    // Falls back to a generic "the visible wrap" target if no side is given,
    // so legacy callers without panelSide still work.
    const sideKey = (panelSide as string | undefined)?.toLowerCase();
    const sideTarget = sideKey && SIDE_TARGETING[sideKey] ? SIDE_TARGETING[sideKey] : null;

    // Build the prompt — fidelity-locked, no creative variation
    const isCommercial = category === "commercial";
    // If we isolated the side via its box, the reference is now a single-side
    // view (not the multi-view sheet), so use the single-vehicle flatten prompt.
    const isProofSheet = !box && sourceType === "proof_sheet";
    const flatPanelPrompt = isCommercial
      ? buildCommercialFromVehiclePrompt(userPrompt, sideTarget, finish, isProofSheet)
      : buildRestyleFromVehiclePrompt(userPrompt, sideTarget, finish, isProofSheet);

    const contentParts = buildParts(examples, reference, flatPanelPrompt, isProofSheet);

    console.log(
      `[FlatPanelFromFile] Generating ${isCommercial ? "commercial" : "restyle"} ` +
      `side=${sideTarget?.label || "auto"} (${flatPanelPrompt.length} chars, ${examples.length} examples)`,
    );

    // Deterministic design name — prefers the side label so each panel in
    // the set has a distinct, accurate name.
    const baseName = sideTarget ? sideTarget.label : "Wrap Panel";
    const designName = `${baseName} Wrap`;

    // Gemini image generation
    const MAX_ATTEMPTS = 2;
    let imageBase64: string | null = null;
    let imageMimeType = "image/png";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[FlatPanelFromFile] Attempt ${attempt}/${MAX_ATTEMPTS}`);
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getGeminiKey()}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: {
                parts: [{
                  text: "You reproduce vehicle wraps as flat 2D printable panels. When given a source image of a wrapped vehicle, you EXTRACT the wrap that is visible on the requested side and flatten it — you do NOT redesign, reinterpret, or invent. You preserve the exact colors, motifs, typography, layout, and graphic language from the source. Output is always a flat rectangular panel with the artwork edge-to-edge — never a 3D render, never a vehicle photo.",
                }],
              },
              contents: [{ role: "user", parts: contentParts }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: { aspectRatio: panelAspect, imageSize: "1K" },
                temperature: 0.15,
                topP: 0.85,
              },
            }),
            // 90s for 4K + multimodal input (5 examples + reference image).
            // 60s consistently timed out, causing every panel in the batch to
            // 500 — matches the timeout used by generate-flat-panel-from-render
            // and persona-designer-generate for the same workload.
            signal: AbortSignal.timeout(90_000),
          },
        );

        if (!response.ok) {
          console.error(`[FlatPanelFromFile] HTTP ${response.status}`);
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          return new Response(
            JSON.stringify({ error: `Generation failed (HTTP ${response.status})` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const result = await response.json();
        const parts = result.candidates?.[0]?.content?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.inlineData) {
              imageBase64 = part.inlineData.data;
              imageMimeType = part.inlineData.mimeType || "image/png";
            }
          }
        }
        if (imageBase64) {
          console.log(`[FlatPanelFromFile] Image generated on attempt ${attempt}`);
          break;
        }

        const finishReason = result.candidates?.[0]?.finishReason;
        console.warn(`[FlatPanelFromFile] No image (finishReason=${finishReason}) attempt ${attempt}`);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (err: any) {
        console.error(`[FlatPanelFromFile] Error attempt ${attempt}:`, err?.message);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "No image generated after retries" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // PHASE 3 — scale the AI-flattened panel to the EXACT GENIE print
    // dimensions (trim inches + 2" bleed) × 150 PPI, then save (PNG).
    const timestamp = Date.now();
    const fileName = `panels/from-file/${timestamp}_v${variationIndex + 1}.jpg`;
    const imageData = await resizeToGenieDims(imageBase64, Number(widthInches), Number(heightInches));

    const { error: uploadError } = await supabase.storage
      .from("wrap-files")
      .upload(fileName, imageData, { contentType: "image/jpeg", upsert: true });

    if (uploadError) {
      console.error("[FlatPanelFromFile] Upload error:", uploadError);
      return new Response(
        JSON.stringify({ error: "Failed to upload panel" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(fileName);

    // When orchestrated into a proof→artboard run we skip publishing each side
    // into RestyleLibrary — only the composed artboard is the deliverable.
    let patternRecord: { id: string } | null = null;
    if (!skipPublish) {
      const { data: rec, error: insertError } = await supabase
        .from("designpanelpro_patterns")
        .insert({
          name: designName,
          ai_generated_name: designName,
          media_url: publicUrl,
          production_file_url: publicUrl,
          clean_display_url: publicUrl,
          category: category || "restyle",
          is_active: true,
          is_curated: true,
          uploaded_by: userId === "service" ? null : userId,
        })
        .select("id")
        .single();
      if (insertError) {
        console.warn("[FlatPanelFromFile] Insert error (non-fatal):", insertError.message);
      }
      patternRecord = rec;
    }

    console.log(`[FlatPanelFromFile] Complete: "${designName}" → ${publicUrl}`);

    return new Response(
      JSON.stringify({
        panelUrl: publicUrl,
        designName,
        patternId: patternRecord?.id || null,
        success: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[FlatPanelFromFile] Error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ---------------------------------------------------------------------------
// Prompt builders — instruct Gemini to peel the wrap off the uploaded
// vehicle and produce a flat panel that matches the RestyleLibrary format.
// ---------------------------------------------------------------------------

type SideTarget = { label: string; locator: string } | null;

function buildSideTargetBlock(side: SideTarget, isProofSheet = false): string {
  if (!side) {
    return `TARGET REGION:
- Reproduce the wrap that is visible on the SOURCE ${isProofSheet ? "proof sheet" : "vehicle"} as one continuous flat panel.
- Use whichever view is most clearly visible.`;
  }
  if (isProofSheet) {
    return `TARGET REGION — extract ONLY the ${side.label} view from the proof sheet:
- The source is a multi-view proof sheet with several labeled thumbnails. Find the thumbnail labeled "${side.label}" (it shows ${side.locator}).
- Reproduce the wrap visible in THAT ONE thumbnail as a flat panel. IGNORE every other thumbnail on the sheet.
- Do NOT blend artwork from multiple thumbnails. Do NOT copy the sheet's header, footer, dimension callouts, signatures, labels, or the gray background — only the wrap artwork inside the "${side.label}" thumbnail.
- The output should look like the printed vinyl applied to the ${side.label.toLowerCase()} of this exact vehicle, photographed flat before installation.`;
  }
  return `TARGET REGION — extract ONLY this side:
- Locate ${side.locator} in the SOURCE image.
- Reproduce the wrap visible on THAT region as a flat panel.
- Do NOT include artwork from other sides of the vehicle. If you see hood art and door art in the source, ONLY the ${side.label.toLowerCase()} portion belongs in this output.
- The output should look like the printed vinyl that was applied to the ${side.label.toLowerCase()} of this exact vehicle, photographed flat before installation.`;
}

function buildRestyleFromVehiclePrompt(userPrompt: string, side: SideTarget, finish: string, isProofSheet = false): string {
  const reviseLine = userPrompt.trim()
    ? `\nRevision notes from user: "${userPrompt.trim()}" — apply this fix while keeping the rest identical to the source.\n`
    : "";

  return `EXTRACT the wrap from the SOURCE ${isProofSheet ? "design-approval proof sheet" : "vehicle image"} and reproduce it as a flat 2D printable panel. This is a FIDELITY task, not a redesign — the output must match what is actually on the vehicle.

${buildSideTargetBlock(side, isProofSheet)}

FIDELITY RULES (non-negotiable):
- The output's COLORS must match the source wrap's colors.
- The output's MOTIFS, IMAGERY, and TYPOGRAPHY must match the source wrap.
- The output's COMPOSITION (where each element sits) must match how the wrap is laid out on the targeted side.
- Do NOT invent new artwork. Do NOT change the palette. Do NOT reinterpret. Do NOT add or remove design elements unless the user revision notes below explicitly ask for it.
- If the source wrap is rainbow striped with taco art, the output is rainbow striped with the same taco art — same colors, same arrangement.
- Treat this like UNWRAPPING the printed vinyl: the curvature flattens, but every pixel of artwork stays the same.${reviseLine}

OUTPUT FORMAT:
- A single FLAT RECTANGULAR panel that fills the entire canvas edge-to-edge.
- Flat panel at the requested aspect ratio, front-on orthographic view, zero camera angle, zero 3D perspective.
- The artwork touches all four edges. NO white border, NO margin, NO background color.
- Artwork extends 2 inches past the visible panel edge on all four sides as print bleed (the bleed is filled with the same artwork, never with white).
- ABSOLUTELY NO vehicle body, NO wheels, NO windows, NO trim, NO shadows, NO photographic background in the output.
- ${finish} finish appearance.

What you are producing: the raw print-ready vinyl panel that, when wrapped onto the ${side ? side.label.toLowerCase() : "side"} of this vehicle, would produce the wrap you see in the source image.`;
}

function buildCommercialFromVehiclePrompt(userPrompt: string, side: SideTarget, finish: string, isProofSheet = false): string {
  const reviseLine = userPrompt.trim()
    ? `\nRevision notes from user: "${userPrompt.trim()}" — apply this fix while keeping the rest identical to the source.\n`
    : "";

  return `EXTRACT the branded wrap from the SOURCE ${isProofSheet ? "design-approval proof sheet" : "commercial vehicle image"} and reproduce it as a flat 2D printable panel. This is a FIDELITY task, not a redesign — the output must match the actual branding on this vehicle.

${buildSideTargetBlock(side, isProofSheet)}

FIDELITY RULES (non-negotiable):
- COMPANY NAME, LOGO, TAGLINE, PHONE NUMBER, WEBSITE, and any contact text must match the source wrap exactly. Same wording, same typography, same arrangement.
- COLORS, IMAGERY, and BACKGROUND ARTWORK must match the source.
- LAYOUT — where the logo sits, where the contact strip runs, where the imagery anchors — must match how it's laid out on the targeted side.
- Do NOT invent new branding. Do NOT change the company name. Do NOT swap fonts. Do NOT reinterpret. Do NOT add or remove elements unless the user revision notes below explicitly ask for it.
- Treat this like UNWRAPPING the printed vinyl: the curvature flattens, but every pixel of branding stays the same.${reviseLine}

OUTPUT FORMAT:
- A single FLAT RECTANGULAR panel that fills the entire canvas edge-to-edge.
- Flat panel at the requested aspect ratio, front-on orthographic view, zero camera angle, zero 3D perspective.
- The artwork touches all four edges. NO white border, NO margin, NO background color visible.
- Artwork extends 2 inches past the visible panel edge on all four sides as print bleed (the bleed is filled with the same artwork, never with white).
- ABSOLUTELY NO vehicle body, NO wheels, NO windows, NO trim, NO shadows, NO photographic background in the output.
- ${finish} finish appearance.

What you are producing: the raw print-ready vinyl panel that, when wrapped onto the ${side ? side.label.toLowerCase() : "side"} of this commercial vehicle, would produce the branded wrap you see in the source image.`;
}
