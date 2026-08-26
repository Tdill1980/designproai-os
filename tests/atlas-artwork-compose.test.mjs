import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const { buildAtlasManifest } = require("../runtime/flat-first-atlas.cjs");
const {
  COMPOSE_CONTRACT,
  composeAtlasFromArtwork,
  detectArtworkBox,
  _test: { BANNER_SPAN, bannerRegion, naturalZoneSize },
} = require("../runtime/atlas-artwork-compose.cjs");
const { ATLAS_ARTWORK_SYSTEM_INSTRUCTION, buildAtlasArtworkDirection } = require("../runtime/designiq-prompt.cjs");

const SURFACES = [
  { surfaceKey: "driver", widthInches: 232, heightInches: 60, surfaceSqFt: 96.67, bleed: { top: 5, right: 5, bottom: 5, left: 5 } },
  { surfaceKey: "passenger", widthInches: 232, heightInches: 60, surfaceSqFt: 96.67, bleed: { top: 5, right: 5, bottom: 5, left: 5 } },
  { surfaceKey: "hood", widthInches: 68, heightInches: 62, surfaceSqFt: 29.28, bleed: { top: 5, right: 5, bottom: 5, left: 5 } },
  { surfaceKey: "roof", widthInches: 62, heightInches: 78, surfaceSqFt: 33.58, bleed: { top: 5, right: 5, bottom: 5, left: 5 } },
  { surfaceKey: "front", widthInches: 80, heightInches: 50, surfaceSqFt: 27.78, bleed: { top: 5, right: 5, bottom: 5, left: 5 } },
  { surfaceKey: "rear", widthInches: 80, heightInches: 62, surfaceSqFt: 34.44, bleed: { top: 5, right: 5, bottom: 5, left: 5 } },
];

// A directional banner. A wrong rotation, a missing mirror or a centre-crop
// regression is visible in the assertions below rather than merely plausible.
async function testBanner() {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160">
    <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#0d2f63"/><stop offset="1" stop-color="#1a4f9c"/></linearGradient></defs>
    <rect width="3840" height="2160" fill="url(#g)"/>
    <path d="M0 1500 C 1200 900 2400 1900 3840 1100 L3840 2160 L0 2160 Z" fill="#e8621f"/>
    <circle cx="500" cy="450" r="240" fill="#ffd9a0"/>
    <circle cx="3300" cy="600" r="200" fill="#7fd4ff"/></svg>`)).png().toBuffer();
}

// What the model actually returned on the live canary, 2026-08-26: the artwork
// hung on a grey wall, with a lit bevel along its top edge and a soft drop
// shadow below and right of it. Every element here is one the real banner had.
async function mountedBanner({ wall = "#d8d8d6", left = 292, top = 640 } = {}) {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160">
    <rect width="3840" height="2160" fill="${wall}"/>
    <rect x="${left + 40}" y="${top + 40}" width="3260" height="900" fill="#9a9a98"/>
    <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#0d2f63"/><stop offset="1" stop-color="#1a4f9c"/></linearGradient></defs>
    <rect x="${left}" y="${top}" width="3260" height="900" fill="url(#g)"/>
    <path d="M${left} ${top + 700} C ${left + 1000} ${top + 300} ${left + 2200} ${top + 850} ${left + 3260} ${top + 400} L${left + 3260} ${top + 900} L${left} ${top + 900} Z" fill="#e8621f"/>
    <circle cx="${left + 600}" cy="${top + 250}" r="140" fill="#ffd9a0"/>
    <rect x="${left}" y="${top}" width="3260" height="14" fill="#f4f4f2"/>
  </svg>`)).png().toBuffer();
}

async function zoneAlpha(atlasBytes, zone) {
  const { data, info } = await sharp(atlasBytes)
    .extract({ left: zone.x, top: zone.y, width: zone.w, height: zone.h })
    .raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  for (let i = 3; i < data.length; i += info.channels) if (data[i] > 250) opaque += 1;
  return opaque / (info.width * info.height);
}

// FULL BLEED STOPS BEING A REQUEST.
//
// RULE 0.15 is asked for in prose today and the model decides whether to honour
// it — measured 2026-08-26, it returns zones die-cut to a vehicle silhouette
// with wheel arches and glass punched out. Composed from an opaque banner it is
// a property of the compositor: there is no path through this code that leaves
// a transparent pixel inside a zone.
test("every zone is fully opaque, because code fills it rather than asking for it", async () => {
  const manifest = buildAtlasManifest(SURFACES);
  const { bytes, contract, zonesComposed } = await composeAtlasFromArtwork({
    artworkBytes: await testBanner(), manifest,
  });
  assert.equal(contract, COMPOSE_CONTRACT);
  assert.equal(zonesComposed, 6);

  const meta = await sharp(bytes).metadata();
  assert.equal(meta.width, manifest.canvas.widthPx);
  assert.equal(meta.height, manifest.canvas.heightPx);

  for (const zone of manifest.zones) {
    assert.equal(await zoneAlpha(bytes, zone), 1, `${zone.surfaceKey} must be opaque corner to corner`);
  }
});

