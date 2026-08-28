import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const flatFirst = require("../runtime/flat-first-atlas.cjs");
const {
  ARTIFACT_AUDIT_CONTRACT,
  ATLAS_SERVER_PROVIDER_CONTRACT,
  buildAtlasProjectionPrompt,
  buildAtlasProjectionRequest,
  createAtlasDesignPanelProvider,
  _test,
} = require("../runtime/designpanel-server-provider.cjs");

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_KEY = `user_${OWNER_ID}`;

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fixture() {
  const atlasBytes = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#00a9ce" } })
    .jpeg({ quality: 85 }).toBuffer();
  const projectionContentHash = hash(atlasBytes);
  const masterContentHash = "a".repeat(64);
  const manifestContentHash = "b".repeat(64);
  const driverBytes = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#1565c0" } })
    .composite([{
      input: await sharp({ create: { width: 320, height: 500, channels: 3, background: "#f4d03f" } }).png().toBuffer(),
      left: 120,
      top: 180,
    }])
    .png()
    .toBuffer();
  const driverHash = hash(driverBytes);
  const driverPath = `designpro/${TENANT_KEY}/${GENERATION_ID}/calls-1-7/side/${driverHash}.png`;
  let driverReady = false;
  const heroRow = {
    storage_path: driverPath,
    content_hash: driverHash,
    byte_size: driverBytes.length,
    content_type: "image/png",
  };
  const supabase = {
    storage: { from: () => ({ download: async () => ({ data: new Blob([driverBytes]), error: null }) }) },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => ({ data: driverReady ? heroRow : null, error: null }),
      };
      return chain;
    },
  };
  const conditioningParts = (sourceViewType) => [
    { inlineData: { mimeType: "image/jpeg", data: atlasBytes.toString("base64") } },
    { text: `canonical Atlas projection instructions for ${sourceViewType}` },
  ];
  const surfaces = {
    side: "driver", "passenger-side": "passenger", hood_detail: "hood",
    front: "front", rear: "rear", "close-up": "driver", roof: "roof",
  };
  const conditioningIdentityFor = (sourceViewType) => ({
    contract: "designpro.flat-first-atlas-view-authority.v1",
    sourceViewType,
    surfaceKey: surfaces[sourceViewType],
    contentHash: projectionContentHash,
    sourceMasterHash: masterContentHash,
  });
  return {
    atlasBytes,
    conditioningParts,
    conditioningIdentityFor,
    driverBytes,
    driverHash,
    driverPath,
    manifestContentHash,
    masterContentHash,
    projectionContentHash,
    setDriverReady: () => { driverReady = true; },
    supabase,
  };
}

