"use strict";

// The physical-piece renderer of PanelProFileOutput. It consumes immutable,
// reviewed geometry and existing pixels. Installation masks are inspection
// overlays only: they are never used as an alpha mask on a print file.
const { createHash } = require('node:crypto');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sharp = require('sharp');
const { buildPanelProFileOutputHandoff } = require('./panelpro-file-output-contract.cjs');
const { buildPanelProFileOutputPlan } = require('./panelpro-file-output-plan.cjs');

const RENDER_CONTRACT = 'designpro.panelpro-file-output-render.v1';
const GEOMETRY_CONTRACT = 'designpro.panelpro-file-output-geometry.v1';
// Hard bounds cannot be raised by intake JSON or caller options. The caller
// may lower them. Each selected piece/section runs serially and formats spool
// through disk instead of retaining a whole vehicle's production rasters.
const LIMITS = Object.freeze({ maxPiecePixels: 240_000_000, maxSourceBytes: 256 * 1024 * 1024, maxGeometryBytes: 4 * 1024 * 1024, maxDisplayPixels: 32_000_000, maxEdgePixels: 50000 });
const EPS = 1e-7;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const stable = (x) => JSON.stringify(x, (_key, v) => v && !Array.isArray(v) && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const xml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const n = (value) => Number(value.toFixed(6));
const fileSegment = (id) => id.replace(/:/g, '~3a');
function stop(code, details = {}) { const error = new Error(code); error.code = code; error.details = details; throw error; }
function limitOptions(options = {}) {
  return Object.fromEntries(Object.entries(LIMITS).map(([key, max]) => [key,
    Number.isFinite(options[key]) && options[key] > 0 ? Math.min(max, Math.floor(options[key])) : max]));
}
async function checkedRead(readBytes, ref, maxBytes) {
  const value = await readBytes(ref);
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) stop('panelprofile_source_bytes_invalid');
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.length > maxBytes) stop('panelprofile_source_resource_limit', { storagePath: ref.storagePath });
  if (sha(bytes) !== ref.contentHash) stop('panelprofile_source_hash_mismatch', { storagePath: ref.storagePath });
  return bytes;
}
function exactPixels(inches, ppi) {
  const value = inches * ppi;
  if (!Number.isFinite(value) || !Number.isSafeInteger(Math.round(value)) || value < 1 || Math.abs(value - Math.round(value)) > EPS) stop('panelprofile_pixel_geometry_unrepresentable', { inches, ppi });
  return Math.round(value);
}
function outputBox(section) {
  const b = section.trimBoundsInches;
  return { x: b.x - 5, y: b.y - 5, width: b.width + 10, height: b.height + 10 };
}
function usesSeparatedArtwork(piece, plan) {
  return piece.composition?.rebuildFromSeparatedAssets === true || plan.placements.some((p) => p.moved);
}
function mappingCheck(meta, mapping, box, targetPpi) {
  const b = mapping?.boundsInches;
  if (!b) stop('panelprofile_source_mapping_required');
  if (b.x > box.x + EPS || b.y > box.y + EPS || b.x + b.width < box.x + box.width - EPS
    || b.y + b.height < box.y + box.height - EPS) stop('panelprofile_bleed_source_coverage_missing');
  const xPpi = meta.width / b.width, yPpi = meta.height / b.height;
  // At most one decoded pixel of rounding is allowed; no anisotropic fitting.
  if (Math.abs(xPpi - yPpi) > Math.max(1 / b.width, 1 / b.height) + EPS) stop('panelprofile_source_mapping_would_stretch');
  if (Math.min(xPpi, yPpi) + EPS < targetPpi) stop('panelprofile_source_effective_ppi_insufficient', { xPpi, yPpi, targetPpi });
  return { xPpi, yPpi, boundsInches: b };
}
async function rasterInfo(bytes, limits, { opaque = false } = {}) {
  let meta;
  try { meta = await sharp(bytes, { failOn: 'error', limitInputPixels: false, sequentialRead: true }).metadata(); }
  catch { stop('panelprofile_source_decode_failed'); }
  if (!['png', 'jpeg', 'webp', 'tiff'].includes(meta.format) || (meta.pages || 1) !== 1) stop('panelprofile_raster_format_unsupported');
  if (!meta.width || !meta.height || meta.width > limits.maxEdgePixels || meta.height > limits.maxEdgePixels
    || meta.width * meta.height > limits.maxPiecePixels) stop('panelprofile_source_resource_limit');
  if (meta.orientation && meta.orientation !== 1) stop('panelprofile_source_orientation_requires_normalization');
  if (opaque && meta.hasAlpha) {
    if (meta.depth !== 'uchar') stop('panelprofile_alpha_normalization_required');
    // Decode exactly once, retaining one byte per pixel (hard maximum 240MB),
    // never a full RGBA raster in JS. Repeated strip extraction decodes a PNG
    // repeatedly and would make large panels unnecessarily slow. A resized
    // opacity probe would miss a one-pixel installation hole.
    const alpha = await sharp(bytes, { limitInputPixels: limits.maxPiecePixels, sequentialRead: true })
      .ensureAlpha().extractChannel('alpha').raw().toBuffer();
    if (alpha.length !== meta.width * meta.height || alpha.some((v) => v !== 255)) stop('panelprofile_continuous_artwork_has_transparency');
  }
  return meta;
}
function checkDisplayRegion(region, metadata) {
  if (!region || !['x', 'y', 'width', 'height'].every((key) => Number.isInteger(region[key]))
    || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
    || region.x + region.width > metadata.width || region.y + region.height > metadata.height) stop('panelprofile_template_display_mapping_required');
}
function geometryFor(geometry, piece) {
  const entry = geometry.pieces?.find((p) => p.pieceId === piece.pieceId);
  if (!entry || entry.widthInches !== piece.widthInches || entry.heightInches !== piece.heightInches
    || stable(entry.outlineInches) !== stable(piece.outlineInches)
    || stable(entry.cutAreas) !== stable(piece.cutAreas)) stop('panelprofile_reviewed_geometry_mismatch', { pieceId: piece.pieceId });
  return entry;
}
async function assetInfo(bytes, asset, element, limits, ppi) {
  const width = exactPixels(element.boundsInches.width, ppi), height = exactPixels(element.boundsInches.height, ppi);
  if (width * height > limits.maxPiecePixels) stop('panelprofile_asset_resource_limit');
  if (asset.kind === 'vector') {
    if (bytes.length > 2 * 1024 * 1024) stop('panelprofile_asset_resource_limit');
    if (width > 32767 || height > 32767) stop('panelprofile_asset_resource_limit');
    const source = bytes.toString('utf8');
    // libvips is used only for self-contained SVG. PDF/EPS vector conversion
    // needs an approved derivative, not a guessed low-resolution raster.
    if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(source)
      || /<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|@import|\burl\s*\(|\b(?:href|src)\s*=/i.test(source)) stop('panelprofile_vector_derivative_required');
    const meta = await sharp(bytes, { limitInputPixels: limits.maxPiecePixels }).metadata();
    if (!meta.width || !meta.height || Math.abs(width / height - meta.width / meta.height) > Math.max(1 / height, 1 / meta.height)) stop('panelprofile_asset_mapping_would_stretch');
    return { vector: true, width, height, density: Math.min(2400, 72 * Math.max(width / meta.width, height / meta.height)) };
  }
  const meta = await rasterInfo(bytes, limits);
  if (meta.width < width || meta.height < height) stop('panelprofile_asset_effective_ppi_insufficient', { assetId: asset.assetId });
  if (Math.abs(width / height - meta.width / meta.height) > Math.max(1 / height, 1 / meta.height)) stop('panelprofile_asset_mapping_would_stretch');
  return { vector: false, width, height };
}
function assetFormat(bytes) {
  const prefix = bytes.subarray(0, 512).toString('utf8');
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return ['png', 'image/png'];
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return ['jpg', 'image/jpeg'];
  if (['II', 'MM'].includes(bytes.subarray(0, 2).toString())) return ['tiff', 'image/tiff'];
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return ['webp', 'image/webp'];
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(prefix)) return ['svg', 'image/svg+xml'];
  if (prefix.startsWith('%PDF-')) return ['pdf', 'application/pdf'];
  if (prefix.startsWith('%!PS')) return ['eps', 'application/postscript'];
  stop('panelprofile_original_asset_format_unsupported');
}
function selectedPieces(request, pieceIds) {
  if (pieceIds == null) return request.pieces;
  if (!Array.isArray(pieceIds) || !pieceIds.length || new Set(pieceIds).size !== pieceIds.length
    || pieceIds.some((id) => !request.pieces.some((p) => p.pieceId === id))) stop('panelprofile_piece_selection_invalid');
  return request.pieces.filter((p) => pieceIds.includes(p.pieceId));
}

