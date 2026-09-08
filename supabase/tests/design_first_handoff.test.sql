begin;
select plan(46);

select has_table(
  'designpro_private','revision_fulfillment_bindings',
  'late fulfillment binding ledger exists'
);
select has_function(
  'public','bind_designpro_revision_fulfillment',
  ARRAY['uuid','text','text','text'],
  'owner late-binding RPC exists'
);
select ok(has_function_privilege(
  'authenticated',
  'public.bind_designpro_revision_fulfillment(uuid,text,text,text)',
  'EXECUTE'
), 'authenticated owner may bind fulfillment');
select ok(NOT has_function_privilege(
  'service_role',
  'public.bind_designpro_revision_fulfillment(uuid,text,text,text)',
  'EXECUTE'
), 'service role cannot impersonate the owner late binding');
select ok(NOT has_function_privilege(
  'anon',
  'public.bind_designpro_revision_fulfillment(uuid,text,text,text)',
  'EXECUTE'
), 'anonymous callers cannot bind fulfillment');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '11000000-0000-4000-8000-000000000001','authenticated','authenticated',
   'handoff-owner@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000',
   '22000000-0000-4000-8000-000000000002','authenticated','authenticated',
   'handoff-customer@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now())
on conflict(id) do nothing;

insert into public.designpro_qc_members(user_id,can_operate)
values('11000000-0000-4000-8000-000000000001',true)
on conflict(user_id) do update set can_operate=excluded.can_operate;

with input(value) as (values(jsonb_build_object(
  'contractVersion','designpro.calls-1-7-input.v2',
  'vehicle',jsonb_build_object(
    'year','2018','make','Ford','model','F 150 Crew Cab','type','truck'
  ),
  'brief','Flamingo Pools premium commercial full vehicle wrap',
  'designName','Flamingo Pools',
  'mode','commercial',
  'companyName','Flamingo Pools'
))), identity as (
  select value,
    encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex')
      input_hash,
    designpro_private.calls_1_7_engine_contract() engine_contract
  from input
)
insert into public.designpro_generation_requests(
  id,generation_id,owner_id,tenant_key,idempotency_key,state,request_input,
  input_hash,engine_contract,engine_contract_hash,output_set_hash,
  engine_receipt,completed_at
)
select
  '31000000-0000-4000-8000-000000000003',
  '32000000-0000-4000-8000-000000000003',
  '11000000-0000-4000-8000-000000000001',
  'user_11000000-0000-4000-8000-000000000001',
  'calls17:32000000-0000-4000-8000-000000000003:'||input_hash,
  'outputs_ready',value,input_hash,engine_contract,
  encode(extensions.digest(convert_to(engine_contract::text,'UTF8'),'sha256'),'hex'),
  repeat('f',64),
  jsonb_build_object(
    'contractVersion','designpro.calls-1-7-receipt.v1',
    'handoffRevisionId','33000000-0000-4000-8000-000000000003',
    'callsCompleted','7','byteVerified','true'
  ),now()
from identity;

with plan(source_view_type,consumer_role,ordinal) as (
  values ('side','driver',1),('passenger-side','passenger',2),
    ('hood_detail','hood',3),('front','front',4),('rear','rear',5),
    ('close-up','closeup',6),('roof','roof',7)
)
insert into public.designpro_generation_views(
  request_id,source_view_type,consumer_role,storage_path,content_hash,
  byte_size,content_type,metadata
)
select
  '31000000-0000-4000-8000-000000000003',source_view_type,consumer_role,
  'designpro/user_11000000-0000-4000-8000-000000000001/'
    ||'32000000-0000-4000-8000-000000000003/calls-1-7/'
    ||source_view_type||'/'||repeat(ordinal::text,64)||'.png',
  repeat(ordinal::text,64),1000+ordinal,'image/png','{}'::jsonb
from plan;

-- A legacy-shaped request below proves that a fresh Hero handoff cannot author
-- a new revision after Close-Up restoration.
with input(value) as (values(jsonb_build_object(
  'contractVersion','designpro.calls-1-7-input.v2',
  'vehicle',jsonb_build_object(
    'year','2024','make','Ford','model','F 250 Crew Cab','type','truck'
  ),
  'brief','Current Close-Up revision boundary regression',
  'designName','Close-Up Contract',
  'mode','commercial',
  'companyName','Close-Up Contract'
))), identity as (
  select value,
    encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex')
      input_hash,
    designpro_private.calls_1_7_engine_contract() engine_contract
  from input
)
insert into public.designpro_generation_requests(
  id,generation_id,owner_id,tenant_key,idempotency_key,state,request_input,
  input_hash,engine_contract,engine_contract_hash,output_set_hash,
  engine_receipt,completed_at
)
select
  '31000000-0000-4000-8000-000000000004',
  '32000000-0000-4000-8000-000000000004',
  '11000000-0000-4000-8000-000000000001',
  'user_11000000-0000-4000-8000-000000000001',
  'calls17:32000000-0000-4000-8000-000000000004:'||input_hash,
  'outputs_ready',value,input_hash,engine_contract,
  encode(extensions.digest(convert_to(engine_contract::text,'UTF8'),'sha256'),'hex'),
  repeat('e',64),
  jsonb_build_object(
    'contractVersion','designpro.calls-1-7-receipt.v1',
    'handoffRevisionId','33000000-0000-4000-8000-000000000004',
    'callsCompleted','7','byteVerified','true'
  ),now()
from identity;

with plan(source_view_type,consumer_role,ordinal) as (
  values ('side','driver',1),('passenger-side','passenger',2),
    ('hood_detail','hood',3),('front','front',4),('rear','rear',5),
    ('hero-3d','hero3d',6),('roof','roof',7)
)
insert into public.designpro_generation_views(
  request_id,source_view_type,consumer_role,storage_path,content_hash,
  byte_size,content_type,metadata
)
select
  '31000000-0000-4000-8000-000000000004',source_view_type,consumer_role,
  'designpro/user_11000000-0000-4000-8000-000000000001/'
    ||'32000000-0000-4000-8000-000000000004/calls-1-7/'
    ||source_view_type||'/'||repeat(ordinal::text,64)||'.png',
  repeat(ordinal::text,64),2000+ordinal,'image/png','{}'::jsonb
