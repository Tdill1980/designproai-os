import { useState, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Play, Loader2, ChevronDown, ChevronUp } from "lucide-react";

// ── Image compression ─────────────────────────────────────────────
/** Resize image to max dimension and return compressed JPEG base64 data URL */
function compressImage(dataUrl: string, maxDim = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Could not get canvas context"));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

// ── Constants ──────────────────────────────────────────────────────
const VEHICLES = [
  { name: "2024 Ford F-150", side_w: 196, side_h: 52 },
  { name: "2024 Ford Transit Connect", side_w: 168, side_h: 48 },
  { name: "2024 Chevy Silverado", side_w: 201, side_h: 54 },
  { name: "2024 Mercedes Sprinter", side_w: 232, side_h: 58 },
  { name: "2024 Toyota Camry", side_w: 142, side_h: 44 },
  { name: "2024 Ram ProMaster", side_w: 224, side_h: 62 },
  { name: "2024 Toyota Prius", side_w: 155, side_h: 57 },
  { name: "2024 Ford E-Transit", side_w: 210, side_h: 60 },
  { name: "2024 Honda Civic", side_w: 134, side_h: 40 },
  { name: "2024 Ram 1500", side_w: 198, side_h: 54 },
];

const ROLL_WIDTH = 59.5;
const BLEED = 0.5;
const DPI = 150;
const SCALE = 0.10;

// ── Helpers ────────────────────────────────────────────────────────
function gcd(a: number, b: number): number {
  // Multiply by 10 to handle .5 values as integers
  let x = Math.round(a * 10);
  let y = Math.round(b * 10);
  while (y) { const t = y; y = x % y; x = t; }
  return x;
}

function computeSpecs(sideW: number) {
  const withBleedW = sideW + BLEED * 2;
  const withBleedH = ROLL_WIDTH + BLEED * 2;
  const pxW = Math.round(withBleedW * DPI * SCALE);
  const pxH = Math.round(withBleedH * DPI * SCALE);
  const g = gcd(sideW, ROLL_WIDTH);
  const ratioW = Math.round(sideW * 10) / g;
  const ratioH = Math.round(ROLL_WIDTH * 10) / g;
  const sqft = (sideW * ROLL_WIDTH) / 144;
  return { withBleedW, withBleedH, pxW, pxH, ratioW, ratioH, sqft };
}

// ── Element color generation ───────────────────────────────────────
const ELEMENT_COLORS: Record<string, string> = {
  logo: "rgba(59, 130, 246, 0.5)",
  text: "rgba(168, 85, 247, 0.5)",
  shape: "rgba(34, 197, 94, 0.5)",
  stripe: "rgba(249, 115, 22, 0.5)",
  image_area: "rgba(236, 72, 153, 0.5)",
  decorative: "rgba(20, 184, 166, 0.5)",
  BACKGROUND: "rgba(100, 116, 139, 0.25)",
  ACCENT_BAND: "rgba(249, 115, 22, 0.5)",
  LOGO_ZONE: "rgba(59, 130, 246, 0.5)",
  TEXT_ZONE: "rgba(168, 85, 247, 0.5)",
  IMAGE_ZONE: "rgba(236, 72, 153, 0.5)",
};

function getElementColor(type: string): string {
  return ELEMENT_COLORS[type] || "rgba(148, 163, 184, 0.5)";
}

// ── Types ──────────────────────────────────────────────────────────
interface ApproachResult {
  data: any;
  rawJson: string;
  elapsed: number;
  error?: string;
}

type ApproachKey = "approach1" | "approach2" | "approach3";

// ── Normalizers - extract elements from each schema ────────────────
interface NormalizedElement {
  type: string;
  description: string;
  content?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

function normalizeApproach1(data: any, canvasW: number, canvasH: number): NormalizedElement[] {
  if (!data?.elements) return [];
  return data.elements.map((el: any) => ({
    type: el.type || "shape",
    description: el.description || "",
    content: el.content,
    x: el.x_inches ?? 0,
    y: el.y_inches ?? 0,
    w: el.w_inches ?? 0,
    h: el.h_inches ?? 0,
    color: el.color || "#888",
  }));
}

function normalizeApproach2(data: any, canvasW: number, canvasH: number): NormalizedElement[] {
  const elements: NormalizedElement[] = [];
  if (data?.background_layers) {
    data.background_layers.forEach((layer: any) => {
      elements.push({
        type: "BACKGROUND",
        description: "Background layer",
        x: layer.region?.x ?? 0,
        y: layer.region?.y ?? 0,
        w: layer.region?.w ?? canvasW,
        h: layer.region?.h ?? canvasH,
        color: layer.colors?.[0] || "#333",
      });
    });
  }
  if (data?.design_elements) {
    data.design_elements.forEach((el: any) => {
      elements.push({
        type: el.type || "shape",
        description: el.description || "",
        content: el.content,
        x: el.position?.x_inches ?? 0,
        y: el.position?.y_inches ?? 0,
        w: el.size?.w_inches ?? 0,
        h: el.size?.h_inches ?? 0,
        color: el.color || "#888",
      });
    });
  }
  return elements;
}

function normalizeApproach3(data: any, canvasW: number, canvasH: number): NormalizedElement[] {
  if (!data?.zones) return [];
  return data.zones
    .sort((a: any, b: any) => (a.z_index ?? 0) - (b.z_index ?? 0))
    .map((zone: any) => ({
      type: zone.type || "BACKGROUND",
      description: zone.description || "",
      content: zone.text_content,
      x: zone.bounds_inches?.x ?? 0,
      y: zone.bounds_inches?.y ?? 0,
      w: zone.bounds_inches?.w ?? 0,
      h: zone.bounds_inches?.h ?? 0,
      color: zone.style?.colors?.[0] || "#888",
    }));
}

// ── Color palette extraction ───────────────────────────────────────
function extractPalette(data: any): string[] {
  if (!data) return [];
  // Approach 1 & 2
  const cp = data.color_palette;
  if (cp) {
    const colors: string[] = [];
    if (cp.primary) colors.push(cp.primary);
    if (cp.secondary) colors.push(cp.secondary);
    if (cp.accent) colors.push(cp.accent);
    if (cp.palette) colors.push(...cp.palette);
    return [...new Set(colors)];
  }
  // Approach 3
  const ce = data.color_extraction;
  if (ce) {
    const colors: string[] = [];
    if (ce.dominant) colors.push(ce.dominant);
    if (ce.palette) colors.push(...ce.palette);
    return [...new Set(colors)];
  }
  return [];
}

// ── Panel Canvas Component ─────────────────────────────────────────
function PanelCanvas({
  label,
  subtitle,
  canvasW,
  canvasH,
  elements,
  palette,
  result,
  loading,
  onRun,
}: {
  label: string;
  subtitle: string;
  canvasW: number;
  canvasH: number;
  elements: NormalizedElement[];
  palette: string[];
  result: ApproachResult | null;
  loading: boolean;
  onRun: () => void;
}) {
  const [showJson, setShowJson] = useState(false);

  return (
    <Card className="bg-card border-border/30 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{label}</h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRun}
          disabled={loading}
          className="gap-1.5"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {loading ? "Running..." : "Run"}
        </Button>
      </div>

      {/* Canvas */}
      <div
        className="relative w-full border border-border/50 rounded-lg bg-black/40 overflow-hidden"
        style={{ aspectRatio: `${canvasW} / ${canvasH}` }}
      >
        {elements.length === 0 && !loading && !result?.error && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
            {result ? "No elements returned" : `${canvasW}" × ${canvasH}"`}
          </div>
        )}
        {result?.error && (
          <div className="absolute inset-0 flex items-center justify-center text-red-400 text-xs px-4 text-center">
            {result.error}
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
        {elements.map((el, i) => {
          const left = (el.x / canvasW) * 100;
          const top = (el.y / canvasH) * 100;
          const width = (el.w / canvasW) * 100;
          const height = (el.h / canvasH) * 100;
          return (
            <div
              key={i}
              className="absolute border border-white/20 rounded-sm flex items-center justify-center overflow-hidden"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
                backgroundColor: getElementColor(el.type),
              }}
              title={`${el.type}: ${el.description}\n${el.x}"×${el.y}" → ${el.w}"×${el.h}"`}
            >
              <span className="text-[9px] text-white font-medium leading-tight text-center px-0.5 drop-shadow-md truncate">
                {el.content || el.type}
              </span>
            </div>
          );
        })}
      </div>

      {/* Stats */}
      {result && !result.error && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{elements.length} elements</span>
          <span>{(result.elapsed / 1000).toFixed(1)}s</span>
        </div>
      )}

      {/* Palette */}
      {palette.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Palette:</span>
          {palette.map((c, i) => (
            <div
              key={i}
              className="w-5 h-5 rounded border border-white/20"
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
        </div>
      )}

      {/* JSON toggle */}
      {result && !result.error && (
        <div>
          <button
            onClick={() => setShowJson(!showJson)}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            {showJson ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showJson ? "Hide" : "Show"} Raw JSON
          </button>
          {showJson && (
            <pre className="mt-2 p-3 bg-black/60 rounded-lg text-[10px] text-green-400 overflow-auto max-h-64 border border-border/30">
              {result.rawJson}
            </pre>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Main Page Component ────────────────────────────────────────────
const PanelLab = () => {
  const [selectedVehicle, setSelectedVehicle] = useState<string>("");
  const [imageBase64, setImageBase64] = useState<string>("");
  const [imagePreview, setImagePreview] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [results, setResults] = useState<Record<ApproachKey, ApproachResult | null>>({
    approach1: null,
    approach2: null,
    approach3: null,
  });
  const [loading, setLoading] = useState<Record<ApproachKey, boolean>>({
    approach1: false,
    approach2: false,
    approach3: false,
  });

  const vehicle = VEHICLES.find((v) => v.name === selectedVehicle);
  const specs = vehicle ? computeSpecs(vehicle.side_w) : null;

  // ── Image upload handler ──
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const fullRes = reader.result as string;
      setImagePreview(fullRes);
      // Compress to stay under Supabase Edge Function 2MB body limit
      const compressed = await compressImage(fullRes, 1024, 0.7);
      setImageBase64(compressed);
    };
    reader.readAsDataURL(file);
  }, []);

  // ── Run a single approach ──
  const runApproach = useCallback(
    async (key: ApproachKey) => {
      if (!vehicle || !imageBase64) return;

      const fnMap: Record<ApproachKey, string> = {
        approach1: "panel-lab-approach-1",
        approach2: "panel-lab-approach-2",
        approach3: "panel-lab-approach-3",
      };

      setLoading((prev) => ({ ...prev, [key]: true }));
      setResults((prev) => ({ ...prev, [key]: null }));

      const start = performance.now();
      try {
        const { data, error } = await supabase.functions.invoke(fnMap[key], {
          body: {
            image_base64: imageBase64,
            vehicle_name: vehicle.name,
            side_width_inches: vehicle.side_w,
            roll_width_inches: ROLL_WIDTH,
            bleed_inches: BLEED,
          },
        });

        const elapsed = performance.now() - start;

        if (error) {
          setResults((prev) => ({
            ...prev,
            [key]: { data: null, rawJson: "", elapsed, error: error.message },
          }));
          return;
        }

        if (!data?.success) {
          setResults((prev) => ({
            ...prev,
            [key]: { data: null, rawJson: "", elapsed, error: data?.error || "Unknown error" },
          }));
          return;
        }

        setResults((prev) => ({
          ...prev,
          [key]: {
            data: data.data,
            rawJson: JSON.stringify(data.data, null, 2),
            elapsed,
          },
        }));
      } catch (err: any) {
        const elapsed = performance.now() - start;
        setResults((prev) => ({
          ...prev,
          [key]: { data: null, rawJson: "", elapsed, error: err.message || "Request failed" },
        }));
      } finally {
        setLoading((prev) => ({ ...prev, [key]: false }));
      }
    },
    [vehicle, imageBase64]
  );

  // ── Run all 3 ──
  const runAll = useCallback(() => {
    runApproach("approach1");
    runApproach("approach2");
    runApproach("approach3");
  }, [runApproach]);

  // ── Normalize elements for each approach ──
  const canvasW = vehicle?.side_w ?? 196;
  const canvasH = ROLL_WIDTH;

  const elements1 = results.approach1?.data
    ? normalizeApproach1(results.approach1.data, canvasW, canvasH)
    : [];
  const elements2 = results.approach2?.data
    ? normalizeApproach2(results.approach2.data, canvasW, canvasH)
    : [];
  const elements3 = results.approach3?.data
    ? normalizeApproach3(results.approach3.data, canvasW, canvasH)
    : [];

  const palette1 = results.approach1?.data ? extractPalette(results.approach1.data) : [];
  const palette2 = results.approach2?.data ? extractPalette(results.approach2.data) : [];
  const palette3 = results.approach3?.data ? extractPalette(results.approach3.data) : [];

  const anyLoading = loading.approach1 || loading.approach2 || loading.approach3;
  const canRun = !!vehicle && !!imageBase64 && !anyLoading;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>PanelLab - Custom Wrap Panel Design Tool | DesignProAI</title>
        <meta name="description" content="Design custom vehicle wrap panels with AI. Upload artwork, configure panel layouts, and generate print-ready designs. Design it. Panel it. Print it. The world's first prompt-to-production wrap platform." />
        <link rel="canonical" href="https://designproai.com/panel-lab" />
      </Helmet>
      <main className="flex-1">
        <section className="container mx-auto px-4 py-8 max-w-7xl">
          {/* Page Title */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground">Panel Production Lab</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Compare 3 approaches to generating flat production panels from vehicle wrap renders
            </p>
          </div>

          {/* Controls Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {/* Vehicle Selector */}
            <Card className="bg-card border-border/30 rounded-xl p-4">
              <Label className="text-xs text-muted-foreground mb-2 block">Vehicle</Label>
              <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a vehicle..." />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLES.map((v) => (
                    <SelectItem key={v.name} value={v.name}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {vehicle && specs && (
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>
                    Side panel: <span className="text-foreground">{vehicle.side_w}" × {ROLL_WIDTH}"</span>
                  </p>
                  <p>
                    With bleed: <span className="text-foreground">{specs.withBleedW}" × {specs.withBleedH}"</span>
                  </p>
                  <p>
                    Pixels (10%): <span className="text-foreground">{specs.pxW} × {specs.pxH}</span>
                  </p>
                  <p>
                    Aspect ratio: <span className="text-foreground">{specs.ratioW}:{specs.ratioH}</span>
                  </p>
                  <p>
                    Square feet: <span className="text-foreground">{specs.sqft.toFixed(1)} sq ft</span>
                  </p>
                </div>
              )}
            </Card>

            {/* Image Upload */}
            <Card className="bg-card border-border/30 rounded-xl p-4">
              <Label className="text-xs text-muted-foreground mb-2 block">Reference Image</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                onChange={handleImageUpload}
                className="hidden"
              />
              {imagePreview ? (
                <div className="relative group">
                  <img
                    src={imagePreview}
                    alt="Upload preview"
                    className="w-full h-32 object-cover rounded-lg border border-border/30"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center text-xs text-white"
                  >
                    Change Image
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-32 border-2 border-dashed border-border/50 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-primary/50 transition-colors"
                >
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Upload wrap image (JPG/PNG)</span>
                </button>
              )}
            </Card>

            {/* Run Controls */}
            <Card className="bg-card border-border/30 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Actions</Label>
                {!vehicle && (
                  <p className="text-xs text-muted-foreground/60">Select a vehicle to begin</p>
                )}
                {vehicle && !imageBase64 && (
                  <p className="text-xs text-muted-foreground/60">Upload an image to enable runs</p>
                )}
              </div>
              <Button
                onClick={runAll}
                disabled={!canRun}
                className="w-full gap-2 mt-3"
              >
                {anyLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {anyLoading ? "Running..." : "Run All 3"}
              </Button>
            </Card>
          </div>

          {/* Three Panel Canvases */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <PanelCanvas
              label="Approach A: AI Flat Panel"
              subtitle="Convert 3D render → flat panel specs"
              canvasW={canvasW}
              canvasH={canvasH}
              elements={elements1}
              palette={palette1}
              result={results.approach1}
              loading={loading.approach1}
              onRun={() => runApproach("approach1")}
            />
            <PanelCanvas
              label="Approach B: Flat First"
              subtitle="Design directly on flat canvas"
              canvasW={canvasW}
              canvasH={canvasH}
              elements={elements2}
              palette={palette2}
              result={results.approach2}
              loading={loading.approach2}
              onRun={() => runApproach("approach2")}
            />
            <PanelCanvas
              label="Approach C: Hybrid Zones"
              subtitle="Decompose into compositable zones"
              canvasW={canvasW}
              canvasH={canvasH}
              elements={elements3}
              palette={palette3}
              result={results.approach3}
              loading={loading.approach3}
              onRun={() => runApproach("approach3")}
            />
          </div>
        </section>
      </main>
    </div>
  );
};

export default PanelLab;
