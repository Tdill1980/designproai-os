import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { _test } = require("../runtime/designpro-standalone-claimant.cjs");

const TENANT = "user_b940320d-cb5a-4b60-b280-32d12ef4d6a6";
const REVISION_ID = "8499ab58-0c00-40c3-a3c5-9fe2b73cb236";
const GENERATION_ID = "083d2a70-edac-4e75-9caa-1336542baf7c";
const DIMENSIONS = Object.freeze([
  ["driver", 242.2, 57.6],
  ["passenger", 242.2, 57.6],
  ["hood", 71.5, 57.8],
  ["roof", 74.3, 54.8],
  ["front", 79.7, 43.3],
  ["rear", 79.7, 55.7],
]);

function panel(surfaceKey, trimWidthIn, trimHeightIn) {
  const contentHash = createHash("sha256").update(surfaceKey).digest("hex");
  return {
    surfaceKey,
    bucket: "wrap-files",
    storagePath: `designpro/${TENANT}/${GENERATION_ID}/flat-first/v1/panels/${contentHash}.png`,
    contentHash,
    byteSize: 1024,
    contentType: "image/png",
    trimWidthIn,
    trimHeightIn,
    printWidthIn: trimWidthIn + 10,
    printHeightIn: trimHeightIn + 10,
    surfaceSqFt: _test.round2(trimWidthIn * trimHeightIn / 144),
  };
}

function revisionSourceClient(panels) {
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      return {
        data: { snapshot_hash: "snapshot-hash", snapshot: { callOnePanels: panels } },
        error: null,
      };
    },
  };
  return { from: () => query };
}

test("Call 8 design-time area rounds once after the raw six-surface sum", async () => {
  const panels = DIMENSIONS.map((args) => panel(...args));
  const run = {
    id: "f041f306-f4da-4283-8b37-ea07a4bc50a9",
    tenant_key: TENANT,
    revision_id: REVISION_ID,
    revision_snapshot_hash: "snapshot-hash",
  };
  const manifest = await _test.designTimeManifest(revisionSourceClient(panels), run);

  // These are the exact six live DCA dimensions. Their individually rounded
  // display areas add to 305.54, while the canonical raw sum rounds to 305.53.
  assert.equal(
    _test.round2(manifest.expectedSurfaces.reduce((sum, item) => sum + item.surfaceSqFt, 0)),
    305.54,
  );
  assert.equal(manifest.totalSqFt, 305.53);
  assert.equal(manifest.squareFootRounding, "nearest-0.01-after-raw-sum");

  const viewLineage = ["driver", "passenger", "hood", "roof", "front", "rear", "closeup"]
    .map((viewKey) => ({ viewKey }));
  const spec = _test.call8ProofRequest(
    run,
    manifest,
    panels,
    viewLineage,
    { bodyText: {}, logoPlacements: [] },
    {},
  );
  assert.equal(spec.totalSqFt, 305.53);
});
