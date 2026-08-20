-- FLAT-FIRST ATLAS V1 (ADDITIVE, FAIL-CLOSED).
--
-- v1 and v2 Calls 1-7 remain unchanged. A caller opts into this isolated path
-- only by sending the new v3 contract AND its one exact pipeline mode. The
-- guide, manifest, generated master and every later revision are append-only;
-- switching the application flag off therefore returns to v2 without moving or
-- rewriting any existing design.

CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_input_v3_valid(
  p_input jsonb
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, extensions
AS $fn$
  SELECT
    pg_catalog.jsonb_typeof(p_input)='object'
    AND p_input->>'contractVersion'='designpro.calls-1-7-input.v3'
    AND p_input->>'pipelineMode'='flat-first-atlas-v1'
    AND NOT (p_input ?| ARRAY['orderNumber','delivery'])
    AND (p_input - ARRAY[
      'contractVersion','pipelineMode','vehicle','brief','designName','mode',
      'companyName','phone','website','logoAsset','businessName','industry',
      'colors','style'
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
    AND pg_catalog.octet_length(p_input::text)<=262144
    AND NOT designpro_private.generation_input_has_server_controls(p_input)
$fn$;

COMMENT ON FUNCTION designpro_private.calls_1_7_input_v3_valid(jsonb) IS
  'Opt-in flat-first Calls 1-7 input. Requires the exact flat-first-atlas-v1 '
  'pipeline mode; legacy v1/v2 contracts are not reinterpreted.';

ALTER TABLE public.designpro_generation_requests
  DROP CONSTRAINT designpro_generation_requests_request_input_check;

ALTER TABLE public.designpro_generation_requests
  ADD CONSTRAINT designpro_generation_requests_request_input_check CHECK (
    pg_catalog.jsonb_typeof(request_input)='object'
    AND (
      designpro_private.calls_1_7_input_v3_valid(request_input)
      OR designpro_private.calls_1_7_input_v2_valid(request_input)
      OR (
        request_input->>'contractVersion'='designpro.calls-1-7-input.v1'
        AND NULLIF(pg_catalog.btrim(request_input->>'orderNumber'),'') IS NOT NULL
        AND request_input->>'orderNumber'=pg_catalog.btrim(request_input->>'orderNumber')
        AND request_input->>'orderNumber' ~ '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
        AND pg_catalog.jsonb_typeof(request_input->'delivery')='object'
        AND (request_input->'delivery') ?& ARRAY[
          'contractVersion','recipientIdentityHash','orderNumber'
        ]
        AND (request_input->'delivery') - ARRAY[
          'contractVersion','recipientIdentityHash','orderNumber'
        ] = '{}'::jsonb
        AND request_input#>>'{delivery,contractVersion}'='designpro.wrapbox-recipient.v1'
        AND request_input#>>'{delivery,recipientIdentityHash}' ~ '^[0-9a-f]{64}$'
        AND request_input#>>'{delivery,orderNumber}'=request_input->>'orderNumber'
        AND pg_catalog.jsonb_typeof(request_input->'vehicle')='object'
        AND NULLIF(pg_catalog.btrim(request_input#>>'{vehicle,year}'),'') IS NOT NULL
        AND NULLIF(pg_catalog.btrim(request_input#>>'{vehicle,make}'),'') IS NOT NULL
        AND NULLIF(pg_catalog.btrim(request_input#>>'{vehicle,model}'),'') IS NOT NULL
        AND NULLIF(pg_catalog.btrim(request_input#>>'{vehicle,type}'),'') IS NOT NULL
        AND request_input#>>'{vehicle,type}'=ANY(ARRAY[
          'car','truck','suv','van','motorcycle','boat','bus','rv','trailer',
          'aircraft','heavy_equipment'
        ])
        AND pg_catalog.octet_length(request_input::text)<=262144
        AND NOT designpro_private.generation_input_has_server_controls(request_input)
      )
    )
  );

ALTER TABLE public.designpro_generation_requests
  DROP CONSTRAINT designpro_generation_request_identity;

ALTER TABLE public.designpro_generation_requests
  ADD CONSTRAINT designpro_generation_request_identity CHECK (
    CASE
      WHEN request_input->>'contractVersion'=ANY(ARRAY[
        'designpro.calls-1-7-input.v2','designpro.calls-1-7-input.v3'
      ]) THEN idempotency_key='calls17:'||generation_id::text||':'||input_hash
      ELSE idempotency_key='calls17:'||generation_id::text||':'
        ||(request_input#>>'{delivery,recipientIdentityHash}')||':'
        ||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
          request_input->>'orderNumber','UTF8'
        ),'sha256'),'hex')
    END
  );

-- A separate v3 intake RPC is the rollback boundary. The existing v1/v2 RPC is
-- byte-for-byte untouched, so disabling the feature does not leave old callers
-- executing new branching logic.
CREATE OR REPLACE FUNCTION public.create_designpro_flat_first_generation_request(
  p_generation_id uuid,
  p_input jsonb,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_owner uuid:=auth.uid();
  v_tenant text;
  v_input_hash text;
  v_contract jsonb:=designpro_private.calls_1_7_engine_contract();
  v_contract_hash text;
  v_expected_idempotency text;
  v_active_count integer;
  v_row public.designpro_generation_requests%ROWTYPE;
BEGIN
  IF v_owner IS NULL OR COALESCE(auth.jwt()->>'is_anonymous','false')='true'
  THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_generation_id IS NULL
    OR NOT designpro_private.calls_1_7_input_v3_valid(p_input)
  THEN RAISE EXCEPTION 'generation_request_invalid'; END IF;

  v_tenant:='user_'||v_owner::text;
  v_input_hash:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(p_input::text,'UTF8'),'sha256'
  ),'hex');
  v_contract_hash:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_contract::text,'UTF8'),'sha256'
  ),'hex');
  v_expected_idempotency:='calls17:'||p_generation_id::text||':'||v_input_hash;
  IF p_idempotency_key IS NOT NULL
    AND p_idempotency_key IS DISTINCT FROM v_expected_idempotency
  THEN RAISE EXCEPTION 'generation_request_invalid'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'designpro.calls-1-7.owner:'||v_owner::text,0
  ));

  SELECT * INTO v_row FROM public.designpro_generation_requests
  WHERE owner_id=v_owner AND generation_id=p_generation_id;
  IF FOUND THEN
    IF v_row.input_hash<>v_input_hash
    THEN RAISE EXCEPTION 'generation_input_conflict'; END IF;
    IF v_row.idempotency_key<>v_expected_idempotency
      OR v_row.engine_contract<>v_contract
    THEN RAISE EXCEPTION 'generation_request_identity_conflict'; END IF;
    RETURN pg_catalog.jsonb_build_object(
      'requestId',v_row.id,'generationId',v_row.generation_id,
      'state',v_row.state,'inputHash',v_row.input_hash,
      'engineContractHash',v_row.engine_contract_hash,
      'createdAt',v_row.created_at,'idempotent',true
    );
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_active_count
  FROM public.designpro_generation_requests
  WHERE owner_id=v_owner AND state IN ('queued','leased','retryable');
  IF v_active_count>=1
  THEN RAISE EXCEPTION 'generation_active_request_limit'; END IF;

  INSERT INTO public.designpro_generation_requests(
    generation_id,owner_id,tenant_key,idempotency_key,request_input,input_hash,
    engine_contract,engine_contract_hash
  ) VALUES(
    p_generation_id,v_owner,v_tenant,v_expected_idempotency,p_input,v_input_hash,
    v_contract,v_contract_hash
  )
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_row FROM public.designpro_generation_requests
  WHERE owner_id=v_owner AND generation_id=p_generation_id;
  IF NOT FOUND THEN
    IF EXISTS(
      SELECT 1 FROM public.designpro_generation_requests
      WHERE owner_id=v_owner AND state IN ('queued','leased','retryable')
    ) THEN RAISE EXCEPTION 'generation_active_request_limit'; END IF;
    RAISE EXCEPTION 'generation_request_identity_conflict';
  END IF;
  IF v_row.input_hash<>v_input_hash
  THEN RAISE EXCEPTION 'generation_input_conflict'; END IF;
  IF v_row.idempotency_key<>v_expected_idempotency
    OR v_row.engine_contract<>v_contract
  THEN RAISE EXCEPTION 'generation_request_identity_conflict'; END IF;

  RETURN pg_catalog.jsonb_build_object(
    'requestId',v_row.id,'generationId',v_row.generation_id,
    'state',v_row.state,'inputHash',v_row.input_hash,
    'engineContractHash',v_row.engine_contract_hash,
    'createdAt',v_row.created_at,'idempotent',false
  );
END;
$fn$;

-- Global examples are explicitly topology-only. They teach orientation,
-- masks, panel adjacency and seam continuity; they are not customer artwork and
-- contain no style prompt, palette or brand fields. No screenshot is seeded by
-- this migration.
CREATE TABLE public.designpro_flat_atlas_examples (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  example_key text NOT NULL CHECK (example_key ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  version integer NOT NULL CHECK (version>=1),
  purpose text NOT NULL DEFAULT 'topology-only' CHECK (purpose='topology-only'),
  guide_storage_path text NOT NULL,
  guide_content_hash text NOT NULL CHECK (guide_content_hash ~ '^[0-9a-f]{64}$'),
  guide_byte_size bigint NOT NULL CHECK (guide_byte_size BETWEEN 1 AND 1073741824),
  guide_content_type text NOT NULL CHECK (guide_content_type='image/png'),
  manifest_storage_path text NOT NULL,
  manifest_content_hash text NOT NULL CHECK (manifest_content_hash ~ '^[0-9a-f]{64}$'),
  manifest_byte_size bigint NOT NULL CHECK (manifest_byte_size BETWEEN 1 AND 16777216),
  manifest_content_type text NOT NULL CHECK (manifest_content_type='application/json'),
  master_storage_path text NOT NULL,
  master_content_hash text NOT NULL CHECK (master_content_hash ~ '^[0-9a-f]{64}$'),
  master_byte_size bigint NOT NULL CHECK (master_byte_size BETWEEN 1 AND 1073741824),
  master_content_type text NOT NULL CHECK (
    master_content_type IN ('image/png','image/jpeg','image/webp')
  ),
  manifest jsonb NOT NULL CHECK (
    pg_catalog.jsonb_typeof(manifest)='object'
    AND NOT (manifest ?| ARRAY['style','palette','brand','prompt','brief'])
  ),
  model text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(model)) BETWEEN 1 AND 160),
  prompt_version text NOT NULL CHECK (
    prompt_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
  ),
  width_px integer NOT NULL CHECK (width_px BETWEEN 256 AND 32768),
  height_px integer NOT NULL CHECK (height_px BETWEEN 256 AND 32768),
  effective_ppi numeric(10,3) NOT NULL CHECK (effective_ppi>0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    pg_catalog.jsonb_typeof(metadata)='object'
  ),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE(example_key,version),
  UNIQUE(id,guide_content_hash,master_content_hash),
  CONSTRAINT designpro_flat_atlas_example_paths CHECK (
    guide_storage_path ~ '^[A-Za-z0-9._/-]+$'
    AND manifest_storage_path ~ '^[A-Za-z0-9._/-]+$'
    AND master_storage_path ~ '^[A-Za-z0-9._/-]+$'
    AND pg_catalog.strpos(guide_storage_path,'..')=0
    AND pg_catalog.strpos(manifest_storage_path,'..')=0
    AND pg_catalog.strpos(master_storage_path,'..')=0
    AND guide_storage_path LIKE 'designpro/system/flat-first/examples/%'
    AND manifest_storage_path LIKE 'designpro/system/flat-first/examples/%'
    AND master_storage_path LIKE 'designpro/system/flat-first/examples/%'
    AND pg_catalog.right(guide_storage_path,69)='/'||guide_content_hash||'.png'
    AND pg_catalog.right(manifest_storage_path,70)='/'||manifest_content_hash||'.json'
    AND pg_catalog.right(master_storage_path,
      65+CASE master_content_type WHEN 'image/webp' THEN 5 ELSE 4 END
    )='/'||master_content_hash||CASE master_content_type
      WHEN 'image/png' THEN '.png' WHEN 'image/jpeg' THEN '.jpg' ELSE '.webp' END
  )
);

