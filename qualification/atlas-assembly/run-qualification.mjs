/**
 * PHASE 1 — OFFLINE QUALIFICATION OF THE DETERMINISTIC ASSEMBLY PATH.
 *
 * Design Master -> six GENIE surfaces -> canonical flattened A.T.L.A.S. ->
 * six canonical panels cut by the REAL production extractor.
 *
 * No provider call. No database read or write. No deployment. Everything the
 * run consumes is a frozen constant or is derived from one.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildMasterAndSurfaces } from "./author-and-render.mjs";
import { GENIE_TRIM, BLEED_INCHES, VEHICLE, CUSTOMER_STRINGS, HERE, genieManifest } from "./fixture.mjs";

const require = createRequire(import.meta.url);
const R = "../../runtime/";
const atlas = require(`${R}flat-first-atlas.cjs`);
const composer = require(`${R}atlas-surface-compose.cjs`);
const sharp = require("../../runtime/node_modules/sharp");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const OUT = join(HERE, "out");

const GENIE_MANIFEST_CONTRACT = "designpro.genie-manifest.v1";
const GENIE_MANIFEST_HASH_CONTRACT = "designpro.genie-manifest-hash.v1";

/**
 * The geometry identity the extractor fails closed without. Derived from the
 * frozen fixture manifest, exactly as the resolver derives it from a real row.
 */
function geometryResolutionFor(manifestHash) {
  const material = JSON.stringify({
    contract: GENIE_MANIFEST_CONTRACT,
    hashContract: GENIE_MANIFEST_HASH_CONTRACT,
    state: "validated",
    sourceRowId: null,
    derivationContract: "qualification.frozen-fixture.v1",
    surfaces: GENIE_TRIM,
    manifestHash,
  });
  const genieManifestHash = sha256(Buffer.from(material));
  return {
    contract: GENIE_MANIFEST_CONTRACT,
    hashContract: GENIE_MANIFEST_HASH_CONTRACT,
    genieManifestId: genieManifestHash.slice(0, 32),
    genieManifestHash,
    state: "validated",
    derivationContract: "qualification.frozen-fixture.v1",
  };
}

export async function runQualification({ pxPerInch = 18, writeArtifacts = true, label = "run" } = {}) {
  const t0 = Date.now();
  const timings = {};

  // 1. Design Master + six deterministic GENIE-sized surfaces.
  const { authored, rendered, manifestHash } = await buildMasterAndSurfaces({ pxPerInch });
  timings.designMasterAndSurfacesMs = Date.now() - t0;

  // 2. A.T.L.A.S. geometry, a pure function of the GENIE rectangles.
  const tGeom = Date.now();
  const surfaces = Object.entries(GENIE_TRIM).map(([surfaceKey, d]) => ({
    surfaceKey, widthInches: d.widthInches, heightInches: d.heightInches,
  }));
  const manifest = atlas.buildAtlasManifest(surfaces, null, VEHICLE.type);
  manifest.geometryResolution = geometryResolutionFor(manifestHash);
  timings.atlasManifestMs = Date.now() - tGeom;

  // 3. Compose the canonical flattened master from the six surfaces.
  const tCompose = Date.now();
  const surfaceBytes = new Map(rendered.surfaces.map((s) => [s.surfaceKey, s.bytes]));
  const composed = await composer.composeAtlasFromSurfaces(surfaceBytes, manifest);
  timings.atlasComposeMs = Date.now() - tCompose;

  // 4. Six canonical panels, cut by the REAL production extractor.
  const tCut = Date.now();
  const panelReadyMs = {};
  const panels = await atlas.cutCallOnePanels(composed.bytes, manifest, composed.masterContentHash, {
    onPanel: (panel) => { panelReadyMs[panel.surfaceKey] = Date.now() - t0; },
  });
  timings.panelExtractionMs = Date.now() - tCut;
  timings.totalMs = Date.now() - t0;

  if (writeArtifacts) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "atlas-master.png"), composed.bytes);
    for (const s of rendered.surfaces) writeFileSync(join(OUT, `surface-${s.surfaceKey}.png`), s.bytes);
    for (const p of panels) if (Buffer.isBuffer(p.bytes)) writeFileSync(join(OUT, `panel-${p.surfaceKey}.png`), p.bytes);
  }

  return {
    label, pxPerInch,
    genieManifestHash: manifest.geometryResolution.genieManifestHash,
    designMasterHash: authored.master.masterHash,
    renderHash: rendered.renderHash,
    masterContentHash: composed.masterContentHash,
    compositionHash: composed.compositionHash,
    placements: composed.placements,
    manifest, panels, rendered, composed, timings, panelReadyMs,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runQualification({ pxPerInch: Number(process.env.PPI || 18) })
    .then((r) => {
      console.log("genieManifestHash ", r.genieManifestHash);
      console.log("designMasterHash  ", r.designMasterHash);
      console.log("renderHash        ", r.renderHash);
      console.log("masterContentHash ", r.masterContentHash);
      console.log("timings           ", JSON.stringify(r.timings));
      console.log("panelReadyMs      ", JSON.stringify(r.panelReadyMs));
      console.log("\npanels:");
      for (const p of r.panels) {
        console.log(" ", String(p.surfaceKey).padEnd(10),
          "keys:", Object.keys(p).join(","));
      }
    })
    .catch((e) => { console.error("FAILED:", e?.code || "", e?.message || e); process.exitCode = 1; });
}
