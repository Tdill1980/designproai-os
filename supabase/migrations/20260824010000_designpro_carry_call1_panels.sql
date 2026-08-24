-- Carry the Call-1 panels across the generation/manufacturing seam.
--
-- The panels RevisionStudio entices the buyer with, and the panels PanelPro
-- Studio is served, are the six A.T.L.A.S. cut from the canonical master at
-- Call 1 -- each already sized to its own side with the five-inch bleed in the
-- layout. Downstream must consume those exact bytes; re-deriving them would show
-- the board a different set than the customer was shown, which is the failure
-- this whole chain exists to avoid.
--
-- Manufacturing may not reach back into designpro_flat_atlas_revisions to find
-- them. That boundary is deliberate and enforced by
-- source-tests/schema/standalone-claimant-contract.test.mjs, which pins the
-- exact tables the claimant may read; generation owns producing the approved
-- per-side artifacts and manufacturing consumes them through the agreed
-- interface. So the interface carries them: the immutable revision snapshot,
-- which manufacturing already reads through designpro_revision_sources.
--
-- The snapshot gains one key, callOnePanels. It is an empty array for a run with
-- no atlas, which is the honest answer rather than a fabricated one, and the
-- existing renderAssets contract and its validation trigger are untouched.
--
-- The body below is the 20260821200000 definition with that one field added and
-- the read that populates it -- plus the Close-Up correction that 20260822060000
-- had applied as a TEXTUAL PATCH to the installed function rather than as a new
-- definition. A wholesale CREATE OR REPLACE from the 20260821200000 source silently
-- reverts that patch, which drops the seventh proof identity and makes the
-- revision trigger raise seven_render_asset_identities_required on every handoff.
-- The guard at the end of this file is what makes that failure loud instead.

