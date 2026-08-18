-- Carry the Commercial intake's structured identity into the revision snapshot.
--
-- THE DEFECT. handoff_designpro_generation_to_production froze the whole job as
--   'bodyText', COALESCE(v_row.request_input->>'brief','')
-- a single prose string, and hard-coded
--   'logoInventoryAttestation', jsonb_build_object('mode','none','attested',true,...)
--   'expectedLogoInventory',    jsonb_build_array()
-- so every job -- including one where the customer typed a company name and
-- uploaded a logo -- was frozen as "no type, no logos". design-master-author
-- then coerced the non-array bodyText to [] without complaint, and the frozen
-- master reported textIdentities:[] / logoIdentities:[] as though the design
-- genuinely carried no identity. Six unbranded panels manufactured cleanly.
--
-- The intake was never the problem. DesignPanelProPremium already collects
-- mode/companyName/phone/website, the logo already arrives verified with a
-- storage path and content hash, and design-master.cjs already contracts for
-- both (spellingAuthority 'revision-snapshot', neverRasterizeIntoBase). The
-- structured values were dropped in transit.
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT.
--
-- It carries identity. companyName/phone/website travel as their own fields and
-- the uploaded logo travels as its own asset identity, so the master can render
-- the customer's exact strings as vector type and composite the customer's exact
-- bytes. Nothing here lets a model author spelling or redraw a logo.
--
-- It does NOT invent placement. bodyText[] entries and expectedLogoInventory[]
-- entries both require geometry -- a surfaceKey, an extent, a transform -- and
-- logoLayers() fails with author_logo_placement_missing without a matching
-- placement. The proven product had no fixed branding layout to copy: A.C.E.
-- composed each design and the product recovered the element positions from the
-- approved render afterwards (extract-logo-elements' percentage boxes ->
-- logo_pack). PR #3947 deleted the one fixed stack that existed
-- ("company name, then contact bar, then mascot") precisely because one
-- composition handed to every business produced one outcome. So placement is
-- recovered from the approved views in a later step, and writing coordinates
-- here would be inventing the layout that was deliberately removed.
--
-- bodyText therefore becomes a correctly-shaped EMPTY ARRAY rather than a
-- string: right type, no fabricated geometry. brandIdentity and brandAssets
-- carry the authoritative values forward for the placement step to bind.
--
-- The attestation stops lying. mode is 'customer-upload' when a logo was
-- supplied and 'none' when it genuinely was not, instead of asserting 'none'
-- unconditionally.

