-- THE FREE PACK CANNOT BIND A MANIFEST GENIE DOES NOT RESOLVE UNTIL PURCHASE.
--
-- `pack.verify` demanded `v_run.dimension_manifest_id` and `v_run.manifest_hash`
-- before it would accept the entice pack. RULE 0.19 moved `manifest.resolve`
-- AFTER `await_purchase` -- deliberately, because it waits on a human validating
-- a real vehicle, and one run sat parked sixteen hours in front of the whole
-- free half on 2026-08-23. So on every A.T.L.A.S. entice run since, those two
-- columns are NULL by design and this predicate could never pass.
--
-- Live on run 8e9fab59-d282-4f92-a8aa-86b2f4e1d09e (generation
-- 8555be2f-71fe-4a30-8680-653d086a213e, 2026-08-28). Every earlier stage had
-- completed: six Call-1 panels promoted, the logo inventory extracted, six
-- de-logoed QC duplicates cut. `pack.verify` then raised
-- `finalized_entice_identity_required` on
--
--   dimension_manifest_id  NULL      <- GENIE has not deployed; it will not
--   manifest_hash          NULL         until the pack is ordered
--   source_contract_hash   9df96d59…  present
--   artifact_set_hash      7eafb205…  present
--   results ? packReceipt  true       present
--
-- so `pack.activate` never ran, the run terminated failed, and the entice pack
-- the customer is enticed with did not exist.
--
-- THIS IS NOT A RELAXATION OF THE PAID HALF. `source.verify`, `enhance.upscale`
-- and `output.build` still require the validated GENIE manifest, unchanged --
-- production geometry is what they exist to certify. What changes is only that
-- the FREE pack is verified against the geometry it was actually built from:
-- Call 1 resolves each side's design-time size, cuts the six panels to it with
-- the 5" bleed already in the layout, and `panels.build` promotes those exact
-- bytes. That receipt is the evidence, so the exemption is conditioned on it
-- (`promotedFrom = 'atlas-call1'`) rather than on the workflow type: a run with
-- no A.T.L.A.S. panel set still has to bind a manifest, because it has nothing
-- else that fixes its geometry.
--
-- PATCH, DO NOT RESTATE. `complete_designpro_stage` carries a stack of earlier
-- text patches (20260822090000, 20260826010000, 20260826060000); re-emitting the
-- whole body reproduces whichever definition the author copied and silently
-- reverts every one of them. The replacement below asserts its fragment occurs
-- EXACTLY ONCE before substituting, and re-checks the result afterwards --
-- 20260826010000 passed all six of its input assertions while deleting a branch
-- header it meant to keep, so validating the inputs proves only that the text
-- was found, never that valid code was left behind.
DO $free_pack$
DECLARE
  v_definition text;
  v_patched text;
  v_occurrences int;

  v_old constant text := E'  IF v_stage.stage_key=''pack.verify'' AND (\n    v_run.dimension_manifest_id IS NULL OR v_run.manifest_hash IS NULL OR v_run.source_contract_hash IS NULL OR v_run.artifact_set_hash IS NULL\n    OR NOT (v_run.results ? ''packReceipt'')\n  ) THEN RAISE EXCEPTION ''finalized_entice_identity_required''; END IF;';

  v_new constant text := E'  IF v_stage.stage_key=''pack.verify'' AND (\n    v_run.source_contract_hash IS NULL OR v_run.artifact_set_hash IS NULL\n    OR NOT (v_run.results ? ''packReceipt'')\n    -- GENIE DEPLOYS ON ORDER (RULE 0.19), so the FREE pack has no validated\n    -- production manifest to bind: manifest.resolve sits after await_purchase.\n    -- An A.T.L.A.S. entice run is verified against the geometry it was built\n    -- from instead -- Call 1 resolved the design-time size of each side and cut the\n    -- six panels to it, and panels.build promoted those exact bytes. The paid\n    -- half is untouched: source.verify and output.build still require the\n    -- manifest. A run with no A.T.L.A.S. panel set still must bind one.\n    OR ((v_run.dimension_manifest_id IS NULL OR v_run.manifest_hash IS NULL)\n      AND NOT EXISTS(\n        SELECT 1 FROM public.designpro_workflow_stages p\n        WHERE p.run_id=v_run.id AND p.stage_key=''panels.build''\n          AND p.status=''completed''\n          AND p.output->>''promotedFrom''=''atlas-call1''))\n  ) THEN RAISE EXCEPTION ''finalized_entice_identity_required''; END IF;';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'free_pack_gate_target_missing';
  END IF;

  -- Idempotent.
  IF pg_catalog.strpos(v_definition, 'promotedFrom') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
    / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'free_pack_gate_fragment: %', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- The gate must still exist, and still be the pack.verify gate.
  IF pg_catalog.strpos(v_patched, 'finalized_entice_identity_required') = 0
    OR pg_catalog.strpos(v_patched, 'verified_entice_pack_required_for_activation') = 0
    OR pg_catalog.strpos(v_patched, 'call9_panel_artifact_set_incomplete') = 0
    OR pg_catalog.strpos(v_patched, 'call8_proof_artifact_required') = 0
  THEN
    RAISE EXCEPTION 'free_pack_gate_lost_a_neighbour';
  END IF;
  -- And the exemption must be conditional, never a blanket removal.
  IF pg_catalog.strpos(v_patched, 'v_run.dimension_manifest_id IS NULL') = 0
    OR pg_catalog.strpos(v_patched, 'atlas-call1') = 0
  THEN
    RAISE EXCEPTION 'free_pack_gate_exemption_unconditional';
  END IF;

  EXECUTE v_patched;
END
$free_pack$;

-- Call the patched function once, so it is not merely installed.
--
-- This proves the body PARSES and its guards are reachable. It does NOT reach
-- pack.verify -- a stage id that does not exist is refused long before it -- so
-- it is not evidence the new branch evaluates. That distinction is the whole
-- lesson of 20260826030000, which shipped `pg_catalog.coalesce(...)` through
-- shadow AND production because PL/pgSQL compiles an expression the first time
-- it is EVALUATED, and only raised for the rows that actually reached it. What
-- makes that class unreachable here is the shape of the new predicate, not this
-- check: it uses no qualified grammar, only `->>`, `IS NULL` and an EXISTS over
-- a fully-qualified table. The branch itself is exercised for real by
-- supabase/tests, and by the run this migration exists for.
DO $exercise$
DECLARE
  v_refused boolean := false;
BEGIN
  BEGIN
    PERFORM public.complete_designpro_stage(
      p_stage_id => '00000000-0000-0000-0000-000000000000'::uuid,
      p_lease_token => '00000000-0000-0000-0000-000000000000'::uuid,
      p_identity => '{}'::jsonb,
      p_receipt => '{}'::jsonb,
      p_receipt_hash => pg_catalog.repeat('0', 64),
      p_artifacts => '[]'::jsonb);
  EXCEPTION WHEN others THEN
    -- Any refusal is fine: the point is that the function COMPILES and reaches
    -- its guards. A stage that does not exist is refused long before
    -- pack.verify, and that is the expected path here.
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'free_pack_gate_accepted_a_nonexistent_stage';
  END IF;
END
$exercise$;
