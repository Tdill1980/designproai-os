import React, { useState, useRef, useEffect, useCallback } from "react";
import { Stage, Layer, Rect, Image as KonvaImage, Text, Transformer } from "react-konva";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, MousePointer2, Square, ChevronDown, ChevronUp, X } from "lucide-react";
import type { VinylZone } from "./types";

interface ZoneMaskerProps {
  imageUrl: string;
  zones: VinylZone[];
  onChange: (zones: VinylZone[]) => void;
}

let zoneCounter = 1;

const ZONE_COLORS = [
  "#3B82F6", // blue
  "#10B981", // green
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // purple
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#F97316", // orange
];

export function ZoneMasker({ imageUrl, zones, onChange }: ZoneMaskerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 450 });
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [tempRect, setTempRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"select" | "draw">("draw");
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const transformerRef = useRef<any>(null);
  const stageRef = useRef<any>(null);

  // Load image
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setImage(img);
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const scale = containerWidth / img.width;
        setStageSize({
          width: containerWidth,
          height: img.height * scale,
        });
      }
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && image) {
        const containerWidth = containerRef.current.offsetWidth;
        const scale = containerWidth / image.width;
        setStageSize({
          width: containerWidth,
          height: image.height * scale,
        });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [image]);

  // Update transformer when selection changes
  useEffect(() => {
    if (!transformerRef.current || !stageRef.current) return;
    const stage = stageRef.current;
    if (selectedId && mode === "select") {
      const node = stage.findOne(`#zone-${selectedId}`);
      if (node) {
        transformerRef.current.nodes([node]);
        transformerRef.current.getLayer()?.batchDraw();
        return;
      }
    }
    transformerRef.current.nodes([]);
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedId, mode, zones]);

  const pxToPercent = useCallback((px: number, dimension: number) => (px / dimension) * 100, []);
  const percentToPx = useCallback((pct: number, dimension: number) => (pct / 100) * dimension, []);

  const handleMouseDown = useCallback((e: any) => {
    if (mode !== "draw") {
      const clickedOnEmpty = e.target === e.target.getStage() || e.target.attrs?.id === "bg-image";
      if (clickedOnEmpty) setSelectedId(null);
      return;
    }

    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    setDrawing(true);
    setDrawStart(pos);
    setTempRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
  }, [mode]);

  const handleMouseMove = useCallback((e: any) => {
    if (!drawing || !drawStart) return;

    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    setTempRect({
      x: Math.min(drawStart.x, pos.x),
      y: Math.min(drawStart.y, pos.y),
      width: Math.abs(pos.x - drawStart.x),
      height: Math.abs(pos.y - drawStart.y),
    });
  }, [drawing, drawStart]);

  const handleMouseUp = useCallback(() => {
    if (!drawing || !tempRect) {
      setDrawing(false);
      setDrawStart(null);
      setTempRect(null);
      return;
    }

    // Min size check — 20px
    if (tempRect.width > 20 && tempRect.height > 20) {
      const newId = `zone-${Date.now()}-${zoneCounter++}`;
      const newZone: VinylZone = {
        id: newId,
        label: `Zone ${zones.length + 1}`,
        x: pxToPercent(tempRect.x, stageSize.width),
        y: pxToPercent(tempRect.y, stageSize.height),
        width: pxToPercent(tempRect.width, stageSize.width),
        height: pxToPercent(tempRect.height, stageSize.height),
        widthInches: 0,
        heightInches: 0,
        location: "",
        designPrompt: "",
      };
      onChange([...zones, newZone]);
      // Auto-expand the new zone for detail entry
      setExpandedZone(newId);
    }

    setDrawing(false);
    setDrawStart(null);
    setTempRect(null);
  }, [drawing, tempRect, zones, onChange, pxToPercent, stageSize]);

  const handleDragEnd = useCallback((id: string, e: any) => {
    const node = e.target;
    onChange(
      zones.map((z) =>
        z.id === id
          ? {
              ...z,
              x: pxToPercent(node.x(), stageSize.width),
              y: pxToPercent(node.y(), stageSize.height),
            }
          : z
      )
    );
  }, [zones, onChange, pxToPercent, stageSize]);

  const handleTransformEnd = useCallback((id: string, e: any) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    onChange(
      zones.map((z) =>
        z.id === id
          ? {
              ...z,
              x: pxToPercent(node.x(), stageSize.width),
              y: pxToPercent(node.y(), stageSize.height),
              width: pxToPercent(Math.max(20, node.width() * scaleX), stageSize.width),
              height: pxToPercent(Math.max(20, node.height() * scaleY), stageSize.height),
            }
          : z
      )
    );
  }, [zones, onChange, pxToPercent, stageSize]);

  const removeZone = useCallback((id: string) => {
    onChange(zones.filter((z) => z.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (expandedZone === id) setExpandedZone(null);
  }, [zones, onChange, selectedId, expandedZone]);

  const updateZone = useCallback((id: string, updates: Partial<VinylZone>) => {
    onChange(zones.map((z) => (z.id === id ? { ...z, ...updates } : z)));
  }, [zones, onChange]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button
          variant={mode === "draw" ? "default" : "outline"}
          size="sm"
          onClick={() => { setMode("draw"); setSelectedId(null); }}
          className={mode === "draw" ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white" : ""}
        >
          <Square className="w-3.5 h-3.5 mr-1.5" />
          Draw Zone
        </Button>
        <Button
          variant={mode === "select" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("select")}
          className={mode === "select" ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white" : ""}
        >
          <MousePointer2 className="w-3.5 h-3.5 mr-1.5" />
          Select
        </Button>
        {zones.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { onChange([]); setSelectedId(null); setExpandedZone(null); }}
            className="text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Clear All
          </Button>
        )}
        <span className="text-xs text-gray-500 ml-auto">
          {zones.length} zone{zones.length !== 1 ? "s" : ""} marked
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="border border-gray-200 rounded-lg overflow-hidden bg-white"
        style={{ cursor: mode === "draw" ? "crosshair" : "default" }}
      >
        {image && (
          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
          >
            <Layer>
              {/* Background image */}
              <KonvaImage
                id="bg-image"
                image={image}
                width={stageSize.width}
                height={stageSize.height}
              />

              {/* Existing zones — glassmorphism style so the AI / installer
                  can read placement at a glance. Cyan glow on top of the
                  zone color (matches GlassmorphismPanelOverlay). */}
              {zones.map((zone, i) => {
                const color = ZONE_COLORS[i % ZONE_COLORS.length];
                const x = percentToPx(zone.x, stageSize.width);
                const y = percentToPx(zone.y, stageSize.height);
                const w = percentToPx(zone.width, stageSize.width);
                const h = percentToPx(zone.height, stageSize.height);

                return (
                  <React.Fragment key={zone.id}>
                    {/* Glassmorphism halo — soft cyan glow behind every zone */}
                    <Rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      stroke="rgba(0, 220, 255, 0.85)"
                      strokeWidth={1}
                      fill="rgba(0, 120, 220, 0.10)"
                      cornerRadius={6}
                      shadowColor="rgba(0, 200, 255, 0.9)"
                      shadowBlur={18}
                      shadowOpacity={0.7}
                      listening={false}
                    />
                    <Rect
                      id={`zone-${zone.id}`}
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      stroke={color}
                      strokeWidth={2}
                      fill={`${color}1F`}
                      cornerRadius={6}
                      shadowColor={color}
                      shadowBlur={10}
                      shadowOpacity={0.55}
                      draggable={mode === "select"}
                      onClick={() => { if (mode === "select") setSelectedId(zone.id); }}
                      onTap={() => { if (mode === "select") setSelectedId(zone.id); }}
                      onDragEnd={(e) => handleDragEnd(zone.id, e)}
                      onTransformEnd={(e) => handleTransformEnd(zone.id, e)}
                    />
                    {/* Label background */}
                    <Rect
                      x={x}
                      y={y}
                      width={Math.min(w, zone.label.length * 8 + 12)}
                      height={20}
                      fill={color}
                      cornerRadius={[0, 0, 4, 0]}
                      listening={false}
                    />
                    {/* Label text */}
                    <Text
                      x={x + 4}
                      y={y + 4}
                      text={zone.label}
                      fontSize={11}
                      fontFamily="Inter, sans-serif"
                      fontStyle="bold"
                      fill="white"
                      listening={false}
                    />
                    {/* Dimension label at bottom of zone */}
                    {zone.widthInches > 0 && zone.heightInches > 0 && (
                      <>
                        <Rect
                          x={x}
                          y={y + h - 18}
                          width={Math.min(w, 100)}
                          height={18}
                          fill="rgba(0,0,0,0.6)"
                          cornerRadius={[4, 0, 0, 0]}
                          listening={false}
                        />
                        <Text
                          x={x + 4}
                          y={y + h - 14}
                          text={`${zone.widthInches}" × ${zone.heightInches}"`}
                          fontSize={10}
                          fontFamily="Inter, sans-serif"
                          fill="white"
                          listening={false}
                        />
                      </>
                    )}
                  </React.Fragment>
                );
              })}

              {/* Temp rectangle while drawing — cyan glass preview */}
              {tempRect && (
                <Rect
                  x={tempRect.x}
                  y={tempRect.y}
                  width={tempRect.width}
                  height={tempRect.height}
                  stroke="rgba(0, 220, 255, 1)"
                  strokeWidth={2}
                  dash={[6, 3]}
                  fill="rgba(0, 120, 220, 0.12)"
                  cornerRadius={6}
                  shadowColor="rgba(0, 200, 255, 0.9)"
                  shadowBlur={14}
                  shadowOpacity={0.6}
                />
              )}

              {/* Transformer for resize handles */}
              {mode === "select" && (
                <Transformer
                  ref={transformerRef}
                  rotateEnabled={false}
                  keepRatio={false}
                  anchorSize={8}
                  anchorCornerRadius={2}
                  borderStroke="#3B82F6"
                  anchorStroke="#3B82F6"
                  anchorFill="white"
                />
              )}
            </Layer>
          </Stage>
        )}
      </div>

      <p className="text-xs text-gray-500">
        {mode === "draw"
          ? "Click and drag to draw rectangles where vinyl should be applied"
          : "Click a zone to select, drag to move, use handles to resize"}
      </p>

      {/* Zone Detail Grid — every zone's textarea is visible at once so
          the customer can see the photo above AND type into each box
          without expanding accordions. Responsive: 1 col on phones,
          2 on tablets, 3 on desktop. Clicking a card highlights the
          matching rectangle on the canvas above. */}
      {zones.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {zones.map((zone, i) => {
            const isSelected = selectedId === zone.id;
            const color = ZONE_COLORS[i % ZONE_COLORS.length];
            return (
              <div
                key={zone.id}
                onClick={() => { setMode("select"); setSelectedId(zone.id); }}
                className={`rounded-lg border bg-gray-50 transition-colors cursor-pointer ${
                  isSelected ? "border-blue-500 ring-1 ring-blue-500/40 bg-blue-500/10" : "border-gray-200 hover:border-gray-300"
                }`}
              >
                {/* Header — color stripe + label + dimensions + remove */}
                <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-gray-200">
                  <div
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs font-bold text-gray-900 flex-1 truncate">
                    {zone.label}
                  </span>
                  {zone.widthInches > 0 && zone.heightInches > 0 && (
                    <span className="text-[10px] text-gray-500 shrink-0">
                      {zone.widthInches}" × {zone.heightInches}"
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeZone(zone.id); }}
                    className="w-5 h-5 rounded-full bg-red-500/20 hover:bg-red-500/40 flex items-center justify-center shrink-0 transition-colors"
                    title="Remove zone"
                  >
                    <X className="w-3 h-3 text-red-400" />
                  </button>
                </div>

                {/* Body — chips, textarea, dimensions */}
                <div className="p-3 space-y-2.5">
                  {/* Quick-pick chips. Fill / append to the textarea below. */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <Label className="text-[10px] text-gray-500 mb-1 block">What goes on this zone?</Label>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {[
                        { value: "logo + business name", label: "Logo + Name" },
                        { value: "phone number and website", label: "Phone + Web" },
                        { value: "website URL only", label: "Website" },
                        { value: "logo only", label: "Logo" },
                        { value: "tagline / slogan", label: "Tagline" },
                        { value: "logo, phone, website, hours", label: "All Contact" },
                        { value: "license number and certifications", label: "License" },
                        { value: "decorative accent stripe", label: "Accent" },
                        { value: "business hours", label: "Hours" },
                        { value: "social media handles", label: "Social" },
                      ].map((opt) => {
                        const active = zone.designPrompt.trim().toLowerCase() === opt.value.toLowerCase();
                        return (
                          <button
                            key={opt.value}
                            onClick={(e) => {
                              e.stopPropagation();
                              const existing = zone.designPrompt.trim();
                              if (active) {
                                updateZone(zone.id, { designPrompt: '' });
                              } else if (!existing || existing.length < 4) {
                                updateZone(zone.id, { designPrompt: opt.value });
                              } else {
                                updateZone(zone.id, { designPrompt: `${existing}, ${opt.value}` });
                              }
                            }}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                              active
                                ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white'
                                : 'border-gray-200 text-gray-600 hover:border-gray-200 hover:text-gray-900'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    <Textarea
                      value={zone.designPrompt}
                      onChange={(e) => updateZone(zone.id, { designPrompt: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                      placeholder={`What goes in ${zone.label}? e.g. "Big logo, phone 555-1234 below in white block letters"`}
                      className="text-xs bg-white border-gray-200 text-gray-900 min-h-[72px] resize-y"
                    />
                  </div>

                  {/* Dimensions W × H */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] text-gray-500">Width (in)</Label>
                      <Input
                        type="number"
                        value={zone.widthInches || ""}
                        onChange={(e) => updateZone(zone.id, { widthInches: Number(e.target.value) || 0 })}
                        min={1}
                        max={600}
                        className="mt-0.5 h-7 text-xs bg-white border-gray-200 text-gray-900"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-gray-500">Height (in)</Label>
                      <Input
                        type="number"
                        value={zone.heightInches || ""}
                        onChange={(e) => updateZone(zone.id, { heightInches: Number(e.target.value) || 0 })}
                        min={1}
                        max={600}
                        className="mt-0.5 h-7 text-xs bg-white border-gray-200 text-gray-900"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
