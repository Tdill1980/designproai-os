import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("dedicated deployment has no external panelizer, Railway, or browser worker prerequisite", () => {
  const boundary = [
    "ops/compose.yaml",
    "ops/install.sh",
    "ops/configure-env.sh",
    "ops/deploy.sh",
    "ops/rollback.sh",
    "ops/install-caddy.sh",
    "ops/acceptance.sh",
    "ops/runtime.env.example",
    "ops/validate-env.py",
  ].map(read).join("\n");

  assert.doesNotMatch(boundary, /VECTORIZE_IT_URL|host\.docker\.internal:3200|vectorize-guard/);
  assert.doesNotMatch(boundary, /railway/i);
  assert.doesNotMatch(boundary, /browser.*(?:worker|conductor)|(?:worker|conductor).*browser/i);
});

test("exact deployment runs two independent fenced workers on a restart-safe shared spool", () => {
  const compose = read("ops/compose.yaml");
  const acceptance = read("ops/acceptance.sh");

  assert.equal((compose.match(/^  runtime-[12]:$/gm) || []).length, 2);
  assert.match(compose, /DESIGNPRO_WORKER_ID: "designpro-worker-1"/);
  assert.match(compose, /DESIGNPRO_WORKER_ID: "designpro-worker-2"/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /source: \/opt\/designproai\/shared\/spool/);
  assert.match(compose, /target: \/var\/lib\/designproai\/spool/);
  assert.match(acceptance, /runtime-1[\s\S]*runtime-2/);
  assert.match(acceptance, /designpro-shared-spool/);
});

test("Call 8 and Call 9 remain durable runtime stages, not browser execution", () => {
  const runtime = read("runtime/index.js");
  const gateway = read("gateway/src/server.mjs");
  const web = read("web/src/main.tsx");

  assert.match(runtime, /call8\.flat-proof|proof\.build/);
  assert.match(runtime, /call9\.surface-panels|panels\.build/);
  assert.match(runtime, /designpro_workflow_stages/);
  assert.match(runtime, /output_hash/);
  assert.match(runtime, /lease/i);
  assert.doesNotMatch(gateway, /VECTORIZE_IT_URL|host\.docker\.internal:3200/);
  assert.doesNotMatch(web, /VECTORIZE_IT_URL|host\.docker\.internal:3200/);
});
