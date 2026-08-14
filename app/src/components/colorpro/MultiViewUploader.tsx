import { useCallback, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, X, Camera, Loader2, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

export interface ViewPhoto {
  viewType: string;
  file: File;
  previewUrl: string;
  base64: string;
  mimeType: string;
}

interface MultiViewUploaderProps {
  photos: ViewPhoto[];
  isAnalyzing: boolean;
  onPhotoUpload: (file: File, viewType: string) => void;
  onRemovePhoto: (viewType: string) => void;
  onClearAll: () => void;
}

const VIEW_SLOTS = [
  { type: "front", label: "Front", icon: "🚗" },
  { type: "driver-side", label: "Driver Side", icon: "🚙" },
  { type: "passenger-side", label: "Passenger Side", icon: "🚙" },
  { type: "rear", label: "Rear", icon: "🚘" },
  { type: "top", label: "Top / Overhead", icon: "⬆️" },
  { type: "detail", label: "Custom / Detail", icon: "🔍" },
];

export const MultiViewUploader = ({
  photos,
  isAnalyzing,
  onPhotoUpload,
  onRemovePhoto,
  onClearAll,
}: MultiViewUploaderProps) => {
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);

  const getPhotoForView = (viewType: string) =>
    photos.find((p) => p.viewType === viewType);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, viewType: string) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) { if (e.target) e.target.value = ""; return; }
    if (e.target) e.target.value = "";

    // AI auto-sort: verify the angle matches the slot the user chose
    try {
      const { base64, mimeType } = await resizeForClassify(file);
      const { data, error } = await supabase.functions.invoke("classify-vehicle-views", {
        body: { images: [{ id: "single", data: base64, mimeType }] },
      });

      if (!error && data?.classifications?.length > 0) {
        const detected = data.classifications[0].viewType as string;
        if (detected !== viewType && VIEW_SLOTS.some((s) => s.type === detected)) {
          // Photo is a different angle — place it in the correct slot instead
          const existingInDetected = photos.find((p) => p.viewType === detected);
          if (!existingInDetected) {
            console.log(`AI auto-sort: moved ${viewType} → ${detected}`);
            onPhotoUpload(file, detected);
            return;
          }
        }
      }
    } catch { /* fallback: use user's chosen slot */ }

    onPhotoUpload(file, viewType);
  };

  /** Read a File as base64 (raw, no data-URL prefix). */
  const fileToBase64 = (file: File): Promise<{ base64: string; mimeType: string }> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        resolve({ base64: dataUrl.split(",")[1], mimeType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  /** Resize image to max 800px for AI classification (saves payload + speed). */
  const resizeForClassify = (file: File): Promise<{ base64: string; mimeType: string }> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          const scale = MAX / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });

  // Bulk upload: select multiple files, AI classifies by camera angle
  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    // Snapshot files BEFORE clearing input — FileList is a live reference to
    // input.files, so clearing input.value empties it and Array.from() returns [].
    const imageFiles = Array.from(fileList)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, 6);

    if (e.target) e.target.value = "";

    if (imageFiles.length === 0) return;

    setIsClassifying(true);

    try {
      // Read all files in parallel — resized for classification (800px max, JPEG 70%)
      const fileData = await Promise.all(
        imageFiles.map(async (file, i) => {
          const { base64, mimeType } = await resizeForClassify(file);
          return { file, id: `img-${i}`, base64, mimeType };
        })
      );

      // Call AI classification edge function
      const { data, error } = await supabase.functions.invoke(
        "classify-vehicle-views",
        {
          body: {
            images: fileData.map((fd) => ({
              id: fd.id,
              data: fd.base64,
              mimeType: fd.mimeType,
            })),
          },
        }
      );

      if (error || !data?.classifications) {
        console.warn("AI classification failed, falling back to slot order:", error);
        // Fallback: assign to empty slots in order
        const emptySlots = VIEW_SLOTS.filter(
          (slot) => !photos.find((p) => p.viewType === slot.type)
        );
        imageFiles.forEach((file, index) => {
          if (index < emptySlots.length) {
            onPhotoUpload(file, emptySlots[index].type);
          }
        });
        return;
      }

      // Map classifications back to files and upload to correct slots.
      // NEVER drop a file — if its AI-assigned slot is taken (or AI returned
      // no classification for it), fall through to the next empty slot.
      const classifications: Array<{ id: string; viewType: string }> = data.classifications;
      const occupiedSlots = new Set(photos.map((p) => p.viewType));
      const placedFileIds = new Set<string>();

      const nextEmptySlot = () =>
        VIEW_SLOTS.find((s) => !occupiedSlots.has(s.type))?.type;

      for (const cls of classifications) {
        const fd = fileData.find((f) => f.id === cls.id);
        if (!fd) continue;
        let target = cls.viewType;
        if (occupiedSlots.has(target)) {
          const fallback = nextEmptySlot();
          if (!fallback) break; // all 6 slots full
          console.log(`AI sort collision on ${target} → placing in ${fallback}`);
          target = fallback;
        }
        occupiedSlots.add(target);
        placedFileIds.add(fd.id);
        onPhotoUpload(fd.file, target);
      }

      // Any file the AI didn't classify (truncated response) — place in
      // remaining empty slots so the user never loses an upload.
      for (const fd of fileData) {
        if (placedFileIds.has(fd.id)) continue;
        const fallback = nextEmptySlot();
        if (!fallback) break;
        console.log(`AI returned no slot for ${fd.id} → placing in ${fallback}`);
        occupiedSlots.add(fallback);
        onPhotoUpload(fd.file, fallback);
      }
    } catch (err) {
      console.error("Bulk upload classification error:", err);
      // Fallback: assign to empty slots in order
      const emptySlots = VIEW_SLOTS.filter(
        (slot) => !photos.find((p) => p.viewType === slot.type)
      );
      imageFiles.forEach((file, index) => {
        if (index < emptySlots.length) {
          onPhotoUpload(file, emptySlots[index].type);
        }
      });
    } finally {
      setIsClassifying(false);
    }
  };

  const handleDrop = useCallback(
    async (e: React.DragEvent, viewType: string) => {
      e.preventDefault();
      setActiveSlot(null);
      const file = e.dataTransfer.files[0];
      if (!file || !file.type.startsWith("image/")) return;

      // AI auto-sort on drop too
      try {
        const { base64, mimeType } = await resizeForClassify(file);
        const { data, error } = await supabase.functions.invoke("classify-vehicle-views", {
          body: { images: [{ id: "drop", data: base64, mimeType }] },
        });
        if (!error && data?.classifications?.length > 0) {
          const detected = data.classifications[0].viewType as string;
          if (detected !== viewType && VIEW_SLOTS.some((s) => s.type === detected) && !photos.find((p) => p.viewType === detected)) {
            onPhotoUpload(file, detected);
            return;
          }
        }
      } catch { /* fallback */ }

      onPhotoUpload(file, viewType);
    },
    [onPhotoUpload, photos]
  );

  return (
    <Card className="p-3 bg-zinc-800 border-zinc-600">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold">Multi-View Photos</span>
          <span className="text-xs text-muted-foreground">
            ({photos.length}/6 uploaded)
          </span>
        </div>
        {photos.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="h-7 px-2 text-muted-foreground hover:text-destructive"
          >
            <X className="w-3 h-3 mr-1" />
            Clear All
          </Button>
        )}
      </div>

      {photos.length < VIEW_SLOTS.length && (
        <Button
          onClick={() => bulkInputRef.current?.click()}
          disabled={isClassifying}
          className="w-full mb-3 bg-blue-500/15 border border-blue-500/50 text-blue-300 hover:bg-blue-500/25 hover:text-blue-200"
          variant="outline"
        >
          {isClassifying ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              AI sorting your photos...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Upload All Angles at Once
            </>
          )}
        </Button>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {VIEW_SLOTS.map((slot) => {
          const photo = getPhotoForView(slot.type);

          return (
            <div key={slot.type} className="relative">
              {photo ? (
                // Uploaded photo preview
                <div className="relative aspect-[4/3] rounded-lg overflow-hidden border border-blue-500/40 bg-black/20">
                  <img
                    src={photo.previewUrl}
                    alt={slot.label}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                    <span className="text-[10px] text-white font-medium">{slot.label}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemovePhoto(slot.type)}
                    className="absolute top-1 right-1 h-5 w-5 p-0 bg-black/50 hover:bg-red-500/80 text-white rounded-full"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                // Upload slot
                <div
                  onDrop={(e) => handleDrop(e, slot.type)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setActiveSlot(slot.type);
                  }}
                  onDragLeave={() => setActiveSlot(null)}
                  onClick={() => fileInputRefs.current[slot.type]?.click()}
                  className={cn(
                    "aspect-[4/3] rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all gap-1",
                    activeSlot === slot.type
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-border/40 hover:border-primary/40 hover:bg-primary/5"
                  )}
                >
                  <Plus className="w-4 h-4 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {slot.label}
                  </span>
                </div>
              )}

              <input
                ref={(el) => { fileInputRefs.current[slot.type] = el; }}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => handleFileSelect(e, slot.type)}
                className="hidden"
              />
            </div>
          );
        })}
      </div>

      {(isAnalyzing || isClassifying) && (
        <div className="flex items-center gap-2 mt-2 text-xs text-blue-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          {isClassifying ? "AI is sorting photos by view angle..." : "Analyzing vehicle..."}
        </div>
      )}

      {/* Hidden bulk file input */}
      <input
        ref={bulkInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={handleBulkUpload}
        className="hidden"
      />

      <p className="text-xs text-muted-foreground mt-2 text-center">
        Tip: use <span className="text-blue-300 font-medium">Upload All Angles at Once</span> to select every photo together — AI sorts them into the correct slots. Or click any individual slot to upload one at a time.
      </p>
    </Card>
  );
};
