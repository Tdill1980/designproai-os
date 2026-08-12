/**
 * ideaHook — one idea, a DIFFERENT opening line per brand and per channel.
 *
 * Owner, 2026-08-07: "Yes must wire so each brand, and social channel gets own
 * hook." Earlier, on what those hooks should be: "so tiktok more outrageous …
 * then linked in hook … X is thought provoking ask a questiion start
 * conversation … Intrest based."
 *
 * ── WHAT WAS ACTUALLY HAPPENING ────────────────────────────────────────────
 * `contentDoctrine.ts` has carried a per-channel `hookMove` and `hookEdge` for
 * a while — TikTok at 0.95, LinkedIn at 0.35, X asking a question — and
 * `ideaFanOut.ts` never read any of it. It took ONE string and assigned it to
 * every channel, differing only by `clip(text, 100)` for a length limit.
 *
 * Measured on production, every row that path has ever made:
 *
 *     59 rows · 9 distinct captions · 100% reused across channels · worst 7
 *
 *   wraptvworld · substack  · newsletter → "Your install deserves a soundtrack…"
 *   wraptvworld · linkedin  · post       → "Your install deserves a soundtrack…"
 *   wraptvworld · x         · thread     → "Your install deserves a soundtrack…"
 *   wraptvworld · facebook  · feed       → "Your install deserves a soundtrack…"
 *   wraptvworld · instagram · feed       → "Your install deserves a soundtrack…"
 *
 * The line is fine. A "newsletter" and an "X thread" that are one nine-word
 * sentence are not a newsletter or a thread, and six identical posts across six
 * surfaces is what an audience recognises as a bot.
 *
 * ── THE HARD CONSTRAINT: FRAMING, NEVER A NEW FACT ─────────────────────────
 * `ideaFanOut.ts` states it and it governs this file too: "Every piece carries
 * the idea's OWN words. The per-platform work is framing — length, line breaks,
 * a question or a CTA — never a new claim, a new number, or a company detail
 * the idea did not contain."
 *
 * So a channel's `hookEdge` CANNOT be honoured by making the copy bolder here.
 * Deterministic code cannot invent a braver true sentence; it can only invent a
 * braver false one. What this module does instead:
 *
 *   · it RESHAPES the idea's own sentence per `hookMove` — lead with the
 *     payoff, ask it, state it as the lesson — using only words already present
 *     plus claim-free connective text;
 *   · it appends a channel-appropriate, CLAIM-FREE conversational close (X gets
 *     a question, LinkedIn an invitation to compare notes);
 *   · it carries the channel rule, move, edge and the brand's voice OUT on the
 *     piece as a `hookBrief`, so the model that writes final copy writes to the
 *     brief instead of guessing.
 *
 * That split is the honest one: structure is decidable here, nerve is not.
 * Locked by `tests/idea-hook.test.ts`.
 */

import { CHANNELS, BRANDS, type ChannelKey, type ChannelRule } from "@/lib/contentDoctrine";
import { canonicalBrandOrNull } from "@/lib/brandAliases";

/** The brief the copy writer works from. Auditable beside the line it produced. */
export interface IdeaHookBrief {
  channel: ChannelKey;
  /** The channel's production register, verbatim from the doctrine. */
  hookRule: string;
  hookMove: ChannelRule["hookMove"];
  hookEdge: number;
  hookWindow: string;
  /** The brand's register, verbatim. Empty when the brand is unknown. */
  brandVoice: string;
  /** Who is on the other side. Interest-based starts here, not with us. */
  audience: string;
  /** True when a real publisher exists for this channel in content-deploy. */
  canAutoPublish: boolean;
}

/** Split a line into its lead clause and whatever follows. No words added. */
function splitClause(text: string): { lead: string; rest: string } {
  const t = text.trim().replace(/\s+/g, " ");
  // Prefer an em/en dash or comma split — that is usually setup → payoff.
  const m = t.match(/^(.{8,}?)\s*[—–,]\s*(.+)$/);
  if (m) return { lead: m[1].trim(), rest: m[2].trim() };
  return { lead: t, rest: "" };
}

/** Drop a single trailing sentence mark so we can attach our own. */
function unpunctuated(text: string): string {
  return text.trim().replace(/[.!?]+$/, "").trim();
}

function firstSentence(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : t).trim();
}

