-- REVISIONSTUDIOIQ READS THE DESIGN IT IS OPENED ON.
--
-- RevisionStudioIQ is routed at /revision-studio and its ~7,500 lines of
-- product UI are already here. What was missing is everything underneath it,
-- and the three gaps were measurable rather than aesthetic:
--
--   1. THE SEVEN PROOFS WERE UNREADABLE BY ANYONE. The gateway's
--      /api/jobs/:id/approved-views resolves a generation by selecting
--      `designpro_generation_requests` and then `designpro_generation_views`
--      with the CALLER's token. Both tables are service-role only --
--      `REVOKE ALL ... FROM PUBLIC,anon,authenticated` in the Calls 1-7
--      adapter -- so that select is refused for every customer and every
--      operator alike. The studio's source catches the failure, publishes an
--      empty `render_urls`, and the grid's own "a card needs an image" rule
--      then drops the design. A design that produced seven correct proofs
--      disappears from the studio entirely. The sanctioned read is the
--      SECURITY DEFINER path (`designpro_generation_view_paths`), and it is
--      keyed by request id, which is precisely the resolver nothing had.
--
--   2. THE SIX PANELS WERE NEVER PUBLISHED. Call 1 cuts them
--      (`cutCallOnePanels`) and records each one's storage path, content hash,
--      trim and print inches, 5" bleed, square footage and effective PPI on
--      `designpro_flat_atlas_revisions.metadata.callOnePanels`. Nothing read
--      that key. The studio's right column asked `loadProductionLayers`
--      instead, which returns null until `panels.build` completes -- and
--      `panels.build` is post-purchase by RULE 0.19. So the entice column was
--      empty by construction for every free run, which is the state the whole
--      product entices from.
--
--   3. DESIGN STAFF COULD SEE NOTHING. `designpro_qc_members` already carries
--      the design team, and `designpro_generation_requests` already grants
--      them read. That grant exists on exactly one table: views, atlas
--      revisions, runs, stages, artifacts and revision sources are all
--      owner-only, as is every storage policy. So a QC member opening a
--      customer's generation got a request row and nothing else.
--
-- This migration closes all three at the data seam. It adds no producer, no
-- second numbering, and no new copy of any asset: every value it returns is
-- one the runtime already wrote.

-- ONE DEFINITION OF "MAY THIS CALLER READ THIS DESIGN".
--
-- Owner, or a design-team member the operator bootstrap already admitted.
-- `can_preflight` is the same predicate `designpro_generation_requests` has
-- carried since the QC delivery migration, so this widens nothing: it applies
-- the existing membership contract to the rest of one design's record instead
-- of leaving it on a single table. A customer still sees only their own work --
-- the owner branch is unchanged and no policy below drops it.
CREATE OR REPLACE FUNCTION designpro_private.caller_may_read_generation(
  p_generation_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(auth.jwt()->>'role','') = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.designpro_generation_requests r
      WHERE r.generation_id = p_generation_id
        AND r.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.designpro_qc_members q
      WHERE q.user_id = (SELECT auth.uid()) AND q.can_preflight
    );
$fn$;

-- Only the SECURITY DEFINER readers below call this, and they run as the
-- function owner, so no caller needs EXECUTE of their own.
REVOKE ALL ON FUNCTION designpro_private.caller_may_read_generation(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON FUNCTION designpro_private.caller_may_read_generation(uuid) IS
  'Owner of the generation, or a designpro_qc_members design-team member with can_preflight. The one predicate every RevisionStudio read authorizes against.';

-- The same question about the caller alone, for storage policies that are
-- handed a path rather than a generation id.
CREATE OR REPLACE FUNCTION designpro_private.caller_is_design_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.designpro_qc_members q
    WHERE q.user_id = (SELECT auth.uid()) AND q.can_preflight
  );
$fn$;

