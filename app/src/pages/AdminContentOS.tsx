/**
 * AdminContentOS — "what is this system doing, and what is stopping it?"
 *
 * ── WHY THIS SCREEN EXISTS ─────────────────────────────────────────────────
 * The owner's complaint, repeated over weeks, is "none of the system is
 * showing". An admin's version of it on 2026-08-07 was "no progress bar, no
 * indication that it's done." Neither is a UI gripe. They are the accurate
 * observation that this system cannot report its own condition.
 *
 * Everything found on 2026-08-07 was invisible until somebody queried the
 * database by hand: three passes configured and never executed (the workflow
 * was green), 25 of 25 enrichment calls returning HTTP 401 (the workflow was
 * green), content_type NULL on all 427 videos, a brand with 82 clips and ZERO
 * parsed sources so every draft for it could only ever be a stub, and 98 shot
 * cards with a written brief against three with footage attached.
 *
 * Every one of those is a number a screen could have shown. This is the screen.
 *
 * ── IT REPORTS; IT DOES NOT ACT ────────────────────────────────────────────
 * Read-only, on purpose. There is not one button here that mutates anything —
 * no re-run, no retry, no fix. A diagnostic that can also change the system is
 * a diagnostic nobody can trust to be telling them about the system as it was
 * a second ago. Every blocker names the surface where the fix actually lives.
 *
 * ── THE ARITHMETIC IS NOT IN THIS FILE ─────────────────────────────────────
 * `src/lib/contentOsStatus.ts` decides; this file renders. That split is what
 * makes the honesty testable: `tests/content-os-status.test.ts` locks the
 * funnel arithmetic, the "ran but idle" vs "never ran" distinction, the
 * blocker-always-has-a-next-step rule, unknown-renders-as-unknown, and — by
 * grepping the module's source — that no progress anywhere is derived from the
 * clock. `queuedWork.progressFor` supplies every percentage on this page, so a
 * stalled pass LOOKS stalled instead of watching a bar creep.
 *
 * ── EVERY NUMBER HERE WAS MEASURED ─────────────────────────────────────────
 * Each count carries the query that produced it and each query is shown on the
 * row it feeds. A read that fails becomes an explicit UNKNOWN with the
 * PostgREST error attached — never a zero. A dashboard that guesses is worse
 * than no dashboard, because it will be believed.
 *
 * WHITE UI standard (`docs/WHITE_UI_STANDARD.md`): white surface, explicit
 * grays, the blue→magenta gradient as an ACCENT only. Status chips follow the
 * ecosystem colour formula — tinted when idle, SOLID in their own colour when
 * active, never a gradient for identity (see `ChannelAngleCard`).
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Ban, ChevronDown, ChevronRight, Database,
  HeartPulse, Info, ListChecks, RefreshCw, ShieldAlert, TrendingDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  measured, unknown, isKnown, formatCount, unknownNote, percentOf,
  PASSES, describePasses, rollupPasses, passPercent,
  FUNNEL, buildFunnel, worstDrop,
  findBlockers, blockersEmptyState, emptyState, groupFailures, systemHeadline,
  type Count, type PassEvidence, type PassHealth, type FunnelRow,
  type Blocker, type BrandFootage, type OrphanBrand, type PublishBlock,
  type FailureRow, type Severity,
} from "@/lib/contentOsStatus";

const db = supabase as any;

/**
 * The palette. Flat hexes, used as tints and as solid fills — never as a
 * gradient, because a gradient makes "stalled" and "failing" the same smear at
 * a glance and this screen exists to be read at a glance.
 */
const C = {
  ok: "#10B981",
  working: "#3B82F6",
  idle: "#64748B",
  warn: "#F59E0B",
  bad: "#EF4444",
  unknown: "#8B5CF6",
} as const;

function tint(hex: string, alpha = 0.12): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE QUERIES
//
// Each one is named after what it PROVES, and its text travels with its number
// all the way to the screen. Nothing here mutates.
// ═══════════════════════════════════════════════════════════════════════════

