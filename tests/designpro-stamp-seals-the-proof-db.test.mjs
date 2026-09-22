// THE QC SEAL LANDS ON THE TRIZONE(TM) PRODUCTION PANEL PROOF — the DATABASE
// gate (2026-09-22). `complete_designpro_stage`'s stamp.build arm pins the
// exact stamp artifact set, so the runtime's fourth stamp
// (`stamped-production-panel-proof`) needs the migration
// 20260922151000 to be admitted. This lock applies the REAL migration chain on
// PGlite and drives the real RPC over a stamp fixture; the `apply:false` case
// reproduces the defect (the fourth stamp refused on a three-zone revision).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';

const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const MIGRATION='20260922151000_designpro_stamp_seals_the_production_panel_proof.sql';
const readMigration=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const migrationFiles=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hashJson=value=>hash(JSON.stringify(canonical(value)));
const clone=value=>structuredClone(value);
const OWNER='11111111-1111-4111-8111-111111111111';
const GENERATION='33333333-3333-4333-8333-333333333333';
const surfaces=['driver','passenger','hood','roof','front','rear'];
const baseFile=await readMigration('20260806180100_designpro_workflow_rpcs.sql');
const completeBase=baseFile.match(/CREATE OR REPLACE FUNCTION public\.complete_designpro_stage\([\s\S]*?END \$fn\$;/)[0];
const syncBase=baseFile.match(/CREATE OR REPLACE FUNCTION public\.designpro_sync_run_status\([\s\S]*?END \$fn\$;/)[0];
const WHOLE=new Set(['20260906132000_designpro_final_qc_resolves_late_fulfillment.sql','20260908193134_designpro_final_proof_join.sql',
  '20260920113000_designpro_paid_pdf_outputs.sql','20260922060000_designpro_output_contract_v4_clean_panels.sql']);
const canonicalHashMigration=await readMigration('20260908201216_designpro_parent_bound_atlas_revisions.sql');

async function database({apply=true}={}) {
  const db=new PGlite();
  try {
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
    INSERT INTO auth.users VALUES('${OWNER}','reviewer@example.test',now(),'{"display_name":"QC Reviewer"}');
    INSERT INTO public.designpro_qc_members VALUES('${OWNER}',true,true);
    SET test.jwt='{"role":"service_role"}';`);
    await db.exec(completeBase);
    await db.exec(syncBase);
    for(const name of ['atlas_revision_canonical','atlas_revision_hash']) {
      await db.exec(canonicalHashMigration.match(new RegExp(`CREATE OR REPLACE FUNCTION designpro_private\\.${name}\\([\\s\\S]*?\\$fn\\$;`))[0]);
    }
    // EVERY complete_designpro_stage patch the history carries, in order, up to
    // (and excluding) the migration under test — so the fragments this
    // migration searches for are the ones the live body actually holds.
    for(const file of migrationFiles) {
      if(file<'20260806180100'||file>=MIGRATION)continue;
      const text=await readMigration(file);
      if(WHOLE.has(file)){await db.exec(text);continue;}
      for(const match of text.matchAll(/DO\s+(\$\w*\$)([\s\S]*?)\1;/g)) {
        if(match[2].includes('public.complete_designpro_stage(')&&match[2].includes('pg_get_functiondef'))await db.exec(match[0]);
      }
    }
    const before=(await db.query("SELECT pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure) AS body")).rows[0].body;
    if(apply)await db.exec(await readMigration(MIGRATION));
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
const SHEET_HASH=hash('trizone-production-panel-proof-sheet');
async function fixture(db,{threeZone=true}={}) {
  const runId=randomUUID(),enticeId=randomUUID(),revisionId=randomUUID(),manifestId=randomUUID(),requestId=randomUUID();
  const tenant=`user_${OWNER}`,masterHash=hash('master'),snapshotHash=hash('snapshot'),manifestHash=hash('manifest');
  const views=[...surfaces,'closeup'].sort().map(viewKey=>({viewKey,contentHash:hash(viewKey),byteSize:123,
    storagePath:`users/${OWNER}/revisions/${revisionId}/inputs/${viewKey}/${hash(viewKey)}.png`,contentType:'image/png'}));
  const panels=surfaces.map((surfaceKey,index)=>({surfaceKey,contentHash:hash(`panel-${surfaceKey}`),
    sourceMasterHash:masterHash,storagePath:`designpro/${tenant}/${GENERATION}/panels/${surfaceKey}.png`,
    trimWidthIn:100+index,trimHeightIn:50,printWidthIn:110+index,printHeightIn:60}));
  const snapshot={generationId:GENERATION,designId:'DID-33333333',orderNumber:'ORDER-1',delivery:{orderNumber:'ORDER-1'},
    callOnePanels:panels,renderAssets:Object.fromEntries(views.map(({viewKey,...value})=>[viewKey,value])),
    ...(threeZone?{panelProofAuthoring:{proofSha256:SHEET_HASH,proofStoragePath:`atlas-panel-proof/${SHEET_HASH}.png`,proofByteSize:4321}}:{})};
  const fulfillment={contractVersion:'designpro.fulfillment-binding.v1',revisionId,bindingHash:hash('fulfillment'),orderNumber:'ORDER-1',delivery:{orderNumber:'ORDER-1'}};
  const authorized={products:['print_pack_entitlement'],productionPackAuthorized:true,logoPackAuthorized:false,requiredOutputFiles:18,zipIncludesSourceViews:true};
  const dimensionManifest={contract:'designpro.genie-dimension-manifest.v1',genieVerified:true,totalSqFt:213.54,
    expectedSurfaces:panels.map(p=>({surfaceKey:p.surfaceKey,widthInches:p.trimWidthIn,heightInches:p.trimHeightIn}))};
  for(const [id,type] of [[runId,'designpro.production_pack'],[enticeId,'designpro.entice_pack']]) {
    await db.query(`INSERT INTO public.designpro_workflow_runs(id,workflow_type,owner_id,tenant_key,revision_id,revision_snapshot_hash,
      entice_pack_id,dimension_manifest_id,source_contract_hash,manifest_hash,artifact_set_hash,input,results,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'running')`,
      [id,type,OWNER,tenant,revisionId,snapshotHash,enticeId,manifestId,hash('source'),manifestHash,hash('artifacts'),JSON.stringify({fulfillment,sourceEnticeRunId:enticeId}),JSON.stringify({sourceEnticeRunId:enticeId,dimensionManifest})]);
  }
  await db.query('INSERT INTO public.designpro_revision_sources VALUES($1,$2,$3,$4,$5,$6,$7)',[revisionId,OWNER,tenant,GENERATION,requestId,snapshotHash,JSON.stringify(snapshot)]);
  await db.query('INSERT INTO public.designpro_purchase_entitlements VALUES($1,$2,$3,$4,29900,now())',[OWNER,enticeId,GENERATION,'print_pack_entitlement']);
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
  for(const surfaceKey of surfaces)for(const format of ['png','tiff','eps']) {
    const file={surfaceKey,format,contentHash:hash(`output-${surfaceKey}-${format}`),byteSize:456,
      storagePath:`designpro/${tenant}/${runId}/output/${surfaceKey}.${format}`,dpi:1500,outputScale:0.1,
      fullScaleBleedInches:5,colorSpace:'sRGB',widthPixels:16500,heightPixels:9000};
    files.push(file);await artifact(db,runId,outputStage.id,{...file,kind:'output',metadata:{format,width:file.widthPixels,height:file.heightPixels,dpi:1500,outputScale:0.1,fullScaleBleedInches:5}});
  }
  const output={verified:true,receiptKind:'output.verified',authorizedAssetManifest:authorized,proofJoin:join,contract:'designpro.output-verification.v1',
      exactSurfaceSet:surfaces,exactFormatSet:['png','tiff','eps'],fileCount:18,fullScalePixelsPerInch:150,fileDpi:1500,outputScale:0.1,
      fullScaleBleedInchesPerEdge:5,files,outputHashes:files.map(f=>f.contentHash)};
  const identity={workflowRunId:runId,revisionId,enticePackId:enticeId,dimensionManifestId:manifestId,
    sourceContractHash:hash('source'),manifestHash,artifactSetHash:hash('artifacts')};
  return {runId,tenant,outputStage,gate,stampStage,join,output,identity,flatProof};
}
const complete=(db,f,s,receipt,artifacts=[])=>db.query('SELECT public.complete_designpro_stage($1,$2,$3,$4,$5,$6) AS result',
  [s.id,s.token,JSON.stringify(f.identity),JSON.stringify(receipt),receipt.stampHash||hashJson(receipt),JSON.stringify(artifacts)]);
async function approve(db,f) {
  const checks={known:true,pass:true,outputHashesVerified:true,printDimensionsVerified:true,colorModeVerified:true,designId:'DID-33333333',orderNumber:'ORDER-1'};
  return db.query('SELECT public.approve_designpro_human_gate($1,\'await_final_human_qc\',$2,\'approval-1\',$3) AS result',[f.runId,OWNER,JSON.stringify(checks)]);
}
// The runtime's stamp: seal + stamped Call 8 proof + certificate + seven views,
// plus (on a three-zone revision) the sealed TriZone sheet.
async function stampFixture(db,f,{sheet=true}={}) {
  const approval=(await db.query("SELECT receipt FROM public.designpro_stage_receipts WHERE run_id=$1 AND receipt_kind='final.human-qc'",[f.runId])).rows[0].receipt;
  const receipt={verified:true,receiptKind:'stamp',designId:'DID-33333333',orderNumber:'ORDER-1',verifiedBy:approval.verifiedBy,
    approvalRef:approval.approvalRef,approvedAt:approval.approvedAt,sealHash:hash('seal'),stampHash:hash('stamped-proof'),
    certificateHash:hash('certificate'),sourceProofHash:f.flatProof.contentHash,proofJoin:f.output.proofJoin,stampedViews:[],stampedProductionPanelProof:null};
  const metadata={designId:receipt.designId,orderNumber:receipt.orderNumber,verifiedBy:receipt.verifiedBy,approvalRef:receipt.approvalRef,approvedAt:receipt.approvedAt};
  const artifacts=['seal','stamped-proof','certificate'].map(surfaceKey=>({kind:'stamp',surfaceKey,contentHash:hash(surfaceKey),byteSize:999,
    storagePath:`designpro/${f.tenant}/${f.runId}/proof/${surfaceKey}.png`,metadata:{...metadata,...(surfaceKey==='stamped-proof'?{sourceProofHash:receipt.sourceProofHash}: {})}}));
  if(sheet) {
    const storagePath=`designpro/${f.tenant}/${f.runId}/stamped-trizone-production-panel-proof.png`;
    receipt.stampedProductionPanelProof={storagePath,contentHash:hash('stamped-sheet'),byteSize:5555,sourceProofHash:SHEET_HASH,sourceProofPath:`atlas-panel-proof/${SHEET_HASH}.png`};
    artifacts.push({kind:'stamp',surfaceKey:'stamped-production-panel-proof',storagePath,contentHash:hash('stamped-sheet'),byteSize:5555,
      metadata:{...metadata,role:'qc-approved-production-panel-proof',sourceProofHash:SHEET_HASH,sourceProofPath:`atlas-panel-proof/${SHEET_HASH}.png`,sealHash:receipt.sealHash}});
  }
  for(const v of f.output.proofJoin.sourceViews) {
    const s={viewKey:v.viewKey,storagePath:`designpro/${f.tenant}/${f.runId}/proof/stamped-view-${v.viewKey}-${v.contentHash.slice(0,24)}.png`,
      contentHash:hash(`stamp-${v.viewKey}`),byteSize:987,sourceProofHash:v.contentHash,sourceProofPath:v.storagePath};
    receipt.stampedViews.push(s);
    artifacts.push({kind:'stamp',surfaceKey:`stamped-view-${v.viewKey}`,storagePath:s.storagePath,contentHash:s.contentHash,byteSize:s.byteSize,
      metadata:{...metadata,sourceViewKey:v.viewKey,sourceProofHash:v.contentHash,sourceProofPath:v.storagePath,sealHash:receipt.sealHash,sourceViewSetHash:f.join.sourceViewSetHash}});
  }
  await db.query("UPDATE public.designpro_workflow_stages SET status='running' WHERE id=$1",[f.stampStage.id]);
  return {receipt,artifacts};
}
// output.verify is seeded as the RPC leaves it (completed, its `output.verified`
// receipt recorded, the final gate `waiting`, the run `approval_required`)
// rather than driven through the RPC: its arm now demands the whole Call 12
// output.build receipt, which is a different contract and its own lock.
async function ready(db,threeZone) {
  const f=await fixture(db,{threeZone});
  await db.query(`UPDATE public.designpro_workflow_stages SET status='completed',output=$2,verification='{"verified":true}',output_hash=$3,
    lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,completed_at=now() WHERE id=$1`,[f.outputStage.id,JSON.stringify(f.output),hashJson(f.output)]);
  await db.query("INSERT INTO public.designpro_stage_receipts(run_id,stage_id,receipt_kind,identity,receipt,receipt_hash) VALUES($1,$2,'output.verified',$3,$4,$5)",
    [f.runId,f.outputStage.id,JSON.stringify(f.identity),JSON.stringify(f.output),hashJson(f.output)]);
  await db.query("UPDATE public.designpro_workflow_stages SET status='waiting',wait_reason='final_human_qc_required' WHERE id=$1",[f.gate.id]);
  await db.query('SELECT public.designpro_sync_run_status($1)',[f.runId]);
  await approve(db,f);
  return f;
}
const sheetStamp=artifacts=>artifacts.find(a=>a.surfaceKey==='stamped-production-panel-proof');

test('pre-fix: the stamp.build gate refuses the sealed TriZone sheet on a three-zone revision (the defect)',async t=>{
  const {db}=await database({apply:false});t.after(()=>db.close());
  const f=await ready(db,true);const s=await stampFixture(db,f);
  await assert.rejects(complete(db,f,f.stampStage,s.receipt,s.artifacts),/exact_stamp_artifact_set_required/);
});

test('the sealed TriZone sheet is admitted as the eleventh stamp, bound to the frozen sheet hash',async t=>{
  const {db,before}=await database();t.after(()=>db.close());
  const f=await ready(db,true);const s=await stampFixture(db,f);
  // Bound: the wrong sheet hash, a receipt naming a different artifact, a
  // missing receipt entry, a second copy, a foreign seal hash — all refused.
  const wrongHash=clone(s.artifacts);sheetStamp(wrongHash).metadata.sourceProofHash=hash('some-other-sheet');
  await assert.rejects(complete(db,f,f.stampStage,s.receipt,wrongHash),/production_panel_proof_stamp_invalid/);
  const wrongReceipt=clone(s.receipt);wrongReceipt.stampedProductionPanelProof.contentHash=hash('not-the-artifact');
  await assert.rejects(complete(db,f,f.stampStage,wrongReceipt,s.artifacts),/production_panel_proof_stamp_invalid/);
  const wrongSource=clone(s.receipt);wrongSource.stampedProductionPanelProof.sourceProofHash=hash('some-other-sheet');
  await assert.rejects(complete(db,f,f.stampStage,wrongSource,s.artifacts),/production_panel_proof_stamp_invalid/);
  const unreceipted=clone(s.receipt);unreceipted.stampedProductionPanelProof=null;
  await assert.rejects(complete(db,f,f.stampStage,unreceipted,s.artifacts),/production_panel_proof_stamp_invalid/);
  const doubled=clone(s.artifacts);doubled.push(clone(sheetStamp(s.artifacts)));
  await assert.rejects(complete(db,f,f.stampStage,s.receipt,doubled),/production_panel_proof_stamp_invalid/);
  const foreignSeal=clone(s.artifacts);sheetStamp(foreignSeal).metadata.sealHash=hash('other-seal');
  await assert.rejects(complete(db,f,f.stampStage,s.receipt,foreignSeal),/production_panel_proof_stamp_invalid/);
  // The ten-stamp set with a receipt that CLAIMS a sheet stamp is refused too.
  const claimed=clone(s.artifacts).filter(a=>a.surfaceKey!=='stamped-production-panel-proof');
  await assert.rejects(complete(db,f,f.stampStage,s.receipt,claimed),/production_panel_proof_stamp_unreceipted/);
  assert.equal((await complete(db,f,f.stampStage,s.receipt,s.artifacts)).rows[0].result,true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.designpro_artifacts WHERE run_id=$1 AND artifact_kind='stamp'",[f.runId])).rows[0].n,11);
  const after=(await db.query("SELECT pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure) AS body")).rows[0].body;
  assert.equal(after.split("  IF v_stage.stage_key='stamp.build'")[0],before.split("  IF v_stage.stage_key='stamp.build'")[0]);
  assert.equal(after.slice(after.indexOf("  IF v_stage.stage_key='zip.build'")),before.slice(before.indexOf("  IF v_stage.stage_key='zip.build'")));
  assert.doesNotMatch(after,/pg_catalog\.coalesce/i);
});

test('a three-zone revision stamped by a runtime that has not learned the sheet still completes (ship-order window)',async t=>{
  const {db}=await database();t.after(()=>db.close());
  const f=await ready(db,true);const s=await stampFixture(db,f,{sheet:false});
  const legacyReceipt=clone(s.receipt);delete legacyReceipt.stampedProductionPanelProof;
  assert.equal((await complete(db,f,f.stampStage,legacyReceipt,s.artifacts)).rows[0].result,true);
});

test('a revision with no three-zone sheet gets no fourth stamp and may not claim one',async t=>{
  const {db}=await database();t.after(()=>db.close());
  const f=await ready(db,false);
  const withSheet=await stampFixture(db,f,{sheet:true});
  await assert.rejects(complete(db,f,f.stampStage,withSheet.receipt,withSheet.artifacts),/production_panel_proof_stamp_without_sheet/);
  const s=await stampFixture(db,f,{sheet:false});
  assert.equal((await complete(db,f,f.stampStage,s.receipt,s.artifacts)).rows[0].result,true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.designpro_artifacts WHERE run_id=$1 AND artifact_kind='stamp'",[f.runId])).rows[0].n,10);
});

test('the migration is idempotent',async t=>{
  const {db}=await database();t.after(()=>db.close());
  const once=(await db.query("SELECT pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure) AS body")).rows[0].body;
  await db.exec(await readMigration(MIGRATION));
  const twice=(await db.query("SELECT pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure) AS body")).rows[0].body;
  assert.equal(twice,once);
});
