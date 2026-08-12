import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ApproveModeRenderDisplay } from "../ApproveModeRenderDisplay";
import { useIsMobile } from "@/hooks/use-mobile";
import { useFreemiumLimits } from "@/hooks/useFreemiumLimits";
import { useRevisionHistory } from "@/hooks/useRevisionHistory";
import { RevisionHistoryTimeline } from "@/components/tools/RevisionHistoryTimeline";
import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Upload, Loader2, Sparkles, FileDown, Save, X, RotateCw, Maximize2, Download, CheckCircle2, ClipboardSignature, Package, Scissors } from "lucide-react";
import { useCutFiles } from "@/hooks/useCutFiles";
import { ProductionPackDialog } from "@/components/designpanelpro/ProductionPackDialog";
import { cn } from "@/lib/utils";
import { generateProofSheet } from "@/lib/pdf-generator";
import { Badge } from "@/components/ui/badge";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";
import { BeforeAfterSlider } from "@/components/gallery/BeforeAfterSlider";
import { StudioProofLayout } from "../StudioProofLayout";
import { ProfessionalProofSheet } from "../ProfessionalProofSheet";
import { MobileProofSheet } from "../MobileProofSheet";
import { TwoDProofSheet } from "../TwoDProofSheet";
import { ProofPreviewCard } from "../ProofPreviewCard";
import { PaywallModal } from "@/components/PaywallModal";
import { SocialEngagementModal } from "@/components/SocialEngagementModal";
import { FreemiumCounter } from "@/components/FreemiumCounter";
import { DesignRevisionPrompt } from "@/components/tools/DesignRevisionPrompt";
import { MarkAsPerfectButton } from "@/components/MarkAsPerfectButton";
import { MyVehicleProToggle } from "@/components/tools/MyVehicleProToggle";
import { useMyVehicleMode } from "@/hooks/useMyVehicleMode";
import { BeforeAfterViewer } from "@/components/colorpro/BeforeAfterViewer";
import { GenerationWizard, APPROVEMODE_TIPS } from "@/components/tools/GenerationWizard";

