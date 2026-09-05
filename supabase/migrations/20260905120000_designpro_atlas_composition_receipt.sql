-- THE COMPOSITION RECORD REACHES THE PEOPLE WHO HAVE TO CHECK IT.
--
-- Call 1 now authors the GROUND and the runtime composites the customer's name,
-- URL, phone, brand mark and focal photograph onto it BEFORE the master is
-- accepted, at rectangles `atlas-element-plan.cjs` proved lie inside one
-- surface's trim box. All of that is persisted on the revision's metadata by
-- `runtime/flat-first-atlas.cjs`.
--
-- None of it was reaching a screen. `designpro_flat_atlas_generation_paths`
-- projects a NAMED list of metadata keys into its `qc` object, so a key the
-- list does not name is invisible to PanelPro Studio and to RevisionStudioIQ
-- no matter how faithfully the runtime wrote it. That is the same class of
-- defect as `Print panels 6/6` meaning "six files exist": the board renders
-- what it is given, and it was not being given the thing a reviewer needs.
--
-- WHAT A REVIEWER NEEDS, AND NOW GETS, PER SURFACE:
--   * which elements were placed, and where -- in PIXELS and in VEHICLE INCHES
--     measured from the trim corner, so a panel can be checked against a real
--     template without opening the image;
--   * the exact string that printed, next to the rectangle it printed in, so a
--     spelling question is answerable from the record;
--   * what was SKIPPED and the number that decided it, so a bare surface is a
--     stated fact rather than a silent omission;
--   * the ground hash (what the model authored) alongside the master hash
--     (what the customer buys), so the two are never confused again.
--
-- PATCHED IN PLACE, NEVER RESTATED. Restating this function would silently
-- revert whatever earlier migrations patched into it -- the shadow gate caught
-- exactly that on the Close-Up boundary, and this file follows the same idiom:
-- assert the anchor appears EXACTLY ONCE, replace it, then EXECUTE the result
-- so PL/pgSQL actually compiles what was produced rather than only what was
-- searched for.
--
-- Historical revisions are not rewritten and not hidden. A row authored before
-- the ground split has no composition metadata, every key below resolves to
-- SQL NULL for it, and it stays readable, viewable and downloadable exactly as
-- it is today (owner protection #1).

DO $migration$
DECLARE
  v_definition text;
  v_fragment text;
  v_replacement text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.designpro_flat_atlas_generation_paths(uuid)'::pg_catalog.regprocedure
  ) INTO v_definition;

  -- The last entry of the `qc` object. Anchoring on it keeps the patch additive
  -- and keeps every existing key exactly where it is.
  v_fragment := $frag$      'canonicalMasterHash',r.metadata->>'canonicalMasterHash'
    ),$frag$;

  v_replacement := $frag$      'canonicalMasterHash',r.metadata->>'canonicalMasterHash',
      -- ── COMPOSITION (designpro.atlas-compose-master.v1) ──────────────────
      -- What the model authored, versus what the customer buys.
      'groundContract',r.metadata->>'groundContract',
      'groundMasterHash',r.metadata->>'groundMasterHash',
      'composeContract',r.metadata->>'composeContract',
      'composeReceipt',r.metadata->'composeReceipt',
      -- Every element, its rectangle in pixels AND in vehicle inches, and for
      -- typeset elements the exact string that printed.
      'elementPlanContract',r.metadata->>'elementPlanContract',
      'elementPlanHash',r.metadata->>'elementPlanHash',
      'elementPlacements',COALESCE(r.metadata->'elementPlacements','[]'::jsonb),
      -- A surface left bare is a stated fact with the measurement that decided
      -- it, never a silent omission.
      'elementPlacementsSkipped',COALESCE(r.metadata->'elementPlacementsSkipped','[]'::jsonb),
      'elementsContract',r.metadata->>'elementsContract',
      'elementsReceipt',r.metadata->'elementsReceipt'
    ),$frag$;

  IF (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_fragment, '')
    )
  ) / pg_catalog.length(v_fragment) <> 1 THEN
    RAISE EXCEPTION 'designpro_atlas_composition_anchor_not_unique';
  END IF;

  v_definition := pg_catalog.replace(v_definition, v_fragment, v_replacement);
  EXECUTE v_definition;
END
$migration$;

-- WHY THERE IS NO SMOKE-TEST CALL HERE.
--
-- The first cut of this migration ended with a DO block that called the
-- function for a generation id that does not exist and raised if the result was
-- NULL. That assertion was wrong twice over, and CI caught it:
-- `designpro_atlas_composition_projection_returned_null`.
--
--   1. NULL is the CORRECT answer for an unknown generation. The function's
--      third statement is `IF v_owner IS NULL THEN RETURN NULL; END IF;`.
--   2. Worse, it proved nothing even when it passed. Returning at that guard
--      means the `jsonb_build_object` below it is never EVALUATED, and PL/pgSQL
--      compiles an expression the first time it is evaluated -- which is exactly
--      how `pg_catalog.coalesce(...)` once shipped through shadow AND production
--      and then raised for every generation that actually had proofs.
--
-- So the real gate is a seeded row that reaches the projection, and it lives in
-- `supabase/tests/atlas_composition_receipt.test.sql`, where a fixture can be
-- inserted and rolled back. Applying this file proves the patched text parses;
-- that test proves the body runs and returns the composition keys.

GRANT EXECUTE ON FUNCTION public.designpro_flat_atlas_generation_paths(uuid) TO authenticated, service_role;
