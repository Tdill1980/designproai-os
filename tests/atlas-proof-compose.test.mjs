/**
 * THE DOCUMENT IS COMPOSITED; THE ARTWORK IS NOT TOUCHED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-18: "The model is treating panel dimensions (e.g. writing
 * 195.7 x 89.6 instead of the actual 141 x 78 spec) as free-form numbers to
 * invent rather than strict mathematical constants", and the legends collapsing
 * into "garbled, repetitive metadata".
 *
 * Live 35393135814 wrote 195.7" x 89.6" in Zone 1, 155.7" x 49.6" in Zone 2 and
 * 105.7" x 49.6" in its own reference table, for one request that said 141 x 78 —
 * three different answers to the same question on one sheet. Its notes read
 * "Drop-impertanli zlomadte onteed".
 *
 * Both fixes the owner proposed had already been measured here and neither is
 * the answer: the numbers were ALREADY burned into the attached container ("141.0"
 * ten times, "78.0" twelve), and a negative constraint is the shape `map_drawn`
 * has watched fail 4/4. So the remedy is RestylePro's, which its own CLAUDE.md
 * states in as many words — the sheet's furniture is DRAWN, never prompted, "so
 * they cannot be hallucinated".
 *
 * WHICH MAKES THE TEST'S JOB EXACTLY TWO THINGS, and they pull against each
 * other, which is why both are here:
 *
 *   1. the document must LAND — at the sheet's own resolution, not scaled up
 *      from a 1536px raster, or the 8px caption is as unreadable as the one it
 *      replaced;
 *   2. the ARTWORK must SURVIVE — a compositor that covered the panels would
 *      produce a beautifully typeset sheet with no design on it, and every
 *      receipt would still call it composited.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { composeProofChrome, CHROME_CONTRACT } =
  require_("../runtime/atlas-proof-compose.cjs");
const { parsePanelRows, containerLayout, containerSvg, WIDTH, HEIGHT } =
  require_("../runtime/atlas-proof-container-template.cjs");
const sharp = require_("../runtime/node_modules/sharp");

const ROWS = [
  'DRIVER: 141.0" wide x 78.0" high',
  'PASSENGER: 141.0" wide x 78.0" high',
  'ROOF: 148.0" wide x 68.0" high',
  'HOOD: 66.0" wide x 42.0" high',
  'FRONT: 74.0" wide x 36.0" high',
  'REAR: 70.0" wide x 80.0" high',
];
const MANIFEST = parsePanelRows(ROWS);
const BRAND = { companyName: "Cedar & Stone Tree Care", vehicle: "2019 Ford Transit 250 High Roof" };

/** A stand-in for what the model returns: one saturated colour, any size. */
async function sheet(width, height, rgb = { r: 20, g: 90, b: 45 }) {
  return sharp({ create: { width, height, channels: 3, background: rgb } }).png().toBuffer();
}

/** The colour at one point of a composited sheet. */
async function pixelAt(bytes, x, y) {
  const { data } = await sharp(bytes).extract({ left: x, top: y, width: 1, height: 1 })
    .raw().toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2] };
}

test("the document lands at the SHEET's resolution, never upscaled from the design canvas", async () => {
  const out = await composeProofChrome({
    proofBytes: await sheet(4096, 2731), manifest: MANIFEST, ...BRAND, sharp,
  });
  assert.equal(out.width, 4096);
  assert.equal(out.height, 2731);
  assert.equal(out.contract, CHROME_CONTRACT);
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.width, 4096, "the composite was resized to the chrome instead of the other way round");
  assert.equal(meta.height, 2731);

  // AND IT REPORTS THE STRETCH RATHER THAN HIDING IT. The chrome is authored at
  // 3:2; a sheet returned at another aspect has the document distorted onto it,
  // and the caller needs to be able to see that in the receipt.
  assert.equal(out.designAspect, Number((WIDTH / HEIGHT).toFixed(3)));
  assert.equal(out.sheetAspect, Number((4096 / 2731).toFixed(3)));
});

test("the ARTWORK survives — every panel cell still holds the design at its centre", async () => {
  const W = 3072, H = 2048;
  const green = { r: 20, g: 90, b: 45 };
  const out = await composeProofChrome({
    proofBytes: await sheet(W, H, green), manifest: MANIFEST, ...BRAND, sharp,
  });
  const layout = containerLayout(MANIFEST);

  for (const [zone, band] of [["zone1", layout.zone1], ["zone2", layout.zone2]]) {
    for (const cell of band) {
      const px = Math.round((cell.x + cell.w / 2) * (W / WIDTH));
      const py = Math.round((cell.y + cell.h / 2) * (H / HEIGHT));
      const got = await pixelAt(out.bytes, px, py);
      assert.deepEqual(got, green,
        `${zone}/${cell.surfaceKey} centre is ${JSON.stringify(got)} — the chrome painted over `
        + "the design. A typeset sheet with no artwork on it is not a proof.");
    }
  }
});

