-- Restore the DesignIQ fields carried by the standalone Calls 1-7 adapter and
-- let an authenticated owner read only the two Atlas preview objects that the
-- owner-facing gateway is allowed to sign.
--
-- This migration does not widen either production access or the flat-first
-- artifact contract. The manifest and projection derivative remain
-- service-only. The new Storage policy is row-bound to the immutable Atlas
-- ledger, and the request validators remain closed allowlists.

CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_asset_identity_valid(
  p_asset jsonb,
  p_expected_kind text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, extensions
AS $fn$
  SELECT CASE
    WHEN p_expected_kind NOT IN ('logo','attachment') THEN false
    WHEN pg_catalog.jsonb_typeof(p_asset) IS DISTINCT FROM 'object' THEN false
    WHEN NOT (p_asset ?& ARRAY[
      'storagePath','contentHash','byteSize','contentType'
    ]) THEN false
    -- Exact identity keys are deliberate: signedUrl/url/bucket/verified and
    -- other browser assertions are not part of a frozen asset identity.
    WHEN (p_asset - ARRAY[
      'storagePath','contentHash','byteSize','contentType'
    ]) <> '{}'::jsonb THEN false
    WHEN pg_catalog.jsonb_typeof(p_asset->'storagePath') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_asset->'contentHash') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_asset->'byteSize') IS DISTINCT FROM 'number'
      OR pg_catalog.jsonb_typeof(p_asset->'contentType') IS DISTINCT FROM 'string'
    THEN false
    WHEN p_asset->>'contentHash' !~ '^[0-9a-f]{64}$' THEN false
    WHEN p_asset->>'byteSize' !~ '^[1-9][0-9]{0,7}$' THEN false
    WHEN (p_asset->>'byteSize')::bigint NOT BETWEEN 1 AND 26214400 THEN false
    WHEN p_expected_kind='attachment'
      AND p_asset->>'contentType' NOT IN (
        'image/png','image/jpeg','image/webp'
      )
    THEN false
    WHEN p_expected_kind='logo'
      AND p_asset->>'contentType' NOT IN (
        'image/png','image/jpeg','image/webp','image/svg+xml'
      )
    THEN false
    WHEN p_asset->>'storagePath' !~
      '^users/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/revisions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/inputs/(logo|attachment)/[0-9a-f]{64}\.(png|jpg|webp|svg)$'
    THEN false
    ELSE
      pg_catalog.split_part(p_asset->>'storagePath','/',6)=p_expected_kind
      AND pg_catalog.split_part(p_asset->>'storagePath','/',7)=
        (p_asset->>'contentHash')||'.'||CASE p_asset->>'contentType'
          WHEN 'image/png' THEN 'png'
          WHEN 'image/jpeg' THEN 'jpg'
          WHEN 'image/webp' THEN 'webp'
          WHEN 'image/svg+xml' THEN 'svg'
        END
  END
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_design_fields_valid(
  p_input jsonb
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, extensions
AS $fn$
  SELECT COALESCE((
    pg_catalog.jsonb_typeof(p_input)='object'
    AND CASE WHEN NOT p_input ? 'companyName' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'companyName')='string'
      AND pg_catalog.length(pg_catalog.btrim(p_input->>'companyName')) BETWEEN 1 AND 240,
      false
    ) END
    AND CASE WHEN NOT p_input ? 'businessName' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'businessName')='string'
      AND pg_catalog.length(pg_catalog.btrim(p_input->>'businessName')) BETWEEN 1 AND 240,
      false
    ) END
    AND CASE WHEN NOT p_input ? 'phone' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'phone')='string'
      AND pg_catalog.length(pg_catalog.btrim(p_input->>'phone')) BETWEEN 1 AND 80
      AND p_input->>'phone' !~ '[[:cntrl:]]',
      false
    ) END
    AND CASE WHEN NOT p_input ? 'website' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'website')='string'
      AND pg_catalog.length(pg_catalog.btrim(p_input->>'website')) BETWEEN 1 AND 2048
      AND p_input->>'website' !~ '[[:cntrl:]]',
      false
    ) END
    AND CASE WHEN NOT p_input ? 'industry' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'industry')='string'
      AND pg_catalog.length(pg_catalog.btrim(p_input->>'industry')) BETWEEN 1 AND 160,
      false
    ) END
    AND CASE WHEN NOT p_input ? 'style' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'style')='string'
      AND pg_catalog.length(pg_catalog.btrim(p_input->>'style')) BETWEEN 1 AND 240,
      false
    ) END
    AND CASE WHEN NOT p_input ? 'finish' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'finish')='string'
      AND pg_catalog.length(p_input->>'finish')<=40,
      false
    ) END
    AND CASE WHEN NOT p_input ? 'substrate' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'substrate')='string'
      AND p_input->>'substrate'=ANY(ARRAY[
        'standard','color_change_film','chrome_film','satin_film'
      ]),
      false
    ) END
    AND CASE WHEN NOT p_input ? 'mascot' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'mascot')='string'
      AND pg_catalog.length(p_input->>'mascot')<=400,
      false
    ) END
    AND CASE WHEN NOT p_input ? 'brandColors' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'brandColors')='string'
      AND pg_catalog.length(p_input->>'brandColors')<=500,
      false
    ) END
    AND CASE WHEN NOT p_input ? 'fontStyle' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'fontStyle')='string'
      AND pg_catalog.length(p_input->>'fontStyle')<=200,
      false
    ) END
    AND CASE WHEN NOT p_input ? 'qrEnabled' THEN true ELSE
      pg_catalog.jsonb_typeof(p_input->'qrEnabled')='boolean'
    END
    AND CASE WHEN NOT p_input ? 'qrUrl' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'qrUrl')='string'
      AND pg_catalog.length(p_input->>'qrUrl')<=2048,
      false
    ) END
    AND CASE WHEN NOT p_input ? 'visionboardIntent' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'visionboardIntent')='string'
      AND p_input->>'visionboardIntent'=ANY(ARRAY[
        'style_inspiration','exact_reference','artboard_projection'
      ]),
      false
    ) END
    AND CASE WHEN NOT p_input ? 'textLayerPrompt' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'textLayerPrompt')='string'
      AND pg_catalog.length(p_input->>'textLayerPrompt')<=2000,
      false
    ) END
    AND CASE WHEN NOT p_input ? 'styleDescriptors' THEN true ELSE COALESCE(
      pg_catalog.jsonb_typeof(p_input->'styleDescriptors')='string'
      AND pg_catalog.length(p_input->>'styleDescriptors')<=2000,
      false
    ) END
    AND CASE
      WHEN NOT p_input ? 'colors' THEN true
      WHEN pg_catalog.jsonb_typeof(p_input->'colors') IS DISTINCT FROM 'array' THEN false
      WHEN pg_catalog.jsonb_array_length(p_input->'colors')>12 THEN false
      ELSE NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_input->'colors') item(value)
        WHERE pg_catalog.jsonb_typeof(item.value) IS DISTINCT FROM 'string'
          OR pg_catalog.length(pg_catalog.btrim(item.value#>>'{}')) NOT BETWEEN 1 AND 80
      )
    END
    AND CASE
      WHEN NOT p_input ? 'bulletPoints' THEN true
      WHEN pg_catalog.jsonb_typeof(p_input->'bulletPoints') IS DISTINCT FROM 'array' THEN false
      WHEN pg_catalog.jsonb_array_length(p_input->'bulletPoints')>12 THEN false
      ELSE NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_input->'bulletPoints') item(value)
        WHERE pg_catalog.jsonb_typeof(item.value) IS DISTINCT FROM 'string'
          OR pg_catalog.length(item.value#>>'{}')>240
      )
    END
    AND CASE
      WHEN NOT p_input ? 'logoAsset' THEN true
      ELSE designpro_private.calls_1_7_asset_identity_valid(
        p_input->'logoAsset','logo'
      )
    END
    AND CASE
      WHEN NOT p_input ? 'visionBoardImages' THEN true
      WHEN pg_catalog.jsonb_typeof(p_input->'visionBoardImages') IS DISTINCT FROM 'array'
        THEN false
      WHEN pg_catalog.jsonb_array_length(p_input->'visionBoardImages')>6
        THEN false
      ELSE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_input->'visionBoardImages') identity(value)
        WHERE NOT designpro_private.calls_1_7_asset_identity_valid(
          identity.value,'attachment'
        )
      )
    END
  ),false)
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_input_v2_valid(
  p_input jsonb
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, extensions
AS $fn$
  SELECT COALESCE((
    pg_catalog.jsonb_typeof(p_input)='object'
    AND p_input->>'contractVersion'='designpro.calls-1-7-input.v2'
    AND NOT (p_input ?| ARRAY['orderNumber','delivery'])
    AND (p_input - ARRAY[
      'contractVersion','vehicle','brief','designName','mode','companyName',
      'phone','website','logoAsset','businessName','industry','colors','style',
      'finish','substrate','mascot','bulletPoints','brandColors','fontStyle',
      'qrEnabled','qrUrl','visionBoardImages','visionboardIntent',
      'styleDescriptors','textLayerPrompt'
    ]) = '{}'::jsonb
    AND NULLIF(pg_catalog.btrim(p_input->>'brief'),'') IS NOT NULL
    AND pg_catalog.length(p_input->>'brief')<=8000
    AND NULLIF(pg_catalog.btrim(p_input->>'designName'),'') IS NOT NULL
    AND pg_catalog.length(p_input->>'designName')<=240
    AND (NOT p_input ? 'mode' OR p_input->>'mode'=ANY(ARRAY['restyle','commercial']))
    AND pg_catalog.jsonb_typeof(p_input->'vehicle')='object'
    AND NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,year}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,make}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,model}'),'') IS NOT NULL
    AND p_input#>>'{vehicle,type}'=ANY(ARRAY[
      'car','truck','suv','van','motorcycle','boat','bus','rv','trailer',
      'aircraft','heavy_equipment'
    ])
    AND designpro_private.calls_1_7_design_fields_valid(p_input)
    AND pg_catalog.octet_length(p_input::text)<=262144
    AND NOT designpro_private.generation_input_has_server_controls(p_input)
  ),false)
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_input_v3_valid(
  p_input jsonb
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, extensions
AS $fn$
  SELECT COALESCE((
    pg_catalog.jsonb_typeof(p_input)='object'
    AND p_input->>'contractVersion'='designpro.calls-1-7-input.v3'
    AND p_input->>'pipelineMode'='flat-first-atlas-v1'
    AND NOT (p_input ?| ARRAY['orderNumber','delivery'])
    AND (p_input - ARRAY[
      'contractVersion','pipelineMode','vehicle','brief','designName','mode',
      'companyName','phone','website','logoAsset','businessName','industry',
      'colors','style','finish','substrate','mascot','bulletPoints',
      'brandColors','fontStyle','qrEnabled','qrUrl','visionBoardImages',
      'visionboardIntent','styleDescriptors','textLayerPrompt'
    ]) = '{}'::jsonb
    AND NULLIF(pg_catalog.btrim(p_input->>'brief'),'') IS NOT NULL
    AND pg_catalog.length(p_input->>'brief')<=8000
    AND NULLIF(pg_catalog.btrim(p_input->>'designName'),'') IS NOT NULL
    AND pg_catalog.length(p_input->>'designName')<=240
    AND (NOT p_input ? 'mode' OR p_input->>'mode'=ANY(ARRAY['restyle','commercial']))
    AND pg_catalog.jsonb_typeof(p_input->'vehicle')='object'
    AND NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,year}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,make}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,model}'),'') IS NOT NULL
    AND p_input#>>'{vehicle,type}'=ANY(ARRAY[
      'car','truck','suv','van','motorcycle','boat','bus','rv','trailer',
      'aircraft','heavy_equipment'
    ])
    AND designpro_private.calls_1_7_design_fields_valid(p_input)
    AND pg_catalog.octet_length(p_input::text)<=262144
    AND NOT designpro_private.generation_input_has_server_controls(p_input)
  ),false)
