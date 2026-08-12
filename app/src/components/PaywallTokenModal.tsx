import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  Coins,
  Package,
  TrendingUp,
  Car,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PAYWALL_EVENT, type PaywallPayload } from "@/lib/paywall";

/**
 * PaywallTokenModal
 *
 * Globally mounted at the App root. Listens for the
 * `restylepro:paywall` window event (dispatched by `showPaywall()` in
 * src/lib/paywall.ts) and renders a 3-option modal:
 *
 *   1. 🪙  Buy Tokens         — Stripe checkout at the user's tier rate
 *   2. 📦  Production Pack    — $299 one-shot print-ready output
 *   3. 📈  Upgrade Tier       — /pricing
 *
 * The modal stays decoupled from any single tool — every render edge
 * function that returns a 402 with `code: "no_tokens"` triggers it via
 * the same global event.
 */
export function PaywallTokenModal() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<PaywallPayload>({});
  const [buyingTokens, setBuyingTokens] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PaywallPayload>).detail ?? {};
      setPayload(detail);
      setOpen(true);
    };
    window.addEventListener(PAYWALL_EVENT, handler);
    return () => window.removeEventListener(PAYWALL_EVENT, handler);
  }, []);

  const close = () => setOpen(false);

  const tokenPrice = payload.paywall?.buy_tokens?.cost_per_token ?? 30;
  const packPrice = payload.paywall?.production_pack?.price ?? 299;
  const tier = payload.tier ?? "free";
  const balance = payload.token_balance ?? 0;

  const handleBuyTokens = async () => {
    if (buyingTokens) return;
    setBuyingTokens(true);
    try {
      // create-token-checkout returns a Stripe Checkout Session URL.
      // Defaults to 10 tokens unless the user picks a different
      // quantity in the dedicated /billing buy-tokens page.
      const { data, error } = await supabase.functions.invoke(
        "create-token-checkout",
        {
          body: { quantity: 10, return_path: window.location.pathname },
        },
      );
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error("No checkout URL returned");
    } catch (e) {
      toast.error(
        `Could not start checkout — ${(e as Error).message || "try again in a moment"}`,
      );
    } finally {
      setBuyingTokens(false);
    }
  };

  const [buyingPack, setBuyingPack] = useState(false);
  const handleProductionPack = async () => {
    // Print-file export paywall (code:"pack_required") carries the design's
    // generation_id → start the CLEAN print-pack checkout for THAT generation
    // (proven pipeline; on payment the webhook marks it paid and the export
    // unlocks). Any other paywall trigger keeps the legacy /printpro route.
    const genId = payload.code === "pack_required" ? payload.generation_id : null;
    if (!genId) {
      close();
      navigate("/printpro");
      return;
    }
    if (buyingPack) return;
    setBuyingPack(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-print-pack-checkout", {
        body: { generation_id: genId, return_path: window.location.pathname },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error("No checkout URL returned");
    } catch (e) {
      toast.error(`Could not start checkout — ${(e as Error).message || "try again in a moment"}`);
    } finally {
      setBuyingPack(false);
    }
  };

  const handleUpgrade = () => {
    close();
    navigate("/pricing");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent
        className="w-[460px] max-w-[94vw] p-0 border-0 bg-transparent shadow-none overflow-visible gap-0"
        overlayClassName="bg-black/80"
      >
        <div className="relative rounded-2xl bg-neutral-950 border border-white/10 shadow-2xl shadow-black/60 overflow-hidden">
          <button
            type="button"
            onClick={close}
            aria-label="Close paywall"
            className="absolute top-3 right-3 z-30 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white/70 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Header */}
          <div className="px-6 pt-6 pb-4 bg-gradient-to-br from-cyan-500/15 via-fuchsia-500/10 to-purple-500/15 border-b border-white/5">
            <div className="flex items-center gap-3 mb-1">
              <div
                aria-label="One RestylePro design token — $25 retail value"
                className="relative w-14 h-14 rounded-full bg-gradient-to-br from-cyan-400/40 to-fuchsia-500/40 ring-2 ring-cyan-300/80 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.55)] mr-2 mb-2 shrink-0"
              >
                <div className="flex flex-col items-center leading-none select-none">
                  <span className="text-[8px] font-bold tracking-[0.18em] text-cyan-200">
                    RP
                  </span>
                  <span className="text-base font-extrabold text-white tracking-tight">
                    $25
                  </span>
                </div>
                <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 inline-flex items-center justify-center w-4 h-4 rounded-full bg-black/85 border border-cyan-400/60 shadow-md">
                  <Car className="w-2.5 h-2.5 text-cyan-200" strokeWidth={2.6} />
                </span>
              </div>
              <div>
                <h2 className="text-lg font-bold text-white leading-tight">
                  You're out of tokens
                </h2>
                <p className="text-[11px] text-white/55">
                  Current balance: <strong className="text-white">{balance}</strong>
                  {" "}· This render costs {payload.cost ?? 1}
                </p>
              </div>
            </div>
          </div>

          {/* 3 options */}
          <div className="p-5 space-y-3">
            {/* Buy Tokens */}
            <button
              type="button"
              onClick={handleBuyTokens}
              disabled={buyingTokens}
              className="w-full text-left p-4 rounded-xl bg-gradient-to-br from-cyan-500/15 to-cyan-500/5 border border-cyan-500/30 hover:border-cyan-400/60 hover:bg-cyan-500/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
                    <Coins className="w-4.5 h-4.5 text-cyan-300" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">
                      {buyingTokens ? "Opening checkout…" : "Buy More Tokens"}
                    </div>
                    <div className="text-[11px] text-white/55">
                      ${tokenPrice} / token · 1 token = 1 render or revision
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300 bg-cyan-500/20 border border-cyan-500/30 rounded px-2 py-0.5">
                  Fastest
                </span>
              </div>
            </button>

            {/* Production Pack */}
            <button
              type="button"
              onClick={handleProductionPack}
              className="w-full text-left p-4 rounded-xl bg-gradient-to-br from-amber-500/15 to-orange-500/5 border border-amber-500/30 hover:border-amber-400/60 hover:bg-amber-500/20 transition-all"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <Package className="w-4.5 h-4.5 text-amber-300" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">
                    ${packPrice} Production Pack
                  </div>
                  <div className="text-[11px] text-white/55">
                    Print-ready output for this job — no subscription needed
                  </div>
                </div>
              </div>
            </button>

            {/* Upgrade Tier */}
            <button
              type="button"
              onClick={handleUpgrade}
              className="w-full text-left p-4 rounded-xl bg-gradient-to-br from-fuchsia-500/15 to-purple-500/5 border border-fuchsia-500/30 hover:border-fuchsia-400/60 hover:bg-fuchsia-500/20 transition-all"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-fuchsia-500/20 border border-fuchsia-500/30 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4.5 h-4.5 text-fuchsia-300" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">
                    Upgrade tier — cheaper per render
                  </div>
                  <div className="text-[11px] text-white/55">
                    Starter $350/mo (50 tokens, $7/render at the cap) →
                    Plus $995/mo ($3.32/render)
                  </div>
                </div>
              </div>
            </button>
          </div>

          {/* Footer fine print */}
          <div className="px-5 pb-5">
            <p className="text-[10px] text-white/40 leading-relaxed text-center">
              Each token = $25 retail value. You're on the{" "}
              <strong className="text-white/60">{tier}</strong> tier — overage
              tokens are priced at ${tokenPrice} each at this tier; subscribing
              to a higher tier drops that rate.
            </p>
          </div>

          {/* Maybe later */}
          <div className="px-5 pb-5 -mt-3 text-center">
            <button
              type="button"
              onClick={close}
              className="text-[11px] text-white/50 hover:text-white/80 transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
