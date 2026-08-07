import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");

function run(label, command, args, cwd = root) {
  process.stdout.write(`\n== ${label} ==\n`);
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const required = [
  "runtime/index.js",
  "runtime/designpro-standalone-claimant.cjs",
  "runtime/runtime-contract.cjs",
  "runtime/runtime-readiness.cjs",
  "runtime/genie-universal-resolver.cjs",
  "runtime/gemini-flat-surface.cjs",
  "runtime/output-qc.cjs",
  "runtime/resend-transport.cjs",
  "runtime/wrapbox-delivery.cjs",
  "runtime/zip-spool.cjs",
  "gateway/src/server.mjs",
  "web/src/main.tsx",
  "supabase/migrations/20260806181000_designpro_runtime_readiness.sql",
  "ops/validate-package.sh",
  "ops/release-files.txt",
  "ops/validate-release-tree.py",
];
const missing = required.filter((path) => !existsSync(resolve(root, path)));
if (missing.length) {
  console.error(`Refusing an incomplete release tree: ${missing.join(", ")}`);
  process.exit(2);
}

const sourceTestRoots = ["source-tests/runtime", "source-tests/schema"]
  .map((path) => resolve(root, path));
const sourceTests = sourceTestRoots.flatMap((directory) => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => resolve(directory, name));
});
if (sourceTests.length < 17) {
  console.error(`Refusing a partial source gate: expected at least 17 suites, found ${sourceTests.length}`);
  process.exit(2);
}

const rootTestDirectory = resolve(root, "tests");
const rootTests = readdirSync(rootTestDirectory)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => resolve(rootTestDirectory, name));
if (rootTests.length === 0) {
  console.error("Refusing a release without standalone repository tests");
  process.exit(2);
}

run("runtime syntax", "npm", ["run", "check", "--prefix", "runtime"]);
run("runtime and schema executable contracts", process.execPath, ["--test", "--test-concurrency=1", ...sourceTests]);
run("standalone repository static contracts", process.execPath, ["--test", "--test-concurrency=1", ...rootTests]);
run("authenticated gateway", "npm", ["test", "--prefix", "gateway"]);
run("white control panel", "npm", ["test", "--prefix", "web"]);
run("white control panel production build", "npm", ["run", "build", "--prefix", "web"]);
run("server and archive boundary", "bash", ["ops/validate-package.sh"]);

process.stdout.write("\nAll non-Docker exact-release gates passed.\n");
