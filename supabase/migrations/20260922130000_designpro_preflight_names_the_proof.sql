-- THE PANELPRO PREFLIGHT NAMES THE PRODUCTION PANEL PROOF.
--
-- Owner (Trish 2026-09-22): "must send production panel proof and its assets to
-- panel pro studio / For processing and qc." Traced in
-- docs/PANEL-PROOF-TO-PANELPRO.md: the three-zone sheet, the six Zone 2 clean
-- panels and the Zone 3 cut graphics all reach PanelPro Studio and the paid
-- ZIP -- but no QC check asked about any of them. A reviewer could look at the
-- sheet; nothing required them to, and nothing recorded that they did.
--
-- Three human attestations join the six the preflight already requires:
--
--   proofSheetReviewed        the reviewer opened the three-zone sheet for THIS
--                             revision
--   cleanPanelsMatchBranded   Zone 2 is the same six panels without the type
--   cutGraphicsInventoried    Zone 3 holds the elements the brief called for
--
-- They are required ONLY when the frozen snapshot carries the proof
-- (`snapshot.panelProofAuthoring` is an object -- 20260922051200 attaches it on
-- every handoff of a three-zone revision). A revision authored on six-surface,
-- field or hero-driver has no three-zone document, so it has nothing to attest
-- to and is not asked. Asking would make a reviewer sign for a sheet that does
-- not exist, which is the opposite of the point.
--
-- The live body is TEXT-PATCHED, never re-emitted: a CREATE OR REPLACE of the
-- whole function would silently revert 20260908193134's final-proof-join
-- patch. The anchor is asserted to occur exactly once before the replace, and
-- the patched body is re-read and asserted afterwards, because validating the
-- inputs proves the text was found -- only reading the output proves valid code
-- was left behind.
--
-- SHIP ORDER: the gateway and the app that SUPPLY these keys deploy BEFORE
-- this migration applies. The gateway forwards the three keys when the browser
-- sends them true and never fabricates them; until this lands, the extra keys
-- are ignored by the six-key containment check. Applying this first would
-- refuse every three-zone preflight with `panelpro_proof_evidence_incomplete`
-- until the deploy caught up.

DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_after text;
BEGIN
  v_definition:=pg_get_functiondef(to_regprocedure('public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'));
  IF v_definition IS NULL
  THEN RAISE EXCEPTION 'preflight_proof_gate_missing_function'; END IF;

  -- Idempotent: a body that already names the proof is left exactly as it is.
  IF strpos(v_definition,'panelpro_proof_evidence_incomplete')>0 THEN
    RETURN;
  END IF;

  v_old:=$old$    IF NOT p_qc @> '{"dimensionsVerified":true,"sourceRegionsVerified":true,"fiveInchBleed":true,"panelHashesVerified":true,"logoInventoryVerified":true,"textLockVerified":true}'::jsonb
    THEN RAISE EXCEPTION 'panelpro_preflight_evidence_incomplete'; END IF;
$old$;
  v_new:=$new$    IF NOT p_qc @> '{"dimensionsVerified":true,"sourceRegionsVerified":true,"fiveInchBleed":true,"panelHashesVerified":true,"logoInventoryVerified":true,"textLockVerified":true}'::jsonb
    THEN RAISE EXCEPTION 'panelpro_preflight_evidence_incomplete'; END IF;
    -- THE PREFLIGHT NAMES THE PROOF (2026-09-22). When this revision's frozen
    -- snapshot carries the three-zone Production Panel Proof, the reviewer
    -- also attests to the sheet, Zone 2 and Zone 3. A revision authored before
    -- Call 1 drew one has nothing to attest to and is not asked.
    IF pg_catalog.jsonb_typeof(v_source.snapshot->'panelProofAuthoring')='object'
      AND NOT p_qc @> '{"proofSheetReviewed":true,"cleanPanelsMatchBranded":true,"cutGraphicsInventoried":true}'::jsonb
    THEN RAISE EXCEPTION 'panelpro_proof_evidence_incomplete'; END IF;
$new$;

  IF strpos(v_definition,'immutable_revision_fulfillment_mismatch')=0
    OR strpos(v_definition,'frozen_call9_call10_receipts_required')=0
    OR strpos(v_definition,'v_source public.designpro_revision_sources%ROWTYPE')=0
    OR (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) IS DISTINCT FROM 1
  THEN RAISE EXCEPTION 'preflight_proof_gate_unexpected_approval_contract'; END IF;

  EXECUTE replace(v_definition,v_old,v_new);

  -- Read back what was produced, not what was searched for.
  v_after:=pg_get_functiondef(to_regprocedure('public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'));
  IF (length(v_after)-length(replace(v_after,'panelpro_proof_evidence_incomplete','')))/length('panelpro_proof_evidence_incomplete') IS DISTINCT FROM 1
    OR (length(v_after)-length(replace(v_after,'panelpro_preflight_evidence_incomplete','')))/length('panelpro_preflight_evidence_incomplete') IS DISTINCT FROM 1
    OR strpos(v_after,'panelpro_preflight_evidence_incomplete')>strpos(v_after,'panelpro_proof_evidence_incomplete')
    OR strpos(v_after,'panelpro_proof_evidence_incomplete')>strpos(v_after,'frozen_call9_call10_receipts_required')
    OR strpos(v_after,$f$jsonb_typeof(v_source.snapshot->'panelProofAuthoring')='object'$f$)=0
  THEN RAISE EXCEPTION 'preflight_proof_gate_patch_not_applied'; END IF;
END $migration$;
