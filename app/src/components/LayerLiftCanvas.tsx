/**
 * LayerLiftIQ™ Revision Studio — interactive Konva canvas (react-konva, HTML5 2D).
 *
 * Layer 1 (clean AI background art) is locked to the bottom; Layer 2 is the real
 * AI-generated TRANSPARENT PNG overlays (logos + text artwork) as Konva <Image>
 * nodes the client drags / scales via the Transformer at 60fps.
 *
 * Two render modes:
 *   - default (card): a self-contained white card with a header (used standalone).
 *   - embedded: fills its parent container responsively (ResizeObserver), no
 *     chrome — used to BE the center workspace viewport on /designpro.
 *
 * White-UI surface (customer-facing).
 */

import React, { useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Transformer, Rect, Group, Text, Circle } from "react-konva";
import { MousePointer2, SquarePlus, Trash2, Plus, Minus, Eye, EyeOff, Layers as LayersIcon, Lock, Wand2, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Minimal use-image replacement (same [image] tuple API). crossOrigin so the
// Konva canvas can be exported without tainting.
function useImage(url: string): [HTMLImageElement | undefined] {
  const [image, setImage] = useState<HTMLImageElement | undefined>(undefined);
  useEffect(() => {
    if (!url) { setImage(undefined); return; }
    let cancelled = false;
    // Load with crossOrigin first (needed for a clean canvas export). If the
    // storage object is served WITHOUT CORS headers, that load fails silently
    // and the overlay never appears — a counted-but-ungrabbable "ghost layer."
    // Retry once WITHOUT crossOrigin so the layer still displays and can be
    // moved (positions persist as numbers, not pixels, so a tainted canvas
    // doesn't affect the print slicer, which composites server-side).
    const load = (useCors: boolean) => {
      const img = new window.Image();
      if (useCors) img.crossOrigin = "anonymous";
      img.onload = () => { if (!cancelled) setImage(img); };
      img.onerror = () => { if (useCors && !cancelled) load(false); };
      img.src = url;
    };
    load(true);
    return () => { cancelled = true; };
  }, [url]);
  return [image];
}

export interface OverlayElement {
  id: string;
  url: string; // transparent AI-generated PNG (logo or text artwork)
  x: number;
  y: number;
  width?: number; // optional explicit box; defaults to the PNG's natural size
  height?: number;
  scaleX?: number;
  scaleY?: number;
  text?: string; // label (for the QC ledger), not rendered
  isLogo?: boolean;
  hidden?: boolean; // eye toggle in the Layers panel
  opacity?: number; // 0..1
  rotation?: number; // degrees — resolution-independent, scaled by the print slicer
}

// A request the user drops on the design ("I want a new X here") — feeds the
// AI/deterministic edit tool. Coordinates are normalized 0..1 of the stage so
// they survive any screen size / print scaling.
export interface LayerLiftRequest {
  prompt: string;
  xPct: number;
  yPct: number;
  wPct?: number;
  hPct?: number;
}

interface LayerLiftCanvasProps {
  backgroundUrl: string; // Layer 1 — clean background art (locked floor)
  initialOverlays: OverlayElement[]; // Layer 2 — AI transparent PNGs
  onLayoutUpdated: (updated: OverlayElement[], stage: { width: number; height: number }) => void;
  embedded?: boolean; // fill parent (center viewport) instead of a standalone card
  generating?: boolean; // show ACE progress floor while a design renders
  progress?: number; // optional 0-100 determinate progress; else indeterminate
  viewKey?: string; // active view (driver/passenger/hood/roof…) — flushes layers on change
  showcaseUrls?: string[]; // idle ACE showcase carousel (real design renders)
  // ── LayerLiftIQ tools ──────────────────────────────────────────
  tools?: boolean; // show the floating toolbar + Layers panel + draw-to-add
  onElementsChange?: (els: OverlayElement[]) => void; // delete / visibility / add (immediate, deterministic)
  onPromptAt?: (req: LayerLiftRequest) => void; // draw-box-to-add → AI fills the region (the one async step)
  // Click a logo/text node → "edit THIS element by prompt" → revision pipeline.
  onEditElement?: (req: { element: OverlayElement; prompt: string; xPct: number; yPct: number }) => void;
}

// ACE astronaut character drawn in the Konva window (centered, above text).
const AceCharacter: React.FC<{ cx: number; cy: number; size: number }> = ({ cx, cy, size }) => {
  const [ace] = useImage("/characters/ace-v2.png");
  if (!ace) return null;
  return <KonvaImage image={ace} x={cx - size / 2} y={cy - size / 2} width={size} height={size} listening={false} />;
};

// Empty-state floor — shown before any AI background exists. White UI, neutral
// label (no ACE mascot/prompt — this canvas is also used on QC/production views).
const EmptyFloor: React.FC<{ width: number; height: number }> = ({ width, height }) => {
  return (
    <Group listening={false}>
      <Rect x={0} y={0} width={width} height={height} fill="#ffffff" />
      <Text
        text="No artwork yet."
        x={0}
        y={Math.round(height / 2) - 10}
        width={width}
        align="center"
        fontSize={Math.max(14, Math.round(width * 0.018))}
        fontStyle="bold"
        fill="#94a3b8"
      />
    </Group>
  );
};

// ACE messages cycled while a design is generating.
const ACE_GENERATING_MESSAGES = [
  "ACE is sketching your concept…",
  "Laying down the base wrap…",
  "Designing your logo & lettering…",
  "Separating the clean layers…",
  "Polishing the driver-side render…",
];

// Generating floor — white-UI Konva window: ACE message + an animated
// blue-gradient-style progress bar (determinate if progress given, else a
// sweeping indeterminate bar). Drawn natively in Konva.
const GeneratingFloor: React.FC<{ width: number; height: number; progress?: number }> = ({ width, height, progress }) => {
  const [msgIdx, setMsgIdx] = useState(0);
  const [sweep, setSweep] = useState(0);
  useEffect(() => {
    const m = setInterval(() => setMsgIdx((i) => (i + 1) % ACE_GENERATING_MESSAGES.length), 2200);
    return () => clearInterval(m);
  }, []);
  useEffect(() => {
    if (typeof progress === "number") return; // determinate — no sweep
    let raf = 0;
    const tick = () => {
      setSweep((s) => (s + 0.012) % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  const barW = Math.round(width * 0.42);   // slimmer, centered
  const barX = Math.round((width - barW) / 2);
  const barY = Math.round(height / 2) + 14;
  const barH = 6;                          // thinner bar (was 10)
  const pct = typeof progress === "number" ? Math.max(0, Math.min(100, progress)) / 100 : null;
  const fillW = pct !== null ? Math.round(barW * pct) : Math.round(barW * 0.26);
  const fillX = pct !== null ? barX : barX + Math.round((barW - fillW) * sweep);

  const aceSize = Math.min(150, Math.round(height * 0.36));
  return (
    <Group listening={false}>
      <Rect x={0} y={0} width={width} height={height} fill="#ffffff" />
      {/* ACE astronaut */}
      <AceCharacter cx={width / 2} cy={Math.round(height / 2) - 52 - aceSize * 0.55} size={aceSize} />
      {/* ACE brand line */}
      <Text
        text="ACE — AI Creative Engine"
        x={Math.round(width * 0.08)}
        y={Math.round(height / 2) - 52}
        width={Math.round(width * 0.84)}
        align="center"
        fontSize={Math.max(11, Math.round(width * 0.013))}
        fontStyle="bold"
        fill="#6366f1"
      />
      <Text
        text={ACE_GENERATING_MESSAGES[msgIdx]}
        x={Math.round(width * 0.08)}
        y={Math.round(height / 2) - 26}
        width={Math.round(width * 0.84)}
        align="center"
        fontSize={Math.max(14, Math.round(width * 0.019))}
        fontStyle="bold"
        fill="#1e293b"
      />
      {/* track */}
      <Rect x={barX} y={barY} width={barW} height={barH} cornerRadius={barH / 2} fill="#e2e8f0" />
      {/* fill (blue→magenta gradient) */}
      <Rect
        x={fillX}
        y={barY}
        width={fillW}
        height={barH}
        cornerRadius={barH / 2}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: fillW, y: 0 }}
        fillLinearGradientColorStops={[0, "#3b82f6", 1, "#ec4899"]}
      />
      {pct !== null && (
        <Text
          text={`${Math.round(pct * 100)}%`}
          x={barX}
          y={barY + barH + 8}
          width={barW}
          align="center"
          fontSize={12}
          fill="#94a3b8"
        />
      )}
    </Group>
  );
};

// ACE idle SHOWCASE carousel — rotates real design renders as the floor with a
// caption band narrating DesignProAI's capabilities. Pure Konva (cover-fit image
// + gradient caption bar + text). Crossfade via index swap every few seconds.
const ACE_SHOWCASE_CAPTIONS = [
  "ACE here — type a prompt, get a custom wrap in ~60 seconds.",
  "Cars · Trucks · Boats · Trailers · RVs · Motorcycles — any vehicle.",
  "Commercial fleet branding AND artistic restyle wraps.",
  "Photoreal 3D proofs on YOUR exact vehicle — all 7 angles.",
  "Dimensioned 2D production proofs for client sign-off.",
  "GENIE™ Universal Panelizer → print-ready panels, 2\" bleed.",
  "ProductionFlow™: when all panels glow, it ships to WrapBox.",
];

const ShowcaseFloor: React.FC<{ width: number; height: number; urls: string[] }> = ({ width, height, urls }) => {
  const [idx, setIdx] = useState(0);
  const [img] = useImage(urls[idx % urls.length] || "");
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % urls.length), 3800);
    return () => clearInterval(t);
  }, [urls.length]);

  // COVER-fit so the showcase render fills the 16:9 carousel window edge-to-edge
  // (no dark bar). The window and the renders are both 16:9, so cover-fit fills
  // exactly without cropping the vehicle. Centered on the carousel backdrop.
  let dw = width, dh = height, dx = 0, dy = 0;
  if (img?.width && img?.height) {
    const scale = Math.max(width / img.width, height / img.height);
    dw = img.width * scale; dh = img.height * scale;
    dx = (width - dw) / 2; dy = (height - dh) / 2;
  }
  return (
    <Group listening={false}>
      <Rect x={0} y={0} width={width} height={height} fill="#0b1220" />
      {/* Full-bleed image only — the cycling caption band, moving caption text,
          and slide dots were removed per product direction (the carousel just
          shows the design filling the frame). */}
      {img && <KonvaImage image={img} x={dx} y={dy} width={dw} height={dh} />}
    </Group>
  );
};

