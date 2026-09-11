-- GraphicsPro: cut-contour graphics for walls, vehicles and glass.
--
-- Recovered from the reference implementation (RULE 1). The GraphicsPro UI, hooks and edge
-- functions were carried into this repository byte-for-byte, but nothing they
-- read or write existed on the DesignProAI project: no graphics_pro_jobs, no
-- pricing rows, no shop markup table, and the only wrap bucket is private
-- while every GraphicsPro consumer (browser <img>, Konva ZoneMasker,
-- composeZoneOverlay, Gemini reference fetches) works from public URLs.
--
-- Shapes below are the LIVE reference production schema, read back from that
-- project on 2026-09-11 (information_schema + pg_constraint), not re-imagined.
-- Deltas, each deliberate:
--   * shop_id / quote_id stay as nullable uuid columns (the generated types
--     carry them) but without foreign keys: shop_profiles and quotes are
--     predecessor tables this OS does not have.
--   * surface_type additionally admits 'studio' — the UI's SurfaceType union
--     has carried it since the Studio artboard shipped, and the live CHECK
--     silently rejected every studio job insert (jobId came back null).
--   * shop_pricing_config gets the UNIQUE(user_id) that ShopMarkupConfig's
--     upsert(onConflict: "user_id") has always required.
--   * files live in a dedicated PUBLIC bucket, graphicspro-files, scoped by
--     policy to renders/{uid}/… for browser uploads. wrap-files (private,
--     signed-URL only) is untouched.

-- ── graphics_pro_jobs ───────────────────────────────────────────────────────
CREATE TABLE public.graphics_pro_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('design','commercial','upload','restyle','logo')),
  surface_type text CHECK (surface_type IN ('vehicle','wall','glass','surface','studio')),
  surface_subcategory text,
  surface_texture text,
  surface_image_url text,
  surface_source text CHECK (surface_source IN ('upload','generated')),
  vehicle_year integer,
  vehicle_make text,
  vehicle_model text,
  vehicle_area text,
  design_prompt text,
  design_style text,
  business_name text,
  business_phone text,
  business_website text,
  business_industry text,
  business_tagline text,
  business_logo_url text,
  uploaded_artwork_urls text[],
  restyle_prompt text,
  vinyl_finish text DEFAULT 'glossy' CHECK (vinyl_finish IN ('glossy','matte','satin','reflective')),
  mockup_render_url text,
  detail_render_url text,
  closeup_render_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','generating_surface','surface_ready','rendering','mockup_ready',
    'approved','processing','complete','failed')),
  approved_at timestamptz,
  flat_production_url text,
  vectorized_url text,
  cut_path_pdf_url text,
  cut_path_eps_url text,
  cut_path_svg_url text,
  nested_width_inches numeric,
  nested_height_inches numeric,
  total_sqft numeric,
  material_type text CHECK (material_type IN ('avery','3m')),
  wholesale_price numeric,
  retail_price numeric,
  output_zip_url text,
  stage text,
  progress integer DEFAULT 0,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  shop_id uuid,
  quote_id uuid,
  vinyl_zones jsonb,
  zone_overlay_url text,
  cut_files_zip_url text,
  cut_contour_overlay_url text,
  extracted_element_count integer,
  vectorized_count integer,
  concept_json jsonb
);
CREATE INDEX graphics_pro_jobs_user_created ON public.graphics_pro_jobs(user_id, created_at DESC);
CREATE INDEX graphics_pro_jobs_status ON public.graphics_pro_jobs(status);

CREATE OR REPLACE FUNCTION public.graphics_pro_jobs_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
CREATE TRIGGER graphics_pro_jobs_touch_updated_at
  BEFORE UPDATE ON public.graphics_pro_jobs
  FOR EACH ROW EXECUTE FUNCTION public.graphics_pro_jobs_touch_updated_at();

ALTER TABLE public.graphics_pro_jobs ENABLE ROW LEVEL SECURITY;
-- The customer reads their own job (ProductionOutput polls it) and the studio
-- pack path updates it from the browser; every other write is the service
-- role inside generate-graphics-pro.
CREATE POLICY graphics_pro_jobs_owner_select ON public.graphics_pro_jobs
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY graphics_pro_jobs_owner_insert ON public.graphics_pro_jobs
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY graphics_pro_jobs_owner_update ON public.graphics_pro_jobs
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY graphics_pro_jobs_owner_delete ON public.graphics_pro_jobs
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.graphics_pro_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.graphics_pro_jobs TO authenticated;
GRANT ALL ON public.graphics_pro_jobs TO service_role;

-- ── graphics_pro_pricing (wholesale $/sq ft per cut-contour material) ───────
CREATE TABLE public.graphics_pro_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_type text NOT NULL UNIQUE,
  material_name text NOT NULL,
  wholesale_price_sqft numeric NOT NULL CHECK (wholesale_price_sqft > 0),
  includes_weeding boolean DEFAULT true,
  includes_masking boolean DEFAULT true,
  max_artwork_width_inches integer DEFAULT 50,
  created_at timestamptz DEFAULT now()
);
INSERT INTO public.graphics_pro_pricing (material_type, material_name, wholesale_price_sqft)
VALUES
  ('avery_cut_contour', 'Avery Cut Contour Vinyl Graphics', 6.32),
  ('3m_cut_contour',    '3M Cut Contour Vinyl Graphics',    6.92);
ALTER TABLE public.graphics_pro_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY graphics_pro_pricing_read ON public.graphics_pro_pricing
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.graphics_pro_pricing FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.graphics_pro_pricing TO authenticated;
GRANT ALL ON public.graphics_pro_pricing TO service_role;

-- ── shop_pricing_config (per-shop markup over wholesale) ────────────────────
CREATE TABLE public.shop_pricing_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  default_markup_percentage numeric DEFAULT 100.00 CHECK (default_markup_percentage >= 0),
  minimum_order_price numeric DEFAULT 25.00 CHECK (minimum_order_price >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.shop_pricing_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_pricing_config_owner_select ON public.shop_pricing_config
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY shop_pricing_config_owner_insert ON public.shop_pricing_config
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY shop_pricing_config_owner_update ON public.shop_pricing_config
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.shop_pricing_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.shop_pricing_config TO authenticated;
GRANT ALL ON public.shop_pricing_config TO service_role;

-- ── graphicspro-files: the public bucket every GraphicsPro consumer reads ───
-- Surface photos, zone overlays, mockups, flat artwork, cut files, PDFs.
-- Browser uploads are confined to renders/{uid}/…; the edge functions write
-- with the service role. Public read is the contract the recovered code was
-- built on (Gemini fetches these URLs, Konva draws them, <img> shows them).
-- No UPDATE / DELETE policy on purpose: storage objects stay immutable for
-- users on this project (REVOKE UPDATE, DELETE ON storage.objects FROM
-- authenticated, 20260806180700), and every GraphicsPro upload is a fresh
-- timestamped path, so nothing ever needs to overwrite an object.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'graphicspro-files', 'graphicspro-files', true, 52428800,
  ARRAY['image/png','image/jpeg','image/webp','image/svg+xml','application/pdf','application/zip','application/json']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY graphicspro_files_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'graphicspro-files');
CREATE POLICY graphicspro_files_owner_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'graphicspro-files'
    AND (storage.foldername(name))[1] = 'renders'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );
