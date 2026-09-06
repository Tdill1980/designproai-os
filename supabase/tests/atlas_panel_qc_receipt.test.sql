-- THE PANEL-QC PROJECTION IS TESTED BY CALLING IT OVER A ROW.
--
-- `20260905120000` patches `designpro_flat_atlas_generation_paths` to project
-- the panel-QC record -- which surfaces failed, which element the cut severed
-- on each, and at which edges -- into the `qc` object PanelPro Studio and
-- RevisionStudioIQ read.
--
-- The first cut of that migration ended with a DO block calling the function
-- for a generation id that does not exist. CI rejected it, correctly, and the
-- assertion was wrong twice over: NULL is the right answer for an unknown
-- generation (`IF v_owner IS NULL THEN RETURN NULL`), and returning at that
-- guard means the `jsonb_build_object` below it is NEVER EVALUATED. PL/pgSQL
-- compiles an expression the first time it is evaluated, which is exactly how
-- `pg_catalog.coalesce(...)` -- COALESCE is grammar, not a function -- once
-- applied clean in shadow AND production and then raised for every generation
-- that actually had data.
--
-- So every assertion here runs the function against a seeded revision whose
-- metadata carries a real panel-QC report. `has_function` would pass
-- without any of this; so would any check on the migration's text. Only
-- execution over data separates "this parsed" from "this runs".
begin;
select plan(16);

select has_function(
  'public','designpro_flat_atlas_generation_paths',ARRAY['uuid'],
  'the generation-keyed atlas read exists'
);
select ok(has_function_privilege(
  'authenticated','public.designpro_flat_atlas_generation_paths(uuid)','EXECUTE'
),'an authenticated owner may read their own atlas revisions');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values(
  '00000000-0000-0000-0000-000000000000',
  '61000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'atlas-panel-qc@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()
) on conflict(id) do nothing;

select set_config('request.jwt.claims','{"role":"service_role"}',true);

-- ARCTIC AIR `63e6629a`, AS MEASURED. The bottom band carries ONE contact
-- lockup; the cut lines x=1071, x=2198 and y=3335 all run through it, so the
-- badge lands on two surfaces and the banner on three. Driver and passenger
-- survive because they map 1:1 onto a third.
create temporary table panel_qc on commit drop as
select
  jsonb_build_array('roof','hood','front','rear') as failing,
  jsonb_build_array(
    jsonb_build_object('label','yeti shield lockup','status','contained',
      'surfaces',jsonb_build_array('driver'),
      'rect',jsonb_build_object('x',688,'y',332,'w',2601,'h',667)),
    jsonb_build_object('label','installer photograph','status','contained',
      'surfaces',jsonb_build_array('passenger'),
      'rect',jsonb_build_object('x',504,'y',1577,'w',2359,'h',946)),
    jsonb_build_object('label','arctic air badge','status','severed',
      'surfaces',jsonb_build_array('roof','hood'),
      'rect',jsonb_build_object('x',983,'y',3240,'w',258,'h',319)),
    jsonb_build_object('label','www.arcticair.com contact banner','status','severed',
      'surfaces',jsonb_build_array('hood','front','rear'),
      'rect',jsonb_build_object('x',1249,'y',3256,'w',1831,'h',299))
  ) as elements,
  jsonb_build_array(
    jsonb_build_object('surfaceKey','driver','ok',true,'orientation','landscape',
      'elementsIntact',jsonb_build_array('yeti shield lockup'),
      'elementsSevered',jsonb_build_array(),'findings',jsonb_build_array()),
    jsonb_build_object('surfaceKey','passenger','ok',true,'orientation','landscape',
      'elementsIntact',jsonb_build_array('installer photograph'),
      'elementsSevered',jsonb_build_array(),'findings',jsonb_build_array()),
    jsonb_build_object('surfaceKey','roof','ok',false,'orientation','portrait',
      'elementsIntact',jsonb_build_array(),
      'elementsSevered',jsonb_build_array('arctic air badge'),
      'findings',jsonb_build_array(jsonb_build_object(
        'code','atlas_panel_element_severed','surfaceKey','roof',
        'element','arctic air badge','edges',jsonb_build_array('right')))),
    jsonb_build_object('surfaceKey','hood','ok',false,'orientation','landscape',
      'elementsIntact',jsonb_build_array(),
      'elementsSevered',jsonb_build_array('arctic air badge','www.arcticair.com contact banner'),
      'findings',jsonb_build_array(jsonb_build_object(
        'code','atlas_panel_element_severed','surfaceKey','hood',
        'element','www.arcticair.com contact banner','edges',jsonb_build_array('right')))),
    jsonb_build_object('surfaceKey','front','ok',false,'orientation','landscape',
      'elementsIntact',jsonb_build_array(),
      'elementsSevered',jsonb_build_array('www.arcticair.com contact banner'),
      'findings',jsonb_build_array(jsonb_build_object(
        'code','atlas_panel_element_severed','surfaceKey','front',
        'element','www.arcticair.com contact banner',
        'edges',jsonb_build_array('left','bottom')))),
    jsonb_build_object('surfaceKey','rear','ok',false,'orientation','landscape',
      'elementsIntact',jsonb_build_array(),
      'elementsSevered',jsonb_build_array('www.arcticair.com contact banner'),
      'findings',jsonb_build_array(jsonb_build_object(
        'code','atlas_panel_element_severed','surfaceKey','rear',
        'element','www.arcticair.com contact banner',
        'edges',jsonb_build_array('left','top'))))
  ) as surfaces;

