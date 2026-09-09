begin;
select plan(38);

-- Isolated fixture identities: these tests never invoke image providers,
-- publish a delivery, or record human production QC approval.
insert into auth.users(id,email,role,email_confirmed_at,created_at,updated_at) values
 ('a1111111-1111-4111-8111-111111111111','identity-owner@example.test','authenticated',now(),now(),now()),
 ('b2222222-2222-4222-8222-222222222222','identity-legacy@example.test','authenticated',now(),now(),now());
create temporary table identity_results(name text primary key,value jsonb);
create function pg_temp.identity_input() returns jsonb language sql as $$
 select '{"contractVersion":"designpro.calls-1-7-input.v3","pipelineMode":"flat-first-atlas-v1",
 "vehicle":{"year":"2024","make":"Ford","model":"Transit","type":"van"},
 "brief":"Keep the existing blue background and readable company logo.","designName":"Identity fixture",
 "mode":"commercial","companyName":"Identity fixture"}'::jsonb
$$;
create function pg_temp.identity_result(p_name text) returns jsonb language sql as $$select value from identity_results where name=p_name$$;
create function pg_temp.identity_atlas(p_request_id uuid,p_atlas_id uuid) returns uuid language plpgsql as $$
declare r public.designpro_generation_requests%rowtype; p text; h text:=repeat('a',64);
begin
 select * into r from public.designpro_generation_requests where id=p_request_id;
 p:='designpro/'||r.tenant_key||'/'||r.generation_id||'/flat-first/v1/revisions/'||r.revision_sequence;
 insert into public.designpro_flat_atlas_revisions(id,request_id,generation_id,owner_id,tenant_key,parent_revision_id,revision_sequence,
   guide_storage_path,guide_content_hash,guide_byte_size,guide_content_type,
   manifest_storage_path,manifest_content_hash,manifest_byte_size,manifest_content_type,
   master_storage_path,master_content_hash,master_byte_size,master_content_type,
   projection_storage_path,projection_content_hash,projection_byte_size,projection_content_type,
   manifest,metadata,model,prompt_version,width_px,height_px,effective_ppi)
 values(p_atlas_id,r.id,r.generation_id,r.owner_id,r.tenant_key,r.parent_atlas_revision_id,r.revision_sequence,
   p||'/guide/'||h||'.png',h,4096,'image/png',p||'/manifest/'||h||'.json',h,4096,'application/json',
   p||'/master/'||h||'.png',h,4096,'image/png',p||'/projection/'||h||'.jpg',h,4096,'image/jpeg',
   '{}',jsonb_build_object('revisionContextHash',r.revision_context_hash,'masterQcPassed',true,
     'callOnePanels',(select jsonb_agg(jsonb_build_object('surfaceKey',s,'sourceMasterHash',h))
       from unnest(array['driver','passenger','hood','roof','front','rear']) s)),
   'fixture-provider','identity-fixture.v1',4096,4096,20);
 return p_atlas_id;
end$$;
create function pg_temp.identity_views(p_request_id uuid) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('sourceViewType',v->>'sourceViewType','consumerRole',v->>'consumerRole',
   'storagePath','designpro/'||r.tenant_key||'/'||r.generation_id||'/calls-1-7/'||(v->>'sourceViewType')||'/'||encode(extensions.digest(convert_to(v->>'sourceViewType','UTF8'),'sha256'),'hex')||'.png',
   'contentHash',encode(extensions.digest(convert_to(v->>'sourceViewType','UTF8'),'sha256'),'hex'),'byteSize',4096,'contentType','image/png',
   'metadata',jsonb_build_object('authority',jsonb_build_object('revisionId',a.id),
     'provider',jsonb_build_object('atlasRevisionId',a.id,'atlasMasterContentHash',a.master_content_hash))))
 from public.designpro_generation_requests r join public.designpro_flat_atlas_revisions a on a.request_id=r.id
 cross join jsonb_array_elements(designpro_private.calls_1_7_view_plan()) v where r.id=p_request_id
