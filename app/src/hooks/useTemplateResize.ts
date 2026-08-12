/**
 * useTemplateResize — Canvas-based tool for scaling/positioning designs onto vehicle templates
 *
 * Handles:
 * - Loading flat panel images from artboard/renders
 * - Loading SVG vehicle templates from Supabase Storage
 * - Transform math (scale, position, aspect ratio lock)
 * - Export at production DPI via offscreen canvas
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import Konva from "konva";

export interface TemplateInfo {
  id: string;
  panel_type: string;
  width_inches: number;
  height_inches: number;
  file_url: string;
  storage_path: string;
  template_format: string;
  original_filename: string;
}

interface UseTemplateResizeOptions {
  vehicleMake?: string;
  vehicleModel?: string;
  jobId?: string;
  userId?: string;
}

interface TransformState {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export function useTemplateResize(opts: UseTemplateResizeOptions) {
  const { vehicleMake, vehicleModel, jobId, userId } = opts;

  // Template list
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateInfo | null>(null);
  const [templateImage, setTemplateImage] = useState<HTMLImageElement | null>(null);

  // Design image
  const [designImage, setDesignImage] = useState<HTMLImageElement | null>(null);
  const [designUrl, setDesignUrl] = useState<string | null>(null);

  // Canvas config
  const [dpi, setDpi] = useState(150);
  const [aspectLocked, setAspectLocked] = useState(true);
  const [showTemplate, setShowTemplate] = useState(true);

  // Transform
  const [transform, setTransform] = useState<TransformState>({
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  });

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);

  // Stage ref for export
  const stageRef = useRef<Konva.Stage | null>(null);

  // Fetch templates for this vehicle
  const fetchTemplates = useCallback(async () => {
    if (!vehicleMake || !vehicleModel) return;
    const { data, error } = await supabase
      .from("vehicle_wrap_templates" as any)
      .select("*")
      .ilike("vehicle_make", vehicleMake)
      .ilike("vehicle_model", vehicleModel)
      .order("created_at", { ascending: false });
    if (!error && data) setTemplates(data as any[]);
  }, [vehicleMake, vehicleModel]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // Load template image (SVG → Image element)
  const loadTemplateImage = useCallback(async (tmpl: TemplateInfo) => {
    setSelectedTemplate(tmpl);

    // Get signed URL for the template file
    const { data } = await supabase.storage
      .from("wrap-files")
      .createSignedUrl(tmpl.storage_path, 3600);

    if (!data?.signedUrl) return;

    if (tmpl.template_format === "svg") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => setTemplateImage(img);
      img.src = data.signedUrl;
    } else {
      // EPS — render as outline rectangle placeholder
      // (EPS can't render in browser; show bounding box outline)
      const canvas = document.createElement("canvas");
      const w = tmpl.width_inches * 72; // pts
      const h = tmpl.height_inches * 72;
      canvas.width = Math.min(w, 2000);
      canvas.height = Math.min(h, 2000);
      const ctx = canvas.getContext("2d")!;
      ctx.strokeStyle = "#00C7FF";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 5]);
      ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
      ctx.font = "16px sans-serif";
      ctx.fillStyle = "#00C7FF";
      ctx.fillText(`${tmpl.original_filename}`, 10, 24);
      ctx.fillText(`${tmpl.width_inches}" × ${tmpl.height_inches}"`, 10, 46);

      const img = new Image();
      img.onload = () => setTemplateImage(img);
      img.src = canvas.toDataURL();
    }
  }, []);

  // Load design image from URL
  const loadDesignImage = useCallback((url: string) => {
    setDesignUrl(url);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setDesignImage(img);
      // Auto-center on load
      if (selectedTemplate) {
        const canvasW = selectedTemplate.width_inches * dpi;
        const canvasH = selectedTemplate.height_inches * dpi;
        const fitScale = Math.min(canvasW / img.width, canvasH / img.height);
        setTransform({
          x: (canvasW - img.width * fitScale) / 2,
          y: (canvasH - img.height * fitScale) / 2,
          scaleX: fitScale,
          scaleY: fitScale,
          rotation: 0,
        });
      }
    };
    img.src = url;
  }, [selectedTemplate, dpi]);

  // Fit design to template
  const fitToTemplate = useCallback(() => {
    if (!designImage || !selectedTemplate) return;
    const canvasW = selectedTemplate.width_inches * dpi;
    const canvasH = selectedTemplate.height_inches * dpi;
    const fitScale = Math.min(canvasW / designImage.width, canvasH / designImage.height);
    setTransform({
      x: (canvasW - designImage.width * fitScale) / 2,
      y: (canvasH - designImage.height * fitScale) / 2,
      scaleX: fitScale,
      scaleY: fitScale,
      rotation: 0,
    });
  }, [designImage, selectedTemplate, dpi]);

  // Fill (stretch to cover)
  const fillTemplate = useCallback(() => {
    if (!designImage || !selectedTemplate) return;
    const canvasW = selectedTemplate.width_inches * dpi;
    const canvasH = selectedTemplate.height_inches * dpi;
    const fillScale = Math.max(canvasW / designImage.width, canvasH / designImage.height);
    setTransform({
      x: (canvasW - designImage.width * fillScale) / 2,
      y: (canvasH - designImage.height * fillScale) / 2,
      scaleX: fillScale,
      scaleY: fillScale,
      rotation: 0,
    });
  }, [designImage, selectedTemplate, dpi]);

  // Center design
  const centerDesign = useCallback(() => {
    if (!designImage || !selectedTemplate) return;
    const canvasW = selectedTemplate.width_inches * dpi;
    const canvasH = selectedTemplate.height_inches * dpi;
    setTransform((prev) => ({
      ...prev,
      x: (canvasW - designImage.width * prev.scaleX) / 2,
      y: (canvasH - designImage.height * prev.scaleY) / 2,
    }));
  }, [designImage, selectedTemplate, dpi]);

  // Export at full DPI via offscreen canvas
  const exportCanvas = useCallback(async () => {
    if (!selectedTemplate || !designImage || !stageRef.current) return;

    setExporting(true);
    try {
      const fullW = Math.round(selectedTemplate.width_inches * dpi);
      const fullH = Math.round(selectedTemplate.height_inches * dpi);

      // Get viewport dimensions
      const stage = stageRef.current;
      const viewW = stage.width();
      const viewH = stage.height();

      // Scale factor from viewport to full export
      const exportScale = fullW / viewW;

      // Export at full resolution
      const dataUrl = stage.toDataURL({
        pixelRatio: exportScale,
        mimeType: "image/png",
      });

      // Convert data URL to blob
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());

      // Upload to Supabase Storage
      const storagePath = `production-packs/${userId || "anon"}/${jobId || "manual"}/resized-${selectedTemplate.panel_type}-${Date.now()}.png`;

      const { error: uploadErr } = await supabase.storage
        .from("wrap-files")
        .upload(storagePath, bytes, {
          contentType: "image/png",
          upsert: true,
        });

      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

      const { data: signedData } = await supabase.storage
        .from("wrap-files")
        .createSignedUrl(storagePath, 60 * 60 * 24 * 30); // 30 days

      setExportedUrl(signedData?.signedUrl || null);
      return {
        storagePath,
        signedUrl: signedData?.signedUrl || "",
        widthPx: fullW,
        heightPx: fullH,
        dpi,
      };
    } finally {
      setExporting(false);
    }
  }, [selectedTemplate, designImage, dpi, userId, jobId]);

  return {
    // Template
    templates,
    selectedTemplate,
    templateImage,
    loadTemplateImage,
    fetchTemplates,
    // Design
    designImage,
    designUrl,
    loadDesignImage,
    // Canvas config
    dpi,
    setDpi,
    aspectLocked,
    setAspectLocked,
    showTemplate,
    setShowTemplate,
    // Transform
    transform,
    setTransform,
    // Actions
    fitToTemplate,
    fillTemplate,
    centerDesign,
    exportCanvas,
    // Export state
    exporting,
    exportedUrl,
    // Refs
    stageRef,
  };
}
