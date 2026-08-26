-- PER-VIEW PROOF QC BECOMES READABLE. (Validator hot-fix, 2026-08-26.)
--
-- #179 already opened the MASTER half of this seam: the atlas path RPCs project
-- `qc` (semantic review, deterministic zone metrics, cut-out findings, fill
-- telemetry) and the gateway passes it through. This adds the half that is
-- still missing everywhere -- the PER-CAMERA inspection record.
--
-- The evidence already exists and is never read:
--
--   designpro_generation_slots     each view's terminal state, its reason, and
--                                  how many rejections/regenerations it spent
--   designpro_generation_attempts  every inspector verdict VERBATIM in `detail`
--                                  -- camera/framing contract failures, atlas
--                                  and vehicle continuity findings, invented
--                                  text and logo call-outs -- plus outcome,
--                                  model and duration per attempt
--
-- No RPC has ever read either table for a UI (the only functions over them are
-- write-side: claim/fail/release/complete/handoff), the gateway does not
-- mention them, and nothing in the app renders a verdict. So PanelPro shows a
-- production control room that cannot say WHY a view was refused -- which is
-- the "proof QC / semantic QC / vehicle continuity / text-logo QC / retry
-- history" RULE 0.22 requires of it.
--
-- READ MODEL ONLY. This creates one new function and touches nothing that
-- exists: no second QC store, no writer, and neither atlas path RPC is
-- re-emitted -- re-emitting one would have reverted #179's own changes to it,
-- which is the failure mode CLAUDE.md documents.
--
-- Owner-gated exactly like the atlas paths, via the same predicate #179
-- introduced, so one definition of "may this caller read this generation"
-- governs both halves. Key fingerprints stay server-side: they are
-- provider-pool identity, not QC evidence.

CREATE OR REPLACE FUNCTION public.designpro_generation_proof_qc(
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

  SELECT COALESCE(pg_catalog.jsonb_agg(q.request_row ORDER BY q.request_created_at DESC),'[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      req.created_at AS request_created_at,
      pg_catalog.jsonb_build_object(
        'requestId',req.id,
        'state',req.state,
        'attempt',req.attempt,
        'createdAt',req.created_at,
        'completedAt',req.completed_at,
        'error',req.error,
        'views',COALESCE((
          SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'sourceViewType',s.source_view_type,
            'state',s.state,
            'reason',s.reason,
            'rejections',s.rejections,
            'providerCalls',s.provider_calls,
            'regenerations',s.regenerations,
            'updatedAt',s.updated_at,
            -- The inspector's own words, in the order it said them. This is
            -- the whole point of the function: "camera height is too low",
            -- "the candidate proof includes additional text 'BRUNSWICK'".
            'attempts',COALESCE((
              SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'attempt',a.attempt,
                'model',a.model,
                'outcome',a.outcome,
                'httpStatus',a.http_status,
                'detail',a.detail,
                'durationMs',a.duration_ms,
                'createdAt',a.created_at
              ) ORDER BY a.created_at)
              FROM public.designpro_generation_attempts a
              WHERE a.request_id=req.id
                AND a.source_view_type=s.source_view_type
            ),'[]'::jsonb)
          ) ORDER BY s.source_view_type)
          FROM public.designpro_generation_slots s
          WHERE s.request_id=req.id
        ),'[]'::jsonb)
      ) AS request_row
    FROM public.designpro_generation_requests req
    WHERE req.generation_id=p_generation_id
  ) q;
  RETURN v_rows;
END;
$fn$;

REVOKE ALL ON FUNCTION public.designpro_generation_proof_qc(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designpro_generation_proof_qc(uuid)
  TO authenticated,service_role;

DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='designpro_generation_proof_qc';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'designpro_generation_proof_qc was not created';
  END IF;
  -- Validate the RESULT, not only the inputs: the owner gate and both evidence
  -- tables must be present in the body this migration actually left behind.
  IF v_def NOT LIKE '%caller_may_read_generation%' THEN
    RAISE EXCEPTION 'proof QC reader lost its owner gate';
  END IF;
  IF v_def NOT LIKE '%designpro_generation_slots%'
    OR v_def NOT LIKE '%designpro_generation_attempts%' THEN
    RAISE EXCEPTION 'proof QC reader does not read both evidence tables';
  END IF;
  -- The two atlas path RPCs are NOT touched here. Assert #179's own work is
  -- still standing, so a future edit to this file cannot quietly revert it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='designpro_flat_atlas_generation_paths'
      AND pg_get_functiondef(p.oid) LIKE '%''qc''%'
  ) THEN
    RAISE EXCEPTION 'the atlas generation paths RPC lost its qc projection';
  END IF;
END
$verify$;
