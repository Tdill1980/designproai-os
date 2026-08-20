-- CALLS 1-7 BECOME DESIGN-FIRST.
--
-- Until now a customer could not start a design without already having an
-- order: create_designpro_generation_request demanded input.orderNumber, a
-- three-key delivery object carrying a recipientIdentityHash, and -- the
-- harder gate -- an already-confirmed operator/customer/order binding in
-- wrapbox_delivery_recipients. Design generation was therefore gated on
-- fulfillment identity that does not exist yet when someone is still deciding
-- what their wrap should look like.
--
-- The product contract is the other way round:
--
--   Calls 1-7          authenticated user + generationId + vehicle + brief
--                      + commercial identity + optional verified logo
--   paid fulfillment   binds order + WrapBox recipient
--
-- This migration introduces designpro.calls-1-7-input.v2 for that shape.
-- v1 is untouched and still accepted: existing rows stay readable, existing
-- callers keep working, and the operator-order path is unchanged for them.
-- Nothing here fabricates fulfillment identity; v2 simply does not ask for it.
--
-- GENERATION ID IS IMMUTABLE. One generationId means one design, forever,
-- because Call 8 and Call 9 provenance point back at it. UNIQUE(owner_id,
-- generation_id) already made a second row impossible; what was missing was an
-- honest answer when the same id arrives carrying a DIFFERENT brief. That case
-- now raises generation_input_conflict rather than the generic identity
-- conflict, so the caller is told to mint a new generationId instead of
-- wondering which design the id refers to.
--
-- THE CANONICAL HASH IS SERVER-DERIVED, NEVER THE CALLER'S. jsonb text output
-- in Postgres is key-sorted and duplicate-free, so sha256(request_input::text)
-- is deterministic for equal inputs -- the same derivation v1 already used. For
-- v2 the idempotency key is computed FROM that hash here, and a caller-supplied
-- key is only ever compared against it. A caller cannot choose its own identity.

CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_input_v2_valid(
  p_input jsonb
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, extensions
AS $fn$
  SELECT
    pg_catalog.jsonb_typeof(p_input)='object'
    AND p_input->>'contractVersion'='designpro.calls-1-7-input.v2'
    -- Fulfillment identity is not merely optional in v2, it is REFUSED. A
    -- caller that still sends an order or a recipient is speaking v1 and must
    -- say so, otherwise the two contracts blur back together and the design
    -- path quietly reacquires the dependency this migration removes.
    AND NOT (p_input ?| ARRAY['orderNumber','delivery'])
    AND (p_input - ARRAY[
      'contractVersion','vehicle','brief','designName','mode','companyName',
      'phone','website','logoAsset','businessName','industry','colors','style'
    ]) = '{}'::jsonb
    AND NULLIF(pg_catalog.btrim(p_input->>'brief'),'') IS NOT NULL
    AND pg_catalog.length(p_input->>'brief')<=8000
    AND NULLIF(pg_catalog.btrim(p_input->>'designName'),'') IS NOT NULL
    AND pg_catalog.length(p_input->>'designName')<=240
    AND (NOT p_input ? 'mode' OR p_input->>'mode' = ANY(ARRAY['restyle','commercial']))
    AND pg_catalog.jsonb_typeof(p_input->'vehicle')='object'
    AND NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,year}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,make}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,model}'),'') IS NOT NULL
    AND p_input#>>'{vehicle,type}' = ANY(ARRAY[
      'car','truck','suv','van','motorcycle','boat','bus','rv','trailer',
      'aircraft','heavy_equipment'
    ])
    AND pg_catalog.octet_length(p_input::text)<=262144
    AND NOT designpro_private.generation_input_has_server_controls(p_input)
$fn$;

COMMENT ON FUNCTION designpro_private.calls_1_7_input_v2_valid(jsonb) IS
  'Design-first Calls 1-7 input: vehicle, brief and customer-authored identity '
  'only. Order and WrapBox recipient are refused here and bind at paid '
  'fulfillment instead.';

-- The input CHECK now accepts either contract. v1''s clauses are reproduced
-- verbatim rather than refactored: a rewrite of a live constraint that is
-- meant to change nothing for v1 is a good way to change something for v1.
ALTER TABLE public.designpro_generation_requests
  DROP CONSTRAINT designpro_generation_requests_request_input_check;

