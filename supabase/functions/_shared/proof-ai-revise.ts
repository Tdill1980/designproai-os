/**
 * proof-ai-revise.ts
 *
 * Minimal image-to-image Gemini call tailored to CUSTOMER-SIDE revisions
 * from the public proof page. This is NOT a fork of design-panel-ai-generate
 * (which is locked per CLAUDE.md). It is a purpose-built helper for one
 * specific use case:
 *
 *   Customer has a rendered wrap design. They type a short free-form
 *   revision request ("make the blue darker"). We feed the original hero
 *   render + the customer's request to Gemini and get back a lightly-
 *   modified version of the SAME render. Camera angle, studio, lighting,
 *   vehicle, and unchanged regions stay identical.
 *
 * Prompt stays short intentionally (see CLAUDE.md "Prompt length = quality
 * killer"). No photographer identity, no "award-winning" language.
 *
 * Response: { ok: true, pngBytes, mimeType } or { ok: false, reason, error }.
 */

import { getGeminiKey, hasGeminiKey } from "./gemini-key-pool.ts";

export interface ProofReviseParams {
  originalImageUrl: string; // the active version hero
  customerPrompt: string; // customer's free-form revision request
  vehicleSummary?: string; // "2024 Ford F-150" — helps the model stay grounded
  finishType?: string; // "gloss" | "matte" | "satin"
  // Customer-attached reference images ("here's the look I want") supplied
  // mid-conversation. Used as style/content guidance for the requested
  // change. Capped server-side; only the first few are sent to keep the
  // payload small (prompt/image bloat degrades quality — see CLAUDE.md).
  referenceImageUrls?: string[];
  // When TRUE the attached images are the customer's own LOGOS / GRAPHICS to
  // ADD to the wrap (e.g. "add the 3 sponsor logos to the doors") — reproduce
  // the supplied artwork and place it, rather than treating the attachments as
  // mere style inspiration. Default false = the existing style-guidance behavior
  // (and the "no logos added" guard stays on).
  placeAttachedGraphics?: boolean;
}

export type ProofReviseResult =
  | { ok: true; pngBytes: Uint8Array; mimeType: string }
  | {
      ok: false;
      reason: "missing_key" | "fetch_failed" | "gemini_error" | "no_image";
      status?: number;
      error?: string;
    };

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent";
const GEMINI_TIMEOUT_MS = 90_000;

