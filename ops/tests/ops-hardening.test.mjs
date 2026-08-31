import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ops = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const track = resolve(ops, "..");
const workflow = readFileSync(join(track, ".github/workflows/release.yml"), "utf8");
const read = (name) => readFileSync(join(ops, name), "utf8");
const policy = read("release-files.txt").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
const fixed = policy.filter((line) => !line.includes("*"));

test("one canonical policy includes every required runtime file and five deploy controls", () => {
  assert.equal(fixed.filter((name) => name.startsWith("runtime/")).length, 56);
  for (const name of [
    // stamp.build requires it at module load, so a release without it dies at
    // require time rather than merely shipping a pack with no certificate.
    "runtime/qc-certificate.cjs",
    "runtime/resend-transport.cjs", "runtime/wrapbox-delivery.cjs", "runtime/zip-spool.cjs",
    "runtime/gemini-flat-wrap.cjs", "runtime/flat-wrap-layout.cjs", "runtime/proof-sheet.cjs", "runtime/server-grid-slice.cjs", "runtime/topaz-upscale.cjs",
    // Call 8's material identity. It is deterministic assembly of the six
    // Call-1 panels now (Trish 2026-08-29), and `runtime/index.js` requires this
    // at module load, so a release without it dies at require time.
    "runtime/call8-proof-material.cjs",
    // The ancestry gate `source.verify` runs at the boundary into the paid
    // half. A release without it is a release where a panel descended from a 3D
    // proof reaches Topaz, the ZIP and WrapBox unchallenged.
    "runtime/production-provenance.cjs",
    "runtime/logo-removal.cjs", "runtime/studio-os.cjs", "runtime/designiq-prompt.cjs",
    // Calls 1-7. These existed in the tree but were absent from the policy, so
    // no release ever shipped them and the generation queue had no executor.
    "runtime/view-angles.cjs", "runtime/photorealism-prompt.cjs", "runtime/generation-provider.cjs",
    "runtime/designpanel-server-provider.cjs", "runtime/designpanel-edge-provider.cjs",
    "runtime/atlas-master-qc.cjs", "runtime/atlas-proof-qc.cjs", "runtime/generation-store.cjs",
    // Code owns the atlas geometry. The A/B harness loads this from /app inside
    // the live image, so it ships before Call 1 adopts it -- and the first run
    // without it died on MODULE_NOT_FOUND in an otherwise correct release.
    "runtime/atlas-artwork-compose.cjs",
    // VisionBoardIQ: the reference pre-pass Call 1 runs before authoring.
    "runtime/visionboard-iq.cjs",
    // The vehicle silhouettes Call 8 shows the approved artwork through. A
    // release without them composes the proof as bare rectangles, which is not
    // the 2D Production Proof the customer approves.
    "runtime/vehicle-proof-template.cjs", "runtime/proof-band-fit.cjs",
    "runtime/generation-engine.cjs", "runtime/generation-worker.cjs",
    "runtime/flat-first-atlas.cjs", "runtime/flat-atlas-topology-examples.cjs",
    "runtime/atlas-examples/houdini-flattened-top-view.jpg",
    "runtime/atlas-examples/houdini-finished-3d-proof.jpg",
    // The authoring boundary the worker requires to record the canonical
    // design master while Calls 1-7 run.
    "runtime/creative-authoring.cjs",
    "ops/Dockerfile.runtime", "ops/Dockerfile.gateway", "ops/runtime-healthcheck.js",
    "ops/gateway-healthcheck.mjs", "ops/compose.yaml",
  ]) assert.ok(fixed.includes(name), name);
  for (const source of [read("build-release-manifest.py"), read("validate-archive.py")]) {
    assert.match(source, /release-files\.txt/);
    assert.doesNotMatch(source, /"runtime\/index\.js",/);
  }
  assert.match(readFileSync(join(track, "scripts/build-release.sh"), "utf8"), /ops\/release-files\.txt/);
});

// The count above is a tripwire, not a guarantee. This is the guarantee.
//
// A release that ships the kernel's entry points but not everything they
// require dies at require time inside the container, and the deploy can only
// report an empty /health — no module name, no stack. That is exactly how
// eleven Design Master modules were left out of one release: every test passed,
// the archive validated, and the failure surfaced as a health probe timing out
// after the cutover.
test("the policy is closed over everything the runtime entry points require", () => {
  const runtime = resolve(track, "runtime");
  const seen = new Set();
  const stack = ["index.js", "designpro-standalone-claimant.cjs"];
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    let source;
    try { source = readFileSync(join(runtime, name), "utf8"); } catch { continue; }
    for (const match of source.matchAll(/require\(\s*"\.\/([A-Za-z0-9._-]+)"\s*\)/g)) {
      stack.push(match[1]);
    }
  }
  const missing = [...seen].filter((name) => !fixed.includes(`runtime/${name}`));
  assert.deepEqual(missing, [], `release policy is missing runtime modules the kernel requires: ${missing.join(", ")}`);
});

