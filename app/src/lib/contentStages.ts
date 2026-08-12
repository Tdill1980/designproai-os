/**
 * contentStages — the content pipeline stated as an ordered stage model, in the
 * vocabulary the shared control plane already speaks.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * CLAUDE.md's North Star is explicit: "one product-agnostic, self-sustaining
 * SERVER orchestration layer for every tool… Reuse `workforce_runs`,
 * `workforce_events`, `workflow_stage_runs`, leases, fencing, and existing
 * domain tables."
 *
 * That control plane is LIVE. Measured against production 2026-08-07:
 * 5,025 `workforce_runs`, 810 `workforce_events`, 346 `workflow_stage_runs`.
 * The content pipeline uses NONE of the stage kernel. Its only appearance in
 * `workforce_runs` is the legacy LOG shape written by `wpw-workforce-sweep`
 * (modes `transcribe` 1,491 · `orchestrate` 3,034 · `ingest_media` 25), every
 * one of which carries `workflow_type = NULL` — a row that records a sweep
 * happened, with no run envelope, no stages, no leases and no state a UI can
 * read. Only `designpro.entice_pack` (45 runs) and `designpro.production_pack`
 * (1) are real kernel workflows.
 *
 * Every content defect found on 2026-08-07 is a symptom of that one absence:
 * three passes configured but executed by nothing; the container and the
 * Actions workflow disagreeing on pass ORDER; 25 of 25 calls returning 401
 * under a green workflow badge; an admin with "no progress bar, no indication
 * it's done"; a "creative" that was a still image 199 times. None of those are
 * seven bugs. They are one missing layer — there was no registry of work, so
 * nothing could notice.
 *
 * ── WHAT THIS FILE IS, AND IS NOT ──────────────────────────────────────────
 * It is PURE. No Supabase client, no clock, no network, no randomness. Given
 * the same inputs it returns the same objects, which is what makes it testable
 * (`tests/content-control-plane.test.ts`) and what makes it safe to import from
 * both the browser and a test runner.
 *
 * It does NOT execute anything and it changes NO existing pass's behaviour. It
 * is the layer the passes will adopt, added alongside them.
 *
 * It invents NO table. `workforce_runs`, `workforce_events` and
 * `workflow_stage_runs` are the sanctioned three (`SANCTIONED_CONTROL_PLANE_TABLES`),
 * and where the existing schema cannot express something the content pipeline
 * needs, this file says so in a comment rather than proposing a parallel table.
 *
 * ── THE STATE THAT WAS MISSING: BLOCKED ────────────────────────────────────
 * "weprintwraps has 82 clips and zero parsed sources" and "this stage crashed"
 * are DIFFERENT states with DIFFERENT next steps. Collapsing them is how this
 * system hid its own condition for weeks: a pass that found nothing to work on
 * and a pass that died both produced the same thing — silence.
 *
 * So this model carries four dispositions, not two:
 *
 *   complete  the stage did work and verified it
 *   noop      the stage ran, found nothing to do, and that is CORRECT
 *   blocked   a precondition is unmet; there is a named reason and a NEXT STEP
 *             for a human or an upstream stage. Nothing is wrong with the code.
 *   failed    the stage could not run. Retryable or not, an error is recorded.
 *
 * These map onto kernel transitions that already exist (see `kernelTransition`):
 * complete/noop → `complete_workflow_stage`, blocked → `defer_workflow_stage`
 * (which sets `wait_reason`, bumps `deferred_count`, and moves the RUN to
 * `waiting`), failed → `fail_workflow_stage`.
 *
 * ── WHERE THE SCHEMA CANNOT FOLLOW (recorded, not worked around) ───────────
 * 1. `workflow_stage_runs.status` CHECK allows only
 *    pending | running | retryable | completed | failed | skipped | cancelled.
 *    There is no `blocked`. So blocked is durable but never TERMINAL: a
 *    deferred stage returns to `pending` and re-offers itself forever. This
 *    model therefore caps deferrals per stage (`maxDeferrals`) and escalates to
 *    a NON-retryable failure whose `error_code` is prefixed `blocked:` and
 *    whose `error_details.blocked` is true — queryable, and distinguishable
 *    from a crash. A `blocked` status value would be cleaner and would need a
 *    migration.
 * 2. There is no `skip_workflow_stage` RPC. `skipped` is only ever written by
 *    SQL (the `definition_guard` row does it). A worker that legitimately has
 *    nothing to do therefore CANNOT mark itself skipped — which is exactly why
 *    `noop` completes with `verification.nothingToDo = true` instead.
 * 3. `complete_workflow_stage` RAISEs unless `verification @> {"verified":true}`.
 *    A no-op still has to assert `verified: true`; the honesty lives in the
 *    accompanying `nothingToDo` flag, never in a fake claim of work.
 * 4. `claim_workflow_stage` gates a stage on ALL lower-`sequence` stages in the
 *    SAME RUN being completed/skipped. That gate is per-RUN, not per-`scope_key`.
 *    So content fan-out (hundreds of clips) must be ONE RUN PER CONTENT ITEM,
 *    with `scope_key` used only for fan-out INSIDE a single stage. Modelling a
 *    whole brand as one run would serialise the brand behind its slowest clip.
 */

