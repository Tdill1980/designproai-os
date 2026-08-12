import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Hash, Fingerprint, Star, Eye, Heart, ShoppingBag,
  Package, ChevronLeft, ChevronRight, Instagram, X,
  Printer, Users, Pencil, Truck, Maximize2, Box, Layers, Crown, Camera, CheckCircle2, Clock,
  Share2, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { thumbnailUrl } from "@/lib/storage-thumbnail";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";
import {
  getIndustryTitle, getVehicleSubtitle, isCommercialListing,
  PRINT_READY_PRICE, VEHICLE_RENDER_ADDON_PRICE, FILE_DELIVERY_HOURS,
} from "./listing-display";

/** Canonical 7-view labels */
const VIEW_LABELS: Record<string, string> = {
  roof: "Roof",
  side: "Driver Side",
  "passenger-side": "Passenger Side",
  front: "Front 3/4",
  rear: "Rear 3/4",
  hood_detail: "Hood Detail",
  "close-up": "Close-Up",
};

/** Branded design detection */
const BRANDED_KEYWORDS = [
  "commercial", "logo", "brand", "company", "business", "fleet",
  "dental", "plumber", "plumbing", "hvac", "roofing", "contractor",
  "food", "restaurant", "spa", "salon", "landscaping", "cleaning",
];

function isBranded(listing: any): boolean {
  if (listing?.design_style === "branded") return true;
  const title = (listing?.title || "").toLowerCase();
  return BRANDED_KEYWORDS.some((kw) => title.includes(kw));
}

interface ListingDetailViewerProps {
  listing: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOrder: () => void;
  /** Opens the buyer flow with the $75 vehicle-render add-on pre-checked. */
  onOrderWithRender?: () => void;
  onNamePreview?: () => void;
}

type ListingView = { type: string; url: string; label: string };

/** Parse render_urls: supports both {hero: url} object and [{type, url, label?}] array formats */
function parseRenderUrls(raw: any): ListingView[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter((v: any) => v?.url)
      .map((v: any) => ({ type: v.type, url: v.url, label: v.label || VIEW_LABELS[v.type] || v.type }));
  }
  if (typeof raw === "object") {
    return Object.entries(raw)
      .filter(([, url]) => typeof url === "string" && (url as string).startsWith("http"))
      .map(([type, url]) => ({ type, url: url as string, label: VIEW_LABELS[type] || type }));
  }
  return [];
}

/** Canonical 3D view ordering for the thumbnail strip. */
const VIEW_ORDER = ["side", "driver-side", "passenger-side", "front", "rear", "hood_detail", "close-up", "roof"];
function sortViews(views: ListingView[]): ListingView[] {
  const idx = (t: string) => {
    const i = VIEW_ORDER.indexOf(t);
    return i === -1 ? VIEW_ORDER.length : i;
  };
  return [...views].sort((a, b) => idx(a.type) - idx(b.type));
}

function formatDesignId(id: string): string {
  return `DID-${(id || "").slice(0, 8).toUpperCase()}`;
}

function formatPromptFingerprint(id: string): string {
  return `PF-${(id || "").slice(-12).toUpperCase()}`;
}

