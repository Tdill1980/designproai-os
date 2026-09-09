// Native Interactions transport for explicitly enabled template previews and
// isolated experiments. Production A.T.L.A.S. keeps generateContent. The image
// model does not execute workflow code, return a geometry schema, or approve QC.
// Schema checked against Google's official Interactions/image/thinking guides
// on 2026-09-08; do not reuse the generateContent parts mapper for these steps.
import { GeminiProviderError } from './gemini-provider-cache.mjs';

export const GEMINI_IMAGE_INTERACTIONS_CONTRACT = 'designpro.gemini-image-interactions.v1';
export const GEMINI_PRO_IMAGE_MODEL = 'gemini-3-pro-image';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MAX_REQUEST_BYTES = 20 * 1024 * 1024 - 256 * 1024;
const clone = (value) => JSON.parse(JSON.stringify(value));
const validInteractionId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(value);

function contentArray(input) {
  const content = typeof input === 'string' ? [{ type: 'text', text: input }] : clone(input);
  if (!Array.isArray(content) || !content.length || content.length > 256) throw new GeminiProviderError('interaction_input_invalid', 400);
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string' && part.text.length > 0) continue;
    if (part?.type === 'image' && ['image/png', 'image/jpeg', 'image/webp'].includes(part.mime_type)
      && typeof part.data === 'string' && part.data.length > 0
      && /^[A-Za-z0-9+/]+={0,2}$/.test(part.data)) continue;
    throw new GeminiProviderError('interaction_input_invalid', 400);
  }
  return content;
}

function countImages(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countImages(item), 0);
  if (!value || typeof value !== 'object') return 0;
  return (value.type === 'image' ? 1 : 0) + Object.values(value).reduce((sum, item) => sum + countImages(item), 0);
}

export function buildGeminiImageInteractionRequest(options) {
  if (options?.enabled !== true) throw new GeminiProviderError('image_interactions_not_enabled', 409);
  if (!['branded-template-preview', 'atlas-variation-test'].includes(options.purpose)) {
    throw new GeminiProviderError('image_interactions_purpose_invalid', 400);
  }
  if (options.model != null && options.model !== GEMINI_PRO_IMAGE_MODEL) throw new GeminiProviderError('image_interactions_model_invalid', 400);
  if (options.tools != null || options.safetySettings != null || options.responseSchema != null) {
    throw new GeminiProviderError('image_interactions_unsupported_configuration', 400);
  }
  const content = contentArray(options.input);
  const previousId = options.previousInteractionId;
  const history = options.historySteps ?? [];
  if (!Array.isArray(history) || history.length > 128 || (previousId && history.length)) {
    throw new GeminiProviderError('interaction_history_mode_invalid', 400);
  }
  if (previousId && (!validInteractionId(previousId)
    || !Number.isInteger(options.previousImageCount) || options.previousImageCount < 0)) {
    throw new GeminiProviderError('interaction_parent_identity_required', 400);
  }
  for (const step of history) {
    if (!step || typeof step.type !== 'string' || step.parts || step.role
      || !['user_input', 'model_output', 'thought', 'google_search_call', 'google_search_result'].includes(step.type)) {
      throw new GeminiProviderError('interaction_history_step_invalid', 400);
    }
    // An absent summary is valid; a signature-only thought is still essential.
    if (step.type === 'thought' && (typeof step.signature !== 'string' || !step.signature)) {
      throw new GeminiProviderError('interaction_thought_signature_missing', 400);
    }
  }
  const imageCount = countImages(content) + (previousId ? options.previousImageCount : countImages(history));
  if (imageCount > 14) throw new GeminiProviderError('interaction_reference_budget_exceeded', 400);
  const imageSize = options.imageSize ?? '4K';
  if (!['1K', '2K', '4K'].includes(imageSize)) throw new GeminiProviderError('interaction_image_size_invalid', 400);
  const aspectRatio = options.aspectRatio;
  if (aspectRatio != null && !['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'].includes(aspectRatio)) {
    throw new GeminiProviderError('interaction_aspect_ratio_invalid', 400);
  }
  const store = options.store !== false;
  if (!store && (options.background === true || previousId)) throw new GeminiProviderError('interaction_storage_mode_invalid', 400);
  if (typeof options.systemInstruction !== 'string' || !options.systemInstruction.trim()) {
    throw new GeminiProviderError('interaction_system_instruction_required', 400);
  }
  // Every interaction receives its own settings. They are not inherited from
  // previous_interaction_id. Keep model defaults unless a supported override
  // has been deliberately selected; no seed is treated as deterministic art.
  const generationConfig = clone(options.generationConfig ?? {});
  if (!generationConfig || Array.isArray(generationConfig) || typeof generationConfig !== 'object'
    || Object.keys(generationConfig).some((key) => !['max_output_tokens', 'thinking_summaries'].includes(key))
    || (generationConfig.max_output_tokens != null && (!Number.isInteger(generationConfig.max_output_tokens)
      || generationConfig.max_output_tokens < 1 || generationConfig.max_output_tokens > 32768))
    || (generationConfig.thinking_summaries != null && !['auto', 'none'].includes(generationConfig.thinking_summaries))) {
    throw new GeminiProviderError('interaction_generation_config_invalid', 400);
  }
  const request = {
    model: GEMINI_PRO_IMAGE_MODEL,
    input: history.length ? [...clone(history), { type: 'user_input', content }] : content,
    system_instruction: options.systemInstruction,
    generation_config: generationConfig,
    response_format: { type: 'image', mime_type: 'image/png', image_size: imageSize, ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) },
    store, background: options.background === true,
    ...(previousId ? { previous_interaction_id: previousId } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_REQUEST_BYTES) {
    throw new GeminiProviderError('interaction_request_too_large', 400);
  }
  return request;
}