$$;
create function pg_temp.identity_receipt(p_request_id uuid,p_handoff uuid) returns jsonb language sql as $$
 select jsonb_build_object('contractVersion','designpro.calls-1-7-receipt.v1','sourceCommit',r.engine_contract->>'sourceCommit',
   'frozenContractHash',r.engine_contract_hash,'inputHash',r.input_hash,'byteVerified',true,'callsCompleted',7,
   'handoffRevisionId',p_handoff,'flatAtlas',jsonb_build_object('revisionId',a.id,'masterContentHash',a.master_content_hash),
   'providerResult','current-receipt-only')
 from public.designpro_generation_requests r join public.designpro_flat_atlas_revisions a on a.request_id=r.id where r.id=p_request_id
$$;

select ok(designpro_private.atlas_identity_fence_ready(),'new RPC grants and all persistence fences are present');
revoke execute on function public.claim_designpro_generation_request_v2(text,integer) from service_role;
select ok(not designpro_private.atlas_identity_fence_ready(),'missing v2 claim capability cannot pass readiness');
grant execute on function public.claim_designpro_generation_request_v2(text,integer) to service_role;
select ok(designpro_private.atlas_identity_fence_ready(),'restoring the exact service grant restores readiness');
select ok(not has_function_privilege('anon','public.create_designpro_flat_first_generation_request_v2(uuid,jsonb,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.claim_designpro_generation_request_v2(text,integer)','EXECUTE')
 and not has_function_privilege('authenticated','public.enqueue_designpro_atlas_revision_v2(uuid,uuid,jsonb,text)','EXECUTE'),
 'admission keeps original authentication and private worker permissions');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1111111-1111-4111-8111-111111111111"}',true);
insert into identity_results values('new',public.create_designpro_flat_first_generation_request_v2('c3333333-3333-4333-8333-333333333333',pg_temp.identity_input(),null));
select ok(pg_temp.identity_result('new')->>'atlasRevisionId' is not null
 and pg_temp.identity_result('new')->>'atlasRevisionId'<>pg_temp.identity_result('new')->>'handoffRevisionId',
 'acceptance reserves distinct artwork and manufacturing UUIDs before Call 1');
select is(pg_temp.identity_result('new')->>'designId','DID-C3333333','accepted DID derives from the existing GenerationID');
select is((select count(*)::int from public.designpro_flat_atlas_revisions),0,'reserving identity does not pretend artwork already exists');
select throws_ok($$update public.designpro_generation_requests set engine_receipt=engine_receipt-'atlasIdentityContract' where id=(pg_temp.identity_result('new')->>'requestId')::uuid$$,
 'P0001','generation_reserved_identity_is_immutable','receipt updates cannot downgrade a v2 reservation to bypass its guards');
select throws_ok($$update public.designpro_generation_requests set engine_receipt=jsonb_set(engine_receipt,'{atlasRevisionId}','"e7777777-7777-4777-8777-777777777777"') where id=(pg_temp.identity_result('new')->>'requestId')::uuid$$,
 'P0001','generation_reserved_identity_is_immutable','accepted artwork reservation cannot be reassigned before Call 1');
insert into identity_results values('replay',public.create_designpro_flat_first_generation_request_v2('c3333333-3333-4333-8333-333333333333',pg_temp.identity_input(),null));
select is(pg_temp.identity_result('new')->>'atlasRevisionId',pg_temp.identity_result('replay')->>'atlasRevisionId','idempotent submit preserves artwork identity');
select is(pg_temp.identity_result('new')->>'handoffRevisionId',pg_temp.identity_result('replay')->>'handoffRevisionId','idempotent submit preserves manufacturing identity');
select is(pg_temp.identity_result('new')->>'atlasIdentityMintedAt',pg_temp.identity_result('replay')->>'atlasIdentityMintedAt','idempotent submit preserves original reservation time');
select throws_ok($$select public.create_designpro_flat_first_generation_request_v2('c3333333-3333-4333-8333-333333333333',pg_temp.identity_input()||'{"brief":"different artwork"}',null)$$,
 'P0001','generation_input_conflict','new wrapper retains original input conflict guard');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b2222222-2222-4222-8222-222222222222"}',true);
