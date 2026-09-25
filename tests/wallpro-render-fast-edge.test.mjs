import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes, registerHooks } from 'node:module';

const source = readFileSync(new URL('../supabase/functions/render-wall-view/handler.ts', import.meta.url), 'utf8');

// Exercise the actual handler with a deterministic in-memory image codec and
// provider/storage fixtures. These are contract tests, not Gemini visual tests.
const codecURL = 'https://deno.land/x/imagescript@1.2.15/mod.ts';
registerHooks({
  resolve(specifier, context, next) {
    return specifier === codecURL ? { url: codecURL, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    if (url !== codecURL) return next(url, context);
    return { format: 'module', shortCircuit: true, source: `
      export class Image {
        constructor(w, h, bitmap) { this.width = w; this.height = h; this.bitmap = bitmap; }
        static async decode(bytes) {
          const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          return new Image(v.getUint32(16), v.getUint32(20), new Uint8ClampedArray(bytes.slice(24)));
        }
        resize(w, h) {
          if (w !== this.width || h !== this.height) throw new Error('Unexpected resize in codec fixture');
          return this;
        }
        async encode() {
          const bytes = new Uint8Array(24 + this.bitmap.length);
          bytes[0] = 0x89; bytes[1] = 0x50;
          const v = new DataView(bytes.buffer); v.setUint32(16, this.width); v.setUint32(20, this.height);
          bytes.set(this.bitmap, 24); return bytes;
        }
      }
    ` };
  },
});
const js = stripTypeScriptTypes(source, { mode: 'strip' });
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const { createViewHandler, parseViewInput, viewPrompt, VIEW_MODEL, decodeWallImage, finalWallImage, applyProtectedAreaMask, featherMaskAlpha, fitProviderImages } = mod;
const owner = '11111111-1111-4111-8111-111111111111';
const paths = {
  wallPath: owner + '/uploads/22222222-2222-4222-8222-222222222222.png',
  artworkPath: owner + '/generated/33333333-3333-4333-8333-333333333333.png',
  geometryPath: owner + '/uploads/44444444-4444-4444-8444-444444444444.png',
  maskPath: owner + '/uploads/55555555-5555-4555-8555-555555555555.png',
  removePath: owner + '/uploads/66666666-6666-4666-8666-666666666666.png',
};
const corners = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }];
function image(w, h, rgba) {
  const bytes = new Uint8Array(24 + w * h * 4); bytes[0] = 0x89; bytes[1] = 0x50;
  const v = new DataView(bytes.buffer); v.setUint32(16, w); v.setUint32(20, h);
  for (let i = 24; i < bytes.length; i += 4) bytes.set(rgba, i);
  return bytes;
}
function fixture({ authorized = true, providerStatus = 200, missing = null, signError = false } = {}) {
  const images = {
    [paths.wallPath]: image(4, 3, [20, 30, 40, 255]),
    [paths.artworkPath]: image(2, 2, [60, 70, 80, 255]),
    [paths.geometryPath]: image(3, 4, [100, 110, 120, 255]),
    [paths.maskPath]: image(4, 3, [255, 255, 255, 255]),
    [paths.removePath]: image(4, 3, [255, 255, 255, 0]),
  };
  const painted = image(4, 3, [200, 210, 220, 255]);
  const calls = [], uploads = [], downloads = [], authCalls = [];
  const storage = {
    async download(path) {
      downloads.push(path);
      return path === missing || !images[path] ? { error: true, data: null } : { error: null, data: new Blob([images[path]], { type: 'image/png' }) };
    },
    async upload(path, bytes, options) { uploads.push({ path, bytes: new Uint8Array(bytes), options }); return { error: null }; },
    async createSignedUrl(path) { return signError ? { data: null, error: true } : { data: { signedUrl: 'https://signed.test/' + path } }; },
  };
  const sb = {
    auth: { async getUser(jwt) { authCalls.push(jwt); return authorized ? { data: { user: { id: owner } } } : { data: null, error: true }; } },
    storage: { from(bucket) { assert.equal(bucket, 'wallpro-files'); return storage; } },
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body });
    if (url.includes('gemini-2.5-flash')) return Response.json({ candidates: [{ content: { parts: [{ text: '{"stillVisible":false}' }] } }] });
    if (providerStatus !== 200) return Response.json({ error: { message: 'fixture provider failure' } }, { status: providerStatus });
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from(painted).toString('base64') } }] } }] });
  };
  const handler = createViewHandler({ createClient: () => sb, supabaseUrl: 'https://fixture.test', serviceKey: 'fixture-only', apiKey: () => 'fixture-only', fetch: fetchImpl });
  const invoke = (body = {}, authorization = 'Bearer fixture-token') => handler(new Request('https://fixture.test/render-wall-view', { method: 'POST', headers: authorization ? { authorization } : {}, body: JSON.stringify({ wallPath: paths.wallPath, artworkPath: paths.artworkPath, placement: 'repeat', repeatWidthIn: 24, wallWidthIn: 143, wallHeightIn: 96, corners, ...body }) }));
  return { handler, invoke, calls, uploads, downloads, authCalls, images, painted };
}

