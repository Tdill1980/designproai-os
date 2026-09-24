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

/** THE RENDER IS PRESENTATION AUTHORITY, NEVER ARTWORK AUTHORITY (RULE 0.29).
 *
 * Owner, 2026-09-24, on her own on-wall picture: "massive regression that looks
 * like shit that doesnt look like a wall wrap" — then, with the good one beside
 * it, "I am saying how it DISPLAYED my other wall". Two separate defects sat
 * behind that and only one of them was the design.
 *
 * The DESIGN defect was `domain.ts` defaulting every brief to `commercial`, so
 * a living-room brief was drawn by the sign-shop persona while `overrideDomain`
 * sat there unreachable. Fixed on the generate side; the app sends the domain.
 *
 * The DISPLAY defect is this prompt, and it was never missing a persona so much
 * as missing a MATERIAL. Five sentences, four of them prohibitions, and not one
 * of them ever said what the thing on the wall physically IS. "Render the
 * photograph with the wall covering installed" names no substance, no finish
 * and no edge, so the model did the literal thing: it pasted the master onto
 * the wall at the master's own flat lighting, like a decal. That is exactly
 * what "doesn't look like a wall wrap" describes — printed vinyl bonded to a
 * real wall takes the room's light, not its own.
 *
 * ⚠️ AND THE DESIGNER PERSONA IS NOT THE FIX EITHER — DO NOT IMPORT IT HERE.
 * Handing WALL_DESIGNER or RESIDENTIAL_DESIGNER to this call invites the model
 * to DESIGN, and designing is the one thing this call may never do: the
 * customer approves what they see and receives what prints, and that gap is
 * what took this view off the customer path on 2026-09-12. So the persona is
 * the one the vehicle stack already uses for precisely this job — a
 * PHOTOGRAPHER (`persona-photographer-render`; RULE 0.29: "photographer +
 * angles + studio + lighting = presentation authority only") — chosen by the
 * SAME deterministic domain that chose the designer, so a bedroom is shot like
 * a bedroom and a lobby like a lobby. No model picks it.
 */
const RESIDENTIAL_PHOTOGRAPHER =
  'You are an interior photographer shooting a finished custom wallcovering installation for the manufacturer\'s own lookbook: a real room in a real home, photographed after the installer has packed up.';
const COMMERCIAL_PHOTOGRAPHER =
  'You are an environmental-graphics photographer shooting a finished large-format wall graphic for a sign company\'s portfolio: a real commercial interior, photographed after the installer has packed up.';

/** Selected by code from a classification that is itself deterministic, exactly
 * as `designerPersonaFor` selects the designer. Absent (an older client), the
 * commercial voice runs — the same fallback `classifyWallDomain` itself takes,
 * so the two halves of the product can never disagree about who is speaking. */
export function viewPhotographerFor(domain: string | null | undefined): string {
  return domain === 'residential' ? RESIDENTIAL_PHOTOGRAPHER : COMMERCIAL_PHOTOGRAPHER;
}

