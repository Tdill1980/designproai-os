-- The seventh Calls 1-7 slot becomes a true hero 3D view, and the production
-- handoff it was blocking is opened.
--
-- The revision contract downstream accepts the roles
-- driver/passenger/hood/roof/front/rear/hero3d (VIEW_KEYS in
-- gemini-flat-surface.cjs). It has no 'closeup' role, so while the plan's
-- seventh slot was a close-up, complete_designpro_generation_request reported
-- handoffReady=false with source_close_up_has_no_verified_hero3d_role_mapping,
-- permanently, and generated views could never reach Calls 8-12.
--
-- Aliasing close-up onto hero3d would satisfy the type checker and put a
-- two-square-foot panel detail where every downstream proof expects a whole
-- vehicle. The slot is regenerated as a real three-quarter hero angle instead.
--
-- close-up/closeup remain permitted values so existing rows stay valid; they are
-- simply no longer part of the seven-view plan.

ALTER TABLE public.designpro_generation_views
  DROP CONSTRAINT IF EXISTS designpro_generation_views_source_view_type_check,
  ADD CONSTRAINT designpro_generation_views_source_view_type_check
    CHECK (source_view_type IN ('side','passenger-side','hood_detail','front','rear','close-up','hero-3d','roof'));

ALTER TABLE public.designpro_generation_views
  DROP CONSTRAINT IF EXISTS designpro_generation_views_consumer_role_check,
  ADD CONSTRAINT designpro_generation_views_consumer_role_check
    CHECK (consumer_role IN ('driver','passenger','hood','front','rear','closeup','hero3d','roof'));

ALTER TABLE public.designpro_generation_attempts
  DROP CONSTRAINT IF EXISTS designpro_generation_attempts_source_view_type_check,
  ADD CONSTRAINT designpro_generation_attempts_source_view_type_check
    CHECK (source_view_type IN ('side','passenger-side','hood_detail','front','rear','close-up','hero-3d','roof'));

ALTER TABLE public.designpro_generation_slots
  DROP CONSTRAINT IF EXISTS designpro_generation_slots_source_view_type_check,
  ADD CONSTRAINT designpro_generation_slots_source_view_type_check
    CHECK (source_view_type IN ('side','passenger-side','hood_detail','front','rear','close-up','hero-3d','roof'));

CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_view_plan()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('sourceViewType','side','consumerRole','driver'),
    pg_catalog.jsonb_build_object('sourceViewType','passenger-side','consumerRole','passenger'),
    pg_catalog.jsonb_build_object('sourceViewType','hood_detail','consumerRole','hood'),
    pg_catalog.jsonb_build_object('sourceViewType','front','consumerRole','front'),
    pg_catalog.jsonb_build_object('sourceViewType','rear','consumerRole','rear'),
    pg_catalog.jsonb_build_object('sourceViewType','hero-3d','consumerRole','hero3d'),
    pg_catalog.jsonb_build_object('sourceViewType','roof','consumerRole','roof')
  )
$fn$;

REVOKE ALL ON FUNCTION designpro_private.calls_1_7_view_plan() FROM PUBLIC, anon, authenticated;

