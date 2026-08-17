/**
 * production-flow-engine — Layer separation / authoring for ProductionFlow
 *
 * Two modes, both producing three version-tracked layers + a flat pack:
 *   TRACK A  background.png   clean wrap texture/pattern (no logos/text), 2" bleed
 *   TRACK B  branding.png     transparent overlay: logos / typography / vector marks
 *   TRACK C  depth.png        transparent grayscale contour/shadow map
 *   final_pack.png            the printable flat art
 *
 * mode: "separate" (default when sourceImageUrl is given) — SPLITS an existing
 *   flat design (the RecreatePro reference artboard / 2D proof / single-side art)
 *   into its layers WITHOUT re-inventing it:
 *     background = the same design with all text+logos removed (pattern extended)
 *     branding   = ONLY the text+logos isolated on transparent
 *     depth      = generated contour map for the view
 *     final_pack = the source design itself (pixel-faithful)
 *
 * mode: "generate" — authors layers from a text brief (used when there is no
 *   source image): background→branding→depth sequential waterfall.
 *
 * Revision protection (both modes): regenerate:["background"] rebuilds only that
 * track and FREEZES branding+depth from the latest prior version.
 *
 * Self-contained (no _shared imports) so it ships in one MCP deploy.
 *  - imagescript for compositing (NOT sharp — native Node crashes in Deno/Edge).
 *  - Model LOCKED to gemini-3-pro-image-preview (Flash fallback only).
 *  - Vehicle dims from panelizer-step-validate (app's single source of truth).
 *  - GOOGLE_AI_API_KEY pool. The customer-facing 3D proof stays on the LOCKED
 *    design-panel-ai-generate — this engine never projects onto the vehicle.
 *
 * config.toml:  [functions.production-flow-engine]  verify_jwt = false
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "production-packs";
const PRIMARY_MODEL = "gemini-3-pro-image-preview";
const FALLBACK_MODEL = "gemini-3.1-flash-image-preview";
const BLEED_INCHES = 2;

type VehicleAngle = "driver" | "passenger" | "hood" | "rear" | "roof";
type Track = "background" | "branding" | "depth";
type Mode = "generate" | "separate";

interface ProductionFlowRequest {
  jobId: string;
  make: string;
  model: string;
  year: number | string;
  side: VehicleAngle;
  designPrompt?: string;     // generate mode
  sourceImageUrl?: string;   // separate mode (the flat reference/artboard/proof)
  mode?: Mode;
  regenerate?: Track[];
}

// ─── Gemini aspectRatio enum — pick nearest ───
const GEMINI_ASPECTS: Array<{ label: string; ratio: number }> = [
  { label: "21:9", ratio: 21 / 9 }, { label: "16:9", ratio: 16 / 9 },
  { label: "3:2", ratio: 3 / 2 }, { label: "4:3", ratio: 4 / 3 },
  { label: "5:4", ratio: 5 / 4 }, { label: "1:1", ratio: 1 },
  { label: "4:5", ratio: 4 / 5 }, { label: "3:4", ratio: 3 / 4 },
  { label: "2:3", ratio: 2 / 3 }, { label: "9:16", ratio: 9 / 16 },
];
function nearestGeminiAspect(w: number, h: number): string {
  if (!w || !h) return "16:9";
  const target = w / h;
  let best = GEMINI_ASPECTS[0], diff = Infinity;
  for (const a of GEMINI_ASPECTS) {
    const d = Math.abs(a.ratio - target);
    if (d < diff) { diff = d; best = a; }
  }
  return best.label;
}

// ─── Gemini key pool (round-robin) ───
const _gpool: string[] = [];
let _gloaded = false;
let _gidx = 0;
function getGeminiKey(): string {
  if (!_gloaded) {
    const primary = Deno.env.get("GOOGLE_AI_API_KEY");
    if (primary) _gpool.push(primary);
    for (let i = 2; i <= 5; i++) {
      const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`);
      if (k) _gpool.push(k);
    }
    _gloaded = true;
  }
  if (_gpool.length === 0) throw new Error("No GOOGLE_AI_API_KEY configured");
  return _gpool[_gidx++ % _gpool.length];
}

// ─── chunk-safe base64 ───
function bytesToB64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function downloadBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`download ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function resolvePanelInches(
  supabase: ReturnType<typeof createClient>,
  make: string, model: string, year: number | string, side: VehicleAngle,
): Promise<{ w: number; h: number } | null> {
  const { data, error } = await supabase.functions.invoke("panelizer-step-validate", {
    body: { vehicleMake: make, vehicleModel: model, vehicleYear: String(year), estimateOnly: true },
  });
  if (error) { console.warn(`[PFE] validate error: ${error.message}`); return null; }
  const d = (data as any)?.estimatedDimensions || {};
  const pick = (a?: number, b?: number) => (a && b ? { w: a, h: b } : null);
  switch (side) {
    case "driver":
    case "passenger": return pick(d.bodyLengthInches, d.bodyHeightInches);
    case "hood":      return pick(d.hoodWidthInches, d.hoodLengthInches);
    case "rear":      return pick(d.backWidthInches, d.backHeightInches);
    case "roof":      return pick(d.roofWidthInches, d.roofLengthInches);
    default:          return pick(d.bodyLengthInches, d.bodyHeightInches);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as ProductionFlowRequest;
    const { jobId, make, model, year, side, designPrompt, sourceImageUrl } = body;
    const mode: Mode = body.mode || (sourceImageUrl ? "separate" : "generate");

    if (!jobId || !make || !model || !year || !side) {
      return jsonResp({ success: false, error: "jobId, make, model, year, side are required" }, 400);
    }
    if (mode === "separate" && !sourceImageUrl) {
      return jsonResp({ success: false, error: "separate mode requires sourceImageUrl" }, 400);
    }
    if (mode === "generate" && !designPrompt) {
      return jsonResp({ success: false, error: "generate mode requires designPrompt" }, 400);
    }
    const isPassenger = side === "passenger";

    // ── 1. Version counter + latest prior version ──
    const { data: priorRows } = await supabase
      .from("production_flow_assets")
      .select("version, background_url, branding_url, depth_mask_url, created_at")
      .eq("job_id", jobId)
      .eq("side", side)
      .order("created_at", { ascending: false })
      .limit(1);
    const prior = (priorRows as any)?.[0] || null;
    const versionLabel = `v${(prior ? parseInt(String(prior.version).replace(/\D/g, "")) || 0 : 0) + 1}`;

    const ALL_TRACKS: Track[] = ["background", "branding", "depth"];
    const requested = Array.isArray(body.regenerate) && body.regenerate.length
      ? body.regenerate.filter((t) => ALL_TRACKS.includes(t))
      : ALL_TRACKS;
    const regen = new Set<Track>(prior ? requested : ALL_TRACKS);

    // ── 2. Real panel dimensions + 2" bleed ──
    const base = await resolvePanelInches(supabase, make, model, year, side);
    if (!base) {
      return jsonResp({ success: false, error: `Unable to resolve ${side} panel dimensions for ${year} ${make} ${model}` }, 422);
    }
    const printWidth = base.w + BLEED_INCHES * 2;
    const printHeight = base.h + BLEED_INCHES * 2;
    const totalSqFt = parseFloat(((printWidth * printHeight) / 144).toFixed(4));
    const aspect = nearestGeminiAspect(printWidth, printHeight);
    console.log(`[PFE] ${mode} ${jobId} ${side} ${versionLabel} → ${printWidth}x${printHeight} (${aspect}) regen=${[...regen]}`);

    // Source image for separate mode (pull once, reuse as the splitting input).
    const srcB64 = mode === "separate" ? bytesToB64(await downloadBytes(sourceImageUrl!)) : null;
    const srcPart = srcB64 ? [{ mimeType: "image/png", data: srcB64 }] : [];

    // ── 3. Build the three layers ──
    // SEPARATE: split the SAME artwork (no re-invention).
    // GENERATE: author from the brief (sequential waterfall).
    let bgBytes: Uint8Array;
    if (regen.has("background")) {
      if (mode === "separate") {
        // NO-HEAL (permanent): the source is the artboardClean asset — already
        // flat, logo-free artwork. Use it RAW as the background. The old AI
        // "remove text + seamlessly extend the pattern" pass was inpainting under
        // the removed logos, which SMEARED the design. Clean artboard in → clean
        // background out, pixel-for-pixel, zero AI.
        bgBytes = await downloadBytes(sourceImageUrl!);
      } else {
        bgBytes = await generateGeminiImage(
          `Flat 2D vehicle wrap background panel, edge to edge, ${aspect} layout. ` +
          `Style: ${designPrompt}. Output a clean background pattern/texture/gradient ONLY — ` +
          `NO typography, NO logos, NO vehicle, NO 3D, no perspective. Just the printable surface art.`,
          [], aspect,
        );
      }
    } else {
      bgBytes = await downloadBytes(prior.background_url);
    }

    let brandBytes: Uint8Array;
    if (regen.has("branding")) {
      if (mode === "separate") {
        // NO-INVENT (permanent, Trish 2026-07-24): the old pass fed the whole flat
        // design to Gemini and asked for "only the logos on transparent". Gemini
        // cannot losslessly subtract — it RE-DREW the entire design (pattern +
        // badge) and botched alpha, so the "transparent" region came back SOLID
        // BLACK. That is the "it invented a design when it said it separated"
        // artifact (whole wrap on a checkerboard, bottom half black). Logo
        // separation must be REAL-PIXEL, never generative (CLAUDE.md: separation is
        // extract-logo-elements → extractTransparentSlice, the client real-pixel
        // path). So the separate-mode branding layer is now an empty transparent
        // overlay — no invented design. The genuine, editable logos come from the
        // real-pixel Logo Pack, not from here.
        brandBytes = b64ToBytes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=");
      } else {
        brandBytes = await generateGeminiImage(
          `Using the supplied wrap background as the canvas, design an OVERLAY layer on a fully ` +
          `transparent background (alpha = 0 everywhere except the marks). Include only the ` +
          `typography, logo lettering, and crisp vector graphic shapes for: ${designPrompt}. ` +
          `Place them in the background's negative space. Do NOT repeat the background texture. ` +
          `Output a transparent PNG overlay, same ${aspect} layout.`,
          [{ mimeType: "image/png", data: bytesToB64(bgBytes) }], aspect,
        );
      }
    } else {
      brandBytes = await downloadBytes(prior.branding_url);
    }

    let depthBytes: Uint8Array;
    if (regen.has("depth")) {
      // Depth is a shadow-map ENHANCEMENT, not a required print layer. Running it
      // as a 3rd sequential ~40s Gemini call is what pushes this function past the
      // edge wall-clock limit (the 546 WORKER_LIMIT seen on bigger print panels).
      // Make it best-effort with a tight timeout: on slow/failed depth we ship a
      // transparent (no-shadow) layer so background+branding still complete.
      const TRANSPARENT_PNG = b64ToBytes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=");
      try {
        depthBytes = await Promise.race([
          generateGeminiImage(
            `Produce a grayscale depth/shadow map on a transparent background that models the vehicle ` +
            `body contour breaks, door seams, window cutlines and natural light falloff for the ${side} ` +
            `view of a ${year} ${make} ${model}. White = raised/lit, black = recessed/shadow. No color, ` +
            `no text. Transparent PNG, same ${aspect} layout.`,
            mode === "separate"
              ? srcPart
              : [
                  { mimeType: "image/png", data: bytesToB64(bgBytes) },
                  { mimeType: "image/png", data: bytesToB64(brandBytes) },
                ],
            aspect,
          ),
          new Promise<Uint8Array>((_, rej) => setTimeout(() => rej(new Error("depth gen timeout (best-effort skip)")), 45_000)),
        ]);
      } catch (e) {
        console.warn(`[PFE] depth skipped (${(e as Error).message}) — shipping transparent depth so the panel still completes`);
        depthBytes = TRANSPARENT_PNG;
      }
    } else {
      depthBytes = await downloadBytes(prior.depth_mask_url);
    }

    // ── 4. Flat pack ──
    // separate: the source design IS the printable flat art (pixel-faithful).
    // generate: flatten background + branding (depth stays separate).
    let finalPackBytes: Uint8Array;
    if (mode === "separate" && srcB64) {
      finalPackBytes = b64ToBytes(srcB64);
    } else {
      finalPackBytes = bgBytes;
      // Flatten branding onto the background for the convenience "final pack".
      // imagescript decodes the FULL bitmap, so a large print panel (the new
      // bigger print sizes) can allocate multiple GB and trigger 546 OOM. If
      // either layer is large, SKIP the in-edge flatten — the full-res background
      // and branding are uploaded as SEPARATE layers below, which the print files
      // use anyway, so nothing is lost.
      const FLATTEN_BYTE_CAP = 9 * 1024 * 1024; // ~9MB encoded PNG per layer
      if (bgBytes.length > FLATTEN_BYTE_CAP || brandBytes.length > FLATTEN_BYTE_CAP) {
        console.warn(`[PFE] panel too large to flatten in-edge (bg ${bgBytes.length}B, brand ${brandBytes.length}B) — using separate layers to avoid 546 OOM`);
      } else {
        try {
          const baseImg = await Image.decode(bgBytes);
          let brandImg = await Image.decode(brandBytes);
          if (brandImg.width !== baseImg.width || brandImg.height !== baseImg.height) {
            brandImg = brandImg.resize(baseImg.width, baseImg.height);
          }
          baseImg.composite(brandImg, 0, 0); // alpha-over
          finalPackBytes = await baseImg.encode();
        } catch (e) {
          console.warn(`[PFE] flatten failed, storing background as final pack: ${(e as Error).message}`);
        }
      }
    }

    // ── 5. Upload + register version row ──
    const dir = `production-flow/${jobId}/${side}_${versionLabel}`;
    const paths = {
      bg: `${dir}_background.png`, brand: `${dir}_branding.png`,
      depth: `${dir}_depth.png`, final: `${dir}_final_pack.png`,
    };
    await Promise.all([
      supabase.storage.from(BUCKET).upload(paths.bg, bgBytes, { contentType: "image/png", upsert: true }),
      supabase.storage.from(BUCKET).upload(paths.brand, brandBytes, { contentType: "image/png", upsert: true }),
      supabase.storage.from(BUCKET).upload(paths.depth, depthBytes, { contentType: "image/png", upsert: true }),
      supabase.storage.from(BUCKET).upload(paths.final, finalPackBytes, { contentType: "image/png", upsert: true }),
    ]);
    const pub = (p: string) => supabase.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;

    const { data: assetRecord, error: dbError } = await supabase
      .from("production_flow_assets")
      .insert({
        job_id: jobId, side, version: versionLabel,
        dimensions_inches: { width: printWidth, height: printHeight },
        background_url: pub(paths.bg),
        branding_url: pub(paths.brand),
        depth_mask_url: pub(paths.depth),
        final_pack_url: pub(paths.final),
        is_passenger_flipped: isPassenger,
        meta_metrics: {
          mode, total_sqft: totalSqFt, bleed_inches: BLEED_INCHES, aspect,
          regenerated_tracks: [...regen],
          frozen_from: prior ? prior.version : null,
          source_image_url: mode === "separate" ? sourceImageUrl : null,
          generated_at: new Date().toISOString(),
        },
      })
      .select()
      .single();

    if (dbError) throw dbError;
    return jsonResp({ success: true, mode, version: versionLabel, data: assetRecord });
  } catch (err) {
    console.error("[PFE] error:", err);
    return jsonResp({ success: false, error: (err as Error)?.message || "production-flow-engine failed" }, 500);
  }
});

/**
 * Generate one image layer. LOCKED primary model across the key pool, then Flash
 * fallback. responseModalities ["TEXT","IMAGE"] (["IMAGE"] alone → NO_IMAGE).
 */