// THE SIDE-TWIN CONTRACT STOPS BEING A COIN FLIP.
//
// It is a paragraph of prompt today, and the master QC convicts the runs that
// ignore it — live, generation 632642dc: three attempts, every one refused at
// passengerMirrorMae ~0.35. Composed in code, passenger IS the driver flipped,
// so the same measurement is exactly zero. The reason mirroring was ever risky
// (reversed lettering) is gone because the banner carries no lettering.
test("passenger is the driver mirrored, exactly", async () => {
  const manifest = buildAtlasManifest(SURFACES);
  const { bytes } = await composeAtlasFromArtwork({ artworkBytes: await testBanner(), manifest });

  const cut = async (surfaceKey) => {
    const zone = manifest.zones.find((z) => z.surfaceKey === surfaceKey);
    return sharp(bytes)
      .extract({ left: zone.x, top: zone.y, width: zone.w, height: zone.h })
      .rotate(zone.extraction.outputRotationDegrees)
      .raw().toBuffer({ resolveWithObject: true });
  };
  const driver = await cut("driver");
  const passenger = await cut("passenger");
  assert.deepEqual(
    [driver.info.width, driver.info.height],
    [passenger.info.width, passenger.info.height],
    "both flanks cut to the same shape",
  );

  const flipped = await sharp(passenger.data, {
    raw: { width: passenger.info.width, height: passenger.info.height, channels: passenger.info.channels },
  }).flop().raw().toBuffer();

  let total = 0;
  for (let i = 0; i < driver.data.length; i += 1) total += Math.abs(driver.data[i] - flipped[i]);
  assert.equal(total / driver.data.length, 0, "passengerMirrorMae must be 0, not merely small");
});

// THE FLANKS ARE COMPOSED LANDSCAPE AND ROTATED IN.
//
// A flank's zone box is stored rotated, with extraction.outputRotationDegrees
// un-rotating it at panel-cut time. Cropping at the box's own tall proportion
// would compose the livery sideways and the cut would rotate it a second time.
test("a flank is cropped at its natural landscape proportion, not its rotated box", () => {
  const manifest = buildAtlasManifest(SURFACES);
  const driver = manifest.zones.find((z) => z.surfaceKey === "driver");
  const hood = manifest.zones.find((z) => z.surfaceKey === "hood");

  assert.notEqual(driver.rotationDegrees, 0);
  assert.deepEqual(naturalZoneSize(driver), { width: driver.h, height: driver.w });
  assert.equal(driver.h > driver.w, true, "the flank box is tall on the canvas");

  assert.equal(hood.rotationDegrees, 0);
  assert.deepEqual(naturalZoneSize(hood), { width: hood.w, height: hood.h });
});

// LEFT IS THE FRONT, RIGHT IS THE REAR.
//
// Not a creative instruction — no part of it reaches the model. It is the
// atlas's own convention (CENTER_ORDER stacks the centre column rear, roof,
// hood, front, which the prompt calls "vehicle rear to front"), used so
// neighbouring surfaces are cut from neighbouring artwork and the six zones
// read as one wrap instead of four repeats of the same centre band.
test("each surface is cut from the span of the banner it occupies on the vehicle", () => {
  assert.deepEqual(BANNER_SPAN.driver, [0, 1], "a flank spans the whole vehicle");
  assert.deepEqual(BANNER_SPAN.passenger, [0, 1]);
  assert.equal(BANNER_SPAN.front[0], 0, "the front is the left end of the banner");
  assert.equal(BANNER_SPAN.rear[1], 1, "the rear is the right end");
  for (const key of ["front", "hood", "roof", "rear"]) {
    const [start, end] = BANNER_SPAN[key];
    assert.equal(end > start, true, `${key} span runs forwards`);
    assert.equal(start >= 0 && end <= 1, true, `${key} span stays inside the banner`);
  }
  // front → hood → roof → rear must advance along the banner.
  const order = ["front", "hood", "roof", "rear"].map((k) => BANNER_SPAN[k][0]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "spans advance front to rear");

  const region = bannerRegion("rear", 4000, 2000);
  assert.equal(region.left + region.width <= 4000, true, "a span never reads past the banner");
  assert.equal(region.height, 2000);
});

