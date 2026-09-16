-- PATTERNPRO ON DESIGNPROAI — the pattern library, the render bucket, the seed
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-09-15, on the WePrintWraps-facing PatternPro page: "all these
-- need to be in os.designpro repo". PatternPro (Wrap-By-The-Yard: pick one of
-- the 118 real WePrintWraps patterns, see it on the vehicle, get the yards a
-- full wrap takes) ran only on the suite it was born in. This project had the
-- app code (a fork) but none of its data: no wbty_products, no wbty_carousel, no bucket
-- for the renders. /pattern-wrap therefore needs three things:
--
--   1. wbty_products / wbty_carousel, the shape the tool already reads, readable
--      by anyone (a WePrintWraps visitor is anonymous) for ACTIVE rows only,
--      and managed by admins.
--   2. patternpro-files, a PUBLIC bucket for the on-vehicle renders. On this
--      project wrap-files is PRIVATE (production packs, provider-private
--      atlases), so the ported function's public URL into it would 400 and
--      every render would be a broken image. Same shape as graphicspro-files.
--   3. The 118 active patterns, seeded. The swatch images stay where they are
--      (the WePrintWraps swatch library, a public bucket on the source
--      project, wrap-files/pattern-swatches-wpw/…): they are the
--      one copy WePrintWraps curated, they are public, and copying 118 files
--      across projects buys nothing but a second place for them to drift.
--      media_url is DERIVED from name + category by the same rule the source
--      rows follow (verified 2026-09-15: 0 mismatches over all 118), so the
--      seed is a list of names, not a wall of URLs.
--
-- Idempotent: every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING, and
-- the seed skips a name that is already present, so re-running is safe and an
-- admin's later edit to a row is never overwritten.

CREATE TABLE IF NOT EXISTS public.wbty_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  media_url text NOT NULL,
  media_type text NOT NULL,
  price numeric,
  category text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  wholesale_price_per_yard numeric DEFAULT 93.59
);

CREATE TABLE IF NOT EXISTS public.wbty_carousel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  media_url text NOT NULL,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  title text,
  subtitle text,
  manufacturer text
);

CREATE INDEX IF NOT EXISTS wbty_products_active_sort_idx
  ON public.wbty_products (is_active, sort_order);

-- updated_at, the way every other table here keeps it.
DROP TRIGGER IF EXISTS wbty_products_set_updated_at ON public.wbty_products;
CREATE TRIGGER wbty_products_set_updated_at
  BEFORE UPDATE ON public.wbty_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS wbty_carousel_set_updated_at ON public.wbty_carousel;
CREATE TRIGGER wbty_carousel_set_updated_at
  BEFORE UPDATE ON public.wbty_carousel
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.wbty_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wbty_carousel ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wbty_products_public_read_active ON public.wbty_products;
CREATE POLICY wbty_products_public_read_active ON public.wbty_products
  FOR SELECT TO anon, authenticated USING (is_active = true);
DROP POLICY IF EXISTS wbty_products_admin_all ON public.wbty_products;
CREATE POLICY wbty_products_admin_all ON public.wbty_products
  FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS wbty_carousel_public_read_active ON public.wbty_carousel;
CREATE POLICY wbty_carousel_public_read_active ON public.wbty_carousel
  FOR SELECT TO anon, authenticated USING (is_active = true);
DROP POLICY IF EXISTS wbty_carousel_admin_all ON public.wbty_carousel;
CREATE POLICY wbty_carousel_admin_all ON public.wbty_carousel
  FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'tester'::app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'tester'::app_role));

GRANT SELECT ON public.wbty_products, public.wbty_carousel TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.wbty_products, public.wbty_carousel TO authenticated;
GRANT ALL ON public.wbty_products, public.wbty_carousel TO service_role;

-- ── patternpro-files: the public bucket the on-vehicle renders live in ─────
-- generate-pattern-render writes with the service role under
-- renders/{uid|anonymous}/patternpro/…; <img> tags, RevisionStudio and the
-- customer's My Renders read the public URL. No UPDATE / DELETE for users:
-- every render is a fresh timestamped path.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'patternpro-files', 'patternpro-files', true, 52428800,
  ARRAY['image/png','image/jpeg','image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS patternpro_files_public_read ON storage.objects;
CREATE POLICY patternpro_files_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'patternpro-files');

