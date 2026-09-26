-- ═══════════════════════════════════════════════════════════════════════════
-- DESIGNPRO DESIGN ARCHIVE: one row per design, bound to its orders, with
-- every file, prompt and version reachable by year / customer / vehicle / order.
-- (owner, 2026-09-25: "how our system saves directly messes up our software and
-- makes it not an OS; that's how it saves and how it's searchable")
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT WAS MEASURED (designproai-os-prod, read-only, 2026-09-25):
--   * 248 generation requests, 122 flat-atlas revisions, 0 revision requests.
--   * `orderNumber` in 11 request inputs, all canaries. Real WPW orders exist
--     only as free text in designName ("WPW real-order test #30292").
--   * No design / order / year index. `designpro_generation_library` pages by
--     time only. No 2025 rows exist (DP data starts 2026-08-14).
--
-- WHAT THIS ADDS -- AN INDEX, NOT A SECOND STORE.
--   designpro_designs         one row per design (DesignID = DID-<8 hex of the
--                             GenerationID>, the id the runtime already mints:
--                             runtime/generation-worker.cjs generationIdentity)
--   designpro_design_orders   append-only design <-> order bindings (Woo,
--                             Stripe, intake, manual), many-to-many
--   designpro_design_files    VIEW: every stored file of a design
--   designpro_design_prompts  VIEW: every prompt (brief, revision instruction,
--                             per-view regeneration note), in order
--   designpro_design_search() keyset-paged library search
--   designpro_design_history() versions + prompts + files + orders, one call
--
-- WHAT IT DOES NOT TOUCH. No existing column, constraint, policy or function
-- body changes. Rows land through AFTER triggers that CANNOT fail the write
-- that fired them (every trigger body catches and RAISEs WARNING): a broken
-- archive must never cost a customer a generation.
--
-- LATER HOOKS (designed now, not built): `template_ref` (the vector template in
-- Dropbox by year/make/model) and `production_assets` kinds for upscaled and
-- vectorized layers are reserved below so the Topaz / vector / template nodes
-- plug in without another schema change to this table.

CREATE TABLE public.designpro_designs (
  design_id text PRIMARY KEY CHECK (design_id ~ '^DID-[0-9A-F]{8}$'),
  generation_id uuid NOT NULL UNIQUE,
  owner_id uuid NOT NULL,
  tenant_key text,
  design_name text,
  company_name text,
  vehicle_year integer CHECK (vehicle_year IS NULL OR vehicle_year BETWEEN 1900 AND 2100),
  vehicle_make text,
  vehicle_model text,
  vehicle_type text,
  status text NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating','ready','failed','ordered','in_production','delivered','archived')),
  first_request_id uuid,
  current_request_id uuid,
  current_revision_id uuid,
  current_revision_sequence integer,
  -- Reserved: {provider:'dropbox', path, year, make, model, sha256, boundAt}.
  -- Nothing writes it yet; the later template-output node will.
  template_ref jsonb CHECK (template_ref IS NULL OR jsonb_typeof(template_ref) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The owner works in Phoenix time; "2026 designs" means her calendar year.
  created_year integer GENERATED ALWAYS AS
    (EXTRACT(YEAR FROM (created_at AT TIME ZONE 'America/Phoenix'))::integer) STORED,
  search_text tsvector GENERATED ALWAYS AS (to_tsvector('simple',
    coalesce(design_name,'') || ' ' || coalesce(company_name,'') || ' ' ||
    coalesce(vehicle_make,'') || ' ' || coalesce(vehicle_model,'') || ' ' ||
    coalesce(vehicle_year::text,'') || ' ' || design_id)) STORED
);

COMMENT ON TABLE public.designpro_designs IS
  'One row per DesignPro design (DesignID). An index over generation requests/revisions; bytes stay content-addressed in storage.';

-- Every index serves a named filter of designpro_design_search / the RLS
-- predicate (supabase-postgres-best-practices: query-composite-indexes,
-- security-rls-performance, advanced-full-text-search, data-pagination).
CREATE INDEX designpro_designs_owner_created_idx ON public.designpro_designs (owner_id, created_at DESC, design_id DESC);
CREATE INDEX designpro_designs_created_idx ON public.designpro_designs (created_at DESC, design_id DESC);
CREATE INDEX designpro_designs_year_idx ON public.designpro_designs (created_year, created_at DESC);
CREATE INDEX designpro_designs_vehicle_idx ON public.designpro_designs (lower(vehicle_make), lower(vehicle_model), vehicle_year);
CREATE INDEX designpro_designs_status_idx ON public.designpro_designs (status, created_at DESC);
CREATE INDEX designpro_designs_search_idx ON public.designpro_designs USING gin (search_text);

CREATE TABLE public.designpro_design_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  design_id text NOT NULL REFERENCES public.designpro_designs(design_id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('woocommerce','stripe','intake','manual')),
  -- Same vocabulary the gateway accepts for a Design Order Number
  -- (gateway/src/server.mjs ORDER_NUMBER_PATTERN), stored without a leading '#'.
  order_number text NOT NULL CHECK (order_number ~ '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'),
  woo_order_id bigint,
  line_item_id bigint,
  stripe_checkout_session_id text,
  bound_by uuid,
  bound_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (design_id, source, order_number)
);
COMMENT ON TABLE public.designpro_design_orders IS
  'Append-only design <-> order bindings. A design may have many orders and an order many designs.';
CREATE INDEX designpro_design_orders_order_idx ON public.designpro_design_orders (order_number);
CREATE INDEX designpro_design_orders_design_idx ON public.designpro_design_orders (design_id);
CREATE INDEX designpro_design_orders_woo_idx ON public.designpro_design_orders (woo_order_id) WHERE woo_order_id IS NOT NULL;

-- ── RLS: owner or design staff may read; nobody writes directly ──────────────
ALTER TABLE public.designpro_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designpro_design_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY designpro_designs_owner_or_staff_read ON public.designpro_designs
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id OR (SELECT designpro_private.caller_is_design_staff()));

