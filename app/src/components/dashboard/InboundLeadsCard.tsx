import { Link } from "react-router-dom";
import { Inbox, ArrowRight, Phone, Mail, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useInboundLeads } from "@/hooks/useInboundLeads";

const formatRelative = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / (60 * 1000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

interface InboundLeadsCardProps {
  /** White UI variant (for customer-facing white pages like /quotes). */
  light?: boolean;
}

export const InboundLeadsCard = ({ light = false }: InboundLeadsCardProps) => {
  const { data: leads, isLoading } = useInboundLeads();
  const count = leads?.length || 0;
  const top3 = leads?.slice(0, 3) || [];

  const c = light
    ? {
        card: "border-gray-200 bg-white",
        iconTile: "bg-blue-50 border-blue-200",
        icon: "text-blue-600",
        title: "text-gray-900",
        badge: "text-white bg-gradient-to-r from-[#3b82f6] to-[#ec4899]",
        sub: "text-gray-500",
        skeleton: "bg-gray-100",
        row: "bg-gray-50 border-gray-200 hover:border-gray-300",
        name: "text-gray-900",
        meta: "text-gray-500",
        action: "border-gray-200 text-gray-600 hover:text-white hover:bg-gradient-to-r hover:from-[#3b82f6] hover:to-[#ec4899] hover:border-transparent",
        divider: "border-gray-200",
        ghost: "text-gray-600 hover:text-gray-900 hover:bg-gray-100",
      }
    : {
        card: "border-[#48484a] bg-rp-surface",
        iconTile: "bg-rp-elevated border-[#48484a]",
        icon: "text-[#60A5FA]",
        title: "text-white",
        badge: "text-white bg-gradient-rp-pop",
        sub: "text-white/75",
        skeleton: "bg-rp-elevated",
        row: "bg-rp-elevated border-[#48484a] hover:border-white/20",
        name: "text-white",
        meta: "text-white/70",
        action: "border-[#48484a] text-white/80 hover:text-white hover:bg-gradient-rp-pop hover:border-transparent",
        divider: "border-[#48484a]",
        ghost: "text-white/80 hover:text-white hover:bg-rp-elevated",
      };

  return (
    <div className={`relative overflow-hidden rounded-2xl border p-5 h-full flex flex-col ${c.card}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-md border flex items-center justify-center ${c.iconTile}`}>
            <Inbox className={`w-4 h-4 ${c.icon}`} />
          </div>
          <h3 className={`text-sm font-bold uppercase tracking-[0.1em] ${c.title}`}>
            Inbound Requests
          </h3>
        </div>
        {!isLoading && count > 0 && (
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${c.badge}`}>
            {count} new
          </span>
        )}
      </div>

      <p className={`text-xs mb-3 font-inter ${c.sub}`}>
        Leads that haven't been turned into a priced quote yet.
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
            <div className="text-2xl mb-1">📬</div>
            <div className={`text-xs font-inter ${c.sub}`}>No new inbound requests.</div>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 flex-1 font-inter">
          {top3.map((lead) => (
            <div
              key={lead.id}
              className={`flex items-center gap-2 px-2 py-2 rounded-md border transition ${c.row}`}
            >
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-semibold truncate ${c.name}`}>
                  {lead.name || lead.email || lead.phone || "Anonymous lead"}
                </div>
                <div className={`text-[10px] truncate flex items-center gap-1 ${c.meta}`}>
                  {lead.vehicle && (
                    <>
                      <Car className="w-2.5 h-2.5" />
                      <span className="truncate">{lead.vehicle}</span>
                      <span>·</span>
                    </>
                  )}
                  <span>{formatRelative(lead.created_at)}</span>
                  {lead.source && (
                    <>
                      <span>·</span>
                      <span className="uppercase text-[9px]">{lead.source}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {lead.phone && (
                  <a
                    href={`tel:${lead.phone}`}
                    className={`w-7 h-7 rounded-md border flex items-center justify-center transition ${c.action}`}
                    aria-label="Call"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </a>
                )}
                {lead.email && (
                  <a
                    href={`mailto:${lead.email}`}
                    className={`w-7 h-7 rounded-md border flex items-center justify-center transition ${c.action}`}
                    aria-label="Email"
                  >
                    <Mail className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={`mt-3 pt-3 border-t ${c.divider}`}>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className={`w-full justify-between h-8 text-xs font-semibold ${c.ghost}`}
        >
          <Link to="/quick-quote">
            Turn into a quote
            <ArrowRight className="w-3 h-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
};
