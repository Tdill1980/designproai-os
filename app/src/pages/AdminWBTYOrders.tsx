import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Truck, Package, DollarSign, RefreshCw, Download } from "lucide-react";

interface Order {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  shipping_address: string | null;
  order_type: string;
  pattern_name: string;
  pattern_category: string | null;
  pattern_media_url: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_size: string | null;
  finish: string | null;
  yards: number | null;
  retail_price_cents: number;
  wholesale_cost_cents: number | null;
  margin_cents: number | null;
  render_url: string | null;
  status: string;
  stripe_session_id: string | null;
  stripe_payment_status: string | null;
  fulfillment_emailed_at: string | null;
  shipped_at: string | null;
  tracking_carrier: string | null;
  tracking_number: string | null;
  notes: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  paid: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  fulfillment_emailed: "bg-purple-500/20 text-purple-400 border-purple-500/40",
  in_production: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  shipped: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
  delivered: "bg-green-500/20 text-green-400 border-green-500/40",
  refunded: "bg-red-500/20 text-red-400 border-red-500/40",
  cancelled: "bg-gray-500/20 text-gray-400 border-gray-500/40",
};

const STATUSES = ["pending", "paid", "fulfillment_emailed", "in_production", "shipped", "delivered", "refunded", "cancelled"];

