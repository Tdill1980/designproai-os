// One synthetic 4K provider call. Uses the existing production Google secret;
// never impersonates a customer, creates a login, or changes account balances.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { wallDesignPrompt } from '../supabase/functions/generate-wall-design/prompt.ts';
import { finalWallImage, decodeWallImage } from '../supabase/functions/generate-wall-design/handler.ts';
const folder = 'wallpro-provider-receipt';
await mkdir(folder, { recursive: true });
const receipt = { sha: process.env.GITHUB_SHA, model: 'gemini-3-pro-image', requestedSize: '4K', passed: false, authenticatedApplicationFlow: false };
try {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key || key.length < 20) throw new Error('Production Google credential is unavailable.');
  const started = Date.now();
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: wallDesignPrompt({ prompt: 'Create a seamless wallpaper tile with large softly painted tropical flowers in pale pink, beige, sage green and plum on a near-black background. No text.', width: 120, height: 96, placement: 'repeat' }) }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '4K' } } }),
    signal: AbortSignal.timeout(100000),
  });
  receipt.httpStatus = response.status;
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  const result = await response.json();
  receipt.candidates = (result.candidates || []).map(candidate => ({ finishReason: candidate.finishReason, parts: (candidate.content?.parts || []).map(part => ({ thought: part.thought === true, hasText: typeof part.text === 'string', mimeType: part.inlineData?.mimeType, encodedLength: part.inlineData?.data?.length })) }));
  receipt.blockReason = result.promptFeedback?.blockReason;
  const final = finalWallImage(result), bytes = decodeWallImage(final.data);
  const extension = final.mimeType === 'image/png' ? 'png' : final.mimeType === 'image/jpeg' ? 'jpg' : 'webp';
  const filename = `wallpro-provider-image.${extension}`;
  await writeFile(`${folder}/${filename}`, bytes);
  Object.assign(receipt, { passed: true, mimeType: final.mimeType, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), seconds: (Date.now()-started)/1000, filename });
} catch (error) { receipt.error = error instanceof Error ? error.message : 'Provider validation failed'; process.exitCode = 1; }
await writeFile(`${folder}/receipt.json`, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
