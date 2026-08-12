/**
 * hookOverlay — the hook, ON SCREEN, with an editor's timing.
 *
 * Owner, 2026-08-06: "must act like a real editor … creates hook overlay
 * caption" / "must wire as operating system, use native tools, but must operate
 * as software editing".
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 * Today the hook is `opts.hookText` dropped onto scene 0 as a `drawtext` at
 * `textPosition:"top"` (`brandcastPlanner.planStoryEditScenes`). That is a
 * placement, not an edit. It has no timing discipline — the line inherits the
 * whole scene, so a four-word hook sits there for six seconds while the cut has
 * moved on. It has no per-channel window, so the same overlay is planned for a
 * TikTok whose hook has one second to work and a YouTube longform that has
 * fifteen. It has no per-brand treatment, so every brand's hook reads in the
 * same white DejaVu box. And it has no connection at all to the Hook Engine
 * that decides what the hook should SAY.
 *
 * This module is the missing half: it takes a line somebody else wrote and
 * decides WHEN it is up, HOW LONG, WHERE in frame, and IN WHAT TYPE — then
 * emits the ffmpeg the worker burns.
 *
 * ── THIS MODULE DOES NOT WRITE HOOK COPY. ──────────────────────────────────
 * Same line `hookEngine.ts` and `videoAngles.ts` both hold, for the same
 * reason: pure code has no ear and cannot read the footage, so a "hook"
 * generated here would be a template with the brand name dropped into it —
 * exactly the canned-template slop the GENIE pre-pass was removed for (CLAUDE.md:
 * "GENIE's canned commercial/trade templates ARE the slop").
 *
 * So there is NO fallback string anywhere below. No brand name, no topic, no
 * idea text, no "SEE THE REVEAL". If no hook line was supplied, the plan renders
 * NOTHING and says why — an honest gap, the same rule the panel pipeline holds
 * ("a side that can't be cropped is an HONEST GAP, never AI-invented"). The
 * absence of a fallback is asserted directly by `tests/hook-overlay.test.ts`,
 * because a fallback is invisible in output: a templated hook looks like a
 * written one until you diff two brands.
 *
 * ── WHAT IT REUSES RATHER THAN REDEFINES ───────────────────────────────────
 *   · the hook WINDOW      → `CHANNELS[channel].hookWindow` (contentDoctrine.ts),
 *                            parsed, never restated. One source of truth.
 *   · the PILLAR default   → `CHANNELS[channel].pillars[0]`, same as hookEngine.
 *   · brand COLOUR         → `BRAND_META[brand].color` (content-tags.ts). The
 *                            WrapTVWorld value is #EC4899, which is byte-for-byte
 *                            the worker's `WTV_ACCENT = "0xEC4899"` — the accent
 *                            language already exists and a second one would break
 *                            it (CLAUDE.md: one visual language).
 *   · FONTS                 → the four the worker already bundles and resolves in
 *                            `fontFileFor()`: anton · bebas · oswald · playfair,
 *                            plus "clean" for the system default. This module
 *                            names the KEY; the worker owns the .ttf path.
 *   · ESCAPING + WRAPPING   → ports the worker's `esc()` and `wrapLines()` rules
 *                            verbatim (see the functions below for why each one
 *                            exists — both are live-bug fixes, not style).
 *
 * Pure by design: no database, no network, no clock, no AI, no randomness. Same
 * inputs → same plan, byte for byte. Locked by `tests/hook-overlay.test.ts`.
 */

import { CHANNELS, type ChannelKey, type Pillar } from "./contentDoctrine";
import { BRAND_META } from "./content-tags";

// ─── The frame regions a burned overlay can own ──────────────────────────────

/**
 * Matches the worker's `yForPosition()` exactly — top = h*0.12, center =
 * centred, bottom = h*0.78. Three regions, not free coordinates, because
 * collision detection against captions and lower thirds has to be decidable:
 * two elements either share a region or they do not.
 */
export type HookRegion = "top" | "center" | "bottom";

/** Region preference when the treatment's own region is already occupied. */
const REGION_ORDER: HookRegion[] = ["top", "center", "bottom"];

// ─── The channel window ──────────────────────────────────────────────────────