export default function AdminWBTYOrders() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingOrder, setEditingOrder] = useState<string | null>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCarrier, setTrackingCarrier] = useState("");

  const { data: orders, isLoading } = useQuery({
    queryKey: ["wbty-orders", statusFilter],
    queryFn: async () => {
      let q = supabase.from("wbty_orders").select("*").order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as Order[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Order> }) => {
      const { error } = await supabase.from("wbty_orders").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wbty-orders"] });
      toast({ title: "Order updated" });
      setEditingOrder(null);
      setTrackingNumber("");
      setTrackingCarrier("");
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  // Stats
  const stats = orders?.reduce(
    (acc, o) => {
      acc.totalOrders += 1;
      acc.totalRetail += o.retail_price_cents;
      acc.totalWholesale += o.wholesale_cost_cents || 0;
      acc.totalMargin += o.margin_cents || 0;
      if (o.status === "pending") acc.pending += 1;
      if (o.status === "paid" || o.status === "fulfillment_emailed") acc.toShip += 1;
      if (o.status === "shipped" || o.status === "delivered") acc.shipped += 1;
      return acc;
    },
    { totalOrders: 0, totalRetail: 0, totalWholesale: 0, totalMargin: 0, pending: 0, toShip: 0, shipped: 0 },
  );

  const exportCSV = () => {
    if (!orders) return;
    const header = [
      "id", "created_at", "status", "order_type", "customer_name", "customer_email",
      "pattern_name", "vehicle", "yards", "retail", "wholesale", "margin",
      "stripe_session_id", "shipping_address", "tracking_carrier", "tracking_number",
    ];
    const rows = orders.map((o) => [
      o.id, o.created_at, o.status, o.order_type, o.customer_name, o.customer_email,
      o.pattern_name, `${o.vehicle_year || ""} ${o.vehicle_make || ""} ${o.vehicle_model || ""}`.trim(),
      o.yards || "", (o.retail_price_cents / 100).toFixed(2),
      o.wholesale_cost_cents ? (o.wholesale_cost_cents / 100).toFixed(2) : "",
      o.margin_cents ? (o.margin_cents / 100).toFixed(2) : "",
      o.stripe_session_id || "", (o.shipping_address || "").replace(/\n/g, " | "),
      o.tracking_carrier || "", o.tracking_number || "",
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wbty-orders-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-zinc-100 p-6 text-zinc-900">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Button onClick={() => navigate("/admin")} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />Back
          </Button>
          <div className="flex gap-2">
            <Button onClick={() => queryClient.invalidateQueries({ queryKey: ["wbty-orders"] })} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />Refresh
            </Button>
            <Button onClick={exportCSV} variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />Export CSV
            </Button>
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-2">PatternPro Orders</h1>
        <p className="text-zinc-600 mb-6">White-label dropship orders fulfilled by WePrintWraps</p>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card className="p-4 bg-white border-zinc-200">
              <p className="text-xs text-zinc-600">Total Orders</p>
              <p className="text-2xl font-bold">{stats.totalOrders}</p>
              <p className="text-xs text-zinc-600 mt-1">{stats.pending} pending • {stats.toShip} to ship • {stats.shipped} shipped</p>
            </Card>
            <Card className="p-4 bg-white border-zinc-200">
              <p className="text-xs text-zinc-600">Customer Revenue</p>
              <p className="text-2xl font-bold text-emerald-400">${(stats.totalRetail / 100).toFixed(2)}</p>
            </Card>
            <Card className="p-4 bg-white border-zinc-200">
              <p className="text-xs text-zinc-600">WPW Wholesale Owed (98%)</p>
              <p className="text-2xl font-bold text-orange-400">${(stats.totalWholesale / 100).toFixed(2)}</p>
              <p className="text-xs text-zinc-600 mt-1">Settle monthly via B2B invoice</p>
            </Card>
            <Card className="p-4 bg-white border-zinc-200">
              <p className="text-xs text-zinc-600">RestylePro Margin (2%)</p>
              <p className="text-2xl font-bold text-pink-400">${(stats.totalMargin / 100).toFixed(2)}</p>
            </Card>
          </div>
        )}

        <div className="flex gap-3 mb-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <p className="text-zinc-600">Loading...</p>
        ) : !orders?.length ? (
          <Card className="p-12 text-center text-zinc-600 bg-white border-zinc-200">No orders found</Card>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <Card key={o.id} className="p-4">
                <div className="flex items-start gap-4">
                  {o.pattern_media_url && (
                    <img src={o.pattern_media_url} alt={o.pattern_name} className="w-20 h-20 object-cover rounded-md border border-border flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold">{o.pattern_name}</p>
                        <p className="text-sm text-zinc-600">
                          {o.customer_name} ({o.customer_email})
                          {o.vehicle_year && ` • ${o.vehicle_year} ${o.vehicle_make} ${o.vehicle_model}`}
                          {o.yards && ` • ${o.yards} yds`}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge className={STATUS_COLORS[o.status] || ""}>{o.status}</Badge>
                        <p className="text-lg font-bold text-emerald-400">${(o.retail_price_cents / 100).toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
                      <span>{new Date(o.created_at).toLocaleString()}</span>
                      <span>{o.order_type}</span>
                      {o.wholesale_cost_cents != null && (
                        <span>WPW: ${(o.wholesale_cost_cents / 100).toFixed(2)}</span>
                      )}
                      {o.margin_cents != null && (
                        <span>Margin: ${(o.margin_cents / 100).toFixed(2)}</span>
                      )}
                      {o.tracking_number && (
                        <span className="text-emerald-400">{o.tracking_carrier}: {o.tracking_number}</span>
                      )}
                    </div>

                    {o.shipping_address && (
                      <details className="mt-2">
                        <summary className="text-xs cursor-pointer text-zinc-600 hover:text-foreground">Shipping address</summary>
                        <pre className="text-xs whitespace-pre-wrap mt-1 p-2 bg-zinc-50 rounded">{o.shipping_address}</pre>
                      </details>
                    )}

                    {editingOrder === o.id ? (
                      <div className="mt-3 p-3 bg-zinc-50 rounded space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Carrier (UPS, FedEx, etc)"
                            value={trackingCarrier}
                            onChange={(e) => setTrackingCarrier(e.target.value)}
                          />
                          <Input
                            placeholder="Tracking number"
                            value={trackingNumber}
                            onChange={(e) => setTrackingNumber(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => updateMutation.mutate({
                              id: o.id,
                              updates: {
                                status: "shipped",
                                tracking_carrier: trackingCarrier,
                                tracking_number: trackingNumber,
                                shipped_at: new Date().toISOString(),
                              },
                            })}
                          >
                            <Truck className="w-3 h-3 mr-1" />Mark Shipped
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingOrder(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex gap-2">
                        <Select
                          value={o.status}
                          onValueChange={(v) => updateMutation.mutate({ id: o.id, updates: { status: v } })}
                        >
                          <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {(o.status === "paid" || o.status === "fulfillment_emailed" || o.status === "in_production") && (
                          <Button size="sm" variant="outline" onClick={() => {
                            setEditingOrder(o.id);
                            setTrackingCarrier(o.tracking_carrier || "");
                            setTrackingNumber(o.tracking_number || "");
                          }}>
                            <Package className="w-3 h-3 mr-1" />Add Tracking
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
