-- WallPro purchase entitlements — SKU-based, not one hard-coded price.
--
-- Owner ruling (2026-09-12): the $199-flat / full-credit-toward-print design
-- was rejected on the numbers. Real print price is $3.50/sq ft, not $6-7: an
-- 80 sq ft wall prints for $280, so crediting a full $199 design fee against
-- it collects only $81 more — the WallPro design/file work is effectively
-- given away on anything but a large commercial wall. The replacement is a
-- price ladder by how much original work each path actually took (a catalog
-- pick vs. a from-scratch room design), no hard-coded credit mechanism (that
-- becomes its own configurable thing once there is real purchase data), and
-- a SKU column so the price list can change without touching this schema.
--
-- Same Stripe touchpoint as the vehicle side (the gateway process, one
-- account, one webhook) — but its own table, not designpro_purchase_
-- entitlements, which is welded to designpro_workflow_runs (the vehicle
-- workflow-run graph). WallPro has no workflow-run graph; forcing it through
-- that table would force it into that graph. This entitlement is keyed to
-- the two identities WallPro actually has: wallpro_projects and
-- wallpro_design_versions.
--
-- Phase 1 (first paid path, per owner direction): wire wallpro_custom_file
-- ($149) alone, prove one real exported file end to end, then expose the
-- rest. All four SKUs are declared here now so the schema never needs to
-- change to add them — only the checkout price table and the frontend do.
CREATE TABLE public.wallpro_purchase_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.wallpro_projects(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.wallpro_design_versions(id) ON DELETE CASCADE,
  product_type text NOT NULL CHECK (product_type IN (
    'wallpro_catalog_file', 'wallpro_custom_file', 'wallpro_room_design_file', 'wallpro_file_prep'
  )),
  -- Cents, as Stripe reported them on the verified webhook event, never the
  -- checkout request's own metadata — the same discipline designpro_purchase_
  -- entitlements uses, so a later price change can't rewrite an old purchase.
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd',
  user_email text,
  checkout_session_id text NOT NULL,
  payment_intent_id text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The Stripe session is the transaction identity: a redelivered webhook lands
-- on this constraint instead of buying the same thing twice.
CREATE UNIQUE INDEX wallpro_entitlement_session_uidx
  ON public.wallpro_purchase_entitlements(checkout_session_id);
-- One paid entitlement per exact deliverable. A refinement mints a new
-- version_id, which is a new deliverable and a new purchase — that is a
-- product decision to revisit with real data, not a bug to design around here.
CREATE UNIQUE INDEX wallpro_entitlement_version_product_uidx
  ON public.wallpro_purchase_entitlements(version_id, product_type);
CREATE INDEX wallpro_entitlement_owner_idx
  ON public.wallpro_purchase_entitlements(owner_id, project_id);

ALTER TABLE public.wallpro_purchase_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallpro_entitlement_owner_read ON public.wallpro_purchase_entitlements
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
-- Design-team visibility, same shape as wallpro_team_read_projects/_versions.
CREATE POLICY wallpro_entitlement_team_read ON public.wallpro_purchase_entitlements
  FOR SELECT TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::app_role) OR has_role((SELECT auth.uid()), 'tester'::app_role));
-- An entitlement a browser can insert is a claim, not a payment.
REVOKE ALL ON public.wallpro_purchase_entitlements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wallpro_purchase_entitlements TO authenticated;
GRANT ALL ON public.wallpro_purchase_entitlements TO service_role;

-- Record a verified payment. That is the whole of it — no pipeline runs from
-- here, matching confirm_designpro_purchase's own reasoning: Stripe never
-- becomes the production engine.
CREATE FUNCTION public.confirm_wallpro_purchase(
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
    RETURN jsonb_build_object('entitlementId', v_row.id, 'productType', v_row.product_type, 'idempotent', true);
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

  RETURN jsonb_build_object('entitlementId', v_row.id, 'productType', v_row.product_type, 'idempotent', false);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_wallpro_purchase(text, text, text, uuid, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_wallpro_purchase(text, text, text, uuid, integer, text) TO service_role;

-- THE GATE. Production export is paid work: request_wallpro_production now
-- requires a paid entitlement on this exact version before it queues a job.
-- Full prior body preserved, re-created rather than text-patched (this
-- function has one source, so CREATE OR REPLACE is safe here, unlike a body
-- that has already been string-patched across migrations).
CREATE OR REPLACE FUNCTION public.request_wallpro_production(p_version_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.wallpro_design_versions; j public.wallpro_production_jobs; h text; w numeric; ht numeric; ppi numeric; pw numeric;
BEGIN
  SELECT * INTO v FROM public.wallpro_design_versions WHERE id=p_version_id;
  IF NOT FOUND OR v.owner_id<>(SELECT auth.uid()) THEN RAISE EXCEPTION 'wallpro_version_not_found'; END IF;
  IF v.status<>'approved' THEN RAISE EXCEPTION 'wallpro_version_not_approved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wallpro_purchase_entitlements WHERE version_id=p_version_id) THEN
    RAISE EXCEPTION 'wallpro_entitlement_required';
  END IF;
  IF jsonb_typeof(p_request)<>'object' THEN RAISE EXCEPTION 'wallpro_production_request_invalid'; END IF;
  w:=(p_request->>'wallWidthIn')::numeric; ht:=(p_request->>'wallHeightIn')::numeric;
  ppi:=COALESCE((p_request->>'targetPpi')::numeric,150); pw:=COALESCE((p_request->>'panelWidthIn')::numeric,59.5);
  IF w IS NULL OR ht IS NULL OR w<1 OR w>2400 OR ht<1 OR ht>2400 OR ppi<72 OR ppi>600 OR pw<1 OR pw>2400
     OR COALESCE((p_request->>'bleedIn')::numeric,1) NOT BETWEEN 0 AND 5 OR COALESCE((p_request->>'overlapIn')::numeric,0.5) NOT BETWEEN 0 AND 5
     OR COALESCE(p_request->>'placement',v.placement) NOT IN ('cover','contain','repeat') THEN
    RAISE EXCEPTION 'wallpro_production_request_invalid';
  END IF;
  h:=encode(extensions.digest(convert_to(p_request::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO j FROM public.wallpro_production_jobs WHERE version_id=p_version_id AND request_hash=h AND status IN ('queued','running','ready') LIMIT 1;
  IF FOUND THEN RETURN to_jsonb(j); END IF;
  INSERT INTO public.wallpro_production_jobs(owner_id,project_id,version_id,request,request_hash)
  VALUES (v.owner_id,v.project_id,v.id,p_request,h) RETURNING * INTO j;
  RETURN to_jsonb(j);
END; $$;
REVOKE ALL ON FUNCTION public.request_wallpro_production(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_wallpro_production(uuid,jsonb) TO authenticated,service_role;
