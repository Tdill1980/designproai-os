// Detect my wall: from the customer's wall photograph, propose the four
// corners of the wall plane and the regions that must NOT be covered
// (windows, drapes, doors, built-ins, outlets, vents, mounted items,
// occluding furniture). The proposal fills the preview editor's corners and
// exclusion masks for the customer to adjust. It is preview-only: printed
// panels stay full rectangles and the installer trims openings on site.
// No design token is charged; this is a vision question, not a generation.
const BUCKET = 'wallpro-files';
export const DETECT_MODEL = 'gemini-2.5-flash';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];

export type Point = { x: number; y: number };
/** Whether an installer could leave this exactly where it is, or would clear
 * it out of the room before the wrap goes up. `fixed` is protected -- the
 * covering routes around it and the customer's photo shows it unchanged.
 * `movable` is disregarded -- the covering paints straight through it, as if
 * it had already been carried out of the room, exactly the way a customer
 * would actually prep a room for installation. */
export type OcclusionClass = 'fixed' | 'movable';
/** A pixel-accurate mask: a grayscale PNG (data URL) that fills `box`, normalized
 * 0..1 in photo coordinates; values above 127 are protected. */
export type WallMask = { label: string; box: { x0: number; y0: number; x1: number; y1: number }; png: string | null; class: OcclusionClass };
export type WallDetection = { wall: Point[] | null; openings: { label: string; points: Point[] }[]; masks: WallMask[]; model: string; notes: string | null };

// Boxes and coarse polygons around a bed or a window-plus-drapes swallow the
// wall around them (measured 2026-09-11: a six-box answer left the design in
// slivers). Segmentation returns the object's real outline, so the wall beside
// a drape or above a bed keeps the design.
//
// Every object is also classified fixed vs movable (owner, 2026-09-12: "an
// exercise bike parked in front -- remove. Window -- place around it. Use
// common sense."). A window, a mounted TV, built-in shelving or an
// architectural niche cannot be carried out of the room, so the covering must
// route around it and the photo must keep showing it. Freestanding furniture,
// exercise equipment, floor lamps and anything else just sitting in front of
// the wall would be moved before the wrap goes up in real life, so the
// covering paints straight through it instead of preserving it. Ambiguous
// items default to fixed (below): protecting something that should have been
// removed is a cosmetic miss, but erasing something the customer actually
// wanted kept is the wrong side of that error to be on.
export const SEGMENTATION_PROMPT = [
  'Give the segmentation masks for every object on or in front of the largest wall in this photograph that a printed wall covering must not simply paint over unconsidered: windows and glass, curtains, drapes and their rods, doors and door frames, cabinets and shelving units against the wall, mounted televisions, frames and artwork hanging on the wall, outlets, switches, vents, mirrors, architectural niches or mantels that project from the wall, and furniture or equipment standing in front of the wall such as beds, sofas, desks, dressers, chairs and exercise equipment.',
  'Do not include the floor, the ceiling, adjacent walls, or the wall surface itself.',
  'Classify each object as "fixed" -- part of the room\'s architecture or mounted to the wall, which an installer could never move, such as a window, a door, built-in shelving, a mounted TV, a mirror, or a mantel -- or "movable" -- freestanding furniture or equipment sitting in front of the wall that would be carried out of the room before the wrap is installed, such as a chair, a bed, a lamp, or exercise equipment. When genuinely unsure, classify it "fixed".',
  'Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", the text label in the key "label", and the classification in the key "class" (exactly "fixed" or "movable"). Use descriptive labels.',
].join(' ');
const MAX_MASKS = 24, MAX_MASK_BYTES = 2_000_000;

/** Validates the segmentation answer: box_2d is [ymin, xmin, ymax, xmax] on a
 * 0..1000 grid. The mask is a PNG data URL when the model managed one, and
 * NULL when it did not -- see normalizeMasks. A bad BOX is still dropped:
 * without it there is nothing to show and nothing to fill. */
/** The list of masks wherever the model put it: a top-level array, or the one
 * array-valued key of a wrapping object (JSON mode sometimes answers
 * `{ "masks": [...] }` or `{ "segmentation_masks": [...] }`). */
