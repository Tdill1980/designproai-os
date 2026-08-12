import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Camera, Upload, X, Loader2, Car, RefreshCw } from "lucide-react";
import { BeforeAfterViewer } from "@/components/colorpro/BeforeAfterViewer";
import { renderClient } from "@/integrations/supabase/renderClient";
import { getActiveUser } from "@/lib/auth-session";
import { pickMyVehicleEndpoint } from "@/lib/myvehicleEndpoint";
import { cn } from "@/lib/utils";

/**
 * MyVehicleProInline - Self-contained inline panel for applying an existing
 * render's design/color to a customer's real vehicle photo.
 *
 * Drop this anywhere a render is displayed. It:
 * 1. Shows a branded MyVehiclePro button
 * 2. Expands to a photo uploader when clicked
 * 3. Calls edit-vehicle-photo with the render's color/design data
 * 4. Shows before/after result
 * 5. NEVER modifies the original render
 */

interface MyVehicleProInlineProps {
  /** The existing render's color/design data */
  colorName?: string;
  colorHex?: string;
  finishType?: string;
  manufacturer?: string;
  modeType?: string;
  /** Vehicle info from the original render */
  vehicleYear?: number | string;
  vehicleMake?: string;
  vehicleModel?: string;
  /** Design panel URL if applicable (DesignPro/RestyleLibrary) */
  panelUrl?: string | null;
  designName?: string | null;
  /** Optional: hero render URL to use as reference context */
  renderUrl?: string | null;
  /** Compact mode for tight spaces */
  compact?: boolean;
}

