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
// THE EXACT PANEL IS IMAGE 1 AND THE DOCUMENT IS IMAGE 2.
//
// This case used to pin `[panelPart, ...targetPart]` -- the whole three-zone
// SHEET first, the exact panel second -- beside an instruction that called
// IMAGE 2 "the PRIMARY artwork authority". The words named the panel and the
// order named the document, and an image model weights the first and largest
// image. The sheet is a white page of eighteen thumbnails plus dimension
// arrows and captions, so the renderer's strongest artwork signal was a
// thumbnail on a spec sheet. That is the drift `atlasContinuityContract=fail`
// convicts: 16 of 16 non-transport proof rejections in the five days to
// 2026-09-20.
test('the exact panel conditions the render first; the sheet is context behind it',()=>{
  const source=readFileSync(new URL('../supabase/functions/persona-photographer-render/index.ts',import.meta.url),'utf8');
  assert.match(source,/const parts = \[\.\.\.\(targetPart \? \[targetPart\] : \[\]\), panelPart,/,
    'the hash-verified panel must be the first image the model sees');
  assert.match(source,/IMAGE 1 is the EXACT finished \$\{surfaceKey\} print panel/);
  assert.match(source,/IMAGE 1 IS THE ARTWORK/);
  assert.match(source,/IMAGE 2 is the full THREE-ZONE PRODUCTION PANEL PROOF document, for context only/);
  assert.match(source,/borrowing a logo, scene, motif or graphic from one of them onto this surface/);
  assert.match(source,/NEVER render any of them on the vehicle/);
  assert.match(source,/targetPanelHash: body.targetPanelHash \|\| null/);
  // A topology with no isolated panel is unchanged: panelPart stays first.
  assert.doesNotMatch(source,/const parts = \[panelPart,/);
});