-- Enabling/disabling an example is itself append-only. The active view resolves
-- the most recent state; no example bytes or previous decision can be edited.
CREATE TABLE public.designpro_flat_atlas_example_states (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  example_id uuid NOT NULL REFERENCES public.designpro_flat_atlas_examples(id) ON DELETE RESTRICT,
  parent_state_id uuid REFERENCES public.designpro_flat_atlas_example_states(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence>=1),
  enabled boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE(example_id,sequence),
  CHECK ((parent_state_id IS NULL AND sequence=1) OR (parent_state_id IS NOT NULL AND sequence>1))
);

CREATE VIEW public.designpro_active_flat_atlas_examples
WITH (security_invoker=true) AS
SELECT e.*
FROM public.designpro_flat_atlas_examples e
JOIN LATERAL (
  SELECT s.enabled FROM public.designpro_flat_atlas_example_states s
  WHERE s.example_id=e.id ORDER BY s.sequence DESC LIMIT 1
) latest ON latest.enabled;

CREATE TABLE public.designpro_flat_atlas_revisions (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.designpro_generation_requests(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tenant_key text NOT NULL CHECK (tenant_key='user_'||owner_id::text),
  parent_revision_id uuid REFERENCES public.designpro_flat_atlas_revisions(id) ON DELETE RESTRICT,
  revision_sequence integer NOT NULL CHECK (revision_sequence>=1),
  guide_storage_path text NOT NULL,
  guide_content_hash text NOT NULL CHECK (guide_content_hash ~ '^[0-9a-f]{64}$'),
  guide_byte_size bigint NOT NULL CHECK (guide_byte_size BETWEEN 1 AND 1073741824),
  guide_content_type text NOT NULL CHECK (guide_content_type='image/png'),
  manifest_storage_path text NOT NULL,
  manifest_content_hash text NOT NULL CHECK (manifest_content_hash ~ '^[0-9a-f]{64}$'),
  manifest_byte_size bigint NOT NULL CHECK (manifest_byte_size BETWEEN 1 AND 16777216),
  manifest_content_type text NOT NULL CHECK (manifest_content_type='application/json'),
  master_storage_path text NOT NULL,
  master_content_hash text NOT NULL CHECK (master_content_hash ~ '^[0-9a-f]{64}$'),
  master_byte_size bigint NOT NULL CHECK (master_byte_size BETWEEN 1 AND 1073741824),
  master_content_type text NOT NULL CHECK (
    master_content_type IN ('image/png','image/jpeg','image/webp')
  ),
  -- Lossy transport for the seven proof-conditioning calls only. Production
  -- continues to trust and slice the canonical master_content_hash above.
  projection_storage_path text NOT NULL,
  projection_content_hash text NOT NULL CHECK (
    projection_content_hash ~ '^[0-9a-f]{64}$'
  ),
  projection_byte_size bigint NOT NULL CHECK (
    projection_byte_size BETWEEN 1 AND 12582912
  ),
  projection_content_type text NOT NULL CHECK (
    projection_content_type='image/jpeg'
  ),
  manifest jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(manifest)='object'),
  affected_surfaces text[] NOT NULL DEFAULT ARRAY[
    'driver','passenger','hood','roof','front','rear'
  ]::text[] CHECK (
    pg_catalog.cardinality(affected_surfaces) BETWEEN 1 AND 6
    AND affected_surfaces <@ ARRAY[
      'driver','passenger','hood','roof','front','rear'
    ]::text[]
  ),
  instruction text CHECK (
    instruction IS NULL OR pg_catalog.length(pg_catalog.btrim(instruction)) BETWEEN 1 AND 4000
  ),
  production_eligible boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    pg_catalog.jsonb_typeof(metadata)='object'
  ),
  model text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(model)) BETWEEN 1 AND 160),
  prompt_version text NOT NULL CHECK (
    prompt_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
  ),
  width_px integer NOT NULL CHECK (width_px BETWEEN 256 AND 32768),
  height_px integer NOT NULL CHECK (height_px BETWEEN 256 AND 32768),
  effective_ppi numeric(10,3) NOT NULL CHECK (effective_ppi>0),
  example_id uuid,
  example_guide_hash text,
  example_master_hash text,
  example_used boolean GENERATED ALWAYS AS (example_id IS NOT NULL) STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE(request_id,revision_sequence),
  UNIQUE(request_id,master_content_hash),
  UNIQUE(request_id,master_storage_path),
  UNIQUE(request_id,projection_storage_path),
  CONSTRAINT designpro_flat_atlas_example_identity FOREIGN KEY (
    example_id,example_guide_hash,example_master_hash
  ) REFERENCES public.designpro_flat_atlas_examples(
    id,guide_content_hash,master_content_hash
  ) MATCH FULL ON DELETE RESTRICT,
  CONSTRAINT designpro_flat_atlas_revision_lineage_shape CHECK (
    (parent_revision_id IS NULL AND revision_sequence=1)
    OR (parent_revision_id IS NOT NULL AND revision_sequence>1)
  ),
  CONSTRAINT designpro_flat_atlas_revision_not_self_parent CHECK (
    parent_revision_id IS DISTINCT FROM id
  ),
  CONSTRAINT designpro_flat_atlas_revision_paths CHECK (
    guide_storage_path ~ '^[A-Za-z0-9._/-]+$'
    AND manifest_storage_path ~ '^[A-Za-z0-9._/-]+$'
    AND master_storage_path ~ '^[A-Za-z0-9._/-]+$'
    AND projection_storage_path ~ '^[A-Za-z0-9._/-]+$'
    AND pg_catalog.strpos(guide_storage_path,'..')=0
    AND pg_catalog.strpos(manifest_storage_path,'..')=0
    AND pg_catalog.strpos(master_storage_path,'..')=0
    AND pg_catalog.strpos(projection_storage_path,'..')=0
    AND guide_storage_path LIKE
      'designpro/'||tenant_key||'/'||generation_id::text||'/flat-first/v1/%'
    AND manifest_storage_path LIKE
      'designpro/'||tenant_key||'/'||generation_id::text||'/flat-first/v1/%'
    AND master_storage_path=
      'designpro/'||tenant_key||'/'||generation_id::text
      ||'/flat-first/v1/revisions/'||revision_sequence::text
      ||'/master/'||master_content_hash||CASE master_content_type
        WHEN 'image/png' THEN '.png' WHEN 'image/jpeg' THEN '.jpg' ELSE '.webp' END
    AND projection_storage_path=
      'designpro/'||tenant_key||'/'||generation_id::text
      ||'/flat-first/v1/revisions/'||revision_sequence::text
      ||'/projection/'||projection_content_hash||'.jpg'
    AND pg_catalog.right(guide_storage_path,69)='/'||guide_content_hash||'.png'
    AND pg_catalog.right(manifest_storage_path,70)='/'||manifest_content_hash||'.json'
  )
);

