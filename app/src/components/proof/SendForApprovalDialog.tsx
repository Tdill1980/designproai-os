/**
 * SendForApprovalDialog
 *
 * Shop-owner dialog for kicking off the proof approval flow.
 *
 * Phase 2: baseline — customer email, mode toggle, optional message, expiry.
 * Phase 6: external-upload mode ("Upload your own artwork") + live tier info
 *          (remaining proofs this month, white-label availability).
 *
 * Flow branches:
 *   - Source=render  : uses the existing render URLs from the tool context.
 *   - Source=upload  : uploads files via proof-upload-artwork, passes
 *                      uploaded_file_paths to proof-create. AI revisions
 *                      are disabled for uploaded proofs (enforced at the
 *                      edge function + surfaced in the UI note).
 */

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProofAllowance } from "@/hooks/useProofAllowance";
import {
  Loader2, Send, CheckCircle2, Copy, ImagePlus, X,
  Palette, FileUp, AlertCircle, Lock, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LineItemsBuilder,
  builderItemsToPayload,
  builderItemsValid,
  type BuilderLineItem,
} from "@/components/proof/LineItemsBuilder";
import { ApproveProBrand } from "@/components/proof/ApproveProBrand";

interface SendForApprovalDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context: {
    visualizationId?: string | null;
    renderUrls: Record<string, string>;
    vehicleYear?: string;
    vehicleMake?: string;
    vehicleModel?: string;
    vehicleType?: string;
    designName?: string | null;
    finishType?: string | null;
    defaultMode?: "sign_only" | "revision_loop";
    flatPanelUrl?: string;
    // WPW order linkage — when present, the new proof is bound to this WPW
    // order so the ApprovePro dashboard can show its full history under the
    // order number going forward.
    wpwOrderId?: string;
    wpwOrderNumber?: string;
    wpwWooOrderId?: number;
    // Source design version label (e.g. "V3") to show in the dialog header so
    // the operator has a positive confirmation that the latest revision is
    // what's about to be sent. Optional — only shown when the caller knows
    // the design has revision history (e.g. RevisionStudioIQ).
    sourceDesignVersion?: string;
    sourceIsLatest?: boolean;
  };
}

interface UploadedArtwork {
  path: string;
  filename: string;
  content_type: string;
  preview_url: string | null;
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_FILES = 6;
const ALLOWED_UPLOAD_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

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

export const SendForApprovalDialog = ({
  open,
  onOpenChange,
  context,
}: SendForApprovalDialogProps) => {
  const { toast } = useToast();
  const { data: allowance } = useProofAllowance();

  // Common fields
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"sign_only" | "revision_loop">(
    context.defaultMode || "revision_loop",
  );
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [whiteLabelLogoUrl, setWhiteLabelLogoUrl] = useState("");

  // Source tab + upload state
  const [source, setSource] = useState<"render" | "upload" | "multi">("render");
  const [uploads, setUploads] = useState<UploadedArtwork[]>([]);
  const [uploadingBatch, setUploadingBatch] = useState(false);
  const [lineItems, setLineItems] = useState<BuilderLineItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successState, setSuccessState] = useState<{ viewUrl: string } | null>(null);
  const [tierError, setTierError] = useState<string | null>(null);
  const [myEmail, setMyEmail] = useState<string | null>(null);