from plan;

select is(
  (select count(*)::integer
   from designpro_private.wrapbox_delivery_recipients),0,
  'the v2 handoff starts with no registered recipient'
);

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"11000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);
create temporary table first_handoff as
select public.handoff_designpro_generation_to_production(
  '31000000-0000-4000-8000-000000000003'
) payload;

select is(
  (select (payload->>'alreadyHandedOff')::boolean from first_handoff),false,
  'first v2 handoff creates the immutable revision'
);
select matches(
  (select payload->>'workflowRunId' from first_handoff),
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  'first v2 handoff starts the existing workflow'
);

select ok(
  (select (snapshot->'renderAssets' ? 'closeup')
      AND NOT (snapshot->'renderAssets' ? 'hero3d')
      AND (select count(*)
           from jsonb_object_keys(snapshot->'renderAssets'))=7
   from public.designpro_revision_sources
   where revision_id='33000000-0000-4000-8000-000000000003'),
  'current revision freezes exactly seven Close-Up identities without Hero'
);
select throws_ok(
  $$select public.handoff_designpro_generation_to_production(
    '31000000-0000-4000-8000-000000000004'
  )$$,
  'P0001','seven_render_asset_identities_required',
  'a fresh historical Hero-shaped handoff cannot author a new revision'
);
select ok(
  (select snapshot#>>'{fulfillment,state}'='unbound'
     AND NOT (snapshot ?| ARRAY['orderNumber','delivery'])
   from public.designpro_revision_sources
   where revision_id='33000000-0000-4000-8000-000000000003'),
  'v2 freezes an explicit unbound state without placeholder fulfillment'
);
select is(
  (select snapshot->>'sourceInputContract'
   from public.designpro_revision_sources
   where revision_id='33000000-0000-4000-8000-000000000003'),
  'designpro.calls-1-7-input.v2',
  'the unbound branch is pinned to normal v2'
);
select throws_ok(
  $$select public.save_designpro_revision_source(
    '33000000-0000-4000-8000-000000000003',
    '32000000-0000-4000-8000-000000000003',
    '31000000-0000-4000-8000-000000000003',
    (select expected_updated_at from public.designpro_revision_sources
     where revision_id='33000000-0000-4000-8000-000000000003'),
    (select snapshot from public.designpro_revision_sources
     where revision_id='33000000-0000-4000-8000-000000000003'),
    null,'calls17-handoff:31000000-0000-4000-8000-000000000003'
  )$$,
  'P0001','design_first_handoff_rpc_required',
  'generic authenticated revision ingestion cannot mint an unbound source'
);
select is(
  (select count(*)::integer from public.designpro_workflow_runs
   where revision_id='33000000-0000-4000-8000-000000000003'
     and workflow_type='designpro.entice_pack'),1,
  'one entice workflow is created'
);
-- GENIE deploys on order, so manifest.resolve is no longer one of these. The
-- free run is asserted by name rather than by count: a stage silently added or
-- dropped here is the failure mode this test exists to catch.
--
-- THE EXTRACTION BRANCH RUNS AHEAD OF THE 2D PROOF (owner 2026-08-27).
-- `proof.build` sat second, so `panels.build` -- a pure byte promotion of the
-- panels Call 1 already cut and hashed, with no AI in it -- was queued behind an
-- AI proof-sheet render, and `logos.extract` behind them both.
-- `claim_designpro_stage` admits a stage only when every LOWER-sequence stage
-- has completed, so that ordering was a hard barrier: every panel and every logo
-- in PanelPro waited on a documentation artifact.
select results_eq(
  $$select s.stage_key from public.designpro_workflow_stages s
    join public.designpro_workflow_runs r on r.id=s.run_id
    where r.revision_id='33000000-0000-4000-8000-000000000003'
      and r.workflow_type='designpro.entice_pack'
    order by s.sequence$$,
  $$values ('revision.freeze'),('panels.build'),('logos.extract'),
    ('panels.delogo'),('proof.build'),('pack.verify'),('pack.activate')$$,
  'the revision-to-Call-11 free run runs without GENIE'
);
-- And the dependencies that are REAL, asserted as relations rather than
-- positions, so a future reorder has to keep meaning them.
select ok(
  (select s.sequence from public.designpro_workflow_stages s
     join public.designpro_workflow_runs r on r.id=s.run_id
     where r.revision_id='33000000-0000-4000-8000-000000000003'
       and r.workflow_type='designpro.entice_pack' and s.stage_key='panels.build')
  < (select s.sequence from public.designpro_workflow_stages s
     join public.designpro_workflow_runs r on r.id=s.run_id
     where r.revision_id='33000000-0000-4000-8000-000000000003'
       and r.workflow_type='designpro.entice_pack' and s.stage_key='proof.build'),
  'no panel waits on the 2D proof'
);
select ok(
  (select s.sequence from public.designpro_workflow_stages s
     join public.designpro_workflow_runs r on r.id=s.run_id
     where r.revision_id='33000000-0000-4000-8000-000000000003'
       and r.workflow_type='designpro.entice_pack' and s.stage_key='logos.extract')
  > (select s.sequence from public.designpro_workflow_stages s
     join public.designpro_workflow_runs r on r.id=s.run_id
     where r.revision_id='33000000-0000-4000-8000-000000000003'
       and r.workflow_type='designpro.entice_pack' and s.stage_key='panels.build'),
  'Call 10 still separates logos from the Call 9 panels'
);
select ok(
  (select s.sequence from public.designpro_workflow_stages s
     join public.designpro_workflow_runs r on r.id=s.run_id
     where r.revision_id='33000000-0000-4000-8000-000000000003'
       and r.workflow_type='designpro.entice_pack' and s.stage_key='proof.build')
  < (select s.sequence from public.designpro_workflow_stages s
     join public.designpro_workflow_runs r on r.id=s.run_id
     where r.revision_id='33000000-0000-4000-8000-000000000003'
       and r.workflow_type='designpro.entice_pack' and s.stage_key='pack.verify'),
  'pack.verify is the first stage that reads the Call 8 receipt'
);

