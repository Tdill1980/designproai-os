-- PURCHASE ENTITLEMENTS — ported business behaviour, adapted persistence.
--
-- The proven implementation is create-print-pack-checkout for the $299 pack and
-- create-single-use-checkout (tool: "logo_pack") for the $29 one. Their model is
-- explicit in create-print-pack-checkout's own header: on payment the webhook
-- "upserts a PAID production_packs row for this generation and stops -- no
-- pipeline kick", and the gate then lives on the upscaler. Payment sells an
-- ENTITLEMENT; it does not run a pipeline.
--
-- That behaviour is preserved exactly. What changes is only where it is
-- recorded: production_packs and panelizer_jobs are legacy tables this system
-- must not restore, so the entitlement lands here instead. The Stripe metadata
-- semantics are unchanged -- product_type, generation_id, user_id, user_email,
-- amount_cents -- and so are the product identifiers and prices:
--
--   print_pack_entitlement   $299   the clean Production Pack path
--   logo_pack                 $29   the proven Logo Pack path
--
-- The obsolete print_production_pack identifier is deliberately absent. Its own
-- source describes it as the path that "kicks the OLD panelizer re-slice
-- pipeline", which is the pipeline this system replaced.
--
-- TWO PRODUCTS, NEVER ONE. Buying logos is not buying production files, and the
-- reverse is equally wrong. One workflow may process both efficiently; the
-- entitlements stay distinct so the delivery can say what was paid for.

CREATE TABLE IF NOT EXISTS public.designpro_purchase_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The prepared pack that was bought. Production is already associated with
  -- this run, so a purchase and the artifacts it pays for cannot drift apart.
  entice_run_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  product_type text NOT NULL CHECK (product_type IN ('print_pack_entitlement','logo_pack')),
  -- Cents, as Stripe reported them. Recorded from the verified event rather
  -- than assumed, so a later price change cannot rewrite an old purchase.
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd',
  user_email text,
  checkout_session_id text NOT NULL,
  payment_intent_id text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The Stripe session is the transaction identity, exactly as the proven flow
