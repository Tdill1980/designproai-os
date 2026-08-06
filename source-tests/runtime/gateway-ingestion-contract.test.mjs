import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../integration/gateway/server.mjs", import.meta.url), "utf8");

test("revision ingestion requires a complete immutable snapshot", () => {
  assert.match(source, /"revisionSnapshot"/);
  assert.match(source, /designpro\.revision-snapshot\.v1/);
  for (const field of ["vehicle", "surfaceOptions", "finish", "bodyText"]) {
    assert.match(source, new RegExp(`"${field}"`));
  }
  assert.match(source, /designId: body\.generationId/);
  assert.match(source, /visualizationId: body\.visualizationId/);
  assert.match(source, /renderUrls: body\.renderUrls/);
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
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE|WORKER_SECRET/);
});

test("human approvals require and forward known passing structured QC", () => {
  assert.match(source, /body\.qc\.known !== true/);
  assert.match(source, /body\.qc\.pass !== true/);
  assert.match(source, /qc: body\.qc/);
  assert.match(source, /approve_designpro_panelpro_preflight/);
  assert.match(source, /approve_designpro_production_pack/);
});
