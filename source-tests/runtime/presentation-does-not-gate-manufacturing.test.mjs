// Phase 6 gate: a 3D presentation that will not render must never stop the
// design being manufactured.
//
// The 3D proof is derived from the same six surfaces the panels are cut from
// and contributes no pixel to any of them. A plate set that cannot be rendered
// is a gap in how the design is SHOWN. Treating it as a manufacturing failure
// would mean this system refusing to print artwork it had already rendered,
// proofed and had approved.
//
// Its own file, not a case in the cycle suite: each test here renders six real
// surfaces, and the cycle suite is already at the memory ceiling of one
// process.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const {
  DESIGN_MASTER_CONTRACT, DESIGN_SPACE_CONTRACT, SURFACE_KEYS, GLOBAL_SPACE, validateDesignMaster,
} = require("../../runtime/design-master.cjs");
const { VIEW_PLATE_CONTRACT } = require("../../runtime/vehicle-view-plate.cjs");
const {
  REVISION_REQUEST_CONTRACT, APPROVAL_CONTRACT, REVISION_OPERATIONS,
  deriveRevision, freezeApproval, assertProductionEligible, validateRevisionBundle, approvalFromRecord,
} = require("../../runtime/design-master-revision.cjs");
const {
  runOriginCycle, runRevisionCycle, approveCycle, approvedProductionSurfaces, CYCLE_CONTRACT,
} = require("../../runtime/design-revision-cycle.cjs");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const FONT = readFileSync("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");

const BLEED = 5;
const PPI = 4;
const TRIM = { driver: [20, 12], passenger: [20, 12], hood: [10, 12], roof: [10, 12], front: [14, 8], rear: [12, 10] };
const MARK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#0b3d91"/><rect width="20" height="8" fill="#fff"/></svg>');
const MARK_V2 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#0b3d91"/></svg>');
const FRAME = { widthPx: 480, heightPx: 300 };
const MANIFEST_ID = uuid("d");
const MANIFEST_HASH = sha256(Buffer.from("manifest"));
const PNG = { compressionLevel: 6, adaptiveFiltering: false, force: true };

// ------------------------------------------------------------------ fixtures

function checkField(width, height) {
  const bytes = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      const dark = ((x / 6 | 0) + (y / 6 | 0)) % 2 === 0;
      bytes[index] = dark ? 200 : 30 + ((x * 3) % 60);
      bytes[index + 1] = dark ? 30 : 90;
      bytes[index + 2] = dark ? 40 : 190;
    }
  }
  return bytes;
}

const FIELD = await sharp(checkField(240, 120), { raw: { width: 240, height: 120, channels: 3 } }).png(PNG).toBuffer();
const ASSET_BYTES = { field: FIELD, mark: MARK };