export interface HookWindow {
  channel: ChannelKey | string;
  /** Whether the doctrine actually knows this channel. */
  known: boolean;
  /** The doctrine's own words — quoted, never paraphrased. */
  label: string;
  /**
   * Seconds the hook has to be on screen by. `null` when the channel's hook
   * window is a TEXT or STILL surface ("first 2 lines", "subject line", "the
   * image itself") — those are windows on the post copy, not on the frame, and
   * inventing a number for them would be a second source of truth.
   */
  seconds: number | null;
  /** How the seconds were derived, so the number can be argued with. */
  basis: string;
}

/**
 * The on-screen window for one channel, DERIVED from the doctrine.
 *
 * `CHANNELS[channel].hookWindow` is the single source of truth and it is prose
 * ("first 1 second", "first 15 seconds", "first 2 lines", "the image itself").
 * This parses it rather than restating it as a number table, because a number
 * table is a second source of truth and the two would drift the first time
 * somebody tunes the doctrine — which is precisely the failure CLAUDE.md
 * documents over and over ("a section here is a lead, not a fact").
 *
 * A hook that appears after the window has closed has already failed, which is
 * why `planHookOverlay` reports `landsInWindow` rather than silently allowing it.
 */
export function hookWindowFor(channel: ChannelKey | string): HookWindow {
  const rule = CHANNELS[channel as ChannelKey];
  if (!rule) {
    return {
      channel,
      known: false,
      label: "",
      seconds: null,
      basis: `No channel rule for "${channel}" — add it to CHANNELS in contentDoctrine.ts. Timed as if there were no stated deadline.`,
    };
  }

  const label = rule.hookWindow;
  const m = label.match(/(\d+(?:\.\d+)?)\s*second/i);
  if (m) {
    return {
      channel,
      known: true,
      label,
      seconds: Number(m[1]),
      basis: `CHANNELS.${channel}.hookWindow — "${label}".`,
    };
  }
  return {
    channel,
    known: true,
    label,
    seconds: null,
    basis: `CHANNELS.${channel}.hookWindow is "${label}" — a window on the copy or the still, not on the frame. No on-screen deadline is stated, and none is invented here.`,
  };
}

// ─── Reading time ────────────────────────────────────────────────────────────

/**
 * Characters per second a viewer can READ burned-in type.
 *
 * 15 CPS ≈ 180 words per minute. That is the BBC subtitle guideline and sits
 * just under Netflix's 17 CPS adult limit, and the slower end is deliberate:
 * subtitle rates assume somebody reading a line at the bottom of a screen they
 * are already watching, whereas a hook overlay competes with the picture it is
 * laid over — the whole point of the shot underneath is that it is worth
 * looking at. A hook that is technically legible but flashes past unread is the
 * same failure as no hook at all, and it is invisible in QA because the frame
 * grab shows the text perfectly.
 */
export const READING_CHARS_PER_SECOND = 15;

/**
 * Before reading starts, the eye has to FIND the text. A fixed acquisition cost
 * on top of the per-character rate, otherwise a three-word hook computes to
 * ~0.9s and is gone before anyone has looked at it.
 */
export const READING_ACQUISITION_SECONDS = 0.4;

/** Nothing is ever shown for less than this, however short the line. */
export const MIN_HOOK_HOLD_SECONDS = 1.2;

/**
 * A hook line still on screen after six seconds has stopped being a hook and
 * become a title card — it is now covering whatever the cut moved on to.
 */
export const MAX_HOOK_HOLD_SECONDS = 6;

/**
 * How far past the channel's stated hook window the overlay may live before it
 * reads as clutter. 3× — the hook has to survive long enough to be read after
 * the window closes (a 1-second window does not mean a 1-second overlay), but
 * not so long that a fast surface carries a static line through three cuts.
 */
export const HOOK_HOLD_WINDOW_MULTIPLE = 3;

/** How long this exact line needs to be on screen to be read. */
export function readSecondsFor(line: string | null | undefined): number {
  const text = String(line || "").trim();
  if (!text) return 0;
  return round2(READING_ACQUISITION_SECONDS + text.length / READING_CHARS_PER_SECOND);
}

// ─── Treatment: per brand, per pillar ────────────────────────────────────────

/** The font keys the worker's `fontFileFor()` already resolves. */
export type HookFont = "anton" | "bebas" | "oswald" | "playfair" | "clean";

