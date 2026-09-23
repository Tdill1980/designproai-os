#!/usr/bin/env node
/**
 * PUBLISH THE WALL CATALOG WITHOUT A BROWSER (owner, Trish 2026-09-23: "You do it").
 *
 * `wallpro_designs` had ZERO rows on production, so the customer-facing
 * "choose from library" path opened onto an empty grid. Populating it was, up
 * to now, a human clicking Run and then Publish on `/admin/wallpro-batch` --
 * and every pixel step on that page (measure, blend, thumbnail) is
 * `<canvas>`, so nothing about it could run anywhere else.
 *
 * ── WHY THIS IS NOT A SECOND PRODUCER ─────────────────────────────────────
 *
 * RULE 0.21 forbids a second thing that makes the same artifact, and a
 * headless copy of the batch pipeline would be exactly that. So this runner
 * makes NOTHING of its own:
 *
 *   the design      `generate-wall-design`, the same edge function the
 *                   customer designer and the batch page both call, reached
 *                   with a REAL user JWT so the two personas, the brief, the
 *                   charge decision and the storage path are all unchanged
 *   the brief       `briefForEntry` -- the app's own, bundled, not restated
 *   the row         `designUpsertRow` -- the app's own validator, so a row
 *                   this writes is a row the page would have written
 *   the seam        `measureSeam` / `blendSeamless` / `seamLadder` /
 *                   `seamlessReceipt` -- the app's own pure functions
 *
 * The ONLY thing that is new here is the DECODE: `sharp` stands in for
 * `<canvas>` to get RGBA out of a PNG, to re-encode a blended tile and to cut
 * the 640px thumbnail. That is a transport swap, not a second decision.
 *
 * ── THE JWT, AND WHY IT IS NOT A BACK DOOR ────────────────────────────────
 *
 * `generate-wall-design` resolves `sb.auth.getUser(jwt)` and refuses anything
 * that is not a real user -- correctly, because that user id becomes the
 * storage folder AND decides free-versus-charged. A service-role key is not a
 * user, so this mints a genuine session for the named curator through the
 * admin API, through the installed supabase-js client. It cannot reach a user who is not
 * already an admin/tester, because the catalog's own RLS and the batch's
 * charge exemption both key on `user_roles`. The token is never logged.
 *
 * ── IT STAGES; IT DOES NOT PUT ANYTHING IN THE SHOP WINDOW ────────────────
 *
 * Owner, 2026-09-23: "I'd rather check the library first make sure it's good."
 * The admin page publishes `approved` + active because a human has just LOOKED
 * at the design before pressing Publish. Nobody has looked at these. So every
 * row this writes is `generated` + hidden, and the public SELECT policy
 * (`is_active AND approval_status='approved'`) means no customer can reach one.
 * The curator read policy has no such filter, so they appear in the admin
 * gallery with their thumbnails and their Active toggle — the review loop that
 * already exists. `--live` overrides it, and nothing calls it by default.
 *
 * ── SAFE TO RUN TWICE ─────────────────────────────────────────────────────
 *
 * Already-published DesignIDs are skipped (`selectLibraryEntries` takes the
 * published set), each job is independent, and a failure is reported and
 * stepped over rather than taking the batch down. `--run-mode` picks how far
 * it goes: `check-auth` proves only the credential, `plan` prints the
 * selection, `publish` generates and writes.
 */
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { arg as parseArg, flag as parseFlag } from './wallpro-catalog-args.mjs';
import {
  WALL_PRESETS, presetAsEntry,
  designUpsertRow, catalogMasterPath, catalogThumbPath, briefForEntry,
  batchDimensions, engineForDesignType, selectLibraryEntries, libraryEntryDomain,
  batchDiversitySummary, CATALOG_THUMB_PX, DEFAULT_TILE_WIDTH_IN,
  measureSeam, blendSeamless, seamLadder, shouldTryBlend, seamlessReceipt,
} from './catalog-lib.mjs';

