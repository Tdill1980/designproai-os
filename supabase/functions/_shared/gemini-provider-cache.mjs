// Server-only durable image-provider receipts. A transport timeout is not a
// creative refusal and must never silently buy another image. Private paths
// deliberately live outside every customer-readable Storage subtree.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export const GEMINI_PROVIDER_CACHE_CONTRACT = 'designpro.gemini-provider-cache.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const PREFIX = 'designpro-provider-private/v1';
const CHUNK_BYTES = 4 * 1024 * 1024;
const STORED_CHUNK_BYTES = 6 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const TEXT_FRAGMENT_ENCODING = 'utf8-json-fragments.v1';
const TEXT_FRAGMENT_CODE_UNITS = 1024 * 1024;
const MAX_TEXT_FRAGMENTS = 128;
const MAX_CHUNK_WRITES = 2;
const JSON_STRING_CODE_UNITS = 64 * 1024;
const MAX_JSON_DEPTH = 64;
const encoder = new TextEncoder();

export class GeminiProviderError extends Error {
  constructor(code, status = 500, providerOutcome = 'not_sent', imageRequestCount = 0) {
    super(code);
    this.name = 'GeminiProviderError';
    this.code = code;
    this.status = status;
    this.providerOutcome = providerOutcome;
    this.imageRequestCount = imageRequestCount;
    this.retryable = status === 503 && providerOutcome !== 'unknown';
    this.providerRetryDisposition = providerOutcome === 'unknown' ? 'operator_required'
      : this.retryable ? 'retry_read_or_storage' : 'correct_request';
  }
}

export async function providerSha256(value) {
  // Native incremental hashing avoids another full response-sized WebCrypto
  // input allocation. node:crypto and node:buffer are supported by Deno.
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  return createHash('sha256').update(bytes).digest('hex');
}

function stringBoundary(value, start, limit) {
  let end = Math.min(value.length, start + limit);
  if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff
    && value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff) end -= 1;
  return end;
}

function* jsonStringTokens(value) {
  yield '"';
  for (let start = 0; start < value.length;) {
    const end = stringBoundary(value, start, JSON_STRING_CODE_UNITS);
    // JSON.stringify supplies the exact escaping for control characters and
    // lone surrogates. Paired surrogates never cross a token boundary.
    yield JSON.stringify(value.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}

function invalidJson() {
  return new GeminiProviderError('provider_response_invalid', 502, 'received', 1);
}

// Provider JSON contains plain records, arrays and primitives. Refuse custom
// serializers/getters/cycles rather than allowing hidden work during banking.
// For that input domain the concatenated tokens equal JSON.stringify exactly.
function* jsonTokens(value, ancestors = new Set(), depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw invalidJson();
  if (typeof value === 'string') { yield* jsonStringTokens(value); return; }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    yield JSON.stringify(value); return;
  }
  if (typeof value !== 'object' || ancestors.has(value)) throw invalidJson();
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : ![Object.prototype, null].includes(prototype)) throw invalidJson();
  const serializer = Object.getOwnPropertyDescriptor(value, 'toJSON');
  if (serializer && (!Object.hasOwn(serializer, 'value') || typeof serializer.value === 'function')) throw invalidJson();
  ancestors.add(value);
  try {
    if (array) {
      yield '[';
      for (let index = 0; index < value.length; index += 1) {
        if (index) yield ',';
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor && !Object.hasOwn(descriptor, 'value')) throw invalidJson();
        yield* jsonTokens(descriptor?.value === undefined ? null : descriptor.value, ancestors, depth + 1);
      }
      yield ']';
    } else {
      yield '{';
      let first = true;
      for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalidJson();
        if (descriptor.value === undefined) continue;
        if (!first) yield ',';
        first = false;
        yield* jsonStringTokens(key);
        yield ':';
        yield* jsonTokens(descriptor.value, ancestors, depth + 1);
      }
      yield '}';
    }
  } finally { ancestors.delete(value); }
}

function* jsonTextFragments(value) {
  let pieces = [];
  let used = 0;
  for (const token of jsonTokens(value)) {
    for (let start = 0; start < token.length;) {
      const end = stringBoundary(token, start, TEXT_FRAGMENT_CODE_UNITS - used);
      if (end === start) {
        yield pieces.join(''); pieces = []; used = 0; continue;
      }
      pieces.push(token.slice(start, end));
      used += end - start;
      start = end;
      if (used === TEXT_FRAGMENT_CODE_UNITS) {
        yield pieces.join(''); pieces = []; used = 0;
      } else if (pieces.length >= 256) {
        // Bound the number of tiny token references without making another
        // response-sized string or array for a document with many fields.
        pieces = [pieces.join('')];
      }
    }
  }
  if (used) yield pieces.join('');
}

