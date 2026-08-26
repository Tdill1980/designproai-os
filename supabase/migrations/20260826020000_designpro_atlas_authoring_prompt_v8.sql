-- The design call opens as the designer, so v7 masters stop qualifying.
--
-- A.T.L.A.S. is the output topology of the proven design engine, not a
-- replacement for it. Call 1's prompt had inverted that: roughly 4,600
-- characters of atlas topology instruction led, and the DesignIQ direction --
-- the ported `mode === 'artboard'` branch of design-panel-ai-generate, which is
-- the creative authority -- was appended underneath it as a trailing
-- "DESIGNIQ FLAT CREATIVE DIRECTION:" section. The call that authors the
-- customer's design therefore read as a topology brief with a designer
-- footnote. The reference does the opposite: it opens as the designer, names
-- the vehicle, lists the panels WITH THEIR REAL INCHES, states the brief, and
-- closes with a short output-format instruction
-- (the reference design-panel-ai-generate index.ts:340-390, 1,516 characters
-- in total).
--
-- v8 is that inversion, plus two parity restorations measured against the same
-- authority:
--
--   * the ZONE MAP now carries each surface's real trim inches, as
--     resolveArtboardPanels stamps them at index.ts:348-350. Call 1 previously
--     saw pixel boxes and rotations only, so it knew where each surface sat on
--     the canvas but never how large it is in the real world -- and a designer
--     scales lettering, motif and hierarchy to the physical panel.
--   * the authoring call is model-locked and sets temperature 1.0 explicitly,
--     as index.ts:1320 and :1334 do. It had inherited a Flash-image fallback,
--     which is right for a projection and wrong for authoring: it meant the
--     customer's design itself could be drawn by a weaker model than the locked
--     one, silently.
--
-- No creative wording was rewritten. The DesignIQ direction is byte-identical;
-- it leads instead of trailing. The three blocks RULE 0.15 protects -- SOLID
-- PANELS, the PAIRED FLAT-TO-FINISHED LESSON and ONE COHESIVE WRAP -- are
-- reproduced verbatim and in full, as is FULL BLEED PER ZONE and the side-twin
-- bullet.
--
-- v7 is deliberately NOT kept as an alternative, for the same reason v6 was not
-- kept when v7 shipped. A master authored while the topology brief led must not
-- satisfy the current contract, and the version string is exactly the mechanism
-- that refuses it.
--
-- THIS MIGRATION PATCHES THE LIVE BODY; IT DOES NOT RESTATE IT. The live
-- definition is 20260826000000's sibling-surface version, which inverted the
-- Driver-anchor requirements into refusals. A CREATE OR REPLACE reproducing an
-- older body -- which is how v7 itself shipped -- would silently revert that
-- owner-approved fan-out. Only the one prompt-version literal changes, the
-- fragment is asserted to appear exactly once before substitution, and the
-- generated body is inspected afterwards: validating the search fragment proves
-- the right text was found, never that valid code was left behind.
DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_old constant text := '''designpro-flat-first-atlas-20260825.v7''';
  v_new constant text := '''designpro-flat-first-atlas-20260826.v8''';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'designpro_atlas_prompt_v8_target_missing';
  END IF;

  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'designpro_atlas_prompt_v8_fragment_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- Inspect what the substitution produced, not only what it searched for.
  IF pg_catalog.position(v_new IN v_patched) = 0
    OR pg_catalog.position(v_old IN v_patched) > 0
  THEN
    RAISE EXCEPTION 'designpro_atlas_prompt_v8_substitution_failed';
  END IF;
  -- The sibling-surface refusals must survive verbatim. If a future body ever
  -- loses them, this migration refuses rather than shipping a Driver
  -- hard-dependency back into production under a new version string.
  IF pg_catalog.position(
       'NOT ((v.metadata->''provider'') ? ''driverContentHash'')' IN v_patched
     ) = 0
  THEN
    RAISE EXCEPTION 'designpro_atlas_prompt_v8_sibling_refusal_missing';
  END IF;

  EXECUTE v_patched;
END
$migration$;
