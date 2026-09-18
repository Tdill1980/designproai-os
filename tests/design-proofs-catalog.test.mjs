import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../runtime/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');

test('the real proof catalog protects owners and keeps searchable references without granting tenant-wide access', async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const proof = '33333333-3333-4333-8333-333333333333';
  try {
    await db.exec(`create schema auth; create role authenticated; create role anon; create role service_role bypassrls;
      create table auth.users(id uuid primary key); insert into auth.users values ('${owner}'), ('${other}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;`);
    await db.exec(await readFile(new URL('../supabase/migrations/20260918040915_design_proofs_catalog.sql', import.meta.url), 'utf8'));
    const metadata = { brand: 'weprintwraps', tool: 'wallpro', designId: 'WALL-DESIGN-44', generationId: 'wall-generation-2', projectId: 'project-19', vehicle: 'Reception', design: 'Flowers' };
    await db.query('insert into public.design_proofs (id,owner_user_id,brand,tool,storage_path,metadata) values ($1,$2,$3,$4,$5,$6)', [proof, owner, 'weprintwraps', 'wallpro', `proof-exports/${owner}/${proof}/proof.pdf`, JSON.stringify(metadata)]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}';`);
    const found = await db.query("select id from public.design_proofs where search_text ilike '%wall-generation-2%'");
    assert.equal(found.rows[0].id, proof);
    await assert.rejects(db.exec("update public.design_proofs set brand = 'designpro'"), /permission denied/);
    await db.exec(`set request.jwt.claim.sub = '${other}';`);
    assert.equal((await db.query("select * from public.design_proofs where brand = 'weprintwraps'")).rows.length, 0);
    await db.exec("set request.jwt.claim.sub = ''; ");
    assert.equal((await db.query('select * from public.design_proofs')).rows.length, 0);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from public.design_proofs'), /permission denied/);
    await db.exec('reset role;');
    await assert.rejects(db.query('insert into public.design_proofs (id,owner_user_id,brand,tool,storage_path,metadata) values ($1,$2,$3,$4,$5,$6)', [other, other, 'weprintwraps', 'wallpro', `proof-exports/${owner}/${other}/proof.pdf`, JSON.stringify(metadata)]), /design_proofs_owner_path/);
  } finally { await db.close(); }
});
