import { describe, expect, it, vi } from 'vitest';
import { createDetectHandler, describeMaskAnswer, normalizeDetection, normalizeMasks, DETECT_MODEL, DETECTION_PROMPT, SEGMENTATION_PROMPT, maskAtPoint, pointSegmentationPrompt, POINT_MATCH_PAD } from '../../../../supabase/functions/detect-wall-openings/handler';
import { validWallCorners } from '../wallpro-geometry';

const owner = '11111111-1111-4111-8111-111111111111';
const wallPath = owner + '/uploads/33333333-3333-4333-8333-333333333333.jpg';
const good = { wall: [{ x: 0.05, y: 0.12 }, { x: 0.96, y: 0.15 }, { x: 0.97, y: 0.9 }, { x: 0.04, y: 0.88 }], openings: [
  { label: 'window', points: [{ x: 0.4, y: 0.25 }, { x: 0.6, y: 0.25 }, { x: 0.6, y: 0.7 }, { x: 0.4, y: 0.7 }] },
  { label: 'drapes', points: [{ x: 0.3, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.4, y: 0.85 }, { x: 0.3, y: 0.85 }] },
], notes: 'The right drape hides the wall edge.' };

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAWk1v8QAAAABJRU5ErkJggg==';
const segmentation = [
  { box_2d: [250, 400, 700, 600], mask: png, label: 'window with drapes' },
  { box_2d: [600, 0, 1000, 1000], mask: png, label: 'bed' },
  { box_2d: [10, 10, 12, 12], mask: png, label: 'speck' },
  { box_2d: [100, 100, 300, 300], mask: 'not a data url', label: 'bad' },
];
function fixture(options: { auth?: boolean; answer?: unknown; segmentation?: unknown; status?: number; unreadable?: boolean } = {}) {
  const storage = { download: vi.fn(async () => options.unreadable ? { error: { message: 'denied' } } : { data: new Blob(['photo'], { type: 'image/jpeg' }) }) };
  const sb = { auth: { getUser: vi.fn(async () => options.auth === false ? { error: true } : { data: { user: { id: owner } } }) }, storage: { from: vi.fn(() => storage) } };
  const calls: any[] = [];
  const provider = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body); calls.push(body);
    // Anything that is not the CORNER question is a segmentation question --
    // the bulk prompt or a tap's scoped one. Keyed on SEGMENTATION_PROMPT, a
    // tap fell through to the corner answer and the handler read `good.wall`
    // as a mask list, which is a fixture lying about the shape of the reply.
    if (body.contents[0].parts[0].text !== DETECTION_PROMPT) return Response.json({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(options.segmentation ?? segmentation) + '\n```' }] } }] });
    return options.status ? new Response('{}', { status: options.status }) : Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(options.answer ?? good) }] } }] });
  });
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
  it('asks the vision model with the photo, at temperature 0, for corners on the fixed schema and segmentation masks in parallel, and charges nothing', async () => {
    const f = fixture(); const result = await f.invoke();
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({ model: DETECT_MODEL, openings: [{ label: 'window' }, { label: 'drapes' }] });
    // THIS ASSERTION USED TO ENCODE THE DEFECT (2026-09-22). It read "the
    // speck and the malformed entry are dropped" and pinned exactly two
    // survivors -- so an object the model LOCATED and then failed to outline
    // was thrown away, box and label with it, and the customer who asked three
    // times why masking was not working saw nothing at all.
    //
    // A bad BOX is still dropped: the speck is below the size floor and there
    // is nothing to show. A bad MASK keeps its box, flagged `png: null`, and
    // the client fills it as a rectangle. Boxes are normalized from 0..1000.
    expect(body.masks.map((m: any) => m.label)).toEqual(['window with drapes', 'bed', 'bad']);
    expect(body.masks[0].box).toEqual({ y0: 0.25, x0: 0.4, y1: 0.7, x1: 0.6 }); expect(body.masks[0].png).toBe(png);
    expect(body.masks[2].png).toBeNull();
    expect(body.masks[2].box).toEqual({ y0: 0.1, x0: 0.1, y1: 0.3, x1: 0.3 });
    // An oversized mask is the same case: too big to send, the box still counts.
    expect(normalizeMasks([{ box_2d: [0, 0, 500, 500], mask: 'data:image/png;base64,' + 'A'.repeat(2_000_001), label: 'huge' }]))
      .toEqual([{ label: 'huge', box: { y0: 0, x0: 0, y1: 0.5, x1: 0.5 }, png: null, class: 'fixed' }]);
    // ...and a box that is missing or malformed still drops the whole item,
    // because a rectangle is the fallback and there is no rectangle.
    expect(normalizeMasks([{ mask: png, label: 'no box' }, { box_2d: [1, 2, 3], mask: png, label: 'short box' }])).toEqual([]);
    // Unclassified items default to fixed/protected -- the safer side of the error.
    expect(body.masks.map((m: any) => m.class)).toEqual(['fixed', 'fixed', 'fixed']);
    expect(f.calls).toHaveLength(2);
    const request = f.calls[0];
    expect(request.generationConfig).toMatchObject({ temperature: 0, responseMimeType: 'application/json' });
    expect(request.contents[0].parts[0].text).toBe(DETECTION_PROMPT);
    expect(request.contents[0].parts[1].inlineData.mimeType).toBe('image/jpeg');
    expect(f.calls[1].contents[0].parts[0].text).toBe(SEGMENTATION_PROMPT); expect(f.calls[1].generationConfig.responseSchema).toBeUndefined();
    expect(SEGMENTATION_PROMPT).toMatch(/beds, sofas/); expect(SEGMENTATION_PROMPT).toMatch(/"box_2d"/);
    expect(DETECTION_PROMPT).toMatch(/drapes/); expect(DETECTION_PROMPT).toMatch(/top-left, top-right, bottom-right, bottom-left/);
    expect(normalizeMasks('garbage')).toEqual([]);
    // Segmentation is asked without thinking (every thinking-on call on 2026-09-11 answered 0 masks).
    expect(f.calls[1].generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    // JSON mode sometimes wraps the list in an object or drops the data-URL prefix; both still count.
    const bare = png.replace('data:image/png;base64,', '');
    expect(normalizeMasks({ segmentation_masks: [{ box_2d: [250, 400, 700, 600], mask: bare, label: 'window' }] })).toMatchObject([{ label: 'window', png, box: { y0: 0.25, x0: 0.4, y1: 0.7, x1: 0.6 } }]);
    expect(describeMaskAnswer({ masks: [{ box_2d: [1, 2, 3, 4], mask: 'x' }] })).toMatchObject({ type: 'object', keys: ['masks'], items: 1, firstKeys: ['box_2d', 'mask'], maskPrefix: 'x' });
  });
  it('classifies each object fixed vs movable, common-sense examples in the prompt, and defaults an unrecognised or missing class to fixed', async () => {
    expect(SEGMENTATION_PROMPT).toMatch(/"fixed"/); expect(SEGMENTATION_PROMPT).toMatch(/"movable"/);
    expect(SEGMENTATION_PROMPT).toMatch(/exercise equipment/); expect(SEGMENTATION_PROMPT).toMatch(/mounted TV|window/);
    expect(SEGMENTATION_PROMPT).toMatch(/unsure, classify it "fixed"/);
    const mixed = [
      { box_2d: [100, 100, 300, 300], mask: png, label: 'window', class: 'fixed' },
      { box_2d: [400, 400, 600, 600], mask: png, label: 'exercise bike', class: 'movable' },
      { box_2d: [700, 700, 900, 900], mask: png, label: 'lamp', class: 'unrecognised-value' },
      { box_2d: [50, 50, 150, 150], mask: png, label: 'mirror' }, // no class field at all
    ];
    const f = fixture({ segmentation: mixed }); const result = await f.invoke();
    const body = await result.json();
    expect(body.masks.map((m: any) => ({ label: m.label, class: m.class }))).toEqual([
      { label: 'window', class: 'fixed' },
      { label: 'exercise bike', class: 'movable' },
      { label: 'lamp', class: 'fixed' },
      { label: 'mirror', class: 'fixed' },
    ]);
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

/* ─────────────────────────────────────────────────────────────────────────────
 * TAP TO MASK (owner, 2026-09-23: "The busy wall marking is impossinle it
 * should be a one touch that coveres the item so that the wrap appears under
 * the phots").
 *
 * The bulk pass asks for everything at once, is capped at MAX_MASKS, and on a
 * wall full of gym equipment the object she cares about is the one it left
 * out. Her only recovery was tracing a polygon by hand, on a phone.
 *
 * These cases pin the three decisions that make a tap trustworthy rather than
 * merely present: it asks the SAME segmenter (not a second producer), it
 * refuses to guess when it misses, and the customer's tap — not the model —
 * decides whether the item is protected.
 * ───────────────────────────────────────────────────────────────────────────*/
describe('one touch masks one item', () => {
  const at = (x0: number, y0: number, x1: number, y1: number, label = 'item') =>
    ({ label, box: { x0, y0, x1, y1 }, png, class: 'fixed' as const });

  it('takes the SMALLEST box containing the tap, because the enclosing one is the less specific answer', () => {
    // A tap inside a sofa that is inside a room-wide box means the sofa.
    const room = at(0, 0, 1, 1, 'room'), sofa = at(0.3, 0.5, 0.6, 0.8, 'sofa');
    expect(maskAtPoint([room, sofa], { x: 0.45, y: 0.65 })?.label).toBe('sofa');
    expect(maskAtPoint([sofa, room], { x: 0.45, y: 0.65 })?.label).toBe('sofa');
    // Outside the sofa, the room box is the only answer there is.
    expect(maskAtPoint([room, sofa], { x: 0.05, y: 0.05 })?.label).toBe('room');
  });

  it('admits a miss instead of returning the nearest object', () => {
    // Pasting the wrong outline onto her photo is worse than asking again:
    // she would then have to find and undo it.
    expect(maskAtPoint([at(0.6, 0.6, 0.9, 0.9)], { x: 0.1, y: 0.1 })).toBeNull();
    expect(maskAtPoint([], { x: 0.5, y: 0.5 })).toBeNull();
  });

  it('forgives a box a whisker off the point, by a pad too small to reach another object', () => {
    const near = { x: 0.6 - POINT_MATCH_PAD / 2, y: 0.7 };
    expect(maskAtPoint([at(0.6, 0.6, 0.9, 0.9)], near)).not.toBeNull();
    // ...and not one that is simply elsewhere.
    expect(maskAtPoint([at(0.6, 0.6, 0.9, 0.9)], { x: 0.6 - POINT_MATCH_PAD * 3, y: 0.7 })).toBeNull();
    expect(POINT_MATCH_PAD).toBeLessThan(0.05);
  });

  it('names the tapped point in plain language AND on the model\'s own grid', () => {
    // box_2d is [ymin, xmin, ymax, xmax] on 0..1000, so a bare pair is
    // ambiguous about order at exactly the moment being unambiguous matters.
    const text = pointSegmentationPrompt({ x: 0.25, y: 0.8 });
    expect(text).toContain('25% across from the left');
    expect(text).toContain('80% down from the top');
    expect(text).toContain('y=800, x=250');
    expect(text).toContain('the ONE whole object at that exact point');
  });

  it('does not ask the model to classify a tapped item, because the tap already decided', () => {
    // The bulk prompt asks fixed/movable because nobody has said what they
    // want. A tap has said it. A tap that erased the thing she pointed at
    // because a classifier disagreed would be the worst possible answer.
    const text = pointSegmentationPrompt({ x: 0.5, y: 0.5 });
    expect(text).not.toContain('movable');
    expect(SEGMENTATION_PROMPT).toContain('movable');
  });

  it('asks ONE scoped question, skips the corner pass, and protects what was tapped', async () => {
    const f = fixture({ segmentation: [{ box_2d: [500, 300, 800, 600], mask: png, label: 'treadmill', class: 'movable' }] });
    const result = await f.invoke({ wallPath, point: { x: 0.45, y: 0.65 } });
    expect(result.status).toBe(200);
    const body = await result.json();
    // ONE provider call: the corner question is not re-asked, or a tap would
    // overwrite corners she has already dragged into place.
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].contents[0].parts[0].text).toContain('y=650, x=450');
    expect(body.wall).toBeNull();
    expect(body.openings).toEqual([]);
    expect(body.masks).toHaveLength(1);
    expect(body.masks[0].label).toBe('treadmill');
    // The model said "movable". She tapped it to COVER it, so it is protected
    // and she can still flip it with the one-tap toggle.
    expect(body.masks[0].class).toBe('fixed');
  });

  it('reports a miss with somewhere to go, rather than a wrong outline or an error', async () => {
    const f = fixture({ segmentation: [{ box_2d: [0, 0, 100, 100], mask: png, label: 'ceiling corner' }] });
    const body = await (await f.invoke({ wallPath, point: { x: 0.9, y: 0.9 } })).json();
    expect(body.masks).toEqual([]);
    expect(body.notes).toMatch(/tap the middle|draw it by hand/i);
  });

  it('leaves the bulk request byte-for-byte what it always was', async () => {
    const f = fixture();
    await f.invoke({ wallPath });
    // Both questions, exactly as before: corners and the capped segmentation.
    expect(f.calls).toHaveLength(2);
    expect(f.calls.some((c: any) => c.contents[0].parts[0].text === DETECTION_PROMPT)).toBe(true);
    expect(f.calls.some((c: any) => c.contents[0].parts[0].text === SEGMENTATION_PROMPT)).toBe(true);
  });

  it('refuses a tap that is not a readable point', async () => {
    const f = fixture();
    expect((await f.invoke({ wallPath, point: { x: 'left', y: 0.5 } })).status).toBe(400);
    expect((await f.invoke({ wallPath, point: {} })).status).toBe(400);
  });
});
