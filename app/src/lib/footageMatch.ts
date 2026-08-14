/**
 * footageMatch — pick the RIGHT clip for an idea, or honestly pick none.
 *
 * Owner, 2026-08-05: "Can we press that and let ai find the vids from our
 * library and drive?"
 *
 * `idea_approve` attached "the newest finished render for that brand" — not a
 * search, a shrug. Press Make it on 534 ideas and 534 drafts carry whatever
 * rendered most recently, which is the wrong video nearly every time. A wrong
 * clip is worse than none: it looks finished, so it ships.
 *
 * The signal to do this properly already exists and was simply never used:
 *
 *   media_sources     transcripts (122 clips carry real ones), titles, shoot
 *   content_moments   hook scores + verbatim quotes, per timestamp
 *   agent_media_assets titles, tags, content_type
 *   video_render_jobs finished cuts, with their blueprint title/topic
 *
 * ── DETERMINISTIC, NOT AI ──────────────────────────────────────────────────
 * Term overlap against text we already hold. No model call, so the same idea
 * always picks the same clip and the choice can be explained on the card —
 * "matched on: squeegee, panel". An LLM here would be slower, non-repeatable,
 * and would happily justify a bad pick.
 *
 * ── THE RULE THAT MATTERS ──────────────────────────────────────────────────
 * NO MATCH MEANS NO MEDIA. Returning the newest clip as a fallback is the bug
 * this replaces. A copy-only draft is honest and fixable; a confidently wrong
 * video is neither. Locked by `tests/footage-match.test.ts`.
 */

import { sameBrand } from "@/lib/brandAliases";

/**
 * Words that carry no topical signal — matching on these is noise.
 *
 * EXPANDED 2026-08-07 after a live approval matched badly. The idea "We put the
 * wrap industry on camera the way it deserves to be seen" matched a clip on
 * `["put","wrap","industry","way"]` — and the clip was an interview about SLOW
 * SEASON IN WINTER. Two of those four terms are filler, so a 4-term "match" was
 * really a 1-term match wearing three passengers, and the score (100 per term)
 * put it far above genuinely relevant footage.
 *
 * Everything added below is a word that appears in almost any sentence about
 * almost anything: common verbs (`put`, `need`, `use`, `see`, `show`), vague
 * nouns (`way`, `thing`, `stuff`, `time`) and evaluatives (`good`, `great`,
 * `best`). None of them narrows what a clip is ABOUT.
 */
/**
 * The tier a clip enters when it has parsed beats — see `scoreCandidate`.
 *
 * Larger than any relevance total that function can reach, so "can be edited"
 * is decided before "how well it matched", never alongside it.
 */
export const EDITABLE_TIER = 10_000;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "you", "your", "our", "are",
  "was", "were", "has", "have", "had", "not", "but", "all", "can", "will",
  "from", "they", "them", "how", "why", "what", "when", "who", "its", "it's",
  "get", "got", "out", "one", "two", "new", "now", "just", "like", "then",
  "than", "into", "over", "off", "his", "her", "she", "him", "their", "there",
  "here", "been", "more", "most", "some", "any", "every", "about", "after",
  "before", "because", "make", "made", "does", "did", "doing", "were", "very",
  // — added after the bad live match —
  "put", "puts", "way", "ways", "need", "needs", "needed", "use", "uses",
  "used", "see", "seen", "saw", "look", "looks", "show", "shows", "shown",
  "thing", "things", "stuff", "time", "times", "good", "great", "best",
  "better", "want", "wants", "know", "knows", "take", "takes", "give",
  "gives", "come", "comes", "keep", "keeps", "let", "lets", "must", "should",
  "would", "could", "don't", "doesn't", "won't", "isn't", "aren't",
]);

/**
 * Words that are TRUE of nearly every clip in this library, so matching on
 * them proves nothing.
 *
 * Distinct from a stopword: these are real, meaningful, on-topic words. They
 * simply do not DISCRIMINATE here — a wrap-footage library where every clip
 * mentions "wrap" gets no information from the term. This is the idea behind
 * inverse document frequency, stated explicitly rather than computed, because
 * an explicit list can be read and argued with.
 *
 * They still COUNT toward the score (a clip about wraps is better than one
 * about nothing), but a match made ONLY of these is not a match — see
 * `meaningfulTerms`.
 */
