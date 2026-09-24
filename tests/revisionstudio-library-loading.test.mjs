import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

// Execute the actual TypeScript/TSX, with only transport and hooks substituted.
// No Supabase credentials, image generation or production writes in these tests.
const requireApp = createRequire(new URL('../app/package.json', import.meta.url));
const ts = requireApp('typescript');
const sourcePath = 'app/src/lib/revisionstudio-source.ts';
const libraryPath = 'app/src/components/revisioniq/DesignLibrary.tsx';
function compiled(path) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const result = ts.transpileModule(source, {fileName: path, reportDiagnostics: true,
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}});
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  return result.outputText;
}
const sourceCode = compiled(sourcePath);
const libraryCode = compiled(libraryPath);
const fixture = (i, overrides = {}) => ({
  generationId: `gen-${i}`, designId: `DID-${i}`, designName: `Test ${i}`, companyName: null,
  brief: 'Original customer wording.', finish: 'Gloss', vehicle: {year: '2021', make: 'Ford', model: 'Raptor', type: 'truck'},
  state: 'outputs_ready', pipeline: 'atlas', createdAt: `2026-09-23T20:00:${String(i % 60).padStart(2, '0')}Z`,
  updatedAt: null, completedAt: null, revisionCount: 1, currentRevision: 1, viewCount: 7,
  viewsSuperseded: false, production: null, thumbnailUrl: `https://preview.invalid/${i}?lease=1`, ...overrides,
});
function loadSource(api, identities = {}) {
  const module = {exports: {}};
  const modules = {
    '@/lib/designpro-api': {dpApi: api, ROLE_FOR_SOURCE_VIEW_TYPE: {side: 'driver', 'passenger-side': 'passenger'}},
    '@/lib/designpro-artifact-selectors': {selectCustomerProof: () => null},
    '@/lib/design-version-history': {},
    '@/lib/studio-artifact-identity.mjs': {selectAtlasRevision: rows => rows[0] || null,
      viewBelongsToRevision: () => true, artifactsForStudioRevision: rows => rows, ...identities},
  };
  runInNewContext(sourceCode, {module, exports: module.exports, require: name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected import ${name}`); return modules[name];
  }});
  return module.exports;
}

test('237 designs use one index read and zero per-design detail reads', async () => {
  let reads = 0;
  const index = Array.from({length: 237}, (_, i) => fixture(i));
  const source = loadSource({listDesignLibrary: async () => { reads++; return index; },
    listArtifacts: async () => {reads++; return [];}, listJobFlatAtlasRevisions: async () => {reads++; return [];},
    listApprovedViews: async () => {reads++; return [];}});
  const rows = await source.listRevisionStudioDesigns();
  assert.equal(reads, 1, 'opening the shelf must not fan out 711 asset/revision/proof reads');
  assert.equal(rows.length, 237);
  for (const row of rows) {
    const entry = index.find(e => e.generationId === row.id);
    assert.equal(row.render_urls.side, entry.thumbnailUrl);
    assert.equal(row.render_urls.driver, entry.thumbnailUrl);
    assert.equal(Object.keys(row.render_urls).length, 2, 'one real driver preview under its two existing aliases');
    assert.equal(JSON.parse(row.admin_notes).original_prompt, entry.brief);
  }
});

test('missing previews and failed jobs remain real rows; no substitute artwork', async () => {
  const rows = await loadSource({listDesignLibrary: async () => [fixture(1, {thumbnailUrl: undefined, state: 'failed', viewCount: 0})]})
    .listRevisionStudioDesigns();
  assert.equal(rows.length, 1);
  assert.equal(Object.keys(rows[0].render_urls).length, 0);
  assert.equal(rows[0].generation_status, 'failed');
});

test('opening a design still reads only that design and honors a selected revision', async () => {
  const calls = [];
  const revision = {id: 'revision-2', revisionSequence: 2};
  const source = loadSource({
    getStatus: async id => {calls.push(['status', id]); return {...fixture(3), orderNumber: '', revision: 2};},
    listArtifacts: async id => {calls.push(['artifacts', id]); return [];},
    listJobFlatAtlasRevisions: async id => {calls.push(['revisions', id]); return [revision];},
    listApprovedViews: async (id, revisionId) => {calls.push(['views', id, revisionId]); return [{sourceViewType: 'side', signedUrl: 'fresh-proof'}];},
  }, {selectAtlasRevision: (rows, id) => rows.find(row => row.id === id)});
  const row = await source.readRevisionStudioDesign('gen-3', 'revision-2');
  assert.equal(row.atlas_revision_id, 'revision-2');
  assert.equal(row.revision, 2);
  assert.equal(row.render_urls.side, 'fresh-proof');
  assert.deepEqual(calls, [['status', 'gen-3'], ['artifacts', 'gen-3'], ['revisions', 'gen-3'], ['views', 'gen-3', 'revision-2']]);
});

// Small deterministic hook/event harness: evaluates the shipped component's
// event handlers, effects and cleanup with a controlled clock, not source greps.
function mountLibrary(read, initiallyHidden = false) {
  let slots = [], cursor = 0, dirty = false, tree, effects = [], mounted = true;
  let clock = 0, timerId = 0;
  const timers = new Map(), listeners = new Map();
  const doc = {visibilityState: initiallyHidden ? 'hidden' : 'visible',
    addEventListener: (name, fn) => {if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn);},
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn)};
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++; if (!slots[i]) slots[i] = {value: typeof initial === 'function' ? initial() : initial};
      return [slots[i].value, update => {if (!mounted) return; const next = typeof update === 'function' ? update(slots[i].value) : update;
        if (!Object.is(next, slots[i].value)) {slots[i].value = next; dirty = true;}}];
    },
    useRef(initial) {const i = cursor++; return slots[i] ||= {current: initial};},
    useMemo(fn, deps) {const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = {value: fn(), deps}; return slots[i].value;},
    useEffect(fn, deps) {const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => {
      slots[i]?.cleanup?.(); slots[i] = {deps, cleanup: fn()};
    });},
  };
  hooks.useCallback = (fn, deps) => hooks.useMemo(() => fn, deps);
  const jsx = (type, props, key) => ({type, props: props || {}, key});
  const module = {exports: {}};
  const modules = {react: hooks, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'Fragment'},
    'react-router-dom': {Link: 'Link'}, 'lucide-react': new Proxy({}, {get: (_, name) => name}),
    '@/components/ui/button': {Button: 'Button'}, '@/components/ui/input': {Input: 'Input'},
    '@/lib/designpro-api': {dpApi: {listDesignLibrary: read}}, '@/lib/utils': {cn: (...args) => args.filter(Boolean).join(' ')}};
  runInNewContext(libraryCode, {module, exports: module.exports, document: doc, Error,
    setTimeout: (fn, delay) => {const id = ++timerId; timers.set(id, {fn, at: clock + delay}); return id;},
    clearTimeout: id => timers.delete(id), require: name => {assert.ok(Object.hasOwn(modules, name)); return modules[name];}});
  function render() {cursor = 0; dirty = false; effects = []; tree = module.exports.DesignLibrary({}); for (const effect of effects) effect();}
  async function settle() {for (let i = 0; i < 30; i++) {if (dirty) render(); await Promise.resolve();} assert.equal(dirty, false);}
  const walk = (node, out = []) => {if (Array.isArray(node)) {node.forEach(n => walk(n, out)); return out;}
    if (!node || typeof node !== 'object') return out; out.push(node); walk(node.props?.children, out); return out;};
  const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children)
    : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  render();
  return {settle, get tree() {return tree;}, text: () => text(tree),
    images: () => walk(tree).filter(n => n.type === 'img'),
    refreshButton: () => walk(tree).find(n => n.type === 'Button' && text(n).trim() === 'Refresh'),
    async advance(ms) {const until = clock + ms; for (;;) {const next = [...timers].sort((a,b) => a[1].at-b[1].at)[0];
      if (!next || next[1].at > until) break; clock = next[1].at; timers.delete(next[0]); next[1].fn(); await settle();}
      clock = until; await settle();},
    async visible(value) {doc.visibilityState = value ? 'visible' : 'hidden';
      for (const fn of [...listeners.get('visibilitychange') || []]) fn(); await settle();},
    unmount() {mounted = false; for (const slot of slots) slot?.cleanup?.();},
  };
}

test('pending images have a loading state and onLoad clears only that image', async () => {
  const ui = mountLibrary(async () => [fixture(1), fixture(2)]); await ui.settle();
  assert.match(ui.text(), /Loading preview/);
  ui.images()[0].props.onLoad(); await ui.settle();
  assert.equal((ui.text().match(/Loading preview/g) || []).length, 1);
  ui.images()[1].props.onLoad(); await ui.settle();
  assert.doesNotMatch(ui.text(), /Loading preview/); ui.unmount();
});

test('a burst of image errors causes one immediate re-sign and never a retry storm', async () => {
  let reads = 0;
  const ui = mountLibrary(async () => {reads++; return [1,2,3].map(i => fixture(i, {thumbnailUrl: `https://preview.invalid/${i}?lease=${reads}`}));});
  await ui.settle(); ui.images().forEach(img => img.props.onError()); await ui.settle();
  assert.match(ui.text(), /Refreshing preview/);
  await ui.advance(250); assert.equal(reads, 2, 'errors must actually renew the URLs');
  assert.equal(ui.images().length, 3);
  ui.images().forEach(img => img.props.onError()); await ui.settle(); await ui.advance(1000);
  assert.equal(reads, 2, 'a still-invalid object must not spend another automatic request');
  assert.match(ui.text(), /Preview unavailable/);
  assert.doesNotMatch(ui.text(), /Refreshing preview/);
  assert.doesNotMatch(ui.text(), /This design produced no image/);
  ui.refreshButton().props.onClick(); await ui.settle(); assert.equal(reads, 3); ui.unmount();
});

test('a transient library failure retains the last readable design cards', async () => {
  let reads = 0;
  const ui = mountLibrary(async () => {if (++reads === 1) return [fixture(1)]; throw Object.assign(new Error('Temporary server failure'), {status: 503});});
  await ui.settle(); ui.refreshButton().props.onClick(); await ui.settle();
  assert.match(ui.text(), /1 of 1 design/); assert.match(ui.text(), /Temporary server failure/);
  assert.equal(ui.refreshButton().props.disabled, false); ui.unmount();
});

for (const status of [401, 403]) test(`authorization failure ${status} clears old session cards`, async () => {
  let reads = 0;
  const ui = mountLibrary(async () => {if (++reads === 1) return [fixture(1)]; throw Object.assign(new Error('Unauthorized'), {status});});
  await ui.settle(); ui.refreshButton().props.onClick(); await ui.settle();
  assert.equal(ui.images().length, 0); assert.match(ui.text(), /0 of 0 designs/); ui.unmount();
});

test('a stalled read releases Refresh after 20 seconds and ignores its late answer', async () => {
  let complete;
  const ui = mountLibrary(() => new Promise(resolve => {complete = resolve;})); await ui.settle();
  assert.equal(ui.refreshButton().props.disabled, true);
  await ui.advance(20_000); assert.equal(ui.refreshButton().props.disabled, false);
  assert.match(ui.text(), /taking too long/);
  complete([fixture(1)]); await ui.settle(); assert.equal(ui.images().length, 0); ui.unmount();
});

test('a hidden tab spends no periodic renewals; returning refreshes once', async () => {
  let reads = 0;
  const ui = mountLibrary(async () => {reads++; return [fixture(1)];}, true); await ui.settle();
  await ui.advance(300_000); assert.equal(reads, 1);
  await ui.visible(true); assert.equal(reads, 2); ui.unmount();
});

test('a tab hidden during error debounce does not renew in the background', async () => {
  let reads = 0;
  const ui = mountLibrary(async () => {reads++; return [fixture(1)];}); await ui.settle();
  ui.images()[0].props.onError(); await ui.settle(); await ui.visible(false); await ui.advance(250);
  assert.equal(reads, 1); await ui.visible(true); assert.equal(reads, 2); ui.unmount();
});

test('a visible library renews before expiry and unmount cancels queued recovery', async () => {
  let reads = 0;
  const ui = mountLibrary(async () => {reads++; return [fixture(1)];}); await ui.settle();
  await ui.advance(255_000); assert.equal(reads, 2);
  ui.images()[0].props.onError(); await ui.settle(); ui.unmount(); await ui.advance(300_000);
  assert.equal(reads, 2);
});
