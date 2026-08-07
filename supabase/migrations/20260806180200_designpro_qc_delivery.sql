-- Standalone DesignProAI OS: human gates, final QC, stamp/ZIP and WrapBox proof.

CREATE TABLE IF NOT EXISTS public.designpro_qc_members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  can_preflight boolean NOT NULL DEFAULT false,
  can_final_qc boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.designpro_qc_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.designpro_qc_members FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.designpro_qc_members TO service_role;

CREATE OR REPLACE FUNCTION public.request_designpro_human_gate(
  p_run_id uuid,p_stage_key text,p_details jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_stage public.designpro_workflow_stages%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_stage_key NOT IN ('await_panelpro_preflight_qc','await_final_human_qc') THEN RAISE EXCEPTION 'invalid_human_gate'; END IF;
  SELECT * INTO v_stage FROM public.designpro_workflow_stages WHERE run_id=p_run_id AND stage_key=p_stage_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'human_gate_missing'; END IF;
  IF v_stage.status='completed' THEN RETURN jsonb_build_object('idempotent',true,'status','completed'); END IF;
  IF v_stage.status<>'pending' OR EXISTS(SELECT 1 FROM public.designpro_workflow_stages p WHERE p.run_id=p_run_id AND p.sequence<v_stage.sequence AND p.status NOT IN ('completed','skipped')) THEN RAISE EXCEPTION 'human_gate_not_ready'; END IF;
  UPDATE public.designpro_workflow_stages SET status='waiting',wait_reason=CASE WHEN p_stage_key='await_panelpro_preflight_qc' THEN 'panelpro_preflight_required' ELSE 'final_human_qc_required' END,
    wait_details=COALESCE(p_details,'{}'),updated_at=clock_timestamp() WHERE id=v_stage.id;
  UPDATE public.designpro_workflow_runs SET status='approval_required',updated_at=clock_timestamp() WHERE id=p_run_id;
  RETURN jsonb_build_object('idempotent',false,'status','approval_required','stage',p_stage_key);
END $fn$;

CREATE OR REPLACE FUNCTION public.approve_designpro_human_gate(
  p_run_id uuid,p_stage_key text,p_actor uuid,p_approval_ref text,p_qc jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_stage public.designpro_workflow_stages%ROWTYPE; v_run public.designpro_workflow_runs%ROWTYPE; v_source public.designpro_revision_sources%ROWTYPE; v_kind text; v_hash text; v_now timestamptz:=clock_timestamp(); v_verified_by text; v_design_id text; v_order_number text;
BEGIN
  IF p_stage_key NOT IN ('await_panelpro_preflight_qc','await_final_human_qc') OR NULLIF(btrim(p_approval_ref),'') IS NULL THEN RAISE EXCEPTION 'invalid_qc_approval'; END IF;
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor) THEN RAISE EXCEPTION 'qc_actor_identity_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.designpro_qc_members q WHERE q.user_id=p_actor AND ((p_stage_key='await_panelpro_preflight_qc' AND q.can_preflight) OR (p_stage_key='await_final_human_qc' AND q.can_final_qc))) THEN RAISE EXCEPTION 'qc_permission_required'; END IF;
  -- Approval/stamp identity must not come from user-editable metadata.
  SELECT COALESCE(
    NULLIF(btrim(raw_app_meta_data->>'display_name'),''),
    NULLIF(btrim(email),''),p_actor::text
  ) INTO v_verified_by
  FROM auth.users
  WHERE id=p_actor AND email_confirmed_at IS NOT NULL;
  IF NULLIF(btrim(v_verified_by),'') IS NULL THEN RAISE EXCEPTION 'qc_actor_identity_unresolvable'; END IF;
  IF NOT COALESCE(p_qc,'{}') @> '{"known":true,"pass":true}'::jsonb THEN RAISE EXCEPTION 'known_passing_qc_required'; END IF;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=p_run_id AND workflow_type='designpro.production_pack' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'production_workflow_not_found'; END IF;
  SELECT * INTO v_source FROM public.designpro_revision_sources
  WHERE revision_id=v_run.revision_id AND owner_id=v_run.owner_id
    AND snapshot_hash=v_run.revision_snapshot_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'immutable_revision_identity_mismatch'; END IF;
  v_design_id:=v_source.snapshot->>'designId';
  v_order_number:=v_source.snapshot->>'orderNumber';
  IF v_source.snapshot->>'generationId' IS DISTINCT FROM v_source.generation_id::text
    OR v_design_id IS DISTINCT FROM 'DID-' || upper(substr(replace(v_source.generation_id::text,'-',''),1,8))
    OR v_order_number IS DISTINCT FROM btrim(v_order_number)
    OR v_order_number !~ '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
  THEN RAISE EXCEPTION 'immutable_design_id_and_order_number_required'; END IF;
  SELECT * INTO v_stage FROM public.designpro_workflow_stages WHERE run_id=p_run_id AND stage_key=p_stage_key FOR UPDATE;
  IF v_stage.status='completed' AND v_stage.output->>'approvalRef'=p_approval_ref THEN RETURN jsonb_build_object('idempotent',true,'workflowStatus',v_run.status); END IF;
  IF v_stage.status<>'waiting' OR v_run.status<>'approval_required' THEN RAISE EXCEPTION 'workflow_not_awaiting_qc'; END IF;
  IF p_stage_key='await_panelpro_preflight_qc' THEN
    v_kind:='panelpro.preflight';
    IF NOT p_qc @> '{"dimensionsVerified":true,"sourceRegionsVerified":true,"fiveInchBleed":true,"panelHashesVerified":true,"logoInventoryVerified":true,"textLockVerified":true}'::jsonb THEN RAISE EXCEPTION 'panelpro_preflight_evidence_incomplete'; END IF;
    IF NOT EXISTS(
      SELECT 1 FROM public.designpro_workflow_stages s
      WHERE s.run_id=p_run_id AND s.stage_key='source.verify' AND s.status='completed'
        AND s.verification @> '{"verified":true}'::jsonb
        AND s.output#>>'{call9,receiptKind}'='call9.surface-panels'
        AND s.output#>>'{call10,receiptKind}'='call10.logo-inventory'
        AND lower(s.output#>>'{call9,receiptHash}') ~ '^[0-9a-f]{64}$'
        AND lower(s.output#>>'{call10,receiptHash}') ~ '^[0-9a-f]{64}$'
    ) THEN RAISE EXCEPTION 'frozen_call9_call10_receipts_required'; END IF;
  ELSE
    v_kind:='final.human-qc';
    IF NOT p_qc @> '{"outputHashesVerified":true,"printDimensionsVerified":true,"colorModeVerified":true}'::jsonb
      OR p_qc->>'designId' IS DISTINCT FROM v_design_id
      OR p_qc->>'orderNumber' IS DISTINCT FROM v_order_number
    THEN RAISE EXCEPTION 'final_qc_evidence_or_business_identity_incomplete'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts WHERE run_id=p_run_id AND receipt_kind='output.verified') THEN RAISE EXCEPTION 'verified_output_receipt_required'; END IF;
  END IF;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('runId',p_run_id,'stage',p_stage_key,'actor',p_actor,'verifiedBy',v_verified_by,'approvalRef',p_approval_ref,'qc',p_qc)::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.designpro_stage_receipts(run_id,stage_id,receipt_kind,identity,receipt,receipt_hash)
  VALUES(p_run_id,v_stage.id,v_kind,jsonb_build_object('workflowRunId',p_run_id,'actorId',p_actor),jsonb_build_object('verified',true,'approvalRef',p_approval_ref,'actorId',p_actor,'verifiedBy',v_verified_by,'approvedAt',v_now,'qc',p_qc),v_hash);
  UPDATE public.designpro_workflow_stages SET status='completed',output=jsonb_build_object('approvalRef',p_approval_ref,'actorId',p_actor,'verifiedBy',v_verified_by,'qc',p_qc),verification=jsonb_build_object('verified',true,'kind',v_kind,'actorId',p_actor,'verifiedBy',v_verified_by),output_hash=v_hash,completed_at=v_now,wait_reason=NULL,wait_details='{}',updated_at=v_now WHERE id=v_stage.id;
  PERFORM public.designpro_sync_run_status(p_run_id);
  RETURN jsonb_build_object('idempotent',false,'workflowStatus',(SELECT status FROM public.designpro_workflow_runs WHERE id=p_run_id),'approvedAt',v_now);
END $fn$;

CREATE OR REPLACE FUNCTION public.verify_designpro_delivery_chain(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_run public.designpro_workflow_runs%ROWTYPE; v_zip public.designpro_stage_receipts%ROWTYPE; v_delivery public.designpro_stage_receipts%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_not_found'; END IF;
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' AND v_run.owner_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'workflow_owner_required'; END IF;
  SELECT * INTO v_zip FROM public.designpro_stage_receipts WHERE run_id=p_run_id AND receipt_kind='zip';
  SELECT * INTO v_delivery FROM public.designpro_stage_receipts WHERE run_id=p_run_id AND receipt_kind='wrapbox.delivery';
  RETURN jsonb_build_object('verified',v_run.status='completed' AND v_zip.id IS NOT NULL AND v_delivery.id IS NOT NULL AND v_delivery.receipt->>'zipHash'=v_zip.receipt_hash,
    'workflowStatus',v_run.status,'zipHash',v_zip.receipt_hash,'deliveryReceiptHash',v_delivery.receipt_hash);
END $fn$;

REVOKE ALL ON FUNCTION public.request_designpro_human_gate(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.verify_designpro_delivery_chain(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_designpro_human_gate(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.verify_designpro_delivery_chain(uuid) TO authenticated,service_role;
