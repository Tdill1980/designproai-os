// ============================================================================
// designpro-text-layer-generate
// ============================================================================
// Two-layer DesignPro flow — Layer 2 (Text & Logo) AI generator.
//
// When a customer types their business info on the DesignPro entry page and
// uploads NO logo, this turns that typed brief into clean, TRANSPARENT text/
// logo graphics that get composited on top of the (separately rendered)
// background and remain individually editable in RevisionStudio.
//
// It produces ONE transparent PNG per requested "piece" (e.g. the company-name
// lockup, the phone number, the website) so each lands as its own movable
// object the user can drag / scale / rotate / delete / re-prompt.
//
// This is SEPARATE from the locked background render pipeline
// (design-panel-ai-generate / generate-color-render). It never renders a
// vehicle — only flat transparent type/logo art.
//
// Auth: JWT required.
//
// Request:
//   {
//     companyName?: string,
//     pieces: Array<{                       (1–6 items)
//       id: string,                         (caller-supplied stable id)
//       kind: "logo" | "text",
//       text: string,                       (the literal copy to render)
//       role?: string                       (e.g. "company name", "phone")
//     }>,
//     brandColors?: string[],               (≤3 hex)
//     industry?: string,
//     stylePrompt?: string                  (free-text vibe, ≤500)
//   }
//
// Response:
//   200 { objects: [{ id, kind, role, text, imageUrl }], partialFailure?: bool }
//   400 bad input · 401 unauthenticated · 502 all pieces failed · 500 internal
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import {
  createExternalAnonClient,
  createExternalClient,
  getExternalSupabaseUrl,
} from "../_shared/external-db.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const GEMINI_MODEL = "gemini-3-pro-image-preview";
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_PIECES = 6;

interface TextPiece {
  id: string;
  kind: "logo" | "text";
  text: string;
  role?: string;
}

