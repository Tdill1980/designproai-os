-- The frozen snapshot carries the three-zone panel proof with or without a
-- customer logo (migration 20260922051200).
--
-- Measured defect, live 2026-09-21: no-logo entice runs whose print master
-- carried a v2 panelProofAuthoring froze a snapshot with none of it, so Call 11
-- fell back to AI locate and the ZIP packaged no three-zone proof. The proof
-- lookup and attach lived inside `IF v_logo IS NOT NULL`.
--
-- Like atlas_stage_contract.test.sql this seeds REAL generations and calls the
-- REAL handoff RPC: the snapshot CHECK, the inventory/attestation trigger and
-- the entice-workflow creation are all exercised, not asserted about. Three
-- generations: no logo (must attach the proof, empty inventory), a logo (must
-- still require the copied object and the five-entry inventory), and a logo
-- with no three-zone proof (must still refuse).

begin;
select plan(20);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values(
  '00000000-0000-0000-0000-000000000000',
  '61000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'panel-proof-no-logo@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()
) on conflict(id) do nothing;

select set_config('request.jwt.claims','{"role":"service_role"}',true);

create or replace function pg_temp.sha(p text) returns text language sql immutable as $sha$
  select encode(extensions.digest(convert_to(p,'UTF8'),'sha256'),'hex');
$sha$;

-- Six Call 1 panels bound to one master, and a v2 three-zone proof over them.
-- p_logo NULL builds the proof a no-logo brief produces: six clean quadrants,
-- no cut graphic, no placement.
create or replace function pg_temp.panels(p_master text,p_seed text) returns jsonb language sql immutable as $p$
  select jsonb_agg(jsonb_build_object(
    'surfaceKey',s.surface_key,
    'contract','designpro.flat-first-atlas-call1-panel.v1',
    'contentHash',pg_temp.sha(p_seed||'-panel-'||s.surface_key),
    'sourceMasterHash',p_master,
    'storagePath','designpro/panels/'||p_seed||'/'||s.surface_key||'.png',
    'byteSize',1024,'contentType','image/png',
    'trimWidthIn',196.9,'trimHeightIn',50.9,
    'printWidthIn',206.9,'printHeightIn',60.9,
    'surfaceSqFt',69.6,'bleedInches',5,'effectivePpi',17.94,
    'geometryPurpose','calls-1-7-layout-only'
  ) order by s.ordinal)
  from (values ('driver',1),('passenger',2),('hood',3),('roof',4),('front',5),('rear',6))
    as s(surface_key,ordinal);
$p$;

create or replace function pg_temp.proof(p_master text,p_seed text,p_logo jsonb) returns jsonb language sql immutable as $p$
  select jsonb_build_object(
    'contract','designpro.atlas-panel-proof-topology.v2',
    'masterSha256',p_master,
    'proofStoragePath','atlas-panel-proof/'||pg_temp.sha(p_seed||'-sheet')||'.png',
    'threeZoneLayout',jsonb_build_object('required',true,'branded',6,'backgrounds',6,
      'graphics',case when p_logo is null then 0 else 1 end),
    'composition',jsonb_build_object(
      'contract','designpro.production-zone-composite.v1',
      'sourceAssetsPreserved',true,
      'placements',case when p_logo is null then '[]'::jsonb else (
        select jsonb_agg(p_logo||jsonb_build_object('role','logo','surfaceKey',s,'flipped',false,
          'box',jsonb_build_object('xPct',0.12,'yPct',0.2,'wPct',0.42,'hPct',0.21)))
        from unnest(array['driver','passenger','hood','front','rear']) s) end),
    'quadrants',jsonb_build_object(
      'clean',(select jsonb_agg(jsonb_build_object(
          'surfaceKey',s,'role','clean','persisted',true,'positionalPremiseVerified',true,
          'contentHash',pg_temp.sha(p_seed||'-clean-'||s),
          'storagePath','atlas-panel-proof/quadrants/'||pg_temp.sha(p_seed||'-clean-'||s)||'.png',
          'byteSize',4096,'rect',jsonb_build_object('width',979,'height',2674)))
        from unnest(array['driver','passenger','hood','roof','front','rear']) s),
      'cutGraphics',case when p_logo is null then '[]'::jsonb
        else jsonb_build_array(p_logo||'{"assetRole":"logo","persisted":true,"vector":false}'::jsonb) end)
  );