-- Simulate the exact crash window: revision insertion committed, workflow
-- creation did not. A replay must repair the workflow instead of returning at
-- the mere existence of the revision row.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
delete from public.designpro_workflow_runs
where id=(select (payload->>'workflowRunId')::uuid from first_handoff);

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"11000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);
create temporary table replay_handoff as
select public.handoff_designpro_generation_to_production(
  '31000000-0000-4000-8000-000000000003'
) payload;

select is(
  (select (payload->>'alreadyHandedOff')::boolean from replay_handoff),true,
  'replay recognizes the exact existing revision'
);
select matches(
  (select payload->>'workflowRunId' from replay_handoff),
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  'replay repairs and returns the workflow identity'
);
select is(
  (select count(*)::integer from public.designpro_revision_sources
   where revision_id='33000000-0000-4000-8000-000000000003'),1,
  'replay never duplicates the revision source'
);
select is(
  (select count(*)::integer from public.designpro_workflow_stages s
   join public.designpro_workflow_runs r on r.id=s.run_id
   where r.id=(select (payload->>'workflowRunId')::uuid from replay_handoff)),7,
  'repaired workflow receives the complete Calls 8-11 schedule'
);

-- A paid production run exists, but neither the paid-products RPC nor the
-- reconciler may authorize it while fulfillment is still unbound.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
with entice as (
  select * from public.designpro_workflow_runs
  where id=(select (payload->>'workflowRunId')::uuid from replay_handoff)
)
insert into public.designpro_workflow_runs(
  id,workflow_type,owner_id,tenant_key,idempotency_key,status,revision_id,
  revision_snapshot_hash,entice_pack_id,dimension_manifest_id,
  source_contract_hash,manifest_hash,artifact_set_hash,input,results
)
select
  '34000000-0000-4000-8000-000000000003','designpro.production_pack',
  owner_id,tenant_key,'late-binding-production','approval_required',revision_id,
  revision_snapshot_hash,entice_pack_id,
  '35000000-0000-4000-8000-000000000003',repeat('a',64),repeat('b',64),
  repeat('c',64),
  jsonb_build_object('sourceEnticeRunId',id,'dimensionManifest','{}'::jsonb),
  jsonb_build_object('sourceEnticeRunId',id)
from entice;

insert into public.designpro_workflow_stages(
  id,run_id,stage_key,sequence,status,idempotency_key,wait_reason
) values(
  '36000000-0000-4000-8000-000000000003',
  '34000000-0000-4000-8000-000000000003',
  'await_purchase',0,'waiting',
  '34000000-0000-4000-8000-000000000003:await_purchase','purchase_required'
);

insert into public.designpro_purchase_entitlements(
  id,owner_id,entice_run_id,generation_id,product_type,amount_cents,
  checkout_session_id
) values(
  '37000000-0000-4000-8000-000000000003',
  '11000000-0000-4000-8000-000000000001',
  (select (payload->>'workflowRunId')::uuid from replay_handoff),
  '32000000-0000-4000-8000-000000000003',
  'print_pack_entitlement',29900,'cs_design_first_unbound'
);

select is(
  public.designpro_paid_products(
    (select (payload->>'workflowRunId')::uuid from replay_handoff)
  ),ARRAY[]::text[],
  'payment alone exposes no paid products while fulfillment is unbound'
);
select is(
  (public.reconcile_designpro_purchase_gates()->>'released')::integer,0,
  'payment alone cannot release the purchase gate'
);
select is(
  (select status from public.designpro_workflow_stages
   where id='36000000-0000-4000-8000-000000000003'),'waiting',
  'unbound paid run remains parked'
);

create temporary table registered_recipient as
select public.register_designpro_operator_wrapbox_recipient(
  '11000000-0000-4000-8000-000000000001',
  'handoff-customer@designproai.test','Flamingo Pools customer',repeat('d',64),
  'FP-2026-0001'
) payload;

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"11000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);
create temporary table first_binding as
select public.bind_designpro_revision_fulfillment(
  '33000000-0000-4000-8000-000000000003',
  (select payload->>'recipientIdentityHash' from registered_recipient),
  'FP-2026-0001','Flamingo Pools'
) payload;
create temporary table replay_binding as
select public.bind_designpro_revision_fulfillment(
  '33000000-0000-4000-8000-000000000003',
  (select payload->>'recipientIdentityHash' from registered_recipient),
  'FP-2026-0001','Flamingo Pools'
) payload;

select is(
  (select (payload->>'idempotent')::boolean from first_binding),false,
  'first late binding appends one immutable fulfillment row'
);
select is(
  (select (payload->>'idempotent')::boolean from replay_binding),true,
  'exact late-binding replay is idempotent'
);
select throws_ok(
  $$select public.bind_designpro_revision_fulfillment(
    '33000000-0000-4000-8000-000000000003',
    (select payload->>'recipientIdentityHash' from registered_recipient),
    'FP-2026-0001','A Different Design Name'
  )$$,
  'P0001','revision_fulfillment_identity_conflict',
  'late-binding identity drift is refused'
);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok(
  $$update designpro_private.revision_fulfillment_bindings
    set design_name='Changed'
    where revision_id='33000000-0000-4000-8000-000000000003'$$,
  'P0001','designpro_revision_fulfillment_is_immutable',
  'the fulfillment row cannot be updated after binding'
);
select is(
  public.designpro_paid_products(
    (select (payload->>'workflowRunId')::uuid from replay_handoff)
  ),ARRAY['print_pack_entitlement']::text[],
  'paid products become visible only after exact fulfillment binding'
);
select is(
  (public.reconcile_designpro_purchase_gates()->>'released')::integer,1,
  'binding plus payment releases exactly one purchase gate'
);
select is(
  (select status from public.designpro_workflow_stages
   where id='36000000-0000-4000-8000-000000000003'),'pending',
  'the bound paid stage returns to the one worker queue'
);
select matches(
  (select input#>>'{fulfillment,bindingHash}'
   from public.designpro_workflow_runs
   where id='34000000-0000-4000-8000-000000000003'),
  '^[0-9a-f]{64}$',
  'the production run freezes the exact late-binding hash before release'
);

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"11000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);
select is(
  public.get_designpro_revision_fulfillment(
    '33000000-0000-4000-8000-000000000003'
  )->>'orderNumber','FP-2026-0001',
  'owner and runtime resolve the same frozen late-bound Order #'
);

