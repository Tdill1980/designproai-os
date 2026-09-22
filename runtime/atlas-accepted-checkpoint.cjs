"use strict";

// A server-only recovery record. It is written after the existing acceptance
// gates and before the first public master/panel event. It never accepts an
// image, spends a provider request, or replaces the immutable revision row.
const { createHash } = require("node:crypto");
const CONTRACT = "designpro.atlas-accepted-checkpoint.v1";
const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RECORD_BYTES = 2 * 1024 * 1024;

class AtlasCheckpointError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = "AtlasCheckpointError";
    this.code = code;
    this.retryable = retryable;
  }
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}
const bytesOf = (value) => Buffer.from(JSON.stringify(canonical(value)), "utf8");
async function writeRecoveryBytes(store, artifact) {
  try { return await store.putImmutableBytes(artifact); }
  catch (cause) {
    const conflict = /different bytes|identity mismatch/i.test(String(cause?.message || ""));
    throw new AtlasCheckpointError(conflict ? "flat_atlas_checkpoint_write_conflict" : "flat_atlas_checkpoint_write_failed",
      conflict ? "Immutable recovery identity already holds different bytes" : "Recovery storage could not be completed", !conflict);
  }
}
function checkpointPath({ tenantKey, generationId, requestId, checkpointKind = "accepted" }) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(tenantKey || ""))
    || !UUID.test(String(generationId || "")) || !UUID.test(String(requestId || ""))
    || !["authored", "accepted"].includes(checkpointKind)) {
    throw new AtlasCheckpointError("flat_atlas_checkpoint_identity_invalid", "Recovery requires the existing tenant, generation and request identities");
  }
  return `designpro-atlas-private/v1/${tenantKey}/${generationId}/${requestId}/${checkpointKind}.json`;
}
function revisionIdentityMatches(record, identity) {
  return (record.revisionSequence ?? 1) === (identity.revisionSequence ?? 1)
    && (record.parentRevisionId ?? null) === (identity.parentRevisionId ?? null)
    && (record.revisionContextHash ?? null) === (identity.revisionContextHash ?? null);
}
function assertIdentity(record, identity) {
  if (record?.contract !== CONTRACT || record?.accepted !== true
    || !UUID.test(String(record?.revisionId || ""))
    || !HASH.test(String(record?.inputHash || ""))
    || !HASH.test(String(record?.manifestHash || ""))
    || !HASH.test(String(record?.promptHash || ""))
    || !revisionIdentityMatches(record, identity)
    || ["tenantKey", "generationId", "requestId", "ownerId", "inputHash", "manifestHash", "promptVersion", "masterQcContract", "checkpointKind", "finishingMode"]
      .some((key) => record[key] !== identity[key])) {
    throw new AtlasCheckpointError("flat_atlas_checkpoint_identity_mismatch", "Saved acceptance does not belong to this exact request, geometry and acceptance contract");
  }
  for (const kind of ["master", "rawProviderResponse"]) {
    const asset = record[kind];
    const prefix = kind === "master" ? `designpro/${identity.tenantKey}/${identity.generationId}/flat-first/v1/revisions/${identity.revisionSequence ?? 1}/master/`
      : checkpointPath(identity).replace(/(?:authored|accepted)\.json$/, "provider-response/");
    if (!asset?.storagePath?.startsWith(prefix) || asset.storagePath.includes("..")
      || !HASH.test(String(asset.contentHash || ""))
      || !asset.storagePath.endsWith(`/${asset.contentHash}.png`)
      || !Number.isSafeInteger(asset.byteSize) || asset.byteSize < 1) {
      throw new AtlasCheckpointError("flat_atlas_checkpoint_artifact_invalid", "Recovery artifact is not an immutable child of this generation");
    }
  }
  const checks = record.state?.masterDeterministic;
  const zoneKeys = Array.isArray(checks?.zones) ? checks.zones.map((zone) => zone.surfaceKey) : [];
  const receipt = record.state?.outputClassReceipt;
  // THE SIX-SURFACE GATE TERMS ARE NOT REQUIRED OF A PANEL-PROOF ACCEPTANCE
  // (owner, 2026-09-22). On that topology the deterministic and output-class
  // verdicts are ADVISORY -- recorded on `state.masterGateAdvisory`, never a
  // refusal -- so a checkpoint whose advisory carries findings is still a
  // valid acceptance and must resume rather than throw. What proves the
  // acceptance there is the master artifact identity (checked above: an
  // immutable child of this generation, hash-named, byte-sized) plus the
  // advisory receipt itself and the attempt terms below. A panel-proof
  // checkpoint written before the advisory existed carries none and falls
  // through to the six-surface terms it was written under.
  const advisory = record.state?.masterGateAdvisory;
  const panelProofAdvisory = record.state?.authoringTopology === "panel-proof"
    && advisory && typeof advisory === "object" && advisory.contract === "designpro.atlas-master-gate-advisory.v1";
  // NAMED, BECAUSE AN UNNAMED CONJUNCTION IS NOT A DIAGNOSIS (2026-09-18).
  //
  // This was one fifteen-term `if`, and when it fired on a live canary
  // (0a5fc4ef, the first occurrence in the table's history) the failure said
  // only "does not prove the existing master acceptance gates passed" -- which
  // of the fifteen was unknowable from the row, the canary artifact or any log
  // that leaves the droplet. Every term and every threshold below is
  // UNCHANGED; the only difference is that the one that fires now says so.
  //
  // Same lesson this repo keeps paying for in a different place: a gate that
  // reports a verdict without its evidence cannot be debugged from the outside.
  const acceptanceFailures = [
    ...(panelProofAdvisory ? [
      [advisory.advisory !== true || advisory.refused !== false,
        `masterGateAdvisory is not an advisory receipt (advisory=${advisory.advisory}, refused=${advisory.refused})`],
    ] : [
    [checks?.accepted !== true, "masterDeterministic.accepted is not true"],
    [!Array.isArray(checks?.blockingFailures) || checks.blockingFailures.length,
      `blockingFailures=${JSON.stringify(checks?.blockingFailures || null).slice(0, 160)}`],
    [!Array.isArray(checks?.cutoutFindings) || checks.cutoutFindings.length,
      `cutoutFindings=${JSON.stringify(checks?.cutoutFindings || null).slice(0, 160)}`],
    [zoneKeys.length !== 6 || new Set(zoneKeys).size !== 6
      || ["driver", "passenger", "hood", "roof", "front", "rear"].some((key) => !zoneKeys.includes(key)),
      `zones=${JSON.stringify(zoneKeys)}`],
    [receipt?.contract !== "designpro.atlas-output-class-gate.v1",
      `outputClass.contract=${receipt?.contract}`],
    [!["flat_atlas", "unavailable"].includes(receipt?.disposition),
      `outputClass.disposition=${receipt?.disposition}`],
    [receipt?.blocking !== false, `outputClass.blocking=${receipt?.blocking}`],
    [![record.master?.contentHash, record.state?.preMirrorMasterHash].filter(Boolean)
      .includes(receipt?.candidateSha256),
      `outputClass.candidateSha256=${String(receipt?.candidateSha256).slice(0, 12)} is neither the accepted master `
      + `${String(record.master?.contentHash).slice(0, 12)} nor the pre-mirror ${String(record.state?.preMirrorMasterHash).slice(0, 12)}`],
    ]),
    [!Number.isSafeInteger(record.state?.masterAuthoringAttempts) || record.state.masterAuthoringAttempts < 1,
      `masterAuthoringAttempts=${record.state?.masterAuthoringAttempts}`],
    [!Number.isSafeInteger(record.state?.maxAuthoringAttemptsAllowed)
      || record.state.maxAuthoringAttemptsAllowed < record.state.masterAuthoringAttempts
      || record.state.maxAuthoringAttemptsAllowed > 2,
      `maxAuthoringAttemptsAllowed=${record.state?.maxAuthoringAttemptsAllowed} against `
      + `masterAuthoringAttempts=${record.state?.masterAuthoringAttempts}`],
  ].filter(([failed]) => failed).map(([, why]) => why);
  if (acceptanceFailures.length) {
    throw new AtlasCheckpointError("flat_atlas_checkpoint_acceptance_invalid",
      `Recovery record does not prove the existing master acceptance gates passed: ${acceptanceFailures.join("; ")}`);
  }
}

