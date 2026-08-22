import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  assertAtlasViewLineage,
  runAtlasProofStages,
} = require("../runtime/generation-worker.cjs");
const {
  buildAtlasProjectionPrompt,
} = require("../runtime/designpanel-server-provider.cjs");
const angles = require("../runtime/view-angles.cjs");

const WORKER_SOURCE = readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");
const PROVIDER_SOURCE = readFileSync(new URL("../runtime/designpanel-server-provider.cjs", import.meta.url), "utf8");

function stageResult(sourceViewTypes, overrides = {}) {
  return {
    state: "outputs_ready",
    providerCalls: sourceViewTypes.length,
    budget: sourceViewTypes.length,
    results: sourceViewTypes.map((sourceViewType) => ({ sourceViewType, state: "accepted" })),
    requiresExplicitResume: false,
    ...overrides,
  };
}

const ZONE_SURFACE_BY_VIEW = Object.freeze({
  side: "driver", "passenger-side": "passenger", hood_detail: "hood",
  front: "front", rear: "rear", "close-up": "driver", roof: "roof",
});
const VIEW_AUTHORITIES = Object.freeze(Object.fromEntries(Object.entries(ZONE_SURFACE_BY_VIEW)
  .map(([sourceViewType, surfaceKey]) => {
    const bytes = Buffer.from(`exact-${surfaceKey}-zone`);
    return [sourceViewType, Object.freeze({
      contract: "designpro.flat-first-atlas-view-authority.v1",
      sourceViewType,
      surfaceKey,
      bytes,
      byteSize: bytes.length,
      contentType: "image/jpeg",
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      sourceMasterHash: "a".repeat(64),
    })];
  })));

const FLAT_ATLAS = Object.freeze({
  contract: "designpro.flat-first-atlas.v1",
  promptVersion: "designpro-flat-first-atlas-20260822.v4",
  revisionId: "11111111-1111-4111-8111-111111111111",
  revisionSequence: 1,
  master: { contentHash: "a".repeat(64) },
  projection: { contentHash: "b".repeat(64) },
  manifestAsset: { contentHash: "c".repeat(64) },
  viewAuthorities: VIEW_AUTHORITIES,
  masterAcceptance: Object.freeze({
    passed: true,
    contract: "designpro.atlas-master-semantic-qc.v1",
    confidence: 0.98,
    promptHash: "8".repeat(64),
    providerContract: "designpro.flat-first-master-provider.v1",
    artboardPortVersion: "designpanel-ai-generate.artboard.20260822.v1",
  }),
});

const ROLE_BY_VIEW = Object.freeze({
  side: "driver", "passenger-side": "passenger", hood_detail: "hood",
  front: "front", rear: "rear", "close-up": "closeup", roof: "roof",
});
const LABEL_BY_VIEW = Object.freeze({
  side: "Driver", "passenger-side": "Passenger", hood_detail: "Hood",
  front: "Front", rear: "Rear", "close-up": "Close-Up", roof: "Roof",
});