test("actual builder emits reproducible bytes with every fixed file manifest-bound", () => {
  const root = mkdtempSync(join(tmpdir(), "dp-repro-"));
  try {
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "ops"), { recursive: true });
    cpSync(join(track, "scripts/build-release.sh"), join(root, "scripts/build-release.sh"));
    for (const name of ["release-files.txt", "build-release-manifest.py", "validate-archive.py"]) cpSync(join(ops, name), join(root, "ops", name));
    chmodSync(join(root, "scripts/build-release.sh"), 0o755);
    for (const name of fixed) {
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      if (name === "ops/release-files.txt") cpSync(join(track, name), path);
      else writeFileSync(path, name.endsWith(".json") ? "{}\n" : `fixture:${name}\n`);
    }
    // The served application is the branded operator shell, so the builder
    // stages web/dist from app/dist. web/dist/index.html is still a fixed
    // policy entry; it is satisfied by the shell build rather than read from
    // a repository path, which is what this fixture proves.
    mkdirSync(join(root, "app/dist/assets"), { recursive: true });
    writeFileSync(join(root, "app/dist/index.html"), "<!doctype html><title>dp</title>\n");
    writeFileSync(join(root, "app/dist/assets/app.js"), "console.log('dp');\n");
    const sha = "a".repeat(40);
    execFileSync("bash", [join(root, "scripts/build-release.sh"), sha, join(root, "one")]);
    execFileSync("bash", [join(root, "scripts/build-release.sh"), sha, join(root, "two")]);
    const first = readFileSync(join(root, "one", `designproai-release-${sha}.tgz`));
    const second = readFileSync(join(root, "two", `designproai-release-${sha}.tgz`));
    assert.deepEqual(first, second);
    const manifest = JSON.parse(execFileSync("tar", ["-xOzf", join(root, "one", `designproai-release-${sha}.tgz`), ".designpro-release.json"], { encoding: "utf8" }));
    assert.deepEqual(Object.keys(manifest.files).sort(), [...fixed, "web/dist/assets/app.js"].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deploy copies then validates one archive and never injects mutable ops controls", () => {
  const deploy = read("deploy.sh");
  assert.match(deploy, /install -m 0600 -- "\$archive" "\$incoming"/);
  assert.ok(deploy.indexOf('sha256sum "$incoming"') < deploy.indexOf('validate-archive.py" "$incoming"'));
  assert.ok(deploy.indexOf('validate-archive.py" "$incoming"') < deploy.indexOf('tar --extract --gzip --file "$incoming"'));
  assert.match(deploy, /-f "\$staging\/ops\/Dockerfile\.runtime"/);
  assert.match(deploy, /-f "\$staging\/ops\/Dockerfile\.gateway"/);
  assert.doesNotMatch(deploy, /install -m 0644 "\$OPS_DIR\/(?:Dockerfile|compose|runtime-healthcheck|gateway-healthcheck)/);
});

test("persistent spool, host floors, and bounded containers are explicit", () => {
  const install = read("install.sh");
  const compose = read("compose.yaml");
  for (const value of ["minimum_cpu=8", "15 * 1024 * 1024", "15 * 512 * 1024", "120 * 1024 * 1024 * 1024"]) assert.match(install, new RegExp(value.replaceAll("*", "\\*")));
  const toleratedSwapFloorKiB = 15 * 512 * 1024;
  assert.ok(8_388_604 >= toleratedSwapFloorKiB, "a kernel-reported 8-GiB swapfile must pass");
  assert.ok(toleratedSwapFloorKiB - 1 < toleratedSwapFloorKiB, "a value below the documented 7.5-GiB tolerance must fail");
  assert.match(install, /active swapfile configured as 8 GiB/);
  assert.match(install, /install -d -o 10001 -g 10001 -m 0700 "\$ROOT\/shared\/spool"/);
  assert.ok((compose.match(/source: \/opt\/designproai-os\/shared\/spool/g) || []).length >= 1);
  assert.match(compose, /mem_limit: 6g/);
  assert.match(compose, /cpus: "3\.0"/);
  assert.match(compose, /mem_limit: 512m/);
});

test("expanded dark env disables email and keeps an exact public-go-live provider gate", () => {
  const validator = read("validate-env.py");
  for (const key of ["DESIGNPRO_APP_ORIGIN", "DESIGNPRO_SPOOL_DIR", "SUPABASE_TUS_ENDPOINT", "DESIGNPRO_OUTBOUND_EMAIL_ENABLED", "RESEND_API_KEY", "RESEND_FROM", "RESEND_FROM_VERIFIED"]) assert.match(validator, new RegExp(`"${key}"`));
  assert.match(read("runtime.env.example"), /DESIGNPRO_OUTBOUND_EMAIL_ENABLED=false/);
  // Call 12 must be an explicit mode in the template and the configurator, so a
  // pack never reaches a customer built from un-enhanced artwork.
  assert.match(read("runtime.env.example"), /DESIGNPRO_TOPAZ_ENABLED=false/);
  assert.match(read("validate-env.py"), /DESIGNPRO_TOPAZ_ENABLED must be exactly true or false/);
  assert.match(read("validate-env.py"), /TOPAZ_API_KEY is missing or too short for an enabled Call 12/);
  assert.match(read("configure-env.sh"), /DESIGNPRO_TOPAZ_ENABLED=true/);
  assert.doesNotMatch(read("runtime.env.example"), /RESEND_API_KEY=|RESEND_FROM=/);
  assert.match(read("configure-env.sh"), /DESIGNPRO_OUTBOUND_EMAIL_ENABLED=false/);
  assert.doesNotMatch(read("configure-env.sh"), /RP_|WPW_|RESEND_API_KEY|RESEND_FROM/);
  assert.match(validator, /runtime\["WORKER_SECRET"\] != gateway\["WORKER_SECRET"\]/);
  assert.match(read("gateway.env.example"), /DESIGNPRO_RUNTIME_INTERNAL_URL=http:\/\/runtime-1:3001/);
  assert.match(read("gateway.env.example"), /DESIGNPRO_ADDITIONAL_ORIGINS=https:\/\/designproai\.com/);
  assert.match(read("configure-env.sh"), /DESIGNPRO_ADDITIONAL_ORIGINS=https:\/\/designproai\.com/);
  assert.doesNotMatch(read("gateway.env.example"), /SUPABASE_SERVICE_ROLE_KEY/);
});

test("acceptance proves shared spool, both runtime identities, health contracts, and image IDs", () => {
  const acceptance = read("acceptance.sh");
  assert.match(acceptance, /runtime-1 node -e/);
  assert.match(acceptance, /runtime-2 node -e/);
  assert.match(acceptance, /designpro-shared-spool/);
  assert.match(acceptance, /designpro-worker-1/);
  assert.match(acceptance, /designpro-worker-2/);
  assert.match(acceptance, /127\.0\.0\.1:3001/);
  assert.match(acceptance, /127\.0\.0\.1:3002/);
  assert.doesNotMatch(acceptance, /host\.docker\.internal.*port:3200/s);
  assert.match(acceptance, /RUNTIME_IMAGE_ID/);
  assert.match(acceptance, /GATEWAY_IMAGE_ID/);
  assert.match(read("rollback.sh"), /validate-release-tree\.py/);
  assert.match(read("rollback.sh"), /docker image inspect/);
});

test("healthcheck and acceptance require the canonical runtime-readiness v2 contract", () => {
  const healthcheck = read("runtime-healthcheck.js");
  const acceptance = read("acceptance.sh");
  for (const source of [healthcheck, acceptance]) {
    assert.match(source, /designpro\.runtime-readiness\.v2/);
    assert.doesNotMatch(source, /designpro\.runtime-readiness\.v1/);
  }
  assert.match(read("gateway.env.example"), /DESIGNPRO_RUNTIME_INTERNAL_URL=http:\/\/runtime-1:3001/);
});

test("official actions are full-SHA pinned and Supabase CLI is pinned npx", () => {
  const uses = [...workflow.matchAll(/uses:\s+([^\s]+)/g)].map((match) => match[1]);
  assert.ok(uses.length >= 8);
  for (const value of uses) assert.match(value, /@[0-9a-f]{40}$/);
  assert.match(workflow, /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.doesNotMatch(workflow, /supabase\/setup-cli/);
  assert.match(workflow, /supabase@\$\{SUPABASE_CLI_VERSION\}/);
  assert.match(workflow, /cmp "dist-release-a/);
  assert.match(workflow, /tar -xzf "dist-release-a[^"]+" -C dist-image-context/);
  assert.match(workflow, /docker build[\s\S]*-f dist-image-context\/ops\/Dockerfile\.runtime/);
  assert.match(workflow, /docker build[\s\S]*-f dist-image-context\/ops\/Dockerfile\.gateway/);
  assert.match(workflow, /npm run check --prefix runtime/);
  assert.match(workflow, /node --check gateway\/src\/server\.mjs/);
});

test("production migration is manual, exact-main, environment protected, and secret gated", () => {
  assert.match(workflow, /production_migration:[\s\S]*APPLY_DESIGNPRO_PRODUCTION/);
  assert.match(workflow, /environment:\s*\n\s*name: designproai-production/);
  assert.match(workflow, /PRODUCTION_APPROVAL_TOKEN: \$\{\{ secrets\.DESIGNPRO_PRODUCTION_APPROVAL_TOKEN \}\}/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /db push --linked --include-all --dry-run/);
  assert.match(workflow, /db push --linked --include-all --yes/);
  const apply = workflow.indexOf("Apply the approved exact-head plan without reset");
  const liveSchema = workflow.indexOf("Prove the live A.T.L.A.S. schema, not only migration history");
  assert.ok(apply >= 0 && liveSchema > apply, "live schema evidence must follow the production db push");
  assert.match(workflow.slice(liveSchema), /bash ops\/assert-atlas-production-schema\.sh/);
  assert.doesNotMatch(workflow, /db reset/);
});
