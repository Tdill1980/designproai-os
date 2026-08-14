-- Calls 1-7 slot-level leases.
--
-- generation-store.cjs calls claim/release/fail_designpro_generation_slot. Only
-- the request-level equivalents were ever built, so the store could not run and
-- the engine was never wired in. This supplies the missing layer.
--
-- A request lease says "one worker owns this request". A slot lease says "one
-- worker owns this request's driver view". Seven slots run under one request,
-- and recovery must resume the individual slot rather than restart the request,
-- because an accepted slot is immutable and must never be regenerated.

CREATE TABLE IF NOT EXISTS public.designpro_generation_slots (
  request_id uuid NOT NULL REFERENCES public.designpro_generation_requests(id)
    ON DELETE CASCADE,
  source_view_type text NOT NULL CHECK (source_view_type IN (
    'side','passenger-side','hood_detail','front','rear','close-up','roof'
  )),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','leased','accepted','failed')),
  lease_owner text CHECK (lease_owner IS NULL OR pg_catalog.length(lease_owner) BETWEEN 1 AND 160),
  lease_token uuid,
  lease_expires_at timestamptz,
  reason text CHECK (reason IS NULL OR pg_catalog.length(reason) <= 160),
  provider_calls integer NOT NULL DEFAULT 0 CHECK (provider_calls >= 0),
  rejections integer NOT NULL DEFAULT 0 CHECK (rejections >= 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (request_id, source_view_type)
);

ALTER TABLE public.designpro_generation_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.designpro_generation_slots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.designpro_generation_slots TO service_role;

-- The store opens an attempt row then closes it with the outcome, so it needs
-- UPDATE. The attempts migration granted only SELECT and INSERT.
GRANT UPDATE ON public.designpro_generation_attempts TO service_role;

-- An accepted view is the authority on slot state. Deriving it from the view
-- row rather than trusting the worker to report it means a worker that dies
-- immediately after persisting still leaves the slot correctly accepted.
CREATE OR REPLACE FUNCTION designpro_private.mark_generation_slot_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public'
AS $fn$
BEGIN
  INSERT INTO public.designpro_generation_slots AS s
    (request_id, source_view_type, state, lease_owner, lease_token, lease_expires_at, updated_at)
  VALUES
    (NEW.request_id, NEW.source_view_type, 'accepted', NULL, NULL, NULL, pg_catalog.clock_timestamp())
  ON CONFLICT (request_id, source_view_type) DO UPDATE
    SET state='accepted', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
        reason=NULL, updated_at=pg_catalog.clock_timestamp();
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS designpro_generation_slot_accepted
  ON public.designpro_generation_views;
CREATE TRIGGER designpro_generation_slot_accepted
AFTER INSERT ON public.designpro_generation_views
FOR EACH ROW EXECUTE FUNCTION designpro_private.mark_generation_slot_accepted();

CREATE OR REPLACE FUNCTION public.claim_designpro_generation_slot(
  p_request_id uuid,
  p_source_view_type text,
  p_worker text,
  p_lease_seconds integer DEFAULT 600
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','extensions'
AS $function$
DECLARE
  v_token uuid;
  v_state text;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_request_id IS NULL
    OR p_source_view_type IS NULL
    OR pg_catalog.length(pg_catalog.btrim(COALESCE(p_worker,''))) NOT BETWEEN 1 AND 160
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 1800
  THEN RAISE EXCEPTION 'generation_slot_claim_invalid'; END IF;

  INSERT INTO public.designpro_generation_slots (request_id, source_view_type)
  VALUES (p_request_id, p_source_view_type)
  ON CONFLICT (request_id, source_view_type) DO NOTHING;

  SELECT state INTO v_state
  FROM public.designpro_generation_slots
  WHERE request_id=p_request_id AND source_view_type=p_source_view_type
  FOR UPDATE;

  IF v_state='accepted' THEN RETURN NULL; END IF;

  IF v_state='leased' AND EXISTS (
    SELECT 1 FROM public.designpro_generation_slots
    WHERE request_id=p_request_id AND source_view_type=p_source_view_type
      AND lease_expires_at > pg_catalog.clock_timestamp()
  ) THEN RETURN NULL; END IF;

  v_token := extensions.gen_random_uuid();
  UPDATE public.designpro_generation_slots
  SET state='leased',
      lease_owner=pg_catalog.btrim(p_worker),
      lease_token=v_token,
      lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),
      reason=NULL,
      updated_at=pg_catalog.clock_timestamp()
  WHERE request_id=p_request_id AND source_view_type=p_source_view_type;

  RETURN pg_catalog.jsonb_build_object(
    'requestId', p_request_id,
    'sourceViewType', p_source_view_type,
    'leaseToken', v_token,
    'leaseExpiresAt', pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_designpro_generation_slot(
  p_request_id uuid,
  p_source_view_type text,
  p_lease_token uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_request_id IS NULL OR p_source_view_type IS NULL THEN RETURN false; END IF;

  UPDATE public.designpro_generation_slots
  SET state='pending', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
      updated_at=pg_catalog.clock_timestamp()
  WHERE request_id=p_request_id
    AND source_view_type=p_source_view_type
    AND state='leased'
    AND (p_lease_token IS NULL OR lease_token=p_lease_token);

  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_designpro_generation_slot(
  p_request_id uuid,
  p_source_view_type text,
  p_reason text,
  p_provider_calls integer DEFAULT 0,
  p_rejections integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_request_id IS NULL OR p_source_view_type IS NULL THEN RETURN false; END IF;

  INSERT INTO public.designpro_generation_slots (request_id, source_view_type)
  VALUES (p_request_id, p_source_view_type)
  ON CONFLICT (request_id, source_view_type) DO NOTHING;

  UPDATE public.designpro_generation_slots
  SET state=CASE WHEN state='accepted' THEN 'accepted' ELSE 'failed' END,
      reason=pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(p_reason),''),'provider_attempts_exhausted'),160),
      provider_calls=GREATEST(provider_calls, COALESCE(p_provider_calls,0)),
      rejections=GREATEST(rejections, COALESCE(p_rejections,0)),
      lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
      updated_at=pg_catalog.clock_timestamp()
  WHERE request_id=p_request_id AND source_view_type=p_source_view_type;

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_designpro_generation_slot(uuid,text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_designpro_generation_slot(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_designpro_generation_slot(uuid,text,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_designpro_generation_slot(uuid,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_designpro_generation_slot(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_designpro_generation_slot(uuid,text,text,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION designpro_private.mark_generation_slot_accepted() FROM PUBLIC, anon, authenticated;
