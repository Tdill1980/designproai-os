import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const atlas = require("../../runtime/flat-first-atlas.cjs");
const worker = require("../../runtime/generation-worker.cjs");
const runtimeRequire = createRequire(new URL("../../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");

const REQUEST = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const TENANT = `user_${OWNER}`;

const surfaces = [
  ["driver", 190, 66],
  ["passenger", 190, 66],
  ["hood", 68, 62],
  ["roof", 76, 96],
  ["front", 84, 34],
  ["rear", 82, 48],
].map(([surfaceKey, widthInches, heightInches]) => ({
  surfaceKey,
  widthInches,
  heightInches,
  bleed: { top: 5, right: 5, bottom: 5, left: 5 },
}));

const v3Input = {
  contractVersion: atlas.INPUT_CONTRACT,
  pipelineMode: atlas.PIPELINE_MODE,
  brief: "Premium desert-pool commercial wrap with flowing water graphics",
  designName: "Flamingo Pools",
  businessName: "Flamingo Pools",
  colors: ["#0ea5e9", "#f97316"],
  vehicle: { year: "2024", make: "Ford", model: "F-250", type: "truck" },
};

const provisionalAuthority = {
  contract: atlas.GEOMETRY_AUTHORITY_CONTRACT,
  status: "provisional",
  purpose: "calls-1-7-layout-only",
  candidateId: "55555555-5555-4555-8555-555555555555",
  candidateHash: "b".repeat(64),
  source: "gemini_grounded",
  sourceUrls: ["https://www.ford.com/support/vehicle-specifications"],
  confidence: "high",
  estimatorContract: "designpro.genie-provisional-atlas-geometry.v1",
  operatorValidated: false,
  validatedBy: null,
  validatedAt: null,
  productionEligible: false,
};

test("flat-first mode requires one exact v3 contract pair and leaves legacy inputs alone", () => {
  assert.equal(atlas.flatFirstRequested(v3Input), true);
  assert.equal(atlas.flatFirstRequested({ contractVersion: "designpro.calls-1-7-input.v2" }), false);
  assert.throws(() => atlas.flatFirstRequested({ contractVersion: atlas.INPUT_CONTRACT }), /requires contractVersion/);
  assert.throws(() => atlas.flatFirstRequested({ pipelineMode: atlas.PIPELINE_MODE }), /requires contractVersion/);
});

test("installer-map topology is fixed: passenger left, driver right, rear-to-front centre", () => {
  const manifest = atlas.buildAtlasManifest(surfaces);
  const byKey = new Map(manifest.zones.map((zone) => [zone.surfaceKey, zone]));

  assert.equal(manifest.topology, "rectangular-preview-v1");
  assert.equal(manifest.productionEligible, false);
  assert.equal(manifest.sourceAuthority.visualProofsUsedForGeometry, false);
  assert.equal(manifest.sourceAuthority.examplePurpose, "topology-only");
  assert.equal(manifest.seamContinuity.exactPvoSeamMappingsAvailable, false);
  assert.ok(manifest.seamContinuity.relationships.some((item) => item.surfaces.join("/") === "hood/driver"));
  assert.deepEqual(manifest.installerMap.centerOrderTopToBottom, ["rear", "roof", "hood", "front"]);

  assert.equal(byKey.get("passenger").placement, "left-flank");
  assert.equal(byKey.get("passenger").rotationDegrees, 90);
  assert.equal(byKey.get("driver").placement, "right-flank");
  assert.equal(byKey.get("driver").rotationDegrees, -90);
  assert.ok(byKey.get("passenger").x < byKey.get("roof").x);
  assert.ok(byKey.get("driver").x > byKey.get("roof").x);

  const centre = ["rear", "roof", "hood", "front"].map((key) => byKey.get(key));
  assert.ok(centre.every((zone, index) => index === 0 || zone.y > centre[index - 1].y));
  assert.ok(manifest.zones.every((zone) => zone.x >= 0 && zone.y >= 0
    && zone.x + zone.w <= manifest.canvas.widthPx && zone.y + zone.h <= manifest.canvas.heightPx));
  assert.ok(manifest.zones.every((zone) => zone.bleedIn.top === 5 && zone.extraction.outputRotationDegrees === -zone.rotationDegrees));
});

test("atlas geometry is derived only from GENIE rectangles, never a proof image", () => {
  const baseline = atlas.buildAtlasManifest(surfaces);
  const noisy = atlas.buildAtlasManifest([...surfaces].reverse().map((surface) => ({
    ...surface,
    sourceView: "data:image/png;base64,this-must-not-be-read",
    cameraGuess: { x: 999999, y: -123 },
  })));
  assert.deepEqual(noisy, baseline, "surface order and extraneous render data cannot move one atlas pixel");
  assert.equal(noisy.sourceAuthority.geometry, "validated-genie-six-surface-manifest-only");
});

test("provisional Google-grounded geometry is truthfully immutable and remains proof-only", () => {
  const manifest = atlas.buildAtlasManifest(surfaces, provisionalAuthority);
  assert.equal(manifest.geometryAuthority.status, "provisional");
  assert.equal(manifest.geometryAuthority.operatorValidated, false);
  assert.equal(manifest.geometryAuthority.productionEligible, false);
  assert.equal(manifest.sourceAuthority.geometry, "provisional-google-grounded-layout-only");
  assert.match(manifest.productionBlockers.join(" "), /operator-validated exact six-surface geometry/i);
  assert.equal(manifest.productionEligible, false);
  const prompt = atlas._test.atlasPrompt(v3Input, manifest);
  assert.match(prompt, /Google-grounded.*PROVISIONAL proof-layout rectangles/i);
  assert.match(prompt, /never authorization for print production/i);
});

test("a duplicate-insert race cannot reuse an atlas from a stale geometry basis", () => {
  const expected = "a".repeat(64);
  const raced = { manifestAsset: { contentHash: "b".repeat(64) } };
  assert.throws(
    () => atlas._test.assertAtlasGeometryBasis(raced, expected),
    (error) => error.code === "flat_atlas_geometry_basis_changed" && error.retryable === false,
  );
  assert.equal(
    atlas._test.assertAtlasGeometryBasis({ manifestAsset: { contentHash: expected } }, expected).manifestAsset.contentHash,
    expected,
  );
});

test("4K atlas reports effective PPI honestly and cannot masquerade as print ready", () => {
  const manifest = atlas.buildAtlasManifest(surfaces);
  assert.ok(manifest.quality.minimumEffectivePpi > 0);
  assert.ok(manifest.quality.minimumEffectivePpi < manifest.quality.targetPrintPpi);
  assert.equal(manifest.quality.upscalingRequiredBeforeAnyProductionExport, true);
  assert.match(manifest.productionBlockers.join(" "), /PVO contour\/UV topology/);
  assert.match(manifest.productionBlockers.join(" "), /PPI/);
  assert.equal(manifest.proofOnlyViews.includes("hero-3d"), true);
  assert.equal(manifest.zones.some((zone) => zone.surfaceKey === "hero3d"), false);
});

test("topology examples are firewalled from customer style", () => {
  const prompt = atlas._test.atlasPrompt(v3Input, atlas.buildAtlasManifest(surfaces));
  assert.match(prompt, /TOPOLOGY\/LAYOUT references only/);
  assert.match(prompt, /IGNORE their palette, imagery, text, logos, brand and style/);
  assert.match(prompt, /customer's brief and verified customer-owned assets are the sole style source/i);
  assert.match(prompt, /passenger flank.*LEFT/i);
  assert.match(prompt, /driver flank.*RIGHT/i);
  assert.match(prompt, /REAR, ROOF, HOOD, FRONT/);
});

test("the deterministic guide is neutral monochrome, never a hidden style palette", () => {
  const manifest = atlas.buildAtlasManifest(surfaces);
  const svg = atlas._test.guideSvg(manifest).toString("utf8");
  const colors = [...svg.matchAll(/#[0-9a-f]{6}/gi)].map((match) => match[0].slice(1));
  assert.ok(colors.length > 0);
  for (const color of colors) {
    const [red, green, blue] = color.match(/../g).map((pair) => Number.parseInt(pair, 16));
    assert.equal(red, green, `guide color #${color} is not neutral`);
    assert.equal(green, blue, `guide color #${color} is not neutral`);
  }
  assert.equal(manifest.guideRendering.styleAuthority, false);
  assert.equal(new Set(manifest.zones.map((zone) => zone.guideFill)).size, 1,
    "surface identity must not be color-coded");
});

test("content-addressed before/after storage stays inside the isolated flat-first namespace", () => {
  const hash = "a".repeat(64);
  assert.equal(
    atlas.atlasStoragePath({ tenantKey: TENANT, generationId: GENERATION, kind: "guide", contentHash: hash }),
    `designpro/${TENANT}/${GENERATION}/flat-first/v1/guide/${hash}.png`,
  );
  assert.equal(
    atlas.atlasStoragePath({ tenantKey: TENANT, generationId: GENERATION, kind: "manifest", contentHash: hash }),
    `designpro/${TENANT}/${GENERATION}/flat-first/v1/manifest/${hash}.json`,
  );
  assert.equal(
    atlas.atlasStoragePath({ tenantKey: TENANT, generationId: GENERATION, revisionSequence: 3, kind: "master", contentHash: hash }),
    `designpro/${TENANT}/${GENERATION}/flat-first/v1/revisions/3/master/${hash}.png`,
  );
  assert.equal(
    atlas.atlasStoragePath({ tenantKey: TENANT, generationId: GENERATION, revisionSequence: 3, kind: "projection", contentHash: hash }),
    `designpro/${TENANT}/${GENERATION}/flat-first/v1/revisions/3/projection/${hash}.jpg`,
  );
});

test("all seven proof prompts carry the exact same atlas bytes and view dependencies", () => {
  const manifest = atlas.buildAtlasManifest(surfaces);
  const masterBytes = Buffer.from("one-canonical-atlas");
  const projectionBytes = Buffer.from("one-request-safe-projection");
  const masterHash = atlas._test.sha256(masterBytes);
  const flatAtlas = {
    contract: atlas.ATLAS_CONTRACT,
    revisionId: "44444444-4444-4444-8444-444444444444",
    revisionSequence: 1,
    manifest,
    manifestAsset: { contentHash: atlas._test.sha256(Buffer.from("manifest")) },
    master: {
      bytes: masterBytes,
      contentType: "image/png",
      contentHash: masterHash,
    },
    projection: {
      bytes: projectionBytes,
      byteSize: projectionBytes.length,
      contentType: "image/jpeg",
      contentHash: atlas._test.sha256(projectionBytes),
      sourceMasterHash: masterHash,
    },
  };
  const slots = worker.slotsFrom(undefined, v3Input, {}, flatAtlas);
  assert.equal(slots.length, 7);
  assert.equal(new Set(slots.map((slot) => slot.promptParts[0].inlineData.data)).size, 1);
  assert.equal(slots.every((slot) => slot.promptParts[0].inlineData.data === projectionBytes.toString("base64")), true);
  assert.equal(slots.every((slot) => slot.promptParts[0].inlineData.mimeType === "image/jpeg"), true);
  assert.equal(slots.some((slot) => slot.promptParts[0].inlineData.data === masterBytes.toString("base64")), false,
    "the canonical PNG is never inlined into a proof request");
  assert.equal(slots.every((slot) => slot.authorityMetadata.masterContentHash === flatAtlas.master.contentHash), true);
  assert.equal(slots.every((slot) => slot.authorityMetadata.projectionContentHash === flatAtlas.projection.contentHash), true);
  assert.equal(slots.every((slot) => slot.authorityMetadata.revisionId === flatAtlas.revisionId), true);
  assert.equal(slots.every((slot) => slot.authorityMetadata.geometryAuthority.status === "validated"), true);
  assert.match(slots.find((slot) => slot.sourceViewType === "passenger-side").promptParts[1].text, /passenger/);
  assert.equal(slots.every((slot) => slot.promptParts.length === 3), true, "atlas image + topology lock + projection-only camera prompt");
  const projection = slots.find((slot) => slot.sourceViewType === "side").promptParts[2].text;
  assert.match(projection, /CAMERA AND FRAMING ARE LOCKED/);
  assert.match(projection, /2024 Ford F-250 truck/);
  assert.match(projection, /SOLE appearance authority/);
  assert.doesNotMatch(projection, /senior graphic designer|creative call|THE CONCEPT/i,
    "v3 must not append the legacy creative-author prompt after the atlas lock");
});

test("proof-conditioning JPEG is deterministic, 4096px, white-flattened and below twelve MiB without resize", async () => {
  const manifest = atlas.buildAtlasManifest(surfaces);
  const guide = await atlas.renderAtlasGuide(manifest);
  const master = await atlas.normalizeAtlasMaster(guide, manifest);
  const first = await atlas.projectionDerivative(master);
  const second = await atlas.projectionDerivative(master);

  assert.equal(first.contentHash, second.contentHash);
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.byteSize <= atlas.PROJECTION_MAX_BYTES, true);
  assert.equal(first.base64ByteSize <= 16 * 1024 * 1024, true,
    "the binary cap leaves bounded base64 room below Google's 20 MiB inline limit");
  assert.equal(first.quality, atlas.PROJECTION_QUALITY_LADDER[0], "the first fitting deterministic quality rung wins");
  assert.equal(first.chromaSubsampling, "4:4:4");
  assert.equal(first.sourceMasterHash, atlas._test.sha256(master));

  const metadata = await sharp(first.bytes).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 4096);
  assert.equal(metadata.height, 4096);
  assert.equal(metadata.chromaSubsampling, "4:4:4");
  const corner = await sharp(first.bytes).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(corner[0] >= 250 && corner[1] >= 250 && corner[2] >= 250,
    "transparent atlas gaps become white, not black");

  const tooSmall = await sharp({
    create: { width: 2048, height: 2048, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
  }).png().toBuffer();
  await assert.rejects(() => atlas.projectionDerivative(tooSmall), /must be 4096x4096/);
});

test("reusing an atlas verifies the stored projection is the deterministic child of its PNG master", async () => {
  const manifest = atlas.buildAtlasManifest(surfaces);
  const manifestBytes = atlas._test.canonicalBytes(manifest);
  const guideBytes = await atlas.renderAtlasGuide(manifest);
  const masterBytes = await atlas.normalizeAtlasMaster(guideBytes, manifest);
  const projection = await atlas.projectionDerivative(masterBytes);
  const identities = {
    guide: { path: "guide.png", bytes: guideBytes, hash: atlas._test.sha256(guideBytes) },
    manifest: { path: "manifest.json", bytes: manifestBytes, hash: atlas._test.sha256(manifestBytes) },
    master: { path: "master.png", bytes: masterBytes, hash: atlas._test.sha256(masterBytes) },
    projection: { path: "projection.jpg", bytes: projection.bytes, hash: projection.contentHash },
  };
  const row = {
    id: "44444444-4444-4444-8444-444444444444",
    revision_sequence: 1,
    parent_revision_id: null,
    model: "gemini-3-pro-image",
    prompt_version: atlas.PROMPT_VERSION,
    width_px: 4096,
    height_px: 4096,
    effective_ppi: manifest.quality.minimumEffectivePpi,
    production_eligible: false,
    guide_storage_path: identities.guide.path,
    guide_content_hash: identities.guide.hash,
    guide_byte_size: identities.guide.bytes.length,
    guide_content_type: "image/png",
    manifest_storage_path: identities.manifest.path,
    manifest_content_hash: identities.manifest.hash,
    manifest_byte_size: identities.manifest.bytes.length,
    manifest_content_type: "application/json",
    master_storage_path: identities.master.path,
    master_content_hash: identities.master.hash,
    master_byte_size: identities.master.bytes.length,
    master_content_type: "image/png",
    projection_storage_path: identities.projection.path,
    projection_content_hash: identities.projection.hash,
    projection_byte_size: identities.projection.bytes.length,
    projection_content_type: "image/jpeg",
    metadata: { projectionQuality: projection.quality },
  };
  const blobs = new Map(Object.values(identities).map((identity) => [identity.path, new Blob([identity.bytes])]));
  const query = {
    select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    async maybeSingle() { return { data: row, error: null }; },
  };
  const supabase = {
    from(name) { assert.equal(name, "designpro_flat_atlas_revisions"); return query; },
    storage: { from() { return { async download(path) { return { data: blobs.get(path), error: null }; } }; } },
  };

  const loaded = await atlas.loadLatestAtlasRevision(supabase, REQUEST);
  assert.equal(loaded.reused, true);
  assert.equal(loaded.projection.contentHash, projection.contentHash);
  assert.deepEqual(loaded.projection.bytes, projection.bytes);
  assert.equal(loaded.projection.sourceMasterHash, loaded.master.contentHash);
});

test("initial authoring makes one image call, stores guide/manifest/master/projection, then inserts one immutable row", async () => {
  const events = [];
  let providerOptions = null;
  const generated = await atlas.renderAtlasGuide(atlas.buildAtlasManifest(surfaces));
  const provider = {
    async generateImage(options) {
      events.push("provider");
      providerOptions = options;
      return {
        bytes: generated,
        contentType: "image/png",
        model: "gemini-3-pro-image",
        keyFingerprint: "0123456789ab",
      };
    },
  };
  const stored = [];
  const store = {
    async putImmutableBytes(row) {
      events.push(`put:${row.storagePath}`);
      stored.push(row);
      return { storagePath: row.storagePath, contentHash: atlas._test.sha256(row.bytes), byteSize: row.bytes.length };
    },
  };
  let inserted = null;
  const table = {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    limit() { return this; },
    async maybeSingle() { return { data: null, error: null }; },
    insert(payload) {
      inserted = payload;
      events.push("insert");
      return {
        select() {
          return {
            async single() {
              return { data: { id: "44444444-4444-4444-8444-444444444444", ...payload }, error: null };
            },
          };
        },
      };
    },
  };
  const supabase = {
    from(name) {
      assert.equal(name, "designpro_flat_atlas_revisions");
      return table;
    },
    storage: { from() { throw new Error("no customer logo or existing atlas should download in this test"); } },
  };

  const result = await atlas.generateOrReuseFlatAtlas({
    supabase, store, provider,
    requestId: REQUEST, generationId: GENERATION, tenantKey: TENANT, ownerId: OWNER,
    input: v3Input, surfaces, geometryAuthority: provisionalAuthority,
  });

  assert.equal(events.filter((event) => event === "provider").length, 1);
  assert.equal(stored.length, 4);
  assert.deepEqual(stored.map((item) => item.contentType).sort(), ["application/json", "image/jpeg", "image/png", "image/png"]);
  assert.ok(events.lastIndexOf("insert") > Math.max(...events.map((event, index) => event.startsWith("put:") ? index : -1)),
    "the immutable row is inserted only after all three objects exist");
  assert.equal(providerOptions.aspectRatio, "1:1");
  assert.equal(providerOptions.imageSize, "4K");
  assert.equal(providerOptions.parts[0].inlineData.mimeType, "image/png", "the deterministic guide is the first input image");
  assert.equal(inserted.production_eligible, false);
  assert.equal(inserted.manifest.geometryAuthority.status, "provisional");
  assert.equal(inserted.metadata.geometryAuthority.operatorValidated, false);
  assert.equal(inserted.metadata.examplePurpose, "topology-only");
  assert.equal(inserted.projection_content_type, "image/jpeg");
  assert.ok(inserted.projection_byte_size <= atlas.PROJECTION_MAX_BYTES);
  assert.equal(inserted.metadata.projectionSourceMasterHash, inserted.master_content_hash);
  assert.equal(inserted.metadata.projectionHash, inserted.projection_content_hash);
  assert.equal(result.master.contentHash, inserted.master_content_hash);
  assert.equal(result.projection.contentHash, inserted.projection_content_hash);
  const receipt = atlas.atlasReceipt(result);
  assert.equal(receipt.geometryAuthority.status, "provisional");
  assert.equal(receipt.projection.contentHash, result.projection.contentHash);
  assert.equal(receipt.projection.sourceMasterHash, receipt.master.contentHash);
  assert.equal(result.manifest.contract, atlas.MANIFEST_CONTRACT);
});
