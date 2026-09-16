/**
 * THE CONTINUITY RE-RENDER IS AFFORDABLE. Live 455b1723 (2026-09-16): the
 * driver proof dropped a graphic, the inspector correctly refused it, and the
 * slot died on its first attempt because the provider's budget was one --
 * the "one proof-only rerender" of RULE 0.15 was promised by the validator
 * and unaffordable in the engine. The run shipped six views and the handoff
 * never fired.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");
const qc = readFileSync(new URL("../runtime/atlas-proof-qc.cjs", import.meta.url), "utf8");

test("an A.T.L.A.S. proof slot can spend the one re-render the continuity gate buys, and no more", () => {
  assert.match(worker, /const ATLAS_PROOF_ATTEMPTS = 2;/);
  const stage = worker.slice(worker.indexOf("async function runAtlasProofStages"), worker.indexOf("function combineAtlasProofRuns"));
  assert.match(stage, /maxProviderAttempts: Math\.max\(Number\(provider\.maxProviderAttempts\) \|\| 1, ATLAS_PROOF_ATTEMPTS\)/);
  assert.match(stage, /maxRegenerations: ATLAS_PROOF_ATTEMPTS/);
  // The validator, not the engine, makes the second drift verdict terminal.
  assert.match(qc, /const MAX_CONTINUITY_ATTEMPTS = 2;/);
  assert.match(qc, /terminal: continuityFailures >= MAX_CONTINUITY_ATTEMPTS/);
});