/** Run a head-count. A failed read becomes an explicit unknown, never a zero. */
async function countOf(query: string, build: () => any): Promise<Count> {
  try {
    const { count, error } = await build();
    if (error) return unknown(query, `the read failed — ${error.message}`);
    if (typeof count !== "number") return unknown(query, "PostgREST returned no count for this query");
    return measured(count, query);
  } catch (e) {
    return unknown(query, `the read threw — ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Read one column off the newest row. Returns null on any failure. */
async function newestValue(build: () => any, pick: (row: any) => unknown): Promise<string | null> {
  try {
    const { data, error } = await build();
    if (error || !data || !data.length) return null;
    const v = pick(data[0]);
    const s = v === null || v === undefined ? "" : String(v);
    return s.trim() || null;
  } catch {
    return null;
  }
}

/** Raw library asset types, exactly as `classify.js` defines the pool. */
const RAW_POOL = ["video", "image", "audio"];

export interface Snapshot {
  readAtMs: number;
  passEvidence: Record<string, PassEvidence>;
  counts: Record<string, Count>;
  brandFootage: BrandFootage[];
  orphanBrands: OrphanBrand[];
  publishBlocks: PublishBlock[];
  failures: FailureRow[];
  /** How many of the blocker inputs actually produced a measured number. */
  measuredChecks: number;
  /** A read that failed hard enough that the page cannot be trusted. */
  fatal: string | null;
}

async function loadSnapshot(): Promise<Snapshot> {
  const readAtMs = Date.now();
  let fatal: string | null = null;

  // ── The two row reads. Everything else is a head-count. ──────────────────
  // These are narrow on purpose: `metadata` and `generation_meta` are large
  // jsonb columns and pulling them for 761 + 334 rows to compute a count would
  // make this screen expensive enough that nobody leaves it open.
  const assetsQuery =
    "agent_media_assets: id, brand, asset_type, storage_url, content_type (limit 3000)";
  const sourcesQuery = "media_sources: storage_url (limit 3000)";

  //
  // AN EMPTY ARRAY IS NOT A VALUE. `raw_asset_ids` is non-null on all 102 shot
  // cards and EMPTY on 99 of them; `media_urls` is non-null on 182 pieces and
  // empty on 7. A PostgREST `not.is.null` head-count would therefore have
  // reported 102 cards "with footage" when three have any — a 95-card drop
  // rendered as no drop at all, which is precisely the confident-and-wrong
  // number this screen exists to stop. Both are counted in memory, where the
  // array's LENGTH can actually be read. Both tables are small enough that
  // this costs nothing.
  const cardsQuery = "shot_list_items: id, filming_instruction, raw_asset_ids (limit 1000)";
  const postsQuery = "agent_social_posts: id, brand, status, media_urls (limit 3000)";

  const [assetsRes, sourcesRes, postsRes, cardsRes] = await Promise.all([
    db.from("agent_media_assets").select("id, brand, asset_type, storage_url, content_type").limit(3000),
    db.from("media_sources").select("storage_url").limit(3000),
    db.from("agent_social_posts").select("id, brand, status, media_urls").limit(3000),
    db.from("shot_list_items").select("id, filming_instruction, raw_asset_ids").limit(1000),
  ]);

  if (assetsRes?.error) fatal = `agent_media_assets could not be read — ${assetsRes.error.message}`;

  const assets: any[] = assetsRes?.data || [];
  const parsedUrls = new Set<string>(
    (sourcesRes?.data || []).map((r: any) => String(r?.storage_url || "").trim()).filter(Boolean),
  );
  const sourcesFailed = Boolean(sourcesRes?.error);

  // ── PARSED, PER BRAND. The honest denominator behind "82 clips, 0 parsed". ─
  const byBrand = new Map<string, { clips: number; parsed: number }>();
  let parsedTotal = 0;
  for (const a of assets) {
    if (String(a?.asset_type || "") !== "video") continue;
    const brand = String(a?.brand || "").trim() || "(no brand)";
    const url = String(a?.storage_url || "").trim();
    const row = byBrand.get(brand) || { clips: 0, parsed: 0 };
    row.clips += 1;
    if (url && parsedUrls.has(url)) { row.parsed += 1; parsedTotal += 1; }
    byBrand.set(brand, row);
  }

  const brandFootage: BrandFootage[] = [...byBrand.entries()]
    .sort((a, b) => b[1].clips - a[1].clips)
    .map(([brand, v]) => ({
      brand,
      clips: assetsRes?.error
        ? unknown(assetsQuery, `the read failed — ${assetsRes.error.message}`)
        : measured(v.clips, `${assetsQuery} where asset_type='video' and brand='${brand}'`),
      parsed: sourcesFailed
        ? unknown(sourcesQuery, `the read failed — ${sourcesRes.error.message}`)
        : measured(v.parsed, `${sourcesQuery} matched on storage_url against that brand's clips`),
    }));

  // ── BRAND STRINGS PIECES CARRY AND NO ASSET DOES — the `wraptv` typo. ────
  const assetBrands = new Set(assets.map((a: any) => String(a?.brand || "").trim()).filter(Boolean));
  const orphanCounts = new Map<string, number>();
  for (const p of postsRes?.data || []) {
    const b = String(p?.brand || "").trim();
    if (!b || assetBrands.has(b)) continue;
    orphanCounts.set(b, (orphanCounts.get(b) || 0) + 1);
  }
  const orphanBrands: OrphanBrand[] =
    assetsRes?.error || postsRes?.error
      ? []
      : [...orphanCounts.entries()].sort((a, b) => b[1] - a[1]).map(([brand, posts]) => ({ brand, posts }));

  // ── ARRAYS COUNTED BY LENGTH, NOT BY NOT-NULL ───────────────────────────
  const hasItems = (v: unknown) => Array.isArray(v) && v.filter(Boolean).length > 0;

  const cardRows: any[] = cardsRes?.data || [];
  const cardsFail = cardsRes?.error ? `the read failed — ${cardsRes.error.message}` : null;
  const cardsTotal = cardsFail ? unknown(cardsQuery, cardsFail) : measured(cardRows.length, cardsQuery);
  const cardsBriefed = cardsFail
    ? unknown(cardsQuery, cardsFail)
    : measured(
      cardRows.filter((r) => String(r?.filming_instruction || "").trim()).length,
      `${cardsQuery}, counting rows whose filming_instruction is non-empty`,
    );
  const cardsFootage = cardsFail
    ? unknown(cardsQuery, cardsFail)
    : measured(
      cardRows.filter((r) => hasItems(r?.raw_asset_ids)).length,
      `${cardsQuery}, counting rows whose raw_asset_ids array has at least one entry (an empty array is NOT footage)`,
    );

  const postRows: any[] = postsRes?.data || [];
  const postsFail = postsRes?.error ? `the read failed — ${postsRes.error.message}` : null;
  const postsTotal = postsFail ? unknown(postsQuery, postsFail) : measured(postRows.length, postsQuery);
  const postsWithCreative = postsFail
    ? unknown(postsQuery, postsFail)
    : measured(
      postRows.filter((r) => hasItems(r?.media_urls)).length,
      `${postsQuery}, counting rows whose media_urls array has at least one entry (an empty array is NOT a creative)`,
    );
  const postsApproved = postsFail
    ? unknown(postsQuery, postsFail)
    : measured(
      postRows.filter((r) => ["approved", "scheduled"].includes(String(r?.status || ""))).length,
      `${postsQuery}, counting status in ('approved','scheduled')`,
    );
  const postsPublished = postsFail
    ? unknown(postsQuery, postsFail)
    : measured(
      postRows.filter((r) => String(r?.status || "") === "completed").length,
      `${postsQuery}, counting status='completed' — the only terminal "it left the building" state this table has`,
    );

  // ── THE HEAD-COUNTS ──────────────────────────────────────────────────────
  const [
    assetsTotal, assetsClassified, assetsEnriched,
    cutsTotal, cutsQueued, cutsRendered,
    postsNeedingFootage,
    classifyTouched, classifyBacklog,
    intelTouched, intelBacklog, intelFailed,
    tagTouched, tagBacklog, tagFailed,
    runnerTouched,
    spineTouched, promoteTouched,
  ] = await Promise.all([
    countOf("agent_media_assets: every row", () =>
      db.from("agent_media_assets").select("id", { count: "exact", head: true })),
    countOf("agent_media_assets where content_type is not null", () =>
      db.from("agent_media_assets").select("id", { count: "exact", head: true }).not("content_type", "is", null)),
    countOf("agent_media_assets where visual_tags ? 'asset_intelligence'", () =>
      db.from("agent_media_assets").select("id", { count: "exact", head: true }).not("visual_tags->asset_intelligence", "is", null)),

    countOf("video_render_jobs: every row", () =>
      db.from("video_render_jobs").select("id", { count: "exact", head: true })),
    countOf("video_render_jobs where status = 'queued'", () =>
      db.from("video_render_jobs").select("id", { count: "exact", head: true }).eq("status", "queued")),
    countOf("video_render_jobs where status = 'complete'", () =>
      db.from("video_render_jobs").select("id", { count: "exact", head: true }).eq("status", "complete")),

    countOf("agent_social_posts where generation_meta->needs_footage is set (searched, matched nothing)", () =>
      db.from("agent_social_posts").select("id", { count: "exact", head: true })
        .not("generation_meta->needs_footage", "is", null)),

    // classify.js — marker `metadata.content_type_pass`
    countOf("agent_media_assets where metadata->content_type_pass is set", () =>
      db.from("agent_media_assets").select("id", { count: "exact", head: true })
        .not("metadata->content_type_pass", "is", null)),
    countOf("agent_media_assets: raw-pool rows with no content_type and no content_type_pass marker", () =>
      db.from("agent_media_assets").select("id", { count: "exact", head: true })
        .in("asset_type", RAW_POOL)
        .is("content_type", null)
        .is("metadata->content_type_pass", null)),

    // intelligence.js — marker `metadata.asset_intelligence_pass`
    countOf("agent_media_assets where metadata->asset_intelligence_pass is set", () =>
      db.from("agent_media_assets").select("id", { count: "exact", head: true })
        .not("metadata->asset_intelligence_pass", "is", null)),
    countOf("agent_media_assets with no asset_intelligence_pass marker at all", () =>
      db.from("agent_media_assets").select("id", { count: "exact", head: true })
        .is("metadata->asset_intelligence_pass", null)),
    countOf("agent_media_assets where asset_intelligence_pass.outcome = 'failed'", () =>
      db.from("agent_media_assets").select("id", { count: "exact", head: true })
        .eq("metadata->asset_intelligence_pass->>outcome", "failed")),

    // tagLibrary.js — markers `metadata.tag_library_at` / `tag_library_error`
    countOf("agent_media_assets where metadata->tag_library_at is set", () =>
      db.from("agent_media_assets").select("id", { count: "exact", head: true })
        .not("metadata->tag_library_at", "is", null)),
    countOf("agent_media_assets: video rows with no machine_tags and no tag_library_at", () =>
      db.from("agent_media_assets").select("id", { count: "exact", head: true })
        .eq("asset_type", "video")
        .is("visual_tags->machine_tags", null)
        .is("metadata->tag_library_at", null)),
    countOf("agent_media_assets where metadata->tag_library_error is set", () =>
      db.from("agent_media_assets").select("id", { count: "exact", head: true })
        .not("metadata->tag_library_error", "is", null)),

    // contentRunner.js / reattach.js
    countOf("agent_social_posts where generation_meta->pending_render_since is set", () =>
      db.from("agent_social_posts").select("id", { count: "exact", head: true })
        .not("generation_meta->pending_render_since", "is", null)),
    countOf("content_artifacts where produced_by = 'spine-cron'", () =>
      db.from("content_artifacts").select("id", { count: "exact", head: true }).eq("produced_by", "spine-cron")),
    countOf("agent_ad_campaigns: every row", () =>
      db.from("agent_ad_campaigns").select("id", { count: "exact", head: true })),
  ]);

  // ── LAST-RUN STAMPS. Each is the newest row carrying that pass's marker. ──
  const [
    classifyAt, intelAt, intelError, tagAt, tagError,
    runnerAt, spineAt, reattachAt, promoteAt,
  ] = await Promise.all([
    newestValue(
      () => db.from("agent_media_assets").select("metadata")
        .not("metadata->content_type_pass", "is", null)
        .order("metadata->content_type_pass->>at", { ascending: false }).limit(1),
      (r) => r?.metadata?.content_type_pass?.at),
    newestValue(
      () => db.from("agent_media_assets").select("metadata")
        .not("metadata->asset_intelligence_pass", "is", null)
        .order("metadata->asset_intelligence_pass->>at", { ascending: false }).limit(1),
      (r) => r?.metadata?.asset_intelligence_pass?.at),
    newestValue(
      () => db.from("agent_media_assets").select("metadata")
        .eq("metadata->asset_intelligence_pass->>outcome", "failed")
        .order("metadata->asset_intelligence_pass->>at", { ascending: false }).limit(1),
      (r) => r?.metadata?.asset_intelligence_pass?.error),
    newestValue(
      () => db.from("agent_media_assets").select("metadata")
        .not("metadata->tag_library_at", "is", null)
        .order("metadata->>tag_library_at", { ascending: false }).limit(1),
      (r) => r?.metadata?.tag_library_at),
    newestValue(
      () => db.from("agent_media_assets").select("metadata")
        .not("metadata->tag_library_error", "is", null)
        .order("metadata->>tag_library_error_at", { ascending: false }).limit(1),
      (r) => r?.metadata?.tag_library_error),
    newestValue(
      () => db.from("agent_social_posts").select("generation_meta")
        .not("generation_meta->pending_render_since", "is", null)
        .order("generation_meta->>pending_render_since", { ascending: false }).limit(1),
      (r) => r?.generation_meta?.pending_render_since),
    newestValue(
      () => db.from("content_artifacts").select("created_at").eq("produced_by", "spine-cron")
        .order("created_at", { ascending: false }).limit(1),
      (r) => r?.created_at),
    newestValue(
      () => db.from("content_artifacts").select("created_at").eq("produced_by", "reattach-cron")
        .order("created_at", { ascending: false }).limit(1),
      (r) => r?.created_at),
    newestValue(
      () => db.from("agent_ad_campaigns").select("created_at")
        .order("created_at", { ascending: false }).limit(1),
      (r) => r?.created_at),
  ]);

  const reattachTouched = await countOf("content_artifacts where produced_by = 'reattach-cron'", () =>
    db.from("content_artifacts").select("id", { count: "exact", head: true }).eq("produced_by", "reattach-cron"));

  // ── DRAFTS WAITING FOR A CREATIVE ───────────────────────────────────────
  // `contentRunner.needsCreative` verbatim: draft, no media, no render already
  // composing, not parked after a fruitless search. Two of those four are json
  // keys and one is an ARRAY LENGTH, so this is a real read narrowed to the
  // json subfields rather than four head-count filters — `generation_meta` can
  // carry a whole cached model response and is never pulled whole here.
  const draftsQuery =
    "agent_social_posts where status='draft': id, media_urls, generation_meta->pending_render_job_id, generation_meta->needs_footage (limit 1000)";
  const draftsRes = await db
    .from("agent_social_posts")
    .select("id, media_urls, pending:generation_meta->pending_render_job_id, parked:generation_meta->needs_footage")
    .eq("status", "draft")
    .limit(1000);

  // ── REATTACH'S OWN BACKLOG ──────────────────────────────────────────────
  // A piece whose render was enqueued and whose media never came back. Same
  // empty-array trap as above, so it is counted by array length on a read
  // narrowed to the pieces that have a pending job at all.
  const pendingQuery =
    "agent_social_posts where generation_meta->pending_render_job_id is set: id, media_urls (limit 1000)";
  const pendingRes = await db
    .from("agent_social_posts")
    .select("id, media_urls")
    .not("generation_meta->pending_render_job_id", "is", null)
    .limit(1000);
  const reattachBacklog: Count = pendingRes?.error
    ? unknown(pendingQuery, `the read failed — ${pendingRes.error.message}`)
    : measured(
      (pendingRes?.data || []).filter((r: any) => !hasItems(r?.media_urls)).length,
      `${pendingQuery} — counting the ones whose media_urls is still empty`,
    );

  const postsWaitingCreative: Count = draftsRes?.error
    ? unknown(draftsQuery, `the read failed — ${draftsRes.error.message}`)
    : measured(
      (draftsRes?.data || []).filter((r: any) =>
        !hasItems(r?.media_urls) && r?.pending === null && r?.parked === null).length,
      `${draftsQuery} — counting rows contentRunner.needsCreative would pick up`,
    );

  // ── RECENT FAILURES, WITH THEIR ACTUAL ERROR TEXT ───────────────────────
  const [renderFails, parseFails, publishFails] = await Promise.all([
    db.from("video_render_jobs").select("id, brand, error, updated_at")
      .eq("status", "failed").order("updated_at", { ascending: false }).limit(30),
    db.from("video_parse_jobs").select("id, error, updated_at")
      .eq("status", "failed").order("updated_at", { ascending: false }).limit(30),
    db.from("agent_social_posts").select("id, brand, publish_error, updated_at")
      .not("publish_error", "is", null).order("updated_at", { ascending: false }).limit(30),
  ]);

  const failures: FailureRow[] = [
    ...(renderFails?.data || []).map((r: any) => ({
      where: "video_render_jobs", id: r.id, brand: r.brand, error: r.error, at: r.updated_at,
    })),
    ...(parseFails?.data || []).map((r: any) => ({
      where: "video_parse_jobs", id: r.id, brand: null, error: r.error, at: r.updated_at,
    })),
    ...(publishFails?.data || []).map((r: any) => ({
      where: "agent_social_posts (publish)", id: r.id, brand: r.brand, error: r.publish_error, at: r.updated_at,
    })),
  ];

  // Publish failures are a BLOCKER as well as a failure: the same sentence
  // repeated ten times is not ten problems, it is one missing connection.
  const publishGroups = new Map<string, PublishBlock>();
  for (const r of publishFails?.data || []) {
    const err = String(r?.publish_error || "").trim();
    if (!err) continue;
    const platform = /meta_facebook/i.test(err) ? "meta_facebook"
      : /instagram/i.test(err) ? "instagram"
        : /youtube/i.test(err) ? "youtube"
          : "the destination named in the error";
    const g = publishGroups.get(platform);
    if (g) g.posts += 1;
    else publishGroups.set(platform, { platform, posts: 1, error: err });
  }

  const passEvidence: Record<string, PassEvidence> = {
    spine: {
      key: "spine", lastRunAt: spineAt, touched: spineTouched,
      backlog: unknown(
        "complete renders with no content_artifacts row",
        "this needs a join PostgREST cannot express in one head-count, and it has not been added yet",
      ),
    },
    reattach: {
      key: "reattach", lastRunAt: reattachAt, touched: reattachTouched, backlog: reattachBacklog,
    },
    promote: {
      key: "promote", lastRunAt: promoteAt, touched: promoteTouched,
      backlog: unknown(
        "organic pieces past the promotion threshold with no agent_ad_campaigns row",
        "the threshold lives in worker/video-renderer/promote.js and is not exposed to the client, so this cannot be counted here",
      ),
    },
    classify: { key: "classify", lastRunAt: classifyAt, touched: classifyTouched, backlog: classifyBacklog },
    intelligence: {
      key: "intelligence", lastRunAt: intelAt, touched: intelTouched,
      backlog: intelBacklog, failed: intelFailed, lastError: intelError,
    },
    contentRunner: {
      key: "contentRunner", lastRunAt: runnerAt, touched: runnerTouched, backlog: postsWaitingCreative,
    },
    tagLibrary: {
      key: "tagLibrary", lastRunAt: tagAt, touched: tagTouched,
      backlog: tagBacklog, failed: tagFailed, lastError: tagError,
    },
  };

  const counts: Record<string, Count> = {
    "assets.total": assetsTotal,
    "assets.parsed": assetsRes?.error || sourcesFailed
      ? unknown(`${assetsQuery} matched on storage_url against ${sourcesQuery}`,
        "one of the two reads failed, so the match could not be computed")
      : measured(parsedTotal, `${assetsQuery} (asset_type='video') matched on storage_url against ${sourcesQuery}`),
    "assets.classified": assetsClassified,
    "assets.enriched": assetsEnriched,
    "cards.total": cardsTotal,
    "cards.briefed": cardsBriefed,
    "cards.withFootage": cardsFootage,
    "cuts.total": cutsTotal,
    "cuts.queued": cutsQueued,
    "cuts.rendered": cutsRendered,
    "posts.total": postsTotal,
    "posts.withCreative": postsWithCreative,
    "posts.approved": postsApproved,
    "posts.published": postsPublished,
  };

  const blockerInputs: Array<Count | null> = [
    postsWaitingCreative, postsNeedingFootage, cardsBriefed, cardsFootage,
    ...brandFootage.map((b) => b.clips),
  ];
  const measuredChecks = blockerInputs.filter((c) => isKnown(c)).length;

  return {
    readAtMs,
    passEvidence,
    counts,
    brandFootage,
    orphanBrands,
    publishBlocks: [...publishGroups.values()].sort((a, b) => b.posts - a.posts),
    failures,
    measuredChecks,
    fatal,
    // Carried for the blocker section only.
    ...({ postsWaitingCreative, postsNeedingFootage } as any),
  } as Snapshot & { postsWaitingCreative: Count; postsNeedingFootage: Count };
}

