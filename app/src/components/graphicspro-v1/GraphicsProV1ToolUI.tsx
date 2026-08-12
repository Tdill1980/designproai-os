import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, ArrowLeft, Loader2, CheckCircle2, ClipboardSignature, Calculator, Scissors, Download, FileBox, Ruler, Camera } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useCutGraphicsProof } from "@/hooks/useCutGraphicsProof";
import { CutGraphicsProofSheet } from "@/components/graphicspro/CutGraphicsProofSheet";
import { renderClient } from "@/integrations/supabase/renderClient";
import { QuickQuoteSidePanel } from "@/components/quote/QuickQuoteSidePanel";
import { useToast } from "@/hooks/use-toast";
import { useGraphicsProV1Logic } from "@/hooks/useGraphicsProV1Logic";
import { supabase } from "@/integrations/supabase/client";
import { SurfaceSelection } from "./SurfaceSelection";
import { GraphicInput } from "./GraphicInput";
import { VinylFinishSelector } from "./VinylFinishSelector";
import { MockupPreview } from "./MockupPreview";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import { ProductionOutput } from "./ProductionOutput";
import { PricingEstimator } from "./PricingEstimator";
import type { LineItem } from "./PricingEstimator";
import { InlineEstimateCard } from "./InlineEstimateCard";
import { ShopMarkupConfig } from "./ShopMarkupConfig";
import { SendForApprovalDialog } from "@/components/proof/SendForApprovalDialog";
import { PreVisionReview } from "./PreVisionReview";
import type {
  SurfaceSelections,
  GraphicInput as GraphicInputType,
  VinylFinish,
} from "./types";
import { DEFAULT_SURFACE, DEFAULT_GRAPHIC } from "./types";
import {
  getUniqueMakes,
  getModelsForMake,
  findVehicle,
} from "@/data/vehicle-measurements";

const STEPS = [
  { number: 1, label: 'Setup', description: 'Surface & cut contour graphic' },
  { number: 2, label: 'Preview', description: 'Approve cut contour' },
  { number: 3, label: 'Output', description: 'Cut contour files' },
] as const;

interface GraphicsProV1ToolUIProps {
  initialSurfaceType?: 'vehicle' | 'wall' | 'glass';
}

