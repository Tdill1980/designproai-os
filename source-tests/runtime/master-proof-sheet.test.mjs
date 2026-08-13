// Phase 3 gate: the customer proof is derived from manufacturing truth.
//
// The reversal is the whole point. The retired path showed the customer AI
// renders and then tried to reconstruct production artwork out of them, so the
// customer approved one thing and the shop printed another. Here the proof is
// built from the six surfaces the deterministic renderer already produced, so
// approving the proof is approving the artwork that prints.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const { DESIGN_MASTER_CONTRACT, DESIGN_SPACE_CONTRACT, SURFACE_KEYS, GLOBAL_SPACE, validateDesignMaster } = require("../../runtime/design-master.cjs");
const { renderProductionSurfaces } = require("../../runtime/design-master-renderer.cjs");
const { renderMasterProof, MASTER_PROOF_CONTRACT, SURFACE_ORDER } = require("../../runtime/master-proof-sheet.cjs");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const FONT = readFileSync("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");

const BLEED = 5;
const PPI = 4;
const TRIM = { driver: [20, 12], passenger: [20, 12], hood: [10, 12], roof: [10, 12], front: [14, 8], rear: [12, 10] };
const MARK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#0b3d91"/><rect width="20" height="8" fill="#fff"/></svg>');

async function build(mutate = (m) => m) {
  const field = await sharp({ create: { width: 240, height: 120, channels: 3, background: "#c81e1e" } })
    .composite([{ input: await sharp({ create: { width: 120, height: 120, channels: 3, background: "#1e46c8" } }).png().toBuffer(), left: 120, top: 0 }])
    .png({ compressionLevel: 6, adaptiveFiltering: false, force: true }).toBuffer();
  const bytesFor = { field, mark: MARK };
  let x = 0;
  const draft = {
    contract: DESIGN_MASTER_CONTRACT,
    masterId: uuid("a"), revisionId: uuid("b"), vehicleId: uuid("c"),
    dimensionManifestId: uuid("d"), manifestHash: sha256(Buffer.from("manifest")),
    designId: "DID-PHASE3",
    designSpace: {
      contract: DESIGN_SPACE_CONTRACT, designSpaceId: uuid("f"), unitsPerInch: 1,
      surfaces: SURFACE_KEYS.map((surfaceKey, index) => {
        const surface = {
          surfaceKey, originIn: [x, 0], widthIn: TRIM[surfaceKey][0], heightIn: TRIM[surfaceKey][1],
          mirror: surfaceKey === "passenger",
          mapping: { kind: "planar-developable", mappingId: uuid(String(index + 1)), mappingHash: sha256(Buffer.from(surfaceKey)) },
          seams: [],
        };
        x += TRIM[surfaceKey][0] + BLEED * 2 + 2;
        return surface;
      }),
    },
    assets: [
      { assetId: "field", kind: "raster", contentHash: sha256(field), storagePath: "a/field.png", intrinsic: { widthPx: 240, heightPx: 120 }, minPxPerInch: 1 },
      { assetId: "mark", kind: "vector", contentHash: sha256(MARK), storagePath: "a/mark.svg" },
    ],
    palette: [{ token: "brand-blue", srgb: "#0b3d91" }, { token: "paper-white", srgb: "#f4f6f8" }],
    fonts: [{ fontId: "sans", family: "DejaVu Sans", version: "2.37", contentHash: sha256(FONT), license: "bitstream-vera", storagePath: "a/s.ttf" }],
    layers: [
      { layerId: "field", type: "raster", space: GLOBAL_SPACE, assetId: "field", extent: { widthIn: 182, heightIn: 22 },
        transform: { x: 0, y: 0, scale: 1, rotate: 0 }, zOrder: 10, opacity: 1, blend: "normal", mask: { type: "none" } },
      // Type on the mirrored flank: the surface mirrors, the words do not.
      { layerId: "domain-type", type: "text", space: "passenger", textId: "domain", extent: { widthIn: 24, heightIn: 3 },
        transform: { x: 1, y: 1, scale: 1, rotate: 0 }, zOrder: 60, opacity: 1, blend: "normal", mask: { type: "none" } },
      { layerId: "mark", type: "logo", space: "passenger", logoIdentityKey: "precision-mark", extent: { widthIn: 6, heightIn: 6 },
        transform: { x: 2, y: 5, scale: 1, rotate: 0 }, zOrder: 70, opacity: 1, blend: "normal", mask: { type: "none" } },
    ],
    textObjects: [{ textId: "domain", string: "PrecisionClimateAZ.com", fontId: "sans", sizeIn: 1.5, colorToken: "paper-white", neverMirror: true, spellingAuthority: "revision-snapshot" }],
    logoObjects: [{ identityKey: "precision-mark", assetId: "mark", contentHash: sha256(MARK), surfaceKey: "passenger", neverMirror: true, neverRasterizeIntoBase: true }],
  };
  const master = validateDesignMaster({ ...mutate(draft), masterHash: undefined });
  const render = await renderProductionSurfaces({
    master, loadAsset: async (a) => bytesFor[a.assetId], loadFont: async () => FONT, pxPerInch: PPI, bleedInches: BLEED,
  });
  const manifest = {
    totalSqFt: 0,
    expectedSurfaces: SURFACE_ORDER.map((key) => ({
      surfaceKey: key, widthInches: TRIM[key][0], heightInches: TRIM[key][1],
      surfaceSqFt: Math.round((TRIM[key][0] * TRIM[key][1] / 144) * 100) / 100,
    })),
  };
  return { master, render, manifest };
}

