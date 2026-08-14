/**
 * Production OS - Full-Page Print Production System
 *
 * This is the main page for the deterministic print production pipeline.
 * It walks the user through:
 * 1. Vehicle Selection → auto-detects optimal panel sizes
 * 2. Panel Configuration → shows exact panel dimensions and validation
 * 3. Design Source → select color/pattern/upload
 * 4. Output Settings → media, DPI, format, marks
 * 5. Production Preview → roll layout nesting diagram
 * 6. Generate & Download → print-ready files with crop marks
 */

import { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Settings2,
  Download,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Printer,
  Ruler,
  Palette,
  LayoutGrid,
  Layers,
  Car,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import VehicleSelector from "@/components/printpro/VehicleSelector";
import {
  PrintProCard,
  PrintProCardHeader,
  PrintProCardTitle,
  PrintProCardDescription,
  PrintProCardContent,
} from "@/components/printpro/PrintProCard";
import { useProductionEngine } from "@/hooks/useProductionEngine";
import {
  MEDIA_PRESETS,
  FULL_PRINT_MARKS,
  MINIMAL_PRINT_MARKS,
  formatCmyk,
} from "@/lib/print-production";
import type { PanelSelection, SidePanelSize, RoofSize } from "@/lib/panelizer-config";
import { SIDE_PANELS, ROOF_PANELS } from "@/lib/panelizer-config";
import {
  findVehicle,
  getPanelBreakdown,
  type VehicleMeasurement,
  type PanelBreakdown,
} from "@/data/vehicle-measurements";

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------

function StepBadge({ step, active }: { step: number; active: boolean }) {
  return (
    <div
      className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-colors ${
        active
          ? "bg-gradient-to-r from-[#D946EF] to-[#9b87f5] text-white"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {step}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const ProductionOS = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const engine = useProductionEngine();

  // Local UI state
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleMeasurement | null>(null);
  const [breakdown, setBreakdown] = useState<PanelBreakdown | null>(null);
  const [sideSize, setSideSize] = useState<SidePanelSize>("medium");
  const [roofSize, setRoofSize] = useState<RoofSize>("none");
  const [addHood, setAddHood] = useState(true);
  const [addRearBumper, setAddRearBumper] = useState(true);
  const [mediaPreset, setMediaPreset] = useState("generic-60");
  const [outputFormat, setOutputFormat] = useState<"pdf" | "png">("png");
  const [outputScale, setOutputScale] = useState("10%");
  const [includeMarks, setIncludeMarks] = useState(true);
  const [designUrl, setDesignUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [linkedJob, setLinkedJob] = useState<any>(null);
  const [loadingJob, setLoadingJob] = useState(false);

  // Load job data when jobId query param is present
  useEffect(() => {
    const jobId = searchParams.get("jobId");
    if (!jobId) return;

    setLoadingJob(true);
    (async () => {
      try {
        const { data: job, error } = await supabase
          .from("panelizer_jobs" as any)
          .select("*")
          .eq("id", jobId)
          .single();

        if (error || !job) {
          toast.error("Could not load production job");
          setLoadingJob(false);
          return;
        }

        setLinkedJob(job);

        // Auto-populate vehicle from job data
        const vehicle = findVehicle(job.vehicle_make, job.vehicle_model, job.vehicle_year);
        if (vehicle) {
          const bd = getPanelBreakdown(vehicle);
          setSelectedVehicle(vehicle);
          setBreakdown(bd);

          // Use sideSize from concept_json if available
          const conceptSideSize = job.concept_json?.sideSize;
          if (conceptSideSize && ["small", "medium", "large"].includes(conceptSideSize)) {
            setSideSize(conceptSideSize as SidePanelSize);
          } else {
            const auto = engine.getAutoSelection(vehicle.make, vehicle.model, vehicle.year);
            if (auto) {
              setSideSize(auto.sideSize);
              setRoofSize(auto.roofSize);
            }
          }
        }

        // Use approved render as design source
        if (job.approved_render_url) {
          setDesignUrl(job.approved_render_url);
        }

        toast.success(`Loaded job ${job.order_number || jobId.slice(0, 8)}`);
      } catch {
        toast.error("Failed to load job data");
      } finally {
        setLoadingJob(false);
      }
    })();
  }, [searchParams]);

  // Vehicle selection handler
  const handleVehicleSelect = (vehicle: VehicleMeasurement | null, bd: PanelBreakdown | null) => {
    setSelectedVehicle(vehicle);
    setBreakdown(bd);

    if (vehicle) {
      // Auto-detect optimal sizes
      const auto = engine.getAutoSelection(vehicle.make, vehicle.model, vehicle.year);
      if (auto) {
        setSideSize(auto.sideSize);
        setRoofSize(auto.roofSize);
        setAddHood(true);
        setAddRearBumper(true);
      }
    }
  };

  // Configure job whenever inputs change
  useEffect(() => {
    if (!selectedVehicle) return;

    const selection: PanelSelection = {
      sideSize,
      addHood,
      addFrontBumper: false,
      addRearBumper,
      roofSize,
    };

    engine.configureJob({
      make: selectedVehicle.make,
      model: selectedVehicle.model,
      year: selectedVehicle.year,
      selection,
      designImageUrl: designUrl || undefined,
      mediaPreset,
      outputFormat,
      outputScale,
      includeMarks,
    });
  }, [selectedVehicle, sideSize, roofSize, addHood, addRearBumper, mediaPreset, outputFormat, outputScale, includeMarks, designUrl]);

  // Generate handler
  const handleGenerate = async () => {
    try {
      await engine.runProduction();
      toast.success("Production files generated successfully!");
    } catch {
      toast.error("Production generation failed");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>ProductionOS - Print Production Pipeline | DesignProAI</title>
        <meta name="description" content="The world's first prompt-to-production vehicle wrap pipeline. From wrap design prompt to print-ready production. Vehicle selection, panel configuration, EPS file generation. Design it. Panel it. Print it." />
        <link rel="canonical" href="https://designproai.com/productionflow" />
      </Helmet>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Back */}
        <Button variant="ghost" onClick={() => navigate(linkedJob ? "/productionflow?tab=projects" : "/printpro")} className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {linkedJob ? "Back to ProductionFlow" : "Back to PrintPro"}
        </Button>

        {/* Loading job indicator */}
        {loadingJob && (
          <div className="mb-6 p-4 rounded-lg border border-blue-500/30 bg-blue-500/5 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
            <span className="text-sm text-blue-300">Loading production job data...</span>
          </div>
        )}

        {/* Linked job banner */}
        {linkedJob && !loadingJob && (
          <div className="mb-6 p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {linkedJob.approved_render_url && (
                  <img src={linkedJob.approved_render_url} alt="Job render" className="w-14 h-14 rounded-lg object-cover border border-border" />
                )}
                <div>
                  <p className="text-sm font-bold text-foreground">
                    Job {linkedJob.order_number || linkedJob.id?.slice(0, 8)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {linkedJob.vehicle_year} {linkedJob.vehicle_make} {linkedJob.vehicle_model}
                  </p>
                </div>
              </div>
              <span className="px-2 py-1 rounded-full bg-blue-500/10 text-xs text-blue-400 font-semibold">
                Linked from ProductionFlow
              </span>
            </div>
          </div>
        )}

        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
            Production
            <span className="bg-gradient-to-r from-[#D946EF] to-[#9b87f5] bg-clip-text text-transparent">
              OS
            </span>
          </h1>
          <p className="text-lg text-muted-foreground mt-2">
            Deterministic print production system - generates RIP-ready files with 99% accuracy
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="px-2 py-1 rounded-full bg-muted text-xs text-muted-foreground">
              No 360 Templates Required
            </span>
            <span className="px-2 py-1 rounded-full bg-muted text-xs text-muted-foreground">
              198 Vehicles
            </span>
            <span className="px-2 py-1 rounded-full bg-muted text-xs text-muted-foreground">
              Crop Marks + Registration
            </span>
            <span className="px-2 py-1 rounded-full bg-muted text-xs text-muted-foreground">
              BLF Nesting Algorithm
            </span>
          </div>
        </div>

        {/* ================================================================ */}
        {/* STEP 1: Vehicle Selection */}
        {/* ================================================================ */}
        <PrintProCard className="mb-6">
          <PrintProCardHeader>
            <div className="flex items-center gap-3">
              <StepBadge step={1} active={true} />
              <div>
                <PrintProCardTitle className="text-lg flex items-center gap-2">
                  <Car className="h-5 w-5" /> Select Vehicle
                </PrintProCardTitle>
                <PrintProCardDescription>
                  Choose your vehicle - panel sizes auto-detect from the 198-vehicle database
                </PrintProCardDescription>
              </div>
            </div>
          </PrintProCardHeader>
          <PrintProCardContent>
            <VehicleSelector onVehicleSelect={handleVehicleSelect} />
          </PrintProCardContent>
        </PrintProCard>

        {/* ================================================================ */}
        {/* STEP 2: Panel Configuration (after vehicle selected) */}
        {/* ================================================================ */}
        {selectedVehicle && breakdown && (
          <PrintProCard className="mb-6">
            <PrintProCardHeader>
              <div className="flex items-center gap-3">
                <StepBadge step={2} active={!!selectedVehicle} />
                <div>
                  <PrintProCardTitle className="text-lg flex items-center gap-2">
                    <Ruler className="h-5 w-5" /> Panel Configuration
                  </PrintProCardTitle>
                  <PrintProCardDescription>
                    {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model} -{" "}
                    {engine.panelSet?.panels.length || 0} panels
                  </PrintProCardDescription>
                </div>
              </div>
            </PrintProCardHeader>
            <PrintProCardContent>
              <div className="space-y-6">
                {/* GENIE Production Panelizer OS Auto-Detected Panel Configuration */}
                <div className="p-4 rounded-lg border border-[#9b87f5]/30 bg-gradient-to-r from-[#D946EF]/5 to-[#9b87f5]/5">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-4 w-4 text-[#9b87f5]" />
                    <span className="text-sm font-semibold">GENIE Production Panelizer OS™ - Auto-Configured</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground block">Side Panels</span>
                      <span className="font-medium">{SIDE_PANELS[sideSize].label} - {SIDE_PANELS[sideSize].widthInches}" × {SIDE_PANELS[sideSize].heightInches}"</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Hood</span>
                      <span className="font-medium">72" × 59.5"</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Rear + Bumper</span>
                      <span className="font-medium">Included</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Roof</span>
                      <span className="font-medium">{roofSize === "none" ? "Not required" : ROOF_PANELS[roofSize].label}</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">Panel sizes calculated for {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}.</p>
                </div>

                {/* Validation Status */}
                {engine.validation && (
                  <div
                    className={`p-4 rounded-lg border ${
                      engine.validation.accuracy >= 100
                        ? "border-green-500/30 bg-green-500/5"
                        : engine.validation.accuracy >= 75
                        ? "border-yellow-500/30 bg-yellow-500/5"
                        : "border-red-500/30 bg-red-500/5"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {engine.validation.accuracy >= 100 ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      )}
                      <span className="font-medium text-sm">
                        Coverage: {engine.validation.accuracy}%
                      </span>
                    </div>
                    {engine.validation.issues.length > 0 && (
                      <ul className="text-xs text-muted-foreground space-y-1 mt-2">
                        {engine.validation.issues.map((issue, i) => (
                          <li key={i}>- {issue}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Panel Breakdown Table */}
                {engine.panelSet && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left p-2 text-muted-foreground font-medium">Zone</th>
                          <th className="text-center p-2 text-muted-foreground font-medium">Width</th>
                          <th className="text-center p-2 text-muted-foreground font-medium">Height</th>
                          <th className="text-right p-2 text-muted-foreground font-medium">Sq Ft</th>
                          <th className="text-center p-2 text-muted-foreground font-medium">Mirrored</th>
                        </tr>
                      </thead>
                      <tbody>
                        {engine.panelSet.panels.map((panel) => (
                          <tr key={panel.zone} className="border-b border-border/50">
                            <td className="p-2 font-medium">{panel.label}</td>
                            <td className="p-2 text-center font-mono">{panel.widthInches}"</td>
                            <td className="p-2 text-center font-mono">{panel.heightInches}"</td>
                            <td className="p-2 text-right font-mono">{panel.sqFt}</td>
                            <td className="p-2 text-center">
                              {panel.mirrored ? "Yes" : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-border">
                          <td colSpan={3} className="p-2 font-bold">Total</td>
                          <td className="p-2 text-right font-bold font-mono">
                            {engine.panelSet.totalSqFt} ft²
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </PrintProCardContent>
          </PrintProCard>
        )}

        {/* ================================================================ */}
        {/* STEP 3: Design Source */}
        {/* ================================================================ */}
        {engine.panelSet && (
          <PrintProCard className="mb-6">
            <PrintProCardHeader>
              <div className="flex items-center gap-3">
                <StepBadge step={3} active={!!engine.panelSet} />
                <div>
                  <PrintProCardTitle className="text-lg flex items-center gap-2">
                    <ImageIcon className="h-5 w-5" /> Design Source (Optional)
                  </PrintProCardTitle>
                  <PrintProCardDescription>
                    Provide a design image URL to overlay on panels, or leave blank for templates
                  </PrintProCardDescription>
                </div>
              </div>
            </PrintProCardHeader>
            <PrintProCardContent>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1 block">
                    Design Image URL
                  </label>
                  <input
                    type="text"
                    value={designUrl}
                    onChange={(e) => setDesignUrl(e.target.value)}
                    placeholder="https://... (paste image URL or leave blank for blank template)"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Blank = generates production templates with print marks only (ready for RIP)
                  </p>
                </div>
              </div>
            </PrintProCardContent>
          </PrintProCard>
        )}

        {/* ================================================================ */}
        {/* STEP 4: Output Settings */}
        {/* ================================================================ */}
        {engine.panelSet && (
          <PrintProCard className="mb-6">
            <PrintProCardHeader>
              <div className="flex items-center gap-3">
                <StepBadge step={4} active={!!engine.panelSet} />
                <div>
                  <PrintProCardTitle className="text-lg flex items-center gap-2">
                    <Settings2 className="h-5 w-5" /> Output Settings
                  </PrintProCardTitle>
                  <PrintProCardDescription>
                    Configure media, format, and print marks
                  </PrintProCardDescription>
                </div>
              </div>
            </PrintProCardHeader>
            <PrintProCardContent>
              <div className="space-y-6">
                {/* Media preset */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">
                    Media / Vinyl Roll
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {Object.entries(MEDIA_PRESETS).slice(0, 6).map(([key, media]) => (
                      <button
                        key={key}
                        onClick={() => setMediaPreset(key)}
                        className={`p-3 rounded-lg border text-left transition-colors ${
                          mediaPreset === key
                            ? "border-[#9b87f5] bg-gradient-to-r from-[#D946EF]/10 to-[#9b87f5]/10"
                            : "border-border hover:border-muted-foreground/30"
                        }`}
                      >
                        <div className="font-medium text-sm">
                          {media.manufacturer || "Generic"} {media.rollWidthInches}"
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {media.productCode || `${media.rollWidthInches}" roll`} -{" "}
                          {media.laminate}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Printable: {media.printableWidthInches}"
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Format + Scale + Marks in a row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1 block">
                      Output Format
                    </label>
                    <select
                      value={outputFormat}
                      onChange={(e) => setOutputFormat(e.target.value as "pdf" | "png")}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    >
                      <option value="png">PNG (RIP-compatible)</option>
                      <option value="pdf">PDF (with metadata)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-foreground mb-1 block">
                      Output Scale
                    </label>
                    <select
                      value={outputScale}
                      onChange={(e) => setOutputScale(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    >
                      <option value="10%">10% (standard - RIP upscales)</option>
                      <option value="25%">25% (high detail)</option>
                      <option value="50%">50% (production proof)</option>
                      <option value="full">100% (full scale - large files)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-foreground mb-1 block">
                      Print Marks
                    </label>
                    <select
                      value={includeMarks ? "full" : "none"}
                      onChange={(e) => setIncludeMarks(e.target.value === "full")}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    >
                      <option value="full">Full (crop + registration + color bars)</option>
                      <option value="none">Panel labels only</option>
                    </select>
                  </div>
                </div>
              </div>
            </PrintProCardContent>
          </PrintProCard>
        )}

        {/* ================================================================ */}
        {/* STEP 5: Roll Layout Preview */}
        {/* ================================================================ */}
        {engine.rollLayout && engine.panelSet && (
          <PrintProCard className="mb-6">
            <PrintProCardHeader>
              <div className="flex items-center gap-3">
                <StepBadge step={5} active={!!engine.rollLayout} />
                <div>
                  <PrintProCardTitle className="text-lg flex items-center gap-2">
                    <LayoutGrid className="h-5 w-5" /> Roll Layout Preview
                  </PrintProCardTitle>
                  <PrintProCardDescription>
                    Nesting diagram - panels arranged on{" "}
                    {engine.rollLayout.media.printableWidthInches}" roll media
                  </PrintProCardDescription>
                </div>
              </div>
            </PrintProCardHeader>
            <PrintProCardContent>
              <div className="space-y-4">
                {/* Stats row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Linear Length</p>
                    <p className="text-lg font-bold font-mono">{engine.rollLayout.totalLengthFeet} ft</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Utilization</p>
                    <p className="text-lg font-bold font-mono text-green-500">
                      {engine.rollLayout.utilizationPercent}%
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Waste</p>
                    <p className="text-lg font-bold font-mono text-yellow-500">
                      {engine.rollLayout.wastePercent}%
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Panels</p>
                    <p className="text-lg font-bold font-mono">
                      {engine.rollLayout.panels.length}
                    </p>
                  </div>
                </div>

                {/* Visual nesting diagram */}
                <div className="border border-border rounded-lg p-4 bg-muted/20 overflow-x-auto">
                  <div className="text-xs text-muted-foreground mb-2">
                    Roll: {engine.rollLayout.media.printableWidthInches}" wide ×{" "}
                    {engine.rollLayout.totalLengthFeet} ft long
                  </div>
                  <div
                    className="relative border border-border/50 bg-background"
                    style={{
                      width: "100%",
                      height: `${Math.max(80, engine.rollLayout.media.printableWidthInches * 1.5)}px`,
                    }}
                  >
                    {engine.rollLayout.panels.map((nested, i) => {
                      const rollW = engine.rollLayout!.media.printableWidthInches;
                      const rollL = engine.rollLayout!.totalLengthInches;
                      const scaleX = 100 / rollL;
                      const scaleY = 100 / rollW;

                      const colors = [
                        "#3B82F6", "#EF4444", "#10B981", "#F59E0B",
                        "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
                      ];

                      return (
                        <div
                          key={`${nested.panel.zone}-${i}`}
                          className="absolute border-2 rounded-sm flex items-center justify-center text-[10px] font-medium overflow-hidden"
                          style={{
                            left: `${nested.rollY * scaleX}%`,
                            top: `${nested.rollX * scaleY}%`,
                            width: `${nested.totalHeight * scaleX}%`,
                            height: `${nested.totalWidth * scaleY}%`,
                            borderColor: colors[i % colors.length],
                            backgroundColor: colors[i % colors.length] + "20",
                            color: colors[i % colors.length],
                          }}
                          title={`${nested.panel.label} - ${nested.panel.widthInches}" × ${nested.panel.heightInches}"`}
                        >
                          <span className="truncate px-1">
                            {nested.panel.zone.replace("-", " ")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Panel placement details */}
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {showAdvanced ? "Hide" : "Show"} placement details
                </button>
                {showAdvanced && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left p-2 text-muted-foreground">Panel</th>
                          <th className="text-center p-2 text-muted-foreground">Roll X</th>
                          <th className="text-center p-2 text-muted-foreground">Roll Y</th>
                          <th className="text-center p-2 text-muted-foreground">Size (with bleed)</th>
                          <th className="text-center p-2 text-muted-foreground">Rotated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {engine.rollLayout.panels.map((nested, i) => (
                          <tr key={i} className="border-b border-border/50">
                            <td className="p-2">{nested.panel.label}</td>
                            <td className="p-2 text-center font-mono">{nested.rollX.toFixed(1)}"</td>
                            <td className="p-2 text-center font-mono">{nested.rollY.toFixed(1)}"</td>
                            <td className="p-2 text-center font-mono">
                              {nested.totalWidth.toFixed(1)}" × {nested.totalHeight.toFixed(1)}"
                            </td>
                            <td className="p-2 text-center">{nested.rotated ? "90°" : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </PrintProCardContent>
          </PrintProCard>
        )}

        {/* ================================================================ */}
        {/* STEP 6: Generate & Download */}
        {/* ================================================================ */}
        {engine.panelSet && (
          <PrintProCard className="mb-6">
            <PrintProCardHeader>
              <div className="flex items-center gap-3">
                <StepBadge step={6} active={!!engine.panelSet} />
                <div>
                  <PrintProCardTitle className="text-lg flex items-center gap-2">
                    <Printer className="h-5 w-5" /> Generate Production Files
                  </PrintProCardTitle>
                  <PrintProCardDescription>
                    {engine.result
                      ? `${engine.result.files.length} files ready for download`
                      : "Click generate to create RIP-ready production files"
                    }
                  </PrintProCardDescription>
                </div>
              </div>
            </PrintProCardHeader>
            <PrintProCardContent>
              <div className="space-y-4">
                {/* Generate button */}
                {!engine.result && (
                  <Button
                    size="lg"
                    className="w-full py-6 text-lg bg-gradient-to-r from-[#D946EF] to-[#9b87f5] hover:opacity-90"
                    onClick={handleGenerate}
                    disabled={engine.isGenerating}
                  >
                    {engine.isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        {engine.currentStep}
                      </>
                    ) : (
                      <>
                        <Layers className="mr-2 h-5 w-5" />
                        Generate Production Files
                      </>
                    )}
                  </Button>
                )}

                {/* Progress */}
                {engine.isGenerating && (
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-[#D946EF] to-[#9b87f5] transition-all"
                      style={{ width: `${engine.progress}%` }}
                    />
                  </div>
                )}

                {/* Error */}
                {engine.error && (
                  <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5">
                    <p className="text-sm text-red-500">{engine.error}</p>
                  </div>
                )}

                {/* Results */}
                {engine.result && (
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">Total Panels</p>
                        <p className="text-lg font-bold">{engine.result.summary.totalPanels}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">Total Sq Ft</p>
                        <p className="text-lg font-bold">{engine.result.summary.totalSqFt}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">Est. Print Time</p>
                        <p className="text-lg font-bold">{engine.result.summary.estimatedPrintTime}</p>
                      </div>
                    </div>

                    {/* File list */}
                    <div className="space-y-2">
                      {engine.result.files.map((file, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20"
                        >
                          <div className="flex items-center gap-3">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="text-sm font-medium">{file.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {file.mimeType === "application/pdf" ? "PDF" : "PNG"} -{" "}
                                {(file.sizeBytes / 1024).toFixed(0)} KB -{" "}
                                {file.dimensions.width > 0
                                  ? `${file.dimensions.width} × ${file.dimensions.height} px`
                                  : "Multi-page"
                                }
                              </p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => engine.downloadFile(file)}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}

                      {/* Roll layout file */}
                      {engine.result.rollLayoutFile && (
                        <div className="flex items-center justify-between p-3 rounded-lg border border-[#9b87f5]/30 bg-[#9b87f5]/5">
                          <div className="flex items-center gap-3">
                            <LayoutGrid className="h-4 w-4 text-[#9b87f5]" />
                            <div>
                              <p className="text-sm font-medium">Roll Layout Sheet</p>
                              <p className="text-xs text-muted-foreground">
                                PNG - {(engine.result.rollLayoutFile.sizeBytes / 1024).toFixed(0)} KB
                              </p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => engine.downloadFile(engine.result!.rollLayoutFile!)}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Download All */}
                    <Button
                      size="lg"
                      className="w-full bg-gradient-to-r from-[#D946EF] to-[#9b87f5] hover:opacity-90"
                      onClick={engine.downloadAll}
                    >
                      <Download className="mr-2 h-5 w-5" />
                      Download All Files ({engine.result.files.length + (engine.result.rollLayoutFile ? 1 : 0)})
                    </Button>

                    {/* Regenerate */}
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        engine.reset();
                        // Re-trigger configuration
                        if (selectedVehicle) {
                          handleVehicleSelect(selectedVehicle, breakdown);
                        }
                      }}
                    >
                      Regenerate with Different Settings
                    </Button>
                  </div>
                )}
              </div>
            </PrintProCardContent>
          </PrintProCard>
        )}
      </div>
    </div>
  );
};

export default ProductionOS;
