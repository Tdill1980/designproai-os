import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// OWNER PROTECTION #1 (Trish 2026-08-26): "Version fencing prevents old masters
// from being reused for new authoring or regeneration only. Existing
// generations remain readable, viewable, downloadable, and accessible through
// RevisionStudioIQ, PanelPro, and version history."
//
// The v9-dpag PROMPT_VERSION bump refuses REUSE of an older master when a new
// authoring run tries to continue from it (assertAtlasReuseContract, thrown as
// flat_atlas_master_contract_stale). Nothing on a READ path may check the
// prompt version — a historical v6/v8 generation must keep serving its master,
// panels, proofs and version history untouched.

const require = createRequire(import.meta.url);
const atlas = require("../runtime/flat-first-atlas.cjs");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the version fence exists only on the authoring reuse path", () => {
  const source = read("../runtime/flat-first-atlas.cjs");
  // The stale error is raised in exactly one function…
  const fenceMentions = source.match(/flat_atlas_master_contract_stale/g) || [];
  assert.equal(fenceMentions.length, 1, "the stale fence must have exactly one raise site");
  // …and that function is invoked only from authoring/reuse call sites, never
  // from a loader that read paths use.
  const callSites = [...source.matchAll(/assertAtlasReuseContract\(/g)].length;
  assert.equal(callSites, 3, "definition + the two authoring call sites (reuse + raced) and nothing else");
  const loadFn = source.slice(source.indexOf("async function loadLatestAtlasRevision"), source.indexOf("async function loadLatestAtlasRevision") + 4000);
  assert.doesNotMatch(loadFn.slice(0, loadFn.indexOf("\n}\n") + 3), /PROMPT_VERSION|assertAtlasReuseContract/);
});

test("an older revision still passes the reuse contract's READ-side shape checks only when authoring — and throws the reuse error, not a read error", () => {
  const oldRevision = {
    promptVersion: "designpro-flat-first-atlas-20260824.v6",
    masterAcceptance: { passed: true },
    metadata: {},
    manifest: {},
    manifestAsset: { contentHash: "0".repeat(64) },
  };
  // Reusing an old master for NEW authoring is refused BY THE VERSION FENCE
  // specifically (the geometry basis matches, so the stale prompt version is
  // what trips it).
  assert.throws(
    () => atlas._test.assertAtlasReuseContract(oldRevision, {
      expectedManifestHash: "0".repeat(64),
      expectedPromptHash: "0".repeat(64),
      expectedExampleSetHash: "0".repeat(64),
    }),
    (error) => error?.code === "flat_atlas_master_contract_stale",
  );
});

test("no read surface checks the atlas prompt version", () => {
  // The gateway projects revisions for the UIs; it validates the FIELD SHAPE
  // (an 80-char token) and never the value, so a v6/v8 revision projects
  // exactly like a v9 one.
  const gateway = read("../gateway/src/server.mjs");
  assert.doesNotMatch(gateway, /v9-dpag/);
  assert.doesNotMatch(gateway, /flat_atlas_master_contract_stale/);
  assert.doesNotMatch(gateway, /require\(["'].*flat-first-atlas/);
  // The customer/product API layer types the field; it must not gate on it.
  const dpApi = read("../app/src/lib/designpro-api.ts");
  assert.doesNotMatch(dpApi, /PROMPT_VERSION|v9-dpag|contract_stale/);
});

test("the database read gate removes the exact authoring prompt pin", () => {
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  const latestReadGatePatch = readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => readFileSync(new URL(name, migrations), "utf8")
      .includes("atlas_historical_read_prompt_family_not_installed"))
    .sort()
    .at(-1);
  assert.ok(latestReadGatePatch, "the historical A.T.L.A.S. read migration is missing");
  const migration = readFileSync(new URL(latestReadGatePatch, migrations), "utf8");
  assert.match(migration, /pg_get_functiondef/);
  assert.match(migration, /pg_catalog\.replace\(v_definition, v_exact_pin, v_family_gate\)/);
  assert.match(migration, /\^designpro-flat-first-atlas-\[A-Za-z0-9\._-\]\{1,96\}\$/);
  assert.match(migration, /newest_accepted_atlas_is_not_readable/);
  assert.match(migration, /newest_accepted_atlas_was_superseded/);
});
