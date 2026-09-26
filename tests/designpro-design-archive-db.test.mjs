// THE DESIGN ARCHIVE, ON A REAL POSTGRES (PGlite), WITH RLS ON.
//
// Applies supabase/migrations/20260926010000_designpro_design_archive.sql to
// stubs carrying production's column lists (information_schema, 2026-09-25)
// and proves: every generation and revision is indexed automatically; order
// numbers bind; the library search finds by order #, customer, vehicle, date,
// status and year with keyset paging; RLS keeps customers to their own designs
// while QC staff see all; the history RPC returns versions, prompts (incl.
// per-view regeneration notes), files and orders in order; a broken archive
// never fails the generation write; the backfill is idempotent and only
// REPORTS free-text "#30292" candidates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(new URL('../runtime/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const MIGRATION = await readFile(new URL('../supabase/migrations/20260926010000_designpro_design_archive.sql', import.meta.url), 'utf8');
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';
const GEN_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const GEN_2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const GEN_OLD = 'cccccccc-0000-4000-8000-000000000003';

const STUBS = `
CREATE SCHEMA auth; CREATE SCHEMA designpro_private;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
-- Production: authenticated has NO usage on designpro_private (pg_catalog, 2026-09-25).
GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
GRANT USAGE ON SCHEMA designpro_private TO service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('test.uid',true),'')::uuid$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT COALESCE(NULLIF(current_setting('test.jwt',true),''),'{}')::jsonb$$;
CREATE TABLE public.designpro_qc_members(user_id uuid PRIMARY KEY, can_preflight boolean NOT NULL DEFAULT true);
CREATE TABLE public.designpro_generation_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), generation_id uuid NOT NULL, owner_id uuid NOT NULL,
  tenant_key text, idempotency_key text, state text NOT NULL DEFAULT 'queued', request_input jsonb NOT NULL DEFAULT '{}', input_hash text,
  engine_receipt jsonb, error jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz DEFAULT now(), completed_at timestamptz,
  parent_atlas_revision_id uuid, revision_sequence integer, revision_context jsonb);
CREATE TABLE public.designpro_flat_atlas_revisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid, generation_id uuid, owner_id uuid,
  tenant_key text, parent_revision_id uuid, revision_sequence integer, guide_storage_path text, guide_content_hash text, guide_byte_size bigint,
  guide_content_type text, manifest_storage_path text, manifest_content_hash text, manifest_byte_size bigint, manifest_content_type text,
  master_storage_path text, master_content_hash text, master_byte_size bigint, master_content_type text, projection_storage_path text,
  projection_content_hash text, projection_byte_size bigint, projection_content_type text, instruction text, production_eligible boolean DEFAULT false,
  metadata jsonb DEFAULT '{}', prompt_version text, width_px integer, height_px integer, effective_ppi numeric, created_at timestamptz DEFAULT now());
CREATE TABLE public.designpro_generation_views(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid, source_view_type text, consumer_role text,
  storage_path text, content_hash text, byte_size bigint, content_type text, metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(),
  superseded_at timestamptz, supersedes_id uuid);
CREATE TABLE public.designpro_generation_slots(request_id uuid, source_view_type text, state text, instruction text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.designpro_revision_sources(revision_id uuid PRIMARY KEY, owner_id uuid, tenant_key text, generation_id uuid, snapshot jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.designpro_workflow_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_type text, owner_id uuid, revision_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.designpro_artifacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, stage_id uuid, artifact_kind text, surface_key text,
  storage_path text, content_hash text, byte_size bigint, metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());
ALTER TABLE public.designpro_generation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designpro_generation_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designpro_generation_slots ENABLE ROW LEVEL SECURITY;
-- Production's staff and read rules, verbatim (20260826030000).
CREATE FUNCTION designpro_private.caller_is_design_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.designpro_qc_members q WHERE q.user_id = (SELECT auth.uid()) AND q.can_preflight); $fn$;
CREATE FUNCTION designpro_private.caller_may_read_generation(p_generation_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT COALESCE(auth.jwt()->>'role','') = 'service_role'
    OR EXISTS (SELECT 1 FROM public.designpro_generation_requests r WHERE r.generation_id = p_generation_id AND r.owner_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.designpro_qc_members q WHERE q.user_id = (SELECT auth.uid()) AND q.can_preflight); $fn$;
GRANT EXECUTE ON FUNCTION designpro_private.caller_is_design_staff() TO authenticated;
`;