export interface HookTreatment {
  /** The brand key this resolved to ("" when the brand is unknown). */
  brand: string;
  brandLabel: string;
  pillar: Pillar;
  font: HookFont;
  /** Cap height as a fraction of frame height. */
  sizePct: number;
  region: HookRegion;
  align: "left" | "center";
  uppercase: boolean;
  /** A dark plate behind the type (worker's `box=1`), vs a drop shadow. */
  plate: boolean;
  /** The brand's accent hairline above the type, lower-third style. */
  rule: boolean;
  /** ffmpeg colour, `0xRRGGBB`, from `BRAND_META[brand].color`. */
  accent: string;
  /** Why this brand looks like this. Kept visible, same as videoAngles. */
  because: string;
}

/**
 * The BRAND half of the treatment. Colour comes from `BRAND_META` — this file
 * does not own a single hex value of its own.
 *
 * Region defaults to "top" almost everywhere on purpose: in this worker the
 * bottom third is already spoken for (captions land at `h*0.78`, lower thirds
 * at `h*0.76`, the ticker rides the bottom edge), so the top is the only region
 * a hook can own without fighting something. Ink & Edge is the exception — a
 * centred serif plate is its editorial register, and it never runs with
 * documentary lower thirds.
 */
const BRAND_TREATMENT: Record<string, Pick<HookTreatment, "font" | "region" | "align" | "uppercase" | "plate" | "rule" | "because">> = {
  weprintwraps: {
    font: "anton", region: "top", align: "center", uppercase: true, plate: true, rule: false,
    because: "Trade to trade. Maximum legibility over messy shop footage beats looking clever — the plate guarantees contrast on any frame.",
  },
  restylepro: {
    font: "oswald", region: "top", align: "left", uppercase: true, plate: false, rule: true,
    because: "Peer-to-peer and commercial. Left-aligned condensed with the brand hairline reads as a statement, not a caption.",
  },
  designproai: {
    font: "bebas", region: "top", align: "left", uppercase: true, plate: false, rule: true,
    because: "Designer to designer — the type IS the credential. Shadow over plate so the artwork underneath is never boxed out.",
  },
  wraptvworld: {
    font: "bebas", region: "top", align: "left", uppercase: true, plate: false, rule: true,
    because: "The show's own MTV register — the same condensed face and magenta hairline as its lower thirds, so the hook belongs to the same broadcast.",
  },
  wraptv: {
    font: "bebas", region: "top", align: "left", uppercase: true, plate: false, rule: true,
    because: "Alias of wraptvworld — drafts land under both slugs (content-tags.ts), and the treatment must not change with the spelling.",
  },
  inkandedge: {
    font: "playfair", region: "center", align: "center", uppercase: false, plate: true, rule: false,
    because: "Editorial. A centred serif plate is a magazine title card; sentence case because a headline argued in caps stops being an argument.",
  },
  creatormarket: {
    font: "oswald", region: "top", align: "left", uppercase: true, plate: false, rule: true,
    because: "Direct and encouraging to creators — plain condensed type, brand hairline, nothing between the line and the work.",
  },
};

/**
 * The PILLAR half. What the piece is FOR changes how loud the hook is and
 * whether legibility outranks looks.
 */
const PILLAR_TREATMENT: Record<Pillar, { sizePct: number; forcePlate: boolean; because: string }> = {
  entertain: {
    sizePct: 0.075, forcePlate: false,
    because: "Entertain leads with the line — biggest type on the ladder, and no plate: the picture is the payoff and boxing it out fights the piece.",
  },
  educate: {
    sizePct: 0.058, forcePlate: true,
    because: "Educate must be READ over demonstration footage, so the plate is forced on and the type comes down to make room for a fuller sentence. A lesson nobody can read is not a lesson.",
  },
  inspire: {
    sizePct: 0.065, forcePlate: false,
    because: "Inspire sits between the two — present enough to frame the work, never covering it.",
  },
};

/** Same as `hookEngine.pillarFor` — the channel's first pillar is its default. */
function defaultPillar(channel: ChannelKey | string): Pillar {
  const rule = CHANNELS[channel as ChannelKey];
  return (rule?.pillars?.[0] as Pillar) || "educate";
}

/** `#RRGGBB` → `0xRRGGBB`, the form ffmpeg's drawtext/drawbox take. */
export function ffmpegColor(hex: string): string {
  return `0x${String(hex || "").replace(/^#/, "").toUpperCase()}`;
}

/**
 * The treatment for one brand on one pillar. Pure — same pair in, identical
 * object out, which is what makes a brand read the same across every cut.
 */
