-- Read the existing immutable request/revision records, including failed intent.
-- This adds no prompt store and changes no write or access policy.
CREATE OR REPLACE FUNCTION public.designpro_generation_prompt_record(p_generation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,designpro_private AS $fn$
DECLARE root public.designpro_generation_requests%ROWTYPE; history jsonb;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->>'is_anonymous','false')='true'
    OR NOT designpro_private.caller_may_read_generation(p_generation_id)
  THEN RETURN NULL; END IF;
  SELECT * INTO root FROM public.designpro_generation_requests
    WHERE generation_id=p_generation_id AND parent_atlas_revision_id IS NULL
    ORDER BY created_at,id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'version',v.version,'requestId',v.request_id,'revisionId',v.revision_id,
    'prompt',v.prompt,'createdAt',v.created_at,'authoredAt',v.authored_at,
    'completedAt',v.completed_at,'state',v.state,'errorCode',v.error_code
  ) ORDER BY v.version,v.created_at),'[]'::jsonb) INTO history
  FROM (
    SELECT a.revision_sequence AS version,r.id AS request_id,a.id AS revision_id,
      CASE WHEN a.revision_sequence=1 THEN root.request_input->>'brief'
        ELSE COALESCE(r.revision_context->>'instruction',a.instruction) END AS prompt,
      r.created_at,a.created_at AS authored_at,r.completed_at,r.state,r.error->>'code' AS error_code
    FROM public.designpro_flat_atlas_revisions a
    JOIN public.designpro_generation_requests r ON r.id=a.request_id
    WHERE a.generation_id=p_generation_id AND a.owner_id=root.owner_id
    UNION ALL
    SELECT r.revision_sequence,r.id,NULL::uuid,
      CASE WHEN r.revision_sequence=1 THEN root.request_input->>'brief'
        ELSE r.revision_context->>'instruction' END,
      r.created_at,NULL::timestamptz,r.completed_at,r.state,r.error->>'code'
    FROM public.designpro_generation_requests r
    WHERE r.generation_id=p_generation_id AND r.owner_id=root.owner_id
      AND NOT EXISTS(SELECT 1 FROM public.designpro_flat_atlas_revisions a WHERE a.request_id=r.id)
  ) v;
  RETURN jsonb_build_object('generationId',p_generation_id,'originalRequestId',root.id,
    'originalPrompt',root.request_input->>'brief','createdAt',root.created_at,'versions',history);
END
$fn$;
REVOKE ALL ON FUNCTION public.designpro_generation_prompt_record(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designpro_generation_prompt_record(uuid) TO authenticated,service_role;
