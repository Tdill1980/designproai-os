-- Standalone DesignProAI WrapBox delivery closure.
--
-- This migration deliberately does not recreate any shared-application pack,
-- shop, job, or email coupling.  A pack is published only after the standalone
-- production workflow is completed and the exact ZIP + manifest identities
-- already exist in the immutable ledger.

CREATE SCHEMA IF NOT EXISTS designpro_private;
REVOKE ALL ON SCHEMA designpro_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA designpro_private TO service_role;

-- Append-only recipient bindings keep the business customer identity separate
-- from both the submitting operator and Supabase Auth.  A trusted server may
-- register a binding only after the customer's Auth email is confirmed and an
-- order/customer-system verification reference has been hashed.
CREATE TABLE IF NOT EXISTS designpro_private.business_customer_bindings (
  customer_id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  customer_auth_user_id uuid NOT NULL UNIQUE
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  customer_email text NOT NULL UNIQUE CHECK (
    length(customer_email) BETWEEN 3 AND 320
    AND customer_email = lower(btrim(customer_email))
    AND customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  customer_reference text NOT NULL CHECK (
    customer_reference = btrim(customer_reference)
    AND length(customer_reference) BETWEEN 1 AND 160
    AND customer_reference !~ '[[:cntrl:]]'
  ),
  customer_reference_key text NOT NULL CHECK (
    customer_reference_key = lower(btrim(customer_reference_key))
    AND length(customer_reference_key) BETWEEN 1 AND 160
    AND customer_reference_key !~ '[[:cntrl:]]'
  ),
  created_by_operator uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  email_verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designpro_customer_operator_separation CHECK (
    customer_auth_user_id <> created_by_operator
    AND customer_id <> created_by_operator
  )
);

CREATE TABLE IF NOT EXISTS designpro_private.wrapbox_delivery_recipients (
  recipient_identity_hash text PRIMARY KEY CHECK (
    recipient_identity_hash ~ '^[0-9a-f]{64}$'
  ),
  customer_id uuid NOT NULL
    REFERENCES designpro_private.business_customer_bindings(customer_id)
      ON DELETE RESTRICT,
  customer_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  customer_email text NOT NULL CHECK (
    length(customer_email) BETWEEN 3 AND 320
    AND customer_email = lower(btrim(customer_email))
    AND customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  verification_ref_hash text NOT NULL CHECK (
    verification_ref_hash ~ '^[0-9a-f]{64}$'
  ),
  order_number text NOT NULL CHECK (
    order_number = btrim(order_number)
    AND order_number ~ '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
  ),
  email_verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(
    customer_id, customer_auth_user_id, customer_email,
    verification_ref_hash, order_number
  )
);

CREATE TABLE IF NOT EXISTS public.designpro_wrapbox_packs (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE
    REFERENCES public.designpro_workflow_runs(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  customer_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL
    REFERENCES public.designpro_revision_sources(revision_id) ON DELETE RESTRICT,
  entice_pack_id uuid NOT NULL,
  tenant_key text NOT NULL,
  design_id text NOT NULL CHECK (design_id ~ '^DID-[0-9A-F]{8}$'),
  order_number text NOT NULL CHECK (
    order_number = btrim(order_number)
    AND order_number ~ '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
  ),
  design_name text NOT NULL CHECK (
    btrim(design_name) <> '' AND length(design_name) <= 240
  ),
  zip_storage_path text NOT NULL,
  zip_content_hash text NOT NULL CHECK (zip_content_hash ~ '^[0-9a-f]{64}$'),
  zip_byte_size bigint NOT NULL CHECK (zip_byte_size > 0),
  manifest_storage_path text NOT NULL,
  manifest_content_hash text NOT NULL CHECK (manifest_content_hash ~ '^[0-9a-f]{64}$'),
  manifest_byte_size bigint NOT NULL CHECK (manifest_byte_size > 0),
  logo_inventory jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(logo_inventory) = 'array'
  ),
  delivery_receipt_hash text NOT NULL CHECK (
    delivery_receipt_hash ~ '^[0-9a-f]{64}$'
    AND delivery_receipt_hash = manifest_content_hash
  ),
  ready_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designpro_wrapbox_pack_tenant_safe CHECK (
    tenant_key ~ '^[a-z0-9]([a-z0-9_-]{0,126}[a-z0-9])?$'
  ),
  CONSTRAINT designpro_wrapbox_pack_exact_paths CHECK (
    zip_storage_path = 'wrapbox/' || tenant_key || '/' || entice_pack_id::text
      || '/' || run_id::text || '/production-pack.zip'
    AND manifest_storage_path = 'wrapbox/' || tenant_key || '/'
      || entice_pack_id::text || '/' || run_id::text || '/manifest.json'
  )
);

CREATE INDEX IF NOT EXISTS designpro_wrapbox_packs_owner_ready_idx
  ON public.designpro_wrapbox_packs(customer_id, ready_at DESC);
CREATE INDEX IF NOT EXISTS designpro_wrapbox_packs_operator_ready_idx
  ON public.designpro_wrapbox_packs(operator_id, ready_at DESC);

CREATE TABLE IF NOT EXISTS designpro_private.wrapbox_notification_outbox (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  pack_id uuid NOT NULL UNIQUE
    REFERENCES public.designpro_wrapbox_packs(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  customer_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recipient_email text NOT NULL CHECK (
    length(recipient_email) BETWEEN 3 AND 320
    AND recipient_email = lower(btrim(recipient_email))
    AND recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  recipient_email_hash text NOT NULL CHECK (
    recipient_email_hash ~ '^[0-9a-f]{64}$'
  ),
  template_payload jsonb NOT NULL CHECK (
    jsonb_typeof(template_payload) = 'object'
    AND template_payload ?& ARRAY[
      'contractVersion','packId','designId','orderNumber','designName',
      'portalPath','zipContentHash'
    ]
    AND template_payload->>'contractVersion' =
      'designpro.wrapbox-notification.v1'
    AND template_payload->>'packId' = pack_id::text
    AND NULLIF(btrim(template_payload->>'designName'), '') IS NOT NULL
    AND template_payload->>'designId' ~ '^DID-[0-9A-F]{8}$'
    AND template_payload->>'orderNumber' ~
      '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
    AND template_payload->>'portalPath' = '/app/wrapbox/' || pack_id::text
    AND template_payload->>'zipContentHash' ~ '^[0-9a-f]{64}$'
    AND NOT template_payload ? 'recipientEmail'
  ),
  idempotency_key text NOT NULL UNIQUE CHECK (
    btrim(idempotency_key) <> '' AND length(idempotency_key) <= 256
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'sending', 'retryable', 'sent', 'failed')
  ),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designpro_wrapbox_notification_lease_integrity CHECK (
    (status = 'sending') =
      (lease_owner IS NOT NULL AND lease_token IS NOT NULL
        AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT designpro_wrapbox_notification_sent_integrity CHECK (
    status <> 'sent' OR
      (sent_at IS NOT NULL AND NULLIF(btrim(provider_message_id), '') IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS designpro_wrapbox_notification_claim_idx
  ON designpro_private.wrapbox_notification_outbox(
    status, available_at, lease_expires_at, created_at
  );

CREATE OR REPLACE FUNCTION designpro_private.guard_wrapbox_pack_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
BEGIN
  RAISE EXCEPTION 'designpro_wrapbox_pack_is_immutable';
END
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.guard_wrapbox_recipient_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
BEGIN
  RAISE EXCEPTION 'designpro_wrapbox_recipient_is_immutable';
END
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.guard_business_customer_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
BEGIN
  RAISE EXCEPTION 'designpro_business_customer_binding_is_immutable';
END
$fn$;

DROP TRIGGER IF EXISTS designpro_business_customer_binding_immutable
  ON designpro_private.business_customer_bindings;
CREATE TRIGGER designpro_business_customer_binding_immutable
BEFORE UPDATE OR DELETE ON designpro_private.business_customer_bindings
FOR EACH ROW EXECUTE FUNCTION
  designpro_private.guard_business_customer_immutable();

DROP TRIGGER IF EXISTS designpro_wrapbox_recipient_immutable
  ON designpro_private.wrapbox_delivery_recipients;
CREATE TRIGGER designpro_wrapbox_recipient_immutable
BEFORE UPDATE OR DELETE ON designpro_private.wrapbox_delivery_recipients
FOR EACH ROW EXECUTE FUNCTION
  designpro_private.guard_wrapbox_recipient_immutable();

DROP TRIGGER IF EXISTS designpro_wrapbox_pack_immutable
  ON public.designpro_wrapbox_packs;
CREATE TRIGGER designpro_wrapbox_pack_immutable
BEFORE UPDATE OR DELETE ON public.designpro_wrapbox_packs
FOR EACH ROW EXECUTE FUNCTION designpro_private.guard_wrapbox_pack_immutable();

ALTER TABLE public.designpro_wrapbox_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE designpro_private.wrapbox_notification_outbox
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE designpro_private.wrapbox_delivery_recipients
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE designpro_private.business_customer_bindings
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS designpro_owner_read_wrapbox_packs
  ON public.designpro_wrapbox_packs;
CREATE POLICY designpro_owner_read_wrapbox_packs
ON public.designpro_wrapbox_packs
FOR SELECT
TO authenticated
USING (
  customer_auth_user_id = (SELECT auth.uid())
  OR operator_id = (SELECT auth.uid())
);

-- The earlier storage policy grants the workflow operator access.  This
-- additive policy gives a distinct customer access only to the two immutable
-- objects bound by their published pack row.
DROP POLICY IF EXISTS designpro_customer_read_wrapbox_delivery
  ON storage.objects;
CREATE POLICY designpro_customer_read_wrapbox_delivery
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'wrap-files'
  AND EXISTS (
    SELECT 1
    FROM public.designpro_wrapbox_packs p
    WHERE p.customer_auth_user_id = (SELECT auth.uid())
      AND name IN (p.zip_storage_path, p.manifest_storage_path)
  )
);

-- Data API privileges and RLS are deliberately separate.  Customers may read
-- only their own pack metadata.  The email address remains in a private schema
-- and is available only through service-role RPCs.
REVOKE ALL ON public.designpro_wrapbox_packs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.designpro_wrapbox_packs TO authenticated;
GRANT ALL ON public.designpro_wrapbox_packs TO service_role;
REVOKE ALL ON designpro_private.wrapbox_notification_outbox
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON designpro_private.wrapbox_delivery_recipients
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON designpro_private.business_customer_bindings
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_designpro_wrapbox_recipient(
  p_customer_email text,
  p_customer_reference text,
  p_verification_ref_hash text,
  p_order_number text,
  p_operator_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_email text;
  v_customer_reference text;
  v_customer_reference_key text;
  v_customer_auth_user_id uuid;
  v_verified_at timestamptz;
  v_identity_hash text;
  v_created boolean := false;
  v_row_count integer := 0;
  v_customer designpro_private.business_customer_bindings%ROWTYPE;
  v_recipient designpro_private.wrapbox_delivery_recipients%ROWTYPE;
BEGIN
  IF pg_catalog.coalesce(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  v_email := pg_catalog.lower(pg_catalog.btrim(p_customer_email));
  v_customer_reference := pg_catalog.btrim(pg_catalog.regexp_replace(
    p_customer_reference, '[[:space:]]+', ' ', 'g'
  ));
  v_customer_reference_key := pg_catalog.lower(v_customer_reference);
  IF p_operator_id IS NULL OR v_email !~
      '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR pg_catalog.length(v_email) NOT BETWEEN 3 AND 320
    OR pg_catalog.length(v_customer_reference) NOT BETWEEN 1 AND 160
    OR v_customer_reference ~ '[[:cntrl:]]'
    OR pg_catalog.lower(p_verification_ref_hash) !~ '^[0-9a-f]{64}$'
    OR p_order_number IS DISTINCT FROM pg_catalog.btrim(p_order_number)
    OR p_order_number !~ '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
  THEN RAISE EXCEPTION 'verified_customer_binding_required'; END IF;

  SELECT u.id, u.email_confirmed_at
  INTO v_customer_auth_user_id, v_verified_at
  FROM auth.users u
  WHERE pg_catalog.lower(pg_catalog.btrim(u.email)) = v_email
    AND u.email_confirmed_at IS NOT NULL
  ORDER BY u.id
  LIMIT 1;
  IF NOT FOUND OR v_customer_auth_user_id IS NOT DISTINCT FROM p_operator_id
    OR EXISTS (
    SELECT 1 FROM auth.users duplicate_user
    WHERE pg_catalog.lower(pg_catalog.btrim(duplicate_user.email)) = v_email
      AND duplicate_user.email_confirmed_at IS NOT NULL
      AND duplicate_user.id IS DISTINCT FROM v_customer_auth_user_id
  ) THEN
    RAISE EXCEPTION 'confirmed_customer_auth_email_required';
  END IF;

  INSERT INTO designpro_private.business_customer_bindings(
    customer_auth_user_id, customer_email, customer_reference,
    customer_reference_key, created_by_operator, email_verified_at
  ) VALUES (
    v_customer_auth_user_id, v_email, v_customer_reference,
    v_customer_reference_key, p_operator_id, v_verified_at
  ) ON CONFLICT (customer_email) DO NOTHING;

  SELECT * INTO v_customer
  FROM designpro_private.business_customer_bindings b
  WHERE b.customer_email = v_email;
  IF NOT FOUND OR v_customer.customer_auth_user_id IS DISTINCT FROM
      v_customer_auth_user_id
    OR v_customer.customer_reference_key IS DISTINCT FROM
      v_customer_reference_key
  THEN RAISE EXCEPTION 'business_customer_binding_conflict'; END IF;

  v_identity_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'customerId', v_customer.customer_id,
      'customerAuthUserId', v_customer_auth_user_id,
      'customerEmail', v_email,
      'emailVerifiedAt', v_verified_at,
      'verificationRefHash', pg_catalog.lower(p_verification_ref_hash),
      'orderNumber', p_order_number
    )::text, 'UTF8'),
    'sha256'
  ), 'hex');
  INSERT INTO designpro_private.wrapbox_delivery_recipients(
    recipient_identity_hash, customer_id, customer_auth_user_id,
    customer_email, verification_ref_hash, order_number, email_verified_at
  ) VALUES (
    v_identity_hash, v_customer.customer_id, v_customer_auth_user_id, v_email,
    pg_catalog.lower(p_verification_ref_hash), p_order_number, v_verified_at
  ) ON CONFLICT (recipient_identity_hash) DO NOTHING;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_created := v_row_count = 1;

  SELECT * INTO v_recipient
  FROM designpro_private.wrapbox_delivery_recipients
  WHERE recipient_identity_hash = v_identity_hash;
  IF v_recipient.customer_id IS DISTINCT FROM v_customer.customer_id
    OR v_recipient.customer_auth_user_id IS DISTINCT FROM
      v_customer_auth_user_id
    OR v_recipient.customer_email IS DISTINCT FROM v_email
    OR v_recipient.verification_ref_hash
      IS DISTINCT FROM pg_catalog.lower(p_verification_ref_hash)
    OR v_recipient.order_number IS DISTINCT FROM p_order_number
  THEN RAISE EXCEPTION 'recipient_registration_identity_conflict'; END IF;

  RETURN pg_catalog.jsonb_build_object(
    'customerId', v_recipient.customer_id,
    'customerEmail', v_recipient.customer_email,
    'recipientIdentityHash', v_recipient.recipient_identity_hash,
    'orderNumber', v_recipient.order_number,
    'emailVerifiedAt', v_recipient.email_verified_at,
    'idempotent', NOT v_created
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.commit_designpro_wrapbox_pack(
  p_run_id uuid,
  p_observed_zip_hash text,
  p_observed_zip_bytes bigint,
  p_observed_manifest_hash text,
  p_observed_manifest_bytes bigint,
  p_observed_logo_inventory jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_source public.designpro_revision_sources%ROWTYPE;
  v_zip public.designpro_stage_receipts%ROWTYPE;
  v_delivery_receipt public.designpro_stage_receipts%ROWTYPE;
  v_zip_artifact public.designpro_artifacts%ROWTYPE;
  v_manifest_artifact public.designpro_artifacts%ROWTYPE;
  v_pack public.designpro_wrapbox_packs%ROWTYPE;
  v_outbox designpro_private.wrapbox_notification_outbox%ROWTYPE;
  v_recipient designpro_private.wrapbox_delivery_recipients%ROWTYPE;
  v_delivery jsonb;
  v_source_entice_run_id uuid;
  v_customer_id uuid;
  v_customer_email text;
  v_confirmed_email text;
  v_email_hash text;
  v_design_id text;
  v_order_number text;
  v_design_name text;
  v_expected_zip_path text;
  v_expected_manifest_path text;
  v_idempotency_key text;
  v_logo_inventory jsonb;
  v_pack_created boolean := false;
BEGIN
  IF pg_catalog.coalesce(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('designpro.wrapbox-pack:' || p_run_id::text, 0)
  );

  SELECT * INTO v_run
  FROM public.designpro_workflow_runs
  WHERE id = p_run_id AND workflow_type = 'designpro.production_pack'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'production_workflow_not_found'; END IF;
  IF v_run.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'completed_production_workflow_required';
  END IF;

  SELECT * INTO v_source
  FROM public.designpro_revision_sources
  WHERE revision_id = v_run.revision_id
    AND owner_id = v_run.owner_id
    AND tenant_key = v_run.tenant_key
    AND snapshot_hash = v_run.revision_snapshot_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'immutable_revision_identity_mismatch'; END IF;

  IF v_run.results->>'sourceEnticeRunId' !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN RAISE EXCEPTION 'source_entice_run_identity_required'; END IF;
  v_source_entice_run_id := (v_run.results->>'sourceEnticeRunId')::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM public.designpro_workflow_runs e
    WHERE e.id=v_source_entice_run_id
      AND e.workflow_type='designpro.entice_pack'
      AND e.status='completed'
      AND e.owner_id=v_run.owner_id
      AND e.tenant_key=v_run.tenant_key
      AND e.revision_id=v_run.revision_id
      AND e.revision_snapshot_hash=v_run.revision_snapshot_hash
      AND e.entice_pack_id=v_run.entice_pack_id
      AND e.artifact_set_hash=v_run.artifact_set_hash
  ) THEN RAISE EXCEPTION 'source_entice_run_identity_mismatch'; END IF;

  v_delivery := v_source.snapshot->'delivery';
  IF pg_catalog.jsonb_typeof(v_delivery) IS DISTINCT FROM 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_delivery)) <> 6
    OR v_delivery->>'contractVersion' IS DISTINCT FROM
      'designpro.wrapbox-recipient.v1'
    OR NOT v_delivery ?& ARRAY[
      'contractVersion', 'customerId', 'customerEmail',
      'recipientIdentityHash', 'orderNumber', 'designName'
    ]
  THEN
    RAISE EXCEPTION
      'delivery_recipient_snapshot_required: delivery.contractVersion, delivery.customerId, delivery.customerEmail, delivery.recipientIdentityHash, delivery.orderNumber, delivery.designName';
  END IF;

  IF v_delivery->>'customerId' !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN RAISE EXCEPTION 'delivery_customer_id_invalid'; END IF;
  v_customer_id := (v_delivery->>'customerId')::uuid;
  v_customer_email := pg_catalog.lower(pg_catalog.btrim(
    v_delivery->>'customerEmail'
  ));
  IF pg_catalog.length(v_customer_email) NOT BETWEEN 3 AND 320
    OR v_customer_email !~
      '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR v_delivery->>'customerEmail' IS DISTINCT FROM v_customer_email
  THEN RAISE EXCEPTION 'delivery_customer_email_invalid'; END IF;

  IF pg_catalog.lower(v_delivery->>'recipientIdentityHash')
      !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'delivery_recipient_identity_hash_invalid'; END IF;
  SELECT * INTO v_recipient
  FROM designpro_private.wrapbox_delivery_recipients
  WHERE recipient_identity_hash =
      pg_catalog.lower(v_delivery->>'recipientIdentityHash')
    AND customer_id = v_customer_id
    AND customer_email = v_customer_email
    AND order_number = v_delivery->>'orderNumber';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'verified_delivery_recipient_binding_required';
  END IF;
  SELECT pg_catalog.lower(pg_catalog.btrim(email)) INTO v_confirmed_email
  FROM auth.users
  WHERE id = v_recipient.customer_auth_user_id
    AND email_confirmed_at IS NOT NULL;
  IF NOT FOUND OR v_confirmed_email IS DISTINCT FROM v_customer_email THEN
    RAISE EXCEPTION 'delivery_customer_email_unconfirmed_or_changed';
  END IF;

  v_design_name := pg_catalog.btrim(v_delivery->>'designName');
  IF pg_catalog.length(v_design_name) NOT BETWEEN 1 AND 240
    OR v_delivery->>'designName' IS DISTINCT FROM v_design_name
  THEN RAISE EXCEPTION 'delivery_design_name_invalid'; END IF;

  v_design_id := v_source.snapshot->>'designId';
  v_order_number := v_source.snapshot->>'orderNumber';
  IF v_source.snapshot->>'generationId' IS DISTINCT FROM
      v_source.generation_id::text
    OR v_design_id IS DISTINCT FROM 'DID-' || pg_catalog.upper(
      pg_catalog.substr(pg_catalog.replace(v_source.generation_id::text,'-',''),1,8)
    )
    OR v_order_number IS DISTINCT FROM pg_catalog.btrim(v_order_number)
    OR v_order_number !~ '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
    OR v_delivery->>'orderNumber' IS DISTINCT FROM v_order_number
  THEN RAISE EXCEPTION 'immutable_design_id_and_order_number_required'; END IF;

  SELECT * INTO v_zip
  FROM public.designpro_stage_receipts
  WHERE run_id = v_run.id AND receipt_kind = 'zip';
  IF NOT FOUND
    OR v_zip.receipt->>'receiptKind' IS DISTINCT FROM 'zip'
    OR v_zip.receipt->>'zipHash' IS DISTINCT FROM v_zip.receipt_hash
  THEN RAISE EXCEPTION 'verified_zip_receipt_required'; END IF;

  SELECT * INTO v_delivery_receipt
  FROM public.designpro_stage_receipts
  WHERE run_id = v_run.id AND receipt_kind = 'wrapbox.delivery';
  IF NOT FOUND
    OR v_delivery_receipt.receipt->>'receiptKind'
      IS DISTINCT FROM 'wrapbox.delivery'
    OR v_delivery_receipt.receipt->>'zipHash'
      IS DISTINCT FROM v_zip.receipt_hash
  THEN RAISE EXCEPTION 'verified_wrapbox_delivery_receipt_required'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.designpro_workflow_stages s
    WHERE s.id = v_zip.stage_id AND s.run_id = v_run.id
      AND s.stage_key = 'zip.build' AND s.status = 'completed'
      AND s.verification @> '{"verified":true}'::jsonb
      AND s.output_hash = v_zip.receipt_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM public.designpro_workflow_stages s
    WHERE s.id = v_delivery_receipt.stage_id AND s.run_id = v_run.id
      AND s.stage_key = 'wrapbox.deliver' AND s.status = 'completed'
      AND s.verification @> '{"verified":true}'::jsonb
      AND s.output_hash = v_delivery_receipt.receipt_hash
  ) THEN RAISE EXCEPTION 'completed_delivery_stage_evidence_required'; END IF;

  v_expected_zip_path := 'wrapbox/' || v_run.tenant_key || '/'
    || v_run.entice_pack_id::text || '/' || v_run.id::text
    || '/production-pack.zip';
  v_expected_manifest_path := 'wrapbox/' || v_run.tenant_key || '/'
    || v_run.entice_pack_id::text || '/' || v_run.id::text
    || '/manifest.json';
  IF v_delivery_receipt.receipt->>'deliveredZipPath'
      IS DISTINCT FROM v_expected_zip_path
    OR v_delivery_receipt.receipt->>'manifestPath'
      IS DISTINCT FROM v_expected_manifest_path
  THEN RAISE EXCEPTION 'wrapbox_delivery_path_identity_mismatch'; END IF;

  SELECT * INTO v_zip_artifact
  FROM public.designpro_artifacts
  WHERE run_id = v_run.id AND stage_id = v_zip.stage_id
    AND artifact_kind = 'zip' AND surface_key = ''
    AND content_hash = v_zip.receipt_hash
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR v_zip_artifact.byte_size IS NULL THEN
    RAISE EXCEPTION 'exact_zip_artifact_required';
  END IF;

  SELECT * INTO v_manifest_artifact
  FROM public.designpro_artifacts
  WHERE run_id = v_run.id AND stage_id = v_delivery_receipt.stage_id
    AND artifact_kind = 'wrapbox-manifest' AND surface_key = ''
    AND storage_path = v_expected_manifest_path
    AND content_hash = v_delivery_receipt.receipt_hash
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR v_manifest_artifact.byte_size IS NULL
    OR v_manifest_artifact.metadata->>'zipHash'
      IS DISTINCT FROM v_zip.receipt_hash
    OR v_manifest_artifact.metadata->>'designId' IS DISTINCT FROM v_design_id
    OR v_manifest_artifact.metadata->>'orderNumber'
      IS DISTINCT FROM v_order_number
  THEN RAISE EXCEPTION 'exact_wrapbox_manifest_artifact_required'; END IF;

  IF pg_catalog.lower(p_observed_zip_hash) !~ '^[0-9a-f]{64}$'
    OR pg_catalog.lower(p_observed_zip_hash)
      IS DISTINCT FROM v_zip.receipt_hash
    OR p_observed_zip_bytes IS DISTINCT FROM v_zip_artifact.byte_size
    OR pg_catalog.lower(p_observed_manifest_hash) !~ '^[0-9a-f]{64}$'
    OR pg_catalog.lower(p_observed_manifest_hash)
      IS DISTINCT FROM v_manifest_artifact.content_hash
    OR p_observed_manifest_bytes
      IS DISTINCT FROM v_manifest_artifact.byte_size
  THEN RAISE EXCEPTION 'observed_delivery_bytes_do_not_match_ledger'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.designpro_artifacts a
    WHERE a.run_id = v_source_entice_run_id AND a.artifact_kind = 'logo'
      AND (
        NULLIF(pg_catalog.btrim(a.metadata->>'placementKey'), '') IS NULL
        OR a.metadata->>'placementKey' IS DISTINCT FROM a.surface_key
        OR NULLIF(pg_catalog.btrim(a.metadata->>'identityKey'), '') IS NULL
        OR NULLIF(pg_catalog.btrim(a.metadata->>'displayName'), '') IS NULL
        OR a.metadata->>'targetSurfaceKey'
          NOT IN ('driver','passenger','hood','roof','front','rear')
      )
  ) THEN RAISE EXCEPTION 'logo_placement_identity_incomplete'; END IF;
  SELECT pg_catalog.coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'placementKey', a.metadata->>'placementKey',
        'identityKey', a.metadata->>'identityKey',
        'displayName', a.metadata->>'displayName',
        'targetSurfaceKey', a.metadata->>'targetSurfaceKey',
        'storagePath', a.storage_path,
        'contentHash', a.content_hash,
        'byteSize', a.byte_size,
        'contentType', a.metadata->>'contentType'
      ) ORDER BY a.metadata->>'placementKey'
    ),
    '[]'::jsonb
  ) INTO v_logo_inventory
  FROM public.designpro_artifacts a
  WHERE a.run_id = v_source_entice_run_id AND a.artifact_kind = 'logo';
  IF pg_catalog.jsonb_typeof(p_observed_logo_inventory) IS DISTINCT FROM 'array'
    OR p_observed_logo_inventory IS DISTINCT FROM v_logo_inventory
  THEN RAISE EXCEPTION 'manifest_logo_inventory_does_not_match_ledger'; END IF;

  SELECT * INTO v_pack
  FROM public.designpro_wrapbox_packs
  WHERE run_id = v_run.id
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.designpro_wrapbox_packs(
      run_id, operator_id, customer_id, customer_auth_user_id,
      revision_id, entice_pack_id,
      tenant_key, design_id, order_number, design_name,
      zip_storage_path, zip_content_hash, zip_byte_size,
      manifest_storage_path, manifest_content_hash, manifest_byte_size,
      logo_inventory, delivery_receipt_hash, ready_at
    ) VALUES (
      v_run.id, v_run.owner_id, v_customer_id,
      v_recipient.customer_auth_user_id, v_run.revision_id,
      v_run.entice_pack_id, v_run.tenant_key, v_design_id, v_order_number,
      v_design_name, v_expected_zip_path,
      v_zip.receipt_hash, v_zip_artifact.byte_size, v_expected_manifest_path,
      v_manifest_artifact.content_hash, v_manifest_artifact.byte_size,
      v_logo_inventory, v_delivery_receipt.receipt_hash,
      (v_delivery_receipt.receipt->>'deliveredAt')::timestamptz
    ) RETURNING * INTO v_pack;
    v_pack_created := true;
  END IF;

  IF v_pack.operator_id IS DISTINCT FROM v_run.owner_id
    OR v_pack.customer_id IS DISTINCT FROM v_customer_id
    OR v_pack.customer_auth_user_id
      IS DISTINCT FROM v_recipient.customer_auth_user_id
    OR v_pack.revision_id IS DISTINCT FROM v_run.revision_id
    OR v_pack.entice_pack_id IS DISTINCT FROM v_run.entice_pack_id
    OR v_pack.tenant_key IS DISTINCT FROM v_run.tenant_key
    OR v_pack.design_id IS DISTINCT FROM v_design_id
    OR v_pack.order_number IS DISTINCT FROM v_order_number
    OR v_pack.design_name IS DISTINCT FROM v_design_name
    OR v_pack.zip_storage_path IS DISTINCT FROM v_expected_zip_path
    OR v_pack.zip_content_hash IS DISTINCT FROM v_zip.receipt_hash
    OR v_pack.zip_byte_size IS DISTINCT FROM v_zip_artifact.byte_size
    OR v_pack.manifest_storage_path IS DISTINCT FROM v_expected_manifest_path
    OR v_pack.manifest_content_hash
      IS DISTINCT FROM v_manifest_artifact.content_hash
    OR v_pack.manifest_byte_size IS DISTINCT FROM v_manifest_artifact.byte_size
    OR v_pack.logo_inventory IS DISTINCT FROM v_logo_inventory
    OR v_pack.delivery_receipt_hash
      IS DISTINCT FROM v_delivery_receipt.receipt_hash
  THEN RAISE EXCEPTION 'wrapbox_pack_idempotency_identity_conflict'; END IF;

  v_email_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_customer_email, 'UTF8'), 'sha256'
  ), 'hex');
  v_idempotency_key := 'designpro-wrapbox-email:' || v_pack.id::text
    || ':' || v_pack.manifest_content_hash;
  INSERT INTO designpro_private.wrapbox_notification_outbox(
    pack_id, operator_id, customer_id, customer_auth_user_id,
    recipient_email, recipient_email_hash,
    template_payload, idempotency_key
  ) VALUES (
    v_pack.id, v_pack.operator_id, v_pack.customer_id,
    v_pack.customer_auth_user_id,
    v_customer_email, v_email_hash,
    pg_catalog.jsonb_build_object(
      'contractVersion', 'designpro.wrapbox-notification.v1',
      'packId', v_pack.id,
      'designId', v_pack.design_id,
      'orderNumber', v_pack.order_number,
      'designName', v_pack.design_name,
      'portalPath', '/app/wrapbox/' || v_pack.id::text,
      'zipContentHash', v_pack.zip_content_hash
    ),
    v_idempotency_key
  ) ON CONFLICT (pack_id) DO NOTHING;

  SELECT * INTO v_outbox
  FROM designpro_private.wrapbox_notification_outbox
  WHERE pack_id = v_pack.id
  FOR UPDATE;
  IF v_outbox.operator_id IS DISTINCT FROM v_pack.operator_id
    OR v_outbox.customer_id IS DISTINCT FROM v_pack.customer_id
    OR v_outbox.customer_auth_user_id
      IS DISTINCT FROM v_pack.customer_auth_user_id
    OR v_outbox.recipient_email IS DISTINCT FROM v_customer_email
    OR v_outbox.recipient_email_hash IS DISTINCT FROM v_email_hash
    OR v_outbox.idempotency_key IS DISTINCT FROM v_idempotency_key
    OR v_outbox.template_payload->>'designId'
      IS DISTINCT FROM v_pack.design_id
    OR v_outbox.template_payload->>'orderNumber'
      IS DISTINCT FROM v_pack.order_number
    OR v_outbox.template_payload->>'zipContentHash'
      IS DISTINCT FROM v_pack.zip_content_hash
  THEN RAISE EXCEPTION 'wrapbox_notification_idempotency_identity_conflict';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'packId', v_pack.id,
    'runId', v_pack.run_id,
    'operatorId', v_pack.operator_id,
    'customerId', v_pack.customer_id,
    'designId', v_pack.design_id,
    'orderNumber', v_pack.order_number,
    'zipStoragePath', v_pack.zip_storage_path,
    'zipContentHash', v_pack.zip_content_hash,
    'manifestStoragePath', v_pack.manifest_storage_path,
    'manifestContentHash', v_pack.manifest_content_hash,
    'notificationStatus', v_outbox.status,
    'idempotent', NOT v_pack_created
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.claim_designpro_wrapbox_notification(
  p_worker text,
  p_lease_seconds integer DEFAULT 120
) RETURNS TABLE(
  notification_id uuid,
  lease_token uuid,
  pack_id uuid,
  operator_id uuid,
  customer_id uuid,
  recipient_email text,
  template_payload jsonb,
  idempotency_key text,
  attempt integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_id uuid;
  v_token uuid := extensions.gen_random_uuid();
BEGIN
  IF pg_catalog.coalesce(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_worker), '') IS NULL
    OR pg_catalog.length(p_worker) > 240
    OR p_lease_seconds NOT BETWEEN 15 AND 900
  THEN RAISE EXCEPTION 'invalid_notification_lease_request'; END IF;

  SELECT q.id INTO v_id
  FROM designpro_private.wrapbox_notification_outbox q
  WHERE q.attempt < q.max_attempts
    AND (
      (q.status IN ('pending', 'retryable')
        AND q.available_at <= pg_catalog.clock_timestamp())
      OR (q.status = 'sending'
        AND q.lease_expires_at <= pg_catalog.clock_timestamp())
    )
  ORDER BY q.available_at, q.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;

  UPDATE designpro_private.wrapbox_notification_outbox q
  SET status = 'sending',
    attempt = q.attempt + 1,
    lease_owner = p_worker,
    lease_token = v_token,
    lease_expires_at = pg_catalog.clock_timestamp()
      + pg_catalog.make_interval(secs => p_lease_seconds),
    last_error = NULL,
    updated_at = pg_catalog.clock_timestamp()
  WHERE q.id = v_id;

  RETURN QUERY
  SELECT q.id, q.lease_token, q.pack_id, q.operator_id, q.customer_id,
    q.recipient_email,
    q.template_payload, q.idempotency_key, q.attempt
  FROM designpro_private.wrapbox_notification_outbox q
  WHERE q.id = v_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.complete_designpro_wrapbox_notification(
  p_notification_id uuid,
  p_lease_token uuid,
  p_provider_message_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF pg_catalog.coalesce(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_provider_message_id), '') IS NULL
    OR pg_catalog.length(p_provider_message_id) > 500
  THEN RAISE EXCEPTION 'provider_message_id_required'; END IF;

  UPDATE designpro_private.wrapbox_notification_outbox
  SET status = 'sent',
    provider_message_id = pg_catalog.btrim(p_provider_message_id),
    sent_at = pg_catalog.clock_timestamp(),
    lease_owner = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_notification_id AND status = 'sending'
    AND lease_token = p_lease_token
    AND lease_expires_at > pg_catalog.clock_timestamp();
  RETURN FOUND;
