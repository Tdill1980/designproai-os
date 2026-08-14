/**
 * assetContentType — the Asset Library taxonomy and its DETERMINISTIC
 * classifier.
 *
 * Every raw asset (video, photo, music) carries a content_type so the library
 * can be browsed by what the footage IS, not just by file kind. Classification
 * is keyword-deterministic first (filename + Drive folder path + transcript +
 * tags + the vision pass's machine tags) so it is free, instant, reproducible
 * and testable; an AI pass only ever fills what the rules genuinely can't
 * decide.
 *
 * Pure functions — locked by tests/asset-content-type.test.ts.
 */

export type AssetContentType =
  | "install"        // installer at work: squeegee, heat gun, panel laying
  | "vehicle_only"   // finished vehicle beauty shots, no people, no talking
  | "unboxing"       // opening a roll/box/shipment
  | "ugc"            // customer / phone-shot / testimonial-style
  | "documentary"    // interview-led, shop-story, Behind Shop Doors
  | "film"           // produced/cinematic b-roll, shot for edit
  | "music"          // audio track
  | "product"        // swatches, product stills, catalog imagery
  | "unclassified";  // honest gap — never guessed

export const CONTENT_TYPES: Array<{
  key: AssetContentType; label: string; emoji: string;
  /** Tailwind classes — the library's colour coding. */
  chip: string; dot: string;
}> = [
  { key: "install",      label: "Install",      emoji: "🔧", chip: "bg-blue-100 text-blue-800 border-blue-300",         dot: "bg-blue-500" },
  { key: "vehicle_only", label: "Vehicle only", emoji: "🚗", chip: "bg-emerald-100 text-emerald-800 border-emerald-300", dot: "bg-emerald-500" },
  { key: "unboxing",     label: "Unboxing",     emoji: "📦", chip: "bg-amber-100 text-amber-800 border-amber-300",       dot: "bg-amber-500" },
  { key: "ugc",          label: "UGC",          emoji: "📱", chip: "bg-pink-100 text-pink-800 border-pink-300",          dot: "bg-pink-500" },
  { key: "documentary",  label: "Documentary",  emoji: "🎙️", chip: "bg-purple-100 text-purple-800 border-purple-300",    dot: "bg-purple-500" },
  { key: "film",         label: "Film / B-roll", emoji: "🎬", chip: "bg-indigo-100 text-indigo-800 border-indigo-300",   dot: "bg-indigo-500" },
  { key: "music",        label: "Music",        emoji: "🎵", chip: "bg-orange-100 text-orange-800 border-orange-300",    dot: "bg-orange-500" },
  { key: "product",      label: "Product",      emoji: "🏷️", chip: "bg-teal-100 text-teal-800 border-teal-300",         dot: "bg-teal-500" },
  { key: "unclassified", label: "Unclassified", emoji: "❔", chip: "bg-gray-100 text-gray-600 border-gray-300",          dot: "bg-gray-400" },
];

export function contentTypeMeta(key?: string | null) {
  return CONTENT_TYPES.find((c) => c.key === key) || CONTENT_TYPES[CONTENT_TYPES.length - 1];
}

/** Media kind, derived from the URL/filename — audio must never fall through. */
export function detectAssetKind(nameOrUrl: string): "video" | "image" | "audio" | "unknown" {
  const s = String(nameOrUrl || "").toLowerCase().split("?")[0];
  if (/\.(mp3|wav|m4a|aac|flac|ogg)$/.test(s)) return "audio";
  if (/\.(mp4|mov|webm|m4v|avi|mts|mkv)$/.test(s)) return "video";
  if (/\.(jpe?g|png|webp|gif|heic|tiff?)$/.test(s)) return "image";
  return "unknown";
}

