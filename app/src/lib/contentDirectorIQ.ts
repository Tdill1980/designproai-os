/**
 * contentDirectorIQ.ts — client-side types + helpers for ContentDirectorIQ.
 *
 * The generation hierarchy (owner spec):
 *   source video + transcript → selected brand → Brand Pillars Library →
 *   Brand Hooks Library → audience + campaign objective → platform format →
 *   script, clips, ads and edit plan.
 *
 * The authoritative strategy sources are the EXISTING libraries:
 *   • brand_pillars      (seeded per brand — Pillars Library)
 *   • content_hooks      (the /admin/hooks Hooks Manager — Hooks Library)
 *   • brand_content_brains (per-brand audiences/facts/prohibited claims)
 *   • media_sources + content_moments (footage truth)
 * The heavy lifting runs in the contentdirectoriq-generate edge function;
 * this module is the thin, typed client over it.
 */
import { supabase } from "@/integrations/supabase/client";

export type BrandId = "designproai" | "weprintwraps" | "wraptvworld" | "inkandedge";

export const CDIQ_BRANDS: { slug: BrandId; label: string }[] = [
  { slug: "designproai", label: "DesignProAI" },
  { slug: "weprintwraps", label: "WePrintWraps" },
  { slug: "wraptvworld", label: "WrapTVWorld" },
  { slug: "inkandedge", label: "Ink & Edge" },
];

export const AWARENESS_LEVELS = [
  { id: "unaware", label: "Unaware" },
  { id: "problem_aware", label: "Problem Aware" },
  { id: "solution_aware", label: "Solution Aware" },
  { id: "product_aware", label: "Product Aware" },
  { id: "most_aware", label: "Most Aware" },
] as const;

export const CDIQ_PLATFORMS = [
  { id: "meta", label: "Meta Feed / Reels" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube_shorts", label: "YouTube Shorts" },
  { id: "youtube_long_form", label: "YouTube Long-form" },
] as const;

export const CDIQ_OBJECTIVES = [
  { id: "awareness", label: "Awareness" },
  { id: "consideration", label: "Consideration" },
  { id: "conversion", label: "Conversion" },
  { id: "retargeting", label: "Retargeting" },
  { id: "education", label: "Education" },
] as const;

export const CDIQ_FORMATS = [
  { id: "meta_ad", label: "Meta Video Ad" },
  { id: "instagram_reel", label: "Instagram Reel" },
  { id: "youtube_short", label: "YouTube Short" },
  { id: "youtube_long_form", label: "YouTube Long-form" },
  { id: "product_demo", label: "Product Demo" },
  { id: "retargeting_ad", label: "Retargeting Ad" },
] as const;

export interface BrandPillarMatch {
  pillarId: string;
  pillarSlug: string;
  sourceSegmentIds: string[];
  relevanceScore: number;
  evidenceStrength: number;
  recommendedFormats: string[];
  recommendedAudience: string[];
}

export interface CdiqHook {
  id: string;
  brand: string;
  hook_type?: string | null;
  text: string;
  pillar_slugs?: string[] | null;
  supported_platforms?: string[] | null;
  awareness_levels?: string[] | null;
  required_evidence_types?: string[] | null;
}

export interface CdiqScriptLine {
  role: string;
  text: string;
  transcriptSegmentIds: string[];
  startTime?: number | null;
  endTime?: number | null;
  evidenceType?: string | null;
  provenanceStatus:
    | "transcript_verified"
    | "approved_brand_fact"
    | "verified_offer"
    | "demonstrated_output"
    | "unverified";
  visualDirection?: string | null;
}

export interface CdiqStrategy {
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
  editingBrain?: { format: "longform" | "short" | "promo"; label: string } | null;
  evidenceCounts: { transcriptClips: number; productDemonstrations: number; verifiedFacts: number };
  directives: string[];
  flags: string[];
}

export interface CdiqGenerateResult {
  concept_id: string;
  script_version_id: string;
  version: number;
  strategy: CdiqStrategy;
  package: {
    title: string;
    angle: string;
    hook: string;
    caption: string;
    cta: string;
    lines: CdiqScriptLine[];
    editPlanNotes: string;
    flags: string[];
    editPlan: Record<string, unknown>;
  };
}

/**
 * Cross-brand contamination guard (client mirror of the DB trigger + edge
 * function assert). One brand may reference another only when the
 * relationship is deliberately enabled for that campaign.
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

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("contentdirectoriq-generate", { body });
  if (error) throw new Error(error.message);
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

export const cdiq = {
  analyze: (p: { brand?: BrandId; sourceMediaId?: string; projectId?: string; title?: string; campaignId?: string }) =>
    invoke<{ project_id: string; brand: string; matches: BrandPillarMatch[]; momentCount: number }>({ action: "analyze", ...p }),
  eligibleHooks: (p: { projectId: string; pillarId?: string; platform?: string; audienceId?: string; awarenessLevel?: string; objective?: string; transcriptBackedOnly?: boolean }) =>
    invoke<{ brand: string; hooks: CdiqHook[] }>({ action: "eligible_hooks", ...p }),
  generate: (p: { projectId: string; pillarId: string; hookTemplateId?: string; audienceId?: string; awarenessLevel?: string; platform?: string; objective?: string; outputFormat?: string; directives?: string[] }) =>
    invoke<CdiqGenerateResult>({ action: "generate", ...p }),
  revise: (p: { scriptVersionId: string; directives?: string[]; hookTemplateId?: string; pillarId?: string }) =>
    invoke<CdiqGenerateResult>({ action: "revise", ...p }),
  approve: (p: { scriptVersionId: string; approvedBy: string }) =>
    invoke<{ script_version_id: string; status: string }>({ action: "approve", ...p }),
  reject: (p: { scriptVersionId: string; rejectedBy: string }) =>
    invoke<{ script_version_id: string; status: string }>({ action: "reject", ...p }),
  /** Owner-spec ordering: the AI editor renders a rough cut FIRST (works on a
   *  draft), the human reviews the actual video, then approves. */
  renderRoughCut: (p: { scriptVersionId: string }) =>
    invoke<{ script_version_id: string; render_job_id: string | null; final_url: string | null; thumbnail_url: string | null; status: string }>({ action: "render_rough_cut", ...p }),
  sendToEditor: (p: { scriptVersionId: string }) =>
    invoke<{ script_version_id: string; render_job_id: string | null; final_url: string | null; status: string }>({ action: "send_to_editor", ...p }),
};
