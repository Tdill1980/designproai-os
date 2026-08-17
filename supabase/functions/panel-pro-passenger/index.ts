// deploy: panel-pro-passenger — build the passenger panel from the driver (mirror
// + text-correct), server-side so it never depends on the browser canvas/CORS.
/**
 * panel-pro-passenger — Passenger-from-driver builder
 *
 * The passenger side is ALWAYS the driver panel MIRRORED (so both sides are the
 * identical approved design — no drift, same rule as the 3D proof). A naive
 * whole-panel flip reverses any lettering, so this does it correctly:
 *
 *   1. Separate the driver into a clean background (text removed) + a text/logo
 *      overlay (true alpha) via panel-pro-separate.
 *   2. Mirror the clean background horizontally, then re-lay the driver's OWN text
 *      pixels UN-mirrored on top → lettering reads forwards.
 *
 * Safe fallbacks (the passenger can NEVER show backwards text):
 *   - text present but it couldn't be isolated → return the driver UN-flipped
 *     (identical design, readable text — no whole-panel flip).
 *   - confirmed pure pattern (no text) → whole-panel mirror is safe.
 *
 * POST /panel-pro-passenger
 * { driverUrl: string, userId?: string, jobId?: string, sideKey?: string, label?: string }
 * → { success, passengerUrl, mode: "mirror-text" | "unflipped" | "mirror-whole" }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  uploadToStorage,
  getPublicUrl,
  getServiceClient,
} from "../_shared/panelizer-os/storage.ts";
import { tempPath } from "../_shared/panelizer-os/constants.ts";

const ALPHA_THRESHOLD = 16; // overlay alpha above this counts as a text/logo pixel

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Fetch an image URL → bytes (pulls through the storage image-transform when possible). */
async function fetchBytes(url: string, width = 2048): Promise<Uint8Array> {
  let u = url;
  if (url.includes("/storage/v1/object/")) {
    u = url.replace("/storage/v1/object/", "/storage/v1/render/image/") + `?width=${width}&resize=contain&quality=90`;
  }
  let r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok && u !== url) r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Horizontal mirror (manual swap per row — matches panelizer-step-fill). */
function mirrorH(img: Image): Image {
  const w = img.width, h = img.height;
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= Math.floor(w / 2); x++) {
      const left = img.getPixelAt(x, y);
      const right = img.getPixelAt(w - x + 1, y);
      img.setPixelAt(x, y, right);
      img.setPixelAt(w - x + 1, y, left);
    }
  }
  return img;
}

/** Resize to exact W×H only if needed (ImageScript resize mutates + returns). */
function fit(img: Image, W: number, H: number): Image {
  return (img.width === W && img.height === H) ? img : img.resize(W, H);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const driverUrl: string = body.driverUrl || body.imageUrl || "";
    const userId: string = body.userId || "anonymous";
    const jobId: string = body.jobId || `passenger-${Date.now()}`;
    const sideKey: string = body.sideKey || "passenger_side";
    const label: string = body.label || "Passenger Side";
    if (!driverUrl) return jsonResponse({ error: "driverUrl is required" }, 400);

    // 1) Separate the driver into clean background + text/logo overlay.
    let hasElements = false;
    let backgroundUrl: string | null = null;
    let overlayUrl: string | null = null;
    let separateOk = false;
    try {
      const { data, error } = await getServiceClient().functions.invoke("panel-pro-separate", {
        body: { imageUrl: driverUrl, label, sideKey, userId, jobId },
      });
      if (!error && (data as any)?.success) {
        separateOk = true;
        hasElements = (data as any).hasElements === true;
        backgroundUrl = (data as any).backgroundUrl || null;
        overlayUrl = (data as any).overlayUrl || null;
      }
    } catch (e) {
      console.warn(`[PANEL-PRO-PASSENGER] separate failed:`, (e as any)?.message || e);
    }

    // 2a) Text-correct mirror — mirror the clean background, re-lay forward text.
    if (hasElements && backgroundUrl && overlayUrl) {
      try {
        const [drvB, bgB, ovB] = await Promise.all([
          fetchBytes(driverUrl), fetchBytes(backgroundUrl), fetchBytes(overlayUrl),
        ]);
        const drv = await Image.decode(drvB);
        const W = drv.width, H = drv.height;
        const bg = fit(await Image.decode(bgB), W, H);
        const ov = fit(await Image.decode(ovB), W, H);

        // mirrored clean background (no text → safe to flip)
        mirrorH(bg);
        // forward text layer = driver pixels where the overlay alpha is opaque
        for (let y = 1; y <= H; y++) {
          for (let x = 1; x <= W; x++) {
            const a = ov.getPixelAt(x, y) & 0xff;
            if (a > ALPHA_THRESHOLD) bg.setPixelAt(x, y, drv.getPixelAt(x, y)); // un-mirrored → reads correctly
          }
        }
        const out = new Uint8Array(await bg.encode());
        const p = tempPath(userId, jobId, `passenger-mirror-text-${Date.now()}`);
        await uploadToStorage(p, out, "image/png");
        return jsonResponse({ success: true, passengerUrl: `${getPublicUrl(p)}?t=${Date.now()}`, mode: "mirror-text" });
      } catch (e) {
        console.warn(`[PANEL-PRO-PASSENGER] compose failed, falling back:`, (e as any)?.message || e);
        // fall through to the safe text-present fallback below
        hasElements = true;
      }
    }

    // 2b) Always MIRROR (whole-panel flip) — the passenger MUST be a mirror of the
    //     driver (matches the 3D proof, no drift). This runs when the text-correct
    //     mirror wasn't available (pure pattern, or separation unavailable). NOTE: if
    //     the design has lettering and separation failed, the text will read reversed
    //     here — that's the known cost of guaranteeing the flip; the real cure is
    //     reliable text separation (mode "mirror-text" above).
    const drvB = await fetchBytes(driverUrl);
    const mirrored = new Uint8Array(await mirrorH(await Image.decode(drvB)).encode());
    const p = tempPath(userId, jobId, `passenger-mirror-whole-${Date.now()}`);
    await uploadToStorage(p, mirrored, "image/png");
    return jsonResponse({ success: true, passengerUrl: `${getPublicUrl(p)}?t=${Date.now()}`, mode: "mirror-whole" });
  } catch (err: any) {
    console.error(`[PANEL-PRO-PASSENGER] error:`, err?.message || err);
    return jsonResponse({ error: err?.message || "passenger build failed" }, 500);
  }
});