/** The kernel `workforce_runs.workflow_type` for the content pipeline. */
export const CONTENT_WORKFLOW_TYPE = "content.pipeline";

/**
 * Pinned like `designpro.entice_pack.v1`. Bump only alongside a migration that
 * changes the stage list, so in-flight runs stay addressable by status lookups
 * that filter on it.
 *
 * v2 (2026-08-10) adds `plan.direct` at the front and renumbers the rest. The
 * renumber was free: measured against production the same day, `workforce_runs`
 * held ZERO `content.pipeline` rows and `workflow_stage_runs` held zero content
 * stage keys, so there was no in-flight run to strand. Do not assume that again
 * — check before the next renumber.
 */
export const CONTENT_DEFINITION_VERSION = "content.pipeline.v2";

/** `workforce_runs.mode` is NOT NULL; the kernel's value is `workflow`. */
export const CONTENT_RUN_MODE = "workflow";

/** `workforce_runs.domain_job_type` for a content item. */
export const CONTENT_DOMAIN_JOB_TYPE = "agent_social_posts";

/**
 * The ONLY tables this layer may write. Named so a test can assert no parallel
 * job table appeared. (`workflow_resource_leases` also exists and is sanctioned,
 * but it is reached exclusively through `claim/heartbeat/release_workflow_resource_lease`
 * RPCs — no adapter ever selects from it, so it is not on this list.)
 */
export const SANCTIONED_CONTROL_PLANE_TABLES = Object.freeze([
  "workforce_runs",
  "workforce_events",
  "workflow_stage_runs",
] as const);

/** A stage's four possible outcomes. See the header. */
export type StageDisposition = "complete" | "noop" | "blocked" | "failed";

/**
 * A named reason a stage cannot proceed, with the action that unblocks it.
 *
 * The `nextStep` is the whole point. "Blocked" with no next step is just a
 * quieter silence.
 */
export interface BlockedReason {
  /** Stable code, recorded as `wait_reason` on the row. */
  readonly code: string;
  /** What the condition actually is, in one line. */
  readonly meaning: string;
  /** What a human or an upstream stage must do about it. */
  readonly nextStep: string;
}

export interface ContentStage {
  /** `noun.verb`, the convention every existing stage_key follows. */
  readonly key: string;
  /** `workflow_stage_runs.sequence`. Spaced by 10, as DesignPro's are. */
  readonly sequence: number;
  readonly title: string;
  /** What must already exist for this stage to do its work. */
  readonly consumes: readonly string[];
  /** What the stage writes. */
  readonly produces: readonly string[];
  /**
   * Whether running this stage COSTS MONEY. An unattended loop that can spend
   * is the one that needs a cap, a lease and a visible run row — this project
   * has already paid to learn that.
   */
  readonly spends: boolean;
  /** Unit of spend, so a cap can be expressed. `null` when `spends` is false. */
  readonly spendUnit: string | null;
  /**
   * Whether the stage's effect can be taken back. Publishing costs nothing and
   * cannot be undone; that is a different risk from spend and needs its own flag.
   */
  readonly irreversible: boolean;
  /** `workflow_stage_runs.max_attempts`. */
  readonly maxAttempts: number;
  /** Delay handed to `fail_workflow_stage` when a failure is retryable. */
  readonly retryDelaySeconds: number;
  /** Delay handed to `defer_workflow_stage` when the stage is blocked. */
  readonly deferSeconds: number;
  /**
   * How many times a block may be deferred before it escalates to a terminal
   * `blocked:<reason>` failure. `null` = unbounded, which is correct only for a
   * stage whose block is a human queue (see `review.await`).
   */
  readonly maxDeferrals: number | null;
  /** True when the stage completes into `complete_workflow_stage_for_approval`. */
  readonly approvalGate: boolean;
  /**
   * The files that do this work TODAY. An EMPTY array is an honest gap — the
   * stage is real, and nothing implements it. `cut.verify` is empty on purpose:
   * that missing verification is why 199 "creatives" were a still image.
   */
  readonly implementedBy: readonly string[];
  readonly blockedReasons: readonly BlockedReason[];
}

const reason = (code: string, meaning: string, nextStep: string): BlockedReason =>
  Object.freeze({ code, meaning, nextStep });

