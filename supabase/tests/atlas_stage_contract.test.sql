-- The stage machine's A.T.L.A.S. path, exercised rather than asserted about.
--
-- These call complete_designpro_stage for real, against real fixtures, because
-- the defect these cover was invisible to text assertions: the runtime and the
-- RPC each looked correct on their own and disagreed only when they met. Run
-- 9923b2de died at proof.build on verified_receipt_required, and nothing in
-- either half's source said so.

begin;
select plan(20);

select has_function(
  'designpro_private','workflow_run_is_atlas',
  ARRAY['uuid'],'the A.T.L.A.S. run predicate exists'
);
select ok(not has_function_privilege(
  'authenticated','designpro_private.workflow_run_is_atlas(uuid)','EXECUTE'
),'browsers cannot ask whether a run is A.T.L.A.S.');
select ok(not has_function_privilege(
  'anon','designpro_private.workflow_run_is_atlas(uuid)','EXECUTE'
),'anonymous callers cannot ask whether a run is A.T.L.A.S.');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values(
  '00000000-0000-0000-0000-000000000000',
  '41000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'atlas-stage@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()
) on conflict(id) do nothing;

select set_config('request.jwt.claims','{"role":"service_role"}',true);

-- One A.T.L.A.S. generation: request, accepted master, frozen snapshot.
insert into public.designpro_generation_requests(
  id,generation_id,owner_id,tenant_key,idempotency_key,request_input,
  input_hash,engine_contract,engine_contract_hash,state
) values(
  '42000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'user_41000000-0000-4000-8000-000000000001','atlas-stage-contract',
  jsonb_build_object(
    'contractVersion','designpro.calls-1-7-input.v3',
    'pipelineMode','flat-first-atlas-v1','brief','atlas stage contract'
  ),
  repeat('1',64),'{}'::jsonb,repeat('2',64),'outputs_ready'
);

insert into public.designpro_flat_atlas_revisions(
  id,request_id,generation_id,owner_id,tenant_key,revision_sequence,
  guide_storage_path,guide_content_hash,guide_byte_size,guide_content_type,
  manifest_storage_path,manifest_content_hash,manifest_byte_size,manifest_content_type,
  master_storage_path,master_content_hash,master_byte_size,master_content_type,
  projection_storage_path,projection_content_hash,projection_byte_size,projection_content_type,
  manifest,model,prompt_version,width_px,height_px,effective_ppi,metadata
) values(
  '44000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'user_41000000-0000-4000-8000-000000000001',1,
  'designpro/guide.png',repeat('a',64),10,'image/png',
  'designpro/manifest.json',repeat('b',64),10,'application/json',
  'designpro/master.png',repeat('c',64),10,'image/png',
  'designpro/projection.png',repeat('d',64),10,'image/png',
  '{}'::jsonb,'gemini','designpro-flat-first-atlas-20260825.v7',4096,4096,17.94,
  jsonb_build_object(
    'masterQcPassed',true,
    'masterQcContract','designpro.atlas-master-semantic-qc.v1'
  )
);

-- Six Call 1 panels, each bound to that accepted master.
create temporary table atlas_panels on commit drop as
select jsonb_agg(jsonb_build_object(
  'surfaceKey',s.surface_key,
  'contract','designpro.flat-first-atlas-call1-panel.v1',
  'contentHash',repeat(s.hex,64),
  'sourceMasterHash',repeat('c',64),
  'storagePath','designpro/panels/'||s.surface_key||'.png',
  'byteSize',1024,'contentType','image/png',
  'trimWidthIn',196.9,'trimHeightIn',50.9,
  'printWidthIn',206.9,'printHeightIn',60.9,
  'surfaceSqFt',69.6,'bleedInches',5,'effectivePpi',17.94,
  'geometryPurpose','calls-1-7-layout-only'
) order by s.surface_key) as panels
from (values
  ('driver','1'),('passenger','2'),('hood','3'),
  ('roof','4'),('front','5'),('rear','6')
) as s(surface_key,hex);

insert into public.designpro_revision_sources(
  revision_id,owner_id,tenant_key,generation_id,visualization_id,
  expected_updated_at,snapshot,snapshot_hash,idempotency_key
) select
  '45000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'user_41000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000001',
  '46000000-0000-4000-8000-000000000001',
  now(),jsonb_build_object('callOnePanels',panels),repeat('e',64),
  'atlas-stage-snapshot'
from atlas_panels;

insert into public.designpro_workflow_runs(
  id,workflow_type,owner_id,tenant_key,idempotency_key,status,
  revision_id,revision_snapshot_hash,entice_pack_id
) values(
  '47000000-0000-4000-8000-000000000001','designpro.entice_pack',
  '41000000-0000-4000-8000-000000000001',
  'user_41000000-0000-4000-8000-000000000001','atlas-stage-run','running',
  '45000000-0000-4000-8000-000000000001',repeat('e',64),
  '48000000-0000-4000-8000-000000000001'
);

