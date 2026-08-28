import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const worker = require("../runtime/generation-worker.cjs");
const {
  assertAtlasViewLineage,
  runAtlasProofStages,
} = worker;
const {
} = require("../runtime/designpanel-server-provider.cjs");
const angles = require("../runtime/view-angles.cjs");
// Track the shipped contract rather than a literal: a prompt-version bump is
// supposed to invalidate stale masters, so pinning the string here turns that
// working mechanism into a fixture failure on every legitimate bump.
const { PROMPT_VERSION } = require("../runtime/flat-first-atlas.cjs");
// Same reason for the DesignPanel creative port: it carries its own version so
// the creative half and the topology half can move independently, and a bump on
// either is meant to retire stale masters rather than to break this fixture.
const { DESIGNPANEL_ARTBOARD_PORT_VERSION } = require("../runtime/designiq-prompt.cjs");

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
      // The proof's artwork authority IS this surface's extracted panel, so it
      // carries that panel's hash and `viewAuthorityFor` checks it against the
      // revision's own panel record (owner 2026-08-27).
      panelContentHash: createHash("sha256").update(`panel-${surfaceKey}`).digest("hex"),
      panelByteSize: 4096,
    })];
  })));

const FLAT_ATLAS = Object.freeze({
  contract: "designpro.flat-first-atlas.v1",
  promptVersion: PROMPT_VERSION,
  revisionId: "11111111-1111-4111-8111-111111111111",
  revisionSequence: 1,
  master: { contentHash: "a".repeat(64) },
  // A clean sheet: the proof-conditioning derivative is the child of the
  // canonical master itself, so the surface source and the master agree. On a
  // sheet that arrived with cut-outs this is the repaired duplicate's hash --
  // the same bytes the six panels are cut from.
  projection: { contentHash: "b".repeat(64), sourceMasterHash: "a".repeat(64) },
  manifestAsset: { contentHash: "c".repeat(64) },
  viewAuthorities: VIEW_AUTHORITIES,
  // The persisted Call-1 panels, with the storage identity a proof's artwork
  // authority is resolved through. `atlasPanelForProofView` refuses a panel
  // that has no path or no hash, because a proof cannot be bound to an
  // artifact that does not exist yet.
  callOnePanels: Object.freeze([...new Set(Object.values(ZONE_SURFACE_BY_VIEW))].map((surfaceKey) => Object.freeze({
    surfaceKey,
    contentHash: createHash("sha256").update(`panel-${surfaceKey}`).digest("hex"),
    storagePath: `designpro/tenant/generation/flat-first/v1/revisions/1/panels/${surfaceKey}.png`,
    contentType: "image/png",
    sourceMasterHash: "a".repeat(64),
  }))),
  masterAcceptance: Object.freeze({
    passed: true,
    contract: "designpro.atlas-master-semantic-qc.v1",
    confidence: 0.98,
    promptHash: "8".repeat(64),
    providerContract: "designpro.flat-first-master-provider.v1",
    artboardPortVersion: DESIGNPANEL_ARTBOARD_PORT_VERSION,
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

function atlasView(sourceViewType, contentHash, extraProvider = {}) {
  const zone = VIEW_AUTHORITIES[sourceViewType];
  return {
    sourceViewType,
    consumerRole: ROLE_BY_VIEW[sourceViewType],
    contentHash,
    metadata: {
      providerContract: "designpro.atlas-designpanel-server-provider.v1",
      provider: {
        sourceViewType,
        // THE DEPLOYED PHOTOGRAPHER IS THE PRODUCER (RULE 0.29 / #232). The
        // retired in-runtime projection stamped a prompt hash and the
        // studio/angle/photorealism contract versions; the photographer stamps
        // its own function identity, its pinned source commit, and the single
        // image request it made.
        stage: "persona-photographer-render",
        execution: "edge-photographer",
        proofProducer: "persona-photographer-render",
        proofContract: "designpro.atlas-photographer-proof.v1",
        proofSourceCommit: "113d137dbe8813ca3bf70c8d7265ad081ebd4524",
        proofRequestId: "94b78e73-41e6-4a59-a579-dd87d38029ef",
        proofProvider: "google",
        proofModel: "gemini-3-pro-image",
        proofImageRequestCount: 1,
        anchoredToFlatAtlas: true,
        atlasConditioningVerified: true,
        atlasMasterContentHash: FLAT_ATLAS.master.contentHash,
        atlasProjectionContentHash: FLAT_ATLAS.projection.contentHash,
        atlasManifestContentHash: FLAT_ATLAS.manifestAsset.contentHash,
        atlasRevisionId: FLAT_ATLAS.revisionId,
        atlasRevisionSequence: FLAT_ATLAS.revisionSequence,
        // The artwork authority is the surface's persisted panel, not a crop
        // of the master (RULE 0.28 §6).
        atlasZoneContract: "designpro.atlas-panel-authority.v1",
        atlasZoneContentHash: zone.panelContentHash,
        atlasZoneSurfaceKey: zone.surfaceKey,
        sourcePanelHash: zone.panelContentHash,
        // SIX SIBLING SURFACES (8576619a, owner-approved): every view is
        // projected directly from the flat master. The four retired-path keys
        // are injected only by the refusal tests below, via extraProvider.
        anchoredToView1: false,
        ...extraProvider,
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
});

test("A.T.L.A.S. fans all six surfaces out together, with Driver dispatched first", async () => {
  // PRIORITY, NOT PREREQUISITE. Driver used to render alone and gate the rest,
  // and Passenger was built by mirroring Driver's pixels. One slow Driver
  // stalled the set; one bad Driver killed it; and Passenger inherited a defect
  // repair could not fix (a6dd78aa passengerMirrorMae=0.29343, fc2f2e80
  // upside-down passenger lettering). The master is frozen and hash-bound
  // before this runs, so the six surfaces are siblings.
  const slots = angles.viewOrder().map((sourceViewType) => ({ sourceViewType }));
  assert.deepEqual(slots.map((slot) => slot.sourceViewType), [
    "side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof",
  ]);

  const events = [];
  const atlasProvider = {
    maxProviderAttempts: 4,
    generateImage: async () => { throw new Error("engine owns provider invocation"); },
    hydrateDriver: async () => { events.push("driver-hash-verified"); return { contentHash: "a".repeat(64) }; },
  };
  const runRequest = async (request) => {
    assert.equal(request.provider, atlasProvider);
    assert.equal(request.maxProviderAttempts, 4);
    assert.equal(request.allowOrphanReconciliation, false, "Atlas must not adopt anonymous storage bytes");
    const views = request.slots.map((slot) => slot.sourceViewType);
    events.push(`run:${views.join(",")}`);
    assert.equal(request.parallel, true, "every surface starts together");
    return stageResult(views);
  };

  const result = await runAtlasProofStages({
    runRequest, requestId: "request", generationId: "generation",
    tenantKey: "tenant", provider: atlasProvider, store: {}, slots,
  });

  // ONE dispatch carrying all seven, Driver first in the array. Promise.all
  // issues in order, so Driver's provider call goes out first and it is still
  // what the customer sees first (RULE 0.23) -- without gating anything.
  assert.deepEqual(events, ["run:side,passenger-side,hood_detail,front,rear,close-up,roof"]);
  assert.equal(events.includes("driver-hash-verified"), false,
    "no surface may wait on a Driver hash before it can start");
  assert.equal(result.state, "outputs_ready");
  assert.equal(result.providerCalls, 7);
  assert.equal(result.results.length, 7);
});

test("Atlas accepts seven sibling proofs, continuity-only reference included", () => {
  const views = angles.viewOrder().map((sourceViewType, index) => atlasView(
    sourceViewType,
    index === 0 ? "d".repeat(64) : String(index + 1).repeat(64).slice(0, 64),
    // The continuity-only Driver photograph (owner decision 2026-08-26) is a
    // different mechanism from the retired anchor, named so it can never be
    // confused with artwork authority -- and it must pass this gate.
    sourceViewType === "side" ? {} : {
      atlasDriverContinuityOnly: true,
      atlasDriverContinuityReferenceHash: "c".repeat(64),
    },
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
    (error) => error.code === "generation_atlas_lineage_invalid" && /pinned photographer stage/.test(error.message),
  );

  // Any of the four retired anchor/mirror keys is refused on ANY view --
  // byte-for-byte the database fence's rule, so the worker assert and
  // designpro_private.flat_first_atlas_view_set_valid can no longer
  // contradict each other. (They did: the fence refused driverContentHash
  // while this assert REQUIRED it, so no seven-view set could satisfy both
  // and no 7/7 run could ever have completed.)
  for (const retired of [
    { driverContentHash: "f".repeat(64) },
    { deterministicMirror: true },
    { passengerProducer: "producePassengerView" },
    { atlasZonePassedToPassengerRepair: true },
    { anchoredToView1: true },
  ]) {
    const poisoned = atlasView("passenger-side", "e".repeat(64), retired);
    assert.throws(
      () => assertAtlasViewLineage({ views: [poisoned], flatAtlas: FLAT_ATLAS }),
      (error) => error.code === "generation_atlas_lineage_invalid"
        && /projected directly from the flat master/.test(error.message),
      `a view carrying ${Object.keys(retired)[0]} must be refused`,
    );
  }
});

test("Atlas accepts a partial sibling set mid-flight, and refuses any Hero slot", () => {
  // The seven slots launch together, so a sibling can legitimately persist
  // before Driver; a crash-recovery claim must not convict it. A COMPLETE set
  // still requires all seven, Driver included.
  assert.equal(
    assertAtlasViewLineage({ views: [atlasView("roof", "e".repeat(64))], flatAtlas: FLAT_ATLAS }),
    true,
  );
  assert.throws(
    () => assertAtlasViewLineage({
      views: [atlasView("roof", "e".repeat(64))], flatAtlas: FLAT_ATLAS, requireComplete: true,
    }),
    /expected exactly seven active proofs/,
  );
  assert.throws(
    () => assertAtlasViewLineage({
      views: [{ sourceViewType: "hero-3d", consumerRole: "hero3d", contentHash: "f".repeat(64), metadata: {} }],
      flatAtlas: FLAT_ATLAS,
    }),
    /unrecognized active view hero-3d/,
  );
});

test("a failed Driver no longer takes the other five surfaces down with it", async () => {
  // The whole point of the fan-out: Driver is priority, not prerequisite.
  const events = [];
  const provider = {
    maxProviderAttempts: 4,
    generateImage: async () => {},
    hydrateDriver: async () => { events.push("hydrate"); return {}; },
  };
  const views = angles.viewOrder();
  const result = await runAtlasProofStages({
    runRequest: async ({ slots, parallel }) => {
      events.push(`run:${slots.map((slot) => slot.sourceViewType).join(",")}:${parallel}`);
      // Driver fails; every other surface still renders.
      const results = slots.map((slot) => ({
        sourceViewType: slot.sourceViewType,
        state: slot.sourceViewType === "side" ? "failed" : "accepted",
      }));
      return { state: "failed", providerCalls: slots.length, budget: slots.length * 4, results };
    },
    requestId: "request", generationId: "generation", tenantKey: "tenant",
    provider, store: {}, slots: views.map((sourceViewType) => ({ sourceViewType })),
  });

  assert.deepEqual(events, [`run:${views.join(",")}:true`],
    "all seven are dispatched in one parallel call even though Driver fails");
  assert.equal(events.includes("hydrate"), false);
  // The request is still failed -- a missing Driver is not a complete set --
  // but the other five completed and are not discarded.
  assert.equal(result.state, "failed");
  assert.equal(result.results.filter((item) => item.state === "accepted").length, 6,
    "the five other surfaces plus Close-Up must survive a failed Driver");
});

test("a Driver leased by another worker leaves the run pending without double-claiming", async () => {
  // Per-slot leasing already prevents two workers rendering the same surface,
  // so a Driver held elsewhere no longer has to stop the others -- it simply
  // is not this worker's to claim.
  const events = [];
  const provider = {
    maxProviderAttempts: 4,
    generateImage: async () => {},
    hydrateDriver: async () => { events.push("hydrate"); return {}; },
  };
  const views = angles.viewOrder();
  const pending = {
    state: "pending", providerCalls: 0, budget: views.length * 4,
    results: views.map((sourceViewType) => ({
      sourceViewType,
      state: sourceViewType === "side" ? "leased_elsewhere" : "accepted",
    })),
  };
  const result = await runAtlasProofStages({
    runRequest: async ({ slots, parallel }) => {
      events.push(`run:${slots.map((slot) => slot.sourceViewType).join(",")}:${parallel}`);
      return pending;
    },
    requestId: "request", generationId: "generation", tenantKey: "tenant",
    provider, store: {}, slots: views.map((sourceViewType) => ({ sourceViewType })),
  });

  assert.equal(result, pending);
  assert.equal(result.state, "pending", "a leased slot keeps the request unfinished");
  assert.deepEqual(events, [`run:${views.join(",")}:true`]);
  assert.equal(events.includes("hydrate"), false);
});

test("Atlas cannot finalize while any surface is still leased elsewhere", async () => {
  // Unchanged guarantee, single dispatch: one unfinished surface keeps the whole
  // request pending, so a partial set can never be reported as complete.
  const events = [];
  const provider = {
    maxProviderAttempts: 4,
    generateImage: async () => {},
    hydrateDriver: async () => { events.push("driver-hash-verified"); return { contentHash: "a".repeat(64) }; },
  };
  const views = angles.viewOrder();
  const result = await runAtlasProofStages({
    runRequest: async ({ slots, parallel }) => {
      const seen = slots.map((slot) => slot.sourceViewType);
      events.push(`run:${seen.join(",")}:${parallel}`);
      return stageResult(seen, {
        state: "pending",
        providerCalls: 6,
        results: seen.map((sourceViewType, index) => ({
          sourceViewType,
          state: index === seen.length - 1 ? "leased_elsewhere" : "accepted",
        })),
      });
    },
    requestId: "request", generationId: "generation", tenantKey: "tenant",
    provider, store: {}, slots: views.map((sourceViewType) => ({ sourceViewType })),
  });

  assert.equal(result.state, "pending");
  assert.equal(result.results.length, 7);
  assert.equal(result.results.at(-1).state, "leased_elsewhere");
  assert.deepEqual(events, [`run:${views.join(",")}:true`]);
});

test("the A.T.L.A.S. proof path keeps no producer of its own, and no mirror chain", () => {
  // ⛔ THIS TEST USED TO READ `buildAtlasProjectionPrompt`'S TEXT.
  //
  // It asserted the locked side elevation, the Studio OS epoxy floor, the Canon
  // body, the passenger nose direction and the pickup cab-roof exclusion --
  // all by reading a prompt this runtime assembled. That producer is deleted
  // (owner, 2026-08-28), so those strings are no longer this repository's to
  // assert: they belong to the byte-pinned `view-angles-os` and `studio-os`,
  // which `tests/proof-stack-pinned-sources.test.mjs` pins and which
  // `tests/proof-camera-authority.test.mjs` reads directly.
  //
  // What remains here is the half that was never about the prompt.
  // THE MIRROR CHAIN IS UNREACHABLE FROM A.T.L.A.S.
  //
  // Passenger is a sibling surface rendered from its own A.T.L.A.S. authority,
  // exactly like Hood/Front/Rear/Roof. The Standard (non-A.T.L.A.S.) provider
  // keeps its own passenger mirror -- that pipeline is untouched -- so this
  // asserts the ATLAS branch specifically.
  // Bounded to the A.T.L.A.S. generateImage body: the module still EXPORTS
  // producePassengerView because the Standard provider legitimately uses it,
  // and slicing to end-of-file would read that export list as a call site.
  const atlasBranch = PROVIDER_SOURCE.slice(
    PROVIDER_SOURCE.indexOf("THE PROVEN PHOTOGRAPHER RENDERS EVERY A.T.L.A.S. PROOF"),
    PROVIDER_SOURCE.indexOf("hydrateDriver: driverStore.hydrateHero"),
  );
  assert.ok(atlasBranch.length > 500, "the A.T.L.A.S. branch slice must not be empty");
  assert.equal(atlasBranch.includes("producePassengerView"), false,
    "the A.T.L.A.S. path must not mirror Driver to manufacture Passenger");
  assert.equal(atlasBranch.includes("atlasZonePassedToPassengerRepair"), false,
    "there is no passenger repair pass to record");
  assert.equal(atlasBranch.includes("designpanel_server_driver_required"), false,
    "no surface may hard-require an accepted Driver");
  // Identity still comes from the shared master, per surface, hash-verified.
  assert.match(atlasBranch, /atlasZoneSurfaceKey/);
  assert.match(atlasBranch, /atlasConditioningVerified:\s*true/);
});

/**
 * CALL 1 SIZES THE 3D CALLS.
 *
 * Call 1 resolves every side's dimensions and cuts the six panels to them. If
 * those dimensions never reach the projection prompt, each 3D side is rendered
 * at whatever proportion the model assumes and the proof disagrees with the
 * panel the customer is about to buy. This is deterministic input -- the camera
 * contract in view-angles.cjs is untouched.
 */
test("the Call-1 surface size is sent into the 3D projection prompt", () => {
  const flatAtlas = {
    callOnePanels: [
      { surfaceKey: "driver", trimWidthIn: 153, trimHeightIn: 56, printWidthIn: 163, printHeightIn: 66, surfaceSqFt: 59.5 },
      { surfaceKey: "hood", trimWidthIn: 71.5, trimHeightIn: 56, printWidthIn: 81.5, printHeightIn: 66, surfaceSqFt: 27.8 },
    ],
  };

  const driver = worker.projectionOnlyPromptFor({ vehicle: { make: "Ford", model: "F-250" } }, "side", "", flatAtlas);
  assert.match(driver.text, /SURFACE SIZE \(measured, not estimated\)/);
  assert.match(driver.text, /driver surface is 153in wide by 56in tall \(59\.5 sq ft\)/);
  assert.match(driver.text, /Do not stretch, squash, crop or re-fit/);

  const hood = worker.projectionOnlyPromptFor({ vehicle: {} }, "hood_detail", "", flatAtlas);
  assert.match(hood.text, /hood surface is 71\.5in wide by 56in tall/);

  // Close-Up is a design-detail proof, not one of the six printed surfaces, so
  // it has no panel and must not be handed a size it does not own.
  const closeup = worker.projectionOnlyPromptFor({ vehicle: {} }, "close-up", "", flatAtlas);
  assert.doesNotMatch(closeup.text, /SURFACE SIZE/);

  // An atlas with no recorded panels renders exactly as before rather than
  // emitting an empty or zeroed size clause.
  const unsized = worker.projectionOnlyPromptFor({ vehicle: {} }, "side", "", { callOnePanels: [] });
  assert.doesNotMatch(unsized.text, /SURFACE SIZE/);

  // And the atlas is actually threaded through the call the worker makes, so
  // the clause reaches the real projection rather than only this unit.
  const source = readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");
  assert.match(
    source,
    /projectionOnlyPromptFor\(input, sourceViewType, instruction, flatAtlas\)/,
    "conditionedPromptPartsFor must pass the atlas so the size clause is built",
  );
});

// THE CONCEPT SLOT CARRIES THE CUSTOMER'S WORDS, NOT A FORM DUMP.
//
// promptPartsFor passed designBrief(input) -- a key:value summary -- into the
// slot the prompt itself calls "THE CONCEPT -- the heart of this design; build
// everything around it". So the quotation marks meant to hold what the customer
// actually said held a form instead: an 80-character brief inflated to 516, with
// Business/Industry/Colors/Vehicle lines that buildDesignIQPrompt already emits
// from its own structured arguments. Measured on one real prompt, the business
// name appeared four times and the industry, vehicle and palette twice each.
//
// The reference interpolates the raw brief (design-panel-ai-generate/index.ts:480,
// `${prompt}` destructured from params at :297), which is the architecture's
// "nothing between the customer's words and A.C.E." stated as code.
test("The design concept slot receives the raw customer brief", () => {
  const brief = "Bright modern dental wrap for BrightSmiles, clean and friendly, blues and whites";
  const input = {
    brief,
    mode: "commercial",
    companyName: "BrightSmiles",
    website: "www.BrightSmiles.com",
    industry: "Dental",
    colors: ["blue", "white"],
    finish: "Gloss",
    vehicle: { year: "2025", make: "Ford", model: "Transit", type: "cargo van" },
  };
  const prompt = worker.promptPartsFor(input, "side")[0].text;

  const concept = prompt.slice(prompt.indexOf("THE CONCEPT"), prompt.indexOf("CLIENT BRIEF"));
  assert.ok(concept.includes(`"${brief}"`), "the customer's own words must be quoted verbatim");
  // The summary form's injected lines must not reappear inside the concept.
  for (const injected of ["Business: BrightSmiles", "Industry: Dental", "Colors: blue, white", "Vehicle: 2025 Ford"]) {
    assert.ok(!concept.includes(injected), `the concept slot must not carry the form line: ${injected}`);
  }

  // Nothing was lost: every field the summary injected is still stated once,
  // from buildDesignIQPrompt's own explicit arguments.
  assert.match(prompt, /Business: BrightSmiles/);
  assert.match(prompt, /Industry: Dental/);
  assert.match(prompt, /Brand colors/);
  assert.match(prompt, /display this EXACT URL/);
  assert.match(prompt, /covers painted body panels only/);

  // And the identity is no longer repeated across the prompt.
  assert.ok(
    prompt.split("Industry: Dental").length - 1 === 1,
    "the industry must be stated exactly once",
  );
});
