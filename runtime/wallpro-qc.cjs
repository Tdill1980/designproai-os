"use strict";

/**
 * WallPro production QC.
 *
 * This intentionally does NOT reuse PanelPro's vehicle QC contract. PanelPro's
 * certificate and geometry checks are vehicle-specific (surfaces, five-inch
 * vehicle bleed, source regions, vehicle template geometry). WallPro gets its
 * own receipt contract, but follows the same fail-closed, evidence-first model.
 *
 * Pure manifest checks live here; pixel seam verification is also exposed for
 * the graph worker to run against the actual stored panel bytes before a job is
 * releasable.
 */

const sharp = require("sharp");
const { createHash } = require("node:crypto");

const QC_CONTRACT = "wallpro.production-qc.v1";
const PRODUCTION_CONTRACT = "wallpro.production-panels.v1";
const REQUIRED_FORMATS = Object.freeze(["png", "tiff", "pdf"]);

const clean = (n) => Number(Number(n).toFixed(6));
const near = (a, b, eps = 1e-6) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= eps;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function add(checks, key, ok, detail, evidence) {
  checks.push(Object.freeze({ key, ok: Boolean(ok), detail, ...(evidence === undefined ? {} : { evidence }) }));
}

/**
 * Structural QC for a completed WallPro production manifest.
 *
 * expected values come from the paid job/SKU contract, not from the manifest,
 * so a bad producer cannot make itself pass by changing both output and receipt.
 */
function validateWallProManifest(manifest, expected = {}) {
  const checks = [];
  const fail = (key, detail, evidence) => add(checks, key, false, detail, evidence);
  const pass = (key, detail, evidence) => add(checks, key, true, detail, evidence);

  if (!manifest || typeof manifest !== "object") {
    fail("manifest_present", "Production manifest is missing");
    return finalize(checks, manifest, expected);
  }

  const request = manifest.request || {};
  const bounds = manifest.bounds || {};
  const panels = Array.isArray(manifest.panels) ? [...manifest.panels].sort((a, b) => Number(a.number) - Number(b.number)) : [];

  add(checks, "production_contract", manifest.contract === PRODUCTION_CONTRACT,
    `Expected ${PRODUCTION_CONTRACT}`, { actual: manifest.contract || null });

  const required = {
    wallWidthIn: Number(expected.wallWidthIn ?? request.wallWidthIn),
    wallHeightIn: Number(expected.wallHeightIn ?? request.wallHeightIn),
    bleedIn: Number(expected.bleedIn ?? request.bleedIn),
    overlapIn: Number(expected.overlapIn ?? request.overlapIn),
    panelWidthIn: Number(expected.panelWidthIn ?? request.panelWidthIn),
    targetPpi: Number(expected.targetPpi ?? request.targetPpi),
  };

  for (const [key, value] of Object.entries(required)) {
    const actual = Number(request[key]);
    add(checks, `request_${key}`, near(actual, value), `${key} must match the job contract`, { expected: value, actual });
  }

  if (Number.isFinite(required.panelWidthIn)) {
    add(checks, "roll_width_limit", required.panelWidthIn <= Number(expected.maxRollWidthIn ?? 54),
      "Panel width must not exceed the printable roll width",
      { panelWidthIn: required.panelWidthIn, maxRollWidthIn: Number(expected.maxRollWidthIn ?? 54) });
  }

  const expectedBoundsW = clean(required.wallWidthIn + 2 * required.bleedIn);
  const expectedBoundsH = clean(required.wallHeightIn + 2 * required.bleedIn);
  add(checks, "bounds_width", near(Number(bounds.width), expectedBoundsW), "Whole-wall width must equal trim width plus perimeter bleed", { expected: expectedBoundsW, actual: Number(bounds.width) });
  add(checks, "bounds_height", near(Number(bounds.height), expectedBoundsH), "Whole-wall height must equal trim height plus perimeter bleed", { expected: expectedBoundsH, actual: Number(bounds.height) });

  add(checks, "panels_present", panels.length > 0, "At least one production panel is required", { count: panels.length });

  let previous = null;
  for (const panel of panels) {
    const n = Number(panel.number);
    const prefix = `panel_${String(n).padStart(3, "0")}`;
    const widthIn = Number(panel.widthIn), heightIn = Number(panel.heightIn);
    const widthPx = Number(panel.widthPx), heightPx = Number(panel.heightPx), ppi = Number(panel.ppi);
    const expectedWpx = Math.round(widthIn * required.targetPpi);
    const expectedHpx = Math.round(heightIn * required.targetPpi);

    add(checks, `${prefix}_ppi`, near(ppi, required.targetPpi), "Panel PPI must equal target PPI", { expected: required.targetPpi, actual: ppi });
    add(checks, `${prefix}_pixel_width`, widthPx === expectedWpx, "Panel pixel width must equal printed inches × PPI", { expected: expectedWpx, actual: widthPx });
    add(checks, `${prefix}_pixel_height`, heightPx === expectedHpx, "Panel pixel height must equal printed inches × PPI", { expected: expectedHpx, actual: heightPx });
    add(checks, `${prefix}_height_inches`, near(heightIn, expectedBoundsH), "Every panel must include the full wall height plus top/bottom bleed", { expected: expectedBoundsH, actual: heightIn });
    add(checks, `${prefix}_roll_width`, widthIn <= Number(expected.maxRollWidthIn ?? 54) + 1e-6, "Panel exceeds roll width", { widthIn, maxRollWidthIn: Number(expected.maxRollWidthIn ?? 54) });

    const files = Array.isArray(panel.files) ? panel.files : [];
    for (const format of REQUIRED_FORMATS) {
      const file = files.find((f) => f && f.format === format);
      add(checks, `${prefix}_${format}`, Boolean(file && file.path && !file.error), `Panel must have a successful ${format.toUpperCase()} derivative`, file || null);
    }

    if (previous) {
      const expectedStart = clean(Number(previous.xIn) + Number(previous.widthIn) - required.overlapIn);
      add(checks, `${prefix}_overlap_geometry`, near(Number(panel.xIn), expectedStart), "Adjacent panels must duplicate the configured overlap in wall coordinates", { expectedStart, actualStart: Number(panel.xIn), overlapIn: required.overlapIn });
      add(checks, `${prefix}_overlap_receipt`, near(Number(panel.overlapLeftIn), required.overlapIn), "Panel overlap receipt must match the configured overlap", { expected: required.overlapIn, actual: Number(panel.overlapLeftIn) });
    } else {
      add(checks, `${prefix}_first_panel_overlap`, near(Number(panel.overlapLeftIn || 0), 0), "First panel must not claim a left overlap", { actual: Number(panel.overlapLeftIn || 0) });
    }
    previous = panel;
  }

  const whole = manifest.wholeWall;
  if (expected.requireWholeWall !== false) {
    add(checks, "whole_wall_present", Boolean(whole && whole.path && !whole.error), "One whole-wall production file is required", whole || null);
    if (whole && whole.path && !whole.error) {
      add(checks, "whole_wall_width_inches", near(Number(whole.widthIn), expectedBoundsW), "Whole-wall file width must include perimeter bleed", { expected: expectedBoundsW, actual: Number(whole.widthIn) });
      add(checks, "whole_wall_height_inches", near(Number(whole.heightIn), expectedBoundsH), "Whole-wall file height must include perimeter bleed", { expected: expectedBoundsH, actual: Number(whole.heightIn) });
      add(checks, "whole_wall_ppi", near(Number(whole.ppi), required.targetPpi), "Whole-wall file PPI must equal target PPI", { expected: required.targetPpi, actual: Number(whole.ppi) });
      add(checks, "whole_wall_pixel_width", Number(whole.widthPx) === Math.round(expectedBoundsW * required.targetPpi), "Whole-wall pixel width must equal inches × PPI", { expected: Math.round(expectedBoundsW * required.targetPpi), actual: Number(whole.widthPx) });
      add(checks, "whole_wall_pixel_height", Number(whole.heightPx) === Math.round(expectedBoundsH * required.targetPpi), "Whole-wall pixel height must equal inches × PPI", { expected: Math.round(expectedBoundsH * required.targetPpi), actual: Number(whole.heightPx) });
    }
  }

  return finalize(checks, manifest, expected);
}

