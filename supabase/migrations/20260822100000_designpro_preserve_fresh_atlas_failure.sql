-- Preserve the real failure code for a fresh A.T.L.A.S. request that failed
-- before any private master or proof identity existed. The previous terminal
-- fence correctly quarantined invalid saved proof lineages, but also labelled
-- a zero-artifact master-QC failure as if an old proof set had been reused.
--
-- Outputs-ready requests remain fail-closed. Failed/cancelled requests remain
-- quarantined whenever even one active proof view or Atlas revision exists.

CREATE OR REPLACE FUNCTION designpro_private.flat_first_atlas_requires_new_run(
  p_request_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $function$
DECLARE
  v_row public.designpro_generation_requests%ROWTYPE;
  v_has_private_identity boolean;
BEGIN
  SELECT * INTO v_row
  FROM public.designpro_generation_requests
  WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_row.request_input->>'contractVersion' IS DISTINCT FROM
      'designpro.calls-1-7-input.v3'
    OR v_row.request_input->>'pipelineMode' IS DISTINCT FROM
      'flat-first-atlas-v1'
    OR v_row.state NOT IN ('outputs_ready','failed','cancelled')
  THEN RETURN false; END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.designpro_generation_views v
      WHERE v.request_id=v_row.id AND v.superseded_at IS NULL
    ) OR EXISTS (
      SELECT 1
      FROM public.designpro_flat_atlas_revisions a
      WHERE a.request_id=v_row.id
    )
  INTO v_has_private_identity;

  RETURN NOT designpro_private.flat_first_atlas_view_set_valid(v_row.id)
    AND (
      v_row.state='outputs_ready'
      OR v_has_private_identity
    );
END;
$function$;

REVOKE ALL ON FUNCTION
  designpro_private.flat_first_atlas_requires_new_run(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON FUNCTION
  designpro_private.flat_first_atlas_requires_new_run(uuid) IS
  'Quarantines invalid terminal Atlas proof/master identities while preserving the real failure code for a fresh zero-artifact request.';
