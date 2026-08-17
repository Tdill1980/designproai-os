/**
 * cut-corpus — the words a finished render actually contains.
 *
 * Shared because TWO paths need it and neither may guess differently:
 * `send-render-to-board` writes a caption when a cut first reaches the board,
 * and `marketing-agent`'s `copy_backfill` rewrites the 45 cards that reached
 * the board before a writer existed. A cut's own words are the only honest
 * source for either, so there is one function that finds them.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * WHISPER CANNOT HEAR THE WORD "WRAP".
 *
 * Measured across the parsed library on 2026-08-13: 50 verbatim quotes and 34
 * transcripts say "rap" where the speaker plainly said "wrap" — "helping rap
 * shops everywhere become the local star", "this one's for the rap game",
 * "this is the RAPtv world". In an industry whose every sentence contains the
 * word, a leading W dropped by the transcriber corrupts the corpus at source.
 *
 * It is not a cosmetic problem: this is the exact defect that put "This is the
 * RAPtv world" onto a WrapTVWorld card. Grounding made it WORSE than useless,
 * because the wrong word genuinely was in the source.
 *
 * Fixed ON READ rather than by rewriting the stored transcripts — the original
 * Whisper output stays intact for anyone re-scoring it later, and every
 * consumer gets the corrected text without a migration.
 *
 * DELIBERATELY NARROW. Only the collocations actually observed are corrected,
 * because WrapTVWorld genuinely publishes music and "rap" can be the real
 * word. A bare "rap" is left alone.
 */
export function deWhisper(text: unknown): string {
  return String(text || "")
    .replace(/\bRAP\s?tv\b/gi, "WrapTVWorld")
    .replace(/\brap(\s+)(shop|shops|game|industry|world|business|job|jobs|film|vinyl|install|installer|installers)\b/gi,
      (_m, gap, word) => `wrap${gap}${word}`)
    .replace(/\brapped\b/gi, "wrapped")
    .replace(/\brapping\b(?=\s+(?:a|the|this|that|vehicles?|cars?|vans?|trucks?|fleets?))/gi, "wrapping");
}

/**
 * THE WORDS THIS CUT ACTUALLY CONTAINS — the only material a caption may be
 * written from.
 *
 * A finished render carries no copy: its blueprint holds scenes, and a scene is
 * a clip URL and a time window. So the corpus is assembled by going back to the
 * footage — `media_sources` for the clips in the cut, `content_moments` for the
 * verbatim lines inside each scene's own window — and it is deliberately
 * WINDOWED. A quote from 4:12 of a clip that appears in the cut from 0:00-0:05
 * was not in this video, and a caption promising it is a caption about a
 * different edit.
 *
 * Returns "" when the footage has no words. That is the honest outcome and the
 * caller keeps the placeholder: a silent b-roll cut genuinely has nothing to
 * write a grounded caption from, and inventing one is how a system starts
 * describing installs that never happened.
 */