test("Atlas renders every surface from its own master-zone authority, with no Driver dependency", async () => {
  const f = await fixture();
  const calls = [];
  const directProvider = {
    models: ["gemini-3-pro-image"],
    keyCount: 2,
    generateImage: async (call) => {
      calls.push(call);
      const repairedPassengerBytes = call.passengerRepairAttempt
        ? Buffer.from(call.parts[0].inlineData.data, "base64")
        : null;
      return {
        bytes: repairedPassengerBytes || f.driverBytes,
        contentType: "image/png",
        model: "gemini-3-pro-image",
        keyFingerprint: "0123456789ab",
        attempts: [],
      };
    },
  };
  const atlas = {
    masterContentHash: f.masterContentHash,
    projectionContentHash: f.projectionContentHash,
    manifestContentHash: f.manifestContentHash,
    revisionId: "44444444-4444-4444-8444-444444444444",
    revisionSequence: 1,
    conditioningIdentityFor: f.conditioningIdentityFor,
  };
  const input = {
    brief: "Flamingo Pools logo and photographic pool scene",
    finish: "Gloss",
    vehicle: { year: "2024", make: "Ford", model: "F-250", type: "truck" },
  };
  const provider = createAtlasDesignPanelProvider({
    supabase: f.supabase,
    provider: directProvider,
    requestId: REQUEST_ID,
    generationId: GENERATION_ID,
    tenantKey: TENANT_KEY,
    input,
    atlas,
  });

  const driverCallParts = f.conditioningParts("side");
  const driver = await provider.generateImage({
    sourceViewType: "side",
    parts: driverCallParts,
    aspectRatio: "16:9",
    imageSize: "4K",
    attempt: 1,
  });
  assert.equal(provider.contract, ATLAS_SERVER_PROVIDER_CONTRACT);
  assert.equal(driver.metadata.stage, "generate-color-render");
  assert.equal(driver.metadata.anchoredToFlatAtlas, true);
  assert.equal(driver.metadata.anchoredToView1, false);
  assert.equal(driver.metadata.contract, ARTIFACT_AUDIT_CONTRACT);
  assert.equal(driver.metadata.renderMethod, "generate-color-render");
  assert.equal(driver.metadata.atlasZoneSurfaceKey, "driver");
  assert.equal(driver.metadata.atlasZoneContentHash, f.projectionContentHash);
  assert.match(driver.metadata.promptHash, /^[0-9a-f]{64}$/);
  assert.ok(driver.metadata.promptLength > 1000);
  assert.equal(driver.metadata.studioContractVersion, "designpro.studio-os.port-ab0f0638.v1");
  assert.equal(driver.metadata.viewAngleContractVersion, "designpro.view-angles-os.port-ab0f0638.v1");
  assert.equal(driver.metadata.photographyContractVersion, "designpro.photorealism-prompt.port.v1");
  assert.equal(driver.metadata.structuredInputs.vehicleModel, true);
  assert.equal(driver.metadata.logoPresent, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parts.filter((part) => part.inlineData).length, 1,
    "Driver must receive the existing Atlas projection only");
  assert.equal(calls[0].parts.some((part) => part.text === driverCallParts[1].text), true,
    "the existing view-specific Atlas call.parts were replaced");
  assert.match(calls[0].parts[0].text, /SOLE artwork authority/i);
  assert.match(calls[0].parts[0].text, /generate-color-render photography stage/i);
  assert.match(calls[0].parts[0].text, /open bed interior stays bare factory bedliner/i);
  assert.match(calls[0].parts[0].text, /Canon EOS R5/);
  assert.match(calls[0].parts[0].text, /STUDIO LOCK/);
  assert.ok(driver.metadata.requestByteSize < _test.GEMINI_REQUEST_LIMIT_BYTES);

  // The engine persists Driver between these stages; expose that frozen row to
  // this provider exactly where the production worker would.
  f.setDriverReady();
  const passenger = await provider.generateImage({
    sourceViewType: "passenger-side",
    parts: f.conditioningParts("passenger-side"),
    aspectRatio: "16:9",
    imageSize: "4K",
    attempt: 1,
  });
  // PASSENGER IS A SIBLING, RENDERED FROM ITS OWN SURFACE AUTHORITY.
  //
  // It used to be a sharp mirror of the accepted Driver followed by a surgical
  // AI text-repair pass, policed by a similarity bound. Flamingo Pools
  // (5b2eb96c, the proven A.T.L.A.S.-first run) did no such thing: its
  // Passenger was its own Gemini call at 35,747 ms with a real key
  // fingerprint, LONGER than its own Driver -- a sharp mirror costs ~100 ms and
  // burns no key. The mirror chain arrived with the server port and became the
  // top cause of failed runs, because a branded design can never be a literal
  // pixel mirror while every word stays forward-reading on both flanks.
  assert.equal(passenger.metadata.renderMethod, "generate-color-render",
    "Passenger renders like every other surface");
  assert.equal(passenger.metadata.passengerProducer, undefined);
  assert.equal(passenger.metadata.deterministicMirror, undefined);
  assert.equal(passenger.metadata.atlasZonePassedToPassengerRepair, undefined);
  // No Driver dependency of any kind.
  assert.equal(passenger.metadata.anchoredToView1, false);
  assert.equal(passenger.metadata.driverContentHash, undefined);
  // Identity still binds to the shared master, for this exact surface.
  assert.equal(passenger.metadata.atlasZoneSurfaceKey, "passenger");
  assert.match(passenger.metadata.promptHash, /^[0-9a-f]{64}$/);
  assert.equal(calls.length, 2, "Passenger is one render, not a mirror plus a repair");
  const passengerParts = calls[1].parts;
  const passengerAuthority = passengerParts.find((part) => part?.inlineData);
  assert.ok(passengerAuthority, "Passenger must receive its master-zone authority as image data");
  assert.equal(hash(Buffer.from(passengerAuthority.inlineData.data, "base64")), f.projectionContentHash,
    "Passenger must be conditioned on its verified native master-zone authority");
  // The camera contract itself is asserted against the real builder in
  // atlas-generation-worker-wiring.test.mjs; this harness stubs the prompt, so
  // what matters here is that Passenger got the canonical projection prompt for
  // its OWN view rather than a mirror-repair instruction.
  assert.ok(
    passengerParts.some((part) => /canonical Atlas projection instructions for passenger-side/.test(part?.text || "")),
    "Passenger got the canonical projection prompt for its OWN view",
  );
  // THE CONTINUITY-ONLY DRIVER PHOTOGRAPH (owner decision, 2026-08-26).
  // Driver is accepted by now, so the sibling's request carries a SECOND
  // image: the compacted Driver proof, labelled continuity-only and placed
  // AFTER the zone authority. It provides vehicle/studio/camera context and
  // never artwork -- the metadata says so under its own name, and the four
  // retired-path keys the fence refuses stay absent.
  assert.equal(passengerParts.filter((part) => part?.inlineData).length, 2,
    "sibling carries its zone authority plus the continuity photograph");
  assert.ok(
    passengerParts.some((part) => /CONTINUITY ONLY/.test(part?.text || "")),
    "the continuity image is labelled for what it is",
  );
  assert.equal(passenger.metadata.atlasDriverContinuityOnly, true);
  assert.match(passenger.metadata.atlasDriverContinuityReferenceHash, /^[0-9a-f]{64}$/);

  const roof = await provider.generateImage({
    sourceViewType: "roof",
    parts: f.conditioningParts("roof"),
    aspectRatio: "16:9",
    imageSize: "4K",
    attempt: 1,
  });
  assert.equal(calls.length, 3);
  const roofCall = calls[2];
  // Roof, like every other surface, receives its OWN master-zone authority and
  // nothing else. The bounded Driver continuity anchor is gone: cross-view
  // identity comes from the shared frozen master, hash-verified per surface,
  // rather than from injecting one render into the others.
  // Zone authority FIRST image, continuity photograph last: the authority
  // position the proof QC verifies is untouched by the continuity reference.
  assert.equal(roofCall.parts.filter((part) => part.inlineData).length, 2,
    "Roof carries its own Atlas authority plus the continuity photograph");
  assert.equal(
    hash(Buffer.from(roofCall.parts.find((part) => part?.inlineData).inlineData.data, "base64")),
    f.projectionContentHash,
    "the FIRST image remains the zone authority",
  );
  assert.match(roofCall.parts[0].text, /CAB ROOF ONLY/);
  assert.match(roofCall.parts[0].text, /cargo bed\/box.*must be outside the frame/is);
  assert.match(roofCall.parts[0].text, /open bed interior stays bare factory bedliner/i);
  // The prompt may name the Driver photograph, but only as continuity: the
  // Atlas stays the sole artwork authority and wins any conflict.
  assert.match(roofCall.parts[0].text, /where the Driver proof and Atlas could be read differently, the Atlas wins/i);
  assert.equal(roof.metadata.stage, "generate-color-render");
  assert.equal(roof.metadata.anchoredToFlatAtlas, true);
  assert.equal(roof.metadata.anchoredToView1, false);
  assert.equal(roof.metadata.driverStoragePath, undefined);
  assert.equal(roof.metadata.driverReferenceByteSize, undefined);
  assert.equal(roof.metadata.atlasZoneSurfaceKey, "roof");
  assert.ok(roof.metadata.requestByteSize < _test.GEMINI_REQUEST_LIMIT_BYTES);
});

