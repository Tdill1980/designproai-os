import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const file = 'supabase/functions/production-panel-proof/index.ts';
assert.equal(execFileSync('git', ['hash-object', file], {encoding:'utf8'}).trim(), 'fe3d5d11e33dc0fdb655744edba4592f30be260d', 'stop if the source changed; never overwrite another session');
const original = readFileSync(file, 'utf8');
let source = original;
function replaceOnce(before, after) {
  assert.equal(source.split(before).length, 2, `expected one patch target: ${before.slice(0,90)}`);
  source = source.replace(before, after);
}
replaceOnce('    prompt = [\n      creativeHead,\n', '    const flatProductionInstructions = [\n');
replaceOnce('    ].join("\\n\\n");\n    // PHASE 1 PAYLOAD CONTRACT', '    ];\n    let prompt = [creativeHead, ...flatProductionInstructions].join("\\n\\n");\n    // PHASE 1 PAYLOAD CONTRACT');
const start = source.indexOf('    const phase1Audit = {');
const end = source.indexOf('    const missingPhase1 = ', start);
assert.ok(start > 0 && end > start);
source = source.slice(0, start) + `    // Compare the emitted payload with the actual selected DesignIQ head.
    // A persona wording change must not break startup, while dropping the
    // designer or any output instruction must still fail before the provider.
    const designerIdentity = creativeHead.split(/\\n\\s*\\n/)[0].trim();
    const nativeKnowledgeInstruction = creativeHead.split("\\n")
      .find(line => /\\bnative\\b.*\\bknowledge\\b|DESIGN AMPLIFICATION:/i.test(line));
    const phase1Audit = {
      contract: "designpro.vehiclepro.phase1.graphic-designer-flat-first-opaque-edge.v1",
      graphicDesignerPersonaInjected:
        /^You are\\b/i.test(designerIdentity) && /\\bdesigner\\b/i.test(designerIdentity)
        && prompt.startsWith(creativeHead + "\\n\\n"),
      nativeGeminiImageKnowledgeInjected:
        Boolean(nativeKnowledgeInstruction && prompt.includes(nativeKnowledgeInstruction)),
      flatPanelProductionProofInjected:
        flatProductionInstructions.length === 5 && prompt.includes(flatProductionInstructions[0]),
      templateLayoutLocked:
        flatProductionInstructions.slice(1).every(instruction => prompt.includes(instruction)),
    };
` + source.slice(end);
const oldArray = original.slice(original.indexOf('    prompt = [\n      creativeHead,\n') + '    prompt = [\n      creativeHead,\n'.length);
const oldInstructions = oldArray.slice(0, oldArray.indexOf('    ].join("\\n\\n");'));
const newArray = source.slice(source.indexOf('    const flatProductionInstructions = [\n') + '    const flatProductionInstructions = [\n'.length);
assert.equal(newArray.slice(0, newArray.indexOf('    ];')), oldInstructions, 'output prompt instructions remain byte-identical');
writeFileSync(file, source);

// #645 changed the selected persona, but both guards still required its old
// opening. Accept the explicit old and new identities; keep the required
// output seam and missing-persona rejection. These probes emit no prompt text.
const twins = [
  ['runtime/atlas-panel-proof-contract.cjs', 'bf71eaf8a411e34b0e5023f89b5c222a88b8c62e'],
  ['supabase/functions/_shared/atlas-panel-proof-prompt.ts', '1f406f4239a346579050464f9e43f18a592ea23a'],
];
const oldGuard = String.raw`if (!/senior graphic designer and vehicle-wrap specialist|You are WePrintWraps\.com Lead Vehicle Wrap Designer/.test(head)) {`;
const newGuard = String.raw`if (!/^(?:You are (?:the |a )?senior (?:professional )?graphic designer and vehicle-wrap specialist|You are WePrintWraps\.com Lead Vehicle Wrap Designer)\b/.test(head)) {`;
for (const [path, sha] of twins) {
  assert.equal(execFileSync('git', ['hash-object', path], {encoding:'utf8'}).trim(), sha, path);
  const text = readFileSync(path, 'utf8');
  assert.equal(text.split(oldGuard).length, 2, path + ': guard seam');
  writeFileSync(path, text.replace(oldGuard, newGuard));
}
const parityPath = 'tests/designiq-shared-assembly.test.mjs';
let parity = readFileSync(parityPath, 'utf8');
assert.equal(execFileSync('git', ['hash-object', parityPath], {encoding:'utf8'}).trim(), '619f1c7443cf917d5505c093de487e35041376ad');
parity = parity.replaceAll('/senior graphic designer and vehicle-wrap specialist/', '/senior (?:professional )?graphic designer and vehicle-wrap specialist/');
parity = parity.replace('/native Gemini 3 Pro Image design knowledge/', '/native (?:Gemini 3 Pro Image )?design knowledge/');
writeFileSync(parityPath, parity);

let tests = readFileSync('tests/call1-startup-latency.test.mjs','utf8');
tests += `

test('protected originals stay out of the image attachments; customer references remain', async () => {
  const reference = {storagePath: 'atlas-call1-inputs/' + 'a'.repeat(64) + '.png', contentHash: 'a'.repeat(64)};
  const logo = {storagePath: 'users/owner/revisions/revision/inputs/logo/' + 'b'.repeat(64) + '.svg', contentHash: 'b'.repeat(64), contentType: 'image/svg+xml'};
  const {customerAssets} = await assemble({logoAsset: logo, customerAssets: [reference, logo,
    {storagePath: 'atlas-call1-inputs/' + 'b'.repeat(64) + '.png', contentHash: logo.contentHash},
    {storagePath: 'atlas-call1-inputs/' + 'c'.repeat(64) + '.png', assetRole: 'logo'},
    {storagePath: 'atlas-call1-inputs/' + 'd'.repeat(64) + '.png', role: 'typography'},
    {storagePath: 'atlas-call1-inputs/' + 'e'.repeat(64) + '.png', contentType: 'application/pdf'},
  ]});
  assert.equal(customerAssets.length, 1);
  assert.equal(customerAssets[0].storagePath, reference.storagePath);
  assert.match(source, /for \\(const asset of customerAssets\\)/);
});

test('separated artwork cannot fall back to a labelled container or a full proof example', () => {
  assert.ok(source.includes('mode: body.separatedArtwork === true ? "artwork" : "template"'));
  assert.ok(source.includes('for (const pinned of (body.separatedArtwork === true ? [] : PINNED_INPUTS))'));
  assert.ok(source.includes('if (body.separatedArtwork === true) throw renderError'));
});
`;
writeFileSync('tests/production-panel-proof-clean-prompt.test.mjs', tests);
unlinkSync('tests/call1-startup-latency.test.mjs');
// Stage the additional guard twins for the runner's single tested branch commit.
execFileSync('git', ['add', ...twins.map(([path]) => path), parityPath]);
console.log('Patched local prompt declaration and current-persona audit. Exact designer and output text unchanged.');
