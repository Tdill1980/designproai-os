import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const require = createRequire(new URL('../../runtime/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const sharp = require('sharp');
export const ACTOR = '11111111-1111-4111-8111-111111111111';
export const OWNER = '22222222-2222-4222-8222-222222222222';
export const OTHER = '33333333-3333-4333-8333-333333333333';
export const SOURCE_JOB = '44444444-4444-4444-8444-444444444444';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const preceding = await readFile(new URL('../../supabase/migrations/20260908190825_panelpro_file_output_graph.sql', import.meta.url), 'utf8');
const lifecycle = await readFile(new URL('../../supabase/migrations/20260908194544_panelpro_template_lifecycle.sql', import.meta.url), 'utf8');

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.where = []; this.values = []; this.columns = '*'; }
  select(columns) { this.columns = columns; return this; }
  eq(key, value) { this.values.push(value); this.where.push(`${key}=$${this.values.length}`); return this; }
  order(key, { ascending = true } = {}) { this.sort = `${key} ${ascending ? 'ASC' : 'DESC'}`; return this; }
  limit(count) { this.count = count; return this; }
  single() { return this.execute('single'); }
  maybeSingle() { return this.execute('maybe'); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  async execute(mode) {
    try {
      const sql = `SELECT ${this.columns} FROM public.${this.table}${this.where.length ? ` WHERE ${this.where.join(' AND ')}` : ''}`
        + (this.sort ? ` ORDER BY ${this.sort}` : '') + (this.count ? ` LIMIT ${Number(this.count)}` : '');
      const { rows } = await this.db.query(sql, this.values);
      if (mode === 'single' && rows.length !== 1 || mode === 'maybe' && rows.length > 1) throw new Error('row count mismatch');
      return { data: mode ? rows[0] || null : rows, error: null };
    } catch (error) { return { data: null, error: { message: error.message, code: error.code } }; }
  }
}

export async function fixture() {
  const db = new PGlite(), files = new Map(), calls = [], signed = [];
  await db.exec(`CREATE SCHEMA auth;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.designpro_qc_members(user_id uuid PRIMARY KEY,can_preflight boolean);
    INSERT INTO auth.users VALUES('${ACTOR}'),('${OWNER}'),('${OTHER}');
    INSERT INTO public.designpro_qc_members VALUES('${ACTOR}',true);`);
  // Exercise the new SQL against the actual existing bank definition. The rest
  // of the production graph has its own full migration test fixture.
  await db.exec(preceding.slice(0, preceding.indexOf('CREATE TABLE public.panelprofile_runs')));
  await db.exec(preceding.match(/CREATE FUNCTION public\.panelprofile_reject_mutation\(\)[\s\S]*?END \$\$;/)[0]);
  await db.exec(lifecycle);
  const bucket = {
    async upload(path, bytes, options) {
      if (options.upsert !== false) throw new Error('immutable writes required');
      if (files.has(path)) return { error: { statusCode: 409, message: 'The resource already exists' } };
      files.set(path, Buffer.from(bytes)); return { data: { path }, error: null };
    },
    async download(path) { return files.has(path) ? { data: new Blob([files.get(path)]), error: null }
      : { data: null, error: { statusCode: 404, message: 'Object not found' } }; },
    async createSignedUrl(path, seconds) {
      if (!files.has(path)) return { error: { statusCode: 404 } };
      signed.push({ path, seconds }); return { data: { signedUrl: `https://private.example.invalid/${encodeURIComponent(path)}` }, error: null };
    },
  };
  const supabase = {
    storage: { from(name) { if (name !== 'wrap-files') throw new Error('unexpected bucket'); return bucket; } },
    from(table) { return new Query(db, table); },
    async rpc(name, args) {
      try {
        const values = Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value);
        const { rows } = await db.query(`SELECT public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) AS result`, values);
        return { data: rows[0].result, error: null };
      } catch (error) { return { data: null, error: { message: error.message, code: error.code } }; }
    },
  };
  const write = (bytes, role, ownerId = OWNER) => {
    const contentHash = sha(bytes), storagePath = `designpro/user_${ownerId}/${SOURCE_JOB}/uploads/${role}-${contentHash}.dat`;
    files.set(storagePath, Buffer.from(bytes)); return { storagePath, contentHash };
  };
  const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#eee' } }).png().toBuffer();
  const brand = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"><rect width="80" height="30" fill="#06c"/></svg>');
  const vehicle = { make: 'Chevrolet', model: 'Camaro', year: '2020', bodyStyle: 'coupe', wheelbaseInches: 110.7 };
  const geometry = { contractVersion: 'designpro.vehicle-template-geometry.v1', units: 'in', templateId: 'camaro-2020-coupe', version: '1', vehicle,
    pieces: [{ pieceId: 'driver', widthInches: 20, heightInches: 10, outlineInches: [[0, 0], [20, 0], [20, 10], [0, 10]],
      cutAreas: [{ areaId: 'window', pointsInches: [[6, 2], [10, 2], [10, 5], [6, 5]] }] }] };
  const input = { ownerId: OWNER, templateId: geometry.templateId, version: geometry.version,
    geometry: write(Buffer.from(JSON.stringify(geometry)), 'geometry'), sourceRaster: write(png, 'raster'),
    sourceVector: write(Buffer.from('%PDF-1.7\nFixture original measured template\n'), 'vector'), brand: write(brand, 'brand'),
    review: { reviewRef: 'geometry-review-1', measuredDimensions: true, cutAreasReviewed: true, rasterMatchesVector: true,
      vehicleIdentity: vehicle, fitToleranceInches: 0.125, physicalMeasurementReference: 'fixture-measurements-1' } };
  const invoke = async request => {
    calls.push(request);
    return { status: 200, payload: { id: 'v1_template_fixture', model: 'gemini-3-pro-image', status: 'completed', steps: [
      { type: 'thought', signature: 'private-signature-only-fixture' },
      { type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: png.toString('base64') }] },
    ] } };
  };
  return { db, files, calls, signed, bucket, supabase, input, invoke, write, geometry, brand, png };
}

export function reviewOf(candidate) {
  return { candidateId: candidate.candidateId, candidateHash: candidate.candidateHash,
    review: { reviewId: 'display-review-1', approved: true, displayContentHash: candidate.displayContentHash,
      geometryHash: candidate.geometryHash, cutGeometryReviewed: true, displayAlignmentReviewed: true,
      displayRegions: [{ pieceId: 'driver', displayRegionPixels: { x: 0, y: candidate.displayMetadata.headerHeight, width: 200, height: 100 } }] } };
}
