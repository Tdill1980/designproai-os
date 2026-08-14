import { useState, useRef, useId } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ImagePlus, X, Loader2, Palette, Copy, Maximize2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { VisionBoardImage, VisionBoardIntent } from "@/lib/designiq-engine";
import { removeBackgroundFromFile } from "@/lib/logo-composite";

interface VisionBoardUploaderProps {
  images: VisionBoardImage[];
  onChange: (images: VisionBoardImage[]) => void;
  intent: VisionBoardIntent;
  onIntentChange: (intent: VisionBoardIntent) => void;
  maxImages?: number;
  disabled?: boolean;
  /** Hide the style/exact intent toggle (used for Layer 2 logos which are
   *  always exact references). */
  hideIntent?: boolean;
  /** Override the Pro Tip body (defaults to the Layer 1 background guidance). */
  proTip?: React.ReactNode;
  /** Logo box: auto-strip a solid/white background from the uploaded logo to a
   *  true transparent cutout (deterministic corner-flood; already-transparent
   *  PNGs pass through untouched). */
  cleanLogoBg?: boolean;
  /** Compact mode: hide the VisionBoardIQ branding header, example image, and
   *  Pro Tip — render only the upload grid (used for the Layer 2 logo box). */
  compact?: boolean;
  /** DesignPro customer context only: when "Recreate Exactly" is picked, show a
   *  helper that routes "reproduce this AND tweak it" customers to RecreatePro
   *  (which has a built-in edit box for moving a logo / changing a color). Off by
   *  default so GraphicsPro / admin reuse of this component is unaffected. */
  recreateProRedirect?: boolean;
  /** Handoff for the RecreatePro button. When provided, the parent carries the
   *  uploaded reference(s) + vehicle into RecreatePro (one tap, no re-upload)
   *  instead of a bare navigate. */
  onRecreateProHandoff?: () => void;
}

