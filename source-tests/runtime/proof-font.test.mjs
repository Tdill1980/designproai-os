import { strict as assert } from "node:assert";
import test from "node:test";
import { createRequire } from "node:module";
import { existsSync, statSync } from "node:fs";

const require = createRequire(import.meta.url);
const { outlineString, parseFont } = require("../../runtime/opentype-outline.cjs");

// The one path the claimant hands Call 8 as proofFont. Same default, same
// override, so this guard fails if either drifts away from what ships.
const PROOF_FONT_PATH = process.env.DESIGNPRO_PROOF_FONT_PATH
  || "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

test("the proof typesetting face is present", () => {
  assert.ok(existsSync(PROOF_FONT_PATH), `no proof font at ${PROOF_FONT_PATH}`);
  assert.ok(statSync(PROOF_FONT_PATH).size > 0, "the proof font file is empty");
});

test("opentype-outline can parse it", () => {
  const font = parseFont(require("node:fs").readFileSync(PROOF_FONT_PATH));
  assert.ok(font.unitsPerEm > 0, "unitsPerEm must be readable");
  assert.ok(font.ascender > 0, "ascender must be readable");
});

test("Call 8 can set the strings the proof actually prints", () => {
  const fontBytes = require("node:fs").readFileSync(PROOF_FONT_PATH);
  // A side label and a GENIE dimension callout — the two kinds of type on the
  // sheet. If either outlines to nothing, the proof would render blank text.
  for (const string of ["Driver Side", '153" × 56"']) {
    const outlined = outlineString({ fontBytes, string, sizeIn: 1, pxPerInch: 96 });
    assert.ok(outlined.path.length > 0, `${string} produced no outline geometry`);
    assert.ok(outlined.widthPx > 0, `${string} produced no advance width`);
  }
});
