import test from 'node:test';
import assert from 'node:assert/strict';
import { presentWorkflowStages, productionProgressMessage, publicBuildPreviews } from '../app/src/lib/designpro-workflow-presentation.mjs';

test('all reported parallel work is shown; an absent template producer is never invented', () => {
  const steps = presentWorkflowStages([
    { key: 'enhance.upscale', state: 'running', dependsOn: ['await_panelpro_preflight_qc'] },
    { key: 'proof.build', state: 'running', dependsOn: ['revision.freeze'] },
    { key: 'output.build', state: 'pending', dependsOn: ['enhance.upscale'] },
  ]);
  assert.equal(steps.filter((s) => s.state === 'running').length, 2);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps[2].dependsOn, ['enhance.upscale']);
  assert.equal(steps.some((s) => s.key.startsWith('template.')), false);
});

test('deferred, retrying and cancelled work cannot look completed', () => {
  const steps = presentWorkflowStages([
    { key: 'proof.build', state: 'complete', deferred: true },
    { key: 'output.build', state: 'pending', executionState: 'retryable' },
    { key: 'stamp.build', state: 'pending', executionState: 'cancelled' },
  ]);
  assert.deepEqual(steps.map((s) => s.state), ['attention', 'retrying', 'cancelled']);
});

test('public narration ignores producer prompts, labels and error detail', () => {
  const result = presentWorkflowStages([{ key: 'constructor', state: 'failed', label: 'SECRET PROMPT', deferredMessage: 'SECRET TRACE' }]);
  assert.equal(result[0].label, 'File preparation');
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

const preview = (role, overrides = {}) => ({
  id: role, surfaceKey: 'driver', signedUrl: 'https://example.test/signed', contentHash: 'a'.repeat(64),
  metadata: { presentationRole: role, customerDisplayApproved: true, templateDisplayOrigin: 'generated-branded', geometryValidated: true, templateProfileHash: 'b'.repeat(64), ...overrides },
});

test('only checked branded presentation assets reach the customer template sequence', () => {
  const artifacts = [preview('template-overlay'), preview('branded-template'),
    preview('branded-template', { geometryValidated: false }),
    preview('branded-template', { containsPrivateTemplate: true }),
    preview('branded-template', { templateDisplayOrigin: 'private-reference' }),
    preview('branded-template', { customerDisplayApproved: false }),
    preview('private-original'), preview('constructor')];
  assert.deepEqual(publicBuildPreviews(artifacts).map((p) => p.role), ['branded-template', 'template-overlay']);
});

test('panel existence alone never promises review time or a completed downloadable pack', () => {
  assert.doesNotMatch(productionProgressMessage({ state: 'running', stages: [] }, true), /ready to download|24h|with the design team/);
  assert.match(productionProgressMessage({ state: 'waiting_for_preflight' }, false), /design team/);
  assert.doesNotMatch(productionProgressMessage({ state: 'complete' }, false), /ready to download/);
  assert.match(productionProgressMessage({ state: 'complete' }, true), /ready to download/);
});
