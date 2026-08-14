import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer as KLayer, Rect, Image as KonvaImage, Text as KonvaText, Group, Transformer, Line } from "react-konva";
import Konva from "konva";
import { CanvasDocument, Layer, RasterLayer, TextLayer, hasActiveFilters } from "./types";
import { useCanvasImage } from "./useCanvasImage";

const GCO: Record<string, string> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-dodge": "color-dodge",
  "color-burn": "color-burn",
  "hard-light": "hard-light",
  "soft-light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
};

interface LayerNodeProps {
  layer: Layer;
  onSelect: () => void;
  onChange: (patch: Partial<RasterLayer & TextLayer>, actionKey?: string) => void;
  registerRef: (id: string, node: Konva.Group | null) => void;
  onDragMove: (id: string, node: Konva.Group) => void;
  onDragEnd: () => void;
  // Revise mode: outline every grabbable overlay so the customer sees exactly
  // which deterministic Konva layers they can move/resize with the tools.
  highlight?: boolean;
  scale?: number;
}

function LayerNode({ layer, onSelect, onChange, registerRef, onDragMove, onDragEnd, highlight, scale = 1 }: LayerNodeProps) {
  const [image] = useCanvasImage(layer.type === "raster" ? layer.src : undefined);
  const [maskImage] = useCanvasImage(layer.mask?.src);
  const groupRef = useRef<Konva.Group | null>(null);

  // Apply filters + mask. Both require caching the group so the mask's
  // destination-in composite stays isolated to this layer.
  useEffect(() => {
    const g = groupRef.current as any;
    if (!g) return;
    if (layer.type === "raster" && !image) return;

    const needFilters = hasActiveFilters(layer.filters);
    const needMask = !!layer.mask;
    g.clearCache();
    if (needFilters || needMask) {
      const filters: any[] = [];
      if (needFilters && layer.filters) {
        const f = layer.filters;
        g.brightness(f.brightness - 1);
        filters.push(Konva.Filters.Brighten);
        g.contrast((f.contrast - 1) * 100);
        filters.push(Konva.Filters.Contrast);
        g.saturation(f.saturation - 1);
        g.value(0);
        g.hue(0);
        filters.push(Konva.Filters.HSV);
        if (f.blur > 0) {
          g.blurRadius(f.blur);
          filters.push(Konva.Filters.Blur);
        }
      }
      g.filters(filters);
      try {
        g.cache();
      } catch {
        /* zero-size guard */
      }
    } else {
      g.filters([]);
    }
    g.getLayer()?.batchDraw();
  }, [
    layer.filters, layer.mask, image, maskImage, layer.width, layer.height, layer.type,
    (layer as TextLayer).text, (layer as TextLayer).fontSize, (layer as TextLayer).fill,
    (layer as TextLayer).fontFamily, (layer as TextLayer).align, (layer as TextLayer).fontStyle,
  ]);

  if (!layer.visible) return null;

  const handleTransformEnd = () => {
    const node = groupRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const nextW = Math.max(1, Math.round(layer.width * scaleX));
    const nextH = Math.max(1, Math.round(layer.height * scaleY));
    node.scaleX(1);
    node.scaleY(1);
    node.offsetX(nextW / 2);
    node.offsetY(nextH / 2);
    const patch: Partial<RasterLayer & TextLayer> = {
      cx: Math.round(node.x()),
      cy: Math.round(node.y()),
      width: nextW,
      height: nextH,
      rotation: Math.round(node.rotation()),
    };
    // Free-transforming text scales the glyphs too (Photoshop behaviour).
    if (layer.type === "text") {
      const avg = Math.sqrt(Math.max(0.01, scaleX * scaleY));
      patch.fontSize = Math.max(4, Math.round(layer.fontSize * avg));
    }
    onChange(patch, `transform-${layer.id}`);
  };

  return (
    <Group
      ref={(n) => {
        groupRef.current = n;
        registerRef(layer.id, n);
      }}
      x={layer.cx}
      y={layer.cy}
      offsetX={layer.width / 2}
      offsetY={layer.height / 2}
      width={layer.width}
      height={layer.height}
      rotation={layer.rotation}
      opacity={layer.opacity}
      globalCompositeOperation={(GCO[layer.blendMode] || "source-over") as any}
      draggable={!layer.locked}
      listening={!layer.locked}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragMove={(e) => onDragMove(layer.id, e.target as Konva.Group)}
      onDragEnd={(e) => {
        onChange({ cx: Math.round(e.target.x()), cy: Math.round(e.target.y()) }, `move-${layer.id}`);
        onDragEnd();
      }}
      onTransformEnd={handleTransformEnd}
    >
      {layer.type === "raster" ? (
        <KonvaImage image={image} x={0} y={0} width={layer.width} height={layer.height} />
      ) : (
        <KonvaText
          x={0}
          y={0}
          width={layer.width}
          height={layer.height}
          text={layer.text}
          fontFamily={layer.fontFamily}
          fontSize={layer.fontSize}
          fill={layer.fill}
          fontStyle={layer.fontStyle}
          align={layer.align}
          verticalAlign="middle"
          lineHeight={layer.lineHeight}
          letterSpacing={layer.letterSpacing}
          wrap="word"
        />
      )}
      {layer.mask && maskImage && (
        <KonvaImage
          image={maskImage}
          x={0}
          y={0}
          width={layer.width}
          height={layer.height}
          globalCompositeOperation={"destination-in" as any}
        />
      )}
      {highlight && (
        <Rect
          x={0}
          y={0}
          width={layer.width}
          height={layer.height}
          stroke="#ec4899"
          strokeWidth={2 / scale}
          dash={[8 / scale, 5 / scale]}
          listening={false}
        />
      )}
    </Group>
  );
}

