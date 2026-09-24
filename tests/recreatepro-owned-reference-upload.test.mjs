import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const migration=readFileSync(new URL('../supabase/migrations/20260924120000_designpro_owned_reference_uploads.sql',import.meta.url),'utf8');
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const revision='33333333-3333-4333-8333-333333333333';
const hash='a'.repeat(64);
const path=(user=owner,extension='jpg')=>`users/${user}/revisions/${revision}/inputs/attachment/${hash}.${extension}`;
async function database(t,install=true){
 const db=new PGlite();t.after(()=>db.close());
 // Minimal provider-policy harness: only columns referenced by the actual
 // migration. The migration itself supplies all authorization expressions.
 await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;CREATE SCHEMA storage;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 GRANT USAGE ON SCHEMA auth,storage TO authenticated,anon;
 CREATE TABLE storage.objects(bucket_id text NOT NULL,name text NOT NULL,PRIMARY KEY(bucket_id,name));
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT ON storage.objects TO authenticated;
 GRANT SELECT ON storage.objects TO anon;`);
 if(install)await db.exec(migration);
 await db.exec(`SET ROLE authenticated;SET request.jwt.claim.sub='${owner}';`);
 return db;
}
test('new authenticated owner uploads and reads every supported immutable reference type',async t=>{
 const db=await database(t);
 for(const ext of ['png','jpg','jpeg','webp','pdf']){
  await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)',['wrap-files',path(owner,ext)]);
 }
 assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,5);
});
test('without this migration the actual customer reference is denied',async t=>{
 const db=await database(t,false);
 await assert.rejects(db.query('INSERT INTO storage.objects VALUES ($1,$2)',['wrap-files',path()]),/row-level security/);
});
test('cross-owner, malformed, traversal, output, and unsupported input paths are denied',async t=>{
 const db=await database(t);
 const denied=[path(other),path().replace('/attachment/','/driver/'),path().replace('/inputs/','/outputs/'),
 path().replace(revision,'not-a-uuid'),path().replace(hash,'a'.repeat(63)),path().replace('.jpg','Xjpg'),
 path().replace('/attachment/','/attachment/../'),path()+'/extra',path()+'\n',path(owner,'exe'),path(owner,'svg'),
 `designpro/user_${owner}/${revision}/outputs/${hash}.jpg`];
 for(const name of denied)await assert.rejects(db.query('INSERT INTO storage.objects VALUES ($1,$2)',['wrap-files',name]),/row-level security/,name);
 await assert.rejects(db.query('INSERT INTO storage.objects VALUES ($1,$2)',['other-bucket',path()]),/row-level security/);
});
test('other owners and anonymous callers cannot read or create customer references',async t=>{
 const db=await database(t);await db.query('INSERT INTO storage.objects VALUES ($1,$2)',['wrap-files',path()]);
 await db.exec(`SET request.jwt.claim.sub='${other}';`);
 assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
 await db.exec(`RESET ROLE;SET ROLE anon;SET request.jwt.claim.sub='';`);
 assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
 await assert.rejects(db.query('INSERT INTO storage.objects VALUES ($1,$2)',['wrap-files',path()]),/permission denied|row-level security/);
});
test('uploaded references cannot be overwritten or deleted by the owner',async t=>{
 const db=await database(t);await db.query('INSERT INTO storage.objects VALUES ($1,$2)',['wrap-files',path()]);
 await assert.rejects(db.query('UPDATE storage.objects SET name=$1',[path(owner,'png')]),/permission denied/);
 await assert.rejects(db.query('DELETE FROM storage.objects'),/permission denied/);
 await assert.rejects(db.query('INSERT INTO storage.objects VALUES ($1,$2)',['wrap-files',path()]),/duplicate key/);
});
test('migration adds two exact input policies without touching existing gates or data',()=>{
 assert.equal((migration.match(/CREATE POLICY /g)||[]).length,2);
 assert.doesNotMatch(migration,/DROP POLICY|ALTER POLICY|DISABLE ROW|GRANT|SECURITY DEFINER|UPDATE public|INSERT INTO public/);
});
