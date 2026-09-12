import { describe, expect, it, vi } from 'vitest';
import { createViewHandler, parseViewInput, viewPrompt, VIEW_MODEL, applyProtectedAreaMask } from '../../../../supabase/functions/render-wall-view/handler';

const owner = '11111111-1111-4111-8111-111111111111';
const wallPath = owner + '/uploads/33333333-3333-4333-8333-333333333333.jpg';
const artworkPath = owner + '/generated/44444444-4444-4444-8444-444444444444.png';
const maskPath = owner + '/uploads/66666666-6666-4666-8666-666666666666.png';
const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAWk1v8QAAAABJRU5ErkJggg==';

function fixture(status?: number) {
  const uploads: string[] = [];
  const storage = {
    download: vi.fn(async (path: string) => ({ data: new Blob(['x'], { type: path.endsWith('.jpg') ? 'image/jpeg' : 'image/png' }), error: null })),
    upload: vi.fn(async (path: string) => { uploads.push(path); return { error: null }; }),
    createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: 'https://signed/' + path }, error: null })),
  };
  const sb = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: owner } } })) }, storage: { from: vi.fn(() => storage) } };
  const calls: any[] = [];
  const provider = vi.fn(async (_url: any, init: any) => { calls.push(JSON.parse(init.body)); return status ? new Response('{}', { status }) : Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png1x1 } }] } }] }); });
  const handler = createViewHandler({ createClient: () => sb, supabaseUrl: 'https://own.supabase.co', serviceKey: 'k', apiKey: () => 'key', fetch: provider as any });
  const invoke = (body: any) => handler(new Request('https://own.supabase.co/functions/v1/render-wall-view', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body) }));
  return { invoke, calls, uploads, provider };
}

