-- GENERATION OS: ARTIFACT / RECEIPT LINEAGE + CANONICAL PHASE
--
-- The workflow graph decides execution. This migration adds observability over
-- the immutable evidence it produces so a Generation ID can be reopened years
-- later and still answer which files, receipts and version produced the pack.

CREATE OR REPLACE FUNCTION designpro_private.log_designpro_artifact_os_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, designpro_private
AS $fn$
DECLARE
  v_generation uuid;
  v_revision uuid;
  v_stage_key text;
BEGIN
  SELECT s.generation_id,w.revision_id,st.stage_key
  INTO v_generation,v_revision,v_stage_key
  FROM public.designpro_workflow_runs w
  JOIN public.designpro_revision_sources s ON s.revision_id=w.revision_id
  JOIN public.designpro_workflow_stages st ON st.id=NEW.stage_id AND st.run_id=w.id
  WHERE w.id=NEW.run_id;

  IF v_generation IS NULL THEN
    -- Do not attach an artifact to a guessed Generation ID. Legacy/unbound
    -- workflow rows stay compatible and simply remain outside the OS ledger.
    RETURN NEW;
  END IF;

  INSERT INTO public.designpro_generation_os_events(
    generation_id,event_type,revision_id,run_id,stage_key,state,payload
  ) VALUES (
    v_generation,
    'artifact.created',
    v_revision,
    NEW.run_id,
    v_stage_key,
    'created',
    pg_catalog.jsonb_build_object(
      'artifactId',NEW.id,
      'artifactKind',NEW.artifact_kind,
      'surfaceKey',NEW.surface_key,
      'storagePath',NEW.storage_path,
      'contentHash',NEW.content_hash,
      'byteSize',NEW.byte_size,
      'metadata',NEW.metadata
    )
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS designpro_artifact_os_event ON public.designpro_artifacts;
CREATE TRIGGER designpro_artifact_os_event
AFTER INSERT ON public.designpro_artifacts
FOR EACH ROW EXECUTE FUNCTION designpro_private.log_designpro_artifact_os_event();

CREATE OR REPLACE FUNCTION designpro_private.log_designpro_receipt_os_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, designpro_private
AS $fn$
DECLARE
  v_generation uuid;
  v_revision uuid;
  v_stage_key text;
BEGIN
  SELECT s.generation_id,w.revision_id,st.stage_key
  INTO v_generation,v_revision,v_stage_key
  FROM public.designpro_workflow_runs w
  JOIN public.designpro_revision_sources s ON s.revision_id=w.revision_id
  JOIN public.designpro_workflow_stages st ON st.id=NEW.stage_id AND st.run_id=w.id
  WHERE w.id=NEW.run_id;

  IF v_generation IS NULL THEN
    -- Verified receipts are logged only when the canonical revision-source
    -- contract resolves their exact Generation ID; ambiguity is never filled.
    RETURN NEW;
  END IF;

  INSERT INTO public.designpro_generation_os_events(
    generation_id,event_type,revision_id,run_id,stage_key,state,payload
  ) VALUES (
    v_generation,
    'receipt.created',
    v_revision,
    NEW.run_id,
    v_stage_key,
    'verified',
    pg_catalog.jsonb_build_object(
      'receiptId',NEW.id,
      'receiptKind',NEW.receipt_kind,
      'receiptHash',NEW.receipt_hash,
      'identity',NEW.identity
    )
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS designpro_receipt_os_event ON public.designpro_stage_receipts;
CREATE TRIGGER designpro_receipt_os_event
AFTER INSERT ON public.designpro_stage_receipts
FOR EACH ROW EXECUTE FUNCTION designpro_private.log_designpro_receipt_os_event();

-- One deterministic phase derived from server evidence. It is deliberately a
-- projection rather than mutable state: the underlying graph/stage rows remain
-- authoritative and this cannot drift from them.
CREATE OR REPLACE FUNCTION designpro_private.designpro_generation_phase(p_generation_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, designpro_private
AS $fn$
WITH runs AS (
  SELECT w.*
  FROM public.designpro_workflow_runs w
  JOIN public.designpro_revision_sources s ON s.revision_id=w.revision_id
  WHERE s.generation_id=p_generation_id
), prod AS (
  SELECT * FROM runs WHERE workflow_type='designpro.production_pack'
  ORDER BY created_at DESC LIMIT 1
), entice AS (
  SELECT * FROM runs WHERE workflow_type='designpro.entice_pack'
  ORDER BY created_at DESC LIMIT 1
), ps AS (
  SELECT st.stage_key,st.status
  FROM public.designpro_workflow_stages st
  JOIN prod p ON p.id=st.run_id
), es AS (
  SELECT st.stage_key,st.status
  FROM public.designpro_workflow_stages st
  JOIN entice e ON e.id=st.run_id
), req AS (
  SELECT state FROM public.designpro_generation_requests
  WHERE generation_id=p_generation_id LIMIT 1
)
SELECT CASE
  WHEN EXISTS(SELECT 1 FROM ps WHERE stage_key='wrapbox.deliver' AND status='completed') THEN 'complete'
  WHEN EXISTS(SELECT 1 FROM ps WHERE stage_key IN ('zip.build','stamp.build') AND status IN ('running','completed')) THEN 'packaging'
  WHEN EXISTS(SELECT 1 FROM ps WHERE stage_key='await_final_human_qc' AND status IN ('pending','waiting','running')) THEN 'final_qc'
  WHEN EXISTS(SELECT 1 FROM ps WHERE stage_key IN ('output.build','output.verify') AND status IN ('pending','retryable','running','completed')) THEN 'output'
  WHEN EXISTS(SELECT 1 FROM ps WHERE stage_key='enhance.upscale' AND status IN ('pending','retryable','running','completed')) THEN 'enhancing'
  WHEN EXISTS(SELECT 1 FROM ps WHERE stage_key='await_panelpro_preflight_qc' AND status IN ('pending','waiting','running')) THEN 'panelpro_qc'
  WHEN EXISTS(SELECT 1 FROM ps WHERE stage_key IN ('manifest.resolve','source.verify') AND status IN ('pending','retryable','running','completed')) THEN 'production_preflight'
  WHEN EXISTS(SELECT 1 FROM ps WHERE stage_key='await_purchase' AND status IN ('pending','waiting','running')) THEN 'await_purchase'
  WHEN EXISTS(SELECT 1 FROM es WHERE stage_key='pack.activate' AND status='completed') THEN 'production_preview_ready'
  WHEN EXISTS(SELECT 1 FROM es WHERE stage_key IN ('proof.build','panels.build','logos.extract','panels.delogo','pack.verify','pack.activate') AND status IN ('pending','retryable','running','completed')) THEN 'building_preview'
  WHEN EXISTS(SELECT 1 FROM public.designpro_flat_atlas_revisions a
              JOIN public.designpro_generation_requests r ON r.id=a.request_id
              WHERE r.generation_id=p_generation_id) THEN 'design_ready'
  ELSE COALESCE((SELECT state FROM req),'unknown')
END
$fn$;

-- Replace v1 snapshot with the same contract plus artifact, receipt and phase
-- evidence. Existing fields are preserved.
CREATE OR REPLACE FUNCTION public.designpro_generation_os_snapshot(p_generation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, designpro_private
AS $fn$
DECLARE
  v_owner uuid := auth.uid();
  v_request public.designpro_generation_requests%ROWTYPE;
  v_staff boolean;
  v_revisions jsonb;
  v_runs jsonb;
  v_events jsonb;
  v_artifacts jsonb;
  v_receipts jsonb;
BEGIN
  IF v_owner IS NULL OR COALESCE(auth.jwt()->>'is_anonymous','false')='true' THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  SELECT * INTO v_request
  FROM public.designpro_generation_requests r
  WHERE r.generation_id=p_generation_id;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'generation_not_found'; END IF;

  v_staff := designpro_private.caller_is_design_staff();
  IF NOT v_staff AND v_request.owner_id<>v_owner THEN
    RAISE EXCEPTION 'generation_access_denied';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'revisionId',a.id,'parentRevisionId',a.parent_revision_id,
      'revisionSequence',a.revision_sequence,
      'masterContentHash',a.master_content_hash,
      'projectionContentHash',a.projection_content_hash,
      'productionEligible',a.production_eligible,
      'createdAt',a.created_at
    ) ORDER BY a.revision_sequence DESC
  ),'[]'::jsonb)
  INTO v_revisions
  FROM public.designpro_flat_atlas_revisions a
  WHERE a.request_id=v_request.id;

  SELECT COALESCE(pg_catalog.jsonb_agg(run_row ORDER BY (run_row->>'createdAt') DESC),'[]'::jsonb)
  INTO v_runs
  FROM (
    SELECT pg_catalog.jsonb_build_object(
      'runId',w.id,'revisionId',w.revision_id,'workflowType',w.workflow_type,
      'status',w.status,'createdAt',w.created_at,'updatedAt',w.updated_at,
      'stages',COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'stageId',st.id,'stageKey',st.stage_key,'state',st.status,
            'sequence',st.sequence,'dependsOn',st.depends_on,'attempt',st.attempt,
            'waitReason',st.wait_reason,'errorCode',st.error_code,
            'completedAt',st.completed_at,'verification',st.verification
          ) ORDER BY st.sequence,st.stage_key
        ) FROM public.designpro_workflow_stages st WHERE st.run_id=w.id
      ),'[]'::jsonb)
    ) AS run_row
    FROM public.designpro_workflow_runs w
    JOIN public.designpro_revision_sources s ON s.revision_id=w.revision_id
    WHERE s.generation_id=p_generation_id
  ) q;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'artifactId',a.id,'runId',a.run_id,'stageId',a.stage_id,
      'artifactKind',a.artifact_kind,'surfaceKey',a.surface_key,
      'storagePath',a.storage_path,'contentHash',a.content_hash,
      'byteSize',a.byte_size,'metadata',a.metadata,'createdAt',a.created_at
    ) ORDER BY a.created_at,a.id
  ),'[]'::jsonb)
  INTO v_artifacts
  FROM public.designpro_artifacts a
  JOIN public.designpro_workflow_runs w ON w.id=a.run_id
  JOIN public.designpro_revision_sources s ON s.revision_id=w.revision_id
  WHERE s.generation_id=p_generation_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'receiptId',r.id,'runId',r.run_id,'stageId',r.stage_id,
      'receiptKind',r.receipt_kind,'receiptHash',r.receipt_hash,
      'identity',r.identity,'createdAt',r.created_at
    ) ORDER BY r.created_at,r.id
  ),'[]'::jsonb)
  INTO v_receipts
  FROM public.designpro_stage_receipts r
  JOIN public.designpro_workflow_runs w ON w.id=r.run_id
  JOIN public.designpro_revision_sources s ON s.revision_id=w.revision_id
  WHERE s.generation_id=p_generation_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id',e.id,'eventType',e.event_type,'revisionId',e.revision_id,
      'runId',e.run_id,'stageKey',e.stage_key,'state',e.state,
      'payload',e.payload,'createdAt',e.created_at
    ) ORDER BY e.id
  ),'[]'::jsonb)
  INTO v_events
  FROM public.designpro_generation_os_events e
  WHERE e.generation_id=p_generation_id;

  RETURN pg_catalog.jsonb_build_object(
    'contract','designpro.generation-os.v1',
    'generationId',p_generation_id,
    'requestId',v_request.id,
    'requestState',v_request.state,
    'phase',designpro_private.designpro_generation_phase(p_generation_id),
    'createdAt',v_request.created_at,
    'updatedAt',v_request.updated_at,
    'currentRevisionId',(
      SELECT a.id FROM public.designpro_flat_atlas_revisions a
      WHERE a.request_id=v_request.id ORDER BY a.revision_sequence DESC LIMIT 1
    ),
    'currentRevisionSequence',(
      SELECT pg_catalog.max(a.revision_sequence)
      FROM public.designpro_flat_atlas_revisions a WHERE a.request_id=v_request.id
    ),
    'revisions',v_revisions,
    'workflowRuns',v_runs,
    'artifacts',v_artifacts,
    'receipts',v_receipts,
    'events',v_events
  );
