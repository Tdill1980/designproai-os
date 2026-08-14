import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type EmailDeliveryStatus = {
  status: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  last_event_type: string | null;
  last_event_at: string | null;
};

/**
 * Fetch the latest estimate-email delivery status for a set of quote
 * ids. Returns a Map keyed by quote_id. Resolves to an empty Map if
 * the input list is empty or while loading.
 *
 * Source of truth: public.email_log (most recent row per quote_id
 * with email_type='estimate'). Updates flow in via the resend-webhook
 * edge function (email.delivered / email.opened / email.bounced /
 * email.complained).
 */
export function useEmailDeliveryStatus(quoteIds: string[]) {
  const ids = quoteIds.filter(Boolean);
  const key = ids.slice().sort().join(",");

  return useQuery<Map<string, EmailDeliveryStatus>>({
    queryKey: ["email-delivery-status", key],
    enabled: ids.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_log")
        .select(
          "quote_id, status, sent_at, delivered_at, opened_at, bounced_at, complained_at, last_event_type, last_event_at",
        )
        .in("quote_id", ids)
        .eq("email_type", "estimate")
        .order("sent_at", { ascending: false });
      if (error) throw error;
      const map = new Map<string, EmailDeliveryStatus>();
      for (const row of data ?? []) {
        if (!row.quote_id) continue;
        // First row per quote_id wins (already ordered desc by sent_at).
        if (!map.has(row.quote_id)) {
          map.set(row.quote_id, {
            status: row.status,
            sent_at: row.sent_at,
            delivered_at: row.delivered_at,
            opened_at: row.opened_at,
            bounced_at: row.bounced_at,
            complained_at: row.complained_at,
            last_event_type: row.last_event_type,
            last_event_at: row.last_event_at,
          });
        }
      }
      return map;
    },
  });
}

/**
 * Reduce a delivery status row into a single user-facing label +
 * tone. Priority: bounced/complained > opened > delivered > sent.
 */
export function summarizeDeliveryStatus(s: EmailDeliveryStatus | undefined | null) {
  if (!s) return null;
  if (s.bounced_at) {
    return { label: "Bounced", tone: "danger" as const, at: s.bounced_at };
  }
  if (s.complained_at) {
    return { label: "Complained", tone: "danger" as const, at: s.complained_at };
  }
  if (s.opened_at) {
    return { label: "Opened", tone: "success" as const, at: s.opened_at };
  }
  if (s.delivered_at) {
    return { label: "Delivered", tone: "info" as const, at: s.delivered_at };
  }
  if (s.sent_at) {
    return { label: "Sent", tone: "muted" as const, at: s.sent_at };
  }
  return null;
}
