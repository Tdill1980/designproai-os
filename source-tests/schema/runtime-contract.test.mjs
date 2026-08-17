import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const track = join(here, "..");
const root = resolve(track, "..");
const manifest = JSON.parse(readFileSync(join(track, "runtime-contract.json"), "utf8"));
const generated = spawnSync(process.execPath, [join(track,"contracts/generate-contract-inventory.mjs")], { encoding: "utf8" });
assert.equal(generated.status, 0, generated.stderr);
const inventory = JSON.parse(generated.stdout);
const actualTables = Object.keys(inventory.tables).sort();
const actualRpcs = Object.keys(inventory.rpcs).sort();
const classifiedTables = [...manifest.compatibleTables, ...manifest.blockedTables];
const classifiedRpcs = [...manifest.compatibleRpcs, ...manifest.blockedRpcs];
for (const table of actualTables) assert.ok(classifiedTables.includes(table), `unclassified runtime table ${table}`);
for (const rpc of actualRpcs) assert.ok(classifiedRpcs.includes(rpc), `unclassified runtime RPC ${rpc}`);
// The blocked/compatible reconciliation is a RUNTIME closure: it audits the
// migrations that define the standalone runtime's own schema. The declared
// chainMigrations host the byte-copied edge-function chain's legacy schema and
// are excluded here on purpose -- schema-closure.test.mjs audits them under
// their own rules (additive-only, RLS on, none of the runtime's tables).
const chainMigrations = manifest.chainMigrations ?? [];
const migrationNames = readdirSync(join(root,"supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
for (const name of chainMigrations) assert.ok(migrationNames.includes(name), `declared chain migration missing on disk: ${name}`);
const migration = migrationNames.filter((name) => !chainMigrations.includes(name))
  .map((name) => readFileSync(join(root,"supabase/migrations",name),"utf8")).join("\n").toLowerCase();
for (const name of manifest.compatibleTables) assert.ok(migration.includes(`public.${name}`), `missing compatible table ${name}`);
for (const name of manifest.compatibleRpcs) assert.ok(migration.includes(`public.${name}`), `missing compatible RPC ${name}`);
for (const name of manifest.blockedTables) assert.ok(!migration.includes(`public.${name}`), `blocked table synthesized: ${name}`);
for (const name of manifest.blockedRpcs) assert.ok(!migration.includes(`public.${name}`), `blocked RPC synthesized: ${name}`);
console.log(`runtime reconciliation: ${manifest.compatibleTables.length + manifest.compatibleRpcs.length} compatible, ${manifest.blockedTables.length + manifest.blockedRpcs.length} blocked, ${chainMigrations.length} declared chain migration(s) excluded`);
