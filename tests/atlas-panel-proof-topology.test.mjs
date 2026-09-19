/**
 * CALL 1 AS THE PANEL PRODUCTION PROOF, ON THE LIVE CUSTOMER ROUTE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-19, verbatim: "real customer traffic is trapped on the legacy
 * v28 artboard while production-panel-proof only runs via test probes ... Flip
 * the topology flags and wire production-panel-proof directly into the live
 * customer production route as the active Call 1 engine (no more probe-only
 * execution). Ensure the DAG graph orchestrates the transition cleanly from
 * Call 1 through the cutter and Call 2."
 *
 * She is right that a component nothing routes to is not shipped, and this file
 * is what stops it being un-routed again. What it locks:
 *
 *   1. the DAG runs in order and the cut spends ZERO model calls;
 *   2. the sheet crosses the node boundary as an IDENTITY (path + hash + size),
 *      never as bytes — RULE 0.39;
 *   3. a refusal is TYPED, so flat-first-atlas fails over to six-surface rather
 *      than leaving the customer with nothing — RULE 0.38;
 *   4. an unfilled panel cell is a refusal, because white is not dark and every
 *      hole predicate in this repo is a darkness test (the efca5e03 lesson);
 *   5. the PASSENGER IS NOT MIRRORED. Its cell is authored, and mirroring an
 *      authored passenger is the defect four separate reader fixes chased;
 *   6. all three quadrants reach the receipt — the clean panels and the cut
 *      graphics are the owner's own contract, not a by-product to discard;
 *   7. the flag is OFF unless a deploy says `on`, and the routing is
 *      first-authoring only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const proof = require("../runtime/atlas-panel-proof-topology.cjs");
const atlas = require("../runtime/flat-first-atlas.cjs");
const container = require("../runtime/atlas-proof-container-template.cjs");
const { assembleFinishedMaster } = require("../runtime/atlas-finished-master.cjs");

const topologySrc = fs.readFileSync(
  new URL("../runtime/atlas-panel-proof-topology.cjs", import.meta.url), "utf8");
const atlasSrc = fs.readFileSync(
  new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");

const SURFACES = [["driver", 153, 56], ["passenger", 153, 56], ["hood", 71.5, 56],
  ["roof", 74.3, 54.8], ["front", 129, 34], ["rear", 76, 54]]
  .map(([surfaceKey, widthInches, heightInches]) => ({
    surfaceKey, widthInches, heightInches, bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  }));

const MANIFEST = atlas.buildAtlasManifest(SURFACES, undefined, "truck");

/**
 * A SHEET WITH EVERY CELL PAINTED, drawn at the container's own geometry.
 *
 * Every panel cell is filled with a solid colour so `fit` reads high, which is
 * what a real returned sheet looks like where it matters. A fixture with empty
 * cells would exercise the refusal and nothing else.
 */
