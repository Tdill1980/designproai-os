import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Check, Loader2, Ruler, Package } from "lucide-react";
import { cn } from "@/lib/utils";

interface SizeRecommendationProps {
  designId: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear?: string;
  onPurchase: (selection: ProductionSelection) => void;
  isProcessing?: boolean;
}

export interface ProductionSelection {
  selectedSize: string;
  recommendedSize: string;
  sizeWasOverridden: boolean;
  includeHood: boolean;
  includeFrontBumper: boolean;
  includeRearPlusBumper: boolean;
  roofSize: string;
  customerOrderNumber: string;
  totalPriceCents: number;
}

const SIZE_DISPLAY: Record<string, { label: string; description: string }> = {
  S: { label: "Small", description: "Cars up to 144\" side length" },
  M: { label: "Medium", description: "Mid-size cars up to 172\" side length" },
  L: { label: "Large", description: "Full-size cars/SUVs up to 200\" side length" },
  XL: { label: "Extra Large", description: "Trucks & large SUVs over 200\" side length" },
};

export default function SizeRecommendation({
  designId,
  vehicleMake,
  vehicleModel,
  vehicleYear,
  onPurchase,
  isProcessing = false,
}: SizeRecommendationProps) {
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [includeHood, setIncludeHood] = useState(false);
  const [includeFrontBumper, setIncludeFrontBumper] = useState(false);
  const [includeRearPlusBumper, setIncludeRearPlusBumper] = useState(false);
  const [roofSize, setRoofSize] = useState("none");
  const [customerOrderNumber, setCustomerOrderNumber] = useState("");

  // Fetch vehicle recommendation
  const { data: recommendation, isLoading } = useQuery({
    queryKey: ["vehicle-recommendation", vehicleMake, vehicleModel, vehicleYear],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "get-vehicle-recommendation",
        {
          body: {
            make: vehicleMake,
            model: vehicleModel,
            year: vehicleYear,
          },
        }
      );
      if (error) throw error;
      return data;
    },
    enabled: !!vehicleMake && !!vehicleModel,
  });

  // Auto-select recommended size when data loads
  useEffect(() => {
    if (recommendation?.found && recommendation.recommended_size && !selectedSize) {
      setSelectedSize(recommendation.recommended_size);
    }
  }, [recommendation, selectedSize]);

  // Auto-select recommended roof size
  useEffect(() => {
    if (recommendation?.roof_dimensions?.recommended_roof_size && roofSize === "none") {
      // Don't auto-select roof - let user opt in
    }
  }, [recommendation, roofSize]);

  // Calculate total price
  const calculateTotal = () => {
    if (!selectedSize || !recommendation?.all_sizes) return 0;
    const sizeData = recommendation.all_sizes.find(
      (s: any) => s.code === selectedSize
    );
    let total = sizeData?.price_cents || 0;
    if (includeHood) total += recommendation.hood_price_cents || 16000;
    if (includeFrontBumper) total += recommendation.front_bumper_price_cents || 20000;
    if (includeRearPlusBumper) total += recommendation.rear_plus_bumper_price_cents || 39500;
    if (roofSize !== "none") {
      const roofData = recommendation.roof_sizes?.find(
        (r: any) => r.code === roofSize
      );
      if (roofData) total += roofData.price_cents;
    }
    return total;
  };

  const totalCents = calculateTotal();
  const isOverridden =
    selectedSize !== null &&
    recommendation?.recommended_size &&
    selectedSize !== recommendation.recommended_size;

  const handlePurchase = () => {
    if (!selectedSize) return;
    onPurchase({
      selectedSize,
      recommendedSize: recommendation?.recommended_size || selectedSize,
      sizeWasOverridden: isOverridden || false,
      includeHood,
      includeFrontBumper,
      includeRearPlusBumper,
      roofSize,
      customerOrderNumber,
      totalPriceCents: totalCents,
    });
  };

  if (isLoading) {
    return (
      <Card className="border-blue-500/20">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-blue-400 mr-3" />
          <span className="text-muted-foreground">
            Looking up dimensions for your {vehicleYear} {vehicleMake} {vehicleModel}...
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Vehicle Info Banner */}
      <Card className="border-blue-500/20 bg-blue-950/20">
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <Ruler className="h-5 w-5 text-blue-400" />
            <div>
              <p className="font-semibold text-foreground">
                {recommendation?.found
                  ? recommendation.vehicle
                  : `${vehicleYear || ""} ${vehicleMake} ${vehicleModel}`}
              </p>
              {recommendation?.found && (
                <p className="text-sm text-muted-foreground">
                  Side width: {recommendation.side_width}" | Total coverage:{" "}
                  {recommendation.corrected_sqft || recommendation.total_sqft} sq ft
                </p>
              )}
              {!recommendation?.found && (
                <p className="text-sm text-amber-400">
                  {recommendation?.message || "Vehicle dimensions not in database. Please select a size manually."}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Size Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-400" />
            Select Production Size
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(recommendation?.all_sizes || []).map((size: any) => {
              const isSelected = selectedSize === size.code;
              const isRecommended = size.is_recommended;
              const display = SIZE_DISPLAY[size.code];

              return (
                <button
                  key={size.code}
                  onClick={() => setSelectedSize(size.code)}
                  className={cn(
                    "relative rounded-lg border-2 p-4 text-left transition-all",
                    isSelected
                      ? "border-blue-500 bg-blue-950/30 shadow-lg shadow-blue-500/10"
                      : "border-border hover:border-blue-500/50 hover:bg-muted/50",
                    isRecommended && !isSelected && "border-blue-500/30"
                  )}
                >
                  {isRecommended && (
                    <Badge className="absolute -top-2.5 left-3 bg-blue-500 text-white text-[10px] px-2 py-0.5">
                      Recommended
                    </Badge>
                  )}
                  <div className="mt-1">
                    <p className="font-bold text-lg text-foreground">
                      {display?.label || size.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {size.panel_width}" × {size.panel_height}"
                    </p>
                    <p className="text-sm font-semibold text-blue-400 mt-2">
                      ${(size.price_cents / 100).toFixed(0)}
                    </p>
                  </div>
                  {isSelected && (
                    <Check className="absolute top-3 right-3 h-4 w-4 text-blue-400" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Size override warning */}
          {isOverridden && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-950/20 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-300">
                The recommended size for your {vehicleMake} {vehicleModel} is{" "}
                <strong>
                  {SIZE_DISPLAY[recommendation.recommended_size]?.label}
                </strong>
                . Your selected size may not provide full coverage.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add-Ons */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add-On Panels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Hood */}
            <label className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
              <Checkbox
                checked={includeHood}
                onCheckedChange={(checked) => setIncludeHood(checked === true)}
              />
              <div className="flex-1">
                <p className="font-medium text-sm">Hood</p>
                <p className="text-xs text-muted-foreground">72" × 59.5"</p>
              </div>
              <span className="text-sm font-semibold text-blue-400">+$160</span>
            </label>

            {/* Front Bumper */}
            <label className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
              <Checkbox
                checked={includeFrontBumper}
                onCheckedChange={(checked) =>
                  setIncludeFrontBumper(checked === true)
                }
              />
              <div className="flex-1">
                <p className="font-medium text-sm">Front Bumper</p>
                <p className="text-xs text-muted-foreground">120.5" × 38"</p>
              </div>
              <span className="text-sm font-semibold text-blue-400">+$200</span>
            </label>

            {/* Rear + Bumper */}
            <label className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
              <Checkbox
                checked={includeRearPlusBumper}
                onCheckedChange={(checked) =>
                  setIncludeRearPlusBumper(checked === true)
                }
              />
              <div className="flex-1">
                <p className="font-medium text-sm">Rear + Bumper</p>
                <p className="text-xs text-muted-foreground">
                  72.5" × 59" + 120" × 38"
                </p>
              </div>
              <span className="text-sm font-semibold text-blue-400">+$395</span>
            </label>
          </div>

          {/* Roof Size */}
          <div>
            <Label className="text-sm font-medium">Roof Panel</Label>
            <Select value={roofSize} onValueChange={setRoofSize}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="No roof panel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No roof panel</SelectItem>
                {(recommendation?.roof_sizes || []).map((r: any) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.label} ({r.panel_width}" × 59.5") - $
                    {(r.price_cents / 100).toFixed(0)}
                    {r.is_recommended ? " (Recommended)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Customer Order Number */}
      <Card>
        <CardContent className="py-4">
          <Label htmlFor="customer-po" className="text-sm font-medium">
            Your PO or Reference Number (optional)
          </Label>
          <Input
            id="customer-po"
            value={customerOrderNumber}
            onChange={(e) => setCustomerOrderNumber(e.target.value)}
            placeholder="Enter your PO or reference number for your records"
            className="mt-1.5"
          />
          <p className="text-xs text-muted-foreground mt-1">
            This is for your records only. We'll also assign an RP- order number
            automatically.
          </p>
        </CardContent>
      </Card>

      {/* Price Summary + Purchase */}
      <Card className="border-blue-500/30 bg-gradient-to-r from-blue-950/30 to-blue-950/30">
        <CardContent className="py-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-foreground">
                ${(totalCents / 100).toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground">
                Print-ready production files for your{" "}
                {vehicleYear} {vehicleMake} {vehicleModel}
              </p>
            </div>
            <Button
              size="lg"
              disabled={!selectedSize || isProcessing}
              onClick={handlePurchase}
              className="bg-gradient-blue hover:opacity-90 px-8"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                "Purchase Production Pack"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