const input = (over = {}) => JSON.stringify({
  contractVersion: 'designpro.calls-1-7-input.v3', brief: 'Bold teal roofing wrap', designName: 'Ridgeline Roofing',
  companyName: 'Ridgeline Roofing', vehicle: { year: '2022', make: 'Ford', model: 'F-250', type: 'truck' }, ...over,
});

async function db({ beforeMigration } = {}) {
  const pg = new PGlite();
  await pg.exec(STUBS);
  if (beforeMigration) await beforeMigration(pg);
  await pg.exec(MIGRATION);
  await pg.query('INSERT INTO public.designpro_qc_members(user_id) VALUES ($1)', [STAFF]);
  return pg;
}
async function as(pg, uid, fn, { role = 'authenticated', jwt = null } = {}) {
  await pg.exec(`SET ROLE ${role}`);
  await pg.query("SELECT set_config('test.uid', $1, false), set_config('test.jwt', $2, false)", [uid || '', jwt ? JSON.stringify(jwt) : '']);
  try { return await fn(); } finally { await pg.exec('RESET ROLE'); await pg.query("SELECT set_config('test.uid','',false), set_config('test.jwt','',false)"); }
}

test('every generation and revision is indexed automatically, with its order number', async () => {
  const pg = await db();
  const req = (await pg.query(`INSERT INTO public.designpro_generation_requests(generation_id, owner_id, tenant_key, request_input, created_at)
    VALUES ($1,$2,$3,$4,'2026-09-25T20:00:00Z') RETURNING id`, [GEN_1, OWNER_A, `user_${OWNER_A}`, input({ orderNumber: '#30292' })])).rows[0].id;
  let d = (await pg.query('SELECT * FROM public.designpro_designs')).rows[0];
  assert.equal(d.design_id, 'DID-AAAAAAAA', 'the DesignID the runtime already mints');
  assert.deepEqual([d.vehicle_year, d.vehicle_make, d.vehicle_model, d.status, d.created_year], [2022, 'Ford', 'F-250', 'generating', 2026]);
  assert.deepEqual((await pg.query('SELECT source, order_number FROM public.designpro_design_orders')).rows, [{ source: 'intake', order_number: '30292' }]);
  await pg.query("UPDATE public.designpro_generation_requests SET state='outputs_ready' WHERE id=$1", [req]);
  const rev = (await pg.query(`INSERT INTO public.designpro_flat_atlas_revisions(request_id, generation_id, owner_id, revision_sequence, master_storage_path,
    master_content_hash, master_byte_size, master_content_type, width_px, height_px) VALUES ($1,$2,$3,1,'m/1.png',$4,10,'image/png',4096,4096) RETURNING id`,
    [req, GEN_1, OWNER_A, 'a'.repeat(64)])).rows[0].id;
  d = (await pg.query('SELECT * FROM public.designpro_designs')).rows[0];
  // An intake order number is a reference, not a purchase: status follows the generation.
  assert.equal(d.status, 'ready');
  assert.equal(d.current_revision_id, rev);
  // A revision request shares the GenerationID: same design, newer current request.
  const req2 = (await pg.query(`INSERT INTO public.designpro_generation_requests(generation_id, owner_id, request_input, parent_atlas_revision_id,
    revision_sequence, revision_context, created_at) VALUES ($1,$2,$3,$4,2,$5,'2026-09-25T21:00:00Z') RETURNING id`,
    [GEN_1, OWNER_A, input(), rev, JSON.stringify({ instruction: 'Make the phone number larger' })])).rows[0].id;
  d = (await pg.query('SELECT * FROM public.designpro_designs')).rows[0];
  assert.equal((await pg.query('SELECT count(*)::int n FROM public.designpro_designs')).rows[0].n, 1);
  assert.equal(d.current_request_id, req2);
  assert.equal(d.status, 'generating', 'the revision is running');
  // A purchase (Woo/Stripe) moves it to 'ordered', and a generation state never downgrades that.
  await pg.query(`INSERT INTO public.designpro_design_orders(design_id, source, order_number) VALUES ('DID-AAAAAAAA','stripe','cs_test_1')`);
  await pg.query("UPDATE public.designpro_generation_requests SET state='outputs_ready' WHERE id=$1", [req2]);
  assert.equal((await pg.query('SELECT status FROM public.designpro_designs')).rows[0].status, 'ordered');
  await pg.close();
});

