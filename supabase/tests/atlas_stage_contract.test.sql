-- The stage machine's A.T.L.A.S. path, exercised rather than asserted about.
--
-- These call complete_designpro_stage for real, because the defect they cover
-- was invisible to text assertions: the runtime and the RPC each looked correct
-- on their own and disagreed only when they met. Run 9923b2de died at
-- proof.build on verified_receipt_required and nothing in either half's source
-- said so.
--
-- The fixture is a REAL generation, handed off by the real RPC. Hand-writing a
-- designpro_revision_sources row is not possible by design: two triggers and a
-- snapshot contract require a complete accepted generation behind it, the
-- snapshot hash must be the digest of the snapshot itself, and every render
-- asset must be the destination of an exact active generation view. So the
-- fixture builds the request and its seven views and then calls
-- handoff_designpro_generation_to_production, exactly as production does --
-- which also means callOnePanels reaches the snapshot the way it really does,
-- carried across the seam from the accepted A.T.L.A.S. revision's metadata.

begin;
select plan(37);

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

-- The six Call 1 panels, each bound to the master this generation accepted.
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

-- Two complete generations: one A.T.L.A.S. (v3, with an accepted master whose
-- metadata carries the six panels) and one Standard (v2, no master, no panels).
create or replace function pg_temp.seed_generation(
  p_request uuid,p_generation uuid,p_revision uuid,p_contract text,
  p_design text,p_seed text
) returns void language plpgsql as $seed$
DECLARE v_input jsonb; v_hash text;
BEGIN
  v_input:=jsonb_build_object(
    'contractVersion',p_contract,
    'vehicle',jsonb_build_object(
      'year','2022','make','Ford','model','F250 Crew Cab','type','truck'),
    'brief','atlas stage contract fixture',
    'designName',p_design,'mode','commercial','companyName',p_design
  );
  IF p_contract='designpro.calls-1-7-input.v3' THEN
    v_input:=v_input||jsonb_build_object('pipelineMode','flat-first-atlas-v1');
  END IF;
  v_hash:=encode(extensions.digest(convert_to(v_input::text,'UTF8'),'sha256'),'hex');

  INSERT INTO public.designpro_generation_requests(
    id,generation_id,owner_id,tenant_key,idempotency_key,state,request_input,
    input_hash,engine_contract,engine_contract_hash,output_set_hash,
    engine_receipt,completed_at
  ) VALUES(
    p_request,p_generation,'41000000-0000-4000-8000-000000000001',
    'user_41000000-0000-4000-8000-000000000001',
    'calls17:'||p_generation::text||':'||v_hash,'outputs_ready',v_input,v_hash,
    designpro_private.calls_1_7_engine_contract(),
    encode(extensions.digest(convert_to(
      designpro_private.calls_1_7_engine_contract()::text,'UTF8'),'sha256'),'hex'),
    repeat('9',64),
    jsonb_build_object(
      'contractVersion','designpro.calls-1-7-receipt.v1',
      'handoffRevisionId',p_revision::text,
      'callsCompleted','7','byteVerified','true'
    ),now()
  );

  INSERT INTO public.designpro_generation_views(
    request_id,source_view_type,consumer_role,storage_path,content_hash,
    byte_size,content_type,metadata
  )
  SELECT p_request,plan.source_view_type,plan.consumer_role,
    'designpro/user_41000000-0000-4000-8000-000000000001/'||p_generation::text
      ||'/calls-1-7/'||plan.source_view_type||'/'
      ||encode(extensions.digest(convert_to(p_seed||plan.consumer_role,'UTF8'),'sha256'),'hex')
      ||'.png',
    encode(extensions.digest(convert_to(p_seed||plan.consumer_role,'UTF8'),'sha256'),'hex'),
    2048,'image/png','{}'::jsonb
  FROM (values ('side','driver'),('passenger-side','passenger'),
    ('hood_detail','hood'),('front','front'),('rear','rear'),
    ('close-up','closeup'),('roof','roof')) AS plan(source_view_type,consumer_role);
