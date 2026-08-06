"use strict";

const express = require("express");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");
const { createHash } = require("node:crypto");
const { registerDesignProStandaloneClaimant } = require("./designpro-standalone-claimant.cjs");

const PORT = Number(process.env.PORT || 3001);
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const WORKER_SECRET = String(process.env.WORKER_SECRET || "").trim();
const GIT_SHA = String(process.env.GIT_SHA || "").trim();
const WORKER_ID = String(process.env.DESIGNPRO_WORKER_ID || process.env.HOSTNAME || process.pid).trim();
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !WORKER_SECRET || !GIT_SHA) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_SECRET and GIT_SHA are required");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const app = express();
app.use(express.json({ limit: "1mb" }));

function authMiddleware(req, res, next) {
  if (req.headers.authorization !== `Bearer ${WORKER_SECRET}`) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function approvedAssetUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && parsed.hostname === new URL(SUPABASE_URL).hostname && !parsed.username && !parsed.password ? parsed : null;
  } catch { return null; }
}

async function fetchBuffer(url) {
  const approved = approvedAssetUrl(url);
  if (!approved) throw new Error("Call 7 source is outside the standalone Supabase origin");
  const response = await fetch(approved, { redirect: "error" });
  if (!response.ok) throw new Error(`Call 7 source fetch failed: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > 512 * 1024 * 1024) throw new Error("Call 7 source exceeds 512 MiB");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 512 * 1024 * 1024) throw new Error("Call 7 source is empty or too large");
  return bytes;
}

async function uploadBuffer(storagePath, buffer, contentType) {
  if (!/^proof-tiles\/[A-Za-z0-9._/-]+$/.test(storagePath) || storagePath.includes("..")) throw new Error("unsafe Call 7 master path");
  const { error } = await supabase.storage.from("wrap-files").upload(storagePath, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Call 7 master upload failed: ${error.message}`);
}

app.get("/health", (_req, res) => res.json({ ready: true, service: "designproai-os", commit: GIT_SHA, workerId: WORKER_ID }));

// Frozen server port of Call 7. It writes one full-resolution master per own
// surface and returns a presentation proof whose regions are bound to those
// exact masters. Call 8 only promotes these masters; it never crops the 3D art.
app.post("/compose-proof-sheet", authMiddleware, async (req, res) => {
  try {
    const { canvas, tiles = [], overlaySvg } = req.body || {};
    const W = Math.round(Number(canvas?.w)); const H = Math.round(Number(canvas?.h));
    if (!(W > 0 && H > 0 && W * H <= 100_000_000) || !Array.isArray(tiles) || tiles.length < 2) return res.status(400).json({ success: false, error: "valid canvas and at least two surface tiles are required" });
    const layers = []; const surfaceMasters = []; const seen = new Set(); const PPI = 10;
    for (const tile of tiles) {
      const key = String(tile.key || "").trim();
      const x = Math.round(Number(tile.x)); const y = Math.round(Number(tile.y));
      const w = Math.round(Number(tile.w)); const h = Math.round(Number(tile.h));
      const trimWidthIn = Number(tile.trimWidthIn); const trimHeightIn = Number(tile.trimHeightIn); const bleedIn = Number(tile.bleedIn);
      const masterPath = String(tile.masterPath || "").trim();
      if (!key || seen.has(key) || !(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= W && y + h <= H) || !(trimWidthIn > 0 && trimHeightIn > 0) || bleedIn !== 5 || !/^proof-tiles\/[A-Za-z0-9._/-]+\/masters\/[A-Za-z0-9._-]+\.png$/.test(masterPath)) return res.status(400).json({ success: false, error: `invalid Call 7 tile ${key || "?"}` });
      seen.add(key);
      const source = await fetchBuffer(tile.url);
      const sourceMeta = await sharp(source, { limitInputPixels: false }).metadata();
      if (!sourceMeta.width || !sourceMeta.height) throw new Error(`${key} has no readable pixel dimensions`);
      if (sourceMeta.hasAlpha) {
        const alpha = (await sharp(source, { limitInputPixels: false }).stats()).channels[3];
        if (alpha && alpha.min < 255) throw new Error(`${key} contains transparency`);
      }
      const trimW = Math.max(1, Math.round(trimWidthIn * PPI)); const trimH = Math.max(1, Math.round(trimHeightIn * PPI));
      let trim = await sharp(source, { limitInputPixels: false }).resize(trimW, trimH, { fit: "inside", kernel: "lanczos3" }).png().toBuffer();
      const fitted = await sharp(trim).metadata();
      const left = Math.floor((trimW - fitted.width) / 2); const right = trimW - fitted.width - left;
      const top = Math.floor((trimH - fitted.height) / 2); const bottom = trimH - fitted.height - top;
      if (left || right || top || bottom) trim = await sharp(trim).extend({ left, right, top, bottom, extendWith: "mirror" }).png().toBuffer();
      const bleed = 5 * PPI;
      const master = await sharp(trim).extend({ left: bleed, right: bleed, top: bleed, bottom: bleed, extendWith: "mirror" }).png().toBuffer();
      const meta = await sharp(master).metadata();
      if (meta.width !== trimW + 2 * bleed || meta.height !== trimH + 2 * bleed) throw new Error(`${key} geometry drifted`);
      if (Math.abs(w / h - meta.width / meta.height) > 0.01) throw new Error(`${key} proof region would distort`);
      await uploadBuffer(masterPath, master, "image/png");
      const preview = await sharp(master).resize(w, h, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
      layers.push({ input: preview, left: x, top: y });
      surfaceMasters.push({ key, masterPath, sha256: createHash("sha256").update(master).digest("hex"), bytes: master.length, pixelWidth: meta.width, pixelHeight: meta.height, trimWidthIn, trimHeightIn, bleedIn, sourceCrop: { contract: "call7-proof-region-transform.v1", sourceSha256: createHash("sha256").update(source).digest("hex"), sourceWidth: sourceMeta.width, sourceHeight: sourceMeta.height, fit: "contain-mirror-fill-at-call7", stretch: false, rotationDegrees: 0, truncated: false } });
    }
    if (overlaySvg && String(overlaySvg).trim()) layers.push({ input: Buffer.from(String(overlaySvg)), left: 0, top: 0 });
    const proof = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).composite(layers).png().toBuffer();
    for (const master of surfaceMasters) {
      const tile = tiles.find((item) => String(item.key) === master.key);
      const region = await sharp(proof).extract({ left: Math.round(Number(tile.x)), top: Math.round(Number(tile.y)), width: Math.round(Number(tile.w)), height: Math.round(Number(tile.h)) }).png().toBuffer();
      master.regionSha256 = createHash("sha256").update(region).digest("hex"); master.regionBytes = region.length;
    }
    res.json({ success: true, pngBase64: proof.toString("base64"), width: W, height: H, bytes: proof.length, surfaceMasters });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

registerDesignProStandaloneClaimant({ app, supabase, supabaseUrl: SUPABASE_URL, workerSecret: WORKER_SECRET, workerId: WORKER_ID, port: PORT });
app.listen(PORT, "0.0.0.0", () => console.log(`[DESIGNPRO-OS] ${WORKER_ID} listening on ${PORT}`));
