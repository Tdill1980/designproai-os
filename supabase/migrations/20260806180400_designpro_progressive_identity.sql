-- Progressive Entice identity and fully pinned Production identity.

DROP FUNCTION IF EXISTS public.create_designpro_workflow(text,uuid,text,text,uuid,uuid,uuid,text,text,text,jsonb);

ALTER TABLE public.designpro_workflow_runs
  ADD COLUMN IF NOT EXISTS revision_snapshot_hash text,
  ALTER COLUMN dimension_manifest_id DROP NOT NULL,
  ALTER COLUMN source_contract_hash DROP NOT NULL,
  ALTER COLUMN manifest_hash DROP NOT NULL,
  ALTER COLUMN artifact_set_hash DROP NOT NULL;

ALTER TABLE public.designpro_workflow_runs DROP CONSTRAINT IF EXISTS designpro_run_identity_phase_check;
ALTER TABLE public.designpro_workflow_runs ADD CONSTRAINT designpro_run_identity_phase_check CHECK (
  revision_snapshot_hash IS NOT NULL AND revision_snapshot_hash ~ '^[0-9a-f]{64}$' AND (
    (workflow_type='designpro.entice_pack' AND (
      (dimension_manifest_id IS NULL AND manifest_hash IS NULL) OR
      (dimension_manifest_id IS NOT NULL AND manifest_hash ~ '^[0-9a-f]{64}$')
    ) AND (
      (source_contract_hash IS NULL AND artifact_set_hash IS NULL) OR
      (source_contract_hash ~ '^[0-9a-f]{64}$' AND artifact_set_hash ~ '^[0-9a-f]{64}$')
    )) OR
    (workflow_type='designpro.production_pack' AND dimension_manifest_id IS NOT NULL
      AND source_contract_hash ~ '^[0-9a-f]{64}$' AND manifest_hash ~ '^[0-9a-f]{64}$'
      AND artifact_set_hash ~ '^[0-9a-f]{64}$')
  )
);

