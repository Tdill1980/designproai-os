/**
 * A DEFERRED CALL 8 IS AN OUTCOME. IT MUST NEVER READ AS A BUILD IN PROGRESS.
 *
 * Owner, 2026-08-31, having clicked 2D Proof: "2d proof is broken." The screen
 * showed "Building Production Proof on Server -- the durable workflow is
 * creating and verifying this proof", indefinitely.
 *
 * Nothing was broken about the proof producer. Call 8 DEFERS rather than fails,
 * on purpose -- "The 2D Production Proof is a later value-add artifact.
 * A.T.L.A.S. is the manufacturing authority, so this failure is recorded and
 * production continues." The row it writes is, measured in production:
 *
 *     stage_key      proof.build
 *     status         completed        <- not failed
 *     error_message  null             <- nothing to report
 *     output         { deferred: true, verified: false, failure: {...} }
 *
 * Two things then went wrong, and they compounded:
 *
 * 1. The gateway projected key/label/state/waitReason/artifactPath and nothing
 *    else, so `output` never crossed the wire. A deferred proof.build arrived
 *    as `state: "complete"` -- byte-identical to one that published a proof.
 *    RevisionStudio saw a completed run, no failed stage and no proof url, and
 *    had no field left that could tell it why.
 *
 * 2. Seeing no proof, the auto-build effect submitted a run. Call 8 deferred
 *    again for the same reason -- deferrals are conditions of the design, not
 *    transients -- and the new run id changed the attempt key, so it submitted
 *    again. A run really was always in flight, which is why the spinner was the
 *    branch that rendered: `hasActiveRun` was true, every time, forever.
 *
 * The sheet already had the right screen for this and had had it all along
 * ("The durable workflow stopped at proof.build, so no 2D proof was produced",
 * the reason, and a retry). It could never be reached.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
const studio = readFileSync(new URL("../app/src/pages/RevisionStudioIQ.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/src/lib/designpro-api.ts", import.meta.url), "utf8");
const sheet = readFileSync(new URL("../app/src/components/tools/TwoDProofSheet.tsx", import.meta.url), "utf8");
const claimant = readFileSync(new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");

test("the runtime still records a deferral as completed-with-deferred", () => {
  // The whole repair rests on this shape. If Call 8 ever starts FAILING on a
  // deferral instead, the projection below is redundant rather than wrong --
  // but the reasoning everywhere else cites this, so it is asserted, not
  // assumed.
  assert.match(claimant, /verified: false,\s*\n\s*deferred: true,/,
    "Call 8 no longer completes a deferral with { verified: false, deferred: true }");
  assert.match(claimant, /failure: \{ code, message \}/,
    "a deferral must carry the code and message the UI reports");
});

test("the gateway projects the deferral it already has in the stage output", () => {
  assert.match(gateway, /s\.output\.deferred === true/,
    "the stage projection must read the deferral out of the stage output");
  for (const field of ["deferred: true", "deferredReason:", "deferredMessage:"]) {
    assert.ok(gateway.includes(field), `the projected stage must carry ${field}`);
  }
  // Additive only: a stage that did not defer must carry none of these, so no
  // existing reader changes behaviour.
  assert.match(gateway, /\? \{\s*\n\s*deferred: true,[\s\S]{0,240}?\}\s*\n\s*: \{\}\),/,
    "the deferral fields must be spread conditionally, never emitted as false/empty");
});

test("the client type can express a deferral", () => {
  assert.match(api, /deferred\?: true;/);
  assert.match(api, /deferredReason\?: string;/);
  assert.match(api, /deferredMessage\?: string;/);
});

test("RevisionStudio reports a deferred proof instead of spinning", () => {
  assert.match(studio, /const deferredProofStage = stages\.find\(/,
    "the deferral must be located explicitly");
  assert.match(studio, /s\?\.key === "proof\.build" && s\?\.deferred === true/,
    "only proof.build's own deferral may drive the 2D proof screen");

  // Reported through the sheet's EXISTING failed-stage surface. A deferral is
  // not a failed stage, so `workflowFailedStage` can never catch it on its own;
  // this is what routes it to the screen that already says the right thing.
  assert.match(studio, /workflowFailedStage: workflowFailedStage\s*\n\s*\|\| \(deferredProofStage && !observedProofUrl/,
    "a deferral with no proof must be reported through the failed-stage surface");
  assert.match(studio, /stage_key: "proof\.build"/);
});

test("a deferral stops the auto-rebuild loop", () => {
  const effect = studio.slice(
    studio.indexOf("// Opening 2D Proof is Call 7's durable trigger"),
    studio.indexOf("if (loading) {"),
  );
  assert.ok(effect.length > 200, "the auto-build effect could not be located");
  assert.match(effect, /stages\?\.some\([\s\S]{0,160}?deferred === true,?\s*\n\s*\)\) return;/,
    "the auto-build must not resubmit after a deferral -- a fresh run reproduces it and the spinner never ends");
  // The guard has to come BEFORE the submit, and before the proof-url check is
  // irrelevant -- what matters is that nothing between it and startOrRetryBuild
  // can reach the submit.
  assert.ok(effect.indexOf("deferred === true") < effect.indexOf("startOrRetryBuild()"),
    "the deferral guard must precede the submit");
});

test("the sheet's honest screens are all still present", () => {
  // The repair adds no UI. These are the three branches the migrated sheet
  // already carried; the bug was that only one of them was reachable.
  assert.match(sheet, /Production proof build failed/, "the failed/deferred screen");
  assert.match(sheet, /Building Production Proof on Server/, "the genuinely-building screen");
  assert.match(sheet, /No production proof yet/, "the never-started screen");
  assert.match(sheet, /The durable workflow stopped at/,
    "the failed screen must name the stage that stopped");
});