export function maskList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') { for (const v of Object.values(raw as Record<string, unknown>)) if (Array.isArray(v)) return v; }
  return [];
}
/** Why a segmentation answer yielded nothing, for the log. */
export function describeMaskAnswer(raw: unknown): Record<string, unknown> {
  const list = maskList(raw), first = list[0] as any;
  return { type: Array.isArray(raw) ? 'array' : typeof raw, keys: raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw as object).slice(0, 8) : [], items: list.length,
    firstKeys: first && typeof first === 'object' ? Object.keys(first).slice(0, 8) : [], maskPrefix: typeof first?.mask === 'string' ? first.mask.slice(0, 40) : typeof first?.mask, box: first?.box_2d };
}
export function normalizeMasks(raw: unknown): WallMask[] {
  const out: WallMask[] = [];
  for (const item of maskList(raw).slice(0, MAX_MASKS)) {
    const b = (item as any)?.box_2d;
    let png = (item as any)?.mask;
    if (!Array.isArray(b) || b.length !== 4 || !b.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) continue;
    // A bare base64 PNG (no data-URL prefix) is accepted as the same thing.
    if (typeof png === 'string' && !png.startsWith('data:') && /^iVBORw0KGgo/.test(png.trim())) png = 'data:image/png;base64,' + png.trim();
    // AN UNUSABLE MASK NO LONGER DISCARDS THE OBJECT (2026-09-22).
    //
    // This line used to `continue`, throwing away the label, the box and the
    // class along with the mask. So a model that located the window exactly
    // and fumbled only its PNG produced NOTHING -- and the customer, who had
    // asked three times why masking was not working, was told nothing was
    // found. The deployed comment above records how flaky this channel is:
    // "every thinking-on call today answered 0 masks".
    //
    // The box alone is enough to SHOW the object, label it, make it tappable
    // and fill it as a rectangle. It is coarser than an outline and the client
    // says so; it is preview-only either way, so the cost of over-covering the
    // wall beside a drape is preview fidelity, never a print file. Owner,
    // 2026-09-22, with a photograph of exactly this: "It should be doing this."
    const usable = typeof png === 'string' && png.startsWith('data:image/png;base64,') && png.length <= MAX_MASK_BYTES;
    const c = (n: number) => Math.min(1, Math.max(0, n / 1000));
    const box = { y0: c(b[0]), x0: c(b[1]), y1: c(b[2]), x1: c(b[3]) };
    if (box.x1 - box.x0 < 0.005 || box.y1 - box.y0 < 0.005) continue;
    // Anything other than a clean "movable" answer defaults to fixed/protected
    // -- the safer side of the error, per the rule above.
    const cls: OcclusionClass = (item as any)?.class === 'movable' ? 'movable' : 'fixed';
    out.push({ label: String((item as any)?.label || 'protected area').slice(0, 40), box, png: usable ? png : null, class: cls });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * TAP TO MASK: THE SAME QUESTION, POINTED AT ONE OBJECT.
 *
 * Owner, 2026-09-23, with a photo of a room full of gym equipment: "The busy
 * wall marking is impossinle it should be a one touch that coveres the item so
 * that the wrap appears under the phots."
 *
 * She is describing the failure mode of a BULK detector, and it is real:
 * `SEGMENTATION_PROMPT` asks for every object at once, is capped at
 * `MAX_MASKS`, and on a cluttered wall the one thing she actually cares about
 * is the one it left out. Her only recovery was tracing a polygon by hand, on
 * a phone, around an upside-down exercise machine.
 *
 * ⚠️ THIS IS NOT A SECOND SEGMENTER, AND MUST NOT BECOME ONE. It is the same
 * model, the same 0..1000 grid, the same `normalizeMasks` with its box-only
 * recovery, the same auth and the same download — only the QUESTION is scoped
 * to a point. Everything a bulk detection learns, a tap learns too; a separate
 * producer of these masks is what RULE 0.21 forbids by name, and it would have
 * meant two places to fix the next time this channel gets flaky.
 *
 * A TAP IS A POLICY DECISION, SO THE MODEL DOES NOT GET TO MAKE IT. The bulk
 * pass asks for `fixed` / `movable` because nobody has said what they want. A
 * tap has already said it — "cover this, put the wrap behind it" — so the
 * model is asked only for the OUTLINE and the client applies `fixed`. She can
 * still flip it to painted-through with the one-tap control that already
 * exists; what she cannot get is a tap that erases the thing she just pointed
 * at because a classifier disagreed with her.
 * ───────────────────────────────────────────────────────────────────────────*/
export function pointSegmentationPrompt(point: Point): string {
  // Stated twice, in plain language and on the model's own grid. `box_2d` is
  // [ymin, xmin, ymax, xmax] on 0..1000, so a bare pair is ambiguous about
  // order at exactly the moment being unambiguous matters most.
  const gx = Math.round(point.x * 1000), gy = Math.round(point.y * 1000);
  return [
    `The customer has tapped a single point in this photograph: ${Math.round(point.x * 100)}% across from the left edge and ${Math.round(point.y * 100)}% down from the top edge. On the same 0-1000 grid you use for box_2d, that point is y=${gy}, x=${gx}.`,
    'Identify the ONE whole object at that exact point — the object a person would say they were pointing at, complete, including the parts of it that extend away from the point. If the point lands on a piece of exercise equipment, return that whole machine; if it lands on a curtain, return that whole curtain and its rod; if it lands on a sofa, return the whole sofa. Do not return the wall itself, the floor, the ceiling, or a part of an object when the whole object is what was tapped.',
    'Give the segmentation mask for that one object.',
    'Output a JSON list containing exactly one entry, with the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and a short text label in the key "label".',
  ].join(' ');
}

/** WHICH MASK THE TAP ACTUALLY MEANT, AND WHEN TO ADMIT A MISS.
 *
 * The model is asked for one object and usually returns one, but it can return
 * several, or one that is nowhere near the tap. Pasting an outline of the wrong
 * object onto the customer's photo because she tapped her treadmill is worse
 * than telling her to try again — she would then have to find and undo it.
 *
 * So: of the masks whose box contains the tap, the SMALLEST wins. A tap inside
 * a sofa that is inside a room-wide box means the sofa; the enclosing box is
 * the less specific answer by construction. Nothing containing the tap is a
 * MISS and returns null, after one forgiving retry at `PAD` — a box a whisker
 * off the point it was asked about is the model being imprecise, not wrong,
 * and the pad is small enough that it cannot reach a different object.
 */
export const POINT_MATCH_PAD = 0.03;
export function maskAtPoint(masks: WallMask[], point: Point): WallMask | null {
  const area = (m: WallMask) => Math.abs(m.box.x1 - m.box.x0) * Math.abs(m.box.y1 - m.box.y0);
  const hit = (pad: number) => masks
    .filter(m => point.x >= Math.min(m.box.x0, m.box.x1) - pad && point.x <= Math.max(m.box.x0, m.box.x1) + pad
      && point.y >= Math.min(m.box.y0, m.box.y1) - pad && point.y <= Math.max(m.box.y0, m.box.y1) + pad)
    .sort((a, b) => area(a) - area(b))[0] ?? null;
  return hit(0) ?? hit(POINT_MATCH_PAD);
}

export const DETECTION_PROMPT = [
  'This is a photograph of an interior wall that will receive a printed wall covering. Answer with JSON only.',
  '"wall": the four corners of the largest flat wall surface the covering will be installed on, as normalized image coordinates from 0 to 1 (x to the right, y downward), in the order top-left, top-right, bottom-right, bottom-left, following the perspective of the wall plane. Corners may be hidden behind furniture or drapes: estimate where the wall plane meets the ceiling, the floor and the adjacent walls. If the photograph clearly shows no single wall plane, set "wall" to null.',
  '"openings": every region ON that wall that must not be covered: windows and glass, curtains, drapes and their rods, doors and door frames, built-in cabinets and shelving fixed to the wall, outlets, switches, vents, thermostats, mounted televisions, frames and artwork hanging on the wall, and furniture that stands in front of the wall and hides it. Each opening is a polygon of 4 to 12 normalized points, tight to the object, with a short label. Do not include the floor, the ceiling or adjacent walls. Return an empty list when nothing needs protecting.',
  '"notes": one short sentence for the customer about anything uncertain, or null.',
].join('\n');

export const DETECTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    wall: { type: 'ARRAY', nullable: true, items: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } }, required: ['x', 'y'] } },
    openings: { type: 'ARRAY', items: { type: 'OBJECT', properties: { label: { type: 'STRING' }, points: { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } }, required: ['x', 'y'] } } }, required: ['label', 'points'] } },
    notes: { type: 'STRING', nullable: true },
  },
  required: ['wall', 'openings'],
};

