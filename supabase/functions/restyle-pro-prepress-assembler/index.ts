/**
 * ─────────────────────────────────────────────────────────────
 *  restyle-pro-prepress-assembler — STEP 3 of the Prompt-to-Production™
 *  prepress trio. LAYOUT ASSEMBLY & MECHANICAL EXECUTION.
 *
 *  © 2026 RestylePro / LoopMighty Software Development LLC.
 *
 *  100% DETERMINISTIC — no generative AI. It carries the REAL design through
 *  to print; it does NOT reconstruct it.
 *
 *    Layer 1 (background): the ACTUAL flat design artwork for the panel
 *      (the per-view flat art from the 2-D Production Proof), placed full-bleed
 *      at true size. The skyline / gradient / composition is preserved exactly.
 *    Layer 2 (logo)  [optional, "clean overlay" mode]: the harvested native
 *      vector logo, re-applied as a single editable overlay.
 *    Layer 3 (text)  [optional]: live re-typeset text, crisp, never warped.
 *
 *  A strict 1" bleed (overridable) is added on every edge; a cyan trim guide
 *  marks the cut line. Output per panel: a self-contained print-ready SVG
 *  (the design embedded as a data-URI so it never expires) + a raster proof
 *  preview, plus a production manifest.
 *
 *  If a panel has NO flat artwork supplied, the assembler falls back to a
 *  gradient reconstruction from the spatial map and flags it as degraded — but
 *  the correct, design-faithful path is to pass flatArtUrls.
 * ─────────────────────────────────────────────────────────────
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  uploadToStorage,
  getSignedUrl,
  fetchImageBytes,
  uint8ArrayToBase64,
} from "../_shared/restyle-pro/storage.ts";
import {
  jobPrefix,
  parseHex,
  lerp,
  DEFAULT_BLEED_INCHES,
  type SpatialMap,
  type PanelLayout,
  type HarvestedAsset,
  type GradientStop,
} from "../_shared/restyle-pro/lib.ts";

const UPP = 100; // SVG user-units per inch

// ── helpers ──────────────────────────────────────────────────────
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function gradientCoords(angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  return {
    x1: (0.5 - dx / 2).toFixed(4), y1: (0.5 - dy / 2).toFixed(4),
    x2: (0.5 + dx / 2).toFixed(4), y2: (0.5 + dy / 2).toFixed(4),
  };
}

function dissectSvg(svg: string): { inner: string; srcW: number; srcH: number } {
  const open = svg.match(/<svg\b[^>]*>/i);
  let srcW = 100, srcH = 100;
  if (open) {
    const vb = open[0].match(/viewBox\s*=\s*"([^"]+)"/i);
    if (vb) {
      const p = vb[1].trim().split(/[\s,]+/).map(Number);
      if (p.length === 4 && p[2] > 0 && p[3] > 0) { srcW = p[2]; srcH = p[3]; }
    } else {
      const w = open[0].match(/\bwidth\s*=\s*"([\d.]+)/i);
      const h = open[0].match(/\bheight\s*=\s*"([\d.]+)/i);
      if (w) srcW = Number(w[1]) || srcW;
      if (h) srcH = Number(h[1]) || srcH;
    }
  }
  const inner = svg.replace(/^[\s\S]*?<svg\b[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
  return { inner, srcW, srcH };
}

async function fetchText(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${resp.status}`);
  return await resp.text();
}

function dataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${uint8ArrayToBase64(bytes)}`;
}

/** Cover-fit + centre-crop a decoded image to exactly W×H (no distortion). */
function coverCrop(img: Image, W: number, H: number): Image {
  const scale = Math.max(W / img.width, H / img.height);
  const rw = Math.max(1, Math.round(img.width * scale));
  const rh = Math.max(1, Math.round(img.height * scale));
  const resized = img.clone().resize(rw, rh);
  const x = Math.max(0, Math.floor((rw - W) / 2));
  const y = Math.max(0, Math.floor((rh - H) / 2));
  return resized.crop(x, y, Math.min(W, rw), Math.min(H, rh));
}

interface PanelBuild {
  panel: PanelLayout;
  spatialMap: SpatialMap;
  bleedInches: number;
  artDataUri: string | null;        // real flat design (preferred Layer-1)
  logoSvgInner: { inner: string; srcW: number; srcH: number } | null;
  overlayLogo: boolean;
  textLayers: SpatialMap["textLayers"];
}