CREATE TABLE IF NOT EXISTS public.designpro_revision_sources (
  revision_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tenant_key text NOT NULL CHECK (btrim(tenant_key)<>''),
  generation_id uuid NOT NULL,
  visualization_id uuid NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designpro_revision_snapshot_contract CHECK (
    snapshot->>'contractVersion'='designpro.revision-snapshot.v1'
    AND NULLIF(btrim(snapshot->>'designId'),'') IS NOT NULL
    AND snapshot->>'visualizationId'=visualization_id::text
    AND jsonb_typeof(snapshot->'renderUrls')='object' AND snapshot->'renderUrls'<>'{}'::jsonb
    AND NULLIF(btrim(snapshot#>>'{vehicle,year}'),'') IS NOT NULL
    AND NULLIF(btrim(snapshot#>>'{vehicle,make}'),'') IS NOT NULL
    AND NULLIF(btrim(snapshot#>>'{vehicle,model}'),'') IS NOT NULL
    AND NULLIF(btrim(snapshot#>>'{vehicle,type}'),'') IS NOT NULL
    AND jsonb_typeof(snapshot->'surfaceOptions')='object'
    AND snapshot ? 'finish' AND snapshot ? 'bodyText'
    AND jsonb_typeof(snapshot->'change')='object'
    AND jsonb_typeof(snapshot->'expectedLogoInventory')='array'
    AND (NOT snapshot ? 'materialFingerprints' OR jsonb_typeof(snapshot->'materialFingerprints') IN ('object','array'))
  )
);

CREATE OR REPLACE FUNCTION public.guard_designpro_revision_source_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $fn$
BEGIN RAISE EXCEPTION 'designpro_revision_source_is_immutable'; END $fn$;
DROP TRIGGER IF EXISTS designpro_revision_source_immutable ON public.designpro_revision_sources;
CREATE TRIGGER designpro_revision_source_immutable BEFORE UPDATE OR DELETE ON public.designpro_revision_sources
FOR EACH ROW EXECUTE FUNCTION public.guard_designpro_revision_source_immutable();

CREATE OR REPLACE FUNCTION public.verify_designpro_revision_source_hash()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $fn$
DECLARE v_logo jsonb;
BEGIN
  FOR v_logo IN SELECT value FROM jsonb_array_elements(NEW.snapshot->'expectedLogoInventory') LOOP
    IF NULLIF(btrim(v_logo->>'identityKey'),'') IS NULL
      OR v_logo->>'surfaceKey' NOT IN ('driver','passenger','hood','roof','front','rear')
      OR NULLIF(btrim(v_logo->>'storagePath'),'') IS NULL
      OR v_logo->>'storagePath' LIKE '/%' OR v_logo->>'storagePath' LIKE '%..%'
      OR v_logo->>'storagePath' !~ '^[A-Za-z0-9._/-]+$'
      OR lower(v_logo->>'contentHash') !~ '^[0-9a-f]{64}$'
    THEN RAISE EXCEPTION 'expected_logo_inventory_item_invalid'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(NEW.snapshot->'expectedLogoInventory'))
    IS DISTINCT FROM (SELECT count(DISTINCT (v->>'identityKey',v->>'surfaceKey')) FROM jsonb_array_elements(NEW.snapshot->'expectedLogoInventory') v)
  THEN RAISE EXCEPTION 'expected_logo_inventory_identity_duplicate'; END IF;
  IF lower(NEW.snapshot_hash) IS DISTINCT FROM encode(extensions.digest(convert_to(NEW.snapshot::text,'UTF8'),'sha256'),'hex')
  THEN RAISE EXCEPTION 'revision_snapshot_hash_mismatch'; END IF;
  NEW.snapshot_hash:=lower(NEW.snapshot_hash); RETURN NEW;
END $fn$;

-- The standalone browser/control plane cannot advance worker stages. The older
-- compatibility RPC is deliberately removed after its source migration runs.
DROP FUNCTION IF EXISTS public.advance_designpro_workflow_stage(uuid,text,jsonb,jsonb,text);
DROP TRIGGER IF EXISTS designpro_revision_source_hash ON public.designpro_revision_sources;
CREATE TRIGGER designpro_revision_source_hash BEFORE INSERT ON public.designpro_revision_sources
FOR EACH ROW EXECUTE FUNCTION public.verify_designpro_revision_source_hash();

CREATE OR REPLACE FUNCTION public.guard_designpro_run_identity_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $fn$
BEGIN
  IF NEW.revision_id IS DISTINCT FROM OLD.revision_id OR NEW.entice_pack_id IS DISTINCT FROM OLD.entice_pack_id
    OR NEW.revision_snapshot_hash IS DISTINCT FROM OLD.revision_snapshot_hash
    OR (OLD.dimension_manifest_id IS NOT NULL AND NEW.dimension_manifest_id IS DISTINCT FROM OLD.dimension_manifest_id)
    OR (OLD.manifest_hash IS NOT NULL AND NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash)
    OR (OLD.source_contract_hash IS NOT NULL AND NEW.source_contract_hash IS DISTINCT FROM OLD.source_contract_hash)
    OR (OLD.artifact_set_hash IS NOT NULL AND NEW.artifact_set_hash IS DISTINCT FROM OLD.artifact_set_hash)
  THEN RAISE EXCEPTION 'designpro_workflow_identity_is_immutable'; END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS designpro_run_identity_immutable ON public.designpro_workflow_runs;
CREATE TRIGGER designpro_run_identity_immutable BEFORE UPDATE ON public.designpro_workflow_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_designpro_run_identity_immutable();

ALTER TABLE public.designpro_revision_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS designpro_owner_read_revision_sources ON public.designpro_revision_sources;
CREATE POLICY designpro_owner_read_revision_sources ON public.designpro_revision_sources FOR SELECT TO authenticated USING(owner_id=auth.uid());
REVOKE ALL ON public.designpro_revision_sources FROM PUBLIC,anon;
GRANT SELECT ON public.designpro_revision_sources TO authenticated;
GRANT ALL ON public.designpro_revision_sources TO service_role;

CREATE OR REPLACE FUNCTION public.bind_designpro_entice_manifest(
  p_run_id uuid,p_stage_id uuid,p_lease_token uuid,p_dimension_manifest_id uuid,
  p_manifest jsonb,p_manifest_hash text,p_dimension_basis_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_run public.designpro_workflow_runs%ROWTYPE; v_stage public.designpro_workflow_stages%ROWTYPE; v_surface jsonb; v_derived_manifest text; v_total_sqft numeric:=0;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  v_derived_manifest:=encode(extensions.digest(convert_to(p_manifest::text,'UTF8'),'sha256'),'hex');
  IF lower(p_dimension_basis_hash)!~'^[0-9a-f]{64}$'
    OR COALESCE((p_manifest->>'genieVerified')::boolean,false) IS DISTINCT FROM true
    OR jsonb_typeof(p_manifest->'expectedSurfaces')<>'array' OR jsonb_array_length(p_manifest->'expectedSurfaces')<>6
    OR lower(p_manifest->>'dimensionBasisHash') IS DISTINCT FROM lower(p_dimension_basis_hash)
    OR (NULLIF(btrim(COALESCE(p_manifest_hash,'')),'') IS NOT NULL AND lower(p_manifest_hash) IS DISTINCT FROM v_derived_manifest)
  THEN RAISE EXCEPTION 'genie_manifest_contract_invalid'; END IF;
  FOR v_surface IN SELECT value FROM jsonb_array_elements(p_manifest->'expectedSurfaces') LOOP
    IF NULLIF(btrim(v_surface->>'surfaceKey'),'') IS NULL OR COALESCE((v_surface->>'widthInches')::numeric,0)<=0
      OR COALESCE((v_surface->>'heightInches')::numeric,0)<=0
      OR jsonb_typeof(v_surface->'bleed')<>'object'
      OR (v_surface#>>'{bleed,top}')::numeric<>5 OR (v_surface#>>'{bleed,right}')::numeric<>5
      OR (v_surface#>>'{bleed,bottom}')::numeric<>5 OR (v_surface#>>'{bleed,left}')::numeric<>5
      OR (v_surface->>'surfaceSqFt')::numeric IS DISTINCT FROM round(((v_surface->>'widthInches')::numeric*(v_surface->>'heightInches')::numeric)/144,2)
    THEN RAISE EXCEPTION 'surface_dimension_contract_invalid'; END IF;
    v_total_sqft:=v_total_sqft+((v_surface->>'widthInches')::numeric*(v_surface->>'heightInches')::numeric)/144;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'surfaceKey') FROM jsonb_array_elements(p_manifest->'expectedSurfaces'))<>6
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['driver','passenger','hood','roof','front','rear']) required(surface_key)
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_manifest->'expectedSurfaces') s WHERE s->>'surfaceKey'=required.surface_key))
    OR (p_manifest->>'totalSqFt')::numeric IS DISTINCT FROM round(v_total_sqft,2)
  THEN RAISE EXCEPTION 'deterministic_surface_area_contract_invalid'; END IF;
  SELECT * INTO v_stage FROM public.designpro_workflow_stages WHERE id=p_stage_id AND run_id=p_run_id AND stage_key='manifest.resolve'
    AND status='running' AND lease_token=p_lease_token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'manifest_stage_lease_invalid'; END IF;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=p_run_id AND workflow_type='designpro.entice_pack' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'entice_workflow_not_found'; END IF;
  IF (v_run.dimension_manifest_id IS NOT NULL AND v_run.dimension_manifest_id IS DISTINCT FROM p_dimension_manifest_id)
    OR (v_run.manifest_hash IS NOT NULL AND v_run.manifest_hash IS DISTINCT FROM v_derived_manifest) THEN RAISE EXCEPTION 'manifest_identity_drift'; END IF;
  UPDATE public.designpro_workflow_runs SET dimension_manifest_id=COALESCE(dimension_manifest_id,p_dimension_manifest_id),
    manifest_hash=COALESCE(manifest_hash,v_derived_manifest),results=results||jsonb_build_object('dimensionManifest',p_manifest,'dimensionBasisHash',lower(p_dimension_basis_hash)),updated_at=clock_timestamp()
  WHERE id=p_run_id;
  RETURN jsonb_build_object('bound',true,'idempotent',v_run.dimension_manifest_id IS NOT NULL,'dimensionManifestId',p_dimension_manifest_id,'manifestHash',v_derived_manifest);
END $fn$;

CREATE OR REPLACE FUNCTION public.finalize_designpro_entice_identity(
  p_run_id uuid,p_stage_id uuid,p_lease_token uuid,p_source_contract_hash text,p_artifact_set_hash text,p_pack_receipt jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_run public.designpro_workflow_runs%ROWTYPE; v_stage public.designpro_workflow_stages%ROWTYPE; v_derived_artifacts text; v_derived_source text;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO v_stage FROM public.designpro_workflow_stages WHERE id=p_stage_id AND run_id=p_run_id AND stage_key='pack.verify'
    AND status='running' AND lease_token=p_lease_token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pack_verify_stage_lease_invalid'; END IF;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=p_run_id AND workflow_type='designpro.entice_pack' FOR UPDATE;
  IF NOT FOUND OR v_run.dimension_manifest_id IS NULL OR v_run.manifest_hash IS NULL THEN RAISE EXCEPTION 'manifest_identity_not_bound'; END IF;
  IF NOT COALESCE(p_pack_receipt,'{}') @> '{"verified":true,"exactCallSet":[8,9,10]}'::jsonb THEN RAISE EXCEPTION 'pack_receipt_invalid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts WHERE run_id=p_run_id AND receipt_kind='views.seven-source')
    OR NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts WHERE run_id=p_run_id AND receipt_kind='call8.flat-proof')
    OR NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts WHERE run_id=p_run_id AND receipt_kind='call9.surface-panels')
    OR NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts WHERE run_id=p_run_id AND receipt_kind='call10.logo-inventory')
  THEN RAISE EXCEPTION 'verified_seven_views_call8_call9_call10_receipts_required'; END IF;
  SELECT encode(extensions.digest(convert_to(string_agg(artifact_kind||':'||surface_key||':'||content_hash,'|' ORDER BY artifact_kind,surface_key,content_hash),'UTF8'),'sha256'),'hex')
  INTO v_derived_artifacts FROM public.designpro_artifacts WHERE run_id=p_run_id AND artifact_kind IN ('flat-proof','panel','logo');
  IF jsonb_typeof(p_pack_receipt->'sourceContract') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'source_contract_receipt_required'; END IF;
  v_derived_source:=encode(extensions.digest(convert_to((p_pack_receipt->'sourceContract')::text,'UTF8'),'sha256'),'hex');
  IF (NULLIF(btrim(COALESCE(p_artifact_set_hash,'')),'') IS NOT NULL AND v_derived_artifacts IS DISTINCT FROM lower(p_artifact_set_hash))
    OR (NULLIF(btrim(COALESCE(p_source_contract_hash,'')),'') IS NOT NULL AND v_derived_source IS DISTINCT FROM lower(p_source_contract_hash))
  THEN RAISE EXCEPTION 'derived_identity_hash_mismatch'; END IF;
  IF (v_run.source_contract_hash IS NOT NULL AND v_run.source_contract_hash IS DISTINCT FROM v_derived_source)
    OR (v_run.artifact_set_hash IS NOT NULL AND v_run.artifact_set_hash IS DISTINCT FROM v_derived_artifacts) THEN RAISE EXCEPTION 'final_identity_drift'; END IF;
  UPDATE public.designpro_workflow_runs SET source_contract_hash=COALESCE(source_contract_hash,v_derived_source),artifact_set_hash=COALESCE(artifact_set_hash,v_derived_artifacts),results=results||jsonb_build_object('packReceipt',p_pack_receipt),updated_at=clock_timestamp() WHERE id=p_run_id;
  RETURN jsonb_build_object('finalized',true,'idempotent',v_run.source_contract_hash IS NOT NULL,'sourceContractHash',v_derived_source,'artifactSetHash',v_derived_artifacts);
END $fn$;

CREATE OR REPLACE FUNCTION public.create_designpro_production_workflow(
  p_entice_run_id uuid,p_idempotency_key text,p_input jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_entice public.designpro_workflow_runs%ROWTYPE; v_run public.designpro_workflow_runs%ROWTYPE; v_stage text; v_seq int:=0;
BEGIN
  SELECT * INTO v_entice FROM public.designpro_workflow_runs WHERE id=p_entice_run_id AND workflow_type='designpro.entice_pack'
    AND status='completed' AND dimension_manifest_id IS NOT NULL AND manifest_hash IS NOT NULL AND source_contract_hash IS NOT NULL AND artifact_set_hash IS NOT NULL FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.designpro_workflow_stages WHERE run_id=p_entice_run_id AND stage_key='pack.activate' AND status='completed')
    OR jsonb_typeof(v_entice.results->'dimensionManifest') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'active_completed_entice_workflow_required'; END IF;
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM v_entice.owner_id THEN RAISE EXCEPTION 'workflow_owner_required'; END IF;
  INSERT INTO public.designpro_workflow_runs(workflow_type,owner_id,tenant_key,idempotency_key,revision_id,revision_snapshot_hash,entice_pack_id,dimension_manifest_id,source_contract_hash,manifest_hash,artifact_set_hash,input,results)
  VALUES('designpro.production_pack',v_entice.owner_id,v_entice.tenant_key,p_idempotency_key,v_entice.revision_id,v_entice.revision_snapshot_hash,v_entice.entice_pack_id,v_entice.dimension_manifest_id,v_entice.source_contract_hash,v_entice.manifest_hash,v_entice.artifact_set_hash,
    COALESCE(p_input,'{}')||jsonb_build_object('sourceEnticeRunId',v_entice.id,'dimensionManifest',v_entice.results->'dimensionManifest'),jsonb_build_object('sourceEnticeRunId',v_entice.id))
  ON CONFLICT(tenant_key,workflow_type,idempotency_key) DO NOTHING;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE tenant_key=v_entice.tenant_key AND workflow_type='designpro.production_pack' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_run.results->>'sourceEnticeRunId' IS DISTINCT FROM v_entice.id::text OR v_run.artifact_set_hash IS DISTINCT FROM v_entice.artifact_set_hash THEN RAISE EXCEPTION 'production_idempotency_identity_conflict'; END IF;
  FOREACH v_stage IN ARRAY ARRAY['source.verify','await_panelpro_preflight_qc','output.build','output.verify','await_final_human_qc','stamp.build','zip.build','wrapbox.deliver'] LOOP
    INSERT INTO public.designpro_workflow_stages(run_id,stage_key,sequence,idempotency_key,input) VALUES(v_run.id,v_stage,v_seq,v_run.id::text||':'||v_stage,jsonb_build_object('sourceEnticeRunId',v_entice.id)) ON CONFLICT(run_id,stage_key) DO NOTHING; v_seq:=v_seq+10;
  END LOOP;
  RETURN jsonb_build_object('workflowRunId',v_run.id,'sourceEnticeRunId',v_entice.id,'status',v_run.status);
END $fn$;

CREATE OR REPLACE FUNCTION public.create_designpro_entice_workflow(
  p_revision_id uuid,p_idempotency_key text,p_input jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_source public.designpro_revision_sources%ROWTYPE; v_run public.designpro_workflow_runs%ROWTYPE; v_stage text; v_seq int:=0; v_pack_id uuid:=extensions.gen_random_uuid();
BEGIN
  SELECT * INTO v_source FROM public.designpro_revision_sources WHERE revision_id=p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'immutable_revision_source_required'; END IF;
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM v_source.owner_id THEN RAISE EXCEPTION 'workflow_owner_required'; END IF;
  INSERT INTO public.designpro_workflow_runs(workflow_type,owner_id,tenant_key,idempotency_key,revision_id,revision_snapshot_hash,entice_pack_id,input,results)
  VALUES('designpro.entice_pack',v_source.owner_id,v_source.tenant_key,p_idempotency_key,v_source.revision_id,v_source.snapshot_hash,v_pack_id,
    COALESCE(p_input,'{}')||jsonb_build_object('revisionSourceId',v_source.revision_id),jsonb_build_object('generationId',v_source.generation_id,'visualizationId',v_source.visualization_id))
  ON CONFLICT(tenant_key,workflow_type,idempotency_key) DO NOTHING;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE tenant_key=v_source.tenant_key AND workflow_type='designpro.entice_pack' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_run.revision_id IS DISTINCT FROM v_source.revision_id OR v_run.revision_snapshot_hash IS DISTINCT FROM v_source.snapshot_hash THEN RAISE EXCEPTION 'entice_idempotency_identity_conflict'; END IF;
  FOREACH v_stage IN ARRAY ARRAY['revision.freeze','manifest.resolve','proof.build','panels.build','logos.extract','pack.verify','pack.activate'] LOOP
    INSERT INTO public.designpro_workflow_stages(run_id,stage_key,sequence,idempotency_key,input) VALUES(v_run.id,v_stage,v_seq,v_run.id::text||':'||v_stage,jsonb_build_object('revisionId',v_source.revision_id,'enticePackId',v_run.entice_pack_id)) ON CONFLICT(run_id,stage_key) DO NOTHING; v_seq:=v_seq+10;
  END LOOP;
  RETURN jsonb_build_object('workflowRunId',v_run.id,'revisionId',v_run.revision_id,'enticePackId',v_run.entice_pack_id,'status',v_run.status);
END $fn$;

REVOKE ALL ON FUNCTION public.bind_designpro_entice_manifest(uuid,uuid,uuid,uuid,jsonb,text,text),public.finalize_designpro_entice_identity(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_designpro_entice_manifest(uuid,uuid,uuid,uuid,jsonb,text,text),public.finalize_designpro_entice_identity(uuid,uuid,uuid,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.create_designpro_production_workflow(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_designpro_production_workflow(uuid,text,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_designpro_entice_workflow(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_designpro_entice_workflow(uuid,text,jsonb) TO authenticated,service_role;