ALTER TABLE public.designpro_generation_requests
  ADD CONSTRAINT designpro_generation_requests_request_input_check CHECK (
    pg_catalog.jsonb_typeof(request_input)='object'
    AND (
      designpro_private.calls_1_7_input_v2_valid(request_input)
      OR (
        request_input->>'contractVersion'='designpro.calls-1-7-input.v1'
        AND NULLIF(pg_catalog.btrim(request_input->>'orderNumber'),'') IS NOT NULL
        AND request_input->>'orderNumber'=pg_catalog.btrim(request_input->>'orderNumber')
        AND request_input->>'orderNumber' ~
          '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
        AND pg_catalog.jsonb_typeof(request_input->'delivery')='object'
        AND (request_input->'delivery') ?& ARRAY[
          'contractVersion','recipientIdentityHash','orderNumber'
        ]
        AND (request_input->'delivery') - ARRAY[
          'contractVersion','recipientIdentityHash','orderNumber'
        ] = '{}'::jsonb
        AND request_input#>>'{delivery,contractVersion}'=
          'designpro.wrapbox-recipient.v1'
        AND request_input#>>'{delivery,recipientIdentityHash}' ~ '^[0-9a-f]{64}$'
        AND request_input#>>'{delivery,orderNumber}'=request_input->>'orderNumber'
        AND pg_catalog.jsonb_typeof(request_input->'vehicle')='object'
        AND NULLIF(pg_catalog.btrim(request_input#>>'{vehicle,year}'),'') IS NOT NULL
        AND NULLIF(pg_catalog.btrim(request_input#>>'{vehicle,make}'),'') IS NOT NULL
        AND NULLIF(pg_catalog.btrim(request_input#>>'{vehicle,model}'),'') IS NOT NULL
        AND NULLIF(pg_catalog.btrim(request_input#>>'{vehicle,type}'),'') IS NOT NULL
        AND request_input#>>'{vehicle,type}' = ANY(ARRAY[
          'car','truck','suv','van','motorcycle','boat','bus','rv','trailer',
          'aircraft','heavy_equipment'
        ])
        AND pg_catalog.octet_length(request_input::text)<=262144
        AND NOT designpro_private.generation_input_has_server_controls(request_input)
      )
    )
  );

-- Identity derivation, per contract. v1 keeps the order-derived key so existing
-- rows continue to satisfy the constraint; v2 derives from the stored input
-- hash, which is the only thing that can stand in for identity once the order
-- is gone.
ALTER TABLE public.designpro_generation_requests
  DROP CONSTRAINT designpro_generation_request_identity;

ALTER TABLE public.designpro_generation_requests
  ADD CONSTRAINT designpro_generation_request_identity CHECK (
    CASE
      WHEN request_input->>'contractVersion'='designpro.calls-1-7-input.v2'
        THEN idempotency_key='calls17:'||generation_id::text||':'||input_hash
      ELSE idempotency_key='calls17:'||generation_id::text||':'
        ||(request_input#>>'{delivery,recipientIdentityHash}')||':'
        ||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
          request_input->>'orderNumber','UTF8'
        ),'sha256'),'hex')
    END
  );

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
  v_active_count integer;
  v_recipient_identity_hash text;
  v_order_number text;
  v_expected_idempotency text;
  v_is_v2 boolean;
  v_row public.designpro_generation_requests%ROWTYPE;
BEGIN
  IF v_owner IS NULL OR COALESCE(auth.jwt()->>'is_anonymous','false')='true'
  THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_generation_id IS NULL OR p_input IS NULL
    OR pg_catalog.jsonb_typeof(p_input)<>'object'
    OR NULLIF(pg_catalog.btrim(p_input->>'contractVersion'),'') IS NULL
  THEN RAISE EXCEPTION 'generation_request_invalid'; END IF;

  v_is_v2:=p_input->>'contractVersion'='designpro.calls-1-7-input.v2';

  v_tenant:='user_'||v_owner::text;
  -- Server-derived, from the stored jsonb. jsonb text is key-sorted, so equal
  -- inputs hash equally and a caller cannot influence the result by reordering
  -- keys or padding whitespace.
  v_input_hash:=pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_input::text,'UTF8'),'sha256'),'hex'
  );
  v_contract_hash:=pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_contract::text,'UTF8'),'sha256'),'hex'
  );

  IF v_is_v2 THEN
    IF NOT designpro_private.calls_1_7_input_v2_valid(p_input)
    THEN RAISE EXCEPTION 'generation_request_invalid'; END IF;
    v_expected_idempotency:='calls17:'||p_generation_id::text||':'||v_input_hash;
    -- A caller may compute this for its own bookkeeping; it is never trusted.
    -- NULL means "you derive it", which is the honest thing for a client that
    -- cannot canonicalize jsonb the way Postgres does.
    IF p_idempotency_key IS NOT NULL
      AND p_idempotency_key IS DISTINCT FROM v_expected_idempotency
    THEN RAISE EXCEPTION 'generation_request_invalid'; END IF;
    -- No order. No recipient. No operator-order binding: there is no order to
    -- bind to yet, and requiring one is precisely what stopped a customer
    -- designing anything.
  ELSE
    -- V1'S CONTRACT VALIDATION, REPRODUCED VERBATIM.
    --
    -- Copied clause for clause out of 20260808024500_designpro_calls_1_7_adapter.sql
    -- and only re-indented. The first version of this migration replaced the
    -- whole block with a contractVersion check, on the reading that the table's
    -- CHECK constraint would still catch a malformed v1 input. It does not
    -- catch it HERE: the request reached the active-request-limit and
    -- operator-binding checks first and failed with those, so a caller sending
    -- an out-of-allowlist vehicle class or a delivery/order mismatch was told
    -- it had too many requests running, or no confirmed order binding -- two
    -- answers that send someone to fix the wrong thing. Worse, the deep checks
    -- (payload size, server-controlled keys, delivery/order equality) were no
    -- longer enforced at the RPC boundary at all.
    --
    -- v2 is the only new behaviour in this migration. v1 must raise the same
    -- error, for the same reason, in the same order it always did.
    IF p_input->>'contractVersion'<>'designpro.calls-1-7-input.v1'
      OR NULLIF(pg_catalog.btrim(p_input->>'orderNumber'),'') IS NULL
      OR p_input->>'orderNumber'<>pg_catalog.btrim(p_input->>'orderNumber')
      OR p_input->>'orderNumber' !~
        '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
      OR pg_catalog.jsonb_typeof(p_input->'delivery')<>'object'
      OR NOT ((p_input->'delivery') ?& ARRAY[
        'contractVersion','recipientIdentityHash','orderNumber'
      ])
      OR (p_input->'delivery') - ARRAY[
        'contractVersion','recipientIdentityHash','orderNumber'
      ] <> '{}'::jsonb
      OR NULLIF(pg_catalog.btrim(
        p_input#>>'{delivery,contractVersion}'
      ),'') IS NULL
      OR p_input#>>'{delivery,contractVersion}'<>
        'designpro.wrapbox-recipient.v1'
      OR NULLIF(pg_catalog.btrim(
        p_input#>>'{delivery,recipientIdentityHash}'
      ),'') IS NULL
      OR p_input#>>'{delivery,recipientIdentityHash}' !~ '^[0-9a-f]{64}$'
      OR NULLIF(pg_catalog.btrim(p_input#>>'{delivery,orderNumber}'),'') IS NULL
      OR p_input#>>'{delivery,orderNumber}'<>p_input->>'orderNumber'
      OR pg_catalog.jsonb_typeof(p_input->'vehicle')<>'object'
      OR NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,year}'),'') IS NULL
      OR NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,make}'),'') IS NULL
      OR NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,model}'),'') IS NULL
      OR NULLIF(pg_catalog.btrim(p_input#>>'{vehicle,type}'),'') IS NULL
      OR p_input#>>'{vehicle,type}' <> ALL(ARRAY[
        'car','truck','suv','van','motorcycle','boat','bus','rv','trailer',
        'aircraft','heavy_equipment'
      ])
      OR pg_catalog.octet_length(p_input::text)>262144
      OR designpro_private.generation_input_has_server_controls(p_input)
      OR p_idempotency_key IS NULL
      OR pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) NOT BETWEEN 1 AND 200
      OR p_idempotency_key<>pg_catalog.btrim(p_idempotency_key)
    THEN RAISE EXCEPTION 'generation_request_invalid'; END IF;
    v_recipient_identity_hash:=p_input#>>'{delivery,recipientIdentityHash}';
    v_order_number:=p_input->>'orderNumber';
    v_expected_idempotency:='calls17:'||p_generation_id::text||':'
      ||v_recipient_identity_hash||':'||pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_order_number,'UTF8'),'sha256'),
        'hex'
      );
    IF p_idempotency_key IS DISTINCT FROM v_expected_idempotency
    THEN RAISE EXCEPTION 'generation_request_invalid'; END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.designpro_qc_members q
      JOIN auth.users ou ON ou.id=q.user_id
      JOIN designpro_private.business_customer_bindings b
        ON b.created_by_operator=q.user_id
      JOIN designpro_private.wrapbox_delivery_recipients r
        ON r.customer_id=b.customer_id
        AND r.customer_auth_user_id=b.customer_auth_user_id
        AND r.customer_email=b.customer_email
      JOIN auth.users cu ON cu.id=r.customer_auth_user_id
      WHERE q.user_id=v_owner AND q.can_operate
        AND ou.email_confirmed_at IS NOT NULL
        AND r.recipient_identity_hash=v_recipient_identity_hash
        AND r.order_number=v_order_number
        AND p_input#>>'{delivery,orderNumber}'=r.order_number
        AND cu.email_confirmed_at IS NOT NULL
        AND pg_catalog.lower(pg_catalog.btrim(cu.email))=r.customer_email
    ) THEN RAISE EXCEPTION 'confirmed_operator_order_binding_required'; END IF;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'designpro.calls-1-7.owner:'||v_owner::text,0
  ));

  SELECT * INTO v_row FROM public.designpro_generation_requests
  WHERE owner_id=v_owner AND generation_id=p_generation_id;
  IF FOUND THEN
    -- THE IMMUTABILITY LOCK. A generationId already carrying a different brief,
    -- vehicle or identity payload is not a retry of this request -- it is a
    -- second design wearing the first one's name, and every downstream Call 8
    -- and Call 9 artifact points at that name. Answer plainly and make the
    -- caller mint a new id.
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

COMMENT ON FUNCTION public.create_designpro_generation_request(uuid,jsonb,text) IS
  'Calls 1-7 intake. v2 is design-first: vehicle + brief + customer identity, no '
  'order and no WrapBox recipient. v1 keeps the operator-order binding unchanged. '
  'A generationId is immutable -- the same id with a different input hash raises '
  'generation_input_conflict and the caller must mint a new one.';
