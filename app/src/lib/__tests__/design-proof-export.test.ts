import { describe, expect, it, vi } from 'vitest';
import { createProofExportHandler, proofMetadata } from '../../../../supabase/functions/design-proof-export/handler';

const metadata = { brand: 'weprintwraps', vehicle: '2024 Ford Transit', design: 'Forest', yards: 22, finish: 'Gloss' };
const pdfBase64 = btoa('%PDF-1.7\nexact on-screen branded proof\n%%EOF');
function fixture({ signedIn = true, providerOk = true, configured = true } = {}) {
  const objects = new Map<string, Blob>();
  const storage = {
    upload: vi.fn(async (path: string, data: BlobPart) => { objects.set(path, new Blob([data])); return { error: null }; }),
    download: vi.fn(async (path: string) => ({ data: objects.get(path) })),
    remove: vi.fn(async (paths: string[]) => { paths.forEach(p => objects.delete(p)); return { error: null }; }),
    createSignedUrl: vi.fn(async (path: string, expiresIn: number) => ({ data: { signedUrl: `https://proof.example/${path}?expires=${expiresIn}` } })),
  };
  const db = { auth: { getUser: vi.fn(async () => ({ data: { user: signedIn ? { id: 'owner-one', email: 'owner@example.com' } : null } })) }, storage: { from: vi.fn(() => storage) } };
  const fetchImpl = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify(providerOk ? { id: 'email-confirmed' } : { error: 'failed' }), { status: providerOk ? 200 : 500 }));
  const handler = createProofExportHandler({ db, fetchImpl, resendKey: configured ? 'test-only-key' : undefined });
  const request = (body: unknown, token = 'valid-test-token') => handler(new Request('https://proof.example', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));
  const save = () => request({ action: 'save', pdfBase64, metadata });
  return { objects, storage, db, fetchImpl, request, save };
}

describe('saved proof delivery', () => {
  it('requires authentication before storing anything', async () => {
    const f = fixture({ signedIn: false });
    expect((await f.save()).status).toBe(401);
    expect((await f.request({}, '')).status).toBe(401);
    expect(f.storage.upload).not.toHaveBeenCalled();
  });
  it('preserves the exact PDF and binds canonical brand, yards and expiring download', async () => {
    const f = fixture();
    const response = await f.save();
    const saved = await response.json();
    expect(response.status).toBe(200);
    expect(await f.objects.get(saved.path)?.text()).toBe(atob(pdfBase64));
    expect(saved.path).toMatch(/^proof-exports\/owner-one\//);
    expect(saved.pdfUrl).toContain('expires=604800');
    const context = JSON.parse(await f.objects.get(saved.path.replace('proof.pdf', 'context.json'))!.text());
    expect(context).toMatchObject({ title: 'WPW × PatternPro', yards: 22, footer: '® DesignProAI Software for WePrintWraps' });
  });
  it('emails the same attachment and brand, safely escaping customer text', async () => {
    const f = fixture();
    const saved = await (await f.save()).json();
    const body = { action: 'email', path: saved.path, to: 'customer@example.com', subject: 'Design proof', message: '<img src=x onerror=alert(1)>' };
    expect((await f.request(body)).status).toBe(200);
    const [, options] = f.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const email = JSON.parse(options.body as string);
    expect(email.attachments[0].content).toBe(pdfBase64);
    expect(email.html).toContain('22 linear yards');
    expect(email.html).toContain('WPW × PatternPro');
    expect(email.html).toContain('&lt;img');
    expect(email.html).not.toContain('<img');
    expect(email.reply_to).toBe('owner@example.com');
    expect(email.from).toBe('WPW × PatternPro <orders@designproai.com>');
    await f.request(body);
    expect(f.fetchImpl.mock.calls[1][1].headers['Idempotency-Key']).toBe(options.headers!['Idempotency-Key']);
  });
  it('rejects another owner’s attachment before reading storage or sending', async () => {
    const f = fixture();
    expect((await f.request({ action: 'email', path: 'proof-exports/other/11111111-1111-1111-1111-111111111111/proof.pdf' })).status).toBe(403);
    expect(f.storage.download).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([{ configured: false, status: 503 }, { providerOk: false, status: 502 }])('never claims a failed email was sent: %j', async ({ status, ...options }) => {
    const f = fixture(options);
    const saved = await (await f.save()).json();
    const response = await f.request({ action: 'email', path: saved.path, to: 'customer@example.com', subject: 'Proof', message: 'Review' });
    expect(response.status).toBe(status);
    expect((await response.json()).success).not.toBe(true);
  });
  it('refuses a non-PDF and invalid yardage', async () => {
    const f = fixture();
    expect((await f.request({ action: 'save', metadata, pdfBase64: btoa('not a PDF') })).status).toBe(400);
    expect((await f.request({ action: 'save', metadata: { ...metadata, yards: 0 }, pdfBase64 })).status).toBe(400);
    expect(f.storage.upload).not.toHaveBeenCalled();
  });
  it('uses the same delivery metadata for WallPro, without vehicle quantities', () => {
    const wall = { widthInches: 120, heightInches: 96, squareFeet: 80, linearFeet: 24.5, panels: 3 };
    const actual = proofMetadata({ ...metadata, tool: 'wallpro', wall, title: 'wrong', footer: 'wrong' });
    expect(actual).toMatchObject({ title: 'WPW × WallPro', wall });
    expect(actual.yards).toBeUndefined();
    expect(() => proofMetadata({ ...metadata, tool: 'wallpro', wall: { ...wall, panels: 0 } })).toThrow();
  });
});
