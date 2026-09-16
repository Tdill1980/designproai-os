-- A PAID WALLPRO DESIGN GETS A REAL ORDER NUMBER.
--
-- Owner, 2026-09-16: "once they pay they must get an order number", then a
-- correction sending this session to the reference implementation RULE 1 names.
--
-- THE GATE WAS PORTED. request_wallpro_production (20260912130000) already
-- refuses to queue a production job without a paid entitlement on that exact
-- version. What was never ported is the NUMBERING, and the owner was right to
-- send this session back: a first attempt derived an order number from the
-- entitlement's uuid and recorded in its own comment that no counterpart
-- existed. That claim was false. It came from searching THIS repository for a
-- minting pattern instead of the reference, which is the exact inversion RULE 1
-- exists to prevent.
--
-- RECOVERED, NOT INVENTED. The proven implementation is CreatorMarket's, in the
-- reference repository at
-- supabase/migrations/20260819120000_creatormarket_standalone_pipeline.sql:
--
--     create sequence public.cm_order_number_seq start with 1001;
--     create function public.cm_next_order_number() returns text language sql
--       volatile as $$ select 'CM-' || lpad(nextval(...)::text, 6, '0') $$;
--     order_number text not null unique default public.cm_next_order_number(),
--
-- Ported here verbatim in shape, with WPO- for the prefix and WallPro's own
-- sequence. Its header states the reason this is a sequence of its own and not
-- a shared one, and that reason holds identically for WallPro: "CreatorMarket
-- issues its own order numbers. GENIE issues DesignProAI's; this pipeline must
-- not depend on it."
--
-- WHY THIS BEATS THE DERIVED FORM IT REPLACES. WPO-001001 is a number a
-- customer can read down a phone and a person can type from memory; WPO-3F8A21C4
-- is a hash they will mis-transcribe. It is sequential, so counting orders is
-- reading the last one rather than counting rows. It is a stored UNIQUE column,
-- so the database guarantees what a derived string only assumed. The one thing
-- the derived form had — no migration — is worth less than any of those.
--
-- EXISTING PURCHASES ARE NUMBERED BY THIS MIGRATION, not left null. The default
-- is volatile, so adding the column evaluates nextval() once per existing row:
-- every purchase already taken comes out with its own sequential number, in
-- payment order (see the ordered backfill below — the column default alone does
-- not promise row order, and an order number that does not follow time would be
-- a worse artifact than none).

-- ── The sequence and its minter ──────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.wallpro_order_number_seq START WITH 1001;

CREATE OR REPLACE FUNCTION public.wallpro_next_order_number()
RETURNS text LANGUAGE sql VOLATILE SET search_path = pg_catalog, public AS $$
  SELECT 'WPO-' || lpad(nextval('public.wallpro_order_number_seq')::text, 6, '0');
$$;
REVOKE ALL ON FUNCTION public.wallpro_next_order_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallpro_next_order_number() TO service_role;

-- ── The column ───────────────────────────────────────────────────────────
-- Added nullable first, backfilled IN PAYMENT ORDER, then made NOT NULL. The
-- shorter route (one ALTER carrying the default) numbers existing rows in
-- whatever order the rewrite happens to visit them, which for an order number
-- is the one property that must not be arbitrary.
ALTER TABLE public.wallpro_purchase_entitlements
  ADD COLUMN IF NOT EXISTS order_number text;

DO $backfill$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.wallpro_purchase_entitlements
     WHERE order_number IS NULL
     ORDER BY paid_at, id
  LOOP
    UPDATE public.wallpro_purchase_entitlements
       SET order_number = public.wallpro_next_order_number()
     WHERE id = r.id;
  END LOOP;
END
$backfill$;

ALTER TABLE public.wallpro_purchase_entitlements
  ALTER COLUMN order_number SET DEFAULT public.wallpro_next_order_number();
ALTER TABLE public.wallpro_purchase_entitlements
  ALTER COLUMN order_number SET NOT NULL;

DO $uniq$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'wallpro_entitlement_order_number_key'
       AND conrelid = 'public.wallpro_purchase_entitlements'::regclass
  ) THEN
    ALTER TABLE public.wallpro_purchase_entitlements
      ADD CONSTRAINT wallpro_entitlement_order_number_key UNIQUE (order_number);
  END IF;
END
$uniq$;

COMMENT ON COLUMN public.wallpro_purchase_entitlements.order_number IS
  'WPO-nnnnnn, minted by wallpro_next_order_number(). The number the customer is given at payment and the team searches WallPanelProStudio by. Ported from the CreatorMarket cm_next_order_number sequence in the reference implementation.';

-- ── The payment confirmation returns it ──────────────────────────────────
-- The webhook is what tells the customer they paid, so it is what must hand
-- back the number. Re-created rather than text-patched: this function has ONE
-- source (20260912130000) and no later migration has patched its body, which
-- is the same test that migration applied to itself before replacing
-- request_wallpro_production wholesale.
CREATE OR REPLACE FUNCTION public.confirm_wallpro_purchase(
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_product_type text,
  p_version_id uuid,
  p_amount_cents integer,
  p_user_email text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE
  v_version public.wallpro_design_versions%ROWTYPE;
  v_row public.wallpro_purchase_entitlements%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  SELECT * INTO v_row FROM public.wallpro_purchase_entitlements
   WHERE checkout_session_id = p_checkout_session_id;
  IF v_row.id IS NOT NULL THEN
    -- A Stripe retry returns the SAME order number. A second number for one
    -- payment is how a customer ends up quoting one the team cannot reconcile.
    RETURN jsonb_build_object('entitlementId', v_row.id, 'productType', v_row.product_type,
                              'orderNumber', v_row.order_number, 'idempotent', true);
  END IF;

  SELECT * INTO v_version FROM public.wallpro_design_versions WHERE id = p_version_id;
  IF v_version.id IS NULL THEN RAISE EXCEPTION 'wallpro_version_not_found'; END IF;

  INSERT INTO public.wallpro_purchase_entitlements
    (owner_id, project_id, version_id, product_type, amount_cents, user_email,
     checkout_session_id, payment_intent_id)
  VALUES
    (v_version.owner_id, v_version.project_id, v_version.id, p_product_type, p_amount_cents, p_user_email,
     p_checkout_session_id, p_payment_intent_id)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('entitlementId', v_row.id, 'productType', v_row.product_type,
                            'orderNumber', v_row.order_number, 'idempotent', false);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_wallpro_purchase(text, text, text, uuid, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_wallpro_purchase(text, text, text, uuid, integer, text) TO service_role;
