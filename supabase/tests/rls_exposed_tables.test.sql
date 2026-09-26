begin;
select no_plan();
-- ISSUE 1: the 25 tables that shipped with RLS off and full anon grants.
-- All fixtures roll back. Assertions run as the caller role through pg_temp
-- helpers (pgTAP is not exposed to customer roles).

create function pg_temp.as_caller(p_role text, p_sub uuid, p_sql text) returns bigint language plpgsql as $fn$
declare result bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', p_role, 'sub', p_sub)::text, true);
  execute format('set local role %I', p_role);
  execute p_sql into result;
  reset role;
  return result;
exception when others then
  reset role;
  raise;
end $fn$;

create function pg_temp.caller_exec(p_role text, p_sub uuid, p_sql text) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', p_role, 'sub', p_sub)::text, true);
  execute format('set local role %I', p_role);
  execute p_sql;
  reset role;
exception when others then
  reset role;
  raise;
end $fn$;

insert into auth.users(id,email,role,created_at,updated_at) values
 ('a1a1a1a1-0000-4000-8000-000000000001','rls-owner@example.test','authenticated',now(),now()),
 ('b2b2b2b2-0000-4000-8000-000000000002','rls-other@example.test','authenticated',now(),now()),
 ('c3c3c3c3-0000-4000-8000-000000000003','rls-admin@example.test','authenticated',now(),now()),
 ('d4d4d4d4-0000-4000-8000-000000000004','rls-staff@example.test','authenticated',now(),now());
insert into public.user_roles(user_id, role) values ('c3c3c3c3-0000-4000-8000-000000000003','admin');
insert into public.designpro_qc_members(user_id, can_preflight) values ('d4d4d4d4-0000-4000-8000-000000000004', true);

insert into public.panelizer_jobs(id,user_id) values
 ('11111111-0000-4000-8000-000000000001','a1a1a1a1-0000-4000-8000-000000000001'),
 ('22222222-0000-4000-8000-000000000002','b2b2b2b2-0000-4000-8000-000000000002');
insert into public.token_transactions(user_id,amount,balance_after) values
 ('a1a1a1a1-0000-4000-8000-000000000001',5,5),('b2b2b2b2-0000-4000-8000-000000000002',7,7);
insert into public.panel_artboard_jobs(id,user_id) values
 ('33333333-0000-4000-8000-000000000003','a1a1a1a1-0000-4000-8000-000000000001');
insert into public.panel_artboard_assets(job_id,kind,url) values
 ('33333333-0000-4000-8000-000000000003','panel','https://example.test/a.png');
insert into public.vehicle_dimensions(make,model) values ('RlsTestMake','RlsTestModel');
insert into public.blocked_users(email) values ('blocked@example.test');

-- 1. Every one of the 25 has RLS on and no client TRUNCATE/TRIGGER/REFERENCES.
select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity and c.relname = any(array[
    'blocked_users','design_version_commits','designpro_entice_packs','designpro_production_jobs',
    'manufacturer_colors','moderation_log','panel_artboard_assets','panel_artboard_jobs','panelizer_jobs',
    'production_flow_assets','production_panel_dispatches','production_panels','proof_events',
    'render_events','render_templates','render_usage','token_transactions','vehicle_dimensions',
    'vehicle_renders','vehicle_specs_cache','vinyl_reference_images','vinyl_swatches',
    'workflow_resource_leases','workflow_stage_runs','workforce_runs'])), 25::bigint,
  'all 25 exposed tables have RLS enabled');
select is((select count(*) from information_schema.role_table_grants
  where table_schema='public' and grantee in ('anon','authenticated')
    and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')
    and table_name in ('panelizer_jobs','token_transactions','render_usage','vehicle_dimensions','blocked_users','workforce_runs')),
  0::bigint, 'no client role can TRUNCATE, add triggers or reference these tables');
select ok(not has_table_privilege('anon','public.token_transactions','SELECT'), 'anon cannot read the token ledger');
select ok(not has_table_privilege('anon','public.panelizer_jobs','INSERT'), 'anon cannot write jobs');
select ok(not has_table_privilege('anon','public.vehicle_dimensions','INSERT'), 'anon cannot write catalogs');
select ok(has_table_privilege('service_role','public.production_panels','SELECT'), 'service_role keeps its grants');

