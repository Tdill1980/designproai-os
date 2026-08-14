/**
 * useWpwAnalytics — fetches WPW's cross-project analytics via the
 * RestylePro `wpw-analytics-proxy` edge function. The proxy injects
 * the shared secret server-side so the key never touches the browser.
 *
 * Returns the WPW analytics-dashboard payload mapped into shapes the
 * existing BusinessMetricsCard / AnalyticsGraphCard / useLatestQuotes
 * components already consume.
 *
 * IMPORTANT: only call this for WPW tenants. Gate with useIsWpwTenant
 * so non-WPW shops don't fire pointless cross-project requests.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export type WpwRange = 1 | 7 | 30 | 90 | 365;

export interface WpwMetrics {
  revenue: number;
  order_count: number;
  total_quotes: number;
  sent_count: number;
  conversion_rate: number;
  trend_label: string;
  trend_positive: boolean;
}

export interface WpwDailyPoint {
  iso: string;
  dollars: number;
  quote_count: number;
}

export interface WpwConvertedOrder {
  id: string;
  quote_number: string | null;
  customer_name: string | null;
  product: string | null;
  customer_total: number;
  created_at: string;
}

export interface WpwLatestQuote {
  id: string;
  quote_number: string | null;
  created_at: string;
  customer_total: number;
  status: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  customer: { name: string | null; email: string | null; phone: string | null };
}

export interface WpwAnalyticsPayload {
  ok: boolean;
  range_days: number;
  shop_slug: string;
  metrics: WpwMetrics;
  daily: WpwDailyPoint[];
  converted_orders: WpwConvertedOrder[];
  latest_quotes: WpwLatestQuote[];
}

export const useWpwAnalytics = (
  range: WpwRange,
  options: { enabled?: boolean; shopSlug?: string } = {},
) => {
  const { enabled = true, shopSlug = "wpw" } = options;
  return useQuery<WpwAnalyticsPayload | null>({
    queryKey: ["wpw-analytics", range, shopSlug],
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async () => {
      // supabase.functions.invoke routes GET query params through the body,
      // which the proxy ignores — so call the function URL directly with
      // both the user JWT (for verify_jwt) AND the apikey header that the
      // Supabase API gateway requires before the function ever runs.
      const projectUrl = SUPABASE_URL || (supabase as any).supabaseUrl;
      if (!projectUrl || !SUPABASE_ANON_KEY) {
        console.warn("[useWpwAnalytics] missing Supabase URL or anon key");
        return null;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return null;

      const url = `${projectUrl}/functions/v1/wpw-analytics-proxy?range=${range}&shopSlug=${encodeURIComponent(shopSlug)}`;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
            Accept: "application/json",
          },
        });
      } catch (err) {
        console.warn("[useWpwAnalytics] network error:", (err as Error)?.message);
        return null;
      }
      if (!res.ok) {
        console.warn("[useWpwAnalytics] proxy returned", res.status);
        return null;
      }
      const body = (await res.json().catch(() => null)) as WpwAnalyticsPayload | null;
      return body?.ok ? body : null;
    },
  });
};