CREATE INDEX designpro_flat_atlas_revisions_owner_idx
  ON public.designpro_flat_atlas_revisions(owner_id,created_at DESC);
CREATE INDEX designpro_flat_atlas_revisions_generation_idx
  ON public.designpro_flat_atlas_revisions(generation_id,revision_sequence DESC);

CREATE OR REPLACE FUNCTION designpro_private.validate_flat_atlas_revision_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_request public.designpro_generation_requests%ROWTYPE;
  v_parent public.designpro_flat_atlas_revisions%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.designpro_generation_requests
  WHERE id=NEW.request_id;
  IF NOT FOUND
    OR v_request.generation_id IS DISTINCT FROM NEW.generation_id
    OR v_request.owner_id IS DISTINCT FROM NEW.owner_id
    OR v_request.tenant_key IS DISTINCT FROM NEW.tenant_key
    OR v_request.request_input->>'contractVersion' IS DISTINCT FROM
      'designpro.calls-1-7-input.v3'
    OR v_request.request_input->>'pipelineMode' IS DISTINCT FROM
      'flat-first-atlas-v1'
  THEN RAISE EXCEPTION 'flat_atlas_request_identity_mismatch'; END IF;

  IF NEW.parent_revision_id IS NULL THEN
    IF NEW.revision_sequence<>1
    THEN RAISE EXCEPTION 'flat_atlas_revision_lineage_invalid'; END IF;
  ELSE
    SELECT * INTO v_parent FROM public.designpro_flat_atlas_revisions
    WHERE id=NEW.parent_revision_id;
    IF NOT FOUND
      OR v_parent.request_id IS DISTINCT FROM NEW.request_id
      OR v_parent.generation_id IS DISTINCT FROM NEW.generation_id
      OR v_parent.owner_id IS DISTINCT FROM NEW.owner_id
      OR NEW.revision_sequence<>v_parent.revision_sequence+1
    THEN RAISE EXCEPTION 'flat_atlas_revision_lineage_invalid'; END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.reject_flat_atlas_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
  RAISE EXCEPTION 'designpro_flat_atlas_row_is_immutable';
