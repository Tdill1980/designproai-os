import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { useToast } from "@/hooks/use-toast";
import { composeZoneOverlay } from "@/lib/composeZoneOverlay";
import type {
  SurfaceSelections,
  GraphicInput,
  VinylFinish,
  VinylZone,
} from "@/components/graphicspro-v1/types";

interface MockupAngle {
  angleId: string;
  angleLabel: string;
  mockupUrl: string;
  jobId: string | null;
  // The reference image the AI was given: the surface photo with the user's
  // drawn zones burned in (cyan rectangles + labels). Surfaced in the result
  // view so the user can compare zones-drawn ↔ AI-rendered side by side.
  zoneOverlayUrl?: string | null;
  // The clean "before" surface — original render or uploaded photo, no zones
  // drawn on top. Shown as the persistent before/after reference on the
  // preview screen so the customer always sees what they started from.
  surfaceUrl?: string | null;
  zones?: VinylZone[];
}

interface MockupResult {
  // Primary mockup (first angle for upload mode, or the only mockup for build mode).
  // Existing consumers (handleApprove, ProductionOutput) keep reading mockupUrl/jobId.
  mockupUrl: string;
  jobId: string | null;
  // All angles that were rendered. Length === 1 in single-image / build mode.
  angles: MockupAngle[];
}

// supabase-js surfaces an edge function's non-2xx as a generic
// "Edge Function returned a non-2xx status code" and hides the real reason in
// error.context (the raw Response). Pull the function's JSON { error } out so
// the customer/toast sees WHAT failed (e.g. "Gemini returned no image",
// "Authentication required") instead of an opaque "Edge fail".
async function readEdgeError(err: any, fallback: string): Promise<string> {
  try {
    const ctx = err?.context;
    if (ctx && typeof ctx.clone === "function") {
      const body = await ctx.clone().json().catch(() => null);
      if (body?.error) return String(body.error);
    }
  } catch {
    /* ignore — fall back to the generic message below */
  }
  return err?.message || fallback;
}


