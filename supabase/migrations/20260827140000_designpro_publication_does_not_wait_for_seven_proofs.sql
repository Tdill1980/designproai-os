-- THE SECOND GATE. (Trish 2026-08-27)
--
-- Owner: "Your newer migrations may say 'panels do not wait for proofs,' but
-- the active runtime/read-model path is still routing through an older global
-- barrier... `seven_generation_views_required` may govern proof-set
-- completeness or legacy Call-8 behavior, but it must never sit in front of
-- panel publication."
--
-- She was right, and the two gates are CONSECUTIVE STATEMENTS in
-- `handoff_designpro_generation_to_production`:
--
--   -- Gate 1, relaxed by 20260827120000 to master acceptance:
--   IF v_row.state<>'outputs_ready' THEN
--     IF contractVersion='...v3' THEN
--       IF NOT EXISTS (masterQcPassed='true') THEN RAISE ...
--
--   -- Gate 2, untouched, one line later, reimposing the barrier:
--   v_handoff := designpro_private.calls_1_7_handoff_state(v_row.id);
--   IF (v_handoff->>'handoffReady')<>'true' THEN RAISE ...
--
-- `calls_1_7_handoff_state` hard-checks `v_count <> 7`. So the earlier
-- migration's title was true and its effect was nil. Measured live:
--
--   489369c4  outputs_ready, master accepted, 6 panels, 5 views -> BLOCKED
--   f3eb40c1  master accepted, 6 panels, 5 views                -> BLOCKED
--
-- and no workflow row has been created on this project since 2026-08-25, which
-- is why `logos.extract` has never run for any generation.
--
-- The extraction branch depends on the accepted master and nothing else. Seven
-- views remain required for a STANDARD request, which has no master and no
-- panels, and for proof-set completeness reporting -- never for publication.
DO $patch$
DECLARE
  v_src text;
  v_new text;
  v_needle constant text := '  v_handoff:=designpro_private.calls_1_7_handoff_state(v_row.id);
  IF (v_handoff->>''handoffReady'')<>''true'' THEN
    RAISE EXCEPTION ''generation_handoff_blocked: %'',
      COALESCE(v_handoff->>''handoffBlocker'',''unknown'');
  END IF;';
  v_replacement constant text := '  v_handoff:=designpro_private.calls_1_7_handoff_state(v_row.id);
  -- A FLAT-FIRST REQUEST PUBLISHES ON MASTER ACCEPTANCE. The six panels are
  -- deterministic children of the accepted A.T.L.A.S. master; a proof that
  -- failed is a proof that failed, and it may not withhold a panel that
  -- already exists. Gate 1 above proved the master; this gate would prove the
  -- proofs, which is not what publication depends on.
  IF (v_handoff->>''handoffReady'')<>''true''
    AND NOT (
      v_row.request_input->>''contractVersion''=''designpro.calls-1-7-input.v3''
      AND EXISTS (
        SELECT 1 FROM public.designpro_flat_atlas_revisions a
        WHERE a.request_id=v_row.id
          AND COALESCE(a.metadata->>''masterQcPassed'','''')=''true''
      )
    )
  THEN
    RAISE EXCEPTION ''generation_handoff_blocked: %'',
      COALESCE(v_handoff->>''handoffBlocker'',''unknown'');
  END IF;';
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid) INTO v_src
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'handoff_designpro_generation_to_production';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'handoff_designpro_generation_to_production is missing';
  END IF;

  IF pg_catalog.strpos(v_src, 'A FLAT-FIRST REQUEST PUBLISHES ON MASTER ACCEPTANCE') > 0
  THEN
    RETURN;  -- already patched
  END IF;

  IF (pg_catalog.length(v_src) - pg_catalog.length(
        pg_catalog.replace(v_src, v_needle, ''))
     ) / pg_catalog.length(v_needle) <> 1
  THEN
    RAISE EXCEPTION 'expected exactly one seven-view handoff gate to patch';
  END IF;

  v_new := pg_catalog.replace(v_src, v_needle, v_replacement);

  -- Inspect the produced body, not only the search string.
  IF pg_catalog.strpos(v_new, 'A FLAT-FIRST REQUEST PUBLISHES ON MASTER ACCEPTANCE') = 0
    OR pg_catalog.strpos(v_new, 'generation_handoff_revision_missing') = 0
    OR pg_catalog.strpos(v_new, 'create_designpro_entice_workflow') = 0
    OR pg_catalog.strpos(v_new, 'generation_handoff_identity_conflict') = 0
  THEN
    RAISE EXCEPTION 'patched body lost a required fragment';
  END IF;

  EXECUTE v_new;
END
$patch$;
