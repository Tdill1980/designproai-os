"use strict";

// A revision is another immutable request in the existing generation/history.
// All source identities come from stored rows. Browser instructions never get
// authority to replace the parent master, geometry, provider state or owner.
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const CONTRACT = 'designpro.atlas-revision-intake.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const SURFACES = ['driver', 'passenger', 'hood', 'roof', 'front', 'rear'];
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashRevisionContext = value => sha(canonical(value));
function fail(code, status = 409, retryable = false) {
  const error = new Error(code); Object.assign(error, { code, status, retryable }); throw error;
}
async function one(query, code) {
  const { data, error } = await query.maybeSingle();
  if (error) fail(`${code}_lookup_failed`, 503, true);
  if (!data) fail(`${code}_not_found`, 404);
  return data;
}
function refFrom(row, role) {
  return { storagePath: row[`${role}_storage_path`], contentHash: row[`${role}_content_hash`],
    byteSize: Number(row[`${role}_byte_size`]), contentType: row[`${role}_content_type`] };
}
function assertRef(ref, ownerId) {
  if (!ref || !HASH.test(String(ref.contentHash || '')) || !Number.isSafeInteger(ref.byteSize) || ref.byteSize < 1
    || ref.byteSize > 64 * 1024 * 1024 || !/^[A-Za-z0-9._/-]+$/.test(String(ref.storagePath || ''))
    || ref.storagePath.split('/').some(segment => !segment || segment === '.' || segment === '..')
    || !(ref.storagePath.startsWith(`designpro/user_${ownerId}/`) || ref.storagePath.startsWith(`users/${ownerId}/revisions/`))) {
    fail('atlas_revision_asset_identity_invalid', 400);
  }
}
async function readVerified(supabase, ref, ownerId) {
  assertRef(ref, ownerId);
  let response;
  try { response = await supabase.storage.from('wrap-files').download(ref.storagePath); }
  catch { fail('atlas_revision_asset_read_failed', 503, true); }
  if (response.error || !response.data) fail('atlas_revision_asset_read_failed', 503, true);
  if (response.data.size > 64 * 1024 * 1024) fail('atlas_revision_asset_too_large');
  const bytes = Buffer.from(await response.data.arrayBuffer());
  if (bytes.length !== ref.byteSize || sha(bytes) !== ref.contentHash) fail('atlas_revision_asset_hash_mismatch');
  return bytes;
}
function parentProvider(parent) {
  const provenance = parent.metadata?.atlasEdgeProvenance;
  if (provenance == null || Array.isArray(provenance) && provenance.every(p => !p.providerRequestKey && !p.providerCacheContract)) return null;
  if (!Array.isArray(provenance)) fail('atlas_revision_parent_provenance_invalid');
  const matches = provenance.filter(p => p.masterSha256 === parent.metadata?.rawProviderResponseHash);
  if (matches.length !== 1 || !HASH.test(String(matches[0].providerRequestKey || ''))
    || matches[0].providerCacheContract !== 'designpro.gemini-provider-cache.v1') fail('atlas_revision_parent_provenance_invalid');
  return matches[0];
}
async function readParentHistory(supabase, parent, authorize = async () => {}) {
  const provenance = parentProvider(parent);
  if (!provenance) return { mode: 'image-reference', reason: 'legacy_parent_without_provider_cache' };
  const { readDurableImageProviderExchange, providerSha256 } = await import(pathToFileURL(resolve(__dirname, '../supabase/functions/_shared/gemini-provider-cache.mjs')).href);
  const exchange = await readDurableImageProviderExchange({ bucket: supabase.storage.from('wrap-files'), ownerId: parent.owner_id,
    generationId: parent.generation_id, requestId: parent.request_id, providerRequestKey: provenance.providerRequestKey, authorize });
  const turns = exchange.nativeRequest?.contents;
  const modelTurn = exchange.payload?.candidates?.length === 1 && exchange.payload.candidates[0]?.content;
  if (!Array.isArray(turns) || !turns.length || turns.some(t => !['model', 'user'].includes(t.role) || !Array.isArray(t.parts))
    || modelTurn?.role !== 'model' || !Array.isArray(modelTurn.parts) || !modelTurn.parts.length) fail('atlas_revision_parent_history_invalid');
  const images = modelTurn.parts.filter(p => p.thought !== true && p.inlineData?.data);
  if (images.length !== 1 || images[0].inlineData.mimeType !== 'image/png'
    || await providerSha256(Buffer.from(images[0].inlineData.data, 'base64')) !== provenance.masterSha256) fail('atlas_revision_parent_history_invalid');
  const imageCount = [...turns, modelTurn].reduce((count, turn) => count + turn.parts.filter(part => part?.inlineData?.data || part?.fileData).length, 0);
  const imageIdentities = [...turns, modelTurn].flatMap(turn => turn.parts.filter(part => part?.inlineData?.data)
    .map(part => `${part.inlineData.mimeType}:${sha(Buffer.from(part.inlineData.data, 'base64'))}`));
  return { mode: 'generate-content-replay', imageCount, imageIdentities: [...new Set(imageIdentities)].sort(), providerRequestKey: provenance.providerRequestKey,
    privateExchangeHash: exchange.privateExchangeHash, requestHash: exchange.requestHash };
}
function validateParent(parent, generationId, hash) {
  if (parent.generation_id !== generationId || parent.master_content_hash !== hash || parent.metadata?.masterQcPassed !== true) fail('atlas_revision_parent_identity_mismatch');
  const panels = parent.metadata?.callOnePanels;
  if (!Array.isArray(panels) || panels.length !== 6 || new Set(panels.map(p => p.surfaceKey)).size !== 6
    || panels.some(p => !SURFACES.includes(p.surfaceKey) || p.sourceMasterHash !== hash || !HASH.test(p.contentHash))) fail('atlas_revision_parent_panels_invalid');
}
async function mayEdit(supabase, actorId, ownerId) {
  if (!UUID.test(String(actorId || ''))) fail('authentication_required', 401);
  if (actorId === ownerId) return;
  const { data, error } = await supabase.from('designpro_qc_members').select('user_id,can_preflight').eq('user_id', actorId).maybeSingle();
  if (error) fail('atlas_revision_actor_lookup_failed', 503, true);
  if (data?.can_preflight !== true) fail('generation_access_denied', 403);
}

