-- A.T.L.A.S. Call-1 graph: proof.assemble may name its run's master.
--
-- THE SAME DEFECT THE v28 MIGRATION FIXED, ONE CONTRACT LATER, AND CLAUDE.md
-- NAMES IT BY NAME: "authorElements does NOT fail soft on a missing migration:
-- the nodes run and the LAST one trips the master_storage_path IS NOT NULL CHECK
-- after doing the work."
--
-- That is exactly what the panel-proof pair does without this. Measured on the
-- real migration before it existed: `proof.sheet` completed, `proof.assemble`
-- drew all three zones, stored 11 of 11 sibling panels and assembled the master
-- -- and then `finish_designpro_atlas_call1_node` raised, because the run's
--
--     CHECK (state<>'completed' OR (... master_storage_path IS NOT NULL ...))
--
-- can only be satisfied by a node the finish RPC lets write those columns, and
-- that was `master.assemble` and `master.composite` only. The node row stayed
-- `running`, the lease expired, the node re-ran, and the caller timed out --
-- after every byte of the work had already been done, twice.
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT. `proof.assemble` may now name
-- the run's master, but ONLY WHILE master_storage_path IS NULL -- the same guard
-- `master.composite` carries and for the same reason: a panel-proof run has no
-- other node that could have named one, and on any run that does, the existing
-- master stands. Nothing else in the function moves. The hero cascade, the
-- element subgraph, the claim, the lease, the retry ladder and the resume are
-- byte-identical.
--
-- SHIP ORDER: THIS LANDS BEFORE A RUNTIME THAT EMITS `proof.assemble`. There is
-- no soft path -- the node does its work and then cannot be finished, which is
-- the worst shape a missing migration can have, so the database must learn the
-- node key first. (CLAUDE.md's own ordering rule, for the same reason the v28
-- migration had to precede the v28 runtime.)
--
-- CREATE OR REPLACE is safe here on the same evidence the v28 migration checked
-- and recorded: the whole designpro_atlas_call1 RPC family was created in one
-- migration (20260911170000) and is replaced only by that migration and this
-- one, never text-patched. This is NOT the string-patched Calls 8-12 kernel.

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
      WHEN v_node.node_key='proof.assemble' AND v_state='completed' AND r.master_storage_path IS NULL THEN p_output#>>'{master,storagePath}'
      ELSE r.master_storage_path END,
    master_content_hash=CASE
      WHEN v_node.node_key='master.assemble' AND v_state='completed' THEN p_output#>>'{master,contentHash}'
      WHEN v_node.node_key='master.composite' AND v_state='completed' AND r.master_content_hash IS NULL THEN p_output#>>'{master,contentHash}'
      WHEN v_node.node_key='proof.assemble' AND v_state='completed' AND r.master_content_hash IS NULL THEN p_output#>>'{master,contentHash}'
      ELSE r.master_content_hash END,
    master_byte_size=CASE
      WHEN v_node.node_key='master.assemble' AND v_state='completed' THEN (p_output#>>'{master,byteSize}')::bigint
      WHEN v_node.node_key='master.composite' AND v_state='completed' AND r.master_byte_size IS NULL THEN (p_output#>>'{master,byteSize}')::bigint
      WHEN v_node.node_key='proof.assemble' AND v_state='completed' AND r.master_byte_size IS NULL THEN (p_output#>>'{master,byteSize}')::bigint
      ELSE r.master_byte_size END,
    completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM public.designpro_atlas_call1_nodes n WHERE n.run_id=r.id AND n.state<>'completed') THEN now() ELSE r.completed_at END,
    updated_at=now()
    WHERE r.id=v_run.id RETURNING * INTO v_run;
  RETURN to_jsonb(v_run);
END $$;
