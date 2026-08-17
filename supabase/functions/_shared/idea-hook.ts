/**
 * idea-hook — per-brand, per-channel hook framing, Deno side.
 *
 * Owner, 2026-08-07: "Yes must wire so each brand, and social channel gets own
 * hook."
 *
 * ── WHY THIS FILE EXISTS TWICE ─────────────────────────────────────────────
 * A PARITY TWIN of `src/lib/ideaHook.ts`. The browser cannot reach an edge
 * function's modules and Deno cannot import `src/lib/*`, so the rules are
 * restated here and pinned by `tests/idea-hook-parity.test.ts`, which fails the
 * build if the two disagree about a channel's move or a brand's close.
 *
 * The frontend copy was written first and, it turned out, HAD NO CALLERS —
 * `planIdeaPieces` is not invoked anywhere in the app. The real fan-out is
 * `actionIdeaApprove` in `marketing-agent`, which is the code path that made
 * every row in production. So this twin is not the secondary copy; it is the
 * one that runs.
 *
 * ── WHAT IT FIXES ──────────────────────────────────────────────────────────
 * `actionIdeaApprove` assigned `caption: text` to all seven surfaces, differing
 * only by a length clip. Measured over every row it had ever produced:
 *
 *     59 rows · 9 distinct captions · 100% reused across channels · worst 7
 *
 *   wraptvworld · substack  · newsletter → "Your install deserves a soundtrack…"
 *   wraptvworld · linkedin  · post       → "Your install deserves a soundtrack…"
 *   wraptvworld · x         · thread     → "Your install deserves a soundtrack…"
 *   wraptvworld · facebook  · feed       → "Your install deserves a soundtrack…"
 *   wraptvworld · instagram · feed       → "Your install deserves a soundtrack…"
 *
 * ── THE HARD CONSTRAINT ────────────────────────────────────────────────────
 * The action's own comment states it: "The copy carried here is the idea's OWN
 * words… This action never invents a claim." That still holds. Framing here is
 * rearrangement plus claim-free connective text — never a new fact, number or
 * name. A channel's `hookEdge` is therefore CARRIED, not acted on: deterministic
 * code cannot write a braver true sentence, only a braver false one.
 */

/** The hook move each surface wants. Mirrors CHANNELS[*].hookMove. */
export type HookMove = "reveal" | "question" | "lesson" | "answer" | "story" | "claim" | "promise";

export const CHANNEL_MOVE: Record<string, { move: HookMove; edge: number }> = {
  instagram: { move: "reveal", edge: 0.75 },
  facebook: { move: "story", edge: 0.5 },
  x: { move: "question", edge: 0.8 },
  threads: { move: "question", edge: 0.7 },
  linkedin: { move: "lesson", edge: 0.35 },
  substack: { move: "claim", edge: 0.55 },
  youtube: { move: "promise", edge: 0.6 },
  youtube_short: { move: "answer", edge: 0.7 },
  tiktok: { move: "reveal", edge: 0.95 },
};

/** Alias spellings → canonical brand. Mirrors src/lib/brandAliases.ts. */
const BRAND_ALIAS: Record<string, string> = {
  wraptv: "wraptvworld",
  "wraptvworld-documentary": "wraptvworld",
};

function canonicalBrand(v: unknown): string {
  const k = String(v || "").trim().toLowerCase();
  return BRAND_ALIAS[k] || k;
}

function splitClause(text: string): { lead: string; rest: string } {
  const t = text.trim().replace(/\s+/g, " ");
  const m = t.match(/^(.{8,}?)\s*[—–,]\s*(.+)$/);
  if (m) return { lead: m[1].trim(), rest: m[2].trim() };
  return { lead: t, rest: "" };
}

