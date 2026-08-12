import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, X, Loader2, ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ColorRevisionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firstViewUrl: string | null;
  colorName: string;
  manufacturer: string;
  onSubmit: (correction: {
    swatchImageUrl?: string;
    vehicleExampleUrls?: string[];
    notes?: string;
  }) => Promise<void>;
}

export const ColorRevisionModal = ({
  open,
  onOpenChange,
  firstViewUrl,
  colorName,
  manufacturer,
  onSubmit,
}: ColorRevisionModalProps) => {
  const { toast } = useToast();
  const [swatchPreview, setSwatchPreview] = useState<string | null>(null);
  const [swatchFile, setSwatchFile] = useState<File | null>(null);
  const [vehicleExamples, setVehicleExamples] = useState<Array<{ file: File; preview: string }>>([]);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const swatchInputRef = useRef<HTMLInputElement>(null);
  const exampleInputRef = useRef<HTMLInputElement>(null);

  const handleSwatchDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      setSwatchFile(file);
      setSwatchPreview(URL.createObjectURL(file));
    }
  }, []);

  const handleSwatchSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSwatchFile(file);
      setSwatchPreview(URL.createObjectURL(file));
    }
  };

  const handleExampleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = 3 - vehicleExamples.length;
    const newFiles = files.slice(0, remaining).filter((f) => f.type.startsWith("image/"));

    setVehicleExamples((prev) => [
      ...prev,
      ...newFiles.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
  };

  const removeExample = (index: number) => {
    setVehicleExamples((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadToStorage = async (file: File, path: string): Promise<string | null> => {
    const { error } = await supabase.storage
      .from("wrap-files")
      .upload(path, file, { contentType: file.type, upsert: true });

    if (error) {
      console.error("Upload failed:", error);
      return null;
    }

    const { data } = supabase.storage.from("wrap-files").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSubmit = async () => {
    if (!swatchFile && vehicleExamples.length === 0 && !notes) {
      toast({ title: "Add references", description: "Upload a swatch, vehicle examples, or add notes.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const timestamp = Date.now();
      const safeFilmName = (colorName || "film").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);

      // Upload swatch
      let swatchImageUrl: string | undefined;
      if (swatchFile) {
        const ext = swatchFile.type.includes("png") ? "png" : "jpg";
        const path = `film-references/${safeFilmName}/swatch_${timestamp}.${ext}`;
        swatchImageUrl = (await uploadToStorage(swatchFile, path)) || undefined;
      }

      // Upload vehicle examples
      const vehicleExampleUrls: string[] = [];
      for (let i = 0; i < vehicleExamples.length; i++) {
        const ex = vehicleExamples[i];
        const ext = ex.file.type.includes("png") ? "png" : "jpg";
        const path = `film-references/${safeFilmName}/example_${i}_${timestamp}.${ext}`;
        const url = await uploadToStorage(ex.file, path);
        if (url) vehicleExampleUrls.push(url);
      }

      await onSubmit({
        swatchImageUrl,
        vehicleExampleUrls: vehicleExampleUrls.length > 0 ? vehicleExampleUrls : undefined,
        notes: notes || undefined,
      });

      // Reset
      setSwatchPreview(null);
      setSwatchFile(null);
      setVehicleExamples([]);
      setNotes("");
    } catch (err: any) {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-background border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Color Correction</DialogTitle>
          <DialogDescription>
            The rendered color for <strong>{manufacturer} {colorName}</strong> doesn't look right?
            Upload reference images so the system learns the correct color.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Current render preview */}
          {firstViewUrl && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Current Render (incorrect)</Label>
              <img
                src={firstViewUrl}
                alt="Current render"
                className="w-full max-h-48 object-contain rounded-lg border border-destructive/30"
              />
            </div>
          )}

          {/* Swatch upload (drag-drop) */}
          <div>
            <Label className="text-sm font-semibold mb-2 block">Correct Swatch Image</Label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleSwatchDrop}
              onClick={() => swatchInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all",
                swatchPreview
                  ? "border-blue-500/50 bg-blue-500/5"
                  : "border-border hover:border-blue-500/50 hover:bg-secondary/20"
              )}
            >
              {swatchPreview ? (
                <div className="relative inline-block">
                  <img src={swatchPreview} alt="Swatch" className="max-h-24 rounded" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSwatchPreview(null);
                      setSwatchFile(null);
                    }}
                    className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-2">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Drag & drop swatch image, or click to browse
                  </p>
                </div>
              )}
            </div>
            <input ref={swatchInputRef} type="file" accept="image/*" className="hidden" onChange={handleSwatchSelect} />
          </div>

          {/* Vehicle examples (up to 3) */}
          <div>
            <Label className="text-sm font-semibold mb-2 block">
              Real Vehicle Examples ({vehicleExamples.length}/3)
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              Photos of real vehicles wrapped in this exact film color
            </p>

            <div className="grid grid-cols-3 gap-2">
              {vehicleExamples.map((ex, i) => (
                <div key={i} className="relative">
                  <img src={ex.preview} alt={`Example ${i + 1}`} className="w-full h-24 object-cover rounded-lg border border-border" />
                  <button
                    onClick={() => removeExample(i)}
                    className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}

              {vehicleExamples.length < 3 && (
                <button
                  onClick={() => exampleInputRef.current?.click()}
                  className="h-24 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-1 hover:border-blue-500/50 hover:bg-secondary/20 transition-all"
                >
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Add</span>
                </button>
              )}
            </div>
            <input ref={exampleInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleExampleSelect} />
          </div>

          {/* Notes */}
          <div>
            <Label className="text-sm font-semibold mb-2 block">Correction Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., The color should be darker/more metallic, the real film has a blue shift in shade..."
              className="min-h-[80px] resize-none"
            />
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1 bg-gradient-to-r from-blue-600 to-blue-500 text-white"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving & Re-rendering...
                </div>
              ) : (
                "Save Correction & Re-render"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
