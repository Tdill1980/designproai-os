-- The frozen revision snapshot carries the three-zone panel proof for EVERY
-- accepted v3 handoff, not only for a brief that uploaded a logo.
--
-- Measured on the live project, 2026-09-21, three entice runs (52a75e92,
-- d4ccc8ca, 07d6c1cf): each revision's metadata carries a
-- `designpro.atlas-panel-proof-topology.v2` proof, and each frozen
-- `designpro_revision_sources.snapshot` carries NONE of it --
-- `expectedLogoInventory: []`, attestation `none`, no `panelProofAuthoring`.
-- The one run with a logo (5e2fef84) carries the proof and a five-entry
-- inventory. The difference is a brace: 20260920022906 put BOTH the print
-- master lookup (`v_logo_atlas`) and the snapshot attach inside
-- `IF v_logo IS NOT NULL`, so a brief with no logo never resolved the master
-- and the attach guard (`v_logo_atlas.id IS NOT NULL`) was false by
-- construction. Downstream, `panels.delogo` (Call 11) finds no frozen Zone 2
-- and falls back to AI locate, and `zip.build` packages no three-zone proof.
--
-- What moves, and what does not:
--   * the print-master lookup keyed by `engine_receipt.atlasRevisionId` runs
--     for every handoff; when NO logo was supplied and the receipt names no
--     row, the request's newest QC-passed print master is used instead (a
--     request holds at most one -- the (owner, generation, revision_sequence)
--     index -- so "newest" is the request's own row);
--   * the attach requires a QC-passed master whose metadata carries a
--     non-null `panelProofAuthoring` object. With a logo that was already true
--     by the time the inventory validated, so the with-logo snapshot is
--     byte-identical to before;
--   * the logo-inventory requirement -- `panel_proof_logo_inventory`,
--     `generation_logo_placement_manifest_required`,
--     `generation_logo_copy_required` -- stays inside `IF v_logo IS NOT NULL`
--     and is unchanged. A no-logo brief attaches the proof with
--     `expectedLogoInventory: []` and attestation `none`, which is what the
--     snapshot's own CHECK and trigger require of a no-logo run.
--
-- Patched by text on the installed body (CLAUDE.md: never restate a live
-- PL/pgSQL body). Every fragment is asserted to appear exactly once before
-- the replace, the result is EXECUTEd (the PL/pgSQL validator parses it),
-- then read back and structurally asserted. Behaviour is exercised by
-- supabase/tests/panel_proof_without_logo.test.sql.
DO $migration$
DECLARE v text; v_old text; v_new text; v_after text;
  v_marker text:=$m$  IF v_logo IS NULL AND v_logo_atlas.id IS NULL THEN$m$;
