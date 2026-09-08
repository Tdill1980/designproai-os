"use strict";

// Gemini recreates display artwork only. Reviewed inch geometry remains an
// immutable input. A human binds each recreated region to those measurements
// before it can enter the template bank or PanelProFileOutput manufacturing.
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const CONTRACT = 'designpro.panelpro-template-provider.v1';
const SOURCE_GEOMETRY_CONTRACT = 'designpro.vehicle-template-geometry.v1';
const OUTPUT_GEOMETRY_CONTRACT = 'designpro.panelpro-file-output-geometry.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const HASH = /^[a-f0-9]{64}$/;
const SYSTEM = 'Create a precise vehicle-template display from the supplied reference. Preserve the source view arrangement, contours and relative proportions. The application maintains all measured geometry independently and will inspect your display against it. The official brand reference sets presentation style. Return only clean line artwork with a plain background; the application adds the exact original brand in a separate header. This display never supplies manufacturing measurements or QC approval.';
const PROMPT = 'Recreate the first reference as a clean professional vehicle-template display. Keep every shown view and installation opening in the same relative position, with clear consistent line work. Use the second reference for restrained brand styling. Leave measurement labels and the brand header to the application.';
const stable = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const digest = (value) => sha(stable(value));
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
function checkedRef(ref) {
  if (!ref || !HASH.test(ref.contentHash) || typeof ref.storagePath !== 'string'
    || !/^[A-Za-z0-9._/-]+$/.test(ref.storagePath) || ref.storagePath.startsWith('/')
    || ref.storagePath.split('/').some((part) => !part || part === '..' || part === '.')) fail('template_artifact_identity_invalid');
  return { storagePath: ref.storagePath, contentHash: ref.contentHash };
}
async function read(ref, deps, maximum = 20 * 1024 * 1024) {
  checkedRef(ref);
  const bytes = Buffer.from(await deps.readBytes(ref));
  if (!bytes.length || bytes.length > maximum) fail('template_source_resource_limit');
  if (sha(bytes) !== ref.contentHash) fail('template_source_hash_mismatch');
  return bytes;
}
async function persist(bytes, role, mimeType, deps, identity, metadata = {}) {
  const contentHash = sha(bytes);
  const ref = await deps.persist(bytes, { role, mimeType, contentHash, ...identity, metadata });
  checkedRef(ref);
  if (ref.contentHash !== contentHash) fail('template_persisted_artifact_mismatch');
  return { storagePath: ref.storagePath, contentHash };
}
function polygon(value, width, height) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 1024
    || value.some((point) => !Array.isArray(point) || point.length !== 2
      || !point.every(Number.isFinite) || point[0] < 0 || point[1] < 0 || point[0] > width || point[1] > height)) fail('template_geometry_polygon_invalid');
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a, b, c) => Math.abs(cross(a, b, c)) < 1e-9 && c[0] >= Math.min(a[0], b[0])
    && c[0] <= Math.max(a[0], b[0]) && c[1] >= Math.min(a[1], b[1]) && c[1] <= Math.max(a[1], b[1]);
  let area = 0;
  for (let i = 0; i < value.length; i += 1) {
    const a = value[i], b = value[(i + 1) % value.length];
    if (a[0] === b[0] && a[1] === b[1]) fail('template_geometry_polygon_invalid');
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 2; j < value.length; j += 1) {
      if (i === 0 && j === value.length - 1) continue;
      const c = value[j], d = value[(j + 1) % value.length];
      if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
        || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) fail('template_geometry_polygon_invalid');
    }
  }
  if (Math.abs(area) < 1e-9) fail('template_geometry_polygon_invalid');
  return value.map((point) => [...point]);
}
function validateGeometry(geometry, input) {
  if (geometry?.contractVersion !== SOURCE_GEOMETRY_CONTRACT || geometry.units !== 'in'
    || geometry.templateId !== input.templateId || geometry.version !== input.version
    || !Array.isArray(geometry.pieces) || !geometry.pieces.length || geometry.pieces.length > 128) fail('template_reviewed_geometry_required');
  const vehicle = geometry.vehicle;
  if (!vehicle || !['make', 'model', 'year', 'bodyStyle'].every((key) => typeof vehicle[key] === 'string' && vehicle[key].trim())) fail('template_vehicle_variant_required');
  const pointBudget = geometry.pieces.reduce((sum, piece) => sum + (Array.isArray(piece?.outlineInches) ? piece.outlineInches.length : 0)
    + (Array.isArray(piece?.cutAreas) ? piece.cutAreas.reduce((count, cut) => count + (Array.isArray(cut?.pointsInches) ? cut.pointsInches.length : 0), 0) : 0), 0);
  if (pointBudget > 16384) fail('template_geometry_complexity_invalid');
  let points = 0;
  const pieces = geometry.pieces.map((piece) => {
    const { pieceId, widthInches, heightInches } = piece;
    if (!ID.test(pieceId) || ![widthInches, heightInches].every((value) => Number.isFinite(value) && value > 0 && value <= 10000)
      || !Array.isArray(piece.cutAreas) || piece.cutAreas.length > 64) fail('template_geometry_piece_invalid');
    const outlineInches = polygon(piece.outlineInches, widthInches, heightInches);
    const cutAreas = piece.cutAreas.map((cut) => {
      if (!ID.test(cut.areaId)) fail('template_geometry_cut_invalid');
      return { areaId: cut.areaId, pointsInches: polygon(cut.pointsInches, widthInches, heightInches) };
    });
    if (new Set(cutAreas.map((cut) => cut.areaId)).size !== cutAreas.length) fail('template_geometry_duplicate_cut');
    points += outlineInches.length + cutAreas.reduce((count, cut) => count + cut.pointsInches.length, 0);
    return { pieceId, widthInches, heightInches, outlineInches, cutAreas };
  });
  if (points > 16384 || new Set(pieces.map((piece) => piece.pieceId)).size !== pieces.length) fail('template_geometry_complexity_invalid');
  return { contractVersion: SOURCE_GEOMETRY_CONTRACT, units: 'in', templateId: input.templateId, version: input.version, vehicle: structuredClone(vehicle), pieces };
}
async function imageReference(ref, deps, { allowVector = false } = {}) {
  const bytes = await read(ref, deps);
  const prefix = bytes.subarray(0, 1024).toString('utf8');
  if (prefix.startsWith('%PDF-') || prefix.startsWith('%!PS')) fail('template_reviewed_raster_derivative_required');
  const raster = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    || (bytes[0] === 0xff && bytes[1] === 0xd8)
    || (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
  if (!raster) {
    const svg = bytes.toString('utf8');
    if (!allowVector || !/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(svg)
      || /<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|@import|\burl\s*\(|\b(?:href|src)\s*=/i.test(svg)) fail('template_self_contained_brand_required');
  }
  let meta;
  try { meta = await sharp(bytes, { limitInputPixels: 32_000_000 }).metadata(); }
  catch { fail('template_source_decode_failed'); }
  if (!(meta.width > 0 && meta.height > 0) || (meta.pages || 1) !== 1
    || !['png', 'jpeg', 'webp', ...(allowVector ? ['svg'] : [])].includes(meta.format)
    || (meta.orientation && meta.orientation !== 1)) fail('template_source_format_invalid');
  const png = meta.format === 'svg' ? await sharp(bytes, { density: 144, limitInputPixels: 32_000_000 })
    .resize({ width: 1024, height: 1024, fit: 'inside' }).png().toBuffer() : bytes;
  return { bytes: png, mimeType: meta.format === 'jpeg' ? 'image/jpeg' : meta.format === 'webp' ? 'image/webp' : 'image/png' };
}

async function brandDisplay(recreated, brandBytes) {
  const metadata = await sharp(recreated, { limitInputPixels: 32_000_000 }).metadata();
  if (metadata.format !== 'png' || !metadata.width || !metadata.height || (metadata.pages || 1) !== 1) fail('template_generated_display_invalid');
  const headerHeight = Math.max(64, Math.round(metadata.width * 0.08));
  if (metadata.width * (metadata.height + headerHeight) > 32_000_000) fail('template_generated_display_resource_limit');
  const margin = Math.max(8, Math.round(headerHeight * 0.15));
  const logo = await sharp(brandBytes, { limitInputPixels: 32_000_000 })
    .resize({ width: Math.max(1, metadata.width - 2 * margin), height: headerHeight - 2 * margin, fit: 'inside' }).png().toBuffer();
  const bytes = await sharp(recreated, { limitInputPixels: 32_000_000 })
    .extend({ top: headerHeight, bottom: 0, left: 0, right: 0, background: '#ffffff' })
    .composite([{ input: logo, top: margin, left: margin }]).png().toBuffer();
  return { bytes, width: metadata.width, height: metadata.height + headerHeight, headerHeight };
}

/** Call only with server-resolved review records and owner-scoped IO adapters. */
async function recreateBrandedTemplateCandidate(input, deps) {
  if (!deps || !['readBytes', 'persist', 'authorize', 'invoke', 'resolveGeometryReview'].every((key) => typeof deps[key] === 'function')) fail('template_provider_dependencies_required');
  if (!input || !UUID.test(input.ownerId) || !UUID.test(input.requestId) || !UUID.test(input.generationId)
    || !ID.test(input.templateId) || !ID.test(input.version)) fail('template_provider_identity_invalid');
  await deps.authorize({ operation: 'template.recreate', ownerId: input.ownerId });
  checkedRef(input.geometry); checkedRef(input.sourceRaster); checkedRef(input.brand);
  const geometryBytes = await read(input.geometry, deps, 4 * 1024 * 1024);
  let sourceGeometry;
  try { sourceGeometry = JSON.parse(geometryBytes.toString('utf8')); } catch { fail('template_geometry_json_invalid'); }
  const geometry = validateGeometry(sourceGeometry, input);
  const review = await deps.resolveGeometryReview({ ownerId: input.ownerId, reviewId: input.geometryReview?.reviewId, geometryHash: input.geometry.contentHash });
  if (!review || review.ownerId !== input.ownerId || review.geometryHash !== input.geometry.contentHash
    || review.geometryValidated !== true || review.cutAreasReviewed !== true || !ID.test(review.reviewId)) fail('template_geometry_review_required');
  const cacheKey = digest({ contractVersion: CONTRACT, ownerId: input.ownerId, templateId: input.templateId, version: input.version,
    geometryHash: input.geometry.contentHash, sourceRasterHash: input.sourceRaster.contentHash, brandHash: input.brand.contentHash });
  const bank = typeof deps.lookupValidatedTemplate === 'function' ? await deps.lookupValidatedTemplate({ ownerId: input.ownerId, cacheKey }) : null;
  if (bank) {
    if (bank.ownerId !== input.ownerId || bank.cacheKey !== cacheKey || bank.status !== 'validated'
      || bank.template?.geometryValidated !== true || bank.template?.cutAreasReviewed !== true
      || bank.template?.displayOrigin !== 'generated-branded' || bank.template.templateId !== input.templateId
      || bank.template.version !== input.version || bank.template.geometryHash !== bank.template.geometry?.contentHash) fail('template_bank_entry_invalid');
    const finalGeometry = JSON.parse((await read(bank.template.geometry, deps, 4 * 1024 * 1024)).toString('utf8'));
    if (finalGeometry.contractVersion !== OUTPUT_GEOMETRY_CONTRACT || finalGeometry.templateId !== input.templateId
      || finalGeometry.version !== input.version || finalGeometry.displayContentHash !== bank.template.display.contentHash
      || finalGeometry.provenance?.sourceGeometryHash !== input.geometry.contentHash
      || !Array.isArray(finalGeometry.pieces)
      || stable(finalGeometry.pieces.map(({ displayRegionPixels: _mapping, ...piece }) => piece)) !== stable(geometry.pieces)) fail('template_bank_entry_invalid');
    await read(bank.template.display, deps);
    return { ...bank, cacheHit: true, providerImageRequestCount: 0 };
  }
  const [source, brand] = await Promise.all([imageReference(input.sourceRaster, deps), imageReference(input.brand, deps, { allowVector: true })]);
  const [interactions, cache] = await Promise.all([
    import(pathToFileURL(resolve(__dirname, '../supabase/functions/_shared/gemini-image-interactions.mjs')).href),
    import(pathToFileURL(resolve(__dirname, '../supabase/functions/_shared/gemini-provider-cache.mjs')).href),
  ]);
  const nativeRequest = interactions.buildGeminiImageInteractionRequest({
    enabled: input.enabled === true, purpose: 'branded-template-preview', systemInstruction: SYSTEM,
    input: [{ type: 'text', text: PROMPT }, { type: 'image', mime_type: source.mimeType, data: source.bytes.toString('base64') },
      { type: 'image', mime_type: brand.mimeType, data: brand.bytes.toString('base64') }],
    imageSize: '4K', generationConfig: { thinking_summaries: 'none' },
  });
  const nativeJson = JSON.stringify(nativeRequest);
  const result = await cache.runDurableImageProviderRequest({
    bucket: deps.providerCacheBucket,
    identity: { ownerId: input.ownerId, requestId: input.requestId, generationId: input.generationId,
      mode: 'template-recreate', attemptKey: input.attemptKey || `template:${cacheKey}` },
    requestHash: digest({ contractVersion: CONTRACT, cacheKey, nativeRequest }), privateRequest: nativeJson,
    authorize: () => deps.authorize({ operation: 'template.recreate', ownerId: input.ownerId }),
    invoke: () => deps.invoke(nativeRequest), cacheOnly: input.cacheOnly === true,
  });
  const image = interactions.extractFinalInteractionImage(result.payload);
  const recreated = Buffer.from(image.data, 'base64');
  const branded = await brandDisplay(recreated, brand.bytes);
  const identity = { ownerId: input.ownerId, requestId: input.requestId, generationId: input.generationId };
  const recreatedRef = await persist(recreated, 'recreated-template-candidate', 'image/png', deps, identity, { customerVisible: false });
  const display = await persist(branded.bytes, 'generated-branded-template-candidate', 'image/png', deps, identity, { customerVisible: false });
  const candidate = {
    contractVersion: CONTRACT, ...identity, cacheKey, templateId: input.templateId, version: input.version,
    status: 'requires_geometry_overlay_review', displayOrigin: 'generated-branded-candidate', customerVisible: false,
    sourceGeometry: checkedRef(input.geometry), sourceGeometryReviewId: review.reviewId,
    sourceReview: { fitToleranceInches: review.fitToleranceInches ?? null,
      physicalMeasurementReference: review.physicalMeasurementReference ?? null },
    sourceRaster: checkedRef(input.sourceRaster), brand: checkedRef(input.brand), recreated: recreatedRef, display,
    displayMetadata: { width: branded.width, height: branded.height, headerHeight: branded.headerHeight },
    geometry, provider: { contractVersion: interactions.GEMINI_IMAGE_INTERACTIONS_CONTRACT, model: interactions.GEMINI_PRO_IMAGE_MODEL,
      interactionId: image.interactionId, providerRequestKey: result.providerRequestKey, providerCacheHit: result.providerCacheHit },
    geometryValidated: false, cutAreasReviewed: false, releaseToCustomer: false,
  };
  const candidateHash = digest(candidate);
  const candidateRef = await persist(Buffer.from(stable({ ...candidate, candidateHash })), 'template-candidate-receipt', 'application/json', deps, identity);
  return { ...candidate, candidateHash, candidateRef, cacheHit: false, providerImageRequestCount: result.providerCacheHit ? 0 : 1 };
}

/** The authorized review binds final display pixels to immutable inch pieces. */
async function approveAndBankTemplateCandidate(input, deps) {
  if (!deps || !['authorize', 'readBytes', 'persist', 'bankTemplate'].every((key) => typeof deps[key] === 'function')) fail('template_bank_dependencies_required');
  const permission = await deps.authorize({ operation: 'template.review', ownerId: input.ownerId });
  if (!permission?.canReview || !UUID.test(permission.reviewerId)) fail('template_review_permission_required');
  const stored = JSON.parse((await read(input.candidateRef, deps, 4 * 1024 * 1024)).toString('utf8'));
  const { candidateHash, ...candidate } = stored;
  if (candidate.contractVersion !== CONTRACT || candidate.ownerId !== input.ownerId || candidateHash !== digest(candidate)
    || candidate.status !== 'requires_geometry_overlay_review') fail('template_candidate_identity_invalid');
  const review = input.review;
  if (!review || !ID.test(review.reviewId) || review.approved !== true || review.displayContentHash !== candidate.display.contentHash
    || review.geometryHash !== candidate.sourceGeometry.contentHash || review.cutGeometryReviewed !== true
    || review.displayAlignmentReviewed !== true || !Array.isArray(review.displayRegions)) fail('template_display_review_required');
  const sourceGeometry = validateGeometry(JSON.parse((await read(candidate.sourceGeometry, deps, 4 * 1024 * 1024)).toString('utf8')), candidate);
  if (stable(sourceGeometry) !== stable(candidate.geometry)) fail('template_source_geometry_changed');
  const displayBytes = await read(candidate.display, deps);
  const metadata = await sharp(displayBytes, { limitInputPixels: 32_000_000 }).metadata();
  if (metadata.width !== candidate.displayMetadata.width || metadata.height !== candidate.displayMetadata.height) fail('template_display_identity_invalid');
  if (review.displayRegions.length !== sourceGeometry.pieces.length || new Set(review.displayRegions.map((region) => region.pieceId)).size !== sourceGeometry.pieces.length) fail('template_display_regions_required');
  const pieces = sourceGeometry.pieces.map((piece) => {
    const b = review.displayRegions.find((region) => region.pieceId === piece.pieceId)?.displayRegionPixels;
    if (!b || !['x', 'y', 'width', 'height'].every((key) => Number.isInteger(b[key])) || b.x < 0
      || b.y < candidate.displayMetadata.headerHeight || b.width < 1 || b.height < 1
      || b.x + b.width > metadata.width || b.y + b.height > metadata.height) fail('template_display_region_invalid');
    return { ...piece, displayRegionPixels: { x: b.x, y: b.y, width: b.width, height: b.height } };
  });
  const geometry = {
    contractVersion: OUTPUT_GEOMETRY_CONTRACT, units: 'in', templateId: candidate.templateId, version: candidate.version,
    displayContentHash: candidate.display.contentHash, vehicle: sourceGeometry.vehicle, pieces,
    provenance: { sourceGeometryHash: candidate.sourceGeometry.contentHash, sourceGeometryReviewId: candidate.sourceGeometryReviewId,
      candidateHash, reviewId: review.reviewId, reviewedBy: permission.reviewerId,
      fitToleranceInches: candidate.sourceReview?.fitToleranceInches ?? null,
      physicalMeasurementReference: candidate.sourceReview?.physicalMeasurementReference ?? null },
  };
  const identity = { ownerId: input.ownerId, requestId: candidate.requestId, generationId: candidate.generationId };
  // Only this explicit reviewed path promotes a display to the renderer's
  // approved namespace. Candidate storage remains private throughout creation.
  const displayRef = await persist(displayBytes, 'validated-template-display', 'image/png', deps, identity);
  const geometryRef = await persist(Buffer.from(stable(geometry)), 'validated-template-geometry', 'application/json', deps, identity);
  const template = {
    templateId: candidate.templateId, version: candidate.version,
    profileHash: digest({ contractVersion: CONTRACT, geometryHash: geometryRef.contentHash, display: displayRef,
      sourceGeometryHash: candidate.sourceGeometry.contentHash, brand: candidate.brand }),
    geometryHash: geometryRef.contentHash, geometry: geometryRef, display: displayRef,
    displayOrigin: 'generated-branded', geometryValidated: true, cutAreasReviewed: true,
  };
  const entry = { ownerId: input.ownerId, cacheKey: candidate.cacheKey, status: 'validated', template,
    sourceGeometryHash: candidate.sourceGeometry.contentHash, reviewedBy: permission.reviewerId, reviewId: review.reviewId };
  await deps.bankTemplate(entry);
  return entry;
}

module.exports = { CONTRACT, SOURCE_GEOMETRY_CONTRACT, OUTPUT_GEOMETRY_CONTRACT,
  validateTemplateSourceGeometry: validateGeometry, validateTemplateImageReference: imageReference,
  recreateBrandedTemplateCandidate, approveAndBankTemplateCandidate };
