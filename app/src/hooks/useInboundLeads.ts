import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Inbound leads = quote requests that haven't been priced yet.
 * These come from QuickText, contact forms, or manual shop entry.
 *
 * Source: public.leads table (RLS-scoped to current shop).
 */

export interface InboundLeadRow {
  id: string;
  created_at: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  vehicle: string | null;
  message: string | null;
  source: string | null; // quicktext / web / manual
  status: string | null; // new / contacted / quoted / lost
}

const db = supabase as any;

export const useInboundLeads = () => {
  return useQuery<InboundLeadRow[]>({
    queryKey: ["dashboard-inbound-leads"],
    queryFn: async () => {
      const { data, error } = await db
        .from("leads")
        .select(
          "id, created_at, caller_name, caller_phone, vehicle_year, vehicle_make, vehicle_model, service_requested, voicemail_transcript, source, status"
        )
        .or("status.is.null,status.eq.new,status.eq.contacted")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        console.warn("Inbound leads query failed:", error.message);
        return [];
      }

      return ((data as any[]) || []).map((row) => ({
        id: row.id,
        created_at: row.created_at,
        name: row.caller_name ?? null,
        email: null,
        phone: row.caller_phone ?? null,
        vehicle: [row.vehicle_year, row.vehicle_make, row.vehicle_model]
          .filter(Boolean)
          .join(" ") || null,
        message: row.service_requested ?? row.voicemail_transcript ?? null,
        source: row.source ?? null,
        status: row.status ?? null,
      })) as InboundLeadRow[];
    },
    staleTime: 60 * 1000,
    retry: false,
  });
};
