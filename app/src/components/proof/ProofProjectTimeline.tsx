/**
 * ProofProjectTimeline
 *
 * Full audit trail timeline for a proof, fetching ALL proof_events.
 * Renders as a vertical timeline with colored icons per event type.
 * Light themed for ApprovePro.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Clock, Send, Eye, CheckCircle2, XCircle, RotateCw,
  LifeBuoy, Upload, Sparkles, MessageSquare, FileText,
  Shield, AlertTriangle, Loader2, History,
} from "lucide-react";

interface ProofEvent {
  id: string;
  event_type: string;
  actor_role: string;
  actor_user_id: string | null;
  payload: Record<string, any>;
  created_at: string;
}

interface ProofProjectTimelineProps {
  proofId: string;
  refreshKey?: number;
}

const EVENT_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: typeof Send }> = {
  created:             { label: "Proof created",         color: "text-blue-600",   bgColor: "bg-blue-50",     icon: FileText },
  sent:                { label: "Sent to customer",      color: "text-blue-600",   bgColor: "bg-blue-50",     icon: Send },
  resent:              { label: "Resent to customer",     color: "text-blue-600",   bgColor: "bg-blue-50",     icon: Send },
  viewed:              { label: "Customer viewed",        color: "text-cyan-600",   bgColor: "bg-cyan-50",     icon: Eye },
  signed:              { label: "Customer approved",      color: "text-green-600",  bgColor: "bg-green-50",    icon: CheckCircle2 },
  declined:            { label: "Customer declined",      color: "text-red-600",    bgColor: "bg-red-50",      icon: XCircle },
  revision_requested:  { label: "Revision requested",     color: "text-purple-600", bgColor: "bg-purple-50",   icon: RotateCw },
  version_saved:       { label: "New version uploaded",    color: "text-indigo-600", bgColor: "bg-indigo-50",   icon: Upload },
  version_reverted:    { label: "Version reverted",       color: "text-amber-600",  bgColor: "bg-amber-50",    icon: RotateCw },
  ai_revision_started: { label: "AI revision started",    color: "text-purple-600", bgColor: "bg-purple-50",   icon: Sparkles },
  ai_revision_done:    { label: "AI revision completed",  color: "text-purple-600", bgColor: "bg-purple-50",   icon: Sparkles },
  ai_revision_failed:  { label: "AI revision failed",     color: "text-red-600",    bgColor: "bg-red-50",      icon: AlertTriangle },
  shop_reply:          { label: "Shop replied",           color: "text-blue-600",   bgColor: "bg-blue-50",     icon: MessageSquare },
  escalated_shop:      { label: "Escalated to shop",     color: "text-amber-600",  bgColor: "bg-amber-50",    icon: LifeBuoy },
  escalated_support:   { label: "Escalated to support",  color: "text-amber-600",  bgColor: "bg-amber-50",    icon: LifeBuoy },
  revoked:             { label: "Proof revoked",         color: "text-red-600",    bgColor: "bg-red-50",      icon: Shield },
  delivery_failed:     { label: "Email delivery failed", color: "text-red-600",    bgColor: "bg-red-50",      icon: AlertTriangle },
};

const DEFAULT_CONFIG = { label: "Event", color: "text-gray-500", bgColor: "bg-gray-50", icon: Clock };

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = 60_000;
  const h = 60 * m;
  const day = 24 * h;
  if (diff < m) return "just now";
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < day) return `${Math.floor(diff / h)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return formatTimestamp(iso);
}

function eventDetail(ev: ProofEvent): string | null {
  const p = ev.payload || {};
  if (p.message) return p.message;
  if (p.change_request) return p.change_request;
  if (p.decline_reason || p.reason) return p.decline_reason || p.reason;
  if (p.shop_message) return p.shop_message;
  if (p.sent_to) return `To: ${p.sent_to}`;
  if (p.version_number) return `Version ${p.version_number}`;
  if (p.prompt_text) return `Prompt: "${p.prompt_text}"`;
  return null;
}

function actorLabel(role: string): string {
  switch (role) {
    case "shop": return "Shop";
    case "customer": return "Customer";
    case "support": return "Support";
    case "system": return "System";
    default: return role;
  }
}

export const ProofProjectTimeline = ({ proofId, refreshKey }: ProofProjectTimelineProps) => {
  const [events, setEvents] = useState<ProofEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!proofId) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("proof_events" as any)
        .select("id, event_type, actor_role, actor_user_id, payload, created_at")
        .eq("proof_id", proofId)
        .order("created_at", { ascending: false })
        .limit(100);
      setEvents((data || []) as unknown as ProofEvent[]);
      setLoading(false);
    })();
  }, [proofId, refreshKey]);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading timeline...
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-[#ec4899]" />
        <h3 className="text-sm font-semibold text-gray-900">Project Timeline</h3>
        <span className="text-[10px] text-gray-400 ml-auto">{events.length} events</span>
      </div>

      {events.length === 0 ? (
        <p className="text-xs text-gray-400 italic py-2">No events recorded yet.</p>
      ) : (
        <div className="relative space-y-0 max-h-[400px] overflow-y-auto pr-1">
          <div className="absolute left-[15px] top-4 bottom-4 w-px bg-gray-200" />

          {events.map((ev, i) => {
            const cfg = EVENT_CONFIG[ev.event_type] || DEFAULT_CONFIG;
            const Icon = cfg.icon;
            const detail = eventDetail(ev);

            return (
              <div key={ev.id || i} className="relative flex gap-3 py-2">
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 border border-gray-200",
                    cfg.bgColor,
                  )}
                >
                  <Icon className={cn("w-3.5 h-3.5", cfg.color)} />
                </div>

                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("text-xs font-semibold", cfg.color)}>
                      {cfg.label}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {actorLabel(ev.actor_role)}
                    </span>
                    <span className="text-[10px] text-gray-400 ml-auto shrink-0" title={formatRelative(ev.created_at)}>
                      {formatTimestamp(ev.created_at)}
                    </span>
                  </div>
                  {detail && (
                    <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">
                      {detail}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
