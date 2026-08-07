-- Intentionally empty of identities and geometry.
--
-- Production operators are granted only after an Auth user exists and its
-- email is confirmed, through:
--   designpro_private.bootstrap_operator_by_email(...)
--
-- Universal GENIE rows are imported as unverified candidates through:
--   designpro_private.import_genie_candidate_catalog(...)
-- Exact six-surface geometry is then approved by an authenticated PanelPro
-- member. No fixed UUID, email, secret, or guessed vehicle dimension belongs
-- in a seed file.

DO $seed_contract$
BEGIN
  IF to_regclass('public.designpro_vehicle_specs_universal') IS NULL
    OR to_regprocedure(
      'public.validate_designpro_vehicle_spec_universal(uuid,jsonb,text,jsonb)'
    ) IS NULL
  THEN
    RAISE EXCEPTION 'designpro_schema_migrations_must_run_before_seed';
  END IF;
END
$seed_contract$;