function originMaster() {
  let x = 0;
  return validateDesignMaster({
    contract: DESIGN_MASTER_CONTRACT,
    masterId: uuid("a"), revisionId: uuid("b"), vehicleId: uuid("c"),
    dimensionManifestId: MANIFEST_ID, manifestHash: MANIFEST_HASH,
    designId: "DID-PHASE5",
    revisionSequence: 0,
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
      { assetId: "field", kind: "raster", contentHash: sha256(FIELD), storagePath: "a/field.png", intrinsic: { widthPx: 240, heightPx: 120 }, minPxPerInch: 1 },
      { assetId: "mark", kind: "vector", contentHash: sha256(MARK), storagePath: "a/mark.svg" },
    ],
    palette: [{ token: "brand-blue", srgb: "#0b3d91" }, { token: "paper-white", srgb: "#f4f6f8" }],
    fonts: [{ fontId: "sans", family: "DejaVu Sans", version: "2.37", contentHash: sha256(FONT), license: "bitstream-vera", storagePath: "a/s.ttf" }],
    layers: [
      { layerId: "field", type: "raster", space: GLOBAL_SPACE, assetId: "field", extent: { widthIn: 182, heightIn: 22 },
        transform: { x: 0, y: 0, scale: 1, rotate: 0 }, zOrder: 10, opacity: 1, blend: "normal", mask: { type: "none" } },
      { layerId: "domain-type", type: "text", space: "passenger", textId: "domain", extent: { widthIn: 18, heightIn: 3 },
        transform: { x: 1, y: 1, scale: 1, rotate: 0 }, zOrder: 60, opacity: 1, blend: "normal", mask: { type: "none" } },
      { layerId: "mark", type: "logo", space: "passenger", logoIdentityKey: "precision-mark", extent: { widthIn: 6, heightIn: 6 },
        transform: { x: 2, y: 5, scale: 1, rotate: 0 }, zOrder: 70, opacity: 1, blend: "normal", mask: { type: "none" } },
    ],
    textObjects: [{ textId: "domain", string: "PrecisionClimateAZ.com", fontId: "sans", sizeIn: 1.2, colorToken: "paper-white", neverMirror: true, spellingAuthority: "revision-snapshot" }],
    logoObjects: [{ identityKey: "precision-mark", assetId: "mark", contentHash: sha256(MARK), surfaceKey: "passenger", neverMirror: true, neverRasterizeIntoBase: true }],
    masterHash: undefined,
  });
}

const MANIFEST = {
  totalSqFt: Math.round((SURFACE_KEYS.reduce((sum, key) => sum + TRIM[key][0] * TRIM[key][1], 0) / 144) * 100) / 100,
  expectedSurfaces: SURFACE_KEYS.map((key) => ({
    surfaceKey: key, widthInches: TRIM[key][0], heightInches: TRIM[key][1],
    surfaceSqFt: Math.round((TRIM[key][0] * TRIM[key][1] / 144) * 100) / 100,
  })),
};

const band = (bytes) => sharp(bytes, { raw: { width: FRAME.widthPx, height: FRAME.heightPx, channels: 1 } }).png(PNG).toBuffer();

function gradientBand(low, high) {
  const bytes = Buffer.alloc(FRAME.widthPx * FRAME.heightPx);
  for (let y = 0; y < FRAME.heightPx; y += 1) {
    for (let x = 0; x < FRAME.widthPx; x += 1) {
      bytes[y * FRAME.widthPx + x] = Math.round(low + ((high - low) * x) / (FRAME.widthPx - 1));
    }
  }
  return bytes;
}