async function readAcceptedCheckpoint({ supabase, bucket, identity }) {
  // The injected offline authoring fixture has no Storage reader. Real runtime
  // clients always do; this does not authorize reuse without byte verification.
  if (!supabase?.storage?.from) return null;
  const storagePath = checkpointPath(identity);
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error) {
    // Only a confirmed missing object is a cache miss. An outage must not
    // accidentally become permission to spend another authoring request.
    if (String(error.statusCode || error.status) === "404"
      || ["not_found", "NoSuchKey"].includes(error.code)
      || /^(object not found|the resource was not found)$/i.test(String(error.message || ""))) return null;
    throw new AtlasCheckpointError("flat_atlas_checkpoint_read_failed", "Accepted-master recovery could not be read", true);
  }
  if (!data) throw new AtlasCheckpointError("flat_atlas_checkpoint_read_failed", "Accepted-master recovery returned no data", true);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length > MAX_RECORD_BYTES) throw new AtlasCheckpointError("flat_atlas_checkpoint_record_invalid", "Recovery record exceeds its byte budget");
  let envelope;
  try { envelope = JSON.parse(bytes.toString("utf8")); }
  catch { throw new AtlasCheckpointError("flat_atlas_checkpoint_record_invalid", "Recovery record is not JSON"); }
  if (sha256(bytesOf(envelope?.record)) !== envelope?.recordHash) {
    throw new AtlasCheckpointError("flat_atlas_checkpoint_record_invalid", "Recovery record hash does not match its contents");
  }
  const record = envelope.record;
  assertIdentity(record, identity);
  const load = async (asset) => {
    const { data: blob, error: readError } = await supabase.storage.from(bucket).download(asset.storagePath);
    if (readError || !blob) throw new AtlasCheckpointError("flat_atlas_checkpoint_artifact_missing", "An accepted recovery artifact could not be read", true);
    const result = Buffer.from(await blob.arrayBuffer());
    if (result.length !== asset.byteSize || sha256(result) !== asset.contentHash) {
      throw new AtlasCheckpointError("flat_atlas_checkpoint_artifact_mismatch", "Recovery artifact bytes do not match the accepted content hash");
    }
    return result;
  };
  const [masterBytes, rawBytes] = await Promise.all([load(record.master), load(record.rawProviderResponse)]);
  return { ...record, masterBytes, rawBytes, storagePath, contentHash: envelope.recordHash };
}

