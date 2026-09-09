-- Reserve artwork and manufacturing identities separately, before Call 1.
-- Admission is opt-in through new server RPCs: migration-only rollout leaves
-- the old gateway/worker pair on v1. No existing request/history is backfilled.

CREATE OR REPLACE FUNCTION designpro_private.reserve_atlas_request_identity(p_request public.designpro_generation_requests)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $fn$
DECLARE v_handoff uuid; v_atlas uuid; v_design text;
BEGIN
  IF p_request.state IS DISTINCT FROM 'queued' OR p_request.attempt<>0
    OR p_request.request_input->>'pipelineMode' IS DISTINCT FROM 'flat-first-atlas-v1'
    OR p_request.generation_id IS NULL
  THEN RAISE EXCEPTION 'generation_identity_reservation_invalid'; END IF;
  v_handoff:=COALESCE(NULLIF(p_request.engine_receipt->>'handoffRevisionId','')::uuid,extensions.gen_random_uuid());
  v_atlas:=extensions.gen_random_uuid();
  v_design:='DID-'||upper(left(replace(p_request.generation_id::text,'-',''),8));
  IF v_atlas=v_handoff OR (NULLIF(p_request.engine_receipt->>'designId','') IS NOT NULL
    AND p_request.engine_receipt->>'designId' IS DISTINCT FROM v_design)
  THEN RAISE EXCEPTION 'generation_identity_reservation_conflict'; END IF;
  RETURN COALESCE(p_request.engine_receipt,'{}'::jsonb)||jsonb_build_object(
    'atlasRevisionId',v_atlas,'handoffRevisionId',v_handoff,'designId',v_design,
    'atlasIdentityMintedAt',COALESCE(p_request.engine_receipt->'atlasIdentityMintedAt',to_jsonb(clock_timestamp())),
    'atlasIdentityContract','designpro.atlas-identity-at-prompt.v2');
END
$fn$;

-- The old v1 response called the handoff ID atlasRevisionId; the receipt itself
-- never stored that alias. Only a real saved artwork row, or a v2 reservation,
-- can supply artwork authority. Existing snapshots win historical handoff IDs.
CREATE OR REPLACE FUNCTION designpro_private.atlas_request_identity(p_request public.designpro_generation_requests)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $fn$
DECLARE v_source public.designpro_revision_sources%ROWTYPE;
  v_atlas public.designpro_flat_atlas_revisions%ROWTYPE; v_identity jsonb;
  v_reserved boolean:=COALESCE(p_request.engine_receipt->>'atlasIdentityContract','')='designpro.atlas-identity-at-prompt.v2';
  v_design text:='DID-'||upper(left(replace(p_request.generation_id::text,'-',''),8));
