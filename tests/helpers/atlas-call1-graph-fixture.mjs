import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createPanelProfileTestAdapter, OWNER } from './panelprofile-service-fixture.mjs';
const require = createRequire(new URL('../../runtime/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');

export { OWNER };
export const REQUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CLAIM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const GENERATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** The real migration on PGlite, over a stub of the generation request row
 * the claim predicate joins (state, lease token, lease expiry). */
export async function createAtlasCall1Database() {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz);
    CREATE TABLE public.designpro_generation_requests(id uuid PRIMARY KEY,generation_id uuid NOT NULL,owner_id uuid NOT NULL,
      state text NOT NULL DEFAULT 'leased',lease_token uuid,lease_expires_at timestamptz);
    INSERT INTO auth.users VALUES('${OWNER}',now());
    INSERT INTO public.designpro_generation_requests VALUES('${REQUEST}','${GENERATION}','${OWNER}','leased','${CLAIM}',now()+interval '15 minutes');`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20260911170000_designpro_atlas_call1_graph.sql', import.meta.url), 'utf8'));
  return db;
}

export function createAtlasCall1Adapter(db, files = new Map()) {
  return createPanelProfileTestAdapter(db, files);
}
