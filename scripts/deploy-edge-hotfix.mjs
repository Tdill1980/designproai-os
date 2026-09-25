// Deploy exactly one reviewed Edge function; never touch the droplet, secrets,
// migrations or another function. All deployed files are read back and hashed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { APPROVED, PROJECT, requireSha } from './edge-hotfix-policy.mjs';
import { collectEdgeSourceFiles } from './edge-source-closure.mjs';
const root = process.cwd();
const sha = requireSha(process.env.EXACT_MAIN_SHA);
const FUNCTION = process.env.FUNCTION_NAME;
const SPEC = APPROVED[FUNCTION];
if (!SPEC) throw new Error('Function is not allowlisted');
const SOURCE = SPEC.sources[0];
if (process.env.CONFIRMATION !== 'DEPLOY_EDGE_TO_DESIGNPROAI_PRODUCTION') throw new Error('Production confirmation missing');
if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Dispatch must run from main');
for (const name of ['GH_TOKEN', 'SUPABASE_ACCESS_TOKEN', 'ESBUILD_BIN', 'SUPABASE_BIN', 'GITHUB_REPOSITORY', 'EDGE_TYPESCRIPT_PATH']) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}
const run = (bin, args, cwd = root) => execFileSync(bin, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const cli = (...args) => run(process.env.SUPABASE_BIN, args);
const digest = data => createHash('sha256').update(data).digest('hex');
const work = mkdtempSync(join(tmpdir(), 'designpro-edge-'));
const auditDir = process.env.EDGE_AUDIT_DIR || join(process.env.RUNNER_TEMP || tmpdir(), 'edge-hotfix-audit');
mkdirSync(auditDir, { recursive: true });
const receipt = { project: PROJECT, function: FUNCTION, source_sha: sha, started_at: new Date().toISOString(), status: 'not-deployed' };
function record() { writeFileSync(join(auditDir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); }
async function currentMain() {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(process.env.GITHUB_REPOSITORY)) throw new Error('Invalid repository');
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/branches/main`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Cannot resolve current main: HTTP ${response.status}`);
  if ((await response.json()).commit?.sha !== sha) throw new Error('Main moved; rerun with its exact current SHA');
}
function metadata() {
  const list = JSON.parse(cli('functions', 'list', '--project-ref', PROJECT, '--output', 'json'));
  if (!Array.isArray(list)) throw new Error('Unexpected function metadata shape');
  const matches = list.filter(x => x.slug === FUNCTION || x.name === FUNCTION);
  if (matches.length !== 1) throw new Error('Existing function was not uniquely resolved');
  const f = matches[0];
  if (typeof f.verify_jwt !== 'boolean' || !Number.isInteger(f.version)) throw new Error('Missing explicit JWT policy/version');
  return { id: f.id, slug: f.slug || f.name, version: f.version, status: f.status, verify_jwt: f.verify_jwt, updated_at: f.updated_at };
}
function download(destination) {
  mkdirSync(join(destination, 'supabase'), { recursive: true });
  writeFileSync(join(destination, 'supabase/config.toml'), 'project_id = "designproai-edge-readback"\n');
  cli('functions', 'download', FUNCTION, '--project-ref', PROJECT, '--use-api', '--workdir', destination);
}
try {
  await currentMain();
  const candidate = JSON.parse(run(process.execPath, ['scripts/edge-hotfix-policy.mjs', 'candidate', sha, FUNCTION]));
  receipt.change_sha = candidate.change;
  if (run('git', ['status', '--porcelain', '--untracked-files=all', '--', 'supabase/functions', 'scripts/edge-hotfix-policy.mjs', 'scripts/deploy-edge-hotfix.mjs', 'scripts/edge-source-closure.mjs']).trim()) {
    throw new Error('Dirty source checkout; deploy only immutable Git content');
  }
  // Keep the isolated build, but do not use optimized inputs as the raw-source
  // upload manifest: TypeScript import elision can omit syntactic dependencies.
  const metafile = join(work, 'bundle.json');
  run(process.env.ESBUILD_BIN, [SOURCE, '--bundle', '--format=esm', '--platform=neutral', '--target=es2022',
    '--external:https://*', '--external:http://*', '--external:npm:*', '--external:jsr:*', '--external:node:*',
    `--metafile=${metafile}`, `--outfile=${join(work, 'function.mjs')}`]);
  const optimizedFiles = Object.keys(JSON.parse(readFileSync(metafile, 'utf8')).inputs);
  const rawFiles = collectEdgeSourceFiles({ root, entrypoints: SPEC.sources });
  const files = [...new Set([...rawFiles, ...optimizedFiles])].sort();
  receipt.source_graph = 'raw-typescript-import-closure-v1';
  for (const source of SPEC.sources) if (!files.includes(source)) throw new Error(`Owned source absent from build graph: ${source}`);
  const stamp = 'supabase/functions/_shared/release-source.ts';
  const hasStamp = files.includes(stamp);
  for (const file of files) {
    run('git', ['ls-files', '--error-unmatch', '--', file]);
    if (!file.startsWith(`supabase/functions/${FUNCTION}/`) && !file.startsWith('supabase/functions/_shared/') && !file.startsWith('supabase/functions/generate-wall-design/')) throw new Error(`Protected dependency: ${file}`);
    if (file.split('/').includes('..') || !lstatSync(join(root, file)).isFile() || lstatSync(join(root, file)).isSymbolicLink()) throw new Error(`Unsafe source path: ${file}`);
  }
  const before = metadata();
  receipt.before = before;
  const previous = join(work, 'previous');
  download(previous);
  // An unchanged shared dependency may be bundled, but not silently upgraded.
  // This also catches undeployed shared changes on main after the selected PR.
  for (const file of files.filter(x => !SPEC.sources.includes(x) && x !== stamp)) {
    const deployed = join(previous, file);
    if (!existsSync(deployed) || digest(readFileSync(deployed)) !== digest(readFileSync(join(root, file)))) {
      throw new Error(`Shared dependency differs from production; full release required: ${file}`);
    }
  }
  const stage = join(work, 'stage');
  for (const file of files) {
    const target = join(stage, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file), target);
  }
  // Stamp source identity only when this function already imports the shared
  // identity module. Do not mutate unrelated function source to add provenance.
  if (hasStamp) writeFileSync(join(stage, stamp), `export const RELEASE_SOURCE_SHA = "${sha}";\n`);
  writeFileSync(join(stage, 'supabase/config.toml'),
    `project_id = "designproai-edge-hotfix"\n[functions.${FUNCTION}]\nverify_jwt = ${before.verify_jwt}\nentrypoint = "./functions/${FUNCTION}/index.ts"\n`);
  // Re-parse the exact files being uploaded; missing imports fail before write.
  const stagedRawFiles = collectEdgeSourceFiles({ root: stage, entrypoints: SPEC.sources });
  if (JSON.stringify(stagedRawFiles) !== JSON.stringify(rawFiles)) throw new Error('Staged source graph differs from checkout');
  receipt.files = Object.fromEntries(files.map(file => [file, digest(readFileSync(join(stage, file)))]));
  receipt.auth_policy_preserved = before.verify_jwt;
  await currentMain();
  const lockedBefore = metadata();
  if (lockedBefore.version !== before.version || lockedBefore.verify_jwt !== before.verify_jwt) throw new Error('Function changed during preflight; retry');
  record();
  // A literal, validated function name is ALWAYS supplied. No deploy-all path.
  cli('functions', 'deploy', FUNCTION, '--project-ref', PROJECT, '--use-api', '--workdir', stage);
  receipt.status = 'deployed-awaiting-verification'; record();
  const deployed = join(work, 'deployed');
  download(deployed);
  const after = metadata();
  if (after.id !== before.id || after.slug !== before.slug || after.version <= before.version || after.status !== 'ACTIVE' || after.verify_jwt !== before.verify_jwt) {
    throw new Error('Deployed identity/version/JWT policy failed readback');
  }
  for (const [file, hash] of Object.entries(receipt.files)) {
    const path = join(deployed, file);
    if (!existsSync(path) || digest(readFileSync(path)) !== hash) throw new Error(`Deployed source mismatch: ${file}`);
  }
  // OPTIONS does not generate an image or spend provider credits.
  const smoke = await fetch(`https://${PROJECT}.supabase.co/functions/v1/${FUNCTION}`, {
    method: 'OPTIONS', signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  if (smoke.status !== 200 || (hasStamp && smoke.headers.get('x-designpro-source-sha') !== sha)) {
    throw new Error('Live identity smoke test failed');
  }
  receipt.after = after;
  receipt.files_verified = true;
  receipt.jwt_policy_preserved = true;
  receipt.live_header_verified = hasStamp ? true : 'not-available-this-function';
  receipt.status = 'deployed-and-verified';
  receipt.finished_at = new Date().toISOString(); record();
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY,
    `\n### Selected Edge function verified\nFunction: ${FUNCTION}\nSource SHA: ${sha}\nVersion: ${after.version}\nFile hashes: verified\nAuth/JWT: unchanged\nRuntime, gateway, database, droplet and other functions: untouched\n`, { flag: 'a' });
} catch (error) {
  receipt.status = receipt.status === 'deployed-awaiting-verification' ? 'deployed-verification-failed' : 'not-deployed';
  receipt.error = String(error.message || error); record(); throw error;
} finally {
  rmSync(work, { recursive: true, force: true });
}
