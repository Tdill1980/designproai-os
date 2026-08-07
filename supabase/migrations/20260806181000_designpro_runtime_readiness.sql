-- Runtime bootstrap must not deadlock on the very first unknown vehicle. RPCs
-- and the grounded-identity race fence are required to start; validated
-- geometry and a QC operator are reported as capabilities so the first job can
-- enter the durable GENIE waiting state and be approved through PanelPro.

CREATE OR REPLACE FUNCTION public.reconcile_designpro_automatic_production()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_entice record;
  v_count integer := 0;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  FOR v_entice IN
    SELECT e.id
    FROM public.designpro_workflow_runs e
    WHERE e.workflow_type = 'designpro.entice_pack'
      AND e.status = 'completed'
      AND EXISTS(
        SELECT 1 FROM public.designpro_workflow_stages s
        WHERE s.run_id=e.id AND s.stage_key='pack.activate'
          AND s.status='completed'
      )
      AND NOT EXISTS(
        SELECT 1 FROM public.designpro_workflow_runs p
        WHERE p.workflow_type='designpro.production_pack'
          AND p.results->>'sourceEnticeRunId'=e.id::text
      )
    ORDER BY e.created_at,e.id
  LOOP
    IF pg_try_advisory_xact_lock(
      hashtextextended('designpro.auto-production:'||v_entice.id::text,0)
    ) THEN
      PERFORM public.create_designpro_production_workflow(
        v_entice.id,
        'auto-production:'||v_entice.id::text,
        '{"trigger":"designpro.os.auto"}'::jsonb
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('createdOrConfirmed',v_count);
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
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  WITH required(signature) AS (VALUES
    ('public.claim_designpro_stage(text,integer)'),
    ('public.heartbeat_designpro_stage(uuid,uuid,integer)'),
    ('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'),
    ('public.fail_designpro_stage(uuid,uuid,text,text,boolean)'),
    ('public.request_designpro_human_gate(uuid,text,jsonb)'),
    ('public.reconcile_designpro_automatic_production()'),
    ('public.request_designpro_universal_dimension_validation(uuid,uuid,uuid,uuid)'),
    ('public.validate_designpro_vehicle_spec_universal(uuid,jsonb,text,jsonb)'),
    ('public.bind_designpro_entice_manifest(uuid,uuid,uuid,uuid,jsonb,text,text)'),
    ('public.finalize_designpro_entice_identity(uuid,uuid,uuid,text,text,jsonb)')
  )
  SELECT
    COALESCE(
      jsonb_agg(signature ORDER BY signature)
        FILTER (WHERE to_regprocedure(signature) IS NULL),
      '[]'::jsonb
    ),
    count(*) FILTER (WHERE to_regprocedure(signature) IS NOT NULL)
  INTO v_missing,v_rpc_count
  FROM required;

  SELECT count(*) INTO v_dimension_seed_count
  FROM public.designpro_vehicle_dimensions
  WHERE side_width>0 AND side_height>0
    AND hood_width>0 AND hood_length>0
    AND roof_width>0 AND roof_length>0
    AND front_width>0 AND front_height>0
    AND rear_width>0 AND rear_height>0;

  SELECT count(*) INTO v_qc_seed_count
  FROM public.designpro_qc_members
  WHERE can_preflight AND can_final_qc;

  v_grounded_identity_fence :=
    to_regclass('public.designpro_universal_grounded_identity_uidx') IS NOT NULL;

  RETURN jsonb_build_object(
    'contract','designpro.runtime-readiness.v1',
    'ready',jsonb_array_length(v_missing)=0 AND v_grounded_identity_fence,
    'missingRpcs',v_missing,
    'rpcCount',v_rpc_count,
    'dimensionSeedCount',v_dimension_seed_count,
    'qcSeedCount',v_qc_seed_count,
    'groundedIdentityFence',v_grounded_identity_fence,
    'capabilities',jsonb_build_object(
      'validatedGeometrySeeded',v_dimension_seed_count>0,
      'qcOperatorSeeded',v_qc_seed_count>0
    )
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.designpro_runtime_readiness()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reconcile_designpro_automatic_production()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.designpro_runtime_readiness() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_designpro_automatic_production() TO service_role;