  // Grab the signed-in user's email so we can offer a one-click
  // "Send test to me" button — the most common workflow before sending
  // a proof to the actual customer.
  useEffect(() => {
    if (!open) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setMyEmail(user.email);
    });
  }, [open]);

  const hasRenderUrls = context.renderUrls && Object.keys(context.renderUrls).length > 0;
  const renderUrlCount = Object.keys(context.renderUrls || {}).length;
  const aiRevisionsUnavailable = source === "upload" || source === "multi";
  const tierBlocks = allowance && allowance.remaining <= 0;

  // Auto-populate line items from render URLs when there are multiple views
  // so each view can be approved/declined individually.
  // Also includes 2D flat panel as first item if available.
  const autoPopulateLineItems = () => {
    if (renderUrlCount > 1 && lineItems.length === 0) {
      const VIEW_LABELS: Record<string, string> = {
        hero: "Hero View (3D)", side: "Driver Side (3D)", "driver-side": "Driver Side (3D)",
        "passenger-side": "Passenger Side (3D)", front: "Front View (3D)", rear: "Rear View (3D)",
        roof: "Top/Roof View (3D)", hood: "Hood View (3D)", detail: "Detail View",
      };
      const items: BuilderLineItem[] = [];

      // Add 2D flat panel as first line item if available
      if (context.flatPanelUrl) {
        items.push({
          id: "auto-2d-panel",
          title: "2D Flat Panel Design",
          description: `${context.designName || "Design"} — print-ready flat artwork`,
          render_url: context.flatPanelUrl,
        });
      }

      // Add each 3D render view
      Object.entries(context.renderUrls).forEach(([key, url], i) => {
        items.push({
          id: `auto-${i}`,
          title: VIEW_LABELS[key] || key.replace(/-|_/g, " "),
          description: `${context.designName || "Design"} — ${key} angle`,
          render_url: url,
        });
      });

      setLineItems(items);
      setSource("multi");
    }
  };

  // Auto-populate when dialog opens with multi-view renders
  useEffect(() => {
    if (open && renderUrlCount > 1) {
      autoPopulateLineItems();
    }
  }, [open, renderUrlCount]);

  const resetAndClose = () => {
    setCustomerName("");
    setCustomerEmail("");
    setMessage("");
    setWhiteLabelLogoUrl("");
    setUploads([]);
    setLineItems([]);
    setSource("render");
    setSuccessState(null);
    setTierError(null);
    onOpenChange(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const slotsLeft = MAX_UPLOAD_FILES - uploads.length;
    const selected = Array.from(files).slice(0, slotsLeft);

    const payload: Array<{
      filename: string;
      content_type: string;
      data_base64: string;
    }> = [];

    for (const f of selected) {
      if (!ALLOWED_UPLOAD_TYPES.has(f.type)) {
        toast({
          title: "Unsupported file",
          description: `${f.name} (${f.type}) — use PDF, JPG, PNG, WebP, or HEIC.`,
          variant: "destructive",
        });
        continue;
      }
      if (f.size > MAX_UPLOAD_BYTES) {
        toast({
          title: "File too large",
          description: `${f.name} is over ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`,
          variant: "destructive",
        });
        continue;
      }
      try {
        const base64 = await fileToBase64(f);
        payload.push({
          filename: f.name,
          content_type: f.type,
          data_base64: base64,
        });
      } catch (err: any) {
        toast({
          title: `${f.name} failed to read`,
          description: err?.message || "Browser error",
          variant: "destructive",
        });
      }
    }

    if (payload.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploadingBatch(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "proof-upload-artwork",
        { body: { files: payload } },
      );
      if (error || !data?.success) {
        const msg = (data as any)?.error || error?.message || "Upload failed";
        toast({
          title: "Upload failed",
          description: msg,
          variant: "destructive",
        });
        return;
      }
      setUploads((prev) => [...prev, ...(data.uploaded || [])]);
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err?.message || "Network error",
        variant: "destructive",
      });
    } finally {
      setUploadingBatch(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeUpload = (path: string) => {
    setUploads((prev) => prev.filter((u) => u.path !== path));
  };

  const handleSend = async () => {
    setTierError(null);
    if (!customerEmail || !customerEmail.includes("@")) {
      toast({
        title: "Customer email required",
        description: "Enter the client's email so we can send them the link.",
        variant: "destructive",
      });
      return;
    }

    if (source === "render" && !hasRenderUrls) {
      toast({
        title: "No render available",
        description: "Generate a render first, or switch to Upload artwork.",
        variant: "destructive",
      });
      return;
    }
    if (source === "upload" && uploads.length === 0) {
      toast({
        title: "No artwork uploaded",
        description: "Upload at least one file to send for approval.",
        variant: "destructive",
      });
      return;
    }
    if (source === "multi") {
      const valid = builderItemsValid(lineItems);
      if (!valid.ok) {
        toast({
          title: "Fix line items",
          description: valid.reason || "Invalid line items",
          variant: "destructive",
        });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        customer_email: customerEmail,
        customer_name: customerName || undefined,
        mode,
        vehicle_year: context.vehicleYear,
        vehicle_make: context.vehicleMake,
        vehicle_model: context.vehicleModel,
        vehicle_type: context.vehicleType,
        design_name: context.designName || undefined,
        finish_type: context.finishType || undefined,
        message_to_customer: message || undefined,
        expires_in_days: expiresInDays,
      };

      if (source === "render") {
        body.source_visualization_id = context.visualizationId || undefined;
        body.render_urls = context.renderUrls;
      } else if (source === "upload") {
        body.uploaded_file_paths = uploads.map((u) => u.path);
      } else {
        body.line_items = builderItemsToPayload(lineItems);
      }

      if (allowance?.white_label_enabled && whiteLabelLogoUrl.trim()) {
        body.white_label_logo_url = whiteLabelLogoUrl.trim();
      }

      // WPW linkage (optional) — proof-create persists these into metadata
      // so WpwOrdersRail can match orders to their proof history.
      if (context.wpwOrderId) body.wpw_order_id = context.wpwOrderId;
      if (context.wpwOrderNumber) body.wpw_order_number = context.wpwOrderNumber;
      if (context.wpwWooOrderId) body.wpw_woo_order_id = context.wpwWooOrderId;

      const createRes = await supabase.functions.invoke("proof-create", { body });

      if (createRes.error || !createRes.data?.success) {
        const errorData = createRes.data as any;
        const msg = errorData?.error || createRes.error?.message || "Failed to create proof";
        // Phase 6: tier-limit dedicated UI
        if (errorData?.reason === "tier_limit") {
          setTierError(msg);
          setIsSubmitting(false);
          return;
        }
        throw new Error(msg);
      }

      const proofId = createRes.data.proof_id;
      const viewUrl = createRes.data.view_url;

      const sendRes = await supabase.functions.invoke("proof-send", {
        body: {
          proof_id: proofId,
          custom_message: message || undefined,
        },
      });

      if (sendRes.error || !sendRes.data?.success) {
        const msg = (sendRes.data as any)?.error || sendRes.error?.message || "Created but email failed";
        toast({
          title: "Created — email failed",
          description: msg,
          variant: "destructive",
        });
        setSuccessState({ viewUrl });
        return;
      }

      setSuccessState({ viewUrl });
      toast({
        title: "Proof sent!",
        description: `Email on its way to ${customerEmail}`,
      });
    } catch (err: any) {
      toast({
        title: "Send failed",
        description: err?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!successState) return;
    try {
      await navigator.clipboard.writeText(successState.viewUrl);
      toast({ title: "Link copied to clipboard" });
    } catch {
      toast({
        title: "Copy failed",
        description: "Select and copy the URL manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : resetAndClose())}>
      <DialogContent
        className="max-w-3xl bg-white text-zinc-900 border-zinc-200 flex flex-col max-h-[92vh] p-0 gap-0 overflow-hidden"
        onOpenAutoFocus={(e) => {
          // Prevent Radix from auto-focusing the close button or any other
          // element when opening — we want the customer email field to be
          // the natural first focus, and we don't want focus to bounce
          // around (which on some pages with multiple SendForApprovalDialog
          // mounts caused inputs to silently swallow keystrokes).
          e.preventDefault();
          const el = document.getElementById("proof-customer-email-top");
          if (el) (el as HTMLInputElement).focus();
        }}
      >
        {successState ? (
          <>
            <ApproveProBrand subtitle="Proof sent — link is on its way" />
            <div className="p-6 space-y-4">
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              Proof sent
            </DialogTitle>
            <DialogDescription>
              Your client will receive an email with a link to review, sign, or
              decline. Track status in the Proofs dashboard (coming soon).
            </DialogDescription>
            <div className="space-y-2">
              <Label className="text-xs text-zinc-600">View URL</Label>
              <div className="flex gap-2">
                <Input value={successState.viewUrl} readOnly className="text-xs bg-white text-zinc-900" />
                <Button type="button" size="icon" variant="outline" onClick={handleCopyUrl}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <Button onClick={resetAndClose} className="w-full">Done</Button>
          </div>
          </>
        ) : (
          <>
            {/* Brand chrome — same gradient strip + ApprovePro wordmark used
                on the workbench. Keeps the operator anchored when the
                dialog steals focus from the page underneath. */}
            <ApproveProBrand
              subtitle="Send for client approval — sign, revise, audit"
              rightSlot={allowance && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-medium",
                    allowance.remaining > 5
                      ? "bg-green-50 text-green-700 border-green-200"
                      : allowance.remaining > 0
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-red-50 text-red-700 border-red-200",
                  )}
                >
                  {allowance.tier} · {allowance.remaining >= 999999 ? "∞" : allowance.remaining} left
                </Badge>
              )}
            />

            {/* Title + sending-version hint */}
            <div className="shrink-0 px-6 pt-4 pb-3 border-b border-zinc-200">
              <DialogTitle className="text-lg">Send for Client Approval</DialogTitle>
              <DialogDescription>
                Email the client a link to approve, sign, or decline.
              </DialogDescription>
              {context.sourceDesignVersion && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-blue-50 to-fuchsia-50 border border-blue-200 px-2.5 py-1 text-[11px] font-medium text-blue-900">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Sending {context.sourceDesignVersion}
                  {context.sourceIsLatest && <span className="text-emerald-700 font-semibold">· latest</span>}
                </div>
              )}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-5">

            {tierError && (
              <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Monthly proof limit reached</p>
                  <p>{tierError}</p>
                </div>
              </div>
            )}

            {/* ── Customer section (TOP — most important fields) ── */}
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label className="text-sm font-semibold text-blue-900">
                  Send to
                </Label>
                {myEmail && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-blue-400 text-blue-700 hover:bg-blue-100"
                    disabled={isSubmitting}
                    title="Fills the customer email above with your own. You still have to click Send for Approval at the bottom to actually send the test."
                    onClick={() => {
                      setCustomerEmail(myEmail);
                      if (!customerName) setCustomerName("Test (me)");
                    }}
                  >
                    <Send className="w-3 h-3" />
                    Use my email ({myEmail})
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="proof-customer-email-top" className="text-xs text-zinc-700">
                    Customer email <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="proof-customer-email-top"
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="client@example.com"
                    disabled={isSubmitting}
                    className="bg-white text-zinc-900 placeholder:text-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="proof-customer-name-top" className="text-xs text-zinc-700">
                    Customer name (optional)
                  </Label>
                  <Input
                    id="proof-customer-name-top"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Jane Smith"
                    disabled={isSubmitting}
                    className="bg-white text-zinc-900 placeholder:text-zinc-400"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="proof-message-top" className="text-xs text-zinc-700">
                  Message to customer (optional — appears in the email)
                </Label>
                <Textarea
                  id="proof-message-top"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Hey Jane — here's the wrap design we talked about. Approve or let me know any tweaks before we go to print."
                  className="min-h-[70px] bg-white text-zinc-900 placeholder:text-zinc-400"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-4">
              {/* Source tabs — Phase 6 (render/upload) + Phase 8C (multi) */}
              <Tabs value={source} onValueChange={(v) => setSource(v as typeof source)}>
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="render" className="gap-1.5" disabled={isSubmitting}>
                    <Palette className="w-3.5 h-3.5" />
                    From render
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="gap-1.5" disabled={isSubmitting}>
                    <FileUp className="w-3.5 h-3.5" />
                    Upload artwork
                  </TabsTrigger>
                  <TabsTrigger value="multi" className="gap-1.5" disabled={isSubmitting}>
                    <Layers className="w-3.5 h-3.5" />
                    Multi-item
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="render" className="pt-3">
                  {hasRenderUrls ? (
                    <p className="text-xs text-zinc-600">
                      Using {Object.keys(context.renderUrls).length} existing
                      render{Object.keys(context.renderUrls).length === 1 ? "" : "s"} from this session.
                    </p>
                  ) : (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                      No render yet — generate one first or switch to Upload artwork.
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="upload" className="pt-3 space-y-3">
                  <p className="text-xs text-zinc-600">
                    Run your own designs (PDF, PNG, JPG, WebP) through the same
                    approval flow. Max {MAX_UPLOAD_FILES} files, 8MB each.
                  </p>

                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {uploads.map((u) => (
                      <div
                        key={u.path}
                        className="relative aspect-square rounded-md overflow-hidden border border-zinc-200 bg-zinc-50 group"
                      >
                        {u.preview_url && u.content_type !== "application/pdf" ? (
                          <img
                            src={u.preview_url}
                            alt={u.filename}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-[9px] text-zinc-500 px-1 text-center">
                            <FileUp className="w-4 h-4 mb-1" />
                            <span className="truncate w-full">
                              {u.filename.length > 16
                                ? u.filename.slice(0, 14) + "…"
                                : u.filename}
                            </span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeUpload(u.path)}
                          disabled={isSubmitting}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Remove"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}

                    {uploads.length < MAX_UPLOAD_FILES && (
                      <label
                        htmlFor="proof-artwork-upload"
                        className={cn(
                          "aspect-square rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors",
                          uploadingBatch || isSubmitting
                            ? "border-zinc-200 bg-zinc-50 pointer-events-none opacity-50"
                            : "border-zinc-300 hover:border-blue-500 hover:bg-blue-50",
                        )}
                      >
                        {uploadingBatch ? (
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
                    id="proof-artwork-upload"
                    type="file"
                    accept="application/pdf,image/*"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />

                  {source === "upload" && aiRevisionsUnavailable && (
                    <p className="text-[11px] text-zinc-500 italic">
                      AI revisions aren't available for uploaded artwork —
                      clients can still request changes in writing.
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="multi" className="pt-3 space-y-3">
                  <p className="text-xs text-zinc-600">
                    Send a proof with multiple items — each line gets its own
                    thumbnail, its own approve / decline / request-revision
                    buttons, and lands as a separate row in the signed PDF.
                  </p>
                  <LineItemsBuilder
                    items={lineItems}
                    onChange={setLineItems}
                    disabled={isSubmitting}
                    sessionRenderUrls={context.renderUrls}
                  />
                  <p className="text-[11px] text-zinc-500 italic">
                    AI revisions aren't available on multi-item proofs —
                    clients request revisions per line in writing.
                  </p>
                </TabsContent>
              </Tabs>

              <div className="space-y-1">
                <Label className="text-xs text-zinc-600">Approval mode</Label>
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => setMode(v as typeof mode)}
                  disabled={isSubmitting}
                  className="grid grid-cols-2 gap-2"
                >
                  <Label
                    htmlFor="mode-revision"
                    className="flex items-start gap-2 p-3 rounded-md border border-zinc-200 cursor-pointer hover:bg-zinc-50 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50"
                  >
                    <RadioGroupItem value="revision_loop" id="mode-revision" className="mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-zinc-900">Revision Loop</div>
                      <div className="text-xs text-zinc-500">Approve, decline, or request revisions</div>
                    </div>
                  </Label>
                  <Label
                    htmlFor="mode-sign"
                    className="flex items-start gap-2 p-3 rounded-md border border-zinc-200 cursor-pointer hover:bg-zinc-50 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50"
                  >
                    <RadioGroupItem value="sign_only" id="mode-sign" className="mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-zinc-900">Sign Only</div>
                      <div className="text-xs text-zinc-500">Approve or decline — no revisions</div>
                    </div>
                  </Label>
                </RadioGroup>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* White-label logo — Phase 6, gated by tier */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="proof-logo" className="text-xs text-zinc-600">
                      White-label logo URL <span className="text-zinc-500">(optional)</span>
                    </Label>
                    {!allowance?.white_label_enabled && (
                      <Badge variant="outline" className="h-4 px-1 text-[9px] gap-0.5 bg-zinc-100">
                        <Lock className="w-2.5 h-2.5" />
                        Silver+
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="proof-logo"
                    value={whiteLabelLogoUrl}
                    onChange={(e) => setWhiteLabelLogoUrl(e.target.value)}
                    placeholder="https://your-shop.com/logo.png"
                    disabled={isSubmitting || !allowance?.white_label_enabled}
                    className="bg-white text-zinc-900 placeholder:text-zinc-400"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="proof-expiry" className="text-xs text-zinc-600">
                    Link expires in (days)
                  </Label>
                  <Input
                    id="proof-expiry"
                    type="number"
                    min={1}
                    max={60}
                    value={expiresInDays}
                    className="bg-white text-zinc-900"
                    onChange={(e) => setExpiresInDays(parseInt(e.target.value) || 14)}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </div>
            </div>

            {/* Sticky footer — Send button always reachable */}
            <div className="shrink-0 px-6 py-3 border-t border-zinc-200 bg-white grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={resetAndClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                onClick={handleSend}
                disabled={
                  isSubmitting ||
                  uploadingBatch ||
                  !customerEmail ||
                  tierBlocks ||
                  (source === "render" && !hasRenderUrls) ||
                  (source === "upload" && uploads.length === 0) ||
                  (source === "multi" && !builderItemsValid(lineItems).ok)
                }
              >
                {isSubmitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" /> Send for Approval</>
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
