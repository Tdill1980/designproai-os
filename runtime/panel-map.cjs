"use strict";

/**
 * THE PANEL MAP -- authority 3, written once. (owner, 2026-09-02)
 *
 * Owner: "There needs to be mapped meta data." Until now the mapping between
 * a panel file and what it IS was split across four places: the revision
 * row's `metadata.callOnePanels`, `manifest.zones`, the request row (vehicle)
 * and the run (order). PanelPro, Call 8, Call 9, Call 11, the installer map,
 * the output builder and the ZIP each reassembled it, and a downloaded PNG
 * carried none of it.
 *
 * This module builds ONE object per run and phase that every consumer reads:
 *
 *   design phase     -- at Call 9 (panels.build), from the six promoted Call-1
 *                       panels and the immutable revision snapshot. Carries the
 *                       design-time inches (calls-1-7-layout-only) and says so:
 *                       `productionSizingValidated: false`.
 *   production phase -- at output.build, from the validated GENIE dimension
 *                       manifest, the Topaz-enhanced panels and the bound order
 *                       number. `productionSizingValidated: true`.
 *
 * The map is the SOURCE of the panel data slug (`panel-data-slug.cjs`): the
 * strip printed on every production panel and every QC duplicate is rendered
 * from these fields and nothing else, so the printed strip and the OS record
 * can never disagree.
 *
 * Pure: no network, no storage, no clock. The caller supplies `builtAt`.
 */

const PANEL_MAP_CONTRACT = "designpro.atlas-panel-map.v1";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const SURFACE_LABELS = Object.freeze({
  driver: "DRIVER SIDE",
  passenger: "PASSENGER SIDE",
  hood: "HOOD",
  roof: "ROOF",
  front: "FRONT",
  rear: "REAR",
});
const PHASES = Object.freeze(["design", "production"]);
const PRINT_TARGET_PPI = 150;
const HASH_RE = /^[0-9a-f]{64}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

class PanelMapError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "PanelMapError";
  }
}

function fail(code, message) {
  throw new PanelMapError(code, message);
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function positive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) fail("panel_map_number_invalid", `${label} must be a positive finite number`);
  return number;
}

function text(value, label, { required = true, max = 200 } = {}) {
  const string = value == null ? "" : String(value).trim();
  if (!string) {
    if (required) fail("panel_map_field_required", `${label} is required`);
    return null;
  }
  if (string.length > max || CONTROL_RE.test(string)) fail("panel_map_field_invalid", `${label} is invalid`);
  return string;
}

