-- REFUSED A.T.L.A.S. CANDIDATES ARE VISIBLE TO THE OWNER.
--
-- Every Call-1 candidate the gates refuse is already stored under
-- wrap-files/atlas-call1/, but nothing recorded which request it belonged to
-- beyond the first 1000 characters of the failure message, and no policy let
-- the owner sign it. Thirteen refused sheets accumulated (2026-09-06 →
-- 2026-09-14) that no human had looked at, while the gates that refused them
-- were tuned blind. This table is the ledger the runtime writes one row per
-- refused candidate into, the RPC is the owner's read, and the storage policy
-- lets the owner (or design staff) SIGN exactly those objects -- never list,
-- never download directly, exactly like designpro_owner_read_flat_atlas_previews.

CREATE TABLE IF NOT EXISTS public.designpro_atlas_refusals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  generation_id uuid,
  owner_id uuid NOT NULL,
  tenant_key text,
  topology text NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  code text NOT NULL,
  reason text NOT NULL,
  storage_path text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint,
  content_type text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS designpro_atlas_refusals_request_idx
  ON public.designpro_atlas_refusals (request_id, created_at);
CREATE INDEX IF NOT EXISTS designpro_atlas_refusals_storage_path_idx
  ON public.designpro_atlas_refusals (storage_path);

ALTER TABLE public.designpro_atlas_refusals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.designpro_atlas_refusals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.designpro_atlas_refusals TO service_role;

COMMENT ON TABLE public.designpro_atlas_refusals IS
  'One row per Call-1 A.T.L.A.S. candidate the master gates refused: which request, which topology and attempt, why, and the exact raw bytes in Storage. Written by the runtime, read by the owner through designpro_atlas_refusal_paths.';

-- Owner (or design staff) read. Same shape and fence as
-- designpro_flat_atlas_revision_paths: NULL when the request does not exist
-- or is not the caller's, so the gateway answers 404 rather than leaking that
-- a request id exists.
CREATE OR REPLACE FUNCTION public.designpro_atlas_refusal_paths(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE
  v_request public.designpro_generation_requests%ROWTYPE;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_request
  FROM public.designpro_generation_requests
  WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
    AND v_request.owner_id IS DISTINCT FROM auth.uid()
    AND NOT designpro_private.caller_is_design_staff()
  THEN RETURN NULL; END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',r.id,
    'requestId',r.request_id,
    'generationId',r.generation_id,
    'topology',r.topology,
    'attempt',r.attempt,
    'code',r.code,
    'reason',r.reason,
    'storagePath',r.storage_path,
    'sha256',r.sha256,
    'byteSize',r.byte_size,
    'contentType',r.content_type,
    'model',r.model,
    'createdAt',r.created_at
  ) ORDER BY r.created_at, r.attempt),'[]'::jsonb)
  INTO v_rows
  FROM public.designpro_atlas_refusals r
  WHERE r.request_id=v_request.id;

  RETURN v_rows;
END;
$fn$;

REVOKE ALL ON FUNCTION public.designpro_atlas_refusal_paths(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.designpro_atlas_refusal_paths(uuid) TO authenticated, service_role;

-- Signing only, owner or design staff, exactly the objects the ledger names.
DROP POLICY IF EXISTS designpro_owner_sign_atlas_refusals ON storage.objects;
CREATE POLICY designpro_owner_sign_atlas_refusals
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id='wrap-files'
    AND storage.allow_only_operation('object.sign')
    AND EXISTS (
      SELECT 1
      FROM public.designpro_atlas_refusals refusal
      WHERE storage.objects.name=refusal.storage_path
        AND (
          refusal.owner_id=(SELECT auth.uid())
          OR designpro_private.caller_is_design_staff()
        )
    )
  );

COMMENT ON POLICY designpro_owner_sign_atlas_refusals ON storage.objects IS
  'Owner-only (or design staff) signing access to the exact refused Call-1 candidates recorded in designpro_atlas_refusals. Listing and direct download are excluded.';
