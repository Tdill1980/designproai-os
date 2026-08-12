import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Star, Trash2, RefreshCw, Search, Loader2, Eye, Package,
  ShoppingBag, Mail, CheckCircle2, XCircle, Image as ImageIcon,
  Filter, StarOff, Send, Tag, BarChart3, Zap, ChevronDown,
  AlertTriangle, ArrowUpDown, Globe, Hash, FlipHorizontal2,
  Wand2, Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { generatePassengerMirror, uploadMirrorToStorage, designLikelyHasText, fixMirrorText } from "@/utils/passenger-mirror";

/** Canonical 7-view order */
const ALL_VIEWS = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"] as const;

const VIEW_LABELS: Record<string, string> = {
  side: "Driver Side",
  "passenger-side": "Passenger",
  hood_detail: "Hood",
  front: "Front 3/4",
  rear: "Rear 3/4",
  "close-up": "Close-Up",
  roof: "Roof",
};

interface RenderRecord {
  id: string;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  color_name: string | null;
  design_file_name: string | null;
  finish_type: string | null;
  mode_type: string | null;
  render_urls: Record<string, string> | null;
  is_featured_hero: boolean;
  customer_email: string | null;
  created_at: string;
  source_photo_url: string | null;
  custom_design_url: string | null;
  color_hex: string | null;
}

type SortField = "created_at" | "view_count" | "vehicle";
type FilterView = "all" | "starred" | "complete" | "incomplete";

