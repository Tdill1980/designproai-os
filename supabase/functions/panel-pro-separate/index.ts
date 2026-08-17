/**
 * panel-pro-separate — Layer separation for Panel Pro Extract
 *
 * Splits a flat panel into:
 *   1. BACKGROUND — text / logos / large foreground graphics removed, the
 *      surrounding design extended to fill the gap (clean edge-to-edge panel).
 *   2. OVERLAY    — those same elements (text, logos, large graphics like an
 *      eagle) isolated on a TRANSPARENT background (a transparent PNG).
 *
 * Matches the gold workflow: "Remove Eagle, fill design to edge" (background)
 * + "Remove Eagle, save as a transparent PNG" (overlay).
 *
 * A vision pre-check decides whether there are separable elements at all, so
 * plain pattern panels (e.g. a flag side) aren't split needlessly.
 *
 * POST /panel-pro-separate
 * {
 *   imageUrl: string,   // the flat panel to separate   [required]
 *   label?: string,
 *   sideKey?: string,
 *   userId?: string,
 *   jobId?: string,
 * }
 *
 * Response: { success, hasElements, elements: string[], backgroundUrl, overlayUrl }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import {
  uploadToStorage,
  getPublicUrl,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "../_shared/panelizer-os/storage.ts";
import {
  tempPath,
  GEMINI_IMAGE_MODEL,
  GEMINI_QA_MODEL,
} from "../_shared/panelizer-os/constants.ts";

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchBase64(url: string, maxWidth = 1280): Promise<string> {
  let fetchUrl = url;
  if (url.includes("/storage/v1/object/")) {
    fetchUrl = url.replace("/storage/v1/object/", "/storage/v1/render/image/") +
      `?width=${maxWidth}&resize=contain&quality=90`;
  }
  let resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(15_000) });
  if (!resp.ok && fetchUrl !== url) resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) throw new Error(`fetch failed ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))));
  }
  return btoa(binary);
}

/** Vision pre-check: are there separable text / logos / large graphics? */
async function detectElements(panelB64: string): Promise<{ has: boolean; elements: string[] }> {
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${getGeminiKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `Look at this flat vehicle-wrap panel. List the SEPARABLE foreground layers — any text/wording, logos, or large distinct graphic elements (e.g. an eagle, a mascot, a character, an emblem) that sit ON TOP of a background pattern/color. Do NOT list the background pattern itself (stripes, gradients, stars field, solid colors). Return ONLY JSON: { "has_elements": true|false, "elements": ["short label per element"] }` },
              { inlineData: { mimeType: "image/png", data: panelB64 } },
            ],
          }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!resp.ok) return { has: false, elements: [] };
    const data = await resp.json();
    const parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
    return { has: parsed?.has_elements === true, elements: Array.isArray(parsed?.elements) ? parsed.elements : [] };
  } catch {
    return { has: false, elements: [] };
  }
}

// ── True-alpha overlay extraction ────────────────────────────────────────
// The Gemini image model does NOT emit a real alpha channel, so asking it for a
// "transparent background" returns an OPAQUE image with a painted-in backdrop —
// which is why the overlay PNG was unusable as a layer. Instead we ask it to put
// the elements on a SOLID CHROMA backdrop (a color not present in the artwork),
// then key that color out to true transparency server-side.

type RGB = [number, number, number];
const CHROMA_OPTIONS: Array<{ name: string; rgb: RGB }> = [
  { name: "pure magenta (255,0,255)", rgb: [255, 0, 255] },
  { name: "pure green (0,255,0)", rgb: [0, 255, 0] },
];

/** How many sampled pixels sit near a color — used to pick the safest chroma. */
function colorPresence(img: any, [r, g, b]: RGB, tol = 100): number {
  const W = img.width, H = img.height;
  const step = Math.max(1, Math.round(Math.min(W, H) / 200));
  let hits = 0;
  for (let y = 1; y <= H; y += step) {
    for (let x = 1; x <= W; x += step) {
      const px = img.getPixelAt(x, y);
      const pr = (px >> 24) & 0xff, pg = (px >> 16) & 0xff, pb = (px >> 8) & 0xff;
      if (Math.abs(pr - r) + Math.abs(pg - g) + Math.abs(pb - b) < tol) hits++;
    }
  }
  return hits;
}

