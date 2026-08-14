-- A read of someone else's generation request must be indistinguishable from a
-- read of one that does not exist.
--
-- 20260814060000 changed get_designpro_generation_request so a non-owner gets
-- RAISE 'generation_request_not_visible' instead of NULL, and 20260814070000
-- gave designpro_generation_view_paths the same shape. That is wrong twice:
--
--   * The gateway is written for NULL. It does
--     `if (!request) return 404 generation_request_not_found`, so a raise never
--     reaches that line -- it unwinds into the catch-all and answers 500 with
--     the raw PostgreSQL message as the body. Asking for a request that is not
--     yours should be a clean 404, not a server error carrying an internal
--     identifier.
--
--   * Raising only when the row exists is an existence oracle. NULL for
--     "absent" and an error for "present but not yours" lets any authenticated
--     user enumerate valid request ids by watching which reads fail loudly.
--
-- The original Calls 1-7 adapter returned NULL, and the pgTAP fixture still
-- asserts it. These are the 20260814070000 definitions verbatim with only that
-- one line changed in each -- the projections, ordering, phase derivation and
-- grants are untouched, because the browser and the gateway both bind to them.

CREATE OR REPLACE FUNCTION public.get_designpro_generation_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_row public.designpro_generation_requests%ROWTYPE;
  v_views jsonb;
  v_handoff jsonb;
  v_shots integer;
  v_total integer;
  v_failed jsonb;
  v_regenerating jsonb;
  v_phase text;
BEGIN
  SELECT * INTO v_row FROM public.designpro_generation_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
     AND v_row.owner_id IS DISTINCT FROM auth.uid()
  THEN RETURN NULL; END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'sourceViewType',source_view_type,'consumerRole',consumer_role,
    'contentHash',content_hash,'byteSize',byte_size,'contentType',content_type,
    'createdAt',created_at
  ) ORDER BY source_view_type),'[]'::jsonb)
  INTO v_views FROM public.designpro_generation_views
  WHERE request_id=v_row.id AND superseded_at IS NULL;

  v_shots:=pg_catalog.jsonb_array_length(v_views);
  SELECT pg_catalog.jsonb_array_length(designpro_private.calls_1_7_view_plan()) INTO v_total;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'sourceViewType',source_view_type,'reason',reason) ORDER BY source_view_type),'[]'::jsonb)
  INTO v_failed FROM public.designpro_generation_slots
  WHERE request_id=v_row.id AND state='failed';

  SELECT COALESCE(pg_catalog.jsonb_agg(source_view_type ORDER BY source_view_type),'[]'::jsonb)
  INTO v_regenerating FROM public.designpro_generation_slots
  WHERE request_id=v_row.id AND state IN ('pending','leased') AND regenerations>0;

  v_phase:=CASE
    WHEN v_row.state IN ('failed','cancelled') THEN 'failed'
    WHEN v_shots>=v_total THEN 'complete'
    WHEN v_shots>0 THEN 'photographer'
    ELSE 'designer' END;

  v_handoff:=designpro_private.calls_1_7_handoff_state(v_row.id);

  RETURN pg_catalog.jsonb_build_object(
    'requestId',v_row.id,'generationId',v_row.generation_id,'state',v_row.state,
    'inputHash',v_row.input_hash,'engineContractHash',v_row.engine_contract_hash,
    'attempt',v_row.attempt,'outputSetHash',v_row.output_set_hash,
    'failureCode',v_row.error->>'code',
    'createdAt',v_row.created_at,'updatedAt',v_row.updated_at,
    'completedAt',v_row.completed_at,
    'handoffReady',v_handoff->'handoffReady',
    'handoffBlocker',v_handoff->>'handoffBlocker',
    'phase',v_phase,
    'shotsComplete',v_shots,
    'shotsTotal',v_total,
    'failedShots',v_failed,
    'regeneratingShots',v_regenerating,
    'designAnchor',v_row.request_input->>'brief',
    'designName',v_row.request_input->>'designName',
    'views',v_views
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.designpro_generation_view_paths(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_row public.designpro_generation_requests%ROWTYPE;
  v_views jsonb;
BEGIN
  SELECT * INTO v_row FROM public.designpro_generation_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
     AND v_row.owner_id IS DISTINCT FROM auth.uid()
  THEN RETURN NULL; END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'sourceViewType',source_view_type,'consumerRole',consumer_role,
    'storagePath',storage_path,'contentHash',content_hash,
    'contentType',content_type,'byteSize',byte_size
  ) ORDER BY source_view_type),'[]'::jsonb)
  INTO v_views FROM public.designpro_generation_views
  WHERE request_id=v_row.id AND superseded_at IS NULL;

  RETURN v_views;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_designpro_generation_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_designpro_generation_request(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.designpro_generation_view_paths(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.designpro_generation_view_paths(uuid) TO authenticated, service_role;
