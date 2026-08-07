-- DesignProAI production hardening: immutable private inputs, owner-readable
-- artifacts, canonical tenant path segments, and storage-path identity fences.

CREATE SCHEMA IF NOT EXISTS designpro_private;
REVOKE ALL ON SCHEMA designpro_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA designpro_private TO service_role;

CREATE OR REPLACE FUNCTION designpro_private.enforce_path_safe_tenant_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
  -- Upgrade the only legacy key emitted by the preceding migration without
  -- accepting arbitrary normalization or lossy slugging.
  IF NEW.tenant_key = 'user:' || NEW.owner_id::text THEN
    NEW.tenant_key := 'user_' || NEW.owner_id::text;
  END IF;
  IF NEW.tenant_key !~ '^[a-z0-9]([a-z0-9_-]{0,126}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'path_safe_tenant_key_required';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS designpro_revision_source_safe_tenant ON public.designpro_revision_sources;
CREATE TRIGGER designpro_revision_source_safe_tenant
BEFORE INSERT ON public.designpro_revision_sources
FOR EACH ROW EXECUTE FUNCTION designpro_private.enforce_path_safe_tenant_key();

DROP TRIGGER IF EXISTS designpro_workflow_run_safe_tenant ON public.designpro_workflow_runs;
CREATE TRIGGER designpro_workflow_run_safe_tenant
BEFORE INSERT ON public.designpro_workflow_runs
FOR EACH ROW EXECUTE FUNCTION designpro_private.enforce_path_safe_tenant_key();

ALTER TABLE public.designpro_revision_sources
  DROP CONSTRAINT IF EXISTS designpro_revision_source_tenant_path_safe,
  ADD CONSTRAINT designpro_revision_source_tenant_path_safe
    CHECK (tenant_key ~ '^[a-z0-9]([a-z0-9_-]{0,126}[a-z0-9])?$');

ALTER TABLE public.designpro_workflow_runs
  DROP CONSTRAINT IF EXISTS designpro_workflow_run_tenant_path_safe,
  ADD CONSTRAINT designpro_workflow_run_tenant_path_safe
    CHECK (tenant_key ~ '^[a-z0-9]([a-z0-9_-]{0,126}[a-z0-9])?$');

-- The fresh production contract stores identities for seven private objects;
-- browser-visible/public URLs are not accepted as source identity.
ALTER TABLE public.designpro_revision_sources
  DROP CONSTRAINT IF EXISTS designpro_revision_snapshot_contract;
