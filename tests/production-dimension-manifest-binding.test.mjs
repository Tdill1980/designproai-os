import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { _test } = require("../runtime/designpro-standalone-claimant.cjs");
const claimant = readFileSync(
  new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url),
  "utf8",
);

const persisted = Object.freeze({
  contract: "designpro.genie-dimension-manifest.v1",
  expectedSurfaces: [{ surfaceKey: "driver", widthInches: 178, heightInches: 49 }],
});

test("paid stages read the GENIE manifest frozen by manifest.resolve", () => {
  const staleInput = { contract: "stale-input", expectedSurfaces: [] };
  assert.equal(
    _test.productionDimensionManifest(
      { results: { dimensionManifest: persisted } },
      { dimensionManifest: staleInput },
    ),
    persisted,
  );
});

test("an in-flight legacy run may use its input manifest", () => {
  assert.equal(
    _test.productionDimensionManifest({}, { dimensionManifest: persisted }),
    persisted,
  );
});

test("a run with no bound or legacy manifest still fails closed", () => {
  assert.throws(
    () => _test.productionDimensionManifest({ results: {} }, {}),
    (error) => error?.code === "invalid_stage_input"
      && error?.message === "production dimensionManifest is required",
  );
});

test("every paid geometry consumer goes through the frozen-manifest reader", () => {
  assert.doesNotMatch(
    claimant,
    /requiredObject\(input\.dimensionManifest|input\.dimensionManifest\?\.expectedSurfaces/,
  );
  assert.equal(
    claimant.match(/const dimensionManifest = productionDimensionManifest\(run, input\)/g)?.length,
    5,
    "upscale, output build, output verify, QC certificate, and ZIP must share the bound manifest",
  );
});
