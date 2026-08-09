begin;
select plan(47);

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
select has_function('public','get_designpro_generation_request',
  ARRAY['uuid'],'owner-safe status RPC exists');

select ok(has_function_privilege('authenticated',
  'public.create_designpro_generation_request(uuid,jsonb,text)','EXECUTE'),
  'authenticated users may call the guarded enqueue RPC');
select ok(has_function_privilege('authenticated',
  'public.get_designpro_generation_request(uuid)','EXECUTE'),
  'authenticated users may call the owner-safe status RPC');
select ok(not has_function_privilege('authenticated',
  'public.claim_designpro_generation_request(text,integer)','EXECUTE'),
  'authenticated browsers cannot claim generation work');
select ok(not has_function_privilege('authenticated',
  'public.complete_designpro_generation_request(uuid,uuid,jsonb,jsonb)','EXECUTE'),
  'authenticated browsers cannot complete generation work');
select ok(not has_function_privilege('anon',
  'public.create_designpro_generation_request(uuid,jsonb,text)','EXECUTE'),
  'anonymous callers cannot enqueue generation work');
select ok(not has_table_privilege('authenticated',
  'public.designpro_generation_requests','SELECT'),
  'authenticated users cannot read internal queue columns directly');
select ok(not has_table_privilege('authenticated',
  'public.designpro_generation_views','SELECT'),
  'authenticated users cannot read private storage paths directly');
select ok(not has_table_privilege('authenticated',
  'public.designpro_generation_requests','INSERT'),
  'authenticated browsers cannot insert queue rows directly');
select ok(not has_table_privilege('anon',
  'public.designpro_generation_requests','SELECT'),
  'anonymous callers cannot read generation state');
select policies_are('public','designpro_generation_requests',
  ARRAY['designpro_owner_read_generation_requests'],
  'request queue retains its owner-only defense-in-depth policy');
select policies_are('public','designpro_generation_views',
  ARRAY['designpro_owner_read_generation_views'],
  'view ledger retains its owner-only defense-in-depth policy');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '10000000-0000-4000-8000-000000000001','authenticated','authenticated',
   'calls17-owner@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000',
   '20000000-0000-4000-8000-000000000002','authenticated','authenticated',
   'calls17-other@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000',
   '30000000-0000-4000-8000-000000000003','authenticated','authenticated',
   'calls17-customer@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now())
on conflict(id) do nothing;

insert into public.designpro_qc_members(user_id,can_operate)
values('10000000-0000-4000-8000-000000000001',true)
on conflict(user_id) do update set can_operate=excluded.can_operate;

insert into designpro_private.business_customer_bindings(
  customer_id,customer_auth_user_id,customer_email,customer_reference,
  customer_reference_key,created_by_operator,email_verified_at
) values(
  '40000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000003',
  'calls17-customer@designproai.test','DP-CUSTOMER-9001','dp-customer-9001',
  '10000000-0000-4000-8000-000000000001',now()
);

insert into designpro_private.wrapbox_delivery_recipients(
  recipient_identity_hash,customer_id,customer_auth_user_id,customer_email,
  verification_ref_hash,order_number,email_verified_at
) values(
  repeat('c',64),'40000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000003',
  'calls17-customer@designproai.test',repeat('d',64),'DP-9001',now()
);

create temporary table calls17_fixture as
select jsonb_build_object(
  'contractVersion','designpro.calls-1-7-input.v1',
  'orderNumber','DP-9001',
  'delivery',jsonb_build_object(
    'contractVersion','designpro.wrapbox-recipient.v1',
    'recipientIdentityHash',repeat('c',64),
    'orderNumber','DP-9001'
  ),
  'vehicle',jsonb_build_object(
    'year','2026','make','Porsche','model','911','type','car'
  ),
  'designBrief',jsonb_build_object('campaign','Martini heritage')
) payload,
  'calls17:90000000-0000-4000-8000-000000000009:'||repeat('c',64)
    ||':9ec9104d205f79c98d26fe8cde8f17dd23afb4411caf2bfc209dafc5e54c8147'
    idempotency_key;
