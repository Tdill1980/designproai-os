"use strict";

/**
 * Flat-first DesignPro atlas authoring.
 *
 * This is the opt-in v3 producer. It runs before the seven customer proof
 * views and creates the one image every proof is conditioned on. The six
 * proof surfaces are laid out from a GENIE geometry authority:
 * passenger on the left, driver on the right, and rear/roof/hood/front down
 * the centre. That authority may be operator-validated or a cited Google-
 * grounded provisional estimator, but no proof render is ever inspected or
 * measured to build this map.
 *
 * IMPORTANT PREPRESS LIMIT. GENIE currently supplies six rectangular surface
 * extents, not a licensed PVO contour/UV mesh. The atlas therefore declares
 * `rectangular-preview-v1` and `productionEligible=false`. Its crops and
 * effective pixel density are recorded honestly; no 4K model response spread
 * over a whole vehicle is silently relabelled a print-ready master.
 */

const { createHash, randomUUID } = require("node:crypto");
const sharp = require("sharp");
const { analyzeVisionBoardStyles } = require("./visionboard-iq.cjs");
const {
  DESIGNPANEL_ARTBOARD_PORT_VERSION,
  DESIGNPANEL_AUTHORING_MODEL,
} = require("./designiq-prompt.cjs");
// OWNER DIRECTIVE (Trish 2026-08-27, PASTE_TO_CLAUDE.md): Call 1 executes
// through the REAL deployed design-panel-ai-generate edge function. This
// runtime assembles NO creative prompt text and makes NO direct Gemini request
// for Call 1 — it POSTs the payload, receives the finished flattened master,
// verifies its hash, and continues with deterministic QC + panel extraction.
// The transpiled vendor bridge is deleted from the product path.
const {
  MASTER_QC_CONTRACT,
  deterministicMasterChecks,
} = require("./atlas-master-qc.cjs");
const { FILL_CONTRACT, fillMasterCutouts } = require("./atlas-cutout-fill.cjs");
const { BUCKET } = require("./generation-store.cjs");
const { loadBundledAtlasCohesionExample } = require("./flat-atlas-topology-examples.cjs");

const ATLAS_CONTRACT = "designpro.flat-first-atlas.v1";
const MANIFEST_CONTRACT = "designpro.flat-first-atlas-manifest.v1";
const INPUT_CONTRACT = "designpro.calls-1-7-input.v3";
const PIPELINE_MODE = "flat-first-atlas-v1";
// v5: the solid-panel rule. v4 masters were authored under a prompt that let a
// zone come back as a vehicle silhouette with the wheel arches and glass punched
// out, so they are not reusable under this contract and the version is what
// refuses them.
// v6 (2026-08-24): the finished 3D vehicle proof is no longer attached to this
// call, and the sheet is described as printed vinyl on the roll rather than as
// vehicle flanks. v5 masters are refused rather than migrated, and this string
// is the mechanism that refuses them.
// v10-edge (2026-08-27, owner directive): the creative call executes through
// the REAL deployed design-panel-ai-generate edge function (mode
// atlas-artboard, executing the pinned Persona-2 buildDesignerPrompt). This
// runtime assembles no creative text and makes no direct Gemini request for
// Call 1. The SIDE-TWIN scene framing does not exist anywhere in the chain. VERSION FENCE SCOPE (owner protection #1): this string
// refuses REUSING an older master for NEW authoring/regeneration only
// (assertAtlasReuseContract, authoring paths). Existing generations stay
// readable, viewable and downloadable everywhere — no read path checks it,
// locked by tests/atlas-historical-read.test.mjs.
const PROMPT_VERSION = "designpro-flat-first-atlas-20260831.v16-flat-example-only";
// Bounded QC-corrective re-rolls exist for operator harnesses only. The
// customer path defaults to exactly ONE: one revision = one DesignPanelAI
// creative call = one Gemini image request, and the exact request count is
// reported on the revision as metadata.geminiImageRequestCount.
// ONE AUTHORING CALL ON THE CUSTOMER'S CRITICAL PATH. (Trish 2026-08-27:
// "ATLAS SHOULD GENERATE IN LESS THAN 1 MINUTE, then sequential panels and 3D
// driver in less than 2 min".)
//
// An authoring call costs ~60s. Three of them cannot fit a sixty-second budget
// by construction, and the customer sees NOTHING until the loop ends -- canary
// cad013e1 spent 181 seconds and showed her a failure page.
//
// The re-roll ladder existed because a refused master had no other remedy. A
// cut-out is now FILLED deterministically (~100ms, atlas-cutout-fill). Passenger
// is different: it is its own named, authored Call-1 region and is never
// manufactured from Driver. Pixel-mirror similarity remains recorded as
// telemetry, but cannot replace Passenger or block an otherwise structurally
// valid master. A genuine creative miss belongs to a customer revision, not a
// hidden technical rewrite of the accepted authority.
//
// The budget remains adjustable for a harness or an explicit operator retry,
// but production cannot silently spend a second creative call while the buyer
// is waiting for Driver.
const MAX_MASTER_AUTHORING_ATTEMPTS = 3;
const DEFAULT_MASTER_AUTHORING_ATTEMPTS = 1;
function resolveMaxAuthoringAttempts(explicit) {
  const raw = explicit ?? process.env.DESIGNPRO_ATLAS_MAX_AUTHORING_ATTEMPTS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return DEFAULT_MASTER_AUTHORING_ATTEMPTS;
  return Math.min(value, MAX_MASTER_AUTHORING_ATTEMPTS);
}
const MASTER_PROVIDER_CONTRACT = "designpro.flat-first-master-provider.v1";
const TOPOLOGY = "rectangular-preview-v1";
const EXAMPLE_PURPOSE = "topology-only";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
// ⛔ DO NOT REORDER THIS AGAIN. (Trish 2026-08-27, after it was reordered.)
//
// rear -> roof -> hood -> front is the layout that produced every good master
// this product has made -- Flamingo Pools, Harbor Point. It was briefly changed
// to roof/hood/front/rear to match the ordering drawn in an example sheet, and
// the owner's verdict on the result was immediate: "you have the ATLAS
// container showing the WRONG incorrect flattened design... you almost had it
// right yesterday. All you were supposed to do was name the containers."
//
// The container ORDER is the flattened vehicle. The container NAMES are what
// Gemini needed. Those are different problems, and only the second one was
// ever open.
const CENTER_ORDER = Object.freeze(["rear", "roof", "hood", "front"]);
const PROOF_VIEWS = Object.freeze(["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"]);
/**
 * THE ORDER PANELS ARE CUT IN, WHICH IS NOT `SURFACE_KEYS`.
 *
 * Owner, 2026-08-27: "Driver -> Passenger -> Hood -> Front -> Rear -> Roof.
 * Each completed panel is immediately persisted and published to PanelPro
 * Studio with its trim dimensions, 5\u2033 bleed, hashes and lineage."
 *
 * `SURFACE_KEYS` is frozen on the cross-session seam (RULE 0.5) and orders roof
 * third; it is a SET, used for membership and for the exactly-six assertion, and
 * it is left exactly as it is. This is a separate constant because extraction
 * order is a scheduling decision -- Driver first because the Driver proof is
 * what the customer sees first (RULE 0.23), Roof last because it is the view
 * most likely to need a corrective cycle and the least likely to be looked at
 * first.
 *
 * The two must stay the same SET, which `tests/atlas-streaming-fanout.test.mjs`
 * asserts.
 */
const PANEL_EXTRACTION_ORDER = Object.freeze(["driver", "passenger", "hood", "front", "rear", "roof"]);
const CANVAS = Object.freeze({ widthPx: 4096, heightPx: 4096 });
// Pinned to the edge function's own ATLAS_ARTBOARD_PROMPT_VERSION; the reuse
// contract folds it into the request identity, and the revision records it.
// It said `atlas-artboard-persona.20260827.v1` after Call 1 moved off the
// Persona-2 string-replacement path onto the function's own DesignIQ flat
// branch, which the edge function stamps as
// `atlas-artboard-designiq.20260827.v2`. Nothing compares the two, so it never
// failed a run -- it just recorded the wrong prompt identity on every revision
// and hashed reuse against a version no request has carried since.
const ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "atlas-artboard-designiq.20260831.v16-one-connected-wrap";
const BLEED_INCHES = 5;
const CALL_ONE_PANEL_CONTRACT = "designpro.flat-first-atlas-call1-panel.v1";
// Two, not three: a deterministic crop that fails the same way twice is not
// going to succeed on a third, and each attempt is ~40ms of the customer's
// wait. This is a transient-fault filter, never a way to make a bad zone pass.
const PANEL_CUT_ATTEMPTS = 2;
const TARGET_PRINT_PPI = 150;
const PROJECTION_CONTRACT = "designpro.flat-first-atlas-projection.v1";
const VIEW_AUTHORITY_CONTRACT = "designpro.flat-first-atlas-view-authority.v1";
const VIEW_AUTHORITY_MAX_BYTES = 4 * 1024 * 1024;
const VIEW_SURFACE = Object.freeze({
  side: "driver",
  "passenger-side": "passenger",
  hood_detail: "hood",
  front: "front",
  rear: "rear",
  // ⚠️ CLOSE-UP'S SURFACE IS A SELECTION, NOT AN INHERITANCE. (Trish 2026-08-28)
  //
  // "Close-Up must never silently inherit a Driver photograph unless the
  // requested detail explicitly uses Driver as its selected artwork surface."
  //
  // Driver remains the DEFAULT selected detail surface -- it is the largest
  // continuous area of livery and the natural place to show vinyl grain -- but
  // it is now a stated choice: `atlasPanelForProofView` marks the close-up
  // authority `surfaceSelection: "default-driver-detail"`, the transport sends
  // that surface by name, and the photographer REFUSES a close-up whose surface
  // was not named (`atlas_proof_detail_surface_unselected`). Nothing defaults
  // on the far side of the wire.
  "close-up": "driver",
  roof: "roof",
});
/** The close-up's default detail surface, named so the choice is auditable. */
const CLOSE_UP_DEFAULT_DETAIL_SURFACE = "driver";
// Google generateContent requests must remain below 20 MiB. Twelve MiB of
// binary JPEG becomes at most sixteen MiB after base64, leaving room for JSON,
// prompts and request framing without shrinking the canonical 4096px master.
const PROJECTION_MAX_BYTES = 12 * 1024 * 1024;
const MASTER_REQUEST_MAX_BYTES = 20 * 1024 * 1024 - 256 * 1024;
const CUSTOMER_REFERENCE_MAX_PIXELS = 40_000_000;
const PROJECTION_QUALITY_LADDER = Object.freeze([94, 90, 86, 82, 78, 74, 70, 66, 62, 58, 54, 50, 46, 42]);
const OUTER_PADDING_PX = 192;
const COLUMN_GUTTER_PX = 72;
const CENTER_GUTTER_PX = 36;
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });
const HASH_RE = /^[0-9a-f]{64}$/;
const GEOMETRY_AUTHORITY_CONTRACT = "designpro.genie-proof-geometry-authority.v1";

// The guide must not become a hidden palette reference. Every surface uses the
// same neutral value; its identity lives in the manifest and prompt, not color.
const GUIDE_FILL = "#e5e5e5";

const PROOF_DEPENDENCIES = Object.freeze({
  driver: Object.freeze(["side", "front", "rear", "close-up"]),
  passenger: Object.freeze(["passenger-side", "front", "rear", "close-up"]),
  hood: Object.freeze(["hood_detail", "side", "passenger-side", "front", "close-up"]),
  roof: Object.freeze(["roof", "side", "passenger-side", "close-up"]),
  front: Object.freeze(["front", "side", "passenger-side", "close-up"]),
  rear: Object.freeze(["rear", "side", "passenger-side", "close-up"]),
});

const SEMANTIC_CONTINUITY = Object.freeze([
  ["rear", "passenger"], ["rear", "driver"],
  ["roof", "passenger"], ["roof", "driver"],
  ["hood", "passenger"], ["hood", "driver"],
  ["front", "passenger"], ["front", "driver"],
  ["rear", "roof"], ["roof", "hood"], ["hood", "front"],
]);

class FlatAtlasError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "FlatAtlasError";
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonical(value)));
}