// A single draggable/scalable transparent-PNG overlay node.
const URLImage: React.FC<{
  el: OverlayElement;
  draggable: boolean;
  onSelect: () => void;
  onChange: (next: OverlayElement) => void;
}> = ({ el, draggable, onSelect, onChange }) => {
  const [img] = useImage(el.url);
  const natW = img?.width || 220;
  const natH = img?.height || 110;
  const scaleToFit = Math.min(1, 360 / natW);
  const width = el.width ?? Math.round(natW * scaleToFit);
  const height = el.height ?? Math.round(natH * scaleToFit);

  if (el.hidden) return null;

  const commonProps = {
    id: el.id,
    x: el.x,
    y: el.y,
    width,
    height,
    scaleX: el.scaleX ?? 1,
    scaleY: el.scaleY ?? 1,
    rotation: el.rotation ?? 0,
    opacity: el.opacity ?? 1,
    draggable,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (e: any) => onChange({ ...el, x: e.target.x(), y: e.target.y() }),
    onTransformEnd: (e: any) => {
      const node = e.target;
      onChange({ ...el, x: node.x(), y: node.y(), scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation() });
    },
  };

  // If the transparent PNG hasn't loaded, a Konva <Image> with no image has NO
  // hit area — the layer shows in the "Layers" count but can't be tapped or
  // dragged ("says there's a layer but there isn't"). Render a visible, grabbable
  // placeholder with the SAME id/geometry so selection + the Transformer still
  // work; it's swapped for the real artwork the moment the image loads.
  if (!img) {
    return (
      <Rect
        {...commonProps}
        fill="rgba(59,130,246,0.10)"
        stroke="#3b82f6"
        strokeWidth={2}
        dash={[8, 6]}
        cornerRadius={6}
      />
    );
  }

  return (
    <KonvaImage {...commonProps} image={img} />
  );
};