export function GraphicsProV1ToolUI({ initialSurfaceType }: GraphicsProV1ToolUIProps = {}) {
  const { toast } = useToast();

  // State — pre-select surface type if provided
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // QuickQuote × GraphicsPro side panel — wraps the existing
  // PricingEstimator (same logic, same line items) so the rep gets a
  // branded sidebar consistent with ColorPro / DesignPro instead of
  // the inline pricing tile at the bottom of step 2.
  const [showQuickQuote, setShowQuickQuote] = useState(false);
  const [surface, setSurface] = useState<SurfaceSelections>(() => {
    if (initialSurfaceType) {
      return { ...DEFAULT_SURFACE, type: initialSurfaceType, source: 'generated' as const };
    }
    return DEFAULT_SURFACE;
  });
  const [graphic, setGraphic] = useState<GraphicInputType>(DEFAULT_GRAPHIC);
  const [vinylFinish, setVinylFinish] = useState<VinylFinish>('glossy');
  const [materialType, setMaterialType] = useState<"avery" | "3m">("avery");
  const [markupPercentage, setMarkupPercentage] = useState(100);
  const [showSettings, setShowSettings] = useState(false);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [showSendForApproval, setShowSendForApproval] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [vehiclePreviewUrl, setVehiclePreviewUrl] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  // Render-mode toggle (day / night) for the preview screen. Day is the
  // default for every existing flow; switching to Night re-renders the
  // same wrap with after-hours lighting via the backend prompt branch.
  const [renderMode, setRenderMode] = useState<'day' | 'night'>('day');

  // Hook for generation logic
  const {
    isGenerating,
    stage,
    error,
    mockupResult,
    generateMockup,
    generateFlat,
    startProduction,
    generateStudioProductionPack,
    generateStudioAngles,
    isGeneratingStudioAngles,
    runLogoUtility,
    reset,
  } = useGraphicsProV1Logic();

  // Cut Graphics Proof (dimensioned production sheet) — reuses the shared hook +
  // sheet + cut-graphics-proof edge function. Surfaced on the preview step for
  // vehicle jobs.
  const { proof: cutProof, isGenerating: isCutProofGenerating, generateProof: generateCutProof } = useCutGraphicsProof();
  const [cutProofOpen, setCutProofOpen] = useState(false);
  const [cutProofSqFt, setCutProofSqFt] = useState<number | null>(null);

  // Build the dimensioned Cut Graphics Proof from the rendered mockup. Resolves
  // real per-side dims from GENIE (panelizer-step-validate) using the vehicle on
  // the surface, then specs each cut graphic to scale.
  const handleBuildCutProof = useCallback(async () => {
    const renderUrl = mockupResult?.mockupUrl || mockupResult?.angles?.[0]?.mockupUrl;
    if (!renderUrl) {
      toast({ title: "No mockup yet", description: "Generate the mockup first.", variant: "destructive" });
      return;
    }
    setCutProofOpen(true);
    let sideW: number | undefined;
    let sideH: number | undefined;
    let sqft: number | null = null;
    // Vehicles resolve true per-side dims from GENIE; walls/windows aren't in
    // GENIE, so they spec against the user's drawn surface/zone dimensions.
    if (surface.type === 'vehicle' && surface.make && surface.model) {
      try {
        const { data } = await renderClient.functions.invoke("panelizer-step-validate", {
          body: { vehicleMake: surface.make, vehicleModel: surface.model, vehicleYear: surface.year ? Number(surface.year) : null, estimateOnly: true },
        });
        const d = (data?.estimatedDimensions || {}) as Record<string, number>;
        sideW = d.bodyLengthInches;
        sideH = d.bodyHeightInches;
        sqft = typeof d.totalSqFt === "number" ? d.totalSqFt : null;
      } catch { /* fall through to zone dims */ }
    }
    // Fall back to (or, for wall/window, use) the user's drawn zone dimensions.
    if (!sideW || !sideH) {
      const z = surface.vinylZones?.[0];
      if (z?.widthInches && z?.heightInches) { sideW = z.widthInches; sideH = z.heightInches; }
    }
    if (!sideW || !sideH) {
      toast({ title: "Dimensions needed", description: "Add at least one zone with real width/height (or set the vehicle) so graphics can be specced to scale.", variant: "destructive" });
      setCutProofOpen(false);
      return;
    }
    setCutProofSqFt(sqft);
    await generateCutProof({
      renderUrl,
      sideWidthInches: sideW,
      sideHeightInches: sideH,
      designName: graphic.businessName || graphic.designPrompt || "Custom Graphics",
      vehicleYear: surface.year,
      vehicleMake: surface.make,
      vehicleModel: surface.model,
    });
  }, [mockupResult, surface, graphic, generateCutProof, toast]);

  // 2D Production Proof — the dimensioned multi-view layout sheet. Built from the
  // rendered angles (primary mockup + studio angles) via generate-2d-proof.
  const [twoDProofUrl, setTwoDProofUrl] = useState<string | null>(null);
  const [isGenerating2DProof, setIsGenerating2DProof] = useState(false);
  const handleGenerate2DProof = useCallback(async () => {
    const primary = mockupResult?.mockupUrl || mockupResult?.angles?.[0]?.mockupUrl;
    if (!primary) {
      toast({ title: "No mockup yet", description: "Generate the design first.", variant: "destructive" });
      return;
    }
    setIsGenerating2DProof(true);
    try {
      // Map the rendered angles to canonical view keys for the proof layout.
      const allViewUrls: Record<string, string> = { side: primary };
      for (const a of mockupResult?.angles || []) {
        if (!a.mockupUrl) continue;
        const vt = a.angleId?.startsWith("studio-") ? a.angleId.replace("studio-", "") : a.angleId;
        if (vt && !allViewUrls[vt]) allViewUrls[vt] = a.mockupUrl;
      }
      const { data, error } = await renderClient.functions.invoke("generate-2d-proof", {
        body: {
          allViewUrls,
          sideUrl: primary,
          vehicleYear: surface.year,
          vehicleMake: surface.make,
          vehicleModel: surface.model,
          designName: graphic.businessName || graphic.designPrompt || "Custom Graphics",
          finish: "gloss",
        },
      });
      const url = (data as any)?.proofUrl || (data as any)?.url;
      if (error || !url) {
        toast({ title: "2D proof failed", description: (data as any)?.error || error?.message || "Try again", variant: "destructive" });
        return;
      }
      setTwoDProofUrl(url);
      toast({ title: "2D Production Proof ready", description: "Dimensioned multi-view proof generated." });
    } catch (e: any) {
      toast({ title: "2D proof error", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setIsGenerating2DProof(false);
    }
  }, [mockupResult, surface, graphic, toast]);

  // 2D Cut-Path Proof — the print-ready CutContour file (100% magenta cut lines,
  // 0.5" bleed, registration marks) via cut-contour-build. CRITICAL: cut paths
  // must trace the FLAT artwork, not the vehicle/surface mockup photo, so we
  // flatten the design first (generate_flat) and feed THAT to the builder.
  const [cutPathPdfUrl, setCutPathPdfUrl] = useState<string | null>(null);
  const [isGeneratingCutPath, setIsGeneratingCutPath] = useState(false);
  const handleBuildCutPathProof = useCallback(async () => {
    if (!mockupResult) {
      toast({ title: "No design yet", description: "Generate the design first.", variant: "destructive" });
      return;
    }
    setIsGeneratingCutPath(true);
    try {
      const designLabel = graphic.businessName || graphic.designPrompt || "Custom Graphics";
      const flatUrl = await generateFlat(graphic.designPrompt || designLabel, graphic.designStyle || "", mockupResult.jobId);
      if (!flatUrl) {
        toast({ title: "Couldn't flatten the artwork", description: "The cut path needs flat artwork — try again.", variant: "destructive" });
        return;
      }
      const { data, error } = await renderClient.functions.invoke("cut-contour-build", {
        body: { file_url: flatUrl, file_name: `${designLabel.replace(/[^a-z0-9-_ ]/gi, "").slice(0, 60) || "cut-graphic"}.png` },
      });
      const url = (data as any)?.output_url;
      if (error || !(data as any)?.success || !url) {
        toast({ title: "Cut path proof failed", description: (data as any)?.error || error?.message || "Try again", variant: "destructive" });
        return;
      }
      setCutPathPdfUrl(url);
      toast({ title: "Cut Path Proof ready", description: "Print-ready CutContour PDF (magenta cut lines + bleed + reg marks)." });
    } catch (e: any) {
      toast({ title: "Cut path proof error", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setIsGeneratingCutPath(false);
    }
  }, [mockupResult, graphic, generateFlat, toast]);

  // AUTO-GENERATE studio angles the moment a design/mockup is created for a
  // vehicle job — no extra click. Keeps the design on the uploaded photo(s) and
  // fills in every canonical studio angle the photos don't cover. Ref-guarded to
  // fire once per mockup; skips if studio angles are already present.
  const autoStudioRef = useRef<string | null>(null);
  useEffect(() => {
    const url = mockupResult?.mockupUrl;
    if (!url) return;
    // Fire for any vehicle job. An uploaded truck photo keeps surface.type ===
    // "vehicle" (the vehicle card owns its own upload affordance), but the
    // upload flow treats year/make/model as optional — so we must NOT gate the
    // studio-angle fill on them, or uploads only ever get one angle. The extra
    // six views are anchored off the rendered mockup, not a make/model lookup.
    const isVehicleJob = surface.type === "vehicle" || surface.source === "upload";
    if (!isVehicleJob) return;
    if (isGeneratingStudioAngles) return;
    if (autoStudioRef.current === url) return;
    if (mockupResult?.angles?.some((a) => a.angleId?.startsWith("studio-"))) return;
    autoStudioRef.current = url;
    generateStudioAngles(surface, graphic);
  }, [mockupResult, surface, graphic, isGeneratingStudioAngles, generateStudioAngles]);

  // Studio cut-contour pack result — SVG URL the user can download
  // once vectorize-it finishes. Surfaced inline under the mockup so
  // they don't have to leave the page.
  const [studioPackSvgUrl, setStudioPackSvgUrl] = useState<string | null>(null);

  // Vehicle makes/models from real measurement database
  const vehicleMakes = getUniqueMakes();
  const [vehicleModels, setVehicleModels] = useState<string[]>([]);

  const handleSurfaceChange = useCallback((updates: Partial<SurfaceSelections>) => {
    setSurface((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleGraphicChange = useCallback((updates: Partial<GraphicInputType>) => {
    setGraphic((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleMakeChange = useCallback((make: string) => {
    setVehicleModels(getModelsForMake(make));
  }, []);

  // Dimension lookup state
  const [isLookingUpDims, setIsLookingUpDims] = useState(false);

  const AREA_LABELS: Record<string, string> = {
    door: "Driver side door",
    "side-panel": "Full side panel",
    hood: "Hood",
    tailgate: "Tailgate / Rear",
    "rear-window": "Rear window",
  };

  // Tier 2: Google Search fallback via Gemini (same as DesignPro panelizer-step-validate)
  const searchDimensionsOnline = useCallback(async (
    make: string, model: string, year: string, area: string
  ) => {
    setIsLookingUpDims(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("generate-graphics-pro", {
        body: { action: "lookup_dimensions", make, model, year, area },
      });
      if (fnErr || !data?.found) {
        console.warn("[GraphicsPro] Google Search dimension lookup failed:", fnErr || data?.error);
        toast({ title: "Could not find vehicle dimensions online", description: "Enter dimensions manually below", variant: "destructive" });
        return;
      }
      // Update the matching zone (by area ID) with Google Search dimensions
      setSurface((prev) => {
        const updated = prev.vinylZones.map((z) =>
          z.id === `zone-${area}` ? { ...z, widthInches: data.widthInches, heightInches: data.heightInches } : z
        );
        return { ...prev, vinylZones: updated };
      });
      toast({ title: "Dimensions found", description: `${area}: ${data.widthInches}" × ${data.heightInches}"` });
    } catch (err) {
      console.error("[GraphicsPro] Dimension lookup error:", err);
    } finally {
      setIsLookingUpDims(false);
    }
  }, [toast]);

  // Helper: get dimensions for an area from vehicle DB
  const getDimsForArea = useCallback((make: string, model: string, year: string, area: string) => {
    const vehicle = findVehicle(make, model, year || undefined);
    if (!vehicle) return { w: 0, h: 0 };
    if (area === "door" || area === "side-panel") return { w: vehicle.sideW || 0, h: vehicle.sideH || 0 };
    if (area === "hood") return { w: vehicle.hoodW || 0, h: vehicle.hoodL || 0 };
    if (area === "tailgate" || area === "rear-window") return { w: vehicle.backW || 0, h: vehicle.backH || 0 };
    return { w: 0, h: 0 };
  }, []);

  // Dimension lookup for upload-tab zones (by zone ID, not area-based ID)
  // Flow: CSV database → Google Search → manual entry
  const handleLookupDimensions = useCallback(async (
    make: string, model: string, year: string, area: string, zoneId: string
  ) => {
    // First check CSV database
    const { w, h } = getDimsForArea(make, model, year, area);
    if (w > 0 && h > 0) {
      setSurface((prev) => ({
        ...prev,
        vinylZones: prev.vinylZones.map((z) =>
          z.id === zoneId ? { ...z, widthInches: Math.round(w), heightInches: Math.round(h) } : z
        ),
      }));
      toast({ title: "Dimensions found", description: `${area}: ${Math.round(w)}" × ${Math.round(h)}"` });
      return;
    }
    // Fall back to Google Search
    setIsLookingUpDims(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("generate-graphics-pro", {
        body: { action: "lookup_dimensions", make, model, year, area },
      });
      if (fnErr || !data?.found) {
        toast({ title: "Could not find dimensions", description: "Enter manually", variant: "destructive" });
        return;
      }
      setSurface((prev) => ({
        ...prev,
        vinylZones: prev.vinylZones.map((z) =>
          z.id === zoneId ? { ...z, widthInches: data.widthInches, heightInches: data.heightInches } : z
        ),
      }));
      toast({ title: "Dimensions found", description: `${area}: ${data.widthInches}" × ${data.heightInches}"` });
    } catch (err) {
      console.error("[GraphicsPro] Dimension lookup error:", err);
    } finally {
      setIsLookingUpDims(false);
    }
  }, [toast, getDimsForArea]);

  // Toggle a vehicle area on/off — each creates/removes a zone
  const handleAreaToggle = useCallback((area: string) => {
    setSurface((prev) => {
      const locationLabel = AREA_LABELS[area] || area;
      const existing = prev.vinylZones.find((z) => z.id === `zone-${area}`);

      if (existing) {
        // Untoggle: remove this zone
        const filtered = prev.vinylZones.filter((z) => z.id !== `zone-${area}`);
        // Update primary area to first remaining zone's area, or clear
        const firstRemaining = filtered[0];
        const newArea = firstRemaining ? firstRemaining.id.replace("zone-", "") : "";
        return { ...prev, area: newArea as any, vinylZones: filtered };
      }

      // Toggle on: add a new zone for this area
      const { w, h } = getDimsForArea(prev.make, prev.model, prev.year, area);
      const newZone = {
        id: `zone-${area}`,
        label: locationLabel,
        x: 10, y: 10, width: 80, height: 80,
        widthInches: Math.round(w),
        heightInches: Math.round(h),
        location: `${prev.year || ""} ${prev.make} ${prev.model} — ${locationLabel}`.trim(),
        designPrompt: "",
      };

      const newZones = [...prev.vinylZones, newZone];
      // Set primary area to first zone (used for surface generation view angle)
      const primaryArea = prev.area || area;

      // Fire Google Search if dimensions are 0
      if (w === 0 || h === 0) {
        setTimeout(() => {
          searchDimensionsOnline(prev.make, prev.model, prev.year, area);
        }, 0);
      }

      return { ...prev, area: primaryArea as any, vinylZones: newZones };
    });
  }, [getDimsForArea, searchDimensionsOnline]);

  // Pre-position zones on the generated vehicle photo based on area type
  const AREA_POSITIONS: Record<string, { x: number; y: number; width: number; height: number }> = {
    door:           { x: 15, y: 20, width: 35, height: 55 },
    "side-panel":   { x: 5,  y: 15, width: 90, height: 60 },
    hood:           { x: 20, y: 10, width: 60, height: 50 },
    tailgate:       { x: 15, y: 15, width: 70, height: 60 },
    "rear-window":  { x: 20, y: 10, width: 60, height: 45 },
  };

  // Generate vehicle photo preview + pre-position zone rectangles
  const handleGenerateVehiclePreview = useCallback(async () => {
    if (!surface.make || !surface.model) {
      toast({ title: "Select vehicle first", description: "Choose make and model", variant: "destructive" });
      return;
    }
    setIsGeneratingPreview(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("generate-graphics-pro", {
        body: {
          action: "generate_surface",
          surfaceParams: {
            type: "vehicle",
            year: surface.year,
            make: surface.make,
            model: surface.model,
            area: surface.area || "side-panel",
          },
        },
      });
      if (fnErr || !data?.surfaceUrl) {
        toast({ title: "Preview failed", description: fnErr?.message || "Could not generate vehicle photo", variant: "destructive" });
        return;
      }
      setVehiclePreviewUrl(data.surfaceUrl);

      // Pre-position existing zones on the photo based on area type
      setSurface((prev) => {
        const repositioned = prev.vinylZones.map((zone) => {
          const areaKey = zone.id.replace("zone-", "");
          const pos = AREA_POSITIONS[areaKey];
          if (pos) {
            return { ...zone, x: pos.x, y: pos.y, width: pos.width, height: pos.height };
          }
          return zone;
        });
        return { ...prev, vinylZones: repositioned };
      });

      toast({ title: "Vehicle preview ready", description: "Drag zone boxes to adjust placement" });
    } catch (err: any) {
      toast({ title: "Preview failed", description: err?.message, variant: "destructive" });
    } finally {
      setIsGeneratingPreview(false);
    }
  }, [surface.make, surface.model, surface.year, surface.area, surface.vinylZones, toast]);

  // Validation
  const isSurfaceValid = (): boolean => {
    if (surface.source === 'upload') return surface.uploadedAngles.length > 0;
    if (!surface.type) return false;
    // Vehicle jobs only need the vehicle identity. A drawn vinyl zone box is
    // NOT required — recreated/rebuilt jobs let the AI place the design across
    // the body, and zones can be added later for production cut files. Zone
    // overlays remain optional guidance when the customer does draw them.
    if (surface.type === 'vehicle') return !!(surface.year && surface.make && surface.model);
    if (surface.type === 'wall') return !!(surface.wallTexture || surface.wallPhotoFile);
    if (surface.type === 'glass') return !!(surface.glassType || surface.glassPhotoFile);
    return false;
  };

  // Zones must have real dimensions (no zeros) — but don't block if user hasn't entered them yet
  const hasValidDimensions = (): boolean => {
    if (surface.vinylZones.length === 0) return true;
    // Allow proceeding — dimensions are nice-to-have for production but not required for mockup
    return true;
  };

  const isGraphicValid = (): boolean => {
    // When a reference design is uploaded, the customer must explicitly choose
    // how to use it (match exactly vs. inspiration) before generating — no
    // silent default. Applies across every mode that can carry a VisionBoard.
    if (graphic.visionBoardImages.length > 0 && !graphic.visionBoardIntent) return false;
    // Each mode has its own primary input — the designPrompt minimum only
    // applies to modes that actually use designPrompt as the primary input.
    if (graphic.mode === 'logo') {
      return !!graphic.logoSourceFile;
    }
    if (graphic.mode === 'upload') {
      // User-provided artwork IS the design — no prompt needed
      return graphic.uploadedArtworkFiles.length > 0;
    }
    if (graphic.mode === 'restyle') {
      // Restyle mode uses restylePrompt + source file, not designPrompt
      return !!(graphic.restyleSourceFile && graphic.restylePrompt.trim().length > 3);
    }
    // design / commercial: VisionBoard reference images waive the prompt minimum
    const hasVisionBoard = graphic.visionBoardImages.length > 0;
    if (!hasVisionBoard && graphic.designPrompt.trim().length < 5) return false;
    if (graphic.mode === 'commercial') return graphic.businessName.trim().length > 1;
    return true;
  };

  // Logo mode is a utility — only requires surface if Visualize is toggled on
  const logoSkipsMockup = graphic.mode === 'logo' && !graphic.logoVisualizeEnabled;
  const canProceed = (logoSkipsMockup || isSurfaceValid()) && isGraphicValid() && hasValidDimensions();

  // Reasons the Generate button is disabled — shown inline so the customer
  // doesn't have to guess what's missing.
  const blockingReasons = (): string[] => {
    const reasons: string[] = [];
    if (!logoSkipsMockup && !isSurfaceValid()) {
      if (surface.source === 'upload' && surface.uploadedAngles.length === 0) reasons.push('Upload at least one surface photo');
      else if (!surface.type) reasons.push('Pick a surface type');
      else if (surface.type === 'vehicle') {
        if (!surface.year || !surface.make || !surface.model) reasons.push('Enter vehicle year, make and model');
      }
      else if (surface.type === 'wall' && !surface.wallTexture && !surface.wallPhotoFile) reasons.push('Pick a wall texture or upload a wall photo');
      else if (surface.type === 'glass' && !surface.glassType && !surface.glassPhotoFile) reasons.push('Pick a glass type or upload a storefront photo');
    }
    if (!isGraphicValid()) {
      if (graphic.visionBoardImages.length > 0 && !graphic.visionBoardIntent) reasons.push('Choose how to use your reference: “Recreate Exactly” or “Style Inspiration”');
      else if (graphic.mode === 'logo' && !graphic.logoSourceFile) reasons.push('Upload a logo file');
      else if (graphic.mode === 'upload' && graphic.uploadedArtworkFiles.length === 0) reasons.push('Upload artwork');
      else if (graphic.mode === 'restyle' && (!graphic.restyleSourceFile || graphic.restylePrompt.trim().length <= 3)) reasons.push('Upload restyle source + describe the changes');
      else if (graphic.mode === 'commercial' && graphic.businessName.trim().length <= 1) reasons.push('Enter the business name');
      else if (graphic.visionBoardImages.length === 0 && graphic.designPrompt.trim().length < 5) reasons.push('Describe the design (at least 5 characters) or add a VisionBoard reference');
    }
    return reasons;
  };

  const handleGenerate = useCallback(async () => {
    if (!canProceed) {
      toast({ title: "Incomplete setup", description: "Please complete the required sections", variant: "destructive" });
      return;
    }

    // Logo utility mode (no visualize) — skip mockup, go straight to production
    if (logoSkipsMockup && graphic.logoSourceFile) {
      toast({ title: "Processing logo...", description: "Generating cutpath files" });
      const success = await runLogoUtility(graphic, materialType, markupPercentage);
      if (success) {
        setStep(3);
      }
      return;
    }

    // Standard mockup flow (design / commercial / upload / restyle / logo+visualize)
    const success = await generateMockup(surface, graphic, vinylFinish, renderMode);
    if (success) {
      setStep(2);
    }
  }, [canProceed, toast, generateMockup, surface, graphic, vinylFinish, logoSkipsMockup, materialType, markupPercentage, renderMode]);

  // Day/night toggle on the preview screen — re-renders the same wrap with
  // the opposite lighting so the customer can compare without restarting.
  const handleRenderModeChange = useCallback(async (mode: 'day' | 'night') => {
    setRenderMode(mode);
    const success = await generateMockup(surface, graphic, vinylFinish, mode);
    if (!success) {
      toast({ title: "Re-render failed", description: "Couldn't switch lighting — try again", variant: "destructive" });
    }
  }, [generateMockup, surface, graphic, vinylFinish, toast]);

  const handleApprove = useCallback(async () => {
    if (!mockupResult?.jobId) {
      toast({ title: "Error", description: "No job ID found", variant: "destructive" });
      return;
    }

    // Determine flat artwork source
    let flatUrl: string | null = null;

    if (graphic.mode === "logo" && mockupResult.mockupUrl) {
      // For logo mode, generate flat artwork from the mockup
      toast({ title: "Generating production artwork...", description: "Creating clean flat logo for cutting" });
      flatUrl = await generateFlat(
        `Recreate this logo exactly as clean flat artwork for vinyl cutting. ${graphic.logoRecreatePrompt || "Maintain original design."}`,
        graphic.designStyle || "modern",
        mockupResult.jobId
      );
    } else if (graphic.mode === "upload" && graphic.uploadedArtworkUrls.length > 0) {
      // Use the first uploaded artwork directly
      flatUrl = graphic.uploadedArtworkUrls[0];
    } else if (graphic.mode === "design" || graphic.mode === "commercial") {
      // Generate flat production artwork via Gemini
      toast({ title: "Generating production artwork...", description: "Creating flat artwork for cutting" });
      flatUrl = await generateFlat(
        graphic.mode === "commercial"
          ? `${graphic.businessName} commercial graphics package`
          : graphic.designPrompt,
        graphic.designStyle,
        mockupResult.jobId
      );
    } else if (graphic.mode === "restyle" && graphic.restyleSourceUrl) {
      flatUrl = graphic.restyleSourceUrl;
    }

    if (!flatUrl) {
      // Fall back to mockup URL if no flat artwork available
      flatUrl = mockupResult.mockupUrl;
    }

    // Move to Step 3 and start production
    setStep(3);
    startProduction(mockupResult.jobId, flatUrl, materialType, markupPercentage, lineItems, surface, graphic);
  }, [mockupResult, graphic, surface, generateFlat, startProduction, materialType, markupPercentage, lineItems, toast]);

  const handleRevise = useCallback(async (revisionNote?: string) => {
    if (revisionNote) {
      // Append revision note to the design prompt so Gemini knows what to change
      const revisedGraphic = { ...graphic };
      if (graphic.mode === "design") {
        revisedGraphic.designPrompt = `${graphic.designPrompt}\n\nREVISION REQUEST: ${revisionNote}`;
      } else if (graphic.mode === "commercial") {
        revisedGraphic.businessTagline = `${graphic.businessTagline || ""}\n\nREVISION: ${revisionNote}`.trim();
      } else if (graphic.mode === "restyle") {
        revisedGraphic.restylePrompt = `${graphic.restylePrompt}\n\nREVISION REQUEST: ${revisionNote}`;
      }
      await generateMockup(surface, revisedGraphic, vinylFinish);
    } else {
      await generateMockup(surface, graphic, vinylFinish);
    }
  }, [generateMockup, surface, graphic, vinylFinish]);

  const handleStartOver = useCallback(() => {
    reset();
    setSurface(DEFAULT_SURFACE);
    setGraphic(DEFAULT_GRAPHIC);
    setVinylFinish('glossy');
    setMaterialType('avery');
    setVehiclePreviewUrl(null);
    setIsLookingUpDims(false);
    setShowReview(false);
    setStep(1);
  }, [reset]);

  return (
    <div className="w-full max-w-6xl mx-auto px-2 md:px-4">
      {/* Step Indicator */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {STEPS.map((s, i) => (
          <div key={s.number} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              step === s.number
                ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white border border-transparent'
                : step > s.number
                  ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                  : 'bg-white text-gray-400 border border-gray-200'
            }`}>
              {step > s.number ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <span className="w-4 text-center">{s.number}</span>
              )}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px ${step > s.number ? 'bg-green-500/40' : 'bg-white/10'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Generating overlay */}
      {isGenerating && (
        <Card className="p-8 mb-6 bg-white border-gray-200 text-center ">
          <Loader2 className="w-8 h-8 animate-spin text-fuchsia-400 mx-auto mb-3" />
          <p className="text-white font-medium">{stage || "Processing..."}</p>
          <p className="text-sm text-gray-500 mt-1">This may take up to 2 minutes</p>
        </Card>
      )}

      {/* Error display */}
      {error && !isGenerating && step !== 3 && (
        <Card className="p-4 mb-6 bg-red-500/10 border-red-500/30 text-center">
          <p className="text-red-400 text-sm">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 border-red-500/30 text-red-400 hover:bg-red-500/10"
            onClick={() => handleGenerate()}
          >
            Try Again
          </Button>
        </Card>
      )}

      {/* Step 1: Setup — single-column guided flow */}
      {step === 1 && !isGenerating && !showReview && (
        <div className="space-y-6">

          {/* Section 1: Surface — optional for logo utility mode */}
          <Card className={`bg-white overflow-hidden ${
            logoSkipsMockup
              ? 'border-gray-200 opacity-60'
              : isSurfaceValid() ? 'border-green-500/40' : 'border-gray-200'
          }`}>
            <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
            <div className="px-5 py-3.5 flex items-center gap-3 border-b border-gray-200 bg-white">
              <span className={`w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center shrink-0 ${
                logoSkipsMockup ? 'bg-gray-100 text-gray-400' : isSurfaceValid() ? 'bg-green-500 text-white' : 'bg-gradient-to-br from-[#3b82f6] to-[#ec4899] text-white'
              }`}>
                {logoSkipsMockup ? '—' : isSurfaceValid() ? '✓' : '1'}
              </span>
              <div>
                <h3 className="text-gray-900 font-semibold text-base">
                  {logoSkipsMockup ? 'Surface (Not Needed — Utility Mode)' : 'Choose Your Surface'}
                </h3>
                <p className="text-gray-600 text-sm">
                  {logoSkipsMockup
                    ? 'Logo utility mode skips the mockup step — toggle on "Visualize on Client\'s Surface" below to enable this'
                    : 'Upload a photo, select vehicle make & model, or pick a wall/glass/surface type'}
                </p>
              </div>
            </div>
            <div className="p-5">
              <SurfaceSelection
                surface={surface}
                onChange={handleSurfaceChange}
                makes={vehicleMakes}
                models={vehicleModels}
                onMakeChange={handleMakeChange}
                onAreaToggle={handleAreaToggle}
                onLookupDimensions={handleLookupDimensions}
                isLookingUpDims={isLookingUpDims}
                vehiclePreviewUrl={vehiclePreviewUrl}
                isGeneratingPreview={isGeneratingPreview}
                onGeneratePreview={handleGenerateVehiclePreview}
              />
            </div>
          </Card>

          {/* Section 2: Tell AI What You Want */}
          <Card className={`bg-white overflow-hidden ${isGraphicValid() ? 'border-green-500/40' : !isSurfaceValid() ? 'border-gray-200' : 'border-gray-200'}`}>
            <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
            <div className="px-5 py-3.5 flex items-center gap-3 border-b border-gray-200 bg-white">
              <span className={`w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center shrink-0 ${isGraphicValid() ? 'bg-green-500 text-white' : 'bg-gradient-to-br from-[#3b82f6] to-[#ec4899] text-white'}`}>
                {isGraphicValid() ? '✓' : '2'}
              </span>
              <div>
                <h3 className="text-gray-900 font-semibold text-base">Describe Your Cut Contour Graphic</h3>
                <p className="text-gray-600 text-sm">Pick a mode below — Commercial for business lettering, Design for custom cut contour art</p>
              </div>
            </div>
            <div className="p-5">
              <GraphicInput
                graphic={graphic}
                onChange={handleGraphicChange}
              />
            </div>
          </Card>

          {/* Section 3: Vinyl Finish */}
          <Card className="bg-white border-green-500/40 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
            <div className="px-5 py-3.5 flex items-center gap-3 border-b border-gray-200 bg-white">
              <span className="w-7 h-7 rounded-full bg-green-500 text-white text-sm font-bold flex items-center justify-center shrink-0">✓</span>
              <div>
                <h3 className="text-gray-900 font-semibold text-base">Cut Vinyl Finish</h3>
                <p className="text-gray-600 text-sm">Choose the material finish for your cut contour vinyl</p>
              </div>
            </div>
            <div className="p-5">
              <VinylFinishSelector value={vinylFinish} onChange={setVinylFinish} />
            </div>
          </Card>

          {/* Generate Button */}
          <div className="flex flex-col items-center gap-2">
            <Button
              onClick={() => {
                if (!isSurfaceValid() || !isGraphicValid()) {
                  toast({ title: "Incomplete setup", description: blockingReasons().join(' • ') || "Please complete all sections above", variant: "destructive" });
                  return;
                }
                handleGenerate();
              }}
              disabled={isGenerating}
              className={`bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:brightness-110 text-white font-semibold px-10 py-3 text-base gap-2 rounded-lg shadow-lg shadow-purple-500/20 ${!canProceed ? 'opacity-60' : ''}`}
            >
              {logoSkipsMockup ? 'Generate Cutpath Files' : `Generate Cut Contour${surface.type === 'wall' ? ' Graphic on Wall' : surface.type === 'vehicle' ? ' Graphic on Vehicle' : surface.type === 'glass' ? ' Graphic on Window' : ''}`}
              <ArrowRight className="w-5 h-5" />
            </Button>
            {!canProceed && !isGenerating && blockingReasons().length > 0 && (
              <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 max-w-md">
                <span className="font-semibold">Still needed:</span>
                <ul className="mt-1 list-disc list-inside space-y-0.5">
                  {blockingReasons().map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 2 && !isGenerating && mockupResult && (
        <div className="space-y-4">
          <MockupPreview
            mockupUrl={mockupResult.mockupUrl}
            jobId={mockupResult.jobId}
            angles={mockupResult.angles}
            isGenerating={isGenerating}
            onApprove={handleApprove}
            onRevise={handleRevise}
            onStartOver={handleStartOver}
            renderMode={renderMode}
            onRenderModeChange={handleRenderModeChange}
          />

          {/* Inline auto-filled estimate — surfaces sq ft + shop price right
              under the mockup so the rep doesn't have to open QuickQuote to
              see the number. Values are seeded from the drawn vinyl zones
              and editable, so the rep can override on the spot. */}
          <InlineEstimateCard
            vinylZones={
              surface.source === 'upload'
                ? surface.uploadedAngles.flatMap((a) => a.zones)
                : surface.vinylZones
            }
            materialType={materialType}
            markupPercentage={markupPercentage}
            onMarkupChange={setMarkupPercentage}
            onOpenQuickQuote={() => setShowQuickQuote(true)}
          />

          {/* Studio-only Production Pack — runs vectorize-it on the flat
              mockup, persists the cut SVG + 'complete' status on the SAME
              graphics_pro_jobs row this job lives on, then opens the
              graphics-pro-native Production Output (step 3) which reads
              graphics_pro_jobs and surfaces the cut file for download.
              (It does NOT route to /productionflow — that page resolves
              panelizer_jobs / designiq / colorpro ids, never
              graphics_pro_jobs, so a studio job id 404'd there.) */}
          {surface.type === 'studio' && (
            <Card className="bg-white border-gray-200 p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shrink-0">
                  <Scissors className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-gray-900">Cut Contour Production Pack</h3>
                  <p className="text-xs text-gray-600 mt-0.5 leading-snug">
                    Step 1: vectorize → clean cut-ready SVG with a <span className="font-semibold">CutContour</span> spot color (Roland / Graphtec / Summa standard). Step 2: your <span className="font-semibold">Production Files</span> open with the cut file ready to download.
                  </p>
                  {surface.vinylSubstrate === 'printed' && (surface.bleedInches ?? 0) > 0 && (
                    <p className="text-[11px] text-gray-500 mt-1">
                      Print bleed: <span className="font-semibold text-gray-700">{surface.bleedInches === 0.25 ? '1/4"' : '1/8"'}</span> baked into the print layer; cut path stays exact. Output uses WPW's <span className="font-mono">CutContour</span> spot (100% magenta CMYK, 0.25pt hairline) on a 3-layer file: cut · art · black bleed offset.
                    </p>
                  )}
                  {/* Small-letters / intricate-detail flag — WPW spec says
                      anything under 2" needs manual review before going to
                      the plotter. Surfacing the warning here gives the
                      customer a heads-up before they generate the pack. */}
                  {(() => {
                    const tinyZones = surface.vinylZones.filter(
                      (z) => z.heightInches > 0 && z.heightInches < 2
                    );
                    if (tinyZones.length === 0) return null;
                    return (
                      <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                        ⚠ <span className="font-semibold">Letters / details under 2"</span> in {tinyZones.length === 1 ? tinyZones[0].label : `${tinyZones.length} zones`} — WPW needs to manually review intricate cuts at this size. The pack flags these for QC review in your Production Files.
                      </div>
                    );
                  })()}
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <Button
                      type="button"
                      onClick={async () => {
                        if (!mockupResult?.mockupUrl || !mockupResult?.jobId) return;
                        setStudioPackSvgUrl(null);
                        const url = await generateStudioProductionPack(
                          mockupResult.mockupUrl,
                          mockupResult.jobId,
                          graphic.designPrompt || graphic.businessName || "Studio cut graphic",
                          {
                            vinylSubstrate: surface.vinylSubstrate,
                            bleedInches: surface.bleedInches,
                            vinylZones: surface.vinylZones,
                          },
                        );
                        if (url) setStudioPackSvgUrl(url);
                      }}
                      disabled={isGenerating || !!studioPackSvgUrl}
                      className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:brightness-110 border-0 disabled:opacity-60"
                    >
                      {isGenerating ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {stage || "Vectorizing..."}</>
                      ) : studioPackSvgUrl ? (
                        <><CheckCircle2 className="w-4 h-4 mr-2" /> Production Pack Ordered</>
                      ) : (
                        <><Scissors className="w-4 h-4 mr-2" /> Order Production Pack</>
                      )}
                    </Button>
                    {studioPackSvgUrl && (
                      <>
                        <a
                          href={studioPackSvgUrl}
                          target="_blank"
                          rel="noreferrer"
                          download
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50"
                        >
                          <Download className="w-4 h-4" /> Download SVG
                        </a>
                        <button
                          type="button"
                          onClick={() => setStep(3)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white text-sm font-semibold hover:brightness-110"
                        >
                          <FileBox className="w-4 h-4" /> 2. Open Production Files
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Pipeline step indicator — shows the customer where the
                      job currently sits so the handoff to the Production
                      Files view feels intentional, not a dead-end download. */}
                  <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px] text-gray-500">
                    <li className={studioPackSvgUrl ? 'text-green-600 font-semibold' : 'font-semibold text-gray-700'}>
                      {studioPackSvgUrl ? '✓' : '①'} Mockup &amp; vectorize
                    </li>
                    <li className="text-gray-300">→</li>
                    <li className={studioPackSvgUrl ? 'font-semibold text-gray-700' : ''}>
                      ② Production files &amp; pricing
                    </li>
                    <li className="text-gray-300">→</li>
                    <li>③ Cut files + bleed export</li>
                    <li className="text-gray-300">→</li>
                    <li>④ Order &amp; ship</li>
                  </ol>
                </div>
              </div>
            </Card>
          )}

          {/* Production proofs — every surface (vehicle / wall / window) gets the
              dimensioned Cut Graphics Proof + 2D Production Proof. Studio angles
              are vehicle-only (a wall/window has no driver-side/hood/roof). */}
          {(surface.type === 'vehicle' || surface.type === 'wall' || surface.type === 'glass') && (
            <Card className="bg-white border-gray-200 p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shrink-0">
                  <Ruler className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-gray-900">Production proofs</h3>
                  <p className="text-xs text-gray-600 mt-0.5 leading-snug">
                    Dimensioned cut graphics proof (W×H + letter height + total sq ft) and the 2D production proof.
                    {surface.type === 'vehicle' && ' Studio angles fill in the views your uploaded photos don\'t cover.'}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {surface.type === 'vehicle' && (
                    <Button
                      type="button"
                      onClick={() => generateStudioAngles(surface, graphic)}
                      disabled={isGeneratingStudioAngles}
                      className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:brightness-110 border-0 disabled:opacity-60"
                    >
                      {isGeneratingStudioAngles ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Building studio angles…</>
                      ) : (
                        <><Camera className="w-4 h-4 mr-2" /> Generate studio angles</>
                      )}
                    </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleBuildCutProof}
                      disabled={isCutProofGenerating}
                      className="border-blue-500/40 hover:border-blue-500 hover:bg-blue-500/5"
                    >
                      {isCutProofGenerating ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Speccing…</>
                      ) : (
                        <><Ruler className="w-4 h-4 mr-2" /> Cut Graphics Proof</>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleGenerate2DProof}
                      disabled={isGenerating2DProof}
                      className="border-blue-500/40 hover:border-blue-500 hover:bg-blue-500/5"
                    >
                      {isGenerating2DProof ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Building proof…</>
                      ) : (
                        <><FileBox className="w-4 h-4 mr-2" /> 2D Production Proof</>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleBuildCutPathProof}
                      disabled={isGeneratingCutPath}
                      className="border-blue-500/40 hover:border-blue-500 hover:bg-blue-500/5"
                    >
                      {isGeneratingCutPath ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Building cut path…</>
                      ) : (
                        <><Scissors className="w-4 h-4 mr-2" /> Cut Path Proof (PDF)</>
                      )}
                    </Button>
                  </div>
                  {cutPathPdfUrl && (
                    <div className="mt-3 rounded-md border border-fuchsia-200 bg-fuchsia-50/40 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-fuchsia-900 mb-1">2D Cut-Path Proof — print-ready</p>
                      <p className="text-[11px] text-gray-600 mb-1.5">100% magenta CutContour cut lines · 0.5″ bleed · registration marks.</p>
                      <a href={cutPathPdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-fuchsia-700 hover:underline">
                        <Download className="w-3.5 h-3.5" /> Open / download CutContour PDF
                      </a>
                    </div>
                  )}
                  {twoDProofUrl && (
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">2D Production Proof</p>
                      <a href={twoDProofUrl} target="_blank" rel="noreferrer" className="block rounded-lg border border-gray-200 overflow-hidden">
                        <img src={twoDProofUrl} alt="2D Production Proof" className="w-full h-auto bg-white" />
                      </a>
                      <a href={twoDProofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-blue-600 hover:underline">
                        <Download className="w-3.5 h-3.5" /> Open / download full proof
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* MyVehiclePro — brand differentiator: apply this graphic to a customer's actual vehicle photo */}
          <MyVehicleProInline
            modeType="graphicspro"
            finishType={vinylFinish}
            vehicleYear={surface.year}
            vehicleMake={surface.make}
            vehicleModel={surface.model}
            renderUrl={mockupResult.mockupUrl}
            designName="Graphic"
          />

          {/* ApprovePro — Send for Client Approval */}
          <Button
            onClick={() => setShowSendForApproval(true)}
            variant="outline"
            className="w-full gap-2 border-blue-500/40 hover:border-blue-500 hover:bg-blue-500/5"
          >
            <ClipboardSignature className="w-4 h-4" />
            Send for Client Approval
          </Button>


          {/* Material Selection — shown before approve */}
          <Card className="p-4 bg-white border-gray-200 ">
            <h4 className="text-sm font-medium text-gray-500 mb-2">Material</h4>
            <div className="flex gap-3">
              <button
                onClick={() => setMaterialType("avery")}
                className={`flex-1 p-3 rounded-lg border transition-colors text-left ${
                  materialType === "avery"
                    ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white"
                    : "border-gray-200 hover:border-gray-200 bg-white"
                }`}
              >
                <span className={`text-sm font-medium block ${materialType === "avery" ? "text-blue-600" : "text-gray-700"}`}>
                  Avery Cut Contour
                </span>
                <span className="text-xs text-gray-400">$6.32/sq ft wholesale</span>
              </button>
              <button
                onClick={() => setMaterialType("3m")}
                className={`flex-1 p-3 rounded-lg border transition-colors text-left ${
                  materialType === "3m"
                    ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] border-transparent text-white"
                    : "border-gray-200 hover:border-gray-200 bg-white"
                }`}
              >
                <span className={`text-sm font-medium block ${materialType === "3m" ? "text-blue-600" : "text-gray-700"}`}>
                  3M Cut Contour
                </span>
                <span className="text-xs text-gray-400">$6.92/sq ft wholesale</span>
              </button>
            </div>
          </Card>

          {/* Live Pricing — moved to QuickQuote × GraphicsPro sidebar
              (opens via the persistent floating pill, bottom-right).
              Same component, same logic, same line items — just hosted
              alongside the design instead of stacked under it. */}

          {/* Shop Settings Toggle */}
          <div className="flex justify-center">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-xs text-gray-400 hover:text-fuchsia-400 transition-colors"
            >
              {showSettings ? "Hide shop settings" : "Configure shop markup & pricing"}
            </button>
          </div>
          {showSettings && (
            <ShopMarkupConfig
              onSaved={(m) => setMarkupPercentage(m)}
            />
          )}
        </div>
      )}

      {/* Step 3: Production Output */}
      {step === 3 && mockupResult?.jobId && (
        <ProductionOutput
          jobId={mockupResult.jobId}
          onBack={() => setStep(2)}
          onStartOver={handleStartOver}
        />
      )}

      {/* Cut Graphics Proof — dimensioned production sheet */}
      <Dialog open={cutProofOpen} onOpenChange={setCutProofOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-4xl max-h-[92vh] overflow-y-auto p-0">
          <CutGraphicsProofSheet
            proof={cutProof}
            isGenerating={isCutProofGenerating}
            onRegenerate={handleBuildCutProof}
            totalSqFt={cutProofSqFt}
          />
        </DialogContent>
      </Dialog>

      {/* ApprovePro — Phase 8A */}
      <SendForApprovalDialog
        open={showSendForApproval}
        onOpenChange={setShowSendForApproval}
        context={{
          visualizationId: mockupResult?.jobId,
          renderUrls: mockupResult?.mockupUrl ? { hero: mockupResult.mockupUrl } : {},
          vehicleYear: surface.year,
          vehicleMake: surface.make,
          vehicleModel: surface.model,
          designName: "Cut Vinyl Graphic",
          finishType: vinylFinish,
          defaultMode: "revision_loop",
        }}
      />

      {/* Persistent floating QuickQuote pill — single floating CTA in the
          bottom-right corner. Previously there were TWO floating pills
          (this one + an EstimatorDrawer "Estimator" pill); the duplicate
          was hiding/competing with this button so customers reported
          "no pill to load the quickquote tool". The Estimator drawer is
          still reachable from inside the QuickQuote panel itself.
          Larger size + brighter glow so the rep spots it instantly. */}
      {!showQuickQuote && (
        <button
          type="button"
          onClick={() => setShowQuickQuote(true)}
          aria-label="Open QuickQuote"
          className="fixed right-4 sm:right-6 bottom-6 z-50 flex items-center gap-2 rounded-full px-5 sm:px-6 py-3.5 text-sm sm:text-base font-bold text-white shadow-[0_10px_30px_rgba(168,85,247,0.6)] hover:scale-105 active:scale-95 transition-transform animate-pulse-glow"
          style={{
            background: "linear-gradient(135deg, #2563eb, #a855f7)",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.875rem)",
          }}
        >
          <Calculator className="w-5 h-5" />
          <span>QuickQuote</span>
        </button>
      )}

      {/* QuickQuote × GraphicsPro side panel — wraps the existing
          PricingEstimator. Pricing logic, line items, markup, vinyl
          zones — all unchanged. */}
      <QuickQuoteSidePanel
        open={showQuickQuote}
        onClose={() => setShowQuickQuote(false)}
        toolName="GraphicsPro"
        theme="light"
      >
        <PricingEstimator
          materialType={materialType}
          markupPercentage={markupPercentage}
          onMarkupChange={setMarkupPercentage}
          onLineItemsChange={setLineItems}
          vinylZones={
            surface.source === 'upload'
              ? surface.uploadedAngles.flatMap((a) => a.zones)
              : surface.vinylZones
          }
          theme="light"
        />
      </QuickQuoteSidePanel>
    </div>
  );
}
