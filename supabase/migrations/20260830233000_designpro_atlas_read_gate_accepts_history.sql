-- A.T.L.A.S. READS ARE NOT AUTHORING REUSE.
--
-- The live owner-read gate was still pinned to the retired v10 authoring
-- prompt. A current v13-neutral-fields master and all seven accepted proofs
-- therefore persisted correctly, then the read boundary rewrote the completed
-- request as `flat_first_atlas_new_run_required`. The result was a red canary
-- and a valid A.T.L.A.S. hidden from DesignProAI and PanelPro Studio.
--
-- Exact prompt-version fencing belongs in runtime/flat-first-atlas.cjs when an
-- old master is REUSED for new authoring. A read validates immutable lineage,
-- hashes, producer provenance and QC, but it must accept every version in the
-- A.T.L.A.S. prompt family. Otherwise every prompt bump erases valid history.
--
-- PATCH, DO NOT RESTATE. The live function contains later producer, panel,
-- acceptance and partial-publication repairs. Re-emitting an older copy would
-- silently revert those repairs.

DO $atlas_historical_reads$
DECLARE
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_exact_pin constant text := E'v_atlas.prompt_version IS DISTINCT FROM\n      ''designpro-flat-first-atlas-20260827.v10-edge''';
  v_family_gate constant text := E'COALESCE(v_atlas.prompt_version,'''') !~\n      ''^designpro-flat-first-atlas-[A-Za-z0-9._-]{1,96}$''';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'atlas_historical_read_gate_target_missing';
  END IF;

  -- Idempotent when a shadow/recovery apply has already installed the family
  -- check. An exact prompt value may still appear in this migration's verify
  -- prose, but it may not survive in the live predicate.
  IF pg_catalog.strpos(v_definition, v_family_gate) > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_exact_pin, '')))
    / pg_catalog.length(v_exact_pin);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'atlas_historical_read_prompt_pin_fragment: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_exact_pin, v_family_gate);

  IF pg_catalog.strpos(v_patched, v_exact_pin) > 0
    OR pg_catalog.strpos(v_patched, v_family_gate) = 0
  THEN
    RAISE EXCEPTION 'atlas_historical_read_prompt_family_not_installed';
  END IF;

  -- Preserve the fail-closed evidence checks. This change removes only the
  -- authoring-version pin from the read path; it does not weaken identity,
  -- producer, panel authority, master acceptance or semantic QC.
  IF pg_catalog.strpos(v_patched, 'masterAcceptance') = 0
    OR pg_catalog.strpos(v_patched, 'masterPromptHash') = 0
    OR pg_catalog.strpos(v_patched, 'masterExampleSetHash') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-panel-authority.v1') = 0
    OR pg_catalog.strpos(v_patched, 'persona-photographer-render') = 0
    OR pg_catalog.strpos(v_patched, 'edge-photographer') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-proof-semantic-qc.v1') = 0
    OR pg_catalog.strpos(v_patched, 'panelSourceHash') = 0
    OR pg_catalog.strpos(v_patched, 'v_valid_count=v_count') = 0
  THEN
    RAISE EXCEPTION 'atlas_historical_read_lineage_context_lost';
  END IF;

  EXECUTE v_patched;
END
$atlas_historical_reads$;

-- Evaluate the repaired predicate over the newest completed A.T.L.A.S. that
-- carries the current photographer evidence. This is the exact data shape the
-- production canary writes. Empty databases and shadow schemas safely skip it.
DO $verify_atlas_historical_reads$
DECLARE
  v_request uuid;
BEGIN
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  )), '^designpro-flat-first-atlas-[A-Za-z0-9._-]{1,96}$') = 0
  THEN
    RAISE EXCEPTION 'atlas_historical_read_gate_not_installed';
  END IF;

  SELECT r.id INTO v_request
  FROM public.designpro_generation_requests r
  JOIN public.designpro_flat_atlas_revisions a ON a.request_id=r.id
  WHERE r.request_input->>'pipelineMode'='flat-first-atlas-v1'
    AND a.prompt_version ~ '^designpro-flat-first-atlas-[A-Za-z0-9._-]{1,96}$'
    AND a.metadata->>'masterQcPassed'='true'
    AND EXISTS (
      SELECT 1 FROM public.designpro_generation_views v
      WHERE v.request_id=r.id AND v.superseded_at IS NULL
        AND v.metadata#>>'{provider,stage}'='persona-photographer-render'
    )
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_request IS NULL THEN RETURN; END IF;
  IF NOT designpro_private.flat_first_atlas_view_set_valid(v_request) THEN
    RAISE EXCEPTION 'newest_accepted_atlas_is_not_readable: %', v_request;
  END IF;
  IF designpro_private.flat_first_atlas_requires_new_run(v_request) THEN
    RAISE EXCEPTION 'newest_accepted_atlas_was_superseded: %', v_request;
  END IF;
END
$verify_atlas_historical_reads$;

