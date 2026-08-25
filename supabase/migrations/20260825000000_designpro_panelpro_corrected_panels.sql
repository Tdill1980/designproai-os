-- THE HUMAN CORRECTION PATH. NO MANUAL GENERATION; AUDITED MANUAL CORRECTION.
--
-- PanelPro's QC is a physical check: a designer downloads the panel, lays it on
-- the real vehicle template, and confirms it will actually fit. When it does not
-- fit, the team has always been able to correct the file and put the corrected
-- one back into production. Nothing here restores the browser-era producers --
-- "Pull panel" and "Mirror from driver" BUILT panels in a tab from whatever
-- happened to be on screen, and they stay gone. This records a file a human
-- corrected against a real template, against the exact surface and revision it
-- replaces, with both versions kept.
--
-- Three properties make that safe rather than a second producer:
--
--   1. THE CALL 9 PANEL IS NEVER TOUCHED. A correction is its own artifact of
--      its own kind. The branded production panel stays byte-for-byte, keeps
--      its hash, and is still what `source.verify` counts -- exactly the rule
--      Call 11's de-logo set follows.
--   2. THE CORRECTION IS BOUND TO WHAT IT REPLACES. Every row carries the
--      corrected panel's storage path and content hash, the master that panel
--      was cut from, who uploaded it, when, and why. A correction with nothing
--      to correct is refused.
--   3. THE HISTORY IS ADDITIVE. Correcting twice keeps both; the newest is the
--      active production artifact and the earlier ones remain readable. Nothing
--      is overwritten and nothing disappears.
--
-- Where it lands in the chain: the correction is recorded against the run's own
-- await_panelpro_preflight_qc stage, because that gate is what it exists for.
-- Call 12 enhances the active artifact per surface -- the correction when one
-- exists, the branded panel otherwise -- so a corrected panel reaches print the
-- same way an uncorrected one does, through Topaz and the output build, never
-- around them.

-- 1. The new artifact kind. Additive: every existing kind keeps its place, and
--    the constraint is replaced wholesale because a CHECK cannot be extended.
ALTER TABLE public.designpro_artifacts
  DROP CONSTRAINT IF EXISTS designpro_artifacts_artifact_kind_check;
ALTER TABLE public.designpro_artifacts
  ADD CONSTRAINT designpro_artifacts_artifact_kind_check CHECK (artifact_kind IN (
    'flat-proof','panel','qc-panel','corrected-panel','upscaled-panel','logo','output','stamp','zip','wrapbox-manifest'
  ));

-- 2. Where a corrected panel is allowed to live.
--
-- Server-produced artifacts sit under the run's own prefix, which a browser
-- cannot write to. A corrected panel arrives from a designer's machine through
-- the same owner-scoped upload path every customer-supplied file uses, so it is
-- admitted there and nowhere else -- the same exception `logo` already has, for
-- the same reason. Everything else in this function is the 20260806180700 body
-- verbatim; only the final branch widens by one kind.
CREATE OR REPLACE FUNCTION designpro_private.enforce_artifact_storage_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_ok boolean := false;
BEGIN
  SELECT * INTO v_run
  FROM public.designpro_workflow_runs
  WHERE id = NEW.run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'artifact_workflow_missing';
  END IF;

  v_ok := (
    split_part(NEW.storage_path,'/',1) = 'designpro'
    AND split_part(NEW.storage_path,'/',2) = v_run.tenant_key
    AND split_part(NEW.storage_path,'/',3) = v_run.id::text
  ) OR (
    split_part(NEW.storage_path,'/',1) = 'wrapbox'
    AND split_part(NEW.storage_path,'/',2) = v_run.tenant_key
    AND split_part(NEW.storage_path,'/',3) = v_run.entice_pack_id::text
    AND split_part(NEW.storage_path,'/',4) = v_run.id::text
  ) OR (
    NEW.artifact_kind IN ('logo','corrected-panel')
    AND split_part(NEW.storage_path,'/',1) = 'users'
    AND split_part(NEW.storage_path,'/',2) = v_run.owner_id::text
    AND split_part(NEW.storage_path,'/',3) = 'revisions'
    AND split_part(NEW.storage_path,'/',4) = v_run.revision_id::text
    AND split_part(NEW.storage_path,'/',5) = 'inputs'
  );

  IF NOT v_ok
    OR NEW.storage_path LIKE '/%'
    OR NEW.storage_path LIKE '%..%'
    OR NEW.storage_path !~ '^[A-Za-z0-9._/-]+$'
  THEN
    RAISE EXCEPTION 'artifact_storage_identity_mismatch';
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION designpro_private.enforce_artifact_storage_identity() FROM PUBLIC,anon,authenticated;