grant select on calls17_fixture to authenticated;

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001","is_anonymous":true}',
  true);
select throws_ok(
  $$select public.create_designpro_generation_request(
    '90000000-0000-4000-8000-000000000009',
    (select payload from calls17_fixture),
    (select idempotency_key from calls17_fixture))$$,
  'P0001','authentication_required',
  'Supabase anonymous Auth users cannot enqueue');

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"20000000-0000-4000-8000-000000000002","is_anonymous":false}',
  true);
select throws_ok(
  $$select public.create_designpro_generation_request(
    '90000000-0000-4000-8000-000000000009',
    (select payload from calls17_fixture),
    (select idempotency_key from calls17_fixture))$$,
  'P0001','confirmed_operator_order_binding_required',
  'a permanent Auth user without the confirmed operator/order binding cannot enqueue');

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);
select is(
  public.create_designpro_generation_request(
    '90000000-0000-4000-8000-000000000009',
    (select payload from calls17_fixture),
    (select idempotency_key from calls17_fixture)
  )->>'state','queued',
  'a confirmed operator with an exact registered order identity can enqueue');
select is(
  (public.create_designpro_generation_request(
    '90000000-0000-4000-8000-000000000009',
    (select payload from calls17_fixture),
    (select idempotency_key from calls17_fixture)
  )->>'idempotent')::boolean,true,
  'the exact same immutable request replays idempotently before the active cap');

select is(
  (select engine_contract->>'sourceCommit'
   from public.designpro_generation_requests
   where generation_id='90000000-0000-4000-8000-000000000009'),
  'bdb26365904e91be446894e84b01b4a24f64aac0',
  'request freezes the reviewed source commit');

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);
select throws_ok(
  $$select public.create_designpro_generation_request(
    '91000000-0000-4000-8000-000000000009',
    jsonb_set((select payload from calls17_fixture),'{vehicle,type}','"spaceship"'),
    replace((select idempotency_key from calls17_fixture),
      '90000000-0000-4000-8000-000000000009',
      '91000000-0000-4000-8000-000000000009'))$$,
  'P0001','generation_request_invalid',
  'the direct RPC rejects a vehicle class outside the exact allowlist');
select throws_ok(
  $$select public.create_designpro_generation_request(
    '91500000-0000-4000-8000-000000000009',
    jsonb_set((select payload from calls17_fixture),
      '{delivery,orderNumber}','"DP-9002"'),
    replace((select idempotency_key from calls17_fixture),
      '90000000-0000-4000-8000-000000000009',
      '91500000-0000-4000-8000-000000000009'))$$,
  'P0001','generation_request_invalid',
  'a missing or changed delivery/order equality fails at contract validation');
select throws_ok(
  $$select public.create_designpro_generation_request(
    '91600000-0000-4000-8000-000000000009',
    (select payload - 'orderNumber' from calls17_fixture),
    replace((select idempotency_key from calls17_fixture),
      '90000000-0000-4000-8000-000000000009',
      '91600000-0000-4000-8000-000000000009'))$$,
  'P0001','generation_request_invalid',
  'a missing top-level order fails deterministically at contract validation');
select throws_ok(
  $$select public.create_designpro_generation_request(
    '91700000-0000-4000-8000-000000000009',
    jsonb_set((select payload from calls17_fixture),
      '{delivery,recipientIdentityHash}','null'::jsonb),
    replace((select idempotency_key from calls17_fixture),
      '90000000-0000-4000-8000-000000000009',
      '91700000-0000-4000-8000-000000000009'))$$,
  'P0001','generation_request_invalid',
  'a null recipient hash fails deterministically at contract validation');