END;
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.validate_flat_atlas_example_state_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_parent public.designpro_flat_atlas_example_states%ROWTYPE;
BEGIN
  IF NEW.parent_state_id IS NULL THEN
    IF NEW.sequence<>1
    THEN RAISE EXCEPTION 'flat_atlas_example_state_lineage_invalid'; END IF;
  ELSE
    SELECT * INTO v_parent FROM public.designpro_flat_atlas_example_states
    WHERE id=NEW.parent_state_id;
    IF NOT FOUND
      OR v_parent.example_id IS DISTINCT FROM NEW.example_id
      OR NEW.sequence<>v_parent.sequence+1
    THEN RAISE EXCEPTION 'flat_atlas_example_state_lineage_invalid'; END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER designpro_flat_atlas_revision_validate
  BEFORE INSERT ON public.designpro_flat_atlas_revisions
  FOR EACH ROW EXECUTE FUNCTION designpro_private.validate_flat_atlas_revision_insert();

CREATE TRIGGER designpro_flat_atlas_example_state_validate
  BEFORE INSERT ON public.designpro_flat_atlas_example_states
  FOR EACH ROW EXECUTE FUNCTION designpro_private.validate_flat_atlas_example_state_insert();

CREATE TRIGGER designpro_flat_atlas_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.designpro_flat_atlas_revisions
  FOR EACH ROW EXECUTE FUNCTION designpro_private.reject_flat_atlas_mutation();
