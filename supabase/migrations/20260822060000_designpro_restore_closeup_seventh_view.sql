-- Restore the locked DesignProAI seven-view source contract.
--
-- `_shared/view-angles-os.ts` has always defined the seventh proof as Close-Up.
-- A later handoff migration substituted a whole-vehicle hero view to satisfy a
-- downstream role. That substitution changed the product and is now removed:
-- new generations use close-up/closeup as their own immutable identity.
-- Existing hero3d revisions remain readable and handoff-eligible so this
-- forward migration does not strand already-paid or retryable work.

CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_view_plan()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('sourceViewType','side','consumerRole','driver'),
    pg_catalog.jsonb_build_object('sourceViewType','passenger-side','consumerRole','passenger'),
    pg_catalog.jsonb_build_object('sourceViewType','hood_detail','consumerRole','hood'),
    pg_catalog.jsonb_build_object('sourceViewType','front','consumerRole','front'),
    pg_catalog.jsonb_build_object('sourceViewType','rear','consumerRole','rear'),
    pg_catalog.jsonb_build_object('sourceViewType','close-up','consumerRole','closeup'),
    pg_catalog.jsonb_build_object('sourceViewType','roof','consumerRole','roof')
  )
$fn$;

REVOKE ALL ON FUNCTION designpro_private.calls_1_7_view_plan()
  FROM PUBLIC,anon,authenticated;

-- Active requests must match the restored plan. Historical completed requests
-- carrying the former hero3d slot remain eligible for their already-defined
-- handoff; no close-up is ever relabelled as hero3d and no bytes are rewritten.
CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_handoff_state(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $fn$
DECLARE
  v_expected text[];
  v_legacy text[]:=ARRAY[
    'driver','front','hero3d','hood','passenger','rear','roof'
  ]::text[];
  v_actual text[];
  v_distinct integer;
  v_count integer;
BEGIN
  SELECT pg_catalog.array_agg(
    item->>'consumerRole' ORDER BY item->>'consumerRole'
  ) INTO v_expected
  FROM pg_catalog.jsonb_array_elements(
    designpro_private.calls_1_7_view_plan()
  ) item;

  SELECT pg_catalog.array_agg(consumer_role ORDER BY consumer_role),
         pg_catalog.count(DISTINCT content_hash),pg_catalog.count(*)
  INTO v_actual,v_distinct,v_count
  FROM public.designpro_generation_views
  WHERE request_id=p_request_id AND superseded_at IS NULL;

  IF v_count IS NULL OR v_count<>7 THEN
    RETURN pg_catalog.jsonb_build_object(
      'handoffReady',false,
      'handoffBlocker','seven_generation_views_required'
    );
  END IF;
  IF v_distinct<>7 THEN
    RETURN pg_catalog.jsonb_build_object(
      'handoffReady',false,
      'handoffBlocker','generation_views_must_be_byte_distinct'
    );
  END IF;
  IF v_actual IS DISTINCT FROM v_expected
     AND v_actual IS DISTINCT FROM v_legacy THEN
    RETURN pg_catalog.jsonb_build_object(
      'handoffReady',false,
      'handoffBlocker','generation_view_roles_do_not_match_plan'
    );
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'handoffReady',true,'handoffBlocker',NULL
  );
END
$fn$;

REVOKE ALL ON FUNCTION
  designpro_private.calls_1_7_handoff_state(uuid)
  FROM PUBLIC,anon,authenticated;

-- A revision contains the same six production surfaces plus exactly one
-- seventh proof identity: Close-Up for new work, or hero3d for immutable
-- historical work. Keep every other delivery/source invariant unchanged.
ALTER TABLE public.designpro_revision_sources
  DROP CONSTRAINT IF EXISTS designpro_revision_snapshot_contract;
