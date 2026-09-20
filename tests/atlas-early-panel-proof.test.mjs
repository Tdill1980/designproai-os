import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAtlasCall1Database, OWNER, REQUEST} from './helpers/atlas-call1-graph-fixture.mjs';
const OTHER='22222222-2222-4222-8222-222222222222';
const RUN='88888888-8888-4888-8888-888888888888';
const REV='99999999-9999-4999-8999-999999999999';
const HASH='a'.repeat(64), MASTER='b'.repeat(64), RAW='c'.repeat(64);
const surfaces=['driver','passenger','hood','roof','front','rear'];
const ref=(surfaceKey,i)=>({surfaceKey,persisted:true,storagePath:`atlas-panel-proof/quadrants/${String(i).repeat(64)}.png`,contentHash:String(i).repeat(64),byteSize:120,positionalPremiseVerified:true,identity:{method:'aspect-anchor'}});
const proof={contract:'designpro.atlas-panel-proof-topology.v2',topology:'panel-proof',proofStoragePath:`atlas-panel-proof/${HASH}.png`,proofSha256:HASH,proofByteSize:600,
  composition:{contract:'designpro.production-zone-composite.v1',sourceAssetsPreserved:true},
  quadrants:{branded:surfaces.map(surfaceKey=>({surfaceKey,positionalPremiseVerified:true,identity:{method:'aspect-anchor'}})),clean:surfaces.map((s,i)=>ref(s,i+1)),
    cutGraphics:[{surfaceKey:'logo',persisted:true,storagePath:`users/${OWNER}/revisions/${REV}/inputs/logo/${HASH}.svg`,contentHash:HASH,byteSize:70,vector:true}]}};
const output={master:{contentHash:MASTER},provenance:proof};
async function claims(db,uid=OWNER,role='authenticated',staff=false){
  await db.query("SELECT set_config('request.jwt.claims',$1,false),set_config('test.staff',$2,false)",[JSON.stringify({sub:uid,role}),String(staff)]);
}
const paths=async db=>(await db.query('SELECT public.designpro_atlas_panel_proof_paths($1) value',[REQUEST])).rows[0].value;
const maySign=async(db,path)=>(await db.query('SELECT designpro_private.caller_may_sign_panel_proof_object($1) value',[path])).rows[0].value;

