begin;
select plan(33);

select set_config('request.jwt.claims','{"role":"service_role"}',true);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','10000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','operator@designproai.test','',now(),
   '{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','20000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','customer@designproai.test','',now(),
   '{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','21000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','unconfirmed@designproai.test','',null,
   '{}'::jsonb,'{}'::jsonb,now(),now())
on conflict(id) do nothing;

insert into public.designpro_qc_members(
  user_id,can_operate,can_preflight,can_final_qc,granted_at,grant_source
) values(
  '10000000-0000-4000-8000-000000000001',true,true,true,now(),'pgTAP'
) on conflict(user_id) do update set can_operate=true,can_preflight=true,
  can_final_qc=true;

create temporary table reconcile_binding as
select public.register_designpro_operator_wrapbox_recipient(
  '10000000-0000-4000-8000-000000000001',
  ' CUSTOMER@DesignProAI.Test ',
  'Acme Fleet Customer',
  repeat('a',64),
  'ORDER-2026-0042'
) payload;

create temporary table reconcile_binding_repeat as
select public.register_designpro_operator_wrapbox_recipient(
  '10000000-0000-4000-8000-000000000001',
  'customer@designproai.test',
  'Acme Fleet Customer',
  repeat('a',64),
  'ORDER-2026-0042'
) payload;

select ok(
  not has_function_privilege('authenticated',
    'public.register_designpro_wrapbox_recipient(text,text,text,text,uuid)','EXECUTE'),
  'private customer binding primitive is not browser callable'
);
select ok(
  not has_function_privilege('authenticated',
    'public.register_designpro_operator_wrapbox_recipient(uuid,text,text,text,text)',
    'EXECUTE'),
  'operator-mediated recipient registration is not a browser RPC'
);
select matches(
  (select payload->>'customerId' from reconcile_binding),
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  'service assigns the business customer UUID without browser input'
);
select is(
  (select payload->>'customerId' from reconcile_binding_repeat),
  (select payload->>'customerId' from reconcile_binding),
  'the same confirmed email and stable reference reuse one business customer UUID'
);
select is(
  (select count(*)::integer
   from designpro_private.business_customer_bindings),1,
  'the private business customer binding is append-only and not duplicated'
);
select throws_ok(
  $$select public.register_designpro_operator_wrapbox_recipient(
    '10000000-0000-4000-8000-000000000001',
    'unconfirmed@designproai.test','Unconfirmed Customer',repeat('b',64),
    'ORDER-2026-0043')$$,
  'P0001','confirmed_customer_auth_email_required',
  'an unconfirmed customer Auth email cannot receive a delivery binding'
);
select is(
  (select payload->>'customerEmail' from reconcile_binding),
  'customer@designproai.test',
  'service binding derives the confirmed Auth email instead of trusting input'
);
select is(
  (select payload->>'orderNumber' from reconcile_binding),
  'ORDER-2026-0042',
  'service binding freezes the business Order # with the recipient identity'
);

select is(
  (select count(*)::integer from designpro_private.heavy_stage_leases),1,
  'there is exactly one database heavy-work lease slot'
);

insert into public.designpro_workflow_runs(
  id,workflow_type,owner_id,tenant_key,idempotency_key,status,revision_id,
  revision_snapshot_hash,entice_pack_id,dimension_manifest_id,
  source_contract_hash,manifest_hash,artifact_set_hash,created_at
) values
  ('40000000-0000-4000-8000-000000000004','designpro.production_pack',
   '10000000-0000-4000-8000-000000000001','user_10000000-0000-4000-8000-000000000001',
   'heavy-one','queued','50000000-0000-4000-8000-000000000005',repeat('1',64),
   '60000000-0000-4000-8000-000000000006','70000000-0000-4000-8000-000000000007',
   repeat('2',64),repeat('3',64),repeat('4',64),now()-interval '2 seconds'),
  ('41000000-0000-4000-8000-000000000004','designpro.production_pack',
   '10000000-0000-4000-8000-000000000001','user_10000000-0000-4000-8000-000000000001',
   'heavy-two','queued','51000000-0000-4000-8000-000000000005',repeat('5',64),
   '61000000-0000-4000-8000-000000000006','71000000-0000-4000-8000-000000000007',
   repeat('6',64),repeat('7',64),repeat('8',64),now()-interval '1 second');

