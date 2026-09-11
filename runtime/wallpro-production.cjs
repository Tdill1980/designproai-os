"use strict";

/**
 * WallPro production panels — 150 PPI print files, built per panel on the
 * server runtime (owner directive, 2026-09-11: "make it 150 and auto run topaz").
 *
 * Why per panel: a 4K master over a 142-inch wall is ~29 PPI, and Topaz caps a
 * single request near 96 MP, so a whole-wall 150 PPI master (300+ MP) is not
 * one request. Each 59-inch print panel (the roll width) IS within reach: rasterise the panel
 * from the approved master at its native density, enhance through Topaz to the
 * engine ceiling (the same `enhancePanel` Call 12 uses for vehicle panels,
 * failing closed when Topaz is unavailable), land exactly on panel inches x
 * target PPI, stamp the PNG density, and store it under the owner's private
 * namespace. Geometry (panel plan, placement metrics, perimeter bleed mirror,
 * repeat tiling) mirrors app/src/lib/wallpro-print-plan.ts and
 * wallpro-print-export.ts so the server files match the browser proofs.
 */

const sharp = require("sharp");
const { createHash } = require("node:crypto");
const { Readable } = require("node:stream");
const tus = require("tus-js-client");
const { enhancePanel, topazReadiness } = require("./topaz-upscale.cjs");
const { directTusEndpoint, TUS_CHUNK_BYTES, MAX_STANDARD_UPLOAD_BYTES } = require("./zip-spool.cjs");

const BUCKET = "wallpro-files";
const CONTRACT = "wallpro.production-panels.v1";
const DEFAULTS = Object.freeze({ bleedIn: 1, overlapIn: 0.5, panelWidthIn: 59, targetPpi: 150 });
const MAX_TILE_PLACEMENTS = 20000;
// Panels build in parallel. Three 130 MP panels in flight is ~1.5 GB of raw
// pixels plus Topaz round-trips; the env can widen or narrow it per droplet.
const PANEL_CONCURRENCY = Math.max(1, Number(process.env.DESIGNPRO_WALLPRO_PANEL_CONCURRENCY) || 3);
const WHITE = { r: 255, g: 255, b: 255 };

class WallProProductionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new WallProProductionError(code, message); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clean = (n) => Number(n.toFixed(6));
const fmt = (n) => Number(n.toFixed(3)).toString();
const num = (value, fallback) => { const n = value === undefined || value === null || value === "" ? fallback : Number(value); return Number.isFinite(n) ? n : NaN; };

/** Validates the job request against the same ranges the browser enforces. */
function normalizeRequest(raw = {}, version = {}) {
  const request = {
    wallWidthIn: num(raw.wallWidthIn), wallHeightIn: num(raw.wallHeightIn),
    placement: raw.placement || version.placement || "cover",
    repeatWidthIn: num(raw.repeatWidthIn, version.repeat_width_in ?? 24),
    mirror: raw.mirror === true,
    bleedIn: num(raw.bleedIn, DEFAULTS.bleedIn), overlapIn: num(raw.overlapIn, DEFAULTS.overlapIn),
    panelWidthIn: num(raw.panelWidthIn, DEFAULTS.panelWidthIn), targetPpi: num(raw.targetPpi, DEFAULTS.targetPpi),
    // One whole-wall file beside the panels, for a RIP that tiles itself
    // (Brice, 2026-09-11: "one big panel"). Stitched from the enhanced panels,
    // so it is the same pixels the panels carry, never a second enhancement.
    wholeWall: raw.wholeWall !== false,
  };
  const inRange = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  if (!inRange(request.wallWidthIn, 1, 2400) || !inRange(request.wallHeightIn, 1, 2400)) fail("wallpro_request_invalid", "Wall dimensions must be 1 to 2,400 inches");
  if (!["cover", "contain", "repeat"].includes(request.placement)) fail("wallpro_request_invalid", "Unknown placement");
  if (request.placement === "repeat" && !inRange(request.repeatWidthIn, 1, 2400)) fail("wallpro_request_invalid", "Repeat width must be 1 to 2,400 inches");
  if (!inRange(request.bleedIn, 0, 5) || !inRange(request.overlapIn, 0, 5)) fail("wallpro_request_invalid", "Bleed and overlap must be 0 to 5 inches");
  if (!inRange(request.panelWidthIn, 1, 2400) || !inRange(request.targetPpi, 72, 600)) fail("wallpro_request_invalid", "Panel width or target PPI out of range");
  return request;
}

