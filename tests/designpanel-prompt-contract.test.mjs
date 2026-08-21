import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildDesignPanelPrompt,
  buildDesignPanelRequestParts,
} from "../supabase/functions/generate-color-render/designpanel-contract.mjs";

const sha256 = (value) => createHash("sha256")
  .update(typeof value === "string" ? value : JSON.stringify(value))
  .digest("hex");

const prompt = buildDesignPanelPrompt({
  vehicle: "2024 Ford F-250",
  viewType: "passenger-side",
  panelName: "Flamingo Pools",
  finish: "Gloss",
  designAnchorText: "blue wave, exact white lettering",
  briefText: "Deep blue pool-water wrap",
  hasHeroReference: true,
  cameraAngle: "CAMERA LOCK",
  studioEnvironment: "STUDIO ENV",
  wrapCoverageRules: "WRAP COVERAGE RULES",
});

const references = [
  { label: "pattern-primary", inlineData: { mimeType: "image/png", data: "abc123" } },
  { label: "hero-reference", inlineData: { mimeType: "image/png", data: "abc123" } },
];

test("the in-place DesignPanel path preserves the proven DesignIQ V3 prompt", () => {
  assert.equal(prompt.length, 1752);
  assert.equal(sha256(prompt), "202664cf52eab4d2168d781cb442b9ae741baec123f420c153a9cb8407e8bfbf");
  assert.match(prompt, /same wrap design from the passenger side angle/i);
  assert.match(prompt, /WRAP COVERAGE RULES/);
  assert.match(prompt, /DESIGN PLACEMENT:/);
});

test("the four Gemini tiers preserve canonical prefixes, references, and modalities", () => {
  const expected = [
    [1, "1c86c6602ca42f8a4d8563c2bf673a84ba497fdd160388435ac11025cd68def9", ["TEXT", "IMAGE"], 3],
    [2, "69d7ba1d9bbb0d37f2e06a0b05ac6b889c0055485daf593e55931e6a8f50149f", ["TEXT", "IMAGE"], 3],
    [3, "ee8c5febfea02d545bc8758f3a7c1f87bd13d041c10e8fcbb7fa8a00eb828f79", ["IMAGE"], 3],
    [4, "85def344b23dc9b503d0f106ac8189bcf42330de171dddbe228455c89cdb29df", ["TEXT", "IMAGE"], 3],
  ];

  for (const [attempt, expectedHash, modalities, partCount] of expected) {
    const request = buildDesignPanelRequestParts({ attempt, prompt, references });
    assert.equal(sha256(request), expectedHash);
    assert.deepEqual(request.modalities, modalities);
    assert.equal(request.parts.length, partCount);
  }
});
