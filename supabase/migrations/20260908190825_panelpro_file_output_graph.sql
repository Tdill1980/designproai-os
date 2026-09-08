-- PanelProFileOutput is a separate application graph. It carries the source
-- application's identifiers and never changes the six-surface ATLAS contract.
-- All writes and private geometry reads are through the authenticated runtime.
CREATE TABLE public.panelprofile_source_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  source_app text NOT NULL CHECK (source_app IN ('DesignPro','RecreatePro','GraphicsPro','WallPro')),
  source_job_id text NOT NULL CHECK (length(source_job_id) BETWEEN 1 AND 160),
  generation_id text,
  design_id text,
  order_id text,
  revision_id text NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  handoff jsonb NOT NULL CHECK (jsonb_typeof(handoff)='object'),
  registered_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id,source_app,source_job_id,revision_id,input_hash)
);
CREATE INDEX panelprofile_sources_identity_idx ON public.panelprofile_source_handoffs
  (owner_id,source_app,source_job_id,created_at DESC);

CREATE TABLE public.panelprofile_template_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  template_id text NOT NULL,
  version text NOT NULL,
  profile_hash text NOT NULL CHECK (profile_hash ~ '^[a-f0-9]{64}$'),
  geometry_hash text NOT NULL CHECK (geometry_hash ~ '^[a-f0-9]{64}$'),
  template jsonb NOT NULL,
  reviewed_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id,template_id,version),
  CHECK (template->>'displayOrigin'='generated-branded'
    AND template @> '{"geometryValidated":true,"cutAreasReviewed":true}'::jsonb)
);

CREATE TABLE public.panelprofile_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.panelprofile_source_handoffs(id),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  definition_version text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','waiting','failed','completed','cancelled')),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  artifact_set_hash text CHECK (artifact_set_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id,definition_version)
);
CREATE INDEX panelprofile_runs_owner_idx ON public.panelprofile_runs(owner_id,created_at DESC);

CREATE TABLE public.panelprofile_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.panelprofile_runs(id),
  node_key text NOT NULL CHECK (node_key ~ '^[a-zA-Z0-9._:-]{1,200}$'),
  depends_on text[] NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','waiting','failed','completed','cancelled')),
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_hash text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (run_id,node_key),
  CHECK (state<>'running' OR (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state<>'completed' OR (completed_at IS NOT NULL AND COALESCE(output_hash,'') ~ '^[a-f0-9]{64}$'))
);
CREATE INDEX panelprofile_nodes_ready_idx ON public.panelprofile_nodes(created_at,run_id)
  WHERE state IN ('pending','running');

CREATE TABLE public.panelprofile_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.panelprofile_runs(id),
  node_id uuid NOT NULL REFERENCES public.panelprofile_nodes(id),
  role text NOT NULL,
  piece_id text NOT NULL DEFAULT '',
  storage_path text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size>0),
  mime_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id,storage_path)
);
CREATE INDEX panelprofile_artifacts_node_idx ON public.panelprofile_artifacts(node_id);

CREATE TABLE public.panelprofile_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.panelprofile_runs(id),
  node_key text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX panelprofile_events_run_idx ON public.panelprofile_events(run_id,id);

-- Versioned source/template entries and all resulting artifacts are immutable.
CREATE FUNCTION public.panelprofile_reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'panelprofile_immutable_record'; END $$;
CREATE TRIGGER panelprofile_sources_immutable BEFORE UPDATE OR DELETE ON public.panelprofile_source_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.panelprofile_reject_mutation();
CREATE TRIGGER panelprofile_templates_immutable BEFORE UPDATE OR DELETE ON public.panelprofile_template_bank
  FOR EACH ROW EXECUTE FUNCTION public.panelprofile_reject_mutation();
CREATE TRIGGER panelprofile_artifacts_immutable BEFORE UPDATE OR DELETE ON public.panelprofile_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.panelprofile_reject_mutation();
CREATE TRIGGER panelprofile_events_immutable BEFORE UPDATE OR DELETE ON public.panelprofile_events
  FOR EACH ROW EXECUTE FUNCTION public.panelprofile_reject_mutation();

