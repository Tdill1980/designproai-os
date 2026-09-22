import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "Shows steps and then the start", with proper icons (Trish 2026-09-16).
 *
 * WallPro's form is one continuous, deeply conditional flow -- five design
 * intents, a live two-pane preview beside it -- so this locks that the
 * narrative survives (four numbered steps, each with a real lucide icon) and
 * that nothing about the underlying form (state, handlers, conditions) was
 * reshaped to get there.
 *
 * ⚠️ THE OWNER REVERSED HALF OF THIS ON 2026-09-22, AND THE REVERSAL IS THE
 * POINT OF THE REWRITE BELOW -- DO NOT "RESTORE" THE OLD TITLES.
 *
 * The 09-16 note that used to sit here said a literal side-by-side row "was
 * rejected in favor of numbered, iconed headings over the SAME existing
 * sections". The owner sent a tool mockup and said "It should be like this":
 * a four-card row IS the shape now, and it carries HER four steps --
 *
 *     1 Upload your wall · 2 Select wall area · 3 Describe your design ·
 *     4 Generate & preview
 *
 * -- which is not the page's old numbering. "Choose your design" is no longer
 * a numbered step: the five priced paths moved under the brief as "More ways
 * to start", every price still on its own row. And SELECT WALL AREA became a
 * step because it never was one: marking the wall lived unlabelled inside
 * step 1's photo block, below the fold on a phone, which is why "it did not
 * allow me or instruct me to pin corners", "how do you mask the closet" and
 * "it's still making me scroll down" were one fact reported three times.
 *
 * THIS FILE WENT RED ON MAIN BEFORE ANYONE NOTICED, which is the other lesson
 * worth keeping. #612 had just removed `npm test` from the release gate, so a
 * fully green PR gate sat over a red contract suite, and the locally-run
 * result quoted at the time was from an earlier commit. A gate that no longer
 * runs a suite cannot be cited for it.
 */
const root = resolve(import.meta.dirname, "..");
const WALLPRO = readFileSync(resolve(root, "app/src/pages/WallPro.tsx"), "utf8");

test("WallPro reads as four numbered, iconed steps", () => {
  assert.match(WALLPRO, /function StepHeading\(/);
  for (const n of [1, 2, 3, 4]) {
    assert.match(WALLPRO, new RegExp(`<StepHeading n=\\{${n}\\}`), `step ${n} is present`);
    // Exactly once each: two headings sharing a number is the
    // two-numbering-systems defect the UX pass already removed.
    assert.equal(
      (WALLPRO.match(new RegExp(`<StepHeading n=\\{${n}\\}`, "g")) || []).length, 1,
      `step ${n} is numbered exactly once`,
    );
  }
  // Every step names a real lucide icon, not a placeholder.
  assert.match(WALLPRO, /<StepHeading n=\{1\} icon=\{Upload\}>Upload your wall<\/StepHeading>/);
  assert.match(WALLPRO, /<StepHeading n=\{2\} icon=\{Ruler\}>Select wall area<\/StepHeading>/);
  assert.match(WALLPRO, /<StepHeading n=\{3\} icon=\{Settings2\}>Describe your design<\/StepHeading>/);
  assert.match(WALLPRO, /<StepHeading n=\{4\} icon=\{ImageIcon\}>Generate &amp; preview<\/StepHeading>/);
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

test("step 2 is a real step with somewhere to go", () => {
  // A numbered step the board names but cannot open is worse than no step.
  assert.match(WALLPRO, /id="select-wall-area"/);
  assert.match(WALLPRO, /\{ id: 'select-wall-area', n: 2, label: 'Select wall area'/);
});

test("the priced paths are demoted, never deleted", () => {
  // The 2026-09-13 launch rule: the price rides the choice, never a checkout.
  assert.match(WALLPRO, /More ways to start &mdash; and what each costs/);
  assert.match(WALLPRO, /\{formatMoney\(WALL_DESIGN_SKUS\[option\.mode\]\.cents\)\}/);
  for (const mode of ["library", "match", "wall", "ai", "upload"]) {
    assert.match(WALLPRO, new RegExp(`mode: '${mode}'`), `${mode} path still offered`);
  }
});
