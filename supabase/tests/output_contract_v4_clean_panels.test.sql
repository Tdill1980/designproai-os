-- The paid output contract admits v4 (five formats x branded/clean x six
-- surfaces = 60), v3 (five formats, 30) and keeps v2 (24) and the legacy
-- null-contract build (18) exactly as accepted before (migration
-- 20260922060000).
--
-- Measured defect, 2026-09-22: PR #600's runtime emits
-- `designpro.production-formats.v3` and the 20260920113000 gate pins v2 by
-- name, so every paid build it produces dies at output.build on
-- production_pdf_output_build_required. The same migration ships v4 -- the
-- Zone 2 clean panel of the three-zone Production Panel Proof becomes its own
-- print file per surface -- and the `upscaled-clean-panel` artifact kind that
-- carries the Topaz-enhanced clean panel.
--
-- Like atlas_stage_contract.test.sql this exercises the REAL functions over
-- REAL rows: the output.build gate `assert_production_output_build` is called
-- with fixtures for every contract, the four completed-build readers are read
-- over completed output.build stages, and the text-patched output.verify block
-- of complete_designpro_stage is asserted on the installed body -- because a
-- patch whose search strings all matched can still leave the wrong code behind
-- (CLAUDE.md, "PATCHING LIVE PL/pgSQL").

begin;
select plan(53);

-- 1. The helpers exist and only the service role may call them.
select has_function('designpro_private','production_output_contract',ARRAY['uuid'],
  'the one validator of a completed build receipt exists');
select has_function('designpro_private','production_output_variants',ARRAY['uuid'],
  'the variant reader exists');
select has_function('designpro_private','production_output_file_count',ARRAY['uuid'],
  'the file-count reader exists');
select has_function('designpro_private','production_output_formats',ARRAY['uuid'],
  'the format reader still exists');
select ok(not has_function_privilege('authenticated',
  'designpro_private.production_output_variants(uuid)','EXECUTE'),
  'browsers cannot read the variant set');
select ok(not has_function_privilege('authenticated',
  'designpro_private.production_output_file_count(uuid)','EXECUTE'),
  'browsers cannot read the file count');
select ok(not has_function_privilege('anon',
  'designpro_private.production_output_contract(uuid)','EXECUTE'),
  'anonymous callers cannot read the build contract');
select ok(not has_function_privilege('authenticated',
  'designpro_private.assert_production_output_build(uuid,jsonb,text,jsonb)','EXECUTE'),
  'browsers cannot call the output.build gate');
select ok(has_function_privilege('service_role',
  'designpro_private.production_output_variants(uuid)','EXECUTE'),
  'the service role reads the variant set');

-- 2. The artifact kind CHECK admits the enhanced clean panel and nothing else new.
select ok(
  pg_get_constraintdef((select oid from pg_catalog.pg_constraint
    where conname='designpro_artifacts_artifact_kind_check'
      and conrelid='public.designpro_artifacts'::regclass))
    like '%''upscaled-clean-panel''%',
  'designpro_artifacts admits upscaled-clean-panel'
);
select ok(
  (select count(*) from pg_catalog.regexp_matches(
    pg_get_constraintdef((select oid from pg_catalog.pg_constraint
      where conname='designpro_artifacts_artifact_kind_check'
        and conrelid='public.designpro_artifacts'::regclass)),
    '''(flat-proof|panel|qc-panel|corrected-panel|upscaled-panel|upscaled-clean-panel|logo|output|stamp|zip|wrapbox-manifest)''','g'))=11,
  'every existing artifact kind keeps its place beside the new one'
);

-- ── FIXTURES ────────────────────────────────────────────────────────────────
--
-- Six production_pack runs, each with a completed await_purchase gate. Direct
-- inserts are legal here: the OS-event triggers skip a run with no revision
-- source, the storage-identity trigger only asks that an artifact live under
-- designpro/<tenant>/<run>/, and the run phase CHECK lets a production run
-- carry no manifest pair (RULE 0.19, GENIE deploys on order).
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values(
  '00000000-0000-0000-0000-000000000000',
  '91000000-0000-4000-8000-0000000000a1','authenticated','authenticated',
  'output-v4@designproai.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()
) on conflict(id) do nothing;

select set_config('request.jwt.claims','{"role":"service_role"}',true);

