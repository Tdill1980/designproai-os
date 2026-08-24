-- GENIE binds its manifest to the run that actually resolves it.
--
-- manifest.resolve moved out of the free entice run and behind the purchase
-- gate, because resolving true production dimensions is paid work and parking
-- the free run on a human validation gate is what left RevisionStudio with
-- nothing to show. The bind RPC was hard-locked to workflow_type
-- 'designpro.entice_pack', so the moved stage would have failed on every paid
-- run with entice_workflow_not_found -- the stage would claim, resolve GENIE,
-- and then be unable to record the answer.
--
-- bind_designpro_dimension_manifest accepts either workflow type. Everything
-- else is the 20260806180400 body verbatim: the same service-role fence, the
-- same lease check against a running manifest.resolve stage, the same six-surface
-- contract with five inches of bleed on every edge, the same total-square-footage
-- derivation, and the same drift refusal.
--
-- The old name is kept as a thin wrapper so an in-flight entice run mid-deploy
-- does not lose its binding.

CREATE OR REPLACE FUNCTION public.bind_designpro_dimension_manifest(
  p_run_id uuid,p_stage_id uuid,p_lease_token uuid,p_dimension_manifest_id uuid,
  p_manifest jsonb,p_manifest_hash text,p_dimension_basis_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_run public.designpro_workflow_runs%ROWTYPE; v_stage public.designpro_workflow_stages%ROWTYPE; v_surface jsonb; v_derived_manifest text; v_total_sqft numeric:=0;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  v_derived_manifest:=encode(extensions.digest(convert_to(p_manifest::text,'UTF8'),'sha256'),'hex');
  IF lower(p_dimension_basis_hash)!~'^[0-9a-f]{64}$'
    OR COALESCE((p_manifest->>'genieVerified')::boolean,false) IS DISTINCT FROM true
    OR jsonb_typeof(p_manifest->'expectedSurfaces')<>'array' OR jsonb_array_length(p_manifest->'expectedSurfaces')<>6
    OR lower(p_manifest->>'dimensionBasisHash') IS DISTINCT FROM lower(p_dimension_basis_hash)
    OR (NULLIF(btrim(COALESCE(p_manifest_hash,'')),'') IS NOT NULL AND lower(p_manifest_hash) IS DISTINCT FROM v_derived_manifest)
  THEN RAISE EXCEPTION 'genie_manifest_contract_invalid'; END IF;
  FOR v_surface IN SELECT value FROM jsonb_array_elements(p_manifest->'expectedSurfaces') LOOP
    IF NULLIF(btrim(v_surface->>'surfaceKey'),'') IS NULL OR COALESCE((v_surface->>'widthInches')::numeric,0)<=0
      OR COALESCE((v_surface->>'heightInches')::numeric,0)<=0
      OR jsonb_typeof(v_surface->'bleed')<>'object'
      OR (v_surface#>>'{bleed,top}')::numeric<>5 OR (v_surface#>>'{bleed,right}')::numeric<>5
      OR (v_surface#>>'{bleed,bottom}')::numeric<>5 OR (v_surface#>>'{bleed,left}')::numeric<>5
      OR (v_surface->>'surfaceSqFt')::numeric IS DISTINCT FROM round(((v_surface->>'widthInches')::numeric*(v_surface->>'heightInches')::numeric)/144,2)
    THEN RAISE EXCEPTION 'surface_dimension_contract_invalid'; END IF;
    v_total_sqft:=v_total_sqft+((v_surface->>'widthInches')::numeric*(v_surface->>'heightInches')::numeric)/144;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'surfaceKey') FROM jsonb_array_elements(p_manifest->'expectedSurfaces'))<>6
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['driver','passenger','hood','roof','front','rear']) required(surface_key)
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_manifest->'expectedSurfaces') s WHERE s->>'surfaceKey'=required.surface_key))
    OR (p_manifest->>'totalSqFt')::numeric IS DISTINCT FROM round(v_total_sqft,2)
  THEN RAISE EXCEPTION 'deterministic_surface_area_contract_invalid'; END IF;
  SELECT * INTO v_stage FROM public.designpro_workflow_stages WHERE id=p_stage_id AND run_id=p_run_id AND stage_key='manifest.resolve'
    AND status='running' AND lease_token=p_lease_token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'manifest_stage_lease_invalid'; END IF;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=p_run_id
    AND workflow_type IN ('designpro.entice_pack','designpro.production_pack') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dimension_workflow_not_found'; END IF;
  IF (v_run.dimension_manifest_id IS NOT NULL AND v_run.dimension_manifest_id IS DISTINCT FROM p_dimension_manifest_id)
    OR (v_run.manifest_hash IS NOT NULL AND v_run.manifest_hash IS DISTINCT FROM v_derived_manifest) THEN RAISE EXCEPTION 'manifest_identity_drift'; END IF;
  UPDATE public.designpro_workflow_runs SET dimension_manifest_id=COALESCE(dimension_manifest_id,p_dimension_manifest_id),
    manifest_hash=COALESCE(manifest_hash,v_derived_manifest),results=results||jsonb_build_object('dimensionManifest',p_manifest,'dimensionBasisHash',lower(p_dimension_basis_hash)),updated_at=clock_timestamp()
  WHERE id=p_run_id;
  RETURN jsonb_build_object('bound',true,'idempotent',v_run.dimension_manifest_id IS NOT NULL,'dimensionManifestId',p_dimension_manifest_id,'manifestHash',v_derived_manifest);
END $fn$;

-- Compatibility for a run already in flight when this ships.
CREATE OR REPLACE FUNCTION public.bind_designpro_entice_manifest(
  p_run_id uuid,p_stage_id uuid,p_lease_token uuid,p_dimension_manifest_id uuid,
  p_manifest jsonb,p_manifest_hash text,p_dimension_basis_hash text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $wrap$
  SELECT public.bind_designpro_dimension_manifest(
    p_run_id,p_stage_id,p_lease_token,p_dimension_manifest_id,
    p_manifest,p_manifest_hash,p_dimension_basis_hash
  );
$wrap$;

REVOKE ALL ON FUNCTION public.bind_designpro_dimension_manifest(uuid,uuid,uuid,uuid,jsonb,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_designpro_dimension_manifest(uuid,uuid,uuid,uuid,jsonb,text,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.bind_designpro_entice_manifest(uuid,uuid,uuid,uuid,jsonb,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_designpro_entice_manifest(uuid,uuid,uuid,uuid,jsonb,text,text)
  TO service_role;
