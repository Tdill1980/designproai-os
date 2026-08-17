/**
 * parse-quote-job — free-text → structured QuickQuote job spec.
 *
 * Input:  { text: string }
 *         e.g. "Wrap a 2023 Ford F-150 with gloss black, full color change"
 *              "Tint all windows on a 2021 Tesla Model 3, 20% on the front, 5% rear"
 *              "Hood and roof gloss white on a 2018 Civic"
 *
 * Output: { spec: ParsedJobSpec, vehicle?: VehicleMeasurement }
 *
 * Pipeline:
 *   1. Gemini (gemini-2.5-flash, NO grounding, low temp, JSON output)
 *      parses the free text into ParsedJobSpec fields.
 *   2. If a vehicle is identified, call the existing `vehicle-lookup`
 *      edge function — it already does cache → Gemini-with-grounding
 *      → CSV-derived panel scaling, so we just hand off.
 *   3. Return the parsed spec plus (when found) the vehicle row.
 *
 * This function is the brain of the JobDescriptionInput component on
 * the new QuickQuote wizard. It does NOT price the job — pricing stays
 * in the client (quote-product-catalog.ts) so admins can override.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

// ────────────────────────────────────────────────────────────────────
// Deterministic WePrintWraps print pricing (NO LLM).
//
// Co-located here (rather than a new function) because the project is at
// its edge-function cap. Reached via POST { price: {...} }; the existing
// { text } parse path is unchanged. This is the SINGLE source of truth
// for a WPW quote total — the QuickQuote UI and ACE (the WrapCommandAI
// chat assistant) both call it.
//
// WPW rules (LOCKED): PRINT ONLY · NO install/labor · NO margin, ever ·
// MAX PRINT WIDTH 59.5" (over-width must panel/seam). Price is purely
// square feet × material $/sqft, sq ft resolved three ways (mirrors
// weprintwraps.com): by vehicle / by sq ft / by dimension.
// ────────────────────────────────────────────────────────────────────
const MAX_PRINT_WIDTH_IN = 59.5;

interface PriceMaterial { id: string; label: string; unit: "sqft"; price: number; }
// Mirror of src/lib/quote-product-catalog.ts printed-film prices.
const MATERIALS: Record<string, PriceMaterial> = {
  "avery-1105":    { id: "avery-1105",    label: "Avery 1105 EZRS + UV Lam",      unit: "sqft", price: 5.27 },
  "3m-ij180":      { id: "3m-ij180",      label: "3M IJ180 Printed",              unit: "sqft", price: 5.27 },
  "avery-contour": { id: "avery-contour", label: "Avery Contour-Cut",             unit: "sqft", price: 6.32 },
  "3m-contour":    { id: "3m-contour",    label: "3M IJ180 Contour-Cut",          unit: "sqft", price: 6.92 },
  "perf":          { id: "perf",          label: "Perforated Window Vinyl 50/50", unit: "sqft", price: 5.95 },
};
const DEFAULT_MATERIAL = "avery-1105";

function resolveMaterial(input?: string): PriceMaterial {
  if (!input) return MATERIALS[DEFAULT_MATERIAL];
  const s = String(input).toLowerCase();
  if (MATERIALS[s]) return MATERIALS[s];
  const contour = /contour|cut/.test(s);
  if (/perf|perforat|window/.test(s)) return MATERIALS["perf"];
  if (/3m|ij180/.test(s)) return contour ? MATERIALS["3m-contour"] : MATERIALS["3m-ij180"];
  if (/avery|1105/.test(s)) return contour ? MATERIALS["avery-contour"] : MATERIALS["avery-1105"];
  if (contour) return MATERIALS["avery-contour"];
  return MATERIALS[DEFAULT_MATERIAL];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

function priceJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function priceVehicleSqFt(
  vehicle: { year?: string; make?: string; model?: string } | undefined,
  authHeader: string | null,
): Promise<{ sqft: number | null; matchedTo?: string }> {
  if (!vehicle?.make || !vehicle?.model) return { sqft: null };
  const base = Deno.env.get("SUPABASE_URL") || "https://kfapjdyythzyvnpdeghu.supabase.co";
  try {
    const res = await fetch(`${base}/functions/v1/vehicle-lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authHeader ? { Authorization: authHeader } : {}) },
      body: JSON.stringify({ make: vehicle.make, model: vehicle.model, year: vehicle.year || "" }),
    });
    if (!res.ok) return { sqft: null };
    const data = await res.json();
    const v = data?.vehicle;
    const sqft = v?.corr_sq_ft ?? v?.total_sq_ft ?? null;
    return {
      sqft: sqft ? round1(sqft) : null,
      matchedTo: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "),
    };
  } catch (_e) {
    return { sqft: null };
  }
}

// price = { mode, material?, coverage?, vehicle?, sqft?, dimensions? }
async function priceQuote(price: any, authHeader: string | null): Promise<Response> {
  const mode: string = price?.mode || (price?.dimensions ? "dimensions" : price?.sqft ? "sqft" : "vehicle");
  const material = resolveMaterial(price?.material);
  const flags: string[] = [];
  let sqft = 0;
  let maxWidthExceeded = false;
  let panels: number | undefined;
  let detail = "";

  if (mode === "dimensions") {
    const d = price?.dimensions || {};
    const widthIn = Number(d.widthIn) || 0;
    const lengthFt = Number(d.lengthFt) || 0;
    const pieces = Math.max(1, Number(d.pieces) || 1);
    if (widthIn <= 0 || lengthFt <= 0) {
      return priceJson(200, { ok: false, error: "needs dimensions", flags: ["NEEDS INFO: width (in) and length (ft) required to price."] });
    }
    sqft = round1((widthIn / 12) * lengthFt * pieces);
    let widthNote = `${widthIn}" wide`;
    if (widthIn > MAX_PRINT_WIDTH_IN) {
      maxWidthExceeded = true;
      panels = Math.ceil(widthIn / MAX_PRINT_WIDTH_IN);
      flags.push(`OVER MAX WIDTH: ${widthIn}" > ${MAX_PRINT_WIDTH_IN}" max — split into ${panels} panels/seam, or reduce to ≤${MAX_PRINT_WIDTH_IN}". Confirm layout.`);
      widthNote += ` → ${panels} panels`;
    }
    detail = `${pieces} pc @ ${widthNote} × ${lengthFt}ft = ${sqft} sqft × $${material.price}/sqft`;
  } else if (mode === "sqft") {
    sqft = round1(Number(price?.sqft) || 0);
    if (sqft <= 0) {
      return priceJson(200, { ok: false, error: "needs sqft", flags: ["NEEDS INFO: square footage required to price."] });
    }
    detail = `${sqft} sqft × $${material.price}/sqft`;
  } else {
    const v = await priceVehicleSqFt(price?.vehicle, authHeader);
    if (!v.sqft) {
      return priceJson(200, { ok: false, error: "needs vehicle", flags: ["NEEDS INFO: a year/make/model (or sqft / dimensions) is required to size the print."] });
    }
    const coverage = price?.coverage != null ? Math.max(0, Math.min(1, Number(price.coverage))) : 1;
    sqft = round1(v.sqft * coverage);
    detail = `${v.matchedTo || "vehicle"} — ${sqft} sqft print coverage${coverage < 1 ? ` (${Math.round(coverage * 100)}%)` : ""} × $${material.price}/sqft`;
    flags.push("PRINT ONLY — WPW supplies the printed film; the shop installs. Add material waste (~10-15%) as needed.");
  }

  const total = round2(sqft * material.price);
  return priceJson(200, {
    ok: true,
    mode,
    material: { id: material.id, label: material.label },
    sqft,
    unit: material.unit,
    unitPrice: material.price,
    lineItems: [{ label: material.label, detail, unit: material.unit, unitPrice: material.price, qty: sqft, amount: total }],
    total,
    maxWidthExceeded,
    ...(panels ? { panels } : {}),
    flags,
  });
}

type ServiceType =
  | "color_change"
  | "print_wrap"
  | "partial_wrap"
  | "tint"
  | "ppf"
  | "chrome_delete"
  | "design_only"
  | "other";

interface ParsedJobSpec {
  service_type: ServiceType;
  /** Vehicle if mentioned. */
  vehicle: {
    make: string | null;
    model: string | null;
    year: string | null;
  };
  /** Surface finish if mentioned (gloss, satin, matte, metallic, …). */
  finish: string | null;
  /** Color if mentioned (free text — "gloss black", "midnight blue"). */
  color: string | null;
  /**
   * Panels mentioned. Empty array means "full coverage" or unspecified
   * (consumer will treat empty as full when service_type implies it).
   */
  panels: string[];
  /** Tint percentages if service_type === "tint". */
  tint?: {
    front?: string;
    rear?: string;
    windshield?: string;
  };
  /** Free-form notes Gemini surfaced (rush, fleet count, etc.). */
  notes: string | null;
  /** Confidence 0-1 from the model. */
  confidence: number;
}

