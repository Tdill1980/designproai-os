import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("dedicated deployment has no external production executor prerequisite", () => {
  const productionBoundary = [
    "ops/compose.yaml",
    "ops/install.sh",
    "ops/configure-env.sh",
    "ops/deploy.sh",
    "ops/rollback.sh",
    "ops/install-caddy.sh",
    "ops/acceptance.sh",
    "ops/runtime.env.example",
    "ops/validate-env.py",
  ].map(read).join("\n").toLowerCase();

  const forbidden = [
    ["vectorize", "it", "url"].join("_"),
    ["host", ".docker", ".internal", ":3200"].join(""),
    ["vectorize", "-guard"].join(""),
    ["rail", "way"].join(""),
    ["browser", "-conductor"].join(""),
  ];
  for (const token of forbidden) assert.equal(productionBoundary.includes(token), false, token);
});

test("exact deployment runs two independent fenced workers on a restart-safe shared spool", () => {
  const compose = read("ops/compose.yaml");
  const acceptance = read("ops/acceptance.sh");

  assert.equal((compose.match(/^  runtime-[12]:$/gm) || []).length, 2);
  assert.match(compose, /DESIGNPRO_WORKER_ID: "designpro-worker-1"/);
  assert.match(compose, /DESIGNPRO_WORKER_ID: "designpro-worker-2"/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /source: \/opt\/designproai-os\/shared\/spool/);
  assert.match(compose, /target: \/var\/lib\/designproai\/spool/);
  assert.match(acceptance, /runtime-1[\s\S]*runtime-2/);
  assert.match(acceptance, /designpro-shared-spool/);
});

test("Call 8 and Call 9 remain durable claimant stages, not UI execution", () => {
  const claimant = read("runtime/designpro-standalone-claimant.cjs");
  const gateway = read("gateway/src/server.mjs");
  const web = read("web/src/main.tsx");

  assert.match(claimant, /call8\.flat-proof/);
  assert.match(claimant, /proof\.build/);
  assert.match(claimant, /call9\.surface-panels/);
  assert.match(claimant, /panels\.build/);
  assert.match(claimant, /designpro_workflow_stages/);
  assert.match(claimant, /output_hash/);
  assert.match(claimant, /lease/i);

  const staleUrlKey = ["vectorize", "it", "url"].join("_");
  const staleHost = ["host", ".docker", ".internal", ":3200"].join("");
  assert.equal(gateway.toLowerCase().includes(staleUrlKey), false);
  assert.equal(gateway.toLowerCase().includes(staleHost), false);
  assert.equal(web.toLowerCase().includes(staleUrlKey), false);
  assert.equal(web.toLowerCase().includes(staleHost), false);
});
