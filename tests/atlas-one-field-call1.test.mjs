// ONE-FIELD CALL 1 — the production port of Field Recovery v2 (owner ruling
// 2026-09-02, unfrozen the same day: "UNFREEZE GET ME A WORKING OS").
//
// These locks prove, from the DEPLOYED edge assembly (lifted by esbuild, never
// re-described) and the runtime's own territory builder, that:
//   1. the product field prompt for the Draw-1 fixture is BYTE-IDENTICAL to the
//      prompt the harness drew the only clean flanks with (run 33659500846);
//   2. the whole model-facing prompt carries none of the object-schema,
//      topology or negative vocabulary the field contract forbids;
//   3. the legacy six-container assembly still reproduces the deployed v23 pin,
//      so the harness slice and history are untouched;
//   4. the six code-only territories reproduce Draw 1's recorded geometry;
//   5. the runtime request names the field contract and carries no structural
//      image, and the edge refuses an unknown contract.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAtlasCall1Prompt } from "../scripts/build-atlas-call1-prompt.mjs";
import { resolveEsbuild } from "../scripts/build-control-prompt.mjs";
import { assertFieldPromptClean, CREATIVE_FIELD_SWAPS } from "../scripts/atlas-field-contract-v2.mjs";

const require = createRequire(import.meta.url);
const atlas = require("../runtime/flat-first-atlas.cjs");
const territories = require("../runtime/atlas-field-territories.cjs");
const sha = (v) => createHash("sha256").update(v).digest("hex");

const DRAW1_PROMPT = readFileSync(new URL("../docs/ab/field-recovery-v2-33659500846-prompt-field-v2.txt", import.meta.url), "utf8");
const DRAW1_TERRITORIES = JSON.parse(readFileSync(new URL("../docs/ab/field-recovery-v2-33659500846-territories.json", import.meta.url), "utf8"));
const DEPLOYED_V23_PROMPT_SHA256 = "dcb73e9eae229cd88af6bcdb4a3874e1050b266fa98a55b79fee65d0b7e610b2";

const SURFACES = [["driver", 153, 56], ["passenger", 153, 56], ["hood", 71.5, 56], ["roof", 74.3, 54.8], ["front", 129, 34], ["rear", 76, 54]]
  .map(([surfaceKey, widthInches, heightInches]) => ({
    surfaceKey, widthInches, heightInches,
    surfaceSqFt: Math.round(widthInches * heightInches / 144 * 100) / 100,
    bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  }));
const AUTHORITY = {
  contract: "designpro.genie-proof-geometry-authority.v1", source: "manual", status: "validated",
  purpose: "calls-1-7-layout-only", productionEligible: false, operatorValidated: true, confidence: "high",
  candidateId: "690ad298-6c8e-4ae2-9571-ea532d6bd6c5", validatedAt: "2026-08-30T16:27:33.002+00:00",
  validatedBy: "b940320d-cb5a-4b60-b280-32d12ef4d6a6", sourceUrls: ["https://example.com/reference.jpg"],
};
const FIXTURE_INPUT = {
  contractVersion: "designpro.calls-1-7-input.v3",
  pipelineMode: "flat-first-atlas-v1",
  vehicle: { type: "truck", year: "2022", make: "Ford", model: "F250 Crew Cab" },
  brief: "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with sunrise-orange airflow ribbons sweeping front to rear, clean modern sans-serif company name, high contrast and legible at highway distance.",
  designName: "Teaching-proof field A/B",
  mode: "commercial",
  industry: "HVAC and climate control",
  colors: ["deep blue", "sunrise orange"],
  style: "modern commercial",
};

function fixtureManifests() {
  const legacy = atlas.buildAtlasManifest(SURFACES, AUTHORITY, "truck");
  const field = territories.buildFieldTerritories(legacy);
  return { legacy, field };
}

let sliceModule = null;
async function slice() {
  if (!sliceModule) {
    const outDir = mkdtempSync(join(tmpdir(), "atlas-one-field-"));
    const bundle = buildAtlasCall1Prompt({ outDir, esbuild: resolveEsbuild() });
    sliceModule = await import(`file://${bundle}`);
  }
  return sliceModule;
}

