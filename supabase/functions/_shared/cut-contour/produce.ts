/**
 * Cut-contour producer — the WePrintWraps guide, executed deterministically.
 *
 * Input: one flat artwork raster (the design on a white / transparent
 * background) and its real print size. Output: the print-ready files Nate
 * builds by hand in Illustrator in "How to output cut contour graphics":
 *
 *   • three layers, top to bottom — CutContour, Artwork, Bleed;
 *   • the cut line = the unified outer silhouette of every element (holes
 *     included), a 0.25 pt STROKE with NO fill, in a real PDF Separation
 *     colour space named exactly `CutContour` = CMYK 0 / 100 / 0 / 0;
 *   • the bleed = the artwork's own edge colour offset 1/4" outward, so a
 *     blade a millimetre off never shows white substrate;
 *   • every graphic nested on ONE sheet no taller than 51.5", the maximum
 *     cut-contour print width, sized to the artwork bounds — the dimensions
 *     the customer types into the WPW order form;
 *   • for Manufacture Film Cut, one extra layer per film colour so each
 *     colour can be plotted as its own sheet of manufactured vinyl.
 *
 * The geometry is `geometry.mjs` (pure, node-tested). This module owns the
 * I/O: decoding with imagescript, PDF with pdf-lib, SVG by hand.
 */

import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import {
  PDFDocument, PDFName, PDFOperator, PDFOperatorNames, PDFNumber, PDFString, PDFArray, PDFDict, PDFRef,
  pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, stroke, fill, setLineWidth,
  setLineJoin, LineJoinStyle, setFillingColor, rgb,
} from "https://esm.sh/pdf-lib@1.17.1";
import * as G from "./geometry.mjs";

export const CUT_CONTOUR_SPOT = Object.freeze({
  name: "CutContour",
  cmyk: Object.freeze({ c: 0, m: 100, y: 0, k: 0 }),
  strokeWeightPt: 0.25,
});
export const MAX_CUT_CONTOUR_HEIGHT_IN = 51.5;
export const DEFAULT_BLEED_IN = 0.25;
export const MIN_FEATURE_WIDTH_IN = 0.05;
export const MAX_VERTICES_PER_ELEMENT = 200;

export interface ProduceOptions {
  /** Real printed size of the whole artwork raster. Width wins when both are given. */
  widthIn?: number;
  heightIn?: number;
  /** Used when no size is given: pixels are read at this density. */
  dpiFallback?: number;
  bleedIn?: number;
  gapIn?: number;
  maxSheetHeightIn?: number;
  substrate?: "printed" | "cut";
  maxFilms?: number;
  label?: string;
  /** Long side of the working raster the geometry runs on. */
  workMax?: number;
}

export interface ProducedFilm { hex: string; coverage: number; paths: number }
export interface ProducedElement {
  index: number;
  label: string;
  widthIn: number;
  heightIn: number;
  cutPaths: number;
  vertices: number;
  minFeatureWidthIn: number;
  placement: { xIn: number; yIn: number; widthIn: number; heightIn: number; rotated: boolean; oversize: boolean };
  films: ProducedFilm[];
}
export interface ProduceResult {
  pdf: Uint8Array;
  svg: string;
  sheet: { widthIn: number; heightIn: number; dpi: number; maxHeightIn: number };
  /** 1 = true scale. 0.1 when the sheet exceeds the PDF page limit (200"): the
   *  file is built at 10% like Nate's "graphics kit cut contour 10%" and the
   *  RIP prints it at 1000%. Real inches are still reported in `sheet`. */
  scale: number;
  elements: ProducedElement[];
  reviewFlags: string[];
  totalVertices: number;
  layers: string[];
  spot: typeof CUT_CONTOUR_SPOT;
  bleedIn: number;
}

interface WorkElement {
  index: number;
  label: string;
  wPx: number; hPx: number;               // work-resolution size, art only
  loops: number[][][];                    // work px, relative to the element crop origin
  filmLoops: { hex: string; coverage: number; loops: number[][][] }[];
  artPng: Uint8Array;                     // original resolution, transparent outside the art
  bleedPng: Uint8Array;                   // work resolution ring, transparent elsewhere
  bleedPx: number;
  vertices: number;
  minFeatureWidthIn: number;
  rotated: boolean;
}

const round = (v: number, p = 3) => Number(v.toFixed(p));

function cropRgba(src: Uint8ClampedArray, width: number, x0: number, y0: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * width + x0) * 4;
    out.set(src.subarray(s, s + w * 4), y * w * 4);
  }
  return out;
}

