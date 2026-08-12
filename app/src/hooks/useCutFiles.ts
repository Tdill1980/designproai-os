import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RenderLike {
  id: string;
  mode_type?: string;
  render_urls?: Record<string, string> | null;
  vehicle_year?: number | string;
  vehicle_make?: string;
  vehicle_model?: string;
  design_file_name?: string;
  color_name?: string;
}

export function useCutFiles() {
  const [isGeneratingCutFiles, setIsGeneratingCutFiles] = useState(false);

  const handleGenerateCutFiles = async (render: RenderLike) => {
    const isDesignPro = render.mode_type === "designpanelpro" || render.mode_type === "designpro";
    const urls = render.render_urls as Record<string, string> | null;
    const brandedUrl = isDesignPro
      ? (urls?.side || urls?.hero || Object.values(urls || {})[0])
      : (urls?.hero || urls?.side || Object.values(urls || {})[0]);

    if (!brandedUrl) {
      toast.error("No render image available for cut file generation.");
      return;
    }

    setIsGeneratingCutFiles(true);
    toast.info("Generating cut files... This may take 1-2 minutes.", { duration: 10000 });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000); // 3 min client timeout

    try {
      const { data, error } = await supabase.functions.invoke("generate-cut-files", {
        body: {
          renderUrl: brandedUrl,
          designName: render.design_file_name || render.color_name || "Custom Design",
          vehicleYear: String(render.vehicle_year || ""),
          vehicleMake: render.vehicle_make || "",
          vehicleModel: render.vehicle_model || "",
          visualizationId: render.id,
        },
      });

      if (error) {
        const detail = (data as any)?.error || (data as any)?.message || error.message;
        throw new Error(detail);
      }

      if (data?.success && data?.downloadUrl) {
        window.open(data.downloadUrl, "_blank");
        toast.success(`Cut files ready! ${data.elementCount} element(s) extracted.`);
      } else {
        const detail = data?.error || "No text/logo elements found on this render, or generation failed.";
        toast.error(detail, { duration: 15000 });
      }
    } catch (err: any) {
      console.error("Cut file generation error:", err);
      const msg = err.name === "AbortError"
        ? "Cut file generation timed out. Please try again."
        : (err.message || "Failed to generate cut files");
      toast.error(msg, { duration: 15000 });
    } finally {
      clearTimeout(timeout);
      setIsGeneratingCutFiles(false);
    }
  };

  return { isGeneratingCutFiles, handleGenerateCutFiles };
}
