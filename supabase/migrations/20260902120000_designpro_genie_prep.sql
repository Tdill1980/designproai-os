-- GENIE PREP — THE EARLY LIFECYCLE (owner ruling, Trish 2026-09-02).
--
-- Year / Make / Model → ENTER → GenerationID → GENIE dimension resolution starts
-- immediately and persists against the GenerationID as PRIVATE OS state while
-- the customer keeps writing the creative prompt. Generate consumes the
-- prepared geometry when it is READY for the same GenerationID, the same
-- vehicle identity and the same GENIE contract; anything else falls back to the
-- existing inline resolver in the generation worker. Prepared geometry never
-- enters the model-facing Call-1 request.
--
-- Identity: (generation_id, vehicle_identity_hash, genie_contract_version) is
-- UNIQUE and is the idempotency key -- a retry for the same triple returns the
-- existing row. A changed vehicle for the same generation is a NEW row; the
-- older rows are marked superseded and can never be consumed.
--
-- State machine:
--   queued → resolving → ready
--                     → failed (retryable while attempt < 3: → queued)
--   queued|ready|failed → superseded  (a newer vehicle identity for the generation)
--   ready → consumed_at set once by the generation worker (a timestamp, not a state)
--
-- All writes go through the SECURITY DEFINER RPCs below and are service-role
-- only; the owner may only SELECT their own rows (the UI reads status, never
-- geometry).

CREATE TABLE public.designpro_genie_preps (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  generation_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tenant_key text NOT NULL CHECK (tenant_key='user_'||owner_id::text),
  vehicle jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(vehicle)='object'),
  vehicle_identity_hash text NOT NULL CHECK (vehicle_identity_hash ~ '^[0-9a-f]{64}$'),
  genie_contract_version text NOT NULL CHECK (
    pg_catalog.length(pg_catalog.btrim(genie_contract_version)) BETWEEN 1 AND 160
  ),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued','resolving','ready','failed','superseded')
  ),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  worker_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  -- The resolver's full return (the `dimensionRow`), persisted verbatim so the
  -- worker consumes exactly what the inline resolver would have produced.
  geometry jsonb CHECK (geometry IS NULL OR pg_catalog.jsonb_typeof(geometry)='object'),
  geometry_manifest_hash text CHECK (
    geometry_manifest_hash IS NULL OR geometry_manifest_hash ~ '^[0-9a-f]{64}$'
  ),
  geometry_state text CHECK (
    geometry_state IS NULL OR geometry_state IN ('measured','derived','provisional','unresolved')
  ),
  production_eligible boolean,
  error_code text,
  error_message text,
  -- Instrumentation. client_entered_at is the browser's Enter time (informational);
  -- requested_at is the server acknowledgment; started/prepared bound the GENIE work.
  client_entered_at timestamptz,
  requested_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  started_at timestamptz,
  prepared_at timestamptz,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  consumed_at timestamptz,
  consumed_by_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (generation_id, vehicle_identity_hash, genie_contract_version),
  CONSTRAINT designpro_genie_prep_ready_shape CHECK (
    status <> 'ready'
    OR (geometry IS NOT NULL AND geometry_manifest_hash IS NOT NULL
        AND geometry_state IS NOT NULL AND prepared_at IS NOT NULL AND duration_ms IS NOT NULL)
  )
);

CREATE INDEX designpro_genie_preps_generation_idx
  ON public.designpro_genie_preps(generation_id, requested_at DESC);
CREATE INDEX designpro_genie_preps_claimable_idx
  ON public.designpro_genie_preps(status, lease_expires_at, requested_at)
  WHERE status IN ('queued','resolving');

ALTER TABLE public.designpro_genie_preps ENABLE ROW LEVEL SECURITY;

CREATE POLICY designpro_owner_read_genie_preps
  ON public.designpro_genie_preps FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION designpro_private.touch_designpro_genie_prep()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER designpro_genie_prep_touch
  BEFORE UPDATE ON public.designpro_genie_preps
  FOR EACH ROW EXECUTE FUNCTION designpro_private.touch_designpro_genie_prep();

CREATE OR REPLACE FUNCTION designpro_private.genie_prep_receipt(p_row public.designpro_genie_preps)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'prepId', p_row.id,
    'generationId', p_row.generation_id,
    'vehicleIdentityHash', p_row.vehicle_identity_hash,
    'genieContractVersion', p_row.genie_contract_version,
    'status', p_row.status,
    'attempt', p_row.attempt,
    'geometryState', p_row.geometry_state,
    'productionEligible', p_row.production_eligible,
    'geometryManifestHash', p_row.geometry_manifest_hash,
    'errorCode', p_row.error_code,
    'clientEnteredAt', p_row.client_entered_at,
    'requestedAt', p_row.requested_at,
    'startedAt', p_row.started_at,
    'preparedAt', p_row.prepared_at,
    'durationMs', p_row.duration_ms,
    'consumedAt', p_row.consumed_at,
    'consumedByRequestId', p_row.consumed_by_request_id
  );
