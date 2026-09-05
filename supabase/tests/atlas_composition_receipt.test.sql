-- THE COMPOSITION PROJECTION IS TESTED BY CALLING IT OVER A ROW.
--
-- `20260905120000` patches `designpro_flat_atlas_generation_paths` to project
-- the composition record -- which elements were placed, where, and the exact
-- string that printed -- into the `qc` object PanelPro Studio and
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
-- metadata carries a real composition receipt. `has_function` would pass
-- without any of this; so would any check on the migration's text. Only
-- execution over data separates "this parsed" from "this runs".
begin;
select plan(12);

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
  'atlas-composition@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()
) on conflict(id) do nothing;

select set_config('request.jwt.claims','{"role":"service_role"}',true);

-- The Arctic Air geometry, and the composition that repairs it. `contact` is
-- the string that came back as `Www.Arct` on the hood and `ticAir.com` on the
-- rear; here it is one rectangle wholly inside the rear's trim box.
create temporary table composition on commit drop as
select
  jsonb_build_array(
    jsonb_build_object(
      'elementId','wordmark@rear','elementRef','wordmark','kind','wordmark',
      'surfaceKey','rear','safeInsetInches',2,
      'rectPx',jsonb_build_object('x',2389,'y',3468,'w',745,'h',162),
      'rectIn',jsonb_build_object('x',6.67,'y',3.12,'w',45.57,'h',9.91)),
    jsonb_build_object(
      'elementId','contact@rear','elementRef','contact','kind','contact',
      'surfaceKey','rear','safeInsetInches',2,
      'rectPx',jsonb_build_object('x',2349,'y',3668,'w',825,'h',90),
      'rectIn',jsonb_build_object('x',4.22,'y',15.35,'w',50.46,'h',5.51))
  ) as placements,
  jsonb_build_array(
    jsonb_build_object('elementId','tagline@front','surfaceKey','front',
      'kind','tagline','reason','below_minimum_legible_height',
      'heightIn',0.9,'minHeightIn',1.5)
  ) as skipped,
  jsonb_build_object(
    'contract','designpro.atlas-compose-master.v1',
    'groundHash',repeat('e',64),'composedHash',repeat('c',64),
    'planHash',repeat('f',64),'layerCount',3,'placedCount',2,
    'plateApplied',jsonb_build_array('contact'),
    'elements',jsonb_build_array(
      jsonb_build_object('elementId','contact@rear','kind','contact',
        'surfaceKey','rear','sourceKind','outlined-type',
        'string','Www.ArcticAir.com','fontSha256',repeat('a',64)))
  ) as compose_receipt;

insert into public.designpro_generation_requests(
  id,generation_id,owner_id,tenant_key,idempotency_key,state,request_input,
  input_hash,engine_contract,engine_contract_hash,output_set_hash,engine_receipt,completed_at
) values(
  '62000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  'user_61000000-0000-4000-8000-000000000001',
  'calls17:composition-fixture','outputs_ready',
  jsonb_build_object(
    'contractVersion','designpro.calls-1-7-input.v3',
    'pipelineMode','flat-first-atlas-v1','mode','commercial',
    'companyName','Arctic Air','website','Www.ArcticAir.com',
    'brief','composition receipt fixture',
    'vehicle',jsonb_build_object('year','2022','make','Toyota','model','Prius','type','car')),
  repeat('7',64),
  designpro_private.calls_1_7_engine_contract(),
  encode(extensions.digest(convert_to(
    designpro_private.calls_1_7_engine_contract()::text,'UTF8'),'sha256'),'hex'),
  repeat('9',64),
  jsonb_build_object('contractVersion','designpro.calls-1-7-receipt.v1'),now()
);

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
  'designpro/x/guide/'||repeat('a',64)||'.png',repeat('a',64),10,'image/png',
  'designpro/x/manifest/'||repeat('b',64)||'.json',repeat('b',64),10,'application/json',
  'designpro/x/revisions/1/master/'||repeat('c',64)||'.png',repeat('c',64),10,'image/png',
  'designpro/x/revisions/1/projection/'||repeat('d',64)||'.jpg',repeat('d',64),10,'image/jpeg',
  '{}'::jsonb,'gemini-3-pro-image',
  'designpro-flat-first-atlas-20260905.v25-ground-and-elements',4096,4096,16.35,
  jsonb_build_object(
    'masterQcPassed',true,
    'canonicalMasterHash',repeat('c',64),
    -- The composition record the migration must surface.
    'groundContract','designpro.atlas-field-prompt.v3',
    'groundMasterHash',repeat('e',64),
    'composeContract','designpro.atlas-compose-master.v1',
    'composeReceipt',composition.compose_receipt,
    'elementPlanContract','designpro.atlas-element-plan.v1',
    'elementPlanHash',repeat('f',64),
    'elementPlacements',composition.placements,
    'elementPlacementsSkipped',composition.skipped,
    'elementsContract','designpro.atlas-elements.v1',
    'elementsReceipt',jsonb_build_object(
      'fontSha256',repeat('a',64),
      'elementImageCallCount',2,
      'canonicalStrings',jsonb_build_object(
        'wordmark','Arctic Air','contact','Www.ArcticAir.com'))
  )
from composition;

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
select (payload->'revisions'->0->'qc') as qc from projected;

select is(
  (select qc->>'groundContract' from qc),'designpro.atlas-field-prompt.v3',
  'the ground contract reaches the board'
);
select is(
  (select qc->>'groundMasterHash' from qc),repeat('e',64),
  'what the model authored is projected beside what the customer buys'
);
select isnt(
  (select qc->>'groundMasterHash' from qc),
  (select qc->>'canonicalMasterHash' from qc),
  'the ground hash and the canonical master hash are distinguishable'
);
select is(
  (select jsonb_array_length(qc->'elementPlacements') from qc),2,
  'every placement is projected'
);
select is(
  (select qc->'elementPlacements'->1->>'surfaceKey' from qc),'rear',
  'a placement names the surface it was proved into'
);
select is(
  (select qc->'elementPlacements'->1->'rectIn'->>'w' from qc),'50.46',
  'the rectangle is projected in VEHICLE INCHES, which is what a reviewer measures'
);
select is(
  (select qc->'composeReceipt'->'elements'->0->>'string' from qc),
  'Www.ArcticAir.com',
  'the exact string that printed is answerable from the record'
);
select is(
  (select jsonb_array_length(qc->'elementPlacementsSkipped') from qc),1,
  'a surface left bare is a stated fact, not a silent omission'
);
select is(
  (select qc->'elementPlacementsSkipped'->0->>'minHeightIn' from qc),'1.5',
  'and it carries the measurement that decided it'
);

-- A revision authored BEFORE the ground split must stay readable, with every
-- composition key resolving to null rather than raising (owner protection #1).
update public.designpro_flat_atlas_revisions
set metadata = jsonb_build_object('masterQcPassed',true,'canonicalMasterHash',repeat('c',64))
where id='64000000-0000-4000-8000-000000000001';

select is(
  (select (public.designpro_flat_atlas_generation_paths(
     '63000000-0000-4000-8000-000000000001'::uuid
   )->'revisions'->0->'qc'->>'groundContract')),
  null,
  'a pre-composition revision projects null composition keys and still reads'
);

select * from finish();
rollback;
