"use strict";

// Internal staff workflow only. Runtime routes authenticate the worker secret;
// the gateway supplies the verified actor ID. Every operation checks current
// QC membership again. Client flags never become trusted geometry evidence.
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { canonicalUuid } = require('./runtime-contract.cjs');
const { MAX_STANDARD_UPLOAD_BYTES, spoolImmutableBuffer, uploadSpoolWithTus, removeCommittedSpool } = require('./zip-spool.cjs');
const { CONTRACT: PROVIDER_CONTRACT, validateTemplateSourceGeometry, validateTemplateImageReference,
  recreateBrandedTemplateCandidate, approveAndBankTemplateCandidate } = require('./panelpro-template-provider.cjs');

const CONTRACT = 'designpro.panelpro-template-service.v1';
const FEATURE_FLAG = 'DESIGNPRO_PANELPROFILE_TEMPLATE_RECREATE_ENABLED';
const PRIVATE_PREFIX = 'designpro-template-private/v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 64 * 1024 * 1024;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'application/pdf': 'pdf', 'application/postscript': 'eps', 'application/json': 'json' };
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => sha(stable(value));
const failure = (code, status = 409, retryable = false) => Object.assign(new Error(code), { code, status, retryable });
function resultOf(result, code) {
  if (result?.error) {
    const matched = String(result.error.message || '').match(/\btemplate_[a-z0-9_]+\b/);
    const name = matched?.[0] || code;
    throw failure(name, name.includes('permission') ? 403 : matched ? 409 : 503, !matched);
  }
  return result?.data;
}
function checkedRef(ownerId, ref) {
  const path = ref?.storagePath;
  if (!HASH.test(ref?.contentHash || '') || typeof path !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(path)
    || path.split('/').some(part => !part || part === '..' || part === '.')
    || ![`designpro/user_${ownerId}/`, `users/${ownerId}/revisions/`, `${PRIVATE_PREFIX}/${ownerId}/sources/`,
      `${PRIVATE_PREFIX}/${ownerId}/candidates/`].some(prefix => path.startsWith(prefix))) throw failure('template_artifact_scope_invalid', 403);
  return { storagePath: path, contentHash: ref.contentHash };
}
function vectorType(bytes) {
  const text = bytes.subarray(0, 1024).toString('utf8');
  if (text.startsWith('%PDF-')) return 'application/pdf';
  if (text.startsWith('%!PS')) return 'application/postscript';
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text)
    && !/<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|@import|\burl\s*\(|\b(?:href|src)\s*=/i.test(bytes.toString('utf8'))) return 'image/svg+xml';
  throw failure('template_original_vector_required');
}
function reviewSource(raw, geometry) {
  if (!raw || !ID.test(raw.reviewRef) || raw.measuredDimensions !== true || raw.cutAreasReviewed !== true
    || raw.rasterMatchesVector !== true || stable(raw.vehicleIdentity) !== stable(geometry.vehicle)
    || !Number.isFinite(raw.fitToleranceInches) || raw.fitToleranceInches < 0.001 || raw.fitToleranceInches > 1
    || typeof raw.physicalMeasurementReference !== 'string' || !raw.physicalMeasurementReference.trim()
    || raw.physicalMeasurementReference.length > 500) throw failure('template_measured_source_review_required');
  return { reviewRef: raw.reviewRef, vehicleIdentity: geometry.vehicle, measuredDimensions: true,
    cutAreasReviewed: true, rasterMatchesVector: true, fitToleranceInches: raw.fitToleranceInches,
    physicalMeasurementReference: raw.physicalMeasurementReference.trim() };
}

