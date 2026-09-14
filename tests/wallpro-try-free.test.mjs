// TRY FREE, AND COMMERCIALPRO MEMBERS DESIGN FREE (owner, Trish 2026-09-14:
// "We shpuld have a try free. COmmercialPro members get free wallpro").
//
// Runs the REAL migration on PGlite, over rows that exercise every branch,
// because the thing that had to be proven here is not that the patch found its
// search string — it is that the function it left behind still works.
//
// THE FAILURE THIS TEST EXISTS TO CATCH. The first draft of the migration
// CREATE OR REPLACE'd the whole body, reproduced from a read truncated at 150
// characters. The real subscription cap line ends:
//     WHEN 'enterprise' THEN 999999 WHEN 'agency' THEN 999999 ELSE 0 END
// and the restatement guessed "WHEN 'enterprise' THEN 400 ELSE 0 END" — capping
// enterprise and DELETING the 'agency' tier, which drops every agency
// subscriber to cap=0, past the subscription arm, into no_tokens. Nothing in a
// search-string assertion would have noticed. `agency still charges the
// subscription` below is the assertion that does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = new URL('../', import.meta.url).pathname;
// PGlite is installed for the runtime image, which is where the other
// migration tests reach for it too.
const { PGlite } = createRequire(ROOT + 'runtime/package.json')('@electric-sql/pglite');

const ORIGINAL = 'supabase/migrations/20260910070849_wallpro_private_projects.sql';
const PATCH = 'supabase/migrations/20260914230000_wallpro_try_free_and_commercialpro.sql';

/** The prerequisites the reservation touches, and nothing else. */
const PREREQS = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users(id uuid PRIMARY KEY);
  CREATE TABLE public.user_roles(user_id uuid, role text);
  CREATE TABLE public.user_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
    status text, tier text, render_count int, created_at timestamptz DEFAULT now());
  CREATE TABLE public.user_tokens(user_id uuid PRIMARY KEY, balance int, total_used int, updated_at timestamptz);
  CREATE TABLE public.wallpro_generations(id uuid PRIMARY KEY, owner_id uuid, input_hash text, input jsonb,
    charge_source text, subscription_id uuid, state text DEFAULT 'working', artwork_path text,
    design_name text, error text, created_at timestamptz DEFAULT now(), completed_at timestamptz);
