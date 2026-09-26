/**
 * ISSUE 4, END TO END: the customer's empty Phone field and "except for the
 * hood and roof" must survive every hop between the order form and the node
 * receipt, not only the edge's prompt assembly.
 *
 *   app form  ->  gateway v2 input allow-list  ->  runtime requestProofSheet
 *   (the body the worker POSTs)  ->  the REAL production-panel-proof request
 *   section (node 0 intake, the locks, the phase-1 audit, the receipt's intake
 *   block)  ->  transport  ->  sheetOutputFields (what the graph writes to
 *   designpro_atlas_call1_nodes.output.sheet)
 *
 * Real job 9999ec65 (WPW order #30292, 2026-09-25): Phone empty, brief asked
 * for "the business Phone number under the Logo" and "a full wrap except for
 * the hood and roof"; the sheet showed 555-0199 and a wrapped hood and roof.
 * The brief below is synthetic with the same operative phrases (public repo).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { loadDesignIQ, ATLAS_PANELS } from './helpers/load-designiq.mjs';
import { resolveEsbuild } from '../scripts/build-control-prompt.mjs';

const require = createRequire(import.meta.url);
const proof = require('../runtime/atlas-panel-proof-topology.cjs');
const atlas = require('../runtime/flat-first-atlas.cjs');
const graph = require('../runtime/atlas-call1-graph.cjs');
const intakeParse = require('../runtime/atlas-intake-parse.cjs');

const esbuild = input => execFileSync(resolveEsbuild(), ['--loader=ts', '--format=cjs'], {
  input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
});
const proofExports = { exports: {} };
runInNewContext(esbuild(readFileSync(new URL('../supabase/functions/_shared/atlas-panel-proof-prompt.ts', import.meta.url), 'utf8')),
  { module: proofExports, exports: proofExports.exports }, { timeout: 2000 });
const { buildPanelProofPrompt, panelProofCreativeHead, SYSTEM_JOB, SHEET_LAYOUT } = proofExports.exports;

// The real edge, from node 0 (intake) to the provider boundary, plus the
// receipt's own intake expression. Nothing here is a copy of edge logic.
const edge = readFileSync(new URL('../supabase/functions/production-panel-proof/index.ts', import.meta.url), 'utf8');
const start = edge.indexOf('    const customerPrompt = String(body?.customerPrompt || "").trim();');
const end = edge.indexOf('    const parts: Array<Record<string, unknown>> = [{ text: prompt }];', start);
const receiptStart = edge.indexOf('      intake: intake\n', end);
const receiptEnd = edge.indexOf('excludedSurfaces },\n', receiptStart) + 'excludedSurfaces }'.length;
assert.ok(start > 0 && end > start && receiptStart > end && receiptEnd > receiptStart, 'edge seams moved');
const receiptExpr = edge.slice(receiptStart, receiptEnd).replace(/^\s*intake:\s*/, '');
const edgeRequest = esbuild(`(async () => { "use strict"; ${edge.slice(start, end)}
  return { prompt, phase1Audit, intake: ${receiptExpr} }; })()`);

async function runEdge(body) {
  const { buildDesignIQPrompt } = await loadDesignIQ();
  return runInNewContext(edgeRequest, {
    body, buildDesignIQPrompt, buildPanelProofPrompt, panelProofCreativeHead, SYSTEM_JOB, SHEET_LAYOUT, ATLAS_PANELS,
    extractDeterministic: intakeParse.extractDeterministic, mergeIntake: intakeParse.mergeIntake,
    INTAKE_CONTRACT: intakeParse.INTAKE_CONTRACT,
    parseCustomerIntake: async () => { throw new Error('the Flash reader must not run when the company is supplied'); },
  }, { timeout: 4000 });
}

const MANIFEST = atlas.buildAtlasManifest([["driver", 153, 56], ["passenger", 153, 56], ["hood", 71.5, 56],
  ["roof", 74.3, 54.8], ["front", 129, 34], ["rear", 76, 54]].map(([surfaceKey, widthInches, heightInches]) => ({
  surfaceKey, widthInches, heightInches, bleed: { top: 5, right: 5, bottom: 5, left: 5 },
})), undefined, 'truck');

const BRIEF = 'Hello, I need a full wrap except for the hood and roof for my 2010 Ram 1500 crew cab. '
  + 'Black and silver with a bold modern look. Please put the logo big on both doors, '
  + 'and I would like the business Phone number under the Logo. List our services on the tailgate.';

// What the app's generate form sends when the Phone field is left empty: the
// gateway refuses an empty `phone` string, so the form omits the key.
const FORM_INPUT = {
  contractVersion: 'designpro.calls-1-7.v2', mode: 'commercial', brief: BRIEF,
  companyName: 'Mesa Line Hauling', finish: 'Gloss',
  vehicle: { year: '2010', make: 'Ram', model: '1500', type: 'truck' },
};

