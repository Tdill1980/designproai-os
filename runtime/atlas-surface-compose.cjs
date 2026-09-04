"use strict";

/**
 * THE DETERMINISTIC A.T.L.A.S. COMPOSER.
 *
 * This is the one piece the deterministic assembly path was missing. The
 * Design Master cluster renders six correctly proportioned surfaces, and
 * `flat-first-atlas` already knows how to CUT six panels out of a flattened
 * 4096x4096 master. Nothing joined them: today that flattened master arrives
 * from Gemini, which is why its geometry is a 25/50/25 grid rather than GENIE
 * geometry (Tests 12 and 13, both rejected at every production panel).
 *
 * So this composes it instead, from the six renders, by code.
 *
 * WHY THIS IS SAFE TO BE DETERMINISTIC. Composition and extraction are inverse
 * operations over ONE geometry source. `buildAtlasManifest` is a pure function
 * of the six-surface GENIE geometry and emits, per zone, both the placement
 * rectangle and the `extraction` rectangle that undoes it. Placing a surface at
 * `zone.x/y/w/h` under `zone.rotationDegrees` and then cutting `extraction`
 * under `outputRotationDegrees` returns the same pixels. No inference is
 * involved in either direction, so no model is needed for either.
 *
 * WHAT IT REFUSES. A surface whose aspect ratio does not already agree with its
 * zone is not stretched to fit -- it is rejected. The zone is derived from the
 * same GENIE rectangle the surface was rendered at, so a disagreement beyond
 * rounding means the two came from different geometry, and quietly scaling one
 * onto the other would hide exactly the defect this path exists to prevent.
 * Sub-pixel rounding is absorbed; anything a viewer could see is an error.
 *
 * WHAT IT IS NOT. It does not author, repair, infill, or reinterpret. It never
 * fills a wheel well, because the surfaces it composes have no vehicle anatomy
 * in them to repair.
 */

const sharp = require("sharp");
const { createHash } = require("node:crypto");

const COMPOSE_CONTRACT = "designpro.atlas-surface-compose.v1";
const CANVAS = Object.freeze({ widthPx: 4096, heightPx: 4096 });
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });

/**
 * How far a surface's aspect may differ from its zone's before the composition
 * is refused. Both are derived from one GENIE rectangle, so the only legitimate
 * difference is integer rounding of the zone in pixels: at 4K that is well
 * under a tenth of a percent. 0.5% leaves room for the rounding and none for a
 * genuinely different rectangle.
 */
const MAX_ASPECT_DRIFT = 0.005;

/** The flat ground the zones are laid onto. Never visible inside any panel. */
const CANVAS_BACKGROUND = Object.freeze({ r: 12, g: 12, b: 14, alpha: 1 });

class AtlasComposeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AtlasComposeError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new AtlasComposeError(code, message); };
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * The zone's size in the surface's OWN orientation. A flank is placed rotated,
 * so its zone rectangle is the portrait one and the surface that fills it is
 * the landscape one.
 */
function nativeZoneSize(zone) {
  const rotated = Math.abs(Number(zone.rotationDegrees) || 0) === 90;
  return rotated
    ? { width: zone.h, height: zone.w }
    : { width: zone.w, height: zone.h };
}

function assertAspectAgrees(surfaceKey, native, meta) {
  const zoneAspect = native.width / native.height;
  const surfaceAspect = meta.width / meta.height;
  const drift = Math.abs(zoneAspect - surfaceAspect) / zoneAspect;
  if (!(drift <= MAX_ASPECT_DRIFT)) {
    fail(
      "atlas_compose_aspect_mismatch",
      `${surfaceKey} renders at ${meta.width}x${meta.height} (${surfaceAspect.toFixed(4)}) but its A.T.L.A.S. zone is ${native.width}x${native.height} (${zoneAspect.toFixed(4)}); ` +
      `that is a ${(drift * 100).toFixed(2)}% aspect disagreement, which means the surface and the zone were derived from different geometry`,
    );
  }
  return drift;
}

/**
 * Compose the canonical flattened A.T.L.A.S. master from six surface renders.
 *
 * @param surfaceBytes  Map|object of surfaceKey -> PNG Buffer, all six required.
 * @param manifest      the `buildAtlasManifest` output whose zones are authority.
 * @returns             { bytes, masterContentHash, placements, ... }
 */
