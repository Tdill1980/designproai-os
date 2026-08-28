// SIX SIBLING SURFACES, NOT ONE PARENT AND FIVE CHILDREN.
//
// After A.T.L.A.S. master acceptance the six surface authorities are peers.
// Each one independently feeds its own 3D proof; none is a lineage parent or an
// execution prerequisite for another. Driver keeps scheduling priority because
// it is what the customer sees first (RULE 0.23) -- priority is not the same as
// prerequisite.
//
// WHAT THIS REPLACED, AND WHY. Passenger was manufactured by mirroring the
// accepted Driver render and repairing its reversed lettering, policed by a
// similarity bound; every other non-Driver view blocked on an accepted Driver
// and was handed a compacted copy of it as an anchor. Neither is what the
// proven path did: Flamingo Pools (5b2eb96c, 2026-08-22) rendered Passenger as
// its own Gemini call at 35,747 ms with a real key fingerprint -- LONGER than
// its own Driver at 30,709 ms -- from the same master authority. A sharp mirror
// costs ~100 ms and burns no key.
//
// The mirror chain then became the top cause of failed runs, because a branded
// design can never be a literal pixel mirror while every word stays
// forward-reading on both flanks: dda491ae refused at 0.28346, a9daede trimmed
// the mean, a6dd78aa still failed at 0.29343, and fc2f2e80 failed the other way
// with upside-down passenger lettering.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const { runAtlasProofStages } = require("../runtime/generation-worker.cjs");
const angles = require("../runtime/view-angles.cjs");

const PROVIDER_SOURCE = readFileSync(
  new URL("../runtime/designpanel-server-provider.cjs", import.meta.url), "utf8",
);
const WORKER_SOURCE = readFileSync(
  new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8",
);

/** The A.T.L.A.S. branch only -- the module still exports the Standard mirror. */
const ATLAS_BRANCH = PROVIDER_SOURCE.slice(
  PROVIDER_SOURCE.indexOf("THE PROVEN PHOTOGRAPHER RENDERS EVERY A.T.L.A.S. PROOF"),
  PROVIDER_SOURCE.indexOf("hydrateDriver: driverStore.hydrateHero"),
);

const VIEWS = angles.viewOrder();
const SURFACE_VIEWS = ["side", "passenger-side", "hood_detail", "front", "rear", "roof"];

function provider() {
  return {
    maxProviderAttempts: 4,
    generateImage: async () => { throw new Error("engine owns provider invocation"); },
    hydrateDriver: async () => ({ contentHash: "a".repeat(64) }),
  };
}

function accepted(views, overrides = {}) {
  return {
    state: "outputs_ready",
    providerCalls: views.length,
    budget: views.length * 4,
    results: views.map((sourceViewType) => ({ sourceViewType, state: "accepted" })),
    ...overrides,
  };
}

