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
const files = names.map((name) => ({ name, sql: readFileSync(join(root, "supabase/migrations", name), "utf8") }));
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
console.log(`schema closure passed: ${files.length} ordered migrations, ${creates.size} objects`);
