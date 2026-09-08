import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../src/server.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GENERATION='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REVISION='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ATLAS='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const RUN='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const env={NODE_ENV:'test',SUPABASE_URL:'https://dp-project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_test',
  DESIGNPRO_RUNTIME_INTERNAL_URL:'http://runtime:8000',WORKER_SECRET:'w'.repeat(40)};
async function start(t,fetchImpl){
  const server=createGateway({env,fetchImpl});t.after(()=>server.close());
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;
}
const headers={cookie:'dp_session=test-token','content-type':'application/json'};

test('PPO capabilities query resolves only the authenticated reviewer and accepts no actor override',async t=>{
  let forwarded;
  const base=await start(t,async(url,init)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:OWNER});
    forwarded={url,body:JSON.parse(init.body)};
    return Response.json({canPrepare:true,canReview:true,enabled:false});
  });
  const response=await fetch(`${base}/api/panelpro-file-output/capabilities?ownerId=${REVISION}`,{headers});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{canPrepare:true,canReview:true,enabled:false});
  assert.deepEqual(forwarded,{url:'http://runtime:8000/internal/panelpro-file-output/capabilities',body:{ownerId:OWNER,payload:{}}});
});

test('saved-version proofs resolve the exact ATLAS and retain the seventh camera without current-view fallback',async t=>{
  const calls=[];let mismatched=false;
  const pairs=[['side','driver'],['passenger-side','passenger'],['hood_detail','hood'],['roof','roof'],['front','front'],['rear','rear'],['close-up','closeup']];
  const base=await start(t,async(url,init)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:OWNER});
    if(url.includes('/designpro_workflow_runs?'))return Response.json([]);
    calls.push(url);
    if(url.endsWith('/rpc/designpro_atlas_revision_workspace')) {
      assert.deepEqual(JSON.parse(init.body),{p_generation_id:GENERATION,p_atlas_revision_id:ATLAS});
      return Response.json({generationId:GENERATION,ownerId:OWNER,atlasRevisionId:ATLAS,masterContentHash:'a'.repeat(64),viewsSuperseded:false,
        views:pairs.map(([sourceViewType,consumerRole],i)=>({sourceViewType,consumerRole,contentHash:'b'.repeat(64),contentType:'image/png',byteSize:100,
          storagePath:`designpro/user_${OWNER}/${GENERATION}/calls-1-7/${i}.png`,atlasRevisionId:ATLAS,atlasMasterContentHash:mismatched?'c'.repeat(64):'a'.repeat(64)}))});
    }
    if(url.includes('/storage/v1/object/sign/wrap-files/'))return Response.json({signedURL:'/object/sign/wrap-files/proof?token=test'});
    throw new Error('must not read current workspace or current refusals');
  });
  const path=`${base}/api/jobs/${GENERATION}/approved-views?atlasRevisionId=${ATLAS}`;
  const response=await fetch(path,{headers});assert.equal(response.status,200);
  const proofs=await response.json();assert.equal(proofs.length,7);assert.equal(proofs[6].surfaceKey,'closeup');
  assert.ok(proofs.every(proof=>proof.atlasBinding.revisionId===ATLAS));
  assert.equal(calls.filter(url=>url.includes('/object/sign/')).length,7);
  calls.length=0;mismatched=true;
  const corrupt=await fetch(path,{headers});assert.equal(corrupt.status,502);
  assert.equal(calls.some(url=>url.includes('/object/sign/')),false);
  assert.equal((await fetch(`${base}/api/jobs/${GENERATION}/approved-views?atlasRevisionId=bad`,{headers})).status,400);
});

