import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "runtime", "designpro-standalone-claimant.cjs"), "utf8");

function block(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + 1);
  assert.ok(start >= 0 && end > start, `${from} block must exist`);
  return source.slice(start, end);
}

test("Call 10 persists six byte-identical panel-duplicate artifacts before Call 11", () => {
  const call10 = block('stage.stage_key === "logos.extract"', 'const LOGO_LOCATE_MODEL');
  assert.match(call10, /artifacts\(sb, run\.id, \["panel"\]\)/);
  assert.match(call10, /Buffer\.from\(branded\)/);
  assert.match(call10, /artifact\("panel-duplicate"/);
  assert.match(call10, /panel-duplicates\/\$\{surface\}\.png/);
  assert.match(call10, /stored\.hash !== sourceHash/);
  assert.match(call10, /duplicateSetVerified:\s*true/);
  assert.match(call10, /duplicatePanelHashes/);
});

test("Call 11 consumes persisted Call 10 duplicates and never edits them in place", () => {
  const call11 = block('stage.stage_key === "panels.delogo"', 'stage.stage_key === "pack.verify"');
  assert.match(call11, /artifacts\(sb, run\.id, \["panel-duplicate"\]\)/);
  assert.match(call11, /duplicateSetVerified !== true/);
  assert.match(call11, /call11_duplicate_changed/);
  assert.match(call11, /sourceDuplicateHash/);
  assert.match(call11, /call11_call10_duplicate_mutated/);
  assert.ok(!call11.includes('artifact("panel-duplicate"'), "Call 11 must not rewrite the saved Call 10 duplicates");
});
