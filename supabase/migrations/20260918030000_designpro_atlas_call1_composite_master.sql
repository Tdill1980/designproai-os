-- A.T.L.A.S. Call-1 graph: master.composite may name the run's master.
--
-- WHY. The element subgraph (typeset.produce / contact.produce / logo.prepare
-- -> element.lockup -> master.composite) compiled only inside the hero-driver
-- cascade, so with hero-driver off -- which is production -- it never ran at
-- all. Live efca5e03 (2026-09-18) recorded zero graph runs and zero nodes;
-- across all history there are 6 master.composite rows and ONE completed. No
-- customer has received a clean base with a composited lockup, which is why the
-- company name and the contact bar are still painted by the diffusion model.
--
-- Reaching it from six-surface means a run whose sheet is ALREADY authored and
-- accepted, so there is no master.assemble node to wait for. That run cannot
-- reach 'completed' today:
--
--   designpro_atlas_call1_runs CHECK (state<>'completed' OR (... AND
--     master_storage_path IS NOT NULL AND master_content_hash IS NOT NULL
--     AND master_byte_size IS NOT NULL))
--
-- and finish_designpro_atlas_call1_node only ever writes those three columns
-- WHEN v_node.node_key='master.assemble'. So the final node of an element-only
-- run would set state='completed' with the master columns still NULL and raise
-- the CHECK -- after the work was done, which is the worst possible moment.
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT. master.composite may now name
-- the run's master, but ONLY WHILE master_storage_path IS NULL. On the hero
-- cascade master.assemble is a DEPENDENCY of master.composite, so it has always
-- completed first and the column is never null by the time the composite
-- finishes: that branch cannot fire there, and the hero run row keeps recording
-- Layer 0 exactly as before. That is correct provenance and the runtime says so
-- in as many words -- "the row IS the clean master" -- with the composited
-- sheet returned to the caller separately. Only a run with no master.assemble
-- at all takes the new branch.
--
-- Nothing else moves: no CHECK is relaxed, no state machine changes, no column
-- is added, and the claim/lease/retry/refusal paths are untouched.
--
-- CREATE OR REPLACE is safe here, and that is checked rather than assumed: the
-- whole designpro_atlas_call1 RPC family was created in exactly one migration
-- (20260911170000) and no later migration patches any of it. This is NOT the
-- string-patched Calls 8-12 kernel that must be text-patched instead of
-- re-emitted; that rule protects complete_designpro_stage, a different family.

CREATE OR REPLACE FUNCTION public.finish_designpro_atlas_call1_node(p_node_id uuid,p_token uuid,p_state text,p_output jsonb,p_output_hash text)
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
    -- master.assemble names the master when it exists. master.composite names it
    -- ONLY when nothing has, which on the hero cascade is never -- assemble is
    -- its dependency and has already written these three columns.
    master_storage_path=CASE
      WHEN v_node.node_key='master.assemble' AND v_state='completed' THEN p_output#>>'{master,storagePath}'
      WHEN v_node.node_key='master.composite' AND v_state='completed' AND r.master_storage_path IS NULL THEN p_output#>>'{master,storagePath}'
      ELSE r.master_storage_path END,
    master_content_hash=CASE
      WHEN v_node.node_key='master.assemble' AND v_state='completed' THEN p_output#>>'{master,contentHash}'
      WHEN v_node.node_key='master.composite' AND v_state='completed' AND r.master_content_hash IS NULL THEN p_output#>>'{master,contentHash}'
      ELSE r.master_content_hash END,
    master_byte_size=CASE
      WHEN v_node.node_key='master.assemble' AND v_state='completed' THEN (p_output#>>'{master,byteSize}')::bigint
      WHEN v_node.node_key='master.composite' AND v_state='completed' AND r.master_byte_size IS NULL THEN (p_output#>>'{master,byteSize}')::bigint
      ELSE r.master_byte_size END,
    completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM public.designpro_atlas_call1_nodes n WHERE n.run_id=r.id AND n.state<>'completed') THEN now() ELSE r.completed_at END,
    updated_at=now()
    WHERE r.id=v_run.id RETURNING * INTO v_run;
  RETURN to_jsonb(v_run);
END $$;
