import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const loader = require("../../runtime/flat-atlas-topology-examples.cjs");
const { BUCKET } = require("../../runtime/generation-store.cjs");

const ID = "11111111-1111-4111-8111-111111111111";
const surfaces = ["driver", "passenger", "hood", "roof", "front", "rear"];

function manifest(extra = {}) {
  return {
    contract: "designpro.flat-first-atlas-manifest.v1",
    topology: "rectangular-preview-v1",
    zones: surfaces.map((surfaceKey, index) => ({
      surfaceKey, x: index * 10, y: index * 20, w: 100, h: 200,
    })),
    ...extra,
  };
}

function fixture(overrides = {}) {
  const guideBytes = Buffer.from("server-owned-neutral-guide");
  const manifestValue = manifest();
  const manifestBytes = Buffer.from(JSON.stringify(manifestValue));
  const masterBytes = Buffer.from("server-owned-topology-master");
  const guideHash = loader._test.sha256(guideBytes);
  const manifestHash = loader._test.sha256(manifestBytes);
  const masterHash = loader._test.sha256(masterBytes);
  const row = {
    id: ID,
    example_key: "installer-map",
    version: 1,
    purpose: "topology-only",
    guide_storage_path: `designpro/system/flat-first/examples/installer-map/${guideHash}.png`,
    guide_content_hash: guideHash,
    guide_byte_size: guideBytes.length,
    guide_content_type: "image/png",
    manifest_storage_path: `designpro/system/flat-first/examples/installer-map/${manifestHash}.json`,
    manifest_content_hash: manifestHash,
    manifest_byte_size: manifestBytes.length,
    manifest_content_type: "application/json",
    master_storage_path: `designpro/system/flat-first/examples/installer-map/${masterHash}.png`,
    master_content_hash: masterHash,
    master_byte_size: masterBytes.length,
    master_content_type: "image/png",
    manifest: manifestValue,
    ...overrides,
  };
  const blobs = new Map([
    [row.guide_storage_path, new Blob([guideBytes])],
    [row.manifest_storage_path, new Blob([manifestBytes])],
    [row.master_storage_path, new Blob([masterBytes])],
  ]);
  return { row, blobs, guideBytes, manifestBytes, masterBytes };
}

function supabaseFor(rows, blobs = new Map(), { lookupError = null } = {}) {
  const observed = { table: null, columns: null, orders: [], limit: null, bucket: null, downloads: [] };
  const query = {
    select(columns) { observed.columns = columns; return this; },
    order(column, options) { observed.orders.push([column, options]); return this; },
    limit(limit) {
      observed.limit = limit;
      return Promise.resolve({ data: rows, error: lookupError });
    },
  };
  return {
    observed,
    client: {
      from(table) { observed.table = table; return query; },
      storage: {
        from(bucket) {
          observed.bucket = bucket;
          return {
            async download(path) {
              observed.downloads.push(path);
              return blobs.has(path)
                ? { data: blobs.get(path), error: null }
                : { data: null, error: { message: "missing" } };
            },
          };
        },
      },
    },
  };
}

test("the dormant historical loader can still verify its hash-pinned pair", async () => {
  const { client, observed } = supabaseFor([]);
  const examples = await loader.loadActiveFlatAtlasTopologyExamples(client);
  assert.equal(examples.length, 1);
  assert.equal(examples[0].kind, "paired-flat-to-finished");
  assert.equal(examples[0].purpose, "topology-only");
  assert.equal(examples[0].identity.source, "exact-server-release");
  assert.equal(examples[0].identity.exampleId, null);
  assert.equal(
    loader._test.sha256(examples[0].flattenedTopView.bytes),
    loader._test.BUNDLED_PAIR.flattenedTopView.contentHash,
  );
  assert.equal(
    loader._test.sha256(examples[0].finished3dProof.bytes),
    loader._test.BUNDLED_PAIR.finished3dProof.contentHash,
  );
  assert.equal(observed.table, "designpro_active_flat_atlas_examples");
  assert.equal(observed.limit, 2, "the query detects an ambiguous second active example");
  assert.equal(observed.bucket, null, "the bundled pair requires no legacy Storage object");
});

