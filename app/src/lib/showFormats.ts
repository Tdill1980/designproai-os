/**
 * showFormats — the named shows, and which editor cuts each one.
 *
 * Owner, 2026-08-06: "WrapTV Behind the Brand docu style, Behind Shop Doors
 * MTV Cribs style edits" — arriving in the same conversation as "there needs to
 * be the music video editor and the new editor intelligence editor", "two
 * separate editors".
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * Those two sentences are one instruction. There are two editors because there
 * are two KINDS OF SHOW, and until now the choice between them was a checkbox
 * on a form ("Fast Cut" or "Story Edit") that a person had to get right every
 * time, with nothing recording WHY one was correct. That is how a documentary
 * interview ends up beat-cut to a music bed, and how a shop tour ends up as
 * talking heads — both live failures of a choice nobody wrote down.
 *
 * A show format writes it down. "Behind the Brand" is a documentary and is cut
 * by the intelligence editor, which protects speech and cuts on meaning.
 * "Behind Shop Doors" is a Cribs-style tour and is cut by the music editor,
 * which cuts on the beat. The show decides the editor; the operator picks a
 * show, which is a thing they actually know.
 *
 * ── WHAT THIS FILE REFUSES TO DO ───────────────────────────────────────────
 * It does not cut anything, does not write copy, and does not invent a show. A
 * format is a declaration of intent that the editors READ. If footage does not
 * suit the format the operator chose, the honest answer is to say so — the same
 * refusal `assetMatch` makes in `hookEngine.ts` — not to force a documentary
 * out of a silent shop tour.
 *
 * Pure by design: no database, no network, no clock, no AI. Locked by
 * `tests/show-formats.test.ts`.
 */

import type { Pillar } from "./contentDoctrine";

/**
 * WHICH EDITOR CUTS IT.
 *
 * `intelligence` — cuts on CONTENT. Parses what is in the footage, finds the
 *   viral hook and the educational beats, rearranges by narrative function,
 *   edits the bad parts out. Protects speech absolutely (CLAUDE.md: never trim
 *   inside speech, never speed-ramp dialogue, never fade over a line).
 * `music` — cuts on the AUDIO. Detects the beat grid, cuts on phrase
 *   boundaries, lands the action on the accent, holds the reveal on the drop.
 *   Has no dialogue to protect, which is exactly why it may cut that fast.
 */
export type EditorKind = "intelligence" | "music";

/** One shape a show ships in. */
export interface ShowForm {
  /** Stable key — used in data, so renaming one is a migration. */
  key: "short" | "long";
  label: string;
  /** The frame it is cut for. Matches the aspects `SURFACE_SHAPE` produces. */
  aspect: "9:16" | "16:9" | "4:5" | "1:1";
  /** Target runtime, `[min, max]` in seconds. A range, because a cut is not a slot. */
  seconds: [number, number];
  /** Where it goes, in the operator's words. */
  where: string;
  /** What makes this form different from the show's other one. */
  note: string;
}

export interface ShowFormat {
  /** Stable key. Used in data — renaming one is a migration, not an edit. */
  key: string;
  /** What it is called on screen and in the Engine Room. */
  label: string;
  /** Whose show it is. Matches a key in `BRANDS`. */
  brand: string;
  /** The reference an editor would actually be given. */
  reference: string;
  /** THE DECISION this file exists to record. */
  editor: EditorKind;
  /** What the show is FOR — drives which beats lead. */
  pillar: Pillar;
  /**
   * The cuts this show ships as. Optional: a show with one shape declares none
   * rather than a single entry pretending to be a choice.
   *
   * "Must be set for long and short form" (owner, on Behind the Install). Two
   * FORMS, not one cut cropped twice — a 20-second vertical and a 75-second
   * landscape are different edits of the same job, and a planner needs the
   * numbers rather than a word. Pace still comes from `FORMAT_PACE`: the short
   * form is not the long one sped up.
   */
  forms?: ShowForm[];
  /** The shape of an episode, in the order it plays. */
  structure: string[];
  /**
   * What the footage MUST contain for this format to be honest.
   *
   * Checked before cutting, and a miss is a refusal rather than a worse cut.
   * A documentary needs somebody talking; a Cribs tour needs the walk-through
   * and the reveal. Cutting "Behind the Brand" from silent b-roll does not
   * produce a weak documentary, it produces a montage mislabelled as one.
   */
  requires: string[];
  /** Why this editor, in one line a human can disagree with. */
  because: string;
}

/**
 * Roughly how long a beat may run before the format is betrayed.
 *
 * Not a hard cap — the editors own timing — but the difference between the two
 * shows in one number, and it is large on purpose. A Cribs cut that lingers is
 * not a Cribs cut; a documentary that never lets a sentence breathe is
 * unwatchable, which is the failure the speech lock was written after.
 */
