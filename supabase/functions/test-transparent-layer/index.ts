// ============================================================================
// test-transparent-layer — ISOLATED EXPERIMENT (not wired into anything)
//
// Question: can Gemini "design in layers at root" — emit a CLEAN TRANSPARENT
// element on a real alpha channel? Prediction: no (foundation models are RGB,
// not RGBA — they fake transparency with baked white or a dead grey/white
// checkerboard). This proves it with the raw pixels.
//
//   GET  see the raw file Gemini produced (open in a browser):
//     /functions/v1/test-transparent-layer?prompt=a%20simple%20cactus%20motif
//
//   GET  hard verdict on the alpha channel (JSON):
//     /functions/v1/test-transparent-layer?prompt=...&verdict=1
//
// Self-contained (no _shared imports) so it deploys as a single file.
// config.toml: verify_jwt = false.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const MODEL = "gemini-3-pro-image-preview";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getKey(): string {
  for (const name of ["GOOGLE_AI_API_KEY", "GOOGLE_AI_API_KEY_2", "GOOGLE_AI_API_KEY_3"]) {
    const k = Deno.env.get(name);
    if (k) return k;
  }
  return "";
}

function buildPrompt(element: string): string {
  return [
    `Generate a SINGLE isolated ${element} graphic, centered, on a FULLY TRANSPARENT background.`,
    `The area around the graphic must be 100% transparent (real alpha channel) —`,
    `NO white fill, NO solid background, NO grey-and-white checkerboard pattern.`,
    `Output a PNG with a genuine transparent alpha channel: only the graphic is visible,`,
    `everything else is see-through.`,
  ].join(" ");
}

async function callGemini(element: string): Promise<{ bytes: Uint8Array; mimeType: string } | { error: string }> {
  const apiKey = getKey();
  if (!apiKey) return { error: "no GOOGLE_AI_API_KEY configured" };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(element) }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "1:1" },
        },
      }),
      signal: AbortSignal.timeout(90_000),
    },
  );

  if (!resp.ok) {
    return { error: `Gemini HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}` };
  }
  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p: any) => p?.inlineData?.data);
  if (!img) {
    return { error: `no image in response (finishReason=${data?.candidates?.[0]?.finishReason || "?"})` };
  }
  const mimeType: string = img.inlineData.mimeType || "image/png";
  const bytes = Uint8Array.from(atob(img.inlineData.data), (c) => c.charCodeAt(0));
  return { bytes, mimeType };
}

async function analyze(bytes: Uint8Array, mimeType: string) {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return {
      mimeType,
      hasAlphaChannel: false,
      transparentPct: 0,
      looksCheckerboard: false,
      verdict: "NO real transparency — model returned JPEG (RGB only). Option #1 bust.",
    };
  }
  let img: any;
  try {
    img = await Image.decode(bytes);
  } catch (e) {
    return { mimeType, error: `decode failed: ${(e as Error).message}` };
  }
  const bm: Uint8Array = img.bitmap; // RGBA
  const total = Math.floor(bm.length / 4);
  let transparent = 0, nearWhite = 0, grey = 0;
  for (let i = 0; i < bm.length; i += 4) {
    const r = bm[i], g = bm[i + 1], b = bm[i + 2], a = bm[i + 3];
    if (a < 16) transparent++;
    if (a > 240 && r > 245 && g > 245 && b > 245) nearWhite++;
    if (a > 240 && Math.abs(r - g) < 8 && Math.abs(g - b) < 8 && r > 190 && r < 220) grey++;
  }
  const transparentPct = +(transparent / total).toFixed(4);
  const whitePct = +(nearWhite / total).toFixed(4);
  const greyPct = +(grey / total).toFixed(4);
  const looksCheckerboard = greyPct > 0.05 && whitePct > 0.05;

  let verdict: string;
  if (transparentPct > 0.05) {
    verdict = `REAL transparency (${(transparentPct * 100).toFixed(1)}% alpha=0). Option #1 may be viable!`;
  } else if (looksCheckerboard) {
    verdict = "NO real transparency — BAKED checkerboard (opaque grey+white tiles). Option #1 bust.";
  } else if (whitePct > 0.4) {
    verdict = "NO real transparency — solid WHITE background baked in. Option #1 bust.";
  } else {
    verdict = "NO real transparency — fully opaque RGB output. Option #1 bust.";
  }
  return { mimeType, hasAlphaChannel: true, transparentPct, whitePct, greyPct, looksCheckerboard, verdict };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const element = url.searchParams.get("prompt") || url.searchParams.get("element") || "a simple cactus motif";
    const wantVerdict = url.searchParams.get("verdict");

    const out = await callGemini(element);
    if ("error" in out) {
      return new Response(JSON.stringify({ error: out.error }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (wantVerdict) {
      const a = await analyze(out.bytes, out.mimeType);
      return new Response(JSON.stringify({ element, ...a }, null, 2), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const a = await analyze(out.bytes, out.mimeType);
    return new Response(out.bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": out.mimeType,
        "Cache-Control": "no-store",
        "X-Alpha-Verdict": (a as any).verdict || "n/a",
        "X-Transparent-Pct": String((a as any).transparentPct ?? "n/a"),
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
