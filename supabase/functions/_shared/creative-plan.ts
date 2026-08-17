/**
 * creative-plan — WHAT CREATIVE TO BUILD, and from which of your own images.
 *
 * Owner, 2026-08-13: "I need creatives built I need reels, ads, carousels
 * using our photos screen stills, videos stored in library and googledrive
 * that is the product… creative production to brandboard that is our biggest
 * rev gen in entire RP marketing software."
 *
 * ── WHY THE PRODUCT WAS NOT SHIPPING ───────────────────────────────────────
 * Measured 2026-08-13, the Canva path was two breaks from working and both
 * were invisible from the outside:
 *
 *  1. `brand_canva_templates` held ZERO ROWS, so every call died at
 *     `canva_image_template_not_mapped` before it did anything at all. The
 *     autofill, the export, the thumbnail, the board card — all built, none
 *     reachable.
 *  2. `autofillText` filtered fields to `type === "text"`. Both real templates
 *     expose a `hero_image`, and it was never filled — so even once mapped,
 *     every creative would carry Canva's placeholder photo instead of a real
 *     install.
 *
 * A caption on somebody else's stock picture is not the product. This module
 * is the half that decides WHICH of your images goes in, how many slides a
 * format needs, and what is missing when it cannot be built — all as pure
 * rules, so the decision is inspectable and testable without a Canva account.
 *
 * Pure by design: no database, no network, no clock. Locked by
 * `tests/creative-plan.test.ts`.
 */

/** The creative formats the board actually carries. */
export type CreativeFormat = "static" | "carousel" | "reel" | "ad";

export interface CreativeSource {
  id: string;
  url: string;
  /** "image" or "video" — the library's own asset_type, normalised. */
  kind: string;
  name: string;
  tags?: string[];
  category?: string | null;
  /**
   * The library's RAW `asset_type`, before it was normalised to image/video.
   *
   * Load-bearing: `rendered_video` normalises to "video", so without the raw
   * value a finished cut is indistinguishable from a shoot. See
   * `isFinishedOutput`.
   */
  sourceType?: string | null;
}

/**
 * Is this asset something the system already MADE, rather than something it was
 * given to work from?
 *
 * MEASURED, NOT ASSUMED (2026-08-13, live library). The first version of this
 * module tested one signal — `category === "render"` — and that check never
 * fired in production, for two independent reasons:
 *
 *  · The pool was read from `content_category`, which is a WRAP-PATTERN field
 *    ("modern_trippy", "camo_carbon", null on 665 of 815 rows). The library's
 *    taxonomy is `content_type`. The string "render" does not occur in the
 *    column the code was reading, so the guard was dead against real data.
 *  · 111 assets carry `asset_type: "rendered_video"`, and only 64 of them are
 *    also typed `render`. The other 47 have no content type at all — and
 *    "rendered_video" normalises to "video", so every one of them looked like
 *    raw footage to the reel path.
 *
 * On top of that, tool renders are pushed into the image pool with ids shaped
 * `render_<uuid>` — finished designs offered as source material.
 *
 * So the test is three signals, not one. A board that builds from its own
 * output fills with copies of itself, and the unit test that "proved" this
 * worked passed only because it hand-built a shape production never emits.
 */
export function isFinishedOutput(s: CreativeSource): boolean {
  const cat = String(s.category || "").toLowerCase();
  if (cat === "render" || cat === "audio_master") return true;
  // rendered_video, rendered_image, tool_render — anything the system produced.
  const raw = String(s.sourceType || "").toLowerCase();
  if (raw.includes("render")) return true;
  // The tool-render pool keys its rows `render_<uuid>`.
  if (/^render[_-]/i.test(String(s.id || ""))) return true;
  return false;
}

export interface CreativeSpec {
  format: CreativeFormat;
  /** How many slides this format wants. 1 for everything except a carousel. */
  slides: number;
  /** Which Canva template slot to use — the image one or the story one. */
  templateKind: "image" | "reel";
  /** The post_type the draft is written with, so the board renders it right. */
  postType: string;
  aspect: string;
}

/**
 * Format → what it is made of.
 *
 * A carousel is THREE slides, not a setting: fewer is a static with extra
 * steps, more is a deck nobody swipes to the end of. Three is the shape the
 * format actually rewards, so it is stated once here rather than passed in and
 * guessed at every call site.
 */
export const CREATIVE_SPEC: Record<CreativeFormat, CreativeSpec> = {
  static: { format: "static", slides: 1, templateKind: "image", postType: "feed", aspect: "1:1" },
  carousel: { format: "carousel", slides: 3, templateKind: "image", postType: "carousel", aspect: "1:1" },
  reel: { format: "reel", slides: 1, templateKind: "reel", postType: "reel", aspect: "9:16" },
  ad: { format: "ad", slides: 1, templateKind: "image", postType: "ad", aspect: "1:1" },
};