export function buildRevisionPrompt(p: ProofReviseParams): string {
  const vehicleLine = p.vehicleSummary ? `Vehicle: ${p.vehicleSummary}.` : "";
  const finishLine = p.finishType ? `Finish: ${p.finishType.toUpperCase()}.` : "";
  const hasRefs = !!(p.referenceImageUrls && p.referenceImageUrls.length > 0);
  const placing = hasRefs && !!p.placeAttachedGraphics;

  // THE RESTRICTION MUST NEVER COUNTERMAND THE CUSTOMER. The blanket
  // no-added-text-or-logos guard exists to stop the model INVENTING
  // branding nobody asked for — but sent alongside an additive request it
  // outranks the customer: live proof 463a3175 asked "Add the barber pole to
  // the back" ten times in 30 minutes (finally in Spanish), every attempt
  // marked done, because this template told the model not to add graphics in
  // the same breath. Same detection vocabulary as the fortified
  // buildCondensedRevisionPrompt: an explicit ADD verb aimed at a named
  // graphic/text element suppresses the guard; everything else keeps it.
  const requestAsksToAdd =
    /\b(add|place|put|include|insert|overlay|write|print|stamp|bring back|re-?add|copy)\b/i.test(p.customerPrompt) &&
    /\b(logo|logos|badge|emblem|crest|mascot|text|lettering|name|decal|graphic|graphics|sticker|sponsor|number|pole|flag|stripe|stripes|design|word|wording|slogan|phone|website)\b/i.test(p.customerPrompt);

  // Two reference modes (the current design is always the FIRST image; the
  // attached references follow it):
  //  • PLACE mode — the attachments ARE the customer's logos/graphics to ADD.
  //    Reproduce the supplied artwork faithfully and place it where asked.
  //  • STYLE mode (default) — the attachments show the LOOK they want; use them
  //    as color/pattern guidance only and add no logos/text.
  const refLine = !hasRefs
    ? ""
    : placing
      ? `\nThe image(s) attached AFTER the current design are the customer's own LOGOS / GRAPHICS to ADD to the wrap. Reproduce each attached logo faithfully — same artwork, colors, and proportions — and place it on the wrap exactly where the request asks (e.g. the doors). Use the supplied artwork; do NOT invent or restyle the logos. Keep everything else in the design unchanged.`
      : `\nThe customer also attached reference image(s) showing the look they want. Use them as style and content guidance for the requested change — match their colors, patterns, and design direction — while keeping the SAME vehicle, camera angle, and studio as the current design.`;

  // The "no logos/text" guard stays ON only when the customer's own request
  // is NOT asking for an addition — for deliberate placement of attached
  // graphics, or an explicit "add the <element>" request, the guard is off so
  // the template cannot contradict the customer.
  const restriction = placing || requestAsksToAdd
    ? `Keep photorealism. The wrap covers painted body panels only; windows, lights, wheels, and trim stay factory.${requestAsksToAdd && !placing ? " Add ONLY what the customer's request names — no other new text or logos." : ""}`
    : `Keep photorealism. The wrap covers painted body panels only; windows, lights, wheels, and trim stay factory. No text or logos added.`;

  // Kept intentionally short. The customer's own request carries the signal.
  return `You are revising an existing vehicle wrap design per the customer's request.
${vehicleLine}
${finishLine}

Customer request: "${p.customerPrompt.trim()}"${refLine}

The customer may ask for SEVERAL changes in one message — read the whole request and apply EVERY change they mention, together, in this single revised image.

Preserve from the current design image:
- The same vehicle and camera angle.
- The studio environment, floor, walls, and lighting.
- Any design elements the customer did NOT ask to change.

Apply the requested change(s) and nothing else. ${restriction}`.trim();
}

async function fetchImageAsBase64(
  url: string,
  timeoutMs = 15_000,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Deno/1.0 RestylePro-Proof/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const mimeType = resp.headers.get("content-type") || "image/png";
    const buf = new Uint8Array(await resp.arrayBuffer());
    // Chunked base64 encoding to avoid stack overflow on large images
    let bin = "";
    for (let i = 0; i < buf.length; i += 8192) {
      const chunk = buf.subarray(i, Math.min(i + 8192, buf.length));
      bin += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return { base64: btoa(bin), mimeType };
  } catch {
    return null;
  }
}

