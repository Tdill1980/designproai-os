/**
 * ShotPhotoCropEditor — viewable Konva canvas for repositioning/cropping a
 * shot's uploaded photo before saving a derived crop. The ORIGINAL upload is
 * never modified: confirming exports a full-resolution crop from the source
 * image (geometry in src/lib/cropMath.ts) and uploads it as a NEW asset on
 * the same shot, tagged with the preset + parent asset id.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage } from "react-konva";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  CROP_PRESETS, type CropPresetKey,
  stageSizeFor, coverScale, clampPosition, cropRect,
} from "@/lib/cropMath";

function useCrossOriginImage(url: string | null) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!url) { setImg(null); return; }
    setImg(null); setError(null);
    const el = new window.Image();
    el.crossOrigin = "anonymous"; // needed so the export canvas isn't tainted
    el.onload = () => setImg(el);
    el.onerror = () => setError("Couldn't load this photo for editing.");
    el.src = url;
    return () => { el.onload = null; el.onerror = null; };
  }, [url]);
  return { img, error };
}

export default function ShotPhotoCropEditor({
  sourceUrl, onConfirm, onClose, saving,
}: {
  sourceUrl: string | null;
  /** Receives the full-resolution cropped file, ready to upload. */
  onConfirm: (file: File, preset: CropPresetKey) => void;
  onClose: () => void;
  saving?: boolean;
}) {
  const { img, error } = useCrossOriginImage(sourceUrl);
  const [preset, setPreset] = useState<CropPresetKey>("vertical");
  const [zoom, setZoom] = useState(1); // multiplier on top of cover scale
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Fit the stage to the dialog; small enough for phones.
  const maxW = Math.min(typeof window !== "undefined" ? window.innerWidth - 88 : 360, 360);
  const stage = useMemo(() => stageSizeFor(preset, maxW, 420), [preset, maxW]);
  const base = img ? coverScale(img.naturalWidth, img.naturalHeight, stage.width, stage.height) : 1;
  const scale = base * zoom;

  // Re-center whenever the preset, zoom or image changes.
  const imgKey = img?.src;
  useEffect(() => {
    if (!img) return;
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    setPos({ x: (stage.width - w) / 2, y: (stage.height - h) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgKey, preset, zoom]);

  const posRef = useRef(pos);
  posRef.current = pos;

  const confirm = () => {
    if (!img) return;
    const { sx, sy, sw, sh } = cropRect(
      posRef.current.x, posRef.current.y, scale,
      stage.width, stage.height, img.naturalWidth, img.naturalHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onConfirm(new File([blob], `crop-${preset}.jpg`, { type: "image/jpeg" }), preset);
    }, "image/jpeg", 0.92);
  };

  return (
    <Dialog open={!!sourceUrl} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white text-gray-900 max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-gray-900">Crop / reposition</DialogTitle></DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(CROP_PRESETS) as CropPresetKey[]).map((k) => (
            <button key={k} onClick={() => { setPreset(k); setZoom(1); }}
              className={cn("rounded-full border px-3 py-1 text-xs font-bold",
                preset === k ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700")}>
              {CROP_PRESETS[k].label}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="mx-auto overflow-hidden rounded-md border border-gray-300 bg-gray-100"
          style={{ width: stage.width, height: stage.height, touchAction: "none" }}>
          {img && (
            <Stage width={stage.width} height={stage.height}>
              <Layer>
                <KonvaImage
                  image={img}
                  x={pos.x} y={pos.y}
                  scaleX={scale} scaleY={scale}
                  draggable
                  onDragMove={(e) => {
                    const p = clampPosition(e.target.x(), e.target.y(),
                      img.naturalWidth, img.naturalHeight, scale, stage.width, stage.height);
                    e.target.position(p);
                    setPos(p);
                  }}
                />
              </Layer>
            </Stage>
          )}
        </div>

        <label className="block text-xs font-semibold text-gray-600">
          Zoom
          <input type="range" min={1} max={3} step={0.01} value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))} className="mt-1 w-full" />
        </label>
        <p className="text-[11px] text-gray-500">Drag the photo to reposition. The original upload is kept — this saves a new cropped copy.</p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!img || saving} onClick={confirm} className="bg-gray-900 text-white hover:bg-gray-800">
            {saving ? "Saving…" : "Save crop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
