/**
 * ReportIssueWidget — global floating "Report Issue" button + dialog.
 *
 * Mounted once on every signed-in admin route. Lets the team file a
 * structured bug / UI / feature / workflow report in seconds:
 *   - Category + Severity dropdowns
 *   - Description textarea (required)
 *   - Optional screenshot (paste, drag, or pick)
 *   - Auto-captures URL, page title, user agent, recent console errors
 *
 * On submit:
 *   - INSERTs into engineroom_reports
 *   - Fires notify-engineroom-report (best-effort) so Slack + email go out
 *   - Toast confirmation, dialog closes
 *
 * Reports are then visible to the whole team at /admin/engineroom-reports.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LifeBuoy, X, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getCapturedErrors } from "@/lib/console-error-capture";

type Category = "bug" | "ui" | "feature" | "workflow" | "other";
type Severity = "blocker" | "high" | "medium" | "low";

const CATEGORY_LABELS: Record<Category, string> = {
  bug: "Bug",
  ui: "UI / Visual",
  feature: "Feature Request",
  workflow: "Workflow / Process",
  other: "Other",
};

const SEVERITY_LABELS: Record<Severity, string> = {
  blocker: "Blocker — production stopped",
  high: "High — major impact",
  medium: "Medium — workaround exists",
  low: "Low — nice to fix",
};

export default function ReportIssueWidget() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [category, setCategory] = useState<Category>("bug");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // Paste-to-attach: when the dialog is open, accept image pastes from the clipboard.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            setScreenshot(file);
            const reader = new FileReader();
            reader.onload = () => setScreenshotPreview(reader.result as string);
            reader.readAsDataURL(file);
            toast.info("Screenshot attached from clipboard");
            e.preventDefault();
            break;
          }
        }
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open]);

  // Hidden on /creatormarket — that's a public retail page and the
  // floating pill conflicted with the marketplace chrome. Must run AFTER
  // all hooks above so hook order stays stable across route changes.
  if (pathname.startsWith("/creatormarket")) return null;

  const reset = () => {
    setCategory("bug");
    setSeverity("medium");
    setDescription("");
    setScreenshot(null);
    setScreenshotPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Screenshot must be an image");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("Screenshot must be under 10MB");
      return;
    }
    setScreenshot(f);
    const reader = new FileReader();
    reader.onload = () => setScreenshotPreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (!description.trim()) {
      toast.error("Add a quick description so we know what's wrong");
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You need to be signed in to report an issue");
        return;
      }

      // Optional screenshot upload first — wrap-files bucket, engineroom-reports/ folder.
      let screenshotUrl: string | null = null;
      if (screenshot) {
        const ext = (screenshot.name.split(".").pop() || "png").toLowerCase();
        const path = `engineroom-reports/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("wrap-files")
          .upload(path, screenshot, { contentType: screenshot.type, upsert: true });
        if (upErr) {
          console.warn("[EngineRoom] screenshot upload failed:", upErr.message);
        } else {
          const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
          screenshotUrl = publicUrl;
        }
      }

      const consoleErrors = getCapturedErrors();

      const { data: inserted, error: insertErr } = await supabase
        .from("engineroom_reports" as any)
        .insert({
          reporter_id: user.id,
          reporter_email: user.email,
          category,
          severity,
          description: description.trim(),
          page_url: window.location.href,
          page_title: document.title,
          user_agent: navigator.userAgent,
          console_errors: consoleErrors.length > 0 ? consoleErrors : null,
          screenshot_url: screenshotUrl,
          status: "new",
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        throw new Error(insertErr?.message || "Failed to save report");
      }

      // Fire notification (best-effort — don't fail the report if this errors)
      supabase.functions
        .invoke("notify-engineroom-report", {
          body: { report_id: (inserted as any).id },
        })
        .catch((err) => console.warn("[EngineRoom] notify failed (non-fatal):", err));

      toast.success("Message sent to the dev team — we're on it!");
      reset();
      setOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Could not submit report");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Floating launcher — bottom-left, intentionally unobtrusive */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Help & Feedback"
        className="fixed bottom-20 left-4 md:bottom-4 md:left-20 z-50 flex items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-500 to-pink-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-pink-500/30 hover:from-blue-600 hover:to-pink-600 transition-colors"
      >
        <LifeBuoy className="w-3.5 h-3.5" />
        Help
      </button>

      <Dialog open={open} onOpenChange={(v) => { if (!submitting) setOpen(v); }}>
        <DialogContent className="max-w-lg bg-white text-gray-900 border-gray-200">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-gray-900">
              <LifeBuoy className="w-5 h-5 text-pink-500" />
              Help &amp; Feedback
            </DialogTitle>
            <DialogDescription className="text-gray-500">
              Found a bug, have an idea, or need a hand? Send it straight to our dev team — we read every message.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-700">Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
                  <SelectTrigger className="bg-white text-gray-900 border-gray-300"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white text-gray-900 border-gray-200">
                    {(Object.entries(CATEGORY_LABELS) as Array<[Category, string]>).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-700">Severity</Label>
                <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
                  <SelectTrigger className="bg-white text-gray-900 border-gray-300"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white text-gray-900 border-gray-200">
                    {(Object.entries(SEVERITY_LABELS) as Array<[Severity, string]>).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-gray-700">What's wrong / what should change?</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Be specific. What did you do, what did you expect, what happened instead?"
                rows={5}
                disabled={submitting}
                className="bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-gray-700">Screenshot (optional — paste from clipboard, drag, or click)</Label>
              {screenshotPreview ? (
                <div className="relative">
                  <img
                    src={screenshotPreview}
                    alt="Screenshot preview"
                    className="w-full max-h-48 object-contain rounded-md border border-gray-200 bg-gray-50"
                  />
                  <button
                    type="button"
                    onClick={() => { setScreenshot(null); setScreenshotPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
                    className="absolute top-1 right-1 bg-black/70 text-white rounded p-1"
                    aria-label="Remove screenshot"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0] ?? null); }}
                  className="border-2 border-dashed border-gray-300 rounded-md p-4 text-center cursor-pointer hover:border-pink-500/60 transition-colors"
                >
                  <Upload className="w-5 h-5 mx-auto mb-1 text-gray-400" />
                  <p className="text-[11px] text-gray-500">
                    Click, drag a file here, or paste from clipboard
                  </p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="text-[10px] text-gray-500 border-t border-gray-200 pt-2 space-y-0.5">
              <div>Auto-captured: <code>{window.location.pathname}</code></div>
              <div>Recent console errors: {getCapturedErrors().length}</div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting} className="text-gray-600 hover:text-gray-900 hover:bg-gray-100">
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={submitting} className="bg-gradient-to-r from-blue-500 to-pink-500 text-white border-0 hover:from-blue-600 hover:to-pink-600">
              {submitting ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Sending...</> : "Send to Dev Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
