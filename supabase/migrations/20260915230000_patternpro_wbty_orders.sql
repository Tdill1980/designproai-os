-- PATTERNPRO ORDERS — the paid path's table
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-09-15: "Go" on PatternPro phase 2 after the library shipped.
-- A PatternPro order is paid through Stripe Checkout (create-wbty-checkout
-- inserts a 'pending' row and opens the session; wbty-stripe-webhook flips it
-- to 'paid' on checkout.session.completed, then to 'fulfillment_emailed' once
-- the print order has gone to WePrintWraps). ShopFlow (#416) already reads
-- these rows as PP-XXXXXXXX references; until now the table did not exist on
-- this project, so that read returned nothing.
--
-- Same shape as the source system's table, captured from its live schema
-- (the table predates its migration history there). Idempotent.

CREATE TABLE IF NOT EXISTS public.wbty_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text,
  shipping_address text,
  order_type text NOT NULL,
  pattern_id uuid REFERENCES public.wbty_products(id) ON DELETE SET NULL,
  pattern_name text NOT NULL,
  pattern_category text,
  pattern_media_url text,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  vehicle_size text,
  finish text,
  yards integer,
  retail_price_cents integer NOT NULL,
  wholesale_cost_cents integer,
  margin_cents integer,
  render_url text,
  additional_views jsonb,
  stripe_session_id text UNIQUE,
  stripe_payment_intent_id text,
  stripe_payment_status text,
  status text NOT NULL DEFAULT 'pending',
  fulfillment_emailed_at timestamptz,
  shipped_at timestamptz,
  tracking_carrier text,
  tracking_number text,
  notes text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT wbty_orders_order_type_check
    CHECK (order_type = ANY (ARRAY['printed_wrap'::text, 'design_file'::text])),
  -- The stage table (shopflow-stages.ts) maps every one of these; add a
  -- status here and there together or ShopFlow shows the order with no stage.
  CONSTRAINT wbty_orders_status_check
    CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'fulfillment_emailed'::text,
                               'in_production'::text, 'shipped'::text, 'delivered'::text,
                               'refunded'::text, 'cancelled'::text]))
);

CREATE INDEX IF NOT EXISTS idx_wbty_orders_created_at ON public.wbty_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wbty_orders_customer_email ON public.wbty_orders (customer_email);
CREATE INDEX IF NOT EXISTS idx_wbty_orders_status ON public.wbty_orders (status);

DROP TRIGGER IF EXISTS wbty_orders_set_updated_at ON public.wbty_orders;
CREATE TRIGGER wbty_orders_set_updated_at
  BEFORE UPDATE ON public.wbty_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.wbty_orders ENABLE ROW LEVEL SECURITY;

-- The edge functions write with the service role (bypasses RLS). A signed-in
-- customer sees their own orders by email; admins manage them from
-- /admin/wbty-orders. Guests never read this table directly — the ShopFlow
-- guest door goes through wpw-shopflow, which holds its own email proof.
DROP POLICY IF EXISTS wbty_orders_customer_read_own ON public.wbty_orders;
CREATE POLICY wbty_orders_customer_read_own ON public.wbty_orders
  FOR SELECT TO authenticated
  USING (customer_email = (SELECT email FROM auth.users WHERE id = (SELECT auth.uid())));
DROP POLICY IF EXISTS wbty_orders_admin_all ON public.wbty_orders;
CREATE POLICY wbty_orders_admin_all ON public.wbty_orders
  FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role));

GRANT SELECT, UPDATE ON public.wbty_orders TO authenticated;
GRANT ALL ON public.wbty_orders TO service_role;
