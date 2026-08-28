import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const panelPro = readFileSync(
  new URL("../app/src/pages/AdminGeminiCompareStudio.tsx", import.meta.url),
  "utf8",
);
const source = readFileSync(
  new URL("../app/src/lib/panelpro-studio-source.ts", import.meta.url),
  "utf8",
);

/**
 * THE BOARD CONTRADICTED THE PIPELINE ON ONE LIVE JOB.
 *
 * 04cc0b29-0a9a-4229-b3e0-6e7428c70be4, master a4dfe5244c00cd55: PanelPro read
 * "Print panels 0/6" while RevisionStudio showed all six, and "3D proofs 8/7 -
 * All seven views saved" while roof and close-up did not exist. Neither number
 * was a pipeline fault; both were this card's arithmetic.
 */

/** `all_view_urls` is alias-expanded ON PURPOSE, so it can never be a count. */
test("every view is written under two names, which is why keys cannot be counted", () => {
  assert.match(source, /urls\[view\.sourceViewType\] = view\.signedUrl;/);
  assert.match(source, /if \(role\) urls\[role\] = view\.signedUrl;/);
  assert.doesNotMatch(
    panelPro,
    /const proofCount = Object\.values\(proofUrls\)/,
    "counting all_view_urls keys double-counts every aliased camera (side/driver, "
      + "passenger-side/passenger, hood_detail/hood, close-up/closeup)",
  );
});

/** One proof is one camera. */
test("the proof count is the distinct set of rendered cameras", () => {
  assert.match(panelPro, /const proofCameras = new Set\(/);
  assert.match(panelPro, /\(job\.raw_views \|\| \[\]\)/);
  assert.match(panelPro, /\.map\(\(view\) => String\(view\.sourceViewType\)\),/);
  assert.match(panelPro, /const proofCount = proofCameras\.size;/);
});

/**
 * "Six panels cut" is a Call 1 fact. "Promoted" is a Call 9 fact. A run that
 * fails inside Calls 1-7 has the first and not the second, and the card must
 * not report the second under the first's name.
 */
test("the panel row counts the Call 1 cut set and states promotion separately", () => {
  assert.match(
    panelPro,
    /const cutPanels = new Set\(\(atlas\?\.callOnePanels \|\| \[\]\)\.map\(\(panel\) => panel\.surfaceKey\)\);/,
  );
  assert.match(
    panelPro,
    /const panelCount = PRODUCTION_SURFACES\.filter\(\(side\) => cutPanels\.has\(side\)\)\.length;/,
  );
  assert.match(panelPro, /promoted by Call 9/);
  assert.doesNotMatch(
    panelPro,
    /const panelCount = PRODUCTION_SURFACES\.filter\(\(side\) => panels\[side\]\?\.gemini_url\)/,
  );
});
