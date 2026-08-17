/**
 * PROOF TEXT LOCK — the literals, and the ground-truth check on them.
 *
 * Pure logic, in its own module with NO Deno URL imports, so it is unit-tested
 * against the real code rather than a regex over a file vitest cannot load.
 * `proof-sheet.ts` re-exports everything here, so callers are unchanged.
 */

const DOMAIN_RE = /\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|co|us|biz|shop)\b/gi;
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})?[-.\s]?\d{3}[-.\s]\d{4}\b/g;
const YEAR_RE = /\b(?:since|est\.?|established)\s+(?:19|20)\d{2}\b/gi;

export type LockedTextKind = "domain" | "phone" | "year";

/**
 * The locked literals, BY KIND, straight from the customer's own brief.
 *
 * Split out from `buildProofTextLock` so generation and verification read the
 * SAME source. One artifact, two producers is this repo's recurring bug; a
 * verifier with its own copy of these patterns would drift from the lock it
 * checks, and then quietly pass whatever it happened to agree with.
 */
export function proofTextLiterals(
  companyName: string,
  brief: string,
): { all: string[]; byKind: Record<LockedTextKind, string[]> } {
  const all: string[] = [];
  const byKind: Record<LockedTextKind, string[]> = { domain: [], phone: [], year: [] };
  const push = (s: string, kind?: LockedTextKind) => {
    const v = String(s || "").trim();
    if (!v) return;
    if (!all.some((l) => l.toLowerCase() === v.toLowerCase())) all.push(v);
    if (kind && !byKind[kind].some((l) => l.toLowerCase() === v.toLowerCase())) byKind[kind].push(v);
  };
  push(companyName);
  const text = String(brief || "");
  // Domains, phone numbers, and "since YYYY" are the three that get fabricated:
  // they are dense, low-redundancy strings a model cannot infer from context.
  for (const m of text.matchAll(DOMAIN_RE)) push(m[0], "domain");
  for (const m of text.matchAll(PHONE_RE)) push(m[0], "phone");
  for (const m of text.matchAll(YEAR_RE)) push(m[0], "year");
  return { all, byKind };
}

/** Comparable form — the shapes differ, the identity must not. */
export function normalizeLockedText(value: string, kind: LockedTextKind): string {
  const v = String(value || "").trim().toLowerCase();
  if (kind === "domain") return v.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  if (kind === "phone") {
    const digits = v.replace(/\D+/g, "");
    return digits.length > 10 ? digits.slice(-10) : digits;
  }
  return (v.match(/(?:19|20)\d{2}/) || [""])[0];
}

export function buildProofTextLock(companyName: string, brief: string): string {
  const { all } = proofTextLiterals(companyName, brief);
  if (!all.length) return "";
  return `\n\nTEXT LOCK — these exact strings appear in the design. Reproduce each one CHARACTER FOR CHARACTER wherever it appears in the attached render. Do not re-word, re-number, abbreviate, or substitute a different domain, phone number, or year:\n${all.map((l) => `- "${l}"`).join("\n")}\nIf a string in the render is too small to read, use the matching string from this list. Never invent one.`;
}

/**
 * THE GROUND-TRUTH GATE. Given the strings actually READ off the rendered proof,
 * report any that fabricate a locked value.
 *
 * WHY THIS EXISTS. The panel QC judge is told the proof "is the ONLY source of
 * truth for design and text… never correct [it] from an earlier vehicle render".
 * That is correct — the customer approves the proof, not the render — but it
 * means a proof that INVENTED a phone number is then defended by every gate
 * below it: the judge would enforce the invented number and reject a panel
 * carrying the real one. Live on Cascade Stoneworks the hero read `555-0142`,
 * `cascadestoneworks.com`, `FAMILY OWNED SINCE 2009` while the proof read
 * `877-555-0000`, `stanewerks.com`, `2008`. Nothing in the chain could catch it,
 * because nothing ever compared back to what the customer actually asked for.
 *
 * The TEXT LOCK already carries those literals INTO generation. This closes the
 * loop it left open by checking they came back OUT.
 *
 * THE RULE IS FABRICATION, NOT ABSENCE. A design legitimately may not carry the
 * domain at all, so a missing literal is never an error. What is never
 * legitimate is the proof showing a string of a LOCKED KIND that matches none of
 * the locked values — that is an invention, and it is exactly the Cascade shape.
 * Kinds the brief never specified are not judged at all.
 *
 * Reading is a model's job; DECIDING is this function's, in plain code.
 */
export function findFabricatedText(
  literals: { byKind: Record<LockedTextKind, string[]> },
  observedStrings: string[],
): Array<{ kind: LockedTextKind; observed: string; expected: string[] }> {
  const found: Array<{ kind: LockedTextKind; observed: string; expected: string[] }> = [];
  const seen = new Set<string>();
  const scan = (kind: LockedTextKind, re: RegExp) => {
    const expected = literals.byKind[kind] || [];
    // No locked value of this kind means the brief never specified one, so the
    // design is free to carry anything here. Silence, not a guess.
    if (!expected.length) return;
    const allowed = new Set(expected.map((e) => normalizeLockedText(e, kind)).filter(Boolean));
    if (!allowed.size) return;
    for (const raw of observedStrings) {
      for (const m of String(raw || "").matchAll(new RegExp(re.source, re.flags))) {
        const norm = normalizeLockedText(m[0], kind);
        if (!norm || allowed.has(norm)) continue;
        const key = `${kind}:${norm}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ kind, observed: m[0].trim(), expected });
      }
    }
  };
  scan("domain", DOMAIN_RE);
  scan("phone", PHONE_RE);
  scan("year", YEAR_RE);
  return found;
}