END;
$fn$;

-- Reassert both evidence triggers after every OS function has reached its
-- final definition. These names are part of the pgTAP/release contract.
DROP TRIGGER IF EXISTS designpro_artifact_os_event ON public.designpro_artifacts;
CREATE TRIGGER designpro_artifact_os_event
AFTER INSERT ON public.designpro_artifacts
FOR EACH ROW EXECUTE FUNCTION designpro_private.log_designpro_artifact_os_event();

DROP TRIGGER IF EXISTS designpro_receipt_os_event ON public.designpro_stage_receipts;
CREATE TRIGGER designpro_receipt_os_event
AFTER INSERT ON public.designpro_stage_receipts
FOR EACH ROW EXECUTE FUNCTION designpro_private.log_designpro_receipt_os_event();

-- Repair the paid-entitlement lookup against the actual Generation identity
-- contract: workflow_run.revision_id -> revision_sources.generation_id.
CREATE OR REPLACE FUNCTION public.confirm_designpro_purchase(
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_product_type text,
  p_generation_id uuid,
  p_amount_cents integer,
  p_user_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, extensions
AS $purchase$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_row public.designpro_purchase_entitlements%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  SELECT * INTO v_row
  FROM public.designpro_purchase_entitlements
  WHERE checkout_session_id=p_checkout_session_id;

  IF v_row.id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'entitlementId',v_row.id,
      'productType',v_row.product_type,
      'idempotent',true
    );
  END IF;

  SELECT w.* INTO v_run
  FROM public.designpro_workflow_runs w
  JOIN public.designpro_revision_sources s ON s.revision_id=w.revision_id
  WHERE w.workflow_type='designpro.entice_pack'
    AND s.generation_id=p_generation_id
    AND w.status='completed'
  ORDER BY w.created_at DESC
  LIMIT 1;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'prepared_pack_not_found';
  END IF;

  INSERT INTO public.designpro_purchase_entitlements(
    owner_id,entice_run_id,generation_id,product_type,amount_cents,user_email,
    checkout_session_id,payment_intent_id
  ) VALUES (
    v_run.owner_id,v_run.id,p_generation_id,p_product_type,p_amount_cents,
    p_user_email,p_checkout_session_id,p_payment_intent_id
  )
  RETURNING * INTO v_row;

  RETURN pg_catalog.jsonb_build_object(
    'entitlementId',v_row.id,
    'productType',v_row.product_type,
    'idempotent',false
  );