function atlasView(sourceViewType, contentHash, driverHash = null) {
  const dependent = sourceViewType !== "side";
  const zone = VIEW_AUTHORITIES[sourceViewType];
  return {
    sourceViewType,
    consumerRole: ROLE_BY_VIEW[sourceViewType],
    contentHash,
    metadata: {
      providerContract: "designpro.atlas-designpanel-server-provider.v1",
      provider: {
        contract: "designpro.generation-artifact-audit.v1",
        sourceViewType,
        renderMethod: sourceViewType === "passenger-side" ? "producePassengerView" : "generate-color-render",
        promptHash: "9".repeat(64),
        promptLength: 4000,
        studioContractVersion: "designpro.studio-os.port-ab0f0638.v1",
        viewAngleContractVersion: "designpro.view-angles-os.port-ab0f0638.v1",
        photographyContractVersion: "designpro.photorealism-prompt.port.v1",
        stage: "generate-color-render",
        execution: "server-native",
        anchoredToFlatAtlas: true,
        atlasConditioningVerified: true,
        atlasMasterContentHash: FLAT_ATLAS.master.contentHash,
        atlasProjectionContentHash: FLAT_ATLAS.projection.contentHash,
        atlasManifestContentHash: FLAT_ATLAS.manifestAsset.contentHash,
        atlasRevisionId: FLAT_ATLAS.revisionId,
        atlasRevisionSequence: FLAT_ATLAS.revisionSequence,
        atlasZoneContract: zone.contract,
        atlasZoneContentHash: zone.contentHash,
        atlasZoneSurfaceKey: zone.surfaceKey,
        anchoredToView1: dependent,
        ...(dependent ? { driverContentHash: driverHash } : {}),
        ...(sourceViewType === "passenger-side"
          ? {
              passengerProducer: "producePassengerView",
              deterministicMirror: true,
              atlasZonePassedToPassengerRepair: true,
            }
          : {}),
      },
      validation: {
        contract: "designpro.atlas-proof-semantic-qc.v1",
        expectedView: LABEL_BY_VIEW[sourceViewType],
        proofHash: contentHash,
        atlasHash: FLAT_ATLAS.projection.contentHash,
        authorityHash: zone.contentHash,
        zoneHash: zone.contentHash,
        zoneSurfaceKey: zone.surfaceKey,
        confidence: 0.97,
      },
      authority: {
        contract: FLAT_ATLAS.contract,
        revisionId: FLAT_ATLAS.revisionId,
        revisionSequence: FLAT_ATLAS.revisionSequence,
        masterContentHash: FLAT_ATLAS.master.contentHash,
        projectionContentHash: FLAT_ATLAS.projection.contentHash,
        projectionSourceMasterHash: FLAT_ATLAS.master.contentHash,
        manifestContentHash: FLAT_ATLAS.manifestAsset.contentHash,
        zoneContract: zone.contract,
        zoneContentHash: zone.contentHash,
        zoneSurfaceKey: zone.surfaceKey,
      },
    },
  };
}

