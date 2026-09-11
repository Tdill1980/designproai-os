import { describe, expect, it, vi } from 'vitest';
import { createViewHandler, parseViewInput, viewPrompt, VIEW_MODEL } from '../../../../supabase/functions/render-wall-view/handler';

const owner = '11111111-1111-4111-8111-111111111111';
const wallPath = owner + '/uploads/33333333-3333-4333-8333-333333333333.jpg';
const artworkPath = owner + '/generated/44444444-4444-4444-8444-444444444444.png';
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
});
