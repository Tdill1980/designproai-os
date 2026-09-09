-- Existing Generation ID and immutable ATLAS history remain authoritative.
-- A saved edit gets another request, a globally increasing sequence and its
-- exact parent. No old request, accepted image, approval or history is reset.
ALTER TABLE public.designpro_generation_requests
  ADD COLUMN parent_atlas_revision_id uuid REFERENCES public.designpro_flat_atlas_revisions(id) ON DELETE RESTRICT,
  ADD COLUMN revision_sequence integer NOT NULL DEFAULT 1 CHECK (revision_sequence>=1),
  ADD COLUMN revision_context jsonb,
  ADD COLUMN revision_context_hash text,
  ADD COLUMN revision_authorized_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN revision_handoff_available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN revision_handoff_error jsonb,
  ADD CONSTRAINT designpro_generation_revision_context_shape CHECK (COALESCE((
    (parent_atlas_revision_id IS NULL AND revision_context IS NULL AND revision_context_hash IS NULL AND revision_authorized_by IS NULL AND revision_sequence=1)
    OR (parent_atlas_revision_id IS NOT NULL AND revision_sequence>1 AND revision_authorized_by IS NOT NULL
      AND jsonb_typeof(revision_context)='object' AND revision_context->>'contractVersion'='designpro.atlas-revision-intake.v1'
      AND revision_context_hash ~ '^[0-9a-f]{64}$')),false));

-- Remove exactly the historical owner/generation uniqueness constraint. Its
-- partial replacement keeps one original request, allowing immutable children.
DO $migration$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.designpro_generation_requests'::regclass
    AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (owner_id, generation_id)'
  LOOP EXECUTE format('ALTER TABLE public.designpro_generation_requests DROP CONSTRAINT %I',c.conname); END LOOP;
END
$migration$;
CREATE UNIQUE INDEX designpro_generation_one_root ON public.designpro_generation_requests(owner_id,generation_id) WHERE parent_atlas_revision_id IS NULL;
CREATE UNIQUE INDEX designpro_generation_revision_sequence ON public.designpro_generation_requests(owner_id,generation_id,revision_sequence);
CREATE UNIQUE INDEX designpro_generation_revision_intent ON public.designpro_generation_requests(owner_id,generation_id,revision_context_hash) WHERE parent_atlas_revision_id IS NOT NULL;
CREATE UNIQUE INDEX designpro_atlas_generation_revision_sequence ON public.designpro_flat_atlas_revisions(owner_id,generation_id,revision_sequence);

-- The compact, recursively sorted representation matches the server helper.
-- The hash excludes mutable lease/status data and never contains signed parts.
CREATE OR REPLACE FUNCTION designpro_private.atlas_revision_canonical(p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,designpro_private AS $fn$
  SELECT CASE jsonb_typeof(p_value)
    WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::text||':'||designpro_private.atlas_revision_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(p_value)),'')||'}'
    WHEN 'array' THEN '['||COALESCE((SELECT string_agg(designpro_private.atlas_revision_canonical(value),',' ORDER BY ord) FROM jsonb_array_elements(p_value) WITH ORDINALITY AS a(value,ord)),'')||']'
    ELSE p_value::text END