/**
 * THE CONTENT PIPELINE, IN ORDER.
 *
 * The order is DATA DEPENDENCY, which is what a stage model is for. It is not
 * the order today's executors happen to use: `MAINT_PASSES` runs `tagLibrary`
 * LAST because it is the only pass that buys a model call per item, so a
 * truncated cycle drops the expensive pass rather than the bookkeeping. That is
 * a good cost rule and a bad dependency claim — under this model the same
 * decision is expressed as `enrich.assets.spends = true` plus a cap, and the
 * ordering stops carrying two meanings at once.
 */
export const CONTENT_STAGES: readonly ContentStage[] = Object.freeze([
  Object.freeze({
    key: "plan.direct",
    sequence: 0,
    title: "Direct: the Content Director places the piece in its slot",
    consumes: [
      "cron.job 151 content-director-plan-daily (0 13 * * *)",
      "WEEKLY_PROGRAMMING (the slot grid)",
      "agent_media_assets (the library the director plans from)",
    ],
    produces: [
      "agent_social_posts (draft, created_by = content-director)",
      "agent_social_posts.engagement.director_slot",
    ],
    // The planner's OpenAI call is bought by cron 151 BEFORE this run exists.
    // This stage records that the placement happened and checks it is runnable;
    // it buys nothing itself, and `spends` means "running this stage costs
    // money" — a cap belongs where the charge is, which is the cron.
    spends: false,
    spendUnit: null,
    irreversible: false,
    maxAttempts: 3,
    retryDelaySeconds: 120,
    deferSeconds: 900,
    maxDeferrals: 8,
    approvalGate: false,
    implementedBy: [
      "supabase/functions/marketing-agent (action director_plan_week)",
      "worker/video-renderer/contentOs.js (opens the run and records the placement)",
    ],
    blockedReasons: Object.freeze([
      reason(
        "awaiting_director_plan",
        "The slot has no planned draft yet.",
        "Wait for cron 151 (13:00 UTC daily), or run marketing-agent director_plan_week by hand.",
      ),
      reason(
        "no_media_planned",
        "The director placed the piece but attached no media.",
        "Hydrate the Asset Library for this brand — the planner refuses to invent media, so an empty library plans an empty post.",
      ),
      reason(
        "slot_unknown",
        "The draft carries no director_slot, so no programming slot owns it.",
        "This post did not come from the weekly grid; place it on the grid or run it outside the programming pipeline.",
      ),
    ]),
  }),
  Object.freeze({
    key: "ingest.media",
    sequence: 10,
    title: "Ingest raw source material",
    consumes: ["video_parse_jobs (drive_folder / drive_file / direct URL)"],
    produces: [
      "video_parse_jobs (one drive_file row per media file)",
      "agent_media_assets (photos register directly — a still has no audio)",
    ],
    spends: false,
    spendUnit: null,
    irreversible: false,
    maxAttempts: 5,
    retryDelaySeconds: 60,
    deferSeconds: 300,
    maxDeferrals: 12,
    approvalGate: false,
    implementedBy: ["worker/media-parser/index.js"],
    blockedReasons: Object.freeze([
      reason(
        "no_ingest_source",
        "No parse job is queued for this item.",
        "Queue a Drive link or upload in the Asset Library; nothing is wrong with the pipeline.",
      ),
      reason(
        "source_unreachable",
        "The Drive folder or URL did not resolve to any media file.",
        "Re-share the folder publicly or supply a direct media URL.",
      ),
    ]),
  }),
  Object.freeze({
    key: "parse.media",
    sequence: 20,
    title: "Parse: transcript and observations",
    consumes: ["video_parse_jobs (claimed drive_file rows)"],
    produces: [
      "media_sources",
      "content_moments",
      "agent_media_assets.transcript",
    ],
    // Whisper minutes plus the audio extraction/storage behind them.
    spends: true,
    spendUnit: "whisper_minutes",
    irreversible: false,
    maxAttempts: 5,
    retryDelaySeconds: 120,
    deferSeconds: 300,
    maxDeferrals: 12,
    approvalGate: false,
    implementedBy: [
      "worker/media-parser/index.js",
      "supabase/functions/wpw-workforce-sweep (mode:transcribe)",
    ],
    blockedReasons: Object.freeze([
      reason(
        "no_media_to_parse",
        "Ingest produced no file this stage can open.",
        "Check ingest.media's output for this item before touching the parser.",
      ),
      reason(
        "parser_offline",
        "No executor claimed a parse job inside the expected window.",
        "Confirm the media-parser executor is running (container MAINT_ENABLED, or the Actions schedule).",
      ),
    ]),
  }),
  Object.freeze({
    key: "classify.assets",
    sequence: 30,
    title: "Classify: the one taxonomy",
    consumes: [
      "agent_media_assets.source_folder",
      "agent_media_assets.tags (optional)",
      "agent_media_assets.original_filename",
      "agent_media_assets.transcript (optional)",
    ],
    produces: ["agent_media_assets.content_type"],
    spends: false,
    spendUnit: null,
    irreversible: false,
    maxAttempts: 3,
    retryDelaySeconds: 60,
    deferSeconds: 300,
    maxDeferrals: 6,
    approvalGate: false,
    implementedBy: [
      "worker/video-renderer/classify.js",
      "src/lib/assetContentType.ts (the ONE classifier)",
    ],
    // NOTE ON THE APPARENT CYCLE: this stage reads `tags`, which `enrich.assets`
    // (sequence 30) writes. It is not a real cycle — `classifyAsset` is
    // keyword-deterministic over folder path → tags → filename → transcript IN
    // THAT ORDER and returns an honest `unclassified` when nothing matches, so a
    // missing tag degrades the answer rather than blocking it, and the next
    // cycle re-opens the row. Tags are listed as OPTIONAL above for that reason.
    blockedReasons: Object.freeze([
      reason(
        "no_classifiable_assets",
        "Every asset in scope already carries a content_type.",
        "Nothing to do — this is a no-op, not a block, unless assets are missing entirely.",
      ),
    ]),
  }),
  Object.freeze({
    key: "enrich.assets",
    sequence: 40,
    title: "Enrich: move earned evidence onto the asset rows",
    consumes: [
      "content_moments",
      "media_sources",
      "agent_media_assets (untagged rows)",
    ],
    produces: [
      "agent_media_assets.visual_tags",
      "agent_media_assets.tags (machine tags)",
    ],
    // Two halves with different costs. The join from content_moments is FREE
    // (intelligence.js — pure data movement). The vision pass is NOT
    // (tagLibrary.js buys one model call per clip). The stage declares `spends`
    // because the expensive half is inside it; a cap belongs here.
    spends: true,
    spendUnit: "vision_calls",
    irreversible: false,
    maxAttempts: 3,
    retryDelaySeconds: 120,
    deferSeconds: 600,
    maxDeferrals: 6,
    approvalGate: false,
    implementedBy: [
      "worker/video-renderer/intelligence.js",
      "worker/video-renderer/tagLibrary.js",
    ],
    blockedReasons: Object.freeze([
      reason(
        "no_parsed_sources",
        "This brand has clips but no parsed sources, so there is no evidence to move.",
        "Run parse.media for the brand's clips first — the enrichment is a join, not a producer.",
      ),
    ]),
  }),
  Object.freeze({
    key: "brief.compose",
    sequence: 50,
    title: "Plan: show format, footage match, editor brief",
    consumes: [
      "agent_social_posts (drafts with no creative)",
      "agent_media_assets (content_type, tags, visual_tags)",
      "content_moments (beats)",
      "src/lib/showFormats.ts (declared shows)",
    ],
    produces: [
      "video_render_jobs.blueprint.editor_brain",
      "video_render_jobs.blueprint.scenes",
    ],
    // One `editor-brain` call per idea.
    spends: true,
    spendUnit: "model_calls",
    irreversible: false,
    maxAttempts: 3,
    retryDelaySeconds: 120,
    deferSeconds: 900,
    maxDeferrals: 8,
    approvalGate: false,
    implementedBy: ["worker/video-renderer/contentRunner.js"],
    blockedReasons: Object.freeze([
      reason(
        "needs_footage",
        "No clip in the library matches this idea's terms.",
        "Upload or ingest footage for the topic — the pass refuses to attach an unrelated clip.",
      ),
      reason(
        "no_show_format",
        "The evidence on the rows does not support any show this brand declares.",
        "Classify/enrich the brand's footage, or declare a format the evidence can satisfy.",
      ),
      reason(
        "brain_unavailable",
        "editor-brain did not answer (network, timeout, or refusal).",
        "Check the edge function; the pass must not be allowed to queue a stub in its place.",
      ),
    ]),
  }),
  Object.freeze({
    key: "cut.render",
    sequence: 60,
    title: "Cut: render the edit and attach it to its idea",
    consumes: ["video_render_jobs (queued, with a blueprint)"],
    produces: [
      "video_render_jobs.output (the file)",
      "agent_social_posts.media_urls",
      "content_narratives / content_artifacts",
    ],
    spends: true,
    spendUnit: "render_jobs",
    irreversible: false,
    maxAttempts: 3,
    retryDelaySeconds: 120,
    // A real compose takes minutes. `render_in_progress` is the normal state,
    // not an error — this is the exact condition reattach.js was written for.
    deferSeconds: 120,
    maxDeferrals: 60,
    approvalGate: false,
    implementedBy: [
      "worker/video-renderer/index.js",
      "worker/video-renderer/reattach.js",
      "worker/video-renderer/spine.js",
    ],
    blockedReasons: Object.freeze([
      reason(
        "render_in_progress",
        "The render job exists and has not finished yet.",
        "Wait. This is the normal path for any cut longer than a few seconds.",
      ),
      reason(
        "renderer_unreachable",
        "No render executor claimed the job.",
        "Confirm the renderer is up and RENDER_WORKER_URL is set for the caller.",
      ),
    ]),
  }),
  Object.freeze({
    key: "cut.verify",
    sequence: 70,
    title: "Verify: the output honours its contract",
    consumes: [
      "video_render_jobs.output",
      "video_render_jobs.blueprint (scenes, edit_kind, durations)",
    ],
    produces: ["workflow_stage_runs.verification (the output verdict)"],
    spends: false,
    spendUnit: null,
    irreversible: false,
    // Not retryable in practice: the same blueprint deterministically produces
    // the same output, so a violation needs an upstream change, not a retry.
    maxAttempts: 2,
    retryDelaySeconds: 60,
    deferSeconds: 120,
    maxDeferrals: 30,
    approvalGate: false,
    // THIS WAS DELIBERATELY EMPTY until 2026-08-10, and the emptiness was the
    // point: nothing verified render output, which is why every
    // `make_creative_*` job carried `scenes.length === 1`, `kind:"static_post"`,
    // `totalDuration: 0` — a still image called a creative, 199 times, with
    // nobody told.
    //
    // `contentOs.js` now checks the output against the blueprint that ordered
    // it: a finished file must exist, and a piece the blueprint calls a CUT
    // must not come back as a zero-duration single-scene still. That is the
    // exact 199-still failure and nothing wider — it is a contract check, not
    // a quality judgement, and it must never be softened into "a file exists".
    implementedBy: Object.freeze([
      "worker/video-renderer/contentOs.js (verifyCut — output vs. blueprint contract)",
    ]),
    blockedReasons: Object.freeze([
      reason(
        "render_not_finished",
        "There is no finished output to verify yet.",
        "Wait for cut.render; verifying a partial file would produce a fake verdict.",
      ),
    ]),
  }),
  Object.freeze({
    key: "review.await",
    sequence: 80,
    title: "Review: a human approves the cut",
    consumes: ["agent_social_posts (verified creative attached)"],
    produces: ["agent_social_posts.status (approved | rejected)"],
    spends: false,
    spendUnit: null,
    irreversible: false,
    maxAttempts: 3,
    retryDelaySeconds: 300,
    deferSeconds: 3600,
    // UNBOUNDED ON PURPOSE. A human queue is not a stuck stage, and escalating
    // "nobody has looked yet" into a failure would turn the review board into a
    // source of false alarms. This is the one stage where a block can wait
    // forever, and it is visible the whole time as run status `waiting`.
    maxDeferrals: null,
    approvalGate: true,
    implementedBy: ["src/pages/AdminBrandBoard.tsx (approval board)"],
    blockedReasons: Object.freeze([
      reason(
        "awaiting_human_review",
        "The cut is finished and waiting for a person.",
        "Approve or reject it on the Brand Board. Nothing is wrong.",
      ),
    ]),
  }),
  Object.freeze({
    key: "publish.deploy",
    sequence: 90,
    title: "Publish: the approved piece goes out",
    consumes: ["agent_social_posts (approved / scheduled)"],
    produces: [
      "agent_social_posts.status = published",
      "social_post_metrics",
      "agent_ad_campaigns (pending_review, budget 0)",
    ],
    // Publishing itself buys nothing — but it CANNOT BE TAKEN BACK, which is a
    // different risk and gets its own flag rather than being smuggled in as
    // "spend". promote.js stays at budget 0 by design: no loop may raise spend.
    spends: false,
    spendUnit: null,
    irreversible: true,
    maxAttempts: 3,
    retryDelaySeconds: 300,
    deferSeconds: 600,
    maxDeferrals: 24,
    approvalGate: false,
    implementedBy: [
      "supabase/functions/content-deploy (pg_cron)",
      "worker/video-renderer/promote.js",
    ],
    blockedReasons: Object.freeze([
      reason(
        "not_approved",
        "The piece has not been approved by a human.",
        "Approve it first — this stage must never publish on its own authority.",
      ),
      reason(
        "scheduled_for_later",
        "Approved, with a scheduled date in the future.",
        "Wait for the scheduled time.",
      ),
    ]),
  }),
] as const);

