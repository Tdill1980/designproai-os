import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { collectEdgeSourceFiles, loadSourceParser } from '../scripts/edge-source-closure.mjs';
const ts = loadSourceParser();
const entry = 'supabase/functions/demo/index.ts';
const shared = 'supabase/functions/_shared/';
function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'edge-closure-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const target = join(root, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content);
  }
  return root;
}
function graph(root) { return collectEdgeSourceFiles({ root, entrypoints: [entry], ts }); }
const sample = {
  [entry]: `import { unused } from '../_shared/unused.ts';\nimport type { Shape } from '../_shared/types.ts';\nexport const active = 1;`,
  [shared + 'unused.ts']: `import { nested } from './nested.ts'; export const unused = 2;`,
  [shared + 'nested.ts']: `import './unused.ts'; export const nested = 3;`,
  [shared + 'types.ts']: `export interface Shape { x: number }`,
};
test('raw closure keeps unused imports, type imports, transitive imports and cycles', t => {
  assert.deepEqual(graph(fixture(t, sample)), Object.keys(sample).sort());
});
test('pinned esbuild omits unused TS imports; raw-source staging restores them', t => {
  if (!process.env.ESBUILD_BIN) return t.skip('real esbuild runs in CI and deploy preflight');
  const root = fixture(t, sample), meta = join(root, 'meta.json');
  execFileSync(process.env.ESBUILD_BIN, [entry, '--bundle', '--format=esm', `--metafile=${meta}`, `--outfile=${join(root, 'out.js')}`], { cwd: root });
  const optimized = Object.keys(JSON.parse(readFileSync(meta, 'utf8')).inputs);
  assert.ok(!optimized.includes(shared + 'unused.ts'), 'reproduce the failed packager assumption');
  assert.ok(graph(root).includes(shared + 'unused.ts'));
});
test('staged raw graph resolves identically without rewriting any source', t => {
  const root = fixture(t, sample), stage = fixture(t, {}), files = graph(root);
  for (const file of files) { mkdirSync(dirname(join(stage, file)), { recursive: true }); copyFileSync(join(root, file), join(stage, file)); }
  assert.deepEqual(graph(stage), files);
  for (const file of files) assert.deepEqual(readFileSync(join(stage, file)), readFileSync(join(root, file)));
  rmSync(join(stage, shared + 'nested.ts'));
  assert.throws(() => graph(stage), /ENOENT/);
});
test('comments, regex and prompt strings do not invent dependency paths', t => {
  const root = fixture(t, { [entry]: `// import './missing.ts';\nconst p = "export { x } from './fake.ts'";\nconst q = /import('noise')/;\nexport { p, q };` });
  assert.deepEqual(graph(root), [entry]);
});
test('side effects, re-exports, import types and literal dynamic imports are included', t => {
  const root = fixture(t, { [entry]: `import '../_shared/one.ts'; export * from '../_shared/two.ts'; type T = import('../_shared/types.ts').Shape; const later = () => import('../_shared/three.ts');`,
    [shared + 'one.ts']: 'export {};', [shared + 'two.ts']: 'export {};', [shared + 'three.ts']: 'export {};', [shared + 'types.ts']: 'export interface Shape {}' });
  assert.equal(graph(root).length, 5);
});
test('external URLs remain external; unrelated shared files are not copied', t => {
  const root = fixture(t, { [entry]: `import 'https://example.test/a.ts'; import 'npm:zod'; import 'jsr:@std/path'; import 'node:crypto';`, [shared + 'unrelated.ts']: 'export {};' });
  assert.deepEqual(graph(root), [entry]);
});
for (const [name, source, pattern] of [
  ['missing static dependency', "import { unused } from './missing.ts';", /ENOENT/],
  ['computed dynamic dependency', "const p = './x.ts'; import(p);", /Nonliteral/],
  ['bare alias', "import 'alias';", /Unresolved import/],
  ['path escape', "import '../../../../outside.ts';", /escapes checkout/],
  ['invalid syntax', 'export const = ;', /Invalid source syntax/],
]) test(name + ' fails before deployment', t => assert.throws(() => graph(fixture(t, { [entry]: source })), pattern));
test('file symlinks are rejected', t => {
  const root = fixture(t, { [entry]: "import '../_shared/link.ts';", [shared + 'real.ts']: 'export {};' });
  symlinkSync(join(root, shared + 'real.ts'), join(root, shared + 'link.ts'));
  assert.throws(() => graph(root), /Symlink/);
});
test('directory symlinks are rejected', t => {
  const root = fixture(t, { [entry]: "import './linked/real.ts';", [shared + 'real.ts']: 'export {};' });
  symlinkSync(join(root, shared), join(root, 'supabase/functions/demo/linked'), 'dir');
  assert.throws(() => graph(root), /Symlink/);
});
test('actual approved functions have complete staging graphs including the failed imports', t => {
  if (!process.env.EDGE_CLOSURE_REPO_TEST) return t.skip('repository graph runs in CI and deploy preflight');
  const root = process.cwd();
  const files = collectEdgeSourceFiles({ root, entrypoints: ['supabase/functions/production-panel-proof/index.ts'], ts });
  for (const name of ['token-gate.ts', 'designpro-text-layer-art.ts', 'artboard-template-os.ts', 'flat-master-prompt.ts', 'layer1-clean-prompt.ts', 'design-dna-capture.ts']) {
    assert.ok(files.includes(shared + name), name);
  }
  const wall = collectEdgeSourceFiles({ root, entrypoints: ['supabase/functions/render-wall-view/index.ts'], ts });
  assert.ok(wall.includes('supabase/functions/render-wall-view/handler.ts'));
  console.log(`Raw source closures: production-panel-proof=${files.length}, render-wall-view=${wall.length}`);
});
