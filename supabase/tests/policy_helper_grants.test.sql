-- A POLICY HELPER THE CALLER CANNOT EXECUTE TAKES THE WHOLE READ DOWN.
--
-- 2026-08-27: `public.has_role(uuid, app_role)` was SECURITY DEFINER with the
-- ACL `postgres=X/postgres | service_role=X/postgres`. Three policies call it --
-- user_roles_read_own, user_subscriptions_read_own, user_tokens_read_own -- so
-- every signed-in read of the three tables that decide a person's plan, role and
-- token balance returned:
--
--   403 {"code":"42501","message":"permission denied for function has_role"}
--
-- Not "the has_role branch is false": the expression RAISES, and the raise kills
-- the whole SELECT, including the `user_id = auth.uid()` branch that was
-- supposed to work. `useUserTier` then falls through to `{tier:'free'}`, and
-- DesignIQ -- gated on `tier IN ('complete','agency') || tokenBalance > 0` --
-- renders LOCKED for every real customer.
--
-- It survived because `useUserTier` short-circuits on `isAllowlistedAdmin(email)`
-- BEFORE querying anything, and every account the team signs in with is on that
-- hardcoded list. The one population the bug could not reach was the people who
-- would have reported it.
--
-- THIS TEST IS DELIBERATELY GENERAL. Locking `has_role` alone would re-learn the
-- same lesson on the next helper. Every SECURITY DEFINER function named by a
-- policy expression in `public` must be EXECUTE-able by `authenticated`, because
-- that is the role those policies are written for.
begin;

select plan(4);

-- 1. The specific regression, by name and signature.
select ok(
  has_function_privilege('authenticated', 'public.has_role(uuid, public.app_role)', 'EXECUTE'),
  'authenticated may execute public.has_role -- the helper the plan/role/token policies call'
);

-- 2. WHERE THOSE POLICIES EXIST, EVERY ONE OF THEM IS COVERED.
--
--    The count is NOT asserted, and that is deliberate. user_roles_read_own,
--    user_subscriptions_read_own and user_tokens_read_own exist in production
--    and in NO migration -- `grep -rln user_roles_read_own supabase/migrations/`
--    returns only this feature's own migration. They are the same
--    production-drift class CLAUDE.md records for
--    designpro_private.caller_owns_generation: created directly against the
--    database, so a fresh replay has zero of them and a hardcoded 3 fails in the
--    shadow apply while passing against production. (It did, on the first run.)
--
--    So this asserts the invariant that holds in BOTH environments: whatever
--    policies reference the helper, all of them are reachable by the role that
--    evaluates them. Zero policies satisfies it vacuously in a fresh database;
--    three satisfy it in production.
select is(
  (select coalesce(pg_catalog.string_agg(tablename || '.' || policyname, ', '), '')
     from pg_catalog.pg_policies
    where schemaname = 'public'
      and (qual like '%has_role%' or coalesce(with_check, '') like '%has_role%')
      and not has_function_privilege('authenticated', 'public.has_role(uuid, public.app_role)', 'EXECUTE')),
  '',
  'no policy calls has_role from a role that cannot execute it'
);

-- 3. THE GENERAL RULE. Any SECURITY DEFINER function a public policy calls must
--    be executable by the role that evaluates the policy.
select is(
  (with helper as (
     select distinct (regexp_matches(
              coalesce(qual, '') || ' ' || coalesce(with_check, ''),
              '([a-z_][a-z0-9_]*)\s*\(', 'g'))[1] as name
       from pg_catalog.pg_policies
      where schemaname = 'public'
   )
   select coalesce(
     pg_catalog.string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text),
     ''
   )
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public', 'designpro_private')
      and p.proname in (select name from helper)
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  '',
  'every SECURITY DEFINER helper named by a public RLS policy is executable by authenticated'
);

-- 4. And RUN it as that role. CLAUDE.md's third PL/pgSQL rule: a catalog check
--    proves the grant is recorded; only a call proves the read now succeeds.
--    `has_function_privilege` returned true for this function on a database
--    where the REST layer was still answering 42501, because the ACL and the
--    executing role are two different questions.
create or replace function pg_temp.exercise_has_role() returns text
language plpgsql as $fn$
DECLARE v_ok boolean;
BEGIN
  SET LOCAL ROLE authenticated;
  SELECT public.has_role('00000000-0000-0000-0000-000000000000'::uuid,
                         'admin'::public.app_role) INTO v_ok;
  RESET ROLE;
  RETURN CASE WHEN v_ok IS FALSE THEN 'ok' ELSE 'unexpected verdict: ' || v_ok::text END;
EXCEPTION WHEN insufficient_privilege THEN
  RESET ROLE;
  RETURN 'denied';
END
$fn$;

select is(
  pg_temp.exercise_has_role(),
  'ok',
  'has_role called AS authenticated returns false for an unknown user rather than raising'
);

select * from finish();
rollback;
