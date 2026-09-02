"use strict";

/**
 * GENIE PREP — THE EARLY LIFECYCLE (owner ruling, Trish 2026-09-02).
 *
 *   Year / Make / Model → ENTER → GenerationID → GENIE dimension resolution
 *   starts immediately and persists against the GenerationID as PRIVATE OS
 *   state while the customer keeps writing the creative prompt.
 *
 * This module owns the runtime half of that lifecycle:
 *
 *   requestPrep()   the gateway's acknowledgment: idempotent row on
 *                   (generationId, vehicleIdentityHash, GENIE_PREP_CONTRACT),
 *                   claimed and resolved WITHOUT blocking the HTTP response.
 *   runPrep()       the SAME resolver the generation worker uses inline
 *                   (`resolveFlatAtlasPreviewDimensions`), timed, persisted.
 *   reclaimOne()    crash recovery: the worker tick picks up an expired lease.
 *   readReadyPrep() what Generate consumes: READY + same owner + same
 *                   GenerationID + same vehicle identity + same contract, or
 *                   nothing -- in which case the caller falls back to the inline
 *                   resolver. A stale, superseded, failed or foreign prep is
 *                   simply not a match.
 *
 * Prepared geometry is private OS authority. Nothing here is ever placed in
 * the model-facing Call-1 request; `tests/genie-prep-lifecycle.test.mjs`
 * asserts the request bytes are identical with and without a prep hit.
 */

const {
  GENIE_PREP_CONTRACT,
  resolveFlatAtlasPreviewDimensions,
  vehicleIdentityHash,
} = require("./genie-universal-resolver.cjs");

const PREP_LEASE_SECONDS = 180;

class GeniePrepError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "GeniePrepError";
  }
}

function canonicalUuid(value, label) {
  const text = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)) {
    throw new GeniePrepError("genie_prep_request_invalid", `${label} must be a UUID`);
  }
  return text;
}

function publicVehicle(vehicle) {
  return {
    year: String(vehicle?.year || "").trim(),
    make: String(vehicle?.make || "").trim(),
    model: String(vehicle?.model || "").trim(),
    type: String(vehicle?.type || "").trim(),
  };
}

/** The receipt the browser may see: lifecycle and provenance, never the inches. */
function publicReceipt(row) {
  if (!row) return null;
  return {
    prepId: row.prepId ?? row.id ?? null,
    generationId: row.generationId ?? row.generation_id ?? null,
    vehicleIdentityHash: row.vehicleIdentityHash ?? row.vehicle_identity_hash ?? null,
    genieContractVersion: row.genieContractVersion ?? row.genie_contract_version ?? null,
    status: row.status ?? null,
    attempt: row.attempt ?? null,
    geometryState: row.geometryState ?? row.geometry_state ?? null,
    productionEligible: row.productionEligible ?? row.production_eligible ?? null,
    geometryManifestHash: row.geometryManifestHash ?? row.geometry_manifest_hash ?? null,
    errorCode: row.errorCode ?? row.error_code ?? null,
    clientEnteredAt: row.clientEnteredAt ?? row.client_entered_at ?? null,
    requestedAt: row.requestedAt ?? row.requested_at ?? null,
    startedAt: row.startedAt ?? row.started_at ?? null,
    preparedAt: row.preparedAt ?? row.prepared_at ?? null,
    durationMs: row.durationMs ?? row.duration_ms ?? null,
    consumedAt: row.consumedAt ?? row.consumed_at ?? null,
    idempotent: row.idempotent ?? undefined,
  };
}

