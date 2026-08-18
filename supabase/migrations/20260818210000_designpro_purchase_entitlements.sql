-- PURCHASE ENTITLEMENTS — what the customer actually paid for.
--
-- Calls 1-11 run automatically and cost little: they exist so the customer can
-- SEE what they would be buying. Everything after them is expensive and is not
-- authorized by the existence of a preview. Until this table says a product was
-- paid for, no upscale, no output build, no ZIP, no delivery.
--
-- TWO PRODUCTS, NEVER ONE. The Production Pack ($299) authorizes the branded
-- panel set through Topaz, PanelPro QC, PNG/TIFF output, the DesignID stamp,
-- the ZIP and WrapBox. The Logo Pack ($29) authorizes the separated logo and
-- lettering assets through Topaz and QC into their own delivery. Buying either
-- must never authorize the other -- a customer who paid $29 for logos has not
-- bought $299 of production files, and the reverse is equally wrong.
--
-- Buying both is allowed and is not a third product: two rows, one fulfillment
-- cycle may process both, and each keeps its own identity so the delivery can
-- say what was paid for.

CREATE TABLE IF NOT EXISTS public.designpro_purchase_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The entice run whose prepared pack was bought. Production is created from
  -- this run, so the purchase and the artifacts it pays for cannot drift.
  entice_run_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  -- 'production_pack' | 'logo_pack'. Constrained rather than free text: a typo
  -- would silently create a third product nothing fulfills.
  product text NOT NULL CHECK (product IN ('production_pack','logo_pack')),
  -- Cents, as charged. Recorded from the session rather than assumed, so a
  -- price change cannot rewrite what an old purchase says it cost.
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd',
  checkout_session_id text NOT NULL,
  payment_intent_id text,
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','paid','refunded','cancelled')),
  paid_at timestamptz,
  -- The production run this purchase authorized, once it has one. Null until
  -- payment confirms; that is the whole gate.
  production_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One purchase per product per prepared pack. A duplicated webhook, a double
-- click, or a retried session cannot buy the same thing twice.
CREATE UNIQUE INDEX IF NOT EXISTS designpro_entitlement_run_product_uidx
  ON public.designpro_purchase_entitlements(entice_run_id, product)
  WHERE status IN ('pending_payment','paid');
CREATE UNIQUE INDEX IF NOT EXISTS designpro_entitlement_session_uidx
  ON public.designpro_purchase_entitlements(checkout_session_id);
CREATE INDEX IF NOT EXISTS designpro_entitlement_owner_idx
  ON public.designpro_purchase_entitlements(owner_id, generation_id);

ALTER TABLE public.designpro_purchase_entitlements ENABLE ROW LEVEL SECURITY;

-- The customer may read what they bought. They may never write it: an
-- entitlement a browser can insert is not a payment, it is a claim.
DROP POLICY IF EXISTS designpro_owner_read_entitlements ON public.designpro_purchase_entitlements;
CREATE POLICY designpro_owner_read_entitlements
  ON public.designpro_purchase_entitlements FOR SELECT TO authenticated
  USING (owner_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.designpro_purchase_entitlements FROM authenticated, anon;

/**
 * Open a purchase. Records the intent only -- status stays pending_payment and
 * nothing downstream moves until the webhook confirms it.
 */
CREATE OR REPLACE FUNCTION public.open_designpro_purchase(
  p_entice_run_id uuid,
  p_product text,
  p_amount_cents integer,
  p_checkout_session_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, extensions AS $$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_row public.designpro_purchase_entitlements%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id = p_entice_run_id;
  IF v_run.id IS NULL THEN RAISE EXCEPTION 'entice_run_not_found'; END IF;

  -- A pack that has not finished preparing has nothing to sell. The customer is
  -- buying the six panels they can see, so they must exist first.
  IF NOT EXISTS (
    SELECT 1 FROM public.designpro_workflow_stages s
    WHERE s.run_id = p_entice_run_id AND s.stage_key = 'pack.activate' AND s.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'prepared_pack_not_ready';
  END IF;

  INSERT INTO public.designpro_purchase_entitlements
    (owner_id, entice_run_id, generation_id, product, amount_cents, checkout_session_id)
  VALUES
    (v_run.owner_id, p_entice_run_id, v_run.generation_id, p_product, p_amount_cents, p_checkout_session_id)
  ON CONFLICT (checkout_session_id) DO UPDATE SET updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('entitlementId', v_row.id, 'product', v_row.product, 'status', v_row.status);
END;
$$;

/**
 * Confirm payment and authorize exactly what was bought.
 *
 * The production workflow is created HERE and only here, by the same
 * create_designpro_production_workflow the automatic path used -- the
 * downstream conductor is unchanged, only its start condition moved from
 * "preparation finished" to "the customer paid". Buying both products in
 * either order reuses the one production run rather than opening a second
 * fulfillment chain, while each entitlement keeps its own row and its own
 * identity in the delivery.
 */
CREATE OR REPLACE FUNCTION public.confirm_designpro_purchase(
  p_checkout_session_id text,
  p_payment_intent_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, extensions AS $$
DECLARE
  v_row public.designpro_purchase_entitlements%ROWTYPE;
  v_existing uuid;
  v_result jsonb;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  SELECT * INTO v_row FROM public.designpro_purchase_entitlements
   WHERE checkout_session_id = p_checkout_session_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'entitlement_not_found'; END IF;

  -- Idempotent: Stripe redelivers, and a second delivery must not open a
  -- second production run or re-stamp a paid_at that is already true.
  IF v_row.status = 'paid' THEN
    RETURN jsonb_build_object('entitlementId', v_row.id, 'product', v_row.product,
                              'status', 'paid', 'productionRunId', v_row.production_run_id,
                              'idempotent', true);
  END IF;

  -- Another product on this same pack may already have opened production. Reuse
  -- it: one fulfillment cycle can carry both purchases, and a second run would
  -- be a duplicate chain over identical artifacts.
  SELECT production_run_id INTO v_existing
    FROM public.designpro_purchase_entitlements
   WHERE entice_run_id = v_row.entice_run_id AND status = 'paid' AND production_run_id IS NOT NULL
   LIMIT 1;

  IF v_existing IS NULL THEN
    v_result := public.create_designpro_production_workflow(
      v_row.entice_run_id,
      'paid-production:' || v_row.entice_run_id::text,
      jsonb_build_object('trigger', 'designpro.purchase.confirmed')
    );
    v_existing := (v_result->>'workflowRunId')::uuid;
  END IF;

  UPDATE public.designpro_purchase_entitlements
     SET status = 'paid', paid_at = now(), payment_intent_id = p_payment_intent_id,
         production_run_id = v_existing, updated_at = now()
   WHERE id = v_row.id;

  RETURN jsonb_build_object('entitlementId', v_row.id, 'product', v_row.product,
                            'status', 'paid', 'productionRunId', v_existing, 'idempotent', false);
END;
$$;

/** What this run has been paid for. Read by the runtime before it spends. */
CREATE OR REPLACE FUNCTION public.designpro_paid_products(p_entice_run_id uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public, extensions AS $$
  SELECT COALESCE(array_agg(product ORDER BY product), ARRAY[]::text[])
    FROM public.designpro_purchase_entitlements
   WHERE entice_run_id = p_entice_run_id AND status = 'paid';
$$;

REVOKE ALL ON FUNCTION public.open_designpro_purchase(uuid, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_designpro_purchase(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.designpro_paid_products(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.open_designpro_purchase(uuid, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_designpro_purchase(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.designpro_paid_products(uuid) TO service_role;
