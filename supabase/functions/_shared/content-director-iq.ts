/**
 * content-director-iq.ts — ContentDirectorIQ's brand-grounding brain (pure logic).
 *
 * The generation hierarchy this module encodes (owner spec, 2026-07-28):
 *
 *   source video + transcript
 *     → selected brand
 *     → Brand Pillars Library   (public.brand_pillars — authoritative, seeded)
 *     → Brand Hooks Library     (public.content_hooks — the /admin/hooks library)
 *     → audience + campaign objective
 *     → platform format
 *     → script, clips, ads and edit plan
 *
 * "Your footage provides the truth. Your brand pillar library determines what
 *  story matters. Your hooks library determines how that story earns attention.
 *  The platform rules determine how it is packaged."
 *
 * This file is intentionally dependency-free (no Deno/Supabase imports) so the
 * contentdirectoriq-generate edge function AND the Vitest suite
 * (tests/content-director-iq.test.ts) both import the SAME eligibility +
 * isolation + provenance logic. Do not add I/O here.
 */

export type BrandId =
  | "designproai"
  | "weprintwraps"
  | "wraptvworld"
  | "inkandedge";

export const CONTENT_DIRECTOR_BRANDS: BrandId[] = [
  "designproai",
  "weprintwraps",
  "wraptvworld",
  "inkandedge",
];

export type AwarenessLevel =
  | "unaware"
  | "problem_aware"
  | "solution_aware"
  | "product_aware"
  | "most_aware";

export interface BrandContentBrain {
  brand: BrandId | string;
  enabled_content_types: string[];
  prohibited_claims: string[];
  required_terminology: string[];
  audiences: Array<{ id: string; label: string; description?: string }>;
  offers: Array<Record<string, unknown>>;
  proof_points: Array<{ fact: string }>;
  platform_rules: Record<string, unknown>;
  visual_identity: Record<string, unknown>;
  cross_brand_allowed: string[];
}

export interface BrandPillar {
  id: string;
  brand: string;
  slug: string;
  name: string;
  category?: string | null;
  description?: string | null;
  evidence_guidance?: string | null;
  recommended_formats: string[];
  recommended_audiences: string[];
  active: boolean;
}

export interface BrandPillarMatch {
  pillarId: string;
  pillarSlug: string;
  sourceSegmentIds: string[];
  relevanceScore: number;
  evidenceStrength: number;
  recommendedFormats: string[];
  recommendedAudience: string[];
}

/** A content_hooks row with the template extension columns. */
export interface BrandHookTemplate {
  id: string;
  brand: string;
  hook_type?: string | null;
  text: string;
  active: boolean;
  pillar_slugs?: string[] | null;
  supported_platforms?: string[] | null;
  awareness_levels?: string[] | null;
  audience_ids?: string[] | null;
  objectives?: string[] | null;
  required_evidence_types?: string[] | null;
  required_opening_visual?: string | null;
  approved_language?: string[] | null;
  blocked_language?: string[] | null;
}

export interface TranscriptMoment {
  id: string;
  start_time?: number | null;
  end_time?: number | null;
  speaker?: string | null;
  verbatim_quote?: string | null;
  visual_description?: string | null;
  hook_score?: number | null;
  soundbite_score?: number | null;
  broll_score?: number | null;
}

export type ProvenanceStatus =
  | "transcript_verified"
  | "approved_brand_fact"
  | "verified_offer"
  | "demonstrated_output"
  | "unverified";

export interface ScriptLineDraft {
  role: string;
  text: string;
  transcriptSegmentIds: string[];
  startTime?: number | null;
  endTime?: number | null;
  evidenceType?: string | null;
  provenanceStatus: ProvenanceStatus;
  visualDirection?: string | null;
}

// ── Brand isolation ──────────────────────────────────────────────────────────

/**
 * The cross-brand contamination guard. A project may only draw from its own
 * brand's libraries, unless the project brand's brain deliberately enables the
 * relationship for a campaign (brand_content_brains.cross_brand_allowed).
 * Mirrored by the trg_content_concepts_brand_isolation DB trigger.
 */