-- 3. Recording one correction.
--
-- The owner of the run may call this; nobody else can, and the fence is the
-- same owner-or-service-role shape every other DesignPro RPC uses. It refuses a
-- correction that has nothing to correct, a surface that is not one of the six,
-- and a file that is not in the caller's own verified upload namespace -- the
-- storage trigger above enforces that last one again at write time.
CREATE OR REPLACE FUNCTION public.record_designpro_corrected_panel(
  p_generation_id uuid,
  p_surface_key text,
  p_asset jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_stage_id uuid;
  v_panel public.designpro_artifacts%ROWTYPE;
  v_hash text := lower(COALESCE(p_asset->>'contentHash',''));
  v_path text := COALESCE(p_asset->>'storagePath','');
  v_bytes bigint := NULLIF(p_asset->>'byteSize','')::bigint;
  v_type text := lower(COALESCE(p_asset->>'contentType',''));
  v_reason text := btrim(COALESCE(p_reason,''));
  v_id uuid;
BEGIN
  IF p_surface_key IS NULL OR p_surface_key NOT IN ('driver','passenger','hood','roof','front','rear') THEN
    RAISE EXCEPTION 'corrected_panel_surface_invalid';
  END IF;
  IF v_hash !~ '^[0-9a-f]{64}$' OR btrim(v_path) = '' OR v_bytes IS NULL OR v_bytes < 1 THEN
    RAISE EXCEPTION 'corrected_panel_asset_invalid';
  END IF;
  -- A correction has to say what was wrong with the panel it replaces. That is
  -- the audit trail, and a blank one is not one.
  IF length(v_reason) < 8 THEN
    RAISE EXCEPTION 'corrected_panel_reason_required';
  END IF;

  -- The production run for this design, newest first: a revision mints a new
  -- run against the same generation, and a correction belongs to the run whose
  -- panels are being validated now.
  SELECT * INTO v_run
  FROM public.designpro_workflow_runs
  WHERE results->>'generationId' = p_generation_id::text
  ORDER BY created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'corrected_panel_run_missing'; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
    AND v_run.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'workflow_owner_required';
  END IF;

  -- The branded Call 9 panel this corrects. Its absence is not a reason to
  -- accept the upload anyway: with nothing to bind to, a corrected panel is
  -- just an unattributed image entering the production set.
  SELECT * INTO v_panel
  FROM public.designpro_artifacts
  WHERE run_id = v_run.id AND artifact_kind = 'panel' AND surface_key = p_surface_key
  ORDER BY created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'corrected_panel_source_missing'; END IF;

  -- The gate the correction exists for.
  SELECT id INTO v_stage_id
  FROM public.designpro_workflow_stages
  WHERE run_id = v_run.id AND stage_key = 'await_panelpro_preflight_qc'
  LIMIT 1;
  IF v_stage_id IS NULL THEN RAISE EXCEPTION 'corrected_panel_stage_missing'; END IF;

  INSERT INTO public.designpro_artifacts(
    run_id, stage_id, artifact_kind, surface_key, storage_path, content_hash, byte_size, metadata
  ) VALUES (
    v_run.id, v_stage_id, 'corrected-panel', p_surface_key, v_path, v_hash, v_bytes,
    jsonb_build_object(
      'contract','designpro.corrected-panel.v1',
      'reason', v_reason,
      'contentType', v_type,
      'correctedFromPath', v_panel.storage_path,
      'correctedFromHash', v_panel.content_hash,
      'sourceMasterHash', v_panel.metadata->>'sourceMasterHash',
      'revisionId', v_run.revision_id,
      'correctedBy', COALESCE(auth.uid()::text, 'service_role'),
      'correctedAt', to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
  -- Re-uploading the identical file for the same surface is the same
  -- correction, not a second one.
  ON CONFLICT (run_id, artifact_kind, surface_key, content_hash) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.designpro_artifacts
    WHERE run_id = v_run.id AND artifact_kind = 'corrected-panel'
      AND surface_key = p_surface_key AND content_hash = v_hash;
    RETURN jsonb_build_object('artifactId', v_id, 'surfaceKey', p_surface_key, 'idempotent', true,
      'correctedFromHash', v_panel.content_hash);
  END IF;

  RETURN jsonb_build_object('artifactId', v_id, 'surfaceKey', p_surface_key, 'idempotent', false,
    'correctedFromHash', v_panel.content_hash);
END
$fn$;

REVOKE ALL ON FUNCTION public.record_designpro_corrected_panel(uuid,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_designpro_corrected_panel(uuid,text,jsonb,text) TO authenticated, service_role;
