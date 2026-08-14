-- Per-view regeneration, without mutating an accepted view.
--
-- "Generate this angle again", designer/photographer staging, per-shot progress
-- and failed-shot retry are real DesignPro capabilities. They were driven from
-- the browser in the source system; they are preserved here and moved behind the
-- server, not removed.
--
-- Regeneration cannot update the row: an accepted view is immutable by trigger,
-- and Calls 8+ may already have hashed it. So it supersedes. The old row stays
-- exactly as it was, marked superseded; the new render lands as a new row. The
-- four uniqueness rules that allowed one row per slot now allow one ACTIVE row
-- per slot, keeping the same guarantee downstream while the history is additive.

ALTER TABLE public.designpro_generation_views
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES public.designpro_generation_views(id);

ALTER TABLE public.designpro_generation_views
  DROP CONSTRAINT IF EXISTS designpro_generation_views_request_id_source_view_type_key,
  DROP CONSTRAINT IF EXISTS designpro_generation_views_request_id_consumer_role_key,
  DROP CONSTRAINT IF EXISTS designpro_generation_views_request_id_content_hash_key,
  DROP CONSTRAINT IF EXISTS designpro_generation_views_request_id_storage_path_key;

CREATE UNIQUE INDEX IF NOT EXISTS designpro_generation_view_active_source_uidx
  ON public.designpro_generation_views(request_id, source_view_type) WHERE superseded_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS designpro_generation_view_active_role_uidx
  ON public.designpro_generation_views(request_id, consumer_role) WHERE superseded_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS designpro_generation_view_active_hash_uidx
  ON public.designpro_generation_views(request_id, content_hash) WHERE superseded_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS designpro_generation_view_active_path_uidx
  ON public.designpro_generation_views(request_id, storage_path) WHERE superseded_at IS NULL;

-- A superseded view is history: it may never be un-superseded.
CREATE OR REPLACE FUNCTION designpro_private.enforce_generation_view_supersede_forward()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at THEN
    RAISE EXCEPTION 'superseded_generation_view_is_final';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS designpro_generation_view_supersede_forward
  ON public.designpro_generation_views;
CREATE TRIGGER designpro_generation_view_supersede_forward
BEFORE UPDATE ON public.designpro_generation_views
FOR EACH ROW EXECUTE FUNCTION designpro_private.enforce_generation_view_supersede_forward();

-- Slots carry the operator's regeneration instruction and a bounded count, so
-- "redo this angle, bolder" is server-owned rather than a browser prompt.
ALTER TABLE public.designpro_generation_slots
  ADD COLUMN IF NOT EXISTS instruction text
    CHECK (instruction IS NULL OR pg_catalog.length(instruction) <= 2000),
  ADD COLUMN IF NOT EXISTS regenerations integer NOT NULL DEFAULT 0
    CHECK (regenerations >= 0 AND regenerations <= 20);