const BUCKET = 'wallpro-files';
// Both `--name value` and `--name=value`, in a module a test can execute --
// see scripts/wallpro-catalog-args.mjs for why that matters.
const arg = (name, fallback = null) => parseArg(process.argv, name, fallback);
const flag = name => parseFlag(process.argv, name);

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CURATOR_EMAIL = arg('email', process.env.WALLPRO_CURATOR_EMAIL);
const COUNT = Number(arg('count', '12'));
const MODE = arg('mode', 'mural');           // mural | repeat | both
const DOMAIN = arg('domain', 'all');          // residential | commercial | all
// ONE MODE, VALIDATED AGAINST AN EXACT ALLOWLIST.
//
//   check-auth  mint the curator session, prove the token resolves back to
//               that user, read the role. No generation, no write, no cost.
//   plan        print the selection and the diversity tally. Nothing else.
//   publish     generate through the edge function and write the rows.
//
// It is ONE value and not a flag per mode on purpose: with a flag per safe
// mode, "publish" is the state where none of them is set, so an unrecognised
// value falls through to the only branch that spends money and writes to a
// public catalog. Anything not on this list is refused here, before a
// credential is touched.
const RUN_MODE = arg('run-mode', 'check-auth');
if (!['check-auth', 'plan', 'publish'].includes(RUN_MODE)) {
  throw new Error(`--run-mode must be check-auth, plan or publish; got "${RUN_MODE}".`);
}
const CHECK_AUTH = RUN_MODE === 'check-auth';
const DRY_RUN = RUN_MODE === 'plan';
// Staged unless explicitly told otherwise. A batch nobody has looked at must
// not be able to reach a customer by default.
const GO_LIVE = flag('live');
const BATCH_ID = arg('batch-id', 'wallbatch_' + Date.now());

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
if (!CURATOR_EMAIL) throw new Error('Pass --email=<curator> (an admin/tester account).');
if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 60) throw new Error('--count must be 1..60.');
if (!['mural', 'repeat', 'both'].includes(MODE)) throw new Error('--mode must be mural, repeat or both.');

const svc = (extra = {}) => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra });
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function json(res, what) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} failed HTTP ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

/**
 * A REAL session for the curator, minted through the CLIENT, not hand-rolled REST.
 *
 * `generate-wall-design` resolves `sb.auth.getUser(jwt)` and refuses anything
 * that is not a user, so the batch needs a genuine access token for a named
 * admin/tester. There is no user password here and there must not be one, so
 * the session comes from the admin API: mint a one-time verification token for
 * the account, then redeem it.
 *
 * ── WHY supabase-js AND NOT fetch ─────────────────────────────────────────
 *
 * The first draft POSTed `/auth/v1/admin/generate_link` and `/auth/v1/verify`
 * by hand with a guessed body shape. GoTrue has moved that wire format more
 * than once — `token` vs `token_hash`, the OTP type that redeems a magic link,
 * where `hashed_token` sits in the response — and a guess that is wrong fails
 * at the ONE step that cannot be tested without the service key. The installed
 * client (`@supabase/supabase-js` 2.55.0, already in the runtime image) knows
 * the format of the server it ships against, so it is the transport. RULE 1:
 * use the proven implementation rather than reimplement the protocol.
 *
 * `verifyOtp` is still tried on both OTP types, because which one redeems a
 * magic-link hash is exactly the detail that has moved; the one that works is
 * REPORTED, so the next run is knowledge rather than another guess.
 *
 * The token is returned and never logged, and the one-time hash is consumed by
 * the redeem, so nothing reusable is left behind.
 */
async function curatorToken(email) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw new Error(`Minting a curator session failed: ${link.error.message}`);
  const hashed = link.data?.properties?.hashed_token;
  if (!hashed) throw new Error(`The admin API returned no verification token for ${email}.`);

  const reasons = [];
  for (const type of ['magiclink', 'email']) {
    const redeemed = await admin.auth.verifyOtp({ token_hash: hashed, type });
    if (redeemed.error) { reasons.push(`${type}: ${redeemed.error.message}`); continue; }
    const session = redeemed.data?.session;
    if (!session?.access_token || !redeemed.data?.user?.id) { reasons.push(`${type}: no session returned`); continue; }
    return { token: session.access_token, userId: redeemed.data.user.id, otpType: type };
  }
  throw new Error(`No session could be redeemed for ${email} — ${reasons.join(' · ')}`);
}

async function requireCurator(userId) {
  const roles = await json(await fetch(
    `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role`, { headers: svc() }),
    'Reading curator roles');
  const owned = (roles || []).map(r => r.role);
  if (!owned.some(r => r === 'admin' || r === 'tester')) {
    throw new Error(`${CURATOR_EMAIL} is not an admin or tester; the catalog's RLS would refuse every row.`);
  }
  return owned;
}

