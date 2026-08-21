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
const { buildFlatDesignIQDirection } = require("./designiq-prompt.cjs");
const { BUCKET } = require("./generation-store.cjs");

const ATLAS_CONTRACT = "designpro.flat-first-atlas.v1";
const MANIFEST_CONTRACT = "designpro.flat-first-atlas-manifest.v1";
const INPUT_CONTRACT = "designpro.calls-1-7-input.v3";
const PIPELINE_MODE = "flat-first-atlas-v1";
const PROMPT_VERSION = "designpro-flat-first-atlas-20260820.v1";
const TOPOLOGY = "rectangular-preview-v1";
const EXAMPLE_PURPOSE = "topology-only";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const CENTER_ORDER = Object.freeze(["rear", "roof", "hood", "front"]);
const PROOF_VIEWS = Object.freeze(["side", "passenger-side", "hood_detail", "front", "rear", "hero-3d", "roof"]);
const CANVAS = Object.freeze({ widthPx: 4096, heightPx: 4096 });
const BLEED_INCHES = 5;
const TARGET_PRINT_PPI = 150;
const PROJECTION_CONTRACT = "designpro.flat-first-atlas-projection.v1";
// Google generateContent requests must remain below 20 MiB. Twelve MiB of
// binary JPEG becomes at most sixteen MiB after base64, leaving room for JSON,
// prompts and request framing without shrinking the canonical 4096px master.
const PROJECTION_MAX_BYTES = 12 * 1024 * 1024;
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
  driver: Object.freeze(["side", "front", "rear", "hero-3d"]),
  passenger: Object.freeze(["passenger-side", "front", "rear", "hero-3d"]),
  hood: Object.freeze(["hood_detail", "side", "passenger-side", "front", "hero-3d"]),
  roof: Object.freeze(["roof", "side", "passenger-side", "hero-3d"]),
  front: Object.freeze(["front", "side", "passenger-side", "hero-3d"]),
  rear: Object.freeze(["rear", "side", "passenger-side", "hero-3d"]),
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
    proofOnlyViews: ["hero-3d"],
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

function guideSvg(manifest) {
  const zoneRects = manifest.zones.map((zone) => (
    `<rect x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" rx="10" fill="${zone.guideFill}" stroke="#ffffff" stroke-width="8"/>`
  )).join("");
  const legend = ["PASSENGER", "REAR", "ROOF", "HOOD", "FRONT", "DRIVER"].map((label, index) => {
    const x = 220 + index * 635;
    return `<text x="${x}" y="84" fill="#ffffff" font-family="Arial,sans-serif" font-size="26" font-weight="700">${label}</text>`;
  }).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.widthPx}" height="${CANVAS.heightPx}" viewBox="0 0 ${CANVAS.widthPx} ${CANVAS.heightPx}">
    <rect width="100%" height="100%" fill="#111111"/>
    ${legend}
    ${zoneRects}
    <text x="2048" y="4050" text-anchor="middle" fill="#d9d9d9" font-family="Arial,sans-serif" font-size="25">TOPOLOGY GUIDE ONLY · GRAYS AND LABELS MUST NOT APPEAR IN ARTWORK</text>
  </svg>`);
}

async function renderAtlasGuide(manifest) {
  return sharp(guideSvg(manifest), { density: 96 })
    .resize(CANVAS.widthPx, CANVAS.heightPx, { fit: "fill", kernel: "nearest" })
    .png(PNG_OPTIONS)
    .toBuffer();
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
  return sharp(resized, { limitInputPixels: false })
    .composite([{ input: activeZoneMaskSvg(manifest), blend: "dest-in" }])
    .png(PNG_OPTIONS)
    .toBuffer();
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
  return buildFlatDesignIQDirection(input);
}

function atlasPrompt(input, manifest) {
  const map = manifest.zones.map((zone) => (
    `${zone.surfaceKey}: box [${zone.x},${zone.y},${zone.w},${zone.h}], rotation ${zone.rotationDegrees} degrees`
  )).join("\n");
  const continuity = manifest.seamContinuity.relationships
    .map((relationship) => relationship.surfaces.join(" <-> ")).join(", ");
  const geometryDescription = manifest.geometryAuthority.status === "provisional"
    ? "cited Google-grounded, deterministic PROVISIONAL proof-layout rectangles"
    : "operator-validated GENIE rectangles";
  return `You are DesignPro's flat vehicle-wrap atlas artist. Create ONE continuous unwrapped livery atlas, not a vehicle photograph and not six unrelated designs.

The FIRST attached image is a neutral monochrome deterministic installer-map guide generated from ${geometryDescription}. Treat its rectangles as masks and topology only. Its gray/black/white values have ZERO palette or style meaning. Paint the requested livery inside those exact rectangles. Return a square artwork canvas in exactly the same layout. Leave everything outside the rectangles blank/transparent. These rectangles establish Calls 1-7 proof topology only; they are never authorization for print production.

