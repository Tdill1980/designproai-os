begin;
select no_plan();
-- pgTAP itself is not exposed to customer roles in the fresh standalone schema.
-- Keep assertions outside the role switch while exercising each query as caller.
create function pg_temp.wall_customer(p_sql text) returns text language plpgsql as $fn$
declare result text;
begin
  set local role authenticated;
  if lower(left(ltrim(p_sql),6))='select' then execute p_sql into result;
  else execute p_sql;
  end if;
  reset role;
  return result;
exception when others then
  reset role;
  raise;
end $fn$;
-- All test identities, balances and object metadata roll back. No provider call.
insert into auth.users(id,email,role,created_at,updated_at) values
 ('a0101010-1010-4010-8010-101010101010','wallpro-owner@example.test','authenticated',now(),now()),
 ('b0202020-2020-4020-8020-202020202020','wallpro-other@example.test','authenticated',now(),now());
insert into public.user_tokens(user_id,balance) values ('a0101010-1010-4010-8010-101010101010',2);
-- BOTH IDENTITIES HAVE ALREADY SPENT THEIR ONE FREE DESIGN.
--
-- Try-free (20260914230000) makes the FIRST generation of every owner free,
-- ahead of the subscription and token arms. Without these rows the paid-path
-- assertions below silently stop testing the paid path: the first reserve
-- would take the 'trial' branch, spend nothing, and "one request reserves one
-- token" would read a balance of 2 while appearing to pass judgement on token
-- accounting. The trial and membership branches get their own coverage at the
-- end of this file, on identities that have not used theirs.
insert into public.wallpro_generations(id,owner_id,input_hash,input,charge_source,state,completed_at) values
 ('a1111111-1111-4111-8111-111111111111','a0101010-1010-4010-8010-101010101010',repeat('1',64),'{}','trial','completed',now()),
 ('b2222222-2222-4222-8222-222222222222','b0202020-2020-4020-8020-202020202020',repeat('2',64),'{}','trial','completed',now());

select is((select public from storage.buckets where id='wallpro-files'),false,'WallPro storage is private');
select ok(not has_function_privilege('authenticated','public.reserve_wallpro_generation(uuid,uuid,text,jsonb)','EXECUTE'),'customers cannot reserve credits for arbitrary owners');
select ok(not has_function_privilege('authenticated','public.finish_wallpro_generation(uuid,uuid,text,text,text)','EXECUTE'),'customers cannot forge results or refunds');
select ok(not has_table_privilege('authenticated','public.wallpro_generations','INSERT'),'only the server can record AI generations');

set local role service_role;
select lives_ok($$select public.reserve_wallpro_generation('c0303030-3030-4030-8030-303030303030','a0101010-1010-4010-8010-101010101010',repeat('a',64),'{}')$$,'verified handler reserves a generation');
reset role;
select is((select balance from public.user_tokens where user_id='a0101010-1010-4010-8010-101010101010'),1,'one request reserves one token');
select is((select public.reserve_wallpro_generation('c0303030-3030-4030-8030-303030303030','a0101010-1010-4010-8010-101010101010',repeat('a',64),'{}')->>'fresh'),'false','replay reuses the reservation');
select is((select balance from public.user_tokens where user_id='a0101010-1010-4010-8010-101010101010'),1,'replay does not charge again');
select throws_ok($$select public.reserve_wallpro_generation('c0303030-3030-4030-8030-303030303030','a0101010-1010-4010-8010-101010101010',repeat('b',64),'{}')$$,'P0001','request_conflict','changed input cannot reuse an ID');
select throws_ok($$select public.reserve_wallpro_generation('d0404040-4040-4040-8040-404040404040','a0101010-1010-4010-8010-101010101010',repeat('a',64),'{}')$$,'P0001','generation_in_progress','concurrent requests cannot run up credits');
set local role service_role;
select lives_ok($$select public.finish_wallpro_generation('c0303030-3030-4030-8030-303030303030','a0101010-1010-4010-8010-101010101010',null,null,'Provider unavailable')$$,'failed provider request completes with a refund');
reset role;
select is((select balance from public.user_tokens where user_id='a0101010-1010-4010-8010-101010101010'),2,'failed request restores the token');
select public.finish_wallpro_generation('c0303030-3030-4030-8030-303030303030','a0101010-1010-4010-8010-101010101010',null,null,'Provider unavailable');
select is((select balance from public.user_tokens where user_id='a0101010-1010-4010-8010-101010101010'),2,'duplicate failure does not refund twice');
select throws_ok($$select public.reserve_wallpro_generation('d0404040-4040-4040-8040-404040404040','b0202020-2020-4020-8020-202020202020',repeat('a',64),'{}')$$,'P0001','no_tokens','customer without allowance cannot generate');

