-- Standalone Calls 1-7 adapter. This migration creates only isolated
-- DesignProAI objects. It does not execute, seed, or reconnect any historical
-- project. The generation engine remains pinned by immutable source identities
-- and is claimed only by a service-role runtime.

CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_engine_contract()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'contractVersion','designpro.calls-1-7-engine.v1',
    'sourceCommit','bdb26365904e91be446894e84b01b4a24f64aac0',
    'sourceBlobs',pg_catalog.jsonb_build_object(
      'design-panel-ai-generate','4df3a9741c4f0721afb00b4db823fe7022147aa6',
      'generate-color-render','0eda353a80eb3e60b293d9a99ba3e7d69ab9f065',
      'generate-pattern-render','8114c56cbb1934569bf659a5f6957c680b9bf868',
      'generate-2d-proof','2946bc1ba26b374d21ae563f01bb464ee41477d2',
      'design-on-vehicle-photo','a962133b04c335754cf3df307505ed2da652bdda',
      'edit-vehicle-photo','3843e2b66a8583e16e514a545b7827cf77fade17',
      'studio-os','6870eaebab4d43ef8605d812416f86621727d3e9',
      'view-angles-os','03d6282d71faeec37d0fd304f3bc234d9a3cf0a4'
    ),
    'sourceViewOrder',pg_catalog.jsonb_build_array(
      'side','passenger-side','hood_detail','front','rear','close-up','roof'
    ),
    'freezePolicy','exact-source-blob-behavior'
  )
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_view_plan()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('sourceViewType','side','consumerRole','driver'),
    pg_catalog.jsonb_build_object('sourceViewType','passenger-side','consumerRole','passenger'),
    pg_catalog.jsonb_build_object('sourceViewType','hood_detail','consumerRole','hood'),
    pg_catalog.jsonb_build_object('sourceViewType','front','consumerRole','front'),
    pg_catalog.jsonb_build_object('sourceViewType','rear','consumerRole','rear'),
    pg_catalog.jsonb_build_object('sourceViewType','close-up','consumerRole','closeup'),
    pg_catalog.jsonb_build_object('sourceViewType','roof','consumerRole','roof')
  )
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.generation_input_has_server_controls_at(
  p_value jsonb,
  p_path text[]
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_key text;
  v_child jsonb;
  v_normalized text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_value)='object' THEN
    FOR v_key,v_child IN SELECT key,value FROM pg_catalog.jsonb_each(p_value)
    LOOP
      v_normalized := pg_catalog.lower(
        pg_catalog.regexp_replace(v_key,'[^a-zA-Z0-9]','','g')
      );
      IF v_normalized = ANY(ARRAY[
        'prompt','systemprompt','negativeprompt','model','imagemodel','seed',
        'temperature','topk','topp','viewangle','viewangles','cameraangle',
        'cameraangles','enginecontract','sourcecommit','sourceblobs'
      ]) AND NOT (v_normalized='model' AND p_path=ARRAY['vehicle'])
      THEN RETURN true; END IF;
      IF pg_catalog.jsonb_typeof(v_child) IN ('object','array')
        AND designpro_private.generation_input_has_server_controls_at(
          v_child,p_path||v_key
        )
      THEN RETURN true; END IF;
    END LOOP;
  ELSIF pg_catalog.jsonb_typeof(p_value)='array' THEN
    FOR v_child IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value)
    LOOP
      IF pg_catalog.jsonb_typeof(v_child) IN ('object','array')
        AND designpro_private.generation_input_has_server_controls_at(
          v_child,p_path||'[]'::text
        )
      THEN RETURN true; END IF;
    END LOOP;
  END IF;
  RETURN false;
