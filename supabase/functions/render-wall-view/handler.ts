// AI view on the wall: the customer's room photo plus the flat print master go
// to the image model, which paints the covering onto the wall surface only and
// leaves windows, drapes, furniture and everything else exactly as photographed.
// This is a presentation picture, the ChatGPT-style "show me", and never a
// print file: the flat master stays the production truth. No token is charged.
import { decodeWallImage, finalWallImage } from '../generate-wall-design/handler.ts';

const BUCKET = 'wallpro-files';
export const VIEW_MODEL = 'gemini-3-pro-image';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const toBase64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };

export function viewPrompt(input: { placement: string; repeatWidthIn: number | null; wallWidthIn: number | null; wallHeightIn: number | null }): string {
  const scale = input.placement === 'repeat' && input.repeatWidthIn
    ? `The design is a repeating tile about ${input.repeatWidthIn} inches wide; repeat it seamlessly at that real-world size across the wall${input.wallWidthIn ? ` (the wall is about ${input.wallWidthIn} inches wide${input.wallHeightIn ? ` and ${input.wallHeightIn} inches tall` : ''})` : ''}.`
    : `The design is one mural that fills the whole wall edge to edge${input.wallWidthIn ? ` (the wall is about ${input.wallWidthIn} inches wide${input.wallHeightIn ? ` and ${input.wallHeightIn} inches tall` : ''})` : ''}.`;
  return [
    'Image 1 is a photograph of a customer\'s room. Image 2 is the flat print master of a printed wall covering.',
    'Render the SAME photograph with the wall covering installed on its main wall. Keep the camera, framing, lens, lighting, colours and every object exactly as photographed: furniture, bed, shelves, window, glass, curtains, drapes and rods, doors, outlets, switches, artwork and anything else that is not the flat wall surface stays untouched and in front of the covering.',
    'The covering appears only on the flat wall surface, running behind furniture and around the window and drapes, with correct perspective, realistic lighting, soft shadows and the wall\'s own texture where the room lighting falls on it.',
    scale,
    'Do not restyle the room, add or remove objects, move the camera, crop, add borders or text, or change the design\'s colours or motifs. Output only the rendered photograph.',
  ].join(' ');
}

function nearestAspect(width: number, height: number): string {
  const options: [string, number][] = [['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['3:2', 1.5], ['2:3', 2 / 3], ['16:9', 16 / 9], ['9:16', 9 / 16], ['5:4', 1.25], ['4:5', 0.8], ['21:9', 21 / 9]];
  const target = width / height;
  return options.reduce((best, cur) => Math.abs(cur[1] - target) < Math.abs(best[1] - target) ? cur : best)[0];
}
function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) { const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return { width: dv.getUint32(16), height: dv.getUint32(20) }; }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length - 8) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1]; i += 2;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
      const len = (bytes[i] << 8) | bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: (bytes[i + 3] << 8) | bytes[i + 4], width: (bytes[i + 5] << 8) | bytes[i + 6] };
      if (len < 2) break; i += len;
    }
  }
  return null;
}

export function parseViewInput(body: any, owner: string) {
  const check = (path: unknown, folders: string[]) => {
    const parts = typeof path === 'string' ? path.split('/') : [];
    const catalog = folders.includes('catalog') && parts.length === 2 && parts[0] === 'catalog' && /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(parts[1]);
    const owned = parts.length === 3 && parts[0] === owner && folders.includes(parts[1]) && /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(parts[2]);
    if (!catalog && !owned) throw new Error('The wall photo and the design must be your own files.');
    return path as string;
  };
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 2400 ? v : null;
  return {
    wallPath: check(body?.wallPath, ['uploads']),
    artworkPath: check(body?.artworkPath, ['uploads', 'generated', 'catalog']),
    placement: body?.placement === 'repeat' ? 'repeat' : 'cover',
    repeatWidthIn: num(body?.repeatWidthIn), wallWidthIn: num(body?.wallWidthIn), wallHeightIn: num(body?.wallHeightIn),
  };
}