async function writeAcceptedCheckpoint({ store, supabase, bucket, identity, revisionId, promptHash, authoringInput,
  masterBytes, masterStoragePath, rawBytes, state }) {
  const path = checkpointPath(identity);
  const rawHash = sha256(rawBytes);
  const rawPath = path.replace(/(?:authored|accepted)\.json$/, `provider-response/${rawHash}.png`);
  const record = {
    contract: CONTRACT, ...identity, revisionId, promptHash, accepted: true,
    authoringInput,
    master: { storagePath: masterStoragePath, contentHash: sha256(masterBytes), byteSize: masterBytes.length },
    rawProviderResponse: { storagePath: rawPath, contentHash: rawHash, byteSize: rawBytes.length },
    state,
  };
  assertIdentity(record, identity);
  const recordHash = sha256(bytesOf(record));
  const recordBytes = bytesOf({ recordHash, record });
  if (recordBytes.length > MAX_RECORD_BYTES) throw new AtlasCheckpointError("flat_atlas_checkpoint_record_invalid", "Recovery record exceeds its byte budget");
  // The receipt cannot exist before both assets are durable. A crash before
  // this join remains unresolved; it cannot be disguised as acceptance.
  await Promise.all([
    writeRecoveryBytes(store, { storagePath: masterStoragePath, bytes: masterBytes, contentType: "image/png" }),
    writeRecoveryBytes(store, { storagePath: rawPath, bytes: rawBytes, contentType: "image/png" }),
  ]);
  try {
    await writeRecoveryBytes(store, { storagePath: path, bytes: recordBytes, contentType: "application/json" });
  } catch (cause) {
    // A replacement lease can finish the same cached candidate while the old
    // worker is still recording its acceptance. Only the matching immutable
    // winner may resolve that race. Changed input, master bytes or raw provider
    // bytes remain real conflicts; they never acquire retry permission here.
    if (cause?.code === "flat_atlas_checkpoint_write_conflict" && supabase?.storage?.from) {
      const winner = await readAcceptedCheckpoint({ supabase, bucket, identity });
      if (winner && winner.promptHash === promptHash
        && winner.master.contentHash === record.master.contentHash
        && winner.rawProviderResponse.contentHash === record.rawProviderResponse.contentHash) {
        throw new AtlasCheckpointError("flat_atlas_checkpoint_publication_race",
          "The same accepted candidate was recorded by another lease; resume its immutable revision", true);
      }
    }
    throw cause;
  }
  return { storagePath: path, contentHash: recordHash };
}