test('revision request state carries exact lineage and a fixed handoff attention code only',async t=>{
  const base=await start(t,async(url)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:OWNER});
    if(url.endsWith('/rpc/get_designpro_generation_request'))return Response.json({requestId:RUN,generationId:GENERATION,state:'leased',
      inputHash:'a'.repeat(64),engineContractHash:'b'.repeat(64),attempt:1,outputSetHash:null,failureCode:null,
      handoffReady:false,handoffBlocker:null,views:[],parentAtlasRevisionId:ATLAS,revisionSequence:4,
      revisionHandoffError:{message:'private SQLERRM path'}});
    throw new Error('unexpected route');
  });
  const response=await fetch(`${base}/api/generation/requests/${RUN}`,{headers});assert.equal(response.status,200);
  const value=await response.json();assert.equal(value.parentAtlasRevisionId,ATLAS);assert.equal(value.revisionSequence,4);
  assert.deepEqual(value.revisionHandoffError,{code:'revision_preparation_needs_attention'});
  assert.doesNotMatch(JSON.stringify(value),/SQLERRM|private/);
});

test('PPO proxy resolves its actor from authenticated session and preserves exact input identity',async t=>{
  const calls=[];
  const base=await start(t,async(url,init)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:OWNER,email:'qc@example.test'});
    calls.push({url,init});return Response.json({accepted:true},{status:202});
  });
  const response=await fetch(`${base}/api/panelpro-file-output/runs/${RUN}/approve`,{method:'POST',headers,
    body:JSON.stringify({ownerId:REVISION,runId:REVISION,artifactSetHash:'a'.repeat(64),approvalRef:'real-review',checks:{fit:true}})});
  assert.equal(response.status,202);assert.deepEqual(await response.json(),{accepted:true});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'http://runtime:8000/internal/panelpro-file-output/approve');
  const body=JSON.parse(calls[0].init.body);
  assert.equal(body.ownerId,OWNER);assert.equal(body.payload.runId,RUN);assert.equal(body.payload.artifactSetHash,'a'.repeat(64));
  assert.equal(calls[0].init.headers.authorization,`Bearer ${env.WORKER_SECRET}`);
});

test('generation progress binds six canonical sources to current ATLAS without exposing private evidence',async t=>{
  const calls=[];
  const base=await start(t,async(url,init)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:OWNER,email:'qc@example.test'});
    calls.push({url,init});
    if(url.endsWith('/rpc/designpro_generation_os_snapshot'))return Response.json({
      contract:'designpro.generation-os.v1',generationId:GENERATION,currentRevisionId:ATLAS,requestState:'leased',
      revisions:[{revisionId:ATLAS,masterContentHash:'a'.repeat(64),revisionSequence:2}],
      workflowRuns:[{runId:RUN,revisionId:REVISION,workflowType:'designpro.entice_pack',createdAt:'2026-09-08T12:00:00Z',
        stages:[{stageKey:'source.verify',state:'running',sequence:3,dependsOn:[],errorCode:'secret-provider-message'}]}],
      artifacts:[],events:[{payload:{prompt:'trade-secret'}}],privatePath:'private-provider-history'});
    if(url.includes('/designpro_revision_sources?'))return Response.json([{revision_id:REVISION,generation_id:GENERATION,
      panels:['driver','passenger','hood','roof','front','rear'].map(surfaceKey=>({surfaceKey,sourceMasterHash:'a'.repeat(64),storagePath:'private-art'}))}]);
    throw new Error('unexpected route');
  });
  const response=await fetch(`${base}/api/generation/${GENERATION}/progress`,{headers});
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.currentRevisionId,ATLAS);assert.equal(result.facts.productionRunLinked,true);
  assert.ok(result.stages.some(stage=>stage.key===`${RUN}:source.verify` && stage.state==='running'));
  assert.doesNotMatch(JSON.stringify(result),/trade-secret|private-art|secret-provider|private-provider|sourceMasterHash/);
  assert.deepEqual(result.workflowRevisionIds,[REVISION]);
  assert.ok(calls.every(call=>call.init.headers.authorization==='Bearer test-token'));
});

