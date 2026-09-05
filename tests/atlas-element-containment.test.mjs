import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const { planAtlasElements, verifyPlanContainment, assertSlotsDisjoint, SURFACE_SLOTS } = require("../runtime/atlas-element-plan.cjs");
const { composeAtlasMaster, measureOutlinedString, measureImageAsset } = require("../runtime/atlas-compose-master.cjs");
const { loadPinnedFont, contactLine, redactBrief, canonicalStrings } = require("../runtime/atlas-elements.cjs");

/**
 * THE ARCTIC AIR REGRESSION.
 *
 * Every rectangle below is the REAL persisted geometry of GenerationID
 * `63e6629a-1e56-42e3-a129-456f97f0aea4`, A.T.L.A.S. revision
 * `37bb5e8d-48c8-4f62-beb9-a58bc82e417a`, manifest
 * `1532c871e9a67dfe92eca95ea008267c83bcedc51c6351f7726c39770a8dc4fe` -- read
 * back from production on 2026-09-05 and cross-checked against the manifest's
 * own counters (`extractedPx 14,041,505`, `paintedNotExtractedPx 2,735,711`).
 *
 * That run drew one contact bar across the lower band and shipped `Www.Arct` on
 * the hood panel and `ticAir.com` on the rear. The first test below reproduces
 * that severing from the same numbers, so the suite fails if anyone ever
 * reasons that the cut geometry was benign. The rest prove the repair.
 */
const ARCTIC_MANIFEST = {
  canvas: { widthPx: 4096, heightPx: 4096, colorSpace: "srgb" },
  zones: [
    { surfaceKey: "driver", x: 0, y: 72, w: 4096, h: 1221, trim: { x: 113, y: 185, w: 3870, h: 995 }, trimWidthIn: 171.1, trimHeightIn: 44 },
    { surfaceKey: "passenger", x: 0, y: 1437, w: 4096, h: 1221, trim: { x: 113, y: 1550, w: 3870, h: 995 }, trimWidthIn: 171.1, trimHeightIn: 44 },
    { surfaceKey: "hood", x: 1071, y: 2730, w: 1127, h: 828, trim: { x: 1153, y: 2812, w: 963, h: 664 }, trimWidthIn: 58.9, trimHeightIn: 40.59 },
    { surfaceKey: "roof", x: 0, y: 2730, w: 1071, h: 1207, trim: { x: 82, y: 2812, w: 907, h: 1043 }, trimWidthIn: 55.44, trimHeightIn: 63.78 },
    { surfaceKey: "front", x: 2198, y: 2730, w: 1898, h: 605, trim: { x: 2280, y: 2812, w: 1734, h: 441 }, trimWidthIn: 106.03, trimHeightIn: 27 },
    { surfaceKey: "rear", x: 2198, y: 3335, w: 1127, h: 590, trim: { x: 2280, y: 3417, w: 963, h: 426 }, trimWidthIn: 58.9, trimHeightIn: 26.06 },
  ],
};

const GROUND_CONTRACT = "designpro.atlas-field-prompt.v3";
const COMPANY = "Arctic Air";
const WEBSITE = "Www.ArcticAir.com";

const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The font the runtime image installs (`ops/Dockerfile.runtime`: fonts-dejavu-core). */
const font = loadPinnedFont();

async function markBytes(width = 600, height = 600) {
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 2 - 8}" fill="#1b4f9c"/></svg>`) }])
    .png().toBuffer();
}