test('WallPro AI render keeps original room as visual authority', () => {
  for (const phrase of ['ORIGINAL ROOM PHOTO', 'FLAT PRINT MASTER', 'placement constraint only', "Do not copy the guide\\'s flat pasted appearance", 'photograph of a finished installation']) assert.ok(source.includes(phrase), phrase);
});
test('geometry remains guidance, not the customer-facing rendering authority', () => {
  for (const phrase of ['Image 3 is a geometry guide', 'Use it ONLY to identify the exact wall surface, physical scale and coverage boundary', 'Create the wall treatment natively in Image 1']) assert.ok(source.includes(phrase), phrase);
});
test('protected areas are restored after AI rendering on the geometry path too', () => {
  assert.match(source, /if \(maskBytes && wallPhotoBytes\) \{/);
  assert.doesNotMatch(source, /if \(maskBytes && wallPhotoBytes && !input\.geometryPath\)/);
});
test('renderer no longer imports the generator or its unrelated prompt dependencies', () => {
  assert.doesNotMatch(source, /^import\s.*from\s*['"]/m);
  assert.doesNotMatch(source, /import\(['"]\.\.\/generate-wall-design\//);
});
test('local response codecs exactly match the existing generator implementations', () => {
  const generator = readFileSync(new URL('../supabase/functions/generate-wall-design/handler.ts', import.meta.url), 'utf8');
  for (const name of ['decodeWallImage', 'finalWallImage']) {
    const pattern = new RegExp('^export function ' + name + '\\([^]*?^\\}', 'm');
    const expected = generator.match(pattern)?.[0];
    assert.ok(expected, name);
    assert.equal(source.match(pattern)?.[0], expected, name + ' behavior must not drift');
  }
});
for (const geometry of [false, true]) for (const protect of [false, true]) for (const remove of [false, true]) {
  test(`actual provider payload: geometry=${geometry}, protection=${protect}, removal=${remove}`, async () => {
    const f = fixture();
    const body = { designDomain: 'residential', ...(geometry ? { geometryPath: paths.geometryPath } : {}), ...(protect ? { maskPath: paths.maskPath } : {}), ...(remove ? { removePath: paths.removePath } : {}) };
    const response = await f.invoke(body); assert.equal(response.status, 200);
    const result = await response.json(); assert.ok(result.view_url); assert.equal(result.model, VIEW_MODEL);
    const request = f.calls[0].body, parts = request.contents[0].parts;
    const frames = parts.filter(p => p.inlineData);
    const expected = [paths.wallPath, paths.artworkPath, ...(geometry ? [paths.geometryPath] : []), ...(protect ? [paths.maskPath] : []), ...(remove ? [paths.removePath] : [])];
    assert.equal(frames.length, expected.length);
    for (let i = 0; i < expected.length; i++) assert.equal(frames[i].inlineData.data, Buffer.from(f.images[expected[i]]).toString('base64'));
    const labels = parts.filter(p => /^Image \d+ —/.test(p.text || '')).map(p => Number(p.text.match(/^Image (\d+)/)[1]));
    assert.deepEqual(labels, expected.map((_, i) => i + 1));
    assert.equal(request.generationConfig.imageConfig.aspectRatio, '4:3', 'original room controls framing even with portrait guide');
    assert.match(parts[0].text, /143 inches wide and 96 inches tall/);
    assert.match(parts[0].text, /repeating tile about 24 inches wide/);
    assert.match(parts[0].text, /\(0\.1000,0\.1000\)/);
    assert.match(parts[0].text, /interior-visualization retoucher/);
    assert.match(parts[0].text, /printed vinyl wallcovering bonded flat to the wall/);
    assert.equal(f.uploads.length, 1);
    assert.match(f.uploads[0].path, new RegExp('^' + owner + '/views/'));
    assert.equal(f.uploads[0].options.upsert, false);
    assert.deepEqual(f.uploads[0].bytes, protect ? f.images[paths.wallPath] : f.painted, 'protected photo pixels survive the real restoration branch');
  });
}
test('commercial renderer persona is distinct while art remains unchanged', async () => {
  const f = fixture(); await f.invoke({ designDomain: 'commercial', geometryPath: paths.geometryPath, placement: 'cover' });
  const text = f.calls[0].body.contents[0].parts[0].text;
  assert.match(text, /professional sign and wrap shop/);
  assert.match(text, /one mural that fills the whole wall/);
  assert.match(text, /without redesign/);
  assert.match(text, /original camera, lens, light direction/);
});
test('OPTIONS stays 204 and neither authenticates nor invokes a provider', async () => {
  const f = fixture(); const response = await f.handler(new Request('https://fixture.test', { method: 'OPTIONS' }));
  assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert.equal(f.calls.length, 0); assert.equal(f.authCalls.length, 0); assert.equal(f.downloads.length, 0);
});
for (const authorization of ['', 'Bearer invalid']) test('authentication still rejects ' + (authorization || 'missing JWT'), async () => {
  const f = fixture({ authorized: false }); const response = await f.invoke({}, authorization);
  assert.equal(response.status, 401); assert.equal((await response.json()).code, 'AUTH_REQUIRED');
  assert.equal(f.calls.length, 0); assert.equal(f.downloads.length, 0); assert.equal(f.uploads.length, 0);
});
for (const key of ['wallPath', 'artworkPath', 'geometryPath', 'maskPath', 'removePath']) test('rejects another owner for ' + key, async () => {
  const f = fixture(); const response = await f.invoke({ [key]: paths[key].replace(owner, '77777777-7777-4777-8777-777777777777') });
  assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
});
test('missing original room does not substitute the geometry guide', async () => {
  const f = fixture({ missing: paths.wallPath }); const response = await f.invoke({ geometryPath: paths.geometryPath });
  assert.equal(response.status, 400); assert.equal(f.calls.length, 0); assert.equal(f.uploads.length, 0);
});
test('provider failure cannot publish the deterministic guide as an AI result', async () => {
  const f = fixture({ providerStatus: 429 }); const response = await f.invoke({ geometryPath: paths.geometryPath });
  assert.equal(response.status, 502); assert.equal((await response.json()).code, 'VIEW_FAILED'); assert.equal(f.uploads.length, 0);
});
test('valid image payload decodes unchanged across chunk boundaries', () => {
  for (const size of [1, 2, 3, 262143, 262144, 262145]) {
    const original = Buffer.alloc(size, 173); assert.deepEqual(Buffer.from(decodeWallImage(original.toString('base64'))), original);
  }
});
test('malformed and oversized image payloads still fail', () => {
  for (const value of [null, {}, '', 'abc', '!!!!', 'A'.repeat(Math.ceil(20 * 1024 * 1024 / 3) * 4 + 4)]) assert.throws(() => decodeWallImage(value));
});
test('only final non-thought supported images are selected', () => {
  const good = { mimeType: 'image/png', data: 'AQID' };
  const result = finalWallImage({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'BAUG' } }, { inlineData: good }, { thought: true, inlineData: { mimeType: 'image/png', data: 'BwgJ' } }, { inlineData: { mimeType: 'text/plain', data: 'wrong' } }] } }] });
  assert.deepEqual(result, good);
});
for (const reason of ['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'RECITATION', 'BLOCKLIST', 'NO_IMAGE']) test('provider stop reason preserved: ' + reason, () => {
  assert.throws(() => finalWallImage({ candidates: [{ finishReason: reason }] }), new RegExp(reason));
});
test('pixel preservation and feathering leave unmasked pixels untouched', () => {
  const output = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255]);
  const original = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255]);
  const mask = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0]);
  applyProtectedAreaMask(output, original, mask);
  assert.deepEqual([...output], [10, 20, 30, 255, 100, 100, 100, 255]);
  const feathered = featherMaskAlpha(mask, 2, 1, 1);
  assert.ok(feathered[3] > feathered[7] && feathered[7] > 0 && feathered[3] < 255);
});
test('fitting preserves image identity and only resizes when over budget', async () => {
  const sources = [{ path: 'photo', bytes: new Uint8Array(90), mimeType: 'image/png' }, { path: 'guide', bytes: new Uint8Array(5), mimeType: 'image/png' }];
  let calls = 0; const shrink = async () => { calls++; return { bytes: new Uint8Array(10), mimeType: 'image/jpeg' }; };
  assert.equal(await fitProviderImages(sources, 100, shrink), sources); assert.equal(calls, 0);
  const fitted = await fitProviderImages(sources, 20, shrink);
  assert.equal(calls, 1); assert.deepEqual(fitted.map(x => x.path), ['photo', 'guide']); assert.equal(sources[0].bytes.length, 90);
});
