-- Layerize™ durable pay-per-use reconstruction ledger.
-- One row is the transaction identity for one owner + source hash + output mode.
-- The database, not the browser, owns the three-token reservation/refund so
-- retries cannot double-charge and a failed reconstruction never keeps tokens.

CREATE TABLE IF NOT EXISTS public.layerize_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  source_content_hash text NOT NULL CHECK (source_content_hash ~ '^[0-9a-f]{64}$'),
  output_mode text NOT NULL CHECK (output_mode IN ('editable_layers','screen_print','embroidery_prep')),
  source_storage_path text NOT NULL,
  source_file_name text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','working','completed','failed')),
  charge_source text CHECK (charge_source IN ('tokens','privileged')),
  tokens_charged integer NOT NULL DEFAULT 0 CHECK (tokens_charged IN (0,3)),
  tokens_refunded boolean NOT NULL DEFAULT false,
  output_storage_path text,
  master_storage_path text,
  layerized_storage_path text,
  layer_count integer,
  path_count integer,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, source_content_hash, output_mode)
);

ALTER TABLE public.layerize_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS layerize_runs_read_own ON public.layerize_runs;
CREATE POLICY layerize_runs_read_own
  ON public.layerize_runs FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.reserve_layerize_run(
  p_owner uuid,
  p_source_hash text,
  p_output_mode text,
  p_source_path text,
  p_file_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  r public.layerize_runs%ROWTYPE;
  t public.user_tokens%ROWTYPE;
  v_privileged boolean := false;
  v_balance integer;
BEGIN
  IF p_owner IS NULL OR p_source_hash !~ '^[0-9a-f]{64}$'
     OR p_output_mode NOT IN ('editable_layers','screen_print','embroidery_prep')
     OR coalesce(p_source_path,'') = '' OR coalesce(p_file_name,'') = '' THEN
    RAISE EXCEPTION 'layerize_input_invalid';
  END IF;

  INSERT INTO public.layerize_runs(
    owner_id,source_content_hash,output_mode,source_storage_path,source_file_name
  ) VALUES (p_owner,p_source_hash,p_output_mode,p_source_path,left(p_file_name,255))
  ON CONFLICT (owner_id,source_content_hash,output_mode) DO NOTHING;

  SELECT * INTO r
  FROM public.layerize_runs
  WHERE owner_id=p_owner AND source_content_hash=p_source_hash AND output_mode=p_output_mode
  FOR UPDATE;

  IF r.state='completed' AND r.output_storage_path IS NOT NULL THEN
    RETURN jsonb_build_object(
      'runId',r.id,'fresh',false,'state','completed','chargeSource',r.charge_source,
      'tokensCharged',r.tokens_charged,'outputStoragePath',r.output_storage_path,
      'masterStoragePath',r.master_storage_path,'layerizedStoragePath',r.layerized_storage_path,
      'layerCount',r.layer_count,'pathCount',r.path_count,'warnings',r.warnings
    );
  END IF;

  IF r.state='working' AND r.started_at > now() - interval '20 minutes' THEN
    RETURN jsonb_build_object(
      'runId',r.id,'fresh',false,'state','working','chargeSource',r.charge_source,
      'tokensCharged',r.tokens_charged
    );
  END IF;

  -- A worker that died after reserving tokens cannot strand them forever.
  -- Only reclaim after twenty minutes, well beyond the normal Layerize request.
  IF r.state='working' AND r.tokens_charged=3 AND r.tokens_refunded=false THEN
    UPDATE public.user_tokens
      SET balance=balance+3,
          total_used=greatest(0,total_used-3),
          updated_at=now()
      WHERE user_id=p_owner
      RETURNING balance INTO v_balance;
    INSERT INTO public.token_transactions(user_id,amount,balance_after,reason,action_id)
      VALUES(p_owner,3,coalesce(v_balance,3),'Layerize stale-run recovery refund',r.id);
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE user_id=p_owner AND role::text IN ('admin','tester')
  ) INTO v_privileged;

  IF v_privileged THEN
    UPDATE public.layerize_runs SET
      source_storage_path=p_source_path,
      source_file_name=left(p_file_name,255),
      state='working',
      charge_source='privileged',
      tokens_charged=0,
      tokens_refunded=false,
      failure_reason=NULL,
      started_at=now(),
      completed_at=NULL,
      updated_at=now()
    WHERE id=r.id
    RETURNING * INTO r;
  ELSE
    SELECT * INTO t FROM public.user_tokens WHERE user_id=p_owner FOR UPDATE;
    IF NOT FOUND OR t.balance < 3 THEN
      RAISE EXCEPTION 'layerize_tokens_required';
    END IF;

    UPDATE public.user_tokens SET
      balance=balance-3,
      total_used=total_used+3,
      updated_at=now()
    WHERE user_id=p_owner
    RETURNING balance INTO v_balance;

    INSERT INTO public.token_transactions(user_id,amount,balance_after,reason,action_id)
      VALUES(p_owner,-3,v_balance,'Layerize reconstruction',r.id);

    UPDATE public.layerize_runs SET
      source_storage_path=p_source_path,
      source_file_name=left(p_file_name,255),
      state='working',
      charge_source='tokens',
      tokens_charged=3,
      tokens_refunded=false,
      failure_reason=NULL,
      started_at=now(),
      completed_at=NULL,
      updated_at=now()
    WHERE id=r.id
    RETURNING * INTO r;
  END IF;

  RETURN jsonb_build_object(
    'runId',r.id,'fresh',true,'state','working','chargeSource',r.charge_source,
    'tokensCharged',r.tokens_charged
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.complete_layerize_run(
  p_run_id uuid,
  p_output_path text,
  p_master_path text,
  p_layerized_path text,
  p_layer_count integer,
  p_path_count integer,
  p_warnings jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE r public.layerize_runs%ROWTYPE;
BEGIN
  UPDATE public.layerize_runs SET
    state='completed',
    output_storage_path=p_output_path,
    master_storage_path=p_master_path,
    layerized_storage_path=p_layerized_path,
    layer_count=greatest(0,coalesce(p_layer_count,0)),
    path_count=greatest(0,coalesce(p_path_count,0)),
    warnings=coalesce(p_warnings,'[]'::jsonb),
    failure_reason=NULL,
    completed_at=now(),
    updated_at=now()
  WHERE id=p_run_id AND state='working'
  RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'layerize_run_not_working'; END IF;
  RETURN jsonb_build_object('runId',r.id,'state',r.state);
END
$fn$;

CREATE OR REPLACE FUNCTION public.fail_layerize_run(
  p_run_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  r public.layerize_runs%ROWTYPE;
  v_balance integer;
BEGIN
  SELECT * INTO r FROM public.layerize_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'layerize_run_not_found'; END IF;

  IF r.state='completed' THEN
    RETURN jsonb_build_object('runId',r.id,'state','completed','refunded',false);
  END IF;

  IF r.tokens_charged=3 AND r.tokens_refunded=false THEN
    UPDATE public.user_tokens SET
      balance=balance+3,
      total_used=greatest(0,total_used-3),
      updated_at=now()
    WHERE user_id=r.owner_id
    RETURNING balance INTO v_balance;
    INSERT INTO public.token_transactions(user_id,amount,balance_after,reason,action_id)
      VALUES(r.owner_id,3,coalesce(v_balance,3),'Layerize failed-run refund',r.id);
    r.tokens_refunded := true;
  END IF;

  UPDATE public.layerize_runs SET
    state='failed',
    tokens_refunded=r.tokens_refunded,
    failure_reason=left(coalesce(p_reason,'layerize_failed'),500),
    updated_at=now()
  WHERE id=r.id;

  RETURN jsonb_build_object('runId',r.id,'state','failed','refunded',r.tokens_refunded);
END
$fn$;

REVOKE ALL ON FUNCTION public.reserve_layerize_run(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_layerize_run(uuid,text,text,text,integer,integer,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_layerize_run(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_layerize_run(uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_layerize_run(uuid,text,text,text,integer,integer,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_layerize_run(uuid,text) TO service_role;
