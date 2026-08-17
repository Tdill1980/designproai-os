-- Call 11: the de-logo duplicate set, scheduled.
--
-- The runner already understands panels.delogo (shipped in an earlier PR), so
-- this migration can schedule the stage without opening a window where the
-- database hands the live runner a stage_key it has never heard of.
--
-- Order matters. Call 11 sits between Call 10 and pack.verify, so the six
-- de-logoed duplicates exist before the pack is sealed and handed to the
-- PanelPro preflight gate -- those duplicates are what a human lays on a
-- vehicle template to validate sizing.
--
--   revision.freeze
--   manifest.resolve
--   proof.build          <- Call 8
--   panels.build         <- Call 9, the six branded production panels
--   logos.extract        <- Call 10
--   panels.delogo        <- Call 11, new
--   pack.verify
--   pack.activate
--
-- TWO SETS EXIST ON PURPOSE. The branded six are the authoritative production
-- artwork and are never mutated again. The qc-panel duplicates are a
-- non-authoritative working set: never printed, never a Topaz input, never in
-- the output set or the ZIP. qc-panel is therefore its own artifact kind
-- rather than a second flavour of 'panel' -- reusing 'panel' would make
-- source.verify count twelve and force its exactly-six-distinct-surface_key
-- assertion to be relaxed, and that assertion is what makes implicit
-- mirroring impossible.

ALTER TABLE public.designpro_workflow_stages
  DROP CONSTRAINT IF EXISTS designpro_workflow_stages_stage_key_check;
ALTER TABLE public.designpro_workflow_stages
  ADD CONSTRAINT designpro_workflow_stages_stage_key_check CHECK (stage_key IN (
    'revision.freeze','manifest.resolve','proof.build','panels.build','logos.extract','panels.delogo',
    'pack.verify','pack.activate',
    'source.verify','await_panelpro_preflight_qc','enhance.upscale','output.build','output.verify','await_final_human_qc',
    'stamp.build','zip.build','wrapbox.deliver'
  ));

ALTER TABLE public.designpro_stage_receipts
  DROP CONSTRAINT IF EXISTS designpro_stage_receipts_receipt_kind_check;
ALTER TABLE public.designpro_stage_receipts
  ADD CONSTRAINT designpro_stage_receipts_receipt_kind_check CHECK (receipt_kind IN (
    'views.seven-source','call8.flat-proof','call9.surface-panels','call10.logo-inventory','call11.qc-panels',
    'panelpro.preflight',
    'call12.topaz-upscale','output.verified','final.human-qc','stamp','zip','wrapbox.delivery'
  ));

ALTER TABLE public.designpro_artifacts
  DROP CONSTRAINT IF EXISTS designpro_artifacts_artifact_kind_check;
ALTER TABLE public.designpro_artifacts
  ADD CONSTRAINT designpro_artifacts_artifact_kind_check CHECK (artifact_kind IN (
    'flat-proof','panel','qc-panel','upscaled-panel','logo','output','stamp','zip','wrapbox-manifest'
  ));

-- Reseed the entice stage list. Body is the exact function from 20260806180400
-- with 'panels.delogo' added to the stage array; nothing else in it changes.
CREATE OR REPLACE FUNCTION public.create_designpro_entice_workflow(
  p_revision_id uuid,p_idempotency_key text,p_input jsonb DEFAULT '{}'
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
  FOREACH v_stage IN ARRAY ARRAY['revision.freeze','manifest.resolve','proof.build','panels.build','logos.extract','panels.delogo','pack.verify','pack.activate'] LOOP
    INSERT INTO public.designpro_workflow_stages(run_id,stage_key,sequence,idempotency_key,input) VALUES(v_run.id,v_stage,v_seq,v_run.id::text||':'||v_stage,jsonb_build_object('revisionId',v_source.revision_id,'enticePackId',v_run.entice_pack_id)) ON CONFLICT(run_id,stage_key) DO NOTHING; v_seq:=v_seq+10;
  END LOOP;
  RETURN jsonb_build_object('workflowRunId',v_run.id,'revisionId',v_run.revision_id,'enticePackId',v_run.entice_pack_id,'status',v_run.status);
END $fn$;

REVOKE ALL ON FUNCTION public.create_designpro_entice_workflow(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_designpro_entice_workflow(uuid,text,jsonb) TO authenticated,service_role;

-- Schedule Call 11 into entice runs that have not sealed their pack yet.
-- A run already past pack.verify is deliberately left alone: inserting a stage
-- behind a finalized pack identity would invalidate an artifact set hash that
-- downstream receipts are already bound to.
INSERT INTO public.designpro_workflow_stages(run_id, stage_key, sequence, idempotency_key, input, status)
SELECT s.run_id, 'panels.delogo', s.sequence - 5, s.run_id::text || ':panels.delogo',
       jsonb_build_object('revisionId', r.revision_id, 'enticePackId', r.entice_pack_id), 'pending'
FROM public.designpro_workflow_stages s
JOIN public.designpro_workflow_runs r ON r.id = s.run_id
WHERE s.stage_key = 'pack.verify'
  AND s.status IN ('pending','retryable')
  AND r.workflow_type = 'designpro.entice_pack'
ON CONFLICT (run_id, stage_key) DO NOTHING;
