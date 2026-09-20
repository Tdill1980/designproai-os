import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { loadDesignIQ, ATLAS_PANELS } from './helpers/load-designiq.mjs';
import { resolveEsbuild } from '../scripts/build-control-prompt.mjs';

const require=createRequire(import.meta.url);
const { buildPanelProofPrompt, panelProofCreativeHead }=require('../runtime/atlas-panel-proof-contract.cjs');
const source=readFileSync(new URL('../supabase/functions/production-panel-proof/index.ts',import.meta.url),'utf8');
const start=source.indexOf('    const customerAssets =');
const end=source.indexOf('    const parts: Array<Record<string, unknown>> = [{ text: prompt }];',start);
assert.ok(start>0 && end>start);
const assembly=execFileSync(resolveEsbuild(),['--loader=ts','--format=cjs'],{
  input:`(() => {${source.slice(start,end)}\nreturn {prompt,customerAssets};})()`,encoding:'utf8',stdio:['pipe','pipe','pipe'],
});
const PERSONA='ROLE: Senior commercial vehicle-wrap artwork designer. OUTPUT: six clean printed background artworks for deterministic placement into the customer\'s six vehicle panel cells.';
const BODY={separatedArtwork:true,companyName:'Precision Climate Solutions',phone:'(520) 555-0192',website:'precisionclimate.example',
  creativeDirection:'Deep blue base with sunrise-orange airflow ribbons sweeping front to rear, rich landscape photography.',
  fontStyle:'bold condensed',brandColors:'#06284A, #FF7A18',finish:'Gloss',industryType:'HVAC',
  vehicleYear:'2022',vehicleMake:'Ford',vehicleModel:'F250 Crew Cab',vehicleType:'truck'};
async function assemble(body={}) {
  const request={...BODY,...body};
  const {buildDesignIQPrompt}=await loadDesignIQ();
  return runInNewContext(assembly,{body:request,field:name=>String(request[name]||'').trim(),
    customerPrompt:'',intake:null,panelRows:[],buildDesignIQPrompt,buildPanelProofPrompt,panelProofCreativeHead,ATLAS_PANELS});
}

test('active separated Call 1 injects exact persona and omits contradictory branded generation directions',async()=>{
  const {prompt}=await assemble();
  assert.ok(prompt.startsWith(PERSONA+'\n\n'));
  assert.match(prompt,/CONTENT SCOPE:/);
  assert.match(prompt,/ARTWORK STAGING CANVAS/);
  assert.match(prompt,/six rectangular cells in its green ZONE 2 row/);
  assert.match(prompt,/Bright Smiles finished three-zone example/);
  assert.match(prompt,/native Gemini 3 Pro Image design knowledge/);
  assert.match(prompt,/Brand colors: #06284A, #FF7A18/);
  assert.match(prompt,/rich landscape photography/);
  assert.doesNotMatch(prompt,/ZONE 1 — Background copies|ZONE 2 — Authoritative backgrounds only|ZONE 3 — Reserved for original vector cut graphics/);
  assert.match(prompt,/Zone 1 combines these backgrounds with protected original customer branding/);
  assert.match(prompt,/Return the six clean background artworks on the staging canvas/);
  for (const negativeDirective of [/\\bDO NOT\\b/i,/\\bNEVER\\b/i,/\\bNO\\s+(?:TEXT|LOGO|TYPOGRAPHY|HEADERS|BORDERS)\\b/i]) {
    assert.doesNotMatch(prompt, negativeDirective, 'active separated Call-1 instructions use positive scope rather than negative directives');
  }
  assert.doesNotMatch(prompt,/EXACT TEXT, character for character|ZONE 3'S FIVE BOXES, every one filled|Spell the business name|Typography preference:|The company name reads clearly|SMALL PANELS.*carry the logo/);
  for(const protectedCopy of [BODY.companyName,BODY.phone,BODY.website])assert.ok(!prompt.includes(protectedCopy));
});

test('exact-reference guidance is restricted to backgrounds, and protected originals never enter image attachments',async()=>{
  const reference={storagePath:`atlas-call1-inputs/${'a'.repeat(64)}.png`,contentHash:'a'.repeat(64)};
  const logo={storagePath:`users/owner/revisions/revision/inputs/logo/${'b'.repeat(64)}.svg`,contentHash:'b'.repeat(64),contentType:'image/svg+xml'};
  const {prompt,customerAssets}=await assemble({visionboard_intent:'exact_reference',logoAsset:logo,customerAssets:[
    reference,logo,
    {storagePath:`atlas-call1-inputs/${'b'.repeat(64)}.png`,contentHash:logo.contentHash},
    {storagePath:`atlas-call1-inputs/${'c'.repeat(64)}.png`,assetRole:'logo'},
    {storagePath:`atlas-call1-inputs/${'d'.repeat(64)}.png`,role:'typography'},
    {storagePath:`atlas-call1-inputs/${'e'.repeat(64)}.png`,contentType:'application/pdf'},
  ]});
  assert.equal(customerAssets.length,1);assert.equal(customerAssets[0].storagePath,reference.storagePath);
  assert.match(prompt,/EXACT REFERENCE:/);
  assert.match(prompt,/Recreate only its background colors/);
  assert.doesNotMatch(prompt,/Recreate its colors, patterns, typography, logos/);
  assert.match(source,/for \(const asset of customerAssets\)/,'the image attachment loop consumes the filtered set');
});

test('legacy non-separated probe retains the existing branded prompt contract',async()=>{
  const {prompt}=await assemble({separatedArtwork:false});
  assert.match(prompt,/Spell the business name exactly/);
  assert.ok(prompt.includes(BODY.companyName));
  assert.match(prompt,/ZONE 3'S FIVE BOXES, every one filled/);
});
