-- THE CANONICAL CALL 1: DesignPanelAI + A.T.L.A.S. in one authoring call, so
-- masters authored by the reconstructed creative branch stop qualifying.
--
-- Owner directive (Trish 2026-08-26): "IMPLEMENT ONE CANONICAL DESIGNPROAI
-- CALL 1 ... invoke the real DesignPanelAI creative builder from the
-- server-native ATLAS authoring path without duplicating/reimplementing it.
-- There must be one canonical creative implementation, not two drifting
-- copies."
--
-- The runtime change this re-versions: the creative half of Call 1 is no
-- longer runtime/designiq-prompt.cjs's reconstructed
-- buildAtlasArtboardDesignIQDirection (now deleted) — it is the REAL
-- design-panel-ai-generate builder, vendored and mechanically transpiled
-- (runtime/vendor/designpanel-authoring.cjs), running its artboard branch in
-- atlasTopology mode. Two version literals therefore move together:
--
--   designpro-flat-first-atlas-20260826.v8   -> designpro-flat-first-atlas-20260826.v9-dpag
--   designpanel-ai-generate.artboard.20260826.v2 -> designpanel-ai-generate.artboard.20260826.v3-vendored
--
-- The SIDE-TWIN "photographic scene / landmarks" framing — the only
-- flank-specific language in the v4-v8 prompts and the prime suspect for the
-- vehicle-silhouette flanks broken since v4 — does not exist in the v9 prompt,
-- because the vendored authority never contained it.
--
-- v8/port-v2 masters are deliberately NOT kept as an alternative, for the same
-- reason v7 was not kept when v8 shipped. OWNER PROTECTION #1 (2026-08-26):
-- this fence refuses REUSING an older master for NEW authoring or
-- regeneration only — existing generations remain readable, viewable and
-- downloadable everywhere; no read path evaluates this function's version
-- pins (locked by tests/atlas-historical-read.test.mjs).
--
-- THIS MIGRATION PATCHES THE LIVE BODY; IT DOES NOT RESTATE IT. The live
-- definition is 20260826000000's sibling-surface version as re-versioned by
-- 20260826020000 and 20260826050000. A CREATE OR REPLACE reproducing an older
-- body would silently revert the owner-approved sibling-surface fan-out and
-- both prior version bumps. Each fragment is asserted to appear exactly once
-- before substitution, and the generated body is inspected afterwards:
-- validating the search fragments proves the right text was found, never that
-- valid code was left behind.
DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_old_prompt constant text := '''designpro-flat-first-atlas-20260826.v8''';
  v_new_prompt constant text := '''designpro-flat-first-atlas-20260826.v9-dpag''';
  v_old_port constant text := '''designpanel-ai-generate.artboard.20260826.v2''';
  v_new_port constant text := '''designpanel-ai-generate.artboard.20260826.v3-vendored''';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'designpro_atlas_canonical_v9_target_missing';
  END IF;

  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_prompt, ''))
  ) / pg_catalog.length(v_old_prompt);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'designpro_atlas_canonical_v9_prompt_fragment_not_unique: %', v_occurrences;
  END IF;

  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_port, ''))
  ) / pg_catalog.length(v_old_port);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'designpro_atlas_canonical_v9_port_fragment_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old_prompt, v_new_prompt);
  v_patched := pg_catalog.replace(v_patched, v_old_port, v_new_port);

  -- Inspect what the substitutions produced, not only what they searched for.
  IF pg_catalog.strpos(v_patched, v_new_prompt) = 0
    OR pg_catalog.strpos(v_patched, v_old_prompt) > 0
    OR pg_catalog.strpos(v_patched, v_new_port) = 0
    OR pg_catalog.strpos(v_patched, v_old_port) > 0
  THEN
    RAISE EXCEPTION 'designpro_atlas_canonical_v9_substitution_failed';
  END IF;
  -- The sibling-surface refusals must survive verbatim. If a future body ever
  -- loses them, this migration refuses rather than shipping a Driver
  -- hard-dependency back into production under a new version string.
  IF pg_catalog.strpos(
       v_patched, 'NOT ((v.metadata->''provider'') ? ''driverContentHash'')'
     ) = 0
  THEN
    RAISE EXCEPTION 'designpro_atlas_canonical_v9_sibling_refusal_missing';
  END IF;

  EXECUTE v_patched;
END
$migration$;