export function assertBrandLibraryAccess(
  projectBrandId: string,
  libraryBrandId: string,
  crossBrandAllowed: string[] = [],
): void {
  if (projectBrandId === libraryBrandId) return;
  if (crossBrandAllowed.includes(libraryBrandId)) return;
  throw new Error(
    `Brand library mismatch: ${projectBrandId} cannot use ${libraryBrandId} content.`,
  );
}

// ── Pillar matching guardrails ───────────────────────────────────────────────

/** A pillar match counts only when the footage actually supports it. */
export const MIN_PILLAR_RELEVANCE = 0.5;
export const MIN_PILLAR_EVIDENCE = 0.4;

/**
 * Keep only pillar matches that (a) reference a real pillar of THIS brand,
 * (b) cite at least one real transcript moment, and (c) clear the relevance /
 * evidence floors. The AI proposes; this function disposes.
 */
export function sanitizePillarMatches(
  raw: Array<Partial<BrandPillarMatch> & { pillarSlug?: string }>,
  pillars: BrandPillar[],
  momentIds: Set<string>,
): BrandPillarMatch[] {
  const bySlug = new Map(pillars.filter((p) => p.active).map((p) => [p.slug, p]));
  const out: BrandPillarMatch[] = [];
  for (const m of raw ?? []) {
    const pillar = m.pillarSlug ? bySlug.get(m.pillarSlug) : undefined;
    if (!pillar) continue;
    const segs = (m.sourceSegmentIds ?? []).filter((id) => momentIds.has(id));
    if (segs.length === 0) continue;
    const relevance = clamp01(Number(m.relevanceScore));
    const evidence = clamp01(Number(m.evidenceStrength));
    if (relevance < MIN_PILLAR_RELEVANCE || evidence < MIN_PILLAR_EVIDENCE) continue;
    out.push({
      pillarId: pillar.id,
      pillarSlug: pillar.slug,
      sourceSegmentIds: segs,
      relevanceScore: relevance,
      evidenceStrength: evidence,
      recommendedFormats: (m.recommendedFormats ?? pillar.recommended_formats ?? []).slice(0, 6),
      recommendedAudience: (m.recommendedAudience ?? pillar.recommended_audiences ?? []).slice(0, 6),
    });
  }
  return out.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

// ── Hook eligibility ─────────────────────────────────────────────────────────

export interface HookFilter {
  pillarSlug?: string;
  platform?: string;
  audienceId?: string;
  awarenessLevel?: string;
  objective?: string;
  /** "Show only transcript-backed hooks": drop hooks whose required evidence
   *  types cannot be satisfied by the evidence available in this project. */
  availableEvidenceTypes?: string[];
}

/**
 * A hook template is eligible when every populated restriction matches the
 * request. Empty/absent arrays mean "unrestricted" — a plain curated hook from
 * /admin/hooks stays eligible everywhere for its brand.
 */
export function isHookEligible(hook: BrandHookTemplate, f: HookFilter): boolean {
  if (!hook.active) return false;
  const has = (arr?: string[] | null) => Array.isArray(arr) && arr.length > 0;
  if (f.pillarSlug && has(hook.pillar_slugs) && !hook.pillar_slugs!.includes(f.pillarSlug)) return false;
  if (f.platform && has(hook.supported_platforms) && !hook.supported_platforms!.includes(f.platform)) return false;
  if (f.audienceId && has(hook.audience_ids) && !hook.audience_ids!.includes(f.audienceId)) return false;
  if (f.awarenessLevel && has(hook.awareness_levels) && !hook.awareness_levels!.includes(f.awarenessLevel)) return false;
  if (f.objective && has(hook.objectives) && !hook.objectives!.includes(f.objective)) return false;
  if (f.availableEvidenceTypes && has(hook.required_evidence_types)) {
    const avail = new Set(f.availableEvidenceTypes);
    if (!hook.required_evidence_types!.every((t) => avail.has(t))) return false;
  }
  return true;
}

export function filterEligibleHooks(
  hooks: BrandHookTemplate[],
  f: HookFilter,
): BrandHookTemplate[] {
  return hooks.filter((h) => isHookEligible(h, f));
}

// ── Provenance validation ────────────────────────────────────────────────────

/**
 * Resolve a generated line's provenance honestly. A line is only
 * transcript_verified when every cited segment id exists in the project's
 * moments; a brand-fact line must cite a real approved fact. Anything the
 * system cannot verify is flagged unverified — never silently upgraded.
 */
export function resolveProvenance(
  line: {
    evidenceType?: string | null;
    transcriptSegmentIds?: string[];
    factIndex?: number | null;
  },
  momentIds: Set<string>,
  proofPointCount: number,
): ProvenanceStatus {
  const segs = (line.transcriptSegmentIds ?? []).filter((id) => momentIds.has(id));
  const evidence = (line.evidenceType ?? "").toLowerCase();
  if (segs.length > 0 && (evidence === "transcript" || evidence === "")) {
    return "transcript_verified";
  }
  if (evidence === "product_demo" && segs.length > 0) return "demonstrated_output";
  if (evidence === "verified_fact" || evidence === "approved_brand_fact") {
    const idx = line.factIndex;
    if (typeof idx === "number" && idx >= 0 && idx < proofPointCount) {
      return "approved_brand_fact";
    }
    return "unverified";
  }
  if (evidence === "verified_offer" || evidence === "offer") return "verified_offer";
  return "unverified";
}

/**
 * Language guard: prohibited claims and a hook's blocked language must never
 * ship. Returns the offending phrases found in the text (case-insensitive).
 */
export function findBlockedLanguage(
  text: string,
  prohibitedClaims: string[],
  blockedLanguage: string[] = [],
): string[] {
  const t = (text || "").toLowerCase();
  const all = [...(prohibitedClaims ?? []), ...(blockedLanguage ?? [])];
  return all.filter((p) => p && t.includes(p.toLowerCase()));
}

/**
 * Hook template slot check: a filled hook may only ship when no unresolved
 * {{slot}} placeholders remain — the tool must not fabricate proof to complete
 * a hook.
 */
export function hasUnresolvedSlots(text: string): boolean {
  return /\{\{[^}]+\}\}/.test(text || "");
}

