/**
 * VehicleTemplateUpload — Upload EPS/SVG vehicle wrap templates
 *
 * Parses dimensions from EPS BoundingBox or SVG viewBox/width/height.
 * Stores template file in Supabase Storage + metadata in vehicle_wrap_templates table.
 * Used on the QC Artboard page for production panel sizing.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileText, Trash2, Loader2, Ruler } from "lucide-react";
import { toast } from "sonner";

const PANEL_TYPES = [
  { value: "full", label: "Full Wrap Template" },
  { value: "side", label: "Side Panel" },
  { value: "hood", label: "Hood" },
  { value: "roof", label: "Roof" },
  { value: "rear", label: "Rear" },
  { value: "front-bumper", label: "Front Bumper" },
  { value: "rear-bumper", label: "Rear Bumper" },
];

/** Parse EPS BoundingBox → dimensions in inches (72 points per inch) */
function parseEpsDimensions(text: string): {
  bbox: [number, number, number, number];
  widthInches: number;
  heightInches: number;
} | null {
  // Match %%BoundingBox: x1 y1 x2 y2
  const match = text.match(/%%BoundingBox:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!match) return null;
  const [, x1, y1, x2, y2] = match.map(Number);
  const widthPts = x2 - x1;
  const heightPts = y2 - y1;
  return {
    bbox: [x1, y1, x2, y2],
    widthInches: Math.round((widthPts / 72) * 100) / 100,
    heightInches: Math.round((heightPts / 72) * 100) / 100,
  };
}

/** Parse SVG viewBox or width/height → dimensions */
function parseSvgDimensions(text: string): {
  bbox: [number, number, number, number];
  widthInches: number;
  heightInches: number;
} | null {
  // Try viewBox first
  const vbMatch = text.match(/viewBox\s*=\s*"([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)"/);
  if (vbMatch) {
    const [, x, y, w, h] = vbMatch.map(Number);
    // SVG units are typically px at 96 DPI
    return {
      bbox: [x, y, x + w, y + h],
      widthInches: Math.round((w / 96) * 100) / 100,
      heightInches: Math.round((h / 96) * 100) / 100,
    };
  }
  // Try width/height attributes (could be in inches, px, etc.)
  const wMatch = text.match(/width\s*=\s*"([\d.]+)(in|px|pt|mm)?"/);
  const hMatch = text.match(/height\s*=\s*"([\d.]+)(in|px|pt|mm)?"/);
  if (wMatch && hMatch) {
    let w = Number(wMatch[1]);
    let h = Number(hMatch[1]);
    const unit = wMatch[2] || "px";
    if (unit === "pt") { w /= 72; h /= 72; }
    else if (unit === "px") { w /= 96; h /= 96; }
    else if (unit === "mm") { w /= 25.4; h /= 25.4; }
    // "in" stays as-is
    return {
      bbox: [0, 0, w * 72, h * 72],
      widthInches: Math.round(w * 100) / 100,
      heightInches: Math.round(h * 100) / 100,
    };
  }
  return null;
}

interface Props {
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: string;
}

