import { wallDesignPrompt, wallMatchRecoveryPrompt, COVERING_DESCRIPTION_PROMPT, WALL_INTENTS, type WallIntent } from './prompt.ts';

const BUCKET = 'wallpro-files';
const MODEL = 'gemini-3-pro-image';
/** The fast text model that describes a reference before a words-only retry. */
export const DESCRIBE_MODEL = 'gemini-2.5-flash';

/** The covering in the reference image, in words, from the fast text model.
 * Null when it cannot answer; the retry then goes without a description. */
export async function describeCovering(fetchImpl: typeof fetch, key: string, imagePart: any): Promise<string | null> {
  const provider = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/' + DESCRIBE_MODEL + ':generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: COVERING_DESCRIPTION_PROMPT }, imagePart] }], generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!provider.ok) return null;
  const result = await provider.json();
  const text = String(result?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '').trim().replace(/\s+/g, ' ');
  return text.length >= 20 ? text.slice(0, 900) : null;
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const numberInRange = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 2400;

// Uint8Array.from(atob(...)) materializes a per-character intermediate array.
// A 4K PNG can exhaust an Edge worker before catch/refund can execute. Decode
// bounded chunks directly into one allocation instead.
export function decodeWallImage(data: unknown): Uint8Array {
  if (typeof data !== 'string' || !data.length || data.length % 4 !== 0 || data.length > Math.ceil(20 * 1024 * 1024 / 3) * 4) throw new Error('The design image exceeded the supported size.');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const size = data.length / 4 * 3 - padding;
  if (size > 20 * 1024 * 1024) throw new Error('The design image exceeded the supported size.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (let start = 0; start < data.length; start += 262144) {
    const binary = atob(data.slice(start, start + 262144));
    for (let i = 0; i < binary.length; i++) bytes[offset++] = binary.charCodeAt(i);
  }
  return bytes;
}