test("the document REGIONS are covered — the model's own metadata cannot show through", async () => {
  const W = 3072, H = 2048;
  const green = { r: 20, g: 90, b: 45 };
  const out = await composeProofChrome({
    proofBytes: await sheet(W, H, green), manifest: MANIFEST, ...BRAND, sharp,
  });

  // The caption strips and the reference/notes/legend block. Compositing code
  // captions over a sheet still carrying the model's produced the doubling
  // measured on 35393135814: "DRIVER SIDEDRIVER SIDE", two sets of dimensions.
  // These bands are document margin in the container and no live sheet has ever
  // drawn a panel into one.
  for (const [label, y] of [["under zone 1", 330], ["under zone 2", 600], ["reference block", 900]]) {
    const px = Math.round(30 * (W / WIDTH));
    const py = Math.round(y * (H / HEIGHT));
    const got = await pixelAt(out.bytes, px, py);
    assert.ok(got.r > 230 && got.g > 230 && got.b > 230,
      `${label} at y=${y} is ${JSON.stringify(got)} — the model's text survives under the code's`);
  }
});

test("chrome mode suppresses the page ground and the panel fills, template mode keeps both", () => {
  const chrome = containerSvg({ manifest: MANIFEST, ...BRAND, mode: "chrome" });
  const template = containerSvg({ manifest: MANIFEST, ...BRAND });

  // A FULL-PAGE WHITE RECT IN CHROME MODE ERASES THE WHOLE DESIGN. It is what
  // the template needs and exactly what the composite must not carry.
  const fullPage = new RegExp(`<rect (x="0" y="0" )?width="(100%|${WIDTH})" height="(100%|${HEIGHT})" fill="#ffffff"/>`);
  assert.ok(fullPage.test(template), "the blank template must have a white ground");
  assert.ok(!fullPage.test(chrome), "chrome mode must not paint a full-page ground");

  // The cell rectangles are outlines only in chrome mode — a white fill there is
  // the same erasure one panel at a time.
  assert.ok(!/fill="#ffffff" stroke="/.test(chrome), "chrome mode must not fill the panel cells");
  assert.ok(/fill="#ffffff" stroke="/.test(template), "the blank template must fill its cells");

  // It also needs a viewBox: the composite scales it to the sheet, and without
  // one the rasteriser renders at the literal 1536 and the type comes out soft.
  assert.match(chrome, new RegExp(`viewBox="0 0 ${WIDTH} ${HEIGHT}"`));
});

/**
 * THE JOB BLOCK MUST TRAVEL THE WHOLE WAY.
 *
 * It used to be asked of the model. Once the model was told to draw no document
 * that instruction became one it is told to ignore, so the four values now reach
 * the sheet only through this compositor — and the first cut of it accepted
 * `job` and never forwarded it to the drawing. The order number was gone from
 * the delivered proof and every test still passed, because nothing asserted the
 * end of the path. Asserting `containerSvg` draws it is not enough; the
 * assertion has to start where the caller hands it over.
 */
test("the job block reaches the SHEET, not just the function that accepts it", async () => {
  const job = { date: "2026-09-18", order: "CS-2019TRANSIT-01", designer: "A.L.", version: "1.0" };
  let drawn = null;
  const spy = (buf, opts) => {
    const s = String(buf);
    if (s.startsWith("<svg") || s.includes("<svg")) drawn = s;
    return sharp(buf, opts);
  };
  await composeProofChrome({
    proofBytes: await sheet(1536, 1024), manifest: MANIFEST, ...BRAND, job, sharp: spy,
  });
  assert.ok(drawn, "the compositor never rasterised an SVG");
  for (const value of Object.values(job)) {
    assert.ok(drawn.includes(value),
      `the compositor accepted job.${Object.keys(job).find((k) => job[k] === value)} `
      + `and did not draw it — the field is silently lost between caller and sheet`);
  }
});

test("an unreadable sheet is refused, never silently composited onto nothing", async () => {
  await assert.rejects(
    () => composeProofChrome({ proofBytes: Buffer.from("not an image"), manifest: MANIFEST, ...BRAND, sharp }),
    (err) => /atlas_proof_chrome_unreadable_sheet|unsupported image format|Input buffer/i.test(err.message),
  );
});

test("the numbers it draws are the manifest's own, on a second vehicle too", () => {
  const other = parsePanelRows([
    'DRIVER: 251.0" wide x 60.0" high', 'PASSENGER: 251.0" wide x 60.0" high',
    'ROOF: 82.0" wide x 68.0" high', 'HOOD: 66.0" wide x 62.0" high',
    'FRONT: 80.0" wide x 34.0" high', 'REAR: 78.0" wide x 44.0" high',
  ]);
  const svg = containerSvg({ manifest: other, ...BRAND, mode: "chrome" });

  // Its own inches, its own computed coverage, and NOT the other vehicle's.
  assert.ok(svg.includes("251.0&quot;"), "the F250 flank inches are missing from the chrome");
  assert.ok(!svg.includes("141.0&quot;"), "the chrome carries a vehicle it was not given");
  // 2*(251*60) + 82*68 + 66*62 + 80*34 + 78*44 over 144.
  const sqft = (2 * 251 * 60 + 82 * 68 + 66 * 62 + 80 * 34 + 78 * 44) / 144;
  assert.ok(svg.includes(`${sqft.toFixed(2)} SQ FT`),
    `coverage must be summed from these six panels, expected ${sqft.toFixed(2)}`);
});
