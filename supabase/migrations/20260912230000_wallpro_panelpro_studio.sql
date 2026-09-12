-- WallPanelPro Studio: the WallPro equivalent of the vehicle PanelPro board.
--
-- Owner, 2026-09-12: "That's where I can instantly check if it took when they
-- time out and it's where we do back end designer QC checks and release gate
-- just like current vehicle wrap panelpro version."
--
-- Three things the team could not do before, and why each needs schema:
--
-- 1. SEE A TIMED-OUT GENERATION. A wall design's version row is written by the
--    CUSTOMER'S BROWSER after generate-wall-design responds. When the browser
--    gives up first the generation is still `completed` on the server with its
--    artwork in storage -- and nothing downstream exists, so the design is
--    invisible to every team surface. 20260911200000 gave admins and testers
--    read on projects, versions, jobs and files but NOT on the generation
--    table, which is the only row that records the call landing. It does now.
--
-- 2. RECOVER IT. Seeing that it took is worth little if the customer still has
--    nothing. `recover_wallpro_generation` writes the project and version row
--    the browser never got to write, from the generation's own stored input.
--    It is the ONE write path the team has into a customer's WallPro data, it
--    creates no artwork (the bytes already exist and are not touched), and it
--    is idempotent: a generation that already has a version returns that
--    version rather than making a second one.
--
-- 3. QC AND THE RELEASE GATE. `wallpro_qc_reviews` is an append-only log of
--    designer sign-offs against one immutable version. Newest row per version
--    is the current verdict; nothing is ever edited or deleted, so a release
--    that was later held still shows both, with who and when.
--
-- No customer-facing behaviour changes and no production artifact is mutable.

-- 1 ── the generation row reaches the design team (read only).
CREATE POLICY wallpro_team_read_generations ON public.wallpro_generations FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));

-- 2 ── designer QC sign-offs, append-only.
CREATE TABLE public.wallpro_qc_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.wallpro_design_versions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.wallpro_projects(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- released: this version may go to print. hold: it may not, and the notes say why.
  verdict text NOT NULL CHECK (verdict IN ('released','hold')),
  -- Which checks the reviewer ticked, by the client's check keys. Stored as
  -- given rather than as columns so a check can be added to the board without
  -- a migration; the verdict above is the part production reads.
  checks jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checks)='object' AND octet_length(checks::text)<=8000),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallpro_qc_reviews_version ON public.wallpro_qc_reviews(version_id, created_at DESC);
ALTER TABLE public.wallpro_qc_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallpro_qc_team_read ON public.wallpro_qc_reviews FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));
-- A review is signed by the person writing it: reviewer_id cannot be someone else.
CREATE POLICY wallpro_qc_team_insert ON public.wallpro_qc_reviews FOR INSERT TO authenticated
WITH CHECK (reviewer_id=(SELECT auth.uid())
  AND (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role)));
REVOKE ALL ON public.wallpro_qc_reviews FROM PUBLIC,anon,authenticated;
-- No UPDATE and no DELETE, deliberately: the log is the audit trail.
GRANT SELECT,INSERT ON public.wallpro_qc_reviews TO authenticated;
GRANT ALL ON public.wallpro_qc_reviews TO service_role;

-- 3 ── recover a completed generation the customer's browser never recorded.
--
-- Definer rights, because the rows belong to the customer and the team has no
-- write policy on them -- and must not get one: this narrow, audited operation
-- is the whole write surface. The role check is inside the body, so EXECUTE can
-- be granted to authenticated without widening anything.
--
-- The recovered design lands as a NEW project rather than being appended to one
-- of the customer's existing projects. Guessing which project a lost generation
-- belonged to would eventually append a stranger's design to live work; a new
-- project is always correct, and the customer finds it in My wall designs.
CREATE FUNCTION public.recover_wallpro_generation(p_generation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.wallpro_generations; v public.wallpro_design_versions; p public.wallpro_projects;
BEGIN
  IF NOT (public.has_role((SELECT auth.uid()),'admin'::public.app_role)
       OR public.has_role((SELECT auth.uid()),'tester'::public.app_role)) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  SELECT * INTO g FROM public.wallpro_generations WHERE id=p_generation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'generation_not_found'; END IF;
  IF g.state<>'completed' OR g.artwork_path IS NULL THEN RAISE EXCEPTION 'generation_not_completed'; END IF;

  -- Already landed -- the customer's own client recorded it, or this ran before.
  SELECT * INTO v FROM public.wallpro_design_versions WHERE generation_id=g.id
    ORDER BY created_at LIMIT 1;
  IF FOUND THEN
    SELECT * INTO p FROM public.wallpro_projects WHERE id=v.project_id;
    RETURN pg_catalog.jsonb_build_object('recovered',false,'version',pg_catalog.to_jsonb(v),'project',pg_catalog.to_jsonb(p));
  END IF;

  INSERT INTO public.wallpro_projects(owner_id,name,config)
  VALUES (
    g.owner_id,
    pg_catalog."left"(COALESCE(NULLIF(g.design_name,''),'Recovered wall design'),200),
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'artworkPath', g.artwork_path,
      'wallPath',    g.input->>'wallPath',
      'referencePath', g.input->>'referencePath',
      'width',       g.input->'width',
      'height',      g.input->'height',
      'placement',   g.input->>'placement',
      'repeatWidth', g.input->'repeatWidthIn',
      'prompt',      g.input->>'prompt',
      'recoveredFromGeneration', pg_catalog.to_jsonb(g.id)
    ))
  ) RETURNING * INTO p;

  -- kind 'create' with the generation's own intent. A refine that was lost
  -- recovers as the first version of its own project: its artwork is real and
  -- the parent it refined is not reachable from here, so claiming a lineage
  -- would be the one dishonest field on the row.
  INSERT INTO public.wallpro_design_versions
    (project_id,owner_id,version_no,kind,intent,prompt,reference_path,artwork_path,generation_id,placement,repeat_width_in,note)
  VALUES (
    p.id, g.owner_id, 1, 'create',
    NULLIF(g.input->>'intent',''),
    NULLIF(g.input->>'prompt',''),
    NULLIF(g.input->>'referencePath',''),
    g.artwork_path,
    g.id,
    COALESCE(NULLIF(g.input->>'placement',''),'cover'),
    CASE WHEN g.input->>'placement'='repeat' THEN (g.input->>'repeatWidthIn')::numeric ELSE NULL END,
    'Recovered by the design team'
  ) RETURNING * INTO v;

  RETURN pg_catalog.jsonb_build_object('recovered',true,'version',pg_catalog.to_jsonb(v),'project',pg_catalog.to_jsonb(p));
END; $$;
REVOKE ALL ON FUNCTION public.recover_wallpro_generation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.recover_wallpro_generation(uuid) TO authenticated,service_role;