/** Port of planWallPrint: perimeter bleed only, seams duplicate real artwork. */
function planPanels(request) {
  const { wallWidthIn: width, wallHeightIn: height, bleedIn: bleed, overlapIn: overlap, panelWidthIn } = request;
  const bounds = { x: -bleed, y: -bleed, width: clean(width + 2 * bleed), height: clean(height + 2 * bleed) };
  const end = width + bleed;
  const panels = [];
  for (let start = -bleed; start < end - 1e-7;) {
    const right = Math.min(start + panelWidthIn, end);
    panels.push({ number: panels.length + 1, x: clean(start), y: -bleed, width: clean(right - start), height: bounds.height, overlapLeft: panels.length ? overlap : 0 });
    if (right >= end - 1e-7) break;
    start = clean(right - overlap);
  }
  return { bounds, panels };
}

/** Port of layoutMetrics: artwork inches on the wall for each placement. */
function layoutMetrics(request, aspect) {
  const { wallWidthIn: width, wallHeightIn: height } = request;
  if (request.placement === "repeat") {
    const repeatHeight = request.repeatWidthIn / aspect;
    if (width / request.repeatWidthIn > 1000 || height / repeatHeight > 1000) fail("wallpro_request_invalid", "The repeat is too small for this wall");
    return { artworkWidth: request.repeatWidthIn, artworkHeight: repeatHeight, across: width / request.repeatWidthIn, down: height / repeatHeight };
  }
  const scale = (request.placement === "cover" ? Math.max : Math.min)(width / aspect, height);
  return { artworkWidth: aspect * scale, artworkHeight: scale, across: 1, down: 1 };
}

/** The master's density at the placement it is printed at. */
function sourcePpi(source, request) {
  const m = layoutMetrics(request, source.width / source.height);
  return source.width / m.artworkWidth;
}

/**
 * Rasterises one panel at `ppi` from the source master: cover/contain place the
 * fitted artwork on a white wall face and mirror the wall perimeter into the
 * bleed; repeat continues the tile grid through the bleed. Returns an RGB PNG
 * of exactly round(width x ppi) by round(height x ppi).
 */