-- ...and a Standard run, whose snapshot records no Call 1 panels at all.
insert into public.designpro_revision_sources(
  revision_id,owner_id,tenant_key,generation_id,visualization_id,
  expected_updated_at,snapshot,snapshot_hash,idempotency_key
) values(
  '55000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'user_41000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001',
  '56000000-0000-4000-8000-000000000001',
  now(),'{}'::jsonb,repeat('f',64),'standard-stage-snapshot'
);
insert into public.designpro_workflow_runs(
  id,workflow_type,owner_id,tenant_key,idempotency_key,status,
  revision_id,revision_snapshot_hash,entice_pack_id
) values(
  '57000000-0000-4000-8000-000000000001','designpro.entice_pack',
  '41000000-0000-4000-8000-000000000001',
  'user_41000000-0000-4000-8000-000000000001','standard-stage-run','running',
  '55000000-0000-4000-8000-000000000001',repeat('f',64),
  '58000000-0000-4000-8000-000000000001'
);

select is(
  designpro_private.workflow_run_is_atlas('47000000-0000-4000-8000-000000000001'),
  true,'a run whose frozen snapshot carries six accepted Call 1 panels is A.T.L.A.S.'
);
select is(
  designpro_private.workflow_run_is_atlas('57000000-0000-4000-8000-000000000001'),
  false,'a run with no Call 1 panels on its snapshot is not A.T.L.A.S.'
);

-- A leased, running proof.build stage per scenario, so each call is a real one.
-- (run_id,stage_key) and (run_id,sequence) are both unique, and a running
-- stage must carry a lease owner, so each scenario gets its own run bound to
-- the same frozen revision -- which is also what production looks like.
create or replace function pg_temp.lease_stage(
  p_stage uuid,p_run uuid,p_key text,p_token uuid,
  p_revision uuid default '45000000-0000-4000-8000-000000000001',
  p_snapshot text default repeat('e',64)
) returns void language sql as $$
  insert into public.designpro_workflow_runs(
    id,workflow_type,owner_id,tenant_key,idempotency_key,status,
    revision_id,revision_snapshot_hash,entice_pack_id
  ) values(
    p_run,'designpro.entice_pack',
    '41000000-0000-4000-8000-000000000001',
    'user_41000000-0000-4000-8000-000000000001',
    'stage-run-'||p_run::text,'running',
    p_revision,p_snapshot,p_run
  ) on conflict(id) do nothing;
  insert into public.designpro_workflow_stages(
    id,run_id,stage_key,sequence,status,idempotency_key,
    lease_owner,lease_token,lease_expires_at,started_at
  ) values(
    p_stage,p_run,p_key,10,'running',p_stage::text||':'||p_key,
    'pgtap',p_token,now()+interval '10 minutes',now()
  );
$$;

create or replace function pg_temp.identity_for(p_run uuid)
returns jsonb language sql as $$
  select jsonb_build_object(
    'workflowRunId',r.id::text,'revisionId',r.revision_id::text,
    'enticePackId',r.entice_pack_id::text,
    'dimensionManifestId',r.dimension_manifest_id::text,
    'sourceContractHash',r.source_contract_hash,
    'manifestHash',r.manifest_hash,'artifactSetHash',r.artifact_set_hash
  ) from public.designpro_workflow_runs r where r.id=p_run;
$$;

create or replace function pg_temp.deferred_receipt(
  p_overrides jsonb default '{}'::jsonb
) returns jsonb language sql as $$
  select jsonb_build_object(
    'verified',false,'deferred',true,
    'receiptKind','call8.flat-proof','call',8,
    'proofKind','flattened-2d-proof',
    'productionAuthority','atlas-master',
    'failure',jsonb_build_object(
      'code','call8_proof_font_missing','message','no proof font is installed'
    )
  ) || p_overrides;
$$;

-- 1. A.T.L.A.S. + a valid deferred Call 8 completes, so the run reaches
--    panels.build instead of dying at stage two.
select pg_temp.lease_stage(
  '49000000-0000-4000-8000-000000000001',
  '47000000-0000-4000-8000-000000000001','proof.build',
  '4a000000-0000-4000-8000-000000000001'
);
select is(
  public.complete_designpro_stage(
    '49000000-0000-4000-8000-000000000001',
    '4a000000-0000-4000-8000-000000000001',
    pg_temp.identity_for('47000000-0000-4000-8000-000000000001'),
    pg_temp.deferred_receipt(),repeat('9',64),'[]'::jsonb
  ),true,'A.T.L.A.S. accepts a fully-evidenced deferred Call 8'
);
select is(
  (select status from public.designpro_workflow_stages
   where id='49000000-0000-4000-8000-000000000001'),
  'completed','the deferred proof.build stage is completed, not failed'
);
select is(
  (select receipt_kind from public.designpro_stage_receipts
   where run_id='47000000-0000-4000-8000-000000000001'),
  'call8.flat-proof-deferred',
  'a deferral is recorded as its own kind, never as a proof that was built'
);

