import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { useSubscriptionLimits } from "./useSubscriptionLimits";
import { toast } from "@/hooks/use-toast";
import type { ColorZone, MaterialEstimate } from "@/components/colorpro/MaterialEstimateDisplay";

export interface CustomStylingJob {
  id: string;
  styling_prompt: string;
  reference_image_url: string | null;
  vehicle_year: string;
  vehicle_make: string;
  vehicle_model: string;
  hero_render_url: string | null;
  render_urls: Record<string, string>;
  color_zones: any[];
  material_estimate: Record<string, any>;
  status: string;
  created_at: string;
}

// Zone coverage percentages for full vehicle
const ZONE_PERCENTAGES: Record<string, number> = {
  hood: 8,
  roof: 10,
  body: 35,
  doors: 20,
  fenders: 8,
  bumpers: 8,
  trunk: 6,
  mirrors: 1,
  trim: 2,
  accents: 1,
  stripes: 1,
};

// Parse styling prompt to extract color zones with manufacturer info
export const parseColorZonesFromPrompt = (prompt: string): Array<{ 
  zone: string; 
  color: string; 
  finish: string;
  manufacturer: string;
}> => {
  const zones: Array<{ zone: string; color: string; finish: string; manufacturer: string }> = [];
  const promptLower = prompt.toLowerCase();
  
  // Known manufacturers
  const manufacturers = [
    { name: '3M', patterns: ['3m', '3m®', '3m™'] },
    { name: 'Avery Dennison', patterns: ['avery', 'avery dennison'] },
    { name: 'Hexis', patterns: ['hexis'] },
    { name: 'KPMF', patterns: ['kpmf'] },
    { name: 'Inozetek', patterns: ['inozetek'] },
    { name: 'Oracal', patterns: ['oracal'] },
    { name: 'Arlon', patterns: ['arlon'] },
    { name: 'TeckWrap', patterns: ['teckwrap', 'teck wrap'] },
    { name: 'VViViD', patterns: ['vvivid'] },
  ];
  
  // Common zone keywords
  const zoneKeywords = [
    'hood', 'roof', 'body', 'doors', 'door', 'fenders', 'fender', 
    'bumpers', 'bumper', 'trunk', 'mirrors', 'mirror', 'trim', 
    'accents', 'accent', 'stripes', 'stripe', 'pillars', 'a-pillars',
    'side', 'sides', 'panels', 'panel', 'wheel arches', 'rocker',
    'top', 'bottom', 'upper', 'lower'
  ];
  
  // Common finish keywords
  const finishKeywords = ['matte', 'gloss', 'satin', 'brushed', 'chrome', 'metallic', 'carbon fiber', 'carbon'];
  
  // Common color keywords
  const colorKeywords = [
    'black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple',
    'gold', 'silver', 'bronze', 'pink', 'grey', 'gray', 'brown', 'tan',
    'navy', 'teal', 'cyan', 'magenta', 'charcoal', 'cream', 'beige', 'copper'
  ];
  
  // Split by common separators
  const segments = prompt.split(/(?:and|,|;|\.|with)/i).map(s => s.trim()).filter(Boolean);
  
  for (const segment of segments) {
    const segmentLower = segment.toLowerCase();
    
    // Find manufacturer
    let foundManufacturer = '';
    for (const mfr of manufacturers) {
      if (mfr.patterns.some(p => segmentLower.includes(p))) {
        foundManufacturer = mfr.name;
        break;
      }
    }
    
    // Find zones mentioned in this segment
    const foundZones: string[] = [];
    for (const zone of zoneKeywords) {
      if (segmentLower.includes(zone)) {
        // Normalize zone name
        let normalizedZone = zone;
        if (zone === 'door') normalizedZone = 'doors';
        if (zone === 'fender') normalizedZone = 'fenders';
        if (zone === 'bumper') normalizedZone = 'bumpers';
        if (zone === 'mirror') normalizedZone = 'mirrors';
        if (zone === 'accent') normalizedZone = 'accents';
        if (zone === 'stripe') normalizedZone = 'stripes';
        if (zone === 'panel' || zone === 'panels' || zone === 'side' || zone === 'sides') normalizedZone = 'body';
        if (zone === 'pillars' || zone === 'a-pillars') normalizedZone = 'trim';
        if (zone === 'wheel arches' || zone === 'rocker') normalizedZone = 'trim';
        if (zone === 'upper') normalizedZone = 'top';
        if (zone === 'lower') normalizedZone = 'bottom';
        
        if (!foundZones.includes(normalizedZone)) {
          foundZones.push(normalizedZone);
        }
      }
    }
    
    // Find finish in segment
    let foundFinish = 'Gloss'; // default
    for (const finish of finishKeywords) {
      if (segmentLower.includes(finish)) {
        foundFinish = finish.charAt(0).toUpperCase() + finish.slice(1);
        break;
      }
    }
    
    // Find color in segment - extract full color phrase
    let foundColor = '';
    // First try to extract color with finish (e.g., "Gold Chrome", "Satin Black")
    const colorWithFinish = segment.replace(/3m|avery|hexis|kpmf|inozetek|oracal|arlon|teckwrap|vvivid/gi, '').trim();
    if (colorWithFinish) {
      foundColor = colorWithFinish.replace(/\s+(on|for|the)\s+.*/i, '').trim();
      // Clean up zone words from color
      foundColor = foundColor.replace(/\b(top|bottom|roof|hood|body|doors?|fenders?|bumpers?|sides?)\b/gi, '').trim();
    }
    
    // Fallback to basic color
    if (!foundColor) {
      for (const color of colorKeywords) {
        if (segmentLower.includes(color)) {
          foundColor = color.charAt(0).toUpperCase() + color.slice(1);
          break;
        }
      }
    }
    
    // Create zones with found data
    if (foundZones.length > 0 && (foundColor || foundManufacturer)) {
      for (const zone of foundZones) {
        const existing = zones.find(z => z.zone === zone);
        if (!existing) {
          zones.push({
            zone,
            color: foundColor || 'Custom',
            finish: foundFinish,
            manufacturer: foundManufacturer,
          });
        }
      }
    } else if (foundColor && foundManufacturer) {
      // No zone specified, add as full body
      zones.push({
        zone: 'body',
        color: foundColor,
        finish: foundFinish,
        manufacturer: foundManufacturer,
      });
    }
  }
  
  // If no zones found, create a default "full body" zone
  if (zones.length === 0) {
    zones.push({ zone: 'body', color: 'Custom', finish: 'Gloss', manufacturer: '' });
  }
  
  return zones;
};

