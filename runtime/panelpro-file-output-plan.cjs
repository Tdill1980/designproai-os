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
function insideOutline(points, bounds) {
  const rect = corners(bounds);
  if (!rect.every((point) => contains(points, point))) return false;
  // A concave notch can enter a rectangle although all four corners are in the
  // body. Reject both proper edge crossings and interior boundary vertices.
  const properCross = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < -EPS
    && cross(c, d, a) * cross(c, d, b) < -EPS;
  if (points.some((a, i) => rect.some((c, j) => properCross(a, points[(i + 1) % points.length], c, rect[(j + 1) % 4])))) return false;
  return !points.some(([x, y]) => x > bounds.x + EPS && x < bounds.x + bounds.width - EPS
    && y > bounds.y + EPS && y < bounds.y + bounds.height - EPS);
}
function safe(bounds, piece, gap, others) {
  const padded = inflate(bounds, gap);
  if (padded.x < -EPS || padded.y < -EPS || padded.x + padded.width > piece.widthInches + EPS
    || padded.y + padded.height > piece.heightInches + EPS) return false;
  if (piece.outlineInches && !insideOutline(piece.outlineInches, padded)) return false;
  if (piece.cutAreas.some((cut) => hitsCut(cut.pointsInches, padded))) return false;
  return !others.some((other) => overlaps(padded, other));
}
function findPlacement(original, piece, gap, others, budget) {
  const obstacles = [...piece.cutAreas.map((cut) => polygonBox(cut.pointsInches)), ...others,
    ...(piece.outlineInches || []).map(([x, y]) => ({ x, y, width: 0, height: 0 }))];
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
  const costPerCheck = 4 + piece.cutAreas.reduce((sum, cut) => sum + cut.pointsInches.length, 0) + (piece.outlineInches?.length || 0) + others.length * 4;
  for (const candidate of candidates) {
    budget.remaining -= costPerCheck;
    if (budget.remaining < 0) return null;
    if (safe(candidate, piece, gap, others)) return candidate;
  }
  return null;
}

function sectionsFor(piece, printableWidthInches, ppi) {
  const rotation = piece.outputWidthInches <= printableWidthInches ? 0
    : piece.outputHeightInches <= printableWidthInches ? 90 : null;
  if (rotation != null) return { sections: [{ sectionId: piece.pieceId, trimBoundsInches: { x: 0, y: 0, width: piece.widthInches, height: piece.heightInches }, rollRotationDegrees: rotation }], seams: [], blockers: [] };
  const policy = piece.splitPolicy;
  const blocked = { sections: [], seams: [], blockers: [{ code: 'physical_panel_split_required' }] };
  if (!policy?.installerReviewed) return blocked;
  const span = policy.axis === 'x' ? piece.widthInches : piece.heightInches;
  const capacity = printableWidthInches - 10;
  const overlap = policy.overlapInches;
  if (capacity <= overlap || span <= overlap) return blocked;
  const spanPixels = Math.round(span * ppi), overlapPixels = Math.round(overlap * ppi), capacityPixels = Math.floor(capacity * ppi + EPS);
  if (Math.abs(span * ppi - spanPixels) > EPS || Math.abs(overlap * ppi - overlapPixels) > EPS || capacityPixels <= overlapPixels) return blocked;
  const count = Math.ceil((spanPixels - overlapPixels) / (capacityPixels - overlapPixels));
  if (count < 2 || count > 64) return blocked;
  const totalPixels = spanPixels + (count - 1) * overlapPixels;
  const basePixels = Math.floor(totalPixels / count), remainder = totalPixels % count;
  let offsetPixels = 0;
  // Distribute whole pixels, keeping the exact outer dimensions and overlap.
  // Equal floating-point thirds could otherwise invent fractional print pixels.
  const sections = Array.from({ length: count }, (_, i) => {
    const sizePixels = basePixels + (i < remainder ? 1 : 0), start = offsetPixels / ppi, size = sizePixels / ppi;
    offsetPixels += sizePixels - overlapPixels;
    return { sectionId: `${piece.pieceId}-s${String(i + 1).padStart(2, '0')}`,
      trimBoundsInches: policy.axis === 'x' ? { x: start, y: 0, width: size, height: piece.heightInches }
        : { x: 0, y: start, width: piece.widthInches, height: size },
      rollRotationDegrees: policy.axis === 'x' ? 0 : 90 };
  });
  const seams = sections.slice(1).map((section, i) => {
    const start = policy.axis === 'x' ? section.trimBoundsInches.x : section.trimBoundsInches.y;
    return { areaId: `print-seam-${i + 1}`, pointsInches: policy.axis === 'x'
      ? [[start, 0], [start + overlap, 0], [start + overlap, piece.heightInches], [start, piece.heightInches]]
      : [[0, start], [piece.widthInches, start], [piece.widthInches, start + overlap], [0, start + overlap]] };
  });
  return { sections, seams, blockers: [] };
}