const SYSTEM_PROMPT = `You convert a vehicle-wrap shop's free-text job
description into a strict JSON object. Output ONLY the JSON object, no
prose, no markdown fence.

Schema:
{
  "service_type": "color_change" | "print_wrap" | "partial_wrap" | "tint" | "ppf" | "chrome_delete" | "design_only" | "other",
  "vehicle": { "make": string|null, "model": string|null, "year": string|null },
  "finish": "gloss" | "satin" | "matte" | "metallic" | "brushed" | "carbon" | "textured" | "color_flip" | "chrome" | null,
  "color": string|null,
  "panels": string[],   // e.g. ["hood","roof","mirrors"]; [] for full coverage
  "tint": { "front": string|null, "rear": string|null, "windshield": string|null } | null,
  "notes": string|null,
  "confidence": number  // 0..1
}

Rules:
- "Full wrap" / "color change" / "wrap the whole car" → service_type "color_change", panels [].
- "Hood and roof" / "just the mirrors" → service_type "partial_wrap" with panels listed.
- Window tint requests → service_type "tint", capture percentages in tint.front/rear/windshield as strings like "20%".
- If no vehicle mentioned, set vehicle fields to null.
- If you are unsure, lower confidence; do not guess vehicle make/model.`;

async function parseWithGemini(
  text: string,
  apiKey: string,
): Promise<ParsedJobSpec> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${SYSTEM_PROMPT}\n\nJob description:\n"""${text}"""` }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini parse failed ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text || "")
    .join("") || "";

  // responseMimeType=application/json should give us pure JSON, but be defensive.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in Gemini response: ${raw.slice(0, 200)}`);

  const parsed = JSON.parse(match[0]);

  return {
    service_type: parsed.service_type ?? "other",
    vehicle: {
      make: parsed.vehicle?.make ?? null,
      model: parsed.vehicle?.model ?? null,
      year: parsed.vehicle?.year ?? null,
    },
    finish: parsed.finish ?? null,
    color: parsed.color ?? null,
    panels: Array.isArray(parsed.panels) ? parsed.panels : [],
    tint: parsed.tint ?? undefined,
    notes: parsed.notes ?? null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
  };
}

async function lookupVehicle(
  spec: ParsedJobSpec,
  authHeader: string | null,
): Promise<unknown | null> {
  const { make, model, year } = spec.vehicle;
  if (!make || !model) return null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ||
    "https://kfapjdyythzyvnpdeghu.supabase.co";

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/vehicle-lookup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({ make, model, year: year || "" }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.vehicle ?? null;
  } catch (e) {
    console.error("vehicle-lookup hand-off failed:", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Deterministic pricing path — POST { price: {...} }. No LLM.
    if (body?.price) {
      return await priceQuote(body.price, req.headers.get("Authorization"));
    }

    const text = body?.text;
    if (typeof text !== "string" || text.trim().length < 3) {
      return new Response(
        JSON.stringify({ error: "text is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "Parse service unavailable" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const apiKey = getGeminiKey();
    const spec = await parseWithGemini(text.trim(), apiKey);

    const vehicle = await lookupVehicle(spec, req.headers.get("Authorization"));

    return new Response(
      JSON.stringify({ spec, vehicle }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("parse-quote-job error:", err);
    return new Response(
      JSON.stringify({ error: "Could not parse job description." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
