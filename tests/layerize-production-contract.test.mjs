import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("Layerize is a server-owned ProductionFlow route", () => {
  const app = read("app/src/App.tsx");
  const gateway = read("gateway/src/server.mjs");
  const runtime = read("runtime/index.js");

  assert.match(app, /path="\/productionflow\/layerize"[\s\S]*<RequireAuth><Layerize/);
  assert.match(gateway, /url\.pathname === "\/api\/layerize\/run"/);
  assert.match(gateway, /verifyStoredAsset\(fetchImpl, token, cfg, user\.id/);
  assert.match(gateway, /\/internal\/layerize\/run/);
  assert.match(runtime, /createLayerizeService/);
  assert.match(runtime, /app\.post\("\/internal\/layerize\/run", authMiddleware/);
});

test("Layerize fidelity master cannot substitute fonts or generatively redraw art", () => {
  const service = read("runtime/layerize.cjs");
  const engine = read("runtime/layerize-vtracer/engine.mjs");

  assert.match(engine, /filterSpeckle: 1/);
  assert.match(engine, /colorPrecision: 8/);
  assert.match(engine, /pathPrecision: 8/);
  assert.doesNotMatch(service, /topaz/i);
  assert.match(service, /generativeAiUsed:false/);
  assert.match(service, /source-derived vector outlines; never re-typeset, font-matched or substituted/);
  assert.match(service, /layerize_svg_requires_outlined_paths/);
  assert.match(service, /The fidelity master is NEVER clustered/);
  assert.match(service, /No post-trace node simplification/);
});

test("Layerize native VTracer WASM is packaged inside the DigitalOcean runtime", () => {
  const encoded = read("runtime/layerize-vtracer/vtracer.wasm.b64").replace(/\s+/g, "");
  const bytes = Buffer.from(encoded, "base64");
  assert.ok(bytes.length > 100_000);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d]);
  assert.match(read("runtime/layerize-vtracer/engine.mjs"), /vtracer\.wasm\.b64/);
  assert.match(read("runtime/package.json"), /layerize-vtracer\/engine\.mjs/);
});

test("Layerize pay-per-use reservation is durable, idempotent and refundable", () => {
  const migration = read("supabase/migrations/20260924053000_layerize_runs.sql");
  assert.match(migration, /UNIQUE\(owner_id, source_content_hash, output_mode\)/);
  assert.match(migration, /role::text IN \('admin','tester'\)/);
  assert.match(migration, /IF NOT FOUND OR t\.balance < 3 THEN/);
  assert.match(migration, /balance=balance-3/);
  assert.match(migration, /total_used=total_used\+3/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fail_layerize_run/);
  assert.match(migration, /balance=balance\+3/);
  assert.match(migration, /total_used=greatest\(0,total_used-3\)/);
  assert.match(migration, /IF r\.state='completed' AND r\.output_storage_path IS NOT NULL THEN/);
});

test("Layerize is discoverable from Production Jobs and the pay-per-use catalog", () => {
  const jobs = read("app/src/pages/designpro/ProductionJobs.tsx");
  const pay = read("app/src/pages/PayPerUseLanding.tsx");
  assert.match(jobs, /to="\/productionflow\/layerize">Layerize artwork/);
  assert.match(pay, /slug: "layerize"/);
  assert.match(pay, /Got a flattened file\? Layerize it\./);
  assert.match(pay, /1 Layerize run · 3 tokens/);
});
