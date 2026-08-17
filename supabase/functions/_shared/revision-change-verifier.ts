// revision-change-verifier.ts
//
// Honesty guard for RevisionStudioIQ. After the image-edit model returns a
// result, this compares the BEFORE and AFTER images with a Gemini vision call
// and reports whether the render VISIBLY changed in the way the customer asked.
//
// Why: image-edit models frequently return a near-identical image while their
// text summary confidently claims edits were made ("Replaced the illustrated
// guns with photorealistic firearms") — so the customer is told a revision
// happened when nothing moved. That is a trust-breaker worse than a failure.
// This lets the caller refuse to claim success (and refund the token) on a
// genuine no-op.
//
// Design:
//  - Gemini Flash vision, ~2-3s, ~$0.001/call.
//  - Compares the two images against the request; returns {changed, note}.
//  - FAIL-OPEN: on any error/timeout it returns changed=true (assume a real
//    edit) so a checker hiccup can NEVER suppress a legitimate revision. It
//    only reports changed=false when the model is clearly confident nothing
//    visibly changed.

import { getGeminiKey } from "./gemini-key-pool.ts";

const VERIFIER_MODEL = "gemini-2.5-flash";

export interface ChangeVerdict {
  changed: boolean;
  note: string;
}

async function fetchB64(url: string): Promise<{ data: string; mime: string } | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") || "image/jpeg";
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 8192) {
      bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, Math.min(i + 8192, buf.length))));
    }
    return { data: btoa(bin), mime };
  } catch {
    return null;
  }
}

/**
 * Verify a revision actually changed the image. `beforeUrl` is the source
 * render; `afterB64`/`afterMime` are the freshly generated result (already in
 * memory, so we don't re-fetch it). Returns changed=true on any uncertainty.
 */
export async function verifyRevisionChanged(
  beforeUrl: string,
  afterB64: string,
  afterMime: string,
  requestText: string,
): Promise<ChangeVerdict> {
  try {
    const before = await fetchB64(beforeUrl);
    if (!before || !afterB64) return { changed: true, note: "verifier skipped (missing image)" };

    const key = getGeminiKey();
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${VERIFIER_MODEL}:generateContent?key=${key}`;
    const instruction =
      `Two images of the SAME vehicle wrap: image 1 is BEFORE an edit, image 2 is AFTER. ` +
      `The customer asked for this SPECIFIC edit: "${requestText}". ` +
      `Look ONLY at whether THAT requested edit was actually carried out in image 2 — e.g. if they asked to MOVE or REPOSITION an element, is it actually in the new place? if they asked to recolor/remove/resize something, did that happen? ` +
      `Ignore trivial re-compression noise, lighting, and reflection differences — those do NOT count as the edit being done. ` +
      `Answer changed:false if the requested edit did NOT happen (image 2 still looks like image 1 for what was asked). ` +
      `If the requested change is clearly present, OR you are genuinely unsure, answer changed:true. ` +
      `Reply ONLY compact JSON: {"changed": true|false, "note": "<=12 words"}.`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: instruction },
            { inlineData: { mimeType: before.mime, data: before.data } },
            { inlineData: { mimeType: afterMime || "image/png", data: afterB64 } },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 60, responseModalities: ["TEXT"] },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) return { changed: true, note: `verifier HTTP ${res.status} (assumed changed)` };
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p?.text || "").join("").trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { changed: true, note: "verifier unpar_seable (assumed changed)" };
    const parsed = JSON.parse(m[0]);
    const changed = parsed?.changed !== false; // default true unless explicitly false
    console.log(`[change-verifier] changed=${changed} note="${parsed?.note || ""}"`);
    return { changed, note: String(parsed?.note || "").slice(0, 80) };
  } catch (e) {
    console.warn(`[change-verifier] error (${e instanceof Error ? e.message : e}) — assuming changed`);
    return { changed: true, note: "verifier error (assumed changed)" };
  }
}
