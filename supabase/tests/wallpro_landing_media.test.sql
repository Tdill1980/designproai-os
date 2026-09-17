begin;
select no_plan();
create function pg_temp.landing_as_role(p_role text, p_sql text) returns text language plpgsql as $fn$
declare result text;
begin
  execute format('set local role %I', p_role);
  if lower(left(ltrim(p_sql),6))='select' then execute p_sql into result;
  else execute p_sql;
  end if;
  reset role;
  return result;
exception when others then reset role; raise;
end $fn$;
insert into auth.users(id,email,role,created_at,updated_at) values
 ('d01c0000-0000-4000-8000-000000000001','landing-curator@example.test','authenticated',now(),now()),
 ('d01c0000-0000-4000-8000-000000000002','landing-viewer@example.test','authenticated',now(),now());
insert into public.user_roles(user_id,role) values ('d01c0000-0000-4000-8000-000000000001','admin');
select ok((select relrowsecurity from pg_class where oid='public.wallpro_landing_media'::regclass),'landing media is row-level secured');
select set_config('request.jwt.claim.sub','d01c0000-0000-4000-8000-000000000001',true);
select lives_ok($$select pg_temp.landing_as_role('authenticated', $q$insert into public.wallpro_landing_media(slot,title,src,alt) values ('residential','A room','/wallpro/proof-spa-after.jpg','Botanical wall')$q$)$$,'admin can publish a room');
select lives_ok($$select pg_temp.landing_as_role('authenticated', $q$update public.wallpro_landing_media set title='Updated room' where slot='residential'$q$)$$,'admin can replace published content');
select is(pg_temp.landing_as_role('anon', $$select title from public.wallpro_landing_media where slot='residential'$$),'Updated room','signed-out visitor reads published changes');
select throws_ok($$select pg_temp.landing_as_role('anon', $q$insert into public.wallpro_landing_media(slot,title) values ('process','Bad')$q$)$$,'42501',null,'anonymous cannot publish');
select set_config('request.jwt.claim.sub','d01c0000-0000-4000-8000-000000000002',true);
select throws_ok($$select pg_temp.landing_as_role('authenticated', $q$insert into public.wallpro_landing_media(slot,title) values ('process','Bad')$q$)$$,'42501',null,'ordinary signed-in customer cannot publish');
select pg_temp.landing_as_role('authenticated', $$update public.wallpro_landing_media set title='Tampered' where slot='residential'$$);
select is((select title from public.wallpro_landing_media where slot='residential'),'Updated room','customer cannot overwrite a published room');
select throws_ok($$insert into public.wallpro_landing_media(slot,title,src) values ('process','Bad URL','javascript:alert(1)')$$,'23514',null,'database refuses executable URLs');
select ok((select public from storage.buckets where id='wallpro-landing'),'only the dedicated landing bucket is public');
select is((select public from storage.buckets where id='wallpro-files'),false,'private wall project assets stay private');
select * from finish();
rollback;