/** Pick the chroma color LEAST present in the panel (so we never key out real art). */
async function pickChroma(panelBytes: Uint8Array): Promise<{ name: string; rgb: RGB }> {
  try {
    const img = await Image.decode(panelBytes);
    let best = CHROMA_OPTIONS[0]; let bestHits = Infinity;
    for (const c of CHROMA_OPTIONS) {
      const h = colorPresence(img, c.rgb);
      if (h < bestHits) { bestHits = h; best = c; }
    }
    return best;
  } catch {
    return CHROMA_OPTIONS[0];
  }
}

/** Key a solid chroma backdrop out to transparency; returns a real RGBA PNG.
 *  De-spills the magenta fringe so text/logo edges never keep a pink halo. */
async function keyChromaToAlpha(bytes: Uint8Array, [r, g, b]: RGB, tol = 90): Promise<Uint8Array> {
  const img = await Image.decode(bytes);
  const W = img.width, H = img.height;
  // Is the keyed chroma magenta-like (high R & B, low G)? Then de-spill toward G.
  const chromaMagenta = r > g && b > g;
  for (let y = 1; y <= H; y++) {
    for (let x = 1; x <= W; x++) {
      const px = img.getPixelAt(x, y);
      let pr = (px >> 24) & 0xff, pg = (px >> 16) & 0xff, pb = (px >> 8) & 0xff;
      const pa = px & 0xff;
      const dist = Math.abs(pr - r) + Math.abs(pg - g) + Math.abs(pb - b);
      if (dist < tol) {
        img.setPixelAt(x, y, 0x00000000); // fully transparent
        continue;
      }
      let a = pa;
      let changed = false;
      if (dist < tol * 2) {
        // Soft edge — partial alpha so element borders don't get a hard cut.
        a = Math.max(0, Math.min(255, Math.round((pa * (dist - tol)) / tol)));
        changed = true;
      }
      // DE-SPILL: within the fringe band, neutralise magenta spill (R & B above G)
      // without touching genuine reds/blues/purples elsewhere in the element.
      if (chromaMagenta && dist < tol * 3 && pr > pg && pb > pg) {
        pr = Math.round(pg + (pr - pg) * 0.25);
        pb = Math.round(pg + (pb - pg) * 0.25);
        changed = true;
      }
      if (changed) img.setPixelAt(x, y, (((pr << 24) | (pg << 16) | (pb << 8) | a) >>> 0));
    }
  }
  return new Uint8Array(await img.encode()); // PNG with alpha
}