create or replace function pg_temp.sha(p text) returns text language sql immutable as $sha$
  select encode(extensions.digest(convert_to(p,'UTF8'),'sha256'),'hex');
$sha$;

create or replace function pg_temp.run(p_id uuid,p_key text) returns void language sql as $r$
  insert into public.designpro_workflow_runs(
    id,workflow_type,owner_id,tenant_key,idempotency_key,status,revision_id,
    revision_snapshot_hash,entice_pack_id,source_contract_hash,artifact_set_hash,input,results
  ) values (
    p_id,'designpro.production_pack',
    '91000000-0000-4000-8000-0000000000a1','user_91000000-0000-4000-8000-0000000000a1',
    'output-v4:'||p_key,'running','91000000-0000-4000-8000-0000000000b1',
    repeat('a',64),'91000000-0000-4000-8000-0000000000c1',
    repeat('b',64),repeat('d',64),'{}'::jsonb,'{}'::jsonb
  );
$r$;

-- The frozen purchase. p_legacy writes the manifest the 18-file era wrote:
-- no outputFormatContract at all.
create or replace function pg_temp.gate(p_run uuid,p_authorized boolean,p_legacy boolean default false)
returns uuid language sql as $g$
  insert into public.designpro_workflow_stages(
    run_id,stage_key,sequence,status,idempotency_key,output,verification,completed_at
  ) values (
    p_run,'await_purchase',0,'completed',p_run::text||':await_purchase',
    jsonb_build_object('authorizedAssetManifest',
      jsonb_build_object('productionPackAuthorized',p_authorized,'requiredOutputFiles',
        case when p_legacy then 18 else 0 end)
      || case when p_legacy then '{}'::jsonb
         else '{"outputFormatContract":"designpro.production-formats"}'::jsonb end),
    '{"verified":true}'::jsonb,clock_timestamp()
  ) returning id;
$g$;

-- The output artifact set for a contract, surface-major then variant then
-- format, so an index into it is deterministic: driver's clean pdf on v4 is 8.
-- pdf and jpg bind to the png of the same surface AND variant; a v2/v3 set
-- carries no variant key at all, exactly as those runtimes emit it.
create or replace function pg_temp.outputs(p_run uuid,p_formats text[],p_variants text[])
returns jsonb language sql immutable as $o$
  select jsonb_agg(jsonb_build_object(
    'kind','output','surfaceKey',s.k,
    'contentHash',pg_temp.sha(p_run::text||s.k||v.k||f.k),
    'storagePath','designpro/user_91000000-0000-4000-8000-0000000000a1/'||p_run::text
      ||'/output/'||s.k||case when v.k='clean' then '-clean' else '' end||'.'||f.k,
    'byteSize',456,
    'metadata',jsonb_build_object('format',f.k)
      || case when cardinality(p_variants)>1 then jsonb_build_object('variant',v.k) else '{}'::jsonb end
      || case when f.k in ('pdf','jpg')
           then jsonb_build_object('sourcePngHash',pg_temp.sha(p_run::text||s.k||v.k||'png'))
           else '{}'::jsonb end
  ) order by s.o,v.o,f.o)
  from (values ('driver',1),('passenger',2),('hood',3),('roof',4),('front',5),('rear',6)) s(k,o)
  cross join unnest(p_variants) with ordinality v(k,o)
  cross join unnest(p_formats) with ordinality f(k,o);
$o$;

create or replace function pg_temp.receipt(p_contract text,p_formats text[],p_variants text[],p_artifacts jsonb)
returns jsonb language sql immutable as $b$
  select jsonb_build_object('verified',true,'outputFormatContract',p_contract,
    'outputFormats',to_jsonb(p_formats),'outputCount',jsonb_array_length(p_artifacts),
    'outputSetHash',pg_temp.sha(p_artifacts::text))
  || case when cardinality(p_variants)>1 then jsonb_build_object('outputVariants',to_jsonb(p_variants))
     else '{}'::jsonb end;
$b$;

create or replace function pg_temp.check_build(p_run uuid,p_receipt jsonb,p_artifacts jsonb)
returns void language sql as $c$
  select designpro_private.assert_production_output_build(
    p_run,p_receipt,designpro_private.atlas_revision_hash(p_receipt),p_artifacts);
$c$;

