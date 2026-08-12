/**
 * LogoUploader — RevisionIQ Feature 1: upload your own logo or design element.
 *
 * Flow:
 *   1. Drop a file (or click to browse).
 *   2. Optional "Remove Background" — corner-flood chroma key drops the
 *      background to transparent. Skip if it's already a clean PNG.
 *   3. Click "Add as Layer" — uploads the (cleaned) PNG to wrap-files and
 *      adds it to the parent's shared layer strip as a single uploaded
 *      layer. From there it's click-armed and click-placed on the truck.
 *
 * No segmentation here — Feature 2 (RenderElementSeparator) handles peeling
 * elements off an existing AI render. This component is strictly the
 * upload-your-own-asset entry point.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, Wand2, Plus, X, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { removeBackgroundFromFile, uploadLogoAsset } from "@/lib/logo-composite";
import type { LogoLayer } from "@/types/revision-logo";

interface LogoUploaderProps {
  /** Current Supabase user id (used in storage paths) */
  userId: string | null;
  /** Add a layer to the parent's shared strip */
  onAddLayer: (layer: LogoLayer) => void;
}

export function LogoUploader({ userId, onAddLayer }: LogoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [originalBlob, setOriginalBlob] = useState<Blob | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [cleanedBlob, setCleanedBlob] = useState<Blob | null>(null);
  const [cleanedUrl, setCleanedUrl] = useState<string | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  function resetState() {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
    setOriginalBlob(null);
    setOriginalUrl(null);
    setCleanedBlob(null);
    setCleanedUrl(null);
  }

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (JPG, PNG, etc.)");
      return;
    }
    resetState();
    const url = URL.createObjectURL(file);
    setOriginalBlob(file);
    setOriginalUrl(url);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function handleRemoveBackground() {
    if (!originalBlob) return;
    setIsCleaning(true);
    try {
      const { blob } = await removeBackgroundFromFile(originalBlob);
      const url = URL.createObjectURL(blob);
      setCleanedBlob(blob);
      setCleanedUrl(url);
      toast.success("Background removed.");
    } catch (err) {
      console.error("[LogoUploader] removeBackground failed:", err);
      toast.error("Background removal failed. Try a different file.");
    } finally {
      setIsCleaning(false);
    }
  }

  async function handleAddAsLayer() {
    if (!userId) {
      toast.error("Sign in required to upload layers.");
      return;
    }
    const blob = cleanedBlob || originalBlob;
    if (!blob) return;
    setIsUploading(true);
    try {
      const publicUrl = await uploadLogoAsset(blob, userId, cleanedBlob ? "cleaned" : "source");
      const layer: LogoLayer = {
        id: `upl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "uploaded",
        sourceUrl: publicUrl,
        name: `Logo ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        placement: null,
      };
      onAddLayer(layer);
      toast.success("Logo added — click it in the layer strip, then click the render to place it.");
      resetState();
    } catch (err) {
      console.error("[LogoUploader] upload failed:", err);
      toast.error("Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  const previewUrl = cleanedUrl || originalUrl;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ImagePlus className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-bold">Upload Your Own Logo</span>
      </div>
      <p className="text-[11px] text-zinc-500">
        Drop your own logo or design element. Remove the background if needed, then add it as a layer to place on the render.
      </p>

      {!originalUrl && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
            dragOver
              ? "border-cyan-400 bg-cyan-500/10"
              : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-500",
          )}
        >
          <Upload className="w-6 h-6 mx-auto mb-2 text-zinc-500" />
          <p className="text-xs text-zinc-400">Drop a logo file or click to browse</p>
          <p className="text-[10px] text-zinc-600 mt-1">JPG, PNG — any background</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.currentTarget.value = "";
            }}
          />
        </div>
      )}

      {previewUrl && (
        <div className="space-y-2">
          <div className="relative rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800">
            <img
              src={previewUrl}
              alt="Uploaded logo"
              className="w-full max-h-48 object-contain block"
            />
            {isCleaning && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                <span className="ml-2 text-xs text-cyan-300">Removing background…</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-zinc-600 text-zinc-300 hover:bg-zinc-800"
              onClick={handleRemoveBackground}
              disabled={isCleaning || !!cleanedUrl}
            >
              <Wand2 className="w-3.5 h-3.5 mr-1.5" />
              Remove Background
            </Button>
            <Button
              size="sm"
              className="bg-cyan-500 text-black hover:bg-cyan-400"
              onClick={handleAddAsLayer}
              disabled={isUploading || !userId}
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5 mr-1.5" />
              )}
              Add as Layer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-zinc-500 hover:text-zinc-300"
              onClick={resetState}
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
