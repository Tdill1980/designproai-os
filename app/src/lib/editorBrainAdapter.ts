/**
 * editorBrainAdapter — the translation layer between the editor-brain EDGE
 * FUNCTION and the EditorBrainPanel.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `supabase/functions/editor-brain/index.ts` and
 * `src/components/admin/EditorBrainPanel.tsx` were built in parallel from the
 * same briefs and their schemas diverged. Neither is wrong. They simply never
 * agreed on names:
 *
 *   FUNCTION EMITS                         PANEL CONSUMES
 *   verdict "cut"|"mismatch"|"refused"  →  status "ok"|"mismatch"|"failed"
 *   decision.reasoning.why              →  decision.because
 *   decision.reasoning.doingForViewer   →  (no field)
 *   decision.reasoning.evidence + Kind  →  decision.quote / decision.frame
 *   decision.order                      →  decision.finalIndex
 *   decision.beatIndex                  →  decision.sourceIndex
 *   cuts[] (a separate array)           →  decisions[] with action:"cut"
 *   cuts[].reason                       →  decision.removalKind
 *   override.aiProposed/.enforced/.why  →  override.proposed/.enforced/.because
 *   refusals[] = {what, why}            →  refusals[] = meaning-guard refusals
 *
 * The fix is a PURE function. No network, no clock, no randomness: the same
 * response always adapts to the same payload, so a report a human argued with
 * yesterday reads identically today.
 *
 * ── THE TWO MEANINGS OF `refusals` ──────────────────────────────────────────
 * This is the one place the two schemas do not merely differ in NAME — they
 * differ in MEANING, and collapsing them would destroy information.
 *
 *   THE PANEL'S refusals  = the MEANING GUARD. "Removing 'not' would have
 *     inverted what was said." This is the guard between an edit and a
 *     customer being misquoted, and it is the most important thing the panel
 *     renders.
 *   THE FUNCTION'S refusals = REFUSED REFERENCES. "That hook line is not in
 *     the beat's words", "that beat was never supplied". Grounding failures,
 *     not meaning failures.
 *
 * They are routed to two different places and never merged:
 *
 *   · The MEANING guard lives in the function as `cuts[].meaningPreserved`
 *     — the model's own claim that a removal does not change what was said,
 *     surfaced (per the function's own header) so a human can check it.
 *     `meaningPreserved === false` IS "a proposed removal that would have
 *     changed the meaning", which is exactly the panel's refusal section.
 *     → panel `refusals[]`.
 *   · The REFERENCE refusals go to the panel's `overrides[]` — "the AI
 *     proposed, the code enforced" — which is structurally what they are, and
 *     is a section the panel always renders. In the function they already
 *     travel one-for-one with an `overrides[]` entry, so this keeps the pair
 *     together instead of orphaning the human-readable half.
 *
 * Losing either is worse than the mismatch, so neither is dropped and neither
 * is folded into the other.
 *
 * ── THE TWO RULES ───────────────────────────────────────────────────────────
 * 1. NEVER INVENT A FIELD. If the function did not say it, this file does not
 *    supply it. The panel is built to render missing data honestly ("Channel
 *    not recorded", "duration not recorded"), so absence must SURVIVE
 *    translation. A plausible default here is how a panel starts confidently
 *    displaying numbers nobody computed.
 *
 *    Three values are written by this file rather than copied, and all three
 *    are a restatement of a field's own recorded meaning, never a guess about
 *    data: `action: "kept"` / `"cut"` (which ARRAY the item came from is the
 *    statement), `REFERENCE_REFUSAL_ENFORCED` (the array is named `refusals`),
 *    and `DROPPED_VALUE` (a rendering of a literal recorded `null`).
 *
 * 2. NEVER LOSE A FIELD. Anything with no panel home is carried somewhere
 *    still visible rather than dropped, and everything that has no home at all
 *    is listed in `unmapped` so it is at least countable. An override or a
 *    refusal silently lost is the exact failure the panel exists to prevent.
 *
 * ── THE INVARIANT ───────────────────────────────────────────────────────────
 * The function guarantees `decisions.length + cuts.length === beats.length` —
 * every beat has a fate and a reason. Translation must not eat one: every
 * function decision and every function cut becomes exactly ONE panel decision.
 * `adaptEditorBrain().accounting` reports that arithmetic (and compares it to
 * `context.beatCount` when the caller knows it), so a regression here is a
 * failing assertion rather than a beat that quietly vanishes off the strip.
 */

