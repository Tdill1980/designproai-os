-- Pin all production proofs before output.verify exposes final human QC.
-- Keep the installed stage/approval definitions: both contain accumulated
-- identity, A.T.L.A.S., Close-Up, deferred Call 8 and fulfillment protections.
-- New private helpers read frozen business evidence; no browser-supplied flag
-- can turn a Production Pack into the separately purchased Logo-only lane.

CREATE OR REPLACE FUNCTION designpro_private.is_authorized_logo_only_output(
  p_run_id uuid, p_output_receipt jsonb
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, extensions AS $fn$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_gate jsonb;
  v_source public.designpro_revision_sources%ROWTYPE;
  v_entice_id uuid;
BEGIN
  IF p_output_receipt#>'{authorizedAssetManifest,productionPackAuthorized}'
      IS DISTINCT FROM 'false'::jsonb THEN RETURN false; END IF;
  SELECT * INTO v_run FROM public.designpro_workflow_runs
    WHERE id=p_run_id AND workflow_type='designpro.production_pack';
  SELECT * INTO v_source FROM public.designpro_revision_sources
    WHERE revision_id=v_run.revision_id AND owner_id=v_run.owner_id
      AND tenant_key=v_run.tenant_key AND snapshot_hash=v_run.revision_snapshot_hash;
  IF v_run.id IS NULL OR v_source.revision_id IS NULL
  THEN RAISE EXCEPTION 'logo_only_fulfillment_identity_required'; END IF;
  SELECT s.output->'authorizedAssetManifest' INTO v_gate
    FROM public.designpro_workflow_stages s
    WHERE s.run_id=p_run_id AND s.stage_key='await_purchase'
      AND s.status='completed' AND s.verification @> '{"verified":true}'::jsonb;
  IF v_gate IS DISTINCT FROM p_output_receipt->'authorizedAssetManifest'
    OR v_gate->'products' IS DISTINCT FROM '["logo_pack"]'::jsonb
    OR v_gate->'productionPackAuthorized' IS DISTINCT FROM 'false'::jsonb
    OR v_gate->'logoPackAuthorized' IS DISTINCT FROM 'true'::jsonb
    OR v_gate->'requiredOutputFiles' IS DISTINCT FROM '0'::jsonb
    OR v_gate->'zipIncludesSourceViews' IS DISTINCT FROM 'false'::jsonb
  THEN RAISE EXCEPTION 'logo_only_frozen_authorization_required'; END IF;
  SELECT e.id INTO v_entice_id FROM public.designpro_workflow_runs e
    WHERE e.id::text=COALESCE(v_run.results->>'sourceEnticeRunId',v_run.input->>'sourceEnticeRunId')
      AND e.workflow_type='designpro.entice_pack' AND e.owner_id=v_run.owner_id
      AND e.tenant_key=v_run.tenant_key AND e.revision_id=v_run.revision_id
      AND e.revision_snapshot_hash=v_run.revision_snapshot_hash;
  IF v_entice_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.designpro_purchase_entitlements e
    WHERE e.entice_run_id=v_entice_id AND e.owner_id=v_run.owner_id
      AND e.generation_id=v_source.generation_id AND e.product_type='logo_pack'
      AND e.amount_cents>0 AND e.paid_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'logo_only_paid_entitlement_required'; END IF;
  -- A later additional purchase does not expand this already frozen run.
  RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION designpro_private.assert_final_proof_join(
  p_run_id uuid, p_output_receipt jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, extensions AS $fn$
DECLARE
  v_run public.designpro_workflow_runs%ROWTYPE;
  v_source public.designpro_revision_sources%ROWTYPE;
  v_output jsonb:=p_output_receipt;
  v_join jsonb;
  v_call8 jsonb;
  v_built jsonb;
  v_manifest jsonb;
  v_tiles jsonb;
  v_views jsonb;
  v_binding jsonb;
  v_frozen jsonb;
  v_master text;
  v_view_json text;
  v_proof public.designpro_artifacts%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=p_run_id;
  IF NOT FOUND OR v_run.workflow_type IS DISTINCT FROM 'designpro.production_pack'
  THEN RAISE EXCEPTION 'production_workflow_not_found'; END IF;
  IF v_output IS NULL THEN
    IF (SELECT count(*) FROM public.designpro_stage_receipts
        WHERE run_id=p_run_id AND receipt_kind='output.verified') IS DISTINCT FROM 1
    THEN RAISE EXCEPTION 'verified_output_receipt_required'; END IF;
    SELECT receipt INTO v_output FROM public.designpro_stage_receipts
      WHERE run_id=p_run_id AND receipt_kind='output.verified';
  END IF;
  IF v_output->'verified' IS DISTINCT FROM 'true'::jsonb
    OR v_output->>'receiptKind' IS DISTINCT FROM 'output.verified'
  THEN RAISE EXCEPTION 'verified_output_receipt_required'; END IF;
  IF designpro_private.is_authorized_logo_only_output(p_run_id,v_output)
  THEN RETURN NULL; END IF;
  v_join:=v_output->'proofJoin';
  IF jsonb_typeof(v_join) IS DISTINCT FROM 'object'
    OR v_join->>'contract' IS DISTINCT FROM 'designpro.production-proof-join.v1'
    OR v_join->'sevenViewsVerified' IS DISTINCT FROM 'true'::jsonb
    OR v_join->>'manifestHash' IS DISTINCT FROM v_run.manifest_hash
    OR COALESCE(v_run.manifest_hash,'') !~ '^[0-9a-f]{64}$'
    OR v_run.dimension_manifest_id IS NULL
    OR COALESCE(v_join->>'call8ReceiptHash','') !~ '^[0-9a-f]{64}$'
    OR COALESCE(v_join->>'call8ProofHash','') !~ '^[0-9a-f]{64}$'
    OR COALESCE(v_join->>'sourceViewSetHash','') !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'production_final_proof_join_required'; END IF;
  SELECT * INTO v_source FROM public.designpro_revision_sources
    WHERE revision_id=v_run.revision_id AND owner_id=v_run.owner_id
      AND tenant_key=v_run.tenant_key AND snapshot_hash=v_run.revision_snapshot_hash;
  IF NOT FOUND OR jsonb_typeof(v_source.snapshot->'callOnePanels') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'production_call8_master_identity_required'; END IF;
  IF jsonb_array_length(v_source.snapshot->'callOnePanels') IS DISTINCT FROM 6
    OR (SELECT count(DISTINCT p->>'surfaceKey') FROM jsonb_array_elements(v_source.snapshot->'callOnePanels') p) IS DISTINCT FROM 6
    OR (SELECT count(DISTINCT p->>'sourceMasterHash') FROM jsonb_array_elements(v_source.snapshot->'callOnePanels') p) IS DISTINCT FROM 1
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_source.snapshot->'callOnePanels') p
      WHERE COALESCE(p->>'sourceMasterHash','') !~ '^[0-9a-f]{64}$')
  THEN RAISE EXCEPTION 'production_call8_master_identity_required'; END IF;
  v_master:=v_source.snapshot#>>'{callOnePanels,0,sourceMasterHash}';
  SELECT s.output->'call8' INTO v_call8 FROM public.designpro_workflow_stages s
    WHERE s.run_id=p_run_id AND s.stage_key='source.verify' AND s.status='completed'
      AND s.verification @> '{"verified":true}'::jsonb;
  v_built:=v_call8->'receipt';
  v_manifest:=v_run.results->'dimensionManifest';
  IF v_call8->>'receiptKind' IS DISTINCT FROM 'call8.flat-proof'
    OR v_call8->>'receiptHash' IS DISTINCT FROM v_join->>'call8ReceiptHash'
    OR v_built->'verified' IS DISTINCT FROM 'true'::jsonb
    OR v_built->'deferred' IS NOT DISTINCT FROM 'true'::jsonb
    OR v_built->>'producer' IS DISTINCT FROM 'designpro.call8-panel-proof.v4'
    OR v_built->'deterministic' IS DISTINCT FROM 'true'::jsonb
    OR v_built->'imageRequestCount' IS DISTINCT FROM '0'::jsonb
    OR v_built->'proofPixelsUsed' IS DISTINCT FROM 'false'::jsonb
    OR v_built->'call' IS DISTINCT FROM '8'::jsonb
    OR v_built->>'dimensionsAuthority' IS DISTINCT FROM 'genie-universal-panelizer'
    OR v_built->'bleedInches' IS DISTINCT FROM '5'::jsonb
    OR v_built->>'manifestHash' IS DISTINCT FROM v_run.manifest_hash
    OR v_built->>'dimensionManifestId' IS DISTINCT FROM v_run.dimension_manifest_id::text
    OR v_built->>'sourceProofHash' IS DISTINCT FROM v_join->>'call8ProofHash'
    OR v_manifest->>'contract' IS DISTINCT FROM 'designpro.genie-dimension-manifest.v1'
    OR v_manifest->'genieVerified' IS DISTINCT FROM 'true'::jsonb
    OR v_manifest->>'geometryPurpose' IS NOT DISTINCT FROM 'calls-1-7-layout-only'
    OR v_built->'totalSqFt' IS DISTINCT FROM v_manifest->'totalSqFt'
    OR NOT COALESCE((v_built->>'totalSqFt')::numeric>0,false)
    OR jsonb_typeof(v_manifest->'expectedSurfaces') IS DISTINCT FROM 'array'
    OR jsonb_typeof(v_built->'surfaceTiles') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'production_call8_release_evidence_invalid'; END IF;
  v_tiles:=v_built->'surfaceTiles';
  IF jsonb_array_length(v_tiles) IS DISTINCT FROM 6
    OR jsonb_array_length(v_manifest->'expectedSurfaces') IS DISTINCT FROM 6
    OR (SELECT count(DISTINCT t->>'surfaceKey') FROM jsonb_array_elements(v_tiles) t) IS DISTINCT FROM 6
    OR (SELECT count(DISTINCT t->>'sourcePanelHash') FROM jsonb_array_elements(v_tiles) t) IS DISTINCT FROM 6
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['driver','passenger','hood','roof','front','rear']) k
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_tiles) t WHERE t->>'surfaceKey'=k))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_tiles) t
      WHERE COALESCE(t->>'sourcePanelHash','') !~ '^[0-9a-f]{64}$'
        OR t->>'sourceMasterHash' IS DISTINCT FROM v_master
        OR t->>'dimensionRuleBasis' IS DISTINCT FROM 'trim-boundary'
        OR t->'continuousArtwork' IS DISTINCT FROM 'true'::jsonb
        OR t->'sourceAspectPreserved' IS DISTINCT FROM 'true'::jsonb
        OR NOT COALESCE((t->>'trimWidthIn')::numeric>0 AND (t->>'trimHeightIn')::numeric>0,false)
        OR (t->>'printWidthIn')::numeric-(t->>'trimWidthIn')::numeric IS DISTINCT FROM 10::numeric
        OR (t->>'printHeightIn')::numeric-(t->>'trimHeightIn')::numeric IS DISTINCT FROM 10::numeric
        OR t->'bleedInches' IS DISTINCT FROM '{"top":5,"right":5,"bottom":5,"left":5}'::jsonb
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_source.snapshot->'callOnePanels') p
          WHERE p->>'surfaceKey'=t->>'surfaceKey' AND p->>'contentHash'=t->>'sourcePanelHash'
            AND p->>'storagePath'=t->>'sourcePanelPath' AND p->>'sourceMasterHash'=v_master)
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_manifest->'expectedSurfaces') s
          WHERE s->>'surfaceKey'=t->>'surfaceKey'
            AND (s->>'widthInches')::numeric=(t->>'trimWidthIn')::numeric
            AND (s->>'heightInches')::numeric=(t->>'trimHeightIn')::numeric))
  THEN RAISE EXCEPTION 'production_call8_geometry_invalid'; END IF;
  IF (SELECT count(*) FROM public.designpro_artifacts WHERE run_id=p_run_id AND artifact_kind='flat-proof') IS DISTINCT FROM 1
  THEN RAISE EXCEPTION 'production_call8_artifact_required'; END IF;
  SELECT * INTO v_proof FROM public.designpro_artifacts WHERE run_id=p_run_id AND artifact_kind='flat-proof';
  IF v_proof.content_hash IS DISTINCT FROM v_join->>'call8ProofHash'
    OR v_proof.storage_path IS DISTINCT FROM 'designpro/'||v_run.tenant_key||'/'||p_run_id::text||'/source/call8-2d-production-proof.png'
    OR NOT COALESCE(v_proof.byte_size>0,false)
    OR v_proof.metadata->>'sourceReceiptHash' IS DISTINCT FROM v_join->>'call8ReceiptHash'
    OR v_proof.metadata->>'manifestHash' IS DISTINCT FROM v_run.manifest_hash
    OR v_proof.metadata->>'sourceStoragePath' IS DISTINCT FROM v_built->>'storagePath'
    OR v_proof.metadata->>'sourceContentHash' IS DISTINCT FROM v_proof.content_hash
  THEN RAISE EXCEPTION 'production_call8_artifact_required'; END IF;
  -- Storage bytes are re-read and hashed by output verification. This SQL gate
  -- joins their receipts and ledger identities; it never claims to read pixels.
  v_views:=v_join->'sourceViews';
  IF jsonb_typeof(v_views) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'production_seven_proofs_required'; END IF;
  IF jsonb_array_length(v_views) IS DISTINCT FROM 7
    OR (SELECT count(DISTINCT v->>'viewKey') FROM jsonb_array_elements(v_views) v) IS DISTINCT FROM 7
    OR (SELECT count(DISTINCT v->>'contentHash') FROM jsonb_array_elements(v_views) v) IS DISTINCT FROM 7
    OR (SELECT count(DISTINCT v->>'storagePath') FROM jsonb_array_elements(v_views) v) IS DISTINCT FROM 7
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['driver','passenger','hood','roof','front','rear']) k
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_views) v WHERE v->>'viewKey'=k))
    OR (SELECT count(*) FROM jsonb_array_elements(v_views) v WHERE v->>'viewKey' IN ('closeup','hero3d')) IS DISTINCT FROM 1
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_views) v
      WHERE jsonb_typeof(v) IS DISTINCT FROM 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(v)) IS DISTINCT FROM 5
        OR NOT v ?& ARRAY['viewKey','contentHash','storagePath','byteSize','contentType']
        OR COALESCE(v->>'contentHash','') !~ '^[0-9a-f]{64}$'
        OR COALESCE(v->>'byteSize','') !~ '^[1-9][0-9]*$'
        OR (v->>'byteSize')::numeric>9007199254740991
        OR COALESCE(v->>'storagePath','') !~ '^[A-Za-z0-9_/-]+\.(png|jpg|jpeg|webp)$'
        OR v->>'storagePath' ~ '(^/|//|(^|/)\.\.(/|$))'
        OR COALESCE(v->>'contentType','') NOT IN ('image/png','image/jpeg','image/webp'))
  THEN RAISE EXCEPTION 'production_seven_proofs_required'; END IF;
  -- These five fields have a bounded, integer-only JSON representation. Match
  -- the runtime's sorted-key JSON hash without hashing Postgres's spaced JSON.
  SELECT '['||string_agg('{"byteSize":'||(v->>'byteSize')::bigint::text
    ||',"contentHash":'||to_jsonb(v->>'contentHash')::text
    ||',"contentType":'||to_jsonb(v->>'contentType')::text
    ||',"storagePath":'||to_jsonb(v->>'storagePath')::text
    ||',"viewKey":'||to_jsonb(v->>'viewKey')::text||'}',',' ORDER BY v->>'viewKey' COLLATE "C")||']'
    INTO v_view_json FROM jsonb_array_elements(v_views) v;
  IF encode(extensions.digest(convert_to(v_view_json,'UTF8'),'sha256'),'hex') IS DISTINCT FROM v_join->>'sourceViewSetHash'
  THEN RAISE EXCEPTION 'production_proof_set_hash_mismatch'; END IF;
  v_binding:=v_join->'viewBinding';
  IF v_binding->>'contract'='designpro.frozen-proof-join.v1' THEN
    SELECT r.receipt INTO v_frozen FROM public.designpro_stage_receipts r
      JOIN public.designpro_workflow_runs e ON e.id=r.run_id
      WHERE e.id::text=COALESCE(v_run.results->>'sourceEnticeRunId',v_run.input->>'sourceEnticeRunId')
        AND e.workflow_type='designpro.entice_pack' AND e.owner_id=v_run.owner_id
        AND e.tenant_key=v_run.tenant_key AND e.revision_id=v_run.revision_id
        AND e.revision_snapshot_hash=v_run.revision_snapshot_hash
        AND r.receipt_kind='views.seven-source' AND r.receipt_hash=v_binding->>'sourceReceiptHash';
    IF v_frozen IS NULL OR jsonb_typeof(v_frozen->'viewReceipts') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'production_frozen_proof_binding_invalid'; END IF;
    IF jsonb_array_length(v_frozen->'viewReceipts') IS DISTINCT FROM 7
      OR v_frozen->'sevenViewsVerified' IS NOT DISTINCT FROM 'false'::jsonb
      OR EXISTS(SELECT value FROM jsonb_array_elements(v_views)
        EXCEPT SELECT value FROM jsonb_array_elements(v_frozen->'viewReceipts'))
      OR EXISTS(SELECT value FROM jsonb_array_elements(v_frozen->'viewReceipts')
        EXCEPT SELECT value FROM jsonb_array_elements(v_views))
      OR (EXISTS(SELECT 1 FROM jsonb_array_elements(v_views) v WHERE v->>'viewKey'='hero3d')
        AND (NOT COALESCE(v_source.snapshot->'renderAssets' ? 'hero3d',false)
          OR COALESCE(v_source.snapshot->'renderAssets' ? 'closeup',false)))
    THEN RAISE EXCEPTION 'production_frozen_proof_binding_invalid'; END IF;
  ELSIF v_binding->>'contract'='designpro.late-atlas-proof-join.v1' THEN
    IF v_binding->>'snapshotHash' IS DISTINCT FROM v_source.snapshot_hash
      OR v_binding->>'requestId' IS DISTINCT FROM v_source.visualization_id::text
      OR v_binding->>'masterContentHash' IS DISTINCT FROM v_master
      OR NOT EXISTS(SELECT 1 FROM public.designpro_flat_atlas_revisions a
        WHERE a.id::text=v_binding->>'atlasRevisionId' AND a.request_id=v_source.visualization_id
          AND a.generation_id=v_source.generation_id AND a.owner_id=v_run.owner_id
          AND a.tenant_key=v_run.tenant_key AND a.master_content_hash=v_master
          AND a.projection_content_hash=v_binding->>'projectionContentHash'
          AND a.manifest_content_hash=v_binding->>'manifestContentHash'
          AND a.metadata->'masterQcPassed'='true'::jsonb)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_views) v WHERE v->>'viewKey'='hero3d')
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_views) v WHERE NOT EXISTS(
        SELECT 1 FROM public.designpro_generation_views g
        WHERE g.request_id=v_source.visualization_id AND g.consumer_role=v->>'viewKey'
          AND g.storage_path=v->>'storagePath' AND g.content_hash=v->>'contentHash'
          AND g.byte_size=(v->>'byteSize')::bigint AND g.content_type=v->>'contentType'
          AND g.metadata#>>'{authority,revisionId}'=v_binding->>'atlasRevisionId'
          AND g.metadata#>>'{authority,masterContentHash}'=v_master
          AND (p_output_receipt IS NULL OR g.superseded_at IS NULL)))
    THEN RAISE EXCEPTION 'production_late_proof_binding_invalid'; END IF;
  ELSE RAISE EXCEPTION 'production_proof_binding_required'; END IF;
  RETURN v_join;
