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
    [["driver"], ["passenger"], ["hood", "front", "rear", "roof"]],
    "three stages: one design origin, then every remaining side in ONE parallel wave, then assembly");
  assert.deepEqual([...hero.AUTHOR_NEIGHBOURS.driver], []);
  assert.deepEqual([...hero.AUTHOR_NEIGHBOURS.passenger], ["driver"]);
  for (const key of ["hood", "front", "rear"]) {
    assert.deepEqual([...hero.AUTHOR_NEIGHBOURS[key]], ["driver", "passenger"], `${key} is shown driver + passenger`);
  }
  // ROOF SHOWS THE TWO FLANKS ONLY. Live 194e8f17: roof was the last surface
  // standing and failed `flat_atlas_author_edge_call_failed` three times into
  // attempts_exhausted -- the same edge-worker exhaustion front hit. Five
  // neighbour images plus a replayed chain is the heaviest request the cascade
  // builds. The flanks carry the colourway, motifs and lettering, and
  // hood/front/rear are themselves continuations of those flanks, so roof loses
  // no information it did not already have second-hand. Roof still DEPENDS on
  // hood/front/rear (AUTHOR_HISTORY), so the ordering is unchanged.
  assert.deepEqual([...hero.AUTHOR_NEIGHBOURS.roof], ["driver", "passenger"], "roof is shown the two flanks");
});

