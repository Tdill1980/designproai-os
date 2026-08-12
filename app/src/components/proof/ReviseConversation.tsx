/**
 * ReviseConversation — customer-facing, MOBILE-FIRST multi-message
 * "Revise with AI" chat. Designed for a customer who taps an SMS/email link and
 * approves or revises from their phone.
 *
 * - Full-screen on mobile, dialog on desktop. Big touch targets.
 * - Type a request (the AI handles SEVERAL changes in one message) and/or
 *   attach an example image, watch a staged progress bar while it renders, and
 *   the revised design appears inline as the next version.
 * - After each design: Approve · Revise again · Message the design team.
 *
 * Token-based (no login). The AI does the design work; the shop is the
 * final validator. Light/white customer UI per docs/WHITE_UI_STANDARD.
 */

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, ImagePlus, X, Send, Check, RefreshCw, MessageSquare } from "lucide-react";

interface Turn {
  version_number: number;
  created_by_role: string;
  created_at: string;
  prompt_text: string | null;
  render_url: string | null;
  reference_urls: string[];
  is_active: boolean;
}

interface PendingRef {
  path: string;
  previewUrl: string | null;
  filename: string;
}

interface ReviseConversationProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string;
  onChanged: () => void;
  /** Jump the customer to the approve/sign step (closes the chat). */
  onApprove?: () => void;
  /** Open "message the design team" (closes the chat). */
  onMessageTeam?: () => void;
}

const MAX_REFS = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

const EXAMPLES = [
  "Make the red darker and richer.",
  "Swap the blue stripe for gold and add carbon-fiber on the lower panels.",
  "Remove the graphic on the hood.",
];

// Staged messages shown over the progress bar so the wait feels designed.
const STAGES: Array<{ until: number; msg: string }> = [
  { until: 18, msg: "Reading your request…" },
  { until: 45, msg: "Designing your changes…" },
  { until: 78, msg: "Rendering your wrap…" },
  { until: 101, msg: "Adding the finishing touches…" },
];

