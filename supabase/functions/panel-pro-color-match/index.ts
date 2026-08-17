// deploy-trigger: redeploy after transient 502 (no code change)
/**
 * panel-pro-color-match — Deterministic per-panel colour matching.
 *
 * The extracted panels are flattened from separately-lit 3D renders, so their
 * colours drift slightly between sides. This function locks a panel's colour
 * balance to a REFERENCE panel using a classic Reinhard-style per-channel
 * transfer (match each channel's mean + spread) — purely deterministic image
 * math, NO AI. It cannot return a render or break the flatten; it only shifts
 * colours so every panel matches.
 *
 * One panel per call (target + reference). The client picks a reference (e.g. the
 * driver panel) and calls this for each other side.
 *
 * POST /panel-pro-color-match
 * {
 *   imageUrl: string,      // the panel to colour-match            [required]
 *   referenceUrl: string,  // the panel whose colours to match to  [required]
 *   strength?: number,     // 0..1 blend (default 1 = full match)
 *   sideKey?: string, userId?: string, jobId?: string,
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
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
  let fetchUrl = url;
  if (url.includes("/storage/v1/object/")) {
    fetchUrl = url.replace("/storage/v1/object/", "/storage/v1/render/image/") + `?width=${MAX_W}&resize=contain&quality=95`;
  }
  let r = await fetch(fetchUrl, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok && fetchUrl !== url) r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Per-channel mean + std over the opaque pixels of an RGBA bitmap (sampled).
 *  saturatedOnly: skip near-neutral (gray studio / body) pixels so the stats come
 *  ONLY from the vivid wrap colours — used when the reference is a raw 3D render. */
function channelStats(bm: Uint8Array | Uint8ClampedArray, saturatedOnly = false): { mean: number[]; std: number[]; cnt: number } {
  const n = bm.length / 4;
  const step = Math.max(1, Math.floor(n / 200_000)); // sample up to ~200k px
  const sum = [0, 0, 0], sumSq = [0, 0, 0];
  let cnt = 0;
  for (let p = 0; p < n; p += step) {
    const i = p * 4;
    if (bm[i + 3] < 8) continue; // skip transparent
    if (saturatedOnly) {
      const r = bm[i], g = bm[i + 1], b = bm[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat < 0.20) continue; // skip near-neutral gray studio/body
    }
    for (let c = 0; c < 3; c++) { const v = bm[i + c]; sum[c] += v; sumSq[c] += v * v; }
    cnt++;
  }
  const safe = cnt || 1;
  const mean = sum.map((s) => s / safe);
  const std = sumSq.map((sq, c) => Math.sqrt(Math.max(1e-6, sq / safe - mean[c] * mean[c])));
  return { mean, std, cnt };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const imageUrl: string = body.imageUrl || "";
    const referenceUrl: string = body.referenceUrl || "";
    if (!imageUrl || !referenceUrl) return json({ error: "imageUrl and referenceUrl required" }, 400);
    const userId: string = body.userId || "anonymous";
    const jobId: string = body.jobId || `cm-${Date.now()}`;
    const strength = typeof body.strength === "number" ? Math.max(0, Math.min(1, body.strength)) : 1;

    // If target IS the reference, return it unchanged (no-op anchor).
    if (imageUrl === referenceUrl) return json({ success: true, url: imageUrl, panelUrl: imageUrl, unchanged: true });

    // When the reference is a raw 3D render (the truck), sample only the saturated
    // wrap pixels so the gray studio doesn't desaturate the match. Falls back to all
    // pixels if too few saturated ones are found.
    const refBm = (await Image.decode(await fetchImageBytes(referenceUrl))).bitmap;
    const refSatOnly = body.referenceSaturatedOnly === true;
    let refStats = channelStats(refBm, refSatOnly);
    if (refSatOnly && refStats.cnt < 2000) refStats = channelStats(refBm, false);

    const tgt = await Image.decode(await fetchImageBytes(imageUrl));
    const bm = tgt.bitmap;
    const tgtStats = channelStats(bm);

    // Per-channel linear map: v' = (v - tMean)*(rStd/tStd) + rMean. Clamp the
    // scale so a panel with a very different colour mix can't be wildly recoloured.
    const scale = [0, 1, 2].map((c) => {
      const s = refStats.std[c] / tgtStats.std[c];
      return Math.max(0.6, Math.min(1.6, s));
    });

    for (let i = 0; i < bm.length; i += 4) {
      if (bm[i + 3] < 8) continue;
      for (let c = 0; c < 3; c++) {
        const v = bm[i + c];
        const matched = (v - tgtStats.mean[c]) * scale[c] + refStats.mean[c];
        const nv = v + (matched - v) * strength; // blend toward match
        bm[i + c] = nv < 0 ? 0 : nv > 255 ? 255 : nv;
      }
    }

    const out = new Uint8Array(await tgt.encode());
    const path = tempPath(userId, jobId, `panel-color-match-${(body.sideKey || "panel")}-${Date.now()}`);
    await uploadToStorage(path, out, "image/png");
    const url = getPublicUrl(path);
    return json({ success: true, url, panelUrl: url });
  } catch (err: any) {
    console.error("[PANEL-PRO-COLOR-MATCH]", err);
    return json({ error: err?.message || "colour match failed" }, 500);
  }
});
