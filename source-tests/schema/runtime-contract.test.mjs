import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const track = join(here, "..");
const workspace = resolve(track, "../..");
const manifest = JSON.parse(readFileSync(join(track, "runtime-contract.json"), "utf8"));
const inventory = JSON.parse(readFileSync(join(workspace,"worktracks/runtime_closure/contracts/runtime-contract-inventory.json"),"utf8"));
const actualTables = Object.keys(inventory.tables).sort();
const actualRpcs = Object.keys(inventory.rpcs).sort();
const classifiedTables = [...manifest.compatibleTables, ...manifest.blockedTables];
const classifiedRpcs = [...manifest.compatibleRpcs, ...manifest.blockedRpcs];
for (const table of actualTables) assert.ok(classifiedTables.includes(table), `unclassified runtime table ${table}`);
for (const rpc of actualRpcs) assert.ok(classifiedRpcs.includes(rpc), `unclassified runtime RPC ${rpc}`);
const migration = readdirSync(join(track,"migrations")).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => readFileSync(join(track,"migrations",name),"utf8")).join("\n").toLowerCase();
for (const name of manifest.compatibleTables) assert.ok(migration.includes(`public.${name}`), `missing compatible table ${name}`);
for (const name of manifest.compatibleRpcs) assert.ok(migration.includes(`public.${name}`), `missing compatible RPC ${name}`);
for (const name of manifest.blockedTables) assert.ok(!migration.includes(`public.${name}`), `blocked table synthesized: ${name}`);
for (const name of manifest.blockedRpcs) assert.ok(!migration.includes(`public.${name}`), `blocked RPC synthesized: ${name}`);
console.log(`runtime reconciliation: ${manifest.compatibleTables.length + manifest.compatibleRpcs.length} compatible, ${manifest.blockedTables.length + manifest.blockedRpcs.length} blocked`);
