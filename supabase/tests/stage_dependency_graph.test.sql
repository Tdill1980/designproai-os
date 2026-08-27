-- THE CHAIN IS DEAD. THE EDGES DECIDE.
--
-- Owner, 2026-08-27: "DesignProAI ATLAS runtime is a stateful streaming
-- execution graph... Independent nodes execute concurrently. Dependencies are
-- per artifact, never global stage order... the claim_designpro_stage
-- predecessor chain is precisely what needs to die because it is implementing a
-- linear state machine where you designed a dependency graph."
--
-- 20260827110000 replaced `p.sequence<s.sequence` with the stage's own declared
-- edges. This proves the behaviour on a disposable database with REAL stage
-- keys -- which is why it lives here and not in the migration: the live table
-- carries `designpro_workflow_stages_stage_key_check`, enumerating the valid
-- keys, and `designpro_stage_completion_integrity`, refusing status='completed'
-- without `completed_at` and a verified receipt. A probe row invented inside
-- the migration would have failed the apply.
begin;
select plan(12);

select has_column('public','designpro_workflow_stages','depends_on',
  'a stage declares its own edges');
select col_not_null('public','designpro_workflow_stages','depends_on',
  'edges are never null; an empty array is the pre-graph case');

-- The predicate itself.
select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.claim_designpro_stage(text,integer)')), 'pg_catalog.unnest(s.depends_on)') > 0,
  'the claim reads declared edges'
);
select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.claim_designpro_stage(text,integer)')), 'production-heavy') > 0,
  'the shared heavy lease survives, so output/verify/zip stay mutually exclusive'
);
select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.claim_designpro_stage(text,integer)')), 'SKIP LOCKED') > 0,
  'SKIP LOCKED survives, which is what makes two workers two claims'
);
select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.claim_designpro_stage(text,integer)')),
    'await_panelpro_preflight_qc'',''await_final_human_qc') > 0,
  'the two human gates are still unclaimable by any worker'
);

-- ── A REAL RUN, REAL STAGE KEYS ────────────────────────────────────────────
insert into public.designpro_workflow_runs(
  id,workflow_type,owner_id,tenant_key,idempotency_key,status,revision_id,
  revision_snapshot_hash,entice_pack_id,source_contract_hash,manifest_hash,
  artifact_set_hash,input,results
) values (
  '71000000-0000-4000-8000-000000000001','designpro.entice_pack',
  '71000000-0000-4000-8000-0000000000a1','user_71000000-0000-4000-8000-0000000000a1',
  'graph-edges-fixture','running','71000000-0000-4000-8000-0000000000b1',
  repeat('a',64),'71000000-0000-4000-8000-0000000000c1',
  repeat('b',64),repeat('c',64),repeat('d',64),'{}'::jsonb,'{}'::jsonb
);

-- The entice graph, as 20260827110000 declares it. `proof.build` and
-- `panels.build` are SIBLINGS: both depend only on the root, neither on the
-- other. Under the old chain, panels.build (sequence 20) waited on proof.build
-- (sequence 10) for no reason but its line number.
insert into public.designpro_workflow_stages(
  run_id,stage_key,sequence,status,idempotency_key,depends_on
) values
  ('71000000-0000-4000-8000-000000000001','revision.freeze',0,'pending','g:freeze','{}'::text[]),
  ('71000000-0000-4000-8000-000000000001','proof.build',10,'pending','g:proof',ARRAY['revision.freeze']),
  ('71000000-0000-4000-8000-000000000001','panels.build',20,'pending','g:panels',ARRAY['revision.freeze']),
  ('71000000-0000-4000-8000-000000000001','logos.extract',30,'pending','g:logos',ARRAY['panels.build']);

-- The predicate the claim uses, as a plain read.
create or replace function pg_temp.runnable(p_run uuid) returns text[] language sql as $r$
  select coalesce(array_agg(s.stage_key order by s.sequence), '{}'::text[])
  from public.designpro_workflow_stages s
  where s.run_id=p_run
    and s.status in ('pending','retryable')
    and (case
      when pg_catalog.array_length(s.depends_on,1) is null
      then not exists (select 1 from public.designpro_workflow_stages p
        where p.run_id=s.run_id and p.sequence<s.sequence
          and p.status not in ('completed','skipped'))
      else not exists (
        select 1 from pg_catalog.unnest(s.depends_on) as dep(stage_key)
        where not exists (select 1 from public.designpro_workflow_stages p
          where p.run_id=s.run_id and p.stage_key=dep.stage_key
            and p.status in ('completed','skipped')))
    end);