insert into public.designpro_workflow_stages(
  id,run_id,stage_key,sequence,status,idempotency_key,available_at,created_at
) values
  ('80000000-0000-4000-8000-000000000008','40000000-0000-4000-8000-000000000004',
   'output.build',0,'pending','heavy-one:output.build',now(),now()-interval '2 seconds'),
  ('81000000-0000-4000-8000-000000000008','41000000-0000-4000-8000-000000000004',
   'output.build',0,'pending','heavy-two:output.build',now(),now()-interval '1 second');

select is(
  (select count(*) from public.claim_designpro_stage('claimer-a',60)),1::bigint,
  'first claimant acquires one output.build stage'
);
select is(
  (select lease_owner from designpro_private.heavy_stage_leases
   where lease_key='production-heavy'),'claimer-a',
  'database singleton records the first claimant'
);
select ok(
  public.acquire_designpro_heavy_lease(
    '80000000-0000-4000-8000-000000000008',
    (select lease_token from public.designpro_workflow_stages
     where id='80000000-0000-4000-8000-000000000008'),
    'claimer-a',60
  ),
  'explicit heavy acquire is idempotent for the exact claimed stage and token'
);
select ok(
  NOT public.release_designpro_heavy_lease(
    '80000000-0000-4000-8000-000000000008',
    '99999999-9999-4999-8999-999999999999'
  ),
  'heavy release refuses a mismatched fencing token'
);
select ok(
  public.release_designpro_heavy_lease(
    '80000000-0000-4000-8000-000000000008',
    (select lease_token from public.designpro_workflow_stages
     where id='80000000-0000-4000-8000-000000000008')
  ),
  'exact release request is accepted while transition ownership remains in the database'
);
select is(
  (select stage_id from designpro_private.heavy_stage_leases
   where lease_key='production-heavy'),
  '80000000-0000-4000-8000-000000000008'::uuid,
  'release request cannot create a heartbeat gap before terminal stage transition'
);
select is(
  (select count(*) from public.claim_designpro_stage('claimer-b',60)),0::bigint,
  'second claimant cannot race into another output.build stage'
);
select ok(
  public.fail_designpro_stage(
    '80000000-0000-4000-8000-000000000008',
    (select lease_token from public.designpro_workflow_stages
     where id='80000000-0000-4000-8000-000000000008'),
    'test_terminal','test terminal release',false
  ),
  'terminal stage transition succeeds with the exact lease token'
);
select is(
  (select stage_id from designpro_private.heavy_stage_leases
   where lease_key='production-heavy'),null::uuid,
  'terminal stage transition releases the singleton'
);
select is(
  (select count(*) from public.claim_designpro_stage('claimer-b',60)),1::bigint,
  'waiting output.build can claim after release'
);
select is(
  (select lease_owner from designpro_private.heavy_stage_leases
   where lease_key='production-heavy'),'claimer-b',
  'released singleton is owned by the next claimant'
);

update public.designpro_workflow_stages
set lease_expires_at=clock_timestamp()-interval '1 second'
where id='81000000-0000-4000-8000-000000000008';
select is(
  (select count(*) from public.claim_designpro_stage('claimer-c',60)),1::bigint,
  'expired output.build lease is reclaimable'
);
select is(
  (select lease_owner from designpro_private.heavy_stage_leases
   where lease_key='production-heavy'),'claimer-c',
  'expired singleton is atomically rebound to the reclaimer'
);

