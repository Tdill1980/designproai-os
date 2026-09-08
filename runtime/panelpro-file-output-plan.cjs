"use strict";

// The deterministic planning core of the NEW shared app. It produces explicit
// transforms for existing assets; it neither fabricates pixels nor grants QC.
const { buildPanelProFileOutputHandoff } = require("./panelpro-file-output-contract.cjs");
const EPS = 1e-8;
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) <= EPS
  && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
  && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
function segmentsIntersect(a, b, c, d) {
  if (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return true;
  return (cross(a, b, c) > 0) !== (cross(a, b, d) > 0)
    && (cross(c, d, a) > 0) !== (cross(c, d, b) > 0);
}
function simplePolygon(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPS) return false;
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (segmentsIntersect(a, b, points[j], points[(j + 1) % points.length])) return false;
    }
  }
  return Math.abs(area) > EPS;
}
function contains(points, point) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (onSegment(a, b, point)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const corners = (b) => [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]];
const inflate = (b, gap) => ({ x: b.x - gap, y: b.y - gap, width: b.width + 2 * gap, height: b.height + 2 * gap });
const overlaps = (a, b) => a.x < b.x + b.width - EPS && a.x + a.width > b.x + EPS
  && a.y < b.y + b.height - EPS && a.y + a.height > b.y + EPS;
function polygonBox(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
function hitsCut(points, bounds) {
  const rect = corners(bounds);
  if (points.some((p) => contains(rect, p)) || rect.some((p) => contains(points, p))) return true;
  return points.some((a, i) => rect.some((c, j) => segmentsIntersect(a, points[(i + 1) % points.length], c, rect[(j + 1) % 4])));
}
function safe(bounds, piece, gap, others) {
  const padded = inflate(bounds, gap);
  if (padded.x < -EPS || padded.y < -EPS || padded.x + padded.width > piece.widthInches + EPS
    || padded.y + padded.height > piece.heightInches + EPS) return false;
  if (piece.cutAreas.some((cut) => hitsCut(cut.pointsInches, padded))) return false;
  return !others.some((other) => overlaps(padded, other));
}
function findPlacement(original, piece, gap, others) {
  const obstacles = [...piece.cutAreas.map((cut) => polygonBox(cut.pointsInches)), ...others];
  // Bounded, repeatable candidates around obstacle edges. This is deliberately
  // conservative: no result means human correction, not "no possible layout".
  const axis = (key, size, limit) => [...new Set([
    original[key], gap, limit - gap - original[size],
    ...obstacles.flatMap((b) => [b[key] - gap - original[size] - 1e-6, b[key] + b[size] + gap + 1e-6]),
  ])].filter((n) => n >= gap - EPS && n + original[size] <= limit - gap + EPS)
    .sort((a, b) => Math.abs(a - original[key]) - Math.abs(b - original[key]) || a - b).slice(0, 64);
  const candidates = axis('x', 'width', piece.widthInches).flatMap((x) => axis('y', 'height', piece.heightInches).map((y) => ({ ...original, x, y })));
  const cost = (b) => (b.x - original.x) ** 2 + (b.y - original.y) ** 2;
  candidates.sort((a, b) => cost(a) - cost(b) || a.x - b.x || a.y - b.y);
  return candidates.find((candidate) => safe(candidate, piece, gap, others)) || null;
}

function buildPanelProFileOutputPlan(input) {
  const request = buildPanelProFileOutputHandoff(input);
  const gap = request.outputPolicy.protectedClearanceInches;
  const pieces = request.pieces.map((piece) => {
    const blockers = [];
    const placements = piece.protectedElements.map((element) => ({ ...element, before: { ...element.boundsInches }, after: { ...element.boundsInches }, moved: false }));
    if (gap == null) blockers.push({ code: 'clearance_profile_required' });
    for (const cut of piece.cutAreas) if (!simplePolygon(cut.pointsInches)) blockers.push({ code: 'cut_polygon_invalid', areaId: cut.areaId });
    if (!blockers.length) {
      for (const element of placements) {
        const others = placements.filter((p) => p !== element).map((p) => p.after);
        if (safe(element.after, piece, gap, others)) continue;
        if (!element.canTranslate || !piece.composition?.layerSeparationVerified) {
          blockers.push({ code: 'protected_art_requires_layer_separation', elementId: element.elementId });
          continue;
        }
        const next = findPlacement(element.before, piece, gap, others);
        if (!next) {
          blockers.push({ code: 'protected_art_has_no_safe_candidate', elementId: element.elementId });
          continue;
        }
        element.after = next;
        element.moved = true;
      }
      // Re-check the complete final arrangement, including elements that were
      // left in place. A partial successful move cannot hide another failure.
      for (const element of placements) if (!safe(element.after, piece, gap, placements.filter((p) => p !== element).map((p) => p.after))) {
        if (!blockers.some((b) => b.elementId === element.elementId)) blockers.push({ code: 'protected_art_unsafe', elementId: element.elementId });
      }
    }
    const rollRotationDegrees = piece.outputWidthInches <= request.outputPolicy.printableWidthInches ? 0
      : piece.outputHeightInches <= request.outputPolicy.printableWidthInches ? 90 : null;
    if (rollRotationDegrees == null) blockers.push({ code: 'physical_panel_split_required' });
    return {
      pieceId: piece.pieceId, sourceSurfaceKey: piece.sourceSurfaceKey,
      placementStatus: blockers.length ? 'requires_human_correction' : 'ready_for_human_review',
      placements: placements.map((p) => ({ elementId: p.elementId, assetId: p.assetId, before: p.before, after: p.after, moved: p.moved,
        transform: { translateXInches: p.after.x - p.before.x, translateYInches: p.after.y - p.before.y, scale: 1, rotationDegrees: 0, mirror: false } })),
      output: { widthInches: piece.outputWidthInches, heightInches: piece.outputHeightInches, bleedInches: piece.bleedInches,
        targetPixelWidth: Math.ceil(piece.outputWidthInches * request.outputPolicy.fullSizePpi),
        targetPixelHeight: Math.ceil(piece.outputHeightInches * request.outputPolicy.fullSizePpi),
        drawingScale: request.outputPolicy.outputScale, drawingPpi: request.outputPolicy.fullSizePpi / request.outputPolicy.outputScale,
        rollRotationDegrees, bleedContentVerification: 'required', sourceResolutionVerification: 'required' },
      blockers,
    };
  });
  return { contractVersion: 'designpro.panelpro-file-output-plan.v1', inputHash: request.inputHash,
    sourceApp: request.sourceApp, sourceJobId: request.sourceJobId, generationId: request.generationId,
    designId: request.designId, orderId: request.orderId, revisionId: request.revisionId,
    status: pieces.some((p) => p.blockers.length) ? 'requires_human_correction' : 'ready_for_human_review',
    pieces, productionFilesCreated: false, qcApproved: false, releaseToCustomer: false };
}

module.exports = { buildPanelProFileOutputPlan };
