/**
 * narrativeService — the I/O half of the Narrative Engine.
 *
 * `narrativeEngine.ts` holds the rules (roles, the plan, the chain, coverage);
 * this does the reads and writes. Kept apart so the rules stay unit-testable
 * without a database.
 *
 * ── THE UN-BURYING ─────────────────────────────────────────────────────────
 * `sendToApprovalBoard` writes ONE real row (an agent_social_posts draft) and
 * then concatenates the blog, X thread, Substack, LinkedIn and YouTube copy
 * into a single slack_agent_tasks description:
 *
 *     --- BLOG --- … --- X --- … --- SUBSTACK --- …
 *
 * `fanOutPack` is the fix: each piece becomes an artifact row, and the ones
 * with a real home table become real rows there too (blog → agent_blog_posts,
 * Substack → agent_email_campaigns). Everything is tied to one narrative, so
 * the topic, the goal and the chain survive.
 *
 * ── IT NEVER PUBLISHES ─────────────────────────────────────────────────────
 * Every row it creates lands in a review state — `draft` for blog posts,
 * `needs_review` for email campaigns — matching the same rule the rest of the
 * pipeline follows: a machine may draft, only a human may send. Locked by
 * `tests/narrative-engine.test.ts`.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  ARTIFACT_KINDS,
  artifactKind,
  artifactsFromPack,
  buildLinkPlan,
  unmappedPackFields,
  type ArtifactRow,
  type NarrativeRow,
  type ObjectiveKey,
  type PackLike,
} from "./narrativeEngine";

const db = supabase as any;

/** Review states this module is allowed to write. It never publishes. */
export const REVIEW_STATES = {
  blog: "draft",
  email: "needs_review",
  social: "draft",
} as const;

