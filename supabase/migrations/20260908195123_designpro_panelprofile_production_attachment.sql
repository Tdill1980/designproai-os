-- Optional PPO child joins the existing production workflow without replacing
-- its canonical six panels/eighteen outputs or granting any human approval.
CREATE TABLE public.designpro_panelprofile_reservations (
  production_run_id uuid PRIMARY KEY REFERENCES public.designpro_workflow_runs(id),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  revision_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.designpro_panelprofile_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_run_id uuid NOT NULL UNIQUE REFERENCES public.designpro_workflow_runs(id),
  child_run_id uuid NOT NULL REFERENCES public.panelprofile_runs(id),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  attached_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX designpro_panelprofile_attachment_child_idx ON public.designpro_panelprofile_attachments(child_run_id);
CREATE TRIGGER designpro_panelprofile_reservation_immutable BEFORE UPDATE OR DELETE ON public.designpro_panelprofile_reservations
  FOR EACH ROW EXECUTE FUNCTION public.panelprofile_reject_mutation();
CREATE TRIGGER designpro_panelprofile_attachment_immutable BEFORE UPDATE OR DELETE ON public.designpro_panelprofile_attachments
  FOR EACH ROW EXECUTE FUNCTION public.panelprofile_reject_mutation();
ALTER TABLE public.designpro_panelprofile_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designpro_panelprofile_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.designpro_panelprofile_reservations,public.designpro_panelprofile_attachments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.designpro_panelprofile_reservations,public.designpro_panelprofile_attachments TO service_role;

CREATE FUNCTION public.reserve_panelprofile_for_production(p_actor uuid,p_production_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.designpro_workflow_runs%ROWTYPE; s public.designpro_workflow_stages%ROWTYPE;
  src public.designpro_revision_sources%ROWTYPE; reservation public.designpro_panelprofile_reservations%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.designpro_qc_members q JOIN auth.users u ON u.id=q.user_id
      WHERE q.user_id=p_actor AND q.can_preflight AND u.email_confirmed_at IS NOT NULL)
    THEN RAISE EXCEPTION 'panelprofile_qc_permission_required'; END IF;
  -- Lock in the same stage-before-run order as production completion.
  SELECT * INTO STRICT s FROM public.designpro_workflow_stages WHERE run_id=p_production_run_id AND stage_key='output.verify' FOR UPDATE;
  SELECT * INTO STRICT p FROM public.designpro_workflow_runs WHERE id=p_production_run_id FOR UPDATE;
  SELECT * INTO STRICT src FROM public.designpro_revision_sources WHERE revision_id=p.revision_id AND owner_id=p.owner_id AND snapshot_hash=p.revision_snapshot_hash;
  SELECT * INTO reservation FROM public.designpro_panelprofile_reservations WHERE production_run_id=p.id;
  IF FOUND THEN RETURN to_jsonb(reservation); END IF;
  IF p.workflow_type IS DISTINCT FROM 'designpro.production_pack' OR p.status IN ('completed','failed','cancelled')
    OR p.manifest_hash IS NULL OR s.status IS DISTINCT FROM 'pending' OR s.attempt<>0 OR s.started_at IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM public.designpro_workflow_stages g WHERE g.run_id=p.id AND g.stage_key='await_purchase'
      AND g.status='completed' AND g.verification @> '{"verified":true}'::jsonb
      AND g.output#>'{authorizedAssetManifest,productionPackAuthorized}'='true'::jsonb)
    THEN RAISE EXCEPTION 'panelprofile_reservation_window_closed'; END IF;
  INSERT INTO public.designpro_panelprofile_reservations(production_run_id,owner_id,revision_id,generation_id,manifest_hash,requested_by)
    VALUES(p.id,p.owner_id,p.revision_id,src.generation_id,p.manifest_hash,p_actor) RETURNING * INTO reservation;
  RETURN to_jsonb(reservation);
END $$;

CREATE FUNCTION public.attach_panelprofile_to_production(p_actor uuid,p_child_run_id uuid,p_production_run_id uuid,p_verified_inventory jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.designpro_workflow_runs%ROWTYPE; c public.panelprofile_runs%ROWTYPE;
  s public.designpro_workflow_stages%ROWTYPE; src public.designpro_revision_sources%ROWTYPE;
  handoff public.panelprofile_source_handoffs%ROWTYPE; existing public.designpro_panelprofile_attachments%ROWTYPE;
  h jsonb; pack jsonb; approval jsonb; verified jsonb; inventory jsonb; snap jsonb; master_hash text; order_number text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.designpro_qc_members q JOIN auth.users u ON u.id=q.user_id
      WHERE q.user_id=p_actor AND q.can_preflight AND u.email_confirmed_at IS NOT NULL)
    THEN RAISE EXCEPTION 'panelprofile_qc_permission_required'; END IF;
  SELECT * INTO STRICT s FROM public.designpro_workflow_stages WHERE run_id=p_production_run_id AND stage_key='output.verify' FOR UPDATE;
  SELECT * INTO STRICT p FROM public.designpro_workflow_runs WHERE id=p_production_run_id FOR UPDATE;
  SELECT * INTO existing FROM public.designpro_panelprofile_attachments WHERE production_run_id=p.id;
  IF FOUND THEN
    IF existing.child_run_id=p_child_run_id THEN RETURN to_jsonb(existing); END IF;
    RAISE EXCEPTION 'panelprofile_attachment_already_selected';
  END IF;
  IF p.workflow_type IS DISTINCT FROM 'designpro.production_pack' OR p.status IN ('completed','failed','cancelled')
    OR s.status NOT IN ('pending','retryable','running')
    OR EXISTS(SELECT 1 FROM public.designpro_stage_receipts WHERE run_id=p.id AND receipt_kind IN ('output.verified','final.human-qc','stamp','zip','wrapbox.delivery'))
    OR NOT EXISTS(SELECT 1 FROM public.designpro_workflow_stages g WHERE g.run_id=p.id AND g.stage_key='await_purchase'
      AND g.status='completed' AND g.verification @> '{"verified":true}'::jsonb
      AND g.output#>'{authorizedAssetManifest,productionPackAuthorized}'='true'::jsonb)
    OR ((s.started_at IS NOT NULL OR s.attempt<>0 OR s.status<>'pending')
      AND NOT EXISTS(SELECT 1 FROM public.designpro_panelprofile_reservations WHERE production_run_id=p.id))
    THEN RAISE EXCEPTION 'panelprofile_attachment_window_closed'; END IF;
  SELECT * INTO STRICT c FROM public.panelprofile_runs WHERE id=p_child_run_id AND owner_id=p.owner_id;
  SELECT * INTO STRICT handoff FROM public.panelprofile_source_handoffs WHERE id=c.source_id AND owner_id=p.owner_id;
  SELECT * INTO STRICT src FROM public.designpro_revision_sources WHERE revision_id=p.revision_id AND owner_id=p.owner_id AND snapshot_hash=p.revision_snapshot_hash;
  order_number:=COALESCE(p.input#>>'{fulfillment,orderNumber}',src.snapshot->>'orderNumber');
  master_hash:=handoff.handoff#>>'{master,contentHash}';
  IF c.state IS DISTINCT FROM 'completed' OR handoff.source_app IS DISTINCT FROM 'DesignPro'
    OR handoff.revision_id IS DISTINCT FROM p.revision_id::text OR handoff.generation_id IS DISTINCT FROM src.generation_id::text
    OR handoff.input_hash IS DISTINCT FROM c.input_hash OR handoff.handoff->>'dimensionManifestHash' IS DISTINCT FROM p.manifest_hash
    OR master_hash IS NULL OR jsonb_array_length(src.snapshot->'callOnePanels') IS DISTINCT FROM 6
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(src.snapshot->'callOnePanels') x WHERE x->>'sourceMasterHash' IS DISTINCT FROM master_hash)
    OR (handoff.design_id IS NOT NULL AND handoff.design_id IS DISTINCT FROM src.snapshot->>'designId')
    OR (handoff.order_id IS NOT NULL AND handoff.order_id IS DISTINCT FROM order_number) OR order_number IS NULL
    THEN RAISE EXCEPTION 'panelprofile_attachment_source_mismatch'; END IF;
  -- A reviewed child archive can carry reusable assets. Preserve the existing
  -- Logo Pack boundary using recorded path/hash ancestry, never a filename or
  -- an inferred visual label. Customer-provided assets are not reclassified.
  IF NOT EXISTS(SELECT 1 FROM public.designpro_workflow_stages g WHERE g.run_id=p.id AND g.stage_key='await_purchase'
      AND g.status='completed' AND g.output#>'{authorizedAssetManifest,logoPackAuthorized}'='true'::jsonb)
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(handoff.handoff->'availableAssets','[]')) asset
      JOIN public.designpro_artifacts a ON a.storage_path=asset->>'storagePath' AND a.content_hash=asset->>'contentHash'
      JOIN public.designpro_workflow_runs r ON r.id=a.run_id AND r.owner_id=p.owner_id
      WHERE a.artifact_kind='logo')
    THEN RAISE EXCEPTION 'panelprofile_logo_entitlement_required'; END IF;
  SELECT output INTO h FROM public.panelprofile_nodes WHERE run_id=c.id AND node_key='panelprofileoutput.handoff' AND state='completed';
  SELECT output INTO pack FROM public.panelprofile_nodes WHERE run_id=c.id AND node_key='panelprofileoutput.package' AND state='completed';
  SELECT output INTO approval FROM public.panelprofile_nodes WHERE run_id=c.id AND node_key='await_panelpro_preflight_qc' AND state='completed';
  SELECT output INTO verified FROM public.panelprofile_nodes WHERE run_id=c.id AND node_key='panelprofileoutput.verify' AND state='completed';
  IF h IS NULL OR pack IS NULL OR approval IS NULL OR verified IS NULL OR h->'qcApproved' IS DISTINCT FROM 'true'::jsonb
    OR h->>'artifactSetHash' IS DISTINCT FROM c.artifact_set_hash OR pack->>'artifactSetHash' IS DISTINCT FROM c.artifact_set_hash
    OR pack->'approval' IS DISTINCT FROM approval OR approval->'qcApproved' IS DISTINCT FROM 'true'::jsonb
    OR approval->>'artifactSetHash' IS DISTINCT FROM c.artifact_set_hash
    OR verified->'verified' IS DISTINCT FROM 'true'::jsonb OR verified->>'inputHash' IS DISTINCT FROM c.input_hash
    OR verified->>'artifactSetHash' IS DISTINCT FROM c.artifact_set_hash
    OR ((approval->'checks') @> '{"template":true,"fit":true,"essentialArtworkSafe":true,"backgroundContinuous":true,"fiveInchBleed":true,"resolution":true,"physicalPieces":true,"filesInspected":true}'::jsonb) IS DISTINCT FROM true
    OR (SELECT count(*) FROM public.panelprofile_nodes n WHERE n.run_id=c.id AND n.node_key LIKE 'panelprofileoutput.render:%' AND n.state='completed')
      IS DISTINCT FROM jsonb_array_length(handoff.handoff->'pieces')
    OR EXISTS(SELECT 1 FROM public.panelprofile_nodes n WHERE n.run_id=c.id AND n.node_key LIKE 'panelprofileoutput.render:%'
      AND (n.state IS DISTINCT FROM 'completed' OR jsonb_typeof(n.output->'pieces') IS DISTINCT FROM 'array'))
    OR NOT EXISTS(SELECT 1 FROM public.designpro_qc_members q JOIN auth.users u ON u.id=q.user_id
      WHERE q.user_id::text=approval->>'actorId' AND q.can_preflight AND u.email_confirmed_at IS NOT NULL)
    THEN RAISE EXCEPTION 'panelprofile_attachment_not_reviewed'; END IF;
  IF h->'requiresProofRefresh' IS DISTINCT FROM 'false'::jsonb OR h->'compositionChanged'='true'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(handoff.handoff->'pieces') x WHERE x#>'{composition,rebuildFromSeparatedAssets}'='true'::jsonb OR x#>'{composition,compositionChanged}'='true'::jsonb)
    OR EXISTS(SELECT 1 FROM public.panelprofile_nodes n CROSS JOIN LATERAL jsonb_array_elements(n.output->'pieces') piece
      WHERE n.run_id=c.id AND n.node_key LIKE 'panelprofileoutput.render:%'
        AND (piece->'compositionChanged'='true'::jsonb OR piece#>>'{evidence,cutAreaFill}'='verified-existing-nonessential-background'
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(piece->'placements') e WHERE e->'moved'='true'::jsonb)))
    THEN RAISE EXCEPTION 'panelprofile_proof_refresh_required'; END IF;
  SELECT jsonb_agg(jsonb_build_object('role',role,'pieceId',piece_id,'storagePath',storage_path,'contentHash',content_hash,
    'byteSize',byte_size,'mimeType',mime_type) ORDER BY storage_path COLLATE "C") INTO inventory FROM public.panelprofile_artifacts WHERE run_id=c.id;
  IF inventory IS NULL OR inventory IS DISTINCT FROM p_verified_inventory
    OR (SELECT count(*) FROM public.panelprofile_artifacts WHERE run_id=c.id AND role='reviewed-package')<>1
    OR NOT EXISTS(SELECT 1 FROM public.panelprofile_artifacts WHERE run_id=c.id AND role='reviewed-package'
      AND storage_path=pack#>>'{zip,storagePath}' AND content_hash=pack#>>'{zip,contentHash}' AND byte_size=(pack#>>'{zip,byteSize}')::bigint)
    THEN RAISE EXCEPTION 'panelprofile_attachment_inventory_changed'; END IF;
  snap:=jsonb_build_object('contractVersion','designpro.panelprofile-production-attachment.v1','parentRunId',p.id,'childRunId',c.id,
    'sourceId',handoff.id,'sourceApp','DesignPro','generationId',src.generation_id,'revisionId',p.revision_id,
    'designId',src.snapshot->>'designId','orderNumber',order_number,'masterHash',master_hash,'dimensionManifestHash',p.manifest_hash,
    'inputHash',c.input_hash,'artifactSetHash',c.artifact_set_hash,'approval',approval,'zip',pack->'zip','files',inventory,
    'template',jsonb_build_object('templateId',handoff.handoff#>>'{template,templateId}','version',handoff.handoff#>>'{template,version}',
      'profileHash',handoff.handoff#>>'{template,profileHash}','geometryHash',handoff.handoff#>>'{template,geometryHash}'),
    'requiresProofRefresh',false,'customerReleaseApproved',false);
  INSERT INTO public.designpro_panelprofile_attachments(production_run_id,child_run_id,owner_id,snapshot,snapshot_hash,attached_by)
    VALUES(p.id,c.id,p.owner_id,snap,encode(extensions.digest(convert_to(snap::text,'UTF8'),'sha256'),'hex'),p_actor) RETURNING * INTO existing;
  RETURN to_jsonb(existing);
END $$;

CREATE FUNCTION public.defer_designpro_for_panelprofile(p_stage_id uuid,p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.designpro_workflow_stages%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.designpro_workflow_stages WHERE id=p_stage_id FOR UPDATE;
  IF NOT FOUND OR s.stage_key<>'output.verify' OR s.status<>'running' OR s.lease_token IS DISTINCT FROM p_lease_token
    OR s.lease_expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.designpro_panelprofile_reservations WHERE production_run_id=s.run_id)
    OR NOT EXISTS(SELECT 1 FROM public.designpro_workflow_runs WHERE id=s.run_id AND workflow_type='designpro.production_pack' AND status NOT IN ('completed','failed','cancelled'))
    THEN RETURN false; END IF;
  UPDATE public.designpro_workflow_stages SET status='retryable',attempt=greatest(0,attempt-1),available_at=clock_timestamp()+interval '30 seconds',
    wait_reason='panelprofile_pending',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE id=s.id;
  PERFORM public.designpro_sync_run_status(s.run_id);
  RETURN true;
END $$;

CREATE FUNCTION designpro_private.assert_panelprofile_attachment_join(p_run_id uuid,p_output jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE actual jsonb; supplied jsonb; out_value jsonb:=p_output;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('attachmentId',id,'childRunId',child_run_id,'snapshotHash',snapshot_hash,'snapshot',snapshot) ORDER BY id),'[]')
    INTO actual FROM public.designpro_panelprofile_attachments WHERE production_run_id=p_run_id;
  IF actual='[]'::jsonb AND EXISTS(SELECT 1 FROM public.designpro_panelprofile_reservations WHERE production_run_id=p_run_id)
    THEN RAISE EXCEPTION 'production_panelprofile_pending'; END IF;
  IF out_value IS NULL THEN SELECT receipt INTO out_value FROM public.designpro_stage_receipts WHERE run_id=p_run_id AND receipt_kind='output.verified'; END IF;
  supplied:=COALESCE(out_value->'panelProfileAttachments','[]'::jsonb);
  IF supplied IS DISTINCT FROM actual THEN RAISE EXCEPTION 'panelprofile_attachment_approval_drift'; END IF;
  RETURN actual;
END $$;

-- Extend the existing final proof validator in place, preserving its OID and
-- every installed gate. Both final approval and output completion call it.
DO $patch$
DECLARE definition text; anchor text:=E'BEGIN\n  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=p_run_id;';
BEGIN
  SELECT pg_get_functiondef('designpro_private.assert_final_proof_join(uuid,jsonb)'::regprocedure) INTO definition;
  IF strpos(definition,anchor)=0 OR strpos(definition,'assert_panelprofile_attachment_join')>0
    THEN RAISE EXCEPTION 'panelprofile_attachment_final_gate_anchor_missing'; END IF;
  EXECUTE replace(definition,anchor,E'BEGIN\n  PERFORM designpro_private.assert_panelprofile_attachment_join(p_run_id,p_output_receipt);\n  SELECT * INTO v_run FROM public.designpro_workflow_runs WHERE id=p_run_id;');
END $patch$;
REVOKE ALL ON FUNCTION public.reserve_panelprofile_for_production(uuid,uuid),public.attach_panelprofile_to_production(uuid,uuid,uuid,jsonb),
  public.defer_designpro_for_panelprofile(uuid,uuid),designpro_private.assert_panelprofile_attachment_join(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_panelprofile_for_production(uuid,uuid),public.attach_panelprofile_to_production(uuid,uuid,uuid,jsonb),
  public.defer_designpro_for_panelprofile(uuid,uuid),designpro_private.assert_panelprofile_attachment_join(uuid,jsonb) TO service_role;