insert into public.user_subscriptions(id,user_id,email,tier,render_count) values
 ('e0505050-5050-4050-8050-505050505050','a0101010-1010-4010-8010-101010101010','wallpro-owner@example.test','starter',49);
select public.reserve_wallpro_generation('d0404040-4040-4040-8040-404040404040','a0101010-1010-4010-8010-101010101010',repeat('a',64),'{}');
select is((select render_count from public.user_subscriptions where id='e0505050-5050-4050-8050-505050505050'),50,'plan allowance is reserved atomically');
select is((select balance from public.user_tokens where user_id='a0101010-1010-4010-8010-101010101010'),2,'plan allowance preserves token balance');
select public.finish_wallpro_generation('d0404040-4040-4040-8040-404040404040','a0101010-1010-4010-8010-101010101010',null,null,'Provider unavailable');
select is((select render_count from public.user_subscriptions where id='e0505050-5050-4050-8050-505050505050'),49,'failed plan render also returns its allowance');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"a0101010-1010-4010-8010-101010101010"}',true);
select lives_ok($outer$select pg_temp.wall_customer($$insert into public.wallpro_projects(id,owner_id,name,config) values ('f0606060-6060-4060-8060-606060606060','a0101010-1010-4010-8010-101010101010','Measured wall','{"wallPath":"a0101010-1010-4010-8010-101010101010/uploads/c0303030-3030-4030-8030-303030303030.jpg","width":120,"height":96}')$$)$outer$,'customer saves their measured wall');
select is((pg_temp.wall_customer($$select count(*) from public.wallpro_projects where id='f0606060-6060-4060-8060-606060606060'$$)::int),1,'owner can reopen saved placement');
select lives_ok($outer$select pg_temp.wall_customer($$insert into storage.objects(bucket_id,name) values ('wallpro-files','a0101010-1010-4010-8010-101010101010/uploads/c0303030-3030-4030-8030-303030303030.jpg')$$)$outer$,'owner uploads a wall image in their private namespace');
select is((pg_temp.wall_customer($$select count(*) from storage.objects where bucket_id='wallpro-files' and name='a0101010-1010-4010-8010-101010101010/uploads/c0303030-3030-4030-8030-303030303030.jpg'$$)::int),1,'owner can read their uploaded photo');
reset role;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b0202020-2020-4020-8020-202020202020"}',true);
select is((pg_temp.wall_customer($$select count(*) from public.wallpro_projects where id='f0606060-6060-4060-8060-606060606060'$$)::int),0,'another customer cannot read the project');
select is((pg_temp.wall_customer($$select count(*) from public.wallpro_generations where owner_id='a0101010-1010-4010-8010-101010101010'$$)::int),0,'another customer cannot read AI history');
select is((pg_temp.wall_customer($$select count(*) from storage.objects where bucket_id='wallpro-files' and name='a0101010-1010-4010-8010-101010101010/uploads/c0303030-3030-4030-8030-303030303030.jpg'$$)::int),0,'another customer cannot read the photo');
select throws_ok($outer$select pg_temp.wall_customer($$insert into storage.objects(bucket_id,name) values ('wallpro-files','a0101010-1010-4010-8010-101010101010/uploads/d0404040-4040-4040-8040-404040404040.png')$$)$outer$,'42501',null,'another customer cannot upload into the owner namespace');
select throws_ok($outer$select pg_temp.wall_customer($$insert into public.wallpro_projects(owner_id) values ('a0101010-1010-4010-8010-101010101010')$$)$outer$,'42501',null,'another customer cannot forge project ownership');
reset role;

