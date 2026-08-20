import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migration = readFileSync(join(root, "supabase", "migrations", "20260820044500_designpro_call10_panel_duplicates.sql"), "utf8");

test("schema admits panel-duplicate without weakening authoritative panel identity", () => {
  assert.match(migration, /'panel-duplicate'/);
  assert.match(migration, /'panel'/);
  assert.match(migration, /'qc-panel'/);
  assert.ok(!/DROP\s+CONSTRAINT[\s\S]*;\s*$/i.test(migration.trim()), "artifact-kind check must be recreated in the same migration");
  assert.match(migration, /ADD CONSTRAINT designpro_artifacts_artifact_kind_check CHECK/);
});
