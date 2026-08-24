-- GENIE DEPLOYS ONLY WHEN THE PRODUCTION PACK IS ORDERED.
--
-- manifest.resolve sat second in the FREE entice run, so every run parked on
-- genie_dimension_validation_required before the 2D proof or a single panel
-- existed. One sat there sixteen hours on 2026-08-23; that, not a code bug, is
-- why RevisionStudio had no extracted panels to show and why the customer saw a
-- job that looked busy and produced nothing.
--
-- The free half does not need validated production geometry. Call 1 resolves
-- the design-time size of every side and cuts the six panels to it, with the
-- five-inch bleed already in the layout -- that is what RevisionStudio entices
-- with and what PanelPro Studio is later served. GENIE resolves the TRUE
-- production dimensions and drives the progress page, and that is paid work, so
-- it belongs behind the purchase gate with the rest of the paid work.
--
-- Two consequences this migration has to handle together:
--
--  1. The entice run no longer schedules manifest.resolve, so it can no longer
--     finish holding a dimension manifest. create_designpro_production_workflow
--     required exactly that before it would create the paid run, which would
--     have made the pack unorderable. The precondition drops to what the entice
--     run actually proves on its own -- a completed pack.activate and its
--     immutable source/artifact identity -- and the manifest columns are left
--     for the production run to fill when GENIE resolves.
--
--  2. The production run schedules manifest.resolve immediately after
--     await_purchase, before source.verify, because every stage below it is cut
--     and verified against the dimensions it produces.
--
-- The runner already understands the new position; it shipped first.