export const MyVehicleProInline = ({
  colorName,
  colorHex,
  finishType,
  manufacturer,
  modeType,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  panelUrl,
  designName,
  renderUrl,
  compact = false,
}: MyVehicleProInlineProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoMimeType, setPhotoMimeType] = useState("image/jpeg");
  const [isGenerating, setIsGenerating] = useState(false);
  const [editedImageUrl, setEditedImageUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = useCallback((file: File) => {
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setErrorMessage("Please upload a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage("Image must be under 10MB.");
      return;
    }

    // Hard-reject only very low-resolution photos — they'll render blurry at 4K.
    // Portrait shots are allowed (the 16:9 render handles them) but will be noted below.
    const probe = new Image();
    const url = URL.createObjectURL(file);
    probe.onload = () => {
      URL.revokeObjectURL(url);
      const longEdge = Math.max(probe.width, probe.height);
      if (longEdge < 600) {
        setErrorMessage(`Photo is too low quality (${probe.width}×${probe.height}). Use at least 600px on the long side for a sharp render.`);
        return;
      }

      setErrorMessage(null);
      setEditedImageUrl(null);

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setPhotoPreviewUrl(dataUrl);
        setPhotoMimeType(file.type);
        setPhotoBase64(dataUrl.split(",")[1]);
      };
      reader.readAsDataURL(file);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      setErrorMessage("Couldn't read image. Try a different file.");
    };
    probe.src = url;
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handlePhotoUpload(file);
  }, [handlePhotoUpload]);

  const handleGenerate = async () => {
    if (!photoBase64) return;

    setIsGenerating(true);
    setErrorMessage(null);
    setEditedImageUrl(null);

    try {
      const user = await getActiveUser();
      if (!user?.email) throw new Error("Please sign in to generate.");

      const isDesignMode = !!(panelUrl || modeType?.includes("design"));
      const toolSource = modeType?.includes("design") ? "DesignPanelPro"
        : modeType?.includes("fade") ? "FadeWraps"
        : modeType?.includes("graphic") ? "GraphicsPro"
        : "ColorPro";

      const colorData: Record<string, any> = {
        colorName: colorName || designName || "Custom",
        hex: colorHex || "#808080",
        finish: (finishType || "Gloss").toLowerCase(),
        manufacturer: manufacturer || "",
        colorLibrary: modeType || "colorpro",
        toolSource,
      };

      if (panelUrl) {
        colorData.panelUrl = panelUrl;
        colorData.panelName = designName || colorName || "Design";
      }

      const endpoint = pickMyVehicleEndpoint(toolSource);
      const { data, error } = await renderClient.functions.invoke(endpoint, {
        body: {
          userEmail: user.email,
          uploadedPhotoBase64: photoBase64,
          uploadedPhotoMimeType: photoMimeType,
          colorData,
          vehicleInfo: {
            make: vehicleMake || "",
            model: vehicleModel || "",
            year: String(vehicleYear || ""),
          },
        },
      });

      if (error) throw new Error(error.message || "Photo edit failed");
      if (data?.error) throw new Error(data.error);
      if (data?.renderUrl) {
        setEditedImageUrl(data.renderUrl);
      } else {
        throw new Error("No image returned from the editor.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "An unexpected error occurred.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClear = () => {
    setPhotoPreviewUrl(null);
    setPhotoBase64(null);
    setEditedImageUrl(null);
    setErrorMessage(null);
  };

  // ─── Collapsed state: just a button ───
  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        size={compact ? "sm" : "default"}
        className={cn(
          "border-blue-500/30 hover:border-blue-500/50 hover:bg-blue-500/10 transition-all",
          compact ? "text-xs h-8" : "w-full h-11"
        )}
      >
        <Camera className={cn("mr-2", compact ? "w-3 h-3" : "w-4 h-4")} />
        <span className="font-semibold">
          <span className="text-foreground">MyVehicle</span>
          <span className="text-blue-400">Pro&#8482;</span>
        </span>
      </Button>
    );
  }

  // ─── Expanded state: uploader + result ───
  return (
    <Card className="border-blue-500/30 bg-gradient-to-b from-blue-500/5 to-transparent overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-blue-500/20">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-bold">
            <span className="text-foreground">MyVehicle</span>
            <span className="text-blue-400">Pro&#8482;</span>
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setIsOpen(false); handleClear(); }}
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="p-4 space-y-3">
        {/* Context: what design will be applied */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Applying:</span>
          {colorHex && (
            <div
              className="w-4 h-4 rounded-full border border-white/20 flex-shrink-0"
              style={{ backgroundColor: colorHex }}
            />
          )}
          <span className="font-medium text-foreground truncate">
            {colorName || designName || "Design"} {finishType || ""}
          </span>
        </div>

        {/* Before/After Result */}
        {editedImageUrl && photoPreviewUrl && (
          <div className="space-y-3">
            <BeforeAfterViewer
              beforeUrl={photoPreviewUrl}
              afterUrl={editedImageUrl}
              beforeLabel="Your Vehicle"
              afterLabel={colorName || designName || "Wrapped"}
            />
            <div className="flex gap-2">
              <Button
                onClick={handleClear}
                variant="outline"
                size="sm"
                className="flex-1"
              >
                <RefreshCw className="w-3 h-3 mr-1.5" /> Try Another Photo
              </Button>
              <Button
                onClick={() => {
                  const link = document.createElement("a");
                  link.href = editedImageUrl;
                  link.download = `myvehicle_${colorName || "wrap"}.png`;
                  link.target = "_blank";
                  link.click();
                }}
                size="sm"
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                Download
              </Button>
            </div>
          </div>
        )}

        {/* Photo uploader (when no result yet) */}
        {!editedImageUrl && (
          <>
            {photoPreviewUrl ? (
              <div className="space-y-3">
                <div className="relative rounded-lg overflow-hidden border border-border/50">
                  <img
                    src={photoPreviewUrl}
                    alt="Your vehicle"
                    className="w-full h-auto max-h-[250px] object-contain bg-black/20"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                    className="absolute top-2 right-2 h-7 px-2 bg-black/60 text-white hover:bg-black/80"
                  >
                    <X className="w-3 h-3 mr-1" /> Remove
                  </Button>
                </div>

                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white h-10"
                >
                  {isGenerating ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Applying to Your Vehicle...</>
                  ) : (
                    <><Camera className="w-4 h-4 mr-2" /> See This on My Vehicle</>
                  )}
                </Button>
              </div>
            ) : (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-all",
                  isDragOver
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-border/50 hover:border-blue-500/50 hover:bg-blue-500/5"
                )}
              >
                <Upload className="w-7 h-7 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">Upload your vehicle photo</p>
                <p className="text-xs text-muted-foreground mt-1">
                  JPEG, PNG, WebP - max 10MB
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePhotoUpload(file);
                if (e.target) e.target.value = "";
              }}
              className="hidden"
            />
          </>
        )}

        {/* Error message */}
        {errorMessage && (
          <p className="text-xs text-red-400 text-center">{errorMessage}</p>
        )}

        <p className="text-[10px] text-muted-foreground text-center">
          Original design is never modified. This creates a separate preview on your real vehicle.
        </p>
      </div>
    </Card>
  );
};
