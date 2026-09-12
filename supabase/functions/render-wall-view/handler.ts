// AI view on the wall: the customer's room photo plus the flat print master go
// to the image model, which paints the covering onto the wall surface. Fixed
// architecture (windows, drapes, mounted TVs, built-ins) stays exactly as
// photographed; freestanding furniture or equipment DesignPro's own detection
// classified as movable (wallpro-occlusion.ts on the client) is erased and
// painted through instead, as an installer would after clearing the room.
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
    'Render the SAME photograph with the wall covering installed on its main wall. Keep the camera, framing, lens, lighting and colours exactly as photographed. Every object that is not the flat wall surface -- furniture, bed, shelves, window, glass, curtains, drapes and rods, doors, outlets, switches, artwork -- stays untouched and in front of the covering, UNLESS a later image explicitly marks that exact object for removal, in which case follow that instruction instead.',
    'The covering appears only on the flat wall surface, running behind furniture and around the window and drapes, with correct perspective, realistic lighting, soft shadows and the wall\'s own texture where the room lighting falls on it.',
    scale,
    'Do not restyle the room, move the camera, crop, add borders or text, or change the design\'s colours or motifs. Do not add or remove any object except where a later image explicitly marks it for removal. Output only the rendered photograph.',
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
    // Optional: a protected-area PNG built client-side from the customer's own
    // hand-drawn masks / detected objects (see buildProtectedAreaMask). Absent
    // for the common case, in which this view behaves exactly as before.
    maskPath: body?.maskPath == null ? null : check(body.maskPath, ['uploads']),
    // Optional: the opposite instruction -- items DesignPro's own detection
    // classified as movable (wallpro-occlusion.ts), erased and painted
    // through rather than protected.
    removePath: body?.removePath == null ? null : check(body.removePath, ['uploads']),
    placement: body?.placement === 'repeat' ? 'repeat' : 'cover',
    repeatWidthIn: num(body?.repeatWidthIn), wallWidthIn: num(body?.wallWidthIn), wallHeightIn: num(body?.wallHeightIn),
  };
}

/** The actual guarantee, isolated as pure pixel math so it is exercised by a
 * plain test without an image codec: wherever the mask's alpha exceeds the
 * threshold, `outPx`'s RGB channels are overwritten with `wallPx`'s own pixels
 * at that same index. All three buffers must already share the same
 * dimensions -- resizing to agree is the caller's job. Exported so
 * wallpro-view.test.ts can assert the rule directly; the Deno-only
 * decode/resize/encode around it below is thin, uncomposable image-library
 * glue with nothing of its own to unit-test. */
export function applyProtectedAreaMask(outPx: Uint8ClampedArray, wallPx: Uint8ClampedArray, maskPx: Uint8ClampedArray): void {
  for (let i = 0; i < outPx.length; i += 4) {
    if (maskPx[i + 3] > 127) { outPx[i] = wallPx[i]; outPx[i + 1] = wallPx[i + 1]; outPx[i + 2] = wallPx[i + 2]; }
  }
}

/** Guarantees protected areas survive exactly as photographed, regardless of
 * whether the model actually honored the mask instruction: resizes the mask
 * and the original photo to the model's own output size, then applies
 * `applyProtectedAreaMask`. Runs only when a mask was supplied; any
 * decode/resize failure is the caller's to catch, so a corrupt mask never
 * blocks the view -- it just leaves the model's own attempt standing.
 * `imagescript` is imported dynamically (a Deno-only remote URL): this file
 * is also loaded directly by the Node/vitest suite, which cannot resolve an
 * `https:` import specifier at module-load time, only at call time -- and no
 * test exercises this path, matching the same Deno-only/vitest-tested split
 * `_shared/cut-contour/produce.ts` already draws for the same library. */
/** The graph behind "ironclad": protection is a deterministic guarantee
 * (applyProtectedAreaMask, above), but a generative erase cannot be one --
 * so removal gets the next best thing, verify-then-retry, instead of a
 * single unchecked shot. A fast, cheap vision call looks ONLY inside the
 * remove mask's white areas and asks whether the original object still
 * shows there. Returns null (inconclusive) on any provider or parse
 * failure rather than forcing a retry blind -- a failed check must never
 * cost the customer an extra ~30s generation for nothing. This is an
 * in-process check-and-retry loop, not the durable multi-worker node graph
 * Call 1 authoring uses: that infrastructure earns its cost on a paid,
 * multi-minute, production-blocking step, and this is a free, single-
 * request preview view completing in one round trip. If usage ever shows
 * this needs to survive a worker restart or run across workers, promoting
 * it to a real graph is the same well-precedented move RULE 0.35's
 * addendum already made for Call 1, not new architecture. */
