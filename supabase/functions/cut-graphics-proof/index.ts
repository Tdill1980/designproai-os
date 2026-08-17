/**
 * cut-graphics-proof — Cut Graphics Proof (spec) generator
 *
 * Phase 3a of the GraphicsPro cut-graphics pipeline.
 *
 * Given a wrap design image (the driver-side view) and the REAL vehicle side
 * dimensions resolved by the GENIE Universal Panelizer, this asks Gemini to
 * spec every distinct cut graphic — overall printed width x height, and for
 * text the capital LETTER HEIGHT — in inches, using the side panel as the
 * known reference scale.
 *
 * It returns STRUCTURED data only (no image). The frontend renders the
 * dimensioned proof sheet + plotter-height (59") nesting preview and the
 * "letters < 2" -> contact us prior to ordering" warning.
 *
 * Deterministic post-processing (fit/flag math) happens here so the proof is
 * consistent regardless of how the model phrases things.
 *
 * Required secrets: GOOGLE_AI_API_KEY (+ optional _2.._5 pool).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Below this real cap-height, cut vinyl letters get fragile to weed/apply —
// the WPW rule is to flag them for manual review before ordering.
const MIN_LETTER_HEIGHT_INCHES = 2;

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))),
    );
  }
  return btoa(binary);
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

interface ProofElement {
  label: string;
  type: "text" | "logo" | "graphic" | "stripe";
  text?: string | null;
  widthInches: number;
  heightInches: number;
  letterHeightInches: number | null;
  // Derived server-side:
  fitsPlotter: boolean;       // smallest dimension <= plotter max height
  belowMinLetter: boolean;    // text whose letters are < 2"
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      renderUrl,
      sideWidthInches,
      sideHeightInches,
      plotterMaxHeightInches = 59,
      designName,
      vehicleYear,
      vehicleMake,
      vehicleModel,
    } = body || {};

    if (!renderUrl) {
      return new Response(
        JSON.stringify({ success: false, error: "renderUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sideW = num(sideWidthInches);
    const sideH = num(sideHeightInches);
    if (!sideW || !sideH) {
      // Without a real reference scale every dimension would be a guess.
      return new Response(
        JSON.stringify({
          success: false,
          error: "Vehicle side dimensions are required. Resolve GENIE vehicle dimensions first.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ success: false, error: "Gemini API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const plotterMax = num(plotterMaxHeightInches) || 59;
    const vehicleStr = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ");

    // --- Fetch the design image ---
    // Pull it DOWNSCALED through the Supabase image-transform endpoint. The hero
    // render is a 4K PNG; fetching it full-size and base64-ing it into the Gemini
    // request bloats memory (546 OOM) and slows the call past timeout. 1280px is
    // plenty for the model to read the graphics/letters. Falls back to the raw URL
    // for non-Supabase images.
    let fetchUrl = renderUrl;
    if (typeof renderUrl === "string" && renderUrl.includes("/storage/v1/object/public/")) {
      // 2048px (not 1280) so Gemini can actually READ the cut graphics — logos,
      // phone numbers, taglines. At 1280 the lettering blurred and it reported a
      // bare "color-change wrap" with no graphics. Still well under the 4K decode
      // that caused the worker OOM.
      fetchUrl = renderUrl.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/")
        + (renderUrl.includes("?") ? "&" : "?") + "width=2048&height=2048&resize=contain";
    }
    let imgRes = await fetch(fetchUrl, {
      headers: { "User-Agent": "Deno/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    // If the transform endpoint rejects it, retry the raw original once.
    if (!imgRes.ok && fetchUrl !== renderUrl) {
      imgRes = await fetch(renderUrl, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(20_000) });
    }
    if (!imgRes.ok) {
      return new Response(
        JSON.stringify({ success: false, error: `Failed to fetch design image: HTTP ${imgRes.status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const mimeType = imgRes.headers.get("content-type") || "image/png";
    const base64 = uint8ArrayToBase64(new Uint8Array(await imgRes.arrayBuffer()));

    // --- Gemini: spec each graphic in inches against the known side scale ---
    const prompt = `You are a vehicle-wrap production estimator. This image shows the DRIVER SIDE of a ${vehicleStr || "vehicle"} wrap.

KNOWN REFERENCE SCALE: the driver side measures ${sideW}" wide x ${sideH}" tall. Use this to estimate the REAL printed size of each cut graphic by visual proportion to the body.

Identify EVERY distinct piece of branding and artwork on the wrap — every company name, wordmark, phone number, website, tagline, slogan, logo, mascot, emblem, number, and any bold stripe or accent graphic. Treat visible text and logos as graphics EVEN IF they look like part of a printed or full-color artistic wrap — list each one so it can be specced to size. Ignore only the bare painted body panels, windows, glass, wheels, and reflections.

For EACH element return:
- label: short descriptive name (e.g. "Company Name", "Phone Number", "Door Logo", "Rocker Stripe")
- type: one of "text", "logo", "graphic", "stripe"
- text: the literal text if type is "text", otherwise null
- widthInches: overall printed width in inches (number)
- heightInches: overall printed height in inches (number)
- letterHeightInches: for "text", the capital LETTER height in inches (number); otherwise null

Output ONLY a JSON array, no prose. Only output [] if the wrap is a completely blank solid color with NO text, logos, wordmarks, numbers, or graphics of any kind — if you can read ANY text or see ANY logo/emblem, it MUST be listed.
Example: [{"label":"Company Name","type":"text","text":"ACME PLUMBING","widthInches":48,"heightInches":9,"letterHeightInches":6}]`;

    const requestBody = JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ],
      }],
      // temperature 0: this is an extraction task — sampling variance was making
      // the same image sometimes return [] (false "color-change wrap").
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2048, temperature: 0 },
    });

    const tryParse = (s: string): any => { try { return JSON.parse(s); } catch { return null; } };

    // One Gemini pass. Joins the text of ALL candidate parts — Gemini frequently
    // splits output across multiple parts; reading only parts[0] dropped the JSON
    // in later parts and produced false "no cut graphics".
    const askGemini = async (): Promise<
      { httpError: { status: number; detail: string } } | { parsed: any[] | null; raw: string }
    > => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
          signal: AbortSignal.timeout(45_000),
        },
      );
      if (!res.ok) {
        let detail = "";
        try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
        return { httpError: { status: res.status, detail } };
      }
      const result = await res.json();
      const raw = (result.candidates?.[0]?.content?.parts ?? [])
        .map((p: any) => p?.text ?? "")
        .join("");
      // Robust parse: Gemini often wraps the JSON in ```json fences or adds a line
      // of prose even with responseMimeType=json. Try raw → de-fenced → first [...]
      // array slice before giving up, so a cosmetic wrapper can't fail the proof.
      let parsed: any =
        tryParse(raw) ??
        tryParse(raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim());
      if (parsed == null) {
        const m = raw.match(/\[[\s\S]*\]/);
        if (m) parsed = tryParse(m[0]);
      }
      // A bare object (single element) is acceptable — wrap it.
      if (parsed && !Array.isArray(parsed)) parsed = [parsed];
      return { parsed: Array.isArray(parsed) ? parsed : null, raw };
    };

    let attempt = await askGemini();
    if ("httpError" in attempt) {
      return new Response(
        JSON.stringify({ success: false, error: `Gemini analysis failed: HTTP ${attempt.httpError.status}${attempt.httpError.detail ? ` — ${attempt.httpError.detail}` : ""}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // The image fetched fine, so zero elements on a wrap render is far more likely
    // a model miss than a truly blank vehicle — re-ask ONCE before returning an
    // empty proof. Retry only fires on the zero case, so added latency is bounded.
    if (!attempt.parsed || attempt.parsed.length === 0) {
      console.warn(
        "[cut-graphics-proof] first pass yielded zero elements, retrying once. raw:",
        attempt.raw.slice(0, 200),
      );
      const second = await askGemini();
      if (!("httpError" in second) && second.parsed && second.parsed.length > 0) {
        attempt = second;
      }
    }
    // Anything still unparseable is treated as "no cut graphics found" rather
    // than a hard 502.
    if (attempt.parsed == null) {
      console.warn("[cut-graphics-proof] unparseable Gemini output:", attempt.raw.slice(0, 200));
    }
    const parsed: any[] = attempt.parsed ?? [];

    // --- Deterministic clean-up + fit/flag math ---
    const elements: ProofElement[] = [];
    for (const e of Array.isArray(parsed) ? parsed : []) {
      const w = num(e?.widthInches);
      const h = num(e?.heightInches);
      if (!w || !h) continue;
      const type: ProofElement["type"] =
        e?.type === "logo" || e?.type === "graphic" || e?.type === "stripe" ? e.type : "text";
      const letterH = type === "text" ? num(e?.letterHeightInches) : null;
      const minDim = Math.min(w, h);
      elements.push({
        label: String(e?.label || "Graphic").slice(0, 80),
        type,
        text: type === "text" ? (e?.text ? String(e.text).slice(0, 200) : null) : null,
        widthInches: Math.round(w * 10) / 10,
        heightInches: Math.round(h * 10) / 10,
        letterHeightInches: letterH != null ? Math.round(letterH * 10) / 10 : null,
        // A piece fits the plotter if it can be oriented so its SMALLER side
        // is within the 59" media — the larger side runs down the roll length.
        fitsPlotter: minDim <= plotterMax,
        belowMinLetter: type === "text" && letterH != null && letterH < MIN_LETTER_HEIGHT_INCHES,
      });
    }

    const warnings: string[] = [];
    const tinyLetters = elements.filter((e) => e.belowMinLetter);
    if (tinyLetters.length) {
      warnings.push(
        `${tinyLetters.length} element(s) have letters under ${MIN_LETTER_HEIGHT_INCHES}". For intricate designs and letters less than ${MIN_LETTER_HEIGHT_INCHES}" tall, please contact us prior to ordering.`,
      );
    }
    const oversized = elements.filter((e) => !e.fitsPlotter);
    if (oversized.length) {
      warnings.push(
        `${oversized.length} element(s) exceed the ${plotterMax}" plotter height in both dimensions and must be tiled/paneled.`,
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicle: vehicleStr,
        designName: designName || "Custom Graphics",
        reference: { sideWidthInches: sideW, sideHeightInches: sideH },
        plotterMaxHeightInches: plotterMax,
        minLetterHeightInches: MIN_LETTER_HEIGHT_INCHES,
        elements,
        elementCount: elements.length,
        warnings,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("cut-graphics-proof error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || "Cut graphics proof failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