export const FORMAT_PACE: Record<EditorKind, { minShot: number; typicalShot: number }> = {
  // Speech beats run their full natural length — these are the VISUAL beats
  // between them. A documentary earns its pace from what is said.
  intelligence: { minShot: 1.2, typicalShot: 3.5 },
  // Fast, and floored well above a flash frame. The floor is the readability
  // limit, not a stylistic preference.
  music: { minShot: 0.35, typicalShot: 0.9 },
};

export const SHOW_FORMATS: ShowFormat[] = [
  {
    key: "behind_the_brand",
    label: "Behind the Brand",
    brand: "wraptvworld",
    reference: "Documentary — the people and the decisions behind a shop or a brand.",
    editor: "intelligence",
    pillar: "inspire",
    structure: [
      "Cold open on the strongest thing said, or the moment something went wrong.",
      "Who they are, in their own words — not a narrated introduction.",
      "The decision or the obstacle. This is the spine; everything else serves it.",
      "What it cost, honestly — the part most brand films cut.",
      "Where it landed. The payoff earns its place because the cost was shown.",
    ],
    requires: ["speech", "a person on camera"],
    because:
      "The story is carried by what someone SAYS, so the cut has to be driven by meaning and the speech has to survive intact. A beat grid would cut across the sentences that are the entire point.",
  },
  {
    key: "behind_shop_doors",
    label: "Behind Shop Doors",
    brand: "wraptvworld",
    reference: "MTV Cribs — the tour. Energy, access, and the reveal at the end.",
    editor: "music",
    pillar: "entertain",
    structure: [
      "Establish the door / the outside. One shot, then straight in.",
      "The tour, cut to the track — bays, benches, the plotter, the racks.",
      "The people working, in motion. Faces, not interviews.",
      "The build accelerating into the drop.",
      "The finished vehicle lands ON the drop, and HOLDS. This is the only long shot in the show.",
    ],
    requires: ["a walk-through or tour footage", "a music track"],
    because:
      "It is a tour with no argument to make, so the track carries it. Cutting this on meaning would slow it to a corporate facility video — the energy IS the content.",
  },
  /**
   * BEHIND THE INSTALL — the owner's own spec, 2026-08-07, verbatim:
   *
   *   "Behind the install is supposed to be multi cuts install vids to music
   *    with the ticker where can add names of shops IG handles Must be set for
   *    long and short form"
   *
   * ── THIS REPLACES WHAT THIS FILE PREVIOUSLY INFERRED ─────────────────────
   * It used to be `intelligence` / `requires: ["speech"]` — a documentary
   * how-to, reasoned from an earlier quote about installers "giving tutorials".
   * That reasoning was careful and it was wrong about the show, because it was
   * reasoning about the format from a remark about the FOOTAGE. The person
   * whose show it is has now described the show itself, and a declaration
   * outranks an inference. The old argument is not deleted below — it is
   * answered, because its safety concern was real.
   *
   * THE OLD ARGUMENT WAS: "the music editor cutting a TEACHING install does
   * not work — it has no dialogue to protect and cuts on the beat grid, so it
   * lands cuts inside the sentence that is the entire lesson." True, and it
   * does not apply here: a BTI cut lays a track OVER the install and drops the
   * native audio (measured across the 40 existing music cuts — every one sets
   * no `keepNativeAudio` and carries a `music_url`), so there is no sentence to
   * cut into. Where a cut DOES keep native speech, CLAUDE.md's speech lock
   * still governs the beat — `enforceSpeechCraft` forces a speech beat to its
   * exact full bounds regardless of which editor planned it. The protection
   * was never the editor choice; it was the lock, and the lock stands.
   *
   * ── WHY THE TICKER IS A REQUIREMENT AND NOT A GARNISH ────────────────────
   * "the ticker where can add names of shops IG handles" is what makes this
   * show a SHOW rather than an install montage: it credits the shops whose
   * work is on screen. A BTI cut with no names has nothing to distinguish it
   * from Behind Shop Doors, and the crawl is the thing the audience is in it
   * for — seeing their own handle go past. `worker/video-renderer`'s
   * `tickerFilters` already draws it, the Cut Editor already collects the
   * names, and the names are strings a human supplied — this invents no shop
   * and no handle, ever.
   *
   * ── LONG AND SHORT ARE BOTH FIRST-CLASS ──────────────────────────────────
   * "Must be set for long and short form." Not one cut cropped two ways: a
   * 20-second vertical and a 75-second landscape are different edits of the
   * same job, and `forms` below says so in numbers a planner can read. Pace
   * comes from `FORMAT_PACE.music` either way — the short form is not the long
   * one sped up.
   *
   * ── WHAT IT REQUIRES, AND WHY EXACTLY THESE THREE ────────────────────────
   * `behind_shop_doors` is the cautionary tale: it demands a tour signal
   * nothing in the library can assert, so it refuses everything and the
   * refusal reads like a footage problem. Every requirement here is one the
   * system can actually answer:
   *
   *   • INSTALL FOOTAGE — the subject. Asserted from the asset taxonomy, and
   *     as of the multi-use column that is 71 library assets rather than the
   *     24 this file once had to note as the limit: install clips filed under
   *     the interview they also are now count, because they always were
   *     install footage.
   *
   *   • A MUSIC TRACK — the show is cut to it. This is the reversal from the
   *     old definition, and it is the owner's word: "install vids to music".
   *
   *   • A TICKER OF SHOP NAMES — see above. A human supplies the names; the
   *     show refuses rather than crediting a shop nobody named.
   *
   * SPEECH is NOT required, and that is the whole inversion. A silent install
   * cut to a track with the shops named IS this show, not a lesser version of
   * it.
   */
  {
    key: "behind_the_install",
    label: "Behind the Install",
    brand: "wraptvworld",
    reference:
      "Install footage cut to music — many short cuts of real hands working, with a bottom crawl naming the shops and handles whose work is on screen.",
    editor: "music",
    pillar: "educate",
    structure: [
      "Open on the most satisfying second in the pool — the peel, the corner going down, the squeegee pass. On the first accent, never on a title card.",
      "MANY CUTS. The trade at working speed: prep, squeegee, heat, trim, tuck, cut in — each held only as long as it reads, landing on the beat.",
      "The ticker runs the whole way: FEATURED SHOPS, their names and IG handles crawling the bottom bar. It is the credit roll, and it never stops mid-cut.",
      "A breath before the end — one longer shot so the eye rests before the payoff.",
      "The reveal, and it HOLDS through the drop. The finished vehicle earns its length because the work was shown.",
    ],
    forms: [
      {
        key: "short",
        label: "Short form",
        aspect: "9:16",
        seconds: [15, 30],
        where: "Reels · TikTok · Shorts",
        note: "Vertical and fast. Opens on the strongest second — there is no room for a build.",
      },
      {
        key: "long",
        label: "Long form",
        aspect: "16:9",
        seconds: [60, 120],
        where: "YouTube · the site · a shop's lobby screen",
        note: "Landscape, and the install is allowed to play out in order. The ticker gets a full cycle or more.",
      },
    ],
    requires: ["install footage", "a music track", "a ticker of shop names"],
    because:
      "The track carries it and the cuts land on the beat, which is why they may be this fast — there is no dialogue underneath to protect. The ticker is what makes it a show rather than a montage: it credits the shops whose work is on screen.",
  },
];

