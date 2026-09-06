-- WrapBox publication must resolve the same append-only fulfillment binding
-- already required by final QC, stamping, and the production runtime.
--
-- PATCH THE LIVE DEFINITION; DO NOT RESTATE IT. The closure function owns the
-- complete durable-delivery ledger and notification contract. These guarded,
-- single-occurrence replacements change only where delivery identity is read.

DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_declare_anchor constant text := E'  v_delivery jsonb;\n';
  v_declare_replacement constant text := E'  v_delivery jsonb;\n  v_fulfillment jsonb;\n';
  v_delivery_anchor constant text := $old$  v_delivery := v_source.snapshot->'delivery';
  IF pg_catalog.jsonb_typeof(v_delivery) IS DISTINCT FROM 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_delivery)) <> 6
    OR v_delivery->>'contractVersion' IS DISTINCT FROM
      'designpro.wrapbox-recipient.v1'
    OR NOT v_delivery ?& ARRAY[
      'contractVersion', 'customerId', 'customerEmail',
      'recipientIdentityHash', 'orderNumber', 'designName'
    ]
  THEN
    RAISE EXCEPTION
      'delivery_recipient_snapshot_required: delivery.contractVersion, delivery.customerId, delivery.customerEmail, delivery.recipientIdentityHash, delivery.orderNumber, delivery.designName';
  END IF;
$old$;
  v_delivery_replacement constant text := $new$  v_fulfillment := designpro_private.revision_fulfillment(v_run.revision_id);
  IF v_fulfillment IS NULL
    OR v_fulfillment->>'contractVersion' IS DISTINCT FROM
      'designpro.fulfillment-binding.v1'
    OR v_fulfillment->>'revisionId' IS DISTINCT FROM v_run.revision_id::text
    OR COALESCE(v_fulfillment->>'bindingHash','') !~ '^[0-9a-f]{64}$'
    OR v_fulfillment->>'orderNumber' IS DISTINCT FROM
      v_fulfillment#>>'{delivery,orderNumber}'
  THEN RAISE EXCEPTION 'immutable_revision_fulfillment_mismatch'; END IF;

  -- Historical order-first revisions froze delivery into the snapshot.
  -- Design-first revisions froze an unbound marker and must use the exact
  -- append-only fulfillment attached to this production run.
  IF pg_catalog.jsonb_typeof(v_source.snapshot->'delivery')='object'
    AND NULLIF(v_source.snapshot->>'orderNumber','') IS NOT NULL
  THEN
    v_delivery := v_source.snapshot->'delivery';
    v_order_number := v_source.snapshot->>'orderNumber';
    IF v_fulfillment->>'orderNumber' IS DISTINCT FROM v_order_number
      OR (v_run.input ? 'fulfillment'
        AND v_run.input->'fulfillment' IS DISTINCT FROM v_fulfillment)
    THEN RAISE EXCEPTION 'immutable_revision_fulfillment_mismatch'; END IF;
  ELSE
    IF v_source.snapshot->>'sourceInputContract' NOT IN (
        'designpro.calls-1-7-input.v2',
        'designpro.calls-1-7-input.v3'
      )
      OR v_source.snapshot#>>'{fulfillment,contractVersion}' IS DISTINCT FROM
        'designpro.fulfillment-state.v1'
      OR v_source.snapshot#>>'{fulfillment,state}' IS DISTINCT FROM 'unbound'
      OR v_source.snapshot ?| ARRAY['orderNumber','delivery']
      OR v_run.input->'fulfillment' IS DISTINCT FROM v_fulfillment
    THEN RAISE EXCEPTION 'immutable_revision_fulfillment_mismatch'; END IF;
    v_delivery := v_fulfillment->'delivery';
    v_order_number := v_fulfillment->>'orderNumber';
  END IF;

  IF pg_catalog.jsonb_typeof(v_delivery) IS DISTINCT FROM 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_delivery)) <> 6
    OR v_delivery->>'contractVersion' IS DISTINCT FROM
      'designpro.wrapbox-recipient.v1'
    OR NOT v_delivery ?& ARRAY[
      'contractVersion', 'customerId', 'customerEmail',
      'recipientIdentityHash', 'orderNumber', 'designName'
    ]
  THEN
    RAISE EXCEPTION
      'delivery_recipient_snapshot_required: delivery.contractVersion, delivery.customerId, delivery.customerEmail, delivery.recipientIdentityHash, delivery.orderNumber, delivery.designName';
  END IF;
$new$;
  v_order_anchor constant text := $old$  v_design_id := v_source.snapshot->>'designId';
  v_order_number := v_source.snapshot->>'orderNumber';
$old$;
  v_order_replacement constant text := $new$  v_design_id := v_source.snapshot->>'designId';
$new$;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.commit_designpro_wrapbox_pack(uuid,text,bigint,text,bigint,jsonb)'
    )
  );
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'commit_designpro_wrapbox_pack_not_found';
  END IF;

  -- Refuse to modify an unknown closure contract.
  IF pg_catalog.strpos(v_definition,'source_entice_run_identity_mismatch')=0
    OR pg_catalog.strpos(v_definition,'observed_delivery_bytes_do_not_match_ledger')=0
    OR pg_catalog.strpos(v_definition,'manifest_logo_inventory_does_not_match_ledger')=0
    OR pg_catalog.strpos(v_definition,'wrapbox_notification_idempotency_identity_conflict')=0
    OR pg_catalog.strpos(v_definition,'revision_fulfillment(v_run.revision_id)')>0
  THEN RAISE EXCEPTION 'commit_designpro_wrapbox_pack_unexpected_live_contract'; END IF;

  FOREACH v_occurrences IN ARRAY ARRAY[
    (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_declare_anchor,'')))/pg_catalog.length(v_declare_anchor),
    (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_delivery_anchor,'')))/pg_catalog.length(v_delivery_anchor),
    (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_order_anchor,'')))/pg_catalog.length(v_order_anchor)
  ] LOOP
    IF v_occurrences IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'wrapbox_late_fulfillment_anchor_count_%, expected_1',v_occurrences;
    END IF;
  END LOOP;

  v_patched := pg_catalog.replace(v_definition,v_declare_anchor,v_declare_replacement);
  v_patched := pg_catalog.replace(v_patched,v_delivery_anchor,v_delivery_replacement);
  v_patched := pg_catalog.replace(v_patched,v_order_anchor,v_order_replacement);
  EXECUTE v_patched;
END
$migration$;

ALTER FUNCTION public.commit_designpro_wrapbox_pack(
  uuid,text,bigint,text,bigint,jsonb
) SET search_path TO 'pg_catalog','public','extensions';

REVOKE ALL ON FUNCTION public.commit_designpro_wrapbox_pack(
  uuid,text,bigint,text,bigint,jsonb
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_designpro_wrapbox_pack(
  uuid,text,bigint,text,bigint,jsonb
) TO service_role;