function buildPanelProFileOutputPlan(input) {
  const request = buildPanelProFileOutputHandoff(input);
  const specifiedGap = request.outputPolicy.protectedClearanceInches;
  // Reserve one output pixel beyond the reviewed physical clearance. Raster
  // translation rounding must not move an otherwise safe edge into a cut.
  const gap = specifiedGap == null ? null : specifiedGap + 1 / request.outputPolicy.fullSizePpi;
  const pieces = request.pieces.map((piece) => {
    const split = sectionsFor(piece, request.outputPolicy.printableWidthInches, request.outputPolicy.fullSizePpi);
    const blockers = [...split.blockers];
    const searchBudget = { remaining: 2_000_000 };
    const placementPiece = { ...piece, cutAreas: [...piece.cutAreas, ...split.seams] };
    const placements = piece.protectedElements.map((element) => ({ ...element, before: { ...element.boundsInches }, after: { ...element.boundsInches }, moved: false }));
    if (gap == null) blockers.push({ code: 'clearance_profile_required' });
    for (const cut of piece.cutAreas) if (!simplePolygon(cut.pointsInches)) blockers.push({ code: 'cut_polygon_invalid', areaId: cut.areaId });
    if (piece.outlineInches && !simplePolygon(piece.outlineInches)) blockers.push({ code: 'outline_polygon_invalid' });
    if (!blockers.length) {
      for (const element of placements) {
        const others = placements.filter((p) => p !== element).map((p) => p.after);
        if (safe(element.after, placementPiece, gap, others)) continue;
        if (!element.canTranslate || !piece.composition?.layerSeparationVerified) {
          blockers.push({ code: 'protected_art_requires_layer_separation', elementId: element.elementId });
          continue;
        }
        const next = findPlacement(element.before, placementPiece, gap, others, searchBudget);
        if (!next) {
          blockers.push({ code: 'protected_art_has_no_safe_candidate', elementId: element.elementId });
          continue;
        }
        element.after = next;
        element.moved = true;
      }
      // Re-check the complete final arrangement, including elements that were
      // left in place. A partial successful move cannot hide another failure.
      for (const element of placements) if (!safe(element.after, placementPiece, gap, placements.filter((p) => p !== element).map((p) => p.after))) {
        if (!blockers.some((b) => b.elementId === element.elementId)) blockers.push({ code: 'protected_art_unsafe', elementId: element.elementId });
      }
    }
    const rollRotationDegrees = split.sections.length === 1 ? split.sections[0].rollRotationDegrees : null;
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
      sections: split.sections, seams: split.seams, blockers,
    };
  });
  return { contractVersion: 'designpro.panelpro-file-output-plan.v1', inputHash: request.inputHash,
    sourceApp: request.sourceApp, sourceJobId: request.sourceJobId, generationId: request.generationId,
    designId: request.designId, orderId: request.orderId, revisionId: request.revisionId, atlasRevisionId: request.atlasRevisionId,
    status: pieces.some((p) => p.blockers.length) ? 'requires_human_correction' : 'ready_for_human_review',
    pieces, productionFilesCreated: false, qcApproved: false, releaseToCustomer: false };
}

module.exports = { buildPanelProFileOutputPlan };