$fn$;
CREATE OR REPLACE FUNCTION designpro_private.atlas_revision_hash(p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,extensions,designpro_private AS $fn$
  SELECT encode(extensions.digest(convert_to(designpro_private.atlas_revision_canonical(p_value),'UTF8'),'sha256'),'hex')
$fn$;

ALTER TABLE public.designpro_generation_requests DROP CONSTRAINT designpro_generation_request_identity;
ALTER TABLE public.designpro_generation_requests ADD CONSTRAINT designpro_generation_request_identity CHECK (
  CASE WHEN parent_atlas_revision_id IS NOT NULL THEN idempotency_key='calls17-edit:'||generation_id::text||':'||revision_context_hash
    WHEN request_input->>'contractVersion'=ANY(ARRAY['designpro.calls-1-7-input.v2','designpro.calls-1-7-input.v3'])
      THEN idempotency_key='calls17:'||generation_id::text||':'||input_hash
    ELSE idempotency_key='calls17:'||generation_id::text||':'||(request_input#>>'{delivery,recipientIdentityHash}')||':'
      ||encode(extensions.digest(convert_to(request_input->>'orderNumber','UTF8'),'sha256'),'hex') END);

CREATE OR REPLACE FUNCTION designpro_private.protect_atlas_request_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
  IF ROW(NEW.owner_id,NEW.generation_id,NEW.tenant_key,NEW.request_input,NEW.input_hash,NEW.idempotency_key,
      NEW.engine_contract,NEW.engine_contract_hash,NEW.parent_atlas_revision_id,NEW.revision_sequence,
      NEW.revision_context,NEW.revision_context_hash,NEW.revision_authorized_by)
    IS DISTINCT FROM ROW(OLD.owner_id,OLD.generation_id,OLD.tenant_key,OLD.request_input,OLD.input_hash,OLD.idempotency_key,
      OLD.engine_contract,OLD.engine_contract_hash,OLD.parent_atlas_revision_id,OLD.revision_sequence,
      OLD.revision_context,OLD.revision_context_hash,OLD.revision_authorized_by)
  THEN RAISE EXCEPTION 'atlas_request_identity_is_immutable'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER designpro_atlas_request_identity_immutable BEFORE UPDATE ON public.designpro_generation_requests
FOR EACH ROW EXECUTE FUNCTION designpro_private.protect_atlas_request_identity();

CREATE OR REPLACE FUNCTION public.enqueue_designpro_atlas_revision(p_actor uuid,p_parent_revision_id uuid,p_context jsonb,p_context_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions,designpro_private AS $fn$
DECLARE p public.designpro_flat_atlas_revisions%ROWTYPE; r public.designpro_generation_requests%ROWTYPE;
  v_row public.designpro_generation_requests%ROWTYPE; v_sequence integer; v_hash text; v_contract jsonb; v_idempotent boolean:=false;
BEGIN
  IF COALESCE(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO p FROM public.designpro_flat_atlas_revisions WHERE id=p_parent_revision_id;
  IF NOT FOUND OR p_actor IS NULL OR (p.owner_id<>p_actor AND NOT EXISTS(SELECT 1 FROM public.designpro_qc_members WHERE user_id=p_actor AND can_preflight))
  THEN RAISE EXCEPTION 'generation_access_denied'; END IF;
  SELECT * INTO r FROM public.designpro_generation_requests WHERE id=p.request_id AND owner_id=p.owner_id;
  IF NOT FOUND OR r.request_input->>'pipelineMode'<>'flat-first-atlas-v1' OR p.metadata->>'masterQcPassed' IS DISTINCT FROM 'true'
    OR p_context->>'contractVersion' IS DISTINCT FROM 'designpro.atlas-revision-intake.v1'
    OR p_context->>'ownerId' IS DISTINCT FROM p.owner_id::text OR p_context->>'generationId' IS DISTINCT FROM p.generation_id::text
    OR p_context->>'parentAtlasRevisionId' IS DISTINCT FROM p.id::text OR p_context->>'parentRequestId' IS DISTINCT FROM p.request_id::text
    OR p_context->>'parentRevisionSequence' IS DISTINCT FROM p.revision_sequence::text
    OR p_context#>>'{parentMaster,storagePath}' IS DISTINCT FROM p.master_storage_path
    OR p_context#>>'{parentMaster,contentHash}' IS DISTINCT FROM p.master_content_hash
    OR p_context#>>'{parentMaster,byteSize}' IS DISTINCT FROM p.master_byte_size::text
    OR p_context#>>'{parentMaster,contentType}' IS DISTINCT FROM p.master_content_type
    OR p_context#>>'{parentManifest,storagePath}' IS DISTINCT FROM p.manifest_storage_path
    OR p_context#>>'{parentManifest,contentHash}' IS DISTINCT FROM p.manifest_content_hash
    OR p_context#>>'{parentManifest,byteSize}' IS DISTINCT FROM p.manifest_byte_size::text
    OR p_context#>>'{parentManifest,contentType}' IS DISTINCT FROM p.manifest_content_type
    OR length(btrim(COALESCE(p_context->>'instruction',''))) NOT BETWEEN 1 AND 4000
    OR COALESCE(p_context#>>'{history,mode}','') NOT IN ('generate-content-replay','image-reference')
    OR p_context_hash IS NULL OR p_context_hash IS DISTINCT FROM designpro_private.atlas_revision_hash(p_context)
    OR jsonb_typeof(p_context->'affectedSurfaces') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_context->'affectedSurfaces') NOT BETWEEN 1 AND 6
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_context->'affectedSurfaces') s WHERE s NOT IN ('driver','passenger','hood','roof','front','rear'))
    OR (SELECT count(DISTINCT s) FROM jsonb_array_elements_text(p_context->'affectedSurfaces') s)<>jsonb_array_length(p_context->'affectedSurfaces')
    OR jsonb_typeof(p_context->'editAssets') IS DISTINCT FROM 'array' OR jsonb_array_length(p_context->'editAssets')>10
  THEN RAISE EXCEPTION 'atlas_revision_context_invalid'; END IF;
  IF jsonb_typeof(p.metadata->'callOnePanels') IS DISTINCT FROM 'array' OR jsonb_array_length(p.metadata->'callOnePanels')<>6
    OR (SELECT count(DISTINCT e->>'surfaceKey') FROM jsonb_array_elements(p.metadata->'callOnePanels') e WHERE e->>'surfaceKey' IN ('driver','passenger','hood','roof','front','rear') AND e->>'sourceMasterHash'=p.master_content_hash)<>6
  THEN RAISE EXCEPTION 'atlas_revision_parent_panels_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('designpro.calls-1-7.owner:'||p.owner_id::text,0));
  SELECT * INTO v_row FROM public.designpro_generation_requests WHERE owner_id=p.owner_id AND generation_id=p.generation_id AND revision_context_hash=p_context_hash;
  IF FOUND THEN
    IF v_row.revision_context IS DISTINCT FROM p_context THEN RAISE EXCEPTION 'atlas_revision_idempotency_conflict'; END IF;
    v_idempotent:=true;
  ELSE
    IF EXISTS(SELECT 1 FROM public.designpro_generation_requests WHERE owner_id=p.owner_id AND state IN ('queued','leased','retryable'))
    THEN RAISE EXCEPTION 'generation_active_request_limit'; END IF;
    SELECT greatest(COALESCE((SELECT max(revision_sequence) FROM public.designpro_generation_requests WHERE owner_id=p.owner_id AND generation_id=p.generation_id),1),
      COALESCE((SELECT max(revision_sequence) FROM public.designpro_flat_atlas_revisions WHERE owner_id=p.owner_id AND generation_id=p.generation_id),1))+1 INTO v_sequence;
    v_contract:=designpro_private.calls_1_7_engine_contract();
    v_hash:=designpro_private.atlas_revision_hash(jsonb_build_object('input',r.request_input,'revisionContextHash',p_context_hash));
    INSERT INTO public.designpro_generation_requests(generation_id,owner_id,tenant_key,idempotency_key,request_input,input_hash,engine_contract,engine_contract_hash,
      parent_atlas_revision_id,revision_sequence,revision_context,revision_context_hash,revision_authorized_by)
    VALUES(p.generation_id,p.owner_id,p.tenant_key,'calls17-edit:'||p.generation_id::text||':'||p_context_hash,r.request_input,v_hash,v_contract,
      encode(extensions.digest(convert_to(v_contract::text,'UTF8'),'sha256'),'hex'),p.id,v_sequence,p_context,p_context_hash,p_actor) RETURNING * INTO v_row;
  END IF;
  RETURN jsonb_build_object('requestId',v_row.id,'generationId',v_row.generation_id,'parentAtlasRevisionId',v_row.parent_atlas_revision_id,
    'revisionSequence',v_row.revision_sequence,'state',v_row.state,'inputHash',v_row.input_hash,'engineContractHash',v_row.engine_contract_hash,'idempotent',v_idempotent);
END
$fn$;

-- Legacy same-request histories retain their original validation. New requests
-- bind to the authorized parent even when branching from an older saved version.
CREATE OR REPLACE FUNCTION designpro_private.validate_flat_atlas_revision_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE r public.designpro_generation_requests%ROWTYPE; p public.designpro_flat_atlas_revisions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.designpro_generation_requests WHERE id=NEW.request_id;
  IF NOT FOUND OR r.generation_id IS DISTINCT FROM NEW.generation_id OR r.owner_id IS DISTINCT FROM NEW.owner_id
    OR r.tenant_key IS DISTINCT FROM NEW.tenant_key OR r.request_input->>'contractVersion' IS DISTINCT FROM 'designpro.calls-1-7-input.v3'
    OR r.request_input->>'pipelineMode' IS DISTINCT FROM 'flat-first-atlas-v1' THEN RAISE EXCEPTION 'flat_atlas_request_identity_mismatch'; END IF;
  IF r.parent_atlas_revision_id IS NOT NULL THEN
    SELECT * INTO p FROM public.designpro_flat_atlas_revisions WHERE id=r.parent_atlas_revision_id;
    IF NOT FOUND OR NEW.parent_revision_id IS DISTINCT FROM p.id OR NEW.revision_sequence<>r.revision_sequence
      OR p.revision_sequence>=NEW.revision_sequence OR p.owner_id<>NEW.owner_id OR p.generation_id<>NEW.generation_id
      OR NEW.metadata->>'revisionContextHash' IS DISTINCT FROM r.revision_context_hash
      OR EXISTS(SELECT 1 FROM public.designpro_flat_atlas_revisions WHERE request_id=r.id)
    THEN RAISE EXCEPTION 'flat_atlas_revision_lineage_invalid'; END IF;
  ELSIF NEW.parent_revision_id IS NULL THEN
    IF NEW.revision_sequence<>1 THEN RAISE EXCEPTION 'flat_atlas_revision_lineage_invalid'; END IF;
  ELSE
    SELECT * INTO p FROM public.designpro_flat_atlas_revisions WHERE id=NEW.parent_revision_id;
    IF NOT FOUND OR p.request_id<>NEW.request_id OR p.generation_id<>NEW.generation_id OR p.owner_id<>NEW.owner_id
      OR NEW.revision_sequence<>p.revision_sequence+1
      OR EXISTS(SELECT 1 FROM public.designpro_generation_requests child WHERE child.generation_id=NEW.generation_id
        AND child.owner_id=NEW.owner_id AND child.parent_atlas_revision_id IS NOT NULL)
    THEN RAISE EXCEPTION 'flat_atlas_revision_lineage_invalid'; END IF;
  END IF;
  RETURN NEW;
END
$fn$;

-- The service consumes only persisted, previously authorized edit intent.
-- Generic save_designpro_revision_source remains authenticated-only unchanged.
CREATE OR REPLACE FUNCTION public.handoff_designpro_atlas_revision(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions,designpro_private AS $fn$
DECLARE r public.designpro_generation_requests%ROWTYPE; a public.designpro_flat_atlas_revisions%ROWTYPE;
  p public.designpro_flat_atlas_revisions%ROWTYPE; s public.designpro_revision_sources%ROWTYPE;
  v_revision uuid; v_render jsonb; v_snapshot jsonb; v_base jsonb; v_hash text; v_workflow jsonb;
  v_idempotency text; v_existing boolean; v_parent_source uuid; v_fulfillment jsonb;
  v_parent_binding designpro_private.revision_fulfillment_bindings%ROWTYPE;
  v_child_binding designpro_private.revision_fulfillment_bindings%ROWTYPE;
  v_binding_hash text;
BEGIN
  IF COALESCE(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO r FROM public.designpro_generation_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR r.parent_atlas_revision_id IS NULL OR r.revision_authorized_by IS NULL THEN RAISE EXCEPTION 'atlas_revision_authorized_intent_required'; END IF;
  BEGIN
    IF r.state<>'outputs_ready' THEN RAISE EXCEPTION 'atlas_revision_outputs_not_ready'; END IF;
    SELECT * INTO a FROM public.designpro_flat_atlas_revisions WHERE request_id=r.id AND revision_sequence=r.revision_sequence;
    SELECT * INTO p FROM public.designpro_flat_atlas_revisions WHERE id=r.parent_atlas_revision_id;
    IF a.id IS NULL OR p.id IS NULL OR a.owner_id<>r.owner_id OR a.generation_id<>r.generation_id OR a.parent_revision_id<>p.id
      OR a.metadata->>'revisionContextHash' IS DISTINCT FROM r.revision_context_hash OR a.metadata->>'masterQcPassed' IS DISTINCT FROM 'true'
      OR jsonb_typeof(a.metadata->'callOnePanels') IS DISTINCT FROM 'array' OR jsonb_array_length(a.metadata->'callOnePanels')<>6
      OR (SELECT count(DISTINCT e->>'surfaceKey') FROM jsonb_array_elements(a.metadata->'callOnePanels') e WHERE e->>'surfaceKey' IN ('driver','passenger','hood','roof','front','rear') AND e->>'sourceMasterHash'=a.master_content_hash)<>6
    THEN RAISE EXCEPTION 'atlas_revision_handoff_identity_mismatch'; END IF;
    v_revision:=NULLIF(r.engine_receipt->>'handoffRevisionId','')::uuid;
    IF v_revision IS NULL OR v_revision=NULLIF((SELECT engine_receipt->>'handoffRevisionId' FROM public.designpro_generation_requests WHERE id=p.request_id),'')::uuid
    THEN RAISE EXCEPTION 'atlas_revision_manufacturing_revision_invalid'; END IF;
    IF (SELECT count(*) FROM public.designpro_generation_views WHERE request_id=r.id AND superseded_at IS NULL)<>7
      OR (SELECT count(DISTINCT consumer_role) FROM public.designpro_generation_views WHERE request_id=r.id AND superseded_at IS NULL AND consumer_role IN ('driver','passenger','hood','roof','front','rear'))<>6
      OR (SELECT count(*) FROM public.designpro_generation_views WHERE request_id=r.id AND superseded_at IS NULL AND consumer_role IN ('closeup','hero3d'))<>1
      OR EXISTS(SELECT 1 FROM public.designpro_generation_views v WHERE v.request_id=r.id AND v.superseded_at IS NULL AND (
        v.metadata#>>'{authority,revisionId}' IS DISTINCT FROM a.id::text
        OR v.metadata#>>'{provider,atlasMasterContentHash}' IS DISTINCT FROM a.master_content_hash))
    THEN RAISE EXCEPTION 'atlas_revision_exact_seven_proofs_required'; END IF;
    SELECT jsonb_object_agg(v.consumer_role,jsonb_build_object('storagePath','users/'||r.owner_id::text||'/revisions/'||v_revision::text||'/inputs/'||v.consumer_role||'/'||v.content_hash||CASE v.content_type WHEN 'image/png' THEN '.png' WHEN 'image/jpeg' THEN '.jpg' ELSE '.webp' END,
      'contentHash',v.content_hash,'byteSize',v.byte_size,'contentType',v.content_type)) INTO v_render
    FROM public.designpro_generation_views v WHERE v.request_id=r.id AND v.superseded_at IS NULL;
    SELECT revision_id,snapshot INTO v_parent_source,v_base FROM public.designpro_revision_sources WHERE owner_id=r.owner_id AND visualization_id=p.request_id ORDER BY created_at DESC LIMIT 1;
    IF v_parent_source IS NOT NULL THEN
      v_fulfillment:=designpro_private.revision_fulfillment(v_parent_source);
      SELECT * INTO v_parent_binding FROM designpro_private.revision_fulfillment_bindings WHERE revision_id=v_parent_source AND owner_id=r.owner_id;
    END IF;
    IF v_base IS NULL THEN
      IF jsonb_typeof(r.request_input->'logoAsset')='object' THEN RAISE EXCEPTION 'generation_logo_placement_manifest_required'; END IF;
      v_base:=jsonb_build_object('contractVersion','designpro.revision-snapshot.v1','designId','DID-'||upper(left(replace(r.generation_id::text,'-',''),8)),
        'designName',r.request_input->>'designName','vehicle',r.request_input->'vehicle','finish',COALESCE(r.request_input->>'finish','standard'),
        'surfaceOptions',jsonb_build_object('required',jsonb_build_array('driver','passenger','hood','roof','front','rear')),
        'bodyText','[]'::jsonb,'brief',r.request_input->>'brief','brandAssets',COALESCE(jsonb_build_object('logo',r.request_input->'logoAsset'),'{}'::jsonb),
        'brandIdentity',jsonb_strip_nulls(jsonb_build_object('contractVersion','designpro.brand-identity.v1','mode',COALESCE(r.request_input->>'mode','restyle'),
          'companyName',COALESCE(r.request_input->>'companyName',r.request_input->>'businessName'),'phone',r.request_input->>'phone','website',r.request_input->>'website','authority','revision-snapshot')),
        'expectedLogoInventory','[]'::jsonb,'logoInventoryAttestation',jsonb_build_object('mode','none','attested',true,'source','calls-1-7-generated','placementPending',false),
        'fulfillment',jsonb_build_object('contractVersion','designpro.fulfillment-state.v1','state','unbound'));
    END IF;
    -- Contact/business identity is carried; every preview/panel and QC binding
    -- belongs to this new manufacturing revision. Old approvals are never copied.
    v_snapshot:=(v_base-ARRAY['renderAssets','callOnePanels','qcApproval','finalHumanQc','panelProfileOutput','outputFiles'])||jsonb_build_object(
      'contractVersion','designpro.revision-snapshot.v1','revisionId',v_revision,'generationId',r.generation_id,'visualizationId',r.id,
      'atlasRevisionId',a.id,'parentAtlasRevisionId',p.id,'revisionSequence',a.revision_sequence,
      'sourceMasterContentHash',a.master_content_hash,'sourceInputContract',r.request_input->>'contractVersion',
      'renderAssets',v_render,'callOnePanels',a.metadata->'callOnePanels','change',jsonb_build_object('view','all','instruction',r.revision_context->>'instruction',
        'affectedSurfaces',r.revision_context->'affectedSurfaces','attachmentIds',r.revision_context->'editAssets',
        'parentAtlasRevisionId',p.id,'revisionContextHash',r.revision_context_hash,'requiresFreshQc',true));
    v_hash:=encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
    v_idempotency:='calls17-handoff:'||r.id::text;
    SELECT * INTO s FROM public.designpro_revision_sources WHERE revision_id=v_revision FOR UPDATE;
    v_existing:=FOUND;
    IF v_existing THEN
      IF s.owner_id<>r.owner_id OR s.generation_id<>r.generation_id OR s.visualization_id<>r.id OR s.snapshot IS DISTINCT FROM v_snapshot
        OR s.snapshot_hash<>v_hash OR s.idempotency_key<>v_idempotency THEN RAISE EXCEPTION 'atlas_revision_handoff_identity_conflict'; END IF;
    ELSE
      INSERT INTO public.designpro_revision_sources(revision_id,owner_id,tenant_key,generation_id,visualization_id,expected_updated_at,snapshot,snapshot_hash,idempotency_key)
      VALUES(v_revision,r.owner_id,r.tenant_key,r.generation_id,r.id,r.completed_at,v_snapshot,v_hash,v_idempotency);
    END IF;
    -- Carry an already verified recipient/order binding to the new revision.
    -- The binding hash necessarily changes with revisionId; the registered
    -- recipient, original operator, order and payment remain unchanged.
    IF v_parent_binding.revision_id IS NOT NULL THEN
      IF v_fulfillment IS NULL OR v_fulfillment->>'orderNumber' IS DISTINCT FROM v_parent_binding.order_number
        OR v_fulfillment#>>'{delivery,recipientIdentityHash}' IS DISTINCT FROM v_parent_binding.recipient_identity_hash
      THEN RAISE EXCEPTION 'atlas_revision_parent_fulfillment_invalid'; END IF;
      v_binding_hash:=encode(extensions.digest(convert_to(jsonb_build_object('revisionId',v_revision,
        'orderNumber',v_parent_binding.order_number,'delivery',v_fulfillment->'delivery')::text,'UTF8'),'sha256'),'hex');
      INSERT INTO designpro_private.revision_fulfillment_bindings(revision_id,owner_id,bound_by_operator_id,recipient_identity_hash,order_number,design_name,binding_hash)
      VALUES(v_revision,r.owner_id,v_parent_binding.bound_by_operator_id,v_parent_binding.recipient_identity_hash,v_parent_binding.order_number,v_parent_binding.design_name,v_binding_hash)
      ON CONFLICT(revision_id) DO NOTHING;
      SELECT * INTO v_child_binding FROM designpro_private.revision_fulfillment_bindings WHERE revision_id=v_revision;
      IF v_child_binding.owner_id<>r.owner_id OR v_child_binding.binding_hash<>v_binding_hash
      THEN RAISE EXCEPTION 'atlas_revision_fulfillment_identity_conflict'; END IF;
    END IF;
    v_workflow:=public.create_designpro_entice_workflow(v_revision,v_idempotency,jsonb_build_object('trigger','revision.saved','revisionSnapshotHash',v_hash,
      'atlasRevisionId',a.id,'parentAtlasRevisionId',p.id,'revisionContextHash',r.revision_context_hash));
    UPDATE public.designpro_generation_requests SET revision_handoff_error=NULL WHERE id=r.id;
    RETURN jsonb_build_object('revisionId',v_revision,'generationId',r.generation_id,'workflowRunId',v_workflow->>'workflowRunId','alreadyHandedOff',v_existing,'state','handed_off');
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.designpro_generation_requests SET revision_handoff_error=jsonb_build_object('code',left(SQLERRM,160)),
      revision_handoff_available_at=now()+interval '30 seconds' WHERE id=r.id;
    RETURN jsonb_build_object('requestId',r.id,'state','blocked','code',left(SQLERRM,160));
  END;
END
$fn$;

CREATE OR REPLACE FUNCTION public.list_designpro_atlas_revision_handoffs(p_limit integer DEFAULT 5) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_rows jsonb;
BEGIN
  IF COALESCE(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'atlas_revision_handoff_limit_invalid'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('requestId',q.id)),'[]') INTO v_rows FROM (
    SELECT r.id FROM public.designpro_generation_requests r WHERE r.parent_atlas_revision_id IS NOT NULL AND r.state='outputs_ready'
      AND r.revision_handoff_available_at<=now() AND NOT EXISTS(SELECT 1 FROM public.designpro_revision_sources s
        JOIN public.designpro_workflow_runs w ON w.revision_id=s.revision_id AND w.workflow_type='designpro.entice_pack'
        WHERE s.visualization_id=r.id AND s.owner_id=r.owner_id)
    ORDER BY r.revision_handoff_available_at,r.created_at LIMIT p_limit) q;
  RETURN v_rows;
END
$fn$;

REVOKE ALL ON FUNCTION public.enqueue_designpro_atlas_revision(uuid,uuid,jsonb,text),public.handoff_designpro_atlas_revision(uuid),public.list_designpro_atlas_revision_handoffs(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_designpro_atlas_revision(uuid,uuid,jsonb,text),public.handoff_designpro_atlas_revision(uuid),public.list_designpro_atlas_revision_handoffs(integer) TO service_role;

-- Payment stays on the original verified transaction. A descendant may use
-- its already bought product only through the exact authorized parent chain,
-- same owner/generation and same registered fulfillment. Sibling designs and
-- an unrelated order never inherit an entitlement.
CREATE OR REPLACE FUNCTION designpro_private.atlas_revision_purchase_applies(p_target_entice_run_id uuid,p_paid_entice_run_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,designpro_private AS $fn$
  WITH RECURSIVE target AS (
    SELECT w.id,w.owner_id,w.revision_id,s.generation_id,s.visualization_id FROM public.designpro_workflow_runs w
      JOIN public.designpro_revision_sources s ON s.revision_id=w.revision_id AND s.owner_id=w.owner_id
      WHERE w.id=p_target_entice_run_id AND w.workflow_type='designpro.entice_pack'
  ), lineage AS (
    SELECT r.id,r.parent_atlas_revision_id,ARRAY[r.id] path FROM public.designpro_generation_requests r JOIN target t ON r.id=t.visualization_id AND r.owner_id=t.owner_id AND r.generation_id=t.generation_id
    UNION ALL
    SELECT r.id,r.parent_atlas_revision_id,l.path||r.id FROM lineage l
      JOIN public.designpro_flat_atlas_revisions a ON a.id=l.parent_atlas_revision_id
      JOIN public.designpro_generation_requests r ON r.id=a.request_id
      JOIN target t ON r.owner_id=t.owner_id AND r.generation_id=t.generation_id
      WHERE NOT r.id=ANY(l.path)
  ) SELECT EXISTS(
    SELECT 1 FROM target t JOIN public.designpro_workflow_runs paid ON paid.id=p_paid_entice_run_id
      AND paid.workflow_type='designpro.entice_pack' AND paid.owner_id=t.owner_id
      JOIN public.designpro_revision_sources ps ON ps.revision_id=paid.revision_id AND ps.owner_id=t.owner_id AND ps.generation_id=t.generation_id
    WHERE (paid.id=t.id OR ps.visualization_id IN (SELECT id FROM lineage))
      AND designpro_private.revision_fulfillment(t.revision_id) IS NOT NULL
      AND designpro_private.revision_fulfillment(t.revision_id)->'delivery' IS NOT DISTINCT FROM designpro_private.revision_fulfillment(paid.revision_id)->'delivery'
      AND designpro_private.revision_fulfillment(t.revision_id)->>'orderNumber' IS NOT DISTINCT FROM designpro_private.revision_fulfillment(paid.revision_id)->>'orderNumber'
  )
$fn$;
REVOKE ALL ON FUNCTION designpro_private.atlas_revision_purchase_applies(uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Patch the installed read/creation functions; do not replace later integrity
-- fixes with an old wholesale definition. Exact anchors make drift fail loudly.
DO $selectors$
DECLARE v text; v_old text; v_new text; sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY['public.create_designpro_flat_first_generation_request(uuid,jsonb,text)','public.create_designpro_generation_request(uuid,jsonb,text)'] LOOP
    IF to_regprocedure(sig) IS NULL THEN CONTINUE; END IF;
    v:=pg_get_functiondef(to_regprocedure(sig));
    v_old:='WHERE owner_id=v_owner AND generation_id=p_generation_id';
    IF strpos(v,v_old)=0 THEN RAISE EXCEPTION 'atlas_revision_original_request_selector_missing: %',sig; END IF;
    EXECUTE replace(v,v_old,v_old||' AND parent_atlas_revision_id IS NULL');
  END LOOP;
  v:=pg_get_functiondef('public.designpro_generation_workspace(uuid)'::regprocedure);
  IF strpos(v,'ORDER BY created_at LIMIT 1')=0 THEN RAISE EXCEPTION 'atlas_revision_workspace_selector_missing'; END IF;
  v:=replace(v,'ORDER BY created_at LIMIT 1','ORDER BY revision_sequence DESC,created_at DESC,id DESC LIMIT 1');
  v:=replace(v,'''requestId'',v_row.id,','''requestId'',v_row.id,''parentAtlasRevisionId'',v_row.parent_atlas_revision_id,''revisionSequence'',v_row.revision_sequence,''revisionHandoffError'',v_row.revision_handoff_error,');
  EXECUTE v;
  v:=pg_get_functiondef('public.designpro_generation_os_snapshot(uuid)'::regprocedure);
  v_old:='WHERE r.generation_id=p_generation_id;';
  IF strpos(v,v_old)=0 THEN RAISE EXCEPTION 'atlas_revision_os_selector_missing'; END IF;
  v:=replace(v,v_old,'WHERE r.generation_id=p_generation_id ORDER BY r.revision_sequence DESC,r.created_at DESC,r.id DESC LIMIT 1;');
  v:=replace(v,E'WHERE a.request_id=v_request.id;\n',E'WHERE a.generation_id=p_generation_id AND a.owner_id=v_request.owner_id;\n');
  v:=replace(v,'''requestState'',v_request.state,','''requestState'',v_request.state,''parentAtlasRevisionId'',v_request.parent_atlas_revision_id,''requestRevisionSequence'',v_request.revision_sequence,''revisionHandoffError'',v_request.revision_handoff_error,');
  EXECUTE v;
  v:=pg_get_functiondef('public.designpro_generation_library(timestamp with time zone,integer)'::regprocedure);
  v:=replace(v,'WHERE a.request_id=r.id','WHERE a.generation_id=r.generation_id AND a.owner_id=r.owner_id');
  v_old:='WHERE r.created_at >= v_since';
  IF strpos(v,v_old)=0 THEN RAISE EXCEPTION 'atlas_revision_library_selector_missing'; END IF;
  EXECUTE replace(v,v_old,v_old||' AND NOT EXISTS(SELECT 1 FROM public.designpro_generation_requests newer WHERE newer.owner_id=r.owner_id AND newer.generation_id=r.generation_id AND newer.revision_sequence>r.revision_sequence)');
  v:=pg_get_functiondef('designpro_private.designpro_generation_phase(uuid)'::regprocedure);
  v:=replace(v,'WHERE generation_id=p_generation_id LIMIT 1','WHERE generation_id=p_generation_id ORDER BY revision_sequence DESC,created_at DESC LIMIT 1');
  v:=replace(v,'WHERE s.generation_id=p_generation_id','WHERE s.generation_id=p_generation_id AND s.visualization_id=(SELECT id FROM public.designpro_generation_requests WHERE generation_id=p_generation_id ORDER BY revision_sequence DESC,created_at DESC LIMIT 1)');
  v:=replace(v,'WHERE r.generation_id=p_generation_id) THEN','WHERE r.generation_id=p_generation_id AND r.id=(SELECT id FROM public.designpro_generation_requests WHERE generation_id=p_generation_id ORDER BY revision_sequence DESC,created_at DESC LIMIT 1)) THEN');
  EXECUTE v;
  -- Root handoff must read that exact request's panels, never the newest atlas
  -- elsewhere in the generation. Child requests use the dedicated service RPC.
  v:=pg_get_functiondef('public.handoff_designpro_generation_to_production(uuid)'::regprocedure);
  v:=replace(v,'WHERE r.generation_id=v_row.generation_id','WHERE r.request_id=v_row.id AND r.owner_id=v_row.owner_id');
  v_old:=E'  v_input_contract:=v_row.request_input->>''contractVersion'';';
  IF strpos(v,v_old)=0 THEN RAISE EXCEPTION 'atlas_revision_handoff_selector_missing'; END IF;
  v_new:=E'  IF v_row.parent_atlas_revision_id IS NOT NULL THEN\n    SELECT * INTO v_existing FROM public.designpro_revision_sources WHERE visualization_id=v_row.id AND owner_id=v_owner;\n    IF FOUND THEN\n      v_workflow:=public.create_designpro_entice_workflow(v_existing.revision_id,v_existing.idempotency_key,jsonb_build_object(''trigger'',''revision.saved'',''revisionSnapshotHash'',v_existing.snapshot_hash));\n      RETURN jsonb_build_object(''revisionId'',v_existing.revision_id,''generationId'',v_row.generation_id,''workflowRunId'',v_workflow->>''workflowRunId'',''alreadyHandedOff'',true);\n    END IF;\n    RAISE EXCEPTION ''atlas_revision_automatic_handoff_pending'';\n  END IF;\n';
  EXECUTE replace(v,v_old,v_new||v_old);
  v:=pg_get_functiondef('public.designpro_paid_products(uuid)'::regprocedure);
  IF strpos(v,'e.entice_run_id=p_entice_run_id')=0 THEN RAISE EXCEPTION 'atlas_revision_paid_product_selector_missing'; END IF;
  EXECUTE replace(v,'e.entice_run_id=p_entice_run_id','designpro_private.atlas_revision_purchase_applies(p_entice_run_id,e.entice_run_id)');
  v:=pg_get_functiondef('public.reconcile_designpro_purchase_gates()'::regprocedure);
  v_old:='e.entice_run_id=(r.results->>''sourceEnticeRunId'')::uuid';
  IF strpos(v,v_old)=0 THEN RAISE EXCEPTION 'atlas_revision_purchase_gate_selector_missing'; END IF;
  EXECUTE replace(v,v_old,'designpro_private.atlas_revision_purchase_applies((r.results->>''sourceEnticeRunId'')::uuid,e.entice_run_id)');
  IF to_regprocedure('designpro_private.is_authorized_logo_only_output(uuid,jsonb)') IS NOT NULL THEN
    v:=pg_get_functiondef('designpro_private.is_authorized_logo_only_output(uuid,jsonb)'::regprocedure);
    IF strpos(v,'e.entice_run_id=v_entice_id')=0 THEN RAISE EXCEPTION 'atlas_revision_logo_entitlement_selector_missing'; END IF;
    EXECUTE replace(v,'e.entice_run_id=v_entice_id','designpro_private.atlas_revision_purchase_applies(v_entice_id,e.entice_run_id)');
  END IF;
END
$selectors$;

-- Explicit saved-version reads never borrow the current request's proofs.
-- Same workspace projection and existing per-view supersession fences; the
-- selected immutable ATLAS row adds an exact request/master/owner boundary.
CREATE OR REPLACE FUNCTION public.designpro_atlas_revision_workspace(
  p_generation_id uuid,p_atlas_revision_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,designpro_private AS $fn$
DECLARE
  a public.designpro_flat_atlas_revisions%ROWTYPE;
  r public.designpro_generation_requests%ROWTYPE;
  v_superseded boolean;
  v_views jsonb;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->>'is_anonymous','false')='true'
  THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.designpro_flat_atlas_revisions
    WHERE id=p_atlas_revision_id AND generation_id=p_generation_id;
  IF NOT FOUND OR (a.owner_id IS DISTINCT FROM auth.uid() AND NOT designpro_private.caller_is_design_staff())
  THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.designpro_generation_requests
    WHERE id=a.request_id AND owner_id=a.owner_id AND generation_id=a.generation_id
      AND request_input->>'contractVersion'='designpro.calls-1-7-input.v3'
      AND request_input->>'pipelineMode'='flat-first-atlas-v1';
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_superseded:=designpro_private.flat_first_atlas_requires_new_run(r.id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',v.id,'sourceViewType',v.source_view_type,'consumerRole',v.consumer_role,
    'storagePath',v.storage_path,'contentHash',v.content_hash,'contentType',v.content_type,'byteSize',v.byte_size,
    'atlasMasterContentHash',v.metadata#>>'{provider,atlasMasterContentHash}',
    'atlasZoneContentHash',v.metadata#>>'{provider,atlasZoneContentHash}',
    'atlasZoneSurfaceKey',v.metadata#>>'{provider,atlasZoneSurfaceKey}',
    'atlasAnchoredToDriver',COALESCE(v.metadata#>'{provider,anchoredToView1}','false'::jsonb)='true'::jsonb,
    'atlasDeterministicMirror',COALESCE(v.metadata#>'{provider,deterministicMirror}','false'::jsonb)='true'::jsonb,
    'atlasRevisionId',v.metadata#>>'{authority,revisionId}'
  ) ORDER BY v.source_view_type),'[]'::jsonb) INTO v_views
  FROM public.designpro_generation_views v
  WHERE v.request_id=r.id AND v.superseded_at IS NULL
    AND v.metadata#>>'{authority,revisionId}'=a.id::text
    AND v.metadata#>>'{provider,atlasMasterContentHash}'=a.master_content_hash
    AND COALESCE(v.metadata#>>'{provider,anchoredToView1}','false')='false'
    AND NOT ((v.metadata->'provider') ? 'driverContentHash')
    AND NOT ((v.metadata->'provider') ? 'deterministicMirror')
    AND NOT ((v.metadata->'provider') ? 'passengerProducer')
    AND NOT ((v.metadata->'provider') ? 'atlasZonePassedToPassengerRepair');
  RETURN jsonb_build_object(
    'requestId',r.id,'generationId',r.generation_id,'ownerId',r.owner_id,'tenantKey',r.tenant_key,
    'parentAtlasRevisionId',a.parent_revision_id,'revisionSequence',a.revision_sequence,
    'atlasRevisionId',a.id,'masterContentHash',a.master_content_hash,
    'revisionHandoffError',r.revision_handoff_error,'state',r.state,
    'brief',r.request_input->>'brief','designName',r.request_input->>'designName',
    'companyName',r.request_input->>'companyName','finish',r.request_input->>'finish',
    'vehicle',r.request_input->'vehicle','pipelineMode',r.request_input->>'pipelineMode',
    'contractVersion',r.request_input->>'contractVersion','error',r.error,
    'createdAt',r.created_at,'updatedAt',r.updated_at,'completedAt',r.completed_at,
    'viewsSuperseded',v_superseded,'views',v_views
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.designpro_atlas_revision_workspace(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designpro_atlas_revision_workspace(uuid,uuid) TO authenticated,service_role;