$p$;

-- A complete v3 generation whose accepted print master carries the proof
-- (p_proof NULL seeds a master with no three-zone document).
create or replace function pg_temp.seed(
  p_request uuid,p_generation uuid,p_revision uuid,p_atlas uuid,
  p_seed text,p_logo jsonb,p_proof jsonb
) returns void language plpgsql as $seed$
DECLARE v_input jsonb; v_hash text; v_master text:=pg_temp.sha(p_seed||'-master');
  v_prefix text:='designpro/user_61000000-0000-4000-8000-000000000001/'||p_generation::text||'/flat-first/v1/';
BEGIN
  v_input:=jsonb_build_object(
    'contractVersion','designpro.calls-1-7-input.v3','pipelineMode','flat-first-atlas-v1',
    'vehicle',jsonb_build_object('year','2022','make','Ford','model','F250 Crew Cab','type','truck'),
    'brief','panel proof without logo fixture '||p_seed,
    'designName','Proof '||p_seed,'mode','commercial','companyName','Proof '||p_seed
  );
  IF p_logo IS NOT NULL THEN v_input:=v_input||jsonb_build_object('logoAsset',p_logo); END IF;
  v_hash:=pg_temp.sha(v_input::text);
  INSERT INTO public.designpro_generation_requests(
    id,generation_id,owner_id,tenant_key,idempotency_key,state,request_input,
    input_hash,engine_contract,engine_contract_hash,output_set_hash,engine_receipt,completed_at
  ) VALUES(
    p_request,p_generation,'61000000-0000-4000-8000-000000000001',
    'user_61000000-0000-4000-8000-000000000001',
    'calls17:'||p_generation::text||':'||v_hash,'outputs_ready',v_input,v_hash,
    designpro_private.calls_1_7_engine_contract(),
    pg_temp.sha(designpro_private.calls_1_7_engine_contract()::text),
    pg_temp.sha(p_seed||'-outputs'),
    jsonb_build_object(
      'contractVersion','designpro.calls-1-7-receipt.v1',
      'handoffRevisionId',p_revision::text,'atlasRevisionId',p_atlas::text,
      'callsCompleted','7','byteVerified','true'
    ),now()
  );
  INSERT INTO public.designpro_generation_views(
    request_id,source_view_type,consumer_role,storage_path,content_hash,byte_size,content_type,metadata)
  SELECT p_request,plan.source_view_type,plan.consumer_role,
    'designpro/user_61000000-0000-4000-8000-000000000001/'||p_generation::text
      ||'/calls-1-7/'||plan.source_view_type||'/'||pg_temp.sha(p_seed||plan.consumer_role)||'.png',
    pg_temp.sha(p_seed||plan.consumer_role),2048,'image/png','{}'::jsonb
  FROM (values ('side','driver'),('passenger-side','passenger'),('hood_detail','hood'),
    ('front','front'),('rear','rear'),('close-up','closeup'),('roof','roof'))
    AS plan(source_view_type,consumer_role);
  INSERT INTO public.designpro_flat_atlas_revisions(
    id,request_id,generation_id,owner_id,tenant_key,revision_sequence,
    guide_storage_path,guide_content_hash,guide_byte_size,guide_content_type,
    manifest_storage_path,manifest_content_hash,manifest_byte_size,manifest_content_type,
    master_storage_path,master_content_hash,master_byte_size,master_content_type,
    projection_storage_path,projection_content_hash,projection_byte_size,projection_content_type,
    manifest,model,prompt_version,width_px,height_px,effective_ppi,metadata
  ) VALUES(
    p_atlas,p_request,p_generation,'61000000-0000-4000-8000-000000000001',
    'user_61000000-0000-4000-8000-000000000001',1,
    v_prefix||'guide/'||pg_temp.sha(p_seed||'-guide')||'.png',pg_temp.sha(p_seed||'-guide'),10,'image/png',
    v_prefix||'manifest/'||pg_temp.sha(p_seed||'-manifest')||'.json',pg_temp.sha(p_seed||'-manifest'),10,'application/json',
    v_prefix||'revisions/1/master/'||v_master||'.png',v_master,10,'image/png',
    v_prefix||'revisions/1/projection/'||pg_temp.sha(p_seed||'-projection')||'.jpg',pg_temp.sha(p_seed||'-projection'),10,'image/jpeg',
    '{}'::jsonb,'gemini','designpro-flat-first-atlas-20260825.v7',4096,4096,17.94,
    jsonb_strip_nulls(jsonb_build_object(
      'masterQcPassed',true,
      'masterQcContract','designpro.atlas-master-semantic-qc.v1',
      'callOnePanels',pg_temp.panels(v_master,p_seed),
      'panelProofAuthoring',p_proof
    ))
  );
