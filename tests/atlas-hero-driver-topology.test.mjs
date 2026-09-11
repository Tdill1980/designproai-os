// RULE 0.35 — CALL 1 IS THE HERO-DRIVER CASCADE (owner ruling, Trish 2026-09-11).
//
// Locks, from the runtime module, the runtime seam and the deployed edge
// source, that:
//   1. the cascade is the owner's graph: driver alone first, passenger by code,
//      hood + front + rear in parallel (each shown driver + passenger), roof
//      last and shown all five;
//   2. every AI surface replays the driver exchange (and roof every earlier
//      model exchange) -- the thought-signature multi-turn the owner asked for;
//   3. the driver is the ONLY from-scratch request and it goes through the real
//      persona brain (buildDesignIQPrompt with atlasHeroSurface), never a
//      second creative module and never a direct Gemini call from the runtime;
//   4. the model is the locked gemini-3-pro-image, no Flash fallback, no
//      Vertex, no Imagen;
//   5. the default topology is UNCHANGED: without DESIGNPRO_ATLAS_TOPOLOGY=
//      hero-driver the six-surface contract runs, and a refused hero pass
//      fails over to it rather than leaving the customer with nothing;
//   6. the cascade authors, evaluates, assembles and hands ONE sheet to the
//      SAME master gates -- it publishes nothing and heals nothing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const hero = require("../runtime/atlas-hero-driver.cjs");
const atlas = require("../runtime/flat-first-atlas.cjs");
const authoring = require("../runtime/atlas-panel-authoring.cjs");

const runtimeSrc = fs.readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
const heroSrc = fs.readFileSync(new URL("../runtime/atlas-hero-driver.cjs", import.meta.url), "utf8");
const edgeSrc = fs.readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");
const claudeMd = fs.readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");

const SURFACES = [["driver", 153, 56], ["passenger", 153, 56], ["hood", 71.5, 56],
  ["roof", 74.3, 54.8], ["front", 129, 34], ["rear", 76, 54]].map(([surfaceKey, widthInches, heightInches]) => ({
  surfaceKey, widthInches, heightInches, bleed: { top: 5, right: 5, bottom: 5, left: 5 },
}));

test("the cascade is the owner's graph: driver, then passenger by code, then hood+front+rear in parallel, then roof", () => {
  assert.deepEqual(hero.AUTHOR_CASCADE.map((stage) => [...stage]),
    [["driver"], ["passenger"], ["hood", "front", "rear"], ["roof"]]);
  assert.deepEqual([...hero.AUTHOR_NEIGHBOURS.driver], []);
  assert.deepEqual([...hero.AUTHOR_NEIGHBOURS.passenger], ["driver"]);
  for (const key of ["hood", "front", "rear"]) {
    assert.deepEqual([...hero.AUTHOR_NEIGHBOURS[key]], ["driver", "passenger"], `${key} is shown driver + passenger`);
  }
  assert.deepEqual([...hero.AUTHOR_NEIGHBOURS.roof], ["driver", "passenger", "hood", "front", "rear"], "roof sees all five");
});

test("every AI surface replays the driver exchange; roof replays every earlier model exchange", () => {
  assert.deepEqual([...hero.AUTHOR_HISTORY.driver], []);
  for (const key of ["hood", "front", "rear"]) assert.deepEqual([...hero.AUTHOR_HISTORY[key]], ["driver"]);
  assert.deepEqual([...hero.AUTHOR_HISTORY.roof], ["driver", "hood", "front", "rear"]);
  assert.equal(hero.AUTHOR_HISTORY.passenger, undefined, "passenger is code and has no conversation");
  // The exchange is replayed FAITHFULLY: the exact user turn and the exact
  // model turn, signatures still on their parts -- through the ONE shared
  // history trim, so authoring and finishing cannot budget differently.
  assert.match(heroSrc, /const \{ holeRatio, trimHistory, MAX_HISTORY_EXCHANGES \} = require\("\.\/atlas-panel-authoring\.cjs"\)/);
  // The hero exchange is pinned FIRST through the trim, so the roof still
  // carries the driver's signature after hood, front and rear.
  assert.match(heroSrc, /return \[head, \.\.\.kept\.slice\(-\(MAX_HISTORY_EXCHANGES - 1\)\)\];/);
  assert.match(heroSrc, /turns: \[candidate\.userTurn, candidate\.modelTurn\]/);
  assert.match(edgeSrc, /priorTurns\.push\(await replayImageTurn\(turn, downloadHistoryImage\)\)/);
});

