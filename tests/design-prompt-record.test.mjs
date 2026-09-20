import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(new URL('../runtime/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const OWNER='11111111-1111-4111-8111-111111111111', OTHER='22222222-2222-4222-8222-222222222222';
const GEN='33333333-3333-4333-8333-333333333333', ROOT='44444444-4444-4444-8444-444444444444';
const REV='55555555-5555-4555-8555-555555555555', EDIT='66666666-6666-4666-8666-666666666666';

test('prompt record preserves original words and failed revision intent without exposing another owner', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA designpro_private;
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULLIF(current_setting('test.uid',true),'')::uuid$$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT COALESCE(NULLIF(current_setting('test.jwt',true),''),'{}')::jsonb$$;
      CREATE TABLE public.designpro_generation_requests(id uuid,owner_id uuid,generation_id uuid,parent_atlas_revision_id uuid,
        request_input jsonb,revision_sequence int,revision_context jsonb,created_at timestamptz,completed_at timestamptz,state text,error jsonb);
      CREATE TABLE public.designpro_flat_atlas_revisions(id uuid,request_id uuid,generation_id uuid,owner_id uuid,revision_sequence int,instruction text,created_at timestamptz);
      CREATE FUNCTION designpro_private.caller_may_read_generation(uuid) RETURNS boolean LANGUAGE sql AS $$
        SELECT EXISTS(SELECT 1 FROM public.designpro_generation_requests WHERE generation_id=$1 AND owner_id=auth.uid())$$;
      SET test.uid='${OWNER}';`);
    await db.exec(await readFile(new URL('../supabase/migrations/20260920154447_designpro_prompt_record.sql',import.meta.url),'utf8'));
    const prompt='  Copper Finch Coffee\nCopper linework and teal panels.  ';
    const instruction='  Enlarge the coffee leaf emblem.\nKeep the side lettering.  ';
    await db.query(`INSERT INTO public.designpro_generation_requests VALUES($1,$2,$3,NULL,$4,1,NULL,'2026-09-20T10:00:00Z',NULL,'queued',NULL)`,[ROOT,OWNER,GEN,JSON.stringify({brief:prompt})]);
    const read=async()=> (await db.query('SELECT public.designpro_generation_prompt_record($1) AS record',[GEN])).rows[0].record;
    let record=await read();
    assert.equal(record.originalPrompt,prompt);
    assert.equal(record.versions.length,1);
    assert.equal(record.versions[0].state,'queued');
    assert.equal(record.versions[0].revisionId,null);
    await db.query(`INSERT INTO public.designpro_flat_atlas_revisions VALUES($1,$2,$3,$4,1,NULL,'2026-09-20T10:01:00Z')`,[REV,ROOT,GEN,OWNER]);
    await db.query(`INSERT INTO public.designpro_generation_requests VALUES($1,$2,$3,$4,$5,2,$6,'2026-09-20T10:02:00Z',NULL,'failed',$7)`,[EDIT,OWNER,GEN,REV,JSON.stringify({brief:prompt}),JSON.stringify({instruction}),JSON.stringify({code:'provider_refused'})]);
    record=await read();
    assert.equal(record.originalPrompt,prompt);
    assert.deepEqual(record.versions.map(v=>v.version),[1,2]);
    assert.equal(record.versions[0].revisionId,REV);
    assert.equal(record.versions[1].prompt,instruction);
    assert.equal(record.versions[1].errorCode,'provider_refused');
    assert.equal(record.versions[1].requestId,EDIT);
    await db.exec(`SET test.uid='${OTHER}'`);
    assert.equal(await read(),null);
    await db.exec(`SET test.uid='${OWNER}'; SET test.jwt='{"is_anonymous":true}'`);
    assert.equal(await read(),null);
    const grants=await db.query(`SELECT has_function_privilege('anon','public.designpro_generation_prompt_record(uuid)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.designpro_generation_prompt_record(uuid)','EXECUTE') AS authenticated`);
    assert.deepEqual(grants.rows[0],{anon:false,authenticated:true});
  } finally { await db.close(); }
});