export function treatmentFor(brand: string | null | undefined, pillar: Pillar): HookTreatment {
  const key = String(brand || "").trim().toLowerCase();
  const meta = BRAND_META[key];
  const brandSpec = BRAND_TREATMENT[key];
  const pillarSpec = PILLAR_TREATMENT[pillar] || PILLAR_TREATMENT.educate;

  // UNKNOWN BRAND IS AN HONEST DEFAULT, NOT A GUESS. The neutral slate that
  // `brandMeta()` already returns, in the system face, said out loud in
  // `because` — never the nearest-looking brand's identity.
  if (!brandSpec) {
    return {
      brand: "",
      brandLabel: meta?.label || String(brand || "").trim() || "",
      pillar,
      font: "clean",
      sizePct: pillarSpec.sizePct,
      region: "top",
      align: "center",
      uppercase: false,
      plate: true,
      rule: false,
      accent: ffmpegColor(meta?.color || "#64748B"),
      because: `No treatment for brand "${String(brand || "").trim() || "(none)"}" — neutral system type, so it is obvious this piece was never styled. Add it to BRAND_TREATMENT in hookOverlay.ts.`,
    };
  }

  return {
    brand: key,
    brandLabel: meta?.label || key,
    pillar,
    font: brandSpec.font,
    sizePct: pillarSpec.sizePct,
    region: brandSpec.region,
    align: brandSpec.align,
    uppercase: brandSpec.uppercase,
    plate: brandSpec.plate || pillarSpec.forcePlate,
    rule: brandSpec.rule,
    accent: ffmpegColor(meta?.color || "#64748B"),
    because: `${brandSpec.because} ${pillarSpec.because}`,
  };
}

// ─── What the timeline looks like from here ──────────────────────────────────

/**
 * A scene on the OUTPUT timeline.
 *
 * Declared structurally rather than imported from `editorCraft.ts` so the two
 * modules can land independently — this needs `outStart`/`outEnd` and nothing
 * else, and a type import would couple two in-flight files for no gain.
 */
export interface HookScene {
  sceneId?: string;
  /** Seconds on the finished cut's timeline. */
  outStart: number;
  outEnd: number;
  purpose?: string;
}

/** Anything already occupying a region for a span — a caption cue, a lower third. */
export interface TimedRegion {
  start: number;
  end: number;
  region?: HookRegion;
  /** What it is, for the collision note. */
  what?: string;
}

/**
 * Merge caption cues and lower thirds into one occupancy list.
 *
 * Both default to "bottom" when they do not say otherwise, because that is
 * where the worker actually draws them: `yForPosition("bottom")` = `h*0.78` for
 * captions, `y1 = outH*0.76` for `lowerThirdFilters`.
 */
export function occupiedRegions(
  captionCues?: TimedRegion[] | null,
  lowerThirds?: TimedRegion[] | null,
): TimedRegion[] {
  const out: TimedRegion[] = [];
  for (const c of captionCues || []) {
    if (!isSpan(c)) continue;
    out.push({ start: Number(c.start), end: Number(c.end), region: c.region || "bottom", what: c.what || "caption cue" });
  }
  for (const l of lowerThirds || []) {
    if (!isSpan(l)) continue;
    out.push({ start: Number(l.start), end: Number(l.end), region: l.region || "bottom", what: l.what || "lower third" });
  }
  return out;
}

