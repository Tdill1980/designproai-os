-- A MISSING DRIVER PROOF IS NOT AN INVALID LINEAGE EITHER.
--
-- The fifth hardcoded all-or-nothing in this contract, and the last one in this
-- function. `flat_first_atlas_view_set_valid` opens with:
--
--   SELECT content_hash INTO v_driver_hash
--   FROM public.designpro_generation_views
--   WHERE request_id=p_request_id AND superseded_at IS NULL
--     AND source_view_type='side' AND consumer_role='driver';
--   IF NOT FOUND THEN RETURN false; END IF;
--
-- so a run whose Driver proof was refused is judged an invalid lineage, which
-- makes designpro_generation_view_paths RAISE, which the gateway turns into a
-- 409 -- and the customer's master, six panels and every proof that DID land
-- become unreadable.
--
-- Live, canary a6c7d8cb (2026-08-27 10:10): state outputs_ready, front, hood and
-- rear accepted, side/passenger/roof/close-up refused. Three good proofs, a good
-- master, six cut panels -- and "This saved proof set cannot be reused."
--
-- `v_driver_hash` is READ NOWHERE. It appears exactly twice in the whole body:
-- its DECLARE and this SELECT. So the guard's only effect is the existence
-- requirement, and the requirement is the thing the owner's rule removes: "A
-- failed Hood 3D proof cannot prevent the Hood production panel from existing. A
-- failed Close-Up cannot cancel Driver/Passenger/Front/Rear/Roof artifacts." The
-- symmetry runs both ways -- a failed Driver must not cancel Front, Rear and
-- Hood.
--
-- Driver keeps its PRIORITY (RULE 0.23: it renders first so the customer sees
-- the design a minute early). Priority is not prerequisite, which is a
-- distinction runAtlasProofStages already makes in as many words.
--
-- The lookup itself is kept: it costs nothing, and a future check that wants the
-- driver hash should find it already resolved rather than re-deriving it.
-- Nothing else in the function changes -- every per-view assertion, the master
-- contract, and the delivered-count rule from 20260827060000 all stand.
DO $driver$
DECLARE
  v_definition text;
  v_patched text;
  v_old constant text :=
    E'  SELECT content_hash INTO v_driver_hash\n  FROM public.designpro_generation_views\n  WHERE request_id=p_request_id\n    AND superseded_at IS NULL\n    AND source_view_type=''side''\n    AND consumer_role=''driver'';\n  IF NOT FOUND THEN RETURN false; END IF;';
  v_new constant text :=
    E'  -- Driver is the PRIORITY view, not a prerequisite for the set to be\n  -- readable. Its absence means its proof was refused, not that the lineage is\n  -- invalid; every view that IS present still proves itself below.\n  SELECT content_hash INTO v_driver_hash\n  FROM public.designpro_generation_views\n  WHERE request_id=p_request_id\n    AND superseded_at IS NULL\n    AND source_view_type=''side''\n    AND consumer_role=''driver'';';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'driver_optional_target_missing';
  END IF;

  -- Idempotent.
  IF pg_catalog.strpos(v_definition, 'Driver is the PRIORITY view') > 0 THEN
    RETURN;
  END IF;

  -- The fragment must be matched WHOLE. `IF NOT FOUND THEN RETURN false; END IF;`
  -- on its own appears twice in this body -- the other guards the atlas revision
  -- lookup, where absence really is fatal -- so replacing that alone would have
  -- removed the wrong guard.
  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'driver_optional_fragment_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- Read what was produced. The atlas-revision guard must SURVIVE: without a
  -- revision there is no master to anchor anything to, and that absence is
  -- genuinely fatal.
  IF pg_catalog.strpos(v_patched, 'Driver is the PRIORITY view') = 0
    OR pg_catalog.strpos(v_patched, 'IF NOT FOUND THEN RETURN false; END IF;') = 0
  THEN
    RAISE EXCEPTION 'driver_optional_substitution_failed';
  END IF;
  IF (pg_catalog.length(v_patched)
      - pg_catalog.length(pg_catalog.replace(v_patched, 'IF NOT FOUND THEN RETURN false; END IF;', '')))
     / pg_catalog.length('IF NOT FOUND THEN RETURN false; END IF;') <> 1
  THEN
    RAISE EXCEPTION 'driver_optional_wrong_guard_count';
  END IF;

  -- And the rest of the contract, including the two rules that shipped before it.
  IF pg_catalog.strpos(v_patched, 'designpro-flat-first-atlas-20260827.v10-edge') = 0
    OR pg_catalog.strpos(v_patched, 'masterQcPassed') = 0
    OR pg_catalog.strpos(v_patched, 'masterAcceptance') = 0
    OR pg_catalog.strpos(v_patched, 'v_valid_count=v_count') = 0
    OR pg_catalog.strpos(v_patched, 'atlasZoneContentHash') = 0
    OR pg_catalog.strpos(v_patched, 'anchoredToView1') = 0
  THEN
    RAISE EXCEPTION 'driver_optional_context_lost';
  END IF;

  EXECUTE v_patched;
END
$driver$;

-- RUN IT, over a row that has views but NO driver -- the case this exists for.
DO $verify$
DECLARE
  v_request uuid;
  v_valid boolean;
BEGIN
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'designpro_private.flat_first_atlas_view_set_valid(uuid)'
    )), 'Driver is the PRIORITY view') = 0
  THEN
    RAISE EXCEPTION 'driver_optional_not_installed';
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
    RAISE EXCEPTION 'driver_optional_returned_null';
  END IF;
  PERFORM designpro_private.flat_first_atlas_requires_new_run(v_request);
  PERFORM public.designpro_generation_view_paths(v_request);
END
$verify$;