export const useCustomStylingLogic = () => {
  const { checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  
  // Form state
  const [stylingPrompt, setStylingPrompt] = useState("");
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [referenceDescription, setReferenceDescription] = useState("");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  
  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [allViews, setAllViews] = useState<Array<{ type: string; url: string }>>([]);
  const [isGeneratingAdditional, setIsGeneratingAdditional] = useState(false);
  const [pendingViews, setPendingViews] = useState<string[]>([]);
  
  // Material estimate state
  const [materialEstimate, setMaterialEstimate] = useState<MaterialEstimate | null>(null);
  const [isCalculatingMaterial, setIsCalculatingMaterial] = useState(false);
  
  // Modal state
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Save material estimate to database
  const saveMaterialEstimate = useCallback(async (jobId: string, estimate: MaterialEstimate) => {
    try {
      // Cast to JSON-compatible format for Supabase
      const jsonEstimate = JSON.parse(JSON.stringify(estimate));
      await supabase
        .from('custom_styling_jobs')
        .update({ material_estimate: jsonEstimate })
        .eq('id', jobId);
    } catch (error) {
      console.error('Failed to save material estimate:', error);
    }
  }, []);

  // Calculate material estimate from prompt and vehicle
  const calculateMaterialEstimate = useCallback(async (
    prompt: string,
    vehicleYear: string,
    vehicleMake: string,
    vehicleModel: string,
    jobId?: string
  ): Promise<MaterialEstimate | null> => {
    if (!prompt || !vehicleYear || !vehicleMake || !vehicleModel) {
      return null;
    }

    setIsCalculatingMaterial(true);

    try {
      // First get base vehicle yardage
      const { data: baseData, error: baseError } = await renderClient.functions.invoke('calculate-film-yards', {
        body: { vehicleYear, vehicleMake, vehicleModel }
      });

      if (baseError) {
        console.error('Failed to calculate base yards:', baseError);
        throw baseError;
      }

      const baseYards = baseData?.yards || 30;
      const baseSquareFeet = baseData?.squareFeet || 150;
      const vehicleCategory = baseData?.category || 'Mid-size';

      // Parse zones from prompt
      const parsedZones = parseColorZonesFromPrompt(prompt);
      
      // Calculate per-zone yardage
      const zones: ColorZone[] = parsedZones.map(zone => {
        const percentage = ZONE_PERCENTAGES[zone.zone] || 5;
        const yardsEstimate = (baseYards * percentage / 100) * 1.15; // 15% waste
        
        return {
          zone: zone.zone.charAt(0).toUpperCase() + zone.zone.slice(1),
          color: zone.color,
          finish: zone.finish,
          percentageOfVehicle: percentage,
          yardsEstimate: Math.round(yardsEstimate * 10) / 10
        };
      });

      // Calculate totals
      const totalYards = Math.round(zones.reduce((sum, z) => sum + z.yardsEstimate, 0) * 10) / 10;
      
      const estimate: MaterialEstimate = {
        totalYards: Math.max(totalYards, baseYards),
        totalSquareFeet: baseSquareFeet,
        vehicleCategory,
        zones
      };

      setMaterialEstimate(estimate);
      
      // Auto-save to database if we have a job ID
      if (jobId || currentJobId) {
        await saveMaterialEstimate(jobId || currentJobId!, estimate);
        toast({
          title: "Material Estimate Saved",
          description: "Estimate saved to your design for reference"
        });
      }
      
      return estimate;
    } catch (error) {
      console.error('Material calculation error:', error);
      return null;
    } finally {
      setIsCalculatingMaterial(false);
    }
  }, [currentJobId, saveMaterialEstimate]);

  const validateInputs = () => {
    if (!stylingPrompt || stylingPrompt.length < 20) {
      toast({
        title: "Styling description required",
        description: "Please describe your custom styling in at least 20 characters",
        variant: "destructive"
      });
      return false;
    }

    if (!year || !make || !model) {
      toast({
        title: "Vehicle required",
        description: "Please enter year, make, and model",
        variant: "destructive"
      });
      return false;
    }

    return true;
  };

  const generateCustomStyling = async () => {
    if (!validateInputs()) {
      return { success: false, error: "Validation failed" };
    }

    // Check subscription limits
    const canGenerate = await checkCanGenerate();
    if (!canGenerate) {
      setShowUpgradeModal(true);
      return { success: false, error: "Subscription limit reached" };
    }

    setIsGenerating(true);
    setGeneratedImageUrl(null);
    setAllViews([]);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userEmail = user?.email;
      const userId = user?.id;

      // Create job record first
      const { data: jobData, error: jobError } = await supabase
        .from('custom_styling_jobs')
        .insert({
          user_id: userId,
          user_email: userEmail,
          vehicle_year: year,
          vehicle_make: make,
          vehicle_model: model,
          styling_prompt: stylingPrompt,
          reference_image_url: referenceImageUrl,
          status: 'generating',
          generation_started_at: new Date().toISOString()
        })
        .select()
        .single();

      if (jobError) {
        console.error('Failed to create job record:', jobError);
        throw jobError;
      }

      setCurrentJobId(jobData.id);

      // Call generate-color-render with CustomStyling mode
      const { data, error } = await renderClient.functions.invoke('generate-color-render', {
        body: {
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          colorData: {
            customStylingPrompt: stylingPrompt,
            referenceImageUrl: referenceImageUrl,
            referenceDescription: referenceDescription,
          },
          modeType: 'ColorProEnhanced',
          viewType: 'roof',
          userEmail,
          customStylingJobId: jobData.id
        }
      });

      if (error) {
        console.error("Edge function error:", error);
        
        // Update job status to failed
        await supabase
          .from('custom_styling_jobs')
          .update({ status: 'failed' })
          .eq('id', jobData.id);
          
        throw error;
      }

      if (data?.renderUrl) {
        const newViews = [{ type: 'roof', url: data.renderUrl }];
        setGeneratedImageUrl(data.renderUrl);
        setAllViews(newViews);

        // Update job with render URL
        await supabase
          .from('custom_styling_jobs')
          .update({
            hero_render_url: data.renderUrl,
            render_urls: { roof: data.renderUrl },
            color_zones: data.colorZones || [],
            material_estimate: data.materialEstimate || {},
            status: 'completed',
            generation_completed_at: new Date().toISOString()
          })
          .eq('id', jobData.id);

        await incrementRenderCount();

        toast({
          title: "Custom Design Generated!",
          description: "Your multi-zone styling is ready. Generate additional views for more angles."
        });

        return { success: true, imageUrl: data.renderUrl, jobId: jobData.id };
      }

      throw new Error("No render URL returned");
    } catch (error: any) {
      console.error("Custom styling generation error:", error);
      toast({
        title: "Generation Failed",
        description: error.message || "An unexpected error occurred",
        variant: "destructive"
      });
      return { success: false, error: error.message };
    } finally {
      setIsGenerating(false);
    }
  };

  const generateAdditionalViews = async () => {
    if (!currentJobId || !generatedImageUrl) {
      return { success: false, error: "No active job" };
    }

    setIsGeneratingAdditional(true);
    const additionalViewTypes = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
    setPendingViews(additionalViewTypes);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userEmail = user?.email;

      const generatedViews = [...allViews];

      // PARALLEL execution with retry per view
      const allRenderUrls: Record<string, string> = { roof: generatedImageUrl };

      const viewResults = await Promise.all(
        additionalViewTypes.map(async (viewType) => {
          try {
            const { data, error } = await renderClient.functions.invoke('generate-color-render', {
              body: {
                vehicleYear: year,
                vehicleMake: make,
                vehicleModel: model,
                colorData: {
                  customStylingPrompt: stylingPrompt,
                  referenceImageUrl: referenceImageUrl,
                  referenceDescription: referenceDescription,
                },
                modeType: 'ColorProEnhanced',
                viewType,
                userEmail,
                customStylingJobId: currentJobId,
                skipLookups: true
              }
            });

            if (error) {
              console.error(`❌ View ${viewType} failed:`, error.message || error);
              setPendingViews(prev => prev.filter(v => v !== viewType));
              return null;
            }

            if (data?.renderUrl) {
              const newView = { type: viewType, url: data.renderUrl };
              generatedViews.push(newView);
              allRenderUrls[viewType] = data.renderUrl;
              setAllViews(prev => {
                const exists = prev.some(v => v.type === viewType);
                if (exists) return prev;
                const updated = [...prev, newView];
                const order = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
                updated.sort((a, b) => (order.indexOf(a.type) === -1 ? 999 : order.indexOf(a.type)) - (order.indexOf(b.type) === -1 ? 999 : order.indexOf(b.type)));
                return updated;
              });
              setPendingViews(prev => prev.filter(v => v !== viewType));
              return newView;
            }
            setPendingViews(prev => prev.filter(v => v !== viewType));
            return null;
          } catch (err: any) {
            console.error(`❌ View ${viewType} threw:`, err.message || err);
            setPendingViews(prev => prev.filter(v => v !== viewType));
            return null;
          }
        })
      );

      const failCount = viewResults.filter(v => v === null).length;

      await supabase
        .from('custom_styling_jobs')
        .update({ render_urls: allRenderUrls })
        .eq('id', currentJobId);

      toast({
        title: failCount === 0 ? "All Views Complete" : "Views Generated",
        description: failCount === 0
          ? `Generated ${generatedViews.length} views of your custom styling!`
          : `${additionalViewTypes.length - failCount} of ${additionalViewTypes.length} views completed. ${failCount} failed.`,
        variant: failCount === additionalViewTypes.length ? "destructive" : "default",
      });

      return { success: true, views: generatedViews };
    } catch (error: any) {
      console.error("Additional views generation error:", error);
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate additional views",
        variant: "destructive"
      });
      return { success: false, error: error.message };
    } finally {
      setIsGeneratingAdditional(false);
      setPendingViews([]);
    }
  };

  const clearCustomStyling = () => {
    setStylingPrompt("");
    setReferenceImageUrl(null);
    setReferenceDescription("");
    setGeneratedImageUrl(null);
    setCurrentJobId(null);
    setAllViews([]);
    setMaterialEstimate(null);
  };

  const handleReferenceUploaded = (url: string | null, description?: string) => {
    setReferenceImageUrl(url);
    if (description !== undefined) {
      setReferenceDescription(description);
    }
  };

  // Parse colors from prompt for UI display
  const parsedColorZones = parseColorZonesFromPrompt(stylingPrompt);

  return {
    // Form state
    stylingPrompt,
    setStylingPrompt,
    referenceImageUrl,
    referenceDescription,
    handleReferenceUploaded,
    year,
    setYear,
    make,
    setMake,
    model,
    setModel,
    
    // Generation state
    isGenerating,
    generatedImageUrl,
    currentJobId,
    allViews,
    isGeneratingAdditional,
    pendingViews,
    
    // Material estimate
    materialEstimate,
    isCalculatingMaterial,
    calculateMaterialEstimate,
    
    // Parsed color info for UI
    parsedColorZones,
    
    // Actions
    generateCustomStyling,
    generateAdditionalViews,
    clearCustomStyling,
    
    // Modal
    showUpgradeModal,
    setShowUpgradeModal,
  };
};