END $seed$;

select pg_temp.seed_generation(
  '42000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000001','designpro.calls-1-7-input.v3',
  'Atlas Stage Contract','atlas'
);
select pg_temp.seed_generation(
  '52000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001','designpro.calls-1-7-input.v2',
  'Standard Stage Contract','standard'
);

-- The accepted A.T.L.A.S. master. Its metadata is where callOnePanels lives,
-- and the handoff carries them across the seam into the frozen snapshot -- so
-- the fixture exercises that carry rather than asserting it.
insert into public.designpro_flat_atlas_revisions(
  id,request_id,generation_id,owner_id,tenant_key,revision_sequence,
  guide_storage_path,guide_content_hash,guide_byte_size,guide_content_type,
  manifest_storage_path,manifest_content_hash,manifest_byte_size,manifest_content_type,
  master_storage_path,master_content_hash,master_byte_size,master_content_type,
  projection_storage_path,projection_content_hash,projection_byte_size,projection_content_type,
  manifest,model,prompt_version,width_px,height_px,effective_ppi,metadata
)
select
  '44000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  base.tenant_key,1,
  base.prefix||'guide/'||repeat('a',64)||'.png',repeat('a',64),10,'image/png',
  base.prefix||'manifest/'||repeat('b',64)||'.json',repeat('b',64),10,'application/json',
  base.prefix||'revisions/1/master/'||repeat('c',64)||'.png',repeat('c',64),10,'image/png',
  base.prefix||'revisions/1/projection/'||repeat('d',64)||'.jpg',repeat('d',64),10,'image/jpeg',
  '{}'::jsonb,'gemini','designpro-flat-first-atlas-20260825.v7',4096,4096,17.94,
  jsonb_build_object(
    'masterQcPassed',true,
    'masterQcContract','designpro.atlas-master-semantic-qc.v1',
    'callOnePanels',(select panels from atlas_panels)
  )
from (select
  'user_41000000-0000-4000-8000-000000000001' as tenant_key,
  'designpro/user_41000000-0000-4000-8000-000000000001'
    ||'/43000000-0000-4000-8000-000000000001/flat-first/v1/' as prefix
) base;

-- The real handoff, as the owner. It authors the frozen revision source and the
-- entice run with its seven stages -- every trigger satisfied because the RPC
-- is the thing that satisfies them.
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"41000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true);
select public.handoff_designpro_generation_to_production(
  '42000000-0000-4000-8000-000000000001');
select public.handoff_designpro_generation_to_production(
  '52000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"role":"service_role"}',true);

create temporary table runs on commit drop as
select
  (select id from public.designpro_workflow_runs
   where revision_id='45000000-0000-4000-8000-000000000001'
     and workflow_type='designpro.entice_pack') as atlas_run,
  (select id from public.designpro_workflow_runs
   where revision_id='55000000-0000-4000-8000-000000000001'
     and workflow_type='designpro.entice_pack') as standard_run;

select isnt((select atlas_run from runs),null,'the A.T.L.A.S. entice run exists');
select isnt((select standard_run from runs),null,'the Standard entice run exists');

select is(
  designpro_private.workflow_run_is_atlas((select atlas_run from runs)),
  true,'a run whose frozen snapshot carries six accepted Call 1 panels is A.T.L.A.S.'
);
select is(
  designpro_private.workflow_run_is_atlas((select standard_run from runs)),
  false,'a run with no Call 1 panels on its snapshot is not A.T.L.A.S.'
);

-- Lease a stage in place. A refused completion RAISEs before it writes, so the
-- lease survives and one stage can face every rejection scenario before the
-- single accepting call consumes it.
create or replace function pg_temp.lease(p_run uuid,p_key text,p_token uuid)
returns uuid language sql as $lease$
  update public.designpro_workflow_stages
  set status='running',lease_owner='pgtap',lease_token=p_token,
    lease_expires_at=now()+interval '10 minutes',started_at=now()
  where run_id=p_run and stage_key=p_key
  returning id;
