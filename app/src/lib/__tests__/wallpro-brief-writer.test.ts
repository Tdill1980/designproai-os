import { describe, expect, it, vi } from 'vitest';
import { createBriefWriterHandler, briefWriterPrompt, parseBriefRequest, normalizeGeneratedBriefs, BRIEF_WRITER_MODEL, MAX_COUNT } from '../../../../supabase/functions/generate-wall-batch-prompts/handler';
import { generatedBriefAsEntry } from '@/data/wallpro-presets';
import { briefForEntry } from '../wallpro-catalog';

const owner = '11111111-1111-4111-8111-111111111111';
const DESIGN_ID = /^WPB-[0-9A-Z][0-9A-Z-]{3,19}$/;
const good = [
  { name: 'Indigo Fern', subcategory: 'bedroom', style: 'Organic Modern', prompt: 'Hand-cut block print of fern fronds in one deep indigo on an unbleached linen ground, tossed half-drop repeat with fronds about ten inches tall, calm and hand-made, bedroom wallpaper', tags: ['fern', 'indigo', 'block print'], mode: 'repeat', rendering: 'flat-bold' },
  { name: 'Hummingbird Toile', subcategory: 'guest room', style: 'Grandmillennial', prompt: 'Toile of hummingbirds at honeysuckle in engraved hatched line, one sepia ink on warm cream, scattered straight repeat with each bird about five inches, quiet and classic', tags: ['toile', 'birds'], mode: 'repeat', rendering: 'fine-line' },
  { name: 'Spec Sheet', subcategory: 'bedroom', prompt: 'Generate a 4K master with 150 PPI panels and a 1-inch overlap, stunning botanical wallpaper for a bedroom with a seamless tile', tags: [], mode: 'repeat', rendering: 'flat-bold' },
  { name: 'Too short', subcategory: 'bedroom', prompt: 'Blue flowers.', tags: [], mode: 'repeat', rendering: 'flat-bold' },
  { name: 'Marketing', subcategory: 'bedroom', prompt: 'A breathtaking mural of mountains at dawn in soft blues and rose, one continuous scene across the wall with the eye resting on the far peak', tags: [], mode: 'mural', rendering: 'painted-mural' },
  { name: 'Walnut Herringbone', subcategory: 'living room', prompt: 'Photoreal herringbone of narrow walnut planks about three inches wide, honey to deep chocolate grain, straight-on with no perspective and no hot spots, warm living-room accent wall', tags: ['wood'], mode: 'repeat', rendering: 'faux-material' },
];

