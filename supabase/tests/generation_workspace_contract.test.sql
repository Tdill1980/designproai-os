-- THE WORKSPACE READ IS TESTED BY CALLING IT OVER A ROW, NOT BY READING IT.
--
-- `20260826030000` shipped `pg_catalog.coalesce(...)` inside the aggregate that
-- projects each approved view. COALESCE is SQL GRAMMAR, not a function in any
-- schema, so the qualified form does not resolve -- but PL/pgSQL compiles an
-- expression the first time it is EVALUATED, and the aggregate evaluates
-- nothing when it has no rows. So the function returned a perfect '[]' for
-- every generation whose proofs the sibling fence withholds, applied clean in
-- the shadow database, applied clean in production, and then failed for every
-- generation that actually had proofs to show:
--
--   ERROR: function pg_catalog.coalesce(jsonb, jsonb) does not exist
--
-- which is the only case RevisionStudio exists to serve. Fixed by
-- `20260826060000`.
--
-- Every assertion below therefore runs the function against a request carrying
-- SEVEN real view rows. `has_function` would have passed throughout; so would
-- any check on the migration's text. Only execution over data separates "this
-- parsed" from "this runs".
begin;
select plan(13);

select has_function(
  'public','designpro_generation_workspace',ARRAY['uuid'],
  'the generation-keyed workspace read exists'
);
select ok(has_function_privilege(
  'authenticated','public.designpro_generation_workspace(uuid)','EXECUTE'
), 'an authenticated owner may read their own workspace');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '11000000-0000-4000-8000-0000000000a1','authenticated','authenticated',
   'workspace-owner@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000',
   '11000000-0000-4000-8000-0000000000a2','authenticated','authenticated',
   'workspace-staff@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000',
   '11000000-0000-4000-8000-0000000000a3','authenticated','authenticated',
   'workspace-stranger@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now())
on conflict(id) do nothing;

-- A design-team member who owns nothing. The brief's access rule in one row:
-- QC staff open a customer's generation through the membership contract, never
-- by weakening the customer's own row security.
insert into public.designpro_qc_members(user_id,can_preflight)
values('11000000-0000-4000-8000-0000000000a2',true)
on conflict(user_id) do update set can_preflight=excluded.can_preflight;

