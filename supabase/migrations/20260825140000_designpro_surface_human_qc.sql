-- CARLEY'S CHECKLIST, ON THE SERVER, BOUND TO THE EXACT FILE SHE INSPECTED.
--
-- PanelPro asks the design authority to verify each of the six surfaces against
-- a real vehicle template before anything prints. Until now those answers lived
-- in React state: a reload erased them, nobody else could see them, and the only
-- durable record was six booleans submitted at the release gate. Whether anyone
-- had looked at the rear panel was not written down anywhere.
--
-- THE ROW IS KEYED BY THE ARTIFACT HASH, AND THAT IS THE WHOLE VERSION-SAFETY
-- PROPERTY. A corrected or re-uploaded panel is different bytes, so it hashes
-- differently, so it has no row -- its checklist is empty by construction and
-- there is no code path that could inherit the previous file's approval. No
-- reset logic to forget to call, no trigger to get wrong: a new file simply has
-- never been checked, because it has not been.
--
-- The checklist is the human half only. Lineage, dimensions-vs-record and
-- effective DPI are computed from the artifacts themselves and are asserted
-- server-side at the release gate; they are not questions to ask a browser.
-- What is recorded here is what only a person standing at a vehicle template
-- can answer.

CREATE TABLE IF NOT EXISTS public.designpro_surface_qc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  surface_key text NOT NULL,
  -- The exact bytes inspected. A corrected panel changes this, which is what
  -- makes the checklist start empty for it.
  artifact_hash text NOT NULL,
  artifact_id uuid,
  -- The A.T.L.A.S. version the panel was cut from, recorded so an approval can
  -- never be read as applying to a different design revision.
  atlas_revision_id uuid,
  atlas_master_hash text,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved boolean NOT NULL DEFAULT false,
  needs_correction boolean NOT NULL DEFAULT false,
  correction_reason text,
  checked_by uuid NOT NULL,
  checked_by_name text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT designpro_surface_qc_surface CHECK (
    surface_key IN ('driver','passenger','hood','roof','front','rear')
  ),
  CONSTRAINT designpro_surface_qc_hash CHECK (artifact_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT designpro_surface_qc_checks_object CHECK (
    pg_catalog.jsonb_typeof(checks) = 'object'
  ),
  -- Approved and needs-correction are opposite states, never both.
  CONSTRAINT designpro_surface_qc_state CHECK (NOT (approved AND needs_correction)),
  CONSTRAINT designpro_surface_qc_reason CHECK (
    NOT needs_correction OR NULLIF(pg_catalog.btrim(COALESCE(correction_reason,'')),'') IS NOT NULL
  )
);

-- One live checklist per (generation, surface, exact file).
CREATE UNIQUE INDEX IF NOT EXISTS designpro_surface_qc_identity
  ON public.designpro_surface_qc(generation_id, surface_key, artifact_hash);
CREATE INDEX IF NOT EXISTS designpro_surface_qc_generation
  ON public.designpro_surface_qc(generation_id);

ALTER TABLE public.designpro_surface_qc ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS designpro_surface_qc_owner_read ON public.designpro_surface_qc;
CREATE POLICY designpro_surface_qc_owner_read ON public.designpro_surface_qc
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.designpro_qc_members q
      WHERE q.user_id = auth.uid() AND q.can_preflight
    )
  );

-- Writes go through the RPC only. A direct insert could name any hash, any
-- surface and any checker.
REVOKE INSERT, UPDATE, DELETE ON public.designpro_surface_qc FROM authenticated, anon;

/**
 * Record one surface's human QC against one exact file.
 *
 * The thirteen checks are the gateway's and the board's shared list. Every one
 * must be present and true before `approved` may be set -- the RPC refuses the
 * approval rather than storing a half-finished one, so APPROVE SURFACE cannot be
 * made to succeed by a caller that skipped the checklist.
 */
