// ============================================================================
// designpro-parse-brief
// ============================================================================
// LayerLiftIQ™ AI PARSE step. Takes the ONE customer brief (natural-language
// prompt + any structured brand fields) and extracts the brandable on-vehicle
// TEXT elements into structured "pieces" — exactly the shape that
// designpro-text-layer-generate consumes to make transparent Layer-2 PNGs.
//
// This is what makes "the AI parses your prompt" real: instead of forcing the
// customer to sort text into separate boxes, the LLM reads the brief and pulls
// out the company name (→ logo lockup), phone, website, social, and tagline.
//
// HARD RULE: extract ONLY identifiers the customer ACTUALLY wrote. NEVER invent
// a phone number, URL, or company name (the old "480-555-DRAIN" hallucination).
// For a pure artistic/restyle brief with no business text, return an EMPTY
// pieces array — that design correctly has no Layer-2 overlays.
//
// Auth: JWT required.
//
// Request:
//   { prompt?: string, companyName?: string, phone?: string,
//     textLayerPrompt?: string, industry?: string }
//
// Response:
//   200 { pieces: [{ id, kind:"logo"|"text", text, role }] }   (0–6 pieces)
//   400 bad input · 401 unauthenticated · 500 internal
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalAnonClient } from "../_shared/external-db.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const GEMINI_MODEL = "gemini-2.5-flash"; // gemini-2.0-flash retired by Google
const MAX_PIECES = 6;

// Creative-brief / design-direction phrases that must NEVER become on-vehicle
// text. If a candidate piece contains any of these it's the brief leaking
// through (the "the whole prompt became a text layer" bug), so we drop it.
const BRIEF_NOISE =
  /\b(commercial for|make it|give it|pro look|full wrap|i want|have it say|should look|design it|wrap that|less busy|more aggressive|base|finish)\b/i;

interface ParseRequest {
  prompt?: string;
  companyName?: string;
  phone?: string;
  textLayerPrompt?: string;
  industry?: string;
  // RESTYLE focal split: when true, return { focal, background } instead of text
  // pieces — splits an artistic brief into the single hero subject (becomes a
  // movable Layer-2 overlay) and the background-only style (rendered clean so the
  // subject isn't baked in). Lets a restyle pin-up/mascot/dragon be moved/resized
  // and feeds the same deterministic flat-panel slicer.
  restyleFocal?: boolean;
}

interface Piece {
  id: string;
  kind: "logo" | "text";
  text: string;
  role?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildExtractionPrompt(req: ParseRequest): string {
  const fields: string[] = [];
  if (req.companyName) fields.push(`Company name (given): ${req.companyName}`);
  if (req.phone) fields.push(`Phone (given): ${req.phone}`);
  if (req.textLayerPrompt) fields.push(`Extra callouts (given): ${req.textLayerPrompt}`);
  if (req.industry) fields.push(`Industry: ${req.industry}`);
  const givens = fields.length ? `\nKnown fields:\n${fields.join("\n")}` : "";

  return [
    "You extract the on-vehicle TEXT/LOGO elements from a vehicle-wrap design brief.",
    "Return ONLY a JSON array (no prose, no code fence) of up to 6 objects:",
    `[{ "kind": "logo" | "text", "text": "<exact copy>", "role": "company name|phone|website|social|tagline" }]`,
    "",
    "RULES:",
    "- Extract ONLY identifiers the customer actually wrote. NEVER invent a phone number, URL, or company name.",
    "- ONLY output literal copy that will physically appear ON the vehicle: the business name, phone, website, email, hours, or a SHORT tagline (e.g. \"Quality Courier\", \"1-800-555-1234\", \"quality.com\", \"24/7 Service\").",
    "- NEVER output the design brief itself or instructions about how the wrap should LOOK. Phrases like \"commercial for\", \"make it\", \"give it a pro look\", \"full wrap\", colors (white/blue/black/gray), materials, vehicle type, or mood are DESIGN DIRECTION — they are NOT on-vehicle text. Drop them.",
    "- The company/business name is the single \"logo\" piece; everything else is \"text\".",
    "- If the brief is purely artistic with no business text, return [].",
    "- Each text value must be SHORT real copy (≤ 40 chars), verbatim.",
    givens,
    "",
    `Brief: """${(req.prompt || "").slice(0, 1500)}"""`,
    "",
    "JSON array:",
  ].join("\n");
}

async function extractPieces(req: ParseRequest): Promise<Piece[]> {
  if (!hasGeminiKey()) return [];
  const key = getGeminiKey();
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildExtractionPrompt(req) }] }],
        generationConfig: { temperature: 0, responseModalities: ["TEXT"] },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return [];
  }
  if (!resp.ok) return [];

  const result = await resp.json().catch(() => null);
  const text: string =
    result?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("") || "";

  // Pull the first JSON array out of the model output (tolerate stray prose/fences).
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let raw: any;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const pieces: Piece[] = [];
  for (const r of raw) {
    const txt = typeof r?.text === "string" ? r.text.trim().slice(0, 60) : "";
    if (!txt) continue;
    // Hard guard: drop creative-brief leakage. Real on-vehicle copy is short and
    // never contains design-direction phrases — this kills the "whole prompt
    // became a text layer" bug even if the model ignores the prompt rules.
    if (BRIEF_NOISE.test(txt) || txt.length > 45) continue;
    const dedupeKey = txt.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    pieces.push({
      id: `txt_${pieces.length}`,
      kind: r?.kind === "logo" ? "logo" : "text",
      text: txt,
      role: typeof r?.role === "string" ? r.role.slice(0, 40) : undefined,
    });
    if (pieces.length >= MAX_PIECES) break;
  }
  // Guarantee at most one logo piece (the brand name); demote extras to text.
  let sawLogo = false;
  for (const p of pieces) {
    if (p.kind === "logo") {
      if (sawLogo) p.kind = "text";
      sawLogo = true;
    }
  }
  return pieces;
}