-- Panel-less historical v2 generations still support the handoff and payment
-- history above, but the runtime now refuses to manufacture them. Final QC
-- therefore needs a separate accepted A.T.L.A.S. source: its six canonical
-- panels cross the real handoff before the immutable snapshot is created.
-- Fulfillment is still appended afterward, so the final-QC regression remains
-- the same: snapshot.orderNumber cannot stand in for the late-bound Order #.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.designpro_qc_members
set can_final_qc=true
where user_id='11000000-0000-4000-8000-000000000001';

-- Match the runtime's sorted-key compact JSON hashes. Snapshot hashes continue
-- to be computed by the handoff RPC from the actual frozen PostgreSQL JSON.
create function pg_temp.handoff_canonical_json(p_value jsonb)
returns text language sql immutable as $canonical$
  select case jsonb_typeof(p_value)
    when 'object' then (
      select '{'||coalesce(string_agg(to_jsonb(key)::text||':'
        ||pg_temp.handoff_canonical_json(value),',' order by key collate "C"),'')||'}'
      from jsonb_each(p_value)
    )
    when 'array' then (
      select '['||coalesce(string_agg(pg_temp.handoff_canonical_json(value),','
        order by ordinal),'')||']'
      from jsonb_array_elements(p_value) with ordinality a(value,ordinal)
    )
    else p_value::text
  end;
$canonical$;
create function pg_temp.handoff_hash(p_value text)
returns text language sql immutable as $hash$
  select encode(extensions.digest(convert_to(p_value,'UTF8'),'sha256'),'hex');
$hash$;
create function pg_temp.handoff_json_hash(p_value jsonb)
returns text language sql immutable as $hash$
  select pg_temp.handoff_hash(pg_temp.handoff_canonical_json(p_value));
$hash$;

create temporary table production_panels on commit drop as
select jsonb_agg(jsonb_build_object(
  'surfaceKey',surface_key,
  'contract','designpro.flat-first-atlas-call1-panel.v1',
  'contentHash',pg_temp.handoff_hash('late-bound-panel-'||surface_key),
  'sourceMasterHash',pg_temp.handoff_hash('late-bound-master'),
  'storagePath','designpro/user_11000000-0000-4000-8000-000000000001/'
    ||'42000000-0000-4000-8000-000000000005/flat-first/v1/panels/'||surface_key||'.png',
  'byteSize',1024,'contentType','image/png',
  'trimWidthIn',100+ordinal,'trimHeightIn',50,
  'printWidthIn',110+ordinal,'printHeightIn',60,
  'surfaceSqFt',round((100+ordinal)*50/144.0,2),
  'bleedInches',5,'effectivePpi',17.94,
  'geometryPurpose','calls-1-7-layout-only'
) order by ordinal) panels
from (values ('driver',1),('passenger',2),('hood',3),
  ('roof',4),('front',5),('rear',6)) p(surface_key,ordinal);

with input(value) as (values(jsonb_build_object(
  'contractVersion','designpro.calls-1-7-input.v3',
  'pipelineMode','flat-first-atlas-v1',
  'vehicle',jsonb_build_object(
    'year','2018','make','Ford','model','F 150 Crew Cab','type','truck'),
  'brief','Flamingo Pools canonical production panels',
  'designName','Flamingo Pools','mode','commercial','companyName','Flamingo Pools'
))), identity as (
  select value,pg_temp.handoff_hash(value::text) input_hash,
    designpro_private.calls_1_7_engine_contract() engine_contract
  from input
)
insert into public.designpro_generation_requests(
  id,generation_id,owner_id,tenant_key,idempotency_key,state,request_input,
  input_hash,engine_contract,engine_contract_hash,output_set_hash,
  engine_receipt,completed_at
)
select
  '41000000-0000-4000-8000-000000000005',
  '42000000-0000-4000-8000-000000000005',
  '11000000-0000-4000-8000-000000000001',
  'user_11000000-0000-4000-8000-000000000001',
  'calls17:42000000-0000-4000-8000-000000000005:'||input_hash,
  'outputs_ready',value,input_hash,engine_contract,
  pg_temp.handoff_hash(engine_contract::text),pg_temp.handoff_hash('late-bound-view-set'),
  jsonb_build_object(
    'contractVersion','designpro.calls-1-7-receipt.v1',
    'handoffRevisionId','43000000-0000-4000-8000-000000000005',
    'callsCompleted','7','byteVerified','true'
  ),now()
from identity;

insert into public.designpro_generation_views(
  request_id,source_view_type,consumer_role,storage_path,content_hash,
  byte_size,content_type,metadata
)
select
  '41000000-0000-4000-8000-000000000005',source_view_type,consumer_role,
  'designpro/user_11000000-0000-4000-8000-000000000001/'
    ||'42000000-0000-4000-8000-000000000005/calls-1-7/'||source_view_type||'/'
    ||pg_temp.handoff_hash('late-bound-view-'||consumer_role)||'.png',
  pg_temp.handoff_hash('late-bound-view-'||consumer_role),2048,'image/png','{}'::jsonb
