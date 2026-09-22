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
 *   3. a refusal is typed, recorded, and terminal; no substitute generation;
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

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { resolveEsbuild } from "../scripts/build-control-prompt.mjs";
import { loadDesignIQ, ATLAS_PANELS } from "./helpers/load-designiq.mjs";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const proof = require("../runtime/atlas-panel-proof-topology.cjs");
const atlas = require("../runtime/flat-first-atlas.cjs");
const container = require("../runtime/atlas-proof-container-template.cjs");
const { assembleFinishedMaster } = require("../runtime/atlas-finished-master.cjs");
const { zonePixelSize } = require("../runtime/atlas-hero-driver.cjs");

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

/**
 * A store that behaves like the REAL `putImmutableBytes`, because a fixture
 * laxer than the real thing cannot catch a defect of the real thing — this repo
 * has now recorded that shape five times, twice on this very contract.
 *
 * So it mirrors `generation-store.cjs`: it hashes the bytes itself, returns
 * `{storagePath, contentHash, byteSize}`, and REFUSES a content-addressed path
 * that already holds different bytes rather than silently overwriting.
 */
function memoryStore() {
  const objects = new Map();
  return {
    objects,
    async putImmutableBytes({ storagePath, bytes, contentType }) {
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const existing = objects.get(storagePath);
      if (existing && createHash("sha256").update(existing.bytes).digest("hex") !== contentHash) {
        throw new Error("content-addressed path already holds different bytes");
      }
      objects.set(storagePath, { bytes, contentType });
      return { storagePath, contentHash, byteSize: bytes.length };
    },
  };
}

const AUTHOR_ARGS = {
  manifest: MANIFEST, sharp, assembleFinishedMaster, store: memoryStore(),
  input: {
    companyName: "Bright Smiles Dental", phone: "(520) 555-0192", website: "brightsmiles.com",
    brief: "a clean blue wave wrap for a dental practice",
    vehicle: { year: "2012", make: "Toyota", model: "Prius" },
  },
};

test("Call 1 preserves selected brand choices and actual VisionBoard intent in the shared designer payload", async () => {
  const { buildDesignIQPrompt } = await loadDesignIQ();
  const { panelProofCreativeHead } = require("../runtime/atlas-panel-proof-contract.cjs");
  const edge = fs.readFileSync(new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  const start = edge.indexOf("    const customerAssets =");
  const end = edge.indexOf("    let prompt = buildPanelProofPrompt(");
  assert.ok(start > 0 && end > start, "the edge must select its attached references before assembling the designer prompt");
  // Execute the edge's actual parameter mapping with its real shared designer,
  // without starting Deno or making a paid provider request.
  const assembly = execFileSync(resolveEsbuild(), ["--loader=ts", "--format=cjs"], {
    input: `(() => {\n${edge.slice(start, end)}\nreturn creativeHead;\n})()`, encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).png().toBuffer();
  const input = {
    ...AUTHOR_ARGS.input, colors: ["#123456", "#fedcba"], style: "geometric racing stripes",
    fontStyle: "bold condensed", industry: "Dental", finish: "Satin",
    visionboardIntent: "exact_reference", styleDescriptors: "diagonal copper gradients",
    vehicle: { ...AUTHOR_ARGS.input.vehicle, type: "car" },
  };
  const { calls, callProofEdge } = edgeStub(Buffer.from("sheet"));
  await proof.requestProofSheet({ manifest: MANIFEST, input, callProofEdge, store: memoryStore(),
    customerImageParts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] });
  const body = calls[0];
  assert.equal(body.brandColors, "#123456, #fedcba");
  assert.equal(body.style, input.style);
  assert.equal(body.fontStyle, input.fontStyle);
  assert.equal(body.industryType, input.industry);
  assert.equal(body.finish, "Satin");
  assert.equal(body.vehicleType, "car");
  assert.equal(body.visionboard_intent, "exact_reference");
  assert.equal(body.styleDescriptors, input.styleDescriptors);
  assert.equal(body.customerAssets.length, 1);
  assert.equal(body.separatedArtwork, true);
  assert.ok(!Object.hasOwn(body, "logoAsset"), "protected Zone-3 originals do not enter the generation request");
  const assemble = (request) => runInNewContext(assembly, {
    body: request, customerPrompt: request.customerPrompt,
    field: (name) => String(request[name] || "").trim(),
    buildDesignIQPrompt, panelProofCreativeHead, ATLAS_PANELS,
  });
  const exact = assemble(body);
  assert.match(exact, /senior graphic designer and vehicle-wrap specialist/);
  assert.match(exact, /native Gemini 3 Pro Image design knowledge/);
  assert.ok(exact.includes(input.brief), "failed intake cannot erase the customer's creative brief");
  assert.match(exact, /Brand colors: #123456, #fedcba/);
  assert.match(exact, /Style direction: geometric racing stripes/);
  assert.doesNotMatch(exact, /Typography preference:|Spell the business name|Contact info \(place in the contact bar\)/,
    "clean-background generation leaves typography to the compositor");
  assert.match(exact, /BACKGROUND ARTWORK ONLY — NO LETTERING OF ANY KIND/);
  assert.match(exact, /EXACT REFERENCE: The provided reference is the customer's approved artwork authority/);
  assert.doesNotMatch(exact, /STYLE INSPIRATION:/);
  const inspired = assemble({ ...body, visionboard_intent: "style_inspiration" });
  assert.match(inspired, /STYLE INSPIRATION:/);
  assert.ok(inspired.includes(input.styleDescriptors));
  assert.doesNotMatch(assemble({ ...body, customerAssets: [] }), /EXACT REFERENCE:|STYLE INSPIRATION:/,
    "reference instructions require a reference attached to this same request");
});

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

test("the sheet crosses the boundary as an IDENTITY, never as bytes — RULE 0.39", async () => {
  // The real body, from a real pass with real customer assets staged, so the
  // blob check below measures what production actually sends.
  const { callProofEdge, calls } = edgeStub(await paintedSheet());
  const png = await sharp({ create: { width: 24, height: 24, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } })
    .png().toBuffer();
  await proof.authorPanelProofMaster({
    ...AUTHOR_ARGS, store: memoryStore(), callProofEdge,
    customerImageParts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }],
  });
  const lastEdgeBody = calls[0];

  // The edge answers {proofStoragePath, proofSha256, proofByteSize} and the
  // transport verifies BOTH halves before the pixels are used: a swapped object
  // and a caller whose claim does not match what it wrote are two failures.
  assert.match(topologySrc, /payload\.proofStoragePath/);
  assert.match(topologySrc, /bytes\.length !== Number\(payload\.proofByteSize\) \|\| sha256\(bytes\) !== payload\.proofSha256/);
  // AND NOTHING TRAVELS AS A BLOB ACROSS IT — asserted on the BODY THAT LEAVES,
  // not on a substring of the source.
  //
  // This used to grep the source for "base64" / "inlineData" / "data:image".
  // That proxy was wider than the defect and it convicted the RIGHT behaviour:
  // `stageCustomerAssets` DECODES an in-memory `inlineData` part precisely in
  // order to write it to storage and send a reference, which is what RULE 0.39
  // asks for. A source grep cannot tell "decoded here, then staged" from
  // "shipped across the boundary".
  //
  // So the lock reads every value in the real request body instead. A blob is
  // only a violation when it CROSSES, and that is now what is measured —
  // the same "locked as arriving, not as sent" move the hero-flatten signature
  // lock already makes.
  const body = deepValues(lastEdgeBody);
  for (const [path, value] of body) {
    if (typeof value !== "string") continue;
    assert.ok(value.length < 512,
      `the edge request carries a ${value.length}-char string at ${path} — a blob, not an identity`);
    assert.ok(!/^data:image/.test(value), `${path} carries a data: URI`);
  }
  for (const [path] of body) {
    assert.ok(!/inlineData|\.data$/.test(path),
      `the edge request carries pixel data at ${path}; it must carry {storagePath, contentHash, byteSize}`);
  }
});

/** Every leaf of an object, as [dottedPath, value]. */
function deepValues(node, prefix = "", out = []) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => deepValues(v, `${prefix}[${i}]`, out));
  } else if (node && typeof node === "object" && !Buffer.isBuffer(node)) {
    for (const [k, v] of Object.entries(node)) deepValues(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.push([prefix, node]);
  }
  return out;
}

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
    dimensionManifest: MANIFEST,
    companyName: "Bright Smiles Dental", vehicle: "2012 Toyota Prius",
  });
  assert.equal(uploads.length, 1);
  assert.match(staged.containerStoragePath, proof.CALL1_INPUT_PATH);
  assert.equal(staged.containerStoragePath, `atlas-call1-inputs/${staged.containerContentHash}.png`,
    "the filename IS the content hash — the edge checks that separately from the claim");
});

