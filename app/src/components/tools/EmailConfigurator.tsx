/**
 * EmailConfigurator
 *
 * Dialog that lets shop owners compose and send emails to their clients.
 * 4 email types: Approval Proof, Studio Proof, Quote, Send All.
 * Pre-fills with vehicle/color data, editable subject + body.
 * CC's the shop owner automatically.
 * White-label: shop name + logo from profile, editable.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { logEmailSent } from "@/lib/quickquote-db";
import { Badge } from "@/components/ui/badge";
import { QuickQuoteEditor } from "@/components/tools/QuickQuoteEditor";
import {
  ClipboardSignature,
  Camera,
  Calculator,
  Send,
  Loader2,
  Mail,
  User,
  Building2,
  ImageIcon,
  Eye,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { loadShopProfile } from "@/lib/proof-service";
import {
  calculateEstimate,
  type WrapEstimate,
} from "@/lib/quick-quote";

type EmailType = "proof" | "studio" | "quote" | "all";

interface ViewData {
  type: string;
  url: string;
  label?: string;
}

interface QuoteLineItem {
  label: string;
  detail?: string;
  amount: number;
}

interface QuoteSnapshot {
  quoteNumber: string;
  vehicle: string;
  colorName: string;
  manufacturer: string;
  finish: string;
  lineItems: QuoteLineItem[];
  total: string;
  region?: string;
}

interface EmailConfiguratorProps {
  isOpen: boolean;
  onClose: () => void;
  // Vehicle + color data
  year: string;
  make: string;
  model: string;
  finish: string;
  colorName: string;
  manufacturer: string;
  colorHex?: string;
  productCode?: string;
  swatchImageUrl?: string;
  // Render views
  views: ViewData[];
  heroImageUrl?: string | null;
  renderUrl?: string | null;
  visualizationId?: string | null;
  // Pre-filled customer info (from QuickQuote)
  customerName?: string;
  customerEmail?: string;
  // Quote configurator trigger
  onOpenQuoteEditor?: () => void;
  // Externally-configured quote data (from QuickQuote callback)
  externalQuoteData?: QuoteSnapshot | null;
  // Pre-select an email type when opening
  initialEmailType?: EmailType;
}

const EMAIL_TYPES: { id: EmailType; label: string; icon: React.ElementType; color: string; tooltip: string }[] = [
  {
    id: "proof",
    label: "Approval Proof",
    icon: ClipboardSignature,
    color: "from-blue-600 to-indigo-600",
    tooltip: "Send the design for client sign-off. Includes the hero render and an approval message asking them to review and confirm before production.",
  },
  {
    id: "studio",
    label: "Studio Proof",
    icon: Camera,
    color: "from-cyan-600 to-blue-600",
    tooltip: "Send the multi-angle studio renders so the client can see the wrap from every side. No pricing, no approval language — just the visuals.",
  },
  {
    id: "quote",
    label: "Quote",
    icon: Calculator,
    color: "from-blue-600 to-purple-600",
    tooltip: "Send the full pricing quote with line items and total. Every line is scaled to the marked-up customer price — shop cost is hidden.",
  },
  {
    id: "all",
    label: "Send All",
    icon: Send,
    color: "from-indigo-600 to-purple-600",
    tooltip: "One email with everything: approval proof + studio renders + pricing quote. Use this when you want the client to see the full package in one message.",
  },
];

const DEFAULT_BODIES: Record<EmailType, (vehicle: string, colorName: string) => string> = {
  proof: (vehicle, color) =>
    `Please find your vehicle wrap approval proof attached below.\n\nVehicle: ${vehicle}\nColor: ${color}\n\nPlease review the design carefully and let me know if you have any questions or would like any changes.\n\nLooking forward to getting started on your wrap!`,
  studio: (vehicle, color) =>
    `Here are the studio renders of your ${vehicle} in ${color}.\n\nThese views show how the wrap will look from multiple angles. Let me know what you think!`,
  quote: (vehicle, color) =>
    `Please find your wrap quote below for the ${vehicle} in ${color}.\n\nThis quote includes material and labor estimates based on your vehicle specifications. Feel free to reach out with any questions.`,
  all: (vehicle, color) =>
    `Please find your complete wrap package below for the ${vehicle} in ${color}.\n\nThis includes your approval proof, studio renders, and pricing quote. Please review everything and let me know if you have any questions or would like to make changes.\n\nLooking forward to working with you!`,
};

const DEFAULT_SUBJECTS: Record<EmailType, (vehicle: string, shopName: string) => string> = {
  proof: (vehicle, shop) => `Your Wrap Approval Proof — ${vehicle} — ${shop}`,
  studio: (vehicle, shop) => `Studio Renders — ${vehicle} — ${shop}`,
  quote: (vehicle, shop) => `Wrap Quote — ${vehicle} — ${shop}`,
  all: (vehicle, shop) => `Your Complete Wrap Package — ${vehicle} — ${shop}`,
};

/**
 * Build the same HTML email the edge function sends — used for the live preview iframe.
 */
