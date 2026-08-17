/**
 * editor-brain — THE EDITORIAL JUDGEMENT LAYER. It decides; it does not render.
 *
 * Owner, 2026-08-06: "The intelligent editor will act as a real editor and edits
 * viral hooks, docu style — edits bad parts out" · "recuts based on social
 * content type" · "finds viral hooks educational tips makes a relevant video" ·
 * "Uses intelligent editor ai" · "show editor brain".
 *
 * ── THE DIVISION OF LABOUR (CLAUDE.md, verbatim) ─────────────────────────────
 *
 *   "The AI selects and orders; CODE enforces craft."
 *
 * That sentence is load-bearing, not stylistic. The first live BrandCast cut
 * trimmed inside speech, speed-ramped dialogue and faded over lines, and was
 * unusable. `enforceSpeechCraft` (brandcastPlanner) and `editorCraft` exist so
 * that cannot happen again, whatever any model says.
 *
 * So this function emits DECISIONS — which beat is the hook, what order tells
 * the story, what each beat is doing for the viewer, what is boring and should
 * go — as structured data. It does NOT emit video, and it does not emit final
 * timings that bypass the craft layer:
 *
 *   editor-brain (AI)          →  selection, order, role, reasoning, cuts
 *   editorCraft / badTakes /   →  contiguity, pacing, flash-frame floors,
 *   enforceSpeechCraft (CODE)     meaning-preserving removals — THE FLOOR
 *
 * Every decision here is OVERRIDABLE by that floor. That is the design, not a
 * limitation. And where this function itself has to overrule the model (a cut
 * that reaches inside a spoken line, a beat that was never supplied, a hook line
 * nobody actually says), the override is RECORDED — `overrides[]` on the
 * decision and on the response — so a reader sees "the AI wanted X, the lock
 * enforced Y, because Z" instead of a silently rewritten number.
 *
 * ── "SHOW EDITOR BRAIN" ──────────────────────────────────────────────────────
 * Reasoning is a first-class field on every decision, never a paragraph bolted
 * to the end: `why` it was chosen, `doingForViewer` what job it does, and
 * `evidence` — the beat's own quote or timecode. Same discipline as
 * `HookableFact.evidence` in `assetIntelligence.ts`: a judgement without
 * evidence cannot be checked by a human, and a human is going to read this to
 * decide whether to trust the cut. Every supplied beat is accounted for —
 * `decisions.length + cuts.length === beats.length` is an invariant, so the
 * panel can show a fate and a reason for every beat, including the ones the
 * model ignored.
 *
 * ── GROUNDING — NON-NEGOTIABLE ───────────────────────────────────────────────
 * The asset supplies the truth (`asset-intelligence`, `hookEngine`).
 *   · No beats in ⇒ nothing out. This function never imagines footage.
 *   · Every proposed cut must name a beat that CAME IN. An unknown beat
 *     reference is REFUSED, not repaired.
 *   · No timecode is ever invented: an emitted `sourceStart`/`sourceEnd` is
 *     always inside the bounds of a supplied beat, and exactly equal to them for
 *     any beat carrying speech.
 *   · A "viral hook" must be the beat's OWN WORDS — the line is checked back
 *     against that beat's verbatim quote and dropped if it is not in there.
 *   · If the requested angle is not in the footage, this returns a MISMATCH
 *     (the behaviour `assetMatch` implements in `hookEngine.ts`) instead of
 *     writing around it — and it does so BEFORE spending on the model.
 *
 * ── MODEL ────────────────────────────────────────────────────────────────────
 * `video-captions` mode `doc_edit` is the existing editorial brain in this
 * system (documentary EDL from parsed moments) and it calls OpenAI gpt-4o chat
 * completions with a function-calling tool. `asset-intelligence` uses the same
 * vendor/model. This follows that precedent exactly rather than introducing a
 * third path. The Gemini lock in CLAUDE.md governs the IMAGE render pipeline,
 * not text reasoning.
 *
 * Temperature 0.3 by default (caller-overridable, clamped 0-1). This is
 * editorial judgement, so 0 is the wrong instrument — but a cut has to be
 * REVIEWABLE, which means two runs over the same footage must produce
 * substantially the same edit so a human can attribute a change to the footage
 * rather than to the dice. The selection space is closed (the model can only
 * choose among supplied beats, and every timecode is clamped back to them), so
 * temperature buys ordering preference and phrasing, never invented content.
 *
 * Registered in supabase/config.toml with verify_jwt = false — otherwise the
 * gateway 401s slightly-stale JWTs before this code runs (the root cause of
 * recurring 401s across 54 functions). The auth check therefore happens HERE.
 */

import { corsHeaders } from "../_shared/cors.ts";

export const PRODUCER = "editor-brain.v1";
export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_MODEL = "gpt-4o";
export const DEFAULT_TEMPERATURE = 0.3;

/** More beats than a prompt can carry usefully. Excess is REPORTED, not hidden. */
export const MAX_BEATS = 120;

/** Bounds equality tolerance, seconds. Below this a "change" is float noise. */
const EPS = 0.05;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES — the response schema. A UI panel renders this; keep it stable.
// ─────────────────────────────────────────────────────────────────────────────

/** The craft layer's vocabulary (`EditorialRole` in src/lib/editorCraft.ts). */
export const EDITORIAL_ROLES = [
  "hook",
  "setup",
  "escalation",
  "turn",
  "proof",
  "payoff",
  "b_roll",
  "unclassified",
] as const;
export type EditorialRole = (typeof EDITORIAL_ROLES)[number];

/** Why a beat was left on the floor. "edits bad parts out", enumerated. */
export const CUT_REASONS = [
  "repeat_take",
  "flub",
  "dead_air",
  "off_topic",
  "redundant",
  "weak",
  "budget",
  "unexplained",
  "not_reviewed",
] as const;
export type CutReason = (typeof CUT_REASONS)[number];

export interface InputBeat {
  id: string;
  index: number;
  sourceId: string;
  clipUrl: string;
  start: number;
  end: number;
  quote: string;
  visual: string;
  speaker: string;
  hookScore: number;
}

export type OverrideLock =
  | "speech-bounds"
  | "beat-bounds"
  | "no-speed-ramp"
  | "no-fade-over-speech"
  | "unknown-beat"
  | "duplicate-beat"
  | "role-vocabulary"
  | "cut-contradiction"
  | "not-in-footage"
  | "missing-evidence"
  | "beat-not-reviewed";

/** "The AI wanted X, craft enforced Y, because Z." Never a silent replacement. */
export interface EditOverride {
  scope: "decision" | "cut" | "hook" | "tip" | "response";
  beatId?: string;
  field: string;
  aiProposed: unknown;
  enforced: unknown;
  lock: OverrideLock;
  why: string;
}

