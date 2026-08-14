import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calculator, Ruler, Package, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ColorZone {
  zone: string;
  color: string;
  finish: string;
  percentageOfVehicle: number;
  yardsEstimate: number;
}

export interface MaterialEstimate {
  totalYards: number;
  totalSquareFeet: number;
  vehicleCategory: string;
  zones: ColorZone[];
}

interface MaterialEstimateDisplayProps {
  estimate: MaterialEstimate | null;
  isCalculating?: boolean;
  className?: string;
}

const ZONE_COLORS: Record<string, string> = {
  hood: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  roof: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  body: "bg-green-500/20 text-green-400 border-green-500/30",
  bumpers: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  mirrors: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  trim: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  accents: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  stripes: "bg-red-500/20 text-red-400 border-red-500/30",
  doors: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  fenders: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  trunk: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

const getZoneColorClass = (zone: string): string => {
  const lowerZone = zone.toLowerCase();
  for (const [key, value] of Object.entries(ZONE_COLORS)) {
    if (lowerZone.includes(key)) return value;
  }
  return "bg-muted text-muted-foreground border-border";
};

export const MaterialEstimateDisplay = ({
  estimate,
  isCalculating = false,
  className
}: MaterialEstimateDisplayProps) => {
  if (isCalculating) {
    return (
      <Card className={cn("p-4 bg-secondary/30 border-border/50", className)}>
        <div className="flex items-center justify-center gap-3 py-6">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Calculating material requirements...</span>
        </div>
      </Card>
    );
  }

  if (!estimate || estimate.zones.length === 0) {
    return null;
  }

  // Group zones by color for summary
  const colorSummary = estimate.zones.reduce((acc, zone) => {
    const key = `${zone.color} (${zone.finish})`;
    if (!acc[key]) {
      acc[key] = { yards: 0, zones: [] as string[] };
    }
    acc[key].yards += zone.yardsEstimate;
    acc[key].zones.push(zone.zone);
    return acc;
  }, {} as Record<string, { yards: number; zones: string[] }>);

  return (
    <Card className={cn("p-4 bg-secondary/30 border-border/50", className)}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calculator className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Material Estimate</span>
          </div>
          <Badge variant="outline" className="text-xs">
            {estimate.vehicleCategory}
          </Badge>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-background/50 rounded-lg p-3 border border-border/30">
            <div className="flex items-center gap-2 mb-1">
              <Ruler className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Yards</span>
            </div>
            <p className="text-xl font-bold text-primary">{estimate.totalYards}</p>
          </div>
          <div className="bg-background/50 rounded-lg p-3 border border-border/30">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Sq Ft</span>
            </div>
            <p className="text-xl font-bold text-foreground">{estimate.totalSquareFeet}</p>
          </div>
        </div>

        {/* Per-Color Breakdown */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Per-Color Breakdown:</p>
          <div className="space-y-2">
            {Object.entries(colorSummary).map(([color, data]) => (
              <div
                key={color}
                className="bg-background/30 rounded-lg p-3 border border-border/30"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{color}</span>
                  <span className="text-sm font-bold text-primary">{data.yards.toFixed(1)} yds</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {data.zones.map((zone) => (
                    <Badge
                      key={zone}
                      variant="outline"
                      className={cn("text-xs", getZoneColorClass(zone))}
                    >
                      {zone}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Zone Details */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Zone Details:</p>
          <div className="grid gap-2">
            {estimate.zones.map((zone, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between bg-background/20 rounded px-3 py-2 border border-border/20"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn("text-xs", getZoneColorClass(zone.zone))}
                  >
                    {zone.zone}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {zone.color} ({zone.finish})
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {zone.percentageOfVehicle}%
                  </span>
                  <span className="text-xs font-medium text-primary">
                    {zone.yardsEstimate.toFixed(1)} yds
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-xs text-muted-foreground/60 italic">
          * Estimates include 15% waste factor. Actual requirements may vary based on installer technique.
        </p>
      </div>
    </Card>
  );
};
