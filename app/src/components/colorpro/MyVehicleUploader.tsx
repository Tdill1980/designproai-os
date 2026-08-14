import { useCallback, useRef, useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, X, Camera, Loader2, Car, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

interface MyVehicleUploaderProps {
  photoPreviewUrl: string | null;
  isAnalyzing: boolean;
  detectedVehicleInfo: {
    make: string;
    model: string;
    year: string;
    color?: string;
    finish?: string;
  } | null;
  onPhotoUpload: (file: File) => void;
  onClear: () => void;
  onVehicleInfoUpdate?: (info: { make: string; model: string; year: string }) => void;
}

export const MyVehicleUploader = ({
  photoPreviewUrl,
  isAnalyzing,
  detectedVehicleInfo,
  onPhotoUpload,
  onClear,
  onVehicleInfoUpdate,
}: MyVehicleUploaderProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editYear, setEditYear] = useState("");
  const [editMake, setEditMake] = useState("");
  const [editModel, setEditModel] = useState("");

  // Pre-fill edit fields when AI detection completes
  useEffect(() => {
    if (detectedVehicleInfo) {
      setEditYear(detectedVehicleInfo.year || "");
      setEditMake(detectedVehicleInfo.make || "");
      setEditModel(detectedVehicleInfo.model || "");
    }
  }, [detectedVehicleInfo]);

  const handleSaveVehicleInfo = () => {
    if (onVehicleInfoUpdate && (editMake || editModel)) {
      onVehicleInfoUpdate({ year: editYear, make: editMake, model: editModel });
    }
    setIsEditing(false);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        onPhotoUpload(file);
      }
    },
    [onPhotoUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onPhotoUpload(file);
    }
    // Reset input so same file can be re-selected
    if (e.target) e.target.value = "";
  };

  // Show uploaded photo preview
  if (photoPreviewUrl) {
    return (
      <Card className="p-3 bg-secondary/20 border-border overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold">Your Vehicle Photo</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-7 px-2 text-muted-foreground hover:text-destructive"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Remove
          </Button>
        </div>

        <div className="relative rounded-lg overflow-hidden border border-border/50">
          <img
            src={photoPreviewUrl}
            alt="Uploaded vehicle"
            className="w-full h-auto max-h-[300px] object-contain bg-black/20"
          />

          {/* Analysis overlay */}
          {isAnalyzing && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <div className="flex items-center gap-2 text-white text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Detecting vehicle...
              </div>
            </div>
          )}
        </div>

        {/* Detected vehicle info — editable */}
        {!isAnalyzing && (photoPreviewUrl) && (
          <div className="mt-2 p-2 rounded-md bg-blue-500/10 border border-blue-500/30">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 text-xs text-blue-400">
                <Car className="w-3.5 h-3.5" />
                <span className="font-medium">
                  {detectedVehicleInfo ? "Vehicle Detected" : "Enter Vehicle Info"}
                </span>
              </div>
              {!isEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  className="h-5 px-1.5 text-[10px] text-blue-400 hover:text-blue-300"
                >
                  <Pencil className="w-3 h-3 mr-0.5" />
                  {detectedVehicleInfo ? "Edit" : "Type"}
                </Button>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-1.5">
                <div className="grid grid-cols-3 gap-1.5">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Year</Label>
                    <Input
                      value={editYear}
                      onChange={(e) => setEditYear(e.target.value)}
                      placeholder="2024"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Make</Label>
                    <Input
                      value={editMake}
                      onChange={(e) => setEditMake(e.target.value)}
                      placeholder="BMW"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Model</Label>
                    <Input
                      value={editModel}
                      onChange={(e) => setEditModel(e.target.value)}
                      placeholder="X3"
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={handleSaveVehicleInfo} className="h-6 text-[10px] flex-1">
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="h-6 text-[10px]">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-foreground">
                  {[editYear || detectedVehicleInfo?.year, editMake || detectedVehicleInfo?.make, editModel || detectedVehicleInfo?.model]
                    .filter(Boolean)
                    .join(" ") || "Tap Edit to enter vehicle info"}
                </p>
                {detectedVehicleInfo?.color && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Current color: {detectedVehicleInfo.color}
                    {detectedVehicleInfo.finish ? ` (${detectedVehicleInfo.finish})` : ""}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    );
  }

  // Upload dropzone
  return (
    <Card className="p-3 bg-secondary/20 border-border">
      <div className="flex items-center gap-2 mb-2">
        <Camera className="w-4 h-4" />
        <span className="text-sm font-semibold">Upload Vehicle Photo</span>
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all",
          isDragOver
            ? "border-blue-500 bg-blue-500/10"
            : "border-border/50 hover:border-primary/50 hover:bg-primary/5"
        )}
      >
        <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          Drop your vehicle photo here
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          or click to browse (JPEG, PNG, WebP - max 10MB)
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileSelect}
        className="hidden"
      />

      <p className="text-xs text-muted-foreground mt-2 text-center">
        For best results, use a clear photo with good lighting
      </p>
    </Card>
  );
};
