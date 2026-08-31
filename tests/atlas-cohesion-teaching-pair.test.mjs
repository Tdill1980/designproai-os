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
const { validateAtlasCohesionPairIdentity } = await loadDesignIQ();

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const CANONICAL_EDGE_IDENTITY = Object.freeze({
  contract: "designpro.atlas-design-teaching-pair.v1",
  purpose: "flat-to-installed-relationship-only",
  version: 1,
  flattenedTopViewContentHash: "20085eb547251d46c8113014108b088e35a4d41e2ce77b9a152b2786e79c37fa",
  flattenedTopViewByteSize: 619255,
  finished3dProofContentHash: "4449c3274f7d5cd9c383c49a81b0407f99ae0251b8052cad1ee3927c41ac1fdc",
  finished3dProofByteSize: 169595,
});

test("the owner-selected Flamingo relationship pair is release-pinned and historically identified", () => {
  const pair = examples.loadBundledAtlasCohesionExample();
  assert.equal(pair.identity.contract, "designpro.atlas-design-teaching-pair.v1");
  assert.equal(pair.identity.purpose, "flat-to-installed-relationship-only");
  assert.equal(pair.identity.historicalGenerationId, "5b2eb96c-77b5-4705-8cad-fef00af677fe");
  assert.equal(pair.identity.historicalRevisionId, "b1941528-e375-4d93-bef7-2fd48213370a");
  assert.equal(pair.identity.historicalVehicle, "2022 Ford F-250 Crew Cab");
  assert.equal(pair.identity.historicalProofLineageFields,
    "legacy-null; owner-approved matching generation export");
  assert.equal(pair.identity.outputRule, "six-solid-full-bleed-print-art-rectangles");
  assert.equal(pair.flattenedTopView.bytes.length, 619255);
  assert.equal(pair.finished3dProof.bytes.length, 169595);
  assert.equal(sha256(pair.flattenedTopView.bytes),
    "20085eb547251d46c8113014108b088e35a4d41e2ce77b9a152b2786e79c37fa");
  assert.equal(sha256(pair.finished3dProof.bytes),
    "4449c3274f7d5cd9c383c49a81b0407f99ae0251b8052cad1ee3927c41ac1fdc");
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

test("Call 1 keeps the teaching pair outside customer-reference authority and hashes it into reuse", () => {
  assert.match(runtime, /loadBundledAtlasCohesionExample/);
  assert.match(runtime, /atlasDesignTeachingPair: cohesionExample\.identity/);
  assert.match(runtime, /cohesionExampleIdentity: cohesionExample\.identity/);
  assert.match(runtime, /atlasDesignTeachingPairApplied: true/);
  assert.match(runtime, /topologyExamplesApplied: 0/);
  assert.doesNotMatch(runtime, /referenceImagesBase64:[^\n]*cohesionExample/);
  assert.doesNotMatch(runtime, /loadBundledFlatToFinishedExample/,
    "the historical Houdini pair must remain dormant");
});

test("edge verifies both teaching bytes and leaves the current target guide as the final image", () => {
  assert.match(edge, /ATLAS_COHESION_PAIR_CONTRACT = "designpro\.atlas-design-teaching-pair\.v1"/);
  assert.match(edge, /atlas_artboard_input_hash_mismatch/);
  assert.match(edge, /atlas_artboard_input_size_mismatch/);
  assert.match(edge, /ATLAS_COHESION_PAIR_MAX_BYTES/);
  assert.match(edge, /modelRequestByteSize > ATLAS_ARTBOARD_MODEL_REQUEST_MAX_BYTES/);

  const proof = edge.indexOf("RELATIONSHIP-ONLY EXAMPLE 1/2");
  const flat = edge.indexOf("RELATIONSHIP-ONLY EXAMPLE 2/2");
  const customer = edge.indexOf("for (const ref of references) pushImage(ref)", flat);
  const corrective = edge.indexOf("body.correctiveNote", customer);
  const target = edge.indexOf("CURRENT TARGET GUIDE", corrective);
  const guide = edge.indexOf("await downloadPart(body.guideStoragePath", target);
  assert.ok(proof > 0 && proof < flat && flat < customer && customer < corrective
    && corrective < target && target < guide);
  assert.match(edge, /cohesionExampleIdentity: verifiedCohesionPair/);
  assert.match(edge, /modelInputImageCount/);
});

test("edge independently pins the exact release teaching identity", () => {
  assert.equal(validateAtlasCohesionPairIdentity(CANONICAL_EDGE_IDENTITY), CANONICAL_EDGE_IDENTITY);
  assert.throws(
    () => validateAtlasCohesionPairIdentity(null),
    /atlas_artboard_cohesion_pair_identity_invalid/,
  );
  for (const [field, substituted] of [
    ["contract", "designpro.atlas-design-teaching-pair.v0"],
    ["purpose", "style-authority"],
    ["version", 2],
    ["flattenedTopViewContentHash", "f".repeat(64)],
    ["flattenedTopViewByteSize", 619254],
    ["finished3dProofContentHash", "e".repeat(64)],
    ["finished3dProofByteSize", 169594],
  ]) {
    assert.throws(
      () => validateAtlasCohesionPairIdentity({ ...CANONICAL_EDGE_IDENTITY, [field]: substituted }),
      /atlas_artboard_cohesion_pair_identity_invalid/,
      `${field} cannot be caller-substituted`,
    );
  }
  for (const literal of [
    CANONICAL_EDGE_IDENTITY.contract,
    CANONICAL_EDGE_IDENTITY.purpose,
    String(CANONICAL_EDGE_IDENTITY.version),
    CANONICAL_EDGE_IDENTITY.flattenedTopViewContentHash,
    String(CANONICAL_EDGE_IDENTITY.flattenedTopViewByteSize),
    CANONICAL_EDGE_IDENTITY.finished3dProofContentHash,
    String(CANONICAL_EDGE_IDENTITY.finished3dProofByteSize),
  ]) {
    assert.ok(edge.includes(literal), `edge must contain exact pair identity ${literal}`);
  }
});

test("atlas-artboard is internal-only and requires the complete pair without changing normal modes", () => {
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
  assert.match(handler, /if \(!cohesionProofPath \|\| !cohesionFlatPath\)/);
  assert.match(handler, /atlas_artboard_cohesion_pair_incomplete/);
  assert.match(handler, /validateAtlasCohesionPairIdentity\(body\.cohesionExampleIdentity\)/);
});

test("canonical input order is prompt, installed, flat, customer, correction, target guide", () => {
  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  const prompt = handler.indexOf("[{ text: prompt }]");
  const installed = handler.indexOf("RELATIONSHIP-ONLY EXAMPLE 1/2", prompt);
  const flat = handler.indexOf("RELATIONSHIP-ONLY EXAMPLE 2/2", installed);
  const customer = handler.indexOf("for (const ref of references) pushImage(ref)", flat);
  const corrective = handler.indexOf("body.correctiveNote", customer);
  const target = handler.indexOf("CURRENT TARGET GUIDE", corrective);
  const guide = handler.indexOf("await downloadPart(body.guideStoragePath", target);
  assert.ok(prompt >= 0 && prompt < installed && installed < flat && flat < customer
    && customer < corrective && corrective < target && target < guide);
  assert.doesNotMatch(runtime, /guideImageBase64:/,
    "the production runtime must leave the downloaded target guide as the final model image");
});
