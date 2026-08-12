/**
 * QuikText Approve — Mobile-first quote approve/edit + send
 *
 * Shop owner gets SMS: "QUIKTEXT: Marcus — 2024 BMW M4 — Full Wrap"
 * with a link to this page. They can:
 * 1. See the lead summary
 * 2. Edit the price
 * 3. Add a personal note
 * 4. Hit Send → customer gets SMS + email with the quote
 *
 * White UI, black text, magenta gradient accents, RP branded.
 * Designed for one-thumb mobile use.
 */

import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Send, Check, Phone, MessageSquare, Car, DollarSign,
  Edit3, ChevronDown, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const QuikTextApprove = () => {
  const [searchParams] = useSearchParams();
  const leadId = searchParams.get("id") || "";

  const [lead, setLead] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [shopName, setShopName] = useState("");

  // Load lead + shop
  useEffect(() => {
    if (!leadId) { setLoading(false); return; }

    Promise.all([
      supabase.from("leads").select("*").eq("id", leadId).single(),
      supabase.from("shop_settings").select("*").limit(1).single(),
    ]).then(([leadRes, shopRes]) => {
      if (leadRes.data) {
        setLead(leadRes.data);
        const meta = (leadRes.data as any).metadata || {};
        setPrice(meta.totalEstimate ? String(meta.totalEstimate) : "");
      }
      if (shopRes.data) {
        setShopName((shopRes.data as any).shop_name || "");
      }
      setLoading(false);
    });
  }, [leadId]);

  const vehicle = lead ? [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(" ") : "";
  const meta = (lead?.metadata || {}) as any;
  const quikTextReason = meta.quicktext_reason || "";

  const handleSend = async () => {
    if (!lead) return;
    setSending(true);
    try {
      const quoteUrl = lead.quote_url || `${window.location.origin}/quick-quote`;
      const shop = shopName || "Your wrap shop";
      const customerName = lead.caller_name || "there";
      const priceStr = price ? `$${Number(price).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "";

      // SMS to customer
      if (lead.caller_phone) {
        let msg = `${customerName}, ${shop} here. Your ${vehicle || "vehicle"} wrap quote is confirmed`;
        if (priceStr) msg += ` at ${priceStr}`;
        msg += `. View details: ${quoteUrl}`;
        if (note) msg += ` — ${note}`;

        await supabase.functions.invoke("send-sms-campaign", {
          body: {
            recipients: [{ phone: lead.caller_phone, name: customerName }],
            messageTemplate: msg,
            campaignName: `QuikText Approve ${lead.id}`,
          },
        });
      }

      // Email if available
      const email = meta.email;
      if (email) {
        await supabase.functions.invoke("send-templated-email", {
          body: {
            templateSlug: "quickquote-send",
            to: email,
            mergeData: {
              customer_name: customerName,
              vehicle: vehicle || "your vehicle",
              service: lead.service_requested || "Vehicle Wrap",
              quote_url: quoteUrl,
              shop_name: shop,
              price: priceStr,
            },
          },
        });
      }

      // Update lead status
      await supabase.from("leads").update({
        status: "quoted",
        quote_sent_at: new Date().toISOString(),
        sms_sent_to_customer: true,
        email_sent_to_customer: !!email,
        metadata: { ...meta, approved_price: price, shop_note: note },
      } as any).eq("id", lead.id);

      setSent(true);
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#a855f7]" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-lg font-bold text-[#111]">Lead not found</p>
          <p className="text-sm text-[#9ca3af] mt-1">This link may have expired or the lead was removed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>QuikText Approve | RestyleProAI</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Helmet>

      {/* ── Branded header ── */}
      <div className="sticky top-0 z-20" style={{ background: "linear-gradient(135deg, #111 0%, #1a1a1a 100%)" }}>
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold">
              <span className="text-white">Restyle</span><span className="text-[#a855f7]">Pro</span>
            </p>
            <p className="text-[10px] text-white/40">QuikText Approve</p>
          </div>
          {quikTextReason && (
            <span className={cn(
              "text-[10px] font-bold px-2.5 py-1 rounded-full",
              quikTextReason === "rush" && "bg-red-500/20 text-red-400",
              quikTextReason === "problem" && "bg-amber-500/20 text-amber-400",
              quikTextReason === "quote" && "bg-[#a855f7]/20 text-[#a855f7]",
              !["rush", "problem", "quote"].includes(quikTextReason) && "bg-white/10 text-white/50",
            )}>
              {quikTextReason === "rush" ? "RUSH" : quikTextReason === "problem" ? "ISSUE" : "QUOTE"}
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-5 space-y-5 max-w-lg mx-auto">

        {/* ── Customer card ── */}
        <div className="bg-[#f9fafb] rounded-2xl p-4 border border-[#e5e7eb]">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-lg font-bold text-[#111]">{lead.caller_name || "Unknown Caller"}</p>
              {lead.caller_phone && (
                <a href={`tel:${lead.caller_phone}`} className="text-sm text-[#a855f7] font-semibold flex items-center gap-1 mt-0.5">
                  <Phone className="w-3.5 h-3.5" /> {lead.caller_phone}
                </a>
              )}
            </div>
            {lead.caller_phone && (
              <a
                href={`tel:${lead.caller_phone}`}
                className="w-11 h-11 rounded-full flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #16a34a, #22c55e)" }}
              >
                <Phone className="w-5 h-5 text-white" />
              </a>
            )}
          </div>

          {/* Vehicle */}
          {vehicle && (
            <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2.5 border border-[#e5e7eb]">
              <Car className="w-4 h-4 text-[#a855f7]" />
              <div>
                <p className="text-sm font-bold text-[#111]">{vehicle}</p>
                {lead.service_requested && <p className="text-[11px] text-[#6b7280]">{lead.service_requested}</p>}
              </div>
            </div>
          )}

          {/* Voicemail transcript */}
          {lead.voicemail_transcript && (
            <div className="mt-3 bg-white rounded-xl px-3 py-2.5 border border-[#e5e7eb]">
              <p className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-wider mb-1">Voicemail</p>
              <p className="text-xs text-[#374151] leading-relaxed italic">"{lead.voicemail_transcript}"</p>
            </div>
          )}
        </div>

        {/* ── Price editor ── */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-[#111] uppercase tracking-wider flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-[#a855f7]" /> Quote Price
          </p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-[#a855f7]">$</span>
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="h-16 text-3xl font-extrabold text-[#111] text-center pl-10 pr-4 rounded-2xl border-2 border-[#e5e7eb] focus-visible:border-[#a855f7] focus-visible:ring-[#a855f7]/20"
              step="50"
            />
          </div>
          {meta.totalEstimate && price !== String(meta.totalEstimate) && (
            <p className="text-[10px] text-[#9ca3af] text-center">
              Original estimate: ${Number(meta.totalEstimate).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          )}
        </div>

        {/* ── Personal note (collapsible) ── */}
        <div>
          <button
            onClick={() => setShowNote(!showNote)}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#6b7280] hover:text-[#111] transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Add a personal note
            <ChevronDown className={cn("w-3 h-3 transition-transform", showNote && "rotate-180")} />
          </button>
          {showNote && (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Hey Marcus, I can get you in Thursday if that works..."
              className="mt-2 w-full h-20 text-sm text-[#111] border border-[#e5e7eb] rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-[#a855f7] placeholder:text-[#d1d5db]"
            />
          )}
        </div>

        {/* ── Send button ── */}
        {!sent ? (
          <Button
            onClick={handleSend}
            disabled={sending}
            className="w-full h-14 rounded-2xl text-base font-bold text-white shadow-lg"
            style={{ background: "linear-gradient(135deg, #2563eb, #a855f7)" }}
          >
            {sending ? (
              <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Sending...</>
            ) : (
              <><Send className="w-5 h-5 mr-2" /> Send Quote to Customer</>
            )}
          </Button>
        ) : (
          <div className="text-center py-6 space-y-3">
            <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center" style={{ background: "linear-gradient(135deg, #16a34a, #22c55e)" }}>
              <Check className="w-7 h-7 text-white" />
            </div>
            <p className="text-lg font-bold text-[#111]">Quote Sent!</p>
            <p className="text-sm text-[#6b7280]">
              {lead.caller_name || "Customer"} will receive an SMS
              {meta.email ? " and email" : ""} with the quote.
            </p>
            <div className="flex gap-3 justify-center pt-2">
              {lead.caller_phone && (
                <a
                  href={`tel:${lead.caller_phone}`}
                  className="flex items-center gap-1.5 text-sm font-semibold text-[#16a34a]"
                >
                  <Phone className="w-4 h-4" /> Call {lead.caller_name?.split(" ")[0] || "them"}
                </a>
              )}
              {lead.caller_phone && (
                <a
                  href={`sms:${lead.caller_phone}`}
                  className="flex items-center gap-1.5 text-sm font-semibold text-[#a855f7]"
                >
                  <MessageSquare className="w-4 h-4" /> Text
                </a>
              )}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="text-center pt-4 border-t border-[#f3f4f6]">
          <p className="text-[10px] text-[#d1d5db]">
            <span className="font-semibold text-[#9ca3af]">Restyle</span><span className="font-semibold text-[#a855f7]">Pro</span>
            <span className="mx-1">·</span>QuikText
          </p>
        </div>
      </div>
    </div>
  );
};

export default QuikTextApprove;