export function finalWallImage(result: any) {
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  for (const candidate of candidates) {
    if (['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'RECITATION', 'BLOCKLIST'].includes(candidate.finishReason)) continue;
    const parts = Array.isArray(candidate.content?.parts) ? candidate.content.parts : [];
    const final = parts.filter((p: any) => p.thought !== true && p.inlineData?.data && imageTypes.includes(p.inlineData.mimeType)).at(-1)?.inlineData;
    if (final) return final;
  }
  const reason = String(result?.promptFeedback?.blockReason || candidates[0]?.finishReason || 'NO_IMAGE').replace(/[^A-Z0-9_]/g, '').slice(0, 50);
  if (['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'RECITATION', 'BLOCKLIST'].includes(reason)) throw new Error(`The image service could not generate this design (${reason}). Revise the description. Your render credit will be returned.`);
  throw new Error(`The image service returned no finished image (${reason || 'NO_IMAGE'}). Your render credit will be returned. Please try again.`);
}

export function parseWallInput(body: any, owner: string) {
  if (!uuid.test(body.requestId || '') || !numberInRange(body.width) || !numberInRange(body.height)) throw new Error('Enter a valid wall width and height between 1 and 2,400 inches.');
  const intent: WallIntent = body.intent === undefined || body.intent === null ? 'prompt' : body.intent;
  if (!WALL_INTENTS.includes(intent)) throw new Error('Choose how to design: describe it, match your design, or design for your wall.');
  const prompt = body.prompt === undefined || body.prompt === null ? '' : body.prompt;
  if (typeof prompt !== 'string' || prompt.length > 6000) throw new Error('Describe your wall design in 1–6,000 characters.');
  if (intent === 'prompt' && !prompt.trim()) throw new Error('Describe your wall design in 1–6,000 characters.');
  if (!['cover', 'contain', 'repeat'].includes(body.placement)) throw new Error('Choose a mural or repeating-pattern placement.');
  // The tile's real-world width, so the prompt can state the print scale.
  const repeatWidthIn = body.placement === 'repeat' && numberInRange(body.repeatWidthIn) ? body.repeatWidthIn as number : null;
  const checkPath = (path: any, folders: string[] = ['uploads']) => {
    if (path === undefined || path === null) return null;
    const parts = typeof path === 'string' ? path.split('/') : [];
    const catalog = folders.includes('catalog') && parts.length === 2 && parts[0] === 'catalog' && /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(parts[1]);
    const owned = parts.length === 3 && parts[0] === owner && folders.includes(parts[1]) && /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(parts[2]);
    if (!catalog && !owned) throw new Error('The reference image is not one of your uploaded files.');
    return path as string;
  };
  const wallPath = checkPath(body.wallPath), referencePath = checkPath(body.referencePath);
  // A refinement's source is a version the owner already holds: their own
  // generated master, an upload, a masked composite, or a catalog master.
  const sourcePath = intent === 'refine' ? checkPath(body.sourcePath, ['uploads', 'generated', 'catalog']) : null;
  const maskPath = intent === 'refine' ? checkPath(body.maskPath) : null;
  if (intent === 'match' && !referencePath) throw new Error('Upload the design to match first.');
  if (intent === 'wall' && !wallPath) throw new Error('Upload your wall photo first.');
  if (intent === 'refine' && !sourcePath) throw new Error('There is no current design version to refine.');
  if (intent === 'refine' && !prompt.trim()) throw new Error('Describe what you want changed.');
  return { requestId: body.requestId, intent, prompt: prompt.trim(), width: body.width, height: body.height, placement: body.placement, repeatWidthIn, wallPath, referencePath, sourcePath, maskPath };
}

/** Pixel size of the returned image, read from the container headers (PNG
 * IHDR, JPEG SOF, WebP VP8/VP8L/VP8X). Null when the container is unknown.
 * This is the number production is judged by; "4K was requested" is not. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { width: u32(16), height: u32(20) };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
      i += 2 + length;
    }
    return null;
  }
  if (bytes.length > 30 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === 'VP8 ') return { width: ((bytes[26] | (bytes[27] << 8)) & 0x3fff), height: ((bytes[28] | (bytes[29] << 8)) & 0x3fff) };
    if (chunk === 'VP8L') { const b = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0; return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    if (chunk === 'VP8X') return { width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1, height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1 };
  }
  return null;
}
export const PRODUCTION_PPI = 150;

export function nearestAspect(width: number, height: number): string {
  return ['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9'].reduce((best, value) => {
    const ratio = (s: string) => { const [w,h] = s.split(':').map(Number); return w/h; };
    return Math.abs(Math.log(ratio(value)/(width/height))) < Math.abs(Math.log(ratio(best)/(width/height))) ? value : best;
  });
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
};

// Injectable boundary for contract tests. No request can supply credentials or URLs.
export function createWallHandler(deps: { createClient: (...args: any[]) => any; supabaseUrl: string; serviceKey: string; apiKey: () => string; fetch: typeof fetch }) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
    const sb = deps.createClient(deps.supabaseUrl, deps.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const { data: auth, error: authError } = jwt ? await sb.auth.getUser(jwt).catch(() => ({ data: null, error: true })) : { data: null, error: true };
    if (authError || !auth?.user?.id) return response({ error: 'Sign in to generate a wall design.', code: 'AUTH_REQUIRED' }, 401);
    const owner = auth.user.id;
    let input: ReturnType<typeof parseWallInput>;
    try {
      const text = await req.text();
      if (text.length > 16000) throw new Error('The design request is too large.');
      input = parseWallInput(JSON.parse(text), owner);
    } catch (err) { return response({ error: err instanceof Error ? err.message : 'Invalid request' }, 400); }
    let reserved = false;
    const signedResult = async (g: any) => {
      if (g.state !== 'completed') return response({ error: g.error || 'This design is still generating. Check your saved generations.', request_id: input.requestId, state: g.state }, g.state === 'working' ? 409 : 422);
      const signed = await sb.storage.from(BUCKET).createSignedUrl(g.artwork_path, 3600);
      if (signed.error || !signed.data?.signedUrl) return response({ error: 'Artwork is saved but its preview link could not be opened. Reopen it from My wall designs.' }, 503);
      return response({ success: true, request_id: input.requestId, image_url: signed.data.signedUrl, storage_path: g.artwork_path, design_name: g.design_name, scene_render: false });
    };
    try {
      const key = deps.apiKey();
      if (!key) return response({ error: 'Wall design generation is not configured.', code: 'NOT_CONFIGURED' }, 503);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input))))).map(n => n.toString(16).padStart(2, '0')).join('');
      // Resolve every private reference before charging or calling the provider.
      const parts: any[] = [{ text: wallDesignPrompt(input) }];
      let referenceBytes = 0;
      // A refinement keeps the framing of the version it edits, so its aspect
      // comes from the source pixels, not from the wall.
      let sourceDims: { width: number; height: number } | null = null;
      const attachments: [string, string | null][] = input.intent === 'refine'
        ? [['Current design (the version being refined)', input.sourcePath], ['Mask — only the white region may change', input.maskPath], ['Reference for the requested change', input.referencePath]]
        : [[input.intent === 'wall' ? 'Wall photo — the room this artwork is for' : 'Wall photo — architectural context only', input.wallPath], [input.intent === 'match' ? 'Design to reproduce' : 'Style reference / existing wall design', input.referencePath]];
      for (const [label, path] of attachments) {
        if (!path) continue;
        const downloaded = await sb.storage.from(BUCKET).download(path);
        if (downloaded.error || !downloaded.data) return response({ error: 'Your ' + label.toLowerCase() + ' could not be read. Upload it again before generating.', code: 'UPLOAD_UNREADABLE' }, 400);
        const blob = downloaded.data as Blob;
        if (!imageTypes.includes(blob.type) || blob.size > 20 * 1024 * 1024) return response({ error: 'Reference images must be JPG, PNG or WebP and no larger than 20 MB.' }, 400);
        referenceBytes += blob.size;
        if (referenceBytes > 14 * 1024 * 1024) return response({ error: 'For AI generation, use smaller wall and reference images totaling no more than 14 MB. Your full-size artwork can still be uploaded for a preview.' }, 400);
        const raw = new Uint8Array(await blob.arrayBuffer());
        if (path === input.sourcePath) sourceDims = imageDimensions(raw);
        parts.push({ text: label }, { inlineData: { mimeType: blob.type, data: toBase64(raw) } });
      }
      const requestedAspect = input.placement === 'repeat' ? '1:1' : input.intent === 'refine' && sourceDims ? nearestAspect(sourceDims.width, sourceDims.height) : nearestAspect(input.width, input.height);
      const reservation = await sb.rpc('reserve_wallpro_generation', { p_id: input.requestId, p_owner: owner, p_hash: hash, p_input: input });
      if (reservation.error) {
        const reason = reservation.error.message || '';
        return response({ error: reason.includes('no_tokens') ? 'You need a design token or an available plan render to generate. Uploaded artwork previews are free.' : reason.includes('generation_in_progress') ? 'A wall design is already generating. Wait for it to finish.' : 'This request could not be reserved. Try again.', code: reason.includes('no_tokens') ? 'NO_TOKENS' : 'REQUEST_CONFLICT' }, reason.includes('no_tokens') ? 402 : 409);
      }
      if (!reservation.data.fresh) return await signedResult(reservation.data.generation);
      reserved = true;
      const draw = async (text: string, images: any[] = parts.slice(1)) => {
        const provider = await deps.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }, ...images] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: requestedAspect, imageSize: '4K' } } }),
          signal: AbortSignal.timeout(100_000),
        });
        if (!provider.ok) throw new Error(provider.status === 429 ? 'The design service is busy. Your render credit will be returned.' : 'The design service could not complete this request. Your render credit will be returned.');
        return finalWallImage(await provider.json());
      };
      let final: { mimeType: string; data: string };
      let recoveredFrom: string | null = null;
      try { final = await draw(parts[0].text); }
      catch (err) {
        // IMAGE_RECITATION on a match: the model declined to reproduce a
        // reference it recognises as a published photograph. Measured 3/3 on
        // 2026-09-11 against a stock slat-wall photo, failing the customer
        // with nothing. One retry asks for an ORIGINAL covering in the
        // reference's material instead of a copy; anything else re-throws.
        const reason = err instanceof Error ? err.message.match(/\(([A-Z_]+)\)/)?.[1] || '' : '';
        if (input.intent !== 'match' || !reason.includes('RECITATION')) throw err;
        recoveredFrom = reason;
        // The filter matches the photograph, not the words (a retry that still
        // attached the customer's own photo was refused again, 2026-09-11
        // 19:36). So: the fast text model describes the covering in the
        // reference, and the retry draws from those words with NO image
        // attached. The description is best effort; without one the retry
        // still goes, with the images, as the lesser chance.
        const referencePart = [...parts].reverse().find((p: any) => p?.inlineData) || null;
        const description = referencePart ? await describeCovering(deps.fetch, key, referencePart).catch(() => null) : null;
        console.log(JSON.stringify({ event: 'wall_match_recitation_retry', request_id: input.requestId, reason, described: !!description, description }));
        final = await draw(wallMatchRecoveryPrompt({ ...input, description }), description ? [] : parts.slice(1));
      }
      const bytes = decodeWallImage(final.data);
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('The design image exceeded the supported size.');
      // Production is judged by returned pixels over wall inches, never by the
      // size that was requested. Log both so the enlargement a wall needs is a
      // recorded number, and hand the same numbers back to the caller.
      const aspectRatio = requestedAspect;
      const dims = imageDimensions(bytes);
      const enlargement = dims ? Number(Math.max(input.width * PRODUCTION_PPI / dims.width, input.height * PRODUCTION_PPI / dims.height).toFixed(2)) : null;
      console.log(JSON.stringify({ event: 'wall_master_returned', request_id: input.requestId, intent: input.intent, recovered_from: recoveredFrom, model: MODEL, requested_image_size: '4K', aspect_ratio: aspectRatio, mime: final.mimeType, bytes: bytes.length, width: dims?.width ?? null, height: dims?.height ?? null, wall_in: [input.width, input.height], production_ppi: PRODUCTION_PPI, required_enlargement: enlargement }));
      const ext = final.mimeType === 'image/jpeg' ? 'jpg' : final.mimeType === 'image/webp' ? 'webp' : 'png';
      const path = owner + '/generated/' + input.requestId + '.' + ext;
      const name = (input.intent === 'refine' ? 'Refined: ' + input.prompt.trim() : input.prompt.trim() || (input.intent === 'match' ? 'Matched design' : input.intent === 'wall' ? 'Design for your wall' : 'Wall design')).slice(0, 120);
      const uploaded = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: final.mimeType, upsert: false });
      if (uploaded.error) throw new Error('The design could not be saved. Your render credit will be returned.');
      const finish = await sb.rpc('finish_wallpro_generation', { p_id: input.requestId, p_owner: owner, p_path: path, p_name: name, p_error: null });
      if (finish.error) throw new Error('The design could not be recorded. Reopen My wall designs to check its status.');
      reserved = false;
      const settled = await signedResult(finish.data);
      if (settled.status !== 200) return settled;
      const payload = await settled.json();
      return response({ ...payload, model: MODEL, requested_image_size: '4K', aspect_ratio: aspectRatio, width: dims?.width ?? null, height: dims?.height ?? null, production_ppi: PRODUCTION_PPI, required_enlargement: enlargement, recovered_from: recoveredFrom });
    } catch (err) {
      const message = err instanceof Error && ['TimeoutError','AbortError'].includes(err.name) ? 'The design service timed out. No automatic retry was sent.' : err instanceof Error ? err.message : 'Wall design generation failed.';
      if (reserved) {
        const refund = await sb.rpc('finish_wallpro_generation', { p_id: input.requestId, p_owner: owner, p_path: null, p_name: null, p_error: message });
        if (refund.error) return response({ error: message + ' The request is saved; its credit return needs reconciliation.', code: 'REFUND_PENDING', request_id: input.requestId }, 503);
      }
      return response({ error: message, code: 'GENERATION_FAILED', request_id: input.requestId }, 502);
    }
  };
}
