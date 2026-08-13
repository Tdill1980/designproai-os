"use strict";

/**
 * Phase 6: procedural vehicle view plates, derived from the GENIE manifest.
 *
 * The 3D proof needs a plate per view: a body to put artwork on, the light
 * falling across it, a mask saying where the vinyl goes, and a mesh saying how
 * the flat panel lands on it. Photographic plates are per-vehicle content that
 * has to be produced; none exists yet, and the canary cannot wait for a
 * photography pipeline.
 *
 * So these are drawn, not photographed. Every number comes from the bound
 * dimension manifest — the same source the surfaces themselves are cut to — and
 * every mesh is declared by this module rather than fitted to anything. In
 * particular nothing here looks at the Calls 1-7 renders. Inferring where a
 * panel sits by measuring a generated picture of a vehicle is the inverse
 * problem that made Call 8 unsafe, and a schematic that is honestly schematic
 * is worth more than a photoreal one that is quietly wrong.
 *
 * WHAT THIS IS NOT. It is not a plate-authoring platform, and it is not a
 * claim to look like the vehicle. It is an orthographic presentation: each
 * panel shown flat-on at its true proportions, lit enough to read as a surface
 * rather than a swatch. When real photographic plates are authored they replace
 * these by dropping in a different plate set — the contract is content
 * addressed precisely so that swap needs no code change.
 *
 * PRESENTATION ONLY. The 3D proof already declares manufacturingAuthority
 * false; these plates carry the same statement in their own provenance, because
 * a schematic body is even less measurable than a photograph of a real one.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { SURFACE_KEYS } = require("./design-master.cjs");
const { validateViewPlates, VIEW_PLATE_CONTRACT } = require("./vehicle-view-plate.cjs");

const PROCEDURAL_PLATE_CONTRACT = "designpro.procedural-view-plates.v1";
// Fixed encoder settings, as everywhere else: the same manifest must produce
// the same plate bytes, or the revision bundle's identity would move on its own.
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });

const FRAME = Object.freeze({ widthPx: 1600, heightPx: 1000 });
// The panel card sits inside this inset, so the body reads as an object in a
// frame rather than a full-bleed rectangle.
const MARGIN_PX = 120;
const CAPTION_PX = 132;

const INK = "#11151c";
const GROUND = "#171b22";
const BODY = "#39424f";
const EDGE = "#5a6472";

const HANDEDNESS = Object.freeze({ driver: "left", passenger: "right" });

class ProceduralPlateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ProceduralPlateError";
  }
}

function fail(code, message) {
  throw new ProceduralPlateError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Where the panel card sits in the frame, at the panel's true proportions.
 *
 * The aspect ratio is the trim rectangle's, so a customer looking at the hood
 * sees a hood-shaped area and not a generic tile. Proportion is the one thing a
 * schematic can be honest about for free, and it is also the thing that makes
 * a wrong panel obvious at a glance.
 */
function cardFor(surface, viewKey) {
  // Room for the vehicle drawn around the panel: a cab and roofline above a
  // flank, wheels below it, fenders beside a hood. Without this the body would
  // be clipped by the frame and the panel would once again be the whole
  // subject, which is the thing that made an earlier version read as a swatch.
  const headroom = viewKey === "driver" || viewKey === "passenger"
    ? { above: 0.74, below: 0.52, beside: 0.02 }
    : viewKey === "front" || viewKey === "rear"
      ? { above: 0.60, below: 0.45, beside: 0.04 }
      : { above: 0.10, below: 0.14, beside: 0.12 };

  const available = {
    w: (FRAME.widthPx - MARGIN_PX * 2) / (1 + headroom.beside * 2),
    h: (FRAME.heightPx - CAPTION_PX - MARGIN_PX * 2) / (1 + headroom.above + headroom.below),
  };
  const aspect = surface.widthInches / surface.heightInches;
  let w = available.w;
  let h = w / aspect;
  if (h > available.h) {
    h = available.h;
    w = h * aspect;
  }
  // Sat so the drawn body is centred in the frame, not the panel.
  const bodyTop = (FRAME.heightPx - CAPTION_PX - h * (1 + headroom.above + headroom.below)) / 2;
  return {
    x: Math.round((FRAME.widthPx - w) / 2),
    y: Math.round(bodyTop + h * headroom.above),
    w: Math.round(w),
    h: Math.round(h),
  };
}