// 1. all six can be scheduled after acceptance without waiting on Driver
test("1: every surface is scheduled in one parallel dispatch, no Driver stage first", async () => {
  const dispatches = [];
  await runAtlasProofStages({
    runRequest: async ({ slots, parallel }) => {
      dispatches.push({ views: slots.map((s) => s.sourceViewType), parallel });
      return accepted(slots.map((s) => s.sourceViewType));
    },
    requestId: "r", generationId: "g", tenantKey: "t",
    provider: provider(), store: {},
    slots: VIEWS.map((sourceViewType) => ({ sourceViewType })),
  });

  assert.equal(dispatches.length, 1, "one dispatch, not a Driver stage then the rest");
  assert.equal(dispatches[0].parallel, true);
  assert.deepEqual(dispatches[0].views, VIEWS);
  assert.equal(dispatches[0].views[0], "side", "Driver keeps priority by being dispatched first");
  // The engine's parallel branch is Promise.all over the slot array, so slot
  // order IS dispatch order -- that is what makes Driver priority real without
  // making it a gate.
  const engine = readFileSync(new URL("../runtime/generation-engine.cjs", import.meta.url), "utf8");
  assert.match(engine, /Promise\.all\(slots\.map\(/);
});

// 2 + 3. every surface renders from its OWN authority
test("2+3: Passenger and every other surface render from their own surface authority", () => {
  // No mirror, no repair, no Driver requirement anywhere on the A.T.L.A.S. path.
  assert.equal(ATLAS_BRANCH.includes("producePassengerView"), false);
  assert.equal(ATLAS_BRANCH.includes("generatePassengerMirror"), false);
  assert.equal(ATLAS_BRANCH.includes("fixMirrorText"), false);
  assert.equal(ATLAS_BRANCH.includes("designpanel_server_driver_required"), false);
  assert.equal(ATLAS_BRANCH.includes("compactAcceptedDriver"), false);
  // The Driver continuity photograph the owner ruled out by name on 2026-08-28
  // ("Do not use Driver as artwork continuity authority") is not asserted here:
  // it and the whole deleted proof producer are covered repository-wide by
  // `tests/proof-stack-pinned-sources.test.mjs`, which fails if either symbol
  // reappears in ANY code line rather than just in this slice.
  // Identity is per-surface and hash-bound to the shared master.
  assert.match(ATLAS_BRANCH, /atlasZoneSurfaceKey/);
  assert.match(ATLAS_BRANCH, /atlasZoneContentHash/);
  assert.match(ATLAS_BRANCH, /atlasConditioningVerified:\s*true/);
  // And each surface is SENT its own panel: `panelFor` resolves through
  // `surfaceForProofView`, so passenger-side receives the passenger panel.
  assert.match(ATLAS_BRANCH, /atlas\.panelFor\(sourceViewType\)/);
  assert.match(ATLAS_BRANCH, /sourcePanelPath: panel\.storagePath/);
});

// 4. a failed Driver does not prevent the others
test("4: a failed Driver does not stop the other surfaces completing", async () => {
  const result = await runAtlasProofStages({
    runRequest: async ({ slots }) => ({
      state: "failed",
      providerCalls: slots.length,
      budget: slots.length * 4,
      results: slots.map((s) => ({
        sourceViewType: s.sourceViewType,
        state: s.sourceViewType === "side" ? "failed" : "accepted",
      })),
    }),
    requestId: "r", generationId: "g", tenantKey: "t",
    provider: provider(), store: {},
    slots: VIEWS.map((sourceViewType) => ({ sourceViewType })),
  });

  assert.equal(result.results.filter((r) => r.state === "accepted").length, VIEWS.length - 1);
  // The SET is still incomplete, so the request is failed -- but the work the
  // other surfaces did is not discarded, which is the whole point.
  assert.equal(result.state, "failed");
});

// 5. one failed proof can retry independently
test("5: a single failed surface leaves the rest accepted and is retryable alone", async () => {
  let pass = 0;
  const run = async ({ slots }) => {
    pass += 1;
    return {
      state: pass === 1 ? "failed" : "outputs_ready",
      providerCalls: slots.length,
      budget: slots.length * 4,
      results: slots.map((s) => ({
        sourceViewType: s.sourceViewType,
        state: pass === 1 && s.sourceViewType === "rear" ? "failed" : "accepted",
      })),
    };
  };
  const first = await runAtlasProofStages({
    runRequest: run, requestId: "r", generationId: "g", tenantKey: "t",
    provider: provider(), store: {}, slots: VIEWS.map((sourceViewType) => ({ sourceViewType })),
  });
  assert.equal(first.results.find((r) => r.sourceViewType === "rear").state, "failed");
  assert.equal(first.results.filter((r) => r.state === "accepted").length, VIEWS.length - 1);

  // Re-running one slot alone is legal precisely because it has no sibling
  // dependency -- it needs only the frozen master it was always conditioned on.
  const retry = await runAtlasProofStages({
    runRequest: run, requestId: "r", generationId: "g", tenantKey: "t",
    provider: provider(), store: {}, slots: [{ sourceViewType: "rear" }],
  });
  assert.equal(retry.state, "outputs_ready");
  assert.equal(retry.results.length, 1);
});

// 6 + 7. panels stay distinct and every pair shares master hash + surfaceKey
test("6+7: the gate still demands seven distinct views bound to one accepted revision", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const file = readdirSync(dir).filter((n) => n.endsWith(".sql"))
    .filter((n) => readFileSync(new URL(n, dir), "utf8")
      .includes("FUNCTION designpro_private.flat_first_atlas_view_set_valid"))
    .sort().at(-1);
  const gate = readFileSync(new URL(file, dir), "utf8");

  // Distinctness and completeness are untouched by the seam change.
  assert.match(gate, /v_count=7[\s\S]*v_source_count=7[\s\S]*v_role_count=7[\s\S]*v_hash_count=7[\s\S]*v_valid_count=7/);
  // Every view still binds to the accepted revision's master, projection,
  // manifest and its own zone -- this is what replaced the Driver anchor.
  for (const bound of [
    "atlasMasterContentHash", "atlasProjectionContentHash", "atlasManifestContentHash",
    "atlasRevisionId", "atlasZoneSurfaceKey", "atlasZoneContentHash",
  ]) assert.ok(gate.includes(bound), `${bound} must still be asserted`);
  // A Driver view must still EXIST for the set to be valid.
  assert.match(gate, /consumer_role='driver'/);
});

// 8. backwards passenger text still fails semantic QC
test("8: backwards or upside-down customer text is still fatal", () => {
  const proofQc = readFileSync(new URL("../runtime/atlas-proof-qc.cjs", import.meta.url), "utf8");
  // The proof reviewer, which this change does not touch, still convicts
  // reversed lettering -- that is how fc2f2e80 was caught.
  assert.match(proofQc, /mirror|backwards|reversed|forward-reading/i);
  // And the authoring prompt still requires forward-reading text on both
  // flanks -- it lives in the deployed edge function's flat contract now
  // (owner directive 2026-08-27), with the runtime's corrective note carrying
  // the same requirement on a mirror refusal.
  const edgeSource = readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");
  assert.match(edgeSource, /every word and logo forward-reading on both/);
  const atlasSource = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  assert.match(atlasSource, /forward-reading on both/);
});

// 9. the old mirror path is unreachable from active ATLAS generation
test("9: the mirror/repair/MAE path is unreachable from A.T.L.A.S. generation", () => {
  // The worker no longer stages Driver alone or gates on its hash.
  const stage = WORKER_SOURCE.slice(
    WORKER_SOURCE.indexOf("async function runAtlasProofStages"),
    WORKER_SOURCE.indexOf("function createGenerationWorker({"),
  );
  assert.ok(stage.length > 200, "the stage slice must not be empty");
  assert.equal(stage.includes("slots.slice(0, 1)"), false, "no isolated Driver stage");
  assert.equal(stage.includes("await provider.hydrateDriver()"), false, "no Driver hash gate");
  assert.match(stage, /parallel: true/);

  // The database gate no longer mandates the mirror -- it REFUSES it, so the
  // retired path cannot quietly come back and still satisfy the seam.
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const file = readdirSync(dir).filter((n) => n.endsWith(".sql"))
    .filter((n) => readFileSync(new URL(n, dir), "utf8")
      .includes("FUNCTION designpro_private.flat_first_atlas_view_set_valid"))
    .sort().at(-1);
  const gate = readFileSync(new URL(file, dir), "utf8");
  for (const refused of [
    "deterministicMirror", "passengerProducer", "atlasZonePassedToPassengerRepair", "driverContentHash",
  ]) {
    assert.ok(
      new RegExp(`NOT \\(\\(v\\.metadata->'provider'\\) \\? '${refused}'\\)`).test(gate),
      `${refused} must be refused, not merely unrequired`,
    );
  }
  // Read the EXECUTABLE SQL only. The migration's header comment quotes the
  // retired requirement verbatim to record what changed, which is documentation,
  // not a mandate -- a regex over the whole file cannot tell the two apart.
  const sql = gate.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.equal(/renderMethod[^\n]*producePassengerView/.test(sql), false,
    "the gate must not still mandate the mirror producer");
  assert.match(sql, /renderMethod[^\n]*'generate-color-render'/);
});

test("Close-Up remains the seventh visualization and never a seventh panel", () => {
  const atlas = require("../runtime/flat-first-atlas.cjs");
  assert.equal(atlas.SURFACE_KEYS.includes("closeup"), false);
  assert.equal(atlas.SURFACE_KEYS.length, 6);
  assert.ok(VIEWS.includes("close-up"));
  assert.deepEqual(SURFACE_VIEWS.filter((v) => VIEWS.includes(v)).length, 6);
});
