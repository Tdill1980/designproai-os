import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const production = require("../../runtime/wallpro-production.cjs");

const readiness = { configurationValid: true, enabled: true, available: true, model: "High Fidelity V2", detail: "test" };
// A 300x200 master: red→blue across, with a green ramp down, so any crop, flip or mirror is measurable.
async function master() {
  const raw = Buffer.alloc(300 * 200 * 3);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) { const i = (y * 300 + x) * 3; raw[i] = Math.round(x / 299 * 255); raw[i + 1] = Math.round(y / 199 * 255); raw[i + 2] = 255 - raw[i]; }
  const bytes = await sharp(raw, { raw: { width: 300, height: 200, channels: 3 } }).png().toBuffer();
  return { bytes, width: 300, height: 200 };
}
const request = (over = {}) => production.normalizeRequest({ wallWidthIn: 30, wallHeightIn: 20, placement: "cover", bleedIn: 1, overlapIn: 0.5, panelWidthIn: 12, targetPpi: 72, ...over });
/** One short tag out of a TIFF's first IFD, so "LZW" is read, not assumed. */
function tiffTag(buffer, wanted) {
  const little = buffer.toString("latin1", 0, 2) === "II";
  const u16 = (at) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
  const u32 = (at) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
  const ifd = u32(4);
  for (let i = 0; i < u16(ifd); i++) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) === wanted) return u16(entry + 8);
  }
  return null;
}

/** Fake Topaz: returns exactly the requested output geometry as a resize of the input. */
async function fakeTopaz(_url, init) {
  const form = init.body;
  const input = Buffer.from(await form.get("image").arrayBuffer());
  const out = await sharp(input).resize(Number(form.get("output_width")), Number(form.get("output_height")), { fit: "fill" }).png().toBuffer();
  return new Response(out, { status: 200, headers: { "content-type": "image/png" } });
}

test("plans 54-inch panels with the half-inch duplicated overlap exactly like the browser", () => {
  const { panels } = production.planPanels(production.normalizeRequest({ wallWidthIn: 120, wallHeightIn: 96 }));
  assert.deepEqual(panels.map(p => [p.x, p.width, p.height, p.overlapLeft]), [[-1, 54, 98, 0], [52.5, 54, 98, .5], [106, 15, 98, .5]]);
  assert.equal(production.DEFAULTS.panelWidthIn, 54); assert.equal(production.DEFAULTS.overlapIn, 0.5); assert.equal(production.DEFAULTS.targetPpi, 150);
  // THE TWO 54s ARE ONE NUMBER AND MUST STAY EQUAL.
  //
  // The browser plans panels with WALLPRO_PRINT_WIDTH and the runtime cuts them
  // with DEFAULTS.panelWidthIn. They were BOTH 59 until 2026-09-12, which is
  // wider than the Avery HP MPI 2610 roll -- those panels could not be printed
  // at all. The geometry file's own comment invites lowering this one constant
  // if the press needs an edge margin, which is exactly the change that would
  // silently split the two halves apart: the customer would be quoted and shown
  // one panel plan and the press handed another.
  const geometry = readFileSync(new URL('../../app/src/lib/wallpro-geometry.ts', import.meta.url), 'utf8');
  const clientWidth = Number(/export const WALLPRO_PRINT_WIDTH = (\d+(?:\.\d+)?)/.exec(geometry)?.[1]);
  assert.ok(Number.isFinite(clientWidth), 'WALLPRO_PRINT_WIDTH could not be read from wallpro-geometry.ts');
  assert.equal(clientWidth, production.DEFAULTS.panelWidthIn,
    'WALLPRO_PRINT_WIDTH and the runtime panel width have drifted apart: the browser would plan panels the press cannot cut.');
  assert.throws(() => production.normalizeRequest({ wallWidthIn: 0, wallHeightIn: 96 }), /1 to 2,400/);
});

