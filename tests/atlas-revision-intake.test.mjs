import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createPanelProfileTestAdapter } from './helpers/panelprofile-service-fixture.mjs';
import { runDurableImageProviderRequest, prepareAtlasRevisionProviderContents } from '../supabase/functions/_shared/gemini-provider-cache.mjs';
const require = createRequire(new URL('../runtime/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const { createAtlasRevisionIntake, hashRevisionContext, prepareAtlasRevisionClaim } = require('../runtime/atlas-revision-intake.cjs');
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',GEN='33333333-3333-4333-8333-333333333333';
const surfaces=['driver','passenger','hood','roof','front','rear'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
function extract(text,name){const start=text.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);assert.ok(start>=0,name);const tail=text.slice(start);const tag=tail.match(/AS\s+(\$\w*\$)/i)[1];return tail.slice(0,tail.indexOf(tag,tail.indexOf(tag)+tag.length)+tag.length+1);}
async function database({legacyRevision=false}={}){
  const db=new PGlite();
  try{
  await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA designpro_private;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT COALESCE(NULLIF(current_setting('test.jwt',true),''),'{}')::jsonb$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULLIF(current_setting('test.uid',true),'')::uuid$$;
    CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256($1)$$;
    CREATE FUNCTION extensions.gen_random_uuid() RETURNS uuid LANGUAGE sql AS $$SELECT gen_random_uuid()$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    CREATE TABLE public.designpro_qc_members(user_id uuid PRIMARY KEY,can_preflight boolean,can_operate boolean);
    CREATE TABLE public.designpro_generation_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),generation_id uuid,owner_id uuid REFERENCES auth.users(id),tenant_key text,
      idempotency_key text,request_input jsonb,input_hash text,engine_contract jsonb,engine_contract_hash text,state text DEFAULT 'queued',attempt int DEFAULT 0,
      available_at timestamptz DEFAULT now(),lease_owner text,lease_token uuid,lease_expires_at timestamptz,engine_receipt jsonb,error jsonb,output_set_hash text,
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),completed_at timestamptz,
      UNIQUE(owner_id,generation_id),UNIQUE(tenant_key,idempotency_key),CONSTRAINT designpro_generation_request_identity CHECK(true));
    CREATE UNIQUE INDEX designpro_generation_one_active_owner_idx ON public.designpro_generation_requests(owner_id) WHERE state IN ('queued','leased','retryable');
    CREATE TABLE public.designpro_flat_atlas_revisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid REFERENCES public.designpro_generation_requests(id),generation_id uuid,owner_id uuid,tenant_key text,
      parent_revision_id uuid REFERENCES public.designpro_flat_atlas_revisions(id),revision_sequence int,guide_storage_path text,guide_content_hash text,guide_byte_size bigint,guide_content_type text,
      master_storage_path text,master_content_hash text,master_byte_size bigint,master_content_type text,
      manifest_storage_path text,manifest_content_hash text,manifest_byte_size bigint,manifest_content_type text,manifest jsonb,
      projection_storage_path text,projection_content_hash text,projection_byte_size bigint,projection_content_type text,
      production_eligible boolean DEFAULT false,metadata jsonb,created_at timestamptz DEFAULT now(),UNIQUE(request_id,revision_sequence));
    CREATE TABLE public.designpro_generation_views(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid,source_view_type text,consumer_role text,
      storage_path text,content_hash text,byte_size bigint,content_type text,metadata jsonb DEFAULT '{}',superseded_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE public.designpro_revision_sources(revision_id uuid PRIMARY KEY,owner_id uuid,tenant_key text,generation_id uuid,visualization_id uuid,
      snapshot_hash text,snapshot jsonb,expected_updated_at timestamptz,idempotency_key text,created_at timestamptz DEFAULT now());
    CREATE TABLE public.designpro_workflow_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workflow_type text,owner_id uuid,tenant_key text,revision_id uuid,
      revision_snapshot_hash text,entice_pack_id uuid,idempotency_key text,input jsonb DEFAULT '{}',results jsonb DEFAULT '{}',status text DEFAULT 'pending',
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(tenant_key,workflow_type,idempotency_key));
    CREATE TABLE public.designpro_workflow_stages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid,stage_key text,sequence int,idempotency_key text,input jsonb,
      status text DEFAULT 'pending',depends_on text[],attempt int DEFAULT 0,wait_reason text,error_code text,completed_at timestamptz,verification jsonb,
      available_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(run_id,stage_key));
    CREATE TABLE public.designpro_artifacts(id uuid,run_id uuid,stage_id uuid,artifact_kind text,surface_key text,storage_path text,content_hash text,byte_size bigint,metadata jsonb,created_at timestamptz);
    CREATE TABLE public.designpro_stage_receipts(id uuid,run_id uuid,stage_id uuid,receipt_kind text,receipt_hash text,identity jsonb,created_at timestamptz);
    CREATE TABLE public.designpro_generation_os_events(id bigint,generation_id uuid,event_type text,revision_id uuid,run_id uuid,stage_key text,state text,payload jsonb,created_at timestamptz);
    CREATE TABLE public.designpro_purchase_entitlements(id uuid DEFAULT gen_random_uuid(),owner_id uuid,entice_run_id uuid,generation_id uuid,product_type text,amount_cents int,paid_at timestamptz);
    CREATE TABLE designpro_private.wrapbox_delivery_recipients(recipient_identity_hash text PRIMARY KEY,customer_id uuid,customer_auth_user_id uuid,customer_email text,order_number text);
    CREATE TABLE designpro_private.business_customer_bindings(customer_id uuid,customer_auth_user_id uuid,customer_email text);
    CREATE TABLE public.panelprofile_source_handoffs(id uuid PRIMARY KEY,owner_id uuid,source_app text,generation_id text,input_hash text,handoff jsonb);
    CREATE TABLE public.panelprofile_runs(id uuid PRIMARY KEY,source_id uuid,owner_id uuid,input_hash text,state text);
    CREATE FUNCTION designpro_private.calls_1_7_engine_contract() RETURNS jsonb LANGUAGE sql AS $$SELECT '{"contract":"calls17-test"}'::jsonb$$;
    CREATE FUNCTION designpro_private.calls_1_7_input_v3_valid(jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT $1->>'pipelineMode'='flat-first-atlas-v1'$$;
    CREATE FUNCTION designpro_private.caller_may_read_generation(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.designpro_generation_requests WHERE generation_id=$1 AND owner_id=auth.uid())$$;
    CREATE FUNCTION designpro_private.caller_is_design_staff() RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.designpro_qc_members WHERE user_id=auth.uid() AND can_preflight)$$;
    CREATE FUNCTION designpro_private.flat_first_atlas_requires_new_run(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    CREATE FUNCTION designpro_private.calls_1_7_handoff_state(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('handoffReady',(SELECT count(*)=7 FROM public.designpro_generation_views WHERE request_id=$1 AND superseded_at IS NULL))$$;
    INSERT INTO auth.users VALUES('${OWNER}','owner@example.test',now()),('${OTHER}','other@example.test',now());
    SET test.jwt='{"role":"service_role"}'; SET test.uid='${OWNER}';`);
  const fulfillment=await read('20260821200000_designpro_design_first_production_handoff.sql');
  const table=fulfillment.slice(fulfillment.indexOf('CREATE TABLE IF NOT EXISTS designpro_private.revision_fulfillment_bindings'),fulfillment.indexOf('CREATE OR REPLACE FUNCTION designpro_private.guard_revision_fulfillment_immutable'));
  await db.exec(table);
  for(const name of ['designpro_private.revision_fulfillment','public.designpro_paid_products','public.reconcile_designpro_purchase_gates'])await db.exec(extract(fulfillment,name));
  const flat=await read('20260820100000_designpro_flat_first_atlas_v1.sql');
  await db.exec(extract(flat,'public.create_designpro_flat_first_generation_request'));
  await db.exec(extract(flat,'designpro_private.validate_flat_atlas_revision_insert'));
  await db.exec(extract(flat,'designpro_private.reject_flat_atlas_mutation'));
  await db.exec(`CREATE TRIGGER designpro_flat_atlas_revision_validate BEFORE INSERT ON public.designpro_flat_atlas_revisions FOR EACH ROW EXECUTE FUNCTION designpro_private.validate_flat_atlas_revision_insert();
    CREATE TRIGGER designpro_flat_atlas_revisions_immutable BEFORE UPDATE OR DELETE ON public.designpro_flat_atlas_revisions FOR EACH ROW EXECUTE FUNCTION designpro_private.reject_flat_atlas_mutation();`);
  for(const [file,names] of [
    ['20260826070000_designpro_present_partial_atlas_views.sql',['public.designpro_generation_workspace']],
    ['20260826080000_designpro_library_tile_null_provider.sql',['public.designpro_generation_library']],
    ['20260829230100_designpro_generation_os_artifact_events.sql',['designpro_private.designpro_generation_phase','public.designpro_generation_os_snapshot']],
    ['20260825120000_designpro_atlas_enters_handoff.sql',['public.handoff_designpro_generation_to_production']],
    ['20260824000000_designpro_genie_deploys_on_order.sql',['public.create_designpro_entice_workflow']],
  ])for(const name of names)await db.exec(extract(await read(file),name));
  for(const [file,tag] of [['20260827100000_designpro_panels_do_not_wait_for_the_proof.sql','reorder'],['20260827110000_designpro_the_chain_dies.sql','entice']]){
    const source=await read(file),start=source.indexOf(`DO $${tag}$`),end=source.indexOf(`$${tag}$;`,start+8);
    await db.exec(source.slice(start,end+tag.length+3));
  }
  const delivery=await read('20260825121000_designpro_atlas_revision_source_admitted.sql');
  await db.exec(delivery.slice(delivery.indexOf('ALTER TABLE'),delivery.indexOf('CREATE OR REPLACE FUNCTION')));
  await db.exec(extract(delivery,'designpro_private.verify_revision_delivery_binding'));
  await db.exec(`CREATE TRIGGER source_delivery BEFORE INSERT ON public.designpro_revision_sources FOR EACH ROW EXECUTE FUNCTION designpro_private.verify_revision_delivery_binding();`);
  const fixture=await seedParent(db);
  if(legacyRevision)await db.query(`INSERT INTO public.designpro_flat_atlas_revisions(request_id,generation_id,owner_id,tenant_key,parent_revision_id,revision_sequence,master_content_hash,metadata)
    SELECT request_id,generation_id,owner_id,tenant_key,id,2,$2,metadata FROM public.designpro_flat_atlas_revisions WHERE id=$1`,[fixture.parentId,sha('existing-version-two')]);
  const before=(await db.query('SELECT to_jsonb(a) value FROM public.designpro_flat_atlas_revisions a')).rows[0].value;
  await db.exec(await read('20260908201216_designpro_parent_bound_atlas_revisions.sql'));
  const identity=await read('20260909062205_designpro_call1_reserved_identity.sql');
  for(const name of ['designpro_private.reserve_atlas_request_identity','designpro_private.atlas_request_identity','designpro_private.completed_atlas_identity','public.enqueue_designpro_atlas_revision_v2'])await db.exec(extract(identity,name));
  return {db,fixture,before};
  }catch(error){await db.close();throw error;}
}
async function seedParent(db){
  const requestId=randomUUID(),parentId=randomUUID(),master=Buffer.from('canonical-parent-artwork'),manifest=Buffer.from(JSON.stringify({contract:'fixture-geometry',vehicle:{type:'truck'}}));
  const prefix=`designpro/user_${OWNER}/${GEN}/flat-first/v1/revisions/1`;
  const masterRef={storagePath:`${prefix}/master/${sha(master)}.png`,contentHash:sha(master),byteSize:master.length,contentType:'image/png'};
  const manifestRef={storagePath:`${prefix}/manifest/${sha(manifest)}.json`,contentHash:sha(manifest),byteSize:manifest.length,contentType:'application/json'};
  const input={contractVersion:'designpro.calls-1-7-input.v3',pipelineMode:'flat-first-atlas-v1',brief:'A blue continuous design',designName:'Saved vehicle',vehicle:{year:'2024',make:'Ford',model:'F250',type:'car'}};
  await db.query(`INSERT INTO public.designpro_generation_requests(id,generation_id,owner_id,tenant_key,idempotency_key,request_input,input_hash,engine_contract,engine_contract_hash,state,completed_at,engine_receipt)
    VALUES($1,$2,$3,$4,$5,$6,$7,designpro_private.calls_1_7_engine_contract(),$8,'outputs_ready',now(),$9)`,
    [requestId,GEN,OWNER,`user_${OWNER}`,`calls17:${GEN}:${sha('input')}`,JSON.stringify(input),sha('input'),sha('engine'),JSON.stringify({handoffRevisionId:randomUUID(),vehicleClassResolution:{declared:'car',resolved:'truck',corrected:true,authority:'canonical-model-identity'}})]);
  const metadata={masterQcPassed:true,callOnePanels:surfaces.map(surfaceKey=>({surfaceKey,sourceMasterHash:sha(master),contentHash:sha(surfaceKey),storagePath:`designpro/user_${OWNER}/${GEN}/panels/${surfaceKey}.png`}))};
  await db.query(`INSERT INTO public.designpro_flat_atlas_revisions(id,request_id,generation_id,owner_id,tenant_key,revision_sequence,master_storage_path,master_content_hash,master_byte_size,master_content_type,
    manifest_storage_path,manifest_content_hash,manifest_byte_size,manifest_content_type,manifest,metadata)VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [parentId,requestId,GEN,OWNER,`user_${OWNER}`,masterRef.storagePath,masterRef.contentHash,masterRef.byteSize,masterRef.contentType,manifestRef.storagePath,manifestRef.contentHash,manifestRef.byteSize,manifestRef.contentType,manifest.toString(),JSON.stringify(metadata)]);
  return {requestId,parentId,input,masterRef,manifestRef,files:new Map([[masterRef.storagePath,master],[manifestRef.storagePath,manifest]])};
}
const payload=f=>({generationId:GEN,parentAtlasRevisionId:f.parentId,parentMasterContentHash:f.masterRef.contentHash,instruction:'Move the existing logo clear of the handle.'});
async function acceptedChild(db,intake,f){
  const result=await intake.enqueue(OWNER,payload(f)),atlasId=result.atlasRevisionId,revisionId=result.handoffRevisionId,masterHash=sha(`child-${result.requestId}`);
  const row=(await db.query('SELECT * FROM public.designpro_generation_requests WHERE id=$1',[result.requestId])).rows[0];
  await db.query(`INSERT INTO public.designpro_flat_atlas_revisions(id,request_id,generation_id,owner_id,tenant_key,parent_revision_id,revision_sequence,master_content_hash,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[atlasId,result.requestId,GEN,OWNER,`user_${OWNER}`,f.parentId,result.revisionSequence,masterHash,JSON.stringify({masterQcPassed:true,revisionContextHash:row.revision_context_hash,
      callOnePanels:surfaces.map(surfaceKey=>({surfaceKey,sourceMasterHash:masterHash,contentHash:sha(`new-${surfaceKey}`),storagePath:`designpro/user_${OWNER}/${GEN}/panels/new-${surfaceKey}.png`}))})]);
  for(const role of [...surfaces,'closeup'])await db.query(`INSERT INTO public.designpro_generation_views(request_id,source_view_type,consumer_role,storage_path,content_hash,byte_size,content_type,metadata)
    VALUES($1,$2,$2,$3,$4,42,'image/png',$5)`,[result.requestId,role,`designpro/user_${OWNER}/${GEN}/calls-1-7/${role}/${sha(role)}.png`,sha(role),JSON.stringify({provider:{atlasMasterContentHash:masterHash},authority:{revisionId:atlasId}})]);
  await db.query(`UPDATE public.designpro_generation_requests SET state='outputs_ready',completed_at=now(),engine_receipt=engine_receipt||$2::jsonb WHERE id=$1`,[result.requestId,JSON.stringify({handoffRevisionId:revisionId,flatAtlas:{revisionId:atlasId}})]);
  return {...result,atlasId,revisionId,masterHash};
}

test('actual migration preserves saved history, concurrent idempotency and increasing branch sequences',async()=>{
  const {db,fixture:f,before}=await database();
  try{
    assert.deepEqual((await db.query('SELECT to_jsonb(a) value FROM public.designpro_flat_atlas_revisions a')).rows[0].value,before);
    const adapter=createPanelProfileTestAdapter(db,f.files),intake=createAtlasRevisionIntake({supabase:adapter.supabase});
    const [one,two]=await Promise.all([intake.enqueue(OWNER,payload(f)),intake.enqueue(OWNER,payload(f))]);
    assert.equal(one.requestId,two.requestId);assert.equal(one.revisionSequence,2);assert.equal(two.idempotent,true);
    assert.equal(one.atlasRevisionId,two.atlasRevisionId);assert.equal(one.handoffRevisionId,two.handoffRevisionId);
    assert.notEqual(one.atlasRevisionId,one.handoffRevisionId);assert.notEqual(one.atlasRevisionId,f.parentId);
    assert.equal(one.designId,'DID-33333333');assert.equal(one.atlasIdentityContract,'designpro.atlas-identity-at-prompt.v2');
    await assert.rejects(intake.enqueue(OTHER,payload(f)),{code:'generation_access_denied'});
    await assert.rejects(db.query("UPDATE public.designpro_generation_requests SET revision_context='{}' WHERE id=$1",[one.requestId]),/atlas_request_identity_is_immutable/);
    await db.query("UPDATE public.designpro_generation_requests SET state='failed' WHERE id=$1",[one.requestId]);
    const branch=await intake.enqueue(OWNER,{...payload(f),instruction:'Keep the old version but move the phone number.'});
    assert.equal(branch.revisionSequence,3);assert.equal(branch.parentAtlasRevisionId,f.parentId);
    assert.notEqual(branch.atlasRevisionId,one.atlasRevisionId);assert.notEqual(branch.handoffRevisionId,one.handoffRevisionId);
    assert.equal(branch.designId,one.designId);
    const workspace=(await db.query('SELECT public.designpro_generation_workspace($1) x',[GEN])).rows[0].x;
    assert.equal(workspace.requestId,branch.requestId);assert.deepEqual(workspace.views,[]);
    const os=(await db.query('SELECT public.designpro_generation_os_snapshot($1) x',[GEN])).rows[0].x;
    assert.equal(os.requestId,branch.requestId);assert.equal(os.revisions.length,1);assert.equal(os.revisions[0].revisionId,f.parentId);
    assert.equal(os.phase,'queued');
    const library=(await db.query('SELECT public.designpro_generation_library() x')).rows[0].x;
    assert.equal(library.length,1);assert.equal(library[0].requestId,branch.requestId);assert.equal(library[0].revisionCount,1);
    assert.equal((await db.query('SELECT count(*) n FROM public.designpro_generation_requests')).rows[0].n,3);
  }finally{await db.close();}
});

test('historical immutable snapshot and real artwork override an unused v1 handoff seed without rewriting the old row',async()=>{
  const {db,fixture:f}=await database();try{
    for(const role of [...surfaces,'closeup'])await db.query(`INSERT INTO public.designpro_generation_views(request_id,source_view_type,consumer_role,storage_path,content_hash,byte_size,content_type,metadata)
      VALUES($1,$2,$2,$3,$4,42,'image/png',$5)`,[f.requestId,role,`designpro/user_${OWNER}/${GEN}/calls-1-7/${role}/${sha(role)}.png`,sha(role),JSON.stringify({provider:{atlasMasterContentHash:f.masterRef.contentHash},authority:{revisionId:f.parentId}})]);
    await db.exec("SET test.jwt='{\"role\":\"authenticated\"}'");
    const saved=(await db.query('SELECT public.handoff_designpro_generation_to_production($1) x',[f.requestId])).rows[0].x;
    await db.query("UPDATE public.designpro_generation_requests SET engine_receipt=$2 WHERE id=$1",[f.requestId,JSON.stringify({handoffRevisionId:randomUUID(),atlasIdentityContract:'designpro.atlas-identity-at-prompt.v1'})]);
    const before=(await db.query('SELECT to_jsonb(r) x FROM public.designpro_generation_requests r WHERE id=$1',[f.requestId])).rows[0].x;
    const projected=(await db.query('SELECT designpro_private.atlas_request_identity(r) x FROM public.designpro_generation_requests r WHERE id=$1',[f.requestId])).rows[0].x;
    assert.equal(projected.handoffRevisionId,saved.revisionId);assert.equal(projected.atlasRevisionId,f.parentId);
    assert.equal(projected.designId,'DID-33333333');assert.equal(projected.atlasIdentityMintedAt,undefined);
    assert.deepEqual((await db.query('SELECT to_jsonb(r) x FROM public.designpro_generation_requests r WHERE id=$1',[f.requestId])).rows[0].x,before);
    await assert.rejects(db.query('SELECT designpro_private.completed_atlas_identity(r,$2) FROM public.designpro_generation_requests r WHERE id=$1',
      [f.requestId,JSON.stringify({handoffRevisionId:before.engine_receipt.handoffRevisionId,flatAtlas:{revisionId:f.parentId}})]),/generation_handoff_identity_conflict/);
    const receipt=(await db.query('SELECT designpro_private.completed_atlas_identity(r,$2) x FROM public.designpro_generation_requests r WHERE id=$1',
      [f.requestId,JSON.stringify({handoffRevisionId:saved.revisionId,flatAtlas:{revisionId:f.parentId},providerResult:'current'})])).rows[0].x;
    assert.equal(receipt.handoffRevisionId,saved.revisionId);assert.equal(receipt.flatAtlas.revisionId,f.parentId);assert.equal(receipt.providerResult,'current');
  }finally{await db.close();}
});

test('leased revision reuses measured parent geometry and saved vehicle-class correction; expired lease is refused',async()=>{
  const {db,fixture:f}=await database();try{
    const adapter=createPanelProfileTestAdapter(db,f.files),intake=createAtlasRevisionIntake({supabase:adapter.supabase});
    const result=await intake.enqueue(OWNER,payload(f)),token=randomUUID();
    await db.query("UPDATE public.designpro_generation_requests SET state='leased',lease_token=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1",[result.requestId,token]);
    const claim={requestId:result.requestId,generationId:GEN,claimToken:token};
    const prepared=await prepareAtlasRevisionClaim({supabase:adapter.supabase,claim,ownerId:OWNER});
    assert.equal(prepared.revisionSequence,2);assert.equal(prepared.executionInput.vehicle.type,'truck');
    assert.equal(prepared.parentManifest.vehicle.type,'truck');assert.equal(prepared.revisionContext.history.mode,'image-reference');
    assert.equal(hashRevisionContext(prepared.revisionContext),prepared.revisionContextHash);
    await db.query("UPDATE public.designpro_generation_requests SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",[result.requestId]);
    await assert.rejects(prepareAtlasRevisionClaim({supabase:adapter.supabase,claim,ownerId:OWNER}),{code:'atlas_revision_claim_invalid'});
  }finally{await db.close();}
});

test('pre-existing multi-version history survives and an older-parent branch advances past its saved highest sequence',async()=>{
  const {db,fixture:f}=await database({legacyRevision:true});try{
    const adapter=createPanelProfileTestAdapter(db,f.files),intake=createAtlasRevisionIntake({supabase:adapter.supabase});
    const child=await intake.enqueue(OWNER,payload(f));assert.equal(child.revisionSequence,3);
    const history=(await db.query('SELECT public.designpro_generation_os_snapshot($1) x',[GEN])).rows[0].x.revisions;
    assert.deepEqual(history.map(r=>r.revisionSequence),[2,1]);
    await assert.rejects(db.query(`INSERT INTO public.designpro_flat_atlas_revisions(request_id,generation_id,owner_id,tenant_key,parent_revision_id,revision_sequence,metadata)
      SELECT request_id,generation_id,owner_id,tenant_key,id,3,metadata FROM public.designpro_flat_atlas_revisions WHERE revision_sequence=2`),/flat_atlas_revision_lineage_invalid/);
  }finally{await db.close();}
});

test('explicit historical workspace reads only that ATLAS version and rejects cross-owner or mismatched-generation selection',async()=>{
  const {db,fixture:f}=await database();try{
    const adapter=createPanelProfileTestAdapter(db,f.files),intake=createAtlasRevisionIntake({supabase:adapter.supabase});
    const child=await acceptedChild(db,intake,f);
    for(const [role,master,superseded] of [['driver',f.masterRef.contentHash,false],['passenger',child.masterHash,false],['roof',f.masterRef.contentHash,true]]){
      await db.query(`INSERT INTO public.designpro_generation_views(request_id,source_view_type,consumer_role,storage_path,content_hash,byte_size,content_type,metadata,superseded_at)
        VALUES($1,$2,$2,$3,$4,42,'image/png',$5,CASE WHEN $6 THEN now() ELSE NULL END)`,[f.requestId,role,
        `designpro/user_${OWNER}/${GEN}/calls-1-7/${role}/${sha(`old-${role}`)}.png`,sha(`old-${role}`),
        JSON.stringify({provider:{atlasMasterContentHash:master},authority:{revisionId:f.parentId}}),superseded]);
    }
    const selected=(await db.query('SELECT public.designpro_atlas_revision_workspace($1,$2) x',[GEN,f.parentId])).rows[0].x;
    assert.equal(selected.requestId,f.requestId);assert.equal(selected.atlasRevisionId,f.parentId);assert.equal(selected.revisionSequence,1);
    assert.deepEqual(selected.views.map(v=>v.consumerRole),['driver']);assert.equal(selected.views[0].contentHash,sha('old-driver'));
    assert.equal((await db.query('SELECT public.designpro_generation_workspace($1) x',[GEN])).rows[0].x.requestId,child.requestId);
    const latest=(await db.query('SELECT public.designpro_atlas_revision_workspace($1,$2) x',[GEN,child.atlasId])).rows[0].x;
    assert.equal(latest.views.length,7);assert.ok(latest.views.every(v=>v.atlasRevisionId===child.atlasId));
    assert.equal((await db.query('SELECT public.designpro_atlas_revision_workspace($1,$2) x',[randomUUID(),f.parentId])).rows[0].x,null);
    await db.exec(`SET test.uid='${OTHER}'`);
    assert.equal((await db.query('SELECT public.designpro_atlas_revision_workspace($1,$2) x',[GEN,f.parentId])).rows[0].x,null);
    await db.query('INSERT INTO public.designpro_qc_members(user_id,can_preflight) VALUES($1,true)',[OTHER]);
    assert.equal((await db.query('SELECT public.designpro_atlas_revision_workspace($1,$2) x',[GEN,f.parentId])).rows[0].x.views[0].contentHash,sha('old-driver'));
    await db.exec("SET test.jwt='{\"role\":\"authenticated\",\"is_anonymous\":true}'");
    assert.equal((await db.query('SELECT public.designpro_atlas_revision_workspace($1,$2) x',[GEN,f.parentId])).rows[0].x,null);
  }finally{await db.close();}
});

test('actual source delivery trigger and entice function freeze child six panels + seven proofs and replay without another workflow',async()=>{
  const {db,fixture:f}=await database();try{
    const adapter=createPanelProfileTestAdapter(db,f.files),intake=createAtlasRevisionIntake({supabase:adapter.supabase});
    const child=await acceptedChild(db,intake,f);
    const results=await intake.drainHandoffs();assert.equal(results[0].state,'handed_off',JSON.stringify(results));
    const snapshot=(await db.query('SELECT snapshot FROM public.designpro_revision_sources WHERE revision_id=$1',[child.revisionId])).rows[0].snapshot;
    assert.equal(snapshot.atlasRevisionId,child.atlasId);assert.equal(snapshot.sourceInputContract,f.input.contractVersion);
    assert.equal(snapshot.callOnePanels.length,6);assert.equal(Object.keys(snapshot.renderAssets).length,7);assert.equal(snapshot.change.requiresFreshQc,true);
    assert.ok(snapshot.callOnePanels.every(p=>p.sourceMasterHash===child.masterHash));
    const repeated=(await db.query('SELECT public.handoff_designpro_atlas_revision($1) x',[child.requestId])).rows[0].x;
    assert.equal(repeated.alreadyHandedOff,true);assert.equal(repeated.workflowRunId,results[0].workflowRunId);
    assert.equal((await db.query('SELECT count(*) n FROM public.designpro_workflow_runs')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*) n FROM public.designpro_workflow_stages')).rows[0].n,7);
    assert.deepEqual((await db.query("SELECT depends_on FROM public.designpro_workflow_stages WHERE run_id=$1 AND stage_key='panels.build'",[repeated.workflowRunId])).rows[0].depends_on,['revision.freeze']);
    assert.deepEqual(await intake.drainHandoffs(),[]);
    assert.deepEqual((await db.query('SELECT public.designpro_paid_products($1) x',[repeated.workflowRunId])).rows[0].x,[]);
    // A crash from an older handoff implementation may have left its source
    // but no graph; replay repairs exactly that gap without replacing source.
    await db.query('DELETE FROM public.designpro_workflow_stages WHERE run_id=$1',[repeated.workflowRunId]);
    await db.query('DELETE FROM public.designpro_workflow_runs WHERE id=$1',[repeated.workflowRunId]);
    const recovered=(await intake.drainHandoffs())[0];assert.equal(recovered.state,'handed_off');assert.equal(recovered.alreadyHandedOff,true);
    assert.equal((await db.query('SELECT count(*) n FROM public.designpro_revision_sources')).rows[0].n,1);
  }finally{await db.close();}
});

test('handoff refuses mixed-version proofs, persists blocker and resumes after the source is actually corrected',async()=>{
  const {db,fixture:f}=await database();try{
    const adapter=createPanelProfileTestAdapter(db,f.files),intake=createAtlasRevisionIntake({supabase:adapter.supabase});
    const child=await acceptedChild(db,intake,f);
    await db.query("UPDATE public.designpro_generation_views SET metadata=jsonb_set(metadata,'{authority,revisionId}',to_jsonb($2::text)) WHERE request_id=$1 AND consumer_role='driver'",[child.requestId,f.parentId]);
    const result=await intake.drainHandoffs();assert.equal(result[0].state,'blocked');assert.equal(result[0].code,'atlas_revision_exact_seven_proofs_required');
    assert.equal((await db.query('SELECT count(*) n FROM public.designpro_revision_sources')).rows[0].n,0);
    const os=(await db.query('SELECT public.designpro_generation_os_snapshot($1) x',[GEN])).rows[0].x;
    assert.equal(os.revisionHandoffError.code,'atlas_revision_exact_seven_proofs_required');
    await db.query("UPDATE public.designpro_generation_views SET metadata=jsonb_set(metadata,'{authority,revisionId}',to_jsonb($2::text)) WHERE request_id=$1 AND consumer_role='driver'",[child.requestId,child.atlasId]);
    const repaired=(await db.query('SELECT public.handoff_designpro_atlas_revision($1) x',[child.requestId])).rows[0].x;
    assert.equal(repaired.state,'handed_off');
    await db.exec("SET test.jwt='{\"role\":\"authenticated\"}'");
    await assert.rejects(db.query('SELECT public.handoff_designpro_atlas_revision($1)',[child.requestId]),/service_role_required/);
  }finally{await db.close();}
});

test('PPO revision continuation uses actual run -> source schema and exact master/source hash',async()=>{
  const {db,fixture:f}=await database();try{
    const adapter=createPanelProfileTestAdapter(db,f.files),intake=createAtlasRevisionIntake({supabase:adapter.supabase});
    const run=randomUUID(),source=randomUUID(),inputHash=sha('panel-input');
    await db.query('INSERT INTO public.panelprofile_source_handoffs VALUES($1,$2,\'DesignPro\',$3,$4,$5)',[source,OWNER,GEN,inputHash,JSON.stringify({master:f.masterRef,atlasRevisionId:f.parentId})]);
    await db.query('INSERT INTO public.panelprofile_runs VALUES($1,$2,$3,$4,\'completed\')',[run,source,OWNER,inputHash]);
    const prepared=await intake.prepare(OWNER,{...payload(f),panelOutputRunId:run});assert.equal(prepared.revisionContext.panelOutputRunId,run);
    await db.query('UPDATE public.panelprofile_runs SET input_hash=$2 WHERE id=$1',[run,sha('wrong')]);
    await assert.rejects(intake.prepare(OWNER,{...payload(f),panelOutputRunId:run}),{code:'atlas_revision_panel_output_identity_mismatch'});
  }finally{await db.close();}
});

test('paid edit carries the verified recipient binding and original product entitlement without another payment or approval',async()=>{
  const {db,fixture:f}=await database();try{
    for(const role of [...surfaces,'closeup'])await db.query(`INSERT INTO public.designpro_generation_views(request_id,source_view_type,consumer_role,storage_path,content_hash,byte_size,content_type,metadata)
      VALUES($1,$2,$2,$3,$4,42,'image/png',$5)`,[f.requestId,role,`designpro/user_${OWNER}/${GEN}/calls-1-7/${role}/${sha(role)}.png`,sha(role),JSON.stringify({provider:{atlasMasterContentHash:f.masterRef.contentHash},authority:{revisionId:f.parentId}})]);
    await db.exec("SET test.jwt='{\"role\":\"authenticated\"}'");
    const parent=(await db.query('SELECT public.handoff_designpro_generation_to_production($1) x',[f.requestId])).rows[0].x;
    const recipientHash=sha('registered-recipient'),customer=randomUUID(),order='Existing order / 2026';
    await db.query('INSERT INTO designpro_private.wrapbox_delivery_recipients VALUES($1,$2,$3,$4,$5)',[recipientHash,customer,OTHER,'other@example.test',order]);
    await db.query('INSERT INTO designpro_private.revision_fulfillment_bindings(revision_id,owner_id,bound_by_operator_id,recipient_identity_hash,order_number,design_name,binding_hash) VALUES($1,$2,$2,$3,$4,$5,$6)',
      [parent.revisionId,OWNER,recipientHash,order,f.input.designName,sha('original-binding')]);
    await db.query('INSERT INTO public.designpro_purchase_entitlements(owner_id,entice_run_id,generation_id,product_type,amount_cents,paid_at) VALUES($1,$2,$3,\'logo_pack\',2900,now())',[OWNER,parent.workflowRunId,GEN]);
    await db.exec("SET test.jwt='{\"role\":\"service_role\"}'");
    const adapter=createPanelProfileTestAdapter(db,f.files),intake=createAtlasRevisionIntake({supabase:adapter.supabase});
    const child=await acceptedChild(db,intake,f),result=(await intake.drainHandoffs())[0];assert.equal(result.state,'handed_off',JSON.stringify(result));
    const bindings=(await db.query('SELECT revision_id,binding_hash,order_number,recipient_identity_hash FROM designpro_private.revision_fulfillment_bindings ORDER BY created_at')).rows;
    assert.equal(bindings.length,2);assert.equal(bindings[1].order_number,order);assert.equal(bindings[1].recipient_identity_hash,recipientHash);
    assert.notEqual(bindings[1].binding_hash,bindings[0].binding_hash);
    const products=(await db.query('SELECT public.designpro_paid_products($1) x',[result.workflowRunId])).rows[0].x;assert.deepEqual(products,['logo_pack']);
    const production=randomUUID();
    await db.query("INSERT INTO public.designpro_workflow_runs(id,workflow_type,owner_id,tenant_key,revision_id,results,status) VALUES($1,'designpro.production_pack',$2,$3,$4,$5,'approval_required')",
      [production,OWNER,`user_${OWNER}`,child.revisionId,JSON.stringify({sourceEnticeRunId:result.workflowRunId})]);
    await db.query("INSERT INTO public.designpro_workflow_stages(run_id,stage_key,status) VALUES($1,'await_purchase','waiting')",[production]);
    const reconciled=(await db.query('SELECT public.reconcile_designpro_purchase_gates() x')).rows[0].x;assert.equal(reconciled.released,1);
    const run=(await db.query('SELECT input FROM public.designpro_workflow_runs WHERE id=$1',[production])).rows[0];
    assert.equal(run.input.fulfillment.revisionId,child.revisionId);assert.equal(run.input.fulfillment.orderNumber,order);
    assert.equal((await db.query('SELECT count(*) n FROM public.designpro_purchase_entitlements')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*) n FROM public.designpro_stage_receipts')).rows[0].n,0,'no old approval is copied');
    assert.equal((await db.query('SELECT designpro_private.atlas_revision_purchase_applies($1,$2) x',[result.workflowRunId,randomUUID()])).rows[0].x,false);
  }finally{await db.close();}
});

for (const nativeMime of ['image/png', 'image/jpeg', 'image/webp']) test(`${nativeMime}: native parent exchange preserves exact signatures and all parts; missing known history and reference-budget overflow fail before provider dispatch`,async()=>{
  const {db,fixture:f}=await database();try{
    const adapter=createPanelProfileTestAdapter(db,f.files);
    const original=[{role:'user',parts:[{text:'Original private customer brief'},{inlineData:{mimeType:'image/png',data:Buffer.from('teaching').toString('base64')}}]}];
    const nativeParts=[{text:'Private reasoning',thought:true,thoughtSignature:'opaque-thought'},
      {inlineData:{mimeType:'image/png',data:Buffer.from('thought-image').toString('base64')},thought:true},
      {inlineData:{mimeType:nativeMime,data:Buffer.from('raw-model-art').toString('base64')},thoughtSignature:'opaque-image'}];
    const cached=await runDurableImageProviderRequest({bucket:adapter.supabase.storage.from('wrap-files'),identity:{ownerId:OWNER,generationId:GEN,requestId:f.requestId,mode:'atlas-artboard',attemptKey:'master:1'},
      requestHash:sha('native-request'),privateRequest:JSON.stringify({contents:original}),authorize:async()=>{},invoke:async()=>({status:200,payload:{candidates:[{content:{role:'model',parts:nativeParts}}]}})});
    // The historical row is constructed with this provenance before admission;
    // temporarily disable only the fixture's immutable trigger to emulate it.
    await db.exec('ALTER TABLE public.designpro_flat_atlas_revisions DISABLE TRIGGER designpro_flat_atlas_revisions_immutable');
    await db.query("UPDATE public.designpro_flat_atlas_revisions SET metadata=metadata||$2 WHERE id=$1",[f.parentId,JSON.stringify({rawProviderResponseHash:sha('raw-model-art'),atlasEdgeProvenance:[{providerCacheContract:'designpro.gemini-provider-cache.v1',providerRequestKey:cached.providerRequestKey,masterSha256:sha('raw-model-art')}]})]);
    await db.exec('ALTER TABLE public.designpro_flat_atlas_revisions ENABLE TRIGGER designpro_flat_atlas_revisions_immutable');
    const intake=createAtlasRevisionIntake({supabase:adapter.supabase}),child=await intake.enqueue(OWNER,payload(f)),token=randomUUID();
    await db.query("UPDATE public.designpro_generation_requests SET state='leased',lease_token=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1",[child.requestId,token]);
    const row=(await db.query('SELECT * FROM public.designpro_generation_requests WHERE id=$1',[child.requestId])).rows[0];
    const providerRequest={requestId:child.requestId,generationId:GEN,claimToken:token,attemptKey:'master:1'};
    const current=[{text:'Pinned authoring prompt'},{inlineData:{mimeType:'image/png',data:'dGVhY2hpbmc='}},{inlineData:{mimeType:'image/png',data:'Z3VpZGU='}}];
    const prepared=await prepareAtlasRevisionProviderContents({supabase:adapter.supabase,ownerId:OWNER,providerRequest,revisionContextHash:row.revision_context_hash,currentUserParts:current});
    assert.deepEqual(prepared.contents[0],original[0]);assert.deepEqual(prepared.contents[1],{role:'model',parts:nativeParts});
    assert.equal(prepared.modelInputImageCount,5);assert.equal(prepared.reusedImageCount,1);assert.equal(prepared.revisionHistoryMode,'generate-content-replay');
    assert.equal(prepared.contents[2].parts[2].inlineData.data,f.files.get(f.masterRef.storagePath).toString('base64'));
    assert.deepEqual(prepared.contents[2].parts.at(-1),current.at(-1));
    const tooMany=[...current,...Array.from({length:10},(_,index)=>({inlineData:{mimeType:'image/png',data:Buffer.from(`new-${index}`).toString('base64')}}))];
    await assert.rejects(prepareAtlasRevisionProviderContents({supabase:adapter.supabase,ownerId:OWNER,providerRequest,revisionContextHash:row.revision_context_hash,currentUserParts:tooMany}),{code:'atlas_revision_history_reference_budget_exceeded'});
    const responsePath=[...adapter.files.keys()].find(p=>p.includes(cached.providerRequestKey)&&p.endsWith('/response.json'));
    adapter.files.delete(responsePath);
    await assert.rejects(intake.prepare(OWNER,payload(f)),{code:'provider_outcome_unknown'});
    const privateWrites=adapter.uploads.filter(r=>r.path.startsWith('designpro-provider-private/')).length;
    await assert.rejects(prepareAtlasRevisionProviderContents({supabase:adapter.supabase,ownerId:OWNER,providerRequest,revisionContextHash:row.revision_context_hash,currentUserParts:current}),{code:'provider_outcome_unknown'});
    assert.equal(adapter.uploads.filter(r=>r.path.startsWith('designpro-provider-private/')).length,privateWrites,'replay loader never writes or invokes');
  }finally{await db.close();}
});
