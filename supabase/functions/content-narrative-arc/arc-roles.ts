/**
 * arc-roles (edge) — the arc's shape, restated for Deno.
 *
 * `src/lib/narrativeArc.ts` is the rulebook and the browser imports it. Edge
 * functions are Deno and cannot import from `src/`, so the parts the SERVER
 * needs are mirrored here: the role table (it writes the row titles and briefs
 * the model), the artifact kinds (it writes the rows), the fingerprint (it is
 * the pre-spend guard), and the grounding checks (it must be able to refuse a
 * fabricated beat without asking the browser).
 *
 * The duplication is deliberate and PINNED — `tests/narrative-arc.test.ts`
 * reads both sources and fails the build if the role table, the kinds or the
 * fingerprint algorithm ever disagree. Same discipline as
 * `_shared/content-doctrine.ts`'s AD_PHRASES, and for the same reason: a rule
 * that only holds in the browser is bypassed by every server-side write, which
 * is how a "standard" quietly stops meaning anything.
 *
 * Why the grounding check lives on the SERVER and not only in the UI: this is
 * the moment a model's words become rows. Checking in the browser would leave
 * the write path — retries, another caller, a cron someone adds later —
 * completely ungated.
 */

export type ArcRoleKey = "open" | "stakes" | "work" | "payoff" | "proof";

export interface ArcRole {
  key: ArcRoleKey;
  label: string;
  job: string;
  wants: string[];
  needs: "speech" | "vision" | "either";
  channel: string;
  dayOffset: number;
  missingShot: string;
}

/** MUST STAY BYTE-IDENTICAL to ARC_ROLES in src/lib/narrativeArc.ts. */
export const ARC_ROLES: ArcRole[] = [
  {
    key: "open",
    label: "Open the question",
    job: "Put the audience inside a problem they recognise before naming anything we sell. It ends unresolved — the whole arc exists because this question is left open.",
    wants: ["tension", "statement", "emotion"],
    needs: "either",
    channel: "instagram",
    dayOffset: 0,
    missingShot: "Someone on camera naming the problem in their own words — the frustration, unprompted, in one sentence.",
  },
  {
    key: "stakes",
    label: "Name what it costs",
    job: "Make the question expensive. What the problem costs in hours, re-prints or a lost job — stated by someone who paid it, never estimated by us.",
    wants: ["tension", "detail", "proof", "statement"],
    needs: "speech",
    channel: "x",
    dayOffset: 2,
    missingShot: "A shop owner saying what the problem actually cost them — the hours, the re-print, the job that walked.",
  },
  {
    key: "work",
    label: "Show the work",
    job: "The craft, uncut. This is the beat that earns the right to claim anything later, and it has to be SEEN — the audience is here for the work itself.",
    wants: ["demonstration", "visual", "detail"],
    needs: "vision",
    channel: "youtube_short",
    dayOffset: 4,
    missingShot: "Hands-on footage of the step itself — the squeegee pull, the panel going on, the trim — shot close and steady.",
  },
  {
    key: "payoff",
    label: "Give the payoff",
    job: "The result the question was asking for. The finished thing, revealed — earned by the two beats before it rather than promised in the first.",
    wants: ["transformation", "result", "visual"],
    needs: "vision",
    channel: "instagram",
    dayOffset: 7,
    missingShot: "The finished vehicle revealed — a walk-around or a pull-away of the completed wrap, clean light.",
  },
  {
    key: "proof",
    label: "Let someone else say it",
    job: "Somebody who is not us says it worked. The arc closes in another person's voice, because the same sentence from us is an advert and from them it is evidence.",
    wants: ["proof", "result", "emotion", "statement"],
    needs: "speech",
    channel: "linkedin",
    dayOffset: 10,
    missingShot: "The customer or installer, on camera, saying what changed for them — unscripted, their words.",
  },
];

export const ARC_ROLE_KEYS = ARC_ROLES.map((r) => r.key);
export const MAX_ARC_BEATS = ARC_ROLES.length;

export function arcRole(key: string): ArcRole | undefined {
  return ARC_ROLES.find((r) => r.key === key);
}

// ─── The kinds an arc occupies on the spine ──────────────────────────────────

export const ARC_PLAN_KIND = "arc_plan";
export const ARC_PRODUCER = "narrative-arc";
export const FINGERPRINT_PREFIX = "Fingerprint:";

export function beatKind(index: number): string {
  return `arc_beat_${index + 1}`;
}
export function gapKind(roleKey: string): string {
  return `arc_gap_${roleKey}`;
}