test('unknown generation access stops progress before any source lookup',async t=>{
  let lookedUp=false;
  const base=await start(t,async(url)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:OWNER});
    if(url.endsWith('/rpc/designpro_generation_os_snapshot'))return Response.json({message:'generation_access_denied'},{status:403});
    lookedUp=true;throw new Error('must not read sources');
  });
  const response=await fetch(`${base}/api/generation/${GENERATION}/progress`,{headers});
  assert.equal(response.status,403);assert.equal(lookedUp,false);
});

test('production reservation and attachment retain actor and route identities and preserve the revision continuation',async t=>{
  const calls=[];
  const continuation={targetApp:'RevisionStudioIQ',href:`/revision-studio?id=${GENERATION}`,generationId:GENERATION,sourceRevisionId:ATLAS,panelOutputRunId:RUN,autoApply:false};
  const base=await start(t,async(url,init)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:OWNER});
    calls.push({url,body:JSON.parse(init.body)});
    if(url.endsWith('/reserve'))return Response.json({reserved:true,productionRunId:REVISION});
    return Response.json({error:'panelprofile_proof_refresh_required',continuation},{status:409});
  });
  const reserved=await fetch(`${base}/api/panelpro-file-output/production/${REVISION}/reserve`,{method:'POST',headers,body:JSON.stringify({ownerId:RUN,productionRunId:RUN})});
  assert.equal(reserved.status,200);assert.equal((await reserved.json()).reserved,true);
  assert.deepEqual(calls[0],{url:'http://runtime:8000/internal/panelpro-file-output/reserve',body:{ownerId:OWNER,payload:{productionRunId:REVISION}}});
  const attached=await fetch(`${base}/api/panelpro-file-output/runs/${RUN}/attach`,{method:'POST',headers,body:JSON.stringify({runId:REVISION,ownerId:RUN,productionRunId:REVISION})});
  assert.equal(attached.status,409);assert.deepEqual((await attached.json()).continuation,continuation);
  assert.equal(calls[1].body.ownerId,OWNER);assert.equal(calls[1].body.payload.runId,RUN);assert.equal(calls[1].body.payload.productionRunId,REVISION);
});

test('template review proxy uses authenticated actor and route candidate rather than supplied identities',async t=>{
  let forwarded;
  const base=await start(t,async(url,init)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:OWNER});
    forwarded={url,body:JSON.parse(init.body)};return Response.json({reviewed:true});
  });
  const response=await fetch(`${base}/api/panelpro-file-output/templates/candidates/${RUN}/review`,{method:'POST',headers,
    body:JSON.stringify({actorId:REVISION,candidateId:ATLAS,candidateHash:'a'.repeat(64),review:{approved:true}})});
  assert.equal(response.status,200);assert.equal(forwarded.url,'http://runtime:8000/internal/panelpro-templates/review');
  assert.equal(forwarded.body.actorId,OWNER);assert.equal(forwarded.body.payload.candidateId,RUN);
  assert.equal(forwarded.body.payload.candidateHash,'a'.repeat(64));
});