/** Stage keys in execution order. */
export const CONTENT_STAGE_KEYS: readonly string[] = Object.freeze(
  CONTENT_STAGES.map((stage) => stage.key),
);

const STAGE_BY_KEY: ReadonlyMap<string, ContentStage> = new Map(
  CONTENT_STAGES.map((stage) => [stage.key, stage] as const),
);

/** The stage descriptor, or `null` for a key this build does not know. */
export function contentStage(stageKey: string): ContentStage | null {
  return STAGE_BY_KEY.get(String(stageKey || "")) ?? null;
}

export function isContentStageKey(stageKey: string): boolean {
  return STAGE_BY_KEY.has(String(stageKey || ""));
}

/**
 * `workflow_stage_runs.idempotency_key`, following the DesignPro convention
 * (`v_run.id::text || ':' || stage_key`) and extending it with `scope_key` for
 * fan-out inside one stage. The table's UNIQUE (run_id, idempotency_key) and
 * UNIQUE (run_id, stage_key, scope_key) both hold as a result.
 */
export function contentStageIdempotencyKey(
  runId: string,
  stageKey: string,
  scopeKey = "",
): string {
  const scope = String(scopeKey || "");
  return scope ? `${runId}:${stageKey}:${scope}` : `${runId}:${stageKey}`;
}

