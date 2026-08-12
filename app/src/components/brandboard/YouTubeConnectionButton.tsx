import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

interface YouTubeConnection {
  platform: "youtube";
  display_name: string | null;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
  last_error: string | null;
}

/**
 * BrandBoard is a publishing/review surface, not an OAuth authority.
 *
 * This header control opens the one canonical Connections hub where Google,
 * YouTube, Meta/Ads Manager, Canva, Klaviyo, LinkedIn and X are managed.
 * The YouTube status read is retained only to provide a useful connected-state
 * indicator without ever pulling OAuth tokens into the browser.
 */
export default function YouTubeConnectionButton() {
  const { currentShop, isShopAdmin } = useOrganization();

  const youtubeConnection = useQuery({
    queryKey: ["brandboard-youtube-connection", currentShop?.id],
    enabled: !!currentShop?.id,
    queryFn: async (): Promise<YouTubeConnection | null> => {
      if (!currentShop) return null;
      const { data, error } = await supabase
        .from("tenant_site_connections")
        .select("platform, display_name, is_active, metadata, last_error")
        .eq("shop_id", currentShop.id)
        .eq("platform", "youtube")
        .maybeSingle();
      if (error) throw error;
      return (data as YouTubeConnection | null) ?? null;
    },
  });

  const youtubeActive = !!youtubeConnection.data?.is_active;
  const disabled = !currentShop || !isShopAdmin;
  const title = !currentShop
    ? "Select a shop first"
    : !isShopAdmin
      ? "Shop admin access is required"
      : "Manage all external account authorizations in Connections";

  return (
    <Button
      asChild={!disabled}
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled}
      title={title}
      data-connections-shop-id={currentShop?.id || ""}
      className="h-9 gap-1.5 text-xs font-semibold"
    >
      {disabled ? (
        <span className="inline-flex items-center gap-1.5">
          <Settings2 className="h-3.5 w-3.5" />
          Connections
        </span>
      ) : (
        <Link to="/admin/seo/connections" className="inline-flex items-center gap-1.5">
          {youtubeActive
            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            : <Settings2 className="h-3.5 w-3.5" />}
          Connections
        </Link>
      )}
    </Button>
  );
}
