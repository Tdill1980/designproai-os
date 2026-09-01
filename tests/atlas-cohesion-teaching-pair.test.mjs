// THE MANDATORY OWNER-APPROVED LABELED FLAMINGO A.T.L.A.S. TEACHING PROOF
// (A.T.L.A.S. AI/OS Boundary Contract, owner-approved 2026-09-01).
//
// These locks supersede the 2026-08-31 "repaired flat cohesion example"
// contract by the owner's explicit decision: Call 1 receives the LABELED
// Flamingo teaching proof — exact owner bytes, never recreated, repaired,
// cropped, relabeled or re-encoded — plus the GENIE-derived normalized [0,1]
// mathematical topology, and NO blank neutral target-guide image and NO
// corrective-note text. The labels establish panel identity only; the
// topology is the sole target-vehicle geometry/proportion authority.
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
const { validateAtlasTeachingProofIdentity } = await loadDesignIQ();

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const CANONICAL_EDGE_IDENTITY = Object.freeze({
  contract: "designpro.atlas-labeled-teaching-proof.v3",
  purpose: "atlas-object-model-and-panel-identity",
  version: 3,
  flattenedTopViewContentHash: "684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded",
  flattenedTopViewByteSize: 3430273,
});

test("the owner-approved labeled Flamingo teaching proof is release-pinned, byte-exact and historically identified", () => {
  const proof = examples.loadBundledAtlasTeachingProof();
  assert.equal(proof.identity.contract, "designpro.atlas-labeled-teaching-proof.v3");
  assert.equal(proof.identity.purpose, "atlas-object-model-and-panel-identity");
  assert.equal(proof.identity.labelRule, "labels-are-instructional-annotations-only-never-artwork");
  assert.equal(proof.identity.historicalGenerationId, "5b2eb96c-77b5-4705-8cad-fef00af677fe");
  assert.equal(proof.identity.historicalRevisionId, "b1941528-e375-4d93-bef7-2fd48213370a");
  assert.equal(proof.identity.historicalVehicle, "2022 Ford F-250 Crew Cab");
  assert.equal(proof.identity.outputRule, "six-solid-full-bleed-print-art-rectangles");
  assert.equal(proof.flattenedTopView.bytes.length, 3430273);
  assert.equal(Object.hasOwn(proof, "finished3dProof"), false);
  assert.equal(sha256(proof.flattenedTopView.bytes),
    "684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded");
});

test("the teaching proof decodes as the exact 1254x1254 owner canvas", async () => {
  const proof = examples.loadBundledAtlasTeachingProof();
  const info = await sharp(proof.flattenedTopView.bytes).metadata();
  assert.equal(info.width, 1254);
  assert.equal(info.height, 1254);
  assert.equal(info.format, "png");
});

test("Call 1 keeps the teaching proof outside customer-reference authority and hashes it into reuse", () => {
  assert.match(runtime, /loadBundledAtlasTeachingProof/);
  assert.match(runtime, /atlasDesignTeachingExample: teachingProof\.identity/);
  assert.match(runtime, /teachingProofIdentity: teachingProof\.identity/);
  assert.match(runtime, /atlasDesignTeachingExampleApplied: true/);
  assert.match(runtime, /topologyExamplesApplied: 0/);
  assert.doesNotMatch(runtime, /referenceImagesBase64:[^\n]*teachingProof/);
  assert.doesNotMatch(runtime, /loadBundledFlatToFinishedExample/,
    "the historical Houdini pair must remain dormant");
  assert.doesNotMatch(runtime, /loadBundledAtlasCohesionExample/,
    "the superseded unlabeled cohesion example must not reach Call 1");
});

test("edge verifies the teaching bytes and sends no blank target guide and no corrective note", () => {
  assert.match(edge, /ATLAS_TEACHING_PROOF_CONTRACT = "designpro\.atlas-labeled-teaching-proof\.v3"/);
  assert.match(edge, /atlas_artboard_input_hash_mismatch/);
  assert.match(edge, /atlas_artboard_input_size_mismatch/);
  assert.match(edge, /ATLAS_TEACHING_PROOF_MAX_BYTES/);
  assert.match(edge, /modelRequestByteSize > ATLAS_ARTBOARD_MODEL_REQUEST_MAX_BYTES/);

  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  const promptPart = handler.indexOf("[{ text: prompt }]");
  const topology = handler.indexOf("atlasTopologyText(panels", promptPart);
  const teaching = handler.indexOf("This image is the visual definition of A.T.L.A.S.", topology);
  const customer = handler.indexOf("for (const ref of references) pushImage(ref)", teaching);
  assert.ok(promptPart > 0 && promptPart < topology && topology < teaching && teaching < customer,
    "input order is prompt, normalized topology, teaching proof, customer references");
  assert.match(edge, /teachingProofIdentity: verifiedTeachingProof/);
  assert.doesNotMatch(handler, /CURRENT TARGET GUIDE|guideStoragePath|guideImageBase64|correctiveNote/);
  assert.doesNotMatch(edge, /cohesionExampleProofStoragePath|ATLAS_COHESION_PROOF_HASH|INSTALLED DRIVER PROOF/);
  assert.match(edge, /modelInputImageCount/);
});

