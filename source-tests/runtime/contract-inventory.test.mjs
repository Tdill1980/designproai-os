import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const generatorPath = resolve(root, "contracts/generate-contract-inventory.mjs");
const schemaRoot = resolve(root, "../supabase/migrations");
const generated = spawnSync(process.execPath, [generatorPath], { encoding: "utf8" });
assert.equal(generated.status, 0, generated.stderr);
const inventory = JSON.parse(generated.stdout);

function filesUnder(directory, suffix) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path, suffix) : path.endsWith(suffix) ? [path] : [];
  });
}

test("inventory is generated from the exact release layout", () => {
  assert.match(inventory.generatedFrom.runtimeEntry, /^runtime\/index\.js$/);
  assert.match(inventory.generatedFrom.claimant, /^runtime\/designpro-standalone-claimant\.cjs$/);
  assert.match(inventory.generatedFrom.gateway, /^gateway\/src\/server\.mjs$/);
});

test("inventory covers runtime, gateway, and orchestrator auth contracts", () => {
  assert.equal(inventory.schemaVersion, "designpro.runtime-contract-inventory.v1");
  assert.ok(Object.keys(inventory.tables).length >= 1);
  assert.ok(Object.keys(inventory.rpcs).length >= 1);
  assert.ok(inventory.endpoints.runtime.every((route) => route.path === "/health" ? route.auth === "public" : route.auth === "bearer-worker-secret"));
  assert.ok(inventory.endpoints.gateway.some((route) => route.path === "/api/revisions" && route.request.required.includes("idempotencyKey")));
  assert.equal(inventory.endpoints.orchestrator, null);
});

test("schema closure declares every consumed table and RPC when present", (context) => {
  const sqlFiles = filesUnder(schemaRoot, ".sql");
  assert.ok(sqlFiles.length, "release migrations are required");
  const sql = sqlFiles.map((file) => readFileSync(file, "utf8")).join("\n").toLowerCase();
  const missingTables = Object.keys(inventory.tables).filter((name) => !new RegExp(`\\b${name.toLowerCase()}\\b`).test(sql));
  const missingRpcs = Object.keys(inventory.rpcs).filter((name) => !new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name.toLowerCase()}\\s*\\(`).test(sql));
  assert.deepEqual({ missingTables, missingRpcs }, { missingTables: [], missingRpcs: [] }, `standalone schema mismatch: ${JSON.stringify({ missingTables, missingRpcs })}`);
});
