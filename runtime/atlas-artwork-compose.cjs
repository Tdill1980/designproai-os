"use strict";

/**
 * CODE OWNS THE GEOMETRY. THE MODEL OWNS THE ARTWORK.
 *
 * This is the composition half of the proven flat-first architecture in
 * supabase/functions/designpro-artboard/index.ts. There, ONE Gemini call
 * produces a wide flat banner of pure wrap artwork — no text, no logos, no
 * vehicle, no panels — and `composeArtboard` then lays out the labelled,
 * dimensioned panels in code, cover-fitting that artwork into each window.
 * `slicePanel` cuts the print files from the same pixels, so every panel is a
 * native-resolution crop of one image and generative drift is structurally
 * impossible.
 *
 * A.T.L.A.S. Call 1 does the inverse today: it hands Gemini a topology guide
 * and thousands of characters of zone instruction and asks it to paint the
 * whole six-zone sheet itself. Measured on the Precision Climate Solutions
 * payload, 2026-08-26, that returns zones die-cut to the vehicle silhouette —
 * wheel arches and glass punched out against bare canvas — which is exactly the
 * failure RULE 0.15 exists to forbid, and which no amount of prompt wording has
 * moved.
 *
 * It cannot happen here. The model is never told there is a vehicle, a panel,
 * an opening or a zone, so it has nothing to cut a hole in; and every zone is
 * filled by a cover-crop of an opaque banner, so full bleed is a property of
 * the compositor rather than a request.
 *
 * WHAT THIS DOES NOT CHANGE. The manifest, the zone rectangles, the trim and
 * print inches, the extraction rotations, `cutCallOnePanels`, the view
 * authorities and every hash in the lineage are untouched — they consume a
 * 4096x4096 atlas exactly as before. This only changes who paints its pixels.
 */

const sharp = require("sharp");

const COMPOSE_CONTRACT = "designpro.atlas-artwork-compose.v1";
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });

class AtlasComposeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.retryable = false;
  }
}

/**
 * WHERE ON THE BANNER EACH SURFACE COMES FROM.
 *
 * designpro-artboard centre-cover-crops every panel out of the same banner. It
 * ships, and for a labelled reference sheet it is fine — but on an A.T.L.A.S.
 * master it shows: four independent centre crops stacked down the middle repeat
 * the same band four times and read as four slices of a design rather than as
 * one wrap. The atlas contract asks for the opposite ("one design laid open").
 *
 * So the banner is read as the vehicle: LEFT IS THE FRONT, RIGHT IS THE REAR.
 * That is the atlas's own convention — `CENTER_ORDER` stacks the centre column
 * rear, roof, hood, front from top to bottom, which the prompt describes as
 * "vehicle rear to front" — and it is what a wrap brief means by a graphic
 * "sweeping front to rear".
 *
 * Each surface then takes the span of the banner it actually occupies on the
 * vehicle, so neighbouring surfaces share their neighbouring artwork and the
 * six zones are consistent slices of one image. This is geometry, not creative
 * direction: no instruction about it reaches the model, and the spans are fixed
 * fractions rather than anything inferred from the picture.
 *
 * The flanks span the whole vehicle and so take the whole banner.
 */
const BANNER_SPAN = Object.freeze({
  driver: [0, 1],
  passenger: [0, 1],
  front: [0, 0.1],
  hood: [0.06, 0.3],
  roof: [0.3, 0.78],
  rear: [0.88, 1],
});

function bannerRegion(surfaceKey, artworkWidth, artworkHeight) {
  const [start, end] = BANNER_SPAN[surfaceKey] || [0, 1];
  const left = Math.round(artworkWidth * start);
  const width = Math.max(1, Math.round(artworkWidth * (end - start)));
  return { left, top: 0, width: Math.min(width, artworkWidth - left), height: artworkHeight };
}

function naturalZoneSize(zone) {
  // A flank's zone box is stored ROTATED — tall on the canvas, with
  // `extraction.outputRotationDegrees` un-rotating it at panel-cut time. The
  // artwork therefore has to be cropped at the surface's NATURAL landscape
  // proportion first and rotated into the box, or the livery would be composed
  // sideways and every panel would come out of the cut rotated twice.
  return zone.rotationDegrees === 0
    ? { width: zone.w, height: zone.h }
    : { width: zone.h, height: zone.w };
}

/**
 * PASSENGER IS THE DRIVER, MIRRORED. DETERMINISTICALLY.
 *
 * The side-twin contract — "PASSENGER is the opposite-facing, mirror-compatible
 * twin of DRIVER: same motif, scene, hierarchy, scale, landmarks and flow" — is
 * a paragraph of prompt today, and the master QC convicts the runs where the
 * model ignores it (live: generation 632642dc, three attempts all refused at
 * passengerMirrorMae ~0.35, each re-roll fed a remedy for a defect it did not
 * have).
 *
 * Composed in code it is not a request at all: passenger is literally the
 * driver crop flipped. The reason that was ever risky — mirrored lettering — is
 * gone, because the banner carries no lettering. Branding is composited after
 * the flip, forward-reading on both flanks by construction.
 */