/** Build the true-size print SVG for one panel. */
function buildPanelSvg(b: PanelBuild): { svg: string; degraded: boolean } {
  const { panel, spatialMap, bleedInches, artDataUri, logoSvgInner, overlayLogo, textLayers } = b;
  const wIn = panel.widthInches + bleedInches * 2;
  const hIn = panel.heightInches + bleedInches * 2;
  const W = wIn * UPP, H = hIn * UPP;
  const bleed = bleedInches * UPP;
  const trimW = panel.widthInches * UPP, trimH = panel.heightInches * UPP;
  let degraded = false;

  // ── Layer 1: the REAL design (preferred) or gradient fallback ──────
  let bgMarkup = "";
  let defs = "";
  if (artDataUri) {
    // Full-bleed image. Passenger side mirrors the driver-side art horizontally.
    const mirror = panel.mirrored
      ? ` transform="translate(${W},0) scale(-1,1)"`
      : "";
    bgMarkup =
      `<image x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" ` +
      `xlink:href="${artDataUri}"${mirror}/>`;
  } else {
    degraded = true;
    const angle = panel.mirrored ? 180 - spatialMap.background.angleDeg : spatialMap.background.angleDeg;
    const g = gradientCoords(angle);
    const stops = (spatialMap.background.stops as GradientStop[])
      .map((s) => `<stop offset="${(s.pos * 100).toFixed(1)}%" stop-color="${s.hex}"/>`).join("");
    defs = `<linearGradient id="bg" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}">${stops}</linearGradient>`;
    bgMarkup = `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#bg)"/>`;
  }

  // ── Layer 2: optional clean vector logo overlay ────────────────────
  let logoMarkup = "";
  if (overlayLogo && logoSvgInner) {
    const printW = trimW, printH = trimH;
    const rel = spatialMap.logo?.relBBox;
    const targetW = printW * 0.30;
    const aspect = logoSvgInner.srcH / Math.max(1, logoSvgInner.srcW);
    const targetH = targetW * aspect;
    const cx = rel ? rel.x + rel.w / 2 : 0.22;
    const cy = rel ? rel.y + rel.h / 2 : 0.34;
    let lx = Math.max(bleed, Math.min(bleed + cx * printW - targetW / 2, bleed + printW - targetW));
    let ly = Math.max(bleed, Math.min(bleed + cy * printH - targetH / 2, bleed + printH - targetH));
    const sc = targetW / Math.max(1, logoSvgInner.srcW);
    logoMarkup = `<g transform="translate(${lx.toFixed(1)},${ly.toFixed(1)}) scale(${sc.toFixed(5)})">${logoSvgInner.inner}</g>`;
  }

  // ── Layer 3: optional live text (only meaningful in clean-overlay mode) ──
  let textMarkup = "";
  if (overlayLogo) {
    const rel = spatialMap.logo?.relBBox;
    const tx = bleed + (rel ? rel.x + rel.w / 2 : 0.22) * trimW;
    let ty = bleed + (rel ? rel.y + rel.h : 0.5) * trimH + 0.4 * UPP;
    for (const t of textLayers.slice(0, 6)) {
      const size = (t.fontWeight === "bold" ? 2.4 : 1.8) * UPP;
      textMarkup +=
        `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-family="Helvetica, Arial, sans-serif" ` +
        `font-size="${size.toFixed(0)}" font-weight="${t.fontWeight}" font-style="${t.fontStyle}" ` +
        `fill="${t.hexColor}" text-anchor="middle">${escapeXml(t.text)}</text>`;
      ty += size * 1.25;
    }
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${wIn}in" height="${hIn}in" viewBox="0 0 ${W} ${H}">
  <metadata>RestylePro Prompt-to-Production — ${escapeXml(panel.label)} — ${panel.widthInches}"x${panel.heightInches}" + ${bleedInches}" bleed${degraded ? " [DEGRADED: no flat art]" : ""}</metadata>
  ${defs ? `<defs>${defs}</defs>` : ""}
  <!-- Layer 1: printed design (full bleed) -->
  ${bgMarkup}
  <!-- Layer 2: clean vector logo overlay -->
  ${logoMarkup}
  <!-- Layer 3: live text -->
  ${textMarkup}
  <!-- Guide (non-printing): trim line @ ${bleedInches}" bleed -->
  <rect x="${bleed}" y="${bleed}" width="${trimW}" height="${trimH}" fill="none"
        stroke="#00C7FF" stroke-width="2" stroke-dasharray="20 12" data-guide="trim"/>
</svg>`;
  return { svg, degraded };
}

function colorAt(stops: GradientStop[], t: number): { r: number; g: number; b: number } {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  if (sorted.length === 1 || t <= sorted[0].pos) return parseHex(sorted[0].hex);
  if (t >= sorted[sorted.length - 1].pos) return parseHex(sorted[sorted.length - 1].hex);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (t >= a.pos && t <= b.pos) {
      const lt = (t - a.pos) / Math.max(1e-6, b.pos - a.pos);
      const ca = parseHex(a.hex), cb = parseHex(b.hex);
      return { r: lerp(ca.r, cb.r, lt), g: lerp(ca.g, cb.g, lt), b: lerp(ca.b, cb.b, lt) };
    }
  }
  return parseHex(sorted[sorted.length - 1].hex);
}

/** Raster proof preview: real flat design cover-fit (or gradient fallback) + optional logo. */
async function buildPreview(
  panel: PanelLayout, spatialMap: SpatialMap, bleedInches: number,
  artBytes: Uint8Array | null, logoPng: Uint8Array | null, overlayLogo: boolean,
): Promise<Uint8Array | null> {
  try {
    const wIn = panel.widthInches + bleedInches * 2;
    const hIn = panel.heightInches + bleedInches * 2;
    const longEdge = 1400;
    const scale = longEdge / Math.max(wIn, hIn);
    const W = Math.max(2, Math.round(wIn * scale));
    const H = Math.max(2, Math.round(hIn * scale));
    let canvas: Image;

    if (artBytes) {
      const art = await Image.decode(artBytes);
      canvas = coverCrop(art, W, H);
    } else {
      canvas = new Image(W, H);
      const angle = panel.mirrored ? 180 - spatialMap.background.angleDeg : spatialMap.background.angleDeg;
      const a = (angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
      const stops = spatialMap.background.stops as GradientStop[];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const nx = x / (W - 1), ny = y / (H - 1);
          const proj = 0.5 + ((nx - 0.5) * dx + (ny - 0.5) * dy);
          const c = colorAt(stops, Math.max(0, Math.min(1, proj)));
          canvas.setPixelAt(x + 1, y + 1, Image.rgbaToColor(Math.round(c.r), Math.round(c.g), Math.round(c.b), 255));
        }
      }
    }

    if (overlayLogo && logoPng) {
      const logo = await Image.decode(logoPng);
      const printW = panel.widthInches * scale;
      const targetW = Math.max(8, Math.round(printW * 0.30));
      const targetH = Math.max(8, Math.round(targetW * (logo.height / logo.width)));
      logo.resize(targetW, targetH);
      const rel = spatialMap.logo?.relBBox;
      const bleedPx = bleedInches * scale;
      const cx = rel ? rel.x + rel.w / 2 : 0.22;
      const cy = rel ? rel.y + rel.h / 2 : 0.34;
      let lx = Math.max(0, Math.min(Math.round(bleedPx + cx * printW - targetW / 2), W - targetW));
      let ly = Math.max(0, Math.min(Math.round(bleedPx + cy * (panel.heightInches * scale) - targetH / 2), H - targetH));
      canvas.composite(logo, lx, ly);
    }
    return await canvas.encode();
  } catch (e: any) {
    console.warn(`[RP-ASSEMBLE] preview failed for ${panel.id}: ${e.message}`);
    return null;
  }
}

/** Resolve the flat-art URL for a panel from the per-view map (+ side fallback). */
function resolveArtUrl(
  panel: PanelLayout,
  flatArtUrls: Record<string, string>,
  flatArtUrl: string | null,
): string | null {
  if (flatArtUrls[panel.id]) return flatArtUrls[panel.id];
  // side fallback: a single side artwork serves both driver + passenger
  if (panel.role === "side") {
    return flatArtUrls["driver-side"] || flatArtUrls["side"] || flatArtUrl || null;
  }
  return flatArtUrls[panel.role] || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startMs = Date.now();

  try {
    const body = await req.json();
    const {
      jobId,
      panels = [] as PanelLayout[],
      spatialMap,
      assets = [] as HarvestedAsset[],
      bleedInches = DEFAULT_BLEED_INCHES,
      designName = "Untitled",
      vehicle = {},
      flatArtUrls = {} as Record<string, string>,
      flatArtUrl = null as string | null,
      overlayLogo = false,   // true = clean Layer-1 + re-applied editable logo
    } = body;

    if (!jobId || !panels.length || !spatialMap) {
      return json({ error: "jobId, panels and spatialMap are required" }, 400);
    }

    const haveArt = Object.keys(flatArtUrls).length > 0 || !!flatArtUrl;
    if (!haveArt) {
      console.warn(`[RP-ASSEMBLE] no flatArtUrls/flatArtUrl supplied — panels will be DEGRADED (gradient reconstruction). Pass the flat design art to replicate the real design.`);
    }

    // Logo (only used in clean-overlay mode).
    const logoAsset = (assets as HarvestedAsset[]).find((a) => a.role === "logo");
    let logoSvgInner: { inner: string; srcW: number; srcH: number } | null = null;
    let logoPng: Uint8Array | null = null;
    if (overlayLogo && logoAsset?.svgUrl) {
      try { logoSvgInner = dissectSvg(await fetchText(logoAsset.svgUrl)); }
      catch (e: any) { console.warn(`[RP-ASSEMBLE] logo svg fetch failed: ${e.message}`); }
    }
    if (overlayLogo && logoAsset?.pngUrl) {
      try { logoPng = await fetchImageBytes(logoAsset.pngUrl); }
      catch (e: any) { console.warn(`[RP-ASSEMBLE] logo png fetch failed: ${e.message}`); }
    }

    // Cache flat-art bytes per source URL (driver/passenger usually share one).
    const artCache = new Map<string, Uint8Array | null>();
    async function getArt(url: string | null): Promise<Uint8Array | null> {
      if (!url) return null;
      if (artCache.has(url)) return artCache.get(url)!;
      let bytes: Uint8Array | null = null;
      try { bytes = await fetchImageBytes(url); }
      catch (e: any) { console.warn(`[RP-ASSEMBLE] flat-art fetch failed (${url.slice(0, 60)}): ${e.message}`); }
      artCache.set(url, bytes);
      return bytes;
    }
    function mime(url: string): string {
      const u = url.toLowerCase();
      if (u.includes(".png")) return "image/png";
      if (u.includes(".webp")) return "image/webp";
      return "image/jpeg";
    }

    const prefix = `${jobPrefix(jobId)}/panels`;
    const out: any[] = [];
    let degradedCount = 0;

    for (const panel of panels as PanelLayout[]) {
      const artUrl = resolveArtUrl(panel, flatArtUrls, flatArtUrl);
      const artBytes = await getArt(artUrl);
      const artDataUri = artBytes && artUrl ? dataUri(artBytes, mime(artUrl)) : null;

      const { svg, degraded } = buildPanelSvg({
        panel, spatialMap, bleedInches, artDataUri, logoSvgInner, overlayLogo,
        textLayers: spatialMap.textLayers,
      });
      if (degraded) degradedCount++;

      const svgPath = `${prefix}/${panel.id}.svg`;
      await uploadToStorage(svgPath, new TextEncoder().encode(svg), "image/svg+xml");

      let proofPath = "", proofUrl = "";
      const preview = await buildPreview(panel, spatialMap, bleedInches, artBytes, logoPng, overlayLogo);
      if (preview) {
        proofPath = `${prefix}/${panel.id}-proof.png`;
        await uploadToStorage(proofPath, preview, "image/png");
        proofUrl = await getSignedUrl(proofPath);
      }

      out.push({
        id: panel.id, label: panel.label,
        widthInches: panel.widthInches, heightInches: panel.heightInches,
        bleedInches, mirrored: panel.mirrored,
        finalWidthInches: panel.widthInches + bleedInches * 2,
        finalHeightInches: panel.heightInches + bleedInches * 2,
        usedFlatArt: !!artDataUri, degraded,
        svgPath, svgUrl: await getSignedUrl(svgPath),
        proofPath, proofUrl,
      });
      console.log(`[RP-ASSEMBLE] ${panel.label}: ${panel.widthInches}"×${panel.heightInches}" +${bleedInches}" bleed — flatArt=${!!artDataUri}`);
    }

    const manifest = {
      jobId, designName, vehicle, bleedInches,
      pipeline: "restyle-pro v1 (deterministic prepress)",
      designFaithful: degradedCount === 0,
      generatedAt: new Date().toISOString(),
      panels: out.map((p) => ({
        id: p.id, label: p.label,
        trim: `${p.widthInches}"x${p.heightInches}"`,
        withBleed: `${p.finalWidthInches}"x${p.finalHeightInches}"`,
        usedFlatArt: p.usedFlatArt, svgPath: p.svgPath, proofPath: p.proofPath,
      })),
    };
    const manifestPath = `${jobPrefix(jobId)}/production-manifest.json`;
    await uploadToStorage(manifestPath, new TextEncoder().encode(JSON.stringify(manifest, null, 2)), "application/json");

    const totalMs = Date.now() - startMs;
    console.log(`[RP-ASSEMBLE] job ${jobId} — ${out.length} panels (${degradedCount} degraded) in ${(totalMs / 1000).toFixed(1)}s`);

    return json({
      success: true, jobId, panels: out,
      designFaithful: degradedCount === 0,
      degradedCount,
      manifestPath, manifestUrl: await getSignedUrl(manifestPath),
      timing: { totalMs },
    }, 200);
  } catch (err: any) {
    console.error(`[RP-ASSEMBLE] ERROR:`, err);
    return json({ error: `restyle-pro-prepress-assembler failed: ${err.message}` }, 500);
  }
});

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
