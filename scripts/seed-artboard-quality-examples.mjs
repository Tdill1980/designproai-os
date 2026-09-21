// Seed the Call-1 quality-reference prefix, `wrap-files/designpanel-artboard-examples/`.
//
// WHY THIS IS NOT A FILE COPY, WHICH IS THE WHOLE POINT.
//
// Both consumers read this prefix themselves and BOTH SKIP AN OVERSIZED FILE
// SILENTLY, by design -- a quality reference must never cost a customer their
// generation, so the loaders `continue` past anything too large and return an
// empty list. Measured caps, read off the deployed code:
//
//   design-panel-ai-generate  ATLAS_QUALITY_ARTBOARD_MAX_BYTES = 2 MiB
//   production-panel-proof    ARTBOARD_QUALITY_MAX_BYTES       = 8 MiB
//
// The gold-standard masters are 27.0 MiB (2165a36c) and 17.3 MiB (1564c66d).
// Copying either one in unchanged puts a file in the bucket that EVERY loader
// skips: the prefix lists two objects, this job reports success, and Call 1
// goes on designing exactly as blind as before. That is the "receipts green,
// pixels wrong" failure this repo has recorded four separate times, and it is
// the reason this script re-encodes instead of copying.
//
// So each master is downscaled to fit the STRICTER of the two caps, which is
// the 2 MiB one -- a file that clears 2 MiB clears both consumers. It is a
// quality bar, not a gate and not artwork: it is never cut, never printed, and
// under RULE 0.24 it can never become CREATIVE authority, because the loaders
// read it themselves and it can never arrive as `customerAssets`.
//
// It writes ONLY under `designpanel-artboard-examples/`. It never touches a
// master, a revision row, bucket visibility, the DAG or any edge function.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = "wrap-files";
const PREFIX = "designpanel-artboard-examples";

/** The stricter consumer's ceiling. Clear this and both loaders accept. */
const CONSUMER_CAP_BYTES = 2 * 1024 * 1024;
/** Headroom under it, so a re-encode that lands near the line still passes. */
const TARGET_BYTES = 1_900_000;

/**
 * Largest first. The reference is teaching craft -- lettering weight, layered
 * depth, how one composition lands across six surfaces -- so resolution is the
 * thing being spent, and the ladder stops at the FIRST rung that fits rather
 * than shrinking to a comfortable default.
 */
const LADDER = [
  { width: 3072, quality: 88 },
  { width: 2816, quality: 86 },
  { width: 2560, quality: 86 },
  { width: 2304, quality: 84 },
  { width: 2048, quality: 84 },
  { width: 1792, quality: 82 },
  { width: 1536, quality: 80 },
  { width: 1280, quality: 78 },
  { width: 1024, quality: 75 },
];

const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] || null);
};
const has = (name) => process.argv.includes(name);

const mastersInput = (flag("--masters") || "").trim();
const outDir = flag("--out") || "/out";
const write = has("--write");

if (!mastersInput) {
  console.error("usage: --masters <hash-prefix>[,<hash-prefix>...] [--write] [--out DIR]");
  process.exit(2);
}

// Hex prefixes only. This is the sole selector that reaches a private bucket
// object, so it cannot be widened into an arbitrary path.
const selectors = mastersInput.split(",").map((s) => s.trim()).filter(Boolean);
for (const selector of selectors) {
  if (!/^[0-9a-f]{8,64}$/.test(selector)) {
    console.error(`refusing selector ${JSON.stringify(selector)}: expected 8-64 hex characters of a master content hash`);
    process.exit(3);
  }
}
if (selectors.length > 2) {
  // The loaders take at most the first two. A third would be written, listed,
  // and never shown to the model -- a file that looks seeded and teaches
  // nothing, which is the exact illusion this script exists to prevent.
  console.error(`refusing ${selectors.length} masters: both consumers read at most 2, so the rest would be dead weight in the prefix`);
  process.exit(4);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be present (they come from the droplet's runtime.env)");
  process.exit(5);
}
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mib = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;

async function resolveMaster(selector) {
  const { data, error } = await svc
    .from("designpro_flat_atlas_revisions")
    .select("master_storage_path, master_content_hash, master_byte_size, width_px, height_px, generation_id, metadata, created_at")
    .like("master_content_hash", `${selector}%`)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`revision lookup failed for ${selector}: ${error.message}`);
  const rows = (data || []).filter((row) => row.master_storage_path);
  if (!rows.length) throw new Error(`no revision carries a master whose hash starts ${selector}`);
  // An ambiguous selector must never be resolved by picking one.
  const distinct = new Set(rows.map((row) => row.master_content_hash));
  if (distinct.size > 1) {
    throw new Error(`selector ${selector} matches ${distinct.size} distinct masters; pass more of the hash`);
  }
  return rows[0];
}

