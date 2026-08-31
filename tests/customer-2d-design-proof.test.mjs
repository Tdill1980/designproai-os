/**
 * THE CUSTOMER 2D DESIGN PROOF IS NOT THE PRODUCTION PROOF.
 *
 * Owner contract, 2026-08-31, §5 and §6:
 *
 *   §5 "The customer must also receive a 2D DESIGN PROOF. This is separate from
 *       the A.T.L.A.S. master. This is separate from the Production Proof. ...
 *       It must NOT expose internal production topology, hashes, manufacturing
 *       metadata or production controls. It is NOT a source of production
 *       artwork."
 *
 *   §6 "The Production Proof is NOT the customer 2D Proof. It is a separate
 *       internal production artifact. ... Before purchase it remains an
 *       internal/staff production artifact."
 *
 * One artifact was serving both, stamped `customer-2d-production-proof` and
 * exported as CUSTOMER_PROOF_ROLE, while drawing TRIM/PRINT/BLEED rules per
 * tile, the GENIE size band, total square feet, an approval signature block and
 * a footer naming the revision, generation and master/render hashes.
 *
 * These tests RENDER BOTH SHEETS from one set of surfaces and inspect what came
 * back, because a source-level assertion cannot tell you whether the production
 * sheet still looks like itself. The design sheet is checked for the ABSENCE of
 * the production layer, and the production sheet for its presence -- in the same
 * run, from the same bytes, so the two cannot be compared against different
 * inputs.
 */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
// sharp and the runtime modules resolve from runtime/, not the repo root --
// the runtime installs its own dependencies (ops/Dockerfile.runtime installs
// into /app), so the root has no node_modules at all.
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const {
  renderMasterProof,
  MASTER_PROOF_CONTRACT,
  DESIGN_PROOF_CONTRACT,
  SURFACE_ORDER,
} = require("../runtime/master-proof-sheet.cjs");

// The runtime image installs fonts-dejavu-core for exactly this reason (see
// ops/Dockerfile.runtime: the proof is typeset from a font FILE, never a family
// name), and the GitHub runner ships it too. A missing font FAILS rather than
// skips -- a skipped proof test is the "green while the artifact is wrong" case
// this file exists to prevent.
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Six flat surfaces at their real GENIE proportions. Colour is irrelevant. */
async function buildRender() {
  const geometry = {
    driver: [251, 60], passenger: [251, 60], hood: [71.5, 56],
    roof: [74.3, 54.8], front: [76, 54], rear: [76, 54],
  };
  const surfaces = [];
  for (const key of SURFACE_ORDER) {
    const [wIn, hIn] = geometry[key];
    // Small rasters: this test is about which markup is drawn, not resolution.
    const w = Math.max(8, Math.round(wIn * 2));
    const h = Math.max(8, Math.round(hIn * 2));
    const bytes = await sharp({
      create: { width: w, height: h, channels: 3, background: "#2266aa" },
    }).png().toBuffer();
    surfaces.push({
      surfaceKey: key,
      bytes,
      contentHash: sha256(bytes),
      pixelWidth: w,
      pixelHeight: h,
      trimWidthIn: wIn,
      trimHeightIn: hIn,
      bleedIn: 5,
      textIdentities: [],
      logoIdentities: [],
    });
  }
  return {
    contract: "designpro.production-surface-render.v1",
    surfaces,
    masterHash: "a".repeat(64),
    renderHash: "b".repeat(64),
    revisionId: "11111111-2222-3333-4444-555555555555",
    dimensionManifestId: "GENIE-TEST-1",
    manifestHash: "c".repeat(64),
  };
}

function buildManifest() {
  const geometry = {
    driver: [251, 60], passenger: [251, 60], hood: [71.5, 56],
    roof: [74.3, 54.8], front: [76, 54], rear: [76, 54],
  };
  const expectedSurfaces = SURFACE_ORDER.map((surfaceKey) => ({
    surfaceKey,
    widthInches: geometry[surfaceKey][0],
    heightInches: geometry[surfaceKey][1],
  }));
  // One rounding boundary, applied after the raw sum -- the rule the Call-8
  // canary established on 2026-08-31 (305.53 vs 305.54).
  const rawSqIn = expectedSurfaces.reduce((sum, s) => sum + s.widthInches * s.heightInches, 0);
  return { expectedSurfaces, totalSqFt: Math.round(rawSqIn / 144 * 100) / 100 };
}

/** Render both variants from ONE set of surfaces, so nothing can diverge. */
let rendered = null;
async function sheets() {
  if (rendered) return rendered;
  const fontBytes = readFileSync(FONT_PATH);
  assert.ok(fontBytes.length > 0, `${FONT_PATH} is empty; the proof cannot be typeset`);
  const common = {
    render: await buildRender(),
    manifest: buildManifest(),
    proofFonts: { regular: fontBytes },
    vehicle: { year: "2023", make: "Ford", model: "F-250", type: "pickup" },
    designName: "Test Design",
    finish: "Gloss",
    designId: "DID-TEST01",
    orderNumber: "RP-TEST",
    generationId: "99999999-8888-7777-6666-555555555555",
  };
  rendered = {
    production: await renderMasterProof({ ...common, variant: "production" }),
    design: await renderMasterProof({ ...common, variant: "design" }),
  };
  return rendered;
}

