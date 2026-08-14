/**
 * WallPro — AI Wall Wrap Designer & Visualizer (Phases 2–4)
 *
 * Phase 2: Core UI — hero, two design paths (upload wall / studio view),
 *          prompt input, design upload, dimension calculator, purchase options
 * Phase 3: Zone tool — drag/resize/scale design overlay on wall canvas
 * Phase 4: Seeded gallery — 36 designs across 6 categories
 *
 * White UI variant. NO neon. Muted blue→violet→magenta gradient accents.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { calculateWallWrapEstimate, WALL_FILM } from "@/lib/quick-quote";
import { sliceWallDesign, zipWallPanels, persistWallPanels } from "@/lib/wallPanelize";
import { WALL_DESIGNS, CATEGORIES, type WallDesign } from "@/components/wallpro/galleryData";
import { SendForApprovalDialog } from "@/components/proof/SendForApprovalDialog";
import { WallProDesignProof } from "@/components/wallpro/WallProDesignProof";
import { ClipboardSignature } from "lucide-react";
import {
  ArrowLeft, Upload, Wand2, ImageIcon, Loader2, Download, ShoppingCart,
  Ruler, Info, Camera, Paintbrush, RotateCcw, CheckCircle2, Maximize,
  Lock, Unlock, Eye, ChevronRight, Building2, Dumbbell, Store, Briefcase,
  UtensilsCrossed, Car, Minus, Plus, Columns2, Package, Sparkles, FileDown,
  FileImage, FileCheck2,
} from "lucide-react";

// ─── Constants ──────────────────────────────────────────────────

const GRADIENT = "linear-gradient(135deg, #0EA5E9, #8B5CF6, #D946EF)";

const STUDIO_ROOMS = [
  { id: "office", label: "Modern Office", icon: Building2, gradient: "linear-gradient(135deg, #e8e4de 0%, #d8d2c8 100%)" },
  { id: "gym", label: "Fitness / Gym", icon: Dumbbell, gradient: "linear-gradient(145deg, #1a1a1a 0%, #2a2a2a 100%)" },
  { id: "retail", label: "Retail Showroom", icon: Store, gradient: "linear-gradient(135deg, #f5f0e8 0%, #e8ddd0 100%)" },
  { id: "restaurant", label: "Restaurant / Bar", icon: UtensilsCrossed, gradient: "linear-gradient(140deg, #2a0a10 0%, #3d1520 100%)" },
  { id: "lobby", label: "Corporate Lobby", icon: Briefcase, gradient: "linear-gradient(150deg, #1a2840 0%, #2a3a55 100%)" },
  { id: "living", label: "Residential Living", icon: Building2, gradient: "linear-gradient(135deg, #f5e6e0 0%, #e8d5ce 100%)" },
];

type DesignPath = "upload" | "studio";
type ViewMode = "after" | "before" | "split" | "design";

// ─── Component ──────────────────────────────────────────────────

const WallPro = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const wallFileRef = useRef<HTMLInputElement>(null);
  const designFileRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Design entry
  const [path, setPath] = useState<DesignPath>("upload");
  const [studioRoom, setStudioRoom] = useState<string | null>(null);
  const [wallPhotoFile, setWallPhotoFile] = useState<File | null>(null);
  const [wallPhotoPreview, setWallPhotoPreview] = useState<string | null>(null);
  const [designFile, setDesignFile] = useState<File | null>(null);
  const [designPreview, setDesignPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");

  // Dimensions + pricing
  const [heightInches, setHeightInches] = useState(96);
  const [widthInches, setWidthInches] = useState(120);

  // Generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultIsScene, setResultIsScene] = useState(false); // true when resultUrl is a full photorealistic room/wall render (not flat art)
  const [designName, setDesignName] = useState("");
  const [addedToQuote, setAddedToQuote] = useState(false);
  const [showSendForApproval, setShowSendForApproval] = useState(false);
  const [showOfficialProof, setShowOfficialProof] = useState(false);

  // View mode (before / after / split / design-only)
  // Default to "before" so the user sees their wall photo first;
  // we auto-flip to "split" after a successful generation so the
  // before/after comparison is immediately visible.
  const [viewMode, setViewMode] = useState<ViewMode>("before");
  const [creatingProductionPack, setCreatingProductionPack] = useState(false);
  const [buildingPack, setBuildingPack] = useState(false);

  // Zone tool
  const [overlayPos, setOverlayPos] = useState({ x: 10, y: 10 });
  const [overlayScale, setOverlayScale] = useState(80);
  const [overlayOpacity, setOverlayOpacity] = useState(100);
  const [aspectLocked, setAspectLocked] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // Gallery — DB-backed with hardcoded fallback
  const { data: dbWallDesigns } = useQuery({
    queryKey: ["wallpro-gallery-public"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("wallpro_designs")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      return data || [];
    },
  });

  interface GalleryItem {
    id: string;
    category: string;
    name: string;
    description: string;
    prompt: string;
    thumbGradient: string;
    imageUrl?: string | null;
  }

  const galleryItems: GalleryItem[] = (dbWallDesigns && dbWallDesigns.length > 0)
    ? dbWallDesigns.map((d: any) => ({
        id: d.id,
        category: d.category,
        name: d.name,
        description: d.description || d.subcategory || "",
        prompt: d.prompt || "",
        thumbGradient: d.thumb_gradient || "linear-gradient(135deg, #666, #333)",
        imageUrl: d.image_url,
      }))
    : WALL_DESIGNS.map(d => ({ ...d, imageUrl: null as string | null }));

  const galleryCategories = [...new Set(galleryItems.map(d => d.category))];
  const [galleryCategory, setGalleryCategory] = useState("");

  const estimate = calculateWallWrapEstimate(heightInches, widthInches);
  const hasBackground = !!(wallPhotoPreview || studioRoom);
  const hasDesign = !!(designPreview || resultUrl);

  // ── File handlers ─────────────────────────────────────────────

  const handleWallPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setWallPhotoFile(file);
    setWallPhotoPreview(URL.createObjectURL(file));
    setPath("upload");
  };

  const handleDesignUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDesignFile(file);
    setDesignPreview(URL.createObjectURL(file));
    // Flip to After so the user immediately sees the overlay and can use the zone tool.
    setViewMode("after");
  };

  // ── Upload to storage ─────────────────────────────────────────

  const uploadToStorage = async (file: File, folder: string): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const ext = file.name.split(".").pop() || "png";
    const p = `renders/${user.id}/wallpro/${folder}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("wrap-files").upload(p, file, { contentType: file.type, upsert: true });
    if (error) return null;
    return supabase.storage.from("wrap-files").getPublicUrl(p).data.publicUrl;
  };

  // ── Generate ──────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!prompt.trim() && !designFile) {
      toast({ title: "Missing input", description: "Enter a design description or upload artwork", variant: "destructive" });
      return;
    }
    setIsGenerating(true);
    try {
      let wallUrl: string | null = null;
      let designUrl: string | null = null;
      if (wallPhotoFile) wallUrl = await uploadToStorage(wallPhotoFile, "wall-photos");
      if (designFile) designUrl = await uploadToStorage(designFile, "designs");

      // Mode routing:
      //   wall photo uploaded   → composite (render on their real wall)
      //   studio room selected  → studio    (photorealistic render in that room type)
      //   user uploaded design  → studio    (show design on a studio wall)
      //   otherwise             → generate  (flat print-ready artwork)
      const mode = wallUrl ? "composite" : (studioRoom || designUrl) ? "studio" : "generate";
      const surfaceType = studioRoom || "studio_wall";

      const { data, error } = await supabase.functions.invoke("generate-wall-design", {
        body: { mode, prompt: prompt.trim() || undefined, wall_photo_url: wallUrl, design_url: designUrl, height_inches: heightInches, width_inches: widthInches, surface_type: surfaceType, aspect_ratio: "16:9" },
      });

      // supabase-js returns a FunctionsHttpError on non-2xx; the real body lives on error.context
      if (error && (error as any)?.context) {
        let body: any = null;
        try { body = await (error as any).context.json(); } catch { /* ignore */ }
        throw new Error(body?.error || error.message || "Generation failed");
      }
      if (error) throw new Error(error.message || "Generation failed");
      if (!data?.image_url) throw new Error(data?.error || "Generation failed");

      setResultUrl(data.image_url);
      setResultIsScene(Boolean(data.scene_render));
      setDesignName(data.design_name || "Wall Design");
      setOverlayScale(80);
      setOverlayPos({ x: 10, y: 10 });
      // Land the user on the side-by-side split view so the comparison is obvious.
      setViewMode("split");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      toast({ title: "Generation failed", description: err?.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Add to QuickQuotes ────────────────────────────────────────

  const handleAddToQuote = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast({ title: "Login required", variant: "destructive" }); return; }
      await (supabase as any).from("quick_quote_items").insert({
        user_id: user.id, product_type: "wallpro", product_name: `WallPro \u2014 ${designName || "Wall Wrap"}`,
        description: `${heightInches}" H \u00d7 ${widthInches}" W wall wrap on ${WALL_FILM.name}`,
        width_inches: widthInches, height_inches: heightInches, sq_ft: estimate.totalSqFt,
        panels: estimate.panelsNeeded, material_name: WALL_FILM.name,
        unit_price: estimate.materialCost, quantity: 1, total_price: estimate.materialCost,
        render_url: resultUrl, metadata: { film: WALL_FILM.name, finish: WALL_FILM.finish, linear_feet: estimate.totalLinearFeet, design_name: designName },
      });
      setAddedToQuote(true);
      toast({ title: "Added to QuickQuotes", description: `${designName} \u2014 $${estimate.materialCost.toFixed(2)}` });
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    }
  };

  // ── Export / Download ─────────────────────────────────────────

  const slug = (s: string) => (s || "wall-design").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "wall-design";

  const downloadUrl = async (url: string, filename: string) => {
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(obj), 1000);
    } catch (err: any) {
      toast({ title: "Download failed", description: err?.message || "Could not fetch image", variant: "destructive" });
    }
  };

  const handleDownloadRender = () => {
    if (!resultUrl) return;
    downloadUrl(resultUrl, `wallpro-${slug(designName)}-render.png`);
  };

  const handleDownloadDesignOnly = () => {
    if (!resultUrl) return;
    // The flat design IS the resultUrl in non-scene mode. For scene renders,
    // we still let users grab the scene image (no separate flat extract exists).
    const tag = resultIsScene ? "scene" : "design";
    downloadUrl(resultUrl, `wallpro-${slug(designName)}-${tag}.png`);
  };

  // ── $149 Production Pack — real print-ready panels (deterministic, client-side) ──
  // Splits the flat design into 54"-roll panels with mirror bleed + a panel map,
  // zipped for instant download. Gates honestly on FLAT artwork: a scene render is
  // a photo of a room, not a printable design, so it can't be panelized.
  const handleBuyProductionPack = async () => {
    if (!resultUrl) {
      toast({ title: "Generate a design first", description: "Create your wall wrap before building the production pack.", variant: "destructive" });
      return;
    }
    if (resultIsScene) {
      toast({
        title: "Flat artwork needed",
        description: "This is a room preview, not a printable design. Generate a flat design (no wall photo or studio room) to build print panels — or use the $299 custom pack.",
        variant: "destructive",
      });
      return;
    }
    setBuildingPack(true);
    try {
      // Slice once, then zip for download AND persist to the shared vault.
      const panels = await sliceWallDesign({ designUrl: resultUrl, widthInches, heightInches, bleedInches: 2 });
      const { blob, filename, panelCount } = await zipWallPanels(panels, {
        designName: designName || "Wall Wrap",
        widthInches,
        heightInches,
        bleedInches: 2,
      });
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(obj), 1000);
      toast({ title: "Production pack ready", description: `${panelCount} print-ready panel${panelCount === 1 ? "" : "s"} + panel map downloaded.` });

      // Team back-half — record the panels in the shared production_flow_assets
      // vault (version 'wallpro') so the design team can pick the order up. Direct
      // client write, enabled by the scoped INSERT RLS policy. Non-fatal: the
      // customer already has their download.
      const jobId = crypto.randomUUID();
      persistWallPanels({ supabase, jobId, panels })
        .then((r) => { if (!r.ok) console.warn("[WallPro] vault persist skipped:", r.error); })
        .catch((e) => console.warn("[WallPro] vault persist error:", e));
    } catch (err: any) {
      toast({ title: "Pack build failed", description: err?.message || "Could not build the production pack", variant: "destructive" });
    } finally {
      setBuildingPack(false);
    }
  };

  const handleDownloadBeforeAfter = async () => {
    if (!resultUrl) return;
    const beforeUrl = wallPhotoPreview || null;
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unsupported");

      const loadImg = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("image load failed"));
        img.src = src;
      });

      const after = await loadImg(resultUrl);
      const W = 1920, H = 1080, pad = 16;
      canvas.width = W * 2 + pad;
      canvas.height = H;

      // Before half
      if (beforeUrl) {
        try {
          const before = await loadImg(beforeUrl);
          ctx.drawImage(before, 0, 0, W, H);
        } catch {
          ctx.fillStyle = "#E5E7EB"; ctx.fillRect(0, 0, W, H);
        }
      } else {
        // Studio gradient fallback (simple solid)
        ctx.fillStyle = "#E5E7EB"; ctx.fillRect(0, 0, W, H);
      }
      // After half
      ctx.drawImage(after, W + pad, 0, W, H);

      // Labels
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(24, 24, 180, 56);
      ctx.fillRect(W + pad + 24, 24, 180, 56);
      ctx.fillStyle = "#FFF";
      ctx.font = "700 28px 'Inter', sans-serif";
      ctx.fillText("BEFORE", 56, 62);
      ctx.fillText("AFTER", W + pad + 56, 62);

      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
      );
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = `wallpro-${slug(designName)}-before-after.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(obj), 1000);
    } catch (err: any) {
      toast({ title: "Export failed", description: err?.message || "Could not build before/after image", variant: "destructive" });
    }
  };

  // ── Create a Production Pack ($299) ───────────────────────────

  const handleCreateProductionPack = async () => {
    if (!resultUrl) {
      toast({ title: "Generate a design first", description: "Create your wall wrap render before ordering a production pack", variant: "destructive" });
      return;
    }
    try {
      setCreatingProductionPack(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast({ title: "Login required", variant: "destructive" }); return; }

      await (supabase as any).from("quick_quote_items").insert({
        user_id: user.id,
        product_type: "wallpro_production_pack",
        product_name: `WallPro Production Pack — ${designName || "Wall Wrap"}`,
        description: `Custom production pack for ${heightInches}" H × ${widthInches}" W wall wrap on ${WALL_FILM.name}`,
        width_inches: widthInches,
        height_inches: heightInches,
        sq_ft: estimate.totalSqFt,
        panels: estimate.panelsNeeded,
        material_name: WALL_FILM.name,
        unit_price: 299,
        quantity: 1,
        total_price: 299,
        render_url: resultUrl,
        metadata: {
          tier: "custom_production_pack",
          price_usd: 299,
          film: WALL_FILM.name,
          finish: WALL_FILM.finish,
          linear_feet: estimate.totalLinearFeet,
          design_name: designName,
          turnaround: "24-48h custom assembly",
        },
      });

      toast({ title: "Production Pack added", description: "$299 custom pack queued in QuickQuotes" });
      navigate("/app-cart");
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    } finally {
      setCreatingProductionPack(false);
    }
  };

  // ── Zone tool drag ────────────────────────────────────────────

  const onDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragStart.current = { x: clientX, y: clientY, ox: overlayPos.x, oy: overlayPos.y };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const dx = ((clientX - dragStart.current.x) / (canvasRef.current?.offsetWidth || 600)) * 100;
      const dy = ((clientY - dragStart.current.y) / (canvasRef.current?.offsetHeight || 400)) * 100;
      setOverlayPos({ x: Math.max(0, Math.min(100 - overlayScale, dragStart.current.ox + dx)), y: Math.max(0, Math.min(100 - overlayScale, dragStart.current.oy + dy)) });
    };
    const onEnd = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onEnd);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onEnd); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
  }, [isDragging, overlayScale]);

  // ── Gallery click handlers ────────────────────────────────────

  const handlePreviewDesign = (design: { name: string; prompt: string }) => {
    if (!hasBackground) {
      toast({ title: "Select a wall first", description: "Upload a wall photo or pick a studio view" });
      return;
    }
    // Use gradient as placeholder overlay
    setDesignPreview(undefined as any);
    setResultUrl(null);
    setResultIsScene(false);
    setDesignName(design.name);
    setPrompt(design.prompt);
    toast({ title: `"${design.name}" loaded`, description: "Click Generate to create this design" });
    promptRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleCustomizeDesign = (design: { name: string; prompt: string }) => {
    setPrompt(design.prompt);
    promptRef.current?.scrollIntoView({ behavior: "smooth" });
    promptRef.current?.focus();
    toast({ title: "Prompt pre-filled", description: `Customize "${design.name}" and click Generate` });
  };

  // ── Styles ────────────────────────────────────────────────────

  const card = { background: "#F7F8FA", borderRadius: 14, border: "1px solid #E5E7EB", padding: 20 } as const;
  const darkCard = { background: "#111", borderRadius: 14, padding: 20, color: "#FFF" } as const;
  const label = { fontSize: 13, fontWeight: 700 as const, color: "#111", marginBottom: 8 };
  const sublabel = { fontSize: 11, color: "#9CA3AF" };

  // ─── RENDER ───────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#FFF" }}>
      <Helmet><title>WallPro - AI Wall Wrap Designer | RestyleProAI</title></Helmet>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 80px" }}>
        {/* ── Breadcrumb + Hero ───────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <button onClick={() => navigate("/printpro")} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 500, color: "#6B7280", background: "none", border: "none", cursor: "pointer" }}>
            <ArrowLeft size={14} /> PrintPro
          </button>
          <ChevronRight size={12} style={{ color: "#D1D5DB" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>WallPro</span>
        </div>

        <h1 style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 36, fontWeight: 800, color: "#111", margin: "0 0 4px", letterSpacing: "-0.02em" }}>
          Wall<span style={{ background: GRADIENT, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Pro</span>
        </h1>
        <p style={{ fontSize: 15, color: "#6B7280", margin: "0 0 4px" }}>AI-Powered Wall Wrap Designer & Visualizer</p>
        <p style={{ fontSize: 13, color: "#9CA3AF", margin: "0 0 28px" }}>Upload a wall photo or use Studio View. Prompt a design, preview it, price it, order it.</p>

        {/* ── Two Design Entry Paths (side by side) ──────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          {/* Path A: Upload Your Wall */}
          <div style={{ ...card, border: path === "upload" ? "2px solid #0EA5E9" : "1px solid #E5E7EB", cursor: "pointer" }} onClick={() => setPath("upload")}>
            <div style={label}><Camera size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />Upload Your Wall</div>
            <div
              onClick={(e) => { e.stopPropagation(); wallFileRef.current?.click(); }}
              style={{ border: wallPhotoPreview ? "2px solid #0EA5E9" : "2px dashed #D1D5DB", borderRadius: 10, padding: wallPhotoPreview ? 0 : 32, textAlign: "center", cursor: "pointer", overflow: "hidden", background: "#FFF", transition: "border 0.2s" }}
            >
              {wallPhotoPreview ? (
                <img src={wallPhotoPreview} alt="Wall" style={{ width: "100%", maxHeight: 180, objectFit: "cover" }} />
              ) : (
                <div>
                  <Upload size={24} style={{ color: "#9CA3AF", margin: "0 auto 8px" }} />
                  <div style={{ fontSize: 13, color: "#6B7280" }}>Upload a photo of your client's wall</div>
                  <div style={sublabel}>JPG, PNG, WEBP</div>
                </div>
              )}
            </div>
            <input ref={wallFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleWallPhoto} />
          </div>

          {/* Path B: Studio View */}
          <div style={{ ...card, border: path === "studio" ? "2px solid #0EA5E9" : "1px solid #E5E7EB", cursor: "pointer" }} onClick={() => setPath("studio")}>
            <div style={label}><Paintbrush size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />Studio View</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {STUDIO_ROOMS.map((room) => {
                const Icon = room.icon;
                const active = studioRoom === room.id;
                return (
                  <button
                    key={room.id}
                    onClick={(e) => { e.stopPropagation(); setStudioRoom(room.id); setPath("studio"); }}
                    style={{ padding: "10px 6px", borderRadius: 8, border: active ? "2px solid #0EA5E9" : "1px solid #E5E7EB", background: active ? "#EFF6FF" : "#FFF", cursor: "pointer", textAlign: "center" }}
                  >
                    <div style={{ width: "100%", height: 32, borderRadius: 6, background: room.gradient, marginBottom: 4 }} />
                    <Icon size={14} style={{ color: active ? "#0EA5E9" : "#9CA3AF", margin: "0 auto 2px", display: "block" }} />
                    <div style={{ fontSize: 10, fontWeight: 600, color: active ? "#0EA5E9" : "#6B7280", lineHeight: 1.2 }}>{room.label}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Canvas with Zone Tool + View Modes ─────────────── */}
        {hasBackground && (() => {
          const wallBg = wallPhotoPreview
            ? `url(${wallPhotoPreview}) center/cover`
            : (studioRoom ? STUDIO_ROOMS.find(r => r.id === studioRoom)?.gradient : "#E5E7EB");
          const sceneBg = (resultUrl && resultIsScene) ? `url(${resultUrl}) center/cover` : null;

          // What the canvas itself renders as background
          const canvasBg = viewMode === "design"
            ? "#FAFAFA"
            : viewMode === "before"
              ? wallBg
              : (sceneBg || wallBg); // "after" or "split"

          // Show the flat-art design overlay (positioned by zone tool)
          const showFlatOverlay = (viewMode === "after" || viewMode === "split")
            && !sceneBg && (resultUrl || designPreview);

          // Show dimension boundary overlay
          const showDimensions = viewMode !== "design" && heightInches > 0 && widthInches > 0 && !sceneBg;

          // Zone toolbar is only useful when positioning a flat-art overlay
          const showZoneToolbar = viewMode === "after" && !sceneBg;

          return (
          <div style={{ ...card, marginBottom: 24, padding: 0, overflow: "hidden" }}>
            {/* View Mode tabs — always visible so the before/after path is discoverable.
                "Before" is always on. "After" / "Design Only" unlock with any design
                (uploaded artwork or AI render). "Before / After" needs an AI render. */}
            <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #E5E7EB", background: "#FAFBFC", overflowX: "auto" }}>
              {[
                { id: "before", label: "Before", Icon: Camera, enabled: true },
                { id: "after", label: "After", Icon: Sparkles, enabled: !!(resultUrl || designPreview) },
                { id: "split", label: "Before / After", Icon: Columns2, enabled: !!resultUrl },
                { id: "design", label: "Design Only", Icon: FileImage, enabled: !!(resultUrl || designPreview) },
              ].map(({ id, label, Icon, enabled }) => {
                const disabled = !enabled;
                const isActive = viewMode === id;
                return (
                  <button
                    key={id}
                    onClick={() => {
                      if (disabled) {
                        toast({ title: "Generate a design first", description: `${label} view unlocks after you generate a wall design` });
                        return;
                      }
                      setViewMode(id as ViewMode);
                    }}
                    style={{
                      padding: "10px 14px",
                      border: "none",
                      borderBottom: isActive ? "2px solid #0EA5E9" : "2px solid transparent",
                      background: "transparent",
                      color: disabled ? "#C7CDD4" : (isActive ? "#111" : "#6B7280"),
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: disabled ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      whiteSpace: "nowrap",
                      transition: "all 0.15s",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={13} /> {label}
                    {disabled && <Lock size={10} style={{ marginLeft: 2 }} />}
                  </button>
                );
              })}
            </div>

            {/* Zone toolbar — only for positioning flat-art overlay */}
            {showZoneToolbar && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid #E5E7EB", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#6B7280" }}>
                  <span>Scale: {overlayScale}%</span>
                  <input type="range" min={20} max={100} value={overlayScale} onChange={(e) => setOverlayScale(Number(e.target.value))} style={{ width: 80, accentColor: "#0EA5E9" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#6B7280" }}>
                  <Eye size={12} /> Opacity: {overlayOpacity}%
                  <input type="range" min={10} max={100} value={overlayOpacity} onChange={(e) => setOverlayOpacity(Number(e.target.value))} style={{ width: 80, accentColor: "#0EA5E9" }} />
                </div>
                <button onClick={() => setAspectLocked(!aspectLocked)} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: aspectLocked ? "#0EA5E9" : "#6B7280", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                  {aspectLocked ? <Lock size={12} /> : <Unlock size={12} />} {aspectLocked ? "Locked" : "Unlocked"}
                </button>
                <button onClick={() => { setOverlayScale(100); setOverlayPos({ x: 0, y: 0 }); }} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "#0EA5E9", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                  <Maximize size={12} /> Fit to Wall
                </button>
                <button onClick={() => { setOverlayScale(80); setOverlayPos({ x: 10, y: 10 }); setOverlayOpacity(100); }} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "#6B7280", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                  <RotateCcw size={12} /> Reset
                </button>
              </div>
            )}

            {/* Canvas */}
            <div
              ref={canvasRef}
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "16/9",
                background: canvasBg,
                overflow: "hidden",
                cursor: isDragging ? "grabbing" : "default",
              }}
            >
              {/* Corner chip — tells the user which view they're looking at */}
              {viewMode === "before" && (
                <div style={{ position: "absolute", top: 10, left: 10, padding: "4px 10px", borderRadius: 6, background: "rgba(0,0,0,0.65)", fontSize: 10, fontWeight: 700, color: "#FFF", letterSpacing: "0.08em", zIndex: 2 }}>
                  BEFORE {!resultUrl && <span style={{ opacity: 0.7, fontWeight: 500 }}>· generate to unlock After</span>}
                </div>
              )}
              {viewMode === "after" && resultUrl && (
                <div style={{ position: "absolute", top: 10, left: 10, padding: "4px 10px", borderRadius: 6, background: GRADIENT, fontSize: 10, fontWeight: 700, color: "#FFF", letterSpacing: "0.08em", zIndex: 2 }}>
                  AFTER
                </div>
              )}

              {/* Design-only mode: just the design centered on a neutral bg */}
              {viewMode === "design" && resultUrl && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", backgroundImage: "linear-gradient(45deg, #EFEFEF 25%, transparent 25%), linear-gradient(-45deg, #EFEFEF 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #EFEFEF 75%), linear-gradient(-45deg, transparent 75%, #EFEFEF 75%)", backgroundSize: "20px 20px", backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0" }}>
                  <img
                    src={resultUrl}
                    alt={designName || "Wall design"}
                    style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain", boxShadow: "0 4px 24px rgba(0,0,0,0.12)", borderRadius: 6, background: "#FFF" }}
                  />
                  <div style={{ position: "absolute", bottom: 10, left: 10, padding: "4px 10px", borderRadius: 6, background: "rgba(0,0,0,0.7)", fontSize: 10, fontWeight: 600, color: "#FFF", letterSpacing: "0.05em" }}>
                    {resultIsScene ? "SCENE RENDER" : "FLAT ARTWORK"}
                  </div>
                </div>
              )}

              {/* Placeholder hint — studio room picked, nothing rendered yet */}
              {viewMode !== "design" && !resultUrl && !wallPhotoPreview && studioRoom && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.45)", backdropFilter: "blur(2px)" }}>
                  <div style={{ textAlign: "center", padding: "10px 18px", background: "rgba(255,255,255,0.9)", borderRadius: 10, border: "1px solid #E5E7EB", maxWidth: 320 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#111", marginBottom: 2 }}>
                      {STUDIO_ROOMS.find(r => r.id === studioRoom)?.label}
                    </div>
                    <div style={{ fontSize: 11, color: "#6B7280" }}>
                      Type a design prompt and click Generate to see a photorealistic render in this room.
                    </div>
                  </div>
                </div>
              )}

              {/* Dimension boundary overlay */}
              {showDimensions && (
                <div style={{ position: "absolute", inset: "4%", border: "1px dashed rgba(14,165,233,0.4)", borderRadius: 4, pointerEvents: "none" }}>
                  <span style={{ position: "absolute", top: -16, left: 4, fontSize: 9, color: "#0EA5E9", fontWeight: 600 }}>{widthInches}" W</span>
                  <span style={{ position: "absolute", top: 4, left: -30, fontSize: 9, color: "#0EA5E9", fontWeight: 600, transform: "rotate(-90deg)" }}>{heightInches}" H</span>
                </div>
              )}

              {/* Flat-art design overlay */}
              {showFlatOverlay && (
                <div
                  onMouseDown={viewMode === "after" ? onDragStart : undefined}
                  onTouchStart={viewMode === "after" ? onDragStart : undefined}
                  style={{
                    position: "absolute", left: `${overlayPos.x}%`, top: `${overlayPos.y}%`,
                    width: `${overlayScale}%`, height: aspectLocked ? "auto" : `${overlayScale}%`,
                    opacity: overlayOpacity / 100,
                    cursor: viewMode === "after" ? "grab" : "default",
                    border: viewMode === "after" ? "1px dashed #0EA5E9" : "none",
                    borderRadius: 2,
                    boxShadow: isDragging ? "0 0 0 2px rgba(14,165,233,0.3)" : "none",
                  }}
                >
                  <img src={resultUrl || designPreview!} alt="Design" style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", userSelect: "none" }} draggable={false} />
                  {viewMode === "after" && [{ t: -4, l: -4 }, { t: -4, r: -4 }, { b: -4, l: -4 }, { b: -4, r: -4 }].map((pos, i) => (
                    <div key={i} style={{ position: "absolute", ...pos as any, width: 8, height: 8, background: "#0EA5E9", borderRadius: 2, border: "1px solid #FFF" }} />
                  ))}
                </div>
              )}

              {/* Split-view "before" cover — covers the left half with the pre-render wall */}
              {viewMode === "split" && resultUrl && (
                <>
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "50%", background: wallBg, borderRight: "2px solid #FFF", boxShadow: "2px 0 8px rgba(0,0,0,0.15)", pointerEvents: "none" }} />
                  <div style={{ position: "absolute", top: 10, left: 10, padding: "3px 8px", borderRadius: 4, background: "rgba(0,0,0,0.65)", fontSize: 10, fontWeight: 700, color: "#FFF", letterSpacing: "0.08em" }}>BEFORE</div>
                  <div style={{ position: "absolute", top: 10, right: 10, padding: "3px 8px", borderRadius: 4, background: GRADIENT, fontSize: 10, fontWeight: 700, color: "#FFF", letterSpacing: "0.08em" }}>AFTER</div>
                </>
              )}
            </div>
          </div>
          );
        })()}

        {/* ── Prompt + Design Upload ─────────────────────────── */}
        <div style={{ ...card, marginBottom: 24 }}>
          <div style={label}>Describe your wall wrap design</div>
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='e.g. "Les Mills style fitness wall wrap \u2014 someone working out, bold GET FIT text, geometric lines, dark blue and white"'
            style={{ width: "100%", minHeight: 80, padding: 12, borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 14, color: "#111", resize: "vertical", fontFamily: "inherit", background: "#FFF" }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#9CA3AF" }}>or</span>
            <button onClick={() => designFileRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#FFF", fontSize: 12, fontWeight: 600, color: "#6B7280", cursor: "pointer" }}>
              <Upload size={14} /> Upload your own artwork
            </button>
            {designPreview && <img src={designPreview} alt="" style={{ height: 32, borderRadius: 4, border: "1px solid #E5E7EB" }} />}
            <input ref={designFileRef} type="file" accept="image/*,.svg,.pdf" style={{ display: "none" }} onChange={handleDesignUpload} />
            <div style={{ flex: 1 }} />
            <button
              onClick={handleGenerate}
              disabled={isGenerating || (!prompt.trim() && !designFile)}
              style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: isGenerating ? "#6B7280" : GRADIENT, color: "#FFF", fontSize: 14, fontWeight: 700, cursor: isGenerating ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6, opacity: (!prompt.trim() && !designFile) ? 0.4 : 1, fontFamily: "'League Spartan', sans-serif" }}
            >
              {isGenerating ? <><Loader2 size={16} className="animate-spin" /> Generating...</> : <><Wand2 size={16} /> Generate Wall Design</>}
            </button>
          </div>
        </div>

        {/* ── Dimension & Pricing Bar ────────────────────────── */}
        <div style={{ ...card, marginBottom: 24, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Ruler size={14} style={{ color: "#0EA5E9" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>Dimensions</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#6B7280" }}>Height (in)</label>
            <div style={{ display: "flex", alignItems: "center", border: "1px solid #E5E7EB", borderRadius: 6, overflow: "hidden" }}>
              <button onClick={() => setHeightInches(Math.max(12, heightInches - 6))} style={{ width: 28, height: 32, border: "none", background: "#F7F8FA", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={12} /></button>
              <input type="number" value={heightInches} onChange={(e) => setHeightInches(Number(e.target.value) || 0)} style={{ width: 56, height: 32, border: "none", textAlign: "center", fontSize: 14, fontWeight: 600, color: "#111" }} />
              <button onClick={() => setHeightInches(heightInches + 6)} style={{ width: 28, height: 32, border: "none", background: "#F7F8FA", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={12} /></button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#6B7280" }}>Width (in)</label>
            <div style={{ display: "flex", alignItems: "center", border: "1px solid #E5E7EB", borderRadius: 6, overflow: "hidden" }}>
              <button onClick={() => setWidthInches(Math.max(12, widthInches - 6))} style={{ width: 28, height: 32, border: "none", background: "#F7F8FA", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={12} /></button>
              <input type="number" value={widthInches} onChange={(e) => setWidthInches(Number(e.target.value) || 0)} style={{ width: 56, height: 32, border: "none", textAlign: "center", fontSize: 14, fontWeight: 600, color: "#111" }} />
              <button onClick={() => setWidthInches(widthInches + 6)} style={{ width: 28, height: 32, border: "none", background: "#F7F8FA", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={12} /></button>
            </div>
          </div>
          <div style={{ width: 1, height: 28, background: "#E5E7EB" }} />
          <div style={{ fontSize: 13, color: "#6B7280" }}>
            <strong style={{ color: "#111" }}>{estimate.totalSqFt}</strong> sq ft &bull; <strong style={{ color: "#111" }}>{estimate.totalLinearFeet}</strong> linear ft @ {WALL_FILM.panelWidthInches}" panels
          </div>
          <div style={{ width: 1, height: 28, background: "#E5E7EB" }} />
          <div style={{ fontSize: 20, fontWeight: 800, color: "#111", fontFamily: "'League Spartan', sans-serif" }}>
            ${estimate.materialCost.toFixed(2)}
          </div>
        </div>

        {/* Film spec line */}
        <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 24, paddingLeft: 4 }}>
          Printed on <strong style={{ color: "#6B7280" }}>{WALL_FILM.name}</strong> &bull; {WALL_FILM.panelWidthInches}" panels &bull; {WALL_FILM.finish} &bull; No lamination required
        </div>

        {/* ── Production Flow: Quick Exports ───────────────────── */}
        {resultUrl && (
          <div style={{ ...card, marginBottom: 16, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <FileDown size={14} style={{ color: "#0EA5E9" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>Production Flow Exports</span>
              <span style={{ fontSize: 11, color: "#9CA3AF" }}>· quick downloads for proofing & client review</span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => setShowOfficialProof(true)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: GRADIENT, fontSize: 12, fontWeight: 700, color: "#FFF", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
              >
                <FileCheck2 size={14} /> Official Design Proof
              </button>
              <button
                onClick={handleDownloadRender}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#FFF", fontSize: 12, fontWeight: 600, color: "#111", cursor: "pointer" }}
              >
                <Download size={14} /> Download Render (PNG)
              </button>
              <button
                onClick={handleDownloadBeforeAfter}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#FFF", fontSize: 12, fontWeight: 600, color: "#111", cursor: "pointer" }}
              >
                <Columns2 size={14} /> Before / After (PNG)
              </button>
              <button
                onClick={handleDownloadDesignOnly}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#FFF", fontSize: 12, fontWeight: 600, color: "#111", cursor: "pointer" }}
              >
                <FileImage size={14} /> Design Only
              </button>
            </div>
          </div>
        )}

        {/* ── Purchase Options ────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: resultUrl ? "1fr 1fr 1fr" : "1fr 1fr", gap: 16, marginBottom: 24 }}>
          {/* Order Printed */}
          <div style={{ ...darkCard, position: "relative" }}>
            <div style={{ display: "inline-block", padding: "3px 10px", borderRadius: 6, background: "#059669", fontSize: 10, fontWeight: 700, color: "#FFF", marginBottom: 12, letterSpacing: "0.05em" }}>SHIPS NEXT DAY</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'League Spartan', sans-serif", marginBottom: 4 }}>${estimate.materialCost.toFixed(2)}</div>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 12 }}>{WALL_FILM.name}</div>
            <div style={{ fontSize: 11, color: "#6B7280", lineHeight: 1.8, marginBottom: 16 }}>
              {WALL_FILM.panelWidthInches}" panels &bull; {WALL_FILM.finish}<br />
              No lamination &bull; {WALL_FILM.installType}
            </div>
            <button
              onClick={handleAddToQuote}
              disabled={addedToQuote}
              style={{ width: "100%", padding: "12px 20px", borderRadius: 10, border: "none", background: addedToQuote ? "#059669" : GRADIENT, color: "#FFF", fontSize: 14, fontWeight: 700, cursor: addedToQuote ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "'League Spartan', sans-serif" }}
            >
              {addedToQuote ? <><CheckCircle2 size={16} /> Added to Quote</> : <><ShoppingCart size={16} /> Order from WePrintWraps</>}
            </button>
            <div style={{ fontSize: 10, color: "#6B7280", marginTop: 8, textAlign: "center" }}>Wholesale pricing at ${WALL_FILM.pricePerLinearFoot}/linear ft</div>
          </div>

          {/* Buy Production Pack ($149 — instant download bundle) */}
          <div style={{ ...card }}>
            <div style={{ display: "inline-block", padding: "3px 10px", borderRadius: 6, background: "#0EA5E9", fontSize: 10, fontWeight: 700, color: "#FFF", marginBottom: 12, letterSpacing: "0.05em" }}>INSTANT DOWNLOAD</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'League Spartan', sans-serif", color: "#111", marginBottom: 4 }}>$149</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>Buy Production Pack</div>
            <div style={{ fontSize: 11, color: "#9CA3AF", lineHeight: 1.8, marginBottom: 16 }}>
              Print-ready TIFF panels &bull; EPS with dimensions<br />
              PNG previews &bull; Panel map &bull; Install guide
            </div>
            <button
              onClick={handleBuyProductionPack}
              disabled={!resultUrl || buildingPack}
              style={{ width: "100%", padding: "12px 20px", borderRadius: 10, border: "2px solid #E5E7EB", background: "#FFF", color: "#111", fontSize: 14, fontWeight: 700, cursor: (!resultUrl || buildingPack) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "'League Spartan', sans-serif", opacity: (!resultUrl || buildingPack) ? 0.5 : 1 }}
            >
              {buildingPack ? <><Loader2 size={16} className="animate-spin" /> Building panels…</> : <><Download size={16} /> Buy Production Pack</>}
            </button>
            <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 8, textAlign: "center" }}>{estimate.panelsNeeded} panel{estimate.panelsNeeded === 1 ? "" : "s"} @ 54" · mirror bleed · print on your own wide-format printer</div>
          </div>

          {/* Create a Production Pack ($299 — custom assembly) */}
          {resultUrl && (
            <div style={{ ...card, position: "relative", border: "2px solid transparent", backgroundImage: "linear-gradient(#F7F8FA, #F7F8FA), " + GRADIENT, backgroundOrigin: "border-box", backgroundClip: "padding-box, border-box" }}>
              <div style={{ display: "inline-block", padding: "3px 10px", borderRadius: 6, background: GRADIENT, fontSize: 10, fontWeight: 700, color: "#FFF", marginBottom: 12, letterSpacing: "0.05em" }}>CUSTOM · 24–48H</div>
              <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'League Spartan', sans-serif", color: "#111", marginBottom: 4 }}>$299</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>Create a Production Pack</div>
              <div style={{ fontSize: 11, color: "#9CA3AF", lineHeight: 1.8, marginBottom: 16 }}>
                Custom panel layout &bull; Bleed + dimensions baked in<br />
                Designer review &bull; Vector exports &bull; Install map
              </div>
              <button
                onClick={handleCreateProductionPack}
                disabled={creatingProductionPack}
                style={{ width: "100%", padding: "12px 20px", borderRadius: 10, border: "none", background: GRADIENT, color: "#FFF", fontSize: 14, fontWeight: 700, cursor: creatingProductionPack ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "'League Spartan', sans-serif" }}
              >
                {creatingProductionPack ? <><Loader2 size={16} className="animate-spin" /> Creating…</> : <><Package size={16} /> Create Production Pack</>}
              </button>
              <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 8, textAlign: "center" }}>Hand-tuned by our production team</div>
            </div>
          )}
        </div>

        {/* ApprovePro — Phase 8A (own row so it doesn't squeeze the production tier) */}
        {resultUrl && (
          <div style={{ ...card, marginBottom: 24, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "inline-block", padding: "3px 10px", borderRadius: 6, background: "linear-gradient(135deg, #2563EB, #8B5CF6)", fontSize: 10, fontWeight: 700, color: "#FFF", letterSpacing: "0.05em" }}>NEW · APPROVEPRO</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>Send for Client Approval</div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>E-signature, revision loop, audit-grade signed PDF.</div>
            </div>
            <button
              onClick={() => setShowSendForApproval(true)}
              style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #2563EB, #8B5CF6)", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'League Spartan', sans-serif" }}
            >
              <ClipboardSignature size={16} /> Send for Approval
            </button>
          </div>
        )}

        {/* Upsell row */}
        <div style={{ display: "flex", gap: 16, marginBottom: 40, justifyContent: "center", flexWrap: "wrap" }}>
          {[
            { label: "Need a pattern?", cta: "PatternPro", to: "/printpro/wbty" },
            { label: "Browse designs", cta: "RestyleLibrary", to: "/printpro/design-packs" },
            { label: "Full custom design", cta: "DesignPro", to: "/designpro" },
          ].map((u) => (
            <button key={u.cta} onClick={() => navigate(u.to)} style={{ fontSize: 12, color: "#6B7280", background: "none", border: "none", cursor: "pointer" }}>
              {u.label} <span style={{ color: "#0EA5E9", fontWeight: 600 }}>{u.cta} &rarr;</span>
            </button>
          ))}
        </div>

        {/* ── Design Gallery (Phase 4) ───────────────────────── */}
        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 24, fontWeight: 800, color: "#111", margin: "0 0 4px" }}>Ready-Made Wall Wrap Designs</h2>
          <p style={{ fontSize: 13, color: "#9CA3AF", margin: "0 0 16px" }}>Browse by space \u2014 click any design to preview on your wall</p>

          {/* Category tabs */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20, overflowX: "auto", paddingBottom: 4 }}>
            {(galleryCategories.length > 0 ? galleryCategories : CATEGORIES as unknown as string[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setGalleryCategory(cat)}
                style={{
                  padding: "8px 16px", borderRadius: 20, border: "none", whiteSpace: "nowrap",
                  background: (galleryCategory || galleryCategories[0] || CATEGORIES[0]) === cat ? GRADIENT : "#F7F8FA",
                  color: (galleryCategory || galleryCategories[0] || CATEGORIES[0]) === cat ? "#FFF" : "#6B7280",
                  fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Design grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {galleryItems.filter((d) => d.category === (galleryCategory || galleryCategories[0] || CATEGORIES[0])).map((design) => (
              <div key={design.id} style={{ ...card, padding: 0, overflow: "hidden", transition: "box-shadow 0.2s, transform 0.2s", cursor: "pointer" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.08)"; (e.currentTarget as HTMLElement).style.transform = "scale(1.02)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
              >
                {design.imageUrl ? (
                  <img src={design.imageUrl} alt={design.name} style={{ width: "100%", aspectRatio: "16/10", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: "100%", aspectRatio: "16/10", background: design.thumbGradient }} />
                )}
                <div style={{ padding: "12px 14px" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 2 }}>{design.name}</div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 10, lineHeight: 1.4 }}>{design.description}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => handlePreviewDesign(design)}
                      style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#FFF", fontSize: 11, fontWeight: 600, color: "#111", cursor: "pointer" }}
                    >
                      Preview on Wall
                    </button>
                    <button
                      onClick={() => handleCustomizeDesign(design)}
                      style={{ padding: "6px 10px", borderRadius: 6, border: "none", background: "none", fontSize: 11, fontWeight: 600, color: "#0EA5E9", cursor: "pointer" }}
                    >
                      Customize
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Loading overlay */}
      {isGenerating && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, flexDirection: "column", gap: 16 }}>
          <Loader2 size={40} className="animate-spin" style={{ color: "#8B5CF6" }} />
          <div style={{ fontSize: 16, fontWeight: 600, color: "#111" }}>Generating your wall design...</div>
          <div style={{ fontSize: 13, color: "#6B7280" }}>This may take up to 2 minutes</div>
        </div>
      )}

      {/* ApprovePro — Phase 8A */}
      <SendForApprovalDialog
        open={showSendForApproval}
        onOpenChange={setShowSendForApproval}
        context={{
          renderUrls: resultUrl ? { hero: resultUrl } : {},
          designName: designName || "Wall Wrap Design",
          finishType: "Wall vinyl",
          defaultMode: "revision_loop",
        }}
      />

      {/* Official WallPro Design Proof — printable / PDF */}
      <WallProDesignProof
        open={showOfficialProof}
        onOpenChange={setShowOfficialProof}
        designName={designName || "Wall Wrap Design"}
        renderUrl={resultUrl}
        beforeUrl={wallPhotoPreview}
        studioRoomLabel={studioRoom ? STUDIO_ROOMS.find((r) => r.id === studioRoom)?.label ?? null : null}
        heightInches={heightInches}
        widthInches={widthInches}
        totalSqFt={estimate.totalSqFt}
        totalLinearFeet={estimate.totalLinearFeet}
        panelsNeeded={estimate.panelsNeeded}
        materialCost={estimate.materialCost}
        promptText={prompt.trim() || undefined}
      />
    </div>
  );
};

export default WallPro;
