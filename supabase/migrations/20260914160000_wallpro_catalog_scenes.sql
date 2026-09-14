-- WallPro catalog room scenes + saved listing mockups (owner, 2026-09-14:
-- "we need to create images where they can see pattern size on a typical
-- wall room"). A scene is a stock room photograph with its feature wall's
-- four corners marked once and its real wall inches recorded, so every
-- catalog design can be imposed on it at TRUE scale by the same
-- deterministic homography the customer's own-photo preview uses
-- (app/src/lib/wallpro-render.ts renderWallPreview). No AI, no new math.
--
-- Scene photographs and saved mockups are stored beside the masters as
-- catalog/<uuid>.jpg: the existing wallpro_catalog_write storage policy
-- (20260911120000) already admits exactly that name shape for curators, and
-- wallpro_catalog_read already serves it to everyone. No storage change.
CREATE TABLE public.wallpro_catalog_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  room text CHECK (room IS NULL OR length(room) <= 80),
  image_path text NOT NULL UNIQUE CHECK (image_path ~ '^catalog/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  width_px integer NOT NULL CHECK (width_px > 0),
  height_px integer NOT NULL CHECK (height_px > 0),
  -- Four wall corners as {x,y} in [0,1] of the photograph, clockwise from
  -- top-left: the contract validWallCorners enforces client-side.
  corners jsonb NOT NULL CHECK (jsonb_typeof(corners)='array' AND jsonb_array_length(corners)=4),
  wall_width_in numeric NOT NULL CHECK (wall_width_in >= 12 AND wall_width_in <= 2400),
  wall_height_in numeric NOT NULL CHECK (wall_height_in >= 12 AND wall_height_in <= 2400),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallpro_catalog_scenes_active ON public.wallpro_catalog_scenes(is_active,sort_order,created_at);
ALTER TABLE public.wallpro_catalog_scenes ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallpro_scene_public_read ON public.wallpro_catalog_scenes FOR SELECT TO anon,authenticated
USING (is_active);
CREATE POLICY wallpro_scene_curator_read ON public.wallpro_catalog_scenes FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));
CREATE POLICY wallpro_scene_curator_insert ON public.wallpro_catalog_scenes FOR INSERT TO authenticated
WITH CHECK (created_by=(SELECT auth.uid()) AND (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role)));
CREATE POLICY wallpro_scene_curator_update ON public.wallpro_catalog_scenes FOR UPDATE TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role))
WITH CHECK (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));
CREATE POLICY wallpro_scene_curator_delete ON public.wallpro_catalog_scenes FOR DELETE TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));
REVOKE ALL ON public.wallpro_catalog_scenes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.wallpro_catalog_scenes TO anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.wallpro_catalog_scenes TO authenticated;
GRANT ALL ON public.wallpro_catalog_scenes TO service_role;

-- Saved listing mockups on the design itself: [{scene_id, path, caption}].
-- Rendered client-side from the design's own master at true scale and stored
-- as catalog/<uuid>.jpg; the storefront shows the first one as the listing
-- image so a customer sees the pattern's real size on a typical wall before
-- they pick it. Presentation only — never a print file.
ALTER TABLE public.wallpro_designs
  ADD COLUMN mockups jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(mockups)='array');
