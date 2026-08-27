// EVERY PANELPRO CONTAINER IS DOWNLOADABLE, AND SAYS ITS UPSCALE STATE.
// (Trish 2026-08-27: "make sure PanelProStudio containers have download button
// and are upscaled".)
//
// RULE 0.22 already required it — "The complete asset set, each individually
// downloadable" and "Do not hide files behind only a final ZIP" — but the
// per-surface list reported an upscale state in prose with nothing to click, so
// a designer could see a panel existed and still have no way to take it to a
// vehicle template.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const board = readFileSync(join(ROOT, "app/src/pages/AdminGeminiCompareStudio.tsx"), "utf8");
const surfaceList = board.slice(
  board.indexOf("EVERY CONTAINER IS DOWNLOADABLE"),
  board.indexOf("{job.outputs.length === 0"),
);

test("each surface offers its active panel as a download", () => {
  assert.match(surfaceList, /withDownloadName\(active\.signedUrl/);
  assert.match(surfaceList, /Corrected panel|Source panel/);
  // A corrected panel supersedes the branded one as the active artifact, which
  // is what the design team must actually take to the template.
  assert.match(surfaceList, /const active = correction \|\| branded/);
});

test("the upscaled derivative is offered BESIDE the source, never instead of it", () => {
  // RULE 0.22 keeps SOURCE PANEL, UPSCALED DERIVATIVE and ACTIVE PRODUCTION
  // DERIVATIVE all retained and displayed; replacing one with the other loses
  // the comparison the team needs to judge what the enhancement did.
  assert.match(surfaceList, /withDownloadName\(enhanced\.signedUrl/);
  assert.match(surfaceList, /Upscaled/);
  assert.ok(!/enhanced \|\| active/.test(surfaceList), "the upscale must not replace the source panel link");
});

test("the upscale state is still stated, and honestly", () => {
  assert.match(surfaceList, /upscaled.*not upscaled yet/s);
  // A surface with no panel says so rather than rendering a dead link.
  assert.match(surfaceList, /panel not cut yet/);
});

test("pixel dimensions ride the label so resolution is checkable at a glance", () => {
  assert.match(surfaceList, /const dims = /);
  assert.match(surfaceList, /pixelWidth \?\? artifact\?\.metadata\?\.widthPx/);
});

test("the preflight checklist stays HUMAN — machine evidence never ticks a box", () => {
  // Owner: "QC Checklist is human designer checklist."
  assert.match(board, /MACHINE EVIDENCE ONLY/);
  assert.match(board, /never counts as one of their ticks/);
});