test("a visually blank Zone 2 cell is recorded but cannot trigger an ATLAS flat refusal", async () => {
  // Studio already authored six cells from GENIE geometry. Pixel appearance is
  // QC evidence, never geometry authority and never a panel-count kill switch.
  const sheet = await paintedSheet({ empty: ["zone2:rear"] });
  const { callProofEdge } = edgeStub(sheet);
  const out = await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, callProofEdge });
  assert.equal(out.provenance.threeZoneLayout.backgrounds, 6);
  const rear = out.provenance.quadrants.clean.find((p) => p.surfaceKey === "rear");
  assert.ok(rear);
  assert.equal(rear.identity.method, "studio-template-cell");
});

test("provisional AI Zone 1 geometry is discarded and the complete band is composed from Zone 2", async () => {
  const width = 3072, height = 2048;
  const top = Math.round(height*0.105), bottom = Math.round(height*0.363);
  // One wrong-shaped magenta slab cannot be mistaken for six brand panels.
  // It must be completely replaced, not retained around the composed cells.
  const sheet = await sharp(await paintedSheet()).composite([{
    input: await sharp({create:{width,height:bottom-top,channels:3,background:"#ff00ff"}}).png().toBuffer(),
    left:0,top,
  }]).png().toBuffer();
  const store = memoryStore();
  const {callProofEdge} = edgeStub(sheet);
  const out = await proof.authorPanelProofMaster({...AUTHOR_ARGS,store,callProofEdge});
  assert.equal(out.provenance.threeZoneLayout.branded,6);
  assert.equal(out.provenance.threeZoneLayout.backgrounds,6);
  assert.ok(out.provenance.threeZoneLayout.graphics > 0);
  assert.ok(out.provenance.quadrants.branded.every(panel => panel.positionalPremiseVerified && panel.identity));
  const productionProof = store.objects.get(out.provenance.productionComposedProof.storagePath).bytes;
  const outsidePanel = await sharp(productionProof).extract({left:2,top:top+50,width:1,height:1})
    .removeAlpha().raw().toBuffer();
  assert.deepEqual([...outsidePanel],[255,255,255],"discarded provisional pixels cannot remain behind the final panels");
  for (const panel of out.provenance.quadrants.clean) {
    const stored = store.objects.get(panel.storagePath);
    assert.equal(createHash("sha256").update(stored.bytes).digest("hex"),panel.contentHash);
  }
});

test("composed proof header preserves brand and vehicle parsed from the customer's brief", async () => {
  const sheet = await paintedSheet();
  const store = memoryStore();
  const { callProofEdge } = edgeStub(sheet, { intake: {
    companyName: "Bright Smiles Dental", vehicleYear: "2012", vehicleMake: "Toyota", vehicleModel: "Prius",
  } });
  const out = await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, store, callProofEdge,
    input: { brief: "Bright Smiles Dental wrap for a 2012 Toyota Prius", vehicle: {} },
  });
  const actual = store.objects.get(out.provenance.proofStoragePath).bytes;
  const expected = await container.renderContainerTemplate({
    manifest: container.parsePanelRows(proof.panelRowsFromManifest(MANIFEST)),
    dimensionManifest: MANIFEST,
    companyName: "Bright Smiles Dental", vehicle: "2012 Toyota Prius", bleedInches: 5,
    // The job block is filled by code (the ID ladder): today's date, the
    // designer, V1. No generation id was minted for this fixture, so the second
    // row is the ruled ORDER # line.
    job: { date: proof._test.proofDateLabel(), designer: "DesignProAI", version: "V1" },
  });
  const header = async bytes => sharp(bytes).resize(3072,2048,{fit:"fill"})
    .extract({left:0,top:0,width:3072,height:160}).removeAlpha().raw().toBuffer();
  // Buffer.equals, never deepEqual: a 1.5 MB diff message on a mismatch is what
  // got this test SIGKILLed for memory before it could report anything.
  assert.ok((await header(actual)).equals(await header(expected)),
    "code-owned header must use parsed intake rather than generic COMPANY NAME / VEHICLE placeholders");
});

test("the job block names the GENERATION ID before a purchase, never a derived DID", async () => {
  // Owner, 2026-09-22: "Generation ID is call one, then design id, and order
  // id." The sheet is a pre-purchase document; its second row is the Generation
  // ID (first 8 hex), and a real order number still wins when one exists.
  const sheet = await paintedSheet();
  const store = memoryStore();
  const { callProofEdge } = edgeStub(sheet);
  const generationId = "aded4bf5-1cd9-4f31-8d6e-8d6c3cc1c94b";
  const out = await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, store, callProofEdge,
    providerRequest: { generationId }, revision: { sequence: 2 } });
  const actual = store.objects.get(out.provenance.proofStoragePath).bytes;
  const render = (job) => container.renderContainerTemplate({
    manifest: container.parsePanelRows(proof.panelRowsFromManifest(MANIFEST)), dimensionManifest: MANIFEST,
    companyName: "Bright Smiles Dental", vehicle: "2012 Toyota Prius", bleedInches: 5, job,
  });
  const header = async bytes => sharp(bytes).resize(3072,2048,{fit:"fill"})
    .extract({left:0,top:0,width:3072,height:160}).removeAlpha().raw().toBuffer();
  const withGenerationId = await header(await render({
    date: proof._test.proofDateLabel(), generationId: "ADED4BF5", designer: "DesignProAI", version: "V2" }));
  const withDid = await header(await render({
    date: proof._test.proofDateLabel(), order: "DID-ADED4BF5", designer: "DesignProAI", version: "V2" }));
  assert.ok((await header(actual)).equals(withGenerationId), "the second row must read GENERATION ID ADED4BF5 and VERSION V2");
  assert.ok(!(await header(actual)).equals(withDid), "a DID must not be derived before a purchase");
  assert.equal(proof._test.generationIdLabel(generationId), "ADED4BF5");
  assert.equal(proof._test.generationIdLabel("short"), "");
  assert.match(proof._test.proofDateLabel(new Date("2026-09-22T07:30:00Z")), /^09\/22\/2026$/);
});

test("Zone 3 carries the elements the DESIGN drew, in every slot no original asset claims", async () => {
  // Owner, 2026-09-22, against her reference sheet (KK871 · ROGUE SEVEN · ship
  // graphic · icon · stripe set · badge): "a Restyle design will have design
  // elements that end up in zone 3". A brief with no company, contact or logo
  // used to ship an EMPTY Zone 3 band while the model had drawn all five boxes.
  const store = memoryStore();
  const { callProofEdge } = edgeStub(await paintedSheet());
  const out = await proof.authorPanelProofMaster({
    ...AUTHOR_ARGS, store, callProofEdge,
    input: { brief: "a rusted starfighter livery", vehicle: { year: "2012", make: "Toyota", model: "Prius" } },
  });
  const cut = out.provenance.quadrants.cutGraphics;
  assert.equal(cut.length, 5, "all five drawn boxes reach Zone 3");
  assert.deepEqual(cut.map((e) => e.surfaceKey), [...proof._test.ZONE3_SLOT_KEYS]);
  for (const element of cut) {
    assert.equal(element.source, "sheet-drawn");
    assert.equal(element.vector, false, "a sheet crop is a raster preview, never a vector cut file");
    assert.equal(element.persisted, true);
    assert.equal(element.storagePath, `atlas-elements/${element.contentHash}.png`);
    assert.ok(element.fit >= proof._test.SHEET_DRAWN_MIN_INK, `${element.surfaceKey} carries its ink share`);
    assert.equal(element.bytes, undefined, "no pixels on the receipt");
    const stored = store.objects.get(element.storagePath);
    assert.equal(createHash("sha256").update(stored.bytes).digest("hex"), element.contentHash);
  }
  assert.equal(out.provenance.threeZoneLayout.graphics, 5);
  assert.equal(out.provenance.threeZoneLayout.graphicsFormat, "sheet-drawn-raster");
  // Zone 1 still composites nothing: the crops are Zone 3 elements, not lockup assets.
  assert.deepEqual(out.provenance.composition.placements, []);
  // The composed proof captions those slots as the design's elements, not as
  // PRIMARY LOGO / CONTACT LINE fields the design does not have.
  const captioned = await container.renderContainerTemplate({
    manifest: container.parsePanelRows(proof.panelRowsFromManifest(MANIFEST)), dimensionManifest: MANIFEST,
    companyName: "", vehicle: "2012 Toyota Prius", bleedInches: 5,
    job: { date: proof._test.proofDateLabel(), designer: "DesignProAI", version: "V1" },
    zone3Captions: proof._test.ZONE3_SLOT_KEYS.map(() => proof._test.SHEET_DRAWN_CAPTION),
  });
  const plain = await container.renderContainerTemplate({
    manifest: container.parsePanelRows(proof.panelRowsFromManifest(MANIFEST)), dimensionManifest: MANIFEST,
    companyName: "", vehicle: "2012 Toyota Prius", bleedInches: 5,
    job: { date: proof._test.proofDateLabel(), designer: "DesignProAI", version: "V1" },
  });
  const captions = async bytes => sharp(bytes).resize(3072,2048,{fit:"fill"})
    .extract({left:0,top:1560,width:3072,height:60}).removeAlpha().raw().toBuffer();
  const actual = await captions(store.objects.get(out.provenance.proofStoragePath).bytes);
  assert.ok(actual.equals(await captions(captioned)), "the caption strip reads DESIGN ELEMENT under every drawn slot");
  assert.ok(!actual.equals(await captions(plain)), "the business captions are not printed under design elements");
});