from (values ('side','driver'),('passenger-side','passenger'),
  ('hood_detail','hood'),('front','front'),('rear','rear'),
  ('close-up','closeup'),('roof','roof')) p(source_view_type,consumer_role);

insert into public.designpro_flat_atlas_revisions(
  id,request_id,generation_id,owner_id,tenant_key,revision_sequence,
  guide_storage_path,guide_content_hash,guide_byte_size,guide_content_type,
  manifest_storage_path,manifest_content_hash,manifest_byte_size,manifest_content_type,
  master_storage_path,master_content_hash,master_byte_size,master_content_type,
  projection_storage_path,projection_content_hash,projection_byte_size,projection_content_type,
  manifest,model,prompt_version,width_px,height_px,effective_ppi,metadata
)
select
  '49000000-0000-4000-8000-000000000005',
  '41000000-0000-4000-8000-000000000005',
  '42000000-0000-4000-8000-000000000005',
  '11000000-0000-4000-8000-000000000001',
  'user_11000000-0000-4000-8000-000000000001',1,
  prefix||'guide/'||pg_temp.handoff_hash('late-bound-guide')||'.png',
    pg_temp.handoff_hash('late-bound-guide'),100,'image/png',
  prefix||'manifest/'||pg_temp.handoff_json_hash('{}'::jsonb)||'.json',
    pg_temp.handoff_json_hash('{}'::jsonb),2,'application/json',
  prefix||'revisions/1/master/'||pg_temp.handoff_hash('late-bound-master')||'.png',
    pg_temp.handoff_hash('late-bound-master'),4096,'image/png',
  prefix||'revisions/1/projection/'||pg_temp.handoff_hash('late-bound-projection')||'.jpg',
    pg_temp.handoff_hash('late-bound-projection'),2048,'image/jpeg',
  '{}'::jsonb,'gemini','designpro-flat-first-atlas-20260825.v7',4096,4096,17.94,
  jsonb_build_object('masterQcPassed',true,
    'masterQcContract','designpro.atlas-master-semantic-qc.v1',
    'callOnePanels',(select panels from production_panels))
from (select 'designpro/user_11000000-0000-4000-8000-000000000001/'
  ||'42000000-0000-4000-8000-000000000005/flat-first/v1/' prefix) p;

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"11000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);
create temporary table production_handoff on commit drop as
select public.handoff_designpro_generation_to_production(
  '41000000-0000-4000-8000-000000000005') payload;
select ok(
  (select snapshot->'callOnePanels'=(select panels from production_panels)
     AND jsonb_array_length(snapshot->'callOnePanels')=6
     AND snapshot#>>'{fulfillment,state}'='unbound'
     AND NOT (snapshot ?| ARRAY['orderNumber','delivery'])
   from public.designpro_revision_sources
   where revision_id='43000000-0000-4000-8000-000000000005'),
  'the production handoff freezes six canonical panels before fulfillment binding'
);
select public.bind_designpro_revision_fulfillment(
  '43000000-0000-4000-8000-000000000005',
  (select payload->>'recipientIdentityHash' from registered_recipient),
  'FP-2026-0001','Flamingo Pools'
);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table production_manifest on commit drop as
select jsonb_build_object(
  'contract','designpro.genie-dimension-manifest.v1',
  'genieVerified',true,
  'totalSqFt',round(sum((p->>'trimWidthIn')::numeric*(p->>'trimHeightIn')::numeric)/144,2),
  'expectedSurfaces',jsonb_agg(jsonb_build_object(
    'surfaceKey',p->>'surfaceKey','widthInches',p->'trimWidthIn',
    'heightInches',p->'trimHeightIn') order by p->>'surfaceKey')
) manifest
from production_panels,lateral jsonb_array_elements(panels) p;

insert into public.designpro_workflow_runs(
  id,workflow_type,owner_id,tenant_key,idempotency_key,status,revision_id,
  revision_snapshot_hash,entice_pack_id,dimension_manifest_id,
  source_contract_hash,manifest_hash,artifact_set_hash,input,results
)
select
  '44000000-0000-4000-8000-000000000005','designpro.production_pack',
  e.owner_id,e.tenant_key,'late-binding-canonical-production','running',e.revision_id,
  e.revision_snapshot_hash,e.entice_pack_id,
  '45000000-0000-4000-8000-000000000005',
  pg_temp.handoff_hash('late-bound-source'),pg_temp.handoff_json_hash(m.manifest),
  pg_temp.handoff_json_hash(p.panels),
  jsonb_build_object('sourceEnticeRunId',e.id,
    'fulfillment',designpro_private.revision_fulfillment(e.revision_id)),
  jsonb_build_object('sourceEnticeRunId',e.id,'dimensionManifest',m.manifest)
from public.designpro_workflow_runs e,production_manifest m,production_panels p
where e.id=(select (payload->>'workflowRunId')::uuid from production_handoff);

insert into public.designpro_purchase_entitlements(
  owner_id,entice_run_id,generation_id,product_type,amount_cents,checkout_session_id
) values(
  '11000000-0000-4000-8000-000000000001',
  (select (payload->>'workflowRunId')::uuid from production_handoff),
  '42000000-0000-4000-8000-000000000005',
  'print_pack_entitlement',29900,'cs_design_first_canonical'
);
create temporary table production_identity on commit drop as
select jsonb_build_object(
  'workflowRunId',id,'revisionId',revision_id,'enticePackId',entice_pack_id,
  'dimensionManifestId',dimension_manifest_id,'sourceContractHash',source_contract_hash,
  'manifestHash',manifest_hash,'artifactSetHash',artifact_set_hash
) identity from public.designpro_workflow_runs
where id='44000000-0000-4000-8000-000000000005';

