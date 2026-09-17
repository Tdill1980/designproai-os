-- Public WallPro landing media; no customer or production assets are exposed.
CREATE TABLE public.wallpro_landing_media (
  slot text PRIMARY KEY CHECK (slot IN ('residential','commercial','hospitality','corporate','retail','before','process','install')),
  src text NOT NULL DEFAULT '' CHECK (length(src) <= 4096 AND (src = '' OR src ~ '^https://' OR src ~ '^/wallpro/[a-zA-Z0-9_./-]+$')),
  poster text NOT NULL DEFAULT '' CHECK (length(poster) <= 4096 AND (poster = '' OR poster ~ '^https://' OR poster ~ '^/wallpro/[a-zA-Z0-9_./-]+$')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 180),
  caption text NOT NULL DEFAULT '' CHECK (length(caption) <= 800),
  alt text NOT NULL DEFAULT '' CHECK (length(alt) <= 500),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallpro_landing_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallpro_landing_media FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wallpro_landing_media TO anon;
GRANT SELECT, INSERT, UPDATE ON public.wallpro_landing_media TO authenticated;
GRANT ALL ON public.wallpro_landing_media TO service_role;
CREATE POLICY wallpro_landing_public_read ON public.wallpro_landing_media
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY wallpro_landing_curator_insert ON public.wallpro_landing_media
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'tester'::public.app_role));
CREATE POLICY wallpro_landing_curator_update ON public.wallpro_landing_media
  FOR UPDATE TO authenticated USING (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'tester'::public.app_role))
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'tester'::public.app_role));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wallpro-landing', 'wallpro-landing', true, 524288000,
  ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']);
CREATE POLICY wallpro_landing_media_read ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'wallpro-landing');
CREATE POLICY wallpro_landing_media_upload ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'wallpro-landing'
    AND (storage.foldername(name))[1] IN ('residential','commercial','hospitality','corporate','retail','before','process','install')
    AND array_length(storage.foldername(name), 1) = 1
    AND storage.filename(name) ~ '^[0-9a-f-]{36}\.(jpg|png|webp|mp4|webm|mov)$'
    AND (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR public.has_role((SELECT auth.uid()), 'tester'::public.app_role)));
