-- DesignProAI production hardening: preserve Universal GENIE candidates and
-- their provenance, but never treat estimates as print geometry. Exact six-
-- surface dimensions enter production only through an authenticated QC gate.

ALTER TABLE public.designpro_qc_members
  ADD COLUMN IF NOT EXISTS can_operate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grant_source text;

CREATE TABLE IF NOT EXISTS designpro_private.operator_grant_audit (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  member_email text NOT NULL,
  can_operate boolean NOT NULL,
  can_preflight boolean NOT NULL,
  can_final_qc boolean NOT NULL,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  grant_source text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE designpro_private.operator_grant_audit ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS designpro_qc_ready_member_idx
  ON public.designpro_qc_members(can_operate,can_preflight,can_final_qc)
  WHERE can_operate OR can_preflight OR can_final_qc;

CREATE OR REPLACE FUNCTION designpro_private.bootstrap_operator_by_email(
  p_email text,
  p_can_operate boolean DEFAULT true,
  p_can_preflight boolean DEFAULT true,
  p_can_final_qc boolean DEFAULT true,
  p_grant_source text DEFAULT 'production-bootstrap'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_email text := lower(btrim(p_email));
  v_member auth.users%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF session_user NOT IN ('postgres','supabase_admin')
    AND COALESCE(auth.jwt()->>'role','') <> 'service_role'
  THEN
    RAISE EXCEPTION 'service_role_or_database_owner_required';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR length(v_email) > 320
    OR NOT (p_can_operate OR p_can_preflight OR p_can_final_qc)
    OR NULLIF(btrim(p_grant_source),'') IS NULL
  THEN
    RAISE EXCEPTION 'operator_bootstrap_request_invalid';
  END IF;

  SELECT * INTO STRICT v_member
  FROM auth.users
  WHERE lower(email) = v_email;
  IF v_member.email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'confirmed_auth_user_required';
  END IF;

  INSERT INTO public.designpro_qc_members(
    user_id,can_operate,can_preflight,can_final_qc,granted_at,granted_by,grant_source
  ) VALUES(
    v_member.id,p_can_operate,p_can_preflight,p_can_final_qc,
    clock_timestamp(),v_actor,p_grant_source
  )
  ON CONFLICT(user_id) DO UPDATE SET
    can_operate = public.designpro_qc_members.can_operate OR EXCLUDED.can_operate,
    can_preflight = public.designpro_qc_members.can_preflight OR EXCLUDED.can_preflight,
    can_final_qc = public.designpro_qc_members.can_final_qc OR EXCLUDED.can_final_qc,
    granted_at = EXCLUDED.granted_at,
    granted_by = EXCLUDED.granted_by,
    grant_source = EXCLUDED.grant_source;

  INSERT INTO designpro_private.operator_grant_audit(
    member_id,member_email,can_operate,can_preflight,can_final_qc,
    granted_by,grant_source
  ) VALUES(
    v_member.id,v_email,p_can_operate,p_can_preflight,p_can_final_qc,
    v_actor,p_grant_source
  );
  RETURN jsonb_build_object(
    'userId',v_member.id,
    'email',v_email,
    'canOperate',p_can_operate,
    'canPreflight',p_can_preflight,
    'canFinalQc',p_can_final_qc,
    'grantSource',p_grant_source
  );
EXCEPTION
  WHEN no_data_found THEN RAISE EXCEPTION 'confirmed_auth_user_not_found';
  WHEN too_many_rows THEN RAISE EXCEPTION 'auth_email_identity_ambiguous';
END
$fn$;

CREATE TABLE IF NOT EXISTS designpro_private.genie_candidate_catalog_imports (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  contract_version text NOT NULL
    CHECK (contract_version = 'designpro.genie-candidate-catalog.v1'),
  catalog_version text NOT NULL UNIQUE
    CHECK (catalog_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  catalog_hash text NOT NULL UNIQUE CHECK (catalog_hash ~ '^[0-9a-f]{64}$'),
  source_name text NOT NULL CHECK (NULLIF(btrim(source_name),'') IS NOT NULL),
  source_uri text,
  row_count integer NOT NULL CHECK (row_count > 0),
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE designpro_private.genie_candidate_catalog_imports ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.designpro_vehicle_specs_universal (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  vehicle_class text NOT NULL CHECK (vehicle_class IN (
    'car','truck','suv','van','motorcycle','boat','bus','rv','trailer',
    'aircraft','heavy_equipment'
  )),
  make text NOT NULL CHECK (NULLIF(btrim(make),'') IS NOT NULL),
  model text NOT NULL CHECK (NULLIF(btrim(model),'') IS NOT NULL),
  year text,
  sub_type text,
  overall_length_in numeric CHECK (overall_length_in IS NULL OR overall_length_in > 0),
  overall_width_in numeric CHECK (overall_width_in IS NULL OR overall_width_in > 0),
  overall_height_in numeric CHECK (overall_height_in IS NULL OR overall_height_in > 0),
  wheelbase_in numeric CHECK (wheelbase_in IS NULL OR wheelbase_in > 0),
  panels jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'gemini_grounded'
    CHECK (source IN ('gemini_grounded','manual','oem_spec_sheet','dealer_brochure','legacy_candidate_import')),
  source_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  confidence text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
  requires_validation boolean NOT NULL DEFAULT true,
  validated_surfaces jsonb,
  validated_total_sqft numeric,
  validated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  validated_at timestamptz,
  validation_notes text,
  validation_evidence jsonb,
  validation_hash text CHECK (validation_hash IS NULL OR validation_hash ~ '^[0-9a-f]{64}$'),
  raw_response jsonb,
  candidate_hash text NOT NULL CHECK (candidate_hash ~ '^[0-9a-f]{64}$'),
  catalog_import_id uuid REFERENCES designpro_private.genie_candidate_catalog_imports(id) ON DELETE RESTRICT,
  source_record_key text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT designpro_universal_validation_state CHECK (
    (requires_validation AND validated_surfaces IS NULL AND validated_by IS NULL
      AND validated_at IS NULL AND validation_hash IS NULL)
    OR
    (NOT requires_validation AND validated_surfaces IS NOT NULL
      AND validated_total_sqft > 0 AND validated_by IS NOT NULL
      AND validated_at IS NOT NULL AND validation_hash ~ '^[0-9a-f]{64}$')
  )
);

COMMENT ON COLUMN public.designpro_vehicle_specs_universal.panels IS
  'Estimated coverage only; never accepted as exact Call 8/9 print geometry.';
COMMENT ON COLUMN public.designpro_vehicle_specs_universal.validated_surfaces IS
  'Human-verified six-surface width/height contract used by manifest.resolve.';

CREATE INDEX IF NOT EXISTS designpro_universal_candidate_lookup_idx
  ON public.designpro_vehicle_specs_universal(
    vehicle_class,lower(btrim(make)),lower(btrim(model)),year,created_at DESC,id
  );
-- Concurrent grounded lookup may create only one current candidate for a
-- normalized vehicle identity. Imported/manual sources retain ambiguity so an
-- operator must resolve conflicting historical geometry explicitly.
CREATE UNIQUE INDEX IF NOT EXISTS designpro_universal_grounded_identity_uidx
  ON public.designpro_vehicle_specs_universal(
    vehicle_class,lower(btrim(make)),lower(btrim(model)),COALESCE(year,'')
  )
  WHERE source = 'gemini_grounded';
CREATE INDEX IF NOT EXISTS designpro_universal_pending_idx
  ON public.designpro_vehicle_specs_universal(created_at,id)
  WHERE requires_validation;
CREATE UNIQUE INDEX IF NOT EXISTS designpro_universal_catalog_record_idx
  ON public.designpro_vehicle_specs_universal(catalog_import_id,source_record_key)
  WHERE catalog_import_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.designpro_universal_dimension_requests (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.designpro_vehicle_specs_universal(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL UNIQUE REFERENCES public.designpro_workflow_runs(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL UNIQUE REFERENCES public.designpro_workflow_stages(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS designpro_universal_request_candidate_idx
  ON public.designpro_universal_dimension_requests(candidate_id,resolved_at,requested_at);

ALTER TABLE public.designpro_vehicle_specs_universal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designpro_universal_dimension_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.designpro_vehicle_specs_universal,
  public.designpro_universal_dimension_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.designpro_vehicle_specs_universal,
  public.designpro_universal_dimension_requests TO service_role;

CREATE OR REPLACE FUNCTION designpro_private.set_universal_candidate_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_hash text;
BEGIN
  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'vehicleClass',NEW.vehicle_class,
    'make',btrim(NEW.make),
    'model',btrim(NEW.model),
    'year',COALESCE(NEW.year,''),
    'subType',COALESCE(NEW.sub_type,''),
    'overallLengthIn',NEW.overall_length_in,
    'overallWidthIn',NEW.overall_width_in,
    'overallHeightIn',NEW.overall_height_in,
    'wheelbaseIn',NEW.wheelbase_in,
    'panels',NEW.panels,
    'source',NEW.source,
    'sourceUrls',to_jsonb(NEW.source_urls),
    'confidence',NEW.confidence
  )::text,'UTF8'),'sha256'),'hex');

  IF TG_OP = 'UPDATE' AND v_hash IS DISTINCT FROM OLD.candidate_hash THEN
    NEW.requires_validation := true;
    NEW.validated_surfaces := NULL;
    NEW.validated_total_sqft := NULL;
    NEW.validated_by := NULL;
    NEW.validated_at := NULL;
    NEW.validation_notes := NULL;
    NEW.validation_evidence := NULL;
    NEW.validation_hash := NULL;
  END IF;
  NEW.candidate_hash := v_hash;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS designpro_universal_candidate_hash ON public.designpro_vehicle_specs_universal;
CREATE TRIGGER designpro_universal_candidate_hash
BEFORE INSERT OR UPDATE OF vehicle_class,make,model,year,sub_type,
  overall_length_in,overall_width_in,overall_height_in,wheelbase_in,panels,
  source,source_urls,confidence
ON public.designpro_vehicle_specs_universal
FOR EACH ROW EXECUTE FUNCTION designpro_private.set_universal_candidate_hash();

CREATE OR REPLACE FUNCTION public.request_designpro_universal_dimension_validation(
  p_run_id uuid,
  p_candidate_id uuid,
  p_stage_id uuid,
  p_lease_token uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_stage public.designpro_workflow_stages%ROWTYPE;
  v_candidate public.designpro_vehicle_specs_universal%ROWTYPE;
  v_existing public.designpro_universal_dimension_requests%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  SELECT * INTO v_candidate
  FROM public.designpro_vehicle_specs_universal
  WHERE id = p_candidate_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'genie_candidate_not_found'; END IF;
  IF NOT v_candidate.requires_validation THEN
    RETURN jsonb_build_object('waiting',false,'validated',true,'candidateId',p_candidate_id);
  END IF;

  SELECT * INTO v_stage
  FROM public.designpro_workflow_stages
  WHERE id = p_stage_id AND run_id = p_run_id AND stage_key = 'manifest.resolve'
    AND status = 'running' AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'manifest_stage_lease_invalid'; END IF;

  SELECT * INTO v_existing
  FROM public.designpro_universal_dimension_requests
  WHERE run_id = p_run_id
  FOR UPDATE;
  IF FOUND AND (v_existing.candidate_id IS DISTINCT FROM p_candidate_id
    OR v_existing.stage_id IS DISTINCT FROM p_stage_id)
  THEN
    RAISE EXCEPTION 'genie_validation_request_identity_conflict';
  END IF;
  IF NOT FOUND THEN
    INSERT INTO public.designpro_universal_dimension_requests(candidate_id,run_id,stage_id)
    VALUES(p_candidate_id,p_run_id,p_stage_id);
  END IF;

  UPDATE public.designpro_workflow_stages
  SET status = 'waiting',
    wait_reason = 'genie_dimension_validation_required',
    wait_details = jsonb_build_object(
      'candidateId',p_candidate_id,
      'requestedAt',clock_timestamp()
    ),
    lease_owner = NULL,lease_token = NULL,lease_expires_at = NULL,
    updated_at = clock_timestamp()
  WHERE id = p_stage_id;
  PERFORM public.designpro_sync_run_status(p_run_id);
  UPDATE public.designpro_workflow_runs
  SET status = 'waiting',updated_at = clock_timestamp()
  WHERE id = p_run_id;
  RETURN jsonb_build_object('waiting',true,'validated',false,'candidateId',p_candidate_id,'runId',p_run_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.validate_designpro_vehicle_spec_universal(
  p_candidate_id uuid,
  p_validated_surfaces jsonb,
  p_notes text,
  p_evidence jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_candidate public.designpro_vehicle_specs_universal%ROWTYPE;
  v_surface_key text;
  v_surface jsonb;
  v_surfaces jsonb := p_validated_surfaces->'surfaces';
  v_width numeric;
  v_height numeric;
  v_total_sqft numeric := 0;
  v_hash text;
  v_resumed integer := 0;
  v_run_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.designpro_qc_members q
    WHERE q.user_id = v_actor AND q.can_preflight
  ) THEN
    RAISE EXCEPTION 'panelpro_preflight_permission_required';
  END IF;
  IF p_validated_surfaces->>'contractVersion'
      IS DISTINCT FROM 'designpro.genie-validated-surfaces.v1'
    OR jsonb_typeof(v_surfaces) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(v_surfaces)) <> 6
    OR NOT v_surfaces ?& ARRAY['driver','passenger','hood','roof','front','rear']
    OR p_evidence->>'contractVersion'
      IS DISTINCT FROM 'designpro.genie-validation-evidence.v1'
    OR NOT COALESCE((p_evidence->>'sourceReviewed')::boolean,false)
    OR NOT COALESCE((p_evidence->>'sourceUrlsReviewed')::boolean,false)
    OR NOT COALESCE((p_evidence->>'operatorAttestation')::boolean,false)
    OR length(btrim(COALESCE(p_notes,''))) < 8
  THEN
    RAISE EXCEPTION 'exact_genie_validation_evidence_required';
  END IF;

  FOREACH v_surface_key IN ARRAY ARRAY['driver','passenger','hood','roof','front','rear'] LOOP
    v_surface := v_surfaces->v_surface_key;
    IF jsonb_typeof(v_surface) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(v_surface)) <> 2
      OR NOT v_surface ?& ARRAY['widthInches','heightInches']
      OR v_surface->>'widthInches' !~ '^[0-9]+(\.[0-9]+)?$'
      OR v_surface->>'heightInches' !~ '^[0-9]+(\.[0-9]+)?$'
    THEN
      RAISE EXCEPTION 'six_exact_surface_pairs_required';
    END IF;
    v_width := (v_surface->>'widthInches')::numeric;
    v_height := (v_surface->>'heightInches')::numeric;
    IF v_width <= 0 OR v_height <= 0 OR v_width > 5000 OR v_height > 5000 THEN
      RAISE EXCEPTION 'validated_surface_dimension_out_of_range';
    END IF;
    v_total_sqft := v_total_sqft + ((v_width * v_height) / 144);
  END LOOP;
  v_total_sqft := round(v_total_sqft,2);

  SELECT * INTO v_candidate
  FROM public.designpro_vehicle_specs_universal
  WHERE id = p_candidate_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'genie_candidate_not_found'; END IF;
  IF COALESCE(array_length(v_candidate.source_urls,1),0) = 0 THEN
    RAISE EXCEPTION 'genie_candidate_provenance_required';
  END IF;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'candidateId',p_candidate_id,
    'candidateHash',v_candidate.candidate_hash,
    'validatedSurfaces',p_validated_surfaces,
    'validatedTotalSqFt',v_total_sqft,
    'actorId',v_actor,
    'notes',btrim(p_notes),
    'evidence',p_evidence
  )::text,'UTF8'),'sha256'),'hex');
  IF NOT v_candidate.requires_validation THEN
    IF v_candidate.validation_hash = v_hash THEN
      RETURN jsonb_build_object(
        'candidateId',p_candidate_id,'validationHash',v_hash,
        'validatedTotalSqFt',v_candidate.validated_total_sqft,
        'resumedRuns',0,'idempotent',true
      );
    END IF;
    RAISE EXCEPTION 'validated_genie_candidate_is_immutable';
  END IF;

  UPDATE public.designpro_vehicle_specs_universal
  SET requires_validation = false,
    validated_surfaces = p_validated_surfaces,
    validated_total_sqft = v_total_sqft,
    validated_by = v_actor,
    validated_at = clock_timestamp(),
    validation_notes = btrim(p_notes),
    validation_evidence = p_evidence,
    validation_hash = v_hash,
    updated_at = clock_timestamp()
  WHERE id = p_candidate_id;

  FOR v_run_id IN
    WITH resolved AS (
      UPDATE public.designpro_universal_dimension_requests
      SET resolved_at = clock_timestamp()
      WHERE candidate_id = p_candidate_id AND resolved_at IS NULL
      RETURNING run_id,stage_id
    ), resumed AS (
      UPDATE public.designpro_workflow_stages s
      SET status = 'retryable',available_at = clock_timestamp(),
        wait_reason = NULL,wait_details = '{}'::jsonb,
        error_code = NULL,error_message = NULL,error_details = '{}'::jsonb,
        updated_at = clock_timestamp()
      FROM resolved r
      WHERE s.id = r.stage_id AND s.run_id = r.run_id
        AND s.stage_key = 'manifest.resolve'
        AND s.status = 'waiting'
        AND s.wait_reason = 'genie_dimension_validation_required'
      RETURNING s.run_id
    ) SELECT DISTINCT run_id FROM resumed
  LOOP
    v_resumed := v_resumed + 1;
    PERFORM public.designpro_sync_run_status(v_run_id);
  END LOOP;

  RETURN jsonb_build_object(
    'candidateId',p_candidate_id,
    'validationHash',v_hash,
    'validatedTotalSqFt',v_total_sqft,
    'resumedRuns',v_resumed,
    'idempotent',false
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.list_pending_designpro_vehicle_specs_universal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.designpro_qc_members q
    WHERE q.user_id = v_actor AND q.can_preflight
  ) THEN
    RAISE EXCEPTION 'panelpro_preflight_permission_required';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'candidateId',c.id,
    'vehicleClass',c.vehicle_class,
    'make',c.make,'model',c.model,'year',c.year,'subType',c.sub_type,
    'overallDimensions',jsonb_build_object(
      'lengthInches',c.overall_length_in,
      'widthInches',c.overall_width_in,
      'heightInches',c.overall_height_in,
      'wheelbaseInches',c.wheelbase_in
    ),
    'source',c.source,'sourceUrls',to_jsonb(c.source_urls),'confidence',c.confidence,
    'runId',r.id,
    'generationId',r.results->>'generationId',
    'visualizationId',r.results->>'visualizationId',
    'requestedAt',q.requested_at
  ) ORDER BY q.requested_at,c.id),'[]'::jsonb)
  INTO v_result
  FROM public.designpro_universal_dimension_requests q
  JOIN public.designpro_vehicle_specs_universal c ON c.id = q.candidate_id
  JOIN public.designpro_workflow_runs r ON r.id = q.run_id
  WHERE q.resolved_at IS NULL AND c.requires_validation;
  RETURN v_result;
