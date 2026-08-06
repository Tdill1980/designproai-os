import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("exact frozen validator and governing specs are present", async () => {
  const [source, provenance, artboardSpec, call8Spec] = await Promise.all([
    read("integration/adapters/panelizer-step-validate/upstream-index.ts"),
    read("integration/adapters/panelizer-step-validate/SOURCE.json").then(JSON.parse),
    read("integration/specs/ARTBOARD_DIMENSION_FIX_SPEC.md"),
    read("integration/specs/DESIGNPRO_CALL8_PER_SIDE_SURGICAL_FIX.md"),
  ]);
  const digest = createHash("sha256").update(source).digest("hex");
  assert.equal(digest, provenance.retrievedSha256);
  assert.match(artboardSpec, /panelizer-step-validate/);
  assert.match(call8Spec, /Call 8/);
});

test("GENIE validator fails closed and preserves exact print geometry rules", async () => {
  const source = await read("integration/adapters/panelizer-step-validate/index.ts");
  assert.match(source, /dims_verified: dimsVerified/);
  assert.match(source, /reason: unresolvedReason/);
  assert.match(source, /NO generic default/);
  assert.match(source, /widthWithBleed: wBleed/);
  assert.match(source, /heightWithBleed: hBleed/);
  assert.match(source, /isTwoPanelVehicle\(vehicle\)/);
  assert.match(source, /OVERLAP_INCHES/);
  assert.match(source, /roof: \{ widthInches: roofWidth, heightInches: roofLength/);
});

test("all validator local imports are included", async () => {
  for (const path of [
    "integration/adapters/_shared/cors.ts",
    "integration/adapters/_shared/gemini-key-pool.ts",
    "integration/adapters/_shared/panelizer-os/constants.ts",
    "integration/adapters/_shared/panelizer-os/vehicle-database.ts",
  ]) assert.ok((await read(path)).length > 0, path);
});

test("standalone validator changes only the DesignPro-owned dimensions table name", async () => {
  const [upstream, standalone] = await Promise.all([
    read("integration/adapters/panelizer-step-validate/upstream-index.ts"),
    read("integration/adapters/panelizer-step-validate/index.ts"),
  ]);
  assert.equal(standalone, upstream.replaceAll("vehicle_dimensions", "designpro_vehicle_dimensions"));
  assert.doesNotMatch(standalone, /(?<!designpro_)vehicle_dimensions/);
});
