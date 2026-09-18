import { describe, expect, it, vi } from 'vitest';
import { createProofExportHandler, proofMetadata } from '../../../../supabase/functions/design-proof-export/handler';

const metadata = { brand: 'weprintwraps', vehicle: '2024 Ford Transit', design: 'Forest', yards: 22, finish: 'Gloss' };
const pdfBase64 = btoa('%PDF-1.7\nexact on-screen branded proof\n%%EOF');
function fixture({ signedIn = true, providerOk = true, configured = true, catalogFailure = false } = {}) {
  const objects = new Map<string, Blob>();
  const records: any[] = [];
  const queries: Array<Array<[string, unknown]>> = [];
  const from = vi.fn((table: string) => {
    expect(table).toBe('design_proofs');
    const filters: Array<[string, unknown]> = [];
    queries.push(filters);
    let first = 0; let last = 24;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      ilike: (_key: string, value: unknown) => { filters.push(['search', value]); return query; },
      order: () => query,
      range: (start: number, end: number) => { first = start; last = end; return query; },
      insert: async (record: any) => {
        if (catalogFailure) return { error: { message: 'unavailable' } };
        records.unshift({ ...record, created_at: new Date().toISOString() }); return { error: null };
      },
      then: (resolve: (result: any) => void) => resolve({ data: records.filter(row => filters.every(([key, value]) => key === 'search' ? JSON.stringify(row).toLowerCase().includes(String(value).slice(1, -1).toLowerCase()) : row[key] === value)).slice(first, last + 1), error: null }),
    };
    return query;
  });
  const storage = {
    upload: vi.fn(async (path: string, data: BlobPart) => { objects.set(path, new Blob([data])); return { error: null }; }),
    download: vi.fn(async (path: string) => ({ data: objects.get(path) })),
    remove: vi.fn(async (paths: string[]) => { paths.forEach(p => objects.delete(p)); return { error: null }; }),
    createSignedUrl: vi.fn(async (path: string, expiresIn: number) => ({ data: { signedUrl: `https://proof.example/${path}?expires=${expiresIn}` } })),
  };
  const db = { from, auth: { getUser: vi.fn(async () => ({ data: { user: signedIn ? { id: 'owner-one', email: 'owner@example.com' } : null } })) }, storage: { from: vi.fn(() => storage) } };
  const fetchImpl = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify(providerOk ? { id: 'email-confirmed' } : { error: 'failed' }), { status: providerOk ? 200 : 500 }));
  const handler = createProofExportHandler({ db, fetchImpl, resendKey: configured ? 'test-only-key' : undefined });
  const request = (body: unknown, token = 'valid-test-token') => handler(new Request('https://proof.example', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));
  const save = () => request({ action: 'save', pdfBase64, metadata });
  return { objects, storage, db, fetchImpl, request, save, records, queries };
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
  it('files the proof with its canonical system and real references, searchable only by its owner', async () => {
    const f = fixture();
    const saved = await (await f.request({ action: 'save', pdfBase64, metadata: { ...metadata, generationId: 'generation-one', designId: 'design-one' }, owner_user_id: 'attacker' })).json();
    expect(f.records[0]).toMatchObject({ id: saved.id, owner_user_id: 'owner-one', brand: 'weprintwraps', tool: 'patternpro', metadata: { generationId: 'generation-one', designId: 'design-one' } });
    f.records.push({ ...f.records[0], id: 'someone-else', owner_user_id: 'other-owner' });
    const listed = await (await f.request({ action: 'list', brand: 'weprintwraps', tool: 'patternpro', search: 'generation-one', owner_user_id: 'other-owner' })).json();
    expect(listed.proofs.map((row: any) => row.id)).toEqual([saved.id]);
    expect(f.queries.at(-1)).toContainEqual(['owner_user_id', 'owner-one']);
    expect((await (await f.request({ action: 'list', tool: 'wallpro' })).json()).proofs).toEqual([]);
    expect((await (await f.request({ action: 'list', brand: 'designpro' })).json()).proofs).toEqual([]);
  });
  it('paginates saved exports without silently dropping older proofs', async () => {
    const f = fixture();
    for (let n = 0; n < 26; n++) f.records.push({ id: `proof-${n}`, owner_user_id: 'owner-one' });
    const first = await (await f.request({ action: 'list' })).json();
    const next = await (await f.request({ action: 'list', page: 1 })).json();
    expect(first.proofs).toHaveLength(24); expect(first.hasMore).toBe(true);
    expect(next.proofs.map((row: any) => row.id)).toEqual(['proof-24', 'proof-25']); expect(next.hasMore).toBe(false);
  });
  it('requires a session for catalog reads and refuses another owner’s renewed link', async () => {
    const f = fixture({ signedIn: false });
    expect((await f.request({ action: 'list' })).status).toBe(401);
    expect(f.db.from).not.toHaveBeenCalled();
    const owner = fixture();
    expect((await owner.request({ action: 'link', path: 'proof-exports/other/11111111-1111-1111-1111-111111111111/proof.pdf' })).status).toBe(403);
    expect(owner.storage.download).not.toHaveBeenCalled();
    const saved = await (await owner.save()).json();
    expect((await (await owner.request({ action: 'link', path: saved.path })).json()).pdfUrl).toContain('expires=604800');
    expect(owner.fetchImpl).not.toHaveBeenCalled();
  });
  it('removes partial files and fails clearly when catalog filing fails', async () => {
    const f = fixture({ catalogFailure: true });
    expect((await f.save()).status).toBe(500);
    expect(f.objects.size).toBe(0);
    expect(f.records).toEqual([]);
  });
  it('validates filters and escapes literal wildcard searches', async () => {
    const f = fixture();
    expect((await f.request({ action: 'list', page: -1 })).status).toBe(400);
    expect((await f.request({ action: 'list', tool: 'unwired-system' })).status).toBe(400);
    await f.request({ action: 'list', search: '100%_wrap' });
    expect(f.queries.at(-1)).toContainEqual(['search', '%100\\%\\_wrap%']);
  });
});
