/**
 * panel-pro-flatten-side — turn the APPROVED flat master artboard into ONE
 * continuous, full-bleed flat field for a single side.
 *
 * Why this exists: the design is born as a Gemini 3D render and the only flat
 * artifact is the master ARTBOARD — a labeled MULTI-PANEL sheet. Print panels
 * were being reverse-engineered out of the 3D render (de-vehicling), which
 * reinvents the design and trips Gemini's recitation block. This function works
 * off the FLAT design instead: it isolates the requested panel from the master
 * sheet and re-renders it as one seamless continuous rectangle. No vehicle, no
 * glare, no curves — far more faithful than flattening a 3D truck, and it stays
 * consistent with the hero (both derive from the same master).
 *
 * It is NOT pixel-exact (it is still a generative pass — the only flat source we
 * have is itself AI-made), but it is faithful + consistent and it never reinvents
 * from a render. The output is sized to the side's true print aspect so the
 * deterministic slicer / bleed step can take it straight to print.
 *
 * POST /panel-pro-flatten-side
 * {
 *   masterArtboardUrl: string,   // the flat master artboard (labeled panels)  [required]
 *   sideLabel: string,           // e.g. "DRIVER SIDE" / "HOOD" / "REAR"        [required]
 *   widthInches?: number, heightInches?: number,  // true print rectangle → aspect
 *   vehicle?: string, userId?: string, jobId?: string,
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { uploadToStorage, getPublicUrl } from "../_shared/panelizer-os/storage.ts";
import { tempPath } from "../_shared/panelizer-os/constants.ts";

const MAX_W = 4096;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchImageBytes(url: string): Promise<Uint8Array> {
  // Pull through the storage image-transform so we never decode a raw 4K master
  // into the worker (same 256MB budget the rest of the pipeline respects).
  let fetchUrl = url;
  if (url.includes("/storage/v1/object/")) {
    fetchUrl = url.replace("/storage/v1/object/", "/storage/v1/render/image/") + `?width=${MAX_W}&resize=contain&quality=95`;
  }
  let r = await fetch(fetchUrl, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok && fetchUrl !== url) r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`fetch master ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Nearest Gemini-supported aspect to the side's true print rectangle, so the
// continuous field comes out at the real proportions (a wide side strip, not a
// 16:9 box). Mirrors the CLEAN_ASPECTS logic in generate-2d-proof.
const ASPECTS: Array<[string, number]> = [
  ["21:9", 21 / 9], ["16:9", 16 / 9], ["3:2", 1.5], ["4:3", 4 / 3],
  ["1:1", 1], ["3:4", 0.75], ["9:16", 9 / 16],
];
function nearestAspect(w?: number, h?: number): string {
  const r = Number(w) > 0 && Number(h) > 0 ? Number(w) / Number(h) : 0;
  if (!r) return "16:9";
  let best = Infinity, label = "16:9";
  for (const [l, rr] of ASPECTS) { const e = Math.abs(rr - r); if (e < best) { best = e; label = l; } }
  return label;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const masterArtboardUrl: string = body.masterArtboardUrl || "";
    const sideLabel: string = (body.sideLabel || "").toString().trim();
    if (!masterArtboardUrl || !sideLabel) return json({ error: "masterArtboardUrl and sideLabel required" }, 400);
    if (!hasGeminiKey()) return json({ error: "no Gemini key configured" }, 500);

    const userId: string = body.userId || "anonymous";
    const jobId: string = body.jobId || `flatten-${Date.now()}`;
    const vehicle: string = body.vehicle || "vehicle";
    const aspect = nearestAspect(body.widthInches, body.heightInches);

    const masterB64 = toBase64(await fetchImageBytes(masterArtboardUrl));

    // EDIT/ISOLATE framing — NOT "design/create" (which makes Gemini reinvent).
    // The master already contains this side's finished artwork in a labeled cell;
    // we isolate that one cell and extend it to a seamless full-bleed field.
    const prompt =
      `The attached image is an approved flat vehicle-wrap ARTBOARD for a ${vehicle} — a sheet of labeled rectangular panels, one per vehicle side. ` +
      `Take ONLY the panel labeled "${sideLabel}" and output its artwork as ONE continuous, seamless, full-bleed flat rectangle that fills the entire canvas edge to edge. ` +
      `Keep that panel's design EXACTLY — identical colors, gradients, shapes, elements, and flow. Do NOT redraw, restyle, reinvent, or add anything. ` +
      `Remove the panel label, any borders or gaps, every other panel, all text/logos, and any background sheet. ` +
      `Output the "${sideLabel}" design only, as one flat continuous field of artwork — no labels, no panels, no vehicle, no empty space.`;

    const tiers = [prompt,
      `From the attached labeled wrap artboard, isolate ONLY the "${sideLabel}" panel and fill the whole canvas with that panel's exact design as one seamless continuous rectangle. Remove labels, borders, other panels, and text. Keep the design exactly; do not reinvent.`,
      `Output only the "${sideLabel}" panel's artwork from the attached artboard as one continuous flat field filling every edge. Exact same design, no labels, no other panels.`,
    ];

    let outB64 = "";
    for (let attempt = 1; attempt <= 3 && !outB64; attempt++) {
      const tier = Math.min(attempt - 1, tiers.length - 1);
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getGeminiKey()}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [
                { text: tiers[tier] },
                { inlineData: { mimeType: "image/png", data: masterB64 } },
              ] }],
              generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: aspect, imageSize: "2K" } },
            }),
            signal: AbortSignal.timeout(120_000),
          }
        );
        if (!resp.ok) { if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
        const cr = await resp.json();
        const parts = cr.candidates?.[0]?.content?.parts;
        if (parts) for (const p of parts) { if (p.inlineData) { outB64 = p.inlineData.data; break; } }
        if (!outB64 && attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
      } catch (_e) {
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (!outB64) return json({ error: `Gemini returned no image for "${sideLabel}"` }, 502);

    const bin = atob(outB64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const safe = sideLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const path = tempPath(userId, jobId, `flatten-${safe}-${Date.now()}`);
    await uploadToStorage(path, bytes, "image/png");
    const url = getPublicUrl(path);
    return json({ success: true, url, panelUrl: url, aspect, sideLabel });
  } catch (err: any) {
    console.error("[PANEL-PRO-FLATTEN-SIDE]", err);
    return json({ error: err?.message || "flatten failed" }, 500);
  }
});
