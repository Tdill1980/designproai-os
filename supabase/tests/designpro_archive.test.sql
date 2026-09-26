-- THE DESIGN ARCHIVE: shape and privilege, on the real migration chain.
-- Behaviour (triggers, search, RLS, history, backfill) is proven on PGlite in
-- tests/designpro-design-archive-db.test.mjs; this file proves the SAME objects
-- exist with the SAME grants after every migration in the repo is applied.
begin;
select plan(16);

select has_table('public', 'designpro_designs', 'the design index exists');
select has_table('public', 'designpro_design_orders', 'the design<->order link exists');
select col_is_pk('public', 'designpro_designs', 'design_id', 'DesignID is the key');
select col_is_unique('public', 'designpro_designs', 'generation_id', 'one design per GenerationID');
select has_column('public', 'designpro_designs', 'template_ref', 'the vector-template hook exists');
select has_column('public', 'designpro_designs', 'created_year', 'designs are searchable by year');

select ok((select relrowsecurity from pg_class where oid = 'public.designpro_designs'::regclass), 'RLS on designs');
select ok((select relrowsecurity from pg_class where oid = 'public.designpro_design_orders'::regclass), 'RLS on design orders');
select ok(not has_table_privilege('authenticated', 'public.designpro_designs', 'INSERT'), 'customers never write the index directly');
select ok(not has_table_privilege('anon', 'public.designpro_designs', 'SELECT'), 'anonymous callers cannot read the archive');
select ok(not has_table_privilege('authenticated', 'public.designpro_design_files', 'SELECT'),
  'the files view is service-only; customers read through designpro_design_history');

select ok(has_function_privilege('authenticated', 'public.designpro_design_search(text,text,text,text,integer,integer,timestamptz,timestamptz,text,integer,timestamptz,text)', 'EXECUTE'),
  'customers and QC staff may search');
select ok(has_function_privilege('authenticated', 'public.designpro_design_history(text)', 'EXECUTE'), 'customers and QC staff may read history');
select ok(not has_function_privilege('authenticated', 'public.designpro_archive_backfill(integer,boolean)', 'EXECUTE'), 'backfill is service-only');
select ok(not has_function_privilege('anon', 'public.designpro_bind_design_order(uuid,text,text,bigint)', 'EXECUTE'), 'anonymous callers cannot bind orders');

select is(
  (select count(*)::int from pg_trigger where not tgisinternal and tgname like 'designpro_archive_%'),
  4, 'the four archive triggers are installed');

select * from finish();
rollback;
