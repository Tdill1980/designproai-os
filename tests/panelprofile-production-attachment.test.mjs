import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const bridge=require('../runtime/panelpro-production-attachment.cjs');
const {panelProfileZipEntries}=require('../runtime/designpro-standalone-claimant.cjs')._test;
const {createDeterministicZip64Stream}=require('../runtime/output-qc.cjs');
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const PARENT='33333333-3333-4333-8333-333333333333',CHILD='44444444-4444-4444-8444-444444444444';
const REV='55555555-5555-4555-8555-555555555555',GEN='66666666-6666-4666-8666-666666666666',SOURCE='77777777-7777-4777-8777-777777777777';
const STAGE='88888888-8888-4888-8888-888888888888',TOKEN='99999999-9999-4999-8999-999999999999';
const HASH='a'.repeat(64),MASTER='b'.repeat(64),ARTIFACTS='c'.repeat(64);
const sql=await readFile(new URL('../supabase/migrations/20260908195123_designpro_panelprofile_production_attachment.sql',import.meta.url),'utf8');
async function database() {
  const db=new PGlite();
  await db.exec(`CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE SCHEMA designpro_private;
    CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256($1)$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz);
    CREATE TABLE public.designpro_qc_members(user_id uuid PRIMARY KEY,can_preflight boolean);
    CREATE TABLE public.designpro_workflow_runs(id uuid PRIMARY KEY,owner_id uuid,revision_id uuid,revision_snapshot_hash text,manifest_hash text,
      workflow_type text,status text,input jsonb DEFAULT '{}');
    CREATE TABLE public.designpro_revision_sources(revision_id uuid PRIMARY KEY,generation_id uuid,owner_id uuid,snapshot_hash text,snapshot jsonb);
    CREATE TABLE public.designpro_workflow_stages(id uuid PRIMARY KEY,run_id uuid,stage_key text,status text,attempt int DEFAULT 0,started_at timestamptz,
      verification jsonb DEFAULT '{}',output jsonb DEFAULT '{}',lease_token uuid,lease_owner text,lease_expires_at timestamptz,available_at timestamptz,wait_reason text,updated_at timestamptz);
    CREATE TABLE public.designpro_stage_receipts(run_id uuid,receipt_kind text,receipt jsonb);
    CREATE TABLE public.designpro_artifacts(run_id uuid,artifact_kind text,storage_path text,content_hash text);
    CREATE TABLE public.panelprofile_source_handoffs(id uuid PRIMARY KEY,owner_id uuid,source_app text,revision_id text,generation_id text,input_hash text,handoff jsonb,design_id text,order_id text);
    CREATE TABLE public.panelprofile_runs(id uuid PRIMARY KEY,owner_id uuid,source_id uuid,state text,input_hash text,artifact_set_hash text);
    CREATE TABLE public.panelprofile_nodes(run_id uuid,node_key text,state text,output jsonb);
    CREATE TABLE public.panelprofile_artifacts(run_id uuid,role text,piece_id text,storage_path text,content_hash text,byte_size bigint,mime_type text);
    CREATE FUNCTION public.panelprofile_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable_record';END$$;
    CREATE FUNCTION public.designpro_sync_run_status(uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
    CREATE FUNCTION designpro_private.assert_final_proof_join(p_run_id uuid,p_output_receipt jsonb DEFAULT NULL)
      RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $fn$
DECLARE v_run public.designpro_workflow_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=p_run_id;
  RETURN '{"existingProofGateRetained":true}'::jsonb;
END $fn$;
    INSERT INTO auth.users VALUES('${OWNER}',now()),('${OTHER}',now());
    INSERT INTO public.designpro_qc_members VALUES('${OWNER}',true);`);
  await db.exec(sql);
  return db;
}
async function fixture(db) {
  const snapshot={designId:'DID-66666666',orderNumber:'FIXTURE-1',callOnePanels:['driver','passenger','hood','roof','front','rear'].map(surfaceKey=>({surfaceKey,sourceMasterHash:MASTER}))};
  const handoff={dimensionManifestHash:HASH,master:{contentHash:MASTER},pieces:[{pieceId:'driver-piece',composition:null}],template:{templateId:'verified-template',version:'1',profileHash:HASH,geometryHash:HASH}};
  await db.query('INSERT INTO public.designpro_workflow_runs VALUES($1,$2,$3,$4,$4,$5,$6,$7)',[PARENT,OWNER,REV,HASH,'designpro.production_pack','running','{}']);
  await db.query('INSERT INTO public.designpro_revision_sources VALUES($1,$2,$3,$4,$5)',[REV,GEN,OWNER,HASH,JSON.stringify(snapshot)]);
  await db.query("INSERT INTO public.designpro_workflow_stages(id,run_id,stage_key,status) VALUES($1,$2,'output.verify','pending')",[STAGE,PARENT]);
  await db.query("INSERT INTO public.designpro_workflow_stages(id,run_id,stage_key,status,verification,output) VALUES(gen_random_uuid(),$1,'await_purchase','completed',$2,$3)",[PARENT,'{"verified":true}','{"authorizedAssetManifest":{"productionPackAuthorized":true}}']);
  await db.query('INSERT INTO public.panelprofile_source_handoffs VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[SOURCE,OWNER,'DesignPro',REV,GEN,HASH,JSON.stringify(handoff),'DID-66666666','FIXTURE-1']);
  await db.query('INSERT INTO public.panelprofile_runs VALUES($1,$2,$3,$4,$5,$6)',[CHILD,OWNER,SOURCE,'completed',HASH,ARTIFACTS]);
  const approval={actorId:OWNER,approvalRef:'fixture-actual-child-review',approvedAt:'2026-09-08T20:00:00Z',artifactSetHash:ARTIFACTS,qcApproved:true,
    checks:{template:true,fit:true,essentialArtworkSafe:true,backgroundContinuous:true,fiveInchBleed:true,resolution:true,physicalPieces:true,filesInspected:true}};
  const files=[];
  for(const [i,[role,ext,mimeType]] of [['production-png','png','image/png'],['production-tiff','tiff','image/tiff'],['production-pdf','pdf','application/pdf'],['qc-panel-copy','png','image/png'],['production-panel-proof','png','image/png'],['reviewed-package','zip','application/zip']].entries()) {
    const storagePath=`designpro/user_${OWNER}/${CHILD}/panelprofile/${role}-${HASH}.${ext}`;
    const file={role,pieceId:role==='reviewed-package'?'':'driver-piece',storagePath,contentHash:(i+1).toString().repeat(64),byteSize:128+i,mimeType};files.push(file);
    await db.query('INSERT INTO public.panelprofile_artifacts VALUES($1,$2,$3,$4,$5,$6,$7)',[CHILD,role,file.pieceId,storagePath,file.contentHash,file.byteSize,mimeType]);
  }
  const zip=files.find(f=>f.role==='reviewed-package');
  const nodes=[['await_panelpro_preflight_qc',approval],['panelprofileoutput.verify',{verified:true,inputHash:HASH,artifactSetHash:ARTIFACTS}],
    ['panelprofileoutput.package',{artifactSetHash:ARTIFACTS,approval,zip}],['panelprofileoutput.handoff',{qcApproved:true,requiresProofRefresh:false,artifactSetHash:ARTIFACTS}],
    ['panelprofileoutput.render:driver-piece',{pieces:[{pieceId:'driver-piece',placements:[],evidence:{cutAreaFill:'source-coverage-review'}}]}]];
  for(const [key,value]of nodes)await db.query("INSERT INTO public.panelprofile_nodes VALUES($1,$2,'completed',$3)",[CHILD,key,JSON.stringify(value)]);
  return {files:files.sort((a,b)=>a.storagePath < b.storagePath ? -1 : a.storagePath > b.storagePath ? 1 : 0),handoff,approval};
}
const reserve=(db,actor=OWNER)=>db.query('SELECT public.reserve_panelprofile_for_production($1,$2) AS result',[actor,PARENT]);
const attach=(db,files,actor=OWNER)=>db.query('SELECT public.attach_panelprofile_to_production($1,$2,$3,$4) AS result',[actor,CHILD,PARENT,JSON.stringify(files)]);

test('PPO reservation holds final QC without spending retry attempts; attachment pins exact files and preserves parent proof gate',async t=>{
  const db=await database();t.after(()=>db.close());const {files}=await fixture(db);
  assert.equal((await db.query('SELECT designpro_private.assert_final_proof_join($1,$2) AS x',[PARENT,'{}'])).rows[0].x.existingProofGateRetained,true);
  await assert.rejects(reserve(db,OTHER),/permission_required/);
  await reserve(db);await reserve(db);
  await assert.rejects(db.query('SELECT designpro_private.assert_final_proof_join($1,$2)',[PARENT,'{}']),/production_panelprofile_pending/);
  await db.query("UPDATE public.designpro_workflow_stages SET status='running',attempt=1,started_at=now(),lease_token=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1",[STAGE,TOKEN]);
  assert.equal((await db.query('SELECT public.defer_designpro_for_panelprofile($1,$2) AS ok',[STAGE,OTHER])).rows[0].ok,false);
  assert.equal((await db.query('SELECT public.defer_designpro_for_panelprofile($1,$2) AS ok',[STAGE,TOKEN])).rows[0].ok,true);
  const parked=(await db.query('SELECT status,attempt,wait_reason FROM public.designpro_workflow_stages WHERE id=$1',[STAGE])).rows[0];
  assert.deepEqual(parked,{status:'retryable',attempt:0,wait_reason:'panelprofile_pending'});
  const saved=(await attach(db,files)).rows[0].result;
  assert.equal(saved.snapshot.files.length,6);assert.equal(saved.snapshot.approval.approvalRef,'fixture-actual-child-review');
  assert.equal(saved.snapshot.requiresProofRefresh,false);assert.equal(saved.snapshot.customerReleaseApproved,false);
  assert.equal((await attach(db,files)).rows[0].result.id,saved.id);
  const projection={attachmentId:saved.id,childRunId:saved.child_run_id,snapshotHash:saved.snapshot_hash,snapshot:saved.snapshot};
  await assert.rejects(db.query('SELECT designpro_private.assert_final_proof_join($1,$2)',[PARENT,'{}']),/attachment_approval_drift/);
  const passed=await db.query('SELECT designpro_private.assert_final_proof_join($1,$2) AS x',[PARENT,JSON.stringify({panelProfileAttachments:[projection]})]);
  assert.equal(passed.rows[0].x.existingProofGateRetained,true);
  await assert.rejects(db.query("UPDATE public.designpro_panelprofile_attachments SET snapshot='{}' WHERE id=$1",[saved.id]),/immutable_record/);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.query('SELECT * FROM public.designpro_panelprofile_attachments'),/permission denied/);
  await assert.rejects(reserve(db),/permission denied/);
  await db.exec('RESET ROLE');
});

