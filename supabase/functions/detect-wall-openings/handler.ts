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
export type WallDetection = { wall: Point[] | null; openings: { label: string; points: Point[] }[]; model: string; notes: string | null };

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
export function normalizeDetection(raw: any): Omit<WallDetection, 'model'> {
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
    let wallPath: string;
    try {
      const body = JSON.parse(await req.text());
      const parts = typeof body?.wallPath === 'string' ? body.wallPath.split('/') : [];
      if (parts.length !== 3 || parts[0] !== owner || parts[1] !== 'uploads' || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(parts[2])) throw new Error('The wall photo is not one of your uploaded files.');
      wallPath = body.wallPath;
    } catch (err) { return response({ error: err instanceof Error ? err.message : 'Invalid request' }, 400); }
    const key = deps.apiKey();
    if (!key) return response({ error: 'Wall detection is not configured.', code: 'NOT_CONFIGURED' }, 503);
    const downloaded = await sb.storage.from(BUCKET).download(wallPath);
    if (downloaded.error || !downloaded.data) return response({ error: 'Your wall photo could not be read. Upload it again.', code: 'UPLOAD_UNREADABLE' }, 400);
    const blob = downloaded.data as Blob;
    if (!imageTypes.includes(blob.type) || blob.size > 20 * 1024 * 1024) return response({ error: 'The wall photo must be JPG, PNG or WebP and no larger than 20 MB.' }, 400);
    try {
      const provider = await deps.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + DETECT_MODEL + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: DETECTION_PROMPT }, { inlineData: { mimeType: blob.type, data: toBase64(new Uint8Array(await blob.arrayBuffer())) } }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: DETECTION_SCHEMA } }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!provider.ok) throw new Error(provider.status === 429 ? 'The detection service is busy. Try again in a moment.' : 'The wall could not be analysed. Mark the corners and openings by hand.');
      const result = await provider.json();
      const text = result?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '';
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { throw new Error('The wall could not be analysed. Mark the corners and openings by hand.'); }
      const detection = normalizeDetection(parsed);
      console.log(JSON.stringify({ event: 'wall_detected', owner, wallPath, model: DETECT_MODEL, corners: !!detection.wall, openings: detection.openings.length }));
      return response({ ...detection, model: DETECT_MODEL });
    } catch (err) {
      const message = err instanceof Error && ['TimeoutError', 'AbortError'].includes(err.name) ? 'The detection service timed out. Mark the corners and openings by hand.' : err instanceof Error ? err.message : 'Wall detection failed.';
      return response({ error: message, code: 'DETECTION_FAILED' }, 502);
    }
  };
}
