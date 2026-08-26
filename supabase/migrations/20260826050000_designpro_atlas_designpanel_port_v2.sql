-- The DesignPanel artboard port changed, so v1-port masters stop qualifying.
--
-- Two parity corrections against the authority, measured on the assembled
-- pre-Gemini request for the Precision Climate Solutions payload rather than
-- argued from the finished image:
--
--   * RESTORED. design-panel-ai-generate's commercial scene sentence ends on
--     "The company name reads clearly at a glance; how the branding is composed
--     is your creative call." (index.ts:475, and its wantsPhoto twin). It is
--     the only place in the reference that hands the branding LAYOUT decision
--     back to the designer. The A.T.L.A.S. branch replaced the whole scene
--     sentence with a format instruction and nothing took over that half, so
--     the one call that authors the design was told the output shape, the
--     topology, the zone geometry and every contact lock, and was never told
--     that composing the identity is its own call. That is the shape of the
--     reported regression: a technically perfect sheet with set type where a
--     designed lockup belongs. The literal is the reference's own, byte for
--     byte; nothing was invented beside it, because RULE 0.1 forbids exactly
--     that.
--
--   * REMOVED FROM THE FLAT CALL. The MASTER/PROOF APPLICATION BOUNDARY ended
--     with the downstream-proof coverage rule -- "the wrap covers painted body
--     panels; windows, glass, lights, wheels and trim stay factory" -- plus
--     truckBedClause() and a restatement of its bed half. Three sentences
--     describing a VEHICLE, handed to the one call that draws no vehicle, and
--     they contradicted the sentence immediately above them: that one tells the
--     model to paint the livery straight THROUGH every window, wheel arch, lamp
--     and bed opening because the installer cuts them out later, and these then
--     told it those same surfaces carry no artwork. A flat atlas has no window,
--     lamp or bed-interior ZONE for them to describe -- the six zones are
--     driver, passenger, hood, roof, front and rear, and RULE 0.15 makes every
--     one of them a solid rectangle.
--
--     Calls 2-7 are unaffected and unchanged. The commercial and the restyle
--     builders in runtime/designiq-prompt.cjs -- the two that actually render a
--     vehicle -- each carry the factory-glass line and call truckBedClause()
--     themselves.
--
-- The A.T.L.A.S. topology half is untouched, which is why the topology
-- PROMPT_VERSION does not move with this. designpro-flat-first-atlas-20260826.v8
-- still describes the same output contract; what changed is the DesignPanel
-- creative port, and that carries its own version precisely so the two can move
-- independently.
--
-- v1-port masters are deliberately NOT kept as an alternative, for the same
-- reason v7 was not kept when v8 shipped. A master authored while the flat call
-- was still being told about factory glass must not satisfy the current
-- contract, and the version string is exactly the mechanism that refuses it.
--
-- THIS MIGRATION PATCHES THE LIVE BODY; IT DOES NOT RESTATE IT. The live
-- definition is 20260826000000's sibling-surface version as re-versioned by
-- 20260826020000. A CREATE OR REPLACE reproducing an older body would silently
-- revert the owner-approved sibling-surface fan-out and the v8 prompt version.
-- Only the one port-version literal changes, the fragment is asserted to appear
-- exactly once before substitution, and the generated body is inspected
-- afterwards: validating the search fragment proves the right text was found,
-- never that valid code was left behind.
DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_old constant text := '''designpanel-ai-generate.artboard.20260822.v1''';
  v_new constant text := '''designpanel-ai-generate.artboard.20260826.v2''';
  v_occurrences int;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'designpro_private.flat_first_atlas_view_set_valid(uuid)'
  ));
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'designpro_atlas_designpanel_port_v2_target_missing';
  END IF;

  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'designpro_atlas_designpanel_port_v2_fragment_not_unique: %', v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_old, v_new);

  -- Inspect what the substitution produced, not only what it searched for.
  IF pg_catalog.strpos(v_patched, v_new) = 0
    OR pg_catalog.strpos(v_patched, v_old) > 0
  THEN
    RAISE EXCEPTION 'designpro_atlas_designpanel_port_v2_substitution_failed';
  END IF;

  -- The two things earlier migrations bought must survive verbatim. If a future
  -- body ever loses either, this refuses rather than shipping a regression back
  -- into production under a new version string.
  IF pg_catalog.strpos(
       v_patched, 'NOT ((v.metadata->''provider'') ? ''driverContentHash'')'
     ) = 0
  THEN
    RAISE EXCEPTION 'designpro_atlas_designpanel_port_v2_sibling_refusal_missing';
  END IF;
  IF pg_catalog.strpos(
       v_patched, '''designpro-flat-first-atlas-20260826.v8'''
     ) = 0
  THEN
    RAISE EXCEPTION 'designpro_atlas_designpanel_port_v2_topology_version_lost';
  END IF;

  EXECUTE v_patched;
END
$migration$;