-- `designpro_generation_request_identity` requires the idempotency key to be
-- 'calls17:'||generation_id||':'||input_hash, and input_hash to be the sha256
-- of request_input. Building both from the same value is what the runtime does
-- and what the constraint checks.
create temporary table request_fixture on commit drop as
select
  jsonb_build_object(
    'contractVersion','designpro.calls-1-7-input.v3',
    'pipelineMode','flat-first-atlas-v1','mode','commercial',
    'companyName','Arctic Air','website','Www.ArcticAir.com',
    'brief','panel qc receipt fixture',
    -- REQUIRED by calls_1_7_input_v3_valid; omitting it is what CI rejected.
    'designName','Arctic Air',
    'vehicle',jsonb_build_object('year','2022','make','Toyota','model','Prius','type','car')
  ) as input;

insert into public.designpro_generation_requests(
  id,generation_id,owner_id,tenant_key,idempotency_key,state,request_input,
  input_hash,engine_contract,engine_contract_hash,output_set_hash,engine_receipt,completed_at
)
select
  '62000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  'user_61000000-0000-4000-8000-000000000001',
  'calls17:63000000-0000-4000-8000-000000000001:'
    ||encode(extensions.digest(convert_to(request_fixture.input::text,'UTF8'),'sha256'),'hex'),
  'outputs_ready',
  request_fixture.input,
  encode(extensions.digest(convert_to(request_fixture.input::text,'UTF8'),'sha256'),'hex'),
  designpro_private.calls_1_7_engine_contract(),
  encode(extensions.digest(convert_to(
    designpro_private.calls_1_7_engine_contract()::text,'UTF8'),'sha256'),'hex'),
  repeat('9',64),
  jsonb_build_object('contractVersion','designpro.calls-1-7-receipt.v1'),now()
from request_fixture;

