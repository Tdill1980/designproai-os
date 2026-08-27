-- LOGO/ASSET EXTRACTION RUNS OFF THE MASTER, NOT OFF ALL SEVEN PROOFS.
--
-- Owner, 2026-08-27, final graph directive: "For logo/assets, use the earliest
-- authoritative source already produced by Call 1 / extracted panels and run it
-- independently. It must not wait for all proofs... The graph contract is
-- already decided... Do not stop again because an old rule describes the
-- obsolete serial architecture. Update the rule/contract to the graph
-- architecture and continue."
--
-- 20260827100000 and 20260827110000 already made `logos.extract` depend only
-- on `panels.build` INSIDE the entice workflow. That work was real but
-- insufficient: the entice workflow -- the row that contains panels.build and
-- logos.extract at all -- is not created until
-- `handoff_designpro_generation_to_production` runs, and that function has
-- gated on:
--
--   IF v_row.state<>'outputs_ready' THEN RAISE EXCEPTION 'generation_outputs_not_ready'; END IF;
--
-- `outputs_ready` is set by the generation ENGINE only when EVERY one of the
-- seven proof slots is accepted (generation-engine.cjs:
-- `allAccepted = results.every(item => item.state === "accepted")`). So the
-- entire extraction branch -- panels.build AND logos.extract -- waited for the
-- LAST 3D proof to land before it could even be scheduled. That is the global
-- barrier the graph forbids, one layer higher than the one already removed.
--
-- THIS IS NOT A NEW INVENTION. It is the same principle already shipped twice:
-- `revision.freeze` tolerates a short view set when ATLAS panels exist, and
-- `designpro_flat_first_handoff_gate` (read-only, STABLE) already defines
-- production eligibility from MASTER acceptance alone --
--
--   v_master_accepted := v_atlas.id IS NOT NULL
--     AND COALESCE(v_atlas.metadata->>'masterQcPassed','') = 'true'
--     AND COALESCE(v_atlas.metadata->>'masterQcContract','')
--         = 'designpro.atlas-master-semantic-qc.v1';
--
-- -- but the RPC that actually CREATES the workflow never consulted it, so the
-- read-only status the customer's progress page already trusted and the
-- write path that gated the workflow disagreed.
--
-- A STANDARD (non-flat-first) request is UNCHANGED: it has no ATLAS master and
-- no panels to extract logos from, so `outputs_ready` remains its only gate,
-- exactly as RULE 0.25's DESIGNID COMPLETION CONTRACT still requires for it.
DO $handoff$
DECLARE
  v_definition text;
  v_patched text;
  v_old constant text :=
    E'  IF v_row.state<>''outputs_ready''\n  THEN RAISE EXCEPTION ''generation_outputs_not_ready''; END IF;';
  v_new constant text :=
    E'  -- A FLAT-FIRST REQUEST MAY HAND OFF ON MASTER ACCEPTANCE ALONE.\n  --\n  -- The extraction branch (panels + logos) depends only on the accepted\n  -- A.T.L.A.S. master, never on the seven proofs -- so requiring\n  -- ''outputs_ready'' here was a global barrier one layer above the one\n  -- `claim_designpro_stage`''s predecessor chain already had removed. This\n  -- reads the SAME evidence `designpro_flat_first_handoff_gate` already reports\n  -- as production-eligible, so the read-only status a customer sees and the\n  -- write path that actually creates the workflow can no longer disagree.\n  --\n  -- A Standard (non-flat-first) request has no master and no panels to extract\n  -- anything from, so it keeps requiring `outputs_ready` exactly as before.\n  IF v_row.state<>''outputs_ready'' THEN\n    IF v_row.request_input->>''contractVersion''=''designpro.calls-1-7-input.v3'' THEN\n      IF NOT EXISTS (\n        SELECT 1 FROM public.designpro_flat_atlas_revisions a\n        WHERE a.request_id=v_row.id\n          AND COALESCE(a.metadata->>''masterQcPassed'','''')=''true''\n      ) THEN\n        RAISE EXCEPTION ''generation_outputs_not_ready'';\n      END IF;\n    ELSE\n      RAISE EXCEPTION ''generation_outputs_not_ready'';\n    END IF;\n  END IF;';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.handoff_designpro_generation_to_production(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'logo_handoff_target_missing';
  END IF;

  -- Idempotent.
  IF pg_catalog.strpos(v_definition, 'A FLAT-FIRST REQUEST MAY HAND OFF ON MASTER ACCEPTANCE ALONE') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'logo_handoff_fragment_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- Read what was produced.
  IF pg_catalog.strpos(v_patched, 'A FLAT-FIRST REQUEST MAY HAND OFF ON MASTER ACCEPTANCE ALONE') = 0
    OR pg_catalog.strpos(v_patched, 'masterQcPassed') = 0
    OR pg_catalog.strpos(v_patched, 'designpro_flat_atlas_revisions') = 0
  THEN
    RAISE EXCEPTION 'logo_handoff_substitution_failed';
  END IF;
  -- Every guard downstream must survive: ownership, the handoff-state check,
  -- the revision-id requirement, and every field the workflow creation needs.
  IF pg_catalog.strpos(v_patched, 'generation_request_not_visible') = 0
    OR pg_catalog.strpos(v_patched, 'calls_1_7_handoff_state') = 0
    OR pg_catalog.strpos(v_patched, 'generation_handoff_revision_missing') = 0
    OR pg_catalog.strpos(v_patched, 'create_designpro_entice_workflow') = 0
    OR pg_catalog.strpos(v_patched, 'authentication_required') = 0
  THEN
    RAISE EXCEPTION 'logo_handoff_context_lost';
  END IF;

  EXECUTE v_patched;
END
$handoff$;

-- RUN IT. A patched body nobody calls is a patch nobody checked.
DO $verify$
BEGIN
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.handoff_designpro_generation_to_production(uuid)'
    )), 'A FLAT-FIRST REQUEST MAY HAND OFF ON MASTER ACCEPTANCE ALONE') = 0
  THEN
    RAISE EXCEPTION 'logo_handoff_not_installed';
  END IF;
END
$verify$;
