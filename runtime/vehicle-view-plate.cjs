"use strict";

/**
 * Phase 4: the vehicle view plate contract.
 *
 * The 3D proof is a photograph of a vehicle with the customer's artwork put
 * where the vinyl goes. The artwork comes from the six authoritative production
 * surfaces and from nowhere else. Everything the *vehicle* contributes —
 * silhouette, body curvature, light, reflection, the shape of the panel the
 * wrap lands on — comes from a plate: a pinned, content-addressed set of images
 * cut once for a vehicle and reused for every design on it.
 *
 * This is the direction reversal applied to the 3D view. The retired path asked
 * an image model to draw a wrapped vehicle, which meant the picture was the
 * only record of what the wrap looked like, and the artwork had to be
 * reconstructed back out of it. Here the artwork already exists and is already
 * authoritative; the plate only says where on the vehicle to put it. A plate
 * cannot invent a string, cannot move a logo, and cannot change a dimension,
 * because it carries no artwork at all.
 *
 * WHAT A PLATE MAY NOT DO. It may not be fitted, solved for, or estimated from
 * a render at build time. Every mesh point is declared. Fitting a warp to an
 * image is the same inverse problem that made Call 8 unsafe: it always returns
 * an answer, and nothing downstream can tell a right answer from a wrong one.
 *
 * PHASE 4 SCOPE. Proof generation only. Nothing is wired to a stage, no schema
 * changes, and Call 8 keeps production authority.
 */

const { createHash } = require("node:crypto");
const { SURFACE_KEYS } = require("./design-master.cjs");

const VIEW_PLATE_CONTRACT = "designpro.vehicle-view-plates.v1";

// A flank view shows one side of the vehicle. Which side is not cosmetic: the
// passenger surface is composed with mirrored placement, so painting it onto a
// left-facing plate reproduces exactly the defect that started this work — a
// vehicle showing the driver composition twice, with the text re-rendered.
const HANDEDNESS = Object.freeze(["left", "right", "none"]);
const FLANK_HANDEDNESS = Object.freeze({ driver: "left", passenger: "right" });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const VIEW_KEY_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

// A mesh finer than this is not expressive, it is a fitted surface wearing a
// contract, and it is also a rendering cost with no ceiling.
const MAX_MESH_ROWS = 64;
const MAX_MESH_COLS = 64;

class ViewPlateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ViewPlateError";
  }
}

function fail(code, message) {
  throw new ViewPlateError(code, message);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

/** The plate set's identity. Never includes plateSetHash itself. */
function viewPlateHash(plates) {
  const { plateSetHash, ...authoritative } = plates || {};
  return createHash("sha256").update(Buffer.from(JSON.stringify(canonical(authoritative)))).digest("hex");
}

function requireUuid(value, label) {
  const text = String(value || "").trim().toLowerCase();
  if (!UUID_RE.test(text)) fail("plate_uuid_invalid", `${label} must be a UUID`);
  return text;
}

function requireHash(value, label) {
  const text = String(value || "").trim().toLowerCase();
  if (!HASH_RE.test(text)) fail("plate_hash_invalid", `${label} must be a sha256 hex digest`);
  return text;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("plate_object_invalid", `${label} must be an object`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value) || !value.length) fail("plate_array_invalid", `${label} must be a non-empty array`);
  return value;
}

