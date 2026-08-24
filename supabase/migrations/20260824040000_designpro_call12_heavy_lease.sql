-- Call 12 may hold the heavy-output lease it already asks for.
--
-- enhance.upscale wraps its work in withHeavyOutputLease, but this allowlist
-- never included it. acquire_designpro_heavy_lease therefore returned false on
-- every attempt, the claimant translated that into a RETRYABLE
-- heavy_output_capacity_busy, and the stage retried until the run was abandoned.
-- Nothing downstream of Call 12 has ever executed on this server: no outputs, no
-- final QC, no stamp, no ZIP, no WrapBox delivery.
--
-- Taking the lease is the correct behaviour, not the bug. Topaz upscaling six
-- panels to print pixel size is exactly the memory-bound work the single
-- production-heavy slot exists to serialize -- it belongs beside output.build,
-- output.verify and zip.build, not outside the gate.
--
-- The body is the 20260806180100 definition verbatim with that one stage key
-- added. Same service-role fence, same advisory lock, same lease-expiry
-- reclaim, same fencing token.

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
    AND stage_key IN ('enhance.upscale','output.build','output.verify','zip.build')
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
$fn$

REVOKE ALL ON FUNCTION public.acquire_designpro_heavy_lease(uuid,uuid,text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_designpro_heavy_lease(uuid,uuid,text,integer)
  TO service_role;

-- A stage that takes the lease but is missing from the allowlist cannot fail
-- loudly -- it looks exactly like contention. Assert the two lists agree.
DO $migration$
DECLARE
  v_definition text;
  v_stage text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.acquire_designpro_heavy_lease(uuid,uuid,text,integer)'::regprocedure
  ) INTO v_definition;
  FOREACH v_stage IN ARRAY ARRAY[
    'enhance.upscale','output.build','output.verify','zip.build'
  ] LOOP
    IF pg_catalog.strpos(v_definition,''''||v_stage||'''')=0 THEN
      RAISE EXCEPTION 'designpro_heavy_lease_allowlist_incomplete: %', v_stage;
    END IF;
  END LOOP;
END
$migration$;
