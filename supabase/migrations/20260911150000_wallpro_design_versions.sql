-- WallPro design sessions: CREATE -> REFINE* -> APPROVE -> PRODUCTION.
--
-- Owner directive (2026-09-11): a generated or uploaded design must stay
-- editable through natural-language changes without restarting the project.
-- Every refinement operates on the current version and creates a new
-- immutable version; composition and unaffected regions are preserved by
-- default; any prior version can be restored; production (upscale,
-- panelization, QC) runs only on an APPROVED version.
--
-- A version is a row pointing at artwork bytes the owner already holds
-- (their generated master, an upload, a catalog master, or a masked
-- composite they produced). Bytes are never rewritten: storage stays
-- immutable for users, and a version row's identity fields are frozen by
-- trigger. The project's current version is the newest row unless the
-- customer restores an earlier one, which is recorded in the project config.
CREATE TABLE public.wallpro_design_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.wallpro_projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no >= 1),
  parent_version_id uuid REFERENCES public.wallpro_design_versions(id) ON DELETE SET NULL,
  -- create: first generation · refine: a change applied to the parent ·
  -- upload: the customer's own file · catalog: a picked ready design ·
  -- composite: a masked refinement merged over its parent outside the mask
  kind text NOT NULL CHECK (kind IN ('create','refine','upload','catalog','composite')),
  intent text CHECK (intent IS NULL OR intent IN ('prompt','match','wall','refine')),
  prompt text CHECK (prompt IS NULL OR length(prompt) <= 6000),
  mask_path text,
  reference_path text,
  artwork_path text NOT NULL,
  width_px integer CHECK (width_px IS NULL OR width_px > 0),
  height_px integer CHECK (height_px IS NULL OR height_px > 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  generation_id uuid REFERENCES public.wallpro_generations(id) ON DELETE SET NULL,
  design_id text CHECK (design_id IS NULL OR design_id ~ '^WPB-[0-9A-Z][0-9A-Z-]{3,19}$'),
  placement text NOT NULL DEFAULT 'cover' CHECK (placement IN ('cover','contain','repeat')),
  repeat_width_in numeric CHECK (repeat_width_in IS NULL OR (repeat_width_in >= 1 AND repeat_width_in <= 2400)),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  note text CHECK (note IS NULL OR length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  UNIQUE (project_id, version_no),
  CHECK (starts_with(artwork_path, owner_id::text||'/') OR starts_with(artwork_path, 'catalog/')),
  CHECK (mask_path IS NULL OR starts_with(mask_path, owner_id::text||'/')),
  CHECK (reference_path IS NULL OR starts_with(reference_path, owner_id::text||'/')),
  CHECK ((status='approved') = (approved_at IS NOT NULL))
);
-- One approved version per project: production binds to exactly one master.
CREATE UNIQUE INDEX wallpro_design_versions_one_approved ON public.wallpro_design_versions(project_id) WHERE status='approved';
CREATE INDEX wallpro_design_versions_project ON public.wallpro_design_versions(project_id, version_no DESC);

-- Identity fields are immutable: the only mutable state is approval and the note.
CREATE FUNCTION public.wallpro_design_version_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.project_id<>OLD.project_id OR NEW.owner_id<>OLD.owner_id OR NEW.version_no<>OLD.version_no
     OR NEW.parent_version_id IS DISTINCT FROM OLD.parent_version_id OR NEW.kind<>OLD.kind
     OR NEW.intent IS DISTINCT FROM OLD.intent OR NEW.prompt IS DISTINCT FROM OLD.prompt
     OR NEW.mask_path IS DISTINCT FROM OLD.mask_path OR NEW.reference_path IS DISTINCT FROM OLD.reference_path
     OR NEW.artwork_path<>OLD.artwork_path OR NEW.width_px IS DISTINCT FROM OLD.width_px OR NEW.height_px IS DISTINCT FROM OLD.height_px
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.generation_id IS DISTINCT FROM OLD.generation_id
     OR NEW.design_id IS DISTINCT FROM OLD.design_id OR NEW.placement<>OLD.placement
     OR NEW.repeat_width_in IS DISTINCT FROM OLD.repeat_width_in OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'wallpro_design_version_immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER wallpro_design_versions_immutable BEFORE UPDATE ON public.wallpro_design_versions
FOR EACH ROW EXECUTE FUNCTION public.wallpro_design_version_immutable();

ALTER TABLE public.wallpro_design_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallpro_version_read ON public.wallpro_design_versions FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()));
CREATE POLICY wallpro_version_insert ON public.wallpro_design_versions FOR INSERT TO authenticated WITH CHECK (owner_id=(SELECT auth.uid()));
CREATE POLICY wallpro_version_update ON public.wallpro_design_versions FOR UPDATE TO authenticated USING (owner_id=(SELECT auth.uid())) WITH CHECK (owner_id=(SELECT auth.uid()));
REVOKE ALL ON public.wallpro_design_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.wallpro_design_versions TO authenticated;
GRANT ALL ON public.wallpro_design_versions TO service_role;
REVOKE ALL ON FUNCTION public.wallpro_design_version_immutable() FROM PUBLIC,anon,authenticated;