import type {
  EditorBrainDecision,
  EditorBrainOverride,
  EditorBrainProgress,
  EditorBrainRefusal,
  EditorBrainReport,
} from "@/components/admin/EditorBrainPanel";

// ═══════════════════════════════════════════════════════════════════════════
// WHAT THE FUNCTION EMITS
//
// Structural, not nominal, and every field optional — this file must never
// import from `supabase/functions/` (Deno) and must survive a response shape
// that drifts again. Mirrors editor-brain/index.ts as of 2026-08-06.
// ═══════════════════════════════════════════════════════════════════════════

export interface BrainReasoning {
  why?: string | null;
  doingForViewer?: string | null;
  evidence?: string | null;
  /** "quote" | "visual" | "timecode" — the panel only has quote and frame. */
  evidenceKind?: string | null;
  confidence?: number | null;
}

export interface BrainCraft {
  speechLocked?: boolean | null;
  trimAllowed?: boolean | null;
  speedRampAllowed?: boolean | null;
  fadeAllowed?: boolean | null;
}

export interface BrainOverride {
  scope?: string | null;
  beatId?: string | null;
  field?: string | null;
  aiProposed?: unknown;
  enforced?: unknown;
  lock?: string | null;
  why?: string | null;
}

/** A beat that is IN the cut. */
export interface BrainDecision {
  order?: number | null;
  beatId?: string | null;
  beatIndex?: number | null;
  sourceId?: string | null;
  clipUrl?: string | null;
  sourceStart?: number | null;
  sourceEnd?: number | null;
  role?: string | null;
  hasSpeech?: boolean | null;
  reasoning?: BrainReasoning | null;
  craft?: BrainCraft | null;
  overrides?: BrainOverride[] | null;
}

/** A beat left on the floor. */
export interface BrainCut {
  beatId?: string | null;
  beatIndex?: number | null;
  reason?: string | null;
  why?: string | null;
  evidence?: string | null;
  /** FALSE = removing it would change what the speaker meant. The meaning guard. */
  meaningPreserved?: boolean | null;
}

/** The function's refusal: a refused REFERENCE, not a meaning-guard refusal. */
export interface BrainReferenceRefusal {
  what?: string | null;
  why?: string | null;
}

export interface BrainAngleSupport {
  requestedAngle?: string | null;
  supported?: boolean | null;
  coverage?: number | null;
  missing?: string[] | null;
  recommendations?: string[] | null;
  source?: string | null;
}

export interface EditorBrainFunctionResponse {
  ok?: boolean | null;
  producer?: string | null;
  verdict?: string | null;
  model?: string | null;
  temperature?: number | null;
  contentType?: string | null;
  contentTypeBrief?: string | null;
  targetDuration?: number | null;
  title?: string | null;
  story?: {
    headline?: string | null;
    throughline?: string | null;
    opensOn?: string | null;
    landsOn?: string | null;
  } | null;
  assetMatch?: BrainAngleSupport | null;
  angleMismatchStatedByModel?: string | null;
  decisions?: BrainDecision[] | null;
  cuts?: BrainCut[] | null;
  hooks?: Array<{ beatId?: string | null; line?: string | null; why?: string | null; confidence?: number | null }> | null;
  tips?: Array<{ beatId?: string | null; tip?: string | null; why?: string | null; grounding?: number | null }> | null;
  overrides?: BrainOverride[] | null;
  refusals?: BrainReferenceRefusal[] | null;
  handoff?: { module?: string | null; note?: string | null; beats?: unknown[] | null } | null;
  notes?: string[] | null;
  error?: string | null;
  remedy?: string | null;
}

/**
 * Facts the CLIENT knows and the function never returns.
 *
 * The function is handed a channel/brand and does not echo them, and it knows
 * nothing about show formats or render progress. These are real caller data,
 * not defaults — passing them is how the panel's show section works at all.
 *
 * `cutId` is DELIBERATELY not accepted. The panel compares `report.cutId`
 * against the cut on screen to catch an answer about a different cut; stamping
 * both from the same place would turn that check into a guaranteed pass.
 */
