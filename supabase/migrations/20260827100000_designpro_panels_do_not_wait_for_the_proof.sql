-- PANELS AND LOGOS DO NOT WAIT FOR THE 2D PROOF.
--
-- Owner, 2026-08-27: "Nothing in Branch A waits for Branch B... A failed proof
-- never blocks its production panel... PanelPro updates on each extraction...
-- Remove the global predecessor chain and model dependencies per
-- artifact/surface."
--
-- `claim_designpro_stage` admits a stage only when EVERY lower-sequence stage in
-- the run has completed:
--
--   AND NOT EXISTS (SELECT 1 FROM public.designpro_workflow_stages p
--     WHERE p.run_id=s.run_id AND p.sequence<s.sequence
--       AND p.status NOT IN ('completed','skipped'))
--
-- and the claimant is single-flight (`let busy = false`), so the entice chain is
-- strictly serial by construction. `proof.build` sat SECOND. It is Call 8, an AI
-- proof-sheet render, and `panels.build` -- a pure byte promotion of panels Call
-- 1 already cut, hashed and stored, with no AI in it at all -- was queued behind
-- it, with `logos.extract` behind them both. So every panel and every logo the
-- customer sees in PanelPro waited on a documentation artifact.
--
-- THE REAL DEPENDENCIES, read out of the runtime rather than assumed:
--
--   revision.freeze   root
--   panels.build      needs revision.freeze     (reads the revision snapshot)
--   logos.extract     needs panels.build        (stageOutput(run,'panels.build'))
--   panels.delogo     needs logos.extract
--   proof.build       needs revision.freeze     (views + GENIE manifest)
--   pack.verify       needs the 8 / 9 / 10 receipts
--   pack.activate     needs pack.verify
--
-- `proof.build` and the extraction branch share exactly one ancestor and touch
-- nothing of each other's. Moving Call 8 to just before `pack.verify` -- which
-- is the first stage that actually needs its receipt -- preserves every real
-- dependency and lets the panels, the Logo Pack and the de-logoed QC set publish
-- first.
--
-- ⚠️ THIS INVERTS RULE 0.25's CALL NUMBERING, AND THAT IS A JUDGEMENT THE OWNER
-- SHOULD SEE. The rule states the hard order "Design → Extract → Separate/
-- Register logos → Duplicate + de-logo", with Call 8 completing the design
-- before Call 9 extracts. What is preserved is the rule's actual guarantee: the
-- design is frozen at `revision.freeze`, and Call 8 is drawn FROM that frozen
-- lineage. `proof.build`'s own code says so already -- "A.T.L.A.S. is the single
-- design and production authority... The 2D Production Proof is drawn LATER,
-- from that same accepted lineage, as documentation the customer signs" -- which
-- is the same argument that already made a failed Call 8 a recorded deferral
-- instead of a dead run. No panel is cut from the proof, so nothing downstream
-- reads a Call 8 artifact except `pack.verify`, and it still gets its receipt.
--
-- Existing runs are untouched: their stage rows already carry their sequences.
-- This changes what a NEW entice run is scheduled as.
DO $reorder$
DECLARE
  v_definition text;
  v_patched text;
  v_old constant text :=
    E'ARRAY[''revision.freeze'',''proof.build'',''panels.build'',''logos.extract'',''panels.delogo'',''pack.verify'',''pack.activate'']';
  v_new constant text :=
    E'ARRAY[''revision.freeze'',''panels.build'',''logos.extract'',''panels.delogo'',''proof.build'',''pack.verify'',''pack.activate'']';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.create_designpro_entice_workflow(uuid,text,jsonb)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'entice_reorder_target_missing';
  END IF;

  -- Idempotent.
  IF pg_catalog.strpos(v_definition, v_new) > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'entice_reorder_fragment_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- Read what was produced, not only what was searched for.
  IF pg_catalog.strpos(v_patched, v_new) = 0 THEN
    RAISE EXCEPTION 'entice_reorder_substitution_failed';
  END IF;
  -- All seven stages must survive, and the sequence stride with them: dropping
  -- one here would silently un-schedule a whole call.
  IF pg_catalog.strpos(v_patched, 'revision.freeze') = 0
    OR pg_catalog.strpos(v_patched, 'panels.build') = 0
    OR pg_catalog.strpos(v_patched, 'logos.extract') = 0
    OR pg_catalog.strpos(v_patched, 'panels.delogo') = 0
    OR pg_catalog.strpos(v_patched, 'proof.build') = 0
    OR pg_catalog.strpos(v_patched, 'pack.verify') = 0
    OR pg_catalog.strpos(v_patched, 'pack.activate') = 0
    OR pg_catalog.strpos(v_patched, 'v_seq:=v_seq+10') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.entice_pack') = 0
    OR pg_catalog.strpos(v_patched, 'entice_idempotency_identity_conflict') = 0
  THEN
    RAISE EXCEPTION 'entice_reorder_context_lost';
  END IF;
  -- GENIE must not have wandered into the free half while this was edited.
  IF pg_catalog.strpos(v_patched, 'manifest.resolve') > 0
    OR pg_catalog.strpos(v_patched, 'await_purchase') > 0
  THEN
    RAISE EXCEPTION 'entice_reorder_paid_stage_leaked';
  END IF;

  EXECUTE v_patched;
END
$reorder$;

-- EVALUATE THE EXPRESSION THE PATCH INSERTED.
--
-- Calling the function itself would create a real workflow run, so the thing
-- actually verified here is the literal that changed -- evaluated, not merely
-- searched for, which is the lesson 20260826030000 cost. The stage names are
-- also checked against the runtime's own frozen list shape: seven entries, no
-- duplicates, and the extraction branch strictly ahead of the proof.
DO $verify$
DECLARE
  v_stages text[];
BEGIN
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.create_designpro_entice_workflow(uuid,text,jsonb)'
    )), E'ARRAY[''revision.freeze'',''panels.build''') = 0
  THEN
    RAISE EXCEPTION 'entice_reorder_not_installed';
  END IF;

  v_stages := ARRAY['revision.freeze','panels.build','logos.extract','panels.delogo','proof.build','pack.verify','pack.activate'];
  IF pg_catalog.array_length(v_stages, 1) <> 7 THEN
    RAISE EXCEPTION 'entice_reorder_stage_count';
  END IF;
  IF (SELECT pg_catalog.count(DISTINCT s) FROM pg_catalog.unnest(v_stages) AS s) <> 7 THEN
    RAISE EXCEPTION 'entice_reorder_stage_duplicate';
  END IF;
  IF pg_catalog.array_position(v_stages, 'panels.build') > pg_catalog.array_position(v_stages, 'proof.build')
    OR pg_catalog.array_position(v_stages, 'logos.extract') > pg_catalog.array_position(v_stages, 'proof.build')
    OR pg_catalog.array_position(v_stages, 'logos.extract') < pg_catalog.array_position(v_stages, 'panels.build')
    OR pg_catalog.array_position(v_stages, 'proof.build') > pg_catalog.array_position(v_stages, 'pack.verify')
  THEN
    RAISE EXCEPTION 'entice_reorder_dependency_violated';
  END IF;
END
$verify$;