async function composeAtlasFromSurfaces(surfaceBytes, manifest) {
  const zones = Array.isArray(manifest?.zones) ? manifest.zones : null;
  if (!zones || zones.length !== SURFACE_KEYS.length) {
    fail("atlas_compose_manifest_invalid", "composition requires a six-zone A.T.L.A.S. manifest");
  }
  const get = (key) => (surfaceBytes instanceof Map ? surfaceBytes.get(key) : surfaceBytes?.[key]);

  const missing = SURFACE_KEYS.filter((key) => !Buffer.isBuffer(get(key)) || !get(key).length);
  if (missing.length) {
    fail("atlas_compose_surface_missing", `composition requires all six surface renders; missing ${missing.join(", ")}`);
  }

  const placements = [];
  const overlays = [];

  // Ordered by surface key rather than by zone order so the composition is
  // reproducible regardless of how the manifest happened to list its zones.
  for (const surfaceKey of SURFACE_KEYS) {
    const zone = zones.find((entry) => entry.surfaceKey === surfaceKey);
    if (!zone) fail("atlas_compose_zone_missing", `the manifest has no zone for ${surfaceKey}`);

    const bytes = get(surfaceKey);
    const native = nativeZoneSize(zone);
    const meta = await sharp(bytes).metadata();
    const aspectDrift = assertAspectAgrees(surfaceKey, native, meta);

    if (meta.width < native.width || meta.height < native.height) {
      // Upscaling a print surface to fill its own zone invents detail that was
      // never authored. Render at or above zone density instead.
      fail(
        "atlas_compose_surface_underscale",
        `${surfaceKey} renders at ${meta.width}x${meta.height}, below its zone's ${native.width}x${native.height}; ` +
        "composition never upsamples a production surface",
      );
    }

    const rotation = Number(zone.rotationDegrees) || 0;
    let pipeline = sharp(bytes).resize(native.width, native.height, {
      fit: "fill", kernel: "lanczos3", fastShrinkOnLoad: false,
    });
    if (rotation !== 0) pipeline = pipeline.rotate(rotation, { background: CANVAS_BACKGROUND });
    const placed = await pipeline.png(PNG_OPTIONS).toBuffer();

    const placedMeta = await sharp(placed).metadata();
    if (placedMeta.width !== zone.w || placedMeta.height !== zone.h) {
      fail(
        "atlas_compose_placement_size_mismatch",
        `${surfaceKey} placed at ${placedMeta.width}x${placedMeta.height} but its zone is ${zone.w}x${zone.h}`,
      );
    }

    overlays.push({ input: placed, left: zone.x, top: zone.y });
    placements.push({
      surfaceKey,
      sourceWidthPx: meta.width,
      sourceHeightPx: meta.height,
      zone: { x: zone.x, y: zone.y, w: zone.w, h: zone.h, rotationDegrees: rotation },
      nativeZone: native,
      aspectDrift: Number(aspectDrift.toFixed(6)),
      sourceHash: sha256(bytes),
      placedHash: sha256(placed),
    });
  }

  const bytes = await sharp({
    create: {
      width: CANVAS.widthPx, height: CANVAS.heightPx,
      channels: 4, background: CANVAS_BACKGROUND,
    },
  }).composite(overlays).png(PNG_OPTIONS).toBuffer();

  return Object.freeze({
    contract: COMPOSE_CONTRACT,
    bytes,
    masterContentHash: sha256(bytes),
    canvas: { ...CANVAS },
    topology: manifest.topology,
    placements: Object.freeze(placements),
    // The composition is a pure function of these, so two runs that agree here
    // must agree on the master bytes.
    compositionHash: sha256(Buffer.from(placements.map((p) => `${p.surfaceKey}:${p.sourceHash}:${p.zone.x},${p.zone.y},${p.zone.w},${p.zone.h},${p.zone.rotationDegrees}`).join("\n"))),
  });
}

module.exports = {
  COMPOSE_CONTRACT,
  CANVAS,
  SURFACE_KEYS,
  MAX_ASPECT_DRIFT,
  AtlasComposeError,
  composeAtlasFromSurfaces,
  _test: { nativeZoneSize, assertAspectAgrees },
};