export async function runProofRevision(
  params: ProofReviseParams,
): Promise<ProofReviseResult> {
  if (!hasGeminiKey()) {
    return { ok: false, reason: "missing_key" };
  }

  const fetched = await fetchImageAsBase64(params.originalImageUrl);
  if (!fetched) {
    return { ok: false, reason: "fetch_failed" };
  }

  const promptText = buildRevisionPrompt(params);

  // Order: instruction text, then the CURRENT design (the image we edit), then
  // the customer-attached references. Capped to keep the payload lean (image
  // bloat degrades quality) but high enough to carry a full sponsor-logo set
  // (e.g. 3 logos) when the customer asks to place them.
  const parts: Array<Record<string, unknown>> = [
    { text: promptText },
    { inlineData: { mimeType: fetched.mimeType, data: fetched.base64 } },
  ];
  for (const refUrl of (params.referenceImageUrls || []).slice(0, 4)) {
    const ref = await fetchImageAsBase64(refUrl);
    if (ref) parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
  }

  const body = {
    contents: [
      { parts },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      // 2K (not 4K) for the in-conversation revision preview: ~half the
      // generation time so the customer gets their change back faster. The
      // final print pipeline re-renders at full resolution downstream.
      imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
    },
  };

  let resp: Response;
  try {
    resp = await fetch(`${GEMINI_ENDPOINT}?key=${getGeminiKey()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (err: any) {
    console.error("proof-ai-revise: gemini fetch failed:", err?.message || err);
    return {
      ok: false,
      reason: "gemini_error",
      error: err?.message || "fetch failed",
    };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error(`proof-ai-revise: gemini HTTP ${resp.status}:`, text.slice(0, 500));
    return {
      ok: false,
      reason: "gemini_error",
      status: resp.status,
      error: text.slice(0, 500),
    };
  }

  const json = await resp.json().catch(() => ({}));
  const responseParts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(responseParts)) {
    return { ok: false, reason: "no_image", error: "no candidate parts" };
  }

  let imageBase64: string | null = null;
  let imageMimeType = "image/png";
  for (const part of responseParts) {
    if (part?.inlineData?.data) {
      imageBase64 = part.inlineData.data;
      imageMimeType = part.inlineData.mimeType || "image/png";
      break;
    }
  }
  if (!imageBase64) {
    return { ok: false, reason: "no_image" };
  }

  // Decode base64 → bytes
  const bin = atob(imageBase64);
  const pngBytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) pngBytes[i] = bin.charCodeAt(i);

  return { ok: true, pngBytes, mimeType: imageMimeType };
}

// ── MULTI-VIEW FAN-OUT ────────────────────────────────────────────────────
// A customer revision used to edit ONLY the hero, collapsing the proof to one
// angle and desyncing the rest. The caller now edits the hero synchronously,
// carries ALL prior angles forward onto the new version, then fans these out —
// one independent proof-revise-view invocation per remaining 3D angle — so the
// same edit lands on every view and the active version keeps its full set.

// Composite/derived boards (and the already-done hero) — never image-to-image
// revised as a standalone angle.
const NON_ANGLE_KEYS = new Set([
  "hero", "production_proof", "production_artboard", "master_artboard", "product_1",
]);

/** The revisable 3D angle entries ([key, url]) from a version's render_urls. */
export function pickRevisableAngles(
  renderUrls: Record<string, string> | null | undefined,
): Array<[string, string]> {
  return Object.entries(renderUrls || {}).filter(
    ([k, v]) => typeof v === "string" && /^https?:\/\//.test(v) && !NON_ANGLE_KEYS.has(k),
  ) as Array<[string, string]>;
}

/**
 * Fire one proof-revise-view worker per non-hero angle (parallel, fire-and-
 * forget). Each worker keeps running server-side after the short dispatch abort,
 * revises its angle, and atomically patches it into the new version. Returns the
 * number of angles dispatched. Never throws.
 */
export async function fanOutViewRevisions(opts: {
  supabaseUrl: string;
  authKey: string; // service-role key (proof-revise-view is verify_jwt=false)
  proofId: string;
  versionId: string;
  priorRenderUrls: Record<string, string> | null | undefined;
  prompt: string;
  vehicleSummary?: string;
  finishType?: string;
  referenceImagePaths?: string[];
}): Promise<number> {
  const angles = pickRevisableAngles(opts.priorRenderUrls);
  if (angles.length === 0) return 0;

  const fireOne = async ([viewKey, sourceUrl]: [string, string]) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      await fetch(`${opts.supabaseUrl}/functions/v1/proof-revise-view`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.authKey}`,
          apikey: opts.authKey,
        },
        body: JSON.stringify({
          proof_id: opts.proofId,
          version_id: opts.versionId,
          view_key: viewKey,
          source_url: sourceUrl,
          prompt: opts.prompt,
          vehicle_summary: opts.vehicleSummary,
          finish_type: opts.finishType,
          reference_image_paths: opts.referenceImagePaths || [],
        }),
        signal: controller.signal,
      });
    } catch (err: any) {
      // AbortError is expected — the request was sent and the worker runs on.
      if (err?.name !== "AbortError") {
        console.warn(`fanOutViewRevisions: ${viewKey} dispatch error:`, err?.message || err);
      }
    } finally {
      clearTimeout(timer);
    }
  };

  await Promise.allSettled(angles.map(fireOne));
  return angles.length;
}
