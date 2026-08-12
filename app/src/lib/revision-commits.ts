/**
 * Immutable DesignProAI version ledger access.
 */
import { supabase } from "@/integrations/supabase/client";

export type ChangeType = "generate" | "edit" | "revision";
export type AngleRenders = Array<{ view: string; url: string }> | Record<string, string> | null;

export interface RevisionSnapshot {
  contractVersion?: string;
  visualizationId?: string;
  renderUrls?: Record<string, string>;
  change?: {
    type?: ChangeType;
    prompt?: string | null;
    viewKeys?: string[];
  };
  [key: string]: unknown;
}

export interface VersionCommitInput {
  jobId: string;
  userId?: string | null;
  shopId?: string | null;
  userPrompt?: string | null;
  systemPromptSnapshot?: string | null;
  masterArtboardUrl?: string | null;
  heroRenderUrl?: string | null;
  angleRenders?: AngleRenders;
  changeType?: ChangeType;
}

export interface VersionCommit {
  id: string;
  job_id: string;
  version_number: number;
  user_id: string | null;
  shop_id: string | null;
  user_prompt: string | null;
  system_prompt_snapshot: string | null;
  master_artboard_url: string | null;
  hero_render_url: string | null;
  angle_renders_json: AngleRenders;
  change_type: ChangeType;
  created_at: string;
  designiq_generation_id?: string | null;
  source_visualization_id?: string | null;
  revision_snapshot?: RevisionSnapshot | null;
  revision_snapshot_hash?: string | null;
  frozen_at?: string | null;
}

const TABLE = "design_version_commits";

async function topVersion(jobId: string): Promise<number> {
  const { data } = await supabase
    .from(TABLE as any)
    .select("version_number")
    .eq("job_id", jobId)
    .order("version_number", { ascending: false })
    .limit(1);
  const top = Array.isArray(data) && data[0] ? (data[0] as any).version_number : 0;
  return Number(top) || 0;
}

export async function recordVersionCommit(input: VersionCommitInput): Promise<VersionCommit | null> {
  if (!input.jobId) return null;
  const buildRow = (version_number: number) => ({
    job_id: input.jobId,
    version_number,
    user_id: input.userId ?? null,
    shop_id: input.shopId ?? null,
    user_prompt: input.userPrompt ?? null,
    system_prompt_snapshot: input.systemPromptSnapshot ?? null,
    master_artboard_url: input.masterArtboardUrl ?? null,
    hero_render_url: input.heroRenderUrl ?? null,
    angle_renders_json: input.angleRenders ?? [],
    change_type: input.changeType ?? "generate",
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const version_number = (await topVersion(input.jobId)) + 1;
      const { data, error } = await supabase.from(TABLE as any).insert(buildRow(version_number)).select().single();
      if (!error) return data as VersionCommit;
      if ((error as any).code === "23505" && attempt === 0) continue;
      console.warn("[revision-commits] insert failed:", error.message);
      return null;
    } catch (e: any) {
      console.warn("[revision-commits] recordVersionCommit threw:", e?.message || e);
      return null;
    }
  }
  return null;
}

/**
 * Read both generations of the ledger identity. Durable OS rows are keyed by
 * designiq_generation_id while legacy rows used job_id; callers may pass both
 * generation and visualization IDs. De-duplicate by immutable commit id.
 */
export async function getVersionCommits(idsInput: string | string[]): Promise<VersionCommit[]> {
  const ids = Array.from(new Set((Array.isArray(idsInput) ? idsInput : [idsInput]).filter(Boolean)));
  if (ids.length === 0) return [];

  const [legacy, durable] = await Promise.all([
    supabase.from(TABLE as any).select("*").in("job_id", ids),
    supabase.from(TABLE as any).select("*").in("designiq_generation_id", ids),
  ]);
  if (legacy.error && durable.error) {
    console.warn("[revision-commits] getVersionCommits failed:", durable.error.message || legacy.error.message);
    return [];
  }

  const byId = new Map<string, VersionCommit>();
  for (const row of [...(legacy.data || []), ...(durable.data || [])] as VersionCommit[]) {
    if (row?.id) byId.set(row.id, row);
  }
  return Array.from(byId.values()).sort((a, b) =>
    (a.version_number - b.version_number) ||
    new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
  );
}