-- 2. Standard + an unverified proof is still refused.
select pg_temp.lease_stage(
  '4b000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001','proof.build',
  '4c000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001',repeat('f',64)
);
select throws_ok($$
  select public.complete_designpro_stage(
    '4b000000-0000-4000-8000-000000000001',
    '4c000000-0000-4000-8000-000000000001',
    pg_temp.identity_for('71000000-0000-4000-8000-000000000001'),
    pg_temp.deferred_receipt(),repeat('9',64),'[]'::jsonb)
$$,'verified_receipt_required',
  'a non-A.T.L.A.S. run cannot defer Call 8, however the receipt is worded');

-- 3. A.T.L.A.S. + unverified but not explicitly deferred is refused.
select pg_temp.lease_stage(
  '4d000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001','proof.build',
  '4e000000-0000-4000-8000-000000000001'
);
select throws_ok($$
  select public.complete_designpro_stage(
    '4d000000-0000-4000-8000-000000000001',
    '4e000000-0000-4000-8000-000000000001',
    pg_temp.identity_for('72000000-0000-4000-8000-000000000001'),
    pg_temp.deferred_receipt('{"deferred":false}'::jsonb),
    repeat('9',64),'[]'::jsonb)
$$,'verified_receipt_required',
  'an unverified receipt that does not declare itself a deferral is refused');

-- 4. A.T.L.A.S. + deferred without atlas-master authority is refused.
select pg_temp.lease_stage(
  '4f000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001','proof.build',
  '50000000-0000-4000-8000-000000000001'
);
select throws_ok($$
  select public.complete_designpro_stage(
    '4f000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    pg_temp.identity_for('73000000-0000-4000-8000-000000000001'),
    pg_temp.deferred_receipt('{"productionAuthority":"call8-proof"}'::jsonb),
    repeat('9',64),'[]'::jsonb)
$$,'verified_receipt_required',
  'a deferral that does not name A.T.L.A.S. as the production authority is refused');

-- 5. A.T.L.A.S. + deferred without a recorded reason is refused.
select pg_temp.lease_stage(
  '51000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001','proof.build',
  '52000000-0000-4000-8000-000000000001'
);
select throws_ok($$
  select public.complete_designpro_stage(
    '51000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001',
    pg_temp.identity_for('74000000-0000-4000-8000-000000000001'),
    pg_temp.deferred_receipt('{"failure":{"code":"","message":""}}'::jsonb),
    repeat('9',64),'[]'::jsonb)
$$,'verified_receipt_required',
  'a deferral with no recorded failure is refused -- silence is not a reason');

-- 6. Later stages keep their verified-receipt enforcement.
select pg_temp.lease_stage(
  '59000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000001','logos.extract',
  '5a000000-0000-4000-8000-000000000001'
);
select throws_ok($$
  select public.complete_designpro_stage(
    '59000000-0000-4000-8000-000000000001',
    '5a000000-0000-4000-8000-000000000001',
    pg_temp.identity_for('75000000-0000-4000-8000-000000000001'),
    pg_temp.deferred_receipt(),repeat('9',64),'[]'::jsonb)
$$,'verified_receipt_required',
  'the deferral exception is proof.build only -- Call 10 still requires verification');

-- A. The A.T.L.A.S. Call 1 promotion advances on its own evidence.
create or replace function pg_temp.promotion_receipt(
  p_overrides jsonb default '{}'::jsonb
) returns jsonb language sql as $$
  select (jsonb_build_object(
    'verified',true,'receiptKind','call9.surface-panels','call',9,
    'panelSourceRule','one-own-surface-region-per-output-side',
    'promotedFrom','atlas-call1',
    'panels',(select panels from atlas_panels),
    'panelHashes',(select jsonb_object_agg(c->>'surfaceKey',c->>'contentHash')
                   from atlas_panels, lateral jsonb_array_elements(panels) c)
  )) || p_overrides;
$$;
create or replace function pg_temp.promotion_artifacts()
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'kind','panel','surfaceKey',c->>'surfaceKey',
    'storagePath',c->>'storagePath','contentHash',c->>'contentHash',
    'byteSize',1024,
    'metadata',jsonb_build_object(
      'sourceMasterHash',c->>'sourceMasterHash','bleedInches',5
    )
  )) from atlas_panels, lateral jsonb_array_elements(panels) c;
