begin;
select plan(12);

select has_table('public','designpro_generation_os_events',
  'Generation-ID OS event ledger exists');
select has_column('public','designpro_generation_os_events','generation_id',
  'every OS event is Generation-ID locked');
select has_column('public','designpro_generation_os_events','revision_id',
  'OS event can identify the exact A.T.L.A.S. revision');
select has_column('public','designpro_generation_os_events','run_id',
  'OS event can identify the exact workflow run');
select has_column('public','designpro_generation_os_events','stage_key',
  'OS event can identify the exact graph node');

select has_function('public','designpro_generation_os_snapshot',ARRAY['uuid'],
  'one canonical server snapshot backs every DesignProAI surface');
select has_function('designpro_private','designpro_generation_phase',ARRAY['uuid'],
  'canonical phase is derived from graph evidence');

select trigger_is(
  'public','designpro_flat_atlas_revisions','designpro_flat_atlas_revision_os_event',
  'designpro_private','log_designpro_atlas_revision_event',
  'A.T.L.A.S. revision creation is appended to Generation history'
);
select trigger_is(
  'public','designpro_workflow_runs','designpro_workflow_run_os_event_state',
  'designpro_private','log_designpro_run_os_event',
  'workflow run transitions are appended to Generation history'
);
select trigger_is(
  'public','designpro_workflow_stages','designpro_workflow_stage_os_event_state',
  'designpro_private','log_designpro_stage_os_event',
  'graph-node transitions are appended to Generation history'
);
select diag(COALESCE((
  SELECT pg_catalog.string_agg(
    nt.nspname||'.'||ct.relname||':'||t.tgname||'->'||ni.nspname||'.'||p.proname,
    ', ' ORDER BY ct.relname,t.tgname
  )
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class ct ON ct.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace nt ON nt.oid=ct.relnamespace
  JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
  JOIN pg_catalog.pg_namespace ni ON ni.oid=p.pronamespace
  WHERE nt.nspname='public'
    AND ct.relname IN ('designpro_artifacts','designpro_stage_receipts')
    AND NOT t.tgisinternal
),'no artifact/receipt triggers found'));
select trigger_is(
  'public','designpro_artifacts','designpro_artifact_os_event',
  'every production artifact is appended to Generation history'
);
select trigger_is(
  'public','designpro_stage_receipts','designpro_receipt_os_event',
  'every verified receipt is appended to Generation history'
);

select * from finish();
rollback;
