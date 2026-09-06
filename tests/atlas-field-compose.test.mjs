import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const atlas = require("../runtime/flat-first-atlas.cjs");
const { deterministicMasterChecks } = require("../runtime/atlas-master-qc.cjs");
const {
  FIELD_COMPOSE_CONTRACT,
  composeAtlasFromField,
  _test: { sourceBand },
} = require("../runtime/atlas-field-compose.cjs");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const FIELD_RECOVERY_V2 = readFileSync(new URL("../docs/ab/field-recovery-v2-33659500846-raw-master-1600.jpg", import.meta.url));
const SURFACES = [["driver", 153, 56], ["passenger", 153, 56], ["hood", 71.5, 56], ["roof", 74.3, 54.8], ["front", 129, 34], ["rear", 76, 54]]
  .map(([surfaceKey, widthInches, heightInches]) => ({
    surfaceKey, widthInches, heightInches,
    surfaceSqFt: Math.round(widthInches * heightInches / 144 * 100) / 100,
    bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  }));

function manifest() {
  const value = atlas.buildAtlasManifest(SURFACES);
  value.geometryResolution = {
    contract: "designpro.genie-manifest.v1",
    genieManifestId: "0".repeat(32),
    genieManifestHash: "a".repeat(64),
    state: "measured",
    productionEligible: true,
  };
  return value;
}

test("the three creative registers map to six surfaces without reading pixels", () => {
  const driver = sourceBand(1600, 1600, "driver");
  const passenger = sourceBand(1600, 1600, "passenger");
  const lower = ["hood", "roof", "front", "rear"].map((key) => sourceBand(1600, 1600, key));

  assert.deepEqual(driver, { left: 20, top: 21, width: 1560, height: 491 });
  assert.deepEqual(passenger, { left: 20, top: 554, width: 1560, height: 492 });
  assert.ok(passenger.top > driver.top + driver.height, "the optional presentation gutter is never composed");
  for (const region of lower) assert.deepEqual(region, lower[0], "all four supporting surfaces read the complete lower register");
  assert.ok(lower[0].top > passenger.top + passenger.height, "the lower presentation gutter is never composed");
});

test("the measured Field Recovery v2 artwork becomes one valid six-surface A.T.L.A.S.", async () => {
  const target = manifest();
  const composed = await composeAtlasFromField({ fieldBytes: FIELD_RECOVERY_V2, manifest: target });

  assert.equal(composed.contract, FIELD_COMPOSE_CONTRACT);
  assert.equal(composed.zonesComposed, 6);
  assert.deepEqual(composed.mappings.map((item) => item.surfaceKey), atlas.SURFACE_KEYS);
  assert.deepEqual(composed.mappings.map((item) => item.sourceRegister), ["upper", "middle", "lower", "lower", "lower", "lower"]);

  const metadata = await sharp(composed.bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [4096, 4096]);

  const qc = await deterministicMasterChecks(composed.bytes, target);
  assert.deepEqual(qc.blockingFailures, [], "geometry-by-construction must pass the unchanged master gate");

  const masterHash = sha256(composed.bytes);
  const panels = await atlas.cutCallOnePanels(composed.bytes, target, masterHash);
  assert.equal(panels.length, 6);
  assert.deepEqual(panels.map((panel) => panel.surfaceKey), atlas.PANEL_EXTRACTION_ORDER);
  for (const panel of panels) {
    assert.equal(panel.sourceMasterHash, masterHash);
    assert.equal(panel.surfaceSourceHash, masterHash);
    assert.equal(panel.deterministic, true);
    assert.ok(panel.byteSize > 10_000, `${panel.surfaceKey} must contain real artwork, not an empty placeholder`);
  }
});

test("field composition happens before unchanged A.T.L.A.S. acceptance and cutting", () => {
  const source = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  const composeAt = source.indexOf("composeAtlasFromField({ fieldBytes: generated.bytes, manifest })");
  const gateAt = source.indexOf("deterministicMasterChecks(masterBytes, manifest)", composeAt);
  const cutAt = source.indexOf("cutCallOnePanels(surfaceSourceBytes, manifest", gateAt);
  assert.ok(composeAt > 0 && gateAt > composeAt && cutAt > gateAt, "field -> compose -> gate -> cut is the only active order");
  assert.doesNotMatch(source.slice(composeAt, gateAt), /fillMasterCutouts|heal|repair/i);
  assert.doesNotMatch(source, /normalizeAtlasMaster\(generated\.bytes, manifest\)/);
});