function normalizeIdentity(value) {
  if (!value || typeof value !== 'object') throw new GeminiProviderError('provider_request_identity_required', 400);
  const result = {};
  for (const key of ['ownerId', 'requestId', 'generationId']) {
    const id = String(value[key] || '').toLowerCase();
    if (!UUID.test(id)) throw new GeminiProviderError('provider_request_identity_invalid', 400);
    result[key] = id;
  }
  for (const key of ['mode', 'attemptKey']) {
    const text = String(value[key] || '');
    if (!/^[a-z][a-z0-9:._-]{0,119}$/.test(text)) throw new GeminiProviderError('provider_request_attempt_invalid', 400);
    result[key] = text;
  }
  return result;
}

// This is checked again after a process restart, even when the image is cached.
// A new lease may recover the same creative attempt; an expired lease may not.
export async function authorizeAtlasProviderRequest(supabase, providerRequest, ownerId, now = Date.now) {
  const identity = normalizeIdentity({ ...providerRequest, ownerId, mode: 'atlas' });
  const claimToken = String(providerRequest.claimToken || '').toLowerCase();
  if (!UUID.test(claimToken)) throw new GeminiProviderError('provider_claim_invalid', 403);
  const { data, error } = await supabase.from('designpro_generation_requests')
    .select('id,generation_id,owner_id,state,lease_token,lease_expires_at,parent_atlas_revision_id,revision_context_hash')
    .eq('id', identity.requestId).maybeSingle();
  if (error) throw new GeminiProviderError('provider_claim_lookup_failed', 503);
  if (!data || data.owner_id !== identity.ownerId || data.generation_id !== identity.generationId
    || data.state !== 'leased' || data.lease_token !== claimToken
    || !(Date.parse(data.lease_expires_at) > now())) {
    throw new GeminiProviderError('provider_claim_invalid', 403);
  }
  return { ...identity, parentAtlasRevisionId: data.parent_atlas_revision_id ?? null, revisionContextHash: data.revision_context_hash ?? null };
}

function isMissing(error) {
  return Number(error?.statusCode ?? error?.status) === 404
    || ['NoSuchKey', 'not_found'].includes(error?.code)
    || /^(?:Object not found|The resource was not found|Not found)$/i.test(String(error?.message || ''));
}

async function readBytes(bucket, path, maximum = MAX_RESPONSE_BYTES) {
  let downloaded;
  try { downloaded = await bucket.download(path); }
  catch { throw new GeminiProviderError('provider_cache_read_failed', 503); }
  const { data, error } = downloaded;
  if (error) {
    if (isMissing(error)) return null;
    throw new GeminiProviderError('provider_cache_read_failed', 503);
  }
  if (!data || (Number.isFinite(data.size) && data.size > maximum)) throw new GeminiProviderError('provider_cache_invalid', 409);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length > maximum) throw new GeminiProviderError('provider_cache_invalid', 409);
  return bytes;
}

async function readJson(bucket, path) {
  const bytes = await readBytes(bucket, path, 64 * 1024);
  if (!bytes) return null;
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new GeminiProviderError('provider_cache_invalid', 409); }
}

export async function putImmutableProviderArtifact(bucket, path, bytes, contentType = 'application/octet-stream') {
  const contentHash = await providerSha256(bytes);
  return putHashedImmutableArtifact(bucket, path, bytes, contentType, contentHash);
}

async function putHashedImmutableArtifact(bucket, path, bytes, contentType, contentHash) {
  let uploaded;
  try { uploaded = await bucket.upload(path, bytes, { contentType, upsert: false }); }
  catch { uploaded = { error: true }; }
  const { error } = uploaded;
  if (error) {
    // Includes a lost upload acknowledgement: only identical stored bytes count
    // as success. Never upsert an old canonical image during response recovery.
    const existing = await readBytes(bucket, path);
    if (!existing || await providerSha256(existing) !== contentHash) {
      throw new GeminiProviderError('provider_artifact_write_failed', 503, 'received', 1);
    }
  }
  return { storagePath: path, contentHash, byteSize: bytes.length };
}

