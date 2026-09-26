-- ISSUE 1 (2026-09-25 audit): 25 public tables had RLS OFF, ZERO policies, and
-- every privilege (incl. TRUNCATE) granted to anon and authenticated -- anyone
-- holding the public anon key could read, forge or wipe them, including the
-- token ledger (token_transactions) and render quota (render_usage). Supabase
-- advisor: rls_disabled_in_public x25 (ERROR).
--
-- Root cause: 20260817230000_designpro_functions_contract.sql deferred RLS
-- ("the chain runs service-role") and left Supabase's default grants in place.
--
-- WHAT THIS DOES NOT CHANGE
--   * service_role keeps its grants and bypasses RLS (edge functions, runtime,
--     legacy worker).
--   * The 29 SECURITY DEFINER functions that touch these tables are owned by
--     postgres (the table owner); RLS is ENABLED, not FORCED, so they behave
--     exactly as before.
--
-- ACCESS MAP (measured live traffic, 24 h to 2026-09-25 17:56 PT: the only
-- browser path is 3 authenticated GETs on panelizer_jobs; everything else is
-- service_role). Every browser read/write found in app/src is kept:
--   catalogs  read: anon+authenticated      write: admin
--   owner     read/write own rows (user_id = auth.uid()) where the app does it;
--             design staff (designpro_qc_members.can_preflight) read production
--             rows and update panelizer_jobs (QC pages); admin all
--   children  through the parent's owner, or as documented below
--   server    admin only (service_role unaffected)
--
-- Rollback (per table):  ALTER TABLE public.<t> DISABLE ROW LEVEL SECURITY;
--   GRANT ALL ON public.<t> TO anon, authenticated;  (and DROP POLICY the
--   policies below). The full script is in the PR description.

DO $rls$
DECLARE
  t text;
  all_tables text[] := ARRAY[
    'blocked_users','design_version_commits','designpro_entice_packs',
    'designpro_production_jobs','manufacturer_colors','moderation_log',
    'panel_artboard_assets','panel_artboard_jobs','panelizer_jobs',
    'production_flow_assets','production_panel_dispatches','production_panels',
    'proof_events','render_events','render_templates','render_usage',
    'token_transactions','vehicle_dimensions','vehicle_renders',
    'vehicle_specs_cache','vinyl_reference_images','vinyl_swatches',
    'workflow_resource_leases','workflow_stage_runs','workforce_runs'];
  catalogs text[] := ARRAY[
    'manufacturer_colors','vinyl_swatches','vinyl_reference_images',
    'vehicle_dimensions','vehicle_specs_cache','vehicle_renders','render_templates'];
BEGIN
  FOREACH t IN ARRAY all_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- RLS does not govern TRUNCATE, TRIGGER or REFERENCES: take every client
    -- privilege away, then grant back only DML that a policy below gates.
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.has_role((SELECT auth.uid()), ''admin''::public.app_role)) '
      'WITH CHECK (public.has_role((SELECT auth.uid()), ''admin''::public.app_role))',
      t || '_admin_all', t);
  END LOOP;

  FOREACH t IN ARRAY catalogs LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_public_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
      t || '_public_read', t);
  END LOOP;
END
$rls$;

-- OWNER ROWS -----------------------------------------------------------------

-- panelizer_jobs: the one live browser path (MyProductionPacksCard,
-- useQuickProductionPack, ProductionFlow, QCCutContour, TwoDProofArtboard,
-- DesignProToolUI insert). Customers read/insert/update their own jobs; the
-- design team reads and updates for QC.
CREATE POLICY panelizer_jobs_owner_or_staff_read ON public.panelizer_jobs
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR designpro_private.caller_is_design_staff());
CREATE POLICY panelizer_jobs_owner_insert ON public.panelizer_jobs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY panelizer_jobs_owner_or_staff_update ON public.panelizer_jobs
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR designpro_private.caller_is_design_staff())
  WITH CHECK (user_id = (SELECT auth.uid()) OR designpro_private.caller_is_design_staff());

-- design_version_commits: lib/revision-commits.ts inserts and reads.
CREATE POLICY design_version_commits_owner_or_staff_read ON public.design_version_commits
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR designpro_private.caller_is_design_staff());
CREATE POLICY design_version_commits_owner_insert ON public.design_version_commits
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Production records the app only reads (ProductionPackQCCard etc.).
CREATE POLICY designpro_entice_packs_owner_or_staff_read ON public.designpro_entice_packs
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR designpro_private.caller_is_design_staff());
CREATE POLICY designpro_production_jobs_owner_or_staff_read ON public.designpro_production_jobs
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR designpro_private.caller_is_design_staff());
CREATE POLICY panel_artboard_jobs_owner_or_staff_read ON public.panel_artboard_jobs
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR designpro_private.caller_is_design_staff());
CREATE POLICY production_panels_owner_read ON public.production_panels
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Money: a customer sees only their own ledger and usage. render_usage keeps
-- the own-row INSERT that useRenderLimits/useBulkRenderQueue make (it can
-- only count against the caller). No client UPDATE/DELETE on either.
CREATE POLICY render_usage_owner_read ON public.render_usage
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY render_usage_owner_insert ON public.render_usage
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY token_transactions_owner_read ON public.token_transactions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- CHILD ROWS -----------------------------------------------------------------

CREATE POLICY panel_artboard_assets_parent_owner_or_staff_read ON public.panel_artboard_assets
  FOR SELECT TO authenticated
  USING (designpro_private.caller_is_design_staff() OR EXISTS (
    SELECT 1 FROM public.panel_artboard_jobs j
    WHERE j.id = panel_artboard_assets.job_id AND j.user_id = (SELECT auth.uid())));

-- proof_events: the parent proof tables are not in this database, so rows are
-- scoped to their actor. ApproveProPage inserts with actor_user_id = user.id.
CREATE POLICY proof_events_actor_or_staff_read ON public.proof_events
  FOR SELECT TO authenticated
  USING (actor_user_id = (SELECT auth.uid()) OR designpro_private.caller_is_design_staff());
CREATE POLICY proof_events_actor_insert ON public.proof_events
  FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = (SELECT auth.uid()));

-- production_flow_assets: job_id points at several parents (wall panel jobs,
-- entice packs) with no FK, and WallPro tenant scoping is paused by the owner.
-- Keep today's signed-in read + insert (wallPanelize.ts, DesignAssetsPanel,
-- miniWrapKit) so nothing breaks; remove anon, TRUNCATE, and client
-- UPDATE/DELETE. Per-owner scoping is a follow-up.
CREATE POLICY production_flow_assets_signed_in_read ON public.production_flow_assets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY production_flow_assets_signed_in_insert ON public.production_flow_assets
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- SERVER-ONLY: blocked_users, moderation_log, render_events,
-- production_panel_dispatches, workflow_resource_leases, workflow_stage_runs,
-- workforce_runs -- admin policy only (above).
