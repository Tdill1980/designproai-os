/**
 * CustomerProofStatusCard
 *
 * Customer-facing ApprovePro status card for the RestyleDashboard. Shows
 * the logged-in user the status of design jobs where THEY are the customer
 * (matched by email via the customer_proof_status() SECURITY DEFINER fn).
 *
 * Renders nothing when the user isn't a customer on any proof, so it only
 * appears for people who actually have a design job in flight.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardSignature, Clock, RotateCw, CheckCircle2, XCircle,
  Eye, ArrowRight, Loader2, Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CustomerProof {
  id: string;
  design_name: string | null;
  customer_name: string | null;
  status: string;
  updated_at: string;
  sent_at: string | null;
  signed_at: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  view_token: string | null;
  order_ref: string | null;
  needs_instructions: boolean | null;
  instructions_requested_at: string | null;
}

// Customer-friendly status — never expose internal workflow jargon.
const STATUS_VIEW: Record<string, { label: string; color: string; icon: typeof Eye; linkable: boolean }> = {
  draft:             { label: "In design",            color: "bg-gray-100 text-gray-700 border-gray-200",   icon: ClipboardSignature, linkable: false },
  sent:              { label: "Ready for your review", color: "bg-blue-100 text-blue-700 border-blue-200",   icon: Eye,         linkable: true },
  viewed:            { label: "Ready for your review", color: "bg-blue-100 text-blue-700 border-blue-200",   icon: Eye,         linkable: true },
  revising:          { label: "Revisions in progress", color: "bg-purple-100 text-purple-700 border-purple-200", icon: RotateCw, linkable: true },
  escalated_shop:    { label: "Revisions in progress", color: "bg-purple-100 text-purple-700 border-purple-200", icon: RotateCw, linkable: true },
  escalated_support: { label: "Revisions in progress", color: "bg-purple-100 text-purple-700 border-purple-200", icon: RotateCw, linkable: true },
  delivery_failed:   { label: "In design",            color: "bg-gray-100 text-gray-700 border-gray-200",   icon: ClipboardSignature, linkable: false },
  approved:          { label: "Approved",             color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2, linkable: true },
  declined:          { label: "Declined",             color: "bg-red-100 text-red-700 border-red-200",     icon: XCircle,     linkable: true },
  expired:           { label: "Expired",              color: "bg-gray-100 text-gray-500 border-gray-200",   icon: Clock,       linkable: false },
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

export const CustomerProofStatusCard = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["customer_proof_status"],
    queryFn: async (): Promise<CustomerProof[]> => {
      const { data, error } = await supabase.rpc("customer_proof_status" as any);
      if (error) throw error;
      return (data || []) as CustomerProof[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // Only render for users who actually have a design job.
  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  const hasFresh = data.some(
    (p) => (p.status === "sent" || p.status === "viewed") && p.view_token,
  );

  return (
    <Card className="relative overflow-hidden border-gray-200 bg-white text-gray-900">
      {hasFresh && (
        <span className="absolute top-2 right-2 z-10 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
        </span>
      )}
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <img
            src="/sproket-rocket-logo.png"
            alt="RestylePro"
            className="w-9 h-9 object-contain shrink-0"
          />
          <div>
            <h3 className="font-semibold text-base text-gray-900">
              My Design Proofs<span className="text-gray-500 text-xs ml-0.5">&trade;</span>
            </h3>
            <p className="text-[11px] text-gray-500">
              Track where each of your design jobs stands
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          {data.map((p) => {
            const cfg = STATUS_VIEW[p.status] || STATUS_VIEW.draft;
            const needs = !!p.needs_instructions;
            const Icon = needs ? Mail : cfg.icon;
            const label = needs ? "Send your details" : cfg.label;
            const color = needs ? "bg-amber-100 text-amber-800 border-amber-300" : cfg.color;
            const vehicle = [p.vehicle_year, p.vehicle_make, p.vehicle_model].filter(Boolean).join(" ");
            const canOpen = cfg.linkable && !!p.view_token;
            const inner = (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[12px] font-semibold truncate">
                      {p.design_name || "Vehicle Wrap Design"}
                    </p>
                    {p.order_ref && (
                      <span className="text-[9px] text-gray-500 font-mono shrink-0">
                        #{p.order_ref}
                      </span>
                    )}
                  </div>
                  {needs ? (
                    <p className="text-[10px] text-amber-700 truncate">
                      We need your project details & artwork — reply to our email to start your design.
                    </p>
                  ) : vehicle ? (
                    <p className="text-[10px] text-gray-500 truncate">{vehicle}</p>
                  ) : null}
                </div>
                <Badge variant="outline" className={cn("text-[9px] h-4 px-1 shrink-0", color)}>
                  <Icon className="w-2.5 h-2.5 mr-0.5" />
                  {label}
                </Badge>
                <span className="text-[10px] text-gray-500 shrink-0 tabular-nums">
                  {relativeTime(p.updated_at)}
                </span>
                {canOpen && <ArrowRight className="w-3 h-3 text-blue-500 shrink-0" />}
              </div>
            );
            return canOpen ? (
              <a
                key={p.id}
                href={`/proof/${p.view_token}`}
                className="block rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors p-2"
              >
                {inner}
              </a>
            ) : (
              <div
                key={p.id}
                className="rounded-md border border-gray-200 bg-gray-50 p-2"
              >
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};