END;
$purchase$;

-- The promotion-aware overload is the production webhook contract. Repair it
-- against the same revision-source identity without changing Stripe-owned
-- discount calculation or the real zero-dollar promotion entitlement path.
CREATE OR REPLACE FUNCTION public.confirm_designpro_purchase(
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_product_type text,
  p_generation_id uuid,
  p_amount_cents integer,
  p_user_email text,
  p_promotion_code text DEFAULT NULL,
  p_discount_cents integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, extensions
AS $promotion_purchase$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_row public.designpro_purchase_entitlements%ROWTYPE;
  v_code text;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  v_code:=NULLIF(pg_catalog.btrim(COALESCE(p_promotion_code,'')),'');

  SELECT * INTO v_row
  FROM public.designpro_purchase_entitlements
  WHERE checkout_session_id=p_checkout_session_id;

  IF v_row.id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'entitlementId',v_row.id,
      'productType',v_row.product_type,
      'idempotent',true
    );
  END IF;

  SELECT w.* INTO v_run
  FROM public.designpro_workflow_runs w
  JOIN public.designpro_revision_sources s ON s.revision_id=w.revision_id
  WHERE w.workflow_type='designpro.entice_pack'
    AND s.generation_id=p_generation_id
    AND w.status='completed'
  ORDER BY w.created_at DESC
  LIMIT 1;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'prepared_pack_not_found';
  END IF;

  INSERT INTO public.designpro_purchase_entitlements(
    owner_id,entice_run_id,generation_id,product_type,amount_cents,user_email,
    checkout_session_id,payment_intent_id,promotion_code,discount_cents
  ) VALUES (
    v_run.owner_id,v_run.id,p_generation_id,p_product_type,p_amount_cents,
    p_user_email,p_checkout_session_id,p_payment_intent_id,v_code,
    GREATEST(COALESCE(p_discount_cents,0),0)
  )
  RETURNING * INTO v_row;

  RETURN pg_catalog.jsonb_build_object(
    'entitlementId',v_row.id,
    'productType',v_row.product_type,
    'idempotent',false,
    'amountCents',v_row.amount_cents,
    'promotionCode',v_row.promotion_code,
    'discountCents',v_row.discount_cents
  );
END;
$promotion_purchase$;

-- No OS SECURITY DEFINER helper is a public/anonymous RPC. Trigger helpers
-- need no direct role grant; the snapshot is owner/staff readable and purchase
-- confirmation remains service-role only.
REVOKE ALL ON FUNCTION designpro_private.log_designpro_artifact_os_event()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION designpro_private.log_designpro_receipt_os_event()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION designpro_private.designpro_generation_phase(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.designpro_generation_os_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.designpro_generation_os_snapshot(uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_designpro_purchase(text,text,text,uuid,integer,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_designpro_purchase(text,text,text,uuid,integer,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.confirm_designpro_purchase(text,text,text,uuid,integer,text,text,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_designpro_purchase(text,text,text,uuid,integer,text,text,integer)
  TO service_role;
