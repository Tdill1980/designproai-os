import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const runtime = join(root, "runtime");
const read = (name) => readFileSync(join(runtime, name), "utf8");
const entry = read("standalone-index.js");
const claimant = read("designpro-standalone-claimant.cjs");
const all = [entry, claimant].join("\n");
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

test("all local CommonJS imports are closed", () => {
  for (const file of ["standalone-index.js", "designpro-standalone-claimant.cjs"]) {
    const source = read(file);
    for (const match of source.matchAll(/require\(["'](\.\.?\/[^"']+)["']\)/g)) {
      const absolute = resolve(dirname(join(runtime, file)), match[1]);
      assert.ok(existsSync(absolute), `${file} has missing import ${match[1]}`);
    }
  }
});

test("contains Calls 7/8/9 and all paid late-stage gates", () => {
  for (const stage of ["revision.freeze", "proof.build", "panels.build", "logos.extract", "pack.verify", "pack.activate", "source.verify", "await_panelpro_preflight_qc", "output.build", "output.verify", "await_final_human_qc", "stamp.build", "zip.build", "wrapbox.deliver"]) assert.ok(claimant.includes(stage), `missing stage ${stage}`);
  assert.match(entry, /Call 7/); assert.match(claimant, /call8\.flat-proof/); assert.match(claimant, /call9\.surface-panels/); assert.match(claimant, /call10\.logo-inventory/);
});

test("two-worker safety is durable and the legacy poller defaults off", () => {
  assert.match(claimant, /claim_designpro_stage/);
  assert.match(claimant, /heartbeat_designpro_stage/);
  assert.match(claimant, /p_lease_token/);
  assert.doesNotMatch(all, /RAILWAY_/);
});

test("HTTP tools are authenticated and health is explicit", () => {
  assert.match(entry, /app\.get\("\/health"/);
  assert.match(entry, /authorization !== `Bearer \$\{WORKER_SECRET\}`/);
  for (const route of ["/compose-proof-sheet"]) {
    assert.ok(entry.includes(`app.post("${route}", authMiddleware`), `${route} lacks auth middleware`);
  }
  assert.match(entry, /SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_SECRET and GIT_SHA are required/);
  assert.doesNotMatch(entry, /kfapjdyythzyvnpdeghu/);
  assert.doesNotMatch(entry, /process\.env\.SUPABASE_SERVICE_KEY/);
});

test("VectorizIt is preserved outside the standalone claimant", () => {
  assert.doesNotMatch(all, /3200|vectorize/i);
});

test("runtime has no RestylePro, shared host, Railway, Slack, or browser conductor", () => {
  assert.doesNotMatch(all, /restylepro|\/opt\/restylepro|143\.110\.237\.145|slack-agent|rp-agent|RAILWAY_/i);
  assert.doesNotMatch(all, /\bwindow\.(location|fetch)|\bdocument\.(querySelector|getElementById)|\blocalStorage\.(getItem|setItem)|\bsessionStorage\.(getItem|setItem)/);
});

test("package and lock are exact and synchronized", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
  for (const version of Object.values(pkg.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
  }
});

test("container uses the real runtime entrypoint and fail-closed health", () => {
  assert.match(dockerfile, /FROM node:22\.18\.0-bookworm-slim/);
  assert.match(dockerfile, /CMD \["node", "standalone-index\.js"\]/);
  assert.match(dockerfile, /h\.ready !== true/);
  assert.match(dockerfile, /!h\.commit/);
  assert.match(dockerfile, /USER node/);
  assert.doesNotMatch(dockerfile, /worker\.mjs|Railway|restyle|runtime\/index\.js|designpro-workflow\.cjs|designpro-entice-workflow\.cjs/i);
});
