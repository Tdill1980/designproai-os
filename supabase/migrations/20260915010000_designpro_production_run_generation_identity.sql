-- THE PRODUCTION RUN STATES WHICH GENERATION IT MANUFACTURES.
--
-- create_designpro_production_workflow seeded the paid run's results with
-- sourceEnticeRunId only. Every reader that resolves "the job" by generation id
-- (the gateway's requestedRun, publicState.generationId, the PanelPro board,
-- Production Layers, the human-gate approvals) therefore matched the entice run
-- and never the production run: 24 of 24 production runs in production carry
-- no generationId (measured 2026-09-15). The F250 pack 9dcf312d delivered six
-- upscaled masters, eighteen outputs, a ZIP and a WrapBox manifest that
-- PanelPro Studio could not list, and its gates answered production_job_required.
--
-- 1. The creator RPC copies generationId from the source entice run's results
--    at insert time, patched in place at its unique anchor.
-- 2. Every existing production run inherits it from its source entice run.
--    results is not an identity column (guard_designpro_run_identity_immutable
--    does not fence it), and sourceEnticeRunId is left exactly as it was.

DO $migration$
DECLARE
  v_definition text;
  v_anchor text;
  v_patched text;
BEGIN
  v_definition:=pg_get_functiondef(to_regprocedure('public.create_designpro_production_workflow(uuid,text,jsonb)'));
  IF v_definition IS NULL THEN RAISE EXCEPTION 'production_workflow_creator_missing'; END IF;
  IF strpos(v_definition,'''generationId'',v_entice.results->>''generationId''')>0 THEN
    RAISE NOTICE 'create_designpro_production_workflow already seeds generationId';
    RETURN;
  END IF;
  v_anchor:=E',jsonb_build_object(''sourceEnticeRunId'',v_entice.id))\n  ON CONFLICT(tenant_key,workflow_type,idempotency_key) DO NOTHING;';
  IF (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) IS DISTINCT FROM 1
  THEN RAISE EXCEPTION 'production_workflow_creator_anchor_not_unique'; END IF;
  v_patched:=replace(v_definition,v_anchor,
    E',jsonb_build_object(''sourceEnticeRunId'',v_entice.id,''generationId'',v_entice.results->>''generationId''))\n  ON CONFLICT(tenant_key,workflow_type,idempotency_key) DO NOTHING;');
  EXECUTE v_patched;
END
$migration$;

GRANT EXECUTE ON FUNCTION public.create_designpro_production_workflow(uuid,text,jsonb) TO authenticated,service_role;

UPDATE public.designpro_workflow_runs p
SET results=COALESCE(p.results,'{}'::jsonb)||jsonb_build_object('generationId',e.results->>'generationId'),
    updated_at=clock_timestamp()
FROM public.designpro_workflow_runs e
WHERE p.workflow_type='designpro.production_pack'
  AND e.workflow_type='designpro.entice_pack'
  AND e.id::text=p.results->>'sourceEnticeRunId'
  AND NULLIF(p.results->>'generationId','') IS NULL
  AND NULLIF(e.results->>'generationId','') IS NOT NULL;
