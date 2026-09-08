import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixture, reviewOf, ACTOR, OWNER, OTHER, sha } from './helpers/panelpro-template-fixture.mjs';
const require = createRequire(import.meta.url);
const { createPanelproTemplateService } = require('../runtime/panelpro-template-service.cjs');
const serviceOf = (f, more = {}) => createPanelproTemplateService({ supabase: f.supabase, invoke: f.invoke, enabled: true,
  workerId: 'fixture-worker', schedule: () => {}, ...more });
async function candidate(f, service) {
  const imported = await service.dispatch('import', ACTOR, f.input);
  const queued = await service.dispatch('create', ACTOR, { sourceId: imported.sourceId });
  return { imported, queued };
}

test('every template action requires current internal QC membership; model flag defaults off', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const service = serviceOf(f);
  for (const action of ['import', 'create', 'list', 'get', 'review', 'recover'])
    await assert.rejects(service.dispatch(action, OWNER, {}), { code: 'template_qc_permission_required', status: 403 });
  const disabled = serviceOf(f, { enabled: false });
  const source = await disabled.dispatch('import', ACTOR, f.input);
  await assert.rejects(disabled.dispatch('create', ACTOR, { sourceId: source.sourceId }), { code: 'template_recreate_not_enabled' });
  assert.equal(await disabled.runNext(), false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.signed.length, 0);
});

