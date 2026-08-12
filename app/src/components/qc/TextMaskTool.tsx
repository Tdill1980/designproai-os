/**
 * TextMaskTool — Step 3: Detect text/logos, review masks, vectorize confirmed regions
 *
 * Uses Gemini Vision (via extract-logo-elements) to find text/logos in panel images,
 * shows editable bounding box overlays on a Konva canvas, and sends confirmed
 * regions to vectorize-it for clean SVG output.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Text } from "react-konva";
import Konva from "konva";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ScanSearch,
  Check,
  X,
  Plus,
  Download,
  Loader2,
  Trash2,
  FileCode,
} from "lucide-react";
import { toast } from "sonner";
import { useTextMaskDetect, type TextRegion } from "@/hooks/useTextMaskDetect";

interface Props {
  jobId?: string;
  userId?: string;
  designUrls?: { label: string; url: string }[];
}

const MAX_VIEWPORT_W = 800;
const MAX_VIEWPORT_H = 500;

const TYPE_COLORS: Record<string, string> = {
  text: "#00FF88",
  logo: "#FF6600",
  phone: "#FFCC00",
  url: "#00CCFF",
  graphic: "#FF44FF",
};

export default function TextMaskTool({ jobId, userId, designUrls }: Props) {
  const {
    regions,
    detecting,
    vectorizing,
    vectorResults,
    summary,
    setImageSize,
    detectRegions,
    toggleRegion,
    updateRegionBbox,
    addManualRegion,
    removeRegion,
    vectorizeConfirmed,
    exportMaskData,
  } = useTextMaskDetect({ jobId, userId });

  const [selectedUrl, setSelectedUrl] = useState("");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const rectRefs = useRef<Record<string, Konva.Rect>>({});

  // Load image when URL changes
  useEffect(() => {
    if (!selectedUrl) { setImage(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setImage(img);
      setImageSize({ w: img.width, h: img.height });
    };
    img.src = selectedUrl;
  }, [selectedUrl, setImageSize]);

  // Attach transformer to selected region rect
  useEffect(() => {
    if (!transformerRef.current) return;
    if (selectedRegionId && rectRefs.current[selectedRegionId]) {
      transformerRef.current.nodes([rectRefs.current[selectedRegionId]]);
    } else {
      transformerRef.current.nodes([]);
    }
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedRegionId, regions]);

  // Viewport scaling
  const viewScale = image
    ? Math.min(MAX_VIEWPORT_W / image.width, MAX_VIEWPORT_H / image.height, 1)
    : 1;
  const viewW = image ? Math.round(image.width * viewScale) : MAX_VIEWPORT_W;
  const viewH = image ? Math.round(image.height * viewScale) : 300;

  const handleDetect = useCallback(async () => {
    if (!selectedUrl) { toast.error("Select an image first"); return; }
    try {
      const found = await detectRegions(selectedUrl);
      toast.success(`Detected ${found?.length || 0} elements`);
    } catch (err: any) {
      toast.error(err.message || "Detection failed");
    }
  }, [selectedUrl, detectRegions]);

  const handleVectorize = useCallback(async () => {
    if (!selectedUrl) return;
    try {
      const results = await vectorizeConfirmed(selectedUrl);
      toast.success(`Vectorized ${results?.length || 0} regions`);
    } catch (err: any) {
      toast.error(err.message || "Vectorization failed");
    }
  }, [selectedUrl, vectorizeConfirmed]);

  const handleExportMask = useCallback(async () => {
    try {
      const path = await exportMaskData();
      toast.success(`Mask data exported: ${path}`);
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [exportMaskData]);

  // Handle region rect drag/resize end
  const handleRegionTransformEnd = useCallback(
    (regionId: string) => {
      const node = rectRefs.current[regionId];
      if (!node || !image) return;

      const x = node.x();
      const y = node.y();
      const w = node.width() * node.scaleX();
      const h = node.height() * node.scaleY();

      // Reset scale (we bake it into width/height)
      node.scaleX(1);
      node.scaleY(1);
      node.width(w);
      node.height(h);

      updateRegionBbox(regionId, {
        x: (x / image.width) * 100,
        y: (y / image.height) * 100,
        width: (w / image.width) * 100,
        height: (h / image.height) * 100,
      });
    },
    [image, updateRegionBbox],
  );

  // No design URLs — don't render
  if (!designUrls?.length) return null;

  const confirmedCount = regions.filter((r) => r.confirmed && !r.excluded).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-['Montserrat'] flex items-center gap-2">
          <ScanSearch className="w-4 h-4 text-cyan-400" />
          Text Mask + Vectorize
          <Badge variant="outline" className="text-[10px] ml-auto">
            Step 3
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ── Image Selector ── */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Panel Image
          </label>
          <Select value={selectedUrl} onValueChange={setSelectedUrl}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select a panel image..." />
            </SelectTrigger>
            <SelectContent>
              {designUrls.map((d) => (
                <SelectItem key={d.label} value={d.url}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ── Detect Button ── */}
        {selectedUrl && (
          <Button
            onClick={handleDetect}
            disabled={detecting}
            size="sm"
            className="w-full"
            variant="outline"
          >
            {detecting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <ScanSearch className="w-4 h-4 mr-2" />
            )}
            {detecting ? "Detecting..." : "Detect Text & Logos"}
          </Button>
        )}

        {/* ── Summary ── */}
        {summary && (
          <p className="text-xs text-muted-foreground">{summary}</p>
        )}

        {/* ── Canvas with overlays ── */}
        {image && (
          <div
            className="border border-border rounded-md overflow-hidden bg-zinc-900"
            style={{ width: viewW, height: viewH }}
          >
            <Stage
              width={viewW}
              height={viewH}
              scaleX={viewScale}
              scaleY={viewScale}
              ref={stageRef as any}
              onClick={(e) => {
                // Deselect when clicking empty space
                if (e.target === e.target.getStage()) setSelectedRegionId(null);
              }}
            >
              <Layer>
                {/* Panel image */}
                <KonvaImage
                  image={image}
                  x={0}
                  y={0}
                  width={image.width}
                  height={image.height}
                />

                {/* Region overlays */}
                {regions
                  .filter((r) => !r.excluded)
                  .map((r) => {
                    const color = TYPE_COLORS[r.type] || "#FFFFFF";
                    const x = (r.bbox.x / 100) * image.width;
                    const y = (r.bbox.y / 100) * image.height;
                    const w = (r.bbox.width / 100) * image.width;
                    const h = (r.bbox.height / 100) * image.height;

                    return (
                      <Rect
                        key={r.id}
                        ref={(node) => {
                          if (node) rectRefs.current[r.id] = node;
                        }}
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        stroke={color}
                        strokeWidth={2 / viewScale}
                        fill={r.confirmed ? `${color}20` : "transparent"}
                        dash={r.confirmed ? undefined : [6, 4]}
                        draggable
                        onClick={() => setSelectedRegionId(r.id)}
                        onTap={() => setSelectedRegionId(r.id)}
                        onDragEnd={() => handleRegionTransformEnd(r.id)}
                        onTransformEnd={() => handleRegionTransformEnd(r.id)}
                      />
                    );
                  })}

                {/* Region labels */}
                {regions
                  .filter((r) => !r.excluded)
                  .map((r) => {
                    const x = (r.bbox.x / 100) * image.width;
                    const y = (r.bbox.y / 100) * image.height;
                    return (
                      <Text
                        key={`label-${r.id}`}
                        x={x}
                        y={y - 16 / viewScale}
                        text={`${r.type.toUpperCase()}: ${r.label}`}
                        fontSize={11 / viewScale}
                        fill={TYPE_COLORS[r.type] || "#fff"}
                        listening={false}
                      />
                    );
                  })}

                {/* Transformer for selected region */}
                <Transformer
                  ref={transformerRef}
                  keepRatio={false}
                  enabledAnchors={[
                    "top-left",
                    "top-right",
                    "bottom-left",
                    "bottom-right",
                    "middle-left",
                    "middle-right",
                    "top-center",
                    "bottom-center",
                  ]}
                  rotateEnabled={false}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 5 || newBox.height < 5) return oldBox;
                    return newBox;
                  }}
                />
              </Layer>
            </Stage>
          </div>
        )}

        {/* ── Region List ── */}
        {regions.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Detected Regions ({confirmedCount} confirmed)
            </p>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {regions.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center justify-between p-1.5 rounded border text-xs ${
                    r.excluded
                      ? "border-red-500/30 bg-red-500/5 opacity-50"
                      : r.confirmed
                        ? "border-green-500/30 bg-green-500/5"
                        : "border-border bg-muted/30"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: TYPE_COLORS[r.type] }}
                    />
                    <span className="font-medium truncate">{r.label}</span>
                    {r.content && (
                      <span className="text-muted-foreground truncate">"{r.content}"</span>
                    )}
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {r.type}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {Math.round(r.confidence * 100)}%
                    </Badge>
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-green-400 hover:text-green-300"
                      onClick={() => toggleRegion(r.id, "confirmed")}
                      title="Confirm"
                    >
                      <Check className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                      onClick={() => toggleRegion(r.id, "excluded")}
                      title="Exclude"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-white"
                      onClick={() => removeRegion(r.id)}
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Action Buttons ── */}
        {image && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px]"
              onClick={addManualRegion}
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Region
            </Button>

            {confirmedCount > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px]"
                  onClick={handleExportMask}
                >
                  <Download className="w-3 h-3 mr-1" />
                  Export Mask JSON
                </Button>

                <Button
                  size="sm"
                  className="h-7 text-[10px] bg-gradient-to-r from-cyan-600 to-blue-600"
                  onClick={handleVectorize}
                  disabled={vectorizing}
                >
                  {vectorizing ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <FileCode className="w-3 h-3 mr-1" />
                  )}
                  Vectorize ({confirmedCount})
                </Button>
              </>
            )}
          </div>
        )}

        {/* ── Vector Results ── */}
        {vectorResults.length > 0 && (
          <div className="space-y-1 p-2 rounded border border-green-500/30 bg-green-500/10">
            <p className="text-xs text-green-400">Vectorized SVG Output</p>
            {vectorResults.map((vr) => (
              <div key={vr.regionId} className="flex items-center justify-between">
                <span className="text-[10px] text-white">{vr.label}</span>
                <a
                  href={vr.svgUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-cyan-400 underline"
                >
                  Download SVG
                </a>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