test("edge independently pins the exact owner teaching identity", () => {
  assert.equal(validateAtlasTeachingProofIdentity(CANONICAL_EDGE_IDENTITY), CANONICAL_EDGE_IDENTITY);
  assert.throws(
    () => validateAtlasTeachingProofIdentity(null),
    /atlas_artboard_teaching_proof_identity_invalid/,
  );
  for (const [field, substituted] of [
    ["contract", "designpro.atlas-design-teaching-example.v2"],
    ["purpose", "style-authority"],
    ["version", 2],
    ["flattenedTopViewContentHash", "f".repeat(64)],
    ["flattenedTopViewByteSize", 3430272],
  ]) {
    assert.throws(
      () => validateAtlasTeachingProofIdentity({ ...CANONICAL_EDGE_IDENTITY, [field]: substituted }),
      /atlas_artboard_teaching_proof_identity_invalid/,
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
    assert.ok(edge.includes(literal), `edge must contain exact teaching identity ${literal}`);
  }
});

test("atlas-artboard is internal-only and requires the teaching proof without changing normal modes", () => {
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
  assert.match(handler, /if \(!teachingProofPath\)/);
  assert.match(handler, /atlas_artboard_teaching_proof_incomplete/);
  assert.match(handler, /validateAtlasTeachingProofIdentity\(body\.teachingProofIdentity\)/);
});

test("the normalized [0,1] topology is mandatory, six-region, four-decimal and value-checked", () => {
  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  assert.match(handler, /atlas_artboard_topology_required/);
  assert.match(edge, /atlas_artboard_topology_invalid/);
  assert.match(edge, /surface \| x \| y \| width \| height \| orientation/);
  assert.match(edge, /Passenger and Driver are the two sides of the SAME vehicle and must clearly carry the SAME design system/);
  assert.match(edge, /Create ONE CONNECTED WRAP UNWRAPPED FLAT across the complete A\.T\.L\.A\.S\. topology/);
  // Runtime side: pure arithmetic on the OS-owned manifest, refused outside [0,1].
  assert.match(runtime, /function normalizedZoneTopology\(zone, manifest\)/);
  assert.match(runtime, /flat_atlas_topology_zone_invalid/);
  assert.match(runtime, /toFixed\(4\)/);
});

test("every bundled atlas-examples asset ships in the release tree", () => {
  // Canary run 33459887409 (2026-09-01): the droplet release omitted the
  // teaching proof because ops/release-files.txt never listed it, and every
  // generation died at flat_atlas_bundled_example_missing before any creative
  // work. The bundled-example module and the release manifest must name the
  // same files, exactly.
  const releaseFiles = readFileSync(new URL("../ops/release-files.txt", import.meta.url), "utf8");
  const exampleSource = readFileSync(new URL("../runtime/flat-atlas-topology-examples.cjs", import.meta.url), "utf8");
  const bundled = [...exampleSource.matchAll(/join\(__dirname, "atlas-examples", "([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(bundled.includes("flamingo-labeled-atlas-teaching-proof.png"),
    "the mandatory teaching proof must be a bundled example");
  for (const file of bundled) {
    assert.ok(releaseFiles.includes(`runtime/atlas-examples/${file}`),
      `ops/release-files.txt must ship runtime/atlas-examples/${file}`);
  }
});

test("temperature 1.0 and gemini-3-pro-image at 1:1 4K are pinned for Call 1", () => {
  assert.match(edge, /ATLAS_ARTBOARD_AUTHORING_MODEL = "gemini-3-pro-image"/);
  assert.match(edge, /ATLAS_ARTBOARD_TEMPERATURE = 1\.0/);
  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  assert.match(handler, /temperature: ATLAS_ARTBOARD_TEMPERATURE/);
  assert.match(handler, /aspectRatio: "1:1", imageSize: "4K"/);
  assert.doesNotMatch(handler, /negative_prompt/);
});