export interface EditorBrainContext {
  channel?: string | null;
  brand?: string | null;
  showFormat?: string | null;
  footageHas?: string[] | null;
  editor?: string | null;
  /** Fallback only — the response's own contentType wins. */
  contentType?: string | null;
  progress?: EditorBrainProgress | null;
  /** Measured elsewhere. The function reports a TARGET, which is not a length. */
  sourceDurationSeconds?: number | null;
  finalDurationSeconds?: number | null;
  /** How many beats went IN, when the caller knows. Checks the fate invariant. */
  beatCount?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS THE TESTS LOCK
// ═══════════════════════════════════════════════════════════════════════════

/** The lock name given to a function `refusals[]` entry re-homed as an override. */
export const REFERENCE_REFUSAL_LOCK = "refused_reference";

/**
 * The `enforced` half of a re-homed reference refusal.
 *
 * Written, not copied — but it states only what the field's own name already
 * says (the array is `refusals`), carries no number, no reason and no detail,
 * and the verbatim `why` sits directly beneath it.
 */
export const REFERENCE_REFUSAL_ENFORCED =
  "Refused — this reference was not carried into the cut.";

/** The guard name for a meaning-guard refusal. The function's own craft lock. */
export const MEANING_GUARD = "meaning";

/** Why a `meaningPreserved: false` cut appears in the panel's refusal list. */
export const MEANING_REFUSAL_BECAUSE =
  "The editor recorded this removal as NOT meaning-preserving, so cutting it would have changed what was said. The craft layer is the enforcer; this is the claim it gets to check, and so do you.";

/** A recorded `null` — "the proposal was dropped" — rendered for a human. */
export const DROPPED_VALUE = "(nothing)";

/** The panel actions this adapter emits, and the array each one comes from. */
export const ACTION_FOR_KEPT = "kept";
export const ACTION_FOR_LED_WITH = "led_with";
export const ACTION_FOR_CUT = "cut";

// ═══════════════════════════════════════════════════════════════════════════
// SMALL PURE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** A non-empty trimmed string, or undefined. Never "" — "" renders as a blank. */
function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/** A finite number, or undefined. Numeric strings are accepted defensively. */
function numOf(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Array entries that are usable objects. Anything else is skipped, not crashed on. */
function objects<T>(v: unknown): T[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x !== null && x !== undefined && typeof x === "object" && !Array.isArray(x)) as T[];
}

/** Non-empty strings from an array. */
function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = str(x);
    if (s) out.push(s);
  }
  return out;
}

function safeStringify(v: unknown): string | undefined {
  try {
    const s = JSON.stringify(v);
    return typeof s === "string" && s ? s : undefined;
  } catch {
    return undefined;
  }
}

/** Assign only when there is something to assign — absence must survive. */
function put<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

/**
 * An override value for display.
 *
 * A recorded `null` is not a missing value — it means "the proposal was
 * dropped entirely" — so it becomes `DROPPED_VALUE`, while a key that was
 * never present stays undefined and the panel says so itself.
 */
export function formatOverrideValue(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (v === null) return DROPPED_VALUE;
  if (typeof v === "string") return str(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === "boolean") return String(v);
  return safeStringify(v);
}

// ═══════════════════════════════════════════════════════════════════════════
// VERDICT → STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The panel's four situations have four different next steps, so the mapping
 * keeps them apart:
 *
 *   "cut"      → "ok"        real reasoning follows.
 *   "mismatch" → "mismatch"  it answered about footage that does not carry the
 *                            requested angle. NOT a failure — nothing broke,
 *                            and the next step is new footage or a new angle,
 *                            not a bug fix.
 *   "refused"  → "refused"   a DISTINCT state. The brain deliberately declined
 *                            (no decision survived validation). Its cuts,
 *                            overrides and refusals are all real and must
 *                            still render, which is why it is not folded into
 *                            "failed".
 *   ok:false   → "failed"    the read genuinely broke (no beats, no key, an
 *                            OpenAI error, unparseable JSON) and carries an
 *                            `error`. This is the panel's failure state.
 *
 * An unrecognised verdict passes through unchanged rather than being coerced
 * into one of ours — the panel's status type accepts any string, and a silent
 * coercion would hide a schema drift instead of showing it.
 */