async function rasterPanel(source, request, panel, ppi) {
  const Wpx = Math.max(1, Math.round(panel.width * ppi)), Hpx = Math.max(1, Math.round(panel.height * ppi));
  const image = sharp(source.bytes, { limitInputPixels: false });
  const m = layoutMetrics(request, source.width / source.height);
  let composed;
  if (request.placement === "repeat") {
    const tw = Math.max(1, Math.round(m.artworkWidth * ppi)), th = Math.max(1, Math.round(m.artworkHeight * ppi));
    const base = await image.clone().resize(tw, th, { fit: "fill", kernel: "lanczos3" }).flatten({ background: WHITE }).removeAlpha().raw().toBuffer();
    const variants = new Map();
    const tile = async (flipX, flipY) => {
      const key = `${flipX}${flipY}`;
      if (!variants.has(key)) {
        let v = sharp(base, { raw: { width: tw, height: th, channels: 3 }, limitInputPixels: false });
        if (flipX) v = v.flop();
        if (flipY) v = v.flip();
        variants.set(key, await v.raw().toBuffer());
      }
      return variants.get(key);
    };
    const overlays = [];
    for (let row = Math.floor(panel.y / m.artworkHeight); row * m.artworkHeight < panel.y + panel.height - 1e-8; row++) {
      for (let col = Math.floor(panel.x / m.artworkWidth); col * m.artworkWidth < panel.x + panel.width - 1e-8; col++) {
        if (overlays.length > MAX_TILE_PLACEMENTS) fail("wallpro_request_invalid", "This wall needs more than 20,000 pattern placements");
        const left = Math.round((col * m.artworkWidth - panel.x) * ppi), top = Math.round((row * m.artworkHeight - panel.y) * ppi);
        const sx = Math.max(0, -left), sy = Math.max(0, -top);
        const sw = Math.min(tw - sx, Wpx - Math.max(left, 0)), sh = Math.min(th - sy, Hpx - Math.max(top, 0));
        if (sw <= 0 || sh <= 0) continue;
        const flipX = request.mirror && ((col % 2) + 2) % 2 === 1, flipY = request.mirror && ((row % 2) + 2) % 2 === 1;
        const bytes = await tile(flipX, flipY);
        const piece = await sharp(bytes, { raw: { width: tw, height: th, channels: 3 }, limitInputPixels: false }).extract({ left: sx, top: sy, width: sw, height: sh }).png({ compressionLevel: 0 }).toBuffer();
        overlays.push({ input: piece, left: Math.max(left, 0), top: Math.max(top, 0) });
      }
    }
    composed = sharp({ create: { width: Wpx, height: Hpx, channels: 3, background: WHITE }, limitInputPixels: false }).composite(overlays);
  } else {
    // Wall-face rectangle this panel covers (inches, wall coordinates).
    const R = { x0: Math.max(panel.x, 0), x1: Math.min(panel.x + panel.width, request.wallWidthIn), y0: 0, y1: request.wallHeightIn };
    const A = { x0: (request.wallWidthIn - m.artworkWidth) / 2, y0: (request.wallHeightIn - m.artworkHeight) / 2 };
    const I = { x0: Math.max(R.x0, A.x0), x1: Math.min(R.x1, A.x0 + m.artworkWidth), y0: Math.max(R.y0, A.y0), y1: Math.min(R.y1, A.y0 + m.artworkHeight) };
    const Rw = Math.max(1, Math.round((R.x1 - R.x0) * ppi)), Rh = Math.max(1, Math.round((R.y1 - R.y0) * ppi));
    let face = sharp({ create: { width: Rw, height: Rh, channels: 3, background: WHITE }, limitInputPixels: false });
    if (I.x1 - I.x0 > 1e-9 && I.y1 - I.y0 > 1e-9) {
      const sx = Math.floor((I.x0 - A.x0) / m.artworkWidth * source.width), sy = Math.floor((I.y0 - A.y0) / m.artworkHeight * source.height);
      const sw = Math.max(1, Math.min(source.width - sx, Math.ceil((I.x1 - I.x0) / m.artworkWidth * source.width)));
      const sh = Math.max(1, Math.min(source.height - sy, Math.ceil((I.y1 - I.y0) / m.artworkHeight * source.height)));
      const left = Math.min(Rw - 1, Math.round((I.x0 - R.x0) * ppi)), top = Math.min(Rh - 1, Math.round((I.y0 - R.y0) * ppi));
      const iw = Math.max(1, Math.min(Rw - left, Math.round((I.x1 - I.x0) * ppi))), ih = Math.max(1, Math.min(Rh - top, Math.round((I.y1 - I.y0) * ppi)));
      const piece = await image.clone().extract({ left: sx, top: sy, width: sw, height: sh }).resize(iw, ih, { fit: "fill", kernel: "lanczos3" }).flatten({ background: WHITE }).removeAlpha().png({ compressionLevel: 0 }).toBuffer();
      face = face.composite([{ input: piece, left, top }]);
    }
    // Mirror the accepted wall edges into the perimeter bleed, exactly as the
    // browser export does; only the outer panels carry left/right bleed.
    const extend = {
      left: panel.x < 0 ? Math.round(-panel.x * ppi) : 0,
      right: panel.x + panel.width > request.wallWidthIn ? Math.round((panel.x + panel.width - request.wallWidthIn) * ppi) : 0,
      top: Math.round(-panel.y * ppi), bottom: Math.round((panel.y + panel.height - request.wallHeightIn) * ppi),
    };
    const faceBytes = await face.png({ compressionLevel: 0 }).toBuffer();
    composed = sharp(faceBytes, { limitInputPixels: false });
    if (extend.left || extend.right || extend.top || extend.bottom) composed = composed.extend({ ...extend, extendWith: "mirror" });
  }
  // Rounding along the way can leave the raster a pixel off; land on the exact
  // panel geometry before any enhancement so the receipt is exact.
  // Composite promotes to RGBA; a print panel is opaque RGB, so the alpha that
  // compositing added is dropped here, before any enhancement or upload.
  const bytes = await composed.flatten({ background: WHITE }).removeAlpha().png({ compressionLevel: 0 }).toBuffer();
  const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  if (meta.width === Wpx && meta.height === Hpx) return { bytes, width: Wpx, height: Hpx };
  const fixed = await sharp(bytes, { limitInputPixels: false }).resize(Wpx, Hpx, { fit: "fill", kernel: "lanczos3" }).removeAlpha().png({ compressionLevel: 0 }).toBuffer();
  return { bytes: fixed, width: Wpx, height: Hpx };
}

