-- THE GLOBAL PREDECESSOR CHAIN DIES. DEPENDENCIES ARE PER ARTIFACT.
--
-- Owner, 2026-08-27, verbatim: "STOP CALLING THIS A SERIAL DESIGN PIPELINE.
-- DesignProAI ATLAS runtime is a stateful streaming execution graph. Call
-- 1/master is the root node. Each extracted surface emits
-- panel.ready(surfaceKey), immediately enabling that surface's PanelPro
-- publication and 3D-proof node. Independent nodes execute concurrently.
-- Dependencies are per artifact, never global stage order... the
-- claim_designpro_stage predecessor chain is precisely what needs to die
-- because it is implementing a linear state machine where you designed a
-- dependency graph."
--
-- The predicate that implemented the state machine:
--
--   AND NOT EXISTS (SELECT 1 FROM public.designpro_workflow_stages p
--     WHERE p.run_id=s.run_id AND p.sequence<s.sequence
--       AND p.status NOT IN ('completed','skipped'))
--
-- Every stage waited on EVERY lower-numbered stage, related or not. Reordering
-- the entice chain in 20260827100000 got the panels out from behind the 2D
-- proof, but reordering a line is still a line. This makes the edges explicit
-- and lets unrelated nodes run at the same time.
--
-- WHY THIS BUYS REAL CONCURRENCY AND NOT JUST ORDERING FREEDOM: the production
-- compose runs TWO runtime workers (`designpro-worker-1`, `designpro-worker-2`)
-- against a `FOR UPDATE ... SKIP LOCKED` claim, so two runnable nodes are two
-- claims. The runtime's own single-flight guard is lifted in the same cutover
-- (see runtime/designpro-standalone-claimant.cjs) so one worker can hold more
-- than one node too.
--
-- WHAT STAYS SERIAL, ON PURPOSE:
--   * output.build / output.verify / zip.build keep the shared
--     `production-heavy` lease, so they remain mutually exclusive fleet-wide
--     however the graph is shaped. That guard is untouched.
--   * await_panelpro_preflight_qc and await_final_human_qc are still excluded
--     from claiming entirely. Human gates are not nodes a worker may run.
--
-- THE FALLBACK IS A MIGRATION PATH, NOT THE ARCHITECTURE. A stage row created
-- before this migration has no declared edges, and inferring them after the
-- fact would be guessing at a run already in flight. Those rows keep the old
-- sequence semantics until they drain; every row created from here on declares
-- its own edges and the chain never applies to it.

-- ── 1. THE EDGES GET A HOME ────────────────────────────────────────────────
ALTER TABLE public.designpro_workflow_stages
  ADD COLUMN IF NOT EXISTS depends_on text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.designpro_workflow_stages.depends_on IS
  'Stage keys in the same run that must be completed or skipped before this node is runnable. Empty means the legacy sequence barrier applies (pre-2026-08-27 rows only).';

-- ── 2. THE ENTICE GRAPH DECLARES ITS EDGES ─────────────────────────────────
--
-- Read out of the runtime, not assumed:
--   panels.build   reads the revision snapshot          -> revision.freeze
--   logos.extract  reads stageOutput(run,'panels.build') -> panels.build
--   panels.delogo  duplicates and de-logos Call 9        -> logos.extract
--   proof.build    draws Call 8 from the frozen revision -> revision.freeze
--   pack.verify    reads the 8 / 9 / 10 receipts and seals over Call 11
--   pack.activate  seals the pack
--
-- `proof.build` and the extraction branch share exactly one ancestor and touch
-- nothing of each other's, which is the whole point: they are siblings and they
-- run together.
--
-- The patch is ADDITIVE -- one statement inserted before the RETURN -- rather
-- than a rewrite of the FOREACH loop. A smaller edit is a smaller way to be
-- wrong, and it survives 20260827100000 having already changed the stage order
-- inside that loop.
DO $entice$
DECLARE
  v_definition text;
  v_patched text;
  v_anchor constant text :=
    E'  RETURN jsonb_build_object(''workflowRunId'',v_run.id,''revisionId'',v_run.revision_id,''enticePackId'',v_run.entice_pack_id,''status'',v_run.status);';
  v_edges constant text := E'  UPDATE public.designpro_workflow_stages s\n  SET depends_on=d.depends_on\n  FROM (VALUES\n    (''revision.freeze'',''{}''::text[]),\n    (''panels.build'',ARRAY[''revision.freeze'']),\n    (''logos.extract'',ARRAY[''panels.build'']),\n    (''panels.delogo'',ARRAY[''logos.extract'']),\n    (''proof.build'',ARRAY[''revision.freeze'']),\n    (''pack.verify'',ARRAY[''proof.build'',''panels.build'',''logos.extract'',''panels.delogo'']),\n    (''pack.activate'',ARRAY[''pack.verify''])\n  ) AS d(stage_key,depends_on)\n  WHERE s.run_id=v_run.id AND s.stage_key=d.stage_key\n    AND s.status=''pending'' AND s.depends_on=''{}''::text[];\n';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.create_designpro_entice_workflow(uuid,text,jsonb)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'entice_edges_target_missing';
  END IF;

  -- Idempotent.
  IF pg_catalog.strpos(v_definition, 'SET depends_on=d.depends_on') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))) / pg_catalog.length(v_anchor);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'entice_edges_anchor_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_anchor, v_edges || v_anchor);

  -- Read what was produced.
  IF pg_catalog.strpos(v_patched, 'SET depends_on=d.depends_on') = 0
    OR pg_catalog.strpos(v_patched, 'workflowRunId') = 0
    -- Everything 20260827100000 established must survive.
    OR pg_catalog.strpos(v_patched, E'ARRAY[''revision.freeze'',''panels.build''') = 0
    OR pg_catalog.strpos(v_patched, 'entice_idempotency_identity_conflict') = 0
    OR pg_catalog.strpos(v_patched, 'v_seq:=v_seq+10') = 0
  THEN
    RAISE EXCEPTION 'entice_edges_context_lost';
  END IF;

  EXECUTE v_patched;
