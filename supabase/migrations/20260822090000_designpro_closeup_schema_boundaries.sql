-- Complete the forward-only Close-Up restoration at every database boundary.
--
-- 20260822060000 restored close-up/closeup as the active seventh generation
-- view while deliberately retaining immutable historical hero-3d/hero3d rows.
-- Three older boundaries still named hero3d exclusively: revision-source
-- validation, revision.freeze receipt validation, and owner Storage policies.
-- New writes now require the complete current Close-Up set. Immutable Hero
-- history stays readable, and a stage retry may consume Hero only when its run
-- is already pinned to an existing frozen Hero revision. It also applies the
-- terminal Atlas new-run fence to the master preview RPC before any private
-- Storage path can be returned.

CREATE OR REPLACE FUNCTION designpro_private.verify_revision_render_assets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_role text;
  v_roles text[];
  v_asset jsonb;
  v_hash text;
  v_path text;
  v_content_type text;
  v_expected_pattern text;
BEGIN
  IF pg_catalog.jsonb_typeof(NEW.snapshot->'renderAssets') IS DISTINCT FROM
      'object' THEN
    RAISE EXCEPTION 'seven_render_asset_identities_required';
  END IF;

  v_roles:=ARRAY[
    'driver','passenger','hood','roof','front','rear','closeup'
  ]::text[];

  FOREACH v_role IN ARRAY v_roles LOOP
    v_asset:=NEW.snapshot->'renderAssets'->v_role;
    IF pg_catalog.jsonb_typeof(v_asset) IS DISTINCT FROM 'object'
      OR (SELECT pg_catalog.count(*)
          FROM pg_catalog.jsonb_object_keys(v_asset))<>4
      OR NOT v_asset ?&
        ARRAY['storagePath','contentHash','byteSize','contentType']
    THEN
      RAISE EXCEPTION 'seven_render_asset_identities_required';
    END IF;

    v_hash:=v_asset->>'contentHash';
    v_path:=v_asset->>'storagePath';
    v_content_type:=v_asset->>'contentType';
    IF v_hash !~ '^[0-9a-f]{64}$'
      OR v_asset->>'byteSize' !~ '^[1-9][0-9]*$'
      OR (v_asset->>'byteSize')::bigint>26214400
      OR v_content_type NOT IN ('image/png','image/jpeg','image/webp')
    THEN
      RAISE EXCEPTION 'render_asset_evidence_invalid';
    END IF;

    v_expected_pattern:='^users/'||NEW.owner_id::text
      ||'/revisions/'||NEW.revision_id::text
      ||'/inputs/'||v_role||'/'||v_hash
      ||CASE v_content_type
          WHEN 'image/png' THEN '\.png$'
          WHEN 'image/webp' THEN '\.webp$'
          ELSE '\.(jpg|jpeg)$'
        END;
    IF v_path !~ v_expected_pattern THEN
      RAISE EXCEPTION 'owner_bound_render_asset_path_required';
    END IF;
  END LOOP;

  IF (SELECT pg_catalog.count(DISTINCT value->>'contentHash')
      FROM pg_catalog.jsonb_each(NEW.snapshot->'renderAssets'))<>7
    OR (SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_object_keys(NEW.snapshot->'renderAssets'))<>7
  THEN
    RAISE EXCEPTION 'seven_distinct_render_asset_hashes_required';
  END IF;
  RETURN NEW;
END
$fn$;

-- Preserve the mature complete_designpro_stage body byte-for-byte except for
-- the one revision.freeze required-view expression. A Hero receipt is valid
-- only for a retry of an existing immutable Hero revision. A fresh or current
-- run must provide Close-Up. The surrounding unchanged checks still require
-- exactly seven distinct view keys and hashes.
DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_old text:='ARRAY[''driver'',''passenger'',''hood'',''roof'',''front'',''rear'',''hero3d'']';
  v_new text:=$replacement$CASE
          WHEN EXISTS(
            SELECT 1
            FROM public.designpro_revision_sources frozen
            WHERE frozen.revision_id=v_run.revision_id
              AND frozen.owner_id=v_run.owner_id
              AND frozen.snapshot_hash=v_run.revision_snapshot_hash
              AND frozen.snapshot->'renderAssets' ? 'hero3d'
              AND NOT frozen.snapshot->'renderAssets' ? 'closeup'
          ) THEN ARRAY['driver','passenger','hood','roof','front','rear','hero3d']::text[]
          ELSE ARRAY['driver','passenger','hood','roof','front','rear','closeup']::text[]
        END$replacement$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'
      ::pg_catalog.regprocedure
  ) INTO v_definition;
  IF (
    pg_catalog.length(v_definition)-pg_catalog.length(
      pg_catalog.replace(v_definition,v_old,'')
    )
  )/pg_catalog.length(v_old)<>1 THEN
    RAISE EXCEPTION 'designpro_revision_freeze_hero_requirement_not_unique';
  END IF;
  v_patched:=pg_catalog.replace(v_definition,v_old,v_new);
  EXECUTE v_patched;