CREATE OR REPLACE FUNCTION public.handoff_designpro_generation_to_production(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $fn$
DECLARE
  v_owner uuid:=auth.uid();
  v_row public.designpro_generation_requests%ROWTYPE;
  v_handoff jsonb;
  v_revision uuid;
  v_render jsonb:='{}'::jsonb;
  v_call1_panels jsonb:='[]'::jsonb;
  v_view record;
  v_extension text;
  v_recipient designpro_private.wrapbox_delivery_recipients%ROWTYPE;
  v_delivery jsonb;
  v_snapshot jsonb;
  v_saved jsonb;
  v_workflow jsonb;
  v_existing public.designpro_revision_sources%ROWTYPE;
  v_design_name text;
  v_idempotency text;
  v_company text;
  v_phone text;
  v_website text;
  v_mode text;
  v_logo jsonb;
  v_logo_mode text;
  v_brand jsonb;
  v_input_contract text;
  v_source_time timestamptz;
  v_already_handed_off boolean:=false;
BEGIN
  IF v_owner IS NULL
    OR COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'authenticated'
    OR COALESCE(auth.jwt()->>'is_anonymous','false')='true'
  THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_row
  FROM public.designpro_generation_requests
  WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_row.owner_id IS DISTINCT FROM v_owner
  THEN RAISE EXCEPTION 'generation_request_not_visible'; END IF;
  IF v_row.state<>'outputs_ready'
  THEN RAISE EXCEPTION 'generation_outputs_not_ready'; END IF;

  v_input_contract:=v_row.request_input->>'contractVersion';
  IF v_input_contract NOT IN (
    'designpro.calls-1-7-input.v1','designpro.calls-1-7-input.v2'
  ) THEN
    -- This is the database backstop behind the gateway's explicit flat-first
    -- gate. v3/A.T.L.A.S. never enters the normal production handoff.
    RAISE EXCEPTION 'generation_contract_not_production_eligible';
  END IF;

  v_handoff:=designpro_private.calls_1_7_handoff_state(v_row.id);
  IF (v_handoff->>'handoffReady')<>'true' THEN
    RAISE EXCEPTION 'generation_handoff_blocked: %',
      COALESCE(v_handoff->>'handoffBlocker','unknown');
  END IF;
  v_revision:=NULLIF(v_row.engine_receipt->>'handoffRevisionId','')::uuid;
  IF v_revision IS NULL
  THEN RAISE EXCEPTION 'generation_handoff_revision_missing'; END IF;

  FOR v_view IN
    SELECT consumer_role,content_hash,byte_size,content_type
    FROM public.designpro_generation_views
    WHERE request_id=v_row.id AND superseded_at IS NULL
    ORDER BY consumer_role
  LOOP
    -- Close-Up is the seventh immutable proof and is carried unchanged.
    v_extension:=CASE v_view.content_type
      WHEN 'image/png' THEN 'png'
      WHEN 'image/jpeg' THEN 'jpg'
      WHEN 'image/webp' THEN 'webp'
      ELSE NULL END;
    IF v_extension IS NULL
    THEN RAISE EXCEPTION 'generation_view_identity_invalid'; END IF;
    v_render:=v_render||pg_catalog.jsonb_build_object(
      v_view.consumer_role,
      pg_catalog.jsonb_build_object(
        'storagePath','users/'||v_owner::text||'/revisions/'
          ||v_revision::text||'/inputs/'||v_view.consumer_role||'/'
          ||v_view.content_hash||'.'||v_extension,
        'contentHash',v_view.content_hash,
        'byteSize',v_view.byte_size,
        'contentType',v_view.content_type
      )
    );
  END LOOP;

  v_design_name:=NULLIF(pg_catalog.btrim(COALESCE(
    v_row.request_input->>'designName',''
  )),'');
  v_company:=NULLIF(pg_catalog.btrim(COALESCE(
    v_row.request_input->>'companyName',
    v_row.request_input->>'businessName',''
  )),'');
  v_phone:=NULLIF(pg_catalog.btrim(COALESCE(
    v_row.request_input->>'phone',''
  )),'');
  v_website:=NULLIF(pg_catalog.btrim(COALESCE(
    v_row.request_input->>'website',''
  )),'');
  v_mode:=CASE
    WHEN v_row.request_input->>'mode' IN ('commercial','restyle')
      THEN v_row.request_input->>'mode'
    WHEN v_company IS NOT NULL THEN 'commercial'
    ELSE 'restyle' END;

  v_logo:=NULL;
  IF pg_catalog.jsonb_typeof(v_row.request_input->'logoAsset')='object' THEN
    IF NULLIF(pg_catalog.btrim(COALESCE(
      v_row.request_input#>>'{logoAsset,storagePath}',''
    )),'') IS NULL
      OR COALESCE(v_row.request_input#>>'{logoAsset,contentHash}','')
        !~ '^[0-9a-f]{64}$'
    THEN RAISE EXCEPTION 'generation_logo_asset_invalid'; END IF;
    v_logo:=pg_catalog.jsonb_build_object(
      'storagePath',v_row.request_input#>>'{logoAsset,storagePath}',
      'contentHash',pg_catalog.lower(
        v_row.request_input#>>'{logoAsset,contentHash}'
      ),
      'byteSize',(v_row.request_input#>>'{logoAsset,byteSize}')::bigint,
      'contentType',v_row.request_input#>>'{logoAsset,contentType}',
      'source','designpro-intake-upload'
    );
  END IF;
  -- Call 10 requires a frozen, surface-bound placement inventory. Intake has
  -- only the uploaded bytes, not honest placement evidence, so advancing that
  -- shape would park later at Call 10 after pretending it was runnable.
  IF v_logo IS NOT NULL THEN
    RAISE EXCEPTION 'generation_logo_placement_manifest_required';
  END IF;
  v_logo_mode:='none';
  v_brand:=pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'contractVersion','designpro.brand-identity.v1',
    'mode',v_mode,
    'companyName',v_company,
    'phone',v_phone,
    'website',v_website,
    'authority','revision-snapshot'
  ));

  SELECT COALESCE(r.metadata->'callOnePanels','[]'::jsonb) INTO v_call1_panels
  FROM public.designpro_flat_atlas_revisions r
  WHERE r.generation_id=v_row.generation_id
  ORDER BY r.revision_sequence DESC LIMIT 1;
  IF v_call1_panels IS NULL OR pg_catalog.jsonb_typeof(v_call1_panels)<>'array'
  THEN v_call1_panels:='[]'::jsonb; END IF;

  IF v_input_contract='designpro.calls-1-7-input.v1' THEN
    SELECT * INTO v_recipient
    FROM designpro_private.wrapbox_delivery_recipients
    WHERE recipient_identity_hash=
        v_row.request_input#>>'{delivery,recipientIdentityHash}'
      AND order_number=v_row.request_input->>'orderNumber';
    IF NOT FOUND
    THEN RAISE EXCEPTION 'wrapbox_recipient_binding_missing'; END IF;
    IF v_design_name IS NULL THEN
      v_design_name:=v_row.request_input->>'orderNumber';
    END IF;
    v_delivery:=pg_catalog.jsonb_build_object(
      'contractVersion','designpro.wrapbox-recipient.v1',
      'customerId',v_recipient.customer_id,
      'customerEmail',v_recipient.customer_email,
      'recipientIdentityHash',v_recipient.recipient_identity_hash,
      'orderNumber',v_recipient.order_number,
      'designName',v_design_name
    );
    -- Preserve the exact bound-v1 snapshot shape for existing rows and replay.
    v_snapshot:=pg_catalog.jsonb_build_object(
      'contractVersion','designpro.revision-snapshot.v1',
      'revisionId',v_revision,
      'generationId',v_row.generation_id,
      'visualizationId',v_row.id,
      'designId','DID-'||pg_catalog.upper(pg_catalog.left(
        pg_catalog.replace(v_row.generation_id::text,'-',''),8
      )),
      'vehicle',v_row.request_input->'vehicle',
      'surfaceOptions',pg_catalog.jsonb_build_object(
        'required',pg_catalog.jsonb_build_array(
          'driver','passenger','hood','roof','front','rear'
        )
      ),
      'finish',COALESCE(v_row.request_input->>'finish','standard'),
      'bodyText',pg_catalog.jsonb_build_array(),
      'brandIdentity',v_brand,
      'brandAssets',pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object('logo',v_logo)
      ),
      'brief',COALESCE(v_row.request_input->>'brief',''),
      'orderNumber',v_recipient.order_number,
      'logoInventoryAttestation',pg_catalog.jsonb_build_object(
        'mode',v_logo_mode,'attested',true,
        'source',CASE WHEN v_logo IS NULL THEN 'calls-1-7-generated'
          ELSE 'designpro-intake-upload' END,
        'placementPending',v_logo IS NOT NULL
      ),
      'expectedLogoInventory',pg_catalog.jsonb_build_array(),
      'delivery',v_delivery,
      'renderAssets',v_render,
      'callOnePanels',v_call1_panels,
      'change',pg_catalog.jsonb_build_object(
        'view','all','instruction','Generated by Calls 1-7',
        'attachmentIds',pg_catalog.jsonb_build_array()
      )
    );
  ELSE
    IF v_design_name IS NULL
    THEN RAISE EXCEPTION 'generation_design_name_missing'; END IF;
    v_snapshot:=pg_catalog.jsonb_build_object(
      'contractVersion','designpro.revision-snapshot.v1',
      'sourceInputContract','designpro.calls-1-7-input.v2',
      'revisionId',v_revision,
      'generationId',v_row.generation_id,
      'visualizationId',v_row.id,
      'designId','DID-'||pg_catalog.upper(pg_catalog.left(
        pg_catalog.replace(v_row.generation_id::text,'-',''),8
      )),
      'designName',v_design_name,
      'vehicle',v_row.request_input->'vehicle',
      'surfaceOptions',pg_catalog.jsonb_build_object(
        'required',pg_catalog.jsonb_build_array(
          'driver','passenger','hood','roof','front','rear'
        )
      ),
      'finish',COALESCE(v_row.request_input->>'finish','standard'),
      'bodyText',pg_catalog.jsonb_build_array(),
      'brandIdentity',v_brand,
      'brandAssets',pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object('logo',v_logo)
      ),
      'brief',COALESCE(v_row.request_input->>'brief',''),
      'logoInventoryAttestation',pg_catalog.jsonb_build_object(
        'mode',v_logo_mode,'attested',true,
        'source',CASE WHEN v_logo IS NULL THEN 'calls-1-7-generated'
          ELSE 'designpro-intake-upload' END,
        'placementPending',v_logo IS NOT NULL
      ),
      'expectedLogoInventory',pg_catalog.jsonb_build_array(),
      'fulfillment',pg_catalog.jsonb_build_object(
        'contractVersion','designpro.fulfillment-state.v1',
        'state','unbound'
      ),
      'renderAssets',v_render,
      'callOnePanels',v_call1_panels,
      'change',pg_catalog.jsonb_build_object(
        'view','all','instruction','Generated by Calls 1-7',
        'attachmentIds',pg_catalog.jsonb_build_array()
      )
    );
  END IF;

  -- Carry the six panels A.T.L.A.S. cut at Call 1 across the handoff.
  --
  -- The panels RevisionStudio entices the buyer with and the panels PanelPro
  -- Studio is served are the ones cut from the canonical master at Call 1, each
  -- already sized to its own side with the five-inch bleed in the layout.
  -- Manufacturing may not reach back into the generation tables to find them --
  -- that boundary is the point of the seam -- so the immutable revision snapshot
  -- carries them, which is the interface manufacturing is already allowed to
  -- read. An empty array is correct and expected for a run with no atlas.
  v_idempotency:='calls17-handoff:'||v_row.id::text;
  v_source_time:=COALESCE(
    v_row.completed_at,v_row.updated_at,v_row.created_at
  );

  SELECT * INTO v_existing
  FROM public.designpro_revision_sources
  WHERE revision_id=v_revision FOR UPDATE;
  v_already_handed_off:=FOUND;
  IF v_already_handed_off THEN
    IF v_existing.owner_id IS DISTINCT FROM v_owner
      OR v_existing.generation_id IS DISTINCT FROM v_row.generation_id
      OR v_existing.visualization_id IS DISTINCT FROM v_row.id
      OR v_existing.idempotency_key IS DISTINCT FROM v_idempotency
      OR v_existing.snapshot IS DISTINCT FROM v_snapshot
      OR v_existing.snapshot_hash IS DISTINCT FROM pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'
        ),'hex'
      )
    THEN RAISE EXCEPTION 'generation_handoff_identity_conflict'; END IF;
    v_saved:=pg_catalog.jsonb_build_object(
      'revisionId',v_existing.revision_id,
      'ownerId',v_existing.owner_id,
      'tenantKey',v_existing.tenant_key,
      'snapshotHash',v_existing.snapshot_hash,
      'created',false,
      'idempotent',true
    );
  ELSE
    IF v_input_contract='designpro.calls-1-7-input.v2' THEN
      -- Direct insertion is intentional: generic authenticated revision
      -- ingestion rejects unbound sources, while this SECURITY DEFINER RPC has
      -- already proved the owner, completed request, exact revision identity,
      -- handoff state and seven active views.
      INSERT INTO public.designpro_revision_sources(
        revision_id,owner_id,tenant_key,generation_id,visualization_id,
        expected_updated_at,snapshot,snapshot_hash,idempotency_key
      ) VALUES(
        v_revision,v_owner,'user_'||v_owner::text,v_row.generation_id,v_row.id,
        v_source_time,v_snapshot,pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'
        ),'hex'),v_idempotency
      ) RETURNING * INTO v_existing;
      v_saved:=pg_catalog.jsonb_build_object(
        'revisionId',v_existing.revision_id,
        'ownerId',v_existing.owner_id,
        'tenantKey',v_existing.tenant_key,
        'snapshotHash',v_existing.snapshot_hash,
        'created',true,
        'idempotent',false
      );
    ELSE
      v_saved:=public.save_designpro_revision_source(
        v_revision,v_row.generation_id,v_row.id,v_source_time,
        v_snapshot,NULL,v_idempotency
      );
    END IF;
  END IF;

  -- ALWAYS run the idempotent workflow creation. This repairs the precise
  -- crash window where the revision committed but the workflow did not.
  v_workflow:=public.create_designpro_entice_workflow(
    v_revision,v_idempotency,
    pg_catalog.jsonb_build_object(
      'trigger','revision.saved',
      'revisionSnapshotHash',v_saved->>'snapshotHash'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'revisionId',v_revision,
    'generationId',v_row.generation_id,
    'workflowRunId',v_workflow->>'workflowRunId',
    'alreadyHandedOff',v_already_handed_off
  );
END;
$fn$;

-- Any later wholesale redefinition of this function reverts every textual patch
-- applied to the installed body. Close-Up is the one that has already been lost
-- this way, so it is asserted here rather than discovered in a shadow run.
DO $migration$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.handoff_designpro_generation_to_production(uuid)'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.position(
    'v_view.consumer_role=''closeup'' THEN CONTINUE' IN v_definition
  )>0 THEN
    RAISE EXCEPTION 'designpro_handoff_drops_closeup_identity';
  END IF;
END
$migration$;

REVOKE ALL ON FUNCTION
  public.handoff_designpro_generation_to_production(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION
  public.handoff_designpro_generation_to_production(uuid)
  TO authenticated;
