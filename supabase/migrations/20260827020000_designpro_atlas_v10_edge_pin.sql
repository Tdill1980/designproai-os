-- PIN THE GATE TO v10-edge — ⚠️ APPLY ONLY IN THE SAME CUTOVER AS THE v10
-- RUNTIME. The deployed runtime that emits these versions is the one that
-- POSTs Call 1 to the design-panel-ai-generate edge function (owner directive
-- 2026-08-27). Applying this while the droplet still serves the v8 runtime
-- re-creates the exact half-state the v9 pin caused on 2026-08-26 (gate
-- demanding a version the runtime does not emit → every NEW Call-1 authoring
-- refused). Ship order: dispatch this migration and the v10 dark deploy in one
-- window, runtime first when they cannot be simultaneous.
--
-- Patch-not-restate, exact-fragment asserts, sibling-refusal survival check —
-- the same mechanism as 20260826090000/20260827010000.
DO $pin$
DECLARE
  v_definition text;
  v_patched text;
  v_old_prompt constant text := '''designpro-flat-first-atlas-20260826.v8''';
  v_new_prompt constant text := '''designpro-flat-first-atlas-20260827.v10-edge''';
  v_old_port constant text := '''designpanel-ai-generate.artboard.20260826.v2''';
  v_new_port constant text := '''designpanel-ai-generate.artboard.20260827.v4-edge''';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'v10_pin_target_missing';
  END IF;
  IF pg_catalog.strpos(v_definition, v_new_prompt) > 0 THEN
    RETURN; -- already pinned
  END IF;
  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_prompt, ''))) / pg_catalog.length(v_old_prompt);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'v10_pin_prompt_fragment_not_unique: %', v_occurrences;
  END IF;
  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_port, ''))) / pg_catalog.length(v_old_port);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'v10_pin_port_fragment_not_unique: %', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_definition, v_old_prompt, v_new_prompt);
  v_patched := pg_catalog.replace(v_patched, v_old_port, v_new_port);
  IF pg_catalog.strpos(v_patched, v_new_prompt) = 0
    OR pg_catalog.strpos(v_patched, v_old_prompt) > 0
    OR pg_catalog.strpos(v_patched, v_new_port) = 0
    OR pg_catalog.strpos(v_patched, v_old_port) > 0
  THEN
    RAISE EXCEPTION 'v10_pin_substitution_failed';
  END IF;
  IF pg_catalog.strpos(
       v_patched, 'NOT ((v.metadata->''provider'') ? ''driverContentHash'')'
     ) = 0
  THEN
    RAISE EXCEPTION 'v10_pin_sibling_refusal_missing';
  END IF;
  EXECUTE v_patched;
END
$pin$;
