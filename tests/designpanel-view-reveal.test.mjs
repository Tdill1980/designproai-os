import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/src/pages/DesignPanelProPremium.tsx", import.meta.url), "utf8");

test("See All Views is available as soon as Driver Side exists", () => {
  // ⚠️ THIS ASSERTION USED TO READ `mainDisplayUrl && !viewsVisible` ON THE
  // WHOLE BLOCK, AND THAT PINNED A DEFECT. `viewsVisible` is unconditionally
  // true on the panel-proof pipeline, so gating the container on it deleted
  // the ONLY navigation to RevisionStudio from this screen -- RULE 0.23's
  // "then ask" half -- on every run the product actually serves.
  //
  // The two actions answer different questions, so they no longer share a
  // gate: the container appears as soon as there is a design, "See All Views"
  // alone carries `!viewsVisible`, and the revise action is offered either way.
  const label = source.lastIndexOf("See All Views");
  assert.ok(label > 0, "the See All Views action is missing");
  const button = source.slice(label - 2500, label + 2200);
  assert.doesNotMatch(
    button,
    /mainDisplayUrl\s*&&\s*!viewsVisible/,
    "the reveal gate must not be back on the block that holds the revise action",
  );
  assert.match(button, /\{mainDisplayUrl && \(/);
  assert.match(button, /\{!viewsVisible && \(\s*<Button\s+onClick=\{handleGenerateAllViews\}/);

  // And the reveal's gate CLOSES before the revise button, so that button is
  // outside it -- the thing the old contiguous regex could never tell apart.
  const gateOpen = source.indexOf("{!viewsVisible && (", label - 2500);
  const gateClose = source.indexOf(")}", label);
  const reviseAt = source.indexOf("Open in RevisionStudio", label);
  assert.ok(
    gateOpen > 0 && gateOpen < label && label < gateClose && gateClose < reviseAt,
    "Open in RevisionStudio must sit outside the !viewsVisible conditional",
  );

  // And the customer can say no there, without waiting out six more proofs.
  // THAT DECISION is what RULE 0.23 protects, and it is unchanged. The label
  // was "Revise This Design" until 2026-08-29, when the owner renamed it to
  // "Open in RevisionStudio" as part of making the job identity travel between
  // screens. The wording is presentation; the decision point is the rule.
  assert.match(button, /Do you want to see all sides of this design, or revise it\?/);
  assert.match(button, /Open in RevisionStudio/);
  assert.doesNotMatch(button, /!pipelineActive/);

  const handler = source.slice(
    source.indexOf("const handleGenerateAllViews"),
    source.indexOf("const handleOrderProductionPack"),
  );
  assert.ok(
    handler.indexOf("setAllViewsRevealed(true)") < handler.indexOf("if (!generatedImageUrl) return"),
    "the existing action must reveal progressive server views immediately",
  );
});

test("ATLAS reveals completed views automatically while legacy keeps its reveal action", () => {
  assert.match(source, /const viewsVisible = isFlatFirstDiagnostic \|\| allViewsRevealed/);
  assert.match(source, /const displayedAllViews = viewsVisible \? sortedAllViews : \[\]/);
  assert.match(source, /viewsVisible && \(displayedAllViews\.length > 0 \|\| failedViews\.length > 0\)/);
  assert.match(source, /const savedDriverDisplayUrl = findViewByType\('side'\)\?\.url \|\| null/);
  assert.match(source, /const driverDisplayUrl = savedDriverDisplayUrl \|\| \(!isFlatFirstDiagnostic \? baseDisplayUrl : null\)/);
  // The canonical master no longer stands in for a missing Driver while the
  // proofs render. It is a production instrument, not a customer proof.
  assert.doesNotMatch(source, /atlasMasterPreviewUrl/);
});

test("the reveal state never controls production completion", () => {
  const completion = source.slice(
    source.indexOf("const allViewsDone"),
    source.indexOf("const activeViewLabel"),
  );
  assert.match(completion, /requiredViewTypes\.every/);
  assert.doesNotMatch(completion, /allViewsRevealed|displayedAllViews/);
});


test("completed Call 1 proof mounts before the 3D window and never waits for its image", () => {
  const loader = source.indexOf("<AtlasPanelProofSheetLoader");
  const window = source.indexOf('id="preview-section"');
  assert.ok(loader > 0 && loader < window);
  const before = source.slice(loader - 140, loader);
  assert.match(before, /generationRequestState\?\.requestId/);
  assert.doesNotMatch(before, /mainDisplayUrl|allViewsRevealed|viewsVisible/);
  assert.match(source.slice(loader, loader + 600), /pollWhilePending=/);
});