async function saveResult(bucket, prefix, claim, result) {
  const chunks = [];
  const pending = new Map();
  const responseHash = createHash('sha256');
  let byteSize = 0;
  const settleOne = async () => {
    const completed = await Promise.race(pending.values());
    pending.delete(completed.index);
    if (completed.error) throw completed.error;
    chunks[completed.index] = completed.ref;
  };
  // Do not JSON.stringify/encode the complete 4K response and original request.
  // That made multiple response-sized allocations and base64-encoded already
  // encoded images again, exhausting the Edge CPU/memory budget mid-write.
  // Each new chunk is a valid JSON document holding bounded UTF-8 text; the
  // private native exchange, including every thought signature, is unchanged.
  // Two independent Storage writes may overlap, but only those two buffers
  // stay in flight. Slot order is reserved before dispatch so a faster later
  // upload cannot reorder the native exchange or publish an early manifest.
  try {
    const fragments = jsonTextFragments(result);
    while (true) {
      if (pending.size >= MAX_CHUNK_WRITES) await settleOne();
      const next = fragments.next();
      if (next.done) break;
      const text = next.value;
      const rawByteSize = Buffer.byteLength(text, 'utf8');
      byteSize += rawByteSize;
      if (byteSize > MAX_RESPONSE_BYTES || chunks.length >= MAX_TEXT_FRAGMENTS) {
        throw new GeminiProviderError('provider_response_too_large', 502, 'received', 1);
      }
      responseHash.update(text, 'utf8');
      const stored = Buffer.from(JSON.stringify({ text }), 'utf8');
      const hash = await providerSha256(stored);
      const index = chunks.length;
      chunks.push(null);
      pending.set(index, putHashedImmutableArtifact(bucket, `${prefix}/result/${index}-${hash}.jsonpart`, stored, 'application/json', hash)
        .then(ref => ({ index, ref: { ...ref, rawByteSize } }), error => ({ index, error })));
    }
    while (pending.size) await settleOne();
  } catch (error) {
    // Await every started write, including other failures, before returning.
    // No detached work or swallowed rejection may outlive this failed receipt.
    const completed = await Promise.all(pending.values());
    const errors = [error, ...completed.filter(item => item.error).map(item => item.error)];
    if (errors.length === 1) throw error;
    throw Object.assign(new AggregateError(errors, String(error?.message || 'provider_artifact_write_failed'), { cause: error }), {
      code: error.code, status: error.status, providerOutcome: error.providerOutcome,
      imageRequestCount: error.imageRequestCount, retryable: error.retryable,
      providerRetryDisposition: error.providerRetryDisposition,
    });
  }
  const receipt = {
    contractVersion: GEMINI_PROVIDER_CACHE_CONTRACT, requestHash: claim.requestHash,
    outputRequestId: claim.outputRequestId, responseHash: responseHash.digest('hex'),
    encoding: TEXT_FRAGMENT_ENCODING, byteSize, chunks,
  };
  await putImmutableProviderArtifact(bucket, `${prefix}/response.json`, encoder.encode(JSON.stringify(receipt)), 'application/json');
}

