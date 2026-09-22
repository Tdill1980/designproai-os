import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const worker = require("../runtime/generation-worker.cjs");

const WORKER_SOURCE = readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");
const PROVIDER_SOURCE = readFileSync(new URL("../runtime/designpanel-server-provider.cjs", import.meta.url), "utf8");
const VALIDATOR = readFileSync(new URL("../ops/validate-env.py", import.meta.url), "utf8");

/**
 * THE CLAIM POLL IS CUSTOMER-VISIBLE LATENCY. (2026-09-22)
 *
 * `tick()` is the only thing that picks a queued generation up, so the interval
 * between ticks is dead time between the click and Call 1. It was 5 s -- a mean
 * of 2.5 s before any work began -- on a request->master p50 already 29 s over
 * its SLO. The default is now 1 s, env-overridable within a bounded range, and
 * a bad value resolves to the default rather than to a stall.
 */
test("the claim poll defaults to 1 s and is the worker's default interval", () => {
  assert.equal(worker.DEFAULT_POLL_MS, 1_000);
  assert.equal(worker.resolveWorkerPollMs({}), 1_000);
  assert.equal(worker.POLL_MS, worker.resolveWorkerPollMs(process.env));
  // The default interval the factory falls back to IS the resolved poll, not a
  // second literal that could drift from it.
  assert.match(WORKER_SOURCE, /intervalMs = POLL_MS,/);
  assert.match(WORKER_SOURCE, /const POLL_MS = resolveWorkerPollMs\(\);/);
  assert.doesNotMatch(WORKER_SOURCE, /const POLL_MS = 5_000;/, "the 5 s constant is gone");
});

test("DESIGNPRO_WORKER_POLL_MS overrides within 250-60000 ms; anything else resolves to the default", () => {
  assert.equal(worker.resolveWorkerPollMs({ DESIGNPRO_WORKER_POLL_MS: "2500" }), 2_500);
  assert.equal(worker.resolveWorkerPollMs({ DESIGNPRO_WORKER_POLL_MS: " 250 " }), 250);
  assert.equal(worker.resolveWorkerPollMs({ DESIGNPRO_WORKER_POLL_MS: "60000" }), 60_000);
  for (const bad of ["", "0", "100", "60001", "abc", "1e3", "1000.5", "-1000", "5000000", undefined, null]) {
    assert.equal(worker.resolveWorkerPollMs({ DESIGNPRO_WORKER_POLL_MS: bad }), 1_000, `${JSON.stringify(bad)} must fall back`);
  }
  // The deploy validator refuses unknown runtime keys (`exact_keys`), so the
  // knob must be listed there -- permitted, never required, with the same
  // bounds the runtime enforces, so the two cannot disagree about a value.
  assert.match(VALIDATOR, /if "DESIGNPRO_WORKER_POLL_MS" in runtime:/);
  assert.match(VALIDATOR, /250 <= int\(poll\) <= 60000/);
  assert.match(VALIDATOR, /runtime_keys\.add\("DESIGNPRO_WORKER_POLL_MS"\)/);
  assert.doesNotMatch(VALIDATOR, /"DESIGNPRO_WORKER_POLL_MS",\s*\n?\s*\}/, "never in the REQUIRED base set");
});

test("the worker polls at the resolved interval, and an idle tick reclaims GENIE preps no faster than before", async () => {
  const rpcCalls = [];
  const supabase = {
    async rpc(name, args) { rpcCalls.push(name); return { data: null, error: null }; },
    from() { return { select() { return { eq() { return { is: async () => ({ data: [], error: null }) }; } }; } }; },
  };
  let reclaims = 0;
  const geniePrepService = { async reclaimOne() { reclaims += 1; return null; } };
  const intervals = [];
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => { intervals.push(ms); return realSetInterval(fn, 1_000_000); };
  let instance;
  try {
    instance = worker.createGenerationWorker({
      supabase, workerId: "poll-test", provider: { models: [], keyCount: 0 }, geniePrepService,
    });
    instance.start();
  } finally {
    globalThis.setInterval = realSetInterval;
  }
  try {
    assert.deepEqual(intervals, [worker.POLL_MS], "start() schedules tick() at the resolved poll interval");
    // start() fired one unawaited tick; let it finish (it holds `busy`) before
    // counting, or the first awaited ticks below are no-ops.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const claimsBefore = rpcCalls.filter((name) => name === "claim_designpro_generation_request_v2").length;
    assert.equal(reclaims, 1, "the first idle tick reclaims");
    // Nine idle ticks inside one second: nine claim RPCs (that is the poll), but
    // the GENIE reclaim -- a second RPC -- does not fire again inside its 5 s cadence.
    for (let i = 0; i < 9; i += 1) await instance.tick();
    assert.equal(rpcCalls.filter((name) => name === "claim_designpro_generation_request_v2").length - claimsBefore, 9);
    assert.equal(reclaims, 1, "a 1 s claim poll must not turn one reclaim per 5 s into one per second");
    assert.equal(worker.IDLE_RECLAIM_MS, 5_000);
  } finally {
    instance.stop();
  }
});

/**
 * THE SHEET-ONLY PREFETCH IS DEAD ON PURPOSE, NOT BY ACCIDENT. (2026-09-22)
 *
 * `prefetchAtlasProofsFromPanelProof` returns [] without `expectedPanelRefs`,
 * and the worker's `onProofSheetReady` passes none. That is correct and must
 * stay so: the photographer edge keys its provider slot on the request hash of
 * the FULL body -- the surface's persisted Call-1 panel bytes, the sheet bytes
 * and the dimension text -- and those panels are cut from the normalized,
 * cut-out-filled master AFTER proof.assemble, so no byte-identical request can
 * be built at sheet time. A prefetch with any other refs opens its own
 * request-scoped slot on the edge (`allowRequestScopedSlot`): a SECOND paid
 * image that the real call never re-reads. The Driver proof already launches
 * from `onSurfaceReady` at the first instant its panel is durable.
 */
test("the proof-sheet callback never hands the prefetch panel refs it cannot have", () => {
  const callback = WORKER_SOURCE.slice(
    WORKER_SOURCE.indexOf("onProofSheetReady: ({ sheet, revisionId }) => prefetchAtlasProofsFromPanelProof({"),
    WORKER_SOURCE.indexOf("onMasterReady: (atlas) => {"),
  );
  assert.ok(callback.length > 0, "the callback still exists");
  assert.doesNotMatch(callback, /expectedPanelRefs/, "a prefetch without the persisted Call-1 panel is a second paid render");
  // And the function keeps refusing to spend on a sheet-only request.
  assert.match(PROVIDER_SOURCE, /const panelRefs = options\.expectedPanelRefs;\s*\n\s*if \(!panelRefs \|\|/);
});
