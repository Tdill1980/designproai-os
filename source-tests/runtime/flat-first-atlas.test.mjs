import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const atlas = require("../../runtime/flat-first-atlas.cjs");
const topologyExamples = require("../../runtime/flat-atlas-topology-examples.cjs");
const worker = require("../../runtime/generation-worker.cjs");
const runtimeRequire = createRequire(new URL("../../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");

const REQUEST = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const TENANT = `user_${OWNER}`;
const CLAIM_TOKEN = "44444444-4444-4444-8444-444444444444";

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

test("Call 1 sees the paired flattened top-view and corresponding finished 3D proof", async () => {
  const example = topologyExamples.loadBundledFlatToFinishedExample();
  const parts = await atlas._test.topologyExampleParts([example]);

  assert.equal(parts.length, 5);
  assert.match(parts[0].text, /FLATTENED TOP-VIEW OUTPUT FORMAT/);
  assert.equal(parts[1].inlineData.mimeType, "image/png");
  assert.match(parts[2].text, /CORRESPONDING FINISHED 3D PROOF/);
  assert.equal(parts[3].inlineData.mimeType, "image/png");
  assert.match(parts[4].text, /CALL 1 TARGET.*NEW flattened top-view design/i);
  assert.notEqual(parts[1].inlineData.data, parts[3].inlineData.data,
    "the model must receive both sides of the real teaching pair");

  const flattened = Buffer.from(parts[1].inlineData.data, "base64");
  const finished = Buffer.from(parts[3].inlineData.data, "base64");
  assert.deepEqual([...flattened.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([...finished.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const prompt = atlas._test.atlasPrompt(v3Input, atlas.buildAtlasManifest(surfaces));
  assert.match(prompt, /flattened top-view example.*finished 3D vehicle proof/i);
  assert.match(prompt, /output the new flattened top-view design first/i);
  assert.match(prompt, /never output a vehicle photograph/i);
  assert.match(prompt, /IGNORE their palette, imagery, text, logos, brand and style/);
});

test("Atlas preserves DesignPanel loadArtboardExamples behavior as optional quality evidence", async () => {
  const downloads = new Map([
    ["quality-one.png", new Blob([Buffer.from("first-quality-example")], { type: "image/png" })],
    ["quality-two.JPG", new Blob([Buffer.from("second-quality-example")], { type: "image/jpeg" })],
  ]);
  const calls = [];
  const storage = {
    async list(prefix, options) {
      calls.push(["list", prefix, options]);
      return {
        data: [
          { name: "notes.txt" },
          { name: "quality-one.png" },
          { name: "quality-two.JPG" },
          { name: "ignored-third.webp" },
        ],
      };
    },
    async download(name) {
      calls.push(["download", name]);
      return { data: downloads.get(name) || null };
    },
  };
  const supabase = {
    storage: {
      from(bucket) {
        assert.equal(bucket, topologyExamples.DESIGNPANEL_ARTBOARD_EXAMPLE_BUCKET);
        return storage;
      },
    },
  };

  const examples = await topologyExamples.loadDesignPanelArtboardExamples(supabase);
  assert.deepEqual(calls[0], ["list", "", { limit: 10 }]);
  assert.deepEqual(calls.slice(1), [
    ["download", "quality-one.png"],
    ["download", "quality-two.JPG"],
  ]);
  assert.equal(examples.length, 2);
  assert.equal(examples.every((example) => example.kind === "designpanel-artboard-quality"), true);
  assert.deepEqual(examples.map((example) => example.contentType), ["image/png", "image/jpeg"]);
  assert.equal(examples.every((example) => example.identity.source
    === "design-panel-ai-generate-loadArtboardExamples"), true);
  assert.equal(examples.every((example) => example.identity.contentHash
    === atlas._test.sha256(example.bytes)), true);

  const unavailable = await topologyExamples.loadDesignPanelArtboardExamples({
    storage: { from() { throw new Error("live optional bucket is unseeded"); } },
  });
  assert.deepEqual(unavailable, [], "the hash-pinned Houdini pair remains mandatory when optional gold examples are absent");
});

test("Call 1 aggregate inline bytes fail closed before Gemini's request ceiling", () => {
  const parts = [
    { text: "bounded master request" },
    { inlineData: { mimeType: "image/png", data: Buffer.alloc(512, 7).toString("base64") } },
  ];
  assert.ok(atlas._test.assertMasterRequestWithinLimit(parts, 4096) > 0);
  assert.throws(
    () => atlas._test.assertMasterRequestWithinLimit(parts, 128),
    (error) => error.code === "flat_atlas_master_request_too_large"
      && error.retryable === false,
  );
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
  assert.deepEqual(manifest.proofOnlyViews, ["close-up"]);
  assert.equal(manifest.proofOnlyViews.includes("hero-3d"), false);
  assert.equal(manifest.zones.some((zone) => zone.surfaceKey === "closeup" || zone.surfaceKey === "hero3d"), false);
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

test("all seven proof prompts carry their exact master-bound native zone and identity", async () => {
  const manifest = atlas.buildAtlasManifest(surfaces);
  const guideBytes = await atlas.renderAtlasGuide(manifest);
  const masterBytes = await atlas.normalizeAtlasMaster(guideBytes, manifest);
  const projection = await atlas.projectionDerivative(masterBytes);
  const masterHash = atlas._test.sha256(masterBytes);
  const viewAuthorities = await atlas._test.buildViewAuthorities(masterBytes, manifest);
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
      bytes: projection.bytes,
      byteSize: projection.byteSize,
      contentType: "image/jpeg",
      contentHash: projection.contentHash,
      sourceMasterHash: masterHash,
    },
    viewAuthorities,
  };
  const slots = worker.slotsFrom(undefined, v3Input, {}, flatAtlas);
  assert.equal(slots.length, 7);
  assert.equal(new Set(slots.map((slot) => slot.promptParts[0].inlineData.data)).size, 6,
    "Close-Up intentionally shares Driver's exact master zone; every other proof owns its native zone");
  assert.equal(slots.every((slot) => (
    slot.promptParts[0].inlineData.data === viewAuthorities[slot.sourceViewType].bytes.toString("base64")
  )), true);
  assert.equal(slots.every((slot) => slot.promptParts[0].inlineData.mimeType === "image/jpeg"), true);
  assert.equal(slots.some((slot) => slot.promptParts[0].inlineData.data === masterBytes.toString("base64")), false,
    "the canonical PNG is never inlined into a proof request");
  assert.equal(slots.every((slot) => slot.authorityMetadata.masterContentHash === flatAtlas.master.contentHash), true);
  assert.equal(slots.every((slot) => slot.authorityMetadata.projectionContentHash === flatAtlas.projection.contentHash), true);
  assert.equal(slots.every((slot) => slot.authorityMetadata.revisionId === flatAtlas.revisionId), true);
  assert.equal(slots.every((slot) => slot.authorityMetadata.geometryAuthority.status === "validated"), true);
  assert.equal(slots.every((slot) => slot.authorityMetadata.zoneContentHash
    === viewAuthorities[slot.sourceViewType].contentHash), true);
  assert.equal(slots.every((slot) => slot.authorityMetadata.zoneSurfaceKey
    === viewAuthorities[slot.sourceViewType].surfaceKey), true);
  assert.match(slots.find((slot) => slot.sourceViewType === "passenger-side").promptParts[1].text, /passenger/);
  assert.equal(slots.every((slot) => slot.promptParts.length === 3), true, "atlas image + topology lock + projection-only camera prompt");
  const projectionPrompt = slots.find((slot) => slot.sourceViewType === "side").promptParts[2].text;
  assert.match(projectionPrompt, /CAMERA AND FRAMING ARE LOCKED/);
  assert.match(projectionPrompt, /2024 Ford F-250 truck/);
  assert.match(projectionPrompt, /SOLE appearance authority/);
  assert.doesNotMatch(projectionPrompt, /senior graphic designer|creative call|THE CONCEPT/i,
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
  const pairedExample = topologyExamples.loadBundledFlatToFinishedExample();
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
    async rpc(name, args) {
      assert.equal(name, "claim_designpro_flat_atlas_authoring");
      assert.deepEqual(args, { p_request_id: REQUEST, p_claim_token: CLAIM_TOKEN });
      events.push("fence");
      return { data: true, error: null };
    },
    from(name) {
      assert.equal(name, "designpro_flat_atlas_revisions");
      return table;
    },
    storage: { from() { throw new Error("no customer logo or existing atlas should download in this test"); } },
  };

  const result = await atlas.generateOrReuseFlatAtlas({
    supabase, store, provider,
    requestId: REQUEST, claimToken: CLAIM_TOKEN,
    generationId: GENERATION, tenantKey: TENANT, ownerId: OWNER,
    input: v3Input, surfaces, geometryAuthority: provisionalAuthority,
    topologyExamples: [pairedExample],
    masterValidatorFactory: () => async ({ masterBytes, guideBytes }) => {
      events.push("master-qc");
      return {
        accepted: true,
        review: { confidence: 0.99 },
        deterministic: { accepted: true },
        metadata: {
          contract: "designpro.atlas-master-semantic-qc.v1",
          confidence: 0.99,
          model: "gemini-2.5-flash",
          keyFingerprint: "abcdef012345",
          requestByteSize: 1234,
          masterHash: atlas._test.sha256(masterBytes),
          guideHash: atlas._test.sha256(guideBytes),
        },
      };
    },
  });

  assert.equal(events.filter((event) => event === "provider").length, 1);
  // Guide, manifest, master, projection -- plus the six panels Call 1 cuts from
  // the accepted master. Those six are what RevisionStudio entices with and what
  // PanelPro Studio is later served, so they are produced here rather than
  // re-derived downstream.
  assert.equal(stored.length, 10);
  assert.ok(events.indexOf("master-qc") > events.indexOf("provider"));
  assert.ok(events.indexOf("master-qc") < events.findIndex((event) => event.startsWith("put:")),
    "master acceptance must pass before any Atlas artifact is persisted");
  assert.deepEqual(
    stored.map((item) => item.contentType).sort(),
    ["application/json", "image/jpeg", ...Array(8).fill("image/png")],
    "the six panels are lossless PNG -- print artwork never takes a lossy round trip",
  );
  assert.ok(events.lastIndexOf("insert") > Math.max(...events.map((event, index) => event.startsWith("put:") ? index : -1)),
    "the immutable row is inserted only after all three objects exist");
  assert.equal(providerOptions.aspectRatio, "1:1");
  assert.equal(providerOptions.imageSize, "4K");
  assert.equal(providerOptions.parts[0].inlineData.mimeType, "image/png", "the deterministic guide is the first input image");
  assert.match(providerOptions.parts[2].text, /FLATTENED TOP-VIEW OUTPUT FORMAT/);
  assert.match(providerOptions.parts[4].text, /CORRESPONDING FINISHED 3D PROOF/);
  assert.equal(inserted.example_id, null, "release-bundled examples never forge a database example foreign key");
  assert.equal(inserted.production_eligible, false);
  assert.equal(inserted.manifest.geometryAuthority.status, "provisional");
  assert.equal(inserted.metadata.geometryAuthority.operatorValidated, false);
  assert.equal(inserted.metadata.examplePurpose, "topology-only");

  // CALL 1 CUTS THE SIX PANELS, AND EACH ONE CARRIES ITS SIDE'S SIZE.
  // Without the dimensions the 3D calls have to guess how long a driver side is
  // next to a hood, and the proof disagrees with the panel being sold.
  const panels = inserted.metadata.callOnePanels;
  assert.equal(panels.length, 6);
  assert.deepEqual(
    panels.map((panel) => panel.surfaceKey).sort(),
    ["driver", "front", "hood", "passenger", "rear", "roof"],
  );
  for (const panel of panels) {
    assert.match(panel.contentHash, /^[0-9a-f]{64}$/);
    assert.equal(panel.contentType, "image/png");
    assert.ok(panel.trimWidthIn > 0 && panel.trimHeightIn > 0, `${panel.surfaceKey} has no trim size`);
    // The five-inch bleed is already in the layout, on every edge.
    assert.equal(panel.printWidthIn, panel.trimWidthIn + 10);
    assert.equal(panel.printHeightIn, panel.trimHeightIn + 10);
    assert.equal(panel.bleedInches, 5);
    assert.ok(panel.surfaceSqFt > 0);
    // Design-time geometry, not validated production geometry: GENIE supplies
    // that only when the pack is ordered.
    assert.equal(panel.geometryPurpose, "calls-1-7-layout-only");
    assert.equal(panel.sourceMasterHash, inserted.master_content_hash);
    assert.ok(stored.some((item) => item.storagePath === panel.storagePath), `${panel.surfaceKey} bytes were not stored`);
  }
  assert.equal(new Set(panels.map((panel) => panel.contentHash)).size, 6, "six distinct panels");
  assert.equal(inserted.metadata.topologyExamplesApplied, 1);
  assert.equal(inserted.metadata.masterQcPassed, true);
  assert.equal(inserted.metadata.masterQcContract, "designpro.atlas-master-semantic-qc.v1");
  assert.equal(inserted.metadata.topologyExampleIdentity.source, "exact-server-release");
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

test("an interrupted Atlas authoring fence prevents a duplicate provider call", async () => {
  let providerCalls = 0;
  let fenceCalls = 0;
  const table = {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    limit() { return this; },
    async maybeSingle() { return { data: null, error: null }; },
  };
  const supabase = {
    from(name) {
      assert.equal(name, "designpro_flat_atlas_revisions");
      return table;
    },
    async rpc(name, args) {
      assert.equal(name, "claim_designpro_flat_atlas_authoring");
      assert.deepEqual(args, { p_request_id: REQUEST, p_claim_token: CLAIM_TOKEN });
      fenceCalls += 1;
      return { data: fenceCalls === 1, error: null };
    },
    storage: { from() { throw new Error("no customer assets are present"); } },
  };
  const store = { async putImmutableBytes() { return {}; } };
  const provider = {
    async generateImage() {
      providerCalls += 1;
      throw new Error("simulated worker interruption after the fence");
    },
  };
  const options = {
    supabase, store, provider, requestId: REQUEST, claimToken: CLAIM_TOKEN,
    generationId: GENERATION, tenantKey: TENANT, ownerId: OWNER,
    input: v3Input, surfaces, geometryAuthority: provisionalAuthority,
  };

  await assert.rejects(() => atlas.generateOrReuseFlatAtlas(options), /simulated worker interruption/);
  assert.equal(providerCalls, 1);
  await assert.rejects(
    () => atlas.generateOrReuseFlatAtlas(options),
    (error) => error.code === "flat_atlas_authoring_already_started" && error.retryable === false,
  );
  assert.equal(providerCalls, 1, "the duplicate attempt makes zero provider calls");
});
