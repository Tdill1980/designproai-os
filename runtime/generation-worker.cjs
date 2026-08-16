"use strict";

/**
 * Calls 1-7 request worker — the seam that was missing.
 *
 * generation-engine.cjs knows how to run one slot to a decision.
 * generation-store.cjs knows how to persist it. generation-provider.cjs knows
 * how to call Gemini. Nothing connected them to the request queue, so
 * /api/generation/requests recorded a request that no process ever executed and
 * the four modules were unreachable from index.js. This is that connection.
 *
 * The loop is deliberately narrow:
 *
 *   claim one request -> run its seven slots -> complete, or fail it
 *
 * It claims at most one request at a time per worker. Two runtimes therefore
 * process two requests, never the same one twice: claim_designpro_generation_request
 * takes a row lease, and each slot takes its own lease underneath it, so an
 * interrupted worker resumes the exact slot it lost rather than regenerating
 * accepted work.
 *
 * Nothing here retries on its own beyond the engine's literal ceiling. A failed
 * request is reported to the database and left alone.
 */

const { createHash } = require("node:crypto");
const engine = require("./generation-engine.cjs");
const angles = require("./view-angles.cjs");
const prompts = require("./design-prompt-os.cjs");
const { createProvider } = require("./generation-provider.cjs");
const { BUCKET, createGenerationStore } = require("./generation-store.cjs");
const { authorCreativeInput } = require("./creative-authoring.cjs");
const { expectedSurfacesFromRow, resolveOrQueueUniversalDimensions } = require("./genie-universal-resolver.cjs");

const RECEIPT_CONTRACT = "designpro.calls-1-7-receipt.v1";
const REQUEST_LEASE_SECONDS = 900;
const HEARTBEAT_MS = 120_000;
const POLL_MS = 5_000;

/**
 * Prompt parts for one slot.
 *
 * The gateway forbids the client from sending prompt, model, seed or camera
 * angle -- those are server-owned -- so the whole prompt is assembled here from
 * the descriptive fields the contract does allow, plus the frozen camera and
 * design contracts. design-prompt-os owns the wording; this function owns only
 * which contract a slot gets.
 *
 * The instruction is what "generate this angle again, but bolder" becomes once
 * that capability is server-owned. regenerate_designpro_generation_slot stores
 * it on the slot; the browser never sends it, so the prompt stays server-owned
 * while the operator keeps the control.
 */
function promptPartsFor(input, sourceViewType, instruction = "", reproduction = {}) {
  // Throws if the passenger angle ever loses its text-direction guard, which is
  // the defect this whole view contract exists to prevent.
  angles.assertTextDirectionGuard(sourceViewType);
  return prompts.promptPartsFor({
    input,
    sourceViewType,
    instruction,
    heroReference: reproduction.heroReference || null,
    designAnchorText: reproduction.designAnchorText || "",
  });
}

const MIME_EXTENSION = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" });

/**
 * The revision this generation hands over to, derived from the request.
 *
 * Deterministic on purpose: a worker that copies four of seven objects and dies
 * resumes into the same revision and finishes, instead of stranding half a
 * revision and starting another.
 */