/** Tenant key convention. DesignPro uses `user:<uuid>`; content is per brand. */
export function contentTenantKey(brand: string): string {
  return `brand:${String(brand || "").trim().toLowerCase()}`;
}

export interface ContentRunSeed {
  readonly mode: string;
  readonly workflow_type: string;
  readonly tenant_key: string;
  readonly domain_job_type: string;
  readonly domain_job_id: string;
  readonly workflow_status: "queued";
  readonly idempotency_key: string;
  readonly requested_by: string | null;
  readonly input_hash: string | null;
  readonly results: Record<string, unknown>;
  readonly sends_enabled: false;
  readonly dry_run: boolean;
}

/**
 * The `workforce_runs` row for one content item. Plain data — the caller does
 * the insert, exactly as `enqueue_designpro_entice_pack` does it in SQL.
 *
 * `mode` is `workflow` (NOT NULL on the table, and the value the kernel's own
 * runs use), which is also what separates a real run from the 4,552 legacy
 * sweep-log rows that carry `workflow_type = NULL`.
 */
export function buildContentRunSeed(input: {
  brand: string;
  postId: string;
  idempotencyKey: string;
  requestedBy?: string | null;
  inputHash?: string | null;
  results?: Record<string, unknown>;
  dryRun?: boolean;
}): ContentRunSeed {
  return Object.freeze({
    mode: CONTENT_RUN_MODE,
    workflow_type: CONTENT_WORKFLOW_TYPE,
    tenant_key: contentTenantKey(input.brand),
    domain_job_type: CONTENT_DOMAIN_JOB_TYPE,
    domain_job_id: input.postId,
    workflow_status: "queued" as const,
    idempotency_key: input.idempotencyKey,
    requested_by: input.requestedBy ?? null,
    input_hash: input.inputHash ?? null,
    results: Object.freeze({
      definition_version: CONTENT_DEFINITION_VERSION,
      brand: input.brand,
      post_id: input.postId,
      ...(input.results || {}),
    }) as Record<string, unknown>,
    sends_enabled: false as const,
    dry_run: Boolean(input.dryRun),
  });
}