async function loadResult(bucket, prefix, claim) {
  const receipt = await readJson(bucket, `${prefix}/response.json`);
  if (!receipt) throw new GeminiProviderError('provider_outcome_unknown', 409, 'unknown', 1);
  if (receipt.contractVersion !== GEMINI_PROVIDER_CACHE_CONTRACT || receipt.requestHash !== claim.requestHash
    || receipt.outputRequestId !== claim.outputRequestId || !HASH.test(receipt.responseHash)
    || !Number.isInteger(receipt.byteSize) || receipt.byteSize < 1 || receipt.byteSize > MAX_RESPONSE_BYTES
    || (receipt.encoding !== undefined && receipt.encoding !== TEXT_FRAGMENT_ENCODING)
    || !Array.isArray(receipt.chunks) || !receipt.chunks.length
    || receipt.chunks.length > (receipt.encoding === TEXT_FRAGMENT_ENCODING ? MAX_TEXT_FRAGMENTS : 16)) {
    throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1);
  }
  if (receipt.encoding === TEXT_FRAGMENT_ENCODING) return loadTextResult(bucket, prefix, receipt);
  const bytes = new Uint8Array(receipt.byteSize);
  let offset = 0;
  for (let index = 0; index < receipt.chunks.length; index += 1) {
    const ref = receipt.chunks[index];
    if (!HASH.test(ref?.contentHash) || ref.storagePath !== `${prefix}/result/${index}-${ref.contentHash}.jsonpart`
      || !Number.isSafeInteger(ref.byteSize) || ref.byteSize < 1 || ref.byteSize > STORED_CHUNK_BYTES
      || !Number.isSafeInteger(ref.rawByteSize) || ref.rawByteSize < 1 || ref.rawByteSize > CHUNK_BYTES
      || offset + ref.rawByteSize > bytes.length) {
      throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1);
    }
    const stored = await readBytes(bucket, ref.storagePath, STORED_CHUNK_BYTES);
    if (!stored || stored.length !== ref.byteSize || await providerSha256(stored) !== ref.contentHash) {
      throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1);
    }
    let chunk;
    try {
      const object = JSON.parse(new TextDecoder().decode(stored));
      if (typeof object.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(object.data)) throw new Error();
      chunk = Buffer.from(object.data, 'base64');
      if (chunk.toString('base64') !== object.data) throw new Error();
    } catch { throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1); }
    if (chunk.length !== ref.rawByteSize || chunk.length > CHUNK_BYTES || offset + chunk.length > bytes.length) {
      throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1);
    }
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== bytes.length || await providerSha256(bytes) !== receipt.responseHash) throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1);
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1); }
}

async function loadTextResult(bucket, prefix, receipt) {
  const fragments = [];
  const responseHash = createHash('sha256');
  let byteSize = 0;
  for (let index = 0; index < receipt.chunks.length; index += 1) {
    const ref = receipt.chunks[index];
    if (!HASH.test(ref?.contentHash) || ref.storagePath !== `${prefix}/result/${index}-${ref.contentHash}.jsonpart`
      || !Number.isSafeInteger(ref.byteSize) || ref.byteSize < 1 || ref.byteSize > STORED_CHUNK_BYTES
      || !Number.isSafeInteger(ref.rawByteSize) || ref.rawByteSize < 1
      || ref.rawByteSize > 3 * TEXT_FRAGMENT_CODE_UNITS || byteSize + ref.rawByteSize > receipt.byteSize) {
      throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1);
    }
    const stored = await readBytes(bucket, ref.storagePath, STORED_CHUNK_BYTES);
    if (!stored || stored.length !== ref.byteSize || await providerSha256(stored) !== ref.contentHash) {
      throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1);
    }
    let text;
    try {
      const object = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stored));
      text = object.text;
      if (typeof text !== 'string' || !text.length || text.length > TEXT_FRAGMENT_CODE_UNITS
        || Buffer.byteLength(text, 'utf8') !== ref.rawByteSize
        || (text.charCodeAt(0) >= 0xdc00 && text.charCodeAt(0) <= 0xdfff)
        || (text.charCodeAt(text.length - 1) >= 0xd800 && text.charCodeAt(text.length - 1) <= 0xdbff)) throw new Error();
    } catch { throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1); }
    responseHash.update(text, 'utf8');
    byteSize += ref.rawByteSize;
    fragments.push(text);
  }
  if (byteSize !== receipt.byteSize || responseHash.digest('hex') !== receipt.responseHash) {
    throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1);
  }
  const json = fragments.join('');
  fragments.length = 0;
  try { return JSON.parse(json); }
  catch { throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1); }
}