const proofFor = async (built) => renderMasterProof({
  render: built.render, manifest: built.manifest, bleedInches: BLEED,
  vehicle: { year: 2022, make: "Ford", model: "F250 Crew Cab" },
  designName: "Precision Climate Solutions", finish: "gloss", designId: "DID-PHASE3", orderNumber: "CANARY-1",
});

// ------------------------------------------------------------ 1, 2 and 6

test("GATE: the proof is built only from the six rendered surfaces, with no generation", async () => {
  const built = await build();
  const proof = await proofFor(built);

  assert.equal(proof.contract, MASTER_PROOF_CONTRACT);
  assert.equal(proof.generated, false);
  assert.deepEqual(proof.surfaceHashes.map((s) => s.surfaceKey), SURFACE_ORDER);
  for (const entry of proof.surfaceHashes) {
    const surface = built.render.surfaces.find((s) => s.surfaceKey === entry.surfaceKey);
    assert.equal(entry.contentHash, surface.contentHash, `${entry.surfaceKey} on the proof is not the manufactured surface`);
  }
  assert.equal(proof.renderHash, built.render.renderHash);
  assert.equal(proof.masterHash, built.render.masterHash);

  // No provider, no prompt, no model. Asserted against the source so the
  // property cannot quietly regress.
  const source = readFileSync(new URL("../../runtime/master-proof-sheet.cjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of ["generativelanguage", "gemini", "generateContent", "apiKey", "prompt", "generation-provider", "generation-engine"]) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, `the proof builder must not reference ${forbidden}`);
  }
});

test("GATE: rebuilding the same proof from the same master is byte-identical", async () => {
  const first = await proofFor(await build());
  const second = await proofFor(await build());
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.byteSize, second.byteSize);
});

// ------------------------------------------------------------------- 7

test("GATE: changing the master changes both surface identity and proof identity", async () => {
  const base = await build();
  const baseProof = await proofFor(base);

  const moved = await build((draft) => {
    draft.layers.find((layer) => layer.layerId === "mark").transform.x = 3;
    return draft;
  });
  const movedProof = await proofFor(moved);

  assert.notEqual(moved.render.masterHash, base.render.masterHash, "the master must change");
  assert.notEqual(moved.render.renderHash, base.render.renderHash, "production surfaces must change");
  assert.notEqual(movedProof.contentHash, baseProof.contentHash, "and the customer proof must change with them");

  // A string edit propagates the same way — one canonical change, both artefacts.
  const respelled = await build((draft) => {
    draft.textObjects[0].string = "PrecisionClimateAZ.net";
    return draft;
  });
  const respelledProof = await proofFor(respelled);
  assert.notEqual(respelled.render.renderHash, base.render.renderHash);
  assert.notEqual(respelledProof.contentHash, baseProof.contentHash);
});

// ------------------------------------------------------------------- 3

test("the identities on the proof are the identities the surfaces carry", async () => {
  const built = await build();
  const proof = await proofFor(built);

  assert.deepEqual(proof.textIdentities, [{ textId: "domain", string: "PrecisionClimateAZ.com" }]);
  assert.equal(proof.logoIdentities.length, 1);
  assert.equal(proof.logoIdentities[0].identityKey, "precision-mark");
  assert.equal(proof.logoIdentities[0].contentHash, sha256(MARK));

  // Sourced from the surfaces, not the master, so the proof cannot advertise a
  // string the manufactured artwork does not actually contain.
  const passenger = built.render.surfaces.find((s) => s.surfaceKey === "passenger");
  assert.deepEqual(passenger.textIdentities, [{ textId: "domain", string: "PrecisionClimateAZ.com" }]);
});