function hash(value, label) {
  const string = String(value || "").toLowerCase();
  if (!HASH_RE.test(string)) fail("panel_map_hash_invalid", `${label} must be a sha256 hex digest`);
  return string;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function rect(value, label) {
  if (value == null) return null;
  const out = {};
  for (const key of ["x", "y", "w", "h"]) {
    const number = Number(value[key]);
    if (!Number.isInteger(number) || number < 0) fail("panel_map_rect_invalid", `${label}.${key} must be a non-negative integer`);
    out[key] = number;
  }
  if (!(out.w > 0 && out.h > 0)) fail("panel_map_rect_invalid", `${label} must have positive size`);
  return out;
}

/**
 * Build the map. Every surface entry is validated against the same rules, and
 * every `sourceMasterHash` must equal `master.sha256`: a panel map that named
 * two masters would be the split lineage RULE 0.27 forbids.
 */
function buildPanelMap({
  phase,
  generationId,
  revisionId,
  revisionSequence = null,
  designId,
  orderNumber = null,
  customerName = null,
  vehicle = {},
  genie = {},
  master,
  surfaces,
  productionSizingValidated,
  geometrySource = null,
  builtAt,
  printTargetPpi = PRINT_TARGET_PPI,
}) {
  if (!PHASES.includes(phase)) fail("panel_map_phase_invalid", `phase must be one of ${PHASES.join(", ")}`);
  if (typeof productionSizingValidated !== "boolean") fail("panel_map_field_required", "productionSizingValidated must be a boolean");
  if (phase === "production" && !productionSizingValidated) fail("panel_map_phase_invalid", "a production panel map must carry validated production sizing");
  const masterSha = hash(master?.sha256, "master.sha256");
  const target = positive(printTargetPpi, "printTargetPpi");
  const rows = Array.isArray(surfaces) ? surfaces : [];
  const bySurface = {};
  for (const row of rows) {
    const key = String(row?.surfaceKey || "");
    if (!SURFACE_KEYS.includes(key)) fail("panel_map_surface_unknown", `Unknown surface ${key || "<empty>"}`);
    if (bySurface[key]) fail("panel_map_surface_duplicate", `Duplicate surface ${key}`);
    const trimW = positive(row.trimWidthIn, `${key}.trimWidthIn`);
    const trimH = positive(row.trimHeightIn, `${key}.trimHeightIn`);
    const printW = positive(row.printWidthIn, `${key}.printWidthIn`);
    const printH = positive(row.printHeightIn, `${key}.printHeightIn`);
    const bleed = positive(row.bleedInches, `${key}.bleedInches`);
    if (round2(printW - trimW) !== round2(bleed * 2) || round2(printH - trimH) !== round2(bleed * 2)) {
      fail("panel_map_bleed_inconsistent", `${key} print size is not trim plus ${bleed} inches of bleed on every edge`);
    }
    const pixelWidth = positive(row.pixelWidth, `${key}.pixelWidth`);
    const pixelHeight = positive(row.pixelHeight, `${key}.pixelHeight`);
    if (!Number.isInteger(pixelWidth) || !Number.isInteger(pixelHeight)) fail("panel_map_number_invalid", `${key} pixel size must be integral`);
    const sourceMasterHash = hash(row.sourceMasterHash, `${key}.sourceMasterHash`);
    if (sourceMasterHash !== masterSha) fail("panel_map_master_split", `${key} was cut from a different master than the map names`);
    const nativePpi = row.nativePpi != null ? positive(row.nativePpi, `${key}.nativePpi`) : round2(pixelWidth / printW);
    bySurface[key] = {
      surfaceKey: key,
      label: SURFACE_LABELS[key],
      onMaster: row.onMaster ? { ...rect(row.onMaster, `${key}.onMaster`), rotationDegrees: Number(row.onMaster.rotationDegrees || 0) } : null,
      trimOnMaster: rect(row.trimOnMaster, `${key}.trimOnMaster`),
      trimIn: [trimW, trimH],
      printIn: [printW, printH],
      bleedIn: bleed,
      sqFt: row.surfaceSqFt != null ? positive(row.surfaceSqFt, `${key}.surfaceSqFt`) : round2(trimW * trimH / 144),
      file: {
        sha256: hash(row.contentHash, `${key}.contentHash`),
        storagePath: text(row.storagePath, `${key}.storagePath`, { max: 512 }),
        px: [pixelWidth, pixelHeight],
        role: text(row.fileRole || "atlas-call1-panel", `${key}.fileRole`, { max: 64 }),
      },
      nativePpi,
      printTargetPpi: target,
      upscaleFactorRequired: round2(target / nativePpi),
      sourceMasterHash,
      noseEdge: row.noseEdge === "left" || row.noseEdge === "right" ? row.noseEdge : null,
      proofShots: Array.isArray(row.proofShots) ? row.proofShots.map(String) : [],
    };
  }
  for (const key of SURFACE_KEYS) if (!bySurface[key]) fail("panel_map_surface_missing", `Missing surface ${key}`);
  const map = {
    contract: PANEL_MAP_CONTRACT,
    phase,
    generationId: text(generationId, "generationId", { max: 64 }).toLowerCase(),
    revisionId: text(revisionId, "revisionId", { max: 64 }).toLowerCase(),
    revisionSequence: revisionSequence == null ? null : positive(revisionSequence, "revisionSequence"),
    designId: text(designId, "designId", { max: 32 }),
    orderNumber: text(orderNumber, "orderNumber", { required: false, max: 120 }),
    customerName: text(customerName, "customerName", { required: false, max: 160 }),
    vehicle: {
      year: text(vehicle.year, "vehicle.year", { required: false, max: 8 }),
      make: text(vehicle.make, "vehicle.make", { required: false, max: 64 }),
      model: text(vehicle.model, "vehicle.model", { required: false, max: 96 }),
      body: text(vehicle.body ?? vehicle.type, "vehicle.body", { required: false, max: 32 }),
      geometrySource: text(geometrySource, "geometrySource", { required: false, max: 64 }),
      productionSizingValidated,
    },
    genie: {
      manifestId: text(genie.manifestId, "genie.manifestId", { required: false, max: 128 }),
      manifestHash: text(genie.manifestHash, "genie.manifestHash", { required: false, max: 128 }),
      prepId: text(genie.prepId, "genie.prepId", { required: false, max: 64 }),
    },
    master: {
      sha256: masterSha,
      storagePath: text(master.storagePath, "master.storagePath", { required: false, max: 512 }),
      px: master.px ? [positive(master.px[0], "master.px[0]"), positive(master.px[1], "master.px[1]")] : null,
    },
    printTargetPpi: target,
    surfaces: Object.fromEntries(SURFACE_KEYS.map((key) => [key, bySurface[key]])),
    builtAt: text(builtAt, "builtAt", { max: 40 }),
  };
  return Object.freeze(canonical(map));
}

/** The bytes that are hashed and stored: canonical key order, pretty-printed for humans. */
function panelMapBytes(map) {
  if (map?.contract !== PANEL_MAP_CONTRACT) fail("panel_map_contract_invalid", "not a panel map");
  return Buffer.from(`${JSON.stringify(canonical(map), null, 2)}\n`, "utf8");
}

function parsePanelMap(bytes) {
  let parsed;
  try { parsed = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes)); }
  catch { fail("panel_map_unparseable", "panel map bytes are not JSON"); }
  if (parsed?.contract !== PANEL_MAP_CONTRACT) fail("panel_map_contract_invalid", `unexpected panel map contract ${String(parsed?.contract || "none")}`);
  return Object.freeze(canonical(parsed));
}

