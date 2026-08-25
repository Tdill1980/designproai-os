-- The six A.T.L.A.S. surfaces become siblings, so this gate stops mandating the
-- coupling that was killing production runs.
--
-- OWNER-APPROVED SEAM CHANGE (Trish, 2026-08-25). RULE 0.5 freezes the
-- generation/manufacturing seam and requires an owner decision to change it.
-- This is that decision, and the reason is that the frozen contract was
-- enforcing a failed architecture rather than protecting a good one:
--
--   flat_first_atlas_view_set_valid REQUIRED, for every accepted view set,
--     - passenger renderMethod = 'producePassengerView'
--     - passenger deterministicMirror = true
--     - passenger atlasZonePassedToPassengerRepair = true
--     - every non-Driver view carrying driverContentHash = the Driver's hash
--
-- So the database was insisting Passenger be manufactured by mirroring the
-- Driver render and repairing its reversed lettering, and that every other
-- surface be conditioned on the Driver image.
--
-- WHY THAT IS WRONG. The proven A.T.L.A.S.-first path never did it. Flamingo
-- Pools (5b2eb96c, 2026-08-22) rendered Passenger as its own Gemini call --
-- 35,747 ms with a real key fingerprint, LONGER than its own Driver at
-- 30,709 ms -- from the same master authority f9015398... A deterministic sharp
-- mirror costs about 100 ms and burns no key, so that Passenger was
-- independently generated. The mirror chain arrived later, with the server port
-- (daf3929, 2026-08-23).
--
-- It then became the top cause of failed generations, because a branded design
-- can never be a literal pixel mirror: the authoring prompt requires every
-- word, logo, URL and number to stay forward-reading on BOTH flanks, so the
-- flank that matches as a design cannot match as pixels. dda491ae was refused
-- at passengerMirrorMae 0.28346; a9daede trimmed the mean to absorb it;
-- a6dd78aa still failed at 0.29343. fc2f2e80 failed from the other direction,
-- the reviewer reporting 'ProTech AUTOMOTIVE' upside down on the passenger
-- side. Two detectors, one defect, and the defect is the operation itself.
--
-- WHAT REPLACES IT. Cross-view identity now rests where it always actually
-- lived: the shared A.T.L.A.S. authority. Every view is conditioned on the same
-- frozen master and its own exact surface region, and this function continues to
-- assert -- unchanged, above -- that each carries the master content hash, the
-- projection hash, the manifest hash, the atlas revision id and its own
-- surfaceKey, all matched to the accepted revision. That is a hash-verified
-- guarantee rather than an inherited one, and it means a failed Driver can no
-- longer take the other five surfaces down with it.
--
-- WHAT IS DELIBERATELY NOT RELAXED. Exactly seven views, seven distinct source
-- types, seven distinct roles, seven distinct content hashes; the exact
-- role-to-view mapping; the provider/audit/studio/view-angle/photography
-- contract versions; every master, projection, manifest, zone and revision hash
-- assertion; the master QC contract, its 0.92 confidence floor and the proof QC
-- 0.9 floor; the prompt version pin. A Driver view is still REQUIRED to exist
-- for the set to be valid -- the six-distinct-panel invariant and the
-- seven-view invariant are untouched. Backwards or upside-down customer text,
-- a wrong vehicle or view, an unrelated redesign and wrong lineage all remain
-- fatal in the semantic proof QC, which this function does not govern.
--
-- The three passenger-specific requirements and the Driver-anchor requirement
-- are now inverted rather than merely dropped: a view carrying
-- driverContentHash, deterministicMirror, passengerProducer or
-- atlasZonePassedToPassengerRepair is REFUSED, so the retired mirror path
-- cannot quietly come back and satisfy this gate.
--
-- The body below is the 20260825190000 definition reproduced verbatim with only
-- those two clauses changed. No other assertion, threshold or contract moves.
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
      -- Passenger renders like every other surface now.
      AND v.metadata#>>'{provider,renderMethod}'='generate-color-render'
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
      -- SIX SIBLINGS: no surface inherits identity from another render.
      -- Every view is anchored to the same frozen master and its own exact
      -- zone, both asserted above by hash, so no view may carry a Driver
      -- reference and none may claim to be anchored to one.
      AND v.metadata#>'{provider,anchoredToView1}'='false'::jsonb
      AND NOT ((v.metadata->'provider') ? 'driverContentHash')
      AND NOT ((v.metadata->'provider') ? 'deterministicMirror')
      AND NOT ((v.metadata->'provider') ? 'passengerProducer')
      AND NOT ((v.metadata->'provider') ? 'atlasZonePassedToPassengerRepair')
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