function generateIdempotencyKey(): string {
  return (crypto as any).randomUUID?.() || `airev-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).replace(/^data:[^,]+,/, ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export const ReviseConversation = ({
  open, onOpenChange, token, onChanged, onApprove, onMessageTeam,
}: ReviseConversationProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [allowed, setAllowed] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<PendingRef[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState(STAGES[0].msg);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadThread = async () => {
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("proof-revise-thread", { body: { token } });
      if (invokeErr || !data?.success) {
        setError((data as any)?.error || invokeErr?.message || "Couldn't load the conversation");
        return;
      }
      setTurns(data.turns || []);
      setRemaining(data.ai_revisions?.remaining ?? 0);
      setAllowed(data.ai_revisions?.allowed ?? 0);
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, isSubmitting]);

  // Staged progress bar while a revision renders (~45s typical). Eases toward
  // 95% and never claims 100% until the image actually lands.
  useEffect(() => {
    if (!isSubmitting) { setProgress(0); return; }
    setProgress(4);
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const pct = Math.min(96, Math.round(100 * (1 - Math.exp(-elapsed / 16))));
      setProgress(pct);
      setProgressMsg((STAGES.find((s) => pct < s.until) || STAGES[STAGES.length - 1]).msg);
    }, 350);
    return () => clearInterval(id);
  }, [isSubmitting]);

  const handleClose = () => {
    if (isSubmitting || isUploading) return;
    setPrompt(""); setRefs([]); setError(null);
    onOpenChange(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files).slice(0, MAX_REFS - refs.length)) {
      if (!ALLOWED_TYPES.has(file.type)) {
        toast({ title: "Unsupported file", description: `${file.name}: use JPEG, PNG, WebP, or HEIC.`, variant: "destructive" });
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast({ title: "File too large", description: `${file.name} is over 8MB.`, variant: "destructive" });
        continue;
      }
      setIsUploading(true);
      try {
        const base64 = await fileToBase64(file);
        const { data, error: invokeErr } = await supabase.functions.invoke("proof-upload-revision-ref", {
          body: { token, filename: file.name, content_type: file.type, data_base64: base64 },
        });
        if (invokeErr || !data?.success) {
          toast({ title: `${file.name} upload failed`, description: (data as any)?.error || invokeErr?.message || "Upload failed", variant: "destructive" });
          continue;
        }
        setRefs((prev) => [...prev, { path: data.path, previewUrl: data.preview_url || null, filename: file.name }]);
      } finally {
        setIsUploading(false);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (prompt.trim().length < 3) {
      setError("Tell us what you'd like changed (a few words is fine).");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("proof-revise-ai", {
        body: { token, prompt: prompt.trim(), reference_image_paths: refs.map((r) => r.path) },
        headers: { "Idempotency-Key": generateIdempotencyKey() },
      });
      if (invokeErr || !data?.success) {
        setError((data as any)?.error || invokeErr?.message || "That revision didn't go through — you weren't charged. Try again.");
        return;
      }
      setPrompt(""); setRefs([]);
      await loadThread();
      onChanged();
    } catch (err: any) {
      setError(err?.message || "Network error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const designTurns = turns.filter((t) => t.render_url);
  const canRevise = remaining > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : handleClose())}>
      <DialogContent className="p-0 gap-0 overflow-hidden flex flex-col bg-white w-full max-w-none h-[100dvh] rounded-none sm:max-w-lg sm:h-auto sm:max-h-[88vh] sm:rounded-lg">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
          <Sparkles className="w-4 h-4 text-purple-600" />
          <DialogTitle className="text-gray-900 text-base">Revise with AI</DialogTitle>
          <Badge variant="outline" className="ml-auto text-[10px] bg-purple-50 text-purple-700 border-purple-200">
            {remaining} of {allowed} left
          </Badge>
        </div>
        <DialogDescription className="sr-only">
          Chat with AI to revise your design. Each message creates a new version you can approve or keep revising.
        </DialogDescription>

        {/* Thread */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : designTurns.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-10">No design yet to revise.</p>
          ) : (
            designTurns.map((t, i) => (
              <div key={t.version_number} className="space-y-2">
                {t.prompt_text && (
                  <div className="flex flex-col items-end gap-1">
                    <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 text-white text-[15px] leading-snug px-3.5 py-2.5">{t.prompt_text}</div>
                    {t.reference_urls.length > 0 && (
                      <div className="flex gap-1">
                        {t.reference_urls.map((u, j) => (
                          <img key={j} src={u} alt="" className="w-14 h-14 rounded-md object-cover border border-gray-200" />
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-col items-start gap-1">
                  <div className="rounded-xl overflow-hidden border border-gray-200 bg-white w-full">
                    <img src={t.render_url!} alt={`Version ${t.version_number}`} className="w-full object-cover" loading="lazy" />
                  </div>
                  <span className="text-[11px] text-gray-400">{i === 0 ? "Starting design" : `Version ${t.version_number}`}{t.is_active ? " · current" : ""}</span>
                </div>
              </div>
            ))
          )}

          {/* Live progress bar while rendering */}
          {isSubmitting && (
            <div className="rounded-xl border border-purple-100 bg-purple-50/60 p-3 space-y-2">
              <div className="flex items-center gap-2 text-[13px] font-medium text-purple-800">
                <Sparkles className="w-4 h-4 animate-pulse" /> {progressMsg}
              </div>
              <div className="h-2 w-full rounded-full bg-purple-100 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-[11px] text-purple-700/70">Usually about 30–60 seconds. Hang tight — you can keep this open.</p>
            </div>
          )}

          {/* Post-revision actions — appear under the current design */}
          {!loading && !isSubmitting && designTurns.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
              <p className="text-[12px] font-medium text-gray-700">Happy with this design?</p>
              <div className="grid grid-cols-1 gap-2">
                {onApprove && (
                  <Button onClick={() => onApprove()} className="h-11 w-full bg-emerald-600 hover:bg-emerald-700 text-white text-[15px]">
                    <Check className="w-4 h-4 mr-2" /> Approve this design
                  </Button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="h-11 border-gray-200 text-gray-800 text-[14px]"
                    disabled={!canRevise}
                    onClick={() => textareaRef.current?.focus()}>
                    <RefreshCw className="w-4 h-4 mr-1.5" /> Revise again
                  </Button>
                  {onMessageTeam && (
                    <Button variant="outline" className="h-11 border-gray-200 text-gray-800 text-[14px]" onClick={() => onMessageTeam()}>
                      <MessageSquare className="w-4 h-4 mr-1.5" /> Design team
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-gray-100 p-3 space-y-2 bg-white shrink-0" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-xs p-2">{error}</div>}
          {!canRevise && allowed > 0 && (
            <p className="text-xs text-amber-700">You've used all AI revisions — tap “Design team” above to ask for more changes.</p>
          )}
          {turns.length <= 1 && canRevise && (
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => setPrompt(ex)} disabled={isSubmitting}
                  className="text-[12px] text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-full px-2.5 py-1">{ex}</button>
              ))}
            </div>
          )}
          {refs.length > 0 && (
            <div className="flex gap-1.5">
              {refs.map((r, i) => (
                <div key={i} className="relative">
                  {r.previewUrl
                    ? <img src={r.previewUrl} alt="" className="w-14 h-14 rounded-md object-cover border border-gray-200" />
                    : <div className="w-14 h-14 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center"><ImagePlus className="w-4 h-4 text-gray-400" /></div>}
                  <button type="button" onClick={() => setRefs((p) => p.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 bg-gray-800 text-white rounded-full p-0.5"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
            <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0 border-gray-200"
              disabled={isSubmitting || isUploading || refs.length >= MAX_REFS || !canRevise}
              onClick={() => fileInputRef.current?.click()} title="Attach an example image">
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
            </Button>
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your change(s) — you can ask for several at once"
              className="min-h-[48px] max-h-32 text-[16px] border-gray-200 bg-white text-gray-900 resize-none"
              maxLength={500}
              disabled={isSubmitting || !canRevise}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSubmit(); } }}
            />
            <Button type="button" onClick={handleSubmit}
              disabled={isSubmitting || isUploading || prompt.trim().length < 3 || !canRevise}
              className="h-11 w-11 shrink-0 p-0 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white">
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