CREATE FUNCTION public.panelprofile_node_event() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO public.panelprofile_events(run_id,node_key,state) VALUES(NEW.run_id,NEW.node_key,NEW.state);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER panelprofile_node_events AFTER INSERT OR UPDATE OF state ON public.panelprofile_nodes
  FOR EACH ROW EXECUTE FUNCTION public.panelprofile_node_event();

CREATE FUNCTION public.create_panelprofile_run(p_owner_id uuid,p_source_id uuid,p_definition text,p_nodes jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_source public.panelprofile_source_handoffs%ROWTYPE; v_run public.panelprofile_runs%ROWTYPE; v_node jsonb;
BEGIN
  SELECT * INTO STRICT v_source FROM public.panelprofile_source_handoffs WHERE id=p_source_id AND owner_id=p_owner_id;
  IF jsonb_typeof(p_nodes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_nodes) NOT BETWEEN 1 AND 140
    THEN RAISE EXCEPTION 'panelprofile_graph_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_nodes) n WHERE jsonb_typeof(n->'dependsOn') IS DISTINCT FROM 'array')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_nodes) n CROSS JOIN LATERAL jsonb_array_elements_text(n->'dependsOn') d
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_nodes) other WHERE other->>'key'=d))
    THEN RAISE EXCEPTION 'panelprofile_dependency_missing'; END IF;
  -- Reject cycles independently of the runtime's graph compiler.
  IF EXISTS(WITH RECURSIVE edges AS (
      SELECT n->>'key' AS child,d AS parent FROM jsonb_array_elements(p_nodes) n
        CROSS JOIN LATERAL jsonb_array_elements_text(n->'dependsOn') d
    ), walk AS (
      SELECT child,parent,ARRAY[child] AS path,parent=child AS cycle FROM edges
      UNION ALL SELECT w.child,e.parent,w.path||w.parent,e.parent=ANY(w.path||w.parent)
        FROM walk w JOIN edges e ON e.child=w.parent WHERE NOT w.cycle
    ) SELECT 1 FROM walk WHERE cycle)
    THEN RAISE EXCEPTION 'panelprofile_dependency_cycle'; END IF;
  INSERT INTO public.panelprofile_runs(source_id,owner_id,definition_version,input_hash)
    VALUES(v_source.id,p_owner_id,p_definition,v_source.input_hash)
    ON CONFLICT(source_id,definition_version) DO NOTHING RETURNING * INTO v_run;
  IF NOT FOUND THEN
    SELECT * INTO STRICT v_run FROM public.panelprofile_runs WHERE source_id=p_source_id AND definition_version=p_definition;
    RETURN to_jsonb(v_run);
  END IF;
  FOR v_node IN SELECT * FROM jsonb_array_elements(p_nodes) LOOP
    INSERT INTO public.panelprofile_nodes(run_id,node_key,depends_on,input)
      VALUES(v_run.id,v_node->>'key',ARRAY(SELECT jsonb_array_elements_text(v_node->'dependsOn')),COALESCE(v_node->'input','{}'::jsonb));
  END LOOP;
  RETURN to_jsonb(v_run);
END $$;