export interface ContentStageSeed {
  readonly run_id: string;
  readonly stage_key: string;
  readonly scope_key: string;
  readonly sequence: number;
  readonly status: "pending";
  readonly idempotency_key: string;
  readonly input_hash: string | null;
  readonly input: Record<string, unknown>;
  readonly max_attempts: number;
}

/** The full ordered set of `workflow_stage_runs` rows for one content run. */
export function buildContentStageSeeds(input: {
  runId: string;
  inputHash?: string | null;
  input?: Record<string, unknown>;
}): readonly ContentStageSeed[] {
  const base = input.input || {};
  return Object.freeze(
    CONTENT_STAGES.map((stage) =>
      Object.freeze({
        run_id: input.runId,
        stage_key: stage.key,
        scope_key: "",
        sequence: stage.sequence,
        status: "pending" as const,
        idempotency_key: contentStageIdempotencyKey(input.runId, stage.key),
        input_hash: input.inputHash ?? null,
        input: Object.freeze({ ...base }) as Record<string, unknown>,
        max_attempts: stage.maxAttempts,
      }),
    ),
  );
}

// ── Outcomes ────────────────────────────────────────────────────────────────

export interface CompleteOutcome {
  readonly disposition: "complete";
  readonly stageKey: string;
  readonly output: Record<string, unknown>;
  readonly verification: Record<string, unknown>;
  readonly outputHash: string | null;
}

export interface NoopOutcome {
  readonly disposition: "noop";
  readonly stageKey: string;
  readonly output: Record<string, unknown>;
  readonly verification: Record<string, unknown>;
  readonly outputHash: string | null;
  readonly note: string;
}

export interface BlockedOutcome {
  readonly disposition: "blocked";
  readonly stageKey: string;
  readonly reasonCode: string;
  readonly meaning: string;
  readonly nextStep: string;
  readonly delaySeconds: number;
  readonly maxDeferrals: number | null;
  readonly details: Record<string, unknown>;
}

export interface FailedOutcome {
  readonly disposition: "failed";
  readonly stageKey: string;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly retryDelaySeconds: number;
  readonly details: Record<string, unknown>;
}

export type StageOutcome =
  | CompleteOutcome
  | NoopOutcome
  | BlockedOutcome
  | FailedOutcome;

