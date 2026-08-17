// backfill-color-grounding — Replaces fake/AI-guessed hexes in manufacturer_colors
// with REAL color data grounded in the actual swatch image (Gemini vision) and,
// for rows with no swatch, Google Search grounding.
//
// Why this exists:
//   Many rows were seeded with hex_source='ai_guessed' and bogus hexes
//   (e.g. 3M "Fierce Fuchsia" stored as #FF00FF pure magenta). generate-color-render
//   injects `official_hex` straight into the Gemini render prompt, so a fake hex
//   produces a wrong-colored render even though a correct swatch image exists.
//   This fills official_hex + grounded_description/base_color/effect from the
//   real swatch chip so renders match the actual film.
//
// Input (JSON body, all optional):
//   { ids?: string[],        // specific manufacturer_colors.id rows to process
//     limit?: number,        // max rows to process this run (default 25)
//     manufacturer?: string, // filter by manufacturer
//     onlyAiGuessed?: boolean,// default true — only touch hex_source='ai_guessed'
//     force?: boolean,       // default false — re-process rows already grounded
//     dryRun?: boolean }     // default false — compute but do not write
//
// Output:
//   { processed, updated, skipped, dryRun, results: [{ id, name, oldHex, newHex,
//     base_color, effect, finish, confidence, source, written, error }] }
//
// Writes (service role): official_hex, grounded_description, grounded_base_color,
//   grounded_effect, hex_source ('swatch_grounded' | 'gemini_grounded'),
//   hex_confidence (int 0-100), updated_at. Never fabricates: if neither image
//   nor search yields a confident hex, the row is left unchanged.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const VISION_MODEL = "gemini-2.5-flash";
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function stripFences(t: string): string {
  return t.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

function parseJsonBlock(text: string): any | null {
  const cleaned = stripFences(text);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

// Salvage fields even when the JSON is truncated (e.g. token limit cut off the
// description before the closing brace). Field order in the prompt puts hex
// first, so the hex survives truncation.
function extractFields(text: string): {
  hex: string | null; base_color: string | null; effect: string | null;
  finish: string | null; description: string | null; confidence: unknown;
} {
  const parsed = parseJsonBlock(text);
  const pick = (key: string): string | null => {
    if (parsed && typeof parsed[key] === "string") return parsed[key];
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "i"));
    return m ? m[1] : null;
  };
  const hexRaw = pick("hex");
  return {
    hex: hexRaw && HEX_RE.test(hexRaw) ? hexRaw.toUpperCase() : null,
    base_color: pick("base_color"),
    effect: pick("effect"),
    finish: pick("finish"),
    description: pick("description"),
    confidence: parsed?.confidence ?? pick("confidence"),
  };
}

function confToInt(c: unknown): number {
  if (typeof c === "number") {
    // accept 0..1 or 0..100
    const n = c <= 1 ? Math.round(c * 100) : Math.round(c);
    return Math.max(0, Math.min(100, n));
  }
  switch (String(c || "").toLowerCase()) {
    case "high": return 100;
    case "medium": return 70;
    case "low": return 40;
    default: return 0;
  }
}

// Chunked base64 — String.fromCharCode(...bigArray) overflows the stack on
// large images, so encode in 32KB slices.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchImageBase64(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") || "image/png";
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return { mimeType, data: bytesToBase64(buf) };
  } catch {
    return null;
  }
}

interface Grounded {
  hex: string | null;
  base_color: string | null;
  effect: string | null;
  finish: string | null;
  description: string | null;
  confidence: number;
}

let lastVisionRaw = "";

