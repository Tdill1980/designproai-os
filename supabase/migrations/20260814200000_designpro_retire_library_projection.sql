-- Retire the render-library projection.
--
-- A previous migration in this chain projected finished Calls 1-7 generations
-- into the legacy render-library tables so the original RevisionStudioIQ grid
-- would light up. Those tables are legacy RestylePro storage, and the
-- standalone runtime contract classifies them as prohibited for exactly this
-- reason: the generation logic ports, the storage layer does not.
-- source-tests/schema caught it -- a blocked table synthesized by the migration
-- chain -- and it was correct to.
--
-- The blocked names are deliberately not written out below, prefix and all:
-- the schema test proves the rule by scanning this chain for them as text, so
-- naming one even in prose is indistinguishable from referencing it.
--
-- Rebuilding the old storage model to satisfy the old UI is the wrong half of
-- the migration to keep. The UI reads through a compatibility adapter instead
-- (app/src/lib/designpro-library.ts -> dpApi -> the gateway), so the rows it
-- renders are derived from designpro_generation_requests and
-- designpro_generation_views at read time and nothing durable is written into a
-- prohibited table.
--
-- Idempotent, and scoped to the objects that migration created. Nothing here
-- touches the legacy tables themselves: this project may hold them for other
-- reasons, and dropping someone else's table to undo our own mistake would be
-- a second, larger mistake.

DROP TRIGGER IF EXISTS designpro_project_generation_request ON public.designpro_generation_requests;
DROP TRIGGER IF EXISTS designpro_project_generation_view ON public.designpro_generation_views;

DROP FUNCTION IF EXISTS designpro_private.tg_project_generation_request();
DROP FUNCTION IF EXISTS designpro_private.tg_project_generation_view();
DROP FUNCTION IF EXISTS designpro_private.project_generation_into_library(uuid);
DROP FUNCTION IF EXISTS designpro_private.product_view_key(text);

-- ── the read model, served from canonical objects ─────────────────────────
-- One owner-scoped list of the caller's generations, carrying the identity the
-- library grid needs and nothing more. It returns no storage path and no signed
-- URL: viewing the images stays the separate, explicit /views surface, the same
-- rule designpro_generation_view_paths already follows.
CREATE OR REPLACE FUNCTION public.list_designpro_generation_requests()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_owner uuid := auth.uid();
  v_rows jsonb;
BEGIN
  IF v_owner IS NULL OR COALESCE(auth.jwt()->>'is_anonymous','false') = 'true' THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(entry) ORDER BY entry.created_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      r.id                AS "requestId",
      r.generation_id     AS "generationId",
      r.state,
      r.created_at,
      r.completed_at      AS "completedAt",
      r.request_input->'vehicle'          AS vehicle,
      r.request_input->>'designName'      AS "designName",
      r.request_input->>'orderNumber'     AS "orderNumber",
      r.request_input->>'brief'           AS brief,
      r.request_input->>'businessName'    AS "businessName",
      r.request_input->>'finish'          AS finish,
      (SELECT COALESCE(jsonb_agg(v.source_view_type ORDER BY v.source_view_type), '[]'::jsonb)
         FROM public.designpro_generation_views v
        WHERE v.request_id = r.id AND v.superseded_at IS NULL) AS "viewTypes",
      r.created_at AS created_at
    FROM public.designpro_generation_requests r
    WHERE r.owner_id = v_owner
    ORDER BY r.created_at DESC
    LIMIT 200
  ) AS entry;

  RETURN v_rows;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_designpro_generation_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_designpro_generation_requests() TO authenticated, service_role;