// ------------------------------------------------------------------- 4

test("a mirrored surface shows its protected text and logo forward", async () => {
  const built = await build();
  const passenger = built.render.surfaces.find((s) => s.surfaceKey === "passenger");
  assert.equal(passenger.mirror, true);

  // The same master with the type placed as ordinary artwork would mirror it.
  // Protected objects must not, so the two surfaces cannot be the same bytes.
  const unprotected = await build((draft) => {
    draft.layers = draft.layers.filter((layer) => layer.layerId !== "mark");
    draft.logoObjects = [];
    draft.layers.push({ layerId: "art", type: "vector", space: "passenger", assetId: "mark", extent: { widthIn: 6, heightIn: 6 },
      transform: { x: 2, y: 5, scale: 1, rotate: 0 }, zOrder: 70, opacity: 1, blend: "normal", mask: { type: "none" } });
    return draft;
  });
  const asArtwork = unprotected.render.surfaces.find((s) => s.surfaceKey === "passenger");
  assert.notEqual(asArtwork.contentHash, passenger.contentHash,
    "a protected logo and the same asset as artwork must differ on a mirrored flank");
});

// ------------------------------------------------------------------- 5

test("every dimension on the proof comes from the bound manifest, never from pixels", async () => {
  const built = await build();
  const proof = await proofFor(built);

  for (const dimension of proof.perSurfaceDimensions) {
    const [w, h] = TRIM[dimension.surfaceKey];
    assert.equal(dimension.widthInches, w);
    assert.equal(dimension.heightInches, h);
    assert.equal(dimension.printWidthInches, w + BLEED * 2);
    assert.equal(dimension.printHeightInches, h + BLEED * 2);
    assert.equal(dimension.surfaceSqFt, Math.round((w * h / 144) * 100) / 100);
  }
  assert.equal(proof.bleedInches, BLEED);
  assert.equal(proof.dimensionsAuthority, "genie-universal-panelizer");
  const expectedTotal = Math.round(SURFACE_ORDER.reduce((sum, key) => sum + Math.round((TRIM[key][0] * TRIM[key][1] / 144) * 100) / 100, 0) * 100) / 100;
  assert.equal(proof.totalSqFt, expectedTotal);
});

test("a surface that disagrees with the manifest it was built from fails closed", async () => {
  const built = await build();
  const drifted = clone(built.manifest);
  drifted.expectedSurfaces.find((s) => s.surfaceKey === "hood").widthInches = 11;
  await assert.rejects(
    renderMasterProof({ render: built.render, manifest: drifted, bleedInches: BLEED }),
    (error) => error.code === "proof_surface_manifest_drift");

  await assert.rejects(
    renderMasterProof({ render: built.render, manifest: { expectedSurfaces: [] }, bleedInches: BLEED }),
    (error) => error.code === "proof_manifest_incomplete");

  await assert.rejects(
    renderMasterProof({ render: { contract: "something-else" }, manifest: built.manifest }),
    (error) => error.code === "proof_render_invalid");
});

// -------------------------------------------------------- artifact shape

test("the artifact keeps the shape the claimant already records", async () => {
  const proof = await proofFor(await build());
  for (const field of ["contract", "contentHash", "byteSize", "width", "height", "totalSqFt", "bleedInches", "dimensionsAuthority"]) {
    assert.ok(proof[field] !== undefined, `the customer proof artifact must still carry ${field}`);
  }
  const meta = await sharp(proof.bytes).metadata();
  assert.equal(meta.width, proof.width);
  assert.equal(meta.height, proof.height);
  assert.equal(meta.format, "png");
});

test("a canonical string too long for its declared extent fails closed", async () => {
  // Discovered by this gate: an overflowing string was cropped to fit, so two
  // different canonical strings rendered byte-identically and the customer
  // would have approved a panel showing only part of their own URL.
  await assert.rejects(
    build((draft) => { draft.textObjects[0].string = "PrecisionClimateAZ.com/commercial-hvac-service"; return draft; }),
    (error) => error.code === "render_text_overflows_extent");
});
