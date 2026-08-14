/**
 * LineItemsBuilder — Phase 8C
 *
 * Shop-side composer for multi-line proofs. Used inside
 * SendForApprovalDialog's "Multi-item proof" tab.
 *
 * Each line item has:
 *   - title (required)
 *   - description (optional)
 *   - source render — either a file the shop uploads here (reuses
 *     proof-upload-artwork → proof-uploads bucket) OR a URL from a render
 *     the shop already generated in-session (render_urls in context).
 *
 * The builder returns a serialized array suitable to pass as
 * `line_items` to proof-create.
 */

import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Plus, X, ImagePlus, Loader2, ChevronDown, ChevronUp, Maximize2,
} from "lucide-react";

export interface BuilderLineItem {
  id: string; // local-only, for React keys
  title: string;
  description: string;
  render_url?: string | null;
  uploaded_file_path?: string | null;
  uploaded_preview_url?: string | null;
  uploaded_filename?: string | null;
}

interface LineItemsBuilderProps {
  items: BuilderLineItem[];
  onChange: (items: BuilderLineItem[]) => void;
  disabled?: boolean;
  sessionRenderUrls?: Record<string, string>;
}

const MAX_ITEMS = 20;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function newItem(partial?: Partial<BuilderLineItem>): BuilderLineItem {
  const id = (crypto as any).randomUUID?.() ||
    `li-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    title: "",
    description: "",
    render_url: null,
    uploaded_file_path: null,
    uploaded_preview_url: null,
    uploaded_filename: null,
    ...partial,
  };
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

export function LineItemsBuilder({
  items,
  onChange,
  disabled,
  sessionRenderUrls,
}: LineItemsBuilderProps) {
  const { toast } = useToast();
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<BuilderLineItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeItemIdForUpload, setActiveItemIdForUpload] = useState<string | null>(null);

  const sessionEntries = Object.entries(sessionRenderUrls || {});

  const patch = (id: string, changes: Partial<BuilderLineItem>) => {
    onChange(items.map((i) => (i.id === id ? { ...i, ...changes } : i)));
  };

  const remove = (id: string) => {
    onChange(items.filter((i) => i.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const next = idx + dir;
    if (next < 0 || next >= items.length) return;
    const copy = items.slice();
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    onChange(copy);
  };

  const triggerUpload = (itemId: string) => {
    setActiveItemIdForUpload(itemId);
    fileInputRef.current?.click();
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const itemId = activeItemIdForUpload;
    if (!files || files.length === 0 || !itemId) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const file = files[0];

    if (!ALLOWED_TYPES.has(file.type)) {
      toast({
        title: "Unsupported file",
        description: `${file.name} — use PDF, JPG, PNG, WebP, or HEIC.`,
        variant: "destructive",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({
        title: "File too large",
        description: `${file.name} is over 8MB.`,
        variant: "destructive",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploadingId(itemId);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke(
        "proof-upload-artwork",
        {
          body: {
            files: [
              {
                filename: file.name,
                content_type: file.type,
                data_base64: base64,
              },
            ],
          },
        },
      );
      if (error || !data?.success) {
        const msg = (data as any)?.error || error?.message || "Upload failed";
        toast({ title: "Upload failed", description: msg, variant: "destructive" });
        return;
      }
      const up = (data.uploaded || [])[0];
      if (!up?.path) {
        toast({
          title: "Upload failed",
          description: "No path returned from upload",
          variant: "destructive",
        });
        return;
      }
      patch(itemId, {
        uploaded_file_path: up.path,
        uploaded_preview_url: up.preview_url || null,
        uploaded_filename: file.name,
        render_url: null,
      });
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err?.message || "Network error",
        variant: "destructive",
      });
    } finally {
      setUploadingId(null);
      setActiveItemIdForUpload(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const canAdd = items.length < MAX_ITEMS;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-zinc-700">
          Line items ({items.length}/{MAX_ITEMS})
        </Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-sm gap-1.5"
          disabled={!canAdd || disabled}
          onClick={() => {
            const item = newItem();
            onChange([...items, item]);
            setExpandedId(item.id);
          }}
        >
          <Plus className="w-4 h-4" />
          Add item
        </Button>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-zinc-500 italic">
          No items yet. Add one line per thing the customer needs to approve
          (e.g. "Vehicle wrap", "Cut-contour logo", "Window perf").
        </p>
      )}

      <div className="space-y-2">
        {items.map((item, idx) => {
          const expanded = expandedId === item.id;
          const hasSource =
            !!item.render_url ||
            !!item.uploaded_file_path;
          const preview = item.uploaded_preview_url || item.render_url || null;
          return (
            <div
              key={item.id}
              className={cn(
                "rounded-lg border bg-white overflow-hidden shadow-sm",
                hasSource ? "border-zinc-200" : "border-amber-200",
              )}
            >
              {/* Blue gradient header bar */}
              <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-700 via-cyan-500 to-blue-700">
                <span className="text-base font-bold text-white/95 w-10 text-center shrink-0">
                  #{idx + 1}
                </span>
                <Input
                  value={item.title}
                  onChange={(e) => patch(item.id, { title: e.target.value })}
                  placeholder="Item title (e.g. Vehicle wrap)"
                  className="h-11 text-lg font-semibold flex-1 bg-white/15 border-white/30 text-white placeholder:text-white/70 focus-visible:ring-white/60"
                  disabled={disabled}
                />
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-10 w-10 text-white hover:bg-white/15 hover:text-white disabled:text-white/40"
                    disabled={idx === 0 || disabled}
                    onClick={() => move(item.id, -1)}
                    aria-label="Move up"
                  >
                    <ChevronUp className="w-5 h-5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-10 w-10 text-white hover:bg-white/15 hover:text-white disabled:text-white/40"
                    disabled={idx === items.length - 1 || disabled}
                    onClick={() => move(item.id, 1)}
                    aria-label="Move down"
                  >
                    <ChevronDown className="w-5 h-5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-10 w-10 text-white hover:bg-red-500/30 hover:text-white"
                    disabled={disabled}
                    onClick={() => remove(item.id)}
                    aria-label="Remove item"
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </div>
              </div>

              {/* Body: 8.5 × 11 portrait render + controls */}
              <div className="px-5 py-4 flex gap-5 items-start">
                <button
                  type="button"
                  onClick={() => preview && setLightbox(item)}
                  disabled={!preview}
                  className="group relative w-[220px] aspect-[8.5/11] rounded-md border border-zinc-200 bg-zinc-50 overflow-hidden shrink-0 shadow-sm disabled:cursor-not-allowed"
                  aria-label={preview ? `Enlarge ${item.title || "item"}` : undefined}
                >
                  {preview ? (
                    <>
                      <img
                        src={preview}
                        alt=""
                        className="w-full h-full object-contain bg-white transition-transform group-hover:scale-[1.02]"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/70 text-white text-xs px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Maximize2 className="w-3.5 h-3.5" />
                        Enlarge
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm text-zinc-400 text-center px-3">
                      No image
                    </div>
                  )}
                </button>

                <div className="flex-1 space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-10 text-base gap-2"
                      disabled={disabled || uploadingId === item.id}
                      onClick={() => triggerUpload(item.id)}
                    >
                      {uploadingId === item.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ImagePlus className="w-4 h-4" />
                      )}
                      {item.uploaded_file_path ? "Replace file" : "Upload file"}
                    </Button>
                    {sessionEntries.length > 0 && (
                      <select
                        value={item.render_url || ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          patch(item.id, {
                            render_url: v || null,
                            uploaded_file_path: v ? null : item.uploaded_file_path,
                            uploaded_preview_url: v ? null : item.uploaded_preview_url,
                            uploaded_filename: v ? null : item.uploaded_filename,
                          });
                        }}
                        disabled={disabled}
                        className="h-10 text-base rounded-md border border-zinc-200 bg-white px-3"
                      >
                        <option value="">Or pick from session render…</option>
                        {sessionEntries.map(([label, url]) => (
                          <option key={label} value={url}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                    {item.uploaded_filename && (
                      <span className="text-sm text-zinc-600 self-center truncate max-w-[240px]">
                        {item.uploaded_filename}
                      </span>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-10 text-base text-zinc-700 hover:text-zinc-900"
                      disabled={disabled}
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                    >
                      {expanded ? "Hide notes" : item.description ? "Edit notes" : "Add notes"}
                    </Button>
                  </div>

                  {expanded && (
                    <Textarea
                      value={item.description}
                      onChange={(e) => patch(item.id, { description: e.target.value })}
                      placeholder="Per-side notes for the client — e.g. ‘Driver side: make the stripe thicker here.’"
                      className="min-h-[80px] text-base bg-white text-zinc-900 placeholder:text-zinc-400"
                      disabled={disabled}
                    />
                  )}
                  {!expanded && item.description && (
                    <p className="text-base text-zinc-700">
                      {item.description}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*"
        onChange={handleFilePicked}
        className="hidden"
      />

      <Dialog open={!!lightbox} onOpenChange={(v) => !v && setLightbox(null)}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[92vh] p-0 gap-0 overflow-hidden bg-black border-zinc-800">
          {lightbox && (() => {
            const src = lightbox.uploaded_preview_url || lightbox.render_url || null;
            return (
              <>
                <DialogTitle className="sr-only">{lightbox.title || "Preview"}</DialogTitle>
                <DialogDescription className="sr-only">
                  Enlarged preview for per-side revisions.
                </DialogDescription>
                <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto">
                  {src ? (
                    <img
                      src={src}
                      alt={lightbox.title}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <div className="text-zinc-400">No preview</div>
                  )}
                </div>
                <div className="shrink-0 px-5 py-3 border-t border-zinc-800 bg-zinc-950 text-white">
                  <p className="text-lg font-semibold">{lightbox.title}</p>
                  {lightbox.description && (
                    <p className="text-sm text-zinc-300 mt-0.5">{lightbox.description}</p>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function builderItemsToPayload(
  items: BuilderLineItem[],
): Array<{
  title: string;
  description?: string;
  render_url?: string;
  uploaded_file_paths?: string[];
}> {
  return items
    .filter((i) => i.title.trim().length > 0)
    .map((i) => {
      const out: {
        title: string;
        description?: string;
        render_url?: string;
        uploaded_file_paths?: string[];
      } = { title: i.title.trim() };
      if (i.description.trim()) out.description = i.description.trim();
      if (i.render_url) {
        out.render_url = i.render_url;
      } else if (i.uploaded_file_path) {
        out.uploaded_file_paths = [i.uploaded_file_path];
      }
      return out;
    });
}

export function builderItemsValid(items: BuilderLineItem[]): {
  ok: boolean;
  reason?: string;
} {
  if (items.length === 0) {
    return { ok: false, reason: "Add at least one line item" };
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.title.trim()) {
      return { ok: false, reason: `Item ${i + 1} needs a title` };
    }
    if (!it.render_url && !it.uploaded_file_path) {
      return {
        ok: false,
        reason: `Item ${i + 1} needs a file or a render URL`,
      };
    }
  }
  return { ok: true };
}