test("real atlasProjectionParts passes its exact native crop through the provider identity gate", async () => {
  const panelSurfaces = [
    ["driver", 190, 66], ["passenger", 190, 66], ["hood", 68, 62],
    ["roof", 76, 96], ["front", 84, 34], ["rear", 82, 48],
  ].map(([surfaceKey, widthInches, heightInches]) => ({
    surfaceKey, widthInches, heightInches,
    bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  }));
  const manifest = flatFirst.buildAtlasManifest(panelSurfaces);
  // The cut is fail-closed on the GENIE manifest identity now.
  manifest.geometryResolution = {
    contract: "designpro.genie-manifest.v1",
    genieManifestId: "0".repeat(32),
    genieManifestHash: "0".repeat(64),
    state: "derived",
    derivationContract: "designpro.genie-front-derived.v1",
    derivedSurfaces: ["front"],
    geometrySourceRowId: "row-fixture",
    productionEligible: false,
    operatorValidated: false,
  };
  const guide = await flatFirst.renderAtlasGuide(manifest);
  const masterBytes = (await flatFirst.normalizeAtlasMaster(guide, manifest)).bytes;
  const projection = await flatFirst.projectionDerivative(masterBytes);
  const callOnePanels = await flatFirst.cutCallOnePanels(
    masterBytes, manifest, flatFirst._test.sha256(masterBytes),
  );
  const viewAuthorities = await flatFirst._test.buildViewAuthorities(callOnePanels);
  const masterContentHash = hash(masterBytes);
  const flatAtlas = {
    contract: flatFirst.ATLAS_CONTRACT,
    revisionId: "44444444-4444-4444-8444-444444444444",
    revisionSequence: 1,
    manifest,
    manifestAsset: { contentHash: "b".repeat(64) },
    master: { bytes: masterBytes, contentHash: masterContentHash },
    projection,
    viewAuthorities,
  };
  const transportCalls = [];
  const provider = createAtlasDesignPanelProvider({
    supabase: {
      storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) },
      from: () => {
        const chain = {
          select: () => chain, eq: () => chain, is: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return chain;
      },
    },
    provider: {
      models: ["gemini-3-pro-image"], keyCount: 1,
      generateImage: async (call) => {
        transportCalls.push(call);
        return {
          bytes: viewAuthorities.side.bytes,
          contentType: "image/jpeg",
          model: "gemini-3-pro-image",
          keyFingerprint: "0123456789ab",
          attempts: [],
        };
      },
    },
    requestId: REQUEST_ID,
    generationId: GENERATION_ID,
    tenantKey: TENANT_KEY,
    input: { vehicle: { year: "2024", make: "Ford", model: "F-250", type: "truck" } },
    atlas: {
      conditioningPartsFor: (sourceViewType) => flatFirst.atlasProjectionParts(flatAtlas, sourceViewType),
      conditioningIdentityFor: (sourceViewType) => flatFirst.viewAuthorityFor(flatAtlas, sourceViewType),
      authorityMetadata: {
        masterContentHash,
        projectionContentHash: projection.contentHash,
        manifestContentHash: flatAtlas.manifestAsset.contentHash,
        revisionId: flatAtlas.revisionId,
        revisionSequence: 1,
      },
    },
  });

  const parts = flatFirst.atlasProjectionParts(flatAtlas, "side");
  const result = await provider.generateImage({
    sourceViewType: "side", parts, aspectRatio: "16:9", imageSize: "4K", attempt: 1,
  });
  const sentImage = transportCalls[0].parts.find((part) => part.inlineData);
  assert.equal(hash(Buffer.from(sentImage.inlineData.data, "base64")), viewAuthorities.side.contentHash);
  assert.equal(result.metadata.atlasZoneContentHash, viewAuthorities.side.contentHash);
  assert.equal(result.metadata.atlasZoneSurfaceKey, "driver");
  assert.notEqual(viewAuthorities.side.contentHash, projection.contentHash,
    "the provider receives the exact Driver zone, not the complete white-flattened sheet");
});

