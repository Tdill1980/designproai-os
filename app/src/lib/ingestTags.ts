/**
 * ingestTags — what a HUMAN says a batch of footage is, at the moment it lands.
 *
 * ── WHY THIS IS NOT `content_type` ─────────────────────────────────────────
 * `content_type` is the taxonomy, it holds exactly ONE value per clip, and
 * `src/lib/assetContentType.ts` is its ONE deterministic classifier. CLAUDE.md
 * is explicit that a second classifier must never be added, because the two
 * drift and the Clip Library filters on the result. So none of this writes
 * `content_type` — the machine keeps its single honest guess, and the human's
 * judgement lands in `tags`, which is an array and can hold several at once.
 *
 * That is the whole point of the ask: one clip really can be an Install AND
 * B-roll AND part of Building a Brand. An enum cannot say that; a tag list can.
 *
 * ── tags[0] IS THE SHOOT NAME — DO NOT PREPEND ─────────────────────────────
 * The media-parser reads `tags[0]` as the shoot: it becomes the asset's
 * `source_folder` and the prefix on every parsed filename (worker/media-parser
 * lines ~417/431/450/563). That is how the December footage ended up grouped
 * under `ghost-industries`. So the shoot name MUST stay first and content tags
 * are always appended after it. Prepending "install" would rename the shoot to
 * "install" and scatter the grouping. Locked by `tests/ingest-tags.test.ts`.
 */

/** The crew-facing groupings, multi-select. Order is the picker's order. */
export const INGEST_TAGS: Array<{ key: string; label: string; emoji: string; hint: string }> = [
  { key: "install", label: "Install", emoji: "🔧", hint: "Squeegee, heat gun, panels going on" },
  { key: "ugc-talking", label: "UGC / Talking", emoji: "🎤", hint: "Someone on camera talking" },
  { key: "b-roll", label: "B-roll", emoji: "🎞️", hint: "Cutaways, detail, no dialogue" },
  { key: "shop-life", label: "Shop Life", emoji: "🏪", hint: "The day-to-day around the shop" },
  { key: "building-a-brand", label: "Building a Brand", emoji: "📈", hint: "The business story series" },
  { key: "behind-the-install", label: "Behind The Install", emoji: "🎬", hint: "BTI episode footage" },
  // ── WRAP MATERIAL — a TAG, not a ninth content_type. See the block below.
  { key: "wrap-material", label: "Wrap Material", emoji: "🎯", hint: "Vinyl, laminate, media stock — the roll itself" },
];

// ── WHY "WRAP MATERIAL" LANDED HERE AND NOT IN THE TAXONOMY ────────────────
// The owner asked for it by name, alongside "unboxing, installation, UGC,
// vehicle" — four values that ARE `content_type`s. It was still the wrong
// place for it, for two reasons, one architectural and one measured.
//
// ARCHITECTURAL: `content_type` holds exactly ONE value. A clip of an
// installer laying 3M 2080 is genuinely install AND wrap-material, and an
// enum cannot say that — which is the entire reason this file exists ("one
// clip really can be an Install AND B-roll AND part of Building a Brand").
// Forcing it into the enum would make every material clip choose between
// being findable as install footage and being findable as material footage.
//
// MEASURED (production, 2026-08-07, across all 685 raw-pool rows): a keyword
// rule for this concept has NOTHING TRUE to fire on and plenty false.
//   laminate · 3M/Avery/Oracal/Orafol/Hexis/Arlon/KPMF/Inozetek ·
//   2080 / "supreme wrapping" / "cast film" / calendered · "material" ·
//   "media stock" ............................................... 0 rows each
//   `vinyl` (7) — every one is the CREATOR NAME "Vinyl Vixen"
//   `roll`  (6) — every one is the SONG TITLE "Roll It Out"
// So the rule would have scored 0 true positives and up to 13 false ones, on
// exactly the two shapes `assetContentType.ts` already refuses by name:
// customer/creator names (`ghost-industries`, `houdini-wraps`) and finished
// music output. A wrong `content_type` silently drops a clip from every
// picker that filters on it; NULL at least reads as "nobody has looked yet".
//
// And the still-photo case is not homeless: a swatch, a roll on a shelf or a
// laminate sample is `content_type='product'` ("swatches, product stills,
// catalog imagery") — 112 rows are already typed that way. What was missing
// was the multi-valued, human-set grouping for FOOTAGE about the material,
// and that is what this tag is. A human ticks it at ingest or on the card;
// nothing guesses it.

export const INGEST_TAG_KEYS = INGEST_TAGS.map((t) => t.key);

/** Default shoot name when the uploader doesn't give one. */
export const DEFAULT_SHOOT = "asset-library";

/**
 * Turn a shoot name into the slug that becomes `source_folder`.
 * Kept conservative: lowercase, dashes, no leading/trailing junk.
 */
export function shootSlug(name: string | null | undefined): string {
  const s = String(name || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || DEFAULT_SHOOT;
}

/**
 * Build the `tags` array for a parse job.
 *
 * ALWAYS `[shoot, ...contentTags]` — the shoot first, because the parser reads
 * tags[0] as the shoot name. Content tags are deduped, order-stable, and
 * filtered to known keys so a typo cannot invent a grouping nobody filters on.
 */
export function buildIngestTags(shoot: string | null | undefined, selected: string[] = []): string[] {
  const head = shootSlug(shoot);
  const rest: string[] = [];
  for (const key of selected) {
    if (!INGEST_TAG_KEYS.includes(key)) continue; // unknown tag — drop, never invent
    if (key === head || rest.includes(key)) continue;
    rest.push(key);
  }
  return [head, ...rest];
}

/** The shoot name a tag array is carrying (i.e. what becomes source_folder). */
export function shootFromTags(tags: string[] | null | undefined): string {
  return (tags || [])[0] || DEFAULT_SHOOT;
}

/** Just the human content tags, without the shoot at the head. */
export function contentTagsFrom(tags: string[] | null | undefined): string[] {
  return (tags || []).slice(1).filter((t) => INGEST_TAG_KEYS.includes(t));
}

/** A suggested shoot name for a same-day card-dump: "jackson-sd-2026-08-04". */
export function suggestShootName(who: string, now = new Date()): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  const d = `${now.getDate()}`.padStart(2, "0");
  return shootSlug(`${who || "shoot"}-${y}-${m}-${d}`);
}