function gatewayV2Keys() {
  const server = readFileSync(new URL('../gateway/src/server.mjs', import.meta.url), 'utf8');
  const list = server.match(/const CALLS_1_7_V2_KEYS = \[([\s\S]*?)\];/);
  assert.ok(list, 'gateway v2 allow-list moved');
  return new Set([...list[1].matchAll(/"([^"]+)"/g)].map(m => m[1]));
}

async function throughTheWorker(input) {
  const edgeRuns = [];
  const { sheet } = await proof.requestProofSheet({
    manifest: MANIFEST, input, store: { putImmutableBytes: async () => { throw new Error('no customer assets here'); } },
    callProofEdge: async (body) => {
      // What the transport POSTs is JSON: prove the body survives the wire.
      const run = await runEdge(JSON.parse(JSON.stringify(body)));
      edgeRuns.push({ body, ...run });
      const bytes = Buffer.from('sheet');
      return { bytes, contentHash: 'a'.repeat(64), storagePath: 'atlas-panel-proof/a.jpg', byteSize: bytes.length,
        model: 'gemini-3-pro-image', contract: 'designpro.atlas-panel-proof.v1', intake: run.intake };
    },
  });
  return { edge: edgeRuns[0], nodeOutputSheet: graph.sheetOutputFields(sheet) };
}

test('e2e: the empty-phone, hood-and-roof-excluded order reaches the model locked and lands on the node receipt', async () => {
  const allowed = gatewayV2Keys();
  for (const key of Object.keys(FORM_INPUT)) assert.ok(allowed.has(key), `gateway v2 accepts ${key}`);
  assert.equal(allowed.has('email'), false, 'there is no email field; the lock must treat email as unsupplied');

  const { edge: run, nodeOutputSheet } = await throughTheWorker(FORM_INPUT);
  assert.equal(run.body.phone, '', 'the worker sends the empty phone as empty, not a default');
  assert.equal(run.body.customerPrompt, BRIEF, 'the worker sends the brief verbatim');
  assert.equal(run.body.separatedArtwork, undefined, 'the live route is the TriZone sheet');

  const lines = run.prompt.split('\n');
  const contact = lines.find(line => line.startsWith('SUPPLIED CONTACT ONLY:'));
  const coverage = lines.find(line => line.startsWith("WRAP COVERAGE (the customer's brief):"));
  const derivation = lines.find(line => line.startsWith('SURFACE DERIVATION:'));
  assert.match(contact, /supplied no phone number, no email address, no web address\./);
  assert.match(coverage, /Hood and Roof stay unwrapped/);
  assert.match(derivation, /^SURFACE DERIVATION: Derive Driver, Passenger, Front, Rear from that one master concept; Hood and Roof are unwrapped factory paint/);
  assert.doesNotMatch(run.prompt, /\b555\b/);
  for (const [key, value] of Object.entries(run.phase1Audit)) if (key !== 'contract') assert.equal(value, true, key);

  // The node output (designpro_atlas_call1_nodes.output.sheet) carries what code locked.
  assert.equal(nodeOutputSheet.intake.intakeRead, 'skipped:company_name_supplied');
  assert.deepEqual({ ...nodeOutputSheet.intake.contactSupplied }, { phone: false, website: false, email: false });
  assert.deepEqual([...nodeOutputSheet.intake.excludedSurfaces], ['hood', 'roof']);
  assert.equal(nodeOutputSheet.intake.phone || '', '', 'no phone is invented on the receipt either');
});

test('e2e control: a phone typed in the form reaches the model verbatim and is not locked out', async () => {
  const { edge: run, nodeOutputSheet } = await throughTheWorker({ ...FORM_INPUT, phone: '(602) 555-0142',
    brief: 'Full wrap, black and silver, logo big on both doors, phone under the logo.' });
  assert.ok(run.prompt.includes('(602) 555-0142'));
  assert.doesNotMatch(run.prompt, /supplied no phone number/);
  assert.doesNotMatch(run.prompt, /WRAP COVERAGE/);
  assert.match(run.prompt, /SURFACE DERIVATION: Derive Driver, Passenger, Roof, Hood, Front, and Rear/);
  assert.equal(nodeOutputSheet.intake.contactSupplied.phone, true);
  assert.deepEqual([...nodeOutputSheet.intake.excludedSurfaces], []);
});

test('e2e: a revision keeps the original exclusion and the locks (instruction folded after the brief)', async () => {
  const revision = { sequence: 2, instruction: 'make the silver brighter', parentRevisionId: '00000000-0000-4000-8000-000000000002',
    parentProof: { storagePath: 'atlas-panel-proof/p.jpg', contentHash: 'b'.repeat(64), byteSize: 10 } };
  const fields = proof.revisionRequestFields(revision, BRIEF);
  const words = [fields.customerPrompt, fields.prompt].filter(Boolean).join('\n');
  assert.match(words, /except for the hood and roof/, 'the revision request still carries the original brief');
});