`;

/** Grants and policies PGlite has no roles for; the logic under test is untouched. */
const stripGrants = sql => sql
  .replace(/CREATE POLICY[\s\S]*?;\n/g, '')
  .replace(/ALTER TABLE public\.commercialpro_members ENABLE ROW LEVEL SECURITY;/g, '')
  .replace(/DROP POLICY[^;]*;/g, '')
  .replace(/REVOKE ALL ON (TABLE|FUNCTION)[^;]*;/g, '')
  .replace(/GRANT (SELECT ON TABLE|EXECUTE ON FUNCTION)[^;]*;/g, '');

async function freshDb() {
  const db = new PGlite();
  await db.exec(PREREQS);
  const orig = readFileSync(ROOT + ORIGINAL, 'utf8');
  const from = orig.indexOf('CREATE FUNCTION public.reserve_wallpro_generation');
  const to = orig.indexOf('GRANT EXECUTE ON FUNCTION public.reserve_wallpro_generation', from);
  await db.exec(stripGrants(orig.slice(from, to)));
  await db.exec(stripGrants(readFileSync(ROOT + PATCH, 'utf8')));
  return db;
}

const OWNER = n => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;
let seq = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

async function reserve(db, owner) {
  const id = nextId();
  const r = await db.query('SELECT public.reserve_wallpro_generation($1,$2,$3,$4) AS j',
    [id, owner, 'hash-' + id, JSON.stringify({})]);
  return r.rows[0].j.generation.charge_source;
}
const complete = (db, owner) =>
  db.exec(`UPDATE public.wallpro_generations SET state='completed' WHERE owner_id='${owner}';`);

test('the first generation any owner runs is free', async () => {
  const db = await freshDb();
  const owner = OWNER('a');
  await db.exec(`INSERT INTO auth.users(id) VALUES ('${owner}');`);
  assert.equal(await reserve(db, owner), 'trial');
});

test('the SECOND one is not — the paywall is intact', async () => {
  const db = await freshDb();
  const owner = OWNER('a');
  await db.exec(`INSERT INTO auth.users(id) VALUES ('${owner}');`);
  await reserve(db, owner);
  await complete(db, owner);
  await assert.rejects(() => reserve(db, owner), /no_tokens/);
});

test('a FAILED generation does not spend the trial', async () => {
  // The customer must not pay for our outage with their one free look.
  const db = await freshDb();
  const owner = OWNER('b');
  await db.exec(`INSERT INTO auth.users(id) VALUES ('${owner}');
    INSERT INTO public.wallpro_generations(id,owner_id,input_hash,input,charge_source,state)
    VALUES ('${nextId()}','${owner}','x','{}','trial','failed');`);
  assert.equal(await reserve(db, owner), 'trial');
});

test('a CommercialPro member designs free, every time', async () => {
  const db = await freshDb();
  const owner = OWNER('c');
  await db.exec(`INSERT INTO auth.users(id) VALUES ('${owner}');
    INSERT INTO public.commercialpro_members(user_id,reason) VALUES ('${owner}','500+ sq ft in 12 months');`);
  assert.equal(await reserve(db, owner), 'commercialpro');
  await complete(db, owner);
  assert.equal(await reserve(db, owner), 'commercialpro', 'membership is not a one-off');
});

test('an EXPIRED membership stops being free', async () => {
  const db = await freshDb();
  const owner = OWNER('d');
  await db.exec(`INSERT INTO auth.users(id) VALUES ('${owner}');
    INSERT INTO public.commercialpro_members(user_id,reason,expires_at)
      VALUES ('${owner}','lapsed', now() - interval '1 day');
    INSERT INTO public.wallpro_generations(id,owner_id,input_hash,input,charge_source,state)
      VALUES ('${nextId()}','${owner}','x','{}','trial','completed');`);
  await assert.rejects(() => reserve(db, owner), /no_tokens/);
});

test('agency still charges the subscription — the tier table survived the patch', async () => {
  // THE REGRESSION THIS FILE EXISTS FOR. A restated body dropped 'agency'
  // entirely; such a subscriber would fall to cap=0 and be refused.
  const db = await freshDb();
  for (const [tier, owner] of [['agency', OWNER('e')], ['enterprise', OWNER('f')], ['complete', OWNER('9')]]) {
    await db.exec(`INSERT INTO auth.users(id) VALUES ('${owner}');
      INSERT INTO public.user_subscriptions(user_id,status,tier,render_count) VALUES ('${owner}','active','${tier}',5);
      INSERT INTO public.wallpro_generations(id,owner_id,input_hash,input,charge_source,state)
        VALUES ('${nextId()}','${owner}','x','{}','trial','completed');`);
    assert.equal(await reserve(db, owner), 'subscription', `${tier} must still charge the subscription`);
  }
});

test('tokens are still spent when nothing free applies', async () => {
  const db = await freshDb();
  const owner = OWNER('8');
  await db.exec(`INSERT INTO auth.users(id) VALUES ('${owner}');
    INSERT INTO public.user_tokens(user_id,balance,total_used) VALUES ('${owner}',3,0);
    INSERT INTO public.wallpro_generations(id,owner_id,input_hash,input,charge_source,state)
      VALUES ('${nextId()}','${owner}','x','{}','trial','completed');`);
  assert.equal(await reserve(db, owner), 'tokens');
  const bal = await db.query(`SELECT balance FROM public.user_tokens WHERE user_id='${owner}'`);
  assert.equal(bal.rows[0].balance, 2, 'a token was actually spent');
});

test('the page can ask why a generation is free before spending anything', async () => {
  const db = await freshDb();
  const fresh = OWNER('7'), member = OWNER('6'), spent = OWNER('5');
  await db.exec(`INSERT INTO auth.users(id) VALUES ('${fresh}'),('${member}'),('${spent}');
    INSERT INTO public.commercialpro_members(user_id,reason) VALUES ('${member}','fleet');
    INSERT INTO public.wallpro_generations(id,owner_id,input_hash,input,charge_source,state)
      VALUES ('${nextId()}','${spent}','x','{}','trial','completed');`);
  const reason = async o =>
    (await db.query('SELECT public.wallpro_free_generation_reason($1) AS r', [o])).rows[0].r;
  assert.equal(await reason(fresh), 'trial');
  assert.equal(await reason(member), 'commercialpro');
  assert.equal(await reason(spent), null, 'a spent owner is told nothing is free');
});

test('the patch is idempotent', async () => {
  const db = await freshDb();
  await db.exec(stripGrants(readFileSync(ROOT + PATCH, 'utf8')));
  const owner = OWNER('4');
  await db.exec(`INSERT INTO auth.users(id) VALUES ('${owner}');`);
  assert.equal(await reserve(db, owner), 'trial', 'a second apply must not change behaviour');
});
