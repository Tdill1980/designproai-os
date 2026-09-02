-- GENIE PREP — the early lifecycle (owner ruling, Trish 2026-09-02).
-- Idempotent request on (generation, vehicle identity, contract); owner
-- conflict; supersede on a changed vehicle; claim lease / attempt cap;
-- complete and fail fenced by the lease; consume once; owner-only SELECT.
begin;
select plan(35);

select has_table('public','designpro_genie_preps','GENIE prep rows exist');
select has_function('public','request_designpro_genie_prep',
  ARRAY['uuid','uuid','jsonb','text','text','timestamptz'],'request RPC exists');
select has_function('public','claim_designpro_genie_prep',
  ARRAY['text','integer','uuid'],'claim RPC exists');
select has_function('public','complete_designpro_genie_prep',
  ARRAY['uuid','uuid','jsonb','text','text','boolean','integer'],'complete RPC exists');
select has_function('public','fail_designpro_genie_prep',
  ARRAY['uuid','uuid','text','text','boolean'],'fail RPC exists');
select has_function('public','read_designpro_genie_prep',
  ARRAY['uuid','uuid','text','text'],'worker read RPC exists');
select has_function('public','consume_designpro_genie_prep',
  ARRAY['uuid','uuid'],'consume RPC exists');
select ok(not has_function_privilege('authenticated',
  'public.request_designpro_genie_prep(uuid,uuid,jsonb,text,text,timestamptz)','EXECUTE'),
  'browsers cannot request a prep directly (the gateway binds the owner)');
select ok(not has_function_privilege('authenticated',
  'public.claim_designpro_genie_prep(text,integer,uuid)','EXECUTE'),
  'browsers cannot claim prep work');
select ok(not has_function_privilege('authenticated',
  'public.read_designpro_genie_prep(uuid,uuid,text,text)','EXECUTE'),
  'browsers cannot read prepared geometry through the worker RPC');
select ok(has_function_privilege('service_role',
  'public.claim_designpro_genie_prep(text,integer,uuid)','EXECUTE'),
  'the service runtime may claim prep work');
select ok(has_table_privilege('authenticated','public.designpro_genie_preps','SELECT'),
  'owners may read prep status');
select ok(not has_table_privilege('authenticated','public.designpro_genie_preps','INSERT'),
  'browsers cannot insert prep rows');
select policies_are('public','designpro_genie_preps',
  ARRAY['designpro_owner_read_genie_preps'],'owner-only read policy');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '10000000-0000-4000-8000-000000000001','authenticated','authenticated',
   'prep-owner@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000',
   '20000000-0000-4000-8000-000000000002','authenticated','authenticated',
   'prep-other@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now())
on conflict(id) do nothing;

-- request: first call creates, second is idempotent
select is(
  (public.request_designpro_genie_prep(
    '10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000009',
    '{"year":"2022","make":"Ford","model":"F250 Crew Cab","type":"truck"}'::jsonb,
    repeat('a',64),'designpro.genie-prep.v1+designpro.genie-manifest.v1',
    '2026-09-02T16:59:59Z'::timestamptz))->>'status','queued',
  'a new prep is queued');
select is(
  (public.request_designpro_genie_prep(
    '10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000009',
    '{"year":"2022","make":"Ford","model":"F250 Crew Cab","type":"truck"}'::jsonb,
    repeat('a',64),'designpro.genie-prep.v1+designpro.genie-manifest.v1',NULL))->>'idempotent','true',
  'a retry for the same triple returns the existing row');
select is((select count(*) from public.designpro_genie_preps
  where generation_id='90000000-0000-4000-8000-000000000009')::int,1,
  'no duplicate row on retry');
select throws_ok(
  $$select public.request_designpro_genie_prep(
    '20000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000009',
    '{"year":"2022","make":"Ford","model":"F250 Crew Cab","type":"truck"}'::jsonb,
    repeat('a',64),'designpro.genie-prep.v1+designpro.genie-manifest.v1',NULL)$$,
  'P0001','genie_prep_owner_conflict',
  'a GenerationID belongs to one owner');

-- claim by id, complete fenced by the lease
create temporary table prep_fixture as
select id as prep_id from public.designpro_genie_preps
where generation_id='90000000-0000-4000-8000-000000000009';
select is(
  (public.claim_designpro_genie_prep('worker-1',180,(select prep_id from prep_fixture)))->>'status','resolving',
  'the acknowledging request claims its own row');
