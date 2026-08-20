import { strict as assert } from "node:assert";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const claimantPath = join(root, "runtime", "designpro-standalone-claimant.cjs");
const claimantSource = readFileSync(claimantPath, "utf8");
const workflowSource = readFileSync(join(root, "app", "src", "pages", "designpro", "ProductionWorkflow.tsx"), "utf8");
const { STAGES, ARTIFACT_KINDS } = require("../../runtime/designpro-standalone-claimant.cjs");

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];

function stageIndex(name) {
  const index = STAGES.indexOf(name);
  assert.ok(index >= 0, `${name} must be scheduled`);
  return index;
}

test("Call 8 customer proof is selected by semantic role, never by missing surface key", () => {
  assert.match(workflowSource, /selectCustomerProof\s*\(/,
    "ProductionWorkflow must use the shared customer-proof selector");
  assert.ok(
    !/kind\s*===\s*["']flat-proof["']\s*&&\s*!.*surfaceKey/.test(workflowSource),
    "customer proof selection must never depend on missing surfaceKey",
  );
});

test("Call 9 manufacturing authority is the flattened Call 8 proof raster", () => {
  assert.match(claimantSource, /PANEL_SOURCE_RULE\s*=\s*["']one-exact-proof-region-per-output-side["']/,
    "Call 9 must declare one exact proof region per output side");
  assert.match(claimantSource, /proofRegionByKey/,
    "Call 9 must resolve regions by exact canonical surface key");
  assert.match(claimantSource, /approvedProofHash/,
    "Call 9 must hash-verify the approved Call 8 proof before extraction");
  assert.ok(
    !claimantSource.includes("the proof is never decoded here, because nothing is cut from it"),
    "the old display-only proof path must not return",
  );
  assert.ok(
    !/extractedFromProofRaster\s*:\s*false/.test(claimantSource),
    "Call 9 panels must not claim they came from some other manufacturing source",
  );
  assert.match(claimantSource, /extractedFromProofRaster\s*:\s*true/,
    "Call 9 panel evidence must state that its pixels were deterministically extracted from Call 8",
  );
});

test("all six canonical proof regions are explicit and missing regions fail closed", () => {
  for (const surface of SURFACES) {
    assert.ok(claimantSource.includes(`"${surface}"`) || claimantSource.includes(`'${surface}'`),
      `${surface} must be explicitly represented`);
  }
  assert.match(claimantSource, /call9_proof_regions_missing/,
    "Call 9 must fail when the approved proof lacks a complete six-region manifest");
  assert.match(claimantSource, /call9_proof_region_missing/,
    "Call 9 must fail when an individual requested surface region is absent");
});

test("Call 9 forbids driver substitution and any cross-side manufacturing fallback", () => {
  assert.ok(
    !/passengerDerivedFromDriver\s*:\s*true/.test(claimantSource),
    "passenger may never be manufactured from driver",
  );
  assert.match(claimantSource, /call9_driver_passenger_reuse/,
    "driver/passenger byte reuse must fail closed");
  assert.match(claimantSource, /new Map\([\s\S]*proof\.proofRegions/,
    "proof regions must be keyed explicitly rather than selected by array position");
});

test("Call 9 -> Call 10 -> Call 11 ordering is impossible to invert", () => {
  const panels = stageIndex("panels.build");
  const inventory = stageIndex("logos.extract");
  const delogo = stageIndex("panels.delogo");
  const panelPro = stageIndex("await_panelpro_preflight_qc");

  assert.ok(panels < inventory, "Call 9 branded panels must exist before Call 10 work");
  assert.ok(inventory < delogo, "Call 10 must complete before Call 11 de-logo work");
  assert.ok(delogo < panelPro, "Call 11 must complete before PanelPro preflight");
});

test("Call 11 edits a copy and cannot replace branded Call 9 panels", () => {
  assert.ok(ARTIFACT_KINDS.includes("panel"));
  assert.ok(ARTIFACT_KINDS.includes("qc-panel"));
  assert.notEqual("panel", "qc-panel");

  const start = claimantSource.indexOf('stage.stage_key === "panels.delogo"');
  const end = claimantSource.indexOf('stage.stage_key === "pack.verify"', start);
  assert.ok(start >= 0 && end > start, "panels.delogo stage block must exist");
  const stage = claimantSource.slice(start, end);

  assert.match(stage, /Buffer\.from\(branded\)/,
    "Call 11 must edit an independent byte copy");
  assert.match(stage, /call11_branded_receipt_mismatch/,
    "Call 11 must verify the Call 9 receipt before editing");
  assert.match(stage, /call11_branded_panel_mutated/,
    "Call 11 must re-hash the original after editing the copy");
  assert.match(stage, /artifact\(["']qc-panel["']/,
    "Call 11 output must be a qc-panel");
  assert.ok(!stage.includes('artifact("panel"') && !stage.includes("artifact('panel'"),
    "Call 11 must never write an authoritative panel artifact");
});

test("clean duplicates are explicitly non-authoritative and non-printable", () => {
  const start = claimantSource.indexOf('stage.stage_key === "panels.delogo"');
  const end = claimantSource.indexOf('stage.stage_key === "pack.verify"', start);
  const stage = claimantSource.slice(start, end);
  assert.match(stage, /authoritative\s*:\s*false/);
  assert.match(stage, /printable\s*:\s*false/);
});

test("Topaz/output cannot consume qc-panel duplicates", () => {
  const start = claimantSource.indexOf('stage.stage_key === "enhance.upscale"');
  const end = claimantSource.indexOf('stage.stage_key === "stamp.build"', start);
  assert.ok(start >= 0 && end > start, "output stages must exist");
  const outputStages = claimantSource.slice(start, end);
  assert.ok(!outputStages.includes('"qc-panel"') && !outputStages.includes("'qc-panel'"),
    "final print output must consume branded production panels, not clean QC duplicates");
});
