import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const required = [
  "runtime/index.js",
  "runtime/designpro-standalone-claimant.cjs",
  "runtime/runtime-contract.cjs",
  "runtime/runtime-readiness.cjs",
  "runtime/genie-universal-resolver.cjs",
  "runtime/gemini-flat-surface.cjs",
  "runtime/output-qc.cjs",
  "runtime/zip-spool.cjs",
  "runtime/wrapbox-delivery.cjs",
  "runtime/resend-transport.cjs",
  "gateway/src/server.mjs",
  "ops/Dockerfile.runtime",
  "ops/runtime-healthcheck.js",
  "supabase/migrations",
  "source-tests/runtime/production-runtime-blockers.test.mjs",
];
const missing = required.filter((path) => !existsSync(resolve(root, path)));
if (missing.length) {
  console.error(`Release layout incomplete: ${missing.join(", ")}`);
  process.exit(2);
}

const migrationRoot = resolve(root, "supabase/migrations");
const migrationEntries = readdirSync(migrationRoot).sort();
const nonSql = migrationEntries.filter((name) => !name.endsWith(".sql") || !statSync(resolve(migrationRoot, name)).isFile());
if (nonSql.length) {
  console.error(`Migration directory contains non-SQL entries: ${nonSql.join(", ")}`);
  process.exit(2);
}
const migrationSql = migrationEntries.map((name) => readFileSync(resolve(migrationRoot, name), "utf8")).join("\n").toLowerCase();
for (const requiredContract of ["designpro_runtime_readiness", "designpro.runtime-readiness.v2", "reconcile_designpro_automatic_production", "validate_designpro_vehicle_spec_universal", "request_designpro_universal_dimension_validation", "register_designpro_operator_wrapbox_recipient", "commit_designpro_wrapbox_pack", "claim_designpro_wrapbox_notification", "complete_designpro_wrapbox_notification", "fail_designpro_wrapbox_notification", "heavyoutputleasefence", "wrapboxfence"]) {
  if (!migrationSql.includes(requiredContract)) {
    console.error(`Migration contract missing: ${requiredContract}`);
    process.exit(2);
  }
}

const runtimeRoot = resolve(root, "runtime");
if (!existsSync(resolve(runtimeRoot, "node_modules/tus-js-client/package.json"))) {
  const installEnvironment = { ...process.env, npm_config_cache: process.env.npm_config_cache || resolve(tmpdir(), "designproai-npm-cache") };
  const install = spawnSync("npm", ["ci", "--omit=dev"], { cwd: runtimeRoot, stdio: "inherit", env: installEnvironment });
  if (install.error) throw install.error;
  if (install.status !== 0) process.exit(install.status ?? 1);
}

const suites = ["source-tests/runtime", "source-tests/schema"]
  .flatMap((directory) => readdirSync(resolve(root, directory))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => resolve(root, directory, name)));
if (suites.length < 17) {
  console.error(`Refusing partial test run: expected at least 17 shipped suites, found ${suites.length}`);
  process.exit(2);
}

const result = spawnSync(process.execPath, ["--test", ...suites], {
  cwd: root,
  encoding: "utf8",
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