test("rasterises a cover panel at exact pixels and mirrors the wall edge into the bleed", async () => {
  const source = await master();
  const req = request();
  const { panels } = production.planPanels(req);
  assert.equal(production.sourcePpi(source, req), 10);
  const first = await production.rasterPanel(source, req, panels[0], 10);
  assert.equal(first.width, 120); assert.equal(first.height, 220);
  const raw = await sharp(first.bytes).raw().toBuffer();
  const px = (x, y) => Array.from(raw.subarray((y * 120 + x) * 3, (y * 120 + x) * 3 + 3));
  // Column 9 is the last bleed column: a mirror of column 10, the wall's first column.
  assert.deepEqual(px(9, 100), px(10, 100));
  assert.deepEqual(px(0, 100), px(19, 100));
  // Row 9 is the last top-bleed row: a mirror of row 10.
  assert.deepEqual(px(60, 9), px(60, 10));
  // The wall face itself is the master: left edge is red-ish, and the panel's
  // right edge (11 inches in) is a third of the way to blue.
  assert.ok(px(10, 100)[0] < 8 && px(10, 100)[2] > 247);
  assert.ok(Math.abs(px(119, 100)[0] - 93) < 6);
  // The last panel carries the right bleed and only that.
  const last = await production.rasterPanel(source, req, panels.at(-1), 10);
  assert.equal(last.width, Math.round(panels.at(-1).width * 10));
});

test("continues a repeat through the bleed and flips odd tiles for a mirror repeat", async () => {
  const source = await master();
  const req = request({ placement: "repeat", repeatWidthIn: 6, mirror: true });
  const { panels } = production.planPanels(req);
  const panel = await production.rasterPanel(source, req, panels[0], 10);
  assert.equal(panel.width, 120); assert.equal(panel.height, 220);
  const raw = await sharp(panel.bytes).raw().toBuffer();
  const px = (x, y) => Array.from(raw.subarray((y * 120 + x) * 3, (y * 120 + x) * 3 + 3));
  // Tile 0 spans wall inches 0..6 → panel px 10..70; tile 1 (flipped) 70..130.
  // At the join, the flipped tile places its own last column against tile 0's.
  assert.deepEqual(px(69, 60), px(70, 60));
  // Bleed (px 0..10) is tile -1, flipped: its pixel next to tile 0 equals tile 0's first column.
  assert.deepEqual(px(9, 60), px(10, 60));
});

test("centres a tile larger than the wall, exactly as the browser does for a mural scaled past 100%", async () => {
  const source = await master();
  // A 60-inch tile of the 3:2 master on the 30 x 20 wall: twice the wall in
  // both axes, so the wall shows the master's middle half (x 25%..75%).
  const req = request({ placement: "repeat", repeatWidthIn: 60 });
  assert.deepEqual([production.layoutMetrics(req, 1.5).originX, production.layoutMetrics(req, 1.5).originY], [-15, -10]);
  const { panels } = production.planPanels(req);
  const panel = await production.rasterPanel(source, req, panels[0], 10);
  const raw = await sharp(panel.bytes).raw().toBuffer();
  const px = (x, y) => Array.from(raw.subarray((y * 120 + x) * 3, (y * 120 + x) * 3 + 3));
  // Wall inch 0 (panel px 10) is the master's x = 25%: red channel about 64, not 0.
  assert.ok(Math.abs(px(10, 100)[0] - 64) < 6, `left wall edge red=${px(10, 100)[0]}`);
  // Wall top (panel px 10 down) is the master's y = 25%: green about 64.
  assert.ok(Math.abs(px(60, 10)[1] - 64) < 6, `top wall edge green=${px(60, 10)[1]}`);
  // A tile smaller than the wall still starts at the wall's corner.
  assert.equal(production.layoutMetrics(request({ placement: "repeat", repeatWidthIn: 6 }), 1.5).originX, 0);
});