/** Byte-backed, no-output preflight. Safe to persist this receipt as a durable
 * graph result. Pixel density is measured; source-detail/QC approval is not. */
async function preparePanelProFileOutput(input, options = {}) {
  if (typeof options.readBytes !== 'function') stop('panelprofile_reader_required');
  const request = buildPanelProFileOutputHandoff(input);
  const plan = buildPanelProFileOutputPlan(request);
  const pieces = selectedPieces(request, options.pieceIds);
  const limits = limitOptions(options.limits);
  const blockers = [];
  let geometry = null;
  try {
    if (!request.template.geometry || request.template.geometry.contentHash !== request.template.geometryHash) stop('panelprofile_reviewed_geometry_required');
    geometry = JSON.parse((await checkedRead(options.readBytes, request.template.geometry, limits.maxGeometryBytes)).toString('utf8'));
    if (geometry.contractVersion !== GEOMETRY_CONTRACT || geometry.templateId !== request.template.templateId
      || geometry.version !== request.template.version || geometry.displayContentHash !== request.template.display.contentHash
      || !Array.isArray(geometry.pieces) || new Set(geometry.pieces.map((p) => p.pieceId)).size !== geometry.pieces.length) stop('panelprofile_reviewed_geometry_mismatch');
    const displayBytes = await checkedRead(options.readBytes, request.template.display, limits.maxSourceBytes);
    const displayMeta = await rasterInfo(displayBytes, { ...limits, maxPiecePixels: limits.maxDisplayPixels });
    for (const piece of pieces) {
      if (!piece.outlineInches) stop('panelprofile_reviewed_outline_required', { pieceId: piece.pieceId });
      checkDisplayRegion(geometryFor(geometry, piece).displayRegionPixels, displayMeta);
    }
  } catch (error) {
    if (error.retryable === true) throw error;
    if (!error.code?.startsWith('panelprofile_') && !(error instanceof SyntaxError)) throw error;
    blockers.push({ code: error.code || 'panelprofile_geometry_json_invalid', ...error.details });
  }
  const verifiedPieces = [];
  for (const piece of pieces) {
    const piecePlan = plan.pieces.find((p) => p.pieceId === piece.pieceId);
    const pieceBlockers = [...piecePlan.blockers];
    let evidence = null;
    try {
      if (pieceBlockers.length) { verifiedPieces.push({ pieceId: piece.pieceId, blockers: pieceBlockers }); continue; }
      const moved = usesSeparatedArtwork(piece, piecePlan);
      const sourceBytes = await checkedRead(options.readBytes, piece.source, limits.maxSourceBytes);
      const sourceMeta = await rasterInfo(sourceBytes, limits, { opaque: !moved });
      const whole = { x: -5, y: -5, width: piece.outputWidthInches, height: piece.outputHeightInches };
      const sourceResolution = mappingCheck(sourceMeta, piece.sourceMapping, whole, moved ? 0 : request.outputPolicy.fullSizePpi);
      let renderedResolution = sourceResolution;
      if (moved) {
        if (!piece.composition?.layerSeparationVerified || !piece.composition.nonessentialBackgroundVerified) stop('panelprofile_verified_nonessential_background_required');
        const background = await checkedRead(options.readBytes, piece.composition.background, limits.maxSourceBytes);
        const backgroundMeta = await rasterInfo(background, limits, { opaque: true });
        renderedResolution = mappingCheck(backgroundMeta, piece.composition.backgroundMapping, whole, request.outputPolicy.fullSizePpi);
        for (const element of piece.protectedElements) {
          const asset = request.availableAssets.find((a) => a.assetId === element.assetId);
          if (!asset.separable) stop('panelprofile_protected_art_requires_layer_separation');
          await assetInfo(await checkedRead(options.readBytes, asset, limits.maxSourceBytes), asset, element, limits, request.outputPolicy.fullSizePpi);
        }
      } else if (!piece.coverageReview?.continuousArtworkVerified || !piece.coverageReview.nonessentialCutFillVerified
        || piece.coverageReview.sourceContentHash !== piece.source.contentHash) stop('panelprofile_continuous_artwork_review_required');
      for (const asset of request.availableAssets.filter((a) => piece.protectedElements.some((p) => p.assetId === a.assetId))) {
        assetFormat(await checkedRead(options.readBytes, asset, limits.maxSourceBytes));
      }
      for (const section of piecePlan.sections) {
        const box = outputBox(section);
        const width = exactPixels(box.width, request.outputPolicy.fullSizePpi), height = exactPixels(box.height, request.outputPolicy.fullSizePpi);
        if (width * height > limits.maxPiecePixels || Math.max(width, height) > limits.maxEdgePixels) stop('panelprofile_piece_resource_limit');
        if ((section.rollRotationDegrees === 90 ? box.height : box.width) > request.outputPolicy.printableWidthInches + EPS) stop('panelprofile_roll_width_exceeded');
      }
      evidence = { sourceContentHash: piece.source.contentHash, effectivePpiX: renderedResolution.xPpi, effectivePpiY: renderedResolution.yPpi,
        referenceEffectivePpiX: sourceResolution.xPpi, referenceEffectivePpiY: sourceResolution.yPpi,
        pixelDensityVerified: true, nativeDetailVerified: false, nativeDetailReview: 'existing-human-qc', bleedContent: 'existing-source-coverage',
        cutAreaFill: moved ? 'verified-existing-nonessential-background' : 'source-coverage-review', sourceUnmodified: true };
    } catch (error) {
      if (error.retryable === true) throw error;
      if (!error.code?.startsWith('panelprofile_')) throw error;
      pieceBlockers.push({ code: error.code, ...error.details });
    }
    verifiedPieces.push({ pieceId: piece.pieceId, blockers: pieceBlockers, evidence });
  }
  const allBlockers = [...blockers, ...verifiedPieces.flatMap((p) => p.blockers.map((b) => ({ pieceId: p.pieceId, ...b })))];
  return { contractVersion: RENDER_CONTRACT, inputHash: request.inputHash,
    status: allBlockers.length ? 'requires_human_correction' : 'ready_to_render', selectedPieceIds: pieces.map((p) => p.pieceId),
    blockers: allBlockers, plan, verifiedPieces, geometry, productionFilesCreated: false, qcApproved: false, releaseToCustomer: false };
}

