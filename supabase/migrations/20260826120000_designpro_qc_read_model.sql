-- THE QC EVIDENCE THE RUNTIME ALREADY RECORDS BECOMES READABLE. (Validator
-- hot-fix, 2026-08-26, owner-directed: "the gateway strips it".)
--
-- Every A.T.L.A.S. revision row carries, in `metadata`, the complete QC record
-- the runtime wrote at authoring time: the semantic master review with its
-- nine per-contract verdicts, the deterministic zone measurements, the cut-out
-- findings and the deterministic fill telemetry, the authoring attempt count
-- and the provider identity. Every per-view proof attempt likewise carries the
-- inspector's verbatim findings in `designpro_generation_attempts.detail` and
-- its slot's terminal state in `designpro_generation_slots`.
--
-- None of that ever crossed the read seam: the two atlas path RPCs enumerate
-- storage/identity columns only, and no RPC reads slots or attempts at all —
-- which is why PanelPro renders a control room with no master QC, no proof QC,
-- no cut-out findings and no retry history (independent validation,
-- 2026-08-26). This migration widens the READ MODEL only. No new store, no
-- new writer, no change to any stage function.
--
-- Both path RPCs below are re-emitted from their latest applied bodies
-- (designpro_flat_atlas_revision_paths: 20260822090000;
--  designpro_flat_atlas_generation_paths: 20260824030000) plus exactly one new
-- key, 'qc'. Neither function has been text-patched since those bodies, so a
-- re-emission cannot silently revert an intermediate patch; verified against
-- the migration history before authoring.

CREATE OR REPLACE FUNCTION public.designpro_flat_atlas_revision_paths(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE
  v_request public.designpro_generation_requests%ROWTYPE;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_request
  FROM public.designpro_generation_requests
  WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
    AND v_request.owner_id IS DISTINCT FROM auth.uid()
  THEN RETURN NULL; END IF;

  IF designpro_private.flat_first_atlas_requires_new_run(v_request.id)
  THEN RAISE EXCEPTION 'flat_first_atlas_new_run_required'; END IF;

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
    'panelMap',r.manifest->'zones',
    'exampleUsed',r.example_used,
    'exampleGuideHash',r.example_guide_hash,
    'exampleMasterHash',r.example_master_hash,
    'createdAt',r.created_at,
    'qc',pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'masterQcPassed',r.metadata->'masterQcPassed',
      'masterQcModel',r.metadata->'masterQcModel',
      'masterQcContract',r.metadata->'masterQcContract',
      'masterQcConfidence',r.metadata->'masterQcConfidence',
      'masterQcReview',r.metadata->'masterQcReview',
      'masterQcDeterministic',r.metadata->'masterQcDeterministic',
      'masterAuthoringAttempts',r.metadata->'masterAuthoringAttempts',
      'masterCutoutSurfaces',r.metadata->'masterCutoutSurfaces',
      'masterCutoutFindings',r.metadata->'masterCutoutFindings',
      'cutoutFillApplied',r.metadata->'cutoutFillApplied',
      'cutoutFillContract',r.metadata->'cutoutFillContract',
      'panelSourceHash',r.metadata->'panelSourceHash',
      'providerKeyFingerprint',r.metadata->'providerKeyFingerprint',
      'pipelineMode',r.metadata->'pipelineMode',
      'masterProviderContract',r.metadata->'masterProviderContract'
    ))
  ) ORDER BY r.revision_sequence),'[]'::jsonb)
  INTO v_rows
  FROM public.designpro_flat_atlas_revisions r
  WHERE r.request_id=v_request.id;
  RETURN v_rows;
END
$fn$;

REVOKE ALL ON FUNCTION public.designpro_flat_atlas_revision_paths(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designpro_flat_atlas_revision_paths(uuid)
  TO authenticated,service_role;

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
    'createdAt',r.created_at,
    'qc',pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'masterQcPassed',r.metadata->'masterQcPassed',
      'masterQcModel',r.metadata->'masterQcModel',
      'masterQcContract',r.metadata->'masterQcContract',
      'masterQcConfidence',r.metadata->'masterQcConfidence',
      'masterQcReview',r.metadata->'masterQcReview',
      'masterQcDeterministic',r.metadata->'masterQcDeterministic',
      'masterAuthoringAttempts',r.metadata->'masterAuthoringAttempts',
      'masterCutoutSurfaces',r.metadata->'masterCutoutSurfaces',
      'masterCutoutFindings',r.metadata->'masterCutoutFindings',
      'cutoutFillApplied',r.metadata->'cutoutFillApplied',
      'cutoutFillContract',r.metadata->'cutoutFillContract',
      'panelSourceHash',r.metadata->'panelSourceHash',
      'providerKeyFingerprint',r.metadata->'providerKeyFingerprint',
      'pipelineMode',r.metadata->'pipelineMode',
      'masterProviderContract',r.metadata->'masterProviderContract'
    ))
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

-- PER-VIEW PROOF QC, READ STRAIGHT FROM THE EXISTING EVIDENCE TABLES.
--
-- The slots table holds each view's terminal state and rejection count; the
-- attempts table holds every inspector verdict verbatim (camera/framing
-- contract failures, atlas continuity findings, invented-text call-outs,
-- vehicle continuity, text/logo findings) in `detail`. This RPC projects them
-- per request for one generation, owner-gated exactly like the atlas paths.
-- Key fingerprints stay server-side; they are provider-pool identity, not QC.
CREATE OR REPLACE FUNCTION public.designpro_generation_proof_qc(
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

  SELECT COALESCE(pg_catalog.jsonb_agg(request_row ORDER BY request_created_at DESC),'[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      q.created_at AS request_created_at,
      pg_catalog.jsonb_build_object(
        'requestId',q.id,
        'state',q.state,
        'attempt',q.attempt,
        'createdAt',q.created_at,
        'completedAt',q.completed_at,
        'error',q.error,
        'views',COALESCE((
          SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'sourceViewType',s.source_view_type,
            'state',s.state,
            'reason',s.reason,
            'rejections',s.rejections,
            'providerCalls',s.provider_calls,
            'regenerations',s.regenerations,
            'updatedAt',s.updated_at,
            'attempts',COALESCE((
              SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'attempt',a.attempt,
                'model',a.model,
                'outcome',a.outcome,
                'httpStatus',a.http_status,
                'detail',a.detail,
                'durationMs',a.duration_ms,
                'createdAt',a.created_at
              ) ORDER BY a.created_at)
              FROM public.designpro_generation_attempts a
              WHERE a.request_id=q.id AND a.source_view_type=s.source_view_type
            ),'[]'::jsonb)
          ) ORDER BY s.source_view_type)
          FROM public.designpro_generation_slots s
          WHERE s.request_id=q.id
        ),'[]'::jsonb)
      ) AS request_row
    FROM public.designpro_generation_requests q
    WHERE q.generation_id=p_generation_id
  ) requests;
  RETURN v_rows;
END;
$fn$;

REVOKE ALL ON FUNCTION public.designpro_generation_proof_qc(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designpro_generation_proof_qc(uuid)
  TO authenticated,service_role;
