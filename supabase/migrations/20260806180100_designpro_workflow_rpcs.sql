-- Standalone DesignProAI OS: queue, lease, resume and verified stage completion.

-- output.build is the memory/CPU-heavy print renderer; output verification
-- and ZIP64/TUS finalization use the same bounded host resources.  The two
-- claimant replicas may execute independent stages concurrently, but this one
-- database-owned slot prevents any two production-heavy stages from running
-- together.  Only service claimant/heartbeat/stage-transition functions can
-- operate the private row.
CREATE SCHEMA IF NOT EXISTS designpro_private;
REVOKE ALL ON SCHEMA designpro_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA designpro_private TO service_role;

CREATE TABLE IF NOT EXISTS designpro_private.heavy_stage_leases (
  lease_key text PRIMARY KEY CHECK (lease_key = 'production-heavy'),
  stage_id uuid REFERENCES public.designpro_workflow_stages(id) ON DELETE RESTRICT,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designpro_heavy_stage_lease_integrity CHECK (
    (stage_id IS NULL AND lease_owner IS NULL AND lease_token IS NULL
      AND lease_expires_at IS NULL)
    OR
    (stage_id IS NOT NULL AND NULLIF(btrim(lease_owner),'') IS NOT NULL
      AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);
INSERT INTO designpro_private.heavy_stage_leases(lease_key)
VALUES ('production-heavy')
ON CONFLICT (lease_key) DO NOTHING;
ALTER TABLE designpro_private.heavy_stage_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON designpro_private.heavy_stage_leases
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION designpro_private.sync_heavy_stage_lease()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_updated integer;
BEGIN
  IF NEW.stage_key NOT IN ('output.build','output.verify','zip.build') THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'running' THEN
    UPDATE designpro_private.heavy_stage_leases
    SET lease_owner = NEW.lease_owner,
      lease_expires_at = NEW.lease_expires_at,
      updated_at = pg_catalog.clock_timestamp()
    WHERE lease_key = 'production-heavy'
      AND stage_id = NEW.id
      AND lease_token = NEW.lease_token;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'output_build_singleton_lease_required';
    END IF;
  ELSIF OLD.status = 'running' THEN
    UPDATE designpro_private.heavy_stage_leases
    SET stage_id = NULL, lease_owner = NULL, lease_token = NULL,
      lease_expires_at = NULL, updated_at = pg_catalog.clock_timestamp()
    WHERE lease_key = 'production-heavy'
      AND stage_id = OLD.id
      AND lease_token = OLD.lease_token;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS designpro_output_build_singleton_lease
  ON public.designpro_workflow_stages;
CREATE TRIGGER designpro_output_build_singleton_lease
BEFORE UPDATE OF status, lease_owner, lease_token, lease_expires_at
ON public.designpro_workflow_stages
FOR EACH ROW EXECUTE FUNCTION designpro_private.sync_heavy_stage_lease();

CREATE OR REPLACE FUNCTION public.designpro_sync_run_status(p_run_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_status text;
BEGIN
  SELECT CASE
    WHEN bool_or(status = 'failed') THEN 'failed'
    WHEN bool_or(status = 'waiting' AND stage_key IN ('await_panelpro_preflight_qc','await_final_human_qc')) THEN 'approval_required'
    WHEN bool_and(status IN ('completed','skipped')) THEN 'completed'
    WHEN bool_or(status = 'running') THEN 'running'
    WHEN bool_or(status IN ('pending','retryable')) THEN 'queued'
    ELSE 'waiting' END
  INTO v_status FROM public.designpro_workflow_stages WHERE run_id = p_run_id;
  v_status := COALESCE(v_status, 'queued');
  UPDATE public.designpro_workflow_runs SET status = v_status, updated_at = clock_timestamp(),
    started_at = CASE WHEN v_status IN ('running','completed') THEN COALESCE(started_at, clock_timestamp()) ELSE started_at END,
    finished_at = CASE WHEN v_status = 'completed' THEN clock_timestamp() WHEN v_status IN ('queued','running') THEN NULL ELSE finished_at END
  WHERE id = p_run_id;
  RETURN v_status;
END $fn$;

CREATE OR REPLACE FUNCTION public.create_designpro_workflow(
  p_workflow_type text, p_owner_id uuid, p_tenant_key text, p_idempotency_key text,
  p_revision_id uuid, p_entice_pack_id uuid, p_dimension_manifest_id uuid,
  p_source_contract_hash text, p_manifest_hash text, p_artifact_set_hash text,
  p_input jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_run public.designpro_workflow_runs%ROWTYPE; v_stages text[]; v_stage text; v_seq integer := 0;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM p_owner_id THEN RAISE EXCEPTION 'owner_identity_required'; END IF;
  IF p_workflow_type NOT IN ('designpro.entice_pack','designpro.production_pack') THEN RAISE EXCEPTION 'unsupported_workflow_type'; END IF;
  IF p_source_contract_hash !~ '^[0-9a-f]{64}$' OR p_manifest_hash !~ '^[0-9a-f]{64}$' OR p_artifact_set_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'sha256_identity_required'; END IF;
  INSERT INTO public.designpro_workflow_runs(workflow_type,owner_id,tenant_key,idempotency_key,revision_id,entice_pack_id,dimension_manifest_id,source_contract_hash,manifest_hash,artifact_set_hash,input)
  VALUES(p_workflow_type,p_owner_id,p_tenant_key,p_idempotency_key,p_revision_id,p_entice_pack_id,p_dimension_manifest_id,lower(p_source_contract_hash),lower(p_manifest_hash),lower(p_artifact_set_hash),COALESCE(p_input,'{}'))
  ON CONFLICT (tenant_key,workflow_type,idempotency_key) DO NOTHING;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE tenant_key=p_tenant_key AND workflow_type=p_workflow_type AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_run.owner_id IS DISTINCT FROM p_owner_id OR v_run.revision_id IS DISTINCT FROM p_revision_id OR v_run.manifest_hash IS DISTINCT FROM lower(p_manifest_hash) THEN RAISE EXCEPTION 'idempotency_identity_conflict'; END IF;
  v_stages := CASE WHEN p_workflow_type='designpro.entice_pack' THEN ARRAY['revision.freeze','manifest.resolve','proof.build','panels.build','logos.extract','pack.verify','pack.activate'] ELSE ARRAY['source.verify','await_panelpro_preflight_qc','output.build','output.verify','await_final_human_qc','stamp.build','zip.build','wrapbox.deliver'] END;
  FOREACH v_stage IN ARRAY v_stages LOOP
    INSERT INTO public.designpro_workflow_stages(run_id,stage_key,sequence,idempotency_key,input)
    VALUES(v_run.id,v_stage,v_seq,v_run.id::text||':'||v_stage,jsonb_build_object('revisionId',v_run.revision_id,'enticePackId',v_run.entice_pack_id,'dimensionManifestId',v_run.dimension_manifest_id))
    ON CONFLICT (run_id,stage_key) DO NOTHING;
    v_seq := v_seq + 10;
  END LOOP;
  RETURN jsonb_build_object('workflowRunId',v_run.id,'status',v_run.status,'idempotent',v_run.created_at < clock_timestamp() - interval '1 millisecond');
END $fn$;

CREATE OR REPLACE FUNCTION public.claim_designpro_stage(p_worker text, p_lease_seconds integer DEFAULT 120)
RETURNS SETOF public.designpro_workflow_stages LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_id uuid;
  v_stage_key text;
  v_token uuid := extensions.gen_random_uuid();
  v_expires_at timestamptz;
  v_heavy designpro_private.heavy_stage_leases%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NULLIF(btrim(p_worker),'') IS NULL OR p_lease_seconds NOT BETWEEN 15 AND 900 THEN RAISE EXCEPTION 'invalid_lease_request'; END IF;

  -- Serialize only the very short claim transaction.  This closes the race in
  -- which two replicas could otherwise each SKIP LOCK a different heavy stage
  -- row before either observed the shared heavy-work lease.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('designpro.heavy-stage:production-heavy', 0)
  );
  SELECT * INTO v_heavy
  FROM designpro_private.heavy_stage_leases
  WHERE lease_key = 'production-heavy'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'output_build_lease_slot_missing'; END IF;
  IF v_heavy.lease_expires_at IS NOT NULL
    AND v_heavy.lease_expires_at <= clock_timestamp()
  THEN
    UPDATE designpro_private.heavy_stage_leases
    SET stage_id = NULL, lease_owner = NULL, lease_token = NULL,
      lease_expires_at = NULL, updated_at = clock_timestamp()
    WHERE lease_key = 'production-heavy';
    v_heavy.stage_id := NULL;
    v_heavy.lease_expires_at := NULL;
  END IF;

  SELECT s.id,s.stage_key INTO v_id,v_stage_key
  FROM public.designpro_workflow_stages s
  JOIN public.designpro_workflow_runs r ON r.id=s.run_id
  WHERE r.status NOT IN ('completed','cancelled','approval_required')
    AND ((s.status IN ('pending','retryable') AND s.available_at<=clock_timestamp()) OR (s.status='running' AND s.lease_expires_at<=clock_timestamp()))
    AND s.stage_key NOT IN ('await_panelpro_preflight_qc','await_final_human_qc')
    AND (s.stage_key NOT IN ('output.build','output.verify','zip.build')
      OR v_heavy.lease_expires_at IS NULL)
    AND s.attempt < s.max_attempts
    AND NOT EXISTS (SELECT 1 FROM public.designpro_workflow_stages p WHERE p.run_id=s.run_id AND p.sequence<s.sequence AND p.status NOT IN ('completed','skipped'))
  ORDER BY s.available_at,s.created_at,s.sequence FOR UPDATE OF s SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  v_expires_at := clock_timestamp()+make_interval(secs=>p_lease_seconds);
  IF v_stage_key IN ('output.build','output.verify','zip.build') THEN
    UPDATE designpro_private.heavy_stage_leases
    SET stage_id=v_id,lease_owner=p_worker,lease_token=v_token,
      lease_expires_at=v_expires_at,updated_at=clock_timestamp()
    WHERE lease_key='production-heavy';
  END IF;
  UPDATE public.designpro_workflow_stages SET status='running',attempt=attempt+1,lease_owner=p_worker,lease_token=v_token,
    lease_expires_at=v_expires_at,started_at=COALESCE(started_at,clock_timestamp()),updated_at=clock_timestamp()
  WHERE id=v_id;
  UPDATE public.designpro_workflow_runs SET status='running',started_at=COALESCE(started_at,clock_timestamp()),updated_at=clock_timestamp()
  WHERE id=(SELECT run_id FROM public.designpro_workflow_stages WHERE id=v_id);
  RETURN QUERY SELECT * FROM public.designpro_workflow_stages WHERE id=v_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.heartbeat_designpro_stage(p_stage_id uuid,p_lease_token uuid,p_lease_seconds integer DEFAULT 120)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  UPDATE public.designpro_workflow_stages SET lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),updated_at=clock_timestamp()
  WHERE id=p_stage_id AND status='running' AND lease_token=p_lease_token AND lease_expires_at>clock_timestamp();
  RETURN FOUND;
END $fn$;

-- Claiming a heavy stage already binds this global slot.  The explicit RPC is
-- therefore idempotent for the exact stage/token and also fences any future
-- worker path that attempts heavy work without the canonical claim binding.
CREATE OR REPLACE FUNCTION public.acquire_designpro_heavy_lease(
  p_stage_id uuid,
  p_lease_token uuid,
  p_worker text,
  p_lease_seconds integer DEFAULT 120
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_stage public.designpro_workflow_stages%ROWTYPE;
  v_slot designpro_private.heavy_stage_leases%ROWTYPE;
  v_expires_at timestamptz;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NULLIF(btrim(p_worker),'') IS NULL OR p_lease_seconds NOT BETWEEN 15 AND 900
  THEN RAISE EXCEPTION 'invalid_heavy_lease_request'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('designpro.heavy-stage:production-heavy',0)
  );
  SELECT * INTO v_stage
  FROM public.designpro_workflow_stages
  WHERE id=p_stage_id AND status='running' AND lease_token=p_lease_token
    AND lease_expires_at>clock_timestamp()
    AND stage_key IN ('output.build','output.verify','zip.build')
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO v_slot
  FROM designpro_private.heavy_stage_leases
  WHERE lease_key='production-heavy'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'production_heavy_lease_slot_missing'; END IF;
  IF v_slot.lease_expires_at IS NOT NULL
    AND v_slot.lease_expires_at<=clock_timestamp()
  THEN
    UPDATE designpro_private.heavy_stage_leases
    SET stage_id=NULL,lease_owner=NULL,lease_token=NULL,
      lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE lease_key='production-heavy';
    v_slot.stage_id:=NULL;
  END IF;
  IF v_slot.stage_id IS NOT NULL
    AND (v_slot.stage_id IS DISTINCT FROM p_stage_id
      OR v_slot.lease_token IS DISTINCT FROM p_lease_token)
  THEN RETURN false; END IF;

  v_expires_at:=LEAST(
    v_stage.lease_expires_at,
    clock_timestamp()+make_interval(secs=>p_lease_seconds)
  );
  UPDATE designpro_private.heavy_stage_leases
  SET stage_id=p_stage_id,lease_owner=p_worker,lease_token=p_lease_token,
    lease_expires_at=v_expires_at,updated_at=clock_timestamp()
  WHERE lease_key='production-heavy';
  RETURN true;
END
$fn$;

CREATE OR REPLACE FUNCTION public.release_designpro_heavy_lease(
  p_stage_id uuid,
  p_lease_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_bound boolean;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('designpro.heavy-stage:production-heavy',0)
  );
  -- Never create a release-before-completion gap: a worker may still emit a
  -- heartbeat between its heavy helper and complete/fail RPC.  The stage
  -- transition trigger is the sole owner of the actual atomic slot clear.
  SELECT EXISTS(
    SELECT 1 FROM designpro_private.heavy_stage_leases
    WHERE lease_key='production-heavy' AND stage_id=p_stage_id
      AND lease_token=p_lease_token
  ) INTO v_bound;
  RETURN v_bound;
END
$fn$;

CREATE OR REPLACE FUNCTION public.complete_designpro_stage(
  p_stage_id uuid,p_lease_token uuid,p_identity jsonb,p_receipt jsonb,p_receipt_hash text,p_artifacts jsonb DEFAULT '[]'::jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_stage public.designpro_workflow_stages%ROWTYPE; v_run public.designpro_workflow_runs%ROWTYPE; v_kind text; v_art jsonb; v_views jsonb; v_manifest jsonb; v_snapshot jsonb; v_call9 jsonb;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO v_stage FROM public.designpro_workflow_stages WHERE id=p_stage_id AND status='running' AND lease_token=p_lease_token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=v_stage.run_id FOR UPDATE;
  IF p_identity->>'workflowRunId' IS DISTINCT FROM v_run.id::text OR p_identity->>'revisionId' IS DISTINCT FROM v_run.revision_id::text OR p_identity->>'enticePackId' IS DISTINCT FROM v_run.entice_pack_id::text OR p_identity->>'dimensionManifestId' IS DISTINCT FROM v_run.dimension_manifest_id::text OR lower(p_identity->>'sourceContractHash') IS DISTINCT FROM v_run.source_contract_hash OR lower(p_identity->>'manifestHash') IS DISTINCT FROM v_run.manifest_hash OR lower(p_identity->>'artifactSetHash') IS DISTINCT FROM v_run.artifact_set_hash THEN RAISE EXCEPTION 'workflow_identity_drift'; END IF;
  IF COALESCE((p_receipt->>'verified')::boolean,false) IS DISTINCT FROM true OR lower(p_receipt_hash) !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'verified_receipt_required'; END IF;
  IF v_stage.stage_key='revision.freeze' THEN
    v_kind:='views.seven-source';
    IF jsonb_typeof(p_receipt->'viewReceipts')<>'array' OR jsonb_array_length(p_receipt->'viewReceipts')<>7
      OR (SELECT count(DISTINCT v->>'viewKey') FROM jsonb_array_elements(p_receipt->'viewReceipts') v)<>7
      OR (SELECT count(DISTINCT lower(v->>'contentHash')) FROM jsonb_array_elements(p_receipt->'viewReceipts') v)<>7
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_receipt->'viewReceipts') v WHERE NULLIF(btrim(v->>'viewKey'),'') IS NULL OR lower(v->>'contentHash')!~'^[0-9a-f]{64}$')
      OR EXISTS(SELECT 1 FROM unnest(ARRAY['driver','passenger','hood','roof','front','rear','hero3d']) required(view_key)
        WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_receipt->'viewReceipts') v WHERE v->>'viewKey'=required.view_key))
    THEN RAISE EXCEPTION 'seven_distinct_source_views_required'; END IF;
  ELSIF v_stage.stage_key='proof.build' THEN
    v_kind:='call8.flat-proof';
    SELECT receipt INTO v_views FROM public.designpro_stage_receipts WHERE run_id=v_run.id AND receipt_kind='views.seven-source';
    v_manifest:=v_run.results->'dimensionManifest';
    IF (p_receipt->>'call')::int<>8 OR p_receipt->>'proofKind'<>'flattened-2d-proof' OR p_receipt->>'dimensionsAuthority'<>'genie-universal-panelizer' OR (p_receipt->>'bleedInches')::numeric<>5 OR lower(p_receipt->>'sourceProofHash') !~ '^[0-9a-f]{64}$'
      OR v_views IS NULL OR jsonb_typeof(p_receipt->'viewLineage')<>'array' OR jsonb_array_length(p_receipt->'viewLineage')<>7
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_views->'viewReceipts') s WHERE NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(p_receipt->'viewLineage') l
        WHERE l->>'viewKey'=s->>'viewKey' AND lower(l->>'contentHash')=lower(s->>'contentHash')))
      OR p_receipt->>'dimensionManifestId' IS DISTINCT FROM v_run.dimension_manifest_id::text
      OR lower(p_receipt->>'manifestHash') IS DISTINCT FROM v_run.manifest_hash
      OR (p_receipt->>'totalSqFt')::numeric IS DISTINCT FROM (v_manifest->>'totalSqFt')::numeric
    THEN RAISE EXCEPTION 'call8_flat_proof_contract_failed'; END IF;
  ELSIF v_stage.stage_key='panels.build' THEN
    v_kind:='call9.surface-panels';
    v_manifest:=v_run.results->'dimensionManifest';
    IF (p_receipt->>'call')::int<>9 OR p_receipt->>'sourceRule'<>'one-own-surface-region-per-output-side' OR (p_receipt->>'bleedInches')::numeric<>5 OR jsonb_typeof(p_receipt->'sides')<>'array' OR jsonb_array_length(p_receipt->'sides')<2 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_receipt->'sides'))<>jsonb_array_length(p_receipt->'sides') OR jsonb_typeof(p_receipt->'panelHashes')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_receipt->'panelHashes'))<>jsonb_array_length(p_receipt->'sides') OR EXISTS(SELECT 1 FROM jsonb_each_text(p_receipt->'panelHashes') h WHERE lower(h.value)!~'^[0-9a-f]{64}$')
      OR jsonb_typeof(p_receipt->'sourceRegionHashes')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_receipt->'sourceRegionHashes'))<>jsonb_array_length(p_receipt->'sides')
      OR (SELECT count(DISTINCT lower(value)) FROM jsonb_each_text(p_receipt->'sourceRegionHashes'))<>jsonb_array_length(p_receipt->'sides')
      OR EXISTS(SELECT 1 FROM jsonb_each_text(p_receipt->'sourceRegionHashes') h WHERE lower(h.value)!~'^[0-9a-f]{64}$')
      OR EXISTS(SELECT 1 FROM jsonb_each_text(p_receipt->'sourceRegionHashes') d CROSS JOIN jsonb_each_text(p_receipt->'sourceRegionHashes') p
        WHERE lower(d.key) LIKE '%driver%' AND lower(p.key) LIKE '%passenger%' AND lower(d.value)=lower(p.value))
      OR p_receipt->>'dimensionManifestId' IS DISTINCT FROM v_run.dimension_manifest_id::text
      OR lower(p_receipt->>'manifestHash') IS DISTINCT FROM v_run.manifest_hash
      OR (p_receipt->>'totalSqFt')::numeric IS DISTINCT FROM (v_manifest->>'totalSqFt')::numeric
      OR jsonb_typeof(p_receipt->'trimDimensions')<>'object'
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_manifest->'expectedSurfaces') s WHERE
        NOT (p_receipt->'sides' @> jsonb_build_array(s->>'surfaceKey'))
        OR NOT (p_receipt->'panelHashes' ? (s->>'surfaceKey'))
        OR NOT (p_receipt->'sourceRegionHashes' ? (s->>'surfaceKey'))
        OR NOT (p_receipt->'trimDimensions' ? (s->>'surfaceKey'))
        OR (p_receipt#>>ARRAY['trimDimensions',s->>'surfaceKey','widthInches'])::numeric IS DISTINCT FROM (s->>'widthInches')::numeric
        OR (p_receipt#>>ARRAY['trimDimensions',s->>'surfaceKey','heightInches'])::numeric IS DISTINCT FROM (s->>'heightInches')::numeric
        OR (p_receipt#>>ARRAY['trimDimensions',s->>'surfaceKey','surfaceSqFt'])::numeric IS DISTINCT FROM (s->>'surfaceSqFt')::numeric)
      OR (SELECT count(*) FROM jsonb_object_keys(p_receipt->'trimDimensions')) <> jsonb_array_length(v_manifest->'expectedSurfaces')
      OR NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts r WHERE r.run_id=v_run.id AND r.receipt_kind='call8.flat-proof'
        AND r.receipt->>'dimensionManifestId'=v_run.dimension_manifest_id::text AND lower(r.receipt->>'manifestHash')=v_run.manifest_hash)
    THEN RAISE EXCEPTION 'call9_unique_proof_region_contract_failed'; END IF;
  ELSIF v_stage.stage_key='logos.extract' THEN
    v_kind:='call10.logo-inventory';
    SELECT snapshot INTO v_snapshot FROM public.designpro_revision_sources WHERE revision_id=v_run.revision_id AND snapshot_hash=v_run.revision_snapshot_hash;
    SELECT receipt INTO v_call9 FROM public.designpro_stage_receipts WHERE run_id=v_run.id AND receipt_kind='call9.surface-panels';
    IF (p_receipt->>'call')::int<>10 OR p_receipt->>'inventoryContract'<>'designpro.expected-logo-inventory.v1' OR COALESCE((p_receipt->>'exactSetVerified')::boolean,false) IS DISTINCT FROM true OR lower(p_receipt->>'inventoryHash')!~'^[0-9a-f]{64}$'
      OR v_snapshot IS NULL OR v_call9 IS NULL OR jsonb_typeof(p_receipt->'inventory')<>'array'
      OR jsonb_array_length(p_receipt->'inventory')<>jsonb_array_length(v_snapshot->'expectedLogoInventory')
      OR (SELECT count(DISTINCT actual->>'placementKey') FROM jsonb_array_elements(p_receipt->'inventory') actual)
        <> jsonb_array_length(v_snapshot->'expectedLogoInventory')
      OR jsonb_typeof(COALESCE(p_artifacts,'[]'))<>'array' OR jsonb_array_length(COALESCE(p_artifacts,'[]'))<>jsonb_array_length(v_snapshot->'expectedLogoInventory')
      OR (SELECT count(DISTINCT artifact->>'surfaceKey') FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) artifact)
        <> jsonb_array_length(v_snapshot->'expectedLogoInventory')
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_snapshot->'expectedLogoInventory') expected WHERE
        NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_receipt->'inventory') actual
          WHERE actual->>'placementKey'=expected->>'placementKey'
            AND actual->>'identityKey'=expected->>'identityKey'
            AND actual->>'displayName'=expected->>'displayName'
            AND actual->>'targetSurfaceKey'=expected->>'surfaceKey'
            AND actual->>'storagePath'=expected->>'storagePath'
            AND actual->>'contentType'=expected->>'contentType'
            AND lower(actual->>'contentHash')=lower(expected->>'contentHash'))
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) artifact
          WHERE artifact->>'kind'='logo'
            AND artifact->>'surfaceKey'=expected->>'placementKey'
            AND lower(artifact->>'contentHash')=lower(expected->>'contentHash')
            AND artifact->>'storagePath'=expected->>'storagePath'
            AND artifact#>>'{metadata,placementKey}'=expected->>'placementKey'
            AND artifact#>>'{metadata,identityKey}'=expected->>'identityKey'
            AND artifact#>>'{metadata,displayName}'=expected->>'displayName'
            AND artifact#>>'{metadata,targetSurfaceKey}'=expected->>'surfaceKey'
            AND artifact#>>'{metadata,contentType}'=expected->>'contentType'
            AND artifact#>>'{metadata,separationContract}'='designpro.deterministic-stored-overlay.v1'
            AND lower(artifact#>>'{metadata,sourceRegionHash}')=lower(v_call9#>>ARRAY['sourceRegionHashes',expected->>'surfaceKey'])))
    THEN RAISE EXCEPTION 'call10_contract_failed'; END IF;
  ELSIF v_stage.stage_key='output.verify' THEN
    v_kind:='output.verified';
    IF p_receipt->>'contract' IS DISTINCT FROM 'designpro.output-verification.v1'
      OR p_receipt->'exactSurfaceSet' IS DISTINCT FROM
        '["driver","passenger","hood","roof","front","rear"]'::jsonb
      OR p_receipt->'exactFormatSet' IS DISTINCT FROM '["png","tiff","eps"]'::jsonb
      OR (p_receipt->>'fileCount')::integer IS DISTINCT FROM 18
      OR (p_receipt->>'fullScalePixelsPerInch')::numeric IS DISTINCT FROM 150
      OR (p_receipt->>'fileDpi')::numeric IS DISTINCT FROM 1500
      OR (p_receipt->>'outputScale')::numeric IS DISTINCT FROM 0.1
      OR (p_receipt->>'fullScaleBleedInchesPerEdge')::numeric IS DISTINCT FROM 5
      OR jsonb_typeof(p_receipt->'files') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_receipt->'files') IS DISTINCT FROM 18
      OR (SELECT count(DISTINCT (f->>'surfaceKey',f->>'format'))
          FROM jsonb_array_elements(p_receipt->'files') f) IS DISTINCT FROM 18
      OR EXISTS(
        SELECT 1
        FROM unnest(ARRAY['driver','passenger','hood','roof','front','rear']) surface_key
        CROSS JOIN unnest(ARRAY['png','tiff','eps']) format
        WHERE NOT EXISTS(
          SELECT 1 FROM jsonb_array_elements(p_receipt->'files') f
          WHERE f->>'surfaceKey'=surface_key AND f->>'format'=format
            AND lower(f->>'contentHash')~'^[0-9a-f]{64}$'
            AND (f->>'byteSize')::bigint>0
            AND (f->>'dpi')::numeric=1500
            AND (f->>'outputScale')::numeric=0.1
            AND (f->>'fullScaleBleedInches')::numeric=5
            AND f->>'colorSpace'='sRGB'
        )
      )
      OR jsonb_typeof(p_receipt->'outputHashes') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_receipt->'outputHashes') IS DISTINCT FROM 18
      OR (SELECT count(DISTINCT lower(value)) FROM jsonb_array_elements_text(p_receipt->'outputHashes'))
        IS DISTINCT FROM jsonb_array_length(p_receipt->'outputHashes')
      OR EXISTS(
        SELECT 1 FROM jsonb_array_elements_text(p_receipt->'outputHashes') h
        WHERE lower(h)!~'^[0-9a-f]{64}$'
          OR NOT EXISTS(
            SELECT 1 FROM public.designpro_artifacts a
            WHERE a.run_id=v_run.id AND a.artifact_kind='output' AND a.content_hash=lower(h)
          )
      )
      OR EXISTS(
        SELECT 1 FROM public.designpro_artifacts a
        WHERE a.run_id=v_run.id AND a.artifact_kind='output'
          AND NOT (p_receipt->'outputHashes' ? a.content_hash)
      )
      OR (SELECT count(*) FROM public.designpro_artifacts a
          WHERE a.run_id=v_run.id AND a.artifact_kind='output')
        IS DISTINCT FROM jsonb_array_length(p_receipt->'outputHashes')
      OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(p_receipt->'files') f
        WHERE NOT EXISTS(
          SELECT 1 FROM public.designpro_artifacts a
          WHERE a.run_id=v_run.id AND a.artifact_kind='output'
            AND a.surface_key=f->>'surfaceKey'
            AND a.storage_path=f->>'storagePath'
            AND a.content_hash=lower(f->>'contentHash')
            AND a.byte_size=(f->>'byteSize')::bigint
            AND a.metadata->>'format'=f->>'format'
            AND (a.metadata->>'width')::numeric=(f->>'widthPixels')::numeric
            AND (a.metadata->>'height')::numeric=(f->>'heightPixels')::numeric
            AND (a.metadata->>'dpi')::numeric=1500
            AND (a.metadata->>'outputScale')::numeric=0.1
            AND (a.metadata->>'fullScaleBleedInches')::numeric=5
        )
      )
      OR COALESCE(p_artifacts,'[]'::jsonb) IS DISTINCT FROM '[]'::jsonb
    THEN RAISE EXCEPTION 'verified_output_artifact_ledger_mismatch'; END IF;
  ELSIF v_stage.stage_key='stamp.build' THEN v_kind:='stamp';
  ELSIF v_stage.stage_key='zip.build' THEN v_kind:='zip';
  ELSIF v_stage.stage_key='wrapbox.deliver' THEN v_kind:='wrapbox.delivery';
  ELSE v_kind:=NULL; END IF;
  IF v_stage.stage_key='proof.build' AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a
    WHERE a->>'kind'='flat-proof' AND lower(a->>'contentHash')=lower(p_receipt->>'sourceProofHash')
  ) THEN RAISE EXCEPTION 'call8_proof_artifact_required'; END IF;
  IF v_stage.stage_key='panels.build' AND EXISTS(
    SELECT 1 FROM jsonb_each_text(p_receipt->'panelHashes') h
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a
      WHERE a->>'kind'='panel' AND a->>'surfaceKey'=h.key AND lower(a->>'contentHash')=lower(h.value))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a WHERE a->>'kind'='panel' AND (
        lower(a#>>'{metadata,sourceRegionHash}') IS DISTINCT FROM lower(p_receipt#>>ARRAY['sourceRegionHashes',a->>'surfaceKey'])
        OR (a#>>'{metadata,trimWidthInches}')::numeric IS DISTINCT FROM (p_receipt#>>ARRAY['trimDimensions',a->>'surfaceKey','widthInches'])::numeric
        OR (a#>>'{metadata,trimHeightInches}')::numeric IS DISTINCT FROM (p_receipt#>>ARRAY['trimDimensions',a->>'surfaceKey','heightInches'])::numeric
        OR (a#>>'{metadata,surfaceSqFt}')::numeric IS DISTINCT FROM (p_receipt#>>ARRAY['trimDimensions',a->>'surfaceKey','surfaceSqFt'])::numeric
        OR (a#>>'{metadata,bleed,top}')::numeric<>5 OR (a#>>'{metadata,bleed,right}')::numeric<>5
        OR (a#>>'{metadata,bleed,bottom}')::numeric<>5 OR (a#>>'{metadata,bleed,left}')::numeric<>5))
  ) THEN RAISE EXCEPTION 'call9_panel_artifact_set_incomplete'; END IF;
  IF v_stage.stage_key='pack.verify' AND (
    v_run.dimension_manifest_id IS NULL OR v_run.manifest_hash IS NULL OR v_run.source_contract_hash IS NULL OR v_run.artifact_set_hash IS NULL
    OR NOT (v_run.results ? 'packReceipt')
  ) THEN RAISE EXCEPTION 'finalized_entice_identity_required'; END IF;
  IF v_stage.stage_key='pack.activate' AND NOT EXISTS(
    SELECT 1 FROM public.designpro_workflow_stages p WHERE p.run_id=v_run.id AND p.stage_key='pack.verify' AND p.status='completed'
      AND p.verification @> '{"verified":true}'::jsonb
  ) THEN RAISE EXCEPTION 'verified_entice_pack_required_for_activation'; END IF;
  IF v_stage.stage_key='stamp.build' THEN
    SELECT snapshot INTO v_snapshot
    FROM public.designpro_revision_sources
    WHERE revision_id=v_run.revision_id AND owner_id=v_run.owner_id
      AND snapshot_hash=v_run.revision_snapshot_hash;
    IF v_snapshot IS NULL
      OR p_receipt->>'receiptKind' IS DISTINCT FROM 'stamp'
      OR p_receipt->>'designId' IS DISTINCT FROM v_snapshot->>'designId'
      OR p_receipt->>'orderNumber' IS DISTINCT FROM v_snapshot->>'orderNumber'
      OR p_receipt->>'stampHash' !~ '^[0-9a-f]{64}$'
      OR p_receipt->>'sealHash' !~ '^[0-9a-f]{64}$'
      OR p_receipt->>'sourceProofHash' !~ '^[0-9a-f]{64}$'
      OR p_receipt->>'stampHash' IS NOT DISTINCT FROM p_receipt->>'sealHash'
      OR lower(p_receipt_hash) IS DISTINCT FROM p_receipt->>'stampHash'
      OR NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts q
        WHERE q.run_id=v_run.id AND q.receipt_kind='final.human-qc'
          AND q.receipt->>'verifiedBy'=p_receipt->>'verifiedBy'
          AND q.receipt->>'approvalRef'=p_receipt->>'approvalRef'
          AND q.receipt->>'approvedAt'=p_receipt->>'approvedAt'
          AND q.receipt#>>'{qc,designId}'=v_snapshot->>'designId'
          AND q.receipt#>>'{qc,orderNumber}'=v_snapshot->>'orderNumber')
      OR jsonb_typeof(COALESCE(p_artifacts,'[]'::jsonb)) IS DISTINCT FROM 'array'
      OR jsonb_array_length(COALESCE(p_artifacts,'[]'::jsonb)) IS DISTINCT FROM 2
      OR (SELECT count(DISTINCT a->>'surfaceKey')
          FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
          WHERE a->>'kind'='stamp'
            AND a->>'surfaceKey' IN ('seal','stamped-proof')) IS DISTINCT FROM 2
      OR EXISTS(SELECT 1
          FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
          WHERE a->>'kind' IS DISTINCT FROM 'stamp'
            OR a->>'surfaceKey' NOT IN ('seal','stamped-proof')
            OR a#>>'{metadata,designId}' IS DISTINCT FROM v_snapshot->>'designId'
            OR a#>>'{metadata,orderNumber}' IS DISTINCT FROM v_snapshot->>'orderNumber')
      OR NOT EXISTS(SELECT 1
        FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
        WHERE a->>'kind'='stamp' AND a->>'surfaceKey'='seal'
          AND lower(a->>'contentHash')=p_receipt->>'sealHash'
          AND a#>>'{metadata,designId}'=v_snapshot->>'designId'
          AND a#>>'{metadata,orderNumber}'=v_snapshot->>'orderNumber')
      OR NOT EXISTS(SELECT 1
        FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
        WHERE a->>'kind'='stamp' AND a->>'surfaceKey'='stamped-proof'
          AND lower(a->>'contentHash')=p_receipt->>'stampHash'
          AND lower(a#>>'{metadata,sourceProofHash}')=p_receipt->>'sourceProofHash'
          AND a#>>'{metadata,designId}'=v_snapshot->>'designId'
          AND a#>>'{metadata,orderNumber}'=v_snapshot->>'orderNumber')
    THEN RAISE EXCEPTION 'exact_seal_and_stamped_proof_identity_required'; END IF;
  END IF;
  IF v_stage.stage_key='zip.build' THEN
    IF NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts WHERE run_id=v_run.id AND receipt_kind='stamp')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a WHERE a->>'kind'='zip' AND lower(a->>'contentHash')=lower(p_receipt_hash))
    THEN RAISE EXCEPTION 'stamp_receipt_and_zip_artifact_required'; END IF;
  END IF;
  IF v_stage.stage_key='wrapbox.deliver' THEN
    IF NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts z WHERE z.run_id=v_run.id AND z.receipt_kind='zip' AND z.receipt_hash=lower(p_receipt->>'zipHash'))
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a WHERE a->>'kind'='wrapbox-manifest' AND lower(a->>'contentHash')=lower(p_receipt_hash))
    THEN RAISE EXCEPTION 'exact_zip_and_wrapbox_manifest_required'; END IF;
  END IF;
  IF v_kind IS NOT NULL THEN INSERT INTO public.designpro_stage_receipts(run_id,stage_id,receipt_kind,identity,receipt,receipt_hash) VALUES(v_run.id,v_stage.id,v_kind,p_identity,p_receipt,lower(p_receipt_hash)); END IF;
  IF jsonb_typeof(COALESCE(p_artifacts,'[]'))<>'array' THEN RAISE EXCEPTION 'artifact_array_required'; END IF;
  FOR v_art IN SELECT value FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) LOOP
    INSERT INTO public.designpro_artifacts(run_id,stage_id,artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata)
    VALUES(v_run.id,v_stage.id,v_art->>'kind',COALESCE(v_art->>'surfaceKey',''),v_art->>'storagePath',lower(v_art->>'contentHash'),NULLIF(v_art->>'byteSize','')::bigint,COALESCE(v_art->'metadata','{}'));
  END LOOP;
  UPDATE public.designpro_workflow_stages SET status='completed',output=p_receipt,verification=jsonb_build_object('verified',true,'identity',p_identity),output_hash=lower(p_receipt_hash),completed_at=clock_timestamp(),lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=v_stage.id;
  IF v_stage.stage_key IN ('source.verify','output.verify') THEN
    UPDATE public.designpro_workflow_stages
    SET status='waiting',
      wait_reason=CASE WHEN v_stage.stage_key='source.verify' THEN 'panelpro_preflight_required' ELSE 'final_human_qc_required' END,
      wait_details=jsonb_build_object('requestedBy','designpro.os','requestedAt',clock_timestamp()),
      updated_at=clock_timestamp()
    WHERE run_id=v_run.id
      AND stage_key=CASE WHEN v_stage.stage_key='source.verify' THEN 'await_panelpro_preflight_qc' ELSE 'await_final_human_qc' END
      AND status='pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'required_human_gate_missing_or_already_transitioned'; END IF;
  END IF;
  PERFORM public.designpro_sync_run_status(v_run.id);
  -- Completing Entice is the database-owned production trigger. This occurs
  -- in the same transaction, so a crash cannot leave an activated pack with
  -- no durable production workflow. The periodic reconciler in 181000 covers
  -- historical rows and any externally committed legacy activation.
  IF v_stage.stage_key='pack.activate' THEN
    PERFORM public.create_designpro_production_workflow(
      v_run.id,
      'auto-production:'||v_run.id::text,
      '{"trigger":"designpro.os.auto"}'::jsonb
    );
  END IF;
  RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.fail_designpro_stage(p_stage_id uuid,p_lease_token uuid,p_error_code text,p_error_message text,p_retryable boolean DEFAULT true)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_run_id uuid;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  UPDATE public.designpro_workflow_stages SET status=CASE WHEN p_retryable AND attempt<max_attempts THEN 'retryable' ELSE 'failed' END,
    available_at=clock_timestamp()+make_interval(secs=>LEAST(300,5*power(2,GREATEST(attempt-1,0))::int)),error_code=p_error_code,error_message=p_error_message,
    lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=p_stage_id AND status='running' AND lease_token=p_lease_token RETURNING run_id INTO v_run_id;
  IF v_run_id IS NULL THEN RETURN false; END IF; PERFORM public.designpro_sync_run_status(v_run_id); RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.resume_designpro_workflow(p_run_id uuid,p_actor uuid,p_retry_failed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_run public.designpro_workflow_runs%ROWTYPE; v_count int:=0; v_status text;
BEGIN
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_not_found'; END IF;
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor OR v_run.owner_id IS DISTINCT FROM p_actor) THEN RAISE EXCEPTION 'workflow_owner_required'; END IF;
  IF v_run.status IN ('completed','cancelled','approval_required') THEN RETURN jsonb_build_object('workflowStatus',v_run.status,'resumedStages',0); END IF;
  IF p_retry_failed THEN UPDATE public.designpro_workflow_stages SET status='retryable',max_attempts=GREATEST(max_attempts,attempt+1),available_at=clock_timestamp(),error_code=NULL,error_message=NULL,updated_at=clock_timestamp() WHERE run_id=p_run_id AND status='failed'; GET DIAGNOSTICS v_count=ROW_COUNT; END IF;
  UPDATE public.designpro_workflow_stages SET available_at=clock_timestamp(),updated_at=clock_timestamp() WHERE run_id=p_run_id AND status IN ('pending','retryable');
  v_status:=public.designpro_sync_run_status(p_run_id); RETURN jsonb_build_object('workflowStatus',v_status,'resumedStages',v_count);
END $fn$;

REVOKE ALL ON FUNCTION public.designpro_sync_run_status(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION designpro_private.sync_heavy_stage_lease()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_designpro_workflow(text,uuid,text,text,uuid,uuid,uuid,text,text,text,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.claim_designpro_stage(text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_designpro_stage(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.acquire_designpro_heavy_lease(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.release_designpro_heavy_lease(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_designpro_stage(uuid,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.resume_designpro_workflow(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_designpro_workflow(text,uuid,text,text,uuid,uuid,uuid,text,text,text,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_designpro_stage(text,integer),public.heartbeat_designpro_stage(uuid,uuid,integer),public.acquire_designpro_heavy_lease(uuid,uuid,text,integer),public.release_designpro_heavy_lease(uuid,uuid),public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb),public.fail_designpro_stage(uuid,uuid,text,text,boolean),public.designpro_sync_run_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resume_designpro_workflow(uuid,uuid,boolean) TO authenticated,service_role;