/** Run an image-generation prompt on the panel; returns base64 image or null. */
async function imageGen(panelB64: string, prompt: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${getGeminiKey()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [
              { inlineData: { mimeType: "image/png", data: panelB64 } },
              { text: prompt },
            ] }],
            // 4K (owner directive 2026-06-24 "GENERATE AT HIGH RESOLUTION"): text
            // and logos re-rendered onto the transparent overlay stay crisp at print
            // scale. Test for 256MB OOM before deploy.
            generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { imageSize: "4K" } },
          }),
          signal: AbortSignal.timeout(90_000),
        },
      );
      if (!resp.ok) { if (attempt < 2) { await new Promise((r) => setTimeout(r, 2000)); continue; } return null; }
      const data = await resp.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      for (const p of parts) if (p?.inlineData?.data) return p.inlineData.data;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!hasGeminiKey()) return jsonResponse({ error: "No GOOGLE_AI_API_KEY configured" }, 500);

    const body = await req.json();
    const imageUrl: string = body.imageUrl || "";
    const label: string = body.label || "panel";
    const sideKey: string = body.sideKey || "panel";
    const userId: string = body.userId || "anonymous";
    const jobId: string = body.jobId || `ppx-sep-${Date.now()}`;
    if (!imageUrl) return jsonResponse({ error: "imageUrl is required" }, 400);

    const start = Date.now();
    const panelB64 = await fetchBase64(imageUrl, 4096); // full-res panel so overlay text/logos separate crisply (owner directive 2026-06-24)

    // 1) Detect separable layers — skip plain pattern panels.
    const detected = await detectElements(panelB64);
    if (!detected.has) {
      console.log(`[PANEL-PRO-SEPARATE] ${label}: no separable elements`);
      return jsonResponse({ success: true, hasElements: false, elements: [], backgroundUrl: null, overlayUrl: null, ms: Date.now() - start });
    }
    const elementList = detected.elements.join(", ") || "text, logos, and large graphic elements";
    console.log(`[PANEL-PRO-SEPARATE] ${label}: elements = ${elementList}`);

    // 2) Background — remove the elements, extend the design to fill the gap.
    const bgPrompt =
      `This is a flat vehicle-wrap panel. Remove these foreground elements: ${elementList} (and any text or logos). ` +
      `Extend the surrounding background pattern/design seamlessly to fill where they were, edge-to-edge. ` +
      `Keep the background design exactly the same everywhere else. Output a clean flat panel with NO text, NO logos, NO foreground emblems — background design only.`;

    // 3) Overlay — isolate the elements on a SOLID CHROMA backdrop (Gemini can't
    //    emit real alpha), then key that color out to true transparency below.
    const chroma = await pickChroma(base64ToUint8Array(panelB64));
    const ovPrompt =
      `This is a flat vehicle-wrap panel. Output ONLY these foreground elements: ${elementList} (plus any text or logos), ` +
      `in their original position, colors, and size. Replace the ENTIRE rest of the image — the whole background pattern/color — ` +
      `with a single SOLID FLAT ${chroma.name} fill behind the elements. The backdrop must be that one exact flat color edge-to-edge, ` +
      `with nothing else on it, so only the elements stand out against it. Do NOT recolor or restyle the elements themselves.`;

    const [bgB64, ovB64] = await Promise.all([
      imageGen(panelB64, bgPrompt),
      imageGen(panelB64, ovPrompt),
    ]);

    let backgroundUrl: string | null = null;
    let overlayUrl: string | null = null;

    if (bgB64) {
      const p = tempPath(userId, jobId, `panel-pro-${sideKey}-background-${Date.now()}`);
      await uploadToStorage(p, base64ToUint8Array(bgB64), "image/png");
      backgroundUrl = getPublicUrl(p);
    }
    if (ovB64) {
      // Key the chroma backdrop out → a genuinely transparent overlay PNG.
      let overlayBytes = base64ToUint8Array(ovB64);
      try {
        overlayBytes = await keyChromaToAlpha(overlayBytes, chroma.rgb);
        console.log(`[PANEL-PRO-SEPARATE] ${label}: keyed ${chroma.name} → transparent overlay`);
      } catch (e) {
        console.warn(`[PANEL-PRO-SEPARATE] ${label}: chroma key failed, using raw overlay`, e);
      }
      const p = tempPath(userId, jobId, `panel-pro-${sideKey}-overlay-${Date.now()}`);
      await uploadToStorage(p, overlayBytes, "image/png");
      overlayUrl = getPublicUrl(p);
    }

    console.log(`[PANEL-PRO-SEPARATE] ${label}: done in ${Date.now() - start}ms (bg=${!!backgroundUrl} overlay=${!!overlayUrl})`);

    return jsonResponse({
      success: true,
      hasElements: true,
      elements: detected.elements,
      backgroundUrl,
      overlayUrl,
      ms: Date.now() - start,
    });
  } catch (err: any) {
    console.error("[PANEL-PRO-SEPARATE] Error:", err);
    return jsonResponse({ error: err?.message || "separation failed" }, 500);
  }
});