async function callGemini(parts: any[], useSearch: boolean): Promise<string> {
  const apiKey = getGeminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`;
  const body: any = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  };
  if (useSearch) body.tools = [{ googleSearch: {} }];
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
  lastVisionRaw = text;
  return text;
}

const JSON_SHAPE = `Return ONLY this JSON, no markdown fences. Output "hex" FIRST and keep "description" to ONE short sentence (max 18 words):
{"hex":"#RRGGBB","base_color":"e.g. magenta, green, silver","effect":"gloss|satin|matte|metallic|pearl|chrome|color-shift|carbon-fiber|brushed-metal","finish":"Gloss|Satin|Matte","description":"one short sentence on the true color and sheen on a vehicle","confidence":"high|medium|low"}`;

async function groundFromImage(
  manufacturer: string, name: string, series: string | null, code: string | null,
  img: { mimeType: string; data: string },
): Promise<Grounded> {
  const prompt = `You are a vinyl wrap film color expert. The attached image is the OFFICIAL swatch for this film:
Manufacturer: ${manufacturer}
Color: ${name}${series ? ` (series ${series})` : ""}${code ? ` [${code}]` : ""}

Read the TRUE color of the FILM itself from the swatch chip. Ignore any white/gray packaging, backgrounds, watermarks, text, or roll edges — report only the vinyl film color. Give the precise hex of the dominant film color as it appears on a vehicle (keep bright/saturated colors fully saturated; do not wash them out toward generic primaries).

${JSON_SHAPE}`;
  const text = await callGemini(
    [{ text: prompt }, { inlineData: { mimeType: img.mimeType, data: img.data } }],
    false,
  );
  const p = extractFields(text);
  return {
    hex: p.hex,
    base_color: p.base_color,
    effect: p.effect,
    finish: p.finish,
    description: p.description,
    confidence: confToInt(p.confidence),
  };
}

async function groundFromSearch(
  manufacturer: string, name: string, series: string | null,
): Promise<Grounded> {
  const prompt = `You are a vinyl wrap film color expert with Google Search. Determine the TRUE color of this real film/paint:
Manufacturer: ${manufacturer}
Color: ${name}${series ? ` (series ${series})` : ""}

Search for the manufacturer color card / product page; if it publishes CMYK/RGB, convert to hex. Many of these names mirror well-known OEM paint colors (e.g. Audi Nardo Grey, Aston Martin colors) — use authoritative references for those. Report the most accurate hex you can determine and rate confidence honestly:
- high: found the manufacturer/OEM published value
- medium: strong reference or a well-known OEM color you can identify confidently
- low: only a rough guess from the name alone
Set hex to null ONLY if the name gives you no basis at all. Never output pure primaries (#FF0000/#00FF00/#0000FF/#FF00FF) as a guess.

${JSON_SHAPE}`;
  const text = await callGemini([{ text: prompt }], true);
  const p = extractFields(text);
  return {
    hex: p.hex,
    base_color: p.base_color,
    effect: p.effect,
    finish: p.finish,
    description: p.description,
    confidence: confToInt(p.confidence),
  };
}

// Assign a representative hex from a DESCRIPTIVE color name + finish (e.g. "Grass
// Green", "Matte Black", "Fuchsia Pink"). For plainly descriptive names the name itself
// is authoritative for the base color, so this is reliable — unlike guessing a specific
// branded product name. Effect/chrome/chameleon names get a single representative hex.
async function groundFromName(
  manufacturer: string, name: string, series: string | null,
): Promise<Grounded> {
  const prompt = `You are a vinyl wrap film color expert. Assign the single most representative hex for this descriptive film color name and finish:
Manufacturer: ${manufacturer}
Color: ${name}${series ? ` (series ${series})` : ""}

The name describes the color directly — translate it to an accurate hex (e.g. "Grass Green" -> a natural grass green, "Fuchsia Pink" -> a true fuchsia, "Matte Black" -> near-black). For chrome/chameleon/color-shift names, give the dominant representative hue. Reflect the finish in lightness (matte slightly darker/flatter, satin mid, gloss vivid). Never output pure primaries (#FF0000/#00FF00/#0000FF/#FF00FF).

${JSON_SHAPE}`;
  const text = await callGemini([{ text: prompt }], false);
  const p = extractFields(text);
  return {
    hex: p.hex,
    base_color: p.base_color,
    effect: p.effect,
    finish: p.finish,
    description: p.description,
    confidence: confToInt(p.confidence),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty body */ }

  const {
    ids, limit = 25, manufacturer,
    onlyAiGuessed = true, force = false, dryRun = false, debug = false,
    hexSources, searchOnly = false, permissive = false,
  } = body;

  if (!hasGeminiKey()) return json({ error: "GOOGLE_AI_API_KEY not configured" }, 500);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return json({ error: "missing SUPABASE_URL or SERVICE_ROLE_KEY" }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  // Build target query
  let q = supabase
    .from("manufacturer_colors")
    .select("id, manufacturer, series, product_code, official_name, official_hex, official_swatch_url, hex_source, grounded_description")
    .order("official_name", { ascending: true })
    .limit(Math.max(1, Math.min(200, limit)));

  if (Array.isArray(ids) && ids.length) q = q.in("id", ids);
  else {
    const sources = Array.isArray(hexSources) && hexSources.length
      ? hexSources
      : (onlyAiGuessed ? ["ai_guessed"] : null);
    if (sources) q = q.in("hex_source", sources);
    if (manufacturer) q = q.eq("manufacturer", manufacturer);
    if (!force) q = q.is("grounded_description", null);
    // Image grounding needs a swatch; search/name grounding does not.
    if (!searchOnly && !permissive) q = q.not("official_swatch_url", "is", null);
  }

  const { data: rows, error: selErr } = await q;
  if (selErr) return json({ error: `select failed: ${selErr.message}` }, 500);
  if (!rows?.length) return json({ processed: 0, updated: 0, skipped: 0, dryRun, results: [] });

  const results: any[] = [];
  let updated = 0, skipped = 0;

  for (const row of rows) {
    const r: any = {
      id: row.id, name: row.official_name, manufacturer: row.manufacturer,
      oldHex: row.official_hex, newHex: null, base_color: null, effect: null,
      finish: null, confidence: 0, source: null, written: false, error: null,
    };
    try {
      let g: Grounded | null = null;
      r.imageFetched = false;
      if (!searchOnly && !permissive && row.official_swatch_url) {
        const img = await fetchImageBase64(row.official_swatch_url);
        if (img) {
          r.imageFetched = true;
          r.imageBytes = img.data.length;
          g = await groundFromImage(row.manufacturer, row.official_name, row.series, row.product_code, img);
          r.source = "swatch_image";
          if (debug) r.visionRaw = lastVisionRaw.slice(0, 500);
        }
      }
      if ((!g || !g.hex) && row.manufacturer && row.official_name) {
        if (permissive) {
          // Name-based assignment for descriptive color names — accept any non-null hex.
          g = await groundFromName(row.manufacturer, row.official_name, row.series);
          r.source = "name_grounded";
        } else {
          g = await groundFromSearch(row.manufacturer, row.official_name, row.series);
          r.source = r.imageFetched ? "search_fallback" : "google_search";
          // Search has no swatch to verify against, so only trust a value the model is
          // genuinely confident about (>= medium). Low-confidence name guesses are exactly
          // the junk we're trying to remove, so discard them.
          if (g && g.hex && g.confidence < 70) {
            r.error = `search confidence too low (${g.confidence}) — discarded`;
            g.hex = null;
          }
        }
        if (debug) r.searchRaw = lastVisionRaw.slice(0, 500);
      }

      if (!g || !g.hex) {
        r.error = r.error || "no confident hex found — left unchanged";
        // Re-tag terminally so a draining loop does not retry the row forever (which also
        // wastes Gemini quota). official_hex is left untouched for manual review.
        //   search_failed     = Google grounding found no authoritative value (search-only)
        //   image_unverified  = swatch fetched but unreadable
        //   swatch_unreachable = swatch URL could not be fetched (dead/foreign host)
        if (!dryRun) {
          const mark: any = {
            hex_source: (searchOnly || permissive) ? "search_failed" : (r.imageFetched ? "image_unverified" : "swatch_unreachable"),
            hex_confidence: 0,
            updated_at: new Date().toISOString(),
          };
          if (g?.description) mark.grounded_description = g.description;
          if (g?.base_color) mark.grounded_base_color = g.base_color;
          if (g?.effect) mark.grounded_effect = g.effect;
          await supabase.from("manufacturer_colors").update(mark).eq("id", row.id);
        }
        skipped++;
        results.push(r);
        continue;
      }

      r.newHex = g.hex;
      r.base_color = g.base_color;
      r.effect = g.effect;
      r.finish = g.finish;
      r.confidence = g.confidence;

      if (!dryRun) {
        const { error: upErr } = await supabase
          .from("manufacturer_colors")
          .update({
            official_hex: g.hex,
            grounded_description: g.description,
            grounded_base_color: g.base_color,
            grounded_effect: g.effect,
            hex_source: r.source === "swatch_image" ? "swatch_grounded" : (r.source === "name_grounded" ? "name_grounded" : "gemini_grounded"),
            hex_confidence: g.confidence,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (upErr) { r.error = `update failed: ${upErr.message}`; }
        else { r.written = true; updated++; }
      }
    } catch (e) {
      r.error = (e as Error).message;
      // A thrown error is treated as transient (e.g. Gemini 429) and the row is left for
      // retry — EXCEPT in image mode where the swatch couldn't be fetched at all, which is
      // a hard failure worth tagging so the image-drain loop terminates.
      if (!dryRun && !searchOnly && !permissive && !r.imageFetched) {
        await supabase.from("manufacturer_colors")
          .update({ hex_source: "swatch_unreachable", hex_confidence: 0, updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      skipped++;
    }
    results.push(r);
  }

  return json({ processed: rows.length, updated, skipped, dryRun, results });
});