END $fn$;

CREATE OR REPLACE FUNCTION designpro_private.assert_final_stamped_views(
  p_run_id uuid, p_receipt jsonb, p_artifacts jsonb
) RETURNS integer LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, extensions AS $fn$
DECLARE
  v_join jsonb:=designpro_private.assert_final_proof_join(p_run_id);
  v_stamps jsonb:=p_receipt->'stampedViews';
  v_run public.designpro_workflow_runs%ROWTYPE;
BEGIN
  IF v_join IS NULL THEN
    IF COALESCE(p_receipt->'proofJoin','null'::jsonb) IS DISTINCT FROM 'null'::jsonb
      OR COALESCE(v_stamps,'[]'::jsonb) IS DISTINCT FROM '[]'::jsonb
    THEN RAISE EXCEPTION 'logo_only_unpurchased_proof_stamps'; END IF;
    RETURN 0;
  END IF;
  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=p_run_id;
  IF p_receipt->'proofJoin' IS DISTINCT FROM v_join
    OR p_receipt->>'sourceProofHash' IS DISTINCT FROM v_join->>'call8ProofHash'
    OR jsonb_typeof(v_stamps) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_artifacts) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'production_stamped_proof_join_mismatch'; END IF;
  IF jsonb_array_length(v_stamps) IS DISTINCT FROM 7
    OR (SELECT count(DISTINCT s->>'viewKey') FROM jsonb_array_elements(v_stamps) s) IS DISTINCT FROM 7
    OR (SELECT count(DISTINCT s->>'contentHash') FROM jsonb_array_elements(v_stamps) s) IS DISTINCT FROM 7
    OR (SELECT count(DISTINCT s->>'storagePath') FROM jsonb_array_elements(v_stamps) s) IS DISTINCT FROM 7
    OR (SELECT count(*) FROM jsonb_array_elements(p_artifacts) a
        WHERE a->>'kind'='stamp' AND a->>'surfaceKey' LIKE 'stamped-view-%') IS DISTINCT FROM 7
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_stamps) s
      WHERE COALESCE(s->>'contentHash','') !~ '^[0-9a-f]{64}$'
        OR COALESCE(s->>'byteSize','') !~ '^[1-9][0-9]*$'
        OR (s->>'byteSize')::numeric>9007199254740991
        OR s->>'contentHash' IN (p_receipt->>'sealHash',p_receipt->>'stampHash',p_receipt->>'certificateHash')
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_join->'sourceViews') v WHERE v->>'contentHash'=s->>'contentHash')
        OR s->>'storagePath' NOT LIKE 'designpro/'||v_run.tenant_key||'/'||p_run_id::text||'/proof/stamped-view-%'
        OR s->>'storagePath' !~ '^[A-Za-z0-9_/-]+\.png$'
        OR s->>'storagePath' ~ '(^/|//|(^|/)\.\.(/|$))')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_join->'sourceViews') v WHERE NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_stamps) s
      JOIN LATERAL jsonb_array_elements(p_artifacts) a ON a->>'surfaceKey'='stamped-view-'||(v->>'viewKey')
      WHERE s->>'viewKey'=v->>'viewKey' AND s->>'sourceProofHash'=v->>'contentHash'
        AND s->>'sourceProofPath'=v->>'storagePath' AND a->>'kind'='stamp'
        AND a->>'contentHash'=s->>'contentHash' AND a->>'storagePath'=s->>'storagePath'
        AND a->'byteSize'=s->'byteSize'
        AND a#>>'{metadata,sourceViewKey}'=v->>'viewKey'
        AND a#>>'{metadata,sourceProofHash}'=v->>'contentHash'
        AND a#>>'{metadata,sourceProofPath}'=v->>'storagePath'
        AND a#>>'{metadata,sourceViewSetHash}'=v_join->>'sourceViewSetHash'
        AND a#>>'{metadata,sealHash}'=p_receipt->>'sealHash'
        AND a#>>'{metadata,designId}'=p_receipt->>'designId'
        AND a#>>'{metadata,orderNumber}'=p_receipt->>'orderNumber'
        AND a#>>'{metadata,verifiedBy}'=p_receipt->>'verifiedBy'
        AND a#>>'{metadata,approvalRef}'=p_receipt->>'approvalRef'
        AND a#>>'{metadata,approvedAt}'=p_receipt->>'approvedAt'))
  THEN RAISE EXCEPTION 'production_seven_stamped_views_required'; END IF;
  RETURN 7;
