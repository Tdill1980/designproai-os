import { strict as assert } from "node:assert";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { STAGES, RECEIPTS, ARTIFACT_KINDS, _test } = require("../../runtime/designpro-standalone-claimant.cjs");
const claimantSource = readFileSync(join(root, "runtime", "designpro-standalone-claimant.cjs"), "utf8");

test("Call 11 sits between Call 10 and the PanelPro preflight gate", () => {
  const delogo = STAGES.indexOf("panels.delogo");
  assert.ok(delogo > -1, "panels.delogo must be a scheduled stage");
  assert.ok(delogo > STAGES.indexOf("logos.extract"), "Call 11 runs after Call 10");
  assert.ok(delogo < STAGES.indexOf("await_panelpro_preflight_qc"), "Call 11 runs before PanelPro preflight");
});

test("Topaz stays after PanelPro preflight", () => {
  assert.ok(
    STAGES.indexOf("await_panelpro_preflight_qc") < STAGES.indexOf("enhance.upscale"),
    "no Topaz before PanelPro",
  );
  assert.ok(
    STAGES.indexOf("panels.delogo") < STAGES.indexOf("enhance.upscale"),
    "the QC duplicates exist before Topaz runs",
  );
});

test("qc-panel is its own artifact kind and never replaces panel", () => {
  assert.ok(ARTIFACT_KINDS.includes("qc-panel"));
  assert.ok(ARTIFACT_KINDS.includes("panel"));
  assert.notEqual("qc-panel", "panel");
  assert.ok(RECEIPTS.includes("call11.qc-panels"));
});

test("the exactly-six branded panel invariant is untouched", () => {
  // source.verify still counts artifacts of kind "panel" only. If Call 11 ever
  // wrote its duplicates as "panel", this assertion would be the thing that
  // had to be relaxed — so it is asserted here rather than assumed.
  assert.match(claimantSource, /artifacts\(sb, sourceRunId, \["panel"\]\)/);
  assert.match(claimantSource, /sourcePanels\.length !== SURFACE_KEYS\.length/);
  assert.ok(
    !/artifacts\(sb, sourceRunId, \["panel", "qc-panel"\]\)/.test(claimantSource),
    "source.verify must never widen its panel query to include QC duplicates",
  );
});

test("Topaz and the output set read the branded panels, never qc-panel", () => {
  const enhance = claimantSource.slice(claimantSource.indexOf('stage.stage_key === "enhance.upscale"'));
  const upToOutput = enhance.slice(0, enhance.indexOf('stage.stage_key === "stamp.build"'));
  assert.ok(!upToOutput.includes('"qc-panel"'), "no qc-panel may enter Topaz, output or ZIP");
});

test("Call 11 duplicates, edits the copy, and proves the branded set unchanged", () => {
  const stage = claimantSource.slice(
    claimantSource.indexOf('stage.stage_key === "panels.delogo"'),
    claimantSource.indexOf('stage.stage_key === "pack.verify"'),
  );
  // The duplicate is persisted by Call 10, so Call 11 edits bytes it read back
  // from that duplicate's own storage path. The branded panel's bytes are never
  // loaded into the edit path at all -- a stronger independence guarantee than
  // copying them in memory, and the reason the old Buffer.from(branded) copy is
  // gone rather than merely renamed.
  assert.match(stage, /const duplicate = await storageBytes\(sb, duplicateRow\.storage_path\)/,
    "the edit works on the independently persisted Call 10 duplicate");
  assert.ok(
    !/storageBytes\(sb, brandedRow\.storage_path\)[\s\S]*?\.composite\(/.test(stage),
    "the branded panel's bytes must never reach the de-logo edit",
  );
  assert.match(stage, /call11_branded_receipt_mismatch/, "the source must match the Call 9 receipt");
  assert.match(stage, /call11_branded_panel_mutated/, "the branded set is re-hashed after the edit");
  assert.match(stage, /call11_call10_duplicate_mutated/, "the Call 10 duplicate set is re-hashed after the edit");
  assert.match(stage, /sourcePanelHash: expectedBrandedHash/, "each QC panel binds to its source branded hash");
  assert.match(stage, /sourceDuplicateHash: expectedDuplicateHash/, "each QC panel binds to the duplicate it was cut from");
  assert.match(stage, /authoritative: false/);
  assert.match(stage, /printable: false/);
  assert.match(stage, /qc-panels\/\$\{surface\}\.png/, "duplicates land in their own directory");
  assert.ok(!stage.includes('artifact("panel"'), "Call 11 must never write a production panel");
});

test("a Call 11 write is inside the resumable upload allowlist", () => {
  const spool = readFileSync(join(root, "runtime", "zip-spool.cjs"), "utf8");
  assert.match(spool, /qc-panels\\\/\(\?:driver\|passenger\|hood\|roof\|front\|rear\)\\\.png/,
    "large QC duplicates must not fail closed on the TUS path");
});