export interface CreateNarrativeInput {
  brand: string;
  topic: string;
  objective: ObjectiveKey;
  funnelStage?: string | null;
  pillarKey?: string | null;
  /** The origin asset this narrative grew from (a render, a shot, an upload). */
  sourceTable?: string | null;
  sourceId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

/** Create the narrative and its planned artifact checklist in one go. */
export async function createNarrative(input: CreateNarrativeInput): Promise<NarrativeRow> {
  const { data, error } = await db
    .from("content_narratives")
    .insert({
      brand: input.brand,
      topic: input.topic.trim(),
      objective: input.objective,
      funnel_stage: input.funnelStage ?? null,
      pillar_key: input.pillarKey ?? null,
      source_table: input.sourceTable ?? null,
      source_id: input.sourceId ?? null,
      notes: input.notes ?? null,
      created_by: input.createdBy ?? "narrative-engine",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  // The full checklist, all planned/empty. This is what makes the gaps
  // visible — a narrative starts as thirteen honest blanks.
  const rows = ARTIFACT_KINDS.map((k) => ({
    narrative_id: data.id, kind: k.key, status: "planned",
  }));
  const { error: aErr } = await db.from("content_artifacts").insert(rows);
  if (aErr) throw new Error(`narrative created but the checklist failed: ${aErr.message}`);

  return data as NarrativeRow;
}

/**
 * Get the narrative for this brand + topic, creating it only if it is new.
 *
 * THIS IS WHAT MAKES THE SPINE AUTOMATIC. Producers call it on every run —
 * every BrandCast send, every pack — so a narrative forms because content was
 * made, not because somebody remembered to open a board and type a topic. That
 * distinction is the whole difference between a form and an operating system,
 * and it is why the tables sat at zero rows while the pack kept burying seven
 * pieces into a string.
 *
 * Idempotent by (brand, lowercased topic): re-sending the same session adds
 * artifacts to the SAME narrative instead of minting a near-duplicate every
 * time, which would make coverage meaningless within a week.
 */
export async function findOrCreateNarrative(input: CreateNarrativeInput): Promise<NarrativeRow> {
  const topic = input.topic.trim();
  if (!topic) throw new Error("a narrative needs a topic");

  const { data: found } = await db
    .from("content_narratives")
    .select("*")
    .eq("brand", input.brand)
    .ilike("topic", topic)
    .limit(1)
    .maybeSingle();
  if (found) return found as NarrativeRow;

  try {
    return await createNarrative({ ...input, topic });
  } catch (e) {
    // Two sends racing on the same topic: the loser re-reads rather than
    // failing the caller's whole fan-out over a duplicate.
    const { data: retry } = await db
      .from("content_narratives")
      .select("*")
      .eq("brand", input.brand)
      .ilike("topic", topic)
      .limit(1)
      .maybeSingle();
    if (retry) return retry as NarrativeRow;
    throw e;
  }
}

export interface FanOutResult {
  narrativeId: string;
  /** Artifacts that became real rows in their owning table. */
  materialised: Array<{ kind: string; table: string; id: string }>;
  /** Artifacts recorded with a body but no home table yet (AEO, collateral). */
  recorded: string[];
  /** Kinds the pack had nothing for — honest gaps, not empty drafts. */
  stillMissing: string[];
  /** Pack fields no artifact kind claims — loud, so nothing is silently lost. */
  unmapped: string[];
  /** Links written between the pieces that now exist. */
  linked: number;
}

/**
 * Turn a BrandCast content pack into real, linked rows under one narrative.
 *
 * Idempotent by (narrative_id, kind): re-running updates the artifact rather
 * than stacking duplicates, which is what the unique index enforces.
 *
 * ── WHY A SOCIAL PIECE MUST BECOME A ROW ───────────────────────────────────
 * Recording the copy on the artifact alone would just move the burial from a
 * task description to a different column. A piece is only usable once it is a
 * row in the table the rest of the machine already drives: agent_social_posts
 * is what the Content Director lists, what the calendar schedules, and what
 * content-deploy publishes. So X, LinkedIn, Threads, Instagram, Facebook and
 * the ad each become their own DRAFT there, on their own platform.
 *
 * Only Instagram and Facebook have a real publisher (`ArtifactKind.publish.auto`);
 * the rest are drafts a human posts by hand. The board says which is which
 * rather than implying an autopilot that does not exist.
 */
export async function fanOutPack(
  narrativeId: string,
  brand: string,
  pack: PackLike,
  opts: { producedBy?: string; sourceRef?: string; mediaUrls?: string[] } = {},
): Promise<FanOutResult> {
  const pieces = artifactsFromPack(pack);
  const materialised: FanOutResult["materialised"] = [];
  const recorded: string[] = [];

  for (const piece of pieces) {
    const kind = artifactKind(piece.kind);
    if (!kind) continue;

    let targetTable: string | null = null;
    let targetId: string | null = null;

    // Give the piece a real home where one exists. These are the tables that
    // already own publishing for that channel — no new producer.
    try {
      if (kind.home.table === "agent_blog_posts") {
        const { data, error } = await db.from("agent_blog_posts").insert({
          brand,
          title: piece.title || piece.body.split("\n")[0].slice(0, 120),
          body: piece.body,
          excerpt: piece.body.slice(0, 240),
          status: REVIEW_STATES.blog,
        }).select("id").single();
        if (!error && data) { targetTable = "agent_blog_posts"; targetId = data.id; }
      } else if (kind.home.table === "agent_email_campaigns") {
        const { data, error } = await db.from("agent_email_campaigns").insert({
          brand,
          campaign_name: piece.title || `${kind.label} — ${new Date().toISOString().slice(0, 10)}`,
          subject_line: piece.title || "",
          status: REVIEW_STATES.email,
        }).select("id").single();
        if (!error && data) { targetTable = "agent_email_campaigns"; targetId = data.id; }
      } else if (kind.home.table === "agent_social_posts" && kind.publish.platform) {
        const { data, error } = await db.from("agent_social_posts").insert({
          brand,
          platform: kind.publish.platform,
          post_type: kind.publish.postType || "static",
          caption: piece.body,
          hashtags: [],
          // Media only goes on the pieces that carry video; a text thread
          // inheriting the reel's mp4 would post the wrong thing.
          media_urls: kind.publish.postType === "reel" ? (opts.mediaUrls || []) : [],
          scheduled_date: null,   // never schedules itself
          status: REVIEW_STATES.social,
          created_by: opts.producedBy || "narrative-engine",
        }).select("id").single();
        if (!error && data) { targetTable = "agent_social_posts"; targetId = data.id; }
      }
    } catch {
      // A home-table insert failing must NOT lose the copy — it still gets
      // recorded on the artifact below, which is the whole point of having a
      // spine. Better a recorded artifact than a silently dropped piece.
    }

    const { error } = await db.from("content_artifacts").upsert({
      narrative_id: narrativeId,
      kind: piece.kind,
      title: piece.title,
      body: piece.body,
      target_table: targetTable,
      target_id: targetId,
      status: "drafted",
      produced_by: opts.producedBy || "content_pack",
    }, { onConflict: "narrative_id,kind" });
    if (error) throw new Error(`artifact ${piece.kind}: ${error.message}`);

    if (targetTable && targetId) materialised.push({ kind: piece.kind, table: targetTable, id: targetId });
    else recorded.push(piece.kind);
  }

  // The chain builds ITSELF. It used to be a "Rebuild links" button, which
  // meant the links existed only for narratives somebody remembered to click.
  const linked = await relinkNarrative(narrativeId).catch(() => 0);

  const covered = new Set(pieces.map((p) => p.kind));
  return {
    narrativeId,
    materialised,
    recorded,
    stillMissing: ARTIFACT_KINDS.map((k) => k.key).filter((k) => !covered.has(k)),
    unmapped: unmappedPackFields(pack),
    linked,
  };
}

/**
 * Record a row that ALREADY EXISTS as this narrative's artifact of some kind.
 *
 * The fan-out creates pieces; this adopts them. A finished render and the
 * Instagram draft BrandCast already writes are real content that would
 * otherwise sit outside the spine — visible in their own tables, invisible to
 * the narrative. Adoption is how the count on the board matches reality.
 *
 * It records a POINTER, never a copy: `target_table`/`target_id` only.
 */
export async function attachArtifact(input: {
  narrativeId: string;
  kind: string;
  table: string;
  id: string;
  title?: string | null;
  status?: "drafted" | "approved" | "published";
  producedBy?: string;
}): Promise<void> {
  if (!artifactKind(input.kind)) throw new Error(`unknown artifact kind: ${input.kind}`);
  const { error } = await db.from("content_artifacts").upsert({
    narrative_id: input.narrativeId,
    kind: input.kind,
    title: input.title ?? null,
    target_table: input.table,
    target_id: input.id,
    status: input.status || "drafted",
    produced_by: input.producedBy || "attach",
  }, { onConflict: "narrative_id,kind" });
  if (error) throw new Error(`attach ${input.kind}: ${error.message}`);
}

/** Every artifact of a narrative. */
export async function loadArtifacts(narrativeId: string): Promise<ArtifactRow[]> {
  const { data, error } = await db
    .from("content_artifacts")
    .select("*")
    .eq("narrative_id", narrativeId);
  if (error) throw new Error(error.message);
  return (data || []) as ArtifactRow[];
}

/**
 * Recompute and persist the chain — which artifact points at which.
 * Safe to run repeatedly; it only ever links pieces that actually exist.
 */
export async function relinkNarrative(narrativeId: string): Promise<number> {
  const artifacts = await loadArtifacts(narrativeId);
  const plan = buildLinkPlan(artifacts);
  let updated = 0;
  for (const [id, targets] of Object.entries(plan)) {
    const current = artifacts.find((a) => a.id === id)?.links_to || [];
    const same = current.length === targets.length && targets.every((t) => current.includes(t));
    if (same) continue;
    const { error } = await db.from("content_artifacts")
      .update({ links_to: targets, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (!error) updated++;
  }
  return updated;
}

export interface UnattachedCount {
  socialPosts: number;
  blogPosts: number;
  emailCampaigns: number;
  renders: number;
  total: number;
}

/**
 * How much content exists OUTSIDE the spine.
 *
 * Without this an empty Narrative board reads as "nothing to see" when the
 * truth is "everything we have ever made is orphaned" — the same silent-failure
 * shape as a health check that only asks whether a process is alive. Measured
 * on 2026-08-05: 0 narratives and 0 artifacts against 31 blog posts, 199 email
 * campaigns and 276 social posts. The board has to say that out loud.
 *
 * Counts rows only — no bodies fetched, so it stays cheap enough to run on
 * every board load.
 */
export async function countUnattached(): Promise<UnattachedCount> {
  const attachedIds = async (table: string): Promise<string[]> => {
    const { data } = await db.from("content_artifacts")
      .select("target_id").eq("target_table", table).not("target_id", "is", null);
    return (data || []).map((r: any) => r.target_id).filter(Boolean);
  };

  const countMinus = async (table: string): Promise<number> => {
    try {
      const attached = await attachedIds(table);
      let q = db.from(table).select("id", { count: "exact", head: true });
      // `not in ()` is invalid SQL — only exclude when there IS something to
      // exclude, or the whole count silently errors to zero and reads as
      // "nothing orphaned", the exact opposite of the truth.
      if (attached.length) q = q.not("id", "in", `(${attached.join(",")})`);
      const { count } = await q;
      return count ?? 0;
    } catch { return 0; }
  };

  const [socialPosts, blogPosts, emailCampaigns, renders] = await Promise.all([
    countMinus("agent_social_posts"),
    countMinus("agent_blog_posts"),
    countMinus("agent_email_campaigns"),
    countMinus("video_render_jobs"),
  ]);

  return {
    socialPosts, blogPosts, emailCampaigns, renders,
    total: socialPosts + blogPosts + emailCampaigns + renders,
  };
}
