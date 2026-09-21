// Seed the Call-1 quality-reference prefix, `wrap-files/designpanel-artboard-examples/`.
//
// WHY THIS IS NOT A PLAIN FILE COPY.
//
// Both consumers read this prefix themselves and BOTH SKIP AN OVERSIZED FILE
// SILENTLY, by design -- they fail soft so a quality reference can never cost a
// customer their generation. Measured caps, read off the deployed code:
//
//   design-panel-ai-generate  ATLAS_QUALITY_ARTBOARD_MAX_BYTES = 2 MiB
//   production-panel-proof    ARTBOARD_QUALITY_MAX_BYTES       = 8 MiB
//
// A flat A.T.L.A.S. master is 17-27 MiB. Copying one in unchanged lands an
// object that EVERY loader skips: the prefix lists it, the job reports success,
// and Call 1 goes on designing blind. Receipts green, pixels unchanged -- the
// failure shape this repo has recorded four times. So anything over budget is
// re-encoded down until it clears the stricter 2 MiB cap.
//
// BUT IT NEVER RE-ENCODES SOMETHING THAT ALREADY FITS. The owner's format sheet
// is 1,870,997 bytes -- already inside the cap -- and it is the approved
// standard down to its finish and type. Re-encoding it to normalise the
// pipeline would degrade the exact pixels that make it the bar, for no gain. A
// source within budget is copied byte for byte.
//
// It writes ONLY under `designpanel-artboard-examples/`. It never touches a
// master, a pinned example, a revision row, bucket visibility, the DAG or any
// edge function.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = "wrap-files";
const PREFIX = "designpanel-artboard-examples";
/** The only other prefix a source may be read from: the pinned teaching set. */
const EXAMPLE_PREFIX = "atlas-examples";

/** The stricter consumer's ceiling. Clear this and both loaders accept. */
const CONSUMER_CAP_BYTES = 2 * 1024 * 1024;
/** Headroom under it, so a re-encode landing near the line still passes. */
const TARGET_BYTES = 1_900_000;

/**
 * Known pins, so a copy of a teaching asset is verified rather than trusted.
 * Source of truth: `_shared/atlas-panel-proof-prompt.ts`. A path absent here is
 * still allowed -- its hash is reported, just not asserted.
 */
const PINNED = {
  "atlas-examples/panel-proof-zones-filled.png":
    "9586710b026e22b3b2c5f80379382b31a211852c7c5128d10d0d356a0534d108",
};

/**
 * Largest first. The reference teaches craft -- lettering weight, layered
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

const sourcesInput = (flag("--sources") || flag("--masters") || "").trim();
const outDir = flag("--out") || "/out";
const write = has("--write");

if (!sourcesInput) {
  console.error("usage: --sources <hash-prefix|atlas-examples/file.png>[,...] [--write] [--out DIR]");
  process.exit(2);
}

const HASH_SELECTOR = /^[0-9a-f]{8,64}$/;
const PATH_SELECTOR = new RegExp(`^${EXAMPLE_PREFIX}/[A-Za-z0-9._-]+\\.(png|jpe?g|webp)$`);

const selectors = sourcesInput.split(",").map((s) => s.trim()).filter(Boolean);
for (const selector of selectors) {
  // Two shapes only. These are the sole selectors that reach an object in a
  // private bucket, so neither can be widened into an arbitrary path.
  if (!HASH_SELECTOR.test(selector) && !PATH_SELECTOR.test(selector)) {
    console.error(`refusing selector ${JSON.stringify(selector)}: expected 8-64 hex of a master content hash, or an ${EXAMPLE_PREFIX}/ image path`);
    process.exit(3);
  }
}
if (selectors.length > 2) {
  // The loaders take at most the first two. A third would be written, listed,
  // and never shown to the model -- a file that looks seeded and teaches
  // nothing, which is the exact illusion this script exists to prevent.
  console.error(`refusing ${selectors.length} sources: both consumers read at most 2, so the rest would be dead weight in the prefix`);
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

/** A flat A.T.L.A.S. master, located by content-hash prefix. */
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
  const row = rows[0];
  return {
    kind: "flat-master",
    label: row.master_content_hash.slice(0, 16),
    path: row.master_storage_path,
    expectedHash: row.master_content_hash,
    note: `${row.width_px}x${row.height_px}, generation ${row.generation_id}`,
    cutoutSurfaces: row.metadata?.masterCutoutSurfaces ?? null,
  };
}