export async function cutCorpus(supabase: any, bp: any): Promise<string> {
  const scenes: any[] = Array.isArray(bp?.scenes) ? bp.scenes : [];
  const urls = [...new Set(scenes.map((s) => String(s?.clipUrl || "").trim()).filter(Boolean))];
  const headline = [bp?.headline, bp?.title].map((v) => String(v || "").trim()).filter(Boolean);
  if (!urls.length) return headline.join(". ");

  const { data: allSources } = await supabase
    .from("media_sources")
    .select("id, storage_url, transcript, filename")
    .in("storage_url", urls.slice(0, 40));

  // ── SONG LYRICS ARE NOT SOMEBODY TALKING ─────────────────────────────────
  //
  // The house music catalog is transcribed and scored like everything else,
  // and it scores TOP: "This ain't just a business, this is who we are" and
  // "Hands up for the Wrap Family" both sit at hook 10.0, level with real
  // interview soundbites. So anything reaching for "the best moments" reaches
  // for the songs — which is why the writer kept producing anthem-flavoured
  // copy nobody said on camera.
  //
  // A track laid UNDER a cut is its soundtrack, not its dialogue. Excluded
  // here so a caption is written from what a person actually said.
  const sources = (allSources || []).filter(
    (s: any) => !/^(music|wrap-family|untitled)/i.test(String(s.filename || "")),
  );
  const byUrl = new Map<string, any>((sources || []).map((s: any) => [s.storage_url, s]));
  const ids = (sources || []).map((s: any) => s.id);
  if (!ids.length) return headline.join(". ");

  const { data: moments } = await supabase
    .from("content_moments")
    .select("source_id, start_time, end_time, verbatim_quote")
    .in("source_id", ids)
    .not("verbatim_quote", "is", null)
    .limit(400);

  const lines: string[] = [];
  for (const scene of scenes) {
    const src = byUrl.get(String(scene?.clipUrl || "").trim());
    if (!src) continue;
    // A scene names its window on the SOURCE clip (`sourceStart`/`sourceEnd`),
    // which is what a moment's timestamps are measured against — the cut's own
    // `start`/`end` are positions on the timeline and would match nothing.
    const from = Number(scene?.sourceStart ?? scene?.start ?? 0);
    const to = Number(scene?.sourceEnd ?? scene?.end ?? from + 12);
    for (const m of moments || []) {
      if (m.source_id !== src.id) continue;
      const ms = Number(m.start_time ?? 0);
      const me = Number(m.end_time ?? ms);
      // Any overlap counts: a line half inside the cut was half heard.
      if (me < from || ms > to) continue;
      const q = deWhisper(m.verbatim_quote).trim();
      if (q.length > 8 && !lines.includes(q)) lines.push(q);
    }
  }

  // ── THE WHOLE-TRANSCRIPT FALLBACK IS A LIE ON A SHORT CUT ────────────────
  //
  // This used to return the ENTIRE transcript of every clip in the cut when no
  // scored moment landed inside a scene's window. That is the words of minutes
  // of footage handed over as the source for a video that uses seconds of it,
  // and it is how a 7-second Tesla Model Y clip got a Facebook post about "a
  // customer who brought in their trusty van" — a van that is nowhere in the
  // video, described with words that were genuinely "in the source". The
  // grounding guard cannot save you from a source that is itself wrong.
  //
  // So the fallback only applies when the cut actually covers most of the
  // clip. A short excerpt of a long clip returns NOTHING, and the caller keeps
  // its placeholder — an honest gap, because nobody knows what was said in
  // those seven seconds.
  if (!lines.length) {
    const covered = scenes.reduce((sum, sc) => {
      const from = Number(sc?.sourceStart ?? sc?.start ?? 0);
      const to = Number(sc?.sourceEnd ?? sc?.end ?? from);
      return sum + Math.max(0, to - from);
    }, 0);
    const blob = (sources || [])
      .map((s: any) => deWhisper(s.transcript).trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ");
    // ~150 spoken words a minute → a transcript implies roughly this long.
    const impliedSeconds = blob.split(/\s+/).filter(Boolean).length / 2.5;
    if (blob && impliedSeconds > 0 && covered >= impliedSeconds * 0.6) {
      lines.push(blob.slice(0, 4000));
    }
  }

  return deWhisper([...headline, ...lines].join("\n")).trim();
}

/**
 * THE STRONGEST THINGS REAL CUSTOMERS HAVE ACTUALLY SAID.
 *
 * Owner, 2026-08-13, on the one ad of ten that works: "the one thats OK is one
 * built from real customer quote."
 *
 * The ad path had every rule it needed — placement, hook move, nerve, declared
 * facts — and no MATERIAL. So it wrote around the brand block and came back
 * with "Unveil the Wrap Magic". Meanwhile the library held 2,811 scored
 * verbatim quotes, including a customer doing the value proposition better
 * than copy can: "you're $20,000, $30,000 [for paint]... with wraps you're
 * probably a quarter of the price."
 *
 * These go into the ad's corpus, which means the grounding guard LICENSES
 * them: a line quoted word for word from here is real testimony that can be
 * proved, and `adClaimViolations` already permits a quotation the corpus
 * contains while refusing one it does not.
 *
 * Music is excluded for the reason it is excluded everywhere else — a song
 * lyric scores at the ceiling and is not somebody talking.
 */
export async function topCustomerQuotes(supabase: any, limit = 12): Promise<string[]> {
  const { data } = await supabase
    .from("content_moments")
    .select("verbatim_quote, hook_score, media_sources!inner(filename)")
    .not("verbatim_quote", "is", null)
    .order("hook_score", { ascending: false, nullsFirst: false })
    .limit(200);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of data || []) {
    const file = String((row as any)?.media_sources?.filename || "");
    if (/^(music|wrap-family|untitled)/i.test(file)) continue;
    const q = deWhisper((row as any).verbatim_quote).trim();
    // Long enough to be a sentence somebody said, short enough to quote in an
    // ad without a paragraph break.
    if (q.length < 45 || q.length > 260) continue;
    const key = q.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
}
