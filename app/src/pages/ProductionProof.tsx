import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, FileArchive, Loader2, Image, Printer } from "lucide-react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import UTIF from "utif2";

// ── PVO Crop Zones (Mercedes Sprinter High Roof Extended 2018) ──
interface CropZone {
  id: number;
  name: string;
  widthInches: number;
  heightInches: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

const SPRINTER_ZONES: CropZone[] = [
  { id: 1, name: "DRIVER SIDE", widthInches: 192, heightInches: 83, xPct: 0, yPct: 0.02, wPct: 0.50, hPct: 0.28 },
  { id: 3, name: "DRIVER DOOR", widthInches: 52, heightInches: 83, xPct: 0.52, yPct: 0.02, wPct: 0.22, hPct: 0.28 },
  { id: 4, name: "PASSENGER SIDE", widthInches: 192, heightInches: 83, xPct: 0, yPct: 0.32, wPct: 0.50, hPct: 0.28 },
  { id: 6, name: "PASSENGER DOOR", widthInches: 52, heightInches: 83, xPct: 0.52, yPct: 0.32, wPct: 0.22, hPct: 0.28 },
  { id: 7, name: "HOOD", widthInches: 89, heightInches: 37, xPct: 0, yPct: 0.64, wPct: 0.25, hPct: 0.18 },
  { id: 9, name: "REAR DOORS", widthInches: 39, heightInches: 88, xPct: 0.27, yPct: 0.64, wPct: 0.18, hPct: 0.18 },
  { id: 8, name: "ROOF", widthInches: 142, heightInches: 17, xPct: 0.47, yPct: 0.64, wPct: 0.35, hPct: 0.05 },
  { id: 2, name: "DRIVER REAR QTR", widthInches: 56.5, heightInches: 19, xPct: 0.47, yPct: 0.72, wPct: 0.15, hPct: 0.08 },
  { id: 5, name: "PASSENGER REAR QTR", widthInches: 56.5, heightInches: 19, xPct: 0.63, yPct: 0.72, wPct: 0.15, hPct: 0.08 },
  { id: 10, name: "FRONT BUMPER", widthInches: 59, heightInches: 23, xPct: 0.47, yPct: 0.82, wPct: 0.12, hPct: 0.08 },
  { id: 11, name: "REAR BUMPER", widthInches: 56, heightInches: 17, xPct: 0.60, yPct: 0.82, wPct: 0.12, hPct: 0.08 },
  { id: 12, name: "DRIVER FRONT QTR", widthInches: 77, heightInches: 45, xPct: 0.74, yPct: 0.64, wPct: 0.12, hPct: 0.12 },
  { id: 13, name: "PASSENGER FRONT QTR", widthInches: 77, heightInches: 45, xPct: 0.87, yPct: 0.64, wPct: 0.12, hPct: 0.12 },
  { id: 14, name: "CAB UPPER", widthInches: 44, heightInches: 36, xPct: 0.74, yPct: 0.78, wPct: 0.12, hPct: 0.10 },
];

const BLEED = 1.5; // inches per side
const DPI_PRINT = 1500; // 10% scale files — RIP software scales to 150 DPI at full size

/**
 * Convert a canvas to TIFF with embedded DPI metadata (1500 DPI).
 * 10% scale artboard at 1500 DPI → RIP scales 1000% → 150 DPI at full print size.
 */
function canvasToTiff(canvas: HTMLCanvasElement, dpi = DPI_PRINT): Uint8Array {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const rgba = imageData.data;

  // UTIF.encodeImage expects RGBA buffer
  const ifd: Record<string, any> = {
    t256: [w],                    // ImageWidth
    t257: [h],                    // ImageLength
    t258: [8, 8, 8, 8],          // BitsPerSample (RGBA)
    t259: [1],                    // Compression: None
    t262: [2],                    // PhotometricInterpretation: RGB
    t273: [0],                    // StripOffsets (placeholder)
    t277: [4],                    // SamplesPerPixel
    t278: [h],                    // RowsPerStrip
    t279: [w * h * 4],           // StripByteCounts
    t282: [dpi],                  // XResolution
    t283: [dpi],                  // YResolution
    t296: [2],                    // ResolutionUnit: inches
    t338: [2],                    // ExtraSamples: unassociated alpha
  };

  const tiffBytes = UTIF.encodeImage(rgba, w, h, ifd);
  return new Uint8Array(tiffBytes);
}

interface ExtractedPanel {
  zone: CropZone;
  blob: Blob;
  tiffBlob: Blob;
  dataUrl: string;
  pixelW: number;
  pixelH: number;
  filename: string;
  tiffFilename: string;
}

function calcPrintSpecs(zone: CropZone) {
  const printW = zone.widthInches;
  const printH = zone.heightInches;
  const bleedW = printW + BLEED * 2;
  const bleedH = printH + BLEED * 2;
  const sqft = ((printW * printH) / 144).toFixed(1);
  return { printW, printH, bleedW, bleedH, sqft };
}

export default function ProductionProof() {
  const [artboardUrl, setArtboardUrl] = useState("");
  const [companyName, setCompanyName] = useState("Eds Smokehouse BBQ");
  const [vehicleDesc, setVehicleDesc] = useState("2018 Mercedes-Benz Sprinter High Roof Extended");
  const [designerName, setDesignerName] = useState("@trish");
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [artboardImg, setArtboardImg] = useState<HTMLImageElement | null>(null);
  const [panels, setPanels] = useState<ExtractedPanel[]>([]);
  const [zipping, setZipping] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Default to latest master artboard via serve-image
  const defaultUrl = "https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/serve-image?path=production-packs/test-master/temp/master-v2-landscape/master-artboard.png";

  const loadArtboard = useCallback(async () => {
    setLoading(true);
    setPanels([]);
    const url = artboardUrl || defaultUrl;

    try {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load artboard image"));
        img.src = url;
      });
      setArtboardImg(img);
    } catch (err: any) {
      alert(`Failed to load artboard: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [artboardUrl]);

  // Extract panels from artboard using Canvas crop
  const extractPanels = useCallback(async () => {
    if (!artboardImg) return;
    setExtracting(true);

    const extracted: ExtractedPanel[] = [];
    const { naturalWidth: imgW, naturalHeight: imgH } = artboardImg;

    for (const zone of SPRINTER_ZONES) {
      const sx = Math.round(zone.xPct * imgW);
      const sy = Math.round(zone.yPct * imgH);
      const sw = Math.round(zone.wPct * imgW);
      const sh = Math.round(zone.hPct * imgH);

      if (sw <= 0 || sh <= 0) continue;

      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(artboardImg, sx, sy, sw, sh, 0, 0, sw, sh);

      const slug = zone.name.toLowerCase().replace(/[\s\/]+/g, "-");
      const filename = `${vehicleDesc.replace(/\s+/g, "_")}_${slug}_1500dpi.png`;
      const tiffFilename = `${vehicleDesc.replace(/\s+/g, "_")}_${slug}_1500dpi.tiff`;

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), "image/png");
      });

      // Generate TIFF with 1500 DPI metadata
      const tiffBytes = canvasToTiff(canvas, DPI_PRINT);
      const tiffBlob = new Blob([tiffBytes], { type: "image/tiff" });

      const dataUrl = canvas.toDataURL("image/png");

      extracted.push({
        zone,
        blob,
        tiffBlob,
        dataUrl,
        pixelW: sw,
        pixelH: sh,
        filename,
        tiffFilename,
      });
    }

    setPanels(extracted);
    setExtracting(false);
  }, [artboardImg, vehicleDesc]);

  // Auto-extract when artboard loads
  useEffect(() => {
    if (artboardImg) extractPanels();
  }, [artboardImg, extractPanels]);

  // Download ZIP with artboard + extracted panels + proof sheet
  const downloadZip = useCallback(async () => {
    if (!artboardImg || panels.length === 0) return;
    setZipping(true);

    try {
      const zip = new JSZip();
      const packName = `${companyName.replace(/\s+/g, "_")}_Production_Pack`;
      const folder = zip.folder(packName)!;

      // 1. Master Artboard — TIFF at 1500 DPI + PNG preview
      const artboardResp = await fetch(artboardUrl || defaultUrl);
      const artboardBlob = await artboardResp.blob();
      folder.file("00-MASTER-ARTBOARD.png", artboardBlob);

      // Convert artboard to TIFF with 1500 DPI
      const artboardCanvas = document.createElement("canvas");
      artboardCanvas.width = artboardImg.naturalWidth;
      artboardCanvas.height = artboardImg.naturalHeight;
      const artCtx = artboardCanvas.getContext("2d")!;
      artCtx.drawImage(artboardImg, 0, 0);
      const artboardTiff = canvasToTiff(artboardCanvas, DPI_PRINT);
      folder.file("00-MASTER-ARTBOARD_1500dpi.tiff", artboardTiff);

      // 2. Extracted panels — TIFFs (print files) + PNGs (previews)
      const tiffFolder = folder.folder("panels-tiff-1500dpi")!;
      const pngFolder = folder.folder("panels-png-preview")!;
      for (const panel of panels) {
        tiffFolder.file(panel.tiffFilename, panel.tiffBlob);
        pngFolder.file(panel.filename, panel.blob);
      }

      // 3. Production Proof Sheet (PNG — for client approval)
      const proofCanvas = generateProofSheet(panels, artboardImg);
      const proofBlob = await new Promise<Blob>((resolve) => {
        proofCanvas.toBlob((b) => resolve(b!), "image/png");
      });
      folder.file("PRODUCTION-PROOF.png", proofBlob);

      // 4. Panel specs JSON
      const specs = {
        company: companyName,
        vehicle: vehicleDesc,
        designer: designerName,
        date: new Date().toISOString().split("T")[0],
        artboardPixels: `${artboardImg.naturalWidth} × ${artboardImg.naturalHeight}`,
        dpiStrategy: "10% scale at 1500 DPI — RIP software scales 1000% to 150 DPI at full print size",
        totalPanels: panels.length,
        totalSqft: panels.reduce((sum, p) => sum + parseFloat(calcPrintSpecs(p.zone).sqft), 0).toFixed(0),
        panels: panels.map((p) => {
          const specs = calcPrintSpecs(p.zone);
          return {
            name: p.zone.name,
            tiffFile: p.tiffFilename,
            pngPreview: p.filename,
            printSize: `${specs.printW}" × ${specs.printH}"`,
            withBleed: `${specs.bleedW}" × ${specs.bleedH}"`,
            pixelDims: `${p.pixelW} × ${p.pixelH}`,
            embeddedDPI: "1500 DPI (10% scale — set RIP to scale 1000%)",
            coverage: `${specs.sqft} sqft`,
          };
        }),
        zipContents: [
          "00-MASTER-ARTBOARD_1500dpi.tiff — Full artboard TIFF with 1500 DPI metadata",
          "00-MASTER-ARTBOARD.png — PNG preview",
          "panels-tiff-1500dpi/ — Individual panel TIFFs for print production",
          "panels-png-preview/ — PNG previews for quick viewing",
          "PRODUCTION-PROOF.png — Branded proof sheet for client approval",
          "panel-specs.json — This file",
        ],
      };
      folder.file("panel-specs.json", JSON.stringify(specs, null, 2));

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `${packName}.zip`);
    } catch (err: any) {
      alert(`ZIP failed: ${err.message}`);
    } finally {
      setZipping(false);
    }
  }, [artboardImg, panels, artboardUrl, companyName, vehicleDesc, designerName]);

  // Generate proof sheet canvas
  function generateProofSheet(panels: ExtractedPanel[], artboard: HTMLImageElement): HTMLCanvasElement {
    const W = 2400;
    const H = 3200;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    // Background
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    // Header
    ctx.fillStyle = "#00C7FF";
    ctx.font = "bold 48px sans-serif";
    ctx.fillText("DesignProAI™", 40, 70);
    ctx.fillStyle = "#888";
    ctx.font = "20px sans-serif";
    ctx.fillText("AI-Powered Vehicle Graphics Studio", 40, 100);
    ctx.fillStyle = "#FF4444";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText("PANEL PRODUCTION PROOF - PRINT-READY FILES", 40, 145);

    // Vehicle info (right side)
    ctx.fillStyle = "#fff";
    ctx.font = "bold 32px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(vehicleDesc, W - 40, 55);
    ctx.font = "22px sans-serif";
    ctx.fillStyle = "#ccc";
    ctx.fillText(companyName, W - 40, 85);
    ctx.fillText(`Designer: ${designerName}`, W - 40, 115);
    ctx.fillText(new Date().toLocaleDateString(), W - 40, 145);
    ctx.textAlign = "left";

    // Divider
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, 170);
    ctx.lineTo(W - 40, 170);
    ctx.stroke();

    // Panel cards — 2 columns
    const colW = (W - 120) / 2;
    const startY = 190;
    let row = 0;

    // Show hero panels first (driver, passenger), then smaller panels
    const sortedPanels = [...panels].sort((a, b) => {
      const order = [1, 4, 3, 6, 7, 9, 8, 2, 5, 12, 13, 10, 11, 14];
      return order.indexOf(a.zone.id) - order.indexOf(b.zone.id);
    });

    sortedPanels.forEach((panel, idx) => {
      const col = idx % 2;
      if (col === 0 && idx > 0) row++;

      const x = 40 + col * (colW + 40);
      const y = startY + row * 380;

      if (y + 380 > H) return; // overflow guard

      const specs = calcPrintSpecs(panel.zone);

      // Card background
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(x, y, colW, 360);

      // Panel name header bar
      ctx.fillStyle = "#333";
      ctx.fillRect(x, y, colW, 36);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(panel.zone.name, x + 10, y + 25);
      ctx.fillStyle = "#888";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(panel.filename, x + colW - 10, y + 25);
      ctx.textAlign = "left";

      // Specs
      const specY = y + 55;
      ctx.fillStyle = "#aaa";
      ctx.font = "15px sans-serif";
      ctx.fillText(`Print Size:`, x + 10, specY);
      ctx.fillText(`With Bleed:`, x + 10, specY + 22);
      ctx.fillText(`Coverage:`, x + 10, specY + 44);

      ctx.fillStyle = "#fff";
      ctx.fillText(`${specs.printW}" × ${specs.printH}"`, x + 120, specY);
      ctx.fillText(`${specs.bleedW}" × ${specs.bleedH}"`, x + 120, specY + 22);
      ctx.fillText(`${specs.sqft} sq ft`, x + 120, specY + 44);

      ctx.fillStyle = "#aaa";
      ctx.fillText(`Pixel Dims:`, x + colW / 2, specY);
      ctx.fillText(`DPI:`, x + colW / 2, specY + 22);

      ctx.fillStyle = "#fff";
      ctx.fillText(`${panel.pixelW} × ${panel.pixelH}`, x + colW / 2 + 100, specY);
      ctx.fillStyle = "#00C7FF";
      ctx.fillText(`@ 1500 DPI (10% scale)`, x + colW / 2 + 100, specY + 22);

      // Thumbnail
      const thumbY = specY + 70;
      const thumbH = 230;
      const thumbW = colW - 20;
      const imgAspect = panel.pixelW / panel.pixelH;
      let drawW = thumbW;
      let drawH = thumbW / imgAspect;
      if (drawH > thumbH) {
        drawH = thumbH;
        drawW = thumbH * imgAspect;
      }
      const drawX = x + 10 + (thumbW - drawW) / 2;
      const drawY = thumbY + (thumbH - drawH) / 2;

      // Gray background for thumbnail area
      ctx.fillStyle = "#111";
      ctx.fillRect(x + 10, thumbY, thumbW, thumbH);

      // Draw the panel thumbnail
      const thumbImg = new window.Image();
      thumbImg.src = panel.dataUrl;
      try {
        ctx.drawImage(thumbImg, drawX, drawY, drawW, drawH);
      } catch {
        // Image might not be ready synchronously, but dataUrl should be instant
      }
    });

    // Footer
    ctx.fillStyle = "#444";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      `Generated by DesignProAI™ — ${panels.length} panels | ${panels.reduce((s, p) => s + parseFloat(calcPrintSpecs(p.zone).sqft), 0).toFixed(0)} total sqft | ${new Date().toLocaleString()}`,
      W / 2,
      H - 20,
    );
    ctx.textAlign = "left";

    return canvas;
  }

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">
              <span className="text-cyan-400">Production</span> Proof Generator
            </h1>
            <p className="text-gray-400 mt-1">
              Extract print-ready panels from master artboard + generate branded proof sheet
            </p>
          </div>
          <div className="flex gap-3">
            {panels.length > 0 && (
              <Button
                onClick={downloadZip}
                disabled={zipping}
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold"
              >
                {zipping ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building ZIP...</>
                ) : (
                  <><FileArchive className="mr-2 h-4 w-4" /> Download Production Pack</>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Config */}
        <Card className="bg-zinc-900 border-zinc-700 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label className="text-gray-400">Company Name</Label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="bg-zinc-800 border-zinc-600"
              />
            </div>
            <div>
              <Label className="text-gray-400">Vehicle</Label>
              <Input
                value={vehicleDesc}
                onChange={(e) => setVehicleDesc(e.target.value)}
                className="bg-zinc-800 border-zinc-600"
              />
            </div>
            <div>
              <Label className="text-gray-400">Designer</Label>
              <Input
                value={designerName}
                onChange={(e) => setDesignerName(e.target.value)}
                className="bg-zinc-800 border-zinc-600"
              />
            </div>
            <div>
              <Label className="text-gray-400">Artboard URL (or use default)</Label>
              <Input
                value={artboardUrl}
                onChange={(e) => setArtboardUrl(e.target.value)}
                placeholder="Leave blank for latest master artboard"
                className="bg-zinc-800 border-zinc-600"
              />
            </div>
          </div>
          <Button
            onClick={loadArtboard}
            disabled={loading}
            className="mt-4 bg-white text-black hover:bg-gray-200 font-bold"
          >
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Artboard...</>
            ) : (
              <><Image className="mr-2 h-4 w-4" /> Load & Extract Panels</>
            )}
          </Button>
        </Card>

        {/* Master Artboard Preview */}
        {artboardImg && (
          <Card className="bg-zinc-900 border-zinc-700 p-4 mb-6">
            <h2 className="text-lg font-bold mb-2 text-cyan-400">Master Artboard</h2>
            <p className="text-sm text-gray-400 mb-3">
              {artboardImg.naturalWidth} × {artboardImg.naturalHeight} px — Single-call generation, all panels unified
            </p>
            <img
              src={artboardImg.src}
              alt="Master Artboard"
              className="w-full rounded border border-zinc-700"
            />
          </Card>
        )}

        {/* Extracting indicator */}
        {extracting && (
          <div className="flex items-center gap-3 text-cyan-400 mb-6">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Extracting {SPRINTER_ZONES.length} panels from artboard...</span>
          </div>
        )}

        {/* Extracted Panels Grid */}
        {panels.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">
                <Printer className="inline mr-2 h-5 w-5 text-cyan-400" />
                Extracted Print Panels ({panels.length})
              </h2>
              <p className="text-gray-400">
                Total coverage: {panels.reduce((s, p) => s + parseFloat(calcPrintSpecs(p.zone).sqft), 0).toFixed(0)} sqft
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {panels
                .sort((a, b) => a.zone.id - b.zone.id)
                .map((panel) => {
                  const specs = calcPrintSpecs(panel.zone);
                  return (
                    <Card key={panel.zone.id} className="bg-zinc-900 border-zinc-700 overflow-hidden">
                      {/* Panel header */}
                      <div className="bg-zinc-800 px-4 py-2 flex justify-between items-center">
                        <span className="font-bold text-sm text-white">{panel.zone.name}</span>
                        <span className="text-xs text-gray-400">{panel.filename}</span>
                      </div>

                      {/* Specs row */}
                      <div className="px-4 py-2 grid grid-cols-2 gap-1 text-xs border-b border-zinc-700">
                        <div>
                          <span className="text-gray-500">Print Size: </span>
                          <span className="text-white">{specs.printW}" × {specs.printH}"</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Pixel Dims: </span>
                          <span className="text-white">{panel.pixelW} × {panel.pixelH}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">With Bleed: </span>
                          <span className="text-white">{specs.bleedW}" × {specs.bleedH}"</span>
                        </div>
                        <div>
                          <span className="text-gray-500">DPI: </span>
                          <span className="text-cyan-400 font-bold">@ 1500 DPI (10% scale)</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Coverage: </span>
                          <span className="text-white">{specs.sqft} sqft</span>
                        </div>
                      </div>

                      {/* Thumbnail */}
                      <div className="p-3 bg-zinc-950">
                        <img
                          src={panel.dataUrl}
                          alt={panel.zone.name}
                          className="w-full rounded"
                        />
                      </div>

                      {/* Download individual */}
                      <div className="p-2 flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-cyan-400 hover:text-cyan-300"
                          onClick={() => saveAs(panel.blob, panel.filename)}
                        >
                          <Download className="h-3 w-3 mr-1" /> Download
                        </Button>
                      </div>
                    </Card>
                  );
                })}
            </div>
          </>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