function rotateRgba90(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  // 90° clockwise: (x, y) → (h - 1 - y, x); result is h wide, w tall.
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = (x * h + (h - 1 - y)) * 4;
    out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = src[s + 3];
  }
  return out;
}

function rotateLoops90(loops: number[][][], h: number): number[][][] {
  return loops.map((loop) => loop.map(([x, y]) => [h - y, x]));
}

async function encodePng(rgba: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  const img = new Image(w, h);
  img.bitmap.set(rgba);
  return await img.encode(6);
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  return btoa(bin);
}

export async function produceCutContour(bytes: Uint8Array, options: ProduceOptions = {}): Promise<ProduceResult> {
  const bleedIn = options.bleedIn ?? DEFAULT_BLEED_IN;
  const gapIn = options.gapIn ?? 0.25;
  const maxSheetHeightIn = options.maxSheetHeightIn ?? MAX_CUT_CONTOUR_HEIGHT_IN;
  const substrate = options.substrate ?? "printed";
  const workMax = options.workMax ?? 2048;
  const label = options.label || "Cut contour graphics";

  const original = await Image.decode(bytes) as Image;
  const W = original.width, H = original.height;
  const dpi = options.widthIn && options.widthIn > 0
    ? W / options.widthIn
    : options.heightIn && options.heightIn > 0
      ? H / options.heightIn
      : (options.dpiFallback ?? 150);

  // Work raster: the geometry never needs more than ~2K on the long side.
  const s = Math.max(1, Math.max(W, H) / workMax);
  const work = s > 1 ? original.clone().resize(Math.round(W / s), Math.round(H / s)) as Image : original;
  const wW = work.width, wH = work.height;
  const scaleX = W / wW, scaleY = H / wH;
  const dpiWork = dpi / scaleX;
  const bleedPx = Math.max(1, Math.round(bleedIn * dpiWork));

  const rgba = work.bitmap as Uint8ClampedArray;
  let mask = G.maskFromRgba(rgba, wW, wH);
  mask = G.closeMask(mask, wW, wH, 1);
  const minArea = Math.max(4, Math.round((0.03 * dpiWork) ** 2));
  const { labels, components } = G.components(mask, wW, wH, minArea);
  if (components.length === 0) throw new Error("no artwork found: the file is blank or entirely white");
  const groups = G.groupComponents(components, Math.max(3, Math.round(0.3 * dpiWork)), 0.6);

  const reviewFlags: string[] = [];
  const elements: WorkElement[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const ids = g.components.map((c: { id: number }) => c.id);
    const pad = bleedPx + 2;
    const x0 = Math.max(0, g.minX - pad), y0 = Math.max(0, g.minY - pad);
    const x1 = Math.min(wW, g.maxX + 1 + pad), y1 = Math.min(wH, g.maxY + 1 + pad);
    const cw = x1 - x0, ch = y1 - y0;
    const elemMask = G.cropMask(mask, wW, x0, y0, cw, ch, labels, ids);
    const elemRgba = cropRgba(rgba, wW, x0, y0, cw, ch);
    const dist = G.edt(elemMask, cw, ch);

    // Cut line: every boundary of the unified element, cleaned like a designer would.
    const loops = G.traceBoundaries(elemMask, cw, ch).map((l: number[][]) => G.cleanLoop(l));
    const vertices = loops.reduce((n: number, l: number[][]) => n + l.length, 0);

    // Bleed: the artwork's edge colour extended bleedPx outward.
    const ring = G.bleedRing(elemRgba, elemMask, cw, ch, bleedPx, dist);

    // Art at original resolution, transparent outside this element.
    const ox = Math.round(x0 * scaleX), oy = Math.round(y0 * scaleY);
    const ow = Math.min(W - ox, Math.round(cw * scaleX)), oh = Math.min(H - oy, Math.round(ch * scaleY));
    const artCrop = cropRgba(original.bitmap as Uint8ClampedArray, W, ox, oy, ow, oh);
    const fineMask = G.maskFromRgba(artCrop, ow, oh);
    const guard = G.dilate(elemMask, cw, ch, 1.5, dist);
    for (let y = 0; y < oh; y++) {
      const my = Math.min(ch - 1, Math.floor(y / scaleY));
      for (let x = 0; x < ow; x++) {
        const mx = Math.min(cw - 1, Math.floor(x / scaleX));
        const i = y * ow + x;
        if (!fineMask[i] || !guard[my * cw + mx]) artCrop[i * 4 + 3] = 0;
      }
    }

    // Manual-review trigger: hairline detail the plotter cannot weed.
    const localLabels = G.components(elemMask, cw, ch).labels;
    const localIds = [...new Set(Array.from(localLabels).filter((v: number) => v > 0))] as number[];
    const minFeatureWidthIn = G.minFeatureWidth(elemMask, cw, ch, localLabels, localIds) / dpiWork;

    // Manufacture Film Cut: one layer per solid film colour.
    const filmLoops: WorkElement["filmLoops"] = [];
    if (substrate === "cut") {
      const { palette, index } = G.quantizeColors(elemRgba, elemMask, cw, ch, { maxColors: options.maxFilms ?? 4 });
      palette.forEach((p: { hex: string; coverage: number }, k: number) => {
        const fm = G.closeMask(G.maskForPaletteIndex(index, k), cw, ch, 1);
        const fl = G.traceBoundaries(fm, cw, ch).map((l: number[][]) => G.cleanLoop(l));
        if (fl.length) filmLoops.push({ hex: p.hex, coverage: p.coverage, loops: fl });
      });
    }

    elements.push({
      index: gi + 1,
      label: `Element ${gi + 1}`,
      wPx: cw, hPx: ch,
      loops, filmLoops,
      artPng: await encodePng(artCrop, ow, oh),
      bleedPng: await encodePng(ring, cw, ch),
      bleedPx, vertices, minFeatureWidthIn,
      rotated: false,
    });
  }

  // Nest on one sheet. Element crops already carry the bleed + 2 px on every side.
  const items = elements.map((e) => ({ id: String(e.index), w: e.wPx / dpiWork, h: e.hPx / dpiWork }));
  const packed = G.shelfPack(items, maxSheetHeightIn, gapIn);
  for (const p of packed.placements) {
    const e = elements[p.i];
    if (p.rotated) {
      const art = await Image.decode(e.artPng) as Image;
      const artR = rotateRgba90(art.bitmap as Uint8ClampedArray, art.width, art.height);
      e.artPng = await encodePng(artR, art.height, art.width);
      const bl = await Image.decode(e.bleedPng) as Image;
      e.bleedPng = await encodePng(rotateRgba90(bl.bitmap as Uint8ClampedArray, bl.width, bl.height), bl.height, bl.width);
      e.loops = rotateLoops90(e.loops, e.hPx);
      e.filmLoops = e.filmLoops.map((f) => ({ ...f, loops: rotateLoops90(f.loops, e.hPx) }));
      [e.wPx, e.hPx] = [e.hPx, e.wPx];
      e.rotated = true;
    }
    if (p.oversize) reviewFlags.push(`oversize:Element ${e.index} is larger than ${maxSheetHeightIn}" in both directions and must be tiled`);
    if (e.vertices > MAX_VERTICES_PER_ELEMENT) reviewFlags.push(`vertices:Element ${e.index} cut path has ${e.vertices} vertices (> ${MAX_VERTICES_PER_ELEMENT}); hand simplification recommended`);
    if (e.minFeatureWidthIn < MIN_FEATURE_WIDTH_IN) reviewFlags.push(`hairline:Element ${e.index} has detail ${round(e.minFeatureWidthIn, 3)}" wide (< ${MIN_FEATURE_WIDTH_IN}")`);
  }
  const sheetWIn = packed.sheetW, sheetHIn = packed.sheetH;
  // PDF pages cap at 14400 pt (200"). A van-side kit can exceed that, so — as
  // the WPW guide does — the file drops to 10% scale and says so in its name.
  const PDF_MAX_IN = 200;
  const scale = Math.max(sheetWIn, sheetHIn) > PDF_MAX_IN ? 0.1 : 1;
  const ptPerPx = (72 / dpiWork) * scale;
  const inPt = 72 * scale;

  const placed = packed.placements.map((p) => ({ p, e: elements[p.i] }));
  const layers = ["CutContour", "Artwork", "Bleed", ...(substrate === "cut" ? placed.flatMap(({ e }) => e.filmLoops.map((f, i) => `Film ${i + 1} ${f.hex}`)) : [])];
  const uniqueLayers = [...new Set(layers)];

  // ── SVG (the editable companion; the PDF is what the RIP reads) ──────────
  const svgW = round(sheetWIn * inPt), svgH = round(sheetHIn * inPt);
  const svgParts: string[] = [];
  svgParts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${round(sheetWIn * scale)}in" height="${round(sheetHIn * scale)}in" viewBox="0 0 ${svgW} ${svgH}" data-cut-contour="${CUT_CONTOUR_SPOT.name}" data-bleed-in="${bleedIn}" data-scale="${scale}" data-sheet-in="${round(sheetWIn, 2)} x ${round(sheetHIn, 2)}">`);
  svgParts.push(`<title>${escapeXml(label)} — cut contour</title>`);
  svgParts.push(`<g id="Bleed">`);
  for (const { p, e } of placed) {
    svgParts.push(`<image x="${round(p.x * inPt)}" y="${round(p.y * inPt)}" width="${round(e.wPx * ptPerPx)}" height="${round(e.hPx * ptPerPx)}" xlink:href="data:image/png;base64,${base64(e.bleedPng)}"/>`);
  }
  svgParts.push(`</g><g id="Artwork">`);
  for (const { p, e } of placed) {
    svgParts.push(`<image x="${round(p.x * inPt)}" y="${round(p.y * inPt)}" width="${round(e.wPx * ptPerPx)}" height="${round(e.hPx * ptPerPx)}" xlink:href="data:image/png;base64,${base64(e.artPng)}"/>`);
  }
  svgParts.push(`</g>`);
  if (substrate === "cut") {
    placed.forEach(({ p, e }) => e.filmLoops.forEach((f, i) => {
      svgParts.push(`<g id="Film-${e.index}-${i + 1}" data-film="${f.hex}" style="display:none" fill="${f.hex}" fill-rule="evenodd"><path d="${G.loopsToPathD(f.loops, { scale: ptPerPx, offsetX: p.x * inPt, offsetY: p.y * inPt })}"/></g>`);
    }));
  }
  svgParts.push(`<g id="${CUT_CONTOUR_SPOT.name}" fill="none" stroke="#FF00FF" stroke-width="${CUT_CONTOUR_SPOT.strokeWeightPt}" data-spot="${CUT_CONTOUR_SPOT.name}" data-cmyk="0,100,0,0">`);
  for (const { p, e } of placed) {
    svgParts.push(`<path id="cut-element-${e.index}" d="${G.loopsToPathD(e.loops, { scale: ptPerPx, offsetX: p.x * inPt, offsetY: p.y * inPt })}"/>`);
  }
  svgParts.push(`</g></svg>`);
  const svg = svgParts.join("\n");

  // ── PDF: Separation /CutContour, optional-content layers, 0.25 pt stroke ──
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${label} — cut contour`);
  pdf.setProducer("DesignProAI GraphicsPro cut-contour producer");
  pdf.setCreator("DesignProAI");
  pdf.setSubject(`Sheet ${round(sheetWIn, 2)} x ${round(sheetHIn, 2)} in · bleed ${bleedIn} in · ${CUT_CONTOUR_SPOT.name} spot CMYK 0/100/0/0${scale < 1 ? ` · FILE AT ${Math.round(scale * 100)}% SCALE, print at ${Math.round(100 / scale)}%` : ""}`);
  const ctx = pdf.context;
  const page = pdf.addPage([sheetWIn * inPt, sheetHIn * inPt]);
  const pageH = sheetHIn * inPt;

  const tint = ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 1, 0, 0], N: 1 });
  const separation = ctx.register(ctx.obj([PDFName.of("Separation"), PDFName.of(CUT_CONTOUR_SPOT.name), PDFName.of("DeviceCMYK"), tint]));
  const ocg = (name: string): PDFRef => ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of(name) }));
  const ocgs: Record<string, PDFRef> = {};
  for (const name of uniqueLayers) ocgs[name] = ocg(name);
  const ocgRefs = uniqueLayers.map((n) => ocgs[n]);
  const filmRefs = uniqueLayers.filter((n) => n.startsWith("Film ")).map((n) => ocgs[n]);
  pdf.catalog.set(PDFName.of("OCProperties"), ctx.obj({
    OCGs: ocgRefs,
    D: ctx.obj({ Order: ocgRefs, ON: ocgRefs.filter((r) => !filmRefs.includes(r)), OFF: filmRefs }),
  }));
  const resources = page.node.Resources() as PDFDict;
  resources.set(PDFName.of("ColorSpace"), ctx.obj({ [CUT_CONTOUR_SPOT.name]: separation }));
  const props: Record<string, PDFRef> = {};
  uniqueLayers.forEach((n, i) => { props[`OC${i}`] = ocgs[n]; });
  resources.set(PDFName.of("Properties"), ctx.obj(props));
  const ocName = (layer: string) => PDFName.of(`OC${uniqueLayers.indexOf(layer)}`);
  const beginOC = (layer: string) => PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of("OC"), ocName(layer)]);
  const endOC = () => PDFOperator.of(PDFOperatorNames.EndMarkedContent, []);

  const toPt = (p: { x: number; y: number }, e: WorkElement, pt: number[]) => ({
    x: p.x * inPt + pt[0] * ptPerPx,
    y: pageH - (p.y * inPt + pt[1] * ptPerPx),
  });

  // Bleed layer (bottom).
  page.pushOperators(beginOC("Bleed"));
  for (const { p, e } of placed) {
    const img = await pdf.embedPng(e.bleedPng);
    page.drawImage(img, { x: p.x * inPt, y: pageH - p.y * inPt - e.hPx * ptPerPx, width: e.wPx * ptPerPx, height: e.hPx * ptPerPx });
  }
  page.pushOperators(endOC());
  // Artwork layer.
  page.pushOperators(beginOC("Artwork"));
  for (const { p, e } of placed) {
    const img = await pdf.embedPng(e.artPng);
    page.drawImage(img, { x: p.x * inPt, y: pageH - p.y * inPt - e.hPx * ptPerPx, width: e.wPx * ptPerPx, height: e.hPx * ptPerPx });
  }
  page.pushOperators(endOC());
  // Film layers (Manufacture Film Cut), hidden by default.
  if (substrate === "cut") {
    for (const { p, e } of placed) {
      e.filmLoops.forEach((f, i) => {
        const r = parseInt(f.hex.slice(1, 3), 16) / 255, g = parseInt(f.hex.slice(3, 5), 16) / 255, b = parseInt(f.hex.slice(5, 7), 16) / 255;
        const ops: PDFOperator[] = [beginOC(`Film ${i + 1} ${f.hex}`), pushGraphicsState(), setFillingColor(rgb(r, g, b))];
        for (const loop of f.loops) {
          loop.forEach((pt, k) => { const q = toPt(p, e, pt); ops.push(k === 0 ? moveTo(q.x, q.y) : lineTo(q.x, q.y)); });
          ops.push(closePath());
        }
        ops.push(PDFOperator.of(PDFOperatorNames.FillEvenOdd, []), popGraphicsState(), endOC());
        page.pushOperators(...ops);
      });
    }
  }
  // CutContour layer (top): stroke only, spot colour, hairline.
  const cutOps: PDFOperator[] = [
    beginOC("CutContour"),
    pushGraphicsState(),
    PDFOperator.of(PDFOperatorNames.StrokingColorspace, [PDFName.of(CUT_CONTOUR_SPOT.name)]),
    PDFOperator.of(PDFOperatorNames.StrokingColorN, [PDFNumber.of(1)]),
    setLineWidth(CUT_CONTOUR_SPOT.strokeWeightPt),
    setLineJoin(LineJoinStyle.Round),
  ];
  for (const { p, e } of placed) {
    for (const loop of e.loops) {
      loop.forEach((pt, k) => { const q = toPt(p, e, pt); cutOps.push(k === 0 ? moveTo(q.x, q.y) : lineTo(q.x, q.y)); });
      cutOps.push(closePath());
    }
  }
  cutOps.push(stroke(), popGraphicsState(), endOC());
  page.pushOperators(...cutOps);

  const pdfBytes = await pdf.save({ useObjectStreams: false });

  const producedElements: ProducedElement[] = placed.map(({ p, e }) => ({
    index: e.index,
    label: e.label,
    widthIn: round((e.wPx - 2 * (e.bleedPx + 2)) / dpiWork, 2),
    heightIn: round((e.hPx - 2 * (e.bleedPx + 2)) / dpiWork, 2),
    cutPaths: e.loops.length,
    vertices: e.vertices,
    minFeatureWidthIn: round(e.minFeatureWidthIn, 3),
    placement: { xIn: round(p.x, 2), yIn: round(p.y, 2), widthIn: round(p.w, 2), heightIn: round(p.h, 2), rotated: e.rotated, oversize: p.oversize },
    films: e.filmLoops.map((f) => ({ hex: f.hex, coverage: round(f.coverage, 3), paths: f.loops.length })),
  }));

  return {
    pdf: pdfBytes,
    svg,
    sheet: { widthIn: round(sheetWIn, 2), heightIn: round(sheetHIn, 2), dpi: round(dpi, 1), maxHeightIn: maxSheetHeightIn },
    scale,
    elements: producedElements,
    reviewFlags,
    totalVertices: elements.reduce((n, e) => n + e.vertices, 0),
    layers: uniqueLayers,
    spot: CUT_CONTOUR_SPOT,
    bleedIn,
  };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c] as string));
}
