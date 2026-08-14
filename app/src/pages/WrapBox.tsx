import { useState, useMemo, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DesignIDBadge } from "@/components/DesignIDBadge";
import {
  Package, Download, FileText, ExternalLink, Loader2, Box,
  Clock, CheckCircle2, AlertTriangle, Search, Edit2, Save, Image, Trash2,
  Lock, Store, Link2, RefreshCw, Sparkles, Pencil, Hash, Fingerprint, Star, Archive, Shield, Upload,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { toast as sonnerToast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { isWrapboxManifest, addManualFileToWrapBox, type WrapboxElement, type WrapboxProductionPack } from "@/lib/wrapboxElements";
import { GenieUniversalPanelizerCard } from "@/components/production/GenieUniversalPanelizerCard";
import { formatDid, didFromPack } from "@/lib/designId";

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

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pending_payment: { label: "Pending Payment", color: "bg-yellow-500", icon: Clock },
  paid: { label: "Paid - Generating", color: "bg-blue-500", icon: Loader2 },
  generating: { label: "Generating Panels", color: "bg-blue-500", icon: Loader2 },
  qa_checking: { label: "Quality Check", color: "bg-purple-500", icon: Search },
  ready: { label: "Ready", color: "bg-green-500", icon: CheckCircle2 },
  delivered: { label: "Delivered", color: "bg-green-600", icon: CheckCircle2 },
  blocked_missing_renders: { label: "Needs Attention", color: "bg-amber-500", icon: AlertTriangle },
  generation_failed: { label: "Generation Issue", color: "bg-red-500", icon: AlertTriangle },
  manual_review: { label: "Under Review", color: "bg-amber-500", icon: AlertTriangle },
};

const STATUS_STEPS = ["paid", "generating", "qa_checking", "ready"];

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

function elementBadgeClass(kind: WrapboxElement["kind"]): string {
  switch (kind) {
    case "design_panel":
      return "bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
    case "background":
      return "bg-violet-500/15 text-violet-300 border-violet-500/30";
    case "vector":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    default:
      return "bg-blue-500/15 text-blue-300 border-blue-500/30";
  }
}

async function fetchAsBlobForZip(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed for ${url} (${res.status})`);
  return await res.blob();
}

async function downloadAllAsZip(orderNumber: string, elements: WrapboxElement[]): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const used = new Set<string>();
  for (const el of elements) {
    const blob = await fetchAsBlobForZip(el.url);
    const ext = (blob.type.split("/")[1] || "png").split(";")[0];
    let baseName = `${el.kind}-${el.label}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    if (!baseName) baseName = "element";
    let name = `${baseName}.${ext}`;
    let i = 1;
    while (used.has(name)) {
      name = `${baseName}-${i++}.${ext}`;
    }
    used.add(name);
    zip.file(name, blob);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `wrapbox-${orderNumber}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function WrapboxElementsPanel({
  orderNumber,
  elements,
  productionPack,
  onAddElement,
  onUploadFile,
}: {
  orderNumber: string;
  elements: WrapboxElement[];
  productionPack?: WrapboxProductionPack | null;
  onAddElement: () => void;
  onUploadFile?: (file: File) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-2">
      {/* Print-ready production pack — the Railway worker's finished ZIP.
          Direct link (server-built): never re-zipped in the browser. */}
      {productionPack?.zip_url && (
        <Button
          size="sm"
          className="w-full gap-1.5 text-xs bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 text-white"
          asChild
        >
          <a href={productionPack.zip_url} target="_blank" rel="noopener noreferrer" download>
            <Package className="w-3.5 h-3.5" />
            Download Production Pack (ZIP
            {productionPack.file_count ? ` · ${productionPack.file_count} files` : ""}
            {productionPack.zip_size ? ` · ${(productionPack.zip_size / 1024 / 1024).toFixed(0)} MB` : ""})
          </a>
        </Button>
      )}
      {/* Per-side PRINT FILES — direct PNG/TIFF downloads for each panel
          (preview thumbnail from the worker's small {panelKey}.png). These are
          links to the full print files in storage, NOT elements, so the
          browser-side Download All never tries to zip them. */}
      {productionPack?.panels && Object.keys(productionPack.panels).length > 0 && (
        <div className="space-y-1">
          {Object.entries(productionPack.panels).map(([key, p]) => {
            const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            const pub = (path?: string | null) =>
              path ? supabase.storage.from("wrap-files").getPublicUrl(path).data?.publicUrl : null;
            const png = pub(p?.pngPath);
            const tiff = pub(p?.tiffPath);
            const preview = pub(p?.previewPath);
            if (!png && !tiff) return null;
            return (
              <div key={key} className="flex items-center gap-2 rounded bg-white border border-gray-200 p-1.5">
                {preview && (
                  <img src={preview} alt={label} className="w-10 h-6 rounded object-cover bg-gray-100 shrink-0" />
                )}
                <span className="text-[11px] font-medium text-gray-900 flex-1 truncate">
                  {label}
                  {p?.width_in ? (
                    <span className="text-gray-500 font-normal"> · {Math.round(p.width_in)}″×{Math.round(p.height_in || 0)}″</span>
                  ) : null}
                </span>
                {png && (
                  <a href={png} target="_blank" rel="noopener noreferrer" download className="text-[11px] font-bold text-blue-600 hover:underline">PNG</a>
                )}
                {tiff && (
                  <a href={tiff} target="_blank" rel="noopener noreferrer" download className="text-[11px] font-bold text-gray-600 hover:underline">TIFF</a>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-blue-700">
          <Box className="w-3.5 h-3.5" />
          <span className="text-xs font-semibold">
            Elements ({elements.length}) · {orderNumber}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
            onClick={onAddElement}
          >
            <Sparkles className="w-3 h-3" />
            + Add Element
          </Button>
          {onUploadFile && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf,.ai,.eps,.svg,.psd,.tif,.tiff"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setUploading(true);
                  try {
                    await onUploadFile(f);
                  } finally {
                    setUploading(false);
                    if (fileRef.current) fileRef.current.value = "";
                  }
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Upload className="w-3 h-3" />
                )}
                Upload File
              </Button>
            </>
          )}
          {elements.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await downloadAllAsZip(orderNumber, elements);
              sonnerToast.success(`Downloaded ${elements.length} files`);
            } catch (err: any) {
              sonnerToast.error(err.message || "Download failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Download className="w-3 h-3" />
          )}
          Download All
        </Button>
          )}
        </div>
      </div>
      {elements.length === 0 && (
        <p className="text-[10px] text-gray-500 italic">
          No elements yet — click + Add Element to upscale and tag one to {orderNumber}.
        </p>
      )}
      <div className="space-y-1">
        {elements.map((el) => (
          <div
            key={el.id}
            className="flex items-center gap-2 rounded bg-white border border-gray-200 p-2"
          >
            <img
              src={el.url}
              alt={el.label}
              className="w-10 h-10 rounded object-cover bg-gray-100 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className={cn("text-[9px] px-1 py-0", elementBadgeClass(el.kind))}>
                  {el.kind.replace("_", " ")}
                </Badge>
                <span className="text-xs font-medium text-gray-900 truncate">{el.label}</span>
                {el.scale ? (
                  <span className="text-[10px] text-gray-500">{el.scale}x</span>
                ) : null}
              </div>
              <p className="text-[10px] text-gray-500">
                {format(new Date(el.added_at), "MMM d, h:mm a")}
                {el.added_by ? ` · ${el.added_by}` : ""}
              </p>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-blue-300 hover:bg-blue-500/10" asChild>
              <a href={el.url} target="_blank" rel="noopener noreferrer" download>
                <Download className="w-3.5 h-3.5" />
              </a>
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductionStatusTimeline({ status }: { status: string }) {
  const currentIndex = STATUS_STEPS.indexOf(status);
  const isReady = status === "ready" || status === "delivered";

  return (
    <div className="flex items-center gap-1 mt-2">
      {STATUS_STEPS.map((step, i) => {
        const isDone = isReady || i < currentIndex;
        const isCurrent = step === status;
        return (
          <div key={step} className="flex items-center gap-1">
            <div
              className={`h-2 rounded-full transition-all ${
                isDone
                  ? "w-8 bg-blue-500"
                  : isCurrent
                  ? "w-8 bg-blue-500 animate-pulse"
                  : "w-8 bg-gray-100"
              }`}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function WrapBox() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentShop, currentShopProfileId } = useOrganization();
  const shopId = currentShop?.id ?? null;
  const [searchQuery, setSearchQuery] = useState("");
  const [editingPO, setEditingPO] = useState<string | null>(null);
  const [poValue, setPOValue] = useState("");
  const [packToDelete, setPackToDelete] = useState<{ id: string; label: string } | null>(null);
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "vehicle">("newest");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [reconfigureDesign, setReconfigureDesign] = useState<VaultDesign | null>(null);
  const [reconfigureYear, setReconfigureYear] = useState("");
  const [reconfigureMake, setReconfigureMake] = useState("");
  const [reconfigureModel, setReconfigureModel] = useState("");

  // Fetch ALL production packs with upscale progress.
  // Scoped to the current shop's owner shop_profile so teammates share packs
  // via Phase 1b teammate RLS on the production_packs.shop_id column (which
  // still references shop_profiles(id) pre-#1039 follow-up).
  const { data: recentPacks } = useQuery({
    queryKey: ["wrapbox-recent-packs", currentShopProfileId],
    enabled: currentShopProfileId !== null,
    queryFn: async () => {
      if (!currentShopProfileId) return [];
      let { data, error } = await (supabase as any)
        .from("production_packs")
        .select("id, pack_url, thumbnail_url, file_count, upscale_status, upscale_progress, vehicle_info, design_name, is_starred, finish_type, panels_selected, created_at")
        .eq("shop_id", currentShopProfileId)
        .order("created_at", { ascending: false });
      // If is_starred column doesn't exist yet, retry without it
      if (error && /is_starred|column/.test(error.message || "")) {
        console.warn("is_starred column missing - falling back without it:", error.message);
        const fallback = await (supabase as any)
          .from("production_packs")
          .select("id, pack_url, thumbnail_url, file_count, upscale_status, upscale_progress, vehicle_info, design_name, finish_type, panels_selected, created_at")
          .eq("shop_id", currentShopProfileId)
          .order("created_at", { ascending: false });
        data = fallback.data;
        error = fallback.error;
      }
      if (error) { console.warn("production_packs query:", error); return []; }
      return data || [];
    },
    refetchInterval: (query) => {
      const packs = query.state.data as any[] | undefined;
      if (!packs) return false;
      const hasActive = packs.some((p: any) =>
        p.upscale_status === "processing"
        && p.created_at
        && (Date.now() - new Date(p.created_at).getTime()) < 30 * 60 * 1000
      );
      return hasActive ? 4000 : false;
    },
  });

  // Fetch design DNA ratings for star badges
  const { data: designRatings } = useQuery({
    queryKey: ["wrapbox-design-ratings"],
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

  // Fetch user's order history (design_pack_purchases)
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["wrapbox-orders"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("design_pack_purchases" as any)
        .select("*")
        .or(`user_id.eq.${user.id},email.eq.${user.email}`)
        .order("created_at", { ascending: false });
      if (error) {
        console.warn("Could not fetch orders:", error);
        return [];
      }
      return (data as any[]) || [];
    },
  });

  // Fetch the current shop's designiq_generations. color_visualizations is
  // still scoped by customer_email because it has no teammate-aware column
  // that's reliably populated today.
  const { data: productionPacks, isLoading: packsLoading } = useQuery({
    queryKey: ["wrapbox-production-packs", currentShopProfileId],
    enabled: currentShopProfileId !== null,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !currentShopProfileId) return { generations: [], renders: [] };
      let generations: any[] = [];
      try {
        const { data, error: genError } = await supabase
          .from("designiq_generations" as any)
          .select("*")
          .eq("shop_id", currentShopProfileId)
          .order("created_at", { ascending: false });
        if (!genError && data) {
          generations = data as any[];
        }
      } catch {
        // Table doesn't exist yet
      }
      const { data: renders, error: renderError } = await supabase
        .from("color_visualizations")
        .select("*")
        .eq("customer_email", user.email)
        .eq("generation_status", "completed")
        .order("created_at", { ascending: false });
      if (renderError) throw renderError;
      return { generations, renders: renders || [] };
    },
  });

  // Fetch saved designs (panel_designs) scoped to the current shop.
  const { data: savedDesigns, isLoading: designsLoading } = useQuery({
    queryKey: ["wrapbox-saved-designs", shopId],
    enabled: shopId !== null,
    queryFn: async () => {
      if (!shopId) return [];
      const { data, error } = await supabase
        .from("panel_designs")
        .select("*, designpanelpro_patterns(id, name, category, production_file_url, image_url)")
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch completed production actions (PrepMyFile / CutMap outputs).
  // Embed the linked panelizer_jobs.order_number so each action can show
  // the job # it belongs to (auto-generated MP-XXXXXX for manual prep).
  const { data: productionActions, isLoading: actionsLoading } = useQuery({
    queryKey: ["wrapbox-production-actions"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      try {
        const { data, error } = await supabase
          .from("production_actions" as any)
          .select("*, panelizer_jobs(order_number, job_type)")
          .eq("user_id", user.id)
          .in("status", ["completed"])
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) { console.warn("production_actions query:", error); return []; }
        return (data as any[]) || [];
      } catch {
        return [];
      }
    },
  });

  // Star toggle mutation
  const toggleStar = useMutation({
    mutationFn: async ({ packId, starred }: { packId: string; starred: boolean }) => {
      const { error } = await (supabase as any).from("production_packs").update({ is_starred: starred }).eq("id", packId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wrapbox-recent-packs"] });
      queryClient.invalidateQueries({ queryKey: ["design-vault-packs"] });
    },
    onError: (err: any) => {
      console.warn("toggleStar failed:", err);
      toast({ title: "Star toggle unavailable", description: "The is_starred column may not exist yet. Run the migration SQL.", variant: "destructive" });
    },
  });

  // Update customer PO number
  const updatePO = useMutation({
    mutationFn: async ({ orderId, poNumber }: { orderId: string; poNumber: string }) => {
      const { error } = await supabase
        .from("design_pack_purchases" as any)
        .update({ customer_order_number: poNumber } as any)
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wrapbox-orders"] });
      setEditingPO(null);
      toast({ title: "PO number updated" });
    },
  });

  // Delete a production pack
  const deleteProductionPack = useMutation({
    mutationFn: async (packId: string) => {
      const { data, error } = await (supabase as any)
        .from("production_packs")
        .delete()
        .eq("id", packId)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Delete was blocked - you may not have permission to remove this pack.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wrapbox-recent-packs"] });
      setPackToDelete(null);
      toast({ title: "Production pack deleted" });
    },
    onError: (err: any) => {
      setPackToDelete(null);
      toast({ title: "Failed to delete pack", description: err.message, variant: "destructive" });
    },
  });

  // Normalize raw packs into VaultDesign[]
  const vaultDesigns = useMemo<VaultDesign[]>(() => {
    const ratingsByUrl = new Map<string, { avg: number; count: number }>();
    (designRatings || []).forEach((r: any) => {
      if (r.vehicle_render_url) {
        ratingsByUrl.set(r.vehicle_render_url, { avg: r.avg_rating || 0, count: r.total_ratings || 0 });
      }
    });

    return (recentPacks || []).map((pack: any) => {
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
  }, [recentPacks, designRatings]);

  // Filter + Sort vault designs
  const displayDesigns = useMemo(() => {
    let filtered = vaultDesigns;

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

  const isLoading = ordersLoading || packsLoading || designsLoading || actionsLoading;
  const generations = productionPacks?.generations || [];
  const completedActions = productionActions || [];
  const filteredOrders = (orders || []).filter((order: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (order.order_number || "").toLowerCase().includes(q) ||
      (order.customer_order_number || "").toLowerCase().includes(q) ||
      (order.vehicle_make || "").toLowerCase().includes(q) ||
      (order.vehicle_model || "").toLowerCase().includes(q)
    );
  });

  const hasRecentPacks = recentPacks && recentPacks.length > 0;
  const hasContent =
    hasRecentPacks ||
    (orders && orders.length > 0) ||
    generations.length > 0 ||
    (savedDesigns && savedDesigns.length > 0) ||
    completedActions.length > 0;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900">
      <Helmet>
        <title>WrapBox - Order Management & Production Tracking | RestyleProAI</title>
        <meta name="description" content="Track wrap orders, production packs, and design fulfillment. Design it. Panel it. Print it. The world's first prompt-to-production vehicle wrap design software." />
        <link rel="canonical" href="https://www.restyleproai.com/wrapbox" />
      </Helmet>
      <main className="flex-1 container mx-auto px-4 py-8 pt-24">
        <div className="mb-6 rounded-xl bg-white border border-gray-200 shadow-sm px-5 py-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="text-xs font-bold tracking-wide text-white px-2.5 py-1 rounded-md"
              style={{ background: "linear-gradient(135deg, #0ea5e9, #3b82f6)" }}
            >
              RestyleProAI<span className="text-sky-200">™</span>
            </span>
            <span className="text-gray-300">|</span>
            <div className="p-2 rounded-lg" style={{ background: "linear-gradient(135deg, #0ea5e9, #3b82f6)" }}>
              <Box className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">
                WrapBox<span className="text-sky-500">™</span>
              </h1>
              <p className="text-xs text-gray-500">
                Production packs, design panels, and team-shared wrap elements
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
          </div>
        ) : !hasContent ? (
          <Card className="border-dashed border-2 border-gray-200">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Package className="h-16 w-16 text-gray-500 mb-6" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Your WrapBox is Empty</h2>
              <p className="text-gray-500 text-center max-w-md mb-6">
                Production packs and design files you purchase or generate will appear here.
              </p>
              <div className="flex gap-4">
                <Button
                  className="bg-gradient-blue hover:opacity-90"
                  onClick={() => (window.location.href = "/designpro/premium")}
                >
                  Start Designing
                </Button>
                <Button variant="outline" onClick={() => (window.location.href = "/my-renders")}>
                  View My Renders
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
          {/* ============ PRODUCTION PACKS - FULL CARD GRID ============ */}
          {hasRecentPacks && (
            <div className="relative space-y-4 mb-8 p-4 rounded-xl overflow-hidden">
              {/* Animated gradient border */}
              <div
                className="absolute inset-0 rounded-xl pointer-events-none"
                style={{
                  padding: "1.5px",
                  background: "linear-gradient(270deg, #6366f1, #a855f7, #ec4899, #06b6d4, #6366f1)",
                  backgroundSize: "300% 300%",
                  animation: "gradient-flow 6s ease infinite",
                  WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                  WebkitMaskComposite: "xor",
                  maskComposite: "exclude",
                }}
              />
              <div
                className="absolute inset-3 rounded-xl opacity-10 pointer-events-none blur-md"
                style={{
                  background: "linear-gradient(270deg, #6366f1, #a855f7, #ec4899, #06b6d4, #6366f1)",
                  backgroundSize: "300% 300%",
                  animation: "gradient-flow 6s ease infinite",
                }}
              />
              <h2 className="relative text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Image className="w-5 h-5 text-purple-400" />
                Production Packs
                <span className="text-sm text-gray-500 font-normal">({vaultDesigns.length})</span>
              </h2>
              <style>{`
                @keyframes gradient-flow {
                  0% { background-position: 0% 50%; }
                  50% { background-position: 100% 50%; }
                  100% { background-position: 0% 50%; }
                }
              `}</style>

              {/* Type Filter Tabs */}
              <div className="relative flex flex-wrap gap-2">
                {TYPE_FILTERS.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setTypeFilter(filter)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                      typeFilter === filter
                        ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white border-transparent shadow-sm"
                        : "bg-white text-gray-600 border-gray-300 hover:border-sky-400 hover:text-sky-600",
                    )}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              {/* Search & Sort */}
              <div className="relative flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <Input
                    placeholder="Search by vehicle or design name..."
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

              {/* Card Grid */}
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
                        "bg-white overflow-hidden transition-colors group",
                        isComplete && !design.isBranded && "border-gray-200 hover:border-blue-500/50",
                        isComplete && design.isBranded && "border-amber-500/30 hover:border-amber-500/60",
                        !isComplete && "border-gray-200 hover:border-blue-600",
                      )}
                    >
                      {/* Thumbnail */}
                      <div className="relative aspect-video bg-gray-100">
                        {design.thumbnailUrl ? (
                          <>
                            <img
                              src={design.thumbnailUrl}
                              alt={design.vehicleLabel}
                              className="w-full h-full object-cover"
                            />
                            <DesignIDBadge
                              toolName="WrapBox™"
                              did={didFromPack(design) || undefined}
                              showPT={false}
                              hideToolName
                            />
                          </>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Archive className="h-10 w-10 text-gray-500/40" />
                          </div>
                        )}

                        {/* Owned Badge */}
                        <Badge className="absolute top-2 left-2 bg-emerald-500/90 text-white border-0 gap-1 text-[10px]">
                          <Lock className="w-2.5 h-2.5" />
                          Owned
                        </Badge>

                        {/* Print-Ready / Proof Badge */}
                        {isComplete && (
                          <Badge className="absolute top-2 right-2 bg-green-500/90 text-white border-0 gap-1 text-[10px]">
                            <CheckCircle2 className="w-3 h-3" />
                            Proof Ready
                          </Badge>
                        )}

                        {/* Branded Badge */}
                        {design.isBranded && (
                          <Badge className="absolute bottom-2 left-2 bg-amber-500/90 text-white border-0 gap-1 text-[10px]">
                            <Sparkles className="w-2.5 h-2.5" />
                            Branded
                          </Badge>
                        )}
                      </div>

                      <CardContent className="p-3 space-y-2">
                        {/* Vehicle + Design Info */}
                        <p className="font-semibold text-sm text-gray-900 truncate">{design.vehicleLabel || "Vehicle"}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {design.designName}
                          {design.finishType && ` • ${design.finishType}`}
                        </p>

                        {/* DesignID + Rating + Date */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 font-mono text-[9px] gap-1">
                              <Hash className="w-2.5 h-2.5" />
                              {didFromPack(design)}
                            </Badge>
                            {design.avgRating > 0 && (
                              <div className="flex items-center gap-0.5">
                                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                                <span className="text-[10px] text-yellow-400 font-medium">{design.avgRating.toFixed(1)}</span>
                              </div>
                            )}
                          </div>
                          <span className="text-[10px] text-gray-500">
                            {design.createdAt ? format(new Date(design.createdAt), "MMM d, yyyy") : ""}
                          </span>
                        </div>

                        {/* Upscale progress */}
                        {isProcessing && total > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-gray-500">Upscaling... {completed}/{total}</span>
                              <span className="font-mono text-purple-400">{percent}%</span>
                            </div>
                            <div className="relative h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-700 ease-out"
                                style={{
                                  width: `${percent}%`,
                                  background: "linear-gradient(90deg, #6366f1, #a855f7, #ec4899)",
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {/* WrapBox elements (QC artboard + upscaled elements) */}
                        {isWrapboxManifest(design.panelsSelected) && (
                          <WrapboxElementsPanel
                            orderNumber={design.panelsSelected.order_number}
                            elements={design.panelsSelected.elements}
                            productionPack={design.panelsSelected.production_pack}
                            onAddElement={() =>
                              navigate(`/admin/upscale-single?job=${encodeURIComponent(design.panelsSelected.order_number)}`)
                            }
                            onUploadFile={
                              currentShopProfileId
                                ? async (file) => {
                                    const manifest = design.panelsSelected;
                                    const baseLabel =
                                      file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() ||
                                      "Upload";
                                    try {
                                      await addManualFileToWrapBox({
                                        job: {
                                          jobId: manifest.job_id,
                                          orderNumber: manifest.order_number,
                                          finishType: design.finishType || null,
                                        },
                                        shopId: currentShopProfileId,
                                        file,
                                        label: baseLabel,
                                      });
                                      sonnerToast.success(
                                        `Uploaded "${baseLabel}" to ${manifest.order_number}`,
                                      );
                                      queryClient.invalidateQueries({
                                        queryKey: ["wrapbox-saved-designs"],
                                      });
                                      queryClient.invalidateQueries({
                                        queryKey: ["wrapbox-recent-packs"],
                                      });
                                    } catch (err: any) {
                                      sonnerToast.error(err.message || "Upload failed");
                                    }
                                  }
                                : undefined
                            }
                          />
                        )}

                        {/* Star Toggle + Delete */}
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className={cn(
                              "h-7 gap-1 text-xs",
                              design.isStarred
                                ? "text-yellow-400 hover:text-yellow-300"
                                : "text-gray-500 hover:text-yellow-400",
                            )}
                            onClick={() => toggleStar.mutate({ packId: design.id, starred: !design.isStarred })}
                          >
                            <Star className={cn("w-3.5 h-3.5", design.isStarred && "fill-yellow-400")} />
                            {design.isStarred ? "In DesignVault" : "Add to DesignVault"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 ml-auto text-gray-500 hover:text-red-500"
                            onClick={() => setPackToDelete({ id: design.id, label: design.vehicleLabel })}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-2 pt-2 border-t border-gray-200">
                          {/* Share + Reconfigure row */}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 text-xs border-gray-300 text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                              onClick={() => {
                                const url = `${window.location.origin}/share/vault/${design.id}`;
                                navigator.clipboard.writeText(url).then(() => {
                                  sonnerToast.success("Share link copied!");
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
                          {/* Download */}
                          {design.packUrl && (
                            <Button
                              size="sm"
                              className={cn(
                                "w-full gap-1.5 text-xs",
                                isComplete
                                  ? "bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 text-white"
                                  : "bg-gradient-blue hover:opacity-90"
                              )}
                              asChild
                            >
                              <a href={design.packUrl} target="_blank" rel="noopener noreferrer">
                                <Download className="w-3 h-3" />
                                {isComplete ? "Print-Ready Pack" : "Download"}
                              </a>
                            </Button>
                          )}
                          {/* Sell on CreatorMarket */}
                          {isComplete && (
                            <Button
                              size="sm"
                              variant="outline"
                              className={cn(
                                "w-full gap-1.5 text-xs",
                                design.isBranded
                                  ? "border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                                  : "border-violet-500/30 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300",
                              )}
                              onClick={() => navigate("/creatormarket")}
                            >
                              <Store className="w-3 h-3" />
                              Sell On Creator Market — 60% to you · 40% to RestylePro
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {displayDesigns.length === 0 && searchQuery && (
                <Card className="border-dashed border-2 border-gray-200 mt-4">
                  <CardContent className="py-8 text-center text-gray-500">
                    No designs match "{searchQuery}"
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          <Tabs defaultValue="orders" className="space-y-6">
            <TabsList className="bg-gray-100 border border-gray-200 p-1 h-auto">
              {[
                { v: "orders", label: `Order History${orders && orders.length > 0 ? ` (${orders.length})` : ""}` },
                { v: "prepmyfile", label: `PrepMyFile™${completedActions.length > 0 ? ` (${completedActions.length})` : ""}` },
                { v: "designs", label: `DesignProAI™${generations.length > 0 ? ` (${generations.length})` : ""}` },
                { v: "saved", label: `Saved Designs${savedDesigns && savedDesigns.length > 0 ? ` (${savedDesigns.length})` : ""}` },
              ].map((t) => (
                <TabsTrigger
                  key={t.v}
                  value={t.v}
                  className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-sky-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm text-gray-600 px-4"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* ============ ORDER HISTORY TAB ============ */}
            <TabsContent value="orders" className="space-y-4">
              {/* GENIE Universal Panelizer — live build progress for production
                  packs the customer bought. Starts at purchase (stripe-webhook →
                  activate-print-worker) and lights each panel as the Railway
                  worker lands its print files. Read-only window on the build. */}
              <GenieUniversalPanelizerCard />
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <Input
                  placeholder="Search by order number (RP-...) or your PO number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {filteredOrders.length === 0 ? (
                <Card className="border-dashed border-2 border-gray-200">
                  <CardContent className="py-8 text-center text-gray-500">
                    {searchQuery ? "No orders match your search." : "No production pack orders yet."}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {filteredOrders.map((order: any) => {
                    const statusInfo = STATUS_CONFIG[order.production_status] || STATUS_CONFIG.pending_payment;
                    const StatusIcon = statusInfo.icon;
                    const canDownload =
                      order.production_status === "ready" ||
                      order.production_status === "delivered";

                    return (
                      <Card key={order.id} className="hover:shadow-lg transition-shadow">
                        <CardContent className="p-5">
                          <div className="flex flex-col md:flex-row md:items-start gap-4">
                            {/* Order Info */}
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <span className="font-mono text-lg font-bold text-blue-400">
                                  {order.order_number || "Processing..."}
                                </span>
                                <Badge className={`${statusInfo.color} text-white text-xs`}>
                                  <StatusIcon className={`h-3 w-3 mr-1 ${
                                    order.production_status === "paid" || order.production_status === "generating"
                                      ? "animate-spin"
                                      : ""
                                  }`} />
                                  {statusInfo.label}
                                </Badge>
                              </div>

                              <div className="text-sm text-gray-500 space-y-1">
                                {(order.vehicle_year || order.vehicle_make || order.vehicle_model) && (
                                  <p>
                                    {[order.vehicle_year, order.vehicle_make, order.vehicle_model]
                                      .filter(Boolean)
                                      .join(" ")}
                                  </p>
                                )}
                                <p>
                                  Size: {order.selected_size || "-"}
                                  {order.include_hood && " + Hood"}
                                  {order.include_front_bumper && " + Front Bumper"}
                                  {order.include_rear_plus_bumper && " + Rear & Bumper"}
                                  {order.roof_size && order.roof_size !== "none" && ` + Roof (${order.roof_size})`}
                                </p>
                                <p>
                                  Purchased:{" "}
                                  {order.created_at
                                    ? format(new Date(order.created_at), "MMM d, yyyy h:mm a")
                                    : "-"}
                                </p>
                                {order.generation_completed_at && (
                                  <p>
                                    Files ready:{" "}
                                    {format(new Date(order.generation_completed_at), "MMM d, yyyy h:mm a")}
                                  </p>
                                )}
                              </div>

                              {/* Customer PO */}
                              <div className="mt-2 flex items-center gap-2">
                                <span className="text-xs text-gray-500">Your PO:</span>
                                {editingPO === order.id ? (
                                  <div className="flex items-center gap-1">
                                    <Input
                                      value={poValue}
                                      onChange={(e) => setPOValue(e.target.value)}
                                      className="h-7 text-xs w-40"
                                      placeholder="Enter PO number"
                                    />
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0"
                                      onClick={() =>
                                        updatePO.mutate({
                                          orderId: order.id,
                                          poNumber: poValue,
                                        })
                                      }
                                    >
                                      <Save className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ) : (
                                  <button
                                    className="text-xs text-gray-900 hover:text-blue-400 flex items-center gap-1"
                                    onClick={() => {
                                      setEditingPO(order.id);
                                      setPOValue(order.customer_order_number || "");
                                    }}
                                  >
                                    {order.customer_order_number || "Add PO number"}
                                    <Edit2 className="h-3 w-3" />
                                  </button>
                                )}
                              </div>

                              <ProductionStatusTimeline status={order.production_status || "pending_payment"} />
                            </div>

                            {/* Actions */}
                            <div className="flex flex-col gap-2 shrink-0">
                              {canDownload && (order.download_url || order.wrapbox_delivery_url) && (
                                <Button size="sm" className="bg-gradient-blue hover:opacity-90" asChild>
                                  <a
                                    href={order.wrapbox_delivery_url || order.download_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <Download className="h-3 w-3 mr-1" />
                                    Download
                                  </a>
                                </Button>
                              )}
                              {order.order_metadata?.total_amount && (
                                <span className="text-xs text-gray-500 text-right">
                                  ${((order.order_metadata.total_amount || 0) / 100).toFixed(2)}
                                </span>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ============ PREPMYFILE OUTPUTS TAB ============ */}
            <TabsContent value="prepmyfile" className="space-y-4">
              {completedActions.length === 0 ? (
                <Card className="border-dashed border-2 border-gray-200">
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <FileText className="h-12 w-12 text-gray-500 mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">No PrepMyFile outputs yet</h3>
                    <p className="text-gray-500 text-center max-w-md mb-4">
                      CutMap, FileRevitalizer, VectorizeIt, and other production tool outputs will appear here.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => (window.location.href = "/productionflow")}
                    >
                      Open PrepMyFile
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {completedActions.map((action: any) => {
                    const isStandalone = action.action_type === "standalone_service";
                    const jobOrderNumber = action.panelizer_jobs?.order_number;
                    return (
                      <Card key={action.id} className="hover:shadow-lg transition-shadow">
                        <CardContent className="p-5">
                          <div className="flex flex-col md:flex-row md:items-start gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2 flex-wrap">
                                <span className="font-semibold text-gray-900">
                                  {action.package_name || action.service_id || "Production Tool"}
                                </span>
                                <Badge className="bg-green-500 text-white text-xs">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Complete
                                </Badge>
                                <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-400">
                                  {isStandalone ? "Tool" : action.action_type === "quick_prep" ? "Package" : "Prep"}
                                </Badge>
                                {jobOrderNumber && (
                                  <Badge variant="outline" className="text-xs font-mono border-blue-500/30 text-blue-400">
                                    {jobOrderNumber}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-sm text-gray-500 space-y-1">
                                <p>{action.file_name || "file"}{action.tokens_used ? ` - ${action.tokens_used} tokens` : ""}</p>
                                {action.output_format && (
                                  <p className="text-xs">Output: {action.output_format}</p>
                                )}
                                {action.rip_compatible && action.rip_compatible.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {action.rip_compatible.slice(0, 4).map((rip: string) => (
                                      <Badge key={rip} variant="outline" className="text-[10px] px-1.5 py-0">
                                        {rip}
                                      </Badge>
                                    ))}
                                    {action.rip_compatible.length > 4 && (
                                      <span className="text-[10px] text-gray-500">+{action.rip_compatible.length - 4}</span>
                                    )}
                                  </div>
                                )}
                                <p className="text-xs text-gray-500">
                                  {action.created_at ? format(new Date(action.created_at), "MMM d, yyyy h:mm a") : ""}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-col gap-2 shrink-0">
                              {action.file_out && (
                                <Button size="sm" className="bg-gradient-blue hover:opacity-90" asChild>
                                  <a href={action.file_out} target="_blank" rel="noopener noreferrer">
                                    <Download className="h-3 w-3 mr-1" />
                                    Download
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ============ DESIGNIQ GENERATIONS TAB ============ */}
            <TabsContent value="designs" className="space-y-4">
              {generations.length === 0 ? (
                <Card className="border-dashed border-2 border-gray-200">
                  <CardContent className="py-8 text-center text-gray-500">
                    No DesignProAI generations yet.
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {generations.map((gen: any) => {
                    const displayUrl = gen.hero_render_url || gen.panel_url;
                    return (
                      <Card key={gen.id} className="hover:shadow-lg transition-shadow overflow-hidden">
                        {displayUrl && (
                          <div className="aspect-video bg-gray-100 relative overflow-hidden">
                            <img
                              src={displayUrl}
                              alt={gen.design_name || "Design"}
                              className="w-full h-full object-cover"
                            />
                            <DesignIDBadge
                              toolName="DesignProAI™"
                              designName={gen.design_name || undefined}
                              did={formatDid(gen.id) || undefined}
                              showPT={false}
                            />
                          </div>
                        )}
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <p className="font-semibold text-gray-900">
                                {gen.design_name || "Untitled Design"}
                              </p>
                              <p className="text-xs text-gray-500">
                                {gen.vehicle_year} {gen.vehicle_make} {gen.vehicle_model}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400">
                              {gen.mode || "restyle"}
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-500 mb-3">
                            {gen.created_at ? format(new Date(gen.created_at), "MMM d, yyyy h:mm a") : ""}
                          </p>
                          <div className="flex gap-2">
                            {displayUrl && (
                              <Button size="sm" variant="outline" className="flex-1" asChild>
                                <a href={displayUrl} target="_blank" rel="noopener noreferrer">
                                  <Download className="h-3 w-3 mr-1" />
                                  Download
                                </a>
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              onClick={() => (window.location.href = `/revision-studio?id=${gen.id}`)}
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Revise
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ============ SAVED DESIGNS TAB ============ */}
            <TabsContent value="saved" className="space-y-4">
              {!savedDesigns || savedDesigns.length === 0 ? (
                <Card className="border-dashed border-2 border-gray-200">
                  <CardContent className="py-8 text-center text-gray-500">
                    No saved designs yet.
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {savedDesigns.map((design: any) => {
                    const panel = design.designpanelpro_patterns;
                    const hasProductionFile = panel?.production_file_url;

                    return (
                      <Card key={design.id} className="hover:shadow-lg transition-shadow overflow-hidden">
                        {(design.preview_image_url || panel?.image_url) && (
                          <div className="aspect-video bg-gray-100 relative overflow-hidden">
                            <img
                              src={design.preview_image_url || panel?.image_url}
                              alt={panel?.name || "Design"}
                              className="w-full h-full object-cover"
                            />
                            <DesignIDBadge
                              toolName="StyleLibrary™"
                              did={didFromPack(design) || undefined}
                              showPT={false}
                            />
                            {hasProductionFile && (
                              <Badge className="absolute top-2 right-2 bg-green-500 text-white">
                                Production Ready
                              </Badge>
                            )}
                          </div>
                        )}
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <p className="font-semibold text-gray-900">
                                {panel?.name || "Untitled Design"}
                              </p>
                              <p className="text-xs text-gray-500">
                                {design.vehicle_year} {design.vehicle_make} {design.vehicle_model}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {panel?.category || "Design"}
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-500 mb-3">
                            Finish: {design.finish || "Gloss"}
                          </p>
                          <div className="flex gap-2">
                            {hasProductionFile && (
                              <Button size="sm" className="flex-1" asChild>
                                <a href={panel.production_file_url} target="_blank" rel="noopener noreferrer">
                                  <Download className="h-3 w-3 mr-1" />
                                  Production Pack
                                </a>
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              onClick={() => (window.location.href = `/revision-studio?id=${design.id}`)}
                            >
                              Resume Editing
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
          </>
        )}
        {/* Delete confirmation dialog */}
        <AlertDialog open={!!packToDelete} onOpenChange={(open) => !open && setPackToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Production Pack</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{packToDelete?.label}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={(e) => {
                  e.preventDefault();
                  if (packToDelete) deleteProductionPack.mutate(packToDelete.id);
                }}
                disabled={deleteProductionPack.isPending}
              >
                {deleteProductionPack.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reconfigure Dialog */}
        <Dialog open={!!reconfigureDesign} onOpenChange={(open) => { if (!open) setReconfigureDesign(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Reconfigure Design</DialogTitle>
            </DialogHeader>
            {reconfigureDesign && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {reconfigureDesign.thumbnailUrl && (
                    <img
                      src={reconfigureDesign.thumbnailUrl}
                      alt={reconfigureDesign.designName}
                      className="w-20 h-14 rounded object-cover bg-gray-100"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{reconfigureDesign.designName}</p>
                    <p className="text-xs text-gray-500 truncate">{reconfigureDesign.vehicleLabel}</p>
                  </div>
                </div>
                <p className="text-sm text-gray-500">
                  Output this design on a different vehicle.
                </p>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Year</Label>
                    <Input placeholder="2024" value={reconfigureYear} onChange={(e) => setReconfigureYear(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Make</Label>
                    <Input placeholder="Ford" value={reconfigureMake} onChange={(e) => setReconfigureMake(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Model</Label>
                    <Input placeholder="F-150" value={reconfigureModel} onChange={(e) => setReconfigureModel(e.target.value)} />
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
      </main>

    </div>
  );
}