END
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.generation_input_has_server_controls(
  p_value jsonb
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $fn$
  SELECT designpro_private.generation_input_has_server_controls_at(
    p_value,ARRAY[]::text[]
  )
$fn$;

CREATE TABLE public.designpro_generation_requests (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  generation_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tenant_key text NOT NULL CHECK (tenant_key='user_'||owner_id::text),
  idempotency_key text NOT NULL CHECK (
    pg_catalog.length(pg_catalog.btrim(idempotency_key)) BETWEEN 1 AND 200
    AND idempotency_key=pg_catalog.btrim(idempotency_key)
  ),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN (
    'queued','leased','retryable','outputs_ready','failed','cancelled'
  )),
  request_input jsonb NOT NULL CHECK (
    pg_catalog.jsonb_typeof(request_input)='object'
    AND request_input->>'contractVersion'='designpro.calls-1-7-input.v1'
    AND pg_catalog.jsonb_typeof(request_input->'vehicle')='object'
    AND NULLIF(pg_catalog.btrim(request_input#>>'{vehicle,year}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(request_input#>>'{vehicle,make}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(request_input#>>'{vehicle,model}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(request_input#>>'{vehicle,type}'),'') IS NOT NULL
    AND pg_catalog.octet_length(request_input::text)<=262144
    AND NOT designpro_private.generation_input_has_server_controls(request_input)
  ),
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  engine_contract jsonb NOT NULL CHECK (
    engine_contract=designpro_private.calls_1_7_engine_contract()
  ),
  engine_contract_hash text NOT NULL CHECK (
    engine_contract_hash ~ '^[0-9a-f]{64}$'
  ),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 12),
  available_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  output_set_hash text CHECK (
    output_set_hash IS NULL OR output_set_hash ~ '^[0-9a-f]{64}$'
  ),
  engine_receipt jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  UNIQUE(owner_id,generation_id),
  UNIQUE(tenant_key,idempotency_key),
  CONSTRAINT designpro_generation_lease_integrity CHECK (
    state<>'leased' OR (
      lease_owner IS NOT NULL AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
    )
  ),
  CONSTRAINT designpro_generation_completion_integrity CHECK (
    state<>'outputs_ready' OR (
      output_set_hash IS NOT NULL AND engine_receipt IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE TABLE public.designpro_generation_views (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.designpro_generation_requests(id)
    ON DELETE CASCADE,
  source_view_type text NOT NULL CHECK (source_view_type IN (
    'side','passenger-side','hood_detail','front','rear','close-up','roof'
  )),
  consumer_role text NOT NULL CHECK (consumer_role IN (
    'driver','passenger','hood','front','rear','closeup','roof'
  )),
  storage_path text NOT NULL CHECK (
    pg_catalog.btrim(storage_path)<>''
    AND storage_path ~ '^[A-Za-z0-9._/-]+$'
    AND pg_catalog.strpos(storage_path,'..')=0
  ),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 536870912),
  content_type text NOT NULL CHECK (
    content_type IN ('image/png','image/jpeg','image/webp')
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    pg_catalog.jsonb_typeof(metadata)='object'
  ),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE(request_id,source_view_type),
  UNIQUE(request_id,consumer_role),
  UNIQUE(request_id,storage_path),
  UNIQUE(request_id,content_hash),
  CONSTRAINT designpro_generation_view_content_address CHECK (
    pg_catalog.right(
      storage_path,
      pg_catalog.length('/'||source_view_type||'/'||content_hash||CASE content_type
        WHEN 'image/png' THEN '.png'
        WHEN 'image/jpeg' THEN '.jpg'
        WHEN 'image/webp' THEN '.webp'
      END)
    )='/'||source_view_type||'/'||content_hash||CASE content_type
      WHEN 'image/png' THEN '.png'
      WHEN 'image/jpeg' THEN '.jpg'
      WHEN 'image/webp' THEN '.webp'
    END
  )
);

CREATE INDEX IF NOT EXISTS designpro_generation_claim_idx
  ON public.designpro_generation_requests(state,available_at,created_at);
CREATE INDEX IF NOT EXISTS designpro_generation_owner_idx
  ON public.designpro_generation_requests(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS designpro_generation_views_request_idx
  ON public.designpro_generation_views(request_id,source_view_type);

ALTER TABLE public.designpro_generation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designpro_generation_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS designpro_owner_read_generation_requests
  ON public.designpro_generation_requests;
CREATE POLICY designpro_owner_read_generation_requests
ON public.designpro_generation_requests FOR SELECT TO authenticated
USING (owner_id=auth.uid());

DROP POLICY IF EXISTS designpro_owner_read_generation_views
  ON public.designpro_generation_views;
CREATE POLICY designpro_owner_read_generation_views
ON public.designpro_generation_views FOR SELECT TO authenticated
USING (EXISTS(
  SELECT 1 FROM public.designpro_generation_requests r
  WHERE r.id=request_id AND r.owner_id=auth.uid()
));

CREATE OR REPLACE FUNCTION public.create_designpro_generation_request(
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
  v_insert_count integer:=0;
  v_row public.designpro_generation_requests%ROWTYPE;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_generation_id IS NULL OR p_input IS NULL
    OR pg_catalog.jsonb_typeof(p_input)<>'object'
    OR p_input->>'contractVersion'<>'designpro.calls-1-7-input.v1'
    OR pg_catalog.jsonb_typeof(p_input->'vehicle')<>'object'
    OR NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,year}'),'') IS NULL
    OR NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,make}'),'') IS NULL
    OR NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,model}'),'') IS NULL
    OR NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,type}'),'') IS NULL
    OR pg_catalog.octet_length(p_input::text)>262144
    OR designpro_private.generation_input_has_server_controls(p_input)
    OR p_idempotency_key IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) NOT BETWEEN 1 AND 200
    OR p_idempotency_key<>pg_catalog.btrim(p_idempotency_key)
  THEN RAISE EXCEPTION 'generation_request_invalid'; END IF;

  v_tenant:='user_'||v_owner::text;
  v_input_hash:=pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_input::text,'UTF8'),'sha256'),'hex'
  );
  v_contract_hash:=pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_contract::text,'UTF8'),'sha256'),'hex'
  );

  INSERT INTO public.designpro_generation_requests(
    generation_id,owner_id,tenant_key,idempotency_key,request_input,input_hash,
    engine_contract,engine_contract_hash
  ) VALUES(
    p_generation_id,v_owner,v_tenant,p_idempotency_key,p_input,v_input_hash,
    v_contract,v_contract_hash
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_insert_count=ROW_COUNT;

  SELECT * INTO v_row FROM public.designpro_generation_requests
  WHERE owner_id=v_owner AND generation_id=p_generation_id;
  IF NOT FOUND OR v_row.idempotency_key<>p_idempotency_key
    OR v_row.input_hash<>v_input_hash OR v_row.engine_contract<>v_contract
  THEN RAISE EXCEPTION 'generation_request_identity_conflict'; END IF;

  RETURN pg_catalog.jsonb_build_object(
    'requestId',v_row.id,'generationId',v_row.generation_id,
    'state',v_row.state,'inputHash',v_row.input_hash,
    'engineContractHash',v_row.engine_contract_hash,
    'createdAt',v_row.created_at,'idempotent',v_insert_count=0
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.claim_designpro_generation_request(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 900
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_row public.designpro_generation_requests%ROWTYPE;
  v_token uuid;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF pg_catalog.length(pg_catalog.btrim(COALESCE(p_worker_id,''))) NOT BETWEEN 1 AND 160
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 1800
  THEN RAISE EXCEPTION 'generation_claim_invalid'; END IF;

  SELECT * INTO v_row
  FROM public.designpro_generation_requests
  WHERE (
    state IN ('queued','retryable') AND available_at<=pg_catalog.clock_timestamp()
  ) OR (
    state='leased' AND lease_expires_at<=pg_catalog.clock_timestamp()
  )
  ORDER BY available_at,created_at,id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_row.attempt>=12 THEN
    UPDATE public.designpro_generation_requests
    SET state='failed',error='{"code":"generation_attempt_limit"}'::jsonb,
      updated_at=pg_catalog.clock_timestamp(),lease_owner=NULL,lease_token=NULL,
      lease_expires_at=NULL
    WHERE id=v_row.id;
    RETURN NULL;
  END IF;

  v_token:=extensions.gen_random_uuid();
  UPDATE public.designpro_generation_requests
  SET state='leased',attempt=attempt+1,lease_owner=pg_catalog.btrim(p_worker_id),
    lease_token=v_token,
    lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),
    updated_at=pg_catalog.clock_timestamp(),error=NULL
  WHERE id=v_row.id
  RETURNING * INTO v_row;

  RETURN pg_catalog.jsonb_build_object(
    'requestId',v_row.id,'generationId',v_row.generation_id,
    'tenantKey',v_row.tenant_key,'input',v_row.request_input,
    'inputHash',v_row.input_hash,'engineContract',v_row.engine_contract,
    'engineContractHash',v_row.engine_contract_hash,'attempt',v_row.attempt,
    'claimToken',v_row.lease_token,'leaseExpiresAt',v_row.lease_expires_at,
    'viewPlan',designpro_private.calls_1_7_view_plan()
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.heartbeat_designpro_generation_request(
  p_request_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer DEFAULT 900
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 1800
  THEN RAISE EXCEPTION 'generation_heartbeat_invalid'; END IF;
  UPDATE public.designpro_generation_requests
  SET lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),
    updated_at=pg_catalog.clock_timestamp()
  WHERE id=p_request_id AND state='leased' AND lease_token=p_claim_token
    AND lease_expires_at>pg_catalog.clock_timestamp();
  RETURN FOUND;
END
$fn$;

CREATE OR REPLACE FUNCTION public.complete_designpro_generation_request(
  p_request_id uuid,
  p_claim_token uuid,
  p_views jsonb,
  p_engine_receipt jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_request public.designpro_generation_requests%ROWTYPE;
  v_view jsonb;
  v_source text;
  v_role text;
  v_expected_role text;
  v_path text;
  v_hash text;
  v_bytes bigint;
  v_type text;
  v_prefix text;
  v_output_hash text;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO v_request FROM public.designpro_generation_requests
  WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR p_claim_token IS NULL OR v_request.state<>'leased'
    OR v_request.lease_token IS DISTINCT FROM p_claim_token
    OR v_request.lease_expires_at<=pg_catalog.clock_timestamp()
  THEN RAISE EXCEPTION 'generation_lease_lost'; END IF;
  IF pg_catalog.jsonb_typeof(p_views) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(p_views)<>7
  THEN RAISE EXCEPTION 'exact_seven_generation_views_required'; END IF;
  IF pg_catalog.jsonb_typeof(p_engine_receipt) IS DISTINCT FROM 'object'
    OR p_engine_receipt->>'contractVersion' IS DISTINCT FROM 'designpro.calls-1-7-receipt.v1'
    OR p_engine_receipt->>'sourceCommit' IS DISTINCT FROM v_request.engine_contract->>'sourceCommit'
    OR p_engine_receipt->>'frozenContractHash' IS DISTINCT FROM v_request.engine_contract_hash
    OR p_engine_receipt->>'inputHash' IS DISTINCT FROM v_request.input_hash
    OR p_engine_receipt->>'byteVerified' IS DISTINCT FROM 'true'
    OR p_engine_receipt->>'callsCompleted' IS DISTINCT FROM '7'
  THEN RAISE EXCEPTION 'frozen_generation_engine_receipt_invalid'; END IF;

  v_prefix:='designpro/'||v_request.tenant_key||'/'
    ||v_request.generation_id::text||'/calls-1-7/';
  DELETE FROM public.designpro_generation_views WHERE request_id=v_request.id;
  FOR v_view IN SELECT value FROM pg_catalog.jsonb_array_elements(p_views)
  LOOP
    IF pg_catalog.jsonb_typeof(v_view)<>'object'
      OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_view))<>7
      OR NOT v_view ?& ARRAY[
        'sourceViewType','consumerRole','storagePath','contentHash',
        'byteSize','contentType','metadata'
      ]
      OR pg_catalog.jsonb_typeof(v_view->'metadata')<>'object'
    THEN RAISE EXCEPTION 'generation_view_identity_invalid'; END IF;
    v_source:=v_view->>'sourceViewType';
    v_role:=v_view->>'consumerRole';
    SELECT item->>'consumerRole' INTO v_expected_role
    FROM pg_catalog.jsonb_array_elements(designpro_private.calls_1_7_view_plan()) item
    WHERE item->>'sourceViewType'=v_source;
    v_path:=v_view->>'storagePath';
    v_hash:=pg_catalog.lower(v_view->>'contentHash');
    BEGIN v_bytes:=(v_view->>'byteSize')::bigint;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'generation_view_identity_invalid'; END;
    v_type:=pg_catalog.lower(v_view->>'contentType');
    IF v_expected_role IS NULL OR v_role<>v_expected_role
      OR v_path !~ '^[A-Za-z0-9._/-]+$' OR pg_catalog.strpos(v_path,'..')>0
      OR pg_catalog.left(v_path,pg_catalog.length(v_prefix))<>v_prefix
      OR v_hash !~ '^[0-9a-f]{64}$' OR v_bytes NOT BETWEEN 1 AND 536870912
      OR v_type NOT IN ('image/png','image/jpeg','image/webp')
      OR v_path<>v_prefix||v_source||'/'||v_hash||CASE v_type
        WHEN 'image/png' THEN '.png'
        WHEN 'image/jpeg' THEN '.jpg'
        WHEN 'image/webp' THEN '.webp'
      END
    THEN RAISE EXCEPTION 'generation_view_identity_invalid'; END IF;
    INSERT INTO public.designpro_generation_views(
      request_id,source_view_type,consumer_role,storage_path,content_hash,
      byte_size,content_type,metadata
    ) VALUES(
      v_request.id,v_source,v_role,v_path,v_hash,v_bytes,v_type,
      v_view->'metadata'
    );
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM public.designpro_generation_views
      WHERE request_id=v_request.id)<>7
  THEN RAISE EXCEPTION 'exact_seven_generation_views_required'; END IF;

  SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.string_agg(
      source_view_type||':'||consumer_role||':'||storage_path||':'
      ||content_hash||':'||byte_size::text||':'||content_type,E'\n'
      ORDER BY source_view_type
    ),'UTF8'),'sha256'),'hex')
  INTO v_output_hash FROM public.designpro_generation_views
  WHERE request_id=v_request.id;

  UPDATE public.designpro_generation_requests
  SET state='outputs_ready',output_set_hash=v_output_hash,
    engine_receipt=p_engine_receipt,completed_at=pg_catalog.clock_timestamp(),
    updated_at=pg_catalog.clock_timestamp(),lease_owner=NULL,lease_token=NULL,
    lease_expires_at=NULL,error=NULL
  WHERE id=v_request.id;
  RETURN pg_catalog.jsonb_build_object(
    'requestId',v_request.id,'generationId',v_request.generation_id,
    'state','outputs_ready','outputSetHash',v_output_hash,
    'handoffReady',false,
    'handoffBlocker','source_close_up_has_no_verified_hero3d_role_mapping'
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.fail_designpro_generation_request(
  p_request_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean DEFAULT true
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE v_attempt integer;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT attempt INTO v_attempt FROM public.designpro_generation_requests
  WHERE id=p_request_id AND state='leased' AND lease_token=p_claim_token
    AND lease_expires_at>pg_catalog.clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.designpro_generation_requests
  SET state=CASE WHEN COALESCE(p_retryable,false) AND v_attempt<12 THEN 'retryable' ELSE 'failed' END,
    available_at=CASE WHEN COALESCE(p_retryable,false) AND v_attempt<12
      THEN pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>LEAST(300,v_attempt*v_attempt*5))
      ELSE available_at END,
    error=pg_catalog.jsonb_build_object(
      'code',pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(p_error_code),''),'generation_failed'),160),
      'message',pg_catalog.left(COALESCE(p_error_message,'Generation failed'),1000),
      'retryable',COALESCE(p_retryable,false) AND v_attempt<12
    ),
    updated_at=pg_catalog.clock_timestamp(),lease_owner=NULL,lease_token=NULL,
    lease_expires_at=NULL
  WHERE id=p_request_id;
  RETURN true;