export const LayerLiftRevisionStudio: React.FC<LayerLiftCanvasProps> = ({
  backgroundUrl,
  initialOverlays,
  onLayoutUpdated,
  embedded = false,
  generating = false,
  progress,
  viewKey,
  showcaseUrls,
  tools = false,
  onElementsChange,
  onPromptAt,
  onEditElement,
}) => {
  const [backgroundImage] = useImage(backgroundUrl);
  const [elements, setElements] = useState<OverlayElement[]>(initialOverlays);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Tracks whether we've auto-selected a layer for the current view, so the
  // transform handles appear immediately (no "click to discover it's movable").
  const autoSelectedRef = useRef(false);

  // Tool mode: "select" = drag/move/scale/delete (all immediate); "add" = draw a
  // box where you want something, then prompt the AI to fill exactly that region.
  const [tool, setTool] = useState<"select" | "add">("select");
  const [drawBox, setDrawBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [draftPrompt, setDraftPrompt] = useState("");
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);

  // Per-element "edit by prompt": clicking a node selects it (deterministic
  // drag/scale); the wand opens this bubble to refine THAT element via the
  // revision pipeline (the one async step).
  const [editing, setEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");

  // On a narrow (phone) canvas the floating Layers panel covered the design, so
  // there it becomes a collapsible bottom sheet instead of a fixed side panel.
  const [layersOpen, setLayersOpen] = useState(false);

  // True once the user has made a local edit on the current view, so a
  // late-arriving overlay set (parallel logo/text generation) won't clobber
  // their work. Reset whenever the view/background flips.
  const dirtyRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);

  const toolsActive = tools && !generating;

  // Responsive sizing: in embedded mode the Stage fills its parent (ResizeObserver);
  // standalone keeps a fixed 16:9 card.
  const [size, setSize] = useState({ width: 900, height: 500 });
  useEffect(() => {
    if (!embedded) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth || 900;
      // Fill the actual container box edge-to-edge. The parent Card is a 16:9
      // (aspect-video) window and the renders are 16:9, so filling the box does
      // NOT distort — the earlier squash was the bottom info bar stealing height
      // from this box, which has since been removed.
      const h = el.clientHeight || Math.round((w * 9) / 16);
      setSize({ width: w, height: h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [embedded]);

  // Re-seed when the ACTIVE VIEW (or background) changes — keyed on viewKey so
  // switching Driver→Passenger fully flushes view-1 layers before seeding view-2
  // (fixes overlay ghosting). Deselect too, so the transformer never points at a
  // node that no longer exists. NOT keyed on every layout tick — that would
  // clobber live edits via the onLayoutUpdated feedback loop.
  useEffect(() => {
    dirtyRef.current = false;
    autoSelectedRef.current = false; // re-arm auto-select for the new view
    setSelectedId(null);
    setEditing(false);
    setElements(initialOverlays);
  }, [viewKey, backgroundUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seed LATE-arriving overlays. The logo/text PNGs are generated in PARALLEL
  // with the background, so they can land a moment AFTER this canvas already
  // mounted with the render. Without this, the lifted layers wouldn't appear on
  // the first view until you switched angles. Guarded by dirtyRef so it never
  // overwrites edits the user has already started (the reason the seed above is
  // intentionally NOT keyed on every overlay tick).
  useEffect(() => {
    if (dirtyRef.current) return;
    setElements(initialOverlays);
  }, [initialOverlays]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select the first overlay the instant layers land, so the Konva transform
  // handles (move / scale / rotate) are immediately visible — no "locked ghost"
  // the user has to click to discover. Only fires once per view and never steals
  // an active selection or fights a manual deselect.
  //
  // GATED ON toolsActive (restored 2026-08-24). This effect and the transformer
  // below keyed off `tool === "select"` alone, which is the DEFAULT tool — so a
  // viewer-mode canvas (tools={false}) still auto-selected the first overlay and
  // drew the Transformer over the render. Its anchors and border are #d946ef,
  // and that is exactly the "pink drag-handles and the torn/smeared draggable
  // overlay box on the render" that got LayerLiftIQ ripped out of the viewport
  // instead of gated. `tools` was already the flag for "this canvas is an
  // editor"; it simply was never consulted here.
  useEffect(() => {
    if (!toolsActive || tool !== "select" || autoSelectedRef.current) return;
    if (!selectedId && elements.length > 0) {
      setSelectedId(elements[0].id);
      autoSelectedRef.current = true;
    }
  }, [elements, tool, selectedId, toolsActive]);

  // Viewer mode owns no selection. Without this a selection made while the tools
  // were on would keep its handles painted after they were switched off.
  useEffect(() => {
    if (!toolsActive && selectedId) setSelectedId(null);
  }, [toolsActive, selectedId]);

  useEffect(() => {
    if (!transformerRef.current) return;
    if (toolsActive && selectedId && tool === "select") {
      const node = stageRef.current?.findOne("#" + selectedId);
      if (node) {
        transformerRef.current.nodes([node]);
        transformerRef.current.getLayer().batchDraw();
        return;
      }
    }
    transformerRef.current.nodes([]);
  }, [selectedId, elements, size, tool, toolsActive]);

  // ── Element mutations — all IMMEDIATE / deterministic ──────────
  const commit = (next: OverlayElement[]) => {
    dirtyRef.current = true; // user has touched this view — protect from re-seed
    setElements(next);
    onElementsChange?.(next);
    const stage = stageRef.current;
    const w = stage?.width?.() || size.width;
    const h = stage?.height?.() || size.height;
    onLayoutUpdated(next, { width: w, height: h });
  };

  const handleChange = (nextEl: OverlayElement) =>
    commit(elements.map((el) => (el.id === nextEl.id ? nextEl : el)));

  const deleteSelected = () => {
    if (!selectedId) return;
    commit(elements.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  };
  const scaleSelected = (factor: number) => {
    if (!selectedId) return;
    commit(elements.map((el) =>
      el.id === selectedId
        ? { ...el, scaleX: (el.scaleX ?? 1) * factor, scaleY: (el.scaleY ?? 1) * factor }
        : el,
    ));
  };
  const toggleHidden = (id: string) =>
    commit(elements.map((el) => (el.id === id ? { ...el, hidden: !el.hidden } : el)));

  // ── Draw-box-to-add (the one AI step) ──────────────────────────
  const onStageMouseDown = (e: any) => {
    if (tool === "add") {
      const pos = stageRef.current?.getPointerPosition();
      if (!pos) return;
      drawStartRef.current = pos;
      setBubble(null);
      setDraftPrompt("");
      setDrawBox({ x: pos.x, y: pos.y, w: 0, h: 0 });
      return;
    }
    if (e.target === e.target.getStage() || e.target.id() === "background-art") {
      setSelectedId(null);
      setEditing(false);
    }
  };
  const onStageMouseMove = () => {
    if (tool !== "add" || !drawStartRef.current) return;
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return;
    const s = drawStartRef.current;
    setDrawBox({ x: Math.min(s.x, pos.x), y: Math.min(s.y, pos.y), w: Math.abs(pos.x - s.x), h: Math.abs(pos.y - s.y) });
  };
  const onStageMouseUp = () => {
    if (tool !== "add" || !drawStartRef.current) return;
    drawStartRef.current = null;
    setDrawBox((box) => {
      if (box && box.w > 14 && box.h > 14) setBubble(box);
      return box && box.w > 14 && box.h > 14 ? box : null;
    });
  };
  const submitPrompt = () => {
    if (!bubble || !draftPrompt.trim()) return;
    onPromptAt?.({
      prompt: draftPrompt.trim(),
      xPct: bubble.x / size.width,
      yPct: bubble.y / size.height,
      wPct: bubble.w / size.width,
      hPct: bubble.h / size.height,
    });
    setBubble(null);
    setDrawBox(null);
    setDraftPrompt("");
    setTool("select");
  };
  const cancelDraw = () => { setBubble(null); setDrawBox(null); setDraftPrompt(""); };

  const selectedEl = elements.find((el) => el.id === selectedId) || null;

  // ── Per-element edit-by-prompt (routes the selected node to the revision
  // pipeline). Prompt edits are the one async step; move/scale stay instant.
  const openEdit = () => {
    if (!selectedEl) return;
    setTool("select");
    setEditPrompt("");
    setEditing(true);
  };
  const submitEdit = () => {
    if (!selectedEl || !editPrompt.trim()) return;
    onEditElement?.({
      element: selectedEl,
      prompt: editPrompt.trim(),
      xPct: selectedEl.x / size.width,
      yPct: selectedEl.y / size.height,
    });
    setEditing(false);
    setEditPrompt("");
  };

  const stage = (
    <Stage
      width={size.width}
      height={size.height}
      onMouseDown={onStageMouseDown}
      onMouseMove={onStageMouseMove}
      onMouseUp={onStageMouseUp}
      onTouchStart={onStageMouseDown}
      onTouchMove={onStageMouseMove}
      onTouchEnd={onStageMouseUp}
      ref={stageRef}
      style={{ cursor: tool === "add" ? "crosshair" : "default" }}
    >
      <Layer>
        {generating ? (
          // Rendering → ACE progress floor (message + animated bar).
          <GeneratingFloor width={size.width} height={size.height} progress={progress} />
        ) : backgroundImage ? (
          <KonvaImage image={backgroundImage} width={size.width} height={size.height} id="background-art" listening={false} />
        ) : showcaseUrls && showcaseUrls.length > 0 ? (
          // No AI background yet → ACE showcase carousel of real designs.
          <ShowcaseFloor width={size.width} height={size.height} urls={showcaseUrls} />
        ) : (
          // No designs to show yet → ACE empty-state message floor.
          <EmptyFloor width={size.width} height={size.height} />
        )}
      </Layer>
      <Layer>
        {elements.map((el) => (
          <URLImage
            key={el.id}
            el={el}
            // Same gate as the Transformer: a viewer-mode canvas paints the
            // approved artwork and nothing else. Dragging here is what tore the
            // overlay away from the render underneath it.
            draggable={toolsActive && tool === "select"}
            onSelect={() => toolsActive && tool === "select" && setSelectedId(el.id)}
            onChange={handleChange}
          />
        ))}
        <Transformer
          ref={transformerRef}
          rotateEnabled
          rotationSnaps={[0, 90, 180, 270]}
          anchorStroke="#d946ef"
          anchorFill="#06b6d4"
          anchorSize={8}
          borderStroke="#d946ef"
          borderStrokeWidth={1.5}
          boundBoxFunc={(oldBox, newBox) => (newBox.width < 20 || newBox.height < 20 ? oldBox : newBox)}
        />
        {/* Draw-to-add marquee — glassmorphism cyan box */}
        {drawBox && (drawBox.w > 2 || drawBox.h > 2) && (
          <Rect
            x={drawBox.x}
            y={drawBox.y}
            width={drawBox.w}
            height={drawBox.h}
            fill="rgba(0,199,255,0.12)"
            stroke="#00C7FF"
            strokeWidth={2}
            dash={[8, 5]}
            cornerRadius={8}
            listening={false}
          />
        )}
      </Layer>
    </Stage>
  );

  // ── Glassmorphism tool UI overlay (HTML over the Konva stage) ───
  const toolButton = (active: boolean, onClick: () => void, title: string, disabled: boolean, icon: React.ReactNode) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg border transition",
        active
          ? "border-cyan-400/70 bg-cyan-400/25 text-white shadow-[0_0_10px_rgba(0,199,255,0.4)]"
          : "border-white/15 bg-white/10 text-white/80 hover:bg-white/20",
        disabled && "opacity-40 cursor-not-allowed hover:bg-white/10",
      )}
    >
      {icon}
    </button>
  );

  // Narrow canvas (phone) → bottom-sheet Layers + tap-visible row controls.
  const compact = size.width > 0 && size.width < 640;

  // Header + count + scrollable layer list — shared by the desktop side panel
  // and the mobile bottom sheet.
  const layersInner = (
    <>
      {/* Branded LayerLiftIQ header — two-tone wordmark (white + blue→magenta
          gradient) so the customer sees the layers are a real, branded tool. */}
      <div className="border-b border-white/10 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Wand2 className="h-3.5 w-3.5 text-pink-400" />
          <span className="text-sm font-extrabold leading-none tracking-tight text-white">
            LayerLift
            <span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">IQ</span>
            <span className="align-super text-[8px] text-white/70">™</span>
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-tight text-white/55">
          Your logo &amp; text are real editable layers — not flattened.
        </p>
      </div>
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <LayersIcon className="h-3.5 w-3.5 text-cyan-300" />
        <span className="text-xs font-bold text-white">Layers</span>
        <span className="ml-auto rounded-full bg-white/15 px-2 py-0.5 text-[10px] text-white/70">{elements.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {elements.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11px] text-white/40">Lifted text &amp; logos appear here.</p>
        ) : (
          // Top layer (last drawn) first.
          [...elements].reverse().map((el) => (
            <div
              key={el.id}
              onClick={() => { setTool("select"); setSelectedId(el.id); }}
              className={cn(
                "group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
                selectedId === el.id ? "bg-cyan-400/20 text-white" : "text-white/75 hover:bg-white/10",
              )}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleHidden(el.id); }}
                className="text-white/60 hover:text-white"
                title={el.hidden ? "Show" : "Hide"}
              >
                {el.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              {/* Transparent-PNG thumbnail on a checkerboard so the customer
                  literally SEES each lifted layer (the alpha-isolated art). */}
              <span
                className="relative h-7 w-7 shrink-0 overflow-hidden rounded border border-white/15"
                style={{
                  backgroundColor: "#ffffff",
                  backgroundImage:
                    "linear-gradient(45deg,#cbd5e1 25%,transparent 25%),linear-gradient(-45deg,#cbd5e1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#cbd5e1 75%),linear-gradient(-45deg,transparent 75%,#cbd5e1 75%)",
                  backgroundSize: "8px 8px",
                  backgroundPosition: "0 0,0 4px,4px -4px,-4px 0px",
                }}
              >
                <img src={el.url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
              </span>
              <span className="min-w-0 flex-1 truncate">{el.text || (el.isLogo ? "Logo" : "Text")}</span>
              <span className="shrink-0 rounded bg-white/10 px-1 text-[9px] uppercase tracking-wide text-white/40">{el.isLogo ? "logo" : "text"}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); commit(elements.filter((x) => x.id !== el.id)); if (selectedId === el.id) setSelectedId(null); }}
                className={cn(
                  "transition hover:text-red-400",
                  // No hover on touch → keep delete visible on the phone sheet.
                  compact ? "text-white/60" : "text-white/40 opacity-0 group-hover:opacity-100",
                )}
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
        {/* Locked background layer */}
        {backgroundImage && (
          <div className="mt-1 flex items-center gap-2 rounded-lg border-t border-white/10 px-2 py-1.5 text-xs text-white/40">
            <Lock className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate">Vehicle &amp; background</span>
          </div>
        )}
      </div>
    </>
  );

  const layersPanel = compact ? (
    <>
      {/* Bottom toggle pill — tap to reveal the layers without covering the art. */}
      <button
        type="button"
        onClick={() => setLayersOpen((o) => !o)}
        className="absolute bottom-3 right-3 z-40 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-md"
      >
        <LayersIcon className="h-3.5 w-3.5 text-cyan-300" />
        Layers
        <span className="rounded-full bg-white/15 px-1.5 text-[10px] text-white/80">{elements.length}</span>
        {layersOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>
      {layersOpen && (
        <div className="absolute inset-x-0 bottom-0 z-30 flex max-h-[60%] flex-col rounded-t-2xl border-t border-white/15 bg-black/70 pb-12 backdrop-blur-xl">
          {layersInner}
        </div>
      )}
    </>
  ) : (
    <div className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] w-56 flex-col rounded-xl border border-white/15 bg-black/30 backdrop-blur-md">
      {layersInner}
    </div>
  );

  const toolsUI = toolsActive && (
    <>
      {/* Floating toolbar — top-left */}
      <div className="absolute left-3 top-3 z-20 flex flex-col gap-1.5 rounded-xl border border-white/15 bg-black/30 p-1.5 backdrop-blur-md">
        {toolButton(tool === "select", () => { setTool("select"); cancelDraw(); }, "Select · drag, move, scale", false, <MousePointer2 className="h-4 w-4" />)}
        {toolButton(tool === "add", () => setTool("add"), "Draw a box where you want something added (AI)", false, <SquarePlus className="h-4 w-4" />)}
        <div className="my-0.5 h-px w-full bg-white/10" />
        {toolButton(false, () => scaleSelected(1.12), "Bigger", !selectedEl, <Plus className="h-4 w-4" />)}
        {toolButton(false, () => scaleSelected(0.88), "Smaller", !selectedEl, <Minus className="h-4 w-4" />)}
        {toolButton(false, deleteSelected, "Delete", !selectedEl, <Trash2 className="h-4 w-4" />)}
        <div className="my-0.5 h-px w-full bg-white/10" />
        {toolButton(editing, openEdit, "Edit the selected logo/text by prompt", !selectedEl, <Wand2 className="h-4 w-4" />)}
      </div>

      {/* Layers panel — floating side panel on desktop, collapsible bottom sheet
          on a narrow (phone) canvas so it never covers the design. */}
      {layersPanel}

      {/* Add-mode hint */}
      {tool === "add" && !bubble && (
        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-[11px] font-medium text-cyan-200 backdrop-blur-md">
          Draw a box where you want something added
        </div>
      )}

      {/* Prompt bubble — anchored to the drawn box (glassmorphism) */}
      {bubble && (
        <div
          className="absolute z-30 w-64 rounded-xl border border-white/20 bg-black/50 p-2.5 shadow-2xl backdrop-blur-xl"
          style={{
            left: Math.min(bubble.x, size.width - 264),
            top: Math.min(bubble.y + bubble.h + 8, size.height - 120),
          }}
        >
          <p className="mb-1.5 text-[11px] font-semibold text-cyan-200">I want a new ___ here</p>
          <textarea
            autoFocus
            rows={2}
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitPrompt(); } if (e.key === "Escape") cancelDraw(); }}
            placeholder="e.g. add a phone number, swap in a flame graphic…"
            className="w-full resize-none rounded-lg border border-white/15 bg-white/10 px-2 py-1.5 text-xs text-white placeholder:text-white/40 focus:border-cyan-400/60 focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button type="button" onClick={cancelDraw} className="rounded-lg px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/10">Cancel</button>
            <button type="button" onClick={submitPrompt} disabled={!draftPrompt.trim()} className="rounded-lg bg-gradient-to-r from-blue-500 to-cyan-400 px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-40">Add it</button>
          </div>
        </div>
      )}

      {/* Per-element edit-by-prompt bubble — anchored to the selected node. The
          deterministic move/scale/delete stay instant; this is the one async
          step (routes the clicked logo/text into the revision pipeline). */}
      {editing && selectedEl && (
        <div
          className="absolute z-30 w-64 rounded-xl border border-white/20 bg-black/50 p-2.5 shadow-2xl backdrop-blur-xl"
          style={{
            left: Math.max(8, Math.min(selectedEl.x, size.width - 264)),
            top: Math.max(8, Math.min(selectedEl.y + 8, size.height - 140)),
          }}
        >
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-pink-200">
            <Wand2 className="h-3 w-3" /> Edit this {selectedEl.isLogo ? "logo" : "text"}
          </p>
          <textarea
            autoFocus
            rows={2}
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(); } if (e.key === "Escape") setEditing(false); }}
            placeholder="e.g. make it bolder, recolor to red, add a wing…"
            className="w-full resize-none rounded-lg border border-white/15 bg-white/10 px-2 py-1.5 text-xs text-white placeholder:text-white/40 focus:border-pink-400/60 focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/10">Cancel</button>
            <button type="button" onClick={submitEdit} disabled={!editPrompt.trim()} className="rounded-lg bg-gradient-to-r from-blue-500 to-pink-500 px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-40">Apply edit</button>
          </div>
        </div>
      )}
    </>
  );

  // Embedded: fill the parent viewport, no card chrome.
  if (embedded) {
    return (
      <div ref={containerRef} className="absolute inset-0 h-full w-full bg-white touch-none">
        {stage}
        {toolsUI}
      </div>
    );
  }

  // Standalone card.
  return (
    <div className="relative w-full max-w-5xl rounded-xl border border-gray-100 bg-white p-6 shadow-lg">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
          LayerLiftIQ™ Revision Studio <span className="text-sm text-blue-500">✨ Active Canvas</span>
        </h3>
        <p className="text-xs text-gray-500">Drag, scale, reposition, or draw a box to add.</p>
      </div>
      <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50 touch-none">
        {stage}
        {toolsUI}
      </div>
      {elements.length === 0 && (
        <p className="mt-3 text-center text-xs text-gray-400">No Layer-2 overlays yet for this design.</p>
      )}
    </div>
  );
};

export default LayerLiftRevisionStudio;