async function verifyRemoval(fetchImpl: typeof fetch, key: string, wallPhotoMimeType: string, wallPhotoBytes: Uint8Array, outputMimeType: string, outputBytes: Uint8Array, removeMaskBytes: Uint8Array): Promise<boolean | null> {
  try {
    const provider = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: 'Image 1 is a room photo before editing. Image 2 is the same room after a wall covering was painted in; every object inside the white, opaque areas of Image 3 (a mask) was supposed to be erased there and replaced by the wall covering. Look ONLY inside those white areas. Does Image 2 still show any part of the original object there, rather than the wall covering? Answer JSON only: {"stillVisible": true or false}.' },
          { inlineData: { mimeType: wallPhotoMimeType, data: toBase64(wallPhotoBytes) } },
          { inlineData: { mimeType: outputMimeType, data: toBase64(outputBytes) } },
          { inlineData: { mimeType: 'image/png', data: toBase64(removeMaskBytes) } },
        ] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!provider.ok) return null;
    const result = await provider.json();
    const text = String(result?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '');
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    return typeof parsed?.stillVisible === 'boolean' ? parsed.stillVisible : null;
  } catch { return null; }
}

async function recompositeProtectedAreas(outputBytes: Uint8Array, wallPhotoBytes: Uint8Array, maskBytes: Uint8Array): Promise<Uint8Array> {
  const { Image } = await import("https://deno.land/x/imagescript@1.2.15/mod.ts");
  const [outImg, wallImg, maskImg] = await Promise.all([
    Image.decode(outputBytes) as Promise<any>,
    Image.decode(wallPhotoBytes) as Promise<any>,
    Image.decode(maskBytes) as Promise<any>,
  ]);
  const w = outImg.width, h = outImg.height;
  const wall = (wallImg.width === w && wallImg.height === h) ? wallImg : wallImg.resize(w, h);
  const mask = (maskImg.width === w && maskImg.height === h) ? maskImg : maskImg.resize(w, h);
  applyProtectedAreaMask(outImg.bitmap as Uint8ClampedArray, wall.bitmap as Uint8ClampedArray, mask.bitmap as Uint8ClampedArray);
  return await outImg.encode(6);
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
    let wallDims: { width: number; height: number } | null = null, total = 0, wallPhotoBytes: Uint8Array | null = null, wallPhotoMimeType = 'image/jpeg';
    for (const [label, path] of [['Image 1 — the room photograph', input.wallPath], ['Image 2 — the flat print master of the wall covering', input.artworkPath]] as const) {
      const downloaded = await sb.storage.from(BUCKET).download(path);
      if (downloaded.error || !downloaded.data) return response({ error: 'Your ' + (path === input.wallPath ? 'wall photo' : 'design') + ' could not be read.', code: 'UPLOAD_UNREADABLE' }, 400);
      const blob = downloaded.data as Blob;
      if (!imageTypes.includes(blob.type) || blob.size > 20 * 1024 * 1024) return response({ error: 'Images must be JPG, PNG or WebP and no larger than 20 MB.' }, 400);
      total += blob.size;
      if (total > 14 * 1024 * 1024) return response({ error: 'The wall photo and design together must be under 14 MB for the AI view.' }, 400);
      const raw = new Uint8Array(await blob.arrayBuffer());
      if (path === input.wallPath) { wallDims = imageDimensions(raw); wallPhotoBytes = raw; wallPhotoMimeType = blob.type; }
      parts.push({ text: label }, { inlineData: { mimeType: blob.type, data: toBase64(raw) } });
    }
    // Both optional masks are best effort: a missing, unreadable or oversized
    // mask silently drops that mask alone, never the whole view -- the
    // customer already has a correct render without it, from the prose
    // instruction. Image numbers advance dynamically so the wording is right
    // whether one, both, or neither mask is present.
    let nextImage = 3;
    async function attachMask(path: string | null, instruction: string): Promise<Uint8Array | null> {
      if (!path) return null;
      const downloaded = await sb.storage.from(BUCKET).download(path).catch(() => ({ data: null, error: true } as const));
      if (!downloaded.data || (downloaded.data as Blob).type !== 'image/png' || (downloaded.data as Blob).size > 10 * 1024 * 1024) return null;
      const bytes = new Uint8Array(await (downloaded.data as Blob).arrayBuffer());
      parts.push({ text: `Image ${nextImage++} — ${instruction}` }, { inlineData: { mimeType: 'image/png', data: toBase64(bytes) } });
      return bytes;
    }
    const maskBytes = await attachMask(input.maskPath, 'protected areas: white and opaque marks anything that must stay pixel-for-pixel exactly as photographed (windows, drapes, furniture, framed art, mirrors, TVs, shelving and everything on it). The covering never paints over a white area; it continues on the wall behind it.');
    const removeBytes = await attachMask(input.removePath, 'items to remove: white and opaque marks freestanding furniture or equipment that will be moved out of the room before the covering is installed. Erase it entirely and paint the covering through that area as if it were never there -- do not preserve it, and do not treat it as something to paint around.');
    const aspectRatio = wallDims ? nearestAspect(wallDims.width, wallDims.height) : '4:3';
    async function paint(requestParts: any[]): Promise<{ bytes: Uint8Array; mimeType: string }> {
      const provider = await deps.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + VIEW_MODEL + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: requestParts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize: '2K' } } }),
        signal: AbortSignal.timeout(100_000),
      });
      if (!provider.ok) throw new Error(provider.status === 429 ? 'The image service is busy. Try again in a moment.' : 'The wall view could not be rendered right now.');
      const final = finalWallImage(await provider.json());
      return { bytes: decodeWallImage(final.data), mimeType: final.mimeType };
    }
    try {
      let { bytes, mimeType } = await paint(parts);
      // Ironclad has two different meanings here. Protection is a
      // deterministic guarantee below. Removal is a generative edit, which
      // can only ever be checked and retried, never guaranteed -- so it is:
      // one cheap verification pass, and if the object is still there, one
      // retry with a strengthened instruction before accepting the result.
      let removalVerified: boolean | null = null, removalRetried = false;
      if (removeBytes && wallPhotoBytes) {
        const stillVisible = await verifyRemoval(deps.fetch, key, wallPhotoMimeType, wallPhotoBytes, mimeType, bytes, removeBytes);
        if (stillVisible === true) {
          removalRetried = true;
          try {
            const retryParts = [...parts, { text: 'Your previous attempt still showed the object marked for removal. Erase it completely this time: there must be no trace of it anywhere the removal mask is white, only the wall covering.' }];
            const retried = await paint(retryParts);
            const stillVisibleAfterRetry = await verifyRemoval(deps.fetch, key, wallPhotoMimeType, wallPhotoBytes, retried.mimeType, retried.bytes, removeBytes);
            bytes = retried.bytes; mimeType = retried.mimeType;
            removalVerified = stillVisibleAfterRetry === true ? false : stillVisibleAfterRetry === false ? true : null;
          } catch (e) {
            // The first attempt's bytes stand; removal simply could not be
            // confirmed, never a reason to fail an otherwise-working view.
            console.error('[render-wall-view] removal retry failed', e instanceof Error ? e.message : e);
            removalVerified = false;
          }
        } else removalVerified = stillVisible === false ? true : null;
      }
      let recomposited = false;
      // Guarantee, not hope: whatever the model actually painted, protected
      // pixels are restored from the real photo before this ever reaches the
      // customer. A recompositing failure (an undecodable mask, an unusual
      // photo codec) falls back to the model's own attempt rather than
      // failing a view that was otherwise successful.
      if (maskBytes && wallPhotoBytes) {
        try { bytes = await recompositeProtectedAreas(bytes, wallPhotoBytes, maskBytes); mimeType = 'image/png'; recomposited = true; }
        catch (e) { console.error('[render-wall-view] mask recomposite failed', e instanceof Error ? e.message : e); }
      }
      const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
      const path = owner + '/views/' + crypto.randomUUID() + '.' + ext;
      const uploaded = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false });
      if (uploaded.error) throw new Error('The wall view could not be saved.');
      const signed = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
      console.log(JSON.stringify({ event: 'wall_view_rendered', owner, wallPath: input.wallPath, artworkPath: input.artworkPath, model: VIEW_MODEL, aspect_ratio: aspectRatio, bytes: bytes.length, masked: !!maskBytes, removeMasked: !!removeBytes, removalVerified, removalRetried, recomposited }));
      return response({ view_path: path, view_url: signed.data?.signedUrl || null, model: VIEW_MODEL, aspect_ratio: aspectRatio, removal_verified: removalVerified });
    } catch (err) {
      const message = err instanceof Error && ['TimeoutError', 'AbortError'].includes(err.name) ? 'The image service timed out. Try again.' : err instanceof Error ? err.message : 'The wall view failed.';
      return response({ error: message.replace(/ Your render credit will be returned\.?/g, ''), code: 'VIEW_FAILED' }, 502);
    }
  };
}
