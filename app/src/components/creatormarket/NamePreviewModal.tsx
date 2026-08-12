import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  ArrowRight, ShoppingBag, Pencil, Package, Truck,
  CheckCircle2, Sparkles, Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

/** Upsert email to subscribers for retargeting */
async function captureEmail(email: string, source: string, meta?: Record<string, any>) {
  if (!email || !email.includes("@")) return;
  try {
    await supabase.from("email_subscribers" as any).upsert(
      { email, source, updated_at: new Date().toISOString(), ...meta },
      { onConflict: "email" }
    );
  } catch {
    // Silent — don't block UX for analytics
  }
}

interface NamePreviewModalProps {
  listing: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBuy: (businessName: string) => void;
}

export function NamePreviewModal({ listing, open, onOpenChange, onBuy }: NamePreviewModalProps) {
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");

  // Pre-fill email from auth
  useEffect(() => {
    if (open) {
      setBusinessName("");
      setEmail("");
      supabase.auth.getSession().then(({ data }) => {
        if (data?.session?.user?.email) setEmail(data.session.user.email);
      });
    }
  }, [open]);

  if (!listing) return null;

  const titleParts = (listing.title || "").split(" - ");
  const designName = titleParts.length > 1 ? titleParts[1] : listing.title;
  const vehicleLabel = [listing.vehicle_year, listing.vehicle_make, listing.vehicle_model].filter(Boolean).join(" ");

  // Extract the "original" business name from the design name
  const originalName = designName || "Original Business";

  const heroUrl = listing.thumbnail_url
    || listing.render_urls?.side
    || (listing.render_urls ? Object.values(listing.render_urls)[0] : null);

  const hasName = businessName.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto bg-zinc-900 border-zinc-800 p-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Pencil className="h-5 w-5 text-amber-400" />
            </div>
            Preview Your Business Name
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            See how this design works with your company name — included free with every commercial wrap
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          {/* Hero render */}
          <div className="relative aspect-video rounded-xl overflow-hidden bg-zinc-800">
            {heroUrl ? (
              <img src={heroUrl as string} alt={designName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package className="h-16 w-16 text-zinc-700" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <div className="absolute bottom-4 left-4">
              <p className="text-lg font-bold text-white">{vehicleLabel}</p>
              <p className="text-sm text-zinc-300">{designName}</p>
            </div>
            <Badge className="absolute top-3 right-3 bg-amber-500/90 text-white border-0 gap-1 text-xs">
              <Sparkles className="w-3 h-3" /> Commercial Design
            </Badge>
          </div>

          {/* Name + Email input */}
          <div className="space-y-3">
            <div>
              <Label className="text-sm font-semibold text-foreground block mb-2">
                Your Business Name
              </Label>
              <Input
                placeholder="e.g. Joe's Plumbing, Apex Electric, Valley HVAC..."
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="bg-background border-border text-base h-12"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-sm font-semibold text-foreground block mb-2">
                Email for updates
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <Input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-background border-border"
                />
              </div>
              <p className="text-[10px] text-zinc-600 mt-1">We'll send your preview details and production updates here</p>
            </div>
          </div>

          {/* Name swap preview — the core feature */}
          <div className={cn(
            "rounded-xl border overflow-hidden transition-all duration-300",
            hasName ? "border-emerald-500/40 bg-emerald-500/5" : "border-zinc-800 bg-zinc-800/30",
          )}>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-0">
              {/* Original name */}
              <div className="p-5 text-center">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">Current Design Name</p>
                <p className="text-lg font-bold text-zinc-500 line-through decoration-red-400/50">
                  {originalName}
                </p>
              </div>

              {/* Arrow */}
              <div className={cn(
                "flex items-center justify-center w-12 h-12 rounded-full transition-colors",
                hasName ? "bg-emerald-500/20" : "bg-zinc-800",
              )}>
                <ArrowRight className={cn(
                  "h-5 w-5 transition-colors",
                  hasName ? "text-emerald-400" : "text-zinc-600",
                )} />
              </div>

              {/* New name */}
              <div className="p-5 text-center">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">Your Business Name</p>
                {hasName ? (
                  <p className="text-lg font-bold text-emerald-400">
                    {businessName}
                  </p>
                ) : (
                  <p className="text-lg font-medium text-zinc-700 italic">
                    Type your name above...
                  </p>
                )}
              </div>
            </div>

            {/* What happens explanation */}
            {hasName && (
              <div className="border-t border-emerald-500/20 px-5 py-3 bg-emerald-500/5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-zinc-300">
                    <span className="font-semibold text-emerald-400">"{businessName}"</span> will replace{" "}
                    <span className="text-zinc-500">"{originalName}"</span> on all panels.
                    Your production pack arrives with your business name professionally integrated into the design.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* What's included */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-zinc-800/50 border border-zinc-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">Name swap included</p>
                <p className="text-[10px] text-zinc-500">No extra charge — your name on every panel</p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-zinc-800/50 border border-zinc-800">
              <Package className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">Full production pack</p>
                <p className="text-[10px] text-zinc-500">Print-ready panels, 7 renders, PDF proof</p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-zinc-800/50 border border-zinc-800">
              <Truck className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">Sized to your vehicle</p>
                <p className="text-[10px] text-zinc-500">Enter make & model at checkout</p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-zinc-800/50 border border-zinc-800">
              <Pencil className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">Logo pack add-on</p>
                <p className="text-[10px] text-zinc-500">Cut-contour logo files +$25</p>
              </div>
            </div>
          </div>

          {/* Price + Buy */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-800/50 border border-zinc-700">
            <div>
              <p className="text-sm text-zinc-400">Design + Name Swap + Production Pack</p>
              <p className="text-xs text-emerald-400 mt-0.5">Business name swap included free</p>
            </div>
            <p className="text-2xl font-bold text-foreground">${listing.price || 350}</p>
          </div>

          <Button
            className="w-full gap-2 bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white text-base py-6"
            disabled={!hasName}
            onClick={() => {
              // Capture warm lead
              captureEmail(email, "marketplace_name_preview");
              onBuy(businessName);
            }}
          >
            <ShoppingBag className="h-5 w-5" />
            {hasName
              ? `Order "${businessName}" Design — $${listing.price || 350}`
              : "Enter your business name to continue"
            }
          </Button>
          <p className="text-[10px] text-center text-zinc-600">
            Your business name will be professionally integrated into this design. Print-ready files emailed within 48 hours.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
