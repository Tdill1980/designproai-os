import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Package, Truck, Printer, Ruler, ShoppingCart, ExternalLink,
  ChevronRight, Star, Shield, Zap, Calculator,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── WePrintWraps Product Catalog ──

const WPW_BASE = "https://weprintwraps.com";

interface WPWProduct {
  id: number;
  name: string;
  shortName: string;
  description: string;
  priceType: "sqft" | "flat" | "yard" | "each";
  price: number;
  unit: string;
  category: "film" | "contour" | "fade" | "design" | "accessory" | "wbty" | "designpanel";
  badge?: string;
  badgeColor?: string;
}

const PRODUCTS: WPWProduct[] = [
  // Print Films
  { id: 79, name: "Printed Wrap Film with UV Lamination (Avery)", shortName: "Avery Printed + UV Lam", description: "Printed on Avery Brand Film with UV lamination for outdoor durability", priceType: "sqft", price: 5.27, unit: "sq ft", category: "film", badge: "Best Value", badgeColor: "emerald" },
  { id: 72, name: "3M IJ180 Printed Wrap Film | Wholesale", shortName: "3M IJ180 Printed", description: "Premium 3M IJ180 printed wrap film for professional installations", priceType: "sqft", price: 0, unit: "sq ft", category: "film", badge: "Premium", badgeColor: "blue" },

  // Contour-Cut (Install-Ready)
  { id: 108, name: "Avery Contour-Cut Wrap Film – Weeded & Masked", shortName: "Avery Contour-Cut", description: "Install-ready: weeded, masked, and contour-cut on Avery film", priceType: "sqft", price: 6.32, unit: "sq ft", category: "contour", badge: "Install-Ready", badgeColor: "cyan" },
  { id: 19420, name: "3M IJ180 Contour-Cut Wrap Film – Weeded & Masked", shortName: "3M Contour-Cut", description: "Premium 3M IJ180 contour-cut, weeded and masked — ready to install", priceType: "sqft", price: 6.95, unit: "sq ft", category: "contour", badge: "Premium Install-Ready", badgeColor: "violet" },

  // Specialty
  { id: 58391, name: "Custom Fade Wrap Printing | Avery Film", shortName: "Custom Fade Wrap", description: "Starting at $600 for 2 sides. Printed on Avery film.", priceType: "flat", price: 600, unit: "2 sides", category: "fade", badge: "FadeWraps", badgeColor: "amber" },
  { id: 80, name: "Perforated Window Vinyl 50/50 Unlaminated 54\" Roll", shortName: "Perf Window Vinyl", description: "50/50 perforation, max print 53.5\". Unlaminated.", priceType: "sqft", price: 5.95, unit: "sq ft", category: "film" },

  // Custom Design
  { id: 234, name: "Custom Vehicle Wrap Design", shortName: "Custom Design", description: "Full custom wrap design by a professional designer", priceType: "flat", price: 500, unit: "flat", category: "design" },

  // DesignPanelPro Print Packs (RestyleLibrary printing)
  { id: 69664, name: "DesignPanelPro™ – Small Print Production Pack", shortName: "Small Print Pack", description: "Print production for small vehicles (compact cars)", priceType: "flat", price: 600, unit: "pack", category: "designpanel", badge: "Small", badgeColor: "cyan" },
  { id: 69671, name: "DesignPanelPro™ – Medium Print Production Pack", shortName: "Medium Print Pack", description: "Print production for mid-size vehicles (sedans, SUVs)", priceType: "flat", price: 600, unit: "pack", category: "designpanel", badge: "Medium", badgeColor: "violet" },
  { id: 69680, name: "DesignPanelPro™ – Large Print Production Pack", shortName: "Large Print Pack", description: "Print production for large vehicles (trucks, full-size SUVs)", priceType: "flat", price: 600, unit: "pack", category: "designpanel", badge: "Large", badgeColor: "amber" },
  { id: 69686, name: "DesignPanelPro™ – XLarge Print Production Pack", shortName: "XLarge Print Pack", description: "Print production for vans, sprinters, and box trucks", priceType: "flat", price: 600, unit: "pack", category: "designpanel", badge: "XLarge", badgeColor: "red" },

  // Wrap By The Yard
  { id: 42809, name: "Wrap By the Yard – Bape Camo", shortName: "WBTY Bape Camo", description: "Bape-style camo pattern, priced per yard", priceType: "yard", price: 95.50, unit: "yard", category: "wbty" },
  { id: 1726, name: "Wrap By The Yard – Camo & Carbon", shortName: "WBTY Camo & Carbon", description: "Camo and carbon fiber patterns, priced per yard", priceType: "yard", price: 95.50, unit: "yard", category: "wbty" },
  { id: 39698, name: "Wrap By The Yard – Metal & Marble", shortName: "WBTY Metal & Marble", description: "Metallic and marble patterns, priced per yard", priceType: "yard", price: 95.50, unit: "yard", category: "wbty" },
  { id: 52489, name: "Wrap By The Yard – Modern & Trippy", shortName: "WBTY Modern & Trippy", description: "Modern art and trippy patterns, priced per yard", priceType: "yard", price: 95.50, unit: "yard", category: "wbty" },

  // Accessories
  { id: 475, name: "Camo & Carbon Sample Book", shortName: "Camo & Carbon Samples", description: "Physical swatch book with camo and carbon fiber samples", priceType: "each", price: 26.50, unit: "each", category: "accessory" },
  { id: 39628, name: "Marble & Metals Swatch Book", shortName: "Marble & Metals Samples", description: "Physical swatch book with marble and metallic samples", priceType: "each", price: 26.50, unit: "each", category: "accessory" },
  { id: 4179, name: "Wicked & Wild Swatch Book", shortName: "Wicked & Wild Samples", description: "Physical swatch book with bold graphic samples", priceType: "each", price: 26.50, unit: "each", category: "accessory" },
  { id: 15192, name: "Pantone Color Chart 30\" x 52\"", shortName: "Pantone Chart", description: "Full Pantone color reference chart, 30\" x 52\"", priceType: "each", price: 42, unit: "each", category: "accessory" },
];