$fn$;

COMMENT ON FUNCTION designpro_private.calls_1_7_asset_identity_valid(jsonb,text) IS
  'Closed verified upload identity. Raw/signed URLs and caller-added identity keys are refused.';
COMMENT ON FUNCTION designpro_private.calls_1_7_design_fields_valid(jsonb) IS
  'Bounded customer-authored DesignIQ fields shared by Calls 1-7 v2 and v3.';
COMMENT ON FUNCTION designpro_private.calls_1_7_input_v2_valid(jsonb) IS
  'Design-first Calls 1-7 input with the bounded DesignIQ customer field contract; no fulfillment identity.';
COMMENT ON FUNCTION designpro_private.calls_1_7_input_v3_valid(jsonb) IS
  'Flat-first Atlas Calls 1-7 input with the same bounded DesignIQ fields and exact pipeline opt-in.';

REVOKE ALL ON FUNCTION designpro_private.calls_1_7_asset_identity_valid(jsonb,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.calls_1_7_design_fields_valid(jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.calls_1_7_input_v2_valid(jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.calls_1_7_input_v3_valid(jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

-- Shape and hashes are insufficient authorization. The authenticated intake
-- RPCs are callable without the gateway, while the runtime downloads with a
-- service key. Bind every admitted customer asset to the exact owner and the
-- generation ID that names this immutable design at the table boundary.
CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_asset_paths_bound(
  p_input jsonb,
  p_owner_id uuid,
  p_generation_id uuid
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT COALESCE(
    (
      NOT p_input ? 'logoAsset'
      OR p_input#>>'{logoAsset,storagePath}' LIKE
        'users/'||p_owner_id::text||'/revisions/'||p_generation_id::text
        ||'/inputs/logo/%'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(
        COALESCE(p_input->'visionBoardImages','[]'::jsonb)
      ) identity(value)
      WHERE identity.value->>'storagePath' NOT LIKE
        'users/'||p_owner_id::text||'/revisions/'||p_generation_id::text
        ||'/inputs/attachment/%'
    ),
    false
  )
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.validate_calls_1_7_asset_paths()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, designpro_private
AS $fn$
BEGIN
  IF NEW.request_input->>'contractVersion' IN (
    'designpro.calls-1-7-input.v2','designpro.calls-1-7-input.v3'
  ) AND NOT designpro_private.calls_1_7_asset_paths_bound(
    NEW.request_input,NEW.owner_id,NEW.generation_id
  ) THEN
    RAISE EXCEPTION 'generation_asset_owner_generation_mismatch';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER designpro_generation_request_asset_paths_bound
  BEFORE INSERT OR UPDATE ON public.designpro_generation_requests
  FOR EACH ROW EXECUTE FUNCTION designpro_private.validate_calls_1_7_asset_paths();

REVOKE ALL ON FUNCTION designpro_private.calls_1_7_asset_paths_bound(jsonb,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.validate_calls_1_7_asset_paths()
  FROM PUBLIC,anon,authenticated,service_role;

-- One durable row means one Atlas master-authoring spend. It is claimed while
-- the request lease token is current and is never cleared on lease expiry, so
-- an interrupted attempt cannot be silently repeated by another worker.
CREATE TABLE designpro_private.flat_atlas_authoring_fences (
  request_id uuid PRIMARY KEY REFERENCES public.designpro_generation_requests(id)
    ON DELETE RESTRICT,
  generation_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  claim_token uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE TRIGGER designpro_flat_atlas_authoring_fences_immutable
  BEFORE UPDATE OR DELETE ON designpro_private.flat_atlas_authoring_fences
  FOR EACH ROW EXECUTE FUNCTION designpro_private.reject_flat_atlas_mutation();

CREATE OR REPLACE FUNCTION public.claim_designpro_flat_atlas_authoring(
  p_request_id uuid,
  p_claim_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, designpro_private
AS $fn$
DECLARE
  v_request public.designpro_generation_requests%ROWTYPE;
  v_inserted integer:=0;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_request_id IS NULL OR p_claim_token IS NULL
  THEN RAISE EXCEPTION 'flat_atlas_authoring_claim_invalid'; END IF;

  SELECT * INTO v_request
  FROM public.designpro_generation_requests
  WHERE id=p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.state<>'leased'
    OR v_request.lease_token IS DISTINCT FROM p_claim_token
  THEN RAISE EXCEPTION 'generation_lease_lost'; END IF;
  IF v_request.request_input->>'contractVersion'<>'designpro.calls-1-7-input.v3'
    OR v_request.request_input->>'pipelineMode'<>'flat-first-atlas-v1'
  THEN RAISE EXCEPTION 'flat_atlas_request_identity_mismatch'; END IF;

  INSERT INTO designpro_private.flat_atlas_authoring_fences(
    request_id,generation_id,owner_id,claim_token
  ) VALUES(
    v_request.id,v_request.generation_id,v_request.owner_id,p_claim_token
  ) ON CONFLICT(request_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  RETURN v_inserted=1;
END
$fn$;

REVOKE ALL ON TABLE designpro_private.flat_atlas_authoring_fences
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_designpro_flat_atlas_authoring(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_designpro_flat_atlas_authoring(uuid,uuid)
  TO service_role;

DROP POLICY IF EXISTS designpro_owner_read_flat_atlas_previews
  ON storage.objects;
CREATE POLICY designpro_owner_read_flat_atlas_previews
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id='wrap-files'
    AND storage.allow_only_operation('object.sign')
    AND EXISTS (
      SELECT 1
      FROM public.designpro_flat_atlas_revisions revision
      WHERE revision.owner_id=(SELECT auth.uid())
        AND (
          storage.objects.name=revision.guide_storage_path
          OR storage.objects.name=revision.master_storage_path
        )
    )
  );

COMMENT ON POLICY designpro_owner_read_flat_atlas_previews ON storage.objects IS
  'Owner-only signing access to exact immutable Atlas guide/master rows. Listing, direct download, manifest and projection paths are excluded.';
