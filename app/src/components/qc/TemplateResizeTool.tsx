/**
 * TemplateResizeTool — Konva canvas for scaling/positioning designs onto vehicle templates
 *
 * Step 2 of the QC pipeline: operator selects a template, loads a design image,
 * drags/scales/rotates it to fit, then exports at production DPI.
 */

import { useEffect, useRef, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Transformer } from "react-konva";
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
  Maximize,
  Move,
  Download,
  Loader2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  RotateCcw,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { useTemplateResize, type TemplateInfo } from "@/hooks/useTemplateResize";

interface Props {
  vehicleMake?: string;
  vehicleModel?: string;
  jobId?: string;
  userId?: string;
  /** Flat panel URLs from the artboard or renders — operator picks one to resize */
  designUrls?: { label: string; url: string }[];
}

// Maximum viewport pixels (keeps the canvas interactive)
const MAX_VIEWPORT_W = 800;
const MAX_VIEWPORT_H = 500;

const DPI_OPTIONS = [
  { value: 72, label: "72 DPI (Screen)" },
  { value: 150, label: "150 DPI (Standard)" },
  { value: 300, label: "300 DPI (High-Res)" },
];

export default function TemplateResizeTool({
  vehicleMake,
  vehicleModel,
  jobId,
  userId,
  designUrls,
}: Props) {
  const {
    templates,
    selectedTemplate,
    templateImage,
    loadTemplateImage,
    designImage,
    loadDesignImage,
    dpi,
    setDpi,
    aspectLocked,
    setAspectLocked,
    showTemplate,
    setShowTemplate,
    transform,
    setTransform,
    fitToTemplate,
    fillTemplate,
    centerDesign,
    exportCanvas,
    exporting,
    exportedUrl,
    stageRef,
  } = useTemplateResize({ vehicleMake, vehicleModel, jobId, userId });

  const designNodeRef = useRef<Konva.Image>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  // Attach transformer to design image when it loads
  useEffect(() => {
    if (designNodeRef.current && transformerRef.current) {
      transformerRef.current.nodes([designNodeRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [designImage, selectedTemplate]);

  // Compute viewport scale: fit the template into MAX_VIEWPORT
  const viewScale = selectedTemplate
    ? Math.min(
        MAX_VIEWPORT_W / (selectedTemplate.width_inches * dpi),
        MAX_VIEWPORT_H / (selectedTemplate.height_inches * dpi),
        1, // never upscale the viewport
      )
    : 1;

  const viewW = selectedTemplate
    ? Math.round(selectedTemplate.width_inches * dpi * viewScale)
    : MAX_VIEWPORT_W;
  const viewH = selectedTemplate
    ? Math.round(selectedTemplate.height_inches * dpi * viewScale)
    : MAX_VIEWPORT_H;

  // Handle transform end (drag / resize / rotate)
  const handleTransformEnd = useCallback(() => {
    const node = designNodeRef.current;
    if (!node) return;
    setTransform({
      x: node.x(),
      y: node.y(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
      rotation: node.rotation(),
    });
  }, [setTransform]);

  const handleDragEnd = useCallback(() => {
    const node = designNodeRef.current;
    if (!node) return;
    setTransform((prev) => ({ ...prev, x: node.x(), y: node.y() }));
  }, [setTransform]);

  const handleExport = useCallback(async () => {
    try {
      const result = await exportCanvas();
      if (result) {
        toast.success(
          `Exported: ${result.widthPx} x ${result.heightPx}px at ${result.dpi} DPI`,
        );
      }
    } catch (err: any) {
      toast.error(err.message || "Export failed");
    }
  }, [exportCanvas]);

  // No templates available — hide entirely
  if (!templates.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-['Montserrat'] flex items-center gap-2">
          <ZoomIn className="w-4 h-4 text-cyan-400" />
          Resize Tool
          <Badge variant="outline" className="text-[10px] ml-auto">
            Step 2
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ── Template Selector ── */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Vehicle Template
          </label>
          <Select
            value={selectedTemplate?.id || ""}
            onValueChange={(id) => {
              const tmpl = templates.find((t) => t.id === id);
              if (tmpl) loadTemplateImage(tmpl);
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select a template..." />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.original_filename} — {t.panel_type} ({t.width_inches}" x{" "}
                  {t.height_inches}")
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ── Design Image Selector ── */}
        {selectedTemplate && designUrls && designUrls.length > 0 && (
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Design Image
            </label>
            <Select
              value={designUrls.find((d) => d.url === (designImage ? "" : ""))?.url || ""}
              onValueChange={(url) => loadDesignImage(url)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select a design..." />
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
        )}

        {/* ── Controls Row ── */}
        {selectedTemplate && (
          <div className="flex flex-wrap gap-1.5">
            {/* DPI */}
            <Select
              value={String(dpi)}
              onValueChange={(v) => setDpi(Number(v))}
            >
              <SelectTrigger className="h-7 text-[10px] w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DPI_OPTIONS.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] px-2"
              onClick={() => setAspectLocked(!aspectLocked)}
              title={aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
            >
              {aspectLocked ? (
                <Lock className="w-3 h-3 mr-1" />
              ) : (
                <Unlock className="w-3 h-3 mr-1" />
              )}
              {aspectLocked ? "Locked" : "Free"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] px-2"
              onClick={() => setShowTemplate(!showTemplate)}
              title={showTemplate ? "Hide template" : "Show template"}
            >
              {showTemplate ? (
                <Eye className="w-3 h-3 mr-1" />
              ) : (
                <EyeOff className="w-3 h-3 mr-1" />
              )}
              Template
            </Button>

            {designImage && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] px-2"
                  onClick={fitToTemplate}
                  title="Fit design inside template (letterbox)"
                >
                  <Maximize className="w-3 h-3 mr-1" />
                  Fit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] px-2"
                  onClick={fillTemplate}
                  title="Fill template (cover, may crop)"
                >
                  <ZoomIn className="w-3 h-3 mr-1" />
                  Fill
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] px-2"
                  onClick={centerDesign}
                  title="Center design"
                >
                  <Move className="w-3 h-3 mr-1" />
                  Center
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] px-2"
                  onClick={() =>
                    setTransform({
                      x: 0,
                      y: 0,
                      scaleX: 1,
                      scaleY: 1,
                      rotation: 0,
                    })
                  }
                  title="Reset transform"
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Reset
                </Button>
              </>
            )}
          </div>
        )}

        {/* ── Canvas ── */}
        {selectedTemplate && (
          <div
            className="border border-border rounded-md overflow-hidden bg-zinc-900"
            style={{ width: viewW, height: viewH }}
          >
            <Stage
              width={viewW}
              height={viewH}
              scaleX={viewScale}
              scaleY={viewScale}
              ref={(node) => {
                stageRef.current = node as any;
              }}
            >
              <Layer>
                {/* Background — white artboard area */}
                <Rect
                  x={0}
                  y={0}
                  width={selectedTemplate.width_inches * dpi}
                  height={selectedTemplate.height_inches * dpi}
                  fill="#ffffff"
                />

                {/* Design image — draggable, resizable */}
                {designImage && (
                  <KonvaImage
                    ref={designNodeRef}
                    image={designImage}
                    x={transform.x}
                    y={transform.y}
                    scaleX={transform.scaleX}
                    scaleY={transform.scaleY}
                    rotation={transform.rotation}
                    draggable
                    onDragEnd={handleDragEnd}
                    onTransformEnd={handleTransformEnd}
                  />
                )}

                {/* Template overlay — semi-transparent on top */}
                {showTemplate && templateImage && (
                  <KonvaImage
                    image={templateImage}
                    x={0}
                    y={0}
                    width={selectedTemplate.width_inches * dpi}
                    height={selectedTemplate.height_inches * dpi}
                    opacity={0.4}
                    listening={false}
                  />
                )}

                {/* Transformer handles */}
                {designImage && (
                  <Transformer
                    ref={transformerRef}
                    keepRatio={aspectLocked}
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
                    boundBoxFunc={(oldBox, newBox) => {
                      // Minimum size
                      if (newBox.width < 10 || newBox.height < 10) return oldBox;
                      return newBox;
                    }}
                  />
                )}
              </Layer>
            </Stage>
          </div>
        )}

        {/* ── Dimensions Info ── */}
        {selectedTemplate && (
          <div className="flex gap-3 text-[10px] text-muted-foreground">
            <span>
              Template: {selectedTemplate.width_inches}" x{" "}
              {selectedTemplate.height_inches}"
            </span>
            <span>
              Export:{" "}
              {Math.round(selectedTemplate.width_inches * dpi)} x{" "}
              {Math.round(selectedTemplate.height_inches * dpi)}px
            </span>
            <span>DPI: {dpi}</span>
          </div>
        )}

        {/* ── Export Button ── */}
        {selectedTemplate && designImage && (
          <Button
            onClick={handleExport}
            disabled={exporting}
            className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Export Production Panel
          </Button>
        )}

        {/* ── Exported Result ── */}
        {exportedUrl && (
          <div className="p-2 rounded border border-green-500/30 bg-green-500/10">
            <p className="text-xs text-green-400 mb-1">Production panel exported</p>
            <a
              href={exportedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-cyan-400 underline break-all"
            >
              Download exported panel
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
