// Local, nonspending cache benchmark. Reads generated PNG fixtures and writes
// only a throwaway filesystem bucket. Does not call Supabase, Gemini or auth.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const { values: args } = parseArgs({ options: { 'output-png': { type: 'string' }, 'reference-png': { type: 'string' }, baseline: { type: 'string', default: '7eb2fb9' }, child: { type: 'string' } } });
if (!args['output-png'] || !args['reference-png'] || !/^[0-9a-f]{7,40}$/.test(args.baseline)) throw new Error('Supply --output-png, --reference-png and an optional hex --baseline commit');
const helper = 'supabase/functions/_shared/gemini-provider-cache.mjs';
if (!args.child) {
  for (const version of ['previous', 'candidate']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--child', version], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.status) process.exitCode = result.status;
  }
} else {
  const version = args.child;
  if (!['previous', 'candidate'].includes(version)) throw new Error('Invalid benchmark version');
  const imported = version === 'previous'
    ? await import(`data:text/javascript;base64,${execFileSync('git', ['show', `${args.baseline}:${helper}`], { cwd: repo }).toString('base64')}`)
    : await import(pathToFileURL(join(repo, helper)).href);
  const input = { contents: [{ role: 'user', parts: [
    { text: 'Original customer brief — 界 🪶; unchanged native model settings' },
    { inlineData: { mimeType: 'image/png', data: (await readFile(resolve(args['reference-png']))).toString('base64') } },
  ] }], generationConfig: { imageConfig: { imageSize: '4K' }, responseModalities: ['TEXT', 'IMAGE'] } };
  const privateRequest = JSON.stringify(input);
  const payload = { candidates: [{ content: { role: 'model', parts: [
    { thought: true, text: 'Complete native private thought — 界 🪶', thoughtSignature: 'native-thought-signature' },
    { inlineData: { mimeType: 'image/png', data: (await readFile(resolve(args['output-png']))).toString('base64') }, thoughtSignature: 'native-image-signature' },
  ] } }] };
  const root = await mkdtemp(join(tmpdir(), 'atlas-cache-resource-'));
  let observedRss = process.memoryUsage().rss;
  let storedBytes = 0;
  let chunkCount = 0;
  const observe = () => { observedRss = Math.max(observedRss, process.memoryUsage().rss); };
  const bucket = {
    async upload(path, bytes, options) {
      observe();
      if (options.upsert !== false) throw new Error('immutable writes required');
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
      storedBytes += bytes.length;
      if (path.endsWith('.jsonpart')) chunkCount += 1;
      observe();
      return { data: { path }, error: null };
    },
    async download(path) {
      try { return { data: new Blob([await readFile(join(root, path))]), error: null }; }
      catch (error) { if (error.code === 'ENOENT') return { error: { statusCode: 404 } }; throw error; }
    },
  };
  let calls = 0;
  const start = process.cpuUsage();
  const wall = performance.now();
  try {
    await imported.runDurableImageProviderRequest({ bucket, identity: {
      ownerId: '11111111-1111-4111-8111-111111111111', requestId: '22222222-2222-4222-8222-222222222222',
      generationId: '33333333-3333-4333-8333-333333333333', mode: 'atlas-artboard', attemptKey: 'master:1',
    }, requestHash: 'a'.repeat(64), outputRequestId: '44444444-4444-4444-8444-444444444444',
    authorize: async () => {}, privateRequest, invoke: async () => { calls += 1; return { status: 200, payload }; } });
    observe();
    const cpu = process.cpuUsage(start);
    console.log(JSON.stringify({ version, dimensions: '4096x4096', providerCalls: 0, mockInvocations: calls,
      outputPngBytes: Buffer.from(payload.candidates[0].content.parts[1].inlineData.data, 'base64').length,
      inputReferencePngBytes: Buffer.from(input.contents[0].parts[1].inlineData.data, 'base64').length,
      chunkCount, storedBytes, persistenceCpuMs: Math.round((cpu.user + cpu.system) / 1000),
      persistenceWallMs: Math.round(performance.now() - wall), observedPersistenceRssMiB: Math.round(observedRss / 1048576),
      processMaxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }));
  } finally { await rm(root, { recursive: true, force: true }); }
}
