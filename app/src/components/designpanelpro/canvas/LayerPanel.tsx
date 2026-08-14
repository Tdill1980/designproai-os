import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, EyeOff, ChevronUp, ChevronDown, Trash2, Layers, Copy, Type, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BLEND_MODES, BlendMode, Layer } from "./types";

interface LayerPanelProps {
  layers: Layer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Layer>) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, direction: "up" | "down") => void;
  onDuplicate: (id: string) => void;
}

export function LayerPanel({
  layers,
  selectedId,
  onSelect,
  onUpdate,
  onRemove,
  onReorder,
  onDuplicate,
}: LayerPanelProps) {
  // Display top-first (top of the stack at the top of the list).
  const ordered = [...layers].reverse();

  return (
    <div className="flex h-full w-72 flex-col rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-gray-900">
        <Layers className="h-4 w-4 text-gray-500" />
        <span className="text-sm font-medium">Layers</span>
        <span className="ml-auto text-xs text-gray-400">{layers.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {ordered.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-gray-400">
            No layers yet. Add an image to begin.
          </p>
        )}
        {ordered.map((layer) => {
          const selected = layer.id === selectedId;
          const isTop = layers[layers.length - 1]?.id === layer.id;
          const isBottom = layers[0]?.id === layer.id;
          return (
            <div
              key={layer.id}
              onClick={() => onSelect(layer.id)}
              className={cn(
                "cursor-pointer border-b border-gray-50 px-3 py-2",
                selected ? "bg-blue-50" : "hover:bg-gray-50",
              )}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate(layer.id, { visible: !layer.visible });
                  }}
                  className="text-gray-500 hover:text-gray-900"
                  aria-label={layer.visible ? "Hide layer" : "Show layer"}
                >
                  {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
                {layer.type === "text" ? (
                  <Type className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                )}
                <span
                  className={cn(
                    "flex-1 truncate text-sm",
                    layer.visible ? "text-gray-900" : "text-gray-400",
                  )}
                >
                  {layer.name}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReorder(layer.id, "up");
                  }}
                  disabled={isTop}
                  className="text-gray-400 hover:text-gray-900 disabled:opacity-30"
                  aria-label="Move layer up"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReorder(layer.id, "down");
                  }}
                  disabled={isBottom}
                  className="text-gray-400 hover:text-gray-900 disabled:opacity-30"
                  aria-label="Move layer down"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(layer.id);
                  }}
                  className="text-gray-400 hover:text-gray-900"
                  aria-label="Duplicate layer"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(layer.id);
                  }}
                  className="text-gray-400 hover:text-red-500"
                  aria-label="Delete layer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {selected && (
                <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-gray-500">
                      <span>Opacity</span>
                      <span>{Math.round(layer.opacity * 100)}%</span>
                    </div>
                    <Slider
                      value={[Math.round(layer.opacity * 100)]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={(v) => onUpdate(layer.id, { opacity: (v[0] ?? 100) / 100 })}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-gray-500">Blend mode</div>
                    <Select
                      value={layer.blendMode}
                      onValueChange={(v) => onUpdate(layer.id, { blendMode: v as BlendMode })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BLEND_MODES.map((m) => (
                          <SelectItem key={m} value={m} className="text-xs capitalize">
                            {m.replace("-", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
