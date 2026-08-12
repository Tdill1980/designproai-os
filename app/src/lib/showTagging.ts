/**
 * showTagging — WHICH SHOW DOES THIS FINISHED CUT BELONG TO?
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * Owner, 2026-08-07: "where are 75 scene cuts? Those are Behind The Install
 * Music Videos if yes than just add a button tag for BTI and I can click and
 * review!"
 *
 * She cannot, because nothing ever recorded which show a cut belonged to.
 * Measured on production (kfapjdyythzyvnpdeghu) 2026-08-07, SELECT-only:
 * `video_render_jobs` holds 140 rows at status `complete`, 75 of them
 * multi-scene. `blueprint.show_format` is present on 42 rows and NULL on every
 * one of them; on all 75 multi-scene cuts the key is absent entirely. There is
 * no column to filter on and no value to filter for.
 *
 * ── WHAT THIS FILE IS FOR, AND WHAT IT IS NOT ──────────────────────────────
 * `show_format` answers "WHICH SHOW WAS THIS MADE AS" — a provenance label, the
 * thing a review button filters on. It is NOT a verdict that the footage suits
 * that show; `formatFits` in `showFormats.ts` answers that, and the two answers
 * routinely disagree on real rows. Both are recorded, separately and never
 * merged, so nobody can mistake a label for a fitness check.
 *
 * The distinction is load-bearing. `tests/show-formats.test.ts` warns that
 * silent b-roll cut as "Behind the Brand" produces a montage with a
 * documentary's title on it that a reviewer cannot detect. That warning is
 * about MINTING a show for footage that never claimed one. Reading a show off a
 * cut a human already titled "Behind The Install — EP. 001" is the opposite
 * act: it surfaces an existing claim so a human can review it, which is exactly
 * how such a mislabel gets caught.
 *
 * ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────
 * No fuzzy matching, no edit distance, no nearest show, no "the show its
 * sibling rows use", no most-common-show default, and above all no inference
 * from vibe — pace, scene count and clip mix are printed as context and NEVER
 * decide a tag. A cut is tagged only when something on the row NAMES a show.
 * Everything else is an honest gap, because an untagged cut sits in a queue
 * where somebody can see it, while a wrongly-tagged one joins a review batch
 * under a show it was never made as and gets approved on that basis.
 *
 * Pure by design: no database, no network, no clock, no AI. The runner that
 * touches Postgres is `scripts/backfill-show-formats.ts`; the rules live here
 * so the backfill and any future producer cannot answer the same question
 * differently. Locked by `tests/show-tagging.test.ts`.
 */

import {
  SHOW_FORMATS,
  formatFits,
  formatsForBrand,
  showFormat,
  type EditorKind,
  type FormatFit,
  type ShowFormat,
} from "./showFormats";

/** Stamped into the blueprint so a later reader knows what wrote the tag. */
export const TAG_SOURCE = "scripts/backfill-show-formats.ts";

/**
 * The ONLY blueprint keys a tag may add. Everything else on the blueprint —
 * `scenes` above all — must survive a tag byte-for-byte, and
 * `assertBlueprintPreserved` enforces it against the produced object rather
 * than against this comment.
 */
export const TAG_PATCH_KEYS = [
  "show_format",
  "show_editor",
  "show_format_source",
  "show_format_backfill",
] as const;

/**
 * The classes of tag, approved separately at the command line.
 *
 * They rest on DIFFERENT evidence and deserve different levels of nerve, which
 * is why `--apply` demands an explicit one: `title` is the producer's own
 * printed label and is the same call for every row that carries it; `reference`
 * reads a show's reference word out of a pipeline token and is a weaker,
 * per-row judgement.
 */
export const TAG_KINDS = ["title", "reference"] as const;
export type TagKind = (typeof TAG_KINDS)[number];

/** What the planner reads off ONE `video_render_jobs` row. All optional. */
export interface CutEvidence {
  id?: string;
  /** `video_render_jobs.brand`. */
  brand?: string | null;
  /** `blueprint.title` — where a producer prints the show name. */
  title?: string | null;
  /** `blueprint.source` — the pipeline that built it. */
  blueprintSource?: string | null;
  /** `blueprint.kind`. */
  blueprintKind?: string | null;
  /** `blueprint.stylePack`. */
  stylePack?: string | null;
  /** `music_url is not null`. */
  hasMusicTrack?: boolean;
  /** `blueprint.keepNativeAudio`, tri-state: true / false / unknown. */
  keepNativeAudio?: boolean | null;
  /** An existing tag. Non-empty means never touch this row. */
  existingShowFormat?: string | null;

