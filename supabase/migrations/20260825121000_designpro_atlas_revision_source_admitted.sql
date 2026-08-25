-- The revision source accepts an A.T.L.A.S. handoff.
--
-- Companion to 20260825120000, which admitted v3 into
-- `handoff_designpro_generation_to_production`. That opened the door; these
-- three gates were the frame it was still nailed to. All three were written
-- when v2 was the only design-first contract, and each refuses a v3 snapshot on
-- a literal string equality:
--
--   * the `designpro_revision_snapshot_contract` CHECK, whose unbound branch
--     required sourceInputContract = '...v2';
--   * `designpro_private.verify_revision_delivery_binding`, which proved the
--     unbound source against a v2 request and a v2 snapshot;
--   * `public.bind_designpro_revision_fulfillment`, which refuses to bind a
--     source whose contract is not v2 -- the WrapBox leg at the end of the
--     chain.
--
-- Each now admits v2 OR v3 and nothing else. The trigger additionally requires
-- the snapshot to name the SAME contract the request was created under, which
-- is strictly stronger than the pair of equalities it replaces: previously a
-- snapshot could only claim v2, now it must match, so a v2 run cannot present
-- itself as an atlas handoff or the reverse.
--
-- Nothing else moves. The bound/WrapBox branch, the seven-view provenance
-- proof, the operator and recipient checks, the storage path shapes and the
-- Close-Up identity are all carried verbatim from 20260821200000 /
-- 20260822060000.

ALTER TABLE public.designpro_revision_sources
  DROP CONSTRAINT IF EXISTS designpro_revision_snapshot_contract;
