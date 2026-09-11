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
/** Fake Topaz: returns exactly the requested output geometry as a resize of the input. */
async function fakeTopaz(_url, init) {
  const form = init.body;
  const input = Buffer.from(await form.get("image").arrayBuffer());
  const out = await sharp(input).resize(Number(form.get("output_width")), Number(form.get("output_height")), { fit: "fill" }).png().toBuffer();
  return new Response(out, { status: 200, headers: { "content-type": "image/png" } });
}

test("plans 59.5-inch panels with the half-inch duplicated overlap exactly like the browser", () => {
  const { panels } = production.planPanels(production.normalizeRequest({ wallWidthIn: 120, wallHeightIn: 96 }));
  assert.deepEqual(panels.map(p => [p.x, p.width, p.height, p.overlapLeft]), [[-1, 59.5, 98, 0], [58, 59.5, 98, .5], [117, 4, 98, .5]]);
  assert.equal(production.DEFAULTS.panelWidthIn, 59.5); assert.equal(production.DEFAULTS.overlapIn, 0.5); assert.equal(production.DEFAULTS.targetPpi, 150);
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
      download: async () => ({ data: new Blob([source.bytes]), error: null }),
      upload: async (path, bytes, options) => { uploads.push({ path, size: bytes.length, contentType: options.contentType }); return { error: null }; },
    }; } },
  };
  const job = { id: jobId, owner_id: owner, project_id: "p", version_id: "v1", request: { wallWidthIn: 30, wallHeightIn: 20, bleedIn: 1, overlapIn: 0.5, panelWidthIn: 12, targetPpi: 72 } };
  const result = await production.processJob(job, { supabase, readiness, fetchImpl: fakeTopaz, apiKey: "k", supabaseUrl: "https://x.supabase.co", serviceRoleKey: "s".repeat(40) });
  assert.equal(result.panels.length, 3);
  assert.deepEqual(uploads.map(u => u.path), [
    `${owner}/production/${jobId}/panel-001-12x22in.png`, `${owner}/production/${jobId}/panel-002-12x22in.png`,
    `${owner}/production/${jobId}/panel-003-9x22in.png`, `${owner}/production/${jobId}/manifest.json`,
  ]);
  const final = updates.at(-1);
  assert.equal(final.status, "ready"); assert.equal(final.progress.panelsDone, 3); assert.equal(final.manifest_path, `${owner}/production/${jobId}/manifest.json`);
  assert.equal(result.manifest.contract, production.CONTRACT); assert.equal(result.manifest.panels[2].widthPx, 648);
  assert.ok(updates.some(u => u.progress?.panelsDone === 1 && u.status === undefined), "progress is reported per panel");
});
