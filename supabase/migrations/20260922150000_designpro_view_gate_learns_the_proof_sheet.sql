-- THE VIEW GATE REFUSED EVERY THREE-ZONE RUN, AND THE CUSTOMER SAW IT.
--
-- Owner, 2026-09-22, on her own live run (New Aura Day Spa, request
-- 21dc0312-1c69-4d70-83ff-ae4c8f9c5b46, revision 2449ccf8): Call 1 built the
-- three-zone TriZone(TM) Production Panel Proof, seven views rendered, Call 8
-- ran, Call 9 promoted -- and the create page latched a terminal card:
-- "Your TriZone(TM) Production Panel Proof didn't finish. This saved proof set
-- cannot be reused." Postgres, 18:42:28Z, 46 s after acceptance:
-- `flat_first_atlas_new_run_required` from designpro_generation_view_paths ->
-- gateway 409 -> the app's error latch.
--
-- `designpro_private.flat_first_atlas_view_set_valid(uuid)` is false on that
-- completed run because all seven views fail ONE clause:
--
--     v.metadata#>>'{provider,sourcePanelHash}'
--       = v.metadata#>>'{provider,atlasZoneContentHash}'
--
-- On the three-zone route the photographer is handed the SHEET as the artwork
-- source (`sourcePanelHash` = the sheet's sha256, `proofArtworkAuthorityRole` =
-- 'three-zone-production-proof', `proofArtworkAuthorityHash` = the same sha256)
-- and the surface's panel as its TARGET (`atlasZoneContentHash`). The runtime
-- worker knows this -- runtime/generation-worker.cjs branches on
-- `flatAtlas.proofSheet.contentHash` and demands exactly those four fields --
-- and the SQL twin never learned it. Receipts green on the worker, 409 on the
-- gateway, a false "cannot be reused" for the customer.
--
-- THIS IS NOT A RELAXATION. On a revision whose metadata carries
-- `panelProofAuthoring.proofSha256` the clause becomes the worker's own rule,
-- one for one: the authority contract, its role, its hash and the source hash
-- must all name the frozen sheet. A revision with no three-zone document keeps
-- the panel equality byte for byte. Nothing else in the predicate moves.
--
-- PATCH, DO NOT RESTATE (CLAUDE.md): the fragment must occur EXACTLY ONCE, the
-- result is read back and asserted before EXECUTE, and COALESCE is grammar --
-- never `pg_catalog.coalesce`.
DO $three_zone_gate$
DECLARE
  v_definition text;
  v_patched text;
  v_occurrences int;
  v_old constant text := E'      AND v.metadata#>>''{provider,sourcePanelHash}''=\n        v.metadata#>>''{provider,atlasZoneContentHash}''\n';
  v_new constant text := E'      -- THE THREE-ZONE PROOF IS THE ARTWORK AUTHORITY ON A THREE-ZONE REVISION\n      -- (2026-09-22). The photographer is handed the sheet as the source and the\n      -- surface''s panel as its target, and the receipt names the sheet as the\n      -- artwork authority; that is the rule runtime/generation-worker.cjs\n      -- enforces, and this clause refused every completed three-zone run by\n      -- demanding the six-surface panel equality of it. A revision with no\n      -- three-zone document keeps that equality unchanged.\n      AND CASE\n        WHEN COALESCE(v_atlas.metadata#>>''{panelProofAuthoring,proofSha256}'','''')\n          ~ ''^[0-9a-f]{64}$''\n        THEN v.metadata#>>''{provider,proofArtworkAuthorityContract}''=\n            ''designpro.atlas-three-zone-proof-authority.v1''\n          AND v.metadata#>>''{provider,proofArtworkAuthorityRole}''=\n            ''three-zone-production-proof''\n          AND v.metadata#>>''{provider,proofArtworkAuthorityHash}''=\n            v_atlas.metadata#>>''{panelProofAuthoring,proofSha256}''\n          AND v.metadata#>>''{provider,sourcePanelHash}''=\n            v_atlas.metadata#>>''{panelProofAuthoring,proofSha256}''\n        ELSE v.metadata#>>''{provider,sourcePanelHash}''=\n          v.metadata#>>''{provider,atlasZoneContentHash}''\n      END\n';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'three_zone_gate_target_missing';
  END IF;

  -- Idempotent.
  IF pg_catalog.strpos(v_definition, 'proofArtworkAuthorityHash') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
    / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'three_zone_gate_fragment: %', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- The result, not only the search string.
  IF pg_catalog.strpos(v_patched, 'designpro.atlas-three-zone-proof-authority.v1') = 0
    OR pg_catalog.strpos(v_patched, 'three-zone-production-proof') = 0
    OR pg_catalog.strpos(v_patched, '{panelProofAuthoring,proofSha256}') = 0
    OR pg_catalog.strpos(v_patched, 'proofArtworkAuthorityHash') = 0
  THEN
    RAISE EXCEPTION 'three_zone_gate_substitution_failed';
  END IF;
  -- Everything the earlier patches established must survive.
  IF pg_catalog.strpos(v_patched, 'persona-photographer-render') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-panel-authority.v1') = 0
    OR pg_catalog.strpos(v_patched, 'panelSourceHash') = 0
    OR pg_catalog.strpos(v_patched, 'masterAcceptance') = 0
    OR pg_catalog.strpos(v_patched, 'v_valid_count=v_count') = 0
    OR pg_catalog.strpos(v_patched, 'anchoredToView1') = 0
    OR pg_catalog.strpos(v_patched, 'designpro.atlas-proof-semantic-advisory.v1') = 0
  THEN
    RAISE EXCEPTION 'three_zone_gate_context_lost';
  END IF;
  IF pg_catalog.strpos(v_patched, 'pg_catalog.coalesce') > 0 THEN
    RAISE EXCEPTION 'three_zone_gate_grammar_trap';
  END IF;

  EXECUTE v_patched;

  -- Read back: the installed body is the patched one.
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF pg_catalog.strpos(v_definition, 'proofArtworkAuthorityHash') = 0 THEN
    RAISE EXCEPTION 'three_zone_gate_not_installed';
  END IF;
END $three_zone_gate$;