export function panelStatusFor(verdict: unknown, ok: unknown): string | undefined {
  const v = str(verdict)?.toLowerCase();
  if (v === "mismatch") return "mismatch";
  if (ok === false) return "failed";
  if (v === "cut") return "ok";
  if (v === "refused") return "refused";
  return v;
}

// ═══════════════════════════════════════════════════════════════════════════
// DECISIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The evidence, put in the slot that does not overstate it.
 *
 * The panel renders `quote` in italics inside quotation marks — it reads as
 * something a person said. Only `evidenceKind: "quote"` earns that. A visual
 * description, a timecode line, or an evidence kind this build does not know
 * goes to `frame`, which the panel renders as neutral text. Nothing is
 * dressed up as speech on a guess, and nothing is thrown away.
 */
export function evidenceSlots(reasoning?: BrainReasoning | null): { quote?: string; frame?: string } {
  const text = str(reasoning?.evidence);
  if (!text) return {};
  const kind = str(reasoning?.evidenceKind)?.toLowerCase();
  return kind === "quote" ? { quote: text } : { frame: text };
}

/**
 * `because` — the panel's one reasoning paragraph, carrying the function's
 * three reasoning fields plus the craft verdict, because the panel has one
 * slot and the function has four. Each part keeps its own label so a reader
 * can still tell them apart, and every string is verbatim.
 */
