/**
 * useEmailCampaignMetrics — aggregates email campaign performance
 * for the last 30 days. Used by MightyMailCard on the dashboard.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CampaignMetrics {
  campaignCount: number;
  totalSent: number;
  totalOpened: number;
  totalClicked: number;
  openRate: number;
  clickRate: number;
}

export const useEmailCampaignMetrics = () => {
  return useQuery<CampaignMetrics | null>({
    queryKey: ["dashboard-email-campaign-metrics"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;

      const since = new Date();
      since.setDate(since.getDate() - 30);
      since.setHours(0, 0, 0, 0);

      const { data, error } = await (supabase as any)
        .from("email_campaigns")
        .select("total_sent, total_opened, total_clicked")
        .eq("status", "sent")
        .gte("sent_at", since.toISOString());

      if (error || !data || data.length === 0) return null;

      let totalSent = 0;
      let totalOpened = 0;
      let totalClicked = 0;

      data.forEach((c: any) => {
        totalSent += c.total_sent || 0;
        totalOpened += c.total_opened || 0;
        totalClicked += c.total_clicked || 0;
      });

      if (totalSent === 0) return null;

      return {
        campaignCount: data.length,
        totalSent,
        totalOpened,
        totalClicked,
        openRate: Math.round((totalOpened / totalSent) * 1000) / 10,
        clickRate: Math.round((totalClicked / totalSent) * 1000) / 10,
      };
    },
    staleTime: 120_000,
    retry: false,
  });
};
