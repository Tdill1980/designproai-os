-- A.T.L.A.S. joins the ONE existing file-output pipeline.
--
-- Owner decision, 2026-08-23: the A.T.L.A.S. split path has a button in the
-- product UI and must be wired to the existing pipeline so its file output can
-- be validated. Until now the handoff was shut for every flat-first run, so an
-- A.T.L.A.S. design produced a master, six separated surfaces and seven proofs
-- and then stopped -- no Call 8 proof, no Call 9 panels, nothing to validate.
--
-- The block was `flatFirst AND NOT production_eligible`. That column answers a
-- different question: whether the atlas's own LAYOUT geometry is operator
-- validated production geometry. It is written false on purpose and must stay
-- false -- the atlas layout is `calls-1-7-layout-only`, and production geometry
-- is resolved downstream from the GENIE manifest at manifest.resolve, which is
-- explicitly not on the frozen generation/manufacturing seam. Using it as the
-- promotion gate conflated "these are not production dimensions" with "this run
-- may not enter production", which is why the gate could never open.
--
-- The gate now answers the question it is actually asking: did this A.T.L.A.S.
-- run produce an ACCEPTED canonical master? That is the same class of evidence
-- the standard path uses, and it is recorded by the runtime on the revision at
-- author time (metadata.masterQcPassed / masterQcContract, written by
-- runtime/atlas-master-qc.cjs). A run whose master never passed still cannot
-- hand off, and neither can a request with no atlas revision at all.
--
-- Everything downstream is unchanged. handoff_designpro_generation_to_production
-- still enforces its own preconditions, calls_1_7_handoff_state still requires
-- seven byte-distinct views in their planned roles, and Calls 8+ still resolve
-- their own geometry. This opens a gate; it does not create a second producer
-- and it does not alter the seam.
CREATE OR REPLACE FUNCTION public.designpro_flat_first_handoff_gate(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_request public.designpro_generation_requests%ROWTYPE;
  v_atlas public.designpro_flat_atlas_revisions%ROWTYPE;
  v_master_accepted boolean;
BEGIN
  SELECT * INTO v_request FROM public.designpro_generation_requests
  WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
    AND v_request.owner_id IS DISTINCT FROM auth.uid()
  THEN RETURN NULL; END IF;

  -- A standard (v1/v2) request is not flat-first and was never gated here.
  IF v_request.request_input->>'contractVersion'<>'designpro.calls-1-7-input.v3'
  THEN RETURN pg_catalog.jsonb_build_object(
    'flatFirst',false,'productionEligible',true,'revisionId',NULL
  ); END IF;

  SELECT * INTO v_atlas FROM public.designpro_flat_atlas_revisions
  WHERE request_id=v_request.id ORDER BY revision_sequence DESC LIMIT 1;

  v_master_accepted := v_atlas.id IS NOT NULL
    AND COALESCE(v_atlas.metadata->>'masterQcPassed','') = 'true'
    AND COALESCE(v_atlas.metadata->>'masterQcContract','')
        = 'designpro.atlas-master-semantic-qc.v1';

  RETURN pg_catalog.jsonb_build_object(
    'flatFirst',true,
    -- Handoff eligibility, decided by the master acceptance evidence.
    'productionEligible',v_master_accepted,
    -- The geometry flag stays separately reportable and stays false: the
    -- atlas layout is never production geometry.
    'geometryProductionEligible',COALESCE(v_atlas.production_eligible,false),
    'masterQcPassed',v_master_accepted,
    'revisionId',v_atlas.id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.designpro_flat_first_handoff_gate(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.designpro_flat_first_handoff_gate(uuid)
  TO authenticated,service_role;