// An authorized revision may read its parent's completed native exchange even
// though that older generation lease has ended. The caller must prove the
// current child/parent relationship; this function never creates a claim or
// invokes the provider, and never substitutes a new image into signed parts.
export async function readDurableImageProviderExchange({ bucket, ownerId, generationId, requestId,
  providerRequestKey, authorize }) {
  if (![ownerId, generationId, requestId].every(value => UUID.test(String(value || '')))
    || !HASH.test(String(providerRequestKey || '')) || typeof authorize !== 'function') {
    throw new GeminiProviderError('provider_parent_identity_invalid', 400);
  }
  await authorize();
  const prefix = `${PREFIX}/${ownerId}/${generationId}/${providerRequestKey}`;
  const claim = await readJson(bucket, `${prefix}/claim.json`);
  if (!claim) throw new GeminiProviderError('provider_parent_history_unavailable', 409);
  const identity = normalizeIdentity(claim);
  if (identity.ownerId !== ownerId || identity.generationId !== generationId || identity.requestId !== requestId
    || claim.contractVersion !== GEMINI_PROVIDER_CACHE_CONTRACT || !HASH.test(claim.requestHash)
    || providerRequestKey !== await providerSha256(JSON.stringify({ contractVersion: GEMINI_PROVIDER_CACHE_CONTRACT, ...identity }))) {
    throw new GeminiProviderError('provider_parent_identity_invalid', 409);
  }
  const result = await loadResult(bucket, prefix, claim);
  if (!(result.status >= 200 && result.status < 300) || typeof result.privateRequest !== 'string') {
    throw new GeminiProviderError('provider_parent_history_unavailable', 409);
  }
  let request;
  try { request = JSON.parse(result.privateRequest); }
  catch { throw new GeminiProviderError('provider_parent_history_invalid', 409); }
  await authorize();
  return { identity, requestHash: claim.requestHash, providerRequestKey, nativeRequest: request,
    payload: result.payload, privateExchangeHash: await providerSha256(JSON.stringify({ privateRequest: result.privateRequest, payload: result.payload })) };
}

const canonicalJson = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;

