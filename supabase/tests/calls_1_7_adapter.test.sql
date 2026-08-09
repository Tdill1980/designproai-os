begin;
select plan(32);

select has_table('public','designpro_generation_requests',
  'isolated Calls 1-7 request queue exists');
select has_table('public','designpro_generation_views',
  'immutable Calls 1-7 view ledger exists');
select has_function('public','create_designpro_generation_request',
  ARRAY['uuid','jsonb','text'],'authenticated enqueue RPC exists');
select has_function('public','claim_designpro_generation_request',
  ARRAY['text','integer'],'service claimant RPC exists');
select has_function('public','heartbeat_designpro_generation_request',
  ARRAY['uuid','uuid','integer'],'generation lease heartbeat RPC exists');
select has_function('public','complete_designpro_generation_request',
  ARRAY['uuid','uuid','jsonb','jsonb'],'byte-identity completion RPC exists');
select has_function('public','fail_designpro_generation_request',
  ARRAY['uuid','uuid','text','text','boolean'],'fenced failure RPC exists');

select ok(has_function_privilege('authenticated',
  'public.create_designpro_generation_request(uuid,jsonb,text)','EXECUTE'),
  'authenticated users may enqueue their own request');
select ok(not has_function_privilege('authenticated',
  'public.claim_designpro_generation_request(text,integer)','EXECUTE'),
  'authenticated browsers cannot claim generation work');
select ok(not has_function_privilege('authenticated',
  'public.complete_designpro_generation_request(uuid,uuid,jsonb,jsonb)','EXECUTE'),
  'authenticated browsers cannot complete generation work');
select ok(not has_function_privilege('anon',
  'public.create_designpro_generation_request(uuid,jsonb,text)','EXECUTE'),
  'anonymous callers cannot enqueue generation work');
select ok(has_table_privilege('authenticated',
  'public.designpro_generation_requests','SELECT'),
  'authenticated owners may read request state through RLS');
select ok(not has_table_privilege('authenticated',
  'public.designpro_generation_requests','INSERT'),
  'authenticated browsers cannot insert queue rows directly');
select ok(not has_table_privilege('anon',
  'public.designpro_generation_requests','SELECT'),
  'anonymous callers cannot read generation state');
select policies_are('public','designpro_generation_requests',
  ARRAY['designpro_owner_read_generation_requests'],
  'request queue exposes only its owner read policy');
select policies_are('public','designpro_generation_views',
  ARRAY['designpro_owner_read_generation_views'],
  'view identities expose only their owner read policy');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '10000000-0000-4000-8000-000000000001','authenticated','authenticated',
   'calls17-owner@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000',
   '20000000-0000-4000-8000-000000000002','authenticated','authenticated',
   'calls17-other@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now())
on conflict(id) do nothing;

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001"}',
  true);

create temporary table calls17_request as
select public.create_designpro_generation_request(
  '90000000-0000-4000-8000-000000000009',
  jsonb_build_object(
    'contractVersion','designpro.calls-1-7-input.v1',
    'vehicle',jsonb_build_object(
      'year','2026','make','Porsche','model','911','type','car'
    ),
    'designBrief',jsonb_build_object('campaign','Martini heritage')
  ),
  'calls17:90000000-0000-4000-8000-000000000009'
) payload;

select is((select payload->>'state' from calls17_request),'queued',
  'authenticated enqueue creates one queued request');
select is(
  (select engine_contract->>'sourceCommit'
   from public.designpro_generation_requests
   where generation_id='90000000-0000-4000-8000-000000000009'),
  'bdb26365904e91be446894e84b01b4a24f64aac0',
  'request freezes the reviewed source commit');
select is(
  (public.create_designpro_generation_request(
    '90000000-0000-4000-8000-000000000009',
    jsonb_build_object(
      'contractVersion','designpro.calls-1-7-input.v1',
      'vehicle',jsonb_build_object(
        'year','2026','make','Porsche','model','911','type','car'
      ),
      'designBrief',jsonb_build_object('campaign','Martini heritage')
    ),
    'calls17:90000000-0000-4000-8000-000000000009'
  )->>'idempotent')::boolean,
  true,'same immutable request is idempotent');