function round(value, places = 2) {
  const scale = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function flatFirstRequested(input) {
  const contract = String(input?.contractVersion || "").trim();
  const mode = String(input?.pipelineMode || "").trim();
  if (!contract && !mode) return false;
  if (contract === INPUT_CONTRACT && mode === PIPELINE_MODE) return true;
  if (contract === INPUT_CONTRACT || mode === PIPELINE_MODE) {
    throw new FlatAtlasError(
      "flat_atlas_input_contract_mismatch",
      `${PIPELINE_MODE} requires contractVersion ${INPUT_CONTRACT} and the exact pipelineMode together`,
    );
  }
  return false;
}

function normalizedGeometryAuthority(authority) {
  if (authority == null) {
    return {
      contract: GEOMETRY_AUTHORITY_CONTRACT,
      status: "validated",
      purpose: "calls-1-7-layout-only",
      candidateId: null,
      candidateHash: null,
      source: "operator-validated",
      sourceUrls: [],
      confidence: "high",
      operatorValidated: true,
      validatedBy: null,
      validatedAt: null,
      productionEligible: false,
    };
  }
  if (authority.contract !== GEOMETRY_AUTHORITY_CONTRACT) {
    throw new FlatAtlasError("flat_atlas_geometry_authority_invalid", "A.T.L.A.S. geometry authority contract is invalid");
  }
  // THREE PROVENANCE CLASSES, NOT TWO.
  //
  // `validated` is a human who measured this vehicle. `provisional` is the
  // grounded estimator, which owes citations because it is a guess. The GENIE
  // Panelizer catalog is neither: 1,781 rows a shop MEASURED, keyed by row id,
  // with no web source to cite and no operator attached.
  //
  // It was emitted as `status: "genie-catalog"` and this list accepted only the
  // first two, so the catalog path threw `flat_atlas_geometry_authority_invalid`
  // the moment it ever matched -- which is why it took until 2026-08-27 to see:
  // every earlier run fell through to the estimator before reaching here, and
  // the fall-through was silent. Fixing the F250 match surfaced it immediately,
  // at 5 seconds, on the customer's screen.
  //
  // It is its own class with its own rules rather than being squeezed into one
  // of the other two: it is not operator-validated (nobody signed for it) and it
  // needs a candidate identity (the catalog row) but not sourceUrls.
  const status = String(authority.status || "");
  if (!["validated", "provisional", "genie-catalog"].includes(status)
    || authority.productionEligible !== false
    || (status === "validated" && authority.operatorValidated !== true)
    || (status === "genie-catalog" && authority.operatorValidated !== false)
    || (status === "provisional" && (authority.operatorValidated !== false || !authority.estimatorContract))) {
    throw new FlatAtlasError("flat_atlas_geometry_authority_invalid", "A.T.L.A.S. geometry authority state is invalid");
  }
  const sourceUrls = Array.isArray(authority.sourceUrls)
    ? [...new Set(authority.sourceUrls.map(String).filter((url) => /^https:\/\//.test(url)))]
    : [];
  if (status === "provisional" && (!authority.candidateId || !sourceUrls.length)) {
    throw new FlatAtlasError("flat_atlas_provisional_authority_incomplete", "Provisional A.T.L.A.S. geometry requires a candidate identity and citations");
  }
  // A measured row must say WHICH row, or the dimensions on the panels cannot be
  // traced back to anything.
  if (status === "genie-catalog" && !authority.candidateId) {
    throw new FlatAtlasError("flat_atlas_catalog_authority_incomplete", "A GENIE catalog authority requires the measured row identity");
  }
  return {
    contract: GEOMETRY_AUTHORITY_CONTRACT,
    status,
    purpose: "calls-1-7-layout-only",
    candidateId: authority.candidateId || null,
    candidateHash: authority.candidateHash || null,
    source: String(authority.source
      || (status === "validated" ? "operator-validated"
        : status === "genie-catalog" ? "genie-panelizer-catalog"
        : "gemini_grounded")),
    sourceUrls,
    confidence: String(authority.confidence
      || (status === "provisional" ? "low" : "high")),
    ...(authority.estimatorContract ? { estimatorContract: String(authority.estimatorContract) } : {}),
    operatorValidated: status === "validated",
    validatedBy: status === "validated" ? authority.validatedBy || null : null,
    validatedAt: status === "validated" ? authority.validatedAt || null : null,
    productionEligible: false,
  };
}

function normalizedSurfaces(surfaces) {
  if (!Array.isArray(surfaces) || surfaces.length !== SURFACE_KEYS.length) {
    throw new FlatAtlasError("flat_atlas_surface_set_invalid", "The atlas requires exactly six GENIE proof-layout surfaces");
  }
  const byKey = new Map();
  for (const entry of surfaces) {
    const surfaceKey = String(entry?.surfaceKey || "").trim().toLowerCase();
    const trimWidthIn = Number(entry?.widthInches ?? entry?.trimWidthIn);
    const trimHeightIn = Number(entry?.heightInches ?? entry?.trimHeightIn);
    const bleed = entry?.bleed || {};
    const declaredBleed = [bleed.top, bleed.right, bleed.bottom, bleed.left]
      .filter((value) => value != null).map(Number);
    if (!SURFACE_KEYS.includes(surfaceKey) || byKey.has(surfaceKey)) {
      throw new FlatAtlasError("flat_atlas_surface_identity_invalid", `Invalid or duplicate surface ${surfaceKey || "?"}`);
    }
    if (!(trimWidthIn > 0 && trimHeightIn > 0) || trimWidthIn > 1000 || trimHeightIn > 1000) {
      throw new FlatAtlasError("flat_atlas_surface_geometry_invalid", `${surfaceKey} is not valid GENIE proof-layout rectangle geometry`);
    }
    if (declaredBleed.length && declaredBleed.some((value) => value !== BLEED_INCHES)) {
      throw new FlatAtlasError("flat_atlas_bleed_invalid", `${surfaceKey} must use five physical inches of bleed on every edge`);
    }
    byKey.set(surfaceKey, {
      surfaceKey,
      trimWidthIn,
      trimHeightIn,
      printWidthIn: trimWidthIn + BLEED_INCHES * 2,
      printHeightIn: trimHeightIn + BLEED_INCHES * 2,
      surfaceSqFt: round(trimWidthIn * trimHeightIn / 144),
    });
  }
  const missing = SURFACE_KEYS.filter((key) => !byKey.has(key));
  if (missing.length) throw new FlatAtlasError("flat_atlas_surface_set_incomplete", `GENIE is missing ${missing.join(", ")}`);
  return byKey;
}

function fitRotatedSide(surface, columnX, columnWidth, availableTop, availableHeight, rotationDegrees) {
  // The displayed cell is a 90-degree rotation of the native print rectangle:
  // display width maps to physical height; display height maps to width.
  const displayAspect = surface.printHeightIn / surface.printWidthIn;
  let width = columnWidth;
  let height = width / displayAspect;
  if (height > availableHeight) {
    const scale = availableHeight / height;
    width *= scale;
    height *= scale;
  }
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return {
    x: Math.round(columnX + (columnWidth - w) / 2),
    y: Math.round(availableTop + (availableHeight - h) / 2),
    w,
    h,
    rotationDegrees,
  };
}

function fitCenterColumn(byKey, columnX, columnWidth, availableTop, availableHeight) {
  const ratios = CENTER_ORDER.map((key) => byKey.get(key).printHeightIn / byKey.get(key).printWidthIn);
  const usableHeight = availableHeight - CENTER_GUTTER_PX * (CENTER_ORDER.length - 1);
  const commonWidth = Math.min(columnWidth, usableHeight / ratios.reduce((total, value) => total + value, 0));
  const heights = ratios.map((ratio) => Math.max(1, Math.round(commonWidth * ratio)));
  const totalHeight = heights.reduce((total, value) => total + value, 0) + CENTER_GUTTER_PX * (heights.length - 1);
  let y = Math.round(availableTop + (availableHeight - totalHeight) / 2);
  return CENTER_ORDER.map((surfaceKey, index) => {
    const w = Math.max(1, Math.round(commonWidth));
    const h = heights[index];
    const zone = {
      surfaceKey,
      x: Math.round(columnX + (columnWidth - w) / 2),
      y,
      w,
      h,
      rotationDegrees: 0,
    };
    y += h + CENTER_GUTTER_PX;
    return zone;
  });
}

function trimRectangle(zone, surface) {
  // A rotated side's displayed X dimension maps to native Y, and displayed Y
  // maps to native X. The inverse rotation in `extraction` restores it.
  const rotated = Math.abs(zone.rotationDegrees) === 90;
  const physicalDisplayWidth = rotated ? surface.printHeightIn : surface.printWidthIn;
  const physicalDisplayHeight = rotated ? surface.printWidthIn : surface.printHeightIn;
  const bleedX = Math.round(BLEED_INCHES * zone.w / physicalDisplayWidth);
  const bleedY = Math.round(BLEED_INCHES * zone.h / physicalDisplayHeight);
  return {
    x: zone.x + bleedX,
    y: zone.y + bleedY,
    w: Math.max(1, zone.w - bleedX * 2),
    h: Math.max(1, zone.h - bleedY * 2),
  };
}

function zoneEffectivePpi(zone, surface) {
  const rotated = Math.abs(zone.rotationDegrees) === 90;
  const nativeWidthPx = rotated ? zone.h : zone.w;
  const nativeHeightPx = rotated ? zone.w : zone.h;
  return round(Math.min(nativeWidthPx / surface.printWidthIn, nativeHeightPx / surface.printHeightIn));
}

/**
 * Pure function of the six-surface GENIE proof-layout geometry. Extra caller
 * data is deliberately not accepted, so a proof image can never become
 * geometry.
 */
function buildAtlasManifest(surfaces, geometryAuthorityInput, vehicleTypeInput) {
  const geometryAuthority = normalizedGeometryAuthority(geometryAuthorityInput);
  // Driver and passenger only. The centre four are single structural surfaces
  // with nothing to sub-divide, and inventing regions for them would be exactly
  // the eleven-panel architecture the owner ruled out.
  const flank = flankTopology(vehicleTypeInput);
  const byKey = normalizedSurfaces(surfaces);
  const availableTop = OUTER_PADDING_PX;
  const availableHeight = CANVAS.heightPx - OUTER_PADDING_PX * 2;
  const availableWidth = CANVAS.widthPx - OUTER_PADDING_PX * 2;
  const centerColumnWidth = Math.round(availableWidth * 0.34);
  const sideColumnWidth = Math.floor((availableWidth - centerColumnWidth - COLUMN_GUTTER_PX * 2) / 2);
  const leftColumnX = OUTER_PADDING_PX;
  const centerColumnX = leftColumnX + sideColumnWidth + COLUMN_GUTTER_PX;
  const rightColumnX = centerColumnX + centerColumnWidth + COLUMN_GUTTER_PX;

  const rawZones = [
    { surfaceKey: "passenger", ...fitRotatedSide(byKey.get("passenger"), leftColumnX, sideColumnWidth, availableTop, availableHeight, 90) },
    ...fitCenterColumn(byKey, centerColumnX, centerColumnWidth, availableTop, availableHeight),
    { surfaceKey: "driver", ...fitRotatedSide(byKey.get("driver"), rightColumnX, sideColumnWidth, availableTop, availableHeight, -90) },
  ];

  const rawByKey = new Map(rawZones.map((zone) => [zone.surfaceKey, zone]));
  const zones = SURFACE_KEYS.map((surfaceKey) => {
    const zone = rawByKey.get(surfaceKey);
    const surface = byKey.get(surfaceKey);
    if (!zone || zone.x < 0 || zone.y < 0 || zone.x + zone.w > CANVAS.widthPx || zone.y + zone.h > CANVAS.heightPx) {
      throw new FlatAtlasError("flat_atlas_zone_out_of_bounds", `${surfaceKey} falls outside the 4K atlas`);
    }
    const effectivePpi = zoneEffectivePpi(zone, surface);
    return {
      surfaceKey,
      placement: surfaceKey === "passenger" ? "left-flank" : surfaceKey === "driver" ? "right-flank" : "center-column",
      x: zone.x,
      y: zone.y,
      w: zone.w,
      h: zone.h,
      rotationDegrees: zone.rotationDegrees,
      extraction: {
        x: zone.x,
        y: zone.y,
        w: zone.w,
        h: zone.h,
        outputRotationDegrees: -zone.rotationDegrees,
      },
      trim: trimRectangle(zone, surface),
      trimWidthIn: surface.trimWidthIn,
      trimHeightIn: surface.trimHeightIn,
      bleedIn: { top: BLEED_INCHES, right: BLEED_INCHES, bottom: BLEED_INCHES, left: BLEED_INCHES },
      printWidthIn: surface.printWidthIn,
      printHeightIn: surface.printHeightIn,
      surfaceSqFt: surface.surfaceSqFt,
      effectivePpi,
      proofDependencies: [...PROOF_DEPENDENCIES[surfaceKey]],
      guideFill: GUIDE_FILL,
      // Authoring guidance, on the two flanks only. Read by the guide caption
      // and by the Call-1 panel list; read by nothing that cuts, counts,
      // packages or delivers a panel.
      flankTopology: surfaceKey === "driver" || surfaceKey === "passenger" ? flank : null,
    };
  });
  const minimumEffectivePpi = Math.min(...zones.map((zone) => zone.effectivePpi));
  return {
    contract: MANIFEST_CONTRACT,
    topology: TOPOLOGY,
    productionEligible: false,
    productionBlockers: [
      ...(geometryAuthority.status === "provisional"
        ? ["operator-validated exact six-surface geometry is required before production"]
        : []),
      "validated rectangular GENIE extents are not an exact PVO contour/UV topology",
      `minimum effective density is ${minimumEffectivePpi} PPI; print target is ${TARGET_PRINT_PPI} PPI`,
    ],
    geometryAuthority,
    sourceAuthority: {
      geometry: geometryAuthority.status === "provisional"
        ? "provisional-google-grounded-layout-only"
        : "validated-genie-six-surface-manifest-only",
      visualProofsUsedForGeometry: false,
      customerStyleSource: "customer-brief-and-verified-customer-assets-only",
      examplePurpose: EXAMPLE_PURPOSE,
    },
    guideRendering: {
      tone: "neutral-monochrome",
      styleAuthority: false,
      surfaceIdentityComesFromManifest: true,
    },
    canvas: { ...CANVAS, colorSpace: "srgb", alphaOutsideZones: true },
    coordinateSystem: { origin: "top-left", xDirection: "right", yDirection: "down", units: "pixels" },
    installerMap: {
      passenger: "left",
      driver: "right",
      centerOrderTopToBottom: [...CENTER_ORDER],
      longitudinalOrder: "vehicle-rear-to-front",
    },
    seamContinuity: {
      mode: "semantic-preview-only",
      exactPvoSeamMappingsAvailable: false,
      relationships: SEMANTIC_CONTINUITY.map(([first, second]) => ({
        surfaces: [first, second],
        intent: "continue artwork where the installed surfaces physically meet",
        exactPixelJoin: null,
      })),
    },
    bleedInches: BLEED_INCHES,
    zones,
    proofViews: [...PROOF_VIEWS],
    proofOnlyViews: ["close-up"],
    quality: {
      requestedMasterSize: "4K",
      targetPrintPpi: TARGET_PRINT_PPI,
      minimumEffectivePpi,
      ppiIsComputedFromZonePixelsAndPhysicalBleedBox: true,
      upscalingRequiredBeforeAnyProductionExport: minimumEffectivePpi < TARGET_PRINT_PPI,
    },
    totalTrimSqFt: round(zones.reduce((total, zone) => total + zone.surfaceSqFt, 0)),
  };
}

/**
 * THE CALL-OUT SITS ON ITS OWN PANEL, THE WAY AN INSTALLER'S SHEET DOES.
 *
 * The labels used to be a legend: six words in a fixed row along the top edge
 * at font-size 26 on a 4096px canvas -- roughly half a percent of the height --
 * in the flat order PASSENGER, REAR, ROOF, HOOD, FRONT, DRIVER. The zones
 * themselves are laid out passenger-left, a rear/roof/hood/front centre column,
 * driver-right. So the row neither matched the layout nor touched the rectangle
 * it named, and the model had to infer the mapping from a caption it could
 * barely resolve.
 *
 * The bundled Houdini sheet does the obvious thing instead: every panel carries
 * its own name, printed on it. So does this now -- each label is centred on its
 * zone, rotated with the panel so it reads along the length exactly as the
 * artwork will, and scaled to the zone rather than fixed.
 *
 * Still monochrome: `#1a1a1a` is neutral, so the guide carries no palette
 * information, which `flat-first-atlas.test.mjs` enforces channel by channel.
 */
function zoneLabelSvg(zone) {
  const label = String(zone.surfaceKey || "").toUpperCase();
  if (!label) return "";
  const centreX = Number(zone.x) + Number(zone.w) / 2;
  const centreY = Number(zone.y) + Number(zone.h) / 2;
  // The short side is what constrains the text: a rotated label on a tall flank
  // runs along the height, so its cap height has to fit the width.
  const shortSide = Math.min(Number(zone.w), Number(zone.h));
  const fontSize = Math.max(48, Math.min(180, Math.round(shortSide * 0.14)));
  // Rotate with the panel. The flanks are +/-90, the centre column is 0, so the
  // name reads the same direction the livery does on that surface.
  const rotation = Number(zone.rotationDegrees || 0);
  return `<text x="${centreX}" y="${centreY}" transform="rotate(${rotation} ${centreX} ${centreY})" `
    + `text-anchor="middle" dominant-baseline="central" fill="#1a1a1a" `
    + `font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" `
    + `letter-spacing="${Math.round(fontSize * 0.08)}">${label}</text>`;
}

/**
 * THE CONTAINERS ARE LABELED -- IN THE MARGIN, NEVER INSIDE THE PAINT AREA.
 *
 * Owner, 2026-08-27, looking at the live master: "just fix so it's a true
 * topography flattened view labeled containers", against a spec sheet reading
 * "A.T.L.A.S. FLATTENED - TOPO TOP VIEW · SINGLE SOURCE MASTER · SIX
 * DETERMINISTIC PANELS · 1:1 TOPOLOGY" with every container carrying its
 * Surface ID and its W/H in pixels.
 *
 * The topology itself was already right -- passenger flank left, a centre
 * column running vehicle-rear-to-front, driver flank right, which is what
 * `buildAtlasManifest` has produced all along. What the ARTBOARD lacked was
 * identity: the copy handed to the authoring model carried geometry and
 * nothing else, so six unnamed grey rectangles had to be mapped onto six
 * surface names carried separately as prose.
 *
 * Labels could not simply go back inside the rectangles. That is exactly what
 * `renderAtlasAuthoringGuide`'s comment records happening on 2026-08-25: a
 * large bold surface name centred on a rectangle the model was told to paint
 * came back painted, and three consecutive attempts died on
 * `artifactFreeContract`.
 *
 * So the label sits in the GUTTER BESIDE its container -- the far-left margin
 * for passenger, the far-right margin for driver, the passenger/centre gutter
 * for the four centre surfaces -- rotated to read up the sheet. Two things
 * follow, and both matter:
 *
 *   1. No glyph is inside any paintable rectangle, so there is nothing for the
 *      model to copy INTO the artwork; the 08-25 failure cannot recur.
 *   2. `normalizeAtlasMaster` masks the delivered sheet to the zone rectangles
 *      (`activeZoneMaskSvg`), so anything the model paints in a gutter is
 *      discarded before the master exists. The margin is structurally
 *      unprintable, not merely discouraged.
 *
 * Same labels on both guides, so the design team and the model read one sheet.
 */
const SURFACE_IDS = Object.freeze({
  driver: "DS",
  passenger: "PS",
  hood: "HD",
  roof: "RF",
  front: "FR",
  rear: "RR",
});


/**
 * HOW MUCH CLEAR SPACE A CAPTION OCCUPIES, PER POINT OF TYPE.
 *
 * Every caption on this sheet is rotated about its own x/y anchor, so its
 * half-extent is bounded by the font size rather than by the string length.
 * ONE constant, used by both the writer (`containerCaptionSvg`, sizing type to
 * the gutter it has) and the reader (`renderAtlasAuthoringGuide`'s guard,
 * proving that anchor clears every extraction rectangle). Two constants would
 * let the guard admit a caption the layout had already overrun.
 */
const LABEL_REACH = 0.7;

/**
 * NAME THE CONTAINERS -- IN THE GUTTER, NEVER INSIDE THE EXTRACTION RECTANGLE.
 *
 * Owner, pointing at the bundled Houdini PANEL LAYOUT: "All you were supposed
 * to do was name the containers so Gemini could understand what the flattened
 * topo panels are. Like Lamborghini, like truck -- except truck didn't have
 * labels so impossible to understand, no truck bed and what was what."
 *
 * ⛔ THE NAME MAY NOT GO IN THE BLEED BAND. IT WAS THERE, AND IT REACHED THE
 * CUSTOMER. (Corrected 2026-08-28, from the product's own evidence.)
 *
 * The first version of this put the name inside the container, in the 5" bleed
 * band above `zone.trim`, on the reasoning that "each panel is cut to the
 * container and finished to trim, so the structural margin is discarded twice
 * over". `cutOnePanel` disproves the second half: its extract rect IS
 * `zone.extraction`, which is the WHOLE container -- trim plus bleed -- and no
 * later step trims it. A panel is stored at PRINT size. So a glyph in the bleed
 * band is a glyph in the file the customer buys.
 *
 * It was not hypothetical. Request f3eb40c1 (2026-08-27), passenger attempt 2,
 * the proof judge reading the canonical Call-1 panel it was handed as artwork
 * authority: "The text 'PASSENGER SIDE' and dimensions visible in the authority
 * crop are not present on the candidate proof." The model had copied the
 * caption off the artboard into the sheet, the cut carried it into the panel,
 * and the judge then refused the proof for correctly NOT printing it on the
 * vehicle.
 *
 * So the caption sits in the GUTTER BESIDE its container -- the far-left margin
 * for passenger, the far-right margin for driver, the passenger/centre gutter
 * for the four centre surfaces -- rotated to read up the sheet. That is the
 * form RULE 0.28 describes, and it satisfies the actual ask: the rectangle is
 * named, adjacently and unambiguously, with no glyph anywhere the extractor
 * cuts. `normalizeAtlasMaster` masks the delivered sheet to the zone rectangles
 * as well, so anything painted in a gutter is discarded before a master exists.
 *
 * The container ORDER is untouched: see CENTER_ORDER.
 */

/**
 * THE REAL VEHICLE STRUCTURE ALONG A FLANK — GUIDANCE, NEVER A SEAM. (Trish 2026-08-28)
 *
 * The bundled Houdini PANEL LAYOUT names eleven-plus panels — rear bumper,
 * hatch, rocker, fender, quarter, front bumper — and A.T.L.A.S. cuts six. The
 * owner's decision on that gap, verbatim:
 *
 *   "True topology inside the existing six-container contract. Do NOT change
 *    the six production cuts... Within DRIVER and PASSENGER only, add the
 *    appropriate vehicle topology/subregions needed for DesignPanelAI to
 *    understand the real vehicle structure... These are authoring/topology
 *    guidance only, not new canonical surfaces, not new seams, not new panel
 *    records, not new ZIP entries, and not new production outputs."
 *
 * So this changes exactly one thing: what the authoring model KNOWS about the
 * long rectangle it is painting. `SURFACE_KEYS` is untouched, `cutCallOnePanels`
 * still makes six files, `source.verify` still counts six, Call 11 still makes
 * six duplicates, and the ZIP still carries six panels.
 *
 * TWO RULES THIS OBEYS, BOTH LEARNED EXPENSIVELY.
 *
 * It draws NO geometry inside a container. RULE 0.28 §4 forbids body lines on
 * the master — "a line drawn on the master prints as a line on the wrap" — and
 * the owner repeated it here: "do not draw fake vehicle silhouettes over the
 * artwork and do not let topology guidance become printable content." The
 * regions therefore exist as manifest METADATA and as text in the flank's
 * GUTTER caption, which `normalizeAtlasMaster` masks away before a master
 * exists. Nothing new is paintable.
 *
 * It is DETERMINISTIC AND LOCAL. No classification call decides the body
 * style; a keyword read of the vehicle type does, in code, on the critical
 * path where a second AI stage is forbidden.
 *
 * The regions run FRONT TO REAR, which is the direction a flank unrolls, plus
 * the rocker band that runs the whole length along the bottom edge.
 */
const FLANK_TOPOLOGY_CONTRACT = "designpro.atlas-flank-topology.v1";
const FLANK_TOPOLOGY_BY_BODY = Object.freeze({
  pickup: Object.freeze(["FRONT FENDER", "CAB DOOR", "CAB REAR", "BED SIDE", "REAR QUARTER"]),
  van: Object.freeze(["FRONT FENDER", "CAB DOOR", "CARGO BODY", "REAR QUARTER"]),
  suv: Object.freeze(["FRONT FENDER", "FRONT DOOR", "REAR DOOR", "REAR QUARTER"]),
  car: Object.freeze(["FRONT FENDER", "FRONT DOOR", "REAR DOOR", "REAR QUARTER"]),
  box: Object.freeze(["CAB", "BOX SIDE"]),
});
const FLANK_ROCKER = "ROCKER";

/**
 * Which body the vehicle type names. Longest-match first, so "cargo van" reads
 * as a van rather than falling through, and an unrecognised type takes the
 * four-region car layout — the shape every passenger vehicle shares.
 */
function flankBodyStyle(vehicleType) {
  const text = String(vehicleType || "").toLowerCase();
  if (/\b(pickup|pick-up|truck bed|crew cab|super cab|quad cab|regular cab|f-?\d{3}|silverado|sierra|ram \d|tacoma|tundra|ranger|colorado|frontier|ridgeline|titan)\b/.test(text)) return "pickup";
  if (/\b(box truck|box van|cutaway|step van|straight truck)\b/.test(text)) return "box";
  if (/\b(van|transit|sprinter|promaster|express|savana|metris|nv\d*)\b/.test(text)) return "van";
  if (/\b(suv|wagon|crossover|tahoe|suburban|explorer|expedition|4runner|bronco|jeep)\b/.test(text)) return "suv";
  return "car";
}

/**
 * The flank's structure, as ordered regions plus the rocker band.
 *
 * Proportional, never pixel-placed: the model is told the ORDER and roughly how
 * much of the length each region occupies, which is what it needs to compose a
 * cohesive livery across a door line it must paint straight through. Exact
 * placement would be a seam, and a seam is what this must not become.
 */
function flankTopology(vehicleType) {
  const bodyStyle = flankBodyStyle(vehicleType);
  const regions = FLANK_TOPOLOGY_BY_BODY[bodyStyle];
  const share = Math.round((100 / regions.length) * 10) / 10;
  return {
    contract: FLANK_TOPOLOGY_CONTRACT,
    bodyStyle,
    printable: false,
    role: "authoring-guidance-only",
    // Said in the manifest so a later reader cannot mistake it for a cut list.
    note: "Structure the artwork should account for. Not surfaces, not seams, not panels; the livery paints straight through every one of them.",
    orderFrontToRear: regions.map((label, index) => ({
      label,
      order: index + 1,
      approximateLengthSharePct: share,
    })),
    fullLengthBands: [{ label: FLANK_ROCKER, edge: "bottom" }],
  };
}

/** The gutter caption's structure line, e.g. "FENDER › DOOR › DOOR › QUARTER". */
function flankTopologyCaption(topology) {
  if (!topology) return "";
  return topology.orderFrontToRear.map((region) => region.label).join(" › ");
}

/**
 * The clear gutter beside a container, as [near edge, far edge] on x.
 * Measured from the real zones, so a layout with tighter columns shrinks the
 * caption instead of pushing it into a neighbour.
 */
function captionGutter(zone, zones) {
  if (zone.placement === "right-flank") return [Number(zone.x) + Number(zone.w), CANVAS.widthPx];
  if (zone.placement === "left-flank") return [0, Number(zone.x)];
  // Centre column: the gutter between the left flank and this container.
  const flank = zones.find((candidate) => candidate.placement === "left-flank");
  const leftEdge = flank ? Number(flank.x) + Number(flank.w) : 0;
  return [leftEdge, Number(zone.x)];
}

function containerCaptionSvg(zone, zones) {
  const [near, far] = captionGutter(zone, zones);
  const width = far - near;
  if (!(width > 24)) return "";
  const name = (SURFACE_LABELS[zone.surfaceKey] || String(zone.surfaceKey)).toUpperCase();
  const id = SURFACE_IDS[zone.surfaceKey];
  const base = id ? `${id} · ${name}` : name;
  // The flank's real structure, in the gutter beside it — never inside the
  // container, where a glyph becomes a glyph in the printed panel (request
  // f3eb40c1). `normalizeAtlasMaster` masks the gutter away, so this is
  // structurally unprintable rather than merely discouraged.
  const structure = flankTopologyCaption(zone.flankTopology);
  const label = structure ? `${base} · ${structure}` : base;
  // The caption is rotated a quarter turn, so its cap height runs across the
  // gutter. Size it to fit with the same pad the guard measures.
  const size = Math.max(11, Math.min(52, Math.floor((width / 2) / LABEL_REACH)));
  const centreX = Math.round(near + width / 2);
  const centreY = Math.round(Number(zone.y) + Number(zone.h) / 2);
  // Read up the sheet on the left, down it on the right, so both captions face
  // outward from the containers they name.
  const rotation = zone.placement === "right-flank" ? 90 : -90;
  return `<text x="${centreX}" y="${centreY}" transform="rotate(${rotation} ${centreX} ${centreY})" `
    + `text-anchor="middle" dominant-baseline="central" fill="#1a1a1a" `
    + `font-family="Arial,sans-serif" font-size="${size}" font-weight="700" `
    + `letter-spacing="${Math.max(1, Math.round(size * 0.06))}">${label}</text>`;
}

/**
 * The sheet's bands: what this artifact IS, and that it is not printable.
 * Both sit in the canvas margin, outside every container.
 */

/** The container names. Shared by both guides. */
function guideLabelsSvg(manifest) {
  return manifest.zones.map((zone) => containerCaptionSvg(zone, manifest.zones)).join("");
}

/**
 * THE MODEL GETS THE SIX NAMES, BUT NONE OF THE PRODUCTION INVENTORY.
 *
 * Each short caption sits in the gutter beside its container, outside every
 * extraction rectangle. The image therefore carries the hardwired mapping the
 * A.T.L.A.S. prompt relies on without exposing dimensions, trim marks or flank
 * component vocabulary that an image model can reproduce as artwork.
 */
function authoringGuideLabelsSvg(manifest) {
  return manifest.zones.map((zone) => {
    const [near, far] = captionGutter(zone, manifest.zones);
    const width = far - near;
    if (!(width > 24)) return "";
    const id = SURFACE_IDS[zone.surfaceKey] || String(zone.surfaceKey).toUpperCase();
    const name = SURFACE_LABELS[zone.surfaceKey] || String(zone.surfaceKey).toUpperCase();
    const label = `${id} · ${name.toUpperCase()}`;
    const size = Math.max(11, Math.min(42, Math.floor((width / 2) / LABEL_REACH)));
    const x = Math.round(near + width / 2);
    const y = Math.round(Number(zone.y) + Number(zone.h) / 2);
    const rotation = zone.placement === "right-flank" ? 90 : -90;
    return `<text x="${x}" y="${y}" transform="rotate(${rotation} ${x} ${y})" `
      + `text-anchor="middle" dominant-baseline="central" fill="#d9d9d9" `
      + `font-family="Arial,sans-serif" font-size="${size}" font-weight="700" `
      + `letter-spacing="${Math.max(1, Math.round(size * 0.06))}">${label}</text>`;
  }).join("");
}

/**
 * THE TOPOLOGY UNDERLAY -- what makes this read as a vehicle seen from above
 * rather than three columns of boxes.
 *
 * A faint top-view silhouette scaled to the container extents, plus the light
 * grid the sheet draws. Structural, non-printable, and painted UNDER
 * everything so it can never be mistaken for artwork.
 */

/**
 * The geometry both guides share. Rectangles, fills, strokes -- the zone
 * authority itself, identical in each, so the two renders can never disagree
 * about where a surface is.
 */
function guideGeometrySvg(manifest) {
  return manifest.zones.map((zone) => {
    const trim = zone.trim || zone;
    // OUTER = the container, structural. INNER dashed = the printable area,
    // which the sheet's legend calls the exact panel crop. Two rectangles per
    // container, so a human and the model can both see where the bleed ends.
    return `<rect x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" rx="10" `
      + `fill="${zone.guideFill}" stroke="#ffffff" stroke-width="8"/>`
      + `<rect x="${trim.x}" y="${trim.y}" width="${trim.w}" height="${trim.h}" `
      + `fill="none" stroke="#9a9a9a" stroke-width="5" stroke-dasharray="26 18"/>`;
  }).join("");
}

/**
 * THE MODEL'S GUIDE IS GEOMETRY ONLY.
 *
 * There used to be one guide, and it went to three consumers at once: the
 * authoring model, the QC inspector and the human design team. It carried each
 * surface's name printed across the middle of that surface -- "HOOD" set at up
 * to 180px, bold, dead centre on the hood rectangle -- plus a footer reading
 * "TOPOLOGY GUIDE ONLY · GRAYS AND LABELS MUST NOT APPEAR IN ARTWORK".
 *
 * Handed a rectangle with a large bold word centred on it and asked to paint
 * artwork inside that rectangle, an image model paints the word. Live evidence
 * 2026-08-25 (generation eb7835a8-247b-443c-9804-e73f66379603, Carley's Chevy
 * Traverse): three consecutive authoring attempts were refused on
 * `artifactFreeContract`, the inspector reporting "The hood zone contains the
 * guide label 'HOOD'" and "The roof zone contains the guide label 'ROOF'". The
 * run died with zero masters, zero proofs and zero panels.
 *
 * The only defence was a sentence of prose telling the model the labels were
 * instructions rather than artwork -- and a negative instruction naming the
 * forbidden thing is the one prompt shape Gemini reliably over-indexes on. The
 * footer was that same instruction rendered as pixels INSIDE the image it was
 * warning about.
 *
 * So the guide is split by consumer instead. The model receives only the six
 * plain filled rectangles. It receives no captions, strokes, dimensions, trim
 * marks, title/footer or component vocabulary. The structured panel list is
 * the identity layer: it states PS=left, DS=right and RR/RF/HD/FR=center in
 * order, and the edge function refuses an incomplete or mismatched map.
 *
 * Live canary 33337222395 proved that even short OUTSIDE captions and a white
 * rectangle stroke are unsafe visual authority. The model copied them inward,
 * then treated the whole neutral sheet as a labelled vehicle diagram despite a
 * prose firewall. Side identity therefore lives in data and code, never in the
 * pixels shown to the creative model.
 *
 * The labelled guide is unchanged and still rendered: it is what the design
 * team reads, what enters durable storage as `guide_storage_path`, and what the
 * QC inspector receives as IMAGE 2 -- which is precisely what lets
 * `artifactFreeContract` keep working, because the inspector still has the
 * annotations to look for. Removing the labels there would have blinded the
 * check that caught this.
 */
function authoringGuideSvg(manifest) {
  const rectangles = manifest.zones.map((zone) => (
    `<rect x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" `
      + `fill="${zone.guideFill}"/>`
  )).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.widthPx}" height="${CANVAS.heightPx}" viewBox="0 0 ${CANVAS.widthPx} ${CANVAS.heightPx}">
    <rect width="100%" height="100%" fill="#111111"/>
    ${rectangles}
  </svg>`);
}

/** The human-readable installer map. Labels stay; the design team needs them. */
function guideSvg(manifest) {
  const zoneLabels = manifest.zones.map(zoneLabelSvg).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.widthPx}" height="${CANVAS.heightPx}" viewBox="0 0 ${CANVAS.widthPx} ${CANVAS.heightPx}">
    <rect width="100%" height="100%" fill="#111111"/>
    ${guideGeometrySvg(manifest)}
    ${zoneLabels}
    <text x="2048" y="4050" text-anchor="middle" fill="#d9d9d9" font-family="Arial,sans-serif" font-size="25">TOPOLOGY GUIDE ONLY · GRAYS AND LABELS MUST NOT APPEAR IN ARTWORK</text>
  </svg>`);
}

async function rasterizeGuide(svg) {
  return sharp(svg, { density: 96 })
    .resize(CANVAS.widthPx, CANVAS.heightPx, { fit: "fill", kernel: "nearest" })
    .png(PNG_OPTIONS)
    .toBuffer();
}

/** The labelled installer map: persisted, shown to humans, inspected by QC. */
async function renderAtlasGuide(manifest) {
  return rasterizeGuide(guideSvg(manifest));
}

/** Neutral geometry mask. This is the only image the authoring model sees. */
async function renderAtlasAuthoringGuide(manifest) {
  const svg = authoringGuideSvg(manifest);
  // Fail closed on ANY visual instruction beyond the six masks. The human guide
  // stays fully labelled; this one is not a diagram and cannot teach the image
  // model to paint a caption, outline or template into customer artwork.
  const markup = svg.toString("utf8");
  const forbiddenAuthoringMarkup = [
    [/stroke-dasharray/i, "dashed trim geometry"],
    [/<text\b/i, "text labels"],
    [/<line\b/i, "line geometry"],
    [/<path\b/i, "path geometry"],
    [/<polygon\b/i, "polygon geometry"],
    [/\bstroke=/i, "outline geometry"],
  ];
  for (const [pattern, label] of forbiddenAuthoringMarkup) {
    if (pattern.test(markup)) {
      throw new FlatAtlasError(
        "flat_atlas_authoring_guide_contains_technical_furniture",
        `The model-facing A.T.L.A.S. guide contains ${label}; it must remain six neutral spatial masks only`,
      );
    }
  }
  return rasterizeGuide(svg);
}

function activeZoneMaskSvg(manifest) {
  const rectangles = manifest.zones.map((zone) => (
    `<rect x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" fill="#ffffff"/>`
  )).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.widthPx}" height="${CANVAS.heightPx}" viewBox="0 0 ${CANVAS.widthPx} ${CANVAS.heightPx}">${rectangles}</svg>`);
}

async function normalizeAtlasMaster(generatedBytes, manifest) {
  const image = sharp(generatedBytes, { limitInputPixels: false }).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width < 1024 || metadata.height < 1024) {
    throw new FlatAtlasError("flat_atlas_master_too_small", "Gemini returned an atlas smaller than 1024 pixels");
  }
  const aspect = metadata.width / metadata.height;
  if (Math.abs(aspect - 1) > 0.08) {
    throw new FlatAtlasError("flat_atlas_master_aspect_invalid", `Gemini returned ${metadata.width}x${metadata.height}; the canonical atlas is square`);
  }
  const resized = await image
    .resize(CANVAS.widthPx, CANVAS.heightPx, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .png(PNG_OPTIONS)
    .toBuffer();
  const bytes = await sharp(resized, { limitInputPixels: false })
    .composite([{ input: activeZoneMaskSvg(manifest), blend: "dest-in" }])
    .png(PNG_OPTIONS)
    .toBuffer();
  // WHAT GEMINI ACTUALLY DELIVERED, before this resize touched it.
  //
  // The canvas is always 4096 because the line above fills to it -- which means
  // a smaller return is silently UPSCALED and the master reports 4K either way.
  // The floor here is only 1024, so "Call 1 is 4K" was unprovable: the delivered
  // size was measured, used for two sanity checks, and thrown away. It is now
  // carried out so the run records its true optical resolution rather than the
  // canvas it was stretched onto.
  return {
    bytes,
    deliveredWidthPx: Number(metadata.width),
    deliveredHeightPx: Number(metadata.height),
    nativelyFourK: Number(metadata.width) >= CANVAS.widthPx && Number(metadata.height) >= CANVAS.heightPx,
  };
}

/**
 * Request-safe derivative for Gemini proof conditioning.
 *
 * The PNG remains canonical and immutable. This is a transport derivative:
 * same 4096x4096 pixels, white outside the atlas zones, JPEG 4:4:4, and the
 * first deterministic quality rung that fits the hard binary budget. No
 * resize, crop, rotation or generative operation is permitted here.
 */
async function projectionDerivative(masterBytes) {
  const metadata = await sharp(masterBytes, { limitInputPixels: false }).metadata();
  if (metadata.width !== CANVAS.widthPx || metadata.height !== CANVAS.heightPx) {
    throw new FlatAtlasError(
      "flat_atlas_projection_dimensions_invalid",
      `Canonical atlas must be ${CANVAS.widthPx}x${CANVAS.heightPx} before proof conditioning; received ${metadata.width || 0}x${metadata.height || 0}`,
    );
  }
  for (const quality of PROJECTION_QUALITY_LADDER) {
    const bytes = await sharp(masterBytes, { limitInputPixels: false })
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .toColourspace("srgb")
      // Explicit knobs keep the output reproducible under the pinned sharp /
      // libvips build rather than inheriting encoder heuristics.
      .jpeg({
        quality,
        chromaSubsampling: "4:4:4",
        progressive: false,
        optimiseCoding: false,
        trellisQuantisation: false,
        overshootDeringing: false,
        optimiseScans: false,
        mozjpeg: false,
        force: true,
      })
      .toBuffer();
    if (bytes.length <= PROJECTION_MAX_BYTES) {
      return {
        contract: PROJECTION_CONTRACT,
        bytes,
        contentHash: sha256(bytes),
        byteSize: bytes.length,
        contentType: "image/jpeg",
        widthPx: CANVAS.widthPx,
        heightPx: CANVAS.heightPx,
        quality,
        chromaSubsampling: "4:4:4",
        flattenedBackground: "#ffffff",
        base64ByteSize: Math.ceil(bytes.length / 3) * 4,
        sourceMasterHash: sha256(masterBytes),
      };
    }
  }
  throw new FlatAtlasError(
    "flat_atlas_projection_budget_exhausted",
    `A ${CANVAS.widthPx}x${CANVAS.heightPx} 4:4:4 JPEG could not fit the ${PROJECTION_MAX_BYTES}-byte proof-conditioning budget without resizing`,
  );
}

function surfaceForProofView(sourceViewType) {
  if (!PROOF_VIEWS.includes(sourceViewType) || !VIEW_SURFACE[sourceViewType]) {
    throw new FlatAtlasError(
      "flat_atlas_proof_view_invalid",
      `${sourceViewType || "missing"} is not one of Driver, Passenger, Hood, Front, Rear, Close-Up, Roof`,
    );
  }
  return VIEW_SURFACE[sourceViewType];
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EACH 3D PROOF IS FED ITS OWN CANONICAL CALL-1 PANEL. (Trish 2026-08-27)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, verbatim: "The 3D proofs should not render directly from the whole
 * ATLAS master. They should render per side from the panel for that
 * side... Each proof uses its own Call-1 panel as immutable artwork
 * authority." RULE 0.28 §6 already specified it -- "buildViewAuthorities /
 * viewAuthorityFor must hash-bind to the persisted Call-1 panel rather than to
 * a fresh crop of the master" -- and listed it as not yet built. This builds it.
 *
 * WHAT THIS CHANGES, PRECISELY: NOT THE PIXELS. This used to run its OWN
 * `sharp.extract` over the repaired sheet using `zone.extraction` -- the exact
 * rect and rotation `cutCallOnePanels` uses for the panel. Two crops, same
 * region, one encoded PNG and one encoded JPEG. So the authority is now an
 * encode OF THE PANEL rather than a second cut of the master, and on any sheet
 * both routes produce the same image; what changes is that there is one source
 * of those pixels instead of two that merely agree, and the authority now
 * carries `panelContentHash`, so a proof can PROVE it was conditioned on the
 * panel the customer buys rather than on something that resembles it.
 *
 * The budget ladder is unchanged: the request has a byte ceiling, so quality
 * steps down until the encode fits, and an exhausted ladder still refuses
 * rather than resizing the artwork.
 */
async function viewAuthorityFromPanel(panel, sourceViewType) {
  const surfaceKey = surfaceForProofView(sourceViewType);
  if (!panel || panel.surfaceKey !== surfaceKey || !Buffer.isBuffer(panel.bytes) || !panel.bytes.length) {
    throw new FlatAtlasError(
      "flat_atlas_view_authority_panel_missing",
      `${sourceViewType}: the extracted ${surfaceKey} panel is not available as artwork authority`,
    );
  }
  for (const quality of PROJECTION_QUALITY_LADDER) {
    const bytes = await sharp(panel.bytes, { limitInputPixels: false })
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .toColourspace("srgb")
      .jpeg({
        quality,
        chromaSubsampling: "4:4:4",
        progressive: false,
        optimiseCoding: false,
        trellisQuantisation: false,
        overshootDeringing: false,
        optimiseScans: false,
        mozjpeg: false,
        force: true,
      })
      .toBuffer();
    if (bytes.length <= VIEW_AUTHORITY_MAX_BYTES) {
      const metadata = await sharp(bytes, { failOn: "error" }).metadata();
      return Object.freeze({
        contract: VIEW_AUTHORITY_CONTRACT,
        sourceViewType,
        surfaceKey,
        bytes,
        contentHash: sha256(bytes),
        byteSize: bytes.length,
        contentType: "image/jpeg",
        widthPx: Number(metadata.width),
        heightPx: Number(metadata.height),
        quality,
        chromaSubsampling: "4:4:4",
        // LINEAGE stays the repaired sheet, unchanged, because that is what
        // `viewAuthorityFor` and the persisted revision bind against.
        sourceMasterHash: panel.surfaceSourceHash,
        // PROVENANCE is explicit: the exact canonical Call-1 panel these pixels encode.
        panelContentHash: panel.contentHash,
        panelByteSize: Number(panel.byteSize),
      });
    }
  }
  throw new FlatAtlasError(
    "flat_atlas_view_authority_budget_exhausted",
    `${sourceViewType}: exact ${surfaceKey} panel cannot fit ${VIEW_AUTHORITY_MAX_BYTES} bytes without resizing`,
  );
}

async function cutCallOnePanels(surfaceSourceBytes, manifest, canonicalMasterHash, {
  onPanel = null,
  onPanelRetry = null,
  // Optional observation only. A timing consumer can never change extraction
  // success, bytes, order or retry behaviour -- even if that consumer throws.
  onPanelTiming = null,
} = {}) {
  const zones = Array.isArray(manifest?.zones) ? manifest.zones : [];
  // LINEAGE, NOT PROVENANCE. `sourceMasterHash` is the identity PanelPro pairs
  // a panel with its proof by, so it has to be the CANONICAL master hash the
  // proof also publishes -- not the hash of the repaired duplicate the pixels
  // were cut from. Those are equal on a clean sheet and differ on a repaired
  // one, and publishing the repaired hash here made a correct pair report as
  // "the proof and the panel came from different masters". The repaired sheet
  // is still recorded, per panel, as `surfaceSourceHash`.
  const surfaceSourceHash = sha256(surfaceSourceBytes);
  const lineageHash = HASH_RE.test(String(canonicalMasterHash || ""))
    ? String(canonicalMasterHash)
    : surfaceSourceHash;
  // FAIL CLOSED IF THE MANIFEST IDENTITY IS ABSENT. (Trish 2026-08-27, locked)
  //
  // "Fail closed if those provenance fields are absent." A panel that cannot
  // name the GENIE manifest its container was built from cannot be proven to
  // share geometry with its own proof, and an unprovable panel is exactly the
  // artifact this whole chain exists to make impossible. Cutting six of them
  // and discovering it at the board is the expensive order to find out.
  const geometry = manifest?.geometryResolution || null;
  if (!geometry || !HASH_RE.test(String(geometry.genieManifestHash || ""))) {
    throw new FlatAtlasError(
      "flat_atlas_geometry_manifest_identity_missing",
      "Call-1 panels require the GENIE manifest identity that built their containers",
    );
  }
  // SEQUENTIAL, IN THE OWNER'S ORDER, RELEASING EACH PANEL AS IT LANDS.
  //
  // This was `Promise.all(SURFACE_KEYS.map(...))`. Six concurrent 4096x4096
  // sharp extracts finish sooner in aggregate, but they finish TOGETHER -- and
  // a barrier is exactly what the orchestration forbids: "Do not use
  // Promise.all to redefine the six panel extraction algorithm if the canonical
  // extractor is intentionally ordered... each completed panel emits a
  // panel.ready(surfaceKey) event that makes its corresponding proof node
  // runnable immediately" (owner, 2026-08-27).
  //
  // So the cut is ordered and `onPanel` fires the instant each panel exists,
  // before the next one starts. The caller uses that to persist it, publish it
  // to PanelPro, and release that surface's 3D proof. Driver is first, so the
  // Driver panel and its proof are unblocked while Roof has not been touched.
  // AN EXTRACTION FAILURE RETRIES THAT PANEL, NOT THE RUN.
  //
  // Owner's retry model: "Extraction Failure (rare) -> Retry that panel
  // extraction. Downstream proof waits for that panel only." A single throw
  // here used to reject Call 1 outright, which released every gate and took all
  // seven proof nodes with it -- the blast radius the graph exists to prevent.
  //
  // The cut is deterministic pixel work, so a failure is transient (memory, IO)
  // or permanent (a zone genuinely outside the canvas). Retrying separates
  // them: a transient one clears, a permanent one fails identically twice and
  // is then allowed to be fatal, because a run cannot ship five panels and call
  // itself complete -- `source.verify` asserts exactly six.
  const panels = [];
  for (const surfaceKey of PANEL_EXTRACTION_ORDER) {
    let panel = null;
    for (let attempt = 1; attempt <= PANEL_CUT_ATTEMPTS; attempt += 1) {
      const extractionStartedAt = Date.now();
      try {
        panel = await cutOnePanel(surfaceKey);
        break;
      } catch (cause) {
        if (attempt >= PANEL_CUT_ATTEMPTS) throw cause;
        onPanelRetry?.({ surfaceKey, attempt, reason: String(cause?.message || cause || "unknown") });
      } finally {
        try {
          onPanelTiming?.({
            surfaceKey,
            attempt,
            durationMs: Date.now() - extractionStartedAt,
          });
        } catch {
          // Observability is not workflow authority.
        }
      }
    }
    panels.push(panel);
    if (typeof onPanel === "function") await onPanel(panel, panels.length - 1);
  }
  return panels;

  async function cutOnePanel(surfaceKey) {
    const zone = zones.find((candidate) => candidate.surfaceKey === surfaceKey);
    if (!zone?.extraction) {
      throw new FlatAtlasError("flat_atlas_panel_zone_missing", `${surfaceKey} master zone is missing`);
    }
    const extract = {
      left: Number(zone.extraction.x),
      top: Number(zone.extraction.y),
      width: Number(zone.extraction.w),
      height: Number(zone.extraction.h),
    };
    if (!Object.values(extract).every(Number.isSafeInteger)
      || extract.left < 0 || extract.top < 0 || extract.width < 1 || extract.height < 1
      || extract.left + extract.width > CANVAS.widthPx
      || extract.top + extract.height > CANVAS.heightPx) {
      throw new FlatAtlasError("flat_atlas_panel_zone_invalid", `${surfaceKey} extraction is outside the canonical master`);
    }
    const bytes = await sharp(surfaceSourceBytes, { limitInputPixels: false })
      .extract(extract)
      .rotate(Number(zone.extraction.outputRotationDegrees || 0))
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .toColourspace("srgb")
      .png()
      .toBuffer();
    const metadata = await sharp(bytes).metadata();
    return Object.freeze({
      contract: CALL_ONE_PANEL_CONTRACT,
      surfaceKey,
      bytes,
      contentHash: sha256(bytes),
      byteSize: bytes.length,
      contentType: "image/png",
      pixelWidth: Number(metadata.width || 0),
      pixelHeight: Number(metadata.height || 0),
      // The design-time size of this surface. GENIE replaces it with the
      // validated production size only when the pack is ordered.
      trimWidthIn: Number(zone.trimWidthIn),
      trimHeightIn: Number(zone.trimHeightIn),
      printWidthIn: Number(zone.printWidthIn),
      printHeightIn: Number(zone.printHeightIn),
      surfaceSqFt: Number(zone.surfaceSqFt),
      bleedInches: BLEED_INCHES,
      effectivePpi: Number(zone.effectivePpi),
      geometryPurpose: "calls-1-7-layout-only",
      sourceMasterHash: lineageHash,
      surfaceSourceHash,
      // ── PROVENANCE. PANELPRO MUST BE ABLE TO PROVE WHAT MADE THIS PANEL. ──
      //
      // Owner, 2026-08-27: "`method` is NULL. `deterministic` is NULL... those
      // fields being null means PanelPro cannot currently prove what produced
      // those panel artifacts." They were never written, so every panel on the
      // board was unattributable -- indistinguishable from an AI re-render.
      //
      // A Call-1 panel is a `sharp.extract` of the accepted master and nothing
      // else, so it is deterministic by construction and says so. The GENIE
      // identity that built the container is carried through unchanged, which
      // is what makes "the same manifest drove the container and the crop" a
      // checkable fact rather than an assumption.
      method: "deterministic_atlas_crop",
      deterministic: true,
      genieManifestId: geometry.genieManifestId,
      genieManifestHash: geometry.genieManifestHash,
      // NAMED `geometryAuthorityState`, not `geometryAuthority`. The manifest
      // already publishes `geometryAuthority` as an OBJECT (contract, status,
      // candidateId, operatorValidated...), and `viewAuthorityFor` reads
      // `.status` off it. A string of the same name on the panel shadowed that
      // object downstream and turned a validated authority into "derived".
      geometryAuthorityState: geometry.state,
      geometrySourceRowId: geometry.geometrySourceRowId,
      derivationContract: geometry.derivedSurfaces?.includes(surfaceKey)
        ? geometry.derivationContract
        : null,
      productionEligible: geometry.productionEligible === true,
    });
  }
}

/**
 * Seven proof views over six panels -- Close-Up shares Driver's surface, so it
 * shares Driver's panel. Keyed by surface, so a view can only ever be handed
 * the panel for the surface it photographs.
 *
 * These encodes are cheap and independent of each other, and by the time this
 * runs every panel already exists, so nothing here is a barrier between
 * branches -- the streaming release happened in `cutCallOnePanels`'s `onPanel`.
 */
async function buildViewAuthorities(panels) {
  const bySurface = new Map((Array.isArray(panels) ? panels : []).map((panel) => [panel.surfaceKey, panel]));
  const entries = await Promise.all(PROOF_VIEWS.map(async (sourceViewType) => [
    sourceViewType,
    await viewAuthorityFromPanel(bySurface.get(surfaceForProofView(sourceViewType)), sourceViewType),
  ]));
  return Object.freeze(Object.fromEntries(entries));
}

// The one sheet both halves of the fan-out derive from. On a clean master this
// IS the master hash; on a sheet that arrived with cut-outs it is the hash of
// the deterministic repair, which is what the panels were cut from and what the
// proofs are conditioned on.
function surfaceSourceHashOf(atlas) {
  const recorded = atlas?.metadata?.panelSourceHash;
  return HASH_RE.test(String(recorded || "")) ? String(recorded) : atlas?.master?.contentHash;
}

/**
 * Does the revision's own record of this surface's Call 1 panel agree with the
 * panel hash the proof authority carries? A revision with no recorded panels is
 * historical -- it predates the panel-fed authority -- and must stay readable
 * (owner protection #1), so absence passes and only DISAGREEMENT convicts.
 */
function panelHashMatches(atlas, surfaceKey, panelContentHash) {
  const recorded = Array.isArray(atlas?.callOnePanels) ? atlas.callOnePanels : [];
  if (!recorded.length) return true;
  const entry = recorded.find((candidate) => candidate?.surfaceKey === surfaceKey);
  if (!entry || !entry.contentHash) return true;
  return String(entry.contentHash).toLowerCase() === String(panelContentHash).toLowerCase();
}

/**
 * THE PERSISTED PANEL THIS PROOF IS PHOTOGRAPHED FROM.
 *
 * `viewAuthorityFor` returns the in-memory JPEG derivative the runtime used to
 * condition a projection. The photographer edge function needs something
 * different and stricter: the STORAGE PATH of the exact Call-1 panel plus its
 * hash, so the function can read the customer's real artifact itself and prove
 * it is the one the caller named.
 *
 * Both are bound to the same surface and the same master, so a proof produced
 * this way carries the identity RULE 0.21 pairs the two UIs by.
 */
function atlasPanelForProofView(atlas, sourceViewType) {
  const surfaceKey = surfaceForProofView(sourceViewType);
  const panels = Array.isArray(atlas?.callOnePanels) ? atlas.callOnePanels : [];
  const panel = panels.find((candidate) => candidate?.surfaceKey === surfaceKey);
  if (!panel || !panel.storagePath || !HASH_RE.test(String(panel.contentHash || ""))) {
    throw new FlatAtlasError(
      "flat_atlas_proof_panel_unavailable",
      `${sourceViewType}: the ${surfaceKey} Call-1 panel is not persisted yet, so its 3D proof has no artwork authority`,
      true,
    );
  }
  return Object.freeze({
    surfaceKey,
    sourceViewType,
    // Every other view's surface is fixed by geometry; the close-up's is chosen.
    // Saying which it was keeps a Driver detail from ever reading as an
    // accident downstream.
    surfaceSelection: sourceViewType === "close-up"
      ? `default-${CLOSE_UP_DEFAULT_DETAIL_SURFACE}-detail`
      : "fixed-by-surface",
    storagePath: String(panel.storagePath),
    contentHash: String(panel.contentHash).toLowerCase(),
    contentType: String(panel.contentType || "image/png"),
    sourceMasterHash: String(panel.sourceMasterHash || atlas?.master?.contentHash || ""),
  });
}

function viewAuthorityFor(atlas, sourceViewType) {
  const authority = atlas?.viewAuthorities?.[sourceViewType];
  const expectedSurface = surfaceForProofView(sourceViewType);
  if (!authority || authority.contract !== VIEW_AUTHORITY_CONTRACT
    || authority.sourceViewType !== sourceViewType
    || authority.surfaceKey !== expectedSurface
    || authority.contentType !== "image/jpeg"
    || !Buffer.isBuffer(authority.bytes)
    || authority.bytes.length !== Number(authority.byteSize)
    || authority.bytes.length > VIEW_AUTHORITY_MAX_BYTES
    || sha256(authority.bytes) !== authority.contentHash
    // Bound to the SURFACE SOURCE -- the repaired sheet the panels are cut
    // from, which equals the canonical master byte for byte whenever the sheet
    // arrived without cut-outs.
    || authority.sourceMasterHash !== surfaceSourceHashOf(atlas)
    // AND BOUND TO THE PANEL ITSELF. The proof's artwork authority IS this
    // surface's canonical Call-1 panel (owner, 2026-08-27), so it carries that panel's
    // hash and the revision's own record of that panel has to agree. Without
    // this the two could drift apart and every downstream pairing would still
    // report a match.
    || !HASH_RE.test(String(authority.panelContentHash || ""))
    || !panelHashMatches(atlas, expectedSurface, authority.panelContentHash)) {
    throw new FlatAtlasError(
      "flat_atlas_view_authority_identity_mismatch",
      `${sourceViewType}: exact ${expectedSurface} authority is not bound to the immutable master`,
    );
  }
  return authority;
}

function customerCreativeBrief(input) {
  const vehicle = input?.vehicle || {};
  const values = {
    creativeBrief: String(input?.brief || "").trim(),
    designName: String(input?.designName || "").trim(),
    mode: String(input?.mode || "commercial").trim(),
    businessName: String(input?.companyName || input?.businessName || "").trim(),
    industry: String(input?.industry || "").trim(),
    colors: Array.isArray(input?.colors) ? input.colors.map(String) : [],
    brandColors: String(input?.brandColors || "").trim(),
    style: String(input?.style || "").trim(),
    finish: String(input?.finish || "Gloss").trim(),
    substrate: String(input?.substrate || "standard").trim(),
    mascot: String(input?.mascot || "").trim(),
    brandKeywords: Array.isArray(input?.bulletPoints) ? input.bulletPoints.map(String) : [],
    fontStyle: String(input?.fontStyle || "").trim(),
    phone: String(input?.phone || "").trim(),
    website: String(input?.website || "").trim(),
    qrEnabled: input?.qrEnabled === true,
    qrDestination: String(input?.qrUrl || "").trim(),
    textLayerDirection: String(input?.textLayerPrompt || "").trim(),
    referenceIntent: String(input?.visionboardIntent || "").trim(),
    referenceStyleDescriptors: String(input?.styleDescriptors || "").trim(),
    verifiedLogoAttached: Boolean(input?.logoAsset),
    verifiedCustomerReferenceCount: Array.isArray(input?.visionBoardImages) ? input.visionBoardImages.length : 0,
    vehicle: [vehicle.year, vehicle.make, vehicle.model, vehicle.type].map((value) => String(value || "").trim()).filter(Boolean).join(" "),
  };
  return JSON.stringify(values);
}

// THE CONTAINER LABELS, EXACTLY AS THE OWNER NAMES THEM (Trish 2026-08-27):
// "LABELED ATLAS CONTAINER Driver Side, Passenger Side, Hood, Roof, Rear and
// Front." These are the strings on the labelled installer map and in the
// GENIE panel list the Call-1 request carries.
//
// The short names and two-letter IDs are drawn only in the gutters of the
// authoring guide, outside every extraction rectangle. Dimensions, trim marks
// and component vocabulary stay server-only. The model therefore receives the
// identity mapping it needs without putting production inventory into artwork.
const SURFACE_LABELS = Object.freeze({
  driver: "Driver Side",
  passenger: "Passenger Side",
  hood: "Hood",
  roof: "Roof",
  front: "Front",
  rear: "Rear",
});

// The canonical Call-1 request. Everything creative happens INSIDE the deployed
// design-panel-ai-generate edge function (mode "atlas-artboard", executing the
// real Persona-2 buildDesignerPrompt). This builder only maps the verified v3
// input and the GENIE manifest onto that function's request body.
function atlasEdgeRequestBody(input, manifest, extras = {}) {
  const vehicle = input?.vehicle || {};
  const brandColors = String(input?.brandColors || "").trim()
    || (Array.isArray(input?.colors) ? input.colors.map(String).filter(Boolean).join(", ") : String(input?.colors || "").trim());
  const styleDna = String(input?.styleDescriptors || "").trim();
  const brief = [
    String(input?.brief || "").trim(),
    brandColors ? `Brand colors: ${brandColors}.` : "",
    String(input?.style || "").trim() ? `Style direction: ${String(input.style).trim()}.` : "",
    styleDna ? `Reference style DNA: ${styleDna}` : "",
  ].filter(Boolean).join("\n");
  return {
    mode: "atlas-artboard",
    authoringMode: String(input?.mode || "commercial").toLowerCase() === "restyle" ? "restyle" : "commercial",
    prompt: brief,
    finish: String(input?.finish || "Gloss"),
    companyName: String(input?.companyName || input?.businessName || "").trim() || undefined,
    phone: String(input?.phone || "").trim() || undefined,
    website: String(input?.website || "").trim() || undefined,
    textLayerPrompt: String(input?.textLayerPrompt || "").trim() || undefined,
    mascot: String(input?.mascot || "").trim() || undefined,
    industryType: String(input?.industry || "").trim() || undefined,
    bulletPoints: Array.isArray(input?.bulletPoints) ? input.bulletPoints.map(String) : undefined,
    vehicleYear: String(vehicle.year || "").trim(),
    vehicleMake: String(vehicle.make || "").trim(),
    vehicleModel: String(vehicle.model || "").trim(),
    vehicleType: String(vehicle.type || vehicle.vehicleClass || "").trim(),
    logoSupplied: Boolean(input?.logoAsset),
    visionboard_intent: ["exact_reference", "artboard_projection"].includes(String(input?.visionboardIntent || "").trim())
      ? "exact_reference"
      : "style_inspiration",
    // `surfaceId` and `placement` bind each neutral guide rectangle to server
    // metadata. They are never visual captions: the guide is deliberately
    // unlabelled, and the edge explicitly forbids rendering names/IDs into the
    // artwork that will be cropped as a production surface.
    panels: manifest.zones.map((zone) => ({
      label: SURFACE_LABELS[zone.surfaceKey] || String(zone.surfaceKey).toUpperCase(),
      surfaceId: SURFACE_IDS[zone.surfaceKey] || String(zone.surfaceKey).toUpperCase(),
      placement: zone.placement,
    })),
    // The deterministic guide travels by STORAGE PATH: a 2.2MB inline-base64
    // body killed the edge worker twice (2026-08-27). Customer references stay
    // inline — they are already size-capped at 1600px by the verified loader.
    guideStoragePath: extras.guideStoragePath,
    // Release-owned flat teaching example. It travels as a content-addressed
    // server storage path, never as browser-controlled reference input. No
    // finished vehicle proof reaches Call 1; the solid rectangular atlas is
    // followed by the current neutral target guide.
    cohesionExampleFlatStoragePath: extras.cohesionExampleFlatStoragePath,
    cohesionExampleIdentity: extras.cohesionExampleIdentity,
    referenceImagesBase64: extras.referenceImagesBase64,
    correctiveNote: extras.correctiveNote,
  };
}

async function callAtlasArtboardEdge(body, { logger = () => {}, fetchImpl = fetch, ownerId, supabase } = {}) {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!supabase?.storage?.from) {
    throw new FlatAtlasError("flat_atlas_edge_transport_missing", "A server Supabase client is required to read the returned master", true);
  }
  if (!supabaseUrl || serviceRoleKey.length < 32) {
    throw new FlatAtlasError("flat_atlas_edge_transport_missing", "SUPABASE_URL / service key are required for the Call-1 edge request", true);
  }
  const response = await fetchImpl(`${supabaseUrl}/functions/v1/design-panel-ai-generate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "content-type": "application/json",
      "x-designpro-owner-id": String(ownerId || ""),
    },
    body: JSON.stringify(body),
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || payload?.success !== true) {
    throw new FlatAtlasError(
      "flat_atlas_edge_call_failed",
      `design-panel-ai-generate atlas-artboard failed (HTTP ${response.status}): ${String(payload?.error || "no body").slice(0, 400)}`,
      response.status >= 500,
    );
  }
  if (Number(payload.imageRequestCount) !== 1) {
    throw new FlatAtlasError("flat_atlas_edge_call_count_invalid", `The edge function reported ${payload.imageRequestCount} image requests; the contract is exactly 1`);
  }
  const expectedTeaching = body?.cohesionExampleIdentity || null;
  if (expectedTeaching) {
    const returned = payload?.cohesionExampleIdentity || null;
    if (!returned
      || returned.contract !== expectedTeaching.contract
      || returned.flattenedTopViewContentHash !== expectedTeaching.flattenedTopViewContentHash) {
      throw new FlatAtlasError(
        "flat_atlas_edge_teaching_example_identity_mismatch",
        "The edge function did not prove the release-pinned flat A.T.L.A.S. teaching identity",
      );
    }
  }
  // The master comes back by STORAGE PATH and is read with the server client:
  // wrap-files is private, so a URL fetch 400s (live 2026-08-27).
  const masterPath = String(payload.masterStoragePath || "").trim();
  if (!masterPath) {
    throw new FlatAtlasError("flat_atlas_edge_master_path_missing", "The edge function returned no master storage path");
  }
  const { data: masterBlob, error: masterErr } = await supabase.storage.from(BUCKET).download(masterPath);
  if (masterErr || !masterBlob) {
    throw new FlatAtlasError("flat_atlas_edge_master_download_failed", masterErr?.message || `Could not read ${masterPath}`, true);
  }
  const bytes = Buffer.from(await masterBlob.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== String(payload.masterSha256 || "").toLowerCase()) {
    throw new FlatAtlasError("flat_atlas_edge_master_hash_mismatch", "Downloaded master bytes do not match the edge function's reported sha256");
  }
  logger(`atlas-artboard edge request ${payload.requestId} model=${payload.model} promptChars=${payload.promptChars}`);
  return {
    bytes,
    provenance: {
      requestId: String(payload.requestId),
      functionName: String(payload.functionName),
      sourceCommit: String(payload.sourceCommit),
      promptVersion: String(payload.promptVersion),
      model: String(payload.model),
      imageRequestCount: 1,
      modelRequestByteSize: Number(payload.modelRequestByteSize) || null,
      modelInputImageCount: Number(payload.modelInputImageCount) || null,
      cohesionExampleIdentity: payload.cohesionExampleIdentity || null,
      masterSha256: digest,
      designText: String(payload.designText || ""),
    },
  };
}

async function verifiedCustomerLogoPart(supabase, input) {
  const asset = input?.logoAsset;
  if (!asset) return [];
  if (["url", "signedUrl", "publicUrl", "downloadUrl"].some((key) => asset?.[key] != null)) {
    throw new FlatAtlasError("flat_atlas_logo_identity_invalid", "The customer logo must use immutable Storage identity, never a URL");
  }
  const storagePath = String(asset.storagePath || "").trim();
  const contentHash = String(asset.contentHash || "").trim().toLowerCase();
  const byteSize = Number(asset.byteSize);
  if (!storagePath || !HASH_RE.test(contentHash) || !Number.isSafeInteger(byteSize) || byteSize < 1) {
    throw new FlatAtlasError("flat_atlas_logo_identity_invalid", "The customer logo identity is incomplete");
  }
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) throw new FlatAtlasError("flat_atlas_logo_download_failed", error?.message || "Customer logo bytes are missing", true);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length !== byteSize || sha256(bytes) !== contentHash) {
    throw new FlatAtlasError("flat_atlas_logo_hash_mismatch", "Customer logo bytes do not match the verified request identity");
  }
  const conditioned = await sharp(bytes, { limitInputPixels: CUSTOMER_REFERENCE_MAX_PIXELS, density: 300 })
    .rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .png(PNG_OPTIONS).toBuffer();
  return [
    { text: "VERIFIED CUSTOMER-OWNED LOGO. This is a customer style/identity source, not a topology example." },
    { inlineData: { mimeType: "image/png", data: conditioned.toString("base64") } },
  ];
}

async function verifiedCustomerReferenceParts(supabase, input) {
  const assets = Array.isArray(input?.visionBoardImages) ? input.visionBoardImages : [];
  const intent = String(input?.visionboardIntent || "style_inspiration");
  const label = intent === "exact_reference" || intent === "artboard_projection"
    ? "VERIFIED CUSTOMER-OWNED EXACT DESIGN REFERENCE. This is customer artwork authority, not an installer-map topology example."
    : "VERIFIED CUSTOMER-OWNED STYLE REFERENCE. Use its style only; this is not an installer-map topology example.";
  const parts = [];
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    if (["url", "signedUrl", "publicUrl", "downloadUrl"].some((key) => asset?.[key] != null)) {
      throw new FlatAtlasError("flat_atlas_reference_identity_invalid", `Customer reference ${index + 1} contains a URL instead of immutable identity`);
    }
    const storagePath = String(asset?.storagePath || "").trim();
    const contentHash = String(asset?.contentHash || "").trim().toLowerCase();
    const byteSize = Number(asset?.byteSize);
    if (!storagePath || !HASH_RE.test(contentHash) || !Number.isSafeInteger(byteSize) || byteSize < 1) {
      throw new FlatAtlasError("flat_atlas_reference_identity_invalid", `Customer reference ${index + 1} identity is incomplete`);
    }
    const { data, error } = await supabase.storage.from(asset.bucket || BUCKET).download(storagePath);
    if (error || !data) {
      throw new FlatAtlasError("flat_atlas_reference_download_failed", error?.message || `Customer reference ${index + 1} bytes are missing`, true);
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length !== byteSize || sha256(bytes) !== contentHash) {
      throw new FlatAtlasError("flat_atlas_reference_hash_mismatch", `Customer reference ${index + 1} bytes do not match its verified identity`);
    }
    const conditioned = await sharp(bytes, { limitInputPixels: CUSTOMER_REFERENCE_MAX_PIXELS, density: 300 })
      .rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
      .png(PNG_OPTIONS).toBuffer();
    parts.push(
      { text: `${label} Reference ${index + 1} of ${assets.length}.` },
      { inlineData: { mimeType: "image/png", data: conditioned.toString("base64") } },
    );
  }
  return parts;
}

async function topologyExampleParts(examples = []) {
  const parts = [];
  for (const example of examples) {
    if (example?.kind === "paired-flat-to-finished") {
      if (!Buffer.isBuffer(example?.flattenedTopView?.bytes)
        || !Buffer.isBuffer(example?.finished3dProof?.bytes)) {
        throw new FlatAtlasError(
          "flat_atlas_topology_example_invalid",
          "The paired topology lesson requires release-owned flattened and finished proof bytes",
        );
      }
      // THE PAIR IS THE LESSON. Restored verbatim 2026-08-24 after a session
      // removed the finished proof on the theory that having a vehicle in the
      // context window was what produced the wheel-arch cut-outs. That was the
      // wrong conclusion and it cost the design: an A.T.L.A.S. master IS a
      // flattened top view OF A VEHICLE WRAP, so it legitimately carries the
      // vehicle's panel geometry -- door seams, rocker and hood contours, the
      // shapes an installer cuts to. The bundled Houdini pair shows exactly
      // that. Telling the model "nothing here depicts a vehicle" removed the
      // very thing that makes the sheet a wrap layout instead of abstract art.
      //
      // The real defect was never the geometry, it was the HOLES: openings
      // rendered as absent instead of painted through. That is now closed
      // deterministically after authoring (atlas-cutout-fill.cjs), so the
      // teaching pair carries no risk worth trading the design quality for.
      const flattened = await sharp(example.flattenedTopView.bytes, { limitInputPixels: false })
        .rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
        .png(PNG_OPTIONS).toBuffer();
      const finished = await sharp(example.finished3dProof.bytes, { limitInputPixels: false })
        .rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
        .png(PNG_OPTIONS).toBuffer();
      parts.push(
        { text: "PAIRED TOPOLOGY EXAMPLE — FLATTENED TOP-VIEW OUTPUT FORMAT. Study how all visible vehicle surfaces are intentionally composed into one unwrapped design. Copy no artwork, wording, logo, color or brand." },
        { inlineData: { mimeType: "image/png", data: flattened.toString("base64") } },
        { text: "PAIRED TOPOLOGY EXAMPLE — CORRESPONDING FINISHED 3D PROOF. This shows how the preceding flat design reads after projection onto the vehicle. It is context only; do not return a vehicle image in Call 1 and copy no style." },
        { inlineData: { mimeType: "image/png", data: finished.toString("base64") } },
        { text: "CALL 1 TARGET: create the customer's NEW flattened top-view design in the deterministic guide layout. The seven finished 3D proof views are downstream projections of that saved master." },
      );
      continue;
    }
    if (!Buffer.isBuffer(example?.bytes)) throw new FlatAtlasError("flat_atlas_topology_example_invalid", "Topology examples must be server-owned bytes");
    const conditioned = await sharp(example.bytes, { limitInputPixels: false })
      .rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
      .png(PNG_OPTIONS).toBuffer();
    parts.push(
      { text: "TOPOLOGY-ONLY EXAMPLE. Read panel arrangement/orientation/masks/seam intent only. Ignore every color, graphic, word, logo, brand and style." },
      { inlineData: { mimeType: "image/png", data: conditioned.toString("base64") } },
    );
  }
  return parts;
}

async function boundedQualityExample(bytes) {
  for (const width of [1400, 1200, 1024]) {
    for (const quality of [86, 80, 74, 68, 62]) {
      const candidate = await sharp(bytes, { limitInputPixels: CUSTOMER_REFERENCE_MAX_PIXELS })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
        .jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer();
      if (candidate.length <= 1_250_000) return candidate;
    }
  }
  throw new FlatAtlasError(
    "flat_atlas_artboard_quality_example_too_large",
    "A DesignPanel gold-standard artboard example could not fit the bounded master request",
  );
}

async function artboardQualityExampleParts(examples = []) {
  const parts = [];
  for (let index = 0; index < examples.length; index += 1) {
    const example = examples[index];
    if (example?.kind !== "designpanel-artboard-quality" || !Buffer.isBuffer(example?.bytes)) {
      throw new FlatAtlasError(
        "flat_atlas_artboard_quality_example_invalid",
        "DesignPanel quality examples must be the server-native loadArtboardExamples result",
      );
    }
    const conditioned = await boundedQualityExample(example.bytes);
    parts.push(
      {
        text: `DESIGNPANEL GOLD-STANDARD ARTBOARD ${index + 1} — PRODUCTION-QUALITY REFERENCE ONLY. Match its professional depth, finish, hierarchy, connected-wrap coherence and gallery-grade execution. Copy none of its artwork, palette, wording, logo, brand, panel geometry or topology; the FIRST deterministic A.T.L.A.S. guide alone controls topology.`,
      },
      { inlineData: { mimeType: "image/jpeg", data: conditioned.toString("base64") } },
    );
  }
  return parts;
}

function estimatedMasterRequestBytes(parts) {
  return Buffer.byteLength(JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "1:1", imageSize: "4K" },
    },
  }));
}

function assertMasterRequestWithinLimit(parts, maxBytes = MASTER_REQUEST_MAX_BYTES) {
  const configured = Number(maxBytes);
  const boundedMax = Math.min(
    MASTER_REQUEST_MAX_BYTES,
    Number.isFinite(configured) && configured > 0 ? configured : MASTER_REQUEST_MAX_BYTES,
  );
  const byteSize = estimatedMasterRequestBytes(parts);
  if (byteSize > boundedMax) {
    throw new FlatAtlasError(
      "flat_atlas_master_request_too_large",
      `The one A.T.L.A.S. design request is ${byteSize} bytes, above the bounded ${boundedMax}-byte Gemini request budget`,
    );
  }
  return byteSize;
}

function safePathPart(value, label) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(text)) throw new FlatAtlasError("flat_atlas_path_identity_invalid", `${label} is not storage-safe`);
  return text;
}

function atlasStoragePath({ tenantKey, generationId, revisionSequence = 1, kind, contentHash }) {
  const tenant = safePathPart(tenantKey, "tenantKey");
  const generation = safePathPart(generationId, "generationId");
  if (!HASH_RE.test(String(contentHash || ""))) throw new FlatAtlasError("flat_atlas_hash_invalid", `${kind} content hash is invalid`);
  const prefix = `designpro/${tenant}/${generation}/flat-first/v1`;
  if (kind === "guide") return `${prefix}/guide/${contentHash}.png`;
  if (kind === "manifest") return `${prefix}/manifest/${contentHash}.json`;
  if (kind === "master") return `${prefix}/revisions/${Number(revisionSequence)}/master/${contentHash}.png`;
  if (kind === "projection") return `${prefix}/revisions/${Number(revisionSequence)}/projection/${contentHash}.jpg`;
  if (kind === "panel") return `${prefix}/revisions/${Number(revisionSequence)}/panels/${contentHash}.png`;
  throw new FlatAtlasError("flat_atlas_artifact_kind_invalid", `Unknown atlas artifact ${kind}`);
}

async function downloadVerified(supabase, storagePath, expectedHash, expectedBytes) {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) throw new FlatAtlasError("flat_atlas_artifact_download_failed", `${storagePath}: ${error?.message || "missing"}`, true);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length !== Number(expectedBytes) || sha256(bytes) !== expectedHash) {
    throw new FlatAtlasError("flat_atlas_artifact_identity_mismatch", `${storagePath} does not match its immutable row`);
  }
  return bytes;
}

async function rowIdentity(row, manifest, masterBytes, surfaceSourceBytes, projectionBytes, { reused, panels = null }) {
  // THE AUTHORITIES COME FROM THE PANELS, ON BOTH PATHS.
  //
  // A fresh run hands its just-cut panels straight in. A RESUMED run has none
  // in memory, so it re-cuts them from the repaired sheet -- deterministically,
  // by the same code, from the same rects -- and then PROVES the result against
  // the hashes the revision recorded. That check is the point: it is the same
  // guarantee `flat_atlas_surface_source_mismatch` gives the sheet itself, one
  // level down, and it means a resumed proof is conditioned on bytes identical
  // to the panel the customer is buying rather than on bytes that merely ought
  // to be.
  const authorityPanels = Array.isArray(panels) && panels.length
    ? panels
    : await cutCallOnePanels(surfaceSourceBytes, manifest, row.master_content_hash);
  const recorded = Array.isArray(row.metadata?.callOnePanels) ? row.metadata.callOnePanels : [];
  if (recorded.length) {
    for (const panel of authorityPanels) {
      const match = recorded.find((entry) => entry.surfaceKey === panel.surfaceKey);
      if (match && String(match.contentHash || "").toLowerCase() !== panel.contentHash) {
        throw new FlatAtlasError(
          "flat_atlas_panel_rebuild_mismatch",
          `${panel.surfaceKey}: re-cut panel does not reproduce the recorded Call 1 panel`,
        );
      }
    }
  }
  const viewAuthorities = await buildViewAuthorities(authorityPanels);
  return {
    contract: ATLAS_CONTRACT,
    revisionId: row.id,
    revisionSequence: Number(row.revision_sequence),
    parentRevisionId: row.parent_revision_id || null,
    model: row.model,
    promptVersion: row.prompt_version,
    widthPx: Number(row.width_px),
    heightPx: Number(row.height_px),
    effectivePpi: Number(row.effective_ppi),
    productionEligible: row.production_eligible === true,
    topologyExample: row.example_id ? {
      exampleId: row.example_id,
      guideContentHash: row.example_guide_hash,
      masterContentHash: row.example_master_hash,
    } : null,
    // The six panels Call 1 cut, each with the design-time size of its side.
    // Read off the immutable row so a resumed run projects the same sizes it
    // cut with, rather than re-deriving them.
    callOnePanels: Array.isArray(row.metadata?.callOnePanels) ? row.metadata.callOnePanels : [],
    guide: {
      storagePath: row.guide_storage_path,
      contentHash: row.guide_content_hash,
      byteSize: Number(row.guide_byte_size),
      contentType: row.guide_content_type,
    },
    manifestAsset: {
      storagePath: row.manifest_storage_path,
      contentHash: row.manifest_content_hash,
      byteSize: Number(row.manifest_byte_size),
      contentType: row.manifest_content_type,
    },
    master: {
      storagePath: row.master_storage_path,
      contentHash: row.master_content_hash,
      byteSize: Number(row.master_byte_size),
      contentType: row.master_content_type,
      bytes: masterBytes,
    },
    projection: {
      contract: PROJECTION_CONTRACT,
      storagePath: row.projection_storage_path,
      contentHash: row.projection_content_hash,
      byteSize: Number(row.projection_byte_size),
      contentType: row.projection_content_type,
      bytes: projectionBytes,
      sourceMasterHash: sha256(surfaceSourceBytes),
      quality: Number(row.metadata?.projectionQuality),
      chromaSubsampling: "4:4:4",
      widthPx: Number(row.width_px),
      heightPx: Number(row.height_px),
    },
    viewAuthorities,
    masterAcceptance: {
      contract: row.metadata?.masterQcContract || null,
    confidence: row.metadata?.masterQcConfidence == null
      ? null
      : Number(row.metadata.masterQcConfidence),
      model: row.metadata?.masterQcModel || null,
      promptHash: row.metadata?.masterPromptHash || null,
      providerContract: row.metadata?.masterProviderContract || null,
      artboardPortVersion: row.metadata?.designPanelArtboardPortVersion || null,
      passed: row.metadata?.masterQcPassed === true,
      // WHAT ACTUALLY GATED THIS MASTER. The deterministic pixel checks decide
      // acceptance now; the semantic judge is recorded and flags but never
      // blocks. A consumer that still reads `confidence` alone is reading the
      // opinion of something that no longer decides anything.
      basis: row.metadata?.masterAcceptance || null,
    },
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    manifest,
    reused,
  };
}

async function loadLatestAtlasRevision(supabase, requestId) {
  const { data: row, error } = await supabase.from("designpro_flat_atlas_revisions")
    .select("*").eq("request_id", requestId)
    .order("revision_sequence", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new FlatAtlasError("flat_atlas_revision_lookup_failed", error.message, true);
  if (!row) return null;
  const [guideBytes, manifestBytes, masterBytes, projectionBytes] = await Promise.all([
    downloadVerified(supabase, row.guide_storage_path, row.guide_content_hash, row.guide_byte_size),
    downloadVerified(supabase, row.manifest_storage_path, row.manifest_content_hash, row.manifest_byte_size),
    downloadVerified(supabase, row.master_storage_path, row.master_content_hash, row.master_byte_size),
    downloadVerified(supabase, row.projection_storage_path, row.projection_content_hash, row.projection_byte_size),
  ]);
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); }
  catch { throw new FlatAtlasError("flat_atlas_manifest_invalid", "Stored atlas manifest is not JSON"); }
  if (manifest.contract !== MANIFEST_CONTRACT || sha256(canonicalBytes(manifest)) !== row.manifest_content_hash) {
    throw new FlatAtlasError("flat_atlas_manifest_identity_mismatch", "Stored atlas manifest does not match the immutable row");
  }
  if (sha256(guideBytes) !== row.guide_content_hash) throw new FlatAtlasError("flat_atlas_guide_identity_mismatch", "Stored atlas guide hash drifted");
  if (row.projection_content_type !== "image/jpeg" || projectionBytes.length > PROJECTION_MAX_BYTES) {
    throw new FlatAtlasError("flat_atlas_projection_identity_mismatch", "Stored proof-conditioning derivative violates its JPEG byte budget");
  }
  // The repaired sheet is recomputed, never stored: `fillMasterCutouts` is
  // deterministic, so a resumed run rebuilds exactly the bytes the first pass
  // cut and conditioned from, and the recorded `panelSourceHash` proves it.
  const surfaceFill = await fillMasterCutouts(
    masterBytes, manifest,
    Array.isArray(row.metadata?.masterCutoutSurfaces) ? row.metadata.masterCutoutSurfaces : [],
  );
  const surfaceSourceBytes = surfaceFill.bytes;
  const surfaceSourceHash = surfaceFill.changed ? sha256(surfaceSourceBytes) : row.master_content_hash;
  const recordedSurfaceSourceHash = row.metadata?.panelSourceHash || row.master_content_hash;
  if (surfaceSourceHash !== recordedSurfaceSourceHash) {
    throw new FlatAtlasError(
      "flat_atlas_surface_source_mismatch",
      "The deterministic cut-out repair no longer reproduces the surface source this revision recorded",
    );
  }
  const expectedProjection = await projectionDerivative(surfaceSourceBytes);
  if (expectedProjection.contentHash !== row.projection_content_hash
    || expectedProjection.byteSize !== Number(row.projection_byte_size)) {
    throw new FlatAtlasError("flat_atlas_projection_source_mismatch", "Stored proof-conditioning derivative is not the deterministic child of the canonical PNG master");
  }
  return rowIdentity(row, manifest, masterBytes, surfaceSourceBytes, projectionBytes, { reused: true });
}

function atlasReceipt(atlas) {
  return {
    contract: ATLAS_CONTRACT,
    revisionId: atlas.revisionId,
    revisionSequence: atlas.revisionSequence,
    parentRevisionId: atlas.parentRevisionId,
    model: atlas.model,
    promptVersion: atlas.promptVersion,
    topology: atlas.manifest.topology,
    productionEligible: atlas.productionEligible,
    widthPx: atlas.widthPx,
    heightPx: atlas.heightPx,
    effectivePpi: atlas.effectivePpi,
    examplePurpose: EXAMPLE_PURPOSE,
    geometryAuthority: atlas.manifest.geometryAuthority,
    topologyExample: atlas.topologyExample,
    masterAcceptance: atlas.masterAcceptance,
    guide: atlas.guide,
    manifest: atlas.manifestAsset,
    master: {
      storagePath: atlas.master.storagePath,
      contentHash: atlas.master.contentHash,
      byteSize: atlas.master.byteSize,
      contentType: atlas.master.contentType,
    },
    projection: {
      contract: PROJECTION_CONTRACT,
      storagePath: atlas.projection.storagePath,
      contentHash: atlas.projection.contentHash,
      byteSize: atlas.projection.byteSize,
      contentType: atlas.projection.contentType,
      sourceMasterHash: atlas.master.contentHash,
      quality: atlas.projection.quality,
      chromaSubsampling: "4:4:4",
    },
    viewAuthorities: Object.fromEntries(PROOF_VIEWS.map((sourceViewType) => {
      const authority = viewAuthorityFor(atlas, sourceViewType);
      return [sourceViewType, {
        contract: authority.contract,
        sourceViewType,
        surfaceKey: authority.surfaceKey,
        contentHash: authority.contentHash,
        byteSize: authority.byteSize,
        contentType: authority.contentType,
        widthPx: authority.widthPx,
        heightPx: authority.heightPx,
        sourceMasterHash: authority.sourceMasterHash,
        // The panel this proof's artwork IS. `sourceZone` is gone with the
        // second crop that produced it -- the authority is now an encode of the
        // canonical Call-1 panel, not a rect over the master, so the panel's identity
        // is the provenance a reader needs.
        panelContentHash: authority.panelContentHash,
        panelByteSize: authority.panelByteSize,
      }];
    })),
  };
}

function assertAtlasGeometryBasis(atlas, expectedManifestHash) {
  if (atlas?.manifestAsset?.contentHash !== expectedManifestHash) {
    throw new FlatAtlasError(
      "flat_atlas_geometry_basis_changed",
      "The immutable A.T.L.A.S. geometry basis changed; start a new design revision instead of reusing stale artwork",
    );
  }
  return atlas;
}

function exampleSetHash(topologyExamples = [], artboardQualityExamples = []) {
  return sha256(canonicalBytes({
    topology: topologyExamples.map((example) => example?.identity || null),
    designPanelArtboardQuality: artboardQualityExamples.map((example) => example?.identity || null),
  }));
}

function assertAtlasReuseContract(atlas, {
  expectedManifestHash,
  expectedPromptHash,
  expectedExampleSetHash,
}) {
  assertAtlasGeometryBasis(atlas, expectedManifestHash);
  const acceptance = atlas?.masterAcceptance || {};
  const metadata = atlas?.metadata || {};
  const current = atlas?.promptVersion === PROMPT_VERSION
    && acceptance.passed === true
    && acceptance.contract === MASTER_QC_CONTRACT
    && acceptance.providerContract === MASTER_PROVIDER_CONTRACT
    && acceptance.artboardPortVersion === DESIGNPANEL_ARTBOARD_PORT_VERSION
    && acceptance.promptHash === expectedPromptHash
    && metadata.masterExampleSetHash === expectedExampleSetHash;
  if (!current) {
    throw new FlatAtlasError(
      "flat_atlas_master_contract_stale",
      "The saved A.T.L.A.S. master predates the current DesignPanel prompt/provider/master-QC contract; start a new design request instead of reusing it",
    );
  }
  return atlas;
}

async function generateOrReuseFlatAtlas(options) {
  const {
    supabase, store, provider, requestId, generationId, tenantKey, ownerId,
    claimToken, input, surfaces, geometryAuthority, geometryResolution = null,
    // panel.ready(surfaceKey). Called with that surface's identity and
    // dimensions the moment its panel exists, before the next cut starts, so a
    // consumer can publish it and release its 3D proof without waiting for the
    // set. Failures are logged and never propagate: Branch A does not stop for
    // Branch B.
    onSurfaceReady = null,
    // The root node, handed over the instant the master is accepted and the
    // repaired sheet exists -- before a single panel is cut. Its `viewAuthorities`
    // and `callOnePanels` fill in as the extraction stream runs, so a consumer
    // that gates on `onSurfaceReady` can condition that surface's proof against
    // it immediately.
    onMasterReady = null,
    // The Call-1 transport is injectable so a unit test can drive the authoring
    // loop without a live edge function. Production always uses the real POST.
    callEdge = callAtlasArtboardEdge,
    masterRequestMaxBytes = MASTER_REQUEST_MAX_BYTES,
    logger = () => {},
  } = options;
  // Owner protection #5: the acceptance run spends EXACTLY one image call —
  // maxAuthoringAttempts (or DESIGNPRO_ATLAS_MAX_AUTHORING_ATTEMPTS) pins the
  // re-roll budget to 1, and the exact count is reported on the revision.
  const maxAuthoringAttempts = resolveMaxAuthoringAttempts(options.maxAuthoringAttempts);
  if (!supabase || !store || !provider) throw new FlatAtlasError("flat_atlas_runtime_missing", "Atlas authoring requires Supabase, store and provider");
  if (!flatFirstRequested(input)) throw new FlatAtlasError("flat_atlas_input_required", "Atlas authoring only accepts the v3 flat-first input");

  const manifest = buildAtlasManifest(surfaces, geometryAuthority, input?.vehicle?.type);
  // OWNER-SELECTED FLAT TEACHING EXAMPLE. It contains six cohesive solid
  // rectangles with no wheel wells, bed opening or vehicle anatomy. The
  // installed Driver proof is intentionally not a Call-1 input: finished
  // vehicle imagery overpowers prose and reintroduces the anatomy the source
  // rectangles must exclude. The flat bytes are release-pinned and their
  // identity enters the reuse fence below.
  const cohesionExample = loadBundledAtlasCohesionExample();
  // The resolver's manifest identity rides on the built manifest, so
  // `cutCallOnePanels` can bind it to every panel and refuse to cut without it.
  if (geometryResolution) manifest.geometryResolution = geometryResolution;

  // VISIONBOARDIQ RUNS BEFORE THE DESIGN CALL, AND ITS RESULT GOES INTO IT.
  //
  // The reference derives style DNA from the customer's reference images and
  // hands it to the authoring prompt (index.ts:661). The runtime consumed
  // `styleDescriptors` in four places and produced it in none, so across all 11
  // real A.T.L.A.S. runs it was populated on zero: the STYLE INSPIRATION branch
  // could never fire and reference images arrived as pictures with no extracted
  // intelligence.
  //
  // The bytes are downloaded and hash-verified ONCE here and the same parts are
  // reused in the request below, so adding the pre-pass costs no extra storage
  // reads. A caller-supplied `styleDescriptors` wins — the pre-pass fills a gap,
  // it never overrides an answer the caller already has.
  //
  // It supplements the persona and never gates it: on failure, on refusal, on
  // timeout and when no references were supplied at all, this is null and the
  // design call proceeds on the brief with its full professional-design
  // behaviour intact.
  const customerReferenceParts = await verifiedCustomerReferenceParts(supabase, input);
  const visionBoardStyleDna = String(input?.styleDescriptors || "").trim()
    || await analyzeVisionBoardStyles({ provider, referenceParts: customerReferenceParts });
  const authoringInput = visionBoardStyleDna
    ? { ...input, styleDescriptors: visionBoardStyleDna }
    : input;

  // The creative half states the quality bar against the gold-standard
  // artboards only when they are actually in the request. On the live droplet
  // the bucket holds none, and the sentence was pointing at attachments that
  // were never sent.
  // The Call-1 creative prompt is assembled INSIDE the deployed
  // design-panel-ai-generate edge function; the runtime's request identity is
  // the canonical edge request body (stable fields only) plus that function's
  // pinned prompt version, so the reuse contract still refuses a request whose
  // creative inputs changed.
  const stableEdgeBody = atlasEdgeRequestBody(authoringInput, manifest, {});
  const promptHash = sha256(Buffer.from(
    `${ATLAS_ARTBOARD_EDGE_PROMPT_VERSION}\n${JSON.stringify(stableEdgeBody)}`,
    "utf8",
  ));
  // The current solid-rectangle pair is deliberately distinct from the
  // historical Houdini/template examples that taught doors, windows, handles
  // and wheel arches. Its identity is part of the immutable reuse contract.
  const currentExampleSetHash = sha256(canonicalBytes({
    atlasDesignTeachingExample: cohesionExample.identity,
  }));
  const existing = await loadLatestAtlasRevision(supabase, requestId);
  if (existing) {
    const expectedManifestHash = sha256(canonicalBytes(manifest));
    assertAtlasReuseContract(existing, {
      expectedManifestHash,
      expectedPromptHash: promptHash,
      expectedExampleSetHash: currentExampleSetHash,
    });
    logger(`reused immutable atlas revision ${existing.revisionSequence} ${existing.master.contentHash}`);
    return existing;
  }

  // A request lease can expire while an image call is in flight. Claim a
  // durable, append-only authoring fence before spending the single Atlas
  // master call so a replacement worker cannot create a second master.
  const { data: authoringClaimed, error: authoringClaimError } = await supabase.rpc(
    "claim_designpro_flat_atlas_authoring",
    { p_request_id: requestId, p_claim_token: claimToken },
  );
  if (authoringClaimError) {
    throw new FlatAtlasError(
      "flat_atlas_authoring_fence_failed",
      authoringClaimError.message || "The Atlas authoring fence could not be acquired",
      true,
    );
  }
  if (authoringClaimed !== true) {
    throw new FlatAtlasError(
      "flat_atlas_authoring_already_started",
      "This request already spent its one Atlas master-authoring attempt",
    );
  }

  const revisionSequence = 1;
  const manifestBytes = canonicalBytes(manifest);
  const manifestHash = sha256(manifestBytes);
  // TWO RENDERS OF ONE GEOMETRY, SPLIT BY CONSUMER.
  //
  // `guideBytes` is the labelled installer map: it is what enters storage, what
  // the design team reads, and what the QC inspector compares the master
  // against -- so `artifactFreeContract` still has annotations to look for.
  // `authoringGuideBytes` is the same six rectangles as a neutral, unlabelled,
  // unstroked mask; it is the one the authoring model is shown. Surface identity
  // travels separately in the schema-bound panel list.
  const guideBytes = await renderAtlasGuide(manifest);
  const guideHash = sha256(guideBytes);
  const authoringGuideBytes = await renderAtlasAuthoringGuide(manifest);
  const guideStoragePath = atlasStoragePath({ tenantKey, generationId, revisionSequence, kind: "guide", contentHash: guideHash });
  const manifestStoragePath = atlasStoragePath({ tenantKey, generationId, revisionSequence, kind: "manifest", contentHash: manifestHash });

  // Customer-owned imagery remains a separate authority class. The release-
  // owned pair below can teach only the flat↔installed relationship; it may
  // never become style or artwork authority for this customer.
  const customerImageParts = [
    ...(await verifiedCustomerLogoPart(supabase, input)),
    ...customerReferenceParts,
  ].filter((part) => part?.inlineData?.data);
  // Stage the guide where the edge function can read it with its
  // own service client. Content-addressed and upserted, so a retry or a second
  // revision re-uses the same object instead of writing another copy.
  const stageEdgeInput = async (bytes, contentType) => {
    if (!bytes || !bytes.length) return undefined;
    const path = `atlas-call1-inputs/${sha256(bytes)}.${contentType === "image/jpeg" ? "jpg" : "png"}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (error) {
      throw new FlatAtlasError("flat_atlas_edge_input_upload_failed", error.message || `Could not stage ${path}`, true);
    }
    return path;
  };
  const [cohesionExampleFlatStoragePath, targetGuideStoragePath] = await Promise.all([
    stageEdgeInput(
      cohesionExample.flattenedTopView.bytes,
      cohesionExample.flattenedTopView.contentType,
    ),
    stageEdgeInput(authoringGuideBytes, "image/png"),
  ]);
  const edgeExtras = {
    cohesionExampleFlatStoragePath,
    cohesionExampleIdentity: cohesionExample.identity,
    // The TARGET guide is intentionally staged last in the edge image order.
    guideStoragePath: targetGuideStoragePath,
    referenceImagesBase64: customerImageParts.map((part) => part.inlineData.data),
  };
  // ONE AUTHORING, BOUNDED RE-ROLLS. The authoring fence above is claimed once,
  // so no replacement worker can mint a second master -- but inside that fence a
  // rejected candidate is not "the design": it was never persisted and nobody
  // saw it. Killing the whole run on the first rejection made every A.T.L.A.S.
  // request a coin flip on Gemini honouring SOLID PANELS in one throw (live,
  // 2026-08-24: the first real run after the cutout gate shipped died exactly
  // there). A rejection now re-rolls with the gate's own findings appended as
  // corrective direction -- the same generate/inspect/correct loop the proof QC
  // already runs -- and only the exhausted case fails the run.
  let generated;
  let masterBytes;
  let masterHash;
  let masterRequestByteSize = 0;
  let masterAuthoringAttempts = 0;
  let masterDelivery = null;
  let masterCutoutSurfaces = [];
  let masterCutoutFindings = [];
  // The pixel measurements that actually decided acceptance, kept for the row.
  let masterDeterministic = null;
  const edgeProvenance = [];
  let correctiveNote = "";
  // OPTIMIZE TIME TO DRIVER, AND MEASURE IT. (Owner, 2026-08-27: "click->master,
  // master->Driver, click->Driver ... those are the primary latency metrics.")
  // Call 1 owns the first of those three, so it records its own segments on the
  // immutable revision -- an argument about latency is then a query, not a
  // stopwatch held against a browser tab.
  const callOneStartedAt = Date.now();
  const timings = {
    authoringMs: 0,
    normalizeMs: 0,
    deterministicMs: 0,
    repairMs: 0,
    panelExtractionMs: 0,
    viewAuthorityMs: 0,
    projectionMs: 0,
    uploadWaitMs: 0,
    semanticWaitMs: 0,
  };
  for (let attempt = 1; attempt <= maxAuthoringAttempts; attempt += 1) {
    masterAuthoringAttempts = attempt;
    const attemptBody = atlasEdgeRequestBody(authoringInput, manifest, {
      ...edgeExtras,
      correctiveNote: correctiveNote || undefined,
    });
    masterRequestByteSize = Buffer.byteLength(JSON.stringify(attemptBody), "utf8");
    if (masterRequestByteSize > masterRequestMaxBytes) {
      throw new FlatAtlasError(
        "flat_atlas_master_request_too_large",
        `The Call-1 edge request is ${masterRequestByteSize} bytes; the cap is ${masterRequestMaxBytes}`,
      );
    }
    // THE ONE CREATIVE NETWORK CALL. The deployed design-panel-ai-generate
    // edge function executes the real Persona-2 designer brain and makes
    // exactly one Gemini image request per attempt; this runtime never calls
    // Gemini for Call 1 (owner directive 2026-08-27).
    const authoringStartedAt = Date.now();
    generated = await callEdge(attemptBody, { logger, ownerId, supabase });
    timings.authoringMs += Date.now() - authoringStartedAt;
    edgeProvenance.push(generated.provenance);
    const normalizeStartedAt = Date.now();
    const normalized = await normalizeAtlasMaster(generated.bytes, manifest);
    timings.normalizeMs += Date.now() - normalizeStartedAt;
    masterBytes = normalized.bytes;
    masterDelivery = normalized;
    masterHash = sha256(masterBytes);

    const deterministicStartedAt = Date.now();
    const deterministic = await deterministicMasterChecks(masterBytes, manifest);
    timings.deterministicMs += Date.now() - deterministicStartedAt;
    masterDeterministic = deterministic;
    const cutoutSurfacesOf = (result) => [...new Set(
      (result?.cutoutFindings || []).map((item) => String(item.surfaceKey)),
    )].sort();

    // PASSENGER IS AUTHORITY, NOT A DERIVATIVE.
    //
    // `passengerMirrorMae` remains in `deterministic` as useful continuity
    // telemetry. It is deliberately absent from `blockingFailures`: two named
    // Call-1 surfaces may share a design system while legitimately differing in
    // placement, text and vehicle-side anatomy. Replacing Passenger with a
    // pixel mirror of Driver destroys that authored region and can make a fake
    // Passenger look structurally "better" than the actual accepted design.
    // No semantic call or image rewrite occurs here.

    // ── REPAIR 2: A CUT-OUT IS FILLED, NEVER RE-ROLLED FOR ────────────────
    //
    // RULE 0.15 / the 2026-08-24 owner ruling: re-rolling for a hole costs ~60s
    // and buys nothing, because `atlas-cutout-fill` closes it in ~100ms by
    // growing the surrounding livery inward. The surfaces that arrived holed
    // are still recorded so PanelPro's human QC sees them flagged.
    //
    // The fill itself is applied once, below, to the SURFACE SOURCE duplicate --
    // the authored master is never mutated. This only classifies.
    masterCutoutSurfaces = cutoutSurfacesOf(deterministic);
    masterCutoutFindings = (deterministic.cutoutFindings || []).map((item) => String(item.finding));

    // ── THE GATE ─────────────────────────────────────────────────────────
    //
    // Only deterministic structural failures refuse the candidate. Subjective
    // semantic review is advisory and cannot stall or terminate Call 1.
    // `deterministic` measures the exact candidate bytes. Passenger continuity
    // telemetry never enters this structural refusal set.
    const stillBlocking = deterministic.blockingFailures || [];
    const refusalCode = "flat_atlas_master_deterministic_failed";
    const refusalReason = stillBlocking.join("; ").slice(0, 600);
    if (!stillBlocking.length) {
      break;
    }
    if (attempt === maxAuthoringAttempts) {
      throw new FlatAtlasError(
        refusalCode,
        `The flattened A.T.L.A.S. design call failed acceptance ${attempt} times: ${refusalReason.slice(0, 700)}`,
      );
    }
    // ASK FOR THE FULL CANVAS BACK WHEN IT ARRIVED SHORT.
    //
    // Owner 2026-08-27: "Make sure atlas is highest possible 4K or more
    // resolution." The request already pins Gemini's maximum
    // (imageConfig.imageSize "4K" at 1:1) and the canvas is 4096x4096 -- but a
    // smaller return is stretched onto it by normalizeAtlasMaster, so the
    // master reports 4K either way and only `masterNativelyFourK` knows the
    // difference. Nothing acted on it. Since this attempt is being spent
    // anyway, spend it asking for the pixels too.
    const shortDelivery = masterDelivery && masterDelivery.nativelyFourK === false
      ? ` The previous sheet came back at ${masterDelivery.deliveredWidthPx}x${masterDelivery.deliveredHeightPx}, below the 4096x4096 production canvas -- return the full 4K square so the panels carry real detail rather than an upscale.`
      : "";
    correctiveNote = `CORRECTION -- the previous sheet was refused by production QC and discarded: ${refusalReason}.${shortDelivery} Author a NEW sheet. `
      + "Every panel is one SOLID rectangle of continuous artwork, opaque corner to corner: paint the artwork straight through every position where a window, glass panel, wheel, wheel arch, lamp, bed opening or trim piece would sit. The installer cuts those openings out of the printed vinyl; the artwork itself never contains a dark or empty shape standing in for one.";
  }
  const masterStoragePath = atlasStoragePath({ tenantKey, generationId, revisionSequence, kind: "master", contentHash: masterHash });
  // ONE REPAIRED SHEET FEEDS BOTH HALVES OF THE FAN-OUT.
  //
  // `masterBytes` is never touched: it is persisted as authored and stays the
  // lineage identity (`canonicalMasterHash`, the revision's `master_content_hash`
  // and every UI binding). When the sheet arrives with a wheel arch or a glass
  // band punched through it, the SURFACE SOURCE is a duplicate whose holes are
  // closed by continuing the artwork that borders them -- deterministic pixel
  // work, no AI, no second producer of design. The six panels are cut from it
  // AND the seven proofs are conditioned on it.
  //
  // THE PROOFS USED TO BE CONDITIONED ON THE HOLED ORIGINAL, on the stated
  // theory that a hole "lands in the region the proof masks away". Canary
  // 6667efac-6d62-4e8f-bf3c-39aa805ed352 (2026-08-26) disproved that: the driver
  // and passenger flanks came back with 26.7% of each zone punched out in four
  // components, which is a vehicle SILHOUETTE, not a wheel arch. The proof QC
  // is shown that exact surface crop, and refused every view conditioned on it
  // -- "The candidate proof shows a Ford F250 Crew Cab truck, but the authority
  // image shows a cargo van" (side, passenger-side, close-up). Three of seven
  // proofs survived, and the three that survived were the ones whose surfaces
  // had no cut-out. Meanwhile the repaired duplicate -- a solid rectangle of
  // continuous livery -- sat unused by the proof half.
  //
  // Conditioning both halves on the repaired sheet is also what RULE 0.21
  // already states: "those SAME surface regions condition the matching 3D proof
  // views". Nothing changes on a clean master: `fillMasterCutouts` returns the
  // same buffer, `panelSourceHash` equals `masterHash`, and the projection and
  // view authorities are byte-identical to what they were before.
  const repairStartedAt = Date.now();
  const cutoutFill = await fillMasterCutouts(masterBytes, manifest, masterCutoutSurfaces);
  timings.repairMs += Date.now() - repairStartedAt;
  const surfaceSourceBytes = cutoutFill.bytes;
  const panelSourceHash = cutoutFill.changed ? sha256(surfaceSourceBytes) : masterHash;

  // ⛔ STRUCTURAL RE-VALIDATION AFTER REPAIR. (Owner, 2026-08-31)
  //
  // The required Call-1 boundary, verbatim: "one Gemini A.T.L.A.S. generation
  // -> structural validation -> deterministic void repair if required ->
  // structural RE-VALIDATION -> six opaque/full-bleed artwork regions
  // confirmed -> canonical master ACCEPTED ... If repair cannot produce six
  // valid regions, Call 1 fails. It does NOT publish a malformed master."
  //
  // That re-validation did not exist. The fill ran, its output went straight
  // into the panel cut and the proof conditioning, and nothing ever asked
  // whether it had actually produced six valid regions -- the repair was
  // trusted because it is deterministic, which proves it is REPEATABLE, not
  // that its result is VALID.
  //
  // Skipped entirely when the fill changed nothing: on a clean master the
  // returned buffer IS the master, which the checks above just passed, so
  // re-running them would be pure latency on the critical path before the
  // customer sees anything.
  if (cutoutFill.changed) {
    const repaired = await deterministicMasterChecks(surfaceSourceBytes, manifest);
    if (repaired.blockingFailures.length) {
      throw new FlatAtlasError(
        "flat_atlas_repaired_master_invalid",
        "The deterministic repair did not produce six valid printable regions: "
        + repaired.blockingFailures.join("; "),
      );
    }
  }

  // ── THE ACCEPTED MASTER IS THE ONE THAT PASSED. (Owner, 2026-08-31) ────────
  //
  // Owner, having read this file after the re-validation landed: "even after
  // successfully repairing and re-validating the sheet, the progressive/
  // canonical A.T.L.A.S. object still points to the ORIGINAL pre-repair
  // masterBytes and masterHash ... A.T.L.A.S. shown to humans = bad original,
  // Panels/proof authority = repaired derivative. That is not one canonical
  // authority."
  //
  // Correct, and it is the contradiction PanelPro was showing on its face:
  // "repaired sheet · Master QC passed" printed over a sheet visibly full of
  // holes, because the object labelled canonical was the pre-repair bytes while
  // the panels and proofs were cut from a repaired sheet nobody could see.
  //
  // ⚠️ THIS OVERRIDES RULE 0.15's "the master is never mutated". That rule
  // reasoned that publishing the repaired hash as the panel lineage made a
  // correct pair report "the proof and the panel came from different masters" --
  // true when TWO masters exist and the panels cite the one that is not
  // canonical. Promoting the repaired sheet to canonical dissolves that problem
  // rather than reintroducing it: after this there is exactly ONE accepted
  // master, the panels cite it, the proofs are conditioned on it, and both UIs
  // bind to it. The divergence the old rule guarded against is the divergence
  // this removes.
  //
  // The pre-repair bytes are not destroyed -- they stay on the revision as
  // `preRepairMasterHash` for provenance and forensics. What they no longer do
  // is wear the words "canonical master", "accepted master" or "Master QC
  // passed" while a different sheet does the work.
  //
  // On a CLEAN master this is identity: `fillMasterCutouts` returns the same
  // buffer, `changed` is false, and both bindings resolve to exactly the bytes
  // and hash they always did -- no extra transform, no extra hash, no new
  // storage object, and byte-identical output.
  const acceptedMasterBytes = cutoutFill.changed ? surfaceSourceBytes : masterBytes;
  const acceptedMasterHash = cutoutFill.changed ? panelSourceHash : masterHash;
  const preRepairMasterHash = cutoutFill.changed ? masterHash : null;
  const acceptedMasterStoragePath = cutoutFill.changed
    ? atlasStoragePath({ tenantKey, generationId, revisionSequence, kind: "master", contentHash: acceptedMasterHash })
    : masterStoragePath;

  // ── THE PROGRESSIVE ATLAS: THE ROOT NODE, PUBLISHED BEFORE ITS BRANCHES ────
  //
  // Owner, 2026-08-27: "Nodes run when their inputs exist. Nothing waits unless
  // it truly depends on it." A 3D proof node's input is ITS OWN panel, not the
  // set, and not the tail of Call 1 -- the storage joins, the judge's verdict
  // and the revision row that follow the last cut are inputs to nobody's proof.
  //
  // So the same object every conditioning function already takes is handed out
  // NOW and filled as each panel lands. `atlasProjectionParts` and
  // `viewAuthorityFor` run against it unchanged -- same hash gates, same
  // surface check, same refusal on a mismatch. Nothing is bypassed to go
  // earlier; the object simply exists sooner.
  //
  // `revisionId` is the one field that cannot exist yet: it is the primary key
  // of a row written after the panels. It is not read by any conditioning path
  // (`atlasProjectionParts` never mentions it), and it is filled in below the
  // moment the row lands -- long before a ~30s proof reaches its persist step.
  // MINTED HERE, NOT ASSIGNED BY THE INSERT.
  //
  // `revisionId` was the one field genuinely unknown at master-ready time: the
  // primary key of `designpro_flat_atlas_revisions`, previously left to
  // Postgres's `DEFAULT extensions.gen_random_uuid()`. That default is exactly
  // as good as a client-generated one -- both are just a random v4 UUID -- so
  // minting it now and passing it explicitly as the row's `id` on insert loses
  // nothing and lets every consumer of the progressive root node reference the
  // real, final identity from the first moment the master exists, instead of
  // only after the row is written.
  const mintedRevisionId = randomUUID();
  const progressiveAtlas = {
    contract: ATLAS_CONTRACT,
    promptVersion: PROMPT_VERSION,
    revisionId: mintedRevisionId,
    revisionSequence,
    manifest,
    // The ACCEPTED master -- the sheet that passed structural validation, which
    // on a repaired run is the repaired one. Identical to `masterHash`/
    // `masterBytes` whenever the fill changed nothing.
    master: { contentHash: acceptedMasterHash, bytes: acceptedMasterBytes },
    // Not a second producer of design and not a second QC pass -- every field
    // here is already known, either a module constant or a local computed
    // upstream of this point (`promptHash` at authoring time, well before the
    // deterministic gate could even run). This is the SAME value `rowIdentity`
    // derives from the persisted row's metadata later; the two must never be
    // allowed to drift, which `tests/atlas-streaming-fanout.test.mjs` pins by
    // comparing them byte for byte on a real run.
    masterAcceptance: {
      contract: MASTER_QC_CONTRACT,
      confidence: null,
      model: null,
      promptHash,
      providerContract: MASTER_PROVIDER_CONTRACT,
      artboardPortVersion: DESIGNPANEL_ARTBOARD_PORT_VERSION,
      passed: true,
      basis: "deterministic",
    },
    // `manifestHash` was computed at authoring time, long before the
    // deterministic gate ran -- it does not wait on anything this object is
    // trying not to wait on.
    manifestAsset: { contentHash: manifestHash },
    // Filled in the moment `projectionDerivative` resolves, a few lines below
    // this object's construction -- pure Sharp/hash work, no network or AI, so
    // "the moment it exists" is milliseconds, not the storage/DB tail this
    // object exists to not wait for.
    projection: null,
    metadata: { panelSourceHash },
    callOnePanels: [],
    viewAuthorities: {},
  };
  if (typeof onMasterReady === "function") {
    try { onMasterReady(progressiveAtlas); }
    catch (cause) {
      logger?.warn?.("flat_atlas_master_ready_consumer_failed", {
        generationId, reason: String(cause?.message || cause || "unknown"),
      });
    }
  }
  // ── BRANCH A: ORDERED EXTRACTION, EACH PANEL RELEASED THE MOMENT IT EXISTS ──
  //
  // Owner, 2026-08-27: "Each completed panel is immediately persisted and
  // published to PanelPro Studio with its trim dimensions, 5\u2033 bleed, hashes
  // and lineage... Nothing in Branch A waits for Branch B."
  //
  // The extraction is ORDERED -- Driver, Passenger, Hood, Front, Rear, Roof --
  // and its write is fired inside the loop rather than batched afterwards, so
  // the Driver panel is in durable storage while Roof has not been cut. The
  // write promise is collected, never awaited here: awaiting it would put the
  // upload on the critical path of the next cut and re-create the barrier this
  // removes. `onSurfaceReady` is the panel.ready event; a caller uses it to
  // release that surface's 3D proof.
  const panelWrites = [];
  // `projection` is attached to the progressive root the INSTANT it resolves,
  // independent of panel-cutting -- not after `Promise.all` settles both, which
  // would delay it behind the slower of the two for no reason. It is pure
  // Sharp/hash work on bytes already in memory (no network, no AI), so this is
  // milliseconds after the master itself was accepted.
  const projectionStartedAt = Date.now();
  const projectionPromise = projectionDerivative(surfaceSourceBytes)
    .then((result) => {
      progressiveAtlas.projection = result;
      return result;
    })
    .finally(() => {
      timings.projectionMs += Date.now() - projectionStartedAt;
    });
  const [callOnePanels, projection] = await Promise.all([
    cutCallOnePanels(surfaceSourceBytes, manifest, acceptedMasterHash, {
      onPanelRetry: ({ surfaceKey, attempt, reason }) => logger?.warn?.(
        "flat_atlas_panel_cut_retry", { generationId, surfaceKey, attempt, reason },
      ),
      onPanelTiming: ({ durationMs }) => {
        timings.panelExtractionMs += Number(durationMs) || 0;
      },
      onPanel: async (panel) => {
        const panelStoragePath = atlasStoragePath({
          tenantKey, generationId, revisionSequence, kind: "panel", contentHash: panel.contentHash,
        });
        // The progressive graph must carry the same durable panel identity the
        // final revision will record. A proof is never allowed to start from an
        // in-memory-only panel or to guess its storage path.
        const progressivePanel = Object.freeze({ ...panel, storagePath: panelStoragePath });
        // THE PANEL IS THE PROOF'S ARTWORK AUTHORITY, so the authority is built
        // HERE -- the instant the panel exists -- rather than in one batch after
        // the last cut. Every proof view that photographs this surface becomes
        // conditionable now. (Close-Up shares Driver's surface, so Driver's cut
        // releases two nodes.)
        progressiveAtlas.callOnePanels.push(progressivePanel);
        const authorityStartedAt = Date.now();
        try {
          for (const sourceViewType of PROOF_VIEWS) {
            if (surfaceForProofView(sourceViewType) !== panel.surfaceKey) continue;
            progressiveAtlas.viewAuthorities[sourceViewType] =
              await viewAuthorityFromPanel(panel, sourceViewType);
          }
        } finally {
          timings.viewAuthorityMs += Date.now() - authorityStartedAt;
        }
        const panelPersisted = store.putImmutableBytes({
          storagePath: panelStoragePath,
          bytes: panel.bytes,
          contentType: panel.contentType,
        });
        panelWrites.push(panelPersisted);
        if (typeof onSurfaceReady !== "function") return;
        // A consumer's failure is ITS failure. Branch A does not stop cutting
        // panels because Branch B could not start one proof -- "a failed proof
        // never blocks its production panel."
        try {
          const released = onSurfaceReady({
            atlas: progressiveAtlas,
            projectionReady: projectionPromise,
            panelPersisted,
            surfaceKey: panel.surfaceKey,
            panelStoragePath,
            contentHash: panel.contentHash,
            byteSize: panel.byteSize,
            trimWidthIn: panel.trimWidthIn,
            trimHeightIn: panel.trimHeightIn,
            printWidthIn: panel.printWidthIn,
            printHeightIn: panel.printHeightIn,
            surfaceSqFt: panel.surfaceSqFt,
            bleedInches: panel.bleedInches,
            sourceMasterHash: panel.sourceMasterHash,
            surfaceSourceHash: panel.surfaceSourceHash,
          });
          if (released && typeof released.catch === "function") {
            released.catch((cause) => logger?.warn?.("flat_atlas_panel_release_failed", {
              generationId,
              surfaceKey: panel.surfaceKey,
              reason: String(cause?.message || cause || "unknown"),
            }));
          }
        } catch (cause) {
          logger?.warn?.("flat_atlas_panel_release_failed", {
            generationId,
            surfaceKey: panel.surfaceKey,
            reason: String(cause?.message || cause || "unknown"),
          });
        }
      },
    }),
    projectionPromise,
  ]);
  // Every content-addressed path the write batch below needs must be resolved
  // BEFORE that batch is defined -- `persistImmutableAssets` is now invoked
  // thirty lines earlier than the write it replaced, so a declaration left at
  // the old site is a temporal-dead-zone ReferenceError, and a source-text lock
  // cannot see one.
  const projectionStoragePath = atlasStoragePath({
    tenantKey, generationId, revisionSequence, kind: "projection", contentHash: projection.contentHash,
  });

  // The guide, manifest, master, derivative and six panels enter durable storage
  // as one parallel batch after deterministic structural acceptance.
  const persistImmutableAssets = () => Promise.all([
    store.putImmutableBytes({ storagePath: guideStoragePath, bytes: guideBytes, contentType: "image/png" }),
    store.putImmutableBytes({ storagePath: manifestStoragePath, bytes: manifestBytes, contentType: "application/json" }),
    // The accepted sheet is what persists under the canonical path. On a
    // clean run these are the same bytes at the same path they always were.
    store.putImmutableBytes({ storagePath: acceptedMasterStoragePath, bytes: acceptedMasterBytes, contentType: "image/png" }),
    store.putImmutableBytes({
      storagePath: projectionStoragePath, bytes: projection.bytes, contentType: projection.contentType,
    }),
    // THE PANELS ARE NOT WRITTEN HERE ANY MORE. Each one's upload was fired the
    // instant it was cut, in Branch A, so the Driver panel reached storage
    // before Roof was extracted. All that is left is to join them.
    ...panelWrites,
  ]);

  const uploadWaitStartedAt = Date.now();
  await persistImmutableAssets();
  timings.uploadWaitMs += Date.now() - uploadWaitStartedAt;
  // Identity + the design-time size of every side, recorded on the immutable
  // revision. Downstream consumes these; it never re-cuts them.
  const callOnePanelRecords = callOnePanels.map((panel) => ({
    contract: panel.contract,
    surfaceKey: panel.surfaceKey,
    storagePath: atlasStoragePath({
      tenantKey, generationId, revisionSequence, kind: "panel", contentHash: panel.contentHash,
    }),
    contentHash: panel.contentHash,
    byteSize: panel.byteSize,
    contentType: panel.contentType,
    pixelWidth: panel.pixelWidth,
    pixelHeight: panel.pixelHeight,
    trimWidthIn: panel.trimWidthIn,
    trimHeightIn: panel.trimHeightIn,
    printWidthIn: panel.printWidthIn,
    printHeightIn: panel.printHeightIn,
    surfaceSqFt: panel.surfaceSqFt,
    bleedInches: panel.bleedInches,
    effectivePpi: panel.effectivePpi,
    geometryPurpose: panel.geometryPurpose,
    sourceMasterHash: acceptedMasterHash,
    surfaceSourceHash: panel.surfaceSourceHash,
    method: panel.method,
    deterministic: panel.deterministic,
    genieManifestId: panel.genieManifestId,
    genieManifestHash: panel.genieManifestHash,
    geometryAuthorityState: panel.geometryAuthorityState,
    geometrySourceRowId: panel.geometrySourceRowId,
    derivationContract: panel.derivationContract,
    productionEligible: panel.productionEligible,
  }));

  const rowPayload = {
    // The SAME id the progressive root node handed out at master-ready time.
    // This row is the persisted record of that identity, not the source of it
    // -- Postgres's own `DEFAULT extensions.gen_random_uuid()` would produce an
    // equally valid random v4 UUID, but a SECOND one, disagreeing with every
    // proof that already started against `mintedRevisionId`.
    id: mintedRevisionId,
    request_id: requestId,
    generation_id: generationId,
    owner_id: ownerId,
    tenant_key: tenantKey,
    parent_revision_id: null,
    revision_sequence: revisionSequence,
    guide_storage_path: guideStoragePath,
    guide_content_hash: guideHash,
    guide_byte_size: guideBytes.length,
    guide_content_type: "image/png",
    manifest_storage_path: manifestStoragePath,
    manifest_content_hash: manifestHash,
    manifest_byte_size: manifestBytes.length,
    manifest_content_type: "application/json",
    master_storage_path: acceptedMasterStoragePath,
    master_content_hash: acceptedMasterHash,
    master_byte_size: acceptedMasterBytes.length,
    master_content_type: "image/png",
    projection_storage_path: projectionStoragePath,
    projection_content_hash: projection.contentHash,
    projection_byte_size: projection.byteSize,
    projection_content_type: projection.contentType,
    manifest,
    affected_surfaces: [...SURFACE_KEYS],
    instruction: null,
    production_eligible: false,
    model: String(generated.model || "unknown"),
    prompt_version: PROMPT_VERSION,
    width_px: CANVAS.widthPx,
    height_px: CANVAS.heightPx,
    effective_ppi: manifest.quality.minimumEffectivePpi,
    example_id: null,
    example_guide_hash: null,
    example_master_hash: null,
    metadata: {
      contract: ATLAS_CONTRACT,
      inputContract: INPUT_CONTRACT,
      pipelineMode: PIPELINE_MODE,
      topology: TOPOLOGY,
      geometryAuthority: manifest.geometryAuthority,
      // The six panels Call 1 cut, with the design-time size of each side.
      callOnePanelContract: CALL_ONE_PANEL_CONTRACT,
      callOnePanels: callOnePanelRecords,
      examplePurpose: EXAMPLE_PURPOSE,
      topologyExamplesApplied: 0,
      topologyExampleIdentity: null,
      topologyExampleIdentities: [],
      atlasDesignTeachingExampleApplied: true,
      atlasDesignTeachingExampleIdentity: cohesionExample.identity,
      atlasDesignTeachingExampleSetHash: currentExampleSetHash,
      designPanelArtboardQualityExamplesApplied: 0,
      designPanelArtboardQualityExampleIdentities: [],
      designPanelArtboardPortVersion: DESIGNPANEL_ARTBOARD_PORT_VERSION,
      masterProviderContract: MASTER_PROVIDER_CONTRACT,
      masterPromptHash: promptHash,
      masterExampleSetHash: currentExampleSetHash,
      // Deterministic topology/container/byte/hash/lineage acceptance passed.
      // Semantic design judgement is advisory and is not run on this blocking
      // path; any panel cut-out remains durable evidence for PanelPro human QC.
      masterQcPassed: true,
      // Empty on a clean master. Non-empty means the sheet arrived with a hole
      // in these surfaces; their panels were closed deterministically below and
      // still must not print until a human has seen them on a template.
      masterCutoutSurfaces,
      masterCutoutFindings,
      // Historical readers may inspect this key. New Call-1 revisions never
      // populate it: Passenger's authored bytes are preserved verbatim.
      passengerComposed: null,
      passengerMirrorTelemetry: {
        mae: Number(masterDeterministic?.passengerMirrorMae ?? 0),
        blocking: false,
        passengerSource: "authored-passenger-region",
      },
      // What the six panels were actually cut from. Equal to the accepted
      // canonical master in BOTH cases now: on a clean run the fill returns the
      // same buffer, and on a repaired run the repaired sheet IS the accepted
      // master. It is kept as its own field because the panel bytes must stay
      // traceable to their source by name, not by an assumed equality.
      panelSourceHash,
      // PROVENANCE ONLY -- the pre-repair sheet Gemini returned, kept so a
      // forensic reader can see what arrived, and null when nothing was
      // repaired. It is deliberately NOT called a master: it is not canonical,
      // not accepted, and never what "Master QC passed" refers to.
      preRepairMasterHash,
      cutoutFillContract: cutoutFill.changed ? FILL_CONTRACT : null,
      cutoutFillApplied: cutoutFill.filled,
      // The optical resolution Gemini actually delivered, before the canvas
      // resize. The master is always 4096 because it is filled to it, so
      // without these the run could never distinguish a true 4K sheet from a
      // smaller one stretched onto a 4K canvas.
      masterDeliveredWidthPx: masterDelivery?.deliveredWidthPx ?? null,
      masterDeliveredHeightPx: masterDelivery?.deliveredHeightPx ?? null,
      masterNativelyFourK: masterDelivery?.nativelyFourK ?? null,
      masterQcContract: MASTER_QC_CONTRACT,
      // Semantic analysis is not on the Call-1 acceptance path. No semantic
      // verdict is used to rewrite either named side or to accept/reject it.
      masterQcConfidence: null,
      masterQcModel: null,
      masterQcKeyFingerprint: null,
      masterQcRequestByteSize: null,
      // The deterministic measurements ARE the gate, so they are always present:
      // the judge's own copy when it returned one, the loop's otherwise.
      masterQcDeterministic: masterDeterministic,
      masterQcReview: null,
      // Deterministic container/pixel/hash/lineage checks accepted this master.
      masterAcceptance: "deterministic",
      // click -> master, in segments, on the immutable revision.
      callOneTimings: {
        ...timings,
        totalMs: Date.now() - callOneStartedAt,
        // Always zero in active Call 1; retained for timing-schema continuity.
        semanticOverlapped: timings.semanticWaitMs === 0,
      },
      masterSemanticVerdict: { accepted: null, code: "semantic_qc_advisory_not_run", reason: null },
      masterSemanticBlocking: false,
      providerKeyFingerprint: generated.keyFingerprint || null,
      providerResponseContentType: generated.contentType,
      rawProviderResponseHash: sha256(generated.bytes),
      canonicalMasterHash: masterHash,
      projectionContract: PROJECTION_CONTRACT,
      projectionHash: projection.contentHash,
      projectionSourceMasterHash: masterHash,
      projectionQuality: projection.quality,
      projectionChromaSubsampling: projection.chromaSubsampling,
      projectionBase64ByteSize: projection.base64ByteSize,
      projectionMaxBinaryBytes: PROJECTION_MAX_BYTES,
      projectionDimensions: `${CANVAS.widthPx}x${CANVAS.heightPx}`,
      requestedImageSize: "4K",
      masterRequestByteSize,
      masterRequestMaxBytes: MASTER_REQUEST_MAX_BYTES,
      masterAuthoringAttempts,
      // Owner protection #5: the exact number of Gemini IMAGE requests this
      // authoring spent (the VisionBoardIQ pre-pass is a text call and is
      // reported separately by its own receipt). Equal to
      // masterAuthoringAttempts by construction; named so an acceptance run
      // can prove "one call" without inference.
      geminiImageRequestCount: masterAuthoringAttempts,
      maxAuthoringAttemptsAllowed: maxAuthoringAttempts,
      // OWNER PROOF CONTRACT (2026-08-27): every Call-1 creative request went
      // through the deployed design-panel-ai-generate edge function; zero
      // direct Gemini Call-1 requests exist in this runtime. One provenance
      // entry per attempt: requestId, functionName, sourceCommit,
      // promptVersion, model, masterSha256.
      atlasEdgeProvenance: edgeProvenance,
      atlasEdgePromptVersion: ATLAS_ARTBOARD_EDGE_PROMPT_VERSION,
      proofExecution: "panel-ready-driver-priority-parallel",
    },
  };
  const { data: row, error } = await supabase.from("designpro_flat_atlas_revisions")
    .insert(rowPayload).select("*").single();
  if (error) {
    if (/duplicate|unique/i.test(String(error.message))) {
      const raced = await loadLatestAtlasRevision(supabase, requestId);
      if (raced) {
        assertAtlasReuseContract(raced, {
          expectedManifestHash: manifestHash,
          expectedPromptHash: promptHash,
          expectedExampleSetHash: currentExampleSetHash,
        });
        return raced;
      }
    }
    throw new FlatAtlasError("flat_atlas_revision_insert_failed", error.message, true);
  }
  logger(
    `persisted immutable atlas revision 1 ${masterHash}; `
      + `callOneTimings=${JSON.stringify(rowPayload.metadata.callOneTimings)}`,
  );
  return rowIdentity(row, manifest, masterBytes, surfaceSourceBytes, projection.bytes, {
    reused: false,
    // Already cut, already published. Never cut them twice.
    panels: callOnePanels,
  });
}

function atlasProjectionParts(atlas, sourceViewType) {
  if (!atlas?.master?.bytes || atlas.manifest?.contract !== MANIFEST_CONTRACT) {
    throw new FlatAtlasError(
      "flat_atlas_conditioning_invalid",
      "A verified master, manifest and exact per-view authority are required for every proof",
    );
  }
  const authority = viewAuthorityFor(atlas, sourceViewType);
  return [
    {
      inlineData: {
        mimeType: authority.contentType,
        data: authority.bytes.toString("base64"),
      },
    },
    {
      text: `EXACT A.T.L.A.S. VIEW AUTHORITY — revision ${atlas.revisionSequence}; view ${sourceViewType}; surface ${authority.surfaceKey}; canonical master PNG sha256 ${atlas.master.contentHash}; exact native-zone JPEG sha256 ${authority.contentHash}.
This image is a deterministic no-redesign crop of ONLY the ${authority.surfaceKey.toUpperCase()} zone from the accepted flattened master, restored to native print orientation. It is the sole artwork authority for this proof. Project these exact pixels onto the corresponding painted surface. Never borrow from another zone; never redesign, simplify, beautify, restyle, replace, mirror, recolor, move, resize, autocomplete or invent artwork. Keep every readable string forward-reading.

This crop is full-bleed print artwork: it intentionally continues behind windows/glass, wheel arches, pickup-bed openings, lights and trim that installers cut around later. On the 3D proof, mask it to real painted panels; do not erase or relocate master artwork because a physical cut line crosses it. Return one photoreal 3D proof only.`,
    },
  ];
}

module.exports = {
  CALL_ONE_PANEL_CONTRACT,
  cutCallOnePanels,
  ATLAS_CONTRACT,
  BLEED_INCHES,
  CANVAS,
  CENTER_ORDER,
  CUSTOMER_REFERENCE_MAX_PIXELS,
  EXAMPLE_PURPOSE,
  GEOMETRY_AUTHORITY_CONTRACT,
  INPUT_CONTRACT,
  MANIFEST_CONTRACT,
  MASTER_REQUEST_MAX_BYTES,
  MASTER_PROVIDER_CONTRACT,
  PIPELINE_MODE,
  PROMPT_VERSION,
  PROOF_DEPENDENCIES,
  PROJECTION_CONTRACT,
  PROJECTION_MAX_BYTES,
  PROJECTION_QUALITY_LADDER,
  PROOF_VIEWS,
  SEMANTIC_CONTINUITY,
  SURFACE_KEYS,
  PANEL_EXTRACTION_ORDER,
  surfaceForProofView,
  TARGET_PRINT_PPI,
  TOPOLOGY,
  VIEW_AUTHORITY_CONTRACT,
  VIEW_AUTHORITY_MAX_BYTES,
  VIEW_SURFACE,
  FlatAtlasError,
  atlasProjectionParts,
  atlasReceipt,
  atlasStoragePath,
  buildAtlasManifest,
  flatFirstRequested,
  generateOrReuseFlatAtlas,
  loadLatestAtlasRevision,
  normalizeAtlasMaster,
  projectionDerivative,
  renderAtlasAuthoringGuide,
  renderAtlasGuide,
  atlasPanelForProofView,
  viewAuthorityFor,
  _test: {
    activeZoneMaskSvg,
    // Exported so the GENIE resolver's authority can be validated by its real
    // consumer in one test, across the seam that separates them.
    normalizedGeometryAuthority,
    artboardQualityExampleParts,
    assertMasterRequestWithinLimit,
    assertAtlasGeometryBasis,
    assertAtlasReuseContract,
    atlasEdgeRequestBody,
    buildViewAuthorities,
    canonical,
    canonicalBytes,
    customerCreativeBrief,
    exampleSetHash,
    estimatedMasterRequestBytes,
    callAtlasArtboardEdge,
    fitCenterColumn,
    fitRotatedSide,
    authoringGuideSvg,
    authoringGuideLabelsSvg,
    guideGeometrySvg,
    guideSvg,
    normalizedGeometryAuthority,
    normalizedSurfaces,
    round,
    sha256,
    surfaceForProofView,
    topologyExampleParts,
    verifiedCustomerReferenceParts,
    viewAuthorityFromPanel,
    trimRectangle,
    zoneEffectivePpi,
  },
};
