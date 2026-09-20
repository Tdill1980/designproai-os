import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { authorProofLogo, proofLogoRequested } from '../supabase/functions/_shared/atlas-proof-elements.mjs';
const sharp = createRequire(new URL('../runtime/package.json', import.meta.url))('sharp');
const bytes = await sharp({create:{width:8,height:8,channels:4,background:{r:10,g:20,b:30,alpha:0.5}}}).png().toBuffer();
const payload = {candidates:[{content:{parts:[{inlineData:{data:bytes.toString('base64'),mimeType:'image/png'}}]}}]};
const providerRequest = {requestId:'22222222-2222-4222-8222-222222222222',generationId:'33333333-3333-4333-8333-333333333333',claimToken:'55555555-5555-4555-8555-555555555555'};
function fixture() {
  const files = new Map(); let calls = 0;
  return { get calls(){return calls;}, options:{
    bucket:{async upload(path,value){if(files.has(path))return {error:{message:'already exists'}}; files.set(path,new Uint8Array(value));return {};},
      async download(path){return files.has(path)?{data:new Blob([files.get(path)])}:{error:{message:'Object not found',statusCode:'400'}};}},
    ownerId:'11111111-1111-4111-8111-111111111111',providerRequest,
    input:{companyName:'Bright Smiles',generateLogo:true}, model:'test-image-model',
    buildPrompt:input=>`Exact brand ${input.companyName}`,normalize:async value=>value,
    authorize:async()=>{},invoke:async()=>{calls++;return {status:200,payload};},
  }};
}
test('logo checkpoint resumes identical bytes without a second provider invocation',async()=>{
  const f=fixture(); const first=await authorProofLogo(f.options);
  const resumed=await authorProofLogo({...f.options,providerRequest:{...providerRequest,cacheOnly:true}});
  assert.equal(f.calls,1); assert.equal(resumed.providerCacheHit,true);
  assert.equal(first.contentHash,resumed.contentHash); assert.equal(first.storagePath,resumed.storagePath);
  await assert.rejects(authorProofLogo({...f.options,input:{companyName:'Changed',generateLogo:true}}));
  assert.equal(f.calls,1,'changed prompt cannot silently spend against a previous operation');
});
test('customer logo and absent explicit request never spend a logo call',async()=>{
  const f=fixture();
  for(const input of [{companyName:'Brand'},{companyName:'Brand',generateLogo:false},{companyName:'Brand',generateLogo:true,logoAsset:{storagePath:'original'}}]) {
    assert.equal(await authorProofLogo({...f.options,input}),null);
  }
  assert.equal(f.calls,0);
});

test('Edge checkpoints native encoded logo for runtime processing without pixel decoding',async()=>{
 const f=fixture();
 const asset=await authorProofLogo({...f.options,normalize:undefined});
 assert.equal(asset.needsChromaKey,true);assert.equal(asset.contentType,'image/png');
 assert.equal(asset.contentHash,createRequire(new URL('../runtime/package.json',import.meta.url))('node:crypto').createHash('sha256').update(bytes).digest('hex'));
 assert.equal(f.calls,1);
});

test('only explicit logo requests opt in and negative requests or originals take precedence',()=>{
  assert.equal(proofLogoRequested({customerPrompt:'Create a custom logo for Bright Smiles'}),true);
  for(const customerPrompt of ['Use blue imagery','Do not generate a logo','I want a wrap without a logo','Create a wrap using my existing logo']) {
    assert.equal(proofLogoRequested({customerPrompt}),false);
  }
  assert.equal(proofLogoRequested({generateLogo:true,hasCustomerLogo:true}),false);
});

test('live test briefs opt in with descriptive logo subjects',()=>{
  for (const customerPrompt of [
    'Generate a new custom bicycle-chain logo: an original copper chain-link emblem forming a bicycle wheel with a small wrench motif; do not use stock clip art or an existing brand.',
    'Create an original friendly paw-and-floral logo for Desert Bloom Mobile Pet Grooming.',
    'Create a bold original custom geometric sun-and-lightning logo.',
    'Design a custom sun/lightning logo.',
  ]) assert.equal(proofLogoRequested({customerPrompt}),true,customerPrompt);
  for (const customerPrompt of ['Create a complete wrap with a paw-and-floral logo','Generate artwork using the existing bicycle-chain logo']) {
    assert.equal(proofLogoRequested({customerPrompt}),false,customerPrompt);
  }
});