test('PPO attachment rejects wrong source, changed file, missing review and all separated artwork rebuilds',async t=>{
  const db=await database();t.after(()=>db.close());const {files,handoff}=await fixture(db);
  await assert.rejects(attach(db,files,OTHER),/permission_required/);
  await assert.rejects(attach(db,files.slice(1)),/inventory_changed/);
  await db.query('UPDATE public.panelprofile_source_handoffs SET generation_id=$1 WHERE id=$2',[OTHER,SOURCE]);
  await assert.rejects(attach(db,files),/source_mismatch/);
  await db.query('UPDATE public.panelprofile_source_handoffs SET generation_id=$1 WHERE id=$2',[GEN,SOURCE]);
  await db.query('UPDATE public.panelprofile_source_handoffs SET handoff=$1 WHERE id=$2',[JSON.stringify({...handoff,pieces:[{pieceId:'driver-piece',composition:{rebuildFromSeparatedAssets:true}}]}),SOURCE]);
  await assert.rejects(attach(db,files),/proof_refresh_required/);
  await db.query('UPDATE public.panelprofile_source_handoffs SET handoff=$1 WHERE id=$2',[JSON.stringify(handoff),SOURCE]);
  await db.query("UPDATE public.panelprofile_nodes SET output=jsonb_set(output,'{pieces,0,placements}','[{\"moved\":true}]') WHERE run_id=$1 AND node_key LIKE 'panelprofileoutput.render:%'",[CHILD]);
  await assert.rejects(attach(db,files),/proof_refresh_required/);
  await db.query("UPDATE public.panelprofile_nodes SET state='waiting' WHERE run_id=$1 AND node_key='await_panelpro_preflight_qc'",[CHILD]);
  await assert.rejects(attach(db,files),/not_reviewed/);
});