-- Everything that reads "the views" now means "the active views".
CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_handoff_state(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog','public'
AS $fn$
DECLARE
  v_expected text[];
  v_actual text[];
  v_distinct integer;
  v_count integer;
BEGIN
  SELECT pg_catalog.array_agg(item->>'consumerRole' ORDER BY item->>'consumerRole')
  INTO v_expected
  FROM pg_catalog.jsonb_array_elements(designpro_private.calls_1_7_view_plan()) item;

  SELECT pg_catalog.array_agg(consumer_role ORDER BY consumer_role),
         pg_catalog.count(DISTINCT content_hash), pg_catalog.count(*)
  INTO v_actual, v_distinct, v_count
  FROM public.designpro_generation_views
  WHERE request_id=p_request_id AND superseded_at IS NULL;

  IF v_count IS NULL OR v_count<>7 THEN
    RETURN pg_catalog.jsonb_build_object('handoffReady',false,'handoffBlocker','seven_generation_views_required');
  END IF;
  IF v_distinct<>7 THEN
    RETURN pg_catalog.jsonb_build_object('handoffReady',false,'handoffBlocker','generation_views_must_be_byte_distinct');
  END IF;
  IF v_actual IS DISTINCT FROM v_expected THEN
    RETURN pg_catalog.jsonb_build_object('handoffReady',false,'handoffBlocker','generation_view_roles_do_not_match_plan');
  END IF;
  RETURN pg_catalog.jsonb_build_object('handoffReady',true,'handoffBlocker',NULL);
END
$fn$;

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
  THEN RAISE EXCEPTION 'generation_request_not_visible'; END IF;

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

-- "Generate this angle again", server-owned. Refused once the generation has
-- been frozen into a revision: those sources are what Calls 8+ hashed, so the
-- operator revises instead of silently changing a production input.
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

REVOKE ALL ON FUNCTION public.regenerate_designpro_generation_slot(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_designpro_generation_slot(uuid,text,text) TO authenticated, service_role;

-- Status carries the staging the DesignPro UI has always shown, derived from
-- real slot state rather than a browser-side pipeline:
--   personaPhase                -> phase
--   personaPhotographerProgress -> shotsComplete / shotsTotal
--   personaFailedShots          -> failedShots
--   personaDesignAnchor         -> designAnchor
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
  THEN RAISE EXCEPTION 'generation_request_not_visible'; END IF;

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

-- Completion counts, matches and hashes only ACTIVE views, so a regenerated
-- slot's superseded history neither blocks completion nor changes the output
-- set hash.
CREATE OR REPLACE FUNCTION public.complete_designpro_generation_request(
  p_request_id uuid,
  p_claim_token uuid,
  p_views jsonb,
  p_engine_receipt jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_request public.designpro_generation_requests%ROWTYPE;
  v_view jsonb;
  v_source text;
  v_role text;
  v_expected_role text;
  v_path text;
  v_hash text;
  v_bytes bigint;
  v_type text;
  v_extension text;
  v_prefix text;
  v_output_hash text;
  v_existing public.designpro_generation_views%ROWTYPE;
  v_handoff jsonb;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO v_request FROM public.designpro_generation_requests
  WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR p_claim_token IS NULL OR v_request.state<>'leased'
    OR v_request.lease_token IS DISTINCT FROM p_claim_token
    OR v_request.lease_expires_at<=pg_catalog.clock_timestamp()
  THEN RAISE EXCEPTION 'generation_lease_lost'; END IF;
  IF pg_catalog.jsonb_typeof(p_views) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(p_views)<>7
  THEN RAISE EXCEPTION 'exact_seven_generation_views_required'; END IF;
  IF pg_catalog.jsonb_typeof(p_engine_receipt) IS DISTINCT FROM 'object'
    OR p_engine_receipt->>'contractVersion' IS DISTINCT FROM 'designpro.calls-1-7-receipt.v1'
    OR p_engine_receipt->>'sourceCommit' IS DISTINCT FROM v_request.engine_contract->>'sourceCommit'
    OR p_engine_receipt->>'frozenContractHash' IS DISTINCT FROM v_request.engine_contract_hash
    OR p_engine_receipt->>'inputHash' IS DISTINCT FROM v_request.input_hash
    OR p_engine_receipt->>'byteVerified' IS DISTINCT FROM 'true'
    OR p_engine_receipt->>'callsCompleted' IS DISTINCT FROM '7'
  THEN RAISE EXCEPTION 'frozen_generation_engine_receipt_invalid'; END IF;

  v_prefix:='designpro/'||v_request.tenant_key||'/'
    ||v_request.generation_id::text||'/calls-1-7/';

  FOR v_view IN SELECT value FROM pg_catalog.jsonb_array_elements(p_views)
  LOOP
    IF pg_catalog.jsonb_typeof(v_view)<>'object'
      OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_view))<>7
      OR NOT v_view ?& ARRAY[
        'sourceViewType','consumerRole','storagePath','contentHash',
        'byteSize','contentType','metadata'
      ]
      OR pg_catalog.jsonb_typeof(v_view->'metadata')<>'object'
    THEN RAISE EXCEPTION 'generation_view_identity_invalid'; END IF;
    v_source:=v_view->>'sourceViewType';
    v_role:=v_view->>'consumerRole';
    SELECT item->>'consumerRole' INTO v_expected_role
    FROM pg_catalog.jsonb_array_elements(designpro_private.calls_1_7_view_plan()) item
    WHERE item->>'sourceViewType'=v_source;
    v_path:=v_view->>'storagePath';
    v_hash:=pg_catalog.lower(v_view->>'contentHash');
    BEGIN v_bytes:=(v_view->>'byteSize')::bigint;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'generation_view_identity_invalid'; END;
    v_type:=pg_catalog.lower(v_view->>'contentType');
    IF v_type='image/png' THEN v_extension:='.png';
    ELSIF v_type='image/jpeg' THEN v_extension:='.jpg';
    ELSIF v_type='image/webp' THEN v_extension:='.webp';
    ELSE RAISE EXCEPTION 'generation_view_identity_invalid'; END IF;
    IF v_expected_role IS NULL OR v_role<>v_expected_role
      OR v_path !~ '^[A-Za-z0-9._/-]+$' OR pg_catalog.strpos(v_path,'..')>0
      OR pg_catalog.left(v_path,pg_catalog.length(v_prefix))<>v_prefix
      OR v_hash !~ '^[0-9a-f]{64}$' OR v_bytes NOT BETWEEN 1 AND 536870912
      OR v_type NOT IN ('image/png','image/jpeg','image/webp')
      OR v_path<>v_prefix||v_source||'/'||v_hash||v_extension
    THEN RAISE EXCEPTION 'generation_view_identity_invalid'; END IF;

    SELECT * INTO v_existing FROM public.designpro_generation_views
    WHERE request_id=v_request.id AND source_view_type=v_source
      AND superseded_at IS NULL;

    IF FOUND THEN
      IF v_existing.consumer_role<>v_role
        OR v_existing.storage_path<>v_path
        OR v_existing.content_hash<>v_hash
        OR v_existing.byte_size<>v_bytes
        OR v_existing.content_type<>v_type
      THEN RAISE EXCEPTION 'accepted_generation_view_identity_conflict'; END IF;
    ELSE
      INSERT INTO public.designpro_generation_views(
        request_id,source_view_type,consumer_role,storage_path,content_hash,
        byte_size,content_type,metadata
      ) VALUES(
        v_request.id,v_source,v_role,v_path,v_hash,v_bytes,v_type,
        v_view->'metadata'
      );
    END IF;
  END LOOP;

  IF (SELECT pg_catalog.count(*) FROM public.designpro_generation_views
      WHERE request_id=v_request.id AND superseded_at IS NULL)<>7
  THEN RAISE EXCEPTION 'exact_seven_generation_views_required'; END IF;

  SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.string_agg(
      source_view_type||':'||consumer_role||':'||storage_path||':'
      ||content_hash||':'||byte_size::text||':'||content_type,E'\n'
      ORDER BY source_view_type
    ),'UTF8'),'sha256'),'hex')
  INTO v_output_hash FROM public.designpro_generation_views
  WHERE request_id=v_request.id AND superseded_at IS NULL;

  UPDATE public.designpro_generation_requests
  SET state='outputs_ready',output_set_hash=v_output_hash,
    engine_receipt=p_engine_receipt,completed_at=pg_catalog.clock_timestamp(),
    updated_at=pg_catalog.clock_timestamp(),lease_owner=NULL,lease_token=NULL,
    lease_expires_at=NULL,error=NULL
  WHERE id=v_request.id;
  v_handoff:=designpro_private.calls_1_7_handoff_state(v_request.id);

  RETURN pg_catalog.jsonb_build_object(
    'requestId',v_request.id,'generationId',v_request.generation_id,
    'state','outputs_ready','outputSetHash',v_output_hash,
    'handoffReady',v_handoff->'handoffReady',
    'handoffBlocker',v_handoff->>'handoffBlocker'
  );
END;
$function$;
