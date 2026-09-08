import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const HASH='a'.repeat(64);
const migration=await readFile(new URL('../supabase/migrations/20260908190825_panelpro_file_output_graph.sql',import.meta.url),'utf8');
const acquireFile=await readFile(new URL('../supabase/migrations/20260824040000_designpro_call12_heavy_lease.sql',import.meta.url),'utf8');
const acquire=acquireFile.match(/CREATE OR REPLACE FUNCTION public\.acquire_designpro_heavy_lease\([\s\S]*?\$fn\$;/)[0];
async function database() {
  const db=new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA designpro_private;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT '{"role":"service_role"}'::jsonb$$;
    CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256($1)$$;
    CREATE TABLE public.designpro_qc_members(user_id uuid PRIMARY KEY,can_preflight boolean);
    CREATE TABLE public.designpro_workflow_stages(id uuid PRIMARY KEY,stage_key text,status text,lease_token uuid,lease_owner text,lease_expires_at timestamptz);
    CREATE TABLE designpro_private.heavy_stage_leases(lease_key text PRIMARY KEY,stage_id uuid,lease_owner text,lease_token uuid,lease_expires_at timestamptz,updated_at timestamptz,
      CONSTRAINT designpro_heavy_stage_lease_integrity CHECK ((stage_id IS NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) OR (stage_id IS NOT NULL AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)));
    INSERT INTO designpro_private.heavy_stage_leases(lease_key) VALUES('production-heavy');
    CREATE FUNCTION public.claim_designpro_stage(text,integer) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN
      UPDATE designpro_private.heavy_stage_leases SET stage_id=NULL,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE lease_expires_at<now(); RETURN false; END$$;
    INSERT INTO auth.users VALUES('${OWNER}',now()),('${OTHER}',now());
    INSERT INTO public.designpro_qc_members VALUES('${OWNER}',true);`);
  await db.exec(acquire);
  await db.exec(migration);
  return db;
}
async function source(db,owner=OWNER) {
  return (await db.query(`INSERT INTO public.panelprofile_source_handoffs(owner_id,source_app,source_job_id,revision_id,input_hash,handoff,registered_by)
    VALUES($1,'GraphicsPro','job-'||gen_random_uuid()::text,'revision-1',$2,'{}',$1) RETURNING id`,[owner,HASH])).rows[0].id;
}
async function start(db,sourceId,nodes) {
  return (await db.query('SELECT public.create_panelprofile_run($1,$2,$3,$4) AS result',[OWNER,sourceId,'v1',JSON.stringify(nodes)])).rows[0].result;
}
async function claim(db,worker='worker-a') {
  return (await db.query('SELECT public.claim_panelprofile_node($1,180) AS result',[worker])).rows[0].result;
}
async function finish(db,c,state='completed',output={verified:true},artifacts=[]) {
  return (await db.query('SELECT public.finish_panelprofile_node($1,$2,$3,$4,$5,$6) AS result',
    [c.node.id,c.node.lease_token,state,JSON.stringify(output),HASH,JSON.stringify(artifacts)])).rows[0].result;
}

test('PPO Postgres graph: parallel prerequisites, immutable sources, tenant scope, stale lease fencing and exact human approval',async t=>{
  const db=await database();t.after(()=>db.close());
  const src=await source(db);
  await assert.rejects(start(db,src,[{key:'a',dependsOn:['missing']}]),/dependency_missing/);
  await assert.rejects(start(db,src,[{key:'a',dependsOn:['b']},{key:'b',dependsOn:['a']}]),/dependency_cycle/);
  await assert.rejects(db.query('UPDATE public.panelprofile_source_handoffs SET handoff=$1 WHERE id=$2',['{"changed":true}',src]),/immutable_record/);
  await assert.rejects(db.query('SELECT public.create_panelprofile_run($1,$2,$3,$4)',[OTHER,src,'v1','[]']),/no rows/);
  const nodes=[{key:'source.verify',dependsOn:[]},{key:'template.lookup',dependsOn:[]},
    {key:'panelprofileoutput.verify',dependsOn:['source.verify','template.lookup']},
    {key:'await_panelpro_preflight_qc',dependsOn:['panelprofileoutput.verify']},{key:'package',dependsOn:['await_panelpro_preflight_qc']}];
  const run=await start(db,src,nodes);assert.equal((await start(db,src,nodes)).id,run.id,'retrying create returns the same run');
  const a=await claim(db),b=await claim(db,'worker-b');
  assert.notEqual(a.node.id,b.node.id);assert.equal(await claim(db),null,'join cannot run while parents are leased');
  await finish(db,a);assert.equal(await claim(db),null);
  await db.query("UPDATE public.panelprofile_nodes SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[b.node.id]);
  const recovered=await claim(db,'worker-c');assert.equal(recovered.node.id,b.node.id);assert.notEqual(recovered.node.lease_token,b.node.lease_token);
  await assert.rejects(finish(db,b),/lease_lost/);await finish(db,recovered);
  const verify=await claim(db);assert.equal(verify.node.node_key,'panelprofileoutput.verify');
  await finish(db,verify,'completed',{verified:true,artifactSetHash:HASH});
  const gate=await claim(db);await finish(db,gate,'waiting',{approvalRequired:true});assert.equal(await claim(db),null);
  const checks={template:true,fit:true,essentialArtworkSafe:true,backgroundContinuous:true,fiveInchBleed:true,resolution:true,physicalPieces:true,filesInspected:true};
  await assert.rejects(db.query('SELECT public.approve_panelprofile_output($1,$2,$3,$4,$5)',[run.id,OTHER,HASH,JSON.stringify(checks),'review-1']),/permission_required/);
  await assert.rejects(db.query('SELECT public.approve_panelprofile_output($1,$2,$3,$4,$5)',[run.id,OWNER,'b'.repeat(64),JSON.stringify(checks),'review-1']),/evidence_required/);
  await assert.rejects(db.query('SELECT public.approve_panelprofile_output($1,$2,$3,$4,$5)',[run.id,OWNER,HASH,'{}','review-1']),/evidence_required/);
  await assert.rejects(db.query('SELECT public.approve_panelprofile_output($1,$2,$3,$4,$5)',[run.id,OWNER,HASH,JSON.stringify(checks),null]),/evidence_required/);
  await assert.rejects(db.query('SELECT public.approve_panelprofile_output($1,$2,$3,$4,$5)',[run.id,OWNER,HASH,JSON.stringify(checks),'   ']),/evidence_required/);
  await db.query('SELECT public.approve_panelprofile_output($1,$2,$3,$4,$5)',[run.id,OWNER,HASH,JSON.stringify(checks),'review-1']);
  assert.equal((await finish(db,await claim(db))).state,'completed');
  const events=(await db.query('SELECT * FROM public.panelprofile_events WHERE run_id=$1 ORDER BY id',[run.id])).rows;
  assert(events.some(e=>e.node_key==='await_panelpro_preflight_qc'&&e.state==='waiting'));
  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.query('SELECT * FROM public.panelprofile_source_handoffs'),/permission denied/);
  await assert.rejects(db.query('SELECT public.claim_panelprofile_node($1,180)',['attacker']),/permission denied/);
  await db.exec('RESET ROLE');
});

test('PPO and legacy full-size rendering cannot own the heavy memory slot together',async t=>{
  const db=await database();t.after(()=>db.close());const src=await source(db);
  await start(db,src,[{key:'panelprofileoutput.render:driver',dependsOn:[]}]);
  const c=await claim(db);
  assert.equal((await db.query('SELECT public.acquire_panelprofile_heavy_lease($1,$2) AS ok',[c.node.id,c.node.lease_token])).rows[0].ok,true);
  const legacyId='33333333-3333-4333-8333-333333333333',token='44444444-4444-4444-8444-444444444444';
  await db.query("INSERT INTO public.designpro_workflow_stages VALUES($1,'enhance.upscale','running',$2,'legacy',now()+interval '2 minutes')",[legacyId,token]);
  assert.equal((await db.query('SELECT public.acquire_designpro_heavy_lease($1,$2,$3,120) AS ok',[legacyId,token,'legacy'])).rows[0].ok,false);
  await finish(db,c);
  assert.equal((await db.query('SELECT public.acquire_designpro_heavy_lease($1,$2,$3,120) AS ok',[legacyId,token,'legacy'])).rows[0].ok,true);
  const second=await source(db);await start(db,second,[{key:'render-two',dependsOn:[]}]);const next=await claim(db);
  assert.equal((await db.query('SELECT public.acquire_panelprofile_heavy_lease($1,$2) AS ok',[next.node.id,next.node.lease_token])).rows[0].ok,false);
});

test('PPO explicitly resumes exhausted transient work, preserving successful ancestors and refusing invalid inputs',async t=>{
  const db=await database();t.after(()=>db.close());const src=await source(db);
  const run=await start(db,src,[{key:'source.verify',dependsOn:[]},{key:'render',dependsOn:['source.verify']}]);
  const saved=await claim(db);await finish(db,saved);
  for(let attempt=1;attempt<=3;attempt++) {
    const c=await claim(db);assert.equal(c.node.attempt,attempt);
    const state=await finish(db,c,'pending',{errorCode:'panelprofile_asset_unavailable',retryable:true});
    assert.equal(state.state,attempt===3?'failed':'running');
    await db.query('UPDATE public.panelprofile_nodes SET available_at=now() WHERE id=$1',[c.node.id]);
  }
  await assert.rejects(db.query('SELECT public.resume_panelprofile_run($1,$2)',[run.id,OTHER]),/permission_required/);
  await db.query('SELECT public.resume_panelprofile_run($1,$2)',[run.id,OWNER]);
  const ancestor=(await db.query('SELECT state,attempt FROM public.panelprofile_nodes WHERE id=$1',[saved.node.id])).rows[0];
  assert.deepEqual(ancestor,{state:'completed',attempt:1});
  const resumed=await claim(db);assert.equal(resumed.node.node_key,'render');assert.equal(resumed.node.attempt,1);
  await finish(db,resumed);
  const invalid=await start(db,await source(db),[{key:'render',dependsOn:[]}]);
  await finish(db,await claim(db),'failed',{errorCode:'panelprofile_source_hash_mismatch',retryable:false});
  await assert.rejects(db.query('SELECT public.resume_panelprofile_run($1,$2)',[invalid.id,OWNER]),/input_correction_required/);
});