$lease$;

create or replace function pg_temp.identity_for(p_run uuid)
returns jsonb language sql as $ident$
  select jsonb_build_object(
    'workflowRunId',r.id::text,'revisionId',r.revision_id::text,
    'enticePackId',r.entice_pack_id::text,
    'dimensionManifestId',r.dimension_manifest_id::text,
    'sourceContractHash',r.source_contract_hash,
    'manifestHash',r.manifest_hash,'artifactSetHash',r.artifact_set_hash
  ) from public.designpro_workflow_runs r where r.id=p_run;
$ident$;

create or replace function pg_temp.deferred(p_overrides jsonb default '{}'::jsonb)
returns jsonb language sql as $def$
  select jsonb_build_object(
    'verified',false,'deferred',true,
    'receiptKind','call8.flat-proof','call',8,
    'proofKind','flattened-2d-proof',
    'productionAuthority','atlas-master',
    'failure',jsonb_build_object(
      'code','call8_proof_font_missing','message','no proof font is installed')
  ) || p_overrides;
$def$;

create temporary table leases on commit drop as
select
  pg_temp.lease((select atlas_run from runs),'proof.build',
    '4a000000-0000-4000-8000-000000000001') as atlas_proof,
  pg_temp.lease((select standard_run from runs),'proof.build',
    '4c000000-0000-4000-8000-000000000001') as standard_proof;

-- 2. Standard + an unverified proof is refused, however the receipt is worded.
select throws_ok($t2$
  select public.complete_designpro_stage(
    (select standard_proof from leases),
    '4c000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select standard_run from runs)),
    pg_temp.deferred(),repeat('9',64),'[]'::jsonb)
$t2$,'verified_receipt_required',
  'a non-A.T.L.A.S. run cannot defer Call 8');

-- 3. A.T.L.A.S. + unverified but not explicitly deferred is refused.
select throws_ok($t3$
  select public.complete_designpro_stage(
    (select atlas_proof from leases),
    '4a000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select atlas_run from runs)),
    pg_temp.deferred('{"deferred":false}'::jsonb),repeat('9',64),'[]'::jsonb)
$t3$,'verified_receipt_required',
  'an unverified receipt that does not declare itself a deferral is refused');

-- 4. A.T.L.A.S. + deferred without atlas-master authority is refused.
select throws_ok($t4$
  select public.complete_designpro_stage(
    (select atlas_proof from leases),
    '4a000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select atlas_run from runs)),
    pg_temp.deferred('{"productionAuthority":"call8-proof"}'::jsonb),
    repeat('9',64),'[]'::jsonb)
$t4$,'verified_receipt_required',
  'a deferral that does not name A.T.L.A.S. as the production authority is refused');

-- 5. A.T.L.A.S. + deferred without a recorded reason is refused.
select throws_ok($t5$
  select public.complete_designpro_stage(
    (select atlas_proof from leases),
    '4a000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select atlas_run from runs)),
    pg_temp.deferred('{"failure":{"code":"","message":""}}'::jsonb),
    repeat('9',64),'[]'::jsonb)
$t5$,'verified_receipt_required',
  'a deferral with no recorded failure is refused -- silence is not a reason');

-- 1. ...and a fully-evidenced deferral completes, so the run reaches
--    panels.build instead of dying at stage two.
select is(
  public.complete_designpro_stage(
    (select atlas_proof from leases),
    '4a000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select atlas_run from runs)),
    pg_temp.deferred(),repeat('9',64),'[]'::jsonb
  ),true,'A.T.L.A.S. accepts a fully-evidenced deferred Call 8'
);
select is(
  (select status from public.designpro_workflow_stages
   where id=(select atlas_proof from leases)),
  'completed','the deferred proof.build stage is completed, not failed'
);
select is(
  (select receipt_kind from public.designpro_stage_receipts
   where run_id=(select atlas_run from runs)
     and receipt_kind like 'call8%'),
  'call8.flat-proof-deferred',
  'a deferral is recorded as its own kind, never as a proof that was built'
);

