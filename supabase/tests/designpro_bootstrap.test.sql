begin;
select plan(22);

select has_table('public','designpro_workflow_runs','workflow runs exist');
select has_table('public','designpro_vehicle_specs_universal','GENIE candidate catalog exists');
select has_table('public','designpro_universal_dimension_requests','GENIE wait links exist');
select has_function(
  'public','request_designpro_universal_dimension_validation',
  ARRAY['uuid','uuid','uuid','uuid'],
  'fenced GENIE wait RPC exists'
);
select has_function(
  'public','validate_designpro_vehicle_spec_universal',
  ARRAY['uuid','jsonb','text','jsonb'],
  'authenticated GENIE validation RPC exists'
);
select has_function('public','designpro_schema_readiness',ARRAY[]::text[],
  'service readiness RPC exists');
select has_function('public','designpro_runtime_readiness',ARRAY[]::text[],
  'non-deadlocking runtime readiness RPC exists');
select has_function('public','reconcile_designpro_automatic_production',ARRAY[]::text[],
  'automatic production crash reconciler exists');
select has_table('designpro_private','heavy_stage_leases',
  'database singleton lease for output.build exists');
select has_table('designpro_private','business_customer_bindings',
  'append-only private business customer identity map exists');
select has_function('public','acquire_designpro_heavy_lease',
  ARRAY['uuid','uuid','text','integer'],
  'service-only global heavy-stage acquire RPC exists');
select has_function('public','release_designpro_heavy_lease',
  ARRAY['uuid','uuid'],
  'service-only global heavy-stage release RPC exists');
select has_function('public','register_designpro_operator_wrapbox_recipient',
  ARRAY['uuid','text','text','text','text'],
  'service-mediated registered recipient binding exists');
select has_column('public','designpro_wrapbox_packs','design_id',
  'WrapBox freezes canonical DesignID');
select has_column('public','designpro_wrapbox_packs','order_number',
  'WrapBox freezes required business Order #');

select ok(
  (select NOT public AND file_size_limit=50000000000
   from storage.buckets where id='wrap-files'),
  'wrap-files bucket is private with the bounded 50 GB pack limit'
);
select policies_are(
  'storage','objects',
  ARRAY['designpro_customer_read_wrapbox_delivery','designpro_owner_insert_revision_inputs',
        'designpro_owner_read_generation_views','designpro_owner_read_wrap_files'],
  'only exact DesignPro Storage policies are installed by this bootstrap'
);
select ok(
  NOT has_function_privilege('anon',
    'public.designpro_schema_readiness()','EXECUTE'),
  'anon cannot execute readiness'
);
select ok(
  NOT EXISTS(
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl,acldefault('f',p.proowner))
    ) privilege
    WHERE p.oid='public.designpro_schema_readiness()'::regprocedure
      AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE'
  ),
  'PUBLIC cannot execute readiness'
);
select ok(
  NOT EXISTS(
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl,acldefault('f',p.proowner))
    ) privilege
    WHERE p.prosecdef
      AND (n.nspname='designpro_private'
        OR (n.nspname='public' AND p.proname LIKE '%designpro%'))
      AND privilege.privilege_type='EXECUTE'
      AND (privilege.grantee=0 OR privilege.grantee=(select oid from pg_roles where rolname='anon'))
  ),
  'no DesignPro SECURITY DEFINER function is executable by PUBLIC or anon'
);
select ok(
  NOT has_function_privilege('service_role',
    'public.save_designpro_revision_source(uuid,uuid,uuid,timestamp with time zone,jsonb,text,text)',
    'EXECUTE'),
  'service role cannot impersonate authenticated revision ingestion'
);
select is(
  (select count(*)::integer from public.designpro_vehicle_specs_universal),0,
  'fresh bootstrap seeds no guessed geometry'
);

select * from finish();
rollback;