/**
 * The schematic body: a ground, a shadow, and the panel card with its edge.
 *
 * Deliberately quiet. The artwork is the subject; the plate's job is to give it
 * somewhere to sit and something to be lit by.
 */
function chrome() {
  return `<defs>
      <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${GROUND}"/><stop offset="1" stop-color="${INK}"/>
      </linearGradient>
      <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${EDGE}"/><stop offset="0.5" stop-color="${BODY}"/><stop offset="1" stop-color="#262c35"/>
      </linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stop-color="#0f151d"/><stop offset="1" stop-color="#1d2732"/>
      </linearGradient>
    </defs>
    <rect width="${FRAME.widthPx}" height="${FRAME.heightPx}" fill="url(#ground)"/>`;
}

const wheel = (cx, cy, r) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#0a0d12"/><circle cx="${cx}" cy="${cy}" r="${Math.round(r * 0.46)}" fill="#414a57"/>`;

/**
 * The vehicle each view is looking at, drawn around the wrap area.
 *
 * The card is the panel, not the subject. A customer looking at a proof needs
 * to see their design on a vehicle — a flank with a cab and wheels above and
 * below it, a hood between fenders, a tailgate between lamps — because that is
 * what tells them at a glance whether the artwork sits where they meant it to.
 * A floating rectangle tells them nothing and looks like a swatch.
 *
 * Every dimension is a proportion of the card, and the card comes from the
 * manifest, so the vehicle around it is still declared rather than observed.
 * It is a schematic and does not claim to be a photograph of their truck.
 */
function bodyFor(viewKey, card) {
  const { x, y, w, h } = card;
  const cx = x + w / 2;
  if (viewKey === "driver" || viewKey === "passenger") {
    // Side elevation: cab and roofline above the wrap band, sills and wheels
    // below it. The nose faces left on the driver side and right on the
    // passenger side, matching the handedness the plate declares.
    const noseLeft = viewKey === "driver";
    const cabIn = Math.round(w * 0.30);
    const cabX = noseLeft ? x + cabIn : x;
    const roof = Math.round(h * 0.62);
    const glassInset = Math.round(h * 0.12);
    const wheelR = Math.round(h * 0.30);
    const wheelY = y + h + Math.round(h * 0.12);
    const frontWheel = noseLeft ? x + Math.round(w * 0.17) : x + Math.round(w * 0.83);
    const rearWheel = noseLeft ? x + Math.round(w * 0.78) : x + Math.round(w * 0.22);
    return `
      ${wheel(frontWheel, wheelY, wheelR)}${wheel(rearWheel, wheelY, wheelR)}
      <path d="M${cabX},${y} L${cabX + Math.round(w * 0.16)},${y - roof} L${cabX + Math.round(w * 0.56)},${y - roof} L${cabX + Math.round(w * 0.70)},${y} Z" fill="url(#body)"/>
      <path d="M${cabX + Math.round(w * 0.04)},${y - glassInset} L${cabX + Math.round(w * 0.18)},${y - roof + glassInset} L${cabX + Math.round(w * 0.54)},${y - roof + glassInset} L${cabX + Math.round(w * 0.66)},${y - glassInset} Z" fill="url(#glass)"/>
      <rect x="${x - 12}" y="${y - 12}" width="${w + 24}" height="${h + 24}" rx="8" fill="url(#body)"/>
      <rect x="${x - 12}" y="${y + h + 6}" width="${w + 24}" height="${Math.round(h * 0.10)}" fill="#20262f"/>`;
  }
  if (viewKey === "hood" || viewKey === "roof") {
    // Plan view: the panel between the fenders, seen from directly above.
    const fender = Math.round(w * 0.09);
    return `
      <rect x="${x - fender}" y="${y - 16}" width="${w + fender * 2}" height="${h + 32}" rx="18" fill="url(#body)"/>
      <rect x="${x - fender + 8}" y="${y - 8}" width="${fender - 12}" height="${h + 16}" rx="6" fill="#2a313b"/>
      <rect x="${x + w + 4}" y="${y - 8}" width="${fender - 12}" height="${h + 16}" rx="6" fill="#2a313b"/>
      ${viewKey === "roof"
        ? `<rect x="${x - fender - 6}" y="${y - 44}" width="${w + fender * 2 + 12}" height="34" rx="10" fill="url(#glass)"/>
           <rect x="${x - fender - 6}" y="${y + h + 10}" width="${w + fender * 2 + 12}" height="34" rx="10" fill="url(#glass)"/>`
        : `<rect x="${x - fender - 6}" y="${y + h + 12}" width="${w + fender * 2 + 12}" height="40" rx="10" fill="url(#glass)"/>`}`;
  }
  // Front and rear elevation: the panel across the body, lamps either side.
  const lampW = Math.round(w * 0.13);
  const lampH = Math.round(h * 0.30);
  return `
    <rect x="${x - 18}" y="${y - Math.round(h * 0.55)}" width="${w + 36}" height="${h + Math.round(h * 0.55) + 20}" rx="16" fill="url(#body)"/>
    <rect x="${x - 6}" y="${y - Math.round(h * 0.50)}" width="${w + 12}" height="${Math.round(h * 0.36)}" rx="10" fill="url(#glass)"/>
    <rect x="${x - 2}" y="${y + Math.round(h * 0.34)}" width="${lampW}" height="${lampH}" rx="6" fill="#c9d4e2" opacity="0.55"/>
    <rect x="${x + w - lampW + 2}" y="${y + Math.round(h * 0.34)}" width="${lampW}" height="${lampH}" rx="6" fill="#c9d4e2" opacity="0.55"/>
    ${wheel(x + Math.round(w * 0.12), y + h + Math.round(h * 0.14), Math.round(h * 0.26))}
    ${wheel(x + Math.round(w * 0.88), y + h + Math.round(h * 0.14), Math.round(h * 0.26))}
    <rect x="${cx - Math.round(w * 0.5)}" y="${y + h + 4}" width="${w}" height="${Math.round(h * 0.12)}" fill="#20262f"/>`;
}