test("Atlas keeps the exact passenger and close-up view clauses without introducing a hero view", () => {
  const input = { vehicle: { year: "2024", make: "Ford", model: "F-250", type: "truck" } };
  const passenger = buildAtlasProjectionPrompt({ input, sourceViewType: "passenger-side", hasDriverAnchor: true });
  const closeUp = buildAtlasProjectionPrompt({ input, sourceViewType: "close-up", hasDriverAnchor: true });
  assert.match(passenger, /vehicle faces RIGHT in frame \(nose pointing right\)/);
  assert.match(passenger, /All text and lettering reads correctly left-to-right, NEVER mirrored/);
  assert.match(closeUp, /18 inches from the vehicle body surface/);
  assert.match(closeUp, /locked camera distance above/);
  assert.doesNotMatch(closeUp, /hero view/i);
});

test("Atlas verifies the exact zone hash and fails closed before a request can exceed Gemini 20 MiB", async () => {
  const huge = Buffer.alloc(15 * 1024 * 1024, 7);
  const atlas = {
    masterContentHash: "a".repeat(64),
    projectionContentHash: hash(huge),
    conditioningParts: [{ inlineData: { mimeType: "image/jpeg", data: huge.toString("base64") } }],
    conditioningIdentityFor: (sourceViewType) => ({
      contract: "designpro.flat-first-atlas-view-authority.v1",
      sourceViewType,
      surfaceKey: "driver",
      contentHash: hash(huge),
      sourceMasterHash: "a".repeat(64),
    }),
  };
  await assert.rejects(
    () => buildAtlasProjectionRequest({
      atlas,
      input: { vehicle: { year: "2024", make: "Ford", model: "F-250" } },
      sourceViewType: "side",
      call: { attempt: 1, aspectRatio: "16:9", imageSize: "4K" },
    }),
    (error) => error?.code === "designpanel_atlas_request_too_large" && error.retryable === false,
  );

  const wrongIdentity = {
    ...atlas,
    maxRequestBytes: 100_000_000,
    conditioningIdentityFor: (sourceViewType) => ({
      contract: "designpro.flat-first-atlas-view-authority.v1",
      sourceViewType,
      surfaceKey: "driver",
      contentHash: "f".repeat(64),
      sourceMasterHash: "a".repeat(64),
    }),
  };
  await assert.rejects(
    () => buildAtlasProjectionRequest({
      atlas: wrongIdentity,
      input: { vehicle: { make: "Ford", model: "F-250" } },
      sourceViewType: "side",
      call: { attempt: 1 },
    }),
    (error) => error?.code === "designpanel_atlas_view_authority_hash_mismatch" && error.retryable === false,
  );
});