select pg_temp.run('91000000-0000-4000-8000-000000000001','v4');
select pg_temp.run('91000000-0000-4000-8000-000000000002','v3');
select pg_temp.run('91000000-0000-4000-8000-000000000003','v2');
select pg_temp.run('91000000-0000-4000-8000-000000000004','legacy');
select pg_temp.run('91000000-0000-4000-8000-000000000005','unpurchased');
select pg_temp.run('91000000-0000-4000-8000-000000000006','invalid');

create temporary table gates on commit drop as
select pg_temp.gate('91000000-0000-4000-8000-000000000001',true) as v4,
       pg_temp.gate('91000000-0000-4000-8000-000000000002',true) as v3,
       pg_temp.gate('91000000-0000-4000-8000-000000000003',true) as v2,
       pg_temp.gate('91000000-0000-4000-8000-000000000004',true,true) as legacy,
       pg_temp.gate('91000000-0000-4000-8000-000000000005',false) as unpurchased,
       pg_temp.gate('91000000-0000-4000-8000-000000000006',true) as invalid;

create temporary table sets on commit drop as
select pg_temp.outputs('91000000-0000-4000-8000-000000000001',
         ARRAY['png','tiff','eps','pdf','jpg'],ARRAY['branded','clean']) as v4,
       pg_temp.outputs('91000000-0000-4000-8000-000000000002',
         ARRAY['png','tiff','eps','pdf','jpg'],ARRAY['branded']) as v3,
       pg_temp.outputs('91000000-0000-4000-8000-000000000003',
         ARRAY['png','tiff','eps','pdf'],ARRAY['branded']) as v2;

create temporary table receipts on commit drop as
select pg_temp.receipt('designpro.production-formats.v4',ARRAY['png','tiff','eps','pdf','jpg'],
         ARRAY['branded','clean'],(select v4 from sets)) as v4,
       pg_temp.receipt('designpro.production-formats.v3',ARRAY['png','tiff','eps','pdf','jpg'],
         ARRAY['branded'],(select v3 from sets)) as v3,
       pg_temp.receipt('designpro.production-formats.v2',ARRAY['png','tiff','eps','pdf'],
         ARRAY['branded'],(select v2 from sets)) as v2;

select is(jsonb_array_length((select v4 from sets)),60,'a v4 fixture is sixty artifacts');
select is(jsonb_array_length((select v3 from sets)),30,'a v3 fixture is thirty artifacts');
select is(jsonb_array_length((select v2 from sets)),24,'a v2 fixture is twenty-four artifacts');
select is((select v4->8->>'surfaceKey' from sets)||'/'||(select v4->8#>>'{metadata,variant}' from sets)
  ||'/'||(select v4->8#>>'{metadata,format}' from sets),'driver/clean/pdf',
  'index 8 of the v4 set is the driver clean pdf, so the cross-binding case below edits the right file');

-- 3. A real clean panel row lands under the new kind; an invented kind does not.
select lives_ok($k1$
  insert into public.designpro_artifacts(run_id,stage_id,artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata)
  values('91000000-0000-4000-8000-000000000001',(select v4 from gates),'upscaled-clean-panel','driver',
    'designpro/user_91000000-0000-4000-8000-0000000000a1/91000000-0000-4000-8000-000000000001/enhanced/driver-clean.png',
    repeat('e',64),4096,'{"variant":"clean","zone":2}'::jsonb)
$k1$,'an upscaled-clean-panel artifact is admitted');
select throws_ok($k2$
  insert into public.designpro_artifacts(run_id,stage_id,artifact_kind,surface_key,storage_path,content_hash,byte_size)
  values('91000000-0000-4000-8000-000000000001',(select v4 from gates),'zone2-panel','driver',
    'designpro/user_91000000-0000-4000-8000-0000000000a1/91000000-0000-4000-8000-000000000001/enhanced/driver-zone2.png',
    repeat('f',64),4096)
$k2$,'23514',NULL,'an artifact kind the contract does not name is still refused');

-- 4. The output.build gate, contract by contract.
select lives_ok($b1$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000003',(select v2 from receipts),(select v2 from sets))
$b1$,'v2: twenty-four files are accepted exactly as before');
select throws_ok($b2$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000003',(select v2 from receipts),(select v2 from sets)-23)
$b2$,'production_pdf_output_artifact_set_required','v2: twenty-three files are refused exactly as before');
select lives_ok($b3$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000002',(select v3 from receipts),(select v3 from sets))
$b3$,'v3: thirty files (png/tiff/eps/pdf/jpg, no variants) are accepted -- what PR #600 emits');
select throws_ok($b4$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000002',(select v3 from receipts),
    jsonb_set((select v3 from sets),'{4,metadata,sourcePngHash}',to_jsonb(repeat('9',64))))
$b4$,'production_pdf_output_artifact_set_required','v3: a jpg not rasterised from its own png is refused');
select lives_ok($b5$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000001',(select v4 from receipts),(select v4 from sets))
$b5$,'v4: sixty files -- five formats x branded/clean x six surfaces -- are accepted');
select throws_ok($b6$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000001',(select v4 from receipts),(select v4 from sets)-59)
$b6$,'production_pdf_output_artifact_set_required','v4: fifty-nine files are refused');
select throws_ok($b7$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000001',(select v4 from receipts),
    jsonb_set((select v4 from sets),'{7,metadata,variant}','"cleen"'::jsonb))
$b7$,'production_pdf_output_artifact_set_required','v4: a variant outside branded|clean is refused');
select throws_ok($b8$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000001',(select v4 from receipts),
    jsonb_set((select v4 from sets),'{8,metadata,sourcePngHash}',
      to_jsonb(pg_temp.sha('91000000-0000-4000-8000-000000000001'||'driver'||'branded'||'png'))))