with input(value) as (values(jsonb_build_object(
  'contractVersion','designpro.calls-1-7-input.v2',
  'vehicle',jsonb_build_object(
    'year','2020','make','Ford','model','F 150','type','truck'
  ),
  'brief','Workspace read must survive a generation that HAS proofs',
  'designName','Workspace Contract',
  'mode','commercial',
  'companyName','Workspace Contract'
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
  '31000000-0000-4000-8000-0000000000a1',
  '32000000-0000-4000-8000-0000000000a1',
  '11000000-0000-4000-8000-0000000000a1',
  'user_11000000-0000-4000-8000-0000000000a1',
  'calls17:32000000-0000-4000-8000-0000000000a1:'||input_hash,
  'outputs_ready',value,input_hash,engine_contract,
  encode(extensions.digest(convert_to(engine_contract::text,'UTF8'),'sha256'),'hex'),
  repeat('a',64),
  jsonb_build_object(
    'contractVersion','designpro.calls-1-7-receipt.v1',
    'handoffRevisionId','33000000-0000-4000-8000-0000000000a1',
    'callsCompleted','7','byteVerified','true'
  ),now()
from identity;

-- SEVEN VIEWS. This is the whole point: an empty view set never evaluated the
-- broken expression, so a fixture without rows reproduces nothing.
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
  '31000000-0000-4000-8000-0000000000a1',source_view_type,consumer_role,
  'designpro/user_11000000-0000-4000-8000-0000000000a1/'
    ||'32000000-0000-4000-8000-0000000000a1/calls-1-7/'
    ||source_view_type||'/'||repeat(ordinal::text,64)||'.png',
  repeat(ordinal::text,64),2000+ordinal,'image/png',
  jsonb_build_object('provider',jsonb_build_object(
    'atlasMasterContentHash',repeat('b',64),
    'atlasZoneSurfaceKey',consumer_role,
    'deterministicMirror',consumer_role='passenger'
  ))
from plan;

-- WITH NO IDENTITY THERE IS NO READ.
--
-- pg_prove runs as a bare superuser carrying no JWT, so it is neither the
-- owner, the service role, nor a design-team member. NULL is the correct
-- answer, and asserting it here is what stops the rest of this file passing
-- vacuously: an earlier draft counted elements of a NULL result, got 0, and
-- reported a green check for a function that had refused it.
select ok(
  public.designpro_generation_workspace(
    '32000000-0000-4000-8000-0000000000a1') is null,
  'a caller with no identity is refused, and refusal is NULL not an empty view set'
);

-- THE OWNER.
--
-- CLAIMS ONLY -- never a session-role switch. auth.uid() and auth.jwt()
-- read request.jwt.claims, so the claims alone decide identity. Switching
-- the session role as well does nothing for the function under test and
-- takes pgTAP's own ok/is out of the search path, which failed this file
-- with "function ok(boolean, unknown) does not exist" at the first
-- assertion after the switch.
set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select ok(
  public.designpro_generation_workspace(
    '32000000-0000-4000-8000-0000000000a1') is not null,
  'the owner reads a generation that has proofs'
);
select is(
  jsonb_array_length(
    public.designpro_generation_workspace(
      '32000000-0000-4000-8000-0000000000a1')->'views'),
  7,
  'all seven approved views are projected -- the aggregate actually evaluated'
);
select is(
  public.designpro_generation_workspace(
    '32000000-0000-4000-8000-0000000000a1')->>'designName',
  'Workspace Contract',
  'the card identity comes back with the views'
);
select is(
  public.designpro_generation_workspace(
    '32000000-0000-4000-8000-0000000000a1')->>'brief',
  'Workspace read must survive a generation that HAS proofs',
  'the customer brief is carried verbatim'
);

-- The two booleans whose COALESCE was the defect. Each is counted in the
-- POSITIVE, so a NULL result scores zero and fails rather than matching an
-- expected zero by accident.
select is(
  (select count(*) from jsonb_array_elements(
     public.designpro_generation_workspace(
       '32000000-0000-4000-8000-0000000000a1')->'views') v
   where (v->>'atlasDeterministicMirror')::boolean),
  1::bigint,
  'the deterministic-mirror flag resolves, and only passenger carries it'
);
select is(
  (select count(*) from jsonb_array_elements(
     public.designpro_generation_workspace(
       '32000000-0000-4000-8000-0000000000a1')->'views') v
   where NOT (v->>'atlasAnchoredToDriver')::boolean),
  7::bigint,
  'an absent anchoredToView1 resolves to false on every view rather than raising'
);
select is(
  (select count(*) from jsonb_array_elements(
     public.designpro_generation_workspace(
       '32000000-0000-4000-8000-0000000000a1')->'views') v
   where v->>'atlasMasterContentHash' = repeat('b',64)),
  7::bigint,
  'every view states which master it was rendered from'
);

-- DESIGN STAFF, WHO OWN NOTHING.
set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select is(
  jsonb_array_length(
    public.designpro_generation_workspace(
      '32000000-0000-4000-8000-0000000000a1')->'views'),
  7,
  'a design-team member opens a generation they do not own'
);
select is(
  public.designpro_generation_workspace(
    '32000000-0000-4000-8000-0000000000a1')->>'ownerId',
  '11000000-0000-4000-8000-0000000000a1',
  'and the record still names the real owner, not the reader'
);

-- EVERYONE ELSE.
set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select ok(
  public.designpro_generation_workspace(
    '32000000-0000-4000-8000-0000000000a1') is null,
  'an authenticated stranger is refused: staff access widened nothing else'
);

select * from finish();
rollback;