function createGeniePrepService({
  supabase,
  provider,
  workerId,
  resolver = resolveFlatAtlasPreviewDimensions,
  leaseSeconds = PREP_LEASE_SECONDS,
  logger = (line) => console.log(`[DESIGNPRO-OS] genie-prep: ${line}`),
  now = () => Date.now(),
}) {
  if (!supabase) throw new GeniePrepError("genie_prep_runtime_missing", "GENIE prep requires a Supabase client");
  const inFlight = new Map();

  async function rpc(name, args) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new GeniePrepError(`rpc_${name}_failed`, error.message);
    return data;
  }

  /**
   * Resolve one claimed row with the SAME resolver the worker uses inline, and
   * persist exactly what it returned. The lease token proves this process still
   * owns the row; a superseded or re-leased row refuses the write and the result
   * is dropped rather than persisted under the wrong identity.
   */
  async function runPrep(claimed) {
    const prepId = claimed.prepId;
    if (inFlight.has(prepId)) return inFlight.get(prepId);
    const job = (async () => {
      const startedAt = now();
      try {
        const dimensionRow = await resolver(supabase, claimed.vehicle, provider);
        const geometryResolution = dimensionRow?.geometryResolution;
        if (!geometryResolution?.genieManifestHash) {
          throw new GeniePrepError("genie_prep_geometry_unstamped", "resolver returned no manifest identity");
        }
        const receipt = await rpc("complete_designpro_genie_prep", {
          p_prep_id: prepId,
          p_lease_token: claimed.leaseToken,
          p_geometry: JSON.parse(JSON.stringify(dimensionRow)),
          p_geometry_manifest_hash: geometryResolution.genieManifestHash,
          p_geometry_state: geometryResolution.state,
          p_production_eligible: geometryResolution.productionEligible === true,
          p_duration_ms: Math.max(0, now() - startedAt),
        });
        logger(`prep ${prepId} ready (${geometryResolution.state}) in ${now() - startedAt}ms`);
        return receipt;
      } catch (error) {
        const retryable = error?.retryable === true;
        try {
          const receipt = await rpc("fail_designpro_genie_prep", {
            p_prep_id: prepId,
            p_lease_token: claimed.leaseToken,
            p_error_code: String(error?.code || "genie_prep_failed").slice(0, 120),
            p_error_message: String(error?.message || error).slice(0, 1000),
            p_retryable: retryable,
          });
          logger(`prep ${prepId} failed: ${error?.code || error?.message} (retryable=${retryable})`);
          return receipt;
        } catch (failError) {
          logger(`prep ${prepId} failure not recorded: ${failError.message}`);
          return null;
        }
      } finally {
        inFlight.delete(prepId);
      }
    })();
    inFlight.set(prepId, job);
    return job;
  }

  /**
   * The server acknowledgment. Returns the receipt immediately; the resolution
   * runs in the background of this process. `await` the returned `settled`
   * promise only in tests.
   */
  async function requestPrep({ ownerId, generationId, vehicle, clientEnteredAt = null }) {
    const owner = canonicalUuid(ownerId, "ownerId");
    const generation = canonicalUuid(generationId, "generationId");
    const identityHash = vehicleIdentityHash(vehicle); // throws genie_vehicle_identity_invalid
    const receipt = await rpc("request_designpro_genie_prep", {
      p_owner_id: owner,
      p_generation_id: generation,
      p_vehicle: publicVehicle(vehicle),
      p_vehicle_identity_hash: identityHash,
      p_genie_contract_version: GENIE_PREP_CONTRACT,
      p_client_entered_at: clientEnteredAt || null,
    });
    let settled = Promise.resolve(null);
    if (receipt?.status === "queued") {
      const claimed = await rpc("claim_designpro_genie_prep", {
        p_worker_id: workerId, p_lease_seconds: leaseSeconds, p_prep_id: receipt.prepId,
      });
      if (claimed) {
        settled = runPrep(claimed);
        return { receipt: publicReceipt({ ...receipt, status: "resolving", startedAt: claimed.startedAt }), settled };
      }
    }
    return { receipt: publicReceipt(receipt), settled };
  }

  /** Crash recovery, called from the worker tick when it has no generation to run. */
  async function reclaimOne() {
    const claimed = await rpc("claim_designpro_genie_prep", {
      p_worker_id: workerId, p_lease_seconds: leaseSeconds, p_prep_id: null,
    });
    if (!claimed) return null;
    logger(`reclaimed prep ${claimed.prepId} (attempt ${claimed.attempt})`);
    // Detached on purpose: the caller is the worker's idle tick and must not
    // wait on a resolver that may ground for up to 90 s.
    void runPrep(claimed);
    return publicReceipt(claimed);
  }

  /**
   * What Generate consumes. Exact owner, exact GenerationID, exact vehicle
   * identity, exact contract, status READY -- or null, and the caller falls
   * back to the inline resolver. Never throws on a missing row.
   */
  async function readReadyPrep({ ownerId, generationId, vehicle }) {
    let identityHash;
    try {
      identityHash = vehicleIdentityHash(vehicle);
    } catch {
      return null;
    }
    let row = null;
    try {
      row = await rpc("read_designpro_genie_prep", {
        p_owner_id: canonicalUuid(ownerId, "ownerId"),
        p_generation_id: canonicalUuid(generationId, "generationId"),
        p_vehicle_identity_hash: identityHash,
        p_genie_contract_version: GENIE_PREP_CONTRACT,
      });
    } catch (error) {
      logger(`prep read failed, falling back inline: ${error.message}`);
      return null;
    }
    if (!row || row.status !== "ready" || !row.geometry?.geometryResolution?.genieManifestHash) return null;
    if (row.geometry.geometryResolution.genieManifestHash !== row.geometryManifestHash) return null;
    return { receipt: publicReceipt(row), geometry: row.geometry };
  }

  async function consumePrep(prepId, requestId) {
    try {
      return await rpc("consume_designpro_genie_prep", { p_prep_id: prepId, p_request_id: requestId });
    } catch (error) {
      logger(`prep ${prepId} consume receipt not recorded: ${error.message}`);
      return null;
    }
  }

  return { requestPrep, runPrep, reclaimOne, readReadyPrep, consumePrep, contract: GENIE_PREP_CONTRACT };
}

module.exports = {
  GENIE_PREP_CONTRACT,
  PREP_LEASE_SECONDS,
  GeniePrepError,
  createGeniePrepService,
  publicReceipt,
  vehicleIdentityHash,
};
