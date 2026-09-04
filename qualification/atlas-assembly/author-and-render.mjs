/**
 * PHASE 1, STEPS 1-2 — author a validated Design Master, then render the six
 * GENIE-sized surfaces from it. Deterministic throughout: no provider call.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  GENIE_TRIM, BLEED_INCHES, VEHICLE, CUSTOMER_STRINGS,
  genieManifest, surfaceMappings, materializeAssets, sha256, uuidFrom,
} from "./fixture.mjs";

const require = createRequire(import.meta.url);
const R = "../../runtime/";
const author = require(`${R}design-master-author.cjs`);
const renderer = require(`${R}design-master-renderer.cjs`);

/** Design space is the horizontal strip the author lays the six surfaces into. */
export function designSpaceSize() {
  const GUTTER_IN = 2;
  let widthIn = 0, heightIn = 0;
  for (const key of ["driver", "passenger", "hood", "roof", "front", "rear"]) {
    const d = GENIE_TRIM[key];
    widthIn += d.widthInches + BLEED_INCHES * 2 + GUTTER_IN;
    heightIn = Math.max(heightIn, d.heightInches + BLEED_INCHES * 2);
  }
  return { widthIn, heightIn };
}

export async function buildMasterAndSurfaces({ pxPerInch }) {
  const { manifest, manifestHash } = genieManifest();
  const space = designSpaceSize();
  const assets = await materializeAssets({
    designSpaceWidthIn: space.widthIn, designSpaceHeightIn: space.heightIn, pxPerInch,
  });

  // The logo inventory is approved-file identity. The author places it; the
  // renderer verifies the bytes hash to exactly this.
  const expectedLogoInventory = ["driver", "passenger", "hood", "rear"].map((surfaceKey) => ({
    identityKey: "primary-mark",
    surfaceKey,
    kind: "raster",
    contentHash: assets.logo.contentHash,
    storagePath: assets.logo.path,
    intrinsic: { widthPx: assets.logo.widthPx, heightPx: assets.logo.heightPx },
  }));

  // Canonical strings. Spelling authority is the frozen snapshot.
  const textSpec = (textId, string, surfaceKey, sizeIn, widthIn, xFrac, yFrac) => {
    const d = GENIE_TRIM[surfaceKey];
    return {
      textId, string, surfaceKey, sizeIn, fontId: "brand", colorToken: "ink",
      extent: { widthIn, heightIn: sizeIn * 1.35 },
      transform: { x: BLEED_INCHES + d.widthInches * xFrac, y: BLEED_INCHES + d.heightInches * yFrac, rotate: 0 },
    };
  };
  const bodyText = [
    textSpec("company", CUSTOMER_STRINGS.company, "driver",    10, 145, 0.04, 0.36),
    textSpec("company", CUSTOMER_STRINGS.company, "passenger", 10, 145, 0.04, 0.36),
    textSpec("phone",   CUSTOMER_STRINGS.phone,   "driver",     7,  60, 0.04, 0.62),
    textSpec("phone",   CUSTOMER_STRINGS.phone,   "passenger",  7,  60, 0.04, 0.62),
    textSpec("domain",  CUSTOMER_STRINGS.domain,  "rear",       5,  78, 0.03, 0.72),
  ];

  const revisionSnapshot = {
    contractVersion: "designpro.revision-snapshot.v1",
    designId: "design-precision-climate-f250",
    bodyText,
    expectedLogoInventory,
  };

  const identity = {
    masterId: uuidFrom("master:precision-climate-f250:r0"),
    revisionId: uuidFrom("revision:precision-climate-f250:0"),
    revisionSequence: 0,
    vehicleId: uuidFrom(`vehicle:${VEHICLE.vehicleId}`),
    dimensionManifestId: uuidFrom("genie-manifest:f250-crewcab-2022"),
    manifestHash,
    designSpaceId: uuidFrom("design-space:precision-climate-f250"),
    surfaceMappings: surfaceMappings(),
  };

  // The brief carries DIRECTION ONLY. It must not contain the canonical
  // strings or the logo hash — the author asserts exactly that.
  const creativeBrief = {
    contract: author.CREATIVE_BRIEF_CONTRACT,
    prose: "Cool deep-blue field with a layered diagonal energy motif; clean legibility band along the flanks; modern HVAC trade register.",
  };

  const creativeAssets = [
    {
      assetId: "field-background", kind: "raster", role: "background",
      contentHash: assets.background.contentHash, storagePath: assets.background.path,
      generatedBy: "qualification-seeded-procedural.v1",
      intrinsic: { widthPx: assets.background.widthPx, heightPx: assets.background.heightPx },
      minPxPerInch: 1,
    },
    {
      assetId: "arc-motif", kind: "raster", role: "decorative",
      contentHash: assets.motif.contentHash, storagePath: assets.motif.path,
      generatedBy: "qualification-seeded-procedural.v1",
      intrinsic: { widthPx: assets.motif.widthPx, heightPx: assets.motif.heightPx },
      minPxPerInch: 1,
    },
  ];

  // The background covers the WHOLE design space, so every surface window —
  // including its 5" bleed — lands on authored pixels.
  const layers = [
    { layerId: "bg-field", assetId: "field-background", type: "raster", space: "global", zOrder: 10, opacity: 1, blend: "normal",
      extent: { widthIn: space.widthIn, heightIn: space.heightIn }, transform: { x: 0, y: 0, scale: 1, rotate: 0 } },
  ];
  for (const surfaceKey of ["driver", "passenger", "hood", "roof", "front", "rear"]) {
    const d = GENIE_TRIM[surfaceKey];
    const w = Math.min(d.heightInches * 0.9, d.widthInches * 0.5);
    layers.push({
      layerId: `motif-${surfaceKey}`, assetId: "arc-motif", type: "raster", space: surfaceKey, zOrder: 20, opacity: 0.85, blend: "screen",
      extent: { widthIn: w, heightIn: w },
      transform: { x: (d.widthInches + BLEED_INCHES * 2) * 0.62, y: (d.heightInches + BLEED_INCHES * 2) * 0.1, scale: 1, rotate: 0 },
    });
  }

  const logoPlacements = {};
  for (const surfaceKey of ["driver", "passenger", "hood", "rear"]) {
    const d = GENIE_TRIM[surfaceKey];
    const wIn = Math.min(36, d.widthInches * 0.28);
    logoPlacements[`primary-mark:${surfaceKey}`] = {
      widthIn: wIn, heightIn: wIn / 3,
      x: BLEED_INCHES + d.widthInches * 0.05,
      y: BLEED_INCHES + d.heightInches * 0.08,
    };
  }

  const authored = author.authorDesignMaster({
    identity, revisionSnapshot, manifest,
    creativeBrief, creativeAssets,
    composition: { layers },
    typography: { fontId: "brand", colorToken: "ink" },
    logoPlacements,
    palette: [
      { token: "ink", srgb: "#ffffff" },
      { token: "field", srgb: "#0b2f6b" },
    ],
    fonts: [
      {
        fontId: "brand", family: "Liberation Sans", version: "2.1.5",
        license: "SIL Open Font License 1.1", weight: 700,
        storagePath: assets.font.path, contentHash: assets.font.contentHash,
      },
    ],
  });

  const byPath = new Map([
    [assets.background.path, assets.background.contentHash],
    [assets.motif.path, assets.motif.contentHash],
    [assets.logo.path, assets.logo.contentHash],
  ]);

  const rendered = await renderer.renderProductionSurfaces({
    master: authored.master,
    pxPerInch,
    bleedInches: BLEED_INCHES,
    loadAsset: async (asset) => {
      const path = asset.storagePath;
      if (!byPath.has(path)) throw new Error(`fixture has no asset at ${path}`);
      return readFileSync(path);
    },
    loadFont: async (font) => readFileSync(font.storagePath),
  });

  return { manifest, manifestHash, authored, rendered, assets, space };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pxPerInch = Number(process.env.PPI || 18);
  buildMasterAndSurfaces({ pxPerInch }).then(({ authored, rendered }) => {
    console.log("masterHash   ", authored.master.masterHash);
    console.log("renderHash   ", rendered.renderHash);
    console.log("pxPerInch    ", rendered.pxPerInch, "bleedIn", rendered.bleedIn);
    for (const s of rendered.surfaces) {
      console.log(String(s.surfaceKey).padEnd(10), String(s.pixelWidth).padStart(5) + "x" + String(s.pixelHeight).padEnd(5),
        "bytes", String(s.bytes?.length ?? "-").padStart(9), "hash", String(s.contentHash).slice(0, 16));
    }
  }).catch((err) => { console.error("FAILED:", err?.code || "", err?.message || err); process.exitCode = 1; });
}
