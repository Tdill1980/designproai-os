import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const topaz = require("../../runtime/topaz-upscale.cjs");
const claimantSource = readFileSync(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");

const enabledEnv = { DESIGNPRO_TOPAZ_ENABLED: "true", TOPAZ_API_KEY: "test-key" };

test("the enhancement mode is explicit and fails closed when half-configured", () => {
  assert.equal(topaz.topazReadiness(enabledEnv).available, true);
  assert.equal(topaz.topazReadiness({ DESIGNPRO_TOPAZ_ENABLED: "false" }).enabled, false);
  // Enabled without a key is a configuration error, never a silent skip.
  const halfConfigured = topaz.topazReadiness({ DESIGNPRO_TOPAZ_ENABLED: "true" });
  assert.equal(halfConfigured.configurationValid, false);
  assert.match(halfConfigured.detail, /TOPAZ_API_KEY is required/);
  // An unset or fuzzy mode is not treated as off.
  for (const value of ["", "yes", "1", undefined]) {
    assert.equal(topaz.topazReadiness({ DESIGNPRO_TOPAZ_ENABLED: value }).configurationValid, false);
  }
});

test("the upscale plan is clamped to the documented engine ceilings", () => {
  // 5216x2112 panel cut -> 24450x9900 print target is about 4.7x, inside 6x.
  const inside = topaz.upscalePlan({ sourceWidthPx: 5216, sourceHeightPx: 2112, targetWidthPx: 24450, targetHeightPx: 9900 });
  assert.equal(inside.clampedByEngineCeiling, false);
  assert.equal(inside.outputWidth, 24450);
  assert.ok(inside.appliedScale <= topaz.TOPAZ_MAX_SCALE);

  // A demand beyond 6x is clamped and the receipt says so rather than implying
  // the whole distance was enhanced.
  const clamped = topaz.upscalePlan({ sourceWidthPx: 1000, sourceHeightPx: 500, targetWidthPx: 20000, targetHeightPx: 10000 });
  assert.equal(clamped.clampedByEngineCeiling, true);
  assert.equal(clamped.appliedScale, topaz.TOPAZ_MAX_SCALE);
  assert.equal(clamped.outputWidth, 6000);

  // The 32,000 px edge ceiling binds before 6x on very wide panels.
  const edge = topaz.upscalePlan({ sourceWidthPx: 8000, sourceHeightPx: 2000, targetWidthPx: 48000, targetHeightPx: 12000 });
  assert.ok(edge.outputWidth <= topaz.TOPAZ_MAX_OUTPUT_EDGE_PX);

  assert.throws(() => topaz.upscalePlan({ sourceWidthPx: 4000, sourceHeightPx: 1000, targetWidthPx: 400, targetHeightPx: 100 }), /not larger/);
  assert.throws(() => topaz.upscalePlan({ sourceWidthPx: 0, sourceHeightPx: 1, targetWidthPx: 2, targetHeightPx: 2 }), /whole positive/);
});

test("a successful enhance lands exactly on the GENIE print geometry", async () => {
  const source = await sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 30, g: 120, b: 180 } } }).png().toBuffer();
  const returned = await sharp({ create: { width: 1600, height: 800, channels: 3, background: { r: 30, g: 120, b: 180 } } }).png().toBuffer();
  const result = await topaz.enhancePanel({
    readiness: topaz.topazReadiness(enabledEnv), apiKey: "test-key", surfaceKey: "driver",
    bytes: source, targetWidthPx: 1600, targetHeightPx: 800,
    fetchImpl: async () => new Response(returned, { status: 200, headers: { "content-type": "image/png" } }),
  });
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.width, 1600);
  assert.equal(meta.height, 800);
  assert.equal(result.engine, "topaz-image-enhance");
  assert.match(result.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(result.plan.clampedByEngineCeiling, false);
});

test("a failed enhance fails the stage instead of returning the original bytes", async () => {
  const source = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#123456" } }).png().toBuffer();
  const base = {
    readiness: topaz.topazReadiness(enabledEnv), apiKey: "test-key", surfaceKey: "driver",
    bytes: source, targetWidthPx: 1600, targetHeightPx: 800,
  };
  // This is the behaviour that differs from the historical shared module, which
  // returned the original bytes non-fatally and shipped soft panels.
  await assert.rejects(() => topaz.enhancePanel({ ...base, fetchImpl: async () => new Response("nope", { status: 413 }) }), /failed closed/);
  await assert.rejects(() => topaz.enhancePanel({ ...base, fetchImpl: async () => new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "image/png" } }) }), /failed closed/);
  await assert.rejects(() => topaz.enhancePanel({ ...base, fetchImpl: async () => { throw new Error("socket hang up"); } }), /failed closed/);
  // An engine that returns something far short of the plan is refused too.
  const tiny = await sharp({ create: { width: 420, height: 210, channels: 3, background: "#123456" } }).png().toBuffer();
  await assert.rejects(() => topaz.enhancePanel({ ...base, fetchImpl: async () => new Response(tiny, { status: 200, headers: { "content-type": "image/png" } }) }), /short of the planned/);
});

test("a disabled or unconfigured enhancer cannot silently pass a pack through", async () => {
  const source = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#123456" } }).png().toBuffer();
  await assert.rejects(() => topaz.enhancePanel({
    readiness: topaz.topazReadiness({ DESIGNPRO_TOPAZ_ENABLED: "false" }),
    surfaceKey: "driver", bytes: source, targetWidthPx: 1600, targetHeightPx: 800,
  }), /Call 12 cannot run/);
});

test("Call 12 is an authored winner bound into the chain, and outputs are built from it", () => {
  // Placed before output.build so the production files are rendered from the
  // enhanced master rather than from an interpolated stretch.
  assert.match(claimantSource, /"await_panelpro_preflight_qc", "enhance\.upscale", "output\.build"/);
  assert.match(claimantSource, /receiptKind: "call12\.topaz-upscale"/);
  // Reuses the immutable winner rather than authoring a second, different
  // enhancement on retry.
  assert.match(claimantSource, /reusedImmutableWinner/);
  assert.match(claimantSource, /authoredWinner: true, deterministic: false/);
  // output.build must consume the enhanced panels and verify them against the
  // Call 12 receipt.
  assert.match(claimantSource, /artifacts\(sb, run\.id, \["upscaled-panel"\]\)/);
  assert.match(claimantSource, /enhanced_panel_receipt_mismatch/);
  assert.doesNotMatch(claimantSource, /topaz_enhance_failed[^"]*non-fatal/i);
  // A disabled enhancer must not let a pack through.
  assert.match(claimantSource, /topaz_disabled/);
});