test('completed composed graph proof is readable before revision, with owner/signing fences and unchanged later paths',async t=>{
  const db=await createAtlasCall1Database();t.after(()=>db.close());
  await db.exec(`CREATE SCHEMA designpro_private; CREATE SCHEMA storage;
    GRANT USAGE ON SCHEMA designpro_private,auth TO authenticated,service_role;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT (auth.jwt()->>'sub')::uuid$$;
    CREATE FUNCTION designpro_private.caller_is_design_staff() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT COALESCE(current_setting('test.staff',true),'false')='true'$$;
    CREATE TABLE public.designpro_flat_atlas_revisions(id uuid PRIMARY KEY,request_id uuid,owner_id uuid,revision_sequence integer,master_content_hash text,metadata jsonb);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON storage.objects TO authenticated;
    GRANT USAGE ON SCHEMA storage TO authenticated;
    CREATE FUNCTION storage.allow_only_operation(text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT $1='object.sign'$$;`);
  for(const name of ['20260919180000_designpro_atlas_panel_proof_paths.sql','20260920011000_designpro_early_panel_proof.sql','20260920080000_designpro_call1_sheet_immediate.sql','20260920093000_designpro_composed_call1_only.sql'])
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  await db.query("INSERT INTO public.designpro_atlas_call1_runs(id,request_id,generation_id,owner_id,contract,definition_hash,definition,state) VALUES($1,$2,'generation',$3,'designpro.atlas-call1-graph.v1',$4,'{}','running')",[RUN,REQUEST,OWNER,HASH]);
  await db.query("INSERT INTO public.designpro_atlas_call1_nodes(run_id,node_key,depends_on,state,output) VALUES($1,'proof.assemble','{}','pending',$2)",[RUN,JSON.stringify(output)]);
  await db.query("INSERT INTO public.designpro_atlas_call1_nodes(run_id,node_key,depends_on,state,output,output_hash,completed_at) VALUES($1,'proof.sheet','{}','completed',$2,$3,now())",[RUN,JSON.stringify({sheet:{storagePath:`atlas-panel-proof/${RAW}.png`,contentHash:RAW,byteSize:500,proofContract:'designpro.atlas-panel-proof-topology.v2',sheetShape:{mime:'image/png'}}}),HASH]);
  for(const path of [proof.proofStoragePath,proof.quadrants.clean[0].storagePath,proof.quadrants.cutGraphics[0].storagePath,`atlas-panel-proof/${RAW}.png`,'provider-cache/secret.png'])
    await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('wrap-files',$1)",[path]);
  await claims(db);await db.exec('SET ROLE authenticated');
  const immediate=await paths(db);
  assert.equal(immediate.panelProof,false,'raw Gemini artwork staging is never customer-visible');
  assert.equal(await maySign(db,`atlas-panel-proof/${RAW}.png`),false,'raw artwork staging is never signable as a Production Panel Proof');
  assert.equal(await maySign(db,proof.proofStoragePath),false,'composed production proof is not signable until assembly completes');
  await db.exec('RESET ROLE');
  await db.query("UPDATE public.designpro_atlas_call1_nodes SET state='completed',output_hash=$2,completed_at=now() WHERE run_id=$1 AND node_key='proof.assemble'",[RUN,HASH]);
  await db.exec('SET ROLE authenticated');
  const early=await paths(db);
  assert.equal(early.panelProof,true);assert.equal(early.revisionId,null);assert.equal(early.source,'call1_graph');assert.equal(early.graphRunId,RUN);
  assert.equal(early.masterContentHash,MASTER);assert.deepEqual(early.quadrants,proof.quadrants);
  for(const path of [proof.proofStoragePath,...proof.quadrants.clean.map(p=>p.storagePath),proof.quadrants.cutGraphics[0].storagePath])assert.equal(await maySign(db,path),true);
  assert.equal((await db.query('SELECT name FROM storage.objects')).rows.length,3,'sign-only storage policy grants composed sheet, clean layer and original asset only');
  assert.equal(await maySign(db,`atlas-panel-proof/${RAW}.png`),false);
  assert.equal(await maySign(db,'provider-cache/secret.png'),false);
  assert.equal(await maySign(db,`atlas-panel-proof/${MASTER}.png`),false);
  await assert.rejects(db.query('SELECT * FROM public.designpro_atlas_call1_nodes'),/permission denied/);
  await claims(db,OTHER);
  assert.equal(await paths(db),null);assert.equal(await maySign(db,proof.proofStoragePath),false);
  assert.equal((await db.query('SELECT name FROM storage.objects')).rows.length,0,'other owner cannot sign any proof object');
  await claims(db,OTHER,'authenticated',true);
  assert.equal((await paths(db)).panelProof,true);assert.equal(await maySign(db,proof.proofStoragePath),true);
  await claims(db,null,'service_role');await db.exec('RESET ROLE; SET ROLE service_role');
  assert.equal((await paths(db)).panelProof,true);assert.equal(await maySign(db,proof.proofStoragePath),true);
  await db.exec('RESET ROLE');await claims(db);
  // Every original/layer must be stored. A completed-but-partial receipt is not a proof.
  for(const mutate of [p=>p.quadrants.clean.pop(),p=>p.quadrants.cutGraphics=[],p=>p.quadrants.cutGraphics[0].persisted=false,p=>p.composition.sourceAssetsPreserved=false,p=>p.quadrants.branded[0].surfaceKey='roof',p=>p.quadrants.branded[0].positionalPremiseVerified=false,p=>delete p.quadrants.clean[0].identity,p=>p.composition.contract='unknown']){
    const invalid=structuredClone(proof);mutate(invalid);
    await db.query("UPDATE public.designpro_atlas_call1_nodes SET output=$2 WHERE run_id=$1 AND node_key='proof.assemble'",[RUN,JSON.stringify({...output,provenance:invalid})]);
    const fallback=await paths(db);assert.equal(fallback.panelProof,false);assert.equal(await maySign(db,proof.proofStoragePath),false);
  }
  await db.query("UPDATE public.designpro_atlas_call1_nodes SET output=$2 WHERE run_id=$1 AND node_key='proof.assemble'",[RUN,JSON.stringify(output)]);
  await db.query('INSERT INTO public.designpro_flat_atlas_revisions VALUES($1,$2,$3,1,$4,$5)',[REV,REQUEST,OWNER,MASTER,JSON.stringify({panelProofAuthoring:proof})]);
  const accepted=await paths(db);
  assert.equal(accepted.source,'atlas_revision');assert.equal(accepted.revisionId,REV);
  assert.deepEqual(accepted.sheet,early.sheet);assert.deepEqual(accepted.quadrants,early.quadrants);
  // An accepted revision lacking this topology is authoritative, not replaced by an older graph.
  await db.query("UPDATE public.designpro_flat_atlas_revisions SET metadata='{}' WHERE id=$1",[REV]);
  assert.equal((await paths(db)).panelProof,false);
  await db.exec('SET ROLE anon');await assert.rejects(paths(db),/permission denied/);
});
