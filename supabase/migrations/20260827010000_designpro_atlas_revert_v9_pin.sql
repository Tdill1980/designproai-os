-- REVERT the v9-dpag version pin (20260826090000), idempotently.
--
-- The owner halted the v9 ship after that migration had already applied its
-- pin to production, leaving the DB gate demanding a prompt version the live
-- runtime does not emit — which blocks every NEW Call-1 authoring. The pin was
-- reverted live on 2026-08-26 with this exact inverse patch; this migration
-- captures that revert in history so a replayed database converges to the same
-- state. It no-ops when the function already carries the v8 literals.
--
-- Same patch-not-restate mechanism as the forward migration, inverted, with
-- the sibling-refusal survival check preserved.
DO $revert$
DECLARE
  v_definition text;
  v_patched text;
  v_now_prompt constant text := '''designpro-flat-first-atlas-20260826.v9-dpag''';
  v_back_prompt constant text := '''designpro-flat-first-atlas-20260826.v8''';
  v_now_port constant text := '''designpanel-ai-generate.artboard.20260826.v3-vendored''';
  v_back_port constant text := '''designpanel-ai-generate.artboard.20260826.v2''';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'revert_target_missing';
  END IF;
  IF pg_catalog.strpos(v_definition, v_now_prompt) = 0 THEN
    -- Already reverted (production, 2026-08-26) — nothing to do.
    RETURN;
  END IF;
  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_now_prompt, ''))) / pg_catalog.length(v_now_prompt);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'revert_prompt_fragment_not_unique: %', v_occurrences;
  END IF;
  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_now_port, ''))) / pg_catalog.length(v_now_port);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'revert_port_fragment_not_unique: %', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_definition, v_now_prompt, v_back_prompt);
  v_patched := pg_catalog.replace(v_patched, v_now_port, v_back_port);
  IF pg_catalog.strpos(v_patched, v_back_prompt) = 0
    OR pg_catalog.strpos(v_patched, v_now_prompt) > 0
    OR pg_catalog.strpos(v_patched, v_back_port) = 0
    OR pg_catalog.strpos(v_patched, v_now_port) > 0
  THEN
    RAISE EXCEPTION 'revert_substitution_failed';
  END IF;
  IF pg_catalog.strpos(
       v_patched, 'NOT ((v.metadata->''provider'') ? ''driverContentHash'')'
     ) = 0
  THEN
    RAISE EXCEPTION 'revert_sibling_refusal_missing';
  END IF;
  EXECUTE v_patched;
END
$revert$;
