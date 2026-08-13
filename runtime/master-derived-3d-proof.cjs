"use strict";

/**
 * Phase 4: the customer 3D proof, derived from manufacturing truth.
 *
 * Phase 3 reversed the direction for the flat proof. This does the same for the
 * picture of the vehicle, which is the artefact customers actually look at and
 * therefore the one that mattered most.
 *
 * The retired path generated a wrapped vehicle with an image model. That made
 * the picture the only record of the design, so production artwork had to be
 * reconstructed back out of it — an inverse problem with no ground truth, whose
 * failures were undetectable in principle and were detected in practice only
 * when a customer noticed their own domain name spelled two different ways on
 * two approved views of one design.
 *
 * Here every artwork pixel is read out of an authoritative production surface
 * and placed by a declared mesh. The vehicle's shape, light and reflections
 * come from a pinned plate that carries no artwork. Nothing generates, nothing
 * is fitted, and there is no step at which the picture could disagree with the
 * panels: the panels are its only source.
 *
 * THIS PROOF CARRIES NO MANUFACTURING AUTHORITY, and says so in its own output.
 * It is a view of the surfaces, downsampled and warped onto curved geometry.
 * Reading a dimension, a colour or a string back off it would be reconstructing
 * truth from a picture again, one layer further along.
 *
 * PHASE 4 SCOPE. Proof generation only. Nothing is wired to a stage, no schema
 * changes, no 3D geometry is authored here, and Call 8 keeps production
 * authority until Phase 6.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { SURFACE_KEYS } = require("./design-master.cjs");
const { RENDER_CONTRACT, PNG_OPTIONS } = require("./design-master-renderer.cjs");
const { validateViewPlates, VIEW_PLATE_CONTRACT } = require("./vehicle-view-plate.cjs");
const { warpSurface, meshExtentPx } = require("./mesh-warp.cjs");
const { verifiedSurfaces, canonicalIdentities, outlinedLabel } = require("./master-proof-sheet.cjs");

const PROOF_3D_CONTRACT = "designpro.master-derived-3d-proof.v1";
const RESAMPLER = "lanczos3";
// The warp samples one source pixel per destination pixel. Feeding it a source
// already reduced to exactly the destination size would alias every hard edge
// in the artwork, so it is fed a source at twice the destination scale and the
// reduction to that scale is done by a proper filter first.
const SUPERSAMPLE = 2;
// Working set per view: the frame as RGBA, the warped panel, the mask, the
// shading and specular bands, plus the encoder. Ten frame-sized buffers is the
// same style of empirical guard as the renderer's, and carries the same
// caveat — it is a production bound, not a proof.
const PEAK_BYTES_PER_FRAME_PIXEL = 4 * 10;
const DEFAULT_MAX_VIEW_BYTES = 1024 * 1024 * 1024;
// A mask pixel at or above this is solidly inside the wrap area, not part of
// the antialiased boundary, and must have received artwork.
const SOLID_MASK = 128;

const INK = "#111827";
const MUTED = "#9ca3af";
const PANEL = "#0b0f17";

class Proof3dError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "Proof3dError";
  }
}

function fail(code, message) {
  throw new Proof3dError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Load a pinned plate image and prove it is the one the plate set declares.
 *
 * The plate contributes the entire appearance of the vehicle. A substituted
 * plate would show the customer's artwork on the wrong body, at the wrong
 * scale, under the wrong light — so it is verified by digest exactly like a
 * production asset, not trusted because the path looked right.
 */
async function loadPlateImage(image, loadAsset, what) {
  const bytes = await loadAsset(image.assetId);
  if (!Buffer.isBuffer(bytes) || !bytes.length) fail("proof3d_plate_asset_missing", `${what} (${image.assetId}) could not be loaded`);
  const observed = sha256(bytes);
  if (observed !== image.contentHash) {
    fail("proof3d_plate_asset_mismatch", `${what} hashes to ${observed.slice(0, 16)} but the plate declares ${image.contentHash.slice(0, 16)}`);
  }
  return bytes;
}