export function createViewHandler(deps: { createClient: (...args: any[]) => any; supabaseUrl: string; serviceKey: string; apiKey: () => string; fetch: typeof fetch }) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
    const sb = deps.createClient(deps.supabaseUrl, deps.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const { data: auth, error: authError } = jwt ? await sb.auth.getUser(jwt).catch(() => ({ data: null, error: true })) : { data: null, error: true };
    if (authError || !auth?.user?.id) return response({ error: 'Sign in to see the design on your wall.', code: 'AUTH_REQUIRED' }, 401);
    const owner = auth.user.id;
    let input: ReturnType<typeof parseViewInput>;
    try { input = parseViewInput(JSON.parse(await req.text()), owner); }
    catch (err) { return response({ error: err instanceof Error ? err.message : 'Invalid request' }, 400); }
    const key = deps.apiKey();
    if (!key) return response({ error: 'The wall view is not configured.', code: 'NOT_CONFIGURED' }, 503);
    const parts: any[] = [{ text: viewPrompt(input) }];
    let wallDims: { width: number; height: number } | null = null, total = 0;
    for (const [label, path] of [['Image 1 — the room photograph', input.wallPath], ['Image 2 — the flat print master of the wall covering', input.artworkPath]] as const) {
      const downloaded = await sb.storage.from(BUCKET).download(path);
      if (downloaded.error || !downloaded.data) return response({ error: 'Your ' + (path === input.wallPath ? 'wall photo' : 'design') + ' could not be read.', code: 'UPLOAD_UNREADABLE' }, 400);
      const blob = downloaded.data as Blob;
      if (!imageTypes.includes(blob.type) || blob.size > 20 * 1024 * 1024) return response({ error: 'Images must be JPG, PNG or WebP and no larger than 20 MB.' }, 400);
      total += blob.size;
      if (total > 14 * 1024 * 1024) return response({ error: 'The wall photo and design together must be under 14 MB for the AI view.' }, 400);
      const raw = new Uint8Array(await blob.arrayBuffer());
      if (path === input.wallPath) wallDims = imageDimensions(raw);
      parts.push({ text: label }, { inlineData: { mimeType: blob.type, data: toBase64(raw) } });
    }
    const aspectRatio = wallDims ? nearestAspect(wallDims.width, wallDims.height) : '4:3';
    try {
      const provider = await deps.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + VIEW_MODEL + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize: '2K' } } }),
        signal: AbortSignal.timeout(100_000),
      });
      if (!provider.ok) throw new Error(provider.status === 429 ? 'The image service is busy. Try again in a moment.' : 'The wall view could not be rendered right now.');
      const final = finalWallImage(await provider.json());
      const bytes = decodeWallImage(final.data);
      const ext = final.mimeType === 'image/jpeg' ? 'jpg' : final.mimeType === 'image/webp' ? 'webp' : 'png';
      const path = owner + '/views/' + crypto.randomUUID() + '.' + ext;
      const uploaded = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: final.mimeType, upsert: false });
      if (uploaded.error) throw new Error('The wall view could not be saved.');
      const signed = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
      console.log(JSON.stringify({ event: 'wall_view_rendered', owner, wallPath: input.wallPath, artworkPath: input.artworkPath, model: VIEW_MODEL, aspect_ratio: aspectRatio, bytes: bytes.length }));
      return response({ view_path: path, view_url: signed.data?.signedUrl || null, model: VIEW_MODEL, aspect_ratio: aspectRatio });
    } catch (err) {
      const message = err instanceof Error && ['TimeoutError', 'AbortError'].includes(err.name) ? 'The image service timed out. Try again.' : err instanceof Error ? err.message : 'The wall view failed.';
      return response({ error: message.replace(/ Your render credit will be returned\.?/g, ''), code: 'VIEW_FAILED' }, 502);
    }
  };
}