// ═══════════════════════════════════════════════════════════════════════════
// SMALL RENDERING PIECES
// ═══════════════════════════════════════════════════════════════════════════

function Chip({ color, solid, children }: { color: string; solid?: boolean; children: React.ReactNode }) {
  // Ecosystem colour formula: tinted when idle, SOLID in its own colour with
  // white text when it is the thing you are meant to look at. Never a gradient
  // — identity has to survive a glance.
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
      style={solid
        ? { backgroundColor: color, borderColor: color, color: "#fff" }
        : { backgroundColor: tint(color), borderColor: tint(color, 0.35), color }}
    >
      {children}
    </span>
  );
}

/**
 * The bar. Fill comes from `queuedWork.progressFor` via `contentOsStatus` and
 * from nowhere else — it has four positions and no timer. A stalled pass sits
 * still, and that stillness is the signal.
 */
function Bar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
      <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} />
    </div>
  );
}

function Empty({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-gray-600">{message}</p>
    </div>
  );
}

function Section({
  icon: Icon, title, blurb, children,
}: { icon: typeof Activity; title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "linear-gradient(135deg,#3b82f6,#ec4899)" }}>
          <Icon className="h-4 w-4 text-white" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <p className="mt-0.5 text-sm leading-relaxed text-gray-600">{blurb}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

