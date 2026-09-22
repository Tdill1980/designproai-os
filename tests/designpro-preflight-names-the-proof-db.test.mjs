/**
 * THE PANELPRO PREFLIGHT NAMES THE PRODUCTION PANEL PROOF -- run on the real
 * migration, over rows that exercise the branch.
 *
 * Owner (2026-09-22): "must send production panel proof and its assets to
 * panel pro studio / For processing and qc." The assets reached the board; no
 * QC check asked about them. `20260922130000` text-patches
 * `approve_designpro_human_gate` so a preflight on a revision whose frozen
 * snapshot carries `panelProofAuthoring` must also carry the three proof
 * attestations, and a revision without one is not asked.
 *
 * CLAUDE.md's own rule for PL/pgSQL: validate the RESULT, then RUN it over a
 * row that exercises the expression. So this applies the actual migration to
 * the actual predecessor body on PGlite and calls the gate four ways. The
 * `apply:false` case is the defect: the pre-fix gate accepts six keys on a
 * three-zone revision, which is exactly what the lock exists to convict.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';

const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const readMigration=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const OWNER='11111111-1111-4111-8111-111111111111';
const GENERATION='33333333-3333-4333-8333-333333333333';
const surfaces=['driver','passenger','hood','roof','front','rear'];
const baseFile=await readMigration('20260806180100_designpro_workflow_rpcs.sql');
const syncBase=baseFile.match(/CREATE OR REPLACE FUNCTION public\.designpro_sync_run_status\([\s\S]*?END \$fn\$;/)[0];
const approvalBase=await readMigration('20260906132000_designpro_final_qc_resolves_late_fulfillment.sql');
const migration=await readMigration('20260922130000_designpro_preflight_names_the_proof.sql');

const SIX={known:true,pass:true,dimensionsVerified:true,sourceRegionsVerified:true,fiveInchBleed:true,
  panelHashesVerified:true,logoInventoryVerified:true,textLockVerified:true,
  approvedSides:surfaces,surfaceQc:{},notes:''};
const PROOF={proofSheetReviewed:true,cleanPanelsMatchBranded:true,cutGraphicsInventoried:true};

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
        attempt integer DEFAULT 0,max_attempts integer DEFAULT 5,available_at timestamptz DEFAULT now(),
        lease_token uuid,lease_owner text,lease_expires_at timestamptz,input jsonb DEFAULT '{}',output jsonb DEFAULT '{}',
        verification jsonb DEFAULT '{}',output_hash text,started_at timestamptz,completed_at timestamptz,updated_at timestamptz,
        wait_reason text,wait_details jsonb DEFAULT '{}',error_code text,error_message text,error_details jsonb DEFAULT '{}',
        UNIQUE(run_id,stage_key));
      CREATE TABLE public.designpro_stage_receipts(id uuid DEFAULT gen_random_uuid(),run_id uuid,stage_id uuid UNIQUE,
        receipt_kind text,identity jsonb,receipt jsonb,receipt_hash text,UNIQUE(run_id,receipt_kind,receipt_hash));
      CREATE FUNCTION designpro_private.revision_fulfillment(uuid) RETURNS jsonb LANGUAGE sql AS $$
        SELECT input->'fulfillment' FROM public.designpro_workflow_runs WHERE revision_id=$1 AND workflow_type='designpro.production_pack' LIMIT 1$$;
      INSERT INTO auth.users VALUES('${OWNER}','reviewer@example.test',now(),'{"display_name":"QC Reviewer"}');
      INSERT INTO public.designpro_qc_members VALUES('${OWNER}',true,true);
      SET test.jwt='{"role":"service_role"}';`);
    await db.exec(approvalBase);
    await db.exec(syncBase);
    if(apply)await db.exec(migration);
    return db;
  } catch(error) {await db.close();throw error;}
}

async function stage(db,runId,key,status,output={},verification={verified:true}) {
  const id=randomUUID();
  await db.query(`INSERT INTO public.designpro_workflow_stages(id,run_id,stage_key,status,attempt,output,verification,completed_at)
    VALUES($1,$2,$3,$4,1,$5,$6,now())`,[id,runId,key,status,JSON.stringify(output),JSON.stringify(verification)]);
  return id;
}

/** A production run parked at the preflight gate, with or without the three-zone proof in its frozen snapshot. */
async function fixture(db,{threeZone}) {
  const runId=randomUUID(),revisionId=randomUUID(),enticeId=randomUUID();
  const tenant=`user_${OWNER}`,snapshotHash=hash(`snapshot-${runId}`);
  const snapshot={generationId:GENERATION,designId:'DID-33333333',orderNumber:'ORDER-1',delivery:{orderNumber:'ORDER-1'},
    callOnePanels:surfaces.map(surfaceKey=>({surfaceKey,contentHash:hash(`panel-${surfaceKey}`)})),
    ...(threeZone?{panelProofAuthoring:{contract:'designpro.atlas-panel-production-proof.v1',proofStoragePath:`atlas-panel-proof/${hash('sheet')}.png`,
      quadrants:{branded:[],clean:surfaces.map(surfaceKey=>({surfaceKey})),cutGraphics:[{surfaceKey:'logo',assetRole:'logo'}]}}}:{})};
  const fulfillment={contractVersion:'designpro.fulfillment-binding.v1',revisionId,bindingHash:hash('fulfillment'),orderNumber:'ORDER-1',delivery:{orderNumber:'ORDER-1'}};
  await db.query(`INSERT INTO public.designpro_workflow_runs(id,workflow_type,owner_id,tenant_key,revision_id,revision_snapshot_hash,
    entice_pack_id,input,status) VALUES($1,'designpro.production_pack',$2,$3,$4,$5,$6,$7,'approval_required')`,
    [runId,OWNER,tenant,revisionId,snapshotHash,enticeId,JSON.stringify({fulfillment})]);
  await db.query('INSERT INTO public.designpro_revision_sources VALUES($1,$2,$3,$4,$5,$6,$7)',[revisionId,OWNER,tenant,GENERATION,randomUUID(),snapshotHash,JSON.stringify(snapshot)]);
  await stage(db,runId,'source.verify','completed',{
    call9:{receiptKind:'call9.surface-panels',receiptHash:hash('call9')},
    call10:{receiptKind:'call10.logo-inventory',receiptHash:hash('call10')},
  });
  const gateId=await stage(db,runId,'await_panelpro_preflight_qc','waiting',{},{});
  await stage(db,runId,'enhance.upscale','pending',{},{});
  return {runId,gateId};
}

