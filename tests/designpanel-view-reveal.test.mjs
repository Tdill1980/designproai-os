import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/src/pages/DesignPanelProPremium.tsx", import.meta.url), "utf8");

test("See All Views is available as soon as Driver Side exists", () => {
  const label = source.lastIndexOf("See All Views");
  assert.ok(label > 0, "the See All Views action is missing");
  const button = source.slice(label - 500, label + 100);
  assert.match(button, /mainDisplayUrl\s*&&\s*!allViewsRevealed/);
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
  assert.match(source, /isFlatFirstDiagnostic && pipelineActive && !renderError && !savedDriverDisplayUrl/);
});

test("the reveal state never controls production completion", () => {
  const completion = source.slice(
    source.indexOf("const allViewsDone"),
    source.indexOf("const activeViewLabel"),
  );
  assert.match(completion, /requiredViewTypes\.every/);
  assert.doesNotMatch(completion, /allViewsRevealed|displayedAllViews/);
});