/** One panel at target PPI: Topaz when the source is below it, exact resize otherwise. */
async function producePanel({ source, request, panel, readiness, fetchImpl, apiKey, signal }) {
  const native = sourcePpi(source, request);
  const targetWidthPx = Math.max(1, Math.round(panel.width * request.targetPpi)), targetHeightPx = Math.max(1, Math.round(panel.height * request.targetPpi));
  const working = Math.min(native, request.targetPpi);
  const raster = await rasterPanel(source, request, panel, working);
  let bytes, upscale;
  if (native + 1e-9 >= request.targetPpi) {
    bytes = await sharp(raster.bytes, { limitInputPixels: false }).resize(targetWidthPx, targetHeightPx, { fit: "fill", kernel: "lanczos3" }).withMetadata({ density: request.targetPpi }).png({ compressionLevel: 6 }).toBuffer();
    upscale = { engine: "none", reason: "source density already meets the target", nativePpi: clean(native) };
  } else {
    const enhanced = await enhancePanel({ bytes: raster.bytes, mimeType: "image/png", surfaceKey: `panel-${panel.number}`, targetWidthPx, targetHeightPx, readiness, fetchImpl, apiKey, signal });
    bytes = await sharp(enhanced.bytes, { limitInputPixels: false }).withMetadata({ density: request.targetPpi }).png({ compressionLevel: 6 }).toBuffer();
    upscale = { engine: enhanced.engine, model: enhanced.model, contract: enhanced.contract, nativePpi: clean(native), enhancedWidthPx: enhanced.enhancedWidthPx, enhancedHeightPx: enhanced.enhancedHeightPx, plan: enhanced.plan };
  }
  return { bytes, widthPx: targetWidthPx, heightPx: targetHeightPx, upscale, rasterPpi: clean(working) };
}

/** Immutable write into the owner's production namespace: a path that already
 * exists must hold these exact bytes, never different ones. */