ALTER TABLE public.designpro_revision_sources
  ADD CONSTRAINT designpro_revision_snapshot_contract CHECK (
    snapshot->>'contractVersion' = 'designpro.revision-snapshot.v1'
    AND snapshot ?& ARRAY['generationId','designId','orderNumber']
    AND snapshot->>'generationId' IS NOT DISTINCT FROM generation_id::text
    AND snapshot->>'designId' IS NOT DISTINCT FROM 'DID-' || upper(substr(
      replace(generation_id::text,'-',''),1,8
    ))
    AND NULLIF(snapshot->>'orderNumber','') IS NOT NULL
    AND snapshot->>'orderNumber' IS NOT DISTINCT FROM btrim(snapshot->>'orderNumber')
    AND snapshot->>'orderNumber' ~
      '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
    AND snapshot->>'visualizationId' = visualization_id::text
    AND jsonb_typeof(snapshot->'renderAssets') = 'object'
    AND snapshot->'renderAssets' ?& ARRAY['driver','passenger','hood','roof','front','rear','hero3d']
    AND NOT snapshot ? 'renderUrls'
    AND NULLIF(btrim(snapshot#>>'{vehicle,year}'),'') IS NOT NULL
    AND NULLIF(btrim(snapshot#>>'{vehicle,make}'),'') IS NOT NULL
    AND NULLIF(btrim(snapshot#>>'{vehicle,model}'),'') IS NOT NULL
    AND NULLIF(btrim(snapshot#>>'{vehicle,type}'),'') IS NOT NULL
    AND jsonb_typeof(snapshot->'surfaceOptions') = 'object'
    AND snapshot ? 'finish' AND snapshot ? 'bodyText'
    AND jsonb_typeof(snapshot->'change') = 'object'
    AND jsonb_typeof(snapshot->'expectedLogoInventory') = 'array'
    AND jsonb_typeof(snapshot->'logoInventoryAttestation') = 'object'
    AND snapshot#>>'{logoInventoryAttestation,mode}' IN ('none','listed')
    AND COALESCE((snapshot#>>'{logoInventoryAttestation,attested}')::boolean,false)
    AND jsonb_typeof(snapshot->'delivery') = 'object'
    AND snapshot#>>'{delivery,contractVersion}' = 'designpro.wrapbox-recipient.v1'
    AND snapshot#>>'{delivery,customerId}' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND snapshot#>>'{delivery,customerEmail}' =
      lower(btrim(snapshot#>>'{delivery,customerEmail}'))
    AND snapshot#>>'{delivery,recipientIdentityHash}' ~ '^[0-9a-f]{64}$'
    AND snapshot#>>'{delivery,orderNumber}' IS NOT DISTINCT FROM
      snapshot->>'orderNumber'
    AND NULLIF(btrim(snapshot#>>'{delivery,designName}'),'') IS NOT NULL
    AND (NOT snapshot ? 'materialFingerprints'
      OR jsonb_typeof(snapshot->'materialFingerprints') IN ('object','array'))
  );

CREATE OR REPLACE FUNCTION designpro_private.verify_revision_render_assets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_role text;
  v_asset jsonb;
  v_hash text;
  v_path text;
  v_content_type text;
  v_expected_pattern text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['driver','passenger','hood','roof','front','rear','hero3d'] LOOP
    v_asset := NEW.snapshot->'renderAssets'->v_role;
    IF jsonb_typeof(v_asset) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(v_asset)) <> 4
      OR NOT v_asset ?& ARRAY['storagePath','contentHash','byteSize','contentType']
    THEN
      RAISE EXCEPTION 'seven_render_asset_identities_required';
    END IF;

    v_hash := v_asset->>'contentHash';
    v_path := v_asset->>'storagePath';
    v_content_type := v_asset->>'contentType';
    IF v_hash !~ '^[0-9a-f]{64}$'
      OR v_asset->>'byteSize' !~ '^[1-9][0-9]*$'
      OR (v_asset->>'byteSize')::bigint > 26214400
      OR v_content_type NOT IN ('image/png','image/jpeg','image/webp')
    THEN
      RAISE EXCEPTION 'render_asset_evidence_invalid';
    END IF;

    v_expected_pattern := '^users/' || NEW.owner_id::text
      || '/revisions/' || NEW.revision_id::text
      || '/inputs/' || v_role || '/' || v_hash
      || CASE v_content_type
           WHEN 'image/png' THEN '\.png$'
           WHEN 'image/webp' THEN '\.webp$'
           ELSE '\.(jpg|jpeg)$'
         END;
    IF v_path !~ v_expected_pattern THEN
      RAISE EXCEPTION 'owner_bound_render_asset_path_required';
    END IF;
  END LOOP;

  IF (SELECT count(DISTINCT value->>'contentHash')
      FROM jsonb_each(NEW.snapshot->'renderAssets')) <> 7
    OR (SELECT count(*) FROM jsonb_object_keys(NEW.snapshot->'renderAssets')) <> 7
  THEN
    RAISE EXCEPTION 'seven_distinct_render_asset_hashes_required';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS designpro_00_revision_render_assets ON public.designpro_revision_sources;
CREATE TRIGGER designpro_00_revision_render_assets
BEFORE INSERT ON public.designpro_revision_sources
FOR EACH ROW EXECUTE FUNCTION designpro_private.verify_revision_render_assets();

CREATE OR REPLACE FUNCTION public.verify_designpro_revision_source_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_logo jsonb;
  v_hash text;
  v_path text;
  v_content_type text;
  v_inventory_size integer;
  v_attestation_mode text;
  v_expected_pattern text;
BEGIN
  v_inventory_size := jsonb_array_length(NEW.snapshot->'expectedLogoInventory');
  v_attestation_mode := NEW.snapshot#>>'{logoInventoryAttestation,mode}';
  IF NEW.snapshot#>>'{logoInventoryAttestation,attested}' IS DISTINCT FROM 'true'
    OR (v_attestation_mode = 'none' AND v_inventory_size <> 0)
    OR (v_attestation_mode = 'listed' AND v_inventory_size = 0)
  THEN
    RAISE EXCEPTION 'explicit_logo_inventory_attestation_required';
  END IF;

  FOR v_logo IN
    SELECT value FROM jsonb_array_elements(NEW.snapshot->'expectedLogoInventory')
  LOOP
    IF jsonb_typeof(v_logo) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(v_logo)) <> 8
      OR NOT v_logo ?& ARRAY[
        'placementKey','identityKey','displayName','surfaceKey','storagePath',
        'contentHash','byteSize','contentType'
      ]
      OR (v_logo->>'identityKey') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
      OR NULLIF(btrim(v_logo->>'displayName'),'') IS NULL
      OR length(v_logo->>'displayName') > 240
      OR v_logo->>'surfaceKey' NOT IN ('driver','passenger','hood','roof','front','rear')
      OR v_logo->>'placementKey' IS DISTINCT FROM
        (v_logo->>'identityKey') || '@' || (v_logo->>'surfaceKey')
      OR v_logo->>'byteSize' !~ '^[1-9][0-9]*$'
      OR (v_logo->>'byteSize')::bigint > 26214400
    THEN
      RAISE EXCEPTION 'expected_logo_inventory_item_invalid';
    END IF;

    v_hash := v_logo->>'contentHash';
    v_path := v_logo->>'storagePath';
    v_content_type := v_logo->>'contentType';
    v_expected_pattern := '^users/' || NEW.owner_id::text
      || '/revisions/' || NEW.revision_id::text
      || '/inputs/logo/' || v_hash
      || CASE v_content_type
           WHEN 'image/png' THEN '\.png$'
           WHEN 'image/jpeg' THEN '\.(jpg|jpeg)$'
           WHEN 'image/webp' THEN '\.webp$'
           WHEN 'image/svg+xml' THEN '\.svg$'
           WHEN 'application/pdf' THEN '\.pdf$'
           ELSE '$a'
         END;
    IF v_hash !~ '^[0-9a-f]{64}$' OR v_path !~ v_expected_pattern THEN
      RAISE EXCEPTION 'owner_bound_logo_asset_path_required';
    END IF;
  END LOOP;

  -- One stored logo identity/hash may intentionally appear on several target
  -- surfaces.  The placement, not the underlying logo bytes, is the unique
  -- unit consumed by Call 10.
  IF v_inventory_size IS DISTINCT FROM (
    SELECT count(DISTINCT v->>'placementKey')
    FROM jsonb_array_elements(NEW.snapshot->'expectedLogoInventory') v
  ) THEN
    RAISE EXCEPTION 'expected_logo_inventory_placement_duplicate';
  END IF;
  IF lower(NEW.snapshot_hash) IS DISTINCT FROM encode(
    extensions.digest(convert_to(NEW.snapshot::text,'UTF8'),'sha256'),'hex'
  ) THEN
    RAISE EXCEPTION 'revision_snapshot_hash_mismatch';
  END IF;
  NEW.snapshot_hash := lower(NEW.snapshot_hash);
  RETURN NEW;
END
$fn$;

-- Bucket metadata is declarative. All object writes/deletes still go through
-- the Storage API; no migration writes storage.objects rows.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
  'wrap-files',
  'wrap-files',
  false,
  53687091200,
  ARRAY['image/png','image/jpeg','image/webp','image/tiff','image/svg+xml',
        'application/pdf','application/postscript','application/zip','application/json']::text[]
)
ON CONFLICT(id) DO UPDATE SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS designpro_owner_read_wrap_files ON storage.objects;
CREATE POLICY designpro_owner_read_wrap_files
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'wrap-files'
  AND (
    (
      (storage.foldername(name))[1] = 'users'
      AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
      AND (storage.foldername(name))[3] = 'revisions'
      AND (storage.foldername(name))[4] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND (storage.foldername(name))[5] = 'inputs'
      AND (storage.foldername(name))[6] IN ('driver','passenger','hood','roof','front','rear','hero3d','logo')
      AND array_length(storage.foldername(name),1) = 6
      AND storage.filename(name) ~ '^[0-9a-f]{64}\.(png|jpg|jpeg|webp|svg|pdf)$'
    )
    OR EXISTS (
      SELECT 1
      FROM public.designpro_workflow_runs r
      WHERE r.owner_id = (SELECT auth.uid())
        AND (
          (
            (storage.foldername(name))[1] = 'designpro'
            AND (storage.foldername(name))[2] = r.tenant_key
            AND (storage.foldername(name))[3] = r.id::text
          )
          OR (
            (storage.foldername(name))[1] = 'wrapbox'
            AND (storage.foldername(name))[2] = r.tenant_key
            AND (storage.foldername(name))[3] = r.entice_pack_id::text
            AND (storage.foldername(name))[4] = r.id::text
          )
        )
    )
  )
);

-- Authenticated clients may insert immutable source views only. There are
-- intentionally no authenticated UPDATE or DELETE policies; server secret
-- writes bypass RLS and own all generated/output paths.
DROP POLICY IF EXISTS designpro_owner_insert_revision_inputs ON storage.objects;
CREATE POLICY designpro_owner_insert_revision_inputs
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'wrap-files'
  AND (storage.foldername(name))[1] = 'users'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  AND (storage.foldername(name))[3] = 'revisions'
  AND (storage.foldername(name))[4] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND (storage.foldername(name))[5] = 'inputs'
  AND (storage.foldername(name))[6] IN ('driver','passenger','hood','roof','front','rear','hero3d','logo')
  AND array_length(storage.foldername(name),1) = 6
  AND storage.filename(name) ~ '^[0-9a-f]{64}\.(png|jpg|jpeg|webp|svg|pdf)$'
);

GRANT SELECT, INSERT ON storage.objects TO authenticated;
REVOKE UPDATE, DELETE ON storage.objects FROM authenticated;

CREATE OR REPLACE FUNCTION designpro_private.enforce_artifact_storage_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_ok boolean := false;
BEGIN
  SELECT * INTO v_run
  FROM public.designpro_workflow_runs
  WHERE id = NEW.run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'artifact_workflow_missing';
  END IF;

  v_ok := (
    split_part(NEW.storage_path,'/',1) = 'designpro'
    AND split_part(NEW.storage_path,'/',2) = v_run.tenant_key
    AND split_part(NEW.storage_path,'/',3) = v_run.id::text
  ) OR (
    split_part(NEW.storage_path,'/',1) = 'wrapbox'
    AND split_part(NEW.storage_path,'/',2) = v_run.tenant_key
    AND split_part(NEW.storage_path,'/',3) = v_run.entice_pack_id::text
    AND split_part(NEW.storage_path,'/',4) = v_run.id::text
  ) OR (
    NEW.artifact_kind = 'logo'
    AND split_part(NEW.storage_path,'/',1) = 'users'
    AND split_part(NEW.storage_path,'/',2) = v_run.owner_id::text
    AND split_part(NEW.storage_path,'/',3) = 'revisions'
    AND split_part(NEW.storage_path,'/',4) = v_run.revision_id::text
    AND split_part(NEW.storage_path,'/',5) = 'inputs'
  );

  IF NOT v_ok
    OR NEW.storage_path LIKE '/%'
    OR NEW.storage_path LIKE '%..%'
    OR NEW.storage_path !~ '^[A-Za-z0-9._/-]+$'
  THEN
    RAISE EXCEPTION 'artifact_storage_identity_mismatch';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS designpro_artifact_storage_identity ON public.designpro_artifacts;
CREATE TRIGGER designpro_artifact_storage_identity
BEFORE INSERT OR UPDATE OF storage_path,run_id,artifact_kind ON public.designpro_artifacts
FOR EACH ROW EXECUTE FUNCTION designpro_private.enforce_artifact_storage_identity();

REVOKE ALL ON FUNCTION designpro_private.enforce_path_safe_tenant_key() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION designpro_private.verify_revision_render_assets() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION designpro_private.enforce_artifact_storage_identity() FROM PUBLIC,anon,authenticated;