/** Step down the ladder and stop at the first rung inside the budget. */
async function encodeWithinBudget(sourceBytes) {
  let last = null;
  for (const rung of LADDER) {
    const encoded = await sharp(sourceBytes)
      .resize({ width: rung.width, withoutEnlargement: true })
      .jpeg({ quality: rung.quality, mozjpeg: true, chromaSubsampling: "4:4:4" })
      .toBuffer();
    last = { ...rung, bytes: encoded };
    if (encoded.byteLength <= TARGET_BYTES) return last;
  }
  return last;
}

const results = [];
mkdirSync(outDir, { recursive: true });

for (const [index, selector] of selectors.entries()) {
  const row = await resolveMaster(selector);
  const hash = row.master_content_hash;
  console.error(`\n=== ${hash.slice(0, 16)} ===`);
  console.error(`  source path   ${row.master_storage_path}`);
  console.error(`  source size   ${mib(Number(row.master_byte_size || 0))}  (${row.width_px}x${row.height_px})`);

  const { data: blob, error: downloadError } = await svc.storage.from(BUCKET).download(row.master_storage_path);
  if (downloadError || !blob) throw new Error(`download failed for ${hash.slice(0, 16)}: ${downloadError?.message || "no body"}`);
  const sourceBytes = Buffer.from(await blob.arrayBuffer());

  // Prove the bytes are the master the row names, exactly as the read-only
  // exporter does. A quality bar built from unverified bytes teaches whatever
  // happened to be at that path.
  const observed = sha256(sourceBytes);
  if (observed !== hash) {
    throw new Error(`hash mismatch at ${row.master_storage_path}: row says ${hash}, bytes are ${observed}`);
  }
  console.error(`  hash verified ${observed.slice(0, 16)} matches the revision row`);

  const encoded = await encodeWithinBudget(sourceBytes);
  const fits = encoded.bytes.byteLength <= CONSUMER_CAP_BYTES;
  console.error(`  encoded       ${mib(encoded.bytes.byteLength)} at ${encoded.width}px q${encoded.quality}  ${fits ? "FITS" : "STILL OVER THE 2 MiB CAP"}`);
  if (!fits) {
    throw new Error(`${hash.slice(0, 16)} could not be brought under the 2 MiB consumer cap; it would be skipped silently`);
  }

  // The loaders take the first two entries of a name-ordered listing, so the
  // index makes which-two explicit instead of incidental.
  const name = `${String(index + 1).padStart(2, "0")}-${hash.slice(0, 16)}.jpg`;
  const objectPath = `${PREFIX}/${name}`;
  writeFileSync(join(outDir, name), encoded.bytes);

  if (write) {
    const { error: uploadError } = await svc.storage.from(BUCKET).upload(objectPath, encoded.bytes, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (uploadError) throw new Error(`upload failed for ${objectPath}: ${uploadError.message}`);
    console.error(`  uploaded      ${objectPath}`);
  } else {
    console.error(`  DRY RUN       would upload ${objectPath} (pass --write to seed)`);
  }

  results.push({
    master: hash.slice(0, 16),
    generationId: row.generation_id,
    sourceBytes: Number(row.master_byte_size || sourceBytes.byteLength),
    encodedBytes: encoded.bytes.byteLength,
    width: encoded.width,
    quality: encoded.quality,
    objectPath,
    cutoutSurfaces: row.metadata?.masterCutoutSurfaces ?? null,
  });
}

// VERIFY FROM THE BUCKET, NOT FROM THE UPLOAD CALL. A 200 on upload proves the
// request was accepted; re-reading the prefix the way the loaders read it is
// what proves the model will actually be shown these files.
console.error("\n=== verification: the prefix as the loaders see it ===");
const { data: listed, error: listError } = await svc.storage.from(BUCKET).list(PREFIX, { limit: 10 });
if (listError) throw new Error(`verification listing failed: ${listError.message}`);
const visible = (listed || []).filter((file) => /\.(png|jpe?g|webp)$/i.test(String(file?.name || "")));

if (!visible.length) {
  console.error(write ? "  EMPTY -- the seed did not land" : "  empty (dry run wrote nothing)");
}
for (const file of visible.slice(0, 2)) {
  const path = `${PREFIX}/${file.name}`;
  const { data: back, error: backError } = await svc.storage.from(BUCKET).download(path);
  if (backError || !back) {
    console.error(`  ${file.name}  UNREADABLE (${backError?.message || "no body"})`);
    continue;
  }
  const bytes = Buffer.from(await back.arrayBuffer());
  const meta = await sharp(bytes).metadata();
  const accepted = bytes.byteLength > 0 && bytes.byteLength <= CONSUMER_CAP_BYTES;
  console.error(
    `  ${file.name}  ${mib(bytes.byteLength)}  ${meta.width}x${meta.height} ${meta.format}  ` +
    `${accepted ? "ACCEPTED by both loaders" : "SKIPPED -- over the 2 MiB cap"}`,
  );
}
if (visible.length > 2) {
  console.error(`  (${visible.length - 2} further file(s) present and never read: the loaders take the first two)`);
}

writeFileSync(join(outDir, "seed-report.json"), JSON.stringify({ wrote: write, results }, null, 2));
console.error(`\n${write ? "seeded" : "dry run complete"}: ${results.length} example(s)`);
