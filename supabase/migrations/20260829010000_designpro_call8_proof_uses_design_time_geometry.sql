-- CALL 8's RECEIPT WAS COMPARED AGAINST A MANIFEST THE FREE RUN CANNOT HAVE.
--
-- The `proof.build` contract asserts, of every Call-8 receipt:
--
--   (p_receipt->>'totalSqFt')::numeric IS NOT DISTINCT FROM
--   (v_run.results->'dimensionManifest'->>'totalSqFt')::numeric
--
-- RULE 0.19 moved `manifest.resolve` behind `await_purchase`, so a FREE entice
-- run has no bound production manifest: `results->'dimensionManifest'` is
-- absent, the right-hand side is NULL, and a receipt carrying a real square
-- footage is DISTINCT FROM it. Every honest Call-8 receipt was refused.
--
-- The runtime says so in its own words, at the top of `buildCall8Proof`:
--
--   "GENIE deploys on order, so the free run has no bound production manifest.
--    Call 8 draws a dimensioned proof either way: pre-purchase it uses the
--    design-time sizes Call 1 already resolved and cut the panels to, which is
--    exactly what the proof's trim table reports."
--
-- So the runtime deliberately proofs against design-time geometry pre-purchase,
-- and this predicate demanded the production geometry that does not exist yet.
-- It is the fourth of the same family found tonight, after `pack.verify`
-- (20260828110000), the run identity CHECK (20260828120000) and the gateway's
-- order-number requirement -- all of them written when manifest.resolve sat in
-- the free half.
--
-- Live on run 8e9fab59-d282-4f92-a8aa-86b2f4e1d09e (generation
-- 8555be2f-71fe-4a30-8680-653d086a213e, 2026-08-29). Call 8 generated all six
-- flat surfaces, composed the sheet, stored it, and was then refused at
-- completion with `call8_flat_proof_contract_failed` -- so the stage recorded a
-- deferral and no `flat-proof` artifact survived. Two earlier defects had to be
-- fixed to even reach this one: an HTTP 400 from an inlineData part carrying a
-- third field (#250), and the swallowed failure reason that hid it (#249).
--
-- WHAT IS NOT RELAXED. The manifest id and hash comparisons are untouched, and
-- they already do the right thing in both halves: on a free run both sides are
-- NULL and match; on a paid run the receipt must equal the bound manifest
-- exactly. Only the square-footage comparison learns that there may be nothing
-- to compare against -- and when there is nothing, the receipt must still
-- declare a POSITIVE area, so a proof cannot claim zero square feet and pass by
-- having no manifest. `dimensionsAuthority`, the 5" bleed, the seven-view
-- lineage and the sourceProofHash regex are all unchanged.
--
-- PATCH, DO NOT RESTATE. `complete_designpro_stage` carries a stack of earlier
-- text patches; re-emitting the body reverts every one. The fragment below is
-- anchored on its own RAISE so it is unique -- the totalSqFt comparison alone
-- appears twice in the function.
-- The dollar-quote tag is letters and underscores only, deliberately. The
-- first draft used $call8_geometry$, and the digit is what broke it: the
-- migration splitter's dollar-quote pattern does not admit one, so it never
-- entered quote mode, split on the first `;` inside an E-string, and reported
-- `syntax error at end of input (SQLSTATE 42601)` at statement 0 -- the whole
-- file. Every other tag in supabase/migrations is letters only; that was not a
-- style choice anywhere else either.
DO $call_eight_geometry$
DECLARE
  v_definition text;
  v_patched text;
  v_occurrences int;

  v_old constant text := E'      OR (p_receipt->>''totalSqFt'')::numeric IS DISTINCT FROM (v_manifest->>''totalSqFt'')::numeric\n    THEN RAISE EXCEPTION ''call8_flat_proof_contract_failed''; END IF;';

  v_new constant text := E'      -- GENIE DEPLOYS ON ORDER (RULE 0.19), so a FREE entice run has no bound\n      -- production manifest and there is nothing here to compare against. Call 8\n      -- proofs the design-time geometry Call 1 already resolved and cut the six\n      -- panels to, and the proof''''s own trim table reports it. The receipt must\n      -- still declare a POSITIVE area, so a missing manifest is never a way to pass\n      -- with zero square feet. When a manifest IS bound -- the paid half -- the\n      -- receipt must match it exactly, unchanged.\n      OR CASE\n        WHEN v_manifest IS NULL OR pg_catalog.jsonb_typeof(v_manifest)=''null''\n        THEN COALESCE((p_receipt->>''totalSqFt'')::numeric, 0) <= 0\n        ELSE (p_receipt->>''totalSqFt'')::numeric IS DISTINCT FROM (v_manifest->>''totalSqFt'')::numeric\n      END\n    THEN RAISE EXCEPTION ''call8_flat_proof_contract_failed''; END IF;';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'call8_geometry_target_missing';
  END IF;

  -- Idempotent, against a sentinel this patch alone introduces. Guarding on a
  -- string the function already contains is how 20260828110000's first draft
  -- returned early and installed nothing.
  IF pg_catalog.strpos(v_definition, 'GENIE DEPLOYS ON ORDER (RULE 0.19), so a FREE entice run has no bound') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
    / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'call8_geometry_fragment: %', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- The patch is in, and the gate it belongs to still exists.
  IF pg_catalog.strpos(v_patched, 'GENIE DEPLOYS ON ORDER (RULE 0.19), so a FREE entice run has no bound') = 0
    OR pg_catalog.strpos(v_patched, 'call8_flat_proof_contract_failed') = 0
  THEN
    RAISE EXCEPTION 'call8_geometry_not_installed';
  END IF;
  -- Everything else the Call-8 contract asserts is still asserted.
  IF pg_catalog.strpos(v_patched, '''dimensionsAuthority''<>''genie-universal-panelizer''') = 0
    OR pg_catalog.strpos(v_patched, '(p_receipt->>''bleedInches'')::numeric<>5') = 0
    OR pg_catalog.strpos(v_patched, 'jsonb_array_length(p_receipt->''viewLineage'')<>7') = 0
    OR pg_catalog.strpos(v_patched, 'p_receipt->>''dimensionManifestId'' IS DISTINCT FROM v_run.dimension_manifest_id::text') = 0
    OR pg_catalog.strpos(v_patched, 'lower(p_receipt->>''manifestHash'') IS DISTINCT FROM v_run.manifest_hash') = 0
  THEN
    RAISE EXCEPTION 'call8_geometry_lost_a_neighbour';
  END IF;
  -- And the paid comparison survives: the bound-manifest branch is still there.
  IF pg_catalog.strpos(v_patched,
    'ELSE (p_receipt->>''totalSqFt'')::numeric IS DISTINCT FROM (v_manifest->>''totalSqFt'')::numeric') = 0
  THEN
    RAISE EXCEPTION 'call8_geometry_paid_comparison_lost';
  END IF;

  EXECUTE v_patched;
END
$call_eight_geometry$;