TOPOLOGY LOCK:
- passenger flank is the tall rotated rectangle on the LEFT (clockwise 90 degrees)
- driver flank is the tall rotated rectangle on the RIGHT (counter-clockwise 90 degrees)
- center column is REAR, ROOF, HOOD, FRONT from top to bottom (vehicle rear to front)
- maintain one coherent design language and intentional graphic continuity across related panel edges
- do not swap driver and passenger
- semantic continuity pairs are: ${continuity}
- these are design-intent joins only; do not invent contour lines or claim exact PVO seam geometry

ZONE MAP:
${map}

OUTPUT CLEANLINESS: The guide's colors, labels, outlines, legend, dimensions, grid, background and template marks are instructions, never artwork. Do not copy any of them. Output artwork only inside the zones. Do not draw a vehicle, wheels, windows, lights, camera scene, shadows, or a second installer map.

REFERENCE FIREWALL: Any attached installer-map or Lamborghini-style examples are TOPOLOGY/LAYOUT references only. Extract only panel arrangement, orientation, masks and seam-continuity intent. IGNORE their palette, imagery, text, logos, brand and style. The customer's brief and verified customer-owned assets are the sole style source.

FIDELITY: This atlas will condition seven downstream 3D proofs. Do not invent unrelated graphics between zones. Preserve supplied customer identity faithfully. This v1 atlas is design-proof authority only; exact typography/logo overlays and true PVO contours remain deterministic prepress concerns.

DESIGNIQ FLAT CREATIVE DIRECTION:
${atlasCreativeRules(input)}
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

function rowIdentity(row, manifest, masterBytes, projectionBytes, { reused }) {
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
      sourceMasterHash: row.master_content_hash,
      quality: Number(row.metadata?.projectionQuality),
      chromaSubsampling: "4:4:4",
      widthPx: Number(row.width_px),
      heightPx: Number(row.height_px),
    },
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
  const expectedProjection = await projectionDerivative(masterBytes);
  if (expectedProjection.contentHash !== row.projection_content_hash
    || expectedProjection.byteSize !== Number(row.projection_byte_size)) {
    throw new FlatAtlasError("flat_atlas_projection_source_mismatch", "Stored proof-conditioning derivative is not the deterministic child of the canonical PNG master");
  }
  return rowIdentity(row, manifest, masterBytes, projectionBytes, { reused: true });
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

async function generateOrReuseFlatAtlas(options) {
  const {
    supabase, store, provider, requestId, generationId, tenantKey, ownerId,
    claimToken, input, surfaces, geometryAuthority, topologyExamples = [], logger = () => {},
  } = options;
  if (!supabase || !store || !provider) throw new FlatAtlasError("flat_atlas_runtime_missing", "Atlas authoring requires Supabase, store and provider");
  if (!flatFirstRequested(input)) throw new FlatAtlasError("flat_atlas_input_required", "Atlas authoring only accepts the v3 flat-first input");

  const manifest = buildAtlasManifest(surfaces, geometryAuthority);
  const existing = await loadLatestAtlasRevision(supabase, requestId);
  if (existing) {
    const expectedManifestHash = sha256(canonicalBytes(manifest));
    assertAtlasGeometryBasis(existing, expectedManifestHash);
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
  const guideBytes = await renderAtlasGuide(manifest);
  const guideHash = sha256(guideBytes);
  const guideStoragePath = atlasStoragePath({ tenantKey, generationId, revisionSequence, kind: "guide", contentHash: guideHash });
  const manifestStoragePath = atlasStoragePath({ tenantKey, generationId, revisionSequence, kind: "manifest", contentHash: manifestHash });
  await Promise.all([
    store.putImmutableBytes({ storagePath: guideStoragePath, bytes: guideBytes, contentType: "image/png" }),
    store.putImmutableBytes({ storagePath: manifestStoragePath, bytes: manifestBytes, contentType: "application/json" }),
  ]);

  const parts = [
    // The deterministic guide is deliberately the first IMAGE in the request.
    { inlineData: { mimeType: "image/png", data: guideBytes.toString("base64") } },
    { text: atlasPrompt(input, manifest) },
    ...(await topologyExampleParts(topologyExamples)),
    ...(await verifiedCustomerLogoPart(supabase, input)),
    ...(await verifiedCustomerReferenceParts(supabase, input)),
  ];
  const generated = await provider.generateImage({
    parts,
    aspectRatio: "1:1",
    imageSize: "4K",
    label: "flat-first canonical atlas",
  });
  const masterBytes = await normalizeAtlasMaster(generated.bytes, manifest);
  const masterHash = sha256(masterBytes);
  const masterStoragePath = atlasStoragePath({ tenantKey, generationId, revisionSequence, kind: "master", contentHash: masterHash });
  const projection = await projectionDerivative(masterBytes);
  const projectionStoragePath = atlasStoragePath({
    tenantKey, generationId, revisionSequence, kind: "projection", contentHash: projection.contentHash,
  });
  // Derive first, then persist both immutable after-artifacts together. If the
  // request-safe 4096px derivative cannot meet its hard byte ceiling, no
  // unreferenced master is left behind and the run fails before proof calls.
  await Promise.all([
    store.putImmutableBytes({ storagePath: masterStoragePath, bytes: masterBytes, contentType: "image/png" }),
    store.putImmutableBytes({
      storagePath: projectionStoragePath, bytes: projection.bytes, contentType: projection.contentType,
    }),
  ]);

  const topologyExample = topologyExamples[0] || null;

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
      examplePurpose: EXAMPLE_PURPOSE,
      topologyExamplesApplied: topologyExamples.length,
      topologyExampleIdentity: topologyExample?.identity || null,
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
      proofExecution: "seven-parallel-calls",
    },
  };
  const { data: row, error } = await supabase.from("designpro_flat_atlas_revisions")
    .insert(rowPayload).select("*").single();
  if (error) {
    if (/duplicate|unique/i.test(String(error.message))) {
      const raced = await loadLatestAtlasRevision(supabase, requestId);
      if (raced) {
        assertAtlasGeometryBasis(raced, manifestHash);
        return raced;
      }
    }
    throw new FlatAtlasError("flat_atlas_revision_insert_failed", error.message, true);
  }
  logger(`persisted immutable atlas revision 1 ${masterHash}`);
  return rowIdentity(row, manifest, masterBytes, projection.bytes, { reused: false });
}

