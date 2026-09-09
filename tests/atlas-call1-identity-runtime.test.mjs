import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {generationIdentity,createGenerationWorker}=require('../runtime/generation-worker.cjs');
const claim={requestId:'11111111-1111-4111-8111-111111111111',generationId:'22222222-2222-4222-8222-222222222222',
  atlasRevisionId:'33333333-3333-4333-8333-333333333333',handoffRevisionId:'44444444-4444-4444-8444-444444444444',
  designId:'DID-22222222',atlasIdentityMintedAt:'2026-09-09T06:00:00.000Z',atlasIdentityContract:'designpro.atlas-identity-at-prompt.v2'};

test('worker preserves the two reserved identities and original mint time across claim retries',()=>{
  const identity=generationIdentity(claim);
  assert.deepEqual(identity,{atlasRevisionId:claim.atlasRevisionId,handoffRevisionId:claim.handoffRevisionId,
    designId:claim.designId,atlasIdentityMintedAt:claim.atlasIdentityMintedAt,atlasIdentityContract:claim.atlasIdentityContract});
  assert.deepEqual(generationIdentity({...claim,attempt:2,claimToken:'fresh-lease'}),identity);
});
test('invalid, conflated or cross-generation reservations cannot reach authoring',()=>{
  for(const invalid of [
    {...claim,atlasRevisionId:undefined},{...claim,handoffRevisionId:undefined},{...claim,atlasRevisionId:'invalid'},
    {...claim,handoffRevisionId:claim.atlasRevisionId},{...claim,designId:'DID-OTHER'},
    {...claim,generationId:'55555555-5555-4555-8555-555555555555'},
    {...claim,atlasIdentityMintedAt:undefined},{...claim,atlasIdentityMintedAt:'not-a-date'},
  ])assert.throws(()=>generationIdentity(invalid),error=>error.code==='generation_reserved_identity_invalid'&&!error.retryable);
});
test('historical claims preserve supplied handoff without inventing an artwork reservation or original mint time',()=>{
  const original={requestId:claim.requestId,generationId:claim.generationId};
  const old=generationIdentity(original);
  assert.equal(old.atlasRevisionId,undefined);assert.equal(old.atlasIdentityMintedAt,undefined);
  assert.equal(old.designId,claim.designId);assert.deepEqual(generationIdentity(original),old);
  const v1=generationIdentity({...original,handoffRevisionId:claim.handoffRevisionId,atlasIdentityContract:'designpro.atlas-identity-at-prompt.v1'});
  assert.equal(v1.handoffRevisionId,claim.handoffRevisionId);assert.equal(v1.atlasRevisionId,undefined);
  assert.equal(v1.atlasIdentityMintedAt,undefined);
});

test('the active generation worker uses the v2 claimant without falling back to the legacy RPC',async()=>{
  const calls=[];
  const worker=createGenerationWorker({supabase:{async rpc(name){calls.push(name);return{data:null,error:null};}},
    provider:{},geniePrepService:{async reclaimOne(){return null;}}});
  assert.equal(await worker.tick(),null);
  assert.deepEqual(calls,['claim_designpro_generation_request_v2']);
});