const unpunctuated = (s: string) => s.trim().replace(/[.!?]+$/, "").trim();
const upperFirst = (s: string) => (s.trim() ? s.trim().charAt(0).toUpperCase() + s.trim().slice(1) : "");
const endStop = (s: string) => (!s.trim() ? "" : /[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

function firstSentence(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : t).trim();
}

/** Reshape the idea's own words for a hook move. Adds no fact. */
export function frameForMove(text: string, move: HookMove): string {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const { lead, rest } = splitClause(t);

  switch (move) {
    case "reveal":
      return rest ? `${endStop(upperFirst(rest))} ${endStop(upperFirst(lead))}` : t;

    case "question":
      // Left alone on purpose. Re-punctuating a declarative into "…not a
      // slideshow?" is a sentence wearing a question mark it did not earn.
      // The real question is the closer, which asserts nothing.
      return t;

    case "lesson":
      return `The lesson: ${endStop(unpunctuated(firstSentence(t)))}`;

    case "answer":
      // A search surface: the plain, indexable statement. Deliberately NOT
      // inverted, or it duplicates Instagram's reveal on a one-clause idea.
      return endStop(firstSentence(t));

    case "promise": {
      const body = unpunctuated(t);
      const first = body.split(" ")[0] || "";
      const keepCase = /^[A-Z]{2,}/.test(first) || /^[A-Z][a-z]+[A-Z]/.test(first);
      return endStop(keepCase ? `Here's ${body}` : `Here's ${body.charAt(0).toLowerCase()}${body.slice(1)}`);
    }

    case "story":
    case "claim":
    default:
      return t;
  }
}

/**
 * A claim-free close, per channel AND brand.
 *
 * The close asserts nothing about the subject, so it is the one place a brand's
 * register can change the actual words with no risk of invention. It matters:
 * weprintwraps sells vinyl to installers, restylepro sells to owners quoting
 * work, wraptvworld is a film crew. One generic question is wrong for all three.
 *
 * An unknown brand gets the neutral line — true for everyone, which a guessed
 * audience would not be.
 */
export function closerFor(channel: string, brandKey?: string | null): string {
  const brand = canonicalBrand(brandKey);

  if (channel === "x") {
    if (brand === "weprintwraps") return "Anyone printing it differently?";
    if (brand === "restylepro") return "How are you quoting this one?";
    if (brand === "wraptvworld") return "What would you have shot?";
    return "What would you do?";
  }
  if (channel === "threads") {
    // Same move as X, different room — so a different opening, or the two
    // surfaces publish the same words to overlapping audiences.
    if (brand === "weprintwraps") return "Where does yours go wrong?";
    if (brand === "restylepro") return "What do you charge for this?";
    if (brand === "wraptvworld") return "Worth filming, or overkill?";
    return "Agree or not?";
  }
  if (channel === "linkedin") {
    if (brand === "weprintwraps") return "Curious what other printers are seeing.";
    if (brand === "restylepro") return "Curious how other shop owners price this.";
    if (brand === "wraptvworld") return "Curious how other crews film theirs.";
    return "Curious how other shops handle this.";
  }
  if (channel === "facebook") return "Tag someone who needs to see it.";
  if (channel === "substack") return "The full breakdown is below.";
  return "";
}

/** The doctrine channel a (platform, post_type) pair maps to. */
export function channelFor(platform: string, postType: string): string {
  const p = String(platform || "").toLowerCase();
  const t = String(postType || "").toLowerCase();
  if (p === "youtube") return t === "short" ? "youtube_short" : "youtube";
  return p;
}

/**
 * The caption for one surface, and the brief that framed it.
 *
 * An unknown channel returns the text UNTOUCHED and no brief. Guessing a
 * register for a surface the doctrine never described would apply Instagram's
 * voice to a newsletter — the same failure this module exists to end.
 */
export function hookForSurface(
  text: string,
  platform: string,
  postType: string,
  brandKey?: string | null,
): { caption: string; brief: Record<string, unknown> | null } {
  const raw = String(text || "").trim();
  const channel = channelFor(platform, postType);
  const rule = CHANNEL_MOVE[channel];
  if (!raw || !rule) return { caption: raw, brief: null };

  const framed = frameForMove(raw, rule.move);
  const closer = closerFor(channel, brandKey);
  return {
    caption: closer ? `${framed}\n\n${closer}` : framed,
    brief: { channel, hook_move: rule.move, hook_edge: rule.edge, brand: canonicalBrand(brandKey) || null },
  };
}