test('reservation and unreserved attachment are refused once parent verification starts',async t=>{
  const db=await database();t.after(()=>db.close());const {files}=await fixture(db);
  await db.query("UPDATE public.designpro_workflow_stages SET status='running',attempt=1,started_at=now() WHERE id=$1",[STAGE]);
  await assert.rejects(reserve(db),/reservation_window_closed/);
  await assert.rejects(attach(db,files),/attachment_window_closed/);
});

test('artifact-changing child cannot silently pass the runtime bridge with only a false moved flag',()=>{
  const source={handoff:{pieces:[{composition:{rebuildFromSeparatedAssets:true}}]}};
  const nodes=[{output:{pieces:[{placements:[],evidence:{cutAreaFill:'source-coverage-review'}}]}}];
  assert.equal(bridge._test.changesArtwork(source,{requiresProofRefresh:false},nodes),true);
  source.handoff.pieces[0].composition=null;
  assert.equal(bridge._test.changesArtwork(source,{requiresProofRefresh:false},nodes),false);
  nodes[0].output.pieces[0].evidence.cutAreaFill='verified-existing-nonessential-background';
  assert.equal(bridge._test.changesArtwork(source,{requiresProofRefresh:false},nodes),true);
  const continuation=bridge._test.revisionContinuation({generation_id:GEN,revision_id:REV,handoff:{atlasRevisionId:SOURCE}},CHILD);
  const url=new URL(continuation.href,'https://test.invalid');
  assert.equal(url.pathname,'/revision-studio');assert.equal(url.searchParams.get('id'),GEN);
  assert.equal(url.searchParams.get('sourceRevisionId'),SOURCE);assert.equal(continuation.sourceWorkflowRevisionId,REV);
  assert.equal(url.searchParams.get('panelOutputRunId'),CHILD);
  assert.equal(continuation.autoApply,false);assert.equal(continuation.requiresAcceptedRevision,true);
});

