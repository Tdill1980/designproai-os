-- ADMIN/TESTER EXPORT WITHOUT A STRIPE ROW; EVERYONE ELSE STILL PAYS.
--
-- Owner, 2026-09-24: "I need a easier way to bypass paywall and test wallpro
-- qc gate amd download and check files." 20260924040000 gives the export gate
-- the privilege the GENERATION gate has had since 20260910070849.
--
-- ⚠️ THIS FILE EXISTS BECAUSE ASSERTING THE TEXT OF A PL/pgSQL BODY PROVES
-- NOTHING ABOUT WHETHER IT RUNS. PL/pgSQL compiles a statement the first time
-- it is EVALUATED, so a body can apply clean in shadow, apply clean in
-- production, pass every string check, and still raise on the first real call
-- — which is exactly how confirm_designpro_revision_purchase shipped asking
-- for a generation_id column that has never existed. Every case below CALLS
-- the function.
begin;
select no_plan();

-- Three identities: one admin, one tester, one ordinary customer. Every row
-- rolls back; nothing here spends a token or reaches a provider.
insert into auth.users(id,email,role,created_at,updated_at) values
 ('aa000000-0000-4000-8000-000000000001','wall-admin@example.test','authenticated',now(),now()),
 ('aa000000-0000-4000-8000-000000000002','wall-tester@example.test','authenticated',now(),now()),
 ('aa000000-0000-4000-8000-000000000003','wall-customer@example.test','authenticated',now(),now());

insert into public.user_roles(user_id,role) values
 ('aa000000-0000-4000-8000-000000000001','admin'),
 ('aa000000-0000-4000-8000-000000000002','tester');

insert into public.wallpro_projects(id,owner_id,name) values
 ('bb000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','Admin wall'),
 ('bb000000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-000000000002','Tester wall'),
 ('bb000000-0000-4000-8000-000000000003','aa000000-0000-4000-8000-000000000003','Customer wall');

-- APPROVED, because the gate this patch touches sits BELOW the approval check.
-- A version left in draft would raise wallpro_version_not_approved and the
-- entitlement branch would never be reached — a green test over an untested
-- line, which is the shape this repo has recorded six times.
-- Built to the REAL DDL, not to what the test needed: version_no and kind are
-- NOT NULL, artwork_path has to start with the owner's own prefix, and
-- `status='approved'` is CHECK-tied to approved_at being set. A fixture looser
-- than the table is how nineteen tests once passed over a column that existed
-- in no migration.
insert into public.wallpro_design_versions
  (id,owner_id,project_id,version_no,kind,artwork_path,status,approved_at,placement) values
 ('cc000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001',
  1,'create','aa000000-0000-4000-8000-000000000001/generated/admin.png','approved',now(),'cover'),
 ('cc000000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-000000000002','bb000000-0000-4000-8000-000000000002',
  1,'create','aa000000-0000-4000-8000-000000000002/generated/tester.png','approved',now(),'cover'),
 ('cc000000-0000-4000-8000-000000000003','aa000000-0000-4000-8000-000000000003','bb000000-0000-4000-8000-000000000003',
  1,'create','aa000000-0000-4000-8000-000000000003/generated/customer.png','approved',now(),'cover');

-- The request the app sends. Valid, so nothing below can pass for the wrong
-- reason (a malformed request raises before the entitlement branch too).
create function pg_temp.req() returns jsonb language sql immutable as $$
  select jsonb_build_object('wallWidthIn',120,'wallHeightIn',96,'placement','cover',
                            'bleedIn',1,'overlapIn',0.5,'panelWidthIn',54,'targetPpi',150)
$$;

create function pg_temp.as_user(p_user uuid, p_version uuid) returns jsonb language plpgsql as $fn$
declare result jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role','authenticated','sub',p_user::text)::text, true);
  set local role authenticated;
  result := public.request_wallpro_production(p_version, pg_temp.req());
  reset role;
  return result;
exception when others then
  reset role;
  raise;
end $fn$;

-- 1. THE ASK. An admin exports with NO entitlement row anywhere.
select lives_ok(
  $$select pg_temp.as_user('aa000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000001')$$,
  'an admin queues production without buying it');

-- 2. tester carries the same privilege, because the generation side grants it
--    to both and a split would be a second rule to remember.
select lives_ok(
  $$select pg_temp.as_user('aa000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000002')$$,
  'a tester queues production without buying it');

-- 3. THE GATE IS NOT WIDER THAN THAT. This is the case that makes the two
--    above mean something: without it, deleting the whole check would pass.
select throws_ok(
  $$select pg_temp.as_user('aa000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000003')$$,
  'wallpro_entitlement_required',
  'a customer with no entitlement is still refused');

-- 4. And the privilege is the CALLER's, never the target's. An admin may not
--    comp someone else's version: the owner guard refuses first, so the role
--    lookup can never be reached for a version this caller does not own.
select throws_ok(
  $$select pg_temp.as_user('aa000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000003')$$,
  'wallpro_version_not_found',
  'an admin cannot queue production on a customer version');

-- 5. A paid customer still works, so the patch did not break the path that
--    actually earns money.
insert into public.wallpro_purchase_entitlements
  (owner_id,project_id,version_id,product_type,amount_cents,user_email,checkout_session_id)
values
  ('aa000000-0000-4000-8000-000000000003','bb000000-0000-4000-8000-000000000003',
   'cc000000-0000-4000-8000-000000000003','wallpro_custom_file',14900,
   'wall-customer@example.test','cs_test_wallpro_privileged_export');
select lives_ok(
  $$select pg_temp.as_user('aa000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000003')$$,
  'a paying customer still queues production');

-- 6. NO ENTITLEMENT IS INVENTED for the privileged runs. A comp row would put
--    a fake order number in the board and a $1 sale in the books; a privileged
--    export is an export with no purchase, and the ledger should say so.
select is(
  (select count(*)::int from public.wallpro_purchase_entitlements
    where owner_id in ('aa000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000002')),
  0,
  'privileged export writes no purchase row');

select * from finish();
rollback;
