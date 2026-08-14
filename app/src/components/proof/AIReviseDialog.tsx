/**
 * AIReviseDialog
 *
 * Phase 4: customer-side DIY AI revision. Locked-down textarea (no system
 * prompt access, no power-user knobs). Renders a live "credits remaining"
 * counter so the customer knows how many attempts they have.
 *
 * Calls proof-revise-ai and on success returns the new version info to the
 * parent so it can refetch the proof and surface v+1 instantly.
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
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ImagePlus, Loader2, Sparkles, X } from "lucide-react";

const MAX_REFS = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

interface PendingRef {
  path: string;
  previewUrl: string | null;
  filename: string;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).replace(/^data:[^,]+,/, ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

interface AIReviseDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string;
  remaining: number;
  allowed: number;
  onSuccess: (result: {
    version_id: string;
    version_number: number;
    render_url: string;
    credits_remaining: number;
  }) => void;
}

function generateIdempotencyKey(): string {
  return (crypto as any).randomUUID?.() ||
    `airev-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

const EXAMPLES = [
  "Make the red a little darker and richer.",
  "Swap the blue stripe for gold.",
  "Remove the graphic on the hood — just leave the body color.",
  "Add a subtle carbon-fiber texture on the lower panels.",
];

export const AIReviseDialog = ({
  open,
  onOpenChange,
  token,
  remaining,
  allowed,
  onSuccess,
}: AIReviseDialogProps) => {
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<PendingRef[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    if (isSubmitting || isUploading) return;
    setPrompt("");
    setRefs([]);
    setError(null);
    onOpenChange(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setError(null);
    for (const file of Array.from(files).slice(0, MAX_REFS - refs.length)) {
      if (!ALLOWED_TYPES.has(file.type)) {
        setError(`${file.name}: use JPEG, PNG, WebP, or HEIC.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError(`${file.name} is over 8MB.`);
        continue;
      }
      setIsUploading(true);
      try {
        const base64 = await fileToBase64(file);
        const { data, error: invokeErr } = await supabase.functions.invoke(
          "proof-upload-revision-ref",
          { body: { token, filename: file.name, content_type: file.type, data_base64: base64 } },
        );
        if (invokeErr || !data?.success) {
          setError((data as any)?.error || invokeErr?.message || `${file.name} upload failed`);
          continue;
        }
        setRefs((prev) => [
          ...prev,
          { path: data.path, previewUrl: data.preview_url || null, filename: file.name },
        ]);
      } finally {
        setIsUploading(false);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (prompt.trim().length < 3) {
      setError("Describe the change you'd like (at least 3 characters).");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        "proof-revise-ai",
        {
          body: {
            token,
            prompt: prompt.trim(),
            reference_image_paths: refs.map((r) => r.path),
          },
          headers: { "Idempotency-Key": generateIdempotencyKey() },
        },
      );
      if (invokeErr || !data?.success) {
        const msg = (data as any)?.error || invokeErr?.message || "AI revision failed";
        setError(msg);
        setIsSubmitting(false);
        return;
      }
      onSuccess({
        version_id: data.version_id,
        version_number: data.version_number,
        render_url: data.render_url,
        credits_remaining: data.credits_remaining,
      });
      setPrompt("");
      setRefs([]);
    } catch (err: any) {
      setError(err?.message || "Network error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : handleClose())}>
      <DialogContent className="max-w-md">
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600" />
          Revise Design
          <Badge variant="outline" className="ml-auto text-[10px] bg-purple-50 text-purple-700 border-purple-200">
            {remaining} of {allowed} left
          </Badge>
        </DialogTitle>
        <DialogDescription>
          Need to edit? Type the change you'd like and we'll update this design
          and save it as a new version — the shop can see what you tried.
        </DialogDescription>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ai-revise-prompt" className="text-sm">
              What should we change?
            </Label>
            <Textarea
              id="ai-revise-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Try a darker red, keep everything else the same"
              className="min-h-[90px]"
              maxLength={500}
              disabled={isSubmitting}
            />
            <p className="text-[11px] text-zinc-500 text-right">
              {prompt.length}/500
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Add a reference photo (optional)</Label>
            <p className="text-[11px] text-zinc-500">
              Want it to match a specific look? Attach up to {MAX_REFS} photos and
              we'll design to them.
            </p>
            {refs.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {refs.map((r, i) => (
                  <div
                    key={r.path}
                    className="relative w-14 h-14 rounded-md overflow-hidden border border-zinc-200 bg-zinc-100"
                  >
                    {r.previewUrl ? (
                      <img src={r.previewUrl} alt={r.filename} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[9px] text-zinc-500 p-1 text-center">
                        {r.filename}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setRefs((prev) => prev.filter((_, idx) => idx !== i))}
                      disabled={isSubmitting}
                      className="absolute top-0 right-0 bg-black/60 text-white rounded-bl p-0.5"
                      aria-label="Remove reference"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {refs.length < MAX_REFS && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting || isUploading}
                className="mt-1"
              >
                {isUploading ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Uploading…</>
                ) : (
                  <><ImagePlus className="w-3.5 h-3.5 mr-1.5" /> Attach photo</>
                )}
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          <div className="rounded-md bg-zinc-50 border border-zinc-200 p-3 space-y-1.5">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
              Ideas to get you started
            </p>
            <ul className="space-y-1">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button
                    type="button"
                    onClick={() => setPrompt(ex)}
                    disabled={isSubmitting}
                    className="text-xs text-blue-700 hover:underline text-left"
                  >
                    "{ex}"
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3">
              {error}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-2">
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || isUploading || prompt.trim().length < 3 || remaining <= 0}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
          >
            {isSubmitting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Revising…</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" /> Revise Design</>
            )}
          </Button>
        </div>

        <p className="text-[11px] text-zinc-500 text-center">
          Takes 30-60 seconds. If something goes wrong, we'll refund the credit.
        </p>
      </DialogContent>
    </Dialog>
  );
};