END
$fn$;

CREATE OR REPLACE FUNCTION designpro_private.import_genie_candidate_catalog(
  p_catalog jsonb,
  p_catalog_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_catalog_version text;
  v_derived_hash text;
  v_import_id uuid;
  v_existing designpro_private.genie_candidate_catalog_imports%ROWTYPE;
  v_record jsonb;
  v_record_count integer;
BEGIN
  IF session_user NOT IN ('postgres','supabase_admin')
    AND COALESCE(auth.jwt()->>'role','') <> 'service_role'
  THEN
    RAISE EXCEPTION 'service_role_or_database_owner_required';
  END IF;
  IF p_catalog->>'contractVersion'
      IS DISTINCT FROM 'designpro.genie-candidate-catalog.v1'
    OR jsonb_typeof(p_catalog->'records') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_catalog->'records') = 0
    OR NULLIF(btrim(p_catalog#>>'{source,name}'),'') IS NULL
  THEN
    RAISE EXCEPTION 'genie_candidate_catalog_contract_required';
  END IF;
  v_catalog_version := p_catalog->>'catalogVersion';
  IF v_catalog_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' THEN
    RAISE EXCEPTION 'safe_catalog_version_required';
  END IF;
  v_derived_hash := encode(
    extensions.digest(convert_to(p_catalog::text,'UTF8'),'sha256'),'hex'
  );
  IF p_catalog_hash !~ '^[0-9a-f]{64}$'
    OR p_catalog_hash IS DISTINCT FROM v_derived_hash
  THEN
    RAISE EXCEPTION 'genie_candidate_catalog_hash_mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('designpro.genie-candidate-import',0));
  SELECT * INTO v_existing
  FROM designpro_private.genie_candidate_catalog_imports
  WHERE catalog_version = v_catalog_version OR catalog_hash = v_derived_hash
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.catalog_version = v_catalog_version
      AND v_existing.catalog_hash = v_derived_hash
    THEN
      RETURN jsonb_build_object(
        'importId',v_existing.id,'catalogHash',v_existing.catalog_hash,
        'rowCount',v_existing.row_count,'idempotent',true
      );
    END IF;
    RAISE EXCEPTION 'genie_candidate_catalog_identity_conflict';
  END IF;

  v_record_count := jsonb_array_length(p_catalog->'records');
  INSERT INTO designpro_private.genie_candidate_catalog_imports(
    contract_version,catalog_version,catalog_hash,source_name,source_uri,row_count
  ) VALUES(
    'designpro.genie-candidate-catalog.v1',v_catalog_version,v_derived_hash,
    p_catalog#>>'{source,name}',NULLIF(btrim(p_catalog#>>'{source,uri}'),''),v_record_count
  ) RETURNING id INTO v_import_id;

  FOR v_record IN SELECT value FROM jsonb_array_elements(p_catalog->'records') LOOP
    IF jsonb_typeof(v_record) IS DISTINCT FROM 'object'
      OR (v_record->>'sourceRecordKey') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
      OR v_record->>'vehicleClass' NOT IN (
        'car','truck','suv','van','motorcycle','boat','bus','rv','trailer',
        'aircraft','heavy_equipment'
      )
      OR NULLIF(btrim(v_record->>'make'),'') IS NULL
      OR NULLIF(btrim(v_record->>'model'),'') IS NULL
      OR v_record->>'confidence' NOT IN ('high','medium','low')
    THEN
      RAISE EXCEPTION 'genie_candidate_catalog_record_invalid';
    END IF;
    INSERT INTO public.designpro_vehicle_specs_universal(
      vehicle_class,make,model,year,sub_type,
      overall_length_in,overall_width_in,overall_height_in,wheelbase_in,
      panels,source,source_urls,confidence,requires_validation,raw_response,
      candidate_hash,catalog_import_id,source_record_key
    ) VALUES(
      v_record->>'vehicleClass',btrim(v_record->>'make'),btrim(v_record->>'model'),
      NULLIF(btrim(v_record->>'year'),''),NULLIF(btrim(v_record->>'subType'),''),
      NULLIF(v_record->>'overallLengthIn','')::numeric,
      NULLIF(v_record->>'overallWidthIn','')::numeric,
      NULLIF(v_record->>'overallHeightIn','')::numeric,
      NULLIF(v_record->>'wheelbaseIn','')::numeric,
      COALESCE(v_record->'estimatedPanels','{}'::jsonb),
      COALESCE(NULLIF(v_record->>'source',''),'legacy_candidate_import'),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_record->'sourceUrls')),ARRAY[]::text[]),
      v_record->>'confidence',true,v_record->'rawResponse',
      repeat('0',64),v_import_id,v_record->>'sourceRecordKey'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'importId',v_import_id,'catalogVersion',v_catalog_version,
    'catalogHash',v_derived_hash,'rowCount',v_record_count,'idempotent',false
  );
END
$fn$;

REVOKE ALL ON designpro_private.operator_grant_audit,
  designpro_private.genie_candidate_catalog_imports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON designpro_private.operator_grant_audit,
  designpro_private.genie_candidate_catalog_imports TO service_role;

REVOKE ALL ON FUNCTION designpro_private.bootstrap_operator_by_email(text,boolean,boolean,boolean,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION designpro_private.import_genie_candidate_catalog(jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION designpro_private.bootstrap_operator_by_email(text,boolean,boolean,boolean,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION designpro_private.import_genie_candidate_catalog(jsonb,text)
  TO service_role;

REVOKE ALL ON FUNCTION public.request_designpro_universal_dimension_validation(uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_designpro_universal_dimension_validation(uuid,uuid,uuid,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.validate_designpro_vehicle_spec_universal(uuid,jsonb,text,jsonb)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.validate_designpro_vehicle_spec_universal(uuid,jsonb,text,jsonb)
  TO authenticated;
REVOKE ALL ON FUNCTION public.list_pending_designpro_vehicle_specs_universal()
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_pending_designpro_vehicle_specs_universal()
  TO authenticated;
