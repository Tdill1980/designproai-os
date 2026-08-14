-- complete_designpro_generation_request: validate in place, do not re-write.
--
-- The original body did DELETE FROM designpro_generation_views followed by a
-- re-INSERT of all seven rows from the payload. Two things make that wrong now:
--
-- 1. The Calls 1-7 engine persists each slot the moment it is accepted, so the
--    rows already exist by the time completion runs. Deleting them discards the
--    exact bytes identity the engine recorded and the attempt history points at.
-- 2. designpro_generation_view_no_delete now forbids the DELETE outright, since
--    an accepted view is a source Calls 8+ may already have hashed.
--
-- So completion becomes an assertion: every payload view must already be
-- persisted with identical identity. A view the worker never persisted is still
-- inserted, which keeps a single-shot caller that submits all seven at once
-- working unchanged. Nothing is ever deleted or mutated.

CREATE OR REPLACE FUNCTION public.complete_designpro_generation_request(
  p_request_id uuid,
  p_claim_token uuid,
  p_views jsonb,
  p_engine_receipt jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
  v_extension text;
  v_prefix text;
  v_output_hash text;
  v_existing public.designpro_generation_views%ROWTYPE;
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
    IF v_type='image/png' THEN v_extension:='.png';
    ELSIF v_type='image/jpeg' THEN v_extension:='.jpg';
    ELSIF v_type='image/webp' THEN v_extension:='.webp';
    ELSE RAISE EXCEPTION 'generation_view_identity_invalid'; END IF;
    IF v_expected_role IS NULL OR v_role<>v_expected_role
      OR v_path !~ '^[A-Za-z0-9._/-]+$' OR pg_catalog.strpos(v_path,'..')>0
      OR pg_catalog.left(v_path,pg_catalog.length(v_prefix))<>v_prefix
      OR v_hash !~ '^[0-9a-f]{64}$' OR v_bytes NOT BETWEEN 1 AND 536870912
      OR v_type NOT IN ('image/png','image/jpeg','image/webp')
      OR v_path<>v_prefix||v_source||'/'||v_hash||v_extension
    THEN RAISE EXCEPTION 'generation_view_identity_invalid'; END IF;

    SELECT * INTO v_existing FROM public.designpro_generation_views
    WHERE request_id=v_request.id AND source_view_type=v_source;

    IF FOUND THEN
      IF v_existing.consumer_role<>v_role
        OR v_existing.storage_path<>v_path
        OR v_existing.content_hash<>v_hash
        OR v_existing.byte_size<>v_bytes
        OR v_existing.content_type<>v_type
      THEN RAISE EXCEPTION 'accepted_generation_view_identity_conflict'; END IF;
    ELSE
      INSERT INTO public.designpro_generation_views(
        request_id,source_view_type,consumer_role,storage_path,content_hash,
        byte_size,content_type,metadata
      ) VALUES(
        v_request.id,v_source,v_role,v_path,v_hash,v_bytes,v_type,
        v_view->'metadata'
      );
    END IF;
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
END;
$function$;