-- ── TRY FREE, AND COMMERCIALPRO (20260914230000) ──────────────────────────
--
-- These assertions exist because the PGlite suite for that migration could not
-- catch what it shipped. That fixture declared `charge_source text` with no
-- constraint, so nine green tests still let through a function writing
-- 'trial' -- a value the real table's CHECK refused -- which would have thrown
-- 23514 at EVERY first-time customer, since 'trial' is precisely the branch for
-- "no non-failed generation yet". A hand-built fixture agrees with whatever the
-- function does, because it was built from the function. THIS file runs against
-- the real migration chain, so it is where the two branches belong.
insert into auth.users(id,email,role,created_at,updated_at) values
 ('31313131-3131-4031-8031-313131313131','wallpro-first@example.test','authenticated',now(),now()),
 ('41414141-4141-4041-8041-414141414141','wallpro-member@example.test','authenticated',now(),now());

set local role service_role;
-- A first-time customer with no tokens, no plan and no membership: the exact
-- identity that would have hit the constraint.
select is((select public.reserve_wallpro_generation('3a3a3a3a-3131-4031-8031-313131313131','31313131-3131-4031-8031-313131313131',repeat('3',64),'{}')->'generation'->>'charge_source'),'trial','a first-time customer designs free');
reset role;
select public.finish_wallpro_generation('3a3a3a3a-3131-4031-8031-313131313131','31313131-3131-4031-8031-313131313131','31313131-3131-4031-8031-313131313131/generated/3a3a3a3a-3131-4031-8031-313131313131.png','First wall',null);
-- And the paywall closes behind them: no tokens, no plan, nothing left to spend.
select throws_ok($$select public.reserve_wallpro_generation('3b3b3b3b-3131-4031-8031-313131313131','31313131-3131-4031-8031-313131313131',repeat('3',64),'{}')$$,'P0001','no_tokens','the second design is not free');

-- A CommercialPro member designs free every time, not once.
insert into public.commercialpro_members(user_id,reason) values ('41414141-4141-4041-8041-414141414141','500+ sq ft in 12 months');
set local role service_role;
select is((select public.reserve_wallpro_generation('4a4a4a4a-4141-4041-8041-414141414141','41414141-4141-4041-8041-414141414141',repeat('4',64),'{}')->'generation'->>'charge_source'),'commercialpro','a CommercialPro member designs free');
reset role;
select public.finish_wallpro_generation('4a4a4a4a-4141-4041-8041-414141414141','41414141-4141-4041-8041-414141414141','41414141-4141-4041-8041-414141414141/generated/4a4a4a4a-4141-4041-8041-414141414141.png','Member wall',null);
set local role service_role;
select is((select public.reserve_wallpro_generation('4b4b4b4b-4141-4041-8041-414141414141','41414141-4141-4041-8041-414141414141',repeat('4',64),'{}')->'generation'->>'charge_source'),'commercialpro','membership is not a one-off trial');
reset role;

-- The question the page asks BEFORE spending anything, so "your first design is
-- free" is a promise the database agrees with rather than a hope.
select is(public.wallpro_free_generation_reason('41414141-4141-4041-8041-414141414141'),'commercialpro','the page can name why a member is free');
select is(public.wallpro_free_generation_reason('a0101010-1010-4010-8010-101010101010'),null,'a spent trial is not advertised as free');

-- The constraint itself, stated once: the table must admit every value the
-- function can produce. This is the assertion whose absence cost the release.
-- Written so a MISSING constraint fails rather than vanishing: the definition
-- comes back NULL, every LIKE is NULL, the count is 0, and 0 <> 5.
select is(
  (select count(*)::int from unnest(array['privileged','subscription','tokens','commercialpro','trial']) as v
    where (select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint
           where conname='wallpro_generations_charge_source_check') like '%''' || v || '''%'),
  5,
  'the charge_source CHECK admits every source the reservation can write');

select * from finish();
rollback;