export const DOMAIN_COMMON = new Set([
  "wrap", "wraps", "wrapped", "wrapping", "vinyl", "car", "cars", "vehicle",
  "vehicles", "truck", "trucks", "van", "vans", "install", "installs",
  "installed", "installation", "shop", "shops", "print", "printed", "printing",
  "graphics", "design", "designs",
]);

/** The terms in a match that actually narrow what the footage is about. */
export function meaningfulTerms(matched: string[]): string[] {
  return (matched || []).filter((t) => !DOMAIN_COMMON.has(String(t).toLowerCase()));
}

/**
 * ── WHAT A CLIP IS, DECIDED FROM THE FILE THAT WILL ACTUALLY BE CUT ─────────
 *
 * Owner, 2026-08-10, looking at the Assist picker: "It's offering .mp3 files as
 * clips to cut — musicvideo-final-heat-gun_reel.mp3, ghost-industries-…44997.mp3."
 *
 * The names are real and the alarm was right. The diagnosis was not, and the
 * obvious fix — refuse anything whose name ends `.mp3` — would have been the
 * expensive mistake. Measured on production the same day, over the 427
 * `agent_media_assets` rows typed `asset_type = 'video'`:
 *
 *   151  carry a title / original_filename ending `.mp3`
 *   151  of those 151 have a storage_url ending `.mp4`
 *     0  have a storage_url that is audio at all
 *
 * They are VIDEOS, and they are the best videos in the library — the same rows
 * carry 200–355 parsed beats each, the top of the editable pool. The `.mp3` is
 * the name the parser recorded when it extracted the audio track to send to
 * Whisper; `media_sources.filename` kept that name while `storage_url` went on
 * pointing at the real `.mp4`. Filtering on the visible name would have deleted
 * the 151 most cuttable clips from the one picker that exists to end refusals —
 * making the refusal backlog worse while looking like a fix.
 *
 * So the rule is: JUDGE THE URL, LABEL FROM THE URL, and never trust a recorded
 * filename about what a file IS. `isAudioFile` still exists and is still
 * enforced, because a genuinely mis-typed row is a documented recurrence in this
 * codebase (CLAUDE.md records an mp3 catalogue vanishing into a video picker
 * three separate times) — it is simply pointed at the field that decides what
 * gets fed to ffmpeg, not at the field a human reads.
 *
 * UNKNOWN EXTENSIONS PASS. A Drive link, a signed url and an extensionless
 * object all resolve to "" here, and refusing those would silently empty the
 * pool for every Drive-ingested clip. Only a POSITIVE audio signal refuses —
 * the same discipline as DOMAIN_COMMON above, where turning weak evidence into
 * a rejection cost more coverage than it ever bought accuracy.
 */
const AUDIO_EXT = new Set([
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "aif", "aiff", "wma", "opus",
]);
const VIDEO_EXT = new Set([
  "mp4", "mov", "m4v", "webm", "mkv", "avi", "mpg", "mpeg", "mts", "m2ts",
]);