/** The stage did work, and the evidence is attached. */
export function completeStage(
  stageKey: string,
  output: Record<string, unknown> = {},
  verification: Record<string, unknown> = {},
  outputHash: string | null = null,
): CompleteOutcome {
  return Object.freeze({
    disposition: "complete" as const,
    stageKey,
    output: Object.freeze({ ...output }) as Record<string, unknown>,
    // `verified: true` is REQUIRED by complete_workflow_stage — it RAISEs
    // without it. Everything else the caller supplies rides alongside.
    verification: Object.freeze({
      ...verification,
      verified: true,
      nothingToDo: false,
    }) as Record<string, unknown>,
    outputHash,
  });
}

/**
 * The stage ran correctly and there was nothing to do.
 *
 * It still completes — there is no `skip_workflow_stage` RPC — but it says so,
 * so "found no work" can never again be mistaken for "did the work".
 */
export function noopStage(
  stageKey: string,
  note: string,
  output: Record<string, unknown> = {},
): NoopOutcome {
  return Object.freeze({
    disposition: "noop" as const,
    stageKey,
    output: Object.freeze({ ...output, nothingToDo: true }) as Record<string, unknown>,
    verification: Object.freeze({
      verified: true,
      nothingToDo: true,
      note,
    }) as Record<string, unknown>,
    outputHash: null,
    note,
  });
}

/**
 * A precondition is unmet. NOT a failure.
 *
 * The reason must be one this stage DECLARES. An undeclared reason is itself a
 * defect — but it returns a failed outcome rather than throwing, because a throw
 * inside a worker loop is how one bad branch stops every other stage.
 */
export function blockStage(
  stageKey: string,
  reasonCode: string,
  details: Record<string, unknown> = {},
): BlockedOutcome | FailedOutcome {
  const stage = contentStage(stageKey);
  if (!stage) return unknownStage(stageKey);
  const declared = stage.blockedReasons.find((item) => item.code === reasonCode);
  if (!declared) {
    return Object.freeze({
      disposition: "failed" as const,
      stageKey,
      code: "undeclared_block_reason",
      message:
        `Stage ${stageKey} reported block reason "${reasonCode}", which it does not declare. ` +
        `Declared: ${stage.blockedReasons.map((item) => item.code).join(", ") || "(none)"}.`,
      retryable: false,
      retryDelaySeconds: 0,
      details: Object.freeze({ ...details, reasonCode }) as Record<string, unknown>,
    });
  }
  return Object.freeze({
    disposition: "blocked" as const,
    stageKey,
    reasonCode: declared.code,
    meaning: declared.meaning,
    nextStep: declared.nextStep,
    delaySeconds: stage.deferSeconds,
    maxDeferrals: stage.maxDeferrals,
    details: Object.freeze({
      ...details,
      meaning: declared.meaning,
      nextStep: declared.nextStep,
    }) as Record<string, unknown>,
  });
}

/** The stage could not run. */
export function failStage(
  stageKey: string,
  code: string,
  message: string,
  options: {
    retryable?: boolean;
    retryDelaySeconds?: number;
    details?: Record<string, unknown>;
  } = {},
): FailedOutcome {
  const stage = contentStage(stageKey);
  return Object.freeze({
    disposition: "failed" as const,
    stageKey,
    code,
    message,
    retryable: options.retryable !== false,
    retryDelaySeconds:
      options.retryDelaySeconds ?? stage?.retryDelaySeconds ?? 60,
    details: Object.freeze({ ...(options.details || {}) }) as Record<string, unknown>,
  });
}

/**
 * A stage_key this build has never heard of.
 *
 * RETRYABLE ON PURPOSE, and for the reason CLAUDE.md already records for
 * `unknown_entice_stage`: migrations apply the moment a PR merges while an
 * executor takes minutes to roll, so a new stage_key opens a window where the
 * database schedules work the running code does not know. As a hard failure
 * that window killed the first item submitted inside it, permanently, on a
 * stage that would have been valid ninety seconds later. Waiting is strictly
 * better — a genuinely unknown key still fails, it just exhausts its attempts
 * first and costs minutes instead of a customer's work.
 *
 * The durable rule still stands: ship the runner in an EARLIER PR than the
 * migration that schedules its stage. This is the net, not a licence.
 */
export function unknownStage(
  stageKey: string,
  details: Record<string, unknown> = {},
): FailedOutcome {
  return Object.freeze({
    disposition: "failed" as const,
    stageKey,
    code: "unknown_content_stage",
    message:
      `Unknown content stage ${stageKey} — this executor may predate the migration ` +
      `that scheduled it; retrying while the deploy rolls`,
    retryable: true,
    retryDelaySeconds: 60,
    details: Object.freeze({
      ...details,
      stageKey,
      knownStages: CONTENT_STAGE_KEYS,
    }) as Record<string, unknown>,
  });
}

// ── Kernel transitions ──────────────────────────────────────────────────────

