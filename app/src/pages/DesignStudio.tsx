import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, ImagePlus, Save, Download, Check, Type, Undo2, Redo2 } from "lucide-react";
import { LayerCanvasEditor } from "@/components/designpanelpro/canvas/LayerCanvasEditor";
import { LayerPanel } from "@/components/designpanelpro/canvas/LayerPanel";
import { LayerInspector } from "@/components/designpanelpro/canvas/LayerInspector";
import { useDesignCanvas } from "@/components/designpanelpro/canvas/useDesignCanvas";

// Common wrap artboards (trim size in inches × dpi → doc pixels).
const PRESETS: Record<string, { label: string; width: number; height: number; dpi: number }> = {
  full_wrap: { label: "Full wrap (218×71.4 @150)", width: 12000, height: 4000, dpi: 150 },
  side_panel: { label: "Side panel (120×60 @150)", width: 18000, height: 9000, dpi: 150 },
  hood: { label: "Hood (60×60 @150)", width: 9000, height: 9000, dpi: 150 },
  square: { label: "Square proof (3000×3000)", width: 3000, height: 3000, dpi: 150 },
};

export default function DesignStudio() {
  const [params] = useSearchParams();
  const initialId = params.get("id") || undefined;
  const studio = useDesignCanvas(initialId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [presetKey, setPresetKey] = useState<string>("");

  const onPickFile = () => fileRef.current?.click();

  const onAddImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in to add images.");
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const safe = file.name.replace(/[^\w.-]/g, "_");
      const path = `canvas-layers/${user.id}/${Date.now()}_${safe}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("wrap-files")
        .upload(path, file, { contentType: file.type || "image/png", upsert: true });
      if (upErr) throw new Error("Upload failed: " + upErr.message);
      const { data: signed } = await supabase.storage
        .from("wrap-files")
        .createSignedUrl(path, 60 * 60 * 24 * 30);
      if (!signed?.signedUrl) throw new Error("Could not sign uploaded file.");

      // Read natural dimensions so the layer scales sensibly into the canvas.
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error("Could not read image."));
        img.src = signed.signedUrl;
      });
      studio.addImageLayer(signed.signedUrl, dims.w, dims.h, file.name.replace(/\.[^.]+$/, ""));
      toast.success("Layer added.");
    } catch (err: any) {
      toast.error(err?.message || "Could not add image.");
    } finally {
      setAdding(false);
    }
  };

  const onExport = async () => {
    const out = await studio.flatten("png");
    if (out?.pngUrl) window.open(out.pngUrl, "_blank");
  };

  const applyPreset = (key: string) => {
    setPresetKey(key);
    const p = PRESETS[key];
    if (p) studio.setCanvasSpec({ width: p.width, height: p.height, dpi: p.dpi });
  };

  // Keyboard shortcuts: undo/redo, delete, duplicate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return; // don't hijack typing
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) studio.redo();
        else studio.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        studio.redo();
      } else if (mod && e.key.toLowerCase() === "d" && studio.selectedId) {
        e.preventDefault();
        studio.duplicateLayer(studio.selectedId);
      } else if ((e.key === "Delete" || e.key === "Backspace") && studio.selectedId) {
        e.preventDefault();
        studio.removeLayer(studio.selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [studio]);

  const selectedLayer = studio.doc.layers.find((l) => l.id === studio.selectedId);

  if (studio.loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center bg-white text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading design…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3">
        <Input
          value={studio.doc.name}
          onChange={(e) => studio.setName(e.target.value)}
          className="h-9 w-56"
          placeholder="Design name"
        />

        <Select value={presetKey} onValueChange={applyPreset}>
          <SelectTrigger className="h-9 w-64">
            <SelectValue placeholder="Canvas size" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PRESETS).map(([k, p]) => (
              <SelectItem key={k} value={k}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-gray-400">
          {studio.doc.canvas.width} × {studio.doc.canvas.height}px · {studio.doc.canvas.dpi} DPI
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={studio.undo} disabled={!studio.canUndo} aria-label="Undo">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={studio.redo} disabled={!studio.canRedo} aria-label="Redo">
            <Redo2 className="h-4 w-4" />
          </Button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAddImage} />
          <Button variant="outline" size="sm" onClick={onPickFile} disabled={adding}>
            {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
            Add image
          </Button>
          <Button variant="outline" size="sm" onClick={() => studio.addTextLayer()}>
            <Type className="mr-2 h-4 w-4" />
            Add text
          </Button>
          <Button variant="outline" size="sm" onClick={() => void studio.save()} disabled={studio.saving}>
            {studio.saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : studio.dirty ? (
              <Save className="mr-2 h-4 w-4" />
            ) : (
              <Check className="mr-2 h-4 w-4 text-green-600" />
            )}
            {studio.dirty || studio.saving ? "Save" : "Saved"}
          </Button>
          <Button
            size="sm"
            onClick={onExport}
            disabled={studio.exporting || studio.doc.layers.length === 0}
            className="bg-gradient-to-r from-blue-500 to-pink-500 text-white hover:opacity-90"
          >
            {studio.exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export PNG
          </Button>
        </div>
      </div>

      {/* Workspace */}
      <div className="flex gap-4 p-4">
        <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-gray-50 p-6">
          <LayerCanvasEditor
            doc={studio.doc}
            selectedId={studio.selectedId}
            onSelect={studio.setSelectedId}
            onChangeLayer={studio.updateLayer}
          />
        </div>
        <div className="flex gap-4">
          <LayerInspector layer={selectedLayer} onUpdate={studio.updateLayer} />
          <LayerPanel
            layers={studio.doc.layers}
            selectedId={studio.selectedId}
            onSelect={studio.setSelectedId}
            onUpdate={studio.updateLayer}
            onRemove={studio.removeLayer}
            onReorder={studio.reorderLayer}
            onDuplicate={studio.duplicateLayer}
          />
        </div>
      </div>
    </div>
  );
}
