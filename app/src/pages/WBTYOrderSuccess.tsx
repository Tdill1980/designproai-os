import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Truck, FileDown, Home } from "lucide-react";

interface OrderRow {
  id: string;
  order_type: string;
  pattern_name: string;
  pattern_media_url: string | null;
  pattern_category: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  finish: string | null;
  yards: number | null;
  retail_price_cents: number;
  status: string;
  customer_name: string;
  customer_email: string;
  shipping_address: string | null;
  render_url: string | null;
  created_at: string;
}

export default function WBTYOrderSuccess() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [pollAttempts, setPollAttempts] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }

    let timeout: NodeJS.Timeout | null = null;
    let cancelled = false;

    const fetchOrder = async () => {
      const { data, error } = await supabase
        .from("wbty_orders")
        .select("*")
        .eq("stripe_session_id", sessionId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error("Order fetch error:", error);
        setLoading(false);
        return;
      }

      if (data) {
        setOrder(data as any);
        setLoading(false);

        // If still pending, poll a few more times waiting for webhook to flip status
        if (data.status === "pending" && pollAttempts < 6) {
          timeout = setTimeout(() => setPollAttempts((n) => n + 1), 2000);
        }
      } else if (pollAttempts < 6) {
        timeout = setTimeout(() => setPollAttempts((n) => n + 1), 2000);
      } else {
        setLoading(false);
      }
    };

    fetchOrder();

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [sessionId, pollAttempts]);

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-zinc-100 flex items-center justify-center p-6">
        <Card className="p-8 max-w-md text-center bg-white border-zinc-200 text-zinc-900">
          <p className="text-zinc-600">No session ID provided.</p>
          <Button asChild className="mt-4"><Link to="/wbty">Back to PatternPro</Link></Button>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-100 flex items-center justify-center p-6">
        <Card className="p-8 max-w-md text-center bg-white border-zinc-200 text-zinc-900">
          <Loader2 className="w-12 h-12 animate-spin mx-auto text-primary mb-4" />
          <h1 className="text-xl font-bold mb-2">Confirming your payment…</h1>
          <p className="text-sm text-zinc-600">Just a moment while we finalize your order.</p>
        </Card>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-zinc-100 flex items-center justify-center p-6">
        <Card className="p-8 max-w-md text-center bg-white border-zinc-200 text-zinc-900">
          <h1 className="text-xl font-bold mb-2">Order not found yet</h1>
          <p className="text-sm text-zinc-600 mb-4">
            Your payment may still be processing. Check your email — we'll send a confirmation when it's complete.
          </p>
          <Button asChild><Link to="/wbty">Back to PatternPro</Link></Button>
        </Card>
      </div>
    );
  }

  const isPrint = order.order_type === "printed_wrap";
  const isPaid = order.status === "paid" || order.status === "fulfillment_emailed" || order.status === "in_production" || order.status === "shipped";
  const total = (order.retail_price_cents / 100).toFixed(2);
  const orderRefShort = order.id.split("-")[0].toUpperCase();

  return (
    <div className="min-h-screen bg-zinc-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <Card className="p-8 text-center bg-white border-zinc-200 text-zinc-900">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
          <h1 className="text-3xl font-bold mb-2">
            {isPaid ? "Order Confirmed!" : "Payment Received"}
          </h1>
          <p className="text-zinc-600 mb-6">
            Thanks {order.customer_name}! A confirmation email is on its way to {order.customer_email}.
          </p>

          <div className="bg-zinc-50 rounded-lg p-4 text-left space-y-3 border border-zinc-200">
            <div className="flex justify-between">
              <span className="text-sm text-zinc-600">Order ID</span>
              <span className="font-mono text-sm">{orderRefShort}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-zinc-600">Pattern</span>
              <span className="font-semibold">{order.pattern_name}</span>
            </div>
            {isPrint && order.vehicle_year && (
              <div className="flex justify-between">
                <span className="text-sm text-zinc-600">Vehicle</span>
                <span>{order.vehicle_year} {order.vehicle_make} {order.vehicle_model}</span>
              </div>
            )}
            {isPrint && (
              <div className="flex justify-between">
                <span className="text-sm text-zinc-600">Yards</span>
                <span>{order.yards}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-sm text-zinc-600">Finish</span>
              <span>{order.finish}</span>
            </div>
            <div className="flex justify-between pt-3 border-t border-border">
              <span className="font-semibold">Total Paid</span>
              <span className="font-bold text-xl text-emerald-500">${total}</span>
            </div>
          </div>

          {order.render_url && (
            <div className="mt-6">
              <p className="text-xs text-zinc-600 mb-2">Your design</p>
              <img src={order.render_url} alt="Your design" className="w-full rounded-lg border border-border" />
            </div>
          )}

          <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg text-left">
            {isPrint ? (
              <>
                <div className="flex items-start gap-3">
                  <Truck className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-sm mb-1">What happens next</p>
                    <ul className="text-xs text-zinc-600 space-y-1 list-disc list-inside">
                      <li>Your wrap goes into production today</li>
                      <li>Ships in 2-5 business days</li>
                      <li>You'll receive tracking by email</li>
                      {order.retail_price_cents >= 75000 && (
                        <li className="text-emerald-400 font-medium">✓ FREE shipping on this order</li>
                      )}
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-start gap-3">
                <FileDown className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm mb-1">What happens next</p>
                  <p className="text-xs text-zinc-600">
                    Your print-ready high-resolution design file will be emailed to {order.customer_email} within 24 hours.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex gap-3 justify-center">
            <Button variant="outline" asChild>
              <Link to="/"><Home className="w-4 h-4 mr-2" />Home</Link>
            </Button>
            <Button asChild>
              <Link to="/wbty">Design Another</Link>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