/** A single-band raster at exactly the frame size, as raw bytes. */
async function loadBand(bytes, frame, what) {
  const image = sharp(bytes, { limitInputPixels: false });
  const meta = await image.metadata();
  if (meta.width !== frame.widthPx || meta.height !== frame.heightPx) {
    fail("proof3d_plate_size_mismatch", `${what} is ${meta.width}x${meta.height}, not the ${frame.widthPx}x${frame.heightPx} frame`);
  }
  return image.greyscale().raw().toBuffer();
}

/**
 * The surface's trim rectangle, decoded at the scale the warp will sample it.
 *
 * Bleed is excluded because bleed is the margin the trimmer removes: it is on
 * the printed sheet and never on the vehicle, so showing it would show the
 * customer artwork their wrap does not carry.
 */
async function trimSourceForMesh(surface, mesh, pxPerInch) {
  const bleedPx = Math.round(surface.bleedIn * pxPerInch);
  const trimWidthPx = surface.pixelWidth - bleedPx * 2;
  const trimHeightPx = surface.pixelHeight - bleedPx * 2;
  if (trimWidthPx <= 0 || trimHeightPx <= 0) {
    fail("proof3d_surface_trim_invalid", `${surface.surfaceKey} carries more bleed than surface`);
  }

  const extent = meshExtentPx(mesh);
  // Never upscale past what was printed: the proof may show less detail than
  // production, never more, or it would be showing detail the panels do not
  // contain.
  const width = Math.max(1, Math.min(trimWidthPx, extent.widthPx * SUPERSAMPLE));
  const height = Math.max(1, Math.min(trimHeightPx, extent.heightPx * SUPERSAMPLE));

  const bytes = await sharp(surface.bytes, { limitInputPixels: false })
    .extract({ left: bleedPx, top: bleedPx, width: trimWidthPx, height: trimHeightPx })
    .resize(width, height, { fit: "fill", kernel: RESAMPLER })
    .removeAlpha()
    .raw()
    .toBuffer();
  return { bytes, width, height };
}

/**
 * Paint one panel of one view: warp the artwork in, then keep it only where the
 * plate's mask says vinyl goes.
 *
 * Returns the painted coverage so the caller can check the mask was satisfied.
 */
function applyMask(warped, mask, frame) {
  const pixels = frame.widthPx * frame.heightPx;
  let uncovered = 0;
  for (let index = 0; index < pixels; index += 1) {
    const alpha = mask[index];
    const painted = warped[index * 4 + 3];
    if (alpha >= SOLID_MASK && painted === 0) uncovered += 1;
    // Coverage is the mask, gated by whether the mesh reached this pixel at
    // all. Multiplying rather than replacing keeps the mask's antialiased edge,
    // which is what stops the artwork looking like a sticker.
    warped[index * 4 + 3] = painted === 0 ? 0 : alpha;
  }
  return uncovered;
}

/**
 * Composite one masked panel onto the frame, shaded by the vehicle's own light.
 *
 * The shading band is the plate's luminance: door creases, the fall-off over a
 * fender, the darkening under a mirror. Multiplying the artwork by it is what
 * makes vinyl look applied rather than pasted, and it cannot alter what the
 * artwork *is* — a multiply cannot introduce a colour, move an edge or change
 * a letter. The specular band is screened on top for laminate sheen.
 */
function compositePanel(frame, canvas, panel, shading, specular) {
  const pixels = frame.widthPx * frame.heightPx;
  for (let index = 0; index < pixels; index += 1) {
    const alpha = panel[index * 4 + 3];
    if (alpha === 0) continue;
    const light = shading[index] / 255;
    const sheen = specular ? specular[index] / 255 : 0;
    const weight = alpha / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      const source = panel[index * 4 + channel] * light;
      const lit = source + (255 - source) * sheen;
      const base = canvas[index * 3 + channel];
      canvas[index * 3 + channel] = Math.floor(base + (lit - base) * weight + 0.5);
    }
  }
}

/**
 * A caption strip naming the view and restating the canonical strings.
 *
 * Type on a wrapped vehicle is foreshortened, curved and partly occluded, which
 * is honest — that is what it will look like — but it means the 3D view is not
 * where a customer should be checking their own spelling. The strings are
 * therefore repeated flat, taken from the surfaces rather than from the master,
 * so what is legible here and what is manufactured cannot diverge.
 */
