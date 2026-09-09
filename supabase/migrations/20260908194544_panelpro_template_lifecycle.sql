-- Internal measured-template import -> Gemini display candidate -> explicit
-- geometry-overlay review -> immutable template bank. No customer write/read
-- grants, no geometry inferred by a model, and no automatic creative reroll.
CREATE TABLE public.panelprofile_template_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  template_id text NOT NULL CHECK (template_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  version text NOT NULL CHECK (version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  geometry_hash text NOT NULL CHECK (geometry_hash ~ '^[a-f0-9]{64}$'),
  source jsonb NOT NULL CHECK (jsonb_typeof(source)='object'),
  reviewed_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id,template_id,version)
);
CREATE INDEX panelprofile_template_sources_owner_idx
  ON public.panelprofile_template_sources(owner_id,created_at DESC);

CREATE TABLE public.panelprofile_template_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL UNIQUE REFERENCES public.panelprofile_template_sources(id),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  definition_version text NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','running','waiting_review','approved','blocked','failed')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  cache_only boolean NOT NULL DEFAULT false,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  bank_id uuid REFERENCES public.panelprofile_template_bank(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state<>'running' OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state<>'approved' OR bank_id IS NOT NULL)
);
CREATE INDEX panelprofile_template_candidates_ready_idx
  ON public.panelprofile_template_candidates(available_at,created_at) WHERE state IN ('queued','running');
CREATE INDEX panelprofile_template_candidates_owner_idx
  ON public.panelprofile_template_candidates(owner_id,created_at DESC);
CREATE INDEX panelprofile_template_candidates_bank_idx ON public.panelprofile_template_candidates(bank_id);

CREATE TABLE public.panelprofile_template_bank_evidence (
  candidate_id uuid PRIMARY KEY REFERENCES public.panelprofile_template_candidates(id),
  source_id uuid NOT NULL REFERENCES public.panelprofile_template_sources(id),
  bank_id uuid NOT NULL UNIQUE REFERENCES public.panelprofile_template_bank(id),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  cache_key text NOT NULL CHECK (cache_key ~ '^[a-f0-9]{64}$'),
  candidate_hash text NOT NULL CHECK (candidate_hash ~ '^[a-f0-9]{64}$'),
  source_geometry_hash text NOT NULL CHECK (source_geometry_hash ~ '^[a-f0-9]{64}$'),
  review_hash text NOT NULL CHECK (review_hash ~ '^[a-f0-9]{64}$'),
  review jsonb NOT NULL,
  reviewed_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,cache_key)
);
CREATE INDEX panelprofile_template_evidence_source_idx ON public.panelprofile_template_bank_evidence(source_id);

CREATE TABLE public.panelprofile_template_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES public.panelprofile_template_candidates(id),
  state text NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX panelprofile_template_events_candidate_idx ON public.panelprofile_template_events(candidate_id,id);
CREATE TRIGGER panelprofile_template_sources_immutable
  BEFORE UPDATE OR DELETE ON public.panelprofile_template_sources
  FOR EACH ROW EXECUTE FUNCTION public.panelprofile_reject_mutation();
CREATE TRIGGER panelprofile_template_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.panelprofile_template_bank_evidence
  FOR EACH ROW EXECUTE FUNCTION public.panelprofile_reject_mutation();

CREATE FUNCTION public.panelprofile_template_event() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO public.panelprofile_template_events(candidate_id,state,error_code)
      VALUES(NEW.id,NEW.state,NEW.error_code);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER panelprofile_template_state_event AFTER INSERT OR UPDATE ON public.panelprofile_template_candidates
  FOR EACH ROW EXECUTE FUNCTION public.panelprofile_template_event();

