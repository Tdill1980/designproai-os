// THE VIEW GATE REFUSED EVERY THREE-ZONE RUN (live 21dc0312, 2026-09-22).
// `designpro_private.flat_first_atlas_view_set_valid(uuid)` demanded
// `sourcePanelHash = atlasZoneContentHash` on every view, and on the TriZone
// route the photographer is handed the SHEET as its artwork source. Migration
// 20260922150000 text-patches that one clause into the worker's own rule. This
// lock applies the REAL migration chain for that function on PGlite, seeds a
// complete seven-view set, and calls the real function; the `apply:false`
// case reproduces the defect.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';

const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const MIGRATION='20260922150000_designpro_view_gate_learns_the_proof_sheet.sql';
const readMigration=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const migrationFiles=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
const hash=value=>createHash('sha256').update(value).digest('hex');
const OWNER='11111111-1111-4111-8111-111111111111';
const VIEWS=[['side','driver','Driver','driver'],['passenger-side','passenger','Passenger','passenger'],['hood_detail','hood','Hood','hood'],
  ['front','front','Front','front'],['rear','rear','Rear','rear'],['close-up','closeup','Close-Up','driver'],['roof','roof','Roof','roof']];

async function database({apply=true}={}) {
  const db=new PGlite();
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA designpro_private;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT COALESCE(NULLIF(current_setting('test.jwt',true),''),'{}')::jsonb$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULLIF(current_setting('test.uid',true),'')::uuid$$;
    CREATE TABLE public.designpro_flat_atlas_revisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid,generation_id uuid,owner_id uuid,tenant_key text,revision_sequence integer,prompt_version text,master_content_hash text,projection_content_hash text,manifest_content_hash text,master_storage_path text,projection_storage_path text,manifest_storage_path text,guide_storage_path text,guide_content_hash text,metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT now(),parent_revision_id uuid,revision_context_hash text,production_eligible boolean DEFAULT false);
    CREATE TABLE public.designpro_generation_views(id uuid DEFAULT gen_random_uuid(),request_id uuid,generation_id uuid,consumer_role text,source_view_type text,storage_path text,content_hash text,byte_size bigint,content_type text,metadata jsonb DEFAULT '{}',superseded_at timestamptz,created_at timestamptz DEFAULT now(),owner_id uuid,tenant_key text,width integer,height integer,provider text,model text);
    CREATE TABLE public.designpro_generation_requests(id uuid PRIMARY KEY,generation_id uuid,owner_id uuid,tenant_key text,state text,request_input jsonb DEFAULT '{}',metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());`);
    // Every definition and every text patch of the gate the history carries,
    // in order, up to (and excluding) the migration under test.
    for(const file of migrationFiles) {
      if(file>=MIGRATION)continue;
      const text=await readMigration(file);
      if(!text.includes('flat_first_atlas_view_set_valid'))continue;
      for(const m of text.matchAll(/CREATE OR REPLACE FUNCTION designpro_private\.flat_first_atlas_view_set_valid\([\s\S]*?\$function\$;/g))await db.exec(m[0]);
      for(const m of text.matchAll(/DO\s+(\$\w*\$)([\s\S]*?)\1;/g))if(m[2].includes('flat_first_atlas_view_set_valid')&&m[2].includes('pg_get_functiondef'))await db.exec(m[0]);
    }
    const before=(await db.query("SELECT pg_get_functiondef('designpro_private.flat_first_atlas_view_set_valid(uuid)'::regprocedure) AS body")).rows[0].body;
    assert.match(before,/sourcePanelHash/,'the chain installed the gate this lock is about');
    if(apply)await db.exec(await readMigration(MIGRATION));
    return {db,before};
  } catch(error){await db.close();throw error;}
}

const SHEET=hash('trizone-production-panel-proof');
async function seed(db,{threeZone}) {
  const requestId=randomUUID(),revisionId=randomUUID();
  const master=hash('master'),projection=hash('projection'),manifest=hash('manifest');
  const metadata={masterQcPassed:true,masterQcContract:'designpro.atlas-master-semantic-qc.v1',masterAcceptance:'deterministic',
    masterPromptHash:hash('prompt'),masterProviderContract:'designpro.flat-first-master-provider.v1',
    designPanelArtboardPortVersion:'designpanel-ai-generate.artboard.20260827.v4-edge',masterExampleSetHash:hash('examples'),
    panelSourceHash:master,...(threeZone?{panelProofAuthoring:{proofSha256:SHEET,proofStoragePath:`atlas-panel-proof/${SHEET}.png`}}:{})};
  await db.query('INSERT INTO public.designpro_flat_atlas_revisions(id,request_id,generation_id,owner_id,tenant_key,revision_sequence,prompt_version,master_content_hash,projection_content_hash,manifest_content_hash,metadata) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10)',
    [revisionId,requestId,randomUUID(),OWNER,`user_${OWNER}`,'designpro-flat-first-atlas-20260922.v1',master,projection,manifest,JSON.stringify(metadata)]);
  const rows=[];
  for(const [sourceViewType,consumerRole,label,surfaceKey] of VIEWS) {
    const panel=hash(`panel-${surfaceKey}`),zone=hash(`zone-${surfaceKey}`),proof=hash(`proof-${consumerRole}`);
    const artwork=threeZone?{sourcePanelHash:SHEET,proofArtworkAuthorityContract:'designpro.atlas-three-zone-proof-authority.v1',
      proofArtworkAuthorityRole:'three-zone-production-proof',proofArtworkAuthorityHash:SHEET}
      :{sourcePanelHash:panel,proofArtworkAuthorityContract:'designpro.atlas-panel-authority.v1',proofArtworkAuthorityRole:'surface-panel',proofArtworkAuthorityHash:panel};
    const view={providerContract:'designpro.atlas-designpanel-server-provider.v1',
      provider:{stage:'persona-photographer-render',execution:'edge-photographer',anchoredToFlatAtlas:true,atlasConditioningVerified:true,anchoredToView1:false,
        proofProducer:'persona-photographer-render',proofContract:'designpro.atlas-photographer-proof.v1',proofSourceCommit:'a'.repeat(40),
        proofRequestId:requestId,proofProvider:'google',proofModel:'gemini-3-pro-image-preview',proofImageRequestCount:1,
        atlasMasterContentHash:master,atlasProjectionContentHash:projection,atlasManifestContentHash:manifest,atlasRevisionId:revisionId,atlasRevisionSequence:1,
        atlasZoneContract:'designpro.atlas-panel-authority.v1',atlasZoneContentHash:panel,atlasZoneSurfaceKey:surfaceKey,...artwork},
      validation:{contract:'designpro.atlas-proof-semantic-qc.v1',expectedView:label,proofHash:proof,atlasHash:projection,authorityHash:zone,zoneHash:zone,zoneSurfaceKey:surfaceKey,
        policyContract:'designpro.atlas-proof-semantic-advisory.v1',semanticDisposition:'pass'},
      authority:{contract:'designpro.flat-first-atlas.v1',revisionId,revisionSequence:1,masterContentHash:master,projectionContentHash:projection,
        projectionSourceMasterHash:master,manifestContentHash:manifest,zoneContract:'designpro.flat-first-atlas-view-authority.v1',zoneContentHash:zone,zoneSurfaceKey:surfaceKey}};
    rows.push({sourceViewType,consumerRole,proof,metadata:view});
  }
  for(const row of rows) await db.query('INSERT INTO public.designpro_generation_views(request_id,consumer_role,source_view_type,storage_path,content_hash,byte_size,content_type,metadata) VALUES($1,$2,$3,$4,$5,123,\'image/png\',$6)',
    [requestId,row.consumerRole,row.sourceViewType,`designpro/x/${row.sourceViewType}/${row.proof}.png`,row.proof,JSON.stringify(row.metadata)]);
  return {requestId,revisionId,rows};
}
const valid=(db,requestId)=>db.query('SELECT designpro_private.flat_first_atlas_view_set_valid($1) AS ok',[requestId]).then(r=>r.rows[0].ok);
const patchView=(db,requestId,sourceViewType,fn)=>db.query('SELECT metadata FROM public.designpro_generation_views WHERE request_id=$1 AND source_view_type=$2',[requestId,sourceViewType])
  .then(r=>{const m=r.rows[0].metadata;fn(m);return db.query('UPDATE public.designpro_generation_views SET metadata=$3 WHERE request_id=$1 AND source_view_type=$2',[requestId,sourceViewType,JSON.stringify(m)]);});

test('pre-fix: a completed three-zone seven-view set is refused by the gate (the 409 the customer saw)',async t=>{
  const {db}=await database({apply:false});t.after(()=>db.close());
  const six=await seed(db,{threeZone:false});assert.equal(await valid(db,six.requestId),true);
  const three=await seed(db,{threeZone:true});assert.equal(await valid(db,three.requestId),false);
});

test('the gate admits the three-zone set on a revision that recorded the sheet, and still refuses a drifted one',async t=>{
  const {db,before}=await database();t.after(()=>db.close());
  const three=await seed(db,{threeZone:true});assert.equal(await valid(db,three.requestId),true);
  // The worker's rule, one for one: contract, role, hash and source must all name the sheet.
  for(const mutate of [
    m=>{m.provider.proofArtworkAuthorityHash=hash('another-sheet');},
    m=>{m.provider.sourcePanelHash=m.provider.atlasZoneContentHash;},
    m=>{m.provider.proofArtworkAuthorityRole='surface-panel';},
    m=>{m.provider.proofArtworkAuthorityContract='designpro.atlas-panel-authority.v1';},
  ]) {
    const fresh=await seed(db,{threeZone:true});
    await patchView(db,fresh.requestId,'roof',mutate);
    assert.equal(await valid(db,fresh.requestId),false);
  }
  // A six-surface revision keeps the legacy panel equality byte for byte.
  const six=await seed(db,{threeZone:false});assert.equal(await valid(db,six.requestId),true);
  await patchView(db,six.requestId,'front',m=>{m.provider.sourcePanelHash=SHEET;});
  assert.equal(await valid(db,six.requestId),false);
  // A six-surface receipt on a three-zone revision is a different artwork input and is refused.
  const mixed=await seed(db,{threeZone:true});
  await patchView(db,mixed.requestId,'side',m=>{m.provider.sourcePanelHash=m.provider.atlasZoneContentHash;m.provider.proofArtworkAuthorityHash=m.provider.atlasZoneContentHash;m.provider.proofArtworkAuthorityRole='surface-panel';m.provider.proofArtworkAuthorityContract='designpro.atlas-panel-authority.v1';});
  assert.equal(await valid(db,mixed.requestId),false);
  const after=(await db.query("SELECT pg_get_functiondef('designpro_private.flat_first_atlas_view_set_valid(uuid)'::regprocedure) AS body")).rows[0].body;
  assert.doesNotMatch(after,/pg_catalog\.coalesce/i);
  // Only the one clause moved.
  const strip=s=>s.replace(/\s+/g,' ');
  const oldClause="AND v.metadata#>>'{provider,sourcePanelHash}'= v.metadata#>>'{provider,atlasZoneContentHash}'";
  assert.equal(strip(before).split(oldClause).length,2);
  assert.equal(strip(after).split("WHEN COALESCE(v_atlas.metadata#>>'{panelProofAuthoring,proofSha256}','') ~ '^[0-9a-f]{64}$'").length,2);
  // Idempotent.
  await db.exec(await readMigration(MIGRATION));
  assert.equal((await db.query("SELECT pg_get_functiondef('designpro_private.flat_first_atlas_view_set_valid(uuid)'::regprocedure) AS body")).rows[0].body,after);
});