with roles(role_name,ordinal) as (
  values ('driver',1),('passenger',2),('hood',3),('roof',4),
         ('front',5),('rear',6),('hero3d',7)
), assets as (
  select jsonb_object_agg(role_name,jsonb_build_object(
    'storagePath','users/10000000-0000-4000-8000-000000000001/revisions/90000000-0000-4000-8000-000000000009/inputs/'
      ||role_name||'/'||repeat(ordinal::text,64)||'.png',
    'contentHash',repeat(ordinal::text,64),'byteSize',100+ordinal,
    'contentType','image/png'
  )) render_assets from roles
), snapshot as (
  select jsonb_build_object(
    'contractVersion','designpro.revision-snapshot.v1',
    'generationId','90000000-0000-4000-8000-000000000010',
    'designId','DID-90000000','orderNumber','ORDER-2026-0042',
    'visualizationId','90000000-0000-4000-8000-000000000010',
    'renderAssets',render_assets,
    'vehicle',jsonb_build_object('year','2026','make','Porsche','model','911','type','car'),
    'surfaceOptions','{}'::jsonb,'finish','standard','bodyText','LOCKED TEXT',
    'change','{}'::jsonb,'expectedLogoInventory','[]'::jsonb,
    'logoInventoryAttestation','{"mode":"none","attested":true}'::jsonb,
    'delivery',jsonb_build_object(
      'contractVersion','designpro.wrapbox-recipient.v1',
      'customerId',payload->>'customerId',
      'customerEmail',payload->>'customerEmail',
      'recipientIdentityHash',payload->>'recipientIdentityHash',
      'orderNumber',payload->>'orderNumber',
      'designName','Porsche production pack'
    )
  ) value
  from assets cross join reconcile_binding
)
insert into public.designpro_revision_sources(
  revision_id,owner_id,tenant_key,generation_id,visualization_id,
  expected_updated_at,snapshot,snapshot_hash,idempotency_key
)
select '90000000-0000-4000-8000-000000000009',
  '10000000-0000-4000-8000-000000000001',
  'user_10000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000010',
  '90000000-0000-4000-8000-000000000010',now(),value,
  encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex'),
  'delivery-binding-test'
from snapshot;

select is(
  (select snapshot#>>'{delivery,customerEmail}'
   from public.designpro_revision_sources
   where revision_id='90000000-0000-4000-8000-000000000009'),
  'customer@designproai.test',
  'immutable revision freezes only the registered confirmed email'
);
select is(
  (select count(*)::integer
   from jsonb_object_keys((select snapshot->'delivery'
     from public.designpro_revision_sources
     where revision_id='90000000-0000-4000-8000-000000000009'))),6,
  'immutable delivery snapshot contains exactly six bound fields'
);
select is(
  (select snapshot->>'designId' from public.designpro_revision_sources
   where revision_id='90000000-0000-4000-8000-000000000009'),
  'DID-90000000',
  'canonical DesignID is frozen from immutable generation_id'
);
select is(
  (select snapshot->>'orderNumber' from public.designpro_revision_sources
   where revision_id='90000000-0000-4000-8000-000000000009'),
  'ORDER-2026-0042',
  'business Order # is required and frozen independently of run identity'
);
select matches(
  pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure),
  'placementKey',
  'Call 10 completion is placement-aware for repeated logo identity/hash'
);
select matches(
  pg_get_functiondef('public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'::regprocedure),
  'textLockVerified',
  'PanelPro preflight requires the frozen text lock check'
);
select matches(
  pg_get_functiondef('public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'::regprocedure),
  'final_qc_evidence_or_business_identity_incomplete',
  'final QC receipt binds canonical DesignID and business Order #'
);
select ok(
  position('jsonb_array_length(COALESCE(p_artifacts,''[]''::jsonb)) IS DISTINCT FROM 2'
    in pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure)) > 0
  AND position('exact_seal_and_stamped_proof_identity_required'
    in pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure)) > 0,
  'one generic stamp artifact is rejected; exact seal plus stamped proof are required'
);
select ok(
  (select count(*)=2 from pg_attribute
   where attrelid='public.designpro_wrapbox_packs'::regclass
     and attname in ('design_id','order_number') and not attisdropped),
  'WrapBox carries both immutable business identities'
);
select ok(
  (select relrowsecurity from pg_class
   where oid='public.designpro_wrapbox_packs'::regclass),
  'WrapBox pack metadata remains protected by RLS'
);
select is(
  (select file_size_limit from storage.buckets where id='wrap-files'),
  50000000000::bigint,
  'private production bucket is bounded at 50 GB'
);

select * from finish();
rollback;
