-- A.T.L.A.S. Call 1 stops being shown a photograph of a vehicle, so v5 masters
-- stop qualifying.
--
-- v5 stated the solid-panel rule positively, which was right, and then attached
-- the finished 3D vehicle proof to the same call captioned "do not return a
-- vehicle image in Call 1". That is a negative with the forbidden thing sitting
-- in the context window as a photograph, and it beat the positive rule: shown a
-- wrapped van and told not to draw a van, the model drew one, flattened into the
-- zones with the wheel arches and glass rendered as solid dark shapes.
--
-- Live evidence 2026-08-24, request a43d3a61: three consecutive authoring
-- attempts refused by the deterministic cutout gate, driver and passenger each
-- carrying ONE contiguous cut-out blob at 3.76% of a zone that was otherwise 91%
-- artwork. A wheel arch. The gate was correct every time; the input was wrong.
--
-- The runtime half of the fix removes the finished proof from that call -- Call 1
-- authors a flat sheet, and projection onto the vehicle is what Calls 2-7 do
-- downstream from that master -- and describes the output as printed vinyl on the
-- roll whose zone names are addresses, not subjects. This migration is the
-- database half: flat_first_atlas_view_set_valid pins the exact authoring prompt
-- version, so it has to learn v6 or every corrected master would be refused here
-- as unrecognised and the owner would lose the read.
--
-- v5 is deliberately NOT kept as an alternative, for the same reason v4 was not
-- kept when v5 shipped. A master authored under the prompt that produced the
-- holes must not satisfy the current contract, and the version string is exactly
-- the mechanism that refuses it. Accepting both would hand a punched silhouette
-- straight to Call 9.
--
-- The body below is the 20260823230000 definition reproduced verbatim with that
-- one string changed. No lineage, role, hash, provider or contract evidence is
-- relaxed.
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
      'designpro-flat-first-atlas-20260824.v6'
    OR pg_catalog.jsonb_typeof(v_atlas.metadata) IS DISTINCT FROM 'object'
    OR v_atlas.metadata->'masterQcPassed' IS DISTINCT FROM 'true'::jsonb
    OR v_atlas.metadata->>'masterQcContract' IS DISTINCT FROM
      'designpro.atlas-master-semantic-qc.v1'
    OR NOT (CASE
      WHEN pg_catalog.jsonb_typeof(v_atlas.metadata->'masterQcConfidence')='number'
      THEN (v_atlas.metadata->>'masterQcConfidence')::numeric>=0.92
      ELSE false
    END)
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
