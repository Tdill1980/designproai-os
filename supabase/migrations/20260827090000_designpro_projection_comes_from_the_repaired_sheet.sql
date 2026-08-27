-- THE PROJECTION COMES FROM THE REPAIRED SHEET, AND THE GATE STILL PINNED IT TO
-- THE AUTHORED ONE.
--
-- This one predates the 2026-08-27 work. RULE 0.15's correction of 2026-08-26 --
-- "BOTH halves use the filled duplicate -- the proofs too" -- moved
-- projectionDerivative and buildViewAuthorities onto `surfaceSourceBytes`, the
-- cut-out-filled duplicate, because canary 6667efac proved the proof QC refuses
-- every view conditioned on a holed surface. The runtime changed. This predicate
-- did not:
--
--   AND v.metadata#>>'{authority,projectionSourceMasterHash}'=
--       v_atlas.master_content_hash
--
-- `master_content_hash` is the AUTHORED master -- the lineage identity, never
-- mutated. The projection is derived from the REPAIRED duplicate, whose hash the
-- revision records separately as `panelSourceHash`. On a clean master the fill
-- returns the same buffer and the two are equal, so this passed and kept
-- passing. The moment a sheet arrives with a cut-out they diverge, and the whole
-- view set is judged invalid.
--
-- Live, canary 2d918868 (2026-08-27 10:20), the best run yet -- SIX of seven
-- proofs accepted, only roof refused:
--
--   master_content_hash  b956aadca2da1533...   (authored)
--   panelSourceHash      ed9afe9dff8bbc71...   (repaired: driver 8.1%,
--                                               passenger 8.0%, rear 13.6%
--                                               of the zone filled)
--   authority.projectionSourceMasterHash
--                        ed9afe9dff8bbc71...   (correct -- that IS its source)
--
-- All six views failed this single assertion and nothing else. The set was
-- invalid, the read raised, the gateway 409'd, and the customer saw "This saved
-- proof set cannot be reused" over six good proofs.
--
-- THE FIX PINS IT TO WHAT THE REVISION ITSELF RECORDED. `panelSourceHash` exists
-- for exactly this: CLAUDE.md states it "equals canonicalMasterHash on a clean
-- master", so one comparison is correct in both cases and loosens nothing --
-- the projection is still bound to a hash this revision wrote down, and a view
-- whose projection came from some other sheet still fails.
--
-- COALESCE is unqualified deliberately. It is SQL GRAMMAR, not a function in any
-- schema: the parser resolves it before a search path is consulted, so
-- `pg_catalog.coalesce` does not exist and would raise at evaluation time --
-- which is the exact defect CLAUDE.md records for 20260826030000, where an
-- aggregate over zero rows hid it through two clean applies.
DO $projection$
DECLARE
  v_definition text;
  v_patched text;
  v_old constant text :=
    E'      AND v.metadata#>>''{authority,projectionSourceMasterHash}''=\n        v_atlas.master_content_hash';
  v_new constant text :=
    E'      AND v.metadata#>>''{authority,projectionSourceMasterHash}''=\n        COALESCE(\n          v_atlas.metadata->>''panelSourceHash'',\n          v_atlas.master_content_hash\n        )';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'projection_source_target_missing';
  END IF;

  -- Idempotent.
  IF pg_catalog.strpos(v_definition, 'panelSourceHash') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'projection_source_fragment_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  IF pg_catalog.strpos(v_patched, 'panelSourceHash') = 0
    OR pg_catalog.strpos(v_patched, 'projectionSourceMasterHash') = 0
  THEN
    RAISE EXCEPTION 'projection_source_substitution_failed';
  END IF;
  -- The grammar trap, refused at apply time rather than discovered at runtime.
  IF pg_catalog.strpos(v_patched, 'pg_catalog.coalesce') > 0
    OR pg_catalog.strpos(v_patched, 'pg_catalog.COALESCE') > 0
  THEN
    RAISE EXCEPTION 'projection_source_qualified_grammar';
  END IF;
  -- Everything the four earlier 2026-08-27 patches established must survive.
  IF pg_catalog.strpos(v_patched, 'designpro-flat-first-atlas-20260827.v10-edge') = 0
    OR pg_catalog.strpos(v_patched, 'masterAcceptance') = 0
    OR pg_catalog.strpos(v_patched, 'v_valid_count=v_count') = 0
    OR pg_catalog.strpos(v_patched, 'Driver is the PRIORITY view') = 0
    OR pg_catalog.strpos(v_patched, 'atlasZoneContentHash') = 0
    OR pg_catalog.strpos(v_patched, 'anchoredToView1') = 0
  THEN
    RAISE EXCEPTION 'projection_source_context_lost';
  END IF;

  EXECUTE v_patched;
END
$projection$;

-- RUN IT, over a request that HAS views -- an unevaluated COALESCE is exactly
-- what hid the 20260826030000 defect, and this migration adds one.
DO $verify$
DECLARE
  v_request uuid;
  v_valid boolean;
BEGIN
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'designpro_private.flat_first_atlas_view_set_valid(uuid)'
    )), 'panelSourceHash') = 0
  THEN
    RAISE EXCEPTION 'projection_source_not_installed';
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
    RAISE EXCEPTION 'projection_source_returned_null';
  END IF;
  PERFORM designpro_private.flat_first_atlas_requires_new_run(v_request);
  PERFORM public.designpro_generation_view_paths(v_request);
END
$verify$;
