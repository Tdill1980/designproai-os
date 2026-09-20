-- Reuse the installed paid pipeline. New builds add PDF; completed old builds
-- keep their exact frozen format contract. No receipt or artifact is rewritten.
CREATE OR REPLACE FUNCTION designpro_private.production_output_formats(p_run_id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY INVOKER
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
  IF v_build.output->>'outputFormatContract'='designpro.production-formats.v2'
    AND v_build.output->'outputCount'='24'::jsonb
    AND v_build.output->'outputFormats'='["png","tiff","eps","pdf"]'::jsonb
  THEN RETURN ARRAY['png','tiff','eps','pdf']; END IF;
  IF v_build.output->>'outputFormatContract' IS NULL AND v_gate->>'outputFormatContract' IS NULL
    AND v_build.output->'outputCount'='18'::jsonb AND v_gate->'requiredOutputFiles'='18'::jsonb
  THEN RETURN ARRAY['png','tiff','eps']; END IF;
  RAISE EXCEPTION 'output_build_format_contract_invalid';
END $fn$;

CREATE OR REPLACE FUNCTION designpro_private.assert_production_output_build(
  p_run_id uuid,p_receipt jsonb,p_receipt_hash text,p_artifacts jsonb
) RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public,designpro_private AS $fn$
DECLARE v_gate jsonb;
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
  IF v_gate->'productionPackAuthorized' IS DISTINCT FROM 'true'::jsonb
    OR p_receipt->>'outputFormatContract' IS DISTINCT FROM 'designpro.production-formats.v2'
    OR p_receipt->'outputFormats' IS DISTINCT FROM '["png","tiff","eps","pdf"]'::jsonb
    OR p_receipt->'outputCount' IS DISTINCT FROM '24'::jsonb
    OR COALESCE(p_receipt->>'outputSetHash','') !~ '^[0-9a-f]{64}$'
    OR p_receipt_hash IS DISTINCT FROM designpro_private.atlas_revision_hash(p_receipt)
    OR jsonb_typeof(p_artifacts) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'production_pdf_output_build_required'; END IF;
  IF jsonb_array_length(p_artifacts)<>24
    OR (SELECT count(DISTINCT (a->>'surfaceKey',a#>>'{metadata,format}')) FROM jsonb_array_elements(p_artifacts) a)<>24
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_artifacts) a
      WHERE a->>'kind' IS DISTINCT FROM 'output'
        OR NOT COALESCE(a->>'surfaceKey'=ANY(ARRAY['driver','passenger','hood','roof','front','rear']),false)
        OR NOT COALESCE(a#>>'{metadata,format}'=ANY(ARRAY['png','tiff','eps','pdf']),false)
        OR COALESCE(a->>'contentHash','') !~ '^[0-9a-f]{64}$'
        OR a->>'storagePath' NOT LIKE '%.'||(a#>>'{metadata,format}'))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_artifacts) pdf WHERE pdf#>>'{metadata,format}'='pdf'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_artifacts) png
        WHERE png->>'surfaceKey'=pdf->>'surfaceKey' AND png#>>'{metadata,format}'='png'
          AND pdf#>>'{metadata,sourcePngHash}'=png->>'contentHash'))
  THEN RAISE EXCEPTION 'production_pdf_output_artifact_set_required'; END IF;
END $fn$;

DO $migration$
DECLARE v_definition text; v_patched text; v_start integer; v_end integer;
  v_block text; v_old text; v_new text;
BEGIN
  v_definition:=pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure);
  IF strpos(v_definition,'production_output_formats')>0 THEN RETURN; END IF;
  IF strpos(v_definition,'assert_final_proof_join')=0 OR strpos(v_definition,'call12.topaz-upscale')=0
  THEN RAISE EXCEPTION 'paid_pdf_unexpected_stage_contract'; END IF;
  v_old:=$anchor$  IF v_stage.stage_key='revision.freeze' THEN$anchor$;
  IF (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1
  THEN RAISE EXCEPTION 'paid_pdf_build_anchor_not_unique'; END IF;
  v_new:=$replacement$  IF v_stage.stage_key='output.build' THEN
    PERFORM designpro_private.assert_production_output_build(v_run.id,p_receipt,p_receipt_hash,p_artifacts);
  END IF;
  IF v_stage.stage_key='revision.freeze' THEN$replacement$;
  v_patched:=replace(v_definition,v_old,v_new);
  v_start:=strpos(v_patched,$anchor$  ELSIF v_stage.stage_key='output.verify' THEN$anchor$);
  v_end:=strpos(v_patched,$anchor$  ELSIF v_stage.stage_key='stamp.build' THEN$anchor$);
  IF v_start=0 OR v_end<=v_start THEN RAISE EXCEPTION 'paid_pdf_verify_anchors_invalid'; END IF;
  v_block:=substr(v_patched,v_start,v_end-v_start);
  IF strpos(v_block,$anchor$'exactFormatSet' IS DISTINCT FROM '["png","tiff","eps"]'::jsonb$anchor$)=0
    OR (length(v_block)-length(replace(v_block,'IS DISTINCT FROM 18','')))/length('IS DISTINCT FROM 18')<>4
    OR strpos(v_block,$anchor$unnest(ARRAY['png','tiff','eps'])$anchor$)=0
  THEN RAISE EXCEPTION 'paid_pdf_verify_contract_changed'; END IF;
  v_new:=replace(v_block,$anchor$'exactFormatSet' IS DISTINCT FROM '["png","tiff","eps"]'::jsonb$anchor$,
    $replacement$'exactFormatSet' IS DISTINCT FROM to_jsonb(designpro_private.production_output_formats(v_run.id))$replacement$);
  v_new:=replace(v_new,'IS DISTINCT FROM 18','IS DISTINCT FROM (6*cardinality(designpro_private.production_output_formats(v_run.id)))');
  v_new:=replace(v_new,$anchor$unnest(ARRAY['png','tiff','eps'])$anchor$,
    $replacement$unnest(designpro_private.production_output_formats(v_run.id))$replacement$);
  v_patched:=overlay(v_patched placing v_new from v_start for v_end-v_start);
  EXECUTE v_patched;
END $migration$;

REVOKE ALL ON FUNCTION designpro_private.production_output_formats(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION designpro_private.assert_production_output_build(uuid,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION designpro_private.production_output_formats(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION designpro_private.assert_production_output_build(uuid,jsonb,text,jsonb) TO service_role;