test('paid design-first final QC reads its frozen order and selected-version brief and shows the reviewed child',async t=>{
  const binding={contractVersion:'designpro.fulfillment-binding.v1',revisionId:REVISION,bindingHash:'b'.repeat(64),orderNumber:'ORDER / 2026 #42',
    delivery:{contractVersion:'designpro.wrapbox-recipient.v1',customerId:OWNER,customerEmail:'customer@example.test',
      recipientIdentityHash:'c'.repeat(64),orderNumber:'ORDER / 2026 #42',designName:'Pool wrap'}};
  const run={id:RUN,owner_id:OWNER,workflow_type:'designpro.production_pack',status:'approval_required',revision_id:REVISION,
    revision_snapshot_hash:'a'.repeat(64),results:{generationId:GENERATION,fulfillmentBindingHash:binding.bindingHash},input:{fulfillment:binding}};
  let approvalCalls=0;
  const base=await start(t,async(url,init)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:OWNER});
    if(url.includes('/designpro_workflow_runs?'))return Response.json([run]);
    if(url.includes('/designpro_workflow_stages?'))return Response.json([
      {stage_key:'output.verify',status:'completed',output:{verified:true,panelProfileAttachments:[{
        childRunId:ATLAS,snapshotHash:'d'.repeat(64),snapshot:{parentRunId:RUN,revisionId:REVISION,artifactSetHash:'e'.repeat(64),
          approval:{qcApproved:true,artifactSetHash:'e'.repeat(64)},files:[{storagePath:'private-physical-file'}]}}]}},
      {stage_key:'await_final_human_qc',status:'waiting'}]);
    if(url.includes('/designpro_revision_sources?'))return Response.json([{generation_id:GENERATION,snapshot:{
      generationId:GENERATION,designId:'DID-BBBBBBBB',designName:'Pool wrap',brief:'Saved version two customer instruction',bodyText:[],
      sourceInputContract:'designpro.calls-1-7-input.v3',fulfillment:{contractVersion:'designpro.fulfillment-state.v1',state:'unbound'}}}]);
    if(url.endsWith('/rpc/approve_designpro_human_gate')){
      approvalCalls++;const body=JSON.parse(init.body);
      assert.equal(body.p_qc.orderNumber,'ORDER / 2026 #42');assert.equal(body.p_qc.brief,'Saved version two customer instruction');
      return Response.json({accepted:true});
    }
    throw new Error(`unexpected route ${url}`);
  });
  const view=await fetch(`${base}/api/jobs/${GENERATION}`,{headers});assert.equal(view.status,200);
  const job=await view.json();assert.equal(job.orderNumber,'ORDER / 2026 #42');assert.equal(job.brief,'Saved version two customer instruction');
  assert.deepEqual(job.panelProfileOutputs,[{runId:ATLAS,snapshotHash:'d'.repeat(64),artifactSetHash:'e'.repeat(64),fileCount:1,qcApproved:true,reviewUrl:`/panelpro-file-output/runs/${ATLAS}`}]);
  assert.doesNotMatch(JSON.stringify(job),/private-physical-file|customer@example/);
  const body=JSON.stringify({qc:{outputHashesVerified:true,printDimensionsVerified:true,colorModeVerified:true},notes:'Inspected exact files'});
  const approved=await fetch(`${base}/api/jobs/${GENERATION}/approvals/final`,{method:'POST',headers,body});assert.equal(approved.status,202);assert.equal(approvalCalls,1);
  binding.revisionId=ATLAS;
  const drift=await fetch(`${base}/api/jobs/${GENERATION}/approvals/final`,{method:'POST',headers,body});assert.equal(drift.status,409);assert.equal(approvalCalls,1);
});

test('revision intake preserves parent and generation identities and rejects caller-supplied actor controls',async t=>{
  const calls=[];
  const input={generationId:GENERATION,parentAtlasRevisionId:ATLAS,parentMasterContentHash:'a'.repeat(64),instruction:'Move the URL clear of the door cut',affectedSurfaces:['driver']};
  const base=await start(t,async(url,init)=>{
    if(url.endsWith('/auth/v1/user'))return Response.json({id:OWNER});
    calls.push({url,body:JSON.parse(init.body)});
    return Response.json({requestId:RUN,generationId:GENERATION,parentAtlasRevisionId:ATLAS,revisionSequence:3,state:'queued'},{status:202});
  });
  const created=await fetch(`${base}/api/generation/requests/revisions`,{method:'POST',headers,body:JSON.stringify(input)});
  assert.equal(created.status,202);assert.equal((await created.json()).generationId,GENERATION);
  assert.deepEqual(calls,[{url:'http://runtime:8000/internal/atlas-revisions/enqueue',body:{actorId:OWNER,payload:input}}]);
  const forged=await fetch(`${base}/api/generation/requests/revisions`,{method:'POST',headers,body:JSON.stringify({...input,actorId:REVISION})});
  assert.equal(forged.status,400);assert.equal(calls.length,1);
});