insert into public.designpro_flat_atlas_revisions(
  id,request_id,generation_id,owner_id,tenant_key,revision_sequence,
  guide_storage_path,guide_content_hash,guide_byte_size,guide_content_type,
  manifest_storage_path,manifest_content_hash,manifest_byte_size,manifest_content_type,
  master_storage_path,master_content_hash,master_byte_size,master_content_type,
  projection_storage_path,projection_content_hash,projection_byte_size,projection_content_type,
  manifest,model,prompt_version,width_px,height_px,effective_ppi,metadata
)
select
  '64000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  'user_61000000-0000-4000-8000-000000000001',1,
  -- `designpro_flat_atlas_revision_paths` pins every path to
  -- designpro/<tenant_key>/<generation_id>/flat-first/v1/..., and pins the
  -- master and projection names to their own content hashes and content types.
  prefix.p||'guide/'||repeat('a',64)||'.png',repeat('a',64),10,'image/png',
  prefix.p||'manifest/'||repeat('b',64)||'.json',repeat('b',64),10,'application/json',
  prefix.p||'revisions/1/master/'||repeat('c',64)||'.png',repeat('c',64),10,'image/png',
  prefix.p||'revisions/1/projection/'||repeat('d',64)||'.jpg',repeat('d',64),10,'image/jpeg',
  '{}'::jsonb,'gemini-3-pro-image',
  'designpro-flat-first-atlas-20260902.v24-one-field',4096,4096,16.35,
  jsonb_build_object(
    'masterQcPassed',true,
    'canonicalMasterHash',repeat('c',64),
    -- The panel-QC record the migration must surface.
    'panelQcContract','designpro.atlas-panel-qc.v1',
    'panelQcFailingSurfaces',panel_qc.failing,
    'panelQcSurfaces',panel_qc.surfaces,
    'panelQcElements',panel_qc.elements
  )
from panel_qc, (select 'designpro/user_61000000-0000-4000-8000-000000000001/'
  ||'63000000-0000-4000-8000-000000000001/flat-first/v1/' as p) as prefix;

-- ── EXECUTION, over the seeded row ────────────────────────────────────────
create temporary table projected on commit drop as
select public.designpro_flat_atlas_generation_paths(
  '63000000-0000-4000-8000-000000000001'::uuid
) as payload;

select isnt(
  (select payload from projected),null,
  'the projection returns a payload for a generation that exists'
);

create temporary table qc on commit drop as
select (payload->0->'qc') as qc from projected;

select is(
  (select qc->>'panelQcContract' from qc),'designpro.atlas-panel-qc.v1',
  'the panel QC contract reaches the board'
);
select is(
  (select jsonb_array_length(qc->'panelQcFailingSurfaces') from qc),4,
  'the four surfaces the cut broke are named'
);
select is(
  (select qc->'panelQcFailingSurfaces' from qc),
  jsonb_build_array('roof','hood','front','rear'),
  'and they are named individually, so a repair can be aimed'
);
select is(
  (select jsonb_array_length(qc->'panelQcSurfaces') from qc),6,
  'every surface is reported, passing ones included'
);
select is(
  (select s->>'surfaceKey' from qc, jsonb_array_elements(qc->'panelQcSurfaces') s
    where (s->>'ok')::boolean limit 1),'driver',
  'a passing panel is visibly reported as passing, not merely omitted'
);
select is(
  (select s->'findings'->0->>'element' from qc, jsonb_array_elements(qc->'panelQcSurfaces') s
    where s->>'surfaceKey'='rear'),'www.arcticair.com contact banner',
  'the rear panel names the element the cut severed'
);
select is(
  (select s->'findings'->0->'edges' from qc, jsonb_array_elements(qc->'panelQcSurfaces') s
    where s->>'surfaceKey'='rear'),jsonb_build_array('left','top'),
  'and the edges it was severed at, which is what the panel file shows'
);
select is(
  (select jsonb_array_length(qc->'panelQcElements') from qc),4,
  'every located element is projected, contained ones included'
);
select is(
  (select e->>'status' from qc, jsonb_array_elements(qc->'panelQcElements') e
    where e->>'label'='yeti shield lockup'),'contained',
  'the driver lockup is recorded as printing whole — this is why driver is left alone'
);
select is(
  (select e->'rect'->>'w' from qc, jsonb_array_elements(qc->'panelQcElements') e
    where e->>'label'='www.arcticair.com contact banner'),'1831',
  'the contact banner rectangle is auditable in master pixels'
);
select is(
  (select qc->>'panelQcUnavailable' from qc),null,
  'a run that was actually checked carries no unavailable marker'
);