async function basePlate(viewKey, card) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.widthPx}" height="${FRAME.heightPx}">
    ${chrome()}
    <ellipse cx="${card.x + card.w / 2}" cy="${card.y + card.h + Math.round(card.h * 0.42)}" rx="${Math.round(card.w * 0.56)}" ry="20" fill="#000000" opacity="0.5"/>
    ${bodyFor(viewKey, card)}
    <rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" fill="#2f3742"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png(PNG_OPTIONS).toBuffer();
}

/**
 * One 8-bit band over the frame, written pixel by pixel so it is exactly
 * reproducible rather than dependent on how a rasteriser interpolates a
 * gradient.
 */
function band(fill) {
  const bytes = Buffer.alloc(FRAME.widthPx * FRAME.heightPx);
  for (let y = 0; y < FRAME.heightPx; y += 1) {
    for (let x = 0; x < FRAME.widthPx; x += 1) bytes[y * FRAME.widthPx + x] = fill(x, y);
  }
  return sharp(bytes, { raw: { width: FRAME.widthPx, height: FRAME.heightPx, channels: 1 } }).png(PNG_OPTIONS).toBuffer();
}

/**
 * Light across the card: brighter along the upper third, falling off toward the
 * lower edge, so flat artwork picks up something to sit on. Clamped well above
 * black — a schematic that crushes the artwork's shadows is misrepresenting the
 * design, which is the one thing a proof may not do.
 */
function shadingBand(card) {
  return band((x, y) => {
    const across = 1 - Math.abs((x - (card.x + card.w * 0.42)) / (card.w * 0.85 || 1));
    const down = 1 - Math.abs((y - (card.y + card.h * 0.34)) / (card.h * 0.9 || 1));
    const lit = 176 + 46 * Math.max(0, across) + 26 * Math.max(0, down);
    return Math.max(150, Math.min(255, Math.round(lit)));
  });
}

/** A soft diagonal sheen, for laminate. Subtle by design. */
function specularBand(card) {
  return band((x, y) => {
    const t = (y - card.y - card.h * 0.22 - (x - card.x) * 0.06) / Math.max(1, card.h * 0.16);
    return Math.round(46 * Math.exp(-t * t));
  });
}

