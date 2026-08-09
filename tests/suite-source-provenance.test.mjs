import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../docs/migration/2026-08-08-suite-source-provenance.json", import.meta.url), "utf8"));

test("suite extraction is pinned and refuses a mixed-shell copy", () => {
  assert.equal(manifest.schemaVersion, "designproai.suite-source-provenance.v1");
  assert.equal(manifest.repositories.target.baseCommit, "b0cf022396a22b86d6a0b471aef82af5e375606e");
  assert.equal(manifest.repositories.source.auditedCommit, "bdb26365904e91be446894e84b01b4a24f64aac0");
  assert.equal(manifest.decision.state, "blocked-no-executable-copy");
  assert.ok(manifest.nextExecutablePullRequest.mustNot.includes("Copy src/App.tsx wholesale."));
});

test("Calls 1-7 source behavior is frozen by exact blob identity", () => {
  const frozen = manifest.generationFreeze.sourceFiles;
  for (const required of [
    "supabase/functions/design-panel-ai-generate/index.ts",
    "supabase/functions/generate-color-render/index.ts",
    "supabase/functions/generate-pattern-render/index.ts",
    "supabase/functions/_shared/studio-os.ts",
    "supabase/functions/_shared/view-angles-os.ts",
  ]) {
    assert.match(frozen[required], /^[0-9a-f]{40}$/, `missing frozen blob: ${required}`);
  }
});

test("manifest prevents RestylePro project and legacy-table cutover", () => {
  assert.equal(manifest.repositories.source.supabaseProjectPinnedBySourceClient, "kfapjdyythzyvnpdeghu");
  for (const table of ["color_visualizations", "designiq_generations", "panelizer_jobs", "user_roles"]) {
    assert.ok(manifest.repositories.target.blockedLegacyTables.includes(table));
  }
  assert.ok(manifest.nextExecutablePullRequest.mustNot.some((item) => item.includes("kfapjdyythzyvnpdeghu")));
  assert.ok(manifest.prohibitedExtractionDependencies.includes("Railway or browser execution authority"));
});

test("inventory keeps all required checklist states explicit", () => {
  assert.deepEqual(Object.keys(manifest.checklist), [
    "ALREADY_COMPLETE",
    "VERIFIED_WORKING",
    "NEEDS_FIX",
    "MISSING",
    "BLOCKED",
  ]);
  assert.ok(manifest.applicationClosures.every((entry) => entry.status === "blocked"));
});
