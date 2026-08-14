/**
 * ProofLineItemsGrid — Phase 8C
 *
 * Renders each line item on a multi-line proof as its own card with its own
 * Approve / Decline / Request Revision buttons + optional per-line reference
 * image uploads. The parent signature on the proof still happens once, but
 * it binds every line's resolution into the signed PDF.
 *
 * Flow:
 *   1. Grid of thumbnails (rectangle). Tap to enlarge (lightbox).
 *   2. Per card: status badge, title, description, 3 action buttons.
 *   3. Decline/Revise open a lightweight sheet with a required note + up to
 *      4 reference image uploads (proof-line-item-upload-ref).
 *   4. Decisions POST to proof-line-item-decision with an Idempotency-Key.
 *   5. onChange() lets the parent page refresh the proof state + rollup.
 */

import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, XCircle, RefreshCw, Loader2, ImagePlus, X, Clock, Maximize2,
} from "lucide-react";

export interface ProofLineItem {
  id: string;
  line_number: number;
  title: string;
  description?: string | null;
  render_url?: string | null;
  thumbnail_url?: string | null;
  status: "pending" | "approved" | "declined" | "revising";
  decline_reason?: string | null;
  change_request?: string | null;
  approved_at?: string | null;
  declined_at?: string | null;
  revision_requested_at?: string | null;
  reference_image_paths?: string[];
}

interface ProofLineItemsGridProps {
  items: ProofLineItem[];
  token: string;
  mode: "sign_only" | "revision_loop";
  disabled?: boolean;
  onChange: () => void;
}