$b8$,'production_pdf_output_artifact_set_required',
  'v4: a clean pdf rasterised from the BRANDED png of its surface is refused -- same surface is not enough');
select throws_ok($b9$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000001',(select v4 from receipts),
    jsonb_set((select v4 from sets),'{9,metadata,variant}','"branded"'::jsonb))
$b9$,'production_pdf_output_artifact_set_required',
  'v4: sixty files that cover only fifty-nine (surface, variant, format) triples are refused');
select throws_ok($b10$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000001',(select v4 from receipts)-'outputVariants',(select v4 from sets))
$b10$,'production_pdf_output_build_required','v4: a build receipt that does not declare its variants is refused');
select throws_ok($b11$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000001',
    (select v4 from receipts)||'{"outputCount":30}'::jsonb,(select v4 from sets))
$b11$,'production_pdf_output_build_required','v4: a receipt whose count disagrees with its contract is refused');
select throws_ok($b12$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000001',
    (select v4 from receipts)||'{"outputFormatContract":"designpro.production-formats.v9"}'::jsonb,(select v4 from sets))
$b12$,'production_pdf_output_build_required','an unknown contract is refused by name');
select throws_ok($b13$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000002',(select v3 from receipts),(select v4 from sets))
$b13$,'production_pdf_output_artifact_set_required','v3: a sixty-file set under a thirty-file receipt is refused');
select lives_ok($b14$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000005',
    '{"verified":true,"outputCount":0,"skippedUnpurchased":["output"]}'::jsonb,'[]'::jsonb)
$b14$,'unpurchased: the zero-output receipt is accepted unchanged');
select throws_ok($b15$
  select pg_temp.check_build('91000000-0000-4000-8000-000000000005',
    '{"verified":true,"outputCount":0,"skippedUnpurchased":["output"]}'::jsonb,(select v2 from sets)-23-22-21)
$b15$,'output_unpurchased_present','unpurchased: any output artifact is refused unchanged');

-- 5. The completed-build readers, over real completed output.build stages.
create or replace function pg_temp.built(p_run uuid,p_receipt jsonb) returns void language sql as $bb$
  insert into public.designpro_workflow_stages(
    run_id,stage_key,sequence,status,idempotency_key,output,output_hash,verification,completed_at
  ) values (p_run,'output.build',10,'completed',p_run::text||':output.build',p_receipt,
    designpro_private.atlas_revision_hash(p_receipt),'{"verified":true}'::jsonb,clock_timestamp());
$bb$;
select pg_temp.built('91000000-0000-4000-8000-000000000001',(select v4 from receipts));
select pg_temp.built('91000000-0000-4000-8000-000000000002',(select v3 from receipts));
select pg_temp.built('91000000-0000-4000-8000-000000000003',(select v2 from receipts));
select pg_temp.built('91000000-0000-4000-8000-000000000004',
  jsonb_build_object('verified',true,'outputCount',18,'outputSetHash',repeat('c',64)));