ALTER TABLE public.designpro_revision_sources
  ADD CONSTRAINT designpro_revision_snapshot_contract CHECK (
    snapshot->>'contractVersion'='designpro.revision-snapshot.v1'
    AND snapshot ?& ARRAY['generationId','designId','visualizationId']
    AND snapshot->>'generationId' IS NOT DISTINCT FROM generation_id::text
    AND snapshot->>'designId' IS NOT DISTINCT FROM 'DID-'||pg_catalog.upper(
      pg_catalog.substr(pg_catalog.replace(generation_id::text,'-',''),1,8)
    )
    AND snapshot->>'visualizationId'=visualization_id::text
    AND pg_catalog.jsonb_typeof(snapshot->'renderAssets')='object'
    AND snapshot->'renderAssets' ?&
      ARRAY['driver','passenger','hood','roof','front','rear']
    AND ((snapshot->'renderAssets' ? 'closeup') <>
         (snapshot->'renderAssets' ? 'hero3d'))
    AND NOT snapshot ? 'renderUrls'
    AND NULLIF(pg_catalog.btrim(snapshot#>>'{vehicle,year}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(snapshot#>>'{vehicle,make}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(snapshot#>>'{vehicle,model}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(snapshot#>>'{vehicle,type}'),'') IS NOT NULL
    AND pg_catalog.jsonb_typeof(snapshot->'surfaceOptions')='object'
    AND snapshot ? 'finish'
    AND snapshot ? 'bodyText'
    AND pg_catalog.jsonb_typeof(snapshot->'change')='object'
    AND pg_catalog.jsonb_typeof(snapshot->'expectedLogoInventory')='array'
    AND pg_catalog.jsonb_typeof(snapshot->'logoInventoryAttestation')='object'
    AND snapshot#>>'{logoInventoryAttestation,mode}' IN ('none','listed')
    AND COALESCE(
      (snapshot#>>'{logoInventoryAttestation,attested}')::boolean,false
    )
    AND (
      (
        NOT snapshot ? 'fulfillment'
        AND snapshot ?& ARRAY['orderNumber','delivery']
        AND NULLIF(snapshot->>'orderNumber','') IS NOT NULL
        AND snapshot->>'orderNumber' IS NOT DISTINCT FROM
          pg_catalog.btrim(snapshot->>'orderNumber')
        AND snapshot->>'orderNumber' ~
          '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
        AND pg_catalog.jsonb_typeof(snapshot->'delivery')='object'
        AND snapshot#>>'{delivery,contractVersion}'=
          'designpro.wrapbox-recipient.v1'
        AND snapshot#>>'{delivery,customerId}' ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND snapshot#>>'{delivery,customerEmail}'=
          pg_catalog.lower(pg_catalog.btrim(
            snapshot#>>'{delivery,customerEmail}'
          ))
        AND snapshot#>>'{delivery,recipientIdentityHash}' ~
          '^[0-9a-f]{64}$'
        AND snapshot#>>'{delivery,orderNumber}' IS NOT DISTINCT FROM
          snapshot->>'orderNumber'
        AND NULLIF(pg_catalog.btrim(
          snapshot#>>'{delivery,designName}'
        ),'') IS NOT NULL
      )
      OR
      (
        snapshot->>'sourceInputContract' IN (
          'designpro.calls-1-7-input.v2','designpro.calls-1-7-input.v3'
        )
        AND NULLIF(pg_catalog.btrim(snapshot->>'designName'),'') IS NOT NULL
        AND pg_catalog.length(snapshot->>'designName')<=240
        AND NOT (snapshot ?| ARRAY['orderNumber','delivery'])
        AND pg_catalog.jsonb_typeof(snapshot->'fulfillment')='object'
        AND (snapshot->'fulfillment') ?&
          ARRAY['contractVersion','state']
        AND (snapshot->'fulfillment')-
          ARRAY['contractVersion','state']='{}'::jsonb
        AND snapshot#>>'{fulfillment,contractVersion}'=
          'designpro.fulfillment-state.v1'
        AND snapshot#>>'{fulfillment,state}'='unbound'
      )
    )
    AND (
      NOT snapshot ? 'materialFingerprints'
      OR pg_catalog.jsonb_typeof(snapshot->'materialFingerprints') IN
        ('object','array')
    )
  );

CREATE OR REPLACE FUNCTION designpro_private.verify_revision_delivery_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE
  v_delivery jsonb:=NEW.snapshot->'delivery';
  v_customer_id uuid;
  v_email text;
  v_identity_hash text;
  v_confirmed_email text;
  v_request public.designpro_generation_requests%ROWTYPE;
  v_matching_views integer:=0;
BEGIN
  IF NEW.snapshot#>>'{fulfillment,state}'='unbound' THEN
    SELECT * INTO v_request
    FROM public.designpro_generation_requests
    WHERE id=NEW.visualization_id;

    IF NOT FOUND
      OR v_request.owner_id IS DISTINCT FROM NEW.owner_id
      OR v_request.generation_id IS DISTINCT FROM NEW.generation_id
      OR v_request.state IS DISTINCT FROM 'outputs_ready'
      -- v3/A.T.L.A.S. is admitted alongside v2, and the two must agree: the
      -- snapshot has to name the contract the request was actually created
      -- under, so a v2 run cannot present itself as an atlas handoff.
      OR v_request.request_input->>'contractVersion' NOT IN (
        'designpro.calls-1-7-input.v2','designpro.calls-1-7-input.v3'
      )
      OR NEW.snapshot->>'sourceInputContract' IS DISTINCT FROM
        v_request.request_input->>'contractVersion'
      OR NEW.snapshot->'vehicle' IS DISTINCT FROM
        v_request.request_input->'vehicle'
      OR NEW.snapshot->>'designName' IS DISTINCT FROM NULLIF(
        pg_catalog.btrim(v_request.request_input->>'designName'),'')
      OR v_request.engine_receipt->>'handoffRevisionId' IS DISTINCT FROM
        NEW.revision_id::text
      OR NEW.idempotency_key IS DISTINCT FROM
        'calls17-handoff:'||v_request.id::text
      OR (designpro_private.calls_1_7_handoff_state(v_request.id)
          ->>'handoffReady') IS DISTINCT FROM 'true'
      OR NEW.snapshot ?| ARRAY['orderNumber','delivery']
    THEN
      RAISE EXCEPTION 'design_first_handoff_source_invalid';
    END IF;

    -- Prove that each identity in the frozen revision is the destination for
    -- the exact active generation-view row. The storage trigger proves path
    -- shape; this proves provenance and blocks a generic revision caller from
    -- substituting seven unrelated objects under a valid-looking prefix.
    SELECT pg_catalog.count(*)::integer INTO v_matching_views
    FROM pg_catalog.jsonb_each(NEW.snapshot->'renderAssets') asset(role,identity)
    JOIN public.designpro_generation_views view_row
      ON view_row.request_id=v_request.id
     AND view_row.superseded_at IS NULL
     AND view_row.consumer_role=asset.role
     AND view_row.content_hash=asset.identity->>'contentHash'
     AND view_row.byte_size=(asset.identity->>'byteSize')::bigint
     AND view_row.content_type=asset.identity->>'contentType'
     AND asset.identity->>'storagePath'=
       'users/'||NEW.owner_id::text||'/revisions/'||NEW.revision_id::text
       ||'/inputs/'||view_row.consumer_role||'/'||view_row.content_hash
       ||CASE view_row.content_type
           WHEN 'image/png' THEN '.png'
           WHEN 'image/jpeg' THEN '.jpg'
           WHEN 'image/webp' THEN '.webp'
         END;
    IF v_matching_views<>7 THEN
      RAISE EXCEPTION 'design_first_handoff_views_do_not_match_generation';
    END IF;
    RETURN NEW;
  END IF;

  -- Historical bound-revision verification, unchanged in substance.
  IF NEW.snapshot->>'generationId' IS DISTINCT FROM NEW.generation_id::text
    OR NEW.snapshot->>'designId' IS DISTINCT FROM
      'DID-'||pg_catalog.upper(pg_catalog.substr(
        pg_catalog.replace(NEW.generation_id::text,'-',''),1,8
      ))
    OR NEW.snapshot->>'orderNumber' IS DISTINCT FROM
      pg_catalog.btrim(NEW.snapshot->>'orderNumber')
    OR NEW.snapshot->>'orderNumber' !~
      '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
  THEN RAISE EXCEPTION 'immutable_design_id_and_order_number_required'; END IF;

  IF pg_catalog.jsonb_typeof(v_delivery) IS DISTINCT FROM 'object'
    OR (SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_object_keys(v_delivery))<>6
    OR NOT v_delivery ?& ARRAY[
      'contractVersion','customerId','customerEmail',
      'recipientIdentityHash','orderNumber','designName'
    ]
    OR v_delivery->>'contractVersion' IS DISTINCT FROM
      'designpro.wrapbox-recipient.v1'
  THEN RAISE EXCEPTION 'exact_registered_delivery_contract_required'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.designpro_qc_members q
    JOIN auth.users u ON u.id=q.user_id
    WHERE q.user_id=NEW.owner_id AND q.can_operate
      AND u.email_confirmed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'confirmed_designpro_operator_required'; END IF;

  IF v_delivery->>'customerId' !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN RAISE EXCEPTION 'delivery_customer_id_invalid'; END IF;
  v_customer_id:=(v_delivery->>'customerId')::uuid;
  v_email:=pg_catalog.lower(pg_catalog.btrim(v_delivery->>'customerEmail'));
  v_identity_hash:=pg_catalog.lower(v_delivery->>'recipientIdentityHash');
  IF v_delivery->>'customerEmail' IS DISTINCT FROM v_email
    OR pg_catalog.length(v_email) NOT BETWEEN 3 AND 320
    OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR v_identity_hash !~ '^[0-9a-f]{64}$'
    OR v_delivery->>'orderNumber' IS DISTINCT FROM
      NEW.snapshot->>'orderNumber'
    OR pg_catalog.length(pg_catalog.btrim(v_delivery->>'designName'))
      NOT BETWEEN 1 AND 240
    OR v_delivery->>'designName' IS DISTINCT FROM
      pg_catalog.btrim(v_delivery->>'designName')
  THEN RAISE EXCEPTION 'delivery_recipient_contract_invalid'; END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(u.email))
  INTO v_confirmed_email
  FROM designpro_private.wrapbox_delivery_recipients r
  JOIN designpro_private.business_customer_bindings b
    ON b.customer_id=r.customer_id
      AND b.customer_auth_user_id=r.customer_auth_user_id
      AND b.customer_email=r.customer_email
  JOIN auth.users u ON u.id=r.customer_auth_user_id
  WHERE r.recipient_identity_hash=v_identity_hash
    AND r.customer_id=v_customer_id
    AND r.customer_email=v_email
    AND r.order_number=NEW.snapshot->>'orderNumber'
    AND u.email_confirmed_at IS NOT NULL;
  IF NOT FOUND OR v_confirmed_email IS DISTINCT FROM v_email
  THEN RAISE EXCEPTION 'registered_confirmed_delivery_binding_required'; END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bind_designpro_revision_fulfillment(
  p_revision_id uuid,
  p_recipient_identity_hash text,
  p_order_number text,
  p_design_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE
  v_owner uuid:=auth.uid();
  v_source public.designpro_revision_sources%ROWTYPE;
  v_recipient designpro_private.wrapbox_delivery_recipients%ROWTYPE;
  v_existing designpro_private.revision_fulfillment_bindings%ROWTYPE;
  v_delivery jsonb;
  v_binding_hash text;
  v_result jsonb;
BEGIN
  IF v_owner IS NULL
    OR COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'authenticated'
    OR COALESCE(auth.jwt()->>'is_anonymous','false')='true'
  THEN RAISE EXCEPTION 'authenticated_owner_required'; END IF;
  IF p_revision_id IS NULL
    OR pg_catalog.lower(COALESCE(p_recipient_identity_hash,''))
      !~ '^[0-9a-f]{64}$'
    OR p_order_number IS DISTINCT FROM pg_catalog.btrim(p_order_number)
    OR p_order_number !~ '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
    OR p_design_name IS DISTINCT FROM pg_catalog.btrim(p_design_name)
    OR pg_catalog.length(p_design_name) NOT BETWEEN 1 AND 240
  THEN RAISE EXCEPTION 'revision_fulfillment_invalid'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'designpro.revision-fulfillment:'||p_revision_id::text,0
  ));
  SELECT * INTO v_source
  FROM public.designpro_revision_sources
  WHERE revision_id=p_revision_id FOR UPDATE;
  IF NOT FOUND OR v_source.owner_id IS DISTINCT FROM v_owner
  THEN RAISE EXCEPTION 'revision_source_not_visible'; END IF;
  IF v_source.snapshot#>>'{fulfillment,state}' IS DISTINCT FROM 'unbound'
    OR v_source.snapshot->>'sourceInputContract' NOT IN (
      'designpro.calls-1-7-input.v2','designpro.calls-1-7-input.v3'
    )
    OR v_source.snapshot ?| ARRAY['orderNumber','delivery']
  THEN RAISE EXCEPTION 'revision_fulfillment_already_bound'; END IF;

  SELECT * INTO v_existing
  FROM designpro_private.revision_fulfillment_bindings
  WHERE revision_id=v_source.revision_id FOR UPDATE;
  IF v_source.snapshot->>'designName' IS DISTINCT FROM p_design_name THEN
    RAISE EXCEPTION 'revision_fulfillment_identity_conflict';
  END IF;

  SELECT r.* INTO v_recipient
  FROM public.designpro_qc_members q
  JOIN auth.users operator_user ON operator_user.id=q.user_id
  JOIN designpro_private.business_customer_bindings customer
    ON customer.created_by_operator=q.user_id
  JOIN designpro_private.wrapbox_delivery_recipients r
    ON r.customer_id=customer.customer_id
      AND r.customer_auth_user_id=customer.customer_auth_user_id
      AND r.customer_email=customer.customer_email
  JOIN auth.users customer_user ON customer_user.id=r.customer_auth_user_id
  WHERE q.user_id=v_owner AND q.can_operate
    AND operator_user.email_confirmed_at IS NOT NULL
    AND r.recipient_identity_hash=
      pg_catalog.lower(p_recipient_identity_hash)
    AND r.order_number=p_order_number
    AND customer_user.email_confirmed_at IS NOT NULL
    AND pg_catalog.lower(pg_catalog.btrim(customer_user.email))=
      r.customer_email
    AND v_source.owner_id=v_owner;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirmed_operator_customer_order_binding_required';
  END IF;

  v_delivery:=pg_catalog.jsonb_build_object(
    'contractVersion','designpro.wrapbox-recipient.v1',
    'customerId',v_recipient.customer_id,
    'customerEmail',v_recipient.customer_email,
    'recipientIdentityHash',v_recipient.recipient_identity_hash,
    'orderNumber',v_recipient.order_number,
    'designName',p_design_name
  );
  v_binding_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'revisionId',v_source.revision_id,
      'orderNumber',v_recipient.order_number,
      'delivery',v_delivery
    )::text,'UTF8'
  ),'sha256'),'hex');
  v_result:=pg_catalog.jsonb_build_object(
    'contractVersion','designpro.fulfillment-binding.v1',
    'revisionId',v_source.revision_id,
    'bindingHash',v_binding_hash,
    'orderNumber',v_recipient.order_number,
    'delivery',v_delivery
  );

  IF v_existing.revision_id IS NOT NULL THEN
    IF v_existing.owner_id IS DISTINCT FROM v_source.owner_id
      OR v_existing.bound_by_operator_id IS DISTINCT FROM v_owner
      OR v_existing.recipient_identity_hash IS DISTINCT FROM
        v_recipient.recipient_identity_hash
      OR v_existing.order_number IS DISTINCT FROM v_recipient.order_number
      OR v_existing.design_name IS DISTINCT FROM p_design_name
      OR v_existing.binding_hash IS DISTINCT FROM v_binding_hash
    THEN RAISE EXCEPTION 'revision_fulfillment_identity_conflict'; END IF;
    RETURN v_result||pg_catalog.jsonb_build_object('idempotent',true);
  END IF;

  INSERT INTO designpro_private.revision_fulfillment_bindings(
    revision_id,owner_id,bound_by_operator_id,recipient_identity_hash,
    order_number,design_name,binding_hash
  ) VALUES(
    v_source.revision_id,v_source.owner_id,v_owner,
    v_recipient.recipient_identity_hash,v_recipient.order_number,
    p_design_name,v_binding_hash
  );
  RETURN v_result||pg_catalog.jsonb_build_object('idempotent',false);
END;
$fn$;