const clamp = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
function polygon(raw: unknown, min: number, max: number): Point[] | null {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) return null;
  const points: Point[] = [];
  for (const p of raw) { const x = clamp(p?.x), y = clamp(p?.y); if (x === null || y === null) return null; points.push({ x, y }); }
  return points;
}
/** Same predicate the page uses for wall corners (wallpro-geometry): convex,
 * clockwise from top-left in image coordinates, with a real area. */
export function validWallCorners(points: Point[]): boolean {
  if (points.length !== 4) return false;
  const cross = points.map((p, i) => { const q = points[(i + 1) % 4], r = points[(i + 2) % 4]; return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x); });
  const area = Math.abs(points.reduce((a, p, i) => a + p.x * points[(i + 1) % 4].y - p.y * points[(i + 1) % 4].x, 0)) / 2;
  return cross.every(n => n > 1e-6) && area >= 0.0025;
}
function polygonArea(points: Point[]): number {
  return Math.abs(points.reduce((a, p, i) => a + p.x * points[(i + 1) % points.length].y - p.y * points[(i + 1) % points.length].x, 0)) / 2;
}

/** Validates and normalizes the model's answer. Anything malformed is dropped
 * rather than trusted: a bad corner set becomes null, a bad polygon is skipped. */
export function normalizeDetection(raw: any): Omit<WallDetection, 'model' | 'masks'> {
  const wall = polygon(raw?.wall, 4, 4);
  const openings: WallDetection['openings'] = [];
  for (const item of Array.isArray(raw?.openings) ? raw.openings.slice(0, 24) : []) {
    const points = polygon(item?.points, 3, 12);
    if (!points || polygonArea(points) < 0.0004) continue;
    openings.push({ label: String(item?.label || 'protected area').slice(0, 40), points });
  }
  return { wall: wall && validWallCorners(wall) ? wall : null, openings, notes: typeof raw?.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 240) : null };
}