test('the library search: order #, customer, vehicle, year, status, date; keyset paged; RLS-scoped', async () => {
  const pg = await db();
  await pg.query(`INSERT INTO public.designpro_generation_requests(generation_id, owner_id, request_input, created_at) VALUES
    ($1,$3,$4,'2026-09-20T12:00:00Z'), ($2,$5,$6,'2026-09-21T12:00:00Z')`,
    [GEN_1, GEN_2, OWNER_A, input({ orderNumber: '30292' }), OWNER_B,
     input({ designName: 'Aura Day Spa', companyName: 'New Aura Day Spa', vehicle: { year: '2019', make: 'Toyota', model: 'Prius', type: 'car' } })]);
  const search = (args) => pg.query(`SELECT design_id, order_numbers FROM public.designpro_design_search(
    p_query => $1, p_order_number => $2, p_vehicle_make => $3, p_vehicle_model => $4, p_vehicle_year => $5, p_created_year => $6,
    p_status => $7, p_limit => $8, p_cursor_created_at => $9, p_cursor_design_id => $10)`,
    [args.q ?? null, args.order ?? null, args.make ?? null, args.model ?? null, args.year ?? null, args.cyear ?? null,
     args.status ?? null, args.limit ?? 24, args.cursorAt ?? null, args.cursorId ?? null]).then((r) => r.rows.map((x) => x.design_id));

  // Staff (PanelPro QC) sees the whole archive.
  await as(pg, STAFF, async () => {
    assert.deepEqual(await search({}), ['DID-BBBBBBBB', 'DID-AAAAAAAA'], 'newest first');
    assert.deepEqual(await search({ order: '#30292' }), ['DID-AAAAAAAA'], 'order number, with or without #');
    assert.deepEqual(await search({ q: '30292' }), ['DID-AAAAAAAA'], 'free text finds the order number too');
    assert.deepEqual(await search({ q: 'aura spa' }), ['DID-BBBBBBBB'], 'customer / design name');
    assert.deepEqual(await search({ make: 'toyota', model: 'PRIUS', year: 2019 }), ['DID-BBBBBBBB'], 'vehicle make/model/year');
    assert.deepEqual(await search({ cyear: 2025 }), [], 'there are no 2025 designs');
    assert.deepEqual(await search({ cyear: 2026, status: 'generating' }), ['DID-BBBBBBBB', 'DID-AAAAAAAA']);
    assert.deepEqual(await search({ q: 'did-aaaaaaaa' }), ['DID-AAAAAAAA'], 'DesignID');
    const first = await pg.query(`SELECT design_id, created_at FROM public.designpro_design_search(p_limit => 1)`);
    const next = await search({ limit: 1, cursorAt: first.rows[0].created_at, cursorId: first.rows[0].design_id });
    assert.deepEqual([first.rows[0].design_id, ...next], ['DID-BBBBBBBB', 'DID-AAAAAAAA'], 'keyset page 2 follows page 1');
  });
  // A customer finds only their own designs, even by another customer's order number.
  await as(pg, OWNER_B, async () => {
    assert.deepEqual(await search({}), ['DID-BBBBBBBB']);
    assert.deepEqual(await search({ order: '30292' }), []);
    assert.equal((await pg.query('SELECT count(*)::int n FROM public.designpro_design_orders')).rows[0].n, 0);
  });
  await as(pg, OWNER_A, async () => assert.deepEqual(await search({ order: '30292' }), ['DID-AAAAAAAA']));
  // Anonymous callers cannot read the archive at all.
  await pg.exec('SET ROLE anon');
  await assert.rejects(pg.query('SELECT * FROM public.designpro_designs'), /permission denied/);
  await pg.exec('RESET ROLE');
  // Nobody writes directly.
  await as(pg, OWNER_A, () => assert.rejects(pg.query(`INSERT INTO public.designpro_design_orders(design_id, source, order_number) VALUES ('DID-AAAAAAAA','manual','1')`), /permission denied/));
  await pg.close();
});

