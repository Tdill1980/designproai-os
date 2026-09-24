-- ADMIN AND TESTER ARE ALREADY PRIVILEGED. THE EXPORT GATE NEVER LEARNED IT.
--
-- Owner, 2026-09-24: "I need a easier way to bypass paywall and test wallpro
-- qc gate amd download and check files."
--
-- THIS IS NOT A NEW CONCEPT, WHICH IS THE WHOLE REASON IT IS THE RIGHT FIX.
-- `reserve_wallpro_generation` (20260910070849) has treated admin/tester as
-- charge_source 'privileged' since the day private projects landed, and
-- `wallpro_free_generation_reason` (20260915020000) answers 'privileged' for
-- the same two roles. Those accounts DESIGN free today.
--
-- They could not EXPORT. `request_wallpro_production` (20260912130000)
-- requires a row in wallpro_purchase_entitlements on that exact version, and
-- that table is written only by `confirm_wallpro_purchase`, which is
-- service_role-only and driven by a verified Stripe webhook. So the one team
-- that is trusted to spend the model's money for free had to either buy the
-- product or hand-write an entitlement row in the SQL editor every time it
-- wanted to look at the QC gate, the release gate or the print files.
--
-- Same two roles, same predicate, same words as the generation side.
--
-- WHAT THIS DOES NOT DO:
--   * It does not touch the gate for anybody else. A customer with no
--     entitlement still raises wallpro_entitlement_required, and the assertion
--     below fails the migration if that string ever leaves the body.
--   * It does not grant across owners. The function's first guard already
--     raises wallpro_version_not_found unless v.owner_id = auth.uid(), so the
--     predicate reads the CALLER's roles by construction — an admin cannot
--     comp a customer's version with it.
--   * It writes no entitlement row, so the money and the order numbers stay
--     honest: a privileged export is simply an export with no purchase, not a
--     $1 purchase pretending to be one.
--
-- ⚠️ THE PAID PATH IS STILL UNPROVEN AND THIS MAKES IT EASIER TO FORGET.
-- Testing as an admin now never touches Stripe, the webhook or
-- confirm_wallpro_purchase. That is exactly the blind spot that let
-- confirm_designpro_revision_purchase ask for a generation_id column that has
-- never existed: it raised on first evaluation, Stripe took the money, and two
-- entitlements exist in the entire history. One real checkout with a 100%-off
-- promotion code still has to run before the paid path is called good.
--
-- PATCHED, NEVER RESTATED (CLAUDE.md). 20260912130000 owns the live body and
-- 20260916010000 only references it; re-emitting the whole function here would
-- silently revert anything either one established.
DO $wallpro_privileged_export$
DECLARE
  v_definition text;
  v_patched text;
  v_occurrences int;
  v_old constant text := E'  IF NOT EXISTS (SELECT 1 FROM public.wallpro_purchase_entitlements WHERE version_id=p_version_id) THEN\n    RAISE EXCEPTION \'wallpro_entitlement_required\';\n  END IF;\n';
  v_new constant text := E'  -- Admin/tester export free, exactly as they generate free\n  -- (reserve_wallpro_generation, 20260910070849). The owner guard above has\n  -- already refused anything v.owner_id <> auth.uid(), so this reads the\n  -- CALLER\'s own roles and cannot comp another account\'s version.\n  IF NOT EXISTS (SELECT 1 FROM public.wallpro_purchase_entitlements WHERE version_id=p_version_id)\n     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=v.owner_id AND role::text IN (\'admin\',\'tester\')) THEN\n    RAISE EXCEPTION \'wallpro_entitlement_required\';\n  END IF;\n';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.request_wallpro_production(uuid,jsonb)'));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'wallpro_production_target_missing';
  END IF;

  -- Idempotent, and it proves the gate is still there before returning early.
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    IF pg_catalog.strpos(v_definition, 'wallpro_entitlement_required') = 0 THEN
      RAISE EXCEPTION 'wallpro_production_gate_lost';
    END IF;
    IF pg_catalog.strpos(v_definition, '''admin'',''tester''') = 0 THEN
      RAISE EXCEPTION 'wallpro_production_fragment_unrecognised';
    END IF;
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
    / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'wallpro_production_fragment: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- INSPECT THE RESULT, NOT ONLY THE SEARCH STRING. 20260826010000 asserted
  -- all six of its search fragments, passed every one, and still deleted an
  -- ELSIF header it meant to keep.
  IF pg_catalog.strpos(v_patched, 'wallpro_entitlement_required') = 0 THEN
    RAISE EXCEPTION 'wallpro_production_gate_removed';
  END IF;
  IF pg_catalog.strpos(v_patched, 'public.user_roles') = 0
    OR pg_catalog.strpos(v_patched, '''admin'',''tester''') = 0 THEN
    RAISE EXCEPTION 'wallpro_production_privilege_missing';
  END IF;
  -- Every fence 20260912130000 established has to survive verbatim.
  IF pg_catalog.strpos(v_patched, 'wallpro_version_not_found') = 0
    OR pg_catalog.strpos(v_patched, 'wallpro_version_not_approved') = 0
    OR pg_catalog.strpos(v_patched, 'wallpro_production_request_invalid') = 0
    OR pg_catalog.strpos(v_patched, 'v.owner_id<>(SELECT auth.uid())') = 0 THEN
    RAISE EXCEPTION 'wallpro_production_fence_lost';
  END IF;

  EXECUTE v_patched;
END
$wallpro_privileged_export$;
