import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  Download,
  CheckCircle2,
  Loader2,
  FileText,
  Image,
  Scissors,
  DollarSign,
  Package,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const STAGES = [
  { key: "upscale", label: "Upscaling (ESRGAN)", icon: <Image className="w-4 h-4" /> },
  { key: "cut_paths", label: "CUT-MAP™ Contour", icon: <Scissors className="w-4 h-4" /> },
  { key: "cut_files", label: "Element Extraction", icon: <FileText className="w-4 h-4" /> },
  { key: "production_pdf", label: "Production PDF", icon: <FileText className="w-4 h-4" /> },
  { key: "pricing", label: "Pricing", icon: <DollarSign className="w-4 h-4" /> },
  { key: "packaging", label: "Packaging", icon: <Package className="w-4 h-4" /> },
  { key: "complete", label: "Complete", icon: <CheckCircle2 className="w-4 h-4" /> },
] as const;

interface ProductionOutputProps {
  jobId: string;
  onBack: () => void;
  onStartOver: () => void;
}

interface JobData {
  status: string;
  stage: string | null;
  progress: number;
  mockup_render_url: string | null;
  flat_production_url: string | null;
  vectorized_url: string | null;
  cut_path_svg_url: string | null;
  cut_path_pdf_url: string | null;
  cut_path_eps_url: string | null;
  cut_files_zip_url: string | null;
  cut_contour_overlay_url: string | null;
  extracted_element_count: number | null;
  vectorized_count: number | null;
  wholesale_price: number | null;
  retail_price: number | null;
  total_sqft: number | null;
  material_type: string | null;
  nested_width_inches: number | null;
  nested_height_inches: number | null;
  error_message: string | null;
}