const toBase64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };

export function createDetectHandler(deps: { createClient: (...args: any[]) => any; supabaseUrl: string; serviceKey: string; apiKey: () => string; fetch: typeof fetch }) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
    const sb = deps.createClient(deps.supabaseUrl, deps.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const { data: auth, error: authError } = jwt ? await sb.auth.getUser(jwt).catch(() => ({ data: null, error: true })) : { data: null, error: true };
    if (authError || !auth?.user?.id) return response({ error: 'Sign in to detect your wall.', code: 'AUTH_REQUIRED' }, 401);
    const owner = auth.user.id;
    let wallPath: string, tap: Point | null = null;
    try {
      const body = JSON.parse(await req.text());
      const parts = typeof body?.wallPath === 'string' ? body.wallPath.split('/') : [];
      if (parts.length !== 3 || parts[0] !== owner || parts[1] !== 'uploads' || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(parts[2])) throw new Error('The wall photo is not one of your uploaded files.');
      wallPath = body.wallPath;
      // Optional. Present = tap-to-mask (one object at this point); absent =
      // the bulk pass, byte-for-byte the request this function always took.
      if (body?.point != null) {
        const x = clamp(body.point?.x), y = clamp(body.point?.y);
        if (x === null || y === null) throw new Error('That tap could not be read. Try again.');
        tap = { x, y };
      }
    } catch (err) { return response({ error: err instanceof Error ? err.message : 'Invalid request' }, 400); }
    const key = deps.apiKey();
    if (!key) return response({ error: 'Wall detection is not configured.', code: 'NOT_CONFIGURED' }, 503);
    const downloaded = await sb.storage.from(BUCKET).download(wallPath);
    if (downloaded.error || !downloaded.data) return response({ error: 'Your wall photo could not be read. Upload it again.', code: 'UPLOAD_UNREADABLE' }, 400);
    const blob = downloaded.data as Blob;
    if (!imageTypes.includes(blob.type) || blob.size > 20 * 1024 * 1024) return response({ error: 'The wall photo must be JPG, PNG or WebP and no larger than 20 MB.' }, 400);
    try {
      const image = { inlineData: { mimeType: blob.type, data: toBase64(new Uint8Array(await blob.arrayBuffer())) } };
      const ask = (text: string, schema?: unknown, extra: Record<string, unknown> = {}) => deps.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + DETECT_MODEL + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }, image] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}), ...extra } }),
        signal: AbortSignal.timeout(60_000),
      });
      // Segmentation is asked without thinking: Google's own guidance for
      // 2.5 mask output, and every thinking-on call today answered 0 masks.
      const segmentationConfig = { thinkingConfig: { thinkingBudget: 0 } };
      const parseText = async (provider: Response) => {
        const result = await provider.json();
        const text = result?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '';
        return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      };
      // A TAP ASKS ONE QUESTION AND RETURNS ONE OBJECT. The corner pass is not
      // run: she is not re-detecting her wall, she is pointing at a treadmill,
      // and re-answering `wall` here would overwrite corners she has already
      // dragged into place. `wall: null` / `openings: []` say so explicitly
      // rather than leaving the client to guess from an absence.
      if (tap) {
        const provider = await ask(pointSegmentationPrompt(tap), undefined, segmentationConfig);
        if (!provider.ok) throw new Error(provider.status === 429 ? 'The detection service is busy. Try again in a moment.' : 'That item could not be outlined. Try tapping its middle, or draw it by hand.');
        let picked: WallMask | null = null, answer: unknown = null;
        try { answer = await parseText(provider); picked = maskAtPoint(normalizeMasks(answer), tap); }
        catch (err) { console.warn(JSON.stringify({ event: 'wall_tap_unreadable', owner, wallPath, error: String(err) })); }
        if (!picked) {
          // A MISS IS REPORTED, NEVER PAPERED OVER. Returning the nearest
          // outline would paste the wrong object onto her photo, and she would
          // then have to find and undo it — worse than being asked to tap again.
          console.warn(JSON.stringify({ event: 'wall_tap_missed', owner, wallPath, point: tap, answer: describeMaskAnswer(answer) }));
          return response({ wall: null, openings: [], masks: [], model: DETECT_MODEL, notes: 'Nothing was found at that spot. Tap the middle of the item, or draw it by hand.' });
        }
        console.log(JSON.stringify({ event: 'wall_tap_masked', owner, wallPath, point: tap, label: picked.label, outlined: !!picked.png }));
        // `class: fixed` because SHE decided by tapping — see the block above
        // pointSegmentationPrompt. The one-tap toggle can still flip it.
        return response({ wall: null, openings: [], masks: [{ ...picked, class: 'fixed' as OcclusionClass }], model: DETECT_MODEL, notes: null });
      }
      // Corners and segmentation are independent questions, asked in parallel.
      // Segmentation is the better answer for protected areas; the polygon list
      // is kept only as the fallback when that call cannot be used.
      const [provider, segmentation] = await Promise.all([ask(DETECTION_PROMPT, DETECTION_SCHEMA), ask(SEGMENTATION_PROMPT, undefined, segmentationConfig).catch(() => null)]);
      if (!provider.ok) throw new Error(provider.status === 429 ? 'The detection service is busy. Try again in a moment.' : 'The wall could not be analysed. Mark the corners and openings by hand.');
      let parsed: any;
      try { parsed = await parseText(provider); } catch { throw new Error('The wall could not be analysed. Mark the corners and openings by hand.'); }
      let masks: WallMask[] = [];
      if (segmentation?.ok) {
        try {
          const answer = await parseText(segmentation);
          masks = normalizeMasks(answer);
          // An empty answer is the thing to diagnose: say what shape came back.
          if (!masks.length) console.warn(JSON.stringify({ event: 'wall_segmentation_empty', owner, wallPath, answer: describeMaskAnswer(answer) }));
          // And how many survived on their BOX alone, which is the difference
          // between "the model found nothing" and "the model found it and the
          // mask channel failed". Those need different fixes and used to look
          // identical from here.
          else { const boxOnly = masks.filter(m => !m.png).length; if (boxOnly) console.warn(JSON.stringify({ event: 'wall_segmentation_box_only', owner, wallPath, boxOnly, total: masks.length })); }
        } catch (err) { console.warn(JSON.stringify({ event: 'wall_segmentation_unreadable', owner, wallPath, error: String(err) })); }
      }
      else if (segmentation) console.warn(JSON.stringify({ event: 'wall_segmentation_failed', owner, wallPath, status: segmentation.status }));
      const detection = normalizeDetection(parsed);
      console.log(JSON.stringify({ event: 'wall_detected', owner, wallPath, model: DETECT_MODEL, corners: !!detection.wall, openings: detection.openings.length, masks: masks.length, outlined: masks.filter(m => !!m.png).length }));
      return response({ ...detection, masks, model: DETECT_MODEL });
    } catch (err) {
      const message = err instanceof Error && ['TimeoutError', 'AbortError'].includes(err.name) ? 'The detection service timed out. Mark the corners and openings by hand.' : err instanceof Error ? err.message : 'Wall detection failed.';
      return response({ error: message, code: 'DETECTION_FAILED' }, 502);
    }
  };
}
