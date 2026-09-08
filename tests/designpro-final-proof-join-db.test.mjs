import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';

const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const migrationPath='../supabase/migrations/20260908193134_designpro_final_proof_join.sql';
const migration=await readFile(new URL(migrationPath,import.meta.url),'utf8');
const readMigration=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hashJson=value=>hash(JSON.stringify(canonical(value)));
const clone=value=>structuredClone(value);
const OWNER='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const GENERATION='33333333-3333-4333-8333-333333333333';
const surfaces=['driver','passenger','hood','roof','front','rear'];
const baseFile=await readMigration('20260806180100_designpro_workflow_rpcs.sql');
const completeBase=baseFile.match(/CREATE OR REPLACE FUNCTION public\.complete_designpro_stage\([\s\S]*?END \$fn\$;/)[0];
const syncBase=baseFile.match(/CREATE OR REPLACE FUNCTION public\.designpro_sync_run_status\([\s\S]*?END \$fn\$;/)[0];
const precedentFiles=[
  '20260822090000_designpro_closeup_schema_boundaries.sql',
  '20260826010000_designpro_atlas_stage_contract.sql',
  '20260828110000_designpro_free_pack_needs_no_genie_manifest.sql',
  '20260829010000_designpro_call8_proof_uses_design_time_geometry.sql',
  '20260906121000_designpro_persist_call12_receipt.sql',
  '20260906143000_designpro_stamp_certificate_and_late_fulfillment.sql',
];
const precedentBlocks=[];
for(const file of precedentFiles) {
  const text=await readMigration(file);
  for(const match of text.matchAll(/DO\s+(\$\w*\$)([\s\S]*?)\1;/g)) {
    if(match[2].includes('public.complete_designpro_stage(')&&match[2].includes('pg_get_functiondef'))precedentBlocks.push(match[0]);
  }
}
const approvalBase=await readMigration('20260906132000_designpro_final_qc_resolves_late_fulfillment.sql');

async function database({apply=true}={}) {
  const db=new PGlite();
  try {
  // Actual predecessor stage/approval function bodies and every intervening
  // complete-stage patch are exercised. Only external auth/fulfillment/Atlas
  // lookup services are fixtures; no validation branch under test is stubbed.
  await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA designpro_private;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT COALESCE(NULLIF(current_setting('test.jwt',true),''),'{}')::jsonb$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULLIF(current_setting('test.uid',true),'')::uuid$$;
    CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256($1)$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb DEFAULT '{}');
    CREATE TABLE public.designpro_qc_members(user_id uuid PRIMARY KEY,can_preflight boolean,can_final_qc boolean);
    CREATE TABLE public.designpro_workflow_runs(id uuid PRIMARY KEY,workflow_type text,owner_id uuid,tenant_key text,
      revision_id uuid,revision_snapshot_hash text,entice_pack_id uuid,dimension_manifest_id uuid,source_contract_hash text,
      manifest_hash text,artifact_set_hash text,input jsonb DEFAULT '{}',results jsonb DEFAULT '{}',status text,
      updated_at timestamptz,started_at timestamptz,finished_at timestamptz);
    CREATE TABLE public.designpro_revision_sources(revision_id uuid PRIMARY KEY,owner_id uuid,tenant_key text,
      generation_id uuid,visualization_id uuid,snapshot_hash text,snapshot jsonb);
    CREATE TABLE public.designpro_workflow_stages(id uuid PRIMARY KEY,run_id uuid,stage_key text,status text,
      attempt integer DEFAULT 0 CHECK(attempt>=0),max_attempts integer DEFAULT 5,available_at timestamptz DEFAULT now(),
      lease_token uuid,lease_owner text,lease_expires_at timestamptz,input jsonb DEFAULT '{}',output jsonb DEFAULT '{}',
      verification jsonb DEFAULT '{}',output_hash text,started_at timestamptz,completed_at timestamptz,updated_at timestamptz,
      wait_reason text,wait_details jsonb DEFAULT '{}',error_code text,error_message text,error_details jsonb DEFAULT '{}',
      UNIQUE(run_id,stage_key),CHECK(status<>'running' OR (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)));
    CREATE TABLE public.designpro_stage_receipts(id uuid DEFAULT gen_random_uuid(),run_id uuid,stage_id uuid UNIQUE,
      receipt_kind text,identity jsonb,receipt jsonb,receipt_hash text,UNIQUE(run_id,receipt_kind,receipt_hash));
    CREATE TABLE public.designpro_artifacts(id uuid DEFAULT gen_random_uuid(),run_id uuid,stage_id uuid,artifact_kind text,
      surface_key text,storage_path text,content_hash text,byte_size bigint,metadata jsonb DEFAULT '{}');
    CREATE TABLE public.designpro_purchase_entitlements(owner_id uuid,entice_run_id uuid,generation_id uuid,
      product_type text,amount_cents integer,paid_at timestamptz);
    CREATE TABLE public.designpro_flat_atlas_revisions(id uuid,request_id uuid,generation_id uuid,owner_id uuid,
      tenant_key text,revision_sequence integer,master_content_hash text,projection_content_hash text,manifest_content_hash text,metadata jsonb);
    CREATE TABLE public.designpro_generation_views(request_id uuid,consumer_role text,storage_path text,content_hash text,
      byte_size bigint,content_type text,metadata jsonb,superseded_at timestamptz);
    CREATE FUNCTION designpro_private.workflow_run_is_atlas(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    CREATE FUNCTION designpro_private.revision_fulfillment(uuid) RETURNS jsonb LANGUAGE sql AS $$
      SELECT input->'fulfillment' FROM public.designpro_workflow_runs WHERE revision_id=$1 AND workflow_type='designpro.production_pack' LIMIT 1$$;
    INSERT INTO auth.users VALUES('${OWNER}','reviewer@example.test',now(),'{"display_name":"QC Reviewer"}'),('${OTHER}','other@example.test',now(),'{}');
    INSERT INTO public.designpro_qc_members VALUES('${OWNER}',true,true);
    SET test.jwt='{"role":"service_role"}';`);
  await db.exec(completeBase);
  for(const block of precedentBlocks)await db.exec(block);
  await db.exec(approvalBase);
  await db.exec(syncBase);
  const before=(await db.query("SELECT pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure) AS body")).rows[0].body;
  if(apply)await db.exec(migration);
  return {db,before};
  } catch(error) {await db.close();throw error;}
}

async function stage(db,runId,key,status,output={}) {
  const id=randomUUID(),token=randomUUID();
  await db.query(`INSERT INTO public.designpro_workflow_stages(id,run_id,stage_key,status,attempt,lease_token,lease_owner,lease_expires_at,output,verification,completed_at)
    VALUES($1,$2,$3,$4,1,$5,'test-worker',now()+interval '2 minutes',$6,'{"verified":true}',now())`,[id,runId,key,status,token,JSON.stringify(output)]);
  return {id,token};
}
async function artifact(db,runId,stageId,a) {
  await db.query('INSERT INTO public.designpro_artifacts(run_id,stage_id,artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [runId,stageId,a.kind,a.surfaceKey||'',a.storagePath,a.contentHash,a.byteSize,JSON.stringify(a.metadata||{})]);
}
async function fixture(db,{logoOnly=false,seventh='closeup'}={}) {
  const runId=randomUUID(),enticeId=randomUUID(),revisionId=randomUUID(),manifestId=randomUUID(),requestId=randomUUID();
  const tenant=`user_${OWNER}`,masterHash=hash('master'),snapshotHash=hash('snapshot'),manifestHash=hash('manifest');
  const views=[...surfaces,seventh].sort().map(viewKey=>({viewKey,contentHash:hash(viewKey),byteSize:123,
    storagePath:`users/${OWNER}/revisions/${revisionId}/inputs/${viewKey}/${hash(viewKey)}.png`,contentType:'image/png'}));
  const panels=surfaces.map((surfaceKey,index)=>({surfaceKey,contentHash:hash(`panel-${surfaceKey}`),
    sourceMasterHash:masterHash,storagePath:`designpro/${tenant}/${GENERATION}/panels/${surfaceKey}.png`,
    trimWidthIn:100+index,trimHeightIn:50,printWidthIn:110+index,printHeightIn:60}));
  const snapshot={generationId:GENERATION,designId:'DID-33333333',orderNumber:'ORDER-1',delivery:{orderNumber:'ORDER-1'},
    callOnePanels:panels,renderAssets:Object.fromEntries(views.map(({viewKey,...value})=>[viewKey,value]))};
  const fulfillment={contractVersion:'designpro.fulfillment-binding.v1',revisionId,bindingHash:hash('fulfillment'),orderNumber:'ORDER-1',delivery:{orderNumber:'ORDER-1'}};
  const authorized={products:logoOnly?['logo_pack']:['print_pack_entitlement'],productionPackAuthorized:!logoOnly,
    logoPackAuthorized:logoOnly,requiredOutputFiles:logoOnly?0:18,zipIncludesSourceViews:!logoOnly};
  const dimensionManifest={contract:'designpro.genie-dimension-manifest.v1',genieVerified:true,totalSqFt:213.54,
    expectedSurfaces:panels.map(p=>({surfaceKey:p.surfaceKey,widthInches:p.trimWidthIn,heightInches:p.trimHeightIn}))};
  for(const [id,type] of [[runId,'designpro.production_pack'],[enticeId,'designpro.entice_pack']]) {
    await db.query(`INSERT INTO public.designpro_workflow_runs(id,workflow_type,owner_id,tenant_key,revision_id,revision_snapshot_hash,
      entice_pack_id,dimension_manifest_id,source_contract_hash,manifest_hash,artifact_set_hash,input,results,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'running')`,
      [id,type,OWNER,tenant,revisionId,snapshotHash,enticeId,manifestId,hash('source'),manifestHash,hash('artifacts'),JSON.stringify({fulfillment,sourceEnticeRunId:enticeId}),JSON.stringify({sourceEnticeRunId:enticeId,dimensionManifest})]);
  }
  await db.query('INSERT INTO public.designpro_revision_sources VALUES($1,$2,$3,$4,$5,$6,$7)',[revisionId,OWNER,tenant,GENERATION,requestId,snapshotHash,JSON.stringify(snapshot)]);
  await db.query('INSERT INTO public.designpro_purchase_entitlements VALUES($1,$2,$3,$4,29900,now())',[OWNER,enticeId,GENERATION,logoOnly?'logo_pack':'print_pack_entitlement']);
  await stage(db,runId,'await_purchase','completed',{authorizedAssetManifest:authorized});
  const built={verified:true,receiptKind:'call8.flat-proof',call:8,producer:'designpro.call8-panel-proof.v4',deterministic:true,
    imageRequestCount:0,proofPixelsUsed:false,dimensionsAuthority:'genie-universal-panelizer',bleedInches:5,
    manifestHash,dimensionManifestId:manifestId,totalSqFt:dimensionManifest.totalSqFt,sourceProofHash:hash('call8'),
    storagePath:`designpro/${tenant}/${runId}/proof/original-call8.png`,
    surfaceTiles:panels.map(p=>({...p,sourcePanelHash:p.contentHash,sourcePanelPath:p.storagePath,
      dimensionRuleBasis:'trim-boundary',continuousArtwork:true,sourceAspectPreserved:true,bleedInches:{top:5,right:5,bottom:5,left:5}}))};
  const call8={receiptKind:'call8.flat-proof',receiptHash:hashJson(built),receipt:built,reconciledForProduction:true};
  const sourceStage=await stage(db,runId,'source.verify','completed',{call8});
  const frozen={verified:true,sevenViewsVerified:true,viewReceipts:views};
  const frozenStage=await stage(db,enticeId,'revision.freeze','completed',frozen);
  await db.query('INSERT INTO public.designpro_stage_receipts(run_id,stage_id,receipt_kind,identity,receipt,receipt_hash) VALUES($1,$2,\'views.seven-source\',\'{}\',$3,$4)',[enticeId,frozenStage.id,JSON.stringify(frozen),hashJson(frozen)]);
  const flatProof={kind:'flat-proof',storagePath:`designpro/${tenant}/${runId}/source/call8-2d-production-proof.png`,contentHash:built.sourceProofHash,byteSize:999,
    metadata:{sourceReceiptHash:call8.receiptHash,manifestHash,sourceStoragePath:built.storagePath,sourceContentHash:built.sourceProofHash}};
  await artifact(db,runId,sourceStage.id,flatProof);
  const outputStage=await stage(db,runId,'output.verify','running');
  const gate=await stage(db,runId,'await_final_human_qc','pending');
  const stampStage=await stage(db,runId,'stamp.build','pending');
  await stage(db,runId,'zip.build','pending');
  const join={contract:'designpro.production-proof-join.v1',call8ReceiptHash:call8.receiptHash,call8ProofHash:built.sourceProofHash,
    manifestHash,sourceViews:views,sourceViewSetHash:hashJson(views),sevenViewsVerified:true,
    viewBinding:{contract:'designpro.frozen-proof-join.v1',sourceReceiptHash:hashJson(frozen)}};
  const files=[];
  if(!logoOnly)for(const surfaceKey of surfaces)for(const format of ['png','tiff','eps']) {
    const file={surfaceKey,format,contentHash:hash(`output-${surfaceKey}-${format}`),byteSize:456,
      storagePath:`designpro/${tenant}/${runId}/output/${surfaceKey}.${format}`,dpi:1500,outputScale:0.1,
      fullScaleBleedInches:5,colorSpace:'sRGB',widthPixels:16500,heightPixels:9000};
    files.push(file);await artifact(db,runId,outputStage.id,{...file,kind:'output',metadata:{format,width:file.widthPixels,height:file.heightPixels,dpi:1500,outputScale:0.1,fullScaleBleedInches:5}});
  }
  const output=logoOnly?{verified:true,receiptKind:'output.verified',authorizedAssetManifest:authorized,exactSurfaceFormatCount:0,notApplicable:['output'],proofJoin:null}
    :{verified:true,receiptKind:'output.verified',authorizedAssetManifest:authorized,proofJoin:join,contract:'designpro.output-verification.v1',
      exactSurfaceSet:surfaces,exactFormatSet:['png','tiff','eps'],fileCount:18,fullScalePixelsPerInch:150,fileDpi:1500,outputScale:0.1,
      fullScaleBleedInchesPerEdge:5,files,outputHashes:files.map(f=>f.contentHash)};
  const identity={workflowRunId:runId,revisionId,enticePackId:enticeId,dimensionManifestId:manifestId,
    sourceContractHash:hash('source'),manifestHash,artifactSetHash:hash('artifacts')};
  return {runId,enticeId,revisionId,manifestId,requestId,tenant,masterHash,snapshotHash,manifestHash,sourceStage,outputStage,gate,stampStage,
    sourceOutput:{call8},call8,views,join,output,identity,authorized,flatProof};
}
const assertJoin=(db,f,output=f.output)=>db.query('SELECT designpro_private.assert_final_proof_join($1,$2) AS result',[f.runId,JSON.stringify(output)]);
const complete=(db,f,s,receipt,artifacts=[])=>db.query('SELECT public.complete_designpro_stage($1,$2,$3,$4,$5,$6) AS result',
  [s.id,s.token,JSON.stringify(f.identity),JSON.stringify(receipt),receipt.stampHash||hashJson(receipt),JSON.stringify(artifacts)]);
async function approve(db,f,qc={}) {
  const checks={known:true,pass:true,outputHashesVerified:true,printDimensionsVerified:true,colorModeVerified:true,
    designId:'DID-33333333',orderNumber:'ORDER-1',...qc};
  return db.query('SELECT public.approve_designpro_human_gate($1,\'await_final_human_qc\',$2,\'approval-1\',$3) AS result',[f.runId,OWNER,JSON.stringify(checks)]);
}
async function stampFixture(db,f) {
  const approval=(await db.query("SELECT receipt FROM public.designpro_stage_receipts WHERE run_id=$1 AND receipt_kind='final.human-qc'",[f.runId])).rows[0].receipt;
  const receipt={verified:true,receiptKind:'stamp',designId:'DID-33333333',orderNumber:'ORDER-1',verifiedBy:approval.verifiedBy,
    approvalRef:approval.approvalRef,approvedAt:approval.approvedAt,sealHash:hash('seal'),stampHash:hash('stamped-proof'),
    certificateHash:hash('certificate'),sourceProofHash:f.flatProof.contentHash,proofJoin:f.output.proofJoin,stampedViews:[]};
  const metadata={designId:receipt.designId,orderNumber:receipt.orderNumber,verifiedBy:receipt.verifiedBy,approvalRef:receipt.approvalRef,approvedAt:receipt.approvedAt};
  const artifacts=['seal','stamped-proof','certificate'].map(surfaceKey=>({kind:'stamp',surfaceKey,contentHash:hash(surfaceKey),byteSize:999,
    storagePath:`designpro/${f.tenant}/${f.runId}/proof/${surfaceKey}.png`,metadata:{...metadata,...(surfaceKey==='stamped-proof'?{sourceProofHash:receipt.sourceProofHash}: {})}}));
  for(const v of f.output.proofJoin?.sourceViews||[]) {
    const s={viewKey:v.viewKey,storagePath:`designpro/${f.tenant}/${f.runId}/proof/stamped-view-${v.viewKey}-${v.contentHash.slice(0,24)}.png`,
      contentHash:hash(`stamp-${v.viewKey}`),byteSize:987,sourceProofHash:v.contentHash,sourceProofPath:v.storagePath};
    receipt.stampedViews.push(s);
    artifacts.push({kind:'stamp',surfaceKey:`stamped-view-${v.viewKey}`,storagePath:s.storagePath,contentHash:s.contentHash,byteSize:s.byteSize,
      metadata:{...metadata,sourceViewKey:v.viewKey,sourceProofHash:v.contentHash,sourceProofPath:v.storagePath,sealHash:receipt.sealHash,sourceViewSetHash:f.join.sourceViewSetHash}});
  }
  await db.query("UPDATE public.designpro_workflow_stages SET status='running' WHERE id=$1",[f.stampStage.id]);
  return {receipt,artifacts};
}

test('production SQL joins exact Call 8 and seven proofs before exposing final QC; all ten stamps retain business identity',async t=>{
  const {db,before}=await database();t.after(()=>db.close());const f=await fixture(db);
  assert.deepEqual((await assertJoin(db,f)).rows[0].result,f.join);
  const broken=clone(f.output);broken.proofJoin.sourceViews.pop();
  await assert.rejects(complete(db,f,f.outputStage,broken),/production_seven_proofs_required/);
  assert.equal((await db.query('SELECT status FROM public.designpro_workflow_stages WHERE id=$1',[f.gate.id])).rows[0].status,'pending');
  assert.equal((await complete(db,f,f.outputStage,f.output)).rows[0].result,true);
  assert.equal((await db.query('SELECT status FROM public.designpro_workflow_stages WHERE id=$1',[f.gate.id])).rows[0].status,'waiting');
  await assert.rejects(approve(db,f,{orderNumber:'WRONG-ORDER'}),/final_qc_evidence_or_business_identity_incomplete/);
  await approve(db,f);
  const s=await stampFixture(db,f);
  await assert.rejects(complete(db,f,f.stampStage,s.receipt,s.artifacts.slice(0,3)),/production_seven_stamped_views_required/);
  const wrongSource=clone(s.artifacts);wrongSource[3].metadata.sourceProofHash=hash('different-revision');
  await assert.rejects(complete(db,f,f.stampStage,s.receipt,wrongSource),/production_seven_stamped_views_required/);
  const wrongApprover=clone(s.artifacts);wrongApprover[3].metadata.verifiedBy='Somebody else';
  await assert.rejects(complete(db,f,f.stampStage,s.receipt,wrongApprover),/production_seven_stamped_views_required/);
  const driftedJoin=clone(s.receipt);driftedJoin.proofJoin.call8ProofHash=hash('later-proof');
  await assert.rejects(complete(db,f,f.stampStage,driftedJoin,s.artifacts),/production_stamped_proof_join_mismatch/);
  const duplicatedStamp=clone(s.receipt);duplicatedStamp.stampedViews[1].contentHash=duplicatedStamp.stampedViews[0].contentHash;
  await assert.rejects(complete(db,f,f.stampStage,duplicatedStamp,s.artifacts),/production_seven_stamped_views_required/);
  const wrongOrder=clone(s.receipt);wrongOrder.orderNumber='WRONG-ORDER';
  await assert.rejects(complete(db,f,f.stampStage,wrongOrder,s.artifacts),/exact_stamp_business_identity_required/);
  const wrongSeal=clone(s.artifacts);wrongSeal[0].contentHash=hash('wrong-seal');
  await assert.rejects(complete(db,f,f.stampStage,s.receipt,wrongSeal),/exact_stamp_artifact_set_required/);
  assert.equal((await complete(db,f,f.stampStage,s.receipt,s.artifacts)).rows[0].result,true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.designpro_artifacts WHERE run_id=$1 AND artifact_kind='stamp'",[f.runId])).rows[0].n,10);
  const after=(await db.query("SELECT pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure) AS body")).rows[0].body;
  // All earlier authoring gates and all later ZIP/delivery behavior are byte-preserved.
  assert.equal(after.split("  ELSIF v_stage.stage_key='output.verify'")[0],before.split("  ELSIF v_stage.stage_key='output.verify'")[0]);
  assert.equal(after.slice(after.indexOf("  IF v_stage.stage_key='zip.build'")),before.slice(before.indexOf("  IF v_stage.stage_key='zip.build'")));
});

test('proof SQL rejects forged view identities, Call 8 geometry drift, alpha/blank attestations, and a changed master',async t=>{
  const {db}=await database();t.after(()=>db.close());const f=await fixture(db);
  for(const mutate of [
    o=>o.proofJoin.sourceViews[1].contentHash=o.proofJoin.sourceViews[0].contentHash,
    o=>o.proofJoin.sourceViews[0].storagePath='https://attacker.example/proof.png',
    o=>o.proofJoin.sourceViews[0].byteSize=0,
    o=>o.proofJoin.sourceViewSetHash=hash('forged-set'),
    o=>o.proofJoin.manifestHash=hash('other-manifest'),
    o=>o.proofJoin.viewBinding.sourceReceiptHash=hash('other-receipt'),
  ]) {const value=clone(f.output);mutate(value);await assert.rejects(assertJoin(db,f,value),/production_/);}
  for (const contentType of [null, '', 'application/pdf']) {
    const value=clone(f.output);value.proofJoin.sourceViews[0].contentType=contentType;
    await assert.rejects(assertJoin(db,f,value),/production_seven_proofs_required/);
  }
  for(const mutate of [
    b=>b.deferred=true,
    b=>b.totalSqFt=0,
    b=>b.surfaceTiles[0].bleedInches.top=4,
    b=>b.surfaceTiles[0].printWidthIn+=1,
    b=>b.surfaceTiles[0].trimWidthIn+=1,
    b=>b.surfaceTiles[0].continuousArtwork=false,
    b=>b.surfaceTiles[0].sourceMasterHash=hash('other-master'),
    b=>b.surfaceTiles[0].sourcePanelHash=hash('other-panel'),
  ]) {
    const value=clone(f.sourceOutput);mutate(value.call8.receipt);
    await db.query('UPDATE public.designpro_workflow_stages SET output=$1 WHERE id=$2',[JSON.stringify(value),f.sourceStage.id]);
    await assert.rejects(assertJoin(db,f),/production_call8_/);
  }
  await db.query('UPDATE public.designpro_workflow_stages SET output=$1 WHERE id=$2',[JSON.stringify(f.sourceOutput),f.sourceStage.id]);
  await db.query("UPDATE public.designpro_artifacts SET byte_size=0 WHERE run_id=$1 AND artifact_kind='flat-proof'",[f.runId]);
  await assert.rejects(assertJoin(db,f),/production_call8_artifact_required/);
});

test('approval cannot bypass a missing pinned join even when a passing output receipt was already recorded',async t=>{
  const {db}=await database();t.after(()=>db.close());const f=await fixture(db);const invalid=clone(f.output);delete invalid.proofJoin;
  await db.query("INSERT INTO public.designpro_stage_receipts(run_id,stage_id,receipt_kind,receipt,receipt_hash) VALUES($1,$2,'output.verified',$3,$4)",[f.runId,f.outputStage.id,JSON.stringify(invalid),hashJson(invalid)]);
  await db.query("UPDATE public.designpro_workflow_stages SET status='waiting' WHERE id=$1",[f.gate.id]);
  await db.query("UPDATE public.designpro_workflow_runs SET status='approval_required' WHERE id=$1",[f.runId]);
  await assert.rejects(approve(db,f),/production_final_proof_join_required/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.designpro_stage_receipts WHERE run_id=$1 AND receipt_kind='final.human-qc'",[f.runId])).rows[0].n,0);
});

test('historical Hero proofs remain bound to their immutable snapshot; late Close-Up proofs bind the exact accepted master',async t=>{
  const {db}=await database();t.after(()=>db.close());const f=await fixture(db,{seventh:'hero3d'});
  assert.deepEqual((await assertJoin(db,f)).rows[0].result,f.join);
  await db.query("UPDATE public.designpro_revision_sources SET snapshot=jsonb_set(snapshot,'{renderAssets}',(snapshot->'renderAssets')-'hero3d') WHERE revision_id=$1",[f.revisionId]);
  await assert.rejects(assertJoin(db,f),/production_frozen_proof_binding_invalid/);
  await db.query("UPDATE public.designpro_revision_sources SET snapshot=snapshot-'renderAssets' WHERE revision_id=$1",[f.revisionId]);
  await assert.rejects(assertJoin(db,f),/production_frozen_proof_binding_invalid/);
  const late=await fixture(db);const atlasId=randomUUID();
  late.output.proofJoin.viewBinding={contract:'designpro.late-atlas-proof-join.v1',requestId:late.requestId,atlasRevisionId:atlasId,
    masterContentHash:late.masterHash,projectionContentHash:hash('projection'),manifestContentHash:hash('atlas-manifest'),snapshotHash:late.snapshotHash};
  await db.query('INSERT INTO public.designpro_flat_atlas_revisions VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,\'{"masterQcPassed":true}\')',
    [atlasId,late.requestId,GENERATION,OWNER,late.tenant,late.masterHash,hash('projection'),hash('atlas-manifest')]);
  for(const v of late.views)await db.query('INSERT INTO public.designpro_generation_views VALUES($1,$2,$3,$4,$5,$6,$7,NULL)',
    [late.requestId,v.viewKey,v.storagePath,v.contentHash,v.byteSize,v.contentType,JSON.stringify({authority:{revisionId:atlasId,masterContentHash:late.masterHash}})]);
  await assertJoin(db,late);
  await db.query("UPDATE public.designpro_generation_views SET metadata='{}' WHERE request_id=$1 AND consumer_role='driver'",[late.requestId]);
  await assert.rejects(assertJoin(db,late),/production_late_proof_binding_invalid/);
});

test('Logo-only zero-output completion requires the exact frozen paid lane and preserves the three existing QC artifacts',async t=>{
  const {db}=await database();t.after(()=>db.close());const f=await fixture(db,{logoOnly:true});
  await db.query('DELETE FROM public.designpro_purchase_entitlements WHERE entice_run_id=$1',[f.enticeId]);
  await assert.rejects(complete(db,f,f.outputStage,f.output),/logo_only_paid_entitlement_required/);
  await db.query('INSERT INTO public.designpro_purchase_entitlements VALUES($1,$2,$3,\'logo_pack\',2900,now())',[OTHER,f.enticeId,GENERATION]);
  await assert.rejects(complete(db,f,f.outputStage,f.output),/logo_only_paid_entitlement_required/);
  await db.query('UPDATE public.designpro_purchase_entitlements SET owner_id=$1 WHERE entice_run_id=$2',[OWNER,f.enticeId]);
  // A subsequent Production Pack purchase does not mutate a completed Logo-only gate.
  await db.query('INSERT INTO public.designpro_purchase_entitlements VALUES($1,$2,$3,\'print_pack_entitlement\',29900,now())',[OWNER,f.enticeId,GENERATION]);
  const forged=clone(f.output);forged.authorizedAssetManifest.products=[];
  await assert.rejects(complete(db,f,f.outputStage,forged),/logo_only_frozen_authorization_required/);
  assert.equal((await complete(db,f,f.outputStage,f.output)).rows[0].result,true);
  await approve(db,f);const s=await stampFixture(db,f);
  assert.equal(s.artifacts.length,3);
  assert.equal((await complete(db,f,f.stampStage,s.receipt,s.artifacts)).rows[0].result,true);
  const production=await fixture(db);const falseFlag=clone(production.output);
  falseFlag.authorizedAssetManifest.productionPackAuthorized=false;falseFlag.proofJoin=null;
  await assert.rejects(complete(db,production,production.outputStage,falseFlag),/logo_only_frozen_authorization_required/);
  const missingOutput=clone(production.output);missingOutput.files.pop();
  await assert.rejects(complete(db,production,production.outputStage,missingOutput),/verified_output_artifact_ledger_mismatch/);
});

test('proof deferral is service-only, lease-fenced, preserves attempts and cannot reopen a completed or wrong stage',async t=>{
  const {db}=await database();t.after(()=>db.close());const f=await fixture(db);
  const defer=(id=f.outputStage.id,token=f.outputStage.token)=>db.query('SELECT public.defer_designpro_for_proofs($1,$2) AS result',[id,token]);
  assert.equal((await defer(f.outputStage.id,randomUUID())).rows[0].result,false);
  assert.equal((await defer(f.stampStage.id,f.stampStage.token)).rows[0].result,false);
  await db.exec(`SET test.jwt='{"role":"authenticated"}'`);
  await assert.rejects(defer(),/service_role_required/);
  await db.exec(`SET test.jwt='{"role":"service_role"}'; SET ROLE authenticated`);
  await assert.rejects(defer(),/permission denied/);await db.exec('RESET ROLE');
  assert.equal((await defer()).rows[0].result,true);
  const s=(await db.query('SELECT *,extract(epoch FROM available_at-now()) AS delay FROM public.designpro_workflow_stages WHERE id=$1',[f.outputStage.id])).rows[0];
  assert.equal(s.status,'retryable');assert.equal(s.attempt,0);assert.equal(s.lease_token,null);assert.equal(s.lease_owner,null);
  assert.ok(Number(s.delay)>28&&Number(s.delay)<=31);assert.equal((await defer()).rows[0].result,false);
  await db.query("UPDATE public.designpro_workflow_stages SET status='running',lease_token=$1,lease_owner='worker',lease_expires_at=now()-interval '1 second' WHERE id=$2",[f.outputStage.token,f.outputStage.id]);
  assert.equal((await defer()).rows[0].result,false);
});

test('real child-attachment migration extends the reconstructed production proof gate without weakening Call 8 or seven-view approval',async t=>{
  const {db}=await database();t.after(()=>db.close());
  await db.exec(`CREATE TABLE designpro_private.heavy_stage_leases(lease_key text PRIMARY KEY,stage_id uuid,
    lease_owner text,lease_token uuid,lease_expires_at timestamptz,updated_at timestamptz,
    CONSTRAINT designpro_heavy_stage_lease_integrity CHECK ((stage_id IS NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
      OR (stage_id IS NOT NULL AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)));
    INSERT INTO designpro_private.heavy_stage_leases(lease_key) VALUES('production-heavy');`);
  await db.exec(baseFile.match(/CREATE OR REPLACE FUNCTION public\.claim_designpro_stage\([\s\S]*?END \$fn\$;/)[0]);
  const heavy=await readMigration('20260824040000_designpro_call12_heavy_lease.sql');
  await db.exec(heavy.match(/CREATE OR REPLACE FUNCTION public\.acquire_designpro_heavy_lease\([\s\S]*?\$fn\$;/)[0]);
  await db.exec(await readMigration('20260908190825_panelpro_file_output_graph.sql'));
  await db.exec(await readMigration('20260908195123_designpro_panelprofile_production_attachment.sql'));
  const f=await fixture(db);
  assert.deepEqual((await assertJoin(db,f)).rows[0].result,f.join,'no child preserves the original gate');
  await db.query("UPDATE public.designpro_workflow_stages SET status='pending',attempt=0 WHERE id=$1",[f.outputStage.id]);
  await db.query('SELECT public.reserve_panelprofile_for_production($1,$2)',[OWNER,f.runId]);
  await assert.rejects(assertJoin(db,f),/production_panelprofile_pending/);
  // The attachment admission RPC is exercised with complete child QC/files in
  // panelprofile-production-attachment.test.mjs. This record fixture checks the
  // later migration's actual composition with all earlier production gates.
  const sourceId=randomUUID(),childId=randomUUID(),attachmentId=randomUUID();
  await db.query(`INSERT INTO public.panelprofile_source_handoffs(id,owner_id,source_app,source_job_id,generation_id,revision_id,input_hash,handoff,registered_by)
    VALUES($1,$2,'DesignPro','fixture-child',$3,$4,$5,'{}',$2)`,[sourceId,OWNER,GENERATION,f.revisionId,hash('child-input')]);
  await db.query(`INSERT INTO public.panelprofile_runs(id,source_id,owner_id,definition_version,state,input_hash)
    VALUES($1,$2,$3,'fixture-v1','completed',$4)`,[childId,sourceId,OWNER,hash('child-input')]);
  const snapshot={contractVersion:'designpro.panelprofile-production-attachment.v1',parentRunId:f.runId,childRunId:childId,
    generationId:GENERATION,revisionId:f.revisionId,masterHash:f.masterHash,dimensionManifestHash:f.manifestHash};
  const snapshotHash=hashJson(snapshot);
  await db.query(`INSERT INTO public.designpro_panelprofile_attachments(id,production_run_id,child_run_id,owner_id,snapshot,snapshot_hash,attached_by)
    VALUES($1,$2,$3,$4,$5,$6,$4)`,[attachmentId,f.runId,childId,OWNER,JSON.stringify(snapshot),snapshotHash]);
  await assert.rejects(assertJoin(db,f),/panelprofile_attachment_approval_drift/);
  f.output.panelProfileAttachments=[{attachmentId,childRunId:childId,snapshotHash,snapshot}];
  await assertJoin(db,f);
  const partial=clone(f.output);partial.proofJoin.sourceViews.pop();
  await assert.rejects(assertJoin(db,f,partial),/production_seven_proofs_required/);
  const changedCall8=clone(f.sourceOutput);changedCall8.call8.receipt.surfaceTiles[0].printWidthIn+=1;
  await db.query('UPDATE public.designpro_workflow_stages SET output=$1 WHERE id=$2',[JSON.stringify(changedCall8),f.sourceStage.id]);
  await assert.rejects(assertJoin(db,f),/production_call8_geometry_invalid/);
  await db.query('UPDATE public.designpro_workflow_stages SET output=$1 WHERE id=$2',[JSON.stringify(f.sourceOutput),f.sourceStage.id]);
  await db.query("UPDATE public.designpro_workflow_stages SET status='running',attempt=1 WHERE id=$1",[f.outputStage.id]);
  assert.equal((await complete(db,f,f.outputStage,f.output)).rows[0].result,true);
  await approve(db,f);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.designpro_stage_receipts WHERE run_id=$1 AND receipt_kind='final.human-qc'",[f.runId])).rows[0].n,1);
});