/** The last path segment of a url or filename, query and hash removed. */
export function baseNameOf(nameOrUrl: string | null | undefined): string {
  const s = String(nameOrUrl || "").trim();
  if (!s) return "";
  const path = s.split(/[?#]/)[0];
  const base = path.slice(path.lastIndexOf("/") + 1);
  // Storage keys can be percent-encoded; a malformed escape must not throw
  // inside a render pass, so the raw value is the fallback.
  try { return decodeURIComponent(base); } catch { return base; }
}

function extOf(nameOrUrl: string | null | undefined): string {
  const base = baseNameOf(nameOrUrl);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Does this name or url positively say AUDIO? Unknown extensions say nothing. */
export function isAudioFile(nameOrUrl: string | null | undefined): boolean {
  return AUDIO_EXT.has(extOf(nameOrUrl));
}

/** Does this name or url positively say VIDEO? Unknown extensions say nothing. */
export function isVideoFile(nameOrUrl: string | null | undefined): boolean {
  return VIDEO_EXT.has(extOf(nameOrUrl));
}

/**
 * Can an edit be cut from this url at all?
 *
 * The ONE gate every clip picker and every unattended pass runs before offering
 * a candidate. False only when the url itself is audio — see the header above
 * for why a recorded filename is not allowed to answer this question.
 */
export function cuttableMedia(url: string | null | undefined): boolean {
  return !!String(url || "").trim() && !isAudioFile(url);
}

/**
 * What to CALL a clip, when its recorded name disagrees with its own file.
 *
 * Purely a display fix, and the visible half of the bug above: the picker was
 * showing `musicvideo-final-heat-gun_reel.mp3` beside a `212 beats` badge for a
 * file that is `musicvideo-final-heat-gun_reel.mp4`. Nothing was wrong with the
 * clip and nothing was wrong with the ranking — it simply read, to anyone
 * glancing at it, as a song being offered as install footage. A picker that
 * cannot be trusted at a glance does not get used.
 *
 * The name is only overridden when it is DEMONSTRABLY about a different medium
 * than the file: name says audio, url says video. Every other row keeps the
 * title a human gave it.
 */
export function clipLabel(
  name: string | null | undefined,
  url: string | null | undefined,
): string | null {
  const recorded = String(name || "").trim();
  if (recorded && !(isAudioFile(recorded) && isVideoFile(url))) return recorded;
  return baseNameOf(url) || recorded || null;
}

export function terms(text: string | null | undefined): string[] {
  const raw = String(text || "").toLowerCase().replace(/[^a-z0-9\s'-]/g, " ");
  const out = new Set<string>();
  for (const w of raw.split(/\s+/)) {
    const t = w.replace(/^['-]+|['-]+$/g, "");
    if (t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return [...out];
}

/**
 * The vision pass's report for one asset row, as a clean lowercased list.
 *
 * `visual_tags` is jsonb written by `worker/video-renderer/tagLibrary.js`; the
 * terms live under `machine_tags`. It lives HERE rather than beside the query
 * that selects it because it is matcher logic, and because `sourceFootage.ts`
 * imports the Supabase client — a helper there cannot be unit-tested without
 * a browser. One definition, reachable from both.
 *
 * Shape-tolerant on purpose: a null, bare-array or malformed column yields an
 * empty list rather than throwing. This runs on every press and inside an
 * unattended pass.
 */
export function machineTagsOf(a: Record<string, any> | null | undefined): string[] {
  const v = a?.visual_tags;
  const raw = Array.isArray(v) ? v : Array.isArray(v?.machine_tags) ? v.machine_tags : [];
  return raw.map((t: unknown) => String(t || "").toLowerCase().trim()).filter(Boolean);
}

export interface FootageCandidate {
  /** Where it plays. */
  url: string;
  /** Everything searchable about it: transcript, title, tags, quotes. */
  text: string;
  /** Higher is better among equally-relevant clips (hook score, 0-100). */
  score?: number | null;
  /** Newer wins ties. ISO string. */
  createdAt?: string | null;
  /** A finished cut beats raw footage for a social post. */
  isFinishedCut?: boolean;
  /**
   * The terms the VISION pass reported seeing in the frames
   * (`agent_media_assets.visual_tags.machine_tags`), already lowercased.
   *
   * ── WHY THIS FIELD EXISTS ────────────────────────────────────────────────
   * Selection matched on filenames, folders and human tags — words somebody
   * TYPED. The vision pass has been recording what is actually ON SCREEN
   * (squeegee, gloved hands, heat gun, vehicle) on every parsed clip, and
   * nothing read it. Measured 2026-08-08: zero references to `visual_tags`
   * in this file, in `sourceFootage.ts`, or in the worker twin.
   *
   * That is why a "Behind the Install" contained a man adjusting a mic and
   * somebody holding vinyl with no install happening: the clips were named
   * and tagged for the right shop, and no part of the system asked whether
   * the work was in the picture.
   *
   * A word here is worth MORE than the same word in a filename — see the
   * score. A filename is a claim; a machine tag is a description of frames
   * that a human can check by opening the clip.
   */
  seenOnScreen?: string[] | null;
  brand?: string | null;
  label?: string | null;
  /**
   * How many parsed BEATS this clip has (`content_moments` on its
   * `media_sources` row). Zero means an edit cannot be built from it.
   *
   * ── WHY THIS OUTRANKS EVERYTHING ─────────────────────────────────────────
   * The editor brain reasons over beats. Handed a clip with none it refuses,
   * correctly, and the piece becomes a one-clip stub instead of an edit — the
   * Brand Board's "BRAIN REFUSED ×47 … this clip has never been parsed".
   *
   * Selection could not see this. It ranked on filenames, folders, typed tags
   * and vision terms, so it picked beatless clips constantly while editable
   * ones sat unused. Measured against production 2026-08-10, of 427 raw video
   * clips: 153 carry more than three beats and 18 carry one to three — 171
   * ready to cut — while 162 have a parsed source with zero beats and 94 were
   * never parsed. The good half was always there; nothing pointed at it.
   */
  beatCount?: number | null;
}

export interface FootageMatch {
  url: string;
  label: string | null;
  /** The idea terms that actually appeared — shown to a human, not decoration. */
  matchedOn: string[];
  isFinishedCut: boolean;
}

/**
 * How well one clip answers one idea.
 *
 * Distinct matched terms, weighted so a finished cut edges out raw footage of
 * equal relevance — a social draft wants something watchable, not rushes.
 * Relevance always outranks that bonus: a raw clip that matches three terms
 * beats a finished cut that matches one.
 */
export function scoreCandidate(ideaTerms: string[], c: FootageCandidate): { score: number; matchedOn: string[] } {
  if (!c?.url) return { score: 0, matchedOn: [] };
  // The haystack is what somebody TYPED plus what the camera SAW. Vision terms
  // join it here rather than only at the query, so the scorer is self-contained
  // and a caller that hands over `seenOnScreen` cannot end up with evidence the
  // scorer silently ignores.
  const seen = (c.seenOnScreen || []).map((t) => String(t || "").toLowerCase().trim()).filter(Boolean);
  const hay = [String(c.text || "").toLowerCase(), seen.join(" ")].filter(Boolean).join(" ");
  if (!hay.trim()) return { score: 0, matchedOn: [] };

  const matchedOn = ideaTerms.filter((t) => hay.includes(t));
  if (!matchedOn.length) return { score: 0, matchedOn: [] };

  // Each real term is worth far more than any tiebreaker, so relevance can
  // never be outvoted by recency or a hook score.
  //
  // DOMAIN-COMMON TERMS COUNT FOR LESS, they are not refused. A first version
  // of this REJECTED any match made only of words like "wrap"/"install"/"van",
  // and that was the wrong instrument: it turned a weak match into NO match,
  // stripping footage from perfectly reasonable domain-heavy ideas ("wrap
  // install on a van" matched nothing at all) — which is a worse failure than
  // the one being fixed, because the piece then ships with no video.
  //
  // Weighting gets the ranking right without costing coverage. The live case:
  // "We put the wrap industry on camera the way it deserves to be seen"
  // matched an interview about SLOW SEASON on ["put","wrap","industry","way"].
  // `put`/`way` are now stopwords; `wrap` scores 15 instead of 100, so a clip
  // matching one genuinely specific term still outranks it, while a clip that
  // only shares the domain remains findable when nothing better exists.
  const meaningful = matchedOn.filter((t) => !DOMAIN_COMMON.has(t));
  let score = meaningful.length * 100 + (matchedOn.length - meaningful.length) * 15;

  // WHAT THE CAMERA SAW, WEIGHTED ABOVE WHAT SOMEBODY TYPED.
  //
  // A term the vision pass reported is evidence about the FRAMES. A term in a
  // filename is a claim about the file. When an idea asks for an install and
  // one clip merely has "install" in its name while another was seen to
  // contain a squeegee, the second is the one worth cutting — and until now
  // they scored identically, which is exactly how a show about installing
  // ended up with nobody installing in it.
  //
  // Additive, never a gate: a clip with no vision tags (the parser has not
  // reached it, or it is a still) scores exactly as it did before. Nothing
  // goes dark, and a pool with no parsed clips still matches.
  if (seen.length) {
    const seenText = seen.join(" ");
    const onScreen = meaningful.filter((t) => seenText.includes(t));
    score += onScreen.length * 120;
  }

  if (c.isFinishedCut) score += 40;
  score += Math.min(30, Math.max(0, Number(c.score) || 0) / 4);

  // A CLIP THAT CAN BE EDITED OUTRANKS ONE THAT CANNOT — always.
  //
  // This is a TIER, not a bonus, and deliberately larger than any relevance
  // total this function can produce (terms are capped well below 100, so the
  // ceiling is a few thousand). A clip matching five terms with no beats still
  // loses to a clip matching one term with beats, and that is correct: the
  // first one cannot become an edit at all. It produces a refusal, and a
  // refusal helps nobody, however well it matched.
  //
  // It is NOT a gate. A beatless clip keeps its full relevance score and stays
  // selectable when nothing parsed matches — the same lesson the DOMAIN_COMMON
  // weighting records above, where refusing weak matches turned them into NO
  // match and shipped pieces with no video at all. Nothing goes dark here.
  //
  // It also ends the recursion quietly. A finished cut is a render, not a
  // parsed source, so it carries no beats and now loses to any raw clip that
  // does — which is why the unattended pass kept re-cutting its own output and
  // the feed read as the same videos over and over.
  if ((Number(c.beatCount) || 0) > 0) score += EDITABLE_TIER;
  return { score, matchedOn };
}

/**
 * The best clip for an idea, or NULL.
 *
 * Null is a real answer. It means "we have nothing about this", which is worth
 * saying out loud instead of quietly attaching last week's reel.
 */
export function pickFootage(
  ideaText: string,
  candidates: FootageCandidate[],
  /**
   * `exclude` — urls already spoken for.
   *
   * Without it, one idea fanned across eleven channels gets the SAME clip
   * eleven times: `pickFootage` is deterministic and always returns the single
   * highest-scoring match, so every channel asking the same question gets the
   * same answer. Eleven pieces built on identical footage is not a content
   * set, it is one video posted eleven times — and it defeats the entire
   * point of giving each channel its own angle.
   *
   * Passing the urls already chosen for this idea makes each subsequent pick
   * reach for the next-best clip instead. When the library genuinely runs out
   * of distinct matches this returns NULL, which is the honest answer: better
   * to say "no more footage for this" than to repeat a clip and let a human
   * discover it after publishing.
   */
  opts: { brand?: string | null; minTerms?: number; exclude?: Iterable<string> } = {},
): FootageMatch | null {
  const ideaTerms = terms(ideaText);
  if (!ideaTerms.length) return null;
  const minTerms = Math.max(1, opts.minTerms ?? 1);

  const excluded = new Set<string>();
  for (const u of opts.exclude || []) excluded.add(String(u || "").trim());

  let best: { c: FootageCandidate; score: number; matchedOn: string[] } | null = null;
  for (const c of candidates || []) {
    // Already used for this idea — reach for the next-best clip instead.
    if (excluded.size && excluded.has(String(c.url || "").trim())) continue;
    // A brand's own footage only — cross-posting another brand's cut is a
    // different mistake from posting nothing.
    //
    // Compared on the CANONICAL brand, not the raw string. Exact equality here
    // meant a piece filed as `wraptv` could not match a clip filed as
    // `wraptvworld` — not "matched poorly", could not match — so nine live
    // pieces looped as `needs_footage` forever, reporting a footage shortage
    // that was really a spelling. `wraptv` is a documented alias in three other
    // producers (content-tags, hookOverlay, the worker's logo table): same
    // label, same colour, same typography, same logo. This is the fourth place
    // that has to agree, and it was the only one comparing raw text.
    if (opts.brand && c.brand && !sameBrand(c.brand, opts.brand)) continue;

    const { score, matchedOn } = scoreCandidate(ideaTerms, c);
    if (score <= 0 || matchedOn.length < minTerms) continue;


    if (!best || score > best.score) { best = { c, score, matchedOn }; continue; }
    if (score === best.score) {
      // Deterministic tiebreak: newer first, then url, so the same inputs
      // always give the same pick.
      const a = String(c.createdAt || ""), b = String(best.c.createdAt || "");
      if (a > b || (a === b && c.url < best.c.url)) best = { c, score, matchedOn };
    }
  }

  if (!best) return null;
  return {
    url: best.c.url,
    label: best.c.label ?? null,
    matchedOn: best.matchedOn.slice(0, 6),
    isFinishedCut: !!best.c.isFinishedCut,
  };
}

/** One line for the toast — names the clip and WHY, or says there was none. */
export function matchSummary(m: FootageMatch | null): string {
  if (!m) return "No footage matched this idea — the drafts are copy-only. Attach a clip in Content Director.";
  const what = m.isFinishedCut ? "finished cut" : "raw clip";
  return `Matched a ${what}${m.label ? ` (${m.label})` : ""} on: ${m.matchedOn.join(", ")}.`;
}
