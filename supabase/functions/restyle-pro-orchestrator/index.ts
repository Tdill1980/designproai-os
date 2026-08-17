/**
 * ─────────────────────────────────────────────────────────────
 *  restyle-pro-orchestrator — STEP 1 of the Prompt-to-Production™
 *  prepress trio. The BRAIN (semantic layer).
 *
 *  © 2026 RestylePro / LoopMighty Software Development LLC.
 *
 *  Topology:
 *    [2-D Flat Proof]
 *        → restyle-pro-orchestrator   (this — Gemini Vision → spatial JSON)
 *        → restyle-pro-asset-harvester (crop + bg-remove + vectorize)
 *        → restyle-pro-prepress-assembler (deterministic 1" bleed layout)
 *
 *  This function NEVER draws the final panels. It runs a Gemini Vision pass
 *  over the approved 2-D proof and returns a strict JSON spatial map:
 *  background gradient, text layers (+ HEX), and the logo bounding box.
 *  Panel inch-dimensions come from the DETERMINISTIC vehicle DB (not the
 *  model) so a Sprinter and a Miata never get the same cut.
 * ─────────────────────────────────────────────────────────────
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  uploadToStorage,
  fetchImageBytes,
  uint8ArrayToBase64,
  getServiceClient,
  getFunctionsBaseUrl,
} from "../_shared/restyle-pro/storage.ts";
import {
  buildPanelLayout,
  buildManifests,
  mapValidatePanels,
  getGoogleAiKeys,
  jobPrefix,
  normHex,
  DEFAULT_BLEED_INCHES,
  type SpatialMap,
  type PanelSelection,
  type PanelLayout,
} from "../_shared/restyle-pro/lib.ts";

/**
 * Resolve real per-panel dimensions from panelizer-step-validate (single source
 * of truth — no heavy vehicle-DB import). Falls back to the inline layout.
 */
async function resolvePanels(
  selection: PanelSelection,
  vehicleMake: string,
  vehicleModel: string,
  vehicleYear: string,
): Promise<PanelLayout[]> {
  try {
    const resp = await fetch(`${getFunctionsBaseUrl()}/panelizer-step-validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
      body: JSON.stringify({
        vehicleMake, vehicleModel, vehicleYear,
        sideSize: selection.sideSize || "medium",
        addHood: !!selection.addHood,
        addRoof: !!(selection.roofSize && selection.roofSize !== "none"),
        roofSize: selection.roofSize || "medium",
        addFrontBumper: !!selection.addFrontBumper,
        addRearBumper: !!selection.addRearBumper,
        addRear: selection.addRear ?? true,
      }),
    });
    if (resp.ok) {
      const dims = await resp.json();
      const mapped = mapValidatePanels(dims?.panels || []);
      if (mapped.length) {
        console.log(`[RP-ORCH] panels from validate: ${mapped.map((p) => `${p.id}(${p.widthInches}x${p.heightInches})`).join(", ")}`);
        return mapped;
      }
    }
  } catch (e: any) {
    console.warn(`[RP-ORCH] validate failed, using inline layout: ${e.message}`);
  }
  return buildPanelLayout(selection, {});
}

/** Resolve the Layer-1 base-design URL for a panel (mirror of the assembler). */
function baseUrlForPanel(
  panel: PanelLayout,
  flatArtUrls: Record<string, string>,
  flatArtUrl: string | null,
): string | null {
  if (flatArtUrls[panel.id]) return flatArtUrls[panel.id];
  if (panel.role === "side") return flatArtUrls["driver-side"] || flatArtUrls["side"] || flatArtUrl || null;
  return flatArtUrls[panel.role] || null;
}

const SPATIAL_MODELS = ["gemini-2.5-flash"]; // gemini-2.0-flash fallback retired by Google

const SYSTEM_PROMPT = `You are a senior PREPRESS spatial-mapping technician at a vehicle-wrap print shop.
You receive ONE approved 2-D wrap proof image. Your only job is to read it and return a strict JSON
description of the artwork so a deterministic layout engine can rebuild it as print files — you do NOT
redesign anything. Be faithful to what you actually see.

Return ONLY JSON matching this shape (no prose, no markdown):
{
  "background": {
    "type": "linear-gradient" | "solid",
    "angleDeg": <number 0-360, 0 = left→right, 90 = top→bottom>,
    "stops": [ { "hex": "#rrggbb", "pos": <0..1> }, ... ]   // 2-4 stops, dominant background colours
  },
  "textLayers": [
    {
      "text": "<exact text as printed>",
      "hexColor": "#rrggbb",
      "fontWeight": "normal" | "bold",
      "fontStyle": "normal" | "italic",
      "relBBox": { "x": <0..1>, "y": <0..1>, "w": <0..1>, "h": <0..1> }   // relative to whole image
    }
  ],
  "logo": { "relBBox": { "x":..,"y":..,"w":..,"h":.. } } | null,
  "dominantColors": ["#rrggbb", ...],
  "finish": "gloss" | "matte" | "satin",
  "notes": "<one short sentence about the design language>"
}
Rules:
- Read text VERBATIM (brand name, tagline, phone, URL). Do not invent or correct text.
- HEX codes must be your best sample of the actual printed colour.
- relBBox is normalised 0..1 relative to the FULL image (x,y = top-left of the box).
- If there is one clear logo lockup, set "logo". Otherwise null.`;

async function visionMap(imageB64: string, mime: string, keys: string[]): Promise<SpatialMap> {
  let lastErr = "";
  for (const model of SPATIAL_MODELS) {
    for (const key of keys) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                role: "user",
                parts: [
                  { text: SYSTEM_PROMPT },
                  { inline_data: { mime_type: mime, data: imageB64 } },
                ],
              }],
              generationConfig: {
                temperature: 0.15,
                responseMimeType: "application/json",
              },
            }),
          },
        );
        if (!resp.ok) {
          lastErr = `${model} ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
          continue;
        }
        const data = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts
          ?.map((p: any) => p.text || "")
          .join("") || "";
        const json = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        const parsed = JSON.parse(json);
        return normaliseMap(parsed);
      } catch (e: any) {
        lastErr = `${model}: ${e.message}`;
      }
    }
  }
  throw new Error(`Vision spatial-map failed across all models/keys — ${lastErr}`);
}

