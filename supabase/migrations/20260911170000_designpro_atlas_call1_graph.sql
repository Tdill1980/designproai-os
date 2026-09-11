-- CALL 1 AS A GRAPH (RULE 0.35 addendum, owner 2026-09-11: "Graph orchestration
-- in parallel wherever you can improve latency").
--
-- The hero-driver cascade was first shipped as one in-process function: a
-- Promise.all inside the generation worker, with no node rows, no cross-worker
-- claims and no per-surface retry. This migration gives each surface of the
-- cascade its OWN durable node, following the 2026-09-08 PanelProFileOutput
-- graph exactly: a run row, node rows with `depends_on`, SKIP LOCKED claims so
-- both runtime workers pull ready nodes at once, leases with heartbeats, a
-- bounded attempt counter, and an events ledger.
--
-- What it does NOT touch: the Calls 8-12 kernel (`designpro_workflow_*`) and
-- its patched PL/pgSQL, the generation request lease, the master gates, the
-- edge contract. A node executes ONLY while its generation request is still
-- leased -- the same lease the edge authorises the provider request against --
-- so an orphaned run cannot spend a single image request.
CREATE TABLE public.designpro_atlas_call1_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.designpro_generation_requests(id),
  generation_id text NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  contract text NOT NULL CHECK (contract ~ '^[a-z][a-z0-9.-]{3,120}$'),
  definition_hash text NOT NULL CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object'),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','failed','completed')),
  master_storage_path text,
  master_content_hash text CHECK (master_content_hash IS NULL OR master_content_hash ~ '^[a-f0-9]{64}$'),
  master_byte_size bigint CHECK (master_byte_size IS NULL OR master_byte_size>0),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (request_id,definition_hash),
  CHECK (state<>'completed' OR (completed_at IS NOT NULL AND master_storage_path IS NOT NULL AND master_content_hash IS NOT NULL AND master_byte_size IS NOT NULL))
);
CREATE INDEX designpro_atlas_call1_runs_request_idx ON public.designpro_atlas_call1_runs(request_id,created_at DESC);

CREATE TABLE public.designpro_atlas_call1_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.designpro_atlas_call1_runs(id),
  node_key text NOT NULL CHECK (node_key ~ '^[a-z][a-z0-9._:-]{1,120}$'),
  depends_on text[] NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','failed','completed')),
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
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (run_id,node_key),
  CHECK (state<>'running' OR (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state<>'completed' OR (completed_at IS NOT NULL AND COALESCE(output_hash,'') ~ '^[a-f0-9]{64}$'))
);
CREATE INDEX designpro_atlas_call1_nodes_ready_idx ON public.designpro_atlas_call1_nodes(created_at,run_id)
  WHERE state IN ('pending','running');

CREATE TABLE public.designpro_atlas_call1_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.designpro_atlas_call1_runs(id),
  node_key text NOT NULL,
  state text NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  lease_owner text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX designpro_atlas_call1_events_run_idx ON public.designpro_atlas_call1_events(run_id,id);

CREATE FUNCTION public.designpro_atlas_call1_reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'designpro_atlas_call1_immutable_record'; END $$;
CREATE TRIGGER designpro_atlas_call1_events_immutable BEFORE UPDATE OR DELETE ON public.designpro_atlas_call1_events
  FOR EACH ROW EXECUTE FUNCTION public.designpro_atlas_call1_reject_mutation();

-- Every state transition of every node is a row: the per-surface timeline the
-- owner asked to be able to read ("what happened to the hood") is a query.
CREATE FUNCTION public.designpro_atlas_call1_node_event() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state OR NEW.attempt IS DISTINCT FROM OLD.attempt THEN
    INSERT INTO public.designpro_atlas_call1_events(run_id,node_key,state,attempt,lease_owner,error_code)
      VALUES(NEW.run_id,NEW.node_key,NEW.state,NEW.attempt,NEW.lease_owner,NEW.error_code);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER designpro_atlas_call1_node_events AFTER INSERT OR UPDATE OF state,attempt ON public.designpro_atlas_call1_nodes
  FOR EACH ROW EXECUTE FUNCTION public.designpro_atlas_call1_node_event();

