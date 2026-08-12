import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, MousePointer, ShoppingCart, AlertTriangle } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";

interface EventCount {
  event_type: string;
  count: number;
}

interface ProductBreakdown {
  product_type: string;
  count: number;
}

const AdminConversionDashboard = () => {
  // Fetch event counts for last 7 days
  const { data: eventCounts, isLoading: isLoadingEvents } = useQuery({
    queryKey: ["quote-events-summary"],
    queryFn: async () => {
      const sevenDaysAgo = subDays(new Date(), 7).toISOString();
      
      const { data, error } = await supabase
        .from("quote_events")
        .select("event_type")
        .gte("created_at", sevenDaysAgo);

      if (error) throw error;

      // Group by event_type
      const counts: Record<string, number> = {};
      data?.forEach((event) => {
        counts[event.event_type] = (counts[event.event_type] || 0) + 1;
      });

      return Object.entries(counts).map(([event_type, count]) => ({
        event_type,
        count,
      })) as EventCount[];
    },
  });

  // Fetch product breakdown
  const { data: productBreakdown, isLoading: isLoadingProducts } = useQuery({
    queryKey: ["quote-events-by-product"],
    queryFn: async () => {
      const sevenDaysAgo = subDays(new Date(), 7).toISOString();
      
      const { data, error } = await supabase
        .from("quote_events")
        .select("product_type")
        .gte("created_at", sevenDaysAgo)
        .not("product_type", "is", null);

      if (error) throw error;

      // Group by product_type
      const counts: Record<string, number> = {};
      data?.forEach((event) => {
        if (event.product_type) {
          counts[event.product_type] = (counts[event.product_type] || 0) + 1;
        }
      });

      return Object.entries(counts).map(([product_type, count]) => ({
        product_type,
        count,
      })) as ProductBreakdown[];
    },
  });

  // Fetch recent events for activity feed
  const { data: recentEvents, isLoading: isLoadingRecent } = useQuery({
    queryKey: ["quote-events-recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data;
    },
  });

  const getEventCount = (type: string): number => {
    return eventCounts?.find((e) => e.event_type === type)?.count || 0;
  };

  const totalClicks = getEventCount("order_now_clicked") + getEventCount("checkout_started");
  const errorCount = getEventCount("cart_redirect_failed");

  const isLoading = isLoadingEvents || isLoadingProducts || isLoadingRecent;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Conversion Tracking</h1>
          <p className="text-muted-foreground mt-1">
            Last 7 days • Read-only telemetry
          </p>
        </div>

        {/* Funnel Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Order Now Clicks</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <MousePointer className="h-6 w-6 text-primary" />
                {totalClicks}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                CTA button clicks across all products
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Checkout Started</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <ShoppingCart className="h-6 w-6 text-green-500" />
                {getEventCount("checkout_started")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Stripe checkout sessions initiated
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Cart Redirects</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <TrendingUp className="h-6 w-6 text-blue-500" />
                {getEventCount("cart_redirect_attempted")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Redirects to WePrintWraps cart
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Errors</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <AlertTriangle className={`h-6 w-6 ${errorCount > 0 ? 'text-red-500' : 'text-muted-foreground'}`} />
                {errorCount}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Failed redirects or errors
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Product Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>By Product</CardTitle>
              <CardDescription>Click distribution across products</CardDescription>
            </CardHeader>
            <CardContent>
              {productBreakdown && productBreakdown.length > 0 ? (
                <div className="space-y-3">
                  {productBreakdown.map((p) => (
                    <div key={p.product_type} className="flex justify-between items-center">
                      <span className="text-sm font-medium capitalize">
                        {p.product_type.replace(/_/g, " ")}
                      </span>
                      <span className="text-sm text-muted-foreground">{p.count} events</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No data yet</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Last 20 tracked events</CardDescription>
            </CardHeader>
            <CardContent>
              {recentEvents && recentEvents.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {recentEvents.map((event) => (
                    <div
                      key={event.id}
                      className="flex justify-between items-center text-sm py-1 border-b border-border last:border-0"
                    >
                      <div>
                        <span className="font-medium">
                          {event.event_type.replace(/_/g, " ")}
                        </span>
                        {event.product_type && (
                          <span className="text-xs text-muted-foreground ml-2">
                            ({event.product_type})
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(event.created_at), "MMM d, HH:mm")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No events yet</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Feature Flag Notice */}
        <div className="mt-8 p-4 bg-muted/50 rounded-lg border border-border">
          <p className="text-sm text-muted-foreground">
            <strong>Tracking is currently OFF by default.</strong> To enable for testing, run in console:{" "}
            <code className="bg-background px-1 py-0.5 rounded text-xs">
              localStorage.setItem('TRACKING_ENABLED', 'true')
            </code>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminConversionDashboard;