create temporary table production_call8 on commit drop as
with built as (
  select jsonb_build_object(
    'verified',true,'receiptKind','call8.flat-proof','call',8,
    'producer','designpro.call8-panel-proof.v4','deterministic',true,
    'imageRequestCount',0,'proofPixelsUsed',false,
    'dimensionsAuthority','genie-universal-panelizer','bleedInches',5,
    'manifestHash',r.manifest_hash,'dimensionManifestId',r.dimension_manifest_id,
    'totalSqFt',m.manifest->'totalSqFt',
    'sourceProofHash',pg_temp.handoff_hash('late-bound-call8'),
    'storagePath','designpro/'||r.tenant_key||'/'||r.id::text||'/proof/original-call8.png',
    'surfaceTiles',(select jsonb_agg(p||jsonb_build_object(
      'sourcePanelHash',p->>'contentHash','sourcePanelPath',p->>'storagePath',
      'dimensionRuleBasis','trim-boundary','continuousArtwork',true,
      'sourceAspectPreserved',true,
      'bleedInches',jsonb_build_object('top',5,'right',5,'bottom',5,'left',5)
    ) order by p->>'surfaceKey') from production_panels,
      lateral jsonb_array_elements(panels) p)
  ) receipt
  from public.designpro_workflow_runs r,production_manifest m
  where r.id='44000000-0000-4000-8000-000000000005'
)
select jsonb_build_object('receiptKind','call8.flat-proof',
  'receiptHash',pg_temp.handoff_json_hash(receipt),
  'receipt',receipt,'reconciledForProduction',true) call8
from built;

insert into public.designpro_workflow_stages(
  id,run_id,stage_key,sequence,status,idempotency_key,output,verification,completed_at
)
select id,'44000000-0000-4000-8000-000000000005',stage_key,sequence,'completed',
  '44000000-0000-4000-8000-000000000005:'||stage_key,output,'{"verified":true}'::jsonb,now()
from (values
  ('46000000-0000-4000-8000-000000000001'::uuid,'await_purchase',0,
    jsonb_build_object('authorizedAssetManifest',jsonb_build_object(
      'products',jsonb_build_array('print_pack_entitlement'),
      'productionPackAuthorized',true,'logoPackAuthorized',false,
      'requiredOutputFiles',18,'zipIncludesSourceViews',true))),
  ('46000000-0000-4000-8000-000000000002'::uuid,'source.verify',10,
    jsonb_build_object('call8',(select call8 from production_call8)))
) s(id,stage_key,sequence,output);

create temporary table production_views on commit drop as
select jsonb_agg(jsonb_build_object('viewKey',key)||value order by key collate "C") views
from public.designpro_revision_sources,lateral jsonb_each(snapshot->'renderAssets')
where revision_id='43000000-0000-4000-8000-000000000005';
create temporary table production_frozen_views on commit drop as
select jsonb_build_object('verified',true,'sevenViewsVerified',true,'viewReceipts',views) receipt
from production_views;
update public.designpro_workflow_stages
set status='completed',output=(select receipt from production_frozen_views),
  verification='{"verified":true}'::jsonb,
  output_hash=(select pg_temp.handoff_json_hash(receipt) from production_frozen_views),
  completed_at=now()
where run_id=(select (payload->>'workflowRunId')::uuid from production_handoff)
  and stage_key='revision.freeze';
insert into public.designpro_stage_receipts(
  run_id,stage_id,receipt_kind,identity,receipt,receipt_hash
)
select s.run_id,s.id,'views.seven-source','{}'::jsonb,f.receipt,
  pg_temp.handoff_json_hash(f.receipt)
from public.designpro_workflow_stages s,production_frozen_views f
where s.run_id=(select (payload->>'workflowRunId')::uuid from production_handoff)
  and s.stage_key='revision.freeze';

