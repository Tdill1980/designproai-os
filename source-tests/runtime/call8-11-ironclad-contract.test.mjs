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
  // Strip comments first: the file deliberately documents the removed pattern in
  // prose so the next session knows why it is gone. Matching that prose would
  // make the guard fire on its own explanation instead of on live code.
  const workflowCode = workflowSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/kind\s*===\s*["']flat-proof["']\s*&&\s*!.*surfaceKey/.test(workflowCode),
    "customer proof selection must never depend on missing surfaceKey",
  );
});

test("Call 9 manufacturing authority is the flattened Call 8 proof raster", () => {
  assert.match(claimantSource, /PANEL_SOURCE_RULE\s*=\s*["']one-own-surface-region-per-output-side["']/,
    "the database-frozen source-rule literal must remain stable");
  assert.match(claimantSource, /proofRegionByKey/,
    "Call 9 must resolve regions by exact canonical surface key");
  assert.match(claimantSource, /approvedProofHash/,
    "Call 9 must hash-verify the approved Call 8 proof before extraction");
  assert.match(claimantSource, /mirrorBleedPanelFromProofRegion\s*\(/,
    "Call 9 must perform deterministic crop/size/bleed from the exact proof region");
  assert.ok(
    !claimantSource.includes("the proof is never decoded here, because nothing is cut from it"),
    "the old display-only proof path must not return",
  );
  assert.ok(
    !/extractedFromProofRaster\s*:\s*false/.test(claimantSource),
    "Call 9 panels must not claim they came from another manufacturing source",
  );
  assert.match(claimantSource, /extractedFromProofRaster\s*:\s*true/,
    "Call 9 panel evidence must state that its pixels were deterministically extracted from Call 8",
  );
  assert.match(claimantSource, /generativeModelCalls:\s*0/,
    "Call 9 must not author pixels with a model");
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
  assert.match(claimantSource, /call9_proof_region_out_of_bounds/,
    "Call 9 must reject a region that does not fit the exact approved proof raster");
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
  const call10 = stageIndex("logos.extract");
  const delogo = stageIndex("panels.delogo");
  const panelPro = stageIndex("await_panelpro_preflight_qc");

  assert.ok(panels < call10, "Call 9 branded panels must exist before Call 10 duplicates");
  assert.ok(call10 < delogo, "Call 10 persisted duplicates must complete before Call 11 de-logo work");
  assert.ok(delogo < panelPro, "Call 11 must complete before PanelPro preflight");
});

test("Call 10 and Call 11 keep branded, duplicate, and clean artifacts separate", () => {
  assert.ok(ARTIFACT_KINDS.includes("panel"));
  assert.ok(ARTIFACT_KINDS.includes("panel-duplicate"));
  assert.ok(ARTIFACT_KINDS.includes("qc-panel"));
  assert.notEqual("panel", "panel-duplicate");
  assert.notEqual("panel-duplicate", "qc-panel");

  const call10Start = claimantSource.indexOf('stage.stage_key === "logos.extract"');
  const call10End = claimantSource.indexOf('const LOGO_LOCATE_MODEL', call10Start);
  const call10 = claimantSource.slice(call10Start, call10End);
  assert.match(call10, /Buffer\.from\(branded\)/,
    "Call 10 must duplicate the exact branded bytes before any cleaning");
  assert.match(call10, /artifact\(["']panel-duplicate["']/,
    "Call 10 must persist its working copies as their own artifact kind");
  assert.match(call10, /stored\.hash !== sourceHash/,
    "persisted Call 10 bytes must remain identical to Call 9");

  const start = claimantSource.indexOf('stage.stage_key === "panels.delogo"');
  const end = claimantSource.indexOf('stage.stage_key === "pack.verify"', start);
  assert.ok(start >= 0 && end > start, "panels.delogo stage block must exist");
  const call11 = claimantSource.slice(start, end);
  assert.match(call11, /artifacts\(sb, run\.id, \["panel-duplicate"\]\)/,
    "Call 11 must read the saved Call 10 duplicates");
  assert.match(call11, /call11_branded_panel_mutated/,
    "Call 11 must re-hash the branded originals after editing");
  assert.match(call11, /call11_call10_duplicate_mutated/,
    "Call 11 must also prove the saved Call 10 duplicates were not edited in place");
  assert.match(call11, /artifact\(["']qc-panel["']/,
    "Call 11 output must be a separate qc-panel");
  assert.ok(!call11.includes('artifact("panel"') && !call11.includes("artifact('panel'"),
    "Call 11 must never write an authoritative panel artifact");
  assert.ok(!call11.includes('artifact("panel-duplicate"') && !call11.includes("artifact('panel-duplicate'"),
    "Call 11 must never overwrite the saved Call 10 duplicates");
});

test("clean derivatives are explicitly non-authoritative and non-printable", () => {
  const start = claimantSource.indexOf('stage.stage_key === "panels.delogo"');
  const end = claimantSource.indexOf('stage.stage_key === "pack.verify"', start);
  const stage = claimantSource.slice(start, end);
  assert.match(stage, /authoritative\s*:\s*false/);
  assert.match(stage, /printable\s*:\s*false/);
});

test("Topaz/output cannot consume Call 10 or Call 11 working duplicates", () => {
  const start = claimantSource.indexOf('stage.stage_key === "enhance.upscale"');
  const end = claimantSource.indexOf('stage.stage_key === "stamp.build"', start);
  assert.ok(start >= 0 && end > start, "output stages must exist");
  const outputStages = claimantSource.slice(start, end);
  assert.ok(!outputStages.includes('"panel-duplicate"') && !outputStages.includes("'panel-duplicate'"),
    "final print output must not consume Call 10 working duplicates");
  assert.ok(!outputStages.includes('"qc-panel"') && !outputStages.includes("'qc-panel'"),
    "final print output must not consume Call 11 clean QC derivatives");
});