END $seed$;

-- Generation A: no logo, a three-zone proof on the accepted master.
select pg_temp.seed(
  '62000000-0000-4000-8000-00000000000a','63000000-0000-4000-8000-00000000000a',
  '65000000-0000-4000-8000-00000000000a','64000000-0000-4000-8000-00000000000a',
  'nologo',NULL,
  pg_temp.proof(pg_temp.sha('nologo-master'),'nologo',NULL)
);

-- Generation B: a logo, uploaded under its generation id (the asset-binding trigger requires it), with the proof
-- the compositor authored from it.
create temporary table logo_b on commit drop as
select jsonb_build_object(
  'storagePath','users/61000000-0000-4000-8000-000000000001/revisions/63000000-0000-4000-8000-00000000000b/inputs/logo/'||pg_temp.sha('logo-b')||'.png',
  'contentHash',pg_temp.sha('logo-b'),'byteSize',2137,'contentType','image/png') as logo;
select pg_temp.seed(
  '62000000-0000-4000-8000-00000000000b','63000000-0000-4000-8000-00000000000b',
  '65000000-0000-4000-8000-00000000000b','64000000-0000-4000-8000-00000000000b',
  'logo',(select logo from logo_b),
  pg_temp.proof(pg_temp.sha('logo-master'),'logo',(select logo from logo_b))
);

-- Generation C: a logo, but a master with no three-zone document.
select pg_temp.seed(
  '62000000-0000-4000-8000-00000000000c','63000000-0000-4000-8000-00000000000c',
  '65000000-0000-4000-8000-00000000000c','64000000-0000-4000-8000-00000000000c',
  'noproof',(select logo from logo_b),NULL
);

-- 1-2. The installed body is the patched one, and the logo branch survived it.
select ok(
  strpos(pg_get_functiondef('public.handoff_designpro_generation_to_production(uuid)'::regprocedure),
    'IF v_logo IS NULL AND v_logo_atlas.id IS NULL THEN')>0,
  'the print-master lookup no longer lives inside the logo branch'
);
select is(
  (select (length(d)-length(replace(d,E'IF v_logo IS NOT NULL THEN\n    IF v_input_contract','')))
     /length(E'IF v_logo IS NOT NULL THEN\n    IF v_input_contract')
   from pg_get_functiondef('public.handoff_designpro_generation_to_production(uuid)'::regprocedure) d),
  1,'the logo-inventory requirement still guards exactly one branch'
);

-- The real handoff, as the owner.
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"61000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);

create temporary table handoff_a on commit drop as
select public.handoff_designpro_generation_to_production(
  '62000000-0000-4000-8000-00000000000a') payload;

-- 3-9. No logo: the proof rides the frozen snapshot with an empty inventory.
select is((select payload->>'revisionId' from handoff_a),
  '65000000-0000-4000-8000-00000000000a','no-logo handoff freezes the revision source');
select ok(
  (select snapshot->'panelProofAuthoring'=pg_temp.proof(pg_temp.sha('nologo-master'),'nologo',NULL)
   from public.designpro_revision_sources where revision_id='65000000-0000-4000-8000-00000000000a'),
  'no-logo snapshot carries the exact three-zone panel proof of its accepted master'
);
select ok(
  (select snapshot->'expectedLogoInventory'='[]'::jsonb
   from public.designpro_revision_sources where revision_id='65000000-0000-4000-8000-00000000000a'),
  'no-logo snapshot expects no logo inventory'
);
select is(
  (select snapshot#>>'{logoInventoryAttestation,mode}'
   from public.designpro_revision_sources where revision_id='65000000-0000-4000-8000-00000000000a'),
  'none','no-logo snapshot attests mode none'
);
select is(
  (select snapshot->>'atlasRevisionId'
   from public.designpro_revision_sources where revision_id='65000000-0000-4000-8000-00000000000a'),
  '64000000-0000-4000-8000-00000000000a','no-logo snapshot names the print master revision it came from'
);
select is(
  (select snapshot->>'sourceMasterContentHash'
   from public.designpro_revision_sources where revision_id='65000000-0000-4000-8000-00000000000a'),
  pg_temp.sha('nologo-master'),'no-logo snapshot binds the master content hash'
);
select ok(
  (select snapshot->'callOnePanels'=pg_temp.panels(pg_temp.sha('nologo-master'),'nologo')
     and jsonb_array_length(snapshot->'callOnePanels')=6
   from public.designpro_revision_sources where revision_id='65000000-0000-4000-8000-00000000000a'),
  'no-logo snapshot still carries the six Call 1 panels of that same master'
);