function atlasProjectionParts(atlas, sourceViewType) {
  if (!atlas?.master?.bytes || !atlas?.projection?.bytes || atlas.manifest?.contract !== MANIFEST_CONTRACT) {
    throw new FlatAtlasError("flat_atlas_conditioning_invalid", "A verified atlas master, projection derivative and manifest are required for every proof view");
  }
  if (atlas.projection.contentType !== "image/jpeg"
    || atlas.projection.bytes.length !== Number(atlas.projection.byteSize)
    || atlas.projection.bytes.length > PROJECTION_MAX_BYTES
    || sha256(atlas.projection.bytes) !== atlas.projection.contentHash
    || atlas.projection.sourceMasterHash !== atlas.master.contentHash) {
    throw new FlatAtlasError("flat_atlas_projection_identity_mismatch", "Proof conditioning bytes do not match the immutable master-bound projection identity");
  }
  if (!PROOF_VIEWS.includes(sourceViewType)) throw new FlatAtlasError("flat_atlas_proof_view_invalid", `${sourceViewType} is not one of the seven proof views`);
  const visibleZones = atlas.manifest.zones
    .filter((zone) => zone.proofDependencies.includes(sourceViewType))
    .map((zone) => zone.surfaceKey);
  const topology = atlas.manifest.installerMap;
  return [
    {
      inlineData: {
        mimeType: atlas.projection.contentType,
        data: atlas.projection.bytes.toString("base64"),
      },
    },
    {
      text: `CANONICAL FLAT WRAP ATLAS — revision ${atlas.revisionSequence}, canonical PNG sha256 ${atlas.master.contentHash}, proof-conditioning JPEG sha256 ${atlas.projection.contentHash}.
This JPEG is a white-flattened, no-resize transport derivative of the complete immutable PNG atlas, not a new design authority, mood board or second creative prompt. Project its exact artwork onto the requested photoreal vehicle view. Do not redesign, simplify, restyle, replace, mirror, recolor, invent, or borrow artwork from another zone.

Atlas topology: passenger=${topology.passenger}; driver=${topology.driver}; center top-to-bottom=${topology.centerOrderTopToBottom.join(" -> ")} (${topology.longitudinalOrder}). For ${sourceViewType}, the relevant production zones are ${visibleZones.join(", ") || "the complete atlas"}. Keep lettering forward-reading. Preserve zone identity even where a camera reveals more than one surface.

The atlas contains no guide lines: white gaps in this transport JPEG correspond to transparent non-printing gaps in the canonical PNG, not artwork to fill. Return one photoreal 3D proof only.`,
    },
  ];
}

module.exports = {
  ATLAS_CONTRACT,
  BLEED_INCHES,
  CANVAS,
  CENTER_ORDER,
  CUSTOMER_REFERENCE_MAX_PIXELS,
  EXAMPLE_PURPOSE,
  GEOMETRY_AUTHORITY_CONTRACT,
  INPUT_CONTRACT,
  MANIFEST_CONTRACT,
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
  renderAtlasGuide,
  _test: {
    activeZoneMaskSvg,
    assertAtlasGeometryBasis,
    atlasPrompt,
    canonical,
    canonicalBytes,
    customerCreativeBrief,
    atlasCreativeRules,
    fitCenterColumn,
    fitRotatedSide,
    guideSvg,
    normalizedGeometryAuthority,
    normalizedSurfaces,
    round,
    sha256,
    topologyExampleParts,
    verifiedCustomerReferenceParts,
    trimRectangle,
    zoneEffectivePpi,
  },
};
