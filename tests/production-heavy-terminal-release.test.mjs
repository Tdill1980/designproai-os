import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';

const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const source=await readFile(new URL('../supabase/migrations/20260806180100_designpro_workflow_rpcs.sql',import.meta.url),'utf8');
const original=source.match(/CREATE OR REPLACE FUNCTION designpro_private\.sync_heavy_stage_lease\(\)[\s\S]*?\$fn\$;/)[0];
const migration=await readFile(new URL('../supabase/migrations/20260920043000_designpro_enhance_terminal_lease_release.sql',import.meta.url),'utf8');
const stage='11111111-1111-4111-8111-111111111111';
const token='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333';

async function database() {
  const db=new PGlite();
  await db.exec(`CREATE SCHEMA designpro_private;
    CREATE TABLE public.designpro_workflow_stages(id uuid PRIMARY KEY,stage_key text,status text,lease_owner text,lease_token uuid,lease_expires_at timestamptz);
    CREATE TABLE designpro_private.heavy_stage_leases(lease_key text PRIMARY KEY,stage_id uuid REFERENCES public.designpro_workflow_stages, panelprofile_node_id uuid,
      lease_owner text,lease_token uuid,lease_expires_at timestamptz,updated_at timestamptz DEFAULT now(),
      CHECK ((stage_id IS NULL AND panelprofile_node_id IS NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
        OR (((stage_id IS NOT NULL)::int+(panelprofile_node_id IS NOT NULL)::int)=1 AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)));
    INSERT INTO designpro_private.heavy_stage_leases(lease_key) VALUES('production-heavy');
    ${original}
    CREATE TRIGGER designpro_output_build_singleton_lease
      BEFORE UPDATE OF status,lease_owner,lease_token,lease_expires_at ON public.designpro_workflow_stages
      FOR EACH ROW EXECUTE FUNCTION designpro_private.sync_heavy_stage_lease();
    INSERT INTO public.designpro_workflow_stages VALUES('${stage}','enhance.upscale','pending',NULL,NULL,NULL);`);
  return db;
}
const slot=async db=>(await db.query("SELECT stage_id, panelprofile_node_id, lease_token FROM designpro_private.heavy_stage_leases WHERE lease_key='production-heavy'")).rows[0];
const running=db=>db.exec(`UPDATE public.designpro_workflow_stages SET status='running',lease_owner='worker',lease_token='${token}',lease_expires_at=now()+interval '10 minutes' WHERE id='${stage}'`);
const acquire=(db,leaseToken=token)=>db.exec(`UPDATE designpro_private.heavy_stage_leases SET stage_id='${stage}',lease_owner='worker',lease_token='${leaseToken}',lease_expires_at=now()+interval '10 minutes' WHERE lease_key='production-heavy'`);
const finish=(db,status='completed')=>db.exec(`UPDATE public.designpro_workflow_stages SET status='${status}',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id='${stage}'`);

test('Topaz starts without a prebound slot and releases only its completed/failed attempt',async()=>{
  const db=await database();
  try {
    await db.exec(migration);
    for(const status of ['completed','failed']) {
      await running(db);
      assert.equal((await slot(db)).stage_id,null);
      await acquire(db);
      await finish(db,status);
      assert.deepEqual(await slot(db),{stage_id:null,panelprofile_node_id:null,lease_token:null});
    }
    await db.exec(`UPDATE public.designpro_workflow_stages SET stage_key='output.build' WHERE id='${stage}'`);
    await assert.rejects(running(db),/output_build_singleton_lease_required/);
  } finally {await db.close();}
});

test('terminal transition does not release a different token, unowned slot, or PPO owner',async()=>{
  const db=await database();
  try {
    await db.exec(migration);
    await running(db);
    await acquire(db,other);
    await finish(db);
    assert.equal((await slot(db)).lease_token,other);
    await db.exec(`UPDATE designpro_private.heavy_stage_leases SET stage_id=NULL,panelprofile_node_id='${other}' WHERE lease_key='production-heavy'`);
    await running(db); await finish(db,'failed');
    assert.equal((await slot(db)).panelprofile_node_id,other);
    await db.exec("UPDATE designpro_private.heavy_stage_leases SET panelprofile_node_id=NULL,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL");
    await running(db); await finish(db);
    assert.equal((await slot(db)).stage_id,null);
  } finally {await db.close();}
});

test('migration repairs only an already terminal enhancement slot, preserving active and PPO leases',async()=>{
  const db=await database();
  try {
    await running(db); await acquire(db); await finish(db);
    assert.equal((await slot(db)).stage_id,stage,'actual predecessor leaks the finished Topaz lease');
    await db.exec(migration);
    assert.equal((await slot(db)).stage_id,null);
    await running(db); await acquire(db); await db.exec(migration);
    assert.equal((await slot(db)).lease_token,token,'running owner remains fenced');
    await db.exec(`UPDATE designpro_private.heavy_stage_leases SET stage_id=NULL,panelprofile_node_id='${other}'`);
    await db.exec(migration);
    assert.equal((await slot(db)).panelprofile_node_id,other);
  } finally {await db.close();}
});