test("both sheets render from the same surfaces and are different artifacts", async () => {
  const { production, design } = await sheets();
  assert.equal(production.contract, MASTER_PROOF_CONTRACT);
  assert.equal(design.contract, DESIGN_PROOF_CONTRACT);
  assert.notEqual(production.contentHash, design.contentHash,
    "the customer sheet and the production sheet must not be the same file");
  // Same design, same lineage -- that is the whole point of one composer.
  assert.equal(production.masterHash, design.masterHash);
  assert.equal(production.renderHash, design.renderHash);
  assert.equal(production.revisionId, design.revisionId);
});

test("the design sheet publishes no extractable regions", async () => {
  const { production, design } = await sheets();
  // §5: "It is NOT a source of production artwork." A region set is precisely
  // what an extractor binds against.
  assert.equal(production.proofRegions.length, 6, "the production proof keeps its six anchors");
  assert.equal(design.proofRegions.length, 0);
  assert.equal(design.proofRegionContract, null);
});

test("the design sheet carries none of the production bands", async () => {
  const { production, design } = await sheets();
  // The production sheet reserves vertical space for the coverage line, the
  // approval block, the identity/hash footer, the GENIE size band and the
  // per-tile TRIM/BLEED/PRINT caption. Removing all five must SHRINK the sheet;
  // if the design sheet were the same height, the bands are still being drawn.
  assert.ok(design.height < production.height,
    `the design sheet is ${design.height}px and the production sheet ${production.height}px -- the production bands are still reserved`);
  assert.equal(design.width, production.width, "both sheets use the same 1800px frame");
});

test("the design sheet draws no dimension rules or trim boxes", async () => {
  const { production, design } = await sheets();
  // A pixel test, because the captions are outlined to paths and cannot be read
  // as strings from the PNG. The production layer is drawn in near-black ink
  // (#111827) as rules, arrowheads, trim/print rectangles and captions; the
  // design layer's only ink is the six surface labels. So the design sheet must
  // carry dramatically less dark ink over an otherwise white page.
  const inkShare = async (sheet) => {
    const { data, info } = await sharp(sheet.bytes).greyscale().raw().toBuffer({ resolveWithObject: true });
    let dark = 0;
    for (let i = 0; i < data.length; i += 1) if (data[i] < 96) dark += 1;
    return dark / (info.width * info.height);
  };
  const productionInk = await inkShare(production);
  const designInk = await inkShare(design);
  assert.ok(designInk < productionInk,
    `the design sheet carries ${(designInk * 100).toFixed(2)}% ink against production's ${(productionInk * 100).toFixed(2)}% -- the production layer is still drawn`);
});

test("an unknown variant is refused rather than silently defaulted", async () => {
  const fontBytes = readFileSync(FONT_PATH);
  await assert.rejects(
    () => renderMasterProof({
      render: { contract: "designpro.production-surface-render.v1", surfaces: [] },
      manifest: buildManifest(),
      proofFonts: { regular: fontBytes },
      variant: "customer",
    }),
    (error) => error.code === "proof_variant_invalid",
    "a misspelled variant must fail closed, never fall through to the production sheet",
  );
});

test("omitting the variant produces the Production Proof, byte for byte", async () => {
  // THE PRODUCTION PROOF MUST NOT MOVE. Every production-only push is gated on
  // `showProduction`, and `production` is the default, so an existing caller
  // that never heard of variants still gets the identical file. Verified
  // against the pre-change composer at the time this landed: both rendered
  // afcf7238ed9a91b0 at 1800x1196 from these inputs. A hash literal would break
  // on a sharp or font bump, so what is asserted here is the property that
  // actually matters -- the default and the explicit variant are the same file.
  const fontBytes = readFileSync(FONT_PATH);
  const common = {
    render: await buildRender(),
    manifest: buildManifest(),
    proofFonts: { regular: fontBytes },
    vehicle: { year: "2023", make: "Ford", model: "F-250", type: "pickup" },
    designName: "Test Design",
    finish: "Gloss",
    designId: "DID-TEST01",
    orderNumber: "RP-TEST",
    generationId: "99999999-8888-7777-6666-555555555555",
  };
  const implicit = await renderMasterProof({ ...common });
  const explicitProduction = await renderMasterProof({ ...common, variant: "production" });
  assert.equal(implicit.contentHash, explicitProduction.contentHash,
    "adding the variant changed the sheet an existing caller receives");
  assert.equal(implicit.contract, MASTER_PROOF_CONTRACT);
  assert.equal(implicit.proofRegions.length, 6);
});

test("the production sheet still names itself the Production Proof", () => {
  // Read from source: the title strings are outlined into paths in the output,
  // so this is the one assertion that has to be textual.
  const source = readFileSync(new URL("../runtime/master-proof-sheet.cjs", import.meta.url), "utf8");
  assert.match(source, /showProduction \? "DesignProAI™ — 2D Production Proof" : "DesignProAI™ — 2D Design Proof"/,
    "the two sheets must title themselves differently, or a reader cannot tell them apart");
});