test("the six code-only territories reproduce Draw 1's recorded geometry exactly", () => {
  const { field } = fixtureManifests();
  assert.equal(field.topology, "field-thirds-v2");
  // The territory layout identity travels under its own name; `contract` stays
  // the A.T.L.A.S. manifest identity the proof stage conditions on.
  assert.equal(field.territoriesContract, "designpro.atlas-field-territories.v2");
  assert.equal(field.fieldLayout.contract, "designpro.atlas-field-territories.v2");
  assert.equal(field.contract, atlas.MANIFEST_CONTRACT);
  for (const recorded of DRAW1_TERRITORIES.zones) {
    const zone = field.zones.find((z) => z.surfaceKey === recorded.surfaceKey);
    assert.ok(zone, recorded.surfaceKey);
    for (const key of ["x", "y", "w", "h", "rotationDegrees", "trimWidthIn", "trimHeightIn", "printWidthIn", "printHeightIn", "placement"]) {
      assert.equal(zone[key], recorded[key], `${recorded.surfaceKey}.${key}`);
    }
    assert.deepEqual(zone.trim, recorded.trim, `${recorded.surfaceKey}.trim`);
    assert.equal(zone.effectivePpi, recorded.effectivePpiNative, `${recorded.surfaceKey}.effectivePpi`);
    assert.deepEqual(zone.extraction, { x: zone.x, y: zone.y, w: zone.w, h: zone.h, outputRotationDegrees: 0 });
    assert.ok(zone.guideFill, "the human installer map still has a fill to draw");
  }
  assert.equal(field.fieldLayout.extractedRatio, DRAW1_TERRITORIES.fieldLayout.extractedRatio);
  assert.deepEqual(field.installerMap.noseEdge, { driver: "left", passenger: "right" });
  // Passenger and Driver are two distinct territories of identical file size.
  const d = field.zones.find((z) => z.surfaceKey === "driver");
  const p = field.zones.find((z) => z.surfaceKey === "passenger");
  assert.notDeepEqual([d.x, d.y], [p.x, p.y]);
  assert.deepEqual([d.w, d.h], [p.w, p.h]);
});

test("the runtime request names the field contract and carries no structural image", () => {
  const { field } = fixtureManifests();
  const body = atlas._test.atlasEdgeRequestBody(FIXTURE_INPUT, field, { referenceImagesBase64: ["YmF6"] });
  assert.equal(body.mode, "atlas-artboard");
  assert.equal(body.fieldContract, "designpro.atlas-field-prompt.v2");
  assert.deepEqual(body.noseEdge, { driver: "left", passenger: "right" });
  assert.equal(body.teachingProofStoragePath, undefined);
  assert.equal(body.teachingProofIdentity, undefined);
  assert.equal(body.guideStoragePath, undefined);
  assert.equal(body.guideImageBase64, undefined);
  assert.deepEqual(body.referenceImagesBase64, ["YmF6"]);
  // The six-region list stays as OS data the edge validates; every region is upright.
  assert.equal(body.panels.length, 6);
  assert.ok(body.panels.every((panel) => panel.normalized.orientation === "upright"));
});

test("the DEPLOYED edge assembly produces Draw 1's field prompt byte for byte", async () => {
  const mod = await slice();
  const { field } = fixtureManifests();
  const body = atlas._test.atlasEdgeRequestBody(FIXTURE_INPUT, field, {});
  const { prompt, references } = mod.buildAtlasCall1Prompt(body);
  assert.equal(references.length, 0);
  assert.equal(prompt.length, DRAW1_PROMPT.length);
  assert.equal(sha(prompt), sha(DRAW1_PROMPT));
  assert.equal(prompt, DRAW1_PROMPT);
  // The seven creative swaps landed inside the assembly — every "to" phrase is
  // present and every "from" phrase is gone.
  for (const [from, to] of CREATIVE_FIELD_SWAPS) {
    assert.ok(prompt.includes(to), `field wording present: ${to.slice(0, 40)}…`);
    assert.ok(!prompt.includes(from), `six-container wording gone: ${from.slice(0, 40)}…`);
  }
});