-- 2. The one live browser path: a signed-in customer sees exactly their own pack.
select is(pg_temp.as_caller('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  $$select count(*) from public.panelizer_jobs$$), 1::bigint, 'owner sees only their own panelizer_jobs row');
select is(pg_temp.as_caller('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  $$select count(*) from public.panelizer_jobs where id='22222222-0000-4000-8000-000000000002'$$), 0::bigint,
  'owner cannot see another customer''s job');
select lives_ok($$select pg_temp.caller_exec('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  'insert into public.panelizer_jobs(user_id) values (''a1a1a1a1-0000-4000-8000-000000000001'')')$$,
  'owner can create their own job (DesignProToolUI)');
select throws_ok($$select pg_temp.caller_exec('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  'insert into public.panelizer_jobs(user_id) values (''b2b2b2b2-0000-4000-8000-000000000002'')')$$,
  '42501', null, 'owner cannot create a job for someone else');
select pg_temp.caller_exec('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  $$update public.panelizer_jobs set status='hijacked' where id='22222222-0000-4000-8000-000000000002'$$);
select isnt((select status from public.panelizer_jobs where id='22222222-0000-4000-8000-000000000002'), 'hijacked',
  'owner cannot update another customer''s job');
select is(pg_temp.as_caller('authenticated','d4d4d4d4-0000-4000-8000-000000000004',
  $$select count(*) from public.panelizer_jobs where id in ('11111111-0000-4000-8000-000000000001','22222222-0000-4000-8000-000000000002')$$),
  2::bigint, 'design staff see jobs for QC');
select is(pg_temp.as_caller('anon',null,$$select count(*) from public.panelizer_jobs$$), 0::bigint,
  'anon sees no jobs') ;

-- 3. Money tables.
select is(pg_temp.as_caller('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  $$select count(*) from public.token_transactions$$), 1::bigint, 'a customer sees only their own ledger rows');
select throws_ok($$select pg_temp.caller_exec('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  'insert into public.token_transactions(user_id,amount,balance_after) values (''a1a1a1a1-0000-4000-8000-000000000001'',1000,1000)')$$,
  '42501', null, 'a customer cannot mint tokens');
select throws_ok($$select pg_temp.caller_exec('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  'insert into public.render_usage(user_id,email,tier,render_type,billing_cycle_start) values (''b2b2b2b2-0000-4000-8000-000000000002'',''x@example.test'',''free'',''color'',now())')$$,
  '42501', null, 'a customer cannot record usage against someone else');
select lives_ok($$select pg_temp.caller_exec('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  'insert into public.render_usage(user_id,email,tier,render_type,billing_cycle_start) values (''a1a1a1a1-0000-4000-8000-000000000001'',''rls-owner@example.test'',''free'',''color'',now())')$$,
  'useBulkRenderQueue can still record the caller''s own usage');

-- 4. Catalogs stay readable, writable only by admin.
select ok(pg_temp.as_caller('anon',null,$$select count(*) from public.vehicle_dimensions where make='RlsTestMake'$$) = 1,
  'anon can read the vehicle catalog');
select throws_ok($$select pg_temp.caller_exec('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  'insert into public.vehicle_dimensions(make,model) values (''X'',''Y'')')$$, '42501', null,
  'a customer cannot write the catalog');
select lives_ok($$select pg_temp.caller_exec('authenticated','c3c3c3c3-0000-4000-8000-000000000003',
  'insert into public.vehicle_dimensions(make,model) values (''RlsAdminMake'',''Y'')')$$,
  'admin can write the catalog (admin pages)');

-- 5. Children and server-only tables.
select is(pg_temp.as_caller('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  $$select count(*) from public.panel_artboard_assets$$), 1::bigint, 'parent owner sees artboard assets');
select is(pg_temp.as_caller('authenticated','b2b2b2b2-0000-4000-8000-000000000002',
  $$select count(*) from public.panel_artboard_assets$$), 0::bigint, 'other customers do not');
select is(pg_temp.as_caller('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  $$select count(*) from public.blocked_users$$), 0::bigint, 'customers cannot read blocked_users (PII)');
select is(pg_temp.as_caller('authenticated','c3c3c3c3-0000-4000-8000-000000000003',
  $$select count(*) from public.blocked_users where email='blocked@example.test'$$), 1::bigint, 'admin can');
select lives_ok($$select pg_temp.caller_exec('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  'insert into public.proof_events(proof_id,event_type,actor_user_id) values (gen_random_uuid(),''shop_reply'',''a1a1a1a1-0000-4000-8000-000000000001'')')$$,
  'ApproveProPage can log its own proof event');
select lives_ok($$select pg_temp.caller_exec('authenticated','a1a1a1a1-0000-4000-8000-000000000001',
  'insert into public.production_flow_assets(job_id,side,dimensions_inches,background_url,branding_url,depth_mask_url,final_pack_url) values (gen_random_uuid(),''PANEL-1'',''{}'',''u'',''u'','''','''')')$$,
  'wallPanelize.ts can still save panels');

select * from finish();
rollback;
