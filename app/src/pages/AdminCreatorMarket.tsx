import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Loader2, Save, Store, DollarSign, Users, Percent, TrendingUp,
  Instagram, Sparkles, Send, Eye, Star, Shield, RefreshCw,
  Image, MessageSquare, Zap, Globe, ArrowRight, Check, X,
  BarChart3, Wallet, Package, Tag, Layers,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ── Types ──

interface MarketSettings {
  id?: string;
  creator_payout_percent: number;
  platform_fee_percent: number;
  min_listing_price: number;
  max_listing_price: number;
  auto_approve_verified: boolean;
  hero_video_url: string;
  hero_video_title: string;
  ig_auto_post_enabled: boolean;
  ig_caption_style: "sabri" | "garyvee" | "subry" | "custom";
  ig_custom_caption_template: string;
  ig_hashtags: string;
  updated_at?: string;
}

interface CreatorRow {
  id: string;
  user_id: string;
  display_name: string | null;
  slug: string | null;
  bio: string | null;
  total_designs: number;
  total_sales: number;
  total_earnings: number;
  verified: boolean;
  featured: boolean;
  status: string;
  created_at: string;
  custom_payout_percent: number | null;
}

interface RenderForIG {
  id: string;
  thumbnail_url: string | null;
  vehicle_info: any;
  design_name: string | null;
  finish_type: string | null;
  created_at: string;
  user_email: string | null;
  ig_pushed: boolean;
  ig_pushed_at: string | null;
}

interface PendingListing {
  id: string;
  title: string | null;
  price: number | null;
  thumbnail_url: string | null;
  panel_2d_url: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  status: string;
  created_at: string;
  design_dna_id: string | null;
  creator_display_name: string | null;
  creator_verified: boolean;
}

// ── Caption generators ──

const CAPTION_STYLES = {
  sabri: (vehicle: string, design: string, finish: string) =>
    `This ${vehicle} just got the treatment. 🔥\n\n${design}${finish ? ` in ${finish}` : ""} - designed in RestylePro AI.\n\nYour shop could be running this. Your client could be driving this.\n\nStop scrolling. Start wrapping.\n\n🎯 Link in bio to visualize ANY vehicle in minutes.`,
  garyvee: (vehicle: string, design: string, finish: string) =>
    `Listen.\n\nThis ${vehicle} wrap was designed by AI in under 60 seconds.\n\n${design}${finish ? ` - ${finish}` : ""}.\n\nThe wrap shops that adopt this tech RIGHT NOW are going to eat.\n\nThe ones that don't? They'll wonder why their competitors are closing 3x more jobs.\n\n💡 RestylePro AI → link in bio`,
  subry: (vehicle: string, design: string, finish: string) =>
    `When the vision hits different. 🎨\n\n${vehicle} wrapped in ${design}${finish ? ` with ${finish} finish` : ""}.\n\nDesigned. Visualized. Ready to print.\n\nThis is what happens when creativity meets AI.\n\n👇 Build yours at RestylePro AI`,
  custom: () => "",
};

function generateCaption(
  style: MarketSettings["ig_caption_style"],
  vehicle: string,
  design: string,
  finish: string,
  template: string,
  hashtags: string,
): string {
  let caption = "";
  if (style === "custom" && template) {
    caption = template
      .replace(/\{vehicle\}/g, vehicle)
      .replace(/\{design\}/g, design)
      .replace(/\{finish\}/g, finish);
  } else {
    caption = CAPTION_STYLES[style]?.(vehicle, design, finish) || "";
  }
  if (hashtags) {
    caption += `\n\n${hashtags}`;
  }
  return caption;
}

// ── Default settings ──
//
// CreatorMarket revenue split is LOCKED at 60/40 (publisher / platform).
// Do not edit these defaults — the split is part of the public pricing
// promise on /pricing and the legal terms shown to publishers at upload.
// The admin sliders below have been disabled so a stray click can't
// drift the split off-policy.

const DEFAULT_SETTINGS: MarketSettings = {
  creator_payout_percent: 60,
  platform_fee_percent: 40,
  min_listing_price: 99,
  max_listing_price: 1999,
  auto_approve_verified: true,
  hero_video_url: "",
  hero_video_title: "See RestyleProAI in Action",
  ig_auto_post_enabled: false,
  ig_caption_style: "sabri",
  ig_custom_caption_template: "",
  ig_hashtags: "#RestyleProAI #VehicleWrap #WrapDesign #VinylWrap #CarWrap #WrapShop #WrapLife #AIDesign #VehicleVisualization",
};