BEGIN
  v:=pg_get_functiondef('public.handoff_designpro_generation_to_production(uuid)'::regprocedure);
  IF strpos(v,v_marker)>0 THEN RETURN; END IF;
  IF strpos(v,'v_logo_atlas public.designpro_flat_atlas_revisions%ROWTYPE;')=0
  THEN RAISE EXCEPTION 'panel_proof_without_logo_prerequisite_missing: 20260920022906'; END IF;

  -- 1. The print-master lookup leaves the logo branch.
  v_old:=$old$  IF v_logo IS NOT NULL THEN
    SELECT * INTO v_logo_atlas FROM public.designpro_flat_atlas_revisions a
      WHERE a.id=NULLIF(v_row.engine_receipt->>'atlasRevisionId','')::uuid
        AND a.request_id=v_row.id AND a.owner_id=v_row.owner_id AND a.generation_id=v_row.generation_id
        AND a.revision_sequence=v_row.revision_sequence;
    IF v_input_contract<>'designpro.calls-1-7-input.v3' OR v_logo_atlas.id IS NULL$old$;
  IF (length(v)-length(replace(v,v_old,'')))/length(v_old)<>1
  THEN RAISE EXCEPTION 'panel_proof_without_logo_lookup_anchor_changed'; END IF;
  v_new:=$new$  -- The accepted print master is resolved for EVERY handoff, not only when a
  -- logo was uploaded: its three-zone panel proof is Zone 2 for Call 11 and the
  -- proof the production ZIP packages, with or without a customer logo.
  SELECT * INTO v_logo_atlas FROM public.designpro_flat_atlas_revisions a
    WHERE a.id=NULLIF(v_row.engine_receipt->>'atlasRevisionId','')::uuid
      AND a.request_id=v_row.id AND a.owner_id=v_row.owner_id AND a.generation_id=v_row.generation_id
      AND a.revision_sequence=v_row.revision_sequence;
  IF v_logo IS NULL AND v_logo_atlas.id IS NULL THEN
    SELECT * INTO v_logo_atlas FROM public.designpro_flat_atlas_revisions a
      WHERE a.request_id=v_row.id AND a.owner_id=v_row.owner_id AND a.generation_id=v_row.generation_id
        AND a.metadata->>'masterQcPassed'='true'
      ORDER BY a.revision_sequence DESC LIMIT 1;
  END IF;
  IF v_logo IS NOT NULL THEN
    IF v_input_contract<>'designpro.calls-1-7-input.v3' OR v_logo_atlas.id IS NULL$new$;
  v:=replace(v,v_old,v_new);

  -- 2. The attach follows the master, not the logo.
  v_old:=$old$  IF v_logo_atlas.id IS NOT NULL THEN
    v_snapshot:=v_snapshot||jsonb_build_object('panelProofAuthoring',v_logo_atlas.metadata->'panelProofAuthoring',$old$;
  IF (length(v)-length(replace(v,v_old,'')))/length(v_old)<>1
  THEN RAISE EXCEPTION 'panel_proof_without_logo_attach_anchor_changed'; END IF;
  v_new:=$new$  IF v_logo_atlas.id IS NOT NULL
    AND v_logo_atlas.metadata->>'masterQcPassed'='true'
    AND jsonb_typeof(v_logo_atlas.metadata->'panelProofAuthoring')='object' THEN
    v_snapshot:=v_snapshot||jsonb_build_object('panelProofAuthoring',v_logo_atlas.metadata->'panelProofAuthoring',$new$;
  v:=replace(v,v_old,v_new);

  EXECUTE v;

  -- 3. Validate the RESULT, not only the search strings (CLAUDE.md, 2026-08-26).
  v_after:=pg_get_functiondef('public.handoff_designpro_generation_to_production(uuid)'::regprocedure);
  IF (length(v_after)-length(replace(v_after,v_marker,'')))/length(v_marker)<>1
    OR (length(v_after)-length(replace(v_after,$f$jsonb_typeof(v_logo_atlas.metadata->'panelProofAuthoring')='object' THEN$f$,'')))
      /length($f$jsonb_typeof(v_logo_atlas.metadata->'panelProofAuthoring')='object' THEN$f$)<>1
    OR (length(v_after)-length(replace(v_after,E'  IF v_logo IS NOT NULL THEN\n    IF v_input_contract<>''designpro.calls-1-7-input.v3''','')))
      /length(E'  IF v_logo IS NOT NULL THEN\n    IF v_input_contract<>''designpro.calls-1-7-input.v3''')<>1
    OR (length(v_after)-length(replace(v_after,E'  ELSE\n    v_logo_mode:=''none'';\n  END IF;','')))
      /length(E'  ELSE\n    v_logo_mode:=''none'';\n  END IF;')<>1
    OR strpos(v_after,'v_logo_inventory:=designpro_private.panel_proof_logo_inventory(')=0
    OR strpos(v_after,'generation_logo_placement_manifest_required')=0
    OR strpos(v_after,'generation_logo_copy_required')=0
    OR strpos(v_after,$f$'expectedLogoInventory',v_logo_inventory,$f$)=0
    -- order: unconditional lookup -> logo branch -> brand -> attach -> idempotency key
    OR NOT (strpos(v_after,'  SELECT * INTO v_logo_atlas FROM public.designpro_flat_atlas_revisions a')
      < strpos(v_after,E'  IF v_logo IS NOT NULL THEN\n    IF v_input_contract')
      AND strpos(v_after,E'  IF v_logo IS NOT NULL THEN\n    IF v_input_contract')
      < strpos(v_after,'  v_brand:=pg_catalog.jsonb_strip_nulls(')
      AND strpos(v_after,'  v_brand:=pg_catalog.jsonb_strip_nulls(')
      < strpos(v_after,$f$jsonb_typeof(v_logo_atlas.metadata->'panelProofAuthoring')='object' THEN$f$)
      AND strpos(v_after,$f$jsonb_typeof(v_logo_atlas.metadata->'panelProofAuthoring')='object' THEN$f$)
      < strpos(v_after,$f$  v_idempotency:='calls17-handoff:'||v_row.id::text;$f$))
    OR v_after ~ 'pg_catalog\.(coalesce|nullif|greatest|least)\('
  THEN RAISE EXCEPTION 'panel_proof_without_logo_patched_body_invalid'; END IF;
END $migration$;
