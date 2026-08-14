-- Project a completed Calls 1-7 generation into the product's render library.
--
-- The DesignPro product reads a customer's designs from designiq_generations and
-- color_visualizations — that is what RevisionStudioIQ's grid, the Production
-- Layers card, PanelLibrary and the workspace's render window have always been
-- pointed at. The standalone generation model writes somewhere else entirely
-- (designpro_generation_requests + designpro_generation_views), so a generation
-- could succeed on the server and leave every product surface empty.
--
-- The projection runs in the database, on the server's own writes, so the
-- browser never regains ownership of generation: the page submits, the runtime
-- generates, and the library row appears because the views landed — not because
-- a tab stayed open.
--
-- View bytes stay in the private wrap-files bucket. render_urls therefore holds
-- a `dp://<request_id>/<sourceViewType>` reference rather than a URL: the
-- gateway mints short-lived signed URLs behind the owner's own token, and a
-- durable table must not pretend to hold one. Anything that renders these maps
-- exchanges the references for signed URLs at read time — the request id is the
-- address /api/generation/requests/:id/views answers to, while the library row
-- keeps the generation id as the design's identity.

-- ── product view keys ─────────────────────────────────────────────────────
-- source_view_type is already the product's vocabulary for the six flat views;
-- only the hero differs (the product calls it "hero").
CREATE OR REPLACE FUNCTION designpro_private.product_view_key(p_source_view_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE p_source_view_type WHEN 'hero-3d' THEN 'hero' ELSE p_source_view_type END;
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.project_generation_into_library(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_req public.designpro_generation_requests%ROWTYPE;
  v_input jsonb;
  v_email text;
  v_render_urls jsonb;
  v_hero text;
  v_year integer;
  v_make text;
  v_model text;
  v_type text;
  v_name text;
  v_notes jsonb;
BEGIN
  SELECT * INTO v_req
  FROM public.designpro_generation_requests
  WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Only project once the server says the output set is real. A partial set is
  -- an in-flight generation, not a design the customer owns.
  IF v_req.state NOT IN ('outputs_ready','handoff_ready','completed') THEN RETURN; END IF;

  SELECT jsonb_object_agg(
           designpro_private.product_view_key(v.source_view_type),
           'dp://' || v_req.id::text || '/' || v.source_view_type
         )
    INTO v_render_urls
  FROM public.designpro_generation_views v
  WHERE v.request_id = v_req.id AND v.superseded_at IS NULL;

  IF v_render_urls IS NULL THEN RETURN; END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_req.owner_id;
  IF v_email IS NULL THEN RETURN; END IF;

  v_input := COALESCE(v_req.request_input, '{}'::jsonb);
  v_year  := NULLIF(regexp_replace(COALESCE(v_input#>>'{vehicle,year}',''), '\D', '', 'g'), '')::integer;
  v_make  := lower(btrim(COALESCE(NULLIF(v_input#>>'{vehicle,make}',''), 'unknown')));
  v_model := lower(btrim(COALESCE(NULLIF(v_input#>>'{vehicle,model}',''), 'unknown')));
  v_type  := lower(btrim(COALESCE(NULLIF(v_input#>>'{vehicle,type}',''), 'car')));
  v_name  := COALESCE(
    NULLIF(btrim(v_input->>'designName'), ''),
    NULLIF(btrim(v_input->>'orderNumber'), ''),
    'DesignPro ' || left(v_req.generation_id::text, 8)
  );
  v_hero := COALESCE(v_render_urls->>'side', v_render_urls->>'hero');

  -- designiq_generations — the generation record the product's revision and
  -- proof surfaces join against. Its status vocabulary is the product's, not
  -- the server's: a full seven-view set is 'all_views'.
  INSERT INTO public.designiq_generations AS g (
    id, user_id, user_email, mode, raw_prompt, style_preset, company_name,
    industry_type, vehicle_year, vehicle_make, vehicle_model,
    hero_render_url, render_urls, generation_status, design_name,
    engine_version, created_at, render_completed_at, updated_at
  ) VALUES (
    v_req.generation_id, v_req.owner_id, v_email,
    CASE WHEN NULLIF(btrim(v_input->>'businessName'),'') IS NULL THEN 'restyle' ELSE 'commercial' END,
    NULLIF(btrim(v_input->>'brief'), ''),
    NULLIF(btrim(v_input->>'style'), ''),
    NULLIF(btrim(v_input->>'businessName'), ''),
    NULLIF(btrim(v_input->>'industry'), ''),
    COALESCE(v_input#>>'{vehicle,year}', ''), v_make, v_model,
    v_hero, v_render_urls, 'all_views', v_name,
    'designpro.calls-1-7', v_req.created_at, v_req.completed_at, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    hero_render_url = EXCLUDED.hero_render_url,
    render_urls = EXCLUDED.render_urls,
    generation_status = 'all_views',
    render_completed_at = EXCLUDED.render_completed_at,
    updated_at = now()
  WHERE g.render_urls IS DISTINCT FROM EXCLUDED.render_urls;

  v_notes := jsonb_build_object(
    'designiq_generation_id', v_req.generation_id,
    'designpro_generation_id', v_req.generation_id,
    'designpro_request_id', v_req.id,
    'source', 'designpro.calls-1-7',
    'designiq_mode', CASE WHEN NULLIF(btrim(v_input->>'businessName'),'') IS NULL THEN 'restyle' ELSE 'commercial' END,
    'vehicle_type', v_type,
    'original_prompt', NULLIF(btrim(v_input->>'brief'), ''),
    'company_name', NULLIF(btrim(v_input->>'businessName'), ''),
    'industry_type', NULLIF(btrim(v_input->>'industry'), ''),
    'style_preset', NULLIF(btrim(v_input->>'style'), ''),
    'order_number', NULLIF(btrim(v_input->>'orderNumber'), '')
  );

  -- color_visualizations — the render library row. Its id is the generation id
  -- so the projection is idempotent and the product's visualizationId lines up
  -- with the server's generation id instead of drifting from it.
  INSERT INTO public.color_visualizations AS c (
    id, customer_email, vehicle_year, vehicle_make, vehicle_model, vehicle_type,
    mode_type, color_name, color_hex, finish_type, design_file_name,
    custom_styling_prompt_key, render_urls, generation_status, is_saved,
    custom_design_url, custom_swatch_url, admin_notes, created_at, updated_at
  ) VALUES (
    v_req.generation_id, v_email, COALESCE(v_year, 0), v_make, v_model, v_type,
    'designpanelpro', v_name, '#000000',
    lower(COALESCE(NULLIF(btrim(v_input->>'finish'), ''), 'gloss')),
    v_name, NULLIF(btrim(v_input->>'brief'), ''),
    v_render_urls, 'completed', true,
    v_hero, v_hero, v_notes::text, v_req.created_at, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    render_urls = EXCLUDED.render_urls,
    custom_design_url = EXCLUDED.custom_design_url,
    custom_swatch_url = EXCLUDED.custom_swatch_url,
    generation_status = 'completed',
    updated_at = now()
  WHERE c.render_urls IS DISTINCT FROM EXCLUDED.render_urls;
END
$fn$;

REVOKE ALL ON FUNCTION designpro_private.project_generation_into_library(uuid) FROM PUBLIC;

-- ── triggers ──────────────────────────────────────────────────────────────
-- Two entry points, because either can be last: the request reaching a ready
-- state, or the final view landing after it did.
CREATE OR REPLACE FUNCTION designpro_private.tg_project_generation_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.state IN ('outputs_ready','handoff_ready','completed')
     AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM NEW.state)
  THEN
    PERFORM designpro_private.project_generation_into_library(NEW.id);
  END IF;
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS designpro_project_generation_request ON public.designpro_generation_requests;
CREATE TRIGGER designpro_project_generation_request
  AFTER INSERT OR UPDATE OF state ON public.designpro_generation_requests
  FOR EACH ROW EXECUTE FUNCTION designpro_private.tg_project_generation_request();

CREATE OR REPLACE FUNCTION designpro_private.tg_project_generation_view()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM designpro_private.project_generation_into_library(NEW.request_id);
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS designpro_project_generation_view ON public.designpro_generation_views;
CREATE TRIGGER designpro_project_generation_view
  AFTER INSERT OR UPDATE OF superseded_at ON public.designpro_generation_views
  FOR EACH ROW EXECUTE FUNCTION designpro_private.tg_project_generation_view();

-- Backfill anything that already finished before this projection existed.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.designpro_generation_requests
    WHERE state IN ('outputs_ready','handoff_ready','completed')
  LOOP
    PERFORM designpro_private.project_generation_into_library(r.id);
  END LOOP;
END
$$;