function panelMapSurface(map, surfaceKey) {
  const entry = map?.surfaces?.[surfaceKey];
  if (!entry) fail("panel_map_surface_missing", `panel map has no ${surfaceKey}`);
  return entry;
}

function inches(value) {
  const number = Number(value);
  return Number.isInteger(number) ? `${number}` : `${round2(number)}`;
}

/**
 * The lines the slug prints for one surface, in order. Every value comes from
 * the map (identity, geometry, lineage) or from the caller's file facts
 * (file name, output density, media, QC line). The RIP's own fields -- printer,
 * profiles, screening -- are the RIP's and are deliberately absent.
 */
function slugLines(map, surfaceKey, { fileName, outputPpi = null, media = null, qcApproved = null } = {}) {
  const entry = panelMapSurface(map, surfaceKey);
  const orientation = ["[UP ^]", entry.noseEdge ? `[FRONT ${entry.noseEdge === "left" ? "<-" : "->"}]` : null].filter(Boolean).join("  ");
  const vehicle = [map.vehicle?.year, map.vehicle?.make, map.vehicle?.model].filter(Boolean).join(" ") || "vehicle not recorded";
  const body = map.vehicle?.body ? ` (${map.vehicle.body})` : "";
  const sizing = map.vehicle?.productionSizingValidated ? "GENIE validated" : "design-time sizing, NOT validated";
  const density = outputPpi
    ? `Output ${inches(outputPpi)} PPI full scale (native ${inches(entry.nativePpi)} PPI, x${inches(entry.upscaleFactorRequired)})`
    : `Native ${inches(entry.nativePpi)} PPI (print target ${inches(entry.printTargetPpi)} PPI, x${inches(entry.upscaleFactorRequired)} required)`;
  return Object.freeze([
    `DESIGNPROAI | PANEL DATA   ${entry.label}   ${orientation}`,
    `Order ${map.orderNumber || "not assigned"}   ${map.designId}   Gen ${map.generationId.slice(0, 8)}   Rev ${map.revisionId.slice(0, 8)}${map.revisionSequence ? ` (V${map.revisionSequence})` : ""}`,
    `Customer: ${map.customerName || "-"}   Vehicle: ${vehicle}${body}`,
    `Trim ${inches(entry.trimIn[0])} x ${inches(entry.trimIn[1])} in   Print ${inches(entry.printIn[0])} x ${inches(entry.printIn[1])} in (${inches(entry.bleedIn)} in bleed all sides)   ${inches(entry.sqFt)} sq ft   ${sizing}`,
    `File ${fileName || entry.file.storagePath.split("/").pop()}   sha256 ${entry.file.sha256.slice(0, 12)}...   Master ${map.master.sha256.slice(0, 12)}...   GENIE ${(map.genie?.manifestHash || "n/a").slice(0, 8)}`,
    `${density}   sRGB   Media: ${media || "per order"}`,
    `Built ${map.builtAt}   QC approved: ${qcApproved || "________________________  (blank until stamped)"}`,
  ]);
}

module.exports = Object.freeze({
  PANEL_MAP_CONTRACT,
  PRINT_TARGET_PPI,
  SURFACE_KEYS,
  SURFACE_LABELS,
  PanelMapError,
  buildPanelMap,
  panelMapBytes,
  parsePanelMap,
  panelMapSurface,
  slugLines,
});
