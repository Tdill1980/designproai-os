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

const { createHash } = require("node:crypto");
const sharp = require("sharp");
const {
  DESIGNPANEL_ARTBOARD_PORT_VERSION,
  buildAtlasArtboardDesignIQDirection,
} = require("./designiq-prompt.cjs");
const {
  MASTER_QC_CONTRACT,
  createAtlasMasterValidator,
} = require("./atlas-master-qc.cjs");
const { FILL_CONTRACT, fillMasterCutouts } = require("./atlas-cutout-fill.cjs");
const { BUCKET } = require("./generation-store.cjs");

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
const PROMPT_VERSION = "designpro-flat-first-atlas-20260826.v8";
// Bounded QC-corrective re-rolls inside the one claimed authoring fence. Three
// is the proof QC's budget for the same generate/inspect/correct loop.
const MAX_MASTER_AUTHORING_ATTEMPTS = 3;
const MASTER_PROVIDER_CONTRACT = "designpro.flat-first-master-provider.v1";
const TOPOLOGY = "rectangular-preview-v1";
const EXAMPLE_PURPOSE = "topology-only";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const CENTER_ORDER = Object.freeze(["rear", "roof", "hood", "front"]);
const PROOF_VIEWS = Object.freeze(["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"]);
const CANVAS = Object.freeze({ widthPx: 4096, heightPx: 4096 });
const BLEED_INCHES = 5;
const CALL_ONE_PANEL_CONTRACT = "designpro.flat-first-atlas-call1-panel.v1";
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
  "close-up": "driver",
  roof: "roof",
});
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
  const status = String(authority.status || "");
  if (!["validated", "provisional"].includes(status)
    || authority.productionEligible !== false
    || (status === "validated" && authority.operatorValidated !== true)
    || (status === "provisional" && (authority.operatorValidated !== false || !authority.estimatorContract))) {
    throw new FlatAtlasError("flat_atlas_geometry_authority_invalid", "A.T.L.A.S. geometry authority state is invalid");
  }
  const sourceUrls = Array.isArray(authority.sourceUrls)
    ? [...new Set(authority.sourceUrls.map(String).filter((url) => /^https:\/\//.test(url)))]
    : [];
  if (status === "provisional" && (!authority.candidateId || !sourceUrls.length)) {
    throw new FlatAtlasError("flat_atlas_provisional_authority_incomplete", "Provisional A.T.L.A.S. geometry requires a candidate identity and citations");
  }
  return {
    contract: GEOMETRY_AUTHORITY_CONTRACT,
    status,
    purpose: "calls-1-7-layout-only",
    candidateId: authority.candidateId || null,
    candidateHash: authority.candidateHash || null,
    source: String(authority.source || (status === "validated" ? "operator-validated" : "gemini_grounded")),
    sourceUrls,
    confidence: String(authority.confidence || (status === "validated" ? "high" : "low")),
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
function buildAtlasManifest(surfaces, geometryAuthorityInput) {
  const geometryAuthority = normalizedGeometryAuthority(geometryAuthorityInput);
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
 * The geometry both guides share. Rectangles, fills, strokes -- the zone
 * authority itself, identical in each, so the two renders can never disagree
 * about where a surface is.
 */
function guideGeometrySvg(manifest) {
  return manifest.zones.map((zone) => (
    `<rect x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" rx="10" fill="${zone.guideFill}" stroke="#ffffff" stroke-width="8"/>`
  )).join("");
}

/**
 * THE MODEL'S GUIDE CARRIES NO READABLE TEXT. THAT IS THE WHOLE POINT.
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
 * So the guide is split by consumer instead. The model receives geometry and
 * nothing else: same rectangles, same fills, same strokes, same canvas, zero
 * glyphs. Nothing readable is present, so nothing readable can be copied. Zone
 * identity is not lost -- it was never carried by the glyphs. The prompt's ZONE
 * MAP names every surface with its exact box and rotation, and the TOPOLOGY
 * LOCK describes the layout in words, both of which the model reads as text
 * rather than as something to paint.
 *
 * The labelled guide is unchanged and still rendered: it is what the design
 * team reads, what enters durable storage as `guide_storage_path`, and what the
 * QC inspector receives as IMAGE 2 -- which is precisely what lets
 * `artifactFreeContract` keep working, because the inspector still has the
 * annotations to look for. Removing the labels there would have blinded the
 * check that caught this.
 */
function authoringGuideSvg(manifest) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.widthPx}" height="${CANVAS.heightPx}" viewBox="0 0 ${CANVAS.widthPx} ${CANVAS.heightPx}">
    <rect width="100%" height="100%" fill="#111111"/>
    ${guideGeometrySvg(manifest)}
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

/** Geometry authority only. This is the one the authoring model ever sees. */
async function renderAtlasAuthoringGuide(manifest) {
  const svg = authoringGuideSvg(manifest);
  // Fail closed rather than ship a glyph to the model. The split above is the
  // whole defence against `artifactFreeContract`; if a future edit reintroduces
  // text on this path, the run stops here instead of authoring another sheet
  // with a surface name painted across it.
  if (/<text\b/i.test(svg.toString("utf8"))) {
    throw new FlatAtlasError(
      "flat_atlas_authoring_guide_contains_text",
      "The authoring guide must carry geometry only; readable text is reproducible as artwork",
    );
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

async function viewAuthorityDerivative(surfaceSourceBytes, manifest, sourceViewType) {
  const surfaceKey = surfaceForProofView(sourceViewType);
  const zone = manifest?.zones?.find((candidate) => candidate.surfaceKey === surfaceKey);
  if (!zone?.extraction) {
    throw new FlatAtlasError(
      "flat_atlas_view_authority_zone_missing",
      `${sourceViewType}: ${surfaceKey} master zone is missing`,
    );
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
    throw new FlatAtlasError(
      "flat_atlas_view_authority_zone_invalid",
      `${sourceViewType}: ${surfaceKey} extraction is outside the canonical master`,
    );
  }
  const rotationDegrees = Number(zone.extraction.outputRotationDegrees || 0);
  for (const quality of PROJECTION_QUALITY_LADDER) {
    const bytes = await sharp(surfaceSourceBytes, { limitInputPixels: false })
      .extract(extract)
      .rotate(rotationDegrees)
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
        sourceMasterHash: sha256(surfaceSourceBytes),
        sourceZone: Object.freeze({
          x: extract.left,
          y: extract.top,
          w: extract.width,
          h: extract.height,
          outputRotationDegrees: rotationDegrees,
        }),
      });
    }
  }
  throw new FlatAtlasError(
    "flat_atlas_view_authority_budget_exhausted",
    `${sourceViewType}: exact ${surfaceKey} crop cannot fit ${VIEW_AUTHORITY_MAX_BYTES} bytes without resizing`,
  );
}

/**
 * CALL 1 CUTS THE SIX PANELS.
 *
 * The panels a buyer is enticed with, and the panels PanelPro Studio is later
 * served, are cut here -- from the canonical master, at Call 1, before any GENIE
 * dimension exists and before the production workflow is created. Nothing
 * downstream re-derives them; Call 9 promotes these exact bytes.
 *
 * It is pure geometry. Every zone already carries its extraction rectangle, its
 * inverse rotation, and its real per-side dimensions with the five-inch bleed
 * already included (trimWidthIn + BLEED_INCHES * 2). So there is nothing to
 * infer: crop, unrotate, stamp the size on it.
 *
 * PNG, not the JPEG the view authorities use. A view authority is conditioning
 * evidence for another model; a panel is print artwork, and print artwork is
 * never handed a lossy round trip.
 */
async function cutCallOnePanels(surfaceSourceBytes, manifest, canonicalMasterHash) {
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
  return Promise.all(SURFACE_KEYS.map(async (surfaceKey) => {
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
    });
  }));
}

async function buildViewAuthorities(surfaceSourceBytes, manifest) {
  const entries = await Promise.all(PROOF_VIEWS.map(async (sourceViewType) => [
    sourceViewType,
    await viewAuthorityDerivative(surfaceSourceBytes, manifest, sourceViewType),
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
    || authority.sourceMasterHash !== surfaceSourceHashOf(atlas)) {
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

function atlasCreativeRules(input) {
  return buildAtlasArtboardDesignIQDirection(input);
}

function atlasPrompt(input, manifest) {
  // THE REFERENCE STAMPS REAL INCHES INTO THE PANEL LIST.
  //
  // design-panel-ai-generate's artboard branch renders each side as
  // `• DRIVER SIDE — 153" x 56"` (index.ts:348-350, from resolveArtboardPanels).
  // Call 1's zone map carried pixel boxes and rotations only, so the design call
  // knew where each surface sat on the canvas but never how large it is in the
  // real world -- and a designer scales lettering, motif and hierarchy to the
  // physical panel, not to a pixel box.
  const map = manifest.zones.map((zone) => {
    const inches = Number.isFinite(Number(zone.trimWidthIn)) && Number.isFinite(Number(zone.trimHeightIn))
      ? ` — ${Number(zone.trimWidthIn)}" x ${Number(zone.trimHeightIn)}" of real printed vinyl`
      : "";
    return `${zone.surfaceKey}: box [${zone.x},${zone.y},${zone.w},${zone.h}], rotation ${zone.rotationDegrees} degrees${inches}`;
  }).join("\n");
  const continuity = manifest.seamContinuity.relationships
    .map((relationship) => relationship.surfaces.join(" <-> ")).join(", ");
  const geometryDescription = manifest.geometryAuthority.status === "provisional"
    ? "cited Google-grounded, deterministic PROVISIONAL proof-layout rectangles"
    : "operator-validated GENIE rectangles";
  // THE DESIGNER LEADS. THE TOPOLOGY IS THE OUTPUT CONTRACT.
  //
  // A.T.L.A.S. is the output topology of the proven design engine, not a
  // replacement for it. This prompt used to open with ~4,600 characters of
  // atlas instruction and append the DesignIQ direction underneath it as a
  // trailing "DESIGNIQ FLAT CREATIVE DIRECTION:" section -- so the call that
  // authors the customer's design read as a topology brief with a designer
  // footnote. The reference inverts that: design-panel-ai-generate's artboard
  // branch opens as the designer, names the vehicle, lists the panels with
  // their real inches, states the brief, and closes with a short output-format
  // instruction -- 1,516 characters in total (index.ts:340-390).
  //
  // Nothing creative is rewritten here. `atlasCreativeRules(input)` is the same
  // DesignIQ direction, byte for byte; it now leads instead of trailing, and
  // the atlas half is stated once each instead of twice. The three blocks RULE
  // 0.15 protects -- SOLID PANELS, the PAIRED FLAT-TO-FINISHED LESSON and ONE
  // COHESIVE WRAP -- are reproduced verbatim and in full.
  return `${atlasCreativeRules(input)}

━━━ OUTPUT FORMAT: ONE FLATTENED A.T.L.A.S. MASTER ━━━
Deliver that design as ONE continuous unwrapped livery atlas -- a single square artwork canvas -- not a vehicle photograph and not six unrelated designs.

That guide is generated from ${geometryDescription}. Its grays and outlines carry ZERO palette or style meaning. Return the same layout on a square canvas and leave everything outside the rectangles blank/transparent. These rectangles establish Calls 1-7 proof topology only; they are never authorization for print production.

TOPOLOGY LOCK:
- passenger flank is the tall rotated rectangle on the LEFT (clockwise 90 degrees)
- driver flank is the tall rotated rectangle on the RIGHT (counter-clockwise 90 degrees)
- center column is REAR, ROOF, HOOD, FRONT from top to bottom (vehicle rear to front)
- maintain one coherent design language and intentional graphic continuity across related panel edges
- do not swap driver and passenger
- make PASSENGER the opposite-facing, mirror-compatible twin of DRIVER: same motif, scene, hierarchy, scale, landmarks and flow, reversed for the opposite flank, while every word/logo/URL/number remains forward-reading on both zones
- semantic continuity pairs are: ${continuity}
- these are design-intent joins only; do not invent contour lines or claim exact PVO seam geometry

ZONE MAP -- each box is a real printed surface at the size stated; scale lettering, motif and hierarchy to those inches:
${map}

FULL BLEED PER ZONE: fill every rectangle listed in the ZONE MAP with opaque artwork from corner to corner. Each listed box is 100% covered: no gap, no empty region, no transparent pixel and no unpainted area anywhere inside it, on any surface. Outside the rectangles the canvas stays empty.

SOLID PANELS -- THIS IS THE MOST IMPORTANT RULE OF THIS CALL: every zone is ONE SOLID RECTANGLE of continuous printed artwork, opaque corner to corner and edge to edge. The design runs straight through every place a windshield, side window, door glass, wheel arch, tyre, pickup-bed opening, headlight, tail light, handle or trim piece will later sit, exactly as if those parts were not there. THE INSTALLER CUTS THE WHEEL AND WINDOW OPENINGS OUT OF THE FINISHED PANEL, so the panel must have artwork in those places for them to cut. Paint the wrap graphic across the whole rectangle. Each zone reads as a flat sheet of printed vinyl, never as a picture of a vehicle.

PAIRED FLAT-TO-FINISHED LESSON: The attached flattened top-view example and its corresponding finished 3D vehicle proof teach the direction of this first call. The FLATTENED TOP-VIEW image is the output-format example. The finished vehicle is shown only so you understand how one coherent flat design later wraps across hood, roof, driver, passenger, front and rear surfaces. For this call, output the new flattened top-view design first; never output a vehicle photograph.

ONE COHESIVE WRAP, FLATTENED FROM DIRECTLY ABOVE: this is an EXACT flattened top view of a SINGLE vehicle wrap — one design laid open, the way the attached example is. Not six separate designs sharing a canvas, and not a perspective or three-quarter view. Every zone is the same wrap continuing across the vehicle, so the motif, palette, scale and flow read as one artwork that happens to be laid flat. Where a zone shows the panel's own geometry — a door seam, a rocker or hood contour, the line an installer cuts to — paint the livery straight THROUGH it at full opacity, so the shape reads as printed artwork and never as an opening in the sheet.

REFERENCE FIREWALL: Any attached installer-map, flattened top-view or finished-vehicle examples are TOPOLOGY/LAYOUT references only. Extract only panel arrangement, orientation, surface correspondence, masks and seam-continuity intent. IGNORE their palette, imagery, text, logos, brand and style. The customer's brief and verified customer-owned assets are the sole style source.

FIDELITY: This atlas will condition seven downstream 3D proofs. Do not invent unrelated graphics between zones. Preserve supplied customer identity faithfully. This v1 atlas is design-proof authority only; exact typography/logo overlays and true PVO contours remain deterministic prepress concerns.
`;
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

async function rowIdentity(row, manifest, masterBytes, surfaceSourceBytes, projectionBytes, { reused }) {
  const viewAuthorities = await buildViewAuthorities(surfaceSourceBytes, manifest);
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
      confidence: Number(row.metadata?.masterQcConfidence),
      model: row.metadata?.masterQcModel || null,
      promptHash: row.metadata?.masterPromptHash || null,
      providerContract: row.metadata?.masterProviderContract || null,
      artboardPortVersion: row.metadata?.designPanelArtboardPortVersion || null,
      passed: row.metadata?.masterQcPassed === true,
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
        sourceZone: authority.sourceZone,
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
    claimToken, input, surfaces, geometryAuthority, topologyExamples = [],
    artboardQualityExamples = [], masterValidatorFactory = createAtlasMasterValidator,
    masterRequestMaxBytes = MASTER_REQUEST_MAX_BYTES,
    logger = () => {},
  } = options;
  if (!supabase || !store || !provider) throw new FlatAtlasError("flat_atlas_runtime_missing", "Atlas authoring requires Supabase, store and provider");
  if (!flatFirstRequested(input)) throw new FlatAtlasError("flat_atlas_input_required", "Atlas authoring only accepts the v3 flat-first input");

  const manifest = buildAtlasManifest(surfaces, geometryAuthority);
  const prompt = atlasPrompt(input, manifest);
  const promptHash = sha256(Buffer.from(prompt, "utf8"));
  const currentExampleSetHash = exampleSetHash(topologyExamples, artboardQualityExamples);
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
  // `authoringGuideBytes` is the same rectangles with no glyphs at all, and is
  // the only one the authoring model is ever shown.
  const guideBytes = await renderAtlasGuide(manifest);
  const guideHash = sha256(guideBytes);
  const authoringGuideBytes = await renderAtlasAuthoringGuide(manifest);
  const guideStoragePath = atlasStoragePath({ tenantKey, generationId, revisionSequence, kind: "guide", contentHash: guideHash });
  const manifestStoragePath = atlasStoragePath({ tenantKey, generationId, revisionSequence, kind: "manifest", contentHash: manifestHash });

  const parts = [
    // The deterministic guide is deliberately the first IMAGE in the request,
    // and it is the glyph-free authoring render -- never the labelled map.
    { inlineData: { mimeType: "image/png", data: authoringGuideBytes.toString("base64") } },
    { text: prompt },
    ...(await topologyExampleParts(topologyExamples)),
    ...(await artboardQualityExampleParts(artboardQualityExamples)),
    ...(await verifiedCustomerLogoPart(supabase, input)),
    ...(await verifiedCustomerReferenceParts(supabase, input)),
  ];
  if (typeof masterValidatorFactory !== "function") {
    throw new FlatAtlasError(
      "flat_atlas_master_qc_runtime_invalid",
      "The fail-closed A.T.L.A.S. master validator factory is required",
    );
  }
  const validateMaster = masterValidatorFactory({ provider });
  if (typeof validateMaster !== "function") {
    throw new FlatAtlasError(
      "flat_atlas_master_qc_runtime_invalid",
      "The fail-closed A.T.L.A.S. master validator is unavailable",
    );
  }
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
  let masterQc;
  let masterRequestByteSize = 0;
  let masterAuthoringAttempts = 0;
  // Empty unless the re-rolls were exhausted on cut-outs alone. These name the
  // surfaces whose PANEL carries a hole; the design and its proofs are fine.
  let masterDelivery = null;
  let masterCutoutSurfaces = [];
  let masterCutoutFindings = [];
  const correctiveParts = [];
  for (let attempt = 1; attempt <= MAX_MASTER_AUTHORING_ATTEMPTS; attempt += 1) {
    masterAuthoringAttempts = attempt;
    const attemptParts = [...parts, ...correctiveParts];
    masterRequestByteSize = assertMasterRequestWithinLimit(attemptParts, masterRequestMaxBytes);
    generated = await provider.generateImage({
      parts: attemptParts,
      aspectRatio: "1:1",
      imageSize: "4K",
      // PARITY WITH THE AUTHORITY. design-panel-ai-generate sets temperature
      // 1.0 explicitly on every image call (index.ts:1334) and pins one model
      // with no fallback (index.ts:1320). Call 1 omitted the temperature
      // entirely -- so the design was authored at whatever the API defaulted to
      // -- and inherited a Flash-image fallback that could author the customer's
      // design on a different model than the locked one.
      temperature: 1,
      lockModel: true,
      label: attempt === 1
        ? "flat-first canonical atlas"
        : `flat-first canonical atlas (corrective re-roll ${attempt})`,
    });
    const normalized = await normalizeAtlasMaster(generated.bytes, manifest);
    masterBytes = normalized.bytes;
    masterDelivery = normalized;
    masterHash = sha256(masterBytes);
    masterQc = await validateMaster({ masterBytes, guideBytes, manifest, input });
    const accepted = masterQc?.accepted === true
      && masterQc?.metadata?.contract === MASTER_QC_CONTRACT
      && masterQc.metadata.masterHash === masterHash
      && masterQc.metadata.guideHash === guideHash;
    if (accepted) break;
    // A CUT-OUT IS NOT WORTH RE-ROLLING FOR.
    //
    // Re-rolling costs a full authoring pass -- about a minute -- and it buys
    // nothing here: the proofs mask that region away, so the design is already
    // correct, and the panel is fixed deterministically below by continuing the
    // artwork that borders the hole. Spending three passes hoping Gemini draws
    // it solid put two minutes on the critical path before the customer saw a
    // single image. Re-rolls stay for a broken DESIGN, where another throw is
    // genuinely the only remedy.
    const cutoutOnly = masterQc?.code === "atlas_master_qc_cutouts_present"
      && masterQc?.metadata?.contract === MASTER_QC_CONTRACT
      && masterQc.metadata.masterHash === masterHash
      && masterQc.metadata.guideHash === guideHash
      && Array.isArray(masterQc?.cutout?.surfaces);
    if (cutoutOnly) {
      masterCutoutSurfaces = masterQc.cutout.surfaces.map(String);
      masterCutoutFindings = (masterQc.cutout.findings || []).map(String);
      break;
    }
    if (attempt === MAX_MASTER_AUTHORING_ATTEMPTS) {
      // Only a broken DESIGN can reach here -- a cut-out broke out above on its
      // first appearance. A blank zone, no contrast, or a passenger flank that
      // is not the driver's twin leaves nothing worth showing the customer, and
      // three throws have already failed to produce one.
      throw new FlatAtlasError(
        "flat_atlas_master_qc_failed",
        `The flattened A.T.L.A.S. design call failed acceptance ${attempt} times (${String(masterQc?.code || "invalid_qc_receipt")}): ${String(masterQc?.reason || "master was not accepted").slice(0, 700)}`,
      );
    }
    correctiveParts.length = 0;
    // THE CORRECTION NAMES THE ACTUAL DEFECT. This block used to prescribe the
    // solid-panels remedy for EVERY refusal, so a mirror-broken sheet was told,
    // three times, to fix cut-outs it did not have -- live on generation
    // 632642dc (2026-08-26): three attempts, all refused at
    // passengerMirrorMae~0.35, each re-roll fed the wrong remedy. The gate's
    // own finding is the corrective direction; no new creative language is
    // introduced -- the mirror text below is the prompt's own locked side-twin
    // wording, restated as the correction.
    const refusalReason = String(masterQc?.reason || "the master was not accepted").slice(0, 600);
    const mirrorBroken = /passengerMirrorMae/.test(refusalReason);
    correctiveParts.push({
      text: `CORRECTION -- the previous sheet was refused by production QC and discarded: ${refusalReason}. Author a NEW sheet. `
        + (mirrorBroken
          ? "The refusal above means the PASSENGER flank was NOT the DRIVER flank's twin: the two tall side rectangles read as two different designs. Draw ONE side composition and install it on BOTH flanks: PASSENGER is the opposite-facing, mirror-compatible twin of DRIVER -- same motif, scene, palette, hierarchy, scale, landmarks and flow, reversed for the opposite flank -- while every word, logo, URL and number remains forward-reading on both zones. Only the text and logos read forward on each side; everything else in the two flanks mirrors."
          : "Every zone is one SOLID rectangle of continuous artwork, "
            + "opaque corner to corner: paint the livery straight through every position where "
            + "a window, glass panel, wheel, wheel arch, lamp, bed opening or trim piece will "
            + "later sit. The installer cuts those openings out of the printed vinyl; the "
            + "artwork itself never contains a dark or empty shape standing in for one."),
    });
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
  const cutoutFill = await fillMasterCutouts(masterBytes, manifest, masterCutoutSurfaces);
  const surfaceSourceBytes = cutoutFill.bytes;
  const panelSourceHash = cutoutFill.changed ? sha256(surfaceSourceBytes) : masterHash;
  const callOnePanels = await cutCallOnePanels(surfaceSourceBytes, manifest, masterHash);
  const projection = await projectionDerivative(surfaceSourceBytes);
  const projectionStoragePath = atlasStoragePath({
    tenantKey, generationId, revisionSequence, kind: "projection", contentHash: projection.contentHash,
  });
  // The guide, manifest, master and derivative enter durable storage only after
  // the canonical master passes deterministic + semantic acceptance. A blank,
  // cut-out, incoherent or side-mismatched authority can never receive a row.
  await Promise.all([
    store.putImmutableBytes({ storagePath: guideStoragePath, bytes: guideBytes, contentType: "image/png" }),
    store.putImmutableBytes({ storagePath: manifestStoragePath, bytes: manifestBytes, contentType: "application/json" }),
    store.putImmutableBytes({ storagePath: masterStoragePath, bytes: masterBytes, contentType: "image/png" }),
    store.putImmutableBytes({
      storagePath: projectionStoragePath, bytes: projection.bytes, contentType: projection.contentType,
    }),
    ...callOnePanels.map((panel) => store.putImmutableBytes({
      storagePath: atlasStoragePath({
        tenantKey, generationId, revisionSequence, kind: "panel", contentHash: panel.contentHash,
      }),
      bytes: panel.bytes,
      contentType: panel.contentType,
    })),
  ]);
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
    sourceMasterHash: masterHash,
  }));

  const topologyExample = topologyExamples.find((example) => example?.identity?.exampleId) || null;
  const primaryTopologyExample = topologyExamples[0] || null;

  const rowPayload = {
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
    master_storage_path: masterStoragePath,
    master_content_hash: masterHash,
    master_byte_size: masterBytes.length,
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
    example_id: topologyExample?.identity.exampleId || null,
    example_guide_hash: topologyExample?.identity.guideContentHash || null,
    example_master_hash: topologyExample?.identity.masterContentHash || null,
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
      topologyExamplesApplied: topologyExamples.length,
      topologyExampleIdentity: primaryTopologyExample?.identity || null,
      topologyExampleIdentities: topologyExamples.map((example) => example?.identity).filter(Boolean),
      designPanelArtboardQualityExamplesApplied: artboardQualityExamples.length,
      designPanelArtboardQualityExampleIdentities: artboardQualityExamples
        .map((example) => example?.identity).filter(Boolean),
      designPanelArtboardPortVersion: DESIGNPANEL_ARTBOARD_PORT_VERSION,
      masterProviderContract: MASTER_PROVIDER_CONTRACT,
      masterPromptHash: promptHash,
      masterExampleSetHash: currentExampleSetHash,
      // The DESIGN passed: coherent, faithful, correctly lettered, and its seven
      // proofs are sound. A cut-out does not change that -- it is a defect in
      // the printed panel, recorded below and caught at PanelPro's human QC.
      masterQcPassed: true,
      // Empty on a clean master. Non-empty means the sheet arrived with a hole
      // in these surfaces; their panels were closed deterministically below and
      // still must not print until a human has seen them on a template.
      masterCutoutSurfaces,
      masterCutoutFindings,
      // What the six panels were actually cut from. Equal to canonicalMasterHash
      // on a clean master; on a filled one it addresses the duplicate, so the
      // panel bytes are traceable to their source rather than silently differing
      // from the master the proofs used.
      panelSourceHash,
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
      masterQcConfidence: masterQc.metadata.confidence,
      masterQcModel: masterQc.metadata.model,
      masterQcKeyFingerprint: masterQc.metadata.keyFingerprint,
      masterQcRequestByteSize: masterQc.metadata.requestByteSize,
      masterQcDeterministic: masterQc.deterministic,
      masterQcReview: masterQc.review,
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
      proofExecution: "driver-first-sequential-generate-color-render",
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
  logger(`persisted immutable atlas revision 1 ${masterHash}`);
  return rowIdentity(row, manifest, masterBytes, surfaceSourceBytes, projection.bytes, { reused: false });
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
  viewAuthorityFor,
  _test: {
    activeZoneMaskSvg,
    artboardQualityExampleParts,
    assertMasterRequestWithinLimit,
    assertAtlasGeometryBasis,
    assertAtlasReuseContract,
    atlasPrompt,
    buildViewAuthorities,
    canonical,
    canonicalBytes,
    customerCreativeBrief,
    exampleSetHash,
    estimatedMasterRequestBytes,
    atlasCreativeRules,
    fitCenterColumn,
    fitRotatedSide,
    authoringGuideSvg,
    guideGeometrySvg,
    guideSvg,
    normalizedGeometryAuthority,
    normalizedSurfaces,
    round,
    sha256,
    surfaceForProofView,
    topologyExampleParts,
    verifiedCustomerReferenceParts,
    viewAuthorityDerivative,
    trimRectangle,
    zoneEffectivePpi,
  },
};
