import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const runtime = join(root, "runtime");
const read = (name) => readFileSync(join(runtime, name), "utf8");
const entry = read("index.js");
const claimant = read("designpro-standalone-claimant.cjs");
const all = [entry, claimant].join("\n");
const dockerfile = readFileSync(join(root, "ops/Dockerfile.runtime"), "utf8");
const healthcheck = readFileSync(join(root, "ops/runtime-healthcheck.js"), "utf8");

test("all local CommonJS imports are closed", () => {
  for (const file of ["index.js", "designpro-standalone-claimant.cjs", "runtime-contract.cjs", "runtime-readiness.cjs", "genie-universal-resolver.cjs", "gemini-flat-surface.cjs", "output-qc.cjs", "zip-spool.cjs", "wrapbox-delivery.cjs", "resend-transport.cjs"]) {
    const source = read(file);
    for (const match of source.matchAll(/require\(["'](\.\.?\/[^"']+)["']\)/g)) {
      const absolute = resolve(dirname(join(runtime, file)), match[1]);
      assert.ok(existsSync(absolute), `${file} has missing import ${match[1]}`);
    }
  }
});

test("contains Calls 7/8/9 and all paid late-stage gates", () => {
  for (const stage of ["revision.freeze", "proof.build", "panels.build", "logos.extract", "pack.verify", "pack.activate", "source.verify", "await_panelpro_preflight_qc", "output.build", "output.verify", "await_final_human_qc", "stamp.build", "zip.build", "wrapbox.deliver"]) assert.ok(claimant.includes(stage), `missing stage ${stage}`);
  assert.match(entry, /2D Production Proof/); assert.match(entry, /authorFlatWrapLayout/); assert.match(entry, /cutAllPanels/); assert.match(claimant, /call8\.flat-proof/); assert.match(claimant, /call9\.surface-panels/); assert.match(claimant, /call10\.logo-inventory/);
});

test("two-worker safety is durable and the legacy poller defaults off", () => {
  assert.match(claimant, /claim_designpro_stage/);
  assert.match(claimant, /heartbeat_designpro_stage/);
  assert.match(claimant, /p_lease_token/);
  assert.doesNotMatch(all, /RAILWAY_/);
  assert.match(claimant, /designpro\.server-claimant\.v2/);
  assert.doesNotMatch(all, /designpro\.server-claimant\.v1/);
});

test("HTTP tools are authenticated and health is explicit", () => {
  assert.match(entry, /app\.get\("\/health"/);
  assert.match(entry, /authorization !== `Bearer \$\{WORKER_SECRET\}`/);
  for (const route of ["/compose-proof-sheet"]) {
    assert.ok(entry.includes(`app.post("${route}", authMiddleware`), `${route} lacks auth middleware`);
  }
  assert.match(entry, /SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_SECRET, GIT_SHA, GOOGLE_AI_API_KEY/);
  assert.match(entry, /DESIGNPRO_SPOOL_DIR and DESIGNPRO_APP_ORIGIN are required/);
  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WORKER_SECRET", "GIT_SHA", "GOOGLE_AI_API_KEY \(or GEMINI_API_KEY\)", "DESIGNPRO_SPOOL_DIR", "DESIGNPRO_APP_ORIGIN", "DESIGNPRO_OUTBOUND_EMAIL_ENABLED=true|false"]) assert.ok(entry.includes(`"${key}"`), `missing exact dark environment contract ${key}`);
  for (const key of ["DESIGNPRO_OUTBOUND_EMAIL_ENABLED=true", "RESEND_API_KEY", "RESEND_FROM", "RESEND_FROM_VERIFIED=true"]) assert.ok(entry.includes(`"${key}"`), `missing public go-live blocker contract ${key}`);
  assert.match(entry, /if \(!notificationReadiness\.configurationValid\) \{[\s\S]*?stopWorkerLoops\(\);[\s\S]*?workerLoopsStarted: false[\s\S]*?return;/);
  assert.match(entry, /notificationReadiness\.enabled && notificationReadiness\.available \? createResendTransport\(\) : null/);
  assert.match(entry, /publicGoLiveReady: notificationReadiness\.publicGoLiveReady, publicGoLiveBlockers/);
  assert.match(entry, /if \(!claimant\) claimant = registerDesignProStandaloneClaimant[\s\S]*?ensureDeliveryWorkers\(\);[\s\S]*?workerLoopsStarted: true/);
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
  assert.equal(pkg.dependencies["tus-js-client"], "4.3.1");
  assert.equal(pkg.dependencies.archiver, undefined);
  for (const version of Object.values(pkg.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
  }
});

test("container uses the real runtime entrypoint and fail-closed health", () => {
  assert.match(dockerfile, /FROM node:22(?:\.[0-9]+){0,2}-bookworm-slim(?:@sha256:[0-9a-f]{64})?/);
  assert.match(dockerfile, /CMD \["node", "index\.js"\]/);
  assert.match(healthcheck, /health\.ready === true/);
  assert.match(healthcheck, /health\.commit === expected/);
  assert.match(healthcheck, /designpro\.runtime-readiness\.v2/);
  assert.match(dockerfile, /USER (?:node|[1-9][0-9]*:[1-9][0-9]*)/);
  assert.doesNotMatch(dockerfile, /worker\.mjs|Railway|restyle|designpro-workflow\.cjs|designpro-entice-workflow\.cjs/i);
});