// ── asset_type: THE OTHER COLUMN, AND IT HAS THE SAME FAILURE MODE ──────────
//
// `content_type` says what the footage IS. `asset_type` says what KIND OF FILE
// it is, and every picker in the app filters on it too. CLAUDE.md records the
// same bug three times over on this column:
//
//   "`asset_type` MUST detect audio. Every uploader needs an explicit audio
//    branch (extension + mime). An mp3 falling through to 'video' or 'image'
//    is why a whole song catalogue 'disappeared' THREE separate times."
//
// It kept coming back because there was no ONE function to fix — eleven call
// sites each re-derived `asset_type` inline from their own regex, and five of
// them had no audio branch at all (measured 2026-08-07: CutEditor's two
// uploaders, BrandCast's `uploadFootage`, drive-sync's binary ingest, and
// wpw-workforce-sweep's `ingest_media`). Patching the DATA is what the two
// `sql/seed-music-library*.sql` hand-fixes did, and the catalogue vanished
// again, because the data was never where the bug lived.
//
// So `resolveAssetType` is to `asset_type` what `classifyAsset` is to
// `content_type`: the one implementation, and every ingest path calls it.
// Restated for Deno in `supabase/functions/_shared/asset-type.ts`; the two are
// driven through one shared case table by `tests/asset-type-lock.test.ts`,
// which ALSO fails the build if a new file inserts into `agent_media_assets`
// without going through one of them.

/** The three kinds of raw material the library pool holds. */
export type RawAssetType = "video" | "image" | "audio";

export const RAW_ASSET_TYPES: RawAssetType[] = ["video", "image", "audio"];

export interface AssetTypeInput {
  /** The name on the person's disk. The strongest signal for an upload. */
  filename?: string | null;
  /** `File.type` / the HTTP content-type. The "+ mime" half of the mandate. */
  mimeType?: string | null;
  /** Where it landed (or a pasted link) — the only signal a URL attach has. */
  url?: string | null;
}

/** A mime type's media family, or null when it says nothing usable. */
function kindFromMime(mime: unknown): RawAssetType | null {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  if (!m) return null;
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  // `application/octet-stream` is the browser saying "I don't know" — it must
  // NOT be read as a family, or every unknown upload silently becomes one.
  return null;
}

/**
 * The `asset_type` for ONE incoming file. The single decision, for every
 * uploader in the app.
 *
 * ── IT CANNOT RETURN `rendered_video`, AND THAT IS THE POINT ───────────────
 * `rendered_video` means "a finished cut this system produced". It is excluded
 * from the raw pool by design (`worker/video-renderer/intelligence.js`
 * `EXCLUDED_ASSET_TYPES`, `classify.js` `RAW_POOL_ASSET_TYPES`, and every
 * picker), so a human upload typed that way is invisible to the whole content
 * side — the operator uploads footage for two days and "the AI produces
 * nothing" from it. The return type here is the three RAW kinds and nothing
 * else, so no uploader can emit it even by accident. The ONE legitimate writer
 * of `rendered_video` is the renderer registering its own output
 * (`worker/video-renderer/index.js`), which knows it is a render because it
 * just made it — it does not, and must not, call this.
 *
 * ── SIGNAL ORDER IS THE POLICY ─────────────────────────────────────────────
 * filename → mime → url. The filename is what the PERSON's own file says and
 * leads for the same reason the content classifier puts human-authored signals
 * first. The mime is next: browsers report it correctly for known types and
 * report nothing (or `application/octet-stream`) otherwise, so it is a good
 * second opinion and a poor first one. The URL is last and is usually the only
 * signal a pasted-link attach has at all.
 *
 * ── THE FALLBACK IS THE VISIBLE ONE, DELIBERATELY ──────────────────────────
 * A file no signal identifies falls back to `video`, and that choice is not
 * arbitrary: `image` is SILENTLY EXCLUDED from the Clip Library query
 * (`asset_type.neq.image`), so a mistyped image row becomes invisible rather
 * than merely wrong, while a mistyped `video` row shows a broken thumbnail —
 * loud, and correctable by hand. The fallback is only reachable when filename,
 * mime AND url all say nothing, which no audio file can do: `.mp3` names it,
 * `audio/mpeg` names it, and a URL ending `.mp3` names it.
 *
 * Returns the reason too, so an ingest can record WHY it typed a row the way
 * it did and a human can disagree with it.
 */
export function resolveAssetType(input: AssetTypeInput): { assetType: RawAssetType; reason: string } {
  const src = input && typeof input === "object" ? input : {};

  const byFilename = detectAssetKind(String(src.filename || ""));
  if (byFilename !== "unknown") return { assetType: byFilename, reason: `filename extension (${src.filename})` };

  const byMime = kindFromMime(src.mimeType);
  if (byMime) return { assetType: byMime, reason: `mime type (${src.mimeType})` };

  const byUrl = detectAssetKind(String(src.url || ""));
  if (byUrl !== "unknown") return { assetType: byUrl, reason: "url extension" };

  return {
    assetType: "video",
    reason: "no filename extension, mime type or url extension identified this file — typed 'video' because it is the VISIBLE fallback (an 'image' row is silently dropped by the Clip Library query); correct it by hand if it is wrong",
  };
}