// Revisions are authorized by the currently leased immutable child request.
// The browser never supplies native turns or thought signatures. Replay keeps
// every parent part byte-for-byte; the edited canonical image is a NEW user
// reference, never a substitution inside a signed model part.
export async function prepareAtlasRevisionProviderContents({ supabase, ownerId, providerRequest,
  revisionContextHash, currentUserParts }) {
  const authorize = () => authorizeAtlasProviderRequest(supabase, providerRequest, ownerId);
  await authorize();
  const { data: row, error } = await supabase.from('designpro_generation_requests')
    .select('id,generation_id,owner_id,parent_atlas_revision_id,revision_context,revision_context_hash')
    .eq('id', providerRequest.requestId).maybeSingle();
  if (error) throw new GeminiProviderError('atlas_revision_context_lookup_failed', 503);
  const context = row?.revision_context;
  if (!row?.parent_atlas_revision_id || row.owner_id !== ownerId || row.revision_context_hash !== revisionContextHash
    || context?.contractVersion !== 'designpro.atlas-revision-intake.v1'
    || context.parentAtlasRevisionId !== row.parent_atlas_revision_id || context.generationId !== row.generation_id
    || await providerSha256(canonicalJson(context)) !== revisionContextHash) {
    throw new GeminiProviderError('atlas_revision_context_invalid', 409);
  }
  const { data: parent, error: parentError } = await supabase.from('designpro_flat_atlas_revisions')
    .select('id,request_id,generation_id,owner_id,master_storage_path,master_content_hash,master_byte_size,master_content_type,metadata')
    .eq('id', row.parent_atlas_revision_id).maybeSingle();
  if (parentError) throw new GeminiProviderError('atlas_revision_parent_lookup_failed', 503);
  if (!parent || parent.owner_id !== ownerId || parent.generation_id !== row.generation_id || parent.request_id !== context.parentRequestId
    || parent.master_content_hash !== context.parentMaster?.contentHash || parent.master_storage_path !== context.parentMaster?.storagePath
    || Number(parent.master_byte_size) !== context.parentMaster?.byteSize || parent.master_content_type !== context.parentMaster?.contentType
    || parent.metadata?.masterQcPassed !== true) throw new GeminiProviderError('atlas_revision_parent_identity_mismatch', 409);
  const history = context.history;
  const bucket = supabase.storage.from('wrap-files');
  let contents = [];
  if (history?.mode === 'generate-content-replay') {
    const exchange = await readDurableImageProviderExchange({ bucket, ownerId, generationId: row.generation_id,
      requestId: parent.request_id, providerRequestKey: history.providerRequestKey, authorize });
    const modelTurn = exchange.payload?.candidates?.length === 1 && exchange.payload.candidates[0]?.content;
    if (exchange.privateExchangeHash !== history.privateExchangeHash || exchange.requestHash !== history.requestHash
      || !Array.isArray(exchange.nativeRequest?.contents) || !exchange.nativeRequest.contents.length
      || modelTurn?.role !== 'model' || !Array.isArray(modelTurn.parts) || !modelTurn.parts.length
      || exchange.nativeRequest.contents.some(turn => !['user', 'model'].includes(turn.role) || !Array.isArray(turn.parts))) {
      throw new GeminiProviderError('atlas_revision_parent_history_invalid', 409);
    }
    const images = modelTurn.parts.filter(part => part?.thought !== true && part?.inlineData?.data);
    const source = (parent.metadata.atlasEdgeProvenance || []).filter(p => p.providerRequestKey === history.providerRequestKey
      && p.masterSha256 === parent.metadata.rawProviderResponseHash);
    if (images.length !== 1 || source.length !== 1 || images[0].inlineData.mimeType !== 'image/png') throw new GeminiProviderError('atlas_revision_parent_history_invalid', 409);
    const binary = atob(images[0].inlineData.data);
    const bytes = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
    if (await providerSha256(bytes) !== source[0].masterSha256) throw new GeminiProviderError('atlas_revision_parent_history_invalid', 409);
    contents = [...exchange.nativeRequest.contents, modelTurn];
  } else if (history?.mode !== 'image-reference'
    || (parent.metadata.atlasEdgeProvenance || []).some(p => p.providerRequestKey || p.providerCacheContract)) {
    throw new GeminiProviderError('atlas_revision_parent_history_required', 409);
  }
  const parts = [{ text: `REVISION OF THE SELECTED SAVED DESIGN. Use the following canonical parent artwork as the design authority. Apply this exact customer instruction: ${context.instruction}\nAffected artwork surfaces: ${context.affectedSurfaces.join(', ')}. Keep the six-surface ATLAS target layout, continuous rectangular artwork and unaffected brand elements consistent with that saved design.` }];
  for (const ref of [context.parentMaster, ...(context.editAssets || [])]) {
    if (!HASH.test(ref.contentHash) || !Number.isSafeInteger(ref.byteSize) || ref.byteSize < 1 || ref.byteSize > MAX_RESPONSE_BYTES
      || !['image/png', 'image/jpeg', 'image/webp'].includes(ref.contentType)
      || !/^[A-Za-z0-9._/-]+$/.test(String(ref.storagePath || ''))
      || ref.storagePath.split('/').some(segment => !segment || segment === '.' || segment === '..')
      || !(ref.storagePath.startsWith(`designpro/user_${ownerId}/`) || ref.storagePath.startsWith(`users/${ownerId}/revisions/`))) {
      throw new GeminiProviderError('atlas_revision_asset_identity_invalid', 409);
    }
    const bytes = await readBytes(bucket, ref.storagePath);
    if (!bytes || bytes.length !== ref.byteSize || await providerSha256(bytes) !== ref.contentHash) throw new GeminiProviderError('atlas_revision_asset_hash_mismatch', 409);
    let binary = '';
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    parts.push({ inlineData: { mimeType: ref.contentType, data: btoa(binary) } });
  }
  // Keep the original prompt, pinned teaching proof and GENIE target guide in
  // their existing order. Parent/edit references precede the final target guide.
  const priorImageKeys = new Set(contents.flatMap(turn => turn.parts.filter(part => part?.inlineData?.data)
    .map(part => canonicalJson(part.inlineData))));
  let reusedImageCount = 0;
  // Only NEW redundant attachments are omitted. All old turns, text, images,
  // order, thought flags and signatures remain untouched in `contents`.
  const currentParts = [currentUserParts[0], ...parts, ...currentUserParts.slice(1)].filter(part => {
    if (!part?.inlineData?.data) return true;
    const key = canonicalJson(part.inlineData);
    if (priorImageKeys.has(key)) { reusedImageCount += 1; return false; }
    priorImageKeys.add(key); return true;
  });
  contents.push({ role: 'user', parts: currentParts });
  const modelInputImageCount = contents.reduce((count, turn) => count + turn.parts.filter(part => part?.inlineData?.data || part?.fileData).length, 0);
  if (modelInputImageCount > 14) throw new GeminiProviderError('atlas_revision_history_reference_budget_exceeded', 409);
  await authorize();
  return { contents, modelInputImageCount, revisionContextHash, parentAtlasRevisionId: parent.id,
    parentMasterContentHash: parent.master_content_hash, revisionHistoryMode: history.mode, reusedImageCount,
    remainingImageCapacity: 14 - modelInputImageCount };
}