// A MOUNT IS NOT ARTWORK.
//
// Asked for a flat banner of pure artwork with "no mockup, no shadow, no
// frame", the live model returned it hung on a grey wall with a bevel and a
// drop shadow (canary, 2026-08-26). Composed as-is that frame prints as a grey
// border on all six panels, so it is removed in code before anything is cropped.
test("a banner the model mounted on a wall is composed from the artwork, not the wall", async () => {
  const banner = await mountedBanner();
  const box = await detectArtworkBox(banner);

  assert.equal(box.trimmed, true, "the mount must be detected");
  assert.equal(box.reason, "frame_removed");
  // The wall, the bevel highlight and the shadow are all gone; the artwork is not.
  assert.ok(Math.abs(box.left - 292) < 40, `left edge found at ${box.left}, artwork starts at 292`);
  assert.ok(box.top > 640 && box.top < 700, `top edge found at ${box.top}, artwork starts at 640 under a 14px bevel`);
  assert.ok(box.width > 3100 && box.width <= 3300, `width ${box.width} should be about the artwork's 3260`);
  assert.ok(box.height > 800 && box.height <= 900, `height ${box.height} should be under the artwork's 900`);

  // And the composed atlas carries none of it: every zone is still full bleed,
  // and the result records what it was actually composed from.
  const manifest = buildAtlasManifest(SURFACES);
  const { bytes, artwork } = await composeAtlasFromArtwork({ artworkBytes: banner, manifest });
  assert.equal(artwork.composedFrom.trimmed, true);
  assert.equal(artwork.composedFrom.width, box.width);
  for (const zone of manifest.zones) {
    assert.equal(await zoneAlpha(bytes, zone), 1, `${zone.surfaceKey} stays opaque after the trim`);
  }
});

// AND IT LEAVES A CLEAN BANNER ALONE.
//
// The no-op case is the one that matters most: edge-to-edge artwork has four
// corners that disagree, so there is no surround to agree on and nothing is cut.
test("an edge-to-edge banner is composed untouched", async () => {
  const box = await detectArtworkBox(await testBanner());
  assert.equal(box.trimmed, false);
  assert.equal(box.reason, "corners_disagree");
  assert.deepEqual([box.left, box.top], [0, 0]);
});

// A DETECTOR THAT WOULD EAT THE DESIGN REFUSES INSTEAD.
//
// A near-monochrome wrap reads as low chroma everywhere, which is the same
// signal the bevel and the shadow give. On that input the measurement cannot be
// trusted, so the banner is composed whole and the reason is recorded rather
// than a guess being applied.
test("a near-monochrome design is not mistaken for a frame", async () => {
  const greyscale = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160">
    <rect width="3840" height="2160" fill="#3a3a3a"/>
    <path d="M0 1400 C 1200 800 2400 1800 3840 1000 L3840 2160 L0 2160 Z" fill="#6e6e6e"/>
    <circle cx="900" cy="500" r="260" fill="#8f8f8f"/></svg>`)).png().toBuffer();

  const box = await detectArtworkBox(greyscale);
  assert.equal(box.trimmed, false, "a monochrome design must survive whole");
  assert.equal(box.reason, "implausible_trim");
  assert.deepEqual([box.width, box.height], [3840, 2160]);
});

// THE CRAFT TRAVELS; THE TOPOLOGY DOES NOT.
//
// The whole point of the split: this call carries the DesignIQ creative
// intelligence and says nothing about zones, guides or vehicles, because code
// owns all of that now.
test("the artwork call carries DesignIQ craft and no topology", () => {
  const { COMMERCIAL_DEPTH, COMMERCIAL_TRANSLATION, PROFESSIONAL_JUDGMENT, COMMERCIAL_AUTHORING_PERSONA } =
    require("../runtime/designiq-prompt.cjs");
  const prompt = buildAtlasArtworkDirection({
    brief: "Bold commercial HVAC wrap, deep blue with sunrise-orange airflow ribbons",
    mode: "commercial",
    industry: "HVAC and climate control",
    colors: ["deep blue", "sunrise orange"],
    finish: "Gloss",
    vehicle: { year: "2022", make: "Ford", model: "F250 Crew Cab", type: "truck" },
  });

  assert.equal(ATLAS_ARTWORK_SYSTEM_INSTRUCTION, COMMERCIAL_AUTHORING_PERSONA);
  for (const craft of [COMMERCIAL_TRANSLATION, COMMERCIAL_DEPTH, PROFESSIONAL_JUDGMENT]) {
    assert.ok(prompt.includes(craft), "the DesignIQ craft must travel into the artwork call");
  }
  assert.match(prompt, /deep blue, sunrise orange/);
  assert.match(prompt, /HVAC and climate control/);
  assert.match(prompt, /GLOSS/);

  // Geometry is code's now, so none of it is said.
  for (const topology of [/ZONE MAP/, /TOPOLOGY LOCK/, /A\.T\.L\.A\.S\. guide/, /SOLID PANELS/, /FULL BLEED PER ZONE/, /rotation \d/, /passenger flank/]) {
    assert.doesNotMatch(prompt, topology, `the artwork call must not carry topology: ${topology}`);
  }
  // And the banner must stay text-free, because it is cover-cropped six ways.
  assert.match(prompt, /no text, no letters, no words, no numbers, no logos/);
  assert.ok(prompt.length < 3000, `the artwork call is ${prompt.length} chars; the topology-heavy call was 9,388`);
});