-- The entice run: no GENIE.
CREATE OR REPLACE FUNCTION public.create_designpro_entice_workflow(
  p_revision_id uuid, p_idempotency_key text, p_input jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_source public.designpro_revision_sources%ROWTYPE; v_run public.designpro_workflow_runs%ROWTYPE; v_stage text; v_seq int:=0; v_pack_id uuid:=extensions.gen_random_uuid();
BEGIN
  SELECT * INTO v_source FROM public.designpro_revision_sources WHERE revision_id=p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'immutable_revision_source_required'; END IF;
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM v_source.owner_id THEN RAISE EXCEPTION 'workflow_owner_required'; END IF;
  INSERT INTO public.designpro_workflow_runs(workflow_type,owner_id,tenant_key,idempotency_key,revision_id,revision_snapshot_hash,entice_pack_id,input,results)
  VALUES('designpro.entice_pack',v_source.owner_id,v_source.tenant_key,p_idempotency_key,v_source.revision_id,v_source.snapshot_hash,v_pack_id,
    COALESCE(p_input,'{}')||jsonb_build_object('revisionSourceId',v_source.revision_id),jsonb_build_object('generationId',v_source.generation_id,'visualizationId',v_source.visualization_id))
  ON CONFLICT(tenant_key,workflow_type,idempotency_key) DO NOTHING;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE tenant_key=v_source.tenant_key AND workflow_type='designpro.entice_pack' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_run.revision_id IS DISTINCT FROM v_source.revision_id OR v_run.revision_snapshot_hash IS DISTINCT FROM v_source.snapshot_hash THEN RAISE EXCEPTION 'entice_idempotency_identity_conflict'; END IF;
  FOREACH v_stage IN ARRAY ARRAY['revision.freeze','proof.build','panels.build','logos.extract','panels.delogo','pack.verify','pack.activate'] LOOP
    INSERT INTO public.designpro_workflow_stages(run_id,stage_key,sequence,idempotency_key,input) VALUES(v_run.id,v_stage,v_seq,v_run.id::text||':'||v_stage,jsonb_build_object('revisionId',v_source.revision_id,'enticePackId',v_run.entice_pack_id)) ON CONFLICT(run_id,stage_key) DO NOTHING; v_seq:=v_seq+10;
  END LOOP;
  RETURN jsonb_build_object('workflowRunId',v_run.id,'revisionId',v_run.revision_id,'enticePackId',v_run.entice_pack_id,'status',v_run.status);
END $fn$;

REVOKE ALL ON FUNCTION public.create_designpro_entice_workflow(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_designpro_entice_workflow(uuid,text,jsonb) TO authenticated,service_role;

-- The production run: GENIE first, immediately behind the purchase gate.
CREATE OR REPLACE FUNCTION public.create_designpro_production_workflow(
  p_entice_run_id uuid, p_idempotency_key text, p_input jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_entice public.designpro_workflow_runs%ROWTYPE; v_run public.designpro_workflow_runs%ROWTYPE; v_stage text; v_seq int:=0;
BEGIN
  -- The entice run no longer resolves GENIE, so a dimension manifest is no
  -- longer something it can prove. What it still proves is its own immutable
  -- identity and a sealed pack, and that is what is required here.
  SELECT * INTO v_entice FROM public.designpro_workflow_runs WHERE id=p_entice_run_id AND workflow_type='designpro.entice_pack'
    AND status='completed' AND source_contract_hash IS NOT NULL AND artifact_set_hash IS NOT NULL FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.designpro_workflow_stages WHERE run_id=p_entice_run_id AND stage_key='pack.activate' AND status='completed')
  THEN RAISE EXCEPTION 'active_completed_entice_workflow_required'; END IF;
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM v_entice.owner_id THEN RAISE EXCEPTION 'workflow_owner_required'; END IF;
  INSERT INTO public.designpro_workflow_runs(workflow_type,owner_id,tenant_key,idempotency_key,revision_id,revision_snapshot_hash,entice_pack_id,dimension_manifest_id,source_contract_hash,manifest_hash,artifact_set_hash,input,results)
  VALUES('designpro.production_pack',v_entice.owner_id,v_entice.tenant_key,p_idempotency_key,v_entice.revision_id,v_entice.revision_snapshot_hash,v_entice.entice_pack_id,v_entice.dimension_manifest_id,v_entice.source_contract_hash,v_entice.manifest_hash,v_entice.artifact_set_hash,
    COALESCE(p_input,'{}')||jsonb_build_object('sourceEnticeRunId',v_entice.id),jsonb_build_object('sourceEnticeRunId',v_entice.id))
  ON CONFLICT(tenant_key,workflow_type,idempotency_key) DO NOTHING;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE tenant_key=v_entice.tenant_key AND workflow_type='designpro.production_pack' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_run.results->>'sourceEnticeRunId' IS DISTINCT FROM v_entice.id::text OR v_run.artifact_set_hash IS DISTINCT FROM v_entice.artifact_set_hash THEN RAISE EXCEPTION 'production_idempotency_identity_conflict'; END IF;
  -- await_purchase leads, then GENIE. Every stage below manifest.resolve is cut
  -- and verified against the production dimensions it produces.
  FOREACH v_stage IN ARRAY ARRAY['await_purchase','manifest.resolve','source.verify','await_panelpro_preflight_qc','enhance.upscale','output.build','output.verify','await_final_human_qc','stamp.build','zip.build','wrapbox.deliver'] LOOP
    INSERT INTO public.designpro_workflow_stages(run_id,stage_key,sequence,idempotency_key,input) VALUES(v_run.id,v_stage,v_seq,v_run.id::text||':'||v_stage,jsonb_build_object('sourceEnticeRunId',v_entice.id)) ON CONFLICT(run_id,stage_key) DO NOTHING; v_seq:=v_seq+10;
  END LOOP;
  RETURN jsonb_build_object('workflowRunId',v_run.id,'sourceEnticeRunId',v_entice.id,'status',v_run.status);
END $fn$;

REVOKE ALL ON FUNCTION public.create_designpro_production_workflow(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_designpro_production_workflow(uuid,text,jsonb) TO authenticated,service_role;