$fn$;

-- ── request: idempotent on the triple; supersedes other vehicles of the generation ──
CREATE OR REPLACE FUNCTION public.request_designpro_genie_prep(
  p_owner_id uuid,
  p_generation_id uuid,
  p_vehicle jsonb,
  p_vehicle_identity_hash text,
  p_genie_contract_version text,
  p_client_entered_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_row public.designpro_genie_preps%ROWTYPE;
  v_idempotent boolean := true;
BEGIN
  IF p_owner_id IS NULL OR p_generation_id IS NULL OR p_vehicle IS NULL
    OR pg_catalog.jsonb_typeof(p_vehicle) <> 'object'
    OR p_vehicle_identity_hash !~ '^[0-9a-f]{64}$'
    OR pg_catalog.length(pg_catalog.btrim(COALESCE(p_genie_contract_version,''))) = 0
  THEN RAISE EXCEPTION 'genie_prep_request_invalid'; END IF;

  -- A GenerationID belongs to exactly one owner, whether it was first seen
  -- here or at Generate.
  IF EXISTS (
    SELECT 1 FROM public.designpro_genie_preps
    WHERE generation_id = p_generation_id AND owner_id <> p_owner_id
  ) OR EXISTS (
    SELECT 1 FROM public.designpro_generation_requests
    WHERE generation_id = p_generation_id AND owner_id <> p_owner_id
  ) THEN RAISE EXCEPTION 'genie_prep_owner_conflict'; END IF;

  INSERT INTO public.designpro_genie_preps(
    generation_id, owner_id, tenant_key, vehicle, vehicle_identity_hash,
    genie_contract_version, client_entered_at
  ) VALUES (
    p_generation_id, p_owner_id, 'user_'||p_owner_id::text, p_vehicle,
    p_vehicle_identity_hash, p_genie_contract_version, p_client_entered_at
  )
  ON CONFLICT (generation_id, vehicle_identity_hash, genie_contract_version) DO NOTHING
  RETURNING * INTO v_row;
  IF FOUND THEN v_idempotent := false; END IF;

  -- A different vehicle identity for the same generation retires the others.
  -- A row mid-resolution is left alone: its completion is refused below because
  -- the vehicle hash no longer matches the newest request, and it is retired
  -- on the next request for this generation.
  UPDATE public.designpro_genie_preps
  SET status = 'superseded'
  WHERE generation_id = p_generation_id
    AND vehicle_identity_hash <> p_vehicle_identity_hash
    AND status IN ('queued','ready','failed');

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM public.designpro_genie_preps
    WHERE generation_id = p_generation_id
      AND vehicle_identity_hash = p_vehicle_identity_hash
      AND genie_contract_version = p_genie_contract_version;
  END IF;
  RETURN designpro_private.genie_prep_receipt(v_row) || pg_catalog.jsonb_build_object('idempotent', v_idempotent);
END;
$fn$;

-- ── claim: a specific row (the acknowledging request) or the oldest eligible one (reclaim) ──
CREATE OR REPLACE FUNCTION public.claim_designpro_genie_prep(
  p_worker_id text,
  p_lease_seconds integer,
  p_prep_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_row public.designpro_genie_preps%ROWTYPE;
  v_token uuid := extensions.gen_random_uuid();
BEGIN
  IF pg_catalog.length(pg_catalog.btrim(COALESCE(p_worker_id,''))) = 0
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 900
  THEN RAISE EXCEPTION 'genie_prep_claim_invalid'; END IF;

  SELECT * INTO v_row FROM public.designpro_genie_preps
  WHERE (p_prep_id IS NULL OR id = p_prep_id)
    AND attempt < 3
    AND (status = 'queued'
      OR (status = 'resolving' AND lease_expires_at IS NOT NULL AND lease_expires_at < pg_catalog.clock_timestamp()))
  ORDER BY requested_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.designpro_genie_preps
  SET status = 'resolving',
      attempt = attempt + 1,
      worker_id = p_worker_id,
      lease_token = v_token,
      lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
      started_at = COALESCE(started_at, pg_catalog.clock_timestamp())
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN designpro_private.genie_prep_receipt(v_row)
    || pg_catalog.jsonb_build_object('leaseToken', v_token, 'vehicle', v_row.vehicle, 'ownerId', v_row.owner_id);
END;
$fn$;

-- ── complete: only the lease holder, only while still resolving ──
CREATE OR REPLACE FUNCTION public.complete_designpro_genie_prep(
  p_prep_id uuid,
  p_lease_token uuid,
  p_geometry jsonb,
  p_geometry_manifest_hash text,
  p_geometry_state text,
  p_production_eligible boolean,
  p_duration_ms integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_row public.designpro_genie_preps%ROWTYPE;
BEGIN
  IF p_geometry IS NULL OR pg_catalog.jsonb_typeof(p_geometry) <> 'object'
    OR p_geometry_manifest_hash !~ '^[0-9a-f]{64}$'
    OR p_geometry_state NOT IN ('measured','derived','provisional','unresolved')
    OR p_duration_ms IS NULL OR p_duration_ms < 0
  THEN RAISE EXCEPTION 'genie_prep_completion_invalid'; END IF;

  UPDATE public.designpro_genie_preps
  SET status = 'ready',
      geometry = p_geometry,
      geometry_manifest_hash = p_geometry_manifest_hash,
      geometry_state = p_geometry_state,
      production_eligible = p_production_eligible,
      prepared_at = pg_catalog.clock_timestamp(),
      duration_ms = p_duration_ms,
      lease_token = NULL,
      lease_expires_at = NULL,
      error_code = NULL,
      error_message = NULL
  WHERE id = p_prep_id AND lease_token = p_lease_token AND status = 'resolving'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'genie_prep_lease_stale'; END IF;
  RETURN designpro_private.genie_prep_receipt(v_row);
END;
$fn$;

-- ── fail: retryable → queued while attempts remain, otherwise failed ──
CREATE OR REPLACE FUNCTION public.fail_designpro_genie_prep(
  p_prep_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_row public.designpro_genie_preps%ROWTYPE;
BEGIN
  UPDATE public.designpro_genie_preps
  SET status = CASE WHEN COALESCE(p_retryable,false) AND attempt < 3 THEN 'queued' ELSE 'failed' END,
      error_code = pg_catalog.left(COALESCE(p_error_code,'genie_prep_failed'), 120),
      error_message = pg_catalog.left(COALESCE(p_error_message,''), 1000),
      lease_token = NULL,
      lease_expires_at = NULL
  WHERE id = p_prep_id AND lease_token = p_lease_token AND status = 'resolving'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'genie_prep_lease_stale'; END IF;
  RETURN designpro_private.genie_prep_receipt(v_row);
END;
$fn$;

-- ── read (worker): the exact triple for the exact owner, or null ──
CREATE OR REPLACE FUNCTION public.read_designpro_genie_prep(
  p_owner_id uuid,
  p_generation_id uuid,
  p_vehicle_identity_hash text,
  p_genie_contract_version text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_row public.designpro_genie_preps%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.designpro_genie_preps
  WHERE owner_id = p_owner_id
    AND generation_id = p_generation_id
    AND vehicle_identity_hash = p_vehicle_identity_hash
    AND genie_contract_version = p_genie_contract_version;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN designpro_private.genie_prep_receipt(v_row)
    || pg_catalog.jsonb_build_object('geometry', v_row.geometry);
END;
$fn$;

-- ── consume: once, by the generation request that used it ──
CREATE OR REPLACE FUNCTION public.consume_designpro_genie_prep(
  p_prep_id uuid,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_row public.designpro_genie_preps%ROWTYPE;
BEGIN
  UPDATE public.designpro_genie_preps
  SET consumed_at = COALESCE(consumed_at, pg_catalog.clock_timestamp()),
      consumed_by_request_id = COALESCE(consumed_by_request_id, p_request_id)
  WHERE id = p_prep_id AND status = 'ready'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'genie_prep_not_ready'; END IF;
  RETURN designpro_private.genie_prep_receipt(v_row);
END;
$fn$;

REVOKE ALL ON public.designpro_genie_preps FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.designpro_genie_preps TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.designpro_genie_preps TO service_role;

REVOKE ALL ON FUNCTION designpro_private.genie_prep_receipt(public.designpro_genie_preps) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION designpro_private.touch_designpro_genie_prep() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_designpro_genie_prep(uuid,uuid,jsonb,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_designpro_genie_prep(text,integer,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_designpro_genie_prep(uuid,uuid,jsonb,text,text,boolean,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_designpro_genie_prep(uuid,uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_designpro_genie_prep(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_designpro_genie_prep(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_designpro_genie_prep(uuid,uuid,jsonb,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_designpro_genie_prep(text,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_designpro_genie_prep(uuid,uuid,jsonb,text,text,boolean,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_designpro_genie_prep(uuid,uuid,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_designpro_genie_prep(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_designpro_genie_prep(uuid,uuid) TO service_role;
