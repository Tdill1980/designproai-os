begin;
select no_plan();
-- Room scenes for true-scale catalog mockups (20260914160000). Curators
-- manage them; everyone can read the active ones; the corner contract and
-- the wall-inch range are enforced by the table, not only by the browser.
create function pg_temp.as_role(p_role text, p_sql text) returns text language plpgsql as $fn$
declare result text;
begin
  execute format('set local role %I', p_role);
  if lower(left(ltrim(p_sql),6))='select' then execute p_sql into result;
  else execute p_sql;
  end if;
  reset role;
  return result;
exception when others then
  reset role;
  raise;
end $fn$;

insert into auth.users(id,email,role,created_at,updated_at) values
 ('a0101010-1010-4010-8010-101010101010','scene-curator@example.test','authenticated',now(),now()),
 ('b0202020-2020-4020-8020-202020202020','scene-customer@example.test','authenticated',now(),now());
insert into public.user_roles(user_id,role) values ('a0101010-1010-4010-8010-101010101010','admin');

select has_table('public','wallpro_catalog_scenes','room scenes table exists');
select ok((select relrowsecurity from pg_class where oid='public.wallpro_catalog_scenes'::regclass),'room scenes are row-level secured');
select has_column('public','wallpro_designs','mockups','designs carry saved listing mockups');
select is((select column_default from information_schema.columns where table_schema='public' and table_name='wallpro_designs' and column_name='mockups'),'''[]''::jsonb','mockups default to an empty list');

-- A curator can add a scene with four corners and real inches.
select lives_ok($$select pg_temp.as_role('service_role', $q$insert into public.wallpro_catalog_scenes(id,name,room,image_path,width_px,height_px,corners,wall_width_in,wall_height_in,created_by)
  values ('c0303030-3030-4030-8030-303030303030','Beige living room','living_room','catalog/d0404040-4040-4040-8040-404040404040.jpg',2000,1200,
          '[{"x":0.28,"y":0.05},{"x":0.99,"y":0.05},{"x":0.99,"y":0.75},{"x":0.28,"y":0.75}]'::jsonb,168,108,'a0101010-1010-4010-8010-101010101010')$q$)$$,
  'a scene with four corners and wall inches is accepted');
-- Three corners are not a wall.
select throws_ok($$insert into public.wallpro_catalog_scenes(name,image_path,width_px,height_px,corners,wall_width_in,wall_height_in,created_by)
  values ('Bad','catalog/e0505050-5050-4050-8050-505050505050.jpg',10,10,'[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1}]'::jsonb,100,100,'a0101010-1010-4010-8010-101010101010')$$,
  '23514',null,'a scene must carry exactly four corners');
-- A path outside catalog/ is refused, as it is for masters.
select throws_ok($$insert into public.wallpro_catalog_scenes(name,image_path,width_px,height_px,corners,wall_width_in,wall_height_in,created_by)
  values ('Bad','a0101010-1010-4010-8010-101010101010/uploads/f0606060-6060-4060-8060-606060606060.jpg',10,10,'[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1}]'::jsonb,100,100,'a0101010-1010-4010-8010-101010101010')$$,
  '23514',null,'a scene image must live under catalog/');
-- Anyone can read an active scene; a hidden one is curator-only.
select is(pg_temp.as_role('anon','select count(*)::text from public.wallpro_catalog_scenes'),'1','storefront reads the active scene');
update public.wallpro_catalog_scenes set is_active=false where id='c0303030-3030-4030-8030-303030303030';
select is(pg_temp.as_role('anon','select count(*)::text from public.wallpro_catalog_scenes'),'0','a hidden scene leaves the storefront');
-- A signed-in customer who is not a curator cannot write scenes.
select throws_ok($$select pg_temp.as_role('authenticated', $q$insert into public.wallpro_catalog_scenes(name,image_path,width_px,height_px,corners,wall_width_in,wall_height_in,created_by)
  values ('Sneaky','catalog/a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7.jpg',10,10,'[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1}]'::jsonb,100,100,'b0202020-2020-4020-8020-202020202020')$q$)$$,
  '42501',null,'a customer cannot add a scene');

select * from finish();
rollback;