function cropPipeline(bytes, metadata, mapping, box, ppi, limits) {
  const res = mappingCheck(metadata, mapping, box, ppi), b = res.boundsInches;
  const left = Math.round((box.x - b.x) * res.xPpi), top = Math.round((box.y - b.y) * res.yPpi);
  const right = Math.round((box.x + box.width - b.x) * res.xPpi), bottom = Math.round((box.y + box.height - b.y) * res.yPpi);
  const width = exactPixels(box.width, ppi), height = exactPixels(box.height, ppi);
  if (right - left < width || bottom - top < height) stop('panelprofile_source_crop_would_upscale');
  return sharp(bytes, { failOn: 'error', limitInputPixels: limits.maxPiecePixels, sequentialRead: true })
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().toColourspace('srgb');
}
async function relocatedLayer(bytes, asset, element, placement, box, ppi, limits) {
  const info = await assetInfo(bytes, asset, element, limits, ppi);
  const b = placement.after;
  const left = Math.round((b.x - box.x) * ppi), top = Math.round((b.y - box.y) * ppi);
  const width = exactPixels(box.width, ppi), height = exactPixels(box.height, ppi);
  const x = Math.max(0, left), y = Math.max(0, top), right = Math.min(width, left + info.width), bottom = Math.min(height, top + info.height);
  if (right <= x || bottom <= y) return null;
  let image = await sharp(bytes, { density: info.vector ? info.density : undefined, limitInputPixels: limits.maxPiecePixels })
    .resize(info.width, info.height, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  if (left !== x || top !== y || right - x !== info.width || bottom - y !== info.height) image = await sharp(image)
    .extract({ left: x - left, top: y - top, width: right - x, height: bottom - y }).png().toBuffer();
  return { input: image, left: x, top: y };
}

// Embed PNG's existing lossless RGB deflate stream directly into a simple
// deterministic PDF. No JPEG recompression, JavaScript, wall-clock timestamp,
// fonts from customer files, or hard-coded approval stamp enters the output.
function productionPdf(png, metadata, section, policy) {
  const signature = '89504e470d0a1a0a';
  if (png.subarray(0, 8).toString('hex') !== signature) stop('panelprofile_pdf_png_invalid');
  const idat = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > png.length) stop('panelprofile_pdf_png_invalid');
    if (type === 'IHDR' && (png[offset + 16] !== 8 || png[offset + 17] !== 2 || png[offset + 20] !== 0)) stop('panelprofile_pdf_rgb_required');
    if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  if (!idat.length || !metadata.icc?.length) stop('panelprofile_pdf_icc_required');
  const box = outputBox(section), rotate = section.rollRotationDegrees === 90;
  const width = n((rotate ? box.height : box.width) * 72 * policy.outputScale);
  const height = n((rotate ? box.width : box.height) * 72 * policy.outputScale);
  const bleed = n(5 * 72 * policy.outputScale);
  const stream = (dictionary, bytes) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')]);
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /BleedBox [0 0 ${width} ${height}] /TrimBox [${bleed} ${bleed} ${n(width - bleed)} ${n(height - bleed)}] /Resources << /XObject << /Art 4 0 R >> >> /Contents 6 0 R >>`),
    stream(`/Type /XObject /Subtype /Image /Width ${metadata.width} /Height ${metadata.height} /BitsPerComponent 8 /ColorSpace [/ICCBased 5 0 R] /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${metadata.width} >>`, Buffer.concat(idat)),
    stream('/N 3 /Alternate /DeviceRGB', metadata.icc),
    stream('', Buffer.from(`q\n${width} 0 0 ${height} 0 0 cm\n/Art Do\nQ\n`)),
    Buffer.from(`<< /Title (${section.sectionId} - TENTH SCALE) /Subject (1:10 drawing scale; enlarge to 1000 percent. Full-size print ${n(rotate ? box.height : box.width)} x ${n(rotate ? box.width : box.height)} inches including 5 inch bleed per edge.) /Creator (DesignProAI PanelProFileOutput) >>`),
  ];
  const parts = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary')], offsets = [0];
  let offset = parts[0].length;
  objects.forEach((body, i) => {
    const object = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    offsets.push(offset); parts.push(object); offset += object.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return Buffer.concat(parts);
}

async function writeArtifact(options, request, name, bytes, mimeType, role, pieceId, metadata = {}) {
  const contentHash = sha(bytes);
  const stored = await options.writeArtifact({ name, bytes, mimeType, role, pieceId, contentHash,
    metadata: { ...metadata, inputHash: request.inputHash, templateProfileHash: request.template.profileHash, templateGeometryHash: request.template.geometryHash } });
  if (!stored || typeof stored.storagePath !== 'string' || (stored.contentHash && stored.contentHash !== contentHash)) stop('panelprofile_artifact_persistence_invalid');
  // Storage transport facts (for example a retry's idempotent=true) must not
  // change the immutable artifact/receipt identity for the same saved bytes.
  return { storagePath: stored.storagePath, name, contentHash, byteSize: bytes.length, byteLength: bytes.length, mimeType, role, pieceId, metadata };
}

async function previewSet({ options, request, piece, piecePlan, geometry, firstPrintPath, sourceBytes, sourceMeta, limits }) {
  const box = { x: -5, y: -5, width: piece.outputWidthInches, height: piece.outputHeightInches };
  const scale = Math.min(1000 / box.width, 700 / box.height);
  const width = Math.max(1, Math.round(box.width * scale)), height = Math.max(1, Math.round(box.height * scale));
  const dx = Math.round(5 * scale), dy = dx, trimW = Math.round(piece.widthInches * scale), trimH = Math.round(piece.heightInches * scale);
  const display = await checkedRead(options.readBytes, request.template.display, limits.maxSourceBytes);
  const region = geometryFor(geometry, piece).displayRegionPixels;
  const template = await sharp(display).extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .resize(trimW, trimH, { fit: 'fill' }).png().toBuffer();
  const base = await sharp({ create: { width, height, channels: 3, background: '#f1f5f9' } })
    .composite([{ input: template, left: dx, top: dy }]).png().toBuffer();
  // The whole-piece preview is rebuilt from the same existing background and
  // placements, even when print sections have independent spool files.
  let after;
  if (piecePlan.sections.length === 1) after = await sharp(firstPrintPath).rotate(piecePlan.sections[0].rollRotationDegrees === 90 ? 270 : 0)
    .resize(width, height, { fit: 'fill' }).png().toBuffer();
  else {
    const source = usesSeparatedArtwork(piece, piecePlan) ? await checkedRead(options.readBytes, piece.composition.background, limits.maxSourceBytes) : sourceBytes;
    const mapping = usesSeparatedArtwork(piece, piecePlan) ? piece.composition.backgroundMapping : piece.sourceMapping;
    const meta = await rasterInfo(source, limits);
    const res = mappingCheck(meta, mapping, box, request.outputPolicy.fullSizePpi), b = res.boundsInches;
    const left = Math.round((box.x - b.x) * res.xPpi), top = Math.round((box.y - b.y) * res.yPpi);
    let image = sharp(source).extract({ left, top, width: Math.round(box.width * res.xPpi), height: Math.round(box.height * res.yPpi) }).resize(width, height, { fit: 'fill' });
    const overlays = [];
    if (usesSeparatedArtwork(piece, piecePlan)) for (const element of piece.protectedElements) {
      const asset = request.availableAssets.find((a) => a.assetId === element.assetId), placement = piecePlan.placements.find((p) => p.elementId === element.elementId);
      const bytes = await checkedRead(options.readBytes, asset, limits.maxSourceBytes);
      const raster = await sharp(bytes).resize(Math.max(1, Math.round(element.boundsInches.width * scale)), Math.max(1, Math.round(element.boundsInches.height * scale)), { fit: 'fill' }).png().toBuffer();
      overlays.push({ input: raster, left: Math.round((placement.after.x + 5) * scale), top: Math.round((placement.after.y + 5) * scale) });
    }
    after = await image.composite(overlays).png().toBuffer();
  }
  const reference = mappingCheck(sourceMeta, piece.sourceMapping, box, 0), refBounds = reference.boundsInches;
  const refLeft = Math.round((box.x - refBounds.x) * reference.xPpi), refTop = Math.round((box.y - refBounds.y) * reference.yPpi);
  const before = await sharp(sourceBytes).extract({ left: refLeft, top: refTop,
    width: Math.round((box.x + box.width - refBounds.x) * reference.xPpi) - refLeft,
    height: Math.round((box.y + box.height - refBounds.y) * reference.yPpi) - refTop })
    .resize(width, height, { fit: 'fill' }).png().toBuffer();
  const points = (polygon) => polygon.map(([x, y]) => `${n((x + 5) * scale)},${n((y + 5) * scale)}`).join(' ');
  const outline = `<polygon points="${points(piece.outlineInches)}" fill="none" stroke="#111827" stroke-width="2"/>`;
  const trim = `<rect x="${dx}" y="${dy}" width="${trimW}" height="${trimH}" fill="none" stroke="#15803d" stroke-width="2" stroke-dasharray="9 5"/>`;
  const masks = piece.cutAreas.map((cut) => `<polygon points="${points(cut.pointsInches)}" fill="#ef4444" fill-opacity="0.4" stroke="#991b1b" stroke-width="1.5"/>`).join('');
  const seams = piecePlan.seams.map((seam) => `<polygon points="${points(seam.pointsInches)}" fill="#f59e0b" fill-opacity="0.4" stroke="#a16207"/>`).join('');
  const placed = piecePlan.placements.map((p) => `<rect x="${n((p.after.x + 5) * scale)}" y="${n((p.after.y + 5) * scale)}" width="${n(p.after.width * scale)}" height="${n(p.after.height * scale)}" fill="none" stroke="#2563eb" stroke-width="2"/>`).join('');
  const svg = (contents) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${contents}</svg>`);
  const annotate = async (image, overlay) => sharp(image).composite([{ input: svg(overlay) }]).png({ compressionLevel: 6 }).toBuffer();
  const onTemplate = await sharp(base).composite([{ input: after, blend: 'multiply' }]).png().toBuffer();
  const overlay = await annotate(onTemplate, outline);
  const mask = await annotate(onTemplate, `${outline}${masks}${seams}${placed}`);
  const bleed = await annotate(after, `${outline}${trim}${seams}`);
  const compareWidth = width;
  const comparison = await sharp({ create: { width: compareWidth * 2, height: height + 40, channels: 3, background: '#fff' } })
    .composite([{ input: await sharp(before).resize(compareWidth, height, { fit: 'fill' }).png().toBuffer(), left: 0, top: 40 },
      { input: await sharp(mask).resize(compareWidth, height, { fit: 'fill' }).png().toBuffer(), left: compareWidth, top: 40 },
      { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${compareWidth * 2}" height="40"><text x="12" y="26" font-family="sans-serif" font-size="14">Original artwork</text><text x="${compareWidth + 12}" y="26" font-family="sans-serif" font-size="14">Proposed safe placement</text></svg>`), left: 0, top: 0 },
    ]).png().toBuffer();
  const proofWidth = Math.max(800, width);
  const label = `DesignProAI | ${piece.pieceId.slice(0, 64)} | PRODUCTION PANEL PROOF`;
  const dimensions = `Trim ${n(piece.widthInches)} x ${n(piece.heightInches)} in | Print ${n(piece.outputWidthInches)} x ${n(piece.outputHeightInches)} in | 5 in bleed on every edge`;
  const proof = await sharp({ create: { width: proofWidth, height: height + 84, channels: 3, background: '#fff' } }).composite([
    { input: bleed, left: Math.floor((proofWidth - width) / 2), top: 84 }, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${proofWidth}" height="84"><text x="12" y="24" font-family="sans-serif" font-size="14" fill="#111827">${xml(label)}</text><text x="12" y="46" font-family="sans-serif" font-size="12" fill="#111827">${xml(dimensions)}</text><text x="12" y="68" font-family="sans-serif" font-size="12" fill="#475569">Installation masks are review overlays. Print files retain continuous artwork.</text></svg>`), left: 0, top: 0 },
  ]).png().toBuffer();
  const rows = [['branded-template', base], ['template-overlay', overlay], ['installation-mask', mask], ['placement-comparison', comparison], ['bleed-preview', bleed], ['production-panel-proof', proof]];
  const result = [];
  for (const [role, bytes] of rows) result.push(await writeArtifact(options, request, `previews/${fileSegment(piece.pieceId)}/${role}.png`, bytes, 'image/png', role, piece.pieceId, {
    displayOrigin: 'generated-branded', geometryValidated: true, profileHash: request.template.profileHash,
    templateContentHash: request.template.display.contentHash,
    approved: true, approvalScope: 'validated-display-only', qcApproved: false,
    beforeAfterOrder: role === 'placement-comparison' ? ['original', 'proposed'] : undefined,
  }));
  return result;
}