select throws_ok(
  $$select public.create_designpro_generation_request(
    '91000000-0000-4000-8000-000000000009',
    jsonb_build_object(
      'contractVersion','designpro.calls-1-7-input.v1',
      'vehicle',jsonb_build_object(
        'year','2026','make','Porsche','model','911','type','car'
      ),
      'nested',jsonb_build_object('image_model','browser-selected')
    ),'calls17:override')$$,
  'P0001','generation_request_invalid',
  'nested browser model controls are rejected recursively');
select throws_ok(
  $$select public.claim_designpro_generation_request('browser',900)$$,
  'P0001','service_role_required',
  'an authenticated JWT cannot claim the queue even through direct SQL');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table calls17_claim as
select public.claim_designpro_generation_request('calls17-worker',900) payload;

select is(
  (select payload->>'requestId' from calls17_claim),
  (select payload->>'requestId' from calls17_request),
  'service claimant receives the exact queued request');
select is(
  jsonb_array_length((select payload->'viewPlan' from calls17_claim)),7,
  'claim carries exactly seven frozen source view roles');

create temporary table calls17_complete as
with plan(source_view_type,consumer_role,ordinal) as (
  values ('side','driver',1),('passenger-side','passenger',2),
    ('hood_detail','hood',3),('front','front',4),('rear','rear',5),
    ('close-up','closeup',6),('roof','roof',7)
), identities as (
  select source_view_type,consumer_role,ordinal,
    lpad(to_hex(ordinal),64,'0') content_hash
  from plan
), output as (
  select jsonb_agg(jsonb_build_object(
    'sourceViewType',source_view_type,
    'consumerRole',consumer_role,
    'storagePath','designpro/user_10000000-0000-4000-8000-000000000001/'
      ||'90000000-0000-4000-8000-000000000009/calls-1-7/'
      ||source_view_type||'/'||content_hash||'.png',
    'contentHash',content_hash,'byteSize',1000+ordinal,
    'contentType','image/png','metadata',jsonb_build_object('ordinal',ordinal)
  ) order by ordinal) views
  from identities
), receipt as (
  select jsonb_build_object(
    'contractVersion','designpro.calls-1-7-receipt.v1',
    'sourceCommit','bdb26365904e91be446894e84b01b4a24f64aac0',
    'frozenContractHash',r.engine_contract_hash,
    'inputHash',r.input_hash,'byteVerified',true,'callsCompleted',7
  ) value
  from public.designpro_generation_requests r
  where r.id=(select (payload->>'requestId')::uuid from calls17_claim)
)
select public.complete_designpro_generation_request(
  (select (payload->>'requestId')::uuid from calls17_claim),
  (select (payload->>'claimToken')::uuid from calls17_claim),
  output.views,receipt.value
) payload
from output cross join receipt;

select is((select payload->>'state' from calls17_complete),'outputs_ready',
  'seven byte identities complete only to outputs_ready');
select is((select payload->>'handoffBlocker' from calls17_complete),
  'source_close_up_has_no_verified_hero3d_role_mapping',
  'automatic Calls 8 handoff remains explicitly blocked');
select is(
  (select count(*)::integer from public.designpro_generation_views),7,
  'completion stores exactly seven distinct view identities');
select is(
  (select consumer_role from public.designpro_generation_views
   where source_view_type='close-up'),'closeup',
  'source close-up remains the explicit closeup role');
select is(
  (select count(*)::integer from public.designpro_generation_views
   where consumer_role='hero3d'),0,
  'no source view is silently relabeled hero3d');
select throws_ok(
  $$select public.complete_designpro_generation_request(
    (select (payload->>'requestId')::uuid from calls17_claim),
    (select (payload->>'claimToken')::uuid from calls17_claim),
    '[]'::jsonb,'{}'::jsonb)$$,
  'P0001','generation_lease_lost',
  'a consumed completion lease cannot be replayed');
select ok(not public.heartbeat_designpro_generation_request(
  (select (payload->>'requestId')::uuid from calls17_claim),
  (select (payload->>'claimToken')::uuid from calls17_claim),900),
  'a consumed lease cannot be revived by heartbeat');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001"}',
  true);
select is((select count(*) from public.designpro_generation_requests),1::bigint,
  'RLS lets the owner read the request');
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"20000000-0000-4000-8000-000000000002"}',
  true);
select is((select count(*) from public.designpro_generation_requests),0::bigint,
  'RLS hides the request from another authenticated user');
reset role;

select * from finish();
rollback;