async function zoneLayer(artwork, zone, { mirror, region }) {
  const natural = naturalZoneSize(zone);
  // TWO PASSES, NOT ONE CHAIN. sharp does not apply operations in call order:
  // an explicit `.rotate(angle)` runs BEFORE `.resize()` in the same pipeline,
  // so chaining them cropped the flanks to the wrong shape (driver came out
  // 2088x1074 against the zone's 1074x3712). Resizing to the surface's natural
  // landscape proportion and rotating the RESULT is what the geometry means.
  let flat = sharp(artwork, { limitInputPixels: false })
    .extract(region)
    .resize({ width: natural.width, height: natural.height, fit: "cover", position: "centre", kernel: "lanczos3" });
  if (mirror) flat = flat.flop();
  let bytes = await flat.png(PNG_OPTIONS).toBuffer();
  if (zone.rotationDegrees !== 0) {
    bytes = await sharp(bytes, { limitInputPixels: false })
      .rotate(zone.rotationDegrees).png(PNG_OPTIONS).toBuffer();
  }
  const meta = await sharp(bytes).metadata();
  if (meta.width !== zone.w || meta.height !== zone.h) {
    throw new AtlasComposeError(
      "atlas_compose_zone_size_mismatch",
      `${zone.surfaceKey} composed at ${meta.width}x${meta.height}, expected ${zone.w}x${zone.h}`,
    );
  }
  return bytes;
}

/**
 * Compose the A.T.L.A.S. master from one flat artwork banner.
 *
 * `branding` is an optional array of per-surface transparent PNG overlays
 * ({ surfaceKey, bytes }) composited over their zone after the artwork — the
 * `buildOverlay` layer from designpro-artboard, which is where the company
 * name, contact bar and customer logo belong once the banner carries no text.
 */
async function composeAtlasFromArtwork({ artworkBytes, manifest, branding = [] }) {
  if (!Buffer.isBuffer(artworkBytes) || !artworkBytes.length) {
    throw new AtlasComposeError("atlas_compose_artwork_required", "The flat artwork banner bytes are required");
  }
  if (!manifest?.canvas?.widthPx || !Array.isArray(manifest?.zones) || !manifest.zones.length) {
    throw new AtlasComposeError("atlas_compose_manifest_invalid", "A zone manifest with a canvas is required");
  }
  const artworkMeta = await sharp(artworkBytes, { limitInputPixels: false }).metadata();
  if (!artworkMeta.width || !artworkMeta.height) {
    throw new AtlasComposeError("atlas_compose_artwork_unreadable", "The artwork banner could not be read");
  }

  const driverZone = manifest.zones.find((zone) => zone.surfaceKey === "driver");
  const overlayBySurface = new Map(
    branding.filter((entry) => Buffer.isBuffer(entry?.bytes)).map((entry) => [entry.surfaceKey, entry.bytes]),
  );

  const composites = [];
  for (const zone of manifest.zones) {
    // Passenger mirrors the DRIVER's geometry, not its own, so the two flanks
    // are the same composition reversed even when their rectangles differ.
    const source = zone.surfaceKey === "passenger" && driverZone ? { ...driverZone, ...pick(zone, ["x", "y", "w", "h", "rotationDegrees", "surfaceKey"]) } : zone;
    composites.push({
      input: await zoneLayer(artworkBytes, source, {
        mirror: zone.surfaceKey === "passenger",
        region: bannerRegion(zone.surfaceKey, artworkMeta.width, artworkMeta.height),
      }),
      left: zone.x,
      top: zone.y,
    });
    const overlay = overlayBySurface.get(zone.surfaceKey);
    if (overlay) composites.push({ input: overlay, left: zone.x, top: zone.y });
  }

  // Outside the rectangles the canvas stays empty, exactly as the authored
  // master's contract already requires.
  const bytes = await sharp({
    create: {
      width: manifest.canvas.widthPx,
      height: manifest.canvas.heightPx,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
    limitInputPixels: false,
  }).composite(composites).png(PNG_OPTIONS).toBuffer();

  return {
    contract: COMPOSE_CONTRACT,
    bytes,
    artwork: { width: artworkMeta.width, height: artworkMeta.height, bytes: artworkBytes.length },
    zonesComposed: manifest.zones.length,
    brandingSurfaces: [...overlayBySurface.keys()].sort(),
  };
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) out[key] = source[key];
  return out;
}

module.exports = {
  COMPOSE_CONTRACT,
  AtlasComposeError,
  composeAtlasFromArtwork,
  _test: { naturalZoneSize, zoneLayer, bannerRegion, BANNER_SPAN },
};