test("every AI surface replays the driver exchange, and roof no longer waits on its siblings", () => {
  assert.deepEqual([...hero.AUTHOR_HISTORY.driver], []);
  for (const key of ["hood", "front", "rear"]) assert.deepEqual([...hero.AUTHOR_HISTORY[key]], ["driver"]);
  // ROOF REPLAYS THE DRIVER ONLY. Replaying hood/front/rear was the one edge
  // holding roof in a fourth stage of its own -- and the graph derives its
  // dependencies from this table, so that single entry cost a whole model call
  // of wall clock on every generation (194e8f17: every surface completed in
  // 9-51s while the run still took minutes, because four waves run end to end).
  assert.deepEqual([...hero.AUTHOR_HISTORY.roof], ["driver"]);
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

/** Pin the hero-first switch for one test and restore it after. */
function heroFirst(t, value) {
  const previous = process.env.DESIGNPRO_ATLAS_HERO_FIRST;
  if (value === undefined) delete process.env.DESIGNPRO_ATLAS_HERO_FIRST;
  else process.env.DESIGNPRO_ATLAS_HERO_FIRST = value;
  t.after(() => {
    if (previous === undefined) delete process.env.DESIGNPRO_ATLAS_HERO_FIRST;
    else process.env.DESIGNPRO_ATLAS_HERO_FIRST = previous;
  });
}

test("the driver is the ONLY from-scratch request, through the real persona brain, and passenger is never authored", () => {
  const author = edgeSrc.slice(edgeSrc.indexOf("async function handleAtlasAuthor("), edgeSrc.indexOf("async function handleAtlasArtboard("));
  assert.ok(author.length > 0, "the atlas-author handler must sit above the artboard handler");
  // EVERY AI SURFACE IS HERO-VIEW-ELIGIBLE (2026-09-22, "This is my quality"):
  // driver is the hero, drawn from scratch; hood/front/rear/roof are VIEWS of
  // that hero -- `first`, but they REQUIRE the hero reference, so a
  // from-scratch call there is still impossible (RULE 0.26 / RULE 0.0).
  assert.match(edgeSrc, /const ATLAS_HERO_VIEW_ELIGIBLE_SURFACES = new Set\(\["driver", "hood", "front", "rear", "roof"\]\);/);
  assert.match(author, /if \(first && !ATLAS_HERO_VIEW_ELIGIBLE_SURFACES\.has\(surfaceKey\)\) \{/);
  assert.match(author, /throw new Error\("atlas_author_first_surface_not_hero_view_eligible"\);/);
  assert.match(author, /if \(heroView && surfaceKey !== "driver" && !heroReferenceIn\) throw new Error\("atlas_author_view_requires_hero_reference"\);/,
    "a non-driver view without the hero is refused before a request is spent");
  assert.match(author, /if \(heroReferenceIn && !\(heroView && surfaceKey !== "driver"\)\) throw new Error\("atlas_author_hero_reference_misplaced"\);/,
    "and the driver hero never takes one");
  assert.match(author, /atlasHeroViewContinuityPrompt\(/, "a view is told: same wrap, different camera");
  assert.match(author, /atlasHeroRevisionPrompt\(/, "a revision edits the parent hero");
  assert.match(edgeSrc, /const ATLAS_HERO_VIEW_TYPES: Record<string, string> = \{ driver: "side", hood: "hood_detail", front: "front", rear: "rear", roof: "roof" \};/);
  assert.deepEqual(hero.VIEW_TYPES, { driver: "side", hood: "hood_detail", front: "front", rear: "rear", roof: "roof" }, "both homes name the same cameras");
  // The neighbours guard is scoped to the VIEW leg only, exactly like the
  // priorTurns guard below it -- a flatten legitimately needs neighbours
  // (front's flatten sees driver + passenger), a from-scratch view never does.
  assert.match(author, /if \(first && !heroFlatten && neighboursIn\.length\) throw new Error\("atlas_author_hero_takes_no_neighbours"\);/);
  assert.match(author, /\["driver", "hood", "roof", "front", "rear"\]\.includes\(surfaceKey\)/);
  assert.ok(!/\["driver", "passenger"/.test(author), "passenger must not be an authorable surface");
  assert.match(author, /buildDesignIQPrompt\(\{/);
  // HERO-FIRST (2026-09-16) makes the driver TWO stages, and this lock's intent
  // is unchanged by it: ONE from-scratch request through the real persona brain.
  // Stage 1 asks that persona for the VEHICLE view -- atlasFlatMaster FALSE,
  // so the tail is the locked camera angle + scene + studio, RestylePro's
  // golden hero; stage 2 FLATTENS that approved view rather than drawing
  // anything new. Everything above the swap -- persona, brief, logo
  // architecture, contact lock, finish, references -- is byte-identical.
  //
  // ⚠️ THIS USED TO PIN `atlasFlatMaster: !heroFlatten` -- TRUE on the view
  // leg -- while the comment beside it said "asks for the vehicle". With
  // atlasHeroSurface set, TRUE selected atlasHeroScene ("ONE FLAT PRINTED
  // SHEET") at 16:9, so the "hero view" hero-first measured 0/3 on was never
  // a photograph of the vehicle. The lock encoded the bug (the sixth time
  // CLAUDE.md records that shape). FALSE, on both legs, with the camera
  // chosen per surface.
  assert.match(author, /viewType,\s*\n\s*visionBoardImages:/, "the view's own camera reaches the persona");
  assert.match(author, /atlasFlatMaster: false,\s*\n\s*atlasPanels: \[\],\s*\n\s*atlasHeroSurface: undefined,/);
  assert.ok(!author.includes("atlasFlatMaster: !heroFlatten"), "the flat-sheet contract must never be asked for on the view leg again");
  assert.match(author, /const heroFlatten = first && String\(body\.heroViewStoragePath \|\| ""\)\.trim\(\)\.length > 0;/);
  // The flatten is the PORTED renderFlatTile wording, tiered, and it copies the
  // customer's own strings rather than guessing lettering.
  assert.match(author, /atlasHeroFlattenPrompt\(/);
  assert.match(author, /atlasHeroTextLock\(body\)/);
  assert.match(edgeSrc, /function atlasHeroFlattenPrompt\(/);
  assert.match(edgeSrc, /OUTPUT ONLY THE ARTWORK CANVAS/);
  // Stage 1 asks for the photographic 16:9, never the flank ratio the model
  // cannot emit -- the whole reason the single-call driver measured 0\/3.
  assert.match(author, /const aspectRatio = heroView \? "16:9" : atlasAuthorAspect\(/);
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
  // THE HERO IS 4K -- the design itself and the source of every flank, as
  // RestylePro's golden config has always rendered it. Every view of it and
  // every flatten stays 2K.
  assert.match(edgeSrc, /const ATLAS_HERO_IMAGE_SIZE = "4K"/);
  assert.match(edgeSrc, /const imageSize = heroView && surfaceKey === "driver" \? ATLAS_HERO_IMAGE_SIZE : ATLAS_AUTHOR_IMAGE_SIZE;/);
  assert.match(edgeSrc, /imageConfig: \{ aspectRatio, imageSize \}/);
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
  assert.match(runtimeSrc, /\["six-surface", "field", HERO_DRIVER_TOPOLOGY, PANEL_PROOF_TOPOLOGY\]\.includes\(authoringTopology\)/);
  // THE SIX LEGACY HERO/FIELD FALLBACK DOORS REMAIN, DEAD BUT RETAINED (owner
  // 2026-09-22: "There isn't any other Call 1"). The hero-driver line matched
  // above now lives in `generateOrReuseFlatAtlasLegacyRouting`, which
  // production never calls; the six doors below it are reachable only from a
  // hero/field/six-surface pass, which only the legacy-resume dispatch and the
  // harnesses can enter. None of the six is reachable from a panel-proof run:
  // `tests/panel-proof-is-the-only-call1.test.mjs` proves that by execution.
  // The count is pinned so a door is neither silently added nor silently lost.
  const seam = runtimeSrc.slice(runtimeSrc.indexOf("async function generateOrReuseFlatAtlasResolved("));
  assert.equal((seam.match(/return failOverToSixSurface\(/g) || []).length, 6);
  const routingHead = runtimeSrc.slice(runtimeSrc.indexOf("async function generateOrReuseFlatAtlas(options) {"),
    runtimeSrc.indexOf("async function generateOrReuseFlatAtlasLegacyRouting(options) {"));
  assert.ok(!routingHead.includes("heroDriverEnabled()") && !routingHead.includes("fieldFirstReason("),
    "the live router reads no hero-driver or field-first flag; those selectors are dead but retained");
  // THE LIVE ROUTER IS HERO-FIRST, EXPLICITLY (2026-09-22): the routing names
  // the cascade AND `heroFirst: true`, so the deploy flag cannot silently put a
  // customer back on a flat-sheet contract. The panel proof is no longer
  // selected here; it is derived from the hero's master.
  assert.match(routingHead, /authoringTopology: HERO_DRIVER_TOPOLOGY, heroFirst: true/);
  assert.ok(!routingHead.includes("authoringTopology: PANEL_PROOF_TOPOLOGY"));
  // A revision runs the same cascade; only the retained single-call shape still refuses an edit.
  assert.match(seam, /if \(heroDriver && parentManifest && !heroFirst\) \{/);
  assert.match(seam, /parentView: await stageParentHeroViewReference\(/);
  // And the element graph never composites over brain-lettered flanks.
  assert.match(seam, /skipped: "hero_first_authors_its_own_lettering"/);
  assert.ok(seam.includes("field-first budget refused"), "the spent field-first budget hands over");
  assert.ok(seam.includes("resuming the accepted six-surface tail for"), "the checkpoint resume mirror exists");
  assert.match(seam, /existing && fieldFirstRouted && existing\.manifest\?\.topology !== FIELD_TOPOLOGY/);
  // The hand-off is one-way: the tail may not fail back to the contract this
  // request has already exhausted.
  assert.match(seam, /const failoverEnabled = fieldResumable && !fieldFirstExhausted/);
  assert.match(seam, /fieldFirst: null, fieldFirstExhausted: true/);
  assert.match(seam, /if \(cause\?\.code !== "flat_atlas_hero_driver_refused"\) throw cause;/);
  assert.match(seam, /flat_atlas_hero_passenger_mirror_declined/);
  assert.match(seam, /finishingMode: heroDriver \? HERO_DRIVER_TOPOLOGY/);
  assert.match(seam, /heroDriverAuthoring: generated\?\.heroDriver \|\| null/);
  // Six-surface and field revisions hash exactly as before: the hero key is
  // `undefined` on every other topology, which canonical() drops.
  assert.match(seam, /authoring: heroDriver \? HERO_DRIVER_CONTRACT\s*\n\s*: panelProof \? PANEL_PROOF_TOPOLOGY_CONTRACT : undefined/,
    "both authoring contracts are `undefined` on six-surface and field, which canonical() drops");
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

test("the cascade runs end to end on synthetic sheets: five image requests, passenger a flop, one assembled sheet, exact exchanges carried", async (t) => {
  // THIS IS THE DEFAULT CALL 1, and it is asserted with the flag ABSENT rather
  // than pinned "off" -- the owner's order is that Call 1 authors the flat 2D
  // design first, so the single-call driver is the product, not a fallback. A
  // test that only ever ran this path with an explicit "off" would keep passing
  // while the default drifted back to a vehicle render in front of it.
  heroFirst(t, undefined);
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
  // THREE STAGES: driver alone, then every remaining side in ONE parallel wave.
  // Roof is no longer last-and-alone, so its position within the wave is not
  // pinned -- only that all four are in it.
  assert.deepEqual(order.slice(1).sort(), ["front", "hood", "rear", "roof"]);
  assert.equal(calls[0].first, true);
  assert.deepEqual(calls[0].priorTurns, []);
  assert.deepEqual(calls[0].neighbours, []);
  for (const call of calls.slice(1)) {
    assert.equal(call.first, false);
    assert.deepEqual(call.neighbours.map((n) => n.surfaceKey), ["driver", "passenger"]);
    assert.deepEqual(call.priorTurns.map((t) => t.role), ["user", "model"], "the driver exchange is replayed");
    assert.equal(call.priorTurns[1].parts[0].thoughtSignature, "sig-driver");
  }
  assert.deepEqual(calls[4].neighbours.map((n) => n.surfaceKey), ["driver", "passenger"],
    "roof is shown the two flanks only -- five images exhausted the edge worker on live 194e8f17");
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
  assert.equal(result.provenance.cascade.length, 3, "three stages, not four");
  // References travel downscaled, never the full sheet.
  for (const [path, bytes] of staged) {
    assert.match(path, /^atlas-call1-inputs\/[0-9a-f]{64}\.jpg$/);
    const m = await sharp(bytes).metadata();
    assert.ok(Math.max(m.width, m.height) <= 1280, `reference ${path} is downscaled`);
  }
});

test("a refused surface refuses the whole hero pass (no honest-gap sheet is ever assembled)", async (t) => {
  heroFirst(t, "off");
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

// HERO-FIRST: THE DRIVER IS TWO STAGES, AND THE SECOND ONE FLATTENS THE FIRST.
//
// The single-call driver it replaces asks for the flank at its own ~3.6:1
// ratio, which this model cannot emit (21:9 is its widest), so `evaluateAuthored`
// refused every driver tile on aspect drift before any artwork was judged --
// 0/3 on real vehicles. Hero-first asks for a 16:9 photograph of the vehicle
// and then flattens THAT, which is an ask the model answers and which composes
// against real geometry.
//
// What must stay true, and is asserted here: exactly ONE extra image request,
// the flatten is shown the approved view by path AND hash, the continuations
// are unchanged (they still see the finished FLANK), and passenger is still a
// code flop.
test("hero-first runs EVERY surface as vehicle-view then flatten: the driver hero, four views of it, five flattens, passenger a flop", async (t) => {
  // THIS IS THE LIVE CALL 1 (2026-09-22): the router passes `heroFirst: true`
  // by name. It is asserted through that argument, not the flag, because the
  // flag is no longer what selects it.
  heroFirst(t, undefined);
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const calls = [];
  const staged = new Map();
  const store = { async putImmutableBytes({ storagePath, bytes }) { staged.set(storagePath, bytes); } };
  const paint = async (w, h, tint) => sharp({ create: { width: w, height: h, channels: 3, background: tint } }).png().toBuffer();
  const callEdge = async (body) => {
    calls.push(body);
    // THE EDGE'S OWN DOORS, mirrored: a non-driver view without the hero
    // reference is refused; a hero reference anywhere else is refused; a
    // reference path outside the content-addressed prefix is refused.
    const vehicleView = body.first === true && !body.heroViewStoragePath;
    if (vehicleView && body.surfaceKey !== "driver" && !body.heroReferenceStoragePath) {
      throw Object.assign(new Error("atlas_author_view_requires_hero_reference"), { code: "flat_atlas_author_edge_call_failed" });
    }
    if (body.heroReferenceStoragePath && !(vehicleView && body.surfaceKey !== "driver")) {
      throw Object.assign(new Error("atlas_author_hero_reference_misplaced"), { code: "flat_atlas_author_edge_call_failed" });
    }
    if (body.heroReferenceStoragePath && !/^atlas-call1-inputs\/[0-9a-f]{64}\.(?:png|jpg)$/.test(String(body.heroReferenceStoragePath))) {
      throw Object.assign(new Error(`atlas_author_input_path_invalid:${body.heroReferenceStoragePath}`), { code: "flat_atlas_author_edge_call_failed" });
    }
    const tint = { driver: "#2255aa", hood: "#3366bb", front: "#4477cc", rear: "#5588dd", roof: "#6699ee" }[body.surfaceKey];
    // Stage 1 answers at 16:9 -- deliberately NOT the flank's shape, which is
    // the whole point: the model cannot return the flank's ratio.
    const bytes = vehicleView
      ? await paint(1920, 1080, tint)
      : await paint(Math.round(body.targetWidthPx * 0.97), body.targetHeightPx, tint);
    const contentHash = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
    // The two stages of EACH eligible surface must be distinguishable, or "the
    // flatten replays the view's signature" cannot be told from "it replays
    // its own" -- for driver OR for front.
    const turnName = vehicleView ? `${body.surfaceKey}-view` : body.surfaceKey;
    const path = `atlas-author/${turnName}.png`;
    return {
      bytes, imageRequestCount: 1, providerCacheHit: false, providerRequestKey: "a".repeat(64),
      heroStage: body.first === true ? (vehicleView ? "vehicle-view" : "flatten") : null,
      panelStoragePath: path, panelSha256: contentHash, panelByteSize: bytes.length,
      userTurn: { role: "user", parts: [{ text: `exact ${turnName} instructions` }] },
      modelTurn: { role: "model", parts: [{ imageRef: { storagePath: path, contentHash }, thoughtSignature: `sig-${turnName}` }] },
      historyImageBytes: bytes.length, thoughtSignatureCount: 1,
      priorSignaturesReplayed: (body.priorTurns || []).flatMap((turn) => turn.parts).filter((part) => part.thoughtSignature).length,
    };
  };
  const result = await hero.authorHeroDriverMaster({
    manifest, input: { mode: "commercial", brief: "test", vehicle: { year: "2022", make: "Ford", model: "F250", type: "truck" } },
    store, callEdge, heroFirst: true,
  });

  // TEN REQUESTS: the hero, four views of it, five flattens. Passenger is code.
  assert.equal(calls.length, 10);
  assert.equal(result.imageRequestCount, 10);
  const viewOf = (key) => calls.find((c) => c.surfaceKey === key && c.first === true && !c.heroViewStoragePath);
  const flattenOf = (key) => calls.find((c) => c.surfaceKey === key && Boolean(c.heroViewStoragePath));
  const OTHERS = ["hood", "front", "rear", "roof"];
  const driverView = viewOf("driver"), driverFlatten = flattenOf("driver");
  for (const key of ["driver", ...OTHERS]) { assert.ok(viewOf(key), `${key} view landed`); assert.ok(flattenOf(key), `${key} flatten landed`); }

  // THE HERO: from scratch, no reference, no history, the side camera.
  assert.equal(driverView.heroViewStoragePath, undefined);
  assert.equal(driverView.heroReferenceStoragePath, undefined, "the hero is shown nothing -- it IS the design");
  assert.deepEqual(driverView.priorTurns, []);
  assert.deepEqual(driverView.neighbours, []);
  assert.equal(driverView.viewType, "side");
  assert.equal(driverView.cleanBase, undefined, "the hero authors its own lettering: no clean base is asked for");

  // EVERY OTHER VIEW IS A PHOTOGRAPH OF THAT HERO, from its own camera, by the
  // hero's content-addressed identity -- the path the edge attaches from.
  for (const key of OTHERS) {
    const view = viewOf(key);
    assert.equal(view.viewType, hero.VIEW_TYPES[key], `${key} is photographed from its own locked camera`);
    assert.match(view.heroReferenceStoragePath, /^atlas-call1-inputs\/[0-9a-f]{64}\.jpg$/);
    assert.equal(view.heroReferenceStoragePath, driverFlatten.heroViewStoragePath, `${key}'s view is shown the SAME staged hero the driver flatten reads`);
    assert.equal(view.heroReferenceContentHash, driverFlatten.heroViewContentHash);
    assert.deepEqual(view.priorTurns, [], "a view opens no conversation of its own");
    assert.deepEqual(view.neighbours, []);
  }

  // EVERY FLATTEN IS SHOWN ITS OWN VIEW AND NOTHING ELSE, and continues that
  // view's conversation with its thought signature (two execution paths, one
  // contract -- the graph asserts the same arrival).
  for (const key of ["driver", ...OTHERS]) {
    const flatten = flattenOf(key);
    assert.match(flatten.heroViewStoragePath, /^atlas-call1-inputs\/[0-9a-f]{64}\.(?:png|jpg)$/,
      "stage 2 must be shown the approved view by a path the edge will attach");
    assert.equal(flatten.heroViewStoragePath, `atlas-call1-inputs/${flatten.heroViewContentHash}.jpg`,
      "content-addressed: the path IS the hash, so the edge can verify what it read");
    assert.equal(flatten.heroFlattenTier, 0, "first flatten asks the complete instruction");
    assert.equal(flatten.priorTurns.length, 2, `${key}'s flatten continues only its own view`);
    assert.equal(flatten.priorTurns[1].parts[0].thoughtSignature, `sig-${key}-view`, "with the VIEW's signature on the part it arrived on");
    assert.deepEqual(flatten.neighbours, [], "a flatten sends no neighbour images -- that combination OOM'd the edge worker (9c6008ec)");
    assert.equal(flatten.heroReferenceStoragePath, undefined);
  }

  // THREE WAVES: the hero alone; then driver's flatten beside the four views;
  // then the four flattens beside the passenger flop.
  const at = (c) => calls.indexOf(c);
  for (const key of OTHERS) {
    assert.ok(at(driverView) < at(viewOf(key)), `${key}'s view waits for the hero it photographs`);
    assert.ok(at(viewOf(key)) < at(flattenOf(key)), `${key}'s view precedes its own flatten`);
  }
  assert.ok(at(driverView) < at(driverFlatten));
  assert.deepEqual(result.provenance.cascade, [["driver.view"], ["driver", "hood.view", "front.view", "rear.view", "roof.view"], ["passenger", "hood", "front", "rear", "roof"]]);
  assert.equal(result.provenance.heroFirst, true);
  // Passenger is still code, never a request.
  assert.ok(!calls.some((call) => call.surfaceKey === "passenger"));
  const passenger = result.surfaces.find((surface) => surface.surfaceKey === "passenger");
  assert.equal(passenger.method, "hero_driver_passenger_flop");
  assert.equal(passenger.imageRequestCount, 0);
  // Every AI surface's receipt names the flatten, and the VIEW it was flattened
  // from rides provenance by identity -- what a revision edits, what the
  // customer saw first.
  for (const key of ["driver", ...OTHERS]) {
    assert.equal(result.surfaces.find((surface) => surface.surfaceKey === key).method, "hero_first_flattened");
    assert.match(result.provenance.views[key].storagePath, /^atlas-call1-inputs\/[0-9a-f]{64}\.jpg$/);
    assert.equal(result.provenance.views[key].viewType, hero.VIEW_TYPES[key]);
  }
  assert.equal(result.provenance.views.passenger, undefined, "the flop has no view of its own");
  // The staged hero is NOT downscaled: it is the flatten's subject and every view's reference.
  const heroBytes = staged.get(driverFlatten.heroViewStoragePath);
  const heroMeta = await sharp(heroBytes).metadata();
  assert.equal(heroMeta.width, 1920, "the hero is staged at full size");
});

test("a revision of a hero-first design edits the PARENT HERO: attached by identity, with the customer's instruction, on the driver only", async () => {
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const calls = [];
  const store = { async putImmutableBytes() {} };
  const paint = async (w, h, tint) => sharp({ create: { width: w, height: h, channels: 3, background: tint } }).png().toBuffer();
  const callEdge = async (body) => {
    calls.push(body);
    const vehicleView = body.first === true && !body.heroViewStoragePath;
    const bytes = vehicleView ? await paint(1920, 1080, "#2255aa") : await paint(Math.round(body.targetWidthPx * 0.97), body.targetHeightPx, "#2255aa");
    const contentHash = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
    const name = vehicleView ? `${body.surfaceKey}-view` : body.surfaceKey;
    return { bytes, imageRequestCount: 1, heroStage: body.first === true ? (vehicleView ? "vehicle-view" : "flatten") : null,
      panelStoragePath: `atlas-author/${name}.png`, panelSha256: contentHash, panelByteSize: bytes.length,
      userTurn: { role: "user", parts: [{ text: name }] }, modelTurn: { role: "model", parts: [{ imageRef: { storagePath: `atlas-author/${name}.png`, contentHash }, thoughtSignature: `sig-${name}` }] } };
  };
  const parentView = { storagePath: `atlas-call1-inputs/${"7".repeat(64)}.jpg`, contentHash: "7".repeat(64), byteSize: 10 };
  await hero.authorHeroDriverMaster({
    manifest, input: { mode: "commercial", brief: "test", vehicle: { year: "2022", make: "Ford", model: "F250", type: "truck" } },
    store, callEdge, heroFirst: true,
    revision: { sequence: 2, instruction: "Move the phone number to the rear door.", parentView },
  });
  const heroCall = calls.find((c) => c.surfaceKey === "driver" && c.first === true && !c.heroViewStoragePath);
  assert.equal(heroCall.parentViewStoragePath, parentView.storagePath, "the parent hero is what is edited");
  assert.equal(heroCall.parentViewContentHash, parentView.contentHash);
  assert.equal(heroCall.revisionInstruction, "Move the phone number to the rear door.");
  for (const c of calls.filter((c) => c !== heroCall)) {
    assert.equal(c.parentViewStoragePath, undefined, `${c.surfaceKey}: only the hero takes the revision`);
    assert.equal(c.revisionInstruction, undefined);
  }
});

// A stage-1 return that is not the vehicle view is refused rather than flattened.
// The receipt is the only thing that distinguishes a view from a panel, so a
// missing or wrong `heroStage` must never be cut as artwork.
// HERO_VIEW_SURFACES IS THE ONE SOURCE OF TRUTH FOR "WHICH SURFACES SPLIT".
// Adding one is a real build (RULE 0.39's Node1/Node3 pattern, applied on
// measured aspect_drift evidence), never a default -- so the set is pinned
// exactly, not just "contains driver". Front joined it on 2026-09-17 canary
// evidence (`front: aspect_drift:1.342`/`1.354`, live F250 canary, two
// separate real generations); hood, rear and roof measure well under the
// 21:9 ceiling on every catalog vehicle inspected and stay single-step.
test("HERO_VIEW_SURFACES names EVERY AI surface -- the hero and the four views of it; passenger is never one", () => {
  // Superseded 2026-09-22: membership is no longer decided by aspect-drift
  // evidence. Every surface the model draws is a view then a flatten, because
  // that is the order the owner's quality comes from (hero on the vehicle,
  // flats derived from real views). Passenger is the driver flank flopped.
  assert.deepEqual([...hero.HERO_VIEW_SURFACES].sort(), ["driver", "front", "hood", "rear", "roof"]);
  assert.ok(!hero.HERO_VIEW_SURFACES.has("passenger"));
  // Both homes -- the runtime and the deployed edge -- name the identical set,
  // so they cannot silently drift apart.
  assert.match(edgeSrc, /const ATLAS_HERO_VIEW_ELIGIBLE_SURFACES = new Set\(\["driver", "hood", "front", "rear", "roof"\]\);/);
});

test("hero-first refuses a stage-1 return that does not identify itself as the vehicle view", async (t) => {
  heroFirst(t, "on");
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const store = { async putImmutableBytes() {} };
  const callEdge = async () => ({
    bytes: await sharp({ create: { width: 1920, height: 1080, channels: 3, background: "#2255aa" } }).png().toBuffer(),
    imageRequestCount: 1, heroStage: null, panelStoragePath: "atlas-author/x.png", panelSha256: "b".repeat(64),
  });
  await assert.rejects(
    hero.authorHeroDriverMaster({
      manifest, input: { mode: "commercial", brief: "test", vehicle: { year: "2022", make: "Ford", model: "F250", type: "truck" } },
      store, callEdge,
    }),
    (error) => error.code === "flat_atlas_hero_driver_refused" && /hero_view_stage_mismatch/.test(String(error.reason || error.message)),
  );
});