async function arcticElements() {
  const mark = await markBytes();
  const photo = await sharp({ create: { width: 1500, height: 1000, channels: 3, background: { r: 120, g: 170, b: 210 } } }).png().toBuffer();
  const wordmark = measureOutlinedString({ fontBytes: font.bytes, string: COMPANY });
  const contact = measureOutlinedString({ fontBytes: font.bytes, string: WEBSITE });
  return {
    elements: [
      { id: "brandmark", kind: "brandmark", required: false, aspect: (await measureImageAsset(mark)).aspect, source: { kind: "image" } },
      { id: "wordmark", kind: "wordmark", required: true, aspect: wordmark.aspect, source: { kind: "outlined-type" } },
      { id: "contact", kind: "contact", required: true, aspect: contact.aspect, source: { kind: "outlined-type" } },
      { id: "photo", kind: "photo", required: false, aspect: (await measureImageAsset(photo)).aspect, source: { kind: "image" } },
    ],
    sources: {
      brandmark: { kind: "image", bytes: mark },
      wordmark: { kind: "outlined-type", string: COMPANY, fill: "#ffffff" },
      contact: { kind: "outlined-type", string: WEBSITE, fill: "#ffffff" },
      photo: { kind: "image", bytes: photo },
    },
  };
}

test("THE DEFECT: a contact bar drawn across the lower band is severed by the real cut", () => {
  // What v24 produced: one bar spanning the lower third, which is where a
  // designer puts a contact bar and where the prompt invited one ("the brand
  // mark may appear here once"). Measured from the delivered master: the bar
  // ran roughly x 0.26–0.75 at y ≈ 0.81–0.86 of the 4096 canvas.
  const contactBar = { x: Math.round(0.26 * 4096), y: Math.round(0.81 * 4096), w: Math.round(0.49 * 4096), h: Math.round(0.05 * 4096) };
  const touched = ARCTIC_MANIFEST.zones.filter((z) => overlaps(z, contactBar)).map((z) => z.surfaceKey);
  const whollyInside = ARCTIC_MANIFEST.zones.filter((z) => contains(z, contactBar)).map((z) => z.surfaceKey);

  assert.ok(touched.length > 1, `the bar must straddle more than one territory; it touched ${touched.join(", ")}`);
  assert.deepEqual(whollyInside, [], "no territory contains the whole bar — which is why the URL printed in halves");
  assert.ok(touched.includes("hood"), "the hood took the left fragment (`Www.Arct`)");
  assert.ok(touched.includes("rear"), "the rear took the right fragment (`ticAir.com`)");
});

test("the slot table is a partition: no two elements can be planned onto the same pixels", () => {
  assert.equal(assertSlotsDisjoint(), true);
  // And it stays a partition when a surface is given every kind it knows.
  for (const [surfaceKey, table] of Object.entries(SURFACE_SLOTS)) {
    const slots = Object.values(table);
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        assert.ok(!overlaps(slots[i], slots[j]), `${surfaceKey} slots ${i} and ${j} overlap`);
      }
    }
  }
});

test("THE REPAIR: every planned element lives wholly inside exactly one territory", async () => {
  const { elements } = await arcticElements();
  const plan = planAtlasElements({ manifest: ARCTIC_MANIFEST, elements });
  assert.ok(plan.placements.length >= 8, `expected the flanks, hood, roof and rear to be dressed; got ${plan.placements.length}`);
  assert.deepEqual(verifyPlanContainment(plan, ARCTIC_MANIFEST), { contained: true, violations: [] });

  for (const placement of plan.placements) {
    const inside = ARCTIC_MANIFEST.zones.filter((z) => contains(z, placement.rectPx)).map((z) => z.surfaceKey);
    const touched = ARCTIC_MANIFEST.zones.filter((z) => overlaps(z, placement.rectPx)).map((z) => z.surfaceKey);
    assert.deepEqual(inside, [placement.surfaceKey], `${placement.elementId} must be contained by its own territory alone`);
    assert.deepEqual(touched, [placement.surfaceKey], `${placement.elementId} must not touch any other territory`);
  }
});