-- ── The 118 patterns, in the order the library shows them ──────────────────
-- Five WePrintWraps collections, each its own WooCommerce product
-- (app/src/data/patternpro-patterns.ts WPW_WOOCOMMERCE_IDS): the category
-- string here is what resolves the cart link, so it must match exactly.
WITH src(category, folder, names) AS (
  VALUES
    ('Wicked & Wild', 'wicked-wild', ARRAY[
      'Abstract Camo','Marble Mayhem','Snake Skin','Skull Pattern','Deep Galaxy',
      'Unicorn Galaxy','Rainbow Galaxy','Outerspace','Grunge Galaxy','Psychedelic Galaxy',
      'Mayhem','Wild Girl','Vivid Color','Painted Camo','Ice Breaker',
      'Abstract Color','Color Maze','Rigid','Teal & Gray Camo','Brown & Blue Camo',
      'Dirty Camo','Jumbo Camo 1','Jumbo Camo 2','Dot Camo']),
    ('Camo & Carbon', 'camo-carbon', ARRAY[
      'Vintage Camo','Hexagon Camo','Modern Camo','Grunge Camo','Sand Camo',
      'Black Camo','Digi Gray Camo','Broken Gray Camo','Digi Lime Camo','Broken Red Camo',
      'Red Camo','Orange Camo','Blue Camo','Galaxy Camo','Color Splash Camo',
      'Purple Camo','Gray Carbon','White Carbon','Black Carbon 1','Black Carbon 2',
      'Red Carbon','Blue Carbon','Gold Carbon 1','Gold Carbon 2']),
    ('Metal & Marble', 'metal-marble', ARRAY[
      'Gray Marble','Azul Marble','Smokey Marble','Classic Marble','Solar Flare Marble',
      'Reverse Marble','Venetian Marble','Egyptian Marble','Ocean Marble','Ghost Marble',
      'Crackle Marble','Rose Marble','Grecian Marble','Brushed Iron','Gold Foil',
      'Silver Foil','Rose Gold Foil','Battle Worn','Aged Armor','Diamond Plate',
      'Riveted Tank','Doomsday Rust','Antique Patina','Rat Rod']),
    ('Bape Camo', 'bape-camo', ARRAY[
      'Red Bape Camo','Blue Bape Camo','Purple Bape Camo','Pink Bape Camo','Grey Bape Camo',
      'Rad Bape Camo','Unicorn Bape Camo','Psychedelic Bape Camo','Bubble Gum Bape Camo','Army Bape Camo']),
    ('Modern & Trippy', 'modern-trippy', ARRAY[
      'Grunge Blue Camo','Hex Camo','Geometric Edge','Abstract Triangle','Brushed Geometric',
      'Concept Camo','Shattered','Color of Money 2','Color of Money 1','Chameleon Camo Red',
      'Chameleon Camo Tan','Chameleon Camo Blue','Why So Serious? Green','Why So Serious? Red','Anime Clouds',
      'Topography Camo','Topography Heat Map','Topography Map','Hypnotic','Block Chain',
      'The Matrix','Faux Holographic','Torn Camo','Lifes A Trip','Lifes A Trip Pink',
      'Transformer','Picasasso','Abstract','Starry Night','Nebula Galaxy',
      'Purple Nebula Galaxy','Dark Nebula Galaxy','Rick & Morty Galaxy','Faux Triangle Holographic','Enter The Dragon',
      'Electric Blue'])
),
cat_order(category, ord) AS (
  VALUES ('Wicked & Wild', 1), ('Camo & Carbon', 2), ('Metal & Marble', 3), ('Bape Camo', 4), ('Modern & Trippy', 5)
),
rows_ AS (
  SELECT
    n.name,
    s.category,
    format(
      'https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/pattern-swatches-wpw/%s/%s.%s',
      s.folder,
      regexp_replace(lower(regexp_replace(n.name, '[&?]', '', 'g')), '\s+', '-', 'g'),
      CASE WHEN n.name = 'Chameleon Camo Red' THEN 'png' ELSE 'jpg' END
    ) AS media_url,
    row_number() OVER (ORDER BY c.ord, n.pos) AS sort_order
  FROM src s
  JOIN cat_order c ON c.category = s.category
  CROSS JOIN LATERAL unnest(s.names) WITH ORDINALITY AS n(name, pos)
)
INSERT INTO public.wbty_products (name, media_url, media_type, price, category, sort_order, is_active, wholesale_price_per_yard)
SELECT r.name, r.media_url, 'image', 95.50, r.category, r.sort_order::int, true, 93.59
FROM rows_ r
WHERE NOT EXISTS (SELECT 1 FROM public.wbty_products p WHERE p.name = r.name);
