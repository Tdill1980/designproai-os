-- DESIGNPROAI GENERATION OS KERNEL
--
-- The Generation ID is the job root. Every A.T.L.A.S. revision and every
-- production workflow transition is recorded against that immutable root so
-- RevisionStudioIQ, PanelProStudio, QC and WrapBox can all ask the server the
-- same question: what happened to THIS generation, in what order, and which
-- version is current?
--
-- This migration is additive. It does not alter the A.T.L.A.S. producer, proof
-- producer, panel extraction, QC, Topaz, output, entitlement or WrapBox graph.

CREATE TABLE IF NOT EXISTS public.designpro_generation_os_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generation_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z0-9_.-]+$'),
  revision_id uuid,
  run_id uuid,
  stage_key text,
  state text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE INDEX IF NOT EXISTS designpro_generation_os_events_generation_idx
  ON public.designpro_generation_os_events(generation_id,id);
CREATE INDEX IF NOT EXISTS designpro_generation_os_events_run_idx
  ON public.designpro_generation_os_events(run_id,id)
  WHERE run_id IS NOT NULL;

COMMENT ON TABLE public.designpro_generation_os_events IS
  'Append-only Generation-ID event ledger for the DesignProAI design-to-print operating system. Records A.T.L.A.S. revision creation and server workflow/run transitions without becoming a second workflow authority.';

ALTER TABLE public.designpro_generation_os_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.designpro_generation_os_events FROM anon, authenticated;
GRANT SELECT ON TABLE public.designpro_generation_os_events TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.designpro_generation_os_events_id_seq TO service_role;

-- Append-only even for privileged SQL paths. Event history is evidence, never
-- mutable application state.
CREATE OR REPLACE FUNCTION designpro_private.refuse_designpro_os_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, designpro_private
AS $fn$
BEGIN
  RAISE EXCEPTION 'designpro_os_event_history_is_append_only';
END;
$fn$;

DROP TRIGGER IF EXISTS designpro_generation_os_events_no_update ON public.designpro_generation_os_events;
CREATE TRIGGER designpro_generation_os_events_no_update
BEFORE UPDATE OR DELETE ON public.designpro_generation_os_events
FOR EACH ROW EXECUTE FUNCTION designpro_private.refuse_designpro_os_event_mutation();

-- Customers may read only their own generation ledger. Design staff keep the
-- same shop-wide visibility used by the existing generation library.
DROP POLICY IF EXISTS designpro_generation_os_events_select ON public.designpro_generation_os_events;
CREATE POLICY designpro_generation_os_events_select
ON public.designpro_generation_os_events
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.designpro_generation_requests r
    WHERE r.generation_id=designpro_generation_os_events.generation_id
      AND (
        r.owner_id=auth.uid()
        OR designpro_private.caller_is_design_staff()
      )
  )
);

-- A.T.L.A.S. VERSION HISTORY -------------------------------------------------
CREATE OR REPLACE FUNCTION designpro_private.log_designpro_atlas_revision_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, designpro_private
AS $fn$
DECLARE
  v_generation uuid;
