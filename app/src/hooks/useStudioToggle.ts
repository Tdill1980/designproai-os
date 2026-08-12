/**
 * useStudioToggle - Shared hook for light/dark studio toggle.
 *
 * When the user clicks the sun/moon toggle, this hook:
 * 1. Calls generate-color-render with studioMode='light' for the hero view
 * 2. Stores the light render URL in render_urls as '{viewType}_light'
 * 3. Toggles between showing original (dark) and light studio version
 *
 * The light version is cached - once generated, toggling is instant.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface StudioToggleState {
  /** Set of record IDs currently showing light studio */
  lightIds: Set<string>;
  /** Set of record IDs currently generating light studio */
  generatingIds: Set<string>;
  /** Toggle a record between light and dark studio */
  toggle: (record: any) => void;
  /** Check if a record is in light mode */
  isLight: (id: string) => boolean;
  /** Check if a record is generating light studio */
  isGenerating: (id: string) => boolean;
  /** Get the display URL for a record (light or dark hero) */
  getHeroUrl: (record: any) => string | null;
}

function buildColorDataFromRecord(record: any): Record<string, any> {
  const modeType = record.mode_type || "";
  const base: Record<string, any> = {
    colorName: record.color_name || "Custom",
    hex: record.color_hex || "#000000",
    finish: record.finish_type || "Gloss",
  };

  if (modeType === "approvemode" && record.custom_design_url) {
    return { ...base, designUrl: record.custom_design_url };
  }
  if ((modeType === "CustomStyling" || modeType === "ColorProEnhanced") && record.custom_styling_prompt_key) {
    return { ...base, customStylingPrompt: record.custom_styling_prompt_key };
  }
  if (modeType === "GraphicsPro" && record.custom_styling_prompt_key) {
    return { ...base, customStylingPrompt: record.custom_styling_prompt_key, colorLibrary: "graphicspro" };
  }
  if ((modeType === "fadewraps" || modeType === "wbty") && record.custom_swatch_url) {
    return { ...base, patternUrl: record.custom_swatch_url };
  }
  if (modeType === "designpanelpro" && record.custom_design_url) {
    return { ...base, designUrl: record.custom_design_url };
  }
  return base;
}

export function useStudioToggle(): StudioToggleState {
  const [lightIds, setLightIds] = useState<Set<string>>(new Set());
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());

  const isLight = useCallback((id: string) => lightIds.has(id), [lightIds]);
  const isGenerating = useCallback((id: string) => generatingIds.has(id), [generatingIds]);

  const getHeroUrl = useCallback((record: any): string | null => {
    const urls = record?.render_urls as Record<string, string> | null;
    if (!urls) return null;

    const isDesignPro = record.mode_type === "designpanelpro" || record.mode_type === "designpro";

    // If in light mode and a light version exists, show it
    if (lightIds.has(record.id)) {
      const lightUrl = isDesignPro
        ? (urls["side_light"] || urls["roof_light"])
        : (urls["roof_light"] || urls["side_light"]);
      if (lightUrl) return lightUrl;
      // Fall back to dark version if light not yet generated
    }

    // DesignProAI: prefer side (original branded render with logos/text)
    if (isDesignPro) {
      return urls.side || urls.roof || Object.values(urls)[0] || null;
    }
    return urls.roof || urls.front || Object.values(urls)[0] || null;
  }, [lightIds]);

  const toggle = useCallback(async (record: any) => {
    const id = record.id;
    const urls = record.render_urls as Record<string, string> | null;

    // If already in light mode, switch back to dark (instant)
    if (lightIds.has(id)) {
      setLightIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }

    // Check if light version already exists (cached)
    if (urls && (urls["roof_light"] || urls["side_light"])) {
      setLightIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      return;
    }

    // Generate light studio version
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) {
      toast.error("Please log in to switch studio mode.");
      return;
    }

    setGeneratingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    toast.info("Generating light studio version...", {
      description: "This takes ~30 seconds. It only needs to be generated once.",
    });

    try {
      // Generate hero view in light studio
      const viewType = urls?.roof ? "roof" : urls?.side ? "side" : "roof";
      const colorData = buildColorDataFromRecord(record);

      const { data, error } = await supabase.functions.invoke("generate-color-render", {
        body: {
          vehicleYear: String(record.vehicle_year),
          vehicleMake: record.vehicle_make,
          vehicleModel: record.vehicle_model,
          colorData,
          modeType: record.mode_type || "colorpro",
          viewType,
          userEmail: user.email,
          studioMode: "light",
          skipLookups: true,
        },
      });

      if (error) throw error;

      const renderUrl = data?.renderUrl;
      if (renderUrl) {
        // Store as {viewType}_light in render_urls
        const lightKey = `${viewType}_light`;
        const updatedUrls = { ...(urls || {}), [lightKey]: renderUrl };

        await supabase
          .from("color_visualizations")
          .update({
            render_urls: updatedUrls,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        // Update the record in-place so the UI reflects it
        record.render_urls = updatedUrls;

        // Switch to light mode
        setLightIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });

        toast.success("Light studio version ready!");
      } else {
        throw new Error("No render URL returned");
      }
    } catch (err: any) {
      console.error("Light studio generation failed:", err);
      toast.error("Failed to generate light studio version");
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [lightIds]);

  return { lightIds, generatingIds, toggle, isLight, isGenerating, getHeroUrl };
}
