-- PAID OUTPUT CONTRACT v4: FIVE FORMATS x TWO VARIANTS x SIX SURFACES = 60.
--
-- The three-zone Production Panel Proof gives every surface a CLEAN (Zone 2)
-- panel beside its BRANDED one, and the production pack now ships both:
-- `designpro.production-formats.v4` is png/tiff/eps/pdf/jpg x branded/clean x
-- six surfaces. The runtime's build receipt carries `outputVariants`, every
-- output artifact carries `metadata.variant`, and the verify receipt carries
-- `exactVariantSet`. The Topaz-enhanced clean panel is its own artifact kind,
-- `upscaled-clean-panel`, so the CHECK must admit it.
--
-- Also admitted: `designpro.production-formats.v3` (the five formats, no
-- variants, 30 files) -- what PR #600 emits today and what the 20260920113000
-- gate refuses, because that gate pins v2 by name. v2 (24) and the legacy
-- null-contract build (18) keep exactly the acceptance they have now: a
-- completed old build is a frozen contract and is never rewritten.
--
-- Patched the way 20260920113000 patched: the two helpers it created are
-- replaced (they are this feature's own); `complete_designpro_stage` is NOT
-- re-emitted -- its live body is read back with pg_get_functiondef, each
-- anchor is asserted to occur exactly the expected number of times INSIDE the
-- output.verify block, the block is rewritten and EXECUTEd, and the result is
-- read back and asserted. Re-running is a no-op (the `production_output_file_count`
-- marker is the idempotency check).

-- 1. The new artifact kind. Additive: 'upscaled-clean-panel' lands beside
--    'upscaled-panel'; every existing kind keeps its place.
ALTER TABLE public.designpro_artifacts
  DROP CONSTRAINT IF EXISTS designpro_artifacts_artifact_kind_check;
ALTER TABLE public.designpro_artifacts
  ADD CONSTRAINT designpro_artifacts_artifact_kind_check CHECK (artifact_kind IN (
    'flat-proof','panel','qc-panel','corrected-panel','upscaled-panel','upscaled-clean-panel',
    'logo','output','stamp','zip','wrapbox-manifest'
  ));

-- 2. ONE validator of the completed build receipt, returning which contract it
--    froze. formats / variants / file_count all derive from it, so the four
--    readers cannot disagree about what a build was.
CREATE OR REPLACE FUNCTION designpro_private.production_output_contract(p_run_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public,designpro_private AS $fn$
DECLARE v_build public.designpro_workflow_stages%ROWTYPE; v_gate jsonb;
BEGIN
  SELECT * INTO v_build FROM public.designpro_workflow_stages
    WHERE run_id=p_run_id AND stage_key='output.build' AND status='completed';
  SELECT output->'authorizedAssetManifest' INTO v_gate FROM public.designpro_workflow_stages
    WHERE run_id=p_run_id AND stage_key='await_purchase' AND status='completed'
      AND verification @> '{"verified":true}'::jsonb;
  IF v_build.id IS NULL OR v_build.verification->'verified' IS DISTINCT FROM 'true'::jsonb
    OR v_build.output->'verified' IS DISTINCT FROM 'true'::jsonb
    OR v_build.output_hash IS DISTINCT FROM designpro_private.atlas_revision_hash(v_build.output)
    OR COALESCE(v_build.output->>'outputSetHash','') !~ '^[0-9a-f]{64}$'
    OR v_gate->'productionPackAuthorized' IS DISTINCT FROM 'true'::jsonb
  THEN RAISE EXCEPTION 'output_build_receipt_invalid'; END IF;
  IF v_build.output->>'outputFormatContract'='designpro.production-formats.v4'
    AND v_build.output->'outputCount'='60'::jsonb
    AND v_build.output->'outputFormats'='["png","tiff","eps","pdf","jpg"]'::jsonb
    AND v_build.output->'outputVariants'='["branded","clean"]'::jsonb
  THEN RETURN 'designpro.production-formats.v4'; END IF;
  IF v_build.output->>'outputFormatContract'='designpro.production-formats.v3'
    AND v_build.output->'outputCount'='30'::jsonb
    AND v_build.output->'outputFormats'='["png","tiff","eps","pdf","jpg"]'::jsonb
    AND COALESCE(v_build.output->'outputVariants','["branded"]'::jsonb)='["branded"]'::jsonb
  THEN RETURN 'designpro.production-formats.v3'; END IF;
  IF v_build.output->>'outputFormatContract'='designpro.production-formats.v2'
    AND v_build.output->'outputCount'='24'::jsonb
    AND v_build.output->'outputFormats'='["png","tiff","eps","pdf"]'::jsonb
    AND COALESCE(v_build.output->'outputVariants','["branded"]'::jsonb)='["branded"]'::jsonb
  THEN RETURN 'designpro.production-formats.v2'; END IF;
  IF v_build.output->>'outputFormatContract' IS NULL AND v_gate->>'outputFormatContract' IS NULL
    AND v_build.output->'outputCount'='18'::jsonb AND v_gate->'requiredOutputFiles'='18'::jsonb
  THEN RETURN 'legacy'; END IF;
  RAISE EXCEPTION 'output_build_format_contract_invalid';
END $fn$;

CREATE OR REPLACE FUNCTION designpro_private.production_output_formats(p_run_id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public,designpro_private AS $fn$
BEGIN
  RETURN CASE designpro_private.production_output_contract(p_run_id)
    WHEN 'designpro.production-formats.v4' THEN ARRAY['png','tiff','eps','pdf','jpg']
    WHEN 'designpro.production-formats.v3' THEN ARRAY['png','tiff','eps','pdf','jpg']
    WHEN 'designpro.production-formats.v2' THEN ARRAY['png','tiff','eps','pdf']
    ELSE ARRAY['png','tiff','eps'] END;
END $fn$;

CREATE OR REPLACE FUNCTION designpro_private.production_output_variants(p_run_id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public,designpro_private AS $fn$
BEGIN
  RETURN CASE designpro_private.production_output_contract(p_run_id)
    WHEN 'designpro.production-formats.v4' THEN ARRAY['branded','clean']
    ELSE ARRAY['branded'] END;
END $fn$;

CREATE OR REPLACE FUNCTION designpro_private.production_output_file_count(p_run_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public,designpro_private AS $fn$
BEGIN
  RETURN 6*cardinality(designpro_private.production_output_formats(p_run_id))
    *cardinality(designpro_private.production_output_variants(p_run_id));
END $fn$;

-- 3. The output.build gate. The unpurchased branch is the 20260920113000 text
--    verbatim. A purchased build names its contract and is then held to that
--    contract's exact format set, variant set and file count; every pdf and
--    jpg must bind through metadata.sourcePngHash to the png of the SAME
--    surface AND the SAME variant, so a clean pdf cannot be rasterised from the
--    branded png. v2/v3 artifacts carry no variant; absent reads as 'branded'.
CREATE OR REPLACE FUNCTION designpro_private.assert_production_output_build(
  p_run_id uuid,p_receipt jsonb,p_receipt_hash text,p_artifacts jsonb
) RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public,designpro_private AS $fn$
DECLARE v_gate jsonb; v_contract text; v_formats text[]; v_variants text[]; v_count integer;
BEGIN
  SELECT output->'authorizedAssetManifest' INTO v_gate FROM public.designpro_workflow_stages
    WHERE run_id=p_run_id AND stage_key='await_purchase' AND status='completed'
      AND verification @> '{"verified":true}'::jsonb;
  IF v_gate->'productionPackAuthorized'='false'::jsonb THEN
    IF p_receipt->'outputCount' IS DISTINCT FROM '0'::jsonb
      OR p_receipt->'skippedUnpurchased' IS DISTINCT FROM '["output"]'::jsonb
      OR COALESCE(p_artifacts,'[]'::jsonb) IS DISTINCT FROM '[]'::jsonb
    THEN RAISE EXCEPTION 'output_unpurchased_present'; END IF;
    RETURN;
  END IF;
  v_contract:=p_receipt->>'outputFormatContract';
  IF v_contract='designpro.production-formats.v4' THEN
    v_formats:=ARRAY['png','tiff','eps','pdf','jpg']; v_variants:=ARRAY['branded','clean'];
  ELSIF v_contract='designpro.production-formats.v3' THEN
    v_formats:=ARRAY['png','tiff','eps','pdf','jpg']; v_variants:=ARRAY['branded'];
  ELSIF v_contract='designpro.production-formats.v2' THEN
    v_formats:=ARRAY['png','tiff','eps','pdf']; v_variants:=ARRAY['branded'];
  ELSE RAISE EXCEPTION 'production_pdf_output_build_required'; END IF;
  v_count:=6*cardinality(v_formats)*cardinality(v_variants);
  IF v_gate->'productionPackAuthorized' IS DISTINCT FROM 'true'::jsonb
    OR p_receipt->'outputFormats' IS DISTINCT FROM to_jsonb(v_formats)
    OR (cardinality(v_variants)>1 AND p_receipt->'outputVariants' IS DISTINCT FROM to_jsonb(v_variants))
    OR (cardinality(v_variants)=1 AND COALESCE(p_receipt->'outputVariants',to_jsonb(v_variants)) IS DISTINCT FROM to_jsonb(v_variants))
    OR p_receipt->'outputCount' IS DISTINCT FROM to_jsonb(v_count)
    OR COALESCE(p_receipt->>'outputSetHash','') !~ '^[0-9a-f]{64}$'
    OR p_receipt_hash IS DISTINCT FROM designpro_private.atlas_revision_hash(p_receipt)
    OR jsonb_typeof(p_artifacts) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'production_pdf_output_build_required'; END IF;
  IF jsonb_array_length(p_artifacts)<>v_count
    OR (SELECT count(DISTINCT (a->>'surfaceKey',COALESCE(a#>>'{metadata,variant}','branded'),a#>>'{metadata,format}'))
        FROM jsonb_array_elements(p_artifacts) a)<>v_count
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_artifacts) a
      WHERE a->>'kind' IS DISTINCT FROM 'output'
        OR NOT COALESCE(a->>'surfaceKey'=ANY(ARRAY['driver','passenger','hood','roof','front','rear']),false)
        OR NOT COALESCE(a#>>'{metadata,format}'=ANY(v_formats),false)
        OR NOT COALESCE(COALESCE(a#>>'{metadata,variant}','branded')=ANY(v_variants),false)
        OR COALESCE(a->>'contentHash','') !~ '^[0-9a-f]{64}$'
        OR a->>'storagePath' NOT LIKE '%.'||(a#>>'{metadata,format}'))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_artifacts) derived
      WHERE derived#>>'{metadata,format}' IN ('pdf','jpg')
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_artifacts) png
        WHERE png->>'surfaceKey'=derived->>'surfaceKey' AND png#>>'{metadata,format}'='png'
          AND COALESCE(png#>>'{metadata,variant}','branded')=COALESCE(derived#>>'{metadata,variant}','branded')
          AND derived#>>'{metadata,sourcePngHash}'=png->>'contentHash'))
  THEN RAISE EXCEPTION 'production_pdf_output_artifact_set_required'; END IF;
END $fn$;

-- 4. output.verify learns the variant. Every count in the block was
--    `6 * formats`; it is now the run's own file count (which multiplies in the
--    variants), the per-file DISTINCT keys on (surface, variant, format), the
--    receipt's exactVariantSet is pinned whenever the contract has more than
--    one variant, the surface x format presence check also walks the variants,
--    and the artifact ledger join carries the variant. Anchors are the
--    post-20260920113000 text; counts are asserted before anything is replaced.
DO $migration$
DECLARE v_definition text; v_patched text; v_start integer; v_end integer;
  v_block text; v_old text; v_new text; v_pairs text[][]; v_pair text[]; v_expected integer;
BEGIN
  v_definition:=pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure);
  IF strpos(v_definition,'production_output_file_count')>0 THEN RETURN; END IF;
  IF strpos(v_definition,'production_output_formats')=0 OR strpos(v_definition,'assert_production_output_build')=0
    OR strpos(v_definition,'assert_final_proof_join')=0 OR strpos(v_definition,'call12.topaz-upscale')=0
  THEN RAISE EXCEPTION 'output_v4_unexpected_stage_contract'; END IF;
  v_start:=strpos(v_definition,$anchor$  ELSIF v_stage.stage_key='output.verify' THEN$anchor$);
  v_end:=strpos(v_definition,$anchor$  ELSIF v_stage.stage_key='stamp.build' THEN$anchor$);
  IF v_start=0 OR v_end<=v_start THEN RAISE EXCEPTION 'output_v4_verify_anchors_invalid'; END IF;
  v_block:=substr(v_definition,v_start,v_end-v_start);
  -- {anchor, replacement, expected occurrences inside the block}
  v_pairs:=ARRAY[
    ARRAY[$anchor$(6*cardinality(designpro_private.production_output_formats(v_run.id)))$anchor$,
      $replacement$designpro_private.production_output_file_count(v_run.id)$replacement$,'4'],
    ARRAY[$anchor$count(DISTINCT (f->>'surfaceKey',f->>'format'))$anchor$,
      $replacement$count(DISTINCT (f->>'surfaceKey',COALESCE(f->>'variant','branded'),f->>'format'))$replacement$,'1'],
    ARRAY[$anchor$'exactFormatSet' IS DISTINCT FROM to_jsonb(designpro_private.production_output_formats(v_run.id))$anchor$,
      $replacement$'exactFormatSet' IS DISTINCT FROM to_jsonb(designpro_private.production_output_formats(v_run.id)) OR (cardinality(designpro_private.production_output_variants(v_run.id))>1 AND p_receipt->'exactVariantSet' IS DISTINCT FROM to_jsonb(designpro_private.production_output_variants(v_run.id)))$replacement$,'1'],
    ARRAY[$anchor$CROSS JOIN unnest(designpro_private.production_output_formats(v_run.id)) format$anchor$,
      $replacement$CROSS JOIN unnest(designpro_private.production_output_formats(v_run.id)) format
        CROSS JOIN unnest(designpro_private.production_output_variants(v_run.id)) variant$replacement$,'1'],
    ARRAY[$anchor$WHERE f->>'surfaceKey'=surface_key AND f->>'format'=format$anchor$,
      $replacement$WHERE f->>'surfaceKey'=surface_key AND f->>'format'=format AND COALESCE(f->>'variant','branded')=variant$replacement$,'1'],
    ARRAY[$anchor$AND a.metadata->>'format'=f->>'format'$anchor$,
      $replacement$AND a.metadata->>'format'=f->>'format' AND COALESCE(a.metadata->>'variant','branded')=COALESCE(f->>'variant','branded')$replacement$,'1']
  ];
  v_patched:=v_block;
  FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
    v_old:=v_pair[1]; v_new:=v_pair[2]; v_expected:=v_pair[3]::integer;
    IF (length(v_patched)-length(replace(v_patched,v_old,'')))/length(v_old) IS DISTINCT FROM v_expected
    THEN RAISE EXCEPTION 'output_v4_verify_anchor_count_mismatch: %',v_old; END IF;
    v_patched:=replace(v_patched,v_old,v_new);
  END LOOP;
  v_patched:=overlay(v_definition placing v_patched from v_start for v_end-v_start);
  EXECUTE v_patched;
  -- Read the installed body back; a patch that did not land is not a patch.
  v_definition:=pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure);
  v_old:='designpro_private.production_output_file_count(v_run.id)';
  IF (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) IS DISTINCT FROM 4
    OR strpos(v_definition,'(6*cardinality(designpro_private.production_output_formats(v_run.id)))')>0
    OR strpos(v_definition,$anchor$count(DISTINCT (f->>'surfaceKey',COALESCE(f->>'variant','branded'),f->>'format'))$anchor$)=0
    OR strpos(v_definition,$anchor$p_receipt->'exactVariantSet' IS DISTINCT FROM to_jsonb(designpro_private.production_output_variants(v_run.id))$anchor$)=0
    OR strpos(v_definition,$anchor$CROSS JOIN unnest(designpro_private.production_output_variants(v_run.id)) variant$anchor$)=0
    OR strpos(v_definition,$anchor$COALESCE(a.metadata->>'variant','branded')=COALESCE(f->>'variant','branded')$anchor$)=0
  THEN RAISE EXCEPTION 'output_v4_verify_patch_not_installed'; END IF;
END $migration$;

REVOKE ALL ON FUNCTION designpro_private.production_output_contract(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION designpro_private.production_output_formats(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION designpro_private.production_output_variants(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION designpro_private.production_output_file_count(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION designpro_private.assert_production_output_build(uuid,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION designpro_private.production_output_contract(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION designpro_private.production_output_formats(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION designpro_private.production_output_variants(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION designpro_private.production_output_file_count(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION designpro_private.assert_production_output_build(uuid,jsonb,text,jsonb) TO service_role;
