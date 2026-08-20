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
  // A DROP is only allowed when the SAME migration puts the check back. Assert
  // the ORDER, not the mere presence of both: a trailing DROP would leave the
  // artifact-kind column unconstrained in production.
  const dropAt = migration.search(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+designpro_artifacts_artifact_kind_check/i);
  const addAt = migration.search(/ADD\s+CONSTRAINT\s+designpro_artifacts_artifact_kind_check\s+CHECK/i);
  assert.ok(addAt >= 0, "artifact-kind check must be recreated in the same migration");
  if (dropAt >= 0) {
    assert.ok(addAt > dropAt, "artifact-kind check must be recreated AFTER the drop, not before it");
    assert.ok(
      !/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+designpro_artifacts_artifact_kind_check/i.test(migration.slice(addAt)),
      "the artifact-kind check must not be dropped again after it is recreated",
    );
  }
});
