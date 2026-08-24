-- Promotion codes on the production pack, and recording what was actually paid.
--
-- Two things drove this. Affiliates need working discount codes, and a
-- fully-discounted code is also how the owner runs the pipeline end to end
-- without paying -- one mechanism rather than a test-only back door that would
-- have to be trusted not to leak into production.
--
-- The codes themselves live in Stripe, as Coupon + Promotion Code objects. There
-- is no discount engine here and no second source of pricing truth: the checkout
-- session sets allow_promotion_codes, Stripe applies the discount, and the
-- webhook reports what was genuinely charged. This table only records the
-- outcome.
--
-- Two columns are added. promotion_code is the code Stripe reports as applied,
-- and discount_cents is what it took off. amount_cents relaxes from > 0 to >= 0,
-- because a fully-discounted order is a real, completed, zero-value purchase --
-- but ONLY when a promotion code is present. A zero row with no code is still
-- refused, so "free" cannot become the default through an absent amount or a
-- webhook that lost its total.

ALTER TABLE public.designpro_purchase_entitlements
  ADD COLUMN IF NOT EXISTS promotion_code text,
  ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.designpro_purchase_entitlements
  DROP CONSTRAINT IF EXISTS designpro_purchase_entitlements_amount_cents_check;

ALTER TABLE public.designpro_purchase_entitlements
  DROP CONSTRAINT IF EXISTS designpro_purchase_amount_contract;
ALTER TABLE public.designpro_purchase_entitlements
  ADD CONSTRAINT designpro_purchase_amount_contract CHECK (
    amount_cents >= 0
    AND discount_cents >= 0
    AND (promotion_code IS NULL OR pg_catalog.btrim(promotion_code) <> '')
    -- A free order has to name the code that made it free.
    AND (amount_cents > 0 OR promotion_code IS NOT NULL)
    -- A discount without a code, or a code that took nothing off, is a
    -- half-recorded transaction rather than a cheaper one.
    AND (discount_cents = 0) = (promotion_code IS NULL)
  );

-- The 20260818210000 body verbatim, with the promotion columns carried through
-- and returned. Same service-role fence, same checkout-session idempotency, same
-- completed-entice-run requirement.
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, extensions AS $$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_row public.designpro_purchase_entitlements%ROWTYPE;
  v_code text;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  v_code := NULLIF(pg_catalog.btrim(COALESCE(p_promotion_code,'')),'');

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
     checkout_session_id, payment_intent_id, promotion_code, discount_cents)
  VALUES
    (v_run.owner_id, v_run.id, p_generation_id, p_product_type, p_amount_cents, p_user_email,
     p_checkout_session_id, p_payment_intent_id, v_code, GREATEST(COALESCE(p_discount_cents,0),0))
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'entitlementId', v_row.id, 'productType', v_row.product_type, 'idempotent', false,
    'amountCents', v_row.amount_cents, 'promotionCode', v_row.promotion_code,
    'discountCents', v_row.discount_cents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_designpro_purchase(text,text,text,uuid,integer,text,text,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.confirm_designpro_purchase(text,text,text,uuid,integer,text,text,integer)
  TO service_role;