insert into identity_results values('legacy',public.create_designpro_flat_first_generation_request('d4444444-4444-4444-8444-444444444444',pg_temp.identity_input(),null));
select is(pg_temp.identity_result('legacy')->>'atlasIdentityContract','designpro.atlas-identity-at-prompt.v1','old gateway still admits v1 safely after migration');
select ok(not (pg_temp.identity_result('legacy')?'atlasRevisionId'),'v1 handoff is no longer mislabeled as real artwork');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into identity_results values('oldclaim',public.claim_designpro_generation_request('old-worker-fixture',600));
select is(pg_temp.identity_result('oldclaim')->>'requestId',pg_temp.identity_result('legacy')->>'requestId','old worker skips earlier queued v2 and claims v1');
select pg_temp.identity_atlas((pg_temp.identity_result('legacy')->>'requestId')::uuid,'e5555555-5555-4555-8555-555555555555');
insert into identity_results values('oldcomplete',public.complete_designpro_generation_request((pg_temp.identity_result('oldclaim')->>'requestId')::uuid,
 (pg_temp.identity_result('oldclaim')->>'claimToken')::uuid,pg_temp.identity_views((pg_temp.identity_result('oldclaim')->>'requestId')::uuid),
 pg_temp.identity_receipt((pg_temp.identity_result('oldclaim')->>'requestId')::uuid,'f6666666-6666-4666-8666-666666666666')));
select is(pg_temp.identity_result('oldcomplete')->>'state','outputs_ready','migration-only state lets old worker complete with its legacy handoff');
select is((select engine_receipt->>'handoffRevisionId' from public.designpro_generation_requests where id=(pg_temp.identity_result('legacy')->>'requestId')::uuid),
 'f6666666-6666-4666-8666-666666666666','legacy completion preserves actual old-worker handoff rather than its unused seed');
select is((select engine_receipt->>'atlasIdentityMintedAt' from public.designpro_generation_requests where id=(pg_temp.identity_result('legacy')->>'requestId')::uuid),
 pg_temp.identity_result('legacy')->>'atlasIdentityMintedAt','completion retains original known identity metadata');

select is(public.claim_designpro_generation_request('old-worker-fixture',600),null::jsonb,'rollback worker leaves queued v2 requests recoverable');
insert into identity_results values('claim1',public.claim_designpro_generation_request_v2('new-worker-fixture',600));
select is(pg_temp.identity_result('claim1')->>'atlasRevisionId',pg_temp.identity_result('new')->>'atlasRevisionId','new worker claims the reserved actual ATLAS UUID');
select is(pg_temp.identity_result('claim1')->>'handoffRevisionId',pg_temp.identity_result('new')->>'handoffRevisionId','new worker claims the reserved handoff UUID');
update public.designpro_generation_requests set lease_expires_at=clock_timestamp()-interval '1 second' where id=(pg_temp.identity_result('new')->>'requestId')::uuid;
select is(public.claim_designpro_generation_request('old-worker-fixture',600),null::jsonb,'old worker also skips an expired v2 lease');
insert into identity_results values('claim2',public.claim_designpro_generation_request_v2('new-worker-fixture',600));
select is(pg_temp.identity_result('claim2')->>'atlasRevisionId',pg_temp.identity_result('claim1')->>'atlasRevisionId','expired lease recovery retains artwork UUID');
select is(pg_temp.identity_result('claim2')->>'atlasIdentityMintedAt',pg_temp.identity_result('new')->>'atlasIdentityMintedAt','lease recovery never rewrites reservation time');
select throws_ok($$select pg_temp.identity_atlas((pg_temp.identity_result('new')->>'requestId')::uuid,'e7777777-7777-4777-8777-777777777777')$$,
 'P0001','flat_atlas_reserved_revision_conflict','Call 1 cannot save artwork under an unreserved UUID');
