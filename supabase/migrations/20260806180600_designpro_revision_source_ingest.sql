-- Authenticated ingestion of a complete immutable DesignPro revision source.
-- The gateway uses the user's JWT; no service-role credential is accepted.

ALTER TABLE public.designpro_revision_sources
  ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL CHECK (btrim(idempotency_key)<>'');
CREATE UNIQUE INDEX IF NOT EXISTS designpro_revision_sources_owner_idempotency_idx
  ON public.designpro_revision_sources(owner_id,idempotency_key);

CREATE OR REPLACE FUNCTION public.save_designpro_revision_source(
  p_revision_id uuid,
  p_generation_id uuid,
  p_visualization_id uuid,
  p_expected_updated_at timestamptz,
  p_snapshot jsonb,
  p_snapshot_hash text,
  p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_owner uuid:=auth.uid();
  v_tenant text;
  v_derived_hash text;
  v_existing public.designpro_revision_sources%ROWTYPE;
  v_created boolean:=false;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'authenticated' OR v_owner IS NULL THEN RAISE EXCEPTION 'authenticated_user_required'; END IF;
  IF p_revision_id IS NULL OR p_generation_id IS NULL OR p_visualization_id IS NULL OR p_expected_updated_at IS NULL
    OR NULLIF(btrim(p_idempotency_key),'') IS NULL OR length(p_idempotency_key)>240 THEN RAISE EXCEPTION 'revision_source_identity_incomplete'; END IF;
  v_tenant:='user_'||v_owner::text;
  IF p_snapshot->>'contractVersion' IS DISTINCT FROM 'designpro.revision-snapshot.v1'
    OR p_snapshot->>'visualizationId' IS DISTINCT FROM p_visualization_id::text
    OR (p_snapshot ? 'revisionId' AND p_snapshot->>'revisionId' IS DISTINCT FROM p_revision_id::text)
    OR (p_snapshot ? 'generationId' AND p_snapshot->>'generationId' IS DISTINCT FROM p_generation_id::text)
    OR jsonb_typeof(p_snapshot->'expectedLogoInventory') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'revision_snapshot_identity_mismatch'; END IF;
  v_derived_hash:=encode(extensions.digest(convert_to(p_snapshot::text,'UTF8'),'sha256'),'hex');
  IF NULLIF(btrim(COALESCE(p_snapshot_hash,'')),'') IS NOT NULL
    AND lower(p_snapshot_hash) IS DISTINCT FROM v_derived_hash
  THEN RAISE EXCEPTION 'revision_snapshot_hash_mismatch'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('designpro.revision-source:'||v_owner::text||':'||p_idempotency_key,0));
  SELECT * INTO v_existing FROM public.designpro_revision_sources
  WHERE owner_id=v_owner AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.revision_id IS DISTINCT FROM p_revision_id OR v_existing.generation_id IS DISTINCT FROM p_generation_id
      OR v_existing.visualization_id IS DISTINCT FROM p_visualization_id OR v_existing.expected_updated_at IS DISTINCT FROM p_expected_updated_at
      OR v_existing.snapshot_hash IS DISTINCT FROM v_derived_hash OR v_existing.snapshot IS DISTINCT FROM p_snapshot
    THEN RAISE EXCEPTION 'revision_source_idempotency_conflict'; END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM public.designpro_revision_sources WHERE revision_id=p_revision_id) THEN RAISE EXCEPTION 'revision_source_identity_conflict'; END IF;
    INSERT INTO public.designpro_revision_sources(revision_id,owner_id,tenant_key,generation_id,visualization_id,expected_updated_at,snapshot,snapshot_hash,idempotency_key)
    VALUES(p_revision_id,v_owner,v_tenant,p_generation_id,p_visualization_id,p_expected_updated_at,p_snapshot,v_derived_hash,p_idempotency_key)
    RETURNING * INTO v_existing;
    v_created:=true;
  END IF;
  RETURN jsonb_build_object('revisionId',v_existing.revision_id,'ownerId',v_existing.owner_id,'tenantKey',v_existing.tenant_key,
    'snapshotHash',v_existing.snapshot_hash,'created',v_created,'idempotent',NOT v_created);
END $fn$;

REVOKE ALL ON FUNCTION public.save_designpro_revision_source(uuid,uuid,uuid,timestamptz,jsonb,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_designpro_revision_source(uuid,uuid,uuid,timestamptz,jsonb,text,text) TO authenticated;
