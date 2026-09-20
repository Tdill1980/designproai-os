import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const {normalizeLogoAsset}=require('./runtime-contract.cjs');
const OWNER='11111111-1111-4111-8111-111111111111';
const UPLOAD='22222222-2222-4222-8222-222222222222';
const REVISION='33333333-3333-4333-8333-333333333333';
const HASH='a'.repeat(64),MASTER='b'.repeat(64);
const migration=readFileSync(new URL('../supabase/migrations/20260920022906_designpro_panel_proof_logo_handoff.sql',import.meta.url),'utf8');
const historical=readFileSync(new URL('../supabase/migrations/20260825120000_designpro_atlas_enters_handoff.sql',import.meta.url),'utf8');
const original=historical.slice(historical.indexOf('CREATE OR REPLACE FUNCTION public.handoff_designpro_generation_to_production'),historical.indexOf('$fn$;')+5);
function fixture(mime='image/png') {
  const ext={'image/png':'png','image/jpeg':'jpg','image/svg+xml':'svg','image/webp':'webp','application/pdf':'pdf'}[mime];
  const logo={storagePath:`users/${OWNER}/revisions/${UPLOAD}/inputs/logo/${HASH}.${ext}`,contentHash:HASH,byteSize:2137,contentType:mime};
  const panels=['driver','passenger','hood','roof','front','rear'].map((surfaceKey,i)=>({surfaceKey,sourceMasterHash:MASTER,contentHash:String(i+1).repeat(64),storagePath:`panels/${surfaceKey}.png`}));
  const proof={contract:'designpro.atlas-panel-proof-topology.v2',masterSha256:MASTER,
    threeZoneLayout:{required:true,branded:6,backgrounds:6,graphics:3},
    composition:{contract:'designpro.production-zone-composite.v1',sourceAssetsPreserved:true,
      placements:panels.filter(p=>p.surfaceKey!=='roof').map(p=>({...logo,role:'logo',surfaceKey:p.surfaceKey,flipped:false,box:{xPct:.12,yPct:.2,wPct:.42,hPct:.21}}))},
    quadrants:{clean:panels,cutGraphics:[{...logo,assetRole:'logo',persisted:true,vector:mime==='image/svg+xml'}]}};
  return {logo,proof,panels};
}
async function database(t) {
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE SCHEMA designpro_private;CREATE SCHEMA storage;
    CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT current_setting('request.jwt.claims',true)::jsonb$$;
    CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256($1)$$;
    CREATE FUNCTION designpro_private.calls_1_7_handoff_state(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"handoffReady":true}'::jsonb$$;
    CREATE FUNCTION public.create_designpro_entice_workflow(uuid,text,jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"workflowRunId":"44444444-4444-4444-8444-444444444444"}'::jsonb$$;
    CREATE TABLE storage.objects(bucket_id text,name text);
    CREATE TABLE public.designpro_generation_requests(id uuid,owner_id uuid,generation_id uuid,revision_sequence int,state text,
      request_input jsonb,engine_receipt jsonb,completed_at timestamptz,updated_at timestamptz,created_at timestamptz);
    CREATE TABLE public.designpro_generation_views(request_id uuid,consumer_role text,content_hash text,byte_size bigint,content_type text,superseded_at timestamptz);
    CREATE TABLE public.designpro_revision_sources(revision_id uuid PRIMARY KEY,owner_id uuid,tenant_key text,generation_id uuid,visualization_id uuid,
      snapshot jsonb,snapshot_hash text,idempotency_key text,expected_updated_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE designpro_private.wrapbox_delivery_recipients(customer_id uuid);
    CREATE TABLE public.designpro_flat_atlas_revisions(id uuid,request_id uuid,owner_id uuid,generation_id uuid,revision_sequence int,metadata jsonb,master_content_hash text);`);
  await db.exec(original);
  await db.exec(migration);
  const snapshotSchema=readFileSync(new URL('../supabase/migrations/20260825121000_designpro_atlas_revision_source_admitted.sql',import.meta.url),'utf8');
  await db.exec(snapshotSchema.slice(snapshotSchema.indexOf('ALTER TABLE public.designpro_revision_sources'),snapshotSchema.indexOf('CREATE OR REPLACE FUNCTION')));
  return db;
}
const inventory=async(db,f)=> (await db.query('SELECT designpro_private.panel_proof_logo_inventory($1,$2,$3,$4,$5,$6,$7) inventory',
  [OWNER,REVISION,JSON.stringify(f.logo),JSON.stringify(f.proof),JSON.stringify(f.panels),MASTER,'Precision Climate Solutions'])).rows[0].inventory;

test('the actual handoff migration keeps existing guards and freezes verified logo placements',async t=>{
  const db=await database(t),f=fixture();
  const result=await inventory(db,f);
  assert.equal(result.length,5);
  assert.deepEqual(result.map(p=>p.surfaceKey).sort(),['driver','front','hood','passenger','rear']);
  for(const item of result){
    assert.equal(item.originalStoragePath,f.logo.storagePath);
    assert.equal(item.sourceMasterContentHash,MASTER);
    assert.equal(item.sourcePanelHash,f.panels.find(p=>p.surfaceKey===item.surfaceKey).contentHash);
    assert.equal(item.contentHash,HASH);
    assert.equal(item.byteSize,f.logo.byteSize);
    assert.deepEqual(item.box,f.proof.composition.placements[0].box);
    assert.doesNotThrow(()=>normalizeLogoAsset(item,`user_${OWNER}`,REVISION));
  }
  const [{definition}]=(await db.query("SELECT pg_get_functiondef('public.handoff_designpro_generation_to_production(uuid)'::regprocedure) definition")).rows;
  for(const guard of ['authentication_required','generation_request_not_visible','generation_outputs_not_ready','generation_handoff_blocked','generation_handoff_identity_conflict'])assert.ok(definition.includes(guard));
  assert.match(definition,/a\.request_id=v_row\.id AND a\.owner_id=v_row\.owner_id AND a\.generation_id=v_row\.generation_id/);
  assert.match(definition,/a\.id=NULLIF\(v_row\.engine_receipt->>'atlasRevisionId'/);
  assert.match(definition,/'panelProofAuthoring',v_logo_atlas\.metadata->'panelProofAuthoring'/);
  assert.match(definition,/'expectedLogoInventory',v_logo_inventory/);
  assert.match(definition,/'placementPending',false/);
  assert.doesNotMatch(definition,/'qcApproved',true|'designerApproved',true/);
  await db.exec(migration); // Migration replay must not patch the installed body twice.
});

test('root handoff requires the copied logo and preserves separated zones under the real snapshot constraint',async t=>{
  const db=await database(t),f=fixture();
  const request='55555555-5555-4555-8555-555555555555',generation='66666666-6666-4666-8666-666666666666',atlas='77777777-7777-4777-8777-777777777777';
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',sub:OWNER})]);
  await db.query('INSERT INTO public.designpro_generation_requests VALUES($1,$2,$3,1,$4,$5,$6,now(),now(),now())',
    [request,OWNER,generation,'outputs_ready',JSON.stringify({contractVersion:'designpro.calls-1-7-input.v3',designName:'Precision',companyName:'Precision',
      vehicle:{year:'2022',make:'Ford',model:'F-250',type:'truck'},logoAsset:f.logo}),JSON.stringify({handoffRevisionId:REVISION,atlasRevisionId:atlas})]);
  await db.query('INSERT INTO public.designpro_flat_atlas_revisions VALUES($1,$2,$3,$4,1,$5,$6)',
    [atlas,request,OWNER,generation,JSON.stringify({masterQcPassed:true,panelProofAuthoring:f.proof,callOnePanels:f.panels}),MASTER]);
  await db.query('INSERT INTO public.designpro_flat_atlas_revisions VALUES($1,$2,$3,$4,2,$5,$6)',
    [UPLOAD,UPLOAD,OWNER,generation,JSON.stringify({masterQcPassed:true,callOnePanels:[{surfaceKey:'different-revision'}]}),'c'.repeat(64)]);
  for(const role of ['driver','passenger','hood','roof','front','rear','closeup'])await db.query('INSERT INTO public.designpro_generation_views VALUES($1,$2,$3,200,$4,NULL)',[request,role,HASH,'image/png']);
  const handoff=()=>db.query('SELECT public.handoff_designpro_generation_to_production($1) result',[request]);
  await assert.rejects(handoff(),/generation_logo_copy_required/);
  await db.query("INSERT INTO storage.objects VALUES('wrap-files',$1)",[`users/${OWNER}/revisions/${REVISION}/inputs/logo/${HASH}.png`]);
  assert.equal((await handoff()).rows[0].result.revisionId,REVISION);
  const snapshot=(await db.query('SELECT snapshot FROM public.designpro_revision_sources WHERE revision_id=$1',[REVISION])).rows[0].snapshot;
  assert.deepEqual(snapshot.panelProofAuthoring,f.proof);
  assert.deepEqual(snapshot.callOnePanels,f.panels,'a newer generation revision cannot substitute the purchased panel set');
  assert.deepEqual(snapshot.panelProofAuthoring.quadrants.clean,f.proof.quadrants.clean);
  assert.deepEqual(snapshot.panelProofAuthoring.quadrants.cutGraphics,f.proof.quadrants.cutGraphics);
  assert.equal(snapshot.expectedLogoInventory.length,5);
  assert.equal(snapshot.logoInventoryAttestation.contractVersion,'designpro.panel-proof-logo-inventory.v1');
  assert.equal(snapshot.logoInventoryAttestation.placementPending,false);
  assert.equal(snapshot.logoInventoryAttestation.atlasRevisionId,atlas);
  assert.equal(snapshot.brandAssets.logo.storagePath,f.logo.storagePath);
  assert.equal((await handoff()).rows[0].result.alreadyHandedOff,true);
  await db.query("UPDATE public.designpro_generation_requests SET engine_receipt=jsonb_set(engine_receipt,'{atlasRevisionId}',$1::jsonb) WHERE id=$2",[JSON.stringify(UPLOAD),request]);
  await assert.rejects(handoff(),/generation_logo_placement_manifest_required/);
});

test('original identity, exact six-panel source and all five unflipped placements are mandatory',async t=>{
  const db=await database(t);
  const changes=[
    f=>{f.proof.composition.contract='unverified';},
    f=>{f.proof.composition.sourceAssetsPreserved=false;},
    f=>{f.proof.masterSha256='c'.repeat(64);},
    f=>{f.proof.quadrants.cutGraphics[0].contentHash='c'.repeat(64);},
    f=>{f.proof.quadrants.cutGraphics[0].byteSize++;},
    f=>{f.proof.quadrants.cutGraphics[0].storagePath=f.logo.storagePath.replace(OWNER,UPLOAD);},
    f=>{f.proof.quadrants.cutGraphics[0].persisted=false;},
    f=>{f.proof.quadrants.cutGraphics.push(structuredClone(f.proof.quadrants.cutGraphics[0]));},
    f=>{f.panels[0].sourceMasterHash='c'.repeat(64);},
    f=>{f.proof.quadrants.clean.pop();},
    f=>{f.proof.composition.placements[0].flipped=true;},
    f=>{f.proof.composition.placements[0].contentHash='c'.repeat(64);},
    f=>{f.proof.composition.placements[0].box.xPct=.9;},
    f=>{f.proof.composition.placements[0].box.hPct=0;},
    f=>{f.proof.composition.placements[0].box.wPct='0.4';},
    f=>{f.proof.composition.placements[1].surfaceKey='driver';},
    f=>{f.proof.composition.placements.pop();},
  ];
  for(const mutate of changes){const f=fixture();mutate(f);await assert.rejects(inventory(db,f),/generation_logo_/);}
});

test('SVG and raster sources retain their original bytes identity and canonical handoff extension',async t=>{
  const db=await database(t);
  for(const mime of ['image/png','image/jpeg','image/webp','image/svg+xml','application/pdf']){
    const f=fixture(mime),result=await inventory(db,f);
    for(const item of result){assert.equal(item.contentType,mime);assert.equal(item.contentHash,HASH);assert.doesNotThrow(()=>normalizeLogoAsset(item,`user_${OWNER}`,REVISION));}
  }
  const jpeg=fixture('image/jpeg');
  jpeg.logo.storagePath=jpeg.logo.storagePath.replace(/\.jpg$/,'.jpeg');
  jpeg.proof.quadrants.cutGraphics[0].storagePath=jpeg.logo.storagePath;
  for(const placement of jpeg.proof.composition.placements)placement.storagePath=jpeg.logo.storagePath;
  const jpegInventory=await inventory(db,jpeg);
  assert.ok(jpegInventory.every(item=>item.originalStoragePath.endsWith('.jpeg')&&item.storagePath.endsWith('.jpg')));
  const f=fixture();f.logo.storagePath=f.logo.storagePath.replace(OWNER,UPLOAD);
  await assert.rejects(inventory(db,f),/generation_logo_asset_invalid/);
});
