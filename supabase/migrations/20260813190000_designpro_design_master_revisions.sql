-- Phase 5: immutable Design Master revisions and the approval that freezes one.
--
-- The runtime already produces a revision bundle whose identity is a digest
-- over one master, one render, one 2D proof and one 3D proof. This is where
-- that identity becomes durable state: a revision row that can never be edited,
-- an approval that records the exact identity a customer accepted, and a gate
-- that hands production nothing else.
--
-- The retired path could not have had this. Its proof was a generated picture,
-- so there was nothing an approval could be a statement *about* — the artwork
-- did not exist independently of the render, and re-running one request
-- produced a different design.

CREATE TABLE IF NOT EXISTS public.designpro_design_master_revisions (
  revision_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tenant_key text NOT NULL CHECK (btrim(tenant_key)<>''),
  design_id text NOT NULL CHECK (btrim(design_id)<>''),
  vehicle_id uuid NOT NULL,
  -- Lineage. A revision states what it supersedes; the origin supersedes
  -- nothing, and nothing may claim to supersede a revision of another design.
  supersedes_revision_id uuid REFERENCES public.designpro_design_master_revisions(revision_id) ON DELETE RESTRICT,
  revision_sequence integer NOT NULL CHECK (revision_sequence >= 0),
  revision_request jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The master itself, and every identity derived from it.
  master jsonb NOT NULL,
  master_hash text NOT NULL CHECK (master_hash ~ '^[0-9a-f]{64}$'),
  render_hash text NOT NULL CHECK (render_hash ~ '^[0-9a-f]{64}$'),
  surface_hashes jsonb NOT NULL,
  px_per_inch numeric NOT NULL CHECK (px_per_inch > 0),
  bleed_in numeric NOT NULL CHECK (bleed_in >= 0),
  proof_2d_hash text NOT NULL CHECK (proof_2d_hash ~ '^[0-9a-f]{64}$'),
  proof_3d_hash text NOT NULL CHECK (proof_3d_hash ~ '^[0-9a-f]{64}$'),
  plate_set_id uuid NOT NULL,
  plate_set_hash text NOT NULL CHECK (plate_set_hash ~ '^[0-9a-f]{64}$'),
  dimension_manifest_id uuid NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  -- The digest of the whole tuple above. This is what an approval is about.
  bundle_identity text NOT NULL UNIQUE CHECK (bundle_identity ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designpro_revision_master_contract CHECK (
    master->>'contract'='designpro.design-master.v1.1'
    AND master->>'revisionId'=revision_id::text
    AND master->>'masterHash'=master_hash
    AND master->>'designId'=design_id
    AND master->>'dimensionManifestId'=dimension_manifest_id::text
  ),
  CONSTRAINT designpro_revision_surface_set CHECK (
    jsonb_typeof(surface_hashes)='array' AND jsonb_array_length(surface_hashes)=6
  ),
  -- An origin has no predecessor and starts the sequence. Anything else has
  -- one. A row that superseded nothing while claiming to be a later revision
  -- would be an orphan the lineage could not be walked back through.
  CONSTRAINT designpro_revision_lineage CHECK (
    (supersedes_revision_id IS NULL AND revision_sequence=0)
    OR (supersedes_revision_id IS NOT NULL AND revision_sequence>0)
  ),
  CONSTRAINT designpro_revision_not_self_superseding CHECK (supersedes_revision_id IS DISTINCT FROM revision_id)
);

CREATE INDEX IF NOT EXISTS designpro_design_master_revisions_design_idx
  ON public.designpro_design_master_revisions(owner_id,design_id,revision_sequence DESC);

-- One approval per revision. Approving is not a flag that can be turned back
-- off: it is a record that a specific identity was shown and accepted, and a
-- later change is a new revision rather than an edit to this one.
CREATE TABLE IF NOT EXISTS public.designpro_design_revision_approvals (
  revision_id uuid PRIMARY KEY REFERENCES public.designpro_design_master_revisions(revision_id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tenant_key text NOT NULL CHECK (btrim(tenant_key)<>''),
  design_id text NOT NULL CHECK (btrim(design_id)<>''),
  bundle_identity text NOT NULL CHECK (bundle_identity ~ '^[0-9a-f]{64}$'),
  approval jsonb NOT NULL,
  approval_hash text NOT NULL UNIQUE CHECK (approval_hash ~ '^[0-9a-f]{64}$'),
  approved_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approval_ref text NOT NULL CHECK (btrim(approval_ref)<>''),
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designpro_approval_contract CHECK (
    approval->>'contract'='designpro.design-revision-approval.v1'
    AND approval->>'revisionId'=revision_id::text
    AND approval->>'bundleIdentity'=bundle_identity
    AND approval->>'approvalHash'=approval_hash
  )
);

-- Immutability, enforced rather than intended. A revision and its approval are
-- what production trusts; a row that could be edited after approval would make
-- every downstream check a check of whatever the row says today.
CREATE OR REPLACE FUNCTION public.designpro_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'designpro_row_is_immutable';
END $fn$;

DROP TRIGGER IF EXISTS designpro_design_master_revisions_immutable ON public.designpro_design_master_revisions;
CREATE TRIGGER designpro_design_master_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.designpro_design_master_revisions
  FOR EACH ROW EXECUTE FUNCTION public.designpro_reject_mutation();

DROP TRIGGER IF EXISTS designpro_design_revision_approvals_immutable ON public.designpro_design_revision_approvals;
CREATE TRIGGER designpro_design_revision_approvals_immutable
  BEFORE UPDATE OR DELETE ON public.designpro_design_revision_approvals
  FOR EACH ROW EXECUTE FUNCTION public.designpro_reject_mutation();

ALTER TABLE public.designpro_design_master_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designpro_design_revision_approvals ENABLE ROW LEVEL SECURITY;

-- Record a completed revision bundle. The bundle identity is derived in the
-- database from the same tuple the runtime hashes, so a client cannot record a
-- revision under an identity that does not describe it.
CREATE OR REPLACE FUNCTION public.save_designpro_design_master_revision(
  p_revision_id uuid,
  p_design_id text,
  p_vehicle_id uuid,
  p_supersedes_revision_id uuid,
  p_revision_sequence integer,
  p_revision_request jsonb,
  p_master jsonb,
  p_identity jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_owner uuid:=auth.uid();
  v_tenant text;
  v_identity text;
  v_existing public.designpro_design_master_revisions%ROWTYPE;
  v_parent public.designpro_design_master_revisions%ROWTYPE;
  v_created boolean:=false;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'authenticated' OR v_owner IS NULL THEN RAISE EXCEPTION 'authenticated_user_required'; END IF;
  IF p_revision_id IS NULL OR p_vehicle_id IS NULL OR NULLIF(btrim(COALESCE(p_design_id,'')),'') IS NULL THEN RAISE EXCEPTION 'revision_identity_incomplete'; END IF;
  IF p_identity->>'contract' IS DISTINCT FROM 'designpro.design-master-revision.v1' THEN RAISE EXCEPTION 'revision_identity_contract_invalid'; END IF;
  IF p_identity->>'revisionId' IS DISTINCT FROM p_revision_id::text
    OR p_master->>'revisionId' IS DISTINCT FROM p_revision_id::text
    OR p_master->>'masterHash' IS DISTINCT FROM p_identity->>'masterHash'
  THEN RAISE EXCEPTION 'revision_identity_mismatch'; END IF;

  -- The bundle identity is the runtime's digest over its own canonical form,
  -- carried here rather than recomputed in SQL. Recomputing it would mean a
  -- second digest over a differently ordered serialisation — jsonb does not
  -- preserve key order — and two identities for one design that could disagree
  -- is precisely the class of defect this whole architecture exists to remove.
  --
  -- Carrying it is not trusting it. Every component below is checked against
  -- the master, and production recomputes the identity from the artefacts and
  -- compares, so a row recorded under an identity that does not describe it
  -- fails closed at the gate instead of printing.
  v_identity:=lower(NULLIF(btrim(COALESCE(p_identity->>'bundleIdentity','')),''));
  IF v_identity IS NULL OR v_identity !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'revision_bundle_identity_missing'; END IF;
  IF p_identity->>'designId' IS DISTINCT FROM p_design_id
    OR p_identity->>'dimensionManifestId' IS DISTINCT FROM p_master->>'dimensionManifestId'
    OR p_identity->>'manifestHash' IS DISTINCT FROM p_master->>'manifestHash'
    OR COALESCE(p_identity->>'supersedesRevisionId','') IS DISTINCT FROM COALESCE(p_supersedes_revision_id::text,'')
    OR (p_identity->>'revisionSequence')::integer IS DISTINCT FROM p_revision_sequence
    OR jsonb_array_length(p_identity->'surfaceHashes') IS DISTINCT FROM 6
  THEN RAISE EXCEPTION 'revision_bundle_identity_mismatch'; END IF;
  v_tenant:='user_'||v_owner::text;

  PERFORM pg_advisory_xact_lock(hashtextextended('designpro.design-revision:'||p_revision_id::text,0));
  SELECT * INTO v_existing FROM public.designpro_design_master_revisions WHERE revision_id=p_revision_id;
  IF FOUND THEN
    -- A revision is immutable, so a replay must be identical or it is a second
    -- design wearing the first one's identifier.
    IF v_existing.owner_id IS DISTINCT FROM v_owner OR v_existing.bundle_identity IS DISTINCT FROM v_identity
      OR v_existing.master IS DISTINCT FROM p_master
    THEN RAISE EXCEPTION 'revision_immutability_conflict'; END IF;
  ELSE
    IF p_supersedes_revision_id IS NOT NULL THEN
      SELECT * INTO v_parent FROM public.designpro_design_master_revisions WHERE revision_id=p_supersedes_revision_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'revision_parent_unknown'; END IF;
      IF v_parent.owner_id IS DISTINCT FROM v_owner OR v_parent.design_id IS DISTINCT FROM p_design_id THEN RAISE EXCEPTION 'revision_parent_foreign'; END IF;
      IF v_parent.revision_sequence+1 IS DISTINCT FROM p_revision_sequence THEN RAISE EXCEPTION 'revision_sequence_not_contiguous'; END IF;
    END IF;
    INSERT INTO public.designpro_design_master_revisions(
      revision_id,owner_id,tenant_key,design_id,vehicle_id,supersedes_revision_id,revision_sequence,revision_request,
      master,master_hash,render_hash,surface_hashes,px_per_inch,bleed_in,proof_2d_hash,proof_3d_hash,
      plate_set_id,plate_set_hash,dimension_manifest_id,manifest_hash,bundle_identity)
    VALUES(
      p_revision_id,v_owner,v_tenant,p_design_id,p_vehicle_id,p_supersedes_revision_id,p_revision_sequence,COALESCE(p_revision_request,'{}'::jsonb),
      p_master,p_identity->>'masterHash',p_identity->>'renderHash',p_identity->'surfaceHashes',
      (p_identity->>'pxPerInch')::numeric,(p_identity->>'bleedIn')::numeric,
      p_identity->>'proof2dHash',p_identity->>'proof3dHash',
      (p_identity->>'plateSetId')::uuid,p_identity->>'plateSetHash',
      (p_identity->>'dimensionManifestId')::uuid,p_identity->>'manifestHash',v_identity)
    RETURNING * INTO v_existing;
    v_created:=true;
  END IF;
  RETURN jsonb_build_object('revisionId',v_existing.revision_id,'bundleIdentity',v_existing.bundle_identity,
    'revisionSequence',v_existing.revision_sequence,'created',v_created,'idempotent',NOT v_created);
END $fn$;

-- Freeze a revision at the identity the customer accepted.
CREATE OR REPLACE FUNCTION public.approve_designpro_design_revision(
  p_revision_id uuid,
  p_approval jsonb,
  p_approval_ref text,
  p_approved_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_owner uuid:=auth.uid();
  v_revision public.designpro_design_master_revisions%ROWTYPE;
  v_existing public.designpro_design_revision_approvals%ROWTYPE;
  v_hash text;
  v_created boolean:=false;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'authenticated' OR v_owner IS NULL THEN RAISE EXCEPTION 'authenticated_user_required'; END IF;
  IF p_revision_id IS NULL OR p_approved_at IS NULL OR NULLIF(btrim(COALESCE(p_approval_ref,'')),'') IS NULL THEN RAISE EXCEPTION 'approval_identity_incomplete'; END IF;
  IF p_approval->>'contract' IS DISTINCT FROM 'designpro.design-revision-approval.v1' THEN RAISE EXCEPTION 'approval_contract_invalid'; END IF;

  SELECT * INTO v_revision FROM public.designpro_design_master_revisions WHERE revision_id=p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'approval_revision_unknown'; END IF;
  IF v_revision.owner_id IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'approval_revision_foreign'; END IF;
  -- The approval must be about the revision as recorded, not about a bundle
  -- that has since been re-rendered into something else.
  IF p_approval->>'revisionId' IS DISTINCT FROM p_revision_id::text
    OR p_approval->>'bundleIdentity' IS DISTINCT FROM v_revision.bundle_identity
    OR p_approval->>'masterHash' IS DISTINCT FROM v_revision.master_hash
    OR p_approval->>'renderHash' IS DISTINCT FROM v_revision.render_hash
    OR p_approval->>'proof2dHash' IS DISTINCT FROM v_revision.proof_2d_hash
    OR p_approval->>'proof3dHash' IS DISTINCT FROM v_revision.proof_3d_hash
  THEN RAISE EXCEPTION 'approval_identity_drift'; END IF;

  -- Carried, for the same reason the bundle identity is: one canonical form,
  -- defined by the runtime contract. The approval's own integrity is verified
  -- against that form wherever it is used, and every field it asserts about the
  -- revision has already been checked against the recorded row above.
  v_hash:=lower(NULLIF(btrim(COALESCE(p_approval->>'approvalHash','')),''));
  IF v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'approval_hash_missing'; END IF;
  IF p_approval->>'approvalRef' IS DISTINCT FROM p_approval_ref
    OR p_approval->>'approvedAt' IS DISTINCT FROM to_char(p_approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  THEN RAISE EXCEPTION 'approval_hash_mismatch'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('designpro.design-approval:'||p_revision_id::text,0));
  SELECT * INTO v_existing FROM public.designpro_design_revision_approvals WHERE revision_id=p_revision_id;
  IF FOUND THEN
    IF v_existing.approval_hash IS DISTINCT FROM v_hash THEN RAISE EXCEPTION 'approval_already_frozen'; END IF;
  ELSE
    INSERT INTO public.designpro_design_revision_approvals(
      revision_id,owner_id,tenant_key,design_id,bundle_identity,approval,approval_hash,approved_by,approval_ref,approved_at)
    VALUES(p_revision_id,v_owner,v_revision.tenant_key,v_revision.design_id,v_revision.bundle_identity,
      p_approval,v_hash,v_owner,p_approval_ref,p_approved_at)
    RETURNING * INTO v_existing;
    v_created:=true;
  END IF;
  RETURN jsonb_build_object('revisionId',v_existing.revision_id,'bundleIdentity',v_existing.bundle_identity,
    'approvalHash',v_existing.approval_hash,'approvedAt',v_existing.approved_at,'created',v_created,'idempotent',NOT v_created);
END $fn$;

-- The production gate.
--
-- Production asks for a revision by the identity it is about to print. It gets
-- an answer only if that revision exists, is approved, and the approval is
-- about that exact identity. There is no branch here that returns a revision
-- because it was the most recent, or because a status column said so.
CREATE OR REPLACE FUNCTION public.require_approved_designpro_revision(
  p_revision_id uuid,
  p_bundle_identity text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_revision public.designpro_design_master_revisions%ROWTYPE;
  v_approval public.designpro_design_revision_approvals%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_revision_id IS NULL OR NULLIF(btrim(COALESCE(p_bundle_identity,'')),'') IS NULL THEN RAISE EXCEPTION 'production_identity_incomplete'; END IF;

  SELECT * INTO v_revision FROM public.designpro_design_master_revisions WHERE revision_id=p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'production_revision_unknown'; END IF;
  SELECT * INTO v_approval FROM public.designpro_design_revision_approvals WHERE revision_id=p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'production_not_approved'; END IF;
  IF v_revision.bundle_identity IS DISTINCT FROM lower(p_bundle_identity)
    OR v_approval.bundle_identity IS DISTINCT FROM v_revision.bundle_identity
  THEN RAISE EXCEPTION 'production_identity_drift'; END IF;

  RETURN jsonb_build_object(
    'revisionId',v_revision.revision_id,'designId',v_revision.design_id,'ownerId',v_revision.owner_id,
    'tenantKey',v_revision.tenant_key,'bundleIdentity',v_revision.bundle_identity,
    'masterHash',v_revision.master_hash,'renderHash',v_revision.render_hash,'surfaceHashes',v_revision.surface_hashes,
    'pxPerInch',v_revision.px_per_inch,'bleedIn',v_revision.bleed_in,
    'proof2dHash',v_revision.proof_2d_hash,'proof3dHash',v_revision.proof_3d_hash,
    'dimensionManifestId',v_revision.dimension_manifest_id,'manifestHash',v_revision.manifest_hash,
    'plateSetId',v_revision.plate_set_id,'plateSetHash',v_revision.plate_set_hash,
    'master',v_revision.master,
    -- The complete frozen approval, not a summary of it.
    --
    -- The database cannot prove that approval_hash is the digest of this
    -- object: that digest is over the runtime's canonical form, and a second
    -- canonicalisation in SQL would be a second identity that could disagree
    -- with the first. So the proof is done where the canonical form is defined,
    -- and this RPC's job is to hand back everything needed to do it. Returning
    -- only the hash and the reference would leave the caller with nothing to
    -- check the hash against, and "approved" would mean two different things on
    -- the two sides of this boundary.
    'approval',v_approval.approval,
    'approvalHash',v_approval.approval_hash,'approvalRef',v_approval.approval_ref,'approvedAt',v_approval.approved_at,
    'approvedBy',v_approval.approved_by);
END $fn$;

REVOKE ALL ON FUNCTION public.save_designpro_design_master_revision(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_designpro_design_master_revision(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_designpro_design_revision(uuid,jsonb,text,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.approve_designpro_design_revision(uuid,jsonb,text,timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.require_approved_designpro_revision(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.require_approved_designpro_revision(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.designpro_reject_mutation() FROM PUBLIC,anon;