-- Idempotent by (request, definition hash): a generation re-claimed after a
-- worker death finds its existing run and its completed surfaces instead of
-- spending them again.
CREATE FUNCTION public.create_designpro_atlas_call1_run(p_request_id uuid,p_generation_id text,p_owner_id uuid,
  p_contract text,p_definition_hash text,p_definition jsonb,p_nodes jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_run public.designpro_atlas_call1_runs%ROWTYPE; v_node jsonb; v_created boolean:=false;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.designpro_generation_requests WHERE id=p_request_id AND owner_id=p_owner_id)
    THEN RAISE EXCEPTION 'designpro_atlas_call1_request_unknown'; END IF;
  IF jsonb_typeof(p_nodes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_nodes) NOT BETWEEN 1 AND 40
    THEN RAISE EXCEPTION 'designpro_atlas_call1_graph_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_nodes) n WHERE jsonb_typeof(n->'dependsOn') IS DISTINCT FROM 'array')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_nodes) n CROSS JOIN LATERAL jsonb_array_elements_text(n->'dependsOn') d
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_nodes) other WHERE other->>'key'=d))
    THEN RAISE EXCEPTION 'designpro_atlas_call1_dependency_missing'; END IF;
  -- Reject cycles independently of the runtime's graph compiler.
  IF EXISTS(WITH RECURSIVE edges AS (
      SELECT n->>'key' AS child,d AS parent FROM jsonb_array_elements(p_nodes) n
        CROSS JOIN LATERAL jsonb_array_elements_text(n->'dependsOn') d
    ), walk AS (
      SELECT child,parent,ARRAY[child] AS path,parent=child AS cycle FROM edges
      UNION ALL SELECT w.child,e.parent,w.path||w.parent,e.parent=ANY(w.path||w.parent)
        FROM walk w JOIN edges e ON e.child=w.parent WHERE NOT w.cycle
    ) SELECT 1 FROM walk WHERE cycle)
    THEN RAISE EXCEPTION 'designpro_atlas_call1_dependency_cycle'; END IF;
  INSERT INTO public.designpro_atlas_call1_runs(request_id,generation_id,owner_id,contract,definition_hash,definition)
    VALUES(p_request_id,p_generation_id,p_owner_id,p_contract,p_definition_hash,p_definition)
    ON CONFLICT(request_id,definition_hash) DO NOTHING RETURNING * INTO v_run;
  v_created:=FOUND;
  IF NOT v_created THEN
    SELECT * INTO STRICT v_run FROM public.designpro_atlas_call1_runs WHERE request_id=p_request_id AND definition_hash=p_definition_hash;
  ELSE
    FOR v_node IN SELECT * FROM jsonb_array_elements(p_nodes) LOOP
      INSERT INTO public.designpro_atlas_call1_nodes(run_id,node_key,depends_on,input,max_attempts)
        VALUES(v_run.id,v_node->>'key',ARRAY(SELECT jsonb_array_elements_text(v_node->'dependsOn')),
          COALESCE(v_node->'input','{}'::jsonb),LEAST(5,GREATEST(1,COALESCE((v_node->>'maxAttempts')::integer,3))));
    END LOOP;
  END IF;
  RETURN jsonb_build_object('run',to_jsonb(v_run),'created',v_created,
    'nodes',(SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY n.created_at,n.node_key),'[]'::jsonb) FROM public.designpro_atlas_call1_nodes n WHERE n.run_id=v_run.id));
END $$;

