import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { targetPanelPart, surfacePanelScalePart } from '../supabase/functions/_shared/atlas-proof-target-panel.mjs';

const measured = Object.freeze({sourceAuthorityRole:'surface-panel',panelPrintWidthIn:233,
  panelPrintHeightIn:67.46000000000001,panelTrimWidthIn:223,panelTrimHeightIn:57.46,panelBleedIn:5});
const noDownload = {download(){throw new Error('The entrypoint already downloaded and verified IMAGE 1.');}};

for (const surfaceKey of ['driver','passenger','hood','roof','front','rear']) {
  test(`${surfaceKey}: the current surface route supplies physical scale without another image or read`, async()=>{
    const part=await targetPanelPart({body:measured,surfaceKey,bucket:noDownload});
    assert.equal(typeof part?.text,'string');
    assert.match(part.text,/233 inches wide by 67.46 inches high/);
    assert.match(part.text,new RegExp(`complete ${surfaceKey} wrap panel`));
    assert.match(part.text,/223 by 57.46 inch trim rectangle/);
    assert.match(part.text,/x=2.1459% to x=97.8541%/);
    assert.match(part.text,/full vehicle surface/);
    assert.match(part.text,/then clip/);
    assert.equal(part.inlineData,undefined);
    assert.doesNotMatch(part.text,/BIGFOOT|LEGACY|1980|bright blue/);
  });
}
test('side registration covers fender, doors and bed in one coordinate space',()=>{
  for(const surface of ['driver','passenger']) {
    const text=surfacePanelScalePart(measured,surface).text;
    assert.match(text,/front fender, doors, and rear quarter or outer bed side/);
    assert.match(text,/only a subsection/);
    assert.match(text,/retain their existing relative positions and scale/);
  }
  assert.doesNotMatch(surfacePanelScalePart(measured,'roof').text,/front fender/);
});
test('zero bleed is a real full-panel rectangle, not a missing value',()=>{
  const {text}=surfacePanelScalePart({...measured,panelPrintWidthIn:100,panelPrintHeightIn:50,
    panelTrimWidthIn:100,panelTrimHeightIn:50,panelBleedIn:0},'hood');
  assert.match(text,/100 by 50 inch trim rectangle/);
  assert.match(text,/x=0% to x=100%, and y=0% to y=100%/);
});
test('missing or unusable print dimensions preserve compatibility without fabricated sizes',async()=>{
  for(const missing of [null,undefined,'', '  ',true,[],0,-1,Infinity,NaN]) {
    assert.equal(await targetPanelPart({body:{...measured,panelPrintWidthIn:missing},surfaceKey:'driver',bucket:noDownload}),null);
    assert.equal(await targetPanelPart({body:{...measured,panelPrintHeightIn:missing},surfaceKey:'driver',bucket:noDownload}),null);
  }
});
test('missing, invalid or contradictory bleed does not invent a trim registration',()=>{
  for(const bleed of [undefined,null,'',true,[], -5,Infinity,34]) {
    const {text}=surfacePanelScalePart({...measured,panelBleedIn:bleed},'driver');
    assert.doesNotMatch(text,/TRIM REGISTRATION|NaN|Infinity/);
    assert.match(text,/233 inches wide/);
  }
  assert.doesNotMatch(surfacePanelScalePart({...measured,panelTrimWidthIn:100},'driver').text,/TRIM REGISTRATION/);
});
test('legacy or absent artwork role does not select the current surface registration',async()=>{
  for(const role of [undefined,null,'','three-zone-production-proof','unknown']) {
    assert.equal(surfacePanelScalePart({...measured,sourceAuthorityRole:role},'driver'),null);
  }
  assert.equal(await targetPanelPart({body:{},surfaceKey:'driver',bucket:noDownload}),null);
});
test('whole-sheet mode still returns the exact verified target image and rejects bad identity',async()=>{
  const bytes=Buffer.from('the original rear artwork');
  const hash=createHash('sha256').update(bytes).digest('hex');
  const body={sourceAuthorityRole:'three-zone-production-proof',targetPanelSurfaceKey:'rear',
    targetPanelStoragePath:'panels/rear.png',targetPanelHash:hash,targetPanelContentType:'image/png'};
  const bucket={download:async path=>{assert.equal(path,body.targetPanelStoragePath);return {data:new Blob([bytes])};}};
  const part=await targetPanelPart({body,surfaceKey:'rear',bucket});
  assert.equal(part.text,undefined);
  assert.deepEqual(Buffer.from(part.inlineData.data,'base64'),bytes);
  await assert.rejects(targetPanelPart({body,surfaceKey:'driver',bucket}),/surface_mismatch/);
  await assert.rejects(targetPanelPart({body:{...body,targetPanelHash:'a'.repeat(64)},surfaceKey:'rear',bucket}),/hash_mismatch/);
  await assert.rejects(targetPanelPart({body:{...body,targetPanelStoragePath:null},surfaceKey:'rear',bucket}),/identity_missing/);
});
test('scale changes alter request text without changing the caller or source artwork',()=>{
  const before=JSON.stringify(measured);
  const first=surfacePanelScalePart(measured,'driver');
  const larger=surfacePanelScalePart({...measured,panelPrintWidthIn:250,panelTrimWidthIn:240},'driver');
  assert.notEqual(first.text,larger.text);
  assert.equal(JSON.stringify(measured),before);
  assert.equal(Object.keys(first).join(','),'text');
});