export type KernelRpc =
  | "complete_workflow_stage"
  | "complete_workflow_stage_for_approval"
  | "defer_workflow_stage"
  | "fail_workflow_stage";

export interface KernelTransition {
  readonly rpc: KernelRpc;
  /** RPC arguments MINUS `p_stage_id` / `p_lease_token`, which the adapter owns. */
  readonly args: Record<string, unknown>;
  /** Row status this transition lands on. */
  readonly resultingStatus:
    | "completed"
    | "pending"
    | "retryable"
    | "failed";
  /** Whether this is the end of the road for the stage. */
  readonly terminal: boolean;
  /** What happens next, in one line, for a human reading a dashboard. */
  readonly nextStep: string;
}

/**
 * Map an outcome onto the kernel RPC that records it.
 *
 * PURE and deterministic: the deferral escalation depends only on the
 * `deferredCount` the caller passes (read off the row), never on a clock.
 */
export function kernelTransition(
  outcome: StageOutcome,
  context: { deferredCount?: number; attempt?: number; maxAttempts?: number } = {},
): KernelTransition {
  const stage = contentStage(outcome.stageKey);

  if (outcome.disposition === "complete" || outcome.disposition === "noop") {
    const approval = Boolean(stage?.approvalGate);
    return Object.freeze({
      rpc: (approval
        ? "complete_workflow_stage_for_approval"
        : "complete_workflow_stage") as KernelRpc,
      args: Object.freeze({
        p_output: outcome.output,
        p_verification: outcome.verification,
        p_output_hash: outcome.outputHash,
      }) as Record<string, unknown>,
      resultingStatus: "completed" as const,
      terminal: true,
      nextStep:
        outcome.disposition === "noop"
          ? "Nothing to do; the run advances to the next stage."
          : "The run advances to the next stage.",
    });
  }

  if (outcome.disposition === "blocked") {
    const deferred = Number(context.deferredCount || 0);
    const cap = outcome.maxDeferrals;
    const exhausted = cap !== null && deferred >= cap;
    if (!exhausted) {
      return Object.freeze({
        rpc: "defer_workflow_stage" as KernelRpc,
        args: Object.freeze({
          p_delay_seconds: outcome.delaySeconds,
          p_reason: outcome.reasonCode,
          p_details: outcome.details,
        }) as Record<string, unknown>,
        // defer_workflow_stage returns the row to `pending` and DECREMENTS
        // attempt, so waiting never consumes a retry. That is why the cap above
        // exists at all — nothing else would ever stop the waiting.
        resultingStatus: "pending" as const,
        terminal: false,
        nextStep: outcome.nextStep,
      });
    }
    // Terminal block. `status` has no `blocked` value (see the header), so the
    // honest encoding is a non-retryable failure whose code says `blocked:` and
    // whose details flag it — queryable, and never confusable with a crash.
    return Object.freeze({
      rpc: "fail_workflow_stage" as KernelRpc,
      args: Object.freeze({
        p_error_code: `blocked:${outcome.reasonCode}`,
        p_error_message: `${outcome.meaning} ${outcome.nextStep}`,
        p_error_details: Object.freeze({
          ...outcome.details,
          blocked: true,
          reasonCode: outcome.reasonCode,
          deferredCount: deferred,
          maxDeferrals: cap,
        }),
        p_retryable: false,
        p_retry_delay_seconds: 0,
      }) as Record<string, unknown>,
      resultingStatus: "failed" as const,
      terminal: true,
      nextStep: outcome.nextStep,
    });
  }

  const attempt = Number(context.attempt || 0);
  const maxAttempts = Number(
    context.maxAttempts || stage?.maxAttempts || 3,
  );
  const willRetry = outcome.retryable && attempt < maxAttempts;
  return Object.freeze({
    rpc: "fail_workflow_stage" as KernelRpc,
    args: Object.freeze({
      p_error_code: outcome.code,
      p_error_message: outcome.message,
      p_error_details: outcome.details,
      p_retryable: outcome.retryable,
      p_retry_delay_seconds: outcome.retryDelaySeconds,
    }) as Record<string, unknown>,
    resultingStatus: (willRetry ? "retryable" : "failed") as
      | "retryable"
      | "failed",
    terminal: !willRetry,
    nextStep: willRetry
      ? `Retrying in ${outcome.retryDelaySeconds}s (attempt ${attempt + 1}/${maxAttempts}).`
      : `Stage failed: ${outcome.code}. A human must look at the error on the row.`,
  });
}

/**
 * Whether an outcome ends the stage. `blocked` is the interesting one: it is
 * terminal only once its deferral cap is spent.
 */
export function isTerminalOutcome(
  outcome: StageOutcome,
  context: { deferredCount?: number; attempt?: number; maxAttempts?: number } = {},
): boolean {
  return kernelTransition(outcome, context).terminal;
}
