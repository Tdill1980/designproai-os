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

/**
 * EVERY SURFACE IS PHOTOGRAPHED FROM ITS OWN PANEL, BY THE PROVEN STACK.
 *
 * This test used to assert the runtime's own proof prompt -- promptHash,
 * studioContractVersion, "SOLE artwork authority", the STUDIO LOCK text. That
 * producer is gone (owner, 2026-08-28: "DO NOT CREATE ANOTHER 3D EDGE
 * FUNCTION"), and the provider is now a transport to
 * persona-photographer-render. The INTENT it protected is unchanged and is
 * what is asserted here instead:
 *
 *   - each shot is sent its OWN surface's persisted panel, never another's;
 *   - Passenger is one render from the passenger panel -- not a mirror, not a
 *     repair pass, not the driver's artwork;
 *   - no Driver dependency of any kind, and none of the retired-path keys;
 *   - the returned bytes are hash-verified against what the function reported.
 */
function transportFixture({ proofBytes, panelPaths }) {
  const posts = [];
  const proofSha = hash(proofBytes);
  const fetchImpl = async (url, init) => {
    posts.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        contract: "designpro.atlas-photographer-proof.v1",
        sourceCommit: "113d137dbe8813ca3bf70c8d7265ad081ebd4524",
        model: "gemini-3-pro-image",
        imageRequestCount: 1,
        proofStoragePath: "atlas-proof/x.png",
        proofSha256: proofSha,
        proofBytes: proofBytes.length,
        contentType: "image/png",
      }),
    };
  };
  const supabase = {
    storage: { from: () => ({ download: async () => ({ data: new Blob([proofBytes]), error: null }) }) },
    from: () => {
      const chain = {
        select: () => chain, eq: () => chain, is: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  };
  const surfaces = {
    side: "driver", "passenger-side": "passenger", hood_detail: "hood",
    front: "front", rear: "rear", "close-up": "driver", roof: "roof",
  };
  const atlas = {
    masterContentHash: "a".repeat(64),
    projectionContentHash: "c".repeat(64),
    manifestContentHash: "b".repeat(64),
    revisionId: "44444444-4444-4444-8444-444444444444",
    revisionSequence: 1,
    conditioningIdentityFor: (sourceViewType) => ({
      contract: "designpro.flat-first-atlas-view-authority.v1",
      sourceViewType, surfaceKey: surfaces[sourceViewType],
      contentHash: "c".repeat(64), sourceMasterHash: "a".repeat(64),
    }),
    panelFor: (sourceViewType) => {
      const surfaceKey = surfaces[sourceViewType];
      return {
        surfaceKey, sourceViewType,
        storagePath: panelPaths[surfaceKey],
        contentHash: hash(Buffer.from(surfaceKey)),
        contentType: "image/png",
        sourceMasterHash: "a".repeat(64),
      };
    },
  };
  return { posts, atlas, supabase, fetchImpl, surfaces };
}

test("every A.T.L.A.S. shot is photographed from its own panel, with no Driver dependency", async () => {
  const proofBytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#1565c0" } })
    .png().toBuffer();
  const panelPaths = Object.fromEntries(
    ["driver", "passenger", "hood", "roof", "front", "rear"].map((s) => [s, `designpro/panels/${s}.png`]),
  );
  const f = transportFixture({ proofBytes, panelPaths });
  const provider = createAtlasDesignPanelProvider({
    supabase: f.supabase,
    supabaseUrl: "https://example.supabase.co",
    serviceRoleKey: "s".repeat(64),
    fetchImpl: f.fetchImpl,
    provider: { models: ["gemini-3-pro-image"], keyCount: 2, generateImage: async () => { throw new Error("the transport must not generate images itself"); } },
    requestId: REQUEST_ID,
    generationId: GENERATION_ID,
    tenantKey: TENANT_KEY,
    input: {
      brief: "Flamingo Pools logo and photographic pool scene",
      finish: "Gloss",
      vehicle: { year: "2024", make: "Ford", model: "F-250", type: "truck" },
    },
    atlas: f.atlas,
  });
  assert.equal(provider.contract, ATLAS_SERVER_PROVIDER_CONTRACT);

  for (const sourceViewType of ["side", "passenger-side", "hood_detail", "front", "rear", "roof", "close-up"]) {
    const result = await provider.generateImage({ sourceViewType, attempt: 1 });
    const post = f.posts[f.posts.length - 1];
    const surfaceKey = f.surfaces[sourceViewType];

    // THE PROVEN PRODUCER, ONE SHOT AT A TIME.
    assert.match(post.url, /\/functions\/v1\/persona-photographer-render$/);
    assert.equal(post.body.mode, "atlas-proof");
    assert.equal(post.body.shotKey, sourceViewType);

    // ITS OWN PANEL. Passenger gets passenger; nothing gets the driver's
    // artwork unless it IS the driver surface.
    assert.equal(post.body.surfaceKey, surfaceKey);
    assert.equal(post.body.sourcePanelPath, panelPaths[surfaceKey]);
    assert.equal(post.body.sourcePanelHash, hash(Buffer.from(surfaceKey)));

    // NO DRIVER DEPENDENCY, AND NO HERO.
    assert.equal(post.body.heroRenderUrl, undefined);
    assert.equal(post.body.designAnchorText, undefined,
      "the anchor text is the photographer's to build, not the runtime's");

    // Vehicle + finish travel; nothing creative does.
    assert.equal(post.body.vehicleMake, "Ford");
    assert.equal(post.body.finish, "Gloss");
    assert.equal(post.body.brief, undefined);
    assert.equal(post.body.companyName, undefined);

    // Hash-verified bytes come back, bound to this surface and this master.
    assert.equal(hash(result.bytes), hash(proofBytes));
    assert.equal(result.metadata.anchoredToFlatAtlas, true);
    assert.equal(result.metadata.anchoredToView1, false);
    assert.equal(result.metadata.proofProducer, "persona-photographer-render");
    assert.equal(result.metadata.atlasZoneSurfaceKey, surfaceKey);
    assert.equal(result.metadata.sourcePanelStoragePath, panelPaths[surfaceKey]);

    // The four retired-path keys the fence refuses, plus the continuity key.
    for (const retired of [
      "driverContentHash", "deterministicMirror", "passengerProducer",
      "atlasZonePassedToPassengerRepair", "atlasDriverContinuityOnly",
    ]) {
      assert.equal(result.metadata[retired], undefined,
        `${sourceViewType} carries the retired key ${retired}`);
    }
  }
  assert.equal(f.posts.length, 7, "seven shots, seven renders — no mirror, no repair pass");
});

test("a proof whose bytes do not match the photographer's reported hash is refused", async () => {
  const proofBytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#000000" } })
    .png().toBuffer();
  const panelPaths = { driver: "designpro/panels/driver.png" };
  const f = transportFixture({ proofBytes, panelPaths });
  const provider = createAtlasDesignPanelProvider({
    // The store hands back DIFFERENT bytes than the function reported.
    supabase: {
      ...f.supabase,
      storage: { from: () => ({ download: async () => ({ data: new Blob([Buffer.from("tampered")]), error: null }) }) },
    },
    supabaseUrl: "https://example.supabase.co",
    serviceRoleKey: "s".repeat(64),
    fetchImpl: f.fetchImpl,
    provider: { models: ["gemini-3-pro-image"], keyCount: 1, generateImage: async () => { throw new Error("the transport must not generate images itself"); } },
    requestId: REQUEST_ID,
    generationId: GENERATION_ID,
    tenantKey: TENANT_KEY,
    input: { finish: "Gloss", vehicle: { year: "2024", make: "Ford", model: "F-250", type: "truck" } },
    atlas: f.atlas,
  });
  await assert.rejects(
    () => provider.generateImage({ sourceViewType: "side", attempt: 1 }),
    (error) => error?.code === "designpanel_atlas_proof_hash_mismatch",
  );
});

/**
 * REAL GEOMETRY, REAL CUTS: EACH PROOF VIEW RESOLVES TO ITS OWN PERSISTED PANEL.
 *
 * This used to drive `buildAtlasProjectionRequest` and assert the runtime's own
 * conditioning gate. The photographer is the producer now, and what it is sent
 * is a STORAGE PATH plus a hash -- so the gate that matters is the resolver
 * that picks which panel belongs to which shot. It is exercised here against a
 * master that was actually cut, not a hand-built fixture, because a
 * surface-to-shot mix-up is invisible in prose and obvious in geometry.
 */
test("every proof view resolves to its own surface's persisted panel, or fails closed", async () => {
  const panelSurfaces = [
    ["driver", 190, 66], ["passenger", 190, 66], ["hood", 68, 62],
    ["roof", 76, 96], ["front", 84, 34], ["rear", 82, 48],
  ].map(([surfaceKey, widthInches, heightInches]) => ({
    surfaceKey, widthInches, heightInches,
    bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  }));
  const manifest = flatFirst.buildAtlasManifest(panelSurfaces);
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
  const masterHash = flatFirst._test.sha256(masterBytes);
  const cut = await flatFirst.cutCallOnePanels(masterBytes, manifest, masterHash);

  // The revision's own panel records, exactly as `generateOrReuseFlatAtlas`
  // writes them: a storage path per surface plus that panel's content hash.
  const callOnePanels = cut.map((panel) => ({
    surfaceKey: panel.surfaceKey,
    storagePath: `designpro/${TENANT_KEY}/${GENERATION_ID}/flat-first/v1/revisions/1/panels/${panel.contentHash}.png`,
    contentHash: panel.contentHash,
    contentType: panel.contentType,
    sourceMasterHash: masterHash,
  }));
  const atlas = { callOnePanels, master: { contentHash: masterHash } };

  const expected = {
    side: "driver", "passenger-side": "passenger", hood_detail: "hood",
    front: "front", rear: "rear", roof: "roof",
    // The detail shot is a crop of the driver flank, by design.
    "close-up": "driver",
  };
  const seen = new Map();
  for (const [sourceViewType, surfaceKey] of Object.entries(expected)) {
    const panel = flatFirst.atlasPanelForProofView(atlas, sourceViewType);
    assert.equal(panel.surfaceKey, surfaceKey, `${sourceViewType} resolved to ${panel.surfaceKey}`);
    assert.match(panel.contentHash, /^[0-9a-f]{64}$/);
    assert.equal(panel.sourceMasterHash, masterHash, "every panel names the one master it was cut from");
    assert.ok(panel.storagePath.includes(panel.contentHash), "the path is content-addressed to that panel");
    seen.set(surfaceKey, panel.contentHash);
  }
  // Six distinct surfaces, six distinct panels. Driver and passenger are cut
  // from opposite flanks of the sheet, so they must not collide.
  assert.equal(new Set(seen.values()).size, 6, "two surfaces resolved to the same panel");

  // FAIL CLOSED. A proof whose panel has not landed yet has no artwork
  // authority, and asking the photographer to render it anyway would be asking
  // it to invent the design. Retryable: `panel.ready(surface)` is what releases
  // that surface's proof, and it may simply not have fired yet.
  const missingRoof = { ...atlas, callOnePanels: callOnePanels.filter((p) => p.surfaceKey !== "roof") };
  assert.throws(
    () => flatFirst.atlasPanelForProofView(missingRoof, "roof"),
    (error) => error?.code === "flat_atlas_proof_panel_unavailable" && error.retryable === true,
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

/**
 * ⛔ TWO TESTS WERE REMOVED HERE WITH THE PRODUCER THEY DROVE.
 *
 * "Atlas keeps the exact passenger and close-up view clauses without
 * introducing a hero view" and "Atlas verifies the exact zone hash and fails
 * closed before a request can exceed Gemini 20 MiB" both called
 * `buildAtlasProjectionPrompt` / `buildAtlasProjectionRequest`, which are
 * deleted (owner, 2026-08-28).
 *
 * Neither property is unguarded:
 *   - view clauses + no hero  -> the byte pin on `view-angles-os`, plus the
 *     "hero is removed" assertion, in `proof-stack-pinned-sources.test.mjs`.
 *   - exact zone hash, fail closed -> `atlasPanelForProofView` above (a missing
 *     panel throws `flat_atlas_proof_panel_unavailable`), the transport's
 *     `designpanel_atlas_proof_hash_mismatch`, and the edge function's own
 *     `atlas_proof_panel_hash_mismatch` on the panel it downloads.
 *   - the 20 MiB request bound is no longer this process's problem: the
 *     transport sends a storage PATH, not the image bytes.
 */