async function prepareAtlasRevisionClaim({ supabase, claim, ownerId }) {
  const requestId = claim?.requestId ?? claim?.id;
  const row = await one(supabase.from('designpro_generation_requests').select('*').eq('id', requestId), 'atlas_revision_request');
  if (row.owner_id !== ownerId || row.generation_id !== (claim.generationId ?? claim.generation_id)
    || row.state !== 'leased' || row.lease_token !== (claim.claimToken ?? claim.lease_token)
    || !(Date.parse(row.lease_expires_at) > Date.now())) fail('atlas_revision_claim_invalid', 403);
  if (!row.parent_atlas_revision_id) return null;
  const context = row.revision_context;
  if (context?.contractVersion !== CONTRACT || hashRevisionContext(context) !== row.revision_context_hash
    || context.parentAtlasRevisionId !== row.parent_atlas_revision_id) fail('atlas_revision_context_invalid');
  const parent = await one(supabase.from('designpro_flat_atlas_revisions').select('*').eq('id', row.parent_atlas_revision_id), 'atlas_revision_parent');
  validateParent(parent, row.generation_id, context.parentMaster.contentHash);
  if (parent.owner_id !== ownerId || parent.request_id !== context.parentRequestId || parent.revision_sequence >= row.revision_sequence
    || hashRevisionContext(refFrom(parent, 'manifest')) !== hashRevisionContext(context.parentManifest)) fail('atlas_revision_parent_identity_mismatch');
  const bytes = await readVerified(supabase, context.parentManifest, ownerId);
  let parentManifest;
  try { parentManifest = JSON.parse(bytes.toString('utf8')); } catch { fail('atlas_revision_parent_manifest_invalid'); }
  if (canonical(parentManifest) !== canonical(parent.manifest)) fail('atlas_revision_parent_manifest_invalid');
  const vehicleClassResolution = context.vehicleClassResolution ?? null;
  const executionInput = vehicleClassResolution?.resolved
    ? { ...row.request_input, vehicle: { ...row.request_input.vehicle, type: vehicleClassResolution.resolved } } : row.request_input;
  return { revisionSequence: row.revision_sequence, parentAtlasRevisionId: parent.id, revisionContext: context,
    revisionContextHash: row.revision_context_hash, parentManifest, executionInput, vehicleClassResolution };
}