-- A revision authored BEFORE panel QC existed must stay readable, with every
-- panel-QC key resolving to null rather than raising (owner protection #1).
--
-- Seeded as its OWN generation rather than by updating the row above: atlas
-- revisions are immutable by trigger (`designpro_flat_atlas_row_is_immutable`),
-- which is exactly the guarantee that makes a published master citable.
create temporary table historical_input on commit drop as
select jsonb_build_object(
  'contractVersion','designpro.calls-1-7-input.v3',
  'pipelineMode','flat-first-atlas-v1','mode','commercial',
  'companyName','Arctic Air','brief','pre-panel-qc fixture',
  'designName','Arctic Air',
  'vehicle',jsonb_build_object('year','2022','make','Toyota','model','Prius','type','car')
) as input;

insert into public.designpro_generation_requests(
  id,generation_id,owner_id,tenant_key,idempotency_key,state,request_input,
  input_hash,engine_contract,engine_contract_hash,output_set_hash,engine_receipt,completed_at
)
select
  '62000000-0000-4000-8000-000000000002',
  '63000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000001',
  'user_61000000-0000-4000-8000-000000000001',
  'calls17:63000000-0000-4000-8000-000000000002:'
    ||encode(extensions.digest(convert_to(historical_input.input::text,'UTF8'),'sha256'),'hex'),
  'outputs_ready',
  historical_input.input,
  encode(extensions.digest(convert_to(historical_input.input::text,'UTF8'),'sha256'),'hex'),
  designpro_private.calls_1_7_engine_contract(),
  encode(extensions.digest(convert_to(
    designpro_private.calls_1_7_engine_contract()::text,'UTF8'),'sha256'),'hex'),
  repeat('9',64),
  jsonb_build_object('contractVersion','designpro.calls-1-7-receipt.v1'),now()
from historical_input;

insert into public.designpro_flat_atlas_revisions(
  id,request_id,generation_id,owner_id,tenant_key,revision_sequence,
  guide_storage_path,guide_content_hash,guide_byte_size,guide_content_type,
  manifest_storage_path,manifest_content_hash,manifest_byte_size,manifest_content_type,
  master_storage_path,master_content_hash,master_byte_size,master_content_type,
  projection_storage_path,projection_content_hash,projection_byte_size,projection_content_type,
  manifest,model,prompt_version,width_px,height_px,effective_ppi,metadata
)
select
  '64000000-0000-4000-8000-000000000002',
  '62000000-0000-4000-8000-000000000002',
  '63000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000001',
  'user_61000000-0000-4000-8000-000000000001',1,
  prefix.p||'guide/'||repeat('a',64)||'.png',repeat('a',64),10,'image/png',
  prefix.p||'manifest/'||repeat('b',64)||'.json',repeat('b',64),10,'application/json',
  prefix.p||'revisions/1/master/'||repeat('c',64)||'.png',repeat('c',64),10,'image/png',
  prefix.p||'revisions/1/projection/'||repeat('d',64)||'.jpg',repeat('d',64),10,'image/jpeg',
  '{}'::jsonb,'gemini-3-pro-image',
  'designpro-flat-first-atlas-20260902.v24-one-field',4096,4096,16.35,
  jsonb_build_object('masterQcPassed',true,'canonicalMasterHash',repeat('c',64))
from (select 'designpro/user_61000000-0000-4000-8000-000000000001/'
  ||'63000000-0000-4000-8000-000000000002/flat-first/v1/' as p) as prefix;

select is(
  (select (public.designpro_flat_atlas_generation_paths(
     '63000000-0000-4000-8000-000000000002'::uuid
   )->0->'qc'->>'panelQcContract')),
  null,
  'a pre-panel-qc revision projects null panel-QC keys and still reads'
);
select isnt(
  (select (public.designpro_flat_atlas_generation_paths(
     '63000000-0000-4000-8000-000000000002'::uuid
   )->0->>'masterContentHash')),
  null,
  'and its master is still readable, viewable and downloadable'
);

select * from finish();
rollback;