test("produces a 150-class panel through Topaz when the source is below target, exact resize when it is not", async () => {
  const source = await master();
  const req = request({ targetPpi: 72 });
  const { panels } = production.planPanels(req);
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, width: init.body.get("output_width"), height: init.body.get("output_height") }); return fakeTopaz(url, init); };
  const produced = await production.producePanel({ source, request: req, panel: panels[0], readiness, fetchImpl, apiKey: "k" });
  assert.equal(produced.widthPx, 864); assert.equal(produced.heightPx, 1584);
  // 10 → 72 PPI is 7.2x; Topaz is asked for its documented 6x ceiling (720 px)
  // and the remaining distance is the recorded Lanczos landing, as in Call 12.
  assert.equal(calls.length, 1); assert.equal(Number(calls[0].width), 720);
  assert.equal(produced.upscale.plan.clampedByEngineCeiling, true);
  const meta = await sharp(produced.bytes).metadata();
  assert.equal(meta.width, 864); assert.equal(meta.height, 1584); assert.equal(meta.density, 72);
  assert.equal(produced.upscale.engine, "topaz-image-enhance");
  // Source already at target: no Topaz call, exact pixels.
  // A 3 x 2 inch wall makes the same master 100 PPI native: above target, so no Topaz call and exact pixels.
  const small = request({ wallWidthIn: 3, wallHeightIn: 2, targetPpi: 72 });
  const direct = await production.producePanel({ source, request: small, panel: production.planPanels(small).panels[0], readiness, fetchImpl: async () => { throw new Error("must not call Topaz"); }, apiKey: "k" });
  assert.equal(direct.upscale.engine, "none"); assert.equal(direct.widthPx, 360); assert.equal(direct.heightPx, 288);
});

test("fails closed when Topaz is not configured instead of shipping a soft panel", async () => {
  const source = await master();
  const req = request({ targetPpi: 72 });
  const { panels } = production.planPanels(req);
  await assert.rejects(production.producePanel({ source, request: req, panel: panels[0], readiness: { ...readiness, available: false, detail: "TOPAZ_API_KEY is required" }, fetchImpl: fakeTopaz, apiKey: "" }), /Call 12 cannot run/);
});

