/**
 * editorRouter — WHICH EDITOR CUTS THIS, and is that honest?
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * `showFormats.ts` records the decision ("Behind the Brand" is a documentary,
 * so the intelligence editor cuts it; "Behind Shop Doors" is a tour, so the
 * music editor does). `formatFits` records whether the footage can honestly
 * carry the show that was asked for. Three different callers need to ask that
 * pair of questions about the same job:
 *
 *   • the UI, to SHOW the choice before anyone presses cut,
 *   • `useBrandCast`, to ROUTE the cut to one editor or the other,
 *   • the panel, to EXPLAIN afterwards why it came out the way it did.
 *
 * Written as an `if` in the hook, that logic exists three times and the copies
 * drift — CLAUDE.md is explicit about duplicated rule sets drifting, and it has
 * happened in this repo often enough to be a rule rather than a worry. So the
 * question is asked once, here, and the answer is a value everyone reads.
 *
 * ── WHAT THIS FILE REFUSES TO DO ───────────────────────────────────────────
 * It never silently picks an editor. No show format chosen is a REFUSAL, not a
 * default. Footage that does not carry what the show needs is a REFUSAL, and
 * `formatFits` already writes the sentence — including the alternative show —
 * so the operator has somewhere to go. An unknown signal is a MISS, never a
 * pass: cutting a documentary from silent b-roll does not produce a weak
 * documentary, it produces a montage with a documentary's title on it.
 *
 * It also does not cut anything, does not talk to a network, does not read a
 * clock and does not use randomness. Same input, same route, forever — the same
 * property the editors themselves promise, because a route that wobbles makes
 * every cut downstream unreproducible. Locked by `tests/editor-router.test.ts`.
 */

import {
  FORMAT_PACE,
  SHOW_FORMATS,
  formatFits,
  formatsForBrand,
  showFormat,
  type EditorKind,
  type FormatFit,
  type ShowFormat,
} from "./showFormats";
import { CUT_TYPES, type CutType } from "./editorCraft";

// ─── The signal vocabulary ───────────────────────────────────────────────────

/**
 * The flags a caller can actually vouch for, mapped to the LITERAL requirement
 * strings the show formats declare.
 *
 * `formatFits` matches on those strings, so this map is the only place where a
 * boolean the app can measure becomes a requirement a show can demand. Keeping
 * it in one exported constant is what makes the drift detectable:
 * `unmappedRequirements()` names any requirement no flag can express, and the
 * test fails on a non-empty answer. Without that, adding a requirement to a
 * show format would quietly make that show refuse EVERY piece of footage, and
 * the refusal would read like a footage problem.
 */
export const REQUIREMENT_SIGNALS = {
  hasSpeech: "speech",
  hasPersonOnCamera: "a person on camera",
  hasTour: "a walk-through or tour footage",
  hasMusicTrack: "a music track",
  // BEHIND THE INSTALL'S TWO. `showFormats.ts` recorded the first of these as
  // a gap it could not close from its own file — "the one thing this show
  // genuinely needs, INSTALL FOOTAGE, has no signal… a requirement outside
  // that map makes the show unsatisfiable through the structured API". This is
  // that entry. It is measurable off the taxonomy, unlike `hasTour`.
  hasInstallFootage: "install footage",
  // The crawl that credits the shops. A human types the names, so this is
  // DECLARED, never inferred — the show refuses rather than crediting a shop
  // nobody named.
  hasTicker: "a ticker of shop names",
} as const;

export type SignalFlag = keyof typeof REQUIREMENT_SIGNALS;

export interface FootageFacts {
  /** Somebody is talking, and the parser has the words. */
  hasSpeech?: boolean;
  hasPersonOnCamera?: boolean;
  hasTour?: boolean;
  /** A real track has been chosen for this cut. */
  hasMusicTrack?: boolean;
  /** The pool actually contains footage of the work being done. */
  hasInstallFootage?: boolean;
  /** Somebody has supplied shop names / handles for the bottom crawl. */
  hasTicker?: boolean;
  /**
   * Extra requirement strings the caller can vouch for verbatim. An escape
   * hatch for a show that declares something this file has no flag for — used
   * knowingly, never to paper over an unknown.
   */
  also?: string[];
}

/** Every distinct requirement across every show, in declaration order. */
export function knownRequirements(): string[] {
  const out: string[] = [];
  for (const f of SHOW_FORMATS) for (const r of f.requires) if (!out.includes(r)) out.push(r);
  return out;
}