END
$migration$;

-- Historical Hero inputs remain owner-readable. New authenticated input
-- uploads are Close-Up-only; immutable historical revision paths never move.
DROP POLICY IF EXISTS designpro_owner_read_wrap_files ON storage.objects;
CREATE POLICY designpro_owner_read_wrap_files
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id='wrap-files'
  AND (
    (
      (storage.foldername(name))[1]='users'
      AND (storage.foldername(name))[2]=(SELECT auth.uid())::text
      AND (storage.foldername(name))[3]='revisions'
      AND (storage.foldername(name))[4] ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND (storage.foldername(name))[5]='inputs'
      AND (storage.foldername(name))[6] IN (
        'driver','passenger','hood','roof','front','rear','closeup','hero3d','logo'
      )
      AND pg_catalog.array_length(storage.foldername(name),1)=6
      AND storage.filename(name) ~
        '^[0-9a-f]{64}\.(png|jpg|jpeg|webp|svg|pdf)$'
    )
    OR EXISTS (
      SELECT 1
      FROM public.designpro_workflow_runs r
      WHERE r.owner_id=(SELECT auth.uid())
        AND (
          (
            (storage.foldername(name))[1]='designpro'
            AND (storage.foldername(name))[2]=r.tenant_key
            AND (storage.foldername(name))[3]=r.id::text
          )
          OR (
            (storage.foldername(name))[1]='wrapbox'
            AND (storage.foldername(name))[2]=r.tenant_key
            AND (storage.foldername(name))[3]=r.entice_pack_id::text
            AND (storage.foldername(name))[4]=r.id::text
          )
        )
    )
  )
);

DROP POLICY IF EXISTS designpro_owner_insert_revision_inputs ON storage.objects;
CREATE POLICY designpro_owner_insert_revision_inputs
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id='wrap-files'
  AND (storage.foldername(name))[1]='users'
  AND (storage.foldername(name))[2]=(SELECT auth.uid())::text
  AND (storage.foldername(name))[3]='revisions'
  AND (storage.foldername(name))[4] ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND (storage.foldername(name))[5]='inputs'
  AND (storage.foldername(name))[6] IN (
    'driver','passenger','hood','roof','front','rear','closeup','logo'
  )
  AND pg_catalog.array_length(storage.foldername(name),1)=6
  AND storage.filename(name) ~
    '^[0-9a-f]{64}\.(png|jpg|jpeg|webp|svg|pdf)$'
);

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
    'createdAt',r.created_at
  ) ORDER BY r.revision_sequence),'[]'::jsonb)
  INTO v_rows
  FROM public.designpro_flat_atlas_revisions r
  WHERE r.request_id=v_request.id;
  RETURN v_rows;
END
$fn$;

REVOKE ALL ON FUNCTION designpro_private.verify_revision_render_assets()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION
  public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.designpro_flat_atlas_revision_paths(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designpro_flat_atlas_revision_paths(uuid)
  TO authenticated,service_role;

COMMENT ON FUNCTION designpro_private.verify_revision_render_assets() IS
  'Accepts exactly seven new immutable revision inputs using active closeup; historical hero3d rows remain untouched and readable.';
COMMENT ON FUNCTION public.designpro_flat_atlas_revision_paths(uuid) IS
  'Owner-scoped immutable Atlas preview paths; invalid terminal legacy proof lineages fail with flat_first_atlas_new_run_required before any private path is returned.';
