-- DesignProAI production reconciliation: immutable delivery bindings,
-- operator-mediated registration, heavy-work readiness, WrapBox readiness,
-- and the 50 GiB private production-pack boundary.

CREATE OR REPLACE FUNCTION public.register_designpro_operator_wrapbox_recipient(
  p_operator_id uuid,
  p_customer_email text,
  p_customer_reference text,
  p_verification_ref_hash text,
  p_order_number text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE v_binding jsonb;
BEGIN
  IF pg_catalog.coalesce(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_operator_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.designpro_qc_members q
    JOIN auth.users u ON u.id=q.user_id
    WHERE q.user_id=p_operator_id AND q.can_operate
      AND u.email_confirmed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'confirmed_designpro_operator_required'; END IF;

  v_binding := public.register_designpro_wrapbox_recipient(
    p_customer_email,p_customer_reference,p_verification_ref_hash,
    p_order_number,p_operator_id
  );
  IF pg_catalog.jsonb_typeof(v_binding) IS DISTINCT FROM 'object'
    OR NOT v_binding ?& ARRAY[
      'customerId','customerEmail','recipientIdentityHash','orderNumber',
      'emailVerifiedAt'
    ]
    OR v_binding->>'orderNumber' IS DISTINCT FROM p_order_number
  THEN RAISE EXCEPTION 'recipient_binding_response_invalid'; END IF;
  RETURN v_binding;
END
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.verify_revision_delivery_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_delivery jsonb := NEW.snapshot->'delivery';
  v_customer_id uuid;
  v_email text;
  v_identity_hash text;
  v_confirmed_email text;
BEGIN
  IF NEW.snapshot->>'generationId' IS DISTINCT FROM NEW.generation_id::text
    OR NEW.snapshot->>'designId' IS DISTINCT FROM
      'DID-' || pg_catalog.upper(pg_catalog.substr(
        pg_catalog.replace(NEW.generation_id::text,'-',''),1,8
      ))
    OR NEW.snapshot->>'orderNumber' IS DISTINCT FROM
      pg_catalog.btrim(NEW.snapshot->>'orderNumber')
    OR NEW.snapshot->>'orderNumber' !~
      '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
  THEN RAISE EXCEPTION 'immutable_design_id_and_order_number_required'; END IF;

  IF pg_catalog.jsonb_typeof(v_delivery) IS DISTINCT FROM 'object'
    OR (SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_object_keys(v_delivery)) <> 6
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
  v_customer_id := (v_delivery->>'customerId')::uuid;
  v_email := pg_catalog.lower(pg_catalog.btrim(v_delivery->>'customerEmail'));
  v_identity_hash := pg_catalog.lower(
    v_delivery->>'recipientIdentityHash'
  );
  IF v_delivery->>'customerEmail' IS DISTINCT FROM v_email
    OR pg_catalog.length(v_email) NOT BETWEEN 3 AND 320
    OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR v_identity_hash !~ '^[0-9a-f]{64}$'
    OR v_delivery->>'orderNumber' IS DISTINCT FROM NEW.snapshot->>'orderNumber'
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
END
$fn$;

DROP TRIGGER IF EXISTS designpro_05_revision_delivery_binding
  ON public.designpro_revision_sources;
CREATE TRIGGER designpro_05_revision_delivery_binding
BEFORE INSERT ON public.designpro_revision_sources
FOR EACH ROW EXECUTE FUNCTION
  designpro_private.verify_revision_delivery_binding();

CREATE OR REPLACE FUNCTION public.designpro_schema_readiness()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_schema_ok boolean;
  v_storage_ok boolean;
  v_policy_ok boolean;
  v_operator_ok boolean;
  v_security_ok boolean;
  v_heavy_lease_ok boolean;
  v_validated_count bigint;
  v_pending_count bigint;
  v_missing text[] := ARRAY[]::text[];
BEGIN
  IF pg_catalog.coalesce(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
    AND session_user NOT IN ('postgres','supabase_admin')
  THEN RAISE EXCEPTION 'service_role_or_database_owner_required'; END IF;

  v_schema_ok :=
    pg_catalog.to_regclass('public.designpro_revision_sources') IS NOT NULL
    AND pg_catalog.to_regclass('public.designpro_workflow_runs') IS NOT NULL
    AND pg_catalog.to_regclass('public.designpro_workflow_stages') IS NOT NULL
    AND pg_catalog.to_regclass('public.designpro_stage_receipts') IS NOT NULL
    AND pg_catalog.to_regclass('public.designpro_artifacts') IS NOT NULL
    AND pg_catalog.to_regclass('public.designpro_qc_members') IS NOT NULL
    AND pg_catalog.to_regclass('public.designpro_vehicle_specs_universal') IS NOT NULL
    AND pg_catalog.to_regclass('public.designpro_universal_dimension_requests') IS NOT NULL
    AND pg_catalog.to_regclass('public.designpro_universal_grounded_identity_uidx') IS NOT NULL
    AND pg_catalog.to_regclass('designpro_private.heavy_stage_leases') IS NOT NULL
    AND pg_catalog.to_regclass('designpro_private.business_customer_bindings') IS NOT NULL
    AND pg_catalog.to_regclass('designpro_private.wrapbox_delivery_recipients') IS NOT NULL
    AND pg_catalog.to_regclass('designpro_private.wrapbox_notification_outbox') IS NOT NULL
    AND pg_catalog.to_regclass('public.designpro_wrapbox_packs') IS NOT NULL
    AND EXISTS(
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid='public.designpro_wrapbox_packs'::pg_catalog.regclass
        AND a.attname='design_id' AND NOT a.attisdropped
    )
    AND EXISTS(
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid='public.designpro_wrapbox_packs'::pg_catalog.regclass
        AND a.attname='order_number' AND NOT a.attisdropped
    )
    AND pg_catalog.to_regprocedure('public.save_designpro_revision_source(uuid,uuid,uuid,timestamp with time zone,jsonb,text,text)') IS NOT NULL
    AND pg_catalog.to_regprocedure('public.acquire_designpro_heavy_lease(uuid,uuid,text,integer)') IS NOT NULL
    AND pg_catalog.to_regprocedure('public.release_designpro_heavy_lease(uuid,uuid)') IS NOT NULL
    AND pg_catalog.to_regprocedure('public.register_designpro_operator_wrapbox_recipient(uuid,text,text,text,text)') IS NOT NULL
    AND pg_catalog.to_regprocedure('public.commit_designpro_wrapbox_pack(uuid,text,bigint,text,bigint,jsonb)') IS NOT NULL
    AND pg_catalog.to_regprocedure('public.request_designpro_universal_dimension_validation(uuid,uuid,uuid,uuid)') IS NOT NULL
    AND pg_catalog.to_regprocedure('public.validate_designpro_vehicle_spec_universal(uuid,jsonb,text,jsonb)') IS NOT NULL;

  SELECT pg_catalog.coalesce(bool_and(
    NOT b.public AND b.file_size_limit=53687091200
  ),false) INTO v_storage_ok
  FROM storage.buckets b WHERE b.id='wrap-files' AND b.name='wrap-files';

  SELECT pg_catalog.count(*)=3 INTO v_policy_ok
  FROM pg_catalog.pg_policies
  WHERE schemaname='storage' AND tablename='objects'
    AND policyname IN (
      'designpro_owner_read_wrap_files',
      'designpro_owner_insert_revision_inputs',
      'designpro_customer_read_wrapbox_delivery'
    );

  SELECT pg_catalog.count(*)=1
    AND pg_catalog.bool_and(lease_key='production-heavy')
  INTO v_heavy_lease_ok
  FROM designpro_private.heavy_stage_leases;

  SELECT EXISTS(
    SELECT 1 FROM public.designpro_qc_members
    WHERE can_operate AND can_preflight AND can_final_qc
  ) INTO v_operator_ok;
  SELECT pg_catalog.count(*) FILTER (WHERE NOT requires_validation),
         pg_catalog.count(*) FILTER (WHERE requires_validation)
  INTO v_validated_count,v_pending_count
  FROM public.designpro_vehicle_specs_universal;

  SELECT NOT EXISTS(
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      pg_catalog.coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
    ) privilege
    WHERE p.prosecdef
      AND (n.nspname='designpro_private'
        OR (n.nspname='public' AND p.proname LIKE '%designpro%'))
      AND privilege.privilege_type='EXECUTE'
      AND (privilege.grantee=0 OR privilege.grantee=pg_catalog.coalesce(
        (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='anon'),0
      ))
  ) INTO v_security_ok;

  IF NOT v_schema_ok THEN v_missing:=pg_catalog.array_append(v_missing,'schema_or_rpc'); END IF;
  IF NOT v_storage_ok THEN v_missing:=pg_catalog.array_append(v_missing,'private_wrap_files_50gib_bucket'); END IF;
  IF NOT v_policy_ok THEN v_missing:=pg_catalog.array_append(v_missing,'exact_storage_policies'); END IF;
  IF NOT v_heavy_lease_ok THEN v_missing:=pg_catalog.array_append(v_missing,'output_build_singleton_lease'); END IF;
  IF NOT v_security_ok THEN v_missing:=pg_catalog.array_append(v_missing,'function_privilege_boundary'); END IF;
  IF NOT v_operator_ok THEN v_missing:=pg_catalog.array_append(v_missing,'confirmed_qc_operator'); END IF;
  IF v_validated_count=0 THEN v_missing:=pg_catalog.array_append(v_missing,'validated_genie_geometry'); END IF;

  RETURN pg_catalog.jsonb_build_object(
    'contractVersion','designpro.schema-readiness.v2',
    'ready',v_schema_ok AND v_storage_ok AND v_policy_ok
      AND v_heavy_lease_ok AND v_security_ok,
    'infrastructureReady',v_schema_ok AND v_storage_ok AND v_policy_ok
      AND v_heavy_lease_ok AND v_security_ok,
    'canaryReady',v_schema_ok AND v_storage_ok AND v_policy_ok
      AND v_heavy_lease_ok AND v_security_ok AND v_operator_ok
      AND v_validated_count>0,
    'schemaReady',v_schema_ok,
    'storageReady',v_storage_ok AND v_policy_ok,
    'securityReady',v_security_ok,
    'heavyOutputLeaseReady',v_heavy_lease_ok,
    'operatorReady',v_operator_ok,
    'validatedSpecCount',v_validated_count,
    'pendingCandidateCount',v_pending_count,
    'storageLimits',pg_catalog.jsonb_build_object(
      'bucketFileSizeLimitBytes',53687091200,
      'requiredProjectGlobalFileSizeLimitBytes',53687091200,
      'globalLimitVerification','dashboard_required_before_canary',
      'largePackUpload','tus-or-s3-multipart-required'
    ),
    'missing',pg_catalog.to_jsonb(v_missing),
    'externalChecks',pg_catalog.jsonb_build_array(
      'project_global_storage_limit_gte_50gib'
    ),
    'checkedAt',pg_catalog.clock_timestamp()
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.designpro_runtime_readiness()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_missing jsonb;
  v_rpc_count integer;
  v_dimension_seed_count integer;
  v_qc_seed_count integer;
  v_grounded_identity_fence boolean;
  v_heavy_lease_fence boolean;
  v_wrapbox_fence boolean;
BEGIN
  IF pg_catalog.coalesce(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;

  WITH required(signature) AS (VALUES
    ('public.claim_designpro_stage(text,integer)'),
    ('public.heartbeat_designpro_stage(uuid,uuid,integer)'),
    ('public.acquire_designpro_heavy_lease(uuid,uuid,text,integer)'),
    ('public.release_designpro_heavy_lease(uuid,uuid)'),
    ('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'),
    ('public.fail_designpro_stage(uuid,uuid,text,text,boolean)'),
    ('public.request_designpro_human_gate(uuid,text,jsonb)'),
    ('public.reconcile_designpro_automatic_production()'),
    ('public.request_designpro_universal_dimension_validation(uuid,uuid,uuid,uuid)'),
    ('public.validate_designpro_vehicle_spec_universal(uuid,jsonb,text,jsonb)'),
    ('public.bind_designpro_entice_manifest(uuid,uuid,uuid,uuid,jsonb,text,text)'),
    ('public.finalize_designpro_entice_identity(uuid,uuid,uuid,text,text,jsonb)'),
    ('public.register_designpro_operator_wrapbox_recipient(uuid,text,text,text,text)'),
    ('public.commit_designpro_wrapbox_pack(uuid,text,bigint,text,bigint,jsonb)'),
    ('public.claim_designpro_wrapbox_notification(text,integer)'),
    ('public.complete_designpro_wrapbox_notification(uuid,uuid,text)'),
    ('public.fail_designpro_wrapbox_notification(uuid,uuid,text,boolean)')
  )
  SELECT pg_catalog.coalesce(
      pg_catalog.jsonb_agg(signature ORDER BY signature)
        FILTER (WHERE pg_catalog.to_regprocedure(signature) IS NULL),
      '[]'::jsonb
    ),
    pg_catalog.count(*) FILTER (
      WHERE pg_catalog.to_regprocedure(signature) IS NOT NULL
    )
  INTO v_missing,v_rpc_count FROM required;

  SELECT pg_catalog.count(*) INTO v_dimension_seed_count
  FROM public.designpro_vehicle_specs_universal
  WHERE NOT requires_validation AND validated_by IS NOT NULL
    AND validated_at IS NOT NULL;
  SELECT pg_catalog.count(*) INTO v_qc_seed_count
  FROM public.designpro_qc_members
  WHERE can_operate AND can_preflight AND can_final_qc;
  v_grounded_identity_fence :=
    pg_catalog.to_regclass('public.designpro_universal_grounded_identity_uidx') IS NOT NULL;
  SELECT pg_catalog.count(*)=1 INTO v_heavy_lease_fence
  FROM designpro_private.heavy_stage_leases
  WHERE lease_key='production-heavy';
  v_wrapbox_fence :=
    pg_catalog.to_regclass('public.designpro_wrapbox_packs') IS NOT NULL
    AND pg_catalog.to_regclass('designpro_private.business_customer_bindings') IS NOT NULL
    AND pg_catalog.to_regclass('designpro_private.wrapbox_delivery_recipients') IS NOT NULL
    AND pg_catalog.to_regclass('designpro_private.wrapbox_notification_outbox') IS NOT NULL;

  RETURN pg_catalog.jsonb_build_object(
    'contract','designpro.runtime-readiness.v2',
    'ready',pg_catalog.jsonb_array_length(v_missing)=0
      AND v_grounded_identity_fence AND v_heavy_lease_fence AND v_wrapbox_fence,
    'missingRpcs',v_missing,
    'rpcCount',v_rpc_count,
    'dimensionSeedCount',v_dimension_seed_count,
    'qcSeedCount',v_qc_seed_count,
    'groundedIdentityFence',v_grounded_identity_fence,
    'heavyOutputLeaseFence',v_heavy_lease_fence,
    'wrapboxFence',v_wrapbox_fence,
    'capabilities',pg_catalog.jsonb_build_object(
      'validatedGeometrySeeded',v_dimension_seed_count>0,
      'qcOperatorSeeded',v_qc_seed_count>0,
      'private50GiBBucketRequired',true,
      'largePackUpload','tus-or-s3-multipart'
    )
  );
END
$fn$;

-- PostgreSQL gives every newly created function EXECUTE to PUBLIC.  Clear the
-- implicit privilege before granting only the two service entrypoints.
REVOKE ALL ON FUNCTION public.register_designpro_operator_wrapbox_recipient(
  uuid,text,text,text,text
) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION designpro_private.verify_revision_delivery_binding()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.designpro_schema_readiness()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.designpro_runtime_readiness()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.acquire_designpro_heavy_lease(
  uuid,uuid,text,integer
) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.release_designpro_heavy_lease(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.register_designpro_operator_wrapbox_recipient(
  uuid,text,text,text,text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.designpro_schema_readiness() TO service_role;
GRANT EXECUTE ON FUNCTION public.designpro_runtime_readiness() TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_designpro_heavy_lease(
  uuid,uuid,text,integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_designpro_heavy_lease(uuid,uuid)
  TO service_role;

COMMENT ON FUNCTION public.register_designpro_operator_wrapbox_recipient(
  uuid,text,text,text,text
) IS 'Docker-internal runtime only: verifies an operator, resolves one confirmed normalized customer email, creates or reuses its private stable business UUID, and appends an immutable hashed-reference plus Order # recipient binding.';
