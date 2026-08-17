/**
 * panel-artboard-generator — STANDALONE vehicle wrap panel artboard generator.
 *
 * Deliberately self-contained: shares NO code with and calls NONE of the
 * existing pipeline functions. One function, four steps, driven by the admin
 * page (/admin/panel-artboard) so every edge invocation stays small:
 *
 *   step:"design"   → the flat wrap design. From a prompt (creative, temp 0.7)
 *                     or a reference image (recreate, temp 0.0 anchored).
 *   step:"separate" → CLONED BACKGROUND (design with overlays removed, pattern
 *                     continued) + OVERLAYS as one transparent PNG (magenta
 *                     knockout → code chroma-key) + coordinate boxes (temp 0,
 *                     JSON [ymin,xmin,ymax,xmax]) cropped BY CODE into
 *                     individual transparent overlay PNGs (logo / text /
 *                     design elements).
 *   step:"panel"    → ONE print-ready panel for a named side at true vehicle
 *                     dimensions + bleed (temp 0, anchored to the design).
 *   step:"save"     → create the job + insert all asset rows (registrar only,
 *                     zero image work).
 *
 * Model locked: gemini-3-pro-image-preview (flash fallback only).
 * config.toml:  [functions.panel-artboard-generator]  verify_jwt = false
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as b64encode, decode as b64decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { upscaleImageBytes } from "../_shared/topaz-upscale.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "wrap-files";
const MODEL = "gemini-3-pro-image-preview";
const MODEL_FALLBACK = "gemini-3.1-flash-image-preview";
const SIGNED_TTL = 60 * 60 * 24 * 365;

const keys: string[] = [];
let keysLoaded = false, keyIdx = 0;
function apiKey(): string {
  if (!keysLoaded) {
    const p = Deno.env.get("GOOGLE_AI_API_KEY"); if (p) keys.push(p);
    for (let i = 2; i <= 5; i++) { const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`); if (k) keys.push(k); }
    keysLoaded = true;
  }
  if (!keys.length) throw new Error("No GOOGLE_AI_API_KEY");
  return keys[keyIdx++ % keys.length];
}
function db() { return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!); }
function out(b: unknown, s = 200): Response { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }
// Module scope — used by both the production chain and the export step.
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── Vehicle panel dimensions (vehicle_dimensions table + body-type defaults) ──
interface Dims { sideW: number; sideH: number; roofW: number; roofL: number; backW: number; backH: number; hoodW: number; hoodL: number; }
const DEFAULTS: Record<string, Dims> = {
  sedan: { sideW: 170, sideH: 56, roofW: 50, roofL: 110, backW: 60, backH: 50, hoodW: 56, hoodL: 40 },
  suv:   { sideW: 200, sideH: 70, roofW: 54, roofL: 75,  backW: 66, backH: 60, hoodW: 60, hoodL: 42 },
  truck: { sideW: 210, sideH: 72, roofW: 50, roofL: 70,  backW: 66, backH: 56, hoodW: 62, hoodL: 46 },
  van:   { sideW: 220, sideH: 80, roofW: 60, roofL: 130, backW: 70, backH: 90, hoodW: 60, hoodL: 40 },
};
async function lookupDims(make: string, model: string, year: string, bodyType: string): Promise<{ d: Dims; source: string }> {
  try {
    const yr = parseInt(year) || 0;
    let { data } = await db().from("vehicle_dimensions")
      .select("make,model,year_start,year_end,side_width,side_height,hood_width,hood_length,roof_width,roof_length,back_width,back_height")
      .ilike("make", make).ilike("model", `%${model}%`).limit(25);
    if (!data?.length) {
      // Normalized retry: order/trim noise in the caller's model string
      // ("f150xlt", "ram 2500 mega cab" vs the table's "Ram 2500 - Mega Cab -
      // 6'4 box") must still hit the right trim rows. Strip everything but
      // [a-z0-9] from both sides and keep the rows with the longest common
      // prefix — "ram2500megacab" scores 14 against the Mega Cab rows but
      // only 7 against Crew Cab, so the right trim family wins.
      const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const lcp = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
      const want = norm(model);
      const { data: byMake } = await db().from("vehicle_dimensions")
        .select("make,model,year_start,year_end,side_width,side_height,hood_width,hood_length,roof_width,roof_length,back_width,back_height")
        .ilike("make", `%${make}%`).limit(500);
      const scored = (byMake || [])
        .map((r: any) => ({ r, score: lcp(want, norm(r.model)) }))
        .filter((x) => x.score >= 3);
      const best = Math.max(0, ...scored.map((x) => x.score));
      data = scored.filter((x) => x.score === best).map((x) => x.r);
    }
    const inRange = (data || []).find((r: any) => yr && r.year_start && r.year_end && yr >= r.year_start && yr <= r.year_end);
    const r: any = inRange || (data || [])[0];
    if (r?.side_width) {
      return {
        d: {
          sideW: r.side_width, sideH: r.side_height,
          roofW: r.roof_width || 54, roofL: r.roof_length || 75,
          backW: r.back_width || 66, backH: r.back_height || 56,
          hoodW: r.hood_width || 60, hoodL: r.hood_length || 42,
        },
        source: inRange ? `vehicle_dimensions(${r.year_start}-${r.year_end})` : "vehicle_dimensions(nearest)",
      };
    }
  } catch { /* fall through to defaults */ }
  return { d: DEFAULTS[bodyType] || DEFAULTS.truck, source: `default:${bodyType}` };
}
interface PanelSpec { label: string; w: number; h: number; }
function panelSet(d: Dims): PanelSpec[] {
  const r = (n: number) => Math.round(n * 10) / 10;
  return [
    { label: "DRIVER SIDE", w: r(d.sideW), h: r(d.sideH) },
    { label: "PASSENGER SIDE", w: r(d.sideW), h: r(d.sideH) },
    { label: "HOOD", w: r(d.hoodW), h: r(d.hoodL) },
    { label: "ROOF", w: r(d.roofW), h: r(d.roofL) },
    { label: "FRONT", w: r(d.backW), h: r(d.backH) },
    { label: "REAR", w: r(d.backW), h: r(d.backH) },
  ];
}

// ── Gemini ──
// 21:9 removed — it produces a short "skinny" frame; 16:9 is the largest 4K canvas.
const ASPECTS: Array<[string, number]> = [["16:9", 16 / 9], ["3:2", 1.5], ["4:3", 4 / 3], ["1:1", 1], ["3:4", 0.75], ["9:16", 9 / 16]];
function aspectOf(w: number, h: number): string {
  const t = w / h; let best = "16:9", d = Infinity;
  for (const [l, r] of ASPECTS) { const e = Math.abs(r - t); if (e < d) { d = e; best = l; } }
  return best;
}
const ENGINE = `You are a precise pre-press print production engine for vehicle wraps. When given a reference anchor image you maintain absolute alignment, scale, and spatial positions of all graphic elements exactly as seen — no invented elements, shadows, lighting, or background patterns.`;

async function img(parts: any[], aspect: string, temperature: number, imageSize = "2K", opts: { attempts?: number; timeoutMs?: number } = {}): Promise<Uint8Array | null> {
  // attempts caps in-function retries so we return BEFORE the ~150s gateway
  // wall-clock (a slow 3×120s loop is what 504'd Build Assets). Callers that
  // are driven by a retrying client (e.g. proofpanel) pass attempts:2 + a
  // tighter timeout and let the client re-call on failure.
  const models = opts.attempts === 1 ? [MODEL] : opts.attempts === 2 ? [MODEL, MODEL_FALLBACK] : [MODEL, MODEL, MODEL_FALLBACK];
  const to = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 120_000;
  for (const m of models) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey()}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: ENGINE }] },
          contents: [{ role: "user", parts }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: aspect, imageSize }, temperature, ...(temperature <= 0.2 ? { topP: 1.0 } : {}) },
        }),
        signal: AbortSignal.timeout(to),
      });
      if (!resp.ok) { console.error(`[PANELGEN] ${m} HTTP ${resp.status}`); continue; }
      const r = await resp.json();
      for (const p of (r?.candidates?.[0]?.content?.parts || [])) if (p.inlineData?.data) return b64decode(p.inlineData.data);
    } catch (e: any) { console.error(`[PANELGEN] ${m} ${e?.message}`); }
  }
  return null;
}

// NOTE: the legacy overlay-box detector + magenta chroma-key routines were
// removed — the separate step uses lossless text re-rendering (see Call 11) and
// the slice path is a pure deterministic crop, so no magenta knockout is needed.

// ── Call 11 — TEXT LAYER ISOLATION (separate render pass, true alpha) ──
// Detect each text/logo element's exact CONTENT + position (vision only — no
// pixels), then re-render the text fresh onto a transparent RGBA canvas. This
// never touches the background, so there are no halos, no chroma fringe, no
// semi-translucent mess — just crisp, standalone, editable overlay assets.
let _ovFont: Uint8Array | null = null;
async function loadOverlayFont(): Promise<Uint8Array> {
  if (!_ovFont) {
    const r = await fetch("https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf");
    _ovFont = new Uint8Array(await r.arrayBuffer());
  }
  return _ovFont;
}

async function renderTextOverlay(text: string, targetW: number): Promise<Uint8Array> {
  const font = await loadOverlayFont();
  let im = await Image.renderText(font, 120, text, 0xffffffff); // white, true alpha channel
  if (targetW > 0 && im.width > targetW) {
    const s = targetW / im.width;
    im = im.resize(Math.max(1, Math.round(im.width * s)), Math.max(1, Math.round(im.height * s)));
  }
  return await im.encode(); // PNG — alpha preserved (RGBA)
}

async function detectTextElements(parts: any[]): Promise<Array<{ kind: string; text: string; box: number[] }>> {
  const prompt = `List every readable TEXT element and every standalone LOGO in this vehicle wrap design — company names, taglines, slogans, phone numbers, website URLs, and logos. For each return: its exact readable text (use "" for a non-text logo mark), kind ("text" or "logo"), and its tight bounding box. Repeating background pattern motifs (stripes, shards, camo, star fields) are NOT elements — skip them. Return ONLY JSON: {"elements":[{"kind":"text","text":"QUALITY TIRE","box_2d":[ymin,xmin,ymax,xmax]}]} normalized 0-1000.`;
  for (const m of [MODEL, MODEL_FALLBACK]) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey()}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: ENGINE }] },
          contents: [{ role: "user", parts: [...parts, { text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT"], responseMimeType: "application/json", temperature: 0, topP: 1.0 },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!resp.ok) continue;
      const r = await resp.json();
      const txt = (r?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
      const parsed = JSON.parse(txt);
      const list = Array.isArray(parsed) ? parsed : parsed?.elements;
      if (Array.isArray(list)) {
        return list.map((b: any) => ({ kind: String(b.kind || "text"), text: String(b.text || ""), box: b.box_2d || b.box || [] }))
          .filter((b: any) => Array.isArray(b.box) && b.box.length === 4);
      }
    } catch (e: any) { console.error(`[PANELGEN] detectTextElements ${m} ${e?.message}`); }
  }
  return [];
}

// snapWhites — snap near-neutral bright pixels to pure 255 white and return
// the count. White on vinyl = UNPRINTED media: AI bakes warm studio light into
// whites (cream ≈ 245,238,215) which prints as a yellow tint on stars/stripes.
// Shared by the crop step (whitepoint:true) and the production chain
// (production_ctx.whitepoint). Mutates im in place.
function snapWhites(im: Image, thr = 222): number {
  let snapped = 0;
  for (const [wx, wy, wc] of im.iterateWithColors()) {
    const r = (wc >>> 24) & 0xff, g = (wc >>> 16) & 0xff, bb = (wc >>> 8) & 0xff, a = wc & 0xff;
    const mx = Math.max(r, g, bb), mn = Math.min(r, g, bb);
    if (mx >= thr && mn >= thr - 34 && mx - mn <= 40 && (r !== 255 || g !== 255 || bb !== 255)) {
      im.setPixelAt(wx, wy, ((0xffffff00 | a) >>> 0));
      snapped++;
    }
  }
  return snapped;
}
// NOTE: mutates src in place — callers never reuse the input image, and the
// clone doubled a 4K bitmap (~37MB) which is what 546'd the worker at 4K.
function fitCover(src: Image, tw: number, th: number, anchor: "center" | "top" = "center"): Image {
  const c = src;
  const sr = c.width / c.height, tr = tw / th;
  let cw: number, ch: number, cx: number, cy: number;
  if (sr > tr) { ch = c.height; cw = Math.max(1, Math.round(ch * tr)); cx = Math.round((c.width - cw) / 2); cy = 0; }
  else { cw = c.width; ch = Math.max(1, Math.round(cw / tr)); cx = 0; cy = anchor === "top" ? 0 : Math.round((c.height - ch) / 2); }
  c.crop(cx, cy, cw, ch);
  c.resize(tw, th);
  return c;
}
// flipH — pure deterministic horizontal mirror (imagescript has no flip()).
// Swaps each row's pixels left<->right in place. Used to derive the PASSENGER
// background as a 1:1 reflection of the DRIVER background (perfect symmetry).
function flipH(im: Image): void {
  const w = im.width, h = im.height, bmp = im.bitmap;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < (w >> 1); x++) {
      const i = row + x * 4, j = row + (w - 1 - x) * 4;
      for (let k = 0; k < 4; k++) { const t = bmp[i + k]; bmp[i + k] = bmp[j + k]; bmp[j + k] = t; }
    }
  }
}
// flipV — vertical mirror in place (rows top<->bottom).
function flipV(im: Image): void {
  const w = im.width, h = im.height, bmp = im.bitmap, rb = w * 4;
  const tmp = new Uint8Array(rb);
  for (let y = 0; y < (h >> 1); y++) {
    const top = y * rb, bot = (h - 1 - y) * rb;
    tmp.set(bmp.subarray(top, top + rb));
    bmp.copyWithin(top, bot, bot + rb);
    bmp.set(tmp, bot);
  }
}
// mirrorExtend — add a `b`-px bleed border by MIRRORING the design's own edges
// outward (the print-shop "mirror bleed"). NO crop of the design, NO AI: the full
// `src` sits centered and the border is a reflection of its outer pixels, so the
// artwork runs cleanly past the cut line on every side. Deterministic.
function mirrorExtend(src: Image, b: number): Image {
  if (!(b > 0)) return src;
  const w = src.width, h = src.height;
  const bw = Math.min(b, w), bh = Math.min(b, h);   // guard tiny panels
  const out = new Image(w + 2 * b, h + 2 * b);
  out.composite(src, b, b);                                  // full design, centered
  const hStrip = (x0: number) => { const s = src.clone().crop(x0, 0, bw, h); flipH(s); return s; };
  const vStrip = (y0: number) => { const s = src.clone().crop(0, y0, w, bh); flipV(s); return s; };
  out.composite(hStrip(0), b - bw, b);                       // left  edge mirrored
  out.composite(hStrip(w - bw), w + b, b);                   // right edge mirrored
  out.composite(vStrip(0), b, b - bh);                       // top   edge mirrored
  out.composite(vStrip(h - bh), b, h + b);                   // bottom edge mirrored
  const corner = (x0: number, y0: number) => { const s = src.clone().crop(x0, y0, bw, bh); flipH(s); flipV(s); return s; };
  out.composite(corner(0, 0), b - bw, b - bh);               // 4 corners mirrored both ways
  out.composite(corner(w - bw, 0), w + b, b - bh);
  out.composite(corner(0, h - bh), b - bw, h + b);
  out.composite(corner(w - bw, h - bh), w + b, h + b);
  return out;
}
async function fetchB64(url: string): Promise<{ b64: string; mime: string }> {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return { b64: b64encode(new Uint8Array(await r.arrayBuffer())), mime: r.headers.get("content-type") || "image/png" };
}

// ── PNG physical-density header (pHYs) ────────────────────────────────────────
// Inject the REAL print DPI into the PNG so the RIP/print software knows the file's
// physical size (e.g. "this is 198 inches wide"), independent of pixel count. Pure
// byte surgery — does NOT touch a single design pixel (1:1 preserved). Insert the
// pHYs chunk right after IHDR with a correct CRC32.
const _crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = _crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngWithDpi(png: Uint8Array, dpiX: number, dpiY: number): Uint8Array {
  // PNG sig (8) + IHDR chunk (len4+type4+data13+crc4 = 25) → IHDR ends at 33.
  if (png.length < 33 || png[0] !== 0x89 || png[1] !== 0x50 || png[12] !== 0x49 || png[13] !== 0x48) return png; // not a PNG / no IHDR
  const ppmX = Math.max(1, Math.round(dpiX / 0.0254));
  const ppmY = Math.max(1, Math.round(dpiY / 0.0254));
  const chunk = new Uint8Array(21);                 // len4 + type4 + data9 + crc4
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);                               // data length = 9
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);          // "pHYs"
  dv.setUint32(8, ppmX); dv.setUint32(12, ppmY); chunk[16] = 1; // x/y ppm + unit=meter
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));  // CRC over type+data
  const out = new Uint8Array(png.length + 21);
  out.set(png.subarray(0, 33), 0);
  out.set(chunk, 33);
  out.set(png.subarray(33), 33 + 21);
  return out;
}

