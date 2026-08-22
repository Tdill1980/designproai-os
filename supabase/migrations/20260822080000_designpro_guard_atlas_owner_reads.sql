-- Refuse completed A.T.L.A.S. proof sets created before the current exact
-- seven-view lineage/audit/QC contract. Those rows can look complete by count
-- while carrying unrelated designs, a mirrored Driver relabelled Passenger, or
-- an unverified roof. They remain immutable history, but the owner must start a
-- new A.T.L.A.S. run rather than previewing or recovering them as current work.

CREATE OR REPLACE FUNCTION designpro_private.flat_first_atlas_view_set_valid(
  p_request_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $function$
DECLARE
  v_atlas public.designpro_flat_atlas_revisions%ROWTYPE;
  v_driver_hash text;
  v_count bigint;
  v_source_count bigint;
  v_role_count bigint;
  v_hash_count bigint;
  v_valid_count bigint;
BEGIN
  SELECT * INTO v_atlas
  FROM public.designpro_flat_atlas_revisions
  WHERE request_id=p_request_id
  ORDER BY revision_sequence DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_atlas.prompt_version IS DISTINCT FROM
      'designpro-flat-first-atlas-20260822.v4'
    OR pg_catalog.jsonb_typeof(v_atlas.metadata) IS DISTINCT FROM 'object'
    OR v_atlas.metadata->'masterQcPassed' IS DISTINCT FROM 'true'::jsonb
    OR v_atlas.metadata->>'masterQcContract' IS DISTINCT FROM
      'designpro.atlas-master-semantic-qc.v1'
    OR NOT CASE
      WHEN pg_catalog.jsonb_typeof(v_atlas.metadata->'masterQcConfidence')='number'
      THEN (v_atlas.metadata->>'masterQcConfidence')::numeric>=0.92
      ELSE false
    END
    OR COALESCE(v_atlas.metadata->>'masterPromptHash','') !~ '^[0-9a-f]{64}$'
    OR v_atlas.metadata->>'masterProviderContract' IS DISTINCT FROM
      'designpro.flat-first-master-provider.v1'
    OR v_atlas.metadata->>'designPanelArtboardPortVersion' IS DISTINCT FROM
      'designpanel-ai-generate.artboard.20260822.v1'
    OR COALESCE(v_atlas.metadata->>'masterExampleSetHash','') !~ '^[0-9a-f]{64}$'
  THEN RETURN false; END IF;

  SELECT content_hash INTO v_driver_hash
  FROM public.designpro_generation_views
  WHERE request_id=p_request_id
    AND superseded_at IS NULL
    AND source_view_type='side'
    AND consumer_role='driver';
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(DISTINCT v.source_view_type),
    pg_catalog.count(DISTINCT v.consumer_role),
    pg_catalog.count(DISTINCT v.content_hash),
    pg_catalog.count(*) FILTER (WHERE (
      v.source_view_type IN (
        'side','passenger-side','hood_detail','front','rear','close-up','roof'
      )
      AND v.consumer_role=CASE v.source_view_type
        WHEN 'side' THEN 'driver'
        WHEN 'passenger-side' THEN 'passenger'
        WHEN 'hood_detail' THEN 'hood'
        WHEN 'front' THEN 'front'
        WHEN 'rear' THEN 'rear'
        WHEN 'close-up' THEN 'closeup'
        WHEN 'roof' THEN 'roof'
      END
      AND pg_catalog.jsonb_typeof(v.metadata)='object'
      AND v.metadata->>'providerContract'=
        'designpro.atlas-designpanel-server-provider.v1'
      AND pg_catalog.jsonb_typeof(v.metadata->'provider')='object'
      AND v.metadata#>>'{provider,contract}'=
        'designpro.generation-artifact-audit.v1'
      AND v.metadata#>>'{provider,sourceViewType}'=v.source_view_type
      AND v.metadata#>>'{provider,renderMethod}'=CASE
        WHEN v.source_view_type='passenger-side' THEN 'producePassengerView'
        ELSE 'generate-color-render'
      END
      AND v.metadata#>>'{provider,stage}'='generate-color-render'
      AND v.metadata#>>'{provider,execution}'='server-native'
      AND v.metadata#>'{provider,anchoredToFlatAtlas}'='true'::jsonb
      AND v.metadata#>'{provider,atlasConditioningVerified}'='true'::jsonb
      AND v.metadata#>>'{provider,promptHash}' ~ '^[0-9a-f]{64}$'
      AND CASE
        WHEN pg_catalog.jsonb_typeof(
          v.metadata#>'{provider,promptLength}'
        )='number'
        THEN (v.metadata#>>'{provider,promptLength}')::numeric>=1
        ELSE false
      END
      AND v.metadata#>>'{provider,studioContractVersion}'=
        'designpro.studio-os.port-ab0f0638.v1'
      AND v.metadata#>>'{provider,viewAngleContractVersion}'=
        'designpro.view-angles-os.port-ab0f0638.v1'
      AND v.metadata#>>'{provider,photographyContractVersion}'=
        'designpro.photorealism-prompt.port.v1'
      AND v.metadata#>>'{provider,atlasMasterContentHash}'=
        v_atlas.master_content_hash
      AND v.metadata#>>'{provider,atlasProjectionContentHash}'=
        v_atlas.projection_content_hash
      AND v.metadata#>>'{provider,atlasManifestContentHash}'=
        v_atlas.manifest_content_hash
      AND v.metadata#>>'{provider,atlasRevisionId}'=v_atlas.id::text
      AND CASE
        WHEN pg_catalog.jsonb_typeof(
          v.metadata#>'{provider,atlasRevisionSequence}'
        )='number'
        THEN (v.metadata#>>'{provider,atlasRevisionSequence}')::numeric=
          v_atlas.revision_sequence
        ELSE false
      END
      AND v.metadata#>>'{provider,atlasZoneContract}'=
        'designpro.flat-first-atlas-view-authority.v1'
      AND v.metadata#>>'{provider,atlasZoneContentHash}' ~ '^[0-9a-f]{64}$'
      AND v.metadata#>>'{provider,atlasZoneSurfaceKey}'=CASE v.source_view_type
        WHEN 'side' THEN 'driver'
        WHEN 'passenger-side' THEN 'passenger'
        WHEN 'hood_detail' THEN 'hood'
        WHEN 'front' THEN 'front'
        WHEN 'rear' THEN 'rear'
        WHEN 'close-up' THEN 'driver'
        WHEN 'roof' THEN 'roof'
      END
      AND pg_catalog.jsonb_typeof(v.metadata->'validation')='object'
      AND v.metadata#>>'{validation,contract}'=
        'designpro.atlas-proof-semantic-qc.v1'
      AND v.metadata#>>'{validation,expectedView}'=CASE v.source_view_type
        WHEN 'side' THEN 'Driver'
        WHEN 'passenger-side' THEN 'Passenger'
        WHEN 'hood_detail' THEN 'Hood'
        WHEN 'front' THEN 'Front'
        WHEN 'rear' THEN 'Rear'
        WHEN 'close-up' THEN 'Close-Up'
        WHEN 'roof' THEN 'Roof'
      END
      AND v.metadata#>>'{validation,proofHash}'=v.content_hash
      AND v.metadata#>>'{validation,atlasHash}'=
        v_atlas.projection_content_hash
      AND v.metadata#>>'{validation,authorityHash}'=
        v.metadata#>>'{provider,atlasZoneContentHash}'
      AND v.metadata#>>'{validation,zoneHash}'=
        v.metadata#>>'{provider,atlasZoneContentHash}'
      AND v.metadata#>>'{validation,zoneSurfaceKey}'=
        v.metadata#>>'{provider,atlasZoneSurfaceKey}'
      AND CASE
        WHEN pg_catalog.jsonb_typeof(
          v.metadata#>'{validation,confidence}'
        )='number'
        THEN (v.metadata#>>'{validation,confidence}')::numeric>=0.9
        ELSE false
      END
      AND pg_catalog.jsonb_typeof(v.metadata->'authority')='object'
      AND v.metadata#>>'{authority,contract}'='designpro.flat-first-atlas.v1'
      AND v.metadata#>>'{authority,revisionId}'=v_atlas.id::text
      AND CASE
        WHEN pg_catalog.jsonb_typeof(
          v.metadata#>'{authority,revisionSequence}'
        )='number'
        THEN (v.metadata#>>'{authority,revisionSequence}')::numeric=
          v_atlas.revision_sequence
        ELSE false
      END
      AND v.metadata#>>'{authority,masterContentHash}'=
        v_atlas.master_content_hash
      AND v.metadata#>>'{authority,projectionContentHash}'=
        v_atlas.projection_content_hash
      AND v.metadata#>>'{authority,projectionSourceMasterHash}'=
        v_atlas.master_content_hash
      AND v.metadata#>>'{authority,manifestContentHash}'=
        v_atlas.manifest_content_hash
      AND v.metadata#>>'{authority,zoneContract}'=
        v.metadata#>>'{provider,atlasZoneContract}'
      AND v.metadata#>>'{authority,zoneContentHash}'=
        v.metadata#>>'{provider,atlasZoneContentHash}'
      AND v.metadata#>>'{authority,zoneSurfaceKey}'=
        v.metadata#>>'{provider,atlasZoneSurfaceKey}'
      AND CASE
        WHEN v.source_view_type='side' THEN
          v.metadata#>'{provider,anchoredToView1}'='false'::jsonb
          AND NOT ((v.metadata->'provider') ? 'driverContentHash')
        ELSE
          v.metadata#>'{provider,anchoredToView1}'='true'::jsonb
          AND v.metadata#>>'{provider,driverContentHash}'=v_driver_hash
      END
      AND (
        v.source_view_type<>'passenger-side'
        OR (
          v.metadata#>>'{provider,passengerProducer}'='producePassengerView'
          AND v.metadata#>'{provider,deterministicMirror}'='true'::jsonb
          AND v.metadata#>'{provider,atlasZonePassedToPassengerRepair}'=
            'true'::jsonb
        )
      )
    ))
  INTO v_count,v_source_count,v_role_count,v_hash_count,v_valid_count
  FROM public.designpro_generation_views v
  WHERE v.request_id=p_request_id AND v.superseded_at IS NULL;

  RETURN v_count=7
    AND v_source_count=7
    AND v_role_count=7
    AND v_hash_count=7
    AND v_valid_count=7;
END;
$function$;

CREATE OR REPLACE FUNCTION designpro_private.flat_first_atlas_requires_new_run(
  p_request_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $function$
DECLARE
  v_row public.designpro_generation_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.designpro_generation_requests
  WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN false; END IF;

  RETURN v_row.request_input->>'contractVersion'=
      'designpro.calls-1-7-input.v3'
    AND v_row.request_input->>'pipelineMode'='flat-first-atlas-v1'
    AND v_row.state IN ('outputs_ready','failed','cancelled')
    AND NOT designpro_private.flat_first_atlas_view_set_valid(v_row.id);
END;
$function$;

-- Status is typed rather than exposing old proof identities. The gateway turns
-- this exact failure code into HTTP 409 so the customer sees the explicit new
-- run state even when the old request has no failed slot rows.
CREATE OR REPLACE FUNCTION public.get_designpro_generation_request(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_row public.designpro_generation_requests%ROWTYPE;
  v_views jsonb;
  v_handoff jsonb;
  v_shots integer;
  v_total integer;
  v_failed jsonb;
  v_regenerating jsonb;
  v_phase text;
  v_new_run boolean;
BEGIN
  SELECT * INTO v_row
  FROM public.designpro_generation_requests
  WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
     AND v_row.owner_id IS DISTINCT FROM auth.uid()
  THEN RETURN NULL; END IF;

  v_new_run:=designpro_private.flat_first_atlas_requires_new_run(v_row.id);

  IF v_new_run THEN
    v_views:='[]'::jsonb;
  ELSE
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'sourceViewType',source_view_type,'consumerRole',consumer_role,
      'contentHash',content_hash,'byteSize',byte_size,'contentType',content_type,
      'createdAt',created_at
    ) ORDER BY source_view_type),'[]'::jsonb)
    INTO v_views
    FROM public.designpro_generation_views
    WHERE request_id=v_row.id AND superseded_at IS NULL;
  END IF;

  v_shots:=pg_catalog.jsonb_array_length(v_views);
  SELECT pg_catalog.jsonb_array_length(
    designpro_private.calls_1_7_view_plan()
  ) INTO v_total;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'sourceViewType',source_view_type,'reason',reason
  ) ORDER BY source_view_type),'[]'::jsonb)
  INTO v_failed
  FROM public.designpro_generation_slots
  WHERE request_id=v_row.id AND state='failed';

  SELECT COALESCE(pg_catalog.jsonb_agg(
    source_view_type ORDER BY source_view_type
  ),'[]'::jsonb)
  INTO v_regenerating
  FROM public.designpro_generation_slots
  WHERE request_id=v_row.id
    AND state IN ('pending','leased')
    AND regenerations>0;

  IF v_new_run THEN
    v_phase:='failed';
    v_handoff:=pg_catalog.jsonb_build_object(
      'handoffReady',false,
      'handoffBlocker','flat_first_atlas_new_run_required'
    );
  ELSE
    v_phase:=CASE
      WHEN v_row.state IN ('failed','cancelled') THEN 'failed'
      WHEN v_shots>=v_total THEN 'complete'
      WHEN v_shots>0 THEN 'photographer'
      ELSE 'designer'
    END;
    v_handoff:=designpro_private.calls_1_7_handoff_state(v_row.id);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'requestId',v_row.id,
    'generationId',v_row.generation_id,
    'state',CASE WHEN v_new_run THEN 'failed' ELSE v_row.state END,
    'inputHash',v_row.input_hash,
    'engineContractHash',v_row.engine_contract_hash,
    'attempt',v_row.attempt,
    'outputSetHash',v_row.output_set_hash,
    'failureCode',CASE WHEN v_new_run
      THEN 'flat_first_atlas_new_run_required'
      ELSE v_row.error->>'code'
    END,
    'createdAt',v_row.created_at,
    'updatedAt',v_row.updated_at,
    'completedAt',v_row.completed_at,
    'handoffReady',v_handoff->'handoffReady',
    'handoffBlocker',v_handoff->>'handoffBlocker',
    'phase',v_phase,
    'shotsComplete',v_shots,
    'shotsTotal',v_total,
    'failedShots',v_failed,
    'regeneratingShots',v_regenerating,
    'designAnchor',v_row.request_input->>'brief',
    'designName',v_row.request_input->>'designName',
    'views',v_views
  );