const PASS_COLOR: Record<PassHealth["state"], string> = {
  idle: C.ok,
  working: C.working,
  never_ran: C.bad,
  stalled: C.warn,
  failing: C.bad,
  unknown: C.unknown,
};

const SEVERITY_COLOR: Record<Severity, string> = {
  blocked: C.bad,
  degraded: C.warn,
  watch: C.idle,
};

/** The query behind a number, shown on demand rather than hidden forever. */
function Receipt({ query }: { query: string }) {
  return (
    <p className="mt-1 font-mono text-[11px] leading-relaxed text-gray-400 break-words">{query}</p>
  );
}

function PassRow({ h }: { h: PassHealth }) {
  const color = PASS_COLOR[h.state];
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-gray-900">{h.spec.label}</span>
        <Chip color={color} solid={h.state !== "idle" && h.state !== "working"}>{h.stateText}</Chip>
        <span className="text-[11px] font-medium text-gray-500">Last stamped {h.ageText.toLowerCase()}</span>
        {h.spec.spends && <Chip color={C.warn}>Spends per item</Chip>}
      </div>
      <div className="mt-2"><Bar percent={passPercent(h)} color={color} /></div>
      <p className="mt-2 text-sm leading-relaxed text-gray-700">{h.headline}</p>
      {h.nextStep && (
        <p className="mt-1.5 text-sm font-medium leading-relaxed" style={{ color }}>
          Next: {h.nextStep}
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-gray-500">{h.spec.does}</p>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
        <div><dt className="inline font-semibold">Rows stamped: </dt><dd className="inline">{formatCount(h.touched)}</dd></div>
        <div><dt className="inline font-semibold">Still eligible: </dt><dd className="inline">{formatCount(h.backlog)}</dd></div>
        <div><dt className="inline font-semibold">Recorded failures: </dt><dd className="inline">{formatCount(h.failed)}</dd></div>
      </dl>
      {!isKnown(h.backlog) && <p className="mt-1 text-xs leading-relaxed text-gray-500">{unknownNote(h.backlog)}</p>}
      {h.lastError && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-red-50 p-2.5 text-[11px] leading-relaxed text-red-800">
          {h.lastError}
        </pre>
      )}
      <Receipt query={`Evidence it ran: ${h.spec.marker}`} />
    </li>
  );
}