CREATE OR REPLACE FUNCTION public.record_designpro_surface_qc(
  p_generation_id uuid,
  p_surface_key text,
  p_artifact_hash text,
  p_artifact_id uuid,
  p_atlas_revision_id uuid,
  p_atlas_master_hash text,
  p_checks jsonb,
  p_approved boolean,
  p_needs_correction boolean,
  p_correction_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_name text;
  v_owner uuid;
  v_required text[] := ARRAY[
    'template','surface','version','fit','safeArea','openings','trimDims',
    'printDims','bleed','dpi','customerText','artworkIntact','finalFileInspected'
  ];
  v_check text;
  v_row public.designpro_surface_qc%ROWTYPE;
BEGIN
  IF v_actor IS NULL
    OR COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'authenticated'
    OR COALESCE(auth.jwt()->>'is_anonymous','false')='true'
  THEN RAISE EXCEPTION 'authentication_required'; END IF;

  IF p_surface_key NOT IN ('driver','passenger','hood','roof','front','rear')
  THEN RAISE EXCEPTION 'surface_key_invalid'; END IF;
  IF COALESCE(pg_catalog.lower(p_artifact_hash),'') !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'artifact_hash_invalid'; END IF;
  IF pg_catalog.jsonb_typeof(COALESCE(p_checks,'null'::jsonb)) <> 'object'
  THEN RAISE EXCEPTION 'qc_checks_invalid'; END IF;
  IF p_approved AND p_needs_correction
  THEN RAISE EXCEPTION 'qc_state_contradictory'; END IF;

  -- The caller must own the generation. This is the same ownership the request
  -- itself proves, so a QC member cannot record against someone else's design
  -- by guessing an id.
  SELECT owner_id INTO v_owner
  FROM public.designpro_generation_requests
  WHERE generation_id = p_generation_id
  ORDER BY created_at DESC LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'generation_not_visible'; END IF;
  IF v_owner IS DISTINCT FROM v_actor
    AND NOT EXISTS (
      SELECT 1 FROM public.designpro_qc_members q
      WHERE q.user_id = v_actor AND q.can_preflight
    )
  THEN RAISE EXCEPTION 'qc_permission_required'; END IF;

  -- Approval identity comes from the confirmed account, never from anything a
  -- user can edit about themselves.
  SELECT COALESCE(
    NULLIF(pg_catalog.btrim(raw_app_meta_data->>'display_name'),''),
    NULLIF(pg_catalog.btrim(email),''), v_actor::text
  ) INTO v_name
  FROM auth.users WHERE id = v_actor AND email_confirmed_at IS NOT NULL;
  IF NULLIF(pg_catalog.btrim(COALESCE(v_name,'')),'') IS NULL
  THEN RAISE EXCEPTION 'qc_actor_identity_unresolvable'; END IF;

  -- APPROVE SURFACE means the whole checklist, or it means nothing.
  IF p_approved THEN
    FOREACH v_check IN ARRAY v_required LOOP
      IF COALESCE((p_checks->>v_check)::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'surface_qc_incomplete: %', v_check;
      END IF;
    END LOOP;
  END IF;
  IF p_needs_correction
    AND NULLIF(pg_catalog.btrim(COALESCE(p_correction_reason,'')),'') IS NULL
  THEN RAISE EXCEPTION 'correction_reason_required'; END IF;

  INSERT INTO public.designpro_surface_qc(
    generation_id, owner_id, surface_key, artifact_hash, artifact_id,
    atlas_revision_id, atlas_master_hash, checks, approved, needs_correction,
    correction_reason, checked_by, checked_by_name, checked_at
  ) VALUES (
    p_generation_id, v_owner, p_surface_key, pg_catalog.lower(p_artifact_hash),
    p_artifact_id, p_atlas_revision_id, pg_catalog.lower(NULLIF(p_atlas_master_hash,'')),
    p_checks, p_approved, p_needs_correction,
    NULLIF(pg_catalog.btrim(COALESCE(p_correction_reason,'')),''),
    v_actor, v_name, clock_timestamp()
  )
  ON CONFLICT (generation_id, surface_key, artifact_hash) DO UPDATE SET
    checks = EXCLUDED.checks,
    approved = EXCLUDED.approved,
    needs_correction = EXCLUDED.needs_correction,
    correction_reason = EXCLUDED.correction_reason,
    artifact_id = COALESCE(EXCLUDED.artifact_id, public.designpro_surface_qc.artifact_id),
    atlas_revision_id = COALESCE(EXCLUDED.atlas_revision_id, public.designpro_surface_qc.atlas_revision_id),
    atlas_master_hash = COALESCE(EXCLUDED.atlas_master_hash, public.designpro_surface_qc.atlas_master_hash),
    checked_by = EXCLUDED.checked_by,
    checked_by_name = EXCLUDED.checked_by_name,
    checked_at = EXCLUDED.checked_at
  RETURNING * INTO v_row;

  RETURN pg_catalog.jsonb_build_object(
    'generationId', v_row.generation_id,
    'surfaceKey', v_row.surface_key,
    'artifactHash', v_row.artifact_hash,
    'atlasRevisionId', v_row.atlas_revision_id,
    'atlasMasterHash', v_row.atlas_master_hash,
    'checks', v_row.checks,
    'approved', v_row.approved,
    'needsCorrection', v_row.needs_correction,
    'correctionReason', v_row.correction_reason,
    'checkedBy', v_row.checked_by,
    'checkedByName', v_row.checked_by_name,
    'checkedAt', v_row.checked_at
  );
END
$fn$;

/** Every surface checklist recorded for one generation, newest per file. */
CREATE OR REPLACE FUNCTION public.get_designpro_surface_qc(p_generation_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'generationId', q.generation_id,
    'surfaceKey', q.surface_key,
    'artifactHash', q.artifact_hash,
    'atlasRevisionId', q.atlas_revision_id,
    'atlasMasterHash', q.atlas_master_hash,
    'checks', q.checks,
    'approved', q.approved,
    'needsCorrection', q.needs_correction,
    'correctionReason', q.correction_reason,
    'checkedBy', q.checked_by,
    'checkedByName', q.checked_by_name,
    'checkedAt', q.checked_at
  ) ORDER BY q.checked_at DESC), '[]'::jsonb)
  FROM public.designpro_surface_qc q
  WHERE q.generation_id = p_generation_id
    AND (
      q.owner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.designpro_qc_members m
        WHERE m.user_id = auth.uid() AND m.can_preflight
      )
    );
$fn$;

REVOKE ALL ON FUNCTION public.record_designpro_surface_qc(
  uuid,text,text,uuid,uuid,text,jsonb,boolean,boolean,text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_designpro_surface_qc(
  uuid,text,text,uuid,uuid,text,jsonb,boolean,boolean,text
) TO authenticated;
REVOKE ALL ON FUNCTION public.get_designpro_surface_qc(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_designpro_surface_qc(uuid) TO authenticated;
