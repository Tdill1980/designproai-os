"use strict";

const READINESS_CONTRACT = "designpro.runtime-readiness.v2";
const REQUIRED_BUCKET = "wrap-files";

async function probeRuntimeDependencies(supabase) {
  const { data: database, error: databaseError } = await supabase.rpc("designpro_runtime_readiness");
  if (databaseError) throw new Error(`Supabase readiness RPC failed: ${databaseError.message}`);
  if (!database || database.contract !== READINESS_CONTRACT) throw new Error("Supabase readiness contract is missing or incompatible");
  if (database.ready !== true) {
    const missing = Array.isArray(database.missingRpcs) ? database.missingRpcs.join(",") : "unknown";
    throw new Error(`Supabase readiness rejected: missingRpcs=${missing}; groundedIdentityFence=${database.groundedIdentityFence === true}`);
  }
  if (database.groundedIdentityFence !== true) throw new Error("Universal GENIE grounded identity fence is missing");
  if (database.heavyOutputLeaseFence !== true) throw new Error("Heavy output lease fence is missing");
  if (database.wrapboxFence !== true) throw new Error("WrapBox publication fence is missing");

  const { data: bucketData, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) throw new Error(`Supabase Storage readiness failed: ${bucketError.message}`);
  const buckets = Array.isArray(bucketData) ? bucketData : Array.isArray(bucketData?.buckets) ? bucketData.buckets : [];
  const bucket = buckets.find((item) => item && (item.id === REQUIRED_BUCKET || item.name === REQUIRED_BUCKET));
  if (!bucket) throw new Error(`private ${REQUIRED_BUCKET} bucket is missing`);
  if (bucket.public !== false) throw new Error(`${REQUIRED_BUCKET} privacy could not be verified`);

  return Object.freeze({
    ready: true,
    contract: READINESS_CONTRACT,
    rpcCount: Number(database.rpcCount),
    dimensionSeedCount: Number(database.dimensionSeedCount),
    qcSeedCount: Number(database.qcSeedCount),
    groundedIdentityFence: true,
    heavyOutputLeaseFence: true,
    wrapboxFence: true,
    capabilities: Object.freeze({
      validatedGeometrySeeded: database.capabilities?.validatedGeometrySeeded === true,
      qcOperatorSeeded: database.capabilities?.qcOperatorSeeded === true,
    }),
    bucket: REQUIRED_BUCKET,
    bucketPrivate: true,
  });
}

module.exports = { READINESS_CONTRACT, REQUIRED_BUCKET, probeRuntimeDependencies };