function captionMarkup(fonts, view, identities, frame) {
  const height = 132;
  const top = frame.heightPx - height;
  const strings = identities.text.map((item) => item.string).join("   ·   ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.widthPx}" height="${frame.heightPx}">
    <rect x="0" y="${top}" width="${frame.widthPx}" height="${height}" fill="${PANEL}" fill-opacity="0.82"/>
    ${outlinedLabel(fonts, view.label, { x: 36, y: top + 52, size: 34, fill: "#ffffff", bold: true })}
    ${outlinedLabel(fonts, strings || "no canonical text on this design", { x: 36, y: top + 96, size: 24, fill: "#e5e7eb" })}
    ${outlinedLabel(fonts, "VISUALISATION · NOT A MANUFACTURING SOURCE", { x: frame.widthPx - 36, y: top + 52, size: 22, fill: MUTED, anchor: "end" })}
    ${outlinedLabel(fonts, "artwork shown is the manufactured surface", { x: frame.widthPx - 36, y: top + 96, size: 22, fill: MUTED, anchor: "end" })}
  </svg>`;
}

/**
 * The plates and the render must describe the same vehicle.
 *
 * Panel dimensions are what a plate is cut against. A plate set bound to a
 * different manifest would land the artwork on geometry it was never fitted
 * for, and the resulting picture would look entirely plausible.
 */
function assertBinding(plates, render) {
  if (plates.dimensionManifestId !== render.dimensionManifestId || plates.manifestHash !== render.manifestHash) {
    fail("proof3d_plate_manifest_mismatch",
      `the plates are cut for manifest ${plates.dimensionManifestId} but the render was built from ${render.dimensionManifestId}`);
  }
}

async function renderView({ view, plates, surfaceByKey, render, loadAsset, fonts, identities, maxViewBytes }) {
  const frame = { widthPx: plates.widthPx, heightPx: plates.heightPx };
  const budget = frame.widthPx * frame.heightPx * PEAK_BYTES_PER_FRAME_PIXEL;
  if (budget > maxViewBytes) {
    fail("proof3d_view_over_budget", `${view.viewKey} needs about ${Math.round(budget / 1e6)} MB, over the ${Math.round(maxViewBytes / 1e6)} MB ceiling`);
  }

  const baseBytes = await loadPlateImage(view.base, loadAsset, `${view.viewKey} base plate`);
  const baseMeta = await sharp(baseBytes, { limitInputPixels: false }).metadata();
  if (baseMeta.width !== frame.widthPx || baseMeta.height !== frame.heightPx) {
    fail("proof3d_plate_size_mismatch", `${view.viewKey} base plate is ${baseMeta.width}x${baseMeta.height}, not the ${frame.widthPx}x${frame.heightPx} frame`);
  }
  const canvas = await sharp(baseBytes, { limitInputPixels: false }).removeAlpha().raw().toBuffer();
  const shading = await loadBand(await loadPlateImage(view.shading, loadAsset, `${view.viewKey} shading`), frame, `${view.viewKey} shading`);
  const specular = view.specular
    ? await loadBand(await loadPlateImage(view.specular, loadAsset, `${view.viewKey} specular`), frame, `${view.viewKey} specular`)
    : null;

  const painted = [];
  for (const panel of view.panels) {
    const surface = surfaceByKey.get(panel.surfaceKey);
    const mask = await loadBand(await loadPlateImage(panel.mask, loadAsset, `${view.viewKey} ${panel.surfaceKey} mask`), frame, `${view.viewKey} ${panel.surfaceKey} mask`);
    const source = await trimSourceForMesh(surface, panel.mesh, render.pxPerInch);
    const warped = warpSurface({
      source: source.bytes, sourceWidth: source.width, sourceHeight: source.height,
      mesh: panel.mesh, frameWidth: frame.widthPx, frameHeight: frame.heightPx,
    });
    // A mask that asks for artwork the mesh never delivers would leave bare
    // paint where the wrap goes, and a customer would approve a vehicle with a
    // hole in the design that production will not have.
    const uncovered = applyMask(warped, mask, frame);
    if (uncovered > 0) {
      fail("proof3d_mask_uncovered", `${view.viewKey}: the ${panel.surfaceKey} mesh leaves ${uncovered} masked pixels unpainted`);
    }
    compositePanel(frame, canvas, warped, shading, specular);
    painted.push({ surfaceKey: panel.surfaceKey, contentHash: surface.contentHash, sourceWidthPx: source.width, sourceHeightPx: source.height });
  }

  const caption = Buffer.from(captionMarkup(fonts, view, identities, frame));
  const bytes = await sharp(canvas, { raw: { width: frame.widthPx, height: frame.heightPx, channels: 3 } })
    .composite([{ input: caption, left: 0, top: 0 }])
    .removeAlpha()
    .png(PNG_OPTIONS)
    .toBuffer();

  return Object.freeze({
    viewKey: view.viewKey,
    label: view.label,
    handedness: view.handedness,
    bytes,
    contentHash: sha256(bytes),
    byteSize: bytes.length,
    width: frame.widthPx,
    height: frame.heightPx,
    panels: Object.freeze(painted),
  });
}

/**
 * Build every customer 3D view from one completed production render.
 */
async function renderMasterDerived3dProof({
  render, plates, loadAsset, proofFonts,
  maxViewBytes = DEFAULT_MAX_VIEW_BYTES,
}) {
  if (!render || render.contract !== RENDER_CONTRACT) {
    fail("proof3d_render_invalid", "the 3D proof must be derived from a completed production render");
  }
  if (typeof loadAsset !== "function") fail("proof3d_loader_required", "loadAsset is required");
  const fonts = { regular: proofFonts?.regular, bold: proofFonts?.bold };
  if (!Buffer.isBuffer(fonts.regular) || !fonts.regular.length) {
    fail("proof3d_font_required", "the 3D proof must be typeset from a pinned font file, not a system family name");
  }

  const validated = plates?.contract === VIEW_PLATE_CONTRACT && plates.plateSetHash
    ? plates
    : validateViewPlates(plates);
  assertBinding(validated, render);

  // The same fail-closed check the 2D proof runs, for the same reason: the
  // proof re-derives every digest from the bytes it is about to draw.
  const surfaceByKey = verifiedSurfaces(Array.isArray(render.surfaces) ? render.surfaces : []);
  const identities = canonicalIdentities(SURFACE_KEYS.map((key) => surfaceByKey.get(key)));

  const views = [];
  for (const view of validated.views) {
    views.push(await renderView({
      view, plates: validated, surfaceByKey, render, loadAsset, fonts, identities, maxViewBytes,
    }));
  }

  return Object.freeze({
    contract: PROOF_3D_CONTRACT,
    views: Object.freeze(views),
    // One identity over every view, so two proofs of one render agree and a
    // proof of a changed render does not.
    proofHash: sha256(Buffer.from(views.map((view) => `${view.viewKey}:${view.contentHash}`).join("\n"))),
    // Provenance that makes the reversal checkable end to end.
    masterHash: render.masterHash,
    renderHash: render.renderHash,
    revisionId: render.revisionId,
    dimensionManifestId: render.dimensionManifestId,
    manifestHash: render.manifestHash,
    plateSetId: validated.plateSetId,
    plateSetHash: validated.plateSetHash,
    surfaceHashes: SURFACE_KEYS.map((key) => ({ surfaceKey: key, contentHash: surfaceByKey.get(key).contentHash })),
    textIdentities: identities.text.map(({ textId, string }) => ({ textId, string })),
    logoIdentities: identities.logos.map(({ identityKey, contentHash }) => ({ identityKey, contentHash })),
    generated: false,
    // Stated in the artefact, not only in this comment. Anything downstream
    // that reaches for a dimension here is reading a picture, and the picture
    // is a warped, downsampled view of surfaces that are themselves the truth.
    manufacturingAuthority: false,
    dimensionsAuthority: null,
  });
}

module.exports = {
  PROOF_3D_CONTRACT,
  DEFAULT_MAX_VIEW_BYTES,
  PEAK_BYTES_PER_FRAME_PIXEL,
  SUPERSAMPLE,
  Proof3dError,
  renderMasterDerived3dProof,
  _test: { applyMask, compositePanel, trimSourceForMesh, assertBinding, loadPlateImage },
};
