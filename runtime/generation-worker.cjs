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
const { createProvider } = require("./generation-provider.cjs");
const { BUCKET, createGenerationStore } = require("./generation-store.cjs");

const RECEIPT_CONTRACT = "designpro.calls-1-7-receipt.v1";
const REQUEST_LEASE_SECONDS = 900;
const HEARTBEAT_MS = 120_000;
const POLL_MS = 5_000;

/**
 * The design brief the customer typed, plus the vehicle it goes on.
 *
 * The gateway forbids the client from sending prompt, model, seed or camera
 * angle -- those are server-owned. So the brief is assembled here from the
 * descriptive fields the contract does allow, and the camera angle is appended
 * from the frozen view contract, never from the request.
 */
function designBrief(input) {
  const vehicle = input?.vehicle || {};
  const descriptor = [vehicle.year, vehicle.make, vehicle.model]
    .map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  const lines = [];

  const brief = String(input?.brief || input?.designBrief || input?.description || "").trim();
  if (brief) lines.push(brief);

  const business = String(input?.businessName || input?.business || "").trim();
  if (business) lines.push(`Business: ${business}`);
  const industry = String(input?.industry || "").trim();
  if (industry) lines.push(`Industry: ${industry}`);

  const colors = Array.isArray(input?.colors)
    ? input.colors.map((value) => String(value || "").trim()).filter(Boolean)
    : String(input?.colors || "").trim() ? [String(input.colors).trim()] : [];
  if (colors.length) lines.push(`Colors: ${colors.join(", ")}`);

  const style = String(input?.style || "").trim();
  if (style) lines.push(`Style: ${style}`);

  if (!lines.length) lines.push("Professional commercial vehicle wrap design.");

  lines.push(`Vehicle: ${descriptor || "commercial vehicle"}${vehicle.type ? ` (${vehicle.type})` : ""}`);
  return lines.join("\n");
}

/**
 * Prompt parts for one slot: the brief, the operator's regeneration instruction
 * if this slot is being redone, then the frozen camera angle.
 *
 * The instruction is what "generate this angle again, but bolder" becomes once
 * that capability is server-owned. regenerate_designpro_generation_slot stores
 * it on the slot; the browser never sends it, so the prompt stays server-owned
 * while the operator keeps the control.
 */
function promptPartsFor(input, sourceViewType, instruction = "") {
  // Throws if the passenger angle ever loses its text-direction guard, which is
  // the defect this whole view contract exists to prevent.
  angles.assertTextDirectionGuard(sourceViewType);
  const note = String(instruction || "").trim();
  const revision = note ? `\n\nRevision requested for this view: ${note}` : "";
  return [{ text: `${designBrief(input)}${revision}\n\n${angles.cameraAngle(sourceViewType)}` }];
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

function slotsFrom(viewPlan, input, instructions = {}) {
  const plan = Array.isArray(viewPlan) && viewPlan.length ? viewPlan : angles.viewOrder().map((sourceViewType) => ({ sourceViewType }));
  return plan.map((entry) => {
    const sourceViewType = entry.sourceViewType;
    return {
      sourceViewType,
      consumerRole: entry.consumerRole,
      promptParts: promptPartsFor(input, sourceViewType, instructions[sourceViewType]),
      aspectRatio: angles.aspectRatio(sourceViewType),
      imageSize: angles.resolutionTier(sourceViewType),
    };
  });
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

      const result = await engine.runRequest({
        requestId,
        generationId: claim.generationId,
        tenantKey: claim.tenantKey,
        provider: imageProvider,
        store,
        slots: slotsFrom(claim.viewPlan, claim.input, instructions),
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
        },
      });

      // Place the bytes where Calls 8+ expects them. The revision itself is
      // created by the authenticated owner, not here: save_designpro_revision_source
      // requires an 'authenticated' JWT and refuses a service role outright.
      if (completion?.handoffReady === true) {
        const ownerId = String(claim.tenantKey || "").replace(/^user_/, "");
        await placeRevisionSources({ supabase, ownerId, revisionId, views });
      }
      return { requestId, state: "outputs_ready", revisionId, completion };
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
  designBrief,
  promptPartsFor,
  slotsFrom,
};