async function renderPanelProFileOutput(input, options = {}) {
  if (typeof options.writeArtifact !== 'function') stop('panelprofile_artifact_writer_required');
  const request = buildPanelProFileOutputHandoff(input);
  const prepared = await preparePanelProFileOutput(request, options);
  if (prepared.blockers.length) return prepared;
  const limits = limitOptions(options.limits), pieces = selectedPieces(request, options.pieceIds);
  const receipts = [], allArtifacts = [];
  const directory = await mkdtemp(join(tmpdir(), 'panelpro-output-'));
  const progress = async (stage, pieceId, details = {}) => options.onProgress?.({ stage, pieceId, inputHash: request.inputHash, ...details });
  try {
    for (const piece of pieces) {
      const piecePlan = prepared.plan.pieces.find((p) => p.pieceId === piece.pieceId);
      await progress('panelprofileoutput.fit', piece.pieceId, { state: 'running' });
      const moved = usesSeparatedArtwork(piece, piecePlan);
      const sourceBytes = await checkedRead(options.readBytes, piece.source, limits.maxSourceBytes);
      const sourceMeta = await rasterInfo(sourceBytes, limits, { opaque: !moved });
      const renderBytes = moved ? await checkedRead(options.readBytes, piece.composition.background, limits.maxSourceBytes) : sourceBytes;
      const mapping = moved ? piece.composition.backgroundMapping : piece.sourceMapping;
      const metadata = moved ? await rasterInfo(renderBytes, limits, { opaque: true }) : sourceMeta;
      await progress('panelprofileoutput.protect', piece.pieceId, { state: 'verified', movedElementIds: piecePlan.placements.filter((p) => p.moved).map((p) => p.elementId) });
      const artifacts = [], sections = [];
      let firstPrintPath;
      for (const section of piecePlan.sections) {
        const box = outputBox(section), basePath = join(directory, `${fileSegment(section.sectionId)}.png`);
        const artifactBase = `${fileSegment(piece.pieceId)}/${fileSegment(section.sectionId)}`;
        let pipeline = cropPipeline(renderBytes, metadata, mapping, box, request.outputPolicy.fullSizePpi, limits);
        if (moved) {
          const layers = [];
          for (const element of piece.protectedElements) {
            const asset = request.availableAssets.find((a) => a.assetId === element.assetId);
            const layer = await relocatedLayer(await checkedRead(options.readBytes, asset, limits.maxSourceBytes), asset, element,
              piecePlan.placements.find((p) => p.elementId === element.elementId), box, request.outputPolicy.fullSizePpi, limits);
            if (layer) layers.push(layer);
          }
          pipeline = pipeline.composite(layers);
        }
        // Composite BEFORE feed rotation: the placement frame always remains
        // the reviewed full-size trim frame. Never mirror passenger artwork.
        const composedPath = join(directory, `${fileSegment(section.sectionId)}-composed.png`);
        await pipeline.png({ compressionLevel: 6, adaptiveFiltering: false, palette: false }).toFile(composedPath);
        await sharp(composedPath, { limitInputPixels: limits.maxPiecePixels }).rotate(section.rollRotationDegrees)
          .removeAlpha().toColourspace('srgb').withMetadata({ density: request.outputPolicy.fullSizePpi / request.outputPolicy.outputScale })
          .png({ compressionLevel: 6, adaptiveFiltering: false, palette: false }).toFile(basePath);
        firstPrintPath ||= basePath;
        await progress('panelprofileoutput.bleed', piece.pieceId, { state: 'rendered', sectionId: section.sectionId });
        const png = await readFile(basePath), pngMeta = await sharp(png).metadata();
        const expectedWidth = exactPixels(section.rollRotationDegrees === 90 ? box.height : box.width, request.outputPolicy.fullSizePpi);
        const expectedHeight = exactPixels(section.rollRotationDegrees === 90 ? box.width : box.height, request.outputPolicy.fullSizePpi);
        if (pngMeta.width !== expectedWidth || pngMeta.height !== expectedHeight || pngMeta.hasAlpha || !pngMeta.hasProfile
          || pngMeta.density !== request.outputPolicy.fullSizePpi / request.outputPolicy.outputScale) stop('panelprofile_output_verification_failed');
        const artifactMeta = { sectionId: section.sectionId, sourceSurfaceKey: piece.sourceSurfaceKey, trimBoundsInches: section.trimBoundsInches,
          widthPixels: pngMeta.width, heightPixels: pngMeta.height, fullSizePpi: request.outputPolicy.fullSizePpi,
          fileDpi: pngMeta.density, drawingScale: request.outputPolicy.outputScale, rollRotationDegrees: section.rollRotationDegrees,
          scaleLabel: 'TENTH SCALE', drawingScaleRatio: '1:10', printAtPercent: 1000,
          fullSizePrintDimensionsInches: { width: section.rollRotationDegrees === 90 ? box.height : box.width,
            height: section.rollRotationDegrees === 90 ? box.width : box.height },
          bleedInches: { top: 5, right: 5, bottom: 5, left: 5 }, colorSpace: 'sRGB', qcApproved: false };
        artifacts.push(await writeArtifact(options, request, `production/${artifactBase}_TENTH_SCALE.png`, png, 'image/png', 'production-png', piece.pieceId, artifactMeta));
        artifacts.push(await writeArtifact(options, request, `review/${artifactBase}-qc-copy.png`, png, 'image/png', 'qc-panel-copy', piece.pieceId, { ...artifactMeta, nonPrinting: true }));
        artifacts.push(await writeArtifact(options, request, `production/${artifactBase}_TENTH_SCALE.pdf`, productionPdf(png, pngMeta, section, request.outputPolicy), 'application/pdf', 'production-pdf', piece.pieceId, artifactMeta));
        const tiffPath = join(directory, `${fileSegment(section.sectionId)}.tiff`);
        await sharp(basePath, { limitInputPixels: limits.maxPiecePixels }).removeAlpha().toColourspace('srgb')
          .withMetadata({ density: pngMeta.density }).tiff({ compression: 'lzw', predictor: 'horizontal', bitdepth: 8 }).toFile(tiffPath);
        const tiff = await readFile(tiffPath), tiffMeta = await sharp(tiff).metadata();
        if (tiffMeta.width !== expectedWidth || tiffMeta.height !== expectedHeight || tiffMeta.hasAlpha || !tiffMeta.hasProfile || tiffMeta.density !== pngMeta.density) stop('panelprofile_output_verification_failed');
        artifacts.push(await writeArtifact(options, request, `production/${artifactBase}_TENTH_SCALE.tiff`, tiff, 'image/tiff', 'production-tiff', piece.pieceId, artifactMeta));
        sections.push({ ...section, output: artifactMeta });
        await rm(composedPath, { force: true }); await rm(tiffPath, { force: true });
        if (basePath !== firstPrintPath) await rm(basePath, { force: true });
      }
      const previews = await previewSet({ options, request, piece, piecePlan, geometry: prepared.geometry, firstPrintPath, sourceBytes, sourceMeta, limits });
      artifacts.push(...previews);
      for (const asset of request.availableAssets.filter((a) => piece.protectedElements.some((p) => p.assetId === a.assetId))) {
        const bytes = await checkedRead(options.readBytes, asset, limits.maxSourceBytes), [extension, mimeType] = assetFormat(bytes);
        artifacts.push(await writeArtifact(options, request, `assets/${fileSegment(asset.assetId)}/${asset.contentHash}.${extension}`, bytes,
          mimeType, 'reused-asset', piece.pieceId, { assetId: asset.assetId, sourceContentHash: asset.contentHash, sourceUnmodified: true, qcApproved: false }));
      }
      await progress('panelprofileoutput.proof', piece.pieceId, { state: 'rendered', previewRoles: previews.map((p) => p.role) });
      const receipt = { pieceId: piece.pieceId, sourceSurfaceKey: piece.sourceSurfaceKey,
        evidence: prepared.verifiedPieces.find((p) => p.pieceId === piece.pieceId).evidence,
        placements: piecePlan.placements, sections, artifacts,
        availableAssets: request.availableAssets.filter((a) => piece.protectedElements.some((p) => p.assetId === a.assetId)),
        status: 'awaiting_human_qc', qcApproved: false };
      receipts.push(receipt); allArtifacts.push(...artifacts);
      await rm(firstPrintPath, { force: true });
    }
    return { contractVersion: RENDER_CONTRACT, inputHash: request.inputHash,
      sourceApp: request.sourceApp, sourceJobId: request.sourceJobId, generationId: request.generationId,
      designId: request.designId, orderId: request.orderId, revisionId: request.revisionId, atlasRevisionId: request.atlasRevisionId,
      templateProfileHash: request.template.profileHash, templateGeometryHash: request.template.geometryHash,
      status: 'awaiting_human_qc', pieces: receipts, artifacts: allArtifacts,
      receiptHash: sha(Buffer.from(stable({ inputHash: request.inputHash, pieces: receipts }))),
      productionFilesCreated: true, qcApproved: false, releaseToCustomer: false };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
async function renderPanelProFileOutputPiece(input, pieceId, options) {
  return renderPanelProFileOutput(input, { ...options, pieceIds: [pieceId] });
}

module.exports = { RENDER_CONTRACT, GEOMETRY_CONTRACT, LIMITS, preparePanelProFileOutput, renderPanelProFileOutput, renderPanelProFileOutputPiece };