select is((select attempt from public.designpro_genie_preps where id=(select prep_id from prep_fixture)),1,
  'claim counts an attempt');
select is(public.claim_designpro_genie_prep('worker-2',180,NULL),NULL,
  'a leased row is not reclaimable while its lease is live');
select throws_ok(
  $$select public.complete_designpro_genie_prep(
    (select prep_id from prep_fixture),'00000000-0000-4000-8000-00000000dead',
    '{"geometryResolution":{"genieManifestHash":"'||repeat('1',64)||'"}}'::jsonb,
    repeat('1',64),'measured',true,812)$$,
  'P0001','genie_prep_lease_stale',
  'a stale lease cannot complete a prep');
select is(
  (public.complete_designpro_genie_prep(
    (select prep_id from prep_fixture),
    (select lease_token from public.designpro_genie_preps where id=(select prep_id from prep_fixture)),
    '{"geometryResolution":{"genieManifestHash":"'||repeat('1',64)||'","state":"measured"}}'::jsonb,
    repeat('1',64),'measured',true,812))->>'status','ready',
  'the lease holder completes the prep');
select ok((select prepared_at is not null and duration_ms=812 and lease_token is null
  from public.designpro_genie_preps where id=(select prep_id from prep_fixture)),
  'ready carries prepared_at and duration, and releases the lease');

-- worker read: exact triple + owner, or null
select is(
  (public.read_designpro_genie_prep(
    '10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000009',
    repeat('a',64),'designpro.genie-prep.v1+designpro.genie-manifest.v1'))->>'status','ready',
  'the worker reads the READY prep for the exact triple');
select is(public.read_designpro_genie_prep(
    '10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000009',
    repeat('b',64),'designpro.genie-prep.v1+designpro.genie-manifest.v1'),NULL,
  'a changed vehicle identity reads nothing (inline fallback)');
select is(public.read_designpro_genie_prep(
    '10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000009',
    repeat('a',64),'designpro.genie-prep.v0+designpro.genie-manifest.v0'),NULL,
  'an older GENIE contract reads nothing (inline fallback)');
select is(public.read_designpro_genie_prep(
    '20000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000009',
    repeat('a',64),'designpro.genie-prep.v1+designpro.genie-manifest.v1'),NULL,
  'another owner reads nothing');

-- consume once
select is(
  (public.consume_designpro_genie_prep((select prep_id from prep_fixture),
    '91000000-0000-4000-8000-000000000001'))->>'consumedByRequestId','91000000-0000-4000-8000-000000000001',
  'the generation request that used the prep is recorded');
select is(
  (public.consume_designpro_genie_prep((select prep_id from prep_fixture),
    '91000000-0000-4000-8000-000000000002'))->>'consumedByRequestId','91000000-0000-4000-8000-000000000001',
  'consume is idempotent: the first request stays recorded');

-- a changed vehicle for the same generation supersedes the older prep
select is(
  (public.request_designpro_genie_prep(
    '10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000009',
    '{"year":"2022","make":"Ford","model":"F350 Crew Cab","type":"truck"}'::jsonb,
    repeat('c',64),'designpro.genie-prep.v1+designpro.genie-manifest.v1',NULL))->>'status','queued',
  'a new vehicle identity gets its own queued prep');
select is((select status from public.designpro_genie_preps where id=(select prep_id from prep_fixture)),'superseded',
  'the older vehicle prep is superseded, never consumed again');
select is(public.read_designpro_genie_prep(
    '10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000009',
    repeat('a',64),'designpro.genie-prep.v1+designpro.genie-manifest.v1')->>'status','superseded',
  'the worker sees superseded, not ready, for the old vehicle');

-- fail: retryable → queued, and the attempt cap
select is(
  (public.claim_designpro_genie_prep('worker-1',180,NULL))->>'status','resolving',
  'the reclaim path picks the oldest queued row');
select is(
  (public.fail_designpro_genie_prep(
    (select id from public.designpro_genie_preps where vehicle_identity_hash=repeat('c',64)),
    (select lease_token from public.designpro_genie_preps where vehicle_identity_hash=repeat('c',64)),
    'genie_grounding_timeout','timed out',true))->>'status','queued',
  'a retryable failure returns the row to queued');

select * from finish();
rollback;