function fixture(options: { auth?: boolean; curator?: boolean; answer?: unknown; status?: number; text?: string; key?: string } = {}) {
  const roles = { select: vi.fn(() => roles), eq: vi.fn(() => roles), in: vi.fn(async () => ({ data: options.curator === false ? [] : [{ role: 'admin' }], error: null })) };
  const sb = { auth: { getUser: vi.fn(async () => options.auth === false ? { error: true } : { data: { user: { id: owner } } }) }, from: vi.fn(() => roles) };
  const calls: any[] = [];
  const provider = vi.fn(async (_url: any, init: any) => {
    calls.push({ url: String(_url), body: JSON.parse(init.body) });
    if (options.status) return new Response('{}', { status: options.status });
    return Response.json({ candidates: [{ content: { parts: [{ text: options.text ?? JSON.stringify(options.answer ?? good) }] } }] });
  });
  const handler = createBriefWriterHandler({ createClient: () => sb, supabaseUrl: 'https://own.supabase.co', serviceKey: 'k', apiKey: () => options.key ?? 'provider-test-key', fetch: provider as any });
  const invoke = (body: any = { domain: 'residential', count: 5 }, headers: Record<string, string> = { authorization: 'Bearer t' }) => handler(new Request('https://own.supabase.co/functions/v1/generate-wall-batch-prompts', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { invoke, calls, provider, sb, roles };
}

describe('WallPro batch brief writer (RestylePro generate-batch-prompts, wall edition)', () => {
  it('parses the request with the same bounds RestylePro used, and refuses an unknown domain', () => {
    expect(parseBriefRequest({ domain: 'residential', count: 7, space: ' nursery ', rendering: 'fine-line', mode: 'repeat' })).toEqual({ domain: 'residential', count: 7, space: 'nursery', rendering: 'fine-line', mode: 'repeat' });
    expect(parseBriefRequest({ domain: 'commercial' })).toEqual({ domain: 'commercial', count: 5, space: null, rendering: 'any', mode: 'any' });
    expect(parseBriefRequest({ domain: 'commercial', count: 99 }).count).toBe(MAX_COUNT);
    // RestylePro's `parseInt(rawCount) || 5`: a missing or zero count is the default five; a negative one clamps to one.
    expect(parseBriefRequest({ domain: 'commercial', count: 0, rendering: 'oil', mode: 'both' })).toMatchObject({ count: 5, rendering: 'any', mode: 'any' });
    expect(parseBriefRequest({ domain: 'commercial', count: -3 }).count).toBe(1);
    expect(() => parseBriefRequest({ domain: 'vehicle' })).toThrow('domain');
  });
  it('writes as a studio creative director: one subject, named ground colour, technique, repeat structure and inches, room and feeling — no marketing, no production words', () => {
    const p = briefWriterPrompt(parseBriefRequest({ domain: 'residential', count: 10 }));
    expect(p).toMatch(/creative director of a wallpaper and mural studio/);
    expect(p).toMatch(/Write exactly 10 briefs/);
    expect(p).toMatch(/ONE clear subject/);
    expect(p).toMatch(/ground colour named/);
    expect(p).toMatch(/block print, linocut, screen print, engraved hatched toile line/);
    expect(p).toMatch(/half-drop, straight, ogee, trellis, tossed, stripe/);
    expect(p).toMatch(/size in inches/);
    expect(p).toMatch(/Never use marketing adjectives/);
    expect(p).toMatch(/Never mention print production \(4K, PPI, panels, seams, bleed, overlap/);
    expect(p).toMatch(/Never name a living artist or a trademarked pattern/);
    expect(p).toMatch(/different subject, a different ground colour, a different technique/);
    expect(p).toMatch(/nursery, kids' room, living room/);
    expect(p).toMatch(/Rotate the rendering families/);
    // Marketplace signals as taxonomy input (owner, 2026-09-14): styles and palette families rotate across the set; the style never replaces the subject.
    expect(p).toMatch(/Rotate the set across current interior styles — Boho, Contemporary Boho, Organic Modern, Japandi, Scandinavian, Soft Minimalism, Quiet Luxury/);
    expect(p).toMatch(/Vintage Botanical/); expect(p).toMatch(/Wabi-Sabi/); expect(p).toMatch(/Nursery Editorial/);
    expect(p).toMatch(/warm beige, taupe and ivory; sage, olive and deep green; terracotta, blush and earth tones/);
    expect(p).toMatch(/it never replaces the subject/);
    expect(p).toMatch(/"style": "the interior style named in the brief, or the business type"/);
    expect(p).toMatch(/Return ONLY a JSON array/);
    expect(p.length).toBeLessThan(4000);
  });
  it('scopes to a business space, a rendering family and a mode when asked', () => {
    const p = briefWriterPrompt(parseBriefRequest({ domain: 'commercial', count: 6, space: 'dental office', rendering: 'flat-bold', mode: 'repeat' }));
    expect(p).toMatch(/a business — every brief is for a dental office/);
    expect(p).toMatch(/Every brief is flat bold print/);
    expect(p).toMatch(/Every brief is a repeating wallpaper pattern/);
    const c = briefWriterPrompt(parseBriefRequest({ domain: 'commercial', count: 6 }));
    expect(c).toMatch(/working commercial interior designer specifies a feature wall/);
    expect(c).toMatch(/Rotate the set across commercial disciplines — restaurant or bar dining room; corporate reception or culture wall; apartment leasing office or clubhouse; church or worship lobby/);
    expect(c).toMatch(/environmental-graphics studio briefing a client: room-scale hierarchy, one focal point/);
    expect(c).not.toMatch(/Rotate the set across current interior styles/);
    expect(c.length).toBeLessThan(4000);
    expect(c).toMatch(/restaurant, cafe, bar, retail store, salon, spa/);
  });
  it('keeps only usable briefs: drops spec-sheet, too-short and marketing prose, stamps catalog-legal DesignIDs, caps at the count', () => {
    const req = parseBriefRequest({ domain: 'residential', count: 5 });
    const out = normalizeGeneratedBriefs(good, req, 1757865600000);
    expect(out.map(b => b.name)).toEqual(['Indigo Fern', 'Hummingbird Toile', 'Walnut Herringbone']);
    for (const b of out) { expect(b.id).toMatch(DESIGN_ID); expect(b.domain).toBe('residential'); }
    expect(new Set(out.map(b => b.id)).size).toBe(3);
    expect(out[0]).toMatchObject({ mode: 'repeat', rendering: 'flat-bold', subcategory: 'bedroom', style: 'Organic Modern', tags: ['fern', 'indigo', 'block print'] });
    // A brief the writer left unstyled falls back to its rendering family, so the diversity readout always has a word.
    expect(out[2].style).toBe('faux-material');
    expect(normalizeGeneratedBriefs(good, { ...req, count: 2 })).toHaveLength(2);
    // A scoped request overrides whatever the writer said about mode/rendering.
    const scoped = normalizeGeneratedBriefs(good, { ...req, mode: 'mural', rendering: 'painted-mural' });
    expect(scoped.every(b => b.mode === 'mural' && b.rendering === 'painted-mural')).toBe(true);
    expect(() => normalizeGeneratedBriefs({ prompts: [] }, req)).toThrow('list');
  });
  it('a written brief rides the batch entry shape and reaches the consultant verbatim', () => {
    const [b] = normalizeGeneratedBriefs(good, parseBriefRequest({ domain: 'residential', count: 1 }));
    const entry = generatedBriefAsEntry(b);
    expect(briefForEntry(entry)).toBe(b.prompt);
    expect(entry.style).toBe('Organic Modern');
    expect(entry.id).toMatch(DESIGN_ID);
  });
  it('the handler requires a signed-in curator, calls the pinned flash model with JSON output, and returns the normalized briefs', async () => {
    const f = fixture();
    const res = await f.invoke({ domain: 'residential', count: 5, space: 'nursery' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts.map((b: any) => b.name)).toEqual(['Indigo Fern', 'Hummingbird Toile', 'Walnut Herringbone']);
    expect(body.model).toBe(BRIEF_WRITER_MODEL);
    expect(f.calls[0].url).toContain(`/models/${BRIEF_WRITER_MODEL}:generateContent?key=provider-test-key`);
    expect(f.calls[0].body.generationConfig).toMatchObject({ responseMimeType: 'application/json', temperature: 1.0 });
    expect(f.calls[0].body.contents[0].parts[0].text).toMatch(/every brief is for a nursery/);
    expect(f.sb.from).toHaveBeenCalledWith('user_roles');
    expect(f.roles.in).toHaveBeenCalledWith('role', ['admin', 'tester']);
  });
  it('refuses a signed-out caller, a non-curator, a bad request, and reports provider trouble without inventing briefs', async () => {
    expect((await fixture({ auth: false }).invoke()).status).toBe(401);
    expect((await fixture({ curator: false }).invoke()).status).toBe(403);
    expect((await fixture().invoke({ domain: 'vehicle' })).status).toBe(400);
    expect((await fixture({ key: '' }).invoke()).status).toBe(503);
    expect((await fixture({ status: 429 }).invoke()).status).toBe(502);
    expect((await fixture({ text: 'not json' }).invoke()).status).toBe(502);
    const empty = await fixture({ answer: [good[2], good[3]] }).invoke();
    expect(empty.status).toBe(502);
    expect((await empty.json()).code).toBe('PROVIDER_EMPTY');
    // A non-curator never reaches the provider.
    const f = fixture({ curator: false }); await f.invoke();
    expect(f.provider).not.toHaveBeenCalled();
  });
});
