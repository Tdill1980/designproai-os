import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway} from '../src/server.mjs';

const owner='11111111-1111-4111-8111-111111111111',generationId='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333',parent='66666666-6666-4666-8666-666666666666';
const identity={atlasRevisionId:'44444444-4444-4444-8444-444444444444',handoffRevisionId:'55555555-5555-4555-8555-555555555555',
  designId:'DID-22222222',atlasIdentityMintedAt:'2026-09-09T06:00:00.123456+00:00',atlasIdentityContract:'designpro.atlas-identity-at-prompt.v2'};
const input={contractVersion:'designpro.calls-1-7-input.v3',pipelineMode:'flat-first-atlas-v1',
  vehicle:{year:'2024',make:'Ford',model:'Transit',type:'van'},brief:'Blue wrap with existing company logo',designName:'Identity fixture'};
const origin='https://os.designproai.com';
const headers={origin,cookie:'dp_session=fixture-session','content-type':'application/json'};
const env={NODE_ENV:'production',SUPABASE_URL:'https://wozyamlnygaddievzuwn.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',
  DESIGNPRO_APP_ORIGIN:origin,DESIGNPRO_RUNTIME_INTERNAL_URL:'http://runtime:8000',WORKER_SECRET:'w'.repeat(64)};
async function fixture(t,returnedIdentity=identity){
  const calls=[];
  const result={requestId,generationId,state:'queued',inputHash:'a'.repeat(64),engineContractHash:'b'.repeat(64),idempotent:false,
    ...returnedIdentity,engineReceipt:{storagePath:'private/artwork.png'},thoughtSignature:'private-signature',privateWorkerToken:'private-token'};
  const server=createGateway({env,fetchImpl:async(url,init)=>{
    const path=new URL(String(url)).pathname;calls.push(path);
    if(path==='/auth/v1/user')return Response.json({id:owner});
    if(path==='/rest/v1/rpc/create_designpro_flat_first_generation_request_v2')return Response.json(result);
    if(path==='/rest/v1/rpc/get_designpro_generation_request')return Response.json({...result,state:'leased',attempt:1,outputSetHash:null,
      failureCode:null,handoffReady:false,handoffBlocker:null,views:[],phase:'designer',shotsComplete:0,shotsTotal:7});
    if(path==='/internal/atlas-revisions/enqueue')return Response.json({...result,parentAtlasRevisionId:parent,revisionSequence:2},{status:202});
    throw new Error(`Unexpected upstream request ${path}`);
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  return {calls,submit:()=>fetch(`${base}/api/generation/requests`,{method:'POST',headers,body:JSON.stringify({generationId,input,requiredPipelineMode:'flat-first-atlas-v1'})}),
    status:()=>fetch(`${base}/api/generation/requests/${requestId}`,{headers}),
    child:()=>fetch(`${base}/api/generation/requests/revisions`,{method:'POST',headers,body:JSON.stringify({generationId,parentAtlasRevisionId:parent,
      parentMasterContentHash:'a'.repeat(64),instruction:'Move existing logo clear of the handle'})})};
}

test('actual HTTP acceptance and polling expose the same saved Call 1 identities without private runtime data',async t=>{
  const h=await fixture(t);
  for(const [send,status] of [[h.submit,202],[h.status,200]]){
    const response=await send();assert.equal(response.status,status);const body=await response.json();
    for(const [key,value] of Object.entries(identity))assert.equal(body[key],value);
    assert.equal(body.generationId,generationId);assert.equal(body.requestId,requestId);
    assert.doesNotMatch(JSON.stringify(body),/private\/artwork|private-signature|private-token|engineReceipt|thoughtSignature/);
  }
  assert.deepEqual(h.calls,['/auth/v1/user','/rest/v1/rpc/create_designpro_flat_first_generation_request_v2','/auth/v1/user','/rest/v1/rpc/get_designpro_generation_request']);
});
test('HTTP identity projection refuses malformed, conflated, incomplete or cross-generation reservations',async t=>{
  for(const invalid of [{...identity,atlasRevisionId:'bad'}, {...identity,atlasRevisionId:identity.handoffRevisionId},
    {...identity,designId:'DID-WRONG'}, {...identity,atlasIdentityMintedAt:null}, {...identity,atlasIdentityMintedAt:'not-a-date'},
    {...identity,handoffRevisionId:null}]){
    const h=await fixture(t,invalid);
    for(const send of [h.submit,h.status]){const response=await send();assert.equal(response.status,502);
      assert.deepEqual(await response.json(),{error:'generation_identity_response_invalid'});}
  }
});
test('historical status remains readable without inventing a missing reservation or mint time',async t=>{
  const h=await fixture(t,{designId:identity.designId,handoffRevisionId:identity.handoffRevisionId,atlasIdentityContract:'designpro.atlas-identity-at-prompt.v1'});
  const response=await h.status();assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.handoffRevisionId,identity.handoffRevisionId);assert.equal(body.atlasRevisionId,undefined);assert.equal(body.atlasIdentityMintedAt,undefined);
});
test('child HTTP intake exposes its distinct saved pair and parent while stripping internal receipt fields',async t=>{
  const h=await fixture(t),response=await h.child();assert.equal(response.status,202);const body=await response.json();
  for(const [key,value] of Object.entries(identity))assert.equal(body[key],value);
  assert.equal(body.parentAtlasRevisionId,parent);assert.equal(body.revisionSequence,2);
  assert.doesNotMatch(JSON.stringify(body),/private\/artwork|private-signature|private-token|engineReceipt|thoughtSignature/);
});

test('fresh original and child admissions refuse an upstream that omitted all reservation metadata',async t=>{
  const h=await fixture(t,{});
  for(const send of [h.submit,h.child]){const response=await send();assert.equal(response.status,502);
    assert.deepEqual(await response.json(),{error:'generation_identity_response_invalid'});}
});
