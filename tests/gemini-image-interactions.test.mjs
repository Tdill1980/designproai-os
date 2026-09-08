import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeminiImageInteractionRequest, extractFinalInteractionImage,
  fetchGeminiImageInteraction, getGeminiImageInteraction,
} from '../supabase/functions/_shared/gemini-image-interactions.mjs';

const base = {
  enabled: true, purpose: 'branded-template-preview', input: 'Create the approved branded display.',
  systemInstruction: 'Display artwork only; measured geometry is maintained by the application.',
};
const native = {
  id: 'v1_example', model: 'gemini-3-pro-image', status: 'completed', steps: [
    { type: 'thought', signature: 'opaque-signature-only' },
    { type: 'thought', signature: 'opaque-latent-signature', summary: [{ type: 'image', mime_type: 'image/png', data: 'aGlkZGVu' }] },
    { type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: 'ZmluYWw=' }] },
  ],
};

test('Interactions is explicit opt-in and never becomes the default ATLAS transport', () => {
  assert.throws(() => buildGeminiImageInteractionRequest({ ...base, enabled: false }), { code: 'image_interactions_not_enabled' });
  assert.throws(() => buildGeminiImageInteractionRequest({ ...base, purpose: 'atlas-production' }), { code: 'image_interactions_purpose_invalid' });
  const request = buildGeminiImageInteractionRequest(base);
  assert.equal(request.model, 'gemini-3-pro-image');
  assert.deepEqual(request.response_format, { type: 'image', mime_type: 'image/png', image_size: '4K' });
  assert.equal(request.store, true);
  assert.equal(request.background, false);
  assert.ok(!('contents' in request));
  assert.ok(!('generationConfig' in request));
});

test('stateful continuation sends settings anew and requires a known image reference count', () => {
  const request = buildGeminiImageInteractionRequest({ ...base, previousInteractionId: native.id, previousImageCount: 2,
    generationConfig: { thinking_summaries: 'none' } });
  assert.equal(request.previous_interaction_id, native.id);
  assert.equal(request.system_instruction, base.systemInstruction);
  assert.deepEqual(request.generation_config, { thinking_summaries: 'none' });
  assert.throws(() => buildGeminiImageInteractionRequest({ ...base, previousInteractionId: native.id }), { code: 'interaction_parent_identity_required' });
  assert.throws(() => buildGeminiImageInteractionRequest({ ...base, previousInteractionId: native.id, previousImageCount: 15 }), { code: 'interaction_reference_budget_exceeded' });
});

test('native stateless replay preserves signature-only and image thought steps exactly', () => {
  const historySteps = [{ type: 'user_input', content: [{ type: 'text', text: 'Original instructions.' }] }, ...native.steps];
  const request = buildGeminiImageInteractionRequest({ ...base, historySteps, store: false });
  assert.deepEqual(request.input.slice(0, -1), historySteps);
  request.input[1].signature = 'changed returned request copy';
  assert.equal(historySteps[1].signature, 'opaque-signature-only');
  assert.throws(() => buildGeminiImageInteractionRequest({ ...base, historySteps: [{ role: 'model', parts: [{ thoughtSignature: 'wrong-api' }] }] }),
    { code: 'interaction_history_step_invalid' });
});

test('thought images and summaries can never be selected as display output', () => {
  assert.deepEqual(extractFinalInteractionImage(native), { interactionId: native.id, mimeType: 'image/png', data: 'ZmluYWw=' });
  assert.throws(() => extractFinalInteractionImage({ ...native, steps: native.steps.slice(0, 2) }), { code: 'interaction_final_image_missing' });
  assert.throws(() => extractFinalInteractionImage({ ...native, steps: [...native.steps, native.steps[2]] }), { code: 'interaction_ambiguous_final_images' });
  assert.throws(() => extractFinalInteractionImage({ ...native, status: 'in_progress' }), { code: 'interaction_not_completed' });
});

test('unsupported image model tools/structured geometry and invalid sizes are refused locally', () => {
  for (const extra of [{ tools: [] }, { responseSchema: {} }, { safetySettings: [] }]) {
    assert.throws(() => buildGeminiImageInteractionRequest({ ...base, ...extra }), { code: 'image_interactions_unsupported_configuration' });
  }
  assert.throws(() => buildGeminiImageInteractionRequest({ ...base, imageSize: '4k' }), { code: 'interaction_image_size_invalid' });
  assert.throws(() => buildGeminiImageInteractionRequest({ ...base, background: true, store: false }), { code: 'interaction_storage_mode_invalid' });
});

test('REST create uses the official schema, private key header, and one bounded request', async () => {
  const request = buildGeminiImageInteractionRequest(base);
  let calls = 0;
  const raw = await fetchGeminiImageInteraction(request, {
    apiKey: 'private-test-key-1234567890', fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['x-goog-api-key'], 'private-test-key-1234567890');
      assert.deepEqual(JSON.parse(options.body), request);
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(JSON.stringify(native), { status: 200 });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(raw.payload, native);
});

test('known provider throttling preserves retry metadata; uncertain create never retries', async () => {
  const request = buildGeminiImageInteractionRequest(base);
  const rateLimit = await fetchGeminiImageInteraction(request, { apiKey: 'private-test-key-1234567890',
    fetchImpl: async () => new Response('{"error":{"code":429}}', { status: 429, headers: { 'retry-after': '17' } }) });
  assert.equal(rateLimit.status, 429);
  assert.equal(rateLimit.retryAfterSeconds, 17);
  let calls = 0;
  await assert.rejects(fetchGeminiImageInteraction(request, { apiKey: 'private-test-key-1234567890',
    fetchImpl: async () => { calls += 1; throw new Error('lost acknowledgement'); } }), { code: 'provider_outcome_unknown' });
  assert.equal(calls, 1);
});

test('retention-expired interaction is a GET-only failure and cannot create a replacement', async () => {
  const raw = await getGeminiImageInteraction(native.id, { apiKey: 'private-test-key-1234567890',
    fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions/v1_example');
      return new Response('{"error":{"code":"not_found"}}', { status: 404 });
    },
  });
  assert.equal(raw.status, 404);
});
