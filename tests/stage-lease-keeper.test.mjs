import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const claimant = require("../runtime/designpro-standalone-claimant.cjs");
const { leaseKeeper, HEAVY_LEASE_SECONDS, CLAIM_SECONDS, HEARTBEAT_MS } = claimant._test;
const source = readFileSync(new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");

// A LOST LEASE IS WHAT THE DATABASE SAYS, NOT WHAT THE NETWORK DID.
//
// Canary 8c525565 reached Topaz and then lost `output.build` five times to
// `stage_lease_lost` at 3m22s, 3m52s, 8m54s and 11m14s -- no fixed boundary,
// always mid-upload of a multi-gigabyte TIFF. That is the signature of a
// transient RPC error, not of an expiry: the lease is 900s and beats every 30.
// Both heartbeats aborted the whole stage on the FIRST answer that was not
// `true`, so one unanswered beat threw away up to 870 seconds of provably-held
// lease and every byte of a finished output set.

// leaseKeeper drives itself on a 30s interval; these tests drive the beat
// function directly through fake timers so they take milliseconds.
function runKeeper({ answers, leaseSeconds }) {
  const lost = [];
  const beats = [];
  // The clock stays faked for the whole keeper's life: `confirmedAt` is read
  // from it at construction, so restoring it before ticking would measure a
  // fake elapsed time against a real starting point.
  let now = 1_000_000;
  const realNow = Date.now;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const timers = [];
  Date.now = () => now;
  globalThis.setInterval = (fn) => { const t = { fn, cleared: false, unref() { return this; } }; timers.push(t); return t; };
  globalThis.clearInterval = (t) => { if (t) t.cleared = true; };
  leaseKeeper({
    leaseSeconds, label: "test",
    beat: async () => { const next = answers[beats.length] ?? { data: true }; beats.push(next); return next; },
    onLost: (reason) => lost.push(reason),
  });
  return {
    lost, beats,
    async tick(count) {
      for (let i = 0; i < count; i += 1) {
        now += HEARTBEAT_MS;
        for (const timer of timers) if (!timer.cleared) await timer.fn();
      }
    },
    restore() {
      Date.now = realNow;
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
    },
  };
}

test("an unanswered heartbeat is not a lost lease: the work keeps running while the lease provably still holds", async () => {
  const keeper = runKeeper({
    leaseSeconds: 900,
    answers: Array.from({ length: 12 }, () => ({ error: { message: "fetch failed" } })),
  });
  // 12 unanswered beats is six minutes. The lease is fifteen. Nothing is lost.
  await keeper.tick(12);
  keeper.restore();
  assert.deepEqual(keeper.lost, [],
    "six minutes of unreachable database must not abort a fifteen-minute lease");
});

test("a database that SAYS the lease is gone aborts immediately, on the first answer", async () => {
  const keeper = runKeeper({ leaseSeconds: 900, answers: [{ data: false }] });
  await keeper.tick(1);
  keeper.restore();
  assert.equal(keeper.lost.length, 1);
  assert.match(keeper.lost[0], /no longer held by this worker/,
    "the fence doing its job must stay instant: two workers writing one output is what it prevents");
});

test("an unanswered heartbeat becomes a loss before the row could expire, never after", async () => {
  const keeper = runKeeper({
    leaseSeconds: 900,
    answers: Array.from({ length: 40 }, () => ({ error: { message: "fetch failed" } })),
  });
  await keeper.tick(40);
  keeper.restore();
  assert.equal(keeper.lost.length, 1, "it gives up exactly once");
  assert.match(keeper.lost[0], /could not be confirmed for \d+s of its 900s term/);
  const staleSeconds = Number(keeper.lost[0].match(/for (\d+)s/)[1]);
  assert.ok(staleSeconds < 900, `stopped at ${staleSeconds}s, which must be inside the 900s lease`);
  assert.ok(staleSeconds >= 900 - 900 / 4 - HEARTBEAT_MS / 1000,
    "and it must not give up early either, or the fix buys nothing");
});

test("one good answer re-arms the whole allowance", async () => {
  const answers = [];
  for (let i = 0; i < 20; i += 1) answers.push({ error: { message: "fetch failed" } });
  answers[19] = { data: true };
  for (let i = 20; i < 40; i += 1) answers.push({ error: { message: "fetch failed" } });
  const keeper = runKeeper({ leaseSeconds: 900, answers });
  await keeper.tick(30);
  keeper.restore();
  assert.deepEqual(keeper.lost, [], "a beat that got through resets the clock it is measured against");
});

test("a beat slower than the interval never stacks up behind itself", async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const lost = [];
  let now = 0;
  const realNow = Date.now;
  const realSetInterval = globalThis.setInterval;
  Date.now = () => now;
  const timers = [];
  globalThis.setInterval = (fn) => { const t = { fn, cleared: false, unref() { return this; } }; timers.push(t); return t; };
  let release;
  try {
    leaseKeeper({
      leaseSeconds: 900, label: "test", onLost: (reason) => lost.push(reason),
      beat: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => { release = resolve; });
        concurrent -= 1;
        return { data: true };
      },
    });
    const pending = [];
    for (let i = 0; i < 4; i += 1) { now += HEARTBEAT_MS; pending.push(timers[0].fn()); }
    release();
    await Promise.all(pending);
    assert.equal(maxConcurrent, 1, "an RPC slower than the beat must not be re-entered");
  } finally {
    Date.now = realNow;
    globalThis.setInterval = realSetInterval;
  }
});

test("both lease heartbeats go through the keeper, and the heavy slot outlives a delayed renewal", () => {
  assert.equal(HEAVY_LEASE_SECONDS, 600);
  assert.ok(HEAVY_LEASE_SECONDS >= 15 && HEAVY_LEASE_SECONDS <= 900,
    "acquire_designpro_heavy_lease rejects anything outside 15..900");
  assert.ok(HEAVY_LEASE_SECONDS <= CLAIM_SECONDS,
    "the heavy slot is fenced by the stage lease and must never outlive it");
  assert.match(source, /p_lease_seconds: HEAVY_LEASE_SECONDS/);
  // Neither heartbeat may go back to aborting on the first non-true answer.
  assert.doesNotMatch(source, /if \(beatError \|\| current !== true\)/);
  assert.doesNotMatch(source, /if \(result\.error \|\| result\.data !== true\)/);
  assert.equal((source.match(/= leaseKeeper\(\{/g) || []).length, 2,
    "the stage heartbeat and the heavy renewal are the two call sites, and they share one rule");
  assert.equal((source.match(/function leaseKeeper\(/g) || []).length, 1,
    "one rule means one implementation");
  // The two abort reasons must stay different sentences: they are what the next
  // failure carries into fail_designpro_stage, and they need different fixes.
  assert.match(source, /lease is no longer held by this worker/);
  assert.match(source, /lease could not be confirmed for/);
});
