-- AN ACCEPTED PROOF IS NEVER HELD BACK FOR AN ALL-OR-NOTHING BUNDLE.
--
-- Run 04cc0b29 (2026-08-26) finished with five accepted, hash-bound proofs --
-- including the first hood acceptance the A.T.L.A.S. pipeline ever produced --
-- six cut panels and a QC-passed master. RevisionStudioIQ showed NONE of it:
-- the workspace read returned an empty view list because
-- flat_first_atlas_requires_new_run convicts any failed run whose set is
-- INCOMPLETE, and the read treated that verdict as "withhold everything".
-- Every A.T.L.A.S. design in the library opened blank. The owner's report was
-- two words: "It's broken." They were right.
--
-- RULE 0.23 already decides this: progressive publication is the contract,
-- and a finished artifact is never held back for an all-or-nothing bundle.
-- The fence's job is different and untouched here -- it still gates
-- revisions, regeneration and production on a COMPLETE valid set, and
-- viewsSuperseded still reports its verdict so the studio can say a new run
-- is required before revising.
--
-- What changes is only what the READ shows: a flat-first view is presented
-- when it is individually sound under the CURRENT sibling contract --
-- projected directly from the master (anchoredToView1 false or absent) and
-- carrying none of the four retired anchor/mirror keys the fence refuses. A
-- view authored under the retired shape stays withheld exactly as before.
-- Standard runs are untouched.

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
  v_flat_first boolean;
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

  v_flat_first :=
    v_row.request_input->>'contractVersion'='designpro.calls-1-7-input.v3'
    AND v_row.request_input->>'pipelineMode'='flat-first-atlas-v1';

  -- Reported, never used to blank the workspace: true means a REVISION must
  -- start a new A.T.L.A.S. run, not that the accepted proofs stopped existing.
  v_superseded := designpro_private.flat_first_atlas_requires_new_run(v_row.id);

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',v.id,
    'sourceViewType',v.source_view_type,
    'consumerRole',v.consumer_role,
    'storagePath',v.storage_path,
    'contentHash',v.content_hash,
    'contentType',v.content_type,
    'byteSize',v.byte_size,
    'atlasMasterContentHash',v.metadata#>>'{provider,atlasMasterContentHash}',
    'atlasZoneContentHash',v.metadata#>>'{provider,atlasZoneContentHash}',
    'atlasZoneSurfaceKey',v.metadata#>>'{provider,atlasZoneSurfaceKey}',
    'atlasAnchoredToDriver',COALESCE(
      v.metadata#>'{provider,anchoredToView1}','false'::jsonb)='true'::jsonb,
    'atlasDeterministicMirror',COALESCE(
      v.metadata#>'{provider,deterministicMirror}','false'::jsonb)='true'::jsonb,
    'atlasRevisionId',v.metadata#>>'{authority,revisionId}'
  ) ORDER BY v.source_view_type),'[]'::jsonb)
  INTO v_views
  FROM public.designpro_generation_views v
  WHERE v.request_id=v_row.id AND v.superseded_at IS NULL
    AND (
      NOT v_flat_first
      -- The current sibling shape, per view: projected directly from the
      -- master, none of the retired anchor/mirror keys. Byte-for-byte the
      -- keys designpro_private.flat_first_atlas_view_set_valid refuses.
      OR (
        COALESCE(v.metadata#>>'{provider,anchoredToView1}','false')='false'
        AND NOT ((v.metadata->'provider') ? 'driverContentHash')
        AND NOT ((v.metadata->'provider') ? 'deterministicMirror')
        AND NOT ((v.metadata->'provider') ? 'passengerProducer')
        AND NOT ((v.metadata->'provider') ? 'atlasZonePassedToPassengerRepair')
      )
    );

  RETURN pg_catalog.jsonb_build_object(
    'requestId',v_row.id,
    'generationId',v_row.generation_id,
    'ownerId',v_row.owner_id,
    'tenantKey',v_row.tenant_key,
    'state',v_row.state,
    'brief',v_row.request_input->>'brief',
    'designName',v_row.request_input->>'designName',
    'companyName',v_row.request_input->>'companyName',
    'finish',v_row.request_input->>'finish',
    'vehicle',v_row.request_input->'vehicle',
    'pipelineMode',v_row.request_input->>'pipelineMode',
    'contractVersion',v_row.request_input->>'contractVersion',
    'error',v_row.error,
    'createdAt',v_row.created_at,
    'updatedAt',v_row.updated_at,
    'completedAt',v_row.completed_at,
    'viewsSuperseded',v_superseded,
    'views',v_views
  );
END;
$fn$;


-- AND THE LIBRARY TILE FOLLOWS THE SAME RULE. The tile subquery used the
-- run-level completeness verdict, so every A.T.L.A.S. design whose run failed
-- -- which today is all of them -- showed no tile at all. The Driver proof is
-- judged on its own shape instead; a Driver authored under the retired anchor
-- keys still shows nothing.

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
          AND NOT ((v.metadata->'provider') ? 'driverContentHash')
          AND NOT ((v.metadata->'provider') ? 'deterministicMirror')
          AND NOT ((v.metadata->'provider') ? 'passengerProducer')
          AND NOT ((v.metadata->'provider') ? 'atlasZonePassedToPassengerRepair')
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
