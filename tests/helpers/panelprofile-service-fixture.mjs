import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const require = createRequire(new URL('../../runtime/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
export const OWNER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const OUTSIDER = '33333333-3333-4333-8333-333333333333';
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function createPanelProfileDatabase() {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA designpro_private;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT '{"role":"service_role"}'::jsonb$$;
    CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256($1)$$;
    CREATE TABLE public.designpro_qc_members(user_id uuid PRIMARY KEY,can_preflight boolean);
    CREATE TABLE public.designpro_workflow_stages(id uuid PRIMARY KEY,stage_key text,status text,lease_token uuid,lease_owner text,lease_expires_at timestamptz);
    CREATE TABLE public.designpro_revision_sources(revision_id uuid PRIMARY KEY,generation_id text,owner_id uuid,snapshot jsonb);
    CREATE TABLE public.designpro_flat_atlas_revisions(id uuid PRIMARY KEY,generation_id text,owner_id uuid,master_content_hash text,master_storage_path text);
    CREATE TABLE designpro_private.heavy_stage_leases(lease_key text PRIMARY KEY,stage_id uuid,lease_owner text,lease_token uuid,lease_expires_at timestamptz,updated_at timestamptz,
      CONSTRAINT designpro_heavy_stage_lease_integrity CHECK ((stage_id IS NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) OR (stage_id IS NOT NULL AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)));
    INSERT INTO designpro_private.heavy_stage_leases(lease_key) VALUES('production-heavy');
    CREATE FUNCTION public.claim_designpro_stage(text,integer) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN
      UPDATE designpro_private.heavy_stage_leases SET stage_id=NULL,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE lease_expires_at<now(); RETURN false; END$$;
    INSERT INTO auth.users VALUES('${OWNER}',now()),('${OTHER}',now()),('${OUTSIDER}',now());
    INSERT INTO public.designpro_qc_members VALUES('${OWNER}',true);`);
  const acquire = await readFile(new URL('../../supabase/migrations/20260824040000_designpro_call12_heavy_lease.sql', import.meta.url), 'utf8');
  await db.exec(acquire.match(/CREATE OR REPLACE FUNCTION public\.acquire_designpro_heavy_lease\([\s\S]*?\$fn\$;/)[0]);
  await db.exec(await readFile(new URL('../../supabase/migrations/20260908190825_panelpro_file_output_graph.sql', import.meta.url), 'utf8'));
  return db;
}

const ident = (name) => { assert.match(name, /^[a-zA-Z_][a-zA-Z0-9_]*$/); return `"${name}"`; };
const bindValue = (value) => value != null && typeof value === 'object' ? JSON.stringify(value) : value;

/** PostgREST-shaped transport adapter only. All queries, constraints, claims,
 * ownership predicates, triggers and approval functions execute in PostgreSQL. */
export function createPanelProfileTestAdapter(db, files = new Map()) {
  const uploads = [], downloads = [], signed = [], rpcCalls = [], failures = [];
  const adapter = { files, uploads, downloads, signed, rpcCalls, failures };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.columns = '*'; this.values = []; this.orders = []; }
    select(columns = '*') { this.columns = columns; this.returning = true; return this; }
    eq(column, value) { this.filters.push({ column, operator: '=', value }); return this; }
    in(column, value) { this.filters.push({ column, operator: 'in', value }); return this; }
    like(column, value) { this.filters.push({ column, operator: 'LIKE', value }); return this; }
    order(column, options = {}) { this.orders.push(`${ident(column)} ${options.ascending === false ? 'DESC' : 'ASC'}`); return this; }
    limit(value) { assert.ok(Number.isInteger(value) && value > 0); this.max = value; return this; }
    insert(value) { this.insertValue = value; return this; }
    single() { this.shape = 'single'; return this; }
    maybeSingle() { this.shape = 'maybe'; return this; }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
    async execute() {
      try {
        const projection = this.columns === '*' ? '*' : this.columns.split(',').map(ident).join(',');
        const values = [];
        const bind = (value) => { values.push(bindValue(value)); return `$${values.length}`; };
        let sql;
        if (this.insertValue) {
          const keys = Object.keys(this.insertValue);
          sql = `INSERT INTO public.${ident(this.table)} (${keys.map(ident).join(',')}) VALUES (${keys.map((key) => bind(this.insertValue[key])).join(',')})`;
          if (this.returning) sql += ` RETURNING ${projection}`;
        } else {
          sql = `SELECT ${projection} FROM public.${ident(this.table)}`;
          if (this.filters.length) sql += ' WHERE ' + this.filters.map(({ column, operator, value }) => operator === 'in'
            ? `${ident(column)} IN (${value.map(bind).join(',')})` : `${ident(column)} ${operator} ${bind(value)}`).join(' AND ');
          if (this.orders.length) sql += ` ORDER BY ${this.orders.join(',')}`;
          if (this.max) sql += ` LIMIT ${this.max}`;
        }
        const { rows } = await db.query(sql, values);
        // PostgREST/SQL does not promise order without ORDER BY. Exercise that
        // contract without changing the underlying stored rows or artifacts.
        if (adapter.reverseUnorderedArtifacts && this.table === 'panelprofile_artifacts' && !this.orders.length) rows.reverse();
        if (this.shape && rows.length > 1 || this.shape === 'single' && rows.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'Expected exactly one row' } };
        return { data: this.shape ? rows[0] || null : rows, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    }
  }
  const storage = {
    from(bucket) {
      assert.equal(bucket, 'wrap-files');
      return {
        async upload(path, bytes, options) {
          assert.equal(options.upsert, false, 'the service must preserve immutable writes');
          const exists = files.has(path);
          uploads.push({ path, bytes: bytes.length, hash: sha(bytes), duplicate: exists, contentType: options.contentType });
          if (exists) return { data: null, error: { statusCode: '409', message: 'The resource already exists' } };
          files.set(path, Buffer.from(bytes)); return { data: { path }, error: null };
        },
        async download(path) {
          downloads.push(path);
          const fail = failures.findIndex((f) => f.type === 'download' && f.path === path);
          if (fail !== -1) { failures.splice(fail, 1); return { data: null, error: { statusCode: '503', message: 'Injected transport failure' } }; }
          return files.has(path) ? { data: new Blob([files.get(path)]), error: null }
            : { data: null, error: { statusCode: '404', message: 'Object not found' } };
        },
        async createSignedUrl(path, expiresIn) {
          assert.ok(files.has(path), `cannot sign missing artifact ${path}`);
          assert.equal(expiresIn, 300); signed.push(path);
          return { data: { signedUrl: `https://storage.example.test/signed/${encodeURIComponent(path)}?token=test-only` }, error: null };
        },
      };
    },
  };
  adapter.supabase = { from: (table) => new Query(table), storage,
    async rpc(name, args) {
      rpcCalls.push({ name, args: structuredClone(args) });
      const fail = failures.findIndex((f) => f.type === 'rpc' && f.name === name && (!f.when || f.when(args)));
      if (fail !== -1) { failures.splice(fail, 1); return { data: null, error: { code: 'TEST_TRANSIENT', message: 'Injected RPC transport failure' } }; }
      try {
        const keys = Object.keys(args);
        const result = await db.query(`SELECT public.${ident(name)}(${keys.map((key, i) => `${ident(key)} => $${i + 1}`).join(',')}) AS result`, keys.map((key) => bindValue(args[key])));
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    } };
  class Upload {
    constructor(input, options) { this.input = input; this.options = options; }
    async findPreviousUploads() { return []; }
    resumeFromPreviousUpload() {}
    async abort() { this.aborted = true; }
    start() {
      (async () => {
        const chunks = []; for await (const chunk of this.input) chunks.push(chunk);
        if (this.aborted) return;
        const bytes = Buffer.concat(chunks); assert.equal(bytes.length, this.options.uploadSize);
        const result = await storage.from(this.options.metadata.bucketName).upload(this.options.metadata.objectName, bytes,
          { contentType: this.options.metadata.contentType, upsert: false });
        if (result.error) throw new Error(result.error.message);
        this.options.onSuccess();
      })().catch((error) => this.options.onError(error));
    }
  }
  class FileUrlStorage { constructor() {} }
  adapter.tusUploadOptions = { Upload, FileUrlStorage };
  return adapter;
}

