-- A REFUSED PROOF VIEW, NAMED, FOR THE SURFACES THAT HAVE TO EXPLAIN IT.
--
-- Live evidence, generation e3ade856 (2026-09-07, 2022 Ford Transit Connect):
-- the passenger-side proof was rendered twice and refused twice by the proof
-- inspector on atlasContinuityContract -- "Artwork from the authority crop
-- (Hood) is not present on the vehicle's passenger side" -- leaving
-- designpro_generation_slots at state='failed',
-- reason='provider_attempts_exhausted'.
--
-- The run completed as an honest PARTIAL set: six panels, six proofs,
-- callsCompleted 6, and the refusal on the receipt. That partial path is
-- deliberate (owner, 2026-08-27) and nothing here changes it.
--
-- What no read surface could say was WHICH view was refused and WHY.
-- `designpro_generation_workspace` -- the read behind RevisionStudioIQ and the
-- approved-views route -- projects accepted views and `viewsSuperseded`, and
-- has never looked at the slots table. So the studio could show six proofs and
-- a short count with nothing to attribute it to.
--
-- ⛔ THE WORKSPACE FUNCTION IS DELIBERATELY NOT TOUCHED.
--
-- It is the read RevisionStudioIQ depends on, and this file's whole purpose is
-- additive information. CLAUDE.md records what editing it costs when the edit
-- is wrong: 20260826030000 wrote `pg_catalog.coalesce(...)` inside a jsonb_agg,
-- which applied clean in shadow AND production, passed every check, and then
-- raised for every generation that actually had proofs -- because PL/pgSQL
-- compiles an expression the first time it is EVALUATED and an aggregate over
-- zero rows evaluates nothing. A separate function cannot break that read at
-- all, however wrong it turns out to be.
--
-- COALESCE, like NULLIF/GREATEST/LEAST/CASE, is SQL GRAMMAR and takes no
-- schema qualifier; the parser resolves it before any search path. Every real
-- function below IS qualified, which is what `SET search_path` requires.

CREATE OR REPLACE FUNCTION public.designpro_generation_refused_views(
  p_generation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_refused jsonb;
BEGIN
  -- Same ownership gate the workspace read uses. A definer function that
  -- skipped it would hand one customer's run state to another.
  IF NOT designpro_private.caller_may_read_generation(p_generation_id)
  THEN RETURN NULL; END IF;

  -- A SLOT THAT LATER SUCCEEDED IS NOT A REFUSAL.
  --
  -- `regenerateView` re-runs one view under the same request, and the slot row
  -- carries its LAST state. Reporting a slot that has since produced a live
  -- view would put a permanent failure notice under a proof the customer is
  -- looking at, so the live view is what decides.
  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'sourceViewType', s.source_view_type,
             'reason', s.reason
           )
           ORDER BY s.source_view_type
         ), '[]'::jsonb)
  INTO v_refused
  FROM public.designpro_generation_slots s
  JOIN public.designpro_generation_requests g ON g.id = s.request_id
  WHERE g.generation_id = p_generation_id
    AND s.state = 'failed'
    AND NOT EXISTS (
      SELECT 1
      FROM public.designpro_generation_views v
      WHERE v.request_id = s.request_id
        AND v.source_view_type = s.source_view_type
        AND v.superseded_at IS NULL
    );

  RETURN v_refused;
END;
$function$;

REVOKE ALL ON FUNCTION public.designpro_generation_refused_views(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.designpro_generation_refused_views(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.designpro_generation_refused_views(uuid) IS
  'Proof views this generation refused and never replaced, with the slot reason. '
  'Additive: designpro_generation_workspace is unchanged and remains the accepted-view read.';
