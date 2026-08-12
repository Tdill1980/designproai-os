import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Truck, FileDown, Bike, Car, Truck as TruckIcon, Bus } from "lucide-react";
import {
  calculateYards,
  recalcWithYards,
  YARD_TIERS,
  DESIGN_FILE_PRICE,
  type VehicleSize,
} from "@/lib/wbty-yards-calculator";

interface BuyPatternModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pattern: {
    id?: string;
    name: string;
    media_url?: string;
    category?: string;
  } | null;
  vehicle: { year: string; make: string; model: string };
  finish: string;
  renderUrl?: string | null;
  additionalViews?: Record<string, string | undefined>;
}

const SIZE_ICONS: Record<VehicleSize, React.ReactNode> = {
  motorcycle: <Bike className="w-4 h-4" />,
  small: <Car className="w-4 h-4" />,
  midsize: <TruckIcon className="w-4 h-4" />,
  large: <Bus className="w-4 h-4" />,
};

export const BuyPatternModal = ({
  open,
  onOpenChange,
  pattern,
  vehicle,
  finish,
  renderUrl,
  additionalViews,
}: BuyPatternModalProps) => {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [notes, setNotes] = useState("");

  // Auto-calculate yards from vehicle
  const baseCalc = useMemo(() => {
    if (!vehicle.year || !vehicle.make || !vehicle.model) {
      return null;
    }
    return calculateYards(vehicle.year, vehicle.make, vehicle.model);
  }, [vehicle]);

  const [yardOverride, setYardOverride] = useState<number | null>(null);

  const calc = useMemo(() => {
    if (!baseCalc) return null;
    if (yardOverride !== null) {
      return { ...baseCalc, ...recalcWithYards(yardOverride) };
    }
    return baseCalc;
  }, [baseCalc, yardOverride]);

  const submitOrder = async (orderType: "printed_wrap" | "design_file") => {
    if (!pattern) return;
    if (!customerName || !customerEmail) {
      toast({
        title: "Required fields missing",
        description: "Please enter your name and email",
        variant: "destructive",
      });
      return;
    }
    // Note: shipping address for printed wraps is collected at Stripe Checkout

    setSubmitting(true);
    try {
      const payload = {
        orderType,
        pattern: {
          id: pattern.id,
          name: pattern.name,
          category: pattern.category,
          media_url: pattern.media_url,
        },
        vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
        },
        vehicleSize: calc?.size,
        finish,
        yards: orderType === "printed_wrap" ? calc?.yards : undefined,
        renderUrl,
        additionalViews,
        customer: {
          name: customerName,
          email: customerEmail,
          phone: customerPhone,
        },
        // Stripe Checkout collects shipping address; this is a fallback hint only
        shippingAddress: orderType === "printed_wrap" ? shippingAddress || undefined : undefined,
        notes,
      };

      // Create Stripe Checkout Session and redirect
      const { data, error } = await supabase.functions.invoke("create-wbty-checkout", {
        body: payload,
      });

      if (error) throw error;
      if (!data?.url) throw new Error("No checkout URL returned");

      // Redirect to Stripe Checkout (hosted page)
      window.location.href = data.url;
    } catch (err: any) {
      console.error("Checkout error:", err);
      toast({
        title: "Checkout failed",
        description: err.message || "Please try again",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white text-zinc-900 border-zinc-200">
        <DialogHeader>
          <DialogTitle>Buy {pattern?.name || "Pattern"}</DialogTitle>
          <DialogDescription>
            Get this pattern as a printed wrap fulfilled by WePrintWraps, or buy the design file to print at your own shop.
          </DialogDescription>
        </DialogHeader>

        {/* Pattern + render preview */}
        {pattern && (
          <div className="flex gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-200">
            {pattern.media_url && (
              <img
                src={pattern.media_url}
                alt={pattern.name}
                className="w-20 h-20 object-cover rounded-md border border-border"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{pattern.name}</p>
              {pattern.category && (
                <p className="text-xs text-muted-foreground">{pattern.category}</p>
              )}
              {vehicle.year && vehicle.make && vehicle.model && (
                <p className="text-xs text-muted-foreground mt-1">
                  {vehicle.year} {vehicle.make} {vehicle.model} • {finish}
                </p>
              )}
            </div>
            {renderUrl && (
              <img
                src={renderUrl}
                alt="3D render"
                className="w-20 h-20 object-cover rounded-md border border-border"
              />
            )}
          </div>
        )}

        <Tabs defaultValue="printed">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="printed">
              <Truck className="w-4 h-4 mr-2" />
              Printed Wrap (WPW)
            </TabsTrigger>
            <TabsTrigger value="design">
              <FileDown className="w-4 h-4 mr-2" />
              Design File Only
            </TabsTrigger>
          </TabsList>

          {/* ── PRINTED WRAP TAB ─────────────────────────────────── */}
          <TabsContent value="printed" className="space-y-4 mt-4">
            <div className="text-xs text-muted-foreground bg-blue-500/10 border border-blue-500/30 rounded-md p-3">
              <p className="font-semibold text-blue-400 mb-1">Premium printed vinyl wrap</p>
              <p>
                Avery cast vinyl, 60" roll, professionally printed and shipped to your door.
                {calc && calc.totalPrice >= 750 && (
                  <span className="block mt-1 text-emerald-400 font-semibold">✓ FREE SHIPPING (orders $750+)</span>
                )}
                {calc && calc.totalPrice < 750 && (
                  <span className="block mt-1">Standard shipping $25 (free at $750+)</span>
                )}
              </p>
            </div>

            {calc ? (
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {SIZE_ICONS[calc.size]}
                    <span className="font-semibold">{calc.tier.label}</span>
                    <Badge variant="secondary">Auto-detected</Badge>
                  </div>
                  <p className="text-2xl font-bold text-primary">${calc.totalPrice.toFixed(2)}</p>
                </div>

                <div className="text-xs text-muted-foreground">
                  Based on {calc.vehicleLabel} → similar to: {calc.tier.examples.slice(0, 3).join(", ")}
                </div>

                <div className="flex items-center gap-3 pt-2 border-t border-border">
                  <Label htmlFor="yards-override" className="text-sm whitespace-nowrap">Yards:</Label>
                  <Input
                    id="yards-override"
                    type="number"
                    min="1"
                    max="100"
                    value={calc.yards}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setYardOverride(isNaN(v) ? null : v);
                    }}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">× ${calc.pricePerYard.toFixed(2)}/yd</span>
                  {yardOverride !== null && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setYardOverride(null)}
                    >
                      Reset to auto ({calc.tier.yards})
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2 pt-2">
                  {(Object.entries(YARD_TIERS) as [VehicleSize, typeof YARD_TIERS[VehicleSize]][]).map(([key, tier]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setYardOverride(tier.yards)}
                      className={`text-xs p-2 rounded-md border transition-colors ${
                        calc.size === key && yardOverride === null
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-secondary/50"
                      }`}
                    >
                      <div className="flex items-center justify-center mb-1">{SIZE_ICONS[key]}</div>
                      <div className="font-semibold">{tier.label}</div>
                      <div className="text-muted-foreground">{tier.yards} yds</div>
                    </button>
                  ))}
                </div>
              </Card>
            ) : (
              <Card className="p-4 text-center text-sm text-muted-foreground">
                Enter vehicle year/make/model first to see yardage and pricing.
              </Card>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cust-name">Your Name *</Label>
                <Input id="cust-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cust-email">Email *</Label>
                <Input id="cust-email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="cust-phone">Phone (optional)</Label>
              <Input id="cust-phone" type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground italic">
              Shipping address will be collected on the secure Stripe checkout page.
            </p>
            <div>
              <Label htmlFor="notes-printed">Notes (optional)</Label>
              <Textarea
                id="notes-printed"
                placeholder="Special requests, color tweaks, etc."
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <Button
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
              size="lg"
              disabled={submitting || !calc || !customerName || !customerEmail}
              onClick={() => submitOrder("printed_wrap")}
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Pay with Stripe {calc && `— $${calc.totalPrice.toFixed(2)}`}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Secure checkout via Stripe · Apple Pay, Google Pay, and cards accepted
            </p>
          </TabsContent>

          {/* ── DESIGN FILE ONLY TAB ─────────────────────────────── */}
          <TabsContent value="design" className="space-y-4 mt-4">
            <div className="text-xs text-muted-foreground bg-purple-500/10 border border-purple-500/30 rounded-md p-3">
              <p className="font-semibold text-purple-400 mb-1">Design File — Print at Your Shop</p>
              <p>
                Get the print-ready high-resolution tileable file delivered to your inbox. No shipping. Print on your own
                vinyl with your shop's printer.
              </p>
            </div>

            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold">Print-Ready Design File</p>
                <p className="text-xs text-muted-foreground">High-res tileable PNG, no watermark</p>
              </div>
              <p className="text-2xl font-bold text-primary">${DESIGN_FILE_PRICE.toFixed(2)}</p>
            </Card>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cust-name-d">Your Name *</Label>
                <Input id="cust-name-d" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cust-email-d">Email *</Label>
                <Input id="cust-email-d" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="notes-design">Notes (optional)</Label>
              <Textarea
                id="notes-design"
                placeholder="Shop name, special requests, etc."
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <Button
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
              size="lg"
              disabled={submitting || !customerName || !customerEmail}
              onClick={() => submitOrder("design_file")}
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Pay with Stripe — ${DESIGN_FILE_PRICE.toFixed(2)}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Secure checkout via Stripe · File emailed within 24 hours
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