function FunnelGroup({ group, rows }: { group: string; rows: FunnelRow[] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{group}</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => {
          const pct = r.survivedPct;
          const color = r.anomaly ? C.bad : pct === null ? C.unknown : pct < 25 ? C.bad : pct < 75 ? C.warn : C.ok;
          return (
            <li key={r.spec.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-gray-900">{r.spec.label}</span>
                <span
                  className="shrink-0 text-lg font-bold tabular-nums"
                  style={{ color: isKnown(r.count) ? "#111827" : C.unknown }}
                >
                  {formatCount(r.count)}
                </span>
              </div>
              {/* The bar shows SURVIVAL against this step's own denominator. It
                  is absent — not zero-width, absent — when either side is
                  unmeasured, so a missing number can never look like a wipeout. */}
              {pct === null ? null : <div className="mt-1"><Bar percent={pct} color={color} /></div>}
              <p className="mt-1 text-xs leading-relaxed text-gray-600">{r.note}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{r.spec.meaning}</p>
              <Receipt query={r.count.query} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BlockerRow({ b }: { b: Blocker }) {
  const color = SEVERITY_COLOR[b.severity];
  return (
    <li className="rounded-xl border-l-4 border border-gray-200 bg-white p-4" style={{ borderLeftColor: color }}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip color={color} solid={b.severity === "blocked"}>
          {b.severity === "blocked" ? "Blocked" : b.severity === "degraded" ? "Degraded" : "Watch"}
        </Chip>
        <span className="font-mono text-[11px] text-gray-400">{b.id}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-gray-900">{b.headline}</p>
      <p className="mt-1.5 text-sm font-semibold leading-relaxed" style={{ color }}>Next: {b.nextStep}</p>
      <Receipt query={b.evidence} />
    </li>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// THE PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminContentOS() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["content-os-status"],
    queryFn: loadSnapshot,
    // A minute, so a screen left open stays true. The REFETCH moves the
    // numbers; nothing on this page moves on its own between refetches.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // Wall-clock time enters here and nowhere else, and only to say how OLD a
  // measured timestamp is. It never feeds a bar — see contentOsStatus.ts.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [showQueries, setShowQueries] = useState(false);

  const snap = data as (Snapshot & { postsWaitingCreative?: Count; postsNeedingFootage?: Count }) | undefined;

  const passes = useMemo(() => describePasses(snap?.passEvidence, nowMs), [snap, nowMs]);
  const roll = useMemo(() => rollupPasses(passes), [passes]);
  const funnel = useMemo(() => buildFunnel(snap?.counts), [snap]);
  const worst = useMemo(() => worstDrop(funnel), [funnel]);
  const blockers = useMemo(
    () => findBlockers({
      passes,
      brandFootage: snap?.brandFootage,
      orphanBrands: snap?.orphanBrands,
      publishBlocks: snap?.publishBlocks,
      postsWaitingCreative: snap?.postsWaitingCreative,
      postsNeedingFootage: snap?.postsNeedingFootage,
      cards: {
        total: snap?.counts?.["cards.total"],
        briefed: snap?.counts?.["cards.briefed"],
        withFootage: snap?.counts?.["cards.withFootage"],
      },
    }),
    [passes, snap],
  );
  const headline = useMemo(() => systemHeadline(passes, blockers, worst), [passes, blockers, worst]);
  const failureGroups = useMemo(() => groupFailures(snap?.failures, 10), [snap]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, FunnelRow[]>();
    for (const r of funnel) {
      if (!byGroup.has(r.spec.group)) { byGroup.set(r.spec.group, []); order.push(r.spec.group); }
      byGroup.get(r.spec.group)!.push(r);
    }
    return order.map((g) => ({ group: g, rows: byGroup.get(g)! }));
  }, [funnel]);

  const readFailed = Boolean(error) || Boolean(snap?.fatal);
  const readError = snap?.fatal || (error instanceof Error ? error.message : error ? String(error) : null);
  const blockersEmpty = blockersEmptyState(blockers, {
    readFailed,
    error: readError,
    measuredChecks: snap?.measuredChecks ?? 0,
  });

  const toneColor = headline.tone === "blocked" ? C.bad
    : headline.tone === "degraded" ? C.warn
      : headline.tone === "unknown" ? C.unknown : C.ok;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">

        {/* ── HEADER ────────────────────────────────────────────────────── */}
        <header className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
                Content{" "}
                <span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">OS</span>
              </h1>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">
                What this system is doing, and what is stopping it. Every number below was measured;
                anything that was not says <span className="font-semibold text-gray-900">Unknown</span> rather
                than zero. This screen reports — it changes nothing.
              </p>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              Re-read
            </button>
          </div>

          {/* The one line. Leads with the blocker, because a green headline
              over a blocked system is what let all of this hide. */}
          <div
            className="mt-4 rounded-xl border p-4"
            style={{ backgroundColor: tint(toneColor), borderColor: tint(toneColor, 0.35) }}
          >
            <p className="text-sm font-semibold leading-relaxed text-gray-900">{headline.text}</p>
            <div className="mt-2"><Bar percent={headline.percent} color={toneColor} /></div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-gray-600">
              The bar is the share of passes that are doing their job, from{" "}
              <span className="font-mono">queuedWork.progressFor</span> — four discrete positions, nothing
              derived from elapsed time. If it does not move, nothing moved.
            </p>
          </div>

          {readFailed && (
            <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-red-900">
                <ShieldAlert className="h-4 w-4" /> A read failed
              </p>
              <p className="mt-1 text-sm leading-relaxed text-red-800">
                {readError || "A query failed and did not say why."} Everything below may be incomplete —
                treat it as unknown, not as zero.
              </p>
            </div>
          )}
        </header>

        {isLoading && !snap ? (
          <Empty
            title="Reading the system"
            message="Counting rows across the library, shot list, render queue and publishing tables. Nothing is shown until it has actually been measured, so this page stays empty rather than showing placeholder numbers."
          />
        ) : (
          <div className="space-y-6">

            {/* ── 1. IS IT ALIVE? ─────────────────────────────────────── */}
            <Section
              icon={HeartPulse}
              title="Is it alive?"
              blurb={`${roll.headline} A pass that runs every five minutes and has done nothing for a day is the exact failure that hid for weeks — so "ran and had nothing to do" and "has never run" are shown as different things here, because they mean opposite things.`}
            >
              <ul className="space-y-3">
                {passes.map((h) => <PassRow key={h.spec.key} h={h} />)}
              </ul>
              {passes.every((h) => h.state === "never_ran") && (
                <div className="mt-3">
                  <Empty {...emptyState("never_ran", { subject: "every maintenance pass" })} />
                </div>
              )}
            </Section>

            {/* ── 2. THE FUNNEL ───────────────────────────────────────── */}
            <Section
              icon={TrendingDown}
              title="The funnel, with real counts"
              blurb={
                worst
                  ? `The biggest measured drop is into "${worst.spec.label}" — ${worst.note} Steps are grouped by population: a drop is only ever computed between two sets where one genuinely sits inside the other.`
                  : "Each step shows what it lost against its own denominator. A drop is only computed between two sets where one genuinely sits inside the other — shot cards are not a subset of library assets, so no number is invented between them."
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {groups.map((g) => <FunnelGroup key={g.group} group={g.group} rows={g.rows} />)}
              </div>
            </Section>

            {/* ── 3. WHAT IS BLOCKED ──────────────────────────────────── */}
            <Section
              icon={Ban}
              title="What is blocked, and why"
              blurb="One sentence each, with the number it is based on and the next step. A blocker with no next step is a complaint, so there are none of those here."
            >
              {blockersEmpty ? (
                <Empty title={blockersEmpty.title} message={blockersEmpty.message} />
              ) : (
                <ul className="space-y-3">{blockers.map((b) => <BlockerRow key={b.id} b={b} />)}</ul>
              )}
            </Section>

            {/* ── 4. RECENT FAILURES ──────────────────────────────────── */}
            <Section
              icon={AlertTriangle}
              title="Recent failures, in their own words"
              blurb="The exact error text the rows carry. The 401s were recorded on the rows the whole time and nobody could see them; identical errors are grouped so eleven copies of one crash read as one problem, and the newest copy's full text is kept."
            >
              {failureGroups.length ? (
                <ul className="space-y-3">
                  {failureGroups.map((g) => (
                    <li key={g.key} className="rounded-xl border border-gray-200 bg-white p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip color={C.bad} solid>{g.count}×</Chip>
                        <span className="font-mono text-[11px] text-gray-500">{g.where}</span>
                        {g.lastAt && <span className="text-[11px] text-gray-500">last {g.lastAt}</span>}
                        {g.brands.map((b) => <Chip key={b} color={C.idle}>{b}</Chip>)}
                      </div>
                      <p className="mt-2 text-sm font-semibold leading-relaxed text-gray-900">{g.summary}</p>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2.5 text-[11px] leading-relaxed text-gray-700">
                        {g.error}
                      </pre>
                    </li>
                  ))}
                </ul>
              ) : readFailed ? (
                <Empty {...emptyState("unread", { subject: "The failure queues", error: readError })} />
              ) : (
                <Empty
                  {...emptyState("all_clear", {
                    subject: "The render, parse and publish queues",
                    searched: snap?.failures?.length ?? 0,
                  })}
                />
              )}
            </Section>

            {/* ── THE RECEIPTS ────────────────────────────────────────── */}
            <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
              <button
                type="button"
                onClick={() => setShowQueries((v) => !v)}
                className="flex w-full items-center gap-2 text-left text-sm font-bold text-gray-900"
              >
                {showQueries ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <Database className="h-4 w-4" />
                Every query this page ran
              </button>
              <p className="mt-1 pl-6 text-xs leading-relaxed text-gray-600">
                Nothing here is inferred from another number. If a query is not in this list, its number is
                not on this page — it is shown as unknown instead.
              </p>
              {showQueries && (
                <ul className="mt-3 space-y-1.5 pl-6">
                  {[
                    ...FUNNEL.map((s) => snap?.counts?.[s.key]?.query ?? `${s.key} — not measured`),
                    ...PASSES.map((p) => `pass "${p.key}" ran → ${p.marker}`),
                    ...passes.flatMap((h) => [h.backlog.query, h.touched.query]),
                    "video_render_jobs where status='failed' (newest 30, with error text)",
                    "video_parse_jobs where status='failed' (newest 30, with error text)",
                    "agent_social_posts where publish_error is not null (newest 30, with error text)",
                  ]
                    .filter((q, i, all) => q && all.indexOf(q) === i)
                    .map((q) => (
                      <li key={q} className="font-mono text-[11px] leading-relaxed text-gray-600 break-words">
                        {q}
                      </li>
                    ))}
                </ul>
              )}
            </section>

            <p className="flex items-start gap-2 pb-4 text-xs leading-relaxed text-gray-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Read at {new Date(snap?.readAtMs ?? nowMs).toLocaleString()}. This page is read-only: there is
                no button here that re-runs a pass, retries a job or edits a row, because a diagnostic that can
                also change the system is one nobody can trust about the state it just reported.
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