test("generation-worker selects the Atlas DesignPanel provider and has no generic parallel Atlas branch", () => {
  assert.match(WORKER_SOURCE, /createAtlasDesignPanelProvider/);
  assert.match(WORKER_SOURCE, /atlasProviderFactory\s*=\s*createAtlasDesignPanelProvider/);
  assert.match(WORKER_SOURCE, /const atlasProvider = isFlatFirst \? atlasProviderFactory\(/);
  assert.match(WORKER_SOURCE, /provider:\s*atlasProvider/);
  assert.match(WORKER_SOURCE, /atlasProofValidatorFactory\s*=\s*createAtlasProofValidator/);
  assert.match(WORKER_SOURCE, /provider:\s*imageProvider,[\s\S]{0,200}atlas:\s*flatAtlas/);
  assert.match(WORKER_SOURCE, /\{ \.\.\.slot, validate: atlasProofValidator \}/);

  const atlasExecution = WORKER_SOURCE.slice(
    WORKER_SOURCE.indexOf("if (isFlatFirst) {", WORKER_SOURCE.indexOf("const slots = slotsFrom")),
    WORKER_SOURCE.indexOf("} else {", WORKER_SOURCE.indexOf("if (isFlatFirst) {", WORKER_SOURCE.indexOf("const slots = slotsFrom"))),
  );
  assert.match(atlasExecution, /runAtlasProofStages/);
  assert.doesNotMatch(atlasExecution, /provider:\s*imageProvider/);
  assert.doesNotMatch(atlasExecution, /parallel:\s*true/);
});

test("Atlas executes Driver, verifies its persisted identity, then runs the remaining six sequentially", async () => {
  const slots = angles.viewOrder().map((sourceViewType) => ({ sourceViewType }));
  assert.deepEqual(slots.map((slot) => slot.sourceViewType), [
    "side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof",
  ]);

  const events = [];
  const atlasProvider = {
    maxProviderAttempts: 4,
    generateImage: async () => { throw new Error("engine owns provider invocation"); },
    hydrateDriver: async () => {
      events.push("driver-hash-verified");
      return { contentHash: "a".repeat(64) };
    },
  };
  const runRequest = async (request) => {
    assert.equal(request.provider, atlasProvider);
    assert.equal(request.parallel, false, "Atlas may never ask the engine for parallel proof calls");
    assert.equal(request.maxProviderAttempts, 4);
    assert.equal(request.allowOrphanReconciliation, false, "Atlas must not adopt anonymous storage bytes");
    const views = request.slots.map((slot) => slot.sourceViewType);
    events.push(`run:${views.join(",")}`);
    if (events.length === 1) {
      assert.deepEqual(views, ["side"], "Driver must be the isolated first projection");
      return stageResult(views);
    }
    assert.deepEqual(views, ["passenger-side", "hood_detail", "front", "rear", "close-up", "roof"]);
    return stageResult(views);
  };

  const result = await runAtlasProofStages({
    runRequest,
    requestId: "request",
    generationId: "generation",
    tenantKey: "tenant",
    provider: atlasProvider,
    store: {},
    slots,
  });

  assert.deepEqual(events, [
    "run:side",
    "driver-hash-verified",
    "run:passenger-side,hood_detail,front,rear,close-up,roof",
  ]);
  assert.equal(result.state, "outputs_ready");
  assert.equal(result.providerCalls, 7);
  assert.equal(result.results.length, 7);
});

test("Atlas accepts only seven proofs from one immutable master and active Driver", () => {
  const driverHash = "d".repeat(64);
  const views = angles.viewOrder().map((sourceViewType, index) => atlasView(
    sourceViewType,
    index === 0 ? driverHash : String(index + 1).repeat(64).slice(0, 64),
    driverHash,
  ));
  assert.equal(assertAtlasViewLineage({ views, flatAtlas: FLAT_ATLAS, requireComplete: true }), true);
});

test("Atlas refuses generic accepted rows and dependents from a previous Driver", () => {
  const driverHash = "d".repeat(64);
  const generic = atlasView("side", driverHash);
  delete generic.metadata.providerContract;
  delete generic.metadata.provider.anchoredToFlatAtlas;
  assert.throws(
    () => assertAtlasViewLineage({ views: [generic], flatAtlas: FLAT_ATLAS }),
    (error) => error.code === "generation_atlas_lineage_invalid" && /server Atlas projection/.test(error.message),
  );

  const driver = atlasView("side", driverHash);
  const stalePassenger = atlasView("passenger-side", "e".repeat(64), "f".repeat(64));
  assert.throws(
    () => assertAtlasViewLineage({ views: [driver, stalePassenger], flatAtlas: FLAT_ATLAS }),
    (error) => error.code === "generation_atlas_lineage_invalid" && /active Driver/.test(error.message),
  );
});

test("Atlas refuses a dependent proof without Driver and any Hero slot", () => {
  assert.throws(
    () => assertAtlasViewLineage({
      views: [atlasView("roof", "e".repeat(64), "d".repeat(64))],
      flatAtlas: FLAT_ATLAS,
    }),
    /without an active Driver/,
  );
  assert.throws(
    () => assertAtlasViewLineage({
      views: [{ sourceViewType: "hero-3d", consumerRole: "hero3d", contentHash: "f".repeat(64), metadata: {} }],
      flatAtlas: FLAT_ATLAS,
    }),
    /unrecognized active view hero-3d/,
  );
});

test("Atlas stops after a failed Driver and never starts Passenger or another camera", async () => {
  const events = [];
  const provider = {
    maxProviderAttempts: 4,
    generateImage: async () => {},
    hydrateDriver: async () => { events.push("hydrate"); return {}; },
  };
  const failed = stageResult(["side"], {
    state: "failed",
    results: [{ sourceViewType: "side", state: "failed" }],
    requiresExplicitResume: true,
  });
  const result = await runAtlasProofStages({
    runRequest: async ({ slots, parallel }) => {
      events.push(`run:${slots.map((slot) => slot.sourceViewType).join(",")}:${parallel}`);
      return failed;
    },
    requestId: "request",
    generationId: "generation",
    tenantKey: "tenant",
    provider,
    store: {},
    slots: angles.viewOrder().map((sourceViewType) => ({ sourceViewType })),
  });
  assert.equal(result, failed);
  assert.deepEqual(events, ["run:side:false"]);
});

test("Atlas does not advance past a Driver leased by another worker", async () => {
  const events = [];
  const provider = {
    maxProviderAttempts: 4,
    generateImage: async () => {},
    hydrateDriver: async () => { events.push("hydrate"); return {}; },
  };
  const pending = stageResult(["side"], {
    state: "pending",
    providerCalls: 0,
    results: [{ sourceViewType: "side", state: "leased_elsewhere" }],
  });
  const result = await runAtlasProofStages({
    runRequest: async ({ slots, parallel }) => {
      events.push(`run:${slots.map((slot) => slot.sourceViewType).join(",")}:${parallel}`);
      return pending;
    },
    requestId: "request",
    generationId: "generation",
    tenantKey: "tenant",
    provider,
    store: {},
    slots: angles.viewOrder().map((sourceViewType) => ({ sourceViewType })),
  });

  assert.equal(result, pending);
  assert.equal(result.state, "pending");
  assert.deepEqual(events, ["run:side:false"]);
});

test("Atlas cannot finalize when a later proof slot is leased elsewhere", async () => {
  const events = [];
  const provider = {
    maxProviderAttempts: 4,
    generateImage: async () => {},
    hydrateDriver: async () => {
      events.push("driver-hash-verified");
      return { contentHash: "a".repeat(64) };
    },
  };
  let stage = 0;
  const result = await runAtlasProofStages({
    runRequest: async ({ slots, parallel }) => {
      stage += 1;
      const views = slots.map((slot) => slot.sourceViewType);
      events.push(`run:${views.join(",")}:${parallel}`);
      if (stage === 1) return stageResult(views);
      return stageResult(views, {
        state: "pending",
        providerCalls: 5,
        results: views.map((sourceViewType, index) => ({
          sourceViewType,
          state: index === views.length - 1 ? "leased_elsewhere" : "accepted",
        })),
      });
    },
    requestId: "request",
    generationId: "generation",
    tenantKey: "tenant",
    provider,
    store: {},
    slots: angles.viewOrder().map((sourceViewType) => ({ sourceViewType })),
  });

  assert.equal(result.state, "pending");
  assert.equal(result.results.length, 7);
  assert.equal(result.results.at(-1).state, "leased_elsewhere");
  assert.deepEqual(events, [
    "run:side:false",
    "driver-hash-verified",
    "run:passenger-side,hood_detail,front,rear,close-up,roof:false",
  ]);
});

test("Atlas provider carries locked angles, photography, Studio OS lighting, deterministic Passenger and pickup roof exclusion", () => {
  const input = {
    brief: "photographic pool wrap with Flamingo Pools logo",
    finish: "Gloss",
    vehicle: { year: "2024", make: "Ford", model: "F-250", type: "truck" },
  };
  const driver = buildAtlasProjectionPrompt({ input, sourceViewType: "side", hasDriverAnchor: false });
  const passenger = buildAtlasProjectionPrompt({ input, sourceViewType: "passenger-side", hasDriverAnchor: true });
  const roof = buildAtlasProjectionPrompt({ input, sourceViewType: "roof", hasDriverAnchor: true });

  assert.match(driver, /PERFECTLY STRAIGHT side-on elevation/);
  assert.match(driver, /DARK EPOXY WITH MIRROR REFLECTIONS/);
  assert.match(driver, /Canon EOS R5, RF 24-70mm/);
  assert.match(driver, /design-panel-ai-generate flat master/);
  assert.match(driver, /generate-color-render photography stage/);
  assert.match(passenger, /vehicle faces RIGHT in frame \(nose pointing right\)/);
  assert.match(passenger, /NEVER mirrored/);
  assert.match(roof, /CAB ROOF ONLY/);
  assert.match(roof, /cargo bed\/box.*must be outside the frame/is);
  assert.match(roof, /open bed interior stays bare factory bedliner/i);

  assert.match(PROVIDER_SOURCE, /sourceViewType === PASSENGER_VIEW/);
  assert.match(PROVIDER_SOURCE, /producePassengerView\(\{/);
  assert.match(PROVIDER_SOURCE, /atlasZonePassedToPassengerRepair:\s*true/);
  assert.match(PROVIDER_SOURCE, /exact accepted PASSENGER native-zone crop/);
});