test("the dormant historical loader verifies a database example after its bundled pair", async () => {
  const item = fixture();
  const { client, observed } = supabaseFor([item.row], item.blobs);
  const examples = await loader.loadActiveFlatAtlasTopologyExamples(client);

  assert.equal(examples.length, 2);
  assert.equal(examples[0].kind, "paired-flat-to-finished");
  assert.deepEqual(examples[1].bytes, item.guideBytes);
  assert.notDeepEqual(examples[1].bytes, item.masterBytes,
    "the example's design style must never become a Gemini conditioning image");
  assert.deepEqual(examples[1].guide.bytes, item.guideBytes);
  assert.equal(examples[1].purpose, "topology-only");
  assert.equal(examples[1].identity.exampleId, ID);
  assert.equal(examples[1].identity.guideContentHash, item.row.guide_content_hash);
  assert.equal(examples[1].identity.masterContentHash, item.row.master_content_hash);
  assert.equal(Object.hasOwn(examples[1], "manifest"), false,
    "the database manifest is verified but not exposed to Gemini parts");
  assert.equal(Object.hasOwn(examples[1], "metadata"), false,
    "operator metadata is never exposed to Gemini parts");
  assert.equal(observed.bucket, BUCKET);
  assert.deepEqual(new Set(observed.downloads), new Set([
    item.row.guide_storage_path, item.row.manifest_storage_path, item.row.master_storage_path,
  ]));
});

test("the loader fails closed on multiple active rows instead of choosing a style input nondeterministically", async () => {
  const first = fixture();
  const second = fixture({ id: "22222222-2222-4222-8222-222222222222", example_key: "other-map" });
  const { client, observed } = supabaseFor([first.row, second.row]);
  await assert.rejects(
    () => loader.loadActiveFlatAtlasTopologyExamples(client),
    (error) => error.code === "flat_atlas_topology_example_ambiguous" && error.retryable === false,
  );
  assert.equal(observed.bucket, null);
});

test("only the service-owned content-addressed namespace is accepted", async () => {
  const item = fixture({ guide_storage_path: "designpro/user_customer/examples/guide.png" });
  const { client, observed } = supabaseFor([item.row], item.blobs);
  await assert.rejects(
    () => loader.loadActiveFlatAtlasTopologyExamples(client),
    (error) => error.code === "flat_atlas_topology_example_path_invalid",
  );
  assert.equal(observed.bucket, null, "invalid database identity is rejected before Storage");
});

test("creative fields are rejected recursively even if a malformed row reaches the active view", async () => {
  const item = fixture({ manifest: manifest({ nested: { palette: ["#ff0000"] } }) });
  const { client, observed } = supabaseFor([item.row], item.blobs);
  await assert.rejects(
    () => loader.loadActiveFlatAtlasTopologyExamples(client),
    (error) => error.code === "flat_atlas_topology_example_style_leak",
  );
  assert.equal(observed.bucket, null);
});

test("tampered Storage bytes never reach Gemini", async () => {
  const item = fixture();
  item.blobs.set(item.row.master_storage_path, new Blob([Buffer.from("different-master")]));
  const { client } = supabaseFor([item.row], item.blobs);
  await assert.rejects(
    () => loader.loadActiveFlatAtlasTopologyExamples(client),
    (error) => error.code === "flat_atlas_topology_example_hash_mismatch",
  );
});

test("stored manifest JSON must match the immutable database topology copy", async () => {
  const item = fixture();
  const different = Buffer.from(JSON.stringify(manifest({ topology: "different-topology" })));
  const differentHash = loader._test.sha256(different);
  item.row.manifest_content_hash = differentHash;
  item.row.manifest_byte_size = different.length;
  item.row.manifest_storage_path = `designpro/system/flat-first/examples/installer-map/${differentHash}.json`;
  item.blobs.set(item.row.manifest_storage_path, new Blob([different]));
  const { client } = supabaseFor([item.row], item.blobs);
  await assert.rejects(
    () => loader.loadActiveFlatAtlasTopologyExamples(client),
    (error) => error.code === "flat_atlas_topology_example_manifest_mismatch",
  );
});

test("active-view read failures remain retryable and never fall back to public URLs", async () => {
  const { client, observed } = supabaseFor([], new Map(), { lookupError: { message: "permission denied" } });
  await assert.rejects(
    () => loader.loadActiveFlatAtlasTopologyExamples(client),
    (error) => error.code === "flat_atlas_topology_example_lookup_failed" && error.retryable === true,
  );
  assert.equal(observed.bucket, null);
});