select throws_ok(
  $$select public.create_designpro_generation_request(
    '92000000-0000-4000-8000-000000000009',
    (select payload from calls17_fixture),
    replace((select idempotency_key from calls17_fixture),
      '90000000-0000-4000-8000-000000000009',
      '92000000-0000-4000-8000-000000000009'))$$,
  'P0001','generation_active_request_limit',
  'one nonterminal request per owner is enforced inside the database');
select throws_ok(
  $$select public.claim_designpro_generation_request('browser',900)$$,
  'P0001','service_role_required',
  'an authenticated JWT cannot claim the queue even through direct SQL');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table calls17_claim as
select public.claim_designpro_generation_request('calls17-worker',900) payload;

select is(
  (select payload->>'generationId' from calls17_claim),
  '90000000-0000-4000-8000-000000000009',
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
  where r.generation_id='90000000-0000-4000-8000-000000000009'
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
select cmp_ok((select count(*) from public.designpro_generation_views),'=',7::bigint,
  'completion stores exactly seven distinct view identities');
select is(
  (select consumer_role from public.designpro_generation_views
   where source_view_type='close-up'),'closeup',
  'source close-up remains the explicit closeup role');
select cmp_ok(
  (select count(*) from public.designpro_generation_views
   where consumer_role='hero3d'),'=',0::bigint,
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

select set_config('test.calls17_request_id',(
  select id::text from public.designpro_generation_requests
  where generation_id='90000000-0000-4000-8000-000000000009'
),true);
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);
select is(
  public.get_designpro_generation_request(
    current_setting('test.calls17_request_id')::uuid
  )->>'generationId',
  '90000000-0000-4000-8000-000000000009',
  'owner-safe status RPC returns only the caller request');
select is(jsonb_array_length(public.get_designpro_generation_request(
    current_setting('test.calls17_request_id')::uuid
  )->'views'),7,
  'owner-safe status RPC returns the seven public byte identities');
select ok(
  NOT public.get_designpro_generation_request(
    current_setting('test.calls17_request_id')::uuid
  ) ?| ARRAY['leaseToken','leaseOwner','engineReceipt','error','storagePath']
  AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(public.get_designpro_generation_request(
      current_setting('test.calls17_request_id')::uuid
    )->'views') item WHERE item ? 'storagePath'
  ),
  'status projection omits worker, receipt, raw error, and storage identities');
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"20000000-0000-4000-8000-000000000002","is_anonymous":false}',
  true);
select ok(public.get_designpro_generation_request(
    current_setting('test.calls17_request_id')::uuid
  ) IS NULL,
  'another authenticated user cannot read the owner status');

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);
select is(
  public.create_designpro_generation_request(
    '93000000-0000-4000-8000-000000000009',
    (select payload from calls17_fixture),
    replace((select idempotency_key from calls17_fixture),
      '90000000-0000-4000-8000-000000000009',
      '93000000-0000-4000-8000-000000000009')
  )->>'state','queued',
  'the cap releases after the first request becomes terminal');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table calls17_failed_claim as
select public.claim_designpro_generation_request('calls17-worker',900) payload;
select ok(public.fail_designpro_generation_request(
  (select (payload->>'requestId')::uuid from calls17_failed_claim),
  (select (payload->>'claimToken')::uuid from calls17_failed_claim),
  'engine_busy','private provider detail',false
), 'service failure remains fenced by the lease identity');
select set_config('test.calls17_failed_request_id',(
  select id::text from public.designpro_generation_requests
  where generation_id='93000000-0000-4000-8000-000000000009'
),true);

select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);
select is(public.get_designpro_generation_request(
    current_setting('test.calls17_failed_request_id')::uuid
  )->>'failureCode','engine_busy',
  'status exposes only the sanitized public failure code');
select ok(
  NOT public.get_designpro_generation_request(
    current_setting('test.calls17_failed_request_id')::uuid
  ) ?| ARRAY['message','error','errorMessage'],
  'status never exposes the private provider failure message');

select * from finish();
rollback;