CREATE POLICY designpro_design_orders_owner_or_staff_read ON public.designpro_design_orders
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.designpro_designs d
                 WHERE d.design_id = designpro_design_orders.design_id
                   AND (d.owner_id = (SELECT auth.uid()) OR (SELECT designpro_private.caller_is_design_staff()))));

REVOKE ALL ON public.designpro_designs, public.designpro_design_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.designpro_designs, public.designpro_design_orders TO authenticated;
GRANT ALL ON public.designpro_designs, public.designpro_design_orders TO service_role;

-- ── helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION designpro_private.design_id_for(p_generation_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT 'DID-' || upper(substr(replace(p_generation_id::text, '-', ''), 1, 8));
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.normalize_order_number(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT NULLIF(btrim(regexp_replace(btrim(coalesce(p_value, '')), '^#+\s*', '')), '');
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.design_status_for_request(p_state text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT CASE p_state WHEN 'outputs_ready' THEN 'ready'
    WHEN 'failed' THEN 'failed' WHEN 'cancelled' THEN 'failed' ELSE 'generating' END;
$fn$;

-- Upsert the design row for one request. Revisions share the GenerationID, so
-- they update the same design. Commercial states (ordered and later) are never
-- downgraded by a generation state.
CREATE OR REPLACE FUNCTION designpro_private.archive_upsert_request(p_request_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE r public.designpro_generation_requests%ROWTYPE; v_design text; v_year integer; v_order text;
BEGIN
  SELECT * INTO r FROM public.designpro_generation_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_design := designpro_private.design_id_for(r.generation_id);
  v_year := CASE WHEN (r.request_input #>> '{vehicle,year}') ~ '^\d{4}$'
    THEN (r.request_input #>> '{vehicle,year}')::integer END;
  INSERT INTO public.designpro_designs AS d (design_id, generation_id, owner_id, tenant_key, design_name,
    company_name, vehicle_year, vehicle_make, vehicle_model, vehicle_type, status,
    first_request_id, current_request_id, created_at, updated_at)
  VALUES (v_design, r.generation_id, r.owner_id, r.tenant_key,
    left(nullif(btrim(r.request_input->>'designName'), ''), 240),
    left(nullif(btrim(coalesce(r.request_input->>'companyName', r.request_input->>'businessName')), ''), 240),
    CASE WHEN v_year BETWEEN 1900 AND 2100 THEN v_year END,
    left(nullif(btrim(r.request_input #>> '{vehicle,make}'), ''), 80),
    left(nullif(btrim(r.request_input #>> '{vehicle,model}'), ''), 120),
    left(nullif(btrim(r.request_input #>> '{vehicle,type}'), ''), 40),
    designpro_private.design_status_for_request(r.state), r.id, r.id, r.created_at, now())
  ON CONFLICT (generation_id) DO UPDATE SET
    current_request_id = CASE WHEN d.current_request_id IS NULL
      OR r.created_at >= (SELECT q.created_at FROM public.designpro_generation_requests q WHERE q.id = d.current_request_id)
      THEN r.id ELSE d.current_request_id END,
    status = CASE WHEN d.status IN ('ordered','in_production','delivered','archived') THEN d.status
      ELSE designpro_private.design_status_for_request(r.state) END,
    updated_at = now();
  -- A v1 canary / legacy input that carried an order number binds it as 'intake'.
  v_order := designpro_private.normalize_order_number(r.request_input->>'orderNumber');
  IF v_order IS NOT NULL AND v_order ~ '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$' THEN
    INSERT INTO public.designpro_design_orders (design_id, source, order_number, bound_by)
    VALUES (v_design, 'intake', v_order, r.owner_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_design;
END
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.archive_on_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  BEGIN
    PERFORM designpro_private.archive_upsert_request(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'designpro archive: request % not indexed: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.archive_on_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  BEGIN
    UPDATE public.designpro_designs d SET current_revision_id = NEW.id,
      current_revision_sequence = NEW.revision_sequence, updated_at = now()
    WHERE d.generation_id = NEW.generation_id
      AND (d.current_revision_sequence IS NULL OR NEW.revision_sequence >= d.current_revision_sequence);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'designpro archive: revision % not indexed: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.archive_on_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  BEGIN
    UPDATE public.designpro_designs d SET status = 'ordered', updated_at = now()
    WHERE d.design_id = NEW.design_id AND d.status IN ('generating','ready','failed')
      -- An intake order number is a reference the customer typed, not a purchase.
      AND NEW.source <> 'intake';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'designpro archive: order % not reflected: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION designpro_private.archive_upsert_request(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION designpro_private.archive_on_request() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION designpro_private.archive_on_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION designpro_private.archive_on_order() FROM PUBLIC, anon, authenticated;

-- AFTER triggers only: they never change or block the row that fired them.
CREATE TRIGGER designpro_archive_request_ins
  AFTER INSERT ON public.designpro_generation_requests
  FOR EACH ROW EXECUTE FUNCTION designpro_private.archive_on_request();
CREATE TRIGGER designpro_archive_request_state
  AFTER UPDATE OF state ON public.designpro_generation_requests
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION designpro_private.archive_on_request();
CREATE TRIGGER designpro_archive_revision_ins
  AFTER INSERT ON public.designpro_flat_atlas_revisions
  FOR EACH ROW EXECUTE FUNCTION designpro_private.archive_on_revision();
CREATE TRIGGER designpro_archive_order_ins
  AFTER INSERT ON public.designpro_design_orders
  FOR EACH ROW EXECUTE FUNCTION designpro_private.archive_on_order();

-- ── files: every stored file of a design, one shape ──────────────────────────
-- security_invoker: the caller's own RLS on each source table applies, so the
-- view can never show a file its reader could not already read.
CREATE VIEW public.designpro_design_files WITH (security_invoker = true) AS
  SELECT d.design_id, d.generation_id, 'view'::text AS source, 'view'::text AS kind,
    v.source_view_type AS surface, r.revision_sequence, v.storage_path, v.content_hash,
    v.byte_size, v.content_type, NULL::integer AS width_px, NULL::integer AS height_px,
    v.created_at, v.superseded_at
  FROM public.designpro_generation_views v
  JOIN public.designpro_generation_requests r ON r.id = v.request_id
  JOIN public.designpro_designs d ON d.generation_id = r.generation_id
  UNION ALL
  SELECT d.design_id, d.generation_id, 'revision', f.kind, NULL, a.revision_sequence,
    f.storage_path, f.content_hash, f.byte_size, f.content_type,
    CASE WHEN f.kind = 'master' THEN a.width_px END, CASE WHEN f.kind = 'master' THEN a.height_px END,
    a.created_at, NULL::timestamptz
  FROM public.designpro_flat_atlas_revisions a
  JOIN public.designpro_designs d ON d.generation_id = a.generation_id
  CROSS JOIN LATERAL (VALUES
    ('master', a.master_storage_path, a.master_content_hash, a.master_byte_size, a.master_content_type),
    ('projection', a.projection_storage_path, a.projection_content_hash, a.projection_byte_size, a.projection_content_type),
    ('manifest', a.manifest_storage_path, a.manifest_content_hash, a.manifest_byte_size, a.manifest_content_type),
    ('guide', a.guide_storage_path, a.guide_content_hash, a.guide_byte_size, a.guide_content_type)
  ) AS f(kind, storage_path, content_hash, byte_size, content_type)
  WHERE f.storage_path IS NOT NULL
  UNION ALL
  SELECT d.design_id, d.generation_id, 'artifact', x.artifact_kind, x.surface_key, NULL,
    x.storage_path, x.content_hash, x.byte_size, x.metadata->>'contentType',
    CASE WHEN (x.metadata->>'widthPx') ~ '^\d+$' THEN (x.metadata->>'widthPx')::integer END,
    CASE WHEN (x.metadata->>'heightPx') ~ '^\d+$' THEN (x.metadata->>'heightPx')::integer END,
    x.created_at, NULL::timestamptz
  FROM public.designpro_artifacts x
  JOIN public.designpro_workflow_runs w ON w.id = x.run_id
  JOIN public.designpro_revision_sources s ON s.revision_id = w.revision_id
  JOIN public.designpro_designs d ON d.generation_id = s.generation_id;

-- ── prompts: every prompt the customer (or operator) entered, in order ───────
CREATE VIEW public.designpro_design_prompts WITH (security_invoker = true) AS
  SELECT d.design_id, d.generation_id, r.id AS request_id,
    coalesce(r.revision_sequence, 1) AS revision_sequence,
    CASE WHEN r.parent_atlas_revision_id IS NULL THEN 'original-brief' ELSE 'revision-instruction' END AS prompt_kind,
    NULL::text AS surface,
    CASE WHEN r.parent_atlas_revision_id IS NULL THEN r.request_input->>'brief'
      ELSE r.revision_context->>'instruction' END AS prompt,
    r.state, r.created_at
  FROM public.designpro_generation_requests r
  JOIN public.designpro_designs d ON d.generation_id = r.generation_id
  UNION ALL
  SELECT d.design_id, d.generation_id, r.id, coalesce(r.revision_sequence, 1),
    'view-regeneration', s.source_view_type, s.instruction, s.state, s.updated_at
  FROM public.designpro_generation_slots s
  JOIN public.designpro_generation_requests r ON r.id = s.request_id
  JOIN public.designpro_designs d ON d.generation_id = r.generation_id
  WHERE nullif(btrim(s.instruction), '') IS NOT NULL;

-- NOT granted to `authenticated`: production grants that role no SELECT on
-- designpro_generation_requests / _views / _slots (information_schema,
-- 2026-09-25), so an invoker view over them would raise for every customer.
-- Customers and QC staff read these through designpro_design_history(), which
-- applies the existing caller_may_read_generation rule first.
REVOKE ALL ON public.designpro_design_files, public.designpro_design_prompts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.designpro_design_files, public.designpro_design_prompts TO service_role;

-- ── search: the library (order #, customer, vehicle, date, status, year) ─────
-- SECURITY INVOKER: RLS on designpro_designs decides whose rows are visible,
-- so a customer searching "30292" can only ever find their own designs.
-- Keyset pagination on (created_at, design_id), never OFFSET.
CREATE OR REPLACE FUNCTION public.designpro_design_search(
  p_query text DEFAULT NULL,
  p_order_number text DEFAULT NULL,
  p_vehicle_make text DEFAULT NULL,
  p_vehicle_model text DEFAULT NULL,
  p_vehicle_year integer DEFAULT NULL,
  p_created_year integer DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 24,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_design_id text DEFAULT NULL
) RETURNS TABLE (
  design_id text, generation_id uuid, design_name text, company_name text,
  vehicle_year integer, vehicle_make text, vehicle_model text, vehicle_type text,
  status text, created_at timestamptz, created_year integer,
  current_revision_sequence integer, order_numbers text[]
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
  WITH q AS (
    SELECT nullif(btrim(p_query), '') AS text_q,
      nullif(btrim(regexp_replace(btrim(coalesce(p_order_number, '')), '^#+\s*', '')), '') AS order_q,
      nullif(btrim(regexp_replace(btrim(coalesce(p_query, '')), '^#+\s*', '')), '') AS text_order_q,
      least(greatest(coalesce(p_limit, 24), 1), 100) AS lim
  )
  SELECT d.design_id, d.generation_id, d.design_name, d.company_name, d.vehicle_year,
    d.vehicle_make, d.vehicle_model, d.vehicle_type, d.status, d.created_at, d.created_year,
    d.current_revision_sequence,
    coalesce((SELECT array_agg(o.order_number ORDER BY o.bound_at) FROM public.designpro_design_orders o
              WHERE o.design_id = d.design_id), ARRAY[]::text[])
  FROM public.designpro_designs d, q
  WHERE (q.text_q IS NULL OR d.search_text @@ plainto_tsquery('simple', q.text_q)
         OR d.design_id = upper(q.text_q)
         OR EXISTS (SELECT 1 FROM public.designpro_design_orders o
                    WHERE o.design_id = d.design_id AND o.order_number = q.text_order_q))
    AND (q.order_q IS NULL OR EXISTS (SELECT 1 FROM public.designpro_design_orders o
                                      WHERE o.design_id = d.design_id AND o.order_number = q.order_q))
    AND (p_vehicle_make IS NULL OR lower(d.vehicle_make) = lower(btrim(p_vehicle_make)))
    AND (p_vehicle_model IS NULL OR lower(d.vehicle_model) = lower(btrim(p_vehicle_model)))
    AND (p_vehicle_year IS NULL OR d.vehicle_year = p_vehicle_year)
    AND (p_created_year IS NULL OR d.created_year = p_created_year)
    AND (p_from IS NULL OR d.created_at >= p_from)
    AND (p_to IS NULL OR d.created_at < p_to)
    AND (p_status IS NULL OR d.status = p_status)
    AND (p_cursor_created_at IS NULL OR (d.created_at, d.design_id) < (p_cursor_created_at, p_cursor_design_id))
  ORDER BY d.created_at DESC, d.design_id DESC
  LIMIT (SELECT lim FROM q);
$fn$;
REVOKE ALL ON FUNCTION public.designpro_design_search(text,text,text,text,integer,integer,timestamptz,timestamptz,text,integer,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.designpro_design_search(text,text,text,text,integer,integer,timestamptz,timestamptz,text,integer,timestamptz,text) TO authenticated, service_role;

-- ── history: every version, prompt, file and order of one design ────────────
-- One call for BOTH RevisionStudioIQ and PanelPro Studio, so "V2" is the same
-- fact on both. Reads through the existing access rule
-- (designpro_private.caller_may_read_generation: owner, QC staff, service).
CREATE OR REPLACE FUNCTION public.designpro_design_history(p_design_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE d public.designpro_designs%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.designpro_designs WHERE design_id = upper(btrim(p_design_id));
  IF NOT FOUND OR (SELECT auth.uid()) IS NULL AND coalesce(auth.jwt()->>'role','') <> 'service_role' THEN RETURN NULL; END IF;
  IF NOT designpro_private.caller_may_read_generation(d.generation_id) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'contract', 'designpro.design-history.v1',
    'designId', d.design_id, 'generationId', d.generation_id, 'designName', d.design_name,
    'companyName', d.company_name, 'status', d.status, 'createdAt', d.created_at,
    'vehicle', jsonb_build_object('year', d.vehicle_year, 'make', d.vehicle_make, 'model', d.vehicle_model, 'type', d.vehicle_type),
    'templateRef', d.template_ref,
    'orders', coalesce((SELECT jsonb_agg(jsonb_build_object('orderNumber', o.order_number, 'source', o.source,
        'wooOrderId', o.woo_order_id, 'boundAt', o.bound_at) ORDER BY o.bound_at)
      FROM public.designpro_design_orders o WHERE o.design_id = d.design_id), '[]'::jsonb),
    'versions', coalesce((SELECT jsonb_agg(jsonb_build_object('version', a.revision_sequence, 'revisionId', a.id,
        'requestId', a.request_id, 'parentRevisionId', a.parent_revision_id, 'createdAt', a.created_at,
        'productionEligible', a.production_eligible, 'effectivePpi', a.effective_ppi,
        'widthPx', a.width_px, 'heightPx', a.height_px, 'promptVersion', a.prompt_version,
        'masterContentHash', a.master_content_hash) ORDER BY a.revision_sequence, a.created_at)
      FROM public.designpro_flat_atlas_revisions a WHERE a.generation_id = d.generation_id AND a.owner_id = d.owner_id), '[]'::jsonb),
    'prompts', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', p.prompt_kind, 'version', p.revision_sequence,
        'surface', p.surface, 'prompt', p.prompt, 'state', p.state, 'requestId', p.request_id, 'createdAt', p.created_at)
        ORDER BY p.created_at, p.prompt_kind)
      FROM public.designpro_design_prompts p WHERE p.design_id = d.design_id), '[]'::jsonb),
    'files', coalesce((SELECT jsonb_agg(jsonb_build_object('source', f.source, 'kind', f.kind, 'surface', f.surface,
        'version', f.revision_sequence, 'storagePath', f.storage_path, 'contentHash', f.content_hash,
        'byteSize', f.byte_size, 'contentType', f.content_type, 'widthPx', f.width_px, 'heightPx', f.height_px,
        'createdAt', f.created_at, 'superseded', f.superseded_at IS NOT NULL)
        ORDER BY f.created_at, f.source, f.kind, f.surface)
      FROM public.designpro_design_files f WHERE f.design_id = d.design_id), '[]'::jsonb)
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.designpro_design_history(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.designpro_design_history(text) TO authenticated, service_role;

-- ── order binding: intake / manual, by the owner or design staff ────────────
CREATE OR REPLACE FUNCTION public.designpro_bind_design_order(
  p_generation_id uuid, p_order_number text, p_source text DEFAULT 'intake', p_woo_order_id bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_design text; v_order text := designpro_private.normalize_order_number(p_order_number);
  v_staff boolean := designpro_private.caller_is_design_staff();
  v_service boolean := coalesce(auth.jwt()->>'role','') = 'service_role';
BEGIN
  IF p_source NOT IN ('intake','manual','woocommerce','stripe') THEN RAISE EXCEPTION 'design_order_source_invalid'; END IF;
  -- Customers may only record the order number THEY typed at intake. Woo /
  -- Stripe / manual bindings are staff or server facts.
  IF NOT v_service AND NOT v_staff AND p_source <> 'intake' THEN RAISE EXCEPTION 'design_order_source_forbidden'; END IF;
  IF v_order IS NULL OR v_order !~ '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$' THEN RAISE EXCEPTION 'design_order_number_invalid'; END IF;
  SELECT d.design_id INTO v_design FROM public.designpro_designs d
  WHERE d.generation_id = p_generation_id
    AND (v_service OR v_staff OR d.owner_id = (SELECT auth.uid()));
  IF v_design IS NULL THEN
    -- The request may be seconds old; index it now if the caller owns it.
    IF EXISTS (SELECT 1 FROM public.designpro_generation_requests r WHERE r.generation_id = p_generation_id
               AND (v_service OR v_staff OR r.owner_id = (SELECT auth.uid()))) THEN
      PERFORM designpro_private.archive_upsert_request((SELECT r.id FROM public.designpro_generation_requests r
        WHERE r.generation_id = p_generation_id ORDER BY r.created_at LIMIT 1));
      v_design := designpro_private.design_id_for(p_generation_id);
    ELSE
      RAISE EXCEPTION 'design_not_found';
    END IF;
  END IF;
  INSERT INTO public.designpro_design_orders (design_id, source, order_number, woo_order_id, bound_by)
  VALUES (v_design, p_source, v_order, p_woo_order_id, (SELECT auth.uid()))
  ON CONFLICT (design_id, source, order_number) DO NOTHING;
  RETURN jsonb_build_object('designId', v_design, 'orderNumber', v_order, 'source', p_source);
END
$fn$;
REVOKE ALL ON FUNCTION public.designpro_bind_design_order(uuid,text,text,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.designpro_bind_design_order(uuid,text,text,bigint) TO authenticated, service_role;

-- ── backfill: index every existing request; report free-text order candidates
-- Idempotent and batched. Free-text "#30292" in a design name is REPORTED, never
-- bound: the audit requires a human to confirm those (docs/DESIGN-ARCHIVE.md).
CREATE OR REPLACE FUNCTION public.designpro_archive_backfill(p_limit integer DEFAULT 500, p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_ids uuid[]; v_id uuid; v_done integer := 0; v_candidates jsonb;
BEGIN
  IF coalesce(auth.jwt()->>'role','') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'designpro_archive_backfill_forbidden';
  END IF;
  SELECT array_agg(x.id) INTO v_ids FROM (
    SELECT DISTINCT ON (r.generation_id) r.id FROM public.designpro_generation_requests r
    WHERE NOT EXISTS (SELECT 1 FROM public.designpro_designs d WHERE d.generation_id = r.generation_id)
    ORDER BY r.generation_id, r.created_at LIMIT least(greatest(coalesce(p_limit, 500), 1), 5000)) x;
  IF NOT p_dry_run AND v_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_ids LOOP
      PERFORM designpro_private.archive_upsert_request(v_id);
      v_done := v_done + 1;
    END LOOP;
    -- Bring each design's current request / revision / status up to date.
    UPDATE public.designpro_designs d SET
      current_request_id = (SELECT r.id FROM public.designpro_generation_requests r WHERE r.generation_id = d.generation_id ORDER BY r.created_at DESC LIMIT 1),
      status = CASE WHEN d.status IN ('ordered','in_production','delivered','archived') THEN d.status
        ELSE designpro_private.design_status_for_request((SELECT r.state FROM public.designpro_generation_requests r WHERE r.generation_id = d.generation_id ORDER BY r.created_at DESC LIMIT 1)) END,
      current_revision_id = (SELECT a.id FROM public.designpro_flat_atlas_revisions a WHERE a.generation_id = d.generation_id ORDER BY a.revision_sequence DESC, a.created_at DESC LIMIT 1),
      current_revision_sequence = (SELECT max(a.revision_sequence) FROM public.designpro_flat_atlas_revisions a WHERE a.generation_id = d.generation_id)
    WHERE d.first_request_id = ANY (v_ids);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('generationId', r.generation_id,
      'designId', designpro_private.design_id_for(r.generation_id), 'designName', r.request_input->>'designName',
      'candidateOrderNumber', substring(r.request_input->>'designName' FROM '#\s*([0-9]{4,7})'))), '[]'::jsonb)
    INTO v_candidates
  FROM public.designpro_generation_requests r
  WHERE r.parent_atlas_revision_id IS NULL AND (r.request_input->>'designName') ~ '#\s*[0-9]{4,7}';
  RETURN jsonb_build_object('dryRun', p_dry_run, 'pending', coalesce(array_length(v_ids, 1), 0),
    'indexed', v_done, 'freeTextOrderCandidates', v_candidates);
END
$fn$;
REVOKE ALL ON FUNCTION public.designpro_archive_backfill(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.designpro_archive_backfill(integer, boolean) TO service_role;