function handoffRevisionId(requestId) {
  const hash = createHash("sha256").update(`designpro.calls-1-7.handoff:${requestId}`).digest("hex");
  return [
    hash.slice(0, 8), hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    ((parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join("-");
}

/**
 * Copy the accepted views into the revision input paths Calls 8+ reads.
 *
 * The bytes are identical, so the content hash is unchanged and the destination
 * is exactly what validateAssetIdentity recomputes:
 *   users/<ownerId>/revisions/<revisionId>/inputs/<role>/<hash>.<ext>
 *
 * A copy rather than a move: the generation path stays as the immutable record
 * of what the engine produced, and re-running is idempotent.
 */
async function placeRevisionSources({ supabase, ownerId, revisionId, views }) {
  const placed = {};
  for (const view of views) {
    const extension = MIME_EXTENSION[view.contentType];
    if (!extension) throw new Error(`handoff_content_type_invalid: ${view.contentType}`);
    const destination = `users/${ownerId}/revisions/${revisionId}/inputs/${view.consumerRole}/${view.contentHash}.${extension}`;
    const { error } = await supabase.storage.from(BUCKET).copy(view.storagePath, destination);
    if (error && !/exists|duplicate|conflict/i.test(String(error.message))) {
      throw new Error(`handoff_copy_failed for ${view.consumerRole}: ${error.message}`);
    }
    placed[view.consumerRole] = {
      storagePath: destination, contentHash: view.contentHash,
      byteSize: view.byteSize, contentType: view.contentType,
    };
  }
  return placed;
}

/**
 * The view plan, hero first — identities only, no prompts.
 *
 * Deliberately separate from slot assembly. runRequest executes slots in order
 * and the six reproduction slots need the accepted hero as a prompt part, so
 * the whole plan cannot be assembled up front; only its ORDER can. The hero is
 * hoisted to the front of whatever plan the claim carried rather than trusted
 * to arrive there.
 */
function planFrom(viewPlan) {
  const entries = Array.isArray(viewPlan) && viewPlan.length
    ? viewPlan
    : angles.viewOrder().map((sourceViewType) => ({ sourceViewType }));
  const byView = new Map(entries.map((entry) => [entry.sourceViewType, entry]));
  return angles.heroFirstOrder(entries.map((entry) => entry.sourceViewType)).map((sourceViewType) => ({
    sourceViewType,
    consumerRole: byView.get(sourceViewType)?.consumerRole,
  }));
}

/**
 * Assemble runnable slots for one phase of the plan.
 *
 * A reproduction view assembled without `reproduction.heroReference` throws
 * rather than degrading to a text-only prompt — a silent degrade there is a
 * seventh independent invention wearing the right camera angle.
 */
function slotsFrom(viewPlan, input, instructions = {}, reproduction = {}) {
  return planFrom(viewPlan).map((entry) => ({
    sourceViewType: entry.sourceViewType,
    consumerRole: entry.consumerRole,
    promptParts: promptPartsFor(input, entry.sourceViewType, instructions[entry.sourceViewType], reproduction),
    aspectRatio: angles.aspectRatio(entry.sourceViewType),
    imageSize: angles.resolutionTier(entry.sourceViewType),
  }));
}

/**
 * Run the hero, then reproduce it onto the other six.
 *
 * TWO PHASES, NOT ONE LOOP, and the split is load-bearing: the six reproduction
 * prompts cannot be assembled until the hero exists, because the hero image
 * itself is one of their prompt parts. Running all seven from one pre-built
 * plan is exactly what made every view an independent invention.
 *
 * The engine is untouched. Each phase is its own bounded runRequest, so the
 * per-slot attempt ceiling, the leases and the crash-resume path all behave as
 * before; a resumed worker whose hero is already accepted pays for one storage
 * read instead of a regeneration.
 *
 * Module-level and dependency-injected rather than closed over the worker, so
 * the ordering guarantee this function exists to provide is testable without a
 * live Supabase project.
 */
async function runSevenSlots({ claim, instructions = {}, provider, store, readBytes, runner = engine.runRequest, log = () => {} }) {
  const base = {
    requestId: claim.requestId,
    generationId: claim.generationId,
    tenantKey: claim.tenantKey,
    provider,
    store,
  };
  const plan = planFrom(claim.viewPlan);
  const heroView = plan.find((entry) => angles.originatesDesign(entry.sourceViewType));
  const reproductionViews = plan.filter((entry) => angles.reproducesHero(entry.sourceViewType));

  // A plan without the hero cannot reproduce anything. Say so rather than
  // quietly letting six slots invent six wraps.
  if (!heroView) {
    throw Object.assign(new Error("the slot plan carries no hero view to originate the design"), {
      code: "generation_hero_slot_missing",
    });
  }

  log(`hero ${heroView.sourceViewType} originating the design`);
  const heroRun = await runner({ ...base, slots: slotsFrom([heroView], claim.input, instructions) });
  // A hero that did not land is a design that does not exist. The six views
  // stop here rather than each inventing a replacement for it.
  if (heroRun.state !== "outputs_ready") return { ...heroRun, results: [...heroRun.results] };

  // The accepted hero's own bytes -- not a resized copy. This runtime has real
  // memory, so the reference the model reads is the full-resolution render.
  const heroWinner = heroRun.results[0]?.winner;
  const heroBytes = await readBytes(heroWinner.storage_path || heroWinner.storagePath);
  const heroReference = {
    bytes: heroBytes,
    contentType: heroWinner.content_type || heroWinner.contentType || "image/png",
  };

  // One analysis of the hero, reused by all six. Non-fatal: a missing anchor
  // weakens continuity, a failed request produces nothing.
  const designAnchorText = await prompts.buildDesignAnchor({
    provider,
    heroBytes,
    contentType: heroReference.contentType,
    logger: log,
  });

  const reproductionRun = reproductionViews.length
    ? await runner({
      ...base,
      slots: slotsFrom(reproductionViews, claim.input, instructions, { heroReference, designAnchorText }),
    })
    : { state: "outputs_ready", providerCalls: 0, results: [] };

  const results = [...heroRun.results, ...reproductionRun.results];
  const failed = results.filter((item) => item.state === "failed");
  return {
    contract: engine.ENGINE_CONTRACT,
    state: failed.length ? "failed" : "outputs_ready",
    providerCalls: heroRun.providerCalls + reproductionRun.providerCalls,
    results,
    requiresExplicitResume: failed.length > 0,
    designAnchored: Boolean(designAnchorText),
    heroContentHash: heroWinner.content_hash || heroWinner.contentHash || null,
  };
}

function createGenerationWorker({ supabase, workerId, provider, intervalMs = POLL_MS }) {
  if (!supabase) throw new Error("generation worker requires a Supabase client");
  const store = createGenerationStore({ supabase, workerId });
  // Constructed once so per-key health and cooldown persist across requests
  // rather than resetting on every claim.
  const imageProvider = provider || createProvider({});

  let timer = null;
  let busy = false;
  let stopped = false;

  async function rpc(name, args) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(`${name} failed: ${error.message}`);
    return data;
  }

  /** The exact bytes behind an accepted slot, read back from the bucket. */
  async function storageBytes(storagePath) {
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) throw new Error(`hero reference download failed: ${error?.message || "empty"}`);
    return Buffer.from(await data.arrayBuffer());
  }

  /** The seven persisted rows, in the exact shape completion validates. */
  async function viewsPayload(requestId) {
    const { data, error } = await supabase
      .from("designpro_generation_views")
      .select("source_view_type,consumer_role,storage_path,content_hash,byte_size,content_type,metadata")
      .eq("request_id", requestId).is("superseded_at", null);
    if (error) throw new Error(`generation view readback failed: ${error.message}`);
    return (data || []).map((row) => ({
      sourceViewType: row.source_view_type,
      consumerRole: row.consumer_role,
      storagePath: row.storage_path,
      contentHash: row.content_hash,
      byteSize: Number(row.byte_size),
      contentType: row.content_type,
      metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    }));
  }

  async function processClaim(claim) {
    const requestId = claim.requestId;
    const claimToken = claim.claimToken;
    const heartbeat = setInterval(() => {
      void rpc("heartbeat_designpro_generation_request", {
        p_request_id: requestId, p_claim_token: claimToken, p_lease_seconds: REQUEST_LEASE_SECONDS,
      }).catch(() => {});
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    try {
      // Per-slot regeneration instructions the operator asked for. Read here so
      // a redone view carries its note and the untouched views do not.
      const { data: slotRows } = await supabase
        .from("designpro_generation_slots")
        .select("source_view_type,instruction")
        .eq("request_id", requestId);
      const instructions = Object.fromEntries(
        (slotRows || []).filter((row) => row.instruction).map((row) => [row.source_view_type, row.instruction]),
      );

      const result = await runSevenSlots({
        claim,
        instructions,
        provider: imageProvider,
        store,
        readBytes: storageBytes,
        log: (line) => console.log(`[DESIGNPRO-OS] calls 1-7 ${requestId}: ${line}`),
      });

      if (result.state !== "outputs_ready") {
        const failed = result.results.filter((item) => item.state === "failed");
        const reasons = failed.map((item) => `${item.sourceViewType}:${item.reason}`).join(", ");
        // Semantic rejection is a human question, not a machine retry.
        const retryable = !failed.some((item) => item.reason === "semantic_review_required");
        await rpc("fail_designpro_generation_request", {
          p_request_id: requestId, p_claim_token: claimToken,
          p_error_code: "generation_slots_failed",
          p_error_message: `Slots failed: ${reasons}`.slice(0, 1000),
          p_retryable: retryable,
        });
        return { requestId, state: "failed", reasons };
      }

      const views = await viewsPayload(requestId);
      if (views.length !== 7) {
        await rpc("fail_designpro_generation_request", {
          p_request_id: requestId, p_claim_token: claimToken,
          p_error_code: "generation_views_incomplete",
          p_error_message: `Expected seven persisted views, found ${views.length}`,
          p_retryable: true,
        });
        return { requestId, state: "failed", reasons: "views_incomplete" };
      }

      const revisionId = handoffRevisionId(requestId);
      const ownerId = String(claim.tenantKey || "").replace(/^user_/, "");

      // THE AUTHORING BOUNDARY. Calls 1-7 have decided this design; here that
      // decision is recorded as the canonical authoring input Call 8 consumes,
      // instead of being left inside the image model as pixels.
      //
      // It is authored against the SAME validated GENIE row manifest.resolve
      // will bind to the run, so the extents computed here are the extents the
      // design space admits. A vehicle still awaiting six-surface validation
      // therefore cannot be authored, and says so rather than guessing.
      const dimensionRow = await resolveOrQueueUniversalDimensions(supabase, claim.input?.vehicle, null, null);
      const designMaster = await authorCreativeInput({
        provider: imageProvider,
        store,
        manifest: { expectedSurfaces: expectedSurfacesFromRow(dimensionRow) },
        input: claim.input,
        bodyText: claim.input?.bodyText,
        ownerId,
        revisionId,
        logger: (line) => console.log(`[DESIGNPRO-OS] authoring ${requestId}: ${line}`),
      });

      const completion = await rpc("complete_designpro_generation_request", {
        p_request_id: requestId,
        p_claim_token: claimToken,
        p_views: views,
        p_engine_receipt: {
          contractVersion: RECEIPT_CONTRACT,
          sourceCommit: claim.engineContract?.sourceCommit,
          frozenContractHash: claim.engineContractHash,
          inputHash: claim.inputHash,
          byteVerified: "true",
          callsCompleted: "7",
          engineContract: engine.ENGINE_CONTRACT,
          providerCalls: result.providerCalls,
          handoffRevisionId: revisionId,
          // WHICH DESIGN CONTRACT PRODUCED THESE SEVEN. Recorded so "did the
          // views clone the hero or invent independently" is a receipt lookup
          // rather than an eyeball comparison of seven renders.
          promptContract: prompts.PROMPT_CONTRACT,
          designMode: prompts.designMode(claim.input),
          heroView: angles.HERO_VIEW,
          heroContentHash: result.heroContentHash,
          designAnchored: result.designAnchored === true,
          // Carried on the receipt because the worker cannot write the revision
          // itself: save_designpro_revision_source requires an authenticated
          // JWT and refuses a service role. The owner freezes this exact object
          // into the snapshot; nothing here bypasses that.
          designMaster,
        },
      });

      // Place the bytes where Calls 8+ expects them. The revision itself is
      // created by the authenticated owner, not here: save_designpro_revision_source
      // requires an 'authenticated' JWT and refuses a service role outright.
      if (completion?.handoffReady === true) {
        await placeRevisionSources({ supabase, ownerId, revisionId, views });
      }
      return { requestId, state: "outputs_ready", revisionId, completion, designMaster };
    } catch (error) {
      // The lease may already be gone; a failed fail-report must not mask the
      // original error.
      await rpc("fail_designpro_generation_request", {
        p_request_id: requestId, p_claim_token: claimToken,
        p_error_code: error.code || "generation_worker_failed",
        p_error_message: String(error.message || error).slice(0, 1000),
        p_retryable: true,
      }).catch(() => {});
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function tick() {
    if (busy || stopped) return null;
    busy = true;
    try {
      const claim = await rpc("claim_designpro_generation_request", {
        p_worker_id: workerId, p_lease_seconds: REQUEST_LEASE_SECONDS,
      });
      if (!claim) return null;
      return await processClaim(claim);
    } catch (error) {
      console.error(`[DESIGNPRO-OS] generation worker: ${error.message}`);
      return null;
    } finally {
      busy = false;
    }
  }

  function start() {
    if (timer) return;
    stopped = false;
    timer = setInterval(() => void tick(), intervalMs);
    timer.unref?.();
    void tick();
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick, store, provider: imageProvider, contract: RECEIPT_CONTRACT };
}

module.exports = {
  HEARTBEAT_MS,
  POLL_MS,
  RECEIPT_CONTRACT,
  REQUEST_LEASE_SECONDS,
  createGenerationWorker,
  planFrom,
  promptPartsFor,
  runSevenSlots,
  slotsFrom,
};