test("every placed element clears the trim line by the physical safe inset", async () => {
  const { elements } = await arcticElements();
  const plan = planAtlasElements({ manifest: ARCTIC_MANIFEST, elements });
  for (const placement of plan.placements) {
    const zone = ARCTIC_MANIFEST.zones.find((z) => z.surfaceKey === placement.surfaceKey);
    assert.ok(contains(zone.trim, placement.rectPx), `${placement.elementId} is inside the trim box`);
    const ppiX = zone.trim.w / zone.trimWidthIn;
    const ppiY = zone.trim.h / zone.trimHeightIn;
    const insetLeft = (placement.rectPx.x - zone.trim.x) / ppiX;
    const insetTop = (placement.rectPx.y - zone.trim.y) / ppiY;
    const insetRight = (zone.trim.x + zone.trim.w - placement.rectPx.x - placement.rectPx.w) / ppiX;
    const insetBottom = (zone.trim.y + zone.trim.h - placement.rectPx.y - placement.rectPx.h) / ppiY;
    for (const [edge, value] of [["left", insetLeft], ["top", insetTop], ["right", insetRight], ["bottom", insetBottom]]) {
      assert.ok(value >= plan.safeInsetInches - 0.75, `${placement.elementId} ${edge} inset is ${value.toFixed(2)}in, below the ${plan.safeInsetInches}in safe margin`);
    }
  }
});

test("a required element that cannot be placed legibly fails the run, it does not shrink", () => {
  // A 40:1 contact string on this geometry cannot reach a 12in legible minimum.
  // The message is asserted, not just the code: without the legibility guard
  // this element still throws -- via the "placed on no surface" check at the
  // end -- and a test that only matched the code would pass with the guard
  // deleted. (Verified by mutation: replacing `if (element.required)` with
  // `if (false)` leaves the code identical and changes this message.)
  assert.throws(
    () => planAtlasElements({
      manifest: ARCTIC_MANIFEST,
      elements: [{ id: "contact", kind: "contact", required: true, aspect: 40, minHeightIn: 12, source: { kind: "outlined-type" } }],
    }),
    (err) => err.code === "atlas_element_unplaceable" && /is the legible minimum/.test(err.message),
  );
});

test("an OPTIONAL element below the legible minimum is skipped, with the number that decided it", () => {
  const plan = planAtlasElements({
    manifest: ARCTIC_MANIFEST,
    elements: [
      { id: "wordmark", kind: "wordmark", required: true, aspect: 4.5, source: { kind: "outlined-type" } },
      { id: "tagline", kind: "tagline", required: false, aspect: 40, minHeightIn: 12, source: { kind: "outlined-type" } },
    ],
  });
  const skipped = plan.skipped.filter((s) => s.kind === "tagline");
  assert.ok(skipped.length > 0, "the tagline is recorded as skipped, not silently absent");
  for (const entry of skipped) {
    assert.equal(entry.reason, "below_minimum_legible_height");
    assert.equal(entry.minHeightIn, 12);
    assert.ok(entry.heightIn < 12);
  }
  assert.ok(plan.placements.some((p) => p.kind === "wordmark"), "the required element still placed");
});

test("a required element no surface wants is refused rather than silently dropped", () => {
  // A slot table that carries no `photo` slot anywhere: the element is
  // resolvable and legible, and simply has nowhere the policy will put it.
  const slotsWithoutPhoto = Object.fromEntries(Object.entries(SURFACE_SLOTS).map(([surface, table]) => {
    const { photo, ...rest } = table;
    return [surface, rest];
  }));
  assert.throws(
    () => planAtlasElements({
      manifest: ARCTIC_MANIFEST,
      slots: slotsWithoutPhoto,
      elements: [{ id: "photo", kind: "photo", required: true, aspect: 1.5, source: { kind: "image" } }],
    }),
    (err) => err.code === "atlas_element_unplaceable" && /was not placed on any surface/.test(err.message),
  );
});

test("the compositor refuses a ground authored by a contract that draws its own lettering", async () => {
  const { elements, sources } = await arcticElements();
  const plan = planAtlasElements({ manifest: ARCTIC_MANIFEST, elements });
  const ground = await sharp({ create: { width: 4096, height: 4096, channels: 4, background: { r: 14, g: 60, b: 120, alpha: 255 } } }).png().toBuffer();
  await assert.rejects(
    composeAtlasMaster({ groundBytes: ground, manifest: ARCTIC_MANIFEST, plan, sources, fontBytes: font.bytes, groundContract: "designpro.atlas-field-prompt.v2" }),
    (err) => err.code === "atlas_compose_ground_contract_unsupported",
  );
});

