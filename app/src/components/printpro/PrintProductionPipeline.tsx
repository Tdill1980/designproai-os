import { useState } from "react";
import {
  PrintProCard,
  PrintProCardHeader,
  PrintProCardTitle,
  PrintProCardDescription,
  PrintProCardContent,
} from "./PrintProCard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ShoppingCart, Ruler, Car, CreditCard } from "lucide-react";
import { useNavigate } from "react-router-dom";
import VehicleSelector from "./VehicleSelector";
import { VehicleMeasurement, PanelBreakdown, calculatePricingTier } from "@/data/vehicle-measurements";
import { trackQuoteEvent, generateQuoteId } from "@/lib/track-conversion";

const PrintProductionPipeline = () => {
  const navigate = useNavigate();
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleMeasurement | null>(null);
  const [breakdown, setBreakdown] = useState<PanelBreakdown | null>(null);

  const handleVehicleSelect = (vehicle: VehicleMeasurement | null, bd: PanelBreakdown | null) => {
    setSelectedVehicle(vehicle);
    setBreakdown(bd);
  };

  const pricing = selectedVehicle?.sideW != null ? calculatePricingTier(selectedVehicle.sideW) : null;

  const handleOrderProduction = () => {
    if (!selectedVehicle || !breakdown || !pricing) return;

    trackQuoteEvent({
      eventType: "order_now_clicked",
      quoteId: generateQuoteId(),
      productType: "production_pipeline",
      metadata: {
        vehicle: `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`,
        correctedSqFt: breakdown.corrected,
        tier: pricing.tier,
        price: pricing.price,
        panelBreakdown: breakdown,
      },
    });

    window.open(
      `https://weprintwraps.com/cart/?add-to-cart=PRODUCTION_PACK&tier=${pricing.tier}&sqft=${breakdown.corrected}&price=${pricing.price}&vehicle=${encodeURIComponent(`${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`)}`,
      "_blank"
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Back button */}
        <Button
          variant="ghost"
          onClick={() => navigate("/printpro")}
          className="mb-6"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Products
        </Button>

        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
            Print<span className="bg-gradient-to-r from-[#D946EF] to-[#9b87f5] bg-clip-text text-transparent">Pro</span>™ Production Pipeline
          </h1>
          <p className="text-lg text-muted-foreground mt-2">
            Select your vehicle for exact panel measurements and production pricing
          </p>
        </div>

        {/* Step 1: Vehicle Selection */}
        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-[#D946EF] to-[#9b87f5] text-white text-sm font-bold">
                1
              </div>
              <div>
                <PrintProCardTitle className="text-lg flex items-center gap-2">
                  <Car className="h-5 w-5" /> Select Your Vehicle
                </PrintProCardTitle>
                <PrintProCardDescription>
                  Choose your make, model, and year to get exact panel measurements
                </PrintProCardDescription>
              </div>
            </div>
          </PrintProCardHeader>
          <PrintProCardContent>
            <VehicleSelector onVehicleSelect={handleVehicleSelect} />
          </PrintProCardContent>
        </PrintProCard>

        {/* Step 2: Panel Breakdown (shown when vehicle selected) */}
        {breakdown && selectedVehicle && (
          <PrintProCard className="mb-8">
            <PrintProCardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-[#D946EF] to-[#9b87f5] text-white text-sm font-bold">
                  2
                </div>
                <div>
                  <PrintProCardTitle className="text-lg flex items-center gap-2">
                    <Ruler className="h-5 w-5" /> Panel Measurements
                  </PrintProCardTitle>
                  <PrintProCardDescription>
                    Detailed measurements for {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
                  </PrintProCardDescription>
                </div>
              </div>
            </PrintProCardHeader>
            <PrintProCardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-3 text-muted-foreground font-medium">Panel</th>
                      <th className="text-center p-3 text-muted-foreground font-medium">Width (in)</th>
                      <th className="text-center p-3 text-muted-foreground font-medium">Height/Length (in)</th>
                      <th className="text-right p-3 text-muted-foreground font-medium">Sq Ft</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border/50">
                      <td className="p-3 font-medium">Side (each)</td>
                      <td className="p-3 text-center">{selectedVehicle.sideW ?? "-"}</td>
                      <td className="p-3 text-center">{selectedVehicle.sideH ?? "-"}</td>
                      <td className="p-3 text-right font-mono">{selectedVehicle.sideSqFt ?? "-"}</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="p-3 font-medium">Back</td>
                      <td className="p-3 text-center">{selectedVehicle.backW ?? "-"}</td>
                      <td className="p-3 text-center">{selectedVehicle.backH ?? "-"}</td>
                      <td className="p-3 text-right font-mono">{selectedVehicle.backSqFt ?? "-"}</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="p-3 font-medium">Hood</td>
                      <td className="p-3 text-center">{selectedVehicle.hoodW ?? "-"}</td>
                      <td className="p-3 text-center">{selectedVehicle.hoodL ?? "-"}</td>
                      <td className="p-3 text-right font-mono">{selectedVehicle.hoodSqFt ?? "-"}</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium">Roof</td>
                      <td className="p-3 text-center">{selectedVehicle.roofW ?? "-"}</td>
                      <td className="p-3 text-center">{selectedVehicle.roofL ?? "-"}</td>
                      <td className="p-3 text-right font-mono">{selectedVehicle.roofSqFt ?? "-"}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border">
                      <td colSpan={3} className="p-3 font-bold">Corrected Total</td>
                      <td className="p-3 text-right font-bold font-mono text-lg">{breakdown.corrected} ft²</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </PrintProCardContent>
          </PrintProCard>
        )}

        {/* Step 3: Order (shown when vehicle selected) */}
        {pricing && breakdown && selectedVehicle && (
          <PrintProCard className="mb-8">
            <PrintProCardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-[#D946EF] to-[#9b87f5] text-white text-sm font-bold">
                  3
                </div>
                <div>
                  <PrintProCardTitle className="text-lg flex items-center gap-2">
                    <CreditCard className="h-5 w-5" /> Production Pricing
                  </PrintProCardTitle>
                  <PrintProCardDescription>
                    Based on {selectedVehicle.sideW}" side width
                  </PrintProCardDescription>
                </div>
              </div>
            </PrintProCardHeader>
            <PrintProCardContent>
              <div className="space-y-6">
                {/* Tier breakdown */}
                <div className="space-y-2 text-sm">
                  {[
                    { t: "small", l: "Small (144×59.5)", range: "side width under 144\"", p: 600 },
                    { t: "medium", l: "Medium (172×59.5)", range: "side width 144\"–172\"", p: 710 },
                    { t: "large", l: "Large (200×59.5)", range: "side width 172\"–200\"", p: 825 },
                    { t: "xl", l: "XL (240×59.5)", range: "side width 200\"+", p: 990 },
                  ].map(({ t, l, range, p }) => (
                    <div
                      key={t}
                      className={`flex justify-between items-center py-3 px-4 rounded-lg border ${
                        pricing.tier === t
                          ? "border-[#9b87f5] bg-gradient-to-r from-[#D946EF]/10 to-[#9b87f5]/10"
                          : "border-border"
                      }`}
                    >
                      <div>
                        <span className={pricing.tier === t ? "font-bold text-foreground" : "text-muted-foreground"}>
                          {l}
                        </span>
                        <span className="text-muted-foreground ml-2 text-xs">({range})</span>
                      </div>
                      <span className={pricing.tier === t ? "font-bold text-primary text-lg" : "font-medium"}>
                        ${p}
                      </span>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <Button
                  size="lg"
                  className="w-full py-6 text-lg bg-gradient-to-r from-[#D946EF] to-[#9b87f5] hover:opacity-90"
                  onClick={handleOrderProduction}
                >
                  <ShoppingCart className="mr-2 h-5 w-5" />
                  Order Production Pack - ${pricing.price}
                </Button>
              </div>
            </PrintProCardContent>
          </PrintProCard>
        )}
      </div>
    </div>
  );
};

export default PrintProductionPipeline;
