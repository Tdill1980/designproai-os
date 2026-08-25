import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/src/pages/DesignPanelProPremium.tsx", import.meta.url), "utf8");

test("See All Views is available as soon as Driver Side exists", () => {
  // The reveal now sits inside the decision the customer is asked the moment
  // Driver Side lands -- see all sides, or revise -- so the guard it is
  // conditioned on is a little further above the label than it used to be. The
  // condition itself is unchanged and is what this asserts.
  const label = source.lastIndexOf("See All Views");
  assert.ok(label > 0, "the See All Views action is missing");
  const button = source.slice(label - 2500, label + 900);
  assert.match(button, /mainDisplayUrl\s*&&\s*!allViewsRevealed/);
  // And the customer can say no there, without waiting out six more proofs.
  assert.match(button, /Do you want to see all sides of this design, or revise it\?/);
  assert.match(button, /Revise This Design/);
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

test("later sides stay hidden until the existing reveal action is clicked", () => {
  assert.match(source, /const displayedAllViews = allViewsRevealed \? sortedAllViews : \[\]/);
  assert.match(source, /allViewsRevealed && \(displayedAllViews\.length > 0 \|\| failedViews\.length > 0\)/);
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
