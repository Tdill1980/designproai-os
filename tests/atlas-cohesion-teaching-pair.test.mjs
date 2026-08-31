import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadDesignIQ } from "./helpers/load-designiq.mjs";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const examples = require("../runtime/flat-atlas-topology-examples.cjs");
const runtime = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");
const { validateAtlasCohesionExampleIdentity } = await loadDesignIQ();

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const CANONICAL_EDGE_IDENTITY = Object.freeze({
  contract: "designpro.atlas-design-teaching-example.v2",
  purpose: "flat-output-cohesion-only",
  version: 2,
  flattenedTopViewContentHash: "20085eb547251d46c8113014108b088e35a4d41e2ce77b9a152b2786e79c37fa",
  flattenedTopViewByteSize: 619255,
});

test("the owner-selected Flamingo flat example is release-pinned and historically identified", () => {
  const example = examples.loadBundledAtlasCohesionExample();
  assert.equal(example.identity.contract, "designpro.atlas-design-teaching-example.v2");
  assert.equal(example.identity.purpose, "flat-output-cohesion-only");
  assert.equal(example.identity.historicalGenerationId, "5b2eb96c-77b5-4705-8cad-fef00af677fe");
  assert.equal(example.identity.historicalRevisionId, "b1941528-e375-4d93-bef7-2fd48213370a");
  assert.equal(example.identity.historicalVehicle, "2022 Ford F-250 Crew Cab");
  assert.equal(example.identity.outputRule, "six-solid-full-bleed-print-art-rectangles");
  assert.equal(example.flattenedTopView.bytes.length, 619255);
  assert.equal(Object.hasOwn(example, "finished3dProof"), false);
  assert.equal(sha256(example.flattenedTopView.bytes),
    "20085eb547251d46c8113014108b088e35a4d41e2ce77b9a152b2786e79c37fa");
});

test("the flat teaching derivative has six filled rectangles and no wheel-well-sized black void", async () => {
  const pair = examples.loadBundledAtlasCohesionExample();
  const { data, info } = await sharp(pair.flattenedTopView.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1254);
  assert.equal(info.height, 1254);
  assert.equal(info.channels, 3);

  // Insets of the exact six visible rectangles. Small dark artwork details are
  // legitimate; a wheel/bed hole consumes far more than this two-percent cap.
  const zones = [
    [52, 56, 338, 1160],
    [423, 56, 412, 235],
    [423, 312, 412, 452],
    [423, 786, 412, 285],
    [423, 1094, 412, 124],
    [866, 56, 337, 1160],
  ];
  for (const [x, y, width, height] of zones) {
    let nearlyBlack = 0;
    const total = width * height;
    for (let py = y; py < y + height; py += 1) {
      for (let px = x; px < x + width; px += 1) {
        const offset = (py * info.width + px) * info.channels;
        if (Math.max(data[offset], data[offset + 1], data[offset + 2]) < 18) nearlyBlack += 1;
      }
    }
    assert.ok(nearlyBlack / total < 0.02, `flat teaching rectangle has a black void ratio ${nearlyBlack / total}`);
  }
});

test("Call 1 keeps the flat teaching example outside customer-reference authority and hashes it into reuse", () => {
  assert.match(runtime, /loadBundledAtlasCohesionExample/);
  assert.match(runtime, /atlasDesignTeachingExample: cohesionExample\.identity/);
  assert.match(runtime, /cohesionExampleIdentity: cohesionExample\.identity/);
  assert.match(runtime, /atlasDesignTeachingExampleApplied: true/);
  assert.match(runtime, /topologyExamplesApplied: 0/);
  assert.doesNotMatch(runtime, /referenceImagesBase64:[^\n]*cohesionExample/);
  assert.doesNotMatch(runtime, /loadBundledFlatToFinishedExample/,
    "the historical Houdini pair must remain dormant");
});