interface GenerateRequest {
  companyName?: string;
  pieces?: TextPiece[];
  brandColors?: string[];
  industry?: string;
  stylePrompt?: string;
  // The overall design brief (same text the background render gets). Used ONLY
  // to THEME the logo/mascot to the actual business — never copied as literal
  // on-vehicle text. Lets a sparse brief still yield a cohesive, on-industry
  // mark (e.g. "Bob's Courier Service … 24/7 fast delivery" → motion / speed /
  // delivery iconography) instead of a generic lockup.
  brief?: string;
  // Free-text color direction ("blue, red, green") for when the caller has no
  // strict #RRGGBB hex. The color intent otherwise never reaches Layer 2.
  colorBrief?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildPrompt(req: GenerateRequest, piece: TextPiece): string {
  const lines: string[] = [];
  lines.push(
    "You are a senior vehicle-wrap typographer. You design bold, legible, " +
      "professional lettering and logo lockups that read instantly from across a parking lot.",
  );
  lines.push("");
  if (piece.kind === "logo") {
    // A cohesive, PROFESSIONALLY DESIGNED brand logo (per product direction:
    // "a logo-style font, cohesive design branding" — NOT a generic font, NOT a
    // plain label, NOT a random cartoon mascot). Think real brand identity: custom
    // logo-style lettering with deliberate character, optionally paired with a
    // tasteful complementary mark that fits the brand (like the Summit Realty
    // chevron). Avoid the word "wordmark" in the instruction — it makes the model
    // fall back to a plain system font.
    lines.push(`TASK: Design a cohesive, professional brand LOGO for "${piece.text}".`);
    lines.push(
      "Draw the name in CUSTOM, distinctive LOGO-STYLE lettering — purposeful " +
        "letterforms, weight, spacing and balance that read as a deliberately " +
        "designed brand identity. NEVER use a generic, default or system font, and " +
        "NEVER render it as a plain text label.",
    );
    lines.push(
      "Add a clean, complementary mark or emblem when it strengthens the logo and " +
        "fits the brand — keep it tasteful and cohesive with the lettering (one " +
        "designed brand, not two parts). Do NOT add a cartoon mascot unless the " +
        "style direction below explicitly asks for one.",
    );
    // Theme the logo's design to what the business does so a sparse brief still
    // yields an on-brand identity — never render the brief as text.
    const businessCtx = [req.industry, req.brief].filter(Boolean).join(". ");
    if (businessCtx) {
      lines.push(
        `Theme the logo's style to this business (shape the lettering and any mark, ` +
          `do NOT render this as text): ${businessCtx}.`,
      );
    }
  } else {
    lines.push(`TASK: Set the following text as polished wrap lettering: "${piece.text}".`);
  }
  if (piece.role) lines.push(`This element is the ${piece.role}.`);
  if (req.companyName && req.companyName !== piece.text) {
    lines.push(`Company: ${req.companyName} (for context — only render the TASK text).`);
  }
  if (req.industry) lines.push(`Industry: ${req.industry}.`);
  // Brand colors: prefer strict hex, fall back to the free-text color brief so
  // a customer who typed "blue, red, green" still gets those colors in the mark.
  const colorLine = (req.brandColors && req.brandColors.length)
    ? req.brandColors.join(", ")
    : (req.colorBrief || "").trim();
  if (colorLine) lines.push(`Use these brand colors: ${colorLine}.`);
  if (req.stylePrompt) lines.push(`Style direction: ${req.stylePrompt}.`);
  lines.push("");
  lines.push("REQUIREMENTS:");
  // Gemini cannot emit a real alpha channel — if asked for "transparent" it bakes
  // a white/checkerboard backdrop. So we demand a FLAT magenta chroma key here and
  // remove it to true transparency after generation (chromaKeyToAlpha).
  lines.push("- BACKGROUND: one SOLID, FLAT, UNIFORM pure magenta fill (#FF00FF, RGB 255/0/255) covering the ENTIRE frame edge to edge. It is a chroma-key backdrop that will be removed — so it MUST be a single flat magenta, NOT a checkerboard, white, gradient, shadow, or any texture.");
  lines.push("- Do NOT use magenta or hot pink ANYWHERE in the artwork itself (it would be keyed out). Use the brand colors for the design.");
  lines.push("- Render ONLY the requested text/logo — nothing else, no extra words.");
  lines.push("- Sharp, balanced, high-contrast type that stays legible when small.");
  lines.push("- Flat 2D design. No mockups, no vehicle, no scene, no drop shadow.");
  lines.push("- Fill most of the frame with the artwork — minimal even magenta margin.");
  lines.push("- Spelling must be EXACT — do not alter the supplied text.");
  lines.push("");
  lines.push("OUTPUT: the single element centered on a flat pure-magenta background.");
  const out = lines.join("\n");
  return out.length > 3000 ? out.slice(0, 3000) : out;
}

// ── Chroma key → TRUE transparency ──────────────────────────────────────────
// Gemini bakes a background instead of emitting alpha, so we render the art on a
// flat magenta backdrop (see buildPrompt) and remove it here: every magenta-ish
// pixel becomes fully transparent, then we tight-crop to the remaining artwork.
// Pure Deno (imagescript) — no sharp, no extra service. The result is a real
// alpha PNG the canvas + GENIE panelizer can composite, not an opaque block.
async function chromaKeyToAlpha(pngBytes: Uint8Array): Promise<Uint8Array> {
  let img: any;
  try {
    img = await Image.decode(pngBytes);
  } catch {
    return pngBytes; // undecodable — keep original rather than lose the art
  }
  const W = img.width as number;
  const H = img.height as number;
  const bmp = img.bitmap as Uint8ClampedArray; // RGBA, length W*H*4
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const r = bmp[i], g = bmp[i + 1], b = bmp[i + 2];
    // magenta backdrop: strong red + strong blue, weak green
    if (r > 140 && b > 140 && g < 120) {
      bmp[i + 3] = 0; // → fully transparent
    } else {
      const x = p % W, y = (p / W) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // Nothing survived (all magenta?) — return the keyed full frame as-is.
  if (maxX < minX || maxY < minY) return await img.encode();
  // Tight crop to the artwork with a small even margin.
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad);
  maxY = Math.min(H - 1, maxY + pad);
  try {
    img.crop(minX, minY, maxX - minX + 1, maxY - minY + 1);
  } catch { /* keep uncropped if crop fails */ }
  return await img.encode();
}

async function callGemini(prompt: string): Promise<{ pngBytes: Uint8Array } | { error: string }> {
  if (!hasGeminiKey()) return { error: "no_gemini_key" };
  const key = getGeminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: "1:1", imageSize: "4K" },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err: any) {
    return { error: `network: ${err?.message || String(err)}` };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { error: `gemini_${resp.status}: ${text.slice(0, 200)}` };
  }

  const result = await resp.json();
  const parts = result?.candidates?.[0]?.content?.parts;
  let imageBase64: string | null = null;
  if (parts) {
    for (const part of parts) {
      if (part?.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        break;
      }
    }
  }
  if (!imageBase64) return { error: "no_image_returned" };

  // MEMORY (546 guard): single-pass decode — the old atob + char loop held the
  // base64 string, binary string, and byte array at once and OOM'd the worker.
  const pngBytes = decodeBase64(imageBase64);
  return { pngBytes };
}