test('import binds exact vehicle/physical review and immutable original assets to the owner', async t => {
  const f = await fixture(); t.after(() => f.db.close()); const service = serviceOf(f);
  await assert.rejects(service.dispatch('import', ACTOR, { ...f.input, review: { ...f.input.review, measuredDimensions: false } }), { code: 'template_measured_source_review_required' });
  await assert.rejects(service.dispatch('import', ACTOR, { ...f.input, review: { ...f.input.review,
    vehicleIdentity: { ...f.input.review.vehicleIdentity, bodyStyle: 'convertible' } } }), { code: 'template_measured_source_review_required' });
  await assert.rejects(service.dispatch('import', ACTOR, { ...f.input, sourceVector: f.write(Buffer.from('wrong-owner'), 'vector', OTHER) }), { code: 'template_artifact_scope_invalid' });
  const imported = await service.dispatch('import', ACTOR, f.input);
  const original = (await f.db.query('SELECT * FROM public.panelprofile_template_sources WHERE id=$1', [imported.sourceId])).rows[0];
  assert.equal(original.owner_id, OWNER); assert.equal(original.reviewed_by, ACTOR);
  assert.equal(original.geometry_hash, f.input.geometry.contentHash);
  assert.deepEqual(f.files.get(original.source.brand.storagePath), f.brand);
  assert.match(original.source.sourceVector.storagePath, /^designpro-template-private\/v1\//);
  const again = await service.dispatch('import', ACTOR, { ...f.input, brand: f.write(f.brand, 'same-brand-reupload') });
  assert.equal(again.sourceId, imported.sourceId, 'same original bytes can be reuploaded without making another template');
  await assert.rejects(f.db.query("UPDATE public.panelprofile_template_sources SET source='{}' WHERE id=$1", [imported.sourceId]), /immutable_record/);
  const changedGeometry = structuredClone(f.geometry); changedGeometry.pieces[0].widthInches = 21;
  await assert.rejects(service.dispatch('import', ACTOR, { ...f.input,
    geometry: f.write(Buffer.from(JSON.stringify(changedGeometry)), 'changed-geometry') }), { code: 'template_source_version_collision' });
  assert.equal(f.calls.length, 0);
});

test('durable template lifecycle creates one private candidate and banks only the exact reviewed overlay', async t => {
  const f = await fixture(); t.after(() => f.db.close()); const service = serviceOf(f);
  const { imported, queued } = await candidate(f, service);
  assert.equal(queued.ownerId, OWNER); assert.equal(queued.status, 'queued');
  assert.equal((await service.dispatch('create', ACTOR, { sourceId: imported.sourceId, ownerId: OTHER, geometryValidated: true })).candidateId, queued.candidateId);
  assert.equal(await service.runNext(), true);
  const ready = await service.dispatch('get', ACTOR, { candidateId: queued.candidateId });
  assert.equal(ready.status, 'waiting_review'); assert.equal(ready.customerVisible, false);
  assert.equal(ready.canReview, true); assert.equal(ready.template, null); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].model, 'gemini-3-pro-image'); assert.equal(f.calls[0].response_format.image_size, '4K');
  assert(!JSON.stringify(ready).includes('private-signature-only-fixture'));
  assert(!JSON.stringify(ready).includes('interactionId'));
  assert(ready.previews.every(preview => preview.storagePath.startsWith(`designpro-template-private/v1/${OWNER}/`)));
  assert.equal((await f.db.query('SELECT count(*) FROM public.panelprofile_template_bank')).rows[0].count, 0);
  await assert.rejects(service.dispatch('review', ACTOR, { ...reviewOf(ready), candidateHash: 'a'.repeat(64) }), { code: 'template_candidate_identity_invalid' });
  const wrong = reviewOf(ready); wrong.review.displayRegions[0].displayRegionPixels.y = 0;
  await assert.rejects(service.dispatch('review', ACTOR, wrong), { code: 'template_display_region_invalid' });
  assert(![...f.files.keys()].some(path => path.includes('/panelprofile-templates/')));
  const approved = await service.dispatch('review', ACTOR, reviewOf(ready));
  assert.equal(approved.status, 'approved'); assert.equal(approved.template.displayOrigin, 'generated-branded');
  assert.equal(approved.template.geometry.contentHash, approved.template.geometryHash);
  assert.match(approved.template.display.storagePath, new RegExp(`^designpro/user_${OWNER}/${queued.candidateId}/panelprofile-templates/`));
  const geometryBytes = f.files.get(approved.template.geometry.storagePath), measured = JSON.parse(geometryBytes);
  assert.equal(sha(geometryBytes), approved.template.geometryHash);
  assert.equal(measured.contractVersion, 'designpro.panelpro-file-output-geometry.v1');
  assert.equal(measured.displayContentHash, ready.displayContentHash);
  assert.equal(measured.provenance.sourceGeometryHash, f.input.geometry.contentHash);
  assert.deepEqual(measured.vehicle, f.geometry.vehicle);
  assert.equal(measured.provenance.fitToleranceInches, f.input.review.fitToleranceInches);
  assert.equal(measured.provenance.physicalMeasurementReference, f.input.review.physicalMeasurementReference);
  const { displayRegionPixels, ...piece } = measured.pieces[0];
  assert.deepEqual(piece, f.geometry.pieces[0]);
  assert.deepEqual(displayRegionPixels, reviewOf(ready).review.displayRegions[0].displayRegionPixels);
  assert.equal((await service.dispatch('review', ACTOR, reviewOf(ready))).status, 'approved', 'exact approval replay is idempotent');
  assert.equal((await service.dispatch('create', ACTOR, { sourceId: imported.sourceId })).status, 'approved', 'bank reuse does not buy another image');
  assert.equal(await service.runNext(), false); assert.equal(f.calls.length, 1);
  const evidence = (await f.db.query('SELECT * FROM public.panelprofile_template_bank_evidence')).rows;
  assert.equal(evidence.length, 1); assert.equal(evidence[0].reviewed_by, ACTOR);
  assert.equal(evidence[0].owner_id, OWNER); assert.equal(evidence[0].source_id, imported.sourceId);
  assert(approved.events.some(event => event.state === 'waiting_review'));
  assert(approved.events.some(event => event.state === 'approved'));
});

test('a lost post-provider database response recovers the same private image on a fresh worker', async t => {
  const f = await fixture(); t.after(() => f.db.close()); const service = serviceOf(f);
  const { queued } = await candidate(f, service), originalRpc = f.supabase.rpc;
  let lost = true;
  f.supabase.rpc = async (name, args) => {
    if (lost && name === 'finish_panelprofile_template_candidate' && args.p_state === 'waiting_review') {
      lost = false; return { data: null, error: { message: 'simulated network response loss' } };
    }
    return originalRpc(name, args);
  };
  assert.equal(await service.runNext(), false); assert.equal(f.calls.length, 1);
  await f.db.query('UPDATE public.panelprofile_template_candidates SET available_at=now() WHERE id=$1', [queued.candidateId]);
  const restarted = serviceOf(f, { workerId: 'fresh-worker' });
  assert.equal(await restarted.runNext(), true);
  const ready = await restarted.getCandidate(ACTOR, queued.candidateId);
  assert.equal(ready.status, 'waiting_review'); assert.equal(f.calls.length, 1);
  const stored = (await f.db.query('SELECT output FROM public.panelprofile_template_candidates WHERE id=$1', [queued.candidateId])).rows[0].output;
  assert.equal(stored.provider.providerCacheHit, true);
});

