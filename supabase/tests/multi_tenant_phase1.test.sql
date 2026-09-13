-- Multi-tenant Phase 1: the franchise/shop spine the white-label link sits on.
--
-- The point of these assertions is that the SHAPE is right before any customer
-- data is scoped to it (Phase 1b). A tenancy bug found after real shops exist
-- is a data migration; found here it is an edit.
BEGIN;
SELECT plan(14);

-- ── the four tables and their RLS ───────────────────────────────────────────
SELECT has_table('public','franchises','franchises exists');
SELECT has_table('public','shops','shops exists');
SELECT has_table('public','shop_members','shop_members exists');
SELECT has_table('public','franchise_admins','franchise_admins exists');

SELECT results_eq(
  $$ SELECT relname::text FROM pg_class
      WHERE relname IN ('franchises','shops','shop_members','franchise_admins')
        AND relrowsecurity IS FALSE $$,
  ARRAY[]::text[],
  'every tenant table has row security enabled'
);

-- ── the helpers RLS depends on ──────────────────────────────────────────────
-- SECURITY DEFINER is not decoration here: a policy runs with the querying
-- user's privileges, so an inline EXISTS against shop_members from an
-- `authenticated` session would fail and take the whole read down with it.
SELECT results_eq(
  $$ SELECT p.proname::text FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('user_shop_ids','is_shop_member','is_shop_admin','is_franchise_admin')
        AND p.prosecdef IS TRUE
      ORDER BY 1 $$,
  ARRAY['is_franchise_admin','is_shop_admin','is_shop_member','user_shop_ids'],
  'all four tenancy helpers exist and are SECURITY DEFINER'
);

-- ── the branding columns the white-label header reads ───────────────────────
-- OrganizationContext.tsx types these exactly; a rename here renders a blank
-- partner header rather than an error, which is the worst kind of failure.
SELECT has_column('public','franchises','slug','franchise slug — the partner link key');
SELECT has_column('public','franchises','logo_url','franchise logo for the header');
SELECT has_column('public','franchises','brand_primary_color','franchise brand colour');
SELECT has_column('public','shops','slug','shop slug — the per-shop link key');
SELECT has_column('public','shops','logo_url','shop logo for the header');

-- ── seats ───────────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT unnest(enum_range(NULL::public.shop_member_role))::text ORDER BY 1 $$,
  ARRAY['admin','member','owner'],
  'seat roles are owner/admin/member'
);

-- ── every user owns a tenant ────────────────────────────────────────────────
-- The backfill plus the signup trigger together mean work always has somewhere
-- to belong. Without this, the first partner signup has no shop to attach to.
SELECT is(
  (SELECT count(*) FROM auth.users u WHERE NOT EXISTS (
     SELECT 1 FROM public.shops s WHERE s.owner_user_id = u.id)),
  0::bigint,
  'every existing user was backfilled a shop'
);
SELECT is(
  (SELECT count(*) FROM public.shops s WHERE NOT EXISTS (
     SELECT 1 FROM public.shop_members m
      WHERE m.shop_id = s.id AND m.user_id = s.owner_user_id AND m.role = 'owner')),
  0::bigint,
  'every shop has its owner as an owner member'
);
SELECT has_trigger('auth','users','on_auth_user_created_shop',
  'a new signup is given a shop, so a tenant always exists');

-- ── no prospects presented as customers ─────────────────────────────────────
-- The source seeded Tint World and Signarama and then deleted them again:
-- prospects are not signed franchise customers, and a checked-in seed says
-- otherwise to anyone reading the table.
SELECT is(
  (SELECT count(*) FROM public.franchises WHERE slug IN ('tintworld','signarama')),
  0::bigint,
  'no franchise is seeded as a customer before it signs'
);

SELECT * FROM finish();
ROLLBACK;
