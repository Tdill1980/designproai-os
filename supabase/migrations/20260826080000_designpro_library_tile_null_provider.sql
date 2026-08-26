-- THREE-VALUED LOGIC ATE FIFTEEN LIBRARY TILES.
--
-- 20260826070000 gave the library tile the same shape test as the workspace:
-- the Driver view must carry none of the four retired anchor/mirror keys. But
-- `(metadata->'provider') ? 'key'` is NULL when the view has no provider
-- object at all -- true of fifteen older Standard drivers -- and NOT NULL is
-- NULL, so the WHERE clause quietly dropped them and the tile count fell from
-- 25 to 19 the moment the migration applied. Measured live, not inferred.
--
-- Each existence test now COALESCEs to false: a missing provider object is
-- not evidence of the retired shape. The workspace read is deliberately NOT
-- given the same relaxation -- it applies the test only to flat-first views,
-- where a missing provider object is malformed and fail-closed is correct.

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
          -- The Driver proof itself must be sound under the current sibling
          -- contract; the run's overall completeness verdict no longer blanks
          -- the tile, for the same reason the workspace no longer blanks the
          -- proofs (RULE 0.23 -- nothing finished waits on a bundle).
          AND COALESCE(v.metadata#>>'{provider,anchoredToView1}','false')='false'
          -- COALESCE each existence test: `? key` on a NULL provider object is
          -- NULL, and NOT NULL is NULL, which silently excluded every older
          -- Standard driver whose view predates provider metadata -- fifteen
          -- of them, live, the moment 20260826070000 applied. Absence of a
          -- provider object is not evidence of the retired shape.
          AND NOT COALESCE((v.metadata->'provider') ? 'driverContentHash', false)
          AND NOT COALESCE((v.metadata->'provider') ? 'deterministicMirror', false)
          AND NOT COALESCE((v.metadata->'provider') ? 'passengerProducer', false)
          AND NOT COALESCE((v.metadata->'provider') ? 'atlasZonePassedToPassengerRepair', false)
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