/** Sentence case for a clause lifted from mid-sentence. */
function upperFirst(text: string): string {
  const t = text.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** End with exactly one full stop, unless it already ends in ! or ?. */
function endStop(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Reshape the idea's own words for this channel's hook move.
 *
 * Every branch is a rearrangement or a claim-free frame. Nothing here asserts
 * anything the idea did not — read each `return` and check: the only text this
 * function adds is interrogative or connective ("Why", "The lesson:",
 * "Here's the thing"), never a fact, a number or a name.
 */
export function frameForMove(text: string, move: ChannelRule["hookMove"]): string {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const { lead, rest } = splitClause(t);

  switch (move) {
    case "reveal":
      // Payoff first. If the line is setup→payoff, invert it; the words are the
      // idea's either way.
      return rest ? `${endStop(upperFirst(rest))} ${endStop(upperFirst(lead))}` : t;

    case "question":
      // X: "thought provoking, ask a question, start a conversation."
      //
      // The STATEMENT IS LEFT ALONE, deliberately. The obvious implementation
      // — strip the full stop, add a question mark — turns a declarative into
      // nonsense: "Your install deserves a soundtrack, not a slideshow?" is not
      // a thought-provoking question, it is a sentence wearing punctuation it
      // did not earn. Deterministic code cannot write a good question from an
      // arbitrary claim without inventing the premise, and inventing is the one
      // thing this module may not do.
      //
      // The question comes from `closerFor("x")` instead, appended whole. That
      // is a real question, it genuinely opens a conversation, and it asserts
      // nothing.
      return t;

    case "lesson":
      // LinkedIn: the operator's takeaway, stated flat. Lowest edge on any
      // surface (0.35), so no rhetorical lift is added.
      return `The lesson: ${endStop(unpunctuated(firstSentence(t)))}`;

    case "answer":
      // YouTube Short: a SEARCH surface. The caption's job is to be the plain,
      // indexable statement of what the video answers — the hook itself is the
      // first frame, not this text.
      //
      // So it deliberately does NOT invert. An earlier version inverted like
      // `reveal` and produced a caption identical to Instagram's on any
      // single-clause idea, which is the duplication this module exists to end
      // reappearing between two channels instead of six.
      return endStop(firstSentence(t));

    case "promise": {
      // YouTube: what the viewer gets. "Here's" carries no claim about the
      // subject, only about the video.
      const body = unpunctuated(t);
      // Lowercased only when the first word is ordinary — a proper noun or an
      // acronym keeps its capitals ("Here's WrapTV…", not "Here's wrapTV…").
      const first = body.split(" ")[0] || "";
      const keepCase = /^[A-Z]{2,}/.test(first) || /^[A-Z][a-z]+[A-Z]/.test(first);
      return endStop(keepCase ? `Here's ${body}` : `Here's ${body.charAt(0).toLowerCase()}${body.slice(1)}`);
    }

    case "story":
      // Facebook: leave it conversational. The idea already reads as one.
      return t;

    case "claim":
      return t;

    default:
      return t;
  }
}

/**
 * A claim-free closing line, chosen by channel AND brand.
 *
 * The close carries no fact about the subject — the value here is the INVITE —
 * so it is the one place a brand's register can change the actual words without
 * risking invention. It matters: `weprintwraps` sells vinyl to installers
 * ("Trade to trade… assume they know the job"), `restylepro` sells to owners
 * quoting and closing work. "Curious how other shops handle this" is the wrong
 * question for both if it is the only question the system can ask.
 *
 * An unknown brand falls back to the channel's neutral close rather than
 * guessing an audience — the neutral line is true for everyone, which a guessed
 * one would not be.
 */
export function closerFor(channel: ChannelKey, brandKey?: string | null): string {
  const brand = canonicalBrandOrNull(brandKey);

  if (channel === "x") {
    // Same move on every brand — a genuinely open question — but pointed at
    // the argument that brand's audience actually has.
    if (brand === "weprintwraps") return "Anyone printing it differently?";
    if (brand === "restylepro") return "How are you quoting this one?";
    if (brand === "wraptvworld") return "What would you have shot?";
    return "What would you do?";
  }

  if (channel === "linkedin") {
    if (brand === "weprintwraps") return "Curious what other printers are seeing.";
    if (brand === "restylepro") return "Curious how other shop owners price this.";
    if (brand === "wraptvworld") return "Curious how other crews film theirs.";
    return "Curious how other shops handle this.";
  }

  if (channel === "facebook") return "Tag someone who needs to see it.";

  // Instagram and TikTok close on the visual, not on words.
  return "";
}

/** The doctrine channel a fan-out platform actually maps to. */
export function channelForPiece(platform: string, postType: string): ChannelKey | null {
  const p = String(platform || "").toLowerCase();
  const t = String(postType || "").toLowerCase();
  // youtube SHORT is its own channel with its own move ("answer", 0.7). Reading
  // only the platform would hand a Short the longform channel's promise hook.
  if (p === "youtube") return t === "short" ? "youtube_short" : "youtube";
  if (p in CHANNELS) return p as ChannelKey;
  return null;
}

/**
 * The hook + brief for one piece.
 *
 * An UNKNOWN channel returns the text untouched and no brief. Guessing a hook
 * move for a surface the doctrine has never described would silently apply
 * Instagram's register to, say, a newsletter — which is the failure this whole
 * module exists to end, wearing a different hat.
 */
export function hookForPiece(
  text: string,
  platform: string,
  postType: string,
  brandKey?: string | null,
): { caption: string; brief: IdeaHookBrief | null } {
  const raw = String(text || "").trim();
  const channel = channelForPiece(platform, postType);
  if (!raw || !channel) return { caption: raw, brief: null };

  const rule = CHANNELS[channel];
  const brand = BRANDS[canonicalBrandOrNull(brandKey) || ""];

  const framed = frameForMove(raw, rule.hookMove);
  const closer = closerFor(channel, brandKey);
  const caption = closer ? `${framed}\n\n${closer}` : framed;

  return {
    caption,
    brief: {
      channel,
      hookRule: rule.hookRule,
      hookMove: rule.hookMove,
      hookEdge: rule.hookEdge,
      hookWindow: rule.hookWindow,
      brandVoice: brand?.voice || "",
      audience: brand?.audience || "",
      canAutoPublish: rule.canAutoPublish,
    },
  };
}