function normaliseMap(raw: any): SpatialMap {
  const bg = raw?.background || {};
  const stops = Array.isArray(bg.stops) && bg.stops.length
    ? bg.stops.map((s: any) => ({ hex: normHex(s.hex), pos: clamp01(s.pos) }))
    : [{ hex: "#1a1a1a", pos: 0 }, { hex: "#c9a24b", pos: 1 }];
  const textLayers = Array.isArray(raw?.textLayers)
    ? raw.textLayers.filter((t: any) => t && t.text).map((t: any) => ({
        text: String(t.text),
        hexColor: normHex(t.hexColor || "#ffffff"),
        fontWeight: t.fontWeight === "bold" ? "bold" : "normal",
        fontStyle: t.fontStyle === "italic" ? "italic" : "normal",
        relBBox: relBox(t.relBBox),
      }))
    : [];
  return {
    background: {
      type: bg.type === "solid" ? "solid" : "linear-gradient",
      angleDeg: Number.isFinite(bg.angleDeg) ? Number(bg.angleDeg) : 0,
      stops,
    },
    textLayers,
    logo: raw?.logo?.relBBox ? { relBBox: relBox(raw.logo.relBBox) } : null,
    dominantColors: Array.isArray(raw?.dominantColors) ? raw.dominantColors.map(normHex) : [],
    finish: ["gloss", "matte", "satin"].includes(raw?.finish) ? raw.finish : "gloss",
    notes: String(raw?.notes || "").slice(0, 280),
  };
}

const clamp01 = (n: any) => Math.max(0, Math.min(1, Number(n) || 0));
const relBox = (b: any) => ({
  x: clamp01(b?.x), y: clamp01(b?.y),
  w: clamp01(b?.w) || 0.2, h: clamp01(b?.h) || 0.1,
});