CREATE FUNCTION public.claim_panelprofile_node(p_worker text,p_lease_seconds integer DEFAULT 180)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_node public.panelprofile_nodes%ROWTYPE; v_run public.panelprofile_runs%ROWTYPE;
BEGIN
  IF length(p_worker) NOT BETWEEN 1 AND 200 OR p_lease_seconds NOT BETWEEN 30 AND 300
    THEN RAISE EXCEPTION 'panelprofile_claim_invalid'; END IF;
  -- Expired final attempts are explicit failures, never indefinitely running.
  UPDATE public.panelprofile_nodes SET state='failed',error_code='attempts_exhausted',updated_at=now()
    WHERE state='running' AND lease_expires_at<now() AND attempt>=max_attempts;
  UPDATE public.panelprofile_runs r SET state='failed',updated_at=now()
    WHERE state IN ('queued','running') AND EXISTS(SELECT 1 FROM public.panelprofile_nodes n WHERE n.run_id=r.id AND n.state='failed');
  SELECT n.* INTO v_node FROM public.panelprofile_nodes n JOIN public.panelprofile_runs r ON r.id=n.run_id
    WHERE r.state IN ('queued','running') AND (n.state='pending' OR (n.state='running' AND n.lease_expires_at<now()))
      AND n.attempt<n.max_attempts AND n.available_at<=now()
      AND NOT EXISTS(SELECT 1 FROM unnest(n.depends_on) d WHERE NOT EXISTS(
        SELECT 1 FROM public.panelprofile_nodes parent WHERE parent.run_id=n.run_id AND parent.node_key=d AND parent.state='completed'))
    ORDER BY n.created_at,n.node_key FOR UPDATE OF n SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.panelprofile_nodes SET state='running',attempt=attempt+1,lease_owner=p_worker,lease_token=gen_random_uuid(),
    lease_expires_at=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
    WHERE id=v_node.id RETURNING * INTO v_node;
  UPDATE public.panelprofile_runs SET state='running',updated_at=now() WHERE id=v_node.run_id RETURNING * INTO v_run;
  RETURN jsonb_build_object('node',to_jsonb(v_node),'run',to_jsonb(v_run),'source',
    (SELECT to_jsonb(s) FROM public.panelprofile_source_handoffs s WHERE s.id=v_run.source_id));
END $$;

CREATE FUNCTION public.heartbeat_panelprofile_node(p_node_id uuid,p_token uuid)
RETURNS boolean LANGUAGE sql SET search_path='' AS $$
  WITH changed AS (UPDATE public.panelprofile_nodes SET lease_expires_at=now()+interval '180 seconds',updated_at=now()
    WHERE id=p_node_id AND lease_token=p_token AND state='running' AND lease_expires_at>now() RETURNING id)
  SELECT EXISTS(SELECT 1 FROM changed);
$$;

CREATE FUNCTION public.defer_panelprofile_node(p_node_id uuid,p_token uuid)
RETURNS boolean LANGUAGE sql SET search_path='' AS $$
  WITH changed AS (UPDATE public.panelprofile_nodes SET state='pending',attempt=GREATEST(0,attempt-1),
    lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,available_at=now()+interval '5 seconds',updated_at=now()
    WHERE id=p_node_id AND lease_token=p_token AND state='running' AND lease_expires_at>now() RETURNING id)
  SELECT EXISTS(SELECT 1 FROM changed);
$$;

