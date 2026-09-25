import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'wozyamlnygaddievzuwn';
export const APPROVED = Object.freeze({
  'production-panel-proof': Object.freeze({
    sources: Object.freeze(['supabase/functions/production-panel-proof/index.ts']),
    tests: Object.freeze(['tests/production-panel-proof-clean-prompt.test.mjs', 'tests/edge-hotfix-call1.test.mjs']),
  }),
  'render-wall-view': Object.freeze({
    sources: Object.freeze(['supabase/functions/render-wall-view/index.ts', 'supabase/functions/render-wall-view/handler.ts']),
    tests: Object.freeze(['tests/wallpro-render-fast-edge.test.mjs']),
  }),
});
export const FUNCTION = 'production-panel-proof';
export const SOURCE = 'supabase/functions/production-panel-proof/index.ts';
export const FAST_PATHS = Object.freeze([...new Set(Object.values(APPROVED).flatMap(x => [...x.sources, ...x.tests]))]);
function specFor(fn) {
  const spec = APPROVED[fn];
  if (!spec) throw new Error('Function is not approved; no deploy-all option');
  return spec;
}
// No shared edits are approved initially. Existing unchanged shared modules
// may be bundled; changes to shared code, auth, config, tooling or workflows
// require the full lane. Add an exact shared path only with a full review.
export const SHA = /^[0-9a-f]{40}$/;
export function requireSha(value) {
  if (!SHA.test(value || '')) throw new Error('A full 40-character Git SHA is required');
  return value;
}
export function classify(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return { lane: 'full', reason: 'empty or unknown diff' };
  for (const [fn, spec] of Object.entries(APPROVED)) {
    const allowed = new Set([...spec.sources, ...spec.tests]);
    const allAllowed = entries.every(({ path, status }) =>
      allowed.has(path) && ['M', 'A'].includes(status) && (!spec.sources.includes(path) || status === 'M'));
    const sourceChanged = entries.some(x => spec.sources.includes(x.path));
    if (allAllowed && sourceChanged) return { lane: 'fast-edge', function_name: fn, source_changed: true };
  }
  const first = entries.find(({ path, status }) => !FAST_PATHS.includes(path) || !['M', 'A'].includes(status));
  return { lane: 'full', reason: first ? `protected change: ${first.status} ${first.path}` : 'mixed approved-function change' };
}
export function parseDiff(text) {
  const fields = text.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 2) throw new Error('Malformed git name-status output');
  const out = [];
  for (let i = 0; i < fields.length; i += 2) out.push({ status: fields[i], path: fields[i + 1] });
  return out;
}
export function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd();
}
export function diff(base, head) {
  requireSha(base); requireSha(head);
  git('merge-base', '--is-ancestor', base, head);
  return parseDiff(execFileSync('git', ['diff', '--no-renames', '--name-status', '-z', base, head, '--'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}
export function validateModes(head, entries) {
  for (const { path } of entries) {
    const record = git('ls-tree', requireSha(head), '--', path);
    if (!record.startsWith('100644 blob ')) throw new Error(`Not a regular non-executable file: ${path}`);
  }
}
export function releaseIgnorePaths(yaml) {
  // Deliberately require two explicit path filters, one per event. No YAML
  // package or npm install is needed for the routing safety test.
  const blocks = [...yaml.matchAll(/^    paths-ignore:\n((?:      - '[^'\n]+'\n)+)/gm)];
  return blocks.map(m => [...m[1].matchAll(/- '([^']+)'/g)].map(x => x[1]));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'classify') {
      const [base, head] = args;
      const entries = diff(base, head);
      const result = classify(entries);
      if (result.lane === 'fast-edge') validateModes(head, entries);
      console.log(JSON.stringify({ ...result, base, head, files: entries }, null, 2));
    } else if (command === 'candidate') {
      const [head, fn] = args;
      requireSha(head);
      const spec = specFor(fn);
      if (git('rev-parse', 'HEAD') !== head) throw new Error('Checkout differs from requested SHA');
      // Scope the most recent MAIN integration that changed any source owned by
      // the selected function. A mixed integration cannot be relabelled fast.
      const sourceArgs = spec.sources.flatMap(path => ['--', path]);
      let change = '';
      for (const source of spec.sources) {
        const candidate = git('log', '--first-parent', '-1', '--format=%H', head, '--', source);
        if (candidate && (!change || Number(git('rev-list', '--count', change + '..' + candidate)) > 0)) change = candidate;
      }
      change = requireSha(change);
      const parent = requireSha(git('rev-parse', `${change}^1`));
      const entries = diff(parent, change);
      const result = classify(entries);
      if (result.lane !== 'fast-edge' || result.function_name !== fn || !result.source_changed) throw new Error(`Full release required: ${result.reason || 'no source change'}`);
      validateModes(head, entries);
      console.log(JSON.stringify({ ...result, head, change, parent, files: entries }, null, 2));
    } else throw new Error('Usage: edge-hotfix-policy.mjs classify BASE HEAD | candidate MAIN_SHA FUNCTION');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
