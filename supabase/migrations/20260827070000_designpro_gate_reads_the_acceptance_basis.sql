-- THE GATE MUST READ WHAT ACTUALLY DECIDED THE MASTER.
--
-- 2026-08-27 took the semantic judge off the customer's critical path: the
-- deterministic pixel gate decides whether a master is allowed to exist, and the
-- judge's verdict is recorded and FLAGS but never blocks (owner: "If semantic QC
-- finds something catastrophic, flag the job. But don't automatically make every
-- customer wait through three judge cycles").
--
-- The runtime changed. This predicate did not:
--
--   OR NOT (CASE
--     WHEN jsonb_typeof(metadata->'masterQcConfidence')='number'
--     THEN (metadata->>'masterQcConfidence')::numeric>=0.92
--     ELSE false
--   END)
--
-- So the verdict stopped gating and its CONFIDENCE kept gating. Live, canary
-- 1a424bf5 (2026-08-27 10:01): the deterministic gate accepted the master, the
-- panels were cut, and the judge came back with `confidence: 0`. 0 < 0.92, so
-- the view set was invalid, so the lineage was invalid, and the run died 68
-- seconds in with
--
--   generation_atlas_lineage_invalid: A.T.L.A.S. proof lineage is invalid:
--   flattened master did not pass the current DesignPanel authoring/QC contract
--
-- which is the exact divergence CLAUDE.md's SHIP ORDER rule names: "the DB gate
-- must learn <the contract> in the same cutover as the runtime that emits it --
-- runner and gate may not diverge across a customer-visible window again." It
-- diverged, and this closes it.
--
-- THE FIX IS NOT TO DROP THE CHECK. It is to let the gate read the basis the
-- master was ACTUALLY accepted on. Two provable statements, either of which
-- means "a gate passed this master":
--
--   * metadata->>'masterAcceptance' = 'deterministic'
--       -- written by the runtime that ran the deterministic gate. A master that
--       -- FAILS that gate is never persisted at all, so this field can only
--       -- exist on a master that passed one.
--   * the old numeric confidence >= 0.92
--       -- every revision authored before the acceptance basis was recorded.
--       -- Keeping it is owner protection #1: historical generations stay
--       -- readable, viewable and downloadable.
--
-- Nothing is loosened for a master that failed. `masterQcPassed` must still be
-- true, the QC contract must still be named, the prompt version must still
-- match, and every per-view assertion below is untouched.
DO $basis$
DECLARE
  v_definition text;
  v_patched text;
  v_old constant text :=
    E'    OR NOT (CASE\n      WHEN pg_catalog.jsonb_typeof(v_atlas.metadata->''masterQcConfidence'')=''number''\n      THEN (v_atlas.metadata->>''masterQcConfidence'')::numeric>=0.92\n      ELSE false\n    END)';
  v_new constant text :=
    E'    OR NOT (\n      v_atlas.metadata->>''masterAcceptance'' = ''deterministic''\n      OR (CASE\n        WHEN pg_catalog.jsonb_typeof(v_atlas.metadata->''masterQcConfidence'')=''number''\n        THEN (v_atlas.metadata->>''masterQcConfidence'')::numeric>=0.92\n        ELSE false\n      END)\n    )';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'acceptance_basis_target_missing';
  END IF;

  -- Idempotent.
  IF pg_catalog.strpos(v_definition, 'masterAcceptance') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'acceptance_basis_fragment_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- Read what was produced, not only what was searched for.
  IF pg_catalog.strpos(v_patched, 'masterAcceptance') = 0
    OR pg_catalog.strpos(v_patched, '>=0.92') = 0
  THEN
    RAISE EXCEPTION 'acceptance_basis_substitution_failed';
  END IF;
  -- The rest of the master contract, and the partial-set rule that shipped
  -- alongside it, must survive intact.
  IF pg_catalog.strpos(v_patched, 'designpro-flat-first-atlas-20260827.v10-edge') = 0
    OR pg_catalog.strpos(v_patched, 'masterQcPassed') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-master-semantic-qc.v1') = 0
    OR pg_catalog.strpos(v_patched, 'v_valid_count=v_count') = 0
    OR pg_catalog.strpos(v_patched, 'atlasZoneContentHash') = 0
    OR pg_catalog.strpos(v_patched, 'anchoredToView1') = 0
  THEN
    RAISE EXCEPTION 'acceptance_basis_context_lost';
  END IF;

  EXECUTE v_patched;
END
$basis$;

-- RUN IT. A patched body nobody calls is a patch nobody checked.
DO $verify$
DECLARE
  v_request uuid;
  v_valid boolean;
BEGIN
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'designpro_private.flat_first_atlas_view_set_valid(uuid)'
    )), 'masterAcceptance') = 0
  THEN
    RAISE EXCEPTION 'acceptance_basis_not_installed';
  END IF;

  SELECT r.id INTO v_request
  FROM public.designpro_generation_requests r
  WHERE r.request_input->>'pipelineMode' = 'flat-first-atlas-v1'
    AND EXISTS (
      SELECT 1 FROM public.designpro_generation_views v
      WHERE v.request_id = r.id AND v.superseded_at IS NULL
    )
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_request IS NULL THEN
    RETURN;
  END IF;

  v_valid := designpro_private.flat_first_atlas_view_set_valid(v_request);
  IF v_valid IS NULL THEN
    RAISE EXCEPTION 'acceptance_basis_returned_null';
  END IF;
  PERFORM designpro_private.flat_first_atlas_requires_new_run(v_request);
END
$verify$;