CREATE FUNCTION public.finish_panelprofile_node(p_node_id uuid,p_token uuid,p_state text,p_output jsonb,p_output_hash text,p_artifacts jsonb DEFAULT '[]')
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_node public.panelprofile_nodes%ROWTYPE; v_run public.panelprofile_runs%ROWTYPE; a jsonb;
BEGIN
  SELECT * INTO v_node FROM public.panelprofile_nodes WHERE id=p_node_id FOR UPDATE;
  IF NOT FOUND OR v_node.state<>'running' OR v_node.lease_token IS DISTINCT FROM p_token OR v_node.lease_expires_at<=now()
    THEN RAISE EXCEPTION 'panelprofile_lease_lost'; END IF;
  IF p_state NOT IN ('completed','waiting','failed','pending') OR COALESCE(p_output_hash,'') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_output) IS DISTINCT FROM 'object' OR jsonb_typeof(p_artifacts) IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'panelprofile_result_invalid'; END IF;
  SELECT * INTO STRICT v_run FROM public.panelprofile_runs WHERE id=v_node.run_id FOR UPDATE;
  FOR a IN SELECT * FROM jsonb_array_elements(p_artifacts) LOOP
    IF left(COALESCE(a->>'storagePath',''),length('designpro/user_'||v_run.owner_id::text||'/'||v_run.id::text||'/panelprofile/'))
        IS DISTINCT FROM 'designpro/user_'||v_run.owner_id::text||'/'||v_run.id::text||'/panelprofile/'
      OR a->>'storagePath' ~ '(^|/)\.\.(/|$)' THEN RAISE EXCEPTION 'panelprofile_artifact_scope_invalid'; END IF;
    INSERT INTO public.panelprofile_artifacts(run_id,node_id,role,piece_id,storage_path,content_hash,byte_size,mime_type,metadata)
      VALUES(v_run.id,v_node.id,a->>'role',COALESCE(a->>'pieceId',''),a->>'storagePath',a->>'contentHash',
        (a->>'byteSize')::bigint,a->>'mimeType',COALESCE(a->'metadata','{}'::jsonb));
  END LOOP;
  UPDATE public.panelprofile_nodes SET state=CASE WHEN p_state='pending' AND attempt>=max_attempts THEN 'failed' ELSE p_state END,output=p_output,output_hash=p_output_hash,
    available_at=CASE WHEN p_state='pending' THEN now()+make_interval(secs=>LEAST(60,attempt*10)) ELSE available_at END,
    error_code=p_output->>'errorCode',completed_at=CASE WHEN p_state='completed' THEN now() ELSE NULL END,
    lease_expires_at=NULL,lease_owner=NULL,lease_token=NULL,updated_at=now() WHERE id=v_node.id;
  UPDATE public.panelprofile_runs r SET state=CASE
    WHEN EXISTS(SELECT 1 FROM public.panelprofile_nodes n WHERE n.run_id=r.id AND n.state='failed') THEN 'failed'
    WHEN EXISTS(SELECT 1 FROM public.panelprofile_nodes n WHERE n.run_id=r.id AND n.state='waiting') THEN 'waiting'
    WHEN NOT EXISTS(SELECT 1 FROM public.panelprofile_nodes n WHERE n.run_id=r.id AND n.state<>'completed') THEN 'completed'
    ELSE 'running' END,updated_at=now(),
    artifact_set_hash=CASE WHEN v_node.node_key='panelprofileoutput.verify' AND p_state='completed'
      THEN p_output->>'artifactSetHash' ELSE r.artifact_set_hash END
    WHERE r.id=v_run.id RETURNING * INTO v_run;
  RETURN to_jsonb(v_run);
END $$;

-- The new app uses the same internal QC membership, but binds approval to its
-- own physical-piece output hashes. Existing six-surface QC is not fabricated.
CREATE FUNCTION public.resume_panelprofile_run(p_run_id uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r public.panelprofile_runs%ROWTYPE; changed integer;
BEGIN
  SELECT * INTO STRICT r FROM public.panelprofile_runs WHERE id=p_run_id FOR UPDATE;
  IF r.owner_id IS DISTINCT FROM p_actor AND NOT EXISTS(
    SELECT 1 FROM public.designpro_qc_members WHERE user_id=p_actor AND can_preflight
  ) THEN RAISE EXCEPTION 'panelprofile_run_permission_required'; END IF;
  IF r.state<>'failed' THEN RAISE EXCEPTION 'panelprofile_resume_state_invalid'; END IF;
  -- This graph only replays deterministic work. Completed artifacts and QC
  -- receipts stay immutable; validation failures need a corrected new input.
  IF EXISTS(SELECT 1 FROM public.panelprofile_nodes WHERE run_id=r.id AND state='failed'
    AND NOT (output @> '{"retryable":true}'::jsonb OR error_code='attempts_exhausted'))
    THEN RAISE EXCEPTION 'panelprofile_input_correction_required'; END IF;
  UPDATE public.panelprofile_nodes SET state='pending',attempt=0,available_at=now(),
    lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,error_code=NULL,updated_at=now()
    WHERE run_id=r.id AND state='failed';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN RAISE EXCEPTION 'panelprofile_retryable_node_required'; END IF;
  UPDATE public.panelprofile_runs SET state='running',updated_at=now() WHERE id=r.id RETURNING * INTO r;
  RETURN to_jsonb(r);
END $$;

CREATE FUNCTION public.approve_panelprofile_output(p_run_id uuid,p_actor uuid,p_artifact_set_hash text,p_checks jsonb,p_approval_ref text)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r public.panelprofile_runs%ROWTYPE; n public.panelprofile_nodes%ROWTYPE; evidence jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.designpro_qc_members WHERE user_id=p_actor AND can_preflight)
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND email_confirmed_at IS NOT NULL)
    THEN RAISE EXCEPTION 'panelprofile_qc_permission_required'; END IF;
  SELECT * INTO STRICT r FROM public.panelprofile_runs WHERE id=p_run_id FOR UPDATE;
  IF COALESCE(p_artifact_set_hash,'') !~ '^[a-f0-9]{64}$'
    OR r.artifact_set_hash IS DISTINCT FROM p_artifact_set_hash OR length(COALESCE(btrim(p_approval_ref),'')) NOT BETWEEN 3 AND 160
    OR NOT COALESCE(p_checks,'{}') @> '{"template":true,"fit":true,"essentialArtworkSafe":true,"backgroundContinuous":true,"fiveInchBleed":true,"resolution":true,"physicalPieces":true,"filesInspected":true}'::jsonb
    THEN RAISE EXCEPTION 'panelprofile_qc_evidence_required'; END IF;
  SELECT * INTO STRICT n FROM public.panelprofile_nodes WHERE run_id=r.id AND node_key='await_panelpro_preflight_qc' FOR UPDATE;
  IF n.state='completed' AND n.output->>'approvalRef'=p_approval_ref THEN RETURN to_jsonb(r); END IF;
  IF n.state<>'waiting' OR r.state<>'waiting' THEN RAISE EXCEPTION 'panelprofile_not_awaiting_qc'; END IF;
  evidence:=jsonb_build_object('actorId',p_actor,'approvalRef',p_approval_ref,'approvedAt',clock_timestamp(),
    'artifactSetHash',p_artifact_set_hash,'checks',p_checks,'qcApproved',true);
  UPDATE public.panelprofile_nodes SET state='completed',output=evidence,
    output_hash=encode(extensions.digest(convert_to(evidence::text,'UTF8'),'sha256'),'hex'),completed_at=now(),updated_at=now()
    WHERE id=n.id;
  UPDATE public.panelprofile_runs SET state='running',updated_at=now() WHERE id=r.id RETURNING * INTO r;
  RETURN to_jsonb(r);