async function standardUpload(storage, storagePath, bytes, contentType) {
  if (!/^[0-9a-f-]{36}\/production\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(storagePath)) fail("wallpro_storage_path_invalid", `${storagePath} is outside the owner's production namespace`);
  const client = storage.from(BUCKET);
  const contentHash = sha256(bytes);
  const { error } = await client.upload(storagePath, bytes, { contentType, upsert: false });
  if (error) {
    const duplicate = Number(error.statusCode || error.status) === 409 || /already exists|duplicate/i.test(String(error.message || ""));
    if (!duplicate) throw new Error(`Storage create failed: ${error.message}`);
    const { data, error: downloadError } = await client.download(storagePath);
    if (downloadError || !data) throw new Error(`Storage idempotency read failed: ${downloadError?.message || "empty object"}`);
    const existing = Buffer.from(await data.arrayBuffer());
    if (existing.length !== bytes.length || sha256(existing) !== contentHash) fail("wallpro_storage_path_drift", `${storagePath} already exists with different bytes`);
  }
  return Object.freeze({ storagePath, byteSize: bytes.length, contentHash, idempotent: Boolean(error) });
}

async function uploadBytes({ supabase, supabaseUrl, serviceRoleKey, tusEndpoint }, storagePath, bytes, contentType) {
  if (bytes.length <= MAX_STANDARD_UPLOAD_BYTES) return standardUpload(supabase.storage, storagePath, bytes, contentType);
  // Large panels go up the resumable way. The standard endpoint is tried first
  // because it succeeds on this project for files far above 6 MB; a refusal
  // falls through to TUS rather than failing the panel.
  try { return await standardUpload(supabase.storage, storagePath, bytes, contentType); }
  catch (error) { if (error instanceof WallProProductionError) throw error; console.warn(`[WALLPRO] standard upload refused ${storagePath} (${error.message}); using resumable upload`); }
  const upload = new tus.Upload(Readable.from([bytes]), {
    endpoint: directTusEndpoint(supabaseUrl, tusEndpoint), uploadSize: bytes.length, chunkSize: TUS_CHUNK_BYTES,
    retryDelays: [0, 1000, 3000, 5000, 10000], headers: { Authorization: `Bearer ${serviceRoleKey}`, "x-upsert": "false" },
    metadata: { bucketName: BUCKET, objectName: storagePath, contentType, cacheControl: "3600" }, storeFingerprintForResuming: false,
  });
  await new Promise((resolve, reject) => { upload.options.onError = reject; upload.options.onSuccess = resolve; upload.start(); });
  return Object.freeze({ storagePath, byteSize: bytes.length, contentHash: sha256(bytes), idempotent: false });
}