END
$fn$;

CREATE OR REPLACE FUNCTION public.fail_designpro_wrapbox_notification(
  p_notification_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean DEFAULT true
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF pg_catalog.coalesce(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  UPDATE designpro_private.wrapbox_notification_outbox q
  SET status = CASE
      WHEN p_retryable AND q.attempt < q.max_attempts THEN 'retryable'
      ELSE 'failed'
    END,
    available_at = CASE
      WHEN p_retryable AND q.attempt < q.max_attempts
      THEN pg_catalog.clock_timestamp() + pg_catalog.make_interval(
        secs => pg_catalog.least(
          900,
          15 * pg_catalog.power(2, pg_catalog.greatest(q.attempt - 1, 0))::integer
        )
      )
      ELSE q.available_at
    END,
    last_error = pg_catalog.left(
      pg_catalog.coalesce(NULLIF(pg_catalog.btrim(p_error), ''),
        'notification_transport_failed'),
      1000
    ),
    lease_owner = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    updated_at = pg_catalog.clock_timestamp()
  WHERE q.id = p_notification_id AND q.status = 'sending'
    AND q.lease_token = p_lease_token;
  RETURN FOUND;
END
$fn$;

REVOKE ALL ON FUNCTION designpro_private.guard_wrapbox_pack_immutable()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION designpro_private.guard_wrapbox_recipient_immutable()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION designpro_private.guard_business_customer_immutable()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.register_designpro_wrapbox_recipient(
  text, text, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.commit_designpro_wrapbox_pack(
  uuid, text, bigint, text, bigint, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_designpro_wrapbox_notification(text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_designpro_wrapbox_notification(
  uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_designpro_wrapbox_notification(
  uuid, uuid, text, boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.commit_designpro_wrapbox_pack(
  uuid, text, bigint, text, bigint, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_designpro_wrapbox_notification(text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_designpro_wrapbox_notification(
  uuid, uuid, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_designpro_wrapbox_notification(
  uuid, uuid, text, boolean
) TO service_role;

COMMENT ON TABLE public.designpro_wrapbox_packs IS
  'Immutable customer/operator-readable standalone WrapBox pack identity; URLs are signed by the gateway from private storage paths.';
COMMENT ON TABLE designpro_private.wrapbox_notification_outbox IS
  'Private leased email outbox. Recipient identity is frozen in the revision snapshot and confirmed against auth.users.';
COMMENT ON TABLE designpro_private.wrapbox_delivery_recipients IS
  'Append-only verified binding between a business customer UUID and a confirmed Supabase Auth account; never browser writable.';
COMMENT ON TABLE designpro_private.business_customer_bindings IS
  'Append-only private map from a confirmed normalized Auth email and stable human customer reference to one server-generated business customer UUID.';
