import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Mic, Inbox, ArrowRight, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SavedQuotesTable } from "@/components/admin/SavedQuotesTable";
import { InboundLeadsCard } from "@/components/dashboard/InboundLeadsCard";
import { MightyMailCard } from "@/components/dashboard/MightyMailCard";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

/**
 * User-facing Quotes page.
 * - "Priced quotes" tab: reuses SavedQuotesTable (RLS scopes to current shop)
 * - "Inbound requests" tab: shows leads that haven't been quoted yet
 */
const Quotes = () => {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSyncOrders = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("wpw-sync-orders", {
        body: { days_back: 90, per_page: 100 },
      });
      if (error) throw error;
      const msg = `${data.orders_fetched} orders synced, ${data.quotes_converted} quotes converted`;
      setSyncResult(msg);
      toast({ title: "WPW Orders Synced", description: msg });
      queryClient.invalidateQueries({ queryKey: ["admin-saved-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-latest-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-cold-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-revenue-activity"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-quote-rows"] });
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Quotes — RestylePro</title>
        <meta
          name="description"
          content="Manage priced quotes, inbound requests, and retargeting all in one place."
        />
      </Helmet>

      <div className="min-h-screen bg-white text-gray-900">
        {/* Brand accent hairline */}
        <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
        <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">Quotes</h1>
            <p className="text-sm text-gray-500 mt-1">
              Priced quotes, inbound requests, and retargeting in one place.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSyncOrders}
              disabled={syncing}
              variant="outline"
              className="border-gray-300 text-gray-700 hover:bg-gray-50 font-semibold"
            >
              {syncing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
              {syncing ? "Syncing..." : "Sync WPW Orders"}
            </Button>
            <Button
              asChild
              className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:brightness-110 text-white font-semibold border-0"
            >
              <Link to="/quick-quote">
                <Mic className="w-4 h-4 mr-1.5" />
                New quote
              </Link>
            </Button>
          </div>
          {syncResult && (
            <p className="text-xs text-gray-500 mt-1">{syncResult}</p>
          )}
        </div>

        {/* Summary cards row — MightyMail + Inbound leads */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MightyMailCard light />
          <InboundLeadsCard light />
        </div>

        {/* Full quotes table with tabs */}
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <Tabs defaultValue="priced" className="w-full">
            <div className="border-b border-gray-200 px-3 sm:px-4 pt-3">
              <TabsList className="bg-transparent p-0 h-auto gap-1">
                <TabsTrigger
                  value="priced"
                  className="text-xs font-semibold text-gray-600 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:border-blue-200 border border-transparent"
                >
                  Priced quotes
                </TabsTrigger>
                <TabsTrigger
                  value="inbound"
                  className="text-xs font-semibold text-gray-600 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:border-blue-200 border border-transparent"
                >
                  <Inbox className="w-3 h-3 mr-1" />
                  Inbound requests
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="priced" className="m-0 p-0">
              <SavedQuotesTable />
            </TabsContent>

            <TabsContent value="inbound" className="m-0 p-4 sm:p-6">
              <div className="text-center py-10 text-gray-500">
                <Inbox className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                <p className="text-sm mb-1">
                  Inbound requests show up in the card above.
                </p>
                <p className="text-xs text-gray-400 mb-4">
                  Turn any request into a priced quote to move it here.
                </p>
                <Button
                  asChild
                  variant="outline"
                  className="border-blue-200 text-blue-600 hover:bg-blue-50"
                >
                  <Link to="/quick-quote">
                    Open QuickQuote
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Link>
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
        </div>
      </div>
    </>
  );
};

export default Quotes;