function guessMime(url: string): string {
  const u = url.toLowerCase();
  if (u.includes(".png")) return "image/png";
  if (u.includes(".webp")) return "image/webp";
  return "image/jpeg";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startMs = Date.now();

  try {
    const body = await req.json();
    const {
      proofUrl,
      logoUrl = null,
      vehicleMake = "",
      vehicleModel = "",
      vehicleYear = "",
      selection = {} as PanelSelection,
      bleedInches = DEFAULT_BLEED_INCHES,
      jobId: jobIdIn,
      chain = true,           // run harvester + assembler automatically
      generationId = null,
      // ── Flat design artwork (what actually gets printed) ──────────
      // The per-view flat art from the 2-D Production Proof. This is the REAL
      // design Layer-1 — the assembler carries it through, it does NOT rebuild
      // it. Pass a per-view map and/or a single side art (used for both sides).
      //   flatArtUrls: { "driver-side": url, "passenger-side": url, hood, rear, roof }
      flatArtUrls = {} as Record<string, string>,
      flatArtUrl = null,      // single side artwork → both sides (passenger mirrored)
      overlayLogo = false,    // true = clean Layer-1 + re-applied editable vector logo
    } = body;

    if (!proofUrl) {
      return json({ error: "proofUrl is required" }, 400);
    }

    const jobId = jobIdIn || crypto.randomUUID().split("-")[0];
    const keys = getGoogleAiKeys();
    if (keys.length === 0) throw new Error("No GOOGLE_AI_API_KEY configured");

    console.log(`[RP-ORCH] job ${jobId} — ${vehicleYear} ${vehicleMake} ${vehicleModel}`);

    // ── 1. Deterministic panel inch-layout (from validate, NOT the model) ──
    const panels = await resolvePanels(selection, vehicleMake, vehicleModel, vehicleYear);
    console.log(`[RP-ORCH] ${panels.length} panels resolved`);

    // ── 2. Vision spatial map over the 2-D proof ─────────────────────
    const proofBytes = await fetchImageBytes(proofUrl);
    const spatialMap = await visionMap(uint8ArrayToBase64(proofBytes), guessMime(proofUrl), keys);
    console.log(`[RP-ORCH] spatial map: ${spatialMap.textLayers.length} text layers, logo=${!!spatialMap.logo}, bg=${spatialMap.background.type}`);

    // Lean per-panel manifest (the blueprint Edge-1 → Edge-2/3).
    const manifests = buildManifests(jobId, panels, spatialMap, bleedInches,
      (p) => baseUrlForPanel(p, flatArtUrls, flatArtUrl));

    // ── 3. Persist the map (storage + panelizer_jobs.concept_json) ───
    const mapPath = `${jobPrefix(jobId)}/spatial-map.json`;
    const payload = {
      jobId,
      vehicle: { make: vehicleMake, model: vehicleModel, year: vehicleYear },
      proofUrl,
      logoUrl,
      flatArtUrls,
      flatArtUrl,
      overlayLogo,
      bleedInches,
      panels,
      manifests,
      spatialMap,
      generatedAt: new Date().toISOString(),
    };
    await uploadToStorage(mapPath, new TextEncoder().encode(JSON.stringify(payload, null, 2)), "application/json");

    if (jobIdIn) {
      try {
        const sc = getServiceClient();
        const { data: existing } = await sc.from("panelizer_jobs")
          .select("concept_json").eq("id", jobId).single();
        await sc.from("panelizer_jobs").update({
          concept_json: { ...(existing?.concept_json || {}), restyle_spatial: payload },
        }).eq("id", jobId);
      } catch (e: any) {
        console.warn(`[RP-ORCH] concept_json persist skipped: ${e.message}`);
      }
    }

    // ── 4. Chain: harvester → assembler ──────────────────────────────
    let harvest: any = null;
    let assembly: any = null;
    if (chain) {
      const base = getFunctionsBaseUrl();
      const svc = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`;

      // Harvester is OPTIONAL (it only matters in clean-overlay mode). Never let
      // it break the main base-design → assembler path.
      try {
        const hResp = await fetch(`${base}/restyle-pro-asset-harvester`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: svc },
          body: JSON.stringify({ jobId, proofUrl, logoUrl, spatialMap }),
        });
        if (hResp.ok) harvest = await hResp.json();
        else console.warn(`[RP-ORCH] asset-harvester non-fatal (${hResp.status}) — continuing without vector assets`);
      } catch (e: any) {
        console.warn(`[RP-ORCH] asset-harvester unavailable (${e.message}) — continuing`);
      }

      const aResp = await fetch(`${base}/restyle-pro-prepress-assembler`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: svc },
        body: JSON.stringify({
          jobId, panels, spatialMap, bleedInches,
          assets: harvest?.assets || [],
          flatArtUrls, flatArtUrl, overlayLogo,
          vehicle: { make: vehicleMake, model: vehicleModel, year: vehicleYear },
          designName: body.designName || "Untitled",
        }),
      });
      if (!aResp.ok) throw new Error(`prepress-assembler failed (${aResp.status}): ${(await aResp.text()).slice(0, 300)}`);
      assembly = await aResp.json();
    }

    const totalMs = Date.now() - startMs;
    console.log(`[RP-ORCH] done in ${(totalMs / 1000).toFixed(1)}s`);

    const haveArt = Object.keys(flatArtUrls).length > 0 || !!flatArtUrl;
    const warnings: string[] = [];
    if (chain && !haveArt) {
      warnings.push("No flatArtUrls/flatArtUrl supplied — panels were reconstructed from a gradient (DEGRADED). To replicate the actual design, pass the per-view flat artwork from the 2-D Production Proof as flatArtUrls.");
    }

    return json({
      success: true,
      jobId,
      generationId,
      spatialMapPath: mapPath,
      panels,
      manifests,
      spatialMap,
      harvest,
      assembly,
      designFaithful: assembly ? assembly.designFaithful : null,
      warnings,
      timing: { totalMs },
    }, 200);
  } catch (err: any) {
    console.error(`[RP-ORCH] ERROR (${Date.now() - startMs}ms):`, err);
    return json({ error: `restyle-pro-orchestrator failed: ${err.message}` }, 500);
  }
});

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