END $fn$;

DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_block text;
  v_start integer;
  v_finish integer;
  v_old text;
  v_new text;
  v_pair text[];
  v_pairs text[][];
BEGIN
  v_definition:=pg_get_functiondef(to_regprocedure('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'));
  IF v_definition IS NULL OR strpos(v_definition,'workflow_run_is_atlas')=0
    OR strpos(v_definition,'call8.flat-proof-deferred')=0
    OR strpos(v_definition,'call9_atlas_panel_promotion_contract_failed')=0
    OR strpos(v_definition,'FROM public.designpro_revision_sources frozen')=0
    OR strpos(v_definition,'call12.topaz-upscale')=0
    OR strpos(v_definition,'exact_stamp_business_identity_required')=0
    OR strpos(v_definition,'certificateHash')=0
    OR strpos(v_definition,'assert_final_proof_join')>0
  THEN RAISE EXCEPTION 'final_proof_join_unexpected_complete_contract'; END IF;
  v_pairs:=ARRAY[
    ARRAY[$old$  ELSIF v_stage.stage_key='output.verify' THEN
    v_kind:='output.verified';
$old$,$new$  ELSIF v_stage.stage_key='output.verify' THEN
    v_kind:='output.verified';
    PERFORM designpro_private.assert_final_proof_join(v_run.id,p_receipt);
    IF designpro_private.is_authorized_logo_only_output(v_run.id,p_receipt) THEN
      IF p_receipt->'exactSurfaceFormatCount' IS DISTINCT FROM '0'::jsonb
        OR p_receipt->'notApplicable' IS DISTINCT FROM '["output"]'::jsonb
        OR COALESCE(p_receipt->'proofJoin','null'::jsonb) IS DISTINCT FROM 'null'::jsonb
        OR COALESCE(p_receipt->'files','[]'::jsonb) IS DISTINCT FROM '[]'::jsonb
        OR COALESCE(p_receipt->'outputHashes','[]'::jsonb) IS DISTINCT FROM '[]'::jsonb
        OR COALESCE(p_artifacts,'[]'::jsonb) IS DISTINCT FROM '[]'::jsonb
        OR EXISTS(SELECT 1 FROM public.designpro_artifacts WHERE run_id=v_run.id AND artifact_kind='output')
      THEN RAISE EXCEPTION 'logo_only_output_ledger_mismatch'; END IF;
    ELSE
$new$],
    ARRAY[$old$    THEN RAISE EXCEPTION 'verified_output_artifact_ledger_mismatch'; END IF;
$old$,$new$    THEN RAISE EXCEPTION 'verified_output_artifact_ledger_mismatch'; END IF;
    END IF;
$new$]
  ];
  v_patched:=v_definition;
  FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
    v_old:=v_pair[1]; v_new:=v_pair[2];
    IF (length(v_patched)-length(replace(v_patched,v_old,'')))/length(v_old) IS DISTINCT FROM 1
    THEN RAISE EXCEPTION 'final_proof_join_output_anchor_not_unique'; END IF;
    v_patched:=replace(v_patched,v_old,v_new);
  END LOOP;
  v_old:=E'  IF v_stage.stage_key=''stamp.build'' THEN\n';
  v_new:=E'  IF v_stage.stage_key=''zip.build'' THEN\n';
  IF (length(v_patched)-length(replace(v_patched,v_old,'')))/length(v_old) IS DISTINCT FROM 1
    OR (length(v_patched)-length(replace(v_patched,v_new,'')))/length(v_new) IS DISTINCT FROM 1
  THEN RAISE EXCEPTION 'final_proof_join_stamp_boundaries_not_unique'; END IF;
  v_start:=strpos(v_patched,v_old); v_finish:=strpos(v_patched,v_new);
  IF v_finish<=v_start THEN RAISE EXCEPTION 'final_proof_join_stamp_boundaries_invalid'; END IF;
  v_block:=substr(v_patched,v_start,v_finish-v_start);
  v_pairs:=ARRAY[
    ARRAY[$old$      v_order_number text;
$old$,$new$      v_order_number text;
      v_proof_view_count integer;
$new$],
    ARRAY[$old$      IF jsonb_array_length(COALESCE(p_artifacts,'[]'::jsonb)) IS DISTINCT FROM 3
$old$,$new$      v_proof_view_count:=designpro_private.assert_final_stamped_views(v_run.id,p_receipt,p_artifacts);
      IF jsonb_array_length(COALESCE(p_artifacts,'[]'::jsonb)) IS DISTINCT FROM (3+v_proof_view_count)
$new$],
    ARRAY[$old$              OR a->>'surfaceKey' NOT IN ('seal','stamped-proof','certificate')
$old$,$new$              OR (a->>'surfaceKey' NOT IN ('seal','stamped-proof','certificate')
                AND NOT (v_proof_view_count=7 AND a->>'surfaceKey' IN (
                  'stamped-view-driver','stamped-view-passenger','stamped-view-hood',
                  'stamped-view-roof','stamped-view-front','stamped-view-rear',
                  'stamped-view-closeup','stamped-view-hero3d')))
$new$]
  ];
  FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
    v_old:=v_pair[1]; v_new:=v_pair[2];
    IF (length(v_block)-length(replace(v_block,v_old,'')))/length(v_old) IS DISTINCT FROM 1
    THEN RAISE EXCEPTION 'final_proof_join_stamp_anchor_not_unique'; END IF;
    v_block:=replace(v_block,v_old,v_new);
  END LOOP;
  v_patched:=substr(v_patched,1,v_start-1)||v_block||substr(v_patched,v_finish);
  EXECUTE v_patched;

  v_definition:=pg_get_functiondef(to_regprocedure('public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'));
  v_old:=$old$    ) THEN RAISE EXCEPTION 'verified_output_receipt_required'; END IF;