export function ProductionOutput({ jobId, onBack, onStartOver }: ProductionOutputProps) {
  const [job, setJob] = useState<JobData | null>(null);
  const [polling, setPolling] = useState(true);
  // STALL WATCHDOG — if the pipeline's isolate is killed mid-run (memory
  // limit), the job row freezes at its last stage/progress forever with
  // status still "processing". Track when stage+progress last CHANGED; after
  // 3 minutes with no movement, stop pretending it's running and say so.
  const [stalled, setStalled] = useState(false);

  // Poll job status
  useEffect(() => {
    if (!jobId || !polling) return;
    let lastKey = "";
    let lastAt = Date.now();

    const fetchJob = async () => {
      const { data } = await supabase
        .from("graphics_pro_jobs")
        .select("status, stage, progress, mockup_render_url, flat_production_url, vectorized_url, cut_path_svg_url, cut_path_pdf_url, cut_path_eps_url, cut_files_zip_url, cut_contour_overlay_url, extracted_element_count, vectorized_count, wholesale_price, retail_price, total_sqft, material_type, nested_width_inches, nested_height_inches, error_message")
        .eq("id", jobId)
        .single();

      if (data) {
        setJob(data as JobData);
        if (data.status === "complete" || data.status === "failed") {
          setPolling(false);
          setStalled(false);
          return;
        }
        const key = `${data.stage}|${data.progress}`;
        if (key !== lastKey) { lastKey = key; lastAt = Date.now(); setStalled(false); }
        else if (Date.now() - lastAt > 180_000) setStalled(true);
      }
    };

    fetchJob();
    const interval = setInterval(fetchJob, 2000);
    return () => clearInterval(interval);
  }, [jobId, polling]);

  const currentStageIndex = job?.stage
    ? STAGES.findIndex((s) => s.key === job.stage)
    : -1;

  const isComplete = job?.status === "complete";
  const isFailed = job?.status === "failed";

  const downloadFile = (url: string, name: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Progress Tracker */}
      <Card className="p-6 bg-rp-surface border-border/30">
        <h3 className="text-lg font-semibold text-foreground mb-4">Production Pipeline</h3>

        <div className="space-y-3">
          {STAGES.map((stage, i) => {
            const isActive = currentStageIndex === i && !isComplete && !isFailed;
            const isDone = isComplete || currentStageIndex > i;

            return (
              <div key={stage.key} className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  isDone
                    ? "bg-green-500/20 text-green-600"
                    : isActive
                      ? "bg-gradient-to-r from-blue-600 via-purple-600 to-fuchsia-600 text-white"
                      : "bg-secondary/20 text-muted-foreground/40"
                }`}>
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : isActive ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    stage.icon
                  )}
                </div>
                <span className={`text-sm font-medium ${
                  isDone ? "text-green-600" : isActive ? "text-blue-500" : "text-muted-foreground/40"
                }`}>
                  {stage.label}
                </span>
                {isActive && (
                  <span className="text-xs text-muted-foreground ml-auto">{job?.progress || 0}%</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="mt-4 h-2 bg-secondary/20 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isFailed ? "bg-red-500" : isComplete ? "bg-green-500" : "bg-blue-500"
            }`}
            style={{ width: `${job?.progress || 0}%` }}
          />
        </div>
      </Card>

      {/* Stall watchdog — the pipeline's worker died mid-run (the job row
          stopped moving) but status never flipped. Say so instead of spinning
          forever, and offer the retry. */}
      {stalled && !isComplete && !isFailed && (
        <Card className="p-4 bg-amber-500/5 border-amber-500/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5" />
            <div>
              <p className="text-amber-400 font-medium">Production appears stuck</p>
              <p className="text-sm text-muted-foreground mt-1">
                No progress for over 3 minutes at “{job?.stage || "?"}” ({job?.progress ?? 0}%) — the pipeline worker likely died mid-run. Any files it finished are shown below; run production again to complete the set.
              </p>
              <Button variant="outline" size="sm" className="mt-2 border-amber-500/30 text-amber-400" onClick={onStartOver}>
                Start Over
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Error State */}
      {isFailed && (
        <Card className="p-4 bg-red-500/5 border-red-500/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
            <div>
              <p className="text-red-400 font-medium">Production failed</p>
              <p className="text-sm text-muted-foreground mt-1">{job?.error_message || "An unexpected error occurred"}</p>
              <Button variant="outline" size="sm" className="mt-2 border-red-500/30 text-red-400" onClick={onStartOver}>
                Start Over
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Completed — Files & Pricing */}
      {isComplete && job && (
        <>
          {/* Pricing Card — only when pricing was actually computed. The
              lightweight studio cut path (vectorize → cut SVG) finalizes the
              job without running nesting/pricing, so those columns are null;
              rendering the card then would show "undefined x undefined" /
              "NaN sq ft". The full production path always has pricing. */}
          {(job.retail_price != null || job.wholesale_price != null || job.total_sqft != null) && (
          <Card className="p-5 bg-rp-surface border-border/30">
            <h3 className="text-lg font-semibold text-foreground mb-3">Pricing</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Material</p>
                <p className="text-sm font-medium text-foreground">
                  {job.material_type === "3m" ? "3M" : "Avery"} Cut Contour
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dimensions</p>
                <p className="text-sm font-medium text-foreground">
                  {job.nested_width_inches}" x {job.nested_height_inches}"
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Area</p>
                <p className="text-sm font-medium text-foreground">
                  {job.total_sqft?.toFixed(2)} sq ft
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Wholesale</p>
                <p className="text-sm font-medium text-green-600">
                  ${job.wholesale_price?.toFixed(2)}
                </p>
              </div>
            </div>
            {job.retail_price && (
              <div className="mt-3 pt-3 border-t border-border/20">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Shop Retail Price</span>
                  <span className="text-lg font-bold text-blue-500">${job.retail_price.toFixed(2)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Includes: weeding, masking, cut paths, print file, install guide</p>
              </div>
            )}
          </Card>
          )}

          {/* CutPath Map — primary output, highlighted */}
          {(job.cut_path_svg_url || job.cut_contour_overlay_url) && (
            <Card className="p-5 bg-rp-surface border-fuchsia-500/30 border-2">
              <div className="flex items-center gap-2 mb-3">
                <Scissors className="w-5 h-5 text-fuchsia-400" />
                <h3 className="text-lg font-semibold text-foreground">CutPath Map</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Magenta #FF00FF CutContour spot color — 1/16" offset from edge. Ready for your plotter/cutter.
              </p>

              {/* Visual preview of cut contour */}
              {job.cut_contour_overlay_url && (
                <div className="mb-4 rounded-lg overflow-hidden border border-border/20 bg-black/30">
                  <img
                    src={job.cut_contour_overlay_url}
                    alt="CutPath Map Preview"
                    className="w-full max-h-64 object-contain"
                  />
                  <div className="px-3 py-1.5 bg-fuchsia-500/10 text-center">
                    <p className="text-[10px] text-fuchsia-300">CutPath Map Preview — magenta line shows where your cutter will cut</p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {job.cut_path_svg_url && (
                  <FileRow
                    label="CutContour SVG"
                    description='Plotter-ready SVG — magenta #FF00FF spot color, 1/16" offset contour path'
                    onClick={() => downloadFile(job.cut_path_svg_url!, `CutContour-${jobId}.svg`)}
                    accent="fuchsia"
                  />
                )}
                {job.cut_path_pdf_url && (
                  <FileRow
                    label="Production PDF"
                    description="Artwork + CutContour layers — send directly to RIP software"
                    onClick={() => downloadFile(job.cut_path_pdf_url!, `Production-${jobId}.pdf`)}
                    accent="fuchsia"
                  />
                )}
                {job.cut_contour_overlay_url && (
                  <FileRow
                    label="Cut Contour Overlay"
                    description="Visual preview of cut path overlaid on artwork (for proofing)"
                    onClick={() => downloadFile(job.cut_contour_overlay_url!, `contour-overlay-${jobId}.png`)}
                    accent="fuchsia"
                  />
                )}
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-3">
                Compatible: Roland, Graphtec, Summa, Mimaki — VersaWorks, Onyx, Caldera, Flexi, SAi, EFI Fiery
              </p>
            </Card>
          )}

          {/* Output Files — print artwork and cut files */}
          <Card className="p-5 bg-rp-surface border-border/30">
            <h3 className="text-lg font-semibold text-foreground mb-3">Production Files</h3>
            <div className="space-y-2">
              {job.mockup_render_url && (
                <FileRow
                  label="Mockup Preview"
                  description="Customer approval image — show this to your client"
                  onClick={() => downloadFile(job.mockup_render_url!, `mockup-${jobId}.png`)}
                />
              )}
              {job.flat_production_url && (
                <FileRow
                  label="Print File (ESRGAN Upscaled)"
                  description="High-resolution production artwork — ready for print & cut"
                  onClick={() => downloadFile(job.flat_production_url!, `print-file-${jobId}.png`)}
                />
              )}
              {job.cut_files_zip_url && (
                <FileRow
                  label={`Cut Files Pack (ZIP)${job.extracted_element_count ? ` — ${job.extracted_element_count} elements` : ""}`}
                  description='Each element extracted + vectorized SVGs with 1/4" bleed — ready for weeding'
                  onClick={() => downloadFile(job.cut_files_zip_url!, `CutFiles-${jobId}.zip`)}
                />
              )}
            </div>
          </Card>

          {/* Actions */}
          <div className="flex gap-3 justify-center">
            <Button onClick={onStartOver} variant="outline" className="gap-2">
              <ArrowLeft className="w-4 h-4" /> New Project
            </Button>
          </div>
        </>
      )}

      {/* Back button when not complete */}
      {!isComplete && !isFailed && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={onBack} className="gap-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to Preview
          </Button>
        </div>
      )}
    </div>
  );
}

function FileRow({ label, description, onClick, accent }: { label: string; description: string; onClick: () => void; accent?: "fuchsia" | "blue" }) {
  const borderClass = accent === "fuchsia"
    ? "border-fuchsia-500/20 hover:border-fuchsia-500/40 hover:bg-fuchsia-500/10"
    : "border-border/20 hover:border-blue-500/30 hover:bg-blue-500/20";
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors text-left ${borderClass}`}
    >
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Download className="w-4 h-4 text-muted-foreground" />
    </button>
  );
}