export function ListingDetailViewer({ listing, open, onOpenChange, onOrder, onOrderWithRender, onNamePreview }: ListingDetailViewerProps) {
  const [activeMode, setActiveMode] = useState<"3d" | "2d" | "install">("3d");
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [fullscreenIdx, setFullscreenIdx] = useState<number | null>(null);
  // Lazy-loaded heavy fields (render_urls, preview_urls, panel_2d_url,
  // dna.panel_artwork_url). The public CreatorMarket browse query keeps
  // these out of the row payload to avoid pulling megabytes per listing
  // up front — we fetch them only when the user opens this viewer.
  const [extras, setExtras] = useState<{
    render_urls?: any;
    preview_urls?: any;
    panel_2d_url?: string | null;
    panel_artwork_url?: string | null;
    install_video_url?: string | null;
  } | null>(null);
  const [extrasLoading, setExtrasLoading] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const navigate = useNavigate();
  // Admin-only: surface "Open in Panel Studio" so staff can push this design
  // into Panel Studio and build/test the print-ready output files.
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => { if (mounted) setAdminEmail(data.session?.user?.email ?? null); });
    return () => { mounted = false; };
  }, []);
  const isAdmin = isAllowlistedAdmin(adminEmail);

  // Public shareable URL for THIS listing. Uses the short /c/<id>
  // form so link unfurlers (iMessage / WhatsApp / Twitter / Slack)
  // hit our /api/og/creatormarket endpoint and see the listing's
  // real title, vehicle, price, and thumbnail in the preview card.
  // Humans get a 0ms redirect into the SPA at /creatormarket?listing.
  const shareUrl = (() => {
    const id = listing?.id;
    if (!id) return "";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://restyleproai.com";
    return `${origin}/c/${id}`;
  })();

  const handleShare = async () => {
    if (!shareUrl) return;
    const title = listing?.title || "Wrap design — RestyleProAI";
    try {
      // Native share sheet on iOS / Android. Falls back to clipboard
      // copy if the browser doesn't have navigator.share.
      if (typeof navigator !== "undefined" && (navigator as any).share) {
        await (navigator as any).share({ title, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setJustCopied(true);
      toast.success("Share link copied");
      setTimeout(() => setJustCopied(false), 2000);
    } catch {
      // User dismissed native share or clipboard blocked — fall
      // back to a manual prompt so the URL is still recoverable.
      try {
        await navigator.clipboard.writeText(shareUrl);
        setJustCopied(true);
        toast.success("Share link copied");
        setTimeout(() => setJustCopied(false), 2000);
      } catch {
        window.prompt("Copy this share link", shareUrl);
      }
    }
  };

  // When the viewer opens for a row that came from the slim browse
  // query (no render_urls present), fetch the heavy columns on demand.
  useEffect(() => {
    setExtras(null);
    if (!open || !listing?.id) return;
    // If the row already carries render_urls (e.g. came from the
    // dashboard or starred-renders path), skip the extra round-trip.
    if (listing.render_urls && Object.keys(listing.render_urls || {}).length > 0) return;
    let cancelled = false;
    (async () => {
      setExtrasLoading(true);
      try {
        const { data, error } = await (supabase as any)
          .from("marketplace_listings")
          .select(
            "render_urls, preview_urls, panel_2d_url, install_video_url, neuralnetwork_design_dna(panel_artwork_url, avg_rating, total_ratings)",
          )
          .eq("id", listing.id)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          // Make lazy-load failures visible in the console instead of
          // silently leaving the modal stuck on "No 3D renders".
          console.warn("[ListingDetailViewer] lazy-load failed:", error);
          return;
        }
        if (!data) {
          console.warn("[ListingDetailViewer] lazy-load returned no row for id:", listing.id);
          return;
        }
        setExtras({
          render_urls: data.render_urls,
          preview_urls: data.preview_urls,
          panel_2d_url: data.panel_2d_url ?? null,
          panel_artwork_url: data.neuralnetwork_design_dna?.panel_artwork_url ?? null,
          install_video_url: data.install_video_url ?? null,
        });
      } finally {
        if (!cancelled) setExtrasLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, listing?.id, listing?.render_urls]);

  const creator = listing?.neuralnetwork_creator_profiles;
  const dna = listing?.neuralnetwork_design_dna;
  // featured_creator_name overrides the joined display_name (admin
  // curator cards have a typed-in "Created by" label).
  const creatorDisplay = listing?.featured_creator_name || creator?.display_name || "Creator";
  const effectiveRenderUrls = listing?.render_urls ?? extras?.render_urls;
  const effectivePreviewUrls = listing?.preview_urls ?? extras?.preview_urls;
  const effectivePanel2D = listing?.panel_2d_url ?? extras?.panel_2d_url;
  const effectivePanelArtwork = dna?.panel_artwork_url ?? extras?.panel_artwork_url;
  const views3D = useMemo(() => sortViews(parseRenderUrls(effectiveRenderUrls)), [effectiveRenderUrls]);
  const views2D = useMemo(() => {
    // TRUE flat artwork ONLY — the explicit 2D panel source (panel_2d_url) or the
    // design-DNA panel artwork. preview_urls frequently hold 3D RENDERS, so we must
    // NOT surface them here labeled "Flat Panel Artwork" — that mislabels a 3D image
    // as panel art (and would feed a render into Panel Studio / production).
    const panelUrl = effectivePanel2D || effectivePanelArtwork;
    if (panelUrl && typeof panelUrl === "string") {
      return [{ type: "panel_2d", url: panelUrl, label: "Flat Panel Artwork" }];
    }
    return [];
  }, [effectivePanel2D, effectivePanelArtwork]);

  // Install video (real-world print + install footage). The videos
  // shop owners send us are reels-style 9:16, so the player is
  // rendered portrait.
  const effectiveInstallVideo: string | null =
    listing?.install_video_url ?? extras?.install_video_url ?? null;

  const activeViews = activeMode === "install" ? [] : activeMode === "3d" ? views3D : views2D;
  const fallbackUrl = activeViews[0]?.url || listing?.thumbnail_url || null;
  const resolvedActiveUrl =
    activeUrl && activeViews.some((v) => v.url === activeUrl) ? activeUrl : fallbackUrl;
  const activeView = activeViews.find((v) => v.url === resolvedActiveUrl);

  if (!listing) return null;

  const igHandle = creator?.social_links?.instagram;

  // Customer-facing title — industry_title override / trade lookup,
  // falls back to the design name parsed from "Vehicle - Design".
  const designName = getIndustryTitle(listing);
  const vehicleLabel = getVehicleSubtitle(listing).replace(/^Shown on /, "");
  const commercial = isCommercialListing(listing);
  const priceNum = listing.price || PRINT_READY_PRICE;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl w-full p-0 bg-zinc-900 border-zinc-800 max-h-[92dvh] overflow-y-auto overscroll-contain">
          <DialogHeader className="sr-only">
            <DialogTitle>{listing.title}</DialogTitle>
          </DialogHeader>

          {/* Big-image-right viewer with 2D/3D tabs + scrollable thumbnail strip */}
          <div className="p-4 sm:p-6 pb-0">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left: meta + creator pills */}
              <div className="lg:col-span-4 xl:col-span-3 space-y-3">
                <div className="flex items-center gap-2 bg-zinc-800/60 px-3 py-2 rounded-lg border border-zinc-700/50">
                  {creator?.avatar_url ? (
                    <img src={creator.avatar_url} alt="" className="w-6 h-6 rounded-full ring-1 ring-white/20" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-violet-500/30" />
                  )}
                  <span className="text-xs text-white/90 font-medium truncate">Created by {creatorDisplay}</span>
                  {creator?.verified && <Star className="h-3 w-3 text-amber-400 fill-amber-400 shrink-0" />}
                </div>

                {creator?.featured && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 shadow-lg shadow-amber-500/30 border border-amber-300/60 w-fit">
                    <Crown className="h-3.5 w-3.5 text-white drop-shadow" />
                    <span className="text-[10px] font-bold text-white tracking-wider uppercase drop-shadow-sm">
                      {creatorDisplay}
                    </span>
                  </div>
                )}

                {igHandle && (
                  <a
                    href={`https://instagram.com/${igHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 bg-zinc-800/60 px-3 py-2 rounded-lg border border-zinc-700/50 hover:border-pink-500/30 transition-colors w-full"
                  >
                    <Instagram className="h-3.5 w-3.5 text-pink-400 shrink-0" />
                    <span className="text-xs text-white/80 truncate">@{igHandle}</span>
                  </a>
                )}

                <div>
                  <p className="text-xl font-bold text-foreground leading-tight">{designName}</p>
                  <p className="text-sm text-zinc-400 mt-0.5">{vehicleLabel}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 font-mono text-[10px] gap-1">
                      <Hash className="w-2.5 h-2.5" />
                      {formatDesignId(listing.design_dna_id || listing.id)}
                    </Badge>
                    <Badge className="bg-violet-500/20 text-violet-400 border-violet-500/30 font-mono text-[10px] gap-1">
                      <Fingerprint className="w-2.5 h-2.5" />
                      {formatPromptFingerprint(listing.design_dna_id || listing.id)}
                    </Badge>
                    {dna?.avg_rating > 0 && (
                      <div className="flex items-center gap-0.5">
                        <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                        <span className="text-xs text-yellow-400 font-medium">{dna.avg_rating.toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-zinc-500 pt-1">
                  <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {listing.view_count || 0}</span>
                  <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" /> {listing.favorite_count || 0}</span>
                  <span className="ml-auto text-2xl font-bold text-violet-400">${listing.price}</span>
                </div>

                {/* Share this card. Uses the native share sheet on
                    mobile (iOS / Android), copies to clipboard
                    everywhere else. The URL deep-links straight to
                    this listing's detail modal so a shop can paste
                    it into IG DMs / sales emails. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleShare}
                  className="w-full gap-2 border-zinc-700 text-zinc-200 hover:text-white hover:bg-white/5"
                >
                  {justCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4" />}
                  {justCopied ? "Link copied" : "Share this design"}
                </Button>

                {/* Admin: push this design into Panel Studio (prefilled flat
                    source + vehicle + title) to build/test the print output.
                    Source is the TRUE flat artwork ONLY (panel_2d_url or the
                    design-DNA panel artwork) — never thumbnail_url/previews,
                    which are 3D renders. Hidden when no flat art exists, so we
                    can never panelize a 3D render. */}
                {isAdmin && (() => {
                  const src = effectivePanel2D || effectivePanelArtwork || null;
                  const veh = [listing.vehicle_year, listing.vehicle_make, listing.vehicle_model].filter(Boolean).join(" ");
                  if (!src) return null;
                  const qs = new URLSearchParams({
                    proof_url: src,
                    ...(veh ? { vehicle: veh } : {}),
                    ...(listing.title ? { project: listing.title } : {}),
                  }).toString();
                  return (
                    <a
                      href={`/admin/wrap-panel-studio?${qs}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 h-9 text-sm font-semibold"
                    >
                      <Layers className="h-4 w-4" />
                      Open in Panel Studio — build output files ↗
                    </a>
                  );
                })()}
              </div>

              {/* Right: big image + scrollable thumb strip + 2D/3D tabs */}
              <div className="lg:col-span-8 xl:col-span-9 space-y-3">
                {/* 2D / 3D / Install toggle. "Install" only renders
                    when the listing has an install_video_url. */}
                <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-zinc-800/70 border border-zinc-700/60">
                  <button
                    type="button"
                    onClick={() => { setActiveMode("3d"); setActiveUrl(null); }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors",
                      activeMode === "3d"
                        ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40"
                        : "text-zinc-400 hover:text-white"
                    )}
                  >
                    <Box className="h-3.5 w-3.5" />
                    3D Renders {views3D.length > 0 && <span className="opacity-60">({views3D.length})</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveMode("2d"); setActiveUrl(null); }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors",
                      activeMode === "2d"
                        ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40"
                        : "text-zinc-400 hover:text-white"
                    )}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    2D Panel Art {views2D.length > 0 && <span className="opacity-60">({views2D.length})</span>}
                  </button>
                  {effectiveInstallVideo && (
                    <button
                      type="button"
                      onClick={() => { setActiveMode("install"); setActiveUrl(null); }}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors",
                        activeMode === "install"
                          ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40"
                          : "text-zinc-400 hover:text-white"
                      )}
                    >
                      <Crown className="h-3.5 w-3.5" />
                      Real Install
                    </button>
                  )}
                </div>

                {/* Install video — vertical 9:16 reels-style. Renders
                    a centered portrait player inside the same big-
                    image slot used by 3D/2D. Supports Instagram (reel,
                    post, tv), YouTube (incl. shorts), Vimeo, and
                    direct file URLs (mp4/webm/mov). */}
                {activeMode === "install" && effectiveInstallVideo ? (
                  <div className="rounded-xl overflow-hidden border border-zinc-800 bg-black">
                    <div className="mx-auto" style={{ maxWidth: "min(420px, 70vw)" }}>
                      {/instagram\.com/.test(effectiveInstallVideo) ? (
                        // Instagram embed sizes itself + includes IG
                        // chrome (avatar/caption), so we give it a
                        // tall fixed-height frame instead of a strict
                        // 9:16 aspect.
                        <iframe
                          src={`https://www.instagram.com/${
                            effectiveInstallVideo.match(
                              /instagram\.com\/((?:reel|reels|p|tv)\/[\w-]+)/,
                            )?.[1] || ""
                          }/embed/captioned/`}
                          className="w-full block bg-white"
                          style={{ height: "min(720px, 110vh)" }}
                          allow="encrypted-media; picture-in-picture; web-share"
                          allowFullScreen
                          title="Installed wrap video"
                          scrolling="no"
                          loading="lazy"
                        />
                      ) : (
                        <div className="relative w-full" style={{ aspectRatio: "9 / 16" }}>
                          {/youtu\.?be/.test(effectiveInstallVideo) ? (
                            <iframe
                              src={`https://www.youtube.com/embed/${
                                effectiveInstallVideo.match(
                                  /(?:youtube\.com\/(?:shorts\/|watch\?v=)|youtu\.be\/)([\w-]+)/,
                                )?.[1] || ""
                              }?rel=0&modestbranding=1&playsinline=1`}
                              className="absolute inset-0 w-full h-full"
                              allow="autoplay; encrypted-media; picture-in-picture"
                              allowFullScreen
                              title="Installed wrap video"
                            />
                          ) : /vimeo\.com/.test(effectiveInstallVideo) ? (
                            <iframe
                              src={`https://player.vimeo.com/video/${
                                effectiveInstallVideo.match(/vimeo\.com\/(\d+)/)?.[1] || ""
                              }`}
                              className="absolute inset-0 w-full h-full"
                              allow="autoplay; fullscreen; picture-in-picture"
                              allowFullScreen
                              title="Installed wrap video"
                            />
                          ) : (
                            <video
                              src={effectiveInstallVideo}
                              controls
                              playsInline
                              className="absolute inset-0 w-full h-full object-cover bg-black"
                            />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-2 text-center text-[11px] text-amber-200/80 bg-amber-500/5 border-t border-amber-500/20">
                      Real install footage from the wrap shop
                    </div>
                  </div>
                ) : (
                  /* Big image (3D or 2D) */
                  <div
                    className="relative aspect-video rounded-xl overflow-hidden border border-zinc-800 bg-black cursor-zoom-in group"
                    onClick={() => {
                      const idx = activeViews.findIndex((v) => v.url === resolvedActiveUrl);
                      if (idx >= 0) setFullscreenIdx(idx);
                    }}
                  >
                    {resolvedActiveUrl ? (
                      <img
                        // Raw URL — the Supabase image-transform CDN
                        // endpoint was returning differently-cropped
                        // renders than the original, which is why
                        // every angle looked like a close-up of the
                        // wrap pattern instead of the whole car.
                        src={resolvedActiveUrl}
                        alt={activeView?.label || listing.title}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600 gap-2">
                        <Package className="h-12 w-12" />
                        <p className="text-xs">{activeMode === "2d" ? "Print-ready panel files delivered after purchase" : "No 3D renders yet"}</p>
                      </div>
                    )}
                    {activeView && (
                      <div className={cn(
                        "absolute top-3 left-3 text-white text-xs font-bold px-3 py-1 rounded",
                        activeMode === "3d" ? "bg-violet-500/90" : "bg-cyan-500/90"
                      )}>
                        {activeView.label}
                      </div>
                    )}
                    {resolvedActiveUrl && (
                      <div className="absolute bottom-3 right-3 bg-black/60 text-white/70 text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        <Maximize2 className="h-3 w-3" /> Click to zoom
                      </div>
                    )}
                  </div>
                )}

                {/* Grid of view thumbnails. Was a horizontal-scrolling
                    strip — buyers on mobile didn't realise they could
                    swipe sideways and assumed each listing had only the
                    one hero view, so the gallery felt empty. The grid
                    lays every angle out at once (3 across on phones,
                    4 on tablets, 4–5 on desktop), so all 7 views are
                    visible without any scroll gymnastics. */}
                {activeViews.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                    {activeViews.map((view) => (
                      <button
                        key={view.type + view.url}
                        type="button"
                        onClick={() => setActiveUrl(view.url)}
                        className={cn(
                          "group/thumb rounded-lg border-2 overflow-hidden transition-all",
                          resolvedActiveUrl === view.url
                            ? activeMode === "3d"
                              ? "border-violet-400 ring-1 ring-violet-400/40"
                              : "border-cyan-400 ring-1 ring-cyan-400/40"
                            : "border-zinc-700 hover:border-zinc-500"
                        )}
                      >
                        <div className="relative aspect-video bg-zinc-800">
                          {/* Raw URL — same root cause as the big
                              hero: Supabase's image-transform CDN was
                              returning differently-cropped renders
                              and the thumbnails ended up showing
                              close-ups of the wrap pattern instead
                              of the angle's full vehicle shot. */}
                          <img src={view.url} alt={view.label} className="w-full h-full object-cover" loading="lazy" />
                        </div>
                        <div className="bg-zinc-900/80 px-1.5 py-1">
                          <span className="text-[10px] font-medium text-white/80 truncate block">{view.label}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-4 text-xs text-zinc-500 text-center">
                    {extrasLoading ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full border-2 border-zinc-600 border-t-violet-400 animate-spin" />
                        Loading the rest of the gallery…
                      </span>
                    ) : activeMode === "2d" ? (
                      "Print-ready 2D panel files are delivered after purchase."
                    ) : (
                      "No 3D renders attached to this listing yet."
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="p-6 pt-4 space-y-5">

            {/* Customer-facing "what's included" — new sales copy that
                matches the white card CTAs. Replaces the old internal
                "Production Pack Included" technical list. */}
            <div className="rounded-xl bg-white text-zinc-900 p-5 border border-zinc-200">
              <h3 className="text-base font-bold mb-1">${PRINT_READY_PRICE} Print-Ready File Package</h3>
              <p className="text-xs text-zinc-500 mb-3">Everything below is included in the base price.</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Print-ready production files</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Sized to your vehicle year, make &amp; model</li>
                {commercial && (
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> Commercial branding edits — name, logo, phone, website &amp; colors</li>
                )}
                <li className="flex items-start gap-2"><Clock className="w-4 h-4 text-cyan-500 mt-0.5 shrink-0" /> Delivered in {FILE_DELIVERY_HOURS} hours</li>
              </ul>
            </div>

            {/* Primary CTA — Buy Print-Ready Files */}
            <Button
              className="w-full gap-2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-base py-5 min-h-[52px] font-bold"
              onClick={onOrder}
            >
              <ShoppingBag className="h-5 w-5" />
              Buy Print-Ready Files — ${priceNum}
            </Button>

            {/* Optional $75 preview. The $350 above already buys
                the print-ready files; this add-on is only for buyers
                who want to see the design on THEIR vehicle first. */}
            <button
              type="button"
              onClick={onOrderWithRender || onOrder}
              className="w-full flex items-center gap-3 rounded-xl bg-cyan-50 border-2 border-cyan-300 hover:bg-cyan-100 text-cyan-900 px-4 py-3 transition text-left"
            >
              <Camera className="w-5 h-5 text-cyan-600 shrink-0" />
              <div className="flex-1">
                <div className="font-bold text-sm">Optional: see on your vehicle first — +${VEHICLE_RENDER_ADDON_PRICE}</div>
                <div className="text-[11px] text-cyan-700">Add a custom render on your year/make/model in {FILE_DELIVERY_HOURS}h. After you approve, your print-ready files ship within {FILE_DELIVERY_HOURS} more hours.</div>
              </div>
            </button>

            {/* Want it printed? */}
            <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
              <div className="flex items-center gap-2 mb-3">
                <Printer className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-bold text-foreground">Want this printed and shipped?</span>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="text-center p-2 rounded-lg bg-zinc-800/50">
                  <Truck className="h-4 w-4 text-emerald-400 mx-auto mb-1" />
                  <p className="text-xs font-bold text-foreground">Compact</p>
                  <p className="text-[10px] text-emerald-400">from $899</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-zinc-800/50">
                  <Truck className="h-4 w-4 text-emerald-400 mx-auto mb-1" />
                  <p className="text-xs font-bold text-foreground">Full-Size</p>
                  <p className="text-[10px] text-emerald-400">from $1,199</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-zinc-800/50">
                  <Truck className="h-4 w-4 text-emerald-400 mx-auto mb-1" />
                  <p className="text-xs font-bold text-foreground">Van/Truck</p>
                  <p className="text-[10px] text-emerald-400">from $1,499</p>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full gap-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 min-h-[44px]"
                onClick={() => { onOpenChange(false); navigate("/printpro/shop"); }}
              >
                <Printer className="h-4 w-4" />
                Order Print on WePrintWraps — Free Shipping
              </Button>
            </div>

            {/* Creator revenue split */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-violet-500/5 border border-violet-500/20">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-violet-400" />
                <span className="text-sm text-muted-foreground">Creator earns <span className="text-violet-400 font-bold">60%</span></span>
              </div>
              <span className="text-xs text-zinc-600">40% funds ads</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fullscreen image viewer */}
      {fullscreenIdx !== null && activeViews[fullscreenIdx] && (
        <div
          className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
          onClick={() => setFullscreenIdx(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            onClick={() => setFullscreenIdx(null)}
          >
            <X className="h-6 w-6 text-white" />
          </button>
          {fullscreenIdx > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              onClick={(e) => { e.stopPropagation(); setFullscreenIdx(fullscreenIdx - 1); }}
            >
              <ChevronLeft className="h-6 w-6 text-white" />
            </button>
          )}
          {fullscreenIdx < activeViews.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              onClick={(e) => { e.stopPropagation(); setFullscreenIdx(fullscreenIdx + 1); }}
            >
              <ChevronRight className="h-6 w-6 text-white" />
            </button>
          )}
          <img
            src={activeViews[fullscreenIdx].url}
            alt={activeViews[fullscreenIdx].label}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-sm text-white/70 bg-black/50 px-4 py-1.5 rounded-full">
            {activeViews[fullscreenIdx].label} ({fullscreenIdx + 1}/{activeViews.length})
          </p>
        </div>
      )}
    </>
  );
}
