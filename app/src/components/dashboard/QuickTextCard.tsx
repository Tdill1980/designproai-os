/**
 * QuickTextCard — dashboard tile for QuickText.
 *
 * Two states:
 *   - Active (shop has a provisioned Twilio sub-account):
 *       Shows their number, this-week hot lead count, missed-call count,
 *       link to /admin/quick-quote (QuikText tab).
 *   - Inactive (no sub-account):
 *       Upsell card → /quicktext.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getActiveUser } from "@/lib/auth-session";
import { PhoneIncoming, Zap, ArrowRight, MessageSquareText, Sparkles, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const db = supabase as any;

export const QuickTextCard = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-quicktext-status"],
    queryFn: async () => {
      // Resolve current user's shop_id
      const user = await getActiveUser();
      if (!user) return null;
      const { data: shop } = await db
        .from("shop_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!shop) return null;

      // Lookup their QuickText sub-account
      const { data: sub } = await db
        .from("shop_twilio_subaccounts")
        .select("phone_number, is_active")
        .eq("shop_id", shop.id)
        .maybeSingle();

      if (!sub || sub.is_active !== true) {
        return { active: false, shopId: shop.id };
      }

      // Last 7d metrics
      const since = new Date();
      since.setDate(since.getDate() - 7);

      const { data: leadRows } = await db
        .from("leads")
        .select("id, source, is_hot, sms_sent_to_customer")
        .eq("shop_id", shop.id)
        .gte("created_at", since.toISOString());

      const leads = (leadRows || []) as any[];
      return {
        active: true,
        shopId: shop.id,
        phoneNumber: sub.phone_number,
        weekTotal: leads.length,
        weekHot: leads.filter((l) => l.is_hot).length,
        weekAutoTexted: leads.filter((l) => l.sms_sent_to_customer).length,
      };
    },
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-[#48484a] bg-rp-surface p-5 h-full">
        <Skeleton className="h-32 w-full bg-rp-elevated" />
      </div>
    );
  }

  // ── Inactive (upsell) ────────────────────────────────────────
  if (!data?.active) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-rp-surface to-purple-500/5 p-5 h-full flex flex-col">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center">
              <Zap className="w-4 h-4 text-cyan-300" />
            </div>
            <h3 className="text-sm font-bold text-white uppercase tracking-[0.1em]">QuickText</h3>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/quicktext"
                    aria-label="What is QuickText?"
                    className="inline-flex items-center justify-center w-4 h-4 rounded-full text-cyan-300/70 hover:text-cyan-200 transition"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[280px] text-xs leading-relaxed">
                  <p className="font-bold text-cyan-300 mb-1">Never Miss a Lead</p>
                  <p className="text-white/85">
                    A dedicated business number that rings your cell first. If you miss it,
                    AI transcribes the voicemail and auto-texts the caller a branded
                    QuickQuote link — turning missed calls into booked wraps.
                  </p>
                  <p className="mt-1.5 text-white/60">
                    Add-on: Basic $49/mo · Pro $99/mo (AI receptionist). Click for details.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-cyan-100 bg-cyan-500/30">
            Activate
          </span>
        </div>
        <p className="text-xs text-white/75 mb-3 font-inter leading-relaxed">
          Never miss a lead. AI captures missed calls + texts, auto-replies
          with a QuickQuote link, alerts you on your cell.
        </p>
        <div className="flex-1" />
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-3 h-3 text-emerald-300" />
          <span className="text-[11px] text-emerald-300 font-semibold">
            One booked wrap pays for the year
          </span>
        </div>
        <Button asChild size="sm" className="bg-gradient-to-r from-cyan-400 to-purple-500 hover:opacity-90 text-white font-semibold w-full h-9 text-xs">
          <Link to="/quicktext">
            Add to your plan — from $49/mo
            <ArrowRight className="w-3 h-3 ml-1" />
          </Link>
        </Button>
      </div>
    );
  }

  // ── Active (status + metrics) ────────────────────────────────
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#48484a] bg-rp-surface p-5 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-rp-elevated border border-[#48484a] flex items-center justify-center">
            <Zap className="w-4 h-4 text-cyan-400" />
          </div>
          <h3 className="text-sm font-bold text-white uppercase tracking-[0.1em]">QuickText</h3>
        </div>
        {data.weekHot > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-white bg-gradient-to-r from-red-500 to-orange-500">
            {data.weekHot} hot
          </span>
        )}
      </div>

      {/* Phone number — copyable */}
      <button
        onClick={() => {
          if (data.phoneNumber) {
            navigator.clipboard.writeText(data.phoneNumber);
          }
        }}
        className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-rp-elevated border border-[#48484a] mb-3 hover:border-cyan-400/40 transition group"
        title="Copy your QuickText number"
      >
        <PhoneIncoming className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-sm font-mono text-white font-semibold flex-1 text-left">
          {data.phoneNumber}
        </span>
        <span className="text-[9px] text-white/50 group-hover:text-cyan-300 uppercase tracking-wider">
          Copy
        </span>
      </button>

      {/* Last 7d metrics */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="text-center px-2 py-2 rounded-md bg-rp-elevated border border-[#48484a]">
          <div className="text-lg font-bold text-white">{data.weekTotal}</div>
          <div className="text-[9px] text-white/60 uppercase tracking-wider">Leads / 7d</div>
        </div>
        <div className="text-center px-2 py-2 rounded-md bg-rp-elevated border border-[#48484a]">
          <div className="text-lg font-bold text-red-400">{data.weekHot}</div>
          <div className="text-[9px] text-white/60 uppercase tracking-wider">Hot</div>
        </div>
        <div className="text-center px-2 py-2 rounded-md bg-rp-elevated border border-[#48484a]">
          <div className="text-lg font-bold text-emerald-400">{data.weekAutoTexted}</div>
          <div className="text-[9px] text-white/60 uppercase tracking-wider">Auto-texted</div>
        </div>
      </div>

      <div className="mt-auto pt-3 border-t border-[#48484a] flex gap-2">
        <Button asChild variant="ghost" size="sm" className="flex-1 justify-between text-white/80 hover:text-white hover:bg-rp-elevated h-8 text-xs font-semibold">
          <Link to="/quotes">
            Open inbox
            <ArrowRight className="w-3 h-3" />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="text-white/60 hover:text-white hover:bg-rp-elevated h-8 text-xs">
          <Link to="/quicktext">
            <MessageSquareText className="w-3 h-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
};
