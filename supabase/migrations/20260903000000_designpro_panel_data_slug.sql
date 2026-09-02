-- THE PANEL DATA SLUG AND THE PANEL MAP (owner ruling, Trish 2026-09-02).
--
-- Brice's print floor needs every printed panel to carry its own data strip on
-- one edge, the way the RIP prints its info band. From the design side that is
-- the panel data slug: rendered by code from the panel map (one JSON per run
-- naming every surface's identity, geometry, lineage and file), printed on the
-- bottom edge of every production PNG/TIFF/EPS and on every Call 11 QC panel.
--
-- Two database changes, nothing else:
--
--  1. `panel-map` is an artifact kind. The map is stored once per phase
--     (design at Call 9, production at output.build) and read by PanelPro, the
--     ZIP and WrapBox. Additive: SURFACE_KEYS, storage paths, hashes and the
--     exactly-six / exactly-two counts of RULE 0.5 are untouched, and the
--     existing kinds keep their order so every text lock on this list holds.
--
--  2. The two human gates require the slug to have been READ. PanelPro
--     preflight gains `panelDataSlugVerified` (the strip on every QC panel was
--     read against the panel map); final production QC gains
--     `productionSlugVerified` (every production file carries the strip and it
--     matches the map). Both are added by text-patching the LIVE body of
--     approve_designpro_human_gate, never by restating it (CLAUDE.md,
--     "PATCHING LIVE PL/pgSQL"): each literal must occur exactly once, the
--     patched body is EXECUTEd, and the result is read back and checked.

ALTER TABLE public.designpro_artifacts
  DROP CONSTRAINT IF EXISTS designpro_artifacts_artifact_kind_check;
ALTER TABLE public.designpro_artifacts
  ADD CONSTRAINT designpro_artifacts_artifact_kind_check CHECK (artifact_kind IN (
    'flat-proof','panel','qc-panel','corrected-panel','upscaled-panel','logo','output','stamp','zip','wrapbox-manifest','panel-map'
  ));

DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_old_preflight text := $lit$"logoInventoryVerified":true,"textLockVerified":true}'::jsonb$lit$;
  v_new_preflight text := $lit$"logoInventoryVerified":true,"textLockVerified":true,"panelDataSlugVerified":true}'::jsonb$lit$;
  v_old_final text := $lit$"printDimensionsVerified":true,"colorModeVerified":true}'::jsonb$lit$;
  v_new_final text := $lit$"printDimensionsVerified":true,"colorModeVerified":true,"productionSlugVerified":true}'::jsonb$lit$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'::pg_catalog.regprocedure
  ) INTO v_definition;

  -- Idempotent: a body that already carries both keys is left exactly as it is.
  IF pg_catalog.position(v_new_preflight IN v_definition) > 0
     AND pg_catalog.position(v_new_final IN v_definition) > 0 THEN
    RETURN;
  END IF;

  IF (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old_preflight, '')))
       / pg_catalog.length(v_old_preflight) <> 1 THEN
    RAISE EXCEPTION 'designpro_preflight_evidence_literal_not_unique';
  END IF;
  IF (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old_final, '')))
       / pg_catalog.length(v_old_final) <> 1 THEN
    RAISE EXCEPTION 'designpro_final_evidence_literal_not_unique';
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old_preflight, v_new_preflight);
  v_patched := pg_catalog.replace(v_patched, v_old_final, v_new_final);
  EXECUTE v_patched;

  -- Validate the RESULT, not only the search strings.
  SELECT pg_catalog.pg_get_functiondef(
    'public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'::pg_catalog.regprocedure
  ) INTO v_definition;
  IF pg_catalog.position(v_new_preflight IN v_definition) = 0
     OR pg_catalog.position(v_new_final IN v_definition) = 0
     OR pg_catalog.position(v_old_preflight IN v_definition) > 0
     OR pg_catalog.position(v_old_final IN v_definition) > 0 THEN
    RAISE EXCEPTION 'designpro_human_gate_slug_patch_not_applied';
  END IF;
END
$migration$;