  // ── measured footage, for CORROBORATION and for context ──
  /** Scenes in the blueprint. */
  sceneCount?: number;
  /** Seconds per scene, for context only — never a decision. */
  secondsPerScene?: number | null;
  /** Scene slots whose clip resolves to an Asset Library row. */
  clipCount?: number;
  /** Slots whose clip resolves to a `media_sources` parse row. */
  clipsResolved?: number;
  /** Slots whose source carries a real transcript. */
  speechClips?: number;
  /** Slots whose clip is typed `install` by the ONE classifier. */
  installClips?: number;
  /** `blueprint.editorial.scenes[].quote_text` exists — speech on the row. */
  quotedSpeech?: boolean;
}

export type TagAction = "tag" | "skip" | "refuse";

export type TagWhy =
  /** tag — the title prints a show's name, corroborated. */
  | "title_names_show"
  /** tag — a pipeline token IS a show's own reference word, corroborated. */
  | "source_references_show"
  /** skip — already tagged; never overwritten. */
  | "already_tagged"
  /** refuse — the named show belongs to a different brand. */
  | "wrong_brand"
  /** refuse — the title names two shows at once. */
  | "ambiguous"
  /** refuse — a show is named but nothing on the row backs it up. */
  | "uncorroborated"
  /** refuse — nothing on the row names a show. */
  | "no_show_named";

export interface TagPatch {
  show_format: string;
  show_editor: EditorKind;
  show_format_source: string;
  show_format_backfill: Record<string, unknown>;
}