export interface ClassifyInput {
  filename?: string | null;
  /** Drive folder path / source_folder — the strongest signal in practice. */
  folder?: string | null;
  transcript?: string | null;
  tags?: string[] | null;
  /**
   * The vision pass's description of the frames —
   * `agent_media_assets.visual_tags.machine_tags`, written by
   * `worker/video-renderer/tagLibrary.js`.
   *
   * Kept a SEPARATE field from `tags` on purpose. `tags` is what a person
   * typed; this is what a model reported seeing, and the two are not the same
   * kind of claim (see the haystack order below). Merging them would make the
   * `reason` string unable to tell a human which one it was.
   */
  machineTags?: string[] | null;
  kind?: "video" | "image" | "audio" | "unknown";
}

// Ordered rules — FIRST match wins, so the most specific patterns lead.
// Deliberately narrow: a rule fires on real vocabulary from this business,
// never on a generic word that would mislabel half the archive.
const RULES: Array<{ type: AssetContentType; re: RegExp }> = [
  { type: "unboxing",     re: /\bunbox|opening[-_\s]?(the[-_\s]?)?(box|roll|shipment|package)|just[-_\s]arrived|fresh[-_\s]off[-_\s]the[-_\s](printer|press)/i },
  { type: "documentary",  re: /\bbehind[-_\s]?shop[-_\s]?doors|\bbsd\b|documentar|\binterview|\bsit[-_\s]?down\b|shop[-_\s]?tour|\bepisode\b|\bpodcast/i },
  { type: "ugc",          re: /\bugc\b|customer[-_\s](clip|video|shot|submission)|testimonial|\breview\b|phone[-_\s]?shot|submitted/i },
  // `talking-head` — 10 rows in production, and it sits BELOW `ugc` on purpose.
  // A talking head is an interview, so on its own it is documentary. But every
  // one of those 10 rows ALSO carries the human tag `ugc`, and a founder or a
  // customer talking to a phone is exactly what `ugc` means in this taxonomy
  // ("customer / phone-shot / testimonial-style"). Folded into the documentary
  // rule at position 2 this would have OUTRANKED `ugc` and silently re-typed
  // all ten away from what a person had already said they were — zero rows
  // gained, ten rows overridden. Here it decides only the case the human left
  // open: a talking head with no `ugc` claim beside it.
  { type: "documentary",  re: /\btalking[-_\s]?head/i },
  { type: "install",      re: /\binstall|squeegee|heat[-_\s]?gun|wrapping|\bapplying|\bpanel[-_\s]?lay|\btuck(ing)?\b|\bbagging\b|post[-_\s]?heat/i },
  { type: "film",         re: /\bb[-_\s]?roll\b|\bcinematic|\bfilm\b|\bdrone\b|\bslider\b|\bgimbal\b|colou?r[-_\s]?grade/i },
  { type: "vehicle_only", re: /\bfinished\b|\bcompleted\b|\breveal\b|\bbeauty[-_\s]?shot|\bwalk[-_\s]?around|\bhero[-_\s]?shot|\bafter[-_\s]?shot|\bfinal[-_\s]?wrap/i },
  { type: "product",      re: /\bswatch|\bsample\b|\bcatalog|\bproduct[-_\s]?(shot|photo)|\bcolor[-_\s]?chart|\broll[-_\s]?shot/i },
];

