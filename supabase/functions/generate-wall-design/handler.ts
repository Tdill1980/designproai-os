import { wallDesignPrompt } from './prompt.ts';

const BUCKET = 'wallpro-files';
const MODEL = 'gemini-3-pro-image';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const numberInRange = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 2400;

export function parseWallInput(body: any, owner: string) {
  if (!uuid.test(body.requestId || '') || !numberInRange(body.width) || !numberInRange(body.height)) throw new Error('Enter a valid wall width and height between 1 and 2,400 inches.');
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 6000) throw new Error('Describe your wall design in 1–6,000 characters.');
  if (!['cover', 'contain', 'repeat'].includes(body.placement)) throw new Error('Choose a mural or repeating-pattern placement.');
  const checkPath = (path: any) => {
    if (path === undefined || path === null) return null;
    if (typeof path !== 'string' || !path.startsWith(owner + '/uploads/') || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path.split('/')[2] || '') || path.split('/').length !== 3) throw new Error('The reference image is not one of your uploaded files.');
    return path;
  };
  return { requestId: body.requestId, prompt: body.prompt.trim(), width: body.width, height: body.height, placement: body.placement, wallPath: checkPath(body.wallPath), referencePath: checkPath(body.referencePath) };
}

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
      for (const [label, path] of [['Wall photo — architectural context only', input.wallPath], ['Style reference / existing wall design', input.referencePath]]) {
        if (!path) continue;
        const downloaded = await sb.storage.from(BUCKET).download(path);
        if (downloaded.error || !downloaded.data) return response({ error: 'Your ' + label.toLowerCase() + ' could not be read. Upload it again before generating.', code: 'UPLOAD_UNREADABLE' }, 400);
        const blob = downloaded.data as Blob;
        if (!imageTypes.includes(blob.type) || blob.size > 20 * 1024 * 1024) return response({ error: 'Reference images must be JPG, PNG or WebP and no larger than 20 MB.' }, 400);
        referenceBytes += blob.size;
        if (referenceBytes > 14 * 1024 * 1024) return response({ error: 'For AI generation, use smaller wall and reference images totaling no more than 14 MB. Your full-size artwork can still be uploaded for a preview.' }, 400);
        parts.push({ text: label }, { inlineData: { mimeType: blob.type, data: toBase64(new Uint8Array(await blob.arrayBuffer())) } });
      }
      const reservation = await sb.rpc('reserve_wallpro_generation', { p_id: input.requestId, p_owner: owner, p_hash: hash, p_input: input });
      if (reservation.error) {
        const reason = reservation.error.message || '';
        return response({ error: reason.includes('no_tokens') ? 'You need a design token or an available plan render to generate. Uploaded artwork previews are free.' : reason.includes('generation_in_progress') ? 'A wall design is already generating. Wait for it to finish.' : 'This request could not be reserved. Try again.', code: reason.includes('no_tokens') ? 'NO_TOKENS' : 'REQUEST_CONFLICT' }, reason.includes('no_tokens') ? 402 : 409);
      }
      if (!reservation.data.fresh) return await signedResult(reservation.data.generation);
      reserved = true;
      const provider = await deps.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT','IMAGE'], imageConfig: { aspectRatio: input.placement === 'repeat' ? '1:1' : nearestAspect(input.width,input.height), imageSize: '4K' } } }),
        signal: AbortSignal.timeout(100_000),
      });
      if (!provider.ok) throw new Error(provider.status === 429 ? 'The design service is busy. Your render credit will be returned.' : 'The design service could not complete this request. Your render credit will be returned.');
      const result = await provider.json();
      const outputs = result.candidates?.[0]?.content?.parts || [];
      const final = outputs.filter((p: any) => p.inlineData?.data && !p.thought).at(-1)?.inlineData;
      if (!final || !imageTypes.includes(final.mimeType)) throw new Error('No usable design image was returned. Try a different description.');
      const bytes = Uint8Array.from(atob(final.data), c => c.charCodeAt(0));
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('The design image exceeded the supported size.');
      const ext = final.mimeType === 'image/jpeg' ? 'jpg' : final.mimeType === 'image/webp' ? 'webp' : 'png';
      const path = owner + '/generated/' + input.requestId + '.' + ext;
      const name = (outputs.find((p: any) => p.text && !p.thought)?.text || 'Wall design').trim().slice(0, 120);
      const uploaded = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: final.mimeType, upsert: false });
      if (uploaded.error) throw new Error('The design could not be saved. Your render credit will be returned.');
      const finish = await sb.rpc('finish_wallpro_generation', { p_id: input.requestId, p_owner: owner, p_path: path, p_name: name, p_error: null });
      if (finish.error) throw new Error('The design could not be recorded. Reopen My wall designs to check its status.');
      reserved = false;
      return await signedResult(finish.data);
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