insert into public.designpro_artifacts(
  run_id,stage_id,artifact_kind,storage_path,content_hash,byte_size,metadata
)
select r.id,'46000000-0000-4000-8000-000000000002','flat-proof',
  'designpro/'||r.tenant_key||'/'||r.id::text||'/source/call8-2d-production-proof.png',
  c.call8#>>'{receipt,sourceProofHash}',999,
  jsonb_build_object('sourceReceiptHash',c.call8->>'receiptHash',
    'manifestHash',r.manifest_hash,'sourceStoragePath',c.call8#>>'{receipt,storagePath}',
    'sourceContentHash',c.call8#>>'{receipt,sourceProofHash}')
from public.designpro_workflow_runs r,production_call8 c
where r.id='44000000-0000-4000-8000-000000000005';

insert into public.designpro_workflow_stages(
  id,run_id,stage_key,sequence,status,idempotency_key
) values
  ('46000000-0000-4000-8000-000000000003',
   '44000000-0000-4000-8000-000000000005','output.verify',55,'pending',
   '44000000-0000-4000-8000-000000000005:output.verify'),
  ('46000000-0000-4000-8000-000000000004',
   '44000000-0000-4000-8000-000000000005','await_final_human_qc',60,'pending',
   '44000000-0000-4000-8000-000000000005:await_final_human_qc'),
  ('46000000-0000-4000-8000-000000000005',
   '44000000-0000-4000-8000-000000000005','stamp.build',70,'pending',
   '44000000-0000-4000-8000-000000000005:stamp.build');
-- Seed the same singleton binding claim_designpro_stage acquires before it
-- starts output.verify. The installed lease trigger still fences this worker.
update designpro_private.heavy_stage_leases
set stage_id='46000000-0000-4000-8000-000000000003',
  lease_owner='pgTAP-output-worker',
  lease_token='48000000-0000-4000-8000-000000000003',
  lease_expires_at=now()+interval '10 minutes',updated_at=now()
where lease_key='production-heavy' and stage_id is null;
update public.designpro_workflow_stages
set status='running',lease_owner='pgTAP-output-worker',
  lease_token='48000000-0000-4000-8000-000000000003',
  lease_expires_at=now()+interval '10 minutes',started_at=now()
where id='46000000-0000-4000-8000-000000000003';

create temporary table production_output_files on commit drop as
select jsonb_build_object(
  'surfaceKey',p->>'surfaceKey','format',format,
  'contentHash',pg_temp.handoff_hash('late-bound-output-'||(p->>'surfaceKey')||'-'||format),
  'byteSize',456,
  'storagePath','designpro/'||r.tenant_key||'/'||r.id::text
    ||'/output/'||(p->>'surfaceKey')||'.'||format,
  'dpi',1500,'outputScale',0.1,'fullScaleBleedInches',5,'colorSpace','sRGB',
  'widthPixels',(p->>'printWidthIn')::integer*150,
  'heightPixels',(p->>'printHeightIn')::integer*150
) file
from public.designpro_workflow_runs r,production_panels,
  lateral jsonb_array_elements(panels) p,
  unnest(ARRAY['png','tiff','eps']) format
where r.id='44000000-0000-4000-8000-000000000005';
insert into public.designpro_artifacts(
  run_id,stage_id,artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata
)
select '44000000-0000-4000-8000-000000000005',
  '46000000-0000-4000-8000-000000000003','output',file->>'surfaceKey',
  file->>'storagePath',file->>'contentHash',(file->>'byteSize')::bigint,
  jsonb_build_object('format',file->>'format','width',file->'widthPixels',
    'height',file->'heightPixels','dpi',1500,'outputScale',0.1,'fullScaleBleedInches',5)
from production_output_files;

create temporary table production_output on commit drop as
select jsonb_build_object(
  'verified',true,'receiptKind','output.verified',
  'contract','designpro.output-verification.v1',
  'authorizedAssetManifest',(select output->'authorizedAssetManifest'
    from public.designpro_workflow_stages
    where id='46000000-0000-4000-8000-000000000001'),
  'exactSurfaceSet',jsonb_build_array('driver','passenger','hood','roof','front','rear'),
  'exactFormatSet',jsonb_build_array('png','tiff','eps'),
  'fileCount',18,'fullScalePixelsPerInch',150,'fileDpi',1500,
  'outputScale',0.1,'fullScaleBleedInchesPerEdge',5,
  'files',(select jsonb_agg(file order by file->>'surfaceKey',file->>'format')
    from production_output_files),
  'outputHashes',(select jsonb_agg(file->>'contentHash'
    order by file->>'surfaceKey',file->>'format') from production_output_files),
  'proofJoin',jsonb_build_object(
    'contract','designpro.production-proof-join.v1',
    'call8ReceiptHash',c.call8->>'receiptHash',
    'call8ProofHash',c.call8#>>'{receipt,sourceProofHash}',
    'manifestHash',r.manifest_hash,'sourceViews',v.views,
    'sourceViewSetHash',pg_temp.handoff_json_hash(v.views),'sevenViewsVerified',true,
    'viewBinding',jsonb_build_object('contract','designpro.frozen-proof-join.v1',
      'sourceReceiptHash',pg_temp.handoff_json_hash(f.receipt))
  )
) receipt
from public.designpro_workflow_runs r,production_call8 c,
  production_views v,production_frozen_views f
where r.id='44000000-0000-4000-8000-000000000005';

select ok(public.complete_designpro_stage(
  '46000000-0000-4000-8000-000000000003',
  '48000000-0000-4000-8000-000000000003',
  (select identity from production_identity),(select receipt from production_output),
  (select pg_temp.handoff_json_hash(receipt) from production_output),'[]'::jsonb
), 'output verification joins the exact GENIE Call 8, seven frozen proofs and 18 files');

select throws_ok(
  $$select public.approve_designpro_human_gate(
    '44000000-0000-4000-8000-000000000005',
    'await_final_human_qc',
    '11000000-0000-4000-8000-000000000001',
    'LATE-BOUND-FINAL-QC-WRONG',
    '{"known":true,"pass":true,"outputHashesVerified":true,"printDimensionsVerified":true,"colorModeVerified":true,"designId":"DID-42000000","orderNumber":"WRONG-ORDER"}'::jsonb
  )$$,
  'P0001','final_qc_evidence_or_business_identity_incomplete',
  'final QC refuses an Order # other than the frozen late binding'
);
select public.approve_designpro_human_gate(
  '44000000-0000-4000-8000-000000000005',
  'await_final_human_qc',
  '11000000-0000-4000-8000-000000000001',
  'LATE-BOUND-FINAL-QC-PASS',
  '{"known":true,"pass":true,"outputHashesVerified":true,"printDimensionsVerified":true,"colorModeVerified":true,"designId":"DID-42000000","orderNumber":"FP-2026-0001"}'::jsonb
);
select is(
  (select status from public.designpro_workflow_stages
   where id='46000000-0000-4000-8000-000000000004'),
  'completed',
  'final QC completes from the exact frozen late-fulfillment binding'
);
select is(
  (select receipt#>>'{qc,orderNumber}'
   from public.designpro_stage_receipts
   where stage_id='46000000-0000-4000-8000-000000000004'),
  'FP-2026-0001',
  'the final QC receipt freezes the late-bound Order #'
);
select ok(
  (select snapshot#>>'{fulfillment,state}'='unbound'
     AND NOT (snapshot ?| ARRAY['orderNumber','delivery'])
     AND snapshot_hash=pg_temp.handoff_hash(snapshot::text)
   from public.designpro_revision_sources
   where revision_id='43000000-0000-4000-8000-000000000005'),
  'final QC never rewrites the immutable design-first snapshot'
);

-- The seal, stamped Call 8 and QC certificate retain the original business
-- identity checks. Each of the seven production proofs now also needs its own
-- stamp, bound to the exact approved source path/hash and the same reviewer.
create temporary table production_stamp on commit drop as
with approval as (
  select receipt from public.designpro_stage_receipts
  where run_id='44000000-0000-4000-8000-000000000005'
    and receipt_kind='final.human-qc'
), stamp_views as (
  select jsonb_agg(jsonb_build_object(
    'viewKey',v->>'viewKey','contentHash',pg_temp.handoff_hash('late-bound-stamped-'||(v->>'viewKey')),
    'storagePath','designpro/user_11000000-0000-4000-8000-000000000001/'
      ||'44000000-0000-4000-8000-000000000005/proof/stamped-view-'||(v->>'viewKey')
      ||'-'||left(v->>'contentHash',24)||'.png',
    'byteSize',987,'sourceProofHash',v->>'contentHash','sourceProofPath',v->>'storagePath'
  ) order by v->>'viewKey') views
  from production_views,lateral jsonb_array_elements(views) v
)
select jsonb_build_object(
  'verified',true,'receiptKind','stamp','designId','DID-42000000',
  'orderNumber','FP-2026-0001','verifiedBy',a.receipt->>'verifiedBy',
  'approvalRef',a.receipt->>'approvalRef','approvedAt',a.receipt->>'approvedAt',
  'stampHash',pg_temp.handoff_hash('late-bound-stamped-call8'),
  'sealHash',pg_temp.handoff_hash('late-bound-seal'),
  'certificateHash',pg_temp.handoff_hash('late-bound-certificate'),
  'sourceProofHash',o.receipt#>>'{proofJoin,call8ProofHash}',
  'proofJoin',o.receipt->'proofJoin','stampedViews',s.views
) receipt
from approval a,production_output o,stamp_views s;

create temporary table production_stamp_artifacts on commit drop as
with base as (
  select receipt,jsonb_build_object(
    'designId',receipt->>'designId','orderNumber',receipt->>'orderNumber',
    'verifiedBy',receipt->>'verifiedBy','approvalRef',receipt->>'approvalRef',
    'approvedAt',receipt->>'approvedAt'
  ) metadata from production_stamp
), artifacts as (
  select jsonb_build_object(
    'kind','stamp','surfaceKey',surface_key,
    'storagePath','designpro/user_11000000-0000-4000-8000-000000000001/'
      ||'44000000-0000-4000-8000-000000000005/proof/'||surface_key||'.png',
    'contentHash',receipt->>hash_key,'byteSize',999,
    'metadata',metadata||case when surface_key='stamped-proof'
      then jsonb_build_object('sourceProofHash',receipt->>'sourceProofHash')
      else '{}'::jsonb end
  ) artifact
  from base,(values ('seal','sealHash'),('stamped-proof','stampHash'),
    ('certificate','certificateHash')) s(surface_key,hash_key)
  union all
  select jsonb_build_object(
    'kind','stamp','surfaceKey','stamped-view-'||(v->>'viewKey'),
    'storagePath',v->>'storagePath','contentHash',v->>'contentHash','byteSize',v->'byteSize',
    'metadata',metadata||jsonb_build_object(
      'sourceViewKey',v->>'viewKey','sourceProofHash',v->>'sourceProofHash',
      'sourceProofPath',v->>'sourceProofPath','sealHash',receipt->>'sealHash',
      'sourceViewSetHash',receipt#>>'{proofJoin,sourceViewSetHash}')
  ) artifact
  from base,lateral jsonb_array_elements(receipt->'stampedViews') v
)
select jsonb_agg(artifact order by artifact->>'surfaceKey') artifacts from artifacts;

update public.designpro_workflow_stages
set status='running',lease_owner='pgTAP-stamp-worker',
  lease_token='48000000-0000-4000-8000-000000000005',
  lease_expires_at=now()+interval '10 minutes',started_at=now()
where id='46000000-0000-4000-8000-000000000005';
update public.designpro_workflow_runs set status='running'
where id='44000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.complete_designpro_stage(
    '46000000-0000-4000-8000-000000000005',
    '48000000-0000-4000-8000-000000000005',
    (select identity from production_identity),(select receipt from production_stamp),
    (select receipt->>'stampHash' from production_stamp),
    (select jsonb_agg(a) from production_stamp_artifacts,
      lateral jsonb_array_elements(artifacts) a where a->>'surfaceKey'<>'certificate')
  )$$,
  'P0001','exact_stamp_artifact_set_required',
  'stamp completion refuses a seal and proof without its QC certificate'
);
select throws_ok(
  $$select public.complete_designpro_stage(
    '46000000-0000-4000-8000-000000000005',
    '48000000-0000-4000-8000-000000000005',
    (select identity from production_identity),(select receipt from production_stamp),
    (select receipt->>'stampHash' from production_stamp),
    (select jsonb_agg(a) from production_stamp_artifacts,
      lateral jsonb_array_elements(artifacts) a where a->>'surfaceKey' not like 'stamped-view-%')
  )$$,
  'P0001','production_seven_stamped_views_required',
  'the three QC artifacts cannot replace the seven stamped source proofs'
);
select ok(public.complete_designpro_stage(
  '46000000-0000-4000-8000-000000000005',
  '48000000-0000-4000-8000-000000000005',
  (select identity from production_identity),(select receipt from production_stamp),
  (select receipt->>'stampHash' from production_stamp),
  (select artifacts from production_stamp_artifacts)
), 'stamp completion accepts the exact ten artifacts with their late-bound business identity');
select is(
  (select count(*)::integer from public.designpro_artifacts
   where run_id='44000000-0000-4000-8000-000000000005'
     and artifact_kind='stamp'),10,
  'all ten stamp artifacts are persisted'
);
select is(
  (select receipt->>'certificateHash' from public.designpro_stage_receipts
   where run_id='44000000-0000-4000-8000-000000000005'
     and receipt_kind='stamp'),pg_temp.handoff_hash('late-bound-certificate'),
  'the persisted stamp receipt binds the certificate hash'
);
select ok(
  (select snapshot#>>'{fulfillment,state}'='unbound'
     AND NOT (snapshot ?| ARRAY['orderNumber','delivery'])
     AND snapshot_hash=pg_temp.handoff_hash(snapshot::text)
   from public.designpro_revision_sources
   where revision_id='43000000-0000-4000-8000-000000000005'),
  'stamp completion never rewrites the immutable design-first snapshot'
);

select * from finish();
rollback;
