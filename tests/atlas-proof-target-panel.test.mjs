import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { targetPanelPart } from '../supabase/functions/_shared/atlas-proof-target-panel.mjs';
const bytes=Buffer.from('exact persisted rear panel');
const hash=createHash('sha256').update(bytes).digest('hex');
const body={sourceAuthorityRole:'three-zone-production-proof',targetPanelSurfaceKey:'rear',
  targetPanelStoragePath:'panels/rear.png',targetPanelHash:hash,targetPanelContentType:'image/png'};
const bucket={download:async path=>{assert.equal(path,'panels/rear.png');return {data:new Blob([bytes])};}};
test('target surface crop is immutable and hash-verified before image conditioning',async()=>{
  const part=await targetPanelPart({body,surfaceKey:'rear',bucket});
  assert.equal(part.inlineData.data,bytes.toString('base64'));
  await assert.rejects(targetPanelPart({body,surfaceKey:'driver',bucket}),/surface_mismatch/);
  await assert.rejects(targetPanelPart({body:{...body,targetPanelHash:'a'.repeat(64)},surfaceKey:'rear',bucket}),/hash_mismatch/);
  await assert.rejects(targetPanelPart({body:{...body,targetPanelStoragePath:null},surfaceKey:'rear',bucket}),/identity_missing/);
});
test('full production sheet remains present alongside primary target crop',()=>{
  const source=readFileSync(new URL('../supabase/functions/persona-photographer-render/index.ts',import.meta.url),'utf8');
  assert.match(source,/const parts = \[panelPart, \.\.\.\(targetPart \? \[targetPart\] : \[\]\)/);
  assert.match(source,/PRIMARY artwork authority/);
  assert.match(source,/Do not borrow logos, gears, motifs or scenes from other panels/);
  assert.match(source,/targetPanelHash: body.targetPanelHash \|\| null/);
});