async function paintedSheet({ empty = [], width = 3072, height = 2048 } = {}) {
  const layout = container.containerLayout(container.parsePanelRows(
    proof.panelRowsFromManifest(MANIFEST)));
  const sx = width / layout.width;
  const sy = height / layout.height;
  const rects = [];
  for (const [zone, colour] of [["zone1", "#1d4ed8"], ["zone2", "#0f766e"], ["zone3", "#b91c1c"]]) {
    for (const cell of layout[zone] || []) {
      if (empty.includes(`${zone}:${cell.surfaceKey}`)) continue;
      rects.push(`<rect x="${Math.round(cell.x * sx)}" y="${Math.round(cell.y * sy)}" `
        + `width="${Math.round(cell.w * sx)}" height="${Math.round(cell.h * sy)}" fill="${colour}"/>`);
    }
  }
  return sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>${rects.join("")}</svg>`,
  )).png().toBuffer();
}

/** An edge stand-in that records what it was asked and hands back a sheet. */
function edgeStub(sheetBytes, overrides = {}) {
  const calls = [];
  return {
    calls,
    callProofEdge: async (body) => {
      calls.push(body);
      return {
        bytes: sheetBytes, contentHash: "a".repeat(64), storagePath: "atlas-panel-proof/a.jpg",
        byteSize: sheetBytes.length, model: "gemini-3-pro-image",
        contract: "designpro.atlas-panel-proof.v1", ...overrides,
      };
    },
  };
}

const AUTHOR_ARGS = {
  manifest: MANIFEST, sharp, assembleFinishedMaster,
  input: {
    companyName: "Bright Smiles Dental", phone: "(520) 555-0192", website: "brightsmiles.com",
    brief: "a clean blue wave wrap for a dental practice",
    vehicle: { year: "2012", make: "Toyota", model: "Prius" },
  },
};

test("the DAG runs sheet -> cut -> assemble, and only the sheet spends a model call", async () => {
  const sheet = await paintedSheet();
  const { callProofEdge, calls } = edgeStub(sheet);
  const out = await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, callProofEdge });

  assert.equal(calls.length, 1, "ONE image call authors all three bands");
  assert.equal(out.imageRequestCount, 1);
  assert.deepEqual(out.provenance.stageTimings.map((s) => s.stage),
    ["proof.sheet", "panel.cut", "master.assemble"], "the DAG's own order");
  // THE CUT IS DETERMINISTIC. Every surface receipt reports zero image requests,
  // which is the whole claim the owner's three-quadrant contract rests on: one
  // call produces the panels and geometry produces the artifacts.
  assert.equal(out.surfaces.length, 6);
  for (const surface of out.surfaces) {
    assert.equal(surface.imageRequestCount, 0, `${surface.surfaceKey} must cost no model call`);
    assert.equal(surface.method, "panel-proof-cut");
  }
  // WHAT LEAVES IS AN ORDINARY MASTER, so the existing gates judge it. A
  // document would have meant teaching twelve proven stages a second shape.
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.width, 4096);
  assert.equal(meta.height, 4096);
});

test("the sheet crosses the boundary as an IDENTITY, never as bytes — RULE 0.39", () => {
  // The edge answers {proofStoragePath, proofSha256, proofByteSize} and the
  // transport verifies BOTH halves before the pixels are used: a swapped object
  // and a caller whose claim does not match what it wrote are two failures.
  assert.match(topologySrc, /payload\.proofStoragePath/);
  assert.match(topologySrc, /bytes\.length !== Number\(payload\.proofByteSize\) \|\| sha256\(bytes\) !== payload\.proofSha256/);
  // And nothing may travel as a blob across it.
  const code = topologySrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const banned of ["base64", "inlineData", "data:image"]) {
    assert.ok(!code.includes(banned),
      `a node boundary carries an identity, never a blob — found "${banned}"`);
  }
});

test("the container is staged only where the edge would accept it", async () => {
  // THE 2099d17d LESSON, APPLIED BEFORE IT COSTS A RUN. `attach()` admits a
  // Call-1 input ONLY from ^atlas-call1-inputs/<sha256>\.png$, and hero-first's
  // node 1 spent a whole live generation discovering that by being refused.
  const edge = fs.readFileSync(
    new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  const declared = /const CALL1_INPUT_PATH = (\/\^atlas-call1-inputs[^;]*?)\;/.exec(edge);
  assert.ok(declared, "the edge must declare its own input allowlist");
  assert.equal(String(proof.CALL1_INPUT_PATH), declared[1].trim(),
    "the runtime mirrors the edge's allowlist exactly; a laxer copy cannot catch a door-shaped defect");

  const uploads = [];
  const supabase = {
    storage: {
      from: () => ({
        download: async () => ({ data: null }),
        upload: async (path, bytes) => { uploads.push({ path, size: bytes.length }); return {}; },
      }),
    },
  };
  const staged = await proof.stageProofContainer({
    supabase, manifest: container.parsePanelRows(proof.panelRowsFromManifest(MANIFEST)),
    companyName: "Bright Smiles Dental", vehicle: "2012 Toyota Prius",
  });
  assert.equal(uploads.length, 1);
  assert.match(staged.containerStoragePath, proof.CALL1_INPUT_PATH);
  assert.equal(staged.containerStoragePath, `atlas-call1-inputs/${staged.containerContentHash}.png`,
    "the filename IS the content hash — the edge checks that separately from the claim");
});

test("an UNFILLED panel cell is refused, because white is not dark", async () => {
  // Every hole predicate in this repo is a darkness test (holeAt <= 24,
  // nearBlackAt <= 40), which is exactly how live efca5e03 shipped a die-cut
  // sheet on an rgb(88,88,88) surround past every gate. An empty CELL is a blank
  // print panel and would sail through all of them, so `fit` convicts it here.
  const sheet = await paintedSheet({ empty: ["zone1:rear"] });
  const { callProofEdge } = edgeStub(sheet);
  await assert.rejects(
    () => proof.authorPanelProofMaster({ ...AUTHOR_ARGS, callProofEdge }),
    (error) => {
      assert.equal(error.code, "flat_atlas_panel_proof_refused");
      assert.match(error.reason, /unfilled panel cells: rear=/);
      return true;
    });
});

test("a refusal is TYPED, and flat-first-atlas fails it over to six-surface — RULE 0.38", () => {
  const error = new proof.PanelProofRefusal("the proof edge returned no sheet");
  assert.equal(error.code, "flat_atlas_panel_proof_refused");
  // THE FAIL-OVER IS THE REASON THE FLAG IS SAFE TO FLIP. RULE 0.38 was written
  // after field-first routing left a refused request with nothing behind it,
  // because its fail-over was one-directional.
  const branch = atlasSrc.slice(atlasSrc.indexOf("} else if (panelProof) {"));
  assert.match(branch, /if \(cause\?\.code !== "flat_atlas_panel_proof_refused"\) throw cause;/,
    "a FAULT must propagate; only a creative refusal changes contract");
  assert.match(branch, /failOverToSixSurface\(\{[\s\S]{0,200}from: PANEL_PROOF_TOPOLOGY, to: "six-surface"/);
  // And a gate refusal on the assembled sheet fails over too, rather than
  // re-rolling a document that has already been asked for once.
  assert.match(atlasSrc, /if \(heroDriver \|\| panelProof\) \{/);
});

test("THE PASSENGER IS NOT MIRRORED — its cell is authored", async () => {
  // The 2026-09-16 ruling, applied to this contract: "Passenger is its own
  // territory, never mirrored Driver" (RULE 0.33) and "must never be replaced by
  // mirrored Driver pixels" (RULE 0). Four defects — 8eec8162, 9789762d,
  // cc382c3c, 8c525565 — were all downstream of mirroring an authored flank, and
  // all four were chased in the READER.
  //
  // The panel proof authors on the ORDINARY six-surface manifest, so the
  // topology test that protects the field contract cannot see this case. That is
  // why the caller states it, and why this asserts the caller does.
  const call = atlasSrc.slice(atlasSrc.indexOf("await composePassengerFromDriver({"));
  assert.match(call.slice(0, 400), /passengerAuthored: panelProof,/,
    "the panel-proof pass must declare its passenger authored");

  const decline = await (async () => {
    // Driven through the real function: an authored passenger declines BEFORE a
    // single lettering read, so this is latency as well as correctness.
    let readCalls = 0;
    const provider = { request: async () => { readCalls += 1; return {}; } };
    const result = await atlas._test.composePassengerFromDriver({
      masterBytes: await paintedSheet(), manifest: MANIFEST,
      input: AUTHOR_ARGS.input, provider, passengerAuthored: true,
    });
    return { result, readCalls };
  })();
  assert.equal(decline.result.composed, false);
  assert.equal(decline.result.reason, "passenger_is_its_own_authored_panel");
  assert.equal(decline.readCalls, 0, "not one lettering read is spent on a passenger nobody mirrored");
});

test("all three quadrants reach the receipt — the clean panels and the cut graphics are the contract", async () => {
  const sheet = await paintedSheet();
  const { callProofEdge } = edgeStub(sheet);
  const out = await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, callProofEdge });
  const q = out.provenance.quadrants;
  // Owner, 2026-09-18: "panels with the graphics, panels without the overlay
  // graphic just the design, and the graphic overlays by themselves." A reader
  // that could not see the last two here would assume the sheet carried only
  // panels, and the blank panels are what PanelPro lays on a vehicle template.
  assert.equal(q.branded.length, 6);
  assert.equal(q.clean.length, 6);
  assert.equal(q.cutGraphics.length, 5, "five cut-graphic slots, the container's own");
  for (const panel of [...q.branded, ...q.clean]) {
    assert.ok(panel.rect && Number.isFinite(panel.fit), `${panel.surfaceKey} must carry its rect and fit`);
  }
  // The proof sheet's own identity is on the receipt, so "which sheet produced
  // this master" is a query rather than a storage-timestamp guess.
  assert.equal(out.provenance.proofSha256, "a".repeat(64));
  assert.equal(out.provenance.proofStoragePath, "atlas-panel-proof/a.jpg");
  // AND NO PANEL SET COMES BACK. The six surface RECEIPTS do (above), because a
  // receipt is a record; the panel BYTES do not, because `cutCallOnePanels` cuts
  // production's six from the assembled master and a second set nobody reads
  // answers "which panels does production buy" twice.
  assert.equal(out.panels, undefined,
    "the chain cuts its own panels; returning a rival set is the second producer RULE 0.21 forbids");
});

test("the flag is OFF unless a deploy says on, and the routing is first-authoring only", () => {
  assert.equal(proof.panelProofEnabled({}), false, "unset is OFF: four probe sheets, none on a customer run");
  assert.equal(proof.panelProofEnabled({ DESIGNPRO_ATLAS_PANEL_PROOF: "ON " }), true);
  assert.equal(proof.panelProofEnabled({ DESIGNPRO_ATLAS_PANEL_PROOF: "no" }), false,
    "a typo fails to the SAFE side, which for an unproven routing is off");

  // ROUTED AT THE HEAD, ahead of hero-driver (which measured 0/3 on real
  // vehicles and is off), so one flag decides one thing.
  const head = atlasSrc.slice(atlasSrc.indexOf("async function generateOrReuseFlatAtlas(options) {"),
    atlasSrc.indexOf("async function generateOrReuseFlatAtlasResolved"));
  assert.ok(head.indexOf("panelProofEnabled()") < head.indexOf("heroDriverEnabled()"),
    "the panel proof is read first, so its flag alone decides whether it runs");
  assert.match(head, /panelProofEnabled\(\)\s*\n?\s*&& options\?\.parentManifest == null && \(options\?\.revisionSequence \?\? 1\) === 1/,
    "a revision edit keeps its parent's topology");
  // And the pass refuses one outright rather than half-running.
  assert.match(atlasSrc, /flat_atlas_panel_proof_edit_unsupported/);
});

test("CALL 2 AND THE QC->WRAPBOX CHAIN ARE THE ORCHESTRATION THAT ALREADY EXISTED", () => {
  // Owner, 2026-09-19: "I dont understand why they are new we had the graph
  // engineered orchestration for the 3d proofs and the QC - wrapbox checks."
  //
  // She was right, and an earlier draft of this work had written a SECOND Call-2
  // caller (runtime/atlas-proof-3d.cjs) beside the one the worker already owns.
  // Nothing required it — a duplicate producer that nothing routes to, which is
  // what RULE 0.29 ("DO NOT CREATE ANOTHER 3D EDGE FUNCTION") and RULE 1
  // ("recover before you invent") both forbid. It is deleted.
  //
  // So this asserts the NEGATIVE, which is the property that actually matters:
  // the panel-proof pass stops at an assembled master, and every stage after it
  // is the existing chain, reached by the existing seams.
  assert.ok(!existsSync(new URL("../runtime/atlas-proof-3d.cjs", import.meta.url)),
    "the duplicate Call-2 caller must stay deleted; launchAtlasProof is the one that runs");

  // Call 1 renders no proof and names no photographer. COMMENTS ARE STRIPPED
  // FIRST: this file's header QUOTES the deleted module and the photographer to
  // record why they are forbidden, and a lock that trips on its own explanation
  // cannot be satisfied without deleting the reason.
  const topologyCode = topologySrc
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/persona-photographer|generate-color-render|atlas-proof-3d/.test(topologyCode),
    "Call 1 does not render proofs; the existing panel release does");

  // It also hands back no panels. The chain cuts its own six from the assembled
  // master, and a second set nobody reads is the question "which panels does
  // production buy" with two answers.
  assert.ok(!/^\s*panels: zone1,/m.test(topologyCode),
    "the topology must not return a second panel set beside cutCallOnePanels'");

  // AND THE REAL SEAMS ARE READ FROM THE FILES THAT OWN THEM, so a rename or a
  // deletion there fails here rather than silently orphaning this route.
  const worker = fs.readFileSync(
    new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");
  assert.match(worker, /const launchAtlasProof = \(\{ atlas, sourceViewType/,
    "the per-surface 3D release the panel proof feeds into");
  const provider = fs.readFileSync(
    new URL("../runtime/designpanel-server-provider.cjs", import.meta.url), "utf8");
  assert.match(provider, /ATLAS_PROOF_STAGE = "persona-photographer-render"/,
    "RULE 0.29: the proof producer is the deployed photographer, not a new renderer");
  const claimant = fs.readFileSync(
    new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
  for (const stage of ["await_panelpro_preflight_qc", "enhance.upscale", "output.build"]) {
    assert.ok(claimant.includes(stage), `the QC -> WrapBox chain still owns ${stage}`);
  }
});