function createPanelproTemplateService({ supabase, workerId = `template-${randomUUID()}`, enabled = false,
  apiKey = '', invoke, readBytes: readOverride, spoolDir, supabaseUrl, serviceRoleKey, tusEndpoint,
  tusUploadOptions = {}, pollMs = 2500, schedule = queueMicrotask } = {}) {
  if (!supabase?.from || !supabase?.rpc || !supabase?.storage) throw failure('template_service_dependencies_required', 500);
  let timer = null, busy = false, stopped = false, lastError = null;
  const active = new Set();
  const bucket = supabase.storage.from('wrap-files');
  const helpers = () => import(pathToFileURL(resolve(__dirname, '../supabase/functions/_shared/gemini-provider-cache.mjs')).href);
  const rpc = async (name, args) => resultOf(await supabase.rpc(name, args), `${name}_failed`);
  async function requireQc(actorId) {
    canonicalUuid(actorId, 'actorId');
    const row = resultOf(await supabase.from('designpro_qc_members').select('user_id,can_preflight')
      .eq('user_id', actorId).maybeSingle(), 'template_qc_lookup_failed');
    if (row?.can_preflight !== true) throw failure('template_qc_permission_required', 403);
    return { canReview: true, reviewerId: actorId };
  }
  function requireEnabled() {
    if (enabled !== true) throw failure('template_recreate_not_enabled', 503);
    if (!invoke && (typeof apiKey !== 'string' || apiKey.length < 20)) throw failure('template_provider_credentials_missing', 503);
  }
  async function readBytes(ownerId, ref, signal, limit = MAX_BYTES) {
    checkedRef(ownerId, ref);
    if (signal?.aborted) throw failure('template_lease_lost');
    let bytes;
    if (readOverride) bytes = Buffer.from(await readOverride(ownerId, ref, signal));
    else {
      const blob = resultOf(await bucket.download(ref.storagePath), 'template_asset_read_failed');
      if (!blob || !Number.isFinite(blob.size) || blob.size < 1 || blob.size > limit) throw failure('template_source_resource_limit');
      bytes = Buffer.from(await blob.arrayBuffer());
    }
    if (!bytes.length || bytes.length > limit) throw failure('template_source_resource_limit');
    if (sha(bytes) !== ref.contentHash) throw failure('template_source_hash_mismatch');
    return bytes;
  }
  async function persistBytes(ownerId, group, role, mimeType, raw, signal) {
    const bytes = Buffer.from(raw), contentHash = sha(bytes), ext = TYPES[mimeType];
    if (!ext || !/^[a-z-]+$/.test(role) || !bytes.length || bytes.length > MAX_BYTES) throw failure('template_artifact_identity_invalid');
    if (signal?.aborted) throw failure('template_lease_lost');
    const approved = group.kind === 'approved';
    const prefix = approved ? `designpro/user_${ownerId}/${canonicalUuid(group.id, 'candidateId')}/panelprofile-templates`
      : `${PRIVATE_PREFIX}/${ownerId}/${group.kind}/${group.id}`;
    if (!approved && !(group.kind === 'sources' && HASH.test(group.id)
      || group.kind === 'candidates' && canonicalUuid(group.id, 'candidateId') === group.id)) throw failure('template_artifact_group_invalid');
    const storagePath = `${prefix}/${role}-${contentHash}.${ext}`;
    checkedRef(ownerId, { storagePath, contentHash });
    if (bytes.length <= MAX_STANDARD_UPLOAD_BYTES) {
      const { putImmutableProviderArtifact } = await helpers();
      await putImmutableProviderArtifact(bucket, storagePath, bytes, mimeType);
    } else {
      const spool = await spoolImmutableBuffer({ spoolDir, runId: group.kind === 'sources' ? ownerId : group.id,
        materialHash: digest({ storagePath, contentHash }), bytes, signal });
      await uploadSpoolWithTus({ supabase, supabaseUrl, serviceRoleKey, endpoint: tusEndpoint, spoolDir, spool,
        storagePath, contentType: mimeType, signal, Upload: tusUploadOptions.Upload, FileUrlStorage: tusUploadOptions.FileUrlStorage });
      await removeCommittedSpool(spool);
    }
    return { storagePath, contentHash };
  }
  async function importSource(actorId, input) {
    await requireQc(actorId);
    const ownerId = canonicalUuid(input?.ownerId, 'ownerId');
    if (!ID.test(input?.templateId) || !ID.test(input?.version)) throw failure('template_source_identity_invalid');
    const refs = Object.fromEntries(['geometry', 'sourceVector', 'sourceRaster', 'brand'].map(key => [key, checkedRef(ownerId, input[key])]));
    const geometryBytes = await readBytes(ownerId, refs.geometry, null, 4 * 1024 * 1024);
    let geometry;
    try { geometry = JSON.parse(geometryBytes.toString('utf8')); } catch { throw failure('template_geometry_json_invalid'); }
    geometry = validateTemplateSourceGeometry(geometry, input);
    const review = reviewSource(input.review, geometry);
    const assetDeps = { readBytes: ref => readBytes(ownerId, ref, null, 20 * 1024 * 1024) };
    // Dimensions are never read from raster pixels; this checks only the
    // operator-supplied derivative's format and exact byte identity.
    const [vectorBytes, raster, brand] = await Promise.all([
      readBytes(ownerId, refs.sourceVector), validateTemplateImageReference(refs.sourceRaster, assetDeps),
      validateTemplateImageReference(refs.brand, assetDeps, { allowVector: true })]);
    const sourceVectorMime = vectorType(vectorBytes);
    const brandOriginal = await readBytes(ownerId, refs.brand, null, 20 * 1024 * 1024);
    const originalBrandMime = /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(brandOriginal.subarray(0, 1024).toString('utf8')) ? 'image/svg+xml' : brand.mimeType;
    const sourceKey = digest({ ownerId, templateId: input.templateId, version: input.version,
      sourceHashes: Object.fromEntries(Object.entries(refs).map(([key, ref]) => [key, ref.contentHash])), review });
    const group = { kind: 'sources', id: sourceKey };
    // Preserve the original geometry/vector/brand bytes. The provider may use a
    // rasterized SVG logo as a reference but cannot replace this original asset.
    const saved = {};
    for (const [key, role, mimeType, bytes] of [
      ['geometry', 'geometry', 'application/json', geometryBytes],
      ['sourceVector', 'source-vector', sourceVectorMime, vectorBytes],
      ['sourceRaster', 'source-raster', raster.mimeType, raster.bytes],
      ['brand', 'brand', originalBrandMime, brandOriginal],
    ]) saved[key] = await persistBytes(ownerId, group, role, mimeType, bytes);
    const source = { ownerId, templateId: input.templateId, version: input.version, ...saved, vehicle: geometry.vehicle, review };
    source.inputHash = digest(source);
    const row = await rpc('register_panelprofile_template_source', { p_actor: actorId, p_source: source });
    return { sourceId: row.id, ownerId: row.owner_id, templateId: row.template_id, version: row.version,
      inputHash: row.input_hash, geometryHash: row.geometry_hash, vehicle: row.source.vehicle, status: 'measured_source_reviewed',
      geometryReviewId: row.id, customerVisible: false };
  }
  async function loadCandidate(candidateId) {
    canonicalUuid(candidateId, 'candidateId');
    const row = resultOf(await supabase.from('panelprofile_template_candidates').select('*').eq('id', candidateId).maybeSingle(), 'template_candidate_read_failed');
    if (!row) throw failure('template_candidate_not_found', 404);
    return row;
  }
  async function loadSource(sourceId, ownerId) {
    const row = resultOf(await supabase.from('panelprofile_template_sources').select('*').eq('id', sourceId).eq('owner_id', ownerId)
      .maybeSingle(), 'template_source_read_failed');
    if (!row) throw failure('template_source_not_found', 404);
    return row;
  }
  async function signed(ownerId, ref) {
    checkedRef(ownerId, ref);
    const data = resultOf(await bucket.createSignedUrl(ref.storagePath, 300), 'template_preview_sign_failed');
    return { ...ref, signedUrl: data.signedUrl, expiresInSeconds: 300, customerVisible: false };
  }
  async function getCandidate(actorId, candidateId) {
    await requireQc(actorId);
    const row = await loadCandidate(candidateId), source = await loadSource(row.source_id, row.owner_id);
    const output = row.output || {}, previews = [];
    for (const [role, ref] of [['source-raster', source.source.sourceRaster], ['brand-original', source.source.brand],
      ['branded-template-candidate', output.display]]) if (ref) previews.push({ role, ...await signed(row.owner_id, ref) });
    const events = resultOf(await supabase.from('panelprofile_template_events').select('id,state,error_code,created_at')
      .eq('candidate_id', row.id).order('id', { ascending: true }).limit(100), 'template_event_read_failed');
    let template = null;
    if (row.bank_id) template = resultOf(await supabase.from('panelprofile_template_bank').select('template')
      .eq('id', row.bank_id).eq('owner_id', row.owner_id).maybeSingle(), 'template_bank_read_failed')?.template || null;
    return { contractVersion: CONTRACT, candidateId: row.id, sourceId: row.source_id, ownerId: row.owner_id,
      templateId: source.template_id, version: source.version, vehicle: source.source.vehicle,
      status: row.state, customerVisible: false, canReview: row.state === 'waiting_review',
      fitToleranceInches: source.source.review.fitToleranceInches, geometryHash: source.geometry_hash,
      candidateHash: output.candidateHash || null, displayContentHash: output.display?.contentHash || null,
      displayMetadata: output.displayMetadata || null, geometry: output.geometry || null, previews, template,
      error: row.error_code ? { code: row.error_code, ...row.error_detail } : null,
      events: (events || []).map(event => ({ id: event.id, state: event.state, code: event.error_code, createdAt: event.created_at })),
      stages: [
        { key: 'template.import', label: 'Measured template and original assets verified', state: 'completed' },
        { key: 'template.recreate', label: 'Recreating the branded template preview',
          state: output.display ? 'completed' : row.state === 'running' ? 'running' : row.state === 'queued' ? 'pending' : 'blocked' },
        { key: 'template.overlay-review', label: 'Reviewing template fit and installation areas',
          state: row.state === 'approved' ? 'completed' : row.state === 'waiting_review' ? 'waiting' : 'pending' },
        { key: 'template.bank', label: 'Saving the approved template for future designs', state: row.state === 'approved' ? 'completed' : 'pending' },
      ], updatedAt: row.updated_at };
  }
  async function createCandidate(actorId, input) {
    await requireQc(actorId); requireEnabled();
    canonicalUuid(input?.sourceId, 'sourceId');
    const row = await rpc('create_panelprofile_template_candidate', { p_actor: actorId, p_source_id: input.sourceId });
    schedule(() => void tick());
    return getCandidate(actorId, row.id);
  }
  async function listCandidates(actorId, filter = {}) {
    await requireQc(actorId);
    let query = supabase.from('panelprofile_template_candidates').select('id');
    if (filter.ownerId) query = query.eq('owner_id', canonicalUuid(filter.ownerId, 'ownerId'));
    if (filter.sourceId) query = query.eq('source_id', canonicalUuid(filter.sourceId, 'sourceId'));
    const rows = resultOf(await query.order('created_at', { ascending: false }).limit(20), 'template_candidate_list_failed') || [];
    return Promise.all(rows.map(row => getCandidate(actorId, row.id)));
  }
  async function approveCandidate(actorId, input) {
    await requireQc(actorId);
    const row = await loadCandidate(input?.candidateId), source = await loadSource(row.source_id, row.owner_id);
    if (!['waiting_review', 'approved'].includes(row.state) || !row.output?.candidateRef) throw failure('template_candidate_review_not_ready');
    if (input.candidateHash !== row.output.candidateHash) throw failure('template_candidate_identity_invalid');
    const review = input.review, reviewHash = digest({ candidateHash: row.output.candidateHash, review });
    if (row.state === 'approved') {
      const evidence = resultOf(await supabase.from('panelprofile_template_bank_evidence').select('review_hash').eq('candidate_id', row.id)
        .maybeSingle(), 'template_review_read_failed');
      if (evidence?.review_hash !== reviewHash) throw failure('template_review_identity_changed');
      return getCandidate(actorId, row.id);
    }
    if (row.input_hash !== source.input_hash) throw failure('template_source_identity_changed');
    await approveAndBankTemplateCandidate({ ownerId: row.owner_id, candidateRef: row.output.candidateRef, review }, {
      authorize: async ({ ownerId, operation }) => {
        if (ownerId !== row.owner_id || operation !== 'template.review') throw failure('template_artifact_scope_invalid', 403);
        return requireQc(actorId);
      },
      readBytes: ref => readBytes(row.owner_id, ref),
      persist: async (bytes, artifact) => persistBytes(row.owner_id, { kind: 'approved', id: row.id }, artifact.role, artifact.mimeType, bytes),
      bankTemplate: async entry => rpc('approve_panelprofile_template_candidate', {
        p_actor: actorId, p_id: row.id, p_candidate_hash: row.output.candidateHash,
        p_review_hash: reviewHash, p_review: review, p_entry: entry,
      }),
    });
    return getCandidate(actorId, row.id);
  }
  async function recoverCandidate(actorId, input) {
    await requireQc(actorId); requireEnabled();
    const row = await rpc('recover_panelprofile_template_candidate', { p_actor: actorId, p_id: canonicalUuid(input?.candidateId, 'candidateId') });
    schedule(() => void tick()); return getCandidate(actorId, row.id);
  }
  async function execute(claim, signal) {
    const { candidate: row, source } = claim;
    if (source.owner_id !== row.owner_id || source.id !== row.source_id || source.input_hash !== row.input_hash
      || digest(Object.fromEntries(Object.entries(source.source).filter(([key]) => key !== 'inputHash'))) !== source.input_hash) throw failure('template_source_identity_changed');
    async function authorize({ ownerId, operation }) {
      if (signal.aborted || ownerId !== row.owner_id || operation !== 'template.recreate') throw failure('template_lease_lost');
      await requireQc(row.requested_by);
      const current = await loadCandidate(row.id);
      if (current.owner_id !== row.owner_id || current.state !== 'running' || current.lease_token !== row.lease_token
        || !(Date.parse(current.lease_expires_at) > Date.now())) throw failure('template_lease_lost');
    }
    const input = { ...source.source, enabled: true, requestId: row.id, generationId: row.id,
      attemptKey: 'template:first', geometryReview: { reviewId: source.id }, cacheOnly: row.cache_only };
    const output = await recreateBrandedTemplateCandidate(input, {
      authorize, providerCacheBucket: bucket,
      readBytes: ref => readBytes(row.owner_id, ref, signal),
      persist: async (bytes, artifact) => {
        await authorize({ ownerId: row.owner_id, operation: 'template.recreate' });
        return persistBytes(row.owner_id, { kind: 'candidates', id: row.id }, artifact.role, artifact.mimeType, bytes, signal);
      },
      resolveGeometryReview: async ({ ownerId, reviewId, geometryHash }) => {
        const trusted = await loadSource(reviewId, ownerId);
        if (trusted.id !== source.id || trusted.geometry_hash !== geometryHash) throw failure('template_geometry_review_required');
        return { ownerId: trusted.owner_id, reviewId: trusted.id, geometryHash: trusted.geometry_hash,
          geometryValidated: trusted.source.review.measuredDimensions === true, cutAreasReviewed: trusted.source.review.cutAreasReviewed === true,
          fitToleranceInches: trusted.source.review.fitToleranceInches, physicalMeasurementReference: trusted.source.review.physicalMeasurementReference };
      },
      invoke: async request => {
        await authorize({ ownerId: row.owner_id, operation: 'template.recreate' });
        if (invoke) return invoke(request);
        const { fetchGeminiImageInteraction } = await import(pathToFileURL(resolve(__dirname, '../supabase/functions/_shared/gemini-image-interactions.mjs')).href);
        return fetchGeminiImageInteraction(request, { apiKey });
      },
    });
    if (output.contractVersion !== PROVIDER_CONTRACT || output.customerVisible !== false) throw failure('template_candidate_receipt_invalid');
    await rpc('finish_panelprofile_template_candidate', { p_id: row.id, p_token: row.lease_token,
      p_state: 'waiting_review', p_output: output, p_error: {} });
  }
  async function runNext() {
    if (stopped || busy || enabled !== true) return false;
    requireEnabled(); busy = true;
    let claim, heartbeat;
    const controller = new AbortController(); active.add(controller);
    try {
      claim = await rpc('claim_panelprofile_template_candidate', { p_worker: workerId, p_ttl: 180 });
      if (!claim) return false;
      heartbeat = setInterval(() => void rpc('heartbeat_panelprofile_template_candidate', {
        p_id: claim.candidate.id, p_token: claim.candidate.lease_token,
      }).then(ok => { if (!ok) controller.abort(); }).catch(() => controller.abort()), 30_000);
      heartbeat.unref?.();
      await execute(claim, controller.signal); lastError = null;
      return true;
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[a-z0-9_]+$/.test(error.code) ? error.code : 'template_worker_failed';
      lastError = code;
      if (claim && !controller.signal.aborted && code !== 'template_lease_lost') {
        const detail = { code, retryable: error.retryable === true,
          ...(error.providerOutcome ? { providerOutcome: error.providerOutcome } : {}),
          ...(error.providerRetryDisposition ? { providerRetryDisposition: error.providerRetryDisposition } : {}),
          ...(Number.isInteger(error.retryAfterSeconds) ? { retryAfterSeconds: error.retryAfterSeconds } : {}) };
        const state = detail.retryable ? 'queued' : error.providerRetryDisposition === 'operator_required' || code === 'provider_cache_miss' ? 'blocked' : 'failed';
        await rpc('finish_panelprofile_template_candidate', { p_id: claim.candidate.id, p_token: claim.candidate.lease_token,
          p_state: state, p_output: {}, p_error: detail }).catch(() => { /* Lease expiry permits the same receipt recovery. */ });
      }
      return false;
    } finally {
      clearInterval(heartbeat); active.delete(controller); busy = false;
    }
  }
  async function tick() { try { await runNext(); } catch (error) { lastError = error.code || 'template_worker_failed'; } }
  function start() {
    if (timer || enabled !== true) return;
    stopped = false; timer = setInterval(() => void tick(), pollMs); timer.unref?.(); void tick();
  }
  function stop() { stopped = true; clearInterval(timer); timer = null; for (const controller of active) controller.abort(); }
  async function dispatch(action, actorId, payload = {}) {
    // actorId is the verified gateway principal, never a customer-controlled
    // payload field. Each method resolves the source owner independently.
    const handlers = { import: importSource, create: createCandidate, list: listCandidates,
      get: (actor, input) => getCandidate(actor, input.candidateId), review: approveCandidate, recover: recoverCandidate };
    if (!Object.hasOwn(handlers, action)) throw failure('template_action_invalid', 404);
    return handlers[action](actorId, payload);
  }
  return { dispatch, importSource, createCandidate, getCandidate, listCandidates, approveCandidate, recoverCandidate,
    runNext, start, stop, status: () => ({ contractVersion: CONTRACT, enabled: enabled === true, busy, lastError }) };
}

module.exports = { CONTRACT, FEATURE_FLAG, createPanelproTemplateService };
