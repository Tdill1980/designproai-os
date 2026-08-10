import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const region = require("../../runtime/proof-region-extract.cjs");
const claimant = require("../../runtime/designpro-standalone-claimant.cjs");
const claimantSource = readFileSync(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
const regionSource = readFileSync(new URL("../../runtime/proof-region-extract.cjs", import.meta.url), "utf8");

const ownerId = "12345678-1234-4123-8123-123456789abc";
const tenantKey = `user_${ownerId}`;
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];
// Driver and passenger share geometry, exactly as a real vehicle does, so a
// repeated driver flank cannot hide behind a different aspect ratio.
const GEOMETRY = {
  driver: { widthInches: 0.6, heightInches: 0.2 },
  passenger: { widthInches: 0.6, heightInches: 0.2 },
  hood: { widthInches: 0.4, heightInches: 0.25 },
  roof: { widthInches: 0.5, heightInches: 0.3 },
  front: { widthInches: 0.3, heightInches: 0.15 },
  rear: { widthInches: 0.35, heightInches: 0.18 },
};

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function artworkRaw(seed, width, height) {
  const raw = Buffer.alloc(width * height * 3);
  const blockX = 40 + (seed % 3) * 90;
  const blockY = 30 + Math.floor(seed / 3) * 80;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      const inBlock = x >= blockX && x < blockX + 70 && y >= blockY && y < blockY + 60;
      raw[index] = inBlock ? 250 - seed * 20 : Math.floor((x / width) * 200) + seed * 8;
      raw[index + 1] = inBlock ? 20 + seed * 30 : Math.floor((y / height) * 200);
      raw[index + 2] = inBlock ? 200 : 40 + seed * 30;
    }
  }
  return raw;
}