function validate(req: GenerateRequest): string | null {
  if (!req.pieces || !Array.isArray(req.pieces) || req.pieces.length === 0) {
    return "pieces is required (1–6 items)";
  }
  if (req.pieces.length > MAX_PIECES) return `pieces must be ≤ ${MAX_PIECES}`;
  for (const p of req.pieces) {
    if (!p || typeof p.id !== "string" || !p.id) return "each piece needs an id";
    if (p.kind !== "logo" && p.kind !== "text") return "piece.kind must be 'logo' or 'text'";
    if (typeof p.text !== "string" || !p.text.trim()) return "each piece needs text";
    if (p.text.length > 200) return "piece.text ≤ 200 chars";
  }
  // brandColors are TOLERANT now: never 400 on them. Free-text or non-hex colors
  // (e.g. "deep navy, safety orange") are simply sanitized in the handler — the
  // color intent already lives in the design prompt. (Was a 400 → overlays never
  // generated, the LayerLiftIQ root cause.)
  if (req.stylePrompt && req.stylePrompt.length > 500) return "stylePrompt ≤ 500 chars";
  if (req.industry && req.industry.length > 100) return "industry ≤ 100 chars";
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // 1. Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createExternalAnonClient();
    const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !userData?.user) return jsonResponse({ error: "Invalid token" }, 401);
    const user = userData.user;

    // 2. Parse + validate
    const body: GenerateRequest = await req.json();
    // Sanitize brandColors → keep only valid hex (≤3), drop free-text.
    if (body.brandColors) {
      const clean = (Array.isArray(body.brandColors) ? body.brandColors : [])
        .flatMap((c) => (typeof c === "string" ? c.split(/[,\s]+/) : []))
        .filter((c) => HEX_RE.test(c))
        .slice(0, 3);
      body.brandColors = clean.length ? clean : undefined;
    }
    // Sanitize PIECES → the #1 cause of the 400: a long brief line (>200 chars)
    // or empty/blank text. Trim, truncate to 200, drop empties, cap at 6, and
    // coerce kind. NEVER 400 a real design just because the text was long.
    if (Array.isArray(body.pieces)) {
      body.pieces = body.pieces
        .filter((p) => p && typeof p.text === "string" && p.text.trim().length > 0)
        .slice(0, MAX_PIECES)
        .map((p, i) => ({
          id: (typeof p.id === "string" && p.id) ? p.id : `txt_${i}`,
          kind: p.kind === "logo" ? "logo" : "text",
          text: p.text.trim().slice(0, 200),
          role: typeof p.role === "string" ? p.role.slice(0, 60) : undefined,
        }));
    }
    if (typeof body.stylePrompt === "string") body.stylePrompt = body.stylePrompt.slice(0, 500);
    if (typeof body.industry === "string") body.industry = body.industry.slice(0, 100);
    if (typeof body.brief === "string") body.brief = body.brief.slice(0, 1500);
    if (typeof body.colorBrief === "string") body.colorBrief = body.colorBrief.slice(0, 200);
    const validationError = validate(body);
    if (validationError) return jsonResponse({ error: validationError }, 400);

    // 3. Generate each piece in parallel, one retry on transient failure.
    const sb = createExternalClient();
    const supabaseUrl = getExternalSupabaseUrl();
    const stamp = Date.now().toString(36);

    const callWithRetry = async (prompt: string) => {
      let res = await callGemini(prompt);
      if ("error" in res) {
        await new Promise((r) => setTimeout(r, 1500));
        res = await callGemini(prompt);
      }
      return res;
    };

    const results = await Promise.allSettled(
      body.pieces!.map((piece) => callWithRetry(buildPrompt(body, piece))),
    );

    const objects: { id: string; kind: string; role?: string; text: string; imageUrl: string }[] = [];
    for (let i = 0; i < results.length; i++) {
      const piece = body.pieces![i];
      const r = results[i];
      if (r.status !== "fulfilled" || "error" in r.value) {
        const reason = r.status === "rejected" ? r.reason : (r.value as any).error;
        console.warn(`[designpro-text-layer-generate] piece ${piece.id} failed:`, reason);
        continue;
      }
      // Remove the magenta chroma backdrop → TRUE transparent, tight-cropped PNG.
      const transparentPng = await chromaKeyToAlpha(r.value.pngBytes);
      const path = `text-layer/${user.id}/${stamp}/${piece.id}.png`;
      const { error: uploadErr } = await sb.storage
        .from("wrap-files")
        .upload(path, transparentPng, { contentType: "image/png", upsert: true });
      if (uploadErr) {
        console.error(`[designpro-text-layer-generate] upload ${piece.id} failed`, uploadErr);
        continue;
      }
      const imageUrl = `${supabaseUrl}/storage/v1/object/public/wrap-files/${path}`;
      objects.push({ id: piece.id, kind: piece.kind, role: piece.role, text: piece.text, imageUrl });
    }

    if (objects.length === 0) {
      return jsonResponse({ error: "all_pieces_failed" }, 502);
    }

    return jsonResponse({
      objects,
      partialFailure: objects.length < body.pieces!.length,
    });
  } catch (err: any) {
    console.error("[designpro-text-layer-generate] unhandled", err);
    return jsonResponse({ error: err?.message || "Internal error" }, 500);
  }
});