-- handoffReady stops being a hardcoded false. It is decided by evidence: the
-- seven persisted views must cover exactly the roles the plan names, each with a
-- distinct byte identity. Anything else keeps the handoff shut and says why.
CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_handoff_state(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog','public'
AS $fn$
DECLARE
  v_expected text[];
  v_actual text[];
  v_distinct integer;
  v_count integer;
BEGIN
  SELECT pg_catalog.array_agg(item->>'consumerRole' ORDER BY item->>'consumerRole')
  INTO v_expected
  FROM pg_catalog.jsonb_array_elements(designpro_private.calls_1_7_view_plan()) item;

  SELECT pg_catalog.array_agg(consumer_role ORDER BY consumer_role),
         pg_catalog.count(DISTINCT content_hash), pg_catalog.count(*)
  INTO v_actual, v_distinct, v_count
  FROM public.designpro_generation_views
  WHERE request_id=p_request_id;

  IF v_count IS NULL OR v_count<>7 THEN
    RETURN pg_catalog.jsonb_build_object('handoffReady',false,'handoffBlocker','seven_generation_views_required');
  END IF;
  IF v_distinct<>7 THEN
    RETURN pg_catalog.jsonb_build_object('handoffReady',false,'handoffBlocker','generation_views_must_be_byte_distinct');
  END IF;
  IF v_actual IS DISTINCT FROM v_expected THEN
    RETURN pg_catalog.jsonb_build_object('handoffReady',false,'handoffBlocker','generation_view_roles_do_not_match_plan');
  END IF;
  RETURN pg_catalog.jsonb_build_object('handoffReady',true,'handoffBlocker',NULL);
END
$fn$;

REVOKE ALL ON FUNCTION designpro_private.calls_1_7_handoff_state(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_designpro_generation_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_row public.designpro_generation_requests%ROWTYPE;
  v_views jsonb;
  v_handoff jsonb;
BEGIN
  SELECT * INTO v_row FROM public.designpro_generation_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
     AND v_row.owner_id IS DISTINCT FROM auth.uid()
  THEN RAISE EXCEPTION 'generation_request_not_visible'; END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'sourceViewType',source_view_type,'consumerRole',consumer_role,
    'contentHash',content_hash,'byteSize',byte_size,'contentType',content_type,
    'createdAt',created_at
  ) ORDER BY source_view_type),'[]'::jsonb)
  INTO v_views FROM public.designpro_generation_views WHERE request_id=v_row.id;

  v_handoff:=designpro_private.calls_1_7_handoff_state(v_row.id);

  RETURN pg_catalog.jsonb_build_object(
    'requestId',v_row.id,'generationId',v_row.generation_id,'state',v_row.state,
    'inputHash',v_row.input_hash,'engineContractHash',v_row.engine_contract_hash,
    'attempt',v_row.attempt,'outputSetHash',v_row.output_set_hash,
    'failureCode',v_row.error->>'code',
    'createdAt',v_row.created_at,'updatedAt',v_row.updated_at,
    'completedAt',v_row.completed_at,
    'handoffReady',v_handoff->'handoffReady',
    'handoffBlocker',v_handoff->>'handoffBlocker',
    'views',v_views
  );
END;
$function$;

