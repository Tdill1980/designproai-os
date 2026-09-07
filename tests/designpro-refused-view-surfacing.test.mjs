/**
 * A REFUSED VIEW MUST REACH THE SCREEN, WITH ITS REASON.
 *
 * Live evidence, generation e3ade856 (2026-09-07, 2022 Ford Transit Connect):
 * the passenger-side proof was rendered twice and refused twice by the proof
 * inspector on `atlasContinuityContract` -- "Artwork from the authority crop
 * (Hood) is not present on the vehicle's passenger side" -- and the slot ended
 * `state='failed'`, `reason='provider_attempts_exhausted'`.
 *
 * Everything server-side recorded that correctly. `get_designpro_generation_
 * request` builds `failedShots` from `designpro_generation_slots`; the gateway's
 * `validatedGenerationStatus` forwards it; `GenerationRequestState` types it;
 * and the run completed as an honest PARTIAL set with `callsCompleted: 6` and
 * `refusedViews: [{sourceViewType:"passenger-side", reason:"provider_attempts_
 * exhausted"}]` on the receipt. The A.T.L.A.S. partial path is deliberate
 * (owner, 2026-08-27): one refused proof may not destroy six good panels.
 *
 * The browser threw it away. `failedViews` was derived ONLY from persisted views
 * that came back without a signed URL, and a refused slot never persists a view
 * at all -- so `failedViews` was empty, the failure banner never rendered, no
 * retry card appeared, and the customer saw six view tabs and one sentence:
 * "Finish all 7 design views to order." A diagnosis that existed end to end and
 * stopped one hop short of the person who needed it.
 *
 * This pins the join. It is source-level on purpose: the hook is React state
 * over a network read, and what matters is that the two sources of "absent" are
 * unioned and that the reason survives to the surfaces that explain it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const APP = resolve(import.meta.dirname, "..", "app", "src");
const read = (...parts) => readFileSync(join(APP, ...parts), "utf8");

test("the hook joins server-refused slots into failedViews and keeps their reasons", () => {
  const hook = read("hooks", "useDesignPanelProLogic.ts");

  // The server's refusals are captured, with reasons, when status is applied.
  assert.match(hook, /setRefusedShots\(/, "refused shots are never captured from the request status");
  assert.match(
    hook,
    /state\.failedShots \|\| \[\]\)\.map\(\(shot\) => \(\{[\s\S]{0,200}reason: shot\.reason \?\? null/,
    "the refusal reason is dropped on the way in",
  );

  // Both ways a view can be absent are unioned before export.
  assert.match(
    hook,
    /new Set\(\[\.\.\.failedViews, \.\.\.refusedShots\.map\(\(shot\) => shot\.sourceViewType\)\]\)/,
    "failedViews must union URL-less views with server-refused slots",
  );
  assert.match(hook, /failedViews: resolvedFailedViews/, "the unioned list is not the one exported");
  assert.match(hook, /failedViewReasons/, "reasons are not exported for the surfaces that explain the absence");

  // Reset must clear it, or a refusal outlives the design it belonged to.
  assert.match(hook, /setRefusedShots\(\[\]\)/, "refused shots survive a reset");

  // THE DEFECT, PINNED: deriving failedViews only from unsigned views is what
  // made a refused slot invisible. The bare assignment must not come back.
  const bareDerivation = /setFailedViews\(\s*views\.filter\(\(view\) => !view\.signedUrl\)\.map\(\(view\) => view\.sourceViewType\),?\s*\)/;
  assert.match(hook, bareDerivation, "the unsigned-view source is still one half of the join");
  assert.doesNotMatch(
    hook,
    /failedViews,\n\s+retryFailedView/,
    "the raw failedViews state is exported again, so refused slots are invisible",
  );
});

test("the design surface names the refused view and says why", () => {
  const page = read("pages", "DesignPanelProPremium.tsx");

  assert.match(page, /failedViewReasons/, "the surface never reads the refusal reasons");
  // The banner lists each absent view by label rather than only a count.
  assert.match(
    page,
    /failedViews\.map\(\(viewType\) => \([\s\S]{0,400}VIEW_LABEL_MAP\[viewType\][\s\S]{0,300}failedViewReasons\?\.\[viewType\]/,
    "the failure banner still reports only a count, not which view and why",
  );
  // A view with no recorded reason still says something honest.
  assert.match(page, /not generated/, "an absent view with no server reason is left unexplained");
});
