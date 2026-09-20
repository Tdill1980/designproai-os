-- Freeze the compositor's existing, original-asset placements at the root
-- production handoff. This is geometry evidence, never designer approval.
CREATE OR REPLACE FUNCTION designpro_private.panel_proof_logo_inventory(
  p_owner uuid,p_revision uuid,p_logo jsonb,p_proof jsonb,p_panels jsonb,p_master_hash text,p_display_name text
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path=pg_catalog,designpro_private AS $fn$
DECLARE v_asset jsonb; v_place jsonb; v_panel jsonb; v_box jsonb;
  v_inventory jsonb:='[]'::jsonb; v_seen text[]:=ARRAY[]::text[];
  v_hash text:=p_logo->>'contentHash'; v_path text:=p_logo->>'storagePath';
  v_ext text; v_surface text; v_x numeric; v_y numeric; v_w numeric; v_h numeric;
BEGIN
  v_ext:=CASE p_logo->>'contentType' WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/webp' THEN 'webp' WHEN 'image/svg+xml' THEN 'svg' WHEN 'application/pdf' THEN 'pdf' END;
  IF p_owner IS NULL OR p_revision IS NULL OR jsonb_typeof(p_logo) IS DISTINCT FROM 'object'
    OR v_ext IS NULL OR COALESCE(v_hash,'') !~ '^[0-9a-f]{64}$'
    OR COALESCE(p_master_hash,'') !~ '^[0-9a-f]{64}$'
    OR COALESCE(p_logo->>'byteSize','') !~ '^[1-9][0-9]*$'
    OR (p_logo->>'byteSize')::numeric>536870912
    OR NOT COALESCE(v_path ~ ('^users/'||p_owner::text||'/revisions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/inputs/logo/'||v_hash||'\.'||CASE WHEN v_ext='jpg' THEN '(jpg|jpeg)' ELSE v_ext END||'$'),false)
  THEN RAISE EXCEPTION 'generation_logo_asset_invalid'; END IF;
  IF p_proof->>'contract' IS DISTINCT FROM 'designpro.atlas-panel-proof-topology.v2'
    OR p_proof#>>'{composition,contract}' IS DISTINCT FROM 'designpro.production-zone-composite.v1'
    OR p_proof#>'{composition,sourceAssetsPreserved}' IS DISTINCT FROM 'true'::jsonb
    OR p_proof->>'masterSha256' IS DISTINCT FROM p_master_hash
    OR p_proof#>'{threeZoneLayout,required}' IS DISTINCT FROM 'true'::jsonb
    OR p_proof#>'{threeZoneLayout,branded}' IS DISTINCT FROM '6'::jsonb
    OR p_proof#>'{threeZoneLayout,backgrounds}' IS DISTINCT FROM '6'::jsonb
    OR jsonb_typeof(p_proof#>'{composition,placements}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_proof#>'{quadrants,cutGraphics}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_proof#>'{quadrants,clean}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_panels) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'generation_logo_placement_manifest_required'; END IF;
  IF jsonb_array_length(p_panels)<>6
    OR (SELECT count(DISTINCT a->>'surfaceKey') FROM jsonb_array_elements(p_panels) a
      WHERE a->>'surfaceKey'=ANY(ARRAY['driver','passenger','hood','roof','front','rear'])
        AND a->>'sourceMasterHash'=p_master_hash AND a->>'contentHash' ~ '^[0-9a-f]{64}$')<>6
    OR jsonb_array_length(p_proof#>'{quadrants,clean}')<>6
    OR (SELECT count(DISTINCT a->>'surfaceKey') FROM jsonb_array_elements(p_proof#>'{quadrants,clean}') a
      WHERE a->>'surfaceKey'=ANY(ARRAY['driver','passenger','hood','roof','front','rear'])
        AND a->>'contentHash' ~ '^[0-9a-f]{64}$' AND length(a->>'storagePath')>0)<>6
  THEN RAISE EXCEPTION 'generation_logo_source_panels_invalid'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_proof#>'{quadrants,cutGraphics}') a
      WHERE a->>'assetRole'='logo')<>1
  THEN RAISE EXCEPTION 'generation_logo_original_identity_mismatch'; END IF;
  SELECT a INTO v_asset FROM jsonb_array_elements(p_proof#>'{quadrants,cutGraphics}') a WHERE a->>'assetRole'='logo';
  IF v_asset->>'storagePath' IS DISTINCT FROM v_path OR v_asset->>'contentHash' IS DISTINCT FROM v_hash
    OR v_asset->'byteSize' IS DISTINCT FROM p_logo->'byteSize'
    OR v_asset->>'contentType' IS DISTINCT FROM p_logo->>'contentType'
    OR v_asset->'persisted' IS DISTINCT FROM 'true'::jsonb
  THEN RAISE EXCEPTION 'generation_logo_original_identity_mismatch'; END IF;
  FOR v_place IN SELECT a FROM jsonb_array_elements(p_proof#>'{composition,placements}') a WHERE a->>'role'='logo'
  LOOP
    v_surface:=v_place->>'surfaceKey'; v_box:=v_place->'box';
    IF NOT COALESCE(v_surface=ANY(ARRAY['driver','passenger','hood','roof','front','rear']),false)
      OR v_surface=ANY(v_seen) OR v_place->'flipped' IS DISTINCT FROM 'false'::jsonb
      OR v_place->>'storagePath' IS DISTINCT FROM v_path OR v_place->>'contentHash' IS DISTINCT FROM v_hash
      OR v_place->'byteSize' IS DISTINCT FROM p_logo->'byteSize'
      OR jsonb_typeof(v_box) IS DISTINCT FROM 'object'
      OR jsonb_typeof(v_box->'xPct') IS DISTINCT FROM 'number' OR jsonb_typeof(v_box->'yPct') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_box->'wPct') IS DISTINCT FROM 'number' OR jsonb_typeof(v_box->'hPct') IS DISTINCT FROM 'number'
    THEN RAISE EXCEPTION 'generation_logo_placement_identity_invalid'; END IF;
    v_x:=(v_box->>'xPct')::numeric; v_y:=(v_box->>'yPct')::numeric;
    v_w:=(v_box->>'wPct')::numeric; v_h:=(v_box->>'hPct')::numeric;
    IF v_x<0 OR v_y<0 OR v_w<=0 OR v_h<=0 OR v_x+v_w>1 OR v_y+v_h>1
    THEN RAISE EXCEPTION 'generation_logo_placement_bounds_invalid'; END IF;
    SELECT a INTO v_panel FROM jsonb_array_elements(p_panels) a WHERE a->>'surfaceKey'=v_surface;
    v_inventory:=v_inventory||jsonb_build_array(jsonb_build_object(
      'identityKey','customer-logo','displayName',COALESCE(NULLIF(btrim(p_display_name),''),'Customer logo'),
      'surfaceKey',v_surface,'storagePath','users/'||p_owner::text||'/revisions/'||p_revision::text||'/inputs/logo/'||v_hash||'.'||v_ext,
      'contentHash',v_hash,'byteSize',p_logo->'byteSize','contentType',p_logo->>'contentType',
      'originalStoragePath',v_path,'box',v_box,'sourcePanelHash',v_panel->>'contentHash','sourceMasterContentHash',p_master_hash));
    v_seen:=array_append(v_seen,v_surface);
  END LOOP;
  IF jsonb_array_length(v_inventory)<>5
    OR NOT v_seen @> ARRAY['driver','passenger','hood','front','rear']
  THEN RAISE EXCEPTION 'generation_logo_placement_manifest_required'; END IF;
  RETURN v_inventory;
END $fn$;

-- Patch the installed function so its later owner, revision, seven-view and
-- workflow fences are retained. Fail migration on an unexpected source shape.
DO $migration$
DECLARE v text; v_old text; v_new text;
BEGIN
  v:=pg_get_functiondef('public.handoff_designpro_generation_to_production(uuid)'::regprocedure);
  IF strpos(v,'panel_proof_logo_inventory')>0 THEN RETURN; END IF;
  v_old:='  v_logo jsonb;';
  IF strpos(v,v_old)=0 THEN RAISE EXCEPTION 'panel_proof_logo_handoff_declaration_missing'; END IF;
  v:=replace(v,v_old,v_old||E'\n  v_logo_inventory jsonb:=''[]''::jsonb;\n  v_logo_attestation jsonb;\n  v_logo_atlas public.designpro_flat_atlas_revisions%ROWTYPE;');
  v_old:=$old$  IF v_logo IS NOT NULL THEN
    RAISE EXCEPTION 'generation_logo_placement_manifest_required';
  END IF;
  v_logo_mode:='none';$old$;
  IF strpos(v,v_old)=0 THEN RAISE EXCEPTION 'panel_proof_logo_handoff_refusal_missing'; END IF;
  v_new:=$new$  IF v_logo IS NOT NULL THEN
    SELECT * INTO v_logo_atlas FROM public.designpro_flat_atlas_revisions a
      WHERE a.id=NULLIF(v_row.engine_receipt->>'atlasRevisionId','')::uuid
        AND a.request_id=v_row.id AND a.owner_id=v_row.owner_id AND a.generation_id=v_row.generation_id
        AND a.revision_sequence=v_row.revision_sequence;
    IF v_input_contract<>'designpro.calls-1-7-input.v3' OR v_logo_atlas.id IS NULL
      OR v_logo_atlas.metadata->>'masterQcPassed' IS DISTINCT FROM 'true'
    THEN RAISE EXCEPTION 'generation_logo_placement_manifest_required'; END IF;
    v_logo_inventory:=designpro_private.panel_proof_logo_inventory(v_owner,v_revision,v_logo,
      v_logo_atlas.metadata->'panelProofAuthoring',v_logo_atlas.metadata->'callOnePanels',v_logo_atlas.master_content_hash,v_company);
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_logo_inventory) item
      WHERE NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='wrap-files' AND o.name=item->>'storagePath'))
    THEN RAISE EXCEPTION 'generation_logo_copy_required'; END IF;
    v_logo_mode:='listed';
    v_logo_attestation:=jsonb_build_object('contractVersion','designpro.panel-proof-logo-inventory.v1',
      'mode','listed','attested',true,'source','deterministic-zone-compositor','placementPending',false,
      'atlasRevisionId',v_logo_atlas.id,'sourceMasterContentHash',v_logo_atlas.master_content_hash);
  ELSE
    v_logo_mode:='none';
  END IF;$new$;
  v:=replace(v,v_old,v_new);
  v_old:=$old$'expectedLogoInventory',pg_catalog.jsonb_build_array(),$old$;
  IF (length(v)-length(replace(v,v_old,'')))/length(v_old)<>2
  THEN RAISE EXCEPTION 'panel_proof_logo_handoff_inventory_shape_changed'; END IF;
  v:=replace(v,v_old,$new$'expectedLogoInventory',v_logo_inventory,$new$);
  v_old:=$old$'logoInventoryAttestation',pg_catalog.jsonb_build_object(
        'mode',v_logo_mode,'attested',true,
        'source',CASE WHEN v_logo IS NULL THEN 'calls-1-7-generated'
          ELSE 'designpro-intake-upload' END,
        'placementPending',v_logo IS NOT NULL
      ),$old$;
  IF (length(v)-length(replace(v,v_old,'')))/length(v_old)<>2
  THEN RAISE EXCEPTION 'panel_proof_logo_handoff_attestation_shape_changed'; END IF;
  v_new:=replace(v_old,'pg_catalog.jsonb_build_object(','COALESCE(v_logo_attestation,pg_catalog.jsonb_build_object(');
  v_new:=left(v_new,length(v_new)-2)||')),';
  v:=replace(v,v_old,v_new);
  v_old:=$old$  v_idempotency:='calls17-handoff:'||v_row.id::text;$old$;
  IF strpos(v,v_old)=0 THEN RAISE EXCEPTION 'panel_proof_logo_handoff_snapshot_anchor_missing'; END IF;
  v_new:=$new$  IF v_logo_atlas.id IS NOT NULL THEN
    v_snapshot:=v_snapshot||jsonb_build_object('panelProofAuthoring',v_logo_atlas.metadata->'panelProofAuthoring',
      'callOnePanels',v_logo_atlas.metadata->'callOnePanels',
      'atlasRevisionId',v_logo_atlas.id,'sourceMasterContentHash',v_logo_atlas.master_content_hash);
  END IF;
$new$||v_old;
  EXECUTE replace(v,v_old,v_new);
END $migration$;

REVOKE ALL ON FUNCTION designpro_private.panel_proof_logo_inventory(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION designpro_private.panel_proof_logo_inventory(uuid,uuid,jsonb,jsonb,jsonb,text,text) TO service_role;
