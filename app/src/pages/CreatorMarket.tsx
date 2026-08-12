import { useState, useMemo, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Store, DollarSign, ShoppingBag, Eye, Heart,
  Package, Search, Loader2, Lock, Tag,
  BarChart3, Wallet, Users, Star, Upload, Shield,
  Sparkles, Pencil, Truck, Palette, Layers,
  Hash, Zap, Instagram,
  Clock, Camera, ChevronRight, Crown,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Link, useNavigate } from "react-router-dom";
import { ListingDetailViewer } from "@/components/creatormarket/ListingDetailViewer";
import { BuyerPopup } from "@/components/creatormarket/BuyerPopup";
import { NamePreviewModal } from "@/components/creatormarket/NamePreviewModal";
import { MarketCard } from "@/components/creatormarket/MarketCard";
import {
  getIndustryTitle, getVehicleSubtitle, isCommercialListing,
  PRINT_READY_PRICE, VEHICLE_RENDER_ADDON_PRICE, FILE_DELIVERY_HOURS,
} from "@/components/creatormarket/listing-display";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { NewsletterCouponPopup } from "@/components/NewsletterCouponPopup";
import { useUserTier } from "@/hooks/useUserTier";
import { ShareDesignButton } from "@/components/ShareDesignButton";
import { useOrganization } from "@/contexts/OrganizationContext";
// Trade chips — slug + label come from cm-trade-options, the single source
// of truth shared with the AI batch generator and the admin curator page.
import { CM_TRADES } from "@/lib/cm-trade-options";
import { creatorMarketAutoBuild } from "@/lib/creatorMarketAutoBuild";
import { CM_TRADE_CATEGORIES, CM_STYLE_CATEGORIES } from "@/lib/cm-seo";

/** Default revenue split - admin can override via creator_market_settings table */
const PLATFORM_FEE_PERCENT = 20;
const CREATOR_PAYOUT_PERCENT = 80;
const DEFAULT_LISTING_PRICE = 350;

// Bundle discount: $100 off the design fee when a customer also
// orders the printed wrap shipped. Displayed inline on the card and
// applied at checkout when purchase_mode === 'design_plus_wrap'.
const BUNDLE_DISCOUNT_USD = 100;

// Free shipping kicks in on bundled orders over this dollar amount
// (design fee + printed wrap line items, before tax).
const FREE_SHIPPING_THRESHOLD_USD = 750;

// Trade taxonomy — keep in sync with the marketplace_listings_trade_chk
// constraint in supabase. The slug is what's stored in
// trade_category; the label is the human-readable filter chip.
const TRADE_OPTIONS: { slug: string; label: string }[] = CM_TRADES.map((t) => ({
  slug: t.slug,
  label: t.label,
}));
const SLIGHT_CUSTOMIZATION_FEE = 25;

/** Simplified pricing - one base price, optional slight customization fee */
const PRODUCTION_TIERS = {
  custom: { label: "Custom Designed Wrap", price: 350, description: "Print-ready wrap files delivered to your inbox in 48 hours" },
  branded: { label: "Branded Commercial", price: 350, description: "Print-ready files delivered in 48 hours. Add $25 for slight customization.", editFee: 25 },
  fleet: { label: "Fleet Package", price: 399, description: "Fleet set - list your designed fleet as a package" },
} as const;

type ProductionTier = keyof typeof PRODUCTION_TIERS;

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

/** Detect production tier from design metadata */
function detectProductionTier(designName: string, finishType: string, panelCount: number): ProductionTier {
  const nameLower = (designName || "").toLowerCase();
  const isBranded = BRANDED_KEYWORDS.some((kw) => nameLower.includes(kw));
  if (isBranded || nameLower.includes("commercial")) return "branded";
  if (panelCount >= 6 || nameLower.includes("fleet")) return "fleet";
  return "custom";
}

/** Canonical 7-view labels */
const VIEW_LABELS: Record<string, string> = {
  roof: "Roof",
  side: "Driver Side",
  "passenger-side": "Passenger",
  front: "Front 3/4",
  rear: "Rear 3/4",
  hood_detail: "Hood",
  "close-up": "Close-Up",
};

/** Parse render_urls: supports both {hero: url} object and [{type, url}] array formats */
function parseRenderUrls(raw: any): { type: string; url: string; label: string }[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter((v: any) => v?.url)
      .map((v: any) => ({ type: v.type, url: v.url, label: VIEW_LABELS[v.type] || v.type }));
  }
  if (typeof raw === "object") {
    return Object.entries(raw)
      .filter(([, url]) => typeof url === "string" && (url as string).startsWith("http"))
      .map(([type, url]) => ({ type, url: url as string, label: VIEW_LABELS[type] || type }));
  }
  return [];
}

/** Check if a design looks branded/commercial */
function isBrandedDesign(designName: string): boolean {
  const nameLower = (designName || "").toLowerCase();
  return BRANDED_KEYWORDS.some((kw) => nameLower.includes(kw));
}

/** Generate a short DesignID from a UUID-style dna_id */
function formatDesignId(id: string): string {
  return `DID-${id.slice(0, 8).toUpperCase()}`;
}

/** Generate a PromptFingerprint hash from design metadata */
function formatPromptFingerprint(id: string): string {
  return `PF-${id.slice(-12).toUpperCase()}`;
}


interface CreatorProfile {
  id: string;
  displayName: string | null;
  slug: string | null;
  bio: string | null;
  avatarUrl: string | null;
  totalDesigns: number;
  totalSales: number;
  totalEarnings: number;
  avgDesignRating: number;
  verified: boolean;
  featured: boolean;
  status: string;
  stripeConnectOnboarded: boolean;
}

interface MarketListing {
  id: string;
  title: string;
  description: string | null;
  price: number;
  status: string;
  thumbnailUrl: string | null;
  vehicleYear: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  viewCount: number;
  favoriteCount: number;
  listedAt: string | null;
  createdAt: string;
  designDnaId: string;
}

interface VaultDesignForListing {
  id: string;
  thumbnailUrl: string | null;
  vehicleLabel: string;
  designName: string;
  finishType: string;
  createdAt: string;
  isListed: boolean;
  isBranded: boolean;
  productionTier: ProductionTier;
  panelCount: number;
}

