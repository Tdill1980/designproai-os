/**
 * THE RESOLUTION PASS IS WIRED, AND IT CANNOT COST A DESIGN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-23, on her own New Aura run (`848be1c6` / `a9d6dd85`): "the
 * resolution will not work see each panel some look a diff sheen almost like
 * real while others look like print files".
 *
 * The cause is one number. The sheet is delivered at 5056 x 3392, Zone 1 is
 * 25.8% of its height, and SIX panels sit across it — so a 166.8" passenger
 * flank is drawn at ~843 px, which is 5.0 pixels per inch. Topaz at 5 px/in is
 * inventing, not sharpening, and at 843 px the model composes each cell as its
 * own small picture, which is why one panel came back photographic and another
 * abstract. `runtime/atlas-panel-refine.cjs` re-authors each Zone 1 cell on its
 * own ~4096 px canvas after the design is accepted.
 *
 * `tests/atlas-panel-refine.test.mjs` locks the MODULE's arithmetic. This file
 * locks the WIRING, which is where a module that nothing calls hides:
 *
 *   1. OFF is the default, and off is byte-identical — no transport call, no
 *      changed panel, `panelRefine: null` on the receipt;
 *   2. ON replaces the six Zone 1 panels with the re-authored bytes and says so
 *      per surface, with px/in before and after;
 *   3. a REFUSED surface keeps its original crop (RULE 0.15's cut-out ruling:
 *      a defect that only exists in the panel must not destroy the design);
 *   4. `fit` is RE-MEASURED on the refined pixels — carrying the sheet crop's
 *      density onto different bytes is the receipts-green/pixels-wrong shape
 *      this repo records five times;
 *   5. the pixel Map never reaches the receipt;
 *   6. the die-cut gate still runs on the ORIGINAL fits and refuses BEFORE a
 *      single image request is spent;
 *   7. BOTH callers hand the transport down and the topology builds no door of
 *      its own (RULE 0.26: one Call-1 network endpoint).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const proof = require("../runtime/atlas-panel-proof-topology.cjs");
const atlas = require("../runtime/flat-first-atlas.cjs");
const container = require("../runtime/atlas-proof-container-template.cjs");
const { assembleFinishedMaster } = require("../runtime/atlas-finished-master.cjs");

const SURFACES = [["driver", 153, 56], ["passenger", 153, 56], ["hood", 71.5, 56],
  ["roof", 74.3, 54.8], ["front", 129, 34], ["rear", 76, 54]]
  .map(([surfaceKey, widthInches, heightInches]) => ({
    surfaceKey, widthInches, heightInches, bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  }));
const MANIFEST = atlas.buildAtlasManifest(SURFACES, undefined, "truck");

/** Every cell painted, so `fit` reads high where it matters. */
async function paintedSheet({ zone1Colour = "#1d4ed8", width = 3072, height = 2048 } = {}) {
  const layout = container.containerLayout(container.parsePanelRows(
    proof.panelRowsFromManifest(MANIFEST)));
  const sx = width / layout.width;
  const sy = height / layout.height;
  const rects = [];
  for (const [zone, colour] of [["zone1", zone1Colour], ["zone2", "#0f766e"], ["zone3", "#b91c1c"]]) {
    for (const cell of layout[zone] || []) {
      rects.push(`<rect x="${Math.round(cell.x * sx)}" y="${Math.round(cell.y * sy)}" `
        + `width="${Math.round(cell.w * sx)}" height="${Math.round(cell.h * sy)}" fill="${colour}"/>`);
    }
  }
  return sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>${rects.join("")}</svg>`,
  )).png().toBuffer();
}

function memoryStore() {
  const objects = new Map();
  return {
    objects,
    async putImmutableBytes({ storagePath, bytes, contentType }) {
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      objects.set(storagePath, { bytes, contentType });
      return { storagePath, contentHash, byteSize: bytes.length };
    },
  };
}

/**
 * An atlas-author stand-in. It answers at the EXACT target the caller asked
 * for, in a colour no sheet cell carries, so "did the refined bytes actually
 * land on the panel" is a pixel question rather than a receipt question.
 *
 * `refuse` names surfaces it throws on, which is how the fail-soft case is
 * exercised against the real `authorSurface` rather than a stub of it.
 */
function authorEdgeStub({ refuse = [] } = {}) {
  const calls = [];
  return {
    calls,
    callAuthorEdge: async (body) => {
      calls.push(body);
      if (refuse.includes(body.surfaceKey)) {
        throw Object.assign(new Error("provider said no"), { code: "provider_refused" });
      }
      const bytes = await sharp({
        create: {
          width: Number(body.targetWidthPx), height: Number(body.targetHeightPx),
          channels: 3, background: "#ff00ff",
        },
      }).png().toBuffer();
      return { bytes, imageRequestCount: 1 };
    },
  };
}

const BASE = {
  manifest: MANIFEST, sharp, assembleFinishedMaster,
  input: {
    companyName: "New Aura Day Spa", industryType: "Day spa", brandColors: "plum, sage",
    brief: "a calm botanical wrap", vehicle: { year: "2022", make: "Ford", model: "F250" },
  },
};

async function run({ enabled, refuse = [], sheetBytes = null } = {}) {
  const before = process.env.DESIGNPRO_ATLAS_PANEL_REFINE;
  if (enabled) process.env.DESIGNPRO_ATLAS_PANEL_REFINE = "on";
  else delete process.env.DESIGNPRO_ATLAS_PANEL_REFINE;
  const bytes = sheetBytes || await paintedSheet();
  const edge = authorEdgeStub({ refuse });
  const store = memoryStore();
  try {
    const result = await proof.assemblePanelProofMaster({
      ...BASE, store,
      sheet: {
        bytes, contentHash: "a".repeat(64), storagePath: "atlas-panel-proof/a.png",
        byteSize: bytes.length, contract: "designpro.atlas-panel-proof.v1",
      },
      panelRows: proof.panelRowsFromManifest(MANIFEST),
      customerAssets: [], downloadAsset: async () => { throw new Error("no assets"); },
      callAuthorEdge: edge.callAuthorEdge, ownerId: "owner-1",
      providerRequest: { requestId: "req-1", generationId: "gen-1" },
    });
    return { result, edge, store };
  } finally {
    if (before === undefined) delete process.env.DESIGNPRO_ATLAS_PANEL_REFINE;
    else process.env.DESIGNPRO_ATLAS_PANEL_REFINE = before;
  }
}

/**
 * The share of the ASSEMBLED MASTER painted in the stub's magenta. No sheet
 * cell carries that colour, so this answers the only question that matters:
 * did the re-authored pixels reach the artefact production consumes, or did
 * only the receipt change? Receipts green over wrong pixels is the failure
 * shape this repo records five times.
 */
async function magentaShare(bytes) {
  const { data, info } = await sharp(bytes).resize(64, 64, { fit: "fill" })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let hits = 0;
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] > 200) hits += 1;
  }
  return hits / total;
}

test("OFF is the default, and off spends nothing and changes nothing", async () => {
  const { result, edge } = await run({ enabled: false });
  assert.equal(edge.calls.length, 0, "an unset flag must not reach the atlas-author transport");
  assert.equal(result.provenance.threeZoneLayout.panelRefine, null,
    "a pass that never ran reports null, not an empty receipt that reads like a measured one");
  assert.equal(result.provenance.threeZoneLayout.brandedSource, "sheet-drawn");
  // And the pixels say so too: not one re-authored panel reached the master.
  assert.equal(await magentaShare(result.bytes), 0,
    "with the flag unset the master must carry only the sheet's own cells");
});

test("ON re-authors all six panels on their own canvas and lands the pixels", async () => {
  const { result, edge } = await run({ enabled: true });
  assert.equal(edge.calls.length, 6, "one image request per Zone 1 panel");
  assert.deepEqual([...new Set(edge.calls.map((c) => c.mode))], ["atlas-author"],
    "the resolution pass goes through the ONE Call-1 door, never a new mode");
  // Driver is authored alone and FIRST, so the other five continue its
  // conversation instead of being five unrelated designs.
  assert.equal(edge.calls[0].surfaceKey, "driver");
  assert.equal(edge.calls[0].first, false, "the design is already decided; this continues it");

  const receipt = result.provenance.threeZoneLayout.panelRefine;
  assert.equal(receipt.applied, true);
  assert.equal(receipt.refinedCount, 6);
  assert.equal(receipt.retainedCount, 0);
  assert.equal(receipt.longEdgePx, 4096);
  assert.equal(receipt.surfaces.length, 6);
  for (const surface of receipt.surfaces) {
    assert.equal(surface.refined, true, `${surface.surfaceKey} must be re-authored`);
    assert.ok(surface.pxPerInchAfter > surface.pxPerInchBefore * 3,
      `${surface.surfaceKey}: ${surface.pxPerInchBefore} -> ${surface.pxPerInchAfter} px/in is not the point of this pass`);
  }
  // ⛔ THE PIXEL MAP MUST NEVER REACH A JSON COLUMN.
  assert.equal(receipt.panels, undefined);
  assert.ok(!JSON.stringify(receipt).includes("Buffer"));

  // `brandedSource` still answers WHO DREW ZONE 1 — the designer, from this
  // sheet — and the canary refuses any value but these two, so a third name
  // here would fail every run the moment the flag turns on.
  assert.equal(result.provenance.threeZoneLayout.brandedSource, "sheet-drawn");
  assert.deepEqual(result.provenance.composition.placements, [],
    "code composited nothing; a resolution pass is not a compositor");

  // ⛔ THE PIXELS, NOT THE RECEIPT. The re-authored panels must reach the
  // assembled master — the artefact every panel, proof and print file is cut
  // from. A receipt that says "refined" over the sheet's own cells would be
  // exactly the defect the v28 composite shipped.
  assert.ok(await magentaShare(result.bytes) > 0.5,
    "the re-authored panels must be what the master is assembled from");
});

test("a REFUSED surface keeps its original crop; the rest still improve", async () => {
  const { result, edge } = await run({ enabled: true, refuse: ["rear"] });
  const receipt = result.provenance.threeZoneLayout.panelRefine;
  assert.equal(receipt.refinedCount, 5);
  assert.equal(receipt.retainedCount, 1);
  const rear = receipt.surfaces.find((s) => s.surfaceKey === "rear");
  assert.equal(rear.refined, false, "a refusal is recorded, never swallowed");
  assert.match(String(rear.reason), /provider/i);
  // The design survived: a master was still assembled and every other panel
  // improved. This is the whole reason the pass fails soft — the 2026-09-17
  // cascade threw away four good surfaces over one refused one.
  assert.ok(result.bytes?.length, "a refused panel must not cost the design");
  assert.equal(receipt.surfaces.filter((s) => s.refined).length, 5);
  // Five of six zones re-authored, one still the sheet's own crop.
  const share = await magentaShare(result.bytes);
  assert.ok(share > 0.4 && share < 0.95, `five of six zones refined, got ${share}`);
  // The rear was attempted twice (authorSurface's own bounded budget) and then
  // stood down; nothing retries it a third time.
  assert.equal(edge.calls.filter((c) => c.surfaceKey === "rear").length, 2);
});

test("`fit` is re-measured on the refined pixels, never carried from the sheet crop", async () => {
  const src = fs.readFileSync(new URL("../runtime/atlas-panel-proof-topology.cjs", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("panelRefine = await refineZoneOnePanels("),
    src.indexOf("const panelRefineReceipt"));
  assert.match(block, /fit: await inkFraction\(sharp, bytes\)/,
    "the refined panel's density must be measured on its own bytes, with no sheet rectangle");
  // `inkFraction` must accept the absent rectangle, or that call extracts
  // nothing and throws inside an accepted Call 1.
  const panels = fs.readFileSync(new URL("../runtime/atlas-proof-panels.cjs", import.meta.url), "utf8");
  assert.match(panels, /async function inkFraction\(sharp, bytes, rect = null\)/);
  assert.match(panels, /if \(rect\) pipeline\.extract\(rect\);/);
});

test("the die-cut gate runs FIRST and refuses before an image request is spent", async () => {
  // A hood drawn cut to the vehicle's shape: its branded cell is materially
  // emptier than its own clean twin, with page colour in all four corners.
  const layout = container.containerLayout(container.parsePanelRows(
    proof.panelRowsFromManifest(MANIFEST)));
  const width = 3072, height = 2048;
  const sx = width / layout.width, sy = height / layout.height;
  const rects = [];
  for (const [zone, colour] of [["zone1", "#1d4ed8"], ["zone2", "#0f766e"], ["zone3", "#b91c1c"]]) {
    for (const cell of layout[zone] || []) {
      const x = Math.round(cell.x * sx), y = Math.round(cell.y * sy);
      const w = Math.round(cell.w * sx), h = Math.round(cell.h * sy);
      if (zone === "zone1" && cell.surfaceKey === "hood") {
        // A small island of artwork on a white surround: corners are page.
        rects.push(`<rect x="${x + Math.round(w * 0.3)}" y="${y + Math.round(h * 0.3)}" `
          + `width="${Math.round(w * 0.4)}" height="${Math.round(h * 0.4)}" fill="${colour}"/>`);
        continue;
      }
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${colour}"/>`);
    }
  }
  const dieCutSheet = await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>${rects.join("")}</svg>`,
  )).png().toBuffer();

  let threw = null;
  let edge = null;
  try { ({ edge } = await run({ enabled: true, sheetBytes: dieCutSheet })); }
  catch (cause) { threw = cause; }
  assert.ok(threw, "a panel drawn cut to the vehicle's shape must still be refused");
  assert.match(String(threw.reason || threw.message), /cut to the vehicle's shape/);
  // ⛔ THE ORDER IS THE POINT. Refining first would buy six images for a sheet
  // about to be thrown away, and it would ALSO defeat the gate: the comparison
  // is branded-against-clean, and re-authored bytes are no longer the cell the
  // clean twin is the twin of.
  assert.equal(threw.details?.dieCut?.convicted?.[0]?.surfaceKey, "hood");
});

test("both callers hand the transport down, and the topology builds no door of its own", async () => {
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  // RULE 0.26: ONE Call-1 network endpoint. The topology may consume the
  // transport and may never construct one.
  const topology = strip(fs.readFileSync(
    new URL("../runtime/atlas-panel-proof-topology.cjs", import.meta.url), "utf8"));
  assert.doesNotMatch(topology, /createAtlasAuthorTransport|callAtlasAuthorEdge|\bfetch\(/,
    "the topology must be HANDED the atlas-author transport, never build or call one");
  // Guard the stripper: it must not be what makes the assertion pass.
  assert.match(strip("const x = 1;\ncreateAtlasAuthorTransport({});"), /createAtlasAuthorTransport/);

  // The in-process path builds it once, where the cascade already does.
  const flat = strip(fs.readFileSync(
    new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8"));
  assert.match(flat, /callAuthorEdge: createAtlasAuthorTransport\(\{ supabase, callAuthorEdge, ownerId \}\),/,
    "the panel-proof call site must hand down the same transport the cascade uses");

  // The DURABLE path is the live one (CALL1_GRAPH=on), and it was the half a
  // wiring change is most likely to miss: `proof.assemble` runs in the node
  // worker, which already holds `callEdge` for the surface nodes.
  const graph = strip(fs.readFileSync(
    new URL("../runtime/atlas-call1-graph.cjs", import.meta.url), "utf8"));
  const assembleBlock = graph.slice(graph.indexOf("panelProof.assemblePanelProofMaster("),
    graph.indexOf("const stored = await store.putImmutableBytes("));
  assert.ok(assembleBlock.length > 0, "the graph's assemble node must still call the shared assembler");
  assert.match(assembleBlock, /callAuthorEdge:/,
    "proof.assemble must forward the transport or the refine never runs on the live durable path");
  assert.match(assembleBlock, /ownerId: run\.owner_id/,
    "the provider cache isolates on the owner; a graph-claimed node must send the run's owner");
});