interface LayerCanvasEditorProps {
  doc: CanvasDocument;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChangeLayer: (id: string, patch: Partial<RasterLayer & TextLayer>, actionKey?: string) => void;
  maxWidth?: number;
  maxHeight?: number;
  // Revise mode: outline every grabbable (unlocked) overlay so the customer
  // sees which deterministic Konva layers the tools act on.
  highlightOverlays?: boolean;
}

export function LayerCanvasEditor({
  doc,
  selectedId,
  onSelect,
  onChangeLayer,
  maxWidth = 920,
  maxHeight = 620,
  highlightOverlays = false,
}: LayerCanvasEditorProps) {
  const { width: cw, height: ch, background } = doc.canvas;
  const scale = useMemo(() => Math.min(maxWidth / cw, maxHeight / ch, 1), [cw, ch, maxWidth, maxHeight]);
  const stageW = Math.max(1, Math.round(cw * scale));
  const stageH = Math.max(1, Math.round(ch * scale));
  const SNAP = Math.max(cw, ch) * 0.005; // snap threshold in doc px

  const nodeRefs = useRef<Record<string, Konva.Group | null>>({});
  const trRef = useRef<Konva.Transformer | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });

  const registerRef = (id: string, node: Konva.Group | null) => {
    nodeRefs.current[id] = node;
  };

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId ? nodeRefs.current[selectedId] : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, doc.layers]);

  // Snap the dragged layer's center/edges to canvas center + edges, drawing guides.
  const handleDragMove = (id: string, node: Konva.Group) => {
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer) return;
    const halfW = layer.width / 2;
    const halfH = layer.height / 2;
    let x = node.x();
    let y = node.y();
    const v: number[] = [];
    const h: number[] = [];

    // Vertical (X) targets: canvas center, left edge, right edge.
    const xTargets = [
      { at: cw / 2, set: cw / 2 },
      { at: 0, set: halfW },
      { at: cw, set: cw - halfW },
    ];
    for (const t of xTargets) {
      if (Math.abs(x - t.set) < SNAP) {
        x = t.set;
        v.push(t.at);
        break;
      }
    }
    // Horizontal (Y) targets.
    const yTargets = [
      { at: ch / 2, set: ch / 2 },
      { at: 0, set: halfH },
      { at: ch, set: ch - halfH },
    ];
    for (const t of yTargets) {
      if (Math.abs(y - t.set) < SNAP) {
        y = t.set;
        h.push(t.at);
        break;
      }
    }

    node.x(x);
    node.y(y);
    setGuides({ v, h });
  };

  const handleDragEnd = () => setGuides({ v: [], h: [] });

  return (
    <div className="inline-block rounded-lg border border-gray-200 bg-[repeating-conic-gradient(#f3f4f6_0_25%,#ffffff_0_50%)] bg-[length:24px_24px] shadow-sm">
      <Stage
        width={stageW}
        height={stageH}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage() || e.target.className === "Rect") onSelect(null);
        }}
      >
        <KLayer>
          <Rect x={0} y={0} width={cw} height={ch} fill={background === "transparent" ? undefined : background} listening />
          {doc.layers.map((layer) => (
            <LayerNode
              key={layer.id}
              layer={layer}
              onSelect={() => onSelect(layer.id)}
              onChange={(patch, actionKey) => onChangeLayer(layer.id, patch, actionKey)}
              registerRef={registerRef}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              highlight={highlightOverlays && !layer.locked}
              scale={scale}
            />
          ))}
          <Transformer
            ref={trRef}
            rotateEnabled
            keepRatio={false}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
          />
          {guides.v.map((x, i) => (
            <Line key={`v${i}`} points={[x, 0, x, ch]} stroke="#ec4899" strokeWidth={1 / scale} dash={[8 / scale, 6 / scale]} listening={false} />
          ))}
          {guides.h.map((y, i) => (
            <Line key={`h${i}`} points={[0, y, cw, y]} stroke="#ec4899" strokeWidth={1 / scale} dash={[8 / scale, 6 / scale]} listening={false} />
          ))}
        </KLayer>
      </Stage>
    </div>
  );
}