-- EXECUTE stays with `authenticated`, exactly as
-- `designpro_private.caller_owns_generation` carries it, because the storage
-- and table policies below evaluate this in the caller's own context. It
-- discloses one fact about the caller themselves -- whether they are on the
-- design team -- and nothing about any design.
REVOKE ALL ON FUNCTION designpro_private.caller_is_design_staff()
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION designpro_private.caller_is_design_staff()
  TO authenticated,service_role;

COMMENT ON FUNCTION designpro_private.caller_is_design_staff() IS
  'True for a designpro_qc_members member with can_preflight. Never true for a customer.';

-- THE GENERATION-KEYED TWIN OF designpro_generation_view_paths.
--
-- The request-scoped reader already exists and is correct; what nothing had
-- was a way to reach it from a generation id, which is the only id
-- RevisionStudio, PanelPro and every deep link actually hold. So this resolves
-- the request from the generation, applies the SAME flat-first fence the
-- request-scoped reader applies, and returns the identities the gateway signs.
--
-- THE FENCE IS REPORTED, NOT RAISED. `designpro_generation_view_paths` raises
-- `flat_first_atlas_new_run_required` for a view set authored under the
-- superseded parent/child shape, which is right for a caller that is about to
-- build on those views. RevisionStudio is not: it is the surface a person opens
-- to LOOK at a design and ask for a new one. Killing the whole read would take
-- the master, the six panels and the entire revision history down with it, so
-- the verdict is returned as `viewsSuperseded` with an empty view list. The
-- proofs are still withheld -- exactly as the fence intends -- and the studio
-- says so in as many words instead of showing an empty page.
CREATE OR REPLACE FUNCTION public.designpro_generation_workspace(
  p_generation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_row public.designpro_generation_requests%ROWTYPE;
  v_superseded boolean;
  v_views jsonb;
BEGIN
  SELECT * INTO v_row
  FROM public.designpro_generation_requests
  WHERE generation_id=p_generation_id
  ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT designpro_private.caller_may_read_generation(p_generation_id)
  THEN RETURN NULL; END IF;

  v_superseded := designpro_private.flat_first_atlas_requires_new_run(v_row.id);

  IF v_superseded THEN
    v_views := '[]'::jsonb;
  ELSE
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'sourceViewType',v.source_view_type,
      'consumerRole',v.consumer_role,
      'storagePath',v.storage_path,
      'contentHash',v.content_hash,
      'contentType',v.content_type,
      'byteSize',v.byte_size,
      -- The read-only A.T.L.A.S. binding, so the studio can state which master
      -- each proof was rendered from rather than assuming they agree. Same
      -- five facts the run-scoped read has always projected, from the same
      -- provider metadata -- this is a second address for one record, never a
      -- second record.
      'atlasMasterContentHash',v.metadata#>>'{provider,atlasMasterContentHash}',
      'atlasZoneContentHash',v.metadata#>>'{provider,atlasZoneContentHash}',
      'atlasZoneSurfaceKey',v.metadata#>>'{provider,atlasZoneSurfaceKey}',
      'atlasAnchoredToDriver',pg_catalog.coalesce(
        v.metadata#>'{provider,anchoredToView1}','false'::jsonb)='true'::jsonb,
      'atlasDeterministicMirror',pg_catalog.coalesce(
        v.metadata#>'{provider,deterministicMirror}','false'::jsonb)='true'::jsonb,
      'atlasRevisionId',v.metadata#>>'{authority,revisionId}'
    ) ORDER BY v.source_view_type),'[]'::jsonb)
    INTO v_views
    FROM public.designpro_generation_views v
    WHERE v.request_id=v_row.id AND v.superseded_at IS NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'requestId',v_row.id,
    'generationId',v_row.generation_id,
    'ownerId',v_row.owner_id,
    'tenantKey',v_row.tenant_key,
    'state',v_row.state,
    -- The customer's own words, verbatim. A revision is authored from this
    -- text plus the requested change, so a paraphrase here would rebuild the
    -- design against words nobody typed.
    'brief',v_row.request_input->>'brief',
    'designName',v_row.request_input->>'designName',
    'companyName',v_row.request_input->>'companyName',
    'finish',v_row.request_input->>'finish',
    'vehicle',v_row.request_input->'vehicle',
    'pipelineMode',v_row.request_input->>'pipelineMode',
    'contractVersion',v_row.request_input->>'contractVersion',
    -- The failure the generation recorded, so a design that died in Calls 1-7
    -- says why instead of reading as one that is still working.
    'error',v_row.error,
    'createdAt',v_row.created_at,
    'updatedAt',v_row.updated_at,
    'completedAt',v_row.completed_at,
    'viewsSuperseded',v_superseded,
    'views',v_views
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.designpro_generation_workspace(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designpro_generation_workspace(uuid)
  TO authenticated,service_role;

COMMENT ON FUNCTION public.designpro_generation_workspace(uuid) IS
  'One generation as RevisionStudioIQ opens it: identity, the customer brief, and the seven approved view identities. Authorized for the owner or design staff; superseded flat-first view sets are reported, never served.';

-- THE SIX CALL-1 PANELS BECOME READABLE, AND DESIGN STAFF BECOME READERS.
--
-- Replaced whole rather than text-patched: this function is defined exactly
-- once (20260824030000) and has never been patched, and the live body was
-- compared against that file before this was written. The two changes are the
-- authorization line and the two added keys; every other line is the existing
-- body verbatim.
--
-- `callOnePanels` is the record `cutCallOnePanels` already wrote -- surface
-- key, storage path, content hash, pixel size, trim and print inches, the 5"
-- bleed, square footage, effective PPI and the master it was cut from. It is
-- not the manifest's `zones`: those are the atlas LAYOUT geometry, while these
-- are the panels themselves, and only these carry a hash the customer's file
-- can be identified by.
CREATE OR REPLACE FUNCTION public.designpro_flat_atlas_generation_paths(
  p_generation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_owner uuid;
  v_rows jsonb;
BEGIN
  SELECT r.owner_id INTO v_owner
  FROM public.designpro_generation_requests r
  WHERE r.generation_id=p_generation_id
  ORDER BY r.created_at LIMIT 1;
  IF v_owner IS NULL THEN RETURN NULL; END IF;
  IF NOT designpro_private.caller_may_read_generation(p_generation_id)
  THEN RETURN NULL; END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',r.id,
    'requestId',r.request_id,
    'generationId',r.generation_id,
    'ownerId',r.owner_id,
    'parentRevisionId',r.parent_revision_id,
    'revisionSequence',r.revision_sequence,
    'guideStoragePath',r.guide_storage_path,
    'guideContentHash',r.guide_content_hash,
    'guideByteSize',r.guide_byte_size,
    'guideContentType',r.guide_content_type,
    'manifestContentHash',r.manifest_content_hash,
    'manifestByteSize',r.manifest_byte_size,
    'manifestContentType',r.manifest_content_type,
    'masterStoragePath',r.master_storage_path,
    'masterContentHash',r.master_content_hash,
    'masterByteSize',r.master_byte_size,
    'masterContentType',r.master_content_type,
    'projectionStoragePath',r.projection_storage_path,
    'projectionContentHash',r.projection_content_hash,
    'projectionByteSize',r.projection_byte_size,
    'projectionContentType',r.projection_content_type,
    'affectedSurfaces',r.affected_surfaces,
    'instruction',r.instruction,
    'productionEligible',r.production_eligible,
    'model',r.model,
    'promptVersion',r.prompt_version,
    'widthPx',r.width_px,
    'heightPx',r.height_px,
    'effectivePpi',r.effective_ppi,
    -- The immutable manifest is the geometry authority. The gateway validates
    -- and allowlists the six zone records before any of this reaches the UI.
    'panelMap',r.manifest->'zones',
    -- The six print panels Call 1 cut from this exact master. The gateway
    -- validates and signs them; an older revision that predates the record
    -- carries an empty list, which is the honest answer and the one the UI
    -- already reports as "panels still building".
    'callOnePanels',COALESCE(r.metadata->'callOnePanels','[]'::jsonb),
    'exampleUsed',r.example_used,
    'exampleGuideHash',r.example_guide_hash,
    'exampleMasterHash',r.example_master_hash,
    'createdAt',r.created_at
  ) ORDER BY r.revision_sequence),'[]'::jsonb)
  INTO v_rows FROM public.designpro_flat_atlas_revisions r
  WHERE r.generation_id=p_generation_id;
  RETURN v_rows;