END
$entice$;

-- ── 3. THE PAID CHAIN DECLARES ITS EDGES TOO ───────────────────────────────
--
-- It really is sequential -- each paid stage consumes what the one before it
-- produced -- so its edges are each stage on the one before. Declaring them
-- explicitly matters anyway: with the edges stated, NO new row relies on the
-- sequence fallback, so the chain is dead everywhere rather than dead in the
-- half that happened to need it.
DO $production$
DECLARE
  v_definition text;
  v_patched text;
  v_anchor constant text :=
    E'  RETURN jsonb_build_object(''workflowRunId'',v_run.id,''sourceEnticeRunId'',v_entice.id,''status'',v_run.status);';
  v_edges constant text := E'  UPDATE public.designpro_workflow_stages s\n  SET depends_on=d.depends_on\n  FROM (VALUES\n    (''await_purchase'',''{}''::text[]),\n    (''manifest.resolve'',ARRAY[''await_purchase'']),\n    (''source.verify'',ARRAY[''manifest.resolve'']),\n    (''await_panelpro_preflight_qc'',ARRAY[''source.verify'']),\n    (''enhance.upscale'',ARRAY[''await_panelpro_preflight_qc'']),\n    (''output.build'',ARRAY[''enhance.upscale'']),\n    (''output.verify'',ARRAY[''output.build'']),\n    (''await_final_human_qc'',ARRAY[''output.verify'']),\n    (''stamp.build'',ARRAY[''await_final_human_qc'']),\n    (''zip.build'',ARRAY[''stamp.build'']),\n    (''wrapbox.deliver'',ARRAY[''zip.build''])\n  ) AS d(stage_key,depends_on)\n  WHERE s.run_id=v_run.id AND s.stage_key=d.stage_key\n    AND s.status=''pending'' AND s.depends_on=''{}''::text[];\n';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.create_designpro_production_workflow(uuid,text,jsonb)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'production_edges_target_missing';
  END IF;

  IF pg_catalog.strpos(v_definition, 'SET depends_on=d.depends_on') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))) / pg_catalog.length(v_anchor);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'production_edges_anchor_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_anchor, v_edges || v_anchor);

  IF pg_catalog.strpos(v_patched, 'SET depends_on=d.depends_on') = 0
    OR pg_catalog.strpos(v_patched, 'active_completed_entice_workflow_required') = 0
    OR pg_catalog.strpos(v_patched, 'production_idempotency_identity_conflict') = 0
    -- GENIE stays behind the purchase gate (RULE 0.19).
    OR pg_catalog.strpos(v_patched, E'''await_purchase'',''manifest.resolve''') = 0
  THEN
    RAISE EXCEPTION 'production_edges_context_lost';
  END IF;

  EXECUTE v_patched;
END
$production$;

