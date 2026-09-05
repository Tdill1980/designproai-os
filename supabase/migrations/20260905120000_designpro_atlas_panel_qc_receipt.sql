-- THE PANEL VERDICT REACHES THE PEOPLE WHO HAVE TO CHECK IT.
--
-- Call 1 is unchanged and stays the creative authority. What is new is that the
-- runtime now inspects the SIX EXTRACTED PANELS before the master is accepted
-- and records, per surface, whether a required element survived the cut --
-- `runtime/atlas-panel-qc.cjs`, contract `designpro.atlas-panel-qc.v1`.
--
-- None of that was reaching a screen. `designpro_flat_atlas_generation_paths`
-- projects a NAMED list of metadata keys into its `qc` object, so a key the
-- list does not name is invisible to PanelPro Studio and to RevisionStudioIQ no
-- matter how faithfully the runtime wrote it. That is the same class of defect
-- as `Print panels 6/6` meaning "six files exist": the board renders what it is
-- given, and it was not being given the thing a reviewer needs.
--
-- WHAT A REVIEWER NEEDS, AND NOW GETS:
--   * which surfaces failed, by name, so a repair can be aimed and the panels
--     that already pass are visibly left alone;
--   * for each failing surface, WHICH element was severed and at WHICH edges,
--     so `Www.Arct` on the hood is a stated finding rather than something a
--     reviewer has to notice by downloading the file;
--   * every located element with its rectangle in master pixels and its
--     containment status, so the verdict is auditable from the record;
--   * whether the locator was UNAVAILABLE, because "we could not look" must
--     never read as "we looked and it was fine".
--
-- PATCHED IN PLACE, NEVER RESTATED. Restating this function would silently
-- revert whatever earlier migrations patched into it -- the shadow gate caught
-- exactly that on the Close-Up boundary, and this file follows the same idiom:
-- assert the anchor appears EXACTLY ONCE, replace it, then EXECUTE the result
-- so PL/pgSQL actually compiles what was produced rather than only what was
-- searched for.
--
-- Historical revisions are not rewritten and not hidden. A row authored before
-- panel QC existed has no panel-QC metadata, every key below resolves to SQL
-- NULL for it, and it stays readable, viewable and downloadable exactly as it
-- is today (owner protection #1).

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
      -- ── PANEL QC (designpro.atlas-panel-qc.v1) ───────────────────────────
      'panelQcContract',r.metadata->>'panelQcContract',
      -- The surfaces a repair must aim at, by name. Empty array = all six
      -- carry their elements whole.
      'panelQcFailingSurfaces',COALESCE(r.metadata->'panelQcFailingSurfaces','[]'::jsonb),
      -- Per surface: ok, orientation, the elements it carries whole, the
      -- elements the cut severed, and the edges each was severed at.
      'panelQcSurfaces',COALESCE(r.metadata->'panelQcSurfaces','[]'::jsonb),
      -- Every located element with its master-pixel rectangle and containment
      -- status, so the verdict is auditable rather than asserted.
      'panelQcElements',COALESCE(r.metadata->'panelQcElements','[]'::jsonb),
      -- Set when the locator could not be reached. A run carrying this has NOT
      -- been panel-checked, and no surface may be reported as passing.
      'panelQcUnavailable',r.metadata->>'panelQcUnavailable'
    ),$frag$;

  IF (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_fragment, '')
    )
  ) / pg_catalog.length(v_fragment) <> 1 THEN
    RAISE EXCEPTION 'designpro_atlas_panel_qc_anchor_not_unique';
  END IF;

  v_definition := pg_catalog.replace(v_definition, v_fragment, v_replacement);
  EXECUTE v_definition;
END
$migration$;

-- WHY THERE IS NO SMOKE-TEST CALL HERE.
--
-- The first cut of this migration ended with a DO block that called the
-- function for a generation id that does not exist and raised if the result was
-- NULL. That assertion was wrong twice over, and CI caught it.
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
-- `supabase/tests/atlas_panel_qc_receipt.test.sql`, where a fixture can be
-- inserted and rolled back. Applying this file proves the patched text parses;
-- that test proves the body runs and returns the panel-QC keys.

GRANT EXECUTE ON FUNCTION public.designpro_flat_atlas_generation_paths(uuid) TO authenticated, service_role;