export default function AdminCreatorMarket() {
  const [settings, setSettings] = useState<MarketSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creators, setCreators] = useState<CreatorRow[]>([]);
  const [creatorsLoading, setCreatorsLoading] = useState(true);
  const [renders, setRenders] = useState<RenderForIG[]>([]);
  const [rendersLoading, setRendersLoading] = useState(true);
  const [selectedRender, setSelectedRender] = useState<RenderForIG | null>(null);
  const [captionPreview, setCaptionPreview] = useState("");
  const [pushingToIG, setPushingToIG] = useState(false);
  const [pendingListings, setPendingListings] = useState<PendingListing[]>([]);
  const [pendingListingsLoading, setPendingListingsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("split");

  // ── Load settings ──
  useEffect(() => {
    loadSettings();
    loadCreators();
    loadRenders();
    loadPendingListings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from("creator_market_settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) {
        console.warn("Settings table may not exist yet:", error.message);
      } else if (data) {
        setSettings({
          id: data.id,
          // Force 60/40 even if a stale DB row says otherwise. The
          // split is locked policy and must not drift via the admin UI.
          creator_payout_percent: 60,
          platform_fee_percent: 40,
          min_listing_price: data.min_listing_price ?? 99,
          max_listing_price: data.max_listing_price ?? 1999,
          auto_approve_verified: data.auto_approve_verified ?? true,
          hero_video_url: data.hero_video_url ?? "",
          hero_video_title: data.hero_video_title ?? "See RestyleProAI in Action",
          ig_auto_post_enabled: data.ig_auto_post_enabled ?? false,
          ig_caption_style: data.ig_caption_style ?? "sabri",
          ig_custom_caption_template: data.ig_custom_caption_template ?? "",
          ig_hashtags: data.ig_hashtags ?? DEFAULT_SETTINGS.ig_hashtags,
          updated_at: data.updated_at,
        });
      }
    } catch (err) {
      console.warn("Could not load settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadCreators = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from("neuralnetwork_creator_profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        console.warn("Creator profiles query:", error.message);
        setCreators([]);
      } else {
        setCreators(data || []);
      }
    } catch {
      setCreators([]);
    } finally {
      setCreatorsLoading(false);
    }
  };

  const loadRenders = async () => {
    try {
      // Get recent high-quality renders for IG push consideration
      const { data, error } = await supabase
        .from("render_history")
        .select("id, thumbnail_url, vehicle_info, design_name, finish_type, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        console.warn("Renders query:", error.message);
        setRenders([]);
      } else {
        setRenders(
          (data || []).map((r: any) => ({
            id: r.id,
            thumbnail_url: r.thumbnail_url,
            vehicle_info: r.vehicle_info,
            design_name: r.design_name,
            finish_type: r.finish_type,
            created_at: r.created_at,
            user_email: null,
            ig_pushed: false,
            ig_pushed_at: null,
          }))
        );
      }
    } catch {
      setRenders([]);
    } finally {
      setRendersLoading(false);
    }
  };

  const loadPendingListings = async () => {
    setPendingListingsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("marketplace_listings")
        .select(
          "id, title, price, thumbnail_url, panel_2d_url, vehicle_year, vehicle_make, vehicle_model, status, created_at, design_dna_id, neuralnetwork_creator_profiles!inner(display_name, verified)",
        )
        .in("status", ["pending_review", "draft"])
        .order("created_at", { ascending: false });
      if (error) {
        console.warn("Pending listings query:", error.message);
        setPendingListings([]);
      } else {
        setPendingListings(
          (data || []).map((l: any) => ({
            id: l.id,
            title: l.title,
            price: l.price,
            thumbnail_url: l.thumbnail_url,
            panel_2d_url: l.panel_2d_url,
            vehicle_year: l.vehicle_year,
            vehicle_make: l.vehicle_make,
            vehicle_model: l.vehicle_model,
            status: l.status,
            created_at: l.created_at,
            design_dna_id: l.design_dna_id,
            creator_display_name: l.neuralnetwork_creator_profiles?.display_name || null,
            creator_verified: !!l.neuralnetwork_creator_profiles?.verified,
          })),
        );
      }
    } catch {
      setPendingListings([]);
    } finally {
      setPendingListingsLoading(false);
    }
  };

  const approveListing = async (listingId: string) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const reviewerId = userData?.user?.id || null;
      const { error } = await (supabase as any)
        .from("marketplace_listings")
        .update({
          status: "listed",
          listed_at: new Date().toISOString(),
          admin_reviewed_at: new Date().toISOString(),
          admin_reviewed_by: reviewerId,
        })
        .eq("id", listingId);
      if (error) throw error;
      setPendingListings((prev) => prev.filter((l) => l.id !== listingId));
      toast.success("Listing approved — now live");
    } catch (err: any) {
      toast.error(err?.message || "Failed to approve listing");
    }
  };

  const rejectListing = async (listingId: string) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const reviewerId = userData?.user?.id || null;
      const { error } = await (supabase as any)
        .from("marketplace_listings")
        .update({
          status: "rejected",
          admin_reviewed_at: new Date().toISOString(),
          admin_reviewed_by: reviewerId,
        })
        .eq("id", listingId);
      if (error) throw error;
      setPendingListings((prev) => prev.filter((l) => l.id !== listingId));
      toast.success("Listing rejected");
    } catch (err: any) {
      toast.error(err?.message || "Failed to reject listing");
    }
  };

  // ── Save settings ──
  // Note: creator_payout_percent and platform_fee_percent are HARDCODED
  // to 60 / 40 in this payload. The 60/40 split is locked policy, so the
  // admin UI cannot drift it — even if a future edit re-enables the
  // slider, the saved payload will still write 60/40 to the DB.
  const saveSettings = async () => {
    setSaving(true);
    try {
      const payload = {
        creator_payout_percent: 60,
        platform_fee_percent: 40,
        min_listing_price: settings.min_listing_price,
        max_listing_price: settings.max_listing_price,
        auto_approve_verified: settings.auto_approve_verified,
        hero_video_url: settings.hero_video_url || null,
        hero_video_title: settings.hero_video_title || "See RestyleProAI in Action",
        ig_auto_post_enabled: settings.ig_auto_post_enabled,
        ig_caption_style: settings.ig_caption_style,
        ig_custom_caption_template: settings.ig_custom_caption_template,
        ig_hashtags: settings.ig_hashtags,
        updated_at: new Date().toISOString(),
      };

      if (settings.id) {
        const { error } = await (supabase as any)
          .from("creator_market_settings")
          .update(payload)
          .eq("id", settings.id);
        if (error) throw error;
      } else {
        const { data, error } = await (supabase as any)
          .from("creator_market_settings")
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        setSettings((prev) => ({ ...prev, id: data.id }));
      }
      toast.success("Settings saved");
    } catch (err: any) {
      console.error("Save failed:", err);
      toast.error(err?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  // ── Update creator custom split ──
  const updateCreatorSplit = async (creatorId: string, customPercent: number | null) => {
    try {
      const { error } = await (supabase as any)
        .from("neuralnetwork_creator_profiles")
        .update({ custom_payout_percent: customPercent })
        .eq("id", creatorId);
      if (error) throw error;
      setCreators((prev) =>
        prev.map((c) => (c.id === creatorId ? { ...c, custom_payout_percent: customPercent } : c))
      );
      toast.success(`Creator split ${customPercent ? `set to ${customPercent}%` : "reset to global default"}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to update creator split");
    }
  };

  // ── Toggle creator verified/featured ──
  const toggleCreatorFlag = async (creatorId: string, field: "verified" | "featured", value: boolean) => {
    try {
      const { error } = await (supabase as any)
        .from("neuralnetwork_creator_profiles")
        .update({ [field]: value })
        .eq("id", creatorId);
      if (error) throw error;
      setCreators((prev) =>
        prev.map((c) => (c.id === creatorId ? { ...c, [field]: value } : c))
      );
      toast.success(`Creator ${field} ${value ? "enabled" : "disabled"}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to update creator");
    }
  };

  // ── Generate caption preview for selected render ──
  useEffect(() => {
    if (!selectedRender) {
      setCaptionPreview("");
      return;
    }
    const vInfo = selectedRender.vehicle_info;
    const vehicle = vInfo
      ? `${vInfo.year || ""} ${vInfo.make || ""} ${vInfo.model || ""}`.trim()
      : "Vehicle";
    const design = selectedRender.design_name || "Custom Wrap";
    const finish = selectedRender.finish_type || "";
    setCaptionPreview(
      generateCaption(settings.ig_caption_style, vehicle, design, finish, settings.ig_custom_caption_template, settings.ig_hashtags)
    );
  }, [selectedRender, settings.ig_caption_style, settings.ig_custom_caption_template, settings.ig_hashtags]);

  // ── Push render to IG ──
  const pushToInstagram = async (render: RenderForIG, caption: string) => {
    setPushingToIG(true);
    try {
      const { error } = await supabase.functions.invoke("push-to-instagram", {
        body: {
          render_id: render.id,
          image_url: render.thumbnail_url,
          caption,
        },
      });
      if (error) throw error;
      toast.success("Pushed to Instagram!");
      setRenders((prev) =>
        prev.map((r) =>
          r.id === render.id
            ? { ...r, ig_pushed: true, ig_pushed_at: new Date().toISOString() }
            : r
        )
      );
      setSelectedRender(null);
    } catch (err: any) {
      console.error("IG push failed:", err);
      toast.error(err?.message || "Failed to push to Instagram. Make sure the edge function is deployed.");
    } finally {
      setPushingToIG(false);
    }
  };

  // ── Computed ──
  const totalCreators = creators.length;
  const verifiedCreators = creators.filter((c) => c.verified).length;
  const totalListings = creators.reduce((sum, c) => sum + (c.total_designs || 0), 0);
  const totalRevenue = creators.reduce((sum, c) => sum + (c.total_earnings || 0), 0);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8 pt-24 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600">
              <Store className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-foreground">
                Creator<span className="text-gradient-blue">Market</span> Admin
              </h1>
              <p className="text-muted-foreground">
                Manage revenue splits, creators, and Instagram publishing
              </p>
            </div>
            <Button onClick={saveSettings} disabled={saving} className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-500 text-white">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save All Settings
            </Button>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="border-violet-500/30">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <Users className="h-5 w-5 text-violet-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{totalCreators}</p>
                <p className="text-xs text-muted-foreground">Total Creators</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/30">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Shield className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{verifiedCreators}</p>
                <p className="text-xs text-muted-foreground">Verified</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-blue-500/30">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Package className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{totalListings}</p>
                <p className="text-xs text-muted-foreground">Total Designs</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber-500/30">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <DollarSign className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  ${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground">Total Revenue</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-background border border-border">
            <TabsTrigger value="split" className="gap-2">
              <Percent className="h-4 w-4" />
              Revenue Split
            </TabsTrigger>
            <TabsTrigger value="creators" className="gap-2">
              <Users className="h-4 w-4" />
              Creators
            </TabsTrigger>
            <TabsTrigger value="listings" className="gap-2">
              <Package className="h-4 w-4" />
              Listings
              {pendingListings.length > 0 && (
                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 ml-1 px-1.5 py-0 text-[10px]">
                  {pendingListings.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="video" className="gap-2">
              <Zap className="h-4 w-4" />
              Hero Video
            </TabsTrigger>
            <TabsTrigger value="instagram" className="gap-2">
              <Instagram className="h-4 w-4" />
              Instagram
            </TabsTrigger>
          </TabsList>

          {/* ══════════════════════════════════════════════════════════════
              TAB: Revenue Split
          ══════════════════════════════════════════════════════════════ */}
          <TabsContent value="split" className="space-y-6">
            {/* Global Split Control */}
            <Card className="border-violet-500/30">
              <CardContent className="p-6 space-y-6">
                <div className="flex items-center gap-3 mb-2">
                  <Percent className="h-5 w-5 text-violet-400" />
                  <h2 className="text-xl font-bold text-foreground">Global Revenue Split</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Set the default profit split for all creators on the marketplace. Individual creators can be overridden below.
                </p>

                {/* Visual split bar */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-violet-400 font-semibold">Creator: {settings.creator_payout_percent}%</span>
                    <span className="text-zinc-500 font-semibold">Platform: {settings.platform_fee_percent}%</span>
                  </div>
                  <div className="h-8 rounded-full overflow-hidden flex">
                    <div
                      className="bg-gradient-to-r from-violet-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold transition-all duration-300"
                      style={{ width: `${settings.creator_payout_percent}%` }}
                    >
                      {settings.creator_payout_percent}%
                    </div>
                    <div
                      className="bg-zinc-700 flex items-center justify-center text-zinc-300 text-xs font-bold transition-all duration-300"
                      style={{ width: `${settings.platform_fee_percent}%` }}
                    >
                      {settings.platform_fee_percent}%
                    </div>
                  </div>
                  {/* 60/40 is locked. The slider stays mounted so admins
                      can still see the current split at a glance, but
                      it's disabled — the value cannot be changed from
                      the UI. To shift the policy you must edit
                      DEFAULT_SETTINGS in code and ship a deploy. */}
                  <Slider
                    value={[60]}
                    min={60}
                    max={60}
                    step={1}
                    disabled
                    className="py-2 opacity-60 cursor-not-allowed"
                  />
                  <div className="text-[10px] text-amber-300/80 bg-amber-500/10 border border-amber-500/20 rounded-md px-2 py-1.5 leading-snug">
                    The 60 / 40 split is locked policy — it backs the
                    public pricing promise on /pricing and the legal
                    terms shown to publishers. Changing it requires a
                    code deploy.
                  </div>
                </div>

                {/* Example pricing at current split */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                  {[199, 349, 499, 799].map((price) => (
                    <div key={price} className="p-3 rounded-lg border border-border bg-background/50 text-center">
                      <p className="text-xs text-muted-foreground mb-1">${price} sale</p>
                      <p className="text-lg font-bold text-violet-400">
                        ${(price * settings.creator_payout_percent / 100).toFixed(2)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Creator earns</p>
                      <p className="text-sm font-semibold text-zinc-500 mt-1">
                        ${(price * settings.platform_fee_percent / 100).toFixed(2)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Platform keeps</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Listing Price Bounds */}
            <Card className="border-border">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <Tag className="h-5 w-5 text-cyan-400" />
                  <h2 className="text-lg font-bold text-foreground">Listing Price Bounds</h2>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label className="text-sm text-muted-foreground">Minimum Listing Price</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-lg text-muted-foreground">$</span>
                      <Input
                        type="number"
                        value={settings.min_listing_price}
                        onChange={(e) => setSettings((prev) => ({ ...prev, min_listing_price: Number(e.target.value) }))}
                        min={1}
                        className="w-32"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm text-muted-foreground">Maximum Listing Price</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-lg text-muted-foreground">$</span>
                      <Input
                        type="number"
                        value={settings.max_listing_price}
                        onChange={(e) => setSettings((prev) => ({ ...prev, max_listing_price: Number(e.target.value) }))}
                        min={1}
                        className="w-32"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-4">
                  <Switch
                    checked={settings.auto_approve_verified}
                    onCheckedChange={(val) => setSettings((prev) => ({ ...prev, auto_approve_verified: val }))}
                  />
                  <Label className="text-sm">Auto-approve listings from verified creators</Label>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════
              TAB: Creators
          ══════════════════════════════════════════════════════════════ */}
          <TabsContent value="creators" className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-foreground">Creator Profiles</h2>
              <Button variant="outline" size="sm" onClick={loadCreators} className="gap-2">
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>

            {creatorsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
              </div>
            ) : creators.length === 0 ? (
              <Card className="border-dashed border-2 border-border">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Users className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-xl font-bold text-foreground mb-2">No Creators Yet</h3>
                  <p className="text-muted-foreground text-center max-w-md">
                    Creators will appear here when they set up profiles on CreatorMarket.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {creators.map((creator) => {
                  const effectivePercent = creator.custom_payout_percent ?? settings.creator_payout_percent;
                  return (
                    <Card key={creator.id} className={cn("border-border", creator.verified && "border-emerald-500/30")}>
                      <CardContent className="p-4">
                        <div className="flex flex-col md:flex-row md:items-center gap-4">
                          {/* Creator info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-semibold text-foreground truncate">
                                {creator.display_name || "Unnamed Creator"}
                              </p>
                              {creator.verified && (
                                <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]">Verified</Badge>
                              )}
                              {creator.featured && (
                                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">Featured</Badge>
                              )}
                              <Badge className={cn(
                                "text-[10px]",
                                creator.status === "active" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" :
                                creator.status === "pending" ? "bg-blue-500/20 text-blue-300 border-blue-500/30" :
                                "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
                              )}>
                                {creator.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span>{creator.total_designs || 0} designs</span>
                              <span>{creator.total_sales || 0} sales</span>
                              <span>${(creator.total_earnings || 0).toFixed(2)} earned</span>
                              <span>Joined {format(new Date(creator.created_at), "MMM d, yyyy")}</span>
                            </div>
                          </div>

                          {/* Controls */}
                          <div className="flex items-center gap-3 shrink-0">
                            {/* Custom split */}
                            <div className="flex items-center gap-2">
                              <Label className="text-xs text-muted-foreground whitespace-nowrap">Payout:</Label>
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  value={creator.custom_payout_percent ?? ""}
                                  placeholder={`${settings.creator_payout_percent}`}
                                  onChange={(e) => {
                                    const val = e.target.value ? Number(e.target.value) : null;
                                    setCreators((prev) =>
                                      prev.map((c) => (c.id === creator.id ? { ...c, custom_payout_percent: val } : c))
                                    );
                                  }}
                                  min={10}
                                  max={90}
                                  className="w-16 h-8 text-xs"
                                />
                                <span className="text-xs text-muted-foreground">%</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => updateCreatorSplit(creator.id, creator.custom_payout_percent)}
                              >
                                <Save className="h-3 w-3" />
                              </Button>
                            </div>

                            {/* Verified toggle */}
                            <div className="flex items-center gap-1">
                              <Switch
                                checked={creator.verified}
                                onCheckedChange={(val) => toggleCreatorFlag(creator.id, "verified", val)}
                              />
                              <Label className="text-[10px] text-muted-foreground">Verified</Label>
                            </div>

                            {/* Featured toggle */}
                            <div className="flex items-center gap-1">
                              <Switch
                                checked={creator.featured}
                                onCheckedChange={(val) => toggleCreatorFlag(creator.id, "featured", val)}
                              />
                              <Label className="text-[10px] text-muted-foreground">Featured</Label>
                            </div>
                          </div>
                        </div>

                        {/* Effective split bar */}
                        <div className="mt-3 flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full overflow-hidden flex">
                            <div
                              className="bg-violet-500 transition-all duration-300"
                              style={{ width: `${effectivePercent}%` }}
                            />
                            <div
                              className="bg-zinc-700 transition-all duration-300"
                              style={{ width: `${100 - effectivePercent}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {effectivePercent}% / {100 - effectivePercent}%
                            {creator.custom_payout_percent !== null && " (custom)"}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════
              TAB: Listings (pending review queue)
          ══════════════════════════════════════════════════════════════ */}
          <TabsContent value="listings" className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-bold text-foreground">Listings Awaiting Review</h2>
                <p className="text-sm text-muted-foreground">
                  Approve listings from creators who aren't auto-approved. Drafts are shown so you can shepherd
                  them through if a creator gets stuck.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={loadPendingListings} className="gap-2">
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>

            {pendingListingsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
              </div>
            ) : pendingListings.length === 0 ? (
              <Card className="border-dashed border-2 border-border">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Package className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-xl font-bold text-foreground mb-2">Inbox Zero</h3>
                  <p className="text-muted-foreground text-center max-w-md">
                    No listings are waiting for review.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {pendingListings.map((l) => {
                  const vehicle = [l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(" ");
                  return (
                    <Card key={l.id} className="border-border overflow-hidden">
                      <div className="aspect-video bg-muted relative overflow-hidden">
                        {l.thumbnail_url ? (
                          <img src={l.thumbnail_url} alt={l.title || ""} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package className="h-10 w-10 text-muted-foreground/40" />
                          </div>
                        )}
                        <Badge
                          className={cn(
                            "absolute top-2 left-2 border-0 text-[10px]",
                            l.status === "pending_review"
                              ? "bg-blue-500/90 text-white"
                              : "bg-zinc-600/80 text-white",
                          )}
                        >
                          {l.status === "pending_review" ? "In Review" : "Draft"}
                        </Badge>
                        {l.creator_verified && (
                          <Badge className="absolute top-2 right-2 bg-emerald-500/90 text-white border-0 text-[10px] gap-1">
                            <Shield className="w-2.5 h-2.5" />
                            Verified
                          </Badge>
                        )}
                        <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full">
                          <span className="text-sm font-bold text-white">${l.price ?? 160}</span>
                        </div>
                      </div>
                      <CardContent className="p-4 space-y-3">
                        <div>
                          <p className="font-semibold text-foreground truncate">{vehicle || "Vehicle"}</p>
                          <p className="text-xs text-muted-foreground truncate">{l.title || "Untitled"}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            By <span className="text-foreground">{l.creator_display_name || "Creator"}</span> · {format(new Date(l.created_at), "MMM d")}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => approveListing(l.id)}
                          >
                            <Check className="h-3.5 w-3.5" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10"
                            onClick={() => rejectListing(l.id)}
                          >
                            <X className="h-3.5 w-3.5" />
                            Reject
                          </Button>
                        </div>
                        {/* Push this CreatorMarket design straight into Panel Studio
                            (prefilled flat source + vehicle + title) to build/test
                            the print-ready output files. Prefers the true 2D panel
                            source, falls back to the listing image. */}
                        {(l.panel_2d_url || l.thumbnail_url) && (
                          <a
                            href={`/admin/wrap-panel-studio?${new URLSearchParams({
                              proof_url: (l.panel_2d_url || l.thumbnail_url)!,
                              ...(vehicle ? { vehicle } : {}),
                              ...(l.title ? { project: l.title } : {}),
                            }).toString()}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 h-8 text-xs font-semibold"
                          >
                            <Layers className="h-3.5 w-3.5" />
                            Open in Panel Studio — build output files ↗
                          </a>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════
              TAB: Hero Video
          ══════════════════════════════════════════════════════════════ */}
          <TabsContent value="video" className="space-y-6">
            <Card>
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-5 w-5 text-cyan-400" />
                  <h3 className="text-lg font-semibold text-foreground">CreatorMarket Hero Video</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Set a demo/promo video that plays at the top of the CreatorMarket page.
                  Supports YouTube, Vimeo, or direct .mp4 URLs.
                </p>
                <div>
                  <Label className="text-sm mb-1.5 block">Video Title</Label>
                  <Input
                    value={settings.hero_video_title}
                    onChange={(e) => setSettings((s) => ({ ...s, hero_video_title: e.target.value }))}
                    placeholder="See RestyleProAI in Action"
                  />
                </div>
                <div>
                  <Label className="text-sm mb-1.5 block">Video URL</Label>
                  <Input
                    value={settings.hero_video_url}
                    onChange={(e) => setSettings((s) => ({ ...s, hero_video_url: e.target.value }))}
                    placeholder="https://youtube.com/watch?v=... or https://vimeo.com/... or .mp4 URL"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">Leave empty to hide the video section</p>
                </div>
                {settings.hero_video_url && (
                  <div className="rounded-xl overflow-hidden border border-border bg-black aspect-video">
                    {settings.hero_video_url.match(/youtube\.com|youtu\.be/) ? (
                      <iframe
                        src={`https://www.youtube.com/embed/${settings.hero_video_url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/)?.[1]}?rel=0`}
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    ) : settings.hero_video_url.match(/vimeo\.com/) ? (
                      <iframe
                        src={`https://player.vimeo.com/video/${settings.hero_video_url.match(/vimeo\.com\/(\d+)/)?.[1]}`}
                        className="w-full h-full"
                        allow="autoplay; fullscreen; picture-in-picture"
                        allowFullScreen
                      />
                    ) : (
                      <video src={settings.hero_video_url} controls className="w-full h-full" />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════
              TAB: Instagram
          ══════════════════════════════════════════════════════════════ */}
          <TabsContent value="instagram" className="space-y-6">
            {/* IG Settings */}
            <Card className="border-pink-500/30">
              <CardContent className="p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-r from-pink-500 to-purple-600">
                    <Instagram className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">Instagram Auto-Publish</h2>
                    <p className="text-sm text-muted-foreground">
                      Push kick-ass renders directly to @RestyleProAI's Instagram
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    checked={settings.ig_auto_post_enabled}
                    onCheckedChange={(val) => setSettings((prev) => ({ ...prev, ig_auto_post_enabled: val }))}
                  />
                  <Label>Enable Instagram auto-publishing (requires edge function + Meta Graph API)</Label>
                </div>

                {/* Caption Style */}
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Caption Style</Label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { key: "sabri" as const, label: "Sabri Suby", desc: "High-energy, direct CTA, urgency" },
                      { key: "garyvee" as const, label: "Gary Vee", desc: "Blunt, motivational, no-BS" },
                      { key: "subry" as const, label: "Creative", desc: "Artistic, visual storytelling" },
                      { key: "custom" as const, label: "Custom", desc: "Your own template" },
                    ].map((style) => (
                      <button
                        key={style.key}
                        onClick={() => setSettings((prev) => ({ ...prev, ig_caption_style: style.key }))}
                        className={cn(
                          "p-3 rounded-lg border text-left transition-all",
                          settings.ig_caption_style === style.key
                            ? "border-pink-500 bg-pink-500/10 ring-1 ring-pink-500/30"
                            : "border-border hover:border-pink-500/40",
                        )}
                      >
                        <p className="text-sm font-semibold text-foreground">{style.label}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{style.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom template */}
                {settings.ig_caption_style === "custom" && (
                  <div className="space-y-2">
                    <Label className="text-sm">Custom Caption Template</Label>
                    <Textarea
                      value={settings.ig_custom_caption_template}
                      onChange={(e) => setSettings((prev) => ({ ...prev, ig_custom_caption_template: e.target.value }))}
                      placeholder="Use {vehicle}, {design}, {finish} as placeholders..."
                      rows={5}
                      className="font-mono text-sm"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Variables: {"{vehicle}"} = vehicle name, {"{design}"} = design name, {"{finish}"} = finish type
                    </p>
                  </div>
                )}

                {/* Hashtags */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Hashtags</Label>
                  <Textarea
                    value={settings.ig_hashtags}
                    onChange={(e) => setSettings((prev) => ({ ...prev, ig_hashtags: e.target.value }))}
                    rows={2}
                    className="font-mono text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Render Picker for IG Push */}
            <Card className="border-border">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <Zap className="h-5 w-5 text-amber-400" />
                  <h2 className="text-lg font-bold text-foreground">Push a Render to Instagram</h2>
                  <p className="text-sm text-muted-foreground ml-2">
                    Pick a kick-ass render, preview the caption, and send it live.
                  </p>
                </div>

                {rendersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-pink-400" />
                  </div>
                ) : renders.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No recent renders found.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2 max-h-[400px] overflow-y-auto">
                      {renders.map((render) => (
                        <button
                          key={render.id}
                          onClick={() => setSelectedRender(render)}
                          className={cn(
                            "relative aspect-video rounded-lg overflow-hidden border-2 transition-all",
                            selectedRender?.id === render.id
                              ? "border-pink-500 ring-2 ring-pink-500/30"
                              : "border-border hover:border-pink-500/40",
                            render.ig_pushed && "opacity-50",
                          )}
                        >
                          {render.thumbnail_url ? (
                            <img src={render.thumbnail_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-muted flex items-center justify-center">
                              <Image className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          {render.ig_pushed && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                              <Check className="h-5 w-5 text-emerald-400" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Caption Preview + Push */}
                    {selectedRender && (
                      <Card className="border-pink-500/30 bg-pink-500/5 mt-4">
                        <CardContent className="p-4 space-y-4">
                          <div className="flex items-start gap-4">
                            {selectedRender.thumbnail_url && (
                              <img
                                src={selectedRender.thumbnail_url}
                                alt=""
                                className="w-32 h-20 object-cover rounded-lg border border-border"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-foreground mb-1">
                                {selectedRender.vehicle_info
                                  ? `${selectedRender.vehicle_info.year || ""} ${selectedRender.vehicle_info.make || ""} ${selectedRender.vehicle_info.model || ""}`.trim()
                                  : "Vehicle"}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {selectedRender.design_name || "Custom"}
                                {selectedRender.finish_type && ` - ${selectedRender.finish_type}`}
                              </p>
                            </div>
                          </div>

                          <div>
                            <Label className="text-xs text-muted-foreground mb-2 block">Caption Preview</Label>
                            <Textarea
                              value={captionPreview}
                              onChange={(e) => setCaptionPreview(e.target.value)}
                              rows={8}
                              className="font-mono text-sm"
                            />
                          </div>

                          <div className="flex items-center gap-3">
                            <Button
                              onClick={() => pushToInstagram(selectedRender, captionPreview)}
                              disabled={pushingToIG || !captionPreview}
                              className="gap-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white"
                            >
                              {pushingToIG ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Instagram className="h-4 w-4" />
                              )}
                              Push to Instagram
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => setSelectedRender(null)}
                              className="gap-2"
                            >
                              <X className="h-4 w-4" />
                              Cancel
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