END;
$fn$;

REVOKE ALL ON FUNCTION public.designpro_flat_atlas_generation_paths(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designpro_flat_atlas_generation_paths(uuid)
  TO authenticated,service_role;

-- SIGNING THE PANELS AND THE MASTER.
--
-- The existing preview policy admits exactly two objects per revision, the
-- guide and the master, and only to their owner. The six Call-1 panels were
-- never signable by anyone, which is why publishing them through the RPC alone
-- would have produced six rows with no image behind them.
--
-- `allow_only_operation('object.sign')` is kept, so this still grants no
-- listing and no direct download -- only a five-minute signed URL for an exact
-- immutable object named by its own content hash.
DROP POLICY IF EXISTS designpro_owner_read_flat_atlas_previews
  ON storage.objects;
CREATE POLICY designpro_owner_read_flat_atlas_previews
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id='wrap-files'
    AND storage.allow_only_operation('object.sign')
    AND EXISTS (
      SELECT 1
      FROM public.designpro_flat_atlas_revisions revision
      WHERE (
          revision.owner_id=(SELECT auth.uid())
          OR designpro_private.caller_is_design_staff()
        )
        AND (
          storage.objects.name=revision.guide_storage_path
          OR storage.objects.name=revision.master_storage_path
          -- The six print panels this revision's Call 1 cut, each named by the
          -- content hash recorded on the revision itself. Nothing else under
          -- the panels prefix matches, because the comparison is against the
          -- stored path and not against a pattern.
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(
              COALESCE(revision.metadata->'callOnePanels','[]'::jsonb)
            ) AS panel
            WHERE storage.objects.name=panel->>'storagePath'
          )
        )
    )
  );