async function artworkPng(seed, width = 420, height = 300) {
  return sharp(artworkRaw(seed, width, height), { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** The driver artwork again, a few tones apart: a new hash, the same design. */
async function repaintedDriverPng(width = 420, height = 300) {
  const raw = artworkRaw(0, width, height);
  for (let y = height / 2 - 2; y < height / 2 + 3; y += 1) {
    for (let x = width / 2 - 2; x < width / 2 + 3; x += 1) {
      const index = (y * width + x) * 3;
      raw[index] = Math.min(255, raw[index] + 3);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function buildProofFixture({ repaintDriverOntoPassenger = false, dropTile = null } = {}) {
  const objects = new Map();
  const masters = [];
  const tiles = [];
  const expected = new Map();
  const layers = [];
  let cursor = 10;
  for (const [index, key] of SURFACES.entries()) {
    const { widthInches, heightInches } = GEOMETRY[key];
    const flatBytes = repaintDriverOntoPassenger && key === "passenger" ? await repaintedDriverPng() : await artworkPng(index);
    const flatMetadata = await sharp(flatBytes).metadata();
    const named = region.namedRegionRect({
      sourceWidth: flatMetadata.width, sourceHeight: flatMetadata.height,
      trimWidthIn: widthInches, trimHeightIn: heightInches, bleedIn: 5, pixelsPerInch: region.PIXELS_PER_INCH,
    });
    const masterBytes = await region.extractNamedRegion(flatBytes, named);
    const previewWidth = 200;
    const previewHeight = Math.max(1, Math.round(previewWidth * named.targetHeight / named.targetWidth));
    const previewRect = { left: 10, top: cursor, width: previewWidth, height: previewHeight };
    cursor += previewHeight + 10;
    layers.push({ input: await sharp(masterBytes).resize(previewWidth, previewHeight, { fit: "fill", kernel: "lanczos3" }).png().toBuffer(), left: previewRect.left, top: previewRect.top });
    const flatSourcePath = `designpro/${tenantKey}/${runId}/proof-masters/raw/${key}-fixture.png`;
    const masterPath = `designpro/${tenantKey}/${runId}/proof-masters/${key}-fixture.png`;
    objects.set(flatSourcePath, flatBytes);
    objects.set(masterPath, masterBytes);
    tiles.push({
      contract: region.PROOF_TILE_CONTRACT, tileKey: key,
      flatSourcePath, flatSourceSha256: sha(flatBytes),
      flatSourceWidth: flatMetadata.width, flatSourceHeight: flatMetadata.height,
      masterPath, masterSha256: sha(masterBytes),
      ownSourceViewKey: key, ownSourceViewSha256: sha(Buffer.from(`view-${key}`)),
      region: named, trimRect: region.trimRectangle({ trimWidthIn: widthInches, trimHeightIn: heightInches, bleedIn: 5, pixelsPerInch: region.PIXELS_PER_INCH }),
      pixelsPerInch: region.PIXELS_PER_INCH, trimWidthIn: widthInches, trimHeightIn: heightInches, bleedIn: 5,
      fingerprint: await region.surfaceFingerprint(masterBytes),
      mirrorFingerprint: await region.mirroredSurfaceFingerprint(masterBytes),
      previewRect, previewSha256: null,
    });
    masters.push({ key, masterPath, sha256: sha(masterBytes), pixelWidth: named.targetWidth, pixelHeight: named.targetHeight });
    expected.set(key, { surfaceKey: key, widthInches, heightInches, surfaceSqFt: round2(widthInches * heightInches / 144), bleed: { top: 5, right: 5, bottom: 5, left: 5 } });
  }
  const proofBytes = await sharp({ create: { width: 240, height: cursor + 10, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).composite(layers).png().toBuffer();
  for (const [index, tile] of tiles.entries()) {
    const displayed = await sharp(proofBytes).extract(tile.previewRect).png().toBuffer();
    tile.previewSha256 = sha(displayed);
    masters[index].regionSha256 = tile.previewSha256;
  }
  const proofSha256 = sha(proofBytes);
  const proofRegionMap = {
    contract: region.PROOF_REGION_MAP_CONTRACT, pixelsPerInch: region.PIXELS_PER_INCH,
    flatMaterialHash: sha(Buffer.from("fixture-material")), proofWidth: 240, proofHeight: cursor + 10,
    proofSha256, tiles: dropTile ? tiles.filter((tile) => tile.tileKey !== dropTile) : tiles,
  };
  const proofPath = `designpro/${tenantKey}/${runId}/call8-flat-2d-proof.png`;
  objects.set(proofPath, proofBytes);
  const uploads = [];
  const sb = {
    storage: {
      from(bucket) {
        assert.equal(bucket, "wrap-files");
        return {
          async download(path) {
            const body = objects.get(path);
            return body ? { data: new Blob([body]), error: null } : { data: null, error: { message: "not found", statusCode: "404" } };
          },
          async upload(path, body) {
            uploads.push({ path, byteSize: body.length, contentHash: sha(body) });
            if (objects.has(path)) return { error: { error: "Duplicate", statusCode: "409" } };
            objects.set(path, Buffer.from(body));
            return { error: null };
          },
        };
      },
    },
  };
  return {
    sb, objects, uploads, masters, expected, tiles, proofBytes, proofSha256, proofRegionMap,
    proofOutput: { storagePath: proofPath, sourceProofHash: proofSha256, surfaceMasters: masters, proofRegionMap },
    frozenProof: { storagePath: proofPath, contentHash: proofSha256, bytes: proofBytes },
    run: { id: runId, tenant_key: tenantKey, revision_id: revisionId },
    stage: { id: runId, lease_token: revisionId, lease_owner: "test-worker" },
    runtimeConfig: { supabaseUrl: "https://example.test", serviceRoleKey: "key", spoolDir: "/tmp/none", tusEndpoint: "" },
  };
}

test("a named region is the exact centred trim-plus-bleed rectangle, with no invented padding", () => {
  const named = region.namedRegionRect({ sourceWidth: 4096, sourceHeight: 2160, trimWidthIn: 163, trimHeightIn: 56, bleedIn: 5, pixelsPerInch: 150 });
  assert.equal(named.targetWidth, Math.round((163 + 10) * 150));
  assert.equal(named.targetHeight, Math.round((56 + 10) * 150));
  assert.ok(named.left >= 0 && named.top >= 0);
  assert.ok(named.left + named.width <= 4096 && named.top + named.height <= 2160);
  assert.equal(named.left, Math.floor((4096 - named.width) / 2));
  assert.ok(named.aspectDriftPpm < 2000, `aspect drift ${named.aspectDriftPpm}`);
  assert.equal(named.fit, "exact-named-region-no-padding");
  assert.throws(() => region.namedRegionRect({ sourceWidth: 4096, sourceHeight: 2160, trimWidthIn: 163, trimHeightIn: 56, bleedIn: 3 }), /5 inches of bleed/);
});

test("the same frozen source and region always produce the same panel bytes", async () => {
  const flat = await artworkPng(3);
  const named = region.namedRegionRect({ sourceWidth: 420, sourceHeight: 300, trimWidthIn: 0.6, trimHeightIn: 0.2, bleedIn: 5 });
  const first = await region.extractNamedRegion(flat, named);
  const second = await region.extractNamedRegion(flat, named);
  assert.equal(sha(first), sha(second));
  const metadata = await sharp(first).metadata();
  assert.equal(metadata.width, named.targetWidth);
  assert.equal(metadata.height, named.targetHeight);
  await assert.rejects(region.extractNamedRegion(await artworkPng(3, 400, 300), named), /geometry/);
});

test("a repainted driver flank is caught even though its bytes are unique", async () => {
  const driver = await artworkPng(0);
  const repainted = await repaintedDriverPng();
  assert.notEqual(sha(driver), sha(repainted), "the fixture must differ byte for byte");
  const surfaces = [
    { surfaceKey: "driver", fingerprint: await region.surfaceFingerprint(driver), mirrorFingerprint: await region.mirroredSurfaceFingerprint(driver) },
    { surfaceKey: "passenger", fingerprint: await region.surfaceFingerprint(repainted), mirrorFingerprint: await region.mirroredSurfaceFingerprint(repainted) },
  ];
  assert.throws(() => region.assertDistinctSurfaces(surfaces), (error) => error.code === "call9_driver_passenger_visual_reuse");
  const mirroredBytes = await sharp(driver).flop().png().toBuffer();
  const mirroredSurface = {
    surfaceKey: "passenger",
    fingerprint: await region.surfaceFingerprint(mirroredBytes),
    mirrorFingerprint: await region.mirroredSurfaceFingerprint(mirroredBytes),
  };
  assert.throws(() => region.assertDistinctSurfaces([surfaces[0], mirroredSurface]), /mirror/);
  const hoodBytes = await artworkPng(4);
  const distinct = [
    surfaces[0],
    { surfaceKey: "hood", fingerprint: await region.surfaceFingerprint(hoodBytes), mirrorFingerprint: await region.mirroredSurfaceFingerprint(hoodBytes) },
  ];
  assert.equal(region.assertDistinctSurfaces(distinct).verified, true);
});

test("Call 9 crops six panels out of the frozen Call 8 proof with no image model", async () => {
  const fixture = await buildProofFixture();
  const map = region.assertProofRegionMap(fixture.proofRegionMap, SURFACES);
  const built = await claimant._test.extractSurfacePanels(fixture.sb, fixture.run, fixture.stage, fixture.runtimeConfig, {
    proof: fixture.proofOutput, regionMap: map, frozenProof: fixture.frozenProof, masters: fixture.masters, expected: fixture.expected,
  });
  assert.equal(built.produced.length, 6);
  assert.deepEqual(built.produced.map((item) => item.surfaceKey).sort(), [...SURFACES].sort());
  assert.equal(new Set(built.produced.map((item) => item.contentHash)).size, 6);
  for (const panel of built.produced) {
    const tile = map.byKey.get(panel.surfaceKey);
    assert.equal(panel.storagePath, `designpro/${tenantKey}/${runId}/panels/${panel.surfaceKey}.png`);
    assert.equal(panel.contentHash, tile.masterSha256, "the panel is the accepted Call 8 region, byte for byte");
    assert.equal(panel.metadata.sourceRule, claimant.CALL9_SOURCE_RULE);
    assert.equal(panel.metadata.imageModelUsed, false);
    assert.equal(panel.metadata.sourceRegionHash, tile.previewSha256);
    assert.equal(panel.metadata.ownSourceViewKey, panel.surfaceKey);
    assert.deepEqual(panel.metadata.bleed, { top: 5, right: 5, bottom: 5, left: 5 });
    assert.equal(panel.metadata.trimWidthInches, GEOMETRY[panel.surfaceKey].widthInches);
    const stored = await sharp(fixture.objects.get(panel.storagePath)).metadata();
    assert.equal(stored.width, Math.round((GEOMETRY[panel.surfaceKey].widthInches + 10) * 150));
    assert.equal(stored.height, Math.round((GEOMETRY[panel.surfaceKey].heightInches + 10) * 150));
  }
  assert.equal(built.uniqueness.verified, true);
  // Re-running the stage reproduces the identical bytes at the identical paths.
  const again = await claimant._test.extractSurfacePanels(fixture.sb, fixture.run, fixture.stage, fixture.runtimeConfig, {
    proof: fixture.proofOutput, regionMap: map, frozenProof: fixture.frozenProof, masters: fixture.masters, expected: fixture.expected,
  });
  assert.deepEqual(again.produced.map((item) => item.contentHash), built.produced.map((item) => item.contentHash));
});

test("Call 9 fails closed when the frozen proof cannot name a surface", async () => {
  const fixture = await buildProofFixture({ dropTile: "passenger" });
  assert.throws(() => region.assertProofRegionMap(fixture.proofRegionMap, SURFACES), (error) => error.code === "call9_proof_region_map_missing");
  const partial = { contract: region.PROOF_REGION_MAP_CONTRACT, pixelsPerInch: region.PIXELS_PER_INCH, flatMaterialHash: fixture.proofRegionMap.flatMaterialHash, proofSha256: fixture.proofSha256, tiles: fixture.proofRegionMap.tiles, byKey: new Map(fixture.proofRegionMap.tiles.map((tile) => [tile.tileKey, tile])) };
  await assert.rejects(
    claimant._test.extractSurfacePanels(fixture.sb, fixture.run, fixture.stage, fixture.runtimeConfig, {
      proof: fixture.proofOutput, regionMap: partial, frozenProof: fixture.frozenProof, masters: fixture.masters, expected: fixture.expected,
    }),
    (error) => error.code === "call9_proof_reference_missing",
  );
});

test("Call 9 refuses a proof whose passenger region is a repainted driver flank", async () => {
  const fixture = await buildProofFixture({ repaintDriverOntoPassenger: true });
  const driver = fixture.tiles.find((tile) => tile.tileKey === "driver");
  const passenger = fixture.tiles.find((tile) => tile.tileKey === "passenger");
  assert.notEqual(driver.masterSha256, passenger.masterSha256, "byte hashes cannot see this failure");
  assert.throws(() => region.assertProofRegionMap(fixture.proofRegionMap, SURFACES), (error) => error.code === "call9_driver_passenger_visual_reuse");
});

test("Call 9 refuses a frozen source that changed after Call 8", async () => {
  const fixture = await buildProofFixture();
  const map = region.assertProofRegionMap(fixture.proofRegionMap, SURFACES);
  fixture.objects.set(map.byKey.get("hood").flatSourcePath, await artworkPng(9));
  await assert.rejects(
    claimant._test.extractSurfacePanels(fixture.sb, fixture.run, fixture.stage, fixture.runtimeConfig, {
      proof: fixture.proofOutput, regionMap: map, frozenProof: fixture.frozenProof, masters: fixture.masters, expected: fixture.expected,
    }),
    (error) => error.code === "call9_proof_source_changed",
  );
});

test("the frozen proof sheet itself is byte-verified before any crop", async () => {
  const fixture = await buildProofFixture();
  const map = region.assertProofRegionMap(fixture.proofRegionMap, SURFACES);
  const frozen = await claimant._test.frozenProofSheet(fixture.sb, runId, fixture.proofOutput, map);
  assert.equal(frozen.contentHash, fixture.proofSha256);
  fixture.objects.set(fixture.proofOutput.storagePath, await artworkPng(11));
  await assert.rejects(claimant._test.frozenProofSheet(fixture.sb, runId, fixture.proofOutput, map), (error) => error.code === "call9_proof_changed");
});

test("the deterministic panel path carries no image model and matches the database receipt contract", () => {
  assert.doesNotMatch(regionSource, /fetch\(|generativelanguage|generateContent|https:\/\//);
  const call9Path = claimantSource.slice(
    claimantSource.indexOf("async function extractSurfacePanels"),
    claimantSource.indexOf("async function executeEntice"),
  );
  assert.ok(call9Path.length > 500, "the Call 9 extraction path must be present");
  assert.doesNotMatch(call9Path, /callTool|authorFlatSurfaceMasters|compose-proof-sheet|gemini/i);
  assert.match(call9Path, /RUNG 0 — use the deterministic named crop from the frozen 2D proof\./);
  assert.match(call9Path, /No image model may repaint production pixels on this path\./);
  assert.match(call9Path, /const directReference = await getProofReference\(sb, regionMap, key\);/);
  // complete_designpro_stage rejects any other sourceRule for panels.build.
  assert.equal(claimant.CALL9_SOURCE_RULE, "one-own-surface-region-per-output-side");
  assert.match(claimantSource, /sourceRegionHashes = Object\.fromEntries/);
  assert.match(claimantSource, /const regionHashes = call9\.sourceRegionHashes \|\| \{\};/);
});