select pg_temp.identity_atlas((pg_temp.identity_result('new')->>'requestId')::uuid,(pg_temp.identity_result('new')->>'atlasRevisionId')::uuid);
select throws_ok($$select public.complete_designpro_generation_request((pg_temp.identity_result('claim2')->>'requestId')::uuid,
 (pg_temp.identity_result('claim2')->>'claimToken')::uuid,pg_temp.identity_views((pg_temp.identity_result('claim2')->>'requestId')::uuid),
 pg_temp.identity_receipt((pg_temp.identity_result('claim2')->>'requestId')::uuid,'e7777777-7777-4777-8777-777777777777'))$$,
 'P0001','generation_handoff_identity_conflict','completion refuses a changed manufacturing handoff');
select throws_ok($$select public.complete_designpro_generation_request((pg_temp.identity_result('claim2')->>'requestId')::uuid,
 (pg_temp.identity_result('claim2')->>'claimToken')::uuid,pg_temp.identity_views((pg_temp.identity_result('claim2')->>'requestId')::uuid),
 jsonb_set(pg_temp.identity_receipt((pg_temp.identity_result('claim2')->>'requestId')::uuid,(pg_temp.identity_result('new')->>'handoffRevisionId')::uuid),
 '{flatAtlas,revisionId}','"e7777777-7777-4777-8777-777777777777"'))$$,
 'P0001','generation_atlas_identity_conflict','completion refuses another ATLAS even if seven proofs exist');
update public.designpro_generation_requests set engine_receipt=engine_receipt||'{"staleProviderField":"must-not-return"}'::jsonb where id=(pg_temp.identity_result('new')->>'requestId')::uuid;
insert into identity_results values('complete',public.complete_designpro_generation_request((pg_temp.identity_result('claim2')->>'requestId')::uuid,
 (pg_temp.identity_result('claim2')->>'claimToken')::uuid,pg_temp.identity_views((pg_temp.identity_result('claim2')->>'requestId')::uuid),
 pg_temp.identity_receipt((pg_temp.identity_result('claim2')->>'requestId')::uuid,(pg_temp.identity_result('new')->>'handoffRevisionId')::uuid)));
select is(pg_temp.identity_result('complete')->>'state','outputs_ready','same-identity seven-proof completion succeeds');
insert into identity_results select 'saved',engine_receipt from public.designpro_generation_requests where id=(pg_temp.identity_result('new')->>'requestId')::uuid;
select is(pg_temp.identity_result('saved')->>'atlasRevisionId',pg_temp.identity_result('new')->>'atlasRevisionId','finished receipt retains acceptance artwork UUID');
select is(pg_temp.identity_result('saved')->>'handoffRevisionId',pg_temp.identity_result('new')->>'handoffRevisionId','finished receipt retains acceptance manufacturing UUID');
select is(pg_temp.identity_result('saved')->>'atlasIdentityMintedAt',pg_temp.identity_result('new')->>'atlasIdentityMintedAt','finished receipt retains original mint time');
select ok(not(pg_temp.identity_result('saved')?'staleProviderField') and pg_temp.identity_result('saved')->>'providerResult'='current-receipt-only',
 'only identity metadata merges; new provider receipt stays authoritative');
select is((select count(*)::int from public.designpro_generation_views where request_id=(pg_temp.identity_result('new')->>'requestId')::uuid),7,'all seven existing proof roles remain recorded');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1111111-1111-4111-8111-111111111111"}',true);
select is(public.get_designpro_generation_request((pg_temp.identity_result('new')->>'requestId')::uuid)->>'atlasRevisionId',
 pg_temp.identity_result('new')->>'atlasRevisionId','owner read projects the same saved artwork identity');
insert into identity_results values('completedReplay',public.create_designpro_flat_first_generation_request_v2('c3333333-3333-4333-8333-333333333333',pg_temp.identity_input(),null));
select is(pg_temp.identity_result('completedReplay')->>'atlasIdentityMintedAt',pg_temp.identity_result('new')->>'atlasIdentityMintedAt','completed idempotent retry does not reserve another design');
select ok(designpro_private.atlas_identity_fence_ready(),'all fences remain ready after real create, claim, retry and complete operations');
select is((select count(*)::int from public.designpro_generation_requests),2,'no replacement GenerationID or legacy design table was created');
select * from finish();
rollback;