/**
 * invoke returns {status, payload, retryAfterSeconds?}; it must make ONE request.
 * authorize must throw unless the current caller still owns the active lease.
 * Store the entire native provider response, including opaque thought state.
 * This is application idempotency, not a claim that the provider offers it.
 */
export async function runDurableImageProviderRequest({
  bucket, identity: suppliedIdentity, requestHash, authorize, invoke, cacheOnly = false,
  outputRequestId = crypto.randomUUID(), privateRequest = null,
}) {
  if (typeof authorize !== 'function' || typeof invoke !== 'function' || !HASH.test(requestHash)) {
    throw new GeminiProviderError('provider_cache_arguments_invalid', 400);
  }
  const identity = normalizeIdentity(suppliedIdentity);
  if (privateRequest != null && (typeof privateRequest !== 'string' || Buffer.byteLength(privateRequest, 'utf8') > 20 * 1024 * 1024)) {
    throw new GeminiProviderError('provider_private_request_invalid', 400);
  }
  await authorize();
  const key = await providerSha256(JSON.stringify({ contractVersion: GEMINI_PROVIDER_CACHE_CONTRACT, ...identity }));
  const prefix = `${PREFIX}/${identity.ownerId}/${identity.generationId}/${key}`;
  const claimPath = `${prefix}/claim.json`;
  let claim = await readJson(bucket, claimPath);
  let cacheHit = true;
  if (!claim && cacheOnly) throw new GeminiProviderError('provider_cache_miss', 404);
  if (!claim) {
    if (!UUID.test(outputRequestId)) throw new GeminiProviderError('provider_output_identity_invalid', 400);
    const candidate = { contractVersion: GEMINI_PROVIDER_CACHE_CONTRACT, ...identity, requestHash, outputRequestId };
    let reserved;
    try { reserved = await bucket.upload(claimPath, encoder.encode(JSON.stringify(candidate)), { contentType: 'application/json', upsert: false }); }
    catch { reserved = { error: true }; }
    const { error } = reserved;
    if (error) {
      // Atomic create lost a race OR the acknowledgement was lost. Read only;
      // an uncertain create acknowledgement is never authority to call Gemini.
      claim = await readJson(bucket, claimPath);
      if (!claim) throw new GeminiProviderError('provider_claim_write_unknown', 503);
    } else {
      claim = candidate;
      cacheHit = false;
    }
  }
  if (claim.contractVersion !== GEMINI_PROVIDER_CACHE_CONTRACT || claim.requestHash !== requestHash
    || Object.keys(identity).some((field) => claim[field] !== identity[field]) || !UUID.test(claim.outputRequestId)) {
    throw new GeminiProviderError('provider_request_identity_conflict', 409);
  }
  let result;
  if (cacheHit) {
    result = await loadResult(bucket, prefix, claim);
    if (privateRequest != null && result.privateRequest !== privateRequest) {
      throw new GeminiProviderError('provider_request_identity_conflict', 409, 'received', 1);
    }
  } else {
    await authorize();
    try { result = await invoke(); }
    catch { throw new GeminiProviderError('provider_outcome_unknown', 409, 'unknown', 1); }
    if (!result || !Number.isInteger(result.status) || result.status < 100 || result.status > 599) {
      throw new GeminiProviderError('provider_response_invalid', 502, 'unknown', 1);
    }
    // Also bank the exact native request when supplied. It stays private and is
    // never the public response: this preserves the original user/settings
    // context as well as all returned model parts through response recovery.
    await saveResult(bucket, prefix, claim, { ...result, privateRequest });
  }
  if (!result || !Number.isInteger(result.status)) throw new GeminiProviderError('provider_cache_invalid', 409, 'received', 1);
  if (result.status < 200 || result.status >= 300) {
    const error = new GeminiProviderError(`provider_http_${result.status}`, result.status === 429 ? 429 : 502,
      result.status >= 500 || result.status === 408 ? 'unknown' : 'rejected', 1);
    error.providerStatus = result.status;
    error.retryAfterSeconds = result.retryAfterSeconds ?? null;
    error.retryable = false;
    error.providerRetryDisposition = 'operator_required';
    throw error;
  }
  return {
    payload: result.payload, requestId: claim.outputRequestId, providerCacheHit: cacheHit,
    providerCacheContract: GEMINI_PROVIDER_CACHE_CONTRACT, providerRequestKey: key,
    providerResponseStoragePath: `${prefix}/response.json`, imageRequestCount: 1,
  };
}