const BY_KEY = new Map(SHOW_FORMATS.map((f) => [f.key, f]));

export function showFormat(key: string | null | undefined): ShowFormat | null {
  return BY_KEY.get(String(key || "").trim()) || null;
}

/** The shows a given brand actually has. Empty is a real answer. */
export function formatsForBrand(brand: string | null | undefined): ShowFormat[] {
  const b = String(brand || "").trim().toLowerCase();
  return b ? SHOW_FORMATS.filter((f) => f.brand.toLowerCase() === b) : [];
}

export interface FormatFit {
  ok: boolean;
  /** Which of `requires` the footage does not have. */
  missing: string[];
  /** Plain language, always set — including on success. */
  message: string;
}

/**
 * Can this footage honestly be cut as this show?
 *
 * `has` is what the parse actually found — pass the real signals (whether there
 * is a transcript, whether a face was detected, whether a music track was
 * chosen), not what the card hoped for. An unknown signal is NOT a pass: this
 * returns a miss and names it, because the failure being prevented is a silent
 * downgrade where an operator asks for a documentary and gets a montage with a
 * documentary's title on it.
 */
export function formatFits(
  format: ShowFormat | null | undefined,
  has: Iterable<string>,
): FormatFit {
  if (!format) {
    return { ok: false, missing: [], message: "No show format chosen — pick one before cutting, or the editor is guessing at the shape of the piece." };
  }
  const present = new Set<string>();
  for (const h of has) {
    const v = String(h || "").trim().toLowerCase();
    if (v) present.add(v);
  }
  const missing = format.requires.filter((r) => !present.has(r.toLowerCase()));
  if (!missing.length) {
    return { ok: true, missing: [], message: `The footage carries everything ${format.label} needs.` };
  }
  return {
    ok: false,
    missing,
    // Names the gap AND the alternative, so the operator has somewhere to go.
    // "Does not fit" on its own gets ignored; "does not fit, but this other
    // show does" gets acted on.
    message: `This footage cannot honestly be cut as ${format.label} — it has no ${missing.join(", no ")}. ${suggestion(format)}`,
  };
}

function suggestion(format: ShowFormat): string {
  const alt = SHOW_FORMATS.find((f) => f.key !== format.key && f.editor !== format.editor);
  return alt
    ? `Shoot the missing piece, or cut it as ${alt.label} instead.`
    : "Shoot the missing piece before cutting.";
}
