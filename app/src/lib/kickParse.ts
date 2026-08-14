/**
 * kickParse — queueing footage should START the parser, not just file a row.
 *
 * Owner, 2026-08-05: "My entire Marketing Suite in DesignProAI only works
 * from Claude Code! I need an operating system."
 *
 * That was literally true, and this is the mechanism that made it true. Six
 * surfaces in the app insert `video_parse_jobs` — Asset Library, BrandCast
 * (upload + library add), Video Studio, Script Studio, Creator — and every one
 * of them inserted the row and stopped. Nothing in the product ever started the
 * work. The only thing that reliably made footage parse was a human or an agent
 * manually dispatching the `parse-media` workflow, which is exactly why the
 * suite appeared to "only work from Claude Code".
 *
 * The renderer never had this problem: `video-render` fires a repository_dispatch
 * the moment it enqueues. The parser had no caller at all.
 *
 * ── WHY IT NEVER THROWS ────────────────────────────────────────────────────
 * The row is already queued before this runs. A failed kick means the work
 * starts on the schedule instead of now — slower, never lost. Blowing up a
 * customer's upload because a dispatch token is missing would be strictly
 * worse than being slow.
 *
 * ── WHY IT REPORTS ─────────────────────────────────────────────────────────
 * It returns whether the kick actually landed. A kick that silently does
 * nothing looks identical to a wired one, which is the precise failure shape
 * this whole day was about — so callers can surface "queued, starting now" vs
 * "queued, waiting for the scheduled run".
 */

import { supabase } from "@/integrations/supabase/client";
import type { KickResult } from "./kickMessages";

// Re-exported so every call site keeps importing both from one place.
export { kickMessage } from "./kickMessages";
export type { KickResult } from "./kickMessages";

/**
 * Ask the parser to run now. Safe to call after every enqueue; the worker
 * drains the whole queue, so N kicks for N files is not N runs.
 */
export async function kickParse(jobId?: string | null): Promise<KickResult> {
  try {
    const { data, error } = await supabase.functions.invoke("parse-kick", {
      body: jobId ? { job_id: jobId } : {},
    });
    if (error) return { kicked: false, reason: "unreachable" };
    return { kicked: data?.kicked === true, reason: data?.reason };
  } catch {
    return { kicked: false, reason: "unreachable" };
  }
}