CREATE FUNCTION public.register_panelprofile_template_source(p_actor uuid,p_source jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s public.panelprofile_template_sources; o uuid; ref jsonb; BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.designpro_qc_members WHERE user_id=p_actor AND can_preflight)
    THEN RAISE EXCEPTION 'template_qc_permission_required'; END IF;
  o:=(p_source->>'ownerId')::uuid;
  IF o IS NULL OR jsonb_typeof(p_source) IS DISTINCT FROM 'object'
    OR p_source#>>'{review,measuredDimensions}' IS DISTINCT FROM 'true'
    OR p_source#>>'{review,cutAreasReviewed}' IS DISTINCT FROM 'true'
    OR p_source#>>'{review,rasterMatchesVector}' IS DISTINCT FROM 'true'
    OR p_source#>'{review,vehicleIdentity}' IS DISTINCT FROM p_source->'vehicle'
    OR coalesce(length(p_source#>>'{review,physicalMeasurementReference}'),0) NOT BETWEEN 1 AND 500
    OR coalesce(length(p_source#>>'{review,reviewRef}'),0) NOT BETWEEN 1 AND 160
    OR coalesce((p_source#>>'{review,fitToleranceInches}')::numeric,0) NOT BETWEEN 0.001 AND 1
    OR jsonb_typeof(p_source->'vehicle') IS DISTINCT FROM 'object'
    OR coalesce(length(p_source#>>'{vehicle,make}'),0)=0 OR coalesce(length(p_source#>>'{vehicle,model}'),0)=0
    OR coalesce(length(p_source#>>'{vehicle,year}'),0)=0 OR coalesce(length(p_source#>>'{vehicle,bodyStyle}'),0)=0
    THEN RAISE EXCEPTION 'template_measured_source_review_required'; END IF;
  FOREACH ref IN ARRAY ARRAY[p_source->'geometry',p_source->'sourceVector',p_source->'sourceRaster',p_source->'brand'] LOOP
    IF coalesce(ref->>'contentHash','') !~ '^[a-f0-9]{64}$'
      OR coalesce(ref->>'storagePath','') NOT LIKE 'designpro-template-private/v1/'||o::text||'/sources/%'
      THEN RAISE EXCEPTION 'template_source_scope_invalid'; END IF;
  END LOOP;
  INSERT INTO public.panelprofile_template_sources(owner_id,template_id,version,input_hash,geometry_hash,source,reviewed_by)
    VALUES(o,p_source->>'templateId',p_source->>'version',p_source->>'inputHash',p_source#>>'{geometry,contentHash}',p_source,p_actor)
    ON CONFLICT(owner_id,template_id,version) DO NOTHING;
  SELECT * INTO STRICT s FROM public.panelprofile_template_sources
    WHERE owner_id=o AND template_id=p_source->>'templateId' AND version=p_source->>'version';
  IF s.input_hash IS DISTINCT FROM p_source->>'inputHash' OR s.source IS DISTINCT FROM p_source
    THEN RAISE EXCEPTION 'template_source_version_collision'; END IF;
  RETURN to_jsonb(s);
END $$;

CREATE FUNCTION public.create_panelprofile_template_candidate(p_actor uuid,p_source_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s public.panelprofile_template_sources; c public.panelprofile_template_candidates; BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.designpro_qc_members WHERE user_id=p_actor AND can_preflight)
    THEN RAISE EXCEPTION 'template_qc_permission_required'; END IF;
  SELECT * INTO STRICT s FROM public.panelprofile_template_sources WHERE id=p_source_id;
  INSERT INTO public.panelprofile_template_candidates(source_id,owner_id,requested_by,definition_version,input_hash)
    VALUES(s.id,s.owner_id,p_actor,'designpro.panelpro-template-service.v1',s.input_hash)
    ON CONFLICT(source_id) DO NOTHING;
  SELECT * INTO STRICT c FROM public.panelprofile_template_candidates WHERE source_id=s.id;
  RETURN to_jsonb(c);
END $$;

CREATE FUNCTION public.claim_panelprofile_template_candidate(p_worker text,p_ttl integer DEFAULT 180) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c public.panelprofile_template_candidates; s public.panelprofile_template_sources; BEGIN
  IF coalesce(length(btrim(p_worker)),0) NOT BETWEEN 1 AND 160 OR p_ttl NOT BETWEEN 150 AND 600
    THEN RAISE EXCEPTION 'template_worker_identity_invalid'; END IF;
  UPDATE public.panelprofile_template_candidates SET state='failed',error_code='template_recovery_limit_reached',
    lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE state='running' AND lease_expires_at<clock_timestamp() AND attempt>=3;
  SELECT * INTO c FROM public.panelprofile_template_candidates
    WHERE (state='queued' AND available_at<=clock_timestamp() OR state='running' AND lease_expires_at<clock_timestamp())
      AND attempt<3 ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.panelprofile_template_candidates SET state='running',attempt=attempt+1,lease_owner=p_worker,
    lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>p_ttl),updated_at=clock_timestamp()
    WHERE id=c.id RETURNING * INTO c;
  SELECT * INTO STRICT s FROM public.panelprofile_template_sources WHERE id=c.source_id AND owner_id=c.owner_id;
  RETURN jsonb_build_object('candidate',to_jsonb(c),'source',to_jsonb(s));
END $$;

CREATE FUNCTION public.heartbeat_panelprofile_template_candidate(p_id uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  UPDATE public.panelprofile_template_candidates SET lease_expires_at=clock_timestamp()+interval '180 seconds',updated_at=clock_timestamp()
    WHERE id=p_id AND state='running' AND lease_token=p_token AND lease_expires_at>clock_timestamp();
  RETURN FOUND;
END $$;

CREATE FUNCTION public.finish_panelprofile_template_candidate(p_id uuid,p_token uuid,p_state text,p_output jsonb,p_error jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c public.panelprofile_template_candidates; s public.panelprofile_template_sources; BEGIN
  SELECT * INTO STRICT c FROM public.panelprofile_template_candidates WHERE id=p_id FOR UPDATE;
  IF c.state<>'running' OR c.lease_token IS DISTINCT FROM p_token OR c.lease_expires_at<=clock_timestamp()
    THEN RAISE EXCEPTION 'template_lease_lost'; END IF;
  IF p_state NOT IN ('waiting_review','blocked','failed','queued') OR p_state IS NULL
    THEN RAISE EXCEPTION 'template_candidate_state_invalid'; END IF;
  IF p_state='waiting_review' THEN
    SELECT * INTO STRICT s FROM public.panelprofile_template_sources WHERE id=c.source_id AND owner_id=c.owner_id;
    IF p_output->>'ownerId' IS DISTINCT FROM c.owner_id::text OR p_output->>'requestId' IS DISTINCT FROM c.id::text
      OR p_output->>'generationId' IS DISTINCT FROM c.id::text
      OR p_output->>'templateId' IS DISTINCT FROM s.template_id OR p_output->>'version' IS DISTINCT FROM s.version
      OR p_output->'sourceGeometry' IS DISTINCT FROM s.source->'geometry'
      OR p_output->'sourceRaster' IS DISTINCT FROM s.source->'sourceRaster'
      OR p_output->'brand' IS DISTINCT FROM s.source->'brand'
      OR p_output->>'sourceGeometryReviewId' IS DISTINCT FROM s.id::text
      OR p_output->>'status' IS DISTINCT FROM 'requires_geometry_overlay_review'
      OR p_output->>'customerVisible' IS DISTINCT FROM 'false'
      OR coalesce(p_output->>'candidateHash','') !~ '^[a-f0-9]{64}$'
      OR coalesce(p_output->>'cacheKey','') !~ '^[a-f0-9]{64}$'
      OR coalesce(p_output#>>'{candidateRef,contentHash}','') !~ '^[a-f0-9]{64}$'
      OR coalesce(p_output#>>'{candidateRef,storagePath}','') NOT LIKE 'designpro-template-private/v1/'||c.owner_id::text||'/candidates/'||c.id::text||'/%'
      THEN RAISE EXCEPTION 'template_candidate_receipt_invalid'; END IF;
  END IF;
  UPDATE public.panelprofile_template_candidates SET
    state=CASE WHEN p_state='queued' AND attempt>=3 THEN 'failed' ELSE p_state END,
    output=coalesce(p_output,'{}'::jsonb),error_code=p_error->>'code',error_detail=coalesce(p_error,'{}'::jsonb),
    available_at=clock_timestamp()+interval '15 seconds',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
    updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
  RETURN to_jsonb(c);
END $$;

-- An operator may request a read-only recovery of the exact same provider
-- receipt. This never creates a new model attempt, even after a missing reply.
CREATE FUNCTION public.recover_panelprofile_template_candidate(p_actor uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c public.panelprofile_template_candidates; BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.designpro_qc_members WHERE user_id=p_actor AND can_preflight)
    THEN RAISE EXCEPTION 'template_qc_permission_required'; END IF;
  SELECT * INTO STRICT c FROM public.panelprofile_template_candidates WHERE id=p_id FOR UPDATE;
  IF c.state NOT IN ('blocked','failed') THEN RAISE EXCEPTION 'template_recovery_state_invalid'; END IF;
  UPDATE public.panelprofile_template_candidates SET state='queued',cache_only=true,attempt=0,
    available_at=clock_timestamp(),error_code=NULL,error_detail='{}',updated_at=clock_timestamp()
    WHERE id=c.id RETURNING * INTO c;
  RETURN to_jsonb(c);
END $$;

CREATE FUNCTION public.approve_panelprofile_template_candidate(p_actor uuid,p_id uuid,p_candidate_hash text,
  p_review_hash text,p_review jsonb,p_entry jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c public.panelprofile_template_candidates; s public.panelprofile_template_sources;
  b public.panelprofile_template_bank; e public.panelprofile_template_bank_evidence; t jsonb; prefix text; BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.designpro_qc_members WHERE user_id=p_actor AND can_preflight)
    THEN RAISE EXCEPTION 'template_qc_permission_required'; END IF;
  SELECT * INTO STRICT c FROM public.panelprofile_template_candidates WHERE id=p_id FOR UPDATE;
  SELECT * INTO STRICT s FROM public.panelprofile_template_sources WHERE id=c.source_id AND owner_id=c.owner_id;
  IF c.state='approved' THEN
    SELECT * INTO STRICT e FROM public.panelprofile_template_bank_evidence WHERE candidate_id=c.id;
    IF e.review_hash IS DISTINCT FROM p_review_hash OR e.candidate_hash IS DISTINCT FROM p_candidate_hash
      OR e.review IS DISTINCT FROM p_review THEN RAISE EXCEPTION 'template_review_identity_changed'; END IF;
    SELECT * INTO STRICT b FROM public.panelprofile_template_bank WHERE id=e.bank_id;
    RETURN to_jsonb(b);
  END IF;
  t:=p_entry->'template';
  prefix:='designpro/user_'||c.owner_id::text||'/'||c.id::text||'/panelprofile-templates/';
  IF c.state<>'waiting_review' OR c.output->>'candidateHash' IS DISTINCT FROM p_candidate_hash
    OR p_entry->>'ownerId' IS DISTINCT FROM c.owner_id::text
    OR p_entry->>'cacheKey' IS DISTINCT FROM c.output->>'cacheKey'
    OR p_entry->>'sourceGeometryHash' IS DISTINCT FROM s.geometry_hash
    OR p_entry->>'reviewedBy' IS DISTINCT FROM p_actor::text
    OR p_entry->>'reviewId' IS DISTINCT FROM p_review->>'reviewId'
    OR p_entry->>'status' IS DISTINCT FROM 'validated'
    OR p_review->>'approved' IS DISTINCT FROM 'true'
    OR p_review->>'cutGeometryReviewed' IS DISTINCT FROM 'true'
    OR p_review->>'displayAlignmentReviewed' IS DISTINCT FROM 'true'
    OR p_review->>'geometryHash' IS DISTINCT FROM s.geometry_hash
    OR p_review->>'displayContentHash' IS DISTINCT FROM c.output#>>'{display,contentHash}'
    OR jsonb_typeof(p_review->'displayRegions') IS DISTINCT FROM 'array'
    OR coalesce(jsonb_array_length(p_review->'displayRegions'),0)=0
    OR coalesce(length(p_review->>'reviewId'),0) NOT BETWEEN 1 AND 160
    OR coalesce(p_review_hash,'') !~ '^[a-f0-9]{64}$'
    OR t->>'templateId' IS DISTINCT FROM s.template_id OR t->>'version' IS DISTINCT FROM s.version
    OR t->>'displayOrigin' IS DISTINCT FROM 'generated-branded'
    OR t->>'geometryValidated' IS DISTINCT FROM 'true' OR t->>'cutAreasReviewed' IS DISTINCT FROM 'true'
    OR t->>'geometryHash' IS DISTINCT FROM t#>>'{geometry,contentHash}'
    OR coalesce(t->>'profileHash','') !~ '^[a-f0-9]{64}$' OR coalesce(t->>'geometryHash','') !~ '^[a-f0-9]{64}$'
    OR t#>>'{display,contentHash}' IS DISTINCT FROM c.output#>>'{display,contentHash}'
    OR coalesce(t#>>'{display,storagePath}','') NOT LIKE prefix||'%'
    OR coalesce(t#>>'{geometry,storagePath}','') NOT LIKE prefix||'%'
    THEN RAISE EXCEPTION 'template_exact_overlay_review_required'; END IF;
  INSERT INTO public.panelprofile_template_bank(owner_id,template_id,version,profile_hash,geometry_hash,template,reviewed_by)
    VALUES(c.owner_id,s.template_id,s.version,t->>'profileHash',t->>'geometryHash',t,p_actor)
    ON CONFLICT(owner_id,template_id,version) DO NOTHING;
  SELECT * INTO STRICT b FROM public.panelprofile_template_bank
    WHERE owner_id=c.owner_id AND template_id=s.template_id AND version=s.version;
  IF b.template IS DISTINCT FROM t THEN RAISE EXCEPTION 'template_bank_version_collision'; END IF;
  INSERT INTO public.panelprofile_template_bank_evidence(candidate_id,source_id,bank_id,owner_id,cache_key,
    candidate_hash,source_geometry_hash,review_hash,review,reviewed_by)
    VALUES(c.id,s.id,b.id,c.owner_id,p_entry->>'cacheKey',p_candidate_hash,s.geometry_hash,p_review_hash,p_review,p_actor);
  UPDATE public.panelprofile_template_candidates SET state='approved',bank_id=b.id,updated_at=clock_timestamp() WHERE id=c.id;
  RETURN to_jsonb(b);
END $$;

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['panelprofile_template_sources','panelprofile_template_candidates','panelprofile_template_bank_evidence','panelprofile_template_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',name);
  END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE public.panelprofile_template_events_id_seq TO service_role;
REVOKE ALL ON FUNCTION public.panelprofile_template_event(),public.register_panelprofile_template_source(uuid,jsonb),
  public.create_panelprofile_template_candidate(uuid,uuid),public.claim_panelprofile_template_candidate(text,integer),
  public.heartbeat_panelprofile_template_candidate(uuid,uuid),public.finish_panelprofile_template_candidate(uuid,uuid,text,jsonb,jsonb),
  public.recover_panelprofile_template_candidate(uuid,uuid),public.approve_panelprofile_template_candidate(uuid,uuid,text,text,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.panelprofile_template_event(),public.register_panelprofile_template_source(uuid,jsonb),
  public.create_panelprofile_template_candidate(uuid,uuid),public.claim_panelprofile_template_candidate(text,integer),
  public.heartbeat_panelprofile_template_candidate(uuid,uuid),public.finish_panelprofile_template_candidate(uuid,uuid,text,jsonb,jsonb),
  public.recover_panelprofile_template_candidate(uuid,uuid),public.approve_panelprofile_template_candidate(uuid,uuid,text,text,jsonb,jsonb)
  TO service_role;
