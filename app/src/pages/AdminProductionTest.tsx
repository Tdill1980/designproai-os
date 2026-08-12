import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  Download,
  Image as ImageIcon,
  Package,
  Truck,
  TestTube,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { getGeminiAspectRatio } from "@/lib/print-production";
import {
  SIDE_PANELS,
  ADDON_PANELS,
  ROOF_PANELS,
  buildPanelList,
  formatDimension,
  type SidePanelSize,
  type RoofSize,
  type PanelSelection,
} from "@/lib/panelizer-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InputMode = "past-render" | "manual";

interface RenderRecord {
  id: string;
  mode_type: string;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
  color_name: string;
  color_hex: string;
  finish_type: string;
  render_urls: Record<string, string> | null;
  created_at: string;
  custom_design_url?: string;
  custom_swatch_url?: string;
  generation_status: string;
}

interface GenerationResult {
  success: boolean;
  packUrl?: string;
  fileCount?: number;
  geminiImageCalls?: number;
  geminiScanCalls?: number;
  pipelineVersion?: string;
  error?: string;
  metadata?: any;
}

// ---------------------------------------------------------------------------
// Pricing (display only - matches KitConfigSelector)
// ---------------------------------------------------------------------------

const SIDE_PRICES: Record<SidePanelSize, number> = {
  small: 600,
  medium: 710,
  large: 825,
  xl: 990,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminProductionTest() {
  // --- Input mode ---
  const [inputMode, setInputMode] = useState<InputMode>("past-render");

  // --- Past render picker ---
  const [searchEmail, setSearchEmail] = useState("");
  const [selectedRenderId, setSelectedRenderId] = useState<string | null>(null);
  const [showRenderList, setShowRenderList] = useState(false);

  // --- Manual URL inputs ---
  const [manualPanelUrl, setManualPanelUrl] = useState("");
  const [manualRenderUrls, setManualRenderUrls] = useState({
    side: "",
    "passenger-side": "",
    hood_detail: "",
    rear: "",
    "close-up": "",
    roof: "",
  });
  const [manualVehicle, setManualVehicle] = useState({
    year: "",
    make: "",
    model: "",
  });
  const [manualDesignName, setManualDesignName] = useState("Test Production Pack");
  const [manualFinish, setManualFinish] = useState("Gloss");

  // --- Panel configuration ---
  const [sideSize, setSideSize] = useState<SidePanelSize>("medium");
  const [addHood, setAddHood] = useState(false);
  const [addFrontBumper, setAddFrontBumper] = useState(false);
  const [addRearBumper, setAddRearBumper] = useState(false);
  const [roofSize, setRoofSize] = useState<RoofSize>("none");

  // --- Generation state ---
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);

  // --- Fetch past renders ---
  const {
    data: renders,
    isLoading: rendersLoading,
    refetch: refetchRenders,
  } = useQuery({
    queryKey: ["admin-production-test-renders", searchEmail],
    queryFn: async () => {
      if (!searchEmail) return [];
      const { data, error } = await supabase
        .from("color_visualizations")
        .select("*")
        .eq("customer_email", searchEmail)
        .eq("generation_status", "completed")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as RenderRecord[];
    },
    enabled: false, // manual trigger only
  });

  const selectedRender = renders?.find((r) => r.id === selectedRenderId) || null;

  // --- Helpers ---
  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogLines((prev) => [...prev, `[${ts}] ${msg}`]);
  };

  const getSelection = (): PanelSelection => ({
    sideSize,
    addHood,
    addFrontBumper,
    addRearBumper,
    roofSize,
  });

  const panels = buildPanelList(getSelection());

  // --- Resolve inputs based on mode ---
  const resolveInputs = () => {
    if (inputMode === "past-render" && selectedRender) {
      const renderUrls: Record<string, string> = {};
      if (selectedRender.render_urls) {
        for (const [key, val] of Object.entries(selectedRender.render_urls)) {
          if (val) renderUrls[key] = val;
        }
      }
      return {
        panelUrl: selectedRender.custom_design_url || Object.values(renderUrls)[0] || "",
        renderUrls,
        vehicleYear: String(selectedRender.vehicle_year || ""),
        vehicleMake: selectedRender.vehicle_make || "",
        vehicleModel: selectedRender.vehicle_model || "",
        designName: selectedRender.color_name || "Test Design",
        finish: selectedRender.finish_type || "Gloss",
      };
    }

    // Manual mode
    const renderUrls: Record<string, string> = {};
    for (const [key, val] of Object.entries(manualRenderUrls)) {
      if (val.trim()) renderUrls[key] = val.trim();
    }
    return {
      panelUrl: manualPanelUrl.trim(),
      renderUrls,
      vehicleYear: manualVehicle.year,
      vehicleMake: manualVehicle.make,
      vehicleModel: manualVehicle.model,
      designName: manualDesignName,
      finish: manualFinish,
    };
  };

  // --- Generate production pack ---
  const handleGenerate = async () => {
    const inputs = resolveInputs();

    if (!inputs.panelUrl) {
      toast.error("Panel URL is required - provide a flat design image URL");
      return;
    }

    if (Object.keys(inputs.renderUrls).length === 0) {
      toast.error("At least one render URL is required");
      return;
    }

    setIsGenerating(true);
    setResult(null);
    setLogLines([]);

    log("Starting production pack generation...");
    log(`Panel URL: ${inputs.panelUrl}`);
    log(`Render URLs: ${Object.keys(inputs.renderUrls).join(", ")}`);
    log(`Side size: ${sideSize} (${SIDE_PANELS[sideSize].widthInches}×${SIDE_PANELS[sideSize].heightInches})`);
    log(`Panels: ${panels.map((p) => p.label).join(", ")}`);
    log(`Vehicle: ${inputs.vehicleYear} ${inputs.vehicleMake} ${inputs.vehicleModel}`);

    const generationId = `test-${Date.now()}`;

    try {
      log("Invoking generate-production-files edge function...");

      // V4: renderUrl is the primary input - use side view or fall back to panelUrl
      const primaryRenderUrl = inputs.renderUrls?.side || inputs.renderUrls?.["driver-side"] || Object.values(inputs.renderUrls || {})[0] || inputs.panelUrl;

      const { data, error } = await supabase.functions.invoke("generate-production-files", {
        body: {
          generationId,
          renderUrl: primaryRenderUrl,
          panelUrl: inputs.panelUrl,
          renderUrls: inputs.renderUrls,
          sideSize,
          addHood,
          addFrontBumper,
          addRearBumper,
          roofSize,
          finish: inputs.finish,
          vehicleYear: inputs.vehicleYear,
          vehicleMake: inputs.vehicleMake,
          vehicleModel: inputs.vehicleModel,
          designName: inputs.designName,
          aspectRatio: getGeminiAspectRatio('side', 'xl'),
        },
      });

      if (error) throw error;

      if (data?.success && data?.packUrl) {
        log(`SUCCESS - Pack URL: ${data.packUrl}`);
        log(`Files: ${data.fileCount} | Gemini image calls: ${data.geminiImageCalls || 0} | Scan calls: ${data.geminiScanCalls || 0}`);
        log(`Pipeline version: ${data.pipelineVersion || "unknown"}`);
        setResult(data as GenerationResult);
        toast.success(`Production pack ready - ${data.fileCount} files`);
      } else {
        throw new Error(data?.error || "Edge function returned no packUrl");
      }
    } catch (err: any) {
      log(`ERROR: ${err.message}`);
      setResult({ success: false, error: err.message });
      toast.error(`Generation failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8 pt-24 max-w-5xl">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <TestTube className="w-8 h-8 text-blue-400" />
            <h1 className="text-4xl font-bold text-foreground">
              Production Pack <span className="text-blue-400">Test Tool</span>
            </h1>
          </div>
          <p className="text-muted-foreground">
            Generate production packs from past renders or manual image URLs.
            Calls the <code className="text-blue-400/80">generate-production-files</code> edge function directly.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* Left column - inputs */}
          <div className="space-y-6">
            {/* Input mode toggle */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Input Source</CardTitle>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={inputMode}
                  onValueChange={(v) => setInputMode(v as InputMode)}
                  className="flex gap-6"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="past-render" id="mode-past" />
                    <label htmlFor="mode-past" className="text-sm cursor-pointer">
                      Past Render
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="manual" id="mode-manual" />
                    <label htmlFor="mode-manual" className="text-sm cursor-pointer">
                      Manual URLs
                    </label>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* Past render picker */}
            {inputMode === "past-render" && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Select Past Render</CardTitle>
                  <CardDescription>Search by customer email to find completed renders</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Customer email..."
                      value={searchEmail}
                      onChange={(e) => setSearchEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && refetchRenders()}
                    />
                    <Button onClick={() => refetchRenders()} disabled={rendersLoading || !searchEmail}>
                      {rendersLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
                    </Button>
                  </div>

                  {renders && renders.length > 0 && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowRenderList(!showRenderList)}
                        className="w-full justify-between text-muted-foreground"
                      >
                        {renders.length} render{renders.length !== 1 ? "s" : ""} found
                        {showRenderList ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>

                      {showRenderList && (
                        <div className="max-h-64 overflow-y-auto space-y-2 border border-border rounded-lg p-2">
                          {renders.map((r) => {
                            const viewCount = r.render_urls ? Object.keys(r.render_urls).length : 0;
                            const isSelected = selectedRenderId === r.id;
                            return (
                              <button
                                key={r.id}
                                onClick={() => {
                                  setSelectedRenderId(r.id);
                                  setShowRenderList(false);
                                }}
                                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                                  isSelected
                                    ? "border-blue-500 bg-blue-500/10"
                                    : "border-border hover:border-muted-foreground/30 hover:bg-muted/30"
                                }`}
                              >
                                <div className="flex justify-between items-start">
                                  <div>
                                    <p className="text-sm font-medium">
                                      {r.vehicle_year} {r.vehicle_make} {r.vehicle_model}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {r.color_name} · {r.finish_type} · {r.mode_type}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-xs text-muted-foreground">
                                      {viewCount} view{viewCount !== 1 ? "s" : ""}
                                    </span>
                                    <p className="text-xs text-muted-foreground">
                                      {new Date(r.created_at).toLocaleDateString()}
                                    </p>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}

                  {/* Selected render summary */}
                  {selectedRender && (
                    <div className="bg-muted/30 border border-border rounded-lg p-4 space-y-2">
                      <p className="text-sm font-semibold text-blue-400">
                        {selectedRender.vehicle_year} {selectedRender.vehicle_make} {selectedRender.vehicle_model}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selectedRender.color_name} · {selectedRender.finish_type} · Mode: {selectedRender.mode_type}
                      </p>
                      {selectedRender.custom_design_url && (
                        <p className="text-xs text-green-400">Has custom design panel URL</p>
                      )}
                      {selectedRender.render_urls && (
                        <p className="text-xs text-muted-foreground">
                          Views: {Object.keys(selectedRender.render_urls).join(", ")}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Manual URL inputs */}
            {inputMode === "manual" && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Manual Image URLs</CardTitle>
                  <CardDescription>
                    Provide a flat design panel and at least one 3D render URL
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">
                      Flat Design Panel URL <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      placeholder="https://... (flat 2D panel image)"
                      value={manualPanelUrl}
                      onChange={(e) => setManualPanelUrl(e.target.value)}
                      className="mt-1"
                    />
                  </div>

                  <Separator />

                  <Label className="text-sm font-semibold">3D Render URLs</Label>
                  <p className="text-xs text-muted-foreground -mt-2">At least one is required. The pipeline uses these to extract flat panels per section.</p>
                  {Object.entries(manualRenderUrls).map(([key, val]) => (
                    <div key={key}>
                      <Label className="text-xs text-muted-foreground capitalize">{key.replace(/[-_]/g, " ")}</Label>
                      <Input
                        placeholder={`https://... (${key} view)`}
                        value={val}
                        onChange={(e) =>
                          setManualRenderUrls((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        className="mt-0.5"
                      />
                    </div>
                  ))}

                  <Separator />

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Year</Label>
                      <Input
                        placeholder="2024"
                        value={manualVehicle.year}
                        onChange={(e) => setManualVehicle((p) => ({ ...p, year: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Make</Label>
                      <Input
                        placeholder="Toyota"
                        value={manualVehicle.make}
                        onChange={(e) => setManualVehicle((p) => ({ ...p, make: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Model</Label>
                      <Input
                        placeholder="Camry"
                        value={manualVehicle.model}
                        onChange={(e) => setManualVehicle((p) => ({ ...p, model: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Design Name</Label>
                      <Input
                        value={manualDesignName}
                        onChange={(e) => setManualDesignName(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Finish</Label>
                      <Select value={manualFinish} onValueChange={setManualFinish}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Gloss">Gloss</SelectItem>
                          <SelectItem value="Satin">Satin</SelectItem>
                          <SelectItem value="Matte">Matte</SelectItem>
                          <SelectItem value="Carbon">Carbon Fiber</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Log output */}
            {logLines.length > 0 && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Pipeline Log</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs font-mono bg-black/50 rounded-lg p-3 max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {logLines.join("\n")}
                  </pre>
                </CardContent>
              </Card>
            )}

            {/* Result */}
            {result && (
              <Card className={`border ${result.success ? "border-green-500/50 bg-green-500/5" : "border-red-500/50 bg-red-500/5"}`}>
                <CardContent className="pt-6">
                  {result.success ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-green-400">
                        <Package className="w-5 h-5" />
                        <span className="font-semibold">Production Pack Ready</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {result.fileCount} panel files · {result.geminiImageCalls || 0} image calls · {result.geminiScanCalls || 0} scan calls
                      </p>
                      <div className="flex gap-2">
                        <Button asChild className="bg-blue-600 hover:bg-blue-700">
                          <a href={result.packUrl} target="_blank" rel="noopener noreferrer">
                            <Download className="w-4 h-4 mr-2" />
                            Download ZIP
                          </a>
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => {
                          navigator.clipboard.writeText(result.packUrl || "");
                          toast.success("URL copied");
                        }}>
                          Copy URL
                        </Button>
                      </div>
                      {result.metadata && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Raw metadata
                          </summary>
                          <pre className="mt-2 bg-black/50 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap">
                            {JSON.stringify(result.metadata, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-red-400 font-semibold">Generation Failed</p>
                      <p className="text-sm text-muted-foreground">{result.error}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right column - panel config + generate */}
          <div className="space-y-6">
            {/* Panel configuration */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Truck className="w-5 h-5 text-blue-400" />
                  Panel Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Side size */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Side Size (base kit)</Label>
                  <p className="text-xs text-muted-foreground">Includes driver + passenger (mirrored)</p>
                  <Select value={sideSize} onValueChange={(v) => setSideSize(v as SidePanelSize)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(SIDE_PANELS) as [SidePanelSize, typeof SIDE_PANELS["small"]][]).map(
                        ([key, panel]) => (
                          <SelectItem key={key} value={key}>
                            {panel.label} ({formatDimension(panel.widthInches, panel.heightInches)}) - ${SIDE_PRICES[key]}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                {/* Add-ons */}
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Add-Ons</Label>
                  <div className="space-y-2.5">
                    <div className="flex items-center space-x-2">
                      <Checkbox id="t-hood" checked={addHood} onCheckedChange={(c) => setAddHood(!!c)} />
                      <label htmlFor="t-hood" className="text-sm cursor-pointer">
                        Hood ({formatDimension(ADDON_PANELS.hood.widthInches, ADDON_PANELS.hood.heightInches)}) - $160
                      </label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="t-fb" checked={addFrontBumper} onCheckedChange={(c) => setAddFrontBumper(!!c)} />
                      <label htmlFor="t-fb" className="text-sm cursor-pointer">
                        Front Bumper ({formatDimension(ADDON_PANELS.frontBumper.widthInches, ADDON_PANELS.frontBumper.heightInches)}) - $200
                      </label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="t-rb" checked={addRearBumper} onCheckedChange={(c) => setAddRearBumper(!!c)} />
                      <label htmlFor="t-rb" className="text-sm cursor-pointer">
                        Rear + Bumper ({formatDimension(ADDON_PANELS.rear.widthInches, ADDON_PANELS.rear.heightInches)}, {formatDimension(ADDON_PANELS.rearBumper.widthInches, ADDON_PANELS.rearBumper.heightInches)}) - $395
                      </label>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Roof */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Roof</Label>
                  <RadioGroup value={roofSize} onValueChange={(v) => setRoofSize(v as RoofSize)}>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="none" id="t-roof-none" />
                        <label htmlFor="t-roof-none" className="text-sm cursor-pointer">No Roof</label>
                      </div>
                      {(Object.entries(ROOF_PANELS) as [string, typeof ROOF_PANELS["small"]][]).map(
                        ([key, panel]) => (
                          <div key={key} className="flex items-center space-x-2">
                            <RadioGroupItem value={key} id={`t-roof-${key}`} />
                            <label htmlFor={`t-roof-${key}`} className="text-sm cursor-pointer">
                              {panel.label} ({formatDimension(panel.widthInches, panel.heightInches)}) - ${key === "small" ? 160 : key === "medium" ? 225 : 330}
                            </label>
                          </div>
                        )
                      )}
                    </div>
                  </RadioGroup>
                </div>
              </CardContent>
            </Card>

            {/* Panel summary */}
            <Card className="bg-card border-border">
              <CardContent className="pt-6">
                <p className="text-sm font-semibold mb-2">{panels.length} Panel{panels.length !== 1 ? "s" : ""}</p>
                <ul className="space-y-1">
                  {panels.map((p) => (
                    <li key={p.id} className="text-xs text-muted-foreground flex justify-between">
                      <span>{p.label}{p.mirrored ? " (mirrored)" : ""}</span>
                      <span className="font-mono">{formatDimension(p.widthInches, p.heightInches)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Generate button */}
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Generating Production Pack...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  Generate Production Pack
                </>
              )}
            </Button>

            {isGenerating && (
              <p className="text-xs text-center text-muted-foreground">
                This may take 1–5 minutes depending on panel count.
                Check browser console for detailed logs.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