/** Which library asset types can carry which format. */
export function wantsVideo(format: CreativeFormat): boolean {
  return format === "reel";
}

/**
 * The images this creative should use, best first.
 *
 * RANKED, NOT NEWEST. The library holds 815 assets and "the newest four" is
 * not a selection — it is whatever was uploaded last, which on this system is
 * routinely a render of something already posted. Ranking prefers assets that
 * carry evidence about themselves (a category, tags, a real title) because
 * those are the ones a human classified, and a classified asset is far more
 * likely to be the install photo than an untitled export.
 *
 * A RENDER IS NOT SOURCE MATERIAL. `content_type: "render"` is a finished
 * piece — building a new creative out of one is how a board fills with copies
 * of itself. Excluded here, the same way the Asset Library excludes them from
 * the clip pool.
 */
export function rankSources(
  sources: CreativeSource[] | null | undefined,
  format: CreativeFormat,
): CreativeSource[] {
  const want = wantsVideo(format) ? "video" : "image";
  const scored: Array<{ s: CreativeSource; score: number }> = [];

  for (const s of sources || []) {
    if (!s?.url || !s?.id) continue;
    const kind = String(s.kind || "").toLowerCase();
    const isVideo = kind.includes("video");
    if (want === "video" ? !isVideo : isVideo) continue;

    // A finished render, or the parser's archived audio, is not raw material.
    if (isFinishedOutput(s)) continue;

    const cat = String(s.category || "").toLowerCase();
    let score = 0;
    if (cat && cat !== "unclassified") score += 3;
    if ((s.tags || []).length) score += 2;
    // A real title beats a camera filename ("MVI_3811", "IMG_0308").
    const name = String(s.name || "");
    if (name && !/^(img|mvi|dsc|dji|gopro|clip|untitled)[-_ ]?\d*/i.test(name)) score += 2;
    // Install and vehicle footage is what a wrap creative is made of.
    if (/install|wrap|vehicle|truck|van|fleet|shop/i.test(`${name} ${cat} ${(s.tags || []).join(" ")}`)) score += 2;

    scored.push({ s, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((x) => x.s);
}

/**
 * Why this creative cannot be built, or null when it can.
 *
 * NAMED GAPS, NOT AN EMPTY RESULT. Every failure this system has had this week
 * looked identical from the outside — a button that did nothing — because the
 * reason lived in a thrown string nobody surfaced. A creative that cannot be
 * built should say which of the three things is missing.
 */
export function creativeBlocker(input: {
  format: CreativeFormat;
  sources: CreativeSource[];
  headline: string;
  templateMapped: boolean;
}): string | null {
  const spec = CREATIVE_SPEC[input.format];
  if (!spec) return `"${input.format}" is not a creative this board carries`;
  if (!input.templateMapped) {
    return `no Canva ${spec.templateKind === "reel" ? "story/reel" : "image"} template is mapped for this brand — ` +
      `map one in brand_canva_templates and this builds immediately`;
  }
  if (!String(input.headline || "").trim()) return "there is no headline to put on it";
  const usable = rankSources(input.sources, input.format);
  if (!usable.length) {
    return wantsVideo(input.format)
      ? "no usable video in the library — ingest a shoot from Drive first"
      : "no usable photo or still in the library — ingest from Drive first";
  }
  if (usable.length < spec.slides) {
    return `a ${input.format} needs ${spec.slides} images and the library has ${usable.length} usable — ` +
      `ingest more from Drive, or build a static instead`;
  }
  return null;
}

/**
 * The slides to build: one source per slide, never the same image twice.
 *
 * Repeating an image across a carousel is the tell that the pool was too thin
 * and nobody checked — `creativeBlocker` refuses that case before we get here,
 * so this can take the top N cleanly.
 */
export function planSlides(
  sources: CreativeSource[],
  format: CreativeFormat,
): CreativeSource[] {
  const spec = CREATIVE_SPEC[format];
  return rankSources(sources, format).slice(0, spec?.slides ?? 1);
}

/**
 * Per-slide copy for a carousel, from the copy the writer already produced.
 *
 * Slide 1 carries the hook. The rest carry the following sentences, so a
 * carousel reads as one argument rather than the same line three times — and
 * NOTHING IS INVENTED here: if the copy runs out, later slides get an empty
 * subhead rather than a manufactured one.
 */
export function slideCopy(headline: string, body: string, slides: number): Array<{ headline: string; subhead: string }> {
  const sentences = String(body || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: Array<{ headline: string; subhead: string }> = [];
  for (let i = 0; i < slides; i++) {
    out.push({
      headline: i === 0 ? String(headline || "").trim() : (sentences[i - 1] || String(headline || "").trim()),
      subhead: i === 0 ? (sentences[0] || "") : (sentences[i] || ""),
    });
  }
  return out;
}