export function fingerprintOf(body: string | null | undefined): string | null {
  const m = String(body || "").match(/Fingerprint:\s*([0-9a-f]{16})/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * The pre-spend key. NO CLOCK — a retry must find the answer already bought.
 * MUST produce the same digest as `arcFingerprint` in src/lib/narrativeArc.ts.
 */
export function arcFingerprint(
  brand: string,
  topic: string,
  momentIds: string[],
  roleKeys: string[] = ARC_ROLE_KEYS,
): string {
  const material = [
    brand.trim().toLowerCase(),
    topic.trim().toLowerCase(),
    [...momentIds].sort().join(","),
    [...roleKeys].join(","),
  ].join("|");

  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let g = 0x811c9dc5;
  for (let i = material.length - 1; i >= 0; i--) {
    g ^= material.charCodeAt(i);
    g = Math.imul(g, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, "0")}${g.toString(16).padStart(8, "0")}`;
}

// ─── Grounding, server side ──────────────────────────────────────────────────

/**
 * Below this share of grounded vocabulary a beat was written AROUND the footage
 * rather than FROM it. Mirrors HOOK_GROUNDING_MIN in src/lib/hookEngine.ts.
 */
export const GROUNDING_MIN = 0.25;

const STOP = new Set(
  ("the a an and or but if then than that this these those of to in on at for with from by as is are was were be been being it its" +
    " we our you your they their he she his her i me my not no so do does did have has had will would can could should about into over" +
    " out up down just very really more most much many one two also there here what when where who how why all any some")
    .split(/\s+/),
);

function terms(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    // Crude suffix strip so "wrapping"/"wrapped"/"wraps" agree. Matching
    // hookEngine's stemming exactly is not required — this is a floor, and a
    // slightly coarser stem only makes the check MORE forgiving, never less.
    .map((w) => w.replace(/(ing|ed|es|s)$/, ""));
}

/**
 * Check a written beat back against the footage corpus the server itself read
 * out of the database.
 *
 * Four checks, mirroring `groundingViolations`: invented NUMBERS, invented
 * QUOTES, vision OVER-READ, and overall GROUNDING. Fails OPEN on empty input
 * (nothing to judge) and CLOSED on a real violation — the caller must not save
 * the beat.
 *
 * The corpus spans BOTH signals: a claim may rest on the transcript OR on the
 * frame description, never on neither.
 */
export function beatViolations(
  written: string,
  corpus: string,
  opts: { signals: "speech" | "vision" | "both"; visual?: string | null },
): string[] {
  const text = String(written || "").trim();
  if (!text || !String(corpus || "").trim()) return [];
  const lower = String(corpus).toLowerCase();
  const out: string[] = [];

  for (const n of [...new Set(text.match(/\d[\d,]*(?:\.\d+)?%?/g) || [])]) {
    const bare = n.replace(/[%,]/g, "");
    if (bare && !lower.includes(bare.toLowerCase())) {
      out.push(`States "${n}" — that figure appears nowhere in this beat's footage.`);
    }
  }

  // DOUBLE QUOTES ONLY — an apostrophe is not a quotation mark.
  //
  // Live-caught on the first real run (2026-08-07, narrative
  // e5026f00 "AI art isn't printable"): treating the straight `'` as a
  // delimiter made the model's own prose "…isn't achieved, leading to reprints
  // and potential losses…" parse as a QUOTE running from the apostrophe in
  // "isn't" to the next one, and the beat was refused for a quotation nobody
  // had written. In English prose a lone apostrophe is a contraction far more
  // often than a quote, so this check would fire on almost any natural
  // sentence — a fabrication guard that cries wolf is one a human turns off.
  // Genuine fabricated testimony is written in double quotes.
  // …and compared on WORDS, not punctuation.
  //
  // Second live catch on the same run: the model quoted the transcript line
  // exactly and added a terminal full stop, so `"…if you're fucked up, print."`
  // did not literally appear in a corpus ending `…print`. It was refused for
  // fabricating a quote it had copied. Fabrication is a matter of which WORDS
  // somebody said; a comma or a closing full stop the writer added is not a
  // lie. Both sides are stripped to bare words before the containment test,
  // which still catches an invented sentence because the words differ.
  const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const corpusBare = bare(corpus);
  for (const q of [...new Set([...text.matchAll(/["“]([^"“”]{6,})["”]/g)].map((m) => m[1]))]) {
    const qb = bare(q);
    if (qb && !corpusBare.includes(qb)) {
      out.push(`Quotes "${q}" — nobody says that in this beat's footage.`);
    }
  }

  if (opts.signals === "vision") {
    const overRead: Array<[RegExp, string]> = [
      [/\b(delighted|thrilled|overjoyed|blown away|in love with|can'?t believe)\b/i, "reads an emotion off a picture"],
      [/\b(saved|cost|spent|paid|worth|cheaper|price|\$)\b/i, "puts money on a picture"],
      [/\b(hours?|days?|weeks?|minutes?|faster|quicker|overnight)\b/i, "puts a duration on a picture"],
      [/\b(customer|client) (said|told|loved|approved)\b/i, "puts words in someone's mouth off a picture"],
      [/\b(first|only|best|fastest|cheapest|never fails?)\b/i, "makes a superlative claim off a picture"],
    ];
    for (const [re, why] of overRead) {
      if (re.test(text)) {
        out.push(
          `${why}. This beat's only evidence is a frame description${opts.visual ? ` ("${String(opts.visual).slice(0, 80)}…")` : ""} — nobody speaks here.`,
        );
      }
    }
  }

  const vocab = new Set(terms(corpus));
  const words = [...new Set(terms(text))];
  if (words.length >= 4) {
    const grounded = words.filter((w) => vocab.has(w)).length / words.length;
    if (grounded < GROUNDING_MIN) {
      out.push(
        `Only ${Math.round(grounded * 100)}% of this beat's words appear anywhere in its footage — it reads as written around the clip rather than from it.`,
      );
    }
  }

  return out;
}
