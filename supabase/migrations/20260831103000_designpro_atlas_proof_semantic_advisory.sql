-- A.T.L.A.S. PROOF SEMANTICS ARE ADVISORY; LINEAGE REMAINS FAIL-CLOSED.
--
-- Generation 51ea0e06-2ceb-460a-8756-54888a7832a8 proved the distinction.
-- Call 1 had already accepted one immutable master and persisted all six panel
-- authorities. Four presentation views passed. Front and Rear then spent four
-- image calls each because the semantic reviewer repeatedly described their
-- exact front/rear authority crops as side artwork; Roof spent four calls on
-- camera/lighting opinions. The request published only four of seven views as
-- a result, even though presentation pixels never become production artwork.
--
-- Runtime now records those findings under an explicit advisory policy. This
-- patch makes the database twin accept that receipt while retaining every
-- exact proof/Atlas/authority/surface hash, photographer provenance, revision,
-- panel and no-mirror predicate. Historical accepted rows have no policy key;
-- they remain readable only under the former confidence >= 0.9 rule.
--
-- PATCH, DO NOT RESTATE. The live function carries later producer, panel,
-- partial-publication and historical-read repairs. Re-emitting an older body
-- would silently remove them.

DO $atlas_proof_semantic_advisory$
DECLARE
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_legacy_request uuid;
  v_legacy constant text := E'      AND CASE\n        WHEN pg_catalog.jsonb_typeof(\n          v.metadata#>''{validation,confidence}''\n        )=''number''\n        THEN (v.metadata#>>''{validation,confidence}'')::numeric>=0.9\n        ELSE false\n      END';
  v_policy constant text := E'      -- Semantic review is advisory for presentation-only proofs. Historical\n      -- rows have no policy key and retain the former confidence gate; current\n      -- rows name the advisory policy and disposition explicitly.\n      AND (\n        (\n          NOT ((v.metadata->''validation'') ? ''policyContract'')\n          AND CASE\n            WHEN pg_catalog.jsonb_typeof(\n              v.metadata#>''{validation,confidence}''\n            )=''number''\n            THEN (v.metadata#>>''{validation,confidence}'')::numeric>=0.9\n            ELSE false\n          END\n        )\n        OR (\n          v.metadata#>>''{validation,policyContract}''=\n            ''designpro.atlas-proof-semantic-advisory.v1''\n          AND v.metadata#>>''{validation,semanticDisposition}'' IN (\n            ''pass'',''review_required'',''unavailable''\n          )\n        )\n      )';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'atlas_proof_advisory_gate_target_missing';
  END IF;

  IF pg_catalog.strpos(
    v_definition,
    'designpro.atlas-proof-semantic-advisory.v1'
  ) > 0 THEN
    RETURN;
  END IF;

  -- Capture a row the previous gate accepts before replacing the predicate, so
  -- the compatibility check below is not tautologically selecting through the
  -- new definition. Empty/shadow databases safely leave this null.
  SELECT r.id INTO v_legacy_request
  FROM public.designpro_generation_requests r
  WHERE EXISTS (
      SELECT 1
      FROM public.designpro_generation_views v
      WHERE v.request_id=r.id
        AND v.superseded_at IS NULL
        AND NOT ((v.metadata->'validation') ? 'policyContract')
    )
    AND designpro_private.flat_first_atlas_view_set_valid(r.id)
  ORDER BY r.created_at DESC
  LIMIT 1;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_legacy, '')))
    / pg_catalog.length(v_legacy);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'atlas_proof_advisory_confidence_fragment: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_legacy, v_policy);

  -- The policy changed; none of the deterministic evidence did.
  IF pg_catalog.strpos(v_patched, 'designpro.atlas-proof-semantic-advisory.v1') = 0
    OR pg_catalog.strpos(v_patched, 'review_required') = 0
    OR pg_catalog.strpos(v_patched, 'unavailable') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-proof-semantic-qc.v1') = 0
    OR pg_catalog.strpos(v_patched, '{validation,proofHash}') = 0
    OR pg_catalog.strpos(v_patched, '{validation,atlasHash}') = 0
    OR pg_catalog.strpos(v_patched, '{validation,authorityHash}') = 0
    OR pg_catalog.strpos(v_patched, '{validation,zoneHash}') = 0
    OR pg_catalog.strpos(v_patched, '{validation,zoneSurfaceKey}') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-panel-authority.v1') = 0
    OR pg_catalog.strpos(v_patched, 'sourcePanelHash') = 0
    OR pg_catalog.strpos(v_patched, 'persona-photographer-render') = 0
    OR pg_catalog.strpos(v_patched, 'proofSourceCommit') = 0
    OR pg_catalog.strpos(v_patched, 'atlasRevisionId') = 0
    OR pg_catalog.strpos(v_patched, 'anchoredToView1') = 0
    OR pg_catalog.strpos(v_patched, 'driverContentHash') = 0
    OR pg_catalog.strpos(v_patched, 'deterministicMirror') = 0
    OR pg_catalog.strpos(v_patched, 'passengerProducer') = 0
    OR pg_catalog.strpos(v_patched, 'atlasZonePassedToPassengerRepair') = 0
    OR pg_catalog.strpos(v_patched, 'v_valid_count=v_count') = 0
  THEN
    RAISE EXCEPTION 'atlas_proof_advisory_lineage_context_lost';
  END IF;

  EXECUTE v_patched;

  IF v_legacy_request IS NOT NULL
    AND NOT designpro_private.flat_first_atlas_view_set_valid(v_legacy_request)
  THEN
    RAISE EXCEPTION 'atlas_proof_advisory_legacy_row_not_readable: %', v_legacy_request;
  END IF;
END
$atlas_proof_semantic_advisory$;

DO $verify_atlas_proof_semantic_advisory$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF pg_catalog.strpos(
    v_definition,
    'designpro.atlas-proof-semantic-advisory.v1'
  ) = 0
    OR pg_catalog.strpos(v_definition, 'NOT ((v.metadata->''validation'') ? ''policyContract'')') = 0
    OR pg_catalog.strpos(v_definition, 'numeric>=0.9') = 0
  THEN
    RAISE EXCEPTION 'atlas_proof_advisory_gate_not_installed';
  END IF;

END
$verify_atlas_proof_semantic_advisory$;