// ── Vehicle Sizes (sq ft estimates) ──
const VEHICLE_SIZES = [
  { value: "compact", label: "Compact (Civic, Corolla)", sqft: 150 },
  { value: "midsize", label: "Mid-Size (Camry, Accord)", sqft: 200 },
  { value: "fullsize", label: "Full-Size (Charger, 5-Series)", sqft: 250 },
  { value: "suv-mid", label: "Mid-Size SUV (RAV4, CR-V)", sqft: 225 },
  { value: "suv-full", label: "Full-Size SUV (Tahoe, X5)", sqft: 300 },
  { value: "truck-mid", label: "Mid-Size Truck (Tacoma, Ranger)", sqft: 275 },
  { value: "truck-full", label: "Full-Size Truck (F-150, RAM)", sqft: 325 },
  { value: "van", label: "Van / Sprinter / Transit", sqft: 400 },
  { value: "sports", label: "Sports Car (Mustang, 911)", sqft: 175 },
  { value: "exotic", label: "Exotic / Supercar", sqft: 200 },
];

type CategoryFilter = "all" | "film" | "contour" | "fade" | "designpanel" | "wbty" | "accessory" | "design";

export default function PrintProShop() {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [vehicleSize, setVehicleSize] = useState("");
  const [customSqft, setCustomSqft] = useState("");

  const selectedVehicle = VEHICLE_SIZES.find((v) => v.value === vehicleSize);
  const sqft = customSqft ? parseInt(customSqft) : (selectedVehicle?.sqft || 0);

  const filtered = category === "all" ? PRODUCTS : PRODUCTS.filter((p) => p.category === category);

  const getCartUrl = (productId: number) => `${WPW_BASE}/?add-to-cart=${productId}`;

  const getEstimate = (product: WPWProduct) => {
    if (product.priceType === "sqft" && product.price > 0 && sqft > 0) {
      return `$${(product.price * sqft).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return null;
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>PrintPro Shop — Print Your Vehicle Wrap | WePrintWraps x RestyleProAI</title>
        <meta name="description" content="Get your vehicle wrap design printed and shipped. Avery and 3M films, contour-cut install-ready, fade wraps, and custom designs. Free shipping. Powered by WePrintWraps.com." />
      </Helmet>

      <main className="flex-1 container mx-auto px-4 py-6 pt-20">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Print<span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">Pro</span> Shop
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              Get your wrap printed and shipped. Powered by <a href="https://weprintwraps.com" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">WePrintWraps.com</a>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-400" />
            <span className="text-xs text-zinc-500">Avery Dennison & 3M Certified</span>
          </div>
        </div>

        {/* Sq Ft Calculator */}
        <div className="mb-6 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="h-4 w-4 text-emerald-400" />
            <span className="text-sm font-bold text-foreground">Estimate Your Print Cost</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={vehicleSize} onValueChange={(v) => { setVehicleSize(v); setCustomSqft(""); }}>
              <SelectTrigger className="flex-1 bg-background border-border">
                <SelectValue placeholder="Select vehicle size..." />
              </SelectTrigger>
              <SelectContent>
                {VEHICLE_SIZES.map((v) => (
                  <SelectItem key={v.value} value={v.value}>{v.label} (~{v.sqft} sq ft)</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 whitespace-nowrap">or enter:</span>
              <Input
                type="number"
                placeholder="Sq ft"
                value={customSqft}
                onChange={(e) => { setCustomSqft(e.target.value); setVehicleSize(""); }}
                className="w-24 bg-background border-border text-center"
              />
            </div>
            {sqft > 0 && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shrink-0 self-center">
                <Ruler className="h-3 w-3 mr-1" /> {sqft} sq ft
              </Badge>
            )}
          </div>
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-2 mb-6">
          {([
            { value: "all", label: "All Products" },
            { value: "film", label: "Print Films" },
            { value: "contour", label: "Contour-Cut" },
            { value: "fade", label: "Fade Wraps" },
            { value: "designpanel", label: "DesignPanelPro" },
            { value: "wbty", label: "Wrap By The Yard" },
            { value: "design", label: "Custom Design" },
            { value: "accessory", label: "Accessories" },
          ] as { value: CategoryFilter; label: string }[]).map((cat) => (
            <Button
              key={cat.value}
              size="sm"
              variant={category === cat.value ? "default" : "outline"}
              className={cn(
                "text-xs min-h-[36px]",
                category === cat.value && "bg-emerald-600 hover:bg-emerald-700 text-white",
              )}
              onClick={() => setCategory(cat.value)}
            >
              {cat.label}
            </Button>
          ))}
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-16">
          {filtered.map((product) => {
            const estimate = getEstimate(product);

            return (
              <div
                key={product.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 hover:border-emerald-500/30 transition-all overflow-hidden"
              >
                <div className="p-4 space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-foreground text-sm leading-tight">{product.shortName}</p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">ID: {product.id}</p>
                    </div>
                    {product.badge && (
                      <Badge className={cn(
                        "text-[9px] shrink-0",
                        product.badgeColor === "emerald" && "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
                        product.badgeColor === "blue" && "bg-blue-500/20 text-blue-400 border-blue-500/30",
                        product.badgeColor === "cyan" && "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
                        product.badgeColor === "violet" && "bg-violet-500/20 text-violet-400 border-violet-500/30",
                        product.badgeColor === "amber" && "bg-amber-500/20 text-amber-400 border-amber-500/30",
                        product.badgeColor === "red" && "bg-red-500/20 text-red-400 border-red-500/30",
                      )}>
                        {product.badge}
                      </Badge>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-[11px] text-zinc-400 leading-relaxed">{product.description}</p>

                  {/* Pricing */}
                  <div className="flex items-end justify-between">
                    <div>
                      {product.price > 0 ? (
                        <>
                          <span className="text-2xl font-bold text-foreground">${product.price.toFixed(2)}</span>
                          <span className="text-xs text-zinc-500 ml-1">/ {product.unit}</span>
                        </>
                      ) : (
                        <span className="text-lg font-bold text-foreground">Contact for pricing</span>
                      )}
                    </div>
                    {estimate && (
                      <div className="text-right">
                        <p className="text-[10px] text-zinc-500">Estimated total</p>
                        <p className="text-lg font-bold text-emerald-400">{estimate}</p>
                      </div>
                    )}
                  </div>

                  {/* Add to Cart */}
                  <a
                    href={getCartUrl(product.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button className="w-full gap-2 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white min-h-[44px]">
                      <ShoppingCart className="h-4 w-4" />
                      {product.priceType === "sqft" && sqft > 0
                        ? `Order ${sqft} sq ft on WePrintWraps`
                        : "Order on WePrintWraps"
                      }
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Trust Strip */}
        <div className="text-center mb-8">
          <p className="text-[10px] text-zinc-600">
            All printing and fulfillment handled by WePrintWraps.com. Avery Dennison MPI 1105 EARS standard media. Free shipping on most orders. Ships worldwide.
          </p>
        </div>
      </main>
    </div>
  );
}
