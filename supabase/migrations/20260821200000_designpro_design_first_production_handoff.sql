-- NORMAL DESIGN-FIRST HANDOFF INTO THE ONE PRODUCTION CHAIN.
--
-- Calls 1-7 v2 deliberately refuses orderNumber and delivery. The production
-- handoff still required both, so a valid design-first request could finish all
-- seven views but could not enter the existing Calls 8-11 workflow. This closes
-- that seam without fabricating an order, a recipient, or a second producer.
--
-- A v2 handoff freezes an explicitly UNBOUND revision source. Calls 8-11 may
-- consume that immutable design source. Fulfillment identity is a separate,
-- append-only binding and the purchase gate cannot release until that binding
-- exists. A.T.L.A.S. v3 is not eligible here and remains behind its existing
-- explicit production gate.
--
-- The handoff RPC also had a replay hole: if revision insertion succeeded and
-- workflow creation failed, the next call returned early merely because the
-- revision existed. It never repaired the missing workflow. Replays now verify
-- the exact existing revision and always run the idempotent workflow create.

CREATE TABLE IF NOT EXISTS designpro_private.revision_fulfillment_bindings (
  revision_id uuid PRIMARY KEY
    REFERENCES public.designpro_revision_sources(revision_id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  bound_by_operator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recipient_identity_hash text NOT NULL
    REFERENCES designpro_private.wrapbox_delivery_recipients(recipient_identity_hash)
      ON DELETE RESTRICT,
  order_number text NOT NULL CHECK (
    order_number=pg_catalog.btrim(order_number)
    AND order_number ~ '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
  ),
  design_name text NOT NULL CHECK (
    design_name=pg_catalog.btrim(design_name)
    AND pg_catalog.length(design_name) BETWEEN 1 AND 240
  ),
  binding_hash text NOT NULL UNIQUE CHECK (binding_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE OR REPLACE FUNCTION designpro_private.guard_revision_fulfillment_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=''
AS $fn$
BEGIN
  RAISE EXCEPTION 'designpro_revision_fulfillment_is_immutable';
END;
$fn$;

DROP TRIGGER IF EXISTS designpro_revision_fulfillment_immutable
  ON designpro_private.revision_fulfillment_bindings;
CREATE TRIGGER designpro_revision_fulfillment_immutable
BEFORE UPDATE OR DELETE ON designpro_private.revision_fulfillment_bindings
FOR EACH ROW EXECUTE FUNCTION
  designpro_private.guard_revision_fulfillment_immutable();

REVOKE ALL ON designpro_private.revision_fulfillment_bindings
  FROM PUBLIC,anon,authenticated,service_role;

-- A revision snapshot is always an immutable DESIGN identity. It has one of
-- two mutually exclusive fulfillment states:
--
--   bound   historical v1 snapshots keep their exact order + delivery object
--   unbound normal design-first v2 snapshots carry neither
--
-- No placeholder order or recipient is accepted. The later append-only row is
-- deliberately outside snapshot_hash, so binding fulfillment cannot rewrite
-- the design source or invalidate Calls 8-11 receipts.
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
      ARRAY['driver','passenger','hood','roof','front','rear','hero3d']
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
      -- Existing v1 / already-bound revisions retain the exact historical
      -- contract. `fulfillment` is absent so two authorities cannot coexist.
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
        AND snapshot#>>'{delivery,recipientIdentityHash}' ~ '^[0-9a-f]{64}$'
        AND snapshot#>>'{delivery,orderNumber}' IS NOT DISTINCT FROM
          snapshot->>'orderNumber'
        AND NULLIF(pg_catalog.btrim(
          snapshot#>>'{delivery,designName}'
        ),'') IS NOT NULL
      )
      OR
      -- Only the normal design-first contract may freeze an unbound source.
      -- The insertion trigger below proves it against the completed v2 row and
      -- its exact seven active views; a generic authenticated revision write
      -- cannot opt itself into this branch.
      (
        snapshot->>'sourceInputContract'=
          'designpro.calls-1-7-input.v2'
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

-- The existing bound branch is preserved. The new unbound branch is accepted
-- only when the row is the exact handoff of one completed, ordinary v2 request.
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
      OR v_request.request_input->>'contractVersion' IS DISTINCT FROM
        'designpro.calls-1-7-input.v2'
      OR NEW.snapshot->>'sourceInputContract' IS DISTINCT FROM
        'designpro.calls-1-7-input.v2'
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

-- One internal resolver serves the purchase fence and the runtime. Bound v1
-- revisions are projected from their immutable snapshot; v2 revisions resolve
-- only after an append-only late binding exists.
CREATE OR REPLACE FUNCTION designpro_private.revision_fulfillment(
  p_revision_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE
  v_source public.designpro_revision_sources%ROWTYPE;
  v_binding designpro_private.revision_fulfillment_bindings%ROWTYPE;
  v_recipient designpro_private.wrapbox_delivery_recipients%ROWTYPE;
  v_delivery jsonb;
  v_hash text;
BEGIN
  SELECT * INTO v_source
  FROM public.designpro_revision_sources
  WHERE revision_id=p_revision_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_binding
  FROM designpro_private.revision_fulfillment_bindings
  WHERE revision_id=p_revision_id;
  IF FOUND THEN
    SELECT * INTO v_recipient
    FROM designpro_private.wrapbox_delivery_recipients
    WHERE recipient_identity_hash=v_binding.recipient_identity_hash
      AND order_number=v_binding.order_number;
    IF NOT FOUND THEN RAISE EXCEPTION 'revision_fulfillment_recipient_missing'; END IF;
    v_delivery:=pg_catalog.jsonb_build_object(
      'contractVersion','designpro.wrapbox-recipient.v1',
      'customerId',v_recipient.customer_id,
      'customerEmail',v_recipient.customer_email,
      'recipientIdentityHash',v_recipient.recipient_identity_hash,
      'orderNumber',v_binding.order_number,
      'designName',v_binding.design_name
    );
    RETURN pg_catalog.jsonb_build_object(
      'contractVersion','designpro.fulfillment-binding.v1',
      'revisionId',v_source.revision_id,
      'bindingHash',v_binding.binding_hash,
      'orderNumber',v_binding.order_number,
      'delivery',v_delivery
    );
  END IF;

  IF pg_catalog.jsonb_typeof(v_source.snapshot->'delivery')='object'
    AND NULLIF(v_source.snapshot->>'orderNumber','') IS NOT NULL
  THEN
    v_delivery:=v_source.snapshot->'delivery';
    v_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'revisionId',v_source.revision_id,
        'orderNumber',v_source.snapshot->>'orderNumber',
        'delivery',v_delivery
      )::text,'UTF8'
    ),'sha256'),'hex');
    RETURN pg_catalog.jsonb_build_object(
      'contractVersion','designpro.fulfillment-binding.v1',
      'revisionId',v_source.revision_id,
      'bindingHash',v_hash,
      'orderNumber',v_source.snapshot->>'orderNumber',
      'delivery',v_delivery
    );
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_designpro_revision_fulfillment(
  p_revision_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE
  v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner
  FROM public.designpro_revision_sources
  WHERE revision_id=p_revision_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
    AND auth.uid() IS DISTINCT FROM v_owner
  THEN RETURN NULL; END IF;
  RETURN designpro_private.revision_fulfillment(p_revision_id);
END;
$fn$;

-- Late binding is owner-authenticated, operator-verified, append-only, and
-- exact-idempotent. The authenticated revision owner must be the confirmed
-- DesignPro operator who registered the customer/order recipient. The supplied
-- design name must equal the one already frozen in the immutable v2 snapshot.
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
    OR v_source.snapshot->>'sourceInputContract' IS DISTINCT FROM
      'designpro.calls-1-7-input.v2'
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

-- Generic revision ingestion remains available for its historical, already
-- bound contract. An unbound design-first source is more privileged because it
-- starts Calls 8-11 without fulfillment identity; only the handoff RPC below
-- may create that shape after proving the completed v2 generation and views.
CREATE OR REPLACE FUNCTION public.save_designpro_revision_source(
  p_revision_id uuid,
  p_generation_id uuid,
  p_visualization_id uuid,
  p_expected_updated_at timestamptz,
  p_snapshot jsonb,
  p_snapshot_hash text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $fn$
DECLARE
  v_owner uuid:=auth.uid();
  v_tenant text;
  v_derived_hash text;
  v_existing public.designpro_revision_sources%ROWTYPE;
  v_created boolean:=false;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'authenticated'
    OR v_owner IS NULL
  THEN RAISE EXCEPTION 'authenticated_user_required'; END IF;
  IF p_revision_id IS NULL OR p_generation_id IS NULL
    OR p_visualization_id IS NULL OR p_expected_updated_at IS NULL
    OR NULLIF(pg_catalog.btrim(p_idempotency_key),'') IS NULL
    OR pg_catalog.length(p_idempotency_key)>240
  THEN RAISE EXCEPTION 'revision_source_identity_incomplete'; END IF;
  IF p_snapshot#>>'{fulfillment,state}'='unbound' THEN
    RAISE EXCEPTION 'design_first_handoff_rpc_required';
  END IF;

  v_tenant:='user_'||v_owner::text;
  IF p_snapshot->>'contractVersion' IS DISTINCT FROM
      'designpro.revision-snapshot.v1'
    OR p_snapshot->>'visualizationId' IS DISTINCT FROM
      p_visualization_id::text
    OR (p_snapshot ? 'revisionId'
      AND p_snapshot->>'revisionId' IS DISTINCT FROM p_revision_id::text)
    OR (p_snapshot ? 'generationId'
      AND p_snapshot->>'generationId' IS DISTINCT FROM p_generation_id::text)
    OR pg_catalog.jsonb_typeof(p_snapshot->'expectedLogoInventory')
      IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'revision_snapshot_identity_mismatch'; END IF;

  v_derived_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    p_snapshot::text,'UTF8'
  ),'sha256'),'hex');
  IF NULLIF(pg_catalog.btrim(COALESCE(p_snapshot_hash,'')),'') IS NOT NULL
    AND pg_catalog.lower(p_snapshot_hash) IS DISTINCT FROM v_derived_hash
  THEN RAISE EXCEPTION 'revision_snapshot_hash_mismatch'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'designpro.revision-source:'||v_owner::text||':'||p_idempotency_key,0
  ));
  SELECT * INTO v_existing
  FROM public.designpro_revision_sources
  WHERE owner_id=v_owner AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.revision_id IS DISTINCT FROM p_revision_id
      OR v_existing.generation_id IS DISTINCT FROM p_generation_id
      OR v_existing.visualization_id IS DISTINCT FROM p_visualization_id
      OR v_existing.expected_updated_at IS DISTINCT FROM p_expected_updated_at
      OR v_existing.snapshot_hash IS DISTINCT FROM v_derived_hash
      OR v_existing.snapshot IS DISTINCT FROM p_snapshot
    THEN RAISE EXCEPTION 'revision_source_idempotency_conflict'; END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.designpro_revision_sources
      WHERE revision_id=p_revision_id
    ) THEN RAISE EXCEPTION 'revision_source_identity_conflict'; END IF;
    INSERT INTO public.designpro_revision_sources(
      revision_id,owner_id,tenant_key,generation_id,visualization_id,
      expected_updated_at,snapshot,snapshot_hash,idempotency_key
    ) VALUES(
      p_revision_id,v_owner,v_tenant,p_generation_id,p_visualization_id,
      p_expected_updated_at,p_snapshot,v_derived_hash,p_idempotency_key
    ) RETURNING * INTO v_existing;
    v_created:=true;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'revisionId',v_existing.revision_id,
    'ownerId',v_existing.owner_id,
    'tenantKey',v_existing.tenant_key,
    'snapshotHash',v_existing.snapshot_hash,
    'created',v_created,
    'idempotent',NOT v_created
  );