export const VisionBoardUploader = ({
  images,
  onChange,
  intent,
  onIntentChange,
  maxImages = 4,
  disabled = false,
  hideIntent = false,
  proTip,
  cleanLogoBg = false,
  compact = false,
  recreateProRedirect = false,
  onRecreateProHandoff,
}: VisionBoardUploaderProps) => {
  const navigate = useNavigate();
  const [isUploading, setIsUploading] = useState(false);
  const [exampleExpanded, setExampleExpanded] = useState(false);
  const [enlargedImage, setEnlargedImage] = useState<VisionBoardImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Unique per-instance id. This component renders MORE THAN ONCE on the brief
  // (the "Match this wrap style" VisionBoard box AND the "Your logo" box). A
  // hardcoded input id collided across instances, so the <label htmlFor> always
  // triggered the FIRST input in the DOM — every upload landed in the top box and
  // the "Your logo" box was impossible to use. useId() gives each instance its own
  // id so each Add button opens (and fills) its OWN box.
  const fileInputId = useId();

  // Logo box: strip a solid/white background to a true transparent cutout using
  // the existing deterministic corner-flood (logo-composite). Returns null for
  // images that already have transparent edges (left untouched).
  const maybeStripLogoBg = async (file: File): Promise<Blob | null> => {
    try {
      const bmp = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width; canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { bmp.close?.(); return null; }
      ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      const corners = [[0, 0], [canvas.width - 1, 0], [0, canvas.height - 1], [canvas.width - 1, canvas.height - 1]];
      const opaque = corners.some(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] > 250);
      if (!opaque) return null; // already has transparent edges
      const { blob } = await removeBackgroundFromFile(file);
      return blob;
    } catch {
      return null;
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const slotsAvailable = maxImages - images.length;
    const filesToUpload = Array.from(files).slice(0, slotsAvailable);

    // Validate all files first
    for (const file of filesToUpload) {
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid file type",
          description: `"${file.name}" is not an image. Please upload JPG, PNG, or WebP files.`,
          variant: "destructive",
        });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: `"${file.name}" exceeds 10MB. Please use a smaller image.`,
          variant: "destructive",
        });
        return;
      }
    }

    if (filesToUpload.length < files.length) {
      toast({
        title: "Some files skipped",
        description: `Only ${slotsAvailable} slot${slotsAvailable === 1 ? "" : "s"} available. ${files.length - slotsAvailable} file${files.length - slotsAvailable === 1 ? "" : "s"} skipped.`,
      });
    }

    setIsUploading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id || "anonymous";

      const uploadedImages: VisionBoardImage[] = [];

      await Promise.all(
        filesToUpload.map(async (file, i) => {
          const timestamp = Date.now() + i;
          // Logo box: strip a solid/white background to transparent before upload.
          let uploadBlob: Blob = file;
          let ext = file.name.split(".").pop() || "png";
          if (cleanLogoBg) {
            const stripped = await maybeStripLogoBg(file);
            if (stripped) { uploadBlob = stripped; ext = "png"; }
          }
          const filePath = `vision-board-refs/${userId}/${timestamp}.${ext}`;

          const { error } = await supabase.storage
            .from("patterns")
            .upload(filePath, uploadBlob, {
              cacheControl: "3600",
              upsert: false,
              contentType: uploadBlob.type || "image/png",
            });

          if (error) throw error;

          const {
            data: { publicUrl },
          } = supabase.storage.from("patterns").getPublicUrl(filePath);

          uploadedImages.push({
            slotLabel: `Reference ${images.length + i + 1}`,
            storageUrl: publicUrl,
          });
        })
      );

      onChange([...images, ...uploadedImages]);

      toast({
        title: `${uploadedImages.length} reference${uploadedImages.length === 1 ? "" : "s"} uploaded`,
        description: "DesignIQ will study these images to guide your design",
      });
    } catch (error: any) {
      console.error("VisionBoard upload error:", error);
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload reference images",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemove = (index: number) => {
    onChange(images.filter((_, i) => i !== index));
  };

  const canAddMore = images.length < maxImages;

  return (
    <div className="space-y-4">
      {/* Branded Header with Example Image — hidden in compact mode */}
      {!compact && (
      <div className="flex flex-col sm:flex-row gap-3 items-start">
        {/* Left: Branding + description */}
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-blue-400" />
            <h4 className="text-sm font-bold text-gradient-designiq">
              VisionBoardIQ&#8482;
            </h4>
            <Badge className="bg-blue-500/15 text-blue-400 border-0 text-[10px] font-bold px-1.5 py-0">
              AI
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Upload your vision - sketches, inspiration photos, color palettes,
            brand assets. DesignIQ studies your references and designs from them.
          </p>
        </div>

        {/* Right: Example image thumbnail */}
        <div
          className="shrink-0 cursor-pointer group"
          onClick={() => setExampleExpanded(true)}
        >
          <div className="w-[120px] sm:w-[140px] rounded-lg overflow-hidden border border-blue-500/30 group-hover:border-blue-400/60 transition-colors">
            <img
              src="/visionboard-example.png"
              alt="VisionBoard Example - SEMA Tesla Model 3 design board"
              className="w-full h-auto object-cover"
            />
          </div>
          <p className="text-[9px] text-blue-400/70 mt-1 text-center">
            Example VisionBoard
          </p>
        </div>
      </div>
      )}

      {/* Pro Tip — in compact mode only show when a custom proTip is provided */}
      {(!compact || proTip) && (
      <p className="text-[11px] text-muted-foreground/80 bg-blue-500/5 border border-blue-500/15 rounded-md px-3 py-2 leading-relaxed">
        {proTip ?? (
          <>
            <span className="font-semibold text-blue-400">Pro Tip:</span> Upload
            sketches, inspiration wraps, color palettes, or mood boards. The AI
            analyzes your references to match your creative vision.
          </>
        )}
      </p>
      )}

      {/* Upload grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {images.map((img, index) => (
          <div
            key={img.storageUrl}
            className="relative aspect-square rounded-lg overflow-hidden border border-border group cursor-pointer"
            onClick={() => setEnlargedImage(img)}
          >
            <img
              src={img.storageUrl}
              alt={img.slotLabel}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(index);
              }}
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/90"
              disabled={disabled}
            >
              <X className="w-3 h-3 text-white" />
            </button>
            <div className="absolute bottom-1 left-1 right-1">
              <span className="text-[9px] text-white/80 bg-black/50 px-1.5 py-0.5 rounded">
                {img.slotLabel} — tap to enlarge
              </span>
            </div>
          </div>
        ))}

        {/* Add slot — uses <label> for reliable mobile file input trigger */}
        {canAddMore && (
          <label
            htmlFor={fileInputId}
            className={cn(
              "aspect-square rounded-lg border-2 border-dashed border-border/60 cursor-pointer",
              "hover:border-blue-500/40 hover:bg-blue-500/5 transition-all",
              "flex flex-col items-center justify-center gap-1",
              (disabled || isUploading) && "pointer-events-none opacity-50"
            )}
          >
            {isUploading ? (
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            ) : (
              <>
                <ImagePlus className="w-5 h-5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Add</span>
              </>
            )}
          </label>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/50">
        JPG, PNG, WebP - Max 10MB each - Up to {maxImages} images
      </p>

      {/* AI Intent — choose how DesignIQ treats the uploaded reference(s).
          BOTH options stay inside GraphicsPro. "Recreate Exactly" sets the
          exact_reference intent, which the render path (generate-graphics-pro)
          detects as a CLONE and reproduces the uploaded design on the vehicle —
          no redirect to a separate tool. */}
      {!hideIntent && images.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">
            How should DesignIQ use these images?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onIntentChange("style_inspiration")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-semibold transition-all border",
                intent === "style_inspiration"
                  ? "border-cyan-500 bg-cyan-500/15 text-cyan-400 shadow-[0_0_8px_rgba(0,200,255,0.3)]"
                  : "border-border bg-background text-muted-foreground hover:border-cyan-500/40 hover:text-cyan-300"
              )}
            >
              <Palette className="w-4 h-4 shrink-0" />
              Style Inspiration
            </button>
            <button
              type="button"
              onClick={() => onIntentChange("exact_reference")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-semibold transition-all border",
                intent === "exact_reference"
                  ? "border-cyan-500 bg-cyan-500/15 text-cyan-400 shadow-[0_0_8px_rgba(0,200,255,0.3)]"
                  : "border-border bg-background text-muted-foreground hover:border-cyan-500/40 hover:text-cyan-300"
              )}
            >
              <Copy className="w-4 h-4 shrink-0" />
              Recreate Exactly
            </button>
          </div>
          {/* Inline explainer — spells out the difference so the choice is
              unmistakable: Style Inspiration = a NEW design; Recreate Exactly =
              a faithful reproduction of the upload. */}
          <p className="text-[11px] leading-snug text-muted-foreground/70">
            {intent === "exact_reference"
              ? "Reproduces your uploaded design on your vehicle as-is — same colors, layout, typography, logos, and graphics. Not a new design."
              : "Creates a NEW original design using your reference's colors, mood, and style. Your upload is inspiration — it is not copied."}
          </p>

          {/* APPROPRIATE-TOOL HANDOFF (DesignPro only): reproducing an uploaded
              design is a RecreatePro job — that tool reproduces it AND has the
              built-in edit box ("move the logo up so it clears the wheel well").
              When Recreate Exactly is chosen we make RecreatePro the PRIMARY next
              step and carry the upload + vehicle over (onRecreateProHandoff) so it
              is one tap, no re-upload. Falls back to a plain navigate if no handoff
              was wired. */}
          {recreateProRedirect && intent === "exact_reference" && (
            <div className="mt-1 rounded-md border border-cyan-500/40 bg-cyan-500/10 p-3">
              <p className="text-[11px] leading-snug text-foreground/85">
                <span className="font-semibold text-cyan-400">Reproducing a design? That's RecreatePro.</span>{" "}
                It recreates your uploaded design exactly <span className="font-semibold">and</span> lets you tweak it — move a logo off the wheel well, swap a color — which you can't do here.
              </p>
              <button
                type="button"
                onClick={() => (onRecreateProHandoff ? onRecreateProHandoff() : navigate("/recreatepro"))}
                className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-cyan-500 bg-cyan-500 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-cyan-400"
              >
                <Copy className="h-4 w-4" />
                Continue in RecreatePro →
              </button>
              <p className="mt-1.5 text-[10px] text-muted-foreground/70 text-center">
                Brings your uploaded design + vehicle along — no re-upload.
              </p>
            </div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        id={fileInputId}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Expanded example image modal */}
      <Dialog open={exampleExpanded} onOpenChange={setExampleExpanded}>
        <DialogContent className="max-w-3xl p-2">
          <img
            src="/visionboard-example.png"
            alt="VisionBoard Example - SEMA Tesla Model 3 design board showing vehicle photos, inspiration, color palette, shop drawing, and draft renders"
            className="w-full h-auto rounded-lg"
          />
          <p className="text-xs text-muted-foreground text-center mt-2">
            WePrintWraps SEMA VisionBoard - The Vehicle, Inspiration, Color
            Palette, Shop Drawing, Draft Renders
          </p>
        </DialogContent>
      </Dialog>

      {/* Enlarged uploaded image modal */}
      <Dialog open={!!enlargedImage} onOpenChange={() => setEnlargedImage(null)}>
        <DialogContent className="max-w-4xl p-2 bg-black/95">
          <DialogTitle className="sr-only">
            {enlargedImage?.slotLabel || "Reference Image"}
          </DialogTitle>
          {enlargedImage && (
            <div className="space-y-3">
              <img
                src={enlargedImage.storageUrl}
                alt={enlargedImage.slotLabel}
                className="w-full h-auto max-h-[75vh] object-contain rounded-lg"
              />
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <Palette className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-semibold text-blue-400">
                    VisionBoardIQ&#8482;
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {enlargedImage.slotLabel}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground/60">
                  Uploaded Reference
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