async function processJob(job, deps) {
  const { supabase } = deps;
  const readiness = deps.readiness || topazReadiness(deps.env || process.env);
  const update = (patch) => supabase.from("wallpro_production_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", job.id);
  const { data: version, error: versionError } = await supabase.from("wallpro_design_versions").select("*").eq("id", job.version_id).single();
  if (versionError || !version) fail("wallpro_version_missing", `version ${job.version_id} could not be read: ${versionError?.message || "missing"}`);
  if (version.status !== "approved") fail("wallpro_version_not_approved", "production runs on an approved version only");
  const request = normalizeRequest(job.request, version);
  const { data: file, error: fileError } = await supabase.storage.from(BUCKET).download(version.artwork_path);
  if (fileError || !file) fail("wallpro_source_unreadable", `approved master could not be read: ${fileError?.message || "empty"}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  if (!meta.width || !meta.height) fail("wallpro_source_unreadable", "approved master has no readable dimensions");
  const source = { bytes, width: meta.width, height: meta.height, sha256: sha256(bytes), path: version.artwork_path };
  const { panels, bounds } = planPanels(request);
  const prefix = `${job.owner_id}/production/${job.id}/`;
  const progress = (stage, panelsDone) => ({ stage, panelsTotal: panels.length, panelsDone, nativePpi: clean(sourcePpi(source, request)), topaz: readiness.available ? readiness.model : "unavailable", concurrency: Math.min(panels.length, deps.concurrency || PANEL_CONCURRENCY) });
  await update({ progress: progress("building", 0) });
  // The panels are independent nodes of the graph: each one rasterises,
  // enhances and uploads on its own, bounded only by runtime memory. Progress is
  // written the moment any panel lands so the customer sees files as they exist.
  const done = [];
  let landed = 0;
  await mapConcurrent(panels, deps.concurrency || PANEL_CONCURRENCY, async (panel) => {
    const produced = await producePanel({ source, request, panel, readiness, fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, signal: deps.signal });
    const file = `panel-${String(panel.number).padStart(3, "0")}-${fmt(panel.width)}x${fmt(panel.height)}in.png`;
    const stored = await uploadBytes(deps, prefix + file, produced.bytes, "image/png");
    done.push({ number: panel.number, file, path: stored.storagePath, xIn: panel.x, yIn: panel.y, widthIn: panel.width, heightIn: panel.height, overlapLeftIn: panel.overlapLeft,
      widthPx: produced.widthPx, heightPx: produced.heightPx, ppi: request.targetPpi, sha256: stored.contentHash, byteSize: stored.byteSize, upscale: produced.upscale });
    done.sort((a, b) => a.number - b.number);
    landed += 1;
    await update({ panels: done, progress: progress("building", landed) });
  });
  // The whole wall as one file, stitched from the panels just built. It fails
  // soft: the panels are the deliverable and are already stored, so a wall too
  // large for one file (or a runtime out of memory) reports why and the job is
  // still ready.
  let wholeWall = null;
  if (request.wholeWall) {
    await update({ panels: done, progress: { ...progress("stitching", done.length) } });
    try {
      const downloads = new Map();
      for (const panel of done) {
        const { data, error } = await supabase.storage.from(BUCKET).download(panel.path);
        if (error || !data) fail("wallpro_panel_unreadable", `panel ${panel.number} could not be re-read for stitching: ${error?.message || "empty"}`);
        downloads.set(panel.number, Buffer.from(await data.arrayBuffer()));
      }
      const stitched = await stitchWholeWall({ request, bounds, panels: done, panelBytes: (n) => downloads.get(n) });
      const file = `wall-${fmt(bounds.width)}x${fmt(bounds.height)}in.png`;
      const stored = await uploadBytes(deps, prefix + file, stitched.bytes, "image/png");
      wholeWall = { file, path: stored.storagePath, widthIn: bounds.width, heightIn: bounds.height, widthPx: stitched.width, heightPx: stitched.height, ppi: request.targetPpi, sha256: stored.contentHash, byteSize: stored.byteSize };
    } catch (err) {
      wholeWall = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  const manifest = { contract: CONTRACT, jobId: job.id, versionId: job.version_id, projectId: job.project_id, generatedAt: new Date().toISOString(), request, bounds,
    source: { path: source.path, widthPx: source.width, heightPx: source.height, sha256: source.sha256, nativePpi: clean(sourcePpi(source, request)) },
    panels: done, wholeWall, install: `Adjacent panels share ${fmt(request.overlapIn)} in of identical artwork; align the duplicate image, never stretch. Perimeter bleed ${fmt(request.bleedIn)} in. Every PNG is ${request.targetPpi} PPI at its stated inches.${wholeWall && wholeWall.path ? ` ${wholeWall.file} is the whole wall including bleed as one file at the same PPI, for a RIP that tiles itself.` : ""}` };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  const storedManifest = await uploadBytes(deps, prefix + "manifest.json", manifestBytes, "application/json");
  await update({ status: "ready", panels: done, manifest_path: storedManifest.storagePath, finished_at: new Date().toISOString(), progress: { ...progress("ready", done.length), wholeWall } });
  return { panels: done, manifest, wholeWall };
}

/** Pixel budget for one whole-wall file. A 142 x 96 in wall with bleed is
 * ~317 MP at 150 PPI (~950 MB raw); beyond this the runtime would swap. */
const MAX_WHOLE_WALL_PIXELS = 450e6;

/**
 * Stitches the finished panels into one wall image. Every panel already sits
 * at the target PPI and shares `overlapIn` of identical artwork with its
 * neighbour, so each one is copied row by row at its own inch offset into one
 * raw RGB canvas; later panels overwrite the duplicate strip with the same
 * pixels. One panel is decoded at a time to keep the peak near canvas + one panel.
 */
async function stitchWholeWall({ request, bounds, panels, panelBytes }) {
  const ppi = request.targetPpi;
  const width = Math.max(1, Math.round(bounds.width * ppi)), height = Math.max(1, Math.round(bounds.height * ppi));
  if (width * height > MAX_WHOLE_WALL_PIXELS) fail("wallpro_whole_wall_too_large", `${width} x ${height} px is beyond the ${MAX_WHOLE_WALL_PIXELS / 1e6} MP one-file budget; print from the panels`);
  const canvas = Buffer.alloc(width * height * 3, 255);
  for (const panel of [...panels].sort((a, b) => a.number - b.number)) {
    const raw = await sharp(panelBytes(panel.number), { limitInputPixels: false }).flatten({ background: WHITE }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pw = raw.info.width, ph = raw.info.height;
    if (raw.info.channels !== 3) fail("wallpro_panel_unreadable", `panel ${panel.number} decoded with ${raw.info.channels} channels`);
    const left = Math.min(width - 1, Math.max(0, Math.round((panel.xIn - bounds.x) * ppi)));
    const top = Math.min(height - 1, Math.max(0, Math.round((panel.yIn - bounds.y) * ppi)));
    const cols = Math.min(pw, width - left), rows = Math.min(ph, height - top);
    for (let y = 0; y < rows; y++) raw.data.copy(canvas, ((top + y) * width + left) * 3, y * pw * 3, y * pw * 3 + cols * 3);
  }
  const bytes = await sharp(canvas, { raw: { width, height, channels: 3 }, limitInputPixels: false }).withMetadata({ density: ppi }).png({ compressionLevel: 6 }).toBuffer();
  return { bytes, width, height };
}

/** Runs `fn` over `items` with at most `limit` in flight; rejects on the first failure. */
async function mapConcurrent(items, limit, fn) {
  const queue = items.map((item, index) => ({ item, index }));
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) results[next.index] = await fn(next.item, next.index);
  });
  await Promise.all(workers);
  return results;
}

function createWallProProductionWorker({ supabase, supabaseUrl, serviceRoleKey, tusEndpoint, workerId, intervalMs = 5000, env = process.env, fetchImpl, apiKey, concurrency } = {}) {
  let timer = null, busy = false, lastError = null, processed = 0;
  const deps = { supabase, supabaseUrl, serviceRoleKey, tusEndpoint, env, fetchImpl, apiKey, concurrency };
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const { data, error } = await supabase.rpc("claim_wallpro_production_job", { p_worker: workerId });
      if (error) throw new Error(error.message);
      const job = Array.isArray(data) ? data[0] : data;
      if (!job) return;
      try { await processJob(job, deps); processed += 1; lastError = null; }
      catch (error) {
        lastError = `${error.code || "wallpro_production_failed"}: ${error.message}`;
        console.error(`[WALLPRO] production job ${job.id} failed: ${lastError}`);
        await supabase.from("wallpro_production_jobs").update({ status: "failed", error: String(error.message || error).slice(0, 500), finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
      }
    } catch (error) { lastError = error.message; console.error(`[WALLPRO] production worker tick failed: ${error.message}`); }
    finally { busy = false; }
  };
  return {
    start() { if (timer) return; timer = setInterval(() => void tick(), intervalMs); timer.unref?.(); void tick(); },
    stop() { if (timer) clearInterval(timer); timer = null; },
    tick,
    get health() { return { running: !!timer, busy, processed, lastError }; },
  };
}

module.exports = Object.freeze({
  BUCKET, CONTRACT, DEFAULTS, PANEL_CONCURRENCY, WallProProductionError,
  normalizeRequest, planPanels, layoutMetrics, sourcePpi, rasterPanel, producePanel, processJob, createWallProProductionWorker, mapConcurrent, stitchWholeWall, MAX_WHOLE_WALL_PIXELS,
});