// ── SOURCE FLAT — canonical vector assets (deterministic, zero AI) ────────────
// The "asset vault": instead of trusting a malformed AI-generated background (the
// waving flag with scattered stars), we DRAW the mathematically-correct flat
// graphic to fill the panel rectangle exactly. The US flag has one legally-spec'd
// geometry — 13 stripes (7 red / 6 white) and 50 stars in the 9-row 6/5 offset
// grid — so it is generated, never sourced or hallucinated.
// Old Glory Red #B22234, White #FFFFFF, Old Glory Blue #3C3B6E.
// ── Vector line-trace primitives (transparent alignment blueprint) ───────────
function plot(img: Image, x: number, y: number, c: number): void {
  if (x >= 0 && y >= 0 && x < img.width && y < img.height) img.setPixelAt(x + 1, y + 1, c);
}
function hLine(img: Image, x0: number, x1: number, y: number, c: number, t = 1): void {
  const a = Math.min(x0, x1), b = Math.max(x0, x1);
  for (let dy = 0; dy < t; dy++) for (let x = a; x <= b; x++) plot(img, x, y + dy, c);
}
function vLine(img: Image, x: number, y0: number, y1: number, c: number, t = 1): void {
  const a = Math.min(y0, y1), b = Math.max(y0, y1);
  for (let dx = 0; dx < t; dx++) for (let y = a; y <= b; y++) plot(img, x + dx, y, c);
}
function rectOutline(img: Image, x: number, y: number, w: number, h: number, c: number, t = 1): void {
  hLine(img, x, x + w, y, c, t); hLine(img, x, x + w, y + h - t, c, t);
  vLine(img, x, y, y + h, c, t); vLine(img, x + w - t, y, y + h, c, t);
}
function dashedH(img: Image, x0: number, x1: number, y: number, c: number, dash = 22, gap = 16, t = 1): void {
  let x = Math.min(x0, x1); const end = Math.max(x0, x1);
  while (x <= end) { hLine(img, x, Math.min(x + dash, end), y, c, t); x += dash + gap; }
}
function dashedV(img: Image, x: number, y0: number, y1: number, c: number, dash = 22, gap = 16, t = 1): void {
  let y = Math.min(y0, y1); const end = Math.max(y0, y1);
  while (y <= end) { vLine(img, x, y, Math.min(y + dash, end), c, t); y += dash + gap; }
}
function inPoly(px: number, py: number, pts: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Filled, regular 5-point star (scanline even-odd fill over its bounding box).
function drawStar(img: Image, cx: number, cy: number, R: number, color: number): void {
  const ri = R * 0.382; // inner/outer radius ratio for a regular 5-point star
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 5; i++) {
    const ao = ((-90 + i * 72) * Math.PI) / 180;
    pts.push([cx + R * Math.cos(ao), cy + R * Math.sin(ao)]);
    const ai = ((-90 + i * 72 + 36) * Math.PI) / 180;
    pts.push([cx + ri * Math.cos(ai), cy + ri * Math.sin(ai)]);
  }
  const minX = Math.max(0, Math.floor(cx - R)), maxX = Math.min(img.width - 1, Math.ceil(cx + R));
  const minY = Math.max(0, Math.floor(cy - R)), maxY = Math.min(img.height - 1, Math.ceil(cy + R));
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++)
      if (inPoly(x + 0.5, y + 0.5, pts)) img.setPixelAt(x + 1, y + 1, color); // setPixelAt is 1-indexed
}
function drawUSFlag(pxW: number, pxH: number): Image {
  const RED = Image.rgbaToColor(178, 34, 52, 255);
  const WHITE = Image.rgbaToColor(255, 255, 255, 255);
  const BLUE = Image.rgbaToColor(60, 59, 110, 255);
  const flag = new Image(pxW, pxH);
  flag.fill(WHITE);
  const stripeH = pxH / 13;
  // 7 red stripes at rows 0,2,4,6,8,10,12 (the 6 white stripes are the fill).
  for (let i = 0; i < 13; i += 2) {
    const y0 = Math.round(i * stripeH), y1 = Math.round((i + 1) * stripeH);
    flag.composite(new Image(pxW, Math.max(1, y1 - y0)).fill(RED), 0, y0);
  }
  // Canton — exactly the top 7 stripes tall, 0.40 of the fly width (official D/B).
  const cantonH = Math.round(7 * stripeH);
  const cantonW = Math.round(0.40 * pxW);
  flag.composite(new Image(Math.max(1, cantonW), Math.max(1, cantonH)).fill(BLUE), 0, 0);
  // 50 stars on a 9-row × 11-position grid: rows of 6 (odd positions) alternating
  // rows of 5 (even positions) → 5×6 + 4×5 = 50.
  const colGap = cantonW / 12, rowGap = cantonH / 10;
  const R = Math.max(2, Math.min(colGap, rowGap) * 0.42);
  for (let row = 1; row <= 9; row++)
    for (let col = 1; col <= 11; col++) {
      const six = row % 2 === 1 && col % 2 === 1;
      const five = row % 2 === 0 && col % 2 === 0;
      if (six || five) drawStar(flag, col * colGap, row * rowGap, R, WHITE);
    }
  return flag;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const step: string = body.step || "";
    if (step === "production" && body.proofId && !isApproveProLive()) {
      return approveProDisabledResponse();
    }
    const jobTag: string = body.jobId || crypto.randomUUID();
    const dir = `panel-artboard/${jobTag}`;
    const save = async (name: string, bytes: Uint8Array): Promise<{ path: string; url: string }> => {
      const path = `${dir}/${name}`;
      const { error } = await db().storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
      if (error) throw new Error(`upload ${name}: ${error.message}`);
      const { data } = await db().storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
      return { path, url: data?.signedUrl || "" };
    };

    // ── STEP: liftoverlays — GRAPHICS PACK deterministic overlay lift ────────
    // docs/SCOPE_DETERMINISTIC_OVERLAY_LIFT.md. DesignPro-only product surface.
    // Proxies the Railway worker's /lift-overlays (locate → erase → compose →
    // subtract → round-trip assert) for one side's BRANDED print panel, then
    // By default this is a PURE/STAGING operation: it returns the clean panel and
    // overlays without mutating the currently active vault. `persist:true` is
    // reserved for an explicit operator action. This prevents a rebuild from
    // overwriting good v1 rows before the replacement pack passes every gate.
    if (step === "liftoverlays") {
      const gid: string = (body.generationId || body.jobId || "").trim();
      const side: string = (body.side || "").trim();
      const persist = body.persist === true;
      if (!gid || !side) return out({ success: false, error: "generationId and side required" }, 400);
      // The function gateway stays verify_jwt=false to avoid stale-token gateway
      // failures, so authenticate this service-role operation inside the handler.
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const configuredWorkerSecret = Deno.env.get("WORKER_SECRET") || "";
      const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const workerSecret = String(req.headers.get("x-worker-secret") || "").trim();
      const isService =
        (!!bearer && bearer === serviceKey) ||
        (!!configuredWorkerSecret && workerSecret === configuredWorkerSecret);
      let callerUserId: string | null = null;
      let privileged = false;
      if (!isService) {
        if (!bearer) return out({ success: false, error: "Authentication required" }, 401);
        const authDb = db();
        const { data: authData, error: authError } = await authDb.auth.getUser(bearer);
        callerUserId = authData?.user?.id || null;
        if (authError || !callerUserId) return out({ success: false, error: "Invalid authentication" }, 401);
        const [{ data: generation }, { data: role }] = await Promise.all([
          authDb.from("designiq_generations").select("user_id").eq("id", gid).maybeSingle(),
          authDb.from("user_roles").select("role").eq("user_id", callerUserId)
            .in("role", ["admin", "tester"]).limit(1).maybeSingle(),
        ]);
        privileged = !!role;
        if (!privileged && String((generation as any)?.user_id || "") !== callerUserId) {
          return out({ success: false, error: "Forbidden" }, 403);
        }
        // Rebuilds use the non-persisting staging form. Mutating the active vault
        // remains an explicit operator/service action.
        if (persist && !privileged) return out({ success: false, error: "Operator authorization required for persist" }, 403);
      }
      const WORKER_URL = Deno.env.get("WORKER_URL");
      const WORKER_SECRET = Deno.env.get("WORKER_SECRET") || "genie-worker-2026";
      if (!WORKER_URL) return out({ success: false, error: "WORKER_URL is not configured" }, 500);

      // Resolve the side's BRANDED panel from the vault when not passed.
      let brandedUrl: string = (body.brandedUrl || "").trim();
      let pfaRowId: string | null = null;
      if (!brandedUrl || persist) {
        const { data: rows } = await db()
          .from("production_flow_assets")
          .select("id, branding_url, background_url, created_at")
          .eq("job_id", gid).eq("side", side)
          .order("created_at", { ascending: false }).limit(1);
        const row = rows?.[0];
        if (row) { pfaRowId = row.id; if (!brandedUrl) brandedUrl = row.branding_url || row.background_url || ""; }
      }
      if (!brandedUrl) return out({ success: false, error: `no branded panel found for ${side} — build the print panels first` }, 404);

      // The worker uses `jobId` PURELY as the storage folder for the clean
      // panel it writes (graphics-pack/{userId}/{jobId}/{side}_clean.png).
      // Forwarding `gid` here collapsed every attempt onto one path, so a
      // retry — or a late attempt that lost its lease — silently overwrote the
      // object a previous attempt had already fingerprinted. The entice
      // workflow passes a lease-scoped jobId (`${pack.id}-${lease_token}`)
      // specifically to prevent that, and this line was discarding it: live
      // 2026-07-30, pack.verify failed with pack_artifact_changed on
      // panel:FRONT:clean, panel:REAR:clean and panel:ROOF:clean because the
      // erase pass is non-deterministic and each rerun produced different bytes
      // at the same URL. Honour the caller's job scope; fall back to the
      // generation id so callers that send no jobId are unaffected.
      const workerJobId = String(body.jobId || "").trim() || gid;
      const wr = await fetch(`${WORKER_URL.replace(/\/+$/, "")}/lift-overlays`, {
        method: "POST",
        headers: { Authorization: `Bearer ${WORKER_SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: body.userId || gid, jobId: workerJobId, side, brandedUrl }),
        signal: AbortSignal.timeout(300_000),
      });
      const lift = await wr.json().catch(() => ({ success: false, error: `worker ${wr.status}` }));
      if (!lift?.success) {
        return out({ success: false, error: lift?.error || `worker ${wr.status}`, stage: lift?.stage, qc: lift?.qc }, 200);
      }
      // Honest no-op: nothing branded on this side.
      if (!lift.cleanUrl || !(lift.overlays || []).length) {
        return out({ success: true, lifted: 0, reason: lift.reason || "no branding elements detected" });
      }

      // Persist clean panel onto the side's newest vault row (+ QC provenance).
      let persistedPanel = false;
      if (persist && pfaRowId) {
        const { data: cur } = await db().from("production_flow_assets").select("meta_metrics").eq("id", pfaRowId).maybeSingle();
        const meta = { ...((cur?.meta_metrics as Record<string, unknown>) || {}), overlay_lift: { ...lift.qc, overlays: lift.overlays.length, lifted_at: new Date().toISOString() } };
        const { error: upErr } = await db().from("production_flow_assets")
          .update({ background_url: lift.cleanUrl, meta_metrics: meta }).eq("id", pfaRowId);
        persistedPanel = !upErr;
      }

      // Merge overlays into design_generation_assets.overlay_pngs (replace this
      // side's previous entries, keep other sides').
      let persistedOverlays = false;
      if (persist) {
        const { data: dga } = await db().from("design_generation_assets")
          .select("id, overlay_pngs").eq("generation_id", gid).eq("is_current", true)
          .order("iteration_index", { ascending: false }).limit(1);
        const row = dga?.[0];
        if (row) {
          const prev: Array<Record<string, unknown>> = Array.isArray(row.overlay_pngs) ? row.overlay_pngs : [];
          const kept = prev.filter((o) => (o as { side?: string })?.side !== side);
          const { error: ovErr } = await db().from("design_generation_assets")
            .update({ overlay_pngs: [...kept, ...lift.overlays] }).eq("id", row.id);
          persistedOverlays = !ovErr;
        }
      }

      return out({
        success: true, lifted: lift.overlays.length, cleanUrl: lift.cleanUrl,
        overlays: lift.overlays, qc: lift.qc, persistedPanel, persistedOverlays,
      });
    }

    // ── STEP: design — the flat wrap design (pixel-exact / creative / recreate) ──
    if (step === "design") {
      const prompt: string = (body.prompt || "").trim();
      const refUrl: string = (body.referenceImageUrl || "").trim();
      const finish: string = body.finish || "Gloss";
      if (!prompt && !refUrl) return out({ success: false, error: "prompt or referenceImageUrl required" }, 400);
      // PIXEL-EXACT: the customer's flat artwork IS the design. No AI pass —
      // the original bytes are stored untouched and every downstream slice is
      // a code crop of them.
      if (body.pixelExact && refUrl) {
        const r = await fetch(refUrl, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) return out({ success: false, error: `reference fetch ${r.status}` }, 502);
        const u = await save("design.png", new Uint8Array(await r.arrayBuffer()));
        return out({ success: true, jobId: jobTag, designUrl: u.url, designPath: u.path, pixelExact: true });
      }
      let bytes: Uint8Array | null;
      if (refUrl) {
        const ref = await fetchB64(refUrl);
        // Optional composition instruction — the automated version of the
        // designer's manual "generative fill / expand to fit the truck" step,
        // e.g. extending a star field so the master already covers the full
        // panel rectangle and no Photoshop pass is ever needed.
        const editNote = String(body.editInstruction || "").trim();
        // Deterministic expand-outward rules (shop workflow, 2026-06-11): the
        // approved artwork is LOCKED and only extended outward past the
        // vehicle boundaries, as if it was cut from the middle of a larger
        // design. Physical bleed/dims stay inches-based downstream — this
        // governs composition only.
        const expandRules = editNote
          ? ` The approved artwork is the anchor and source of truth: do not redesign, recompose, reposition, scale, rotate, or recreate it — keep its center fixed. Treat it as a cropped section of a larger hidden design and generate new content ONLY beyond its edges, continuing the existing patterns (stripes, star fields, camo, textures, gradients) naturally outward in every direction. Never invent a new background and never align artwork to the canvas edges. The finished panel must look like one continuous graphic the approved design was cut from.`
          : "";
        bytes = await img([
          { inlineData: { mimeType: ref.mime, data: ref.b64 } },
          { text: `Reproduce this approved vehicle wrap design as ONE flat, full-bleed 2D panel, matching every element's position, scale, and color exactly. Extract artwork only — no vehicle, no labels, no dimension text, no sheet headers, no margins. Finish: ${finish}.${editNote ? " " + editNote : ""}${expandRules}` },
        ], "16:9", 0.0, "4K");
      } else {
        bytes = await img([{ text: `Design a complete vehicle wrap as ONE flat, full-bleed 2D panel, faithful to this brief: "${prompt}". Rich layered composition with real depth, readable branding zones, edge-to-edge artwork. Finish: ${finish}. Flat artwork only — no vehicle, no mockup, no panel lines.` }], "16:9", 0.7, "4K");
      }
      if (!bytes) return out({ success: false, error: "Design generation failed — retry" }, 502);
      const u = await save("design.png", bytes);
      return out({ success: true, jobId: jobTag, designUrl: u.url, designPath: u.path });
    }

    // ── STEP: separate — Call 10 (artboardClean) + Call 11 (overlays) ──
    // NO AI un-baking. You cannot losslessly pull baked text back out of a
    // flattened design, so we DON'T try: the clean, text-free background is
    // produced by the dedicated generate-clean-artboard module (branding stripped
    // at GENERATION, never reverse-engineered) and saved as artboardClean. The
    // magenta chroma-key / overlay-repaint passes are removed. Typography & logos
    // ride on top as real, editable transparent-PNG overlay layers composited in
    // the studio — we return the element coordinate boxes (vision only, no pixels)
    // so the studio can pre-place them. This is the lossless layer isolation Carley
    // needs to run revisions.
    if (step === "separate") {
      const designUrl: string = (body.designUrl || "").trim();
      if (!designUrl) return out({ success: false, error: "designUrl required" }, 400);

      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const vehicle = body.vehicle || {};

      // CALL 10 — Layer 1: clean, text-free background.
      // Prefer a caller-supplied clean background — the de-warped print panel from
      // the proofpanel step — so the production build derives Layer 1 from its OWN
      // flattened panels, NOT from generate-clean-artboard (which reinvents the
      // artwork, e.g. a generic stock flag). Callers that only want the editable
      // text/logo overlays pass skipBackground:true to bypass any background.
      // Legacy callers that supply neither still get the old clean-artboard pass.
      let backgroundUrl = String(body.backgroundUrl || body.cleanBackgroundUrl || "").trim();
      if (!backgroundUrl && body.skipBackground !== true) {
        try {
          const cr = await fetch(`${SUPABASE_URL}/functions/v1/generate-clean-artboard`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({
              sourceUrl: designUrl, jobId: jobTag,
              vehicleYear: vehicle.year ?? body.vehicleYear, vehicleMake: vehicle.make ?? body.vehicleMake,
              vehicleModel: vehicle.model ?? body.vehicleModel, dimsText: body.dimsText || "",
            }),
            signal: AbortSignal.timeout(150_000),
          });
          const cd = await cr.json().catch(() => ({}));
          if (cd?.success && cd?.artboardUrl) backgroundUrl = cd.artboardUrl;
          else return out({ success: false, error: `artboardClean generation failed: ${cd?.error || cr.status}` }, 502);
        } catch (e: any) {
          return out({ success: false, error: `artboardClean generation error: ${e?.message}` }, 502);
        }
      }

      // CALL 11 — TEXT LAYER ISOLATION (separate render pass, true alpha).
      // Detect each text element's exact CONTENT + position (vision only — no
      // pixels lifted), then RE-RENDER the text fresh onto a pure transparent RGBA
      // canvas. The background is never touched, so the overlays are crisp with
      // zero halos/fringe. Saved to the asset vault as standalone, editable PNGs
      // Carley can grab, move, and resize independently of the design.
      const ref = await fetchB64(designUrl);
      const refPart = { inlineData: { mimeType: ref.mime, data: ref.b64 } };
      const elements = await detectTextElements([refPart]);

      const uploadPublic = async (name: string, bytes: Uint8Array): Promise<string> => {
        const path = `${dir}/${name}`;
        await db().storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
        return `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${BUCKET}/${path}`;
      };

      const overlay_pngs: Array<Record<string, unknown>> = [];
      let oi = 0;
      for (const el of elements) {
        const box = Array.isArray(el.box) && el.box.length === 4 ? el.box : null;
        if (el.kind === "text" && el.text && el.text.trim()) {
          try {
            const boxWnorm = box ? Math.abs(box[3] - box[1]) / 1000 : 0.4;
            const targetW = Math.max(200, Math.round(boxWnorm * 2048));
            const png = await renderTextOverlay(el.text.trim(), targetW);
            const url = await uploadPublic(`overlay_text_${oi++}_${slugify(el.text)}.png`, png);
            overlay_pngs.push({ url, kind: "text", role: el.text.trim(), box, editable: true });
          } catch (e: any) {
            console.warn(`[PANELGEN] text overlay render failed for "${el.text}": ${e?.message}`);
          }
        } else if (el.kind === "logo") {
          // A raster logo can't be re-rendered from a string — surface it as an
          // editable placeholder so the studio drops in the customer's logo asset.
          overlay_pngs.push({ url: "", kind: "logo", role: el.text || "logo", box, editable: true, placeholder: true });
        }
      }

      return out({
        success: true, jobId: jobTag,
        backgroundUrl, backgroundPath: "",
        overlaysUrl: "", overlaysPath: "",
        overlayMode: "isolated_text_render",
        overlay_pngs,
        boxesFound: elements.map((e) => ({ label: e.text || e.kind, box: e.box })),
      });
    }

    // ── STEP: panel — one print-ready panel at true dims + bleed ──
    if (step === "panel") {
      const designUrl: string = (body.designUrl || "").trim();
      const side: string = (body.side || "").trim();
      if (!designUrl || !side) return out({ success: false, error: "designUrl and side required" }, 400);
      const finish: string = body.finish || "Gloss";
      const bleed = Number(body.bleedInches) > 0 ? Number(body.bleedInches) : 5;
      const { d, source } = await lookupDims(body.vehicleMake || "", body.vehicleModel || "", String(body.vehicleYear || ""), (body.bodyType || "truck").toLowerCase());
      // Caller dims override — production sometimes cuts taller than the DB
      // body-panel height (e.g. side artwork at full vehicle height so the
      // installer trims instead of generative-filling upward).
      const ow = Number(body.panelWidthIn), oh = Number(body.panelHeightIn);
      const spec = (ow > 0 && oh > 0)
        ? { label: side.toUpperCase(), w: ow, h: oh }
        : (panelSet(d).find((p) => p.label === side.toUpperCase()) || { label: side.toUpperCase(), w: 200, h: 60 });
      const bw = spec.w + 2 * bleed, bh = spec.h + 2 * bleed;
      const ref = await fetchB64(designUrl);

      // PIXEL-EXACT: the panel is a CODE slice of the customer's artwork at
      // the panel's bleed-inclusive aspect — no AI pass, no regeneration.
      // Only resampling to print scale touches the pixels (standard prepress).
      if (body.pixelExact) {
        const original = await Image.decode(b64decode(ref.b64));
        // srcBox {x,y,w,h} (normalized 0..1): crop a REGION of the master first
        // — e.g. the canton (solid star field) for hood/roof panels — still
        // zero AI, just a different window before the aspect fit.
        const sb = body.srcBox;
        if (sb && Number(sb.w) > 0 && Number(sb.h) > 0) {
          const sx = Math.max(0, Math.round(Number(sb.x || 0) * original.width));
          const sy = Math.max(0, Math.round(Number(sb.y || 0) * original.height));
          const sw = Math.min(original.width - sx, Math.round(Number(sb.w) * original.width));
          const sh = Math.min(original.height - sy, Math.round(Number(sb.h) * original.height));
          if (sw > 8 && sh > 8) original.crop(sx, sy, sw, sh);
        }
        let pxW = Math.round(bw * 150), pxH = Math.round(bh * 150);
        const longest = Math.max(pxW, pxH);
        if (longest > 4000) { const k = 4000 / longest; pxW = Math.round(pxW * k); pxH = Math.round(pxH * k); }
        // cropAnchor:"top" keeps the artwork's top edge (e.g. star field over the
        // cab) — the centered default trimmed the canton top on tall side cuts.
        const sized = fitCover(original, pxW, pxH, body.cropAnchor === "top" ? "top" : "center");
        const u = await save(`panels/${spec.label.toLowerCase().replace(/\s+/g, "-")}.png`, await sized.encode());
        return out({
          success: true, jobId: jobTag, side: spec.label, url: u.url, path: u.path,
          trimWidthInches: spec.w, trimHeightInches: spec.h,
          printWidthInches: bw, printHeightInches: bh, bleedInches: bleed,
          scalePct: Math.round((pxW / (bw * 150)) * 1000) / 10, dimsSource: source, pixelExact: true,
          panels: panelSet(d).map((p) => ({ label: p.label, widthInches: p.w, heightInches: p.h })),
        });
      }

      const bytes = await img([
        { inlineData: { mimeType: ref.mime, data: ref.b64 } },
        { text: `Isolate the flat print panel for the ${spec.label} of this vehicle wrap design with zero artistic modification — absolute alignment, scale, and positions exactly as in the design. Render it as ONE full-bleed 2D panel, edge to edge. Finish: ${finish}. That side's flat artwork only.` },
      ], aspectOf(bw, bh), 0.0, "4K");
      if (!bytes) return out({ success: false, error: `${spec.label} panel failed — retry` }, 502);
      // 4K source → keep up to 4096px on the long edge (was 2048): doubles the
      // detail the print upscaler has to work with. ~38MB decoded, safe in 256MB.
      let pxW = Math.round(bw * 150), pxH = Math.round(bh * 150);
      const longest = Math.max(pxW, pxH);
      if (longest > 4096) { const k = 4096 / longest; pxW = Math.round(pxW * k); pxH = Math.round(pxH * k); }
      const sized = fitCover(await Image.decode(bytes), pxW, pxH);
      const u = await save(`panels/${spec.label.toLowerCase().replace(/\s+/g, "-")}.png`, await sized.encode());
      return out({
        success: true, jobId: jobTag, side: spec.label, url: u.url, path: u.path,
        trimWidthInches: spec.w, trimHeightInches: spec.h,
        printWidthInches: bw, printHeightInches: bh, bleedInches: bleed,
        scalePct: Math.round((pxW / (bw * 150)) * 1000) / 10, dimsSource: source,
        panels: panelSet(d).map((p) => ({ label: p.label, widthInches: p.w, heightInches: p.h })),
      });
    }

    // ── STEP: save — registrar only (zero image work) ──
    if (step === "save") {
      let userId: string = body.userId || "";
      if (!userId) {
        const ah = req.headers.get("Authorization");
        if (ah?.startsWith("Bearer ")) { try { const { data: { user } } = await db().auth.getUser(ah.replace("Bearer ", "")); if (user) userId = user.id; } catch { /**/ } }
      }
      const { error: jobErr } = await db().from("panel_artboard_jobs").upsert({
        id: jobTag, user_id: userId || null, status: "complete", mode: body.mode || null,
        prompt: body.prompt || null, reference_image_url: body.referenceImageUrl || null,
        vehicle_year: String(body.vehicleYear || ""), vehicle_make: body.vehicleMake || "", vehicle_model: body.vehicleModel || "",
        body_type: body.bodyType || null, finish: body.finish || null,
        bleed_inches: Number(body.bleedInches) || 5, dims_source: body.dimsSource || null,
        panels: body.panels || null, completed_at: new Date().toISOString(),
      });
      if (jobErr) return out({ success: false, error: `job save failed: ${jobErr.message}` }, 500);
      const rows: any[] = [];
      let sort = 0;
      for (const a of (Array.isArray(body.assets) ? body.assets : [])) {
        if (!a?.url || !a?.kind) continue;
        rows.push({
          job_id: jobTag, kind: String(a.kind), label: a.label || String(a.kind),
          panel_label: a.panelLabel || null, width_inches: a.widthInches ?? null, height_inches: a.heightInches ?? null,
          dpi: a.dpi ?? null, scale_pct: a.scalePct ?? null, box: a.box || null,
          storage_path: a.path || null, url: a.url, sort_order: sort++,
        });
      }
      if (rows.length) {
        const { error: aErr } = await db().from("panel_artboard_assets").insert(rows);
        if (aErr) return out({ success: false, error: `asset save failed: ${aErr.message}` }, 500);
      }
      console.log(`[PANELGEN] job ${jobTag} saved — ${rows.length} assets`);
      return out({ success: true, jobId: jobTag, assetCount: rows.length });
    }

    // ── STEP: production — the WHOLE doc chain, server-side, self-chaining. ──
    // One approved-view flatten + cut + Topaz + named print file + asset row
    // PER INVOCATION (keeps every run far inside the 256MB/wall-clock limits),
    // then re-invokes itself for the next side. Fired by customer approval
    // (proof-sign), the Build Print Files buttons, and Revision Studio.
    if (step === "production") {
      const views: Record<string, string> = body.views || {};
      const fallbackDesign: string = (body.designUrl || "").trim();
      // Artboard-first (2026-06-12): a human-approved flat artboard sheet, when
      // provided, outranks every other source — panels become pixel-match
      // SLICES of it (panelize-artboard) and the AI never repaints approved
      // artwork. The per-view flatten survives ONLY as the no-flat-source
      // fallback, and its output still faces the QC gate.
      const artboardUrl: string = (body.artboardUrl || "").trim();
      // The 2D proof already computed every tile's exact rectangle. When the
      // caller forwards them, panelize-artboard is handed the box instead of
      // running a vision pass to re-find it — and a side whose box is present
      // but whose slice fails is an honest gap, never an AI repaint.
      const proofTileBoxes: Record<string, number[]> =
        body.proofTileBoxes && typeof body.proofTileBoxes === "object" && !Array.isArray(body.proofTileBoxes)
          ? body.proofTileBoxes
          : {};
      const finish: string = body.finish || "gloss";
      const bleed = Number(body.bleedInches) > 0 ? Number(body.bleedInches) : 5;
      const panelDims: Record<string, { w: number; h: number }> = body.panelDims || {};
      const orderLabel: string = body.orderLabel || "Production order";
      const cursor: number = Number(body.cursor) || 0;
      const runTag: string = body.runTag || Date.now().toString(36);
      const prodJobId: string = body.productionJobId || crypto.randomUUID();

      // Plan: each panel sources its OWN approved view render (per-zone art —
      // hood stars stay on the hood); falls back to the flat design master.
      const VIEW_KEYS: Record<string, string[]> = {
        "DRIVER SIDE": ["side", "driver-side"],
        "PASSENGER SIDE": ["passenger-side", "side"],
        "HOOD": ["hood_detail", "hood"],
        "ROOF": ["roof"],
        "FRONT": ["front", "hero"],
        "REAR": ["rear"],
      };
      const plan = Object.keys(VIEW_KEYS)
        .map((side) => ({ side, view: VIEW_KEYS[side].map((k) => views[k]).find(Boolean) || "" }))
        .filter((p) => artboardUrl || p.view || fallbackDesign);
      if (!plan.length) return out({ success: false, error: "artboardUrl, views or designUrl required" }, 400);

      const { d, source: dimsSource } = await lookupDims(body.vehicleMake || "", body.vehicleModel || "", String(body.vehicleYear || ""), (body.bodyType || "truck").toLowerCase());
      const baseSpec = (side: string) => panelDims[side]
        ? { w: Number(panelDims[side].w), h: Number(panelDims[side].h) }
        : (panelSet(d).find((p) => p.label === side) || { w: 200, h: 60 });

      if (cursor === 0) {
        await db().from("panel_artboard_jobs").insert({
          id: prodJobId, user_id: body.userId || null, status: "processing", mode: "production",
          prompt: `${orderLabel} — AUTO production set (per-view flatten → pixel-exact cut, +${bleed}″ bleed)`,
          vehicle_year: String(body.vehicleYear || ""), vehicle_make: body.vehicleMake || "", vehicle_model: body.vehicleModel || "",
          body_type: body.bodyType || "truck", finish, bleed_inches: bleed, dims_source: dimsSource,
          panels: plan.map((p) => ({ label: p.side, ...baseSpec(p.side) })),
          // The sync cron re-kicks stalled chains from this stored context.
          production_ctx: {
            views, designUrl: fallbackDesign, vehicleMake: body.vehicleMake, vehicleModel: body.vehicleModel,
            vehicleYear: body.vehicleYear, bodyType: body.bodyType, finish, bleedInches: bleed,
            panelDims, orderLabel, runTag, userId: body.userId || null, planLen: plan.length,
            whitepoint: body.whitepoint === true, upscaleEngine: body.upscaleEngine || null, upscaleModel: body.upscaleModel || null,
            artboardUrl,
          },
        });
        // Idempotency marker for the approval sweep — one auto-build per proof.
        if (body.proofId) {
          await db().from("proof_events").insert({
            proof_id: body.proofId, event_type: "auto_print_files", actor_role: "system",
            payload: { job_id: prodJobId, status: "started" },
          });
        }
      }

      const publicUrl = (path: string) => `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${BUCKET}/${path}`;
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const selfHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };

      const runUnit = async () => {
        try {
          const unit = plan[cursor];
          const spec = baseSpec(unit.side);
          const bw = spec.w + 2 * bleed, bh = spec.h + 2 * bleed;

          // [3] SOURCE PRIORITY — artboard slice first (zero repaint). When a
          // human-approved artboard sheet is provided, this side is a
          // pixel-match SLICE of it: panelize-artboard detects the panel's
          // rectangle and CODE-crops it at the trim aspect + bleed. The AI
          // flatten below never runs in that case.
          let pxW = Math.round(bw * 150), pxH = Math.round(bh * 150);
          {
            const longest0 = Math.max(pxW, pxH);
            // 4K source panels (was 4000) — keep the long edge at 4096 so the
            // sliced panel is true 4K hi-res before the print upscaler runs.
            if (longest0 > 4096) { const k = 4096 / longest0; pxW = Math.round(pxW * k); pxH = Math.round(pxH * k); }
          }
          let cut: any = null;
          let slicedFromArtboard = false;
          if (artboardUrl) {
            try {
              // 4K source transform (was 3000) — the storage image-transform
              // resizes server-side, so the slicer only handles a 4096px image,
              // not a raw full-res decode. This is what makes the per-side source
              // panels come out at 4K hi-res instead of a soft 3K.
              const ab3k = artboardUrl.includes("/storage/v1/object/")
                ? artboardUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") + (artboardUrl.includes("?") ? "&" : "?") + "width=4096&height=4096&resize=contain&quality=92"
                : artboardUrl;
              const knownBox = proofTileBoxes[unit.side];
              const sl = await fetch(`${supabaseUrl}/functions/v1/panelize-artboard`, {
                method: "POST", headers: selfHeaders,
                body: JSON.stringify({
                  artboardUrl: ab3k, jobId: prodJobId, bleedIn: bleed,
                  panels: [{ side: unit.side, dimW: spec.w, dimH: spec.h }],
                  // Exact rect from the proof. Without it panelize-artboard runs
                  // detectBoxes, and the small unlabelled tiles (hood/roof/front/
                  // rear) come back "panel not located" — which is what sent this
                  // side into the AI flatten below.
                  ...(Array.isArray(knownBox)
                    ? { panelManifest: { version: 1, sourceKey: prodJobId, sourceUrl: ab3k, boxes: { [unit.side]: knownBox } } }
                    : {}),
                }),
                signal: AbortSignal.timeout(180_000),
              }).then((r) => r.json());
              const got = (sl?.panels || []).find((p: any) => p.panelUrl);
              if (got?.panelUrl) {
                let resp = await fetch(String(got.panelUrl).replace("/storage/v1/object/", "/storage/v1/render/image/") + (String(got.panelUrl).includes("?") ? "&" : "?") + "width=4096&height=4096&resize=contain&format=origin", { signal: AbortSignal.timeout(60_000) });
                if (!resp.ok) resp = await fetch(got.panelUrl, { signal: AbortSignal.timeout(60_000) });
                cut = await Image.decode(new Uint8Array(await resp.arrayBuffer()));
                pxW = cut.width; pxH = cut.height;
                slicedFromArtboard = true;
              } else if (Array.isArray(proofTileBoxes[unit.side])) {
                // The proof named this side's rectangle and the slice still
                // failed. Repainting it would ship invented artwork under a
                // deterministic-looking receipt, so this is a hard gap.
                throw new Error(`${unit.side}: proof region supplied but the artboard slice produced nothing — honest gap, not repainted`);
              } else {
                console.warn(`[PROD] ${unit.side}: not located on artboard (detected: ${JSON.stringify(sl?.detected || [])}) — falling back`);
              }
            } catch (e: any) {
              if (/honest gap/.test(String(e?.message || ""))) throw e;
              console.warn(`[PROD] ${unit.side} artboard slice error: ${e?.message} — falling back`);
            }
          }
          if (!cut) {
          // [3b] Anchored flatten from THIS side's approved render (one AI pass;
          // downscaled reference per the 546 rule). Fallback: the flat master.
          let flatBytes: Uint8Array;
          if (unit.view) {
            const small = unit.view.includes("/storage/v1/object/")
              ? unit.view.replace("/storage/v1/object/", "/storage/v1/render/image/") + (unit.view.includes("?") ? "&" : "?") + "width=1600&height=900&resize=contain&quality=85"
              : unit.view;
            const ref = await fetchB64(small);
            const got = await img([
              { inlineData: { mimeType: ref.mime, data: ref.b64 } },
              { text: `This reference is the approved on-vehicle render of the ${unit.side} of the vehicle. Flatten the wrap artwork shown on the vehicle into the full panel rectangle, keeping the exact element sizes, placement, colors, coverage, and flow seen on the vehicle. The approved artwork is the anchor — do not redesign, recompose, or invent elements; continue existing patterns naturally to the panel edges. Artwork only — absolutely no vehicle, wheels, glass, or background. Finish: ${finish}.` },
            ], "16:9", 0.0, "4K");
            if (!got) throw new Error(`${unit.side}: flatten failed`);
            flatBytes = got;
            await db().storage.from(BUCKET).upload(`panel-artboard/${prodJobId}/flats/${slugify(unit.side)}.png`, flatBytes, { contentType: "image/png", upsert: true });
          } else {
            const r = await fetch(fallbackDesign, { signal: AbortSignal.timeout(60_000) });
            if (!r.ok) throw new Error(`${unit.side}: design fetch ${r.status}`);
            flatBytes = new Uint8Array(await r.arrayBuffer());
          }

          // [5] Pixel-exact CODE cut at the bleed-inclusive aspect (no AI).
          // NEVER decode raw 4K AI bytes in imagescript (the documented 546):
          // re-fetch the just-uploaded flat through the storage transform,
          // whose re-encoded PNG decodes safely at full 4K detail.
          let cutSrc = flatBytes;
          if (unit.view) {
            try {
              const t = await fetch(`${supabaseUrl}/storage/v1/render/image/public/${BUCKET}/panel-artboard/${prodJobId}/flats/${slugify(unit.side)}.png?width=4000&height=4000&resize=contain&format=origin&cb=${Date.now()}`, { signal: AbortSignal.timeout(60_000) });
              if (t.ok) cutSrc = new Uint8Array(await t.arrayBuffer());
            } catch { /* fall back to raw bytes */ }
          }
          flatBytes = new Uint8Array(0); // release the raw 4K buffer before decode
          cut = fitCover(await Image.decode(cutSrc), pxW, pxH);
          } // end no-artboard fallback
          // [5w] whitepoint — chain-level near-white snap (same threshold-222
          // logic as the crop step, shared snapWhites helper) applied to the
          // cut panel BEFORE upload, so the print file's whites are unprinted
          // media instead of AI-warmed cream.
          if (body.whitepoint === true) {
            const snapped = snapWhites(cut);
            console.log(`[PROD] ${unit.side} whitepoint snapped ${snapped}px`);
          }
          const rawPath = `panel-artboard/${prodJobId}/panels/${slugify(unit.side)}.png`;
          await db().storage.from(BUCKET).upload(rawPath, await cut.encode(), { contentType: "image/png", upsert: true });

          // [5b] QC GATE — validate the cut panel against the APPROVED source
          // before anything registers. One automatic flatten retry on reject;
          // the verdict (pass or fail) is stored on the asset row so nothing
          // ships silently. We don't print files we can't trace to approval.
          let qc: any = null;
          const qcSource = unit.view || fallbackDesign || artboardUrl;
          const runValidate = async (): Promise<any> => {
            try {
              const r = await fetch(`${supabaseUrl}/functions/v1/panel-artboard-generator`, {
                method: "POST", headers: selfHeaders,
                body: JSON.stringify({
                  step: "validate", sourceUrl: qcSource, candidateUrl: publicUrl(rawPath),
                  what: `a flat print panel faithfully reproducing the ${unit.side} wrap artwork from the approved source — same colors, element scale, placement and flow; artwork only with no vehicle parts, glass, wheels or background`,
                }),
                signal: AbortSignal.timeout(90_000),
              });
              return await r.json();
            } catch (e: any) { return { success: false, error: e?.message }; }
          };
          if (qcSource) {
            qc = await runValidate();
            // NEVER let an AI flatten retry overwrite an artboard slice — a
            // failed-QC slice surfaces its flag for human eyes instead.
            if (qc?.success && qc.match === false && unit.view && !slicedFromArtboard) {
              console.warn(`[PROD] ${unit.side} QC reject (${qc.score}): ${(qc.issues || []).join("; ")} — one flatten retry`);
              const ref2 = await fetchB64(unit.view.includes("/storage/v1/object/")
                ? unit.view.replace("/storage/v1/object/", "/storage/v1/render/image/") + (unit.view.includes("?") ? "&" : "?") + "width=1600&height=900&resize=contain&quality=85"
                : unit.view);
              const retryGot = await img([
                { inlineData: { mimeType: ref2.mime, data: ref2.b64 } },
                { text: `This reference is the approved on-vehicle render of the ${unit.side} of the vehicle. Flatten the wrap artwork shown on the vehicle into the full panel rectangle, keeping the exact element sizes, placement, colors, coverage, and flow seen on the vehicle. The approved artwork is the anchor — do not redesign, recompose, or invent elements; continue existing patterns naturally to the panel edges. Artwork only — absolutely no vehicle, wheels, glass, or background. Finish: ${finish}.` },
              ], "16:9", 0.0, "4K");
              if (retryGot) {
                const recut = fitCover(await Image.decode(retryGot), pxW, pxH);
                if (body.whitepoint === true) snapWhites(recut); // recut overwrites rawPath — keep whites snapped
                await db().storage.from(BUCKET).upload(rawPath, await recut.encode(), { contentType: "image/png", upsert: true });
                const qc2 = await runValidate();
                qc = { ...(qc2?.success ? qc2 : qc), attempts: 2 };
              }
            }
            if (qc) { qc.validated_at = new Date().toISOString(); qc.attempts = qc.attempts || 1; delete qc.success; }
          }

          // [6] Print upscale — TOPAZ CGI primary (Trish's pick, 2026-06-12):
          // redraws graphic-art edges instead of magnifying their flaws; the
          // full 4K cut goes straight in (Topaz has no GPU input cap).
          // Fallback: ESRGAN-A100 8× from a GPU-cap-safe transform — never
          // block delivery.
          let printPath = rawPath, dpi = Math.round(pxW / bw);
          try {
            let up: any = null;
            let upPxW = pxW; // effective upscaled pixel width (drives the DPI on the asset row)
            try {
              up = await fetch(`${supabaseUrl}/functions/v1/upscale-production-panel`, {
                method: "POST", headers: selfHeaders,
                body: JSON.stringify({
                  // Topaz CGI declines inputs above ~3MP (proven: 3008px OK,
                  // 4000px refused) — feed it the 3008px transform of the cut.
                  image_url: `${publicUrl(rawPath).replace("/storage/v1/object/", "/storage/v1/render/image/")}?width=3008&height=3008&resize=contain&format=origin`,
                  engine: body.upscaleEngine || "topaz",
                  model: body.upscaleModel || "CGI",
                  scale: 6,
                  // 24k-px PNG outputs (~200MB) OOM the upscaler's buffered
                  // download; jpeg keeps them ~20MB. Print shops accept JPEG.
                  output_format: "jpeg",
                }),
                signal: AbortSignal.timeout(280_000),
              }).then((r) => r.json());
              if (up?.success && up?.upscaled_url) upPxW = pxW * (Number(up.achieved_scale) || 6);
              else { console.warn(`[PROD] ${unit.side} topaz-cgi upscale failed (${up?.error || "no upscaled_url"}) — esrgan fallback`); up = null; }
            } catch (e) { console.warn(`[PROD] ${unit.side} topaz-cgi upscale error (${(e as any)?.message}) — esrgan fallback`); up = null; }
            if (!up) {
              const capW = Math.floor(Math.sqrt(2_000_000 * (pxW / pxH)));
              const capUrl = `${publicUrl(rawPath).replace("/storage/v1/object/", "/storage/v1/render/image/")}?width=${capW}&height=${capW}&resize=contain&format=origin`;
              up = await fetch(`${supabaseUrl}/functions/v1/upscale-production-panel`, {
                method: "POST", headers: selfHeaders,
                body: JSON.stringify({ image_url: capUrl, engine: "esrgan-a100", scale: 8 }),
                signal: AbortSignal.timeout(240_000),
              }).then((r) => r.json());
              if (up?.success && up?.upscaled_url) upPxW = Math.min(pxW, capW) * 8;
            }
            if (up?.success && up?.upscaled_url) {
              // [7] Copy to the named print file in a per-run folder — fresh
              // storage paths every run, so the CDN can never serve stale art.
              const m = String(up.upscaled_url).match(/\/object\/public\/wrap-files\/(.+)$/);
              const upExt = String(up.upscaled_url).toLowerCase().endsWith(".jpg") ? "jpg" : "png";
              const toKey = `panel-artboard/${prodJobId}/print/${runTag}/${slugify(unit.side)}_${bw}x${bh}in.${upExt}`;
              const cp = await fetch(`${supabaseUrl}/functions/v1/storage-file-tools`, {
                method: "POST", headers: selfHeaders,
                body: JSON.stringify({ action: "copy", bucket: BUCKET, from: m ? decodeURIComponent(m[1]) : "", to: toKey }),
                signal: AbortSignal.timeout(120_000),
              }).then((r) => r.json());
              if (cp?.success) { printPath = toKey; dpi = Math.round(upPxW / bw); }
            }
          } catch (e) { console.error(`[PROD] ${unit.side} upscale/copy (non-fatal):`, (e as any)?.message); }

          // [8] Register the asset — with the machine QC verdict attached.
          await db().from("panel_artboard_assets").insert({
            job_id: prodJobId, kind: "panel",
            label: `${unit.side} — ${spec.w}×${spec.h} + ${bleed}″ bleed${artboardUrl ? " (artboard slice)" : unit.view ? " (view-true)" : ""}${qc?.match === true ? ` ✓ QC ${qc.score}` : qc?.match === false ? ` ⚠ QC ${qc.score}` : ""}`,
            panel_label: unit.side, width_inches: bw, height_inches: bh, dpi,
            storage_path: printPath, url: publicUrl(printPath), sort_order: cursor + 1,
            qc,
          });

          // [8b] (opt-in via body.vectorize — auto-vector made hard-edge
          // designs look like cartoons; only run when a RIP wants SVG) Auto-vectorize — fire-and-forget trace of the raw cut to SVG
          // (the hand-driven vectorize-it step). Non-fatal on failure; never
          // delays or blocks the chain.
          const vectorize = async () => {
            try {
              const vr = await fetch("https://www.restyleproai.com/api/vectorize-it", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  file_url: publicUrl(rawPath), file_name: `${slugify(unit.side)}.png`,
                  trace_mode: "detailed", order_number: orderLabel,
                }),
                signal: AbortSignal.timeout(180_000),
              });
              const vj = await vr.json().catch(() => ({}));
              if (vj?.output_url) {
                await db().from("panel_artboard_assets").insert({
                  job_id: prodJobId, kind: "design", label: `${unit.side} — VECTOR SVG`,
                  panel_label: unit.side, url: vj.output_url, sort_order: cursor + 40,
                });
                console.log(`[PROD] ${unit.side} vector SVG registered`);
              } else {
                console.warn(`[PROD] ${unit.side} vectorize (non-fatal): ${vj?.error || `HTTP ${vr.status}, no output_url`}`);
              }
            } catch (e: any) { console.warn(`[PROD] ${unit.side} vectorize (non-fatal): ${e?.message}`); }
          };
          if (body.vectorize === true) {
            const vrt = (globalThis as any).EdgeRuntime;
            if (vrt?.waitUntil) { vrt.waitUntil(vectorize()); }
            else { try { await vectorize(); } catch { /* non-fatal */ } }
          }

          if (cursor + 1 < plan.length) {
            // Chain the next side — serialized on purpose (parallel = 546).
            await fetch(`${supabaseUrl}/functions/v1/panel-artboard-generator`, {
              method: "POST", headers: selfHeaders,
              body: JSON.stringify({ ...body, step: "production", productionJobId: prodJobId, cursor: cursor + 1, runTag }),
            });
          } else {
            await db().from("panel_artboard_jobs").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", prodJobId);
            console.log(`[PROD] job ${prodJobId} complete (${plan.length} panels)`);
          }
        } catch (err: any) {
          console.error(`[PROD] job ${prodJobId} cursor ${cursor} failed:`, err?.message || err);
          await db().from("panel_artboard_jobs").update({ status: "failed" }).eq("id", prodJobId);
        }
      };

      const rt = (globalThis as any).EdgeRuntime;
      rt?.waitUntil ? rt.waitUntil(runUnit()) : await runUnit();
      return out({ success: true, status: "processing", productionJobId: prodJobId, cursor, of: plan.length }, 202);
    }

    // ── STEP: sync — the go-auto cron sweep (pg_cron, every 5 minutes). ──
    // 1) Re-kicks production chains that stalled mid-flight (waitUntil is not
    //    guaranteed on the edge runtime) from the exact cursor they died at.
    // 2) Starts a build for any APPROVED proof that has none yet — so a
    //    customer's approval ALWAYS produces print files even if the
    //    proof-sign kickoff was lost.
    if (step === "sync") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const selfHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
      const kicked: string[] = [];

      // 1) Stalled chains: processing >10 min with fewer assets than planned.
      const { data: stalled } = await db().from("panel_artboard_jobs")
        .select("id, production_ctx, created_at")
        .eq("mode", "production").eq("status", "processing")
        .lt("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
        .not("production_ctx", "is", null).limit(3);
      for (const j of stalled || []) {
        const ctx: any = j.production_ctx;
        const { count } = await db().from("panel_artboard_assets").select("id", { count: "exact", head: true }).eq("job_id", j.id);
        const done = count || 0;
        if (done >= Number(ctx?.planLen || 0)) {
          await db().from("panel_artboard_jobs").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", j.id);
        } else {
          await fetch(`${supabaseUrl}/functions/v1/panel-artboard-generator`, {
            method: "POST", headers: selfHeaders,
            body: JSON.stringify({ ...ctx, step: "production", productionJobId: j.id, cursor: done }),
          });
          kicked.push(`rekick:${j.id}@${done}`);
        }
      }

      if (isApproveProLive()) {
        // 2) Approved proofs with no build yet — ONLY where the customer PAID
        //    for the production pack (metadata.production_pack_paid, set by the
        //    payment webhook). Unpaid approvals never auto-build: the design
        //    team uses the Build Print Files buttons. Capped per sweep — each
        //    build costs real AI + Topaz money.
        const { data: approved } = await db().from("proof_approvals")
          .select("id, shop_id, vehicle_year, vehicle_make, vehicle_model, vehicle_type, finish_type, design_name, metadata, source_visualization_id")
          .eq("status", "approved")
          .or("metadata->>production_pack_paid.eq.true,metadata->>print_files_paid.eq.true")
          .gt("signed_at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
          .not("source_visualization_id", "is", null)
          .order("signed_at", { ascending: false }).limit(10);
        let started = 0;
        for (const p of approved || []) {
          if (started >= 2) break;
          const { data: prior } = await db().from("proof_events")
            .select("id").eq("proof_id", p.id).eq("event_type", "auto_print_files").limit(1).maybeSingle();
          if (prior) continue;
          const { data: viz } = await db().from("color_visualizations")
            .select("render_urls, finish_type, custom_design_url, admin_notes")
            .eq("id", p.source_visualization_id).maybeSingle();
          const pViews = (viz?.render_urls && typeof viz.render_urls === "object") ? viz.render_urls : {};
          let pDesign = "";
          try {
            const n = typeof viz?.admin_notes === "string" ? JSON.parse(viz.admin_notes) : (viz?.admin_notes || {});
            pDesign = n.layer_background_url || viz?.custom_design_url || "";
          } catch { pDesign = viz?.custom_design_url || ""; }
          if (!Object.keys(pViews).length && !pDesign) continue;
          await fetch(`${supabaseUrl}/functions/v1/panel-artboard-generator`, {
            method: "POST", headers: selfHeaders,
            body: JSON.stringify({
              step: "production", proofId: p.id, views: pViews, designUrl: pDesign,
              vehicleMake: p.vehicle_make, vehicleModel: p.vehicle_model, vehicleYear: String(p.vehicle_year || ""),
              bodyType: p.vehicle_type || "truck", finish: viz?.finish_type || p.finish_type || "gloss",
              userId: p.shop_id || null,
              orderLabel: `Order ${(p.metadata as any)?.wpw_order_number || p.design_name || String(p.id).slice(0, 8)} — APPROVED`,
            }),
          });
          kicked.push(`approved:${p.id}`);
          started++;
        }
        }
      return out({ success: true, kicked });
    }

    // ── STEP: artboard — the labeled PRODUCTION ARTBOARD sheet (deterministic). ──
    // "Like the 2D proof, but for production": every print panel laid flat on a
    // white sheet at true relative scale with NAME + W"xH" trim labels under
    // each box. No AI — forwards the job's registered print panels to
    // generate-artboard-flat (the deterministic composer) and registers /
    // refreshes the job's PRODUCTION ARTBOARD asset row.
    // Body: { step:"artboard", jobId, panels?:[{label,panelKey,widthInches,
    // heightInches}], views?:{driver-side|passenger-side|hood_detail|roof|rear|
    // front: url} } — panels/views default to the job's latest registered
    // print panel per side (registered dims include bleed; the composer adds
    // bleed back, so they convert to trim dims here).
    if (step === "artboard") {
      const jobId = String(body.jobId || body.job_id || "").trim();
      if (!jobId) return out({ success: false, error: "jobId is required" }, 400);
      const { data: abJob } = await db().from("panel_artboard_jobs")
        .select("id, vehicle_year, vehicle_make, vehicle_model, bleed_inches")
        .eq("id", jobId).maybeSingle();
      if (!abJob) return out({ success: false, error: `job ${jobId} not found` }, 404);
      const abBleed = Number(abJob.bleed_inches) > 0 ? Number(abJob.bleed_inches) : 5;

      // generate-artboard-flat's view picker keys (hood must be hood_detail —
      // a plain "hood" key silently falls back to the driver-side image).
      const VIEW_KEY: Record<string, string> = {
        "DRIVER SIDE": "driver-side", "PASSENGER SIDE": "passenger-side",
        "HOOD": "hood_detail", "ROOF": "roof", "REAR": "rear", "FRONT": "front",
      };
      const abPanels: any[] = Array.isArray(body.panels) ? [...body.panels] : [];
      const abViews: Record<string, string> = { ...(body.views || {}) };
      if (!abPanels.length) {
        const { data: assets } = await db().from("panel_artboard_assets")
          .select("kind, label, panel_label, width_inches, height_inches, url, sort_order")
          .eq("job_id", jobId).eq("kind", "panel").order("sort_order", { ascending: true });
        const latest = new Map<string, any>();
        for (const a of assets || []) {
          const key = String(a.panel_label || "").toUpperCase();
          if (!VIEW_KEY[key] || !(Number(a.width_inches) > 0)) continue;
          // Intermediate working layers are not the print art for the sheet.
          if (/starless/i.test(String(a.label || ""))) continue;
          latest.set(key, a); // ascending sort_order ⇒ last write = newest version
        }
        // Compose from the RAW pixel-exact crops when they exist — the
        // registered print assets are giant Topaz files the compositor's
        // 256MB worker cannot decode (instant 546 via the raw-URL fallback).
        const { data: rawList } = await db().storage.from(BUCKET).list(`panel-artboard/${jobId}/panels`);
        const rawNames = new Set((rawList || []).map((o: any) => o.name));
        const RAW_FILE: Record<string, string> = {
          "DRIVER SIDE": "driver-side.png", "PASSENGER SIDE": "passenger-side.png",
          "HOOD": "hood.png", "ROOF": "roof.png", "REAR": "rear.png", "FRONT": "front.png",
        };
        const supaUrl = Deno.env.get("SUPABASE_URL")!;
        for (const [key, a] of latest) {
          const friendly = String(a.label || key).split("—")[0].trim() || key;
          abPanels.push({
            label: friendly, panelKey: VIEW_KEY[key],
            widthInches: Math.max(1, Math.round((Number(a.width_inches) - abBleed * 2) * 10) / 10),
            heightInches: Math.max(1, Math.round((Number(a.height_inches) - abBleed * 2) * 10) / 10),
          });
          if (!abViews[VIEW_KEY[key]]) {
            // Cache-bust: these keys get overwritten on re-runs and the CDN
            // caches the old bytes (the stale-artboard bug).
            const src = rawNames.has(RAW_FILE[key])
              ? `${supaUrl}/storage/v1/object/public/${BUCKET}/panel-artboard/${jobId}/panels/${RAW_FILE[key]}`
              : a.url;
            if (src) abViews[VIEW_KEY[key]] = src + (String(src).includes("?") ? "&" : "?") + `cb=${Date.now()}`;
          }
        }
      }
      if (!abPanels.length) return out({ success: false, error: "no print panels registered on this job yet — run the panel/production step first" }, 400);

      const vehicleName = [abJob.vehicle_year, abJob.vehicle_make, abJob.vehicle_model].filter(Boolean).join(" ") || "Vehicle";
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const flatResp = await fetch(`${supabaseUrl}/functions/v1/generate-artboard-flat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        body: JSON.stringify({
          job_id: jobId, vehicle_name: vehicleName,
          approved_render_url: Object.values(abViews)[0] || "",
          allRenderUrls: abViews, panels: abPanels,
        }),
      });
      const flat = await flatResp.json().catch(() => ({}));
      if (!flat?.success) return out({ success: false, error: flat?.error || `generate-artboard-flat ${flatResp.status}` }, 502);

      const abPath = flat.storage_path || `artboards/${jobId}/artboard.png`;
      const abUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${abPath}?cb=${Date.now()}`;
      const { data: abExisting } = await db().from("panel_artboard_assets")
        .select("id").eq("job_id", jobId).eq("storage_path", abPath).limit(1).maybeSingle();
      if (abExisting) {
        await db().from("panel_artboard_assets").update({ url: abUrl }).eq("id", abExisting.id);
      } else {
        await db().from("panel_artboard_assets").insert({
          job_id: jobId, kind: "design", label: "PRODUCTION ARTBOARD — all panels, labeled + dimensioned",
          panel_label: "ARTBOARD", storage_path: abPath, url: abUrl, sort_order: 1,
        });
      }
      console.log(`[PANELGEN] artboard refreshed for ${jobId} — ${abPanels.length} panels`);
      return out({ success: true, jobId, artboardUrl: abUrl, panels: abPanels });
    }

    // ── STEP: crop — tight deterministic crop of any stored image (no AI). ──
    // Lifts individual elements (logos, text lockups) out of the transparent
    // overlays layer; crop-region's PNG stack OOMs on 2K alpha files, this
    // uses the same imagescript path the separate step already decodes with.
    // Body: { step:"crop", srcUrl|srcPath, box:[ymin,xmin,ymax,xmax] (0-1000),
    //         pad?: per-mille padding, outName, jobId }
    if (step === "crop") {
      const srcUrl = String(body.srcUrl || "")
        || (body.srcPath ? `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${BUCKET}/${body.srcPath}` : "");
      const bx: number[] = Array.isArray(body.box) ? body.box.map(Number) : [];
      const outName = String(body.outName || "crop.png");
      if (!srcUrl || bx.length !== 4) return out({ success: false, error: "srcUrl/srcPath and box[4] required" }, 400);
      const pad = Math.max(0, Number(body.pad) || 0);
      // removeBg: LayerLift FIRST — our own $0 magic-layers engine (lift +
      // alpha-key, no paid API). It takes the SOURCE url + percent bbox and
      // returns the element on transparency; on success the local decode
      // below never runs. Paid providers are last-resort fallbacks.
      // engine:"birefnet" skips LayerLift for busy backgrounds where the
      // local alpha-key leaves fragments (validator-driven retry path).
      if (body.removeBg === true && body.engine !== "birefnet") {
        try {
          const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const llBox = {
            xPct: Math.max(0, (bx[1] - pad) / 10),
            yPct: Math.max(0, (bx[0] - pad) / 10),
            wPct: Math.min(100, (bx[3] - bx[1] + pad * 2) / 10),
            hPct: Math.min(100, (bx[2] - bx[0] + pad * 2) / 10),
          };
          const ll = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/layerlift-engine`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${sk}` },
            body: JSON.stringify({
              imageUrl: srcUrl, boundingBox: llBox,
              elementType: body.elementType || "logo", elementLabel: outName,
            }),
            signal: AbortSignal.timeout(60_000),
          });
          const lj = await ll.json().catch(() => ({}));
          if (lj?.success && lj?.transparentPngUrl) {
            const tb = await fetch(lj.transparentPngUrl, { signal: AbortSignal.timeout(30_000) });
            if (tb.ok) {
              const saved = await save(outName, new Uint8Array(await tb.arrayBuffer()));
              console.log(`[PANELGEN] crop ${outName} via layerlift-engine`);
              return out({ success: true, jobId: jobTag, path: saved.path, url: saved.url, engine: "layerlift", cleanBackgroundUrl: lj.cleanBackgroundUrl || null });
            }
          }
          console.warn(`[PANELGEN] layerlift unavailable (${lj?.message || ll.status}) — falling back`);
        } catch (e: any) { console.warn(`[PANELGEN] layerlift error: ${e?.message} — falling back`); }
      }
      const ref = await fetchB64(srcUrl);
      const im = await Image.decode(b64decode(ref.b64));
      const y0 = Math.max(0, Math.round((bx[0] - pad) / 1000 * im.height));
      const x0 = Math.max(0, Math.round((bx[1] - pad) / 1000 * im.width));
      const y1 = Math.min(im.height, Math.round((bx[2] + pad) / 1000 * im.height));
      const x1 = Math.min(im.width, Math.round((bx[3] + pad) / 1000 * im.width));
      if (x1 - x0 < 8 || y1 - y0 < 8) return out({ success: false, error: "crop region too small" }, 400);
      im.crop(x0, y0, x1 - x0, y1 - y0);
      // whitepoint:true — snap near-neutral bright pixels to pure 255 white
      // and REPORT the count (shared snapWhites helper; see module scope).
      // snappedPct in the response is pixel ground truth for whether the
      // file's whites were actually warm.
      let snapped = 0;
      if (body.whitepoint === true) {
        const thr = Number(body.whiteThreshold) > 0 ? Number(body.whiteThreshold) : 222;
        snapped = snapWhites(im, thr);
      }
      // mirror:true — horizontal flip (imagescript has no flip()): passenger
      // panels are mirrored driver panels when the source mirror PNG is too
      // large for the transform endpoint (26MB+ → 400 → chain death).
      if (body.mirror === true) {
        const w = im.width, h = im.height, bmp = im.bitmap;
        for (let yy = 0; yy < h; yy++) {
          const row = yy * w * 4;
          for (let xx = 0; xx < w >> 1; xx++) {
            const i = row + xx * 4, j = row + (w - 1 - xx) * 4;
            for (let k = 0; k < 4; k++) { const t = bmp[i + k]; bmp[i + k] = bmp[j + k]; bmp[j + k] = t; }
          }
        }
      }
      let cropBytes = await im.encode();
      // removeBg:true — strip the background from the cropped region via
      // ClipDrop so the result is the SOURCE's real pixels on transparency.
      // This replaces the AI overlay repaint for element lifts: Gemini's
      // magenta-knockout layer REDRAWS lettering (melted/chopped strokes);
      // a pixel crop + segmentation never invents a single pixel.
      if (body.removeBg === true) {
        // Provider chain: in-house FIRST — Replicate BiRefNet (the bg-remover
        // we built to save money, same model quick-prep-bg-remove uses) —
        // then ClipDrop / remove.bg only as paid fallbacks. Fail only if
        // every available provider fails.
        let stripped: Uint8Array | null = null;
        const errs: string[] = [];
        const repKey = Deno.env.get("REPLICATE_API_TOKEN");
        if (repKey) {
          const tmpName = `tmp-bg-input-${Date.now()}.png`;
          try {
            const tmp = await save(tmpName, cropBytes);
            const pred = await fetch("https://api.replicate.com/v1/predictions", {
              method: "POST",
              headers: { Authorization: `Bearer ${repKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                version: "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
                input: { image: tmp.url },
              }),
              signal: AbortSignal.timeout(15_000),
            });
            if (pred.ok) {
              let p = await pred.json();
              for (let i = 0; i < 90 && (p.status === "starting" || p.status === "processing"); i++) {
                await new Promise((r) => setTimeout(r, 1000));
                const poll = await fetch(`https://api.replicate.com/v1/predictions/${p.id}`, {
                  headers: { Authorization: `Bearer ${repKey}` },
                });
                if (poll.ok) p = await poll.json();
              }
              const outUrl = typeof p.output === "string" ? p.output : (Array.isArray(p.output) ? p.output[0] : "");
              if (p.status === "succeeded" && outUrl) {
                const og = await fetch(outUrl, { signal: AbortSignal.timeout(30_000) });
                if (og.ok) stripped = new Uint8Array(await og.arrayBuffer());
                else errs.push(`replicate output fetch ${og.status}`);
              } else errs.push(`replicate ${p.status}${p.error ? `: ${p.error}` : ""}`);
            } else errs.push(`replicate ${pred.status}`);
          } catch (e: any) { errs.push(`replicate ${e?.message}`); }
          finally { try { await db().storage.from(BUCKET).remove([`${dir}/${tmpName}`]); } catch { /* temp cleanup best-effort */ } }
        }
        const cdKey = Deno.env.get("CLIPDROP_API_KEY");
        if (cdKey) {
          try {
            const fd = new FormData();
            fd.append("image_file", new Blob([cropBytes], { type: "image/png" }), "crop.png");
            const cd = await fetch("https://clipdrop-api.co/remove-background/v1", {
              method: "POST", headers: { "x-api-key": cdKey }, body: fd, signal: AbortSignal.timeout(40_000),
            });
            if (cd.ok) stripped = new Uint8Array(await cd.arrayBuffer());
            else errs.push(`clipdrop ${cd.status}`);
          } catch (e: any) { errs.push(`clipdrop ${e?.message}`); }
        }
        const rbKey = Deno.env.get("REMOVEBG_API_KEY");
        if (!stripped && rbKey) {
          try {
            const fd = new FormData();
            fd.append("image_file", new Blob([cropBytes], { type: "image/png" }), "crop.png");
            fd.append("size", "full");
            fd.append("format", "png");
            const rb = await fetch("https://api.remove.bg/v1.0/removebg", {
              method: "POST", headers: { "X-Api-Key": rbKey }, body: fd, signal: AbortSignal.timeout(40_000),
            });
            if (rb.ok) stripped = new Uint8Array(await rb.arrayBuffer());
            else errs.push(`remove.bg ${rb.status}`);
          } catch (e: any) { errs.push(`remove.bg ${e?.message}`); }
        }
        if (!stripped) return out({ success: false, error: `removeBg failed: ${errs.join("; ") || "no provider keys set"}` }, 502);
        cropBytes = stripped;
      }
      const saved = await save(outName, cropBytes);
      console.log(`[PANELGEN] crop ${outName} ${x1 - x0}x${y1 - y0} removeBg=${body.removeBg === true} from ${srcUrl.slice(0, 80)}`);
      const totalPx = (x1 - x0) * (y1 - y0);
      return out({ success: true, jobId: jobTag, path: saved.path, url: saved.url, width: x1 - x0, height: y1 - y0, snapped, snappedPct: totalPx > 0 ? Math.round(snapped / totalPx * 10000) / 100 : 0 });
    }

    // ── STEP: validate — the QC agent: VIEWS the produced file vs the source. ──
    // The pipeline's missing referee ("who can view and revise if it doesn't
    // match"): sends SOURCE + CANDIDATE to Gemini vision and returns a strict
    // machine verdict. Callers retry/re-produce on match:false instead of
    // shipping unreviewed files. Body: { step:"validate", sourceUrl,
    // candidateUrl, what?: criteria sentence }.
    if (step === "validate") {
      const vSrc = String(body.sourceUrl || "");
      const vCand = String(body.candidateUrl || "");
      const what = String(body.what || "the produced file faithfully reproduces the relevant artwork from the source");
      if (!vSrc || !vCand) return out({ success: false, error: "sourceUrl and candidateUrl required" }, 400);
      const vThumb = (u: string) => u.includes("/storage/v1/object/")
        ? u.replace("/storage/v1/object/", "/storage/v1/render/image/") + (u.includes("?") ? "&" : "?") + "width=1200&height=1200&resize=contain&quality=80"
        : u;
      const sImg = await fetchB64(vThumb(vSrc));
      const cImg = await fetchB64(vThumb(vCand));
      const vPrompt = `IMAGE 1 is the SOURCE (customer-approved design). IMAGE 2 is a PRODUCED FILE that must satisfy: ${what}. Inspect IMAGE 2 against IMAGE 1 as a print-production QC inspector. Check: completeness (nothing chopped or missing), letterforms/geometry identical to the source (no melted, warped, or reinvented strokes), faithful colors, no leftover background fragments or halos, no stretching or distortion. Return exclusively valid JSON: {"match": boolean, "score": number 0-100, "issues": [string], "verdict": string}.`;
      for (const m of [MODEL, MODEL_FALLBACK]) {
        try {
          const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey()}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [
                { inlineData: { mimeType: sImg.mime, data: sImg.b64 } },
                { inlineData: { mimeType: cImg.mime, data: cImg.b64 } },
                { text: vPrompt },
              ] }],
              generationConfig: { responseModalities: ["TEXT"], responseMimeType: "application/json", temperature: 0, topP: 1.0 },
            }),
            signal: AbortSignal.timeout(60_000),
          });
          if (!resp.ok) continue;
          const r = await resp.json();
          const txt = (r?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
          const verdict = JSON.parse(txt);
          console.log(`[PANELGEN] validate match=${verdict?.match} score=${verdict?.score}`);
          return out({ success: true, ...verdict });
        } catch (e: any) { console.error(`[PANELGEN] validate ${m} ${e?.message}`); }
      }
      return out({ success: false, error: "validator unavailable" }, 502);
    }

    // ── STEP: export — relay to the INTERNAL print exporter (Vercel sharp). ──
    // Brings a finished panel to the shop's print spec (75 DPI at true size —
    // beyond Topaz's 41MP ceiling on full sides) via api/export-flat-panel,
    // then registers the result on the job. Body: { step:"export", jobId,
    // imageUrl, widthIn, heightIn (bleed-inclusive), dpi?=75, side }.
    if (step === "export") {
      const exJob = String(body.jobId || "").trim();
      const exUrl = String(body.imageUrl || "");
      const exW = Number(body.widthIn), exH = Number(body.heightIn);
      const exDpi = Number(body.dpi) > 0 ? Number(body.dpi) : 75;
      const exSide = String(body.side || "panel");
      if (!exUrl || !(exW > 0) || !(exH > 0)) return out({ success: false, error: "imageUrl, widthIn, heightIn required" }, 400);
      const exporter = Deno.env.get("FLAT_PANEL_EXPORTER_URL") || "https://www.restyleproai.com/api/export-flat-panel";
      // Auth: service-role key first; SIDECAR_SECRET fallback. Vercel's
      // SUPABASE_SERVICE_ROLE_KEY env has a history of drifting out of sync
      // with the edge runtime's (see designpro-ensure-qc-job) — when the
      // string compare 401s, the shared sidecar secret still works.
      const exBody = JSON.stringify({
        image_url: exUrl, width_inches: exW, height_inches: exH, bleed_inches: 0,
        dpi: exDpi, view_name: `${slugify(exSide)}_${exDpi}dpi`, fit_mode: "cover",
      });
      const exCall = (tok: string) => fetch(exporter, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: exBody, signal: AbortSignal.timeout(120_000),
      });
      let r = await exCall(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      if (r.status === 401) {
        const sidecar = (Deno.env.get("SIDECAR_SECRET") || "").replace(/[^\x20-\x7E]/g, "").trim();
        if (sidecar) r = await exCall(sidecar);
      }
      const ex = await r.json().catch(() => ({}));
      if (!ex?.success || !ex?.url) return out({ success: false, error: ex?.error || `exporter ${r.status}` }, 502);
      if (exJob) {
        await db().from("panel_artboard_assets").insert({
          job_id: exJob, kind: "panel",
          label: `${exSide.toUpperCase()} — ${exW}×${exH} @ ${ex.effective_dpi || exDpi} DPI (internal print spec)`,
          panel_label: exSide.toUpperCase(), width_inches: exW, height_inches: exH,
          dpi: ex.effective_dpi || exDpi, storage_path: null, url: ex.url, sort_order: 50,
        });
      }
      return out({ success: true, jobId: exJob || null, url: ex.url, effectiveDpi: ex.effective_dpi || exDpi, pixelWidth: ex.pixel_width, pixelHeight: ex.pixel_height });
    }

    // ── STEP: sidefield / passengermirror — worker proxies ───────────────────
    // The two per-side steps the 256MB edge runtime cannot run itself live on
    // the Railway worker; these steps forward to it with the server-side
    // secret. (They were designed as their own `panel-side-field` function,
    // but the project is at its Supabase function cap — 402 on create — so
    // they ride in this existing function instead.)
    //   step:"sidefield"        → worker /clean-artboard  (per-side 4K clean
    //     field from that side's OWN view, field-QC gated — the sanctioned
    //     source for HOOD/ROOF/FRONT/REAR on recreate-class jobs)
    //   step:"passengermirror"  → worker /passenger-mirror (readable-text
    //     mirror of the driver panel; deterministic pixels)
    //   step:"paneljudge"       → worker /panel-qccheck (the per-panel QC
    //     verdict — relocated from panel-pro-extract, whose saturated 256MB
    //     isolate 546'd even solo judge calls; the proxy holds no memory)
    if (step === "sidefield" || step === "passengermirror" || step === "paneljudge") {
      const WORKER_URL = Deno.env.get("WORKER_URL");
      const WORKER_SECRET = Deno.env.get("WORKER_SECRET") || "genie-worker-2026";
      if (!WORKER_URL) return out({ success: false, error: "WORKER_URL is not configured" }, 500);
      const path = step === "passengermirror" ? "/passenger-mirror" : step === "paneljudge" ? "/panel-qccheck" : "/clean-artboard";
      const fwd = { ...body }; delete (fwd as any).step;
      const r = await fetch(`${WORKER_URL.replace(/\/+$/, "")}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${WORKER_SECRET}` },
        body: JSON.stringify(fwd),
        signal: AbortSignal.timeout(480_000),
      });
      const res = await r.json().catch(async () => ({ success: false, error: (await r.text()).slice(0, 300) }));
      return out(res, r.ok ? 200 : r.status);
    }

    // ── STEP: gridslice — DETERMINISTIC 1:1 geometric crop of artboardClean ──
    // The locked production path: NO AI, NO vision-only box detection, NO repaint.
    // Cover-crops the continuous artboard emitted by the 8th call
    // (generate-2d-proof) to ONE side's TRUE GENIE trim aspect by pure math
    // (no resize-fit distortion), scales to 150 PPI, and adds the mandatory
    // 5" exterior mirror bleed.
    //
    // Memory-bounded (256MB / status-546 guard): we fetch the artboardClean
    // through the storage image-transform at a capped edge (NEVER base64, NEVER a
    // raw 4K decode), decode the bytes directly, crop, and encode. We try a 4K
    // slice canvas first; on ANY decode/crop failure (the OOM symptom) we catch it
    // and fall back to a strictly smaller 3K canvas. The caller may also force the
    // smaller canvas via maxCanvas to survive a hard worker kill at 4K.
    //
    // Body: { step:"gridslice", artboardUrl (the 8th-call artboardClean), side,
    //         panelWidthIn, panelHeightIn (raw GENIE tokens), bleedInches?=2,
    //         jobId, cropAnchor?, maxCanvas?, whitepoint?, variant? }
    //
    // variant ("branded" | "clean" | any slug): OVERWRITE GUARD. Callers that
    // slice BOTH the branded and the clean source for the same side previously
    // wrote to the same fixed panels/<side>.png — whichever variant ran second
    // silently destroyed the first (ghost clean slices replaced good branded
    // panels in production). With variant set, the filename becomes
    // panels/<side>--<variant>.png so the two can coexist. Omitted → legacy
    // fixed path, so single-variant callers and the RAW_FILE default lookups
    // keep working unchanged.
    if (step === "gridslice") {
      const artUrl = String(body.artboardUrl || body.designUrl || "").trim();
      const side = String(body.side || "").trim();
      const W = Number(body.panelWidthIn), H = Number(body.panelHeightIn);
      if (!artUrl || !side) return out({ success: false, error: "artboardUrl and side required" }, 400);
      if (!(W > 0) || !(H > 0)) return out({ success: false, error: "panelWidthIn and panelHeightIn (raw GENIE tokens) required" }, 400);
      const bleed = Number(body.bleedInches) > 0 ? Number(body.bleedInches) : 5;
      const bw = W + 2 * bleed, bh = H + 2 * bleed;
      const anchor: "center" | "top" = body.cropAnchor === "top" ? "top" : "center";

      // Storage image-transform URL so the SERVER hands us a pre-downscaled copy
      // (format=origin keeps it a real, fully-decodable image). Non-storage URLs
      // pass through untouched.
      const transform = (px: number) => artUrl.includes("/storage/v1/object/")
        ? artUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") + (artUrl.includes("?") ? "&" : "?") + `width=${px}&height=${px}&resize=contain&format=origin`
        : artUrl;

      // 4K first, then a strict 3K fallback. maxCanvas lets the caller start at 3K.
      const requested = Number(body.maxCanvas) > 0 ? Number(body.maxCanvas) : 4000;
      const CAPS = [Math.min(4000, requested), 3000].filter((v, i, a) => a.indexOf(v) === i && v >= 1500);
      let lastErr = "";
      for (const cap of CAPS) {
        try {
          // Pull artboardClean at this cap — direct bytes, no base64 round-trip.
          let img: Image;
          const r = await fetch(transform(cap), { signal: AbortSignal.timeout(60_000) });
          if (r.ok) {
            img = await Image.decode(new Uint8Array(await r.arrayBuffer()));
          } else {
            // Transform unavailable for this object → raw, but only at the smaller
            // cap so a raw 4K never decodes (the documented 546).
            if (cap > 3000) throw new Error(`transform ${r.status}`);
            const rr = await fetch(artUrl, { signal: AbortSignal.timeout(60_000) });
            if (!rr.ok) throw new Error(`fetch ${rr.status}`);
            img = await Image.decode(new Uint8Array(await rr.arrayBuffer()));
          }
          // COVER-CROP AT THE TRUE TRIM ASPECT + MIRROR BLEED — the stretch fix.
          // OLD BUG: the full-design resize forced the WHOLE sheet into the
          // panel's shape (a 2.36:1 stamped sheet into a 3.6:1 driver panel
          // came out ~1.5× stretched). Now fitCover scales the sheet uniformly
          // to COVER the TRIM rect and crops the overscan (cropAnchor honored)
          // — correct proportions, same deterministic pixels. The crop aspect
          // is the TRIM aspect, never the bleed-inclusive one (that earlier
          // fitCover-at-2.94:1 sliced the navy off a 3.40:1 side), so a source
          // already at the side's aspect passes through uncropped; the bleed
          // stays a mirror of the edges. Pure geometry, no AI.
          const ppi = Math.min(150, cap / Math.max(bw, bh));
          const bleedPx = Math.max(0, Math.round(bleed * ppi));
          const tpxW = Math.max(1, Math.round(W * ppi)), tpxH = Math.max(1, Math.round(H * ppi));
          const trim = fitCover(img, tpxW, tpxH, anchor); // in-place (no clone — the 546 guard)
          const sized = mirrorExtend(trim, bleedPx);      // true 5" bleed, mirrored edges
          if (body.whitepoint === true) snapWhites(sized);
          const pxW = sized.width, pxH = sized.height;
          const variant = slugify(String(body.variant || "").trim());
          const u = await save(`panels/${slugify(side)}${variant ? `--${variant}` : ""}.png`, pngWithDpi(await sized.encode(), ppi, ppi));
          const effDpi = Math.round(ppi);
          console.log(`[PANELGEN] gridslice ${side} ${pxW}x${pxH} @${cap}px cap, ${effDpi}DPI (+${bleed}" bleed) — deterministic`);
          return out({
            success: true, jobId: jobTag, side: side.toUpperCase(), url: u.url, path: u.path,
            trimWidthInches: W, trimHeightInches: H,
            printWidthInches: bw, printHeightInches: bh, bleedInches: bleed,
            pixelWidth: pxW, pixelHeight: pxH, canvasCap: cap, effectiveDpi: effDpi, deterministic: true,
          });
        } catch (e: any) {
          lastErr = e?.message || String(e);
          console.warn(`[PANELGEN] gridslice ${side} @${cap}px failed: ${lastErr} — ${cap === CAPS[CAPS.length - 1] ? "giving up" : "falling back to 3K canvas"}`);
        }
      }
      return out({ success: false, error: `gridslice failed under memory bounds: ${lastErr}` }, 500);
    }

    // ── STEP: proofpanel — per-side 1:1 flatten FROM the real 2D proof ──
    // The 8th-call 2D proof (GENIE-panelizer-wired) already shows the correct
    // design for EVERY side. This feeds that proof to the AI and reproduces ONE
    // side as a flat, full-bleed print panel — a true 1:1 match of THAT side's
    // design (the hood graphic stays on the hood, etc.), sized to the side's raw
    // GENIE dimension tokens + 2" bleed. One side per call (256MB-safe).
    // Body: { step:"proofpanel", proofUrl, side, panelWidthIn, panelHeightIn,
    //         bleedInches?=2, finish?, jobId, maxCanvas? }
    if (step === "proofpanel") {
      const proofUrl = String(body.proofUrl || body.designUrl || "").trim();
      const side = String(body.side || "").trim();
      const W = Number(body.panelWidthIn), H = Number(body.panelHeightIn);
      if (!proofUrl || !side) return out({ success: false, error: "proofUrl and side required" }, 400);
      if (!(W > 0) || !(H > 0)) return out({ success: false, error: "panelWidthIn and panelHeightIn (raw GENIE tokens) required" }, 400);
      const finish = body.finish || "Gloss";
      const bleed = Number(body.bleedInches) > 0 ? Number(body.bleedInches) : 5;
      const bw = W + 2 * bleed, bh = H + 2 * bleed;
      // Feed a downscaled copy of the proof (never a raw 4K decode in the request).
      const proofThumb = proofUrl.includes("/storage/v1/object/")
        ? proofUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") + (proofUrl.includes("?") ? "&" : "?") + "width=2000&height=2000&resize=contain&quality=85"
        : proofUrl;
      const ref = await fetchB64(proofThumb);
      const prompt = `FLATTEN the ${side} wrap from this approved design into ONE flat, full-bleed rectangular PRINT PANEL: take the artwork off the vehicle's curved body and lay it out flat, edge to edge. KEEP the design's exact appearance — every color, gradient, internal shading, dimensional depth, metallic/gloss highlight, texture, graphic and piece of lettering exactly as shown. The artwork's OWN light and shadow ARE the design — preserve them fully; do NOT simplify, posterize, cartoon-ify, or wash them out. REMOVE everything that belongs to the vehicle or the photo: the body, wheels, windows, glass, bumpers, trim, background/studio, camera perspective, and ALL vehicle body lines, door seams, panel gaps, handle cutouts, wheel-arch curves and contour/edge shadows. Output ONLY the flat ${side} wrap artwork, as if printed on flat vinyl before application — no vehicle, no body lines, no background, no other views, no labels, no dimension lines, no white margins.`;
      // 2K (not 4K): decoding a raw 4K AI PNG + fitCover in-worker blows the
      // 256MB limit (status 546). 2K decodes safely; the Topaz production chain
      // upscales the base panel to print resolution downstream.
      const bytes = await img([
        { inlineData: { mimeType: ref.mime, data: ref.b64 } },
        { text: prompt },
      ], aspectOf(bw, bh), 0.0, "2K", { attempts: 2, timeoutMs: 65_000 });
      if (!bytes) return out({ success: false, error: `${side} proof-flatten failed — retry` }, 502);
      // Code crop to the exact bleed-inclusive aspect at 150 PPI, capped to a
      // memory-safe canvas (4K, or the caller's maxCanvas).
      const requested = Number(body.maxCanvas) > 0 ? Number(body.maxCanvas) : 4000;
      const cap = Math.min(4000, requested);
      let pxW = Math.round(bw * 150), pxH = Math.round(bh * 150);
      const longest = Math.max(pxW, pxH);
      if (longest > cap) { const k = cap / longest; pxW = Math.max(1, Math.round(pxW * k)); pxH = Math.max(1, Math.round(pxH * k)); }
      let sized: Image;
      try {
        sized = fitCover(await Image.decode(bytes), pxW, pxH, body.cropAnchor === "top" ? "top" : "center");
      } catch (e: any) {
        return out({ success: false, error: `${side} decode/crop failed: ${e?.message}` }, 500);
      }
      if (body.whitepoint === true) snapWhites(sized);
      const u = await save(`panels/${slugify(side)}.png`, await sized.encode());
      const effDpi = Math.round(pxW / bw);
      console.log(`[PANELGEN] proofpanel ${side} ${pxW}x${pxH} ${effDpi}DPI (+${bleed}" bleed) — 1:1 from 2D proof`);
      return out({
        success: true, jobId: jobTag, side: side.toUpperCase(), url: u.url, path: u.path,
        trimWidthInches: W, trimHeightInches: H,
        printWidthInches: bw, printHeightInches: bh, bleedInches: bleed,
        pixelWidth: pxW, pixelHeight: pxH, effectiveDpi: effDpi, source: "2d-proof",
      });
    }

    // ── STEP: mirrorpanel — PASSENGER = deterministic mirror of DRIVER ──
    // For a symmetric wrap, the passenger background is a pure 1:1 horizontal
    // reflection of the driver background — NO Gemini, NO independent gen, so the
    // two sides match across the vehicle exactly. Text/logos are then dropped
    // back on UN-FLIPPED (readable) at the mirrored X, so "QUALITY TIRE" reads
    // left-to-right on both sides instead of printing backward.
    // Body: { step:"mirrorpanel", backgroundUrl (driver clean/background asset),
    //   overlays?: [ { url, xPct, yPct, wPct, anchor?:"center"|"topleft" } ]
    //     (driver boxes; X is auto-mirrored here), side?="PASSENGER SIDE", jobId }
    if (step === "mirrorpanel") {
      const bgUrl = String(body.backgroundUrl || body.sourceUrl || body.designUrl || "").trim();
      const side = String(body.side || "PASSENGER SIDE").trim();
      const strictOverlays = body.strictOverlays === true;
      const requestedOverlayItems = Array.isArray(body.overlays) ? body.overlays : [];
      const requestedOverlays = requestedOverlayItems.length;
      let compositedOverlays = 0;
      const overlayErrors: Array<{ index: number; error: string }> = [];
      if (!bgUrl) return out({ success: false, error: "backgroundUrl (driver side asset) required" }, 400);
      // Pull the driver background through the storage transform (never a raw 4K
      // decode — the documented 546), then mirror it in place. No AI.
      const tThumb = bgUrl.includes("/storage/v1/object/")
        ? bgUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") + (bgUrl.includes("?") ? "&" : "?") + "width=4000&height=4000&resize=contain&format=origin"
        : bgUrl;
      let bg: Image;
      try {
        let r = await fetch(tThumb, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) r = await fetch(bgUrl, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) return out({ success: false, error: `driver bg fetch ${r.status}` }, 502);
        bg = await Image.decode(new Uint8Array(await r.arrayBuffer()));
      } catch (e: any) { return out({ success: false, error: `driver bg decode failed: ${e?.message}` }, 502); }

      flipH(bg);                                  // 1:1 horizontal reflection — perfect symmetry
      const pxW = bg.width, pxH = bg.height;

      // Text/logo overlays placed UN-FLIPPED (readable) at the mirrored X center.
      for (const [index, ov] of requestedOverlayItems.entries()) {
        if (!ov?.url) {
          overlayErrors.push({ index, error: "overlay URL missing" });
          continue;
        }
        try {
          const overlayResponse = await fetch(ov.url, { signal: AbortSignal.timeout(60_000) });
          if (!overlayResponse.ok) throw new Error(`overlay fetch ${overlayResponse.status}`);
          const o = await Image.decode(new Uint8Array(await overlayResponse.arrayBuffer()));
          const targetW = Math.max(1, Math.round((Number(ov.wPct) || 20) / 100 * pxW));
          o.resize(targetW, Math.max(1, Math.round(o.height * (targetW / o.width))));
          const driverCxPct = Number(ov.xPct);                 // driver overlay center, % of width
          const mirroredCxPct = isFinite(driverCxPct) ? 100 - driverCxPct : 50;  // reflect across center
          const cx = Math.round(mirroredCxPct / 100 * pxW);
          const cy = Math.round((Number(ov.yPct) || 50) / 100 * pxH);
          const x = ov.anchor === "topleft" ? cx : Math.round(cx - o.width / 2);
          const y = ov.anchor === "topleft" ? cy : Math.round(cy - o.height / 2);
          bg.composite(o, x, y);                                // un-flipped = reads correctly
          compositedOverlays += 1;
        } catch (e: any) {
          const error = String(e?.message || e);
          overlayErrors.push({ index, error });
          console.warn(`[PANELGEN] mirror overlay ${index} failed: ${error}`);
        }
      }

      if (
        strictOverlays &&
        (overlayErrors.length > 0 || compositedOverlays !== requestedOverlays)
      ) {
        return out({
          success: false,
          error: "One or more requested passenger overlays were not composited",
          strictOverlays,
          requestedOverlays,
          compositedOverlays,
          overlayErrors,
        }, 422);
      }

      const u = await save(`panels/${slugify(side)}.png`, await bg.encode());
      console.log(`[PANELGEN] mirrorpanel ${side} ${pxW}x${pxH} — 1:1 reflection of driver + readable overlays`);
      return out({
        success: true,
        jobId: jobTag,
        side: side.toUpperCase(),
        url: u.url,
        path: u.path,
        method: "mirror",
        deterministic: true,
        strictOverlays,
        requestedOverlays,
        compositedOverlays,
        overlayErrors,
      });
    }

    // ── STEP: composeflat — MAP FIRST, FLATTEN LAST (deterministic, NO AI) ──
    // For KNOWN graphics (flag, logos, eagle), the AI image model can't be
    // trusted with the print pixels — it can't count 13 stripes / 50 stars and
    // it bakes studio light into the whites. So we NEVER generate or flatten
    // these: we composite the EXACT supplied clean assets onto a blank flat
    // artboard at true GENIE dims. Result = 100% clean whites, exactly the right
    // stripes/stars, zero hallucinated pixels.
    // Body: { step:"composeflat", side, panelWidthIn, panelHeightIn, bleedInches?=2,
    //   ppi?=150, maxCanvas?=4000, jobId,
    //   background?: { url?, color?, fit?:"fill"|"tile" },         // clean real artwork (e.g. 13-stripe flag)
    //   overlays?: [ { url, xPct, yPct, wPct, anchor?:"center"|"topleft" } ] }  // clean PNGs (eagle, logos)
    if (step === "composeflat") {
      const side = String(body.side || "").trim();
      const W = Number(body.panelWidthIn), H = Number(body.panelHeightIn);
      if (!side) return out({ success: false, error: "side required" }, 400);
      if (!(W > 0) || !(H > 0)) return out({ success: false, error: "panelWidthIn and panelHeightIn required" }, 400);
      const bleed = Number(body.bleedInches) > 0 ? Number(body.bleedInches) : 5;
      const ppi = Number(body.ppi) > 0 ? Number(body.ppi) : 150;
      const bw = W + 2 * bleed, bh = H + 2 * bleed;
      const cap = Math.min(4000, Number(body.maxCanvas) > 0 ? Number(body.maxCanvas) : 4000);
      let pxW = Math.round(bw * ppi), pxH = Math.round(bh * ppi);
      const longest = Math.max(pxW, pxH);
      if (longest > cap) { const k = cap / longest; pxW = Math.max(1, Math.round(pxW * k)); pxH = Math.max(1, Math.round(pxH * k)); }
      const canvas = new Image(pxW, pxH);

      // Pull a clean asset through the storage transform when possible (never a
      // raw 4K decode); fall back to the original URL for external assets.
      const fetchAsset = async (u: string): Promise<Image> => {
        const t = u.includes("/storage/v1/object/")
          ? u.replace("/storage/v1/object/", "/storage/v1/render/image/") + (u.includes("?") ? "&" : "?") + `width=${cap}&height=${cap}&resize=contain&format=origin`
          : u;
        let r = await fetch(t, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) r = await fetch(u, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) throw new Error(`asset fetch ${r.status}`);
        return await Image.decode(new Uint8Array(await r.arrayBuffer()));
      };

      // 1) BACKGROUND — SOURCE FLAT then FLATTEN LAST. Canonical vault graphics
      // (e.g. the US flag) are DRAWN to fill the GENIE-dimension rectangle exactly
      // — never pulled from the malformed AI render. Otherwise a supplied clean
      // asset URL is geometrically fit (cover or tile). All deterministic, no AI.
      const bgSpec = body.background || {};
      const flagKind = String(bgSpec.flag || bgSpec.asset || "").toLowerCase();
      if (flagKind === "us" || flagKind === "us-flag" || flagKind === "american" || flagKind === "usa") {
        canvas.composite(drawUSFlag(pxW, pxH), 0, 0);        // mathematically-correct flat flag, fills the panel
      } else {
        if (bgSpec.color !== undefined && bgSpec.color !== null) canvas.fill((Number(bgSpec.color) >>> 0));
        if (bgSpec.url) {
          try {
            const b = await fetchAsset(String(bgSpec.url));
            if ((bgSpec.fit || "fill") === "tile") {
              for (let y = 0; y < pxH; y += b.height) for (let x = 0; x < pxW; x += b.width) canvas.composite(b, x, y);
            } else {
              canvas.composite(fitCover(b, pxW, pxH), 0, 0);   // cover-fill, keep aspect, full height
            }
          } catch (e: any) { return out({ success: false, error: `background compose failed: ${e?.message}` }, 502); }
        }
      }

      // 2) OVERLAYS — clean PNGs (true alpha) at mapped % coordinates.
      for (const ov of (Array.isArray(body.overlays) ? body.overlays : [])) {
        if (!ov?.url) continue;
        try {
          const o = await fetchAsset(String(ov.url));
          const targetW = Math.max(1, Math.round((Number(ov.wPct) || 20) / 100 * pxW));
          o.resize(targetW, Math.max(1, Math.round(o.height * (targetW / o.width))));
          const cxPct = isFinite(Number(ov.xPct)) ? Number(ov.xPct) : 50;
          const cyPct = isFinite(Number(ov.yPct)) ? Number(ov.yPct) : 50;
          const cx = Math.round(cxPct / 100 * pxW), cy = Math.round(cyPct / 100 * pxH);
          const x = ov.anchor === "topleft" ? cx : Math.round(cx - o.width / 2);
          const y = ov.anchor === "topleft" ? cy : Math.round(cy - o.height / 2);
          canvas.composite(o, x, y);                          // alpha-preserving, exact pixels
        } catch (e: any) { console.warn(`[PANELGEN] composeflat overlay failed: ${e?.message}`); }
      }

      const u = await save(`panels/${slugify(side)}.png`, pngWithDpi(await canvas.encode(), pxW / bw, pxH / bh));
      const effDpi = Math.round(pxW / bw);
      console.log(`[PANELGEN] composeflat ${side} ${pxW}x${pxH} ${effDpi}DPI — deterministic real-asset composite (zero AI pixels)`);
      return out({
        success: true, jobId: jobTag, side: side.toUpperCase(), url: u.url, path: u.path,
        printWidthInches: bw, printHeightInches: bh, bleedInches: bleed, effectiveDpi: effDpi,
        pixelWidth: pxW, pixelHeight: pxH, deterministic: true, method: "composeflat",
      });
    }

    // ── STEP: linetrace — transparent line-art trace of the DESIGN PROOF ───────
    // EDGE mode (sourceUrl given — the FLAT 2D design proof): edge-detect the
    // approved flat proof into a TRANSPARENT cyan line drawing (the design's
    // contours — flag stripes, stars, eagle, layout). Because the proof is FLAT
    // (orthographic), the trace overlays the flat artwork 1:1 to verify the design
    // is correct. Pure Sobel, no AI. We trace the PROOF, never a 3D render.
    // RECT mode (no sourceUrl): the geometric cut/bleed/ruler blueprint fallback.
    // Body: { step:"linetrace", side, sourceUrl?, threshold?, thickness?,
    //   panelWidthIn?, panelHeightIn?, bleedInches?=2, ppi?=150, maxCanvas?=3000, jobId }
    if (step === "linetrace") {
      const side = String(body.side || "PANEL").trim() || "PANEL";
      const src = body.sourceUrl || body.proofUrl || body.designUrl;
      // AI VISION TRACE — what Gemini Studio does: the vision model UNDERSTANDS
      // what's wrap vs vehicle, so it traces ONLY the wrap design (stars/stripes)
      // off the 3D render and drops the truck. This is a guide/outline (NOT print
      // pixels), so AI is fine here. Use for 3D sources where dumb edge-detect would
      // trace the whole vehicle.
      if (src && body.ai === true) {
        const acap = Math.min(2200, Number(body.maxCanvas) > 0 ? Number(body.maxCanvas) : 2000);
        const at = String(src).includes("/storage/v1/object/")
          ? String(src).replace("/storage/v1/object/", "/storage/v1/render/image/") + (String(src).includes("?") ? "&" : "?") + `width=${acap}&format=origin`
          : String(src);
        let ar = await fetch(at, { signal: AbortSignal.timeout(60_000) });
        if (!ar.ok) ar = await fetch(String(src), { signal: AbortSignal.timeout(60_000) });
        if (!ar.ok) return out({ success: false, error: `source fetch ${ar.status}` }, 502);
        const aBytes = new Uint8Array(await ar.arrayBuffer());
        const aDim = await Image.decode(aBytes);
        const aMime = ar.headers.get("content-type") || "image/png";
        const subj = String(body.subject || "the vehicle wrap graphic design").trim();
        const prompt = `Produce a clean BLACK line-art TRACE of ONLY ${subj} shown in this image — trace the exact shapes, outlines and internal boundaries of the WRAP ARTWORK itself (e.g. the flag's stars and the waving stripe edges). Crisp thin black outlines on a PURE WHITE background. ABSOLUTELY DO NOT trace or include the vehicle in any way: no body panels, doors, door handles, windows, mirrors, wheels, tires, bumpers, headlights, badges, reflections, studio, walls or floor — only the wrap design's own linework. Match the design exactly so it overlays the artwork 1:1. No shading, no fill, no color — black lines on white only.`;
        const bytes = await img([{ inlineData: { mimeType: aMime, data: b64encode(aBytes) } }, { text: prompt }], aspectOf(aDim.width, aDim.height), 0.2, "2K", { attempts: 2, timeoutMs: 65_000 });
        if (!bytes) return out({ success: false, error: `${side} AI trace failed — retry` }, 502);
        const u = await save(`traces/${slugify(side)}-aitrace.png`, bytes);
        console.log(`[PANELGEN] linetrace(AI) ${side} — wrap-only vision trace (vehicle excluded)`);
        return out({ success: true, jobId: jobTag, side: side.toUpperCase(), url: u.url, path: u.path, method: "linetrace-ai" });
      }
      if (src) {
        const cap = Math.min(2200, Number(body.maxCanvas) > 0 ? Number(body.maxCanvas) : 1800);
        const tt = String(src).includes("/storage/v1/object/")
          ? String(src).replace("/storage/v1/object/", "/storage/v1/render/image/") + (String(src).includes("?") ? "&" : "?") + `width=${cap}&format=origin`
          : String(src);
        let r = await fetch(tt, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) r = await fetch(String(src), { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) return out({ success: false, error: `proof fetch ${r.status}` }, 502);
        const im = await Image.decode(new Uint8Array(await r.arrayBuffer()));
        const w = im.width, h = im.height, bmp = im.bitmap;
        const gray = new Float32Array(w * h);
        for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = 0.299 * bmp[p] + 0.587 * bmp[p + 1] + 0.114 * bmp[p + 2];
        const trace = new Image(w, h);          // fully transparent
        const tb = trace.bitmap;
        const thr = Number(body.threshold) > 0 ? Number(body.threshold) : 95;
        const thick = Number(body.thickness) > 0 ? Number(body.thickness) : 2;
        // Line color — default PURE BLACK (overlay reference); cyan optional.
        const col = String(body.color || "black").toLowerCase() === "cyan" ? [0, 199, 255] : [0, 0, 0];
        let minX = w, minY = h, maxX = -1, maxY = -1;   // content bbox for auto-crop
        const put = (x: number, y: number) => {
          for (let dy = 0; dy < thick; dy++) for (let dx = 0; dx < thick; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < w && yy < h) {
              const o = (yy * w + xx) * 4; tb[o] = col[0]; tb[o + 1] = col[1]; tb[o + 2] = col[2]; tb[o + 3] = 255;
              if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
            }
          }
        };
        for (let y = 1; y < h - 1; y++)
          for (let x = 1; x < w - 1; x++) {
            const tl = gray[(y - 1) * w + (x - 1)], tc = gray[(y - 1) * w + x], tr2 = gray[(y - 1) * w + (x + 1)];
            const ml = gray[y * w + (x - 1)], mr = gray[y * w + (x + 1)];
            const bl = gray[(y + 1) * w + (x - 1)], bc = gray[(y + 1) * w + x], br = gray[(y + 1) * w + (x + 1)];
            const gx = -tl - 2 * ml - bl + tr2 + 2 * mr + br;
            const gy = -tl - 2 * tc - tr2 + bl + 2 * bc + br;
            if (Math.sqrt(gx * gx + gy * gy) > thr) put(x, y);
          }
        // FULL-PANEL trace (body.fullPanel:true) — trace the WHOLE panel, not just
        // the center graphic. Keeps the entire panel extent (no autocrop) AND
        // strokes the outer panel/cut boundary so the result shows the full panel
        // rectangle + all interior artwork edges. Fixes "the trace just shows
        // center": a panel with a central graphic on a flat body-color field has
        // no edge gradient at its borders, so edge-detect + autocrop collapsed to
        // the middle. Default (no flag) is unchanged — autocrop to the artwork bbox.
        const fullPanel = body.fullPanel === true;
        if (fullPanel) {
          for (let x = 0; x < w; x++) { put(x, 0); put(x, Math.max(0, h - thick)); }
          for (let y = 0; y < h; y++) { put(0, y); put(Math.max(0, w - thick), y); }
        }
        // Auto-crop to the traced content so it isn't floating in empty space.
        if (!fullPanel && body.autocrop !== false && maxX >= minX && maxY >= minY) {
          const pad = 2;
          const cx = Math.max(0, minX - pad), cy = Math.max(0, minY - pad);
          const cw = Math.min(w - cx, (maxX - minX + 1) + pad * 2), ch = Math.min(h - cy, (maxY - minY + 1) + pad * 2);
          trace.crop(cx, cy, cw, ch);
        }
        const u = await save(`traces/${slugify(side)}-trace.png`, await trace.encode());
        console.log(`[PANELGEN] linetrace(edge) ${side} ${trace.width}x${trace.height} thr=${thr} ${col[0] === 0 ? "black" : "cyan"} — transparent trace`);
        return out({
          success: true, jobId: jobTag, side: side.toUpperCase(), url: u.url, path: u.path,
          pixelWidth: trace.width, pixelHeight: trace.height, transparent: true, method: "linetrace-edge",
        });
      }
      const W = Number(body.panelWidthIn), H = Number(body.panelHeightIn);
      if (!(W > 0) || !(H > 0)) return out({ success: false, error: "panelWidthIn and panelHeightIn required (or pass sourceUrl to trace the proof)" }, 400);
      const bleed = Number(body.bleedInches) > 0 ? Number(body.bleedInches) : 5;
      const ppi = Number(body.ppi) > 0 ? Number(body.ppi) : 150;
      const bw = W + 2 * bleed, bh = H + 2 * bleed;
      const cap = Math.min(4000, Number(body.maxCanvas) > 0 ? Number(body.maxCanvas) : 3000);
      let pxW = Math.round(bw * ppi), pxH = Math.round(bh * ppi);
      const longest = Math.max(pxW, pxH);
      if (longest > cap) { const k = cap / longest; pxW = Math.max(1, Math.round(pxW * k)); pxH = Math.max(1, Math.round(pxH * k)); }
      const eff = pxW / bw;                                   // px per inch after the cap
      const trace = new Image(pxW, pxH);                      // fully transparent
      const CYAN = Image.rgbaToColor(0, 199, 255, 255);       // brand cyan — cut line + major ticks
      const CYAN_SOFT = Image.rgbaToColor(0, 199, 255, 120);  // guides
      const MAG = Image.rgbaToColor(236, 72, 153, 255);       // bleed boundary
      const inset = Math.round(bleed * eff);
      const tw = pxW - 2 * inset, th = pxH - 2 * inset;       // trim = the TRUE panel rectangle
      const tk = Math.max(2, Math.round(eff * 0.04));         // line thickness scales with size
      // Bleed boundary (dashed magenta, full canvas edge).
      dashedH(trace, 0, pxW - 1, 0, MAG, 26, 18, tk); dashedH(trace, 0, pxW - 1, pxH - tk, MAG, 26, 18, tk);
      dashedV(trace, 0, 0, pxH - 1, MAG, 26, 18, tk); dashedV(trace, pxW - tk, 0, pxH - 1, MAG, 26, 18, tk);
      // Trim / cut line (solid cyan, thick) — where the rectangle panel is cut.
      rectOutline(trace, inset, inset, tw, th, CYAN, tk + 2);
      // Safe area, 2" inside the trim (dashed soft) — keep key art inside this.
      const safe = Math.round(2 * eff);
      dashedH(trace, inset + safe, inset + tw - safe, inset + safe, CYAN_SOFT, 18, 12, tk);
      dashedH(trace, inset + safe, inset + tw - safe, inset + th - safe, CYAN_SOFT, 18, 12, tk);
      dashedV(trace, inset + safe, inset + safe, inset + th - safe, CYAN_SOFT, 18, 12, tk);
      dashedV(trace, inset + tw - safe, inset + safe, inset + th - safe, CYAN_SOFT, 18, 12, tk);
      // Center crosshair + rule-of-thirds.
      const cx = inset + Math.round(tw / 2), cy = inset + Math.round(th / 2);
      vLine(trace, cx, inset, inset + th, CYAN_SOFT, Math.max(1, tk - 1));
      hLine(trace, inset, inset + tw, cy, CYAN_SOFT, Math.max(1, tk - 1));
      for (const f of [1 / 3, 2 / 3]) {
        vLine(trace, inset + Math.round(tw * f), inset, inset + th, CYAN_SOFT, 1);
        hLine(trace, inset, inset + tw, inset + Math.round(th * f), CYAN_SOFT, 1);
      }
      // Inch ruler ticks inside the trim edges (1"=minor, 6"=medium, 12"=major).
      for (let i = 0; i <= Math.floor(W); i++) {
        const x = inset + Math.round(i * eff);
        const len = i % 12 === 0 ? Math.round(0.9 * eff) : i % 6 === 0 ? Math.round(0.55 * eff) : Math.round(0.28 * eff);
        const t = i % 12 === 0 ? tk + 1 : 1;
        vLine(trace, x, inset, inset + len, CYAN, t);
        vLine(trace, x, inset + th - len, inset + th, CYAN, t);
      }
      for (let j = 0; j <= Math.floor(H); j++) {
        const y = inset + Math.round(j * eff);
        const len = j % 12 === 0 ? Math.round(0.9 * eff) : j % 6 === 0 ? Math.round(0.55 * eff) : Math.round(0.28 * eff);
        const t = j % 12 === 0 ? tk + 1 : 1;
        hLine(trace, inset, inset + len, y, CYAN, t);
        hLine(trace, inset + tw - len, inset + tw, y, CYAN, t);
      }
      const u = await save(`traces/${slugify(side)}-trace.png`, await trace.encode());
      console.log(`[PANELGEN] linetrace ${side} ${pxW}x${pxH} (trim ${W}x${H}+${bleed}bleed) — transparent alignment blueprint`);
      return out({
        success: true, jobId: jobTag, side: side.toUpperCase(), url: u.url, path: u.path,
        trimWidthInches: W, trimHeightInches: H, printWidthInches: bw, printHeightInches: bh,
        bleedInches: bleed, pixelWidth: pxW, pixelHeight: pxH, effectiveDpi: Math.round(eff),
        transparent: true, method: "linetrace",
      });
    }

    // ── STEP: inpaint — COLOR IN the exact trace (do not reinvent) ─────────────
    // Takes the line-art TRACE and fills it with flat color, geometry-locked: every
    // line, star and stripe stays EXACTLY where the trace has it (like coloring a
    // coloring page). This guarantees the finished art registers 1:1 with the trace
    // — the system inpaints the actual trace instead of regenerating a new design.
    // Body: { step:"inpaint", traceUrl, side, panelWidthIn, panelHeightIn,
    //   bleedInches?=2, subject?, palette?, colorRefUrl?, jobId, maxCanvas? }
    if (step === "inpaint") {
      // SPATIAL PROJECTION FILL (Stage 2): project the ORIGINAL design's real pixels
      // flat, edge-to-edge, into the rectangle — guided by the line-art trace for
      // layout. Conditioned on the source image so it reproduces the real colors/
      // graphics (no invented palette), and told to break out of the vehicle shape.
      const traceUrl = String(body.traceUrl || "").trim();
      const sourceUrl = String(body.sourceUrl || body.designUrl || "").trim();   // the ORIGINAL design (3D/flat)
      const side = String(body.side || "PANEL").trim() || "PANEL";
      const W = Number(body.panelWidthIn), H = Number(body.panelHeightIn);
      if (!sourceUrl && !traceUrl) return out({ success: false, error: "sourceUrl (the original design) or traceUrl required" }, 400);
      if (!(W > 0) || !(H > 0)) return out({ success: false, error: "panelWidthIn and panelHeightIn required" }, 400);
      const bleed = Number(body.bleedInches) > 0 ? Number(body.bleedInches) : 5;
      const bw = W + 2 * bleed, bh = H + 2 * bleed;
      const thumb = (u: string, px = 2000) => u.includes("/storage/v1/object/")
        ? u.replace("/storage/v1/object/", "/storage/v1/render/image/") + (u.includes("?") ? "&" : "?") + `width=${px}&height=${px}&resize=contain&quality=90`
        : u;
      const parts: any[] = [];
      // Order matters: text first, then the ORIGINAL design (pixel source), then the trace (layout guide).
      const hasSource = !!sourceUrl, hasTrace = !!traceUrl;
      const prompt = `You are a strict, non-generative texture PROJECTION engine — not an artist.${hasSource ? ` The FIRST image is the ORIGINAL approved design: its real colors, gradients, textures and graphics are the ground truth.` : ""}${hasTrace ? ` The ${hasSource ? "SECOND" : "FIRST"} image is a black-and-white line-art layout guide.` : ""} Project the EXACT design${hasSource ? " from the original image" : ""} FLAT across the ENTIRE rectangular canvas${hasTrace ? ", using the line-art only as the spatial layout map" : ""} — scaled and tiled to fill edge-to-edge, every element terminating sharply at all four borders. REPRODUCE the original design's exact appearance: do NOT invent, restyle, recolor, add, or remove anything. Do NOT clip, mask, or constrain the artwork to a truck / car / vehicle silhouette or panel shape — break out of any vehicle outline and fill the whole rectangle. Output ONLY a solid, flat, uniform 2D rectangular print block of the design — absolutely no vehicle, wheels, doors, windows, mirrors, bumpers, perspective, shadows, lighting glare, or background.`;
      parts.push({ text: prompt });
      if (hasSource) { const s = await fetchB64(thumb(sourceUrl)); parts.push({ inlineData: { mimeType: s.mime, data: s.b64 } }); }
      if (hasTrace) { const t = await fetchB64(thumb(traceUrl)); parts.push({ inlineData: { mimeType: t.mime, data: t.b64 } }); }
      const bytes = await img(parts, aspectOf(bw, bh), 0.0, "2K", { attempts: 2, timeoutMs: 65_000 });
      if (!bytes) return out({ success: false, error: `${side} projection fill failed — retry` }, 502);
      const cap = Math.min(4000, Number(body.maxCanvas) > 0 ? Number(body.maxCanvas) : 4000);
      let pxW = Math.round(bw * 150), pxH = Math.round(bh * 150);
      const longest = Math.max(pxW, pxH);
      if (longest > cap) { const k = cap / longest; pxW = Math.max(1, Math.round(pxW * k)); pxH = Math.max(1, Math.round(pxH * k)); }
      const sized = fitCover(await Image.decode(bytes), pxW, pxH);
      const u = await save(`panels/${slugify(side)}-inpaint.png`, await sized.encode());
      const effDpi = Math.round(pxW / bw);
      console.log(`[PANELGEN] inpaint ${side} ${pxW}x${pxH} ${effDpi}DPI — colored the trace (geometry-locked)`);
      return out({
        success: true, jobId: jobTag, side: side.toUpperCase(), url: u.url, path: u.path,
        printWidthInches: bw, printHeightInches: bh, bleedInches: bleed,
        pixelWidth: pxW, pixelHeight: pxH, effectiveDpi: effDpi, method: "inpaint",
      });
    }

    // ── STEP: ingest — store a supplied asset (base64 or URL) in the vault ─────
    // Lets externally-prepared clean assets (e.g. a flat waving-flag PNG + its
    // line trace made in Gemini studio) be saved into the design's asset vault and
    // returned as a stable URL, so composeflat / the overlay pipeline can use them.
    // Body: { step:"ingest", jobId, dataB64? , sourceUrl?, name?, mime? }
    if (step === "ingest") {
      const name = slugify(String(body.name || `asset-${Date.now()}`)) || `asset-${Date.now()}`;
      const mime = String(body.mime || "image/png");
      const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
      let bytes: Uint8Array | null = null;
      if (body.dataB64) {
        try { bytes = b64decode(String(body.dataB64).replace(/^data:[^,]+,/, "")); }
        catch (e: any) { return out({ success: false, error: `bad base64: ${e?.message}` }, 400); }
      } else if (body.sourceUrl) {
        const r = await fetch(String(body.sourceUrl), { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) return out({ success: false, error: `ingest fetch ${r.status}` }, 502);
        bytes = new Uint8Array(await r.arrayBuffer());
      }
      if (!bytes || !bytes.length) return out({ success: false, error: "dataB64 or sourceUrl required" }, 400);
      const ipath = `${dir}/vault/${name}.${ext}`;
      const { error: upErr } = await db().storage.from(BUCKET).upload(ipath, bytes, { contentType: mime, upsert: true });
      if (upErr) return out({ success: false, error: `ingest upload: ${upErr.message}` }, 502);
      const { data: signed } = await db().storage.from(BUCKET).createSignedUrl(ipath, SIGNED_TTL);
      console.log(`[PANELGEN] ingest ${name}.${ext} ${bytes.length}B → ${ipath}`);
      return out({ success: true, jobId: jobTag, name, url: signed?.signedUrl || "", path: ipath, bytes: bytes.length, method: "ingest" });
    }

    // ── STEP: qcproof — human validation gate (deterministic, NO AI) ───────────
    // Ghosts the alignment trace over the flat artwork so a reviewer can confirm
    // the design lines up inside the panel bounds before it goes to print. Pure
    // ImageScript composite — touches nothing, generates nothing.
    // Body: { step:"qcproof", flatUrl|artworkUrl, traceUrl, opacity?=0.4, jobId }
    if (step === "qcproof") {
      const flatUrl = String(body.flatUrl || body.artworkUrl || "").trim();
      const traceUrl = String(body.traceUrl || "").trim();
      if (!flatUrl || !traceUrl) return out({ success: false, error: "flatUrl and traceUrl required" }, 400);
      const op = Number(body.opacity) > 0 && Number(body.opacity) <= 1 ? Number(body.opacity) : 0.4;
      const grab = async (u: string): Promise<Image> => {
        const t = u.includes("/storage/v1/object/")
          ? u.replace("/storage/v1/object/", "/storage/v1/render/image/") + (u.includes("?") ? "&" : "?") + "width=2400&height=2400&resize=contain&format=origin"
          : u;
        let r = await fetch(t, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) r = await fetch(u, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) throw new Error(`fetch ${r.status}`);
        return await Image.decode(new Uint8Array(await r.arrayBuffer()));
      };
      let art: Image, wire: Image;
      try { art = await grab(flatUrl); wire = await grab(traceUrl); }
      catch (e: any) { return out({ success: false, error: `qcproof fetch: ${e?.message}` }, 502); }
      wire.resize(art.width, art.height);          // match bounds
      try { (wire as any).opacity(op); }           // ghost the trace
      catch { for (let i = 3; i < wire.bitmap.length; i += 4) wire.bitmap[i] = Math.round(wire.bitmap[i] * op); }
      art.composite(wire, 0, 0);                    // trace HUD over the flat artwork
      const u = await save(`qc/${slugify(String(body.side || "panel"))}-qcproof.png`, await art.encode());
      console.log(`[PANELGEN] qcproof ${art.width}x${art.height} op=${op} — trace ghosted over flat (deterministic)`);
      return out({ success: true, jobId: jobTag, url: u.url, path: u.path, pixelWidth: art.width, pixelHeight: art.height, method: "qcproof" });
    }

    // ── STEP: upscale — Stage 4 print-density upscale via Topaz (DIFFERENT model) ─
    // Routes a finished flat print panel through the Topaz Image Enhance API to hit
    // true large-format density. Uses a model DIFFERENT from the rest of the chain's
    // default ("Standard V2"): defaults to "High Fidelity V2" (edge/detail-preserving,
    // safe for text & photos — no hallucination), overridable via body.model to any
    // model the account supports (e.g. a Max/generative engine). Targets the exact
    // print width = widthInches × targetDpi, clamped to Topaz's 32,000px / 6× ceiling.
    // Body: { step:"upscale", sourceUrl, widthInches?, heightInches?, targetDpi?=150, model?, jobId, side? }
    if (step === "upscale") {
      const srcUrl = String(body.sourceUrl || body.flatUrl || body.artworkUrl || "").trim();
      if (!srcUrl) return out({ success: false, error: "sourceUrl required" }, 400);
      const dpi = Number(body.targetDpi) > 0 ? Number(body.targetDpi) : 150;
      const model = String(body.model || "High Fidelity V2");
      let r = await fetch(srcUrl, { signal: AbortSignal.timeout(90_000) });
      if (!r.ok) return out({ success: false, error: `source fetch ${r.status}` }, 502);
      const inBytes = new Uint8Array(await r.arrayBuffer());
      const mime = r.headers.get("content-type") || "image/png";
      // Scale to hit the exact print width when physical inches are given; else 4×.
      let scale = 4;
      try {
        if (Number(body.widthInches) > 0) {
          const dec = await Image.decode(inBytes);
          const targetW = Math.min(32_000, Math.round(Number(body.widthInches) * dpi));
          scale = Math.max(1, Math.min(6, targetW / dec.width));
        }
      } catch { /* keep default scale on decode hiccup */ }
      const res = await upscaleImageBytes(inBytes, mime, db(), {
        scale, passes: 1, model, userId: "system",
        label: `print-${slugify(String(body.side || "panel"))}`, timeoutMs: 120_000, outputFormat: "png",
      });
      const u = await save(`upscaled/${slugify(String(body.side || "panel"))}-${dpi}dpi.png`, res.imageBytes);
      console.log(`[PANELGEN] upscale ${model} ${scale.toFixed(2)}x → ${u.path} (upscaled=${res.upscaled})`);
      return out({
        success: true, jobId: jobTag, url: u.url, path: u.path,
        model, scale: Number(scale.toFixed(2)), targetDpi: dpi, upscaled: res.upscaled, method: res.method,
      });
    }

    // ── STEP: topazmodels — diagnostic: list the account's valid Topaz models ──
    if (step === "topazmodels") {
      const key = Deno.env.get("TOPAZ_API_KEY") || "";
      const eps = [
        "https://api.topazlabs.com/image/v1/models",
        "https://api.topazlabs.com/image/v1/enhance/models",
        "https://api.topazlabs.com/v1/models",
      ];
      const results: any[] = [];
      for (const ep of eps) {
        try {
          const r = await fetch(ep, { headers: { "X-API-Key": key, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
          const txt = await r.text();
          results.push({ ep, status: r.status, body: txt.slice(0, 1500) });
          if (r.ok) break;
        } catch (e: any) { results.push({ ep, error: e?.message }); }
      }
      // Probe enhance with a deliberately-invalid model — Topaz returns the valid list in the error.
      try {
        const tiny = b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
        const form = new FormData();
        form.append("image", new Blob([tiny], { type: "image/png" }), "t.png");
        form.append("model", "__list_models__");
        form.append("output_format", "png");
        const r = await fetch("https://api.topazlabs.com/image/v1/enhance", { method: "POST", headers: { "X-API-Key": key }, body: form, signal: AbortSignal.timeout(30_000) });
        results.push({ probe: "enhance-bad-model", status: r.status, body: (await r.text()).slice(0, 2000) });
      } catch (e: any) { results.push({ probe: "enhance-bad-model", error: e?.message }); }
      return out({ success: true, hasKey: !!key, results });
    }

    return out({ success: false, error: `unknown step "${step}" — use design | separate | panel | gridslice | proofpanel | mirrorpanel | composeflat | linetrace | inpaint | qcproof | upscale | ingest | save | production | sync | artboard | crop | export` }, 400);
  } catch (err: any) {
    console.error("[PANELGEN] error:", err?.message || err);
    return out({ success: false, error: err?.message || "panel-artboard-generator failed" }, 500);
  }
});
