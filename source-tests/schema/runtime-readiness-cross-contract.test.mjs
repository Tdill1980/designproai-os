import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const runtime = readFileSync(join(root, "runtime/runtime-readiness.cjs"), "utf8");
const migrations = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(root, "supabase/migrations", name), "utf8"))
  .join("\n");

test("runtime and the final sorted migration chain require the same readiness v2 fences", () => {
  assert.match(runtime, /READINESS_CONTRACT = "designpro\.runtime-readiness\.v2"/);
  assert.match(migrations, /'contract','designpro\.runtime-readiness\.v2'/);
  const definitions = [...migrations.matchAll(
    /CREATE OR REPLACE FUNCTION public\.designpro_runtime_readiness\(\)[\s\S]*?\$fn\$;/g,
  )].map((match) => match[0]);
  assert.ok(definitions.length >= 2, "ordered compatibility and final readiness definitions are required");
  assert.match(definitions.at(-1), /'contract','designpro\.runtime-readiness\.v2'/);
  assert.doesNotMatch(definitions.at(-1), /designpro\.runtime-readiness\.v1/);
  for (const field of ["groundedIdentityFence", "heavyOutputLeaseFence", "wrapboxFence"]) {
    assert.ok(runtime.includes(`database.${field} !== true`), `runtime does not require ${field}`);
    assert.ok(migrations.includes(`'${field}'`), `migration readiness does not return ${field}`);
  }
  assert.match(migrations, /'ready',pg_catalog\.jsonb_array_length\(v_missing\)=0[\s\S]*?v_grounded_identity_fence[\s\S]*?v_heavy_lease_fence[\s\S]*?v_wrapbox_fence/);
});
