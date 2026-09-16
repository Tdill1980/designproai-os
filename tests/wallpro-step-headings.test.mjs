import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "Shows steps and then the start", with proper icons (Trish 2026-09-16).
 *
 * WallPro's form is one continuous, deeply conditional flow -- five design
 * intents, a live two-pane preview beside it -- not four equal boxes of
 * interchangeable content, so a literal side-by-side row was rejected in
 * favor of numbered, iconed headings over the SAME existing sections and
 * conditionals. This locks that the narrative survives (four numbered steps,
 * each with a real lucide icon) and that nothing about the underlying form
 * (state, handlers, conditions) was reshaped to get there.
 */
const root = resolve(import.meta.dirname, "..");
const WALLPRO = readFileSync(resolve(root, "app/src/pages/WallPro.tsx"), "utf8");

test("WallPro reads as four numbered, iconed steps", () => {
  assert.match(WALLPRO, /function StepHeading\(/);
  for (const n of [1, 2, 3, 4]) {
    assert.match(WALLPRO, new RegExp(`<StepHeading n=\\{${n}\\}`), `step ${n} is present`);
  }
  // Every step names a real lucide icon, not a placeholder.
  assert.match(WALLPRO, /<StepHeading n=\{1\} icon=\{Upload\}>Upload your wall<\/StepHeading>/);
  assert.match(WALLPRO, /<StepHeading n=\{2\} icon=\{LayoutGrid\}>Choose your design<\/StepHeading>/);
  assert.match(WALLPRO, /<StepHeading n=\{3\} icon=\{designMode === 'library' \? ImageIcon : Settings2\}>/);
  assert.match(WALLPRO, /<StepHeading n=\{4\} icon=\{ImageIcon\}>Preview/);
});

test("the step headings did not reshape the underlying form", () => {
  // Same section ids, same conditional tree, same generate button -- this
  // was a heading change, not a rewrite of the working upload/select/
  // describe/generate flow.
  assert.match(WALLPRO, /id="upload-wall"/);
  assert.match(WALLPRO, /id="choose-design"/);
  assert.match(WALLPRO, /id="wall-preview"/);
  assert.match(WALLPRO, /designMode === 'library' \? <div className="space-y-3">/);
  assert.match(WALLPRO, /onClick=\{\(\) => void generate\(\)\}/);
});