export function composeBecause(d: BrainDecision): string | undefined {
  const parts: string[] = [];
  const why = str(d?.reasoning?.why);
  if (why) parts.push(why);
  const doing = str(d?.reasoning?.doingForViewer);
  if (doing) parts.push(`Doing for the viewer: ${doing}`);
  const confidence = numOf(d?.reasoning?.confidence);
  if (confidence !== undefined) parts.push(`confidence ${confidence}`);

  // The craft verdict. Which downstream edits are legal on this beat is the
  // single most consequential fact about it — "speech is sacred" is the lock
  // that made the first live cut usable — and it has no panel field.
  const locked = typeof d?.craft?.speechLocked === "boolean"
    ? d.craft!.speechLocked
    : typeof d?.hasSpeech === "boolean"
      ? d.hasSpeech
      : undefined;
  if (locked === true) {
    parts.push("Speech-locked: it plays at its exact full bounds — no trim, no speed ramp, no fade.");
  } else if (locked === false) {
    parts.push("Visual-only: trimming, speed ramps and fades are permitted here.");
  }

  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * A kept beat → a panel decision.
 *
 * `action` is the one value written rather than copied, and it is a
 * restatement of which array the entry arrived in: `decisions[]` is documented
 * in the function as "the beats that are IN the cut". `led_with` is used only
 * when the function's own `story.opensOn` names this beat — the function
 * saying what it opened on, not this file inferring it from position.
 */
export function adaptKeptDecision(d: BrainDecision, opensOn?: string): EditorBrainDecision {
  const out: EditorBrainDecision = {};
  const beatId = str(d?.beatId);
  put(out, "id", beatId);
  put(out, "action", opensOn && beatId && beatId === opensOn ? ACTION_FOR_LED_WITH : ACTION_FOR_KEPT);
  put(out, "role", str(d?.role));
  put(out, "because", composeBecause(d));
  const ev = evidenceSlots(d?.reasoning);
  put(out, "quote", ev.quote);
  put(out, "frame", ev.frame);
  put(out, "sourceStart", numOf(d?.sourceStart));
  put(out, "sourceEnd", numOf(d?.sourceEnd));
  put(out, "sourceIndex", numOf(d?.beatIndex));
  put(out, "finalIndex", numOf(d?.order));
  return out;
}

/**
 * A cut beat → a panel decision with `action: "cut"`.
 *
 * The panel models a removal as a decision, so the function's separate
 * `cuts[]` array is folded in here — that is how the fate accounting survives
 * (`decisions + cuts === beats`) and how the removal reaches the "Cut" filter
 * and the removal accounting.
 *
 * NO DURATION IS SYNTHESISED. A `CutDecision` carries no bounds, so
 * `removedSeconds`, `sourceStart` and `sourceEnd` stay absent and the panel
 * prints "duration not recorded" rather than a number nobody measured.
 */
export function adaptCutDecision(c: BrainCut): EditorBrainDecision {
  const out: EditorBrainDecision = {};
  put(out, "id", str(c?.beatId));
  put(out, "action", ACTION_FOR_CUT);
  put(out, "removalKind", str(c?.reason));
  put(out, "because", str(c?.why));
  // The cut's evidence has no declared kind, so it takes the neutral slot.
  put(out, "frame", str(c?.evidence));
  put(out, "removed", str(c?.evidence));
  put(out, "sourceIndex", numOf(c?.beatIndex));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERRIDES AND REFUSALS
// ═══════════════════════════════════════════════════════════════════════════

function overrideIdentity(o: BrainOverride): string {
  return [
    str(o?.scope) ?? "",
    str(o?.beatId) ?? "",
    str(o?.field) ?? "",
    str(o?.lock) ?? "",
    str(o?.why) ?? "",
    safeStringify(o?.aiProposed) ?? "",
    safeStringify(o?.enforced) ?? "",
  ].join(" ");
}

/** A craft override, both halves plus the three fields the panel has no slot for. */
export function adaptOverride(o: BrainOverride): EditorBrainOverride {
  const out: EditorBrainOverride = {};
  const beatId = str(o?.beatId);
  put(out, "lock", str(o?.lock));
  put(out, "proposed", formatOverrideValue(o?.aiProposed));
  put(out, "enforced", formatOverrideValue(o?.enforced));
  put(out, "because", str(o?.why));
  put(out, "decisionId", beatId);
  // scope and field have no panel field of their own; the label is where they
  // stay legible instead of being dropped.
  const label = [beatId, str(o?.scope), str(o?.field)].filter(Boolean).join(" · ");
  put(out, "label", label || undefined);
  return out;
}

/**
 * A REFERENCE refusal re-homed as an override — see the header.
 *
 * `what` is what the AI proposed; `why` is verbatim; the enforced half states
 * only what the array's own name already says.
 */
export function adaptReferenceRefusal(r: BrainReferenceRefusal): EditorBrainOverride {
  const out: EditorBrainOverride = {};
  out.lock = REFERENCE_REFUSAL_LOCK;
  put(out, "proposed", str(r?.what));
  out.enforced = REFERENCE_REFUSAL_ENFORCED;
  put(out, "because", str(r?.why));
  return out;
}

/**
 * A MEANING-GUARD refusal, derived from a cut the editor itself marked as not
 * meaning-preserving. This is the panel's refusal section, and the reason it
 * is the most important thing on the screen.
 */
export function adaptMeaningRefusal(c: BrainCut): EditorBrainRefusal {
  const out: EditorBrainRefusal = {};
  const beatId = str(c?.beatId);
  put(out, "id", beatId);
  put(out, "label", beatId);
  out.guard = MEANING_GUARD;
  put(out, "proposed", str(c?.evidence));
  const why = str(c?.why);
  out.because = why
    ? `${MEANING_REFUSAL_BECAUSE} Its stated reason for the cut was: ${why}`
    : MEANING_REFUSAL_BECAUSE;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE ADAPTATION
// ═══════════════════════════════════════════════════════════════════════════

/** Something the function said that the panel has no field for. */
export interface UnmappedField {
  /** The response field. */
  field: string;
  /** Its content, as text. */
  text: string;
  /** Why it has no home. */
  why: string;
}

/** The fate arithmetic, carried through translation so it can be asserted. */
export interface BeatAccounting {
  /** Beats IN the cut, as the function reported them. */
  kept: number;
  /** Beats left on the floor, as the function reported them. */
  cut: number;
  /** Decisions the panel receives. MUST equal kept + cut. */
  panelDecisions: number;
  /** Beats the caller sent in, when it told us. */
  beatCount: number | null;
  /** TRUE when nothing was eaten in translation (and, if known, no beat lost). */
  holds: boolean;
  /** Beat ids that landed twice. Empty in a healthy response. */
  duplicateBeatIds: string[];
  /** One sentence naming the arithmetic and whether it adds up. */
  note: string;
}

export interface EditorBrainAdaptation {
  /** The payload to hand `EditorBrainPanel`. */
  report: EditorBrainReport;
  accounting: BeatAccounting;
  /** Everything with no panel field, so nothing is silently gone. */
  unmapped: UnmappedField[];
}

/**
 * FUNCTION RESPONSE → PANEL PAYLOAD.
 *
 * Pure. Total: any input, including `null`, a string, or an object of the
 * wrong shape, produces a report rather than a throw — a panel that crashes on
 * a drifted payload tells a reader nothing, and drift is the whole reason this
 * file exists.
 */
export function adaptEditorBrain(
  raw: unknown,
  context?: EditorBrainContext | null,
): EditorBrainAdaptation {
  const fn: EditorBrainFunctionResponse =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as EditorBrainFunctionResponse)
      : {};
  const ctx = context && typeof context === "object" ? context : {};

  const report: EditorBrainReport = {};
  const unmapped: UnmappedField[] = [];
  const messageParts: string[] = [];

  // ── status ────────────────────────────────────────────────────────────────
  const status = panelStatusFor(fn.verdict, fn.ok);
  put(report, "status", status as EditorBrainReport["status"]);
  const rawVerdict = str(fn.verdict);
  if (rawVerdict && !["cut", "mismatch", "refused"].includes(rawVerdict.toLowerCase())) {
    messageParts.push(
      `The function reported a verdict this build does not model ("${rawVerdict}") — it is shown as-is rather than coerced into one of cut / mismatch / refused.`,
    );
  }

  // ── the facts across the top ──────────────────────────────────────────────
  put(report, "contentType", str(fn.contentType) ?? str(ctx.contentType));
  put(report, "channel", str(ctx.channel));
  put(report, "brand", str(ctx.brand));
  put(report, "showFormat", str(ctx.showFormat));
  put(report, "editor", str(ctx.editor));
  const footageHas = strings(ctx.footageHas);
  if (Array.isArray(ctx.footageHas)) report.footageHas = footageHas;
  if (ctx.progress !== undefined && ctx.progress !== null) report.progress = ctx.progress;
  put(report, "sourceDurationSeconds", numOf(ctx.sourceDurationSeconds));
  put(report, "finalDurationSeconds", numOf(ctx.finalDurationSeconds));
  // NOTE: `cutId`, `removedSeconds` and the durations are NOT derivable from
  // this response and are never synthesised. See the header.

  // ── decisions + cuts → one panel decision list ────────────────────────────
  const keptRaw = objects<BrainDecision>(fn.decisions);
  const cutRaw = objects<BrainCut>(fn.cuts);
  const opensOn = str(fn.story?.opensOn);

  const decisions: EditorBrainDecision[] = [
    ...keptRaw.map((d) => adaptKeptDecision(d, opensOn)),
    ...cutRaw.map((c) => adaptCutDecision(c)),
  ];
  if (Array.isArray(fn.decisions) || Array.isArray(fn.cuts)) {
    report.decisions = decisions;
  }

  // ── overrides: craft overrides + re-homed reference refusals ──────────────
  const seenOverrides = new Set<string>();
  const overrideSources: BrainOverride[] = [];
  for (const o of objects<BrainOverride>(fn.overrides)) {
    const key = overrideIdentity(o);
    if (seenOverrides.has(key)) continue;
    seenOverrides.add(key);
    overrideSources.push(o);
  }
  // Defensive: per-decision overrides are also pushed to the top level by the
  // function today. If that ever stops being true, they must not vanish.
  for (const d of keptRaw) {
    for (const o of objects<BrainOverride>(d?.overrides)) {
      const key = overrideIdentity(o);
      if (seenOverrides.has(key)) continue;
      seenOverrides.add(key);
      overrideSources.push(o);
    }
  }
  const referenceRefusals = objects<BrainReferenceRefusal>(fn.refusals);
  const overrides: EditorBrainOverride[] = [
    ...overrideSources.map(adaptOverride),
    ...referenceRefusals.map(adaptReferenceRefusal),
  ];
  if (Array.isArray(fn.overrides) || Array.isArray(fn.refusals) || overrides.length) {
    report.overrides = overrides;
  }

  // ── refusals: the MEANING GUARD only, never merged with the above ─────────
  const meaningRefusals = cutRaw
    .filter((c) => c?.meaningPreserved === false)
    .map(adaptMeaningRefusal);
  if (Array.isArray(fn.cuts) || meaningRefusals.length) {
    report.refusals = meaningRefusals;
  }

  // ── message and error ─────────────────────────────────────────────────────
  for (const n of strings(fn.notes)) messageParts.push(n);

  const angleStated = str(fn.angleMismatchStatedByModel);
  if (angleStated) messageParts.push(`Angle mismatch stated by the editor: ${angleStated}`);

  const am = fn.assetMatch;
  if (am && typeof am === "object") {
    const requested = str(am.requestedAngle);
    const coverage = numOf(am.coverage);
    const missing = strings(am.missing);
    const recs = strings(am.recommendations);
    const src = str(am.source);
    if (am.supported === false) {
      messageParts.push(
        [
          `The footage does not support the requested angle${requested ? ` "${requested}"` : ""}`,
          coverage !== undefined ? ` (coverage ${coverage}` : "",
          coverage !== undefined && src ? `, verdict from ${src})` : coverage !== undefined ? ")" : "",
          missing.length ? `. Nothing here shows: ${missing.join("; ")}` : "",
          recs.length ? `. ${recs.join(" ")}` : "",
        ].join(""),
      );
    } else if (requested) {
      messageParts.push(
        `Requested angle "${requested}" is supported by the footage${coverage !== undefined ? ` (coverage ${coverage}` : ""}${coverage !== undefined && src ? `, verdict from ${src})` : coverage !== undefined ? ")" : ""}.`,
      );
    }
  }

  const error = str(fn.error);
  const remedy = str(fn.remedy);
  if (error) put(report, "error", remedy ? `${error} — ${remedy}` : error);
  else if (remedy) messageParts.push(remedy);

  // ── what has no panel field at all ────────────────────────────────────────
  const title = str(fn.title);
  if (title) unmapped.push({ field: "title", text: `Working title: "${title}"`, why: "the panel has no title field" });

  if (fn.story && typeof fn.story === "object") {
    const bits = [
      str(fn.story.headline) ? `headline: ${str(fn.story.headline)}` : "",
      str(fn.story.throughline) ? `throughline: ${str(fn.story.throughline)}` : "",
      opensOn ? `opens on beat ${opensOn}` : "",
      str(fn.story.landsOn) ? `lands on beat ${str(fn.story.landsOn)}` : "",
    ].filter(Boolean);
    if (bits.length) {
      unmapped.push({
        field: "story",
        text: `Story — ${bits.join(" · ")}`,
        why: "the panel has no story field (opensOn is used to mark the beat the cut led with)",
      });
    }
  }

  const hooks = objects<{ beatId?: string | null; line?: string | null; why?: string | null }>(fn.hooks);
  if (hooks.length) {
    unmapped.push({
      field: "hooks",
      text: `${hooks.length} viral hook candidate(s): ${hooks
        .map((h) => `"${str(h.line) ?? "(no line)"}"${str(h.beatId) ? ` (beat ${str(h.beatId)})` : ""}`)
        .join(" · ")}`,
      why: "the panel renders per-beat decisions, not hook candidates",
    });
  }

  const tips = objects<{ beatId?: string | null; tip?: string | null }>(fn.tips);
  if (tips.length) {
    unmapped.push({
      field: "tips",
      text: `${tips.length} educational tip(s): ${tips
        .map((t) => `"${str(t.tip) ?? "(no tip)"}"${str(t.beatId) ? ` (beat ${str(t.beatId)})` : ""}`)
        .join(" · ")}`,
      why: "the panel renders per-beat decisions, not tip candidates",
    });
  }

  const targetDuration = numOf(fn.targetDuration);
  if (targetDuration !== undefined) {
    unmapped.push({
      field: "targetDuration",
      text: `Target duration ${targetDuration}s`,
      why: "a TARGET is not a measured length — mapping it to finalDurationSeconds would print a runtime nobody measured, so the panel says \"not recorded\" instead",
    });
  }

  const brief = str(fn.contentTypeBrief);
  if (brief) unmapped.push({ field: "contentTypeBrief", text: brief, why: "the panel shows the content type as a chip, with no room for its brief" });

  const provenance = [
    str(fn.producer) ? `producer ${str(fn.producer)}` : "",
    str(fn.model) ? `model ${str(fn.model)}` : "",
    numOf(fn.temperature) !== undefined ? `temperature ${numOf(fn.temperature)}` : "",
  ].filter(Boolean);
  if (provenance.length) {
    unmapped.push({ field: "producer/model/temperature", text: provenance.join(" · "), why: "the panel has no provenance row" });
  }

  if (fn.handoff && typeof fn.handoff === "object") {
    const beats = Array.isArray(fn.handoff.beats) ? fn.handoff.beats.length : 0;
    unmapped.push({
      field: "handoff",
      text: `Handoff to ${str(fn.handoff.module) ?? "the craft layer"} — ${beats} beat(s)`,
      why: "the handoff is the craft layer's input, not something the panel renders",
    });
  }

  if (keptRaw.some((d) => str(d?.clipUrl) || str(d?.sourceId))) {
    unmapped.push({
      field: "decisions[].clipUrl / sourceId",
      text: `${keptRaw.length} kept decision(s) carry a clip url and source id`,
      why: "the panel identifies a beat by label and timecode, not by file",
    });
  }

  if (cutRaw.length) {
    unmapped.push({
      field: "cuts[] bounds",
      text: `${cutRaw.length} removal(s) carry no start/end`,
      why: "a CutDecision has no bounds, so no removed duration exists to report and none is invented — the panel prints \"duration not recorded\"",
    });
  }

  if (unmapped.length) {
    messageParts.push(
      `Recorded by the editor but with no field on this panel — ${unmapped.map((u) => u.text).join(" · ")}`,
    );
  }

  if (messageParts.length) report.message = messageParts.join(" · ");

  // ── the fate arithmetic ───────────────────────────────────────────────────
  const ids: string[] = [];
  for (const d of decisions) {
    const id = d.id === null || d.id === undefined ? "" : String(d.id);
    if (id) ids.push(id);
  }
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const duplicateBeatIds = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);

  const beatCount = numOf(ctx.beatCount) ?? null;
  const translationHolds = decisions.length === keptRaw.length + cutRaw.length;
  const fateHolds = beatCount === null ? true : keptRaw.length + cutRaw.length === beatCount;
  const holds = translationHolds && fateHolds && duplicateBeatIds.length === 0;

  const accounting: BeatAccounting = {
    kept: keptRaw.length,
    cut: cutRaw.length,
    panelDecisions: decisions.length,
    beatCount,
    holds,
    duplicateBeatIds,
    note: !translationHolds
      ? `${keptRaw.length} kept + ${cutRaw.length} cut became ${decisions.length} panel decisions — translation lost or duplicated a beat, and the panel is now showing a different cut from the one the editor made.`
      : duplicateBeatIds.length
        ? `${decisions.length} decisions, but ${duplicateBeatIds.length} beat id(s) appear twice (${duplicateBeatIds.join(", ")}) — a beat cannot be both kept and cut, so one of those fates is wrong.`
        : beatCount !== null && !fateHolds
          ? `${keptRaw.length} kept + ${cutRaw.length} cut = ${keptRaw.length + cutRaw.length}, but ${beatCount} beat(s) went in. ${Math.abs(beatCount - (keptRaw.length + cutRaw.length))} beat(s) have no recorded fate.`
          : `${keptRaw.length} kept + ${cutRaw.length} cut = ${decisions.length} beats, every one with a fate and a reason${beatCount !== null ? ` — matching the ${beatCount} beat(s) that went in` : ""}.`,
  };

  return { report, accounting, unmapped };
}

/** The panel payload alone, for callers that only need to render. */
export function toPanelReport(
  raw: unknown,
  context?: EditorBrainContext | null,
): EditorBrainReport {
  return adaptEditorBrain(raw, context).report;
}