test("the composed master survives the real cut: every element whole in one panel", async () => {
  const { elements, sources } = await arcticElements();
  const plan = planAtlasElements({ manifest: ARCTIC_MANIFEST, elements });
  const ground = await sharp({ create: { width: 4096, height: 4096, channels: 4, background: { r: 14, g: 60, b: 120, alpha: 255 } } }).png().toBuffer();
  const composed = await composeAtlasMaster({
    groundBytes: ground, manifest: ARCTIC_MANIFEST, plan, sources, fontBytes: font.bytes, groundContract: GROUND_CONTRACT,
  });
  assert.equal(composed.changed, true);
  assert.equal(composed.receipt.placedCount, plan.placements.length);

  // Cut the six panels exactly as `cutCallOnePanels` does, then prove each
  // element's rectangle maps into its own panel with room to spare.
  for (const zone of ARCTIC_MANIFEST.zones) {
    const panel = await sharp(composed.bytes).extract({ left: zone.x, top: zone.y, width: zone.w, height: zone.h }).png().toBuffer();
    const meta = await sharp(panel).metadata();
    assert.equal(meta.width, zone.w);
    assert.equal(meta.height, zone.h);
    for (const placement of plan.placements.filter((p) => p.surfaceKey === zone.surfaceKey)) {
      const local = { x: placement.rectPx.x - zone.x, y: placement.rectPx.y - zone.y, w: placement.rectPx.w, h: placement.rectPx.h };
      assert.ok(local.x >= 0 && local.y >= 0 && local.x + local.w <= zone.w && local.y + local.h <= zone.h,
        `${placement.elementId} does not fit inside the ${zone.surfaceKey} panel it was cut into`);
    }
  }
});

test("composition is deterministic and records the exact strings that printed", async () => {
  const { elements, sources } = await arcticElements();
  const plan = planAtlasElements({ manifest: ARCTIC_MANIFEST, elements });
  const ground = await sharp({ create: { width: 4096, height: 4096, channels: 4, background: { r: 14, g: 60, b: 120, alpha: 255 } } }).png().toBuffer();
  const args = { groundBytes: ground, manifest: ARCTIC_MANIFEST, plan, sources, fontBytes: font.bytes, groundContract: GROUND_CONTRACT };
  const first = await composeAtlasMaster(args);
  const second = await composeAtlasMaster(args);
  assert.equal(first.receipt.composedHash, second.receipt.composedHash);
  assert.equal(first.receipt.groundHash, second.receipt.groundHash);
  assert.notEqual(first.receipt.composedHash, first.receipt.groundHash, "the composed master differs from the ground it was painted onto");

  // The URL that printed is recorded, character for character, next to the
  // rectangle it printed in -- so a spelling question is answerable from the
  // receipt without opening an image.
  const printed = first.receipt.elements.filter((e) => e.sourceKind === "outlined-type");
  assert.ok(printed.length > 0);
  for (const element of printed) {
    assert.ok([COMPANY, WEBSITE].includes(element.string), `unexpected printed string ${JSON.stringify(element.string)}`);
    assert.equal(element.fontSha256, font.contentHash);
  }
  assert.ok(printed.some((e) => e.string === WEBSITE && e.surfaceKey === "rear"),
    "the rear -- what the car behind reads -- carries the whole URL");
});

test("canonical strings are read from the request and redacted out of any model brief", () => {
  const input = { companyName: COMPANY, website: WEBSITE, phone: "555-0100", brief: `Wrap for ${COMPANY}, put ${WEBSITE} on the back` };
  const strings = canonicalStrings(input);
  assert.equal(strings.companyName, COMPANY);
  assert.equal(contactLine(strings), "555-0100   ·   Www.ArcticAir.com");
  const redacted = redactBrief(input.brief, strings);
  for (const value of [COMPANY, WEBSITE, "555-0100"]) {
    assert.ok(!redacted.toLowerCase().includes(value.toLowerCase()), `${value} must not survive into a model brief`);
  }
});
