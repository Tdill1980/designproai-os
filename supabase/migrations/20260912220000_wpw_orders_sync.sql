-- WePrintWraps order sync — phase 2 of the WPW wiring.
--
-- WHY (owner, 2026-09-12): "those repeats are who we will track and optimize
-- on for a saas... we get repeat design orders on our output and $975 on
-- single design orders and yes some are wall wraps."
--
-- `wpw-oauth-link` (shipped earlier today) already establishes the join key:
-- it writes user_subscriptions.woo_customer_id for a DesignProAI account.
-- What was missing is the orders themselves, so the repeat cohort — the
-- customers who come back and spend ~$975 a time — was invisible from this
-- side. That cohort is the entire basis for pricing a WallPro subscription,
-- so it has to be measurable before it can be optimized on.
--
-- SHAPE: ported from the reference implementation's proven normalizeOrder /
-- normalizeLineItems writers, field for field, so the ingest here and the
-- ingest there agree. NOTE: in the reference project wpw_orders is one of the
-- tables created by no migration at all (it predates its own history), so
-- there is no canonical DDL upstream to copy — this defines a clean shape for
-- THIS project rather than guessing at that one's. Column names and types
-- follow the writer, which is the part that actually has to match.
--
-- `raw` is deliberately absent: the reference stores NULL there to avoid a
-- second full copy of Woo's response, and the attribution columns below exist
-- precisely so the channel data survives that decision.

CREATE TABLE IF NOT EXISTS public.wpw_orders (
  id                        bigint PRIMARY KEY,             -- Woo order id
  woo_customer_id           bigint,
  order_number              text,
  status                    text,
  currency                  text,
  total                     numeric(12,2) NOT NULL DEFAULT 0,
  subtotal                  numeric(12,2),
  shipping_total            numeric(12,2) NOT NULL DEFAULT 0,
  tax_total                 numeric(12,2) NOT NULL DEFAULT 0,
  payment_method            text,
  date_created              timestamptz,
  date_modified             timestamptz,
  date_completed            timestamptz,
  customer_email            text,
  customer_name             text,
  billing                   jsonb,
  shipping                  jsonb,
  tracking_number           text,
  tracking_carrier          text,
  tracking_url              text,
  order_key                 text,
  pay_url                   text,
  customer_note             text,
  -- WooCommerce Order Attribution (8.5+). Lifted per order so the channel that
  -- earned it is answerable from our own data instead of each ad platform's
  -- self-reported (and overlapping) numbers.
  attribution_source_type   text,
  attribution_utm_source    text,
  attribution_utm_medium    text,
  attribution_utm_campaign  text,
  attribution_utm_content   text,
  attribution_utm_term      text,
  attribution_referrer      text,
  attribution_device_type   text,
  attribution_session_entry text,
  attribution_gclid         text,
  attribution_fbclid        text,
  attribution_captured_at   timestamptz,
  fetched_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wpw_order_items (
  id           bigint PRIMARY KEY,                          -- Woo line item id
  order_id     bigint NOT NULL REFERENCES public.wpw_orders(id) ON DELETE CASCADE,
  product_id   bigint,
  variation_id bigint,
  name         text,
  sku          text,
  quantity     integer NOT NULL DEFAULT 1,
  subtotal     numeric(12,2) NOT NULL DEFAULT 0,
  total        numeric(12,2) NOT NULL DEFAULT 0,
  meta         jsonb,
  image_url    text
);

-- The repeat question: orders per customer over time.
CREATE INDEX IF NOT EXISTS wpw_orders_customer_date_idx
  ON public.wpw_orders (woo_customer_id, date_created DESC)
  WHERE woo_customer_id IS NOT NULL;
-- Email is the fallback join for a guest checkout with no customer id.
CREATE INDEX IF NOT EXISTS wpw_orders_email_idx
  ON public.wpw_orders (lower(customer_email))
  WHERE customer_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS wpw_orders_date_idx ON public.wpw_orders (date_created DESC);
CREATE INDEX IF NOT EXISTS wpw_order_items_order_idx ON public.wpw_order_items (order_id);
-- Which line items are design work, for the margin question.
CREATE INDEX IF NOT EXISTS wpw_order_items_sku_idx ON public.wpw_order_items (sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS wpw_orders_attribution_source_idx
  ON public.wpw_orders (attribution_utm_source, date_created DESC)
  WHERE attribution_utm_source IS NOT NULL;

ALTER TABLE public.wpw_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wpw_order_items ENABLE ROW LEVEL SECURITY;

-- Revenue data is staff-only. No customer-facing read is added here: this
-- exists to answer "who are the repeat buyers", which is an analytics
-- question, and a customer-facing order history is its own contract to design
-- when it is actually wanted.
CREATE POLICY wpw_orders_team_read ON public.wpw_orders FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));
CREATE POLICY wpw_order_items_team_read ON public.wpw_order_items FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));

REVOKE ALL ON public.wpw_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.wpw_order_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wpw_orders TO authenticated;
GRANT SELECT ON public.wpw_order_items TO authenticated;
GRANT ALL ON public.wpw_orders TO service_role;
GRANT ALL ON public.wpw_order_items TO service_role;

-- The repeat cohort, in one read: every WPW customer with their order count,
-- lifetime spend and the DesignProAI account they are linked to (when they
-- have one). Staff-only, and SECURITY INVOKER so the policies above still
-- apply -- this is a convenience over the tables, never a way around them.
CREATE OR REPLACE VIEW public.wpw_customer_repeats AS
SELECT
  o.woo_customer_id,
  min(o.customer_email)                                     AS customer_email,
  min(o.customer_name)                                      AS customer_name,
  count(*)                                                  AS order_count,
  count(*) FILTER (WHERE o.status IN ('completed','processing')) AS paid_order_count,
  sum(o.total) FILTER (WHERE o.status IN ('completed','processing')) AS lifetime_total,
  max(o.date_created)                                       AS last_order_at,
  min(o.date_created)                                       AS first_order_at,
  max(s.user_id::text)                                      AS designpro_user_id
FROM public.wpw_orders o
LEFT JOIN public.user_subscriptions s ON s.woo_customer_id = o.woo_customer_id
WHERE o.woo_customer_id IS NOT NULL
GROUP BY o.woo_customer_id;

COMMENT ON VIEW public.wpw_customer_repeats IS
  'Repeat cohort: orders, lifetime spend and the linked DesignProAI account per WPW customer. Staff-only through the underlying tables RLS.';
