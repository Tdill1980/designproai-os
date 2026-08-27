-- EVERY CUSTOMER READS AS "FREE" BECAUSE A POLICY HELPER HAS NO EXECUTE GRANT.
--
-- Found 2026-08-27 while trying to run an end-to-end canary as a NON-allowlisted
-- account. The browser's own network log, verbatim:
--
--   403 user_roles?select=role&user_id=eq.b940320d…&role=in.(admin,tester)
--       {"code":"42501","message":"permission denied for function has_role"}
--   403 user_subscriptions?select=tier,status&user_id=eq.b940320d…&status=eq.active
--       {"code":"42501","message":"permission denied for function has_role"}
--   403 user_tokens?select=balance&user_id=eq.b940320d…
--       {"code":"42501","message":"permission denied for function has_role"}
--
-- `public.has_role(uuid, app_role)` is SECURITY DEFINER (its whole reason to
-- exist — a policy expression runs with the PRIVILEGES OF THE QUERYING USER, so
-- an inline EXISTS over `user_roles` could never be read by `authenticated`).
-- But its ACL is `postgres=X/postgres | service_role=X/postgres`: the role that
-- actually evaluates the policy was never granted EXECUTE.
--
-- A missing EXECUTE grant on a helper does not degrade one branch of a policy —
-- it raises, and the raise takes the WHOLE read down. So the three tables that
-- decide a person's plan, role and token balance return 403 to every signed-in
-- user, and `useUserTier` falls through to `{tier:'free'}`. DesignIQ is gated on
-- `tier IN ('complete','agency') || tokenBalance > 0`, so the AI Design Studio
-- renders LOCKED — "Upgrade to Unlock" — for every real customer.
--
-- WHY NOBODY HIT IT: `useUserTier` checks `isAllowlistedAdmin(user.email)` FIRST
-- and returns 'agency' without querying anything. Every account the team signs
-- in with is on that hardcoded list, so the team is the one population the bug
-- cannot reach. The allow-list was documented as "belt-and-suspenders … so newly
-- added operators get access immediately"; in practice it has been carrying the
-- entire authorization path.
--
-- The three affected policies, by name:
--   user_roles.user_roles_read_own · user_subscriptions.user_subscriptions_read_own
--   · user_tokens.user_tokens_read_own
-- each `((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'))`.
--
-- NOT IN THE MIGRATION HISTORY. No migration REVOKEs execute on has_role, and
-- `CREATE OR REPLACE` preserves an existing ACL — so this grant was removed
-- against the database directly, exactly the production-drift class CLAUDE.md
-- records for `designpro_private.caller_owns_generation`. Validating against
-- production is necessary and not sufficient; this migration therefore states
-- the grant unconditionally rather than assuming any prior state.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- `anon` is deliberately NOT granted. Every policy that calls this helper is
-- already scoped to the `authenticated` role, and a signed-out caller has no
-- auth.uid() to test, so a grant there would widen reach for no behaviour.

-- PROVE IT, don't assume it. A grant that silently no-ops (wrong signature,
-- wrong argument type after an enum rename) would leave the 403 in place.
DO $verify$
DECLARE
  v_acl text;
BEGIN
  SELECT pg_catalog.array_to_string(p.proacl, ' | ')
    INTO v_acl
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'has_role';

  IF v_acl IS NULL THEN
    -- A null ACL is the Postgres default (EXECUTE to PUBLIC), which also
    -- satisfies the requirement. Only an explicit ACL missing `authenticated`
    -- reproduces the 403.
    RETURN;
  END IF;
  IF pg_catalog.strpos(v_acl, 'authenticated=X') = 0 THEN
    RAISE EXCEPTION 'has_role_execute_grant_missing: %', v_acl;
  END IF;
END
$verify$;

-- And RUN it as the role that was failing. CLAUDE.md's third PL/pgSQL rule:
-- checking the catalog proves the grant is recorded; only calling the function
-- through the policy proves the read the customer makes now succeeds.
DO $exercise$
DECLARE
  v_ok boolean;
BEGIN
  SET LOCAL ROLE authenticated;
  SELECT public.has_role('00000000-0000-0000-0000-000000000000'::uuid, 'admin'::public.app_role)
    INTO v_ok;
  RESET ROLE;
  IF v_ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'has_role_unexpected_verdict_for_unknown_user: %', v_ok;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RESET ROLE;
  RAISE EXCEPTION 'has_role_still_denied_to_authenticated';
END
$exercise$;