export function useGraphicsProV1Logic() {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSurfaceUrl, setGeneratedSurfaceUrl] = useState<string | null>(null);
  const [mockupResult, setMockupResult] = useState<MockupResult | null>(null);
  const [stage, setStage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingStudioAngles, setIsGeneratingStudioAngles] = useState(false);

  // Upload a file to Supabase storage and return its public URL
  const uploadFile = useCallback(async (file: File, folder: string): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const ext = file.name.split(".").pop() || "png";
    const path = `renders/${user.id}/GraphicsProV1/${folder}/${Date.now()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("wrap-files")
      .upload(path, file, { contentType: file.type, upsert: true });

    if (uploadErr) {
      console.error("Upload error:", uploadErr);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
    return publicUrl;
  }, []);

  // Upload all pending files and return URLs
  const uploadAllFiles = useCallback(async (
    surface: SurfaceSelections,
    graphic: GraphicInput
  ): Promise<{
    surfaceImageUrl: string | null;
    uploadedAngleUrls: { id: string; url: string }[];
    artworkUrls: string[];
    logoUrl: string | null;
    restyleUrl: string | null;
    logoSourceUrl: string | null;
    visionBoardUrls: string[];
  }> => {
    let surfaceImageUrl: string | null = null;
    const uploadedAngleUrls: { id: string; url: string }[] = [];
    const artworkUrls: string[] = [];
    let logoUrl: string | null = null;
    let restyleUrl: string | null = null;
    let logoSourceUrl: string | null = null;

    // Upload every uploaded angle. Reuse a previously stored URL if present.
    if (surface.source === "upload") {
      for (const angle of surface.uploadedAngles) {
        let url = angle.storageUrl ?? null;
        if (!url && angle.file) {
          url = await uploadFile(angle.file, "surfaces");
        }
        if (url) uploadedAngleUrls.push({ id: angle.id, url });
      }
      // Keep surfaceImageUrl populated for any caller still reading it (job row).
      surfaceImageUrl = uploadedAngleUrls[0]?.url ?? null;
    }

    // Upload wall photo (from Build Surface → Wall → photo upload)
    if (surface.type === "wall" && surface.wallPhotoFile) {
      surfaceImageUrl = await uploadFile(surface.wallPhotoFile, "wall-photos");
    }

    // Upload storefront/glass photo (from Build Surface → Glass → photo upload)
    if (surface.type === "glass" && surface.glassPhotoFile) {
      surfaceImageUrl = await uploadFile(surface.glassPhotoFile, "glass-photos");
    }

    // Upload artwork files
    for (const file of graphic.uploadedArtworkFiles) {
      const url = await uploadFile(file, "artwork");
      if (url) artworkUrls.push(url);
    }

    // Upload business logo
    if (graphic.businessLogoFile) {
      logoUrl = await uploadFile(graphic.businessLogoFile, "logos");
    }

    // Upload restyle source
    if (graphic.restyleSourceFile) {
      restyleUrl = await uploadFile(graphic.restyleSourceFile, "restyle-sources");
    }

    // Upload logo source (logo recreation mode)
    if (graphic.logoSourceFile) {
      logoSourceUrl = await uploadFile(graphic.logoSourceFile, "logo-sources");
    }

    // VisionBoardIQ images are already uploaded by the VisionBoardUploader component
    const visionBoardUrls = graphic.visionBoardImages.map((img) => img.storageUrl);

    return { surfaceImageUrl, uploadedAngleUrls, artworkUrls, logoUrl, restyleUrl, logoSourceUrl, visionBoardUrls };
  }, [uploadFile]);

  // Main generate function. `renderMode` lets the caller force day or
  // night lighting on the mockup (defaults to 'day'). For glass surfaces
  // the backend has full day/night/headlights branching; for vehicles and
  // walls the backend appends a night-lighting paragraph when
  // renderMode === 'night' so the customer can compare the same wrap
  // under different lighting without re-doing the whole flow.
  const generateMockup = useCallback(async (
    surface: SurfaceSelections,
    graphic: GraphicInput,
    vinylFinish: VinylFinish,
    renderMode: 'day' | 'night' = 'day',
  ): Promise<boolean> => {
    setIsGenerating(true);
    setError(null);
    setMockupResult(null);

    try {
      // Step 1: Upload files
      setStage("Uploading files...");
      const { surfaceImageUrl, uploadedAngleUrls, artworkUrls, logoUrl, restyleUrl, logoSourceUrl, visionBoardUrls } = await uploadAllFiles(surface, graphic);

      let finalSurfaceUrl = surfaceImageUrl;

      // Step 2: Generate surface if needed (Build Surface mode)
      // Skip generation if user uploaded their own wall photo
      if (surface.source === "generated" && !surfaceImageUrl) {
        setStage("Generating surface...");
        const { data: surfRes, error: surfErr } = await supabase.functions.invoke(
          "generate-graphics-pro",
          {
            body: {
              action: "generate_surface",
              surfaceParams: {
                type: surface.type,
                year: surface.year,
                make: surface.make,
                model: surface.model,
                area: surface.area,
                indoor: surface.indoor,
                wallTexture: surface.wallTexture,
                glassType: surface.glassType,
                glassMount: surface.glassMount,
                glassTint: surface.glassTint,
                surfaceCategory: surface.surfaceCategory,
                floorType: surface.floorType,
                signageType: surface.signageType,
              },
            },
          }
        );

        if (surfErr || !surfRes?.surfaceUrl) {
          const detail = surfRes?.error || (surfErr ? await readEdgeError(surfErr, "Surface generation failed") : "Surface generation failed");
          throw new Error(detail);
        }

        finalSurfaceUrl = surfRes.surfaceUrl;
        setGeneratedSurfaceUrl(finalSurfaceUrl);
      }

      // Build the per-angle render queue. Upload mode renders one mockup per
      // uploaded angle (with that angle's zones). Other modes render one.
      const renderQueue: { angleId: string; angleLabel: string; surfaceUrl: string; zones: typeof surface.vinylZones }[] = [];
      if (surface.source === "upload" && uploadedAngleUrls.length > 0) {
        for (const a of surface.uploadedAngles) {
          const url = uploadedAngleUrls.find((u) => u.id === a.id)?.url;
          if (!url) continue;
          renderQueue.push({
            angleId: a.id,
            angleLabel: a.angleLabel || "Angle",
            surfaceUrl: url,
            zones: a.zones,
          });
        }
      } else {
        renderQueue.push({
          angleId: "primary",
          angleLabel: "Primary",
          surfaceUrl: finalSurfaceUrl || "",
          zones: surface.vinylZones,
        });
      }

      // Step 3: Generate mockup(s)
      const renderedAngles: MockupAngle[] = [];
      for (let i = 0; i < renderQueue.length; i++) {
        const item = renderQueue[i];
        setStage(
          renderQueue.length > 1
            ? `Rendering ${item.angleLabel} (${i + 1}/${renderQueue.length})…`
            : "Rendering mockup..."
        );

        // Burn the user's drawn zones into the surface photo so Gemini can
        // actually SEE the bounding boxes (not just read text coordinates).
        // The cyan-outlined image is also returned to the UI so the customer
        // can compare zones-drawn ↔ AI-rendered side by side.
        let zoneOverlayUrl: string | null = null;
        if (item.zones && item.zones.length > 0 && item.surfaceUrl) {
          try {
            const overlayBlob = await composeZoneOverlay(item.surfaceUrl, item.zones);
            if (overlayBlob) {
              const overlayFile = new File(
                [overlayBlob],
                `zone-overlay-${item.angleId}-${Date.now()}.png`,
                { type: "image/png" },
              );
              zoneOverlayUrl = await uploadFile(overlayFile, "zone-overlays");
            }
          } catch (err) {
            console.warn("[GraphicsPro] zone overlay compose failed:", err);
          }
        }

        const { data: mockRes, error: mockErr } = await supabase.functions.invoke(
          "generate-graphics-pro",
          {
            body: {
              action: "generate_mockup",
              surfaceImageUrl: item.surfaceUrl,
              surfaceImageWithZonesUrl: zoneOverlayUrl,
              surfaceType: surface.type || "vehicle",
              // Forward the vehicle so the job stores it (otherwise the row is
              // created with a null vehicle and shows as "Unknown Vehicle" in
              // RevisionStudio, which also blocks downstream angle generation).
              vehicleYear: surface.year || null,
              vehicleMake: surface.make || null,
              vehicleModel: surface.model || null,
              surfaceTexture: surface.wallTexture || surface.paintFinish || "",
              hasUserPhoto: !!(surface.type === "wall" && surface.wallPhotoFile) || !!(surface.type === "glass" && surface.glassPhotoFile) || surface.source === "upload",
              vinylFinish,
              graphicMode: graphic.mode,
              designPrompt: graphic.designPrompt,
              designStyle: graphic.designStyle,
              businessName: graphic.businessName,
              businessPhone: graphic.businessPhone,
              businessWebsite: graphic.businessWebsite,
              businessIndustry: graphic.businessIndustry,
              businessTagline: graphic.businessTagline,
              restylePrompt: graphic.restylePrompt,
              businessFont: graphic.businessFont,
              businessCopyText: graphic.businessCopyText,
              uploadedArtworkUrls: artworkUrls,
              businessLogoUrl: logoUrl,
              generateLogo: graphic.generateLogo,
              restyleSourceUrl: restyleUrl,
              logoSourceUrl,
              logoRecreatePrompt: graphic.logoRecreatePrompt,
              visionBoardUrls,
              visionBoardIntent: graphic.visionBoardIntent,
              vinylZones: item.zones.length > 0 ? item.zones : undefined,
              angleLabel: item.angleLabel,
              // Production method drives the AI's creative behavior:
              //   'printed' (Print & Cut) → full-color print, gradients,
              //     photo-real, unlimited colors
              //   'cut' (Manufacture Film Cut) → flat solid colors only,
              //     2–4 layers, render real manufactured film SKUs
              //     (chrome, brushed metallic, color-shift, carbon
              //     fiber, etc.) as physical materials
              // Forwarded for every surface so the toggle at the top of
              // Step 1 actually changes the render, not just the
              // production paperwork.
              vinylSubstrate: surface.vinylSubstrate || 'cut',
              // Window/Storefront-only render mode. Defaults to 'day'.
              ...(surface.type === 'glass' ? {
                renderMode: renderMode || surface.glassRenderMode || 'day',
              } : {}),
              // Day/night override for vehicle, wall, and other non-glass
              // surfaces. Backend appends a lighting paragraph when this
              // is 'night' so the same wrap can be re-rendered after-dark.
              ...(surface.type !== 'glass' ? { renderMode } : {}),
            },
          }
        );

        if (mockErr || !mockRes?.mockupUrl) {
          const detail = mockRes?.error || (mockErr ? await readEdgeError(mockErr, `${item.angleLabel} mockup failed`) : `${item.angleLabel} mockup failed`);
          throw new Error(detail);
        }

        renderedAngles.push({
          angleId: item.angleId,
          angleLabel: item.angleLabel,
          mockupUrl: mockRes.mockupUrl,
          jobId: mockRes.jobId ?? null,
          zoneOverlayUrl,
          surfaceUrl: item.surfaceUrl,
          zones: item.zones,
        });
      }

      const primary = renderedAngles[0];
      setMockupResult({
        mockupUrl: primary.mockupUrl,
        jobId: primary.jobId,
        angles: renderedAngles,
      });

      setStage("");
      toast({
        title: "Mockup ready",
        description: renderedAngles.length > 1
          ? `${renderedAngles.length} angle mockups generated`
          : "Your cut vinyl mockup has been generated",
      });
      return true;

    } catch (err: any) {
      console.error("GraphicsPro V1 error:", err);
      setError(err?.message || "Generation failed");
      setStage("");
      toast({
        title: "Generation failed",
        description: err?.message || "Please try again",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsGenerating(false);
    }
  }, [uploadAllFiles, toast]);

  // Kick off production pipeline
  const startProduction = useCallback(async (
    jobId: string,
    flatArtworkUrl: string,
    materialType: "avery" | "3m" = "avery",
    markupPercentage: number = 100,
    lineItems?: Array<{ label: string; width: number; height: number; qty: number; laminated: boolean }>,
    surfaceData?: Record<string, any>,
    graphicData?: Record<string, any>,
  ): Promise<boolean> => {
    try {
      const { data, error: prodErr } = await supabase.functions.invoke(
        "generate-graphics-pro",
        {
          body: {
            action: "run_production",
            jobId,
            flatArtworkUrl,
            materialType,
            markupPercentage,
            lineItems,
            surface: surfaceData,
            graphic: graphicData,
          },
        }
      );

      if (prodErr || !data?.success) {
        throw new Error(data?.error || prodErr?.message || "Production pipeline failed");
      }

      toast({ title: "Production complete", description: "Your files are ready for download" });
      return true;
    } catch (err: any) {
      console.error("Production pipeline error:", err);
      toast({ title: "Production failed", description: err?.message, variant: "destructive" });
      return false;
    }
  }, [toast]);

  // Logo utility — skip mockup, upload logo and run production directly
  const runLogoUtility = useCallback(async (
    graphic: GraphicInput,
    materialType: "avery" | "3m" = "avery",
    markupPercentage: number = 100,
  ): Promise<boolean> => {
    setIsGenerating(true);
    setError(null);
    setMockupResult(null);

    try {
      if (!graphic.logoSourceFile) {
        throw new Error("No logo file uploaded");
      }

      setStage("Uploading logo...");
      const logoUrl = await uploadFile(graphic.logoSourceFile, "logo-sources");
      if (!logoUrl) throw new Error("Failed to upload logo");

      setStage("Creating job...");
      const { data, error: jobErr } = await supabase.functions.invoke(
        "generate-graphics-pro",
        {
          body: {
            action: "create_logo_job",
            logoUrl,
            logoTargetWidth: graphic.logoTargetWidth,
            logoTargetHeight: graphic.logoTargetHeight,
            logoRecreatePrompt: graphic.logoRecreatePrompt,
          },
        }
      );

      if (jobErr || !data?.jobId) {
        throw new Error(data?.error || jobErr?.message || "Failed to create logo job");
      }

      setMockupResult({
        mockupUrl: logoUrl,
        jobId: data.jobId,
        angles: [{ angleId: "logo", angleLabel: "Logo", mockupUrl: logoUrl, jobId: data.jobId }],
      });

      // Compute line item from target dimensions if provided
      const lineItems = graphic.logoTargetWidth > 0
        ? [{
            label: "Logo",
            width: graphic.logoTargetWidth,
            height: graphic.logoTargetHeight || graphic.logoTargetWidth,
            qty: 1,
            laminated: false,
          }]
        : undefined;

      setStage("Running production pipeline...");
      const prodSuccess = await startProduction(
        data.jobId,
        logoUrl,
        materialType,
        markupPercentage,
        lineItems,
        undefined,
        { designPrompt: graphic.logoRecreatePrompt || "Logo" },
      );

      setStage("");
      return prodSuccess;
    } catch (err: any) {
      console.error("Logo utility error:", err);
      setError(err?.message || "Logo processing failed");
      setStage("");
      toast({
        title: "Logo processing failed",
        description: err?.message || "Please try again",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsGenerating(false);
    }
  }, [uploadFile, toast, startProduction]);

  // Generate flat artwork (for design/commercial modes)
  const generateFlat = useCallback(async (
    designPrompt: string,
    designStyle: string,
    jobId: string | null
  ): Promise<string | null> => {
    try {
      const { data, error: flatErr } = await supabase.functions.invoke(
        "generate-graphics-pro",
        {
          body: {
            action: "generate_flat",
            designPrompt,
            designStyle,
            jobId,
          },
        }
      );

      if (flatErr || !data?.flatUrl) {
        throw new Error(data?.error || flatErr?.message || "Flat artwork generation failed");
      }

      return data.flatUrl;
    } catch (err: any) {
      console.error("Flat generation error:", err);
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setMockupResult(null);
    setGeneratedSurfaceUrl(null);
    setError(null);
    setStage("");
  }, []);

  /**
   * Studio Production Pack — for the 'studio' surface type only.
   *
   * The vehicle / wall / glass pipelines have to panelize a body wrap,
   * stamp GENIE overlays, render multi-view bleed proofs, etc. Studio
   * is a flat artboard, so the production pack is much lighter:
   *
   *   1. Take the final flat mockup PNG that came out of generateMockup
   *   2. Send it to vectorize-it → clean cut-ready SVG
   *   3. Save the SVG URL on the graphics_pro_jobs row (the table this job
   *      lives on) and flip status → 'complete' so ProductionOutput reveals
   *      the download. No panelizer / GENIE step needed.
   *
   * Returns the SVG URL on success so the caller can navigate / link.
   */
  const generateStudioProductionPack = useCallback(async (
    mockupUrl: string,
    jobId: string,
    designLabel: string = "Studio cut graphic",
    surfaceCtx?: { vinylSubstrate?: 'cut' | 'printed'; bleedInches?: number; vinylZones?: any[] },
  ): Promise<string | null> => {
    setIsGenerating(true);
    setStage("Vectorizing for cut production...");
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error: vErr } = await supabase.functions.invoke("vectorize-it", {
        body: {
          user_id: user.id,
          file_url: mockupUrl,
          file_name: `${designLabel.replace(/[^a-z0-9-_ ]/gi, "").slice(0, 60) || "studio"}.png`,
          trace_mode: "detailed",
          color_count: 6,
          smoothing: 1.0,
        },
      });
      if (vErr) throw new Error(vErr.message || "Vectorize failed");
      const svgUrl: string | null = data?.svg_url || data?.output_url || null;
      if (!svgUrl) throw new Error("Vectorize returned no SVG");

      // Persist on the SAME graphics_pro_jobs row this job actually lives on
      // (jobId is a graphics_pro_jobs id minted by generate-graphics-pro) so
      // ProductionOutput — which polls graphics_pro_jobs and reveals the cut
      // file once status === 'complete' — picks the SVG up.
      //
      // This previously wrote to panelizer_jobs, but no panelizer_jobs row
      // has this id, so the update was a silent no-op: the cut file never
      // landed and the job hung at mockup_ready forever (115 stalled jobs).
      // graphics_pro_jobs also has no needs_qc_review/ready_for_production
      // status — its CHECK constraint's terminal success state is 'complete'
      // (the same value the run_production path flips to), so we advance to
      // 'complete' and carry the QC review flags in concept_json instead.
      //
      // wpw_spec block matches the canonical WPW cut-contour spec
      // (see supabase/functions/_shared/production/wpw-cut-contour-spec.md):
      // spot color name 'CutContour', 100% magenta CMYK, 0.25pt hairline
      // stroke, three-layer file (cut · art · black bleed offset).
      const zones = surfaceCtx?.vinylZones || [];
      const reviewFlags: string[] = [];
      const tinyZones = zones.filter(
        (z) => (z.heightInches || 0) > 0 && z.heightInches < 2,
      );
      if (tinyZones.length > 0) {
        reviewFlags.push(`letters_under_2in:${tinyZones.map((z) => z.label).join(",")}`);
      }
      const unfilmedLayers = (surfaceCtx?.vinylSubstrate === "cut")
        ? zones.filter((z) => !z.filmColor)
        : [];
      if (unfilmedLayers.length > 0) {
        reviewFlags.push(`missing_film:${unfilmedLayers.map((z) => z.label).join(",")}`);
      }

      // Two separate writes, mirroring the run_production finalize pattern:
      // the file + status flip FIRST (only columns guaranteed to exist), THEN
      // the richer concept_json on its own. Bundling them was the original
      // failure mode elsewhere — one unmigrated column 42703's the whole
      // update and the status flip is lost. Split so the job ALWAYS reaches
      // 'complete' with its cut file, even if concept_json can't be written.
      const { error: coreErr } = await supabase
        .from("graphics_pro_jobs" as any)
        .update({
          cut_path_svg_url: svgUrl,
          vectorized_url: svgUrl,
          status: "complete",
          stage: "complete",
          progress: 100,
        })
        .eq("id", jobId);
      if (coreErr) {
        console.warn("[Studio pack] could not persist svg url / status:", coreErr.message);
      }

      // Best-effort metadata — the WPW cut spec, per-layer list, and QC
      // review flags for the design/production team. Non-fatal.
      try {
        await supabase
          .from("graphics_pro_jobs" as any)
          .update({
            concept_json: {
              source: "graphicspro_studio",
              cut_style: surfaceCtx?.vinylSubstrate || "printed",
              bleed_inches: surfaceCtx?.bleedInches ?? 0.125,
              wpw_spec: {
                spot_color_name: "CutContour",
                spot_color_cmyk: { c: 0, m: 100, y: 0, k: 0 },
                stroke_weight_pt: 0.25,
                stroke_fill: "none",
                layer_order: ["cut", "art", "bleed"],
                bleed_color: "black",
                bleed_offset_join: "round",
              },
              layers: zones.map((z, idx) => ({
                index: idx + 1,
                label: z.label,
                copy: z.designPrompt,
                width_inches: z.widthInches,
                height_inches: z.heightInches,
                film: z.filmColor || null,
              })),
              review_flags: reviewFlags,
            },
          })
          .eq("id", jobId);
      } catch (persistErr) {
        console.warn("[Studio pack] could not persist concept_json:", persistErr);
      }

      toast({ title: "Cut contour ready", description: "Vector SVG is ready to download." });
      return svgUrl;
    } catch (err: any) {
      console.error("[Studio pack] vectorize failed:", err);
      setError(err?.message || "Vectorize failed");
      toast({ title: "Production pack failed", description: err?.message, variant: "destructive" });
      return null;
    } finally {
      setIsGenerating(false);
      setStage("");
    }
  }, [toast]);

  // ── Studio angles ────────────────────────────────────────────────────────
  // V1 renders one mockup per UPLOADED photo, so the customer only sees the
  // angles they uploaded. This synthesizes the REMAINING canonical studio
  // angles from the rendered design — anchored to the primary mockup via
  // generate-color-render's GraphicsPro hero-reference, the same mechanism the
  // studio tool / RecreatePro use — and appends them to mockupResult.angles so
  // they show in the existing preview grid. Keeps the uploaded photos; fills the
  // gaps with studio renders. Per-view retry; surfaces each angle as it lands.
  const generateStudioAngles = useCallback(async (
    surface: SurfaceSelections,
    graphic: GraphicInput,
  ): Promise<boolean> => {
    const referenceUrl = mockupResult?.mockupUrl || mockupResult?.angles?.[0]?.mockupUrl || null;
    if (!referenceUrl) {
      toast({ title: "No mockup yet", description: "Generate the mockup first, then add studio angles.", variant: "destructive" });
      return false;
    }
    // Year/make/model are OPTIONAL on the upload path (the customer may just drop
    // a truck photo). The studio angles are anchored off the rendered mockup via
    // heroReferenceUrl, so the design + vehicle shape carry over from the image —
    // we don't need a make/model lookup to fill the remaining six views. Pass
    // through whatever vehicle identity exists; empty fields are fine.

    setIsGeneratingStudioAngles(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userEmail = user?.email || undefined;
      const designLabel = graphic.businessName || graphic.designPrompt || "Custom Graphics";
      // NOTE: generate-color-render REJECTS any GraphicsPro prompt containing a
      // PRINT_ONLY_KEYWORD (e.g. "graphic design", "print", "photo", "artwork",
      // "texture") with a `print_required` 400 — BEFORE rendering. The old wording
      // ("...cut vinyl graphic design...") tripped that on every view, so all six
      // studio angles silently failed and the customer was left with only the one
      // primary angle. Keep this clear of those tokens.
      const stylingPrompt =
        "Reproduce this exact cut vinyl wrap on the vehicle at the requested camera angle. " +
        "Match every shape, color, logo, and lettering exactly as shown in the reference — do not redesign, reinterpret, or omit any element.";

      // Canonical studio views beyond the driver side (which the mockup already is).
      const STUDIO_VIEWS: Array<{ viewType: string; label: string }> = [
        { viewType: "passenger-side", label: "Passenger Side (Studio)" },
        { viewType: "hood_detail", label: "Hood (Studio)" },
        { viewType: "front", label: "Front (Studio)" },
        { viewType: "rear", label: "Rear (Studio)" },
        { viewType: "close-up", label: "Close-Up (Studio)" },
        { viewType: "roof", label: "Roof (Studio)" },
      ];

      const renderOne = async (viewType: string): Promise<string | null> => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const { data, error } = await renderClient.functions.invoke("generate-color-render", {
              body: {
                // generate-color-render hard-requires year/make/model (returns a
                // 400 "Missing required fields" otherwise). The upload path leaves
                // these blank by design — the vehicle shape carries over from the
                // rendered mockup via heroReferenceUrl — so pass safe placeholders
                // to clear that guard when the customer didn't pick a vehicle.
                vehicleYear: surface.year || "2020",
                vehicleMake: surface.make || "Custom",
                vehicleModel: surface.model || "Vehicle",
                colorData: {
                  colorName: designLabel,
                  finish: "gloss",
                  colorLibrary: "graphicspro",
                  customStylingPrompt: stylingPrompt,
                  // Anchors the angle to the rendered design so it stays consistent
                  // (generate-color-render adds this as a reference for non-side views).
                  heroReferenceUrl: referenceUrl,
                },
                modeType: "GraphicsPro",
                viewType,
                userEmail,
                customStylingPrompt: stylingPrompt,
                skipLookups: true,
              },
            });
            if (!error && data?.renderUrl) return data.renderUrl as string;
          } catch (e) {
            /* retry */
          }
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
        }
        return null;
      };

      // Render all six remaining views CONCURRENTLY — each is its own edge
      // invocation, so firing them in parallel turns a ~3-5 min sequential crawl
      // into one render's wall-clock, and a single slow/failed view no longer
      // blocks the others. Each angle is surfaced the instant it lands.
      const results = await Promise.all(
        STUDIO_VIEWS.map(async (v) => {
          const url = await renderOne(v.viewType);
          if (url) {
            setMockupResult((prev) => {
              if (!prev) return prev;
              if (prev.angles.some((a) => a.angleId === `studio-${v.viewType}`)) return prev;
              return { ...prev, angles: [...prev.angles, { angleId: `studio-${v.viewType}`, angleLabel: v.label, mockupUrl: url, jobId: null }] };
            });
          }
          return url ? 1 : 0;
        })
      );
      const added = results.reduce((sum, n) => sum + n, 0);

      toast({
        title: added > 0 ? "Studio angles added" : "Studio angles failed",
        description: added > 0 ? `${added} studio angle(s) generated.` : "Couldn't generate the studio angles — try again.",
        variant: added > 0 ? undefined : "destructive",
      });
      return added > 0;
    } catch (err: any) {
      toast({ title: "Studio angles failed", description: err?.message || "Try again", variant: "destructive" });
      return false;
    } finally {
      setIsGeneratingStudioAngles(false);
    }
  }, [mockupResult, toast]);

  return {
    isGenerating,
    stage,
    error,
    generatedSurfaceUrl,
    mockupResult,
    generateMockup,
    generateFlat,
    startProduction,
    generateStudioProductionPack,
    generateStudioAngles,
    isGeneratingStudioAngles,
    runLogoUtility,
    reset,
  };
}