$$;

select pg_temp.lease_stage(
  '5b000000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000001','panels.build',
  '5c000000-0000-4000-8000-000000000001'
);
select is(
  public.complete_designpro_stage(
    '5b000000-0000-4000-8000-000000000001',
    '5c000000-0000-4000-8000-000000000001',
    pg_temp.identity_for('76000000-0000-4000-8000-000000000001'),
    pg_temp.promotion_receipt(),repeat('8',64),pg_temp.promotion_artifacts()
  ),true,
  'six panels bound to the accepted master advance without any Call 8 proof'
);

-- B. Geometry that does not match what Call 1 cut is refused.
select pg_temp.lease_stage(
  '5d000000-0000-4000-8000-000000000001',
  '77000000-0000-4000-8000-000000000001','panels.build',
  '5e000000-0000-4000-8000-000000000001'
);
select throws_ok($$
  select public.complete_designpro_stage(
    '5d000000-0000-4000-8000-000000000001',
    '5e000000-0000-4000-8000-000000000001',
    pg_temp.identity_for('77000000-0000-4000-8000-000000000001'),
    pg_temp.promotion_receipt(jsonb_build_object('panels',
      (select jsonb_agg(case when c->>'surfaceKey'='driver'
         then c || '{"trimWidthIn":1}'::jsonb else c end)
       from atlas_panels, lateral jsonb_array_elements(panels) c))),
    repeat('8',64),pg_temp.promotion_artifacts())
$$,'call9_atlas_panel_promotion_contract_failed',
  'a panel reporting geometry Call 1 did not cut is refused');

-- C. A panel that is not the one on the frozen snapshot is refused.
select pg_temp.lease_stage(
  '5f000000-0000-4000-8000-000000000001',
  '78000000-0000-4000-8000-000000000001','panels.build',
  '60000000-0000-4000-8000-000000000001'
);
select throws_ok($$
  select public.complete_designpro_stage(
    '5f000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    pg_temp.identity_for('78000000-0000-4000-8000-000000000001'),
    pg_temp.promotion_receipt(jsonb_build_object('panelHashes',
      (select jsonb_object_agg(c->>'surfaceKey',
         case when c->>'surfaceKey'='rear' then repeat('7',64)
              else c->>'contentHash' end)
       from atlas_panels, lateral jsonb_array_elements(panels) c))),
    repeat('8',64),pg_temp.promotion_artifacts())
$$,'call9_atlas_panel_promotion_contract_failed',
  'a promoted hash that is not the Call 1 panel on the frozen snapshot is refused');

-- ...and so is an artifact that names a different master.
select pg_temp.lease_stage(
  '61000000-0000-4000-8000-000000000001',
  '79000000-0000-4000-8000-000000000001','panels.build',
  '62000000-0000-4000-8000-000000000001'
);
select throws_ok($$
  select public.complete_designpro_stage(
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000001',
    pg_temp.identity_for('79000000-0000-4000-8000-000000000001'),
    pg_temp.promotion_receipt(),repeat('8',64),
    (select jsonb_agg(case when a->>'surfaceKey'='hood'
       then jsonb_set(a,'{metadata,sourceMasterHash}',to_jsonb(repeat('0',64)))
       else a end)
     from jsonb_array_elements(pg_temp.promotion_artifacts()) a))
$$,'call9_atlas_panel_promotion_contract_failed',
  'a panel artifact naming a different master is refused');

-- D. A Standard run cannot borrow the A.T.L.A.S. branch by wording alone.
select pg_temp.lease_stage(
  '63000000-0000-4000-8000-000000000001',
  '7a000000-0000-4000-8000-000000000001','panels.build',
  '64000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001',repeat('f',64)
);
select throws_ok($$
  select public.complete_designpro_stage(
    '63000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000001',
    pg_temp.identity_for('7a000000-0000-4000-8000-000000000001'),
    pg_temp.promotion_receipt(),repeat('8',64),pg_temp.promotion_artifacts())
$$,'call9_unique_proof_region_contract_failed',
  'a run with no Call 1 panels still faces the proof-region contract');

-- E. Nothing downstream was loosened: the Production Pack gate still demands a
--    verified pack.verify before activation.
select ok(
  position(
    'verified_entice_pack_required_for_activation' in
    pg_get_functiondef(
      'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure
    )
  )>0,
  'pack.activate still requires a verified pack.verify'
);
select ok(
  position(
    'finalized_entice_identity_required' in
    pg_get_functiondef(
      'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure
    )
  )>0,
  'pack.verify still requires the finalized entice identity'
);

select * from finish();
rollback;
