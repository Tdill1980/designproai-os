import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");

test("atlasRun is claim-scoped across flat-first authoring and proof join", () => {
  const hoist = source.indexOf("let atlasRun = null;");
  const flatBlock = source.indexOf("if (isFlatFirst) {");
  const assignment = source.indexOf("atlasRun = generateOrReuseFlatAtlas({");
  const join = source.indexOf("flatAtlas = await atlasRun;");
  assert.ok(hoist > 0);
  assert.ok(flatBlock > hoist);
  assert.ok(assignment > flatBlock);
  assert.ok(join > assignment);
  assert.equal(source.includes("const atlasRun = generateOrReuseFlatAtlas({"), false);
});