test("processJob builds every panel, stores them under the owner's production namespace and marks the job ready", async () => {
  const source = await master();
  const owner = "a0101010-1010-4010-8010-101010101010", jobId = "b0202020-2020-4020-8020-202020202020";
  const uploads = [], updates = [];
  const supabase = {
    from(table) {
      return {
        select() { return { eq() { return { single: async () => table === "wallpro_design_versions" ? { data: { id: "v1", status: "approved", artwork_path: `${owner}/generated/m.png`, placement: "cover", repeat_width_in: null }, error: null } : { data: null, error: { message: "no" } } }; } }; },
        update(patch) { return { eq: async () => { updates.push(patch); return { error: null }; } }; },
      };
    },
    storage: { from(bucket) { assert.equal(bucket, "wallpro-files"); return {
      // The master by its path; a stored panel by its own path, for stitching.
      download: async (path) => ({ data: new Blob([stored.get(path) || source.bytes]), error: null }),
      upload: async (path, bytes, options) => { uploads.push({ path, size: bytes.length, contentType: options.contentType }); stored.set(path, bytes); return { error: null }; },
    }; } },
  };
  const stored = new Map();
  const job = { id: jobId, owner_id: owner, project_id: "p", version_id: "v1", request: { wallWidthIn: 30, wallHeightIn: 20, bleedIn: 1, overlapIn: 0.5, panelWidthIn: 12, targetPpi: 72 } };
  // The three panels are independent graph nodes: their Topaz calls must overlap.
  let inFlight = 0, peak = 0;
  const overlappingTopaz = async (url, init) => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, 40));
    try { return await fakeTopaz(url, init); } finally { inFlight -= 1; }
  };
  const result = await production.processJob(job, { supabase, readiness, fetchImpl: overlappingTopaz, apiKey: "k", supabaseUrl: "https://x.supabase.co", serviceRoleKey: "s".repeat(40) });
  assert.equal(result.panels.length, 3);
  assert.ok(peak >= 2, `panels built in parallel (peak ${peak})`);
  assert.deepEqual(result.panels.map(p => p.number), [1, 2, 3]);
  // Every panel lands three ways from the same pixels: the RIP's TIFF, a
  // flattened PDF, and the PNG the UI previews.
  assert.deepEqual(uploads.map(u => u.path).sort(), [
    `${owner}/production/${jobId}/manifest.json`,
    `${owner}/production/${jobId}/panel-001-12x22in.pdf`, `${owner}/production/${jobId}/panel-001-12x22in.png`, `${owner}/production/${jobId}/panel-001-12x22in.tif`,
    `${owner}/production/${jobId}/panel-002-12x22in.pdf`, `${owner}/production/${jobId}/panel-002-12x22in.png`, `${owner}/production/${jobId}/panel-002-12x22in.tif`,
    `${owner}/production/${jobId}/panel-003-9x22in.pdf`, `${owner}/production/${jobId}/panel-003-9x22in.png`, `${owner}/production/${jobId}/panel-003-9x22in.tif`,
    `${owner}/production/${jobId}/wall-32x22in.png`,
  ]);
  assert.deepEqual(result.panels[0].files.map(f => f.format), ["png", "tiff", "pdf"]);
  assert.ok(result.panels.every(p => p.files.every(f => f.path && f.byteSize > 0 && !f.error)), "every print format stored");
  assert.equal(uploads.filter(u => u.contentType === "image/tiff").length, 3);
  assert.equal(uploads.filter(u => u.contentType === "application/pdf").length, 3);
  assert.equal(uploads.at(-1).path, `${owner}/production/${jobId}/manifest.json`, "the manifest waits for every panel and the whole wall");
  const final = updates.at(-1);
  assert.equal(final.status, "ready"); assert.equal(final.progress.panelsDone, 3); assert.equal(final.manifest_path, `${owner}/production/${jobId}/manifest.json`);
  assert.equal(result.manifest.contract, production.CONTRACT); assert.equal(result.manifest.panels[2].widthPx, 648);
  assert.ok(updates.some(u => u.progress?.panelsDone === 1 && u.status === undefined), "progress is reported per panel");
  // The whole wall is one file at the same PPI: wall plus bleed, 32 x 22 in at
  // 72 PPI, stitched from the panels' own pixels so the overlap strip is exact.
  assert.equal(result.wholeWall.file, "wall-32x22in.png"); assert.equal(final.progress.wholeWall.path, `${owner}/production/${jobId}/wall-32x22in.png`);
  const wall = await sharp(stored.get(result.wholeWall.path)).raw().toBuffer({ resolveWithObject: true });
  assert.equal(wall.info.width, 2304); assert.equal(wall.info.height, 1584); assert.equal((await sharp(stored.get(result.wholeWall.path)).metadata()).density, 72);
  const panel2 = await sharp(stored.get(result.panels[1].path)).raw().toBuffer({ resolveWithObject: true });
  const left2 = Math.round((result.panels[1].xIn + 1) * 72);
  // Points inside panel 2 but outside panel 3's overlap strip (36 px): the strip
  // is written last by panel 3, whose own enhancement may differ by a level.
  for (const [x, y] of [[0, 700], [300, 100], [panel2.info.width - 40, 1500]]) {
    const w = (y * wall.info.width + left2 + x) * 3, p = (y * panel2.info.width + x) * 3;
    assert.deepEqual(Array.from(wall.data.subarray(w, w + 3)), Array.from(panel2.data.subarray(p, p + 3)), `wall pixel at panel 2 (${x},${y})`);
  }
});