$r$;

select is(
  pg_temp.runnable('71000000-0000-4000-8000-000000000001'),
  ARRAY['revision.freeze'],
  'only the root is runnable before anything completes'
);

-- Finish the root, satisfying designpro_stage_completion_integrity.
update public.designpro_workflow_stages
set status='completed', completed_at=clock_timestamp(),
    verification='{"verified": true}'::jsonb
where run_id='71000000-0000-4000-8000-000000000001' and stage_key='revision.freeze';

select is(
  pg_temp.runnable('71000000-0000-4000-8000-000000000001'),
  ARRAY['proof.build','panels.build'],
  'the proof and the panels are siblings and become runnable TOGETHER'
);

-- Finish the panels while the proof is still pending -- which the old chain
-- made impossible, because panels.build sat at a higher sequence.
update public.designpro_workflow_stages
set status='completed', completed_at=clock_timestamp(),
    verification='{"verified": true}'::jsonb
where run_id='71000000-0000-4000-8000-000000000001' and stage_key='panels.build';

select is(
  pg_temp.runnable('71000000-0000-4000-8000-000000000001'),
  ARRAY['proof.build','logos.extract'],
  'logo extraction follows its panels and does NOT wait on the 2D proof'
);

-- ── FAIL CLOSED ON A NAME THAT IS NOT THERE ────────────────────────────────
insert into public.designpro_workflow_stages(
  run_id,stage_key,sequence,status,idempotency_key,depends_on
) values
  ('71000000-0000-4000-8000-000000000001','pack.verify',40,'pending','g:verify',
   ARRAY['panels.build','stamp.build']);

select ok(
  not ('pack.verify' = any(pg_temp.runnable('71000000-0000-4000-8000-000000000001'))),
  'a named dependency absent from the run fails CLOSED, never vacuously true'
);

-- ── THE PRE-GRAPH ARM STILL WORKS, SO IN-FLIGHT RUNS DRAIN ─────────────────
insert into public.designpro_workflow_runs(
  id,workflow_type,owner_id,tenant_key,idempotency_key,status,revision_id,
  revision_snapshot_hash,entice_pack_id,source_contract_hash,manifest_hash,
  artifact_set_hash,input,results
) values (
  '72000000-0000-4000-8000-000000000001','designpro.entice_pack',
  '71000000-0000-4000-8000-0000000000a1','user_71000000-0000-4000-8000-0000000000a1',
  'graph-legacy-fixture','running','72000000-0000-4000-8000-0000000000b1',
  repeat('a',64),'72000000-0000-4000-8000-0000000000c1',
  repeat('b',64),repeat('c',64),repeat('d',64),'{}'::jsonb,'{}'::jsonb
);
insert into public.designpro_workflow_stages(
  run_id,stage_key,sequence,status,idempotency_key,depends_on
) values
  ('72000000-0000-4000-8000-000000000001','revision.freeze',0,'pending','l:freeze','{}'::text[]),
  ('72000000-0000-4000-8000-000000000001','proof.build',10,'pending','l:proof','{}'::text[]),
  ('72000000-0000-4000-8000-000000000001','panels.build',20,'pending','l:panels','{}'::text[]);

select is(
  pg_temp.runnable('72000000-0000-4000-8000-000000000001'),
  ARRAY['revision.freeze'],
  'a row with no declared edges keeps the sequence barrier it started under'
);

update public.designpro_workflow_stages
set status='completed', completed_at=clock_timestamp(),
    verification='{"verified": true}'::jsonb
where run_id='72000000-0000-4000-8000-000000000001' and stage_key='revision.freeze';

select is(
  pg_temp.runnable('72000000-0000-4000-8000-000000000001'),
  ARRAY['proof.build'],
  'and it advances one at a time, exactly as it did before, until it drains'
);

select * from finish();
rollback;
