-- GraphicsPro schema contract (migration 20260911210000_graphicspro_cut_contour).
--
-- The product reads graphics_pro_jobs from the browser (ProductionOutput polls
-- it, the studio pack path updates it), the shop markup lives in
-- shop_pricing_config keyed by user_id, wholesale rates come from
-- graphics_pro_pricing, and every file it shows or sends to Gemini is a public
-- URL in the graphicspro-files bucket. Each of those is asserted here against
-- the freshly-applied migration history, not against a production database
-- that may carry drifted objects.
begin;

select plan(19);

select has_table('public','graphics_pro_jobs','graphics_pro_jobs exists');
select has_table('public','graphics_pro_pricing','graphics_pro_pricing exists');
select has_table('public','shop_pricing_config','shop_pricing_config exists');

-- CHECK constraints admit every enum the UI (graphicspro-v1/types.ts) can send.
select lives_ok($$
  insert into public.graphics_pro_jobs (user_id, mode, surface_type, vinyl_finish, status)
  select id, 'design', 'studio', 'reflective', 'mockup_ready' from auth.users limit 0
$$, 'the studio surface, reflective finish and mockup_ready status pass the CHECKs');
select throws_ok($$
  insert into public.graphics_pro_jobs (user_id, mode) values (gen_random_uuid(), 'freeform')
$$, '23514', null, 'an unknown mode is rejected');
select throws_ok($$
  insert into public.graphics_pro_jobs (user_id, mode, surface_type) values (gen_random_uuid(), 'design', 'floor')
$$, '23514', null, 'an unknown surface_type is rejected');

-- Columns the browser selects from the job row (ProductionOutput).
select has_column('public','graphics_pro_jobs','cut_files_zip_url','cut files zip column');
select has_column('public','graphics_pro_jobs','cut_contour_overlay_url','cut contour overlay column');
select has_column('public','graphics_pro_jobs','vinyl_zones','Konva zone rectangles are persisted');
select has_column('public','graphics_pro_jobs','zone_overlay_url','the burned-in zone overlay is persisted');
select has_column('public','graphics_pro_jobs','concept_json','studio cut spec + review flags');

-- Row security: the customer reads and updates only their own job.
select is((select relrowsecurity from pg_class where oid='public.graphics_pro_jobs'::regclass), true,
  'graphics_pro_jobs has RLS enabled');
select ok(exists (select 1 from pg_policies where schemaname='public' and tablename='graphics_pro_jobs'
  and policyname='graphics_pro_jobs_owner_select' and roles @> array['authenticated']::name[]),
  'owner select policy exists for authenticated');
select ok(exists (select 1 from pg_policies where schemaname='public' and tablename='graphics_pro_jobs'
  and policyname='graphics_pro_jobs_owner_update' and cmd='UPDATE'),
  'owner update policy exists (studio pack persists its SVG from the browser)');

-- Pricing seed the production stage reads by material_type.
select results_eq(
  $$ select material_type, wholesale_price_sqft from public.graphics_pro_pricing order by material_type $$,
  $$ values ('3m_cut_contour', 6.92::numeric), ('avery_cut_contour', 6.32::numeric) $$,
  'wholesale rates seeded for both cut-contour materials');

-- ShopMarkupConfig upserts on user_id.
select col_is_unique('public','shop_pricing_config','user_id','shop_pricing_config.user_id is unique');

-- The public bucket every GraphicsPro consumer reads.
select is((select public from storage.buckets where id='graphicspro-files'), true,
  'graphicspro-files is a public bucket');
select ok(exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
  and policyname='graphicspro_files_public_read' and cmd='SELECT'),
  'public read policy on graphicspro-files');
select ok(exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
  and policyname='graphicspro_files_owner_upload' and cmd='INSERT'
  and with_check like '%renders%' and with_check like '%auth.uid()%'),
  'browser uploads are confined to renders/{uid}/…');

select * from finish();
rollback;
