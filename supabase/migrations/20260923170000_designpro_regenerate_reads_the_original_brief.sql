-- ============================================================================
-- RUN IT AGAIN: THE ORIGINAL BRIEF, READ BACK, FOR TODAY'S CODE
-- ============================================================================
--
-- Owner, 2026-09-23: *"Could you create a way to regenerate past jobs under
-- this new code?"*
--
-- Measured on production the same day: 230 generation requests in sixty days,
-- **124 of them failed**. Every one of those is a brief a customer wrote and
-- paid attention to, sitting in `request_input`, that produced nothing — and
-- since then Call 1 gained the raw brief, both personas, the design anchor
-- crossing the node boundary, the die-cut gate, the drawn trim line and the
-- one-letterform rule. There was no way to put any of that work in front of
-- an old brief.
--
-- WHY A READ FUNCTION AND NOT A WIDER WORKSPACE. The browser already receives
-- a SUBSET of the stored input through `designpro_generation_workspace`
-- (brief, designName, companyName, finish, vehicle, pipelineMode,
-- contractVersion). That subset is missing the commercial identity and the
-- logo, so a regenerate built on it would quietly drop the customer's own
-- brand mark — RULE 0.24 names an uploaded logo CREATIVE authority, and
-- dropping it while calling the result "the same job again" is precisely the
-- honest-looking lie this schema keeps being burned by.
--
-- Widening the workspace RPC instead would mean text-patching a live function
-- several surfaces already read. A NEW function adds a door without touching
-- one, which is also what makes the feature removable: drop this function and
-- the gateway route, and nothing else in the system has changed.
--
-- OWNER-SCOPED, AND THE PREDICATE IS DEFINED HERE. `designpro_private.
-- caller_owns_generation(text,text)` exists in production and in NO migration
-- (recorded in CLAUDE.md), so a fresh database does not have it and the shadow
-- apply refuses anything that calls it. This function therefore carries its own
-- `owner_id = auth.uid()` test rather than borrowing the drifted one.
--
-- AND IT LIVES IN `public`, LIKE ITS SIBLINGS. PostgREST only exposes the
-- schemas it is configured with, and `designpro_private` is not one of them --
-- a definer helper there is reachable from SQL and NOT from the gateway.
-- `designpro_generation_workspace` and `designpro_atlas_panel_proof_paths` are
-- both public for exactly this reason; the SECURITY DEFINER body is what makes
-- that safe, not the schema it sits in.
--
-- IT RETURNS THE STORED JSONB AND NOTHING DERIVED. No contract is rebuilt here
-- and no default is invented: SQL's job is to hand back exactly what the
-- customer submitted, for a generation they own. The gateway rebuilds the
-- request under TODAY's contract through the SAME validator and the SAME
-- intake RPC a fresh design uses — a regenerate must never become a second
-- producer of generation requests.

CREATE OR REPLACE FUNCTION public.designpro_generation_regenerate_input(
  p_generation_id text
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT g.request_input
  FROM public.designpro_generation_requests g
  WHERE g.owner_id = (SELECT auth.uid())
    AND g.generation_id::text = p_generation_id;
$fn$;

-- NULL for absent and for another owner's generation alike, which is the same
-- shape `designpro_atlas_panel_proof_paths` uses: a caller must not be able to
-- tell "does not exist" from "is not yours".
REVOKE ALL ON FUNCTION public.designpro_generation_regenerate_input(text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.designpro_generation_regenerate_input(text)
  TO authenticated,service_role;

COMMENT ON FUNCTION public.designpro_generation_regenerate_input(text) IS
  'The stored calls-1-7 request_input for a generation the CALLER owns, verbatim. '
  'Feeds the regenerate route, which rebuilds the request under today''s contract '
  'through the same validator and intake RPC a fresh design uses. Returns NULL for '
  'an absent generation and for another owner''s alike.';
