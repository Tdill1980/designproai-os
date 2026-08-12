/**
 * RequestRevisionDialog
 *
 * Customer-facing dialog on the public proof page. Collects revision notes
 * plus up to 4 optional reference images. Each image uploads via
 * proof-upload-revision-ref (which returns a storage path), then the
 * batch of paths + notes is submitted to proof-request-revision.
 *
 * Uploads happen one at a time before final submit so failures are visible
 * and the submit is a pure metadata call.
 */

import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, Send, ImagePlus, X } from "lucide-react";

interface RequestRevisionDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string;
  onSuccess: () => void;
}

interface UploadedRef {
  path: string;
  previewUrl: string | null;
  filename: string;
}

const MAX_REFS = 4;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function generateIdempotencyKey(): string {
  return (crypto as any).randomUUID?.() ||
    `rev-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.replace(/^data:[^,]+,/, ""));
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export const RequestRevisionDialog = ({
  open,
  onOpenChange,
  token,
  onSuccess,
}: RequestRevisionDialogProps) => {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [refs, setRefs] = useState<UploadedRef[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setNotes("");
    setRefs([]);
    setError(null);
  };

  const handleClose = () => {
    if (isSubmitting || isUploading) return;
    reset();
    onOpenChange(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const slotsLeft = MAX_REFS - refs.length;
    const selected = Array.from(files).slice(0, slotsLeft);

    for (const file of selected) {
      if (!ALLOWED_TYPES.has(file.type)) {
        toast({
          title: "Unsupported file",
          description: `${file.name} is not an image we accept. Use JPEG, PNG, WebP, or HEIC.`,
          variant: "destructive",
        });
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast({
          title: "File too large",
          description: `${file.name} is over 8MB.`,
          variant: "destructive",
        });
        continue;
      }

      setIsUploading(true);
      try {
        const base64 = await fileToBase64(file);
        const { data, error: invokeErr } = await supabase.functions.invoke(
          "proof-upload-revision-ref",
          {
            body: {
              token,
              filename: file.name,
              content_type: file.type,
              data_base64: base64,
            },
          },
        );
        if (invokeErr || !data?.success) {
          const msg = (data as any)?.error || invokeErr?.message || "Upload failed";
          toast({
            title: `${file.name} upload failed`,
            description: msg,
            variant: "destructive",
          });
          continue;
        }
        setRefs((prev) => [
          ...prev,
          {
            path: data.path,
            previewUrl: data.preview_url || null,
            filename: file.name,
          },
        ]);
      } catch (err: any) {
        toast({
          title: `${file.name} upload failed`,
          description: err?.message || "Network error",
          variant: "destructive",
        });
      } finally {
        setIsUploading(false);
      }
    }

    // Reset the native input so re-picking the same file still fires onChange
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveRef = (path: string) => {
    setRefs((prev) => prev.filter((r) => r.path !== path));
  };

  const handleSubmit = async () => {
    if (notes.trim().length < 3) {
      setError("Tell the shop what to change (minimum 3 characters).");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        "proof-request-revision",
        {
          body: {
            token,
            notes: notes.trim(),
            reference_image_paths: refs.map((r) => r.path),
          },
          headers: { "Idempotency-Key": generateIdempotencyKey() },
        },
      );
      if (invokeErr || !data?.success) {
        const msg = (data as any)?.error || invokeErr?.message || "Failed to submit";
        setError(msg);
        setIsSubmitting(false);
        return;
      }
      onSuccess();
      reset();
    } catch (err: any) {
      setError(err?.message || "Unexpected error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canAddMore = refs.length < MAX_REFS;

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : handleClose())}>
      <DialogContent className="max-w-xl">
        <DialogTitle className="text-xl">Request a revision</DialogTitle>
        <DialogDescription className="text-base">
          Tell the shop what you'd like changed. Add up to {MAX_REFS}{" "}
          reference images if they help explain your idea.
        </DialogDescription>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="revision-notes" className="text-base font-semibold">
              What should the shop change? <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="revision-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Try a darker red on the sides, and make the logo smaller on the hood…"
              className="min-h-[180px] text-base leading-relaxed"
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">
              Reference images <span className="text-xs text-zinc-500">(optional)</span>
            </Label>

            <div className="grid grid-cols-4 gap-2">
              {refs.map((r) => (
                <div
                  key={r.path}
                  className="relative aspect-square rounded-md overflow-hidden border border-zinc-200 bg-zinc-50 group"
                >
                  {r.previewUrl ? (
                    <img
                      src={r.previewUrl}
                      alt={r.filename}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-400 px-1 text-center">
                      {r.filename}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveRef(r.path)}
                    disabled={isSubmitting}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Remove reference image"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {canAddMore && (
                <label
                  htmlFor="revision-ref-input"
                  className={cn(
                    "aspect-square rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors",
                    isUploading || isSubmitting
                      ? "border-zinc-200 bg-zinc-50 pointer-events-none opacity-50"
                      : "border-zinc-300 hover:border-blue-500 hover:bg-blue-50",
                  )}
                >
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                  ) : (
                    <>
                      <ImagePlus className="w-5 h-5 text-zinc-400" />
                      <span className="text-[10px] text-zinc-500">Add</span>
                    </>
                  )}
                </label>
              )}
            </div>
            <input
              ref={fileInputRef}
              id="revision-ref-input"
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <p className="text-[11px] text-zinc-500">
              JPG, PNG, WebP, or HEIC · max 8MB each · up to {MAX_REFS}
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3">
              {error}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-2">
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting || isUploading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || isUploading || notes.trim().length < 3}
          >
            {isSubmitting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
            ) : (
              <><Send className="w-4 h-4 mr-2" /> Send revision</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
