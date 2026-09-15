-- CALL 11 WRITES ITS RECEIPT. THE PRODUCTION PACK HAS REQUIRED IT SINCE 09-10.
--
-- 20260817060000 added the panels.delogo stage and 'call11.qc-panels' to the
-- receipt-kind allowlist, but no migration ever taught complete_designpro_stage
-- to SET v_kind for that stage, so the "IF v_kind IS NOT NULL THEN INSERT INTO
-- designpro_stage_receipts" line never fired for it. Measured live 2026-09-14:
-- fourteen completed panels.delogo stages since 09-01, all with a full receipt
-- in their `output` and six qc-panel artifacts, ZERO receipt rows.
--
-- Nothing read that receipt until the standalone claimant (82da00d, 09-10),
-- whose source.verify does: `receipt(sb, sourceRunId, "call11.qc-panels")`.
-- So every production pack opened since 09-10 died at source.verify with
-- receipt_missing -- the canary run 34907914664 (2026-09-14 23:17) walked the
-- whole entice pack clean and failed exactly there. The 09-08 production run
-- passed only because the previous runtime never asked.
--
-- Two parts, both deterministic:
--   1. The branch. panels.delogo completes as receipt kind call11.qc-panels,
--      validated the way the other kinds are: Call 11, the QC-duplicate role,
--      never authoritative, the branded set preserved, six named surfaces with
--      six distinct hashes that match the qc-panel artifacts being ledgered in
--      the same call, and sourcePanelHashes equal to Call 9's own receipt.
--   2. The backfill. Completed panels.delogo stages already hold p_receipt in
--      `output` and its hash in `output_hash`; the receipt row is re-derived
--      from that stored evidence, and only where it re-validates against the
--      run's qc-panel artifacts and Call 9 receipt.
--
-- Patched in place with the unique-anchor mechanism the earlier patches use:
-- restating the function would silently drop what they patched in.

DO $migration$
DECLARE
  v_definition text;
  v_anchor text;
  v_branch text;
BEGIN
  v_definition:=pg_get_functiondef(to_regprocedure('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'));
  IF v_definition IS NULL
    OR strpos(v_definition,'IF v_kind IS NOT NULL THEN INSERT INTO public.designpro_stage_receipts')=0
    OR strpos(v_definition,'call11.qc-panels')>0
  THEN RAISE EXCEPTION 'call11_receipt_branch_unexpected_complete_contract'; END IF;

  v_anchor:=E'  ELSIF v_stage.stage_key=''proof.build'' THEN\n    v_kind:=''call8.flat-proof'';\n';
  IF (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) IS DISTINCT FROM 1
  THEN RAISE EXCEPTION 'call11_receipt_branch_anchor_not_unique'; END IF;

  v_branch:=$branch$  ELSIF v_stage.stage_key='panels.delogo' THEN
    -- CALL 11: the six non-printing QC duplicates. Ledgered as a receipt so
    -- source.verify can bind the production pack to these exact bytes.
    v_kind:='call11.qc-panels';
    IF (p_receipt->>'call') IS DISTINCT FROM '11'
      OR p_receipt->>'receiptKind' IS DISTINCT FROM 'call11.qc-panels'
      OR p_receipt->>'role' IS DISTINCT FROM 'panelpro-qc-duplicate'
      OR COALESCE(p_receipt->'authoritative','null'::jsonb) IS DISTINCT FROM 'false'::jsonb
      OR COALESCE(p_receipt->'brandedSetPreserved','null'::jsonb) IS DISTINCT FROM 'true'::jsonb
      OR jsonb_typeof(p_receipt->'qcPanelHashes') IS DISTINCT FROM 'object'
      OR jsonb_typeof(p_receipt->'sourcePanelHashes') IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(p_receipt->'qcPanelHashes'))<>6
      OR EXISTS(SELECT 1 FROM unnest(ARRAY['driver','passenger','hood','roof','front','rear']) k
                WHERE lower(COALESCE(p_receipt->'qcPanelHashes'->>k,'')) !~ '^[0-9a-f]{64}$')
      OR (SELECT count(DISTINCT lower(q.value)) FROM jsonb_each_text(p_receipt->'qcPanelHashes') q)<>6
      OR NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts c9
                    WHERE c9.run_id=v_run.id AND c9.receipt_kind='call9.surface-panels'
                      AND c9.receipt->'panelHashes'=p_receipt->'sourcePanelHashes')
      OR EXISTS(SELECT 1 FROM jsonb_each_text(p_receipt->'qcPanelHashes') q
                WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a
                                 WHERE a->>'kind'='qc-panel' AND a->>'surfaceKey'=q.key
                                   AND lower(a->>'contentHash')=lower(q.value)))
    THEN RAISE EXCEPTION 'call11_qc_panel_receipt_invalid'; END IF;
$branch$;
  v_definition:=replace(v_definition,v_anchor,v_branch||v_anchor);
  EXECUTE v_definition;
END
$migration$;

GRANT EXECUTE ON FUNCTION public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb) TO service_role;

-- Backfill: every completed panels.delogo stage without a receipt row, from
-- the receipt it already stored, re-validated against the run's own ledger.
INSERT INTO public.designpro_stage_receipts(run_id,stage_id,receipt_kind,identity,receipt,receipt_hash)
SELECT s.run_id, s.id, 'call11.qc-panels', COALESCE(s.verification->'identity','{}'::jsonb), s.output, lower(s.output_hash)
FROM public.designpro_workflow_stages s
WHERE s.stage_key='panels.delogo' AND s.status='completed'
  AND s.output_hash ~* '^[0-9a-f]{64}$'
  AND (s.output->>'call')='11'
  AND s.output->>'receiptKind'='call11.qc-panels'
  AND jsonb_typeof(s.output->'qcPanelHashes')='object'
  AND (SELECT count(*) FROM jsonb_object_keys(s.output->'qcPanelHashes'))=6
  AND NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts r WHERE r.stage_id=s.id)
  AND EXISTS(SELECT 1 FROM public.designpro_stage_receipts c9
             WHERE c9.run_id=s.run_id AND c9.receipt_kind='call9.surface-panels'
               AND c9.receipt->'panelHashes'=s.output->'sourcePanelHashes')
  AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(s.output->'qcPanelHashes') q
                 WHERE NOT EXISTS(SELECT 1 FROM public.designpro_artifacts a
                                  WHERE a.run_id=s.run_id AND a.artifact_kind='qc-panel'
                                    AND a.surface_key=q.key AND lower(a.content_hash)=lower(q.value)))
ON CONFLICT DO NOTHING;