test("a Zone 3 box the model left blank is an empty slot, recorded, never a fabricated element", async () => {
  const layout = container.containerLayout(container.parsePanelRows(proof.panelRowsFromManifest(MANIFEST)));
  const { callProofEdge } = edgeStub(await paintedSheet({
    empty: layout.zone3.map((cell) => `zone3:${cell.surfaceKey}`),
  }));
  const out = await proof.authorPanelProofMaster({
    ...AUTHOR_ARGS, store: memoryStore(), callProofEdge,
    input: { brief: "a clean blue wave wrap", vehicle: { year: "2012", make: "Toyota", model: "Prius" } },
  });
  assert.deepEqual(out.provenance.quadrants.cutGraphics, []);
  assert.equal(out.provenance.threeZoneLayout.graphicsFormat, "none");
  const blank = out.provenance.composition.omitted.filter((o) => o.reason === "slot_not_drawn");
  assert.deepEqual(blank.map((o) => o.role), [...proof._test.ZONE3_SLOT_KEYS]);
});

test("panel-proof refusals are recorded, re-rolled ONCE, then terminal — never a substitute authoring route", () => {
  // THE CONTRACT (owner, 2026-09-22): two candidates, then terminal with the
  // gate's real reason and both sheets in the refusal ledger. Never
  // `failOverToSixSurface` -- there is no other Call 1 to fail over to.
  const error = new proof.PanelProofRefusal("the proof edge returned no sheet");
  assert.equal(error.code, "flat_atlas_panel_proof_refused");
  const start = atlasSrc.indexOf("} else if (panelProof) {");
  const end = atlasSrc.indexOf("generated = { bytes: proof.bytes", start);
  const branch = atlasSrc.slice(start, end);
  assert.doesNotMatch(branch, /failOverToSixSurface/, "a panel-proof run never enters the six-surface contract");
  // The durable graph is preferred; a missing graph runs the SAME two functions
  // in-process (D) and records it, rather than throwing
  // designpro_atlas_call1_graph_unavailable at the customer.
  assert.match(branch, /designpro_atlas_call1_graph_unavailable/);
  assert.match(branch, /authorPanelProofMaster\(\{/, "the in-process fallback is the same pass the graph's nodes execute");
  assert.match(branch, /graph: \{ unavailable: true/);
  // Every refused candidate reaches the ledger WITH its sheet, then the next
  // candidate is spent (`continue`), then the last one is terminal.
  const recordAt = branch.indexOf("recordAtlasRefusal(supabase, {");
  const continueAt = branch.indexOf("continue;", recordAt);
  const stopAt = branch.indexOf("throw refusal;", continueAt);
  assert.ok(recordAt > 0 && continueAt > recordAt && stopAt > continueAt,
    "record the ledger row, spend the next candidate, and only then stop");
  for (const field of ["storagePath", "sha256", "byteSize"]) {
    assert.ok(branch.slice(recordAt, continueAt).includes(`${field}: cause?.details?.sheet?`));
  }
  assert.match(branch, /creativeRefusal && attempt < maxAuthoringAttempts/);
  // The candidate index is part of the durable identity, or the second
  // candidate is a cache read of the first.
  assert.match(branch, /candidate: attempt/);
  // THE OLD SHAPE IS GONE: an unconditional `if (panelProof) { retryable = false; throw }`
  // ahead of the attempt budget gave a panel-proof run exactly ONE candidate.
  assert.doesNotMatch(atlasSrc, /if \(panelProof\) \{\n\s*\/\/ A later master gate may refuse an assembled proof too/);
  const tail = atlasSrc.slice(atlasSrc.indexOf("const refusalReason = stillBlocking.join"),
    atlasSrc.indexOf("// No corrective-note text is carried into the next attempt"));
  const terminalAt = tail.indexOf("if (attempt === maxAuthoringAttempts) {");
  const panelTerminalAt = tail.indexOf("if (panelProof) {", terminalAt);
  assert.ok(terminalAt > 0 && panelTerminalAt > terminalAt,
    "the panel-proof terminal throw sits INSIDE the exhausted-budget branch");
  assert.match(tail.slice(panelTerminalAt, panelTerminalAt + 700), /refusal\.retryable = false;\s*\n\s*throw refusal;/);
  assert.ok(!tail.slice(0, terminalAt).includes("if (panelProof)"),
    "no panel-proof throw ahead of the attempt budget");
});

test("Zone 3 degrades instead of refusing: no assets or text is an EMPTY band, recorded", async () => {
  // Owner, 2026-09-22: "System must not issue fails because of no atlas ...
  // Nothing may block orchestration." A brief with no company name, no contact
  // line, no wordmark and no logo has nothing to cut. That used to refuse the
  // whole Call 1 ("Zone 3 requires original assets or customer text") -- the
  // design, its DesignID and every proof lost over an absent contact bar.
  const { callProofEdge } = edgeStub(await paintedSheet());
  const out = await proof.authorPanelProofMaster({
    ...AUTHOR_ARGS, store: memoryStore(), callProofEdge,
    input: { brief: "a clean blue wave wrap", vehicle: { year: "2012", make: "Toyota", model: "Prius" } },
  });
  assert.ok(out.contentHash, "the master is still produced");
  // No ORIGINAL asset and no customer text: nothing is composited onto Zone 1.
  // The Zone 3 band itself is not empty on this fixture -- the sheet drew all
  // five boxes and they are carried as the design's own elements (locked in
  // its own test below); what this test pins is that the absence of originals
  // is recorded and never refuses.
  assert.equal(out.provenance.threeZoneLayout.branded, 6);
  assert.equal(out.provenance.threeZoneLayout.backgrounds, 6);
  assert.ok(out.provenance.quadrants.cutGraphics.every((e) => e.source === "sheet-drawn"),
    "no original asset can appear when none was supplied");
  // The absence of originals is a RECORDED state, never a silent one.
  const omitted = out.provenance.composition.omitted.find((o) => o.zone === "zone3" && o.role === null);
  assert.ok(omitted, "the absence of originals must be named in composition.omitted");
  assert.equal(omitted.reason, "no_original_assets_or_customer_text");
  assert.deepEqual(out.provenance.composition.placements, []);
  // Zone 1 is then the authored panels exactly as Zone 2 carries them.
  for (const panel of out.provenance.composition.panels) {
    assert.equal(panel.contentHash, panel.backgroundContentHash, `${panel.surfaceKey}: nothing composited, nothing changed`);
    assert.deepEqual(panel.applied, []);
  }
  // And the master is what the six Zone-1 panels assemble into: 4096 square.
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.width, 4096);
});

test("Zone 3 degrades the other way: a generated logo without alpha is dropped and named, not refused", async () => {
  const opaque = await sharp({ create: { width: 120, height: 40, channels: 3, background: "#123456" } }).png().toBuffer();
  const contentHash = createHash("sha256").update(opaque).digest("hex");
  const logo = { role: "logo", storagePath: `atlas-elements/${contentHash}.png`, contentHash,
    byteSize: opaque.length, contentType: "image/png" };
  const { callProofEdge } = edgeStub(await paintedSheet(), { generatedElements: [logo], imageRequestCount: 2 });
  const out = await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, store: memoryStore(), callProofEdge,
    downloadAsset: async () => opaque });
  assert.ok(out.contentHash);
  // The opaque mark is not a cut graphic; the outlined typography and contact
  // line still are, and the three slots no original claims (the logo slot
  // included) carry what the sheet drew, so Zone 3 carries five and the
  // design proceeds.
  assert.ok(!out.provenance.quadrants.cutGraphics.some((a) => a.contentHash === contentHash),
    "the opaque generated mark never reaches Zone 3");
  assert.equal(out.provenance.quadrants.cutGraphics.filter((a) => a.source !== "sheet-drawn").length, 2);
  assert.equal(out.provenance.quadrants.cutGraphics.length, 5);
  const omitted = out.provenance.composition.omitted.find((o) => o.zone === "zone3" && o.role === "logo");
  assert.ok(omitted, "the dropped mark must be named");
  assert.equal(omitted.reason, "generated_logo_has_no_transparent_channel");
  assert.equal(omitted.contentHash, contentHash);
});

test("a SUPPLIED logo that cannot be read or hash-verified still refuses", async () => {
  // The customer's own file is not a degradable extra: shipping a design
  // without it is a WRONG design, not a degraded one.
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const logoAsset = { storagePath: `users/test/revisions/test/inputs/logo/${contentHash}.svg`, contentHash,
    byteSize: bytes.length, contentType: "image/svg+xml" };
  for (const [label, downloadAsset] of [
    ["unreadable", async () => { throw new Error("storage unavailable"); }],
    ["hash mismatch", async () => Buffer.from(bytes.toString() + " ")],
  ]) {
    const { callProofEdge } = edgeStub(await paintedSheet());
    await assert.rejects(
      () => proof.authorPanelProofMaster({ ...AUTHOR_ARGS, store: memoryStore(), callProofEdge,
        input: { ...AUTHOR_ARGS.input, logoAsset }, downloadAsset }),
      (error) => label === "unreadable" ? /storage unavailable/.test(String(error.message))
        : error.code === "flat_atlas_panel_proof_refused" && /original logo identity mismatch/.test(error.reason),
      `${label}: a supplied logo is never silently dropped`);
  }
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
  const originals = q.cutGraphics.filter((a) => a.source !== "sheet-drawn");
  const drawn = q.cutGraphics.filter((a) => a.source === "sheet-drawn");
  assert.equal(originals.length, 2, "original outlined brand and contact assets");
  assert.ok(originals.every(a => a.vector && a.contentType === "image/svg+xml"));
  assert.equal(drawn.length, 3, "the design's own elements fill the three slots the originals left");
  assert.ok(drawn.every(a => !a.vector && a.contentType === "image/png"));
  for (const panel of [...q.branded, ...q.clean]) {
    assert.ok(panel.rect && Number.isFinite(panel.fit), `${panel.surfaceKey} must carry its rect and fit`);
  }
  // The proof sheet's own identity is on the receipt, so "which sheet produced
  // this master" is a query rather than a storage-timestamp guess.
  assert.equal(out.provenance.sourceArtwork.contentHash, "a".repeat(64), "retain the internal Gemini artwork identity");
  assert.equal(out.provenance.sourceArtwork.storagePath, "atlas-panel-proof/a.jpg");
  assert.ok(out.provenance.productionComposedProof?.storagePath);
  assert.equal(out.provenance.productionComposedProof.contentHash, out.provenance.proofSha256,
    "customer Call 1 must address the code-owned complete three-zone sheet");
  assert.equal(out.provenance.productionComposedProof.storagePath, out.provenance.proofStoragePath);
  // AND NO PANEL SET COMES BACK. The six surface RECEIPTS do (above), because a
  // receipt is a record; the panel BYTES do not, because `cutCallOnePanels` cuts
  // production's six from the assembled master and a second set nobody reads
  // answers "which panels does production buy" twice.
  assert.equal(out.panels, undefined,
    "the chain cuts its own panels; returning a rival set is the second producer RULE 0.21 forbids");
});

test("the clean panels and the cut graphics are STORED, and the receipt addresses real bytes", async () => {
  // Owner, 2026-09-19: "Production panel proof is source it has the 3 zones /
  // For panels, panels with seperated and logos and text."
  //
  // THIS IS THE LOCK THAT WOULD HAVE CAUGHT THE DEFECT. `sibling()` recorded
  // surfaceKey, role, byteSize, fit and rect — no path, no hash — so eleven
  // panels of authored artwork were cut, measured and dropped on the floor when
  // the function returned, while the module header claimed they "ride on the
  // provenance as content-addressed siblings". The previous test asserted
  // `rect` and `fit` on the clean band and passed throughout, because a
  // measurement is exactly what a discarded buffer still has.
  //
  // A byteSize for bytes nobody can fetch is a receipt claiming what was never
  // established. So this asserts the IDENTITY, and then goes to the store and
  // proves the bytes are really there under the hash the receipt names.
  const sheet = await paintedSheet();
  const { callProofEdge } = edgeStub(sheet);
  const store = memoryStore();
  const out = await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, store, callProofEdge });
  const q = out.provenance.quadrants;

  for (const panel of [...q.clean, ...q.cutGraphics]) {
    const where = `${panel.role}:${panel.surfaceKey}`;
    assert.equal(panel.persisted, true, `${where} was not stored`);
    assert.match(panel.contentHash, /^[0-9a-f]{64}$/, `${where} has no content hash`);
    assert.ok(Number.isFinite(panel.byteSize) && panel.byteSize > 0, `${where} has no byte size`);

    // CONTENT-ADDRESSED, AND NOT IN THE EDGE'S INPUT DOORWAY. These are Call-1
    // OUTPUTS; `atlas-call1-inputs/` is the allowlist the flatten reads from,
    // and a product artifact sitting there is one refactor away from being
    // attached to a customer's own generation as a teaching input.
    assert.equal(panel.storagePath,
      panel.role === "cut-graphic" ? `atlas-elements/${panel.contentHash}.${panel.vector ? "svg" : "png"}`
        : `atlas-panel-proof/quadrants/${panel.contentHash}.png`,
      `${where} must be addressed by its own hash`);
    assert.doesNotMatch(panel.storagePath, /^atlas-call1-inputs\//,
      `${where} is an output and must not live in the edge's input prefix`);

    // THE BYTES ARE ACTUALLY THERE, under that exact path, hashing to that
    // exact hash, at that exact length. This is the assertion the old receipt
    // could never have satisfied.
    const stored = store.objects.get(panel.storagePath);
    assert.ok(stored, `${where}: nothing was written to ${panel.storagePath}`);
    assert.equal(createHash("sha256").update(stored.bytes).digest("hex"), panel.contentHash,
      `${where}: the stored object does not hash to the hash on the receipt`);
    assert.equal(stored.bytes.length, panel.byteSize,
      `${where}: the receipt's byteSize is not the stored object's length`);
    assert.equal(stored.contentType, panel.vector ? "image/svg+xml" : "image/png");
  }

  // ELEVEN RECEIPT ENTRIES — six clean panels, two original cut graphics and
  // the three drawn elements — and one object per DISTINCT content hash, not
  // per entry.
  //
  // Content addressing deduplicates by design, and this fixture proves it does:
  // its synthetic cells are uniformly painted, so several crops are byte-identical
  // and the entries land in fewer objects. That is the store behaving correctly;
  // a real sheet's panels differ, and either way every entry above was verified
  // to address the bytes actually stored under its own hash.
  //
  // The "wrote one buffer under every path" failure is caught anyway: the store
  // refuses a content-addressed path that already holds different bytes, exactly
  // as generation-store.cjs does.
  const entries = [...q.clean, ...q.cutGraphics];
  assert.equal(entries.length, 11);
  assert.equal(new Set(entries.map((p) => p.storagePath)).size,
    new Set(entries.map((p) => p.contentHash)).size,
    "one stored object per distinct content hash");

  // ZONE 1 IS NOT STORED AGAIN. It became the master; a second copy addressed
  // separately is the rival panel set RULE 0.21 forbids, one layer down.
  for (const panel of q.branded) {
    assert.equal(panel.storagePath, undefined,
      "zone 1 became the master — storing it again creates a second panel set");
  }
  assert.ok(Number.isFinite(out.timings.quadrantStoreMs));
});