// ── Strategy metadata (what the Script Studio displays) ──────────────────────

export interface StrategyMetadata {
  brand: string;
  pillarSlug: string;
  pillarName: string;
  hookTemplateId?: string | null;
  hookFamily?: string | null;
  hookText?: string | null;
  audienceId?: string | null;
  audienceLabel?: string | null;
  awarenessLevel?: string | null;
  platform?: string | null;
  objective?: string | null;
  outputFormat?: string | null;
  editingBrain?: { format: EditingBrainFormat; label: string } | null;
  evidenceCounts: {
    transcriptClips: number;
    productDemonstrations: number;
    verifiedFacts: number;
  };
  directives: string[];
  flags: string[];
}

export function buildEvidenceCounts(lines: ScriptLineDraft[]): StrategyMetadata["evidenceCounts"] {
  return {
    transcriptClips: lines.filter((l) => l.provenanceStatus === "transcript_verified").length,
    productDemonstrations: lines.filter((l) => l.provenanceStatus === "demonstrated_output").length,
    verifiedFacts: lines.filter(
      (l) => l.provenanceStatus === "approved_brand_fact" || l.provenanceStatus === "verified_offer",
    ).length,
  };
}

// ── AI editing brain — selected by content type ──────────────────────────────
// "appropriate editing brain selected": the script writer AND the edit plan
// change register with the output format. The edit-doctrine half comes from
// _shared/editor-os.ts getEditorBrief(); the SCRIPT-craft half lives here so
// long-form scripts written from raw video get real long-form structure, not
// a stretched ad.

