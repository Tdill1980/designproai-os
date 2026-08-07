import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../gateway/src/server.mjs", import.meta.url), "utf8");

test("revision ingestion requires a complete immutable snapshot", () => {
  assert.match(source, /"revisionSnapshot"/);
  assert.match(source, /designpro\.revision-snapshot\.v1/);
  for (const field of ["vehicle", "surfaceOptions", "finish", "bodyText"]) {
    assert.match(source, new RegExp(`"${field}"`));
  }
  assert.match(source, /designId: canonicalDesignId\(body\.generationId\)/);
  assert.match(source, /orderNumber: (?:body\.revisionSnapshot|snapshot)\.delivery\.orderNumber/);
  assert.doesNotMatch(source, /designId: body\.generationId/);
  assert.match(source, /visualizationId: body\.visualizationId/);
  assert.match(source, /renderAssets: body\.renderAssets/);
  assert.match(source, /users\/\$\{userId\}\/revisions\/\$\{intent\.revisionId\}\/inputs/);
  assert.doesNotMatch(source, /renderUrls: body\.renderUrls/);
  assert.match(source, /save_designpro_revision_source/);
  assert.match(source, /create_designpro_entice_workflow/);
  assert.match(source, /p_snapshot_hash: null/);
});

test("production start accepts only an Entice run reference, not client hashes", () => {
  assert.match(source, /url\.pathname === "\/api\/production"/);
  assert.match(source, /"enticeWorkflowRunId", "idempotencyKey"/);
  const route = source.slice(source.indexOf('url.pathname === "/api/production"'), source.indexOf("const match =", source.indexOf('url.pathname === "/api/production"')));
  assert.doesNotMatch(route, /sourceContractHash|manifestHash|artifactSetHash|dimensionManifestId/);
  assert.match(route, /create_designpro_production_workflow/);
});

test("gateway retains cookie auth and has no service-role authority", () => {
  assert.match(source, /HttpOnly/);
  assert.match(source, /SameSite=Strict/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE/);
  assert.match(source, /WORKER_SECRET/);
  assert.match(source, /DESIGNPRO_RUNTIME_INTERNAL_URL/);
});

test("human approvals require and forward known passing structured QC", () => {
  assert.match(source, /function exactQc\(body, gate\)/);
  assert.match(source, /required\.some\(\(key\) => qc\[key\] !== true\)/);
  assert.match(source, /const qc = exactQc\(await readBody\(req\), gate\)/);
  assert.match(source, /gate === "preflight"/);
  assert.match(source, /approve_designpro_human_gate/);
  assert.match(source, /await_panelpro_preflight_qc/);
  assert.match(source, /await_final_human_qc/);
});
