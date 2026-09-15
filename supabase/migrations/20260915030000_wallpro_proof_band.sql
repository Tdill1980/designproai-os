-- THE PROOF BAND BECOMES SOMETHING THE OWNER RUNS, NOT SOMETHING I EDIT.
--
-- Owner, 2026-09-15: "just create a container and i can place on admin side."
--
-- Every before/after on the WePrintWraps page has so far cost a round trip
-- through me: the files reach a session, a script normalises them, a constant
-- in wallpro-brand.ts is hand-edited, and the whole thing ships in a release.
-- That is a marketing decision behind an engineering queue, and it is why the
-- gym pair took a dozen messages to land. This table is the fix: the curator
-- uploads a pair, writes its words, orders it, publishes it -- no deploy.
--
-- THE BUILT-IN TABLE STAYS as the fallback (see wallpro-brand.ts). An empty
-- table, an unreachable database or a signed-out read must not blank the band
-- on the partner's own product page, so the code reads rows first and falls
-- back to what ships in the bundle. That also means this migration changes
-- nothing until the curator actually adds a row.
--
-- WHY A PUBLIC BUCKET. wallpro-files is private and every read of it is a
-- signed URL. The band paints for an anonymous first-time visitor before
-- anything else on the page, so a signed read would put an authenticated round
-- trip on the critical path of a marketing image -- and would simply fail for
-- the signed-out visitor the band exists to convince. Marketing proofs are
-- public by nature: they are the pictures we most want strangers to see. This
-- is the same call graphicspro-files already makes, for the same reason.

-- ── The bucket ────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wallpro-proofs', 'wallpro-proofs', true, 20971520,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Anyone may read (that is the point); only a curator may write. Named and
-- dropped first so re-running this migration is a no-op rather than a conflict.
DROP POLICY IF EXISTS wallpro_proofs_public_read ON storage.objects;
CREATE POLICY wallpro_proofs_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'wallpro-proofs');

DROP POLICY IF EXISTS wallpro_proofs_curator_write ON storage.objects;
CREATE POLICY wallpro_proofs_curator_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'wallpro-proofs' AND (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'tester'::public.app_role)))
  WITH CHECK (bucket_id = 'wallpro-proofs' AND (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'tester'::public.app_role)));

-- ── The rows ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallpro_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which page this pair belongs to. The band is per-brand because a partner's
  -- visitor should recognise the partner's own work; 'weprintwraps' is the
  -- only brand showing one today and the column is what lets the next one in
  -- without a schema change.
  brand text NOT NULL DEFAULT 'weprintwraps' CHECK (brand IN ('weprintwraps','designpro')),
  -- Storage paths inside wallpro-proofs, never URLs: a URL in a row is a
  -- promise about a host that outlives the host.
  before_path text NOT NULL,
  after_path text NOT NULL,
  -- The words. `alt` is required because a before/after with no alt text is a
  -- blank space to a screen reader, and this band is the page's first content.
  headline text NOT NULL,
  caption text NOT NULL,
  alt text NOT NULL,
  -- Ordering is explicit, not by date: the most persuasive room leads, and
  -- that is a judgement the curator makes, not a function of upload time.
  position integer NOT NULL DEFAULT 0,
  -- Unpublished rows are drafts: uploaded, described, not yet shown.
  published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallpro_proofs_band
  ON public.wallpro_proofs(brand, published, position);

ALTER TABLE public.wallpro_proofs ENABLE ROW LEVEL SECURITY;

-- A PUBLISHED row is readable by anyone, signed in or not -- the band's whole
-- audience is strangers. Drafts are curator-only.
DROP POLICY IF EXISTS wallpro_proofs_read_published ON public.wallpro_proofs;
CREATE POLICY wallpro_proofs_read_published ON public.wallpro_proofs
  FOR SELECT TO anon, authenticated USING (published);

DROP POLICY IF EXISTS wallpro_proofs_curator_all ON public.wallpro_proofs;
CREATE POLICY wallpro_proofs_curator_all ON public.wallpro_proofs
  FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR public.has_role((SELECT auth.uid()), 'tester'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
           OR public.has_role((SELECT auth.uid()), 'tester'::public.app_role));

REVOKE ALL ON TABLE public.wallpro_proofs FROM PUBLIC;
GRANT SELECT ON TABLE public.wallpro_proofs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.wallpro_proofs TO authenticated;
GRANT ALL ON TABLE public.wallpro_proofs TO service_role;

COMMENT ON TABLE public.wallpro_proofs IS
  'Before/after pairs shown in the WallPro hero band. Curator-managed (admin/tester); published rows are world-readable. The built-in list in wallpro-brand.ts remains the fallback when this table is empty or unreachable.';
