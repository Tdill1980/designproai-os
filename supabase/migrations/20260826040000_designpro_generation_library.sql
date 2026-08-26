-- THE DESIGN LIBRARY: THE LAST FOUR MONTHS OF REAL DESIGNPRO WORK.
--
-- RevisionStudioIQ could open one design. It could not show you which designs
-- exist, and the reason is worth stating exactly, because it is the same shape
-- of mistake twice over.
--
-- ITS FEED WAS KEYED ON WORKFLOW RUNS. `GET /api/jobs` lists
-- `designpro_workflow_runs`, capped at 100, filtered to the entice and
-- production pack types. A run is created by the PRODUCTION HANDOFF -- so a
-- generation that has not been handed off has no run, and there is nothing in
-- that list to represent it. Measured over the last four months: 48 real
-- DesignPro generations, and 8 of them have a run. The other 40 -- including
-- every design still in Calls 1-7 and every one that failed there -- were
-- unreachable from the studio built to revise them. That is the "recent work
-- crowded out of the window" defect: not a sort order, an entirely wrong table.
--
-- AND THE GRID DROPPED WHAT SURVIVED. The card feed filters to rows carrying at
-- least one image, so a design whose proofs are still rendering, or whose proof
-- set the server has superseded, vanished rather than appearing as itself.
--
-- So the library reads the generation records themselves, which is the one
-- table that has a row for every design from the moment Create Design is
-- pressed. It is deliberately ONE table: no union with a featured list, no
-- legacy render table, no ColorPro visualizations. A union is how a curated old
-- row takes a slot a recent one needed, and there is nothing here to curate.
--
-- A DESIGN WITH NOTHING TO SHOW IS STILL IN THE LIBRARY. Sixteen of those 48
-- produced no image at all. They are the failures a designer most needs to
-- find, so they are returned with a null thumbnail and their real state, never
-- filtered out to make the grid look healthier than the work.

CREATE OR REPLACE FUNCTION public.designpro_generation_library(
  p_since timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_owner uuid := auth.uid();
  v_staff boolean;
  v_since timestamptz;
  v_limit integer;
  v_rows jsonb;
BEGIN
  IF v_owner IS NULL
    OR COALESCE(auth.jwt()->>'is_anonymous','false')='true'
  THEN RAISE EXCEPTION 'authentication_required'; END IF;

  -- Four months is the default window and the caller may widen it. It is a
  -- window, never a cap on how much of that window is returned: a page size
  -- smaller than the window is exactly how recent work goes missing.
  v_since := COALESCE(p_since, pg_catalog.now() - interval '4 months');
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);

  -- Design staff see the whole shop's work; a customer sees their own. Same
  -- membership contract every other read in this system authorizes against.
  v_staff := designpro_private.caller_is_design_staff();

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(entry) ORDER BY entry.created_at DESC
  ),'[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      r.id AS "requestId",
      r.generation_id AS "generationId",
      r.owner_id AS "ownerId",
      r.state,
      r.created_at,
      r.updated_at AS "updatedAt",
      r.completed_at AS "completedAt",
      r.request_input->>'designName' AS "designName",
      r.request_input->>'companyName' AS "companyName",
      r.request_input->>'brief' AS brief,
      r.request_input->>'finish' AS finish,
      r.request_input->'vehicle' AS vehicle,
      -- A.T.L.A.S. or Standard, decided by what the request actually asked for
      -- rather than by what it happens to have produced so far.
      CASE
        WHEN r.request_input->>'pipelineMode'='flat-first-atlas-v1'
          OR r.request_input->>'contractVersion'='designpro.calls-1-7-input.v3'
        THEN 'atlas' ELSE 'standard'
      END AS pipeline,
      -- The accepted version this design stands at. The A.T.L.A.S. revision
      -- sequence IS the version number -- the same one PanelPro and the studio
      -- timeline read -- so there is no second numbering here.
      (
        SELECT pg_catalog.count(*)::int
        FROM public.designpro_flat_atlas_revisions a
        WHERE a.request_id=r.id
      ) AS "revisionCount",
      (
        SELECT pg_catalog.max(a.revision_sequence)
        FROM public.designpro_flat_atlas_revisions a
        WHERE a.request_id=r.id
      ) AS "currentRevision",
      (
        SELECT pg_catalog.count(*)::int
        FROM public.designpro_generation_views v
        WHERE v.request_id=r.id AND v.superseded_at IS NULL
      ) AS "viewCount",
      designpro_private.flat_first_atlas_requires_new_run(r.id) AS "viewsSuperseded",
      -- THE TILE IS A 3D PROOF, OR NOTHING.
      --
      -- ⛔ NEVER THE A.T.L.A.S. MASTER. The library lives in RevisionStudioIQ,
      -- which is the customer's surface, and the flattened master is never
      -- shown to a client -- it belongs to PanelPro Studio under the A.T.L.A.S.
      -- generation id. This briefly fell back to `master_storage_path` for a
      -- design with no servable proof, which would have put the production
      -- authority on a customer's screen. A design with nothing servable shows
      -- no tile and says why, which is both honest and the rule.
      --
      -- A superseded view set is not used as a preview either: the same fence
      -- that withholds those proofs in the workspace withholds them here, so
      -- one design cannot look current in the library and be refused inside it.
      (
        SELECT v.storage_path
        FROM public.designpro_generation_views v
        WHERE v.request_id=r.id AND v.superseded_at IS NULL
          AND v.consumer_role='driver'
          AND NOT designpro_private.flat_first_atlas_requires_new_run(r.id)
        LIMIT 1
      ) AS "thumbnailStoragePath",
      -- Manufacturing, when it has started. Null is the honest answer for a
      -- design nobody has ordered, which is most of them.
      (
        SELECT pg_catalog.jsonb_build_object(
          'runId',w.id,'status',w.status,'workflowType',w.workflow_type,
          'orderNumber',s.snapshot->>'orderNumber','startedAt',w.created_at
        )
        FROM public.designpro_workflow_runs w
        JOIN public.designpro_revision_sources s ON s.revision_id=w.revision_id
        WHERE s.generation_id=r.generation_id
        ORDER BY w.created_at DESC LIMIT 1
      ) AS production
    FROM public.designpro_generation_requests r
    WHERE r.created_at >= v_since
      AND (v_staff OR r.owner_id=v_owner)
    ORDER BY r.created_at DESC
    LIMIT v_limit
  ) AS entry;

  RETURN v_rows;
END;
$fn$;

REVOKE ALL ON FUNCTION public.designpro_generation_library(timestamptz,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designpro_generation_library(timestamptz,integer)
  TO authenticated,service_role;

COMMENT ON FUNCTION public.designpro_generation_library(timestamptz,integer) IS
  'Every DesignPro generation in a window, newest first, from the generation records themselves. One table: no featured union, no legacy render table, no ColorPro visualizations. A design with no image is returned with a null thumbnail, never dropped.';