/** A pinned teaching asset, taken by its own path. */
function resolveExample(selector) {
  return {
    kind: "teaching-example",
    label: selector.slice(EXAMPLE_PREFIX.length + 1).replace(/\.(png|jpe?g|webp)$/i, ""),
    path: selector,
    expectedHash: PINNED[selector] || null,
    note: PINNED[selector] ? "hash-pinned in atlas-panel-proof-prompt.ts" : "not pinned in source; hash reported only",
    cutoutSurfaces: null,
  };
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
  const source = HASH_SELECTOR.test(selector) ? await resolveMaster(selector) : resolveExample(selector);
  console.error(`\n=== ${source.label} (${source.kind}) ===`);
  console.error(`  source path   ${source.path}`);
  console.error(`  note          ${source.note}`);

  const { data: blob, error: downloadError } = await svc.storage.from(BUCKET).download(source.path);
  if (downloadError || !blob) throw new Error(`download failed for ${source.path}: ${downloadError?.message || "no body"}`);
  const sourceBytes = Buffer.from(await blob.arrayBuffer());
  const observed = sha256(sourceBytes);

  // Prove the bytes are what the row or the pin names. A quality bar built
  // from unverified bytes teaches whatever happened to be at that path.
  if (source.expectedHash) {
    if (observed !== source.expectedHash) {
      throw new Error(`hash mismatch at ${source.path}: expected ${source.expectedHash}, bytes are ${observed}`);
    }
    console.error(`  hash verified ${observed.slice(0, 16)} matches the ${source.kind === "flat-master" ? "revision row" : "source pin"}`);
  } else {
    console.error(`  hash observed ${observed.slice(0, 16)} (no pin to check against)`);
  }
  console.error(`  source size   ${mib(sourceBytes.byteLength)}`);

  // THE APPROVED PIXELS WIN. Within budget, the file is copied untouched --
  // re-encoding the owner's format sheet would degrade the finish and type that
  // are the reason it is the standard.
  let payload;
  let extension;
  let disposition;
  if (sourceBytes.byteLength <= CONSUMER_CAP_BYTES) {
    const meta = await sharp(sourceBytes).metadata();
    payload = sourceBytes;
    extension = meta.format === "jpeg" ? "jpg" : meta.format === "webp" ? "webp" : "png";
    disposition = `copied unchanged (${meta.width}x${meta.height} ${meta.format})`;
  } else {
    const encoded = await encodeWithinBudget(sourceBytes);
    if (encoded.bytes.byteLength > CONSUMER_CAP_BYTES) {
      throw new Error(`${source.label} could not be brought under the 2 MiB consumer cap; it would be skipped silently`);
    }
    payload = encoded.bytes;
    extension = "jpg";
    disposition = `re-encoded to ${mib(encoded.bytes.byteLength)} at ${encoded.width}px q${encoded.quality}`;
  }
  console.error(`  ${disposition}`);

  const contentType = extension === "jpg" ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png";
  // The loaders take the first two entries of a name-ordered listing, so the
  // index makes which-two-and-in-what-order explicit instead of incidental.
  const name = `${String(index + 1).padStart(2, "0")}-${source.label}.${extension}`;
  const objectPath = `${PREFIX}/${name}`;
  writeFileSync(join(outDir, name), payload);

  if (write) {
    const { error: uploadError } = await svc.storage.from(BUCKET).upload(objectPath, payload, {
      contentType,
      upsert: true,
    });
    if (uploadError) throw new Error(`upload failed for ${objectPath}: ${uploadError.message}`);
    console.error(`  uploaded      ${objectPath}`);
  } else {
    console.error(`  DRY RUN       would upload ${objectPath} (pass --write to seed)`);
  }

  results.push({
    label: source.label,
    kind: source.kind,
    sourcePath: source.path,
    sourceHash: observed,
    sourceBytes: sourceBytes.byteLength,
    seededBytes: payload.byteLength,
    disposition,
    objectPath,
    cutoutSurfaces: source.cutoutSurfaces,
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