-- 10-11. The no-logo handoff is idempotent and its entice run is A.T.L.A.S.
select is(
  (public.handoff_designpro_generation_to_production(
    '62000000-0000-4000-8000-00000000000a')->>'alreadyHandedOff')::boolean,
  true,'a replayed no-logo handoff recomputes the same snapshot and is idempotent'
);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(
  designpro_private.workflow_run_is_atlas((select id from public.designpro_workflow_runs
    where revision_id='65000000-0000-4000-8000-00000000000a' and workflow_type='designpro.entice_pack')),
  true,'the no-logo entice run exists and is A.T.L.A.S.'
);
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"61000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);

-- 12. A logo still requires the copied intake object under the handoff revision.
select throws_ok(
  $t$select public.handoff_designpro_generation_to_production('62000000-0000-4000-8000-00000000000b')$t$,
  'generation_logo_copy_required',
  'a logo brief is still refused until the logo is copied under the handoff revision'
);

-- 13. A logo still requires a three-zone proof to place it on.
select throws_ok(
  $t$select public.handoff_designpro_generation_to_production('62000000-0000-4000-8000-00000000000c')$t$,
  'generation_logo_placement_manifest_required',
  'a logo brief whose master carries no three-zone proof is still refused'
);

-- The copied logo, at the path the inventory names.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into storage.objects(bucket_id,name) values('wrap-files',
  'users/61000000-0000-4000-8000-000000000001/revisions/65000000-0000-4000-8000-00000000000b/inputs/logo/'
  ||pg_temp.sha('logo-b')||'.png');
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"61000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);

create temporary table handoff_b on commit drop as
select public.handoff_designpro_generation_to_production(
  '62000000-0000-4000-8000-00000000000b') payload;

-- 14-20. With a logo the with-logo contract is unchanged: five placements
-- listed, the proof attached, the same lineage keys.
select is((select payload->>'revisionId' from handoff_b),
  '65000000-0000-4000-8000-00000000000b','with-logo handoff freezes the revision source');
select is(
  (select jsonb_array_length(snapshot->'expectedLogoInventory')
   from public.designpro_revision_sources where revision_id='65000000-0000-4000-8000-00000000000b'),
  5,'with-logo snapshot lists the five compositor placements'
);
select is(
  (select array_agg(item->>'surfaceKey' order by item->>'surfaceKey')
   from public.designpro_revision_sources,lateral jsonb_array_elements(snapshot->'expectedLogoInventory') item
   where revision_id='65000000-0000-4000-8000-00000000000b'),
  array['driver','front','hood','passenger','rear'],
  'with-logo inventory covers driver, passenger, hood, front and rear'
);
select is(
  (select snapshot#>>'{logoInventoryAttestation,mode}'
   from public.designpro_revision_sources where revision_id='65000000-0000-4000-8000-00000000000b'),
  'listed','with-logo snapshot attests mode listed'
);
select is(
  (select snapshot#>>'{logoInventoryAttestation,placementPending}'
   from public.designpro_revision_sources where revision_id='65000000-0000-4000-8000-00000000000b'),
  'false','with-logo placements are frozen, not pending'
);
select ok(
  (select snapshot->'panelProofAuthoring'=pg_temp.proof(pg_temp.sha('logo-master'),'logo',(select logo from logo_b))
   from public.designpro_revision_sources where revision_id='65000000-0000-4000-8000-00000000000b'),
  'with-logo snapshot carries the exact three-zone panel proof'
);
select is(
  (select snapshot->>'atlasRevisionId'
   from public.designpro_revision_sources where revision_id='65000000-0000-4000-8000-00000000000b'),
  '64000000-0000-4000-8000-00000000000b','with-logo snapshot names the print master revision'
);

select * from finish();
rollback;
