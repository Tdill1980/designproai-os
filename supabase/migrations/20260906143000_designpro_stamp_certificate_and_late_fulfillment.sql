-- Stamp completion must validate the same append-only late-fulfillment
-- identity as final QC and the runtime, and must admit the complete three-file
-- stamp set that the runtime and ZIP contract already require.
--
-- PATCH THE LIVE DEFINITION; DO NOT RESTATE IT. complete_designpro_stage has
-- accumulated the Close-Up, A.T.L.A.S., deferred-Call-8 and Call-12 contracts
-- through guarded in-place migrations. Restating its original body would
-- silently remove those contracts. This migration replaces exactly the one
-- stamp-validation block bounded by two asserted anchors and leaves every
-- other byte of the current function definition intact.

DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_start integer;
  v_finish integer;
  v_occurrences integer;
  v_start_anchor constant text := E'  IF v_stage.stage_key=''stamp.build'' THEN\n';
  v_finish_anchor constant text := E'  IF v_stage.stage_key=''zip.build'' THEN\n';
  v_replacement constant text := $stamp$  IF v_stage.stage_key='stamp.build' THEN
    DECLARE
      v_source public.designpro_revision_sources%ROWTYPE;
      v_fulfillment jsonb;
      v_design_id text;
      v_order_number text;
    BEGIN
      SELECT * INTO v_source
      FROM public.designpro_revision_sources
      WHERE revision_id=v_run.revision_id
        AND owner_id=v_run.owner_id
        AND snapshot_hash=v_run.revision_snapshot_hash;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'immutable_revision_identity_mismatch';
      END IF;

      v_fulfillment:=designpro_private.revision_fulfillment(v_run.revision_id);
      IF v_fulfillment IS NULL
        OR v_fulfillment->>'contractVersion' IS DISTINCT FROM 'designpro.fulfillment-binding.v1'
        OR v_fulfillment->>'revisionId' IS DISTINCT FROM v_run.revision_id::text
        OR COALESCE(v_fulfillment->>'bindingHash','') !~ '^[0-9a-f]{64}$'
        OR v_fulfillment->>'orderNumber' IS DISTINCT FROM v_fulfillment#>>'{delivery,orderNumber}'
      THEN RAISE EXCEPTION 'immutable_revision_fulfillment_mismatch'; END IF;

      -- Historical order-first revisions froze delivery into the snapshot.
      -- Design-first revisions intentionally froze an unbound marker and must
      -- resolve the exact append-only fulfillment carried by the run instead.
      IF pg_catalog.jsonb_typeof(v_source.snapshot->'delivery')='object'
        AND NULLIF(v_source.snapshot->>'orderNumber','') IS NOT NULL
      THEN
        v_order_number:=v_source.snapshot->>'orderNumber';
        IF v_fulfillment->>'orderNumber' IS DISTINCT FROM v_order_number
          OR (v_run.input ? 'fulfillment'
            AND v_run.input->'fulfillment' IS DISTINCT FROM v_fulfillment)
        THEN RAISE EXCEPTION 'immutable_revision_fulfillment_mismatch'; END IF;
      ELSE
        IF v_source.snapshot#>>'{fulfillment,state}' IS DISTINCT FROM 'unbound'
          OR v_source.snapshot ?| ARRAY['orderNumber','delivery']
          OR v_run.input->'fulfillment' IS DISTINCT FROM v_fulfillment
        THEN RAISE EXCEPTION 'immutable_revision_fulfillment_mismatch'; END IF;
        v_order_number:=v_fulfillment->>'orderNumber';
      END IF;

      v_design_id:=v_source.snapshot->>'designId';
      IF v_source.snapshot->>'generationId' IS DISTINCT FROM v_source.generation_id::text
        OR v_design_id IS DISTINCT FROM 'DID-' || upper(substr(
          replace(v_source.generation_id::text,'-',''),1,8
        ))
        OR v_order_number IS DISTINCT FROM btrim(v_order_number)
        OR COALESCE(v_order_number,'') !~ '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
      THEN RAISE EXCEPTION 'immutable_design_id_and_order_number_required'; END IF;

      IF p_receipt->>'receiptKind' IS DISTINCT FROM 'stamp'
        OR p_receipt->>'designId' IS DISTINCT FROM v_design_id
        OR p_receipt->>'orderNumber' IS DISTINCT FROM v_order_number
        OR COALESCE(p_receipt->>'stampHash','') !~ '^[0-9a-f]{64}$'
        OR COALESCE(p_receipt->>'sealHash','') !~ '^[0-9a-f]{64}$'
        OR COALESCE(p_receipt->>'sourceProofHash','') !~ '^[0-9a-f]{64}$'
        OR COALESCE(p_receipt->>'certificateHash','') !~ '^[0-9a-f]{64}$'
        OR (SELECT count(DISTINCT value)
            FROM jsonb_array_elements_text(jsonb_build_array(
              p_receipt->>'stampHash',
              p_receipt->>'sealHash',
              p_receipt->>'certificateHash'
            ))) IS DISTINCT FROM 3
        OR lower(p_receipt_hash) IS DISTINCT FROM p_receipt->>'stampHash'
        OR NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts q
          WHERE q.run_id=v_run.id AND q.receipt_kind='final.human-qc'
            AND q.receipt->>'verifiedBy'=p_receipt->>'verifiedBy'
            AND q.receipt->>'approvalRef'=p_receipt->>'approvalRef'
            AND q.receipt->>'approvedAt'=p_receipt->>'approvedAt'
            AND q.receipt#>>'{qc,designId}'=v_design_id
            AND q.receipt#>>'{qc,orderNumber}'=v_order_number)
      THEN RAISE EXCEPTION 'exact_stamp_business_identity_required'; END IF;

      IF jsonb_typeof(COALESCE(p_artifacts,'[]'::jsonb)) IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'exact_stamp_artifact_set_required'; END IF;

      IF jsonb_array_length(COALESCE(p_artifacts,'[]'::jsonb)) IS DISTINCT FROM 3
        OR (SELECT count(DISTINCT a->>'surfaceKey')
            FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
            WHERE a->>'kind'='stamp'
              AND a->>'surfaceKey' IN ('seal','stamped-proof','certificate')) IS DISTINCT FROM 3
        OR EXISTS(SELECT 1
            FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
            WHERE a->>'kind' IS DISTINCT FROM 'stamp'
              OR a->>'surfaceKey' NOT IN ('seal','stamped-proof','certificate')
              OR a#>>'{metadata,designId}' IS DISTINCT FROM v_design_id
              OR a#>>'{metadata,orderNumber}' IS DISTINCT FROM v_order_number)
        OR NOT EXISTS(SELECT 1
          FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
          WHERE a->>'kind'='stamp' AND a->>'surfaceKey'='seal'
            AND lower(a->>'contentHash')=p_receipt->>'sealHash'
            AND a#>>'{metadata,designId}'=v_design_id
            AND a#>>'{metadata,orderNumber}'=v_order_number)
        OR NOT EXISTS(SELECT 1
          FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
          WHERE a->>'kind'='stamp' AND a->>'surfaceKey'='stamped-proof'
            AND lower(a->>'contentHash')=p_receipt->>'stampHash'
            AND lower(a#>>'{metadata,sourceProofHash}')=p_receipt->>'sourceProofHash'
            AND a#>>'{metadata,designId}'=v_design_id
            AND a#>>'{metadata,orderNumber}'=v_order_number)
        OR NOT EXISTS(SELECT 1
          FROM jsonb_array_elements(COALESCE(p_artifacts,'[]'::jsonb)) a
          WHERE a->>'kind'='stamp' AND a->>'surfaceKey'='certificate'
            AND lower(a->>'contentHash')=p_receipt->>'certificateHash'
            AND a#>>'{metadata,designId}'=v_design_id
            AND a#>>'{metadata,orderNumber}'=v_order_number)
      THEN RAISE EXCEPTION 'exact_stamp_artifact_set_required'; END IF;
    END;
  END IF;
$stamp$;
BEGIN
  v_definition:=pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'
    )
  );

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'complete_designpro_stage_not_found';
  END IF;

  -- Fail closed if the migration chain no longer represents the exact current
  -- workflow contract this patch was reviewed against.
  IF pg_catalog.strpos(v_definition,'workflow_run_is_atlas')=0
    OR pg_catalog.strpos(v_definition,'call8.flat-proof-deferred')=0
    OR pg_catalog.strpos(v_definition,'call9_atlas_panel_promotion_contract_failed')=0
    OR pg_catalog.strpos(v_definition,'FROM public.designpro_revision_sources frozen')=0
    OR pg_catalog.strpos(v_definition,'call12.topaz-upscale')=0
    OR pg_catalog.strpos(v_definition,'exact_seal_and_stamped_proof_identity_required')=0
    OR pg_catalog.strpos(v_definition,'certificateHash')>0
  THEN RAISE EXCEPTION 'complete_designpro_stage_unexpected_live_contract'; END IF;

  v_occurrences:=(
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition,v_start_anchor,''))
  ) / pg_catalog.length(v_start_anchor);
  IF v_occurrences IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'stamp_start_anchor_count_%, expected_1',v_occurrences;
  END IF;

  v_occurrences:=(
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition,v_finish_anchor,''))
  ) / pg_catalog.length(v_finish_anchor);
  IF v_occurrences IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'stamp_finish_anchor_count_%, expected_1',v_occurrences;
  END IF;

  v_start:=pg_catalog.strpos(v_definition,v_start_anchor);
  v_finish:=pg_catalog.strpos(v_definition,v_finish_anchor);
  IF v_start<=0 OR v_finish<=v_start THEN
    RAISE EXCEPTION 'stamp_block_boundaries_invalid';
  END IF;

  v_patched:=pg_catalog.substr(v_definition,1,v_start-1)
    || v_replacement
    || pg_catalog.substr(v_definition,v_finish);
  EXECUTE v_patched;
END
$migration$;

ALTER FUNCTION public.complete_designpro_stage(
  uuid,uuid,jsonb,jsonb,text,jsonb
) SET search_path TO 'pg_catalog','public','extensions';

REVOKE ALL ON FUNCTION public.complete_designpro_stage(
  uuid,uuid,jsonb,jsonb,text,jsonb
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_designpro_stage(
  uuid,uuid,jsonb,jsonb,text,jsonb
) TO service_role;