export default function CreatorMarket() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userTier = useUserTier();
  const { currentShopProfileId } = useOrganization();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("browse");
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<any>(null);
  const [detailListing, setDetailListing] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [namePreviewListing, setNamePreviewListing] = useState<any>(null);
  const [namePreviewOpen, setNamePreviewOpen] = useState(false);
  const [pendingBusinessName, setPendingBusinessName] = useState("");

  // Capture browse visit for email retargeting
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) {
          await supabase.from("email_subscribers" as any).upsert(
            { email: user.email, source: "marketplace_browse", updated_at: new Date().toISOString() },
            { onConflict: "email" }
          );
        }
      } catch {
        // Silent — retargeting is best-effort
      }
    })();
  }, []);

  // Handle Stripe Connect return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe") === "complete") {
      supabase.functions.invoke("creator-stripe-connect", {
        body: { action: "check_status" },
      }).then(({ data }) => {
        if (data?.onboarded) {
          toast.success("Stripe connected! You can now receive payouts.");
          queryClient.invalidateQueries({ queryKey: ["creator-profile"] });
        }
      });
      window.history.replaceState({}, "", "/creatormarket");
    }
    if (params.get("purchase") === "success") {
      const purchasedListingId = params.get("listing");
      window.history.replaceState({}, "", "/creatormarket");
      if (purchasedListingId) {
        // Kick the sanctioned DesignProAI file-output build for this order,
        // sized to the buyer's make/model. The webhook already queued the
        // production job; this re-slices the design's approved proof to the
        // buyer's vehicle (enticePanelsFromProof → production_flow_assets →
        // activate-print-worker) and routes the buyer to the GENIE progress
        // page to watch it. If the tab closes, the queued job still sits in
        // Admin QC for the design team.
        toast.success("Purchase complete! Building your print files…");
        (async () => {
          const result = await creatorMarketAutoBuild(purchasedListingId);
          if (result.status === "built") {
            toast.success("Print files are building — watch progress on your Production page.");
            navigate("/productionflow");
          } else if (result.status === "no_source") {
            toast.success("Order received — our team is finalizing your print files. You'll get them by email.");
          } else {
            // no_job (webhook lag) / queued / error — the order is safe; the
            // job builds server-side / via the design team. Don't alarm the buyer.
            toast.success("Order received! Your production files will be delivered via email.");
          }
        })();
      } else {
        toast.success("Purchase complete! Your production pack will be delivered via email.");
      }
    }
  }, []);

  // Deep-link to a specific listing via ?listing=<uuid>. Lets shop
  // owners share a single CreatorMarket card by URL (e.g. on Instagram
  // or in a sales email) — landing on the link auto-opens that
  // card's detail viewer.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("listing");
    if (!id || detailOpen) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("marketplace_listings")
        .select(
          "id, title, price, thumbnail_url, vehicle_year, vehicle_make, vehicle_model, status, design_style, trade_category, offers_printed_wrap, listed_at, creator_id, design_dna_id, featured_creator_name, industry_title, install_video_url, render_urls, preview_urls, panel_2d_url, neuralnetwork_creator_profiles(display_name, slug, avatar_url, verified, social_links, is_partner_shop)",
        )
        .eq("id", id)
        .eq("status", "listed")
        .maybeSingle();
      if (cancelled || !data) return;
      setDetailListing(data);
      setDetailOpen(true);
    })();
    return () => { cancelled = true; };
    // We only want this on first mount — link-driven entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: A URL-sync useEffect used to live here that pushed the
  // currently-open listing id into the address bar as ?listing=<id>.
  // That effect was the root cause of a recurring React error #300
  // ("too many re-renders") on /creatormarket — calling
  // history.replaceState during render-driven effects interacted
  // badly with react-router's location subscription and produced an
  // unbounded loop. The early-return guard in PR #1703 helped but
  // production users were still hitting the boundary, so we've now
  // dropped the auto-sync entirely.
  //
  // Sharing a single listing still works: the Share button inside
  // ListingDetailViewer generates a /c/<id> short link that the
  // /api/og/creatormarket endpoint resolves into a deep-link to
  // /creatormarket?listing=<id>. Deep-link arrivals are still
  // handled by the useEffect above, which auto-opens the modal on
  // first mount.

  // ── Fetch creator profile ──
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["creator-profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await (supabase as any)
        .from("neuralnetwork_creator_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) { console.warn("creator profile query:", error); return null; }
      if (!data) return null;
      return {
        id: data.id,
        displayName: data.display_name,
        slug: data.slug,
        bio: data.bio,
        avatarUrl: data.avatar_url,
        totalDesigns: data.total_designs || 0,
        totalSales: data.total_sales || 0,
        totalEarnings: data.total_earnings || 0,
        avgDesignRating: data.avg_design_rating || 0,
        verified: data.verified || false,
        featured: data.featured || false,
        status: data.status || "pending",
        stripeConnectOnboarded: data.stripe_connect_onboarded || false,
      } as CreatorProfile;
    },
  });

  // ── Fetch user's marketplace listings ──
  const { data: myListings, isLoading: listingsLoading } = useQuery({
    queryKey: ["creator-listings", profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data, error } = await (supabase as any)
        .from("marketplace_listings")
        .select("*")
        .eq("creator_id", profile.id)
        .order("created_at", { ascending: false });
      if (error) { console.warn("listings query:", error); return []; }
      return (data || []).map((l: any) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        price: l.price || DEFAULT_LISTING_PRICE,
        status: l.status,
        thumbnailUrl: l.thumbnail_url,
        vehicleYear: l.vehicle_year,
        vehicleMake: l.vehicle_make,
        vehicleModel: l.vehicle_model,
        viewCount: l.view_count || 0,
        favoriteCount: l.favorite_count || 0,
        listedAt: l.listed_at,
        createdAt: l.created_at,
        designDnaId: l.design_dna_id,
      })) as MarketListing[];
    },
    enabled: !!profile?.id,
  });

  // ── Fetch the current shop's vault designs eligible for listing ──
  // PERF: only fetched when the user opens the "List a Design" tab,
  // since this query joins production_packs (~16 rows but the
  // visualization_id resolve inside `onClick` is the heavy path).
  const { data: vaultDesigns, isLoading: vaultLoading } = useQuery({
    queryKey: ["creator-vault-designs", currentShopProfileId],
    // Only fire once the creator's own listings have loaded (so we can
    // mark which vault designs are already listed) AND only when the
    // "List a Design" tab is the active one — keeps the public browse
    // load fast for shoppers who never open that tab.
    enabled: currentShopProfileId !== null && !listingsLoading && activeTab === "list",
    queryFn: async () => {
      if (!currentShopProfileId) return [];
      const { data, error } = await (supabase as any)
        .from("production_packs")
        .select("id, pack_url, thumbnail_url, file_count, vehicle_info, design_name, finish_type, panels_selected, created_at, upscale_status")
        .eq("shop_id", currentShopProfileId)
        .eq("upscale_status", "complete")
        .order("created_at", { ascending: false });
      if (error) { console.warn("vault designs query:", error); return []; }

      const listedDnaIds = new Set((myListings || []).map((l) => l.designDnaId));

      return (data || []).map((p: any) => {
        const vInfo = p.vehicle_info;
        const name = p.design_name || "Production Pack";
        const finish = p.finish_type || "";
        const panelCount = p.file_count || 0;
        return {
          id: p.id,
          thumbnailUrl: p.thumbnail_url,
          vehicleLabel: vInfo
            ? `${vInfo.year || ""} ${vInfo.make || ""} ${vInfo.model || ""}`.trim()
            : "Vehicle",
          designName: name,
          finishType: finish,
          createdAt: p.created_at,
          isListed: listedDnaIds.has(p.id),
          isBranded: isBrandedDesign(name),
          productionTier: detectProductionTier(name, finish, panelCount),
          panelCount,
        } as VaultDesignForListing;
      });
    },
  });

  // ── Browse: public listed designs (from all creators) ──
  //
  // PERF: We deliberately do NOT select render_urls / preview_urls /
  // production_pack_metadata here — those JSONB columns can balloon to
  // tens of MB on individual rows and were previously the #1 cause of
  // /creatormarket taking forever to load. The detail modal lazy-loads
  // the full row on click (see ListingDetailViewer).
  //
  // The creator join is a regular (left) join now, not !inner, so
  // admin-curated rows that have no creator_id still show up.
  const { data: publicListings, isLoading: publicLoading } = useQuery({
    queryKey: ["marketplace-browse", searchQuery],
    queryFn: async () => {
      // Admin curation: hide rows flagged is_hidden, then sort by
      // display_order ASC (pinned items first) before falling back to
      // listed_at DESC. Managed via /admin/creatormarket-manager.
      let query = (supabase as any)
        .from("marketplace_listings")
        .select(
          [
            "id",
            "title",
            "price",
            "thumbnail_url",
            "vehicle_year",
            "vehicle_make",
            "vehicle_model",
            "status",
            "design_style",
            "trade_category",
            "offers_printed_wrap",
            "listed_at",
            "display_order",
            "creator_id",
            "design_dna_id",
            "featured_creator_name",
            "industry_title",
            "install_video_url",
            // render_urls / preview_urls / panel_2d_url used to be
            // stripped from this query because old data had rows up
            // to 35MB. After the bloat clean-up, all 78 listings
            // total only ~110KB of render_urls — well worth pulling
            // upfront so the detail modal opens with the angle
            // gallery already populated (no lazy-load delay).
            "render_urls",
            "preview_urls",
            "panel_2d_url",
            "neuralnetwork_creator_profiles(display_name, slug, avatar_url, verified, social_links, is_partner_shop)",
          ].join(","),
        )
        .eq("status", "listed")
        .eq("is_hidden", false)
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("listed_at", { ascending: false })
        .limit(30);
      if (searchQuery) {
        query = query.or(`title.ilike.%${searchQuery}%,vehicle_make.ilike.%${searchQuery}%,vehicle_model.ilike.%${searchQuery}%`);
      }
      const { data, error } = await query;
      if (error) { console.warn("public listings query:", error); return []; }
      return (data || []) as any[];
    },
  });

  // The preloaded-designs query (creator's color_visualizations
  // rows from RevisionStudioIQ) used to feed a "Your Designs" panel
  // in the browse tab. That panel was removed because it polluted
  // the buyer-facing marketplace with the creator's own un-listed
  // work. New listings come through the "List a Design" tab instead.

  // ── Fetch hero video URL + auto_approve_verified setting ──
  const { data: heroVideo } = useQuery({
    queryKey: ["marketplace-hero-video"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("creator_market_settings")
        .select("hero_video_url, hero_video_title, auto_approve_verified")
        .limit(1)
        .maybeSingle();
      return data as {
        hero_video_url: string | null;
        hero_video_title: string | null;
        auto_approve_verified: boolean | null;
      } | null;
    },
  });

  /**
   * Decide the initial status when a creator publishes a listing.
   * Verified creators with auto-approve enabled go straight to "listed";
   * everyone else lands in "pending_review" for an admin to clear.
   */
  const resolvePublishStatus = (): "listed" | "pending_review" => {
    const autoApprove = (heroVideo as any)?.auto_approve_verified ?? true;
    return autoApprove && profile?.verified ? "listed" : "pending_review";
  };

  const isLoading = profileLoading;

  // ── Sold counts: query transactions table since listings can sell repeatedly ──
  const { data: soldStats } = useQuery({
    queryKey: ["creator-sales-summary", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("marketplace_transactions")
        .select("creator_payout, status")
        .eq("creator_id", profile!.id)
        .eq("status", "paid");
      const rows = (data || []) as { creator_payout: number | null }[];
      return {
        soldCount: rows.length,
        pendingEarnings: rows.reduce((sum, r) => sum + (r.creator_payout || 0), 0),
      };
    },
  });

  // ── Computed stats ──
  const pendingEarnings = soldStats?.pendingEarnings ?? 0;
  const listedCount = (myListings || []).filter((l) => ["listed", "approved"].includes(l.status)).length;
  const soldCount = soldStats?.soldCount ?? 0;
  const totalViews = (myListings || []).reduce((sum, l) => sum + l.viewCount, 0);

  /** Build a normalized vehicle key for dedup (year+make+model, lowercased+trimmed). */
  const vehicleKeyOf = (year?: any, make?: any, model?: any): string =>
    [year, make, model]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase().trim().replace(/\s+/g, " "))
      .join("|");

  /**
   * (Starred-renders dedupe removed — that black-card "Premium
   * Design" row was killed in favour of only showing the white
   * MarketCard grid. The marketplace_listings table is now the
   * single source of truth for what shows on /creatormarket.)
   */

  /** Dedupe public listings by vehicle so two listings of the same year/make/model collapse to one. */
  const dedupedPublicListings = useMemo(() => {
    const seenVehicle = new Set<string>();
    const seenThumb = new Set<string>();
    return (publicListings || []).filter((l: any) => {
      // Trade chip filter — show only listings whose trade_category
      // matches the selected chip (null = show all).
      if (selectedTrade && l.trade_category !== selectedTrade) return false;
      const vKey = vehicleKeyOf(l.vehicle_year, l.vehicle_make, l.vehicle_model);
      if (vKey && seenVehicle.has(vKey)) return false;
      if (l.thumbnail_url && seenThumb.has(l.thumbnail_url)) return false;
      if (vKey) seenVehicle.add(vKey);
      if (l.thumbnail_url) seenThumb.add(l.thumbnail_url);
      return true;
    });
  }, [publicListings, selectedTrade]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>Buy Custom Vehicle Wrap Designs | Cars, Trucks, Vans, Fleet Wraps | CreatorMarket by RestyleProAI</title>
        <meta name="description" content="Browse production-ready vehicle wrap designs for cars, trucks, vans, and commercial fleets. Real print-ready files delivered to your inbox in 48 hours. $350 per wrap, $25 for slight customization." />
        <meta name="keywords" content="buy vehicle wrap designs, custom car wrap, truck wrap design, van wrap template, fleet wrap package, commercial vehicle wrap, food truck wrap, construction wrap, dental van wrap, delivery wrap design, buy wrap online, vehicle wrap marketplace, wrap design marketplace, print ready wrap files" />
        <meta property="og:title" content="Buy Custom Vehicle Wrap Designs | CreatorMarket" />
        <meta property="og:description" content="Production-ready wrap designs for any vehicle. Real print-ready files delivered to your inbox in 48 hours. $350 per wrap, $25 for slight customization." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://www.restyleproai.com/creatormarket" />
        <meta property="og:image" content="https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/renders/61cc6c1c-554c-440c-8e07-a64469f1f4eb/DesignPanelPro/ai-generated/1773948618569_commercial.jpg" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="675" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Buy Custom Vehicle Wrap Designs | CreatorMarket by RestyleProAI" />
        <meta name="twitter:description" content="Production-ready wrap designs. Print-ready files in your inbox in 48 hours. $350 per wrap, $25 for slight customization." />
        <meta name="twitter:image" content="https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/renders/61cc6c1c-554c-440c-8e07-a64469f1f4eb/DesignPanelPro/ai-generated/1773948618569_commercial.jpg" />
        <link rel="canonical" href="https://www.restyleproai.com/creatormarket" />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Store",
          "name": "CreatorMarket by RestyleProAI",
          "description": "Marketplace for production-ready vehicle wrap designs. Buy custom car wraps, truck wraps, van wraps, and commercial fleet branding packages.",
          "url": "https://www.restyleproai.com/creatormarket",
          "brand": { "@type": "Brand", "name": "RestyleProAI" },
          "offers": {
            "@type": "AggregateOffer",
            "lowPrice": "350",
            "highPrice": "399",
            "priceCurrency": "USD",
            "offerCount": (publicListings || []).length,
            "availability": "https://schema.org/InStock"
          },
          "hasMerchantReturnPolicy": { "@type": "MerchantReturnPolicy", "returnPolicyCategory": "https://schema.org/MerchantReturnNotPermitted" }
        })}</script>
      </Helmet>
      <main className="flex-1 container mx-auto px-4 pt-4 sm:pt-6 pb-6">
        {/* Hero Header — compact, no mascot, no chip strip, no
            "Run a wrap shop?" link. All of that pushed cards way
            below the fold on mobile. Premium = restraint. */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight">
              Creator<span className="bg-gradient-to-r from-fuchsia-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">Market</span>
            </h1>
            <p className="text-sm sm:text-base text-white/85 mt-1 font-medium">
              Buy customizable wrap designs. Print-ready files in 48 hours.
            </p>
            <p className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">
              Commercial designs · Editable name, logo, phone, website &amp; colors
            </p>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                placeholder="Search HVAC, plumbing, racing…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-zinc-800/50 border-zinc-700 focus:border-fuchsia-500/50 h-10 text-white placeholder:text-zinc-500"
              />
            </div>
            {/* Page-level "Share" button removed. Native iOS share
                from Safari's address bar does the same thing; having
                our own button on the page just duplicated it and
                confused buyers. The link previews now come from the
                marketplace-themed meta tags in index.html (McLaren
                LV Heritage hero) — same outcome, less UI. */}
            {profile && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-fuchsia-500/30 text-fuchsia-400 hover:bg-fuchsia-500/10 shrink-0"
                onClick={() => setActiveTab(activeTab === "browse" ? "dashboard" : "browse")}
              >
                {activeTab === "browse" ? (
                  <><BarChart3 className="h-3.5 w-3.5" /> Dashboard</>
                ) : (
                  <><Store className="h-3.5 w-3.5" /> Browse</>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Design Style Categories — single row, horizontal scroll */}
        <div className="mb-6 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {[
            { label: "All Designs", query: "", sub: "Browse All" },
            { label: "Commercial", query: "commercial", sub: "Business Branding" },
            { label: "Racing", query: "racing", sub: "Motorsport & Speed" },
            { label: "Exotic", query: "exotic", sub: "Luxury & Supercar" },
            { label: "Stealth", query: "stealth", sub: "Matte & Murdered Out" },
            { label: "Carbon Fiber", query: "carbon", sub: "Texture Wraps" },
            { label: "Chrome", query: "chrome", sub: "Mirror & Metallic" },
            { label: "Fleet", query: "fleet", sub: "Multi-Vehicle Sets" },
          ].map((cat) => (
            <button
              key={cat.label}
              onClick={() => setSearchQuery(searchQuery === cat.query ? "" : cat.query)}
              className={cn(
                "flex-shrink-0 flex flex-col items-center px-5 py-3 rounded-xl border-2 transition-all min-w-[110px]",
                searchQuery === cat.query
                  ? "bg-gradient-to-b from-fuchsia-500/20 to-violet-500/10 border-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/10"
                  : "bg-zinc-900/80 border-zinc-700/50 text-zinc-300 hover:border-fuchsia-500/40 hover:text-white hover:bg-zinc-800"
              )}
            >
              <span className="text-sm font-bold tracking-tight">{cat.label}</span>
              <span className="text-[10px] text-zinc-500 mt-0.5">{cat.sub}</span>
            </button>
          ))}
        </div>

        {/* Shop by type — crawlable internal links to the SEO category
            landing pages (each is its own indexable /creatormarket/<slug>
            page). Also the discovery hub for search engines. */}
        <nav aria-label="Wrap design categories" className="mb-6 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mr-1">By trade:</span>
            {CM_TRADE_CATEGORIES.map((c) => (
              <Link key={c.urlSlug} to={`/creatormarket/${c.urlSlug}`}
                className="text-[11px] text-zinc-400 hover:text-fuchsia-300 underline-offset-2 hover:underline">
                {c.label}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mr-1">By style:</span>
            {CM_STYLE_CATEGORIES.map((c) => (
              <Link key={c.urlSlug} to={`/creatormarket/${c.urlSlug}`}
                className="text-[11px] text-zinc-400 hover:text-fuchsia-300 underline-offset-2 hover:underline">
                {c.label}
              </Link>
            ))}
          </div>
        </nav>

        {/* ── Hero Video (from admin settings) ── */}
        {heroVideo?.hero_video_url && (
          <div className="mb-6 sm:mb-8 rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 max-h-[60vh] sm:max-h-none">
            {heroVideo.hero_video_title && (
              <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center gap-2">
                <Eye className="h-4 w-4 text-cyan-400" />
                <span className="text-sm font-semibold text-foreground">{heroVideo.hero_video_title}</span>
              </div>
            )}
            <div className="aspect-video bg-black">
              {heroVideo.hero_video_url.match(/youtube\.com|youtu\.be/) ? (
                <iframe
                  src={`https://www.youtube.com/embed/${heroVideo.hero_video_url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/)?.[1]}?rel=0&modestbranding=1`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title={heroVideo.hero_video_title || "Demo Video"}
                />
              ) : heroVideo.hero_video_url.match(/vimeo\.com/) ? (
                <iframe
                  src={`https://player.vimeo.com/video/${heroVideo.hero_video_url.match(/vimeo\.com\/(\d+)/)?.[1]}`}
                  className="w-full h-full"
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                  title={heroVideo.hero_video_title || "Demo Video"}
                />
              ) : (
                <video
                  src={heroVideo.hero_video_url}
                  controls
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="w-full h-full object-cover"
                />
              )}
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <img src="/characters/sproket/planet-blue.png" alt="Loading" className="w-14 h-14 sm:w-20 sm:h-20 md:w-32 md:h-32 object-contain animate-pulse" />
            <p className="text-sm text-zinc-500 font-poppins">Loading marketplace...</p>
          </div>
        ) : !profile ? (
          /* ── No Creator Profile — show public browse marketplace ── */
          <div className="space-y-6">
            {/* Public Browse Content */}
            {publicLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
              </div>
            ) : (
              <>
                {/* Marketplace Listings — heading removed, cards
                    speak for themselves and lift above the fold. */}
                {dedupedPublicListings.length > 0 && (
                  <div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {dedupedPublicListings.map((listing: any) => {
                        const creator = listing.neuralnetwork_creator_profiles;
                        const creatorDisplay = listing.featured_creator_name || creator?.display_name || "Creator";
                        const commercial = isCommercialListing(listing);
                        const industryTitle = getIndustryTitle(listing);
                        const vehicleShown = getVehicleSubtitle(listing);
                        const price = listing.price || PRINT_READY_PRICE;
                        return (
                          <MarketCard
                            key={listing.id}
                            listing={listing}
                            industryTitle={industryTitle}
                            vehicleShown={vehicleShown}
                            commercial={commercial}
                            price={price}
                            creatorDisplay={creatorDisplay}
                            isPartnerShop={!!creator?.is_partner_shop}
                            onCustomize={() => {
                              setSelectedListing({ ...listing, _purchase_mode: "design_only" });
                              setBuyModalOpen(true);
                            }}
                            onWithRender={() => {
                              setSelectedListing({ ...listing, _purchase_mode: "design_only", _addon_vehicle_render: true });
                              setBuyModalOpen(true);
                            }}
                            onPreview={() => { setDetailListing(listing); setDetailOpen(true); }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Empty State */}
                {dedupedPublicListings.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 rounded-2xl border border-dashed border-zinc-800">
                    <img src="/characters/sproket/sproket-moneybag.png" alt="SPROKET" className="w-28 h-28 object-contain mb-5 " />
                    <h3 className="text-xl font-bold text-foreground mb-2">
                      {searchQuery ? "No Results" : "Market Opening Soon"}
                    </h3>
                    <p className="text-sm text-zinc-600 text-center max-w-md">
                      {searchQuery ? `No designs match "${searchQuery}"` : "Be one of the first creators to list a design."}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          /* ── Creator Dashboard ── */
          <>
            {/* Earnings Stats */}
            <div className={cn("grid grid-cols-2 md:grid-cols-4 gap-4 mb-8", activeTab === "browse" && "hidden")}>
              {[
                { icon: DollarSign, value: `$${(profile.totalEarnings || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, label: "Total Earnings", color: "emerald", glow: "shadow-emerald-500/10" },
                { icon: ShoppingBag, value: soldCount, label: "Designs Sold", color: "violet", glow: "shadow-violet-500/10" },
                { icon: Tag, value: listedCount, label: "Active Listings", color: "blue", glow: "shadow-blue-500/10" },
                { icon: Eye, value: totalViews, label: "Total Views", color: "amber", glow: "shadow-amber-500/10" },
              ].map((stat, i) => (
                <div
                  key={i}
                  className={cn(
                    "group relative p-4 rounded-xl border bg-zinc-900/50 hover:shadow-lg transition-all duration-300",
                    `border-${stat.color}-500/20 hover:border-${stat.color}-500/40`,
                    stat.glow.replace("/10", "/20"),
                  )}
                >
                  <div className={cn("p-2 rounded-lg w-fit mb-3", `bg-${stat.color}-500/10`)}>
                    <stat.icon className={cn("h-5 w-5", `text-${stat.color}-400`)} />
                  </div>
                  <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Stripe Connect Status */}
            {activeTab !== "browse" && (
              !profile.stripeConnectOnboarded ? (
                <Card className="mb-8 border-amber-500/40 bg-amber-500/5">
                  <CardContent className="p-5 flex items-center gap-4">
                    <Wallet className="h-6 w-6 text-amber-400 shrink-0" />
                    <div className="flex-1">
                      <p className="font-semibold text-foreground">Connect Stripe to Get Paid</p>
                      <p className="text-sm text-muted-foreground">
                        Link your Stripe account to receive {CREATOR_PAYOUT_PERCENT}% payouts when your designs sell.
                      </p>
                    </div>
                    <Button
                      className="shrink-0 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white gap-2"
                      onClick={async () => {
                        try {
                          const { data, error } = await supabase.functions.invoke("creator-stripe-connect", {
                            body: { action: "create_account", return_url: window.location.origin + "/creatormarket" },
                          });
                          if (error) throw error;
                          if (data?.url) window.location.href = data.url;
                        } catch (err: any) {
                          toast.error(err.message || "Failed to start Stripe Connect");
                        }
                      }}
                    >
                      <Wallet className="h-4 w-4" />
                      Connect Stripe
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card className="mb-8 border-emerald-500/40 bg-emerald-500/5">
                  <CardContent className="p-5 flex items-center gap-4">
                    <Wallet className="h-6 w-6 text-emerald-400 shrink-0" />
                    <div className="flex-1">
                      <p className="font-semibold text-foreground">Stripe Connected</p>
                      <p className="text-sm text-muted-foreground">
                        Your payouts are active. You earn {CREATOR_PAYOUT_PERCENT}% of every sale.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="shrink-0 gap-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                      onClick={async () => {
                        try {
                          const { data, error } = await supabase.functions.invoke("creator-stripe-connect", {
                            body: { action: "create_login_link" },
                          });
                          if (error) throw error;
                          if (data?.url) window.open(data.url, "_blank");
                        } catch (err: any) {
                          toast.error(err.message || "Failed to open Stripe dashboard");
                        }
                      }}
                    >
                      <Wallet className="h-4 w-4" />
                      Stripe Dashboard
                    </Button>
                  </CardContent>
                </Card>
              )
            )}

            {/* Profile Status */}
            {activeTab !== "browse" && profile.status === "pending" && (
              <Card className="mb-8 border-blue-500/40 bg-blue-500/5">
                <CardContent className="p-5 flex items-center gap-4">
                  <Loader2 className="h-6 w-6 text-blue-400 shrink-0 animate-spin" />
                  <div className="flex-1">
                    <p className="font-semibold text-foreground">Profile Under Review</p>
                    <p className="text-sm text-muted-foreground">
                      Your creator profile is being reviewed. You can prepare listings while you wait.
                    </p>
                  </div>
                  <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30">Pending</Badge>
                </CardContent>
              </Card>
            )}

            {/* Tabs: My Listings / List a Design / Browse Market */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className={cn("bg-background border border-border", activeTab === "browse" && "hidden")}>
                <TabsTrigger value="dashboard" className="gap-2">
                  <BarChart3 className="h-4 w-4" />
                  My Listings
                </TabsTrigger>
                <TabsTrigger value="list" className="gap-2">
                  <Upload className="h-4 w-4" />
                  List a Design
                </TabsTrigger>
                <TabsTrigger value="browse" className="gap-2">
                  <Users className="h-4 w-4" />
                  Browse Market
                </TabsTrigger>
              </TabsList>

              {/* ── My Listings Tab ── */}
              <TabsContent value="dashboard" className="space-y-4">
                {(myListings || []).length === 0 ? (
                  <Card className="border-dashed border-2 border-border relative overflow-hidden">
                    <img src="/characters/sproket/planet-teal.png" alt="" className="absolute top-4 right-4 w-16 h-16 object-contain pointer-events-none hidden md:block" />
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <img src="/characters/sproket/sproket-moneybag.png" alt="SPROKET" className="w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 object-contain mb-4 " />
                      <h3 className="text-xl font-bold text-foreground mb-2">No Listings Yet</h3>
                      <p className="text-muted-foreground text-center max-w-md mb-4">
                        List your first design from the DesignVault to start earning.
                      </p>
                      <Button
                        className="bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white gap-2"
                        onClick={() => setActiveTab("list")}
                      >
                        <Upload className="h-4 w-4" />
                        List a Design
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {(myListings || []).map((listing) => (
                      <div
                        key={listing.id}
                        className={cn(
                          "group relative rounded-xl overflow-hidden bg-zinc-900 border transition-all duration-300 hover:-translate-y-1",
                          listing.status === "sold" && "border-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/5",
                          listing.status === "listed" && "border-violet-500/30 hover:shadow-lg hover:shadow-violet-500/5",
                          listing.status === "draft" && "border-zinc-800 hover:border-zinc-600",
                          listing.status === "pending_review" && "border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/5",
                          listing.status === "approved" && "border-green-500/30 hover:shadow-lg hover:shadow-green-500/5",
                        )}
                      >
                        <div className="relative aspect-video bg-zinc-800 overflow-hidden">
                          {listing.thumbnailUrl ? (
                            <img
                              src={listing.thumbnailUrl}
                              alt={listing.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                              <Package className="h-12 w-12 text-zinc-700" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

                          {/* Status badge */}
                          <Badge
                            className={cn(
                              "absolute top-3 left-3 border-0 text-[10px] backdrop-blur-sm",
                              listing.status === "sold" && "bg-emerald-500/90 text-white",
                              listing.status === "listed" && "bg-violet-500/90 text-white",
                              listing.status === "draft" && "bg-zinc-600/80 text-white",
                              listing.status === "pending_review" && "bg-blue-500/90 text-white",
                              listing.status === "approved" && "bg-green-500/90 text-white",
                            )}
                          >
                            {listing.status === "pending_review" ? "In Review" : listing.status.charAt(0).toUpperCase() + listing.status.slice(1)}
                          </Badge>

                          {/* Price tag */}
                          <div className="absolute bottom-3 right-3 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
                            <span className={cn(
                              "text-base font-bold",
                              listing.status === "sold" ? "text-emerald-400" : "text-white",
                            )}>${listing.price}</span>
                          </div>
                        </div>
                        <div className="p-4 space-y-3">
                          <div>
                            <p className="font-semibold text-foreground truncate">
                              {[listing.vehicleYear, listing.vehicleMake, listing.vehicleModel].filter(Boolean).join(" ")}
                            </p>
                            <p className="text-xs text-zinc-500 truncate mt-0.5">{listing.title}</p>
                          </div>
                          <div className="flex items-center justify-between">
                            <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 font-mono text-[9px] gap-1">
                              <Hash className="w-2.5 h-2.5" />
                              {formatDesignId(listing.designDnaId || listing.id)}
                            </Badge>
                            <div className="flex items-center gap-3 text-xs text-zinc-600">
                              <span className="flex items-center gap-1">
                                <Eye className="h-3 w-3" /> {listing.viewCount}
                              </span>
                              <span className="flex items-center gap-1">
                                <Heart className="h-3 w-3" /> {listing.favoriteCount}
                              </span>
                            </div>
                          </div>
                          {listing.status === "sold" ? (
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-emerald-500/10 to-green-500/5 border border-emerald-500/20">
                              <div className="p-1.5 rounded-lg bg-emerald-500/20">
                                <DollarSign className="h-4 w-4 text-emerald-400" />
                              </div>
                              <div>
                                <p className="text-base font-bold text-emerald-400">
                                  +${(listing.price * CREATOR_PAYOUT_PERCENT / 100).toFixed(2)}
                                </p>
                                <p className="text-[10px] text-zinc-500">Your payout ({CREATOR_PAYOUT_PERCENT}%)</p>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2 pt-2 border-t border-zinc-800/50">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-zinc-600">
                                  {listing.listedAt ? `Listed ${format(new Date(listing.listedAt), "MMM d")}` : "Draft"}
                                </span>
                                <span className="text-xs text-zinc-500">
                                  You earn <span className="text-violet-400 font-semibold">${(listing.price * CREATOR_PAYOUT_PERCENT / 100).toFixed(0)}</span>
                                </span>
                              </div>
                              {listing.status === "draft" && (
                                <Button
                                  size="sm"
                                  className="w-full gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white text-xs"
                                  onClick={async () => {
                                    const publishStatus = resolvePublishStatus();
                                    const { error } = await (supabase as any)
                                      .from("marketplace_listings")
                                      .update({
                                        status: publishStatus,
                                        listed_at: publishStatus === "listed" ? new Date().toISOString() : null,
                                      })
                                      .eq("id", listing.id);
                                    if (error) {
                                      toast.error(error.message || "Failed to publish");
                                      return;
                                    }
                                    toast.success(
                                      publishStatus === "listed"
                                        ? "Live on the market"
                                        : "Submitted for review",
                                    );
                                    queryClient.invalidateQueries({ queryKey: ["creator-listings"] });
                                  }}
                                >
                                  <Upload className="h-3 w-3" />
                                  Publish Draft
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* ── List a Design Tab ── */}
              <TabsContent value="list" className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">Choose a Design to List</h3>
                    <p className="text-sm text-muted-foreground">
                      Only print-ready designs from your DesignVault can be listed for sale.
                      Pricing is based on production flow complexity.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => navigate("/designvault")}
                  >
                    <Shield className="h-4 w-4" />
                    Go to DesignVault
                  </Button>
                </div>

                {/* Pricing Guide */}
                <Card className="border-cyan-500/20 bg-cyan-500/5">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Layers className="h-4 w-4 text-cyan-400" />
                      <h4 className="text-sm font-semibold text-foreground">CreatorMarket Pricing</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {(Object.entries(PRODUCTION_TIERS) as [ProductionTier, typeof PRODUCTION_TIERS[ProductionTier]][]).map(([key, tier]) => (
                        <div key={key} className={cn(
                          "p-3 rounded-lg border text-center",
                          key === "branded" ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-background/50",
                        )}>
                          <div className="flex items-center justify-center gap-1 mb-1">
                            {key === "custom" && <Palette className="h-3 w-3 text-blue-400" />}
                            {key === "branded" && <Sparkles className="h-3 w-3 text-amber-400" />}
                            {key === "fleet" && <Truck className="h-3 w-3 text-emerald-400" />}
                            <span className="text-xs font-medium text-foreground">{tier.label}</span>
                          </div>
                          <p className="text-lg font-bold text-foreground">${tier.price}</p>
                          {key === "branded" && (
                            <p className="text-[10px] text-amber-400">+$25 slight customization</p>
                          )}
                          <p className="text-[10px] text-emerald-400">You earn ${(tier.price * CREATOR_PAYOUT_PERCENT / 100).toFixed(0)}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">{tier.description}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {vaultLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
                  </div>
                ) : (vaultDesigns || []).length === 0 ? (
                  <Card className="border-dashed border-2 border-border relative overflow-hidden">
                    <img src="/characters/sproket/planet-purple.png" alt="" className="absolute bottom-4 left-4 w-16 h-16 object-contain pointer-events-none hidden md:block" />
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <img src="/characters/sproket/sproket-presenting.png" alt="SPROKET" className="w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 object-contain mb-4 " />
                      <h3 className="text-xl font-bold text-foreground mb-2">No Print-Ready Designs</h3>
                      <p className="text-muted-foreground text-center max-w-md mb-4">
                        Generate production packs in your DesignVault first, then come back to list them.
                      </p>
                      <Button
                        className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white gap-2"
                        onClick={() => navigate("/designvault")}
                      >
                        <Shield className="h-4 w-4" />
                        Open DesignVault
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {/* Sort branded designs to the top */}
                    {[...(vaultDesigns || [])].sort((a, b) => (b.isBranded ? 1 : 0) - (a.isBranded ? 1 : 0)).map((design) => {
                      const tier = PRODUCTION_TIERS[design.productionTier];
                      const listPrice = tier.price;
                      const creatorCut = listPrice * CREATOR_PAYOUT_PERCENT / 100;

                      return (
                        <Card
                          key={design.id}
                          className={cn(
                            "overflow-hidden transition-all",
                            design.isListed ? "border-violet-500/30 opacity-60"
                              : design.isBranded ? "border-amber-500/40 ring-1 ring-amber-500/20 hover:ring-amber-500/40"
                              : "border-border hover:border-violet-500/50",
                          )}
                        >
                          <div className="aspect-video bg-muted relative overflow-hidden">
                            {design.thumbnailUrl ? (
                              <img src={design.thumbnailUrl} alt={design.vehicleLabel} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Package className="h-10 w-10 text-muted-foreground/40" />
                              </div>
                            )}
                            {design.isListed ? (
                              <Badge className="absolute top-2 left-2 bg-violet-500/90 text-white border-0 text-[10px]">
                                Already Listed
                              </Badge>
                            ) : design.isBranded ? (
                              <Badge className="absolute top-2 left-2 bg-amber-500/90 text-white border-0 gap-1 text-[10px]">
                                <Sparkles className="w-2.5 h-2.5" />
                                High Value
                              </Badge>
                            ) : null}
                            <Badge className="absolute top-2 right-2 bg-emerald-500/90 text-white border-0 gap-1 text-[10px]">
                              <Lock className="w-2.5 h-2.5" />
                              Owned
                            </Badge>
                            {/* Production tier badge */}
                            <Badge className={cn(
                              "absolute bottom-2 left-2 border-0 text-[10px]",
                              design.productionTier === "branded" ? "bg-amber-600/90 text-white" :
                              design.productionTier === "fleet" ? "bg-emerald-600/90 text-white" :
                              "bg-blue-600/90 text-white",
                            )}>
                              {tier.label}
                            </Badge>
                          </div>
                          <CardContent className="p-4 space-y-3">
                            <div>
                              <p className="font-semibold text-foreground truncate">{design.vehicleLabel}</p>
                              <p className="text-sm text-muted-foreground truncate">
                                {design.designName}
                                {design.finishType && ` • ${design.finishType}`}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {format(new Date(design.createdAt), "MMM d, yyyy")}
                                {design.panelCount > 0 && ` • ${design.panelCount} panels`}
                              </p>
                            </div>

                            {/* Branded design - logo customizable notice */}
                            {design.isBranded && !design.isListed && (
                              <div className="p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                                <div className="flex items-center gap-2 mb-1">
                                  <Pencil className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                                  <span className="text-xs font-medium text-amber-300">Logo / Name Customizable</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground leading-relaxed">
                                  Client didn't order? Don't waste it - other shops in this industry
                                  need wraps. Buyers swap the logo and business name for their client.
                                </p>
                              </div>
                            )}

                            {/* Earning preview with production-flow price */}
                            <div className="flex items-center justify-between p-2 rounded-lg bg-violet-500/5 border border-violet-500/20">
                              <div className="flex items-center gap-2">
                                <DollarSign className="h-4 w-4 text-violet-400" />
                                <span className="text-sm text-muted-foreground">Your cut:</span>
                              </div>
                              <span className="font-bold text-violet-400">${creatorCut.toFixed(2)}</span>
                            </div>

                            <Button
                              size="sm"
                              className={cn(
                                "w-full gap-1.5 text-xs",
                                design.isListed
                                  ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                                  : design.isBranded
                                    ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                                    : "bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white",
                              )}
                              disabled={design.isListed}
                              onClick={async () => {
                                if (design.isListed || !profile?.id) return;
                                // Generate a unique design name
                                let uniqueName = design.designName;
                                try {
                                  const { data: nameData } = await supabase.functions.invoke("generate-unique-design-name");
                                  if (nameData?.name) uniqueName = nameData.name;
                                } catch {
                                  // Fallback to existing design name
                                }
                                // Fetch render_urls from the linked color_visualization
                                let renderUrls: any = null;
                                const { data: ppData } = await (supabase as any)
                                  .from("production_packs")
                                  .select("visualization_id")
                                  .eq("id", design.id)
                                  .maybeSingle();
                                if (ppData?.visualization_id) {
                                  const { data: vizData } = await supabase
                                    .from("color_visualizations")
                                    .select("render_urls")
                                    .eq("id", ppData.visualization_id)
                                    .maybeSingle();
                                  if (vizData?.render_urls) renderUrls = vizData.render_urls;
                                }
                                // Parse vehicle parts from label
                                const parts = design.vehicleLabel.split(" ");
                                const vYear = parts[0] || "";
                                const vModel = parts[parts.length - 1] || "";
                                const vMake = parts.slice(1, -1).join(" ") || "";
                                const publishStatus = resolvePublishStatus();
                                await (supabase as any)
                                  .from("marketplace_listings")
                                  .insert({
                                    creator_id: profile.id,
                                    design_dna_id: design.id,
                                    title: `${design.vehicleLabel} - ${uniqueName}`,
                                    price: listPrice,
                                    thumbnail_url: design.thumbnailUrl,
                                    vehicle_year: vYear,
                                    vehicle_make: vMake,
                                    vehicle_model: vModel,
                                    render_urls: renderUrls,
                                    design_style: design.productionTier,
                                    status: publishStatus,
                                    listed_at: publishStatus === "listed" ? new Date().toISOString() : null,
                                  });
                                toast.success(
                                  publishStatus === "listed"
                                    ? `Live on the market — "${uniqueName}"`
                                    : `Submitted for review — "${uniqueName}"`,
                                );
                                window.location.reload();
                              }}
                            >
                              {design.isListed ? (
                                <>Listed</>
                              ) : (
                                <>
                                  <Store className="w-3 h-3" />
                                  Sell On Creator Market — 60% to you · 40% to RestylePro
                                </>
                              )}
                            </Button>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              {/* ── Browse Market Tab ── */}
              <TabsContent value="browse" className="space-y-4">
                {publicLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
                  </div>
                ) : (
                  <>
                    {/* Trade-category filter chips. Lets shoppers
                        narrow by vertical (HVAC, plumbing, real estate,
                        etc.) — slug matches marketplace_listings
                        .trade_category. */}
                    <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
                      <button
                        type="button"
                        onClick={() => setSelectedTrade(null)}
                        className={cn(
                          "shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition",
                          selectedTrade === null
                            ? "bg-white/15 border-white/40 text-white"
                            : "bg-white/[0.02] border-white/10 text-white/55 hover:text-white",
                        )}
                      >
                        All trades
                      </button>
                      {TRADE_OPTIONS.map((t) => (
                        <button
                          key={t.slug}
                          type="button"
                          onClick={() => setSelectedTrade(t.slug)}
                          className={cn(
                            "shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition",
                            selectedTrade === t.slug
                              ? "bg-fuchsia-500/20 border-fuchsia-400/50 text-fuchsia-100"
                              : "bg-white/[0.02] border-white/10 text-white/55 hover:text-white",
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    {/* Commercial trade-filter explainer — only shows
                        when a commercial trade chip is active. Tells
                        first-time visitors what's editable on these
                        templates so they don't think they're stuck
                        with the placeholder branding. */}
                    {selectedTrade && (
                      <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
                        <strong className="text-amber-300">Commercial templates are fully customizable.</strong>{" "}
                        Replace the business name, logo, phone, website, colors, and vehicle model — included in the ${PRINT_READY_PRICE} price.
                      </div>
                    )}

                    {/* Marketplace Listings */}
                    {dedupedPublicListings.length > 0 && (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                          {dedupedPublicListings.map((listing: any) => {
                            const creator = listing.neuralnetwork_creator_profiles;
                            const creatorDisplay = listing.featured_creator_name || creator?.display_name || "Creator";
                            const commercial = isCommercialListing(listing);
                            const industryTitle = getIndustryTitle(listing);
                            const vehicleShown = getVehicleSubtitle(listing);
                            const price = listing.price || PRINT_READY_PRICE;
                            return (
                              <MarketCard
                                key={listing.id}
                                listing={listing}
                                industryTitle={industryTitle}
                                vehicleShown={vehicleShown}
                                commercial={commercial}
                                price={price}
                                creatorDisplay={creatorDisplay}
                                isPartnerShop={!!creator?.is_partner_shop}
                                onCustomize={() => {
                                  window.dispatchEvent(new Event("gallery-card-click"));
                                  setSelectedListing({ ...listing, _purchase_mode: "design_only" });
                                  setBuyModalOpen(true);
                                }}
                                onWithRender={() => {
                                  window.dispatchEvent(new Event("gallery-card-click"));
                                  setSelectedListing({ ...listing, _purchase_mode: "design_only", _addon_vehicle_render: true });
                                  setBuyModalOpen(true);
                                }}
                                onPreview={() => {
                                  window.dispatchEvent(new Event("gallery-card-click"));
                                  setDetailListing(listing);
                                  setDetailOpen(true);
                                }}
                                onWithPrintedWrap={() => {
                                  window.dispatchEvent(new Event("gallery-card-click"));
                                  setSelectedListing({ ...listing, _purchase_mode: "design_plus_wrap" });
                                  setBuyModalOpen(true);
                                }}
                              />
                            );
                          })}
                        </div>
                      </>
                    )}

                    {/* The "Preloaded Designs from RevisionStudioIQ"
                        panel that lived here is removed \u2014 it pulled
                        the signed-in creator's color_visualizations
                        into the public-facing browse tab and showed
                        them with "List This Design" CTAs that don't
                        belong on a buyer-facing marketplace. Creators
                        list new designs from the "List a Design" tab
                        instead. */}

                    {/* Empty State */}
                    {(publicListings || []).length === 0 && (
                      <div className="flex flex-col items-center justify-center py-20 rounded-2xl border border-dashed border-zinc-800 relative overflow-hidden">
                        <img src="/characters/sproket/planet-blue.png" alt="" className="absolute top-6 left-8 w-20 h-20 object-contain pointer-events-none hidden md:block" />
                        <img src="/characters/sproket/planet-teal.png" alt="" className="absolute bottom-6 right-8 w-16 h-16 object-contain pointer-events-none hidden md:block" />
                        <img
                          src="/characters/sproket/sproket-moneybag.png"
                          alt="SPROKET"
                          className="w-28 h-28 md:w-36 md:h-36 object-contain mb-5 "
                        />
                        <h3 className="text-xl font-bold text-foreground mb-2">
                          {searchQuery ? "No Results" : "Market Opening Soon"}
                        </h3>
                        <p className="text-sm text-zinc-600 text-center max-w-md">
                          {searchQuery
                            ? `No designs match "${searchQuery}"`
                            : "Be one of the first creators to list a design and earn when other shops buy it."}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
        {/* ── Buyer Popup ── */}
        <BuyerPopup
          listing={selectedListing}
          open={buyModalOpen}
          onOpenChange={setBuyModalOpen}
          businessName={pendingBusinessName}
        />

        {/* ── Name Preview Modal (commercial wraps) ── */}
        <NamePreviewModal
          listing={namePreviewListing}
          open={namePreviewOpen}
          onOpenChange={setNamePreviewOpen}
          onBuy={(businessName) => {
            setNamePreviewOpen(false);
            setPendingBusinessName(businessName);
            setSelectedListing(namePreviewListing);
            setBuyModalOpen(true);
          }}
        />

        {/* ── Listing Detail Viewer ── */}
        <ListingDetailViewer
          listing={detailListing}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onOrder={() => {
            setDetailOpen(false);
            if (detailListing) {
              setSelectedListing(detailListing);
              setBuyModalOpen(true);
            }
          }}
          onOrderWithRender={() => {
            setDetailOpen(false);
            if (detailListing) {
              setSelectedListing({ ...detailListing, _addon_vehicle_render: true });
              setBuyModalOpen(true);
            }
          }}
          onNamePreview={() => {
            setDetailOpen(false);
            if (detailListing) {
              setNamePreviewListing(detailListing);
              setNamePreviewOpen(true);
            }
          }}
        />
      </main>

      {/* Sticky "Preview On My Vehicle — $25" bar removed. It was
          contradicting the new $350 / $75 model (different price,
          different flow) and competing with the in-card CTAs. The
          on-vehicle preview is now an optional add-on inside each
          listing's purchase flow. */}

      <NewsletterCouponPopup triggerAfterClicks={3} scrollDelayMs={5000} />
    </div>
  );
}