async function plateAssets() {
  const body = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect width="300" height="160" fill="#4a5160"/></svg>`);
  const base = await sharp({ create: { width: FRAME.widthPx, height: FRAME.heightPx, channels: 3, background: "#20242b" } })
    .composite([{ input: body, left: 90, top: 60 }]).png(PNG).toBuffer();
  const maskBytes = Buffer.alloc(FRAME.widthPx * FRAME.heightPx, 0);
  for (let y = 80; y < 210; y += 1) maskBytes.fill(255, y * FRAME.widthPx + 110, y * FRAME.widthPx + 370);
  const assets = new Map([
    ["base", base],
    ["shading", await band(gradientBand(140, 255))],
    ["specular", await band(gradientBand(0, 70))],
    ["mask", await band(maskBytes)],
  ]);
  return assets;
}

function meshFor({ bow = 12 } = {}) {
  const box = { x: 105, y: 75, w: 270, h: 140 };
  const rows = 2, cols = 4, points = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      const u = col / cols, v = row / rows;
      points.push({ u, v, x: box.x + u * box.w, y: box.y + v * box.h + bow * (2 * v - 1) * Math.sin(u * Math.PI) });
    }
  }
  return { rows, cols, points };
}

function plateSet(assets, options) {
  const image = (id) => ({ assetId: id, contentHash: sha256(assets.get(id)) });
  return {
    contract: VIEW_PLATE_CONTRACT,
    plateSetId: uuid("e"), vehicleId: uuid("c"),
    dimensionManifestId: MANIFEST_ID, manifestHash: MANIFEST_HASH,
    widthPx: FRAME.widthPx, heightPx: FRAME.heightPx,
    views: SURFACE_KEYS.map((surfaceKey) => ({
      viewKey: surfaceKey, label: surfaceKey.toUpperCase(),
      handedness: surfaceKey === "driver" ? "left" : surfaceKey === "passenger" ? "right" : "none",
      base: image("base"), shading: image("shading"), specular: image("specular"),
      panels: [{ surfaceKey, mask: image("mask"), mesh: meshFor(options) }],
    })),
  };
}

const PLATE_ASSETS = await plateAssets();

function inputs(over = {}) {
  const assets = over.assets || ASSET_BYTES;
  return {
    manifest: MANIFEST,
    plates: over.plates || plateSet(PLATE_ASSETS),
    loadAsset: async (ref) => {
      const assetId = typeof ref === "string" ? ref : ref.assetId;
      return assets[assetId] || PLATE_ASSETS.get(assetId);
    },
    loadFont: async () => FONT,
    proofFonts: { regular: FONT },
    pxPerInch: over.pxPerInch || PPI,
    bleedInches: BLEED,
    vehicle: { year: 2022, make: "Ford", model: "F250 Crew Cab" },
    designName: "Precision Climate Solutions",
    finish: "gloss",
    orderNumber: "PHASE5-1",
    ...(over.only || {}),
  };
}

const request = (operations, over = {}) => ({
  contract: REVISION_REQUEST_CONTRACT,
  requestId: uuid("7"), revisionId: uuid("8"),
  reason: "customer revision",
  operations,
  ...over,
});

// ------------------------------------------------------------------- the gate

test("a 3D presentation that will not render never stops the design being manufactured", async () => {
  // The plate assets are unreachable, so the 3D proof cannot be built. Nothing
  // about the SURFACES or the 2D proof depends on them: they are the same six
  // rasters either way, and they are what gets printed.
  const reachable = inputs();
  const cycle = await runOriginCycle({
    master: originMaster(),
    ...reachable,
    loadAsset: async (ref) => {
      const assetId = typeof ref === "string" ? ref : ref.assetId;
      // The plate layers only the 3D proof reads. The master's own assets
      // ("field", "mark") stay reachable, so the six surfaces and the 2D proof
      // render exactly as they always would.
      if (PLATE_ASSETS.has(assetId)) throw new Error("plate storage unavailable");
      return reachable.loadAsset(ref);
    },
  });

  assert.equal(cycle.proof3d, null);
  assert.equal(cycle.presentation3d, false);
  assert.ok(cycle.presentationFailure, "the cycle must record why there is no 3D proof");
  assert.match(cycle.presentationFailure.message, /plate storage unavailable/);

  // Everything manufacturing consumes is present and complete.
  assert.equal(cycle.render.surfaces.length, SURFACE_KEYS.length);
  assert.ok(cycle.proof2d.contentHash);
  assert.equal(cycle.proof2d.totalSqFt > 0, true);
  assert.equal(cycle.identity.presentation3d, false);

  // And it is approvable and printable, which is the whole point.
  const approval = approveCycle({
    cycle, approvedBy: uuid("9"), approvalRef: "presentation-gap", approvedAt: "2026-08-13T12:00:00.000Z",
  });
  const production = approvedProductionSurfaces({ approval, cycle });
  assert.equal(production.surfaces.length, SURFACE_KEYS.length);
  assert.deepEqual(production.surfaces.map((surface) => surface.surfaceKey).sort(), [...SURFACE_KEYS].sort());

  // The identity still binds what was shown: the approval records that there
  // was no 3D proof, so it can never be satisfied by a bundle that has one.
  assert.equal(approval.proof3dHash, null);
  assert.equal(approval.plateSetHash, null);
  assert.equal(approval.bundleIdentity, cycle.identity.bundleIdentity);
});