-- The Calls 1-7 -> Calls 8-12 handoff, performed by the authenticated owner.
--
-- It cannot be done by the runtime worker: save_designpro_revision_source
-- demands an 'authenticated' JWT and refuses a service role. The worker's job is
-- to copy the accepted bytes to the revision input paths; this turns them into a
-- frozen revision and starts the existing production workflow. Nothing about
-- Calls 8-12 changes - it targets the same contract the upload path uses.
CREATE OR REPLACE FUNCTION public.handoff_designpro_generation_to_production(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','extensions'
AS $function$
DECLARE
  v_owner uuid:=auth.uid();
  v_row public.designpro_generation_requests%ROWTYPE;
  v_handoff jsonb;
  v_revision uuid;
  v_render jsonb:='{}'::jsonb;
  v_view record;
  v_extension text;
  v_recipient designpro_private.wrapbox_delivery_recipients%ROWTYPE;
  v_delivery jsonb;
  v_snapshot jsonb;
  v_saved jsonb;
  v_workflow jsonb;
  v_design_name text;
  v_idempotency text;
BEGIN
  IF v_owner IS NULL OR COALESCE(auth.jwt()->>'is_anonymous','false')='true'
  THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_row FROM public.designpro_generation_requests
  WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_row.owner_id IS DISTINCT FROM v_owner
  THEN RAISE EXCEPTION 'generation_request_not_visible'; END IF;
  IF v_row.state<>'outputs_ready' THEN RAISE EXCEPTION 'generation_outputs_not_ready'; END IF;

  v_handoff:=designpro_private.calls_1_7_handoff_state(v_row.id);
  IF (v_handoff->>'handoffReady')<>'true'
  THEN RAISE EXCEPTION 'generation_handoff_blocked: %', COALESCE(v_handoff->>'handoffBlocker','unknown'); END IF;

  v_revision:=NULLIF(v_row.engine_receipt->>'handoffRevisionId','')::uuid;
  IF v_revision IS NULL THEN RAISE EXCEPTION 'generation_handoff_revision_missing'; END IF;

  IF EXISTS (SELECT 1 FROM public.designpro_revision_sources WHERE revision_id=v_revision) THEN
    RETURN pg_catalog.jsonb_build_object('revisionId',v_revision,
      'generationId',v_row.generation_id,'alreadyHandedOff',true);
  END IF;

  FOR v_view IN
    SELECT consumer_role, content_hash, byte_size, content_type
    FROM public.designpro_generation_views WHERE request_id=v_row.id
    ORDER BY consumer_role
  LOOP
    IF v_view.consumer_role='closeup' THEN CONTINUE; END IF;
    v_extension:=CASE v_view.content_type
      WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg'
      WHEN 'image/webp' THEN 'webp' ELSE NULL END;
    IF v_extension IS NULL THEN RAISE EXCEPTION 'generation_view_identity_invalid'; END IF;
    v_render:=v_render || pg_catalog.jsonb_build_object(
      v_view.consumer_role,
      pg_catalog.jsonb_build_object(
        'storagePath','users/'||v_owner::text||'/revisions/'||v_revision::text
          ||'/inputs/'||v_view.consumer_role||'/'||v_view.content_hash||'.'||v_extension,
        'contentHash',v_view.content_hash,
        'byteSize',v_view.byte_size,
        'contentType',v_view.content_type
      )
    );
  END LOOP;

  SELECT * INTO v_recipient FROM designpro_private.wrapbox_delivery_recipients
  WHERE recipient_identity_hash=v_row.request_input#>>'{delivery,recipientIdentityHash}'
    AND order_number=v_row.request_input->>'orderNumber';
  IF NOT FOUND THEN RAISE EXCEPTION 'wrapbox_recipient_binding_missing'; END IF;

  v_design_name:=NULLIF(pg_catalog.btrim(COALESCE(v_row.request_input->>'designName','')),'');
  IF v_design_name IS NULL THEN v_design_name:=v_row.request_input->>'orderNumber'; END IF;

  v_delivery:=pg_catalog.jsonb_build_object(
    'contractVersion','designpro.wrapbox-recipient.v1',
    'customerId',v_recipient.customer_id,
    'customerEmail',v_recipient.customer_email,
    'recipientIdentityHash',v_recipient.recipient_identity_hash,
    'orderNumber',v_recipient.order_number,
    'designName',v_design_name
  );

  v_snapshot:=pg_catalog.jsonb_build_object(
    'contractVersion','designpro.revision-snapshot.v1',
    'revisionId',v_revision,
    'generationId',v_row.generation_id,
    'visualizationId',v_row.id,
    'designId','DID-'||pg_catalog.upper(pg_catalog.left(
      pg_catalog.replace(v_row.generation_id::text,'-',''),8)),
    'vehicle',v_row.request_input->'vehicle',
    'surfaceOptions',pg_catalog.jsonb_build_object('required',
      pg_catalog.jsonb_build_array('driver','passenger','hood','roof','front','rear')),
    'finish',COALESCE(v_row.request_input->>'finish','standard'),
    'bodyText',COALESCE(v_row.request_input->>'brief',''),
    'orderNumber',v_recipient.order_number,
    'logoInventoryAttestation',pg_catalog.jsonb_build_object(
      'mode','none','attested',true,'source','calls-1-7-generated'),
    'expectedLogoInventory',pg_catalog.jsonb_build_array(),
    'delivery',v_delivery,
    'renderAssets',v_render,
    'change',pg_catalog.jsonb_build_object(
      'view','all','instruction','Generated by Calls 1-7',
      'attachmentIds',pg_catalog.jsonb_build_array())
  );

  v_idempotency:='calls17-handoff:'||v_row.id::text;

  v_saved:=public.save_designpro_revision_source(
    v_revision, v_row.generation_id, v_row.id,
    pg_catalog.clock_timestamp(), v_snapshot, NULL, v_idempotency
  );

  v_workflow:=public.create_designpro_entice_workflow(
    v_revision, v_idempotency,
    pg_catalog.jsonb_build_object('trigger','revision.saved',
      'revisionSnapshotHash',v_saved->>'snapshotHash')
  );

  RETURN pg_catalog.jsonb_build_object(
    'revisionId',v_revision,
    'generationId',v_row.generation_id,
    'workflowRunId',v_workflow->>'workflowRunId',
    'alreadyHandedOff',false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.handoff_designpro_generation_to_production(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handoff_designpro_generation_to_production(uuid) TO authenticated, service_role;

-- Completion returns the evidence-based handoff verdict instead of a constant.
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
  v_handoff jsonb;
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
  v_handoff:=designpro_private.calls_1_7_handoff_state(v_request.id);

  RETURN pg_catalog.jsonb_build_object(
    'requestId',v_request.id,'generationId',v_request.generation_id,
    'state','outputs_ready','outputSetHash',v_output_hash,
    'handoffReady',v_handoff->'handoffReady',
    'handoffBlocker',v_handoff->>'handoffBlocker'
  );
END;
$function$;
