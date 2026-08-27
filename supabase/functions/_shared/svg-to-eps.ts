/**
 * svg-to-eps — Minimal SVG → Encapsulated PostScript (EPS) converter
 *
 * Takes SVG output from VTracer (or any SVG with <path d="..."> + fill attrs)
 * and emits a PostScript Level 2 EPS suitable for RIP software (Onyx, Caldera,
 * Flexi, VersaWorks, SignCut, SAi, EFI Fiery) and vector editors (Illustrator,
 * CorelDRAW, Inkscape).
 *
 * Supports the path commands VTracer actually emits:
 *   M/m  moveto
 *   L/l  lineto
 *   H/h  horizontal lineto
 *   V/v  vertical lineto
 *   C/c  curveto (cubic Bézier)
 *   Q/q  quadratic Bézier (converted to cubic)
 *   Z/z  closepath
 *
 * Coordinate system note: SVG has origin top-left, Y down. PostScript has
 * origin bottom-left, Y up. We emit a flipping transform at page start
 * (`0 <height> translate  1 -1 scale`) so downstream path coordinates can be
 * written verbatim from the SVG without per-point Y negation.
 */

export interface EpsOptions {
  /** BoundingBox width in PostScript points (72pt = 1in). */
  widthPts: number;
  /** BoundingBox height in PostScript points. */
  heightPts: number;
  /** DSC header lines to inject after %%BoundingBox (one per line, no trailing \n). */
  dscHeaders?: string[];
  /** Optional Creator string (default: RestylePro VTracer Pipeline). */
  creator?: string;
  /** Optional Title string. */
  title?: string;
}

interface ParsedPath {
  d: string;
  fill: string;       // hex like "#rrggbb" or "none"
  fillOpacity: number;
}

// ── Public entry point ──────────────────────────────────────────────
export function svgToEps(svg: string, opts: EpsOptions): Uint8Array {
  const { svgW, svgH } = readSvgSize(svg);
  const paths = extractPaths(svg);

  const sx = opts.widthPts / svgW;
  const sy = opts.heightPts / svgH;

  const header = buildHeader(opts);
  const body = buildBody(paths, sx, sy);
  const footer = `grestore\nshowpage\n%%EOF\n`;

  return new TextEncoder().encode(header + body + footer);
}

// ── Size extraction ─────────────────────────────────────────────────
function readSvgSize(svg: string): { svgW: number; svgH: number } {
  const vb = svg.match(/viewBox="([^"]+)"/i);
  if (vb) {
    const parts = vb[1].split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
      return { svgW: parts[2], svgH: parts[3] };
    }
  }
  const w = svg.match(/<svg[^>]*\swidth="([\d.]+)/i);
  const h = svg.match(/<svg[^>]*\sheight="([\d.]+)/i);
  if (w && h) return { svgW: parseFloat(w[1]), svgH: parseFloat(h[1]) };
  return { svgW: 1000, svgH: 1000 };
}

// ── Path extraction ─────────────────────────────────────────────────
function extractPaths(svg: string): ParsedPath[] {
  const out: ParsedPath[] = [];
  // Track group-level fill inheritance — VTracer emits <g fill="..."> <path .../> </g>
  const groupFills: string[] = [];
  const groupOpacities: number[] = [];

  const tagRx = /<(\/?)(g|path)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRx.exec(svg)) !== null) {
    const isClose = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3];
    if (tag === "g") {
      if (isClose) {
        groupFills.pop();
        groupOpacities.pop();
      } else {
        groupFills.push(readAttr(attrs, "fill") || "");
        groupOpacities.push(parseFloat(readAttr(attrs, "fill-opacity") || "1") || 1);
      }
      continue;
    }
    // path
    if (isClose) continue;
    const d = readAttr(attrs, "d");
    if (!d) continue;
    let fill = readAttr(attrs, "fill") || "";
    if (!fill) {
      // inherit from nearest group
      for (let i = groupFills.length - 1; i >= 0; i--) {
        if (groupFills[i]) { fill = groupFills[i]; break; }
      }
    }
    if (!fill) fill = "#000000";
    const fillOpacityAttr = readAttr(attrs, "fill-opacity");
    const fillOpacity = fillOpacityAttr ? parseFloat(fillOpacityAttr) : (groupOpacities[groupOpacities.length - 1] ?? 1);
    out.push({ d, fill, fillOpacity });
  }
  return out;
}

function readAttr(attrs: string, name: string): string | null {
  const rx = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  const m = attrs.match(rx);
  return m ? m[1] : null;
}

// ── Header ──────────────────────────────────────────────────────────
function buildHeader(opts: EpsOptions): string {
  const w = Math.max(1, Math.round(opts.widthPts));
  const h = Math.max(1, Math.round(opts.heightPts));
  const lines: string[] = [
    "%!PS-Adobe-3.0 EPSF-3.0",
    `%%Creator: ${opts.creator || "RestylePro VTracer Pipeline"}`,
    `%%Title: ${opts.title || "vectorized.eps"}`,
    `%%BoundingBox: 0 0 ${w} ${h}`,
    `%%HiResBoundingBox: 0 0 ${w}.00 ${h}.00`,
    "%%Pages: 1",
    "%%DocumentData: Clean7Bit",
    "%%LanguageLevel: 2",
  ];
  if (opts.dscHeaders && opts.dscHeaders.length) {
    for (const line of opts.dscHeaders) lines.push(line);
  }
  lines.push("%%EndComments");
  lines.push("%%Page: 1 1");
  lines.push("gsave");
  // Flip Y axis so SVG coordinates map directly
  lines.push(`0 ${h} translate`);
  lines.push("1 -1 scale");
  return lines.join("\n") + "\n";
}

