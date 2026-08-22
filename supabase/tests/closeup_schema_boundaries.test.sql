begin;
select plan(8);

select has_function(
  'designpro_private','verify_revision_render_assets',ARRAY[]::text[],
  'revision asset trigger function exists'
);
select ok(
  position('closeup' in pg_get_functiondef(
    'designpro_private.verify_revision_render_assets()'::regprocedure
  ))>0
  AND position('hero3d' in pg_get_functiondef(
    'designpro_private.verify_revision_render_assets()'::regprocedure
  ))=0,
  'new revision validation requires active Close-Up and cannot authorize Hero'
);
select ok(EXISTS(
  select 1 from pg_trigger
  where tgrelid='public.designpro_revision_sources'::regclass
    and tgname='designpro_00_revision_render_assets'
    and tgfoid=
      'designpro_private.verify_revision_render_assets()'::regprocedure
    and not tgisinternal
), 'revision source trigger is bound to the Close-Up-compatible validator');

select ok(
  position('FROM public.designpro_revision_sources frozen' in pg_get_functiondef(
    'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'
      ::regprocedure
  ))>0
  AND position('frozen.revision_id=v_run.revision_id' in pg_get_functiondef(
    'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'
      ::regprocedure
  ))>0
  AND position('frozen.snapshot_hash=v_run.revision_snapshot_hash' in
    pg_get_functiondef(
      'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'
        ::regprocedure
    ))>0
  AND position('hero3d' in pg_get_functiondef(
    'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'
      ::regprocedure
  ))>0,
  'revision.freeze allows Hero only from its existing frozen revision source'
);

select ok(
  (select position('closeup' in pg_get_expr(polqual,polrelid))>0
      AND position('hero3d' in pg_get_expr(polqual,polrelid))>0
   from pg_policy
   where polrelid='storage.objects'::regclass
     and polname='designpro_owner_read_wrap_files'),
  'owner Storage reads include Close-Up and historical Hero revision inputs'
);
select ok(
  (select position('closeup' in pg_get_expr(polwithcheck,polrelid))>0
      AND position('hero3d' in pg_get_expr(polwithcheck,polrelid))=0
   from pg_policy
   where polrelid='storage.objects'::regclass
     and polname='designpro_owner_insert_revision_inputs'),
  'owner Storage inserts allow active Close-Up but not historical Hero inputs'
);

with source(definition) as (
  select regexp_replace(pg_get_functiondef(
    'public.designpro_flat_atlas_revision_paths(uuid)'::regprocedure
  ),'[[:space:]]+','','g')
)
select ok(
  position('flat_first_atlas_requires_new_run(v_request.id)' in definition)>0
  AND position('flat_first_atlas_requires_new_run(v_request.id)' in definition)
    <position('''guideStoragePath'',r.guide_storage_path' in definition),
  'invalid terminal Atlas master preview fails before returning a private path'
) from source;
select ok(has_function_privilege(
  'authenticated','public.designpro_flat_atlas_revision_paths(uuid)','EXECUTE'
), 'owner preview RPC remains callable after the forward replacement');

select * from finish();
rollback;