const publishedIds = async () => new Set(((await json(await fetch(
  `${SUPABASE_URL}/rest/v1/wallpro_designs?select=design_id`, { headers: svc() }),
  'Reading the published catalog')) || []).map(r => r.design_id));

async function generation(id) {
  const rows = await json(await fetch(
    `${SUPABASE_URL}/rest/v1/wallpro_generations?id=eq.${id}&select=id,state,artwork_path,input_hash,error`,
    { headers: svc() }), 'Reading the generation ledger');
  return rows?.[0] || null;
}

/** The ledger is the authority on the outcome, exactly as `generateWall` treats
 * it in the app: a transport failure over a completed row is still a success. */
async function settle(id, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const row = await generation(id);
    if (row?.state === 'completed' && row.artwork_path) return row;
    if (row?.state === 'failed') throw new Error(row.error || 'The generator refused this brief.');
    if (Date.now() > until) throw new Error('The generation did not settle within ' + Math.round(timeoutMs / 1000) + 's.');
    await sleep(3000);
  }
}

const download = async path => Buffer.from(await (await fetch(
  `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: svc() })).arrayBuffer());

async function storageCopy(from, to) {
  return json(await fetch(`${SUPABASE_URL}/storage/v1/object/copy`, {
    method: 'POST', headers: svc({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ bucketId: BUCKET, sourceKey: from, destinationKey: to }),
  }), `Copying ${from} into the catalog`);
}

async function storageUpload(to, body, contentType) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${to}`, {
    method: 'POST', headers: svc({ 'Content-Type': contentType, 'x-upsert': 'true' }), body,
  });
  if (!res.ok) throw new Error(`Uploading ${to} failed HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Zone 2 of this job: the seam ladder, run on real pixels. Murals never tile,
 * so they are returned untouched with no receipt -- which is what the table's
 * own `mode <> 'repeat' OR seam IS NOT NULL` CHECK expects. */
async function seamDecision(mode, bytes) {
  if (mode !== 'repeat') return { bytes, receipt: null, mime: null };
  const img = sharp(bytes, { limitInputPixels: false });
  const { width, height } = await img.metadata();
  const rgba = await img.ensureAlpha().raw().toBuffer();
  const before = measureSeam(rgba, width, height);
  let after = null, blendedBytes = null;
  if (shouldTryBlend(before, 'auto')) {
    const blended = blendSeamless(rgba, width, height);
    after = measureSeam(blended, width, height);
    blendedBytes = await sharp(Buffer.from(blended.buffer, blended.byteOffset, blended.length),
      { raw: { width, height, channels: 4 } }).png().toBuffer();
  }
  const method = seamLadder(before, after, 'auto');
  const receipt = seamlessReceipt('auto', before, method === 'blend' ? after : null, method);
  // Only a BLEND changes the pixels; verified and mirror publish the generated
  // tile byte for byte, so the master stays the artwork the model returned.
  return method === 'blend'
    ? { bytes: blendedBytes, receipt, mime: 'image/png' }
    : { bytes, receipt, mime: null };
}

async function publishOne(entry, mode, auth) {
  const requestId = randomUUID();
  const dims = batchDimensions(mode);
  const domain = libraryEntryDomain(entry).designDomain;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-wall-design`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId, prompt: briefForEntry(entry),
      width: dims.width, height: dims.height, placement: dims.placement,
      repeatWidthIn: mode === 'repeat' ? DEFAULT_TILE_WIDTH_IN : undefined,
      wallPath: null, referencePath: null,
      libraryIndustry: entry.industry, libraryRoom: entry.room, libraryStyle: entry.style,
      designDomain: entry.domain ?? domain,
    }),
  });
  // A non-2xx is not yet a failure: the ledger decides, same as the app.
  if (!res.ok) await res.text().catch(() => '');
  const record = await settle(requestId);

  const generated = await download(record.artwork_path);
  const decided = await seamDecision(mode, generated);
  const masterBytes = decided.bytes;

  const meta = await sharp(masterBytes, { limitInputPixels: false }).metadata();
  const mime = decided.mime || (meta.format === 'jpeg' ? 'image/jpeg' : meta.format === 'webp' ? 'image/webp' : 'image/png');
  const fileId = randomUUID();
  const masterPath = catalogMasterPath(fileId, mime);
  const thumbPath = catalogThumbPath(fileId);

  const row = designUpsertRow({
    entry, mode,
    tileWidthIn: mode === 'repeat' ? DEFAULT_TILE_WIDTH_IN : null,
    generationId: record.id, promptHash: record.input_hash,
    masterPath, thumbPath, masterSha256: sha256(masterBytes),
    widthPx: meta.width, heightPx: meta.height,
    seam: decided.receipt, batchId: BATCH_ID, createdBy: auth.userId,
    approvalStatus: GO_LIVE ? 'approved' : 'generated', isActive: GO_LIVE,
  });

  // Bytes before the row: a catalog row whose master 404s is worse than no row.
  if (decided.mime) await storageUpload(masterPath, masterBytes, mime);
  else await storageCopy(record.artwork_path, masterPath);
  await storageUpload(thumbPath,
    await sharp(masterBytes, { limitInputPixels: false }).resize(CATALOG_THUMB_PX).jpeg({ quality: 82 }).toBuffer(),
    'image/jpeg');

  await json(await fetch(`${SUPABASE_URL}/rest/v1/wallpro_designs?on_conflict=design_id`, {
    method: 'POST',
    headers: svc({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([row]),
  }), `Publishing ${entry.id}`);

  return { id: entry.id, title: entry.title, mode, seam: decided.receipt?.method ?? null, px: `${meta.width}x${meta.height}`, live: GO_LIVE };
}

async function main() {
  if (CHECK_AUTH) {
    const auth = await curatorToken(CURATOR_EMAIL);
    const roles = await requireCurator(auth.userId);
    console.log(`curator ${CURATOR_EMAIL} -> user ${auth.userId}`);
    console.log(`roles: ${roles.join(', ')}`);
    console.log(`session redeemed as OTP type "${auth.otpType}"`);
    // Prove the token is a USER to the same door the batch must pass, rather
    // than trusting that a session object means the edge will accept it.
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${auth.token}` },
    });
    const seen = who.ok ? (await who.json())?.id : null;
    if (seen !== auth.userId) throw new Error(`The minted token did not resolve back to ${auth.userId} (HTTP ${who.status}).`);
    console.log('the token resolves to that user through auth/v1/user — the edge will accept it');
    console.log('check-auth only: nothing generated, nothing written.');
    return;
  }

  const library = WALL_PRESETS.map(presetAsEntry)
    .filter(e => MODE === 'both' || engineForDesignType(e.designType) === MODE);
  const published = await publishedIds();
  const chosen = selectLibraryEntries(library, { domain: DOMAIN }, published).slice(0, COUNT);

  console.log(`catalog: ${published.size} published · library: ${library.length} ${MODE} entries · selected: ${chosen.length}`);
  console.log('diversity: ' + JSON.stringify(batchDiversitySummary(chosen)));
  if (!chosen.length) { console.log('Nothing left to publish for this filter.'); return; }

  if (DRY_RUN) {
    for (const e of chosen) console.log(`  would publish ${e.id} · ${e.title} · ${engineForDesignType(e.designType)} · ${libraryEntryDomain(e).designDomain}`);
    console.log('dry run: nothing generated, nothing written.');
    return;
  }

  const auth = await curatorToken(CURATOR_EMAIL);
  console.log(`curator ${CURATOR_EMAIL} roles: ${(await requireCurator(auth.userId)).join(', ')}`);

  const done = [], failed = [];
  for (const entry of chosen) {
    const mode = engineForDesignType(entry.designType);
    try {
      const out = await publishOne(entry, mode, auth);
      done.push(out);
      console.log(`  ✓ ${out.id} · ${out.title} · ${out.mode}${out.seam ? ' · seam ' + out.seam : ''} · ${out.px}`);
    } catch (err) {
      failed.push({ id: entry.id, reason: String(err?.message || err) });
      console.log(`  ✗ ${entry.id} · ${String(err?.message || err).slice(0, 220)}`);
    }
    await sleep(1500);
  }

  const total = (await publishedIds()).size;
  console.log(`\n${GO_LIVE ? 'published LIVE' : 'staged HIDDEN'} ${done.length}, failed ${failed.length} · catalog now holds ${total} designs`);
  if (!GO_LIVE && done.length) {
    console.log('None of these reach a customer yet. Review them in the admin');
    console.log('gallery at /admin/wallpro-batch and press Active on the keepers.');
  }
  if (!done.length) { console.error('No design published.'); process.exitCode = 1; }
}

main().catch(err => { console.error(String(err?.message || err)); process.exit(1); });
