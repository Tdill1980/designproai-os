// THE MASTER IS AUTHORED AT THE HIGHEST RESOLUTION THE MODEL OFFERS.
// (Trish 2026-08-27: "Make sure atlas is highest possible 4K or more".)
//
// Three things have to hold together, and only the first is obvious:
//   1. the request pins Gemini's maximum (imageSize "4K", square);
//   2. the canvas is 4096x4096;
//   3. a SMALLER return is stretched onto that canvas, so the master reports
//      4096 either way — the delivered size must be recorded and surfaced, or
//      "Call 1 is 4K" is unprovable.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const edge = readFileSync(join(ROOT, "supabase/functions/design-panel-ai-generate/index.ts"), "utf8");
const runtime = readFileSync(join(ROOT, "runtime/flat-first-atlas.cjs"), "utf8");
const board = readFileSync(join(ROOT, "app/src/pages/AdminGeminiCompareStudio.tsx"), "utf8");
const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));

test("Call 1 asks for the model's maximum, square", () => {
  assert.match(handler, /imageConfig: \{ aspectRatio: "1:1", imageSize: "4K" \}/);
});

test("the production canvas is 4096 square", () => {
  assert.match(runtime, /const CANVAS = Object\.freeze\(\{ widthPx: 4096, heightPx: 4096 \}\)/);
});

test("what Gemini actually delivered is measured, not assumed", () => {
  // The resize fills to 4096 regardless, so the delivered size is the only
  // evidence of true optical resolution.
  assert.match(runtime, /deliveredWidthPx: Number\(metadata\.width\)/);
  assert.match(runtime, /nativelyFourK: Number\(metadata\.width\) >= CANVAS\.widthPx/);
  assert.match(runtime, /masterNativelyFourK: masterDelivery\?\.nativelyFourK/);
});

test("a re-roll is the identical primary request — no corrective note rides any attempt", () => {
  // Owner boundary contract 2026-09-01: NO correctiveNote for the primary
  // generation. Every authoring attempt sends the same request; temperature
  // 1.0 supplies the variation, and the delivered size stays measured (above)
  // rather than negotiated in prose.
  assert.doesNotMatch(runtime, /correctiveNote/);
  assert.doesNotMatch(runtime, /CORRECTION -- the previous sheet was refused/);
  assert.match(runtime, /atlasEdgeRequestBody\(authoringInput, manifest, edgeExtras\)/);
});

test("PanelPro shows the delivered size, so 4K is checkable rather than claimed", () => {
  assert.match(board, /deliveredWidthPx.*deliveredHeightPx/s);
  assert.match(board, /native 4K/);
});
