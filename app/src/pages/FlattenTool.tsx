/**
 * FlattenTool — Deterministic 1:1 wrap flattener (100% client-side).
 * ================================================================
 * Upload a 2D proof, place/adjust the FOUR corners of the design, and download a
 * clean print-ready rectangle with the vehicle removed and the artwork filled
 * edge-to-edge. The flatten is a closed-form perspective homography + bilinear
 * resampling done entirely in the browser canvas — no server, no AI, no drift.
 * Same input + same corners -> identical output, every time.
 *
 * This mirrors the `panel-flatten-deterministic` edge function so a print-ready file
 * can be produced and sent to the printer immediately, with zero deploy dependency.
 */
import { useCallback, useMemo, useRef, useState } from "react";

/* ───────── pure math (identical to the edge function) ───────── */

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error("degenerate corners (collinear?)");
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}
function solveHomography(src: number[][], dst: number[][]): number[] {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solveLinear(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
function applyH(H: number[], x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Deterministic 4-corner auto-detect from ImageData (saturated-pixel extremes). */
function autoDetectCorners(data: Uint8ClampedArray, W: number, H: number): number[][] | null {
  const step = Math.max(1, Math.round(Math.min(W, H) / 600));
  let tl: number[] | null = null, tr: number[] | null = null, br: number[] | null = null, bl: number[] | null = null;
  let sTL = Infinity, sBR = -Infinity, dTR = -Infinity, dBL = Infinity, hits = 0;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      if (data[i + 3] < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat > 0.35 && max > 60) {
        hits++;
        const sum = x + y, diff = x - y;
        if (sum < sTL) { sTL = sum; tl = [x, y]; }
        if (sum > sBR) { sBR = sum; br = [x, y]; }
        if (diff > dTR) { dTR = diff; tr = [x, y]; }
        if (diff < dBL) { dBL = diff; bl = [x, y]; }
      }
    }
  }
  if (hits < 50 || !tl || !tr || !br || !bl) return null;
  return [tl, tr, br, bl]; // TL, TR, BR, BL
}

/* ───────── component ───────── */

type Norm = { x: number; y: number }; // normalized 0..1
const CORNER_LABELS = ["TL", "TR", "BR", "BL"];

export default function FlattenTool() {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [corners, setCorners] = useState<Norm[]>([
    { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 },
  ]);
  const [widthIn, setWidthIn] = useState("172");
  const [heightIn, setHeightIn] = useState("59.5");
  const [bleedIn, setBleedIn] = useState("2");
  const [longSide, setLongSide] = useState("4096");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [resultDims, setResultDims] = useState<{ w: number; h: number } | null>(null);
  const [detectMsg, setDetectMsg] = useState("");

  const imgBoxRef = useRef<HTMLDivElement | null>(null);
  const dragIdx = useRef<number>(-1);

  const onFile = useCallback((file: File) => {
    setResultUrl(""); setResultDims(null);
    setFileName(file.name.replace(/\.[^.]+$/, ""));
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      // Auto-detect on a downscaled copy.
      const long = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = Math.min(1, 700 / long);
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0, w, h);
      const det = autoDetectCorners(ctx.getImageData(0, 0, w, h).data, w, h);
      if (det) {
        setCorners(det.map(([x, y]) => ({ x: x / (w - 1), y: y / (h - 1) })));
        setDetectMsg("Corners auto-detected — drag any handle to fine-tune.");
      } else {
        setDetectMsg("Couldn't auto-detect — drag the 4 handles to the design corners.");
      }
    };
    img.src = URL.createObjectURL(file);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragIdx.current < 0 || !imgBoxRef.current) return;
    const rect = imgBoxRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setCorners((prev) => prev.map((c, i) => (i === dragIdx.current ? { x, y } : c)));
  }, []);

  const aspect = useMemo(() => {
    const w = parseFloat(widthIn), h = parseFloat(heightIn);
    return w > 0 && h > 0 ? w / h : null;
  }, [widthIn, heightIn]);

  const generate = useCallback(async () => {
    if (!imgEl) return;
    setBusy(true); setResultUrl("");
    try {
      // Source pixels (cap to keep memory sane).
      const longSrc = Math.max(imgEl.naturalWidth, imgEl.naturalHeight);
      const sScale = Math.min(1, 2400 / longSrc);
      const SW = Math.round(imgEl.naturalWidth * sScale), SH = Math.round(imgEl.naturalHeight * sScale);
      const sc = document.createElement("canvas"); sc.width = SW; sc.height = SH;
      const sctx = sc.getContext("2d")!; sctx.drawImage(imgEl, 0, 0, SW, SH);
      const src = sctx.getImageData(0, 0, SW, SH).data;

      // Output rectangle from true print aspect.
      const asp = aspect || SW / SH;
      const LS = Math.min(8192, Math.max(512, parseInt(longSide) || 4096));
      let OW: number, OH: number;
      if (asp >= 1) { OW = LS; OH = Math.max(16, Math.round(LS / asp)); }
      else { OH = LS; OW = Math.max(16, Math.round(LS * asp)); }

      const photo = corners.map((c) => [c.x * (SW - 1), c.y * (SH - 1)]);
      const rect = [[0, 0], [OW - 1, 0], [OW - 1, OH - 1], [0, OH - 1]];
      const H = solveHomography(rect, photo);

      const out = new ImageData(OW, OH);
      const od = out.data;
      for (let oy = 0; oy < OH; oy++) {
        for (let ox = 0; ox < OW; ox++) {
          const [fx, fy] = applyH(H, ox, oy);
          const oi = (oy * OW + ox) * 4;
          if (fx < 0 || fy < 0 || fx > SW - 1 || fy > SH - 1) { od[oi + 3] = 0; continue; }
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          const x1 = Math.min(x0 + 1, SW - 1), y1 = Math.min(y0 + 1, SH - 1);
          const dx = fx - x0, dy = fy - y0;
          for (let ch = 0; ch < 3; ch++) {
            const i00 = (y0 * SW + x0) * 4 + ch, i10 = (y0 * SW + x1) * 4 + ch;
            const i01 = (y1 * SW + x0) * 4 + ch, i11 = (y1 * SW + x1) * 4 + ch;
            const top = src[i00] * (1 - dx) + src[i10] * dx;
            const bot = src[i01] * (1 - dx) + src[i11] * dx;
            od[oi + ch] = (top * (1 - dy) + bot * dy + 0.5) | 0;
          }
          od[oi + 3] = 255;
        }
      }

      // Trim canvas.
      const trim = document.createElement("canvas"); trim.width = OW; trim.height = OH;
      trim.getContext("2d")!.putImageData(out, 0, 0);

      // Optional 2" bleed via edge replication (no distortion).
      const bIn = parseFloat(bleedIn) || 0;
      let finalCanvas = trim, finalW = OW, finalH = OH;
      if (bIn > 0 && aspect) {
        const ppi = LS / Math.max(parseFloat(widthIn), parseFloat(heightIn));
        const bp = Math.max(1, Math.round(bIn * ppi));
        const fc = document.createElement("canvas"); fc.width = OW + 2 * bp; fc.height = OH + 2 * bp;
        const fctx = fc.getContext("2d")!;
        fctx.drawImage(trim, bp, bp);
        fctx.drawImage(trim, 0, 0, 1, OH, 0, bp, bp, OH);             // left
        fctx.drawImage(trim, OW - 1, 0, 1, OH, OW + bp, bp, bp, OH);  // right
        fctx.drawImage(trim, 0, 0, OW, 1, bp, 0, OW, bp);             // top
        fctx.drawImage(trim, 0, OH - 1, OW, 1, bp, OH + bp, OW, bp);  // bottom
        fctx.drawImage(trim, 0, 0, 1, 1, 0, 0, bp, bp);                       // TL
        fctx.drawImage(trim, OW - 1, 0, 1, 1, OW + bp, 0, bp, bp);            // TR
        fctx.drawImage(trim, 0, OH - 1, 1, 1, 0, OH + bp, bp, bp);            // BL
        fctx.drawImage(trim, OW - 1, OH - 1, 1, 1, OW + bp, OH + bp, bp, bp); // BR
        finalCanvas = fc; finalW = fc.width; finalH = fc.height;
      }

      const blob: Blob = await new Promise((res) => finalCanvas.toBlob((b) => res(b!), "image/png"));
      setResultUrl(URL.createObjectURL(blob));
      setResultDims({ w: finalW, h: finalH });
    } catch (err: any) {
      setDetectMsg(`Error: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  }, [imgEl, corners, aspect, longSide, bleedIn, widthIn, heightIn]);

  const downloadName = useMemo(() => {
    const w = widthIn || "W", h = heightIn || "H";
    return `${fileName || "panel"}_FLAT_${w}x${h}in.png`;
  }, [fileName, widthIn, heightIn]);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold tracking-tight mb-1">
          Deterministic Flatten<span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">Pro</span>
        </h1>
        <p className="text-gray-600 mb-8">
          Upload a 2D proof → place the 4 design corners → download a print-ready flattened panel.
          Pure math, no AI, identical output every time.
        </p>

        {/* Upload */}
        <label className="block mb-6">
          <span className="inline-block px-5 py-3 rounded-lg bg-gradient-to-r from-blue-500 to-pink-500 text-white font-semibold cursor-pointer">
            {imgEl ? "Replace proof" : "Upload 2D proof"}
          </span>
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>

        {detectMsg && <p className="text-sm text-gray-500 mb-4">{detectMsg}</p>}

        {imgEl && (
          <div className="grid md:grid-cols-[1fr_280px] gap-8">
            {/* Corner editor */}
            <div
              ref={imgBoxRef}
              className="relative select-none border border-gray-200 rounded-lg overflow-hidden touch-none"
              style={{ aspectRatio: `${imgEl.naturalWidth} / ${imgEl.naturalHeight}` }}
              onPointerMove={onPointerMove}
              onPointerUp={() => (dragIdx.current = -1)}
              onPointerLeave={() => (dragIdx.current = -1)}
            >
              <img src={imgEl.src} alt="proof" className="w-full h-full object-contain pointer-events-none" draggable={false} />
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon
                  points={corners.map((c) => `${c.x * 100},${c.y * 100}`).join(" ")}
                  fill="rgba(59,130,246,0.12)" stroke="rgba(236,72,153,0.9)" strokeWidth="0.4"
                />
              </svg>
              {corners.map((c, i) => (
                <div key={i}
                  onPointerDown={(e) => { dragIdx.current = i; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
                  className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full bg-white border-2 border-pink-500 shadow-md flex items-center justify-center text-[9px] font-bold text-pink-600 cursor-grab active:cursor-grabbing touch-none"
                  style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                >
                  {CORNER_LABELS[i]}
                </div>
              ))}
            </div>

            {/* Controls */}
            <div className="space-y-4">
              <Field label="True width (in)" value={widthIn} onChange={setWidthIn} />
              <Field label="True height (in)" value={heightIn} onChange={setHeightIn} />
              <Field label="Bleed (in)" value={bleedIn} onChange={setBleedIn} />
              <Field label="Output long side (px)" value={longSide} onChange={setLongSide} />
              <button
                onClick={generate}
                disabled={busy}
                className="w-full py-3 rounded-lg bg-gray-900 text-white font-semibold disabled:opacity-50"
              >
                {busy ? "Flattening…" : "Generate print-ready file"}
              </button>
              {resultUrl && (
                <a href={resultUrl} download={downloadName}
                  className="block text-center w-full py-3 rounded-lg bg-gradient-to-r from-blue-500 to-pink-500 text-white font-semibold">
                  ⬇ Download for Brice
                </a>
              )}
            </div>
          </div>
        )}

        {/* Result */}
        {resultUrl && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold mb-2">Print-ready panel</h2>
            {resultDims && (
              <p className="text-sm text-gray-600 mb-3">
                {resultDims.w}×{resultDims.h}px &nbsp;·&nbsp; prints at {widthIn}″×{heightIn}″
                {parseFloat(bleedIn) > 0 ? ` + ${bleedIn}″ bleed` : ""} &nbsp;·&nbsp; vehicle removed, filled edge-to-edge
              </p>
            )}
            <img src={resultUrl} alt="flattened panel" className="max-w-full border border-gray-200 rounded-lg" />
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:outline-none"
      />
    </label>
  );
}
