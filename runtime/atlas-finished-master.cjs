"use strict";

const sharp = require("sharp");
const { createHash } = require("node:crypto");
const CONTRACT = "designpro.atlas-finished-master.v1";
const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Reassemble finished rectangles at their ORIGINAL extraction coordinates.
// This reverses only the recorded extraction rotation; it never mirrors,
// relocates, stretches, or fabricates artwork. The caller must run the existing
// whole-master acceptance gates before it publishes this result.
async function assembleFinishedMaster(masterBytes, manifest, finishedPanels) {
  const zones = manifest?.zones || [];
  const panels = Array.isArray(finishedPanels) ? finishedPanels : [];
  if (panels.length !== 6 || new Set(panels.map((panel) => panel.surfaceKey)).size !== 6
    || SURFACES.some((key) => !panels.some((panel) => panel.surfaceKey === key))) {
    throw Object.assign(new Error("Finishing must preserve all six original ATLAS surfaces"), { code: "flat_atlas_finished_surface_set_invalid" });
  }
  if (!panels.some((panel) => panel.finish?.applied === true)) {
    return { contract: CONTRACT, bytes: masterBytes, contentHash: sha256(masterBytes), changed: false };
  }
  const masterMeta = await sharp(masterBytes).metadata();
  const overlays = [];
  for (const panel of panels) {
    if (panel.finish?.applied !== true) continue;
    const zone = zones.find((candidate) => candidate.surfaceKey === panel.surfaceKey);
    const extraction = zone?.extraction;
    if (!extraction || ![extraction.x, extraction.y, extraction.w, extraction.h].every(Number.isSafeInteger)
      || extraction.x < 0 || extraction.y < 0 || extraction.w < 1 || extraction.h < 1
      || extraction.x + extraction.w > masterMeta.width || extraction.y + extraction.h > masterMeta.height
      || ![0, 90, -90, 180, -180, 270, -270].includes(Number(extraction.outputRotationDegrees || 0))) {
      throw Object.assign(new Error(`${panel.surfaceKey}: original extraction geometry is invalid`), { code: "flat_atlas_finished_geometry_invalid" });
    }
    const result = panel.finish;
    if (!Buffer.isBuffer(result.bytes) || sha256(result.bytes) !== result.contentHash) {
      throw Object.assign(new Error(`${panel.surfaceKey}: finished bytes do not match their recorded hash`), { code: "flat_atlas_finished_panel_identity_mismatch" });
    }
    const restored = await sharp(result.bytes).rotate(-Number(extraction.outputRotationDegrees || 0))
      .ensureAlpha().png().toBuffer();
    const metadata = await sharp(restored).metadata();
    if (metadata.width !== extraction.w || metadata.height !== extraction.h) {
      throw Object.assign(new Error(`${panel.surfaceKey}: finished pixels do not fit the exact original zone`), { code: "flat_atlas_finished_panel_dimensions_mismatch" });
    }
    const stats = await sharp(restored).stats();
    if (stats.channels[3]?.min !== 255) {
      throw Object.assign(new Error(`${panel.surfaceKey}: a finished print rectangle must be fully opaque`), { code: "flat_atlas_finished_panel_coverage_invalid" });
    }
    overlays.push({ input: restored, left: extraction.x, top: extraction.y, blend: "over" });
  }
  const bytes = await sharp(masterBytes).composite(overlays).png().toBuffer();
  return { contract: CONTRACT, bytes, contentHash: sha256(bytes), changed: true };
}

module.exports = { CONTRACT, assembleFinishedMaster };