export function viewPrompt(input: { placement: string; repeatWidthIn: number | null; wallWidthIn: number | null; wallHeightIn: number | null; designDomain?: string | null }): string {
  const scale = input.placement === 'repeat' && input.repeatWidthIn
    ? `The design is a repeating tile about ${input.repeatWidthIn} inches wide; repeat it seamlessly at that real-world size across the wall${input.wallWidthIn ? ` (the wall is about ${input.wallWidthIn} inches wide${input.wallHeightIn ? ` and ${input.wallHeightIn} inches tall` : ''})` : ''}.`
    : `The design is one mural that fills the whole wall edge to edge${input.wallWidthIn ? ` (the wall is about ${input.wallWidthIn} inches wide${input.wallHeightIn ? ` and ${input.wallHeightIn} inches tall` : ''})` : ''}.`;
  return [
    viewPhotographerFor(input.designDomain),
    'Image 1 is that photograph of the customer\'s room. Image 2 is the flat print master of the covering that was installed.',
    'Render the SAME photograph with the covering installed on its main wall. Keep the camera, framing, lens, lighting and colours exactly as photographed. Every object that is not the flat wall surface -- furniture, bed, shelves, window, glass, curtains, drapes and rods, doors, outlets, switches, artwork -- stays untouched and in front of the covering, UNLESS a later image explicitly marks that exact object for removal, in which case follow that instruction instead.',
    // THE SENTENCE THAT WAS MISSING. Everything above only ever said where the
    // covering goes; nothing said what it is made of, so it arrived as a decal.
    'MATERIAL: this is printed vinyl wallcovering bonded flat to the wall, not a decal, a poster, a framed picture or a projection. It lies in the wall\'s own plane and takes the wall\'s own perspective, and it is lit by the room and not by itself: brighter where the room\'s light falls across it, falling into shadow in the corners, under the ceiling and behind every object, with the faint satin sheen printed vinyl shows where a light source rakes along it and the wall\'s own surface texture reading faintly through. It is trimmed clean into the ceiling line, the baseboard and the inside corners, and continues behind furniture, the window casing and the drapes. No visible seam, outline, border, frame, drop shadow, curl or lifted corner anywhere.',
    scale,
    'Do not restyle the room, move the camera, crop, add borders or text, and do not redraw, restyle, recolour or rearrange the design itself -- its motifs, palette, spacing and scale are fixed by Image 2 and are not yours to improve. Do not add or remove any object except where a later image explicitly marks it for removal. Output only the rendered photograph.',
  ].join(' ');
}

/** WHAT THE PROVIDER REQUEST MAY CARRY, AND WHY EXCEEDING IT IS NOT AN ERROR.
 *
 * Owner, 2026-09-24, on her own project: the page showed "The wall photo and
 * design together must be under 14 MB for the AI view." That is this function
 * refusing, and on the day the AI render became the on-wall view for everyone
 * it means her main view simply does not exist — for the sin of photographing
 * her wall with a modern phone and generating a 4K master. Both are things
 * WallPro told her to do.
 *
 * Nothing was gained by refusing. The model reads these images at roughly 2K
 * whatever is sent, so a 12 MB photo buys no fidelity, costs upload time and
 * is the only reason the ceiling is ever reached. So an oversized image is
 * RESIZED to fit and the request goes ahead. The refusal survives only as the
 * last resort, for something that cannot be decoded at all.
 *
 * `prepareWallUpload` on the client deliberately passes a JPG/PNG/WebP through
 * byte for byte so a print-ready upload is never re-compressed — that rule is
 * right and untouched. This shrink is for the MODEL REQUEST only; the stored
 * original, the composite and every print file still read the full-size file.
 */
export const PROVIDER_BUDGET_BYTES = 14 * 1024 * 1024;
const PROVIDER_MAX_EDGE = 2048;

/** The policy, pure and with the codec injected, so it is exercised by a plain
 * test: the Deno-only decode/resize/encode is the caller's default `shrink`.
 * Under budget, the array is returned untouched and nothing is decoded — the
 * common case pays nothing at all. */
/* ⚠️ `shrink` TAKES THE NARROW SHAPE, NOT `T`, AND THAT IS LOAD-BEARING.
 * Typed `(source: T) => ...`, TypeScript infers T from the ARGUMENT as well as
 * from `sources`, and the caller's `shrinkForProvider` — which legitimately
 * only needs the bytes — collapsed T to `{bytes, mimeType}`. The returned array
 * then lost `path` and `label`, which the handler reads two lines later.
 * Runtime was fine (the spread preserves every property and the tests pass),
 * so nothing caught it until the first typecheck that actually opened the file
 * (2026-09-24: `npx tsc --noEmit` resolves a tsconfig with "files": [] and
 * checks NOTHING). A resize helper has no business narrowing its caller's rows.
 */
