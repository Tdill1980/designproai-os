import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";

const require = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = require("sharp");
const proof = require("../runtime/atlas-panel-proof-topology.cjs");
const atlas = require("../runtime/flat-first-atlas.cjs");
const sha = (b) => createHash("sha256").update(b).digest("hex");

const atlasSrc = fs.readFileSync(
  new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");

const SURFACES = [["driver", 153, 56], ["passenger", 153, 56], ["hood", 71.5, 56],
  ["roof", 74.3, 54.8], ["front", 129, 34], ["rear", 76, 54]]
  .map(([surfaceKey, widthInches, heightInches]) => ({
    surfaceKey, widthInches, heightInches, bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  }));
const MANIFEST = atlas.buildAtlasManifest(SURFACES, undefined, "truck");

/** The six Call-1 panels, as `cutCallOnePanels` hands them over. */
async function callOnePanels() {
  const tint = ["#14345a", "#2a5a34", "#7a3a1a", "#3a2a5a", "#5a1a2a", "#1a5a5a"];
  return Promise.all(MANIFEST.zones.map(async (zone, i) => {
    const bytes = await sharp({ create: { width: 600, height: 300, channels: 4, background: tint[i] } })
      .png().toBuffer();
    return {
      surfaceKey: zone.surfaceKey, bytes, contentHash: sha(bytes), byteSize: bytes.length,
      contentType: "image/png", sourceMasterHash: "a".repeat(64),
      trimWidthIn: SURFACES[i].widthInches, trimHeightIn: SURFACES[i].heightInches,
    };
  }));
}

async function derive(overrides = {}) {
  const master = await sharp({ create: { width: 4096, height: 4096, channels: 4, background: "#14345a" } })
    .png().toBuffer();
  const stored = [];
  return {
    stored,
    result: await proof.assemblePanelProofMaster({
      sheet: { bytes: master, storagePath: "atlas/master.png", contentHash: sha(master), byteSize: master.length },
      zone2Panels: await callOnePanels(),
      documentOnly: true,
      panelRows: proof.panelRowsFromManifest(MANIFEST),
      input: {
        companyName: "Botanical Gardens Landscape Design", phone: "555-0199",
        website: "botanicalgardens.com", brief: "Create a wrap for a landscape design company",
        vehicle: { year: "2022", make: "Ford", model: "F250" },
      },
      manifest: MANIFEST, logger: () => {},
      store: { putImmutableBytes: async (o) => { stored.push(o.storagePath); return { storagePath: o.storagePath, contentHash: sha(o.bytes) }; } },
      downloadAsset: async () => { throw new Error("no customer assets in this fixture"); },
      ...overrides,
    }),
  };
}

test("the three-zone production proof is built from the accepted master's own panels, with no image call", async () => {
  const { result, stored } = await derive();

  // ZERO MODEL CALLS. Only Zone 2 ever came out of a sheet, and the brain now
  // authors those six clean backgrounds as the accepted master.
  assert.equal(result.imageRequestCount, 0);
  assert.equal(result.documentOnly, true);

  // ALL THREE ZONES ARE REAL, which is what "maintain the production panel
  // proof" means: six clean backgrounds, six branded composites, cut graphics.
  assert.equal(result.provenance.quadrants.clean.length, 6);
  assert.equal(result.provenance.surfaces.length, 6);
  assert.deepEqual(
    result.provenance.quadrants.cutGraphics.map((g) => g.surfaceKey).sort(),
    ["contact", "typography"],
  );
  assert.ok(result.provenance.quadrants.clean.every((p) => p.persisted && p.contentHash));

  // ⛔ THE ROLE NAME IS THE CONTRACT WITH THE GATEWAY, and it is read from the
  // gateway's own source here rather than retyped.
  //
  // This assertion did not exist, and that is the whole reason the owner never
  // saw a production panel proof. The derived Zone-2 panels carried
  // `role: "clean-panel"`; `PANEL_PROOF_ROLES` in gateway/src/server.mjs
  // accepts only branded | clean | cut-graphic, so
  // `validatedPanelProofQuadrantPanel` threw
  // `atlas_panel_proof_response_invalid` (502) and `AtlasPanelProofSheet`
  // rendered `null`. Three correctly-wired surfaces showed a silent blank for
  // a week. The assertions above passed the whole time, because they checked
  // length, `persisted` and `contentHash` and never the one field that mattered.
  const gatewaySource = fs.readFileSync(
    new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
  const declared = gatewaySource.match(/const PANEL_PROOF_ROLES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(declared, "the gateway must still declare PANEL_PROOF_ROLES as a literal set");
  const accepted = new Set(declared[1].match(/"([^"]+)"/g).map((s) => s.replaceAll('"', "")));
  assert.ok(accepted.has("clean") && accepted.has("cut-graphic"),
    "the gateway's accepted roles must still be the ones this proof emits");
  for (const panel of result.provenance.quadrants.clean) {
    assert.equal(panel.role, "clean", `Zone 2 role must be canonical, got ${panel.role}`);
    assert.ok(accepted.has(panel.role), `the gateway would 502 on role ${panel.role}`);
  }
  for (const element of result.provenance.quadrants.cutGraphics) {
    assert.ok(accepted.has(element.role), `the gateway would 502 on role ${element.role}`);
  }

  // The document itself exists, is stored, and is a real raster.
  assert.match(result.provenance.proofStoragePath, /^atlas-panel-proof\/[0-9a-f]{64}\.png$/);
  assert.match(result.provenance.proofSha256, /^[0-9a-f]{64}$/);
  assert.ok(result.provenance.proofByteSize > 10_000);
  assert.ok(stored.includes(result.provenance.proofStoragePath));

  // Its artwork authority is the accepted master, carried as an IDENTITY and
  // never as bytes (RULE 0.39).
  assert.equal(result.provenance.sourceArtwork.storagePath, "atlas/master.png");
  assert.match(result.provenance.sourceArtwork.contentHash, /^[0-9a-f]{64}$/);
});

test("the derived receipt carries the four fields the logo-placement handoff requires", async () => {
  // `designpro_private.panel_proof_logo_inventory` (migration 20260920022906)
  // requires `threeZoneLayout`, `composition.contract`,
  // `composition.sourceAssetsPreserved` and `masterSha256`. The derived receipt
  // omitted all four, so every REVISION of a logo design failed its handoff
  // with `generation_logo_placement_manifest_required` -- live, 2026-09-22.
  // They mirror the authored receipt field for field.
  const { result } = await derive();
  const p = result.provenance;
  assert.deepEqual(Object.keys(p.threeZoneLayout).sort(),
    ["backgrounds", "branded", "brandedSource", "dieCut", "graphics", "graphicsFormat",
      "panelRefine", "productionApproved", "required"]);
  // `dieCut` is the outer-die-cut gate's measurements, and it is NULL here on
  // purpose: the derived path composites Zone 1 from the clean panels, which
  // carry a hardcoded `fit: 1`, so a branded-against-clean comparison would
  // convict every legacy revision. The key is present either way so a reader
  // can tell "measured and clean" from "not applicable to this path".
  assert.equal(p.threeZoneLayout.dieCut, null);
  // `panelRefine` is null here for the same reason and one more: the resolution
  // pass re-authors the SHEET'S OWN Zone 1 cells, and this path has no sheet.
  // Null is "not applicable", and it is also what every run reads with
  // DESIGNPRO_ATLAS_PANEL_REFINE unset -- which is the default.
  assert.equal(p.threeZoneLayout.panelRefine, null);
  // THE DERIVED PATH IS THE ONE THAT STILL COMPOSITES, AND IT SAYS SO. A legacy
  // six-surface or field revision has no authored three-zone sheet to publish,
  // so code builds its Zone 1 from the clean panels plus a typeset lockup.
  // A reader must be able to tell that from the designer's own band without
  // opening pixels.
  assert.equal(p.threeZoneLayout.brandedSource, "composited");
  assert.equal(p.threeZoneLayout.required, true);
  assert.equal(p.threeZoneLayout.branded, 6);
  assert.equal(p.threeZoneLayout.backgrounds, 6);
  assert.equal(p.threeZoneLayout.graphics, 2);
  assert.equal(p.threeZoneLayout.graphicsFormat, "vector-originals");
  assert.equal(p.composition.contract, "designpro.production-zone-composite.v1");
  assert.equal(p.composition.sourceAssetsPreserved, true);
  assert.ok(Array.isArray(p.composition.panels) && p.composition.panels.length === 6);
  assert.ok(Array.isArray(p.composition.omitted));
  // `masterSha256` names the accepted master the document was derived FROM.
  assert.equal(p.masterSha256, p.sourceArtwork.contentHash);
  assert.match(p.masterSha256, /^[0-9a-f]{64}$/);
});

test("the derived proof can never be mistaken for a master", async () => {
  const { result } = await derive();
  // `bytes` and `contentHash` are how a caller names a master. This path has no
  // master to name -- the accepted one already exists and is already the
  // authority -- and a receipt carrying them is the two-master ambiguity the
  // 2026-08-31 ruling retired and the v28 composite shipped again.
  // (`provenance.masterSha256` names the accepted master it was derived from;
  // it is not a top-level `contentHash`, and the topology still says derived.)
  assert.equal(result.bytes, undefined);
  assert.equal(result.contentHash, undefined);
  assert.equal(result.provenance.topology, "derived-from-accepted-master");

  // And the runtime never hands it to `assembleFinishedMaster`.
  const call = atlasSrc.slice(
    atlasSrc.indexOf("panelProofDocument = await assemblePanelProofMaster({"),
    atlasSrc.indexOf("timings.panelProofDocumentMs = Date.now() - proofAt;"),
  );
  assert.ok(call.includes("documentOnly: true"));
  assert.ok(!call.includes("assembleFinishedMaster"));
});

test("a proof the document stage cannot build never costs the accepted design", async () => {
  // RULE 0.15's blast radius, and the 2026-09-09 finishing lesson: the master is
  // accepted, the panels are cut, the proofs are rendering. An optional document
  // must not be able to destroy any of that.
  await assert.rejects(
    () => proof.assemblePanelProofMaster({
      sheet: { bytes: Buffer.from("x"), storagePath: "atlas/master.png", contentHash: "b".repeat(64), byteSize: 1 },
      zone2Panels: [], documentOnly: true, panelRows: proof.panelRowsFromManifest(MANIFEST),
      input: {}, manifest: MANIFEST, store: { putImmutableBytes: async () => ({}) }, logger: () => {},
    }),
    (error) => error instanceof proof.PanelProofRefusal,
  );

  // The runtime catches it and logs, rather than throwing into an accepted run.
  const guard = atlasSrc.slice(
    atlasSrc.indexOf("let panelProofDocument = null;"),
    atlasSrc.indexOf("// Every content-addressed path the write batch below needs"),
  );
  assert.match(guard, /try \{/);
  // The CATCH is what decides the blast radius. (The try body legitimately
  // throws inside `downloadAsset`, which is why this reads the handler and not
  // the whole block.)
  const handler = guard.slice(guard.lastIndexOf("} catch (cause) {"));
  assert.match(handler, /flat_atlas_panel_proof_document_failed/);
  assert.ok(!/\bthrow\b/.test(handler), "a failed document is recorded, never rethrown");
});

test("the derived receipt is the same shape every existing reader already parses", async () => {
  const { result } = await derive();
  // `readStoredRevision` reconstructs `proofSheet` from exactly these keys, so
  // the resume path, the claimant and the UI need no change at all.
  for (const key of ["proofStoragePath", "proofSha256", "proofByteSize", "proofContentType", "proofContract"]) {
    assert.ok(result.provenance[key], `${key} is missing from the derived receipt`);
  }
  assert.match(atlasSrc, /panelProofAuthoring: generated\?\.panelProof\s*\n?\s*\|\| panelProofDocument\?\.provenance \|\| null/);
});

test("Zone 2 never claims a clean base the design does not have", async () => {
  const container = require("../runtime/atlas-proof-container-template.cjs");
  const rows = proof.panelRowsFromManifest(MANIFEST);
  const manifest = container.parsePanelRows(rows);

  // With the clean-base element graph ON the wording is what it has always
  // been, byte for byte.
  const clean = await container.renderContainerTemplate({ manifest, dimensionManifest: MANIFEST,
    companyName: "Bright Smiles Dental", vehicle: "2012 Toyota Prius", bleedInches: 5, cleanBase: true });
  const unchanged = await container.renderContainerTemplate({ manifest, dimensionManifest: MANIFEST,
    companyName: "Bright Smiles Dental", vehicle: "2012 Toyota Prius", bleedInches: 5 });
  assert.equal(sha(clean), sha(unchanged), "a clean base renders the template it always did");

  // With it OFF the brain draws lettering and logo into the artwork, so those
  // panels carry type. A proof printing "NO TEXT OR LOGO" over them is a
  // document asserting something false to the customer.
  const authored = await container.renderContainerTemplate({ manifest, dimensionManifest: MANIFEST,
    companyName: "Bright Smiles Dental", vehicle: "2012 Toyota Prius", bleedInches: 5, cleanBase: false });
  assert.notEqual(sha(authored), sha(clean));

  // Read it off the SVG rather than the raster, so the claim itself is pinned.
  const svgOf = (cleanBase) => container.containerSvg
    ? container.containerSvg({ manifest, dimensionManifest: MANIFEST, cleanBase })
    : null;
  if (svgOf(true)) {
    assert.match(svgOf(true), /ZONE 2 — BACKGROUNDS ONLY \(NO TEXT OR LOGO\)/);
    assert.ok(!svgOf(false).includes("BACKGROUNDS ONLY (NO TEXT OR LOGO)"),
      "without a clean base the bar must not claim one");
    assert.match(svgOf(false), /ZONE 2 — PRINT PANELS AS AUTHORED/);
    // Zones 1 and 3 are untouched either way.
    for (const zone of [/ZONE 1 — FULL DESIGN PANELS/, /ZONE 3 — CUT GRAPHICS/]) {
      assert.match(svgOf(true), zone);
      assert.match(svgOf(false), zone);
    }
  }

  // And the runtime derives the flag from the live switch rather than assuming.
  assert.match(atlasSrc, /cleanBaseZone2: cleanBaseEnabled\(\)/);
});