-- 6. The exception is proof.build only: Call 10 still requires verification.
select throws_ok($t6$
  select public.complete_designpro_stage(
    pg_temp.lease((select atlas_run from runs),'logos.extract',
      '5a000000-0000-4000-8000-000000000001'),
    '5a000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select atlas_run from runs)),
    pg_temp.deferred(),repeat('9',64),'[]'::jsonb)
$t6$,'verified_receipt_required',
  'the deferral exception is proof.build only');

create or replace function pg_temp.promotion(p_overrides jsonb default '{}'::jsonb)
returns jsonb language sql as $prom$
  select (jsonb_build_object(
    'verified',true,'receiptKind','call9.surface-panels','call',9,
    'panelSourceRule','one-own-surface-region-per-output-side',
    'promotedFrom','atlas-call1',
    'panels',(select panels from atlas_panels),
    'panelHashes',(select jsonb_object_agg(c->>'surfaceKey',c->>'contentHash')
                   from atlas_panels, lateral jsonb_array_elements(panels) c)
  )) || p_overrides;
$prom$;
-- enforce_artifact_storage_identity binds every artifact path to its OWN run:
-- designpro/<tenant_key>/<run_id>/... So the artifacts must be built for the
-- run being completed. Handing the Standard run the A.T.L.A.S. run's artifacts
-- tripped that trigger first, and test D never reached the legacy contract it
-- exists to prove.
create or replace function pg_temp.promotion_artifacts(p_run uuid)
returns jsonb language sql as $art$
  select jsonb_agg(jsonb_build_object(
    'kind','panel','surfaceKey',c->>'surfaceKey',
    'storagePath','designpro/'||r.tenant_key||'/'||r.id::text
      ||'/panels/'||(c->>'contentHash')||'.png',
    'contentHash',c->>'contentHash','byteSize',1024,
    'metadata',jsonb_build_object(
      'sourceMasterHash',c->>'sourceMasterHash','bleedInches',5)
  ))
  from public.designpro_workflow_runs r, atlas_panels,
    lateral jsonb_array_elements(panels) c
  where r.id=p_run;
$art$;

-- Address the stages directly rather than through a function in a SELECT list,
-- so which stage belongs to which run is a fact the test states rather than a
-- property of evaluation order -- and then ASSERT that mapping, because the
-- previous failure was only explicable if it had gone wrong somewhere.
create temporary table panel_leases on commit drop as
select
  (select id from public.designpro_workflow_stages
   where run_id=(select atlas_run from runs) and stage_key='panels.build')
    as atlas_panels_stage,
  (select id from public.designpro_workflow_stages
   where run_id=(select standard_run from runs) and stage_key='panels.build')
    as standard_panels_stage;

update public.designpro_workflow_stages
set status='running',lease_owner='pgtap',
  lease_token='5c000000-0000-4000-8000-000000000001',
  lease_expires_at=now()+interval '10 minutes',started_at=now()
where id=(select atlas_panels_stage from panel_leases);

update public.designpro_workflow_stages
set status='running',lease_owner='pgtap',
  lease_token='64000000-0000-4000-8000-000000000001',
  lease_expires_at=now()+interval '10 minutes',started_at=now()
where id=(select standard_panels_stage from panel_leases);

select is(
  (select s.run_id from public.designpro_workflow_stages s
   where s.id=(select atlas_panels_stage from panel_leases)),
  (select atlas_run from runs),
  'the leased A.T.L.A.S. panels.build stage belongs to the A.T.L.A.S. run'
);
select is(
  (select s.run_id from public.designpro_workflow_stages s
   where s.id=(select standard_panels_stage from panel_leases)),
  (select standard_run from runs),
  'the leased Standard panels.build stage belongs to the Standard run'
);
select is(
  designpro_private.workflow_run_is_atlas((select standard_run from runs)),
  false,
  'the Standard run is still not A.T.L.A.S. at the moment panels.build runs'
);