test("edge verifies the flat teaching bytes and leaves the current target guide as the final image", () => {
  assert.match(edge, /ATLAS_COHESION_EXAMPLE_CONTRACT = "designpro\.atlas-design-teaching-example\.v2"/);
  assert.match(edge, /atlas_artboard_input_hash_mismatch/);
  assert.match(edge, /atlas_artboard_input_size_mismatch/);
  assert.match(edge, /ATLAS_COHESION_EXAMPLE_MAX_BYTES/);
  assert.match(edge, /modelRequestByteSize > ATLAS_ARTBOARD_MODEL_REQUEST_MAX_BYTES/);

  const flat = edge.indexOf("RELEASE-PINNED FLAT A.T.L.A.S. OUTPUT EXAMPLE");
  const customer = edge.indexOf("for (const ref of references) pushImage(ref)", flat);
  const corrective = edge.indexOf("body.correctiveNote", customer);
  const target = edge.indexOf("CURRENT TARGET GUIDE", corrective);
  const guide = edge.indexOf("await downloadPart(body.guideStoragePath", target);
  assert.ok(flat > 0 && flat < customer && customer < corrective
    && corrective < target && target < guide);
  assert.match(edge, /cohesionExampleIdentity: verifiedCohesionExample/);
  assert.doesNotMatch(edge, /cohesionExampleProofStoragePath|ATLAS_COHESION_PROOF_HASH|INSTALLED DRIVER PROOF/);
  assert.match(edge, /modelInputImageCount/);
});

test("edge independently pins the exact release teaching identity", () => {
  assert.equal(validateAtlasCohesionExampleIdentity(CANONICAL_EDGE_IDENTITY), CANONICAL_EDGE_IDENTITY);
  assert.throws(
    () => validateAtlasCohesionExampleIdentity(null),
    /atlas_artboard_cohesion_example_identity_invalid/,
  );
  for (const [field, substituted] of [
    ["contract", "designpro.atlas-design-teaching-example.v1"],
    ["purpose", "style-authority"],
    ["version", 1],
    ["flattenedTopViewContentHash", "f".repeat(64)],
    ["flattenedTopViewByteSize", 619254],
  ]) {
    assert.throws(
      () => validateAtlasCohesionExampleIdentity({ ...CANONICAL_EDGE_IDENTITY, [field]: substituted }),
      /atlas_artboard_cohesion_example_identity_invalid/,
      `${field} cannot be caller-substituted`,
    );
  }
  for (const literal of [
    CANONICAL_EDGE_IDENTITY.contract,
    CANONICAL_EDGE_IDENTITY.purpose,
    String(CANONICAL_EDGE_IDENTITY.version),
    CANONICAL_EDGE_IDENTITY.flattenedTopViewContentHash,
    String(CANONICAL_EDGE_IDENTITY.flattenedTopViewByteSize),
  ]) {
    assert.ok(edge.includes(literal), `edge must contain exact pair identity ${literal}`);
  }
});

test("atlas-artboard is internal-only and requires the flat example without changing normal modes", () => {
  const atlasBranch = edge.indexOf('if (body?.mode === "atlas-artboard")');
  const internalOnly = edge.indexOf("if (!internalCaller.internal)", atlasBranch);
  const refusal = edge.indexOf('error: "atlas_artboard_internal_only"', internalOnly);
  const call = edge.indexOf("return await handleAtlasArtboard(body)", refusal);
  const normalMode = edge.indexOf("const {", call);
  assert.ok(atlasBranch > 0 && atlasBranch < internalOnly && internalOnly < refusal
    && refusal < call && call < normalMode,
  "browser refusal must stay inside the Atlas branch while normal modes continue below");
  assert.match(edge.slice(atlasBranch, call), /status: 403/);

  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  assert.match(handler, /if \(!cohesionFlatPath\)/);
  assert.match(handler, /atlas_artboard_cohesion_example_incomplete/);
  assert.match(handler, /validateAtlasCohesionExampleIdentity\(body\.cohesionExampleIdentity\)/);
});

test("canonical input order is prompt, flat, customer, correction, target guide", () => {
  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  const prompt = handler.indexOf("[{ text: prompt }]");
  const flat = handler.indexOf("RELEASE-PINNED FLAT A.T.L.A.S. OUTPUT EXAMPLE", prompt);
  const customer = handler.indexOf("for (const ref of references) pushImage(ref)", flat);
  const corrective = handler.indexOf("body.correctiveNote", customer);
  const target = handler.indexOf("CURRENT TARGET GUIDE", corrective);
  const guide = handler.indexOf("await downloadPart(body.guideStoragePath", target);
  assert.ok(prompt >= 0 && prompt < flat && flat < customer
    && customer < corrective && corrective < target && target < guide);
  assert.doesNotMatch(runtime, /guideImageBase64:/,
    "the production runtime must leave the downloaded target guide as the final model image");
});
