/**
 * AlaCarteRenderModal — "Buy 1 render — $25" surface for non-subscribers
 * (and subscribers who exhaust their monthly allowance) so they can keep
 * generating without committing to a tier.
 *
 * Flow:
 *   1. User clicks "Buy a render — $25" anywhere it's surfaced.
 *   2. We invoke create-alacarte-render-checkout (Stripe one-time
 *      payment, $25 inline price_data, mode=payment).
 *   3. Stripe redirects to /pricing?alacarte=success after payment.
 *   4. stripe-webhook (checkout.session.completed branch) increments
 *      user_subscriptions.alacarte_renders_remaining by the purchased
 *      quantity. On next render attempt the limit RPC consumes the
 *      a-la-carte balance before paywalling.
 *
 * Modal also surfaces the upgrade ladder so heavy users see the
 * obvious math: $25 × 8 renders = $200 → Starter $199/mo for 50.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Check, Loader2, Wallet, Zap } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const QUICK_QTYS = [1, 3, 5];

interface AlaCarteRenderModalProps {
  open: boolean;
  onClose: () => void;
}

export const AlaCarteRenderModal = ({
  open,
  onClose,
}: AlaCarteRenderModalProps) => {
  const [qty, setQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const total = qty * 25;

  const handleBuy = async () => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ url: string }>(
        "create-alacarte-render-checkout",
        { body: { quantity: qty } },
      );
      if (error) throw error;
      if (!data?.url) throw new Error("Checkout URL missing");
      window.location.href = data.url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Couldn't start checkout";
      toast({
        title: "Checkout failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-2">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500 to-fuchsia-500 flex items-center justify-center">
              <Wallet className="h-6 w-6 text-white" />
            </div>
          </div>
          <DialogTitle className="text-center text-2xl">
            Keep going — pay as you go
          </DialogTitle>
          <DialogDescription className="text-center pt-2">
            $25 per render. Buy what you need. Stack with your monthly allowance. Never expires.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {/* Quantity picker */}
          <div className="grid grid-cols-3 gap-2">
            {QUICK_QTYS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setQty(n)}
                className={`rounded-xl border-2 p-3 text-center transition ${
                  qty === n
                    ? "border-cyan-500 bg-cyan-500/10"
                    : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                }`}
              >
                <p className="text-2xl font-black text-white">{n}</p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-400">
                  render{n > 1 ? "s" : ""}
                </p>
                <p className="text-[11px] font-semibold text-cyan-300 mt-0.5">
                  ${n * 25}
                </p>
              </button>
            ))}
          </div>

          {/* Total */}
          <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 to-fuchsia-500/10 p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-zinc-400">Total today</p>
              <p className="text-3xl font-black text-white">${total}</p>
            </div>
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px] uppercase tracking-wider">
              Never expires
            </Badge>
          </div>

          <Button
            onClick={handleBuy}
            disabled={submitting}
            size="lg"
            className="w-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white border-0 hover:opacity-90 font-bold"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Zap className="w-4 h-4 mr-1" />
                Pay ${total} · Get {qty} render{qty > 1 ? "s" : ""}
              </>
            )}
          </Button>

          {/* Upgrade ladder footnote — shows the math */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-muted-foreground space-y-1.5">
            <p className="font-semibold text-white text-xs">Or subscribe + save:</p>
            <div className="flex items-center justify-between">
              <span>Starter — 50 renders / mo</span>
              <span className="text-zinc-300 font-semibold">$199/mo</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Pro — 75 renders / mo</span>
              <span className="text-zinc-300 font-semibold">$299/mo</span>
            </div>
            <div className="flex items-center gap-1 text-emerald-400 font-semibold">
              <Check className="w-3 h-3" />
              <span>Subscribers also get $10 metered overage (vs $25 à la carte)</span>
            </div>
            <Link
              to="/pricing"
              className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-semibold pt-1"
            >
              Compare tiers <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