-- B. Geometry Call 1 did not cut is refused. This is the owner's "missing
--    manifest blocks" test, corrected: requiring the GENIE manifest would block
--    every A.T.L.A.S. entice run BY DESIGN, because RULE 0.19 puts
--    manifest.resolve after the purchase gate. The manifest that legitimately
--    exists here is the Call 1 design-time geometry on the frozen snapshot.
select throws_ok($tb$
  select public.complete_designpro_stage(
    (select atlas_panels_stage from panel_leases),
    '5c000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select atlas_run from runs)),
    pg_temp.promotion(jsonb_build_object('panels',
      (select jsonb_agg(case when c->>'surfaceKey'='driver'
         then c || '{"trimWidthIn":1}'::jsonb else c end)
       from atlas_panels, lateral jsonb_array_elements(panels) c))),
    repeat('8',64),pg_temp.promotion_artifacts((select atlas_run from runs)))
$tb$,'call9_atlas_panel_promotion_contract_failed',
  'a panel reporting geometry Call 1 did not cut is refused');

-- C. A promoted hash that is not the Call 1 panel on the frozen snapshot.
select throws_ok($tc$
  select public.complete_designpro_stage(
    (select atlas_panels_stage from panel_leases),
    '5c000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select atlas_run from runs)),
    pg_temp.promotion(jsonb_build_object('panelHashes',
      (select jsonb_object_agg(c->>'surfaceKey',
         case when c->>'surfaceKey'='rear' then repeat('7',64)
              else c->>'contentHash' end)
       from atlas_panels, lateral jsonb_array_elements(panels) c))),
    repeat('8',64),pg_temp.promotion_artifacts((select atlas_run from runs)))
$tc$,'call9_atlas_panel_promotion_contract_failed',
  'a promoted hash that is not the Call 1 panel on the frozen snapshot is refused');

-- ...and an artifact naming a different master.
select throws_ok($tc2$
  select public.complete_designpro_stage(
    (select atlas_panels_stage from panel_leases),
    '5c000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select atlas_run from runs)),
    pg_temp.promotion(),repeat('8',64),
    (select jsonb_agg(case when a->>'surfaceKey'='hood'
       then jsonb_set(a,'{metadata,sourceMasterHash}',to_jsonb(repeat('0',64)))
       else a end)
     from jsonb_array_elements(pg_temp.promotion_artifacts((select atlas_run from runs))) a))
$tc2$,'call9_atlas_panel_promotion_contract_failed',
  'a panel artifact naming a different master is refused');

-- complete_designpro_stage RETURNS FALSE, without raising, when the stage is not
-- found running under the exact lease. "caught: no exception" is therefore
-- ambiguous between "the contract allowed it" and "the lease was not matched",
-- and I cannot tell those apart from the outside. These state the lease.
select is(
  (select status||'|'||lease_token::text
   from public.designpro_workflow_stages
   where id=(select standard_panels_stage from panel_leases)),
  'running|64000000-0000-4000-8000-000000000001',
  'the Standard panels.build stage is running under the exact lease D uses'
);
select ok(
  (select lease_expires_at>clock_timestamp()
   from public.designpro_workflow_stages
   where id=(select standard_panels_stage from panel_leases)),
  'that lease has not expired'
);

-- D. A Standard run cannot borrow the A.T.L.A.S. branch by wording alone.
select throws_ok($td$
  select public.complete_designpro_stage(
    (select standard_panels_stage from panel_leases),
    '64000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select standard_run from runs)),
    pg_temp.promotion(),repeat('8',64),
    pg_temp.promotion_artifacts((select standard_run from runs)))
$td$,'call9_unique_proof_region_contract_failed',
  'a run with no Call 1 panels still faces the proof-region contract');

