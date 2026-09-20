import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('edge release checks a successful exact main SHA before deploying and verifies compiled identity', () => {
  const workflow = read('.github/workflows/deploy-edge-functions.yml');
  assert.match(workflow, /ref: \$\{\{ inputs\.exact_sha \}\}/);
  assert.match(workflow, /git merge-base --is-ancestor "\$EXACT_SHA" origin\/main/);
  assert.match(workflow, /actions\/workflows\/release\.yml\/runs/);
  assert.match(workflow, /\.head_sha == \$sha and \.head_branch == "main" and \.conclusion == "success"/);
  assert.ok(workflow.indexOf('release-source.ts') < workflow.indexOf('supabase functions deploy'));
  assert.match(workflow, /test "\$actual" = "\$EXACT_SHA"/);
  for (const name of ['design-panel-ai-generate', 'production-panel-proof', 'persona-photographer-render']) {
    const edge = read(`supabase/functions/${name}/index.ts`);
    assert.match(edge, /import \{ RELEASE_SOURCE_SHA \} from "\.\.\/_shared\/release-source\.ts"/);
    assert.match(edge, /"X-DesignPro-Source-Sha": RELEASE_SOURCE_SHA/);
  }
});

test('acceptance verifies full app and gateway SHA in addition to both runtime commits', () => {
  const acceptance = read('ops/acceptance.sh');
  assert.match(acceptance, /h\.get\("commit"\) == os\.environ\["EXPECTED"\]/);
  assert.match(acceptance, /h\.get\("sourceSha"\) == os\.environ\["EXPECTED"\]/);
  assert.match(acceptance, /\$public\/release\.json/);
  assert.match(acceptance, /json\.loads\(os\.environ\["BODY"\]\)\.get\("sourceSha"\) == os\.environ\["EXPECTED"\]/);
  assert.match(read('app/vite.config.ts'), /fileName: "release\.json"/);
});

test('live acceptance is one explicit case behind the full release gate, with failure artifacts retained', () => {
  const workflow = read('.github/workflows/vehiclepro-recovery-acceptance.yml');
  assert.match(workflow, /options: \[A, B, C\]/);
  assert.doesNotMatch(workflow, /strategy:|matrix:|Precision Climate Solutions|Bright Smiles/);
  assert.match(workflow, /\.head_sha == \$sha and \.head_branch == "main" and \.conclusion == "success"/);
  assert.equal((workflow.match(/"\$image" node \/app\/vehiclepro-live-prompt-test\.mjs/g) || []).length, 1);
  assert.match(workflow, /--source-sha "\$EXPECTED_SHA"/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /path: recovery-evidence\/\*\*/);
  assert.match(workflow, /technical evidence only/);
});