COMMENT ON POLICY designpro_owner_read_flat_atlas_previews ON storage.objects IS
  'Signing access to the exact immutable Atlas guide, master and six Call-1 print panels of a revision, for its owner or design staff. Listing, direct download, manifest and projection paths are excluded.';

-- The seven proofs live under designpro/<tenant>/<generationId>/calls-1-7/.
-- Design staff read them on the same membership, and a customer's own branch
-- is untouched.
DROP POLICY IF EXISTS designpro_owner_read_generation_views ON storage.objects;
CREATE POLICY designpro_owner_read_generation_views
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id='wrap-files'
    AND (storage.foldername(name))[1]='designpro'
    AND (storage.foldername(name))[4]='calls-1-7'
    AND array_length(storage.foldername(name),1)=5
    AND (
      designpro_private.caller_owns_generation(
        (storage.foldername(name))[2],(storage.foldername(name))[3]
      )
      OR designpro_private.caller_is_design_staff()
    )
  );

COMMENT ON POLICY designpro_owner_read_generation_views ON storage.objects IS
  'The seven approved Calls 1-7 proofs of one generation, for its owner or design staff.';

-- THE PRODUCTION HALF, FOR THE PEOPLE WHO RUN IT.
--
-- Runs, stages, artifacts and revision sources are owner-only, so a design-team
-- member opening a customer's job saw no stages, no panels and no history. Each
-- policy below keeps its existing owner branch verbatim and adds the same
-- membership clause `designpro_generation_requests` has always carried. Reads
-- only: nothing here grants a write, and no customer loses isolation from
-- another customer.
DROP POLICY IF EXISTS designpro_owner_read_runs ON public.designpro_workflow_runs;
CREATE POLICY designpro_owner_read_runs
  ON public.designpro_workflow_runs
  FOR SELECT
  TO authenticated
  USING (
    owner_id=auth.uid() OR designpro_private.caller_is_design_staff()
  );