-- A raised the LEGACY contract error on a clean A.T.L.A.S. receipt, which is
-- only possible if v_atlas was false for it at that moment -- even though B, C
-- and C2 had just proven the A.T.L.A.S. branch was being taken for this exact
-- stage. State both facts here so the next failure names which one moved.
select is(
  designpro_private.workflow_run_is_atlas((select atlas_run from runs)),
  true,'the A.T.L.A.S. run is still A.T.L.A.S. immediately before the clean promotion'
);
select is(
  (select status||'|'||lease_token::text
   from public.designpro_workflow_stages
   where id=(select atlas_panels_stage from panel_leases)),
  'running|5c000000-0000-4000-8000-000000000001',
  'the A.T.L.A.S. panels.build stage is still running under its lease'
);

-- Every input to the A.T.L.A.S. branch is proven correct above, and it still
-- takes the legacy branch. The remaining variable is the SHAPE of the patched
-- function itself, so assert that directly: the branch condition must be
-- present verbatim, and it must come BEFORE the legacy branch in the ELSIF
-- chain, because an ELSIF chain is decided by order.
select ok(
  position($atlascond$ELSIF v_stage.stage_key='panels.build'
    AND v_atlas AND p_receipt->>'promotedFrom'='atlas-call1' THEN$atlascond$
    in pg_get_functiondef(
      'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure
    ))>0,
  'the A.T.L.A.S. panels.build branch condition survived the patch verbatim'
);
-- The legacy arm must still EXIST. A fragment replacement that swaps the branch
-- header for a new branch and forgets to re-emit it deletes the old arm, and
-- the ELSIF chain then has no panels.build arm for a non-A.T.L.A.S. run at all
-- -- which is how a Standard run completed Call 9 with no contract enforced.
select ok(
  position($legacyarm$  ELSIF v_stage.stage_key='panels.build' THEN
    v_kind:='call9.surface-panels';
    v_manifest:=v_run.results->'dimensionManifest';$legacyarm$
    in pg_get_functiondef(
      'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure
    ))>0,
  'the legacy panels.build arm still exists for non-A.T.L.A.S. runs'
);
select ok(
  position('call9_atlas_panel_promotion_contract_failed' in pg_get_functiondef(
    'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure))
  < position('call9_unique_proof_region_contract_failed' in pg_get_functiondef(
    'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure)),
  'the A.T.L.A.S. branch precedes the legacy branch in the ELSIF chain'
);

-- A. The clean promotion advances on A.T.L.A.S. evidence alone.
select is(
  public.complete_designpro_stage(
    (select atlas_panels_stage from panel_leases),
    '5c000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select atlas_run from runs)),
    pg_temp.promotion(),repeat('8',64),pg_temp.promotion_artifacts((select atlas_run from runs))
  ),true,
  'six panels bound to the accepted master advance without any Call 8 proof'
);

-- 3 + 4 (the phase boundary). Design-time geometry establishes and extracts the
-- surfaces; GENIE post-purchase geometry is the production authority.
select is(
  (select dimension_manifest_id is null and manifest_hash is null
   from public.designpro_workflow_runs where id=(select atlas_run from runs)),
  true,'the free A.T.L.A.S. run carries no GENIE manifest, as RULE 0.19 requires'
);
select ok(
  position('workflow_run_is_atlas' in pg_get_functiondef(
    'public.finalize_designpro_entice_identity(uuid,uuid,uuid,text,text,jsonb)'
      ::regprocedure))>0
  AND position('call8.flat-proof-deferred' in pg_get_functiondef(
    'public.finalize_designpro_entice_identity(uuid,uuid,uuid,text,text,jsonb)'
      ::regprocedure))>0,
  'the free-half identity gate admits an A.T.L.A.S. run with no manifest and a deferred Call 8'
);
select ok(
  position('calls-1-7-layout-only' in pg_get_functiondef(
    'public.bind_designpro_dimension_manifest(uuid,uuid,uuid,uuid,jsonb,text,text)'
      ::regprocedure))>0
  AND position('designpro.genie-dimension-manifest.v1' in pg_get_functiondef(
    'public.bind_designpro_dimension_manifest(uuid,uuid,uuid,uuid,jsonb,text,text)'
      ::regprocedure))>0,
  'design-time geometry can never bind as production geometry'
);

-- 8 + E. The exception is bounded to the A.T.L.A.S. design handoff and cannot
--        become a generic bypass: every paid gate still stands.
select ok(
  position('output_artifact_ledger_mismatch' in pg_get_functiondef(
    'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure))>0
  AND position('exact_zip_and_wrapbox_manifest_required' in pg_get_functiondef(
    'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure))>0
  AND position('verified_entice_pack_required_for_activation' in pg_get_functiondef(
    'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure))>0,
  'output.verify, wrapbox.deliver and pack.activate still face their own contracts'
);

-- 9. THE FREE PACK IS VERIFIED AGAINST THE GEOMETRY IT WAS BUILT FROM.
--
-- pack.verify demanded a bound GENIE dimension manifest. RULE 0.19 puts
-- manifest.resolve AFTER await_purchase, so an entice run has none, and the
-- free pack could never activate -- run 8e9fab59-d282-4f92-a8aa-86b2f4e1d09e
-- died there with six promoted panels, six de-logoed duplicates and a logo
-- inventory already in hand.
--
-- The exemption is conditioned on the panels.build receipt saying the panels
-- were promoted from Call 1, not on the workflow type: geometry a run cannot
-- otherwise account for still has to come from GENIE.

-- Everything pack.verify wants EXCEPT the manifest, on both runs.
update public.designpro_workflow_runs
set source_contract_hash=repeat('7',64),
    artifact_set_hash=repeat('8',64),
    results=coalesce(results,'{}'::jsonb)
      || jsonb_build_object('packReceipt',jsonb_build_object('verified',true)),
    dimension_manifest_id=null, manifest_hash=null
where id in ((select atlas_run from runs),(select standard_run from runs));

-- The A.T.L.A.S. run promoted its panels from Call 1, so it is accountable for
-- its own geometry and pack.verify accepts it.
select is(
  public.complete_designpro_stage(
    pg_temp.lease((select atlas_run from runs),'pack.verify',
      '7a000000-0000-4000-8000-000000000001'),
    '7a000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select atlas_run from runs)),
    jsonb_build_object('verified',true,'receiptKind','entice.pack-verify'),
    repeat('7',64),'[]'::jsonb
  ),true,'an A.T.L.A.S. entice pack verifies without a GENIE manifest'
);

-- A run with no A.T.L.A.S. panel set has nothing else fixing its geometry, so
-- the requirement stands exactly as before.
select throws_ok($t9$
  select public.complete_designpro_stage(
    pg_temp.lease((select standard_run from runs),'pack.verify',
      '7c000000-0000-4000-8000-000000000001'),
    '7c000000-0000-4000-8000-000000000001',
    pg_temp.identity_for((select standard_run from runs)),
    jsonb_build_object('verified',true,'receiptKind','entice.pack-verify'),
    repeat('7',64),'[]'::jsonb)
$t9$,'finalized_entice_identity_required',
  'a run that did not promote Call-1 panels still must bind a manifest');

-- And the other three identities are untouched: strip one and it is refused
-- again, A.T.L.A.S. or not.
update public.designpro_workflow_runs set artifact_set_hash=null
where id=(select atlas_run from runs);
select throws_ok($t9b$
  select public.complete_designpro_stage(
    pg_temp.lease((select atlas_run from runs),'pack.verify',
      '7a000000-0000-4000-8000-000000000002'),
    '7a000000-0000-4000-8000-000000000002',
    pg_temp.identity_for((select atlas_run from runs)),
    jsonb_build_object('verified',true,'receiptKind','entice.pack-verify'),
    repeat('7',64),'[]'::jsonb)
$t9b$,'finalized_entice_identity_required',
  'the exemption covers the manifest only, never the pack identity');

select * from finish();
rollback;