-- THE CLAIM. Any worker, any ready node, SKIP LOCKED: hood, front and rear
-- become claimable in the same instant passenger completes, so three workers
-- (or three slots on one) draw them at once. A node is ready only when every
-- parent is completed AND the run's generation request is still leased: the
-- edge authorises each image request against that lease, so a node of an
-- orphaned run is never even handed out. The claim also carries the current
-- lease token so the executor never reads the request row itself.
CREATE FUNCTION public.claim_designpro_atlas_call1_node(p_worker text,p_lease_seconds integer DEFAULT 600)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_node public.designpro_atlas_call1_nodes%ROWTYPE; v_run public.designpro_atlas_call1_runs%ROWTYPE; v_claim uuid;
BEGIN
  IF length(COALESCE(p_worker,'')) NOT BETWEEN 1 AND 200 OR p_lease_seconds NOT BETWEEN 30 AND 900
    THEN RAISE EXCEPTION 'designpro_atlas_call1_claim_invalid'; END IF;
  -- Expired final attempts are explicit failures, never indefinitely running.
  -- lease_owner is kept on every terminal row: it is the history of who
  -- held the node, and the ledger trigger records it per transition.
  UPDATE public.designpro_atlas_call1_nodes SET state='failed',error_code='attempts_exhausted',
      lease_token=NULL,lease_expires_at=NULL,updated_at=now()
    WHERE state='running' AND lease_expires_at<now() AND attempt>=max_attempts;
  UPDATE public.designpro_atlas_call1_runs r SET state='failed',error_code=COALESCE(r.error_code,'attempts_exhausted'),updated_at=now()
    WHERE state IN ('queued','running') AND EXISTS(SELECT 1 FROM public.designpro_atlas_call1_nodes n WHERE n.run_id=r.id AND n.state='failed');
  SELECT n.* INTO v_node FROM public.designpro_atlas_call1_nodes n
    JOIN public.designpro_atlas_call1_runs r ON r.id=n.run_id
    JOIN public.designpro_generation_requests g ON g.id=r.request_id
    WHERE r.state IN ('queued','running')
      AND g.state='leased' AND g.lease_token IS NOT NULL AND g.lease_expires_at>now()
      AND (n.state='pending' OR (n.state='running' AND n.lease_expires_at<now()))
      AND n.attempt<n.max_attempts AND n.available_at<=now()
      AND NOT EXISTS(SELECT 1 FROM unnest(n.depends_on) d WHERE NOT EXISTS(
        SELECT 1 FROM public.designpro_atlas_call1_nodes parent WHERE parent.run_id=n.run_id AND parent.node_key=d AND parent.state='completed'))
    ORDER BY r.created_at,n.created_at,n.node_key FOR UPDATE OF n SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.designpro_atlas_call1_nodes SET state='running',attempt=attempt+1,lease_owner=p_worker,lease_token=gen_random_uuid(),
    lease_expires_at=now()+make_interval(secs=>p_lease_seconds),started_at=COALESCE(started_at,now()),error_code=NULL,updated_at=now()
    WHERE id=v_node.id RETURNING * INTO v_node;
  UPDATE public.designpro_atlas_call1_runs SET state='running',updated_at=now() WHERE id=v_node.run_id RETURNING * INTO v_run;
  SELECT lease_token INTO v_claim FROM public.designpro_generation_requests WHERE id=v_run.request_id;
  RETURN jsonb_build_object('node',to_jsonb(v_node),'run',to_jsonb(v_run),'claimToken',v_claim,
    'dependencies',(SELECT COALESCE(jsonb_agg(jsonb_build_object('nodeKey',p.node_key,'state',p.state,'output',p.output) ORDER BY p.node_key),'[]'::jsonb)
      FROM public.designpro_atlas_call1_nodes p WHERE p.run_id=v_run.id AND p.node_key=ANY(v_node.depends_on)));
END $$;

CREATE FUNCTION public.heartbeat_designpro_atlas_call1_node(p_node_id uuid,p_token uuid,p_lease_seconds integer DEFAULT 600)
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_found boolean;
BEGIN
  IF p_lease_seconds NOT BETWEEN 30 AND 900 THEN RAISE EXCEPTION 'designpro_atlas_call1_heartbeat_invalid'; END IF;
  UPDATE public.designpro_atlas_call1_nodes SET lease_expires_at=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
    WHERE id=p_node_id AND lease_token=p_token AND state='running' AND lease_expires_at>now();
  v_found:=FOUND;
  RETURN v_found;
END $$;