export default function AdminMarketplaceInventory() {
  const navigate = useNavigate();
  const [renders, setRenders] = useState<RenderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterView, setFilterView] = useState<FilterView>("all");

  // Lightbox state
  const [lightboxRender, setLightboxRender] = useState<RenderRecord | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [regeneratingViews, setRegeneratingViews] = useState<Record<string, Set<string>>>({});
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // ── Load renders (server-side filtered) ──
  const loadRenders = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("color_visualizations")
        .select("id, vehicle_year, vehicle_make, vehicle_model, color_name, design_file_name, finish_type, mode_type, render_urls, is_featured_hero, customer_email, created_at, source_photo_url, custom_design_url, color_hex")
        .eq("generation_status", "completed")
        .not("render_urls", "is", null);

      // Server-side filter for starred
      if (filterView === "starred") {
        query = query.eq("is_featured_hero", true);
      }

      // Order: starred first, then by date
      query = query
        .order("is_featured_hero", { ascending: false })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, error } = await query;
      if (error) throw error;
      setRenders(data || []);
    } catch (err: any) {
      console.error("Load renders error:", err);
      toast.error("Failed to load renders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setPage(0); loadRenders(); }, [filterView]);
  useEffect(() => { loadRenders(); }, [page]);

  // ── Helpers ──
  const getViewCount = (r: RenderRecord) => r.render_urls ? Object.keys(r.render_urls).length : 0;
  const getMissingViews = (r: RenderRecord) => ALL_VIEWS.filter((v) => !r.render_urls?.[v]);
  const getVehicleLabel = (r: RenderRecord) => [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ");
  const getDesignLabel = (r: RenderRecord) => r.design_file_name || r.color_name || "Unnamed Design";

  // ── Filtered + sorted ──
  const filtered = useMemo(() => {
    let list = [...renders];

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) =>
        getVehicleLabel(r).toLowerCase().includes(q) ||
        getDesignLabel(r).toLowerCase().includes(q) ||
        r.customer_email?.toLowerCase().includes(q)
      );
    }

    // Client-side filters (starred is handled server-side)
    if (filterView === "complete") list = list.filter((r) => getViewCount(r) === 7);
    if (filterView === "incomplete") list = list.filter((r) => getViewCount(r) < 7);

    // Sort
    if (sortField === "view_count") list.sort((a, b) => getViewCount(b) - getViewCount(a));
    if (sortField === "vehicle") list.sort((a, b) => getVehicleLabel(a).localeCompare(getVehicleLabel(b)));

    return list;
  }, [renders, searchQuery, filterView, sortField]);

  // ── Stats (from DB, not just loaded page) ──
  const [stats, setStats] = useState({ total: 0, starred: 0, complete: 0, incomplete: 0 });
  const loadStats = async () => {
    try {
      const { count: total } = await supabase
        .from("color_visualizations")
        .select("id", { count: "exact", head: true })
        .eq("generation_status", "completed")
        .not("render_urls", "is", null);
      const { count: starred } = await supabase
        .from("color_visualizations")
        .select("id", { count: "exact", head: true })
        .eq("generation_status", "completed")
        .eq("is_featured_hero", true)
        .not("render_urls", "is", null);
      setStats({
        total: total || 0,
        starred: starred || 0,
        complete: 0, // calculated client-side from loaded data
        incomplete: 0,
      });
    } catch { /* silent */ }
  };
  useEffect(() => { loadStats(); }, [renders]);
  // Update complete/incomplete from loaded renders
  useEffect(() => {
    setStats((prev) => ({
      ...prev,
      complete: renders.filter((r) => getViewCount(r) === 7).length,
      incomplete: renders.filter((r) => getViewCount(r) < 7).length,
    }));
  }, [renders]);

  // ── Toggle star ──
  const toggleStar = async (id: string, current: boolean) => {
    try {
      const { error } = await supabase
        .from("color_visualizations")
        .update({ is_featured_hero: !current })
        .eq("id", id);
      if (error) throw error;
      setRenders((prev) => prev.map((r) => r.id === id ? { ...r, is_featured_hero: !current } : r));
      toast.success(!current ? "Starred for marketplace" : "Unstarred");
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    }
  };

  // ── Delete render ──
  const deleteRender = async (id: string) => {
    if (!confirm("Delete this render permanently?")) return;
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      const { error } = await supabase
        .from("color_visualizations")
        .delete()
        .eq("id", id);
      if (error) throw error;
      setRenders((prev) => prev.filter((r) => r.id !== id));
      setSelectedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      toast.success("Render deleted");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete");
    } finally {
      setDeletingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  // ── Regenerate a missing view ──
  const regenerateView = async (render: RenderRecord, viewType: string) => {
    setRegeneratingViews((prev) => {
      const updated = { ...prev };
      updated[render.id] = new Set(updated[render.id] || []);
      updated[render.id].add(viewType);
      return updated;
    });

    try {
      // Build color data payload from the render record
      const colorData: any = {
        hex: render.color_hex || "#000000",
        name: render.color_name || "Custom",
        finish: render.finish_type || "gloss",
      };
      if (render.custom_design_url) colorData.designUrl = render.custom_design_url;
      if (render.source_photo_url) colorData.sourcePhotoUrl = render.source_photo_url;

      const { data, error } = await supabase.functions.invoke("generate-color-render", {
        body: {
          vehicleYear: render.vehicle_year,
          vehicleMake: render.vehicle_make,
          vehicleModel: render.vehicle_model,
          colorData,
          modeType: render.mode_type || "designpanelpro",
          viewType,
          userEmail: render.customer_email || "admin@restylepro.com",
          skipLookups: true,
        },
      });

      if (error) throw error;

      if (data?.renderUrl) {
        // Merge the new view into existing render_urls
        const updatedUrls = { ...(render.render_urls || {}), [viewType]: data.renderUrl };
        const { error: updateErr } = await supabase
          .from("color_visualizations")
          .update({ render_urls: updatedUrls })
          .eq("id", render.id);
        if (updateErr) throw updateErr;

        setRenders((prev) => prev.map((r) =>
          r.id === render.id ? { ...r, render_urls: updatedUrls } : r
        ));
        toast.success(`${VIEW_LABELS[viewType]} regenerated`);
      } else {
        toast.error(`No image returned for ${VIEW_LABELS[viewType]}`);
      }
    } catch (err: any) {
      console.error("Regen error:", err);
      toast.error(`Failed to regenerate ${VIEW_LABELS[viewType]}: ${err.message || "Unknown error"}`);
    } finally {
      setRegeneratingViews((prev) => {
        const updated = { ...prev };
        if (updated[render.id]) {
          updated[render.id] = new Set(updated[render.id]);
          updated[render.id].delete(viewType);
          if (updated[render.id].size === 0) delete updated[render.id];
        }
        return updated;
      });
    }
  };

  // ── Regenerate ALL missing views for a render ──
  const regenerateAllMissing = async (render: RenderRecord) => {
    const missing = getMissingViews(render);
    if (missing.length === 0) { toast.info("All 7 views present"); return; }
    toast.info(`Regenerating ${missing.length} missing views...`);
    // Run in sequential pairs (Gemini rate-limit friendly)
    for (let i = 0; i < missing.length; i += 2) {
      const batch = missing.slice(i, i + 2);
      await Promise.all(batch.map((v) => regenerateView(render, v)));
    }
  };

  // ── Flip passenger side (mirror driver side) ──
  const [flippingIds, setFlippingIds] = useState<Set<string>>(new Set());

  const flipPassengerSide = async (render: RenderRecord) => {
    const driverUrl = render.render_urls?.side;
    if (!driverUrl) {
      toast.error("No driver side image to mirror");
      return;
    }

    setFlippingIds((prev) => new Set(prev).add(render.id));
    try {
      // Step 1: Canvas flip (instant)
      toast.info("Mirroring driver side...");
      const mirrorDataUrl = await generatePassengerMirror(driverUrl);

      // Step 2: Upload mirrored image to storage
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || "admin";
      const mirrorUrl = await uploadMirrorToStorage(supabase, mirrorDataUrl, userId);

      let finalUrl = mirrorUrl;

      // Step 3: If branded/commercial, send to AI to fix text direction
      const isBranded = render.design_file_name
        ? designLikelyHasText({ prompt: render.design_file_name, modeType: render.mode_type || "" })
        : (render.color_name ? designLikelyHasText({ prompt: render.color_name }) : false);

      if (isBranded) {
        toast.info("Commercial design detected — fixing text direction...");
        finalUrl = await fixMirrorText(mirrorUrl, {
          vehicleYear: String(render.vehicle_year || ""),
          vehicleMake: render.vehicle_make || "",
          vehicleModel: render.vehicle_model || "",
          toolType: render.mode_type || "designpanelpro",
          invokeEdgeFunction: (fn, body) => supabase.functions.invoke(fn, { body }),
        });
      }

      // Step 4: Update render_urls in DB
      const updatedUrls = { ...(render.render_urls || {}), "passenger-side": finalUrl };
      const { error } = await supabase
        .from("color_visualizations")
        .update({ render_urls: updatedUrls })
        .eq("id", render.id);
      if (error) throw error;

      setRenders((prev) => prev.map((r) =>
        r.id === render.id ? { ...r, render_urls: updatedUrls } : r
      ));
      toast.success(isBranded ? "Passenger side mirrored + text corrected" : "Passenger side mirrored");
    } catch (err: any) {
      console.error("Flip error:", err);
      toast.error(`Flip failed: ${err.message || "Unknown error"}`);
    } finally {
      setFlippingIds((prev) => { const s = new Set(prev); s.delete(render.id); return s; });
    }
  };

  // ── Re-render for photorealism ──
  const [reRenderingIds, setReRenderingIds] = useState<Set<string>>(new Set());
  const [reRenderMode, setReRenderMode] = useState<"approvemode" | "designpro" | "revise">("approvemode");

  const reRenderDesign = async (render: RenderRecord, mode: "approvemode" | "designpro" | "revise") => {
    const heroUrl = render.render_urls?.side || Object.values(render.render_urls || {})[0];
    if (!heroUrl) { toast.error("No hero image to re-render from"); return; }

    setReRenderingIds((prev) => new Set(prev).add(render.id));
    const modeLabel = mode === "approvemode" ? "ApproveMode (same design)" : mode === "designpro" ? "Fresh DesignPro" : "Revise";
    toast.info(`Re-rendering via ${modeLabel}...`);

    try {
      let body: any = {
        vehicleYear: render.vehicle_year,
        vehicleMake: render.vehicle_make,
        vehicleModel: render.vehicle_model,
        viewType: "side",
        userEmail: render.customer_email || "admin@restylepro.com",
        skipLookups: true,
      };

      if (mode === "approvemode") {
        // Same design, photorealistic re-render — use existing render as reference
        body.modeType = "approvemode";
        body.colorData = {
          hex: render.color_hex || "#000000",
          name: render.color_name || "Custom",
          finish: render.finish_type || "gloss",
          designUrl: heroUrl,
        };
      } else if (mode === "designpro") {
        // Fresh design from the design name
        body = {
          prompt: render.design_file_name || render.color_name || "Premium vehicle wrap",
          mode: "restyle",
          finish: render.finish_type || "Gloss",
          vehicleYear: render.vehicle_year,
          vehicleMake: render.vehicle_make,
          vehicleModel: render.vehicle_model,
        };
        // Use design-panel-ai-generate instead
        const { data, error } = await supabase.functions.invoke("design-panel-ai-generate", { body });
        if (error) throw error;
        if (data?.renderUrl) {
          const updatedUrls = { ...(render.render_urls || {}), side: data.renderUrl };
          await supabase.from("color_visualizations").update({ render_urls: updatedUrls }).eq("id", render.id);
          setRenders((prev) => prev.map((r) => r.id === render.id ? { ...r, render_urls: updatedUrls } : r));
          toast.success("Fresh DesignPro render complete");
        } else {
          toast.error("No image returned");
        }
        setReRenderingIds((prev) => { const s = new Set(prev); s.delete(render.id); return s; });
        return;
      } else {
        // Revise — send original with "make photorealistic" prompt
        const { data, error } = await supabase.functions.invoke("revise-render", {
          body: {
            originalRenderUrl: heroUrl,
            revisionPrompt: "Re-render this vehicle wrap in a professional photography studio with photorealistic lighting. Dark charcoal floor, light gray walls, bright even studio lighting. Keep the exact same wrap design, colors, and patterns. Make it look like a real photograph taken with a Canon EOS R5.",
            toolType: render.mode_type || "designpanelpro",
            viewType: "side",
            vehicleYear: String(render.vehicle_year || ""),
            vehicleMake: render.vehicle_make || "",
            vehicleModel: render.vehicle_model || "",
          },
        });
        if (error) throw error;
        if (data?.renderUrl) {
          const updatedUrls = { ...(render.render_urls || {}), side: data.renderUrl };
          await supabase.from("color_visualizations").update({ render_urls: updatedUrls }).eq("id", render.id);
          setRenders((prev) => prev.map((r) => r.id === render.id ? { ...r, render_urls: updatedUrls } : r));
          toast.success("Revision complete — photorealistic upgrade applied");
        } else {
          toast.error("No image returned from revision");
        }
        setReRenderingIds((prev) => { const s = new Set(prev); s.delete(render.id); return s; });
        return;
      }

      // ApproveMode path
      const { data, error } = await supabase.functions.invoke("generate-color-render", { body });
      if (error) throw error;
      if (data?.renderUrl) {
        const updatedUrls = { ...(render.render_urls || {}), side: data.renderUrl };
        await supabase.from("color_visualizations").update({ render_urls: updatedUrls }).eq("id", render.id);
        setRenders((prev) => prev.map((r) => r.id === render.id ? { ...r, render_urls: updatedUrls } : r));
        toast.success("ApproveMode re-render complete — same design, photorealistic");
      } else {
        toast.error("No image returned");
      }
    } catch (err: any) {
      console.error("Re-render error:", err);
      toast.error(`Re-render failed: ${err.message || "Unknown error"}`);
    } finally {
      setReRenderingIds((prev) => { const s = new Set(prev); s.delete(render.id); return s; });
    }
  };

  // ── Bulk actions ──
  const handleBulkAction = async () => {
    if (selectedIds.size === 0) { toast.error("No renders selected"); return; }
    const ids = Array.from(selectedIds);

    if (bulkAction === "star") {
      const { error } = await supabase
        .from("color_visualizations")
        .update({ is_featured_hero: true })
        .in("id", ids);
      if (error) { toast.error("Bulk star failed"); return; }
      setRenders((prev) => prev.map((r) => ids.includes(r.id) ? { ...r, is_featured_hero: true } : r));
      toast.success(`${ids.length} renders starred`);
    } else if (bulkAction === "unstar") {
      const { error } = await supabase
        .from("color_visualizations")
        .update({ is_featured_hero: false })
        .in("id", ids);
      if (error) { toast.error("Bulk unstar failed"); return; }
      setRenders((prev) => prev.map((r) => ids.includes(r.id) ? { ...r, is_featured_hero: false } : r));
      toast.success(`${ids.length} renders unstarred`);
    } else if (bulkAction === "delete") {
      if (!confirm(`Delete ${ids.length} renders permanently?`)) return;
      const { error } = await supabase
        .from("color_visualizations")
        .delete()
        .in("id", ids);
      if (error) { toast.error("Bulk delete failed"); return; }
      setRenders((prev) => prev.filter((r) => !ids.includes(r.id)));
      setSelectedIds(new Set());
      toast.success(`${ids.length} renders deleted`);
    } else if (bulkAction === "create-listings") {
      toast.info("Creating listings from starred renders...");
      navigate("/admin/creator-market");
    } else if (bulkAction === "email-campaign") {
      // Navigate to campaigns with pre-selected render IDs
      const renderData = renders.filter((r) => ids.includes(r.id)).map((r) => ({
        id: r.id,
        vehicle: getVehicleLabel(r),
        design: getDesignLabel(r),
        thumbnail: r.render_urls?.side || Object.values(r.render_urls || {})[0] || "",
      }));
      sessionStorage.setItem("campaign_render_ids", JSON.stringify(renderData));
      navigate("/admin/campaigns");
      toast.success(`${ids.length} renders queued for email campaign`);
    } else if (bulkAction === "rerender-approve" || bulkAction === "rerender-revise") {
      const mode = bulkAction === "rerender-approve" ? "approvemode" : "revise";
      toast.info(`Re-rendering ${ids.length} designs via ${mode}... This runs sequentially.`);
      for (const id of ids) {
        const render = renders.find((r) => r.id === id);
        if (render) await reRenderDesign(render, mode as any);
      }
    }

    setBulkAction("");
    setSelectedIds(new Set());
  };

  // ── Select all visible ──
  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((r) => r.id)));
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8 pt-24">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600">
                <Package className="h-6 w-6 text-white" />
              </div>
              Marketplace Inventory
            </h1>
            <p className="text-sm text-zinc-500 mt-1">Manage renders, fill missing views, star for marketplace, push to email campaigns</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate("/admin/creator-market")}>
              <Tag className="h-4 w-4" /> Creator Settings
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate("/admin/campaigns")}>
              <Mail className="h-4 w-4" /> Email Campaigns
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate("/admin/mightymail")}>
              <Send className="h-4 w-4" /> Email Templates
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Renders", value: stats.total, icon: ImageIcon, color: "violet", onClick: () => setFilterView("all") },
            { label: "Starred", value: stats.starred, icon: Star, color: "amber", onClick: () => setFilterView("starred") },
            { label: "Complete (7/7)", value: stats.complete, icon: CheckCircle2, color: "emerald", onClick: () => setFilterView("complete") },
            { label: "Missing Views", value: stats.incomplete, icon: AlertTriangle, color: "red", onClick: () => setFilterView("incomplete") },
          ].map((stat, i) => (
            <button
              key={i}
              onClick={stat.onClick}
              className={cn(
                "p-4 rounded-xl border text-left transition-all hover:shadow-md",
                filterView === (i === 0 ? "all" : i === 1 ? "starred" : i === 2 ? "complete" : "incomplete")
                  ? `border-${stat.color}-500/50 bg-${stat.color}-500/10`
                  : "border-border bg-zinc-900/50 hover:border-zinc-700",
              )}
            >
              <stat.icon className={cn("h-5 w-5 mb-2", `text-${stat.color}-400`)} />
              <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              <p className="text-xs text-zinc-500">{stat.label}</p>
            </button>
          ))}
        </div>

        {/* Controls Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <Input
              placeholder="Search vehicle, design, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-zinc-900 border-zinc-800"
            />
          </div>
          <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
            <SelectTrigger className="w-[160px] bg-zinc-900 border-zinc-800">
              <ArrowUpDown className="h-3.5 w-3.5 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at">Newest First</SelectItem>
              <SelectItem value="view_count">Most Views</SelectItem>
              <SelectItem value="vehicle">Vehicle A-Z</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectedIds.size === filtered.length && filtered.length > 0}
              onCheckedChange={toggleSelectAll}
            />
            <span className="text-xs text-zinc-500">{selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}</span>
          </div>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <Select value={bulkAction} onValueChange={setBulkAction}>
                <SelectTrigger className="w-[180px] bg-zinc-900 border-zinc-800">
                  <Zap className="h-3.5 w-3.5 mr-2" />
                  <SelectValue placeholder="Bulk action..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="star">Star Selected</SelectItem>
                  <SelectItem value="unstar">Unstar Selected</SelectItem>
                  <SelectItem value="delete">Delete Selected</SelectItem>
                  <SelectItem value="create-listings">Create Listings</SelectItem>
                  <SelectItem value="email-campaign">Send to Campaign</SelectItem>
                  <SelectItem value="rerender-approve">Re-render: Same Design → Studio</SelectItem>
                  <SelectItem value="rerender-revise">Re-render: Revise → Photorealistic</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleBulkAction} disabled={!bulkAction} className="bg-violet-600 hover:bg-violet-700 text-white">
                Go
              </Button>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={loadRenders} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {/* Page Info */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-zinc-600">
            Showing {filtered.length} of {stats.total} renders (page {page + 1})
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={renders.length < PAGE_SIZE}>Next</Button>
          </div>
        </div>

        {/* Render Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <ImageIcon className="h-12 w-12 text-zinc-700 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-1">No renders found</h3>
            <p className="text-sm text-zinc-500">Try changing your search or filter</p>
          </div>
        ) : (
          <div className="space-y-6">
            {filtered.map((render) => {
              const viewCount = getViewCount(render);
              const missing = getMissingViews(render);
              const isSelected = selectedIds.has(render.id);
              const isDeleting = deletingIds.has(render.id);
              const regenViews = regeneratingViews[render.id] || new Set();

              return (
                <Card
                  key={render.id}
                  className={cn(
                    "overflow-hidden transition-all",
                    isSelected && "ring-2 ring-violet-500/50",
                    render.is_featured_hero && "border-amber-500/30",
                    isDeleting && "opacity-50 pointer-events-none",
                  )}
                >
                  <CardContent className="p-0">
                    {/* Card Header */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-zinc-900/50">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => {
                          setSelectedIds((prev) => {
                            const s = new Set(prev);
                            s.has(render.id) ? s.delete(render.id) : s.add(render.id);
                            return s;
                          });
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground truncate capitalize">
                            {getVehicleLabel(render) || "Unknown Vehicle"}
                          </p>
                          {render.is_featured_hero && (
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px] gap-0.5">
                              <Star className="w-2.5 h-2.5 fill-amber-400" /> Starred
                            </Badge>
                          )}
                          <Badge className={cn(
                            "text-[9px] border-0",
                            viewCount === 7 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400",
                          )}>
                            {viewCount}/7 views
                          </Badge>
                          <Badge className="bg-zinc-800 text-zinc-400 border-0 text-[9px]">
                            {render.mode_type}
                          </Badge>
                        </div>
                        <p className="text-xs text-zinc-500 truncate mt-0.5">
                          {getDesignLabel(render)} {render.finish_type ? `| ${render.finish_type}` : ""} | {render.customer_email} | {format(new Date(render.created_at), "MMM d, yyyy h:mm a")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-8 w-8 p-0",
                            render.is_featured_hero ? "text-amber-400 hover:text-amber-300" : "text-zinc-600 hover:text-amber-400",
                          )}
                          onClick={() => toggleStar(render.id, render.is_featured_hero)}
                          title={render.is_featured_hero ? "Unstar" : "Star for marketplace"}
                        >
                          <Star className={cn("h-4 w-4", render.is_featured_hero && "fill-amber-400")} />
                        </Button>
                        {missing.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-cyan-400 hover:text-cyan-300 text-[11px] gap-1"
                            onClick={() => regenerateAllMissing(render)}
                            title="Regenerate all missing views"
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Fill {missing.length}
                          </Button>
                        )}
                        {/* Re-render for photorealism */}
                        {reRenderingIds.has(render.id) ? (
                          <div className="h-8 px-2 flex items-center">
                            <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin" />
                          </div>
                        ) : (
                          <Select
                            value=""
                            onValueChange={(mode) => reRenderDesign(render, mode as any)}
                          >
                            <SelectTrigger className="h-8 w-auto border-0 bg-transparent px-2 text-violet-400 hover:text-violet-300 gap-1 text-[11px] focus:ring-0">
                              <Wand2 className="h-3.5 w-3.5" />
                              <span className="hidden lg:inline">Re-render</span>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="approvemode">
                                <div className="flex items-center gap-2">
                                  <Wand2 className="h-3.5 w-3.5 text-cyan-400" />
                                  <div>
                                    <p className="text-sm font-medium">Same Design → Studio</p>
                                    <p className="text-[10px] text-zinc-500">Keep design, photorealistic studio render</p>
                                  </div>
                                </div>
                              </SelectItem>
                              <SelectItem value="designpro">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                                  <div>
                                    <p className="text-sm font-medium">Fresh DesignPro</p>
                                    <p className="text-[10px] text-zinc-500">New design from name, photorealistic</p>
                                  </div>
                                </div>
                              </SelectItem>
                              <SelectItem value="revise">
                                <div className="flex items-center gap-2">
                                  <RefreshCw className="h-3.5 w-3.5 text-amber-400" />
                                  <div>
                                    <p className="text-sm font-medium">Revise → Photorealistic</p>
                                    <p className="text-[10px] text-zinc-500">Same image, upgraded studio quality</p>
                                  </div>
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-zinc-600 hover:text-red-400"
                          onClick={() => deleteRender(render.id)}
                          title="Delete render"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* 7-View Grid — ALWAYS shows all 7 slots */}
                    <div className="grid grid-cols-7 gap-1 p-2 bg-black/20">
                      {ALL_VIEWS.map((viewType) => {
                        const url = render.render_urls?.[viewType];
                        const isRegen = regenViews.has(viewType);

                        return (
                          <div
                            key={viewType}
                            className={cn(
                              "relative aspect-video rounded-lg overflow-hidden group",
                              url ? "bg-zinc-800" : "bg-zinc-900 border border-dashed border-zinc-700",
                            )}
                          >
                            {url ? (
                              <>
                                <img
                                  src={url}
                                  alt={VIEW_LABELS[viewType]}
                                  className="w-full h-full object-cover cursor-pointer"
                                  loading="lazy"
                                  onClick={() => {
                                    const allUrls = ALL_VIEWS.filter((v) => render.render_urls?.[v]).map((v) => v);
                                    const idx = allUrls.indexOf(viewType);
                                    setLightboxRender(render);
                                    setLightboxIdx(idx >= 0 ? idx : 0);
                                  }}
                                />
                                {/* Overlay with action buttons on hover — pointer-events-none so image click works */}
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 pointer-events-none">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-white/0 group-hover:text-white/80 hover:text-white transition-colors pointer-events-auto"
                                    onClick={(e) => { e.stopPropagation(); regenerateView(render, viewType); }}
                                    title={`Regenerate ${VIEW_LABELS[viewType]}`}
                                  >
                                    <RefreshCw className={cn("h-3.5 w-3.5", isRegen && "animate-spin")} />
                                  </Button>
                                  {viewType === "passenger-side" && render.render_urls?.side && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0 text-white/0 group-hover:text-amber-400/90 hover:text-amber-300 transition-colors pointer-events-auto"
                                      onClick={(e) => { e.stopPropagation(); flipPassengerSide(render); }}
                                      title="Flip from driver side (auto-fixes text on commercial)"
                                      disabled={flippingIds.has(render.id)}
                                    >
                                      {flippingIds.has(render.id)
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <FlipHorizontal2 className="h-3.5 w-3.5" />
                                      }
                                    </Button>
                                  )}
                                </div>
                              </>
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                                {viewType === "passenger-side" && render.render_urls?.side ? (
                                  <button
                                    className="flex flex-col items-center gap-0.5 hover:bg-zinc-800/50 transition-colors p-1 rounded"
                                    onClick={() => flipPassengerSide(render)}
                                    disabled={flippingIds.has(render.id)}
                                  >
                                    {flippingIds.has(render.id)
                                      ? <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />
                                      : <FlipHorizontal2 className="h-3.5 w-3.5 text-amber-400" />
                                    }
                                    <span className="text-[7px] text-amber-400">Flip</span>
                                  </button>
                                ) : (
                                  <button
                                    className="flex flex-col items-center gap-0.5 hover:bg-zinc-800/50 transition-colors p-1 rounded"
                                    onClick={() => regenerateView(render, viewType)}
                                    disabled={isRegen}
                                  >
                                    {isRegen ? (
                                      <Loader2 className="h-4 w-4 text-cyan-400 animate-spin" />
                                    ) : (
                                      <RefreshCw className="h-3.5 w-3.5 text-zinc-600" />
                                    )}
                                    <span className="text-[8px] text-zinc-600">Generate</span>
                                  </button>
                                )}
                              </div>
                            )}
                            {/* View label */}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                              <span className={cn(
                                "text-[8px] font-medium",
                                url ? "text-white/80" : "text-red-400/80",
                              )}>
                                {VIEW_LABELS[viewType]}
                              </span>
                            </div>
                            {/* Status indicator */}
                            {url ? (
                              <CheckCircle2 className="absolute top-1 right-1 h-3 w-3 text-emerald-400" />
                            ) : (
                              <XCircle className="absolute top-1 right-1 h-3 w-3 text-red-400/60" />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Quick Actions Row */}
                    <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-zinc-900/30">
                      <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 font-mono text-[9px] gap-0.5">
                        <Hash className="w-2.5 h-2.5" />
                        {render.id.slice(0, 8).toUpperCase()}
                      </Badge>
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px] gap-1 text-zinc-500 hover:text-violet-400"
                        onClick={() => {
                          const renderData = [{
                            id: render.id,
                            vehicle: getVehicleLabel(render),
                            design: getDesignLabel(render),
                            thumbnail: render.render_urls?.side || Object.values(render.render_urls || {})[0] || "",
                          }];
                          sessionStorage.setItem("campaign_render_ids", JSON.stringify(renderData));
                          navigate("/admin/campaigns");
                        }}
                      >
                        <Mail className="h-3 w-3" /> Email Campaign
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px] gap-1 text-zinc-500 hover:text-emerald-400"
                        onClick={() => {
                          if (!render.is_featured_hero) {
                            toggleStar(render.id, false);
                          }
                          toast.success("Ready to list — go to Creator Market to create listing");
                          navigate("/admin/creator-market");
                        }}
                      >
                        <ShoppingBag className="h-3 w-3" /> Create Listing
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Bottom Pagination */}
        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-center gap-3 mt-8">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="text-sm text-zinc-500">Page {page + 1}</span>
            <Button variant="outline" onClick={() => setPage(page + 1)} disabled={renders.length < PAGE_SIZE}>Next</Button>
          </div>
        )}
      </main>

      {/* ── Lightbox — fullscreen image viewer with arrows ── */}
      {lightboxRender && (() => {
        const lbViews = ALL_VIEWS
          .filter((v) => lightboxRender.render_urls?.[v])
          .map((v) => ({ type: v, url: lightboxRender.render_urls![v], label: VIEW_LABELS[v] }));
        const currentView = lbViews[lightboxIdx];
        if (!currentView) return null;

        return (
          <div
            className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
            onClick={() => setLightboxRender(null)}
          >
            {/* Close */}
            <button
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
              onClick={() => setLightboxRender(null)}
            >
              <XCircle className="h-6 w-6 text-white" />
            </button>

            {/* Vehicle info */}
            <div className="absolute top-4 left-4 text-white z-10">
              <p className="text-sm font-bold capitalize">{getVehicleLabel(lightboxRender)}</p>
              <p className="text-xs text-zinc-400">{getDesignLabel(lightboxRender)}</p>
            </div>

            {/* Prev arrow */}
            {lightboxIdx > 0 && (
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
                onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx - 1); }}
              >
                <ChevronDown className="h-6 w-6 text-white -rotate-90" />
              </button>
            )}

            {/* Next arrow */}
            {lightboxIdx < lbViews.length - 1 && (
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
                onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx + 1); }}
              >
                <ChevronDown className="h-6 w-6 text-white rotate-90" />
              </button>
            )}

            {/* Image */}
            <img
              src={currentView.url}
              alt={currentView.label}
              className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />

            {/* View label */}
            <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-sm text-white/70 bg-black/50 px-4 py-1.5 rounded-full">
              {currentView.label} ({lightboxIdx + 1}/{lbViews.length})
            </p>
          </div>
        );
      })()}
    </div>
  );
}
