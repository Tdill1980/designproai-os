/**
 * HERO FIRST (owner, Trish 2026-09-16: "before migration to os.designpro this
 * is the exact same system, should be the same design quality").
 *
 * RestylePro asks the persona for a photograph of the car wearing the wrap
 * and derives every flat surface from that approved design. The OS's
 * hero-driver cascade now opens with that same render: it is staged as the
 * driver surface's design reference, the driver flank is DERIVED from it with
 * RestylePro's flatten instruction, and the rest of the cascade is unchanged.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const hero = require("../runtime/atlas-hero-driver.cjs");
const atlas = require("../runtime/flat-first-atlas.cjs");
const runtimeSrc = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
const edgeSrc = readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");

test("the hero render travels to the driver surface as a storage reference, never as bytes, and forces exact-reference intent", () => {
  const body = hero.heroRequestBody({
    mode: "restyle", brief: "Porsche Martini race team", vehicle: { year: "2022", make: "Porsche", model: "911 Turbo", type: "car" },
    heroReference: { storagePath: "atlas-call1-inputs/" + "a".repeat(64) + ".png", contentHash: "a".repeat(64) },
    visionboard_intent: "style_inspiration",
  });
  assert.deepEqual(body.heroReference, { storagePath: "atlas-call1-inputs/" + "a".repeat(64) + ".png", contentHash: "a".repeat(64) });
  assert.equal(body.visionboard_intent, "exact_reference");
  assert.equal(body.referenceImagesBase64, undefined, "no inline bytes in the run definition or cache key");
  const plain = hero.heroRequestBody({ mode: "commercial", brief: "x", vehicle: {}, visionboard_intent: "style_inspiration" });
  assert.equal(plain.heroReference, undefined);
  assert.equal(plain.visionboard_intent, "style_inspiration");
});

test("a driver flank returned at the widest menu aspect is accepted and cover-cropped, never stretched or refused", async () => {
  // A 911 driver zone is ~3.6:1; the model's widest shape is 21:9.
  const zoneW = 1800, zoneH = 500;
  const returned = await sharp({ create: { width: 2100, height: 900, channels: 3, background: "#1b6fa8" } }).png().toBuffer();
  const verdict = await hero._test.evaluateAuthored("driver", returned, zoneW, zoneH);
  assert.equal(verdict.accepted, true, verdict.reason || "");
  assert.equal(verdict.fit, "cover");
  const meta = await sharp(verdict.bytes).metadata();
  assert.equal(meta.width, zoneW); assert.equal(meta.height, zoneH);
  // A return at the zone's own shape is still accepted and filled as before.
  const exact = await sharp({ create: { width: 1746, height: 500, channels: 3, background: "#1b6fa8" } }).png().toBuffer();
  const exactVerdict = await hero._test.evaluateAuthored("driver", exact, zoneW, zoneH);
  assert.equal(exactVerdict.accepted, true);
  assert.equal(exactVerdict.fit, "fill");
  // A square return for a flank is real drift and is refused.
  const square = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#1b6fa8" } }).png().toBuffer();
  const refused = await hero._test.evaluateAuthored("driver", square, zoneW, zoneH);
  assert.equal(refused.accepted, false);
  assert.match(refused.reason, /^aspect_drift:/);
});

test("the aspect menu mirrors the edge's, so the drift gate judges what was actually requested", () => {
  const menu = edgeSrc.match(/const ATLAS_AUTHOR_ASPECTS[^\n]*\n([\s\S]*?)\];/)[1];
  const edgeRatios = [...menu.matchAll(/\["(\d+):(\d+)"/g)].map((m) => Number(m[1]) / Number(m[2]));
  assert.deepEqual([...hero.AUTHOR_ASPECTS], edgeRatios);
  assert.equal(hero.nearestAuthorAspect(3.6), 21 / 9);
  assert.equal(hero.nearestAuthorAspect(1.05), 1);
});

test("renderAtlasHero calls the persona's on-car render, downloads the owner's object, and stages a 1280px reference", async () => {
  const ownerId = "11111111-1111-1111-1111-111111111111";
  const heroPng = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: "#aa2233" } }).png().toBuffer();
  const calls = [];
  const staged = new Map();
  const supabase = { storage: { from: (bucket) => ({ download: async (path) => { calls.push(["download", bucket, path]); return { data: new Blob([heroPng]), error: null }; } }) } };
  const result = await atlas._test.renderAtlasHero({
    input: { mode: "restyle", brief: "Porsche Martini race team, distressed", finish: "Matte", vehicle: { year: "2022", make: "Porsche", model: "911 Turbo", type: "car" } },
    ownerId, supabase,
    store: { async putImmutableBytes({ storagePath, bytes, contentType }) { staged.set(storagePath, { bytes, contentType }); } },
    callHeroEdge: async (body, { ownerId: o }) => {
      calls.push(["edge", body, o]);
      return { success: true, storagePath: `renders/${ownerId}/DesignPanelPro/ai-generated/1_restyle.png`, contentType: "image/png", designAnchorText: "Martini stripes, white base" };
    },
  });
  const [, body, o] = calls.find((c) => c[0] === "edge");
  assert.equal(o, ownerId);
  assert.equal(body.mode, "restyle");
  assert.equal(body.viewType, "side", "the hero is the side photograph, exactly as RestylePro asks for it");
  assert.equal(body.forceNew, true);
  assert.equal(body.prompt, "Porsche Martini race team, distressed");
  assert.equal(body.vehicleModel, "911 Turbo");
  assert.equal(result.contract, "designpro.atlas-hero-render.v1");
  assert.equal(result.storagePath, `renders/${ownerId}/DesignPanelPro/ai-generated/1_restyle.png`);
  assert.equal(result.designAnchorText, "Martini stripes, white base");
  assert.match(result.heroReference.storagePath, /^atlas-call1-inputs\/[0-9a-f]{64}\.png$/);
  const stagedRef = staged.get(result.heroReference.storagePath);
  assert.ok(stagedRef, "the reference is staged through the edge's attach() door");
  const meta = await sharp(stagedRef.bytes).metadata();
  assert.ok(Math.max(meta.width, meta.height) <= 1280);
  assert.equal(stagedRef.contentType, "image/png");
});

test("renderAtlasHero refuses a render that landed outside the owner's prefix", async () => {
  await assert.rejects(
    atlas._test.renderAtlasHero({
      input: { mode: "restyle", brief: "x", vehicle: {} }, ownerId: "11111111-1111-1111-1111-111111111111",
      supabase: { storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) } },
      store: { async putImmutableBytes() {} },
      callHeroEdge: async () => ({ success: true, storagePath: "renders/someone-else/DesignPanelPro/ai-generated/1.png" }),
    }),
    (error) => error.code === "flat_atlas_hero_render_identity_invalid",
  );
});

test("the cascade opens with the hero render and hands the staged reference to the driver call", () => {
  const branch = runtimeSrc.slice(runtimeSrc.indexOf("if (heroDriver) {"), runtimeSrc.indexOf("} else {", runtimeSrc.indexOf("if (heroDriver) {")));
  assert.match(branch, /const heroRender = await \(options\.renderHero \|\| renderAtlasHero\)\(\{ input: authoringInput, ownerId, supabase, store, logger \}\);/);
  assert.match(branch, /input: \{ \.\.\.authoringInput, heroReference: heroRender\.heroReference \}/);
  assert.match(runtimeSrc, /hero\.provenance\.heroRender = \{/);
  // The driver call must prove the reference was attached, or the run refuses.
  assert.match(runtimeSrc, /flat_atlas_author_edge_hero_reference_missing/);
});

test("the edge attaches the hero reference on the driver only, derives with RestylePro's flatten instruction, and both sides pin the same prompt version", () => {
  const handler = edgeSrc.slice(edgeSrc.indexOf("async function handleAtlasAuthor"));
  assert.match(handler, /atlas_author_hero_reference_is_driver_only/);
  assert.match(handler, /heroReferenceIn \|\| body\.visionboard_intent === "exact_reference" \? "exact_reference"/);
  assert.match(handler, /prompt \+= `\\n\\n\$\{atlasHeroDerivationContract\(surfaceLabel, widthInches, heightInches\)\}`/);
  assert.match(handler, /const heroReferenceHash = heroReferenceIn/);
  assert.match(handler, /heroReferenceHash,/);
  const contract = edgeSrc.slice(edgeSrc.indexOf("function atlasHeroDerivationContract"), edgeSrc.indexOf("].join", edgeSrc.indexOf("function atlasHeroDerivationContract")));
  assert.match(contract, /the attached image is the approved design photographed on the vehicle/);
  assert.match(contract, /completely remove the body, cab, windows, glass, wheels, tires/);
  assert.match(contract, /preserve EVERY graphic and EVERY line of lettering exactly as shown/);
  const edgeVersion = edgeSrc.match(/ATLAS_AUTHOR_PROMPT_VERSION = "([^"]+)"/)[1];
  assert.equal(hero.HERO_DRIVER_PROMPT_VERSION, edgeVersion);
  assert.equal(edgeVersion, "atlas-author-hero-driver.20260916.v2");
});
