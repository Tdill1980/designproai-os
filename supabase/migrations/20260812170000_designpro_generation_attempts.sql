-- Calls 1-7 system of record, completed.
--
-- designpro_generation_requests and designpro_generation_views already carry
-- the request, the vehicle/prompt spec, per-slot identity, storage path,
-- content hash, byte size, MIME type and failure state, and already enforce one
-- row per source slot. Two things were missing and both are added here.
--
-- 1. Provider attempt history. A view row records the winner; it says nothing
--    about which models and keys were tried, what they returned, or how long it
--    took. Without that, a slot that came back on the third key of the fallback
--    model is indistinguishable from one that succeeded first time, and there
--    is no way to see a provider degrading before it fails outright.
--
-- 2. Accepted winners must be immutable. UNIQUE(request_id,source_view_type)
--    stops a second row, but nothing stopped an UPDATE swapping the bytes of a
--    slot that Calls 8+ had already consumed. Retries may add attempts; an
--    accepted slot never changes. Same authored-winner rule Call 8 and Call 12
--    already follow.

CREATE TABLE IF NOT EXISTS public.designpro_generation_attempts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.designpro_generation_requests(id)
    ON DELETE CASCADE,
  source_view_type text NOT NULL CHECK (source_view_type IN (
    'side','passenger-side','hood_detail','front','rear','close-up','roof'
  )),
  attempt integer NOT NULL CHECK (attempt >= 1),
  model text NOT NULL CHECK (
    pg_catalog.btrim(model) <> '' AND pg_catalog.length(model) <= 120
  ),
  -- Fingerprint only. A provider key must never be written to a table, a log,
  -- or a receipt.
  key_fingerprint text NOT NULL CHECK (key_fingerprint ~ '^[0-9a-f]{12}$'),
  outcome text NOT NULL CHECK (outcome IN (
    'accepted','http_error','empty_response','unsupported_type','multi_image','aborted','timeout'
  )),
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 0 AND 599),
  detail text CHECK (detail IS NULL OR pg_catalog.length(detail) <= 500),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE(request_id, source_view_type, attempt),
  -- An accepted attempt is the one that produced bytes, so it must name them.
  CONSTRAINT designpro_generation_attempt_accepted_identity CHECK (
    outcome <> 'accepted' OR content_hash IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS designpro_generation_attempt_request_idx
  ON public.designpro_generation_attempts(request_id, source_view_type, attempt);
CREATE INDEX IF NOT EXISTS designpro_generation_attempt_health_idx
  ON public.designpro_generation_attempts(model, key_fingerprint, outcome, created_at DESC);

ALTER TABLE public.designpro_generation_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.designpro_generation_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.designpro_generation_attempts TO service_role;

-- An accepted slot is immutable. Its bytes, path and identity are what the
-- seven-view handoff pinned, and what Calls 8+ hashed. A retry that wanted to
-- replace them would silently invalidate every receipt downstream.
CREATE OR REPLACE FUNCTION designpro_private.enforce_generation_view_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.storage_path IS DISTINCT FROM OLD.storage_path
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
    OR NEW.content_type IS DISTINCT FROM OLD.content_type
    OR NEW.source_view_type IS DISTINCT FROM OLD.source_view_type
    OR NEW.consumer_role IS DISTINCT FROM OLD.consumer_role
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
  THEN
    RAISE EXCEPTION 'accepted_generation_view_is_immutable';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS designpro_generation_view_immutable
  ON public.designpro_generation_views;
CREATE TRIGGER designpro_generation_view_immutable
BEFORE UPDATE ON public.designpro_generation_views
FOR EACH ROW EXECUTE FUNCTION designpro_private.enforce_generation_view_immutable();

-- Deleting an accepted slot is the same problem wearing a different hat: the
-- seven-view handoff would lose a source Calls 8+ already bound.
CREATE OR REPLACE FUNCTION designpro_private.enforce_generation_view_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION 'accepted_generation_view_cannot_be_deleted';
END
$fn$;

DROP TRIGGER IF EXISTS designpro_generation_view_no_delete
  ON public.designpro_generation_views;
CREATE TRIGGER designpro_generation_view_no_delete
BEFORE DELETE ON public.designpro_generation_views
FOR EACH ROW EXECUTE FUNCTION designpro_private.enforce_generation_view_no_delete();

REVOKE ALL ON FUNCTION designpro_private.enforce_generation_view_immutable()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION designpro_private.enforce_generation_view_no_delete()
  FROM PUBLIC, anon, authenticated;
