-- COALESCE IS A SQL CONSTRUCT, NOT A FUNCTION IN pg_catalog.
--
-- `20260826030000` wrote `pg_catalog.coalesce(...)` twice, inside the
-- `jsonb_agg` that projects each approved view. Postgres parses it happily and
-- the migration applied clean in shadow and in production -- because the
-- expression is only ever EVALUATED when the aggregate has a row to evaluate
-- it over.
--
-- So the defect hid behind exactly the wrong condition. A generation whose
-- proofs the sibling fence withholds aggregates zero rows, returns '[]', and
-- looks perfect. A generation that actually HAS approved views -- which is the
-- entire reason RevisionStudio opens -- dies with:
--
--   ERROR: function pg_catalog.coalesce(jsonb, jsonb) does not exist
--
-- Every check I ran passed because I ran them against the acceptance
-- generation, whose seven proofs are withheld. That is the same shape of
-- mistake CLAUDE.md already records one section above: validating that a
-- migration APPLIES proves you produced parseable text, never that the body
-- you left behind runs. A PL/pgSQL body is compiled per-expression on first
-- execution, so "it applied" and "it works" are different claims, and only
-- calling it on real data separates them.
--
-- `SET search_path = ''` is what makes the reflex to qualify everything
-- correct, and it is still correct -- for FUNCTIONS and OPERATORS and TYPES.
-- COALESCE, NULLIF, GREATEST, LEAST, CASE and the aggregates' syntax forms are
-- grammar, resolved by the parser before any schema is consulted. They take no
-- qualifier and reject one.
--
-- Locked by `supabase/tests/generation_workspace_contract.test.sql`, which
-- calls the function over a view row rather than asserting on its source text.

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
      'id',v.id,
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
      'atlasAnchoredToDriver',COALESCE(
        v.metadata#>'{provider,anchoredToView1}','false'::jsonb)='true'::jsonb,
      'atlasDeterministicMirror',COALESCE(
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