CREATE TRIGGER designpro_flat_atlas_examples_immutable
  BEFORE UPDATE OR DELETE ON public.designpro_flat_atlas_examples
  FOR EACH ROW EXECUTE FUNCTION designpro_private.reject_flat_atlas_mutation();
CREATE TRIGGER designpro_flat_atlas_example_states_immutable
  BEFORE UPDATE OR DELETE ON public.designpro_flat_atlas_example_states
  FOR EACH ROW EXECUTE FUNCTION designpro_private.reject_flat_atlas_mutation();

ALTER TABLE public.designpro_flat_atlas_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designpro_flat_atlas_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designpro_flat_atlas_example_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY designpro_owner_read_flat_atlas_revisions
  ON public.designpro_flat_atlas_revisions FOR SELECT TO authenticated
  USING ((SELECT auth.uid())=owner_id);

-- The owner endpoint resolves paths under SECURITY DEFINER and returns NULL for
-- absent and other-owner request IDs alike. The gateway signs only guide/master
-- previews and never returns either path.
CREATE OR REPLACE FUNCTION public.designpro_flat_atlas_revision_paths(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_request public.designpro_generation_requests%ROWTYPE;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_request FROM public.designpro_generation_requests
  WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
    AND v_request.owner_id IS DISTINCT FROM auth.uid()
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
  WHERE r.request_id=v_request.id;
  RETURN v_rows;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.designpro_flat_first_handoff_gate(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_request public.designpro_generation_requests%ROWTYPE;
  v_atlas public.designpro_flat_atlas_revisions%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.designpro_generation_requests
  WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
    AND v_request.owner_id IS DISTINCT FROM auth.uid()
  THEN RETURN NULL; END IF;
  IF v_request.request_input->>'contractVersion'<>'designpro.calls-1-7-input.v3'
  THEN RETURN pg_catalog.jsonb_build_object(
    'flatFirst',false,'productionEligible',true,'revisionId',NULL
  ); END IF;
  SELECT * INTO v_atlas FROM public.designpro_flat_atlas_revisions
  WHERE request_id=v_request.id ORDER BY revision_sequence DESC LIMIT 1;
  RETURN pg_catalog.jsonb_build_object(
    'flatFirst',true,
    'productionEligible',COALESCE(v_atlas.production_eligible,false),
    'revisionId',v_atlas.id
  );
END;
$fn$;

REVOKE ALL ON public.designpro_flat_atlas_revisions,
  public.designpro_flat_atlas_examples,
  public.designpro_flat_atlas_example_states,
  public.designpro_active_flat_atlas_examples
  FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.designpro_flat_atlas_revisions TO authenticated;
GRANT SELECT,INSERT ON public.designpro_flat_atlas_revisions,
  public.designpro_flat_atlas_examples,
  public.designpro_flat_atlas_example_states TO service_role;
GRANT SELECT ON public.designpro_active_flat_atlas_examples TO service_role;

REVOKE ALL ON FUNCTION designpro_private.calls_1_7_input_v3_valid(jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.validate_flat_atlas_revision_insert()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.reject_flat_atlas_mutation()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.validate_flat_atlas_example_state_insert()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_designpro_flat_first_generation_request(uuid,jsonb,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.designpro_flat_atlas_revision_paths(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.designpro_flat_first_handoff_gate(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_designpro_flat_first_generation_request(uuid,jsonb,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.designpro_flat_atlas_revision_paths(uuid)
  TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designpro_flat_first_handoff_gate(uuid)
  TO authenticated,service_role;

COMMENT ON TABLE public.designpro_flat_atlas_revisions IS
  'Immutable flat-first lineage. Every row stores the exact deterministic before guide, coordinate manifest and generated after master; no object is overwritten.';
COMMENT ON TABLE public.designpro_flat_atlas_examples IS
  'Service-only allowlist of topology-only before/after examples. Customer style, palette, brand and design prompts are explicitly outside this table.';