END;
$function$;

-- The signed-view boundary must fail before returning any private storage path.
CREATE OR REPLACE FUNCTION public.designpro_generation_view_paths(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_row public.designpro_generation_requests%ROWTYPE;
  v_views jsonb;
BEGIN
  SELECT * INTO v_row
  FROM public.designpro_generation_requests
  WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
     AND v_row.owner_id IS DISTINCT FROM auth.uid()
  THEN RETURN NULL; END IF;

  IF designpro_private.flat_first_atlas_requires_new_run(v_row.id)
  THEN RAISE EXCEPTION 'flat_first_atlas_new_run_required'; END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'sourceViewType',source_view_type,'consumerRole',consumer_role,
    'storagePath',storage_path,'contentHash',content_hash,
    'contentType',content_type,'byteSize',byte_size
  ) ORDER BY source_view_type),'[]'::jsonb)
  INTO v_views
  FROM public.designpro_generation_views
  WHERE request_id=v_row.id AND superseded_at IS NULL;

  RETURN v_views;
END;
$function$;

REVOKE ALL ON FUNCTION
  designpro_private.flat_first_atlas_view_set_valid(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION
  designpro_private.flat_first_atlas_requires_new_run(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_designpro_generation_request(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_designpro_generation_request(uuid)
  TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.designpro_generation_view_paths(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.designpro_generation_view_paths(uuid)
  TO authenticated,service_role;

COMMENT ON FUNCTION
  designpro_private.flat_first_atlas_view_set_valid(uuid) IS
  'Validates the active exact-seven Atlas proof set against the latest immutable master, Driver anchor, server provider audit, angle/photography contracts and semantic QC.';
COMMENT ON FUNCTION
  designpro_private.flat_first_atlas_requires_new_run(uuid) IS
  'True only for terminal exact Atlas v3 requests whose active proof set predates or violates the current fail-closed lineage/audit/QC contract.';
