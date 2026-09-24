import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'wozyamlnygaddievzuwn';
export const FUNCTION = 'production-panel-proof';
export const SOURCE = `supabase/functions/${FUNCTION}/index.ts`;
// EXACT paths only. Never replace these with globs. Keeping fewer than 300
// literal paths also makes GitHub's 300-file path-filter limit fail closed:
// a 300-file subset cannot consist exclusively of this three-file allowlist.
export const FAST_PATHS = Object.freeze([
  SOURCE,
  'tests/production-panel-proof-clean-prompt.test.mjs',
  'tests/edge-hotfix-call1.test.mjs',
]);
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
  for (const { path, status } of entries) {
    if (!FAST_PATHS.includes(path) || !['M', 'A'].includes(status) || (path === SOURCE && status !== 'M')) {
      return { lane: 'full', reason: `protected change: ${status} ${path}` };
    }
  }
  return { lane: 'fast-edge', function_name: FUNCTION, source_changed: entries.some(x => x.path === SOURCE) };
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
      if (fn !== FUNCTION) throw new Error('Function is not approved; no deploy-all option');
      if (git('rev-parse', 'HEAD') !== head) throw new Error('Checkout differs from requested SHA');
      // Scope the most recent MAIN integration that changed this function,
      // not an arbitrary parent selected by an operator. A mixed integration
      // can never be re-labelled as an Edge hotfix by selecting one of its files.
      const change = requireSha(git('log', '--first-parent', '-1', '--format=%H', head, '--', SOURCE));
      const parent = requireSha(git('rev-parse', `${change}^1`));
      const entries = diff(parent, change);
      const result = classify(entries);
      if (result.lane !== 'fast-edge' || !result.source_changed) throw new Error(`Full release required: ${result.reason || 'no source change'}`);
      validateModes(head, entries);
      console.log(JSON.stringify({ ...result, head, change, parent, files: entries }, null, 2));
    } else throw new Error('Usage: edge-hotfix-policy.mjs classify BASE HEAD | candidate MAIN_SHA FUNCTION');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