// ── VOCABULARY DELIBERATELY NOT ADDED ──────────────────────────────────────
// Measured against the production tag histogram 2026-08-07. Each of these was
// considered and REFUSED, because a wrong `content_type` is worse than none:
// it silently excludes a clip from every picker that filters on the column,
// where NULL at least reads as "nobody has looked yet".
//
// `musicvideo-final` / `musicvideo` (10 rows) — WrapTVWorld music videos.
//   `music` is plainly wrong: in this taxonomy `music` is an audio TRACK and
//   these are video. `film` is the tempting fit and is still wrong — `film`
//   means "produced/cinematic b-roll, shot for edit", i.e. raw material you
//   cut FROM, and a `musicvideo-final` is the finished cut you would cut TO.
//   Typing finished output as raw material is precisely the failure CLAUDE.md
//   records for renders and archived audio masters ("the library is what you
//   cut FROM"); typing masters as `music` buried the real song catalogue under
//   ~100 interview tracks. These rows want an out-of-pool value a human sets,
//   and `render` is deliberately unproducible from here. Honest gap instead.
// `shop` (17) — bare "shop" is a place, not a content type; the documentary
//   rule already requires the specific phrase `shop tour`.
// `printed-wrap` (9) · `commercial` (5) · `wrap-sesh` (4) · `off-road` (4) —
//   none maps cleanly onto exactly one type.
// `ghost-industries` (98) · `houdini-wraps` (55) — CUSTOMER names. A customer
//   is not a content type, and guessing here would mislabel 153 rows at once.

/**
 * Classify one asset. Returns the type plus WHY (the matched signal), so the
 * library can show its reasoning and a human can correct it.
 */
export function classifyAsset(input: ClassifyInput): { type: AssetContentType; reason: string } {
  const kind = input.kind || detectAssetKind(input.filename || "");
  if (kind === "audio") return { type: "music", reason: "audio file" };

  const tagText = (input.tags || []).join(" ");
  const machineTagText = (input.machineTags || []).join(" ");
  // ── THE HAYSTACK ORDER IS THE POLICY ──────────────────────────────────────
  // Folder path first: a Drive folder called "04 – Install Footage" is a far
  // more reliable label than any single filename. Folder, tags and filename
  // are all AUTHORED BY A PERSON — someone chose to file it there, tag it
  // that, name it that — so they lead.
  //
  // MACHINE TAGS SIT BELOW ALL THREE. `visual_tags.machine_tags` is a vision
  // model's report of what is in the frames: evidence, not testimony. It is
  // checkable (open the clip, look) but it is a description, and a person's
  // own filing beats a model's description of the same clip every time. This
  // is the rung that makes the vision pass pay for itself — until now the one
  // pass that actually LOOKS at the footage was disconnected from the one
  // function that decides what the footage IS.
  //
  // …but it sits ABOVE `transcript`, and that ordering is deliberate. A
  // machine tag says a squeegee was ON SCREEN across sampled frames; a
  // transcript hit says the word "squeegee" was SAID once, possibly in
  // passing, in a clip about something else. That is why the transcript was
  // already last. (Measured 2026-08-07: 0 of 749 rows carry a transcript, so
  // this ordering is currently unobservable in production — it is decided on
  // principle, not on data, and that is stated rather than dressed up.)
  const haystacks: Array<[string, string]> = [
    [String(input.folder || ""), "folder"],
    [tagText, "tag"],
    [String(input.filename || ""), "filename"],
    // Labelled distinctly so a human reading `classified_reason` can tell WHAT
    // KIND of claim decided it: `folder:`/`tag:` are checkable against a
    // person's intent, `machine tag:` only against a frame.
    [machineTagText, "machine tag"],
    [String(input.transcript || "").slice(0, 1500), "transcript"],
  ];
  for (const [text, where] of haystacks) {
    if (!text.trim()) continue;
    for (const rule of RULES) {
      if (rule.re.test(text)) {
        const hit = (text.match(rule.re) || [""])[0].trim();
        return { type: rule.type, reason: `${where}: "${hit}"` };
      }
    }
  }
  // A photo with no signal is far more often a product/vehicle still than
  // footage, but we do NOT guess between them — honest gap.
  return { type: "unclassified", reason: "no matching signal" };
}

// ── ONE CLIP, SEVERAL USES ─────────────────────────────────────────────────
//
// `classifyAsset` stops at the first rule that fires, and for a single label
// that is right. But a clip is not a single label. An installer laying a panel
// while explaining what he is doing is an INSTALL and a DOCUMENTARY and, shot
// on a phone, a UGC — one upload, three legitimate uses. First-match-wins gave
// it exactly one, and `documentary` sits above `install` in `RULES`, so that
// clip answered the documentary picker and was invisible to every install
// picker in the app. The footage was never missing. It was spent.
//
// This matters most where a show declares what it needs. `showFormats.ts`
// records the gap in its own words: Behind the Install "genuinely needs INSTALL
// FOOTAGE" and can be satisfied from `content_type === 'install'`, "which 24
// library assets carry". Twenty-four, out of a library whose whole business is
// wrapping vehicles. The other install clips exist — they were labelled as the
// interview they also are.
//
// So the scan is the same scan, with the early return removed: same `RULES`,
// same haystack order, same `reason` strings. No rule is added, none reworded,
// no threshold introduced. `classifyAsset` is now literally the first element
// of this list, which is why the single-label behaviour cannot drift from the
// multi-label one — there is one traversal, not two.