BEGIN
  SELECT r.generation_id INTO v_generation
  FROM public.designpro_generation_requests r
  WHERE r.id=NEW.request_id;

  IF v_generation IS NULL THEN
    RAISE EXCEPTION 'atlas_revision_generation_identity_missing';
  END IF;

  INSERT INTO public.designpro_generation_os_events(
    generation_id,event_type,revision_id,state,payload
  ) VALUES (
    v_generation,
    'atlas.revision.created',
    NEW.id,
    'created',
    pg_catalog.jsonb_build_object(
      'revisionSequence',NEW.revision_sequence,
      'masterContentHash',NEW.master_content_hash
    )
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS designpro_flat_atlas_revision_os_event ON public.designpro_flat_atlas_revisions;
CREATE TRIGGER designpro_flat_atlas_revision_os_event
AFTER INSERT ON public.designpro_flat_atlas_revisions
FOR EACH ROW EXECUTE FUNCTION designpro_private.log_designpro_atlas_revision_event();

-- WORKFLOW RUN HISTORY -------------------------------------------------------
CREATE OR REPLACE FUNCTION designpro_private.log_designpro_run_os_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, designpro_private
AS $fn$
DECLARE
  v_generation uuid;
BEGIN
  SELECT s.generation_id INTO v_generation
  FROM public.designpro_revision_sources s
  WHERE s.revision_id=NEW.revision_id;

  IF v_generation IS NULL THEN
    RAISE EXCEPTION 'workflow_run_generation_identity_missing';
  END IF;

  INSERT INTO public.designpro_generation_os_events(
    generation_id,event_type,revision_id,run_id,state,payload
  ) VALUES (
    v_generation,
    CASE WHEN TG_OP='INSERT' THEN 'workflow.run.created' ELSE 'workflow.run.state' END,
    NEW.revision_id,
    NEW.id,
    NEW.status,
    pg_catalog.jsonb_build_object(
      'workflowType',NEW.workflow_type,
      'idempotencyKey',NEW.idempotency_key
    )
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS designpro_workflow_run_os_event_insert ON public.designpro_workflow_runs;
CREATE TRIGGER designpro_workflow_run_os_event_insert
AFTER INSERT ON public.designpro_workflow_runs
FOR EACH ROW EXECUTE FUNCTION designpro_private.log_designpro_run_os_event();

DROP TRIGGER IF EXISTS designpro_workflow_run_os_event_state ON public.designpro_workflow_runs;
CREATE TRIGGER designpro_workflow_run_os_event_state
AFTER UPDATE OF status ON public.designpro_workflow_runs
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION designpro_private.log_designpro_run_os_event();

-- NODE HISTORY ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION designpro_private.log_designpro_stage_os_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, designpro_private
AS $fn$
DECLARE
  v_generation uuid;
  v_revision uuid;
BEGIN
  SELECT s.generation_id,w.revision_id
  INTO v_generation,v_revision
  FROM public.designpro_workflow_runs w
  JOIN public.designpro_revision_sources s ON s.revision_id=w.revision_id
  WHERE w.id=NEW.run_id;

  IF v_generation IS NULL THEN
    RAISE EXCEPTION 'workflow_stage_generation_identity_missing';
  END IF;

  INSERT INTO public.designpro_generation_os_events(
    generation_id,event_type,revision_id,run_id,stage_key,state,payload
  ) VALUES (
    v_generation,
    CASE WHEN TG_OP='INSERT' THEN 'workflow.stage.created' ELSE 'workflow.stage.state' END,
    v_revision,
    NEW.run_id,
    NEW.stage_key,
    NEW.status,
    pg_catalog.jsonb_build_object(
      'sequence',NEW.sequence,
      'dependsOn',NEW.depends_on,
      'attempt',NEW.attempt,
      'completedAt',NEW.completed_at,
      'verification',COALESCE(NEW.verification,'{}'::jsonb)
    )
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS designpro_workflow_stage_os_event_insert ON public.designpro_workflow_stages;
CREATE TRIGGER designpro_workflow_stage_os_event_insert
AFTER INSERT ON public.designpro_workflow_stages
FOR EACH ROW EXECUTE FUNCTION designpro_private.log_designpro_stage_os_event();

DROP TRIGGER IF EXISTS designpro_workflow_stage_os_event_state ON public.designpro_workflow_stages;
CREATE TRIGGER designpro_workflow_stage_os_event_state
AFTER UPDATE OF status ON public.designpro_workflow_stages
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION designpro_private.log_designpro_stage_os_event();

-- ONE SERVER SNAPSHOT FOR EVERY UI SURFACE ----------------------------------
CREATE OR REPLACE FUNCTION public.designpro_generation_os_snapshot(p_generation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, designpro_private
AS $fn$
DECLARE
  v_owner uuid := auth.uid();
  v_request public.designpro_generation_requests%ROWTYPE;
  v_staff boolean;
  v_revisions jsonb;
  v_runs jsonb;
  v_events jsonb;
BEGIN
  IF v_owner IS NULL OR COALESCE(auth.jwt()->>'is_anonymous','false')='true' THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  SELECT * INTO v_request
  FROM public.designpro_generation_requests r
  WHERE r.generation_id=p_generation_id;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'generation_not_found';
  END IF;

  v_staff := designpro_private.caller_is_design_staff();
  IF NOT v_staff AND v_request.owner_id<>v_owner THEN
    RAISE EXCEPTION 'generation_access_denied';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'revisionId',a.id,
      'revisionSequence',a.revision_sequence,
      'masterContentHash',a.master_content_hash,
      'createdAt',a.created_at
    ) ORDER BY a.revision_sequence DESC
  ),'[]'::jsonb)
  INTO v_revisions
  FROM public.designpro_flat_atlas_revisions a
  WHERE a.request_id=v_request.id;

  SELECT COALESCE(pg_catalog.jsonb_agg(run_row ORDER BY (run_row->>'createdAt') DESC),'[]'::jsonb)
  INTO v_runs
  FROM (
    SELECT pg_catalog.jsonb_build_object(
      'runId',w.id,
      'revisionId',w.revision_id,
      'workflowType',w.workflow_type,
      'status',w.status,
      'createdAt',w.created_at,
      'updatedAt',w.updated_at,
      'stages',COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'stageKey',st.stage_key,
            'state',st.status,
            'sequence',st.sequence,
            'dependsOn',st.depends_on,
            'attempt',st.attempt,
            'completedAt',st.completed_at,
            'verification',st.verification
          ) ORDER BY st.sequence,st.stage_key
        )
        FROM public.designpro_workflow_stages st
        WHERE st.run_id=w.id
      ),'[]'::jsonb)
    ) AS run_row
    FROM public.designpro_workflow_runs w
    JOIN public.designpro_revision_sources s ON s.revision_id=w.revision_id
    WHERE s.generation_id=p_generation_id
  ) q;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id',e.id,
      'eventType',e.event_type,
      'revisionId',e.revision_id,
      'runId',e.run_id,
      'stageKey',e.stage_key,
      'state',e.state,
      'payload',e.payload,
      'createdAt',e.created_at
    ) ORDER BY e.id
  ),'[]'::jsonb)
  INTO v_events
  FROM public.designpro_generation_os_events e
  WHERE e.generation_id=p_generation_id;

  RETURN pg_catalog.jsonb_build_object(
    'contract','designpro.generation-os.v1',
    'generationId',p_generation_id,
    'requestId',v_request.id,
    'requestState',v_request.state,
    'createdAt',v_request.created_at,
    'updatedAt',v_request.updated_at,
    'currentRevisionSequence',(
      SELECT pg_catalog.max(a.revision_sequence)
      FROM public.designpro_flat_atlas_revisions a
      WHERE a.request_id=v_request.id
    ),
    'revisions',v_revisions,
    'workflowRuns',v_runs,
    'events',v_events
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.designpro_generation_os_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.designpro_generation_os_snapshot(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.designpro_generation_os_snapshot(uuid) IS
  'Canonical Generation-ID snapshot consumed by Design, RevisionStudioIQ, PanelProStudio, QC and WrapBox. The execution graph remains authoritative; this function projects its version and event history into one read model.';