function buildEmailPreviewHtml(opts: {
  emailType: EmailType;
  shopName: string;
  shopLogoUrl: string;
  clientName: string;
  body: string;
  vehicle: string;
  views: ViewData[];
  quoteData: QuoteSnapshot | null;
}): string {
  const { emailType, shopName, shopLogoUrl, clientName, body, vehicle, views, quoteData } = opts;
  const shopDisplay = shopName || "Your Wrap Shop";

  const shopHeader = shopLogoUrl
    ? `<img src="${shopLogoUrl}" alt="${shopDisplay}" style="max-height:50px;max-width:200px;margin-bottom:8px;" />`
    : `<h2 style="margin:0;font-size:20px;color:#ffffff;font-weight:700;">${shopDisplay}</h2>`;

  const vehicleBadge = vehicle
    ? `<p style="margin:8px 0 0;font-size:12px;color:#e0e7ff;font-weight:600;">${vehicle}</p>`
    : "";

  const bodyHtml = body.replace(/\n/g, "<br />");

  let proofSection = "";
  if ((emailType === "proof" || emailType === "all") && views.length) {
    const heroView = views[0];
    const thumbs = views.slice(1);
    proofSection = `
      <tr><td style="padding:24px 32px 0;">
        <p style="margin:0 0 12px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Approval Proof</p>
        <img src="${heroView.url}" alt="${heroView.label || "Hero View"}" style="width:100%;border-radius:8px;display:block;" />
        ${thumbs.length > 0 ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr>
            ${thumbs.slice(0, 4).map(v => `<td style="width:25%;padding:4px;"><img src="${v.url}" alt="${v.label || v.type}" style="width:100%;border-radius:4px;display:block;" /></td>`).join("")}
          </tr></table>
        ` : ""}
      </td></tr>`;
  }

  let studioSection = "";
  if ((emailType === "studio" || emailType === "all") && views.length) {
    studioSection = `
      <tr><td style="padding:24px 32px 0;">
        <p style="margin:0 0 12px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Studio Views</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${views.reduce((rows: string[], v, i) => {
            if (i % 2 === 0) rows.push("<tr>");
            rows[rows.length - 1] += `<td style="width:50%;padding:4px;"><img src="${v.url}" alt="${v.label || v.type}" style="width:100%;border-radius:6px;display:block;" /><p style="margin:4px 0 8px;font-size:10px;color:#888;text-align:center;">${v.label || v.type}</p></td>`;
            if (i % 2 === 1 || i === views.length - 1) rows[rows.length - 1] += "</tr>";
            return rows;
          }, []).join("")}
        </table>
      </td></tr>`;
  }

  let quoteSection = "";
  if ((emailType === "quote" || emailType === "all") && quoteData) {
    const q = quoteData;
    const lineRows = q.lineItems.map(item => `
      <tr>
        <td style="padding:6px 0;font-size:13px;color:#e0e0e0;border-bottom:1px solid #222;">${item.label}${item.detail ? `<br/><span style="font-size:11px;color:#888;">${item.detail}</span>` : ""}</td>
        <td style="padding:6px 0;font-size:13px;color:#ffffff;text-align:right;font-weight:600;border-bottom:1px solid #222;">$${item.amount.toFixed(2)}</td>
      </tr>
    `).join("");

    quoteSection = `
      <tr><td style="padding:24px 32px 0;">
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Quote</p>
        <p style="margin:0 0 12px;font-size:10px;color:#666;">Quote #${q.quoteNumber}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;">Item</td>
            <td style="padding:8px 0;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;text-align:right;border-bottom:1px solid #333;">Amount</td>
          </tr>
          ${lineRows}
          <tr>
            <td style="padding:12px 0 0;font-size:15px;color:#00C7FF;font-weight:700;">Total</td>
            <td style="padding:12px 0 0;font-size:15px;color:#00C7FF;font-weight:700;text-align:right;">$${q.total}</td>
          </tr>
        </table>
      </td></tr>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#000000;">
    <tr><td align="center" style="padding:16px 8px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#0d0d0d;border:1px solid #1a1a1a;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:24px 32px;background:linear-gradient(135deg,#2563eb,#a855f7);border-bottom:1px solid #1a1a1a;text-align:center;">
          ${shopHeader}
          ${vehicleBadge}
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <p style="margin:0 0 4px;font-size:14px;color:#ffffff;font-weight:600;">Hi ${clientName || "there"},</p>
          <div style="margin:12px 0 0;font-size:14px;color:#cccccc;line-height:1.6;">${bodyHtml}</div>
        </td></tr>
        ${proofSection}
        ${studioSection}
        ${quoteSection}
        <tr><td style="padding:32px;border-top:1px solid #1a1a1a;text-align:center;">
          <p style="margin:0 0 8px;font-size:10px;color:#444;">Powered by <span style="color:#00C7FF;font-weight:600;">DesignProAI</span></p>
          <p style="margin:0;font-size:9px;color:#333;">Professional Vehicle Wrap Visualization</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export const EmailConfigurator = ({
  isOpen,
  onClose,
  year,
  make,
  model,
  finish,
  colorName,
  manufacturer,
  colorHex,
  productCode,
  swatchImageUrl,
  views,
  heroImageUrl,
  renderUrl,
  visualizationId,
  customerName: prefillName = "",
  customerEmail: prefillEmail = "",
  onOpenQuoteEditor,
  externalQuoteData,
  initialEmailType,
}: EmailConfiguratorProps) => {
  const { toast } = useToast();
  const previewRef = useRef<HTMLIFrameElement>(null);
  const vehicle = [year, make, model].filter(Boolean).join(" ");

  // State
  const [emailType, setEmailType] = useState<EmailType>(initialEmailType || "proof");
  const [clientName, setClientName] = useState(prefillName);
  const [clientEmail, setClientEmail] = useState(prefillEmail);
  const [userEmail, setUserEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopLogoUrl, setShopLogoUrl] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [showQuoteEditor, setShowQuoteEditor] = useState(false);
  const [internalQuoteData, setInternalQuoteData] = useState<QuoteSnapshot | null>(null);

  // Auto-calculate quote for quote/all types
  const autoQuote = useMemo<QuoteSnapshot | null>(() => {
    if (!make || !model) return null;
    try {
      const est = calculateEstimate({
        year, make, model, finish, colorName, manufacturer,
        stateCode: "TX",
        toolSource: "ColorPro",
      });
      if (!est) return null;
      const lineItems: QuoteLineItem[] = [
        {
          label: `${est.manufacturer} ${est.colorName} (${est.finish})`,
          detail: est.isPrintPro
            ? `${est.sqFt} sq ft @ $${est.materialCostPerUnit?.toFixed(2)}/sq ft`
            : `${est.yardsNeeded} yds @ $${est.filmCostPerYard}/yd`,
          amount: est.materialCostTotal || est.filmCostTotal || 0,
        },
        {
          label: "Install Labor",
          detail: `${est.sqFt} sq ft @ $${est.laborPerSqFt}/sq ft`,
          amount: est.laborTotal,
        },
      ];
      return {
        quoteNumber: est.quoteNumber,
        vehicle: `${est.vehicle.year} ${est.vehicle.make} ${est.vehicle.model}`,
        colorName: est.colorName,
        manufacturer: est.manufacturer,
        finish: est.finish,
        lineItems,
        total: est.subtotal.toFixed(2),
        region: est.region,
      };
    } catch {
      return null;
    }
  }, [year, make, model, finish, colorName, manufacturer]);

  // Quote priority: user-configured (internal) > external prop > auto-calculated
  const activeQuote = internalQuoteData || externalQuoteData || autoQuote;

  // Reset email type to initial when opened
  useEffect(() => {
    if (isOpen && initialEmailType) {
      setEmailType(initialEmailType);
    }
  }, [isOpen, initialEmailType]);

  // Load user email + shop profile on open
  useEffect(() => {
    if (!isOpen) {
      setInitialized(false);
      return;
    }
    if (initialized) return;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user?.email) setUserEmail(data.user.email);

      const profile = await loadShopProfile();
      if (profile?.shop_name) setShopName(profile.shop_name);
      if (profile?.shop_logo_url) setShopLogoUrl(profile.shop_logo_url);

      setInitialized(true);
    })();
  }, [isOpen, initialized]);

  // Sync prefill values when they change — always take latest parent value
  useEffect(() => {
    if (prefillName) setClientName(prefillName);
  }, [prefillName]);
  useEffect(() => {
    if (prefillEmail) setClientEmail(prefillEmail);
  }, [prefillEmail]);

  // Update subject/body when email type changes
  useEffect(() => {
    const shop = shopName || "Your Wrap Shop";
    setSubject(DEFAULT_SUBJECTS[emailType](vehicle, shop));
    setBody(DEFAULT_BODIES[emailType](vehicle, colorName));
  }, [emailType, vehicle, colorName, shopName]);

  // Build live preview HTML mirroring the edge function output
  const previewHtml = useMemo(() => buildEmailPreviewHtml({
    emailType,
    shopName,
    shopLogoUrl,
    clientName,
    body,
    vehicle,
    views,
    quoteData: activeQuote,
  }), [emailType, shopName, shopLogoUrl, clientName, body, vehicle, views, activeQuote]);

  // Write preview HTML into the iframe
  useEffect(() => {
    if (showPreview && previewRef.current) {
      const doc = previewRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(previewHtml);
        doc.close();
      }
    }
  }, [previewHtml, showPreview]);

  const handleSend = async () => {
    if (!clientEmail) {
      toast({ title: "Email Required", description: "Please enter your client's email address.", variant: "destructive" });
      return;
    }
    if (!clientName) {
      toast({ title: "Name Required", description: "Please enter your client's name.", variant: "destructive" });
      return;
    }

    setIsSending(true);
    try {
      const payload: any = {
        to: clientEmail,
        cc: userEmail || undefined,
        clientName,
        subject,
        body,
        emailType,
        vehicleInfo: { year, make, model },
        shopName: shopName || undefined,
        shopLogoUrl: shopLogoUrl || undefined,
      };

      // Attach views for proof/studio/all
      if (emailType !== "quote" && views.length > 0) {
        payload.views = views;
      }

      // Attach quote for quote/all
      if ((emailType === "quote" || emailType === "all") && activeQuote) {
        payload.quoteData = activeQuote;
      }

      const { data, error } = await supabase.functions.invoke("send-client-proof-email", {
        body: payload,
      });

      // Supabase functions.invoke returns the body in `data` even on non-2xx,
      // so check for an `error` field there as well as the top-level error
      if (error) {
        const errMsg = (data as any)?.error || error.message || "Failed to send email";
        throw new Error(errMsg);
      }
      if (!data?.success) {
        throw new Error(data?.error || "Email did not send — check edge function logs");
      }

      // Log the send to email_log (non-blocking — best effort)
      logEmailSent({
        quoteId: (activeQuote as any)?.quoteId || null,
        customerId: null,
        emailType,
        subject,
        body,
        recipient: clientEmail,
      }).catch(() => {});

      const typeLabel = EMAIL_TYPES.find(t => t.id === emailType)?.label || emailType;
      toast({
        title: "Email Sent",
        description: `${typeLabel} sent to ${clientEmail}${userEmail ? ` — CC: ${userEmail}` : ""}`,
        duration: 5000,
      });
      onClose();
    } catch (err: any) {
      console.error("Email send error:", err);
      toast({ title: "Send Failed", description: err.message || "Could not send email. Please try again.", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  const showQuoteSection = emailType === "quote" || emailType === "all";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 bg-[#0d0d0d] border-[#1a1a1a]">
        {/* Header — blue→magenta gradient */}
        <div className="px-5 pt-5 pb-3 border-b border-[#1a1a1a]" style={{ background: "linear-gradient(135deg, #2563eb, #a855f7)" }}>
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-5 h-5 text-white" />
            <h2 className="text-base font-bold text-white">Email Client</h2>
          </div>
          <p className="text-xs text-white/70">Compose and send proofs, studio views, or quotes to your client.</p>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Email Type Selector */}
          <div>
            <Label className="text-[10px] text-white/30 uppercase tracking-wider mb-2 block">Email Type</Label>
            <TooltipProvider delayDuration={150}>
              <div className="grid grid-cols-4 gap-1.5">
                {EMAIL_TYPES.map(({ id, label, icon: Icon, color, tooltip }) => (
                  <Tooltip key={id}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setEmailType(id)}
                        className={cn(
                          "flex flex-col items-center gap-1 py-2.5 px-2 rounded-lg text-[10px] font-semibold transition-all border",
                          emailType === id
                            ? `bg-gradient-to-r ${color} text-white border-transparent`
                            : "bg-[#111] text-white/50 border-[#1a1a1a] hover:border-[#333] hover:text-white/70"
                        )}
                      >
                        <Icon className="w-4 h-4" />
                        {label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="max-w-[260px] bg-[#1a1a1a] border border-[#3a3a3a] text-white text-[11px] leading-snug"
                    >
                      <p className="font-bold text-[#00C7FF] mb-1">{label}</p>
                      <p className="text-white/80">{tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
          </div>

          {/* Shop Branding */}
          <div className="bg-[#111] rounded-lg border border-[#1a1a1a] p-3 space-y-2">
            <Label className="text-[10px] text-white/30 uppercase tracking-wider">Shop Branding</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-white/40 mb-1 block">Shop Name</Label>
                <Input
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="Your Shop Name"
                  className="h-8 text-xs bg-[#0d0d0d] border-[#2a2a2a] text-white placeholder:text-white/20"
                />
              </div>
              <div>
                <Label className="text-[10px] text-white/40 mb-1 block">Logo URL (optional)</Label>
                <Input
                  value={shopLogoUrl}
                  onChange={(e) => setShopLogoUrl(e.target.value)}
                  placeholder="https://..."
                  className="h-8 text-xs bg-[#0d0d0d] border-[#2a2a2a] text-white placeholder:text-white/20"
                />
              </div>
            </div>
          </div>

          {/* Recipient Info */}
          <div className="space-y-2">
            <Label className="text-[10px] text-white/30 uppercase tracking-wider">Recipient</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-white/40 mb-1 block flex items-center gap-1">
                  <User className="w-3 h-3" /> Client Name
                </Label>
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="John Smith"
                  className="h-8 text-xs bg-[#111] border-[#2a2a2a] text-white placeholder:text-white/20"
                />
              </div>
              <div>
                <Label className="text-[10px] text-white/40 mb-1 block flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Client Email
                </Label>
                <Input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="client@email.com"
                  className="h-8 text-xs bg-[#111] border-[#2a2a2a] text-white placeholder:text-white/20"
                />
              </div>
            </div>
            {userEmail && (
              <p className="text-[10px] text-white/30">
                CC: <span className="text-white/50">{userEmail}</span> (you will receive a copy)
              </p>
            )}
          </div>

          {/* Subject */}
          <div>
            <Label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="h-8 text-xs bg-[#111] border-[#2a2a2a] text-white placeholder:text-white/20"
            />
          </div>

          {/* Body */}
          <div>
            <Label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">Message</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="text-xs bg-[#111] border-[#2a2a2a] text-white placeholder:text-white/20 resize-none"
            />
          </div>

          {/* What's included badge bar */}
          <div className="flex flex-wrap gap-1.5">
            {(emailType === "proof" || emailType === "all") && (
              <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30 text-[10px]">
                <ClipboardSignature className="w-3 h-3 mr-1" /> Approval Proof Images
              </Badge>
            )}
            {(emailType === "studio" || emailType === "all") && (
              <Badge className="bg-cyan-600/20 text-cyan-400 border-cyan-600/30 text-[10px]">
                <Camera className="w-3 h-3 mr-1" /> Studio Views ({views.length})
              </Badge>
            )}
            {showQuoteSection && (
              <Badge className="bg-purple-600/20 text-purple-400 border-purple-600/30 text-[10px]">
                <Calculator className="w-3 h-3 mr-1" /> Quote {activeQuote ? `#${activeQuote.quoteNumber}` : ""}
              </Badge>
            )}
          </div>

          {/* No render warning — link to ColorPro to create one */}
          {(emailType === "proof" || emailType === "studio" || emailType === "all") && views.length === 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-1.5">
              <p className="text-[11px] text-amber-300 font-semibold">No render images attached</p>
              <p className="text-[10px] text-amber-300/70">You need to create a render first so it can be attached to the email.</p>
              <a
                href="/colorpro"
                className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white px-3 py-1.5 rounded-lg hover:opacity-90 transition-all"
                style={{ background: "linear-gradient(135deg, #2563eb, #a855f7)" }}
              >
                <ImageIcon className="w-3 h-3" />
                Go to ColorPro to Render
              </a>
            </div>
          )}

          {/* Quote Editor — embedded full QuickQuoteEditor with dark two-tone UI */}
          {showQuoteSection && (
            <div className="space-y-2">
              <button
                onClick={() => setShowQuoteEditor(!showQuoteEditor)}
                className="flex items-center gap-2 text-xs font-semibold text-[#00C7FF] hover:text-[#00B4E6] transition-colors"
              >
                <Calculator className="w-3.5 h-3.5" />
                {showQuoteEditor ? "Hide" : "Configure"} Quote
                {showQuoteEditor ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showQuoteEditor && (
                <QuickQuoteEditor
                  year={year}
                  make={make}
                  model={model}
                  finish={finish || "Gloss"}
                  colorName={colorName}
                  manufacturer={manufacturer}
                  colorHex={colorHex}
                  productCode={productCode}
                  swatchImageUrl={swatchImageUrl}
                  renderUrl={renderUrl || null}
                  visualizationId={visualizationId || null}
                  onQuoteUpdate={(data) => setInternalQuoteData(data)}
                />
              )}
              {!showQuoteEditor && activeQuote && (
                <div className="bg-[#111] rounded-lg border border-[#1a1a1a] p-3 space-y-1">
                  {activeQuote.lineItems.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px]">
                      <span className="text-white/60">{item.label}</span>
                      <span className="text-white font-semibold">${item.amount.toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-xs pt-1 border-t border-[#2a2a2a]">
                    <span className="text-[#00C7FF] font-bold">Total</span>
                    <span className="text-[#00C7FF] font-bold">${activeQuote.total}</span>
                  </div>
                </div>
              )}
              {!showQuoteEditor && !activeQuote && (
                <p className="text-[10px] text-white/30">No quote data available. Click "Configure Quote" to set up pricing.</p>
              )}
            </div>
          )}

          {/* Image Preview */}
          {emailType !== "quote" && views.length > 0 && (
            <div className="bg-[#111] rounded-lg border border-[#1a1a1a] p-3 space-y-2">
              <Label className="text-[10px] text-white/30 uppercase tracking-wider flex items-center gap-1">
                <ImageIcon className="w-3 h-3" /> Images Included
              </Label>
              <div className="grid grid-cols-4 gap-1.5">
                {views.slice(0, 4).map((v, i) => (
                  <div key={i} className="relative">
                    <img
                      src={v.url}
                      alt={v.label || v.type}
                      className="w-full aspect-video object-cover rounded border border-[#2a2a2a]"
                    />
                    <p className="text-[8px] text-white/40 text-center mt-0.5">{v.label || v.type}</p>
                  </div>
                ))}
              </div>
              {views.length > 4 && (
                <p className="text-[9px] text-white/30 text-center">+{views.length - 4} more views</p>
              )}
            </div>
          )}

          {/* Live Email Preview Toggle */}
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-2 text-xs font-semibold text-[#00C7FF] hover:text-[#00B4E6] transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            {showPreview ? "Hide" : "Show"} Email Preview
            {showPreview ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {/* Live Email Preview iframe */}
          {showPreview && (
            <div className="rounded-lg border border-[#1a1a1a] overflow-hidden bg-black">
              <div className="px-3 py-1.5 bg-[#111] border-b border-[#1a1a1a] flex items-center gap-2">
                <Eye className="w-3 h-3 text-white/40" />
                <span className="text-[10px] text-white/40 font-semibold uppercase tracking-wider">Customer Will See</span>
              </div>
              <iframe
                ref={previewRef}
                title="Email Preview"
                className="w-full border-0"
                style={{ height: "500px", background: "#000" }}
                sandbox="allow-same-origin"
              />
            </div>
          )}

          {/* Send Button */}
          <Button
            onClick={handleSend}
            disabled={isSending || !clientEmail || !clientName}
            className="w-full h-11 bg-gradient-to-r from-[#00C7FF] to-[#0088FF] hover:from-[#00B4E6] hover:to-[#0077DD] text-black font-bold text-sm"
          >
            {isSending ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4" />
                Send {EMAIL_TYPES.find(t => t.id === emailType)?.label} Email
              </div>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