ALTER TABLE public.designpro_revision_sources
  ADD CONSTRAINT designpro_revision_snapshot_contract CHECK (
    snapshot->>'contractVersion'='designpro.revision-snapshot.v1'
    AND snapshot ?& ARRAY['generationId','designId','visualizationId']
    AND snapshot->>'generationId' IS NOT DISTINCT FROM generation_id::text
    AND snapshot->>'designId' IS NOT DISTINCT FROM 'DID-'||pg_catalog.upper(
      pg_catalog.substr(pg_catalog.replace(generation_id::text,'-',''),1,8)
    )
    AND snapshot->>'visualizationId'=visualization_id::text
    AND pg_catalog.jsonb_typeof(snapshot->'renderAssets')='object'
    AND snapshot->'renderAssets' ?&
      ARRAY['driver','passenger','hood','roof','front','rear']
    AND ((snapshot->'renderAssets' ? 'closeup') <>
         (snapshot->'renderAssets' ? 'hero3d'))
    AND NOT snapshot ? 'renderUrls'
    AND NULLIF(pg_catalog.btrim(snapshot#>>'{vehicle,year}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(snapshot#>>'{vehicle,make}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(snapshot#>>'{vehicle,model}'),'') IS NOT NULL
    AND NULLIF(pg_catalog.btrim(snapshot#>>'{vehicle,type}'),'') IS NOT NULL
    AND pg_catalog.jsonb_typeof(snapshot->'surfaceOptions')='object'
    AND snapshot ? 'finish'
    AND snapshot ? 'bodyText'
    AND pg_catalog.jsonb_typeof(snapshot->'change')='object'
    AND pg_catalog.jsonb_typeof(snapshot->'expectedLogoInventory')='array'
    AND pg_catalog.jsonb_typeof(snapshot->'logoInventoryAttestation')='object'
    AND snapshot#>>'{logoInventoryAttestation,mode}' IN ('none','listed')
    AND COALESCE(
      (snapshot#>>'{logoInventoryAttestation,attested}')::boolean,false
    )
    AND (
      (
        NOT snapshot ? 'fulfillment'
        AND snapshot ?& ARRAY['orderNumber','delivery']
        AND NULLIF(snapshot->>'orderNumber','') IS NOT NULL
        AND snapshot->>'orderNumber' IS NOT DISTINCT FROM
          pg_catalog.btrim(snapshot->>'orderNumber')
        AND snapshot->>'orderNumber' ~
          '^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$'
        AND pg_catalog.jsonb_typeof(snapshot->'delivery')='object'
        AND snapshot#>>'{delivery,contractVersion}'=
          'designpro.wrapbox-recipient.v1'
        AND snapshot#>>'{delivery,customerId}' ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND snapshot#>>'{delivery,customerEmail}'=
          pg_catalog.lower(pg_catalog.btrim(
            snapshot#>>'{delivery,customerEmail}'
          ))
        AND snapshot#>>'{delivery,recipientIdentityHash}' ~
          '^[0-9a-f]{64}$'
        AND snapshot#>>'{delivery,orderNumber}' IS NOT DISTINCT FROM
          snapshot->>'orderNumber'
        AND NULLIF(pg_catalog.btrim(
          snapshot#>>'{delivery,designName}'
        ),'') IS NOT NULL
      )
      OR
      (
        snapshot->>'sourceInputContract'=
          'designpro.calls-1-7-input.v2'
        AND NULLIF(pg_catalog.btrim(snapshot->>'designName'),'') IS NOT NULL
        AND pg_catalog.length(snapshot->>'designName')<=240
        AND NOT (snapshot ?| ARRAY['orderNumber','delivery'])
        AND pg_catalog.jsonb_typeof(snapshot->'fulfillment')='object'
        AND (snapshot->'fulfillment') ?&
          ARRAY['contractVersion','state']
        AND (snapshot->'fulfillment')-
          ARRAY['contractVersion','state']='{}'::jsonb
        AND snapshot#>>'{fulfillment,contractVersion}'=
          'designpro.fulfillment-state.v1'
        AND snapshot#>>'{fulfillment,state}'='unbound'
      )
    )
    AND (
      NOT snapshot ? 'materialFingerprints'
      OR pg_catalog.jsonb_typeof(snapshot->'materialFingerprints') IN
        ('object','array')
    )
  );

-- The current handoff already includes historical hero3d. Its sole close-up
-- exclusion was the old substitution workaround. Remove exactly that one
-- statement from the installed function while preserving all later handoff,
-- fulfillment, replay and authorization fixes byte-for-byte.
DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_old text:='IF v_view.consumer_role=''closeup'' THEN CONTINUE; END IF;';
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.handoff_designpro_generation_to_production(uuid)'::regprocedure
  ) INTO v_definition;
  IF (
    pg_catalog.length(v_definition)-pg_catalog.length(
      pg_catalog.replace(v_definition,v_old,'')
    )
  )/pg_catalog.length(v_old)<>1 THEN
    RAISE EXCEPTION 'designpro_handoff_closeup_exclusion_not_unique';
  END IF;
  v_patched:=pg_catalog.replace(
    v_definition,v_old,
    '-- Close-Up is the seventh immutable proof and is carried unchanged.'
  );
  EXECUTE v_patched;
END
$migration$;

REVOKE ALL ON FUNCTION
  public.handoff_designpro_generation_to_production(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION
  public.handoff_designpro_generation_to_production(uuid)
  TO authenticated;
