-- The authoring model stops being handed readable text, so v6 masters stop
-- qualifying.
--
-- v6 fixed the wrong input. The guide the model was shown carried each
-- surface's own name printed across the middle of that surface -- "HOOD" set at
-- up to 180px, bold, dead centre on the hood rectangle -- plus a footer reading
-- "TOPOLOGY GUIDE ONLY - GRAYS AND LABELS MUST NOT APPEAR IN ARTWORK". Asked to
-- paint artwork inside a rectangle that has a large bold word centred on it, the
-- model painted the word. The only defence was a sentence of prose calling the
-- labels instructions, which is a negative naming the forbidden thing, and the
-- footer was that same negative rendered as pixels inside the image it warned
-- about.
--
-- Live evidence 2026-08-25, generation eb7835a8-247b-443c-9804-e73f66379603
-- (Carley's 2011 Chevy Traverse LT): three consecutive authoring attempts
-- refused on artifactFreeContract and zoneCoverageContract, the inspector
-- reporting "The hood zone contains the guide label 'HOOD'" and "The roof zone
-- contains the guide label 'ROOF'". The request died with zero atlas revisions,
-- zero views, zero panels and no receipt. The gate was correct all three times;
-- the input was wrong.
--
-- The runtime half of the fix splits the one guide by consumer. The model now
-- receives geometry alone -- identical rectangles, fills, strokes and canvas,
-- and not one glyph -- so there is nothing readable left to copy. Zone identity
-- was never carried by those glyphs anyway: the prompt's ZONE MAP already names
-- every surface with its exact box and rotation. The labelled map is unchanged
-- and still rendered, still stored as guide_storage_path, and still what the QC
-- inspector receives, which is exactly what keeps artifactFreeContract able to
-- catch this. The prompt also states full bleed per zone positively rather than
-- listing the guide furniture that must not be reproduced.
--
-- This migration is the database half: flat_first_atlas_view_set_valid pins the
-- exact authoring prompt version, so it has to learn v7 or every corrected
-- master would be refused here as unrecognised and the owner would lose the
-- read.
--
-- v6 is deliberately NOT kept as an alternative, for the same reason v5 was not
-- kept when v6 shipped. A master authored while the model was still being shown
-- the surface names must not satisfy the current contract, and the version
-- string is exactly the mechanism that refuses it.
--
-- The body below is the 20260824180000 definition reproduced verbatim with that
-- one string changed. No lineage, role, hash, provider, QC threshold or contract
-- evidence is relaxed.
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
      'designpro-flat-first-atlas-20260825.v7'
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
