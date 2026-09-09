"use strict";

// Read-only incident inspection. This command never invokes Gemini, changes a
// lease, creates a design, writes Storage, approves QC, or sends a notification.
const { createHash } = require("node:crypto");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const MAX_BYTES = 64 * 1024 * 1024;

function completePayloadPrefix(text) {
  // Legacy cache writes status, then payload, then the original private request.
  // A complete payload may survive an incomplete envelope. Report that fact;
  // never turn a prefix into an accepted response or replace its missing tail.
  const start = /^\{"status":\d+,"payload":/.exec(text);
  if (!start || text[start[0].length] !== "{") return null;
  let quoted = false, escaped = false, depth = 0;
  for (let at = start[0].length; at < text.length; at += 1) {
    const c = text[at];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start[0].length, at + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

async function read(bucket, path, maxBytes) {
  const { data, error } = await bucket.download(path);
  if (error) {
    if (Number(error.statusCode || error.status) === 404 || /^(Object not found|The resource was not found|Not found)$/i.test(error.message || "")) return null;
    throw new Error("audit_storage_read_failed");
  }
  if (!data || data.size > maxBytes) throw new Error("audit_storage_size_invalid");
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error("audit_storage_size_invalid");
  return bytes;
}

function imageSummary(payload) {
  const candidates = payload?.candidates;
  if (!Array.isArray(candidates) || candidates.length !== 1) return { completeFinalImage: false };
  const parts = candidates[0]?.content?.parts || [];
  const images = parts.filter(p => p?.thought !== true && typeof p?.inlineData?.data === "string");
  if (images.length !== 1) return { completeFinalImage: false, finalImageCount: images.length };
  const image = images[0];
  const bytes = Buffer.from(image.inlineData.data, "base64");
  const png = image.inlineData.mimeType === "image/png" && bytes.length >= 45
    && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && bytes.toString("ascii", 12, 16) === "IHDR"
    && bytes.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]));
  return { completeFinalImage: png, imageBytes: bytes.length, imageSha256: digest(bytes),
    ...(png ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : {}),
    signedPartCount: parts.filter(p => typeof p?.thoughtSignature === "string").length };
}

async function inspectAtlasProviderCache({ supabase, requestId, generationId }) {
  if (!UUID.test(requestId || "") || !UUID.test(generationId || "")) throw new Error("audit_identity_invalid");
  const { data: row, error } = await supabase.from("designpro_generation_requests")
    .select("id,generation_id,owner_id,state,created_at,updated_at,error,engine_receipt")
    .eq("id", requestId).eq("generation_id", generationId).maybeSingle();
  if (error || !row || row.id !== requestId || row.generation_id !== generationId || !UUID.test(row.owner_id)) throw new Error("audit_request_not_found");
  const bucket = supabase.storage.from("wrap-files");
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const identity = { ownerId: row.owner_id, requestId, generationId, mode: "atlas-artboard", attemptKey: `master:${attempt}` };
    const key = digest(JSON.stringify({ contractVersion: "designpro.gemini-provider-cache.v1", ...identity }));
    const prefix = `designpro-provider-private/v1/${row.owner_id}/${generationId}/${key}`;
    const rawClaim = await read(bucket, `${prefix}/claim.json`, 64 * 1024);
    if (!rawClaim) { attempts.push({ attempt, claimPresent: false }); continue; }
    const claim = JSON.parse(rawClaim.toString("utf8"));
    if (claim.contractVersion !== "designpro.gemini-provider-cache.v1" || !HASH.test(claim.requestHash)
      || Object.entries(identity).some(([k,v]) => claim[k] !== v)) throw new Error("audit_claim_identity_mismatch");
    const rawReceipt = await read(bucket, `${prefix}/response.json`, 64 * 1024);
    if (rawReceipt) {
      const receipt = JSON.parse(rawReceipt.toString("utf8"));
      attempts.push({ attempt, claimPresent: true, completionRecordPresent: true,
        responseByteSize: receipt.byteSize, responseSha256: receipt.responseHash,
        chunkCount: receipt.chunks?.length, requestSha256: claim.requestHash });
      continue;
    }
    const { data: files, error: listError } = await bucket.list(`${prefix}/result`, { limit: 129 });
    if (listError || !Array.isArray(files) || files.length > 128) throw new Error("audit_chunk_list_invalid");
    const records = files.map(f => ({ file: f, match: /^(\d+)-([0-9a-f]{64})\.jsonpart$/.exec(f.name) }));
    if (records.some(r => !r.match)) throw new Error("audit_chunk_path_invalid");
    records.sort((a,b) => Number(a.match[1]) - Number(b.match[1]));
    const fragments = [];
    let total = 0;
    for (let index = 0; index < records.length; index += 1) {
      const { file, match } = records[index];
      if (Number(match[1]) !== index) throw new Error("audit_chunk_gap");
      const stored = await read(bucket, `${prefix}/result/${file.name}`, 6 * 1024 * 1024);
      if (!stored || digest(stored) !== match[2]) throw new Error("audit_chunk_hash_mismatch");
      const object = JSON.parse(stored.toString("utf8"));
      // Legacy incident chunks are base64. Later codecs are not guessed.
      if (typeof object.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(object.data)) throw new Error("audit_unsupported_partial_encoding");
      const bytes = Buffer.from(object.data, "base64");
      if (bytes.toString("base64") !== object.data || bytes.length > 4 * 1024 * 1024) throw new Error("audit_chunk_encoding_invalid");
      total += bytes.length;
      if (total > MAX_BYTES) throw new Error("audit_response_too_large");
      fragments.push(bytes);
    }
    const prefixText = Buffer.concat(fragments, total).toString("utf8");
    let completeEnvelope = false, payload;
    try { payload = JSON.parse(prefixText).payload; completeEnvelope = true; }
    catch { payload = completePayloadPrefix(prefixText); }
    attempts.push({ attempt, claimPresent: true, completionRecordPresent: false,
      chunkCount: records.length, bankedBytes: total, completeEnvelope,
      completeNativePayload: Boolean(payload), ...imageSummary(payload), requestSha256: claim.requestHash });
  }
  return { contractVersion: "designpro.atlas-provider-readonly-audit.v1", requestId, generationId,
    state: row.state, errorCode: row.error?.code || null, attempts, writes: 0, providerCalls: 0 };
}

module.exports = { inspectAtlasProviderCache, completePayloadPrefix };
if (require.main === module) {
  const { createClient } = require("@supabase/supabase-js");
  const [requestId, generationId] = process.argv.slice(2);
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || process.argv.length !== 4) { console.error("audit_configuration_invalid"); process.exitCode = 1; }
  else inspectAtlasProviderCache({ supabase: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), requestId, generationId })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(/^audit_[a-z_]+$/.test(error.message) ? error.message : "audit_failed"); process.exitCode = 1; });
}