test("the driver is the ONLY from-scratch request, through the real persona brain, and passenger is never authored", () => {
  const author = edgeSrc.slice(edgeSrc.indexOf("async function handleAtlasAuthor("), edgeSrc.indexOf("async function handleAtlasArtboard("));
  assert.ok(author.length > 0, "the atlas-author handler must sit above the artboard handler");
  assert.match(author, /if \(first !== \(surfaceKey === "driver"\)\) throw new Error\("atlas_author_first_must_be_driver"\)/);
  assert.match(author, /\["driver", "hood", "roof", "front", "rear"\]\.includes\(surfaceKey\)/);
  assert.ok(!/\["driver", "passenger"/.test(author), "passenger must not be an authorable surface");
  assert.match(author, /buildDesignIQPrompt\(\{/);
  assert.match(author, /atlasFlatMaster: true,\s*\n\s*atlasPanels: \[\],\s*\n\s*atlasHeroSurface:/);
  assert.match(author, /atlas_author_hero_takes_no_neighbours/);
  assert.match(author, /atlas_author_hero_takes_no_history/);
  // No creative text in the runtime and no raw Gemini endpoint (RULE 0.26).
  assert.ok(!heroSrc.includes("buildDesignIQPrompt"), "no in-runtime creative builder");
  assert.ok(!heroSrc.includes("generativelanguage.googleapis.com"), "no raw Gemini endpoint in the runtime");
  assert.match(heroSrc, /mode: "atlas-author"/);
});

test("the hero prompt branch leaves the six-surface and field assemblies byte-identical (guarded by atlasHero only)", () => {
  // Every hero variation is a ternary/conditional on `atlasHero`; the existing
  // one-field byte pins (atlas-one-field-call1) prove the non-hero output.
  assert.match(edgeSrc, /const atlasHero: AtlasHeroSurface \| null = atlasFlatMaster && !atlasField \? atlasHeroSurfaceInput/);
  assert.match(edgeSrc, /function atlasHeroSurfaceContract\(/);
  const contract = edgeSrc.slice(edgeSrc.indexOf("function atlasHeroSurfaceContract("), edgeSrc.indexOf("function atlasFlatMasterContract("));
  assert.match(contract, /ONE FLAT PRINTED SHEET/);
  assert.match(contract, /reads normally, left to right, upright/);
  for (const noun of ["wheel", "door", "window", "arch", "bumper", "silhouette"]) {
    assert.ok(!contract.toLowerCase().includes(noun), `no vehicle noun in the hero contract: ${noun}`);
  }
  const continuation = edgeSrc.slice(edgeSrc.indexOf("function atlasAuthorContinuationPrompt("), edgeSrc.indexOf("async function handleAtlasAuthor("));
  for (const noun of ["wheel", "door", "window", "arch", "bumper", "silhouette", "vehicle"]) {
    assert.ok(!continuation.toLowerCase().includes(noun), `no vehicle noun in the continuation prompt: ${noun}`);
  }
  assert.match(continuation, /carry that artwork straight across the shared edge/);
});

test("the locked model, 2K at the closest native aspect, no Flash fallback, no Vertex, no Imagen", () => {
  assert.match(edgeSrc, /const ATLAS_AUTHOR_MODEL = "gemini-3-pro-image"/);
  assert.match(edgeSrc, /const ATLAS_AUTHOR_IMAGE_SIZE = "2K"/);
  assert.match(edgeSrc, /imageConfig: \{ aspectRatio, imageSize: ATLAS_AUTHOR_IMAGE_SIZE \}/);
  assert.match(edgeSrc, /responseModalities: \["TEXT", "IMAGE"\]/);
  assert.ok(!/flash-image/i.test(heroSrc), "no Flash model in the cascade");
  // Code only: the module's header QUOTES the owner's "DO NOT USE VERTEX or
  // IMAGEN", so comments are stripped before the code is searched.
  const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const src of [heroSrc, runtimeSrc.slice(runtimeSrc.indexOf("HERO-DRIVER CASCADE"))]) {
    assert.ok(!/vertex|imagen|aiplatform/i.test(codeOnly(src)), "no Vertex/Imagen in the hero path");
  }
  assert.match(heroSrc, /model: "gemini-3-pro-image"/);
  // Per-call ceiling: speed is the product constraint.
  assert.match(edgeSrc, /signal: AbortSignal\.timeout\(90_000\), body: modelRequest/);
  assert.equal(hero.AUTHOR_ATTEMPTS, 2);
});

test("the default topology is unchanged; hero-driver is opt-in by deploy flag and fails over to six-surface", () => {
  const previous = process.env.DESIGNPRO_ATLAS_TOPOLOGY;
  try {
    delete process.env.DESIGNPRO_ATLAS_TOPOLOGY;
    assert.equal(hero.heroDriverEnabled(), false);
    process.env.DESIGNPRO_ATLAS_TOPOLOGY = "Hero-Driver ";
    assert.equal(hero.heroDriverEnabled(), true);
    process.env.DESIGNPRO_ATLAS_TOPOLOGY = "hero";
    assert.equal(hero.heroDriverEnabled(), false, "a misspelled flag resolves OFF");
  } finally {
    if (previous === undefined) delete process.env.DESIGNPRO_ATLAS_TOPOLOGY; else process.env.DESIGNPRO_ATLAS_TOPOLOGY = previous;
  }
  assert.match(runtimeSrc, /authoringTopology = "six-surface"/, "the destructured default stays six-surface");
  assert.match(runtimeSrc, /options\?\.authoringTopology === undefined && heroDriverEnabled\(\)\s*\n\s*&& options\?\.parentManifest == null && \(options\?\.revisionSequence \?\? 1\) === 1/);
  assert.match(runtimeSrc, /\["six-surface", "field", HERO_DRIVER_TOPOLOGY\]\.includes\(authoringTopology\)/);
  // Three fail-over doors, all to six-surface, all recorded as provenance.
  const seam = runtimeSrc.slice(runtimeSrc.indexOf("async function generateOrReuseFlatAtlasResolved("));
  assert.equal((seam.match(/return failOverToSixSurface\(/g) || []).length, 3);
  assert.match(seam, /if \(cause\?\.code !== "flat_atlas_hero_driver_refused"\) throw cause;/);
  assert.match(seam, /flat_atlas_hero_passenger_mirror_declined/);
  assert.match(seam, /finishingMode: heroDriver \? HERO_DRIVER_TOPOLOGY/);
  assert.match(seam, /heroDriverAuthoring: generated\?\.heroDriver \|\| null/);
  // Six-surface and field revisions hash exactly as before: the hero key is
  // `undefined` on every other topology, which canonical() drops.
  assert.match(seam, /authoring: heroDriver \? HERO_DRIVER_CONTRACT : undefined/);
});

test("the edge's author mode is internal-only, one image request, and the capability probe advertises it", () => {
  assert.match(edgeSrc, /modes: \["atlas-artboard", "atlas-panel", "atlas-author"\]/);
  const dispatch = edgeSrc.slice(edgeSrc.indexOf('if (body?.mode === "atlas-author") {'), edgeSrc.indexOf("return await handleAtlasAuthor(body, internalCaller.userId!);"));
  assert.match(dispatch, /atlas_author_internal_only/);
  const author = edgeSrc.slice(edgeSrc.indexOf("async function handleAtlasAuthor("), edgeSrc.indexOf("async function handleAtlasArtboard("));
  assert.equal((author.match(/await fetch\(geminiUrl/g) || []).length, 1);
  assert.match(author, /imageRequestCount: 1,/);
  assert.match(author, /identity: \{ \.\.\.providerRequest, ownerId, mode: "atlas-author" \}/);
  assert.match(author, /storagePath = `atlas-author\/\$\{requestId\}\.\$\{extension\}`/);
  // Runtime and edge agree on the prompt version, and the transport refuses a mismatch.
  const edgeVersion = edgeSrc.match(/ATLAS_AUTHOR_PROMPT_VERSION = "([^"]+)"/)[1];
  assert.equal(hero.HERO_DRIVER_PROMPT_VERSION, edgeVersion);
  assert.match(runtimeSrc, /flat_atlas_author_edge_prompt_version_mismatch/);
  assert.match(runtimeSrc, /mode: "atlas-author", signal: probeSignal/);
});

test("the cascade runs end to end on synthetic sheets: five image requests, passenger a flop, one assembled sheet, exact exchanges carried", async () => {
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const calls = [];
  const staged = new Map();
  const store = { async putImmutableBytes({ storagePath, bytes }) { staged.set(storagePath, bytes); } };
  const paint = async (w, h, tint) => sharp({ create: { width: w, height: h, channels: 3, background: tint } }).png().toBuffer();
  const callEdge = async (body) => {
    calls.push(body);
    const tint = { driver: "#2255aa", hood: "#3366bb", front: "#4477cc", rear: "#5588dd", roof: "#6699ee" }[body.surfaceKey];
    // The model returns at the REQUESTED shape (menu aspect), not the exact zone.
    const bytes = await paint(Math.round(body.targetWidthPx * 0.97), body.targetHeightPx, tint);
    const contentHash = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
    return {
      bytes, imageRequestCount: 1, providerCacheHit: false, providerRequestKey: "a".repeat(64),
      panelStoragePath: `atlas-author/${body.surfaceKey}.png`, panelSha256: contentHash, panelByteSize: bytes.length,
      userTurn: { role: "user", parts: [{ text: `exact ${body.surfaceKey} instructions` }] },
      modelTurn: { role: "model", parts: [{ imageRef: { storagePath: `atlas-author/${body.surfaceKey}.png`, contentHash }, thoughtSignature: `sig-${body.surfaceKey}` }] },
      historyImageBytes: bytes.length, thoughtSignatureCount: 1,
      priorSignaturesReplayed: (body.priorTurns || []).flatMap((t) => t.parts).filter((p) => p.thoughtSignature).length,
    };
  };
  const result = await hero.authorHeroDriverMaster({ manifest, input: { mode: "commercial", brief: "test", vehicle: { year: "2022", make: "Ford", model: "F250", type: "truck" } }, store, callEdge });
  assert.equal(calls.length, 5, "driver, hood, front, rear, roof");
  assert.equal(result.imageRequestCount, 5);
  const order = calls.map((c) => c.surfaceKey);
  assert.equal(order[0], "driver");
  assert.deepEqual(order.slice(1, 4).sort(), ["front", "hood", "rear"]);
  assert.equal(order[4], "roof");
  assert.equal(calls[0].first, true);
  assert.deepEqual(calls[0].priorTurns, []);
  assert.deepEqual(calls[0].neighbours, []);
  for (const call of calls.slice(1, 4)) {
    assert.equal(call.first, false);
    assert.deepEqual(call.neighbours.map((n) => n.surfaceKey), ["driver", "passenger"]);
    assert.deepEqual(call.priorTurns.map((t) => t.role), ["user", "model"], "the driver exchange is replayed");
    assert.equal(call.priorTurns[1].parts[0].thoughtSignature, "sig-driver");
  }
  assert.deepEqual(calls[4].neighbours.map((n) => n.surfaceKey), ["driver", "passenger", "hood", "front", "rear"]);
  assert.ok(calls[4].priorTurns.length >= 2 && calls[4].priorTurns.length <= 8, "roof replays the earlier exchanges (trimmed to budget)");
  assert.equal(calls[4].priorTurns[1].parts[0].thoughtSignature, "sig-driver", "the driver signature survives the trim");
  // Attempt keys make every surface idempotent under the provider cache.
  assert.equal(calls[0].providerRequest, undefined);
  const passenger = result.surfaces.find((s) => s.surfaceKey === "passenger");
  assert.equal(passenger.method, "hero_driver_passenger_flop");
  assert.equal(passenger.imageRequestCount, 0);
  assert.equal(passenger.deterministic, true);
  assert.equal(result.surfaces.filter((s) => s.deterministic === false).length, 5);
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.width, 4096); assert.equal(meta.height, 4096);
  assert.equal(result.provenance.contract, hero.HERO_DRIVER_CONTRACT);
  assert.equal(result.provenance.cascade.length, 4);
  // References travel downscaled, never the full sheet.
  for (const [path, bytes] of staged) {
    assert.match(path, /^atlas-call1-inputs\/[0-9a-f]{64}\.jpg$/);
    const m = await sharp(bytes).metadata();
    assert.ok(Math.max(m.width, m.height) <= 1280, `reference ${path} is downscaled`);
  }
});

test("a refused surface refuses the whole hero pass (no honest-gap sheet is ever assembled)", async () => {
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const store = { async putImmutableBytes() {} };
  const paint = async (w, h, tint) => sharp({ create: { width: w, height: h, channels: 3, background: tint } }).png().toBuffer();
  let attempts = 0;
  const callEdge = async (body) => {
    attempts += 1;
    // A square return against a 4:1 flank: aspect drift, refused every time.
    const bytes = body.surfaceKey === "driver" ? await paint(1024, 1024, "#000000") : await paint(body.targetWidthPx, body.targetHeightPx, "#123456");
    return { bytes, imageRequestCount: 1, panelStoragePath: "atlas-author/x.png", panelSha256: "b".repeat(64), panelByteSize: bytes.length };
  };
  await assert.rejects(
    hero.authorHeroDriverMaster({ manifest, input: { vehicle: {} }, store, callEdge }),
    (error) => error.code === "flat_atlas_hero_driver_refused" && error.surfaceKey === "driver" && /aspect_drift/.test(error.reason),
  );
  assert.equal(attempts, hero.AUTHOR_ATTEMPTS, "bounded: exactly the attempt budget, then refusal");
});

test("the ruling is recorded where the next session will read it", () => {
  assert.match(claudeMd, /## 🚗 RULE 0\.35 — CALL 1 IS THE HERO-DRIVER CASCADE/);
  assert.match(claudeMd, /DESIGNPRO_ATLAS_TOPOLOGY=hero-driver/);
  assert.match(claudeMd, /DO NOT USE VERTEX or IMAGEN/);
  // Finishing's own cascade order is untouched: the hero cascade is its own graph.
  assert.deepEqual(authoring.PANEL_CASCADE_ORDER, ["driver", "passenger", "hood", "roof", "front", "rear"]);
});