test('the history RPC: versions, every prompt, files and orders, in order; owner and QC staff only', async () => {
  const pg = await db();
  const req = (await pg.query(`INSERT INTO public.designpro_generation_requests(generation_id, owner_id, request_input, state, created_at)
    VALUES ($1,$2,$3,'outputs_ready','2026-09-25T20:00:00Z') RETURNING id`, [GEN_1, OWNER_A, input()])).rows[0].id;
  const rev1 = (await pg.query(`INSERT INTO public.designpro_flat_atlas_revisions(request_id, generation_id, owner_id, revision_sequence, master_storage_path,
    master_content_hash, master_byte_size, master_content_type, created_at) VALUES ($1,$2,$3,1,'m/1.png',$4,10,'image/png','2026-09-25T20:05:00Z') RETURNING id`,
    [req, GEN_1, OWNER_A, 'a'.repeat(64)])).rows[0].id;
  await pg.query(`INSERT INTO public.designpro_generation_views(request_id, source_view_type, consumer_role, storage_path, content_hash, byte_size, content_type, created_at)
    VALUES ($1,'side','driver','v/side.jpg',$2,8000000,'image/jpeg','2026-09-25T20:06:00Z')`, [req, 'b'.repeat(64)]);
  await pg.query(`INSERT INTO public.designpro_generation_slots(request_id, source_view_type, state, instruction, updated_at)
    VALUES ($1,'rear','accepted','Show the tailgate logo','2026-09-25T20:07:00Z')`, [req]);
  const req2 = (await pg.query(`INSERT INTO public.designpro_generation_requests(generation_id, owner_id, request_input, parent_atlas_revision_id, revision_sequence,
    revision_context, state, created_at) VALUES ($1,$2,$3,$4,2,$5,'failed','2026-09-25T21:00:00Z') RETURNING id`,
    [GEN_1, OWNER_A, input(), rev1, JSON.stringify({ instruction: 'Make the phone number larger' })])).rows[0].id;
  const wf = (await pg.query(`INSERT INTO public.designpro_revision_sources(revision_id, owner_id, generation_id) VALUES (gen_random_uuid(),$1,$2) RETURNING revision_id`, [OWNER_A, GEN_1])).rows[0].revision_id;
  const run = (await pg.query(`INSERT INTO public.designpro_workflow_runs(workflow_type, owner_id, revision_id) VALUES ('designpro.entice_pack',$1,$2) RETURNING id`, [OWNER_A, wf])).rows[0].id;
  await pg.query(`INSERT INTO public.designpro_artifacts(run_id, artifact_kind, surface_key, storage_path, content_hash, byte_size, metadata, created_at)
    VALUES ($1,'panel','hood','p/hood.png',$2,3000000,'{"widthPx":1262,"heightPx":918}','2026-09-25T20:10:00Z')`, [run, 'c'.repeat(64)]);
  await pg.query(`SELECT public.designpro_bind_design_order($1, '30292', 'intake')`, [GEN_1]).catch(() => null); // superuser: no auth -> not owner

  const history = (uid) => as(pg, uid, async () => (await pg.query(`SELECT public.designpro_design_history('did-aaaaaaaa') h`)).rows[0].h);
  const h = await history(OWNER_A);
  assert.equal(h.contract, 'designpro.design-history.v1');
  assert.deepEqual(h.versions.map((v) => v.version), [1]);
  assert.deepEqual(h.prompts.map((p) => [p.kind, p.prompt, p.state]), [
    ['original-brief', 'Bold teal roofing wrap', 'outputs_ready'],
    ['view-regeneration', 'Show the tailgate logo', 'accepted'],
    ['revision-instruction', 'Make the phone number larger', 'failed'],
  ], 'every prompt, including a failed revision, in the order it was entered');
  assert.deepEqual(h.files.map((f) => [f.source, f.kind, f.surface]), [['revision', 'master', null], ['view', 'view', 'side'], ['artifact', 'panel', 'hood']]);
  assert.equal(h.files.find((f) => f.kind === 'panel').widthPx, 1262);
  assert.ok(await history(STAFF), 'PanelPro QC staff read the same history');
  assert.equal(await history(OWNER_B), null, 'another customer gets nothing');
  assert.ok(req2);
  await pg.close();
});