/** Vinyl goes exactly on the card, and nowhere else. */
function maskBand(card) {
  return band((x, y) => (x >= card.x && x < card.x + card.w && y >= card.y && y < card.y + card.h ? 255 : 0));
}

/**
 * The mesh: the trim rectangle, mapped onto the card.
 *
 * One cell, declared, orthographic. A schematic has no curvature to describe,
 * and inventing some would be inventing geometry — the exact thing this module
 * exists to avoid. It is meshed a pixel proud of the mask on every side so the
 * mask does the trimming and no masked pixel is left unpainted.
 */
function meshFor(card) {
  const left = card.x - 1;
  const top = card.y - 1;
  const right = card.x + card.w + 1;
  const bottom = card.y + card.h + 1;
  return {
    rows: 1,
    cols: 1,
    points: [
      { u: 0, v: 0, x: left, y: top }, { u: 1, v: 0, x: right, y: top },
      { u: 0, v: 1, x: left, y: bottom }, { u: 1, v: 1, x: right, y: bottom },
    ],
  };
}

/**
 * Build a complete plate set for one vehicle from its bound dimension manifest.
 *
 * Returns the validated plate set and the bytes behind every asset it names, so
 * a caller can hand both to the 3D proof without a storage round trip.
 */
async function proceduralViewPlates({ manifest, plateSetId, vehicleId, dimensionManifestId, manifestHash }) {
  const expected = Array.isArray(manifest?.expectedSurfaces) ? manifest.expectedSurfaces : null;
  if (!expected) fail("plate_manifest_missing", "procedural plates require the bound GENIE dimension manifest");

  const byKey = new Map();
  for (const entry of expected) {
    const surfaceKey = String(entry?.surfaceKey || "").trim().toLowerCase();
    const widthInches = Number(entry?.widthInches);
    const heightInches = Number(entry?.heightInches);
    if (!SURFACE_KEYS.includes(surfaceKey) || !(widthInches > 0) || !(heightInches > 0)) continue;
    byKey.set(surfaceKey, { surfaceKey, widthInches, heightInches });
  }
  const missing = SURFACE_KEYS.filter((key) => !byKey.has(key));
  if (missing.length) fail("plate_manifest_incomplete", `the manifest is missing ${missing.join(", ")}`);

  const assets = new Map();
  const put = (assetId, bytes) => {
    assets.set(assetId, bytes);
    return { assetId, contentHash: sha256(bytes) };
  };

  const views = [];
  for (const surfaceKey of SURFACE_KEYS) {
    const surface = byKey.get(surfaceKey);
    const card = cardFor(surface, surfaceKey);
    const label = `${surfaceKey.toUpperCase()} · ${round2(surface.widthInches)}" × ${round2(surface.heightInches)}"`;
    views.push({
      viewKey: surfaceKey,
      label,
      // A flank view still declares which side faces the camera, so the
      // contract's handedness check protects the schematic exactly as it would
      // protect a photograph.
      handedness: HANDEDNESS[surfaceKey] || "none",
      base: put(`plate-${surfaceKey}-base`, await basePlate(surfaceKey, card)),
      shading: put(`plate-${surfaceKey}-shading`, await shadingBand(card)),
      specular: put(`plate-${surfaceKey}-specular`, await specularBand(card)),
      panels: [{
        surfaceKey,
        mask: put(`plate-${surfaceKey}-mask`, await maskBand(card)),
        mesh: meshFor(card),
      }],
    });
  }

  const plates = validateViewPlates({
    contract: VIEW_PLATE_CONTRACT,
    plateSetId, vehicleId, dimensionManifestId, manifestHash,
    widthPx: FRAME.widthPx, heightPx: FRAME.heightPx,
    views,
  });

  return Object.freeze({
    contract: PROCEDURAL_PLATE_CONTRACT,
    plates,
    assets,
    // Said here as well as on the proof. A drawn body is even less measurable
    // than a photograph of a real one, and nothing downstream should ever read
    // a dimension off one of these.
    manufacturingAuthority: false,
    presentation: "orthographic-schematic",
    geometrySource: "genie-dimension-manifest",
  });
}

module.exports = {
  PROCEDURAL_PLATE_CONTRACT,
  FRAME,
  ProceduralPlateError,
  proceduralViewPlates,
  _test: { cardFor, meshFor, sha256 },
};
