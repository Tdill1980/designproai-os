/**
 * piece-copy-writer — the one place the copy model is actually called.
 *
 * `_shared/piece-copy.ts` is pure: it builds the brief and judges the answer.
 * This is its impure half, kept in a separate module so that BOTH producers of
 * Brand Board cards — `marketing-agent`'s `actionIdeaApprove` and
 * `send-render-to-board` — write through the same call rather than each
 * carrying its own prompt.
 *
 * That split is not tidiness. The measured failure on this system is two paths
 * that were supposed to do the same thing drifting apart until only one of them
 * was fixed — the 2D-proof producer did it across four files, and the ad path
 * did it by never reading the organic path's hook module at all. One writer,
 * one prompt, one guard.
 *
 * FAILS SOFT, ALWAYS. No key, a 502, unparseable JSON, a surface the model
 * skipped — each returns nothing for that surface and the caller keeps its
 * deterministic fallback. Neither approving an idea nor landing a finished
 * render may become an action that fails because a third party is down.
 */

import { copyPrompt, type SurfaceBrief } from "./piece-copy.ts";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o";

export interface WrittenCopy {
  /** Finished copy keyed by `platform:post_type`. Missing = write nothing. */
  byKey: Record<string, string>;
  /** Why nothing came back, when nothing did. Null on success. */
  error: string | null;
}

/**
 * Write finished copy for every surface, in ONE pass.
 *
 * One pass rather than one call per surface, and that is a correctness
 * decision rather than a cost one: a writer that can see the other five drafts
 * cannot accidentally open two of them the same way. Per-surface calls are how
 * this system reached 59 rows with 9 distinct captions — each call was
 * individually fine and none of them could see the others.
 */
export async function writeSurfaceCopy(
  source: string,
  brand: unknown,
  briefs: SurfaceBrief[],
): Promise<WrittenCopy> {
  const empty: WrittenCopy = { byKey: {}, error: null };
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { ...empty, error: "OPENAI_API_KEY missing — surfaces keep their fallback line" };
  if (!briefs.length || !String(source || "").trim()) return empty;

  const { system, user } = copyPrompt(source, brand, briefs);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        // Warm enough that six surfaces do not converge on one construction,
        // cool enough to stay on the source. What makes sitting above 0 safe is
        // `pieceCopyViolations` checking the words back, not the temperature.
        temperature: 0.75,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ...empty, error: `copy ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };

    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    const pieces = parsed?.pieces && typeof parsed.pieces === "object" ? parsed.pieces : {};
    const byKey: Record<string, string> = {};
    for (const b of briefs) {
      const k = `${b.platform}:${b.postType}`;
      const v = (pieces as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim()) byKey[k] = v.trim();
    }
    return { byKey, error: null };
  } catch (e) {
    return { ...empty, error: `copy write failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
