import { useState, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Shield, Loader2, CheckCircle2, Clock,
  AlertTriangle, Package, Search, Lock,
  Archive, Store, Link2, RefreshCw,
  Sparkles, Pencil, Gem, Star,
  BadgeCheck, Printer, ShieldCheck,
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { DesignIDBadge, PaletteIcon, ThumbprintIcon } from "@/components/DesignIDBadge";
import { useOrganization } from "@/contexts/OrganizationContext";
import { didFromPack } from "@/lib/designId";

/** How many days a render survives without a production pack */
const RENDER_EXPIRY_DAYS = 30;

/** Keywords that signal a branded/commercial design */
const BRANDED_KEYWORDS = [
  "commercial", "logo", "brand", "company", "business", "fleet",
  "llc", "inc", "corp", "plumber", "plumbing", "electrician", "electrical",
  "dentist", "dental", "hvac", "roofing", "roofer", "contractor",
  "landscaping", "lawn", "cleaning", "pest", "towing", "moving",
  "pizza", "restaurant", "bakery", "coffee", "catering", "food truck",
  "salon", "spa", "gym", "fitness", "realtor", "real estate",
  "auto repair", "mechanic", "locksmith", "painting", "security",
];

function isBrandedDesign(designName: string): boolean {
  const nameLower = (designName || "").toLowerCase();
  return BRANDED_KEYWORDS.some((kw) => nameLower.includes(kw));
}

interface VaultDesign {
  id: string;
  thumbnailUrl: string | null;
  packUrl: string | null;
  vehicleLabel: string;
  designName: string;
  finishType: string;
  fileCount: number;
  upscaleStatus: string | null;
  upscaleProgress: string | null;
  createdAt: string;
  panelsSelected?: any;
  isBranded: boolean;
  isStarred: boolean;
  avgRating: number;
  totalRatings: number;
}

interface ExpiringRender {
  id: string;
  vehicleLabel: string;
  colorName: string;
  finishType: string;
  heroUrl: string | null;
  createdAt: string;
  daysRemaining: number;
}

export default function DesignVault() {
  const navigate = useNavigate();
  const { currentShopProfileId } = useOrganization();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "vehicle">("newest");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [reconfigureDesign, setReconfigureDesign] = useState<VaultDesign | null>(null);
  const [reconfigureYear, setReconfigureYear] = useState("");
  const [reconfigureMake, setReconfigureMake] = useState("");
  const [reconfigureModel, setReconfigureModel] = useState("");

  // ── Fetch starred production packs scoped to the current shop profile ──
  // production_packs.shop_id still references shop_profiles(id) pre-#1039,
  // so we filter on the current shop's owner shop_profile.
  const { data: productionPacks, isLoading: packsLoading } = useQuery({
    queryKey: ["design-vault-packs", currentShopProfileId],
    enabled: currentShopProfileId !== null,
    queryFn: async () => {
      if (!currentShopProfileId) return [];
      const { data, error } = await (supabase as any)
        .from("production_packs")
        .select("id, pack_url, thumbnail_url, file_count, upscale_status, upscale_progress, vehicle_info, design_name, finish_type, panels_selected, is_starred, created_at")
        .eq("shop_id", currentShopProfileId)
        .eq("is_starred", true)
        .order("created_at", { ascending: false });
      if (error) {
        if (/is_starred|column/.test(error.message || "")) {
          console.warn("DesignVault: is_starred column not found - run sql/add_production_packs_starred.sql to enable starring. Error:", error.message);
        } else {
          console.warn("production_packs query:", error);
        }
        return [];
      }
      return (data || []) as any[];
    },
    refetchInterval: (query) => {
      const packs = query.state.data as any[] | undefined;
      if (!packs) return false;
      return packs.some((p: any) => p.upscale_status === "processing") ? 4000 : false;
    },
  });

  // ── Fetch design DNA ratings for star badges ──
  const { data: designRatings } = useQuery({
    queryKey: ["design-vault-ratings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("neuralnetwork_design_dna")
        .select("id, vehicle_render_url, avg_rating, total_ratings")
        .gt("total_ratings", 0)
        .order("avg_rating", { ascending: false });
      if (error) { console.warn("design ratings query:", error); return []; }
      return (data || []) as any[];
    },
  });

  // ── Fetch recent renders to find expiring ones ──
  const { data: expiringRenders, isLoading: rendersLoading } = useQuery({
    queryKey: ["design-vault-expiring"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("color_visualizations")
        .select("id, vehicle_year, vehicle_make, vehicle_model, color_name, finish_type, render_urls, created_at")
        .eq("customer_email", user.email)
        .eq("generation_status", "completed")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) { console.warn("renders query:", error); return []; }

      // Get production pack visualization_ids to exclude already-owned
      const ownedVizIds = new Set(
        (productionPacks || []).map((p: any) => p.visualization_id).filter(Boolean)
      );

      const now = new Date();
      return (data || [])
        .filter((r: any) => !ownedVizIds.has(r.id))
        .map((r: any) => {
          const created = new Date(r.created_at);
          const daysRemaining = RENDER_EXPIRY_DAYS - differenceInDays(now, created);
          return {
            id: r.id,
            vehicleLabel: `${r.vehicle_year || ""} ${r.vehicle_make || ""} ${r.vehicle_model || ""}`.trim(),
            colorName: r.color_name || "Untitled",
            finishType: r.finish_type || "",
            heroUrl: r.render_urls?.hero || r.render_urls?.side || Object.values(r.render_urls || {})[0] || null,
            createdAt: r.created_at,
            daysRemaining,
          } as ExpiringRender;
        })
        .filter((r) => r.daysRemaining <= 10 && r.daysRemaining > 0);
    },
    enabled: !packsLoading,
  });

  // ── Normalize into VaultDesign array (production packs only - purchases belong in WrapBox) ──
  const vaultDesigns = useMemo<VaultDesign[]>(() => {
    const ratingsByUrl = new Map<string, { avg: number; count: number }>();
    (designRatings || []).forEach((r: any) => {
      if (r.vehicle_render_url) {
        ratingsByUrl.set(r.vehicle_render_url, { avg: r.avg_rating || 0, count: r.total_ratings || 0 });
      }
    });

    return (productionPacks || []).map((pack: any) => {
      const vInfo = pack.vehicle_info;
      const name = pack.design_name || "Production Pack";
      const rating = ratingsByUrl.get(pack.thumbnail_url) || { avg: 0, count: 0 };
      return {
        id: pack.id,
        thumbnailUrl: pack.thumbnail_url,
        packUrl: pack.pack_url,
        vehicleLabel: vInfo
          ? `${vInfo.year || ""} ${vInfo.make || ""} ${vInfo.model || ""}`.trim()
          : "Vehicle",
        designName: name,
        finishType: pack.finish_type || "",
        fileCount: pack.file_count || 0,
        upscaleStatus: pack.upscale_status,
        upscaleProgress: pack.upscale_progress,
        createdAt: pack.created_at,
        panelsSelected: pack.panels_selected,
        isBranded: isBrandedDesign(name),
        isStarred: pack.is_starred || false,
        avgRating: rating.avg,
        totalRatings: rating.count,
      } as VaultDesign;
    });
  }, [productionPacks, designRatings]);

  // ── Type filter helpers ──
  const TYPE_FILTERS = ["All", "ColorPro", "DesignPro", "FadeWraps", "RecreatePro"] as const;

  function matchesTypeFilter(d: VaultDesign, filter: string): boolean {
    if (filter === "All") return true;
    const nameLower = d.designName.toLowerCase();
    if (filter === "ColorPro") return nameLower.includes("color") || nameLower.includes("colorpro");
    if (filter === "DesignPro") return nameLower.includes("design") || nameLower.includes("designpro") || nameLower.includes("panel");
    if (filter === "FadeWraps") return nameLower.includes("fade") || nameLower.includes("gradient");
    if (filter === "RecreatePro") return nameLower.includes("recreate") || nameLower.includes("recreation");
    return true;
  }

  // ── Filter + Sort ──
  const displayDesigns = useMemo(() => {
    let filtered = vaultDesigns;

    // Type filter
    if (typeFilter !== "All") {
      filtered = filtered.filter((d) => matchesTypeFilter(d, typeFilter));
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.vehicleLabel.toLowerCase().includes(q) ||
          d.designName.toLowerCase().includes(q)
      );
    }

    return [...filtered].sort((a, b) => {
      if (sortBy === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return a.vehicleLabel.localeCompare(b.vehicleLabel);
    });
  }, [vaultDesigns, searchQuery, sortBy, typeFilter]);

  const isLoading = packsLoading || rendersLoading;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>DesignVault Plus - QC Stamped Production Packs | DesignProAI</title>
        <meta name="description" content="QC-stamped production packs with DesignID tracking, DesignEquity, and PrintReady verification. Every design is a sellable asset on CreatorMarket." />
        <link rel="canonical" href="https://designproai.com/designvault" />
      </Helmet>
      <main className="flex-1 container mx-auto px-4 py-8 pt-24">
        {/* ── Header ── */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600">
              <Shield className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-4xl font-bold text-foreground">
                Design<span className="text-gradient-blue">Vault</span> <span className="text-emerald-400 text-2xl font-semibold">Plus</span>
              </h1>
              <p className="text-muted-foreground">
                QC-Stamped production packs with DesignID tracking &amp; DesignEquity
              </p>
            </div>
          </div>
        </div>

        {/* ── DesignEquity • DesignID • PromptThumbprint ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
          <div className="flex items-center gap-3 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
            <Gem className="h-5 w-5 text-emerald-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">Design<span className="text-emerald-400">Equity</span></p>
              <p className="text-[11px] text-muted-foreground">Every render you own is a sellable asset - keep it, resell it, or list on CreatorMarket</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-[#00c8ff]/20 bg-[#00c8ff]/5">
            <span className="shrink-0"><PaletteIcon /></span>
            <div>
              <p className="text-sm font-semibold text-foreground">Design<span className="text-[#00c8ff]">ID</span></p>
              <p className="text-[11px] text-muted-foreground">Unique tamper-proof identifier tracking ownership, provenance, and sales history</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-[#00c8ff]/20 bg-[#00c8ff]/5">
            <span className="shrink-0"><ThumbprintIcon /></span>
            <div>
              <p className="text-sm font-semibold text-foreground">Prompt<span className="text-[#00c8ff]">Thumbprint</span></p>
              <p className="text-[11px] text-muted-foreground">AI prompt DNA hashed to prove authenticity - your creative recipe, sealed</p>
            </div>
          </div>
        </div>

        {/* ── Equity Summary ── */}
        {!isLoading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Card className="border-emerald-500/30">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <Lock className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{vaultDesigns.length}</p>
                  <p className="text-xs text-muted-foreground">Starred Designs</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-blue-500/30">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <CheckCircle2 className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {vaultDesigns.filter((d) => d.upscaleStatus === "complete").length}
                  </p>
                  <p className="text-xs text-muted-foreground">Print-Ready</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-purple-500/30">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Store className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {vaultDesigns.filter((d) => d.upscaleStatus === "complete").length}
                  </p>
                  <p className="text-xs text-muted-foreground">Market Ready</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-amber-500/30">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {(expiringRenders || []).length}
                  </p>
                  <p className="text-xs text-muted-foreground">Expiring Soon</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── CreatorMarket CTA ── */}
        {!isLoading && vaultDesigns.length > 0 && (
          <Card className="mb-8 border-violet-500/30 bg-gradient-to-r from-violet-500/5 via-indigo-500/5 to-purple-500/5 hover:border-violet-500/50 transition-all cursor-pointer"
            onClick={() => navigate("/creatormarket")}
          >
            <CardContent className="p-5">
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 shrink-0">
                  <Store className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground">Sell on CreatorMarket</h3>
                    <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 text-[10px]">
                      80/20 Split
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Turn your DesignEquity into passive income. List your designs on CreatorMarket.
                    You earn <span className="text-violet-400 font-semibold">60% of every sale</span>; the 40% platform cut funds Google + Meta ads that drive buyers.
                  </p>
                </div>
                <Button
                  className="bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white gap-2 shrink-0"
                  onClick={(e) => { e.stopPropagation(); navigate("/creatormarket"); }}
                >
                  <Store className="h-4 w-4" />
                  Open Market
                </Button>
              </div>
              {/* Pricing */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Custom Designed Wrap", price: 160, earn: 128, color: "text-blue-400" },
                  { label: "Branded Commercial", price: 160, earn: 128, note: "+$25 edit fee", color: "text-cyan-400" },
                  { label: "Fleet Package", price: 399, earn: 319, color: "text-emerald-400" },
                ].map((tier) => (
                  <div key={tier.label} className="text-center p-2 rounded-lg bg-background/50 border border-border">
                    <p className={cn("text-xs font-medium", tier.color)}>{tier.label}</p>
                    <p className="text-sm font-bold text-foreground">${tier.price}</p>
                    {"note" in tier && <p className="text-[10px] text-muted-foreground">{tier.note}</p>}
                    <p className="text-[10px] text-emerald-400">Earn ${tier.earn}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Expiring Renders Warning ── */}
        {(expiringRenders || []).length > 0 && (
          <Card className="mb-8 border-amber-500/40 bg-amber-500/5">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-5 w-5 text-amber-400" />
                <h2 className="font-semibold text-foreground">Designs Expiring Soon</h2>
                <span className="text-xs text-muted-foreground ml-auto">
                  Renders without production packs expire after {RENDER_EXPIRY_DAYS} days
                </span>
              </div>
              <div className="space-y-3">
                {(expiringRenders || []).map((render) => (
                  <div
                    key={render.id}
                    className="flex items-center gap-4 p-3 rounded-lg bg-background/50 border border-border"
                  >
                    {render.heroUrl && (
                      <img
                        src={render.heroUrl as string}
                        alt={render.vehicleLabel}
                        className="w-20 h-12 rounded object-cover bg-muted"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {render.vehicleLabel}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {render.colorName} {render.finishType && `• ${render.finishType}`}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0",
                        render.daysRemaining <= 3
                          ? "border-red-500/50 text-red-400"
                          : "border-amber-500/50 text-amber-400"
                      )}
                    >
                      {render.daysRemaining} day{render.daysRemaining !== 1 ? "s" : ""} left
                    </Badge>
                    <Button
                      size="sm"
                      className="shrink-0 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white"
                      onClick={() => navigate(`/my-renders`)}
                    >
                      <Package className="h-3 w-3 mr-1" />
                      Save to Vault
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          </div>
        ) : vaultDesigns.length === 0 ? (
          /* ── Empty State ── */
          <Card className="border-dashed border-2 border-border">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Shield className="h-16 w-16 text-muted-foreground mb-6" />
              <h2 className="text-2xl font-bold text-foreground mb-2">Your DesignVault is Empty</h2>
              <p className="text-muted-foreground text-center max-w-md mb-6">
                Star your best designs in WrapBox to showcase them here.
              </p>
              <div className="flex gap-4">
                <Button
                  className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white"
                  onClick={() => navigate("/wrapbox")}
                >
                  <Package className="h-4 w-4 mr-2" />
                  Go to WrapBox
                </Button>
                <Button variant="outline" onClick={() => navigate("/colorpro")}>
                  Create a Design
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* ── Type Filter Tabs ── */}
            <div className="flex flex-wrap gap-2 mb-4">
              {TYPE_FILTERS.map((filter) => (
                <button
                  key={filter}
                  onClick={() => setTypeFilter(filter)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                    typeFilter === filter
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-500 hover:text-zinc-300",
                  )}
                >
                  {filter}
                </button>
              ))}
            </div>

            {/* ── Search & Sort ── */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by vehicle, design name, or order number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest First</SelectItem>
                  <SelectItem value="oldest">Oldest First</SelectItem>
                  <SelectItem value="vehicle">Vehicle A-Z</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* ── Vault Grid ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {displayDesigns.map((design) => {
                const progress = (design.upscaleProgress || "0/0").split("/");
                const completed = parseInt(progress[0] || "0", 10);
                const total = parseInt(progress[1] || "0", 10);
                const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
                const isProcessing = design.upscaleStatus === "processing";
                const isComplete = design.upscaleStatus === "complete";

                return (
                  <Card
                    key={design.id}
                    className={cn(
                      "bg-zinc-900 overflow-hidden transition-colors group",
                      isComplete && !design.isBranded && "border-zinc-800 hover:border-emerald-500/50",
                      isComplete && design.isBranded && "border-cyan-500/30 hover:border-cyan-500/60",
                      !isComplete && "border-zinc-800 hover:border-blue-600",
                    )}
                  >
                    {/* 3D Render */}
                    <div className="relative aspect-video bg-zinc-800">
                      {design.thumbnailUrl ? (
                        <>
                          <img
                            src={design.thumbnailUrl}
                            alt={design.vehicleLabel}
                            className="w-full h-full object-cover"
                          />
                          <DesignIDBadge
                            toolName="DesignProAI™"
                            did={didFromPack(design) || undefined}
                            showPT={false}
                          />
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Archive className="h-10 w-10 text-muted-foreground/40" />
                        </div>
                      )}

                      {/* Branded Badge — bottom-left, below DesignIDBadge */}
                      {design.isBranded && (
                        <Badge className="absolute bottom-2 left-2 bg-cyan-500/90 text-white border-0 gap-1 text-[10px] z-20">
                          <Sparkles className="w-2.5 h-2.5" />
                          Branded
                        </Badge>
                      )}
                    </div>

                    <CardContent className="p-3 space-y-2">
                      {/* Vehicle + Design Info */}
                      <p className="font-semibold text-sm text-foreground truncate">{design.vehicleLabel || "Vehicle"}</p>
                      <p className="text-xs text-zinc-400 truncate">
                        {design.designName}
                        {design.finishType && ` • ${design.finishType}`}
                      </p>

                      {/* ── DesignID Prominent Display ── */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(didFromPack(design) || "").then(() => {
                            toast.success("DesignID copied!");
                          });
                        }}
                        className="w-full cursor-pointer"
                      >
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-[#00c8ff]/5 border border-[#00c8ff]/20 hover:bg-[#00c8ff]/10 transition-colors">
                          <span className="shrink-0"><PaletteIcon /></span>
                          <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: "#00c8ff", textShadow: "0 0 6px rgba(0,200,255,0.5)" }}>
                            {didFromPack(design)}
                          </span>
                          {design.avgRating > 0 && (
                            <div className="flex items-center gap-0.5 ml-auto">
                              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                              <span className="text-[10px] text-yellow-400 font-medium">{design.avgRating.toFixed(1)}</span>
                            </div>
                          )}
                          <span className="text-[10px] text-zinc-500 ml-auto">
                            {design.createdAt ? format(new Date(design.createdAt), "MMM d, yyyy") : ""}
                          </span>
                        </div>
                      </button>

                      {/* ── QC Stamp Row — circular stamp badges ── */}
                      <div className="flex items-center justify-center gap-3 py-2">
                        {/* Design Quality Stamp */}
                        <div className="flex flex-col items-center gap-1">
                          <div className={cn(
                            "w-11 h-11 rounded-full border-2 flex items-center justify-center",
                            isComplete
                              ? "border-emerald-500 bg-emerald-500/10"
                              : "border-zinc-600 bg-zinc-800/50",
                          )}>
                            <ShieldCheck className={cn(
                              "w-5 h-5",
                              isComplete ? "text-emerald-400" : "text-zinc-500",
                            )} />
                          </div>
                          <span className={cn("text-[9px] font-semibold tracking-tight", isComplete ? "text-emerald-400" : "text-zinc-500")}>
                            QC
                          </span>
                        </div>

                        {/* PrintReady Stamp */}
                        <div className="flex flex-col items-center gap-1">
                          <div className={cn(
                            "w-11 h-11 rounded-full border-2 flex items-center justify-center",
                            isComplete
                              ? "border-blue-500 bg-blue-500/10"
                              : "border-zinc-600 bg-zinc-800/50",
                          )}>
                            <Printer className={cn(
                              "w-5 h-5",
                              isComplete ? "text-blue-400" : "text-zinc-500",
                            )} />
                          </div>
                          <span className={cn("text-[9px] font-semibold tracking-tight", isComplete ? "text-blue-400" : "text-zinc-500")}>
                            PrintReady
                          </span>
                        </div>

                        {/* DesignEquity Stamp */}
                        <div className="flex flex-col items-center gap-1">
                          <div className={cn(
                            "w-11 h-11 rounded-full border-2 flex items-center justify-center",
                            "border-emerald-500 bg-emerald-500/10",
                          )}>
                            <Gem className={cn(
                              "w-5 h-5 text-emerald-400",
                            )} />
                          </div>
                          <span className="text-[9px] font-semibold tracking-tight text-emerald-400">
                            DesignEquity
                          </span>
                        </div>
                      </div>

                      {/* Branded Design - Encouragement to Sell */}
                      {design.isBranded && isComplete && (
                        <div className="p-2 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
                          <div className="flex items-center gap-2">
                            <Pencil className="h-3 w-3 text-cyan-400 shrink-0" />
                            <span className="text-[10px] font-medium text-cyan-300">Branded - Logo / Name Customizable</span>
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex flex-col gap-2 pt-2 border-t border-zinc-800">
                        {/* Share + Reconfigure row */}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                            onClick={() => {
                              const url = `${window.location.origin}/share/vault/${design.id}`;
                              navigator.clipboard.writeText(url).then(() => {
                                toast.success("Share link copied!");
                              });
                            }}
                          >
                            <Link2 className="w-3 h-3" />
                            Share
                          </Button>
                          {isComplete && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 gap-1 text-xs border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300"
                              onClick={() => {
                                setReconfigureDesign(design);
                                setReconfigureYear("");
                                setReconfigureMake("");
                                setReconfigureModel("");
                              }}
                            >
                              <RefreshCw className="w-3 h-3" />
                              Reconfigure $25
                            </Button>
                          )}
                        </div>
                        {/* Order Production Pack */}
                        <Button
                          size="sm"
                          className="w-full gap-1.5 text-xs bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white"
                          onClick={() => navigate("/my-renders")}
                        >
                          <Package className="w-3 h-3" />
                          Order Production Pack - $75
                        </Button>
                        {/* Sell on CreatorMarket - always visible */}
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn(
                            "w-full gap-1.5 text-xs",
                            design.isBranded
                              ? "border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300"
                              : "border-violet-500/30 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300",
                          )}
                          onClick={() => navigate("/creatormarket")}
                        >
                          <Store className="w-3 h-3" />
                          Sell On CreatorMarket — 60% You · 40% DesignProAI
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {displayDesigns.length === 0 && searchQuery && (
              <Card className="border-dashed border-2 border-border mt-4">
                <CardContent className="py-8 text-center text-muted-foreground">
                  No designs match "{searchQuery}"
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>

      {/* ── Reconfigure Dialog ── */}
      <Dialog open={!!reconfigureDesign} onOpenChange={(open) => { if (!open) setReconfigureDesign(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reconfigure Design</DialogTitle>
          </DialogHeader>
          {reconfigureDesign && (
            <div className="space-y-4">
              {/* Design preview */}
              <div className="flex items-center gap-3">
                {reconfigureDesign.thumbnailUrl && (
                  <img
                    src={reconfigureDesign.thumbnailUrl}
                    alt={reconfigureDesign.designName}
                    className="w-20 h-14 rounded object-cover bg-zinc-800"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{reconfigureDesign.designName}</p>
                  <p className="text-xs text-muted-foreground truncate">{reconfigureDesign.vehicleLabel}</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Output this design on a different vehicle.
              </p>

              {/* Year / Make / Model inputs */}
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Year</Label>
                  <Input
                    placeholder="2024"
                    value={reconfigureYear}
                    onChange={(e) => setReconfigureYear(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Make</Label>
                  <Input
                    placeholder="Ford"
                    value={reconfigureMake}
                    onChange={(e) => setReconfigureMake(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Model</Label>
                  <Input
                    placeholder="F-150"
                    value={reconfigureModel}
                    onChange={(e) => setReconfigureModel(e.target.value)}
                  />
                </div>
              </div>

              <Button
                className="w-full bg-gradient-to-r from-cyan-600 to-teal-500 hover:from-cyan-700 hover:to-teal-600 text-white gap-2"
                disabled={!reconfigureYear || !reconfigureMake || !reconfigureModel}
                onClick={() => {
                  const params = new URLSearchParams({
                    reconfigure: reconfigureDesign.id,
                    year: reconfigureYear,
                    make: reconfigureMake,
                    model: reconfigureModel,
                  });
                  setReconfigureDesign(null);
                  navigate(`/printpro/design-packs?${params.toString()}`);
                }}
              >
                <RefreshCw className="w-4 h-4" />
                Reconfigure & Order - $25
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