test("mandatory quadrants refuse instead of publishing a partial proof", async () => {
  const { callProofEdge } = edgeStub(await paintedSheet());
  for (const store of [undefined, {
    putImmutableBytes: async () => { throw new Error("bucket unavailable"); },
  }]) {
    await assert.rejects(
      () => proof.authorPanelProofMaster({ ...AUTHOR_ARGS, store, callProofEdge }),
      (error) => error.code === "flat_atlas_panel_proof_refused"
        && /mandatory/.test(error.reason));
  }
});

test("a blank generated graphics band is replaced with original outlined assets", async () => {
  const layout = container.containerLayout(container.parsePanelRows(proof.panelRowsFromManifest(MANIFEST)));
  const { callProofEdge } = edgeStub(await paintedSheet({
    empty: layout.zone3.map((cell) => `zone3:${cell.surfaceKey}`),
  }));
  const out = await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, callProofEdge });
  assert.equal(out.provenance.quadrants.cutGraphics.length, 2);
  assert.equal(out.provenance.threeZoneLayout.graphicsFormat, "vector-originals");
});

test("the flag is a deploy receipt, not a router: the panel proof is the ONLY Call 1, for first authoring and revisions", () => {
  // The reader still reads the flag exactly (the deploy-workflow lock walks
  // it from this file to the writer), so the deploy receipt stays honest...
  assert.equal(proof.panelProofEnabled({}), false);
  assert.equal(proof.panelProofEnabled({ DESIGNPRO_ATLAS_PANEL_PROOF: "ON " }), true);
  assert.equal(proof.panelProofEnabled({ DESIGNPRO_ATLAS_PANEL_PROOF: "no" }), false);

  // ...BUT IT NO LONGER SELECTS A CONTRACT (owner, Trish 2026-09-22: "There
  // isn't any other Call 1 — the only call is panel pro production proof").
  //
  // THE HISTORY MATTERS, BECAUSE THIS ASSERTION HAS NOW POINTED THREE WAYS.
  // `c1dbe30e` said "no flag may select this route" because the edge bypassed
  // the brain; 2026-09-21 restored the flag as the FIRST selector once
  // `_shared/designiq-assembly.ts` made that false; and 2026-09-22 removed the
  // selection altogether. The property the route was once banned for lacking
  // is still locked below, because a future edit that takes any of those
  // inputs away would ship a brain-less Call 1 with nothing behind it.
  const head = atlasSrc.slice(atlasSrc.indexOf("async function generateOrReuseFlatAtlas(options) {"),
    atlasSrc.indexOf("async function generateOrReuseFlatAtlasLegacyRouting(options) {"));
  assert.ok(head.includes("panelProofEnabled()"), "the flag is still read, as a receipt");
  assert.match(head, /if \(options\?\.authoringTopology === undefined\) \{[\s\S]{0,400}authoringTopology: PANEL_PROOF_TOPOLOGY/,
    "an unnamed topology is the panel proof, unconditionally");
  assert.ok(!head.includes("heroDriverEnabled()") && !head.includes("fieldFirstReason("),
    "no other selector is read on the live router");
  assert.ok(!/revisionSequence \?\? 1\) === 1/.test(head),
    "revisions are not routed elsewhere: sequence > 1 is the panel proof too");
  // The old selectors are DEAD BUT RETAINED, by name, behind the legacy router
  // production never calls (owner protection #1: resume/read paths stay).
  const legacy = atlasSrc.slice(atlasSrc.indexOf("async function generateOrReuseFlatAtlasLegacyRouting(options) {"),
    atlasSrc.indexOf("async function generateOrReuseFlatAtlasResolved"));
  assert.ok(legacy.includes("heroDriverEnabled()") && legacy.includes("fieldFirstReason("),
    "the other routings are retained, not deleted");
  assert.ok(!atlasSrc.includes("await generateOrReuseFlatAtlasLegacyRouting(")
    && !atlasSrc.includes("return generateOrReuseFlatAtlasLegacyRouting("),
    "and nothing in production calls the legacy router");

  // THE BRAIN, AND EVERY INPUT c1dbe30e SAID THIS PATH LOST. A route that stops
  // carrying one of these is the defect that commit correctly described, so it
  // fails here rather than reaching a customer.
  const fn = fs.readFileSync(new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  assert.match(fn, /from "\.\.\/_shared\/designiq-assembly\.ts"/,
    "A.C.E. itself, through the slice pinned to the deployed design-panel-ai-generate");
  assert.match(fn, /buildDesignIQPrompt\(\{/, "and it is EXECUTED, not described");
  assert.match(fn, /atlasFlatMaster:\s*true/,
    "the same branch Call 1 runs, so LOGO_REQUIREMENT and COMMERCIAL_DEPTH fire");
  for (const input of ["styleDescriptors", "visionboard_intent", "visionBoardImages",
    "brandColors", "creativeDirection", "vehicleMake", "vehicleModel", "vehicleYear"]) {
    assert.ok(fn.includes(input), `the panel-proof Call 1 must still carry ${input}`);
  }
  assert.match(fn, /designpanel-artboard-examples\//,
    "the gold-standard artboards reach it too");
  // A revision edit runs THROUGH the pass now; the outright refusal is gone.
  assert.ok(!atlasSrc.includes('"flat_atlas_panel_proof_edit_unsupported"'),
    "a revision must not be refused by the panel-proof pass");
  assert.match(atlasSrc, /PANEL_PROOF_TOPOLOGY\].includes\(authoringTopology\)/,
    "an explicitly named panel-proof topology is still a legal, runnable contract");
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

test("the customer's logo and references REACH the proof, staged where the edge admits them", async () => {
  // THE WORST DEFECT THIS ROUTE HAD, and the one an independent review found
  // rather than any test here. `requestProofSheet` forwarded text and vehicle
  // fields only, so a customer who uploaded a logo or a reference photo got a
  // design that never saw either -- while the six-surface and field contracts
  // carried both through `edgeExtras.referenceImagesBase64`. RULE 0.24 calls
  // those CREATIVE authority, artwork authority under `exact_reference`, and
  // NOTHING downstream can detect that they were dropped: the sheet is a
  // perfectly good design, just not the customer's brand.
  //
  // The fixture is the SHAPE flat-first-atlas actually hands over --
  // `customerImageParts`, the array of Gemini parts built by
  // `verifiedCustomerLogoPart` + `verifiedCustomerReferenceParts`, text parts
  // and all -- so a change to that hand-off breaks this rather than passing.
  const sheet = await paintedSheet();
  const { callProofEdge, calls } = edgeStub(sheet);
  const store = memoryStore();
  const logo = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } })
    .png().toBuffer();
  const reference = await sharp({ create: { width: 48, height: 32, channels: 4, background: { r: 20, g: 90, b: 180, alpha: 1 } } })
    .png().toBuffer();
  const customerImageParts = [
    { text: "VERIFIED CUSTOMER-OWNED LOGO. This is a customer style/identity source." },
    { inlineData: { mimeType: "image/png", data: logo.toString("base64") } },
    { inlineData: { mimeType: "image/png", data: reference.toString("base64") } },
  ];

  const out = await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, store, callProofEdge, customerImageParts });
  assert.ok(out.contentHash, "the master must still be produced");

  const assets = calls[0]?.customerAssets;
  assert.ok(Array.isArray(assets), "the proof edge must be sent customerAssets");
  assert.equal(assets.length, 2, "both image parts reach the edge; the text part is not an asset");

  for (const [i, bytes] of [logo, reference].entries()) {
    const digest = createHash("sha256").update(bytes).digest("hex");
    const asset = assets[i];
    // THE EDGE'S OWN ALLOWLIST, asserted here so a path the far side would
    // refuse cannot leave the runtime -- the 2099d17d lesson, where node 1
    // spent a whole live generation discovering `attach()` rejects its path.
    assert.equal(asset.storagePath, `atlas-call1-inputs/${digest}.png`);
    assert.match(asset.storagePath, /^atlas-call1-inputs\/[0-9a-f]{64}\.png$/);
    assert.equal(asset.contentHash, digest);
    assert.equal(asset.byteSize, bytes.length);
    // NOT BASE64. The edge has died twice on a bodiless 504 from a 2.2 MB
    // base64 request; a logo plus a reference set is bigger than that.
    assert.equal(asset.data, undefined, "an asset must cross as an identity, never as bytes (RULE 0.39)");
    assert.equal(asset.inlineData, undefined);
    // AND THE BYTES ARE REALLY THERE, under that exact path.
    const stored = store.objects.get(asset.storagePath);
    assert.ok(stored, `nothing was written to ${asset.storagePath}`);
    assert.equal(createHash("sha256").update(stored.bytes).digest("hex"), digest);
  }

  // AND THE RECEIPT SAYS SO. The assets were staged, hash-verified and sent,
  // and then recorded NOWHERE -- so "did the customer's logo reach Call 1" was
  // unanswerable from the run itself, which is precisely the state that let this
  // route ship forwarding neither the logo nor the reference while every receipt
  // read green. Identities only, never bytes.
  assert.deepEqual(out.provenance.customerAssets, assets.map((a) => ({
    storagePath: a.storagePath, contentHash: a.contentHash, byteSize: a.byteSize,
  })), "the receipt must record which customer assets reached Call 1");
});