test("the whole model-facing field prompt carries no object-schema, topology or negative vocabulary", async () => {
  const mod = await slice();
  const { field } = fixtureManifests();
  for (const mode of ["commercial", "restyle"]) {
    const body = atlas._test.atlasEdgeRequestBody({ ...FIXTURE_INPUT, mode }, field, {});
    const { prompt } = mod.buildAtlasCall1Prompt(body);
    assert.doesNotThrow(() => assertFieldPromptClean(prompt, `the ${mode} field prompt`));
    assert.match(prompt, /OUTPUT — ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image\./);
    assert.match(prompt, /for this exact 2022 Ford F250 Crew Cab \(/);
    assert.doesNotMatch(prompt, /OUTPUT FORMAT — ONE FLAT A\.T\.L\.A\.S\. ARTBOARD/);
  }
});

test("the legacy six-container assembly still reproduces the deployed v23 prompt pin", async () => {
  const mod = await slice();
  const { legacy } = fixtureManifests();
  const body = atlas._test.atlasEdgeRequestBody(FIXTURE_INPUT, legacy, {});
  delete body.fieldContract;
  delete body.noseEdge;
  const { prompt } = mod.buildAtlasCall1Prompt(body);
  assert.equal(sha(prompt), DEPLOYED_V23_PROMPT_SHA256);
  assert.equal(prompt.length, 4587);
});

test("the edge refuses an unknown field contract and echoes the one it ran", () => {
  const edge = readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");
  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  assert.match(handler, /if \(fieldContract && fieldContract !== ATLAS_FIELD_PROMPT_CONTRACT\)/);
  assert.match(handler, /atlas_artboard_field_contract_unknown/);
  assert.match(handler, /fieldContract: atlasField \? ATLAS_FIELD_PROMPT_CONTRACT : null/);
  // The runtime verifies the echo and the image count on receipt.
  const runtime = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  const verify = runtime.slice(runtime.indexOf("async function callAtlasArtboardEdge"), runtime.indexOf("async function verifiedCustomerLogoPart"));
  assert.match(verify, /flat_atlas_edge_field_contract_mismatch/);
  assert.match(verify, /flat_atlas_edge_structural_image_detected/);
  assert.match(verify, /Number\(payload\?\.modelInputImageCount\) !== customerImageCount/);
});

/**
 * THE LINE THAT COST EVERY PROOF SINCE v24.
 *
 * `buildFieldTerritories` returned `contract: FIELD_TERRITORIES_CONTRACT`,
 * overwriting the A.T.L.A.S. manifest identity on the manifest it is a layout
 * OF. `atlasProjectionParts` conditions every proof on
 * `atlas.manifest.contract !== MANIFEST_CONTRACT`, so the field manifest failed
 * that gate and threw `flat_atlas_conditioning_invalid`: the run cut all six
 * panels and then rendered zero of seven proofs.
 *
 * Live, twice. Arctic Air `586abc83`: master persisted 2026-09-04 17:40:34.081,
 * request failed 17:40:34.535 -- 454ms later, on the first proof, with
 * `{"code":"flat_atlas_conditioning_invalid"}`. `1a0e6b70` before it. Both read
 * `6/6 panels · 0/7 proofs · calls_1_7_failed`.
 *
 * So this drives the REAL call with a REAL authority built by the runtime's own
 * `viewAuthorityFromPanel`, not a hand-shaped object that could agree with a
 * predicate while disagreeing with the system.
 */
test("atlasProjectionParts accepts the field manifest and conditions a proof", async () => {
  const { field } = fixtureManifests();
  const sharp = require("../runtime/node_modules/sharp");

  const masterBytes = Buffer.from("atlas-master-bytes-for-conditioning");
  const masterHash = sha(masterBytes);
  const panelBytes = await sharp({ create: { width: 96, height: 48, channels: 3, background: "#123a6b" } })
    .png().toBuffer();
  const panel = {
    surfaceKey: "driver",
    bytes: panelBytes,
    contentHash: sha(panelBytes),
    byteSize: panelBytes.length,
    surfaceSourceHash: masterHash,
  };
  const authority = await atlas._test.viewAuthorityFromPanel(panel, "side");
  const conditioned = {
    master: { bytes: masterBytes, contentHash: masterHash },
    manifest: field,
    viewAuthorities: { side: authority },
    callOnePanels: [{ surfaceKey: "driver", contentHash: panel.contentHash }],
  };

  // THE REGRESSION: this threw for every run since v24.
  const parts = atlas.atlasProjectionParts(conditioned, "side");
  assert.ok(Array.isArray(parts) && parts.length > 0, "a conditioned proof must produce parts");
  assert.equal(parts[0].inlineData.mimeType, "image/jpeg");
  assert.equal(parts[0].inlineData.data, authority.bytes.toString("base64"));

  // The fix restores the identity; it does not remove the check. A manifest
  // that genuinely is not an A.T.L.A.S. manifest is still refused, and so is a
  // proof with no master behind it.
  assert.throws(
    () => atlas.atlasProjectionParts(
      { ...conditioned, manifest: { ...field, contract: "designpro.something-else.v1" } }, "side"),
    (error) => error.code === "flat_atlas_conditioning_invalid",
  );
  assert.throws(
    () => atlas.atlasProjectionParts({ ...conditioned, master: null }, "side"),
    (error) => error.code === "flat_atlas_conditioning_invalid",
  );
});