test('an ambiguous create outcome remains blocked and operator recovery never sends another POST', async t => {
  const f = await fixture(); t.after(() => f.db.close()); let posts = 0;
  const service = serviceOf(f, { invoke: async () => { posts += 1; throw new Error('connection lost after send'); } });
  const { queued } = await candidate(f, service);
  assert.equal(await service.runNext(), false);
  const blocked = await service.getCandidate(ACTOR, queued.candidateId);
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.error.code, 'provider_outcome_unknown');
  assert.equal(blocked.error.retryable, false); assert.equal(blocked.error.providerRetryDisposition, 'operator_required');
  await service.dispatch('recover', ACTOR, { candidateId: queued.candidateId });
  assert.equal(await service.runNext(), false); assert.equal(posts, 1);
  assert.equal((await service.getCandidate(ACTOR, queued.candidateId)).status, 'blocked');
  assert.equal((await f.db.query('SELECT count(*) FROM public.panelprofile_template_bank')).rows[0].count, 0);
});

test('a cached 429 preserves Retry-After and requires operator recovery without a hidden retry', async t => {
  const f = await fixture(); t.after(() => f.db.close()); let posts = 0;
  const service = serviceOf(f, { invoke: async () => { posts += 1; return { status: 429, retryAfterSeconds: 90, payload: { error: { code: 429, message: 'quota' } } }; } });
  const { queued } = await candidate(f, service);
  assert.equal(await service.runNext(), false);
  const blocked = await service.getCandidate(ACTOR, queued.candidateId);
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.error.retryAfterSeconds, 90);
  assert.equal(blocked.error.retryable, false);
  await service.recoverCandidate(ACTOR, { candidateId: queued.candidateId });
  await service.runNext(); assert.equal(posts, 1);
});

test('Postgres claims fence stale workers and deny client access to private template evidence', async t => {
  const f = await fixture(); t.after(() => f.db.close()); const service = serviceOf(f);
  const { imported, queued } = await candidate(f, service);
  await assert.rejects(f.db.query('SELECT public.create_panelprofile_template_candidate($1,$2)', [OWNER, imported.sourceId]), /qc_permission_required/);
  const claim = (await f.db.query('SELECT public.claim_panelprofile_template_candidate($1,180) AS value', ['worker-a'])).rows[0].value;
  assert.equal(claim.candidate.id, queued.candidateId);
  assert.equal((await f.db.query('SELECT public.claim_panelprofile_template_candidate($1,180) AS value', ['worker-b'])).rows[0].value, null);
  await f.db.query("UPDATE public.panelprofile_template_candidates SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [queued.candidateId]);
  const recovered = (await f.db.query('SELECT public.claim_panelprofile_template_candidate($1,180) AS value', ['worker-b'])).rows[0].value;
  assert.notEqual(recovered.candidate.lease_token, claim.candidate.lease_token);
  await assert.rejects(f.db.query("SELECT public.finish_panelprofile_template_candidate($1,$2,'failed','{}','{}')", [queued.candidateId, claim.candidate.lease_token]), /lease_lost/);
  await f.db.exec('SET ROLE authenticated');
  for (const table of ['panelprofile_template_sources', 'panelprofile_template_candidates', 'panelprofile_template_events', 'panelprofile_template_bank_evidence'])
    await assert.rejects(f.db.query(`SELECT * FROM public.${table}`), /permission denied/);
  await assert.rejects(f.db.query('SELECT public.claim_panelprofile_template_candidate($1,180)', ['attacker']), /permission denied/);
  await f.db.exec('RESET ROLE');
});