test("the whole-wall file fails soft: a wall beyond the one-file budget still leaves the job ready with its panels", async () => {
  const request = { wallWidthIn: 30, wallHeightIn: 20, bleedIn: 1, overlapIn: 0.5, panelWidthIn: 12, targetPpi: 72 };
  const { bounds, panels } = production.planPanels(production.normalizeRequest(request));
  await assert.rejects(production.stitchWholeWall({ request: { ...request, targetPpi: 5000 }, bounds, panels: [], panelBytes: () => null }), /one-file budget/);
  assert.equal(production.normalizeRequest({ ...request, wholeWall: false }).wholeWall, false);
  assert.equal(production.normalizeRequest(request).wholeWall, true);
  assert.equal(panels.length, 3);
});

test("writes every panel as a lossless TIFF and a flattened PDF beside the PNG", async () => {
  const source = await master();
  const req = request({ targetPpi: 72 });
  const { panels } = production.planPanels(req);
  const produced = await production.producePanel({ source, request: req, panel: panels[0], readiness, fetchImpl: fakeTopaz, apiKey: "k" });

  // TIFF: same pixels, lossless, and it opens at its true printed size.
  const tiff = await production.panelTiff(produced.bytes, req.targetPpi);
  const meta = await sharp(tiff).metadata();
  assert.equal(meta.format, "tiff");
  assert.equal(meta.width, produced.widthPx); assert.equal(meta.height, produced.heightPx);
  assert.equal(meta.density, req.targetPpi);
  // Compression tag (259) read straight out of the first IFD: 5 is LZW.
  assert.equal(tiffTag(tiff, 259), 5);
  // Lossless means pixel-for-pixel, not "looks the same".
  const fromPng = await sharp(produced.bytes).removeAlpha().raw().toBuffer();
  const fromTiff = await sharp(tiff).removeAlpha().raw().toBuffer();
  assert.ok(fromPng.equals(fromTiff), "TIFF pixels differ from the PNG");

  // PDF: one page at the panel's exact printed size in points, one image, no
  // fonts, no transparency — and a valid cross-reference table.
  const pdf = await production.panelPdf(produced.bytes, produced.widthPx, produced.heightPx, panels[0].width, panels[0].height);
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.7"), "not a PDF");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "PDF not terminated");
  assert.match(text, new RegExp(`/MediaBox\\[0 0 ${panels[0].width * 72} ${panels[0].height * 72}\\]`));
  assert.match(text, new RegExp(`/Width ${produced.widthPx}/Height ${produced.heightPx}`));
  assert.match(text, /\/ColorSpace\/DeviceRGB\/BitsPerComponent 8\/Filter\/FlateDecode/);
  assert.ok(!text.includes("/Font"), "a flattened print PDF carries no fonts");
  // The xref offsets must actually point at their objects, or a RIP rejects it.
  const startxref = Number(text.slice(text.lastIndexOf("startxref") + 9).trim().split("\n")[0]);
  // "xref", the "0 N" header and the free entry come first; then one row per object.
  const rows = text.slice(startxref).split("\n").slice(3, 8);
  rows.forEach((row, index) => {
    const at = Number(row.slice(0, 10));
    assert.ok(text.startsWith(`${index + 1} 0 obj`, at), `object ${index + 1} is not at its xref offset ${at}`);
  });
  // The image stream inflates back to the panel's own pixels.
  const zlib = await import("node:zlib");
  const start = pdf.indexOf(Buffer.from("stream\n", "latin1"), pdf.indexOf(Buffer.from("/Filter/FlateDecode", "latin1"))) + 7;
  const inflated = zlib.inflateSync(pdf.subarray(start, start + Number(text.match(/\/Length (\d+)>>\nstream/)[1])));
  assert.ok(inflated.equals(fromPng), "PDF image stream differs from the panel pixels");

  // And the formats the job actually writes are exactly these two beside the PNG.
  assert.deepEqual(production.PRINT_FORMATS.map(f => [f.name, f.extension, f.contentType]),
    [["tiff", "tif", "image/tiff"], ["pdf", "pdf", "application/pdf"]]);
});
