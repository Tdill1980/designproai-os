import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const names = readdirSync(join(root, "supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();
for (const requiredMigration of [
  "20260806180000_designpro_core_schema.sql",
  "20260806180100_designpro_workflow_rpcs.sql",
  "20260806180200_designpro_qc_delivery.sql",
  "20260806180300_designpro_runtime_compatibility.sql",
  "20260806180400_designpro_progressive_identity.sql",
  "20260806180500_designpro_vehicle_dimensions.sql",
  "20260806180600_designpro_revision_source_ingest.sql",
  "20260806181000_designpro_runtime_readiness.sql",
]) assert.ok(names.includes(requiredMigration), `missing ordered migration ${requiredMigration}`);
assert.equal(new Set(names).size, names.length, "duplicate migration filename");

// The declared chain migrations host the byte-copied edge-function chain's
// legacy schema (source-tests/runtime-contract.json chainMigrations). They are
// excluded from the runtime closure scans below and audited under their own
// rules at the bottom of this file.
const manifest = JSON.parse(readFileSync(join(root, "source-tests/runtime-contract.json"), "utf8"));
const chainNames = manifest.chainMigrations ?? [];
for (const name of chainNames) assert.ok(names.includes(name), `declared chain migration missing on disk: ${name}`);
const files = names.filter((name) => !chainNames.includes(name))
  .map((name) => ({ name, sql: readFileSync(join(root, "supabase/migrations", name), "utf8") }));
const chainFiles = chainNames.map((name) => ({ name, sql: readFileSync(join(root, "supabase/migrations", name), "utf8") }));
const all = files.map((f) => f.sql).join("\n").toLowerCase();

// Fresh-schema ordering: a referenced DesignPro object must be created earlier.
const creates = new Map();
for (const [index, file] of files.entries()) {
  const declarations = [
    ...file.sql.matchAll(/create\s+(?:or\s+replace\s+)?(?:table|function)\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi),
    ...file.sql.matchAll(/create\s+(?:or\s+replace\s+)?view\s+public\.([a-z0-9_]+)/gi),
  ];
  for (const match of declarations) {
    if (!creates.has(match[1].toLowerCase())) creates.set(match[1].toLowerCase(), index);
  }
}
for (const [index, file] of files.entries()) {
  for (const match of file.sql.matchAll(/(?:references|from|join|update|into)\s+public\.([a-z0-9_]+)/gi)) {
    const object = match[1].toLowerCase();
    assert.ok(creates.has(object), `${file.name} references missing public.${object}`);
    assert.ok(creates.get(object) <= index, `${file.name} references public.${object} before creation`);
  }
}

for (const required of [
  "designpro_workflow_runs", "designpro_workflow_stages", "designpro_stage_receipts", "designpro_artifacts",
  "claim_designpro_stage", "heartbeat_designpro_stage", "complete_designpro_stage", "fail_designpro_stage",
  "resume_designpro_workflow", "request_designpro_human_gate", "approve_designpro_human_gate",
  "verify_designpro_delivery_chain",
]) assert.ok(creates.has(required), `missing ${required}`);

for (const stage of [
  "proof.build", "panels.build", "logos.extract", "await_panelpro_preflight_qc", "await_final_human_qc",
  "stamp.build", "zip.build", "wrapbox.deliver",
]) assert.ok(all.includes(stage), `missing stage ${stage}`);

for (const contract of [
  "flattened-2d-proof", "genie-universal-panelizer", "one-own-surface-region-per-output-side",
  "designpro.expected-logo-inventory.v1", "fiveinchbleed", "ziphash",
]) assert.ok(all.includes(contract), `missing contract ${contract}`);

for (const forbidden of [
  "restyle", "railway", "panelizer_jobs", "shop_profiles", "user_subscriptions", "production_pack_credits",
  "marketing", "slack", "vectorize", ":3100", ":8080",
]) assert.ok(!all.includes(forbidden), `forbidden RP/shared dependency: ${forbidden}`);

assert.ok(all.includes("for update of s skip locked"), "claim must use SKIP LOCKED");
assert.ok(all.includes("lease_token=p_lease_token"), "completion must be lease fenced");
assert.ok(all.includes("auth.jwt()->>'role', '') is distinct from 'service_role'") || all.includes("auth.jwt()->>'role','') is distinct from 'service_role'"), "worker RPCs must fail closed on a missing JWT role");

// Chain-surface audit. These migrations carry the legacy schema the copied
// edge-function chain talks to, so the RP-name scan above cannot apply to them.
// What must hold instead: strictly additive DDL, RLS on with no policies, and
// no redefinition of the runtime's own tables or RPCs.
for (const file of chainFiles) {
  const sql = file.sql.toLowerCase();
  for (const [pattern, why] of [
    [/\bdrop\b/, "drops an object"],
    [/\btruncate\b/, "truncates a table"],
    [/\bdelete\s+from\b/, "deletes rows"],
    [/\binsert\s+into\b/, "inserts rows"],
    [/\bupdate\s+public\./, "updates rows"],
    [/\bcreate\s+policy\b/, "creates a policy (the chain surface exposes nothing)"],
    [/\bgrant\b/, "grants privileges"],
  ]) assert.ok(!pattern.test(sql), `chain migration ${file.name} ${why}`);
  const createdTables = [...sql.matchAll(/create\s+table\s+(if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/g)];
  assert.ok(createdTables.length > 0, `chain migration ${file.name} creates no tables`);
  for (const match of createdTables) assert.ok(match[1], `chain migration ${file.name}: create table public.${match[2]} must be IF NOT EXISTS`);
  for (const match of sql.matchAll(/create\s+(unique\s+)?index\s+(if\s+not\s+exists\s+)?([a-z0-9_]+)/g))
    assert.ok(match[2], `chain migration ${file.name}: index ${match[3]} must be IF NOT EXISTS`);
  for (const match of sql.matchAll(/alter\s+table\s+([^\n]*)/g))
    assert.ok(match[1].includes("enable row level security"), `chain migration ${file.name}: only the RLS enable may alter a table (${match[1].trim()})`);
  assert.ok(sql.includes("enable row level security"), `chain migration ${file.name} must enable RLS`);
  for (const runtimeObject of [
    "designpro_workflow_runs", "designpro_workflow_stages", "designpro_stage_receipts", "designpro_artifacts",
    "designpro_revision_sources", "designpro_vehicle_specs_universal", "designpro_wrapbox_packs",
    "claim_designpro_stage", "complete_designpro_stage", "fail_designpro_stage",
  ]) assert.ok(!sql.includes(`public.${runtimeObject}`), `chain migration ${file.name} touches runtime object ${runtimeObject}`);
}

console.log(`schema closure passed: ${files.length} ordered migrations, ${creates.size} objects, ${chainFiles.length} chain migration(s) audited additively`);
