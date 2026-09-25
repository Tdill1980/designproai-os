/**
 * A PANEL IS A FULL RECTANGLE: the panel.cut guard (owner rule, 2026-09-25).
 *
 * Live generation 9999ec65 (revision 677d34fb): the hood cell came back as a
 * hood-shaped island on white (fit 0.83 in both bands) and the roof cell had a
 * thin white strip on its left edge. Both were stored verbatim and reused as
 * the QC panel, the master zone and the Calls 2-7 conditioning.
 *
 * These assertions pin both repairs AND the designs they must never touch.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const {
  cutProofPanels, guardPanelRectangle, rectGuardPolicy, RECT_GUARD_CONTRACT, RECT_ENFORCED_SURFACES,
} = require_("../runtime/atlas-proof-panels.cjs");
const { parsePanelRows, containerLayout } = require_("../runtime/atlas-proof-container-template.cjs");
const sharp = require_("../runtime/node_modules/sharp");

const W = 400, H = 280;
const png = (svg, w = W, h = H) => sharp(Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`)).png({ compressionLevel: 9 }).toBuffer();
const art = `<defs><linearGradient id="g"><stop stop-color="#0b3d91"/><stop offset="1" stop-color="#e4572e"/></linearGradient></defs>`;

async function pixel(bytes, x, y) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
const isWhite = ([r, g, b]) => r >= 245 && g >= 245 && b >= 245;
async function dims(bytes) { const m = await sharp(bytes).metadata(); return [m.width, m.height]; }
async function whiteColumnShare(bytes, x) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let y = 0; y < info.height; y++) { const i = (y * info.width + x) * info.channels; if (data[i] >= 245 && data[i + 1] >= 245 && data[i + 2] >= 245) n++; }
  return n / info.height;
}

test("only the hood is squared up by default; the policy defaults to repair and has an off switch", () => {
  assert.deepEqual([...RECT_ENFORCED_SURFACES], ["hood"]);
  assert.equal(rectGuardPolicy({}), "repair");
  assert.equal(rectGuardPolicy({ DESIGNPRO_RECT_GUARD_POLICY: "report" }), "report");
  assert.equal(rectGuardPolicy({ DESIGNPRO_RECT_GUARD_POLICY: "OFF" }), "off");
  assert.equal(rectGuardPolicy({ DESIGNPRO_RECT_GUARD_POLICY: "refuse" }), "repair", "no policy may throw into the cut");
});

test("BUG 1: a hood drawn as a silhouette on white is repaired to a full rectangle at the same size", async () => {
  // A hood outline: narrow at the windshield, wide at the grille, white surround.
  const bytes = await png(`${art}<rect width="100%" height="100%" fill="white"/>
    <path d="M 40 10 L 360 10 L 395 270 L 5 270 Z" fill="url(#g)"/>`);
  for (const [x, y] of [[0, 0], [W - 1, 0]]) assert.ok(isWhite(await pixel(bytes, x, y)), "fixture corners are page");
  const island = await png(`${art}<rect width="100%" height="100%" fill="white"/>
    <rect x="12" y="10" width="${W - 24}" height="${H - 20}" rx="60" fill="url(#g)"/>`);
  const islandOut = await guardPanelRectangle(sharp, island, { surfaceKey: "hood", policy: "repair" });
  assert.equal(islandOut.rectGuard.surround.cornersTouched, 4);
  assert.equal(islandOut.rectGuard.changed, true, "a rounded hood island on white is squared up too");
  assert.deepEqual(await dims(islandOut.bytes), [W, H]);
  assert.ok(!isWhite(await pixel(islandOut.bytes, 0, 0)));
  const out = await guardPanelRectangle(sharp, bytes, { surfaceKey: "hood", policy: "repair" });
  assert.equal(out.rectGuard.contract, RECT_GUARD_CONTRACT);
  assert.equal(out.rectGuard.changed, true);
  assert.equal(out.rectGuard.surround.silhouette, true);
  assert.equal(out.rectGuard.surround.repaired, true);
  assert.deepEqual(await dims(out.bytes), [W, H], "the cell keeps its exact geometry");
  for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) {
    assert.ok(!isWhite(await pixel(out.bytes, x, y)), `corner ${x},${y} carries artwork`);
  }
});

test("BUG 2: a thin white strip on a roof edge is trimmed and the cell keeps its size", async () => {
  const bytes = await png(`${art}<rect width="100%" height="100%" fill="white"/>
    <rect x="3" y="0" width="${W - 3}" height="${H}" fill="url(#g)"/>`);
  assert.equal(await whiteColumnShare(bytes, 0), 1);
  const out = await guardPanelRectangle(sharp, bytes, { surfaceKey: "roof", policy: "repair" });
  assert.equal(out.rectGuard.changed, true);
  assert.equal(out.rectGuard.edgeStrips.left, 3);
  assert.equal(out.rectGuard.surround, undefined, "the silhouette pass runs on the hood only");
  assert.deepEqual(await dims(out.bytes), [W, H]);
  assert.ok(await whiteColumnShare(out.bytes, 0) < 0.5, "the first column is artwork now");
});

test("legitimate designs are left byte-for-byte: interior white logo, one white edge band, white sky", async () => {
  const cases = {
    "centred white logo": `${art}<rect width="100%" height="100%" fill="url(#g)"/><circle cx="200" cy="140" r="80" fill="white"/>`,
    "30px white design band on one edge": `${art}<rect width="100%" height="100%" fill="url(#g)"/><rect x="0" y="0" width="30" height="${H}" fill="white"/>`,
    "white sky across the top": `${art}<rect width="100%" height="100%" fill="url(#g)"/><rect x="0" y="0" width="${W}" height="70" fill="white"/>`,
  };
  for (const [name, svg] of Object.entries(cases)) {
    const bytes = await png(svg);
    for (const surfaceKey of ["hood", "roof", "driver"]) {
      const out = await guardPanelRectangle(sharp, bytes, { surfaceKey, policy: "repair" });
      assert.equal(out.bytes, bytes, `${name} on ${surfaceKey} is untouched`);
      assert.equal(out.rectGuard.changed, false, `${name} on ${surfaceKey}`);
    }
  }
});

test("a white-ground hood design and a near-empty hood are reported, never cropped", async () => {
  const whiteGround = await png(`${art}<rect width="100%" height="100%" fill="white"/>
    <text x="60" y="160" font-size="70" fill="#0b3d91">ACME</text><rect x="150" y="190" width="120" height="30" fill="#e4572e"/>`);
  const nearEmpty = await png(`<rect width="100%" height="100%" fill="white"/><rect x="180" y="120" width="30" height="20" fill="#333"/>`);
  for (const bytes of [whiteGround, nearEmpty]) {
    const out = await guardPanelRectangle(sharp, bytes, { surfaceKey: "hood", policy: "repair" });
    assert.equal(out.bytes, bytes);
    assert.equal(out.rectGuard.changed, false);
    assert.equal(out.rectGuard.surround.silhouette, false, "a surround above 35% is a white ground, not a die-cut");
  }
});

test("report measures without changing bytes; off skips the guard entirely; a failure never throws", async () => {
  const bytes = await png(`${art}<rect width="100%" height="100%" fill="white"/><path d="M 40 10 L 360 10 L 395 270 L 5 270 Z" fill="url(#g)"/>`);
  const report = await guardPanelRectangle(sharp, bytes, { surfaceKey: "hood", policy: "report" });
  assert.equal(report.bytes, bytes);
  assert.equal(report.rectGuard.changed, false);
  assert.equal(report.rectGuard.surround.silhouette, true);
  const off = await guardPanelRectangle(sharp, bytes, { surfaceKey: "hood", policy: "off" });
  assert.equal(off.bytes, bytes);
  assert.equal(off.rectGuard, null);
  const junk = Buffer.from("not an image");
  const failed = await guardPanelRectangle(sharp, junk, { surfaceKey: "hood", policy: "repair" });
  assert.equal(failed.bytes, junk);
  assert.equal(failed.rectGuard.changed, false);
  assert.match(failed.rectGuard.error, /./);
});

test("panel.cut: the hood cell drawn as a silhouette comes out rectangular in Zones 1 and 2; Zone 3 is untouched", async () => {
  const manifest = parsePanelRows([
    'DRIVER: 215" wide x 66" high', 'PASSENGER: 215" wide x 66" high',
    'HOOD: 69" wide x 42" high', 'ROOF: 65" wide x 89" high',
    'FRONT: 69" wide x 31.5" high', 'REAR: 69" wide x 50" high',
  ]);
  const layout = containerLayout(manifest);
  const w = 3072, h = 2048, sx = w / layout.width, sy = h / layout.height;
  const cells = ["zone1", "zone2"].flatMap((zone) => layout[zone].map((cell) => {
    const x = cell.x * sx, y = cell.y * sy, cw = cell.w * sx, ch = cell.h * sy;
    if (cell.surfaceKey !== "hood") return `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="url(#g)"/>`;
    const inset = cw * 0.12;
    return `<path d="M ${x + inset} ${y} L ${x + cw - inset} ${y} L ${x + cw} ${y + ch} L ${x} ${y + ch} Z" fill="url(#g)"/>`;
  }));
  const zone3 = layout.zone3.map((cell) => `<rect x="${(cell.x + cell.w * 0.3) * sx}" y="${(cell.y + cell.h * 0.3) * sy}" width="${cell.w * 0.4 * sx}" height="${cell.h * 0.4 * sy}" fill="#111"/>`);
  const proofBytes = await png(`${art}<rect width="100%" height="100%" fill="white"/>${cells.join("")}${zone3.join("")}`, w, h);
  const out = await cutProofPanels({ proofBytes, manifest, sharp, rectPolicy: "repair" });
  assert.equal(out.refused, null);
  for (const zone of ["zone1", "zone2"]) {
    const hood = out.panels.find((p) => p.zone === zone && p.surfaceKey === "hood");
    assert.equal(hood.rectGuard.changed, true, `${zone} hood repaired`);
    assert.deepEqual(await dims(hood.bytes), [hood.rect.width, hood.rect.height]);
    assert.equal(hood.byteSize, hood.bytes.length);
    for (const [x, y] of [[1, 1], [hood.rect.width - 2, 1]]) assert.ok(!isWhite(await pixel(hood.bytes, x, y)), `${zone} hood corner ${x},${y}`);
    assert.ok(hood.fit < 0.97, "fit stays the raw sheet measurement the die-cut gate compares");
  }
  for (const p of out.panels.filter((p) => p.zone === "zone3")) assert.equal(p.rectGuard, undefined);
  const off = await cutProofPanels({ proofBytes, manifest, sharp, rectPolicy: "off" });
  for (const p of off.panels) assert.equal(p.rectGuard, undefined, "off restores the previous panel shape exactly");
});