END
$fn$;

REVOKE ALL ON public.designpro_generation_requests,
  public.designpro_generation_views FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.designpro_generation_requests,
  public.designpro_generation_views TO authenticated;
GRANT ALL ON public.designpro_generation_requests,
  public.designpro_generation_views TO service_role;

REVOKE ALL ON FUNCTION designpro_private.calls_1_7_engine_contract()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.calls_1_7_view_plan()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.generation_input_has_server_controls(jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.generation_input_has_server_controls_at(jsonb,text[])
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_designpro_generation_request(uuid,jsonb,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_designpro_generation_request(text,integer)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.heartbeat_designpro_generation_request(uuid,uuid,integer)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.complete_designpro_generation_request(uuid,uuid,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fail_designpro_generation_request(uuid,uuid,text,text,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_designpro_generation_request(uuid,jsonb,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_designpro_generation_request(text,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_designpro_generation_request(uuid,uuid,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_designpro_generation_request(uuid,uuid,jsonb,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_designpro_generation_request(uuid,uuid,text,text,boolean)
  TO service_role;

COMMENT ON TABLE public.designpro_generation_requests IS
  'Isolated authenticated Calls 1-7 queue. Browser input cannot select prompts, models, seeds, source blobs, or view angles; only service-role workers may claim or complete.';
COMMENT ON TABLE public.designpro_generation_views IS
  'Seven immutable byte identities produced under the frozen source contract. close-up remains explicit and is not silently relabeled as hero3d.';