END $$;

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['panelprofile_source_handoffs','panelprofile_template_bank','panelprofile_runs','panelprofile_nodes','panelprofile_artifacts','panelprofile_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',name);
  END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE public.panelprofile_events_id_seq TO service_role;
REVOKE ALL ON FUNCTION public.panelprofile_reject_mutation(),public.panelprofile_node_event(),
  public.create_panelprofile_run(uuid,uuid,text,jsonb),public.claim_panelprofile_node(text,integer),
  public.heartbeat_panelprofile_node(uuid,uuid),public.finish_panelprofile_node(uuid,uuid,text,jsonb,text,jsonb),
  public.defer_panelprofile_node(uuid,uuid),
  public.resume_panelprofile_run(uuid,uuid),
  public.approve_panelprofile_output(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.panelprofile_reject_mutation(),public.panelprofile_node_event(),
  public.create_panelprofile_run(uuid,uuid,text,jsonb),public.claim_panelprofile_node(text,integer),
  public.heartbeat_panelprofile_node(uuid,uuid),public.finish_panelprofile_node(uuid,uuid,text,jsonb,text,jsonb),
  public.defer_panelprofile_node(uuid,uuid),
  public.resume_panelprofile_run(uuid,uuid),
  public.approve_panelprofile_output(uuid,uuid,text,jsonb,text) TO service_role;

-- Share the fleet's existing 6GB production-memory budget. A new graph must
-- not run another full-size raster beside the existing exclusive export slot.
ALTER TABLE designpro_private.heavy_stage_leases
  ADD COLUMN panelprofile_node_id uuid REFERENCES public.panelprofile_nodes(id);
ALTER TABLE designpro_private.heavy_stage_leases DROP CONSTRAINT designpro_heavy_stage_lease_integrity;
ALTER TABLE designpro_private.heavy_stage_leases ADD CONSTRAINT designpro_heavy_stage_lease_integrity CHECK (
  (stage_id IS NULL AND panelprofile_node_id IS NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  OR ((stage_id IS NOT NULL)::integer+(panelprofile_node_id IS NOT NULL)::integer=1
    AND NULLIF(btrim(lease_owner),'') IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
);

-- Preserve the complete installed legacy claim definitions, including their
-- frozen artifact gates. Only their slot clear/occupied predicates are extended.
DO $patch$ DECLARE definition text; patched text; signature text; BEGIN
  FOREACH signature IN ARRAY ARRAY['public.claim_designpro_stage(text,integer)','public.acquire_designpro_heavy_lease(uuid,uuid,text,integer)'] LOOP
    definition:=pg_get_functiondef(to_regprocedure(signature));
    IF definition IS NULL OR strpos(definition,'designpro_private.heavy_stage_leases')=0
      OR strpos(definition,'panelprofile_node_id')>0 THEN RAISE EXCEPTION 'panelprofile_heavy_contract_unexpected: %',signature; END IF;
    patched:=replace(replace(definition,'SET stage_id=NULL','SET panelprofile_node_id=NULL,stage_id=NULL'),
      'SET stage_id = NULL','SET panelprofile_node_id = NULL, stage_id = NULL');
    IF signature LIKE '%acquire_designpro%' THEN
      IF strpos(patched,'  IF v_slot.stage_id IS NOT NULL')=0 THEN RAISE EXCEPTION 'panelprofile_heavy_acquire_anchor_missing'; END IF;
      patched:=replace(patched,'  IF v_slot.stage_id IS NOT NULL',
        E'  IF v_slot.panelprofile_node_id IS NOT NULL AND v_slot.lease_expires_at>clock_timestamp() THEN RETURN false; END IF;\n  IF v_slot.stage_id IS NOT NULL');
    END IF;
    IF patched=definition THEN RAISE EXCEPTION 'panelprofile_heavy_patch_missing'; END IF;
    EXECUTE patched;
  END LOOP;
END $patch$;

CREATE FUNCTION public.acquire_panelprofile_heavy_lease(p_node_id uuid,p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.panelprofile_nodes%ROWTYPE; slot designpro_private.heavy_stage_leases%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('designpro.heavy-stage:production-heavy',0));
  SELECT * INTO n FROM public.panelprofile_nodes WHERE id=p_node_id AND lease_token=p_token
    AND state='running' AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO STRICT slot FROM designpro_private.heavy_stage_leases WHERE lease_key='production-heavy' FOR UPDATE;
  IF slot.lease_expires_at>clock_timestamp() AND (slot.stage_id IS NOT NULL
    OR slot.panelprofile_node_id IS DISTINCT FROM p_node_id OR slot.lease_token IS DISTINCT FROM p_token) THEN RETURN false; END IF;
  UPDATE designpro_private.heavy_stage_leases SET stage_id=NULL,panelprofile_node_id=n.id,
    lease_owner=n.lease_owner,lease_token=n.lease_token,lease_expires_at=n.lease_expires_at,updated_at=clock_timestamp()
    WHERE lease_key='production-heavy';
  RETURN true;
END $$;
CREATE FUNCTION public.panelprofile_sync_heavy_lease() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.state='running' THEN
    UPDATE designpro_private.heavy_stage_leases SET lease_expires_at=NEW.lease_expires_at,updated_at=clock_timestamp()
      WHERE panelprofile_node_id=NEW.id AND lease_token=NEW.lease_token;
  ELSIF OLD.state='running' THEN
    UPDATE designpro_private.heavy_stage_leases SET panelprofile_node_id=NULL,stage_id=NULL,
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
      WHERE panelprofile_node_id=OLD.id AND lease_token=OLD.lease_token;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER panelprofile_heavy_lease AFTER UPDATE OF state,lease_expires_at ON public.panelprofile_nodes
  FOR EACH ROW EXECUTE FUNCTION public.panelprofile_sync_heavy_lease();
REVOKE ALL ON FUNCTION public.acquire_panelprofile_heavy_lease(uuid,uuid),public.panelprofile_sync_heavy_lease()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_panelprofile_heavy_lease(uuid,uuid),public.panelprofile_sync_heavy_lease() TO service_role;