export interface DecisionReasoning {
  /** Why this beat is in the cut at all. */
  why: string;
  /** What job it does for the VIEWER at this position. */
  doingForViewer: string;
  /** From the footage: the beat's own quote, or its timecode/visual. */
  evidence: string;
  evidenceKind: "quote" | "visual" | "timecode";
  confidence: number;
}

export interface EditDecision {
  order: number;
  beatId: string;
  beatIndex: number;
  sourceId: string;
  clipUrl: string;
  /** ALWAYS inside the supplied beat. Exactly its bounds when it carries speech. */
  sourceStart: number;
  sourceEnd: number;
  role: EditorialRole;
  hasSpeech: boolean;
  reasoning: DecisionReasoning;
  /** What the craft layer will and will not permit on this beat. */
  craft: {
    speechLocked: boolean;
    trimAllowed: boolean;
    speedRampAllowed: boolean;
    fadeAllowed: boolean;
  };
  overrides: EditOverride[];
}

export interface CutDecision {
  beatId: string;
  beatIndex: number;
  reason: CutReason;
  why: string;
  evidence: string;
  /**
   * The model's own assertion that removing this beat does not change what the
   * speaker meant. `badTakes` is the ENFORCER of that rule downstream; this is
   * the claim it gets to check, surfaced so a human can check it too.
   */
  meaningPreserved: boolean;
}

export interface HookCandidate {
  beatId: string;
  beatIndex: number;
  /** VERBATIM from that beat's quote. Verified by substring, not trusted. */
  line: string;
  why: string;
  evidence: string;
  confidence: number;
}

export interface TipCandidate {
  beatId: string;
  beatIndex: number;
  tip: string;
  why: string;
  evidence: string;
  /** 0-1: how much of the tip's vocabulary the beat actually contains. */
  grounding: number;
  confidence: number;
}

