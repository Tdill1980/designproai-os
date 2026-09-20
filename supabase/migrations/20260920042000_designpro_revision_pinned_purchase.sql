-- Stripe purchases authorize the exact immutable revision shown at checkout.
-- Keep the existing owner/canary promotion RPC; customer Stripe webhooks use
-- this explicit revision variant and never resolve "latest" at payment time.
CREATE OR REPLACE FUNCTION public.confirm_designpro_revision_purchase(
  p_checkout_session_id text, p_payment_intent_id text, p_product_type text,
  p_generation_id uuid, p_amount_cents integer, p_user_email text,
  p_promotion_code text, p_discount_cents integer,
  p_atlas_revision_id uuid, p_revision_id uuid, p_revision_snapshot_hash text,
  p_entice_run_id uuid, p_owner_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, extensions AS $fn$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_row public.designpro_purchase_entitlements%ROWTYPE;
  v_code text := NULLIF(btrim(COALESCE(p_promotion_code,'')),'');
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_checkout_session_id IS NULL OR btrim(p_checkout_session_id)='' OR p_checkout_session_id<>btrim(p_checkout_session_id)
    OR p_product_type IS NULL OR p_product_type NOT IN ('print_pack_entitlement','logo_pack')
    OR p_generation_id IS NULL OR p_atlas_revision_id IS NULL OR p_revision_id IS NULL
    OR p_entice_run_id IS NULL OR p_owner_id IS NULL
    OR p_revision_snapshot_hash IS NULL OR p_revision_snapshot_hash !~ '^[0-9a-f]{64}$'
    OR p_amount_cents IS NULL OR p_amount_cents<0 OR p_discount_cents IS NULL OR p_discount_cents<0
    OR (p_amount_cents=0 AND v_code IS NULL) OR ((p_discount_cents=0) IS DISTINCT FROM (v_code IS NULL))
  THEN RAISE EXCEPTION 'purchase_revision_request_invalid'; END IF;

  -- Serialize Stripe retries, including simultaneous deliveries. The existing
  -- unique session and run/product indexes remain the transaction fences.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_checkout_session_id,0));
  SELECT * INTO v_run FROM public.designpro_workflow_runs
    WHERE id=p_entice_run_id AND workflow_type='designpro.entice_pack' AND status='completed'
      AND owner_id=p_owner_id AND generation_id=p_generation_id
      AND revision_id=p_revision_id AND revision_snapshot_hash=p_revision_snapshot_hash
    FOR UPDATE;
  IF v_run.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.designpro_revision_sources s
    JOIN public.designpro_flat_atlas_revisions a ON a.request_id=s.visualization_id
      AND a.owner_id=s.owner_id AND a.generation_id=s.generation_id
    WHERE s.revision_id=p_revision_id AND s.snapshot_hash=p_revision_snapshot_hash
      AND s.owner_id=p_owner_id AND s.generation_id=p_generation_id AND a.id=p_atlas_revision_id
  ) THEN RAISE EXCEPTION 'purchase_revision_mismatch'; END IF;

  SELECT * INTO v_row FROM public.designpro_purchase_entitlements
    WHERE checkout_session_id=p_checkout_session_id;
  IF v_row.id IS NOT NULL THEN
    IF v_row.entice_run_id IS DISTINCT FROM p_entice_run_id OR v_row.owner_id IS DISTINCT FROM p_owner_id
      OR v_row.generation_id IS DISTINCT FROM p_generation_id OR v_row.product_type IS DISTINCT FROM p_product_type
      OR v_row.payment_intent_id IS DISTINCT FROM p_payment_intent_id OR v_row.amount_cents IS DISTINCT FROM p_amount_cents
      OR v_row.user_email IS DISTINCT FROM p_user_email OR v_row.promotion_code IS DISTINCT FROM v_code
      OR v_row.discount_cents IS DISTINCT FROM p_discount_cents
    THEN RAISE EXCEPTION 'purchase_replay_mismatch'; END IF;
    RETURN jsonb_build_object('entitlementId',v_row.id,'productType',v_row.product_type,'idempotent',true,
      'revisionId',p_revision_id,'atlasRevisionId',p_atlas_revision_id,'enticeRunId',v_row.entice_run_id);
  END IF;

  INSERT INTO public.designpro_purchase_entitlements
    (owner_id,entice_run_id,generation_id,product_type,amount_cents,user_email,
      checkout_session_id,payment_intent_id,promotion_code,discount_cents)
  VALUES (p_owner_id,p_entice_run_id,p_generation_id,p_product_type,p_amount_cents,p_user_email,
    p_checkout_session_id,p_payment_intent_id,v_code,p_discount_cents)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('entitlementId',v_row.id,'productType',v_row.product_type,'idempotent',false,
    'amountCents',v_row.amount_cents,'promotionCode',v_row.promotion_code,'discountCents',v_row.discount_cents,
    'revisionId',p_revision_id,'atlasRevisionId',p_atlas_revision_id,'enticeRunId',v_row.entice_run_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.confirm_designpro_revision_purchase(text,text,text,uuid,integer,text,text,integer,uuid,uuid,text,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.confirm_designpro_revision_purchase(text,text,text,uuid,integer,text,text,integer,uuid,uuid,text,uuid,uuid)
  TO service_role;