export type EditingBrainFormat = "longform" | "short" | "promo";

export interface EditingBrain {
  format: EditingBrainFormat;
  label: string;
  scriptCraft: string;
}

const LONGFORM_SCRIPT_CRAFT = `## LONG-FORM SCRIPT CRAFT (raw footage → best long-form script)
- COLD OPEN: open on the single strongest verbatim moment from the footage
  (highest-stakes quote or most arresting visual) — never an introduction.
- SPINE: one thesis the whole piece proves. Name it to yourself; every chapter
  advances it.
- CHAPTERS: 3-6 chapters, each anchored to real transcript segments; each
  chapter opens a question the next one answers (open loops).
- RETENTION: reset attention every 45-60 seconds — a cut to demonstration
  b-roll, a question, a reveal, or a register change. Mark these as broll/demo
  lines with visual direction.
- VERBATIM FIRST: prefer the speaker's own recorded words (transcript lines)
  over written narration; narration only bridges verified moments.
- PAYOFF: the ending pays off the cold open explicitly, then ONE CTA.`;

const SHORT_SCRIPT_CRAFT = `## SHORT-FORM SCRIPT CRAFT (reel / short)
- The hook lands in the first 2 seconds, on screen and in audio.
- ONE idea only. If a line serves a second idea, cut it.
- Every line is a caption-ready beat; write for sound-off viewing.
- End with a payoff or loop point, then ONE short CTA.`;

const PROMO_SCRIPT_CRAFT = `## AD SCRIPT CRAFT (paid placement)
- Structure: HOOK → agitate the named pain → mechanism → demonstrated proof →
  ONE CTA. No detours.
- The opening visual must show evidence (screen capture, real output, real
  install) within the first 2 seconds.
- Claims discipline is absolute: only transcript-verified moments, approved
  facts, and verified offers. An ad with an unverified claim is a defect.`;

const EDITING_BRAINS: Record<EditingBrainFormat, EditingBrain> = {
  longform: { format: "longform", label: "Long-form documentary brain", scriptCraft: LONGFORM_SCRIPT_CRAFT },
  short: { format: "short", label: "Short-form retention brain", scriptCraft: SHORT_SCRIPT_CRAFT },
  promo: { format: "promo", label: "Direct-response ad brain", scriptCraft: PROMO_SCRIPT_CRAFT },
};

/** Pick the editing brain from the requested output format (objective breaks ties). */
export function selectEditingBrain(
  outputFormat?: string | null,
  objective?: string | null,
): EditingBrain {
  const f = (outputFormat ?? "").toLowerCase();
  if (f.includes("long_form") || f === "editorial_feature" || f === "product_demo") {
    return EDITING_BRAINS.longform;
  }
  if (f.endsWith("_ad") || f === "meta_ad" || objective === "conversion" || objective === "retargeting") {
    return EDITING_BRAINS.promo;
  }
  return EDITING_BRAINS.short;
}

// ── Revision directives (the Script Studio controls) ─────────────────────────

export const REVISION_DIRECTIVES: Record<string, string> = {
  more_problem_aware:
    "Shift the script earlier in the awareness journey: spend more lines naming and agitating the audience's burning problem before any product mention.",
  more_feature_forward:
    "Bring the demonstrated product capabilities forward: name the mechanism earlier and give demonstration lines more weight.",
  more_authoritative:
    "Raise the authority register: declarative sentences, industry-insider specificity, zero hedging. Never hype.",
  remove_generic_ai_language:
    "Remove every generic AI-marketing phrase (unlock, elevate, seamless, game-changing, revolutionize, empower, cutting-edge, supercharge). Replace with concrete, specific language a shop owner uses.",
  add_product_proof:
    "Add at least one line grounded in a demonstrated product moment (product_demo evidence) from the provided segments.",
  add_output_file_proof:
    "Add at least one line showing the actual file output / production pack result, grounded in provided evidence.",
};
