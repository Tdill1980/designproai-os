-- Call 12: Topaz enhancement inside the fenced production chain.
--
-- Order matters. Call 12 sits between PanelPro preflight approval and
-- output.build, so the production PNG/TIFF/EPS are rendered FROM the enhanced
-- masters. Running it after output.build would enhance files that had already
-- been interpolated up to print size, which recovers nothing.
--
--   source.verify
--   await_panelpro_preflight_qc
--   enhance.upscale            <- Call 12, new
--   output.build
--   output.verify
--   await_final_human_qc
--   stamp.build
--   zip.build
--   wrapbox.deliver
--
-- Topaz output is not reproducible, so an enhanced panel is an authored winner:
-- written once, content-addressed, and bound by hash into every downstream
-- receipt. The chain cannot reproduce the enhance, but it can prove the ZIP
-- carries exactly the bytes the human approved -- the same treatment Call 8
-- gives its authored design.

ALTER TABLE public.designpro_workflow_stages
  DROP CONSTRAINT IF EXISTS designpro_workflow_stages_stage_key_check;
ALTER TABLE public.designpro_workflow_stages
  ADD CONSTRAINT designpro_workflow_stages_stage_key_check CHECK (stage_key IN (
    'revision.freeze','manifest.resolve','proof.build','panels.build','logos.extract','pack.verify','pack.activate',
    'source.verify','await_panelpro_preflight_qc','enhance.upscale','output.build','output.verify','await_final_human_qc',
    'stamp.build','zip.build','wrapbox.deliver'
  ));

ALTER TABLE public.designpro_stage_receipts
  DROP CONSTRAINT IF EXISTS designpro_stage_receipts_receipt_kind_check;
ALTER TABLE public.designpro_stage_receipts
  ADD CONSTRAINT designpro_stage_receipts_receipt_kind_check CHECK (receipt_kind IN (
    'views.seven-source','call8.flat-proof','call9.surface-panels','call10.logo-inventory','panelpro.preflight',
    'call12.topaz-upscale','output.verified','final.human-qc','stamp','zip','wrapbox.delivery'
  ));

ALTER TABLE public.designpro_artifacts
  DROP CONSTRAINT IF EXISTS designpro_artifacts_artifact_kind_check;
ALTER TABLE public.designpro_artifacts
  ADD CONSTRAINT designpro_artifacts_artifact_kind_check CHECK (artifact_kind IN (
    'flat-proof','panel','upscaled-panel','logo','output','stamp','zip','wrapbox-manifest'
  ));

-- Reseed the production stage list. Body is the exact function from
-- 20260806180400 with 'enhance.upscale' added to the stage array; nothing else
-- in it changes.
CREATE OR REPLACE FUNCTION public.create_designpro_production_workflow(
  p_entice_run_id uuid,p_idempotency_key text,p_input jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_entice public.designpro_workflow_runs%ROWTYPE; v_run public.designpro_workflow_runs%ROWTYPE; v_stage text; v_seq int:=0;
BEGIN
  SELECT * INTO v_entice FROM public.designpro_workflow_runs WHERE id=p_entice_run_id AND workflow_type='designpro.entice_pack'
    AND status='completed' AND dimension_manifest_id IS NOT NULL AND manifest_hash IS NOT NULL AND source_contract_hash IS NOT NULL AND artifact_set_hash IS NOT NULL FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.designpro_workflow_stages WHERE run_id=p_entice_run_id AND stage_key='pack.activate' AND status='completed')
    OR jsonb_typeof(v_entice.results->'dimensionManifest') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'active_completed_entice_workflow_required'; END IF;
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM v_entice.owner_id THEN RAISE EXCEPTION 'workflow_owner_required'; END IF;
  INSERT INTO public.designpro_workflow_runs(workflow_type,owner_id,tenant_key,idempotency_key,revision_id,revision_snapshot_hash,entice_pack_id,dimension_manifest_id,source_contract_hash,manifest_hash,artifact_set_hash,input,results)
  VALUES('designpro.production_pack',v_entice.owner_id,v_entice.tenant_key,p_idempotency_key,v_entice.revision_id,v_entice.revision_snapshot_hash,v_entice.entice_pack_id,v_entice.dimension_manifest_id,v_entice.source_contract_hash,v_entice.manifest_hash,v_entice.artifact_set_hash,
    COALESCE(p_input,'{}')||jsonb_build_object('sourceEnticeRunId',v_entice.id,'dimensionManifest',v_entice.results->'dimensionManifest'),jsonb_build_object('sourceEnticeRunId',v_entice.id))
  ON CONFLICT(tenant_key,workflow_type,idempotency_key) DO NOTHING;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE tenant_key=v_entice.tenant_key AND workflow_type='designpro.production_pack' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_run.results->>'sourceEnticeRunId' IS DISTINCT FROM v_entice.id::text OR v_run.artifact_set_hash IS DISTINCT FROM v_entice.artifact_set_hash THEN RAISE EXCEPTION 'production_idempotency_identity_conflict'; END IF;
  FOREACH v_stage IN ARRAY ARRAY['source.verify','await_panelpro_preflight_qc','enhance.upscale','output.build','output.verify','await_final_human_qc','stamp.build','zip.build','wrapbox.deliver'] LOOP
    INSERT INTO public.designpro_workflow_stages(run_id,stage_key,sequence,idempotency_key,input) VALUES(v_run.id,v_stage,v_seq,v_run.id::text||':'||v_stage,jsonb_build_object('sourceEnticeRunId',v_entice.id)) ON CONFLICT(run_id,stage_key) DO NOTHING; v_seq:=v_seq+10;
  END LOOP;
  RETURN jsonb_build_object('workflowRunId',v_run.id,'sourceEnticeRunId',v_entice.id,'status',v_run.status);
END $fn$;

-- The generic builder public.create_designpro_workflow is NOT reseeded here.
-- 20260806180400 line 3 deliberately DROPs it: it was replaced by the two
-- specific builders and nothing calls it. Recreating it would resurrect a
-- deleted SECURITY DEFINER function carrying PostgreSQL's default EXECUTE to
-- PUBLIC. A stale copy from an earlier revision of this branch is removed.
DROP FUNCTION IF EXISTS public.create_designpro_workflow(text,uuid,text,text,uuid,uuid,uuid,text,text,text,jsonb);
DROP FUNCTION IF EXISTS public.create_designpro_workflow_run(text,uuid,text,text,uuid,uuid,uuid,text,text,text,jsonb);

-- Retrofit runs that have not built outputs yet. Stage sequences step by 10, so
-- the new stage lands at output.build's sequence minus 5: ordered correctly
-- with no renumbering, and no collision with UNIQUE (run_id, sequence).
--
-- Runs already past output.build are deliberately left alone. Inserting an
-- enhance into a pack whose outputs are built and approved would invalidate a
-- stamp a human already signed.
INSERT INTO public.designpro_workflow_stages(run_id, stage_key, sequence, idempotency_key, input, status)
SELECT s.run_id, 'enhance.upscale', s.sequence - 5, s.run_id::text || ':enhance.upscale',
       jsonb_build_object('sourceEnticeRunId', r.results->>'sourceEnticeRunId'), 'pending'
FROM public.designpro_workflow_stages s
JOIN public.designpro_workflow_runs r ON r.id = s.run_id
WHERE s.stage_key = 'output.build'
  AND s.status IN ('pending','retryable')
  AND r.workflow_type = 'designpro.production_pack'
ON CONFLICT (run_id, stage_key) DO NOTHING;