/** Small independent ZIP64 reader for the real archive's central directory.
 * It reads actual stored entries, not an expected manifest generated in tests. */
export function readStoredZip64(bytes) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt32LE(end - 20), 0x07064b50);
  const zip64 = Number(bytes.readBigUInt64LE(end - 12));
  assert.equal(bytes.readUInt32LE(zip64), 0x06064b50);
  const count = Number(bytes.readBigUInt64LE(zip64 + 32));
  let position = Number(bytes.readBigUInt64LE(zip64 + 48));
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(position), 0x02014b50);
    assert.equal(bytes.readUInt16LE(position + 10), 0, 'fixture ZIP entries are stored without recompression');
    const nameLength = bytes.readUInt16LE(position + 28), extraLength = bytes.readUInt16LE(position + 30), commentLength = bytes.readUInt16LE(position + 32);
    const name = bytes.toString('utf8', position + 46, position + 46 + nameLength);
    const extra = position + 46 + nameLength;
    assert.equal(bytes.readUInt16LE(extra), 1);
    const size = Number(bytes.readBigUInt64LE(extra + 4)), offset = Number(bytes.readBigUInt64LE(extra + 20));
    assert.equal(bytes.readUInt32LE(offset), 0x04034b50);
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    assert.ok(start + size <= position); assert.ok(!entries.has(name), 'ZIP filenames must be unique');
    entries.set(name, bytes.subarray(start, start + size));
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
