-- WallPro production reaches the design team (owner, 2026-09-11: "why can't
-- these go to RevisionStudio and PanelPro so my team can download print-ready
-- from there"). The customer's own rows stay owner-scoped; admins and testers
-- additionally READ every WallPro project, version, production job and file so
-- the PanelPro/admin studio can list and download the 150 PPI panels for any
-- customer. No team write path is added: production artifacts stay immutable.
CREATE POLICY wallpro_team_read_projects ON public.wallpro_projects FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));
CREATE POLICY wallpro_team_read_versions ON public.wallpro_design_versions FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));
CREATE POLICY wallpro_team_read_jobs ON public.wallpro_production_jobs FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role));
CREATE POLICY wallpro_team_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='wallpro-files' AND (public.has_role((SELECT auth.uid()),'admin'::public.app_role) OR public.has_role((SELECT auth.uid()),'tester'::public.app_role)));
