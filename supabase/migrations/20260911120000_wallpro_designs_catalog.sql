-- WallPro ready-to-sell design catalog (WrapReady Designs, wall medium).
--
-- Identity model (owner directive, 2026-09-11):
--   DesignID      WPB-0001  permanent commercial identity, assigned by the
--                 500-prompt library (docs/wallpro); never changes.
--   GenerationID  the exact wallpro_generations row whose master was approved.
--                 A regenerate of the same DesignID is a new master_version.
--   SynthID       Google's pixel-level provenance; recorded as expected, never a key.
-- Canonical truth is DesignID + GenerationID + master SHA-256 + this row.
--
-- Taxonomy (segment, industry, room, design type, style, palette, intensity)
-- is stored beside the prompt, never only inside it, per the library's
-- Production Rules sheet. A catalog order never regenerates: it pulls the
-- approved master and panelizes it. Batch runs are made by admin/tester
-- accounts, which reserve_wallpro_generation already charges as 'privileged'.
CREATE TABLE public.wallpro_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id text NOT NULL UNIQUE CHECK (design_id ~ '^WPB-[0-9A-Z][0-9A-Z-]{3,19}$'),
  collection_id text CHECK (collection_id IS NULL OR collection_id ~ '^[A-Z0-9-]{2,60}$'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  segment text NOT NULL CHECK (segment IN ('B2B','B2C')),
  industry text NOT NULL CHECK (length(industry) BETWEEN 1 AND 80),
  room text CHECK (room IS NULL OR length(room) <= 80),
  design_type text NOT NULL CHECK (length(design_type) BETWEEN 1 AND 60),
  style text CHECK (style IS NULL OR length(style) <= 60),
  palette text CHECK (palette IS NULL OR length(palette) <= 200),
  intensity text CHECK (intensity IS NULL OR intensity IN ('Quiet','Balanced','Statement')),
  tags text[] NOT NULL DEFAULT '{}'::text[],
  description text CHECK (description IS NULL OR length(description) <= 600),
  prompt text NOT NULL CHECK (length(prompt) BETWEEN 1 AND 6000),
  prompt_version text NOT NULL DEFAULT '1',
  -- engine: repeat = a seamless tile (patterns and architectural surfaces);
  -- mural = one composition sized to the wall, sliced with duplicated overlap.
  mode text NOT NULL CHECK (mode IN ('repeat','mural')),
  tile_width_in numeric CHECK (tile_width_in IS NULL OR (tile_width_in >= 1 AND tile_width_in <= 2400)),
  CHECK (mode <> 'repeat' OR tile_width_in IS NOT NULL),
  -- AI master provenance
  generation_id uuid NOT NULL REFERENCES public.wallpro_generations(id),
  provider text NOT NULL DEFAULT 'google',
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 80),
  synthid_expected boolean NOT NULL DEFAULT true,
  prompt_hash text NOT NULL CHECK (prompt_hash ~ '^[0-9a-f]{64}$'),
  -- production master: a catalog copy readable by every customer
  master_path text NOT NULL UNIQUE CHECK (master_path ~ '^catalog/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  -- storefront thumbnail beside the master; the master is never served as a thumbnail
  thumb_path text CHECK (thumb_path IS NULL OR thumb_path ~ '^catalog/[0-9a-f-]{36}-thumb\.jpg$'),
  master_sha256 text NOT NULL CHECK (master_sha256 ~ '^[0-9a-f]{64}$'),
  width_px integer NOT NULL CHECK (width_px > 0),
  height_px integer NOT NULL CHECK (height_px > 0),
  master_version integer NOT NULL DEFAULT 1 CHECK (master_version >= 1),
  -- wallpro.seamless.v1 receipt for repeat tiles; null for murals
  seam jsonb CHECK (seam IS NULL OR jsonb_typeof(seam)='object'),
  CHECK (mode <> 'repeat' OR seam IS NOT NULL),
  approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('generated','approved','rejected','revision')),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  rating smallint CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  batch_id text CHECK (batch_id IS NULL OR length(batch_id) <= 80),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallpro_designs_storefront ON public.wallpro_designs(is_active,segment,industry,sort_order,created_at DESC);
CREATE INDEX wallpro_designs_batch ON public.wallpro_designs(batch_id,created_at DESC);
ALTER TABLE public.wallpro_designs ENABLE ROW LEVEL SECURITY;
-- Storefront read: every approved, active design is browsable, signed in or not.
CREATE POLICY wallpro_design_public_read ON public.wallpro_designs FOR SELECT TO anon,authenticated
USING (is_active AND approval_status='approved');
-- Curators (admin/tester, the same roles reserve_wallpro_generation treats as privileged) manage the catalog.
CREATE POLICY wallpro_design_curator_read ON public.wallpro_designs FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));
CREATE POLICY wallpro_design_curator_insert ON public.wallpro_designs FOR INSERT TO authenticated
WITH CHECK (created_by=(SELECT auth.uid()) AND (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role)));
CREATE POLICY wallpro_design_curator_update ON public.wallpro_designs FOR UPDATE TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role))
WITH CHECK (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));
CREATE POLICY wallpro_design_curator_delete ON public.wallpro_designs FOR DELETE TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));
REVOKE ALL ON public.wallpro_designs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.wallpro_designs TO anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.wallpro_designs TO authenticated;
GRANT ALL ON public.wallpro_designs TO service_role;

-- Catalog masters live under catalog/ in the private wallpro-files bucket.
-- Customers read them through signed URLs; only curators may write there.
-- Storage objects stay immutable for users (UPDATE/DELETE are revoked from
-- authenticated by the bootstrap): removing a design deletes its row, and the
-- catalog copy is retained as provenance of what was once sold.
-- The per-owner read/upload policies from 20260910070849 are unchanged.
CREATE POLICY wallpro_catalog_read ON storage.objects FOR SELECT TO anon,authenticated
USING (bucket_id='wallpro-files' AND (storage.foldername(name))[1]='catalog');
CREATE POLICY wallpro_catalog_write ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='wallpro-files' AND (storage.foldername(name))[1]='catalog' AND array_length(storage.foldername(name),1)=1
  AND storage.filename(name) ~ '^[0-9a-f-]{36}(-thumb)?\.(png|jpg|webp)$'
  AND (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role)));