export default function VehicleTemplateUpload({ vehicleMake, vehicleModel, vehicleYear }: Props) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [panelType, setPanelType] = useState("full");
  const [parsedDims, setParsedDims] = useState<{ widthInches: number; heightInches: number } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // Manual dimension override
  const [manualWidth, setManualWidth] = useState("");
  const [manualHeight, setManualHeight] = useState("");

  // Fetch existing templates for this vehicle
  const { data: templates } = useQuery({
    queryKey: ["vehicle-templates", vehicleMake, vehicleModel],
    enabled: !!vehicleMake && !!vehicleModel,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_wrap_templates" as any)
        .select("*")
        .ilike("vehicle_make", vehicleMake || "")
        .ilike("vehicle_model", vehicleModel || "")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  // Handle file selection — read first 4KB to parse dimensions
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const name = file.name.toLowerCase();
    const isEps = name.endsWith(".eps") || name.endsWith(".ai");
    const isSvg = name.endsWith(".svg");

    if (!isEps && !isSvg) {
      toast.error("Please upload an EPS, AI, or SVG file");
      e.target.value = "";
      return;
    }

    setSelectedFile(file);

    // Read first chunk to parse dimensions
    try {
      const chunk = file.slice(0, 8192);
      const text = await chunk.text();
      const dims = isEps ? parseEpsDimensions(text) : parseSvgDimensions(text);
      if (dims) {
        setParsedDims(dims);
        setManualWidth(String(dims.widthInches));
        setManualHeight(String(dims.heightInches));
        toast.success(`Parsed: ${dims.widthInches}" × ${dims.heightInches}"`);
      } else {
        setParsedDims(null);
        setManualWidth("");
        setManualHeight("");
        toast.info("Could not auto-detect dimensions — enter manually");
      }
    } catch {
      setParsedDims(null);
    }
  }, []);

  // Upload template
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile || !vehicleMake || !vehicleModel) {
        throw new Error("Missing file or vehicle info");
      }

      const w = Number(manualWidth);
      const h = Number(manualHeight);
      if (!w || !h) throw new Error("Enter valid dimensions");

      setUploading(true);

      const ext = selectedFile.name.split(".").pop() || "eps";
      const format = ext === "svg" ? "svg" : "eps";
      const safeMake = vehicleMake.toLowerCase().replace(/\s+/g, "-");
      const safeModel = vehicleModel.toLowerCase().replace(/\s+/g, "-");
      const storagePath = `templates/${safeMake}/${safeModel}/${panelType}_${Date.now()}.${ext}`;

      // Upload file to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("wrap-files")
        .upload(storagePath, selectedFile, {
          contentType: format === "svg" ? "image/svg+xml" : "application/postscript",
          upsert: true,
        });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const { data: urlData } = supabase.storage
        .from("wrap-files")
        .getPublicUrl(storagePath);

      // Insert metadata into vehicle_wrap_templates
      const { error: dbError } = await supabase
        .from("vehicle_wrap_templates" as any)
        .insert({
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          vehicle_year_range: vehicleYear || null,
          panel_type: panelType,
          template_format: format,
          storage_path: storagePath,
          file_url: urlData.publicUrl,
          bbox_x1: parsedDims ? 0 : null,
          bbox_y1: parsedDims ? 0 : null,
          bbox_x2: parsedDims ? w * 72 : null,
          bbox_y2: parsedDims ? h * 72 : null,
          width_inches: w,
          height_inches: h,
          original_filename: selectedFile.name,
          file_size_bytes: selectedFile.size,
        });

      if (dbError) throw new Error(`DB insert failed: ${dbError.message}`);

      return { width: w, height: h, path: storagePath };
    },
    onSuccess: (data) => {
      toast.success(`Template uploaded: ${data.width}" × ${data.height}"`);
      setSelectedFile(null);
      setParsedDims(null);
      setManualWidth("");
      setManualHeight("");
      queryClient.invalidateQueries({ queryKey: ["vehicle-templates"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
    onSettled: () => setUploading(false),
  });

  // Delete template
  const deleteMutation = useMutation({
    mutationFn: async (template: any) => {
      await supabase.storage.from("wrap-files").remove([template.storage_path]);
      const { error } = await supabase
        .from("vehicle_wrap_templates" as any)
        .delete()
        .eq("id", template.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Template removed");
      queryClient.invalidateQueries({ queryKey: ["vehicle-templates"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-['Montserrat'] flex items-center gap-2">
          <Ruler className="w-4 h-4 text-cyan-400" />
          Vehicle Templates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Existing templates for this vehicle */}
        {templates && templates.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Uploaded Templates</p>
            {templates.map((t: any) => (
              <div
                key={t.id}
                className="flex items-center justify-between p-2 rounded border border-border bg-muted/30"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-cyan-400" />
                  <div>
                    <span className="text-sm font-medium">{t.original_filename}</span>
                    <div className="flex gap-2 items-center">
                      <Badge variant="outline" className="text-[10px]">
                        {t.width_inches}" × {t.height_inches}"
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {t.panel_type}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {t.template_format}
                      </Badge>
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(t)}
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Upload new template */}
        <div className="space-y-2 pt-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Upload Template (EPS / SVG / AI)</p>

          <Input
            type="file"
            accept=".eps,.svg,.ai"
            onChange={handleFileSelect}
            className="text-sm"
          />

          {selectedFile && (
            <>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground">Panel Type</label>
                  <Select value={panelType} onValueChange={setPanelType}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PANEL_TYPES.map((pt) => (
                        <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground">Width (inches)</label>
                  <Input
                    type="number"
                    step="0.1"
                    value={manualWidth}
                    onChange={(e) => setManualWidth(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="e.g. 173"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground">Height (inches)</label>
                  <Input
                    type="number"
                    step="0.1"
                    value={manualHeight}
                    onChange={(e) => setManualHeight(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="e.g. 54"
                  />
                </div>
              </div>

              {parsedDims && (
                <p className="text-[10px] text-green-400">
                  Auto-detected from file: {parsedDims.widthInches}" × {parsedDims.heightInches}"
                </p>
              )}

              <Button
                onClick={() => uploadMutation.mutate()}
                disabled={uploading || !manualWidth || !manualHeight}
                size="sm"
                className="w-full"
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                Upload Template
              </Button>
            </>
          )}
        </div>

        {!vehicleMake && (
          <p className="text-xs text-muted-foreground italic">Select a job to upload templates for that vehicle.</p>
        )}
      </CardContent>
    </Card>
  );
}