// ── Body: emit one filled path per SVG path ─────────────────────────
function buildBody(paths: ParsedPath[], sx: number, sy: number): string {
  const lines: string[] = [];
  for (const p of paths) {
    if (p.fill === "none" || p.fillOpacity <= 0) continue;
    const rgb = hexToRgb01(p.fill);
    if (!rgb) continue;
    lines.push(`${rgb[0].toFixed(4)} ${rgb[1].toFixed(4)} ${rgb[2].toFixed(4)} setrgbcolor`);
    lines.push("newpath");
    emitPath(p.d, sx, sy, lines);
    lines.push("eofill");
  }
  return lines.join("\n") + "\n";
}

// ── Path data parser + PostScript emitter ───────────────────────────
function emitPath(d: string, sx: number, sy: number, out: string[]): void {
  let i = 0;
  const n = d.length;
  let cx = 0, cy = 0;     // current point
  let startX = 0, startY = 0; // subpath start (for Z)
  let cmd = "";

  const skipWs = () => {
    while (i < n) {
      const c = d.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) i++;
      else break;
    }
  };

  const readNum = (): number => {
    skipWs();
    let j = i;
    if (d[j] === "+" || d[j] === "-") j++;
    while (j < n) {
      const c = d.charCodeAt(j);
      if ((c >= 48 && c <= 57) || c === 46) j++;
      else if ((c === 101 || c === 69) && j > i) { // e/E
        j++;
        if (d[j] === "+" || d[j] === "-") j++;
      } else break;
    }
    const s = d.slice(i, j);
    i = j;
    return parseFloat(s);
  };

  const peekCmd = (): string | null => {
    skipWs();
    if (i >= n) return null;
    const c = d[i];
    if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) return c;
    return null;
  };

  const fmt = (x: number, y: number): string =>
    `${(x * sx).toFixed(3)} ${(y * sy).toFixed(3)}`;

  while (i < n) {
    skipWs();
    if (i >= n) break;
    const peek = peekCmd();
    if (peek) { cmd = peek; i++; }
    // implicit repeat of previous command if a number follows without a letter

    switch (cmd) {
      case "M": case "m": {
        let x = readNum();
        let y = readNum();
        if (cmd === "m") { x += cx; y += cy; }
        cx = x; cy = y; startX = x; startY = y;
        out.push(`${fmt(x, y)} moveto`);
        // subsequent implicit pairs are lineto per SVG spec
        while (peekCmd() === null && i < n) {
          let lx = readNum();
          let ly = readNum();
          if (cmd === "m") { lx += cx; ly += cy; }
          cx = lx; cy = ly;
          out.push(`${fmt(lx, ly)} lineto`);
          skipWs();
          if (i >= n) break;
        }
        break;
      }
      case "L": case "l": {
        while (true) {
          let x = readNum();
          let y = readNum();
          if (cmd === "l") { x += cx; y += cy; }
          cx = x; cy = y;
          out.push(`${fmt(x, y)} lineto`);
          skipWs();
          if (peekCmd() !== null || i >= n) break;
        }
        break;
      }
      case "H": case "h": {
        while (true) {
          let x = readNum();
          if (cmd === "h") x += cx;
          cx = x;
          out.push(`${fmt(x, cy)} lineto`);
          skipWs();
          if (peekCmd() !== null || i >= n) break;
        }
        break;
      }
      case "V": case "v": {
        while (true) {
          let y = readNum();
          if (cmd === "v") y += cy;
          cy = y;
          out.push(`${fmt(cx, y)} lineto`);
          skipWs();
          if (peekCmd() !== null || i >= n) break;
        }
        break;
      }
      case "C": case "c": {
        while (true) {
          let x1 = readNum(), y1 = readNum();
          let x2 = readNum(), y2 = readNum();
          let x  = readNum(), y  = readNum();
          if (cmd === "c") {
            x1 += cx; y1 += cy;
            x2 += cx; y2 += cy;
            x  += cx; y  += cy;
          }
          cx = x; cy = y;
          out.push(`${fmt(x1, y1)} ${fmt(x2, y2)} ${fmt(x, y)} curveto`);
          skipWs();
          if (peekCmd() !== null || i >= n) break;
        }
        break;
      }
      case "Q": case "q": {
        // Convert quadratic to cubic:
        //   C1 = P0 + 2/3 (P1 - P0)
        //   C2 = P2 + 2/3 (P1 - P2)
        while (true) {
          let qx1 = readNum(), qy1 = readNum();
          let qx  = readNum(), qy  = readNum();
          if (cmd === "q") {
            qx1 += cx; qy1 += cy;
            qx  += cx; qy  += cy;
          }
          const c1x = cx + (2 / 3) * (qx1 - cx);
          const c1y = cy + (2 / 3) * (qy1 - cy);
          const c2x = qx + (2 / 3) * (qx1 - qx);
          const c2y = qy + (2 / 3) * (qy1 - qy);
          cx = qx; cy = qy;
          out.push(`${fmt(c1x, c1y)} ${fmt(c2x, c2y)} ${fmt(qx, qy)} curveto`);
          skipWs();
          if (peekCmd() !== null || i >= n) break;
        }
        break;
      }
      case "Z": case "z": {
        out.push("closepath");
        cx = startX; cy = startY;
        break;
      }
      default: {
        // Unknown command — advance one char to avoid infinite loop
        i++;
        break;
      }
    }
  }
}

// ── Color helpers ───────────────────────────────────────────────────
function hexToRgb01(hex: string): [number, number, number] | null {
  if (!hex || hex === "none") return null;
  let h = hex.trim().toLowerCase();
  if (h.startsWith("rgb")) {
    const m = h.match(/rgb[a]?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map(s => parseFloat(s.trim()));
    if (parts.length < 3) return null;
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
  }
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r / 255, g / 255, b / 255];
}
