import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, TrendingUp, Calendar, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const RENDER_LIMITS = {
  starter: 50,
  advanced: 75,
  complete: 999999,
  free: 0,
};

export default function Billing() {
  const navigate = useNavigate();
  const { subscription, loading } = useSubscriptionLimits();
  const [portalLoading, setPortalLoading] = useState(false);

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please log in to manage your subscription");
        navigate("/login");
        return;
      }

      const { data, error } = await supabase.functions.invoke("create-billing-portal");
      if (error) throw error;
      if (!data?.url) throw new Error("No portal URL returned");

      window.open(data.url, '_blank');
    } catch (error) {
      console.error("Error opening billing portal:", error);
      toast.error("Unable to open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const tier = subscription?.tier || "free";
  const status = subscription?.status || "none";
  const renderCount = subscription?.render_count || 0;
  const renderLimit = RENDER_LIMITS[tier as keyof typeof RENDER_LIMITS] || 0;
  const resetDate = subscription?.render_reset_date 
    ? new Date(subscription.render_reset_date).toLocaleDateString()
    : "N/A";

  return (
    <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Billing & Usage</h1>
          <p className="text-muted-foreground">Manage your subscription and view render usage</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 mb-6">
          {/* Current Plan Card */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Current Plan
              </CardTitle>
              <CardDescription>Your active subscription tier</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Badge 
                    variant={status === "active" ? "default" : "secondary"}
                    className="text-lg px-3 py-1"
                  >
                    {tier.charAt(0).toUpperCase() + tier.slice(1)}
                  </Badge>
                  <p className="text-sm text-muted-foreground mt-2">
                    Status: <span className="text-foreground font-medium">{status}</span>
                  </p>
                </div>
                {status === "active" && (
                  <div className="pt-4 border-t border-border">
                    <p className="text-sm text-muted-foreground">
                      Billing Cycle: {new Date(subscription?.billing_cycle_start || "").toLocaleDateString()} - {new Date(subscription?.billing_cycle_end || "").toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Render Usage Card */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Render Usage
              </CardTitle>
              <CardDescription>Monthly render statistics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-foreground">{renderCount}</span>
                    <span className="text-muted-foreground">/ {renderLimit}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">Renders this month</p>
                </div>
                <div className="pt-4 border-t border-border">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    Resets on: <span className="text-foreground font-medium">{resetDate}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Manage Subscription Card */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Manage Subscription</CardTitle>
            <CardDescription>
              Update your payment method, view invoices, or cancel your subscription
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Button
                onClick={handleManageSubscription}
                disabled={portalLoading || status !== "active"}
                className="w-full sm:w-auto"
              >
                {portalLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Opening Portal...
                  </>
                ) : (
                  <>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Stripe Customer Portal
                  </>
                )}
              </Button>
              {status !== "active" && (
                <p className="text-sm text-muted-foreground">
                  No active subscription. <Button variant="link" className="p-0 h-auto" onClick={() => navigate("/pricing")}>View Plans</Button>
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
