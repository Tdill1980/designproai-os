#!/usr/bin/env node
// Index every existing DesignPro generation into the design archive.
//
//   node scripts/designpro-archive-backfill.mjs            # DRY RUN (default): reports, writes nothing
//   node scripts/designpro-archive-backfill.mjs --apply    # indexes in batches until nothing is pending
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (the
// droplet's runtime env). The RPC refuses any other role. Free-text order
// numbers ("WPW real-order test #30292") are PRINTED for a human to confirm and
// are never bound automatically; see docs/DESIGN-ARCHIVE.md.
const apply = process.argv.includes('--apply');
const batch = Number(process.argv.find((a) => a.startsWith('--batch='))?.slice(8) || 500);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(2);
}

async function call(dryRun) {
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/designpro_archive_backfill`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_limit: batch, p_dry_run: dryRun }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`backfill RPC ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const first = await call(true);
console.log(`pending (first batch of up to ${batch}): ${first.pending}`);
console.log(`free-text order-number candidates (NOT bound): ${first.freeTextOrderCandidates.length}`);
for (const c of first.freeTextOrderCandidates) console.log(`  ${c.designId}  #${c.candidateOrderNumber}  ${c.designName}`);
if (!apply) {
  console.log('Dry run. Re-run with --apply to index.');
  process.exit(0);
}
let total = 0;
for (let i = 0; i < 100; i += 1) {
  const r = await call(false);
  total += r.indexed;
  console.log(`batch ${i + 1}: indexed ${r.indexed}`);
  if (r.pending < batch) break;
}
const after = await call(true);
console.log(`indexed ${total}; still pending ${after.pending}`);
process.exit(after.pending === 0 ? 0 : 1);