-- ── 4. THE CLAIM READS EDGES, NOT LINE NUMBERS ─────────────────────────────
--
-- A node is runnable when the nodes it NAMES are done. A named dependency that
-- does not exist in the run is NOT vacuously satisfied -- it fails closed, so a
-- typo parks a stage instead of releasing it early.
DO $claim$
DECLARE
  v_definition text;
  v_patched text;
  v_old constant text :=
    E'    AND NOT EXISTS (SELECT 1 FROM public.designpro_workflow_stages p WHERE p.run_id=s.run_id AND p.sequence<s.sequence AND p.status NOT IN (''completed'',''skipped''))';
  v_new constant text :=
    E'    AND (CASE\n      WHEN pg_catalog.array_length(s.depends_on,1) IS NULL\n      -- Pre-graph rows only: a run already in flight keeps the semantics it\n      -- started under, because inferring its edges after the fact is guessing.\n      THEN NOT EXISTS (SELECT 1 FROM public.designpro_workflow_stages p WHERE p.run_id=s.run_id AND p.sequence<s.sequence AND p.status NOT IN (''completed'',''skipped''))\n      -- The graph: only the nodes this one names, and each of them must EXIST\n      -- and be finished. A named stage that is absent fails closed.\n      ELSE NOT EXISTS (\n        SELECT 1 FROM pg_catalog.unnest(s.depends_on) AS dep(stage_key)\n        WHERE NOT EXISTS (\n          SELECT 1 FROM public.designpro_workflow_stages p\n          WHERE p.run_id=s.run_id AND p.stage_key=dep.stage_key\n            AND p.status IN (''completed'',''skipped'')\n        )\n      )\n    END)';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.claim_designpro_stage(text,integer)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'claim_graph_target_missing';
  END IF;

  IF pg_catalog.strpos(v_definition, 's.depends_on') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'claim_graph_fragment_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  IF pg_catalog.strpos(v_patched, 's.depends_on') = 0
    OR pg_catalog.strpos(v_patched, 'pg_catalog.unnest(s.depends_on)') = 0
  THEN
    RAISE EXCEPTION 'claim_graph_substitution_failed';
  END IF;
  -- THE GUARDS THAT MUST SURVIVE. The heavy lease keeps the three expensive
  -- stages mutually exclusive fleet-wide; the human gates stay unclaimable;
  -- SKIP LOCKED is what makes two workers two claims instead of a deadlock;
  -- and the attempt ceiling still ends a thrashing stage.
  IF pg_catalog.strpos(v_patched, 'production-heavy') = 0
    OR pg_catalog.strpos(v_patched, 'await_panelpro_preflight_qc'',''await_final_human_qc') = 0
    OR pg_catalog.strpos(v_patched, 'FOR UPDATE OF s SKIP LOCKED LIMIT 1') = 0
    OR pg_catalog.strpos(v_patched, 's.attempt < s.max_attempts') = 0
    OR pg_catalog.strpos(v_patched, 'service_role_required') = 0
    OR pg_catalog.strpos(v_patched, 'pg_advisory_xact_lock') = 0
  THEN
    RAISE EXCEPTION 'claim_graph_context_lost';
  END IF;

  EXECUTE v_patched;
END
$claim$;

-- ── 5. RUN IT, OVER ROWS THAT EXERCISE BOTH BRANCHES ───────────────────────
--
-- A patched predicate nobody evaluates is a patch nobody checked, and a CASE
-- arm nobody reaches compiles the first time it is REACHED, not the first time
-- it is written -- which is the exact defect 20260826030000 cost.
DO $verify$
DECLARE
  v_legacy int;
  v_graph int;
BEGIN
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.claim_designpro_stage(text,integer)'
    )), 'pg_catalog.unnest(s.depends_on)') = 0
  THEN
    RAISE EXCEPTION 'claim_graph_not_installed';
  END IF;

  -- Evaluate BOTH arms of the CASE against real rows, without claiming
  -- anything: the same two predicates the claim uses, run as a plain read.
  SELECT pg_catalog.count(*) INTO v_legacy
  FROM public.designpro_workflow_stages s
  WHERE pg_catalog.array_length(s.depends_on,1) IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.designpro_workflow_stages p
      WHERE p.run_id=s.run_id AND p.sequence<s.sequence
        AND p.status NOT IN ('completed','skipped')
    );

  SELECT pg_catalog.count(*) INTO v_graph
  FROM public.designpro_workflow_stages s
  WHERE pg_catalog.array_length(s.depends_on,1) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.unnest(s.depends_on) AS dep(stage_key)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.designpro_workflow_stages p
        WHERE p.run_id=s.run_id AND p.stage_key=dep.stage_key
          AND p.status IN ('completed','skipped')
      )
    );

  IF v_legacy IS NULL OR v_graph IS NULL THEN
    RAISE EXCEPTION 'claim_graph_predicate_unevaluated';
  END IF;

  -- THE BEHAVIOURAL PROOF LIVES IN pgTAP, NOT HERE, AND FOR A CONCRETE REASON.
  --
  -- A synthetic probe row was written here first. It would have failed the
  -- apply: `designpro_workflow_stages_stage_key_check` enumerates the valid
  -- stage keys, so an invented one is rejected outright, and
  -- `designpro_stage_completion_integrity` refuses status='completed' without
  -- `completed_at` and `verification @> {"verified": true}`. Writing probe rows
  -- into a live production table to prove a predicate was the wrong instinct
  -- twice over.
  --
  -- What is verified above is what a migration can honestly verify: both arms
  -- of the CASE are EVALUATED against real rows, which is what catches the
  -- class of defect 20260826030000 cost -- an expression that parses and then
  -- does not exist. That the graph arm actually gates correctly is proved on a
  -- disposable database, with real stage keys and real fixtures, by
  -- supabase/tests/stage_dependency_graph.test.sql.
END
$verify$;