test("Passenger mirror plus native zone are deterministically bounded below Gemini 20 MiB", async () => {
  const mirrorRaw = randomBytes(2560 * 1440 * 3);
  const authorityRaw = randomBytes(1800 * 1200 * 3);
  const mirror = await sharp(mirrorRaw, { raw: { width: 2560, height: 1440, channels: 3 } })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
  const authority = await sharp(authorityRaw, { raw: { width: 1800, height: 1200, channels: 3 } })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
  const originalParts = [
    { inlineData: { mimeType: "image/jpeg", data: mirror.toString("base64") } },
    { inlineData: { mimeType: "image/jpeg", data: authority.toString("base64") } },
    { text: _test.passengerTextFixPrompt({ contentHash: hash(authority) }) },
  ];
  assert.ok(_test.passengerRepairRequestByteSize(originalParts) > _test.MAX_ATLAS_REQUEST_BYTES,
    "high-entropy worst case must exercise bounded transport");

  const request = await _test.buildPassengerTextFixRequest({
    mirrorBytes: mirror,
    atlasAuthority: {
      contentHash: hash(authority),
      inlineData: { mimeType: "image/jpeg", data: authority.toString("base64") },
    },
  });
  assert.equal(request.transportDerived, true);
  assert.ok(request.requestByteSize <= _test.MAX_ATLAS_REQUEST_BYTES);
  assert.equal(request.parts.filter((part) => part.inlineData).length, 2);
  const [boundedMirror, boundedAuthority] = request.parts.filter((part) => part.inlineData)
    .map((part) => Buffer.from(part.inlineData.data, "base64"));
  const [mirrorMeta, boundedMirrorMeta, authorityMeta, boundedAuthorityMeta] = await Promise.all([
    sharp(mirror).metadata(), sharp(boundedMirror).metadata(),
    sharp(authority).metadata(), sharp(boundedAuthority).metadata(),
  ]);
  assert.deepEqual(
    [boundedMirrorMeta.width, boundedMirrorMeta.height, boundedAuthorityMeta.width, boundedAuthorityMeta.height],
    [mirrorMeta.width, mirrorMeta.height, authorityMeta.width, authorityMeta.height],
    "request bounding may change JPEG quality but never crop or resize either authority",
  );
});