DROP POLICY IF EXISTS designpro_owner_read_stages ON public.designpro_workflow_stages;
CREATE POLICY designpro_owner_read_stages
  ON public.designpro_workflow_stages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.designpro_workflow_runs r
      WHERE r.id=designpro_workflow_stages.run_id
        AND (r.owner_id=auth.uid() OR designpro_private.caller_is_design_staff())
    )
  );

DROP POLICY IF EXISTS designpro_owner_read_artifacts ON public.designpro_artifacts;
CREATE POLICY designpro_owner_read_artifacts
  ON public.designpro_artifacts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.designpro_workflow_runs r
      WHERE r.id=designpro_artifacts.run_id
        AND (r.owner_id=auth.uid() OR designpro_private.caller_is_design_staff())
    )
  );

DROP POLICY IF EXISTS designpro_owner_read_revision_sources
  ON public.designpro_revision_sources;
CREATE POLICY designpro_owner_read_revision_sources
  ON public.designpro_revision_sources
  FOR SELECT
  TO authenticated
  USING (
    owner_id=auth.uid() OR designpro_private.caller_is_design_staff()
  );

DROP POLICY IF EXISTS designpro_owner_read_flat_atlas_revisions
  ON public.designpro_flat_atlas_revisions;
CREATE POLICY designpro_owner_read_flat_atlas_revisions
  ON public.designpro_flat_atlas_revisions
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid())=owner_id OR designpro_private.caller_is_design_staff()
  );

-- The artifact objects a run produced, and the corrected panels a designer
-- uploaded against it. Same membership, same read-only shape.
DROP POLICY IF EXISTS designpro_owner_read_wrap_files ON storage.objects;
CREATE POLICY designpro_owner_read_wrap_files
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id='wrap-files'
    AND (
      (
        (storage.foldername(name))[1]='users'
        AND (storage.foldername(name))[2]=((SELECT auth.uid()))::text
        AND (storage.foldername(name))[3]='revisions'
        AND (storage.foldername(name))[4] ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (storage.foldername(name))[5]='inputs'
        AND (storage.foldername(name))[6]=ANY(ARRAY[
          'driver','passenger','hood','roof','front','rear','closeup','hero3d','logo'
        ])
        AND array_length(storage.foldername(name),1)=6
        AND storage.filename(name) ~ '^[0-9a-f]{64}\.(png|jpg|jpeg|webp|svg|pdf)$'
      )
      OR EXISTS (
        SELECT 1 FROM public.designpro_workflow_runs r
        WHERE (
            r.owner_id=(SELECT auth.uid())
            OR designpro_private.caller_is_design_staff()
          )
          AND (
            (
              (storage.foldername(objects.name))[1]='designpro'
              AND (storage.foldername(objects.name))[2]=r.tenant_key
              AND (storage.foldername(objects.name))[3]=(r.id)::text
            )
            OR (
              (storage.foldername(objects.name))[1]='wrapbox'
              AND (storage.foldername(objects.name))[2]=r.tenant_key
              AND (storage.foldername(objects.name))[3]=(r.entice_pack_id)::text
              AND (storage.foldername(objects.name))[4]=(r.id)::text
            )
          )
      )
    )
  );

COMMENT ON POLICY designpro_owner_read_wrap_files ON storage.objects IS
  'A run''s own produced artifacts and the caller''s own uploaded revision inputs, for the run owner or design staff.';