test('order binding: a customer records their own intake order number; Woo/manual are staff facts', async () => {
  const pg = await db();
  await pg.query(`INSERT INTO public.designpro_generation_requests(generation_id, owner_id, request_input) VALUES ($1,$2,$3)`, [GEN_1, OWNER_A, input()]);
  const bind = (uid, order, source) => as(pg, uid, () => pg.query('SELECT public.designpro_bind_design_order($1,$2,$3) r', [GEN_1, order, source]).then((r) => r.rows[0].r));
  assert.deepEqual(await bind(OWNER_A, ' #28763 ', 'intake'), { designId: 'DID-AAAAAAAA', orderNumber: '28763', source: 'intake' });
  await assert.rejects(bind(OWNER_A, '28763', 'woocommerce'), /design_order_source_forbidden/);
  await assert.rejects(bind(OWNER_B, '28763', 'intake'), /design_not_found/);
  await assert.rejects(bind(OWNER_A, '<script>', 'intake'), /design_order_number_invalid/);
  assert.equal((await bind(STAFF, '28763', 'woocommerce')).source, 'woocommerce');
  await bind(OWNER_A, '28763', 'intake'); // idempotent
  assert.equal((await pg.query('SELECT count(*)::int n FROM public.designpro_design_orders')).rows[0].n, 2);
  await pg.close();
});

test('a broken archive never fails the generation write that fired it', async () => {
  const pg = await db();
  // Sabotage the index: every archive insert now violates a constraint.
  await pg.exec(`ALTER TABLE public.designpro_designs ADD CONSTRAINT sabotage CHECK (design_name = 'never')`);
  const r = await pg.query(`INSERT INTO public.designpro_generation_requests(generation_id, owner_id, request_input) VALUES ($1,$2,$3) RETURNING id`, [GEN_1, OWNER_A, input()]);
  assert.equal(r.rows.length, 1, 'the customer\'s request was still written');
  assert.equal((await pg.query('SELECT count(*)::int n FROM public.designpro_designs')).rows[0].n, 0);
  await pg.close();
});

test('backfill: dry run reports, real run indexes once, free-text "#30292" is only a candidate', async () => {
  const pg = await db({
    beforeMigration: (p) => p.query(`INSERT INTO public.designpro_generation_requests(generation_id, owner_id, request_input, state, created_at)
      VALUES ($1,$2,$3,'outputs_ready','2026-09-25T21:19:00Z')`, [GEN_OLD, OWNER_A, input({ designName: 'WPW real-order test #30292' })]),
  });
  const run = (dry) => as(pg, null, async () => (await pg.query('SELECT public.designpro_archive_backfill(500, $1) r', [dry])).rows[0].r,
    { role: 'service_role', jwt: { role: 'service_role' } });
  const dry = await run(true);
  assert.deepEqual([dry.dryRun, dry.pending, dry.indexed], [true, 1, 0]);
  assert.deepEqual(dry.freeTextOrderCandidates.map((c) => [c.designId, c.candidateOrderNumber]), [['DID-CCCCCCCC', '30292']]);
  assert.equal((await pg.query('SELECT count(*)::int n FROM public.designpro_designs')).rows[0].n, 0, 'dry run writes nothing');
  const real = await run(false);
  assert.deepEqual([real.pending, real.indexed], [1, 1]);
  const d = (await pg.query('SELECT status, created_year FROM public.designpro_designs')).rows[0];
  assert.deepEqual([d.status, d.created_year], ['ready', 2026]);
  assert.equal((await pg.query('SELECT count(*)::int n FROM public.designpro_design_orders')).rows[0].n, 0, 'the free-text number is NOT bound');
  assert.equal((await run(false)).pending, 0, 'idempotent');
  await assert.rejects(as(pg, OWNER_A, () => pg.query('SELECT public.designpro_archive_backfill(10, false)')), /permission denied/);
  await pg.close();
});