function isSpan(t: TimedRegion | null | undefined): boolean {
  return !!t && Number.isFinite(Number(t.start)) && Number.isFinite(Number(t.end)) && Number(t.end) > Number(t.start);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// ─── The plan ────────────────────────────────────────────────────────────────

export interface HookOverlayInput {
  /** The line SOMEBODY ELSE WROTE. Nothing here invents one. */
  hookLine?: string | null;
  channel: ChannelKey | string;
  brand?: string | null;
  /** Defaults to the channel's first pillar, same as hookEngine. */
  pillar?: Pillar | null;
  /** Output-timeline scenes, contiguous. The hook belongs to the first one. */
  scenes: HookScene[];
  captionCues?: TimedRegion[] | null;
  lowerThirds?: TimedRegion[] | null;
}

export interface HookOverlayPlan {
  /** FALSE means nothing is drawn — and `reason` says why, out loud. */
  rendered: boolean;
  /** Set whenever `rendered` is false. */
  reason?: string;
  /** The supplied line, trimmed. "" when none was supplied. Never a fallback. */
  text: string;
  /**
   * OUTPUT-TIMELINE seconds — absolute, measured on the finished cut.
   *
   * The worker runs BOTH conventions and they are not interchangeable:
   * `lowerThirdFilters` is burned per segment and its times are SEGMENT-LOCAL,
   * while `nowPlayingFilters` and `tickerFilters` are drawn after concat and
   * are absolute. These are absolute, so `hookOverlayFilters` output belongs in
   * the post-concat pass — or its `enable` bounds must be rebased by the
   * scene's `outStart` first. Burned per-segment without rebasing, a hook
   * planned for 0–4.3s would appear on every segment that spans those seconds.
   */
  start: number;
  end: number;
  region: HookRegion;
  /** The scene the overlay belongs to, and may never outlive. */
  sceneId?: string;
  window: HookWindow;
  treatment: HookTreatment;
  /** Did it get on screen before the channel's window closed? */
  landsInWindow: boolean;
  /** How long this line needs to be readable. */
  readSeconds: number;
  /** Past this it reads as clutter on this channel. */
  clutterCeilingSeconds: number;
  /** Every compromise made, named. Never silent. */
  notes: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Decide when the hook is on screen, for how long, and where.
 *
 * The craft constraints, in the order they bind:
 *
 *  1. UP FROM FRAME ONE. The overlay starts with its scene. A hook that fades
 *     in has already lost the scroll — on a 1-second window there is no room
 *     for an entrance.
 *  2. LONG ENOUGH TO BE READ. `readSecondsFor` is a floor, and it OUTRANKS the
 *     clutter ceiling: a line held for less time than it takes to read is
 *     indistinguishable from no hook, so when the two conflict the hold is
 *     extended and the conflict is written into `notes` for whoever should
 *     shorten the copy.
 *  3. GONE BEFORE IT IS CLUTTER. Bounded by the channel's own window
 *     (×`HOOK_HOLD_WINDOW_MULTIPLE`, capped at `MAX_HOOK_HOLD_SECONDS`).
 *  4. NEVER OUTLIVES ITS SCENE. The line belongs to the shot it was cut for;
 *     carrying it across a cut makes it a lower third by accident.
 *  5. NEVER FIGHTS A CAPTION OR A LOWER THIRD for the same region at the same
 *     instant. It moves region first, and only shortens if every region is
 *     taken.
 */
export function planHookOverlay(input: HookOverlayInput): HookOverlayPlan {
  const channel = input?.channel;
  const window = hookWindowFor(channel);
  const pillar = (input?.pillar as Pillar) || defaultPillar(channel);
  const treatment = treatmentFor(input?.brand, pillar);
  const notes: string[] = [];

  const base: HookOverlayPlan = {
    rendered: false,
    text: "",
    start: 0,
    end: 0,
    region: treatment.region,
    window,
    treatment,
    landsInWindow: false,
    readSeconds: 0,
    clutterCeilingSeconds: 0,
    notes,
  };

  // ── THE HONEST GAP. No line was written, so nothing is drawn.
  // There is deliberately no `?? brand.label`, no `?? topic`, no template.
  // Rendering the brand name here would look like a hook in every review and
  // be a hook in none of them.
  const text = String(input?.hookLine || "").trim();
  if (!text) {
    return {
      ...base,
      reason:
        "No hook line was supplied, so nothing is drawn. This module lays out and times a line that was WRITTEN elsewhere (Hook Engine → a model) — it does not write copy, and it will not substitute the brand name, the topic or a template for one.",
    };
  }

  const scenes = (input?.scenes || []).filter(
    (s) => s && Number.isFinite(Number(s.outStart)) && Number.isFinite(Number(s.outEnd)) && Number(s.outEnd) > Number(s.outStart),
  );
  if (!scenes.length) {
    return {
      ...base,
      text,
      reason: "No scenes on the output timeline — there is no frame to burn the hook onto.",
    };
  }

  // 1. UP FROM FRAME ONE — the hook belongs to the first scene.
  const scene = scenes[0];
  const start = round2(Math.max(0, Number(scene.outStart)));
  const sceneEnd = round2(Number(scene.outEnd));
  if (start > 0) {
    notes.push(
      `The first scene starts at ${start}s, not at 0 — the hook cannot be up before its own footage. Move the hook scene to the head of the cut if this misses the window.`,
    );
  }

  // 2/3. READ TIME vs CLUTTER CEILING.
  const readSeconds = readSecondsFor(text);
  const ceiling = window.seconds != null
    ? round2(Math.min(MAX_HOOK_HOLD_SECONDS, window.seconds * HOOK_HOLD_WINDOW_MULTIPLE))
    : MAX_HOOK_HOLD_SECONDS;
  if (window.seconds == null && window.known) {
    notes.push(
      `${window.label} is a window on the copy, not on the frame — no on-screen deadline is stated for this channel, so the overlay is held to the ${MAX_HOOK_HOLD_SECONDS}s clutter ceiling only.`,
    );
  }
  if (!window.known) notes.push(window.basis);

  let hold = Math.max(readSeconds, MIN_HOOK_HOLD_SECONDS);
  if (readSeconds > ceiling) {
    notes.push(
      `This line needs ${readSeconds}s to read at ${READING_CHARS_PER_SECOND} characters/second, past the ${ceiling}s a hook stays fresh on ${window.label || channel}. The hold was extended so it can actually be read — shorten the line instead.`,
    );
  } else {
    hold = Math.min(hold, ceiling);
  }

  let end = round2(start + hold);

  // 4. NEVER OUTLIVES ITS SCENE.
  if (end > sceneEnd) {
    notes.push(
      `Trimmed to the hook scene (${sceneEnd}s); the line wanted ${round2(start + hold)}s. Carrying it past the cut would turn a hook into a lower third${readSeconds > sceneEnd - start ? `, but ${round2(sceneEnd - start)}s is under the ${readSeconds}s this line needs — hold the shot longer or shorten the line` : ""}.`,
    );
    end = sceneEnd;
  }

  // 5. NO FIGHTING FOR THE SAME REGION AT THE SAME INSTANT.
  const occupied = occupiedRegions(input?.captionCues, input?.lowerThirds);
  const candidates = [treatment.region, ...REGION_ORDER.filter((r) => r !== treatment.region)];

  let region: HookRegion | null = null;
  for (const r of candidates) {
    const clash = occupied.some((o) => (o.region || "bottom") === r && overlaps(start, end, o.start, o.end));
    if (!clash) { region = r; break; }
  }

  if (!region) {
    // Every region is taken for part of the span. Take the treatment's own
    // region back for as long as it is genuinely free, rather than drawing
    // over something — two elements in one region is unreadable for BOTH.
    let bestRegion: HookRegion = treatment.region;
    let bestFree = -1;
    for (const r of candidates) {
      const firstClash = occupied
        .filter((o) => (o.region || "bottom") === r && overlaps(start, end, o.start, o.end))
        .reduce((min, o) => Math.min(min, o.start), Infinity);
      const free = round2(Math.max(0, firstClash - start));
      if (free > bestFree) { bestFree = free; bestRegion = r; }
    }
    if (bestFree <= 0) {
      return {
        ...base,
        text,
        region: treatment.region,
        start,
        end: start,
        readSeconds,
        clutterCeilingSeconds: ceiling,
        landsInWindow: window.seconds == null ? true : start <= window.seconds,
        reason:
          "Every frame region is already occupied by a caption cue or a lower third from the first frame of the hook scene. Drawing over them would make both unreadable — clear the opening of the caption track, or start the cut on a clean shot.",
      };
    }
    notes.push(
      `Every region is contested; held in the ${bestRegion} for the ${bestFree}s it is free rather than drawing over a ${occupied.find((o) => (o.region || "bottom") === bestRegion)?.what || "caption"}.`,
    );
    region = bestRegion;
    end = round2(start + bestFree);
  } else if (region !== treatment.region) {
    const blocker = occupied.find((o) => (o.region || "bottom") === treatment.region && overlaps(start, end, o.start, o.end));
    notes.push(
      `Moved from ${treatment.region} to ${region} — a ${blocker?.what || "caption"} holds the ${treatment.region} of frame for this span.`,
    );
  }

  // The window check is a REPORT, not a veto: the piece still gets its overlay,
  // and the failure is named so a human can fix the cut rather than the plan
  // silently shipping a hook nobody sees.
  const landsInWindow = window.seconds == null ? true : start <= window.seconds;
  if (!landsInWindow) {
    notes.push(
      `The hook does not reach the screen until ${start}s, and ${window.label} is the whole window on ${CHANNELS[channel as ChannelKey]?.label || channel}. It has already failed there.`,
    );
  }

  if (end - start < MIN_HOOK_HOLD_SECONDS) {
    notes.push(
      `On screen for only ${round2(end - start)}s — under the ${MIN_HOOK_HOLD_SECONDS}s floor. Nobody will read it.`,
    );
  }

  return {
    rendered: true,
    text,
    start,
    end,
    region,
    ...(scene.sceneId ? { sceneId: scene.sceneId } : {}),
    window,
    treatment,
    landsInWindow,
    readSeconds,
    clutterCeilingSeconds: ceiling,
    notes,
  };
}

// ─── ffmpeg: escaping, wrapping, fitting ─────────────────────────────────────

/**
 * drawtext-safe escaping. Ported from the worker's `esc()` — same five rules,
 * same order, because a mismatch is a broken filtergraph rather than an ugly
 * frame:
 *   `\`  first, or every escape added below gets escaped again.
 *   `:`  is drawtext's own option separator; an unescaped one truncates the text
 *        and then fails the graph on an unknown option.
 *   `'`  ends the quoted value. Substituted for a typographic apostrophe rather
 *        than escaped — nesting quote escapes through shell + filtergraph is the
 *        classic way this breaks, and a curly apostrophe is better typography.
 *   `%`  is expanded by drawtext's strftime handling.
 *   `\n` becomes a space; real line breaks are inserted AFTER wrapping.
 */
export function escapeDrawtext(text: string): string {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’")
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ");
}

/**
 * Characters that fit one line. The worker's formula: usable width ≈ 84% of the
 * frame, a bold/condensed character ≈ 0.5 × font size wide.
 */
export function maxCharsPerLine(frameW: number, fontSize: number): number {
  return Math.max(8, Math.floor((Number(frameW) * 0.84) / (Number(fontSize) * 0.5)));
}

/**
 * Word-wrap. ffmpeg's drawtext does NOT auto-wrap — a long line ran off both
 * edges of a 1080-wide reel and got chopped, which is a documented live bug in
 * the worker, not a hypothetical. Ported from `wrapLines()`.
 */
export function wrapHookText(text: string, maxChars: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/** Beyond this the hook is a paragraph and has stopped being a hook. */
export const MAX_HOOK_LINES = 3;

/** Type never shrinks below this, whatever the line length. */
export const MIN_HOOK_FONT_PX = 28;

export interface HookFilterOpts {
  frameW?: number;
  frameH?: number;
  /** The editor's global "Text size" S/M/L, same as `blueprint.textScale`. */
  textScale?: number;
  /**
   * Resolved .ttf path for `plan.treatment.font`. The WORKER owns font paths
   * (`fontFileFor`); this module names the key, so the path is optional and the
   * `fontfile=` term is simply omitted when it is not supplied.
   */
  fontFile?: string;
}

export interface HookOverlayFilters {
  /** ffmpeg filter strings, in draw order. Empty when nothing is rendered. */
  filters: string[];
  /** The wrapped, cased lines exactly as they will appear — pre-escape. */
  lines: string[];
  fontSize: number;
  maxChars: number;
  /** Height of the whole type block in pixels, for an in-frame check. */
  blockHeight: number;
  /** Anything the fit had to compromise. */
  notes: string[];
}

/** Matches the worker's `yForPosition()` — one source of truth for the region. */
function yExpressionFor(region: HookRegion): string {
  if (region === "top") return "h*0.12";
  if (region === "center") return "(h-text_h)/2";
  return "h*0.78";
}

/**
 * The same y, for a DRAWBOX rather than a drawtext.
 *
 * `text_h` only exists inside drawtext — handing a drawbox `(h-text_h)/2`
 * produces an "Undefined constant" and kills the whole filtergraph, taking the
 * render with it. That is not hypothetical here: the accent hairline is drawn
 * for brands whose treatment sits at the top, and `planHookOverlay` can MOVE
 * them to centre when a caption already holds the top of frame — so the centre
 * expression would have reached a drawbox in ordinary use. The measured block
 * height stands in for `text_h`, which this module knows exactly because it did
 * the wrapping itself.
 */
function boxYExpressionFor(region: HookRegion, blockHeight: number): string {
  if (region === "top") return "h*0.12";
  if (region === "center") return `(h-${blockHeight})/2`;
  return "h*0.78";
}

/**
 * The ffmpeg representation of a plan — pure data. Nothing is executed here.
 *
 * The type is FITTED before it is drawn: wrap at the frame width, and if the
 * line still needs more than `MAX_HOOK_LINES`, step the size down until it
 * fits or hits `MIN_HOOK_FONT_PX`. Shrinking is preferable to truncating,
 * because truncating edits somebody's copy — this module does not write hook
 * copy and it does not rewrite it either.
 */
export function hookOverlayFilters(
  plan: HookOverlayPlan | null | undefined,
  opts: HookFilterOpts = {},
): HookOverlayFilters {
  const frameW = Number(opts.frameW) || 1080;
  const frameH = Number(opts.frameH) || 1920;
  const scale = Number(opts.textScale) || 1;
  const notes: string[] = [];

  if (!plan || !plan.rendered || !plan.text) {
    return { filters: [], lines: [], fontSize: 0, maxChars: 0, blockHeight: 0, notes: plan?.reason ? [plan.reason] : [] };
  }

  const t = plan.treatment;
  const raw = t.uppercase ? plan.text.toUpperCase() : plan.text;

  let fontSize = Math.max(MIN_HOOK_FONT_PX, Math.round(frameH * t.sizePct * scale));
  let maxChars = maxCharsPerLine(frameW, fontSize);
  let lines = wrapHookText(raw, maxChars);
  while (lines.length > MAX_HOOK_LINES && fontSize > MIN_HOOK_FONT_PX) {
    fontSize = Math.max(MIN_HOOK_FONT_PX, Math.round(fontSize * 0.9));
    maxChars = maxCharsPerLine(frameW, fontSize);
    lines = wrapHookText(raw, maxChars);
  }
  if (lines.length > MAX_HOOK_LINES) {
    notes.push(
      `This line still needs ${lines.length} lines at the minimum ${MIN_HOOK_FONT_PX}px — it is a paragraph, not a hook. Shown in full rather than cut, because trimming somebody's copy is not this module's call.`,
    );
  }

  const lineSpacing = 10;
  const blockHeight = lines.length * fontSize + (lines.length - 1) * lineSpacing;

  const body = lines.map(escapeDrawtext).join("\n");
  const enable = `:enable='between(t,${plan.start.toFixed(2)},${plan.end.toFixed(2)})'`;
  const x = t.align === "left" ? "w*0.08" : "(w-text_w)/2";
  const y = yExpressionFor(plan.region);
  const font = opts.fontFile ? `fontfile='${opts.fontFile}':` : "";

  const filters: string[] = [];

  // The brand hairline above the type — same geometry and the same 0.95 alpha
  // as `lowerThirdFilters`, so the accent reads as one system across the cut.
  if (t.rule) {
    const rw = Math.round(frameW * 0.15);
    const rh = Math.max(4, Math.round(frameH * 0.005));
    const rx = t.align === "left" ? Math.round(frameW * 0.08) : Math.round((frameW - rw) / 2);
    const ry = boxYExpressionFor(plan.region, blockHeight);
    filters.push(
      `drawbox=x=${rx}:y=${ry}-${Math.round(frameH * 0.016)}:w=${rw}:h=${rh}:color=${t.accent}@0.95:t=fill${enable}`,
    );
  }

  // Plate (the worker's `box=1` values) or drop shadow (the lower thirds').
  // Never both — a shadow under a plate is just a soft edge nobody sees.
  const contrast = t.plate
    ? ":box=1:boxcolor=black@0.55:boxborderw=24"
    : ":shadowcolor=black@0.6:shadowx=2:shadowy=2";

  filters.push(
    `drawtext=${font}text='${body}'` +
      `:fontcolor=white:fontsize=${fontSize}:line_spacing=${lineSpacing}${contrast}` +
      `:x=${x}:y=${y}${enable}`,
  );

  return { filters, lines, fontSize, maxChars, blockHeight, notes };
}

/**
 * One line for the UI: what the hook overlay is doing, or why there isn't one.
 * Reports the honest gap rather than hiding it behind an empty state.
 */
export function hookOverlaySummary(plan: HookOverlayPlan | null | undefined): string {
  if (!plan) return "No hook overlay planned.";
  if (!plan.rendered) return plan.reason || "No hook overlay.";
  const parts = [
    `${plan.start.toFixed(1)}–${plan.end.toFixed(1)}s`,
    plan.region,
    `${plan.treatment.brandLabel || "unstyled"} / ${plan.treatment.pillar}`,
  ];
  if (!plan.landsInWindow) parts.push(`misses the ${plan.window.label}`);
  if (plan.notes.length) parts.push(`${plan.notes.length} note${plan.notes.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
