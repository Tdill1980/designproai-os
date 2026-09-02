-- The panel data slug is a required QC evidence key on both human gates, and
-- the panel map is a storable artifact kind (20260903000000).
--
-- These read the LIVE function body back, because the migration text-patches
-- it: a search string that matched proves nothing about what was left behind.
-- Calling approve_designpro_human_gate for real needs a complete paid
-- production run behind it (a frozen revision, a bound order, source.verify
-- completed); that fixture is atlas_stage_contract's and is not repeated here,
-- so this test proves the contract text and the parse, not the live refusal.

begin;
select plan(6);

select ok(
  position('"panelDataSlugVerified":true' in pg_get_functiondef(
    'public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'::regprocedure)) > 0,
  'PanelPro preflight requires panelDataSlugVerified'
);
select ok(
  position('"productionSlugVerified":true' in pg_get_functiondef(
    'public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'::regprocedure)) > 0,
  'final production QC requires productionSlugVerified'
);
select ok(
  position('"textLockVerified":true}' in pg_get_functiondef(
    'public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'::regprocedure)) = 0,
  'the six-key preflight literal no longer exists on its own'
);
select ok(
  position('"colorModeVerified":true}' in pg_get_functiondef(
    'public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'::regprocedure)) = 0,
  'the three-key final literal no longer exists on its own'
);
select ok(
  position('panelpro_preflight_evidence_incomplete' in pg_get_functiondef(
    'public.approve_designpro_human_gate(uuid,text,uuid,text,jsonb)'::regprocedure)) > 0,
  'incomplete preflight evidence still raises panelpro_preflight_evidence_incomplete'
);
select ok(
  pg_get_constraintdef((select oid from pg_constraint where conname = 'designpro_artifacts_artifact_kind_check'))
    like '%''panel-map''%',
  'panel-map is a designpro_artifacts kind'
);

select * from finish();
rollback;