async function generateGeminiImage(
  promptText: string,
  imagePayloads: Array<{ mimeType: string; data: string }>,
  aspect: string,
): Promise<Uint8Array> {
  const inlineParts = imagePayloads.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } }));
  const payload = {
    contents: [{ role: "user", parts: [...inlineParts, { text: promptText }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: aspect, imageSize: "4K" },
      temperature: 0.4,
    },
  };
  const attempts = [PRIMARY_MODEL, PRIMARY_MODEL, FALLBACK_MODEL];

  let lastErr = "no attempts ran";
  for (const model of attempts) {
    const key = getGeminiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        lastErr = `${model} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
        console.warn(`[PFE] ${lastErr}`);
        continue;
      }
      const data = await res.json();
      for (const cand of data.candidates || []) {
        for (const part of cand.content?.parts || []) {
          if (part.inlineData?.data) return b64ToBytes(part.inlineData.data);
        }
      }
      lastErr = `${model} returned no image (finishReason: ${data.candidates?.[0]?.finishReason || "unknown"})`;
      console.warn(`[PFE] ${lastErr}`);
    } catch (e) {
      lastErr = `${model} threw: ${(e as Error).message}`;
      console.warn(`[PFE] ${lastErr}`);
    }
  }
  throw new Error(`Gemini image generation failed — ${lastErr}`);
}
