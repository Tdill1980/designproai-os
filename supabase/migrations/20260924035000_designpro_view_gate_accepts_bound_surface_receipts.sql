-- The current photographer uses the exact persisted surface panel, even when
-- a three-zone presentation sheet exists. The SQL reader still inferred a
-- whole-sheet source from sheet existence and refused seven saved valid views.
-- Match the explicit receipt, not the existence of a presentation document.
-- No job, asset, entitlement, production approval, or ownership data is changed.
DO $surface_receipt_gate$
DECLARE
  v_definition text;
  v_patched text;
  v_occurrences int;
  v_old constant text := $needle$      AND CASE
        WHEN COALESCE(v_atlas.metadata#>>'{panelProofAuthoring,proofSha256}','')
$needle$;
  v_new constant text := $replacement$      AND CASE
        -- SURFACE_PANEL_RECEIPT_V1: this is the current worker's source contract.
        -- The named panel must also exist in this revision's persisted inventory.
        WHEN v.metadata#>>'{provider,proofArtworkAuthorityRole}'='surface-panel'
        THEN v.metadata#>>'{provider,proofArtworkAuthorityContract}'=
            'designpro.atlas-panel-authority.v1'
          AND v.metadata#>>'{provider,proofArtworkAuthorityHash}'=
            v.metadata#>>'{provider,atlasZoneContentHash}'
          AND v.metadata#>>'{provider,sourcePanelHash}'=
            v.metadata#>>'{provider,atlasZoneContentHash}'
          AND EXISTS (
            SELECT 1 FROM pg_catalog.jsonb_array_elements(
              CASE WHEN pg_catalog.jsonb_typeof(v_atlas.metadata->'callOnePanels')='array'
                THEN v_atlas.metadata->'callOnePanels' ELSE '[]'::jsonb END
            ) AS panel
            WHERE panel->>'contract'='designpro.flat-first-atlas-call1-panel.v1'
              AND panel->>'surfaceKey'=v.metadata#>>'{provider,atlasZoneSurfaceKey}'
              AND panel->>'contentHash'=v.metadata#>>'{provider,atlasZoneContentHash}'
              AND panel->>'sourceMasterHash'=COALESCE(
                v_atlas.metadata->>'panelSourceHash', v_atlas.master_content_hash
              )
          )
        WHEN COALESCE(v_atlas.metadata#>>'{panelProofAuthoring,proofSha256}','')
$replacement$;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN RAISE EXCEPTION 'surface_receipt_gate_target_missing'; END IF;
  IF pg_catalog.strpos(v_definition, 'SURFACE_PANEL_RECEIPT_V1') > 0 THEN RETURN; END IF;
  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
    / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'surface_receipt_gate_fragment: %', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_definition, v_old, v_new);
  -- This adds one strict source branch. Every earlier lineage and QC predicate
  -- and the historical whole-sheet branch must survive byte-for-byte.
  IF pg_catalog.replace(v_patched, v_new, v_old) IS DISTINCT FROM v_definition
    OR pg_catalog.strpos(v_patched, 'proofArtworkAuthorityHash') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-three-zone-proof-authority.v1') = 0
    OR pg_catalog.strpos(v_patched, 'v_valid_count=v_count') = 0
    OR pg_catalog.strpos(v_patched, 'masterAcceptance') = 0
    OR pg_catalog.strpos(v_patched, 'anchoredToView1') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-proof-semantic-advisory.v1') = 0
  THEN RAISE EXCEPTION 'surface_receipt_gate_context_lost'; END IF;
  EXECUTE v_patched;
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    RAISE EXCEPTION 'surface_receipt_gate_not_installed';
  END IF;
END $surface_receipt_gate$;