function clientFor(db,stored) {
  const storage={download:async path=>stored.has(path)?{data:new Blob([stored.get(path)]),error:null}:{data:null,error:{statusCode:404,message:'not found'}}};
  return {storage:{from:()=>storage},from(table){
    assert.match(table,/^[a-z_]+$/);const filters=[];let single=false;
    const query={select(){return query;},eq(key,value){assert.match(key,/^[a-z_]+$/);filters.push([key,value]);return query;},
      maybeSingle(){single=true;return query;},async then(resolve,reject){try{
        const rows=(await db.query(`SELECT * FROM public.${table}${filters.length?' WHERE '+filters.map(([key],i)=>`${key}=$${i+1}`).join(' AND '):''}`,filters.map(([,value])=>value))).rows;
        return resolve({data:single?rows[0]||null:rows,error:null});
      }catch(error){return reject(error);}}};return query;
  },async rpc(name,args){
    assert.ok(['reserve_panelprofile_for_production','attach_panelprofile_to_production'].includes(name));
    const fields=name==='reserve_panelprofile_for_production'?['p_actor','p_production_run_id']:['p_actor','p_child_run_id','p_production_run_id','p_verified_inventory'];
    try {const values=fields.map(key=>typeof args[key]==='object'?JSON.stringify(args[key]):args[key]);
      return {data:(await db.query(`SELECT public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,values)).rows[0].result,error:null};
    }catch(error){return {data:null,error};}
  }};
}
async function collect(stream){const chunks=[];for await(const c of stream)chunks.push(c);return Buffer.concat(chunks);}
function unzipStoredZip64(bytes){
  let offset=0;const files=new Map();
  while(bytes.readUInt32LE(offset)===0x04034b50){
    const nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28);
    const name=bytes.toString('utf8',offset+30,offset+30+nameLength),extraOffset=offset+30+nameLength;
    assert.equal(bytes.readUInt16LE(extraOffset),1);
    const length=Number(bytes.readBigUInt64LE(extraOffset+4)),start=extraOffset+extraLength;
    files.set(name,bytes.subarray(start,start+length));offset=start+length+24;
  }
  assert.equal(bytes.readUInt32LE(offset),0x02014b50);return files;
}

test('reviewed child attachment streams every physical file and its ZIP beside unchanged parent output entries and refuses mutated bytes',async t=>{
  const db=await database();t.after(()=>db.close());const {files}=await fixture(db),stored=new Map();
  for(const file of files){
    const bytes=Buffer.from(`exact-reviewed-child-file:${file.role}\n${file.storagePath}`);stored.set(file.storagePath,bytes);
    file.contentHash=createHash('sha256').update(bytes).digest('hex');file.byteSize=bytes.length;
    await db.query('UPDATE public.panelprofile_artifacts SET content_hash=$1,byte_size=$2 WHERE storage_path=$3',[file.contentHash,file.byteSize,file.storagePath]);
  }
  await db.query("UPDATE public.panelprofile_nodes SET output=jsonb_set(output,'{zip}',$1) WHERE run_id=$2 AND node_key='panelprofileoutput.package'",[JSON.stringify(files.find(f=>f.role==='reviewed-package')),CHILD]);
  const sb=clientFor(db,stored),parent=(await db.query('SELECT * FROM public.designpro_workflow_runs WHERE id=$1',[PARENT])).rows[0];
  await bridge.reservePanelProfileForProduction({supabase:sb,actorId:OWNER,productionRunId:PARENT});
  await assert.rejects(bridge.loadPanelProfileAttachments(sb,parent),error=>error.code==='production_panelprofile_pending');
  const attached=await bridge.attachPanelProfileToProduction({supabase:sb,actorId:OWNER,productionRunId:PARENT,childRunId:CHILD});
  assert.equal(attached.status,'attached_for_final_human_qc');assert.equal(attached.customerReleaseApproved,false);
  const pinned=await bridge.loadPanelProfileAttachments(sb,parent,{verifyBytes:true});
  assert.equal(pinned[0].attachmentId,attached.attachmentId);
  assert.deepEqual(await bridge.assertPinnedPanelProfileAttachments(sb,parent,pinned),pinned);
  await assert.rejects(bridge.assertPinnedPanelProfileAttachments(sb,parent,[]),error=>error.code==='panelprofile_attachment_approval_drift');
  const parentEntries=Array.from({length:18},(_,i)=>({name:`output/parent-${i}.bin`,bytes:Buffer.from(`original-parent-output-${i}`)}));
  const entries=[...parentEntries,...panelProfileZipEntries(sb,pinned)];
  const zip=await collect(createDeterministicZip64Stream(entries)),again=await collect(createDeterministicZip64Stream(entries));
  assert.deepEqual(zip,again);const extracted=unzipStoredZip64(zip);assert.equal(extracted.size,24);
  for(const entry of parentEntries)assert.deepEqual(extracted.get(entry.name),entry.bytes);
  for(const file of bridge.attachmentArchiveFiles(pinned)){
    assert.ok(file.archivePath.startsWith(`panelprofile/${CHILD}/`));
    assert.deepEqual(extracted.get(file.archivePath),stored.get(file.storagePath));
  }
  const changed=files.find(f=>f.role==='production-tiff');stored.get(changed.storagePath)[0]^=1;
  await assert.rejects(collect(createDeterministicZip64Stream(entries)),error=>error.code==='zip_source_changed');
  await assert.rejects(bridge.attachPanelProfileToProduction({supabase:sb,actorId:OWNER,productionRunId:PARENT,childRunId:CHILD}),error=>error.code==='artifact_immutable_path_drift');
});

test('completed child cannot attach with a missing verification node or any unapproved manufacturing check',async t=>{
  const db=await database();t.after(()=>db.close());const {files,approval}=await fixture(db);
  await db.query("UPDATE public.panelprofile_nodes SET state='pending' WHERE run_id=$1 AND node_key='panelprofileoutput.verify'",[CHILD]);
  await assert.rejects(attach(db,files),/not_reviewed/);
  await db.query("UPDATE public.panelprofile_nodes SET state='completed' WHERE run_id=$1 AND node_key='panelprofileoutput.verify'",[CHILD]);
  const unsafe={...approval,checks:{...approval.checks,backgroundContinuous:false}};
  await db.query("UPDATE public.panelprofile_nodes SET output=$1 WHERE run_id=$2 AND node_key='await_panelpro_preflight_qc'",[JSON.stringify(unsafe),CHILD]);
  await db.query("UPDATE public.panelprofile_nodes SET output=jsonb_set(output,'{approval}',$1) WHERE run_id=$2 AND node_key='panelprofileoutput.package'",[JSON.stringify(unsafe),CHILD]);
  await assert.rejects(attach(db,files),/not_reviewed/);
});

test('optional child cannot bypass an existing separated-logo entitlement through its reusable assets',async t=>{
  const db=await database();t.after(()=>db.close());const {files,handoff}=await fixture(db);
  const separated={assetId:'brand-asset',kind:'vector',storagePath:`designpro/user_${OWNER}/${PARENT}/logos/extracted.png`,contentHash:MASTER};
  await db.query('INSERT INTO public.designpro_artifacts VALUES($1,$2,$3,$4)',[PARENT,'logo',separated.storagePath,separated.contentHash]);
  await db.query('UPDATE public.panelprofile_source_handoffs SET handoff=$1 WHERE id=$2',[JSON.stringify({...handoff,availableAssets:[separated]}),SOURCE]);
  await assert.rejects(attach(db,files),/logo_entitlement_required/);
  await db.query("UPDATE public.designpro_workflow_stages SET output=jsonb_set(output,'{authorizedAssetManifest,logoPackAuthorized}','true') WHERE run_id=$1 AND stage_key='await_purchase'",[PARENT]);
  assert.equal((await attach(db,files)).rows[0].result.snapshot.requiresProofRefresh,false);
});