select pg_temp.built('91000000-0000-4000-8000-000000000006',
  (select v4 from receipts)||'{"outputCount":30}'::jsonb);

select is(designpro_private.production_output_formats('91000000-0000-4000-8000-000000000001'),
  ARRAY['png','tiff','eps','pdf','jpg'],'v4 build: five formats');
select is(designpro_private.production_output_variants('91000000-0000-4000-8000-000000000001'),
  ARRAY['branded','clean'],'v4 build: two variants');
select is(designpro_private.production_output_file_count('91000000-0000-4000-8000-000000000001'),
  60,'v4 build: sixty files');
select is(designpro_private.production_output_formats('91000000-0000-4000-8000-000000000002'),
  ARRAY['png','tiff','eps','pdf','jpg'],'v3 build: five formats');
select is(designpro_private.production_output_variants('91000000-0000-4000-8000-000000000002'),
  ARRAY['branded'],'v3 build: branded only');
select is(designpro_private.production_output_file_count('91000000-0000-4000-8000-000000000002'),
  30,'v3 build: thirty files');
select is(designpro_private.production_output_formats('91000000-0000-4000-8000-000000000003'),
  ARRAY['png','tiff','eps','pdf'],'v2 build: four formats, as before');
select is(designpro_private.production_output_file_count('91000000-0000-4000-8000-000000000003'),
  24,'v2 build: twenty-four files, as before');
select is(designpro_private.production_output_formats('91000000-0000-4000-8000-000000000004'),
  ARRAY['png','tiff','eps'],'legacy build: three formats, as before');
select is(designpro_private.production_output_variants('91000000-0000-4000-8000-000000000004'),
  ARRAY['branded'],'legacy build: branded only');
select is(designpro_private.production_output_file_count('91000000-0000-4000-8000-000000000004'),
  18,'legacy build: eighteen files, as before');
select throws_ok($r1$
  select designpro_private.production_output_file_count('91000000-0000-4000-8000-000000000006')
$r1$,'output_build_format_contract_invalid','a completed build whose receipt contradicts its own contract resolves to nothing');
select throws_ok($r2$
  select designpro_private.production_output_variants('91000000-0000-4000-8000-000000000005')
$r2$,'output_build_receipt_invalid','a run with no completed build resolves to nothing');

-- 6. The installed output.verify block, read back off the live function.
create temporary table body on commit drop as
select pg_get_functiondef('public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'::regprocedure) as t;

select is(
  (select (length(t)-length(replace(t,'designpro_private.production_output_file_count(v_run.id)','')))
     /length('designpro_private.production_output_file_count(v_run.id)') from body),
  4,'every one of the four output.verify counts is the run''s own file count');
select is(
  (select position('(6*cardinality(designpro_private.production_output_formats(v_run.id)))' in t) from body),
  0,'no 6 x formats count survives -- that arithmetic ignored the variants');
select ok(
  (select position($v$count(DISTINCT (f->>'surfaceKey',COALESCE(f->>'variant','branded'),f->>'format'))$v$ in t)>0 from body),
  'the per-file DISTINCT keys on (surface, variant, format)');
select ok(
  (select position($v$p_receipt->'exactVariantSet' IS DISTINCT FROM to_jsonb(designpro_private.production_output_variants(v_run.id))$v$ in t)>0 from body),
  'the verify receipt must name the exact variant set when the contract has more than one');
select ok(
  (select position($v$CROSS JOIN unnest(designpro_private.production_output_variants(v_run.id)) variant$v$ in t)>0 from body),
  'the surface x format presence check also walks every variant');
select ok(
  (select position($v$COALESCE(a.metadata->>'variant','branded')=COALESCE(f->>'variant','branded')$v$ in t)>0 from body),
  'the artifact ledger join carries the variant');
select ok(
  (select position('assert_production_output_build(v_run.id,p_receipt,p_receipt_hash,p_artifacts)' in t)>0 from body),
  'output.build still runs through the gate this test exercised above');
select ok(
  (select position($v$ELSIF v_stage.stage_key='output.verify' THEN$v$ in t)
        < position('production_output_file_count' in t)
     and position('production_output_file_count' in t)
        < position($v$ELSIF v_stage.stage_key='stamp.build' THEN$v$ in t) from body),
  'the patch landed inside the output.verify block and nowhere else');

select * from finish();
rollback;