function retryAfter(response) {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  if (/^\d+$/.test(value)) return Math.min(Number(value), 3600);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(0, Math.ceil((date - Date.now()) / 1000)), 3600) : null;
}

async function requestOnce(url, method, body, { apiKey, fetchImpl = fetch, timeoutMs = 110_000 } = {}) {
  if (typeof apiKey !== 'string' || apiKey.length < 20) throw new GeminiProviderError('interaction_credentials_missing', 503);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new GeminiProviderError('interaction_deadline_invalid', 400);
  let response;
  try {
    response = await fetchImpl(url, {
      method, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(timeoutMs), ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new GeminiProviderError(method === 'POST' ? 'provider_outcome_unknown' : 'interaction_retrieval_failed',
      method === 'POST' ? 409 : 503, method === 'POST' ? 'unknown' : 'not_sent', method === 'POST' ? 1 : 0);
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new GeminiProviderError('interaction_response_invalid', 502, method === 'POST' ? 'unknown' : 'not_sent', method === 'POST' ? 1 : 0); }
  // Preserve HTTP failures as records for the durable wrapper, including the
  // retry delay. Retrying POST is a graph policy decision, never a hidden SDK loop.
  return { status: response.status, payload, retryAfterSeconds: retryAfter(response) };
}

export async function fetchGeminiImageInteraction(request, options) {
  if (request?.model !== GEMINI_PRO_IMAGE_MODEL || request?.response_format?.type !== 'image') {
    throw new GeminiProviderError('interaction_request_invalid', 400);
  }
  return requestOnce(ENDPOINT, 'POST', request, options);
}

// Recovery only retrieves the known interaction. 404 (including retention
// expiry) never becomes a second create request. Keep local private receipts.
export async function getGeminiImageInteraction(id, options) {
  if (!validInteractionId(id)) throw new GeminiProviderError('interaction_id_invalid', 400);
  return requestOnce(`${ENDPOINT}/${encodeURIComponent(id)}`, 'GET', null, options);
}

export function extractFinalInteractionImage(interaction) {
  if (!validInteractionId(interaction?.id) || interaction.model !== GEMINI_PRO_IMAGE_MODEL) {
    throw new GeminiProviderError('interaction_response_identity_invalid', 502, 'received', 1);
  }
  if (interaction.status !== 'completed') throw new GeminiProviderError('interaction_not_completed', 409, 'received', 1);
  if (!Array.isArray(interaction.steps)) throw new GeminiProviderError('interaction_steps_missing', 502, 'received', 1);
  const images = interaction.steps.filter((step) => step?.type === 'model_output')
    .flatMap((step) => Array.isArray(step.content) ? step.content : [])
    .filter((part) => part?.type === 'image');
  if (images.length !== 1) throw new GeminiProviderError(images.length ? 'interaction_ambiguous_final_images' : 'interaction_final_image_missing', 502, 'received', 1);
  const image = images[0];
  if (image.mime_type !== 'image/png' || typeof image.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
    throw new GeminiProviderError('interaction_final_image_invalid', 502, 'received', 1);
  }
  // No thought text, signatures, tool steps or prompts cross this projection.
  return { interactionId: interaction.id, mimeType: image.mime_type, data: image.data };
}