export interface ShowTagPlan {
  id: string;
  action: TagAction;
  why: TagWhy;
  /** The tag class, for `--kind` gating. Present only on a tag. */
  kind?: TagKind;
  /** The show key to write. Present only on a tag. */
  showKey?: string;
  editor?: EditorKind;
  /** The evidence, printed verbatim so a human can disagree with it. */
  evidence: string[];
  /** One-line reasoning. Always present. */
  detail: string;
  /**
   * What `formatFits` says about this cut's MEASURED footage.
   *
   * Recorded next to the tag and never merged into it. A cut can carry a show's
   * name in its own title and still not satisfy that show's requirements — that
   * is a real editorial finding for the reviewer, not a reason to hide the cut
   * from the review queue that would surface it.
   */
  fit?: FormatFit;
  /** Context a human wants when reading a refusal. Never decides anything. */
  note?: string;
  /** The exact blueprint keys to merge. Present only on a tag. */
  patch?: TagPatch;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Lowercase, and collapse every run of non-alphanumerics to ONE space.
 *
 * Titles arrive with em-dashes, colons, "EP. 001" and doubled brand prefixes;
 * a show name has to be findable through all of that without the matcher
 * becoming fuzzy. Punctuation is noise here, letters are not.
 */
export function normalize(v: unknown): string {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The strings that NAME a show. Both the label and the key normalize to the
 * same phrase for every declared show ("Behind Shop Doors" / behind_shop_doors
 * → "behind shop doors"), so this stays honest if a label is ever reworded.
 */
export function showNameTokens(format: ShowFormat): string[] {
  const out = [normalize(format.label), normalize(format.key)];
  return [...new Set(out.filter(Boolean))];
}

/**
 * Which shows does this title NAME? Usually none.
 *
 * Substring on a normalized phrase, which is deliberately strict: "Hands Behind
 * The Wrap" does not name Behind the Install, and must not, or the 40 song
 * titles in this table would all tag themselves.
 */
export function showsNamedInTitle(title: unknown): ShowFormat[] {
  const hay = ` ${normalize(title)} `;
  if (hay.trim().length === 0) return [];
  return SHOW_FORMATS.filter((f) => showNameTokens(f).some((t) => hay.includes(` ${t} `)));
}

/**
 * Which show does a pipeline token REFERENCE?
 *
 * `blueprint.source` is a build-path name, not a show name — but one of them,
 * `cribs_build`, carries the exact word that Behind Shop Doors cites as its own
 * reference ("MTV Cribs — the tour"). That is a citation in the show's own
 * declaration, the same standing `BRAND_ALIASES` gives a brand alias.
 *
 * Guarded hard, because this rung is the one that could go wrong quietly:
 * a token must be at least 5 characters (no "the", no "cut") and must match
 * EXACTLY ONE show's reference, or it names nothing.
 */
export function showReferencedBySource(source: unknown): ShowFormat | null {
  const tokens = normalize(source).split(" ").filter((t) => t.length >= 5);
  if (!tokens.length) return null;
  const hits = new Map<string, ShowFormat>();
  for (const f of SHOW_FORMATS) {
    const ref = ` ${normalize(f.reference)} `;
    if (tokens.some((t) => ref.includes(` ${t} `))) hits.set(f.key, f);
  }
  return hits.size === 1 ? [...hits.values()][0] : null;
}

/**
 * Does anything ELSE on the row agree this cut is that show?
 *
 * A name on its own is not enough, for the same reason `repair-post-brands`
 * refuses an uncorroborated format suffix: the token being real is not proof it
 * describes the row. Each show's corroboration is drawn from what the show
 * itself IS — an install show wants install footage, a music show wants a
 * track — and is MEASURED, never read out of prose.
 *
 * Returns every corroborating fact found, strongest first. EMPTY MEANS REFUSE.
 */
export function corroborate(format: ShowFormat, ev: CutEvidence): string[] {
  const e = obj(ev) as CutEvidence;
  const out: string[] = [];
  const install = num(e.installClips);
  const clips = num(e.clipCount);
  const speech = num(e.speechClips);

  switch (format.key) {
    case "behind_the_install":
      // The show IS the install. The Asset Library's own classifier typing
      // clips `install` is the closest thing to a receipt this data holds.
      if (install > 0) {
        out.push(`${install} of ${clips} clip slot(s) are typed \`install\` by the Asset Library's classifier`);
      }
      break;
    case "behind_shop_doors":
      // A Cribs cut is carried by the track; the show declares it outright.
      if (e.hasMusicTrack) out.push("a music track is attached (`music_url` is set) — the show requires one");
      break;
    case "behind_the_brand":
      // A documentary is carried by what is said, and the row can prove it.
      if (e.quotedSpeech) out.push("`blueprint.editorial.scenes[].quote_text` carries the spoken lines");
      if (speech > 0) out.push(`${speech} clip slot(s) resolve to a parsed source with a real transcript`);
      break;
    default:
      break;
  }
  return out;
}

/**
 * The measured footage signals, as the requirement strings `formatFits` reads.
 *
 * UNKNOWN IS NOT ASSERTED. A clip whose URL resolves to no parse row proves
 * nothing about speech, so it contributes nothing — the fit comes back with
 * "no speech" and the plan says how many slots were unresolvable, rather than
 * claiming the footage is silent.
 */
export function measuredSignals(ev: CutEvidence): string[] {
  const e = obj(ev) as CutEvidence;
  const out: string[] = [];
  if (num(e.speechClips) > 0 || e.quotedSpeech === true) out.push("speech");
  if (e.hasMusicTrack === true) out.push("a music track");
  // `a person on camera` and `a walk-through or tour footage` are deliberately
  // never asserted here: `editorRouter.footageFactsFrom` is explicit that no
  // content type means "tour", and a person can only be declared. Inventing
  // either would make a fit pass on a signal nothing measured.
  return out;
}

/** Context a reviewer wants on a refusal. Informational — decides nothing. */
function contextNote(ev: CutEvidence): string | undefined {
  const e = obj(ev) as CutEvidence;
  const sps = typeof e.secondsPerScene === "number" ? e.secondsPerScene : null;
  const songLike = e.hasMusicTrack === true && sps !== null && sps > 0 && sps < 1.3 && num(e.sceneCount) > 40;
  if (!songLike) return undefined;
  return (
    `Context only: ${e.sceneCount} scenes at ~${sps}s each over a music track — a song-driven montage. ` +
    `Behind the Install is a documentary how-to whose lesson is the installer's own speech; this cut's ` +
    `native audio is not kept, so no instruction survives into it. That is why the pace is printed and ` +
    `not counted as evidence: it describes the cut, it does not name a show.`
  );
}

/**
 * Decide what to do with ONE row. Pure: no database, no network, no clock
 * unless one is passed.
 *
 * Never throws — a null, a number or a wholly malformed row yields a refusal,
 * because a pass that dies on row 9 of 75 leaves the queue worse than one that
 * reports row 9 as a gap.
 *
 * Order IS the policy, and the conservative outcomes come first so a row can
 * never reach a write by slipping past a guard.
 */
export function planShowTag(ev: CutEvidence | null | undefined, now = new Date().toISOString()): ShowTagPlan {
  const e = obj(ev) as CutEvidence;
  const id = typeof e.id === "string" ? e.id : String(e.id ?? "");
  const brand = String(e.brand ?? "").trim();
  const note = contextNote(e);

  // 1. Already tagged. Never overwritten — a human or the live worker may have
  //    set it, and a backfill that argues with them is a backfill nobody can
  //    trust to run twice.
  const existing = String(e.existingShowFormat ?? "").trim();
  if (existing) {
    return {
      id, action: "skip", why: "already_tagged", evidence: [],
      detail: `already tagged \`${existing}\` — left alone.`,
    };
  }

  // 2. Does anything NAME a show? Title first (the producer's own label), then
  //    the weaker pipeline-token reference.
  const named = showsNamedInTitle(e.title);
  let format: ShowFormat | null = null;
  let kind: TagKind | null = null;
  let naming = "";

  if (named.length > 1) {
    return {
      id, action: "refuse", why: "ambiguous", evidence: [], note,
      detail:
        `REFUSED — the title names ${named.length} shows at once (${named.map((f) => f.label).join(", ")}). ` +
        `A cut belongs to one show; a human decides which.`,
    };
  }
  if (named.length === 1) {
    format = named[0];
    kind = "title";
    naming = `title \`${String(e.title ?? "")}\` prints the show name "${format.label}"`;
  } else {
    const referenced = showReferencedBySource(e.blueprintSource);
    if (referenced) {
      format = referenced;
      kind = "reference";
      naming =
        `blueprint.source \`${String(e.blueprintSource ?? "")}\` carries a word from ${referenced.label}'s own ` +
        `declared reference ("${referenced.reference}")`;
    }
  }

  if (!format || !kind) {
    return {
      id, action: "refuse", why: "no_show_named", evidence: [], note,
      detail:
        `REFUSED — nothing on this row names a show. Neither the title nor \`blueprint.source\` carries a ` +
        `declared show name, and pace, scene count and clip mix are not evidence of one. Needs a human to say.`,
    };
  }

  // 3. Somebody else's show. `routeEditor` refuses this one layer up for the
  //    same reason: a format belongs to a brand, and a weprintwraps cut cannot
  //    belong to a wraptvworld show however its title reads.
  if (brand && normalize(brand) !== normalize(format.brand)) {
    const mine = formatsForBrand(brand);
    return {
      id, action: "refuse", why: "wrong_brand", evidence: [naming], note,
      detail:
        `REFUSED — the title names ${format.label}, which is ${format.brand}'s show, but this cut is branded ` +
        `\`${brand}\`. ` +
        (mine.length
          ? `${brand}'s own shows are ${mine.map((f) => f.label).join(", ")}.`
          : `${brand} has NO declared shows, so there is nothing correct to tag it with — declare one, or re-brand the cut.`),
    };
  }

  // 4. The row has to agree. A name with nothing behind it is exactly the case
  //    where a tag would look right and be wrong.
  const corroboration = corroborate(format, e);
  if (!corroboration.length) {
    return {
      id, action: "refuse", why: "uncorroborated", evidence: [naming], note,
      detail:
        `REFUSED — ${naming}, but NOTHING MEASURED ON THE ROW backs it up. The name being real is not proof ` +
        `the cut is that show. A human decides this one.`,
    };
  }

  const fit = formatFits(format, measuredSignals(e));
  const unresolved = Math.max(0, num(e.sceneCount) - num(e.clipsResolved));
  const evidence = [naming, ...corroboration];

  const patch: TagPatch = {
    show_format: format.key,
    show_editor: format.editor,
    show_format_source: `backfill:${kind}`,
    show_format_backfill: {
      at: now,
      by: TAG_SOURCE,
      why: kind === "title" ? "title_names_show" : "source_references_show",
      evidence,
      // The label and the fitness check, recorded side by side and never
      // merged. `fits: false` on a tagged cut is a finding for the reviewer.
      fit: { ok: fit.ok, missing: fit.missing, message: fit.message },
      measured: {
        sceneCount: num(e.sceneCount),
        clipsResolved: num(e.clipsResolved),
        clipSlotsUnresolvable: unresolved,
        speechClips: num(e.speechClips),
        installClips: num(e.installClips),
        hasMusicTrack: e.hasMusicTrack === true,
      },
    },
  };

  return {
    id,
    action: "tag",
    why: kind === "title" ? "title_names_show" : "source_references_show",
    kind,
    showKey: format.key,
    editor: format.editor,
    evidence,
    fit,
    detail:
      `${kind} tag — ${format.label} (\`${format.key}\`, ${format.editor} editor); corroborated by ` +
      `${corroboration.join("; ")}. ` +
      (fit.ok
        ? `Measured footage also satisfies the show's requirements.`
        : `NOTE: measured footage does NOT satisfy the show (missing ${fit.missing.join(", ")})` +
          (unresolved ? `, and ${unresolved} clip slot(s) resolve to no parsed source, so speech is unknown rather than absent` : "") +
          `. Tagged anyway because the tag records WHICH SHOW IT WAS MADE AS, which is what the review queue filters on; the gap is recorded beside it for the reviewer.`),
    patch,
  };
}

/**
 * Last line of defence before a write: a tag may only ADD the keys in
 * `TAG_PATCH_KEYS`, and every pre-existing key must survive untouched.
 *
 * The blueprint is one JSONB column holding `scenes` — the cut itself. A
 * backfill that replaced rather than merged would erase the film and leave a
 * label behind. Throws rather than repairing, because a patch that drops
 * `scenes` is not a patch with a bug, it is a patch built by something that
 * misunderstood the column.
 */
export function assertBlueprintPreserved(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): void {
  const b = obj(before);
  const a = obj(after);
  const allowed = new Set<string>(TAG_PATCH_KEYS);

  const lost: string[] = [];
  for (const k of Object.keys(b)) {
    if (allowed.has(k)) continue;
    if (!(k in a)) { lost.push(`${k} (dropped)`); continue; }
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) lost.push(`${k} (changed)`);
  }
  if (lost.length) {
    throw new Error(
      `refusing to write: the blueprint would lose or alter ${lost.join(", ")}. A show tag may only ADD ` +
        `${TAG_PATCH_KEYS.join(", ")} — the blueprint holds \`scenes\`, which IS the cut.`,
    );
  }

  const added = Object.keys(a).filter((k) => !(k in b));
  const illegal = added.filter((k) => !allowed.has(k));
  if (illegal.length) {
    throw new Error(
      `refusing to write: the patch adds ${illegal.join(", ")}, which is not a show-tag key. ` +
        `Allowed: ${TAG_PATCH_KEYS.join(", ")}.`,
    );
  }
}

/** Merge a tag onto a blueprint. Pure; the caller asserts the result. */
export function applyTag(
  blueprint: Record<string, unknown> | null | undefined,
  patch: TagPatch,
): Record<string, unknown> {
  return { ...obj(blueprint), ...patch };
}

// ─── Summary ────────────────────────────────────────────────────────────────

export interface TagSummary {
  scanned: number;
  alreadyTagged: number;
  tagTitle: number;
  tagReference: number;
  refusedNoShowNamed: number;
  refusedWrongBrand: number;
  refusedUncorroborated: number;
  refusedAmbiguous: number;
  /** show key → how many rows would carry it. */
  byShow: Record<string, number>;
  /** Tagged rows whose measured footage does not satisfy the show. */
  taggedButUnfit: number;
}

/** Roll a set of plans into the printed summary. Pure. */
export function summarizeTags(plans: ShowTagPlan[]): TagSummary {
  const s: TagSummary = {
    scanned: Array.isArray(plans) ? plans.length : 0,
    alreadyTagged: 0, tagTitle: 0, tagReference: 0,
    refusedNoShowNamed: 0, refusedWrongBrand: 0,
    refusedUncorroborated: 0, refusedAmbiguous: 0,
    byShow: {}, taggedButUnfit: 0,
  };
  for (const p of Array.isArray(plans) ? plans : []) {
    switch (p?.why) {
      case "already_tagged": s.alreadyTagged++; break;
      case "title_names_show":
      case "source_references_show": {
        if (p.kind === "title") s.tagTitle++; else s.tagReference++;
        if (p.showKey) s.byShow[p.showKey] = (s.byShow[p.showKey] || 0) + 1;
        if (p.fit && !p.fit.ok) s.taggedButUnfit++;
        break;
      }
      case "no_show_named": s.refusedNoShowNamed++; break;
      case "wrong_brand": s.refusedWrongBrand++; break;
      case "uncorroborated": s.refusedUncorroborated++; break;
      case "ambiguous": s.refusedAmbiguous++; break;
      default: break;
    }
  }
  return s;
}

/** The rows this pass will actually write, given the approved kinds. Pure. */
export function writableTags(plans: ShowTagPlan[], kinds: readonly TagKind[]): ShowTagPlan[] {
  const approved = new Set<string>(kinds || []);
  return (Array.isArray(plans) ? plans : []).filter(
    (p) => p?.action === "tag" && !!p.patch && !!p.kind && approved.has(p.kind),
  );
}

/** Every show a given key resolves to, for the printed legend. */
export function tagLegend(): Array<{ key: string; label: string; brand: string; editor: EditorKind }> {
  return SHOW_FORMATS.map((f) => ({ key: f.key, label: f.label, brand: f.brand, editor: f.editor }));
}

export { showFormat };