-- treats it. A redelivered webhook lands on this constraint instead of buying
-- the same thing twice -- which is why no pre-payment row is needed to make the
-- confirmation idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS designpro_entitlement_session_uidx
  ON public.designpro_purchase_entitlements(checkout_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS designpro_entitlement_run_product_uidx
  ON public.designpro_purchase_entitlements(entice_run_id, product_type);
CREATE INDEX IF NOT EXISTS designpro_entitlement_owner_idx
  ON public.designpro_purchase_entitlements(owner_id, generation_id);

ALTER TABLE public.designpro_purchase_entitlements ENABLE ROW LEVEL SECURITY;

-- The customer may read what they bought and may never write it. An entitlement
-- a browser can insert is a claim, not a payment.
DROP POLICY IF EXISTS designpro_owner_read_entitlements ON public.designpro_purchase_entitlements;
CREATE POLICY designpro_owner_read_entitlements
  ON public.designpro_purchase_entitlements FOR SELECT TO authenticated
  USING (owner_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.designpro_purchase_entitlements FROM authenticated, anon;

-- THE PURCHASE GATE. The production workflow is created as soon as the pack is
-- prepared, and stops here before anything expensive. Adding one stage to the
-- existing workflow is the smallest gate that works; a second workflow would be
-- a second conductor.
ALTER TABLE public.designpro_workflow_stages DROP CONSTRAINT IF EXISTS designpro_workflow_stages_stage_key_check;
ALTER TABLE public.designpro_workflow_stages ADD CONSTRAINT designpro_workflow_stages_stage_key_check
  CHECK (stage_key IN (
    'revision.freeze','manifest.resolve','proof.build','panels.build','logos.extract','panels.delogo',
    'pack.verify','pack.activate','await_purchase','source.verify','await_panelpro_preflight_qc',
    'enhance.upscale','output.build','output.verify','await_final_human_qc',
    'stamp.build','zip.build','wrapbox.deliver'
  ));

CREATE OR REPLACE FUNCTION public.create_designpro_production_workflow(
  p_entice_run_id uuid, p_idempotency_key text, p_input jsonb DEFAULT '{}'
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
  -- await_purchase leads. Every stage after it is paid work, so the gate is the
  -- first thing the run reaches and nothing expensive sits ahead of it.
  FOREACH v_stage IN ARRAY ARRAY['await_purchase','source.verify','await_panelpro_preflight_qc','enhance.upscale','output.build','output.verify','await_final_human_qc','stamp.build','zip.build','wrapbox.deliver'] LOOP
    INSERT INTO public.designpro_workflow_stages(run_id,stage_key,sequence,idempotency_key,input) VALUES(v_run.id,v_stage,v_seq,v_run.id::text||':'||v_stage,jsonb_build_object('sourceEnticeRunId',v_entice.id)) ON CONFLICT(run_id,stage_key) DO NOTHING; v_seq:=v_seq+10;
  END LOOP;
  RETURN jsonb_build_object('workflowRunId',v_run.id,'sourceEnticeRunId',v_entice.id,'status',v_run.status);
END $fn$;

/**
 * Record a verified payment. That is the whole of it.
 *
 * The proven flow's webhook records the entitlement and stops; the expensive
 * work sits behind the entitlement rather than being launched by it. This does
 * the same, so Stripe never becomes the production engine. The worker's
 * reconciler is what advances the waiting run -- payment changes authorization,
 * the worker changes workflow state.
 *
 * Idempotent through the session's own unique index: a redelivered webhook
 * returns the same entitlement instead of buying twice.
 */
CREATE OR REPLACE FUNCTION public.confirm_designpro_purchase(
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_product_type text,
  p_generation_id uuid,
  p_amount_cents integer,
  p_user_email text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, extensions AS $$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_row public.designpro_purchase_entitlements%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  SELECT * INTO v_row FROM public.designpro_purchase_entitlements
   WHERE checkout_session_id = p_checkout_session_id;
  IF v_row.id IS NOT NULL THEN
    RETURN jsonb_build_object('entitlementId', v_row.id, 'productType', v_row.product_type, 'idempotent', true);
  END IF;

  -- The prepared pack the customer was looking at when they paid. Keyed by the
  -- generation id the Stripe metadata carries, exactly as the proven webhook
  -- keys its fulfillment.
  SELECT * INTO v_run FROM public.designpro_workflow_runs
   WHERE workflow_type = 'designpro.entice_pack' AND generation_id = p_generation_id
     AND status = 'completed'
   ORDER BY created_at DESC LIMIT 1;
  IF v_run.id IS NULL THEN RAISE EXCEPTION 'prepared_pack_not_found'; END IF;

  INSERT INTO public.designpro_purchase_entitlements
    (owner_id, entice_run_id, generation_id, product_type, amount_cents, user_email,
     checkout_session_id, payment_intent_id)
  VALUES
    (v_run.owner_id, v_run.id, p_generation_id, p_product_type, p_amount_cents, p_user_email,
     p_checkout_session_id, p_payment_intent_id)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('entitlementId', v_row.id, 'productType', v_row.product_type, 'idempotent', false);
END;
$$;

/** What this prepared pack has been paid for. Read before anything is spent. */
CREATE OR REPLACE FUNCTION public.designpro_paid_products(p_entice_run_id uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public, extensions AS $$
  SELECT COALESCE(array_agg(product_type ORDER BY product_type), ARRAY[]::text[])
    FROM public.designpro_purchase_entitlements
   WHERE entice_run_id = p_entice_run_id;
$$;

/**
 * THE WORKER'S HALF. Release any purchase gate whose pack has now been paid for.
 *
 * This is what makes payment recoverable rather than a moment that must be
 * caught. The webhook can land while the worker is down, be delivered twice, or
 * arrive before the run finished being written -- the next reconciliation
 * notices the entitlement and releases the waiting stage. A gate with no paid
 * entitlement is left exactly where it is.
 */
CREATE OR REPLACE FUNCTION public.reconcile_designpro_purchase_gates()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, extensions AS $$
DECLARE v_released int;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  WITH released AS (
    UPDATE public.designpro_workflow_stages s
       SET status = 'pending', wait_reason = NULL, available_at = now(), updated_at = clock_timestamp()
      FROM public.designpro_workflow_runs r
     WHERE s.run_id = r.id
       AND s.stage_key = 'await_purchase'
       AND s.status = 'waiting'
       AND EXISTS (
         SELECT 1 FROM public.designpro_purchase_entitlements e
          WHERE e.entice_run_id = (r.results->>'sourceEnticeRunId')::uuid
       )
    RETURNING s.id
  )
  SELECT count(*) INTO v_released FROM released;
  -- A run parked at a gate reads as approval_required; releasing it hands it
  -- back to the claim loop.
  UPDATE public.designpro_workflow_runs r SET status = 'running', updated_at = clock_timestamp()
   WHERE r.status = 'approval_required'
     AND EXISTS (SELECT 1 FROM public.designpro_workflow_stages s
                  WHERE s.run_id = r.id AND s.stage_key = 'await_purchase' AND s.status = 'pending');
  RETURN jsonb_build_object('released', v_released);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_designpro_purchase(text, text, text, uuid, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.designpro_paid_products(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reconcile_designpro_purchase_gates() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_designpro_purchase(text, text, text, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.designpro_paid_products(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_designpro_purchase_gates() TO service_role;

/**
 * Park the run at the purchase gate. The same shape as the human gates: the
 * stage waits, the run reads approval_required, and something else releases it
 * -- a person for QC, a confirmed payment here.
 */
CREATE OR REPLACE FUNCTION public.request_designpro_purchase_gate(p_run_id uuid, p_details jsonb DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, extensions AS $$
DECLARE v_stage public.designpro_workflow_stages%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  SELECT * INTO v_stage FROM public.designpro_workflow_stages
   WHERE run_id = p_run_id AND stage_key = 'await_purchase' FOR UPDATE;
  IF v_stage.id IS NULL THEN RAISE EXCEPTION 'purchase_gate_missing'; END IF;
  IF v_stage.status = 'completed' THEN RETURN jsonb_build_object('idempotent', true, 'status', 'completed'); END IF;
  UPDATE public.designpro_workflow_stages
     SET status = 'waiting', wait_reason = 'purchase_required',
         error_details = COALESCE(p_details, '{}'), updated_at = clock_timestamp()
   WHERE id = v_stage.id;
  UPDATE public.designpro_workflow_runs SET status = 'approval_required', updated_at = clock_timestamp()
   WHERE id = p_run_id;
  RETURN jsonb_build_object('idempotent', false, 'status', 'approval_required', 'stage', 'await_purchase');
END;
$$;

REVOKE ALL ON FUNCTION public.request_designpro_purchase_gate(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_designpro_purchase_gate(uuid, jsonb) TO service_role;
