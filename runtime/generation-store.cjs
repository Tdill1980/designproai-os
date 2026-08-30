"use strict";

/**
 * Supabase-backed store for the Calls 1-7 engine.
 *
 * This is the wiring between the bounded runner and the real system of record.
 * It persists only to designpro_* objects and the wrap-files bucket; no legacy
 * or shared table is reachable from here, and the isolation sweep enforces that.
 *
 * The engine owns the decisions. This module owns the writes, and it makes them
 * the way the schema expects: content-addressed storage, an accepted winner per
 * slot that the database itself refuses to mutate, and an attempt row on both
 * sides of every provider call.
 */

const { createHash } = require("node:crypto");

const BUCKET = "wrap-files";
const STORE_CONTRACT = "designpro.calls-1-7-store.v1";
const VIEW_TO_ROLE = Object.freeze({
  side: "driver", "passenger-side": "passenger", hood_detail: "hood",
  front: "front", rear: "rear", "close-up": "closeup", roof: "roof",
  // Historical rows remain readable, but hero-3d is not in the active plan.
  "hero-3d": "hero3d",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createGenerationStore({ supabase, workerId }) {
  if (!supabase) throw new Error("generation store requires a Supabase client");

  return {
    contract: STORE_CONTRACT,

    /**
     * The ACTIVE accepted winner. A superseded row is history from a previous
     * "generate this angle again": it must not count as accepted, or the
     * regenerated slot would be skipped and the operator's request ignored.
     */
    async findAcceptedSlot({ requestId, sourceViewType }) {
      const { data, error } = await supabase
        .from("designpro_generation_views")
        .select("id,storage_path,content_hash,byte_size,content_type,consumer_role,metadata")
        .eq("request_id", requestId).eq("source_view_type", sourceViewType)
        .is("superseded_at", null).maybeSingle();
      if (error) throw new Error(`accepted slot lookup failed: ${error.message}`);
      return data || null;
    },

    /**
     * Crash recovery. A worker that uploaded bytes and died before committing
     * the row leaves them at a content-addressed path. Finding and verifying
     * them is far cheaper than paying a provider to make them again.
     */
    async findReconcilableBytes({ tenantKey, generationId, sourceViewType }) {
      if (!tenantKey || !generationId) return null;
      // Must be the same prefix the engine writes and the completion RPC
      // recomputes; a divergence here silently disables crash recovery.
      const prefix = `designpro/${tenantKey}/${generationId}/calls-1-7/${sourceViewType}`;
      const { data: listed, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 2 });
      if (error || !listed?.length) return null;
      // Exactly one orphan is recoverable. Two means an ambiguous history that a
      // human should look at rather than a machine guessing.
      if (listed.length !== 1) return null;
      const name = listed[0].name;
      const storagePath = `${prefix}/${name}`;
      const { data, error: downloadError } = await supabase.storage.from(BUCKET).download(storagePath);
      if (downloadError || !data) return null;
      const bytes = Buffer.from(await data.arrayBuffer());
      if (!bytes.length) return null;
      const contentHash = name.replace(/\.(png|jpg|webp)$/i, "");
      const extension = (name.split(".").pop() || "").toLowerCase();
      const contentType = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[extension];
      if (!contentType || !/^[0-9a-f]{64}$/.test(contentHash)) return null;
      return { bytes, contentHash, storagePath, contentType };
    },

    /** One worker per request+slot. */
    async acquireSlotLease({ requestId, sourceViewType, leaseSeconds }) {
      const { data, error } = await supabase.rpc("claim_designpro_generation_slot", {
        p_request_id: requestId, p_source_view_type: sourceViewType,
        p_worker: workerId, p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(`slot lease failed: ${error.message}`);
      return data || null;
    },

    async releaseSlotLease({ requestId, sourceViewType, lease }) {
      const { error } = await supabase.rpc("release_designpro_generation_slot", {
        p_request_id: requestId, p_source_view_type: sourceViewType,
        p_lease_token: lease?.leaseToken || lease?.token || null,
      });
      if (error) throw new Error(`slot lease release failed: ${error.message}`);
    },

    /** Written before the provider call, so a death mid-flight leaves evidence. */
    async recordAttemptStarted({ requestId, sourceViewType, attempt }) {
      const { error } = await supabase.from("designpro_generation_attempts").insert({
        request_id: requestId, source_view_type: sourceViewType, attempt,
        model: "pending", key_fingerprint: "000000000000", outcome: "aborted",
        detail: "attempt opened; provider call in flight",
      });
      // A duplicate attempt number means this attempt already ran and the
      // worker is retrying a recorded step. Not an error.
      if (error && !/duplicate|unique/i.test(error.message)) {
        throw new Error(`attempt open failed: ${error.message}`);
      }
    },

    async recordAttemptFinished(record) {
      const { error } = await supabase.from("designpro_generation_attempts")
        .update({
          model: record.model || "unknown",
          key_fingerprint: record.keyFingerprint || "000000000000",
          outcome: record.outcome === "rejected" ? "unsupported_type" : record.outcome,
          http_status: record.httpStatus ?? null,
          detail: record.detail ? String(record.detail).slice(0, 500) : null,
          duration_ms: record.durationMs ?? null,
          content_hash: record.winnerHash || null,
        })
        .eq("request_id", record.requestId)
        .eq("source_view_type", record.sourceViewType)
        .eq("attempt", record.attempt);
      if (error) throw new Error(`attempt close failed: ${error.message}`);
    },

    /**
     * Create-only canonical persistence.
     *
     * The A.T.L.A.S. photographer has already put its 4K result in this same
     * private bucket so the runtime can hash and inspect it. After QC, promote
     * that verified object with Storage's server-side copy instead of uploading
     * the same multi-megabyte payload again. Standard generation, and any copy
     * transport failure, keeps the proven direct-upload path.
     */
    async putImmutableBytes({ storagePath, bytes, contentType, sourceStoragePath = null, sourceContentHash = null }) {
      const contentHash = sha256(bytes);
      const sourcePath = String(sourceStoragePath || "");
      const sourceHash = String(sourceContentHash || "").toLowerCase();
      const stagedProof = /^atlas-proof\/[0-9a-f-]{36}_[a-z0-9-]+\.(png|jpg|webp)$/i.test(sourcePath);
      if (sourcePath && (!stagedProof || sourceHash !== contentHash)) {
        throw new Error("staged proof identity does not match the verified candidate bytes");
      }

      const bucket = supabase.storage.from(BUCKET);
      let error = null;
      if (stagedProof && typeof bucket.copy === "function") {
        ({ error } = await bucket.copy(sourcePath, storagePath));
      }
      // No staging object (Standard path), an older Storage client, or a copy
      // transport fault: fall back to the original create-only byte upload.
      if (!stagedProof || typeof bucket.copy !== "function"
        || (error && !/exists|duplicate|conflict/i.test(`${error.message}`))) {
        ({ error } = await bucket.upload(storagePath, bytes, { contentType, upsert: false }));
      }
      if (error) {
        if (!/exists|duplicate|conflict/i.test(`${error.message}`)) throw new Error(`slot upload failed: ${error.message}`);
        const { data, error: readError } = await bucket.download(storagePath);
        if (readError || !data) throw new Error(`slot upload idempotency read failed: ${readError?.message || "empty"}`);
        const existing = Buffer.from(await data.arrayBuffer());
        if (sha256(existing) !== contentHash) throw new Error("content-addressed path already holds different bytes");
      }
      return { storagePath, contentHash, byteSize: bytes.length };
    },

    /** Best-effort deletion of the photographer's noncanonical staging copy. */
    async removeStagedBytes({ storagePath }) {
      const sourcePath = String(storagePath || "");
      if (!/^atlas-proof\/[0-9a-f-]{36}_[a-z0-9-]+\.(png|jpg|webp)$/i.test(sourcePath)) return false;
      const { error } = await supabase.storage.from(BUCKET).remove([sourcePath]);
      if (error) throw new Error(`staged proof cleanup failed: ${error.message}`);
      return true;
    },

    /** The database refuses to mutate or delete this row once written. */
    async persistAcceptedSlot(row) {
      const { data, error } = await supabase.from("designpro_generation_views").insert({
        request_id: row.requestId, source_view_type: row.sourceViewType,
        consumer_role: row.consumerRole || VIEW_TO_ROLE[row.sourceViewType],
        storage_path: row.storagePath, content_hash: row.contentHash,
        byte_size: row.byteSize, content_type: row.contentType,
        metadata: { ...row.metadata, contract: STORE_CONTRACT },
      }).select("id,storage_path,content_hash,byte_size,content_type,consumer_role").single();
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return this.findAcceptedSlot({ requestId: row.requestId, sourceViewType: row.sourceViewType });
        }
        throw new Error(`accepted slot persistence failed: ${error.message}`);
      }
      return data;
    },

    async markSlotFailed({ requestId, sourceViewType, reason, providerCalls, rejections }) {
      const { error } = await supabase.rpc("fail_designpro_generation_slot", {
        p_request_id: requestId, p_source_view_type: sourceViewType,
        p_reason: reason, p_provider_calls: providerCalls, p_rejections: rejections,
      });
      if (error) throw new Error(`slot failure record failed: ${error.message}`);
    },

    /**
     * Projects accepted winners into the seven-view revision-source contract
     * Calls 8+ already consumes. It targets that existing shape exactly; nothing
     * downstream changes.
     */
    async projectRevisionSources({ requestId }) {
      const { data, error } = await supabase.from("designpro_generation_views")
        .select("source_view_type,consumer_role,storage_path,content_hash,byte_size,content_type")
        .eq("request_id", requestId).is("superseded_at", null);
      if (error) throw new Error(`revision source projection failed: ${error.message}`);
      const renderAssets = {};
      for (const row of data || []) {
        const sourceViewType = String(row.source_view_type || "");
        const consumerRole = String(row.consumer_role || "");
        if (VIEW_TO_ROLE[sourceViewType] !== consumerRole || renderAssets[consumerRole]) {
          throw new Error("revision source projection contains an unknown or duplicate role");
        }
        renderAssets[consumerRole] = {
          bucket: BUCKET, storagePath: row.storage_path, contentHash: row.content_hash,
          byteSize: Number(row.byte_size), contentType: row.content_type,
        };
      }
      const core = ["driver", "passenger", "hood", "roof", "front", "rear"];
      const hasCloseup = Boolean(renderAssets.closeup);
      const hasHero = Boolean(renderAssets.hero3d);
      if (Object.keys(renderAssets).length !== 7
        || core.some((role) => !renderAssets[role])
        || hasCloseup === hasHero) {
        throw new Error("revision source projection requires exactly one Close-Up or immutable historical Hero proof");
      }
      return renderAssets;
    },
  };
}

module.exports = { BUCKET, STORE_CONTRACT, VIEW_TO_ROLE, createGenerationStore, sha256 };
