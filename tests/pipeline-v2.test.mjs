// PIPELINE V2 (owner, 2026-09-25): declared graph, resolution gate, prompt pin.
// Off unless DESIGNPRO_PIPELINE_V2=true. Produces nothing; see runtime/pipeline-v2.cjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const v2 = require("../runtime/pipeline-v2.cjs");
const pin = JSON.parse(readFileSync(new URL("../runtime/pipeline-v2-prompt-pin.json", import.meta.url), "utf8"));

test("the flag is off unless exactly true", () => {
  assert.equal(v2.pipelineV2Enabled({}), false);
  assert.equal(v2.pipelineV2Enabled({ DESIGNPRO_PIPELINE_V2: "1" }), false);
  assert.equal(v2.pipelineV2Enabled({ DESIGNPRO_PIPELINE_V2: "true" }), true);
});

test("Call 1 is the TriZone proof, shown to the customer; the seven views and the Atlas start together after it", () => {
  const byId = Object.fromEntries(v2.PIPELINE_V2_DAG.map((n) => [n.id, n]));
  assert.deepEqual(byId["call1.trizone_proof"].after, []);
  assert.equal(byId["call1.trizone_proof"].customerVisible, true);
  const group = v2.parallelGroups()["call2.views"];
  assert.equal(group.filter((id) => id.startsWith("call2.view.")).length, 7);
  assert.ok(group.includes("atlas.topology"), "the Atlas runs in parallel with Call 2, not after it");
  for (const id of group) assert.deepEqual(byId[id].after, ["call1.trizone_proof"], `${id} is fed by the Call-1 proof`);
  assert.equal(byId["atlas.topology"].bleedIn, 5);
  assert.deepEqual(byId["qc.panelpro"].after, ["atlas.topology", "call2.views"]);
});

test("later-phase nodes are disabled hooks that name the access they need", () => {
  for (const id of ["enhance.upscale", "vectorize.layers", "template.vector"]) {
    const node = v2.PIPELINE_V2_DAG.find((n) => n.id === id);
    assert.equal(node.enabled, false, id);
    assert.ok(node.needs.length > 0, id);
  }
});

test("no second panel producer: the graph adds no re-author / refine node (CLAUDE.md ZONE 1 IS CUT FROM THE TEMPLATE)", () => {
  const text = readFileSync(new URL("../runtime/pipeline-v2.cjs", import.meta.url), "utf8");
  for (const forbidden of ["callAuthorEdge", "authorSurface", "createAtlasAuthorTransport", "atlas-panel-refine", "PANEL_REFINE"]) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
});

test("resolution gate: measured cells are reported honestly, with what Topaz can and cannot add", () => {
  // The audit's driver cell (979×335 px) on a 236×69 in driver side.
  const driver = v2.resolutionGate({ widthPx: 979, heightPx: 335, printWidthIn: 236, printHeightIn: 69 });
  assert.equal(driver.nativePpi, 4.15);
  assert.equal(driver.eligible, false);
  assert.equal(driver.topaz.appliedScale, 6, "Topaz stops at 6×");
  assert.equal(driver.topaz.ppiAfterTopaz, 24.89);
  assert.equal(driver.reachesTargetWithTopaz, false);
  // Already at target: nothing to plan.
  const fine = v2.resolutionGate({ widthPx: 3000, heightPx: 1500, printWidthIn: 20, printHeightIn: 10 });
  assert.deepEqual([fine.eligible, fine.topaz, fine.reachesTargetWithTopaz], [true, null, true]);
  assert.throws(() => v2.resolutionGate({ widthPx: 0, heightPx: 1, printWidthIn: 1, printHeightIn: 1 }), /geometry_invalid/);
});

test("the Call-1 prompt is frozen: any change to its sources must bump runtime/pipeline-v2-prompt-pin.json", () => {
  const result = v2.verifyPromptPin(pin);
  assert.ok(result.ok, `Call-1 prompt sources changed without a new pin: ${result.drift.join(", ")}.\n`
    + "Bump promptVersion and the hashes in runtime/pipeline-v2-prompt-pin.json in the same commit, and say why.");
  assert.match(pin.promptVersion, /^designpro\.atlas-panel-production-proof\.v\d+\+pin\.\d{4}-\d{2}-\d{2}$/);
  const drifted = v2.verifyPromptPin({ ...pin, sources: { ...pin.sources, [v2.PROMPT_SOURCES[0]]: "0".repeat(64) } });
  assert.deepEqual(drifted.drift, [v2.PROMPT_SOURCES[0]]);
});