export async function fitProviderImages<T extends { bytes: Uint8Array; mimeType: string }>(
  sources: T[],
  budget: number,
  shrink: (source: { bytes: Uint8Array; mimeType: string }) => Promise<{ bytes: Uint8Array; mimeType: string } | null>,
): Promise<T[]> {
  const total = (list: T[]) => list.reduce((sum, s) => sum + s.bytes.length, 0);
  if (total(sources) <= budget) return sources;
  const out = [...sources];
  // Largest first. One 12 MB photograph beside a 1 MB design is the ordinary
  // shape of this, and decoding the small one would spend a decode for nothing.
  const bySize = out.map((_, i) => i).sort((a, b) => out[b].bytes.length - out[a].bytes.length);
  for (const index of bySize) {
    if (total(out) <= budget) break;
    const smaller = await shrink(out[index]);
    // A source that cannot be decoded is left exactly as it was: a failed
    // resize must never truncate or corrupt the image it was trying to help.
    if (smaller) out[index] = { ...out[index], ...smaller };
  }
  return out;
}

/** Deno-only, like `recompositeProtectedAreas` and for the same reason: the
 * vitest suite cannot resolve an `https:` specifier at module-load time. It is
 * thin, uncomposable image-library glue; `fitProviderImages` above holds the
 * decision this file actually needs to be sure of. */
async function shrinkForProvider(source: { bytes: Uint8Array; mimeType: string }): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  try {
    const { Image } = await import("https://deno.land/x/imagescript@1.2.15/mod.ts");
    const img = await Image.decode(source.bytes) as any;
    const longest = Math.max(img.width, img.height);
    if (longest <= PROVIDER_MAX_EDGE) return null;
    const scale = PROVIDER_MAX_EDGE / longest;
    const resized = img.resize(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
    return { bytes: await resized.encodeJPEG(82), mimeType: 'image/jpeg' };
  } catch (e) {
    console.error('[render-wall-view] provider shrink failed', e instanceof Error ? e.message : e);
    return null;
  }
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
    // Which photographer speaks (viewPhotographerFor). Whitelisted rather than
    // passed through: this string reaches the model, so an unknown value is
    // dropped to null and takes the documented fallback, never carried into the
    // prompt as free text from the request body.
    designDomain: body?.designDomain === 'residential' ? 'residential' : body?.designDomain === 'commercial' ? 'commercial' : null,
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
    let wallDims: { width: number; height: number } | null = null, wallPhotoBytes: Uint8Array | null = null, wallPhotoMimeType = 'image/jpeg';
    const sources: { label: string; path: string; bytes: Uint8Array; mimeType: string }[] = [];
    for (const [label, path] of [['Image 1 — the room photograph', input.wallPath], ['Image 2 — the flat print master of the wall covering', input.artworkPath]] as const) {
      const downloaded = await sb.storage.from(BUCKET).download(path);
      if (downloaded.error || !downloaded.data) return response({ error: 'Your ' + (path === input.wallPath ? 'wall photo' : 'design') + ' could not be read.', code: 'UPLOAD_UNREADABLE' }, 400);
      const blob = downloaded.data as Blob;
      if (!imageTypes.includes(blob.type) || blob.size > 20 * 1024 * 1024) return response({ error: 'Images must be JPG, PNG or WebP and no larger than 20 MB.' }, 400);
      sources.push({ label, path, bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type });
    }
    // Oversized is resized, not refused (see fitProviderImages). Under budget
    // this is a no-op and the bytes below are the stored originals.
    const fitted = await fitProviderImages(sources, PROVIDER_BUDGET_BYTES, shrinkForProvider);
    if (fitted.reduce((sum, s) => sum + s.bytes.length, 0) > PROVIDER_BUDGET_BYTES) {
      return response({ error: 'Your wall photo and design are too large to paint together, and could not be resized. Try a JPG photo.', code: 'IMAGES_TOO_LARGE' }, 400);
    }
    for (const source of fitted) {
      // From the FITTED bytes: a proportional resize leaves the aspect alone,
      // so `nearestAspect` is unchanged, and the recomposite resizes the photo
      // to the model's own output size regardless.
      if (source.path === input.wallPath) { wallDims = imageDimensions(source.bytes); wallPhotoBytes = source.bytes; wallPhotoMimeType = source.mimeType; }
      parts.push({ text: source.label }, { inlineData: { mimeType: source.mimeType, data: toBase64(source.bytes) } });
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
