/**
 * generate-native-panel — native TRUE-ASPECT flat wrap panel via tiled generation.
 *
 * The problem this solves: Gemini image gen caps at ~21:9 (2.33:1), but long
 * vehicle sides are ~4:1 (e.g. Cybertruck 224x56). Reshaping a narrower image to
 * 4:1 stretches (warp), crops, or mirrors. This generates the panel NATIVELY at
 * the true aspect by producing horizontal TILES within the model's aspect limit,
 * each CONTINUING the previous one (image-to-image), then stitching them with
 * imagescript into the exact panel aspect — no stretch, no mirror.
 *
 * Additive + opt-in: does NOT touch the locked design pipeline. Returns the
 * stitched panel URL; the existing upscaler brings it to print resolution.
 *
 * Body: { artworkUrl, sideName?, finish?, widthInches?, heightInches?,
 *         orderNumber?, tiles? }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const IMAGE_MODEL = "gemini-3-pro-image-preview";
const VISION_MODEL = "gemini-2.5-flash";

function geminiKey(): string {
  return (
    Deno.env.get("GOOGLE_AI_API_KEY") ||
    Deno.env.get("GOOGLE_AI_API_KEY_2") ||
    Deno.env.get("GOOGLE_AI_API_KEY_3") ||
    ""
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  return btoa(bin);
}

async function fetchB64(url: string): Promise<{ data: string; mime: string }> {
  const r = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`fetch source ${r.status}`);
  const mime = r.headers.get("content-type") || "image/png";
  return { data: bytesToB64(new Uint8Array(await r.arrayBuffer())), mime };
}

// ── Step A: literal description of the design ────────────────────────────────
async function describe(artworkUrl: string, side: string): Promise<string> {
  const { data, mime } = await fetchB64(artworkUrl);
  const body = {
    contents: [{
      parts: [
        { text: `Describe the ${side} vehicle-wrap artwork in this image EXACTLY as it appears — every color (hex where confident), every shape/graphic/photo, and the left-to-right layout, clearly stating which elements sit toward the FRONT of the vehicle vs the REAR. Plain exhaustive prose, no headings.` },
        { inlineData: { mimeType: mime, data } },
      ],
    }],
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${geminiKey()}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) },
  );
  const j = await r.json();
  return (j?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text).filter(Boolean).join(" ").trim();
}

// ── Step B: generate one 4:3 tile; continue from the previous tile if given ──
async function genTile(promptText: string, anchorB64: string | null): Promise<string> {
  const parts: Array<Record<string, unknown>> = [{ text: promptText }];
  if (anchorB64) parts.push({ inlineData: { mimeType: "image/png", data: anchorB64 } });
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "4:3", imageSize: "1K" },
    },
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${geminiKey()}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) },
  );
  const j = await r.json();
  const img = (j?.candidates?.[0]?.content?.parts ?? []).find(
    (p: { inlineData?: { data?: string } }) => p?.inlineData?.data,
  );
  if (!img) throw new Error(`no image from Gemini: ${JSON.stringify(j).slice(0, 300)}`);
  return img.inlineData.data as string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const {
      artworkUrl,
      sideName = "driver side",
      finish = "Gloss",
      widthInches = 224,
      heightInches = 56,
      orderNumber = "panel",
      tiles: tilesReq,
    } = body;
    if (!artworkUrl) return json({ error: "artworkUrl required" }, 400);

    const targetAspect = Number(widthInches) / Number(heightInches);
    const TILE_ASPECT = 4 / 3;
    const nTiles = Math.max(2, Math.min(4, tilesReq || Math.round(targetAspect / TILE_ASPECT)));

    const desc = await describe(artworkUrl, sideName);
    const base = `Flat 2D orthographic print-ready vinyl-wrap panel artwork, ${finish} finish. NO vehicle, NO studio/background, NO text or watermark — just the flat design edge-to-edge. The full ${sideName} reads left-to-right (FRONT of vehicle at the left, REAR at the right). Design: ${desc}`;
    const seg = nTiles === 3
      ? ["the FRONT third (leftmost)", "the MIDDLE third", "the REAR third (rightmost)"]
      : nTiles === 2
      ? ["the FRONT half (left)", "the REAR half (right)"]
      : Array.from({ length: nTiles }, (_, i) => `section ${i + 1} of ${nTiles} left-to-right`);

    // ── Step B: generate the tiles, uploading each immediately (keeps the
    // worker's memory flat — no giant buffers held). Stitching happens in the
    // sidecar (sharp) where there's real memory; this returns the tile URLs. ──
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const slug = sideName.replace(/\s+/g, "-");
    const tileUrls: string[] = [];
    let prevB64: string | null = null;
    for (let i = 0; i < nTiles; i++) {
      const prompt = i === 0
        ? `${base}\n\nRender ONLY ${seg[0]} of this side as a standalone flat tile at 4:3. Full bleed, tack-sharp, print quality.`
        : `Continue THIS exact flat wrap design seamlessly to the RIGHT — identical style, colors, height, horizon and flow. The next tile shows ${seg[i]}. Its LEFT edge must continue the provided image's RIGHT edge with no visible seam. 4:3 flat tile, full bleed, tack-sharp. NO vehicle, NO text.`;
      const b64 = await genTile(prompt, prevB64);
      prevB64 = b64;
      const path = `production-packs/native/${orderNumber}/${slug}_tile${i + 1}of${nTiles}.png`;
      await sb.storage.from("wrap-files").upload(path, b64ToBytes(b64), { contentType: "image/png", upsert: true });
      tileUrls.push(sb.storage.from("wrap-files").getPublicUrl(path).data.publicUrl);
    }

    return json({
      ok: true,
      tiles: nTiles,
      target_aspect: Number(targetAspect.toFixed(3)),
      tile_aspect: "4:3",
      tile_urls: tileUrls,
      note: "Stitch these left-to-right at a common height for the native true-aspect panel.",
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
