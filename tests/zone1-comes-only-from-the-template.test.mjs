/**
 * ZONE 1 IS CUT FROM THE TEMPLATE. NOTHING ELSE MAY PRODUCE IT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-23, after a per-panel "resolution pass" was built, shipped and
 * rolled back in one night: *"we must use the code built template that's
 * already zoned tricolor"* — and, on the rollback: *"delete the bad one so we
 * can't make this mistake ever."*
 *
 * ⛔ WHAT WAS BUILT AND WHY IT WAS WRONG. Each Zone 1 panel was re-authored on
 * its OWN BLANK CANVAS through `atlas-author` and pasted back into the sheet.
 * It measured well (5.0 -> 24.6 px/in) and it was still wrong, because it made
 * a SECOND PRODUCER of the panels the proof is supposed to be the only source
 * of: no zone bands, no colour coding, no dimensioned cell, no template at all.
 * The whole architecture rests on "the Production Panel Proof IS the source and
 * every print file is cut from it", and that sentence stops being true the
 * moment a panel arrives from somewhere else.
 *
 * CLAUDE.md said so already, in the list of things Call 1 does NOT change:
 * *"one image call, single turn, the code-drawn colour-coded template, the
 * six-across sheet, the cutter, the gates."* It was read, quoted in the commit
 * message, and violated in the same commit. This file is what that cost.
 *
 * ✅ THE LEGITIMATE LEVER IS THE TEMPLATE ITSELF. Zone 1 cells are 272px wide
 * on a 1536px template, which is what pins every surface at ~5.06 px/in --
 * measured, not inferred, by running `layoutRow` over a real manifest. Laying
 * the band out three-across or two-across raises that 1.7x-2.5x with the SAME
 * single image call, the same cutter and the same gates. That is a geometry
 * change inside `atlas-proof-container-template.cjs`, and it is the only shape
 * of resolution fix this architecture permits.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { existsSync } from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** Comments discuss the retired design by name; only executable code counts. */
const code = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("the per-panel re-author module is deleted, not merely switched off", () => {
  assert.equal(existsSync(new URL("../runtime/atlas-panel-refine.cjs", import.meta.url)), false,
    "a module behind an off flag is one dispatch away from running again");
  for (const f of ["tests/atlas-panel-refine.test.mjs", "tests/atlas-panel-refine-wiring.test.mjs"]) {
    assert.equal(existsSync(new URL(`../${f}`, import.meta.url)), false, `${f} must go with it`);
  }
});

test("no deploy can turn it back on: the flag exists nowhere", () => {
  for (const f of ["ops/configure-env.sh", "ops/validate-env.py",
    ".github/workflows/deploy-production.yml", "ops/ci-dark-deploy.sh"]) {
    assert.doesNotMatch(read(f), /PANEL_REFINE|panel_refine/,
      `${f} must not carry a switch for a producer that no longer exists`);
  }
});

test("the Call-1 assembler produces Zone 1 from the sheet and calls no author edge", () => {
  const topology = code(read("runtime/atlas-panel-proof-topology.cjs"));
  // The ONE image request is the sheet. The assembler that follows it is
  // deterministic: it cuts, gates, places and assembles. It holds no transport
  // to any generation endpoint, so it cannot mint a panel of its own.
  assert.doesNotMatch(topology, /callAuthorEdge|authorSurface|createAtlasAuthorTransport/,
    "the assembler must have no door to an authoring edge");
  // Zone 1 is read off the returned sheet, with Zone 2, in one cut.
  assert.match(topology, /zones: \["zone1", "zone2"\]/,
    "both panel bands come from the one sheet the designer drew");
});

test("the template is the only thing that decides a Zone 1 cell's size", () => {
  const tpl = read("runtime/atlas-proof-container-template.cjs");
  // `layoutRow` is that decision, and the gate reads the same rectangles the
  // sheet drew -- RULE 0.27, the code owns the geometry. A second place that
  // computes a cell is how the drawing and the cut drift apart.
  assert.match(tpl, /function layoutRow\(/);
  assert.match(tpl, /BAND = Object\.freeze\(\{ zone1:/,
    "one frozen band geometry, shared by the drawing and the gate");
});