$old$;
  v_new:=$new$    ) THEN RAISE EXCEPTION 'verified_output_receipt_required'; END IF;
    PERFORM designpro_private.assert_final_proof_join(p_run_id);
$new$;
  IF v_definition IS NULL OR strpos(v_definition,'immutable_revision_fulfillment_mismatch')=0
    OR strpos(v_definition,'final_qc_evidence_or_business_identity_incomplete')=0
    OR strpos(v_definition,'raw_app_meta_data')=0
    OR (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) IS DISTINCT FROM 1
  THEN RAISE EXCEPTION 'final_proof_join_unexpected_approval_contract'; END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END $migration$;

CREATE OR REPLACE FUNCTION public.defer_designpro_for_proofs(
  p_stage_id uuid, p_lease_token uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions AS $fn$
DECLARE v_run_id uuid;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'service_role_required'; END IF;
  UPDATE public.designpro_workflow_stages s SET status='retryable',
    attempt=GREATEST(s.attempt-1,0),available_at=clock_timestamp()+interval '30 seconds',
    lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
    wait_reason='production_proofs_pending',wait_details='{}'::jsonb,
    error_code=NULL,error_message=NULL,error_details='{}'::jsonb,updated_at=clock_timestamp()
    FROM public.designpro_workflow_runs r
    WHERE s.id=p_stage_id AND s.run_id=r.id AND r.workflow_type='designpro.production_pack'
      AND r.status NOT IN ('failed','cancelled','completed')
      AND s.stage_key='output.verify' AND s.status='running'
      AND s.lease_token=p_lease_token AND s.lease_expires_at>clock_timestamp()
    RETURNING s.run_id INTO v_run_id;
  IF v_run_id IS NULL THEN RETURN false; END IF;
  PERFORM public.designpro_sync_run_status(v_run_id);
  RETURN true;
END $fn$;

REVOKE ALL ON FUNCTION designpro_private.is_authorized_logo_only_output(uuid,jsonb),
  designpro_private.assert_final_proof_join(uuid,jsonb),
  designpro_private.assert_final_stamped_views(uuid,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.defer_designpro_for_proofs(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.defer_designpro_for_proofs(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb) TO service_role;
