-- Final production boundary: make every callable role explicit, lock every
-- SECURITY DEFINER search path, and expose a service-only fail-closed probe.

REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
REVOKE ALL ON SCHEMA extensions FROM PUBLIC, anon, authenticated;

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
  v_validated_count bigint;
  v_pending_count bigint;
  v_missing text[] := ARRAY[]::text[];
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
    AND session_user NOT IN ('postgres','supabase_admin')
  THEN
    RAISE EXCEPTION 'service_role_or_database_owner_required';
  END IF;

  v_schema_ok :=
    to_regclass('public.designpro_revision_sources') IS NOT NULL
    AND to_regclass('public.designpro_workflow_runs') IS NOT NULL
    AND to_regclass('public.designpro_workflow_stages') IS NOT NULL
    AND to_regclass('public.designpro_stage_receipts') IS NOT NULL
    AND to_regclass('public.designpro_artifacts') IS NOT NULL
    AND to_regclass('public.designpro_qc_members') IS NOT NULL
    AND to_regclass('public.designpro_vehicle_specs_universal') IS NOT NULL
    AND to_regclass('public.designpro_universal_dimension_requests') IS NOT NULL
    AND to_regclass('public.designpro_universal_grounded_identity_uidx') IS NOT NULL
    AND to_regprocedure('public.save_designpro_revision_source(uuid,uuid,uuid,timestamp with time zone,jsonb,text,text)') IS NOT NULL
    AND to_regprocedure('public.request_designpro_universal_dimension_validation(uuid,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.validate_designpro_vehicle_spec_universal(uuid,jsonb,text,jsonb)') IS NOT NULL
    AND to_regprocedure('public.list_pending_designpro_vehicle_specs_universal()') IS NOT NULL;

  SELECT EXISTS(
    SELECT 1 FROM storage.buckets
    WHERE id = 'wrap-files' AND name = 'wrap-files' AND public IS false
      AND file_size_limit = 50000000000
  ) INTO v_storage_ok;

  SELECT count(*) = 2
  INTO v_policy_ok
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN (
      'designpro_owner_read_wrap_files',
      'designpro_owner_insert_revision_inputs'
    );

  SELECT EXISTS(
    SELECT 1 FROM public.designpro_qc_members
    WHERE can_operate AND can_preflight AND can_final_qc
  ) INTO v_operator_ok;

  SELECT count(*) FILTER (WHERE NOT requires_validation),
         count(*) FILTER (WHERE requires_validation)
  INTO v_validated_count,v_pending_count
  FROM public.designpro_vehicle_specs_universal;

  SELECT NOT EXISTS(
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl,acldefault('f',p.proowner))
    ) privilege
    WHERE p.prosecdef
      AND (
        n.nspname = 'designpro_private'
        OR (n.nspname = 'public' AND p.proname LIKE '%designpro%')
      )
      AND privilege.privilege_type = 'EXECUTE'
      AND (
        privilege.grantee = 0
        OR privilege.grantee = COALESCE(
          (SELECT oid FROM pg_roles WHERE rolname = 'anon'),0
        )
      )
  ) INTO v_security_ok;

  IF NOT v_schema_ok THEN v_missing := array_append(v_missing,'schema_or_rpc'); END IF;
  IF NOT v_storage_ok THEN v_missing := array_append(v_missing,'private_wrap_files_bucket'); END IF;
  IF NOT v_policy_ok THEN v_missing := array_append(v_missing,'storage_owner_policies'); END IF;
  IF NOT v_security_ok THEN v_missing := array_append(v_missing,'function_privilege_boundary'); END IF;
  IF NOT v_operator_ok THEN v_missing := array_append(v_missing,'confirmed_qc_operator'); END IF;
  IF v_validated_count = 0 THEN v_missing := array_append(v_missing,'validated_genie_geometry'); END IF;

  RETURN jsonb_build_object(
    'contractVersion','designpro.schema-readiness.v1',
    'ready',v_schema_ok AND v_storage_ok AND v_policy_ok AND v_security_ok,
    'infrastructureReady',v_schema_ok AND v_storage_ok AND v_policy_ok
      AND v_security_ok,
    'canaryReady',v_schema_ok AND v_storage_ok AND v_policy_ok
      AND v_security_ok AND v_operator_ok AND v_validated_count > 0,
    'schemaReady',v_schema_ok,
    'storageReady',v_storage_ok AND v_policy_ok,
    'securityReady',v_security_ok,
    'operatorReady',v_operator_ok,
    'validatedSpecCount',v_validated_count,
    'pendingCandidateCount',v_pending_count,
    'missing',to_jsonb(v_missing),
    'checkedAt',clock_timestamp()
  );
END
$fn$;

-- PostgreSQL grants function EXECUTE to PUBLIC by default. Clear the implicit
-- privilege on the entire standalone DesignPro function surface first.
DO $hardening$
DECLARE
  v_function record;
  v_signature text;
BEGIN
  FOR v_function IN
    SELECT n.nspname,p.proname,p.oid,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments,
      p.prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'designpro_private'
      OR (n.nspname = 'public' AND p.proname LIKE '%designpro%')
  LOOP
    v_signature := format('%I.%I(%s)',v_function.nspname,v_function.proname,
      v_function.identity_arguments);
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      v_signature
    );
    IF v_function.prosecdef THEN
      EXECUTE format(
        'ALTER FUNCTION %s SET search_path TO pg_catalog, public, extensions',
        v_signature
      );
    END IF;
  END LOOP;
END
$hardening$;

-- Server-only workflow and administrative entrypoints.
GRANT EXECUTE ON FUNCTION public.designpro_sync_run_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_designpro_stage(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_designpro_stage(uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_designpro_heavy_lease(uuid,uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_designpro_heavy_lease(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_designpro_stage(uuid,uuid,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_designpro_human_gate(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bind_designpro_entice_manifest(uuid,uuid,uuid,uuid,jsonb,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_designpro_entice_identity(uuid,uuid,uuid,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_designpro_universal_dimension_validation(uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.designpro_schema_readiness() TO service_role;
GRANT EXECUTE ON FUNCTION designpro_private.bootstrap_operator_by_email(text,boolean,boolean,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION designpro_private.import_genie_candidate_catalog(jsonb,text) TO service_role;

-- Authenticated browser/control-plane entrypoints. Every function derives or
-- checks auth.uid(); none accepts an unauthenticated caller.
GRANT EXECUTE ON FUNCTION public.save_designpro_revision_source(uuid,uuid,uuid,timestamptz,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_designpro_entice_workflow(uuid,text,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_designpro_production_workflow(uuid,text,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resume_designpro_workflow(uuid,uuid,boolean) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.verify_designpro_delivery_chain(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.validate_designpro_vehicle_spec_universal(uuid,jsonb,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_designpro_vehicle_specs_universal() TO authenticated;
