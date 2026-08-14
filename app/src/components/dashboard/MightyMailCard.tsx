import { Link } from "react-router-dom";
import { Mail, MessageSquare, ArrowRight, Flame, Send, Eye, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useColdQuotes } from "@/hooks/useColdQuotes";
import { useEmailCampaignMetrics } from "@/hooks/useEmailCampaignMetrics";
import { ToolWordmark } from "./ToolWordmark";

const formatDollars = (cents: number | null | undefined) => {
  if (!cents && cents !== 0) return "$—";
  const dollars = cents > 1000 ? cents / 100 : cents;
  return `$${Math.round(dollars).toLocaleString()}`;
};

const formatRelative = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

interface MightyMailCardProps {
  /** White UI variant (for customer-facing white pages like /quotes). */
  light?: boolean;
}

export const MightyMailCard = ({ light = false }: MightyMailCardProps) => {
  const { data: quotes, isLoading } = useColdQuotes();
  const { data: campaignMetrics } = useEmailCampaignMetrics();
  const coldCount = quotes?.length || 0;
  const top3 = quotes?.slice(0, 3) || [];

  const c = light
    ? {
        card: "border-gray-200 bg-white",
        iconTile: "bg-blue-50 border-blue-200",
        icon: "text-blue-600",
        badge: "text-white bg-gradient-to-r from-[#3b82f6] to-[#ec4899]",
        sub: "text-gray-500",
        skeleton: "bg-gray-100",
        row: "bg-gray-50 border-gray-200 hover:border-gray-300",
        name: "text-gray-900",
        meta: "text-gray-500",
        actionOn: "border-gray-200 text-gray-600 hover:text-white hover:bg-gradient-to-r hover:from-[#3b82f6] hover:to-[#ec4899] hover:border-transparent",
        actionOff: "border-gray-200 text-gray-300 pointer-events-none",
        divider: "border-gray-200",
        metricLabel: "text-gray-400",
        metricTile: "bg-gray-50 border-gray-200",
        metricNum: "text-gray-900",
        bar: "bg-gray-200",
        ghost: "text-gray-600 hover:text-gray-900 hover:bg-gray-100",
      }
    : {
        card: "border-[#48484a] bg-rp-surface",
        iconTile: "bg-rp-elevated border-[#48484a]",
        icon: "text-[#60A5FA]",
        badge: "text-white bg-gradient-rp-pop",
        sub: "text-white/75",
        skeleton: "bg-rp-elevated",
        row: "bg-rp-elevated border-[#48484a] hover:border-white/20",
        name: "text-white",
        meta: "text-white/70",
        actionOn: "border-[#48484a] text-white/80 hover:text-white hover:bg-gradient-rp-pop hover:border-transparent",
        actionOff: "border-[#48484a] text-white/45 pointer-events-none",
        divider: "border-[#48484a]",
        metricLabel: "text-white/40",
        metricTile: "bg-[#1c1c1e] border-[#3a3a3c]",
        metricNum: "text-white",
        bar: "bg-[#2a2a2e]",
        ghost: "text-white/80 hover:text-white hover:bg-rp-elevated",
      };

  return (
    <div className={`relative overflow-hidden rounded-2xl border p-5 h-full flex flex-col ${c.card}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <Link
          to="/email-templates"
          className="flex items-center gap-2 hover:opacity-80 transition"
          aria-label="Open MightyMail email template library"
        >
          <div className={`w-8 h-8 rounded-md border flex items-center justify-center ${c.iconTile}`}>
            <Flame className={`w-4 h-4 ${c.icon}`} />
          </div>
          <ToolWordmark toolKey="mightymail" size="lg" />
        </Link>
        {!isLoading && coldCount > 0 && (
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${c.badge}`}>
            {coldCount} cold
          </span>
        )}
      </div>

      <p className={`text-xs mb-3 font-inter ${c.sub}`}>
        Priced quotes with no follow-up in the last 48 hours.
      </p>

      {isLoading ? (
        <div className="space-y-2 flex-1">
          <Skeleton className={`h-12 w-full ${c.skeleton}`} />
          <Skeleton className={`h-12 w-full ${c.skeleton}`} />
          <Skeleton className={`h-12 w-full ${c.skeleton}`} />
        </div>
      ) : top3.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-6 text-center">
          <div>
            <div className="text-2xl mb-1">✨</div>
            <div className={`text-xs font-inter ${c.sub}`}>
              All caught up — no cold quotes.
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 flex-1 font-inter">
          {top3.map((q) => {
            const vehicle = [q.vehicle_year, q.vehicle_make, q.vehicle_model]
              .filter(Boolean)
              .join(" ");
            const canEmail = !!q.customers?.email;
            const canText = !!q.customers?.phone;
            return (
              <div
                key={q.id}
                className={`flex items-center gap-2 px-2 py-2 rounded-md border transition ${c.row}`}
              >
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-semibold truncate ${c.name}`}>
                    {q.customers?.name || "Unknown customer"}
                  </div>
                  <div className={`text-[10px] truncate ${c.meta}`}>
                    {vehicle || "—"} · {formatDollars(q.customer_total)} ·{" "}
                    {formatRelative(q.created_at)}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Link
                    to={`/quotes?id=${q.id}`}
                    className={`w-7 h-7 rounded-md flex items-center justify-center border transition ${
                      canEmail ? c.actionOn : c.actionOff
                    }`}
                    aria-label="Email follow-up"
                  >
                    <Mail className="w-3.5 h-3.5" />
                  </Link>
                  <Link
                    to={`/quotes?id=${q.id}&action=sms`}
                    className={`w-7 h-7 rounded-md flex items-center justify-center border transition ${
                      canText ? c.actionOn : c.actionOff
                    }`}
                    aria-label="SMS follow-up"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Email campaign metrics (last 30 days) */}
      {campaignMetrics && (
        <div className={`mt-3 pt-3 border-t ${c.divider}`}>
          <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${c.metricLabel}`}>
            Campaign performance · 30d
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className={`rounded-md border px-2 py-1.5 text-center ${c.metricTile}`}>
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <Send className="w-3 h-3 text-[#3b82f6]" />
                <span className={`text-sm font-bold ${c.metricNum}`}>{campaignMetrics.totalSent.toLocaleString()}</span>
              </div>
              <div className={`text-[9px] font-bold uppercase tracking-wider ${c.metricLabel}`}>Sent</div>
            </div>
            <div className={`rounded-md border px-2 py-1.5 ${c.metricTile}`}>
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <Eye className="w-3 h-3 text-[#10b981]" />
                <span className="text-sm font-bold text-[#10b981]">{campaignMetrics.openRate}%</span>
              </div>
              <div className={`h-1 rounded-full overflow-hidden mt-0.5 ${c.bar}`}>
                <div
                  className="h-full rounded-full bg-[#10b981] transition-all"
                  style={{ width: `${Math.min(100, campaignMetrics.openRate)}%` }}
                />
              </div>
              <div className={`text-[9px] font-bold uppercase tracking-wider mt-0.5 text-center ${c.metricLabel}`}>Opens</div>
            </div>
            <div className={`rounded-md border px-2 py-1.5 ${c.metricTile}`}>
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <MousePointerClick className="w-3 h-3 text-[#ec4899]" />
                <span className="text-sm font-bold text-[#ec4899]">{campaignMetrics.clickRate}%</span>
              </div>
              <div className={`h-1 rounded-full overflow-hidden mt-0.5 ${c.bar}`}>
                <div
                  className="h-full rounded-full bg-[#ec4899] transition-all"
                  style={{ width: `${Math.min(100, campaignMetrics.clickRate * 2)}%` }}
                />
              </div>
              <div className={`text-[9px] font-bold uppercase tracking-wider mt-0.5 text-center ${c.metricLabel}`}>Clicks</div>
            </div>
          </div>
        </div>
      )}

      <div className={`mt-3 pt-3 border-t grid grid-cols-2 gap-2 ${c.divider}`}>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className={`justify-between h-8 text-xs font-semibold ${c.ghost}`}
        >
          <Link to="/email-templates">
            Email Library
            <ArrowRight className="w-3 h-3" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className={`justify-between h-8 text-xs font-semibold ${c.ghost}`}
        >
          <Link to="/quotes">
            All Quotes
            <ArrowRight className="w-3 h-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
};