const approve=(db,f,qc,ref='approval-1')=>db.query('SELECT public.approve_designpro_human_gate($1,\'await_panelpro_preflight_qc\',$2,$3,$4) AS result',
  [f.runId,OWNER,ref,JSON.stringify(qc)]);

test('the migration patches the live body in place and reads its own result back',async t=>{
  const db=await database();t.after(()=>db.close());
  const body=(await db.query("SELECT pg_get_functiondef('public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'::regprocedure) AS body")).rows[0].body;
  assert.equal(body.split('panelpro_proof_evidence_incomplete').length,2,'the new refusal appears exactly once');
  assert.equal(body.split('panelpro_preflight_evidence_incomplete').length,2,'the six-key refusal is untouched');
  assert.match(body,/jsonb_typeof\(v_source\.snapshot->'panelProofAuthoring'\)='object'/,'the condition is the frozen snapshot, not a flag');
  assert.ok(body.indexOf('panelpro_preflight_evidence_incomplete')<body.indexOf('panelpro_proof_evidence_incomplete'),'the six keys are checked first');
  assert.ok(body.indexOf('panelpro_proof_evidence_incomplete')<body.indexOf('frozen_call9_call10_receipts_required'),'the proof is checked inside the preflight arm');
  // The final-QC arm is byte-identical: this migration touches only the preflight branch.
  assert.match(body,/final_qc_evidence_or_business_identity_incomplete/);
  // Idempotent: a second apply is a no-op, not a second patch.
  await db.exec(migration);
  const again=(await db.query("SELECT pg_get_functiondef('public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'::regprocedure) AS body")).rows[0].body;
  assert.equal(again,body);
});

test('a three-zone revision refuses a preflight that does not name the proof, and accepts one that does',async t=>{
  const db=await database();t.after(()=>db.close());const f=await fixture(db,{threeZone:true});
  await assert.rejects(approve(db,f,SIX),/panelpro_proof_evidence_incomplete/,'six keys alone are not enough when the proof exists');
  for(const missing of Object.keys(PROOF)) {
    const partial={...SIX,...PROOF};delete partial[missing];
    await assert.rejects(approve(db,f,partial),/panelpro_proof_evidence_incomplete/,`${missing} absent`);
    await assert.rejects(approve(db,f,{...SIX,...PROOF,[missing]:false}),/panelpro_proof_evidence_incomplete/,`${missing} false`);
  }
  assert.equal((await db.query('SELECT status FROM public.designpro_workflow_stages WHERE id=$1',[f.gateId])).rows[0].status,'waiting','nothing was recorded by a refusal');
  const result=(await approve(db,f,{...SIX,...PROOF})).rows[0].result;
  assert.equal(result.idempotent,false);
  const receipt=(await db.query("SELECT receipt FROM public.designpro_stage_receipts WHERE run_id=$1 AND receipt_kind='panelpro.preflight'",[f.runId])).rows[0].receipt;
  assert.deepEqual([receipt.qc.proofSheetReviewed,receipt.qc.cleanPanelsMatchBranded,receipt.qc.cutGraphicsInventoried],[true,true,true],'the receipt records the three signatures');
  assert.equal((await db.query('SELECT status FROM public.designpro_workflow_stages WHERE id=$1',[f.gateId])).rows[0].status,'completed');
});

test('a revision with no three-zone proof is not asked about one',async t=>{
  const db=await database();t.after(()=>db.close());const f=await fixture(db,{threeZone:false});
  const result=(await approve(db,f,SIX)).rows[0].result;
  assert.equal(result.idempotent,false,'six keys release a legacy revision exactly as before');
  assert.equal((await db.query('SELECT status FROM public.designpro_workflow_stages WHERE id=$1',[f.gateId])).rows[0].status,'completed');
});

test('a null panelProofAuthoring is absence, not presence',async t=>{
  // The runtime writes `metadata.panelProofAuthoring = ... || null`, and the
  // handoff copies the key verbatim -- so a legacy revision can carry the KEY
  // with a JSON null. That is no proof. The condition is jsonb_typeof='object',
  // never `?`, exactly as 20260919180000's read path decides it.
  const db=await database();t.after(()=>db.close());const f=await fixture(db,{threeZone:false});
  await db.query("UPDATE public.designpro_revision_sources SET snapshot=snapshot||'{\"panelProofAuthoring\":null}'::jsonb");
  const result=(await approve(db,f,SIX)).rows[0].result;
  assert.equal(result.idempotent,false);
});

test('THE DEFECT: before the migration, a three-zone revision was released on six keys alone',async t=>{
  const db=await database({apply:false});t.after(()=>db.close());const f=await fixture(db,{threeZone:true});
  const result=(await approve(db,f,SIX)).rows[0].result;
  assert.equal(result.idempotent,false,'the pre-fix gate never asked about the proof');
});