function createAtlasRevisionIntake({ supabase }) {
  async function prepare(actorId, payload) {
    if (!payload || Object.keys(payload).some(key => !['generationId', 'parentAtlasRevisionId', 'parentMasterContentHash', 'instruction', 'affectedSurfaces', 'editAssets', 'panelOutputRunId'].includes(key))
      || !UUID.test(String(payload.generationId || '')) || !UUID.test(String(payload.parentAtlasRevisionId || ''))
      || !HASH.test(String(payload.parentMasterContentHash || ''))) fail('atlas_revision_input_invalid', 400);
    const instruction = typeof payload.instruction === 'string' ? payload.instruction.trim() : '';
    if (!instruction || instruction.length > 4000) fail('atlas_revision_instruction_invalid', 400);
    const affectedSurfaces = payload.affectedSurfaces ?? SURFACES;
    if (!Array.isArray(affectedSurfaces) || affectedSurfaces.length < 1 || affectedSurfaces.length > 6
      || new Set(affectedSurfaces).size !== affectedSurfaces.length || affectedSurfaces.some(s => !SURFACES.includes(s))) fail('atlas_revision_surfaces_invalid', 400);
    const parent = await one(supabase.from('designpro_flat_atlas_revisions').select('*').eq('id', payload.parentAtlasRevisionId), 'atlas_revision_parent');
    await mayEdit(supabase, actorId, parent.owner_id);
    validateParent(parent, payload.generationId, payload.parentMasterContentHash);
    const request = await one(supabase.from('designpro_generation_requests').select('*').eq('id', parent.request_id), 'atlas_revision_request');
    if (request.owner_id !== parent.owner_id || request.generation_id !== parent.generation_id
      || request.request_input?.pipelineMode !== 'flat-first-atlas-v1') fail('atlas_revision_parent_identity_mismatch');
    const editAssets = payload.editAssets ?? [];
    if (!Array.isArray(editAssets) || editAssets.length > 10) fail('atlas_revision_edit_assets_invalid', 400);
    const normalizedAssets = editAssets.map(asset => {
      if (!asset || Object.keys(asset).some(k => !['storagePath', 'contentHash', 'byteSize', 'contentType', 'purpose'].includes(k))
        || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.contentType)
        || !['reference', 'logo', 'edited-panel'].includes(asset.purpose ?? 'reference')) fail('atlas_revision_edit_assets_invalid', 400);
      const ref = { storagePath: asset.storagePath, contentHash: asset.contentHash, byteSize: asset.byteSize,
        contentType: asset.contentType, purpose: asset.purpose ?? 'reference' }; assertRef(ref, parent.owner_id); return ref;
    });
    const parentMaster = refFrom(parent, 'master'), parentManifest = refFrom(parent, 'manifest');
    // Verify one bounded object at a time; intake shares the runtime with the
    // production renderer and must not hold twelve source buffers concurrently.
    for (const ref of [parentMaster, parentManifest, ...normalizedAssets]) await readVerified(supabase, ref, parent.owner_id);
    const history = await readParentHistory(supabase, parent, () => mayEdit(supabase, actorId, parent.owner_id));
    const newImages = new Set([parentMaster, ...normalizedAssets]
      .map(ref => `${ref.contentType}:${ref.contentHash}`).filter(identity => !history.imageIdentities?.includes(identity)));
    // This proves the known lower bound before queueing; Edge checks the exact
    // fully assembled request, including any additional customer references.
    if ((history.imageCount || 0) + newImages.size > 14) {
      fail('atlas_revision_history_reference_budget_exceeded');
    }
    let panelOutputRunId = payload.panelOutputRunId ?? null;
    if (panelOutputRunId) {
      if (!UUID.test(panelOutputRunId)) fail('atlas_revision_panel_output_invalid', 400);
      const run = await one(supabase.from('panelprofile_runs').select('*').eq('id', panelOutputRunId), 'atlas_revision_panel_output');
      const source = await one(supabase.from('panelprofile_source_handoffs').select('*').eq('id', run.source_id), 'atlas_revision_panel_source');
      if (run.owner_id !== parent.owner_id || source.owner_id !== parent.owner_id || source.source_app !== 'DesignPro'
        || source.generation_id !== parent.generation_id || source.input_hash !== run.input_hash
        || source.handoff?.master?.contentHash !== parent.master_content_hash || source.handoff?.atlasRevisionId !== parent.id) fail('atlas_revision_panel_output_identity_mismatch');
    }
    const context = { contractVersion: CONTRACT, generationId: parent.generation_id, ownerId: parent.owner_id,
      parentAtlasRevisionId: parent.id, parentRequestId: parent.request_id, parentRevisionSequence: parent.revision_sequence,
      parentMaster, parentManifest, instruction, affectedSurfaces: SURFACES.filter(s => affectedSurfaces.includes(s)),
      editAssets: normalizedAssets, panelOutputRunId, history,
      vehicleClassResolution: request.engine_receipt?.vehicleClassResolution ?? request.revision_context?.vehicleClassResolution ?? null };
    return { ownerId: parent.owner_id, parentAtlasRevisionId: parent.id, executionInput: request.request_input,
      revisionContext: context, revisionContextHash: hashRevisionContext(context) };
  }
  async function enqueue(actorId, payload) {
    const prepared = await prepare(actorId, payload);
    const { data, error } = await supabase.rpc('enqueue_designpro_atlas_revision_v2', { p_actor: actorId,
      p_parent_revision_id: prepared.parentAtlasRevisionId, p_context: prepared.revisionContext, p_context_hash: prepared.revisionContextHash });
    if (error) fail(error.message || 'atlas_revision_enqueue_failed', error.code === 'P0001' ? 409 : 503, error.code !== 'P0001');
    return data;
  }
  async function drainHandoffs({ limit = 5 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('atlas_revision_handoff_limit_invalid', 400);
    const { data, error } = await supabase.rpc('list_designpro_atlas_revision_handoffs', { p_limit: limit });
    if (error) fail('atlas_revision_handoff_lookup_failed', 503, true);
    const results = [];
    for (const entry of data || []) {
      const result = await supabase.rpc('handoff_designpro_atlas_revision', { p_request_id: entry.requestId });
      results.push(result.error ? { requestId: entry.requestId, state: 'blocked', code: result.error.message }
        : { requestId: entry.requestId, ...result.data });
    }
    return results;
  }
  return { prepare, enqueue, drainHandoffs };
}

module.exports = { ATLAS_REVISION_INTAKE_CONTRACT: CONTRACT, hashRevisionContext, createAtlasRevisionIntake,
  prepareAtlasRevisionClaim, readParentHistory };