BEGIN
  SELECT * INTO v_source FROM public.designpro_revision_sources s
  WHERE s.visualization_id=p_request.id AND s.owner_id=p_request.owner_id AND s.generation_id=p_request.generation_id
  ORDER BY (s.revision_id::text=p_request.engine_receipt->>'handoffRevisionId') DESC NULLS LAST,s.created_at DESC,s.revision_id DESC LIMIT 1;
  SELECT * INTO v_atlas FROM public.designpro_flat_atlas_revisions a
  WHERE a.request_id=p_request.id AND a.owner_id=p_request.owner_id AND a.generation_id=p_request.generation_id
    AND (NOT v_reserved OR a.revision_sequence=p_request.revision_sequence)
  ORDER BY (a.id::text=p_request.engine_receipt#>>'{flatAtlas,revisionId}') DESC NULLS LAST,a.revision_sequence DESC,a.id DESC LIMIT 1;
  IF v_reserved AND (
    COALESCE(p_request.engine_receipt->>'atlasRevisionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR COALESCE(p_request.engine_receipt->>'handoffRevisionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_request.engine_receipt->>'atlasRevisionId'=p_request.engine_receipt->>'handoffRevisionId'
    OR p_request.engine_receipt->>'designId' IS DISTINCT FROM v_design
    OR NULLIF(p_request.engine_receipt->>'atlasIdentityMintedAt','') IS NULL
    OR (v_source.revision_id IS NOT NULL AND v_source.revision_id::text IS DISTINCT FROM p_request.engine_receipt->>'handoffRevisionId')
    OR (v_atlas.id IS NOT NULL AND v_atlas.id::text IS DISTINCT FROM p_request.engine_receipt->>'atlasRevisionId')
  ) THEN RAISE EXCEPTION 'generation_reserved_identity_conflict'; END IF;
  v_identity:=jsonb_strip_nulls(jsonb_build_object(
    'atlasRevisionId',COALESCE(v_atlas.id::text,CASE WHEN v_reserved THEN p_request.engine_receipt->>'atlasRevisionId' END),
    'handoffRevisionId',COALESCE(v_source.revision_id::text,NULLIF(p_request.engine_receipt->>'handoffRevisionId','')),
    'designId',COALESCE(NULLIF(v_source.snapshot->>'designId',''),NULLIF(p_request.engine_receipt->>'designId',''),v_design),
    'atlasIdentityMintedAt',p_request.engine_receipt->'atlasIdentityMintedAt',
    'atlasIdentityContract',p_request.engine_receipt->>'atlasIdentityContract'));
  RETURN v_identity;
END
$fn$;

-- Merge only identity keys, never old flatAtlas/proof/provider runtime receipts.
-- v1 jobs without an immutable snapshot may complete under the old worker's
-- deterministic handoff during rollout. v2 and saved snapshots are strict.
CREATE OR REPLACE FUNCTION designpro_private.completed_atlas_identity(p_request public.designpro_generation_requests,p_receipt jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $fn$
DECLARE v_identity jsonb:=designpro_private.atlas_request_identity(p_request); v_key text;
  v_reserved boolean:=COALESCE(p_request.engine_receipt->>'atlasIdentityContract','')='designpro.atlas-identity-at-prompt.v2';
  v_snapshot_exists boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.designpro_revision_sources s WHERE s.visualization_id=p_request.id
    AND s.owner_id=p_request.owner_id AND s.generation_id=p_request.generation_id) INTO v_snapshot_exists;
  IF v_reserved OR v_snapshot_exists THEN
    IF p_receipt->>'handoffRevisionId' IS DISTINCT FROM v_identity->>'handoffRevisionId'
    THEN RAISE EXCEPTION 'generation_handoff_identity_conflict'; END IF;
  ELSIF NULLIF(p_receipt->>'handoffRevisionId','') IS NOT NULL THEN
    v_identity:=v_identity||jsonb_build_object('handoffRevisionId',p_receipt->>'handoffRevisionId');
  END IF;
  IF v_reserved AND (
    p_receipt#>>'{flatAtlas,revisionId}' IS DISTINCT FROM v_identity->>'atlasRevisionId'
    OR NOT EXISTS(SELECT 1 FROM public.designpro_flat_atlas_revisions a WHERE a.id::text=v_identity->>'atlasRevisionId'
      AND a.request_id=p_request.id AND a.owner_id=p_request.owner_id AND a.generation_id=p_request.generation_id
      AND a.revision_sequence=p_request.revision_sequence)
  ) THEN RAISE EXCEPTION 'generation_atlas_identity_conflict'; END IF;
  IF NULLIF(v_identity->>'atlasRevisionId','') IS NOT NULL
    AND p_receipt ? 'flatAtlas' AND p_receipt#>>'{flatAtlas,revisionId}' IS DISTINCT FROM v_identity->>'atlasRevisionId'
  THEN RAISE EXCEPTION 'generation_atlas_identity_conflict'; END IF;
  FOREACH v_key IN ARRAY ARRAY['atlasRevisionId','designId','atlasIdentityMintedAt','atlasIdentityContract'] LOOP
    IF v_identity ? v_key AND p_receipt ? v_key AND p_receipt->v_key IS DISTINCT FROM v_identity->v_key
    THEN RAISE EXCEPTION 'generation_identity_metadata_conflict: %',v_key; END IF;
  END LOOP;
  RETURN p_receipt||v_identity;
END
$fn$;

CREATE OR REPLACE FUNCTION public.create_designpro_flat_first_generation_request_v2(p_generation_id uuid,p_input jsonb,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_created jsonb; v_row public.designpro_generation_requests%ROWTYPE;
BEGIN
  -- The existing function owns authentication, normalization, active limits,
  -- owner advisory lock, original selector and exact input idempotency.
  v_created:=public.create_designpro_flat_first_generation_request(p_generation_id,p_input,p_idempotency_key);
  SELECT * INTO v_row FROM public.designpro_generation_requests
  WHERE id=(v_created->>'requestId')::uuid AND owner_id=auth.uid() AND generation_id=p_generation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'generation_identity_request_missing'; END IF;
  IF v_created->>'idempotent'='false' THEN
    UPDATE public.designpro_generation_requests SET engine_receipt=designpro_private.reserve_atlas_request_identity(v_row)
    WHERE id=v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN (v_created-ARRAY['atlasRevisionId','handoffRevisionId','designId','atlasIdentityMintedAt','atlasIdentityContract'])
    ||designpro_private.atlas_request_identity(v_row);
END
$fn$;

CREATE OR REPLACE FUNCTION public.enqueue_designpro_atlas_revision_v2(p_actor uuid,p_parent_revision_id uuid,p_context jsonb,p_context_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_created jsonb; v_row public.designpro_generation_requests%ROWTYPE;
BEGIN
  -- The original service-only intake validates the actor and exact saved parent.
  v_created:=public.enqueue_designpro_atlas_revision(p_actor,p_parent_revision_id,p_context,p_context_hash);
  SELECT * INTO v_row FROM public.designpro_generation_requests WHERE id=(v_created->>'requestId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'generation_identity_request_missing'; END IF;
  IF v_created->>'idempotent'='false' THEN
    UPDATE public.designpro_generation_requests SET engine_receipt=designpro_private.reserve_atlas_request_identity(v_row)
    WHERE id=v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN v_created||designpro_private.atlas_request_identity(v_row);
END
$fn$;

-- Patch installed bodies in place. Each anchor count and the resulting body
-- are checked; no later lease, partial-proof, owner-read or history fix is reset.
DO $patch$
DECLARE v_src text; v_old text; v_new text; v_sig text; v_count integer;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.create_designpro_flat_first_generation_request(uuid,jsonb,text)',
    'public.claim_designpro_generation_request(text,integer)',
    'public.get_designpro_generation_request(uuid)'
  ] LOOP
    v_src:=pg_get_functiondef(to_regprocedure(v_sig));
    IF v_src IS NULL THEN RAISE EXCEPTION 'call1_identity_function_missing: %',v_sig; END IF;
    IF strpos(v_src,'designpro_private.atlas_request_identity(v_row)')>0 THEN CONTINUE; END IF;
    v_old:='RETURN pg_catalog.jsonb_build_object(';
    v_count:=(length(v_src)-length(replace(v_src,v_old,'')))/length(v_old);
    IF v_count<>(CASE WHEN v_sig LIKE '%create_designpro_flat_first%' THEN 2 ELSE 1 END)
    THEN RAISE EXCEPTION 'call1_identity_return_anchor_changed: %',v_sig; END IF;
    v_new:=replace(v_src,v_old,'RETURN designpro_private.atlas_request_identity(v_row) || pg_catalog.jsonb_build_object(');
    IF v_sig LIKE '%create_designpro_flat_first%' THEN
      v_old:=E'    ''atlasRevisionId'',v_row.engine_receipt->>''handoffRevisionId'',\n    ''designId'',v_row.engine_receipt->>''designId'',\n';
      IF strpos(v_new,v_old)=0 THEN RAISE EXCEPTION 'call1_identity_old_alias_missing'; END IF;
      v_new:=replace(v_new,v_old,'');
      IF strpos(v_new,'generation_input_conflict')=0 OR strpos(v_new,'generation_active_request_limit')=0
        OR strpos(v_new,'parent_atlas_revision_id IS NULL')=0
      THEN RAISE EXCEPTION 'call1_identity_create_guards_lost'; END IF;
    END IF;
    EXECUTE v_new;
  END LOOP;

  v_src:=pg_get_functiondef('public.complete_designpro_generation_request(uuid,uuid,jsonb,jsonb)'::regprocedure);
  IF strpos(v_src,'designpro_private.completed_atlas_identity(v_request,p_engine_receipt)')=0 THEN
    v_old:='engine_receipt=p_engine_receipt';
    IF (length(v_src)-length(replace(v_src,v_old,'')))/length(v_old)<>1
    THEN RAISE EXCEPTION 'call1_identity_completion_anchor_changed'; END IF;
    v_new:=replace(v_src,v_old,'engine_receipt=designpro_private.completed_atlas_identity(v_request,p_engine_receipt)');
    IF strpos(v_new,'accepted_generation_view_identity_conflict')=0 OR strpos(v_new,'generation_lease_lost')=0
      OR strpos(v_new,'refusedViews')=0 OR strpos(v_new,'frozen_generation_engine_receipt_invalid')=0
    THEN RAISE EXCEPTION 'call1_identity_completion_guards_lost'; END IF;
    EXECUTE v_new;
  END IF;

  v_src:=pg_get_functiondef('designpro_private.validate_flat_atlas_revision_insert()'::regprocedure);
  IF strpos(v_src,'flat_atlas_reserved_revision_conflict')=0 THEN
    v_old:='  IF r.parent_atlas_revision_id IS NOT NULL THEN';
    IF (length(v_src)-length(replace(v_src,v_old,'')))/length(v_old)<>1
    THEN RAISE EXCEPTION 'call1_identity_insert_anchor_changed'; END IF;
    v_new:=replace(v_src,v_old,$guard$  IF r.engine_receipt->>'atlasIdentityContract'='designpro.atlas-identity-at-prompt.v2'
    AND (NEW.id::text IS DISTINCT FROM r.engine_receipt->>'atlasRevisionId'
      OR NEW.id::text=r.engine_receipt->>'handoffRevisionId')
  THEN RAISE EXCEPTION 'flat_atlas_reserved_revision_conflict'; END IF;
  IF r.parent_atlas_revision_id IS NOT NULL THEN$guard$);
    IF strpos(v_new,'flat_atlas_request_identity_mismatch')=0 OR strpos(v_new,'flat_atlas_revision_lineage_invalid')=0
    THEN RAISE EXCEPTION 'call1_identity_insert_guards_lost'; END IF;
    EXECUTE v_new;
  END IF;

  v_src:=pg_get_functiondef('designpro_private.protect_atlas_request_identity()'::regprocedure);
  IF strpos(v_src,'generation_reserved_identity_is_immutable')=0 THEN
    v_old:='  RETURN NEW;';
    IF (length(v_src)-length(replace(v_src,v_old,'')))/length(v_old)<>1
    THEN RAISE EXCEPTION 'call1_identity_update_anchor_changed'; END IF;
    v_new:=replace(v_src,v_old,$guard$  IF OLD.engine_receipt->>'atlasIdentityContract'='designpro.atlas-identity-at-prompt.v2'
    AND jsonb_build_array(NEW.engine_receipt->'atlasRevisionId',NEW.engine_receipt->'handoffRevisionId',NEW.engine_receipt->'designId',
      NEW.engine_receipt->'atlasIdentityMintedAt',NEW.engine_receipt->'atlasIdentityContract')
      IS DISTINCT FROM jsonb_build_array(OLD.engine_receipt->'atlasRevisionId',OLD.engine_receipt->'handoffRevisionId',OLD.engine_receipt->'designId',
      OLD.engine_receipt->'atlasIdentityMintedAt',OLD.engine_receipt->'atlasIdentityContract')
  THEN RAISE EXCEPTION 'generation_reserved_identity_is_immutable'; END IF;
  RETURN NEW;$guard$);
    IF strpos(v_new,'atlas_request_identity_is_immutable')=0
    THEN RAISE EXCEPTION 'call1_identity_update_guards_lost'; END IF;
    EXECUTE v_new;
  END IF;

  -- New workers use the installed claim logic, including every preceding lease
  -- fix. Old workers cannot claim v2 jobs during a deployment overlap.
  v_src:=pg_get_functiondef('public.claim_designpro_generation_request(text,integer)'::regprocedure);
  IF to_regprocedure('public.claim_designpro_generation_request_v2(text,integer)') IS NULL THEN
    EXECUTE replace(v_src,'public.claim_designpro_generation_request(','public.claim_designpro_generation_request_v2(');
  END IF;
  IF strpos(v_src,'-- CALL1_IDENTITY_V2_ADMISSION')=0 THEN
    v_old:=$ready$  WHERE (
    state IN ('queued','retryable') AND available_at<=pg_catalog.clock_timestamp()
  ) OR (
    state='leased' AND lease_expires_at<=pg_catalog.clock_timestamp()
  )$ready$;
    IF (length(v_src)-length(replace(v_src,v_old,'')))/length(v_old)<>1
    THEN RAISE EXCEPTION 'call1_identity_claim_anchor_changed'; END IF;
    v_new:=replace(v_src,v_old,$ready$  -- CALL1_IDENTITY_V2_ADMISSION: this endpoint serves old workers only.
  WHERE COALESCE(engine_receipt->>'atlasIdentityContract','')<>'designpro.atlas-identity-at-prompt.v2'
  AND ((
    state IN ('queued','retryable') AND available_at<=pg_catalog.clock_timestamp()
  ) OR (
    state='leased' AND lease_expires_at<=pg_catalog.clock_timestamp()
  ))$ready$);
    IF strpos(v_new,'FOR UPDATE SKIP LOCKED')=0 OR strpos(v_new,'generation_attempt_limit')=0
      OR strpos(v_new,'service_role_required')=0 OR strpos(v_new,'atlas_request_identity')=0
    THEN RAISE EXCEPTION 'call1_identity_claim_guards_lost'; END IF;
    EXECUTE v_new;
  END IF;
END
$patch$;

CREATE OR REPLACE FUNCTION designpro_private.atlas_identity_fence_ready()
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $fn$
  SELECT COALESCE(
    has_function_privilege('authenticated',to_regprocedure('public.create_designpro_flat_first_generation_request_v2(uuid,jsonb,text)'),'EXECUTE')
    AND NOT has_function_privilege('anon',to_regprocedure('public.create_designpro_flat_first_generation_request_v2(uuid,jsonb,text)'),'EXECUTE')
    AND has_function_privilege('service_role',to_regprocedure('public.enqueue_designpro_atlas_revision_v2(uuid,uuid,jsonb,text)'),'EXECUTE')
    AND NOT has_function_privilege('authenticated',to_regprocedure('public.enqueue_designpro_atlas_revision_v2(uuid,uuid,jsonb,text)'),'EXECUTE')
    AND has_function_privilege('service_role',to_regprocedure('public.claim_designpro_generation_request_v2(text,integer)'),'EXECUTE')
    AND NOT has_function_privilege('authenticated',to_regprocedure('public.claim_designpro_generation_request_v2(text,integer)'),'EXECUTE')
    AND strpos(pg_get_functiondef(to_regprocedure('public.create_designpro_flat_first_generation_request_v2(uuid,jsonb,text)')),'reserve_atlas_request_identity')>0
    AND strpos(pg_get_functiondef(to_regprocedure('public.enqueue_designpro_atlas_revision_v2(uuid,uuid,jsonb,text)')),'reserve_atlas_request_identity')>0
    AND strpos(pg_get_functiondef(to_regprocedure('public.claim_designpro_generation_request(text,integer)')),'CALL1_IDENTITY_V2_ADMISSION')>0
    AND strpos(pg_get_functiondef(to_regprocedure('public.claim_designpro_generation_request_v2(text,integer)')),'CALL1_IDENTITY_V2_ADMISSION')=0
    AND strpos(pg_get_functiondef(to_regprocedure('public.claim_designpro_generation_request_v2(text,integer)')),'atlas_request_identity(v_row)')>0
    AND strpos(pg_get_functiondef(to_regprocedure('public.complete_designpro_generation_request(uuid,uuid,jsonb,jsonb)')),'completed_atlas_identity(v_request,p_engine_receipt)')>0
    AND strpos(pg_get_functiondef(to_regprocedure('designpro_private.validate_flat_atlas_revision_insert()')),'flat_atlas_reserved_revision_conflict')>0
    AND strpos(pg_get_functiondef(to_regprocedure('designpro_private.protect_atlas_request_identity()')),'generation_reserved_identity_is_immutable')>0,
    false)
$fn$;
DO $readiness$
DECLARE v_src text; v_old text:='''contract'',''designpro.runtime-readiness.v2'',';
BEGIN
  v_src:=pg_get_functiondef('public.designpro_runtime_readiness()'::regprocedure);
  IF strpos(v_src,'callOneIdentityFence')>0 THEN RETURN; END IF;
  IF (length(v_src)-length(replace(v_src,v_old,'')))/length(v_old)<>1
  THEN RAISE EXCEPTION 'call1_identity_readiness_anchor_changed'; END IF;
  EXECUTE replace(v_src,v_old,v_old||E'\n    ''callOneIdentityFence'',designpro_private.atlas_identity_fence_ready(),');
END
$readiness$;

REVOKE ALL ON FUNCTION designpro_private.reserve_atlas_request_identity(public.designpro_generation_requests),
  designpro_private.atlas_request_identity(public.designpro_generation_requests),
  designpro_private.completed_atlas_identity(public.designpro_generation_requests,jsonb),
  designpro_private.atlas_identity_fence_ready()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_designpro_flat_first_generation_request_v2(uuid,jsonb,text),
  public.enqueue_designpro_atlas_revision_v2(uuid,uuid,jsonb,text),
  public.claim_designpro_generation_request_v2(text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_designpro_flat_first_generation_request_v2(uuid,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_designpro_atlas_revision_v2(uuid,uuid,jsonb,text),
  public.claim_designpro_generation_request_v2(text,integer) TO service_role;