CREATE OR REPLACE FUNCTION public.handoff_designpro_generation_to_production(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','extensions'
AS $function$
DECLARE
  v_owner uuid:=auth.uid();
  v_row public.designpro_generation_requests%ROWTYPE;
  v_handoff jsonb;
  v_revision uuid;
  v_render jsonb:='{}'::jsonb;
  v_view record;
  v_extension text;
  v_recipient designpro_private.wrapbox_delivery_recipients%ROWTYPE;
  v_delivery jsonb;
  v_snapshot jsonb;
  v_saved jsonb;
  v_workflow jsonb;
  v_design_name text;
  v_idempotency text;
  v_company text;
  v_phone text;
  v_website text;
  v_mode text;
  v_logo jsonb;
  v_logo_mode text;
  v_brand jsonb;
BEGIN
  IF v_owner IS NULL OR COALESCE(auth.jwt()->>'is_anonymous','false')='true'
  THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_row FROM public.designpro_generation_requests
  WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_row.owner_id IS DISTINCT FROM v_owner
  THEN RAISE EXCEPTION 'generation_request_not_visible'; END IF;
  IF v_row.state<>'outputs_ready' THEN RAISE EXCEPTION 'generation_outputs_not_ready'; END IF;

  v_handoff:=designpro_private.calls_1_7_handoff_state(v_row.id);
  IF (v_handoff->>'handoffReady')<>'true'
  THEN RAISE EXCEPTION 'generation_handoff_blocked: %', COALESCE(v_handoff->>'handoffBlocker','unknown'); END IF;

  v_revision:=NULLIF(v_row.engine_receipt->>'handoffRevisionId','')::uuid;
  IF v_revision IS NULL THEN RAISE EXCEPTION 'generation_handoff_revision_missing'; END IF;

  IF EXISTS (SELECT 1 FROM public.designpro_revision_sources WHERE revision_id=v_revision) THEN
    RETURN pg_catalog.jsonb_build_object('revisionId',v_revision,
      'generationId',v_row.generation_id,'alreadyHandedOff',true);
  END IF;

  FOR v_view IN
    SELECT consumer_role, content_hash, byte_size, content_type
    FROM public.designpro_generation_views WHERE request_id=v_row.id
    ORDER BY consumer_role
  LOOP
    IF v_view.consumer_role='closeup' THEN CONTINUE; END IF;
    v_extension:=CASE v_view.content_type
      WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg'
      WHEN 'image/webp' THEN 'webp' ELSE NULL END;
    IF v_extension IS NULL THEN RAISE EXCEPTION 'generation_view_identity_invalid'; END IF;
    v_render:=v_render || pg_catalog.jsonb_build_object(
      v_view.consumer_role,
      pg_catalog.jsonb_build_object(
        'storagePath','users/'||v_owner::text||'/revisions/'||v_revision::text
          ||'/inputs/'||v_view.consumer_role||'/'||v_view.content_hash||'.'||v_extension,
        'contentHash',v_view.content_hash,
        'byteSize',v_view.byte_size,
        'contentType',v_view.content_type
      )
    );
  END LOOP;

  SELECT * INTO v_recipient FROM designpro_private.wrapbox_delivery_recipients
  WHERE recipient_identity_hash=v_row.request_input#>>'{delivery,recipientIdentityHash}'
    AND order_number=v_row.request_input->>'orderNumber';
  IF NOT FOUND THEN RAISE EXCEPTION 'wrapbox_recipient_binding_missing'; END IF;

  v_design_name:=NULLIF(pg_catalog.btrim(COALESCE(v_row.request_input->>'designName','')),'');
  IF v_design_name IS NULL THEN v_design_name:=v_row.request_input->>'orderNumber'; END IF;

  -- The customer's own strings, exactly as typed. companyName falls back to
  -- businessName because the intake has carried the name under both spellings.
  v_company:=NULLIF(pg_catalog.btrim(COALESCE(
    v_row.request_input->>'companyName', v_row.request_input->>'businessName', '')),'');
  v_phone:=NULLIF(pg_catalog.btrim(COALESCE(v_row.request_input->>'phone','')),'');
  v_website:=NULLIF(pg_catalog.btrim(COALESCE(v_row.request_input->>'website','')),'');
  -- The intake's own rule: a company name means commercial, whatever the mode said.
  v_mode:=CASE
    WHEN v_row.request_input->>'mode' IN ('commercial','restyle') THEN v_row.request_input->>'mode'
    WHEN v_company IS NOT NULL THEN 'commercial'
    ELSE 'restyle' END;

  -- The uploaded logo, identity only. Rejected unless it carries a real storage
  -- path and a sha256, so a half-formed upload cannot be frozen as if verified.
  v_logo:=NULL;
  IF pg_catalog.jsonb_typeof(v_row.request_input->'logoAsset')='object' THEN
    IF NULLIF(pg_catalog.btrim(COALESCE(v_row.request_input#>>'{logoAsset,storagePath}','')),'') IS NULL
      OR COALESCE(v_row.request_input#>>'{logoAsset,contentHash}','') !~ '^[0-9a-f]{64}$'
    THEN RAISE EXCEPTION 'generation_logo_asset_invalid'; END IF;
    v_logo:=pg_catalog.jsonb_build_object(
      'storagePath',v_row.request_input#>>'{logoAsset,storagePath}',
      'contentHash',pg_catalog.lower(v_row.request_input#>>'{logoAsset,contentHash}'),
      'byteSize',(v_row.request_input#>>'{logoAsset,byteSize}')::bigint,
      'contentType',v_row.request_input#>>'{logoAsset,contentType}',
      'source','designpro-intake-upload');
  END IF;
  v_logo_mode:=CASE WHEN v_logo IS NULL THEN 'none' ELSE 'customer-upload' END;

  v_brand:=pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'contractVersion','designpro.brand-identity.v1',
    'mode',v_mode,
    'companyName',v_company,
    'phone',v_phone,
    'website',v_website,
    -- Stated so a later consumer cannot mistake these for creative direction.
    'authority','revision-snapshot'));

  v_delivery:=pg_catalog.jsonb_build_object(
    'contractVersion','designpro.wrapbox-recipient.v1',
    'customerId',v_recipient.customer_id,
    'customerEmail',v_recipient.customer_email,
    'recipientIdentityHash',v_recipient.recipient_identity_hash,
    'orderNumber',v_recipient.order_number,
    'designName',v_design_name
  );

  v_snapshot:=pg_catalog.jsonb_build_object(
    'contractVersion','designpro.revision-snapshot.v1',
    'revisionId',v_revision,
    'generationId',v_row.generation_id,
    'visualizationId',v_row.id,
    'designId','DID-'||pg_catalog.upper(pg_catalog.left(
      pg_catalog.replace(v_row.generation_id::text,'-',''),8)),
    'vehicle',v_row.request_input->'vehicle',
    'surfaceOptions',pg_catalog.jsonb_build_object('required',
      pg_catalog.jsonb_build_array('driver','passenger','hood','roof','front','rear')),
    'finish',COALESCE(v_row.request_input->>'finish','standard'),
    -- An ARRAY, which is what design-master-author contracts for. Empty until
    -- the placement step recovers where the approved design put the branding;
    -- the strings themselves live in brandIdentity so nothing has to be parsed
    -- back out of prose.
    'bodyText',pg_catalog.jsonb_build_array(),
    'brandIdentity',v_brand,
    -- The verified upload, held unplaced. It becomes an
    -- expectedLogoInventory[] entry once a surface and placement exist for it;
    -- an inventory entry without placement fails the author by design.
    'brandAssets',pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object('logo',v_logo)),
    'brief',COALESCE(v_row.request_input->>'brief',''),
    'orderNumber',v_recipient.order_number,
    'logoInventoryAttestation',pg_catalog.jsonb_build_object(
      'mode',v_logo_mode,'attested',true,
      'source',CASE WHEN v_logo IS NULL THEN 'calls-1-7-generated'
                    ELSE 'designpro-intake-upload' END,
      'placementPending',v_logo IS NOT NULL),
    'expectedLogoInventory',pg_catalog.jsonb_build_array(),
    'delivery',v_delivery,
    'renderAssets',v_render,
    'change',pg_catalog.jsonb_build_object(
      'view','all','instruction','Generated by Calls 1-7',
      'attachmentIds',pg_catalog.jsonb_build_array())
  );

  v_idempotency:='calls17-handoff:'||v_row.id::text;

  v_saved:=public.save_designpro_revision_source(
    v_revision, v_row.generation_id, v_row.id,
    pg_catalog.clock_timestamp(), v_snapshot, NULL, v_idempotency
  );

  v_workflow:=public.create_designpro_entice_workflow(
    v_revision, v_idempotency,
    pg_catalog.jsonb_build_object('trigger','revision.saved',
      'revisionSnapshotHash',v_saved->>'snapshotHash')
  );

  RETURN pg_catalog.jsonb_build_object(
    'revisionId',v_revision,
    'generationId',v_row.generation_id,
    'workflowRunId',v_workflow->>'workflowRunId',
    'alreadyHandedOff',false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.handoff_designpro_generation_to_production(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handoff_designpro_generation_to_production(uuid) TO authenticated;