export const ApproveModeComponent = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [selectedExample, setSelectedExample] = useState<any>(null);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { 
    canGenerate: canGenerateFreemium, phase: freemiumPhase, isPrivileged, 
    totalRemaining, incrementGeneration: incrementFreemium, unlockBonus 
  } = useFreemiumLimits();
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [socialModalOpen, setSocialModalOpen] = useState(false);
  
  // Generator state
  const [designFile, setDesignFile] = useState<{ url: string; fileName: string } | null>(null);
  const [uploadingDesign, setUploadingDesign] = useState(false);
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [isDetectingVehicle, setIsDetectingVehicle] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [allViews, setAllViews] = useState<Array<{ type: string; url: string; label: string }>>([]);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 6 });
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isSavingToGallery, setIsSavingToGallery] = useState(false);
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(null);
  const [visualizationId, setVisualizationId] = useState<string | null>(null);
  const [selectedCompareView, setSelectedCompareView] = useState(0);
  const [showStudioProof, setShowStudioProof] = useState(false);
  const [showProofSheet, setShowProofSheet] = useState(false);
  const [show2DProofSheet, setShow2DProofSheet] = useState(false);
  const [showProductionDialog, setShowProductionDialog] = useState(false);
  const { isGeneratingCutFiles, handleGenerateCutFiles } = useCutFiles();
  const [currentExampleIndex, setCurrentExampleIndex] = useState(0);
  const [isRevising, setIsRevising] = useState(false);

  // MyVehiclePro state
  const mvp = useMyVehicleMode();
  const [mvpEditedImageUrl, setMvpEditedImageUrl] = useState<string | null>(null);
  const [mvpIsGenerating, setMvpIsGenerating] = useState(false);

  // Revision history for ApprovePro
  const { revisionHistory, saveRevision } = useRevisionHistory('approvemode');


  const { data: examples, isLoading } = useQuery({
    queryKey: ["approvemode_examples"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approvemode_examples")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });

  // Auto-rotate examples every 3 seconds
  useEffect(() => {
    if (!examples || examples.length <= 1) return;
    
    const interval = setInterval(() => {
      setCurrentExampleIndex((prev) => (prev + 1) % examples.length);
    }, 3000);
    
    return () => clearInterval(interval);
  }, [examples]);

  // Vehicle info is entered by user (Year / Make / Model) and sent to
  // generate-color-render as required fields. The edge function rejects
  // the request with 400 "Missing required fields" if any are empty.

  // Function to clear all renders manually
  const handleClearRenders = () => {
    setAllViews([]);
    setGeneratedImageUrl(null);
    setVisualizationId(null);
    toast({
      title: 'Renders cleared',
      description: 'Ready to generate new views.',
    });
  };

  // Load visualization from URL parameter
  useEffect(() => {
    const visualizationIdParam = searchParams.get('visualizationId');
    if (!visualizationIdParam) return;

    const loadVisualization = async () => {
      try {
        const { data, error } = await supabase
          .from('color_visualizations')
          .select('*')
          .eq('id', visualizationIdParam)
          .single();

        if (error) throw error;
        if (!data) return;

        // Set vehicle info
        setYear(data.vehicle_year?.toString() || '');
        setMake(data.vehicle_make || '');
        setModel(data.vehicle_model || '');

        // Set design file if exists
        if (data.custom_design_url) {
          setDesignFile({
            url: data.custom_design_url,
            fileName: data.design_file_name || 'Loaded Design'
          });
        }

        // Load render URLs into allViews
        const renderUrls = data.render_urls as Record<string, any> | null;
        if (renderUrls) {
          const viewLabels: Record<string, string> = {
            'side': 'Driver Side',
            'driver-side': 'Driver Side',
            'passenger-side': 'Passenger Side',
            'hood_detail': 'Hood',
            'rear': 'Rear',
            'close-up': 'Close-Up',
            'roof': 'Roof',
            'front': 'Front',
          };

          const loadedViews = Object.entries(renderUrls)
            .filter(([key, val]) => !key.includes('spin') && key !== 'top' && key !== 'closeup' && key !== 'detail' && typeof val === 'string')
            .map(([viewType, url]) => {
              const urlStr = url as string;
              const cacheBustedUrl = `${urlStr}${urlStr.includes('?') ? '&' : '?'}cb=${Date.now()}`;
              return {
                type: viewType,
                url: cacheBustedUrl,
                label: viewLabels[viewType] || viewType
              };
            });

          if (loadedViews.length > 0) {
            setAllViews(loadedViews);
            setGeneratedImageUrl(loadedViews[0].url);
          }
        }

        setVisualizationId(visualizationIdParam);
        toast({ title: 'Visualization loaded', description: 'All views from gallery have been loaded' });
      } catch (error: any) {
        console.error('Error loading visualization:', error);
        toast({ title: 'Failed to load visualization', variant: 'destructive' });
      }
    };

    loadVisualization();
  }, [searchParams]);

  // Safe defaults so ApprovePro can always proceed even if auto-detection
  // fails (network error, unsupported image, large file, model hiccup).
  // Gemini reads the actual vehicle out of the attached 2D proof image, so
  // these placeholder strings only satisfy generate-color-render's required-
  // fields guard — they don't bias the render.
  const APPROVEMODE_DEFAULT_VEHICLE = {
    year: new Date().getFullYear().toString(),
    make: 'Reference',
    model: 'Vehicle',
  } as const;

  // Resize a File down to max 1024px on its longest edge and return a JPEG
  // data URL. Keeps analyze-vehicle-image request bodies well under the 6MB
  // Supabase gateway limit that full 20MB PNGs blow past when base64-encoded.
  const resizeImageForAnalysis = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1024;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Canvas 2D context unavailable'));
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => reject(new Error('Failed to decode image'));
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  // Auto-identify the vehicle shown in the 2D proof so the render prompt
  // matches the same vehicle the designer already drew. ApprovePro intentionally
  // renders onto the vehicle in the proof — not a user-selected one — so this
  // runs as soon as the design is uploaded and fills year/make/model state.
  // If detection fails for any reason, we fall back to generic defaults so the
  // user can always click Generate. Gemini will still render the correct
  // vehicle because it also receives the uploaded image as the primary visual
  // reference.
  const detectVehicleFromProof = async (file: File) => {
    setIsDetectingVehicle(true);
    try {
      const imageData = await resizeImageForAnalysis(file);
      const { data, error } = await supabase.functions.invoke(
        'analyze-vehicle-image',
        { body: { imageData } },
      );
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Detection failed');
      const detected = data.data || {};
      const hasMake = typeof detected.make === 'string' && detected.make.trim();
      const hasModel = typeof detected.model === 'string' && detected.model.trim();
      if (hasMake && hasModel) {
        setYear(
          (typeof detected.year === 'string' && detected.year.trim()) ||
            APPROVEMODE_DEFAULT_VEHICLE.year,
        );
        setMake(detected.make.trim());
        setModel(detected.model.trim());
        toast({
          title: 'Vehicle identified',
          description: [detected.year, detected.make, detected.model]
            .filter(Boolean)
            .join(' '),
        });
        return;
      }
      throw new Error('Model did not return make/model');
    } catch (err: any) {
      console.warn('analyze-vehicle-image fell back to defaults:', err);
      // Non-fatal — use generic placeholder vehicle so generate-color-render
      // still passes its required-fields guard. Gemini sees the uploaded
      // image and renders the actual vehicle regardless of this label.
      setYear(APPROVEMODE_DEFAULT_VEHICLE.year);
      setMake(APPROVEMODE_DEFAULT_VEHICLE.make);
      setModel(APPROVEMODE_DEFAULT_VEHICLE.model);
    } finally {
      setIsDetectingVehicle(false);
    }
  };

  const handleDesignUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
      toast({ title: 'Invalid file type', description: 'Please upload PNG or JPG', variant: 'destructive' });
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum file size is 20MB', variant: 'destructive' });
      return;
    }

    // Reset previous detection before a new upload
    setYear('');
    setMake('');
    setModel('');

    try {
      setUploadingDesign(true);
      const fileName = `${crypto.randomUUID()}.${file.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage
        .from('wrap-files')
        .upload(`approvemode/${fileName}`, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('wrap-files')
        .getPublicUrl(`approvemode/${fileName}`);

      setDesignFile({ url: publicUrl, fileName: file.name });
      toast({ title: 'Design uploaded successfully' });

      // Fire-and-forget vehicle detection from the same file — this fills the
      // year/make/model state before the user clicks Generate.
      void detectVehicleFromProof(file);
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
    } finally {
      setUploadingDesign(false);
    }
  };

  const generateWithTimeout = async (
    viewType: string,
    vehicleOverride?: { year: string; make: string; model: string },
    timeoutMs = 90000,
  ) => {
    // Get user email for authentication
    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email;

    if (!userEmail) {
      throw new Error('Authentication required. Please log in to generate renders.');
    }

    // Build colorData payload for ApproveMode - just design info
    const colorData: any = {
      designUrl: designFile.url,
      designName: designFile.fileName
    };

    const vYear = vehicleOverride?.year || year;
    const vMake = vehicleOverride?.make || make;
    const vModel = vehicleOverride?.model || model;

    return Promise.race([
      renderClient.functions.invoke('generate-color-render', {
        body: {
          vehicleYear: vYear,
          vehicleMake: vMake,
          vehicleModel: vModel,
          colorData,
          modeType: 'approvemode',
          viewType,
          userEmail
        }
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout generating ${viewType} view`)), timeoutMs)
      )
    ]);
  };

  const handleGenerate = async () => {
    // ─── Studio Mode: render 2D proof as 3D ───
    if (!designFile) {
      toast({ title: 'Missing design', description: 'Please upload a 2D design proof', variant: 'destructive' });
      return;
    }

    if (isDetectingVehicle) {
      toast({
        title: 'Identifying vehicle…',
        description: 'Hold on while we read the 2D proof.',
      });
      return;
    }

    // Safety net: if detection never populated state (e.g. navigated in with
    // a cached designFile), use the defaults so generate-color-render still
    // passes its required-fields guard.
    const effectiveYear =
      year.trim() || APPROVEMODE_DEFAULT_VEHICLE.year;
    const effectiveMake =
      make.trim() || APPROVEMODE_DEFAULT_VEHICLE.make;
    const effectiveModel =
      model.trim() || APPROVEMODE_DEFAULT_VEHICLE.model;

    // Check freemium limits first (unless privileged)
    if (!isPrivileged && !canGenerateFreemium) {
      if (freemiumPhase === 'engagement') {
        setSocialModalOpen(true);
      } else if (freemiumPhase === 'paywall') {
        setPaywallOpen(true);
      }
      return;
    }

    setIsGenerating(true);
    setGeneratedImageUrl(null);
    setAllViews([]);
    setGenerationProgress({ current: 1, total: 7 });

    try {
      // Generate all 7 views - matches locked VIEW_ORDER from view-angles-os.ts
      const viewTypes = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
      const viewLabels: Record<string, string> = {
        'side': 'Driver Side',
        'passenger-side': 'Passenger Side',
        'hood_detail': 'Hood',
        'front': 'Front',
        'rear': 'Rear',
        'close-up': 'Close-Up',
        'roof': 'Roof',
      };

      // Generate all views in parallel - each gets the 2D proof as primary reference
      const vehicleOverride = {
        year: effectiveYear,
        make: effectiveMake,
        model: effectiveModel,
      };
      const viewPromises = viewTypes.map(viewType =>
        generateWithTimeout(viewType, vehicleOverride).catch(error => {
          console.error(`Failed to generate ${viewType}:`, error);
          return { error, viewType };
        })
      );

      const results = await Promise.all(viewPromises);
      
      // Process results - collect all successful views with cache-busting
      const newViews = results
        .map((result: any, index) => {
          const viewType = viewTypes[index];
          if (!result.error && result.data?.renderUrl) {
            const cacheBustedUrl = `${result.data.renderUrl}${result.data.renderUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;
            return { 
              type: viewType, 
              url: cacheBustedUrl, 
              label: viewLabels[viewType] 
            };
          }
          return null;
        })
        .filter((v): v is { type: string; url: string; label: string } => v !== null);

      if (newViews.length === 0) {
        throw new Error('Failed to generate any views');
      }

      // Set the first view as hero image and store all views
      setGeneratedImageUrl(newViews[0].url);
      setAllViews(newViews);

      // Scroll to the render display so user sees results
      setTimeout(() => {
        document.getElementById('approve-render-display')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);

      // Track freemium usage
      if (!isPrivileged) {
        incrementFreemium();
      }

      const successCount = newViews.length;
      const failedCount = 6 - successCount;

      toast({
        title: `${successCount} views generated!`,
        description: failedCount > 0 
          ? `${failedCount} views failed. You can download the PDF or save to gallery.`
          : "All 6 professional views ready! Download PDF or save to gallery.",
      });

    } catch (error: any) {
      console.error('Generation error:', error);
      toast({ title: 'Generation failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRevisionSubmit = async (revisionPrompt: string) => {
    if (!designFile) return;

    const originalUrl = generatedImageUrl;
    setIsRevising(true);
    setGeneratedImageUrl(null);
    setAllViews([]);

    try {
      // Generate all 7 views with revision prompt - matches locked VIEW_ORDER
      const viewTypes = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
      const viewLabels: Record<string, string> = {
        'side': 'Driver Side',
        'passenger-side': 'Passenger Side',
        'hood_detail': 'Hood',
        'front': 'Front',
        'rear': 'Rear',
        'close-up': 'Close-Up',
        'roof': 'Roof',
      };

      const colorData: any = {
        designUrl: designFile.url,
        designName: designFile.fileName
      };

      const effectiveYear = year.trim() || APPROVEMODE_DEFAULT_VEHICLE.year;
      const effectiveMake = make.trim() || APPROVEMODE_DEFAULT_VEHICLE.make;
      const effectiveModel = model.trim() || APPROVEMODE_DEFAULT_VEHICLE.model;

      // Generate all views in parallel with revision prompt
      const viewPromises = viewTypes.map(viewType =>
        renderClient.functions.invoke('generate-color-render', {
          body: {
            vehicleYear: effectiveYear,
            vehicleMake: effectiveMake,
            vehicleModel: effectiveModel,
            colorData,
            modeType: 'approvemode',
            viewType,
            revisionPrompt
          }
        }).catch(error => ({ error, viewType }))
      );

      const results = await Promise.all(viewPromises);
      
      const newViews = results
        .map((result: any, index) => {
          const viewType = viewTypes[index];
          if (!result.error && result.data?.renderUrl) {
            const cacheBustedUrl = `${result.data.renderUrl}${result.data.renderUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;
            return { 
              type: viewType, 
              url: cacheBustedUrl, 
              label: viewLabels[viewType] 
            };
          }
          return null;
        })
        .filter((v): v is { type: string; url: string; label: string } => v !== null);

      if (newViews.length === 0) {
        throw new Error('Failed to generate any views');
      }

      setGeneratedImageUrl(newViews[0].url);
      setAllViews(newViews);

      // Scroll to the render display so user sees results
      setTimeout(() => {
        document.getElementById('approve-render-display')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);

      // Save revision to history
      await saveRevision({
        viewType: 'all_views',
        originalUrl,
        revisedUrl: newViews[0].url,
        revisionPrompt
      });

      toast({
        title: "Revision applied!",
        description: `${newViews.length} views regenerated with your changes`,
      });

    } catch (error: any) {
      console.error('Revision error:', error);
      toast({ title: 'Revision failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsRevising(false);
    }
  };


  const handleGenerateProofSheet = async () => {
    if (allViews.length < 6) {
      toast({ 
        title: 'Not all views generated', 
        description: 'Please generate all 7 views before creating the proof sheet', 
        variant: 'destructive' 
      });
      return;
    }

    // Debug logging: show exactly what views are going into the PDF
    console.log('ApprovePro - allViews before PDF:', allViews);
    console.table(
      allViews.map((v, idx) => ({
        index: idx,
        type: v.type,
        url: v.url,
        label: v.label,
      }))
    );

    const pdfViews = allViews;

    setIsGeneratingPDF(true);
    try {
      await generateProofSheet({
        views: pdfViews,
        vehicleInfo: { year, make, model },
        designName: designFile?.fileName || 'Custom Design'
      });
      
      toast({
        title: "Proof sheet generated!",
        description: "PDF has been downloaded successfully",
      });
    } catch (error: any) {
      console.error('PDF generation error:', error);
      toast({ 
        title: 'PDF generation failed', 
        description: error.message, 
        variant: 'destructive' 
      });
    } finally {
      setIsGeneratingPDF(false);
    }
  };
  const handleSaveToGallery = async () => {
    if (allViews.length < 6) {
      toast({ 
        title: 'Not all views generated', 
        description: 'Please generate all 7 views before saving to gallery', 
        variant: 'destructive' 
      });
      return;
    }

    setIsSavingToGallery(true);
    try {
      const vehicleName = `${year} ${make} ${model}`;
      const designName = designFile?.fileName || 'Custom Design';

      // Insert all 7 views into approvemode_carousel with before_url
      const insertPromises = allViews.map((view, index) => {
        return supabase.from('approvemode_carousel').insert({
          media_url: view.url,
          before_url: designFile?.url || null,
          name: `${vehicleName} - ${view.label}`,
          vehicle_name: vehicleName,
          color_name: designName,
          title: view.label,
          subtitle: `${designName} on ${vehicleName}`,
          sort_order: index,
          is_active: true
        });
      });

      const results = await Promise.all(insertPromises);
      
      // Check for errors
      const errors = results.filter(r => r.error);
      if (errors.length > 0) {
        throw new Error(`Failed to save ${errors.length} views: ${errors[0].error?.message}`);
      }

      toast({
        title: "Saved to gallery!",
        description: "All 7 views have been saved to the gallery",
      });
    } catch (error: any) {
      console.error('Save to gallery error:', error);
      toast({ 
        title: 'Failed to save to gallery', 
        description: error.message, 
        variant: 'destructive' 
      });
    } finally {
      setIsSavingToGallery(false);
    }
  };
  if (isLoading) {
    return (
      <div className="grid md:grid-cols-2 gap-6">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Description - 2D→3D USP */}
      <div className="bg-gradient-to-r from-blue-500/10 to-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <p className="text-sm font-semibold text-foreground text-center mb-1">
          2D Design → <span className="text-blue-400">3D Vehicle Render</span>
        </p>
        <p className="text-xs text-muted-foreground/90 text-center">
          Upload your 2D design proof → See photorealistic 3D renders on the same vehicle instantly
        </p>
        <p className="text-xs text-center mt-2">
          <span className="text-muted-foreground">Need your design recreated on a different vehicle?</span>{' '}
          <button onClick={() => navigate('/recreatepro')} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 font-medium">
            Click here for RecreatePro™
          </button>
        </p>
      </div>


      {/* Generator Section - Compact Layout */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Upload 2D Proof → Get 3D Renders</h3>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Design Upload */}
          <div className="space-y-4">
            <Label>Upload 2D Design</Label>
            <div className="border-2 border-dashed rounded-lg p-4">
              {designFile ? (
                <div className="space-y-3">
                  <img src={designFile.url} alt="Design" className="w-full rounded" />
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setDesignFile(null)}
                  >
                    Upload Different Design
                  </Button>
                </div>
              ) : (
                <label className="cursor-pointer block">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    className="hidden"
                    onChange={handleDesignUpload}
                    disabled={uploadingDesign}
                  />
                  <div className="space-y-2 text-center">
                    {uploadingDesign ? (
                      <Loader2 className="w-10 h-10 mx-auto animate-spin text-muted-foreground" />
                    ) : (
                      <Upload className="w-10 h-10 mx-auto text-muted-foreground" />
                    )}
                    <p className="text-sm text-muted-foreground">
                      {uploadingDesign ? 'Uploading...' : 'Click to upload design'}
                    </p>
                    <p className="text-xs text-muted-foreground">PNG or JPG (max 20MB)</p>
                  </div>
                </label>
              )}
            </div>
          </div>

          {/* Generate Controls */}
          <div className="space-y-4">

            {/* Detected vehicle — auto-identified from the uploaded proof.
                If you want to render the design on a different make/model,
                use RecreatePro in ProductionFlow instead. */}
            {designFile && (
              <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Detected Vehicle
                </div>
                <div className="text-sm font-medium text-foreground">
                  {isDetectingVehicle ? (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Identifying vehicle from 2D proof…
                    </span>
                  ) : make && make !== APPROVEMODE_DEFAULT_VEHICLE.make ? (
                    [year, make, model].filter(Boolean).join(" ")
                  ) : (
                    <span className="text-muted-foreground">
                      Using vehicle from uploaded proof image
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  ApprovePro renders onto the vehicle in your 2D proof. Need a
                  different make/model? Use RecreatePro in ProductionFlow.
                </p>
              </div>
            )}

            {/* Clear Renders Button - appears when renders exist */}
            {allViews.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearRenders}
                className="w-full text-muted-foreground hover:text-destructive hover:border-destructive"
              >
                <X className="w-4 h-4 mr-2" />
                Clear Renders & Start Fresh
              </Button>
            )}

            <Button
              className="w-full"
              size="lg"
              onClick={handleGenerate}
              disabled={
                isGenerating ||
                mvpIsGenerating ||
                isDetectingVehicle ||
                !designFile
              }
            >
              {(isGenerating || mvpIsGenerating) ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {mvpIsGenerating ? "Applying Design to Photo..." : "Generating All 6 Views..."}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate All 7 Professional Views
                </>
              )}
            </Button>

            {/* Generate Proof Sheet Button - appears after views are generated */}
            {allViews.length > 0 && (
              <div className="space-y-2">
                <Button
                  className="w-full"
                  size="lg"
                  variant="default"
                  onClick={handleGenerateProofSheet}
                  disabled={isGeneratingPDF || allViews.length < 6}
                >
                  {isGeneratingPDF ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating PDF...
                    </>
                  ) : (
                    <>
                      <FileDown className="w-4 h-4 mr-2" />
                      Download Design Proof Sheet (PDF)
                    </>
                  )}
                </Button>

                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    size="lg"
                    variant="outline"
                    onClick={() => setShow2DProofSheet(true)}
                  >
                    <ClipboardSignature className="w-4 h-4 mr-2" />
                    2D Proof
                  </Button>
                  <Button
                    className="flex-1"
                    size="lg"
                    variant="secondary"
                    onClick={() => setShowProofSheet(true)}
                  >
                    <ClipboardSignature className="w-4 h-4 mr-2" />
                    3D Proof
                  </Button>
                </div>

                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  size="lg"
                  onClick={() => setShowProductionDialog(true)}
                >
                  <Package className="w-4 h-4 mr-2" />
                  Generate Production Pack
                </Button>

                <Button
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                  size="lg"
                  onClick={() => navigate("/productionflow", {
                    state: {
                      action: "run_cut_map",
                      renderData: {
                        render_urls: allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {} as Record<string, string>),
                        vehicle_year: year,
                        vehicle_make: make,
                        vehicle_model: model,
                        design_name: designFile?.fileName || "ApproveMode Design",
                      },
                    },
                  })}
                >
                  <Scissors className="w-4 h-4 mr-2" /> Generate Cut Contour Logo Pack
                </Button>
              </div>
            )}

            {/* Design Revision Prompt - Always visible as selling point */}
            <DesignRevisionPrompt
              onRevisionSubmit={handleRevisionSubmit}
              isGenerating={isRevising || isGenerating}
              disabled={allViews.length === 0 || !designFile}
            />

            {/* Revision History Timeline */}
            {revisionHistory.length > 0 && (
              <RevisionHistoryTimeline
                history={revisionHistory}
                onSelect={(item) => {
                  if (item.revised_url) {
                    setGeneratedImageUrl(item.revised_url);
                    setAllViews(prev => {
                      const updated = [...prev];
                      if (updated.length > 0) {
                        updated[0] = { ...updated[0], url: item.revised_url };
                      }
                      return updated;
                    });
                  }
                }}
                className="mt-4"
              />
            )}


            {/* Save to Gallery Button - appears after views are generated */}
            {allViews.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  className="flex-1"
                  size="lg"
                  variant="outline"
                  onClick={handleSaveToGallery}
                  disabled={isSavingToGallery || allViews.length < 6}
                >
                  {isSavingToGallery ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving to Gallery...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save All Views to Gallery
                    </>
                  )}
                </Button>
                <MarkAsPerfectButton
                  promptSignature={`approvemode-${designFile?.fileName || 'custom'}`}
                  vehicleSignature={`${year}-${make}-${model}`}
                  renderUrls={allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {})}
                  sourceVisualizationId={visualizationId || undefined}
                />
              </div>
            )}

            <p className="text-xs text-muted-foreground text-center">
              {allViews.length === 0
                ? 'Upload a 2D design proof and generate all 7 professional 3D angles'
                : allViews.length >= 6
                ? 'All views generated! Download PDF proof sheet or save to gallery.'
                : `Generated ${allViews.length} of 7 views. ${7 - allViews.length} failed.`
              }
            </p>
          </div>
        </div>
      </Card>

      {/* MyVehiclePro Before/After Result - kept for backwards compat */}

      {/* 2D → 3D Transformation - Open Studio Proof Layout */}
      {allViews.length > 0 && designFile && (
        <Card className="p-6">
          <h3 className="text-xl font-bold mb-2 text-center">
            2D → 3D Transformation Complete
          </h3>
          <p className="text-center text-muted-foreground text-sm mb-4">
            Your design proof has been transformed into {allViews.length} photorealistic 3D renders
          </p>
          
          {/* Preview Grid */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="relative aspect-video rounded-lg overflow-hidden border-2 border-blue-500/50">
              <img src={designFile.url} alt="2D Proof" className="w-full h-full object-contain bg-neutral-900" />
              <div className="absolute bottom-1 left-1 bg-blue-500/80 px-2 py-0.5 rounded text-[10px] font-bold text-white">
                2D PROOF
              </div>
            </div>
            {allViews.slice(0, 2).map((view, idx) => (
              <div key={view.type} className="relative aspect-video rounded-lg overflow-hidden border border-border">
                <img src={view.url} alt={view.label} className="w-full h-full object-cover" />
                <div className="absolute bottom-1 left-1 bg-black/70 px-2 py-0.5 rounded text-[10px] font-medium text-white">
                  {view.label}
                </div>
              </div>
            ))}
          </div>

          <Button
            onClick={() => setShowStudioProof(true)}
            className="w-full"
            size="lg"
          >
            <Maximize2 className="w-4 h-4 mr-2" />
            Open Studio Proof Layout
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            View full 2D proof alongside all {allViews.length} 3D renders in a clean studio layout
          </p>
        </Card>
      )}


      {/* Generation Progress Wizard */}
      {(isGenerating || mvpIsGenerating) && (
        <GenerationWizard
          isGenerating={isGenerating || mvpIsGenerating}
          tips={APPROVEMODE_TIPS}
          currentTipIndex={0}
          toolName="ApproveMode"
          gradientFrom="from-blue-500"
          gradientTo="to-emerald-500"
          multiView={isGenerating ? generationProgress : undefined}
          expectedDuration={45}
        />
      )}

      {/* Professional 6-View Display */}
      {allViews.length > 0 && (
        <Card id="approve-render-display" className="p-6 relative">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold">6-View Professional Proof</h3>
            <div className="flex items-center gap-2">
            </div>
          </div>

          {/* 2D Proof vs 3D Render comparison */}
          {designFile?.url && (
            <div className="flex items-center gap-4 mb-4 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
              <div className="flex-shrink-0">
                <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">2D Proof</p>
                <div className="w-20 h-14 rounded overflow-hidden border border-zinc-700">
                  <img src={designFile.url} alt="2D Flat Design" className="w-full h-full object-cover" />
                </div>
              </div>
              <div className="text-zinc-600 text-lg">→</div>
              <div className="flex-shrink-0">
                <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">On Vehicle</p>
                <div className="w-20 h-14 rounded overflow-hidden border border-zinc-700">
                  <img src={allViews[0]?.url || ''} alt="3D Render" className="w-full h-full object-cover" />
                </div>
              </div>
              <p className="text-xs text-zinc-500 ml-2">Flat design → 3D vehicle render</p>
            </div>
          )}

          <ApproveModeRenderDisplay
            views={allViews}
            vehicleInfo={{ year, make, model }}
            designName={designFile?.fileName || 'Custom Design'}
            isGenerating={isGenerating}
            generationProgress={generationProgress}
            onRemoveView={(viewType) => {
              setAllViews(prev => prev.filter(v => v.type !== viewType));
              toast({ title: 'View removed', description: `${viewType} view removed from proof.` });
            }}
          />
        </Card>
      )}

      {/* Customer Approval Proof - USP Feature */}
      {allViews.length > 0 && (
        <ProofPreviewCard
          onGenerateProof={() => setShowProofSheet(true)}
          hasRender={allViews.length > 0}
          designName={designFile?.fileName || 'Custom Design'}
          vehicleName={`${year} ${make} ${model}`.trim()}
        />
      )}

      {/* Before & After Carousel with CTA */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-4">Before & After Examples</h3>
        <div className="grid lg:grid-cols-5 gap-6">
          {/* Left: Before/After Slider (3 columns = 60% width) */}
          <div className="lg:col-span-3">
            {examples && examples.length > 0 ? (
              <Card className="overflow-hidden border-border">
                <BeforeAfterSlider
                  beforeUrl={examples[currentExampleIndex].before_url}
                  afterUrl={examples[currentExampleIndex].after_url}
                  altText={examples[currentExampleIndex].name || 'Before/After'}
                />
                <div className="p-3 bg-secondary/20 flex justify-between items-center">
                  <p className="font-medium text-sm">{examples[currentExampleIndex].name}</p>
                  {examples.length > 1 && (
                    <div className="flex gap-2">
                      {examples.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => setCurrentExampleIndex(idx)}
                          className={`w-2 h-2 rounded-full transition-all ${
                            idx === currentExampleIndex ? 'bg-primary w-4' : 'bg-muted-foreground/50'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            ) : (
              <div className="h-64 border border-border rounded-lg flex items-center justify-center bg-black">
                <p className="text-muted-foreground">No examples available</p>
              </div>
            )}
          </div>

          {/* Right: CTA Card (2 columns = 40% width) */}
          <div className="lg:col-span-2">
            <Card className="h-full bg-gradient-to-br from-primary/10 to-secondary/30 border-primary/30 p-6 flex flex-col justify-center">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Download className="w-8 h-8 text-primary" />
                  <h4 className="text-xl font-bold">Downloadable Design Proofs</h4>
                </div>
                <p className="text-muted-foreground">
                  Every ApprovePro™ render comes with <span className="text-foreground font-medium">high-resolution downloadable proofs</span> for each view angle.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span>Professional client presentations</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span>Print-ready resolution</span>
                  </li>
                </ul>
                <Button 
                  className="w-full mt-2"
                  onClick={() => document.getElementById('design-upload-section')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Try ApprovePro™ Now
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Fullscreen Image Modal with Navigation */}
      <MobileZoomImageModal
        imageUrl={expandedImageIndex !== null && allViews[expandedImageIndex] ? allViews[expandedImageIndex].url : ''}
        title={expandedImageIndex !== null && allViews[expandedImageIndex] ? `${allViews[expandedImageIndex].label} - ${year} ${make} ${model}` : ''}
        isOpen={expandedImageIndex !== null}
        onClose={() => setExpandedImageIndex(null)}
        showNavigation={allViews.length > 1}
        onPrev={expandedImageIndex !== null && expandedImageIndex > 0 ? () => setExpandedImageIndex(expandedImageIndex - 1) : undefined}
        onNext={expandedImageIndex !== null && expandedImageIndex < allViews.length - 1 ? () => setExpandedImageIndex(expandedImageIndex + 1) : undefined}
        currentIndex={expandedImageIndex ?? 0}
        totalCount={allViews.length}
      />

      {/* Studio Proof Layout Modal */}
      {designFile && (
        <StudioProofLayout
          designProofUrl={designFile.url}
          designName={designFile.fileName}
          vehicleInfo={{ year, make, model }}
          views={allViews}
          isOpen={showStudioProof}
          onClose={() => setShowStudioProof(false)}
          onDownloadPDF={allViews.length >= 6 ? handleGenerateProofSheet : undefined}
        />
      )}


      <SocialEngagementModal
        open={socialModalOpen}
        onClose={() => setSocialModalOpen(false)}
        onUnlock={unlockBonus}
      />

      <PaywallModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
      />

      {/* Professional Proof Sheet Dialog */}
      <Dialog open={showProofSheet} onOpenChange={setShowProofSheet}>
        <DialogContent className={isMobile ? "max-w-[95vw] max-h-[95vh] overflow-y-auto p-0" : "max-w-[95vw] max-h-[95vh] overflow-auto p-0"}>
          {isMobile ? (
            <MobileProofSheet
              views={(() => {
                const viewLabels: Record<string, string> = { side: 'Driver Side', 'passenger-side': 'Passenger Side', hood_detail: 'Hood', front: 'Front', rear: 'Rear', 'close-up': 'Close-Up', roof: 'Roof' };
                const order = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
                return order
                  .map(t => allViews.find(v => v.type === t))
                  .filter((v): v is typeof allViews[number] => !!v && !!v.url)
                  .map(v => ({ type: v.type, url: v.url, label: viewLabels[v.type] || v.type }));
              })()}
              vehicleYear={year}
              vehicleMake={make}
              vehicleModel={model}
              toolKey="approvepro"
              designName={designFile?.fileName || "Design Proof"}
              manufacturer="Custom Design"
              finish="gloss"
            />
          ) : (
            <ProfessionalProofSheet
              views={(() => {
                const viewLabels: Record<string, string> = { side: 'Driver Side', 'passenger-side': 'Passenger Side', hood_detail: 'Hood', front: 'Front', rear: 'Rear', 'close-up': 'Close-Up', roof: 'Roof' };
                const order = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
                return order
                  .map(t => allViews.find(v => v.type === t))
                  .filter((v): v is typeof allViews[number] => !!v && !!v.url)
                  .map(v => ({ type: v.type, url: v.url, label: viewLabels[v.type] || v.type }));
              })()}
              vehicleYear={year}
              vehicleMake={make}
              vehicleModel={model}
              manufacturer="Custom Design"
              colorName={designFile?.fileName || "Design Proof"}
              finish="gloss"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 2D Proof Sheet Dialog */}
      <Dialog open={show2DProofSheet} onOpenChange={setShow2DProofSheet}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto p-0">
          <TwoDProofSheet
            views={(() => {
              const viewLabels: Record<string, string> = { side: 'Driver Side', 'passenger-side': 'Passenger Side', front: 'Front', rear: 'Rear', roof: 'Roof' };
              const order = ['side', 'passenger-side', 'front', 'rear', 'roof'];
              return order
                .map(t => allViews.find(v => v.type === t))
                .filter((v): v is typeof allViews[number] => !!v && !!v.url)
                .map(v => ({ type: v.type, url: v.url, label: viewLabels[v.type] || v.type }));
            })()}
            vehicleYear={year}
            vehicleMake={make}
            vehicleModel={model}
            toolKey="approvepro"
            designName={designFile?.fileName || "Design Proof"}
            manufacturer="Custom Design"
            finish="gloss"
          />
        </DialogContent>
      </Dialog>

      {/* Production Pack Dialog */}
      <ProductionPackDialog
        open={showProductionDialog}
        onOpenChange={setShowProductionDialog}
        render={visualizationId ? {
          id: visualizationId,
          render_urls: allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {} as Record<string, string>),
          vehicle_year: year,
          vehicle_make: make,
          vehicle_model: model,
          design_file_name: designFile?.fileName,
        } : null}
      />
    </div>
  );
};