type DialogKind = "decline" | "revise";

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
    `li-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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

const STATUS_BADGE: Record<
  ProofLineItem["status"],
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  pending:  { label: "Pending",  className: "bg-zinc-100 text-zinc-700 border-zinc-200", Icon: Clock },
  approved: { label: "Approved", className: "bg-green-100 text-green-700 border-green-200", Icon: CheckCircle2 },
  declined: { label: "Declined", className: "bg-red-100 text-red-700 border-red-200", Icon: XCircle },
  revising: { label: "Revision",  className: "bg-purple-100 text-purple-700 border-purple-200", Icon: RefreshCw },
};

interface UploadedRef {
  path: string;
  previewUrl: string | null;
  filename: string;
}

export function ProofLineItemsGrid({
  items,
  token,
  mode,
  disabled,
  onChange,
}: ProofLineItemsGridProps) {
  const { toast } = useToast();
  const [lightbox, setLightbox] = useState<ProofLineItem | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: DialogKind; item: ProofLineItem }
    | null
  >(null);
  const [note, setNote] = useState("");
  const [refs, setRefs] = useState<UploadedRef[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openDialog = (kind: DialogKind, item: ProofLineItem) => {
    setDialog({ kind, item });
    setNote("");
    setRefs([]);
  };

  const closeDialog = () => {
    if (isSubmitting || isUploading) return;
    setDialog(null);
    setNote("");
    setRefs([]);
  };

  const handleApprove = async (item: ProofLineItem) => {
    if (disabled) return;
    setBusyItemId(item.id);
    try {
      const { data, error } = await supabase.functions.invoke(
        "proof-line-item-decision",
        {
          body: {
            token,
            line_item_id: item.id,
            decision: "approve",
          },
          headers: { "Idempotency-Key": generateIdempotencyKey() },
        },
      );
      if (error || !data?.success) {
        const msg = (data as any)?.error || error?.message || "Failed";
        toast({ title: "Approve failed", description: msg, variant: "destructive" });
        return;
      }
      toast({ title: `Line ${item.line_number} approved` });
      onChange();
    } finally {
      setBusyItemId(null);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !dialog) return;

    const slotsLeft = MAX_REFS - refs.length;
    const selected = Array.from(files).slice(0, slotsLeft);

    for (const file of selected) {
      if (!ALLOWED_TYPES.has(file.type)) {
        toast({
          title: "Unsupported file",
          description: `${file.name} — use JPG, PNG, WebP, or HEIC.`,
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
        const { data, error } = await supabase.functions.invoke(
          "proof-line-item-upload-ref",
          {
            body: {
              token,
              line_item_id: dialog.item.id,
              filename: file.name,
              content_type: file.type,
              data_base64: base64,
            },
          },
        );
        if (error || !data?.success) {
          const msg = (data as any)?.error || error?.message || "Upload failed";
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

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmitDialog = async () => {
    if (!dialog) return;
    if (note.trim().length < 3) {
      toast({
        title: "Note required",
        description: "Tell the shop what's wrong (min 3 chars).",
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "proof-line-item-decision",
        {
          body: {
            token,
            line_item_id: dialog.item.id,
            decision: dialog.kind === "decline" ? "decline" : "revise",
            note: note.trim(),
            reference_image_paths: refs.map((r) => r.path),
          },
          headers: { "Idempotency-Key": generateIdempotencyKey() },
        },
      );
      if (error || !data?.success) {
        const msg = (data as any)?.error || error?.message || "Failed";
        toast({ title: "Submit failed", description: msg, variant: "destructive" });
        return;
      }
      toast({
        title: dialog.kind === "decline"
          ? `Line ${dialog.item.line_number} declined`
          : `Revision requested on line ${dialog.item.line_number}`,
      });
      setDialog(null);
      setNote("");
      setRefs([]);
      onChange();
    } finally {
      setIsSubmitting(false);
    }
  };

  const resolvedCount = items.filter(
    (i) => i.status === "approved" || i.status === "declined",
  ).length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base sm:text-lg font-semibold text-zinc-900">
          Review every item
        </h2>
        <span className="text-xs text-zinc-500">
          {resolvedCount} of {items.length} resolved
        </span>
      </div>

      <p className="text-sm text-zinc-600">
        Tap any image to enlarge. Approve, decline, or request a revision on
        each side individually — changes are targeted to that line only. When
        every item is resolved, sign once to finalize the whole proof.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items
          .slice()
          .sort((a, b) => a.line_number - b.line_number)
          .map((item) => {
            const cfg = STATUS_BADGE[item.status];
            const Icon = cfg.Icon;
            const img = item.render_url || item.thumbnail_url || null;
            const isBusy = busyItemId === item.id;
            const alreadyResolved =
              item.status === "approved" || item.status === "declined";
            return (
              <div
                key={item.id}
                className="rounded-xl border border-zinc-200 bg-white overflow-hidden flex flex-col"
              >
                <button
                  type="button"
                  onClick={() => img && setLightbox(item)}
                  disabled={!img}
                  className="group block w-full aspect-[16/10] bg-zinc-100 overflow-hidden relative cursor-zoom-in disabled:cursor-default"
                  aria-label={img ? `Enlarge ${item.title}` : undefined}
                >
                  {img ? (
                    <img
                      src={img}
                      alt={item.title}
                      className="w-full h-full object-cover transition-transform group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-400 text-xs">
                      No preview
                    </div>
                  )}
                  <div className="absolute top-2 left-2">
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] h-5 px-1.5 gap-1 bg-white/95", cfg.className)}
                    >
                      <Icon className="w-3 h-3" />
                      {cfg.label}
                    </Badge>
                  </div>
                  <div className="absolute top-2 right-2">
                    <Badge
                      variant="outline"
                      className="text-[10px] h-5 px-1.5 bg-white/95 text-zinc-700"
                    >
                      #{item.line_number}
                    </Badge>
                  </div>
                  {img && (
                    <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/70 text-white text-xs px-2 py-1">
                      <Maximize2 className="w-3.5 h-3.5" />
                      Enlarge
                    </div>
                  )}
                </button>

                <div className="p-3 space-y-2 flex-1 flex flex-col">
                  <div className="flex-1 min-h-[40px]">
                    <h3 className="text-sm font-semibold text-zinc-900 leading-snug">
                      {item.title}
                    </h3>
                    {item.description && (
                      <p className="text-xs text-zinc-600 mt-0.5 line-clamp-2">
                        {item.description}
                      </p>
                    )}
                  </div>

                  {item.status === "declined" && item.decline_reason && (
                    <div className="rounded-md bg-red-50 border border-red-100 text-red-800 text-xs p-2">
                      <span className="font-semibold">Declined:</span>{" "}
                      {item.decline_reason}
                    </div>
                  )}
                  {item.status === "revising" && item.change_request && (
                    <div className="rounded-md bg-purple-50 border border-purple-100 text-purple-900 text-xs p-2">
                      <span className="font-semibold">Revision notes:</span>{" "}
                      {item.change_request}
                    </div>
                  )}

                  {!alreadyResolved && (
                    <div className="grid grid-cols-3 gap-1.5 pt-1">
                      <Button
                        size="sm"
                        onClick={() => handleApprove(item)}
                        disabled={isBusy || disabled}
                        className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve</>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openDialog("decline", item)}
                        disabled={isBusy || disabled}
                        className="h-8 text-xs border-red-200 text-red-700 hover:bg-red-50"
                      >
                        <XCircle className="w-3.5 h-3.5 mr-1" />
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openDialog("revise", item)}
                        disabled={isBusy || disabled || mode !== "revision_loop"}
                        className="h-8 text-xs border-purple-200 text-purple-700 hover:bg-purple-50"
                        title={mode !== "revision_loop" ? "This proof is sign-only" : undefined}
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1" />
                        Revise
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(v) => !v && setLightbox(null)}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[92vh] p-0 gap-0 overflow-hidden bg-black border-zinc-800 flex flex-col">
          {lightbox && (
            <>
              <DialogTitle className="sr-only">{lightbox.title}</DialogTitle>
              <DialogDescription className="sr-only">
                Enlarged preview of line item {lightbox.line_number}: {lightbox.title}
              </DialogDescription>
              <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto">
                {lightbox.render_url ? (
                  <img
                    src={lightbox.render_url}
                    alt={lightbox.title}
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <div className="text-zinc-400">No preview</div>
                )}
              </div>
              <div className="shrink-0 px-5 py-3 border-t border-zinc-800 bg-zinc-950 text-white">
                <p className="text-lg font-semibold">#{lightbox.line_number} · {lightbox.title}</p>
                {lightbox.description && (
                  <p className="text-sm text-zinc-300 mt-0.5">{lightbox.description}</p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Decline / Revise dialog */}
      <Dialog open={!!dialog} onOpenChange={(v) => !v && closeDialog()}>
        <DialogContent className="max-w-xl">
          {dialog && (
            <>
              <DialogTitle className="text-xl">
                {dialog.kind === "decline"
                  ? `Decline line ${dialog.item.line_number}`
                  : `Request revision on line ${dialog.item.line_number}`}
              </DialogTitle>
              <DialogDescription className="text-base">
                {dialog.kind === "decline"
                  ? "Tell the shop why this item doesn't work for you. They'll follow up."
                  : "Tell the shop what you'd like changed on this item. Add up to 4 reference images if helpful."}
              </DialogDescription>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-base font-semibold">
                    {dialog.item.title}
                  </Label>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={
                      dialog.kind === "decline"
                        ? "Required: what doesn't work?"
                        : "Required: what should the shop change?"
                    }
                    className="min-h-[180px] text-base leading-relaxed"
                    disabled={isSubmitting}
                    autoFocus
                  />
                </div>

                {dialog.kind === "revise" && (
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
                            onClick={() =>
                              setRefs((prev) => prev.filter((x) => x.path !== r.path))
                            }
                            disabled={isSubmitting}
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="Remove reference image"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {refs.length < MAX_REFS && (
                        <label
                          htmlFor="line-item-ref-input"
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
                      id="line-item-ref-input"
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mt-2">
                <Button
                  variant="outline"
                  onClick={closeDialog}
                  disabled={isSubmitting || isUploading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitDialog}
                  disabled={isSubmitting || isUploading || note.trim().length < 3}
                  variant={dialog.kind === "decline" ? "destructive" : "default"}
                >
                  {isSubmitting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
                  ) : dialog.kind === "decline" ? (
                    "Submit decline"
                  ) : (
                    "Send revision"
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
