-- THE QC SEAL LANDS ON THE TRIZONE(TM) PRODUCTION PANEL PROOF (owner, Trish
-- 2026-09-22: "We still need QC checks, stamp, zip file creator -- it's just
-- now on TriZone Production panel proof").
--
-- `stamp.build` stamped the Call 8 dimensioned sheet, the seal, the
-- certificate and the seven views -- and the customer's SOURCE document, the
-- three-zone sheet Call 1 drew, shipped unsealed. The runtime now renders the
-- same seal onto that sheet as a fourth stamp artifact,
-- `stamped-production-panel-proof`, bound to the frozen snapshot's
-- `panelProofAuthoring.proofSha256`, and names it on the receipt as
-- `stampedProductionPanelProof`.
--
-- The DATABASE pins the exact stamp artifact set (`3 + seven views`, an
-- allowlist of surface keys), so without this patch the fourth artifact fails
-- `exact_stamp_artifact_set_required` on every three-zone run. This patch:
--
--   * admits the fourth stamp ONLY on a revision whose frozen snapshot carries
--     a three-zone sheet (`jsonb` object at `snapshot.panelProofAuthoring` with
--     a 64-hex `proofSha256`) -- the same conditional shape the preflight
--     attestations use (20260922130000). A six-surface / field revision has no
--     sheet, gets no fourth stamp, and its receipt may not name one;
--   * when present, binds it: exactly one artifact, its `metadata.sourceProofHash`
--     and the receipt's `stampedProductionPanelProof.sourceProofHash` equal the
--     sheet sha, the receipt's `contentHash` equals the artifact's, the seal hash
--     matches, and its content hash is none of the seal / stamped-proof /
--     certificate hashes;
--   * ADMITS ITS ABSENCE on a three-zone revision. Ship order is migration
--     first, runtime second, and a gate that REQUIRED the fourth stamp would fail
--     every stamp.build in the window between them. Tightening to "required" is
--     a one-line follow-up once the runtime that emits it is verified live, and
--     is recorded as open in docs/TRIZONE-PRODUCTION-PANEL-PROOF-CHECKLIST.md.
--
-- PATCH, DO NOT RESTATE (CLAUDE.md): each fragment occurs EXACTLY ONCE inside
-- the stamp.build arm, the produced body is inspected before EXECUTE, and the
-- ZIP arm that follows is byte-identical afterwards.
DO $stamp_sheet$
DECLARE
  v_definition text;
  v_patched text;
  v_block text;
  v_start int;
  v_finish int;
  v_old text;
  v_new text;
  v_pairs text[][];
  v_pair text[];
BEGIN
  v_definition:=pg_get_functiondef(to_regprocedure('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'));
  IF v_definition IS NULL THEN RAISE EXCEPTION 'stamp_sheet_target_missing'; END IF;
  -- Idempotent.
  IF strpos(v_definition,'stamped-production-panel-proof')>0 THEN RETURN; END IF;
  IF strpos(v_definition,'assert_final_stamped_views')=0
    OR strpos(v_definition,'exact_stamp_artifact_set_required')=0
  THEN RAISE EXCEPTION 'stamp_sheet_unexpected_stamp_contract'; END IF;

  v_patched:=v_definition;
  v_old:=E'  IF v_stage.stage_key=''stamp.build'' THEN\n';
  v_new:=E'  IF v_stage.stage_key=''zip.build'' THEN\n';
  IF (length(v_patched)-length(replace(v_patched,v_old,'')))/length(v_old) IS DISTINCT FROM 1
    OR (length(v_patched)-length(replace(v_patched,v_new,'')))/length(v_new) IS DISTINCT FROM 1
  THEN RAISE EXCEPTION 'stamp_sheet_boundaries_not_unique'; END IF;
  v_start:=strpos(v_patched,v_old); v_finish:=strpos(v_patched,v_new);
  IF v_finish<=v_start THEN RAISE EXCEPTION 'stamp_sheet_boundaries_invalid'; END IF;
  v_block:=substr(v_patched,v_start,v_finish-v_start);

  v_pairs:=ARRAY[
    ARRAY[$old$      v_proof_view_count integer;
$old$,$new$      v_proof_view_count integer;
      v_proof_sheet_hash text;
      v_proof_sheet_count integer;
$new$],
    ARRAY[$old$      v_proof_view_count:=designpro_private.assert_final_stamped_views(v_run.id,p_receipt,p_artifacts);
$old$,$new$      v_proof_view_count:=designpro_private.assert_final_stamped_views(v_run.id,p_receipt,p_artifacts);

      -- THE TRIZONE(TM) PRODUCTION PANEL PROOF IS SEALED TOO (2026-09-22).
      -- The frozen snapshot names the three-zone sheet by content hash; a
      -- revision authored before that document has none and gets no fourth
      -- stamp. When the runtime stamps it, the artifact and the receipt must
      -- both bind to that exact sheet. Its absence is admitted so the gate
      -- can land before the runtime that emits it.
      v_proof_sheet_hash:=CASE
        WHEN jsonb_typeof(v_source.snapshot->'panelProofAuthoring')='object'
          AND COALESCE(v_source.snapshot#>>'{panelProofAuthoring,proofSha256}','') ~ '^[0-9a-f]{64}$'
        THEN v_source.snapshot#>>'{panelProofAuthoring,proofSha256}'
        ELSE NULL END;
      v_proof_sheet_count:=(SELECT count(*)::int
        FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
        WHERE a->>'kind'='stamp' AND a->>'surfaceKey'='stamped-production-panel-proof');
      IF v_proof_sheet_hash IS NULL THEN
        IF v_proof_sheet_count<>0
          OR COALESCE(p_receipt->'stampedProductionPanelProof','null'::jsonb) IS DISTINCT FROM 'null'::jsonb
        THEN RAISE EXCEPTION 'production_panel_proof_stamp_without_sheet'; END IF;
      ELSIF v_proof_sheet_count=0 THEN
        IF COALESCE(p_receipt->'stampedProductionPanelProof','null'::jsonb) IS DISTINCT FROM 'null'::jsonb
        THEN RAISE EXCEPTION 'production_panel_proof_stamp_unreceipted'; END IF;
      ELSIF v_proof_sheet_count<>1
        OR jsonb_typeof(p_receipt->'stampedProductionPanelProof') IS DISTINCT FROM 'object'
        OR COALESCE(p_receipt#>>'{stampedProductionPanelProof,contentHash}','') !~ '^[0-9a-f]{64}$'
        OR p_receipt#>>'{stampedProductionPanelProof,sourceProofHash}' IS DISTINCT FROM v_proof_sheet_hash
        OR p_receipt#>>'{stampedProductionPanelProof,contentHash}' IN (
          p_receipt->>'sealHash',p_receipt->>'stampHash',p_receipt->>'certificateHash')
        OR NOT EXISTS(SELECT 1
          FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
          WHERE a->>'kind'='stamp' AND a->>'surfaceKey'='stamped-production-panel-proof'
            AND lower(a->>'contentHash')=p_receipt#>>'{stampedProductionPanelProof,contentHash}'
            AND a->>'storagePath'=p_receipt#>>'{stampedProductionPanelProof,storagePath}'
            AND lower(a#>>'{metadata,sourceProofHash}')=v_proof_sheet_hash
            AND a#>>'{metadata,sealHash}'=p_receipt->>'sealHash'
            AND a#>>'{metadata,designId}'=v_design_id
            AND a#>>'{metadata,orderNumber}'=v_order_number)
      THEN RAISE EXCEPTION 'production_panel_proof_stamp_invalid'; END IF;
$new$],
    ARRAY[$old$      IF jsonb_array_length(COALESCE(p_artifacts,'[]'::jsonb)) IS DISTINCT FROM (3+v_proof_view_count)
$old$,$new$      IF jsonb_array_length(COALESCE(p_artifacts,'[]'::jsonb)) IS DISTINCT FROM (3+v_proof_view_count+v_proof_sheet_count)
$new$],
    ARRAY[$old$              OR (a->>'surfaceKey' NOT IN ('seal','stamped-proof','certificate')
$old$,$new$              OR (a->>'surfaceKey' NOT IN ('seal','stamped-proof','certificate','stamped-production-panel-proof')
$new$]
  ];
  FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
    v_old:=v_pair[1]; v_new:=v_pair[2];
    IF (length(v_block)-length(replace(v_block,v_old,'')))/length(v_old) IS DISTINCT FROM 1
    THEN RAISE EXCEPTION 'stamp_sheet_anchor_not_unique: %', left(v_old,60); END IF;
    v_block:=replace(v_block,v_old,v_new);
  END LOOP;
  v_patched:=substr(v_patched,1,v_start-1)||v_block||substr(v_patched,v_finish);

  -- The result, not only the search strings: every earlier stamp gate survives,
  -- the ZIP arm is untouched, and no grammar keyword was schema-qualified.
  v_new:=E'  IF v_stage.stage_key=''zip.build'' THEN\n';
  IF strpos(v_patched,'production_panel_proof_stamp_invalid')=0
    OR strpos(v_patched,'exact_stamp_business_identity_required')=0
    OR strpos(v_patched,'assert_final_stamped_views')=0
    OR strpos(v_patched,'''certificate''')=0
    OR substr(v_patched,strpos(v_patched,v_new)) IS DISTINCT FROM substr(v_definition,strpos(v_definition,v_new))
    OR substr(v_patched,1,v_start-1) IS DISTINCT FROM substr(v_definition,1,v_start-1)
    OR strpos(v_patched,'pg_catalog.coalesce')>0
  THEN RAISE EXCEPTION 'stamp_sheet_substitution_failed'; END IF;
  EXECUTE v_patched;

  v_definition:=pg_get_functiondef(to_regprocedure('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'));
  IF strpos(v_definition,'stamped-production-panel-proof')=0 THEN RAISE EXCEPTION 'stamp_sheet_not_installed'; END IF;
END $stamp_sheet$;