function finalize(checks, manifest, expected) {
  const failed = checks.filter((c) => !c.ok);
  return Object.freeze({
    contract: QC_CONTRACT,
    accepted: failed.length === 0,
    jobId: manifest?.jobId || null,
    versionId: manifest?.versionId || null,
    projectId: manifest?.projectId || null,
    checks: Object.freeze(checks),
    failures: Object.freeze(failed),
    expected: Object.freeze({ ...expected }),
  });
}

/**
 * Verifies that the duplicated seam pixels are byte-identical after decoding.
 * This is stronger than geometry-only QC and catches drift from independent
 * enhancement, crop rounding, or accidental resampling.
 */
async function verifyOverlapPixels({ leftBytes, rightBytes, overlapIn, ppi, tolerance = 0 }) {
  const overlapPx = Math.round(Number(overlapIn) * Number(ppi));
  if (!Buffer.isBuffer(leftBytes) || !Buffer.isBuffer(rightBytes)) throw new Error("wallpro_qc_panel_bytes_required");
  if (!Number.isFinite(overlapPx) || overlapPx < 1) throw new Error("wallpro_qc_overlap_invalid");

  const left = await sharp(leftBytes, { limitInputPixels: false }).flatten().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const right = await sharp(rightBytes, { limitInputPixels: false }).flatten().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (left.info.height !== right.info.height || left.info.channels !== right.info.channels) {
    return Object.freeze({ ok: false, reason: "seam_geometry_mismatch", overlapPx, left: left.info, right: right.info });
  }
  if (left.info.width < overlapPx || right.info.width < overlapPx) throw new Error("wallpro_qc_overlap_wider_than_panel");

  const channels = left.info.channels;
  let differingChannels = 0, maxDelta = 0;
  for (let y = 0; y < left.info.height; y++) {
    const leftStart = (y * left.info.width + left.info.width - overlapPx) * channels;
    const rightStart = (y * right.info.width) * channels;
    for (let x = 0; x < overlapPx * channels; x++) {
      const delta = Math.abs(left.data[leftStart + x] - right.data[rightStart + x]);
      if (delta > tolerance) differingChannels += 1;
      if (delta > maxDelta) maxDelta = delta;
    }
  }
  return Object.freeze({
    ok: differingChannels === 0,
    overlapPx,
    differingChannels,
    maxDelta,
    tolerance,
    leftSha256: sha256(leftBytes),
    rightSha256: sha256(rightBytes),
  });
}

module.exports = Object.freeze({
  QC_CONTRACT,
  PRODUCTION_CONTRACT,
  REQUIRED_FORMATS,
  validateWallProManifest,
  verifyOverlapPixels,
});