async function readAuthoringContext({ supabase, bucket, identity }) {
  if (!supabase?.storage?.from) return null;
  const path = checkpointPath(identity).replace(/(?:authored|accepted)\.json$/, "context.json");
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) {
    if (String(error.statusCode || error.status) === "404" || error.code === "not_found"
      || /^(object not found|the resource was not found)$/i.test(String(error.message || ""))) return null;
    throw new AtlasCheckpointError("flat_atlas_context_read_failed", "The original authoring context could not be read", true);
  }
  if (!data) throw new AtlasCheckpointError("flat_atlas_context_read_failed", "The original authoring context returned no data", true);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length > MAX_RECORD_BYTES) throw new AtlasCheckpointError("flat_atlas_context_invalid", "Authoring context exceeds its byte budget");
  let envelope;
  try { envelope = JSON.parse(bytes.toString("utf8")); } catch { /* refused below */ }
  const record = envelope?.record;
  if (!record || envelope.recordHash !== sha256(bytesOf(record))
    || record.contract !== "designpro.atlas-authoring-context.v1"
    || record.inputHash !== identity.inputHash || record.manifestHash !== identity.manifestHash
    || record.promptVersion !== identity.promptVersion || record.ownerId !== identity.ownerId
    || !revisionIdentityMatches(record, identity)
    || typeof record.styleDescriptors !== "string") {
    throw new AtlasCheckpointError("flat_atlas_context_invalid", "Authoring context differs from this exact request");
  }
  return record;
}

async function writeAuthoringContext({ store, identity, styleDescriptors }) {
  const path = checkpointPath(identity).replace(/(?:authored|accepted)\.json$/, "context.json");
  const record = { contract: "designpro.atlas-authoring-context.v1", inputHash: identity.inputHash,
    manifestHash: identity.manifestHash, promptVersion: identity.promptVersion, ownerId: identity.ownerId,
    revisionSequence: identity.revisionSequence ?? 1, parentRevisionId: identity.parentRevisionId ?? null,
    revisionContextHash: identity.revisionContextHash ?? null,
    styleDescriptors: String(styleDescriptors || "") };
  const bytes = bytesOf({ recordHash: sha256(bytesOf(record)), record });
  if (bytes.length > MAX_RECORD_BYTES) throw new AtlasCheckpointError("flat_atlas_context_invalid", "Authoring context exceeds its byte budget");
  await writeRecoveryBytes(store, { storagePath: path, bytes, contentType: "application/json" });
}

module.exports = { CONTRACT, AtlasCheckpointError, checkpointPath, readAcceptedCheckpoint, writeAcceptedCheckpoint,
  readAuthoringContext, writeAuthoringContext, writeRecoveryBytes };