export interface AngleSupport {
  requestedAngle: string;
  supported: boolean;
  /** 0-1 coverage of the angle's own content words by the footage. */
  coverage: number;
  /** The angle's words nothing in the footage shows. */
  missing: string[];
  recommendations: string[];
  /** Authority for this verdict: the caller's hookEngine result, or this gate. */
  source: "caller" | "local";
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT TYPE — "recuts based on social content type"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The same footage is a different film per surface. This is CODE, deterministic,
 * fed into the prompt — the model applies judgement inside it rather than
 * inventing what a "tutorial" is each time. `defaultDuration` is only used when
 * the caller does not state one.
 */
export const CONTENT_TYPE_BRIEF: Record<
  string,
  { label: string; brief: string; defaultDuration: number; leadRole: EditorialRole }
> = {
  reel: {
    label: "Short-form reel",
    brief:
      "Cold-open on the single most arresting complete line or shot, then the receipt that proves it was not clickbait. No runway, no throat-clearing, no intro. Drop anything that is merely nice.",
    defaultDuration: 30,
    leadRole: "hook",
  },
  tutorial: {
    label: "Tutorial / educational",
    brief:
      "Lead with the outcome the viewer will be able to do, then teach in order: the step, the reason, the mistake to avoid. Every beat must carry information. Keep demonstrations whole — a half-shown step teaches nothing.",
    defaultDuration: 75,
    leadRole: "proof",
  },
  documentary: {
    label: "Documentary / story cut",
    brief:
      "Three-act shape: open on the most gripping COMPLETE line (often from late in the session), build the problem, land the payoff. Tension before resolution. Silence and process shots are allowed to breathe.",
    defaultDuration: 90,
    leadRole: "hook",
  },
  testimonial: {
    label: "Customer testimonial",
    brief:
      "The customer's own words carry the whole piece. Pick the most confident take of each idea, never repeat an idea, and never cut a sentence short. Visuals support the words; they do not compete with them.",
    defaultDuration: 45,
    leadRole: "proof",
  },
  ad: {
    label: "Direct-response ad",
    brief:
      "Problem, proof, offer — in that order and nothing else. One idea. Every beat that does not move toward the ask is cut.",
    defaultDuration: 30,
    leadRole: "hook",
  },
  teaser: {
    label: "Teaser",
    brief:
      "Show enough to create a question and stop. Withhold the payoff deliberately — but never imply a payoff the footage does not contain.",
    defaultDuration: 15,
    leadRole: "hook",
  },
  bts: {
    label: "Behind the scenes",
    brief:
      "Process and craft. Real hands, real steps, real room tone. Loose is fine; fake drama is not.",
    defaultDuration: 60,
    leadRole: "b_roll",
  },
};

const CONTENT_TYPE_ALIASES: Record<string, string> = {
  short: "reel",
  shorts: "reel",
  tiktok: "reel",
  instagram: "reel",
  educational: "tutorial",
  education: "tutorial",
  howto: "tutorial",
  how_to: "tutorial",
  tips: "tutorial",
  doc: "documentary",
  docu: "documentary",
  story: "documentary",
  review: "testimonial",
  customer: "testimonial",
  advert: "ad",
  advertisement: "ad",
  promo: "ad",
  trailer: "teaser",
  behind_the_scenes: "bts",
};

export function resolveContentType(raw: string | null | undefined): string {
  const key = String(raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return "reel";
  if (CONTENT_TYPE_BRIEF[key]) return key;
  const alias = CONTENT_TYPE_ALIASES[key];
  return alias && CONTENT_TYPE_BRIEF[alias] ? alias : "reel";
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKENS — the coarse pre-flight gate ONLY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `hookEngine.assetMatch` (src/lib/assetIntelligence.ts + hookEngine.ts) is the
 * AUTHORITATIVE mismatch verdict in this system, and a caller that has already
 * run it should PASS IT IN (`asset_match`) — this function then honours it and
 * does not second-guess it.
 *
 * The tokeniser below exists only for callers that never touch that client path
 * (an edge function cannot import `src/lib`). It is deliberately coarser and
 * deliberately not a second stemmer with its own opinions: same stopword idea,
 * same "directive verbs are how a card is written, not what a camera can show"
 * rule, and its verdict is reported as `source: "local"` so nobody mistakes it
 * for the real gate.
 */
const STOPWORDS = new Set(
  (
    "a an the and or but not no of to in on at for from with without into onto by as is are was were be been being " +
    "it its this that these those there here they them their we our you your i me my he she his her who whom which " +
    "do does did done can could will would should shall may might must have has had just very really actually also " +
    "still more most all any some one two both each other another over under than then when where while about after " +
    "before up out off down again new now today " +
    "show shows showing showed how why what make makes making made create creates creating created use uses using " +
    "used get gets getting got need needs want wants help helps way ways thing things look looks like see sees " +
    "watch watching go goes going come comes take takes give gives put puts prove proves tool tools video clip"
  ).split(/\s+/),
);

function stem(word: string): string {
  for (const suf of ["ings", "ing", "ers", "er", "ies", "ied", "ed", "es", "s"]) {
    if (word.endsWith(suf) && word.length - suf.length >= 4) return word.slice(0, -suf.length);
  }
  return word;
}

export interface ContentTerm {
  raw: string;
  stem: string;
}

export function contentTerms(text: string | null | undefined): ContentTerm[] {
  const out: ContentTerm[] = [];
  for (const w of String(text || "").toLowerCase().split(/[^a-z0-9']+/)) {
    const bare = w.replace(/'/g, "");
    if (!bare || bare.length < 3 || STOPWORDS.has(bare)) continue;
    out.push({ raw: w, stem: stem(bare) });
  }
  return out;
}

/** Everything the FOOTAGE says — the only vocabulary a claim may be built from. */
export function footageCorpus(
  beats: InputBeat[],
  facts: Array<{ text?: string; evidence?: string }> = [],
  transcript = "",
): string {
  const parts: string[] = [];
  for (const b of beats) parts.push(b.quote, b.visual, b.speaker);
  for (const f of facts) parts.push(String(f?.text || ""), String(f?.evidence || ""));
  parts.push(String(transcript || ""));
  return parts.filter(Boolean).join("\n");
}

/** Matches hookEngine's `ASSET_MATCH_COVERAGE_OK`. Kept numerically in step. */
export const ANGLE_COVERAGE_OK = 0.5;

/**
 * Does the footage support the requested angle?
 *
 * The owner's worked example, unchanged from the Hook Engine: a card that says
 * "show how DesignProAI creates production files" over footage of a render being
 * generated is a MISMATCH — the render is a fine asset, it is just not an asset
 * about production files. Writing around that produces a piece that is wrong in
 * a way no reviewer can see without opening the video.
 */
export function angleSupport(
  angle: string | null | undefined,
  corpus: string,
): Omit<AngleSupport, "source"> {
  const requestedAngle = String(angle || "").trim();
  if (!requestedAngle) {
    // No angle asked for = nothing to contradict. The cut is judged on the
    // footage alone.
    return { requestedAngle: "", supported: true, coverage: 1, missing: [], recommendations: [] };
  }
  const vocab = new Set(contentTerms(corpus).map((t) => t.stem));
  const wantedTerms = contentTerms(requestedAngle);
  const wanted = [...new Set(wantedTerms.map((t) => t.stem))];
  if (!wanted.length) {
    return { requestedAngle, supported: true, coverage: 1, missing: [], recommendations: [] };
  }
  const covered = wanted.filter((s) => vocab.has(s)).length;
  const coverage = covered / wanted.length;
  const supported = coverage >= ANGLE_COVERAGE_OK;

  // Consecutive unmatched words, regrouped into readable phrases — "production
  // files" reads as a missing thing; two loose tokens do not.
  const missing: string[] = [];
  if (!supported) {
    let run: string[] = [];
    for (const t of wantedTerms) {
      if (vocab.has(t.stem)) {
        if (run.length) { missing.push(run.join(" ")); run = []; }
      } else run.push(t.raw);
    }
    if (run.length) missing.push(run.join(" "));
  }

  return {
    requestedAngle,
    supported,
    coverage: Math.round(coverage * 100) / 100,
    missing,
    recommendations: supported
      ? []
      : [
        missing.length
          ? `Source footage that actually shows: ${missing.join("; ")}.`
          : "Source footage that actually shows the requested angle.",
        "Or revise the card angle to what this footage does show.",
        "Do NOT cut this angle from this footage — flag the card instead.",
      ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BEATS IN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise whatever the caller sent into beats that can actually be cut.
 *
 * A beat without real bounds is not footage — it is dropped, and the drop is
 * reported. Ids are assigned here so the model has a stable handle that is not a
 * timecode (a model asked to echo a float will eventually echo a different one).
 */
export function normalizeBeats(raw: unknown): { beats: InputBeat[]; dropped: string[] } {
  const dropped: string[] = [];
  const beats: InputBeat[] = [];
  const list = Array.isArray(raw) ? raw : [];
  list.forEach((r, i) => {
    if (!r || typeof r !== "object") {
      dropped.push(`beat #${i}: not an object`);
      return;
    }
    const o = r as Record<string, unknown>;
    const start = Number(o.start);
    const end = Number(o.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      dropped.push(`beat #${i}: unusable bounds (${o.start} → ${o.end})`);
      return;
    }
    const clipUrl = String(o.clipUrl || o.clip_url || "").trim();
    if (!clipUrl) {
      dropped.push(`beat #${i}: no clipUrl — there is nothing to cut from`);
      return;
    }
    const index = beats.length;
    beats.push({
      id: String(o.id || o.beatId || `b${index}`),
      index,
      sourceId: String(o.sourceId || o.source_id || clipUrl),
      clipUrl,
      start: Math.max(0, start),
      end,
      quote: String(o.quote || o.verbatim_quote || "").trim(),
      visual: String(o.visual || o.visual_description || "").trim(),
      speaker: String(o.speaker || "").trim(),
      hookScore: Number(o.hookScore ?? o.hook_score) || 0,
    });
  });
  return { beats, dropped };
}

const tc = (s: number) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};

/** The beat's own evidence line — a quote if it spoke, otherwise what was seen. */
export function evidenceFor(b: InputBeat): { text: string; kind: DecisionReasoning["evidenceKind"] } {
  if (b.quote) return { text: `spoken ${tc(b.start)}${b.speaker ? ` by ${b.speaker}` : ""}: "${b.quote}"`, kind: "quote" };
  if (b.visual) return { text: `frame at ${tc(b.start)} — ${b.visual}`, kind: "visual" };
  return { text: `${tc(b.start)}–${tc(b.end)} (${(b.end - b.start).toFixed(1)}s, no transcript or description)`, kind: "timecode" };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PROMPT
// ─────────────────────────────────────────────────────────────────────────────

const CRAFT_LOCKS = `
CRAFT LOCKS — these are enforced in CODE after you answer. Breaking one does not
produce a different cut; it produces a recorded override with your name on it.
- SPEECH IS SACRED. A beat carrying a quote is a COMPLETE spoken line. Use it
  WHOLE, at its exact bounds, or leave it out. Never trim inside speech, never
  speed-ramp a spoken line, never fade over dialogue.
- ONE TAKE PER LINE. If several beats say the same thing, keep exactly ONE — the
  cleanest delivery — and CUT the others with reason "repeat_take".
- A REMOVAL MAY NEVER CHANGE MEANING. Cutting the second half of a qualified
  statement ("we can do that, but only on flat panels") inverts it. If a removal
  changes what the speaker meant, keep the beat.
- VISUAL-ONLY beats (no quote) may be trimmed. Drama lives in the visuals.
`.trim();

const GROUNDING_RULES = `
GROUNDING — these outrank every other instruction.
- You may ONLY reference beats from the list you were given, by their id. A beat
  id that is not in that list is refused outright — it does not become footage
  because you named it.
- NEVER invent a timecode. You do not set times; you select beats. Any bounds
  you return are clamped back inside the beat you named.
- A "viral hook" line must be VERBATIM from that beat's own quote — the exact
  words somebody actually said. A hook that is not in the beat's words is
  deleted. Do not write copy; find the line that is already there.
- An educational tip must be supported by what the beat actually shows or says,
  and must carry that quote or frame as its evidence.
- If the footage does not support the requested angle, SAY SO in
  "angle_mismatch" and cut what the footage DOES support. Never write around a
  gap.
- Every beat you were given must appear exactly once, either in "decisions" or
  in "cuts". A beat you have no opinion about is a cut with reason
  "unexplained" — that is an honest answer.
- Returning fewer, stronger beats is a better answer than filling the runtime.
`.trim();

export function buildEditorPrompt(input: {
  beats: InputBeat[];
  contentType: string;
  angle?: string;
  brand?: string;
  channel?: string;
  objective?: string;
  targetDuration: number;
  maxScenes: number;
  transcript?: string;
  facts?: Array<{ text?: string; evidence?: string; kind?: string }>;
  angleVerdict?: Omit<AngleSupport, "source">;
}): { system: string; user: string } {
  const ct = CONTENT_TYPE_BRIEF[input.contentType] || CONTENT_TYPE_BRIEF.reel;

  const system = [
    "You are a working video editor cutting REAL footage for the vehicle-wrap",
    "industry. You SELECT and ORDER beats and you explain every choice. You do",
    "not render, you do not set final timings, and you do not write marketing",
    "copy.",
    "",
    `THIS CUT IS A ${ct.label.toUpperCase()}.`,
    ct.brief,
    "",
    CRAFT_LOCKS,
    "",
    GROUNDING_RULES,
    "",
    "ROLES — the vocabulary the craft layer reads:",
    "  hook (opens cold) · setup (context) · escalation (carries the middle) ·",
    "  turn (the pivot) · proof (evidence, numbers, results) · payoff (lands it) ·",
    "  b_roll (visual breathing room) · unclassified (you genuinely cannot tell).",
    "",
    `Aim for about ${input.targetDuration}s and at most ${input.maxScenes} beats on screen.`,
    "For EVERY beat you keep, state why it is in, what it is doing for the",
    "viewer, and the quote or frame that is your evidence. A human is going to",
    "read this beside the cut and decide whether to trust it.",
  ].join("\n");

  const beatLines = input.beats.map((b) => {
    const bits = [
      `#${b.index} id:${b.id} [${b.start.toFixed(1)}–${b.end.toFixed(1)}s, ${(b.end - b.start).toFixed(1)}s]`,
      `score:${b.hookScore || "-"}`,
      b.quote ? `SPEECH${b.speaker ? ` (${b.speaker})` : ""}: "${b.quote.slice(0, 320)}"` : "",
      b.visual ? `SEEN: ${b.visual.slice(0, 240)}` : "",
      !b.quote && !b.visual ? "(no transcript, no description — timecode only)" : "",
    ].filter(Boolean);
    return bits.join(" · ");
  });

  const factLines = (input.facts || [])
    .filter((f) => f && String(f.text || "").trim() && String(f.evidence || "").trim())
    .slice(0, 20)
    .map((f) => `- [${f.kind || "fact"}] ${f.text} — evidence: ${f.evidence}`);

  const user = [
    `CONTENT TYPE: ${ct.label} (${input.contentType})`,
    input.brand ? `BRAND: ${input.brand}` : "",
    input.channel ? `CHANNEL: ${input.channel}` : "",
    input.angle ? `REQUESTED ANGLE (direction, not evidence — it cannot make something true): ${input.angle}` : "",
    input.objective ? `OBJECTIVE: ${input.objective}` : "",
    input.angleVerdict && !input.angleVerdict.supported
      ? `⚠ PRE-FLIGHT: the footage covers only ${Math.round(input.angleVerdict.coverage * 100)}% of that angle's own terms. Nothing here shows: ${input.angleVerdict.missing.join("; ")}. Report the mismatch and cut what the footage DOES support.`
      : "",
    "",
    factLines.length ? `GROUNDED FACTS ALREADY ESTABLISHED ABOUT THIS FOOTAGE:\n${factLines.join("\n")}\n` : "",
    input.transcript ? `FULL TRANSCRIPT (read it — the story lives here):\n${String(input.transcript).slice(0, 10000)}\n` : "",
    `BEATS — the ONLY footage that exists. Reference them by id:\n${beatLines.join("\n")}`,
    "",
    "Cut it. Account for every beat, and show your reasoning per beat.",
  ].filter((l) => l !== "").join("\n");

  return { system, user };
}

/** The tool schema. Deliberately has NO field for a rendered timeline. */
export const DECISION_TOOL = {
  type: "function",
  function: {
    name: "deliver_edit_decisions",
    description:
      "Return the editorial DECISIONS for this cut — selection, order, roles, reasoning, and what was cut out. Not a rendered timeline.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "working title of the cut" },
        story: {
          type: "object",
          description: "the through-line, grounded in the beats",
          properties: {
            headline: { type: "string" },
            throughline: { type: "string", description: "the one story this order tells" },
            opensOn: { type: "string", description: "beat id the cut opens on" },
            landsOn: { type: "string", description: "beat id the cut lands on" },
          },
        },
        angle_mismatch: {
          type: "string",
          description:
            "If the requested angle is NOT in this footage, say exactly what is missing. Empty when the footage supports it.",
        },
        decisions: {
          type: "array",
          description: "the beats that are IN the cut, in the order they play",
          items: {
            type: "object",
            properties: {
              beat_id: { type: "string", description: "id of a beat from the supplied list" },
              role: { type: "string", enum: [...EDITORIAL_ROLES] },
              why: { type: "string", description: "why this beat is in the cut" },
              doing_for_viewer: { type: "string", description: "the job it does for the viewer at this position" },
              evidence: { type: "string", description: "the quote or frame from THIS beat that supports the choice" },
              confidence: { type: "number", description: "0-1" },
            },
            required: ["beat_id", "role", "why", "doing_for_viewer", "evidence"],
          },
        },
        cuts: {
          type: "array",
          description: "beats deliberately left OUT, and why",
          items: {
            type: "object",
            properties: {
              beat_id: { type: "string" },
              reason: { type: "string", enum: CUT_REASONS.filter((r) => r !== "not_reviewed") },
              why: { type: "string" },
              evidence: { type: "string", description: "what in the beat shows it should go" },
              meaning_preserved: { type: "boolean", description: "false if removing it changes what the speaker meant — then keep it instead" },
            },
            required: ["beat_id", "reason", "why"],
          },
        },
        hooks: {
          type: "array",
          description: "viral hook candidates — VERBATIM lines already spoken in a beat",
          items: {
            type: "object",
            properties: {
              beat_id: { type: "string" },
              line: { type: "string", description: "the exact words from that beat's quote" },
              why: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["beat_id", "line", "why"],
          },
        },
        tips: {
          type: "array",
          description: "educational tips the footage actually teaches",
          items: {
            type: "object",
            properties: {
              beat_id: { type: "string" },
              tip: { type: "string" },
              why: { type: "string" },
              evidence: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["beat_id", "tip", "evidence"],
          },
        },
      },
      required: ["decisions", "cuts"],
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// PARSE — malformed JSON is a normal Tuesday
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull the tool arguments out of a chat-completions response and parse them.
 *
 * Never coerces, never repairs, never substitutes a default cut. A model that
 * returned rubbish produced NO editorial decision, and the honest report of that
 * is an error — a fabricated fallback edit would be indistinguishable from a
 * real one to everybody downstream.
 */
export function parseEditorResponse(
  data: unknown,
): { ok: true; parsed: Record<string, unknown> } | { ok: false; error: string } {
  const d = data as Record<string, any> | null;
  const args = d?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (typeof args !== "string" || !args.trim()) {
    return { ok: false, error: "the model returned no edit decisions (no tool call in the response)" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return { ok: false, error: "the model returned invalid JSON — no cut was produced, and none was invented" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "the model returned JSON that is not an edit-decision object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.decisions)) {
    return { ok: false, error: "the model returned no `decisions` array — nothing was selected" };
  }
  return { ok: true, parsed: obj };
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATE — where an AI decision meets the floor, visibly
// ─────────────────────────────────────────────────────────────────────────────

const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export interface ValidatedEdit {
  decisions: EditDecision[];
  cuts: CutDecision[];
  hooks: HookCandidate[];
  tips: TipCandidate[];
  story: { headline: string; throughline: string; opensOn: string; landsOn: string } | null;
  title: string;
  overrides: EditOverride[];
  refusals: Array<{ what: string; why: string }>;
  angleMismatchStatedByModel: string;
}

/**
 * Turn the model's answer into decisions that CANNOT be wrong in the ways that
 * matter, recording every correction.
 *
 * The rules, all of them enforcement rather than advice:
 *   1. A decision naming a beat that was never supplied is REFUSED. Not
 *      repaired, not nearest-matched — refused, and recorded.
 *   2. The same beat twice is dropped after the first. A repeated beat reads as
 *      two pieces of evidence and is usually the model losing its place.
 *   3. Bounds come from the BEAT, never from the model. Speech beats get exactly
 *      their own bounds (the speech lock); visual beats are clamped inside them.
 *   4. A role outside the craft layer's vocabulary becomes `unclassified`.
 *   5. A cut entry for a beat that is also kept is contradictory — the keep
 *      wins, the cut entry is dropped, both facts recorded.
 *   6. Every supplied beat lands in exactly one of decisions/cuts. Beats the
 *      model never mentioned become `unexplained` cuts, so the panel can show a
 *      fate for all of them.
 *   7. A hook line that is not in its beat's own words is deleted.
 *   8. A tip whose vocabulary the beat does not carry is deleted.
 */
export function validateDecisions(
  parsed: Record<string, unknown>,
  beats: InputBeat[],
  opts: { notReviewed?: InputBeat[] } = {},
): ValidatedEdit {
  const byId = new Map<string, InputBeat>();
  for (const b of beats) byId.set(b.id, b);

  const overrides: EditOverride[] = [];
  const refusals: Array<{ what: string; why: string }> = [];
  const decisions: EditDecision[] = [];
  const used = new Set<string>();

  const resolve = (rawId: unknown, scope: EditOverride["scope"]): InputBeat | null => {
    const id = String(rawId ?? "").trim();
    const hit = byId.get(id);
    if (hit) return hit;
    // A bare "#3"/"3" is a positional reference, not a new beat — accept it only
    // when it lands on a beat that genuinely exists.
    const m = /^#?(\d+)$/.exec(id);
    if (m) {
      const idx = Number(m[1]);
      if (beats[idx]) return beats[idx];
    }
    overrides.push({
      scope,
      field: "beat_id",
      aiProposed: id || null,
      enforced: null,
      lock: "unknown-beat",
      why: `Beat "${id || "(empty)"}" was never supplied to this function. A beat does not become footage because a model named it.`,
    });
    refusals.push({
      what: `${scope} referencing beat "${id || "(empty)"}"`,
      why: "that beat was not in the input — refused rather than repaired",
    });
    return null;
  };

  // ── 1-4. the kept beats ───────────────────────────────────────────────────
  for (const raw of Array.isArray(parsed.decisions) ? parsed.decisions : []) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    const beat = resolve(d.beat_id ?? d.beatId, "decision");
    if (!beat) continue;

    if (used.has(beat.id)) {
      overrides.push({
        scope: "decision",
        beatId: beat.id,
        field: "decisions[]",
        aiProposed: "second appearance of this beat",
        enforced: "dropped",
        lock: "duplicate-beat",
        why: "The same beat cannot play twice — a repeated line reads to the viewer as a stutter and to a reviewer as two pieces of evidence.",
      });
      continue;
    }
    used.add(beat.id);

    const perDecision: EditOverride[] = [];

    // ROLE
    let role = String(d.role || "").trim().toLowerCase() as EditorialRole;
    if (!EDITORIAL_ROLES.includes(role)) {
      perDecision.push({
        scope: "decision",
        beatId: beat.id,
        field: "role",
        aiProposed: d.role ?? null,
        enforced: "unclassified",
        lock: "role-vocabulary",
        why: `"${String(d.role ?? "")}" is not a role the craft layer understands. An invented role would silently move a shot.`,
      });
      role = "unclassified";
    }

    // BOUNDS — the model does not get to set these.
    const hasSpeech = !!beat.quote;
    let sourceStart = beat.start;
    let sourceEnd = beat.end;
    const proposedStart = Number(d.start ?? (d as any).source_start);
    const proposedEnd = Number(d.end ?? (d as any).source_end);
    const proposedAny = Number.isFinite(proposedStart) || Number.isFinite(proposedEnd);

    if (hasSpeech) {
      if (
        proposedAny &&
        (Math.abs((Number.isFinite(proposedStart) ? proposedStart : beat.start) - beat.start) > EPS ||
          Math.abs((Number.isFinite(proposedEnd) ? proposedEnd : beat.end) - beat.end) > EPS)
      ) {
        perDecision.push({
          scope: "decision",
          beatId: beat.id,
          field: "sourceStart/sourceEnd",
          aiProposed: [Number.isFinite(proposedStart) ? proposedStart : beat.start, Number.isFinite(proposedEnd) ? proposedEnd : beat.end],
          enforced: [beat.start, beat.end],
          lock: "speech-bounds",
          why: "This beat carries speech, so it plays at its exact full bounds. Trimming inside a spoken line is the defect that made the first live cut unusable.",
        });
      }
      for (const field of ["speed", "fade_in", "fadeIn"]) {
        if ((d as Record<string, unknown>)[field] !== undefined) {
          perDecision.push({
            scope: "decision",
            beatId: beat.id,
            field,
            aiProposed: (d as Record<string, unknown>)[field],
            enforced: null,
            lock: field === "speed" ? "no-speed-ramp" : "no-fade-over-speech",
            why: "Speech is never speed-ramped and never faded over. Drama lives in the visuals.",
          });
        }
      }
    } else if (proposedAny) {
      const s = Number.isFinite(proposedStart) ? proposedStart : beat.start;
      const e = Number.isFinite(proposedEnd) ? proposedEnd : beat.end;
      const cs = Math.min(Math.max(s, beat.start), beat.end);
      const ce = Math.max(Math.min(e, beat.end), beat.start);
      if (ce - cs > 0.1) {
        sourceStart = cs;
        sourceEnd = ce;
      }
      if (Math.abs(s - sourceStart) > EPS || Math.abs(e - sourceEnd) > EPS) {
        perDecision.push({
          scope: "decision",
          beatId: beat.id,
          field: "sourceStart/sourceEnd",
          aiProposed: [s, e],
          enforced: [sourceStart, sourceEnd],
          lock: "beat-bounds",
          why: "A cut may only use time that exists inside the beat it names. Times outside it are footage nobody shot.",
        });
      }
    }

    const ev = evidenceFor(beat);
    const modelEvidence = String(d.evidence || "").trim();
    if (!modelEvidence) {
      perDecision.push({
        scope: "decision",
        beatId: beat.id,
        field: "reasoning.evidence",
        aiProposed: null,
        enforced: ev.text,
        lock: "missing-evidence",
        why: "No evidence was given, so the beat's own quote/frame is substituted. A judgement nobody can check against the footage is not a judgement.",
      });
    }

    let confidence = Number(d.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.6;
    confidence = Math.min(1, Math.max(0, confidence));

    decisions.push({
      order: decisions.length,
      beatId: beat.id,
      beatIndex: beat.index,
      sourceId: beat.sourceId,
      clipUrl: beat.clipUrl,
      sourceStart: Math.round(sourceStart * 10) / 10,
      sourceEnd: Math.round(sourceEnd * 10) / 10,
      role,
      hasSpeech,
      reasoning: {
        why: String(d.why || "").trim() || "(no reason given)",
        doingForViewer: String(d.doing_for_viewer ?? (d as any).doingForViewer ?? "").trim() || "(not stated)",
        evidence: modelEvidence || ev.text,
        evidenceKind: ev.kind,
        confidence,
      },
      craft: {
        speechLocked: hasSpeech,
        trimAllowed: !hasSpeech,
        speedRampAllowed: !hasSpeech,
        fadeAllowed: !hasSpeech,
      },
      overrides: perDecision,
    });
    overrides.push(...perDecision);
  }

  // ── 5-6. the beats left on the floor ──────────────────────────────────────
  const cuts: CutDecision[] = [];
  const cutIds = new Set<string>();
  for (const raw of Array.isArray(parsed.cuts) ? parsed.cuts : []) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const beat = resolve(c.beat_id ?? c.beatId, "cut");
    if (!beat) continue;
    if (used.has(beat.id)) {
      overrides.push({
        scope: "cut",
        beatId: beat.id,
        field: "cuts[]",
        aiProposed: "cut",
        enforced: "kept",
        lock: "cut-contradiction",
        why: "This beat is also in the cut. A beat cannot be both kept and removed; the keep stands and the removal is dropped.",
      });
      continue;
    }
    if (cutIds.has(beat.id)) continue;
    cutIds.add(beat.id);
    const reason = String(c.reason || "").trim().toLowerCase() as CutReason;
    cuts.push({
      beatId: beat.id,
      beatIndex: beat.index,
      reason: CUT_REASONS.includes(reason) && reason !== "not_reviewed" ? reason : "unexplained",
      why: String(c.why || "").trim() || "(no reason given)",
      evidence: String(c.evidence || "").trim() || evidenceFor(beat).text,
      meaningPreserved: (c.meaning_preserved ?? (c as any).meaningPreserved) === false ? false : true,
    });
  }

  // EVERY beat gets a fate. A beat the model never mentioned is not a beat that
  // vanished — it is one nobody made a decision about, and the panel says so.
  for (const b of beats) {
    if (used.has(b.id) || cutIds.has(b.id)) continue;
    cutIds.add(b.id);
    cuts.push({
      beatId: b.id,
      beatIndex: b.index,
      reason: "unexplained",
      why: "The editor never mentioned this beat. It is out of the cut by omission, not by judgement.",
      evidence: evidenceFor(b).text,
      meaningPreserved: true,
    });
  }
  // Beats that never reached the model at all (prompt cap) are a different,
  // honest category — the model cannot be blamed for a beat it never saw.
  for (const b of opts.notReviewed || []) {
    if (cutIds.has(b.id)) continue;
    cutIds.add(b.id);
    cuts.push({
      beatId: b.id,
      beatIndex: b.index,
      reason: "not_reviewed",
      why: `Beyond the ${MAX_BEATS}-beat prompt cap — never shown to the editor. Re-run on a narrower selection to have it considered.`,
      evidence: evidenceFor(b).text,
      meaningPreserved: true,
    });
  }

  // ── 7. viral hooks must be the footage's own words ────────────────────────
  const hooks: HookCandidate[] = [];
  for (const raw of Array.isArray(parsed.hooks) ? parsed.hooks : []) {
    if (!raw || typeof raw !== "object") continue;
    const h = raw as Record<string, unknown>;
    const beat = resolve(h.beat_id ?? h.beatId, "hook");
    if (!beat) continue;
    const line = String(h.line || "").trim();
    if (!line) continue;
    const spoken = norm(beat.quote);
    const wanted = norm(line);
    if (!spoken || !wanted || !spoken.includes(wanted)) {
      overrides.push({
        scope: "hook",
        beatId: beat.id,
        field: "line",
        aiProposed: line,
        enforced: null,
        lock: "not-in-footage",
        why: beat.quote
          ? `Nobody says "${line}" in that beat. A hook is a line that is already in the footage — writing one is copy, and copy cannot be verified against the video.`
          : "That beat carries no speech at all, so it cannot supply a spoken hook line.",
      });
      refusals.push({ what: `hook "${line}"`, why: "not verbatim in the beat it was attributed to" });
      continue;
    }
    let confidence = Number(h.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.6;
    hooks.push({
      beatId: beat.id,
      beatIndex: beat.index,
      line,
      why: String(h.why || "").trim() || "(no reason given)",
      evidence: evidenceFor(beat).text,
      confidence: Math.min(1, Math.max(0, confidence)),
    });
  }

  // ── 8. tips must be taught by the beat ────────────────────────────────────
  const tips: TipCandidate[] = [];
  for (const raw of Array.isArray(parsed.tips) ? parsed.tips : []) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const beat = resolve(t.beat_id ?? t.beatId, "tip");
    if (!beat) continue;
    const tip = String(t.tip || "").trim();
    const evidence = String(t.evidence || "").trim();
    if (!tip) continue;
    const vocab = new Set(contentTerms(`${beat.quote} ${beat.visual}`).map((x) => x.stem));
    const wanted = [...new Set(contentTerms(tip).map((x) => x.stem))];
    const grounding = wanted.length ? wanted.filter((s) => vocab.has(s)).length / wanted.length : 0;
    if (!evidence || grounding < 0.5) {
      overrides.push({
        scope: "tip",
        beatId: beat.id,
        field: "tip",
        aiProposed: tip,
        enforced: null,
        lock: evidence ? "not-in-footage" : "missing-evidence",
        why: evidence
          ? `Only ${Math.round(grounding * 100)}% of that tip's own words appear in the beat — it is general advice attached to footage, not a tip this footage teaches.`
          : "A tip with no evidence cannot be checked against the beat it claims to come from.",
      });
      refusals.push({ what: `tip "${tip.slice(0, 60)}"`, why: "not grounded in the beat it was attributed to" });
      continue;
    }
    let confidence = Number(t.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.6;
    tips.push({
      beatId: beat.id,
      beatIndex: beat.index,
      tip,
      why: String(t.why || "").trim() || "(no reason given)",
      evidence,
      grounding: Math.round(grounding * 100) / 100,
      confidence: Math.min(1, Math.max(0, confidence)),
    });
  }

  // ── story — beat ids only, and only if they resolve ────────────────────────
  const s = parsed.story && typeof parsed.story === "object" ? parsed.story as Record<string, unknown> : null;
  const idOrEmpty = (v: unknown) => {
    const id = String(v ?? "").trim();
    return byId.has(id) ? id : "";
  };
  const story = s
    ? {
      headline: String(s.headline || "").trim(),
      throughline: String(s.throughline || "").trim(),
      opensOn: idOrEmpty(s.opensOn ?? (s as any).opens_on),
      landsOn: idOrEmpty(s.landsOn ?? (s as any).lands_on),
    }
    : null;

  return {
    decisions,
    cuts,
    hooks,
    tips,
    story,
    title: String(parsed.title || "").trim(),
    overrides,
    refusals,
    angleMismatchStatedByModel: String(parsed.angle_mismatch ?? (parsed as any).angleMismatch ?? "").trim(),
  };
}

/**
 * The craft layer's input, in the AI's chosen order.
 *
 * `editorCraft.planEditedCut` consumes `ParsedMoment[]` and will re-role,
 * re-order and re-pace them — that is the floor doing its job, and a caller that
 * wants to show "the AI wanted this order, craft enforced that one" can diff
 * this list against the scenes that come back.
 */
export function handoffBeats(decisions: EditDecision[]) {
  return decisions.map((d) => ({
    clipUrl: d.clipUrl,
    sourceId: d.sourceId,
    start: d.sourceStart,
    end: d.sourceEnd,
    hookScore: Math.round(d.reasoning.confidence * 10),
    ...(d.hasSpeech ? { quote: d.reasoning.evidenceKind === "quote" ? d.reasoning.evidence : "" } : {}),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * The gateway does not check the caller (verify_jwt = false, deliberately — see
 * the header), so this does: the service role, or a real signed-in user. Plain
 * fetch against GoTrue rather than the supabase-js client, because this function
 * needs no database access and an unused client is a dependency that can break.
 */
async function authorized(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  // FAST PATH — but string equality is NOT a sufficient service-role check.
  // The sibling `asset-intelligence` used only this and rejected the worker on
  // 25 of 25 live calls with `HTTP 401: not authorized`, while the worker was
  // sending a genuine service credential. Two causes, indistinguishable to a
  // `===`: the project has two valid representations of the service credential
  // (legacy `service_role` JWT and the newer secret key) and the runner resolved
  // the other one; or the env var is unset here, in which case every comparison
  // fails silently. This function is called by that same worker with that same
  // header, so it had the same defect and would have 401'd every server-side
  // cut — each one degrading to a labelled stub, which looks like "the footage
  // wasn't good enough" rather than "auth is broken".
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (svcKey && token === svcKey) return true;

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return false;

  // CAPABILITY, NOT IDENTITY. Ask PostgREST whether this token can read a table
  // RLS closes to anon — that IS the privilege, and it survives key rotation.
  // Kept as a plain fetch for the same reason the user check is: this function
  // needs no database client, and an unused dependency is one that can break.
  try {
    const probe = await fetch(`${url}/rest/v1/agent_media_assets?select=id&limit=1`, {
      headers: { Authorization: `Bearer ${token}`, apikey: token },
    });
    if (probe.ok) return true;
  } catch { /* fall through to the user check */ }

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!(await authorized(req))) {
      return json({ ok: false, error: "not authorized" }, 401);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const notes: string[] = [];

    // ── beats in, or nothing out ────────────────────────────────────────────
    const { beats: allBeats, dropped } = normalizeBeats(body.beats);
    if (dropped.length) notes.push(`${dropped.length} supplied beat(s) were unusable: ${dropped.slice(0, 5).join("; ")}`);
    if (!allBeats.length) {
      return json({
        ok: false,
        producer: PRODUCER,
        verdict: "refused",
        error: "no usable beats",
        notes,
        remedy:
          "Pass beats:[{id,sourceId,clipUrl,start,end,quote?,visual?,hookScore?}] from content_moments / the parsed transcript. This function edits real footage; with no beats there is nothing to decide and nothing will be invented.",
      }, 400);
    }
    const beats = allBeats.slice(0, MAX_BEATS);
    const notReviewed = allBeats.slice(MAX_BEATS);
    if (notReviewed.length) {
      notes.push(`${notReviewed.length} beat(s) exceeded the ${MAX_BEATS}-beat prompt cap and were never shown to the editor.`);
    }

    const contentType = resolveContentType(body.content_type ?? body.contentType);
    if (!body.content_type && !body.contentType) {
      notes.push(`No content_type supplied — cut as "${contentType}". Pass one to recut for a different surface.`);
    }
    const ct = CONTENT_TYPE_BRIEF[contentType];
    const targetDuration = Number(body.target_duration ?? body.targetDuration) || ct.defaultDuration;
    const maxScenes = Number(body.max_scenes ?? body.maxScenes) || 14;
    const angle = String(body.angle ?? body.idea ?? "").trim();
    const transcript = String(body.transcript || "");
    const facts = Array.isArray(body.facts) ? body.facts : [];
    const temperature = Math.min(1, Math.max(0, Number(body.temperature ?? DEFAULT_TEMPERATURE) || DEFAULT_TEMPERATURE));

    // ── the mismatch gate, BEFORE any spend ─────────────────────────────────
    // A caller that already ran hookEngine's `assetMatch` (the authoritative
    // implementation) passes it in and this honours that verdict instead of
    // forming a second opinion.
    const callerMatch = body.asset_match ?? body.assetMatch;
    let assetMatch: AngleSupport;
    if (callerMatch && typeof callerMatch === "object") {
      const cm = callerMatch as Record<string, unknown>;
      assetMatch = {
        requestedAngle: angle,
        supported: cm.ok === true || cm.supported === true,
        coverage: Number(cm.coverage ?? (Number(cm.score) || 0) / 100) || 0,
        missing: (Array.isArray(cm.missingProof) ? cm.missingProof : Array.isArray(cm.missing) ? cm.missing : []).map(String),
        recommendations: (Array.isArray(cm.recommendations) ? cm.recommendations : []).map(String),
        source: "caller",
      };
    } else {
      assetMatch = {
        ...angleSupport(angle, footageCorpus(beats, facts, transcript)),
        source: "local",
      };
    }

    if (!assetMatch.supported) {
      // The mismatch IS the answer. No model call, no cut, nothing written
      // around the gap — the same behaviour `assetMatch` implements in
      // hookEngine, and the cheapest possible one.
      return json({
        ok: true,
        producer: PRODUCER,
        verdict: "mismatch",
        contentType,
        assetMatch,
        decisions: [],
        cuts: [],
        hooks: [],
        tips: [],
        story: null,
        overrides: [],
        refusals: [{
          what: `the requested angle "${assetMatch.requestedAngle}"`,
          why: "this footage does not carry it — flagged instead of cut around",
        }],
        notes: [...notes, "Flagged before any model spend: the footage does not support the requested angle."],
        model: null,
        temperature,
      });
    }

    // ── the model ───────────────────────────────────────────────────────────
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return json({
        ok: false, producer: PRODUCER, verdict: "refused",
        error: "OPENAI_API_KEY not configured", notes,
        remedy: "Set OPENAI_API_KEY on the Supabase project — the same key video-captions and asset-intelligence use.",
      }, 500);
    }

    const { system, user } = buildEditorPrompt({
      beats,
      contentType,
      angle,
      brand: String(body.brand || ""),
      channel: String(body.channel || ""),
      objective: String(body.objective || ""),
      targetDuration,
      maxScenes,
      transcript,
      facts,
      angleVerdict: assetMatch,
    });

    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        tools: [DECISION_TOOL],
        tool_choice: { type: "function", function: { name: DECISION_TOOL.function.name } },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[editor-brain] OpenAI error:", errText.slice(0, 400));
      return json({
        ok: false, producer: PRODUCER, verdict: "refused",
        error: `openai ${res.status}`, notes,
        remedy: "No cut was produced. Nothing was substituted — a fallback edit would be indistinguishable from a real one downstream.",
      }, 502);
    }

    const parsedRes = parseEditorResponse(await res.json());
    if (!parsedRes.ok) {
      console.error("[editor-brain] unusable model response:", parsedRes.error);
      return json({
        ok: false, producer: PRODUCER, verdict: "refused",
        error: parsedRes.error, notes,
        remedy: "Re-run. No cut was invented to cover the failure.",
      }, 502);
    }

    const v = validateDecisions(parsedRes.parsed, beats, { notReviewed });

    // Every decision refused leaves nothing behind — and nothing gets made up
    // to fill the hole.
    if (!v.decisions.length) {
      return json({
        ok: true,
        producer: PRODUCER,
        verdict: "refused",
        contentType,
        assetMatch,
        decisions: [],
        cuts: v.cuts,
        hooks: [],
        tips: [],
        story: null,
        overrides: v.overrides,
        refusals: v.refusals.length ? v.refusals : [{ what: "the cut", why: "the editor selected no usable beat" }],
        notes: [...notes, "No decision survived validation — no cut was produced, and none was invented."],
        model: OPENAI_MODEL,
        temperature,
      });
    }

    console.log(
      `[editor-brain] ${contentType}: ${v.decisions.length} kept / ${v.cuts.length} cut · ` +
      `${v.hooks.length} hooks · ${v.tips.length} tips · ${v.overrides.length} craft override(s)`,
    );

    return json({
      ok: true,
      producer: PRODUCER,
      verdict: "cut",
      model: OPENAI_MODEL,
      temperature,
      contentType,
      contentTypeBrief: ct.brief,
      targetDuration,
      title: v.title,
      story: v.story,
      assetMatch,
      angleMismatchStatedByModel: v.angleMismatchStatedByModel,
      decisions: v.decisions,
      cuts: v.cuts,
      hooks: v.hooks,
      tips: v.tips,
      overrides: v.overrides,
      refusals: v.refusals,
      /**
       * The craft layer is the FLOOR, and it runs after this. Anything it
       * changes is a further override on top of the ones recorded here.
       */
      handoff: {
        module: "src/lib/editorCraft.ts → planEditedCut(beats, images, opts)",
        note:
          "These beats are in the EDITOR'S chosen order. editorCraft re-roles, re-orders and re-paces them, and enforceSpeechCraft has the last word on bounds. Diff its scene order against this list to show what craft overruled.",
        beats: handoffBeats(v.decisions),
        roles: Object.fromEntries(v.decisions.map((d) => [d.beatId, d.role])),
      },
      notes,
    });
  } catch (e) {
    console.error("[editor-brain] error:", e);
    return json({ ok: false, producer: PRODUCER, verdict: "refused", error: String((e as Error)?.message || e) }, 500);
  }
}

// Guarded so the pure helpers above can be imported by `tests/editor-brain.test.ts`
// under Vitest (Node), where `Deno` does not exist. In the edge runtime `Deno.serve`
// is always present, so this is a no-op there.
if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(handler);
}