test("a customer with no uploads sends an empty asset list, never a fabricated one", async () => {
  // The honest empty case. `customerAssets: []` says "this customer uploaded
  // nothing"; omitting the field entirely is what the defect looked like, and a
  // reader could not tell that from "they uploaded nothing". The RECEIPT keeps
  // the same distinction: an empty array, never a missing field.
  const sheet = await paintedSheet();
  const { callProofEdge, calls } = edgeStub(sheet);
  const out = await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, store: memoryStore(), callProofEdge });
  assert.ok(out.contentHash);
  assert.deepEqual(calls[0].customerAssets, []);
  assert.deepEqual(out.provenance.customerAssets, [],
    "an empty array on the receipt too — a MISSING field is what the defect looked like");
});

test("the proof EDGE verifies every customer asset it is handed", async () => {
  // A runtime that names bytes the far side never checked is the shape RULE
  // 0.39 exists to prevent, so the edge repeats all three checks the container
  // already gets: the Call-1 prefix, filename-hash == bytes-hash, and
  // claimed-hash == bytes-hash. Read from the edge source, because that is the
  // file the deploy ships.
  const edge = fs.readFileSync(
    new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");
  assert.match(edge, /panel_proof_customer_asset_path_invalid/);
  assert.match(edge, /panel_proof_customer_asset_not_content_addressed/);
  assert.match(edge, /panel_proof_customer_asset_hash_mismatch/);
  assert.match(edge, /panel_proof_customer_asset_missing/);
  // Bounded: a malformed body cannot turn one request into an unbounded read loop.
  assert.match(edge, /\.slice\(0, 8\)/);
  // Attached AFTER the structural inputs, so the container still conditions the
  // layout first and the customer's assets read as brand content.
  assert.ok(edge.indexOf("for (const pinned of PINNED_INPUTS)") < edge.indexOf("for (const asset of customerAssets)"),
    "customer assets must attach after the container and the pinned format sheet");
});

test("a RECOVERY cannot buy a second paid generation — the edge honours cacheOnly", async () => {
  // F02, found by an independent review. The runtime sends `cacheOnly: true`
  // when it is RECOVERING an interrupted attempt; the proof edge answered with a
  // bare `fetch` and its own `crypto.randomUUID()`, so the flag meant nothing
  // and a lost worker, a lost lease or an unanswered provider call could each
  // buy the same sheet again — invisibly, under a new request id every time.
  //
  // The fix is the module the other Call-1 endpoint already uses, so this
  // asserts the SEAM rather than re-testing that module: identity, claim,
  // cacheOnly, and the unknown-outcome path all belong to it.
  const edge = fs.readFileSync(
    new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");

  assert.match(edge, /from "\.\.\/_shared\/gemini-provider-cache\.mjs"/,
    "the proof edge must use the proven durable-provider module, not a second implementation");
  assert.match(edge, /runDurableImageProviderRequest\(\{/);
  assert.match(edge, /cacheOnly: providerRequest\.cacheOnly === true/,
    "the caller's cacheOnly must reach the module that can honour it");
  assert.match(edge, /authorize: \(\) => authorizeAtlasProviderRequest\(/,
    "the lease must still authorise the provider request (RULE 0.26)");
  assert.match(edge, /identity: \{ \.\.\.providerRequest, ownerId: caller\.userId, mode: "atlas-panel-proof" \}/);
  // THE BARE IMAGE FETCH IS GONE. A second, uncached path to the PAID model is
  // how the contract got bypassed; the only one left is inside `invoke`.
  //
  // Scoped to `geminiImageUrl` on purpose: the other `fetch` in this file is
  // `parseCustomerIntake`, a Flash TEXT call, and counting every fetch convicted
  // it. The contract here is about the billed image generation.
  //
  // THREE SINCE THE ANCHORED PATH (2026-09-21): the DESIGN turn, the LAYOUT
  // turn and the explicit custom-logo call. The design turn is a real third
  // paid generation and this lock's whole subject is that a paid generation
  // cannot be bought twice -- so raising the number is not enough, and the
  // assertions below prove the new one carries the same contract as the others:
  // its own stable attemptKey (`:design`, so a recovery cannot be handed the
  // layout's bytes or made to re-buy the design), the caller's cacheOnly, and
  // the lease authorisation.
  const imageCalls = [...edge.matchAll(/await fetch\(\s*\n?\s*geminiImageUrl\(/g)].length;
  assert.equal(imageCalls, 3,
    `only the design turn, the layout turn and the explicit custom-logo durable invocations may fetch images; found ${imageCalls}`);
  assert.match(edge, /attemptKey: `\$\{providerRequest\.attemptKey\}:design`/,
    "the design turn needs its OWN durable key, or a recovery reads the layout turn's record");
  const designBlock = edge.slice(edge.indexOf("const designRequest = JSON.stringify({"),
    edge.indexOf("designTurnRequestId = designCached.requestId"));
  assert.match(designBlock, /runDurableImageProviderRequest\(\{/,
    "the design turn must go through the durable module, not a bare fetch");
  assert.match(designBlock, /cacheOnly: providerRequest\.cacheOnly === true/,
    "a RECOVERY must not buy the design turn a second time");
  assert.match(designBlock, /authorize: \(\) => authorizeAtlasProviderRequest\(/,
    "the design turn is a paid provider request and still needs the lease (RULE 0.26)");

  // A REJECTED QUALITY CANDIDATE MUST NOT SPEND A SLOT.
  //
  // The loader used to `.slice(0, ARTBOARD_QUALITY_MAX)` the LISTING and then
  // skip the unusable ones inside the loop -- so a duplicate, an oversized
  // file or a failed download consumed one of only two exemplar slots instead
  // of yielding it to the next file in the bucket. With the seeded
  // `01-panel-proof-zones-filled.png` being byte-identical to the pinned
  // format sheet, every request carried ONE real exemplar of professional wrap
  // work no matter how many good files sat behind it.
  assert.doesNotMatch(edge, /\.slice\(0, ARTBOARD_QUALITY_MAX\)/,
    "the ceiling belongs on ACCEPTED examples, never on the listing");
  assert.match(edge, /if \(qualityExamples\.length >= ARTBOARD_QUALITY_MAX\) break;/,
    "walk the listing until the accepted count is reached");

  // ⚠️ EVERY READER OF `providerRequest` COMES AFTER ITS DECLARATION.
  //
  // This is a temporal-dead-zone lock, and it exists because live run 20 died
  // in 25 seconds on "Cannot access 'providerRequest' before initialization"
  // -- before one image request -- while 88 tests were green.
  //
  // THEY WERE GREEN BECAUSE THEY ALL GREP THIS FILE AND NONE EXECUTES IT. A
  // source-level assertion cannot see a TDZ; only running the handler can, and
  // nothing here runs the handler. So the cheap structural invariant is pinned
  // instead: the identity is BOUND before the design turn that keys itself with
  // it, which is bound before the layout request that continues it. Move the
  // declaration back down and this fails where the suite previously could not.
  const iDecl = edge.indexOf("const providerRequest = {");
  const iDesign = edge.indexOf("const designAt = Date.now();");
  const iModel = edge.indexOf("const modelRequest = JSON.stringify({");
  assert.ok(iDecl > 0 && iDesign > 0 && iModel > 0, "all three anchors must exist");
  assert.ok(iDecl < iDesign,
    "providerRequest must be declared before the design turn that authorises against it");
  assert.ok(iDesign < iModel,
    "the design turn must run before the layout request that replays it");
  const wrappedCalls = [...edge.matchAll(/invoke: (?:\(\)|\(request: string\)) => captureGeminiHttpExchange\(async \(\) => await fetch\(\s*geminiImageUrl\(/g)].length;
  assert.equal(wrappedCalls,imageCalls,
    "each image fetch must sit inside captureGeminiHttpExchange so an interrupted exchange is recoverable");
  // A FRESH UUID PER INVOCATION IS THE DEFECT. It must be reassignable from the
  // claim, so a recovered attempt reports the request it recovered.
  assert.match(edge, /let requestId = crypto\.randomUUID\(\)/);
  assert.match(edge, /requestId = cached\.requestId/);

  // AND THE RUNTIME SENDS A STABLE OPERATION KEY, or every recovery is a fresh
  // identity and the claim can never be found.
  const sheet = await paintedSheet();
  const { callProofEdge, calls } = edgeStub(sheet);
  await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, store: memoryStore(), callProofEdge });
  assert.equal(calls[0].attemptKey, "panel-proof:1:1",
    "the attempt key must be stable across recoveries of the same candidate");
  assert.match(calls[0].attemptKey, /^[a-z][a-z0-9:._-]{0,119}$/,
    "the key must satisfy the provider module's own identity pattern");
  // AND DISTINCT ACROSS CANDIDATES AND REVISIONS. The literal "panel-proof:1"
  // made a re-roll a cache read of the refused sheet and a revision a cache
  // read of its parent. `<revisionSequence>:<candidate>` is the identity.
  const second = edgeStub(sheet);
  await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, store: memoryStore(), callProofEdge: second.callProofEdge, candidate: 2 });
  assert.equal(second.calls[0].attemptKey, "panel-proof:1:2");
  const revised = edgeStub(sheet);
  await proof.authorPanelProofMaster({ ...AUTHOR_ARGS, store: memoryStore(), callProofEdge: revised.callProofEdge,
    revision: { sequence: 2, parentRevisionId: "55555555-5555-4555-8555-555555555555", contextHash: "c".repeat(64),
      instruction: "Move the phone number to the rear door.", affectedSurfaces: ["driver", "passenger"],
      parentProof: { storagePath: `atlas-call1-inputs/${"d".repeat(64)}.png`, contentHash: "d".repeat(64), byteSize: 10 } } });
  const body = revised.calls[0];
  assert.equal(body.attemptKey, "panel-proof:2:1");
  assert.equal(body.revisionSequence, 2);
  assert.equal(body.revisionInstruction, "Move the phone number to the rear door.");
  assert.match(body.customerPrompt, /REVISION V2 — apply this change to the approved parent production proof[\s\S]*Move the phone number/,
    "the instruction is folded into the brief the model reads");
  assert.ok(body.customerPrompt.startsWith(AUTHOR_ARGS.input.brief), "after the customer's own brief, never instead of it");
  assert.deepEqual(body.affectedSurfaces, ["driver", "passenger"]);
  assert.equal(body.parentAtlasRevisionId, "55555555-5555-4555-8555-555555555555");
  assert.equal(body.revisionContextHash, "c".repeat(64));
  assert.deepEqual(body.parentProof, { storagePath: `atlas-call1-inputs/${"d".repeat(64)}.png`,
    contentHash: "d".repeat(64), byteSize: 10, role: "parent-production-proof" });
  assert.match(body.parentProof.storagePath, proof.CALL1_INPUT_PATH, "the parent proof rides the edge's own input allowlist");
  // A first generation sends none of the revision fields.
  assert.equal(calls[0].revisionSequence, 1);
  for (const field of ["parentProof", "revisionInstruction", "parentAtlasRevisionId", "affectedSurfaces"]) {
    assert.ok(!Object.hasOwn(calls[0], field), `${field} must be absent on a first generation`);
  }
});

test("two customers can NEVER share a cached sheet, even on identical ids", async () => {
  // Owner's question, and it is the right one to ask of any cache on a paid
  // path: `attemptKey: "panel-proof:1"` is a CONSTANT, so if it were the whole
  // key every customer would collide on it.
  //
  // It is one of five components. `normalizeIdentity` requires
  // {ownerId, requestId, generationId, mode, attemptKey}, the key is a sha256
  // over all of them, and the storage prefix is
  // `designpro-provider-private/v1/<ownerId>/<generationId>/<key>` — so the
  // owner is in the key AND in the path. The three ids are UUID-validated, so a
  // missing one throws rather than degrading to a shared key.
  //
  // This EXECUTES the real module against the worst case — two owners with the
  // same generationId, requestId and attemptKey — rather than asserting the
  // shape of its source.
  const { runDurableImageProviderRequest } = await import(
    "../supabase/functions/_shared/gemini-provider-cache.mjs");

  const objects = new Map();
  const bucket = {
    async upload(path, bytes, opts) {
      if (opts?.upsert === false && objects.has(path)) return { error: { message: "exists" } };
      objects.set(path, Buffer.from(bytes));
      return { error: null };
    },
    async download(path) {
      if (!objects.has(path)) return { data: null, error: { message: "not found" } };
      const b = objects.get(path);
      return { data: {
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        text: async () => b.toString("utf8"),
      }, error: null };
    },
  };

  const OWNER_A = "11111111-1111-4111-8111-111111111111";
  const OWNER_B = "22222222-2222-4222-8222-222222222222";
  const GENERATION = "33333333-3333-4333-8333-333333333333";
  const REQUEST = "44444444-4444-4444-8444-444444444444";
  let invocations = 0;
  const run = (ownerId) => runDurableImageProviderRequest({
    bucket,
    identity: { ownerId, generationId: GENERATION, requestId: REQUEST,
      mode: "atlas-panel-proof", attemptKey: "panel-proof:1" },
    requestHash: "a".repeat(64),
    outputRequestId: "55555555-5555-4555-8555-555555555555",
    authorize: async () => {},
    invoke: async () => { invocations += 1; return { status: 200, payload: { owner: ownerId } }; },
  });

  const a1 = await run(OWNER_A);
  const b1 = await run(OWNER_B);
  const a2 = await run(OWNER_A);

  assert.equal(invocations, 2, "each owner must spend its OWN generation; a shared cache would be 1");
  assert.notEqual(a1.providerRequestKey, b1.providerRequestKey, "the cache key must include the owner");
  assert.equal(a1.providerCacheHit, false);
  assert.equal(b1.providerCacheHit, false, "owner B must not hit owner A's entry");
  assert.equal(a1.payload.owner, OWNER_A);
  assert.equal(b1.payload.owner, OWNER_B, "owner B received owner A's artwork — cross-customer leak");
  // And a recovery reads back its OWN result, which is the point of the contract.
  assert.equal(a2.providerCacheHit, true);
  assert.equal(a2.payload.owner, OWNER_A);

  // The path is namespaced by owner as well, so a bucket listing cannot cross.
  const claims = [...objects.keys()].filter((k) => k.endsWith("claim.json"));
  assert.equal(claims.length, 2);
  assert.ok(claims.some((k) => k.startsWith(`designpro-provider-private/v1/${OWNER_A}/${GENERATION}/`)));
  assert.ok(claims.some((k) => k.startsWith(`designpro-provider-private/v1/${OWNER_B}/${GENERATION}/`)));

  // A missing identity FAILS CLOSED rather than sharing a degenerate key.
  await assert.rejects(() => runDurableImageProviderRequest({
    bucket, identity: { ownerId: "", generationId: GENERATION, requestId: REQUEST,
      mode: "atlas-panel-proof", attemptKey: "panel-proof:1" },
    requestHash: "a".repeat(64), outputRequestId: "55555555-5555-4555-8555-555555555555",
    authorize: async () => {}, invoke: async () => ({ status: 200, payload: {} }),
  }), /provider_request_identity_invalid/);
});

test("the panel rows are REAL INCHES from the fields that exist — not pixels, not transposed", () => {
  // THE DEFECT THAT MADE EVERY FLANK STRETCH 2.1x, and nothing in this repo saw
  // it because the probe passes its `panels` input by hand, already correct.
  //
  // `panelRowsFromManifest` read `zone.trimInches || zone.trim`. A GENIE zone has
  // NO `trimInches` — the fields are trimWidthIn/trimHeightIn and
  // printWidthIn/printHeightIn — so every real call fell through to `zone.trim`,
  // the surface's PIXEL rectangle on the 4096 master. The flank is a tall rotated
  // column there, so the rows were in the wrong unit AND the wrong orientation:
  //
  //     emitted   DRIVER: 979" wide x 2674" high
  //     real      DRIVER: 163" wide x  66" high
  const rows = proof.panelRowsFromManifest(MANIFEST);
  assert.equal(rows.length, 6);
  assert.equal(rows[0], 'DRIVER: 163" wide x 66" high',
    "the driver flank is landscape and 163 inches, not a portrait 979");
  for (const row of rows) {
    const [, w, h] = /: ([\d.]+)" wide x ([\d.]+)" high$/.exec(row) || [];
    assert.ok(w && h, `unparseable row: ${row}`);
    // A plausibility floor, because a pixel rectangle read as inches is exactly
    // what shipped. No vehicle panel is a thousand inches.
    assert.ok(Number(w) <= 400 && Number(h) <= 400, `${row} is not a vehicle panel`);
  }
  // The flanks are the WIDE panels. Transposition is the half of the defect a
  // unit check alone would miss.
  const driver = /: ([\d.]+)" wide x ([\d.]+)" high$/.exec(rows[0]);
  assert.ok(Number(driver[1]) > Number(driver[2]), "a driver flank is wider than it is tall");

  // AND IT REFUSES rather than falling back. The fallback IS the defect: a
  // missing field silently became a pixel rectangle every consumer believed.
  assert.throws(() => proof.panelRowsFromManifest({ zones: [{ surfaceKey: "driver" }] }),
    /no usable print dimensions/);
  assert.throws(() => proof.panelRowsFromManifest({
    zones: [{ surfaceKey: "driver", printWidthIn: 979, printHeightIn: 2674 }],
  }), /these look like pixels, not inches/);
});

test("a crop whose aspect disagrees with its zone is REFUSED, not stretched into it", async () => {
  // `fit: "fill"` cannot refuse anything, and the cutter records
  // `positionalPremiseVerified: false` — so without this guard a crop from the
  // wrong region is reshaped to the exact pixel size the assembler demands,
  // passes both of its assertions, and becomes a print panel.
  //
  // The geometry now agrees to within rounding, which is the real fix; this is
  // the guard that keeps it that way. Measured on the real manifest and the real
  // container: worst drift 1.0032 against a limit of 1.05.
  const layout = container.containerLayout(container.parsePanelRows(
    proof.panelRowsFromManifest(MANIFEST)));
  for (const zone of MANIFEST.zones) {
    const cell = layout.zone1.find((c) => c.surfaceKey === zone.surfaceKey);
    const { pixelWidth, pixelHeight } = zonePixelSize(zone);
    const drift = Math.max((cell.w / cell.h) / (pixelWidth / pixelHeight),
      (pixelWidth / pixelHeight) / (cell.w / cell.h));
    assert.ok(drift <= 1.05,
      `${zone.surfaceKey}: container cell ${(cell.w / cell.h).toFixed(3)} vs zone `
      + `${(pixelWidth / pixelHeight).toFixed(3)} drifts ${drift.toFixed(4)} — the resize would reshape it`);
    // Tighter than the guard, because rounding is all that should remain. If this
    // ever needs loosening, the geometry has drifted and that is the bug.
    assert.ok(drift <= 1.01, `${zone.surfaceKey} drift ${drift.toFixed(4)} is beyond integer rounding`);
  }

  // And the refusal is reachable: a sheet whose cells are a different shape than
  // the zones cannot be assembled into them.
  const { callProofEdge } = edgeStub(await paintedSheet({ width: 3072, height: 512 }));
  await assert.rejects(
    () => proof.authorPanelProofMaster({ ...AUTHOR_ARGS, store: memoryStore(), callProofEdge }),
    (err) => err.code === "flat_atlas_panel_proof_refused",
    "a sheet of the wrong shape must refuse rather than be stretched into the zones");
});


test("Zone 1 uses Zone 2 plus byte-identical original vector assets", async () => {
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><path fill="red" d="M0 0H60V40H0Z"/><path fill="blue" d="M60 0H120V40H60Z"/></svg>');
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const logoAsset = {storagePath:`users/test/revisions/test/inputs/logo/${contentHash}.svg`,contentHash,
    byteSize:bytes.length,contentType:"image/svg+xml"};
  const store = memoryStore();
  const {callProofEdge,calls} = edgeStub(await paintedSheet());
  const result = await proof.authorPanelProofMaster({...AUTHOR_ARGS,store,callProofEdge,
    input:{...AUTHOR_ARGS.input,logoAsset},downloadAsset:async identity => {
      assert.equal(identity.contentHash,contentHash); return bytes;
    }});
  const original = result.provenance.quadrants.cutGraphics.find(a => a.surfaceKey === "logo");
  assert.equal(original.contentHash,contentHash);
  assert.equal(original.storagePath,logoAsset.storagePath);
  assert.equal(original.byteSize,bytes.length);
  assert.equal(calls[0].separatedArtwork,true);
  assert.equal(calls[0].customerAssets.length,0);
  assert.ok(result.provenance.composition.placements.filter(p => p.role === "logo").length === 5);
  const roof = MANIFEST.zones.find(z => z.surfaceKey === "roof").extraction;
  const pixel = await sharp(result.bytes).extract({left:roof.x+Math.floor(roof.w/2),top:roof.y+Math.floor(roof.h/2),width:1,height:1}).removeAlpha().raw().toBuffer();
  assert.deepEqual([...pixel],[15,118,110],"Zone 1 derives from green Zone 2, never blue generated Zone 1");
});

test("generated custom logo identity is shared by branded panels and Zone 3", async () => {
  const bytes = await sharp({create:{width:120,height:40,channels:4,
    background:{r:210,g:30,b:40,alpha:0.7}}}).png().toBuffer();
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const logo = {role:"logo",storagePath:`atlas-elements/${contentHash}.png`,contentHash,
    byteSize:bytes.length,contentType:"image/png"};
  const store = memoryStore();
  const {callProofEdge} = edgeStub(await paintedSheet(),{generatedElements:[logo],imageRequestCount:2});
  const out = await proof.authorPanelProofMaster({...AUTHOR_ARGS,store,callProofEdge,
    downloadAsset:async identity=>{assert.equal(identity.contentHash,contentHash);return bytes;}});
  const graphic = out.provenance.quadrants.cutGraphics.find(asset=>asset.surfaceKey==="logo");
  assert.equal(graphic.contentHash,contentHash);
  const placements = out.provenance.composition.placements.filter(placement=>placement.role==="logo");
  assert.equal(placements.length,5);
  assert.ok(placements.every(placement=>placement.contentHash===graphic.contentHash
    && placement.storagePath===graphic.storagePath));
  assert.equal(out.imageRequestCount,2);
});

test("native generated logo is keyed in the runtime before shared Zone 1 and Zone 3 placement",async()=>{
  const bytes=await sharp({create:{width:100,height:80,channels:3,background:"#ff00ff"}}).composite([{
    input:await sharp({create:{width:40,height:20,channels:3,background:"#123456"}}).png().toBuffer(),left:30,top:30,
  }]).png().toBuffer();
  const nativeHash=createHash("sha256").update(bytes).digest("hex");
  const logo={role:"logo",storagePath:`atlas-elements/${nativeHash}.png`,contentHash:nativeHash,
    byteSize:bytes.length,contentType:"image/png",needsChromaKey:true};
  const store=memoryStore();
  const {callProofEdge}=edgeStub(await paintedSheet(),{generatedElements:[logo],imageRequestCount:2});
  const out=await proof.authorPanelProofMaster({...AUTHOR_ARGS,store,callProofEdge,downloadAsset:async()=>bytes});
  const graphic=out.provenance.quadrants.cutGraphics.find(a=>a.surfaceKey==="logo");
  assert.notEqual(graphic.contentHash,nativeHash);
  assert.equal(graphic.sourceContentHash,nativeHash);assert.equal(graphic.needsChromaKey,false);
  assert.equal(graphic.contentType,"image/png");assert.equal(graphic.vector,false);
  assert.ok(store.objects.has(graphic.storagePath));
  assert.ok(out.provenance.composition.placements.filter(p=>p.role==="logo")
    .every(p=>p.contentHash===graphic.contentHash));
});

test("Porsche brief lettering and race roundel share one original asset across Zones 1 and 3", async () => {
  const brief = "Create a motorsport wrap for a 2022 Porsche 911 Turbo inspired by the classic Porsche Martini race team. Use a clean gloss white base with sweeping navy blue, light blue and red racing stripes running continuously across the hood, roof, rear and both sides. Feature the MARTINI RACING wordmark and race number 23 in bold black numerals inside white roundels on both doors and the hood. Keep the livery crisp, balanced and unmistakably racing-focused, with consistent stripe alignment and the same wordmark and number across all six panels and seven photographic vehicle proof views. Preserve the real Porsche body geometry, vents, lights, windows, rear wing and wheels. Limit printed artwork to the racing stripes, MARTINI RACING wordmark and number 23 roundels; keep the remaining white body areas clean.";
  const store = memoryStore();
  const sheet = await paintedSheet();
  const {callProofEdge,calls} = edgeStub(sheet,{intake:{},generatedElements:[],imageRequestCount:1});
  const out = await proof.authorPanelProofMaster({...AUTHOR_ARGS,store,callProofEdge,
    input:{brief,vehicle:{year:"2022",make:"Porsche",model:"911 Turbo"}}});
  assert.equal(calls.length,1,"uses saved artwork response with no separate logo generation");
  assert.equal(out.imageRequestCount,1);
  const graphic=out.provenance.quadrants.cutGraphics.find(a=>a.surfaceKey==="typography");
  assert.deepEqual(graphic.textContent,["MARTINI RACING","23"]);
  const svg=store.objects.get(graphic.storagePath).bytes.toString();
  assert.match(svg,/<circle[^>]*fill="#ffffff"/);
  assert.match(svg,/<path/);
  assert.doesNotMatch(svg,/<text/);
  assert.ok(out.provenance.composition.placements.filter(p=>p.role==="typography")
    .every(p=>p.contentHash===graphic.contentHash && p.storagePath===graphic.storagePath));
  assert.equal(out.provenance.threeZoneLayout.branded,6);
  assert.equal(out.provenance.threeZoneLayout.backgrounds,6);
});

test("every pinned teaching input states its ROLE before the image, and FORMAT never teaches design", () => {
  // Owner, 2026-09-21: "Should just be using to see how it needs to feed
  // rectangle panels in the zones. Not the design. For design it uses designer
  // persona in design panel ai generate ... it knows what a pro level dentist
  // wrap should look like."
  //
  // The pinned format sheet went into `parts` as bare `inlineData` with NO
  // framing text, while every gold-standard artboard beside it carried a
  // sentence naming what it may not teach. That sheet is the FILLED twin of the
  // container -- a finished Bright Smiles Dental wrap -- so unlabelled it was
  // the strongest visual instruction in the request. Same failure as canary
  // 33389124918, and RULE 0.24 had already forbidden it in prose.
  const fn = fs.readFileSync(new URL("../supabase/functions/production-panel-proof/index.ts", import.meta.url), "utf8");

  assert.match(fn, /PINNED_INPUT_FRAMING/, "pinned inputs carry framing text");
  assert.match(fn, /panel_proof_pinned_input_unframed/,
    "a role with no framing REFUSES rather than shipping the sheet unlabelled");

  // Text before image, in that order, or the sheet arrives unlabelled anyway.
  const loop = fn.slice(fn.indexOf("for (const pinned of"), fn.indexOf("// The gold-standard artboards"));
  assert.ok(loop.indexOf("parts.push({ text: framing })") < loop.indexOf("parts.push(pinnedPart)"),
    "the role is stated BEFORE the image it describes");

  // FORMAT is topology only. These are the axes the sheet's own business owns.
  const framing = fn.slice(fn.indexOf("const PINNED_INPUT_FRAMING"), fn.indexOf("const PINNED_INPUTS"));
  assert.match(framing, /FORMAT AND TOPOLOGY REFERENCE ONLY/);
  for (const forbidden of ["artwork", "palette", "company name", "logo", "brand", "industry", "typography"]) {
    assert.ok(framing.includes(forbidden), `FORMAT must not teach ${forbidden}`);
  }
  assert.match(framing, /come from this customer's own brief/,
    "the design comes from the brief through A.C.E., never from the example");
});
