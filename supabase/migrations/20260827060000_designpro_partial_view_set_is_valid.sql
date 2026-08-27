-- A SHORT PROOF SET IS NOT AN INVALID LINEAGE.
--
-- The fourth hardcoded seven, and the one that actually reached the customer.
--
--   designpro_private.flat_first_atlas_view_set_valid  ends with
--     RETURN v_count=7 AND v_source_count=7 AND v_role_count=7
--        AND v_hash_count=7 AND v_valid_count=7;
--
-- so a run that completed with five accepted views returns false. That makes
-- `flat_first_atlas_requires_new_run` true (the state IS outputs_ready), which
-- makes `designpro_generation_view_paths` RAISE, which the gateway turns into a
-- 409 `flat_first_atlas_new_run_required` -- on the READ. The customer's own
-- design becomes unreadable, and the browser, unable to recover a single view,
-- shows "This saved proof set cannot be reused. Start a new Precision run."
--
-- Live, canary 3c58853b (2026-08-27 09:53, build af31e29): master accepted,
-- GENIE catalog geometry at the measured 251x60, six panels cut, FIVE views
-- accepted including Driver -- and that screen.
--
-- The count was doing two jobs at once. Everything ELSE this function checks is
-- per-view and stays exactly as it is: prompt version, master QC verdict and
-- confidence, provider/studio/view-angle/photography contract versions, the
-- atlas master/projection/manifest hashes, the revision id and sequence, the
-- zone contract and per-surface zone hash, the proof-QC validation block, and
-- the four negative assertions that stop a view inheriting identity from
-- another render. A view that passes all of that IS anchored to this master.
--
-- What the count added on top was ALL-OR-NOTHING, and that is the part the
-- owner's rule removes: "A failed Close-Up cannot cancel
-- Driver/Passenger/Front/Rear/Roof artifacts."
--
-- So the four distinct-counts become RELATIVE to what was delivered -- every
-- view present is valid, no two share a source type, a role or a byte -- and
-- the set must be non-empty and no larger than the plan. A full run is
-- unchanged in every respect: seven delivered means all five equalities read 7,
-- exactly as before.
--
-- A genuinely invalid lineage is still refused, by the checks ABOVE this
-- return: a stale prompt version, a master that never passed QC, a view
-- anchored to a different master. That is what the 409 exists for, and it still
-- fires. Locked by supabase/tests/atlas_partial_view_set.test.sql.
DO $partial$
DECLARE
  v_definition text;
  v_patched text;
  v_old constant text :=
    E'  RETURN v_count=7\n    AND v_source_count=7\n    AND v_role_count=7\n    AND v_hash_count=7\n    AND v_valid_count=7;';
  v_new constant text :=
    E'  RETURN v_count BETWEEN 1 AND 7\n    AND v_source_count=v_count\n    AND v_role_count=v_count\n    AND v_hash_count=v_count\n    AND v_valid_count=v_count;';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'partial_view_set_target_missing';
  END IF;

  -- Idempotent.
  IF pg_catalog.strpos(v_definition, 'v_valid_count=v_count') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'partial_view_set_fragment_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- COUNT WHAT SURVIVED, don't just confirm the search string was found. The
  -- 20260827030000 half-patch is why this style exists: there, a second raise
  -- site shared the exception name and the fragment counter could not see it.
  IF pg_catalog.strpos(v_patched, 'v_count BETWEEN 1 AND 7') = 0
    OR pg_catalog.strpos(v_patched, 'v_source_count=v_count') = 0
    OR pg_catalog.strpos(v_patched, 'v_role_count=v_count') = 0
    OR pg_catalog.strpos(v_patched, 'v_hash_count=v_count') = 0
    OR pg_catalog.strpos(v_patched, 'v_valid_count=v_count') = 0
  THEN
    RAISE EXCEPTION 'partial_view_set_substitution_failed';
  END IF;
  -- No equality against a bare seven may survive anywhere in the body.
  IF pg_catalog.strpos(v_patched, '_count=7') > 0 THEN
    RAISE EXCEPTION 'partial_view_set_hardcoded_seven_survived';
  END IF;

  -- The per-view protections are the whole point of keeping this function
  -- strict. A replacement that ate any of them would still "apply cleanly".
  IF pg_catalog.strpos(v_patched, 'designpro-flat-first-atlas-20260827.v10-edge') = 0
    OR pg_catalog.strpos(v_patched, 'masterQcPassed') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-master-semantic-qc.v1') = 0
    OR pg_catalog.strpos(v_patched, 'atlasMasterContentHash') = 0
    OR pg_catalog.strpos(v_patched, 'atlasZoneContentHash') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-proof-semantic-qc.v1') = 0
    OR pg_catalog.strpos(v_patched, 'anchoredToView1') = 0
    OR pg_catalog.strpos(v_patched, 'deterministicMirror') = 0
  THEN
    RAISE EXCEPTION 'partial_view_set_context_lost';
  END IF;

  EXECUTE v_patched;
END
$partial$;

-- AND RUN IT, over a row that exercises the expression. CLAUDE.md's third
-- PL/pgSQL rule: PL/pgSQL compiles an expression the first time it is
-- EVALUATED, so a patched body that is never called is a patch nobody checked.
DO $verify$
DECLARE
  v_request uuid;
  v_valid boolean;
  v_needs_new boolean;
BEGIN
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'designpro_private.flat_first_atlas_view_set_valid(uuid)'
    )), 'v_valid_count=v_count') = 0
  THEN
    RAISE EXCEPTION 'partial_view_set_not_installed';
  END IF;

  -- The newest flat-first request that actually has views. Calling over a real
  -- row is what proves the body still parses and still returns a boolean.
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
    -- Nothing to exercise on this database; the text assertion above stands.
    RETURN;
  END IF;

  v_valid := designpro_private.flat_first_atlas_view_set_valid(v_request);
  v_needs_new := designpro_private.flat_first_atlas_requires_new_run(v_request);
  IF v_valid IS NULL OR v_needs_new IS NULL THEN
    RAISE EXCEPTION 'partial_view_set_returned_null';
  END IF;
  -- And the read that the browser makes must not raise for it.
  PERFORM public.designpro_generation_view_paths(v_request);
END
$verify$;