export interface ClassifyMatch {
  type: AssetContentType;
  /** The matched signal, same shape as `classifyAsset` — `folder: "install"`. */
  reason: string;
}

export interface ClassifyAllResult {
  /** Every type this asset can legitimately serve, strongest signal first. */
  types: AssetContentType[];
  /** Per-type evidence, so a human can see why each use was claimed. */
  matches: ClassifyMatch[];
  /**
   * The single best label — byte-identical to `classifyAsset().type`, so the
   * existing `content_type` column keeps its exact meaning and nothing that
   * reads it changes behaviour.
   */
  primary: AssetContentType;
  primaryReason: string;
}

/**
 * Classify one asset into EVERY use it can serve.
 *
 * `types` is empty when nothing matched — an honest gap, never `["unclassified"]`
 * dressed up as a label. `primary` still reports `unclassified` in that case
 * because that is what the single-value column has always stored.
 */
export function classifyAssetAll(input: ClassifyInput): ClassifyAllResult {
  const kind = input.kind || detectAssetKind(input.filename || "");
  // An mp3 is a track and nothing else. A song is not also an install, and
  // letting the word "install" in a filename add a second use here would put
  // audio into video pickers — the exact shape of the bug that buried the song
  // catalogue three times.
  if (kind === "audio") {
    const m: ClassifyMatch = { type: "music", reason: "audio file" };
    return { types: ["music"], matches: [m], primary: "music", primaryReason: m.reason };
  }

  const tagText = (input.tags || []).join(" ");
  const machineTagText = (input.machineTags || []).join(" ");
  const haystacks: Array<[string, string]> = [
    [String(input.folder || ""), "folder"],
    [tagText, "tag"],
    [String(input.filename || ""), "filename"],
    [machineTagText, "machine tag"],
    [String(input.transcript || "").slice(0, 1500), "transcript"],
  ];

  const matches: ClassifyMatch[] = [];
  const seen = new Set<AssetContentType>();
  for (const [text, where] of haystacks) {
    if (!text.trim()) continue;
    for (const rule of RULES) {
      // First evidence for a type wins its `reason`: the folder a person filed
      // it in outranks a word a model saw later, and keeping the earliest
      // claim is what makes the reason string worth reading.
      if (seen.has(rule.type)) continue;
      if (rule.re.test(text)) {
        const hit = (text.match(rule.re) || [""])[0].trim();
        seen.add(rule.type);
        matches.push({ type: rule.type, reason: `${where}: "${hit}"` });
      }
    }
  }

  return {
    types: matches.map((m) => m.type),
    matches,
    primary: matches[0]?.type ?? "unclassified",
    primaryReason: matches[0]?.reason ?? "no matching signal",
  };
}

/** Batch helper — classify many, report how many landed. */
export function classifyBatch(items: ClassifyInput[]) {
  const out = items.map((i) => classifyAsset(i));
  const decided = out.filter((o) => o.type !== "unclassified").length;
  return { results: out, decided, undecided: out.length - decided };
}

/**
 * Does this asset serve `want`?
 *
 * The one predicate every picker should ask, so "is it an install" stops
 * meaning "is install the single label somebody happened to store". Reads the
 * multi-value column when the row has one and falls back to the single value,
 * which is what every row ingested before this change carries.
 */
export function assetServes(
  row: { content_type?: string | null; content_types?: string[] | null } | null | undefined,
  want: string,
): boolean {
  if (!row || !want) return false;
  const many = Array.isArray(row.content_types) ? row.content_types : [];
  if (many.length) return many.includes(want);
  return String(row.content_type || "") === want;
}

/** Every use a stored row serves, for chips and filters. Deterministic order. */
export function assetUses(
  row: { content_type?: string | null; content_types?: string[] | null } | null | undefined,
): string[] {
  const many = Array.isArray(row?.content_types) ? row!.content_types!.filter(Boolean) : [];
  if (many.length) return many;
  const one = String(row?.content_type || "");
  return one ? [one] : [];
}
