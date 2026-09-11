import { describe, expect, it, vi } from 'vitest';
import { createDetectHandler, normalizeDetection, DETECT_MODEL, DETECTION_PROMPT } from '../../../../supabase/functions/detect-wall-openings/handler';
import { validWallCorners } from '../wallpro-geometry';

const owner = '11111111-1111-4111-8111-111111111111';
const wallPath = owner + '/uploads/33333333-3333-4333-8333-333333333333.jpg';
const good = { wall: [{ x: 0.05, y: 0.12 }, { x: 0.96, y: 0.15 }, { x: 0.97, y: 0.9 }, { x: 0.04, y: 0.88 }], openings: [
  { label: 'window', points: [{ x: 0.4, y: 0.25 }, { x: 0.6, y: 0.25 }, { x: 0.6, y: 0.7 }, { x: 0.4, y: 0.7 }] },
  { label: 'drapes', points: [{ x: 0.3, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.4, y: 0.85 }, { x: 0.3, y: 0.85 }] },
], notes: 'The right drape hides the wall edge.' };

function fixture(options: { auth?: boolean; answer?: unknown; status?: number; unreadable?: boolean } = {}) {
  const storage = { download: vi.fn(async () => options.unreadable ? { error: { message: 'denied' } } : { data: new Blob(['photo'], { type: 'image/jpeg' }) }) };
  const sb = { auth: { getUser: vi.fn(async () => options.auth === false ? { error: true } : { data: { user: { id: owner } } }) }, storage: { from: vi.fn(() => storage) } };
  const calls: any[] = [];
  const provider = vi.fn(async (_url: any, init: any) => { calls.push(JSON.parse(init.body)); return options.status ? new Response('{}', { status: options.status }) : Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(options.answer ?? good) }] } }] }); });
  const handler = createDetectHandler({ createClient: () => sb, supabaseUrl: 'https://own.supabase.co', serviceKey: 'k', apiKey: () => 'provider-test-key', fetch: provider as any });
  const invoke = (body: any = { wallPath }) => handler(new Request('https://own.supabase.co/functions/v1/detect-wall-openings', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body) }));
  return { invoke, calls, provider, storage };
}

describe('Detect my wall', () => {
  it('normalizes a good answer and agrees with the page on what a valid wall is', () => {
    const d = normalizeDetection(good);
    expect(d.wall).toHaveLength(4); expect(validWallCorners(d.wall!)).toBe(true);
    expect(d.openings.map(o => o.label)).toEqual(['window', 'drapes']);
    expect(d.notes).toBe('The right drape hides the wall edge.');
  });
  it('drops what it cannot trust: crossed corners, tiny or malformed polygons, out-of-range values', () => {
    const crossed = normalizeDetection({ ...good, wall: [good.wall[0], good.wall[2], good.wall[1], good.wall[3]] });
    expect(crossed.wall).toBeNull(); expect(crossed.openings).toHaveLength(2);
    const messy = normalizeDetection({ wall: null, openings: [
      { label: 'speck', points: [{ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.5 }, { x: 0.501, y: 0.501 }] },
      { label: 'bad', points: [{ x: 'a', y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.4 }] },
      { label: 'two points', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
      { label: 'outlet', points: [{ x: 1.4, y: -0.2 }, { x: 0.9, y: 0.6 }, { x: 0.95, y: 0.7 }, { x: 0.85, y: 0.72 }] },
    ], notes: 42 });
    expect(messy.wall).toBeNull();
    expect(messy.openings.map(o => o.label)).toEqual(['outlet']);
    expect(messy.openings[0].points[0]).toEqual({ x: 1, y: 0 });
    expect(messy.notes).toBeNull();
    expect(normalizeDetection(null)).toEqual({ wall: null, openings: [], notes: null });
  });
  it('asks the vision model with the photo, at temperature 0, for JSON on the fixed schema, and charges nothing', async () => {
    const f = fixture(); const result = await f.invoke();
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ model: DETECT_MODEL, openings: [{ label: 'window' }, { label: 'drapes' }] });
    const request = f.calls[0];
    expect(request.generationConfig).toMatchObject({ temperature: 0, responseMimeType: 'application/json' });
    expect(request.contents[0].parts[0].text).toBe(DETECTION_PROMPT);
    expect(request.contents[0].parts[1].inlineData.mimeType).toBe('image/jpeg');
    expect(DETECTION_PROMPT).toMatch(/drapes/); expect(DETECTION_PROMPT).toMatch(/top-left, top-right, bottom-right, bottom-left/);
  });
  it('refuses other owners\' files, unsigned callers and unreadable photos before calling the model', async () => {
    expect((await fixture({ auth: false }).invoke()).status).toBe(401);
    const other = fixture(); expect((await other.invoke({ wallPath: '99999999-9999-4999-8999-999999999999/uploads/33333333-3333-4333-8333-333333333333.jpg' })).status).toBe(400); expect(other.provider).not.toHaveBeenCalled();
    const gen = fixture(); expect((await gen.invoke({ wallPath: owner + '/generated/33333333-3333-4333-8333-333333333333.png' })).status).toBe(400);
    const unreadable = fixture({ unreadable: true }); expect((await unreadable.invoke()).status).toBe(400); expect(unreadable.provider).not.toHaveBeenCalled();
  });
  it('fails soft with a hand-marking instruction when the model cannot answer', async () => {
    const busy = fixture({ status: 429 }); const r1 = await busy.invoke(); expect(r1.status).toBe(502); expect((await r1.json()).error).toMatch(/busy/);
    const garbage = fixture({ answer: 'not json' }); const r2 = await garbage.invoke(); expect(r2.status).toBe(200); expect(await r2.json()).toMatchObject({ wall: null, openings: [] });
  });
});
