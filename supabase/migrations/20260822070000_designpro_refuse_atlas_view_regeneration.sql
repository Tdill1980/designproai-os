-- A.T.L.A.S. proofs are one immutable master plus one dependent seven-view
-- set. Replacing a single projection would leave the other accepted views
-- anchored to a different Driver/master lineage. The only safe customer
-- operation is therefore a new A.T.L.A.S. run.
CREATE OR REPLACE FUNCTION public.regenerate_designpro_generation_slot(
  p_request_id uuid,
  p_source_view_type text,
  p_instruction text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_owner uuid:=auth.uid();
  v_row public.designpro_generation_requests%ROWTYPE;
  v_expected text;
  v_superseded integer:=0;
BEGIN
  IF v_owner IS NULL OR COALESCE(auth.jwt()->>'is_anonymous','false')='true'
  THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_row FROM public.designpro_generation_requests
  WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_row.owner_id IS DISTINCT FROM v_owner
  THEN RAISE EXCEPTION 'generation_request_not_visible'; END IF;

  -- Authoritative fail-closed boundary. The RPC is granted directly to an
  -- authenticated owner, so this check must live here rather than only in the
  -- gateway or browser. It deliberately runs before any view/slot mutation.
  IF v_row.request_input->>'contractVersion'='designpro.calls-1-7-input.v3'
    AND v_row.request_input->>'pipelineMode'='flat-first-atlas-v1'
  THEN RAISE EXCEPTION 'flat_first_atlas_new_run_required'; END IF;

  SELECT item->>'consumerRole' INTO v_expected
  FROM pg_catalog.jsonb_array_elements(designpro_private.calls_1_7_view_plan()) item
  WHERE item->>'sourceViewType'=p_source_view_type;
  IF v_expected IS NULL THEN RAISE EXCEPTION 'generation_view_not_in_plan'; END IF;

  IF p_instruction IS NOT NULL AND pg_catalog.length(p_instruction)>2000
  THEN RAISE EXCEPTION 'generation_instruction_too_long'; END IF;

  IF EXISTS (SELECT 1 FROM public.designpro_revision_sources
             WHERE revision_id=NULLIF(v_row.engine_receipt->>'handoffRevisionId','')::uuid)
  THEN RAISE EXCEPTION 'generation_already_handed_off_to_production'; END IF;

  UPDATE public.designpro_generation_views
  SET superseded_at=pg_catalog.clock_timestamp()
  WHERE request_id=v_row.id AND source_view_type=p_source_view_type
    AND superseded_at IS NULL;
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  INSERT INTO public.designpro_generation_slots (request_id, source_view_type)
  VALUES (v_row.id, p_source_view_type)
  ON CONFLICT (request_id, source_view_type) DO NOTHING;

  UPDATE public.designpro_generation_slots
  SET state='pending', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
      reason=NULL, instruction=NULLIF(pg_catalog.btrim(COALESCE(p_instruction,'')),''),
      regenerations=regenerations+1, updated_at=pg_catalog.clock_timestamp()
  WHERE request_id=v_row.id AND source_view_type=p_source_view_type;

  UPDATE public.designpro_generation_requests
  SET state='queued', available_at=pg_catalog.clock_timestamp(),
      completed_at=NULL, output_set_hash=NULL, error=NULL,
      lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
      updated_at=pg_catalog.clock_timestamp()
  WHERE id=v_row.id;

  RETURN pg_catalog.jsonb_build_object(
    'requestId',v_row.id,'sourceViewType',p_source_view_type,
    'consumerRole',v_expected,'supersededViews',v_superseded,'state','queued'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.regenerate_designpro_generation_slot(uuid,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_designpro_generation_slot(uuid,text,text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.regenerate_designpro_generation_slot(uuid,text,text) IS
  'Supersedes one standard DesignPanel proof view. Exact flat-first A.T.L.A.S. v3 requests fail closed and require a new run so their immutable master and dependent seven-view set cannot diverge.';
