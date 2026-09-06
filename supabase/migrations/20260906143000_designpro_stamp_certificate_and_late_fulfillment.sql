-- Stamp completion must validate the same append-only late-fulfillment
-- identity as final QC and the runtime, and must admit the complete three-file
-- stamp set that the runtime and ZIP contract already require.
--
-- This replaces only the completion RPC. Every non-stamp stage predicate is
-- preserved byte-for-byte from its current definition.

CREATE OR REPLACE FUNCTION public.complete_designpro_stage(
  p_stage_id uuid,p_lease_token uuid,p_identity jsonb,p_receipt jsonb,p_receipt_hash text,p_artifacts jsonb DEFAULT '[]'::jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions' AS $fn$
DECLARE v_stage public.designpro_workflow_stages%ROWTYPE; v_run public.designpro_workflow_runs%ROWTYPE; v_kind text; v_art jsonb; v_views jsonb; v_manifest jsonb; v_snapshot jsonb; v_call9 jsonb;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO v_stage FROM public.designpro_workflow_stages WHERE id=p_stage_id AND status='running' AND lease_token=p_lease_token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=v_stage.run_id FOR UPDATE;
  IF p_identity->>'workflowRunId' IS DISTINCT FROM v_run.id::text OR p_identity->>'revisionId' IS DISTINCT FROM v_run.revision_id::text OR p_identity->>'enticePackId' IS DISTINCT FROM v_run.entice_pack_id::text OR p_identity->>'dimensionManifestId' IS DISTINCT FROM v_run.dimension_manifest_id::text OR lower(p_identity->>'sourceContractHash') IS DISTINCT FROM v_run.source_contract_hash OR lower(p_identity->>'manifestHash') IS DISTINCT FROM v_run.manifest_hash OR lower(p_identity->>'artifactSetHash') IS DISTINCT FROM v_run.artifact_set_hash THEN RAISE EXCEPTION 'workflow_identity_drift'; END IF;
  IF COALESCE((p_receipt->>'verified')::boolean,false) IS DISTINCT FROM true OR lower(p_receipt_hash) !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'verified_receipt_required'; END IF;
  IF v_stage.stage_key='revision.freeze' THEN
    v_kind:='views.seven-source';
    IF jsonb_typeof(p_receipt->'viewReceipts')<>'array' OR jsonb_array_length(p_receipt->'viewReceipts')<>7
      OR (SELECT count(DISTINCT v->>'viewKey') FROM jsonb_array_elements(p_receipt->'viewReceipts') v)<>7
      OR (SELECT count(DISTINCT lower(v->>'contentHash')) FROM jsonb_array_elements(p_receipt->'viewReceipts') v)<>7
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_receipt->'viewReceipts') v WHERE NULLIF(btrim(v->>'viewKey'),'') IS NULL OR lower(v->>'contentHash')!~'^[0-9a-f]{64}$')
      OR EXISTS(SELECT 1 FROM unnest(ARRAY['driver','passenger','hood','roof','front','rear','hero3d']) required(view_key)
        WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_receipt->'viewReceipts') v WHERE v->>'viewKey'=required.view_key))
    THEN RAISE EXCEPTION 'seven_distinct_source_views_required'; END IF;
  ELSIF v_stage.stage_key='proof.build' THEN
    v_kind:='call8.flat-proof';
    SELECT receipt INTO v_views FROM public.designpro_stage_receipts WHERE run_id=v_run.id AND receipt_kind='views.seven-source';
    v_manifest:=v_run.results->'dimensionManifest';
    IF (p_receipt->>'call')::int<>8 OR p_receipt->>'proofKind'<>'flattened-2d-proof' OR p_receipt->>'dimensionsAuthority'<>'genie-universal-panelizer' OR (p_receipt->>'bleedInches')::numeric<>5 OR lower(p_receipt->>'sourceProofHash') !~ '^[0-9a-f]{64}$'
      OR v_views IS NULL OR jsonb_typeof(p_receipt->'viewLineage')<>'array' OR jsonb_array_length(p_receipt->'viewLineage')<>7
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_views->'viewReceipts') s WHERE NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(p_receipt->'viewLineage') l
        WHERE l->>'viewKey'=s->>'viewKey' AND lower(l->>'contentHash')=lower(s->>'contentHash')))
      OR p_receipt->>'dimensionManifestId' IS DISTINCT FROM v_run.dimension_manifest_id::text
      OR lower(p_receipt->>'manifestHash') IS DISTINCT FROM v_run.manifest_hash
      OR (p_receipt->>'totalSqFt')::numeric IS DISTINCT FROM (v_manifest->>'totalSqFt')::numeric
    THEN RAISE EXCEPTION 'call8_flat_proof_contract_failed'; END IF;
  ELSIF v_stage.stage_key='panels.build' THEN
    v_kind:='call9.surface-panels';
    v_manifest:=v_run.results->'dimensionManifest';
    IF (p_receipt->>'call')::int<>9 OR p_receipt->>'sourceRule'<>'one-own-surface-region-per-output-side' OR (p_receipt->>'bleedInches')::numeric<>5 OR jsonb_typeof(p_receipt->'sides')<>'array' OR jsonb_array_length(p_receipt->'sides')<2 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_receipt->'sides'))<>jsonb_array_length(p_receipt->'sides') OR jsonb_typeof(p_receipt->'panelHashes')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_receipt->'panelHashes'))<>jsonb_array_length(p_receipt->'sides') OR EXISTS(SELECT 1 FROM jsonb_each_text(p_receipt->'panelHashes') h WHERE lower(h.value)!~'^[0-9a-f]{64}$')
      OR jsonb_typeof(p_receipt->'sourceRegionHashes')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_receipt->'sourceRegionHashes'))<>jsonb_array_length(p_receipt->'sides')
      OR (SELECT count(DISTINCT lower(value)) FROM jsonb_each_text(p_receipt->'sourceRegionHashes'))<>jsonb_array_length(p_receipt->'sides')
      OR EXISTS(SELECT 1 FROM jsonb_each_text(p_receipt->'sourceRegionHashes') h WHERE lower(h.value)!~'^[0-9a-f]{64}$')
      OR EXISTS(SELECT 1 FROM jsonb_each_text(p_receipt->'sourceRegionHashes') d CROSS JOIN jsonb_each_text(p_receipt->'sourceRegionHashes') p
        WHERE lower(d.key) LIKE '%driver%' AND lower(p.key) LIKE '%passenger%' AND lower(d.value)=lower(p.value))
      OR p_receipt->>'dimensionManifestId' IS DISTINCT FROM v_run.dimension_manifest_id::text
      OR lower(p_receipt->>'manifestHash') IS DISTINCT FROM v_run.manifest_hash
      OR (p_receipt->>'totalSqFt')::numeric IS DISTINCT FROM (v_manifest->>'totalSqFt')::numeric
      OR jsonb_typeof(p_receipt->'trimDimensions')<>'object'
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_manifest->'expectedSurfaces') s WHERE
        NOT (p_receipt->'sides' @> jsonb_build_array(s->>'surfaceKey'))
        OR NOT (p_receipt->'panelHashes' ? (s->>'surfaceKey'))
        OR NOT (p_receipt->'sourceRegionHashes' ? (s->>'surfaceKey'))
        OR NOT (p_receipt->'trimDimensions' ? (s->>'surfaceKey'))
        OR (p_receipt#>>ARRAY['trimDimensions',s->>'surfaceKey','widthInches'])::numeric IS DISTINCT FROM (s->>'widthInches')::numeric
        OR (p_receipt#>>ARRAY['trimDimensions',s->>'surfaceKey','heightInches'])::numeric IS DISTINCT FROM (s->>'heightInches')::numeric
        OR (p_receipt#>>ARRAY['trimDimensions',s->>'surfaceKey','surfaceSqFt'])::numeric IS DISTINCT FROM (s->>'surfaceSqFt')::numeric)
      OR (SELECT count(*) FROM jsonb_object_keys(p_receipt->'trimDimensions')) <> jsonb_array_length(v_manifest->'expectedSurfaces')
      OR NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts r WHERE r.run_id=v_run.id AND r.receipt_kind='call8.flat-proof'
        AND r.receipt->>'dimensionManifestId'=v_run.dimension_manifest_id::text AND lower(r.receipt->>'manifestHash')=v_run.manifest_hash)
    THEN RAISE EXCEPTION 'call9_unique_proof_region_contract_failed'; END IF;
  ELSIF v_stage.stage_key='logos.extract' THEN
    v_kind:='call10.logo-inventory';
    SELECT snapshot INTO v_snapshot FROM public.designpro_revision_sources WHERE revision_id=v_run.revision_id AND snapshot_hash=v_run.revision_snapshot_hash;
    SELECT receipt INTO v_call9 FROM public.designpro_stage_receipts WHERE run_id=v_run.id AND receipt_kind='call9.surface-panels';
    IF (p_receipt->>'call')::int<>10 OR p_receipt->>'inventoryContract'<>'designpro.expected-logo-inventory.v1' OR COALESCE((p_receipt->>'exactSetVerified')::boolean,false) IS DISTINCT FROM true OR lower(p_receipt->>'inventoryHash')!~'^[0-9a-f]{64}$'
      OR v_snapshot IS NULL OR v_call9 IS NULL OR jsonb_typeof(p_receipt->'inventory')<>'array'
      OR jsonb_array_length(p_receipt->'inventory')<>jsonb_array_length(v_snapshot->'expectedLogoInventory')
      OR (SELECT count(DISTINCT actual->>'placementKey') FROM jsonb_array_elements(p_receipt->'inventory') actual)
        <> jsonb_array_length(v_snapshot->'expectedLogoInventory')
      OR jsonb_typeof(COALESCE(p_artifacts,'[]'))<>'array' OR jsonb_array_length(COALESCE(p_artifacts,'[]'))<>jsonb_array_length(v_snapshot->'expectedLogoInventory')
      OR (SELECT count(DISTINCT artifact->>'surfaceKey') FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) artifact)
        <> jsonb_array_length(v_snapshot->'expectedLogoInventory')
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_snapshot->'expectedLogoInventory') expected WHERE
        NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_receipt->'inventory') actual
          WHERE actual->>'placementKey'=expected->>'placementKey'
            AND actual->>'identityKey'=expected->>'identityKey'
            AND actual->>'displayName'=expected->>'displayName'
            AND actual->>'targetSurfaceKey'=expected->>'surfaceKey'
            AND actual->>'storagePath'=expected->>'storagePath'
            AND actual->>'contentType'=expected->>'contentType'
            AND lower(actual->>'contentHash')=lower(expected->>'contentHash'))
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) artifact
          WHERE artifact->>'kind'='logo'
            AND artifact->>'surfaceKey'=expected->>'placementKey'
            AND lower(artifact->>'contentHash')=lower(expected->>'contentHash')
            AND artifact->>'storagePath'=expected->>'storagePath'
            AND artifact#>>'{metadata,placementKey}'=expected->>'placementKey'
            AND artifact#>>'{metadata,identityKey}'=expected->>'identityKey'
            AND artifact#>>'{metadata,displayName}'=expected->>'displayName'
            AND artifact#>>'{metadata,targetSurfaceKey}'=expected->>'surfaceKey'
            AND artifact#>>'{metadata,contentType}'=expected->>'contentType'
            AND artifact#>>'{metadata,separationContract}'='designpro.deterministic-stored-overlay.v1'
            AND lower(artifact#>>'{metadata,sourceRegionHash}')=lower(v_call9#>>ARRAY['sourceRegionHashes',expected->>'surfaceKey'])))
    THEN RAISE EXCEPTION 'call10_contract_failed'; END IF;
  ELSIF v_stage.stage_key='output.verify' THEN
    v_kind:='output.verified';
    IF p_receipt->>'contract' IS DISTINCT FROM 'designpro.output-verification.v1'
      OR p_receipt->'exactSurfaceSet' IS DISTINCT FROM
        '["driver","passenger","hood","roof","front","rear"]'::jsonb
      OR p_receipt->'exactFormatSet' IS DISTINCT FROM '["png","tiff","eps"]'::jsonb
      OR (p_receipt->>'fileCount')::integer IS DISTINCT FROM 18
      OR (p_receipt->>'fullScalePixelsPerInch')::numeric IS DISTINCT FROM 150
      OR (p_receipt->>'fileDpi')::numeric IS DISTINCT FROM 1500
      OR (p_receipt->>'outputScale')::numeric IS DISTINCT FROM 0.1
      OR (p_receipt->>'fullScaleBleedInchesPerEdge')::numeric IS DISTINCT FROM 5
      OR jsonb_typeof(p_receipt->'files') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_receipt->'files') IS DISTINCT FROM 18
      OR (SELECT count(DISTINCT (f->>'surfaceKey',f->>'format'))
          FROM jsonb_array_elements(p_receipt->'files') f) IS DISTINCT FROM 18
      OR EXISTS(
        SELECT 1
        FROM unnest(ARRAY['driver','passenger','hood','roof','front','rear']) surface_key
        CROSS JOIN unnest(ARRAY['png','tiff','eps']) format
        WHERE NOT EXISTS(
          SELECT 1 FROM jsonb_array_elements(p_receipt->'files') f
          WHERE f->>'surfaceKey'=surface_key AND f->>'format'=format
            AND lower(f->>'contentHash')~'^[0-9a-f]{64}$'
            AND (f->>'byteSize')::bigint>0
            AND (f->>'dpi')::numeric=1500
            AND (f->>'outputScale')::numeric=0.1
            AND (f->>'fullScaleBleedInches')::numeric=5
            AND f->>'colorSpace'='sRGB'
        )
      )
      OR jsonb_typeof(p_receipt->'outputHashes') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_receipt->'outputHashes') IS DISTINCT FROM 18
      OR (SELECT count(DISTINCT lower(value)) FROM jsonb_array_elements_text(p_receipt->'outputHashes'))
        IS DISTINCT FROM jsonb_array_length(p_receipt->'outputHashes')
      OR EXISTS(
        SELECT 1 FROM jsonb_array_elements_text(p_receipt->'outputHashes') h
        WHERE lower(h)!~'^[0-9a-f]{64}$'
          OR NOT EXISTS(
            SELECT 1 FROM public.designpro_artifacts a
            WHERE a.run_id=v_run.id AND a.artifact_kind='output' AND a.content_hash=lower(h)
          )
      )
      OR EXISTS(
        SELECT 1 FROM public.designpro_artifacts a
        WHERE a.run_id=v_run.id AND a.artifact_kind='output'
          AND NOT (p_receipt->'outputHashes' ? a.content_hash)
      )
      OR (SELECT count(*) FROM public.designpro_artifacts a
          WHERE a.run_id=v_run.id AND a.artifact_kind='output')
        IS DISTINCT FROM jsonb_array_length(p_receipt->'outputHashes')
      OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(p_receipt->'files') f
        WHERE NOT EXISTS(
          SELECT 1 FROM public.designpro_artifacts a
          WHERE a.run_id=v_run.id AND a.artifact_kind='output'
            AND a.surface_key=f->>'surfaceKey'
            AND a.storage_path=f->>'storagePath'
            AND a.content_hash=lower(f->>'contentHash')
            AND a.byte_size=(f->>'byteSize')::bigint
            AND a.metadata->>'format'=f->>'format'
            AND (a.metadata->>'width')::numeric=(f->>'widthPixels')::numeric
            AND (a.metadata->>'height')::numeric=(f->>'heightPixels')::numeric
            AND (a.metadata->>'dpi')::numeric=1500
            AND (a.metadata->>'outputScale')::numeric=0.1
            AND (a.metadata->>'fullScaleBleedInches')::numeric=5
        )
      )
      OR COALESCE(p_artifacts,'[]'::jsonb) IS DISTINCT FROM '[]'::jsonb
    THEN RAISE EXCEPTION 'verified_output_artifact_ledger_mismatch'; END IF;
  ELSIF v_stage.stage_key='stamp.build' THEN v_kind:='stamp';
  ELSIF v_stage.stage_key='zip.build' THEN v_kind:='zip';
  ELSIF v_stage.stage_key='wrapbox.deliver' THEN v_kind:='wrapbox.delivery';
  ELSE v_kind:=NULL; END IF;
  IF v_stage.stage_key='proof.build' AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a
    WHERE a->>'kind'='flat-proof' AND lower(a->>'contentHash')=lower(p_receipt->>'sourceProofHash')
  ) THEN RAISE EXCEPTION 'call8_proof_artifact_required'; END IF;
  IF v_stage.stage_key='panels.build' AND EXISTS(
    SELECT 1 FROM jsonb_each_text(p_receipt->'panelHashes') h
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a
      WHERE a->>'kind'='panel' AND a->>'surfaceKey'=h.key AND lower(a->>'contentHash')=lower(h.value))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a WHERE a->>'kind'='panel' AND (
        lower(a#>>'{metadata,sourceRegionHash}') IS DISTINCT FROM lower(p_receipt#>>ARRAY['sourceRegionHashes',a->>'surfaceKey'])
        OR (a#>>'{metadata,trimWidthInches}')::numeric IS DISTINCT FROM (p_receipt#>>ARRAY['trimDimensions',a->>'surfaceKey','widthInches'])::numeric
        OR (a#>>'{metadata,trimHeightInches}')::numeric IS DISTINCT FROM (p_receipt#>>ARRAY['trimDimensions',a->>'surfaceKey','heightInches'])::numeric
        OR (a#>>'{metadata,surfaceSqFt}')::numeric IS DISTINCT FROM (p_receipt#>>ARRAY['trimDimensions',a->>'surfaceKey','surfaceSqFt'])::numeric
        OR (a#>>'{metadata,bleed,top}')::numeric<>5 OR (a#>>'{metadata,bleed,right}')::numeric<>5
        OR (a#>>'{metadata,bleed,bottom}')::numeric<>5 OR (a#>>'{metadata,bleed,left}')::numeric<>5))
  ) THEN RAISE EXCEPTION 'call9_panel_artifact_set_incomplete'; END IF;
  IF v_stage.stage_key='pack.verify' AND (
    v_run.dimension_manifest_id IS NULL OR v_run.manifest_hash IS NULL OR v_run.source_contract_hash IS NULL OR v_run.artifact_set_hash IS NULL
    OR NOT (v_run.results ? 'packReceipt')
  ) THEN RAISE EXCEPTION 'finalized_entice_identity_required'; END IF;
  IF v_stage.stage_key='pack.activate' AND NOT EXISTS(
    SELECT 1 FROM public.designpro_workflow_stages p WHERE p.run_id=v_run.id AND p.stage_key='pack.verify' AND p.status='completed'
      AND p.verification @> '{"verified":true}'::jsonb
  ) THEN RAISE EXCEPTION 'verified_entice_pack_required_for_activation'; END IF;
  IF v_stage.stage_key='stamp.build' THEN
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
  IF v_stage.stage_key='zip.build' THEN
    IF NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts WHERE run_id=v_run.id AND receipt_kind='stamp')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a WHERE a->>'kind'='zip' AND lower(a->>'contentHash')=lower(p_receipt_hash))
    THEN RAISE EXCEPTION 'stamp_receipt_and_zip_artifact_required'; END IF;
  END IF;
  IF v_stage.stage_key='wrapbox.deliver' THEN
    IF NOT EXISTS(SELECT 1 FROM public.designpro_stage_receipts z WHERE z.run_id=v_run.id AND z.receipt_kind='zip' AND z.receipt_hash=lower(p_receipt->>'zipHash'))
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) a WHERE a->>'kind'='wrapbox-manifest' AND lower(a->>'contentHash')=lower(p_receipt_hash))
    THEN RAISE EXCEPTION 'exact_zip_and_wrapbox_manifest_required'; END IF;
  END IF;
  IF v_kind IS NOT NULL THEN INSERT INTO public.designpro_stage_receipts(run_id,stage_id,receipt_kind,identity,receipt,receipt_hash) VALUES(v_run.id,v_stage.id,v_kind,p_identity,p_receipt,lower(p_receipt_hash)); END IF;
  IF jsonb_typeof(COALESCE(p_artifacts,'[]'))<>'array' THEN RAISE EXCEPTION 'artifact_array_required'; END IF;
  FOR v_art IN SELECT value FROM jsonb_array_elements(COALESCE(p_artifacts,'[]')) LOOP
    INSERT INTO public.designpro_artifacts(run_id,stage_id,artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata)
    VALUES(v_run.id,v_stage.id,v_art->>'kind',COALESCE(v_art->>'surfaceKey',''),v_art->>'storagePath',lower(v_art->>'contentHash'),NULLIF(v_art->>'byteSize','')::bigint,COALESCE(v_art->'metadata','{}'));
  END LOOP;
  UPDATE public.designpro_workflow_stages SET status='completed',output=p_receipt,verification=jsonb_build_object('verified',true,'identity',p_identity),output_hash=lower(p_receipt_hash),completed_at=clock_timestamp(),lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=v_stage.id;
  IF v_stage.stage_key IN ('source.verify','output.verify') THEN
    UPDATE public.designpro_workflow_stages
    SET status='waiting',
      wait_reason=CASE WHEN v_stage.stage_key='source.verify' THEN 'panelpro_preflight_required' ELSE 'final_human_qc_required' END,
      wait_details=jsonb_build_object('requestedBy','designpro.os','requestedAt',clock_timestamp()),
      updated_at=clock_timestamp()
    WHERE run_id=v_run.id
      AND stage_key=CASE WHEN v_stage.stage_key='source.verify' THEN 'await_panelpro_preflight_qc' ELSE 'await_final_human_qc' END
      AND status='pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'required_human_gate_missing_or_already_transitioned'; END IF;
  END IF;
  PERFORM public.designpro_sync_run_status(v_run.id);
  -- Completing Entice is the database-owned production trigger. This occurs
  -- in the same transaction, so a crash cannot leave an activated pack with
  -- no durable production workflow. The periodic reconciler in 181000 covers
  -- historical rows and any externally committed legacy activation.
  IF v_stage.stage_key='pack.activate' THEN
    PERFORM public.create_designpro_production_workflow(
      v_run.id,
      'auto-production:'||v_run.id::text,
      '{"trigger":"designpro.os.auto"}'::jsonb
    );
  END IF;
  RETURN true;
END $fn$;
