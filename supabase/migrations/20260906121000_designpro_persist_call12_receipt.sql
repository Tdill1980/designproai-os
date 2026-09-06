-- Call 12 completed successfully in production but output.build could not read
-- its receipt because complete_designpro_stage never assigned a receipt_kind
-- for enhance.upscale.  The artifacts and stage output were durable; only the
-- indexed receipt row was omitted.  Patch the existing guarded completion RPC
-- at the single stage-dispatch anchor so future retries and clean runs persist
-- the receipt atomically with the six enhanced panels.

DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_anchor constant text := E'  ELSIF v_stage.stage_key=\'output.verify\' THEN\n    v_kind:=\'output.verified\';';
  v_replacement constant text := E'  ELSIF v_stage.stage_key=\'enhance.upscale\' THEN\n    v_kind:=\'call12.topaz-upscale\';\n  ELSIF v_stage.stage_key=\'output.verify\' THEN\n    v_kind:=\'output.verified\';';
  v_occurrences integer;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'
    )
  );

  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
  ) / pg_catalog.length(v_anchor);

  IF v_occurrences IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'complete_designpro_stage Call 12 receipt anchor count %, expected 1',
      v_occurrences;
  END IF;

  v_patched := pg_catalog.replace(v_definition, v_anchor, v_replacement);
  EXECUTE v_patched;
END
$migration$;

REVOKE ALL ON FUNCTION public.complete_designpro_stage(
  uuid,uuid,jsonb,jsonb,text,jsonb
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_designpro_stage(
  uuid,uuid,jsonb,jsonb,text,jsonb
) TO service_role;

