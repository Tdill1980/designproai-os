-- The A.T.L.A.S. master and its version history, addressed by generation.
--
-- The customer never sees the canonical master. What the buyer sees is the
-- seven 3D proofs and, in RevisionStudio, the six panels cut from that master.
-- The master sheet and the deterministic vehicle layout guide are production
-- instruments: they belong to the design team, on the PanelPro Studio board,
-- alongside every version the design has been through.
--
-- That board is addressed by generation, not by generation request, because a
-- design outlives the request that first produced it -- a revision mints a new
-- request against the same generation, which is exactly the history the board
-- needs to show. designpro_flat_atlas_revision_paths answers per request and so
-- can only ever return one run's slice of the lineage.
--
-- Everything else is the 20260820100000 body verbatim: the same SECURITY
-- DEFINER STABLE shape, the same service-role-or-owner fence, the same
-- allowlisted column projection, the same zone manifest as the geometry
-- authority, and the same revision_sequence ordering. Only the selector widens
-- from one request to every request of one generation, and the ownership fence
-- follows it -- a caller must own the generation, not merely name it.

CREATE OR REPLACE FUNCTION public.designpro_flat_atlas_generation_paths(
  p_generation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_owner uuid;
  v_rows jsonb;
BEGIN
  SELECT r.owner_id INTO v_owner
  FROM public.designpro_generation_requests r
  WHERE r.generation_id=p_generation_id
  ORDER BY r.created_at LIMIT 1;
  IF v_owner IS NULL THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
    AND v_owner IS DISTINCT FROM auth.uid()
  THEN RETURN NULL; END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',r.id,
    'requestId',r.request_id,
    'generationId',r.generation_id,
    'parentRevisionId',r.parent_revision_id,
    'revisionSequence',r.revision_sequence,
    'guideStoragePath',r.guide_storage_path,
    'guideContentHash',r.guide_content_hash,
    'guideByteSize',r.guide_byte_size,
    'guideContentType',r.guide_content_type,
    'manifestContentHash',r.manifest_content_hash,
    'manifestByteSize',r.manifest_byte_size,
    'manifestContentType',r.manifest_content_type,
    'masterStoragePath',r.master_storage_path,
    'masterContentHash',r.master_content_hash,
    'masterByteSize',r.master_byte_size,
    'masterContentType',r.master_content_type,
    'projectionStoragePath',r.projection_storage_path,
    'projectionContentHash',r.projection_content_hash,
    'projectionByteSize',r.projection_byte_size,
    'projectionContentType',r.projection_content_type,
    'affectedSurfaces',r.affected_surfaces,
    'instruction',r.instruction,
    'productionEligible',r.production_eligible,
    'model',r.model,
    'promptVersion',r.prompt_version,
    'widthPx',r.width_px,
    'heightPx',r.height_px,
    'effectivePpi',r.effective_ppi,
    -- The immutable manifest is the geometry authority. The gateway validates
    -- and allowlists the six zone records before any of this reaches the UI.
    'panelMap',r.manifest->'zones',
    'exampleUsed',r.example_used,
    'exampleGuideHash',r.example_guide_hash,
    'exampleMasterHash',r.example_master_hash,
    'createdAt',r.created_at
  ) ORDER BY r.revision_sequence),'[]'::jsonb)
  INTO v_rows FROM public.designpro_flat_atlas_revisions r
  WHERE r.generation_id=p_generation_id;
  RETURN v_rows;
END;
$fn$;

REVOKE ALL ON FUNCTION public.designpro_flat_atlas_generation_paths(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designpro_flat_atlas_generation_paths(uuid)
  TO authenticated,service_role;