describe('AI view on the wall', () => {
  it('sends the room photo and the flat master with the leave-everything-else instruction and stores the view under the owner', async () => {
    const f = fixture();
    const result = await f.invoke({ wallPath, artworkPath, placement: 'repeat', repeatWidthIn: 24, wallWidthIn: 142, wallHeightIn: 96 });
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.model).toBe(VIEW_MODEL); expect(body.view_path).toMatch(new RegExp('^' + owner + '/views/[0-9a-f-]{36}\\.png$')); expect(body.view_url).toContain('https://signed/');
    expect(f.uploads).toEqual([body.view_path]);
    const request = f.calls[0];
    expect(request.generationConfig.responseModalities).toEqual(['IMAGE']); expect(request.generationConfig.imageConfig.imageSize).toBe('2K');
    const text = request.contents[0].parts[0].text;
    expect(text).toMatch(/curtains, drapes and rods/); expect(text).toMatch(/stays untouched/); expect(text).toMatch(/repeating tile about 24 inches wide/); expect(text).toMatch(/142 inches wide/);
    expect(request.contents[0].parts.filter((p: any) => p.inlineData)).toHaveLength(2);
  });
  it('describes a mural when the placement is cover', () => {
    expect(viewPrompt({ placement: 'cover', repeatWidthIn: null, wallWidthIn: 120, wallHeightIn: null })).toMatch(/one mural that fills the whole wall/);
  });
  it('refuses files that are not the owner\'s and fails soft when the model cannot render', async () => {
    expect(() => parseViewInput({ wallPath: '99999999-9999-4999-8999-999999999999/uploads/33333333-3333-4333-8333-333333333333.jpg', artworkPath }, owner)).toThrow(/your own files/);
    expect(parseViewInput({ wallPath, artworkPath: 'catalog/55555555-5555-4555-8555-555555555555.jpg' }, owner).artworkPath).toMatch(/^catalog\//);
    const busy = fixture(429); const r = await busy.invoke({ wallPath, artworkPath, placement: 'cover' });
    expect(r.status).toBe(502); expect((await r.json()).error).toMatch(/busy/);
  });
  it('parses an omitted mask as null and refuses a mask that is not the owner\'s', () => {
    expect(parseViewInput({ wallPath, artworkPath }, owner).maskPath).toBeNull();
    expect(() => parseViewInput({ wallPath, artworkPath, maskPath: '99999999-9999-4999-8999-999999999999/uploads/x.png' }, owner)).toThrow(/your own files/);
    expect(parseViewInput({ wallPath, artworkPath }, owner).removePath).toBeNull();
    expect(() => parseViewInput({ wallPath, artworkPath, removePath: '99999999-9999-4999-8999-999999999999/uploads/x.png' }, owner)).toThrow(/your own files/);
  });
  it('attaches a supplied remove mask with the erase-and-paint-through instruction, numbered after the protect mask when both are present', async () => {
    const removePath = owner + '/uploads/88888888-8888-4888-8888-888888888888.png';
    const onlyRemove = fixture();
    const r1 = await onlyRemove.invoke({ wallPath, artworkPath, removePath, placement: 'cover' });
    expect(r1.status).toBe(200);
    const parts1 = onlyRemove.calls[0].contents[0].parts;
    expect(parts1.filter((p: any) => p.inlineData)).toHaveLength(3);
    expect(parts1.some((p: any) => p.text === 'Image 3 — items to remove: white and opaque marks freestanding furniture or equipment that will be moved out of the room before the covering is installed. Erase it entirely and paint the covering through that area as if it were never there -- do not preserve it, and do not treat it as something to paint around.')).toBe(true);

    const both = fixture();
    const r2 = await both.invoke({ wallPath, artworkPath, maskPath, removePath, placement: 'cover' });
    expect(r2.status).toBe(200);
    const parts2 = both.calls[0].contents[0].parts;
    expect(parts2.filter((p: any) => p.inlineData)).toHaveLength(4);
    expect(parts2.some((p: any) => p.text?.startsWith('Image 3 — protected areas'))).toBe(true);
    expect(parts2.some((p: any) => p.text?.startsWith('Image 4 — items to remove'))).toBe(true);
  });
  it('attaches a supplied protected-area mask as a third image with the never-paint-over-white instruction', async () => {
    const f = fixture();
    const result = await f.invoke({ wallPath, artworkPath, maskPath, placement: 'cover' });
    expect(result.status).toBe(200);
    const parts = f.calls[0].contents[0].parts;
    expect(parts.filter((p: any) => p.inlineData)).toHaveLength(3);
    expect(parts.some((p: any) => p.text && /Image 3.*protected areas/.test(p.text))).toBe(true);
    expect(parts.some((p: any) => p.text && /never paints over a white area/.test(p.text))).toBe(true);
  });
  it('drops a mask silently rather than failing the view when it cannot be read as a PNG', async () => {
    const f = fixture();
    const badMaskPath = owner + '/uploads/77777777-7777-4777-8777-777777777777.jpg'; // wrong type for a mask
    const result = await f.invoke({ wallPath, artworkPath, maskPath: badMaskPath, placement: 'cover' });
    expect(result.status).toBe(200);
    expect(f.calls[0].contents[0].parts.filter((p: any) => p.inlineData)).toHaveLength(2);
  });
});

describe('applyProtectedAreaMask — the actual guarantee, as pixel math', () => {
  it('overwrites RGB from the wall photo only where the mask is opaque, and leaves alpha and unprotected pixels alone', () => {
    // Two RGBA pixels: pixel 0 is protected (mask alpha 255), pixel 1 is not (mask alpha 0).
    const outPx = new Uint8ClampedArray([10, 20, 30, 255, /* px1 */ 200, 210, 220, 128]);
    const wallPx = new Uint8ClampedArray([1, 2, 3, 9, /* px1 */ 250, 251, 252, 9]);
    const maskPx = new Uint8ClampedArray([255, 255, 255, 255, /* px1 */ 0, 0, 0, 0]);
    applyProtectedAreaMask(outPx, wallPx, maskPx);
    expect(Array.from(outPx)).toEqual([1, 2, 3, 255, 200, 210, 220, 128]);
  });
  it('is a no-op when nothing in the mask exceeds the threshold', () => {
    const outPx = new Uint8ClampedArray([10, 20, 30, 255]);
    const wallPx = new Uint8ClampedArray([99, 98, 97, 255]);
    const maskPx = new Uint8ClampedArray([127, 127, 127, 127]);
    applyProtectedAreaMask(outPx, wallPx, maskPx);
    expect(Array.from(outPx)).toEqual([10, 20, 30, 255]);
  });
});
