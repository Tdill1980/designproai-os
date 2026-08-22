begin;
select plan(31);

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
select is(
  (select count(*)::integer from public.designpro_workflow_stages s
   join public.designpro_workflow_runs r on r.id=s.run_id
   where r.revision_id='33000000-0000-4000-8000-000000000003'
     and r.workflow_type='designpro.entice_pack'),8,
  'the existing revision-to-Call-11 stage list is intact'
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
   where r.id=(select (payload->>'workflowRunId')::uuid from replay_handoff)),8,
  'repaired workflow receives the complete existing Calls 8-11 schedule'
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

select * from finish();
rollback;
