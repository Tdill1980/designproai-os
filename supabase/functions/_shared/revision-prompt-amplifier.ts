// revision-prompt-amplifier.ts
//
// Intent-preserving prompt amplifier for RevisionStudioIQ. Turns a vague or
// stylistic revision request ("make the guns look more like a photograph")
// into a CONCRETE, LOCALIZED edit instruction the image-edit model will
// actually execute — while keeping every word/idea the customer wrote.
//
// This does NOT touch the locked revision-prompt-engine.ts. It runs BEFORE it:
//   raw customer prompt → amplify() → concrete edit → buildCondensedRevisionPrompt
//
// Design rules:
//  - Gemini Flash, text-only, ~2-3s, ~$0.001/call.
//  - PRESERVE INTENT: every noun/color/subject the customer wrote must survive.
//    We ADD specificity, never SUBSTITUTE their idea.
//  - Self-gating: an already-concrete "work order" prompt comes back ~unchanged.
//  - FAIL-OPEN: any error/timeout → return the original prompt untouched so the
//    amplifier can never block or break a revision.
//  - SHORT output: edit prompts must stay tight (long prompts hurt image quality).

import { getGeminiKey } from "./gemini-key-pool.ts";

const AMPLIFIER_MODEL = "gemini-2.5-flash";

const SYSTEM = `You are the revision interpreter for a professional vehicle-wrap design tool. A customer is editing an EXISTING wrap render and typed a change request. Rewrite it into ONE precise edit instruction an image-editing AI will execute reliably.

ABSOLUTE RULES:
1. PRESERVE THE CUSTOMER'S INTENT AND WORDS. Every subject, color, object, and placement they named MUST appear in your output by name. You ADD the specificity they left out — you never replace, drop, or soften their idea. If they said "guns", your output is about guns. If they said "more silver on the roof", your output keeps silver and the roof.
2. MAKE IT CONCRETE AND LOCALIZED. Convert vague/stylistic asks into a direct instruction the model can act on: WHAT to change, WHERE on the vehicle, and to WHAT specific result. "Make it more realistic/photographic" → "Replace the illustrated <subject> with photorealistic, high-resolution photographic <subject>, same layout and position." Name the panel/zone when the customer implies one.
3. LOCK EVERYTHING ELSE. End with a short clause preserving what they did NOT mention: logos, text, other panels, colors, the vehicle, camera framing stay exactly as-is.
4. IF IT IS ALREADY A CONCRETE, SPECIFIC EDIT, return it essentially unchanged (light cleanup only). Do not pad a good work-order prompt.
5. NEVER invent new design elements, brands, text, or themes the customer did not ask for.
6. FOR PLACEMENT / MOVE REQUESTS ("move X up/down/left/right", "raise", "lower", "shift", "not cut off", "it's cut off"), a bare direction is unreliable — anchor the move to a concrete vehicle LANDMARK and state where the element should END UP, keeping it fully visible and uncropped. Name the target zone (door panel, above/below the rear wheel arch, belt line, rocker, front fender, quarter panel). Example: "move the SD logo up" → "Move the SPEED DEMONS wordmark up so it sits fully on the door panel, clearing the rear wheel arch, with no part cropped by the wheel well." Example: "sd is cut off" → "Reposition the SD logo up onto the clear door panel so it reads in full and is not clipped by the wheel arch."

OUTPUT: only the rewritten edit instruction. No preamble, no explanation, no quotes. 1-3 sentences, under 60 words.`;

export interface AmplifyResult {
  amplified: string;
  original: string;
  changed: boolean;
}

/**
 * Amplify a revision prompt. Always returns a usable string — on any failure it
 * returns the original prompt (fail-open), so callers can use `.amplified`
 * unconditionally.
 */
export async function amplifyRevisionPrompt(
  raw: string,
  ctx: { toolType?: string; viewType?: string } = {},
): Promise<AmplifyResult> {
  const original = (raw || "").trim();
  // Nothing to do for empty prompts; the caller validates non-empty separately.
  if (!original) return { amplified: original, original, changed: false };

  try {
    const key = getGeminiKey();
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${AMPLIFIER_MODEL}:generateContent?key=${key}`;
    const contextLine = `Vehicle view being edited: ${ctx.viewType || "side"}. Tool: ${ctx.toolType || "wrap"}.`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{
          role: "user",
          parts: [{ text: `${contextLine}\n\nCustomer's change request:\n"${original}"` }],
        }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 200 },
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      console.warn(`[amplifier] HTTP ${res.status} — using original prompt`);
      return { amplified: original, original, changed: false };
    }
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p?.text || "")
      .join("")
      .trim();

    if (!text || text.length < 4) {
      return { amplified: original, original, changed: false };
    }
    // Safety net: if the model returned something absurdly long, keep the
    // original (long edit prompts degrade image quality — CLAUDE.md rule).
    if (text.length > 600) {
      console.warn(`[amplifier] output too long (${text.length}c) — using original`);
      return { amplified: original, original, changed: false };
    }

    const cleaned = text.replace(/^["'`]+|["'`]+$/g, "").trim();
    console.log(`[amplifier] "${original.slice(0, 50)}" → "${cleaned.slice(0, 70)}"`);
    return { amplified: cleaned, original, changed: cleaned !== original };
  } catch (e) {
    console.warn(`[amplifier] error (${e instanceof Error ? e.message : e}) — using original prompt`);
    return { amplified: original, original, changed: false };
  }
}
