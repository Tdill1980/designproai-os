"use strict";

const { createHash } = require("node:crypto");
const { checkpointPath, AtlasCheckpointError, writeRecoveryBytes } = require("./atlas-accepted-checkpoint.cjs");
const CONTRACT = "designpro.atlas-finishing-checkpoint.v1";
const HASH = /^[0-9a-f]{64}$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encode = (value) => Buffer.from(JSON.stringify(value), "utf8");

// Exact exchanges live only in private Storage. No text summarization,
// signature relocation, truncation or public artifact registration occurs here.
function createFinishingCheckpointStore({ supabase, store, bucket, identity, sourceMasterHash, promptVersion }) {
  if (!HASH.test(sourceMasterHash)) throw new AtlasCheckpointError("flat_atlas_finishing_source_invalid", "Finishing recovery requires its exact authored master");
  const prefix = checkpointPath(identity).replace(/(?:accepted|authored)\.json$/, `finishing/${sourceMasterHash}/${promptVersion}/`);
  if (!/^[A-Za-z0-9._-]+$/.test(promptVersion)) throw new AtlasCheckpointError("flat_atlas_finishing_contract_invalid", "Finishing prompt version is not storage-safe");
  const keyFor = ({ panel, neighbours, priorExchanges, creativeContext }) => {
    if (!["driver", "passenger", "hood", "roof", "front", "rear"].includes(panel?.surfaceKey)
      || !HASH.test(panel.contentHash) || sha256(panel.bytes) !== panel.contentHash) {
      throw new AtlasCheckpointError("flat_atlas_finishing_panel_invalid", "Finishing recovery requires a verified source panel");
    }
    const inputHash = sha256(encode({
      sourceMasterHash, promptVersion, surfaceKey: panel.surfaceKey, contentHash: panel.contentHash,
      neighbours: neighbours.map((item) => ({ surfaceKey: item.surfaceKey, contentHash: item.contentHash })),
      priorExchanges, creativeContext,
    }));
    return { inputHash, storagePath: `${prefix}${panel.surfaceKey}/${inputHash}.json` };
  };
  async function readOptional(path) {
    if (!supabase?.storage?.from) return null;
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) {
      if (String(error.statusCode || error.status) === "404" || error.code === "not_found"
        || /^(object not found|the resource was not found)$/i.test(String(error.message || ""))) return null;
      throw new AtlasCheckpointError("flat_atlas_finishing_checkpoint_read_failed", "Finishing recovery could not be read", true);
    }
    if (!data) throw new AtlasCheckpointError("flat_atlas_finishing_checkpoint_read_failed", "Finishing recovery returned no data", true);
    return Buffer.from(await data.arrayBuffer());
  }
  return {
    contract: CONTRACT,
    async load(context) {
      const key = keyFor(context);
      const recordBytes = await readOptional(key.storagePath);
      if (!recordBytes) return null;
      if (recordBytes.length > 2 * 1024 * 1024) throw new AtlasCheckpointError("flat_atlas_finishing_checkpoint_invalid", "Finishing recovery exceeds its byte budget");
      let envelope;
      try { envelope = JSON.parse(recordBytes.toString("utf8")); }
      catch { throw new AtlasCheckpointError("flat_atlas_finishing_checkpoint_invalid", "Finishing recovery is not JSON"); }
      const record = envelope.record;
      if (!record || sha256(encode(record)) !== envelope.recordHash || record.contract !== CONTRACT
        || record.inputHash !== key.inputHash || record.sourceMasterHash !== sourceMasterHash
        || record.surfaceKey !== context.panel.surfaceKey
        || !HASH.test(String(record.artifact?.contentHash || ""))
        || record.artifact.storagePath !== `${prefix}panels/${record.artifact.contentHash}.png`
        || record.result?.contentHash !== record.artifact.contentHash
        || !Array.isArray(record.nextExchanges)) {
        throw new AtlasCheckpointError("flat_atlas_finishing_checkpoint_invalid", "Finishing recovery does not match its source, geometry and exact history");
      }
      const bytes = await readOptional(record.artifact.storagePath);
      if (!bytes || sha256(bytes) !== record.artifact.contentHash || bytes.length !== record.artifact.byteSize) {
        throw new AtlasCheckpointError("flat_atlas_finishing_checkpoint_artifact_mismatch", "Finishing recovery panel does not match its saved hash");
      }
      return Object.freeze({ ...record.result, bytes, nextExchanges: record.nextExchanges, checkpointReused: true });
    },
    async save(context, result, nextExchanges) {
      const key = keyFor(context);
      if (!Buffer.isBuffer(result.bytes) || sha256(result.bytes) !== result.contentHash) {
        throw new AtlasCheckpointError("flat_atlas_finishing_checkpoint_artifact_mismatch", "Finishing cannot record mismatched panel bytes");
      }
      const { bytes, nextExchanges: _duplicateHistory, ...receipt } = result;
      const artifact = { storagePath: `${prefix}panels/${result.contentHash}.png`, contentHash: result.contentHash, byteSize: bytes.length };
      const record = { contract: CONTRACT, inputHash: key.inputHash, sourceMasterHash,
        surfaceKey: context.panel.surfaceKey, artifact, result: receipt, nextExchanges };
      const recordBytes = encode({ recordHash: sha256(encode(record)), record });
      if (recordBytes.length > 2 * 1024 * 1024) throw new AtlasCheckpointError("flat_atlas_finishing_checkpoint_invalid", "Finishing recovery exceeds its byte budget");
      await writeRecoveryBytes(store, { storagePath: artifact.storagePath, bytes, contentType: "image/png" });
      await writeRecoveryBytes(store, { storagePath: key.storagePath, bytes: recordBytes, contentType: "application/json" });
    },
  };
}

module.exports = { CONTRACT, createFinishingCheckpointStore };
