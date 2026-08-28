-- THE TABLE CHECK STILL REQUIRED A MANIFEST THE PRODUCTION RUN CANNOT HAVE YET.
--
-- `designpro_run_identity_phase_check` demands, of a `designpro.production_pack`
-- row, `dimension_manifest_id IS NOT NULL` and a hex `manifest_hash` -- at
-- INSERT, before the row has run a single stage.
--
-- That was true when `manifest.resolve` sat in the free half. RULE 0.19 moved it
-- behind `await_purchase`, and the production workflow's FIRST stage is now
-- `await_purchase` itself: it is created at `pack.activate` so it exists,
-- reaches the gate, and stops. `manifest.resolve` binds the manifest afterwards,
-- on the paid side. So the row is created with no manifest, by design, and the
-- constraint refused it.
--
-- Live on run 8e9fab59-d282-4f92-a8aa-86b2f4e1d09e (generation
-- 8555be2f-71fe-4a30-8680-653d086a213e, 2026-08-28). `pack.activate` completed
-- its own receipt and then died inside `ensureAutomaticProduction` on
--
--   new row for relation "designpro_workflow_runs"
--   violates check constraint "designpro_run_identity_phase_check"
--
-- so the entice pack never activated and the production run that waits for the
-- customer's purchase was never created.
--
-- This is the same leftover as 20260828110000, one layer down: the RPC
-- `create_designpro_production_workflow` was already relaxed to require only
-- what the entice run proves (a completed pack.activate and its immutable
-- source/artifact identity). The CHECK was not moved with it.
--
-- WHAT IS NOT RELAXED. Source and artifact identity stay REQUIRED on a
-- production run -- both hex, both present -- because the entice run proves
-- both and a production run without them has no lineage. Only the manifest pair
-- becomes "both null or both set", which is exactly the rule the entice branch
-- has always had. Nothing downstream can proceed without the manifest anyway:
-- `manifest.resolve` binds it, and `source.verify`, `enhance.upscale` and
-- `output.build` all require it. The window this opens is precisely the one
-- between creation and purchase, where there is nothing to build.
--
-- Every existing row satisfies the new form -- it is strictly weaker on one
-- pair and identical everywhere else -- so this validates without a rewrite.

ALTER TABLE public.designpro_workflow_runs
  DROP CONSTRAINT IF EXISTS designpro_run_identity_phase_check;

ALTER TABLE public.designpro_workflow_runs
  ADD CONSTRAINT designpro_run_identity_phase_check CHECK (
    revision_snapshot_hash IS NOT NULL
    AND revision_snapshot_hash ~ '^[0-9a-f]{64}$'
    AND (
      (
        workflow_type = 'designpro.entice_pack'
        AND (
          (dimension_manifest_id IS NULL AND manifest_hash IS NULL)
          OR (dimension_manifest_id IS NOT NULL AND manifest_hash ~ '^[0-9a-f]{64}$')
        )
        AND (
          (source_contract_hash IS NULL AND artifact_set_hash IS NULL)
          OR (source_contract_hash ~ '^[0-9a-f]{64}$'
              AND artifact_set_hash ~ '^[0-9a-f]{64}$')
        )
      )
      OR (
        workflow_type = 'designpro.production_pack'
        -- The manifest arrives at manifest.resolve, which sits AFTER
        -- await_purchase (RULE 0.19). Before then the pair is legitimately
        -- absent; it may never be half-present.
        AND (
          (dimension_manifest_id IS NULL AND manifest_hash IS NULL)
          OR (dimension_manifest_id IS NOT NULL AND manifest_hash ~ '^[0-9a-f]{64}$')
        )
        -- Source and artifact identity come from the entice run that created
        -- this one, so they are required from the first row.
        AND source_contract_hash ~ '^[0-9a-f]{64}$'
        AND artifact_set_hash ~ '^[0-9a-f]{64}$'
      )
    )
  );

-- Assert the constraint that is now installed says both halves of this.
--
-- Not a write test: a CHECK is only ever exercised by an INSERT, and every
-- INSERT into this table needs a real revision behind it (foreign keys, the
-- snapshot contract, the immutability guard), so a synthetic row fails on
-- something else long before the CHECK is consulted -- which would prove
-- nothing while looking like proof. The real exercise is the production run
-- this migration exists to let `pack.activate` create.
DO $assert$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'designpro_workflow_runs'
    AND c.conname = 'designpro_run_identity_phase_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'production_run_identity_check_missing';
  END IF;

  -- The production branch must no longer demand a manifest at insert...
  IF pg_catalog.strpos(v_def, '(dimension_manifest_id IS NOT NULL) AND (source_contract_hash') > 0 THEN
    RAISE EXCEPTION 'production_run_still_demands_a_manifest';
  END IF;
  -- ...both branches must carry the same manifest-pair rule, so it reads twice
  -- and never half-present in either.
  IF (pg_catalog.length(v_def)
      - pg_catalog.length(pg_catalog.replace(v_def,
          '(dimension_manifest_id IS NULL) AND (manifest_hash IS NULL)', '')))
     / pg_catalog.length('(dimension_manifest_id IS NULL) AND (manifest_hash IS NULL)') <> 2
  THEN
    RAISE EXCEPTION 'production_run_manifest_pair_rule_not_shared';
  END IF;
  -- ...and source/artifact identity must still be REQUIRED of a production run,
  -- unconditionally. That is the lineage from the entice run that created it,
  -- and it is not what this migration relaxes.
  -- Counted, not merely present: the entice branch carries the same pair, so a
  -- single occurrence would be satisfied by the OTHER branch and prove nothing.
  IF (pg_catalog.length(v_def)
      - pg_catalog.length(pg_catalog.replace(v_def,
          '(source_contract_hash ~ ''^[0-9a-f]{64}$''::text) AND (artifact_set_hash ~ ''^[0-9a-f]{64}$''::text)', '')))
     / pg_catalog.length('(source_contract_hash ~ ''^[0-9a-f]{64}$''::text) AND (artifact_set_hash ~ ''^[0-9a-f]{64}$''::text)') <> 2
  THEN
    RAISE EXCEPTION 'production_run_lineage_identity_no_longer_required';
  END IF;
  IF pg_catalog.strpos(v_def, 'designpro.production_pack') = 0
    OR pg_catalog.strpos(v_def, 'designpro.entice_pack') = 0
  THEN
    RAISE EXCEPTION 'production_run_workflow_branches_lost';
  END IF;
END
$assert$;