END;
$fn$;

-- Rebuild the handoff. Calls 8-11 are still created by the one existing
-- create_designpro_entice_workflow RPC; this function only freezes its source.
CREATE OR REPLACE FUNCTION public.handoff_designpro_generation_to_production(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $fn$
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
  v_existing public.designpro_revision_sources%ROWTYPE;
  v_design_name text;
  v_idempotency text;
  v_company text;
  v_phone text;
  v_website text;
  v_mode text;
  v_logo jsonb;
  v_logo_mode text;
  v_brand jsonb;
  v_input_contract text;
  v_source_time timestamptz;
  v_already_handed_off boolean:=false;
BEGIN
  IF v_owner IS NULL
    OR COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'authenticated'
    OR COALESCE(auth.jwt()->>'is_anonymous','false')='true'
  THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_row
  FROM public.designpro_generation_requests
  WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_row.owner_id IS DISTINCT FROM v_owner
  THEN RAISE EXCEPTION 'generation_request_not_visible'; END IF;
  IF v_row.state<>'outputs_ready'
  THEN RAISE EXCEPTION 'generation_outputs_not_ready'; END IF;

  v_input_contract:=v_row.request_input->>'contractVersion';
  IF v_input_contract NOT IN (
    'designpro.calls-1-7-input.v1','designpro.calls-1-7-input.v2'
  ) THEN
    -- This is the database backstop behind the gateway's explicit flat-first
    -- gate. v3/A.T.L.A.S. never enters the normal production handoff.
    RAISE EXCEPTION 'generation_contract_not_production_eligible';
  END IF;

  v_handoff:=designpro_private.calls_1_7_handoff_state(v_row.id);
  IF (v_handoff->>'handoffReady')<>'true' THEN
    RAISE EXCEPTION 'generation_handoff_blocked: %',
      COALESCE(v_handoff->>'handoffBlocker','unknown');
  END IF;
  v_revision:=NULLIF(v_row.engine_receipt->>'handoffRevisionId','')::uuid;
  IF v_revision IS NULL
  THEN RAISE EXCEPTION 'generation_handoff_revision_missing'; END IF;

  FOR v_view IN
    SELECT consumer_role,content_hash,byte_size,content_type
    FROM public.designpro_generation_views
    WHERE request_id=v_row.id AND superseded_at IS NULL
    ORDER BY consumer_role
  LOOP
    IF v_view.consumer_role='closeup' THEN CONTINUE; END IF;
    v_extension:=CASE v_view.content_type
      WHEN 'image/png' THEN 'png'
      WHEN 'image/jpeg' THEN 'jpg'
      WHEN 'image/webp' THEN 'webp'
      ELSE NULL END;
    IF v_extension IS NULL
    THEN RAISE EXCEPTION 'generation_view_identity_invalid'; END IF;
    v_render:=v_render||pg_catalog.jsonb_build_object(
      v_view.consumer_role,
      pg_catalog.jsonb_build_object(
        'storagePath','users/'||v_owner::text||'/revisions/'
          ||v_revision::text||'/inputs/'||v_view.consumer_role||'/'
          ||v_view.content_hash||'.'||v_extension,
        'contentHash',v_view.content_hash,
        'byteSize',v_view.byte_size,
        'contentType',v_view.content_type
      )
    );
  END LOOP;

  v_design_name:=NULLIF(pg_catalog.btrim(COALESCE(
    v_row.request_input->>'designName',''
  )),'');
  v_company:=NULLIF(pg_catalog.btrim(COALESCE(
    v_row.request_input->>'companyName',
    v_row.request_input->>'businessName',''
  )),'');
  v_phone:=NULLIF(pg_catalog.btrim(COALESCE(
    v_row.request_input->>'phone',''
  )),'');
  v_website:=NULLIF(pg_catalog.btrim(COALESCE(
    v_row.request_input->>'website',''
  )),'');
  v_mode:=CASE
    WHEN v_row.request_input->>'mode' IN ('commercial','restyle')
      THEN v_row.request_input->>'mode'
    WHEN v_company IS NOT NULL THEN 'commercial'
    ELSE 'restyle' END;

  v_logo:=NULL;
  IF pg_catalog.jsonb_typeof(v_row.request_input->'logoAsset')='object' THEN
    IF NULLIF(pg_catalog.btrim(COALESCE(
      v_row.request_input#>>'{logoAsset,storagePath}',''
    )),'') IS NULL
      OR COALESCE(v_row.request_input#>>'{logoAsset,contentHash}','')
        !~ '^[0-9a-f]{64}$'
    THEN RAISE EXCEPTION 'generation_logo_asset_invalid'; END IF;
    v_logo:=pg_catalog.jsonb_build_object(
      'storagePath',v_row.request_input#>>'{logoAsset,storagePath}',
      'contentHash',pg_catalog.lower(
        v_row.request_input#>>'{logoAsset,contentHash}'
      ),
      'byteSize',(v_row.request_input#>>'{logoAsset,byteSize}')::bigint,
      'contentType',v_row.request_input#>>'{logoAsset,contentType}',
      'source','designpro-intake-upload'
    );
  END IF;
  -- Call 10 requires a frozen, surface-bound placement inventory. Intake has
  -- only the uploaded bytes, not honest placement evidence, so advancing that
  -- shape would park later at Call 10 after pretending it was runnable.
  IF v_logo IS NOT NULL THEN
    RAISE EXCEPTION 'generation_logo_placement_manifest_required';
  END IF;
  v_logo_mode:='none';
  v_brand:=pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'contractVersion','designpro.brand-identity.v1',
    'mode',v_mode,
    'companyName',v_company,
    'phone',v_phone,
    'website',v_website,
    'authority','revision-snapshot'
  ));

  IF v_input_contract='designpro.calls-1-7-input.v1' THEN
    SELECT * INTO v_recipient
    FROM designpro_private.wrapbox_delivery_recipients
    WHERE recipient_identity_hash=
        v_row.request_input#>>'{delivery,recipientIdentityHash}'
      AND order_number=v_row.request_input->>'orderNumber';
    IF NOT FOUND
    THEN RAISE EXCEPTION 'wrapbox_recipient_binding_missing'; END IF;
    IF v_design_name IS NULL THEN
      v_design_name:=v_row.request_input->>'orderNumber';
    END IF;
    v_delivery:=pg_catalog.jsonb_build_object(
      'contractVersion','designpro.wrapbox-recipient.v1',
      'customerId',v_recipient.customer_id,
      'customerEmail',v_recipient.customer_email,
      'recipientIdentityHash',v_recipient.recipient_identity_hash,
      'orderNumber',v_recipient.order_number,
      'designName',v_design_name
    );
    -- Preserve the exact bound-v1 snapshot shape for existing rows and replay.
    v_snapshot:=pg_catalog.jsonb_build_object(
      'contractVersion','designpro.revision-snapshot.v1',
      'revisionId',v_revision,
      'generationId',v_row.generation_id,
      'visualizationId',v_row.id,
      'designId','DID-'||pg_catalog.upper(pg_catalog.left(
        pg_catalog.replace(v_row.generation_id::text,'-',''),8
      )),
      'vehicle',v_row.request_input->'vehicle',
      'surfaceOptions',pg_catalog.jsonb_build_object(
        'required',pg_catalog.jsonb_build_array(
          'driver','passenger','hood','roof','front','rear'
        )
      ),
      'finish',COALESCE(v_row.request_input->>'finish','standard'),
      'bodyText',pg_catalog.jsonb_build_array(),
      'brandIdentity',v_brand,
      'brandAssets',pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object('logo',v_logo)
      ),
      'brief',COALESCE(v_row.request_input->>'brief',''),
      'orderNumber',v_recipient.order_number,
      'logoInventoryAttestation',pg_catalog.jsonb_build_object(
        'mode',v_logo_mode,'attested',true,
        'source',CASE WHEN v_logo IS NULL THEN 'calls-1-7-generated'
          ELSE 'designpro-intake-upload' END,
        'placementPending',v_logo IS NOT NULL
      ),
      'expectedLogoInventory',pg_catalog.jsonb_build_array(),
      'delivery',v_delivery,
      'renderAssets',v_render,
      'change',pg_catalog.jsonb_build_object(
        'view','all','instruction','Generated by Calls 1-7',
        'attachmentIds',pg_catalog.jsonb_build_array()
      )
    );
  ELSE
    IF v_design_name IS NULL
    THEN RAISE EXCEPTION 'generation_design_name_missing'; END IF;
    v_snapshot:=pg_catalog.jsonb_build_object(
      'contractVersion','designpro.revision-snapshot.v1',
      'sourceInputContract','designpro.calls-1-7-input.v2',
      'revisionId',v_revision,
      'generationId',v_row.generation_id,
      'visualizationId',v_row.id,
      'designId','DID-'||pg_catalog.upper(pg_catalog.left(
        pg_catalog.replace(v_row.generation_id::text,'-',''),8
      )),
      'designName',v_design_name,
      'vehicle',v_row.request_input->'vehicle',
      'surfaceOptions',pg_catalog.jsonb_build_object(
        'required',pg_catalog.jsonb_build_array(
          'driver','passenger','hood','roof','front','rear'
        )
      ),
      'finish',COALESCE(v_row.request_input->>'finish','standard'),
      'bodyText',pg_catalog.jsonb_build_array(),
      'brandIdentity',v_brand,
      'brandAssets',pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object('logo',v_logo)
      ),
      'brief',COALESCE(v_row.request_input->>'brief',''),
      'logoInventoryAttestation',pg_catalog.jsonb_build_object(
        'mode',v_logo_mode,'attested',true,
        'source',CASE WHEN v_logo IS NULL THEN 'calls-1-7-generated'
          ELSE 'designpro-intake-upload' END,
        'placementPending',v_logo IS NOT NULL
      ),
      'expectedLogoInventory',pg_catalog.jsonb_build_array(),
      'fulfillment',pg_catalog.jsonb_build_object(
        'contractVersion','designpro.fulfillment-state.v1',
        'state','unbound'
      ),
      'renderAssets',v_render,
      'change',pg_catalog.jsonb_build_object(
        'view','all','instruction','Generated by Calls 1-7',
        'attachmentIds',pg_catalog.jsonb_build_array()
      )
    );
  END IF;

  v_idempotency:='calls17-handoff:'||v_row.id::text;
  v_source_time:=COALESCE(
    v_row.completed_at,v_row.updated_at,v_row.created_at
  );

  SELECT * INTO v_existing
  FROM public.designpro_revision_sources
  WHERE revision_id=v_revision FOR UPDATE;
  v_already_handed_off:=FOUND;
  IF v_already_handed_off THEN
    IF v_existing.owner_id IS DISTINCT FROM v_owner
      OR v_existing.generation_id IS DISTINCT FROM v_row.generation_id
      OR v_existing.visualization_id IS DISTINCT FROM v_row.id
      OR v_existing.idempotency_key IS DISTINCT FROM v_idempotency
      OR v_existing.snapshot IS DISTINCT FROM v_snapshot
      OR v_existing.snapshot_hash IS DISTINCT FROM pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'
        ),'hex'
      )
    THEN RAISE EXCEPTION 'generation_handoff_identity_conflict'; END IF;
    v_saved:=pg_catalog.jsonb_build_object(
      'revisionId',v_existing.revision_id,
      'ownerId',v_existing.owner_id,
      'tenantKey',v_existing.tenant_key,
      'snapshotHash',v_existing.snapshot_hash,
      'created',false,
      'idempotent',true
    );
  ELSE
    IF v_input_contract='designpro.calls-1-7-input.v2' THEN
      -- Direct insertion is intentional: generic authenticated revision
      -- ingestion rejects unbound sources, while this SECURITY DEFINER RPC has
      -- already proved the owner, completed request, exact revision identity,
      -- handoff state and seven active views.
      INSERT INTO public.designpro_revision_sources(
        revision_id,owner_id,tenant_key,generation_id,visualization_id,
        expected_updated_at,snapshot,snapshot_hash,idempotency_key
      ) VALUES(
        v_revision,v_owner,'user_'||v_owner::text,v_row.generation_id,v_row.id,
        v_source_time,v_snapshot,pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'
        ),'hex'),v_idempotency
      ) RETURNING * INTO v_existing;
      v_saved:=pg_catalog.jsonb_build_object(
        'revisionId',v_existing.revision_id,
        'ownerId',v_existing.owner_id,
        'tenantKey',v_existing.tenant_key,
        'snapshotHash',v_existing.snapshot_hash,
        'created',true,
        'idempotent',false
      );
    ELSE
      v_saved:=public.save_designpro_revision_source(
        v_revision,v_row.generation_id,v_row.id,v_source_time,
        v_snapshot,NULL,v_idempotency
      );
    END IF;
  END IF;

  -- ALWAYS run the idempotent workflow creation. This repairs the precise
  -- crash window where the revision committed but the workflow did not.
  v_workflow:=public.create_designpro_entice_workflow(
    v_revision,v_idempotency,
    pg_catalog.jsonb_build_object(
      'trigger','revision.saved',
      'revisionSnapshotHash',v_saved->>'snapshotHash'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'revisionId',v_revision,
    'generationId',v_row.generation_id,
    'workflowRunId',v_workflow->>'workflowRunId',
    'alreadyHandedOff',v_already_handed_off
  );
END;
$fn$;

-- A paid product is visible to the worker only when fulfillment identity is
-- resolvable. This covers both the ordinary "stage parked, then payment" path
-- and the race where payment exists before await_purchase is first claimed.
CREATE OR REPLACE FUNCTION public.designpro_paid_products(p_entice_run_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $fn$
  SELECT COALESCE(
    pg_catalog.array_agg(e.product_type ORDER BY e.product_type),
    ARRAY[]::text[]
  )
  FROM public.designpro_purchase_entitlements e
  JOIN public.designpro_workflow_runs entice
    ON entice.id=e.entice_run_id
      AND entice.workflow_type='designpro.entice_pack'
  WHERE e.entice_run_id=p_entice_run_id
    AND designpro_private.revision_fulfillment(entice.revision_id) IS NOT NULL
$fn$;

-- Freeze the resolved binding onto the production run before releasing its
-- purchase stage. Downstream code can consume this exact object without ever
-- rewriting the immutable design snapshot.
CREATE OR REPLACE FUNCTION public.reconcile_designpro_purchase_gates()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $fn$
DECLARE
  v_bound integer:=0;
  v_released integer:=0;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;

  WITH ready AS (
    SELECT r.id,
      designpro_private.revision_fulfillment(r.revision_id) fulfillment
    FROM public.designpro_workflow_runs r
    JOIN public.designpro_workflow_stages s
      ON s.run_id=r.id AND s.stage_key='await_purchase'
      AND s.status IN ('pending','waiting')
    WHERE r.workflow_type='designpro.production_pack'
      AND EXISTS (
        SELECT 1 FROM public.designpro_purchase_entitlements e
        WHERE e.entice_run_id=(r.results->>'sourceEnticeRunId')::uuid
      )
  ), bound AS (
    UPDATE public.designpro_workflow_runs r
    SET input=r.input||pg_catalog.jsonb_build_object(
          'fulfillment',ready.fulfillment
        ),
        results=r.results||pg_catalog.jsonb_build_object(
          'fulfillmentBindingHash',ready.fulfillment->>'bindingHash'
        ),
        updated_at=pg_catalog.clock_timestamp()
    FROM ready
    WHERE r.id=ready.id AND ready.fulfillment IS NOT NULL
      AND (
        NOT r.input ? 'fulfillment'
        OR r.input->'fulfillment' IS NOT DISTINCT FROM ready.fulfillment
      )
    RETURNING r.id
  )
  SELECT pg_catalog.count(*)::integer INTO v_bound FROM bound;

  WITH released AS (
    UPDATE public.designpro_workflow_stages s
    SET status='pending',wait_reason=NULL,available_at=pg_catalog.now(),
        updated_at=pg_catalog.clock_timestamp()
    FROM public.designpro_workflow_runs r
    WHERE s.run_id=r.id
      AND s.stage_key='await_purchase'
      AND s.status='waiting'
      AND pg_catalog.jsonb_typeof(r.input->'fulfillment')='object'
      AND r.input#>>'{fulfillment,bindingHash}' ~ '^[0-9a-f]{64}$'
      AND r.input->'fulfillment' IS NOT DISTINCT FROM
        designpro_private.revision_fulfillment(r.revision_id)
      AND EXISTS (
        SELECT 1 FROM public.designpro_purchase_entitlements e
        WHERE e.entice_run_id=(r.results->>'sourceEnticeRunId')::uuid
      )
    RETURNING s.id
  )
  SELECT pg_catalog.count(*)::integer INTO v_released FROM released;

  UPDATE public.designpro_workflow_runs r
  SET status='running',updated_at=pg_catalog.clock_timestamp()
  WHERE r.status='approval_required'
    AND EXISTS (
      SELECT 1 FROM public.designpro_workflow_stages s
      WHERE s.run_id=r.id AND s.stage_key='await_purchase'
        AND s.status='pending'
    );
  RETURN pg_catalog.jsonb_build_object(
    'released',v_released,'fulfillmentBound',v_bound
  );
END;
$fn$;

-- Once a production run has received its fulfillment object, it is as frozen
-- as the revision/artifact identities already protected by this trigger.
CREATE OR REPLACE FUNCTION public.guard_designpro_run_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $fn$
BEGIN
  IF NEW.revision_id IS DISTINCT FROM OLD.revision_id
    OR NEW.entice_pack_id IS DISTINCT FROM OLD.entice_pack_id
    OR NEW.revision_snapshot_hash IS DISTINCT FROM OLD.revision_snapshot_hash
    OR (OLD.dimension_manifest_id IS NOT NULL
      AND NEW.dimension_manifest_id IS DISTINCT FROM OLD.dimension_manifest_id)
    OR (OLD.manifest_hash IS NOT NULL
      AND NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash)
    OR (OLD.source_contract_hash IS NOT NULL
      AND NEW.source_contract_hash IS DISTINCT FROM OLD.source_contract_hash)
    OR (OLD.artifact_set_hash IS NOT NULL
      AND NEW.artifact_set_hash IS DISTINCT FROM OLD.artifact_set_hash)
    OR (OLD.input ? 'fulfillment'
      AND NEW.input->'fulfillment' IS DISTINCT FROM OLD.input->'fulfillment')
  THEN RAISE EXCEPTION 'designpro_workflow_identity_is_immutable'; END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION
  designpro_private.guard_revision_fulfillment_immutable()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.revision_fulfillment(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.verify_revision_delivery_binding()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.bind_designpro_revision_fulfillment(
  uuid,text,text,text
) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.bind_designpro_revision_fulfillment(
  uuid,text,text,text
) TO authenticated;
REVOKE ALL ON FUNCTION public.save_designpro_revision_source(
  uuid,uuid,uuid,timestamptz,jsonb,text,text
) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_designpro_revision_source(
  uuid,uuid,uuid,timestamptz,jsonb,text,text
) TO authenticated;
REVOKE ALL ON FUNCTION public.get_designpro_revision_fulfillment(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_designpro_revision_fulfillment(uuid)
  TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.handoff_designpro_generation_to_production(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.handoff_designpro_generation_to_production(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.designpro_paid_products(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designpro_paid_products(uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.reconcile_designpro_purchase_gates()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_designpro_purchase_gates()
  TO service_role;

COMMENT ON TABLE designpro_private.revision_fulfillment_bindings IS
  'Append-only late binding of one completed design-first revision to one '
  'confirmed Order # and WrapBox recipient. It is not part of the immutable '
  'design snapshot and cannot release paid work without a verified entitlement.';
COMMENT ON FUNCTION public.bind_designpro_revision_fulfillment(
  uuid,text,text,text
) IS
  'Owner-only late binding for an unbound Calls 1-7 v2 revision. Exact replay '
  'is idempotent; any recipient/order/name drift is refused.';