// ── RESTYLE focal split ──────────────────────────────────────────────────────
// Split an artistic brief into the single HERO SUBJECT (a movable Layer-2 graphic
// overlay) and a BACKGROUND-only style description (rendered clean, with the
// subject removed, so it is never baked in). Returns { focal, background }.
function buildFocalSplitPrompt(req: ParseRequest): string {
  return [
    "You split a vehicle-wrap design brief into TWO parts for a layered render.",
    'Return ONLY JSON (no prose, no code fence): { "focal": "<...>", "background": "<...>" }',
    "",
    "- focal: the SINGLE hero subject/graphic the customer would want to move or resize as one element — e.g. a pin-up girl, a mascot, a dragon, an eagle, a character or central illustration. A short noun phrase (≤ 60 chars). If the brief has no distinct hero subject (it's an abstract pattern/texture/color scheme only), set focal to \"\".",
    "- background: the brief REWRITTEN describing ONLY the style, texture, color, pattern, and any secondary stencils/text — with the focal subject REMOVED — so it can be rendered as a clean canvas WITHOUT the hero subject. Keep it vivid and faithful to the original style.",
    "",
    `Brief: """${(req.prompt || "").slice(0, 1500)}"""`,
    "",
    "JSON:",
  ].join("\n");
}

async function extractFocalSplit(req: ParseRequest): Promise<{ focal: string; background: string }> {
  const fallback = { focal: "", background: (req.prompt || "").trim() };
  if (!hasGeminiKey()) return fallback;
  const key = getGeminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildFocalSplitPrompt(req) }] }],
        generationConfig: { temperature: 0, responseModalities: ["TEXT"] },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return fallback;
    const result = await resp.json().catch(() => null);
    const text: string = result?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("") || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const obj = JSON.parse(match[0]);
    const focal = typeof obj?.focal === "string" ? obj.focal.trim().slice(0, 60) : "";
    const background = typeof obj?.background === "string" && obj.background.trim() ? obj.background.trim() : fallback.background;
    return { focal, background };
  } catch {
    return fallback;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createExternalAnonClient();
    const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !userData?.user) return jsonResponse({ error: "Invalid token" }, 401);

    const body: ParseRequest = await req.json().catch(() => ({}));
    const hasAnything =
      (body.prompt && body.prompt.trim()) ||
      (body.companyName && body.companyName.trim()) ||
      (body.phone && body.phone.trim()) ||
      (body.textLayerPrompt && body.textLayerPrompt.trim());
    if (!hasAnything) return jsonResponse({ pieces: [] });

    // RESTYLE focal split (Layer-1 background + movable hero overlay).
    if (body.restyleFocal) {
      const split = await extractFocalSplit(body);
      return jsonResponse(split);
    }

    const pieces = await extractPieces(body);
    return jsonResponse({ pieces });
  } catch (err: any) {
    console.error("[designpro-parse-brief] unhandled", err);
    return jsonResponse({ error: err?.message || "Internal error" }, 500);
  }
});
