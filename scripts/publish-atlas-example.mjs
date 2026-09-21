// Publish ONE repo-versioned teaching asset to `wrap-files/atlas-examples/`,
// byte for byte, against a hash the caller states up front.
//
// WHY THIS IS NOT `seed-artboard-quality-examples.mjs`.
//
// That script serves the QUALITY prefix, and to do its job it re-encodes any
// source over 2 MiB and sweeps its prefix down to exactly what the run seeded.
// Both behaviours are correct there and fatal here: a pinned teaching input is
// pinned BY HASH, so re-encoding it changes the one number that makes the pin
// mean anything, and `atlas-examples/` holds several unrelated pinned objects
// that a sweep would delete. Reusing it would have been the shorter diff and
// the wrong one.
//
// WHAT THIS DOES INSTEAD: one file, no transform, and the hash is an INPUT
// rather than an output. `--expect` is required, and the bytes on disk must
// already hash to it or nothing is written. So this cannot invent a new pinned
// object -- it can only put into the bucket the exact bytes some constant in
// the source already names. Publish and pin therefore cannot drift: if they
// did, this refuses before the upload.
//
// WHY IT RUNS ON THE DROPLET. `wrap-files` is private and there is no
// service-role secret in GitHub; the key already lives in
// /opt/designproai-os/shared/runtime.env. This runs inside the deployed runtime
// image exactly as the quality seeder and the read-only exporter do, so no
// credential is ever fetched to a runner or to a laptop.
//
// It writes ONE object under `atlas-examples/`. It never touches a master, a
// revision row, bucket visibility, the DAG, an orchestrator or an edge function.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "wrap-files";
const PREFIX = "atlas-examples";
/** Repo assets at runtime/atlas-examples/, mounted read-only by the workflow. */
const LOCAL_DIR = "/examples";
/** A BARE FILENAME, never a path, so it cannot traverse out of the mount. */
const NAME = /^[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/;
const SHA256 = /^[0-9a-f]{64}$/;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : "";
};
const name = flag("--name").trim();
const expect = flag("--expect").trim().toLowerCase();
const write = args.includes("--write");

const die = (code, message) => { console.error(message); process.exit(code); };

if (!NAME.test(name)) die(3, `refusing name ${JSON.stringify(name)}: expected a bare image filename`);
if (!SHA256.test(expect)) die(4, "--expect <sha256> is required: publish and pin may not drift");

const source = join(LOCAL_DIR, name);
if (!existsSync(source)) die(5, `${source} is not in the payload; is it committed at runtime/atlas-examples/?`);

const bytes = readFileSync(source);
const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== expect) {
  die(6, `refusing to publish ${name}: bytes hash ${digest} but --expect says ${expect}. `
    + "Either the file changed or the pinned constant did; reconcile them rather than publishing a sheet nobody chose.");
}

const objectPath = `${PREFIX}/${name}`;
const contentType = name.toLowerCase().endsWith(".png") ? "image/png"
  : name.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";

console.error(`${name}: ${bytes.length} bytes, sha256 ${digest}`);
console.error(`destination ${BUCKET}/${objectPath} (${contentType})`);

if (!write) {
  console.error("PREVIEW_ONLY: verified and NOT written. Re-run with PUBLISH_THE_EXAMPLE to upload.");
  process.exit(0);
}

const url = process.env.SUPABASE_URL || process.env.DESIGNPRO_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.DESIGNPRO_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) die(7, "no Supabase service-role credentials in the runtime environment");

const svc = createClient(url, key, { auth: { persistSession: false } });

const { error: uploadError } = await svc.storage.from(BUCKET)
  .upload(objectPath, bytes, { contentType, upsert: true });
if (uploadError) die(8, `upload failed: ${uploadError.message}`);

// READ IT BACK. An upload that reports success and stores something else is the
// failure this repo has recorded repeatedly -- receipts green, pixels wrong. The
// only proof that the pin will resolve is downloading the object and hashing it.
const { data: stored, error: readError } = await svc.storage.from(BUCKET).download(objectPath);
if (readError || !stored) die(9, `stored object could not be read back: ${readError?.message || "no data"}`);
const storedBytes = new Uint8Array(await stored.arrayBuffer());
const storedDigest = createHash("sha256").update(storedBytes).digest("hex");
if (storedDigest !== expect) {
  die(10, `stored object hashes ${storedDigest}, not ${expect}: the pin would refuse it at Call 1`);
}

console.error(`PUBLISHED ${objectPath} — read back and verified at ${storedDigest}`);