/**
 * Requirements no flag in `REQUIREMENT_SIGNALS` can express.
 *
 * Non-empty means a show can never be satisfied through the structured API —
 * the test treats that as a failure rather than letting the router refuse
 * forever for a reason nobody would think to look for.
 */
export function unmappedRequirements(): string[] {
  const mapped = new Set(Object.values(REQUIREMENT_SIGNALS).map((s) => s.toLowerCase()));
  return knownRequirements().filter((r) => !mapped.has(r.toLowerCase()));
}

/** The requirement strings a set of facts actually asserts. Deterministic order. */
export function signalsOf(facts: FootageFacts | null | undefined): string[] {
  const out: string[] = [];
  for (const key of Object.keys(REQUIREMENT_SIGNALS) as SignalFlag[]) {
    if (facts?.[key] === true) out.push(REQUIREMENT_SIGNALS[key]);
  }
  for (const extra of facts?.also || []) {
    const v = String(extra || "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

// ─── Reading the facts off the footage ───────────────────────────────────────

/** What the app already knows about one clip. Both fields may be unknown. */
export interface ClipFacts {
  /** `agent_media_assets.content_type` — the ONE classifier's verdict. */
  contentType?: string | null;
  /**
   * `agent_media_assets.content_types` — EVERY use the clip serves.
   *
   * A clip of an installer explaining a step is an install AND a documentary,
   * and the single column could only hold one. Read this when it is present
   * and fall back to `contentType`, so a row the classify pass has not reached
   * still answers exactly as it did before.
   */
  contentTypes?: string[] | null;
  /** True only when the parser actually heard words. */
  hasSpeech?: boolean | null;
}

/** Things only a human or a later step can assert. */
export interface DeclaredFacts {
  /** A track has been resolved for this cut. */
  musicTrack?: boolean;
  /** The operator says there is a person on camera. */
  personOnCamera?: boolean;
  /** The operator says this is a walk-through. */
  tour?: boolean;
  /**
   * Shop names / IG handles have been supplied for the bottom crawl.
   *
   * Declared only. Nothing infers a ticker: the names are a person's claim
   * about whose work is on screen, and inventing one would credit a shop that
   * never touched the vehicle.
   */
  ticker?: boolean;
  /**
   * The operator vouches for install footage the taxonomy has not caught up
   * with. A fallback, not the primary route — `contentTypes` answers this for
   * anything the classify pass has seen.
   */
  installFootage?: boolean;
}

/**
 * Content types that ARE footage of people, per the Asset Library's own
 * taxonomy (`src/lib/assetContentType.ts`). Not a second classifier — a read of
 * the first one. `install` and `vehicle_only` are deliberately absent: an
 * install can be hands and a squeegee and nothing else.
 */
const PERSON_CONTENT_TYPES = ["documentary", "ugc", "unboxing"];

export interface FootageReading {
  facts: FootageFacts;
  /** Why each asserted signal is asserted. Readable, overridable. */
  evidence: string[];
  /** Signals that can only ever arrive by declaration, and were not declared. */
  undeclared: string[];
}

/**
 * Clip rows + what the operator declared → the facts the router judges.
 *
 * The mapping lives HERE rather than in the hook so the UI's preview and the
 * cut's routing cannot answer the same question differently. Everything is
 * evidence-bearing: nothing is asserted without a sentence saying what said so.
 */
export function footageFactsFrom(
  clips: ClipFacts[] | null | undefined,
  declared: DeclaredFacts = {},
): FootageReading {
  const list = (clips || []).filter(Boolean);
  const evidence: string[] = [];

  const talking = list.filter((c) => c?.hasSpeech === true).length;
  if (talking) {
    evidence.push(`${talking} clip${talking === 1 ? "" : "s"} carry a transcript — the parser heard words.`);
  }

  const people = list.filter((c) =>
    PERSON_CONTENT_TYPES.includes(String(c?.contentType || "").trim().toLowerCase()));
  if (declared.personOnCamera) {
    evidence.push("A person on camera was declared by the operator.");
  } else if (people.length) {
    evidence.push(
      `${people.length} clip${people.length === 1 ? " is" : "s are"} typed ` +
      `${[...new Set(people.map((c) => String(c.contentType)))].join("/")} — ` +
      "the Asset Library's own taxonomy for footage of people.",
    );
  }

  if (declared.tour) evidence.push("A walk-through was declared by the operator.");
  if (declared.musicTrack) evidence.push("A track has been resolved for this cut.");
  if (declared.ticker) evidence.push("Shop names have been supplied for the ticker.");

  // INSTALL FOOTAGE — read off the taxonomy, and off EVERY use a clip serves,
  // not only its single stored label. A clip filed `documentary` that is also
  // an install has always been install footage; before the multi-use column it
  // simply could not say so, which is why this show had 24 assets to draw on
  // where it now has 71.
  const installing = list.filter((c) => {
    const uses = Array.isArray(c?.contentTypes) && c.contentTypes.length
      ? c.contentTypes
      : [String(c?.contentType || "")];
    return uses.some((u) => String(u || "").trim().toLowerCase() === "install");
  });
  if (installing.length) {
    evidence.push(
      `${installing.length} clip${installing.length === 1 ? " is" : "s are"} typed install — ` +
      "the Asset Library's own taxonomy for footage of the work being done.",
    );
  }

  const facts: FootageFacts = {
    hasSpeech: talking > 0,
    hasPersonOnCamera: declared.personOnCamera === true || people.length > 0,
    hasTour: declared.tour === true,
    hasMusicTrack: declared.musicTrack === true,
    hasInstallFootage: declared.installFootage === true || installing.length > 0,
    // Never inferred. A ticker is names a person typed; guessing one would put
    // a shop's handle on screen that nobody vouched for.
    hasTicker: declared.ticker === true,
  };

  // The Asset Library has no `tour` content type, so nothing can ever infer a
  // walk-through from a clip row. Saying so is the difference between "your
  // footage is wrong" and "nobody has told me yet".
  const undeclared: string[] = [];
  if (!facts.hasTour) {
    undeclared.push(
      "a walk-through or tour footage — no content type means \"tour\", so it can only be declared.",
    );
  }
  if (!facts.hasMusicTrack) {
    undeclared.push("a music track — declared once a track is actually resolved for the cut.");
  }
  if (!facts.hasTicker) {
    undeclared.push(
      "a ticker of shop names — type the shops and IG handles in the Cut Editor; nothing can invent a handle.",
    );
  }

  return { facts, evidence, undeclared };
}

// ─── The route ───────────────────────────────────────────────────────────────

export interface RouteInput {
  /** A key from `SHOW_FORMATS`. Absent is a refusal, never a default. */
  showFormatKey?: string | null;
  /** The brand the cut is FOR. Checked against the show's own brand. */
  brand?: string | null;
  /** The social content type being cut (`editorCraft.CUT_TYPES`). */
  contentType?: CutType | string | null;
  footage?: FootageFacts | null;
  /** An operator overruling the show's editor. Recorded, never silent. */
  overrideEditor?: EditorKind | null;
  /** Who overruled it, for the record. */
  overrideBy?: string | null;
}

export interface EditorRoute {
  /** True only when an editor may proceed. */
  ok: boolean;
  /** The editor that cuts this, or null when nothing may. */
  editor: EditorKind | null;
  format: ShowFormat | null;
  /** ALWAYS populated — on success and on refusal. */
  reason: string;
  /** The sentence to surface when `ok` is false. Null when ok. */
  refusal: string | null;
  /** Requirements the footage does not carry. */
  missing: string[];
  fit: FormatFit;
  /** The requirement strings the footage asserted, as judged. */
  signals: string[];
  /** The show's pace band, for the editor that gets it. */
  pace: { minShot: number; typicalShot: number } | null;
  contentType: CutType | null;
  /** True when `overrideEditor` overruled the show's own editor. */
  overridden: boolean;
  overriddenFrom: EditorKind | null;
  /** Other shows this brand has — where the operator can go instead. */
  alternatives: Array<{ key: string; label: string; editor: EditorKind }>;
  /** Everything worth saying that is not a refusal. */
  notes: string[];
}

function alternativesFor(brand: string | null | undefined, exceptKey?: string) {
  const pool = brand ? formatsForBrand(brand) : SHOW_FORMATS;
  return (pool.length ? pool : SHOW_FORMATS)
    .filter((f) => f.key !== exceptKey)
    .map((f) => ({ key: f.key, label: f.label, editor: f.editor }));
}

/**
 * Given a brand, a show, a content type and what the footage actually contains:
 * which editor cuts this, and is that honest?
 *
 * The refusals, in the order they bind:
 *   1. NO SHOW CHOSEN. There is no house default and there must not be one —
 *      the two editors make genuinely different films, so guessing is how a
 *      shop tour ends up as talking heads.
 *   2. WRONG BRAND'S SHOW. A format belongs to a brand. Cutting one brand's
 *      show under another's mark is the same mislabel as the wrong editor,
 *      one layer up.
 *   3. FOOTAGE DOES NOT FIT. `formatFits` writes this one, alternative included.
 *
 * An override changes WHICH EDITOR cuts an otherwise-honest show. It cannot
 * clear a refusal: the missing footage is still missing, and an override that
 * could silence that would be a "cut it anyway" button wearing a better name.
 */
export function routeEditor(input: RouteInput = {}): EditorRoute {
  const format = showFormat(input.showFormatKey);
  const facts = input.footage || null;
  const signals = signalsOf(facts);
  const fit = formatFits(format, signals);
  const notes: string[] = [];

  const contentTypeKey = String(input.contentType || "").trim() as CutType;
  const contentType = (CUT_TYPES as Record<string, unknown>)[contentTypeKey] ? contentTypeKey : null;
  if (input.contentType && !contentType) {
    notes.push(`"${String(input.contentType)}" is not a content type this editor knows — ignored rather than guessed at.`);
  }

  // ── 1. No show chosen. `formatFits(null, …)` already says it properly.
  if (!format) {
    return {
      ok: false,
      editor: null,
      format: null,
      reason: fit.message,
      refusal: fit.message,
      missing: [],
      fit,
      signals,
      pace: null,
      contentType,
      overridden: false,
      overriddenFrom: null,
      alternatives: alternativesFor(input.brand),
      notes,
    };
  }

  // ── 2. Somebody else's show.
  const wantBrand = String(input.brand || "").trim().toLowerCase();
  if (wantBrand && wantBrand !== format.brand.toLowerCase()) {
    const mine = formatsForBrand(input.brand);
    const refusal =
      `${format.label} is ${format.brand}'s show, not ${wantBrand}'s. ` +
      (mine.length
        ? `Cut it as ${mine.map((f) => f.label).join(" or ")} instead, or run it under ${format.brand}.`
        : `${wantBrand} has no shows declared — run this under ${format.brand}, or declare one.`);
    return {
      ok: false,
      editor: null,
      format,
      reason: refusal,
      refusal,
      missing: [],
      fit,
      signals,
      pace: FORMAT_PACE[format.editor],
      contentType,
      overridden: false,
      overriddenFrom: null,
      alternatives: alternativesFor(input.brand, format.key),
      notes,
    };
  }

  // ── the editor, and any override of it.
  const declared = format.editor;
  const override = input.overrideEditor === "intelligence" || input.overrideEditor === "music"
    ? input.overrideEditor
    : null;
  const overridden = !!override && override !== declared;
  const editor = override || declared;
  if (overridden) {
    notes.push(
      `${format.label} is cut by the ${declared} editor; that was overruled to the ${editor} editor` +
      `${input.overrideBy ? ` by ${input.overrideBy}` : ""}. The show's own reason still stands: ${format.because}`,
    );
  }

  // The content type is a second, weaker statement of intent — worth a note
  // when it argues with the editor, never worth a refusal. A tutorial's ORDER
  // is its information (`preserveStepOrder`), and a beat grid does not respect
  // an order it cannot see.
  if (contentType && editor === "music" && CUT_TYPES[contentType].preserveStepOrder) {
    notes.push(
      `A ${CUT_TYPES[contentType].label} keeps its steps in order, and the music editor cuts to the ` +
      "track rather than to the sequence — the lesson will not survive the beat grid.",
    );
  }

  // ── 3. The footage.
  if (!fit.ok) {
    return {
      ok: false,
      editor: null,
      format,
      reason: fit.message,
      refusal: fit.message,
      missing: fit.missing,
      fit,
      signals,
      pace: FORMAT_PACE[editor],
      contentType,
      overridden,
      overriddenFrom: overridden ? declared : null,
      alternatives: alternativesFor(input.brand, format.key),
      notes,
    };
  }

  const reason =
    `${format.label} is cut by the ${editor} editor` +
    `${overridden ? ` (overruled from ${declared})` : ""}. ` +
    `${overridden ? "" : format.because + " "}${fit.message}`;

  return {
    ok: true,
    editor,
    format,
    reason,
    refusal: null,
    missing: [],
    fit,
    signals,
    pace: FORMAT_PACE[editor],
    contentType,
    overridden,
    overriddenFrom: overridden ? declared : null,
    alternatives: alternativesFor(input.brand, format.key),
    notes,
  };
}