-- completed / failed / pending (= retry after a backoff, until the attempts
-- run out). The run rolls up: any failed node fails the run; all completed
-- completes it and the master.assemble output names the master.
CREATE FUNCTION public.finish_designpro_atlas_call1_node(p_node_id uuid,p_token uuid,p_state text,p_output jsonb,p_output_hash text)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_node public.designpro_atlas_call1_nodes%ROWTYPE; v_run public.designpro_atlas_call1_runs%ROWTYPE; v_state text; v_error text;
BEGIN
  SELECT * INTO v_node FROM public.designpro_atlas_call1_nodes WHERE id=p_node_id FOR UPDATE;
  IF NOT FOUND OR v_node.state<>'running' OR v_node.lease_token IS DISTINCT FROM p_token OR v_node.lease_expires_at<=now()
    THEN RAISE EXCEPTION 'designpro_atlas_call1_lease_lost'; END IF;
  IF p_state NOT IN ('completed','failed','pending') OR COALESCE(p_output_hash,'') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_output) IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'designpro_atlas_call1_result_invalid'; END IF;
  SELECT * INTO STRICT v_run FROM public.designpro_atlas_call1_runs WHERE id=v_node.run_id FOR UPDATE;
  v_state:=CASE WHEN p_state='pending' AND v_node.attempt>=v_node.max_attempts THEN 'failed' ELSE p_state END;
  -- A retryable failure that ran out of attempts is recorded as exhaustion,
  -- so resume can tell it from a creative refusal whatever the last error was.
  v_error:=CASE WHEN v_state='completed' THEN NULL
    WHEN v_state='failed' AND p_state='pending' THEN 'attempts_exhausted'
    ELSE COALESCE(p_output->>'errorCode','designpro_atlas_call1_node_failed') END;
  UPDATE public.designpro_atlas_call1_nodes SET state=v_state,output=p_output,output_hash=p_output_hash,
    available_at=CASE WHEN v_state='pending' THEN now()+make_interval(secs=>LEAST(60,attempt*10)) ELSE available_at END,
    error_code=v_error,
    completed_at=CASE WHEN v_state='completed' THEN now() ELSE NULL END,
    lease_expires_at=NULL,lease_token=NULL,updated_at=now() WHERE id=v_node.id;
  UPDATE public.designpro_atlas_call1_runs r SET
    state=CASE
      WHEN EXISTS(SELECT 1 FROM public.designpro_atlas_call1_nodes n WHERE n.run_id=r.id AND n.state='failed') THEN 'failed'
      WHEN NOT EXISTS(SELECT 1 FROM public.designpro_atlas_call1_nodes n WHERE n.run_id=r.id AND n.state<>'completed') THEN 'completed'
      ELSE 'running' END,
    error_code=CASE WHEN v_state='failed' THEN v_error ELSE r.error_code END,
    master_storage_path=CASE WHEN v_node.node_key='master.assemble' AND v_state='completed' THEN p_output#>>'{master,storagePath}' ELSE r.master_storage_path END,
    master_content_hash=CASE WHEN v_node.node_key='master.assemble' AND v_state='completed' THEN p_output#>>'{master,contentHash}' ELSE r.master_content_hash END,
    master_byte_size=CASE WHEN v_node.node_key='master.assemble' AND v_state='completed' THEN (p_output#>>'{master,byteSize}')::bigint ELSE r.master_byte_size END,
    completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM public.designpro_atlas_call1_nodes n WHERE n.run_id=r.id AND n.state<>'completed') THEN now() ELSE r.completed_at END,
    updated_at=now()
    WHERE r.id=v_run.id RETURNING * INTO v_run;
  RETURN to_jsonb(v_run);
END $$;

-- A run that failed only on RETRYABLE nodes (a lost lease, transport) is put
-- back to work by the generation that re-enters it. A creative refusal
-- (`retryable:false` -- the surface was drawn wrong twice) is final: that run
-- stays failed and the caller fails over to the six-surface contract exactly
-- as the in-process cascade did.
CREATE FUNCTION public.resume_designpro_atlas_call1_run(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r public.designpro_atlas_call1_runs%ROWTYPE; changed integer;
BEGIN
  SELECT * INTO STRICT r FROM public.designpro_atlas_call1_runs WHERE id=p_run_id FOR UPDATE;
  IF r.state<>'failed' THEN RETURN to_jsonb(r); END IF;
  IF EXISTS(SELECT 1 FROM public.designpro_atlas_call1_nodes WHERE run_id=r.id AND state='failed'
    AND NOT (output @> '{"retryable":true}'::jsonb OR error_code='attempts_exhausted'))
    THEN RETURN to_jsonb(r); END IF;
  UPDATE public.designpro_atlas_call1_nodes SET state='pending',attempt=0,available_at=now(),
    lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,error_code=NULL,updated_at=now()
    WHERE run_id=r.id AND state='failed';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN RETURN to_jsonb(r); END IF;
  UPDATE public.designpro_atlas_call1_runs SET state='running',error_code=NULL,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  RETURN to_jsonb(r);
END $$;

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['designpro_atlas_call1_runs','designpro_atlas_call1_nodes','designpro_atlas_call1_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',name);
  END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE public.designpro_atlas_call1_events_id_seq TO service_role;
REVOKE ALL ON FUNCTION public.designpro_atlas_call1_reject_mutation(),public.designpro_atlas_call1_node_event(),
  public.create_designpro_atlas_call1_run(uuid,text,uuid,text,text,jsonb,jsonb),
  public.claim_designpro_atlas_call1_node(text,integer),
  public.heartbeat_designpro_atlas_call1_node(uuid,uuid,integer),
  public.finish_designpro_atlas_call1_node(uuid,uuid,text,jsonb,text),
  public.resume_designpro_atlas_call1_run(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.designpro_atlas_call1_reject_mutation(),public.designpro_atlas_call1_node_event(),
  public.create_designpro_atlas_call1_run(uuid,text,uuid,text,text,jsonb,jsonb),
  public.claim_designpro_atlas_call1_node(text,integer),
  public.heartbeat_designpro_atlas_call1_node(uuid,uuid,integer),
  public.finish_designpro_atlas_call1_node(uuid,uuid,text,jsonb,text),
  public.resume_designpro_atlas_call1_run(uuid) TO service_role;
