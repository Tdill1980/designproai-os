-- Call 10's existing inventory trigger requires exactly these eight fields.
-- Original asset/geometry evidence remains in snapshot.panelProofAuthoring;
-- it must not expand the independently validated inventory item contract.
DO $migration$
DECLARE v text; v_old text; v_new text;
BEGIN
  v:=pg_get_functiondef('designpro_private.panel_proof_logo_inventory(uuid,uuid,jsonb,jsonb,jsonb,text,text)'::regprocedure);
  IF strpos(v,'''placementKey'',''customer-logo@''||v_surface')>0 THEN RETURN; END IF;
  v_old:=$old$      'identityKey','customer-logo','displayName',COALESCE(NULLIF(btrim(p_display_name),''),'Customer logo'),
      'surfaceKey',v_surface,'storagePath','users/'||p_owner::text||'/revisions/'||p_revision::text||'/inputs/logo/'||v_hash||'.'||v_ext,
      'contentHash',v_hash,'byteSize',p_logo->'byteSize','contentType',p_logo->>'contentType',
      'originalStoragePath',v_path,'box',v_box,'sourcePanelHash',v_panel->>'contentHash','sourceMasterContentHash',p_master_hash));$old$;
  v_new:=$new$      'placementKey','customer-logo@'||v_surface,'identityKey','customer-logo',
      'displayName',COALESCE(NULLIF(btrim(p_display_name),''),'Customer logo'),
      'surfaceKey',v_surface,'storagePath','users/'||p_owner::text||'/revisions/'||p_revision::text||'/inputs/logo/'||v_hash||'.'||v_ext,
      'contentHash',v_hash,'byteSize',p_logo->'byteSize','contentType',p_logo->>'contentType'));$new$;
  IF (length(v)-length(replace(v,v_old,'')))/length(v_old)<>1
  THEN RAISE EXCEPTION 'panel_proof_inventory_shape_anchor_changed'; END IF;
  EXECUTE replace(v,v_old,v_new);
END $migration$;