function requireInteger(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    fail("plate_integer_invalid", `${label} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function requireFinite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail("plate_number_invalid", `${label} must be a finite number`);
  return number;
}

/** A pinned image: an id to load it by and the digest it must hash to. */
function validateImage(image, label) {
  const object = requireObject(image, label);
  return {
    assetId: String(object.assetId || "").trim() || fail("plate_asset_id_missing", `${label}.assetId is required`),
    contentHash: requireHash(object.contentHash, `${label}.contentHash`),
  };
}

/**
 * The mesh that carries one surface onto one panel of one view.
 *
 * (u,v) addresses the surface's *trim* rectangle — the vinyl the customer
 * actually sees, with bleed already excluded — and (x,y) addresses the plate
 * frame. Corners are row-major from the surface's top-left.
 */
function validateMesh(mesh, label, frame) {
  const object = requireObject(mesh, label);
  const rows = requireInteger(object.rows, `${label}.rows`, { min: 1, max: MAX_MESH_ROWS });
  const cols = requireInteger(object.cols, `${label}.cols`, { min: 1, max: MAX_MESH_COLS });
  const points = requireArray(object.points, `${label}.points`);
  if (points.length !== (rows + 1) * (cols + 1)) {
    fail("plate_mesh_incomplete", `${label} declares ${rows}x${cols} but carries ${points.length} points, not ${(rows + 1) * (cols + 1)}`);
  }

  const validated = points.map((point, index) => {
    const where = `${label}.points[${index}]`;
    const u = requireFinite(point?.u, `${where}.u`);
    const v = requireFinite(point?.v, `${where}.v`);
    const x = requireFinite(point?.x, `${where}.x`);
    const y = requireFinite(point?.y, `${where}.y`);
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      fail("plate_mesh_uv_out_of_range", `${where} samples (${u}, ${v}), outside the surface it claims to show`);
    }
    if (x < 0 || x > frame.widthPx || y < 0 || y > frame.heightPx) {
      fail("plate_mesh_point_outside_frame", `${where} lands at (${x}, ${y}), outside the ${frame.widthPx}x${frame.heightPx} frame`);
    }
    return { u, v, x, y };
  });

  // Every cell must enclose real area with a consistent winding. A folded or
  // collapsed cell has no single inverse, so a destination pixel inside it
  // could be sampled from two places in the artwork, and which one won would
  // depend on the order the solver happened to return its roots.
  let winding = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const p00 = validated[row * (cols + 1) + col];
      const p10 = validated[row * (cols + 1) + col + 1];
      const p01 = validated[(row + 1) * (cols + 1) + col];
      const p11 = validated[(row + 1) * (cols + 1) + col + 1];
      // Shoelace over p00 -> p10 -> p11 -> p01.
      const area = (p00.x * p10.y - p10.x * p00.y)
        + (p10.x * p11.y - p11.x * p10.y)
        + (p11.x * p01.y - p01.x * p11.y)
        + (p01.x * p00.y - p00.x * p01.y);
      if (area === 0) fail("plate_mesh_cell_degenerate", `${label} cell ${row},${col} encloses no area`);
      const sign = area > 0 ? 1 : -1;
      if (winding === 0) winding = sign;
      else if (sign !== winding) fail("plate_mesh_cell_folded", `${label} cell ${row},${col} folds back on the cells beside it`);
    }
  }
  return { rows, cols, points: validated };
}

function validatePanel(panel, label, frame) {
  const object = requireObject(panel, label);
  const surfaceKey = String(object.surfaceKey || "").trim().toLowerCase();
  if (!SURFACE_KEYS.includes(surfaceKey)) {
    fail("plate_panel_surface_unknown", `${label}.surfaceKey must be one of ${SURFACE_KEYS.join(", ")}`);
  }
  return {
    surfaceKey,
    mask: validateImage(object.mask, `${label}.mask`),
    mesh: validateMesh(object.mesh, `${label}.mesh`, frame),
  };
}

function validateView(view, label, frame) {
  const object = requireObject(view, label);
  const viewKey = String(object.viewKey || "").trim().toLowerCase();
  if (!VIEW_KEY_RE.test(viewKey)) fail("plate_view_key_invalid", `${label}.viewKey must be a short lowercase token`);
  const handedness = String(object.handedness || "").trim().toLowerCase();
  if (!HANDEDNESS.includes(handedness)) fail("plate_view_handedness_invalid", `${label}.handedness must be one of ${HANDEDNESS.join(", ")}`);

  const panels = requireArray(object.panels, `${label}.panels`).map((panel, index) => validatePanel(panel, `${label}.panels[${index}]`, frame));
  const seen = new Set();
  for (const panel of panels) {
    if (seen.has(panel.surfaceKey)) fail("plate_view_panel_duplicated", `${label} shows ${panel.surfaceKey} twice`);
    seen.add(panel.surfaceKey);
  }

  // A camera sees one flank or the other. A view claiming both is not a view of
  // a vehicle, and the pair of surfaces it would paint are the exact pair whose
  // confusion produced a passenger side derived by mirroring the driver side.
  if (seen.has("driver") && seen.has("passenger")) {
    fail("plate_view_both_flanks", `${label} shows both flanks at once, which no camera does`);
  }
  for (const [surfaceKey, required] of Object.entries(FLANK_HANDEDNESS)) {
    if (seen.has(surfaceKey) && handedness !== required) {
      fail("plate_view_handedness_conflict", `${label} paints the ${surfaceKey} surface onto a ${handedness}-facing view, which reverses it`);
    }
  }

  return {
    viewKey,
    label: String(object.label || viewKey),
    handedness,
    base: validateImage(object.base, `${label}.base`),
    shading: validateImage(object.shading, `${label}.shading`),
    specular: object.specular == null ? null : validateImage(object.specular, `${label}.specular`),
    panels,
  };
}

/**
 * Validate and normalise a plate set, returning a frozen value carrying its own
 * content hash.
 */
function validateViewPlates(input) {
  const plates = requireObject(input, "plates");
  if (plates.contract !== VIEW_PLATE_CONTRACT) {
    fail("plate_contract_invalid", `plates.contract must be ${VIEW_PLATE_CONTRACT}`);
  }
  const frame = {
    widthPx: requireInteger(plates.widthPx, "plates.widthPx", { min: 64, max: 16384 }),
    heightPx: requireInteger(plates.heightPx, "plates.heightPx", { min: 64, max: 16384 }),
  };

  const normalised = {
    contract: VIEW_PLATE_CONTRACT,
    plateSetId: requireUuid(plates.plateSetId, "plates.plateSetId"),
    vehicleId: requireUuid(plates.vehicleId, "plates.vehicleId"),
    // Plates are cut against a specific set of panel dimensions. A plate set
    // bound to a different manifest than the render is a plate set for a
    // different vehicle, however similar the photograph looks.
    dimensionManifestId: requireUuid(plates.dimensionManifestId, "plates.dimensionManifestId"),
    manifestHash: requireHash(plates.manifestHash, "plates.manifestHash"),
    widthPx: frame.widthPx,
    heightPx: frame.heightPx,
    views: requireArray(plates.views, "plates.views").map((view, index) => validateView(view, `plates.views[${index}]`, frame)),
  };

  const viewKeys = new Set();
  const covered = new Set();
  for (const view of normalised.views) {
    if (viewKeys.has(view.viewKey)) fail("plate_view_duplicated", `${view.viewKey} is declared more than once`);
    viewKeys.add(view.viewKey);
    for (const panel of view.panels) covered.add(panel.surfaceKey);
  }
  // The customer approves what they can see. A surface no view shows is artwork
  // that goes to print without ever having been looked at.
  const unseen = SURFACE_KEYS.filter((key) => !covered.has(key));
  if (unseen.length) {
    fail("plate_surface_never_shown", `no view shows the ${unseen.join(", ")} surface, so the customer would approve it unseen`);
  }

  normalised.plateSetHash = viewPlateHash(normalised);
  return Object.freeze(normalised);
}

module.exports = {
  VIEW_PLATE_CONTRACT,
  HANDEDNESS,
  FLANK_HANDEDNESS,
  MAX_MESH_ROWS,
  MAX_MESH_COLS,
  ViewPlateError,
  validateViewPlates,
  viewPlateHash,
  _test: { canonical, validateMesh, validateView, validateImage },
};
