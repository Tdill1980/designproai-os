import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { beginAppBusy, endAppBusy } from "@/lib/app-busy";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { ProductionPackDialog } from "@/components/designpanelpro/ProductionPackDialog";
import GlassmorphismPanelOverlay from "@/components/production/GlassmorphismPanelOverlay";
import { GenieUniversalPanelizerCard } from "@/components/production/GenieUniversalPanelizerCard";
import { SIDE_PANELS, type SidePanelSize } from "@/lib/panelizer-config";
import { getRecommendedSize } from "@/lib/vehicle-size-validator";
import { toUuidOrNull } from "@/lib/utils";
import { stampAndUploadGenieOverlay } from "@/lib/genie-panel-stamper";
import { useOrganization } from "@/contexts/OrganizationContext";
import ExtractElementsModal from "@/components/productionflow/ExtractElementsModal";
import PanelPrintReadyButton from "@/components/productionflow/PanelPrintReadyButton";
import { QCProductionFlowContainer } from "@/components/qc/QCProductionFlowContainer";
import { VehicleTypeSelector, isNonStandardVehicle, getDesignProFunctionForType, type VehicleType } from "@/components/tools/VehicleTypeSelector";
import { downloadAllWithOverlay } from "@/lib/download-with-overlay";
import { saveProofUrlToViz } from "@/lib/save-proof-url";
import { downscaleStorageImage } from "@/lib/storage-image";
import { DesignAssetsPanel } from "@/components/proof/DesignAssetsPanel";
import { buildProductionPanels } from "@/lib/buildProductionPanels";
import { generatePassengerMirror, uploadMirrorToStorage, fixMirrorText, designLikelyHasText, producePassengerView } from "@/utils/passenger-mirror";
import { withTimeout, VIEW_RENDER_TIMEOUT_MS } from "@/lib/invokeWithTimeout";

// Extract sideSize from job - prefers concept_json.sideSize (new jobs),
// falls back to reverse-lookup from panels widthInches (older jobs),
// then tries vehicle dimension lookup from the 198-vehicle database.
function extractSidePanelSize(panels: any, conceptJson?: any): SidePanelSize {
  // Prefer explicit sideSize stored at job creation
  const stored = conceptJson?.sideSize;
  if (stored && SIDE_PANELS[stored as string]) return stored as SidePanelSize;

  // Fallback: reverse-lookup from panel dimensions
  if (Array.isArray(panels)) {
    const sidePanel = panels.find((p: any) =>
      p.id === "driver-side" || p.id === "passenger-side" || p.label?.toLowerCase().includes("side")
    );
    if (sidePanel?.widthInches) {
      for (const [key, dim] of Object.entries(SIDE_PANELS)) {
        if (dim.widthInches === sidePanel.widthInches) return key as SidePanelSize;
      }
    }
  }

  // Fallback: lookup from vehicle make/model in measurement database
  const make = conceptJson?.vehicle_make || conceptJson?.vehicleMake;
  const model = conceptJson?.vehicle_model || conceptJson?.vehicleModel;
  const year = conceptJson?.vehicle_year || conceptJson?.vehicleYear;
  if (make && model) {
    const rec = getRecommendedSize(make, model, year);
    if (rec) return rec.sideSize;
  }

  return "medium";
}

// Extract twoPanel status from job concept_json or vehicle dimensions
function extractTwoPanel(conceptJson?: any): boolean {
  if (conceptJson?.twoPanel) return true;
  const make = conceptJson?.vehicle_make || conceptJson?.vehicleMake;
  const model = conceptJson?.vehicle_model || conceptJson?.vehicleModel;
  const year = conceptJson?.vehicle_year || conceptJson?.vehicleYear;
  if (make && model) {
    const rec = getRecommendedSize(make, model, year);
    if (rec) return rec.twoPanel;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// PRODUCTIONFLOW™ - Production + Approval Room
// /productionflow/:jobId
//
// Two modes, one engine:
//   Production Jobs - Full production lifecycle with live pipeline
//   PrepMyFile™     - Token-based file prep services (a la carte)
//
// Deep-link: /productionflow?tool=cut_map (auto-opens PrepMyFile + pre-selects tool)
//
// Design: Light theme. Calm. Controlled. Professional.
// ═══════════════════════════════════════════════════════════════

const PIPELINE_STAGES = [
  { key: "panelizing", label: "Panelizing", shortLabel: "Panel", sublabel: "3D → Print Panels", icon: "◧" },
  { key: "optimizing", label: "Optimizing", shortLabel: "Optim", sublabel: "Production Ready", icon: "◈" },
  { key: "qa_checking", label: "Quality Check", shortLabel: "QA", sublabel: "AI Validation", icon: "◉" },
  { key: "packaging", label: "Packaging", shortLabel: "Pack", sublabel: "Building Files", icon: "◻" },
  { key: "extracting_elements", label: "Element Detection", shortLabel: "Detect", sublabel: "Logo & Text Scan", icon: "◎" },
  { key: "admin_qc", label: "Admin QC", shortLabel: "Admin", sublabel: "24h Team Review", icon: "◈" },
  { key: "ready", label: "Ready", shortLabel: "Ready", sublabel: "Download Available", icon: "✓" },
] as const;

const QA_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  true: { label: "Passed", color: "#16a34a", bg: "#f0fdf4" },
  false: { label: "Issues", color: "#dc2626", bg: "#fef2f2" },
  null: { label: "Pending", color: "#9ca3af", bg: "#f9fafb" },
};

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "#6b7280",
  queued: "#3b82f6",
  panelizing: "#8b5cf6",
  optimizing: "#6366f1",
  qa_checking: "#f59e0b",
  awaiting_input: "#ef4444",
  post_processing: "#6366f1",
  extracting_elements: "#8b5cf6",
  packaging: "#3b82f6",
  admin_qc: "#0080cc",
  pending_qc: "#0080cc",
  ready: "#16a34a",
  failed: "#dc2626",
};

const QUICK_PREP_PACKAGES = [
  {
    id: "basic_cut_prep",
    name: "Basic Cut Prep",
    tokens: 5,
    engine: "CutMap™",
    description: "Background removal → Silhouette contour → Spot layer",
    timeSaved: "20 min",
    designerCost: "$12",
    rip: ["VersaWorks", "Onyx", "Flexi", "SAi"],
  },
  {
    id: "pro_cut_prep",
    name: "Pro Cut Prep",
    tokens: 8,
    engine: "CutMap™ + ColorSync™",
    description: "Vector rebuild → Offset contour → Node cleanup → CMYK",
    timeSaved: "42 min",
    designerCost: "$24",
    rip: ["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery"],
  },
  {
    id: "advanced_output_prep",
    name: "Advanced Output Prep",
    tokens: 10,
    engine: "FileRevitalizer™ + CutMap™ + ColorSync™",
    description: "Full pipeline: vector → contour → bleed → spot → layers → PDF",
    timeSaved: "58 min",
    designerCost: "$34",
    rip: ["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery"],
  },
];

// ── Production Panelizer - wrap image with time-stretched glowing panel overlay ──
// Panels glow one-by-one over 24 hours. When all glow = GO (QC complete).
const QC_HOLD_HOURS = 24;
// Full panel list for per-view glassmorphism overlays on the all-views grid
const ALL_PANEL_ZONES = [
  { id: "side-1",       label: "Driver Side",    dims: '172"×59.5"' },
  { id: "side-2",       label: "Passenger Side",  dims: '172"×59.5"' },
  { id: "hood",         label: "Hood",           dims: '72"×59.5"' },
  { id: "roof",         label: "Roof",           dims: '160"×59.5"' },
  { id: "front-bumper", label: "Front Bumper",   dims: '120.5"×38"' },
  { id: "rear-trunk",   label: "Rear / Trunk",   dims: '72.5"×59"' },
  { id: "rear-bumper",  label: "Rear Bumper",    dims: '120"×38"' },
];

// View angle labels for the all-views grid
const VIEW_LABELS: Record<string, string> = {
  side: "Driver Side", "driver-side": "Driver Side", "passenger-side": "Passenger Side",
  hood_detail: "Hood", front: "Front", rear: "Rear", "close-up": "Close-Up",
};


// ── Panel view ordering for sequential glow ──
const PANEL_VIEW_ORDER = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];

// ── PIPELINE STEP LABELS (must match orchestrator PANELIZER_STEPS) ──
const PANELIZER_STEP_LABELS: { key: string; label: string; runLabel: string; hasOutputPreview: boolean }[] = [
  { key: "validate",      label: "Validate Inputs",              runLabel: "Run Validate",   hasOutputPreview: false },
  { key: "fetch",          label: "Fetch Render Assets",          runLabel: "Run Fetch",      hasOutputPreview: false },
  { key: "fill",           label: "Panelize (AI Panel Gen)",      runLabel: "Run Panelize",   hasOutputPreview: true },
  { key: "upscale",        label: "AI Upscale (4x)",       runLabel: "Run Upscale",    hasOutputPreview: true },
  { key: "vectorize-eps",  label: "Vectorize (Vectorizer.AI)",    runLabel: "Run Vectorize",  hasOutputPreview: true },
  { key: "qa",             label: "Quality Check",                runLabel: "Run QC",         hasOutputPreview: false },
  { key: "package",        label: "Package Production Files",     runLabel: "Run Package",    hasOutputPreview: true },
];

// Helper: generate a signed URL from a storage path
async function getSignedStorageUrl(path: string): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from("wrap-files").createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

// ── Pipeline Step Detail Component ──
// Shows progress for all users. Admin/tester users get per-step retrigger buttons.
function PipelineStepDetail({ job, isPrivileged = false }: { job: any; isPrivileged?: boolean }) {
  const [retriggeringStep, setRetriggeringStep] = useState<string | null>(null);
  const { toast } = useToast();

  if (!job) return null;

  const sp = job?.stage_progress || {};
  const stepData = sp.panelizer_step_data || {};
  const currentStepIdx = sp.panelizer_step_index || 0;

  const handleRetriggerFromStep = async (stepKey: string) => {
    if (!job?.id || retriggeringStep) return;
    setRetriggeringStep(stepKey);
    try {
      const { error } = await supabase.functions.invoke("run-production-flow", {
        body: { job_id: job.id, trigger: "reset_to_step", reset_to_step: stepKey, mode: "project" },
      });
      if (error) throw error;
      toast({ title: "Retriggered", description: `Pipeline restarting from: ${stepKey}` });
    } catch (err: any) {
      toast({ title: "Retrigger failed", description: err.message || "Could not retrigger step", variant: "destructive" });
    } finally {
      setRetriggeringStep(null);
    }
  };

  if (!stepData || Object.keys(stepData).length === 0) {
    return (
      <div style={{
        background: "#fff", borderRadius: 12, padding: "16px 12px",
        marginBottom: 20, border: "1px solid #e5e7eb", textAlign: "center",
      }}>
        <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
          Pipeline initializing - your production files are being prepared.
        </p>
      </div>
    );
  }

  return (
    <div style={{
      background: "#fff", borderRadius: 12, padding: "16px 12px",
      marginBottom: 20, border: "1px solid #e5e7eb",
    }}>
      <h3 style={{
        fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "#9ca3af",
        textTransform: "uppercase", margin: "0 0 16px 0",
      }}>
        Production Pipeline Progress
      </h3>

      {PANELIZER_STEP_LABELS.map((step, i) => {
        const sd = stepData[step.key];
        const isCompleted = !!sd?.completed_at;
        const isCurrent = i === currentStepIdx && !sp.panelizer_complete;
        const completedAt = sd?.completed_at ? new Date(sd.completed_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
        const hasFailed = sd?.result?.success === false || sd?.result?.fillFailed;
        const isRetriggering = retriggeringStep === step.key;

        return (
          <div key={step.key} style={{
            marginBottom: i < PANELIZER_STEP_LABELS.length - 1 ? 14 : 0,
            padding: "8px 0",
            borderBottom: i < PANELIZER_STEP_LABELS.length - 1 ? "1px solid #f3f4f6" : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>
                {isCompleted && !hasFailed ? "✅" : hasFailed ? "⚠️" : isCurrent ? "⏳" : "○"}
              </span>
              <span style={{
                flex: 1, fontSize: 13, fontWeight: 600,
                color: isCompleted ? "#111" : isCurrent ? "#6366f1" : "#6b7280",
              }}>
                {step.label}
              </span>
              {completedAt && (
                <span style={{ fontSize: 11, color: "#9ca3af" }}>{completedAt}</span>
              )}
              {isCompleted && !hasFailed && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", background: "#f0fdf4", padding: "2px 8px", borderRadius: 4 }}>Done</span>
              )}
              {hasFailed && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", background: "#fef2f2", padding: "2px 8px", borderRadius: 4 }}>Issue</span>
              )}
              {isPrivileged && (isCompleted || hasFailed) && (
                <button
                  onClick={() => handleRetriggerFromStep(step.key)}
                  disabled={!!retriggeringStep}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: isRetriggering ? "#9ca3af" : "#0080cc",
                    background: isRetriggering ? "#f3f4f6" : "#eff6ff",
                    border: `1px solid ${isRetriggering ? "#e5e7eb" : "#bfdbfe"}`,
                    borderRadius: 4,
                    padding: "2px 8px",
                    cursor: retriggeringStep ? "not-allowed" : "pointer",
                    opacity: retriggeringStep && !isRetriggering ? 0.5 : 1,
                    transition: "all 0.15s",
                  }}
                >
                  {isRetriggering ? "Retriggering..." : "Retrigger"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Maps a qc_side_panels key (driver_side, passenger_side, ...) to the matching
// view type used by the hero strip / Panel grid. A designer approving the
// "driver_side" panel in QC Artboard should light up the "side" or
// "driver-side" thumbnail here.
const QC_SIDE_TO_VIEW: Record<string, string[]> = {
  driver_side: ["side", "driver-side"],
  passenger_side: ["passenger-side"],
  hood: ["hood_detail", "hood"],
  roof: ["roof"],
  rear: ["rear"],
  front: ["front"],
};
function qcSidesApprovedFor(viewType: string, qcSidePanels?: Record<string, any> | null): boolean {
  if (!qcSidePanels) return false;
  for (const [sideKey, viewKeys] of Object.entries(QC_SIDE_TO_VIEW)) {
    if (viewKeys.includes(viewType) && qcSidePanels[sideKey]?.approved) return true;
  }
  return false;
}

function ProductionPanelizerHero({ imageUrl, createdAt, jobStatus, viewUrls, sidePanelSize = "medium", twoPanel = false, realPanels, totalSqFt, bleedInches, qcSidePanels }: {
  imageUrl: string;
  createdAt: string;
  jobStatus: string;
  viewUrls?: Record<string, string>;
  sidePanelSize?: SidePanelSize;
  twoPanel?: boolean;
  realPanels?: any[];
  totalSqFt?: number;
  /** Bleed per edge as the server resolved it; undefined = unknown, show none. */
  bleedInches?: number;
  qcSidePanels?: Record<string, any> | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    const created = new Date(createdAt).getTime();
    const update = () => setElapsed(Date.now() - created);
    update();
    const iv = setInterval(update, 5_000);
    return () => clearInterval(iv);
  }, [createdAt]);

  const totalMs = QC_HOLD_HOURS * 3600 * 1000;
  const isForceReady = jobStatus === "ready";
  const progress = isForceReady ? 1 : Math.min(1, elapsed / totalMs);

  // Build view list - use PANEL_VIEW_ORDER for consistent sequencing
  const rawViews = viewUrls ? Object.entries(viewUrls) : [];
  const views = rawViews
    .sort((a, b) => {
      const ai = PANEL_VIEW_ORDER.indexOf(a[0]);
      const bi = PANEL_VIEW_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(([type, url]) => ({ type, url, label: VIEW_LABELS[type] || type }));

  // If no keyed views, create a single entry from the hero image
  if (views.length === 0 && imageUrl) {
    views.push({ type: "side", url: imageUrl, label: "Driver Side" });
  }

  const totalPanelCount = views.length;
  // Real approval state from QC Artboard wins over the time-based simulation:
  // if any of the visible views has an approved qc_side_panels entry, count
  // those as lit. Falls back to the elapsed-time fake when nothing is
  // approved yet so the existing animation still works on fresh jobs.
  const qcApprovedLitCount = views.filter(v => qcSidesApprovedFor(v.type, qcSidePanels)).length;
  const timeLit = isForceReady ? totalPanelCount : Math.floor(progress * totalPanelCount);
  const litPanelCount = Math.max(qcApprovedLitCount, timeLit);
  const allLit = litPanelCount >= totalPanelCount;

  // Per-panel glow progress: each panel gets a 0→1 fill based on time
  const panelFillDuration = totalMs / totalPanelCount; // ms per panel

  // Current active view
  const currentView = views[activeSlide] || views[0];
  const panelStartMs = activeSlide * panelFillDuration;
  const panelElapsed = isForceReady ? panelFillDuration : Math.max(0, elapsed - panelStartMs);
  const panelProgress = Math.min(1, panelElapsed / panelFillDuration);
  const isLit = panelProgress >= 1;
  const isActive = panelProgress > 0 && panelProgress < 1;

  const goPrev = useCallback(() => setActiveSlide((s) => (s - 1 + views.length) % views.length), [views.length]);
  const goNext = useCallback(() => setActiveSlide((s) => (s + 1) % views.length), [views.length]);

  return (
    <div style={{ marginBottom: 16 }}>
      {/* ── Hero Slider - one large render at a time ── */}
      <div
        style={{
          position: "relative",
          borderRadius: 10,
          overflow: "hidden",
          background: "transparent",
          border: isLit
            ? "2px solid rgba(0, 160, 240, 0.95)"
            : isActive
              ? "2px solid rgba(0, 140, 220, 0.7)"
              : "1px solid rgba(40, 50, 65, 0.3)",
          boxShadow: isLit
            ? "0 0 12px rgba(0, 160, 240, 0.5), 0 0 4px rgba(0, 200, 255, 0.8)"
            : "none",
          transition: "all 1s ease",
        }}
      >
        {/* Render image - large, full width */}
        <img
          src={currentView.url}
          alt={currentView.label}
          loading="eager"
          decoding="sync"
          style={{
            width: "100%",
            display: "block",
            objectFit: "contain",
            imageRendering: "-webkit-optimize-contrast",
          }}
        />

        {/* Panel overlay - full labels + dimensions + badge */}
        <GlassmorphismPanelOverlay
          viewType={currentView.type}
          sidePanelSize={sidePanelSize}
          lit={isLit || isActive}
          showBadge={true}
          showDimensions={true}
          twoPanel={twoPanel}
          realPanels={realPanels}
          totalSqFt={totalSqFt}
          bleedInches={bleedInches}
        />

        {/* Neon blue sweep overlay - animated fill left-to-right */}
        {isActive && (
          <div style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 12,
            background: `linear-gradient(90deg, rgba(0, 120, 220, 0.05) 0%, rgba(0, 100, 200, 0.03) ${panelProgress * 100}%, transparent ${panelProgress * 100}%)`,
            borderRadius: 8,
            transition: "background 2s ease",
          }}>
            <div style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${panelProgress * 100}%`,
              width: 3,
              background: "rgba(0, 140, 220, 0.9)",
              boxShadow: "0 0 6px rgba(0, 150, 240, 0.8), 0 0 2px rgba(0, 180, 255, 1)",
              borderRadius: 2,
              animation: "sweepEdgePulse 1.5s ease-in-out infinite",
              transition: "left 2s ease",
            }} />
          </div>
        )}

        {/* Lit panel - crisp glow border */}
        {isLit && (
          <div style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 12,
            borderRadius: 8,
            border: "2px solid rgba(0, 160, 240, 0.95)",
            boxShadow: "0 0 6px rgba(0, 150, 240, 0.6), 0 0 2px rgba(0, 180, 255, 1)",
            animation: "litPanelGlow 3s ease-in-out infinite",
          }} />
        )}

        {/* "GO" checkmark */}
        {isLit && (
          <div style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 26,
            height: 26,
            background: "#0080cc",
            borderRadius: "50%",
            zIndex: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 10px rgba(0, 120, 220, 0.7)",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}

        {/* Active: processing indicator */}
        {isActive && (
          <div style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 26,
            height: 26,
            borderRadius: "50%",
            zIndex: 14,
            border: "2px solid rgba(0, 120, 220, 0.8)",
            borderTopColor: "transparent",
            animation: "pf-spin 1s linear infinite",
          }} />
        )}

        {/* ◀ Prev arrow */}
        {views.length > 1 && (
          <button
            onClick={goPrev}
            className="pf-hero-nav-btn"
            style={{
              position: "absolute", top: "50%", left: 4, transform: "translateY(-50%)",
              borderRadius: "50%",
              background: "rgba(0, 8, 20, 0.80)", border: "1px solid rgba(0, 160, 255, 0.5)",
              color: "#00c8ff", fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", zIndex: 15, pointerEvents: "auto",
              boxShadow: "0 0 8px rgba(0, 140, 255, 0.4)",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 100, 200, 0.4)"; e.currentTarget.style.boxShadow = "0 0 14px rgba(0, 160, 255, 0.7)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0, 8, 20, 0.80)"; e.currentTarget.style.boxShadow = "0 0 8px rgba(0, 140, 255, 0.4)"; }}
          >
            ‹
          </button>
        )}

        {/* ▶ Next arrow */}
        {views.length > 1 && (
          <button
            onClick={goNext}
            className="pf-hero-nav-btn"
            style={{
              position: "absolute", top: "50%", right: 4, transform: "translateY(-50%)",
              borderRadius: "50%",
              background: "rgba(0, 8, 20, 0.80)", border: "1px solid rgba(0, 160, 255, 0.5)",
              color: "#00c8ff", fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", zIndex: 15, pointerEvents: "auto",
              boxShadow: "0 0 8px rgba(0, 140, 255, 0.4)",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 100, 200, 0.4)"; e.currentTarget.style.boxShadow = "0 0 14px rgba(0, 160, 255, 0.7)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0, 8, 20, 0.80)"; e.currentTarget.style.boxShadow = "0 0 8px rgba(0, 140, 255, 0.4)"; }}
          >
            ›
          </button>
        )}
      </div>

      {/* ── Thumbnail strip below the hero ── */}
      {views.length > 1 && (
        <div style={{
          display: "flex",
          gap: 6,
          marginTop: 8,
          overflowX: "auto",
          paddingBottom: 4,
        }}>
          {views.map((view, i) => {
            const thumbStartMs = i * panelFillDuration;
            const thumbElapsed = isForceReady ? panelFillDuration : Math.max(0, elapsed - thumbStartMs);
            // QC approval lights a thumbnail immediately, beating the timer.
            const qcLit = qcSidesApprovedFor(view.type, qcSidePanels);
            const thumbLit = qcLit || thumbElapsed >= panelFillDuration;
            const isCurrent = i === activeSlide;

            return (
              <button
                key={view.type}
                onClick={() => setActiveSlide(i)}
                className="pf-thumb-btn"
                style={{
                  position: "relative",
                  flex: "0 0 auto",
                  borderRadius: 6,
                  overflow: "hidden",
                  cursor: "pointer",
                  background: "transparent",
                  border: isCurrent
                    ? "2px solid rgba(0, 180, 255, 1)"
                    : thumbLit
                      ? "1px solid rgba(0, 140, 220, 0.6)"
                      : "1px solid rgba(40, 50, 65, 0.4)",
                  boxShadow: isCurrent
                    ? "0 0 10px rgba(0, 180, 255, 0.6)"
                    : "none",
                  opacity: isCurrent ? 1 : 0.7,
                  transition: "all 0.3s ease",
                  padding: 0,
                }}
              >
                <img
                  src={view.url}
                  alt={view.label}
                  style={{ width: "100%", display: "block", objectFit: "contain" }}
                />
                {/* Thumbnail label */}
                <div style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: "rgba(0, 8, 20, 0.85)",
                  fontSize: 8,
                  fontWeight: 700,
                  color: thumbLit ? "#00c8ff" : "#6b7280",
                  textAlign: "center",
                  padding: "2px 0",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}>
                  {view.label}
                </div>
                {/* Lit indicator dot */}
                {thumbLit && (
                  <div style={{
                    position: "absolute", top: 3, right: 3,
                    width: 8, height: 8, borderRadius: "50%",
                    background: "#00c8ff",
                    boxShadow: "0 0 6px rgba(0, 200, 255, 0.8)",
                  }} />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Production views label ── */}
      <p style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
        textTransform: "uppercase", color: "#6b7280",
        margin: "8px 0 4px",
      }}>
        Production Views - {litPanelCount}/{totalPanelCount} Panels Processed
      </p>

      {/* ── Status bar ── */}
      <div style={{
        marginTop: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 14px",
        borderRadius: 8,
        background: allLit ? "rgba(0, 140, 220, 0.08)" : "#0a1020",
        border: allLit ? "1px solid rgba(0, 140, 220, 0.3)" : "1px solid #1a2a40",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 14,
            color: allLit ? "#0090dd" : "#0070aa",
            textShadow: allLit ? "0 0 10px rgba(0, 120, 220, 0.6)" : "none",
          }}>
            {allLit ? "✓" : "◎"}
          </span>
          <div>
            <p style={{
              fontSize: 12,
              fontWeight: 700,
              color: allLit ? "#0090dd" : "#0080cc",
              textShadow: allLit ? "0 0 8px rgba(0, 120, 220, 0.5)" : "none",
            }}>
              {allLit
                ? "All Panels Glow - It's a Go"
                : `${litPanelCount} of ${totalPanelCount} panels - ${isForceReady ? "complete" : "processing"}`}
            </p>
            <p style={{ fontSize: 10, color: "#6b7280" }}>
              {allLit
                ? "Files sent to Admin QC - 24h review window active"
                : "Each panel glows when processed. When all glow, it's a go."}
            </p>
          </div>
        </div>
        {/* Progress bar */}
        <div style={{
          width: 100,
          height: 4,
          background: "#1a2a40",
          borderRadius: 2,
          overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            borderRadius: 2,
            transition: "width 2s ease",
            width: `${progress * 100}%`,
            background: allLit
              ? "linear-gradient(90deg, #0070aa, #0090dd)"
              : "linear-gradient(90deg, #004488, #0080cc)",
            boxShadow: "0 0 6px rgba(0, 100, 200, 0.5)",
          }} />
        </div>
      </div>

      <style>{`
        @keyframes sweepEdgePulse {
          0%, 100% { opacity: 0.7; box-shadow: 0 0 4px rgba(0, 150, 240, 0.6); }
          50% { opacity: 1; box-shadow: 0 0 8px rgba(0, 160, 250, 0.9), 0 0 3px rgba(0, 180, 255, 1); }
        }
        @keyframes litPanelGlow {
          0%, 100% { box-shadow: 0 0 4px rgba(0, 140, 220, 0.5), 0 0 1px rgba(0, 160, 240, 0.8); border-color: rgba(0, 140, 220, 0.8); }
          50% { box-shadow: 0 0 8px rgba(0, 150, 240, 0.7), 0 0 2px rgba(0, 180, 255, 1); border-color: rgba(0, 170, 255, 1); }
        }
        @keyframes heroPanelPulse {
          0%, 100% { border-color: rgba(0, 130, 220, 0.6); box-shadow: 0 0 4px rgba(0, 120, 200, 0.4); }
          50% { border-color: rgba(0, 160, 250, 0.9); box-shadow: 0 0 8px rgba(0, 140, 240, 0.7); }
        }
        @keyframes goGlow {
          0%, 100% { box-shadow: 0 0 6px rgba(0, 140, 220, 0.5), 0 0 2px rgba(0, 160, 240, 0.8); }
          50% { box-shadow: 0 0 10px rgba(0, 150, 240, 0.7), 0 0 3px rgba(0, 180, 255, 1); }
        }
      `}</style>
    </div>
  );
}

export default function ProductionFlow() {
  const { jobId: paramJobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const deepLinkTool = searchParams.get("tool"); // e.g. ?tool=cut_map
  const deepLinkTab = searchParams.get("tab"); // e.g. ?tab=prep
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { currentShopProfileId } = useOrganization();

  // Navigation state from tool UIs (ColorPro, WBTY, FadeWraps, ApproveMode, RevisionStudio)
  const incomingAction = (location.state as any)?.action as string | undefined;
  const incomingRenderData = (location.state as any)?.renderData as any;

  const [activeTab, setActiveTab] = useState<"projects" | "quickprep">(
    paramJobId ? "projects" : "projects"
  );
  const [quickPrepView, setQuickPrepView] = useState<"tools" | "history">("tools");
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(!!paramJobId);
  const [error, setError] = useState<string | null>(null);

  // My Jobs state
  const [myJobs, setMyJobs] = useState<any[]>([]);
  const [myJobsLoading, setMyJobsLoading] = useState(false);
  const [myGenerations, setMyGenerations] = useState<any[]>([]);
  const [showNewJobModal, setShowNewJobModal] = useState(false);
  const [creatingJob, setCreatingJob] = useState(false);

  // Quick Prep state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [processing, setProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>("");
  const [prepResult, setPrepResult] = useState<any>(null);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);

  // Individual Service state (PrepMyFile tools)
  const [serviceMode, setServiceMode] = useState<"packages" | "services">("services");
  const [runningService, setRunningService] = useState<string | null>(null);
  // Click-to-select extract modal — opens with a file URL when the user
  // picks the Extract Elements tool. Decoupled from the analyze pipeline.
  const [extractModal, setExtractModal] = useState<{ url: string; name: string } | null>(null);
  const [serviceResult, setServiceResult] = useState<any>(null);
  const [lastServiceId, setLastServiceId] = useState<string | null>(null);
  const [highlightedTool, setHighlightedTool] = useState<string | null>(deepLinkTool);
  const [pendingTool, setPendingTool] = useState<string | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [runningStartMs, setRunningStartMs] = useState<number | null>(null);
  const [runningElapsedMs, setRunningElapsedMs] = useState<number>(0);

  // Output History state
  const [outputHistory, setOutputHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [isPrivileged, setIsPrivileged] = useState(false);

  // RecreatePro inline state
  const [recreateExpanded, setRecreateExpanded] = useState(false);
  const [recreateFiles, setRecreateFiles] = useState<File[]>([]);
  const [recreatePreviews, setRecreatePreviews] = useState<string[]>([]);
  const [recreateStoredUrls, setRecreateStoredUrls] = useState<string[]>([]);
  const [recreateYear, setRecreateYear] = useState("");
  const [recreateMake, setRecreateMake] = useState("");
  const [recreateModel, setRecreateModel] = useState("");
  // Vehicle type — drives view gating (trailers/boats/etc. have no hood). Default car.
  const [recreateVehicleType, setRecreateVehicleType] = useState<VehicleType>("car");
  const [recreateNotes, setRecreateNotes] = useState("");
  // Ref to the edits/notes textarea so "Make Slight Edits" can jump to + focus it
  // when it's empty (on mobile the field scrolls out of view above the buttons —
  // customers tapped the button and couldn't find where to type the edit).
  const recreateNotesRef = useRef<HTMLTextAreaElement | null>(null);
  // Lamination finish — passed to design-panel-ai-generate as `finish`.
  // Default Gloss; auto-detects matte/satin/gloss in the Notes field.
  type RecreateFinish = "Gloss" | "Satin" | "Matte";
  const [recreateFinish, setRecreateFinish] = useState<RecreateFinish>("Gloss");
  const [recreateFinishManuallySet, setRecreateFinishManuallySet] = useState(false);
  const [recreateFinishAutoDetected, setRecreateFinishAutoDetected] = useState<RecreateFinish | null>(null);
  const detectRecreateFinishInText = (text: string): RecreateFinish | null => {
    const t = text.toLowerCase();
    if (/\bmatte\b/.test(t)) return "Matte";
    if (/\bsatin\b/.test(t)) return "Satin";
    if (/\bgloss(y)?\b/.test(t)) return "Gloss";
    return null;
  };
  // Panel size is now determined by vehicle year/make/model via getRecommendedSize - no manual picker needed
  const [recreateRendering, setRecreateRendering] = useState(false);
  const [recreateRenderUrl, setRecreateRenderUrl] = useState<string | null>(null);
  const [recreateProgress, setRecreateProgress] = useState(0);
  const [recreateStage, setRecreateStage] = useState("");
  // The intake edit pass runs AFTER the clone is already on screen (so a slow /
  // failing revise-render can never hold the recreation hostage — the "spins
  // forever at 95%, Edit hiccup retrying" bug). This flag drives a small overlay
  // chip on the visible render while that follow-up edit is applied.
  const [recreateApplyingEdit, setRecreateApplyingEdit] = useState(false);
  // Briefly highlights the Edits/Notes field when "Make Slight Edits" is tapped
  // with an empty note, so the customer actually SEES where to type (the toast +
  // silent scroll wasn't landing — "a red box flashes but no place to type").
  const [recreateNotesFlash, setRecreateNotesFlash] = useState(false);
  const [recreateGenerationId, setRecreateGenerationId] = useState<string | null>(null);
  // color_visualizations row id for this recreate — so it lands in RevisionStudio
  // as a single render and the Revise button can deep-link to it.
  const [recreateVisualizationId, setRecreateVisualizationId] = useState<string | null>(null);
  // Mirror of recreateVisualizationId that updates SYNCHRONOUSLY. handleRecreateAllSides
  // is auto-fired the moment the driver render lands — often BEFORE the React state
  // setRecreateVisualizationId has committed — so reading the state gave null and the
  // "save all 6 angles into the row" update silently skipped (RevisionStudio then showed
  // "6 of 7 views missing"). The ref is always current, so the persist reads it instead.
  const recreateVisualizationIdRef = useRef<string | null>(null);
  const [recreateStoredUrl, setRecreateStoredUrl] = useState<string | null>(null);
  const [recreateAllViews, setRecreateAllViews] = useState<Array<{ type: string; url: string }>>([]);
  const [recreateGeneratingViews, setRecreateGeneratingViews] = useState(false);
  // 2D production proof — generated as the 7th call alongside the angle renders
  const [recreateProofUrl, setRecreateProofUrl] = useState<string | null>(null);
  const [recreateProofGenerating, setRecreateProofGenerating] = useState(false);
  const [recreateDownloadingAll, setRecreateDownloadingAll] = useState(false);
  const recreateFileRef = useRef<HTMLInputElement>(null);
  const uploadZoneRef = useRef<HTMLDivElement>(null);
  const [showRecreateProductionDialog, setShowRecreateProductionDialog] = useState(false);
  const [recreateLightboxUrl, setRecreateLightboxUrl] = useState<string | null>(null);

  // ── DESIGNPRO → RECREATEPRO HANDOFF ──────────────────────────────────────
  // When a customer picks "Recreate Exactly" in DesignPro, that tool routes them
  // here (the appropriate tool for reproduce + edit) and stashes their uploaded
  // reference(s) + vehicle. Read it ONCE on mount, pre-fill the recreate form so
  // they land ready to hit "Create Exact" — no re-upload, no re-typing the
  // vehicle — expand the panel, and clear the stash. The carried refs are already
  // uploaded URLs, so handleRecreateRender uses them directly (see its
  // recreateStoredUrls fallback) instead of requiring re-picked File objects.
  useEffect(() => {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem("recreatepro_handoff"); } catch { /* ignore */ }
    if (!raw) return;
    try { sessionStorage.removeItem("recreatepro_handoff"); } catch { /* ignore */ }
    try {
      const h = JSON.parse(raw);
      const refs: string[] = Array.isArray(h?.refs) ? h.refs.filter((u: any) => typeof u === "string" && u) : [];
      if (h?.year) setRecreateYear(String(h.year));
      if (h?.make) setRecreateMake(String(h.make));
      if (h?.model) setRecreateModel(String(h.model));
      if (refs.length) {
        setRecreateStoredUrls(refs);
        setRecreateStoredUrl(refs[0]);
        setRecreatePreviews(refs);
      }
      setRecreateExpanded(true);
      setTimeout(() => {
        uploadZoneRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
      toast({
        title: "Your design came over from DesignPro",
        description: refs.length
          ? "Your uploaded design + vehicle are loaded. Tap Create Exact to recreate it — then edit if you need to."
          : "Vehicle loaded. Re-drop your design, then tap Create Exact.",
      });
    } catch { /* malformed stash — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // QA response loading states
  const [respondingIssue, setRespondingIssue] = useState<string | null>(null);
  const [purchasingUpsell, setPurchasingUpsell] = useState<string | null>(null);

  // Notification state
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [hideAttentionBanner, setHideAttentionBanner] = useState(false);

  // Job events state (timeline)
  const [jobEvents, setJobEvents] = useState<any[]>([]);

  const channelRef = useRef<any>(null);
  const notifChannelRef = useRef<any>(null);

  // ── DEEP LINK: ?tab=prep auto-opens PrepMyFile tab ──
  // Works alongside :jobId so WrapBox can deep-link
  // /productionflow/<jobId>?tab=prep to open the prep tools attached to a job.
  useEffect(() => {
    if (deepLinkTab === "prep") {
      setActiveTab("quickprep");
    }
  }, [deepLinkTab]);

  // Live elapsed-time ticker for the running-service indicator. Set
  // runningStartMs at the start of a run, clear it when the run finishes,
  // and this effect updates runningElapsedMs every 500ms in between.
  useEffect(() => {
    if (runningStartMs == null) {
      setRunningElapsedMs(0);
      return;
    }
    setRunningElapsedMs(Date.now() - runningStartMs);
    const id = setInterval(() => {
      setRunningElapsedMs(Date.now() - runningStartMs);
    }, 500);
    return () => clearInterval(id);
  }, [runningStartMs]);

  // ── DEEP LINK: ?tool=cut_map auto-opens PrepMyFile + highlights tool ──
  useEffect(() => {
    if (deepLinkTool && !paramJobId) {
      setActiveTab("quickprep");
      setServiceMode("services");
      setHighlightedTool(deepLinkTool);
      // Clear highlight after 3 seconds
      const timer = setTimeout(() => setHighlightedTool(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [deepLinkTool, paramJobId]);

  // ── INCOMING ACTION: Create job or run CutMap from tool UI navigation ──
  const incomingHandledRef = useRef(false);
  useEffect(() => {
    if (!incomingAction || !incomingRenderData || incomingHandledRef.current) return;
    incomingHandledRef.current = true;

    // Clear location state so refresh doesn't re-trigger
    window.history.replaceState({}, document.title);

    if (incomingAction === "create_production_job") {
      // Auto-create a panelizer job from the render data
      setActiveTab("projects");
      (async () => {
        setCreatingJob(true);
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Not authenticated");

          const renderUrls = incomingRenderData.render_urls || {};
          const heroUrl = renderUrls.side || renderUrls.hero || Object.values(renderUrls)[0] || incomingRenderData.hero_render_url || "";

          const { data: newJob, error: jobErr } = await supabase
            .from("panelizer_jobs" as any)
            .insert({
              user_id: user.id,
              generation_id: toUuidOrNull(incomingRenderData.generation_id),
              approved_render_url: heroUrl,
              all_view_urls: Object.values(renderUrls),
              concept_json: { ...(incomingRenderData.concept_json || {}), render_urls: renderUrls },
              vehicle_year: incomingRenderData.vehicle_year || null,
              vehicle_make: incomingRenderData.vehicle_make || "",
              vehicle_model: incomingRenderData.vehicle_model || "",
              status: "queued",
              started_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (jobErr) throw jobErr;

          toast({
            title: "Production Job Created",
            description: `${newJob.order_number} - building production files...`,
          });

          // Initialize AND run the pipeline. init_only parked jobs in 'queued'
          // forever (nothing auto-advances them); payment_confirmed inits then
          // falls through to the self-advancing run loop so the pack builds.
          const { error: pipeErr } = await supabase.functions.invoke(
            "run-production-flow",
            { body: { job_id: newJob.id, trigger: "payment_confirmed", mode: "project" } }
          );
          if (pipeErr) console.error("Pipeline run error:", pipeErr);

          // Navigate to the job detail view
          navigate(`/productionflow/${newJob.id}`, { replace: true });
        } catch (err: any) {
          toast({
            title: "Failed to Create Job",
            description: err.message || "Could not create production job",
            variant: "destructive",
          });
        } finally {
          setCreatingJob(false);
        }
      })();
    } else if (incomingAction === "run_cut_map") {
      // Auto-switch to PrepMyFile → CutMap service with the render image
      setActiveTab("quickprep");
      setServiceMode("services");
      setHighlightedTool("cut_map");
      const timer = setTimeout(() => setHighlightedTool(null), 3000);

      // Auto-load the render image as the "uploaded file" for analysis
      const renderUrls = incomingRenderData.render_urls || {};
      const imageUrl = renderUrls.side || renderUrls.hero || Object.values(renderUrls)[0] || "";

      if (imageUrl) {
        // Set analysis directly with the image URL (skip upload since it's already hosted).
        // Carry the render's vehicle metadata so the auto-created panelizer_job
        // gets populated (instead of a barebones MP-XXXXXX row in WrapBox).
        setAnalysis({
          file_url: imageUrl,
          file_analysis: {
            format: "PNG",
            source: "render",
            dimensions: "From AI render",
          },
          issues: [],
          summary: `Render image from ${incomingRenderData.vehicle_year || ""} ${incomingRenderData.vehicle_make || ""} ${incomingRenderData.vehicle_model || ""} - ready for CutMap™ processing.`.trim(),
          recommendation: "cut_map",
          all_packages: [],
          render_context: {
            vehicle_year: incomingRenderData.vehicle_year ?? null,
            vehicle_make: incomingRenderData.vehicle_make ?? null,
            vehicle_model: incomingRenderData.vehicle_model ?? null,
            design_name: incomingRenderData.design_name ?? null,
            approved_render_url: imageUrl,
            tool_source: "cut_contour_pack",
          },
        });
      }

      return () => clearTimeout(timer);
    }
  }, [incomingAction, incomingRenderData, navigate, toast]);

  // ── FETCH JOB ────────────────────────────────────────────
  useEffect(() => {
    if (!paramJobId) {
      // Clear job detail state so the jobs list can render
      setJob(null);
      setError(null);
      setLoading(false);
      return;
    }

    const fetchJob = async () => {
      setLoading(true);
      setError(null);

      console.log("[ProductionFlow] Fetching job:", paramJobId);

      // 1. Try panelizer_jobs first
      const { data, error: fetchError } = await supabase
        .from("panelizer_jobs" as any)
        .select("*")
        .eq("id", paramJobId)
        .maybeSingle();

      console.log("[ProductionFlow] panelizer_jobs result:", { found: !!data, error: fetchError?.message });

      if (!fetchError && data) {
        setJob(data);
        setActiveTab("projects");
        setLoading(false);
        return;
      }

      // 2. Fallback: check designiq_generations
      try {
        const { data: genRows, error: genErr } = await (supabase as any)
          .from("designiq_generations")
          .select("id, user_id, vehicle_year, vehicle_make, vehicle_model, hero_render_url, render_urls, generation_status, error_message, created_at, design_name, mode, concept_json")
          .eq("id", paramJobId)
          .limit(1);

        console.log("[ProductionFlow] designiq_generations result:", { found: genRows?.length, error: genErr?.message });

        const gen = genRows?.[0];
        if (!genErr && gen) {
          const genStatusMap: Record<string, string> = {
            started: "panelizing", panel_complete: "optimizing",
            render_complete: "ready", all_views: "ready",
            proof_generated: "ready", failed: "failed",
          };
          const genStageMap: Record<string, number> = {
            started: 1, panel_complete: 2, render_complete: 5,
            all_views: 6, proof_generated: 6, failed: 0,
          };
          const renderUrls = gen.render_urls || {};
          const heroUrl = gen.hero_render_url || (typeof renderUrls === "object" && !Array.isArray(renderUrls) ? (renderUrls.side || renderUrls["driver-side"] || Object.values(renderUrls)[0]) : null);
          setJob({
            id: gen.id,
            order_number: `DQ-${gen.id.slice(0, 6).toUpperCase()}`,
            status: genStatusMap[gen.generation_status] || "queued",
            vehicle_year: gen.vehicle_year,
            vehicle_make: gen.vehicle_make,
            vehicle_model: gen.vehicle_model,
            created_at: gen.created_at,
            approved_render_url: heroUrl || "",
            concept_json: { ...(gen.concept_json || {}), render_urls: renderUrls, design_name: gen.design_name, source_type: "designiq" },
            all_view_urls: typeof renderUrls === "object" && !Array.isArray(renderUrls) ? Object.values(renderUrls) : renderUrls,
            current_stage: genStageMap[gen.generation_status] ?? 0,
            stage_detail: gen.generation_status === "render_complete" || gen.generation_status === "all_views" ? "Render complete - ready" : null,
            error_message: gen.error_message,
            _source: "designiq",
          });
          setActiveTab("projects");
          setLoading(false);
          return;
        }
      } catch (e) { console.error("[ProductionFlow] designiq_generations exception:", e); }

      // 3. Fallback: check color_visualizations
      try {
        const { data: vizRows, error: vizErr } = await supabase
          .from("color_visualizations")
          .select("id, vehicle_year, vehicle_make, vehicle_model, render_urls, created_at, color_name, finish_type, design_file_name, generation_status, customer_email")
          .eq("id", paramJobId)
          .limit(1);

        console.log("[ProductionFlow] color_visualizations result:", { found: vizRows?.length, error: vizErr?.message });

        const viz = vizRows?.[0];
        if (!vizErr && viz) {
          const renderUrls = (viz.render_urls && typeof viz.render_urls === "object" && !Array.isArray(viz.render_urls)) ? viz.render_urls as Record<string, string> : {};
          const heroUrl = renderUrls.side || renderUrls["driver-side"] || Object.values(renderUrls)[0] || "";
          setJob({
            id: viz.id,
            order_number: `CP-${viz.id.slice(0, 6).toUpperCase()}`,
            status: "ready",
            vehicle_year: viz.vehicle_year,
            vehicle_make: viz.vehicle_make,
            vehicle_model: viz.vehicle_model,
            created_at: viz.created_at,
            approved_render_url: heroUrl,
            concept_json: { render_urls: renderUrls, color_name: viz.color_name, finish_type: viz.finish_type, design_name: viz.design_file_name || viz.color_name, source_type: "colorpro" },
            all_view_urls: Object.values(renderUrls),
            current_stage: 6,
            stage_detail: "Complete",
            error_message: null,
            _source: "colorpro",
          });
          setActiveTab("projects");
          setLoading(false);
          return;
        }
      } catch (e) { console.error("[ProductionFlow] color_visualizations exception:", e); }

      // Not found in any table
      console.error("[ProductionFlow] Job not found in any table:", paramJobId);
      setError("Job not found");
      setLoading(false);
    };

    fetchJob();
  }, [paramJobId]);

  // Live refresh — re-read the job every 5s while the user is sitting on a
  // job detail page so that QC Artboard approvals (panelizer_jobs.panels[]
  // + concept_json.qc_side_panels) light up the Universal Panelizer hero
  // strip, progress bar, and the Production Panels grid without a manual
  // reload. Lightweight: single row fetch, only runs while paramJobId is
  // set and the initial load has resolved.
  useEffect(() => {
    if (!paramJobId || loading) return;
    let cancelled = false;
    const refresh = async () => {
      const { data } = await supabase
        .from("panelizer_jobs" as any)
        .select("*")
        .eq("id", paramJobId)
        .maybeSingle();
      if (cancelled || !data) return;
      setJob(data);
    };
    const iv = setInterval(refresh, 5_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [paramJobId, loading]);

  // ── BUILD ASSETS RECONNECT — advance stalled QUEUED jobs by PULLING ──
  // "Order Production Pack" creates the panelizer job at status 'queued' but
  // nothing server-side advances it (the old "0/N panels processing" stall).
  // Ask the orchestrator to PULL the deterministic per-side panels from
  // production_flow_assets (trigger: pull_build_assets — canonical-id aware,
  // never re-slices). Retries on a slow timer while the job stays queued,
  // because the design-time vault build is fire-and-forget and can land
  // after this page loads. Stops as soon as the status leaves 'queued'.
  const vaultPullBusyRef = useRef(false);
  const vaultPullDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!paramJobId || !job?.id || job._source) return;
    // Durable Production Pack jobs are conducted by the Railway workflow
    // claimant. This legacy pull remains only for unmarked pre-migration jobs.
    if (job?.concept_json?.workflow?.type === "designpro.production_pack") return;
    if (job.status !== "queued") return;
    if (vaultPullDoneRef.current === job.id) return;

    const attemptPull = async () => {
      if (vaultPullBusyRef.current) return;
      vaultPullBusyRef.current = true;
      try {
        const { data } = await supabase.functions.invoke("run-production-flow", {
          body: { job_id: job.id, trigger: "pull_build_assets", mode: "project" },
        });
        if (data?.pulled) {
          vaultPullDoneRef.current = job.id;
          toast({
            title: "Production panels loaded",
            description: `Pulled ${data.sides?.length || 0} print panel(s) from Build Assets — job sent to Admin QC.`,
          });
        }
      } catch (err) {
        console.warn("[ProductionFlow] Build Assets pull attempt failed:", err);
      } finally {
        vaultPullBusyRef.current = false;
      }
    };

    attemptPull();
    const iv2 = setInterval(attemptPull, 20_000);
    return () => clearInterval(iv2);
  }, [paramJobId, job?.id, job?.status, toast]);

  // ── REALTIME SUBSCRIPTION ────────────────────────────────
  useEffect(() => {
    if (!paramJobId) return;

    const channel = supabase
      .channel(`productionflow-${paramJobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "panelizer_jobs",
          filter: `id=eq.${paramJobId}`,
        },
        (payload) => {
          setJob(payload.new);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [paramJobId]);

  // ── NOTIFICATIONS: Fetch + Realtime ─────────────────────
  const fetchNotifications = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase.functions.invoke("run-production-flow", {
        body: { mode: "get_notifications", user_id: user.id },
      });

      if (data?.notifications) setNotifications(data.notifications);
      if (typeof data?.unread_count === "number") setUnreadCount(data.unread_count);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  }, []);

  const markNotificationRead = useCallback(async (notifId?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.functions.invoke("run-production-flow", {
        body: {
          mode: "mark_read",
          user_id: user.id,
          ...(notifId ? { notification_id: notifId } : { mark_all: true }),
        },
      });

      if (notifId) {
        setNotifications((prev) => prev.map((n) => n.id === notifId ? { ...n, read: true } : n));
        setUnreadCount((c) => Math.max(0, c - 1));
      } else {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.error("Failed to mark read:", err);
    }
  }, []);

  // Fetch notifications on mount + subscribe for realtime updates
  useEffect(() => {
    fetchNotifications();

    const setupRealtimeNotif = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const channel = supabase
        .channel("production-notifications")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "production_notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            setNotifications((prev) => [payload.new, ...prev]);
            setUnreadCount((c) => c + 1);

            // Show toast for new notification
            toast({
              title: payload.new.title,
              description: payload.new.message?.slice(0, 100),
            });
          }
        )
        .subscribe();

      notifChannelRef.current = channel;
    };

    setupRealtimeNotif();

    return () => {
      if (notifChannelRef.current) {
        supabase.removeChannel(notifChannelRef.current);
      }
    };
  }, [fetchNotifications, toast]);

  // ── FETCH JOB EVENTS (timeline) ──────────────────────────
  const fetchJobEvents = useCallback(async (jobId: string) => {
    try {
      const { data } = await supabase
        .from("panelizer_job_events" as any)
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true })
        .limit(50);

      setJobEvents(data || []);
    } catch (err) {
      console.error("Failed to fetch job events:", err);
    }
  }, []);

  useEffect(() => {
    if (paramJobId && job) {
      fetchJobEvents(paramJobId);
    }
  }, [paramJobId, job, fetchJobEvents]);

  // ── HELPERS ──────────────────────────────────────────────
  const getStageIndex = useCallback((status: string) => {
    // pending_qc maps to admin_qc stage (files packaged, awaiting human approval)
    const mapped = status === "pending_qc" ? "admin_qc" : status;
    return PIPELINE_STAGES.findIndex((s) => s.key === mapped);
  }, []);

  const formatStatus = (status: string) => {
    if (status === "ready") return "Ready for Print";
    if (status === "pending_qc") return "Admin QC Review";
    if (status === "awaiting_input") return "Input Needed";
    return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // ── QA RESPONSE ──────────────────────────────────────────
  const handleQAResponse = useCallback(
    async (issueId: string, selected: string) => {
      if (!paramJobId) return;
      setRespondingIssue(issueId);

      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          "productionflow-customer-input",
          {
            body: {
              job_id: paramJobId,
              action: "qa_response",
              data: { issue_id: issueId, selected },
            },
          }
        );

        if (fnError) throw fnError;

        toast({
          title: "Response Recorded",
          description: data?.all_answered
            ? "All questions answered - pipeline resuming"
            : `${data?.remaining_questions} question(s) remaining`,
        });
      } catch (err: any) {
        toast({
          title: "Error",
          description: err.message || "Failed to submit response",
          variant: "destructive",
        });
      } finally {
        setRespondingIssue(null);
      }
    },
    [paramJobId, toast]
  );

  // ── UPSELL PURCHASE ──────────────────────────────────────
  const handleUpsellPurchase = useCallback(
    async (upsellType: string) => {
      if (!paramJobId) return;
      setPurchasingUpsell(upsellType);

      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          "productionflow-customer-input",
          {
            body: {
              job_id: paramJobId,
              action: "purchase_upsell",
              data: { upsell_type: upsellType },
            },
          }
        );

        if (fnError) throw fnError;

        toast({
          title: "Enhancement Added",
          description: data?.message || "Processing will begin shortly",
        });
      } catch (err: any) {
        toast({
          title: "Error",
          description: err.message || "Failed to purchase enhancement",
          variant: "destructive",
        });
      } finally {
        setPurchasingUpsell(null);
      }
    },
    [paramJobId, toast]
  );

  // Pipeline re-run is admin-only - handled in AdminGraphicDesignerQC

  // ── RECREATEPRO INLINE: Handle file + render ───────────
  const MAX_RECREATE_IMAGES = 6;
  const handleRecreateFileSelect = useCallback((files: FileList | File[]) => {
    const newFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (newFiles.length === 0) return;
    setRecreateFiles((prev) => {
      const combined = [...prev, ...newFiles].slice(0, MAX_RECREATE_IMAGES);
      setRecreatePreviews(combined.map((f) => URL.createObjectURL(f)));
      return combined;
    });
    setRecreateRenderUrl(null);
  }, []);

  const handleRecreateRemoveFile = useCallback((index: number) => {
    setRecreateFiles((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      setRecreatePreviews(updated.map((f) => URL.createObjectURL(f)));
      return updated;
    });
  }, []);

  // Full reset for "Start Over" — clears the reference files AND the cached
  // generation/visualization ids + stored upload urls. Without this, a stale
  // reference (and its files) survived the clear, the next upload was APPENDED
  // to it, and the exact-clone pass locked onto the OLD design (e.g. cleared to
  // try a tacos wrap, got the previous HVAC van back). Vehicle info + finish are
  // intentionally kept so you can recreate a new design on the same vehicle.
  const resetRecreateFlow = useCallback(() => {
    setRecreateRenderUrl(null);
    setRecreateProgress(0);
    setRecreateStage("");
    setRecreateApplyingEdit(false);
    setRecreateAllViews([]);
    setRecreateGeneratingViews(false);
    setRecreateStoredUrl(null);
    setRecreateStoredUrls([]);
    recreateVisualizationIdRef.current = null;
    setRecreateVisualizationId(null);
    setRecreateGenerationId(null);
    setRecreateProofUrl(null);
    setRecreateProofGenerating(false);
    setRecreateNotes("");
    setRecreateFiles([]);
    setRecreatePreviews((prev) => {
      prev.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* noop */ } });
      return [];
    });
  }, []);

  // Apply minor edits to an existing recreate render via REVISION MODE
  // (originalRenderUrl + viewType "side", no exact_reference) so the edits
  // actually stick instead of being overridden by the exact-clone block.
  const runRecreateRevision = useCallback(async (
    baseRenderUrl: string,
    instructions: string,
  ): Promise<{ renderUrl: string; generationId: string | null }> => {
    // Route recreate edits through the Master Editor (revise-render) — the mature
    // revision brain that AMPLIFIES the request, understands spatial/placement
    // language ("move the SD wordmark up so it clears the wheel arch"), and runs
    // an honesty guard that refuses to claim a change when nothing actually moved.
    //
    // PLACEMENT EDITS MUST NOT ATTACH THE REFERENCE. revise-render enters
    // "reference-match" mode on phrases like "cut off" and then re-pins the element
    // to the REFERENCE's placement. For "move the SD up so it's not cut off by the
    // wheel well" that is exactly backwards — the reference shows the SD in its OLD
    // cut-off spot, so attaching it re-anchors the logo there and the move silently
    // does nothing (the bug the customer hit). A move/reposition request acts on the
    // CURRENT render (which already carries the design), so we withhold the
    // reference for those. Genuine "make it look like the attached" edits still get
    // the reference.
    const isPlacementEdit =
      /\b(move|moved|moving|raise|raised|lift|lifted|shift|shifted|nudge|nudged|reposition|relocate|lower|lowered|scoot|bump|slide|push|pull)\b/i.test(instructions) ||
      /\bnot\s+(get\s+|be\s+|to\s+be\s+)?cut\s*-?\s*off\b/i.test(instructions) ||
      /\b(clear(s|ing)?\s+(of|the|from)|off\s+the\s+wheel|above\s+the\s+wheel|out\s+of\s+the\s+wheel|higher|lower|further\s+up|further\s+down)\b/i.test(instructions);
    const invokeRevise = async (): Promise<any> => {
      const { data, error } = await supabase.functions.invoke("revise-render", {
        body: {
          originalRenderUrl: baseRenderUrl,
          revisionPrompt: instructions,
          toolType: "designpanelpro",
          viewType: "side",
          vehicleYear: recreateYear || "2024",
          vehicleMake: recreateMake,
          vehicleModel: recreateModel,
          // Withhold references for pure placement/move edits so the reference can't
          // re-pin the element to its old spot; keep them for reference-match edits.
          visionBoardImageUrls: isPlacementEdit ? [] : recreateStoredUrls,
        },
      });
      if (error) {
        // revise-render returns a plain-English message (NO_VISIBLE_CHANGE,
        // RENDER_FAILED, etc.) in the response body — surface it verbatim so the
        // customer learns WHY an edit couldn't be applied instead of a generic fail.
        const ctx = (error as any)?.context;
        let msg = ctx?.error || ctx?.message || error.message;
        try {
          const bodyJson = await ctx?.clone?.().json?.();
          if (bodyJson?.message || bodyJson?.error) msg = bodyJson.message || bodyJson.error;
        } catch {
          // Body not JSON (gateway timeout / worker kill return plain text or
          // nothing) — try text so the customer never sees the SDK's opaque
          // "Edge Function returned a non-2xx status code".
          try {
            const bodyText = await ctx?.clone?.().text?.();
            if (bodyText) msg = String(bodyText).slice(0, 240);
          } catch { /* keep msg */ }
        }
        if (/non-2xx|failed to send|failed to fetch|load failed|network/i.test(String(msg || ""))) {
          msg = "The edit render timed out or the connection dropped before it finished — this is usually transient.";
        }
        throw new Error(msg);
      }
      if (!data?.renderUrl) throw new Error("No revised render was returned. Try rephrasing your edit.");
      return data;
    };
    // AUTOMATIC retries for transient failures (Gemini hiccup / gateway
    // timeout) — the customer typed the edit once and should never have to tap
    // anything to re-run it; the system keeps trying on its own with backoff,
    // narrating each retry in the progress stage. The honesty guard's
    // NO_VISIBLE_CHANGE verdict is actionable feedback, not transient — surface
    // it immediately instead of burning more attempts.
    const MAX_EDIT_ATTEMPTS = 3;
    let data: any;
    let lastEditErr: any = null;
    for (let attempt = 1; attempt <= MAX_EDIT_ATTEMPTS; attempt++) {
      try {
        data = await invokeRevise();
        lastEditErr = null;
        break;
      } catch (err: any) {
        lastEditErr = err;
        if (/NO_VISIBLE_CHANGE|didn'?t visibly change/i.test(err?.message || "")) throw err;
        if (attempt < MAX_EDIT_ATTEMPTS) {
          console.warn(`[ProductionFlow/Recreate] revise attempt ${attempt} failed, auto-retrying:`, err?.message);
          setRecreateStage(`Edit hiccup — retrying automatically (${attempt + 1} of ${MAX_EDIT_ATTEMPTS})...`);
          await new Promise((r) => setTimeout(r, attempt * 2500));
        }
      }
    }
    if (lastEditErr) throw lastEditErr;
    return { renderUrl: data.renderUrl as string, generationId: null };
  }, [recreateYear, recreateMake, recreateModel, recreateStoredUrls]);

  // ── QUICK EDIT (results view) — TARGETED, not a full re-recreation ──────────
  // The "Make a quick edit" box used to call handleRecreateRender("edits"), which
  // re-uploaded the references and REGENERATED all 7 views from scratch ("Generating
  // All Views…") — slow, and on a timeout it lost the edit so the customer had to
  // re-type it. This applies the change ONLY to the CURRENT driver render via
  // revise-render, re-mirrors the passenger to match, updates just those two views,
  // and CLEARS the note on success so it never asks you to repeat the same edit.
  const handleQuickEdit = useCallback(async () => {
    const note = recreateNotes.trim();
    if (!recreateRenderUrl) return;
    if (!note) {
      toast({ title: "Type your edit first", description: "Tell us what to change, then tap Apply Edit.", variant: "destructive" });
      return;
    }
    // Use the non-hiding overlay (recreateApplyingEdit) rather than
    // recreateRendering — a quick edit must keep the current design ON SCREEN
    // while the change is applied, never blank it back to the "Recreating…"
    // spinner (which reads as "it lost my design / it's spinning again").
    setRecreateApplyingEdit(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // 1. Targeted edit on the CURRENT driver render (no re-upload, no full re-gen).
      const revised = await runRecreateRevision(recreateRenderUrl, note);
      const newDriver = revised.renderUrl;
      // 2. Re-mirror the passenger from the edited driver so both sides match.
      let newPassenger: string | null = null;
      if (user) {
        // ONE PRODUCER — a deterministic flip of the just-edited driver, so both
        // sides always match. Null (honest gap) leaves the existing passenger in
        // place rather than substituting a generative render.
        newPassenger = await producePassengerView({
          driverUrl: newDriver,
          uploadDataUrl: (dataUrl) => uploadMirrorToStorage(supabase, dataUrl, user.id),
          textDetection: { modeType: "designpanelpro", prompt: note },
          vehicleYear: recreateYear || "2024",
          vehicleMake: recreateMake,
          vehicleModel: recreateModel,
          toolType: "designpanelpro",
          invokeEdgeFunction: (fn, body) => supabase.functions.invoke(fn, { body }),
          logLabel: "ProductionFlow/QuickEdit",
        });
      }
      // 3. Swap the driver (+ passenger) in the view set; leave hood/roof/front/rear
      //    untouched (the SD side wordmark doesn't live on those panels).
      setRecreateRenderUrl(newDriver);
      setRecreateAllViews((prev) => prev.map((v) =>
        v.type === "side" ? { ...v, url: newDriver }
          : (v.type === "passenger-side" && newPassenger ? { ...v, url: newPassenger } : v)
      ));
      // 4. Persist to the row.
      const vizId = recreateVisualizationId || recreateVisualizationIdRef.current;
      if (vizId) {
        const map: Record<string, string> = {};
        (recreateAllViews || []).forEach((v) => { if (v.url) map[v.type] = v.url; });
        map["side"] = newDriver;
        if (newPassenger) map["passenger-side"] = newPassenger;
        await supabase.from("color_visualizations")
          .update({ render_urls: map, updated_at: new Date().toISOString() } as any)
          .eq("id", vizId);
      }
      setRecreateNotes(""); // clear so the box is ready for the NEXT edit — never re-type the same one
      toast({ title: "Edit applied", description: "Driver + passenger updated. Hit Rebuild in Studio if you want fresh panels." });
    } catch (e: any) {
      toast({ title: "Edit couldn't be applied", description: (e?.message || "Try rephrasing your edit.").slice(0, 220), variant: "destructive" });
    } finally {
      setRecreateApplyingEdit(false);
    }
  }, [recreateRenderUrl, recreateNotes, recreateYear, recreateMake, recreateModel, runRecreateRevision, recreateVisualizationId, recreateAllViews, toast]);

  const handleRecreateRender = useCallback(async (mode: "exact" | "edits") => {
    const vehicleReady = recreateYear && recreateMake && recreateModel;
    if (!vehicleReady) {
      toast({ title: "Enter vehicle info", description: "Year, make, and model are required.", variant: "destructive" });
      return;
    }
    // A DesignPro handoff carries already-uploaded reference URLs (recreateStoredUrls)
    // with no re-picked File objects — accept those too so the customer doesn't have
    // to re-drop the image they already uploaded in DesignPro.
    const hasCarriedRefs = recreateFiles.length === 0 && recreateStoredUrls.length > 0;
    if (recreateFiles.length === 0 && !hasCarriedRefs) {
      toast({ title: "Upload a reference", description: "Drop in any image or file to recreate.", variant: "destructive" });
      return;
    }
    // "This Is It - Make Slight Edits" needs the edits typed in — without notes
    // there's nothing to change, so tell the user instead of silently cloning.
    if (mode === "edits" && !recreateNotes.trim()) {
      // Jump straight to the edits box and open the keyboard — on mobile the
      // field sits above the buttons and was easy to miss, so a toast alone left
      // customers with "nowhere to type the edit". Scroll it into view + focus.
      const el = recreateNotesRef.current;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => el.focus(), 300);
      }
      // Flash the field so the customer SEES where to type (toast + silent focus
      // wasn't enough — "a red box flashes but no place to type up there").
      setRecreateNotesFlash(true);
      setTimeout(() => setRecreateNotesFlash(false), 2600);
      toast({
        title: "Type your edit in the highlighted box ↑",
        description: "Tell us what to change (e.g. \"move the SD logo up so it's not cut off\" or \"make the stripe red\"), then tap This Is It again. To recreate it exactly as-is, use Create Exact.",
        variant: "destructive",
      });
      return;
    }

    // Capture the customer's edit note NOW — the edit pass clears recreateNotes on
    // success, so reading it later (at the row insert) would store an empty string.
    // This is "what the customer wrote"; it becomes the RevisionStudio prompt.
    const editNote = mode === "edits" ? recreateNotes.trim() : "";

    setRecreateRendering(true);
    setRecreateProgress(0);
    setRecreateStage("Uploading reference...");
    setRecreateRenderUrl(null);

    // Scroll to top so user sees the progress bar
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);

    const stages = [
      { at: 5, label: "Uploading reference image..." },
      { at: 15, label: "Analyzing design: extracting colors, patterns, layout..." },
      { at: 30, label: "Matching design elements to vehicle body lines..." },
      { at: 50, label: "Generating photorealistic 3D render..." },
      { at: 70, label: "Compositing wrap texture onto vehicle surfaces..." },
      { at: 85, label: "Finalizing render at 4K resolution..." },
      { at: 95, label: "Saving to your account..." },
    ];
    let currentStageIdx = 0;
    const progressInterval = setInterval(() => {
      setRecreateProgress((prev) => {
        const next = Math.min(prev + 1, 95);
        while (currentStageIdx < stages.length && next >= stages[currentStageIdx].at) {
          setRecreateStage(stages[currentStageIdx].label);
          currentStageIdx++;
        }
        return next;
      });
    }, 400);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Upload all reference images (1-6).
      // MOBILE SAFARI FIX: iOS hands back File objects from the photo library
      // that can become UNREADABLE under memory pressure — the storage upload's
      // internal fetch then throws "Load failed" and the whole recreation dies
      // ("Upload failed: Load failed"). Two defenses:
      //  1. Materialize the bytes with file.arrayBuffer() first (forces iOS to
      //     read the backing store now, and lets us upload a stable buffer).
      //  2. Retry each upload up to 3× with backoff so one cellular hiccup on a
      //     multi-MB photo doesn't sink the job.
      const uploadWithRetry = async (file: File, path: string): Promise<void> => {
        let lastErr: any = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const buf = await file.arrayBuffer(); // throws "Load failed" if iOS dropped the file
            const { error: upErr } = await supabase.storage
              .from("wrap-files")
              .upload(path, buf, { upsert: true, contentType: file.type || "image/png" });
            if (upErr) throw upErr;
            return; // success
          } catch (e: any) {
            lastErr = e;
            if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
          }
        }
        const raw = lastErr?.message || String(lastErr);
        // "Load failed" is opaque to a customer — tell them what to actually do.
        const friendly = /load failed|network|fetch/i.test(raw)
          ? "Photo upload was interrupted (weak signal or the phone released the photo). Re-select your reference photos and try again — on cellular, connect to Wi-Fi if you can."
          : `Upload failed: ${raw}`;
        throw new Error(friendly);
      };

      // DesignPro handoff: the reference is already uploaded (recreateStoredUrls),
      // so skip the file-upload loop and use those URLs directly. Otherwise upload
      // the freshly picked File objects as before.
      const allUploadedUrls: string[] = [];
      if (recreateFiles.length === 0 && recreateStoredUrls.length > 0) {
        allUploadedUrls.push(...recreateStoredUrls);
      } else {
        for (const file of recreateFiles) {
          const ext = file.name.split(".").pop() || "png";
          const path = `recreatepro/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
          await uploadWithRetry(file, path);
          const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
          allUploadedUrls.push(urlData.publicUrl);
        }
      }
      setRecreateStoredUrl(allUploadedUrls[0]);
      setRecreateStoredUrls(allUploadedUrls);

      // Get user email for authentication
      const userEmail = user.email;
      if (!userEmail) throw new Error("No email found. Please log in again.");

      // First pass is ALWAYS a faithful clone. In "edits" mode we layer the
      // requested changes on top as a REVISION-MODE pass below — a single
      // exact_reference/projection call can't honor edits because its "match the
      // original as closely as possible" instruction overrides any change request.
      // POLICY-SAFE WORDING: "clone this exact design / match exactly" reads to
      // Gemini as a request to copy copyrighted work, which raises its refusal
      // rate (PROHIBITED_CONTENT / RECITATION → the "edge fail"). Framing it as
      // the customer's OWN approved artwork being applied to their vehicle keeps
      // fidelity high while signalling a legitimate, non-infringing job.
      const clonePrompt = `This reference is the customer's own approved wrap design for their vehicle. Recreate it faithfully on the ${recreateMake} ${recreateModel} — reproduce every color, pattern, stripe, accent line, graphic, logo, and line of text exactly as in the reference, in the same positions and proportions, adapting only to fit the body lines. Match the design's FULL coverage and its TEXTURE DENSITY exactly: if the reference is an all-over textured wrap (claw marks, scratches, splatter, distress, grunge, flames, camo, carbon, etc.) the recreation MUST be equally dense and cover the ENTIRE body edge to edge. Do NOT simplify, clean up, or flatten it — never reduce a rich full-coverage wrap to a mostly plain body with a few accent graphics. Omit no element and add none. Reproduce each logo, wordmark, and line of text EXACTLY ONCE, only where the reference places it — never repeat, duplicate, or add a second copy of a wordmark or logo to fill the larger body; where the reference leaves the body plain, leave that same body color plain. Hold the reference's exact colors and their light-to-dark balance — do not brighten, recolor, or over-saturate the body. Keep all logos and text fully visible and clear of the wheel wells and body edges — never crop or bury a brand mark behind a wheel arch. If the reference itself shows a logo or wordmark cut off or partly hidden by a wheel arch, do NOT copy that — lift it onto the clear body panel so it reads in full; a fully legible, uncropped logo matters more than matching its exact height in the reference. Reproduce the customer's approved artwork; do not redesign it.`;
      // Last-resort fallback (final retry only): if the faithful pass keeps getting
      // refused, soften to a style-guide framing so the customer gets SOMETHING
      // on-brand rather than a hard "edge fail". Fidelity drops slightly here — it
      // is a safety net, never the first choice.
      const softClonePrompt = `Use this reference — the customer's own approved wrap design — as the visual guide for the ${recreateMake} ${recreateModel}: carry the same colors, patterns, and overall layout feel, flowing with the body lines.`;

      // The customer's uploaded wrap photo/render IS the source of truth for the
      // recreation. Do NOT generate a new artboard from it (that re-designs and
      // loses fidelity, which is what broke recreation) — feed it straight to the
      // render as an exact_reference.

      // ── STEP 3a: render the 3D proof by reproducing the uploaded design.
      setRecreateStage("Reproducing your uploaded design...");
      // RecreatePro = reproduce the customer's UPLOADED wrap EXACTLY. The upload
      // is a photo/render of a finished wrap, NOT a flat labeled multi-panel
      // artboard — so use exact_reference ("reproduce this exact design"), never
      // artboard_projection (whose prompt tells the engine to read labeled
      // "DRIVER SIDE" / "REAR" panels that a photo doesn't have, so it invents a
      // "similar" design and drops the logos/text — the #1 recreate bug).
      const renderVisionBoard = allUploadedUrls.map((url, idx) => ({ slotLabel: `Reference ${idx + 1}`, storageUrl: url }));
      const renderIntent = "exact_reference";

      // supabase.functions.invoke collapses ANY non-2xx into the opaque "Edge
      // Function returned a non-2xx status code" — this is the "xx edge fail" the
      // customer sees. The REAL cause (content filter, Gemini quota/429, timeout,
      // NO_IMAGE) lives in the response body, which the SDK never surfaces. Read
      // it, and auto-retry transient failures so one Gemini hiccup doesn't sink
      // the whole recreation.
      const realEdgeError = async (err: any, dat: any, fallback: string): Promise<string> => {
        if (dat?.error || dat?.message) return dat.error || dat.message;
        try {
          const bodyJson = await err?.context?.clone?.().json?.();
          if (bodyJson?.message || bodyJson?.error) return bodyJson.message || bodyJson.error;
        } catch { /* body not json — fall through */ }
        try {
          const bodyText = await err?.context?.text?.();
          if (bodyText) return bodyText.slice(0, 300);
        } catch { /* not readable */ }
        return err?.message || fallback;
      };

      let data: any = null;
      let error: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        // Final attempt falls back to the softer style-guide framing so a
        // persistent content-filter refusal still yields a render.
        const promptForAttempt = attempt >= 3 ? softClonePrompt : clonePrompt;
        // TIMEOUT GUARD: supabase.functions.invoke has NO built-in timeout, so a
        // stalled Gemini/edge call would leave this await hanging forever and the
        // "Recreating on…" spinner would never resolve. Bound each attempt like the
        // sibling render hooks (useColorProLogic / useDesignPanelProLogic) do — a
        // timeout just falls through to the next retry attempt.
        let res: any;
        try {
          res = await withTimeout(
            supabase.functions.invoke("design-panel-ai-generate", {
              body: {
                prompt: promptForAttempt,
                mode: "restyle",
                finish: recreateFinish,
                vehicleYear: recreateYear || "2024",
                vehicleMake: recreateMake,
                vehicleModel: recreateModel,
                visionBoardImages: renderVisionBoard,
                visionboard_intent: renderIntent,
                viewType: "side",
              },
            }),
            VIEW_RENDER_TIMEOUT_MS,
            "RecreatePro render",
          );
        } catch (timeoutErr: any) {
          res = { data: null, error: timeoutErr };
        }
        data = res.data;
        error = res.error;
        if (!error && data?.renderUrl) break;
        const msg = await realEdgeError(error, data, "recreate render failed");
        console.warn(`[ProductionFlow/Recreate] clone attempt ${attempt}/3 failed: ${msg}`);
        if (attempt < 3) {
          const filtered = /content|prohibit|safety|policy|recitation|filter|blocked/i.test(msg);
          setRecreateStage(filtered ? `Adjusting for content policy — retrying (${attempt}/3)...` : `Render hiccup — retrying (${attempt}/3)...`);
          await new Promise((r) => setTimeout(r, attempt * 2500));
          continue;
        }
        // Make the refusal legible to the customer instead of "edge fail".
        if (/content|prohibit|safety|policy|recitation|blocked/i.test(msg)) {
          throw new Error("The AI declined to reproduce this design — it likely contains a trademarked logo, licensed character, or a real person. Try a version without that element, or remove it and add it back as a separate logo layer.");
        }
        throw new Error(msg);
      }
      if (!data?.renderUrl) throw new Error("No render was returned. Try again.");

      let finalRenderUrl: string = data.renderUrl;
      let finalGenerationId: string | null = data.generationId || null;

      // ── REVEAL THE FAITHFUL CLONE IMMEDIATELY ─────────────────────────────
      // The recreation is DONE the moment design-panel-ai-generate returns.
      // Drop out of the "rendering" spinner and show it at 100% NOW. The optional
      // edit pass below runs up to 3 revise-render attempts with backoff
      // (potentially minutes) — it must NEVER block this reveal. That blocking was
      // the "spins forever at 95%, Edit hiccup — retrying (2 of 3)" bug: the
      // recreated design already existed but stayed hidden behind the edit retry
      // loop, so the customer saw an endless spinner and "it doesn't design".
      clearInterval(progressInterval);
      setRecreateProgress(100);
      setRecreateStage("Render complete!");
      setRecreateRenderUrl(finalRenderUrl);
      setRecreateGenerationId(finalGenerationId);
      setRecreateRendering(false);

      // Make Edits: layer the requested change onto the now-VISIBLE clone via
      // REVISION MODE. THE CUSTOMER TYPES THE EDIT ONCE, AT INTAKE — never again.
      // On success we swap the hero to the edited version and clear the note. On
      // failure the clone stays on screen and the note STAYS in the box so the
      // results view's "Apply Edit" re-fires the SAME typed edit with one tap —
      // the customer is told that, instead of being left to re-type it. A small
      // overlay chip (recreateApplyingEdit) shows the edit is in flight without
      // ever hiding the recreation.
      if (mode === "edits" && recreateNotes.trim()) {
        setRecreateApplyingEdit(true);
        try {
          const revised = await runRecreateRevision(finalRenderUrl, recreateNotes.trim());
          finalRenderUrl = revised.renderUrl;
          if (revised.generationId) finalGenerationId = revised.generationId;
          setRecreateRenderUrl(finalRenderUrl);
          setRecreateGenerationId(finalGenerationId);
          setRecreateNotes(""); // applied — a filled box always means "not applied yet"
          toast({ title: "Edit applied", description: "Your recreation is updated." });
        } catch (revErr: any) {
          console.error("[ProductionFlow/Recreate] edit pass failed, keeping clone:", revErr?.message || revErr);
          toast({
            title: "Recreation done — your edit didn't apply yet",
            description: `${(revErr?.message || "The edit pass failed.").slice(0, 160)} Your typed edit is saved in the edit box below the render — tap "Apply Edit" to run it again (no re-typing).`,
            variant: "destructive",
          });
        } finally {
          setRecreateApplyingEdit(false);
        }
      }

      // ── Vision QC + auto-correct runs in the BACKGROUND (non-blocking, 1 round)
      // so the render shows instantly and view generation starts right away — it
      // used to run synchronously with up to 2 correction rounds (~150s each)
      // BEFORE the render was shown, which made the recreate "spin forever". It
      // reports anything it couldn't auto-fix but never holds up the flow, never
      // swaps the hero mid-generation, and fail-opens on any error.
      (async () => {
        try {
          const { data: qc, error: qcErr } = await supabase.functions.invoke("render-verify-correct", {
            body: {
              renderUrl: finalRenderUrl,
              referenceUrl: allUploadedUrls[0] || null,
              requestedEdits: mode === "edits" ? recreateNotes.trim() : "",
              vehicleYear: recreateYear || "2024",
              vehicleMake: recreateMake,
              vehicleModel: recreateModel,
              viewType: "side",
              toolType: "designpanelpro",
              maxRounds: 1,
            },
          });
          if (!qcErr && Array.isArray(qc?.unresolved) && qc.unresolved.length > 0) {
            toast({
              title: "One thing to check",
              description: `Might still need a tweak: ${qc.unresolved.slice(0, 2).join("; ")}. Use an edit or drag it on the layer canvas.`.slice(0, 240),
            });
          }
        } catch (qcErr: any) {
          console.warn("[ProductionFlow/Recreate] verify-correct skipped:", qcErr?.message || qcErr);
        }
      })();

      // RETIRED (2026-07-19): the legacy production-flow-engine mode:"separate"
      // auto-fire is REMOVED. For RecreatePro it had no flat master artboard, so it
      // "separated" the customer's 3D reference PHOTO — producing a background panel
      // with the whole car silhouette (wheels/windows) baked in plus a generic
      // wrong-vehicle depth map (the broken "Production Layers" card). Per CLAUDE.md
      // the deterministic Build Assets gridslice (buildProductionPanels →
      // save-production-panels, fired after the 2D proof) is the ONE producer of
      // per-side print panels — it writes FLAT panels to production_flow_assets. The
      // separated-layers card below now reads THAT (recreateVisualizationId), so no
      // second, photo-derived writer is needed.

      // Persist a color_visualizations row so the design lands in RevisionStudio
      // (mode_type recreatepro). vehicle_year is NOT NULL — default a blank year
      // to 2024 so the insert never silently fails. Non-blocking.
      try {
        const parsedYear = parseInt(recreateYear, 10);
        const safeYear = Number.isFinite(parsedYear) ? parsedYear : 2024;
        // JOB-UNIQUE name (2026-07-24 fix): the constant per-vehicle name made
        // RevisionStudio's name-matched version chain collapse EVERY recreate of
        // the same vehicle into one chain (old unrelated designs appeared as
        // "past versions"). The generation-id suffix makes each job's name unique.
        const designName = `RecreatePro · ${recreateMake} ${recreateModel} · ${String(finalGenerationId || Date.now()).replace(/-/g, "").slice(0, 6).toUpperCase()}`.trim();
        const { data: vizRecord, error: vizError } = await supabase
          .from("color_visualizations")
          .insert({
            customer_email: userEmail,
            vehicle_year: safeYear,
            vehicle_make: recreateMake?.trim().toLowerCase() || null,
            vehicle_model: recreateModel?.trim().toLowerCase() || null,
            mode_type: "recreatepro",
            color_name: designName,
            color_hex: "#000000",
            finish_type: recreateFinish,
            render_urls: { side: finalRenderUrl },
            generation_status: "completed",
            is_saved: true,
            custom_design_url: allUploadedUrls[0],
            design_file_name: designName,
            // Customer-facing "Original Prompt" shown in RevisionStudio AND used as
            // the base prompt for revisions. Store the customer's edit (what they
            // wrote), or a clean neutral label for a straight recreation — NOT the
            // giant internal faithful-clone system instruction (that read as "the
            // prompt shown wasn't what I wrote" and mis-seeded revisions). The full
            // system prompt is preserved in admin_notes.system_clone_prompt.
            custom_styling_prompt_key: editNote || "Faithful recreation of your uploaded design",
            admin_notes: JSON.stringify({
              source_tool: "recreatepro",
              recreatepro_mode: mode === "exact" ? "exact_clone" : "edit",
              edit_instructions: editNote || null,
              system_clone_prompt: clonePrompt,
              reference_image_urls: allUploadedUrls,
              vehicle_type: recreateVehicleType,
              // CANONICAL BACK-LINK (per CLAUDE.md RecreatePro reconnection): store
              // the DesignIQ generation id this recreate came from so Build Assets /
              // PanelPro can resolve the canonical design and pull its per-side
              // assets instead of re-slicing. Without this link RecreatePro jobs are
              // disconnected from the sanctioned production chain.
              designiq_generation_id: finalGenerationId || null,
            }),
          } as any)
          .select("id")
          .single();
        if (vizError) {
          console.error("[ProductionFlow/Recreate] color_visualizations insert failed:", vizError.message);
          toast({ title: "Couldn't save to RevisionStudio", description: vizError.message, variant: "destructive" });
        } else if (vizRecord?.id) {
          recreateVisualizationIdRef.current = vizRecord.id;
          setRecreateVisualizationId(vizRecord.id);
          // NOTE: we intentionally DO NOT cut print panels here. This point is
          // BEFORE the 2D proof emits the branded flat artboard, so a build now
          // would cut from artboard_clean_url or the low-res customer upload —
          // producing wrong-scale, stripe-diminished panels (the "it didn't
          // panelpro-extract deterministic" bug). The deterministic cut is fired
          // LATER from the 2D-proof step with designSourceUrl = the branded flat
          // artboard (force:true), so every panel is a true 1:1 crop of the
          // stripes/design at accurate GENIE dims.
        }
      } catch (vizErr: any) {
        console.error("[ProductionFlow/Recreate] color_visualizations insert threw:", vizErr?.message || vizErr);
      }

      toast({ title: "RecreatePro Render Complete", description: `${recreateYear} ${recreateMake} ${recreateModel} - ready for production` });
    } catch (err: any) {
      clearInterval(progressInterval);
      toast({ title: "Render Failed", description: err.message || "Could not generate render", variant: "destructive" });
    } finally {
      setRecreateRendering(false);
    }
  }, [recreateYear, recreateMake, recreateModel, recreateFiles, recreateNotes, recreateFinish, recreateVehicleType, runRecreateRevision, toast]);

  // ── RECREATEPRO: Generate All Sides ─────────────────────
  const handleRecreateAllSides = useCallback(async () => {
    if (!recreateRenderUrl) return;
    setRecreateGeneratingViews(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Not authenticated");

      // Non-standard vehicles (trailer, boat, rv, bus, motorcycle) have NO
      // car-style hood AND no roof glamour shot — requesting either produces a
      // nonsense crop or, worse, a generic CAR top-down (the "roof on a truck"
      // bug). Honor the explicit Vehicle Type button, falling back to detecting
      // "trailer" in the make/model text.
      const isNonStandard = isNonStandardVehicle(recreateVehicleType)
        || /\btrailer\b/i.test(`${recreateMake} ${recreateModel}`);
      // Resolve the detected class so we can route non-standard views through
      // the vehicle-AWARE render function (designpro-trailer etc.). That function
      // reframes "front" to the trailer's narrow front wall and "rear" to the
      // cargo doors; the locked car engine (design-panel-ai-generate) has no
      // trailer framing, so it just re-clones the side ("wrong side" / mislabeled).
      const detectedType: VehicleType = isNonStandardVehicle(recreateVehicleType)
        ? recreateVehicleType
        : (/\btrailer\b/i.test(`${recreateMake} ${recreateModel}`) ? "trailer" : recreateVehicleType);
      const recreateFn = isNonStandard ? getDesignProFunctionForType(detectedType) : "design-panel-ai-generate";
      // Canonical car set is 7 views; non-standard vehicles get NO hood, NO roof.
      // PASSENGER SIDE is intentionally NOT in this AI list — it is a DETERMINISTIC
      // horizontal mirror of the driver hero (generated below), NOT an AI render.
      // The AI passenger pass kept returning a straight DUPLICATE of the driver
      // (same orientation) — "driver side displayed twice" — and often timed out.
      // A code mirror guarantees a true flipped passenger; fixMirrorText then flips
      // any reversed lettering back readable.
      const viewTypes = isNonStandard
        ? ["front", "rear", "close-up"]
        : ["hood_detail", "front", "rear", "close-up", "roof"];
      // PER-ANGLE VIEWS: clone the APPROVED DRIVER-SIDE hero to each camera angle
      // via originalRenderUrl. This is what activates the engine's strong per-view
      // CAMERA LOCK (front = straight-on, rear = straight-on, roof/hood = top-down,
      // close-up = detail). REGRESSION FIXED: a prior "feed the uploaded photo as
      // exact_reference to every angle" approach DROPPED originalRenderUrl, which
      // silently disabled that camera lock (the lock is gated on originalRenderUrl
      // in design-panel-ai-generate). With it disabled, every angle collapsed
      // toward the uploaded reference's composition — so when the customer's first
      // upload was a top-down shot, front/rear/close-up/roof all came back as the
      // ROOF. The driver hero already carries the exact approved design, so cloning
      // it keeps the design consistent across sides AND renders each true angle.
      // HYBRID — consistency on the sides, real artwork on the top panels.
      // A wrap's TOP (hood/roof/trunk) commonly carries DIFFERENT artwork from the
      // sides — e.g. racing stripes + a center emblem up the hood/roof vs the side
      // wordmark. Two failed extremes bracket this:
      //   • Feed all uploads to EVERY view → the sides drift (each view reconciles
      //     conflicting angle photos) — the "views don't match" bug.
      //   • Clone ONLY the side hero to every view → consistent, but the top panels
      //     lose their stripes (they just wear the side wordmark) — the bug the
      //     customer is reporting now.
      // So: the SIDE-family views (passenger, rear 3/4, close-up) clone the ONE
      // approved hero for consistency; the TOP-panel views (hood, front, roof) get
      // the customer's references + a precise prompt to reproduce the top artwork
      // and NOT copy the side wordmark up top. originalRenderUrl still drives the
      // per-view camera lock on every view so the angle stays correct.
      // ROOF & EVERY EXTRA ANGLE = SAME AS DESIGNPRO (Trish 2026-07-23: "Roof should
      // be same as roof on designpro"). DesignPro clones the ONE approved hero to
      // each angle with a DELIBERATELY MINIMAL prompt and NO re-fed references
      // (useDesignPanelProLogic.renderSingleView, isDesignIQRender path). The
      // per-view camera lock + the roof/hood continuity reinforcement inside
      // design-panel-ai-generate do the rest — for the roof: "the roof carries the
      // SAME continuous artwork that flows up from the body — continue it, do NOT
      // invent." RecreatePro's old prompt did the opposite: it ordered the engine to
      // keep every logo/line-of-text and "leave no plain areas," which crammed the
      // SIDE wordmark + logos onto the roof → the reported "roof is AI slop." Match
      // DesignPro exactly: minimal prompt, hero clone, no references, no top-panel
      // special-casing.
      const cloneViewPrompt = 'Reproduce the attached wrap design from a different camera angle.';

      // Show the driver-side hero immediately, then fill in each angle the
      // moment it returns — never block the whole grid on the slowest view
      // (the old code only set state after Promise.all, so a single stuck view
      // left the user staring at just the driver side while it "kept clocking").
      setRecreateAllViews([{ type: "side", url: recreateRenderUrl }]);

      const promises = viewTypes.map(async (viewType): Promise<{ type: string; url: string | null }> => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            // TIMEOUT GUARD: without a bound, one stalled edge/Gemini call never
            // settles — and because these promises feed Promise.allSettled below,
            // a single hung view left "Generating All Views…" spinning FOREVER (the
            // reported bug). Bound each attempt like the sibling render hooks; a
            // timeout throws into the catch and falls through to the next attempt,
            // so the grid always finishes with whatever views succeeded.
            const { data, error } = await withTimeout(
              supabase.functions.invoke(recreateFn, {
              body: {
                prompt: cloneViewPrompt,
                // Clone the ONE approved driver hero to THIS angle — same as
                // DesignPro. originalRenderUrl triggers the engine's per-view camera
                // lock + the roof/hood continuity reinforcement. DOWNSCALE the hero
                // (a ~8MB 4K JPG) to a bounded reference so 5 concurrent clones don't
                // OOM the 256MB worker (HTTP 546); the rendered output is still
                // full-res.
                originalRenderUrl: downscaleStorageImage(recreateRenderUrl),
                vehicleYear: recreateYear || "2024",
                vehicleMake: recreateMake,
                vehicleModel: recreateModel,
                finish: recreateFinish,
                viewType,
                mode: "restyle",
                // NO visionBoardImages — like DesignPro, the approved hero is the
                // single source of truth. Re-feeding the customer's references makes
                // Gemini re-interpret the brief per view and drift.
              },
            }),
              VIEW_RENDER_TIMEOUT_MS,
              `RecreatePro ${viewType} view`,
            );
            if (error) throw new Error(error.message);
            if (data?.renderUrl) {
              const url = data.renderUrl as string;
              // Incremental: surface this angle as soon as it lands.
              setRecreateAllViews((prev) =>
                prev.some((v) => v.type === viewType) ? prev : [...prev, { type: viewType, url }],
              );
              return { type: viewType, url };
            }
            throw new Error("No renderUrl");
          } catch (err) {
            if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
          }
        }
        return { type: viewType, url: null };
      });

      // PASSENGER SIDE — deterministic horizontal mirror of the driver hero (NOT
      // an AI render), so it can never come back as a duplicate of the driver or
      // time out. Reversed lettering is flipped back readable via fixMirrorText.
      const passengerPromise: Promise<{ type: string; url: string | null }> = (async () => {
        // ONE PRODUCER — producePassengerView. Recreations reproduce real wraps
        // that almost always carry lettering, so the mirror's backwards text is
        // flipped readable by the shared repair (which carries its own 90s
        // timeout; without one a stall here kept "Generating All Views…"
        // spinning forever via the Promise.allSettled below).
        const finalUrl = await producePassengerView({
          driverUrl: recreateRenderUrl,
          uploadDataUrl: (dataUrl) => uploadMirrorToStorage(supabase, dataUrl, user.id),
          textDetection: { modeType: "designpanelpro", prompt: recreateNotes || "" },
          vehicleYear: recreateYear || "2024",
          vehicleMake: recreateMake,
          vehicleModel: recreateModel,
          toolType: "designpanelpro",
          invokeEdgeFunction: (fn, body) => supabase.functions.invoke(fn, { body }),
          logLabel: "ProductionFlow/Recreate",
        });
        if (!finalUrl) return { type: "passenger-side", url: null };
        setRecreateAllViews((prev) =>
          prev.some((v) => v.type === "passenger-side") ? prev : [...prev, { type: "passenger-side", url: finalUrl }],
        );
        return { type: "passenger-side", url: finalUrl };
      })();

      const results = (await Promise.allSettled([...promises, passengerPromise])).map((s) =>
        s.status === "fulfilled" ? s.value : { type: "", url: null },
      );

      const views = [
        { type: "side", url: recreateRenderUrl },
        ...results.filter(v => v.url).map(v => ({ type: v.type, url: v.url! })),
      ];
      setRecreateAllViews(views);
      const failed = results.filter(v => !v.url).length;

      // Merge all view URLs into the RevisionStudio row so its carousel sees
      // every angle, not just the side hero. Read the id from the REF (not the
      // possibly-still-null state) — this function is auto-fired before the state
      // commits, so the state guard used to skip this write and leave the row at
      // { side } only ("6 of 7 views missing" in RevisionStudio).
      const vizId = recreateVisualizationId || recreateVisualizationIdRef.current;
      const renderUrlsMap: Record<string, string> = {};
      views.forEach((v) => { if (v.url) renderUrlsMap[v.type] = v.url; });
      if (vizId) {
        const { error: updateErr } = await supabase
          .from("color_visualizations")
          .update({ render_urls: renderUrlsMap, updated_at: new Date().toISOString() } as any)
          .eq("id", vizId);
        if (updateErr) console.error("[ProductionFlow/Recreate] Failed to merge views into row:", updateErr.message);
      } else {
        console.warn("[ProductionFlow/Recreate] no visualization id at persist time — 6 angles not saved to row");
      }

      // ── 7th CALL: 2D production proof, generated in parallel with the design ──
      // Fired non-blocking so the angle views render immediately. The proof is
      // painted from ALL canonical views (the same pattern ColorPro/DesignPro
      // use) and cached to admin_notes.flat_proof_url so RevisionStudio, QC, and
      // the Download All button can find it.
      setRecreateProofGenerating(true);
      // Hold the app-busy flag for the WHOLE back-half (proof + panel build) so
      // DeployVersionWatcher can never auto-reload the page mid-pipeline — the
      // root cause of "it kicked me out before the 2D proof finished" (a deploy
      // landed while the app looked idle between calls). Released in finally.
      beginAppBusy();
      (async () => {
        let panelsBuilt = false;
        // FALLBACK builder: per-side Gemini reproduce from the approved views. Only
        // runs when the deterministic gridslice can't (proof failed / no flat
        // artboard emitted). Reproduce reinterprets + can't hit ultra-wide aspect
        // ratios, so it is the safety net, never the first choice.
        const runReproduceFallback = async (why: string) => {
          if (panelsBuilt || !vizId || !Object.keys(renderUrlsMap).length) return;
          console.log(`[ProductionFlow/Recreate] entice panels — reproduce fallback (${why})`);
          try {
            const r = await buildProductionPanels({
              gid: vizId, make: recreateMake, model: recreateModel, year: recreateYear || "2024",
              allViewUrls: renderUrlsMap, reproduce: true, finish: recreateFinish,
            });
            panelsBuilt = r.built > 0;
            if (r.built > 0) toast({ title: `${r.built} print panel${r.built === 1 ? "" : "s"} ready`, description: "Per-side panels are in Production Layers below." });
            else toast({ title: "Couldn't auto-build print panels", description: `${r.reason || "builder returned nothing"} — tap “Build print panels” to retry.`, variant: "destructive" });
          } catch (e: any) {
            toast({ title: "Print-panel build hit an error", description: String(e?.message || "Unknown error").slice(0, 160), variant: "destructive" });
          }
        };
        try {
          const designName = `RecreatePro · ${recreateMake} ${recreateModel} · ${String(recreateGenerationId || vizId || Date.now()).replace(/-/g, "").slice(0, 6).toUpperCase()}`.trim();

          // 2D PRODUCTION PROOF = generate-2d-proof — THE SAME file-output line as
          // DesignPro (useDesignPanelProLogic), RevisionStudio, and ApprovePro. It is
          // the flat orthographic PAINTER that REDRAWS each approved view as a flat,
          // white-background, GENIE-dimensioned shop drawing AND emits the branded +
          // clean CONTINUOUS artboards the panel gridslice crops. It self-persists
          // flat_proof_url + the artboards under designiqGenerationId.
          //
          // The api/compose-2d-proof "composer-first" route that used to run here is
          // REMOVED (Trish 2026-07-25 "must be same file output line as DesignPro"):
          // compose-2d-proof is a Sharp image STACKER, not a flattener — fed the 3D
          // angles it bakes a 3D montage into a sheet labeled "2D proof" and, via
          // saveProofUrlToViz, OVERWRITES flat_proof_url (the PR #3587 regression the
          // 2d-proof-producer test guards for the other producers). RecreatePro is now
          // on that same guarded line — never re-introduce the compose-2d-proof
          // stacker as the proof producer here.
          const { data: proofData, error: proofErr } = await supabase.functions.invoke("generate-2d-proof", {
            body: {
              allViewUrls: renderUrlsMap,
              sideUrl: recreateRenderUrl,
              vehicleYear: recreateYear || "2024",
              vehicleMake: recreateMake,
              vehicleModel: recreateModel,
              designName,
              finish: recreateFinish,
              // CANONICAL persistence (gap fix 2026-07-24): without this id the
              // proof's master_artboard_clean_url / master_artboard_url dual-write
              // is skipped, so recreate jobs had no persisted clean base (Layer 0)
              // for LayerLiftIQ / PanelPro / later Build Assets re-slices.
              designiqGenerationId: recreateGenerationId || vizId || undefined,
            },
          });
          // The flat painter's proof is what the customer sees, approves, and what
          // the panels are extracted FROM (proof dims == panel dims by construction).
          const proofUrl = proofData?.proofUrl || proofData?.url;
          if (!proofUrl) {
            console.warn("[ProductionFlow/Recreate] 2D proof failed:", proofErr?.message || "no URL");
            await runReproduceFallback("2D proof failed");
            return;
          }
          setRecreateProofUrl(proofUrl);
          if (vizId) await saveProofUrlToViz(vizId, proofUrl);

          // generate-2d-proof emits a CONTINUOUS, full-bleed flat artboard —
          // BRANDED (full design + logos + text) for the pre-purchase entice
          // panels, plus a text-free CLEAN variant for the post-purchase pack.
          const artboardBranded: string | null = proofData?.artboardBrandedUrl || null;
          const artboardClean: string | null = proofData?.artboardCleanUrl || proofData?.artboardClean || null;
          const artboardSourceUrl: string | null = artboardBranded || artboardClean;

          // RETIRED (Trish 2026-07-24): recreatepro-build-print-files was a SECOND
          // producer — it re-cut panels from the artboard into panel_artboard_jobs
          // (the admin file hub), violating "never build a second producer". Hi-res
          // print files come from the ONE chain: entice panels below →
          // activate-print-worker → Railway, on purchase.

          // ── ENTICE PANELS — MIXED MODE (recreate side-only artboard). The
          // recreate hero is a SIDE render, so the flat artboard the 2D proof
          // emits only contains the DRIVER-SIDE design. Gridslicing FRONT/HOOD/
          // ROOF/REAR off that side sheet returned garbage crops — the front
          // became the logo (the "business-card on every panel" bug the customer
          // reported). So slice ONLY the driver side from the sheet (pixel-exact,
          // zero-AI), MIRROR passenger, and REPRODUCE hood/roof/front/rear from
          // each side's OWN approved 3D view (recreatepro-flat-panels) — the same
          // per-side flatten ProductionFlowLayersCard uses for recreate-class jobs.
          if (vizId && artboardSourceUrl) {
            try {
              const r = await buildProductionPanels({
                gid: vizId, make: recreateMake, model: recreateModel, year: recreateYear || "2024",
                allViewUrls: renderUrlsMap,
                artboardBrandedUrl: artboardBranded,
                artboardCleanUrl: artboardClean,
                sliceSides: ["DRIVER SIDE"], // only the side is on the recreate artboard
                reproduce: true,             // hood/roof/front/rear ← each side's own view
                finish: recreateFinish,
              });
              panelsBuilt = r.built > 0;
              console.log(`[ProductionFlow/Recreate] gridslice built ${r.built} panels${r.reason ? ` (${r.reason})` : ""}`);
              if (r.built > 0) toast({ title: `${r.built} print panel${r.built === 1 ? "" : "s"} ready`, description: "Sliced from the approved artboard at true GENIE dimensions — in Production Layers below." });
            } catch (e: any) {
              console.warn("[ProductionFlow/Recreate] gridslice threw:", e?.message || e);
            }
          }
          // No artboard, or the gridslice produced nothing → reproduce fallback.
          await runReproduceFallback(artboardSourceUrl ? "artboard gridslice built 0" : "proof emitted no flat artboard");
        } catch (proofErr: any) {
          console.warn("[ProductionFlow/Recreate] 2D proof threw:", proofErr?.message || proofErr);
          await runReproduceFallback("2D proof threw");
        } finally {
          setRecreateProofGenerating(false);
          endAppBusy(); // release the deploy-reload hold — back-half done
        }
      })();

      toast({
        title: failed > 0 ? `${views.length} of ${viewTypes.length + 1} views generated` : "All views generated",
        description: failed > 0 ? `${failed} view(s) failed.` : `${views.length} views ready!`,
        variant: failed > 0 ? "destructive" : undefined,
      });
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      setRecreateGeneratingViews(false);
    }
  }, [recreateRenderUrl, recreateYear, recreateMake, recreateModel, recreateVehicleType, recreateVisualizationId, recreateStoredUrl, recreateStoredUrls, recreateNotes, recreateFinish, toast]);

  // Auto-fire "Generate All Sides" the moment a recreation lands, so RecreatePro
  // shows the FULL studio angle set without a manual click — parity with
  // GraphicsPro (which now renders on the uploaded photo AND all studio angles).
  // Once per render url (ref-guarded); the manual button stays for re-runs.
  const autoSidesUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!recreateRenderUrl || recreateGeneratingViews) return;
    if (autoSidesUrlRef.current === recreateRenderUrl) return;
    autoSidesUrlRef.current = recreateRenderUrl;
    handleRecreateAllSides();
  }, [recreateRenderUrl, recreateGeneratingViews, handleRecreateAllSides]);

  // ── RECREATEPRO: Download All Files ─────────────────────
  // Downloads every generated angle (or just the side hero if "Generate All
  // Sides" hasn't been run) plus the 2D production proof, each stamped with
  // the RestylePro overlay.
  const handleRecreateDownloadAll = useCallback(async () => {
    const baseName = `${recreateYear || ""}-${recreateMake}-${recreateModel}`
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "recreatepro";

    // Prefer the full multi-view set; fall back to the single side render.
    const viewImages = recreateAllViews.length > 0
      ? recreateAllViews.filter((v) => v.url)
      : recreateRenderUrl
        ? [{ type: "side", url: recreateRenderUrl }]
        : [];

    const images = viewImages.map((v) => ({
      url: v.url,
      filename: `${baseName}-${v.type}`,
    }));
    if (recreateProofUrl) {
      images.push({ url: recreateProofUrl, filename: `${baseName}-2d-proof` });
    }

    if (images.length === 0) {
      toast({ title: "Nothing to download yet", description: "Generate a render first.", variant: "destructive" });
      return;
    }

    setRecreateDownloadingAll(true);
    try {
      await downloadAllWithOverlay(images, {
        toolName: "RecreatePro",
        colorOrDesignName: `${recreateMake} ${recreateModel}`.trim(),
      });
      toast({ title: "Download started", description: `${images.length} file(s) downloading.` });
    } catch (err: any) {
      toast({ title: "Download failed", description: err?.message || "Could not download files", variant: "destructive" });
    } finally {
      setRecreateDownloadingAll(false);
    }
  }, [recreateAllViews, recreateRenderUrl, recreateProofUrl, recreateYear, recreateMake, recreateModel, toast]);

  // ── FETCH MY JOBS ───────────────────────────────────────
  // Merges panelizer_jobs (if table exists), designiq_generations, and color_visualizations
  const fetchMyJobs = useCallback(async () => {
    setMyJobsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check if user is admin/tester - if so, show ALL jobs
      let showAllJobs = false;
      try {
        const { data: roleData } = await supabase
          .from("user_roles" as any)
          .select("role")
          .eq("user_id", user.id)
          .in("role", ["admin", "tester"])
          .limit(1);
        showAllJobs = (roleData && roleData.length > 0);
        if (showAllJobs) setIsPrivileged(true);
      } catch { /* role check failed, default to user-only */ }

      const allJobs: any[] = [];

      // 1. Try panelizer_jobs (table may not exist yet). Non-admins are
      // narrowed to the current shop's legacy shop_profiles.id so teammates
      // share visibility via Phase 1b RLS. If no shop profile is resolved
      // yet, skip this source rather than returning the whole table.
      if (showAllJobs || currentShopProfileId) {
        try {
          let query = supabase
            .from("panelizer_jobs" as any)
            .select("id, order_number, status, vehicle_year, vehicle_make, vehicle_model, created_at, processing_time_ms, zip_signed_url, current_stage, error_message, approved_render_url, concept_json");

          if (!showAllJobs) {
            query = query.eq("shop_id", currentShopProfileId!);
          }

          const { data: jobs, error: jobsErr } = await query
            .order("created_at", { ascending: false })
            .limit(50);

          if (jobsErr) console.error("[fetchMyJobs] panelizer_jobs error:", jobsErr);
          if (!jobsErr && jobs) {
            allJobs.push(...jobs.map((j: any) => ({ ...j, _source: "panelizer" })));
          }
        } catch (e) { console.error("[fetchMyJobs] panelizer_jobs query failed:", e); }
      }

      // 2. Fetch designiq_generations (DesignPro renders) — shop-scoped for
      // non-admins via the same legacy shop_profiles.id bridge.
      if (showAllJobs || currentShopProfileId) {
        try {
          let genQuery = (supabase as any)
            .from("designiq_generations")
            .select("id, user_id, vehicle_year, vehicle_make, vehicle_model, hero_render_url, render_urls, generation_status, error_message, created_at, design_name, mode, concept_json");

          if (!showAllJobs) {
            genQuery = genQuery.eq("shop_id", currentShopProfileId!);
          }

          const { data: gens, error: gensErr } = await genQuery
            .order("created_at", { ascending: false })
            .limit(30);

        if (!gensErr && gens) {
          const genStatusMap: Record<string, string> = {
            started: "panelizing",
            panel_complete: "optimizing",
            render_complete: "ready",
            all_views: "ready",
            proof_generated: "ready",
            failed: "failed",
          };
          const genStageMap: Record<string, number> = {
            started: 1,
            panel_complete: 2,
            render_complete: 5,
            all_views: 6,
            proof_generated: 6,
            failed: 0,
          };
          for (const g of gens) {
            // Skip if already represented in panelizer_jobs
            if (allJobs.some((j: any) => j.concept_json?.generation_id === g.id)) continue;
            const renderUrls = g.render_urls || {};
            const heroUrl = g.hero_render_url || (typeof renderUrls === "object" && !Array.isArray(renderUrls) ? (renderUrls.side || renderUrls["driver-side"] || Object.values(renderUrls)[0]) : null);
            allJobs.push({
              id: g.id,
              order_number: `DQ-${g.id.slice(0, 6).toUpperCase()}`,
              status: genStatusMap[g.generation_status] || "queued",
              vehicle_year: g.vehicle_year,
              vehicle_make: g.vehicle_make,
              vehicle_model: g.vehicle_model,
              created_at: g.created_at,
              approved_render_url: heroUrl || "",
              concept_json: { ...(g.concept_json || {}), render_urls: renderUrls, design_name: g.design_name, source_type: "designiq" },
              all_view_urls: typeof renderUrls === "object" && !Array.isArray(renderUrls) ? Object.values(renderUrls) : renderUrls,
              current_stage: genStageMap[g.generation_status] ?? 0,
              stage_detail: g.generation_status === "render_complete" || g.generation_status === "all_views" ? "Render complete - ready" : null,
              error_message: g.error_message,
              _source: "designiq",
            });
          }
        }
        } catch (e) { console.error("[fetchMyJobs] designiq_generations query failed:", e); }
      }

      // 3. Fetch color_visualizations (ColorPro renders)
      try {
        let vizQuery = supabase
          .from("color_visualizations")
          .select("id, vehicle_year, vehicle_make, vehicle_model, render_urls, created_at, color_name, finish_type, design_file_name, generation_status, customer_email");

        if (!showAllJobs) {
          vizQuery = vizQuery.eq("customer_email", user.email || "");
        }

        const { data: vizs, error: vizErr } = await vizQuery
          .order("created_at", { ascending: false })
          .limit(30);

        if (!vizErr && vizs) {
          for (const v of vizs) {
            const renderUrls = (v.render_urls && typeof v.render_urls === "object" && !Array.isArray(v.render_urls)) ? v.render_urls as Record<string, string> : {};
            const heroUrl = renderUrls.side || renderUrls["driver-side"] || Object.values(renderUrls)[0] || "";
            if (!heroUrl) continue; // Skip visualizations without renders
            allJobs.push({
              id: v.id,
              order_number: `CP-${v.id.slice(0, 6).toUpperCase()}`,
              status: "ready",
              vehicle_year: v.vehicle_year,
              vehicle_make: v.vehicle_make,
              vehicle_model: v.vehicle_model,
              created_at: v.created_at,
              approved_render_url: heroUrl,
              concept_json: { render_urls: renderUrls, color_name: v.color_name, finish_type: v.finish_type, design_name: v.design_file_name || v.color_name, source_type: "colorpro" },
              all_view_urls: Object.values(renderUrls),
              current_stage: 6,
              stage_detail: "Complete",
              error_message: null,
              _source: "colorpro",
            });
          }
        }
      } catch (e) { console.error("[fetchMyJobs] color_visualizations query failed:", e); }

      // Sort all by created_at descending
      allJobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setMyJobs(allJobs);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    } finally {
      setMyJobsLoading(false);
    }
  }, [currentShopProfileId]);

  // Fetch jobs when Projects tab is active and no specific job + realtime updates
  useEffect(() => {
    if (activeTab === "projects" && !paramJobId) {
      fetchMyJobs();

      // Realtime subscription for job progress updates + new jobs
      const jobChannel = supabase
        .channel("productionflow-jobs-list")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "panelizer_jobs" },
          (payload) => {
            setMyJobs((prev) =>
              prev.map((j) => (j.id === payload.new.id ? { ...j, ...payload.new } : j))
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "panelizer_jobs" },
          () => {
            // New job created - refetch the full list to include it
            fetchMyJobs();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(jobChannel);
      };
    }
  }, [activeTab, paramJobId, fetchMyJobs]);

  // ── FETCH MY GENERATIONS (for new job modal) ────────────
  // Scoped to the current shop's legacy shop_profiles.id so teammates share
  // the same generation picker. No-op if the profile hasn't resolved yet.
  const fetchMyGenerations = useCallback(async () => {
    try {
      if (!currentShopProfileId) {
        setMyGenerations([]);
        return;
      }

      const { data: gens } = await supabase
        .from("designiq_generations" as any)
        .select("id, vehicle_year, vehicle_make, vehicle_model, hero_render_url, all_view_urls, concept_json, created_at")
        .eq("shop_id", currentShopProfileId)
        .order("created_at", { ascending: false })
        .limit(20);

      setMyGenerations(gens || []);
    } catch (err) {
      console.error("Failed to fetch generations:", err);
    }
  }, [currentShopProfileId]);

  // ── CREATE JOB FROM GENERATION ─────────────────────────
  const handleCreateJob = useCallback(async (gen: any) => {
    setCreatingJob(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create panelizer_jobs entry
      const { data: newJob, error: jobErr } = await supabase
        .from("panelizer_jobs" as any)
        .insert({
          user_id: user.id,
          generation_id: toUuidOrNull(gen.id),
          approved_render_url: gen.hero_render_url,
          all_view_urls: gen.all_view_urls || [],
          concept_json: gen.concept_json || {},
          vehicle_year: gen.vehicle_year,
          vehicle_make: gen.vehicle_make,
          vehicle_model: gen.vehicle_model,
          status: "queued",
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (jobErr) throw jobErr;

      toast({
        title: "Production Job Created",
        description: `${newJob.order_number} - building production files...`,
      });

      setShowNewJobModal(false);

      // Initialize AND run the pipeline. init_only parked jobs in 'queued'
      // forever (nothing auto-advances them); payment_confirmed inits then
      // falls through to the self-advancing run loop so the pack builds.
      const { error: pipeErr } = await supabase.functions.invoke(
        "run-production-flow",
        { body: { job_id: newJob.id, trigger: "payment_confirmed", mode: "project" } }
      );
      if (pipeErr) console.error("Pipeline run error:", pipeErr);

      // Navigate to the job
      navigate(`/productionflow/${newJob.id}`);
    } catch (err: any) {
      toast({
        title: "Failed to Create Job",
        description: err.message || "Could not create production job",
        variant: "destructive",
      });
    } finally {
      setCreatingJob(false);
    }
  }, [navigate, toast]);

  // ── QUICK PREP: UPLOAD (analyze is best-effort, never blocks the tool) ──
  const handleFileSelect = useCallback(
    async (file: File) => {
      setUploadedFile(file);
      setAnalysis(null);
      setPrepResult(null);

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const ext = file.name.split(".").pop();
        const path = `quick-prep/${user.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("wrap-files")
          .upload(path, file, { upsert: true });

        if (upErr) throw upErr;

        const { data: urlData } = supabase.storage
          .from("wrap-files")
          .getPublicUrl(path);

        // Skip analyze entirely when the user is already on Individual
        // Services or has pre-selected a tool — they know what they want.
        // Analyze only makes sense for the Prep Packages flow that needs a
        // recommendation. No more "Analysis Failed" blocking the tool run.
        const skipAnalyze = serviceMode === "services" || !!pendingTool;
        if (skipAnalyze) {
          setAnalysis({
            file_url: urlData.publicUrl,
            file_analysis: { format: ext?.toUpperCase() || "FILE" },
            issues: [],
            summary: "",
            recommendation: null,
            all_packages: [],
          });
          if (pendingTool) {
            setServiceMode("services");
            setHighlightedTool(pendingTool);
            setPendingTool(null);
            setTimeout(() => setHighlightedTool(null), 4000);
          }
          return;
        }

        // Prep Packages flow only — best-effort analyze for recommendations.
        // If it fails, fall through to a minimal analysis state so the user
        // can still pick any tool manually.
        setAnalyzing(true);
        try {
          const { data, error: fnErr } = await supabase.functions.invoke(
            "run-production-flow",
            { body: { mode: "analyze", file_url: urlData.publicUrl } }
          );
          if (fnErr) throw fnErr;
          setAnalysis({
            file_url: urlData.publicUrl,
            file_analysis: data?.analysis || {},
            issues: data?.issues || [],
            summary: data?.summary || "",
            recommendation: data?.recommendation || null,
            all_packages: data?.all_packages || [],
          });
        } catch (analyzeErr) {
          console.warn("[ProductionFlow] analyze failed, continuing without recommendations:", analyzeErr);
          setAnalysis({
            file_url: urlData.publicUrl,
            file_analysis: { format: ext?.toUpperCase() || "FILE" },
            issues: [],
            summary: "File ready — pick any tool below to run.",
            recommendation: null,
            all_packages: [],
          });
        }
      } catch (err: any) {
        toast({
          title: "Upload Failed",
          description: err.message || "Could not upload file",
          variant: "destructive",
        });
        setUploadedFile(null);
      } finally {
        setAnalyzing(false);
      }
    },
    [toast, pendingTool]
  );

  // ── QUICK PREP: RUN PACKAGE ──────────────────────────────
  const handleRunQuickPrep = useCallback(
    async (packageId: string) => {
      if (!analysis?.file_url) {
        toast({ title: "Upload a file first", description: "Drop a file in the upload zone above, then select a package.", variant: "destructive" });
        return;
      }
      setProcessing(true);
      setSelectedPackage(packageId);
      setProcessingStep("Starting...");

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const { data, error: fnErr } = await supabase.functions.invoke(
          "run-production-flow",
          {
            body: {
              mode: "quick_prep",
              user_id: user.id,
              package_id: packageId,
              file_url: analysis.file_url,
              file_name: uploadedFile?.name || "file",
            },
          }
        );

        if (fnErr) throw fnErr;
        if (!data?.success && data?.error) throw new Error(data.error);

        setPrepResult(data);
        toast({
          title: "Production Prep Complete",
          description: `${data?.package || packageId} - ${data?.estimated_time_saved || ""} saved`,
        });

        // Refresh history
        fetchOutputHistory();
      } catch (err: any) {
        toast({
          title: "Prep Failed",
          description: err.message || "Quick prep failed",
          variant: "destructive",
        });
      } finally {
        setProcessing(false);
        setProcessingStep("");
      }
    },
    [analysis, uploadedFile, toast]
  );

  // ── RUN INDIVIDUAL SERVICE (routed through orchestrator for token gating + tracking) ──
  const handleRunService = useCallback(
    async (
      serviceId: string,
      serviceOptions?: any,
      override?: { fileUrl?: string; fileName?: string; jobId?: string | null },
    ) => {
      const fileUrl = override?.fileUrl ?? analysis?.file_url;
      const fileName = override?.fileName ?? uploadedFile?.name ?? "file";
      if (!fileUrl) {
        toast({ title: "Upload a file first", description: "Drop a file in the upload zone above, then run any tool on it.", variant: "destructive" });
        return;
      }
      // Click-to-select flow: open the modal instead of invoking a function.
      // The modal handles its own edge call to extract-elements with the
      // user's click points.
      if (serviceId === "extract_elements") {
        setExtractModal({ url: analysis.file_url, name: uploadedFile?.name || "file" });
        setLastServiceId(serviceId);
        return;
      }

      setRunningService(serviceId);
      setServiceResult(null);
      setLastServiceId(serviceId);
      setProcessingStep(`Running ${serviceId}...`);
      setRunningStartMs(Date.now());

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        // If we're inside an existing job (Order Production Pack flow opened
        // /productionflow/<jobId>), attach the prep output to that job.
        // Otherwise the orchestrator auto-creates a manual_prep panelizer_job.
        // Forward render_context so the auto-created job gets vehicle info.
        const existingJobId =
          override?.jobId !== undefined ? override.jobId :
          (pendingJobId || paramJobId || job?.id || null);
        const renderContext = analysis?.render_context;

        // Direct-call routing for newly-added tools that the deployed
        // orchestrator doesn't know about yet. Token gating is bypassed
        // for these — admin/tester roles bypass anyway, and the
        // orchestrator entry will be wired in on the next CLI deploy.
        const DIRECT_CALL_TOOLS: Record<string, string> = {
          layer_split: "layer-split",
          file_output: "cut-contour-build",
        };
        const directFn = DIRECT_CALL_TOOLS[serviceId];

        const { data, error: fnErr } = directFn
          ? await supabase.functions.invoke(directFn, {
              body: {
                user_id: user.id,
                file_url: fileUrl,
                file_name: fileName,
                options: serviceOptions || {},
              },
            })
          : await supabase.functions.invoke("run-production-flow", {
              body: {
                mode: "standalone_service",
                user_id: user.id,
                service_id: serviceId,
                file_url: fileUrl,
                file_name: fileName,
                options: serviceOptions || {},
                ...(existingJobId ? { job_id: existingJobId } : {}),
                ...(renderContext ? { render_context: renderContext } : {}),
              },
            });

        if (fnErr) throw fnErr;
        if (!data?.success && data?.error) throw new Error(data.error);

        setServiceResult(data);

        const orderNum = data?.order_number;
        toast({
          title: `${data?.service || serviceId} Complete`,
          description: orderNum
            ? `Saved to WrapBox under ${orderNum}. ${data?.tokens_used || 0} tokens used.`
            : `File processed - ${data?.tokens_used || 0} tokens used`,
          action: orderNum ? (
            <ToastAction altText="View in WrapBox" onClick={() => navigate(`/wrapbox?job=${orderNum}`)}>
              View in WrapBox
            </ToastAction>
          ) : undefined,
        });

        // Refresh history
        fetchOutputHistory();
      } catch (err: any) {
        toast({
          title: "Service Failed",
          description: err.message || "Service execution failed",
          variant: "destructive",
        });
      } finally {
        setRunningService(null);
        setProcessingStep("");
        setRunningStartMs(null);
        setPendingJobId(null);
      }
    },
    [analysis, uploadedFile, toast, paramJobId, job, pendingJobId, navigate]
  );

  // ── FETCH OUTPUT HISTORY ────────────────────────────────
  const fetchOutputHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error: fnErr } = await supabase.functions.invoke(
        "run-production-flow",
        {
          body: {
            mode: "get_history",
            user_id: user.id,
            limit: 50,
          },
        }
      );

      if (fnErr) throw fnErr;
      setOutputHistory(data?.actions || []);
      setTokenBalance(data?.token_balance ?? null);
      setIsPrivileged(data?.is_privileged ?? false);
    } catch (err) {
      console.error("Failed to fetch output history:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Fetch history when Quick Prep tab is active
  useEffect(() => {
    if (activeTab === "quickprep") {
      fetchOutputHistory();
    }
  }, [activeTab, fetchOutputHistory]);

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fafafa",
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        color: "#111",
      }}
    >
      {/* ── BRAND BAR ──────────────────────────────────────── */}
      <div style={{
        background: "#0A0A0F",
        borderBottom: "1px solid rgba(56,189,248,0.15)",
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, letterSpacing: 1.5,
            color: "#38BDF8",
          }}>
            RestyleProAI™
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>→</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>
            ProductionFlow™
          </span>
        </div>
        <button
          onClick={() => navigate("/wrapbox")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 14px", borderRadius: 6,
            background: "rgba(56,189,248,0.1)",
            border: "1px solid rgba(56,189,248,0.2)",
            color: "#38BDF8", cursor: "pointer",
            fontSize: 11, fontWeight: 600,
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(56,189,248,0.2)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(56,189,248,0.1)"; }}
        >
          ◧ WrapBox™
        </button>
      </div>

      {/* ── HEADER ──────────────────────────────────────────── */}
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #e5e7eb",
          padding: "12px",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg, #0ea5e9, #3b82f6)", padding: "3px 10px", borderRadius: 6, letterSpacing: 0.5 }}>
                Restyle<span style={{ color: "#bae6fd" }}>ProAI</span>™
              </span>
              <span style={{ fontSize: 13, color: "#d1d5db" }}>|</span>
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: 0.5,
                  color: "#111",
                }}
              >
                ProductionFlow™
              </span>
            </div>
            <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 2 }}>
              Production + Approval Room
            </p>
          </div>

          {/* Tab Navigation + Token Balance */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                display: "flex",
                gap: 0,
                background: "#f3f4f6",
                borderRadius: 8,
                padding: 3,
              }}
            >
              {([
                { key: "projects" as const, label: "Production Jobs" },
                { key: "quickprep" as const, label: "PrepMyFile™" },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key);
                    // If viewing a specific job and clicking "Production Jobs", navigate back to list
                    if (tab.key === "projects" && paramJobId) {
                      setJob(null);
                      setError(null);
                      setLoading(false);
                      navigate("/productionflow");
                    }
                  }}
                  style={{
                    padding: "8px 20px",
                    borderRadius: 6,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    transition: "all 0.2s",
                    background: activeTab === tab.key ? "#fff" : "transparent",
                    color: activeTab === tab.key ? "#111" : "#6b7280",
                    boxShadow:
                      activeTab === tab.key
                        ? "0 1px 3px rgba(0,0,0,0.08)"
                        : "none",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* GENIE OS Panelizer */}
            <button
              onClick={() => navigate("/printpro/production-os")}
              style={{
                padding: "8px 20px",
                background: "linear-gradient(135deg, #0066cc, #00aaff, #0080dd)",
                color: "#fff",
                borderRadius: 8,
                border: "none",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                letterSpacing: 0.5,
                boxShadow: "0 0 12px rgba(0,140,255,0.35)",
                transition: "box-shadow 0.2s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 0 20px rgba(0,140,255,0.6)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 0 12px rgba(0,140,255,0.35)"; }}
              title="Graphic Export Native Intelligence Engine"
            >
              GENIE OS™
              <span style={{ display: "block", fontSize: 8, fontWeight: 500, opacity: 0.85, marginTop: 1, letterSpacing: 0.3 }}>
                Panelizer
              </span>
            </button>
            {/* Notification Bell */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => { setShowNotifications(!showNotifications); if (!showNotifications) fetchNotifications(); }}
                style={{
                  position: "relative", width: 40, height: 40, borderRadius: 8,
                  background: unreadCount > 0 ? "#fef2f2" : "#f3f4f6",
                  border: unreadCount > 0 ? "1px solid #fecaca" : "1px solid #e5e7eb",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, transition: "all 0.2s",
                }}
                title={`${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`}
              >
                &#x1F514;
                {unreadCount > 0 && (
                  <span style={{
                    position: "absolute", top: -4, right: -4,
                    width: 18, height: 18, borderRadius: "50%",
                    background: "#ef4444", color: "#fff",
                    fontSize: 10, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>

              {/* Notification Dropdown */}
              {showNotifications && (
                <div style={{
                  position: "absolute", top: 48, right: 0, width: 380, maxHeight: 480,
                  background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb",
                  boxShadow: "0 8px 30px rgba(0,0,0,0.12)", zIndex: 100, overflow: "hidden",
                }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "14px 16px", borderBottom: "1px solid #f3f4f6",
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>
                      Notifications {unreadCount > 0 && <span style={{ color: "#ef4444" }}>({unreadCount})</span>}
                    </span>
                    {unreadCount > 0 && (
                      <button
                        onClick={() => markNotificationRead()}
                        style={{ fontSize: 12, color: "#6366f1", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    {notifications.length === 0 ? (
                      <div style={{ padding: "32px 16px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
                        No notifications yet
                      </div>
                    ) : notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={() => {
                          if (!notif.read) markNotificationRead(notif.id);
                          if (notif.action_url) navigate(notif.action_url);
                          setShowNotifications(false);
                        }}
                        style={{
                          padding: "12px 16px", cursor: "pointer",
                          borderBottom: "1px solid #f9fafb",
                          background: notif.read ? "#fff" : "#f0f4ff",
                          transition: "background 0.2s",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f9fafb"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = notif.read ? "#fff" : "#f0f4ff"; }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                          <span style={{
                            fontSize: 16, marginTop: 2,
                            filter: notif.type === "qa_input_needed" ? "hue-rotate(0deg)" :
                                   notif.type === "job_ready" ? "hue-rotate(120deg)" :
                                   notif.type === "job_failed" ? "hue-rotate(0deg)" : "grayscale(1)",
                          }}>
                            {notif.type === "qa_input_needed" ? "⚠" :
                             notif.type === "job_ready" ? "✓" :
                             notif.type === "job_failed" ? "✕" : "ℹ"}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 13, fontWeight: notif.read ? 500 : 700, color: "#111",
                              marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            }}>
                              {notif.title}
                            </div>
                            <div style={{
                              fontSize: 12, color: "#6b7280", lineHeight: 1.4,
                              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any, overflow: "hidden",
                            }}>
                              {notif.message}
                            </div>
                            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                              {new Date(notif.created_at).toLocaleString()}
                            </div>
                          </div>
                          {!notif.read && (
                            <span style={{
                              width: 8, height: 8, borderRadius: "50%",
                              background: "#6366f1", flexShrink: 0, marginTop: 6,
                            }} />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {(tokenBalance !== null || isPrivileged) && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 14px", background: isPrivileged ? "#f0fdf4" : "#f0f0ff", borderRadius: 8,
                border: `1px solid ${isPrivileged ? "#bbf7d0" : "#e0e0ff"}`,
              }}>
                <span style={{ fontSize: isPrivileged ? 12 : 16, fontWeight: 800, color: isPrivileged ? "#16a34a" : "#6366f1" }}>
                  {isPrivileged ? "Unlimited" : tokenBalance}
                </span>
                {!isPrivileged && <span style={{ fontSize: 11, fontWeight: 600, color: "#6366f1" }}>tokens</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 12px" }}>
        {/* ═══════════════════════════════════════════════════ */}
        {/* LOADING STATE */}
        {/* ═══════════════════════════════════════════════════ */}
        {loading && (
          <div
            style={{
              textAlign: "center",
              padding: "80px 0",
              color: "#9ca3af",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                border: "3px solid #e5e7eb",
                borderTopColor: "#6366f1",
                margin: "0 auto 16px",
                animation: "pf-spin 1s linear infinite",
              }}
            />
            <p style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>
              Loading production job...
            </p>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/* ERROR STATE */}
        {/* ═══════════════════════════════════════════════════ */}
        {error && !loading && (
          <div
            style={{
              textAlign: "center",
              padding: "80px 0",
              color: "#9ca3af",
            }}
          >
            <p style={{ fontSize: 48, marginBottom: 16 }}>⚠</p>
            <p style={{ fontSize: 16, fontWeight: 600, color: "#dc2626", marginBottom: 4 }}>
              {error}
            </p>
            <p style={{ fontSize: 13, marginTop: 4 }}>
              The job ID may be invalid or you may not have access
            </p>
            <button
              onClick={() => {
                setJob(null);
                setError(null);
                setLoading(false);
                navigate("/productionflow");
              }}
              style={{
                marginTop: 20,
                padding: "10px 24px",
                background: "#6366f1",
                color: "#fff",
                borderRadius: 8,
                border: "none",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Back to Production Jobs
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/* PROJECT MODE */}
        {/* ═══════════════════════════════════════════════════ */}
        {activeTab === "projects" && job && !loading && (
          <div>
            {/* ═══ BACK TO JOBS LIST ═══ */}
            <button
              onClick={() => {
                setJob(null);
                setError(null);
                setLoading(false);
                navigate("/productionflow");
              }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 16px", marginBottom: 12,
                background: "rgba(0, 100, 200, 0.08)",
                border: "1px solid rgba(0, 140, 220, 0.2)",
                borderRadius: 8, cursor: "pointer",
                fontSize: 13, fontWeight: 600, color: "#0090dd",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 100, 200, 0.15)"; e.currentTarget.style.borderColor = "rgba(0, 140, 220, 0.4)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0, 100, 200, 0.08)"; e.currentTarget.style.borderColor = "rgba(0, 140, 220, 0.2)"; }}
            >
              ← Production Jobs
            </button>

            {/* ═══ GENIE UNIVERSAL PANELIZER — the customer's live build window.
                Starts at purchase (stripe-webhook → activate-print-worker); each
                zone glows as the Railway worker lands that side's print files,
                and the ZIP button appears once the pack is delivered. Pinned to
                THIS job. Only for jobs with a print build (production_pack buy
                or worker activity) — design-only jobs skip it. ═══ */}
            {(job.job_type === "production_pack" || job.concept_json?.print_worker) && (
              <div style={{ marginBottom: 12 }}>
                <GenieUniversalPanelizerCard jobId={job.id} />
              </div>
            )}

            {/* ═══ TOP BAR: Order # (left) + Vehicle + Status + Download ═══ */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 20px",
              background: "#fff",
              borderRadius: "12px 12px 0 0",
              borderBottom: "1px solid #e5e7eb",
              border: "1px solid #e5e7eb",
              flexWrap: "wrap",
              gap: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: "#111", fontFamily: "Inter, sans-serif", letterSpacing: -0.3 }}>
                  {job.order_number}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                  background: (STATUS_COLORS[job.status] || "#6b7280") + "18",
                  color: STATUS_COLORS[job.status] || "#6b7280",
                  textTransform: "uppercase", letterSpacing: 1,
                }}>
                  {formatStatus(job.status)}
                </span>
                {job.concept_json?.source_type === "recreatepro" && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                    background: "rgba(124,58,237,0.12)", color: "#7c3aed",
                    textTransform: "uppercase", letterSpacing: 1,
                  }}>RecreatePro</span>
                )}
                <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>
                  {[job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ")}
                </span>
                {job.processing_time_ms && (
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>
                    {(job.processing_time_ms / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {job.status === "ready" && job.zip_signed_url && (
                  <a href={job.zip_signed_url} target="_blank" rel="noopener noreferrer" style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "8px 18px", background: "#111", color: "#fff",
                    borderRadius: 6, textDecoration: "none", fontSize: 12, fontWeight: 600,
                  }}>
                    ↓ Download Pack
                  </a>
                )}
              </div>
            </div>

            {/* ═══ PIPELINE PROGRESS SPINE - horizontal, always visible ═══ */}
            <div className="pf-stepper-wrap" style={{
              background: "#fff",
              borderLeft: "1px solid #e5e7eb",
              borderRight: "1px solid #e5e7eb",
              borderBottom: "1px solid #e5e7eb",
              marginBottom: 16,
              borderRadius: "0 0 12px 12px",
            }}>
              <div className="pf-stepper-inner">
                {PIPELINE_STAGES.map((stage, i) => {
                  const currentIdx = getStageIndex(job.status);
                  const isReady = job.status === "ready";
                  const isComplete = i < currentIdx || isReady;
                  const isCurrent = stage.key === job.status;

                  return (
                    <div key={stage.key} className="pf-stepper-item">
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, minWidth: 0 }}>
                        {/* Stage circle */}
                        <div className="pf-stepper-circle" style={{
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          transition: "all 0.5s",
                          background: isComplete ? "#0080cc" : isCurrent ? "#0060aa" : "#f3f4f6",
                          color: isComplete || isCurrent ? "#fff" : "#c4c4c4",
                          boxShadow: isComplete
                            ? "0 0 8px rgba(0, 120, 220, 0.5)"
                            : isCurrent
                              ? "0 0 12px rgba(0, 100, 200, 0.6), 0 0 24px rgba(0, 80, 180, 0.2)"
                              : "none",
                          animation: isCurrent ? "pipelineNodeGlow 2s ease-in-out infinite" : "none",
                        }}>
                          {isComplete ? "✓" : stage.icon}
                        </div>
                        {/* Label - full on desktop, short on mobile */}
                        <span className="pf-stepper-label-full" style={{
                          fontWeight: 700,
                          color: isComplete ? "#0080cc" : isCurrent ? "#0070bb" : "#c4c4c4",
                          marginTop: 4,
                          textAlign: "center",
                          letterSpacing: 0.5,
                          textTransform: "uppercase",
                          textShadow: (isComplete || isCurrent) ? "0 0 6px rgba(0, 100, 200, 0.3)" : "none",
                        }}>
                          {stage.label}
                        </span>
                        <span className="pf-stepper-label-short" style={{
                          fontWeight: 700,
                          color: isComplete ? "#0080cc" : isCurrent ? "#0070bb" : "#c4c4c4",
                          marginTop: 3,
                          textAlign: "center",
                          letterSpacing: 0.3,
                          textTransform: "uppercase",
                          textShadow: (isComplete || isCurrent) ? "0 0 6px rgba(0, 100, 200, 0.3)" : "none",
                        }}>
                          {stage.shortLabel}
                        </span>
                      </div>
                      {/* Connector line */}
                      {i < PIPELINE_STAGES.length - 1 && (
                        <div className="pf-stepper-connector" style={{
                          background: isComplete
                            ? "linear-gradient(90deg, rgba(0, 120, 220, 0.8), rgba(0, 100, 200, 0.6))"
                            : isCurrent
                              ? "linear-gradient(90deg, rgba(0, 100, 200, 0.4), rgba(0, 80, 160, 0.2))"
                              : "#e5e7eb",
                          boxShadow: isComplete ? "0 0 4px rgba(0, 100, 200, 0.3)" : "none",
                          transition: "all 0.5s",
                          borderRadius: 1,
                        }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ═══ MAIN CONTENT: All Views Grid with Panel Overlays ═══ */}
            <div style={{
              background: "#0c0f16",
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
              border: job.status === "ready"
                ? "1px solid rgba(0, 180, 255, 0.6)"
                : "1px solid rgba(0, 140, 220, 0.25)",
              boxShadow: job.status === "ready"
                ? "0 0 20px rgba(0, 160, 240, 0.3), 0 0 40px rgba(0, 120, 200, 0.1), inset 0 0 20px rgba(0, 140, 220, 0.05)"
                : (job.status === "packaging" || job.status === "extracting_elements" || job.status === "admin_qc")
                  ? "0 0 12px rgba(0, 140, 220, 0.2), inset 0 0 12px rgba(0, 120, 200, 0.03)"
                  : "none",
              transition: "all 1s ease",
            }}>
              {/* UniversalPanelizer™ branding */}
              <div className="pf-panelizer-header">
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0090dd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                  <span className="pf-panelizer-title">
                    ProductionFlow - UniversalPanelizer™
                  </span>
                </div>
                <span className="pf-panelizer-tagline">
                  When All Panels Glow, It's a Go
                </span>
              </div>

              {/* All views grid - panel overlays with sequential glow */}
              {job.approved_render_url && (
                <ProductionPanelizerHero
                  imageUrl={job.approved_render_url}
                  createdAt={job.created_at}
                  jobStatus={job.status}
                  viewUrls={job.concept_json?.render_urls || (typeof job.all_view_urls === 'object' && !Array.isArray(job.all_view_urls) ? job.all_view_urls : undefined)}
                  sidePanelSize={extractSidePanelSize(job.panels, job.concept_json)}
                  twoPanel={extractTwoPanel(job.concept_json)}
                  realPanels={job.panels}
                  totalSqFt={job.stage_progress?.panelizer_step_data?.validate?.result?.totalSqFt}
                  bleedInches={job.stage_progress?.panelizer_step_data?.validate?.result?.bleedInches}
                  qcSidePanels={job.concept_json?.qc_side_panels || null}
                />
              )}
            </div>

            {/* ── Production Snapshot ─────────────────────── */}
            <div
              style={{
                background: "#fff",
                borderRadius: 12,
                padding: "24px 28px",
                marginBottom: 20,
                border: "1px solid #e5e7eb",
              }}
            >
              <h3
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 1.5,
                  color: "#9ca3af",
                  textTransform: "uppercase",
                  marginBottom: 16,
                }}
              >
                Production Snapshot
              </h3>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                {[
                  {
                    label: "Panelized",
                    check: job.stage_progress?.panelizer_complete,
                  },
                  { label: "QA Passed", check: job.qa_passed },
                  {
                    label: 'Bleed 0.5"',
                    check: job.stage_progress?.panelizer_complete,
                  },
                  {
                    label: "DPI 150+",
                    check: job.stage_progress?.panelizer_complete,
                  },
                  {
                    label: 'Roll Width 59.5"',
                    check: job.stage_progress?.panelizer_complete,
                  },
                  {
                    label: "Pack Generated",
                    check: job.stage_progress?.package_complete,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 16px",
                      borderRadius: 8,
                      background: item.check ? "#f0fdf4" : "#f9fafb",
                      border: `1px solid ${
                        item.check ? "#bbf7d0" : "#e5e7eb"
                      }`,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>
                      {item.check ? "✓" : "○"}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: item.check ? "#16a34a" : "#9ca3af",
                      }}
                    >
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
              <p
                style={{
                  fontSize: 10,
                  color: "#c4c4c4",
                  marginTop: 16,
                  letterSpacing: 0.5,
                }}
              >
                Powered by Universal Panelizer™ File Output System
              </p>
            </div>

            {/* ── Pipeline Step Detail - output previews + approve/stop gates ── */}
            <PipelineStepDetail job={job} isPrivileged={isPrivileged} />

            {/* ── QC Side Panels — designer-approved per-side panels from QC Artboard ──
                Per-side approved panel gallery, so anyone landing on the
                ProductionFlow job page can see exactly which sides are
                approved and which still need a panel. Once every side is
                approved this set IS the complete print file pack. */}
            {(() => {
              const sidePanels: Record<string, any> = job?.concept_json?.qc_side_panels || {};
              const entries = Object.entries(sidePanels);
              if (entries.length === 0) return null;
              const ORDER = ["driver_side", "passenger_side", "hood", "roof", "rear", "front_bumper", "rear_bumper"];
              entries.sort(([a], [b]) => {
                const ai = ORDER.indexOf(a); const bi = ORDER.indexOf(b);
                if (ai === -1 && bi === -1) return a.localeCompare(b);
                if (ai === -1) return 1;
                if (bi === -1) return -1;
                return ai - bi;
              });
              const approvedCount = entries.filter(([, p]) => p?.approved).length;
              const complete = approvedCount === entries.length;
              return (
                <div style={{
                  background: "#fff", borderRadius: 12, padding: "20px 24px",
                  marginBottom: 20, border: `1px solid ${complete ? "rgba(16,185,129,0.4)" : "rgba(6,182,212,0.3)"}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
                        color: complete ? "#059669" : "#0e7490", textTransform: "uppercase",
                      }}>
                        QC Side Panels
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                        background: complete ? "rgba(16,185,129,0.12)" : "rgba(6,182,212,0.1)",
                        color: complete ? "#059669" : "#0891b2",
                      }}>
                        {approvedCount}/{entries.length} {complete ? "Approved · Complete Pack" : "approved"}
                      </span>
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>
                    Each panel a designer confirmed is saved here per side. When every side shows the green check, this set is the complete print file pack for the job.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                    {entries.map(([sideKey, panel]: [string, any]) => (
                      <div key={sideKey} style={{
                        borderRadius: 8, overflow: "hidden", position: "relative",
                        border: panel?.approved ? "2px solid #10b981" : "1px solid #f59e0b",
                        background: "#fafafa",
                      }}>
                        {panel?.panelUrl && (
                          <img
                            src={panel.panelUrl}
                            alt={`${sideKey} — ${panel?.designName || ""}`}
                            style={{ width: "100%", aspectRatio: "21 / 9", objectFit: "contain", display: "block", background: "#fff" }}
                          />
                        )}
                        {panel?.approved && (
                          <div style={{
                            position: "absolute", top: 6, right: 6,
                            background: "#10b981", color: "#fff",
                            fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 999,
                            letterSpacing: 0.4,
                          }}>
                            ✓ APPROVED
                          </div>
                        )}
                        <div style={{ padding: "8px 10px" }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: "#111827", textTransform: "uppercase", letterSpacing: 0.4, margin: 0 }}>
                            {sideKey.replace(/_/g, " ")}
                          </p>
                          {panel?.designName && (
                            <p style={{ fontSize: 10, color: "#6b7280", margin: "2px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {panel.designName}
                            </p>
                          )}
                          <p style={{ fontSize: 9, color: "#9ca3af", margin: "2px 0 0" }}>
                            {panel?.finish || ""}{panel?.category ? ` · ${panel.category}` : ""}
                            {panel?.approved_at ? ` · ${new Date(panel.approved_at).toLocaleDateString()}` : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── RecreatePro Reference Images (if this is a RecreatePro job) ── */}
            {job.concept_json?.source_type === "recreatepro" && (job.concept_json?.reference_image_urls?.length > 0 || job.concept_json?.reference_image_url) && (
              <div style={{
                background: "#fff", borderRadius: 12, padding: "20px 24px",
                marginBottom: 20, border: "1px solid rgba(124,58,237,0.2)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "#7c3aed",
                    textTransform: "uppercase",
                  }}>
                    RecreatePro Reference Photos
                  </span>
                  <span style={{
                    fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                    background: "rgba(124,58,237,0.1)", color: "#a78bfa",
                  }}>
                    {(job.concept_json.reference_image_urls || [job.concept_json.reference_image_url]).filter(Boolean).length} photo{(job.concept_json.reference_image_urls || []).length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min((job.concept_json.reference_image_urls || [job.concept_json.reference_image_url]).filter(Boolean).length, 3)}, 1fr)`, gap: 10 }}>
                  {(job.concept_json.reference_image_urls || [job.concept_json.reference_image_url]).filter(Boolean).map((url: string, idx: number) => (
                    <div key={idx} style={{
                      borderRadius: 8, overflow: "hidden", position: "relative",
                      border: idx === 0 ? "2px solid #7c3aed" : "1px solid #e5e7eb",
                    }}>
                      <img src={url} alt={`Reference ${idx + 1}`} style={{ width: "100%", display: "block", objectFit: "contain" }} />
                      {idx === 0 && (
                        <div style={{
                          position: "absolute", bottom: 6, left: 6, background: "rgba(124,58,237,0.9)",
                          color: "#fff", fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 3, letterSpacing: 0.5,
                        }}>PRIMARY REFERENCE</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Customer Input (if awaiting) ────────────── */}
            {job.status === "awaiting_input" &&
              job.customer_inputs?.length > 0 && (
                <div
                  style={{
                    background: "#fffbeb",
                    borderRadius: 12,
                    padding: "24px 28px",
                    marginBottom: 20,
                    border: "2px solid #fbbf24",
                  }}
                >
                  <h3
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#92400e",
                      marginBottom: 16,
                    }}
                  >
                    ⚠ Your Input Needed
                  </h3>
                  {(job.customer_inputs || [])
                    .filter((input: any) => !input.answered_at)
                    .map((input: any, i: number) => (
                      <div
                        key={input.issue_id || i}
                        style={{
                          marginBottom: 16,
                          padding: 16,
                          background: "#fff",
                          borderRadius: 8,
                        }}
                      >
                        <p
                          style={{
                            fontSize: 14,
                            color: "#374151",
                            marginBottom: 12,
                          }}
                        >
                          {input.question}
                        </p>
                        <div style={{ display: "flex", gap: 8 }}>
                          {(input.options || ["auto_fix", "keep_as_is"]).map(
                            (opt: string) => (
                              <button
                                key={opt}
                                disabled={
                                  respondingIssue === input.issue_id
                                }
                                onClick={() =>
                                  handleQAResponse(input.issue_id, opt)
                                }
                                style={{
                                  padding: "8px 20px",
                                  borderRadius: 6,
                                  border: "1px solid #e5e7eb",
                                  background:
                                    opt === "auto_fix" ? "#111" : "#fff",
                                  color:
                                    opt === "auto_fix" ? "#fff" : "#374151",
                                  fontSize: 13,
                                  fontWeight: 600,
                                  cursor:
                                    respondingIssue === input.issue_id
                                      ? "wait"
                                      : "pointer",
                                  opacity:
                                    respondingIssue === input.issue_id
                                      ? 0.6
                                      : 1,
                                }}
                              >
                                {opt === "auto_fix"
                                  ? `Auto-Fix${
                                      input.cost ? ` - $${input.cost}` : ""
                                    }`
                                  : "Keep As-Is"}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}

            {/* ── Panel Grid ─────────────────────────────── */}
            {job.panels?.length > 0 && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  padding: "24px 28px",
                  marginBottom: 20,
                  border: "1px solid #e5e7eb",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 16,
                  }}
                >
                  <h3
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      color: "#9ca3af",
                      textTransform: "uppercase",
                    }}
                  >
                    Production Panels
                  </h3>
                  <span style={{ fontSize: 13, color: "#6b7280" }}>
                    {job.panels?.length ?? 0} panels • 59.5" roll width
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: 16,
                  }}
                >
                  {(job.panels || []).map((panel: any) => {
                    // Marry the QC Artboard approval state with the panel
                    // record so an approved side flips this card to "Ready"
                    // and shows the saved panel image as the preview.
                    const qcMap: Record<string, any> = job.concept_json?.qc_side_panels || {};
                    const nameKey = String(panel.label || panel.name || panel.id || "")
                      .toLowerCase()
                      .replace(/\s+/g, "_")
                      .replace(/[^a-z_]/g, "");
                    const qcAliases: Record<string, string[]> = {
                      driver_side: ["driver_side", "driver-side", "drivers_side", "left_side"],
                      passenger_side: ["passenger_side", "passenger-side", "passengers_side", "right_side"],
                      hood: ["hood"],
                      roof: ["roof", "top"],
                      rear: ["rear", "back"],
                      front: ["front"],
                    };
                    const qcKey = Object.entries(qcAliases).find(([, aliases]) =>
                      aliases.some(a => nameKey.includes(a))
                    )?.[0];
                    const qcEntry = qcKey ? qcMap[qcKey] : null;
                    const approved = !!qcEntry?.approved;
                    const previewUrl = qcEntry?.panelUrl || panel.signed_url || panel.preview_url;
                    const displayStatus = approved ? "ready" : panel.status;

                    return (
                    <div
                      key={panel.name}
                      style={{
                        border: approved ? "1px solid #10b981" : "1px solid #e5e7eb",
                        borderRadius: 10,
                        overflow: "hidden",
                        boxShadow: approved ? "0 0 0 1px rgba(16,185,129,0.25)" : "none",
                      }}
                    >
                      {/* Panel preview */}
                      <div
                        style={{
                          height: 120,
                          background: "#f9fafb",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderBottom: "1px solid #e5e7eb",
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={panel.label || panel.name}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          <span style={{ fontSize: 32, color: "#d1d5db" }}>
                            ◧
                          </span>
                        )}
                        {/* QA / Designer Approval Badge */}
                        <div
                          style={{
                            position: "absolute",
                            top: 8,
                            right: 8,
                            padding: "3px 10px",
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 700,
                            background: approved
                              ? "rgba(16,185,129,0.15)"
                              : QA_BADGES[String(panel.qa_passed)]?.bg || QA_BADGES["null"].bg,
                            color: approved
                              ? "#059669"
                              : QA_BADGES[String(panel.qa_passed)]?.color || QA_BADGES["null"].color,
                          }}
                          title={approved && qcEntry?.approved_at ? `Approved ${new Date(qcEntry.approved_at).toLocaleString()}` : undefined}
                        >
                          {approved ? "✓ Designer Approved" : (QA_BADGES[String(panel.qa_passed)]?.label || "Pending")}
                        </div>
                      </div>
                      <div style={{ padding: "12px 16px" }}>
                        <p
                          style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: "#111",
                            marginBottom: 4,
                          }}
                        >
                          {panel.label || panel.name}
                        </p>
                        <p style={{ fontSize: 12, color: "#6b7280" }}>
                          {(() => {
                            // Panel objects store dimensions as camelCase
                            // (widthInches/heightInches — see panel creation
                            // in panelizer-qc-upscale). Older jobs used
                            // snake_case. Read both so the real per-side
                            // dimensions show instead of an empty " × ".
                            const w = panel.widthInches ?? panel.width_inches;
                            const h = panel.heightInches ?? panel.height_inches;
                            return w && h
                              ? `${w}" × ${h}" + 5" bleed`
                              : "Dimensions pending";
                          })()}
                        </p>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginTop: 8,
                          }}
                        >
                          <span
                            style={{ fontSize: 11, color: "#9ca3af" }}
                          >
                            {panel.dpi || 150} DPI
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color:
                                displayStatus === "ready"
                                  ? "#16a34a"
                                  : "#f59e0b",
                            }}
                          >
                            {displayStatus === "ready"
                              ? (approved ? "Ready ✓" : "Ready")
                              : displayStatus || "Processing"}
                          </span>
                        </div>
                        <PanelPrintReadyButton
                          panel={panel}
                          jobId={job.id}
                          orderNumber={job.order_number || job.id}
                          shopId={currentShopProfileId}
                          vehicleInfo={{
                            year: job.vehicle_year,
                            make: job.vehicle_make,
                            model: job.vehicle_model,
                          }}
                          finishType={job.finish_type || job.concept_json?.finish}
                        />
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Track-2 separated production layers (background/branding/depth) ── */}
            <div style={{ marginTop: 24 }}>
              <QCProductionFlowContainer
                jobId={job.id}
                vehicle={{ year: job.vehicle_year, make: job.vehicle_make, model: job.vehicle_model }}
                designPrompt={[job.concept_json?.design_name || job.design_file_name, job.concept_json?.finish || job.finish_type]
                  .filter(Boolean)
                  .join(" ")
                  .trim() || undefined}
              />
            </div>

            {/* ── Upsell / Enhancement Layer ────────────────── */}
            {/* Visible once pipeline has passed QA (not blocked by status=ready) */}
            {job.upsells_offered?.length > 0 && ["qa_checking", "post_processing", "extracting_elements", "packaging", "ready"].includes(job.status) && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  padding: "24px 28px",
                  marginBottom: 20,
                  border: "1px solid #e5e7eb",
                }}
              >
                <h3
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                    color: "#9ca3af",
                    textTransform: "uppercase",
                    marginBottom: 4,
                  }}
                >
                  Enhancement Opportunities
                </h3>
                <p
                  style={{
                    fontSize: 13,
                    color: "#9ca3af",
                    marginBottom: 16,
                  }}
                >
                  {job.extracted_elements?.length || 0} design elements
                  detected - expand your output
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(260px, 1fr))",
                    gap: 12,
                  }}
                >
                  {(job.upsells_offered || []).map((upsell: any) => {
                    const isPurchased = (
                      job.upsells_purchased || []
                    ).some((p: any) => p.type === upsell.type);

                    return (
                      <div
                        key={upsell.type}
                        style={{
                          border: `1px solid ${
                            isPurchased ? "#bbf7d0" : "#e5e7eb"
                          }`,
                          borderRadius: 10,
                          padding: "16px 20px",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          background: isPurchased ? "#f0fdf4" : "#fff",
                        }}
                      >
                        <div>
                          <p
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              color: "#111",
                              marginBottom: 4,
                            }}
                          >
                            {upsell.label}
                          </p>
                          <p
                            style={{
                              fontSize: 12,
                              color: "#6b7280",
                              marginBottom: 12,
                            }}
                          >
                            {upsell.description}
                          </p>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 18,
                              fontWeight: 800,
                              color: "#111",
                            }}
                          >
                            ${upsell.price}
                          </span>
                          {isPurchased ? (
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: "#16a34a",
                              }}
                            >
                              ✓ Purchased
                            </span>
                          ) : (
                            <button
                              disabled={
                                purchasingUpsell === upsell.type
                              }
                              onClick={() =>
                                handleUpsellPurchase(upsell.type)
                              }
                              style={{
                                padding: "6px 16px",
                                borderRadius: 6,
                                border: "1px solid #e5e7eb",
                                background: "#fff",
                                color: "#374151",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor:
                                  purchasingUpsell === upsell.type
                                    ? "wait"
                                    : "pointer",
                                opacity:
                                  purchasingUpsell === upsell.type
                                    ? 0.6
                                    : 1,
                              }}
                            >
                              {purchasingUpsell === upsell.type
                                ? "Adding..."
                                : "Add"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Actions Bar ────────────────────────────── */}
            {job.status === "ready" && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  padding: "20px 28px",
                  border: "1px solid #e5e7eb",
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 20,
                }}
              >
                {job.zip_signed_url && (
                  <a
                    href={job.zip_signed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "10px 24px",
                      background: "#111",
                      color: "#fff",
                      borderRadius: 8,
                      textDecoration: "none",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    ↓ Download Full Pack
                  </a>
                )}
                <button
                  onClick={() => navigate("/wrapbox")}
                  style={{
                    padding: "10px 24px",
                    background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                    color: "#fff",
                    borderRadius: 8,
                    border: "none",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  View in WrapBox™
                </button>
                <button
                  style={{
                    padding: "10px 24px",
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    color: "#374151",
                  }}
                >
                  Send to WePrintWraps
                </button>
                <button
                  style={{
                    padding: "10px 24px",
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    color: "#374151",
                  }}
                >
                  List on CreatorMarket
                </button>
                <button
                  style={{
                    padding: "10px 24px",
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    color: "#374151",
                  }}
                >
                  Request Revision
                </button>
              </div>
            )}

            {/* Failed state */}
            {job.status === "failed" && (
              <div
                style={{
                  background: "#fef2f2",
                  borderRadius: 12,
                  padding: "24px 28px",
                  marginBottom: 20,
                  border: "2px solid #fecaca",
                }}
              >
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#dc2626",
                    marginBottom: 8,
                  }}
                >
                  Pipeline Failed
                </h3>
                <p style={{ fontSize: 13, color: "#374151", marginBottom: 16 }}>
                  {job.error_message || "An error occurred during processing."}
                  {job.error_stage && (
                    <span style={{ color: "#9ca3af" }}>
                      {" "}
                      (Stage: {job.error_stage})
                    </span>
                  )}
                </p>
                <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>
                  Our team has been notified and will retry your production files shortly.
                </p>
              </div>
            )}
            {/* ── Event Timeline ──────────────────────────── */}
            {jobEvents.length > 0 && (
              <div style={{
                background: "#fff", borderRadius: 12, padding: "20px 24px", marginTop: 20,
                border: "1px solid #e5e7eb",
              }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 16 }}>
                  Pipeline Timeline
                </h3>
                <div style={{ position: "relative", paddingLeft: 24 }}>
                  {/* Vertical line */}
                  <div style={{
                    position: "absolute", left: 7, top: 4, bottom: 4,
                    width: 2, background: "#e5e7eb",
                  }} />

                  {jobEvents.map((ev: any, i: number) => {
                    const isError = ev.event_type === "error" || ev.event_type === "qa_failed";
                    const isComplete = ev.event_type === "stage_completed" || ev.event_type === "qa_passed" || ev.event_type === "zip_ready";
                    const isInput = ev.event_type === "input_requested" || ev.event_type === "input_received";
                    const dotColor = isError ? "#ef4444" : isComplete ? "#16a34a" : isInput ? "#f59e0b" : "#6366f1";

                    return (
                      <div key={ev.id || i} style={{ position: "relative", marginBottom: 16, paddingBottom: i === jobEvents.length - 1 ? 0 : 8 }}>
                        {/* Dot */}
                        <div style={{
                          position: "absolute", left: -20, top: 2,
                          width: 12, height: 12, borderRadius: "50%",
                          background: dotColor, border: "2px solid #fff",
                          boxShadow: `0 0 0 2px ${dotColor}33`,
                        }} />

                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{
                              fontSize: 13, fontWeight: 600,
                              color: isError ? "#dc2626" : "#111",
                            }}>
                              {ev.event_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                            </span>
                            {ev.stage && (
                              <span style={{
                                fontSize: 10, padding: "1px 8px", background: "#f3f4f6",
                                borderRadius: 4, color: "#6b7280", fontWeight: 500,
                              }}>
                                {ev.stage}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                            {new Date(ev.created_at).toLocaleString()}
                          </div>
                          {ev.data && Object.keys(ev.data).length > 0 && (
                            <div style={{
                              fontSize: 11, color: "#6b7280", marginTop: 4, lineHeight: 1.5,
                              background: "#f9fafb", padding: "6px 10px", borderRadius: 6,
                            }}>
                              {ev.data.label && <span>{ev.data.label}</span>}
                              {ev.data.error && <span style={{ color: "#dc2626" }}> {ev.data.error}</span>}
                              {ev.data.panels != null && <span> Panels: {ev.data.panels}</span>}
                              {ev.data.elements != null && <span> Elements: {ev.data.elements}</span>}
                              {ev.data.questions != null && <span> Questions: {ev.data.questions}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* My Jobs List (no specific job selected) */}
        {activeTab === "projects" && !job && !loading && !error && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>Production Jobs</h2>
                <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 2 }}>
                  UniversalPanelizer™ - Track and manage your print production pipeline
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                <button
                  onClick={() => { setShowNewJobModal(true); fetchMyGenerations(); }}
                  style={{
                    padding: "10px 24px", background: "#6366f1", color: "#fff", borderRadius: 8,
                    border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  + New Production Job
                </button>
              </div>
            </div>

            {/* Jobs Needing Attention */}
            {(() => {
              const attention = myJobs.filter((j: any) => j.status === "awaiting_input" || j.status === "failed");
              if (attention.length === 0) return null;
              if (hideAttentionBanner) return (
                <button
                  onClick={() => setHideAttentionBanner(false)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "6px 14px", background: "#fef2f2", borderRadius: 8,
                    border: "1px solid #fecaca", cursor: "pointer", fontSize: 11, fontWeight: 600,
                    color: "#dc2626", marginBottom: 16,
                  }}
                >
                  ⚠ {attention.length} job{attention.length > 1 ? "s" : ""} need attention — Show
                </button>
              );
              return (
                <div style={{
                  background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10,
                  padding: "14px 20px", marginBottom: 16,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>
                      {attention.length} job{attention.length > 1 ? "s" : ""} need{attention.length === 1 ? "s" : ""} your attention
                    </div>
                    <button
                      onClick={() => setHideAttentionBanner(true)}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: 11, fontWeight: 600, color: "#dc2626", opacity: 0.6,
                        padding: "2px 8px", borderRadius: 4,
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.opacity = "1")}
                      onMouseOut={(e) => (e.currentTarget.style.opacity = "0.6")}
                    >
                      Hide
                    </button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {attention.map((j: any) => (
                      <button
                        key={j.id}
                        onClick={() => navigate(`/productionflow/${j.id}`)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "6px 14px", background: "#fff", borderRadius: 6,
                          border: "1px solid #fecaca", cursor: "pointer", fontSize: 12, fontWeight: 600,
                          color: j.status === "failed" ? "#dc2626" : "#f59e0b",
                        }}
                      >
                        <span>{j.status === "awaiting_input" ? "⚠" : "✕"}</span>
                        {j.order_number} - {j.status === "awaiting_input" ? "QA Input Needed" : "Failed"}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* QC + Tracking Credibility Bar */}
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16,
              padding: "12px 16px", background: "#f0fdf4", borderRadius: 8,
              border: "1px solid #bbf7d0",
            }}>
              {[
                { label: "Automated QC", detail: "AI vision inspects every panel" },
                { label: "4-Point Check", detail: "Trim safety, completeness, color, quality" },
                { label: "Cross-Panel", detail: "Driver/passenger continuity validation" },
                { label: "Customer Notified", detail: "Email + in-app alert when input needed" },
                { label: "RIP Output", detail: "VersaWorks, Onyx, Caldera, Flexi, SAi, EFI Fiery" },
              ].map((item) => (
                <span key={item.label} title={item.detail} style={{
                  fontSize: 11, fontWeight: 600, padding: "3px 10px",
                  background: "#dcfce7", borderRadius: 4, color: "#15803d",
                  cursor: "help",
                }}>
                  {item.label}
                </span>
              ))}
            </div>

            {/* New Job Modal */}
            {showNewJobModal && (
              <div style={{
                background: "#fff", borderRadius: 12, padding: "24px 28px", marginBottom: 20,
                border: "2px solid #6366f1",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>Select a Design to Produce</h3>
                  <button onClick={() => setShowNewJobModal(false)} style={{
                    background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#9ca3af",
                  }}>×</button>
                </div>
                {myGenerations.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#9ca3af", padding: "20px 0", textAlign: "center" }}>
                    No designs found. Create a design first in DesignPro or GraphicsPro.
                  </p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                    {myGenerations.map((gen: any) => (
                      <div key={gen.id} style={{
                        border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", cursor: "pointer",
                        transition: "border-color 0.2s",
                      }}
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e5e7eb")}
                        onClick={() => !creatingJob && handleCreateJob(gen)}
                      >
                        <div style={{ height: 120, background: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                          {gen.hero_render_url ? (
                            <img src={gen.hero_render_url} alt="Render" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <span style={{ fontSize: 32, color: "#d1d5db" }}>◧</span>
                          )}
                        </div>
                        <div style={{ padding: "10px 14px" }}>
                          <p style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>
                            {[gen.vehicle_year, gen.vehicle_make, gen.vehicle_model].filter(Boolean).join(" ") || "Design"}
                          </p>
                          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                            {new Date(gen.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {creatingJob && (
                  <div style={{ textAlign: "center", padding: "16px 0" }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #e5e7eb", borderTopColor: "#6366f1", margin: "0 auto 8px", animation: "pf-spin 1s linear infinite" }} />
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Creating production job & starting pipeline...</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Production Jobs Queue ── */}
            {myJobsLoading ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #e5e7eb", borderTopColor: "#0090dd", margin: "0 auto 8px", animation: "pf-spin 1s linear infinite" }} />
                <p style={{ fontSize: 13, color: "#6b7280" }}>Loading jobs...</p>
              </div>
            ) : myJobs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#6b7280" }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c4c4c4" strokeWidth="1.5" style={{ margin: "0 auto 12px" }}>
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
                <p style={{ fontSize: 16, fontWeight: 600, color: "#4b5563" }}>No production jobs yet</p>
                <p style={{ fontSize: 13, marginTop: 4 }}>Click "New Production Job" to start from an approved design</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Section: Active Jobs */}
                {myJobs.filter((j: any) => j.status !== "ready" && j.status !== "failed").length > 0 && (
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#0080cc", textTransform: "uppercase", marginBottom: -4 }}>Active Jobs</p>
                )}
                {myJobs.filter((j: any) => j.status !== "ready" && j.status !== "failed").map((j: any) => {
                  const statusColor = STATUS_COLORS[j.status] || "#6b7280";
                  const totalStages = 6;
                  const stage = j.current_stage || 0;
                  const pct = Math.min(Math.round((stage / totalStages) * 100), 100);
                  const stageLabels: Record<number, string> = {
                    0: "Queued - waiting to start",
                    1: "Panelizing - generating print panels",
                    2: "Optimizing - upscaling for production",
                    3: "QA Checking - automated quality control",
                    4: "Packaging - building production files",
                    5: "Detecting elements - logos & text",
                    6: "Complete - ready for delivery",
                  };
                  const detail = j.stage_detail || stageLabels[stage] || `Stage ${stage}`;
                  const isRecreatePro = j.concept_json?.source_type === "recreatepro";
                  const isDesignIQ = j._source === "designiq";
                  const isColorPro = j._source === "colorpro";
                  const isLogoPack = j.job_type === "logo_pack" || j.concept_json?.type === "logo_pack";
                  const refImageUrls: string[] = j.concept_json?.reference_image_urls || [];
                  const borderColor = isRecreatePro ? "rgba(124,58,237,0.25)" : isDesignIQ ? "rgba(99,102,241,0.25)" : isColorPro ? "rgba(0,199,255,0.25)" : "#e5e7eb";
                  const glowColor = isRecreatePro ? "rgba(124,58,237,0.15)" : isDesignIQ ? "rgba(99,102,241,0.15)" : isColorPro ? "rgba(0,199,255,0.15)" : "rgba(0,100,200,0.1)";
                  return (
                    <div
                      key={j.id}
                      onClick={() => navigate(`/productionflow/${j.id}`)}
                      style={{
                        background: "#fff", borderRadius: 12, padding: "16px 20px",
                        border: `1px solid ${borderColor}`,
                        cursor: "pointer",
                        transition: "border-color 0.2s, box-shadow 0.2s",
                        display: "flex", alignItems: "center", gap: 16,
                        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0080cc"; e.currentTarget.style.boxShadow = `0 0 16px ${glowColor}, 0 2px 8px rgba(0,0,0,0.08)`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = borderColor; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
                    >
                      {/* Thumbnail - larger */}
                      <div style={{
                        width: 120, height: 80, borderRadius: 8, overflow: "hidden",
                        border: "1px solid #e5e7eb", flexShrink: 0, background: "#f9fafb",
                        position: "relative",
                      }}>
                        {j.approved_render_url ? (
                          <img src={j.approved_render_url} alt="Design" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c4c4c4" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
                          </div>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>{j.order_number || "Processing..."}</span>
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "3px 10px", borderRadius: 10,
                            background: statusColor + "15", color: statusColor,
                            textTransform: "uppercase", letterSpacing: 1,
                          }}>
                            {j.status?.replace(/_/g, " ") || "queued"}
                          </span>
                          {isRecreatePro && (
                            <span style={{
                              fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                              background: "rgba(124,58,237,0.15)", color: "#a78bfa",
                              textTransform: "uppercase", letterSpacing: 0.8,
                            }}>
                              RecreatePro
                            </span>
                          )}
                          {isDesignIQ && (
                            <span style={{
                              fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                              background: "rgba(99,102,241,0.15)", color: "#818cf8",
                              textTransform: "uppercase", letterSpacing: 0.8,
                            }}>
                              DesignPro
                            </span>
                          )}
                          {isColorPro && (
                            <span style={{
                              fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                              background: "rgba(0,199,255,0.15)", color: "#00c7ff",
                              textTransform: "uppercase", letterSpacing: 0.8,
                            }}>
                              ColorPro
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: 13, color: "#4b5563" }}>
                          {[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(" ")}
                          {j.concept_json?.design_name ? ` - ${j.concept_json.design_name}` : ""}
                          {j.concept_json?.color_name ? ` - ${j.concept_json.color_name}` : ""}
                        </p>
                        {/* Reference thumbnails for RecreatePro jobs */}
                        {isRecreatePro && refImageUrls.length > 0 && (
                          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                            {refImageUrls.slice(0, 4).map((url: string, idx: number) => (
                              <div key={idx} style={{
                                width: 36, height: 26, borderRadius: 4, overflow: "hidden",
                                border: idx === 0 ? "1px solid #a78bfa" : "1px solid #e5e7eb",
                              }}>
                                <img src={url} alt={`Ref ${idx + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              </div>
                            ))}
                            {refImageUrls.length > 4 && (
                              <span style={{ fontSize: 9, color: "#9ca3af", alignSelf: "center" }}>+{refImageUrls.length - 4}</span>
                            )}
                          </div>
                        )}
                        {/* Neon glow progress bar */}
                        <div style={{ marginTop: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <span style={{ fontSize: 11, color: "#374151" }}>{detail}</span>
                            <span style={{ fontSize: 10, fontWeight: 600, color: "#0090dd" }}>{pct}%</span>
                          </div>
                          <div style={{ height: 5, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{
                              height: "100%", borderRadius: 3, transition: "width 1s ease",
                              width: `${Math.max(pct, 3)}%`,
                              background: isRecreatePro
                                ? "linear-gradient(90deg, #6d28d9, #7c3aed)"
                                : "linear-gradient(90deg, #0066cc, #0090dd)",
                              boxShadow: isRecreatePro
                                ? "0 0 8px rgba(124,58,237,0.4)"
                                : "0 0 8px rgba(0,100,200,0.4)",
                            }} />
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: 16, color: "#9ca3af" }}>→</span>
                    </div>
                  );
                })}

                {/* Section: Output History */}
                {myJobs.filter((j: any) => j.status === "ready" || j.status === "failed").length > 0 && (
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#4b5563", textTransform: "uppercase", marginTop: 8, marginBottom: -4 }}>Output History</p>
                )}
                {myJobs.filter((j: any) => j.status === "ready" || j.status === "failed").map((j: any) => {
                  const isReady = j.status === "ready";
                  const isFailed = j.status === "failed";
                  const isRecreateProHistory = j.concept_json?.source_type === "recreatepro";
                  const isDesignIQHistory = j._source === "designiq";
                  const isColorProHistory = j._source === "colorpro";
                  const isLogoPackHistory = j.job_type === "logo_pack" || j.concept_json?.type === "logo_pack";
                  return (
                    <div
                      key={j.id}
                      onClick={() => navigate(`/productionflow/${j.id}`)}
                      style={{
                        background: isReady ? "#f0fdf4" : "#fef2f2", borderRadius: 12, padding: "14px 18px",
                        border: `1px solid ${isReady ? "#bbf7d0" : "#fecaca"}`, cursor: "pointer",
                        transition: "border-color 0.2s, box-shadow 0.2s", display: "flex", alignItems: "center", gap: 16,
                        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; }}
                    >
                      <div style={{
                        width: 100, height: 66, borderRadius: 8, overflow: "hidden",
                        border: `1px solid ${isReady ? "#bbf7d0" : "#fecaca"}`, flexShrink: 0, background: "#f9fafb",
                      }}>
                        {j.approved_render_url ? (
                          <img src={j.approved_render_url} alt="Design" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: 16, color: "#c4c4c4" }}>◧</span>
                          </div>
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{j.order_number}</span>
                          {isReady && <span style={{ fontSize: 12, color: "#16a34a" }}>✓ Ready</span>}
                          {isFailed && <span style={{ fontSize: 12, color: "#dc2626" }}>✗ Failed</span>}
                          {isRecreateProHistory && (
                            <span style={{
                              fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 8,
                              background: "rgba(124,58,237,0.15)", color: "#a78bfa",
                              textTransform: "uppercase", letterSpacing: 0.8,
                            }}>RecreatePro</span>
                          )}
                          {isDesignIQHistory && (
                            <span style={{
                              fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 8,
                              background: "rgba(99,102,241,0.15)", color: "#818cf8",
                              textTransform: "uppercase", letterSpacing: 0.8,
                            }}>DesignPro</span>
                          )}
                          {isColorProHistory && (
                            <span style={{
                              fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 8,
                              background: "rgba(0,199,255,0.15)", color: "#00c7ff",
                              textTransform: "uppercase", letterSpacing: 0.8,
                            }}>ColorPro</span>
                          )}
                        </div>
                        <p style={{ fontSize: 12, color: "#4b5563" }}>
                          {[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(" ")}
                          {j.concept_json?.design_name ? ` - ${j.concept_json.design_name}` : ""}
                          {j.concept_json?.color_name ? ` - ${j.concept_json.color_name}` : ""}
                          {" - "}{new Date(j.created_at).toLocaleDateString()}
                        </p>
                        {isFailed && j.error_message && (
                          <p style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>{j.error_message}</p>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {isReady && j.zip_signed_url && (
                          <a
                            href={j.zip_signed_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              padding: "8px 16px", background: "#16a34a", color: "#fff", borderRadius: 6,
                              textDecoration: "none", fontSize: 12, fontWeight: 600,
                            }}
                          >
                            ↓ Download
                          </a>
                        )}
                        <span style={{ fontSize: 14, color: "#9ca3af" }}>→</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/* QUICK PREP MODE */}
        {/* ═══════════════════════════════════════════════════ */}
        {activeTab === "quickprep" && !loading && (
          <div>
            {/* PrepMyFile™ Header + Sub-nav */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111", marginBottom: 4 }}>
                    PrepMyFile™
                  </h2>
                  <p style={{ fontSize: 14, color: "#6b7280" }}>
                    Upload any file - yours or from DesignProAI™. Get production-ready output in seconds.
                  </p>
                </div>
                <div style={{
                  display: "flex", gap: 0, background: "#f3f4f6", borderRadius: 8, padding: 3,
                }}>
                  {([
                    { key: "tools" as const, label: "Production Tools" },
                    { key: "history" as const, label: "Output History" },
                  ]).map((v) => (
                    <button key={v.key} onClick={() => setQuickPrepView(v.key)} style={{
                      padding: "7px 16px", borderRadius: 6, border: "none", cursor: "pointer",
                      fontSize: 12, fontWeight: 600, transition: "all 0.2s",
                      background: quickPrepView === v.key ? "#fff" : "transparent",
                      color: quickPrepView === v.key ? "#111" : "#6b7280",
                      boxShadow: quickPrepView === v.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    }}>{v.label}{v.key === "history" && outputHistory.length > 0 ? ` (${outputHistory.length})` : ""}</button>
                  ))}
                </div>
              </div>

              {/* Output Compatibility Bar - persistent credibility */}
              <div style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
                background: "#fafafa", borderRadius: 8, border: "1px solid #f0f0f0",
                flexWrap: "wrap",
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1.5 }}>
                  Output Compatible With
                </span>
                {["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery"].map((rip) => (
                  <span key={rip} style={{
                    fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 4,
                    background: "#f0f0ff", color: "#6366f1", border: "1px solid #e0e0ff",
                  }}>{rip}</span>
                ))}
                <span style={{ fontSize: 10, color: "#c4c4c4", marginLeft: "auto" }}>
                  All outputs are print-ready production files
                </span>
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════ */}
            {/* OUTPUT HISTORY VIEW */}
            {/* ═══════════════════════════════════════════════════ */}
            {quickPrepView === "history" && (
              <div>
                {historyLoading ? (
                  <div style={{ textAlign: "center", padding: "40px 0" }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #e5e7eb", borderTopColor: "#6366f1", margin: "0 auto 8px", animation: "pf-spin 1s linear infinite" }} />
                    <p style={{ fontSize: 13, color: "#9ca3af" }}>Loading output history...</p>
                  </div>
                ) : outputHistory.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af" }}>
                    <p style={{ fontSize: 48, marginBottom: 12 }}>◎</p>
                    <p style={{ fontSize: 16, fontWeight: 600, color: "#6b7280" }}>No production outputs yet</p>
                    <p style={{ fontSize: 13, marginTop: 4 }}>Run a tool or prep package to see your output history here</p>
                    <button onClick={() => setQuickPrepView("tools")} style={{
                      marginTop: 16, padding: "10px 24px", background: "#6366f1", color: "#fff",
                      borderRadius: 8, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    }}>Go to Production Tools</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {outputHistory.map((action: any) => {
                      const isCompleted = action.status === "completed";
                      const isFailed = action.status === "failed";
                      const isStandalone = action.action_type === "standalone_service";
                      const statusColor = isCompleted ? "#16a34a" : isFailed ? "#dc2626" : "#f59e0b";
                      return (
                        <div key={action.id} style={{
                          background: "#fff", borderRadius: 12, padding: "20px 24px",
                          border: `1px solid ${isCompleted ? "#e5e7eb" : isFailed ? "#fecaca" : "#fde68a"}`,
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                            <div style={{ flex: 1, minWidth: 200 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>
                                  {action.package_name}
                                </span>
                                <span style={{
                                  fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
                                  background: statusColor + "18", color: statusColor, textTransform: "uppercase", letterSpacing: 0.5,
                                }}>{action.status}</span>
                                <span style={{
                                  fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                                  background: isStandalone ? "#fff7ed" : "#f0f0ff",
                                  color: isStandalone ? "#c2410c" : "#6366f1",
                                }}>
                                  {isStandalone ? "Standalone" : action.action_type === "quick_prep" ? "Package" : "Quick Prep"}
                                </span>
                              </div>
                              <p style={{ fontSize: 12, color: "#6b7280" }}>
                                {action.file_name || "file"}
                                {action.tokens_used ? ` - ${action.tokens_used} tokens` : ""}
                                {action.steps_total > 1 ? ` - ${action.steps_completed}/${action.steps_total} steps` : ""}
                              </p>
                              <p style={{ fontSize: 11, color: "#c4c4c4", marginTop: 2 }}>
                                {new Date(action.created_at).toLocaleDateString()} {new Date(action.created_at).toLocaleTimeString()}
                              </p>
                              {/* Output format + RIP badges */}
                              {(action.output_format || action.rip_compatible?.length > 0) && (
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                                  {action.output_format && (
                                    <span style={{
                                      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                                      background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0",
                                    }}>{action.output_format}</span>
                                  )}
                                  {action.rip_compatible?.slice(0, 3).map((rip: string) => (
                                    <span key={rip} style={{
                                      fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 3,
                                      background: "#f0f0ff", color: "#6366f1",
                                    }}>{rip}</span>
                                  ))}
                                  {action.rip_compatible?.length > 3 && (
                                    <span style={{ fontSize: 9, color: "#9ca3af" }}>+{action.rip_compatible.length - 3} more</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {isCompleted && action.file_out && (
                                <a
                                  href={action.file_out}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    padding: "8px 16px", background: "#111", color: "#fff", borderRadius: 6,
                                    textDecoration: "none", fontSize: 12, fontWeight: 600,
                                  }}
                                >
                                  ↓ Download
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════════ */}
            {/* PRODUCTION TOOLS VIEW */}
            {/* ═══════════════════════════════════════════════════ */}
            {quickPrepView === "tools" && (<>

            {/* ═══ RecreatePro™ - Anchor Tool (Inline) ═══ */}
            <div style={{ marginBottom: 28 }}>
              {/* Clickable Header Bar - always visible */}
              <div
                onClick={() => setRecreateExpanded(!recreateExpanded)}
                style={{
                  background: "linear-gradient(135deg, #3b82f6, #ec4899)",
                  borderRadius: recreateExpanded ? "12px 12px 0 0" : 12,
                  padding: "20px 24px",
                  border: "1px solid rgba(59,130,246,0.4)",
                  borderBottom: recreateExpanded ? "none" : undefined,
                  display: "flex", alignItems: "center", gap: 20,
                  cursor: "pointer", transition: "all 0.2s",
                  position: "sticky", top: 0, zIndex: 20,
                  boxShadow: "0 4px 16px rgba(59,130,246,0.25)",
                }}
              >
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: "rgba(255,255,255,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, fontSize: 22,
                }}>
                  📸
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: "#ffffff", margin: 0 }}>RecreatePro™</p>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                      background: "rgba(255,255,255,0.25)", color: "#ffffff", textTransform: "uppercase", letterSpacing: 1,
                    }}>Anchor Tool</span>
                  </div>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", margin: 0 }}>
                    Drop in any wrap photo - AI recreates it on any vehicle - get production-ready panels
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 800, color: "#ffffff",
                  }}>{isPrivileged ? "Free" : "10 tokens"}</span>
                  <span style={{
                    fontSize: 20, color: "rgba(255,255,255,0.9)", transition: "transform 0.2s",
                    transform: recreateExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  }}>→</span>
                </div>
              </div>

              {/* Expanded Inline Form */}
              {recreateExpanded && (
                <div style={{
                  background: "#fff", border: "1px solid rgba(139,92,246,0.2)",
                  borderTop: "none", borderRadius: "0 0 12px 12px",
                  padding: "24px 28px",
                }}>
                  {/* Rendering progress state */}
                  {recreateRendering && (
                    <div style={{ textAlign: "center", padding: "32px 0" }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: "50%", border: "3px solid #e5e7eb",
                        borderTopColor: "#7c3aed", margin: "0 auto 16px", animation: "pf-spin 1s linear infinite",
                      }} />
                      <p style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>
                        Recreating on {recreateYear} {recreateMake} {recreateModel}...
                      </p>
                      <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>{recreateStage}</p>
                      <div style={{ maxWidth: 400, margin: "16px auto 0" }}>
                        <div style={{ height: 6, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{
                            height: "100%", background: "linear-gradient(90deg, #7c3aed, #06b6d4)",
                            borderRadius: 4, transition: "width 0.4s", width: `${recreateProgress}%`,
                          }} />
                        </div>
                        <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "right", marginTop: 4 }}>{recreateProgress}%</p>
                      </div>
                    </div>
                  )}

                  {/* Render result */}
                  {recreateRenderUrl && !recreateRendering && (
                    <div>
                      <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #0a1628", marginBottom: 16, background: "#000", position: "relative" }}>
                        <img src={recreateRenderUrl} alt={`RecreatePro - ${recreateYear} ${recreateMake} ${recreateModel}`} style={{ width: "100%", display: "block", imageRendering: "auto" }} />
                        {recreateApplyingEdit && (
                          <div style={{
                            position: "absolute", top: 12, left: 12, display: "flex", alignItems: "center", gap: 8,
                            padding: "8px 14px", borderRadius: 999, background: "rgba(10,22,40,0.82)",
                            backdropFilter: "blur(4px)", color: "#fff", fontSize: 12, fontWeight: 700,
                          }}>
                            <span style={{
                              width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.35)",
                              borderTopColor: "#06b6d4", display: "inline-block", animation: "pf-spin 1s linear infinite",
                            }} />
                            Applying your edit…
                          </div>
                        )}
                      </div>
                      {recreatePreviews.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          {/* Side-by-side comparison - large view */}
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: recreatePreviews.length > 1 ? 12 : 0 }}>
                            <div>
                              <p style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Your Reference</p>
                              <div
                                onClick={() => setRecreateLightboxUrl(recreatePreviews[0])}
                                style={{ borderRadius: 10, overflow: "hidden", border: "2px solid #7c3aed", cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s" }}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.02)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(124,58,237,0.3)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
                              >
                                <img src={recreatePreviews[0]} alt="Primary Reference" style={{ width: "100%", display: "block" }} />
                              </div>
                            </div>
                            <div>
                              <p style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Recreated Design</p>
                              <div
                                onClick={() => setRecreateLightboxUrl(recreateRenderUrl!)}
                                style={{ borderRadius: 10, overflow: "hidden", border: "2px solid #06b6d4", cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s" }}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.02)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(6,182,212,0.3)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
                              >
                                <img src={recreateRenderUrl} alt="AI Render" style={{ width: "100%", display: "block" }} />
                              </div>
                            </div>
                          </div>
                          {recreatePreviews.length > 1 && (
                            <div>
                              <p style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Additional References ({recreatePreviews.length - 1})</p>
                              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(recreatePreviews.length - 1, 5)}, 1fr)`, gap: 4 }}>
                                {recreatePreviews.slice(1).map((preview, idx) => (
                                  <div key={idx} style={{ borderRadius: 4, overflow: "hidden", border: "1px solid #e5e7eb" }}>
                                    <img src={preview} alt={`Ref ${idx + 2}`} style={{ width: "100%", height: 60, objectFit: "cover", display: "block" }} />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {/* Generate All Sides button */}
                      <button
                        onClick={handleRecreateAllSides}
                        disabled={recreateGeneratingViews}
                        style={{
                          width: "100%",
                          padding: "14px 24px",
                          borderRadius: 10,
                          border: "2px solid #00c8ff",
                          background: recreateGeneratingViews
                            ? "linear-gradient(90deg, #0e1a2e, #0a2540)"
                            : recreateAllViews.length > 0
                              ? "linear-gradient(90deg, rgba(22, 163, 74, 0.08), rgba(22, 163, 74, 0.04))"
                              : "linear-gradient(90deg, rgba(0, 200, 255, 0.08), rgba(0, 100, 200, 0.08))",
                          color: recreateGeneratingViews ? "#00c8ff" : recreateAllViews.length > 0 ? "#16a34a" : "#0284c7",
                          borderColor: recreateAllViews.length > 0 ? "#16a34a" : "#00c8ff",
                          cursor: recreateGeneratingViews ? "not-allowed" : "pointer",
                          fontSize: 14, fontWeight: 700, marginBottom: 12,
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        }}
                      >
                        {recreateGeneratingViews ? (
                          <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                            Generating All Views...
                          </>
                        ) : recreateAllViews.length > 0 ? (
                          `All ${recreateAllViews.length} Views Generated`
                        ) : (
                          "Generate All Sides"
                        )}
                      </button>

                      {/* All Views - Horizontal scroll with arrows */}
                      {recreateAllViews.length > 0 && (
                        <div style={{ position: "relative", marginBottom: 12 }}>
                          {/* Left scroll arrow */}
                          <div
                            onClick={() => {
                              const el = document.getElementById("recreate-views-scroll");
                              if (el) el.scrollBy({ left: -200, behavior: "smooth" });
                            }}
                            style={{
                              position: "absolute", left: -4, top: "50%", transform: "translateY(-50%)", zIndex: 2,
                              width: 32, height: 32, borderRadius: "50%", background: "rgba(0,0,0,0.7)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              cursor: "pointer", color: "#fff", fontSize: 18, fontWeight: 700,
                              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                            }}
                          >
                            ‹
                          </div>
                          {/* Right scroll arrow */}
                          <div
                            onClick={() => {
                              const el = document.getElementById("recreate-views-scroll");
                              if (el) el.scrollBy({ left: 200, behavior: "smooth" });
                            }}
                            style={{
                              position: "absolute", right: -4, top: "50%", transform: "translateY(-50%)", zIndex: 2,
                              width: 32, height: 32, borderRadius: "50%", background: "rgba(0,0,0,0.7)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              cursor: "pointer", color: "#fff", fontSize: 18, fontWeight: 700,
                              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                            }}
                          >
                            ›
                          </div>
                          <div
                            id="recreate-views-scroll"
                            style={{
                              display: "flex", gap: 10, overflowX: "auto", scrollSnapType: "x mandatory",
                              padding: "4px 0", scrollbarWidth: "none",
                            }}
                          >
                            {recreateAllViews.map((view) => (
                              <div
                                key={view.type}
                                onClick={() => setRecreateLightboxUrl(view.url)}
                                style={{
                                  flexShrink: 0, width: 180, borderRadius: 8, overflow: "hidden",
                                  border: "1px solid #e5e7eb", position: "relative", background: "#000",
                                  cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s",
                                  scrollSnapAlign: "start",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.3)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
                              >
                                <img src={view.url} alt={view.type} style={{ width: "100%", display: "block", objectFit: "contain" }} />
                                <div style={{
                                  position: "absolute", bottom: 4, left: 4,
                                  background: "rgba(0,0,0,0.8)", color: "#fff",
                                  padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 600,
                                }}>
                                  {view.type === "side" ? "Driver" : view.type === "passenger-side" ? "Passenger" : view.type === "hood_detail" ? "Hood" : view.type === "front" ? "Front" : view.type === "rear" ? "Rear" : view.type === "roof" ? "Roof" : "Close-Up"}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 2D Production Proof — generated as the 7th call alongside the angles */}
                      {(recreateProofGenerating || recreateProofUrl) && (
                        <div style={{ marginBottom: 12 }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                            2D Production Proof
                          </p>
                          {recreateProofUrl ? (
                            <div
                              onClick={() => setRecreateLightboxUrl(recreateProofUrl)}
                              style={{ borderRadius: 10, overflow: "hidden", border: "2px solid #16a34a", cursor: "pointer", background: "#fff" }}
                            >
                              <img src={recreateProofUrl} alt="2D Production Proof" style={{ width: "100%", display: "block" }} />
                            </div>
                          ) : (
                            <div style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "14px 16px", borderRadius: 10, border: "1px dashed #cbd5e1",
                              background: "#f8fafc", color: "#475569", fontSize: 13, fontWeight: 600,
                            }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                              </svg>
                              Generating 2D production proof...
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button onClick={() => setShowRecreateProductionDialog(true)} style={{
                          padding: "12px 28px", borderRadius: 8, border: "none",
                          background: recreateAllViews.length > 0
                            ? "linear-gradient(135deg, #3b82f6, #ec4899)"
                            : "#3b82f6",
                          color: "#fff", cursor: "pointer",
                          fontSize: 14, fontWeight: 700, flex: "1 1 auto",
                          boxShadow: recreateAllViews.length > 0
                            ? "0 0 16px rgba(236, 72, 153, 0.45), 0 0 32px rgba(59, 130, 246, 0.25)"
                            : "none",
                          animation: recreateAllViews.length > 0 ? "glowPulse 2s ease-in-out infinite" : "none",
                        }}>
                          Order Production Pack
                        </button>
                        <button onClick={handleRecreateDownloadAll} disabled={recreateDownloadingAll} style={{
                          padding: "12px 20px", borderRadius: 8, border: "2px solid #16a34a",
                          background: "#fff", color: "#16a34a",
                          cursor: recreateDownloadingAll ? "not-allowed" : "pointer",
                          fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6,
                          opacity: recreateDownloadingAll ? 0.6 : 1,
                        }}>
                          {recreateDownloadingAll ? "Downloading..." : "↓ Download All"}
                        </button>
                        <button onClick={async () => {
                          // Re-sync the FULL current view set into the row before
                          // handing off. The angle renders complete asynchronously
                          // after the initial row write, so the row could still
                          // hold just the side — which made RevisionStudio open
                          // "6 of 7 views missing" even though all 7 are rendered.
                          // Persisting recreateAllViews here guarantees Studio sees
                          // every angle.
                          try {
                            if (recreateVisualizationId && recreateAllViews.length > 0) {
                              const urls: Record<string, string> = {};
                              recreateAllViews.forEach((v) => { if (v.url) urls[v.type] = v.url; });
                              if (Object.keys(urls).length > 0) {
                                await supabase
                                  .from("color_visualizations")
                                  .update({ render_urls: urls, updated_at: new Date().toISOString() } as any)
                                  .eq("id", recreateVisualizationId);
                              }
                            }
                          } catch (e) {
                            console.warn("[ProductionFlow/Recreate] revise-in-studio view sync failed:", e);
                          }
                          navigate(recreateVisualizationId ? `/revision-studio?id=${recreateVisualizationId}` : "/revision-studio");
                        }} style={{
                          padding: "12px 20px", borderRadius: 8, border: "2px solid #3b82f6",
                          background: "#fff", color: "#3b82f6", cursor: "pointer", fontSize: 13, fontWeight: 700,
                        }}>
                          Revise in Studio
                        </button>
                        <button onClick={resetRecreateFlow} style={{
                          padding: "12px 20px", borderRadius: 8, border: "1px solid #e5e7eb",
                          background: "#fff", color: "#6b7280", cursor: "pointer", fontSize: 13, fontWeight: 600,
                        }}>
                          Start Over
                        </button>
                      </div>

                      {/* Inline quick edit — iterate WITHOUT leaving RecreatePro or
                          hitting Start Over. The upload form (and its Edits box) is
                          hidden once a render exists, so this is the only in-tool way
                          to type a change and re-run. Reuses the already-uploaded
                          references (recreateFiles still held in state); "Apply Edit"
                          re-runs the faithful clone + the typed change. */}
                      {recreateFiles.length > 0 && (
                        <div style={{ marginTop: 16, padding: 14, borderRadius: 10, border: "1px solid #f5d0e6", background: "#fdf2f8" }}>
                          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#db2777", textTransform: "uppercase", marginBottom: 8 }}>
                            Make a quick edit
                          </p>
                          <textarea
                            ref={recreateNotesRef}
                            value={recreateNotes}
                            onChange={(e) => setRecreateNotes(e.target.value)}
                            placeholder={'What would you like to change? e.g. "move the SD logo up so it\'s not cut off by the wheel well", "make the stripe red"'}
                            rows={2}
                            style={{
                              width: "100%", padding: "10px 12px", borderRadius: 8,
                              border: "1px solid #e5e7eb", fontSize: 12, resize: "vertical",
                              outline: "none", fontFamily: "inherit", lineHeight: 1.5, marginBottom: 10,
                            }}
                          />
                          <button
                            onClick={handleQuickEdit}
                            disabled={recreateRendering || recreateApplyingEdit || !recreateNotes.trim()}
                            style={{
                              width: "100%", padding: "12px 16px", borderRadius: 10, border: "none",
                              background: recreateApplyingEdit ? "#6b7280" : (recreateNotes.trim() ? "linear-gradient(135deg, #3b82f6, #ec4899)" : "#e5e7eb"),
                              color: (recreateApplyingEdit || recreateNotes.trim()) ? "#fff" : "#9ca3af",
                              cursor: recreateApplyingEdit ? "wait" : (recreateNotes.trim() ? "pointer" : "not-allowed"),
                              fontSize: 14, fontWeight: 700,
                              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                            }}
                          >
                            {recreateApplyingEdit ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                <span style={{
                                  width: 15, height: 15, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.4)",
                                  borderTopColor: "#fff", display: "inline-block", animation: "pf-spin 1s linear infinite",
                                }} />
                                Applying your edit…
                              </span>
                            ) : (
                              <>
                                Apply Edit
                                <span style={{ display: "block", fontSize: 10, fontWeight: 500, marginTop: 2, opacity: 0.85 }}>
                                  Targeted change to the current design — no full re-render
                                </span>
                              </>
                            )}
                          </button>
                          {recreateApplyingEdit && (
                            <p style={{ fontSize: 11, color: "#6b7280", textAlign: "center", marginTop: 8 }}>
                              Working on it — this can take up to a minute. The design above updates when it's done.
                            </p>
                          )}
                        </div>
                      )}

                      {/* PanelPro Extract — the SAME output path DesignPro uses
                          (Trish 2026-07-23: "we will use the same output path as
                          DesignPro … it should be PanelPro Extract"). Replaces the old
                          QCProductionFlowContainer "Production Layers" card (separated
                          bg/branding/depth, UNDEFINED dims — the wrong path).
                          DesignAssetsPanel is the same component DesignPro renders on
                          /design-assets + ApprovePro: it resolves the canonical DesignIQ
                          id from color_visualizations.admin_notes.designiq_generation_id
                          (the back-link ProductionFlow stamps above), reads the
                          production_flow_assets vault, and shows the per-side print
                          panels from the sanctioned chain (2D proof → panel-pro-extract /
                          gridslice → vault → PanelPro pull → Upscale). Pass the
                          color_visualizations id (recreateVisualizationId) — the panel
                          resolves canonical internally, so NOT the raw generation id. */}
                      {recreateVisualizationId && (
                        <div style={{ marginTop: 20 }}>
                          <DesignAssetsPanel
                            generationId={recreateVisualizationId}
                            fallbackVehicle={{ make: recreateMake, model: recreateModel, year: recreateYear || "2024" }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Upload + Form - default state */}
                  {!recreateRendering && !recreateRenderUrl && (<>
                    {/* Upload Zone - 1 to 6 reference images */}
                    <div
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#7c3aed"; }}
                      onDragLeave={(e) => { e.currentTarget.style.borderColor = recreatePreviews.length > 0 ? "#7c3aed" : "#d1d5db"; }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.borderColor = "#d1d5db";
                        if (e.dataTransfer.files.length > 0) handleRecreateFileSelect(e.dataTransfer.files);
                      }}
                      onClick={() => recreateFiles.length < MAX_RECREATE_IMAGES && recreateFileRef.current?.click()}
                      style={{
                        border: recreatePreviews.length > 0 ? "2px solid #7c3aed" : "2px dashed #d1d5db",
                        borderRadius: 10, textAlign: "center",
                        cursor: recreateFiles.length < MAX_RECREATE_IMAGES ? "pointer" : "default",
                        background: recreatePreviews.length > 0 ? "#fafafa" : "#fafafa",
                        transition: "all 0.2s", marginBottom: 16, overflow: "hidden",
                        padding: recreatePreviews.length > 0 ? "10px" : "32px 20px", position: "relative",
                      }}
                    >
                      {recreatePreviews.length > 0 ? (
                        <div>
                          <div style={{ display: "grid", gridTemplateColumns: recreatePreviews.length === 1 ? "1fr" : "repeat(auto-fill, minmax(120px, 1fr))", gap: 6 }}>
                            {recreatePreviews.map((preview, idx) => (
                              <div key={idx} style={{ position: "relative", borderRadius: 6, overflow: "hidden", border: idx === 0 ? "2px solid #7c3aed" : "1px solid #e5e7eb", background: "#000" }}>
                                <img src={preview} alt={`Ref ${idx + 1}`} style={{ width: "100%", height: recreatePreviews.length === 1 ? 200 : 100, objectFit: "contain", display: "block" }} />
                                {idx === 0 && (
                                  <div style={{ position: "absolute", bottom: 3, left: 3, background: "rgba(124,58,237,0.9)", color: "#fff", fontSize: 7, fontWeight: 700, padding: "1px 5px", borderRadius: 3, letterSpacing: 0.5 }}>PRIMARY</div>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleRecreateRemoveFile(idx); }}
                                  style={{ position: "absolute", top: 3, right: 3, width: 18, height: 18, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.7)", color: "#fff", cursor: "pointer", fontSize: 10, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
                                >×</button>
                              </div>
                            ))}
                            {recreateFiles.length < MAX_RECREATE_IMAGES && (
                              <div
                                onClick={(e) => { e.stopPropagation(); recreateFileRef.current?.click(); }}
                                style={{
                                  height: recreatePreviews.length === 1 ? 200 : 100, borderRadius: 6, border: "2px dashed #d1d5db",
                                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                                  cursor: "pointer", background: "#f9fafb",
                                }}
                              >
                                <span style={{ fontSize: 20, color: "#d1d5db" }}>+</span>
                                <span style={{ fontSize: 9, color: "#9ca3af" }}>Add more</span>
                              </div>
                            )}
                          </div>
                          <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 6 }}>
                            {recreateFiles.length}/{MAX_RECREATE_IMAGES} photos - first image is the primary reference
                          </p>
                        </div>
                      ) : (
                        <>
                          <p style={{ fontSize: 28, color: "#c4b5fd", marginBottom: 8 }}>📸</p>
                          <p style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>Drop in 1–6 wrap photos, screenshots, or files</p>
                          <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>See a wrap at a show? On Instagram? A competitor's truck? Drop it here.</p>
                        </>
                      )}
                      <input
                        ref={recreateFileRef}
                        type="file"
                        accept="image/*,.pdf,.ai,.eps,.svg"
                        multiple
                        style={{ display: "none" }}
                        onChange={(e) => { if (e.target.files && e.target.files.length > 0) handleRecreateFileSelect(e.target.files); e.target.value = ""; }}
                      />
                    </div>

                    {/* Vehicle: Year / Make / Model */}
                    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#9ca3af", textTransform: "uppercase", marginBottom: 8 }}>
                      Target Vehicle
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 10, marginBottom: 16 }}>
                      <input value={recreateYear} onChange={(e) => setRecreateYear(e.target.value)} placeholder="Year"
                        style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, outline: "none" }} />
                      <input value={recreateMake} onChange={(e) => setRecreateMake(e.target.value)} placeholder="Make"
                        style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, outline: "none" }} />
                      <input value={recreateModel} onChange={(e) => setRecreateModel(e.target.value)} placeholder="Model"
                        style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, outline: "none" }} />
                    </div>

                    {/* Vehicle type — Trailer/boat/etc. skip the hood angle */}
                    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#9ca3af", textTransform: "uppercase", marginBottom: 8 }}>
                      Vehicle Type
                    </p>
                    <div style={{ marginBottom: 16 }}>
                      <VehicleTypeSelector value={recreateVehicleType} onChange={setRecreateVehicleType} />
                    </div>

                    {/* Edits / Notes — headed like the other fields so it's
                        discoverable, and the target of the "Make Slight Edits"
                        focus jump. */}
                    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#9ca3af", textTransform: "uppercase", marginBottom: 8 }}>
                      Edits / Notes <span style={{ textTransform: "none", fontWeight: 500, color: "#c084fc" }}>— required for "Make Slight Edits"</span>
                    </p>
                    <textarea
                      ref={recreateNotesRef}
                      value={recreateNotes}
                      onChange={(e) => {
                        const next = e.target.value;
                        setRecreateNotes(next);
                        if (!recreateFinishManuallySet) {
                          const detected = detectRecreateFinishInText(next);
                          if (detected && detected !== recreateFinish) {
                            setRecreateFinish(detected);
                            setRecreateFinishAutoDetected(detected);
                          } else if (!detected && recreateFinishAutoDetected) {
                            setRecreateFinish("Gloss");
                            setRecreateFinishAutoDetected(null);
                          }
                        }
                      }}
                      placeholder="What would you like to change? e.g. &quot;move the SD logo up so it's not cut off&quot;, &quot;change the red to matte blue&quot;, or &quot;add company logo on both doors&quot;. (Leave blank if you're using Create Exact.)"
                      rows={2}
                      style={{
                        width: "100%", padding: "10px 12px", borderRadius: 8,
                        border: recreateNotesFlash ? "2px solid #ec4899" : "1px solid #e5e7eb",
                        boxShadow: recreateNotesFlash ? "0 0 0 4px rgba(236,72,153,0.20)" : "none",
                        fontSize: 12, resize: "vertical",
                        outline: "none", fontFamily: "inherit", lineHeight: 1.5, marginBottom: 12,
                        transition: "border 0.2s, box-shadow 0.2s",
                      }}
                    />

                    {/* Lamination finish */}
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                        Lamination finish
                      </p>
                      <div role="radiogroup" aria-label="Lamination finish" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        {(["Gloss", "Satin", "Matte"] as const).map((opt) => {
                          const selected = recreateFinish === opt;
                          const subtitle: Record<RecreateFinish, string> = {
                            Gloss: "Shiny wet-look",
                            Satin: "Soft sheen",
                            Matte: "Flat, zero shine",
                          };
                          return (
                            <button
                              key={opt}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => {
                                setRecreateFinish(opt);
                                setRecreateFinishManuallySet(true);
                                setRecreateFinishAutoDetected(null);
                              }}
                              style={{
                                padding: "10px 6px",
                                borderRadius: 10,
                                border: selected ? "2px solid #7c3aed" : "1px solid #e5e7eb",
                                background: selected ? "#faf5ff" : "#fff",
                                color: selected ? "#6b21a8" : "#374151",
                                cursor: "pointer",
                                fontSize: 12,
                                fontWeight: 700,
                                minHeight: 52,
                                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                                transition: "all 0.15s",
                              }}
                            >
                              <span>{opt}</span>
                              <span style={{ fontSize: 9, fontWeight: 500, color: selected ? "#7c3aed" : "#9ca3af" }}>{subtitle[opt]}</span>
                            </button>
                          );
                        })}
                      </div>
                      {recreateFinishAutoDetected && (
                        <p style={{ fontSize: 10, color: "#7c3aed", marginTop: 6, fontWeight: 600 }}>
                          Auto-picked <strong>{recreateFinishAutoDetected}</strong> from your notes. Tap a button to override.
                        </p>
                      )}
                    </div>

                    {/* Two Action Buttons - like DesignPro VisionBoard.
                        hasRecreateRef also counts a DesignPro handoff (already-
                        uploaded URLs with no re-picked File) so Create Exact isn't
                        stuck disabled when the reference came over from DesignPro. */}
                    {(() => {
                      const hasRecreateRef = recreateFiles.length > 0 || recreateStoredUrls.length > 0;
                      return (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <button
                        onClick={() => handleRecreateRender("exact")}
                        disabled={!hasRecreateRef || !(recreateYear && recreateMake && recreateModel)}
                        style={{
                          padding: "14px 16px", borderRadius: 10, border: "none",
                          background: hasRecreateRef ? "linear-gradient(135deg, #3b82f6, #ec4899)" : "#e5e7eb",
                          color: hasRecreateRef ? "#fff" : "#9ca3af",
                          cursor: hasRecreateRef ? "pointer" : "not-allowed",
                          fontSize: 14, fontWeight: 700, transition: "all 0.2s",
                        }}
                      >
                        Create Exact
                        <span style={{ display: "block", fontSize: 10, fontWeight: 500, marginTop: 2, opacity: 0.8 }}>
                          Clone this design on my vehicle
                        </span>
                      </button>
                      <button
                        onClick={() => handleRecreateRender("edits")}
                        disabled={!hasRecreateRef || !(recreateYear && recreateMake && recreateModel)}
                        style={{
                          padding: "14px 16px", borderRadius: 10,
                          border: hasRecreateRef ? "2px solid #ec4899" : "2px solid #e5e7eb",
                          background: hasRecreateRef ? "#fdf2f8" : "#f9fafb",
                          color: hasRecreateRef ? "#db2777" : "#9ca3af",
                          cursor: hasRecreateRef ? "pointer" : "not-allowed",
                          fontSize: 14, fontWeight: 700, transition: "all 0.2s",
                        }}
                      >
                        This Is It - Make Slight Edits
                        <span style={{ display: "block", fontSize: 10, fontWeight: 500, marginTop: 2, opacity: 0.7 }}>
                          Use my notes to adjust the design
                        </span>
                      </button>
                    </div>
                      );
                    })()}

                    {/* Token info */}
                    <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 12, textAlign: "center" }}>
                      {isPrivileged ? "Admin - free renders" : "10 tokens per render • Results appear above instantly"}
                    </p>
                  </>)}
                </div>
              )}
            </div>

            {/* ─── FILE PREP TOOLS SECTION ─── */}
            {/* File Prep & Preflight Tools Overview + Upload Zone */}
            {!analysis && !prepResult && !analyzing && (
              <div>
                {/* Section divider - separates RecreatePro from file tools */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 12, marginBottom: 16,
                }}>
                  <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#9ca3af",
                    textTransform: "uppercase", whiteSpace: "nowrap",
                  }}>
                    File Prep Tools - Upload to Get Started
                  </span>
                  <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
                </div>

                {/* File Prep & Preflight Tools - Featured First */}
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{
                    fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "#9ca3af",
                    textTransform: "uppercase", marginBottom: 16,
                  }}>
                    File Prep & Preflight Tools
                  </h3>

                  {/* Job-attached banner — when a real panelizer_job is loaded
                      (Order Production Pack flow), prep tool outputs save
                      under that job's order number in WrapBox. */}
                  {job?.order_number && (
                    <div style={{
                      background: "linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)",
                      borderRadius: 10, padding: "12px 16px", marginBottom: 16,
                      display: "flex", alignItems: "center", gap: 10,
                      border: "1px solid rgba(96,165,250,0.3)",
                    }}>
                      <span style={{ fontSize: 18 }}>📦</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                          Working on order <span style={{ fontFamily: "monospace" }}>{job.order_number}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
                          Prep tool outputs will save to WrapBox under this order.
                        </div>
                      </div>
                      <button
                        onClick={() => navigate(`/wrapbox?job=${job.order_number}`)}
                        style={{
                          fontSize: 11, fontWeight: 700, padding: "6px 12px",
                          background: "rgba(255,255,255,0.15)", borderRadius: 6,
                          color: "#fff", border: "1px solid rgba(255,255,255,0.25)",
                          cursor: "pointer", whiteSpace: "nowrap",
                        }}
                      >
                        Open in WrapBox
                      </button>
                    </div>
                  )}

                  {/* Cut Contour Logo Pack - Prominent Product Button.
                      Bypasses the analyze step entirely: prompt for an order,
                      upload the file, then call cut-map directly with the URL
                      we just got. No scroll-to-tool, no second click. */}
                  <div
                    onClick={async () => {
                      const onum = window.prompt(
                        "Order number to attach this Cut Contour Pack to (e.g. customer PO). Leave blank to create a new MP- order.",
                        "",
                      );
                      let pjid: string | null = null;
                      if (onum && onum.trim()) {
                        const trimmed = onum.trim();
                        try {
                          const { data: existing } = await (supabase as any)
                            .from("panelizer_jobs")
                            .select("id")
                            .eq("order_number", trimmed)
                            .maybeSingle();
                          if (existing?.id) {
                            pjid = existing.id;
                          } else {
                            const { data: { user } } = await supabase.auth.getUser();
                            if (user) {
                              const { data: newJob } = await (supabase as any)
                                .from("panelizer_jobs")
                                .insert({
                                  user_id: user.id,
                                  job_type: "manual_prep",
                                  status: "ready",
                                  order_number: trimmed,
                                })
                                .select("id")
                                .single();
                              if (newJob?.id) pjid = newJob.id;
                            }
                          }
                        } catch (err) {
                          console.warn("[CutContour] order lookup/create failed:", err);
                        }
                        if (!pjid) {
                          toast({
                            title: "Order attach failed",
                            description: "Couldn't link to that order number. Continuing with auto-created MP- order.",
                          });
                        }
                      }

                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = ".png,.jpg,.jpeg,.tiff,.tif,.pdf,.svg,.ai,.eps";
                      input.onchange = async (ev: any) => {
                        const file: File | undefined = ev.target.files?.[0];
                        if (!file) return;
                        try {
                          const { data: { user } } = await supabase.auth.getUser();
                          if (!user) throw new Error("Not authenticated");

                          setUploadedFile(file);
                          setRunningStartMs(Date.now());
                          setRunningService("cut_map");
                          setProcessingStep("Uploading file…");

                          const ext = (file.name.split(".").pop() || "png").toLowerCase();
                          const path = `quick-prep/${user.id}/${Date.now()}.${ext}`;
                          const { error: upErr } = await supabase.storage
                            .from("wrap-files")
                            .upload(path, file, { upsert: true });
                          if (upErr) throw upErr;
                          const { data: urlData } = supabase.storage
                            .from("wrap-files")
                            .getPublicUrl(path);

                          // Hand the file_url + jobId to handleRunService
                          // directly — no analyze step, no waiting for state.
                          // mode: 'pack' opts in to the Gemini-detected
                          // per-element ZIP pipeline (vs the legacy single
                          // SVG used by GraphicsPro).
                          await handleRunService("cut_map", { mode: "pack" }, {
                            fileUrl: urlData.publicUrl,
                            fileName: file.name,
                            jobId: pjid,
                          });
                        } catch (err: any) {
                          setRunningService(null);
                          setRunningStartMs(null);
                          setProcessingStep("");
                          toast({
                            title: "Cut Contour Pack failed",
                            description: err?.message || "Could not run Cut Contour Logo Pack",
                            variant: "destructive",
                          });
                        }
                      };
                      input.click();
                    }}
                    style={{
                      background: "linear-gradient(135deg, #7c3aed 0%, #9333ea 100%)",
                      borderRadius: 12, padding: "20px 24px", marginBottom: 20,
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      cursor: "pointer", transition: "all 0.2s ease",
                      boxShadow: "0 4px 16px rgba(124,58,237,0.25)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(124,58,237,0.35)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(124,58,237,0.25)"; }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                        <span style={{ fontSize: 20 }}>✂</span>
                        <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>Cut Contour Logo Pack™</span>
                      </div>
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", margin: 0 }}>
                        AI-extracted vector cut files with CutContour spot color (#FF00FF) - direct to RIP
                      </p>
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: "6px 16px",
                      background: "rgba(255,255,255,0.2)", borderRadius: 8, color: "#fff",
                      whiteSpace: "nowrap",
                    }}>Upload &amp; Generate →</span>
                  </div>

                  {/* Tool Cards Grid - click to upload + pre-select tool */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
                    {[
                      {
                        id: "file_output", icon: "✄", name: "File Output", tokens: 2,
                        headline: "Customer gives you the file — get back a CutContour print-ready file.",
                        desc: "Upload a finished design and we wrap it with a 100% Magenta CutContour keyline, 0.5\" bleed, and registration marks - direct to RIP. Deterministic, no redesign.",
                        output: "PDF (CutContour spot + 0.5\" bleed + reg marks)",
                      },
                      {
                        id: "cut_map", icon: "◎", name: "CutMap™", tokens: 3,
                        headline: "Generate precise cut maps and panel layouts instantly.",
                        desc: "Maps your wrap design to exact material width and panel sizes - eliminating waste, reducing install time, and removing guesswork from production.",
                        output: "SVG cut file + PNG overlay with CutContour spot color",
                      },
                      {
                        id: "file_revitalizer", icon: "◈", name: "FileRevitalizer™", tokens: 3,
                        headline: "Rescue low-quality files and make them print-worthy.",
                        desc: "Upscales, sharpens, and enhances images so you can save the job instead of sending the customer back to their designer.",
                        output: "PNG (AI upscaled + sharpened)",
                      },
                      {
                        id: "vectorize_it", icon: "◇", name: "VectorizeIt™", tokens: 4,
                        headline: "Turn raster images into clean, scalable vectors on demand.",
                        desc: "Converts logos, graphics, and artwork into production-grade vectors - no more tracing by hand or waiting on a designer.",
                        output: "Production-grade SVG (up to 12 color layers)",
                      },
                      {
                        id: "bg_remove", icon: "◻", name: "Background Removal", tokens: 2,
                        headline: "Clean transparent output for contour cut prep.",
                        desc: "Remove background with alpha masking - essential first step before generating cut contours or spot layers.",
                        output: "PNG with alpha transparency",
                      },
                      {
                        id: "layer_split", icon: "◐", name: "Layer Split™", tokens: 4,
                        headline: "Get the subject AND a clean background plate.",
                        desc: "Separates the logo / element from the wrap art. You get the subject as a transparent PNG and the background with the subject erased and AI-filled - drop a new logo on the same wrap instantly.",
                        output: "Subject PNG + Background PNG (subject erased)",
                      },
                      {
                        id: "extract_elements", icon: "✛", name: "Extract Elements™", tokens: 3,
                        headline: "Click to remove logos and text from a wrap.",
                        desc: "You click on each logo and text block, the tool erases those exact spots and AI-fills the wrap art behind them. Perfect for re-using a wrap design with a new brand.",
                        output: "PNG (wrap art with clicked elements erased)",
                      },
                      {
                        id: "upscale_4x", icon: "△", name: "AI Upscale (4x)", tokens: 3,
                        headline: "Maximum print quality from any source file.",
                        desc: "AI-powered 4x resolution boost. Takes phone photos and low-res logos to large-format print quality.",
                        output: "PNG (4x resolution)",
                      },
                    ].map((tool) => (
                      <div
                        key={tool.name}
                        onClick={() => {
                          // Pre-select this tool so after upload + analysis it auto-opens
                          setPendingTool(tool.id);
                          // Open file picker immediately
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = ".png,.jpg,.jpeg,.tiff,.tif,.pdf,.svg,.ai,.eps";
                          input.onchange = (ev: any) => {
                            const file = ev.target.files?.[0];
                            if (file) handleFileSelect(file);
                          };
                          input.click();
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "#6366f1";
                          e.currentTarget.style.boxShadow = "0 4px 16px rgba(99,102,241,0.12)";
                          e.currentTarget.style.transform = "translateY(-2px)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "#e5e7eb";
                          e.currentTarget.style.boxShadow = "none";
                          e.currentTarget.style.transform = "translateY(0)";
                        }}
                        style={{
                          background: "#fff", borderRadius: 10, padding: "16px 20px",
                          border: "1px solid #e5e7eb", display: "flex", flexDirection: "column",
                          cursor: "pointer", transition: "all 0.2s ease",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 18 }}>{tool.icon}</span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{tool.name}</span>
                          </div>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: "2px 8px",
                            background: isPrivileged ? "#f0fdf4" : "#f0f0ff", borderRadius: 4,
                            color: isPrivileged ? "#16a34a" : "#6366f1",
                          }}>{isPrivileged ? "Free" : `${tool.tokens} tokens`}</span>
                        </div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>{tool.headline}</p>
                        <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5, flex: 1 }}>{tool.desc}</p>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                          <p style={{ fontSize: 10, color: "#9ca3af", margin: 0 }}>
                            <span style={{ fontWeight: 600 }}>Output:</span> {tool.output}
                          </p>
                          <span style={{
                            fontSize: 11, fontWeight: 700, color: "#fff",
                            padding: "5px 12px", background: "#6366f1", borderRadius: 6,
                          }}>Select File & Run →</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Compact Upload Zone */}
                <div
                  ref={uploadZoneRef}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "#6366f1";
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.style.borderColor = "#d1d5db";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "#d1d5db";
                    const file = e.dataTransfer.files[0];
                    if (file) handleFileSelect(file);
                  }}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept =
                      ".png,.jpg,.jpeg,.tiff,.tif,.pdf,.svg,.ai,.eps";
                    input.onchange = (e: any) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file);
                    };
                    input.click();
                  }}
                  style={{
                    border: "2px dashed #d1d5db",
                    borderRadius: 10,
                    padding: "16px 24px",
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    cursor: "pointer",
                    transition: "border-color 0.2s",
                    background: "#fff",
                    marginBottom: 24,
                  }}
                >
                  <span style={{ fontSize: 22, color: "#d1d5db" }}>↑</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "#374151", margin: 0 }}>
                      Drop your file here or click to upload
                    </p>
                    <p style={{ fontSize: 12, color: "#9ca3af", margin: 0, marginTop: 2 }}>
                      PNG, JPG, TIFF, PDF, SVG, AI, EPS - we'll analyze it and recommend the right tools
                    </p>
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: 700, color: "#6366f1",
                    padding: "8px 16px", background: "#f0f0ff", borderRadius: 8,
                    whiteSpace: "nowrap",
                  }}>
                    Upload File
                  </span>
                </div>

                {/* Prep Packages Overview */}
                <div>
                  <h3 style={{
                    fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "#9ca3af",
                    textTransform: "uppercase", marginBottom: 16,
                  }}>
                    Preflight Packages - Upload a file to get started
                  </h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                    {QUICK_PREP_PACKAGES.map((pkg) => (
                      <div
                        key={pkg.id}
                        onClick={() => {
                          // Open file picker - after upload, packages view will show
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = ".png,.jpg,.jpeg,.tiff,.tif,.pdf,.svg,.ai,.eps";
                          input.onchange = (ev: any) => {
                            const file = ev.target.files?.[0];
                            if (file) handleFileSelect(file);
                          };
                          input.click();
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "#8b5cf6";
                          e.currentTarget.style.boxShadow = "0 4px 16px rgba(139,92,246,0.1)";
                          e.currentTarget.style.transform = "translateY(-2px)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "#f0f0f0";
                          e.currentTarget.style.boxShadow = "none";
                          e.currentTarget.style.transform = "translateY(0)";
                        }}
                        style={{
                          background: "#fff", borderRadius: 10, padding: "14px 18px",
                          border: "1px solid #f0f0f0", cursor: "pointer", transition: "all 0.2s ease",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{pkg.name}</span>
                          <span style={{ fontSize: isPrivileged ? 11 : 14, fontWeight: isPrivileged ? 700 : 800, color: isPrivileged ? "#16a34a" : "#6366f1" }}>{isPrivileged ? "Free" : pkg.tokens}</span>
                        </div>
                        <p style={{ fontSize: 10, fontWeight: 600, color: "#8b5cf6", letterSpacing: 0.5, marginBottom: 4 }}>{pkg.engine}</p>
                        <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.4 }}>{pkg.description}</p>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: "#9ca3af" }}>
                            ⏱ {pkg.timeSaved} saved • Designer: {pkg.designerCost}
                          </span>
                          <span style={{
                            fontSize: 10, fontWeight: 700, color: "#fff",
                            padding: "3px 10px", background: "#8b5cf6", borderRadius: 4,
                          }}>Select File →</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Analyzing */}
            {analyzing && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  padding: "40px",
                  textAlign: "center",
                  border: "1px solid #e5e7eb",
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    border: "3px solid #e5e7eb",
                    borderTopColor: "#6366f1",
                    margin: "0 auto 16px",
                    animation: "pf-spin 1s linear infinite",
                  }}
                />
                <p
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#374151",
                  }}
                >
                  Analyzing {uploadedFile?.name}...
                </p>
                <p
                  style={{
                    fontSize: 13,
                    color: "#9ca3af",
                    marginTop: 4,
                  }}
                >
                  Checking resolution, transparency, cut paths, color space
                </p>
              </div>
            )}

            {/* Processing */}
            {processing && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  padding: "40px",
                  textAlign: "center",
                  border: "1px solid #e5e7eb",
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    border: "3px solid #e5e7eb",
                    borderTopColor: "#6366f1",
                    margin: "0 auto 16px",
                    animation: "pf-spin 1s linear infinite",
                  }}
                />
                <p
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#374151",
                  }}
                >
                  Running production prep...
                </p>
                <p
                  style={{
                    fontSize: 13,
                    color: "#9ca3af",
                    marginTop: 4,
                  }}
                >
                  {processingStep || "Processing your file through the pipeline"}
                </p>
              </div>
            )}

            {/* Analysis Result - show recommended bundle */}
            {analysis && !prepResult && !processing && (
              <div>
                {/* File Analysis Card */}
                <div
                  style={{
                    background: "#fff",
                    borderRadius: 12,
                    padding: "24px 28px",
                    marginBottom: 20,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 16,
                    }}
                  >
                    <h3
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: 1.5,
                        color: "#9ca3af",
                        textTransform: "uppercase",
                      }}
                    >
                      File Analysis
                    </h3>
                    <span style={{ fontSize: 13, color: "#6b7280" }}>
                      {uploadedFile?.name}
                    </span>
                  </div>
                  {analysis.summary && (
                    <p
                      style={{
                        fontSize: 13,
                        color: "#374151",
                        marginBottom: 16,
                        padding: "8px 12px",
                        background: "#f9fafb",
                        borderRadius: 6,
                      }}
                    >
                      {analysis.summary}
                    </p>
                  )}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(160px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {Object.entries(analysis.file_analysis || {}).map(
                      ([key, val]) => (
                        <div
                          key={key}
                          style={{
                            padding: "8px 12px",
                            background: "#f9fafb",
                            borderRadius: 6,
                          }}
                        >
                          <p
                            style={{
                              fontSize: 10,
                              color: "#9ca3af",
                              textTransform: "uppercase",
                              letterSpacing: 1,
                            }}
                          >
                            {key.replace(/_/g, " ")}
                          </p>
                          <p
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: "#111",
                            }}
                          >
                            {String(val)}
                          </p>
                        </div>
                      )
                    )}
                  </div>
                  {/* Issues */}
                  {analysis.issues?.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <p
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#9ca3af",
                          textTransform: "uppercase",
                          letterSpacing: 1,
                          marginBottom: 8,
                        }}
                      >
                        Issues Found
                      </p>
                      {(analysis.issues || []).map((issue: any, idx: number) => (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            padding: "6px 0",
                            borderBottom:
                              idx < analysis.issues.length - 1
                                ? "1px solid #f3f4f6"
                                : "none",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background:
                                issue.severity === "critical"
                                  ? "#fef2f2"
                                  : issue.severity === "warning"
                                  ? "#fffbeb"
                                  : "#f0f9ff",
                              color:
                                issue.severity === "critical"
                                  ? "#dc2626"
                                  : issue.severity === "warning"
                                  ? "#92400e"
                                  : "#0369a1",
                              textTransform: "uppercase",
                            }}
                          >
                            {issue.severity}
                          </span>
                          <span
                            style={{ fontSize: 13, color: "#374151" }}
                          >
                            {issue.description || issue.issue}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Mode Toggle: Packages vs Individual Services */}
                <div style={{
                  display: "flex", gap: 0, background: "#f3f4f6", borderRadius: 8,
                  padding: 3, marginBottom: 20, width: "fit-content",
                }}>
                  {([
                    { key: "packages" as const, label: "Prep Packages" },
                    { key: "services" as const, label: "Individual Services" },
                  ]).map((m) => (
                    <button key={m.key} onClick={() => { setServiceMode(m.key); setServiceResult(null); }} style={{
                      padding: "8px 20px", borderRadius: 6, border: "none", cursor: "pointer",
                      fontSize: 13, fontWeight: 600, transition: "all 0.2s",
                      background: serviceMode === m.key ? "#fff" : "transparent",
                      color: serviceMode === m.key ? "#111" : "#6b7280",
                      boxShadow: serviceMode === m.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    }}>{m.label}</button>
                  ))}
                </div>

                {/* ─── INDIVIDUAL SERVICES MODE ─────────────────── */}
                {serviceMode === "services" && !serviceResult && !runningService && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, marginBottom: 20 }}>
                    {([
                      {
                        id: "file_output", name: "File Output", tokens: 2, icon: "✄",
                        headline: "Customer gives you the file — get back a CutContour print-ready file.",
                        desc: "Deterministic (no AI): we take the customer's finished artwork and wrap it with a 100% Magenta CutContour keyline, 0.5\" bleed, and registration marks. Direct to RIP - no redesign, no guesswork.",
                        output: "PDF (100% Magenta CutContour spot + 0.5\" bleed + reg marks)",
                        engines: ["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery"],
                        modes: ["Contour"],
                        spec: "100% Magenta spot keyline + 0.5\" bleed + corner registration marks",
                      },
                      {
                        id: "cut_map", name: "CutMap™", tokens: 3, icon: "◎",
                        headline: "Generate precise cut maps and panel layouts instantly.",
                        desc: "CutMap takes your wrap design and maps it to your exact material width and panel sizes - eliminating waste, reducing install time, and removing the guesswork from production.",
                        output: "SVG cut file + PNG overlay with CutContour spot color (#FF00FF)",
                        engines: ["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery"],
                        modes: ["Contour", "Kiss Cut", "Perf Cut", "Through Cut"],
                        spec: "Magenta spot layer at 0.25pt stroke, zero fill - direct to RIP",
                      },
                      {
                        id: "file_revitalizer", name: "FileRevitalizer™", tokens: 3, icon: "◈",
                        headline: "Rescue low-quality files and make them print-worthy.",
                        desc: "FileRevitalizer upscales, sharpens, and enhances images and artwork so you can save the job instead of sending the customer back to their designer.",
                        output: "PNG (AI upscaled + sharpened)",
                        engines: ["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery"],
                        modes: ["2x Upscale", "4x Upscale", "Sharpen Only"],
                        spec: "DPI-optimized for target print width - shows before/after DPI",
                      },
                      {
                        id: "vectorize_it", name: "VectorizeIt™", tokens: 4, icon: "◇",
                        headline: "Turn raster images into clean, scalable vector files on demand.",
                        desc: "VectorizeIt converts logos, graphics, and artwork into production-grade vectors - no more tracing by hand or waiting on a designer.",
                        output: "Production-grade SVG (scalable vector graphics)",
                        engines: ["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery", "Illustrator", "CorelDRAW", "SignCut"],
                        modes: ["Silhouette", "Detailed (multi-color)", "Centerline (text/line art)"],
                        spec: "Marching squares + k-means color quantization - up to 12 color layers",
                      },
                      {
                        id: "bg_remove", name: "Background Removal", tokens: 2, icon: "◻",
                        headline: "Clean transparent output for contour cut prep.",
                        desc: "Remove background with real subject segmentation (BiRefNet alpha matting). Essential first step before generating cut contours or spot layers.",
                        output: "PNG with alpha transparency channel",
                        engines: ["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery"],
                        modes: [],
                        spec: "BiRefNet AI segmentation - clean edges on hair, text, photos",
                      },
                      {
                        id: "layer_split", name: "Layer Split™", tokens: 4, icon: "◐",
                        headline: "Get the subject AND a clean background plate.",
                        desc: "Separates the logo / element from the wrap art. You get the subject as a transparent PNG and the background with the subject erased and AI-filled - drop a new logo on the same wrap instantly.",
                        output: "Subject PNG (transparent) + Background PNG (subject erased & filled)",
                        engines: ["Illustrator", "Photoshop", "CorelDRAW", "VersaWorks", "Onyx", "Caldera", "Flexi", "SAi"],
                        modes: [],
                        spec: "BiRefNet subject extraction + LaMa-style inpaint for the background plate",
                      },
                      {
                        id: "extract_elements", name: "Extract Elements™", tokens: 3, icon: "✛",
                        headline: "Click to remove logos and text from a wrap.",
                        desc: "Direct control: you tap each logo / text block on the upload, the tool erases those spots with AI-fill so you can re-use the wrap art with a new brand. No 'AI guess what you mean' - you tell it exactly what to remove.",
                        output: "PNG (wrap art with the clicked elements erased)",
                        engines: ["Illustrator", "Photoshop", "CorelDRAW"],
                        modes: ["Click to mark", "Adjustable brush size"],
                        spec: "User-painted mask + LaMa-Cleaner inpaint",
                      },
                      {
                        id: "upscale_4x", name: "AI Upscale (4x)", tokens: 3, icon: "△",
                        headline: "Maximum print quality from any source file.",
                        desc: "AI-powered 4x resolution boost. Takes phone photos and low-res logos to large-format print quality.",
                        output: "PNG (4x AI-upscaled resolution)",
                        engines: ["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery"],
                        modes: [],
                        spec: "Proprietary AI upscaling with bicubic fallback",
                      },
                    ] as const).map((svc) => (
                      <div key={svc.id} id={`tool-${svc.id}`} ref={highlightedTool === svc.id ? (el) => el?.scrollIntoView({ behavior: "smooth", block: "center" }) : undefined} style={{
                        background: highlightedTool === svc.id ? "#f0f0ff" : "#fff",
                        borderRadius: 12, padding: "20px 24px",
                        border: highlightedTool === svc.id ? "2px solid #6366f1" : "1px solid #e5e7eb",
                        transition: "border-color 0.3s, background 0.3s",
                        display: "flex", flexDirection: "column",
                        boxShadow: highlightedTool === svc.id ? "0 0 20px rgba(99,102,241,0.15)" : "none",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 20 }}>{svc.icon}</span>
                            <p style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>{svc.name}</p>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            {isPrivileged ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a" }}>Free</span>
                            ) : (<>
                              <span style={{ fontSize: 18, fontWeight: 800, color: "#6366f1" }}>{svc.tokens}</span>
                              <p style={{ fontSize: 9, color: "#9ca3af", marginTop: -2 }}>tokens</p>
                            </>)}
                          </div>
                        </div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>{svc.headline}</p>
                        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12, lineHeight: 1.5, flex: 1 }}>{svc.desc}</p>
                        {/* Production Specs - "this is real" */}
                        <div style={{
                          fontSize: 10, color: "#6b7280", marginBottom: 12, padding: "8px 10px",
                          background: "#f9fafb", borderRadius: 6, border: "1px solid #f3f4f6",
                        }}>
                          <p style={{ marginBottom: 3 }}><span style={{ fontWeight: 700, color: "#374151" }}>Output:</span> {svc.output}</p>
                          {svc.modes.length > 0 && <p style={{ marginBottom: 3 }}><span style={{ fontWeight: 700, color: "#374151" }}>Modes:</span> {svc.modes.join(" · ")}</p>}
                          <p style={{ marginBottom: 3 }}><span style={{ fontWeight: 700, color: "#374151" }}>Spec:</span> {svc.spec}</p>
                          <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                            {svc.engines.slice(0, 4).map((e) => (
                              <span key={e} style={{
                                fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
                                background: "#f0f0ff", color: "#6366f1",
                              }}>{e}</span>
                            ))}
                            {svc.engines.length > 4 && (
                              <span style={{ fontSize: 9, color: "#9ca3af" }}>+{svc.engines.length - 4}</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRunService(svc.id)}
                          disabled={!!runningService}
                          style={{
                            width: "100%", padding: "10px", borderRadius: 8,
                            background: analysis?.file_url ? "#6366f1" : "#d1d5db",
                            color: "#fff", border: "none",
                            fontSize: 13, fontWeight: 700,
                            cursor: runningService ? "not-allowed" : "pointer",
                            opacity: runningService ? 0.5 : 1,
                            transition: "all 0.15s",
                          }}
                        >
                          {analysis?.file_url
                            ? `Run ${svc.name}${isPrivileged ? "" : ` - ${svc.tokens} tokens`}`
                            : `Upload a file to use ${svc.name}`}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Running Service Spinner */}
                {runningService && (
                  <div style={{
                    background: "#fff", borderRadius: 12, padding: "40px",
                    textAlign: "center", border: "1px solid #e5e7eb", marginBottom: 20,
                  }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: "50%",
                      border: "3px solid #e5e7eb", borderTopColor: "#6366f1",
                      margin: "0 auto 16px", animation: "pf-spin 1s linear infinite",
                    }} />
                    <p style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>
                      Running {runningService.replace(/_/g, " ")}…
                    </p>
                    <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 4 }}>
                      {processingStep || "Processing your file"}
                    </p>
                    <p style={{
                      fontSize: 12, color: "#6366f1", marginTop: 10,
                      fontVariantNumeric: "tabular-nums", fontWeight: 600,
                    }}>
                      {(runningElapsedMs / 1000).toFixed(1)}s
                      {runningService === "cut_map" && (
                        <span style={{ color: "#9ca3af", fontWeight: 400, marginLeft: 8 }}>
                          / typically 60–90s on cold start
                        </span>
                      )}
                    </p>
                  </div>
                )}

                {/* Service Result */}
                {serviceResult && (
                  <div style={{
                    background: "#fff", borderRadius: 12, padding: "24px 28px",
                    border: "2px solid #16a34a", marginBottom: 20,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                          Service Complete
                        </p>
                        <p style={{ fontSize: 18, fontWeight: 800, color: "#111" }}>{serviceResult.service}</p>
                      </div>
                      <span style={{ fontSize: 13, color: "#6b7280" }}>{isPrivileged ? "Admin - no tokens used" : `${serviceResult.tokens_used} tokens used`}</span>
                    </div>

                    {/* Service-specific metrics */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
                      {serviceResult.processing_ms && (
                        <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: 6 }}>
                          <p style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>Time</p>
                          <p style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{(serviceResult.processing_ms / 1000).toFixed(1)}s</p>
                        </div>
                      )}
                      {serviceResult.contour_points && (
                        <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: 6 }}>
                          <p style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>Contour Points</p>
                          <p style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{serviceResult.contour_points.toLocaleString()}</p>
                        </div>
                      )}
                      {serviceResult.improvement?.dpi_before && (
                        <>
                          <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: 6 }}>
                            <p style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>DPI Before</p>
                            <p style={{ fontSize: 14, fontWeight: 600, color: "#dc2626" }}>{serviceResult.improvement.dpi_before}</p>
                          </div>
                          <div style={{ padding: "8px 12px", background: "#f0fdf4", borderRadius: 6 }}>
                            <p style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>DPI After</p>
                            <p style={{ fontSize: 14, fontWeight: 600, color: "#16a34a" }}>{serviceResult.improvement.dpi_after}</p>
                          </div>
                        </>
                      )}
                      {serviceResult.vector_stats?.path_count && (
                        <>
                          <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: 6 }}>
                            <p style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>Paths</p>
                            <p style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{serviceResult.vector_stats.path_count}</p>
                          </div>
                          <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: 6 }}>
                            <p style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>Color Layers</p>
                            <p style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{serviceResult.vector_stats.color_layers}</p>
                          </div>
                        </>
                      )}
                      {serviceResult.pixels_removed && (
                        <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: 6 }}>
                          <p style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>BG Removed</p>
                          <p style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{serviceResult.percentage_removed}</p>
                        </div>
                      )}
                    </div>

                    {/* Before / After - for FileRevitalizer, VectorizeIt, AI Upscale */}
                    {analysis?.file_url && serviceResult.output_url &&
                      (lastServiceId === "file_revitalizer" || lastServiceId === "vectorize_it" || lastServiceId === "upscale_4x") && (
                      <div style={{ marginBottom: 16 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                          Before & After
                        </p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                          <div>
                            <p style={{
                              fontSize: 10, fontWeight: 700, color: "#dc2626",
                              textTransform: "uppercase", letterSpacing: 1, marginBottom: 6,
                            }}>Before</p>
                            <div style={{
                              borderRadius: 8, overflow: "hidden",
                              border: "2px solid #fecaca", background: "#000",
                            }}>
                              <img
                                src={analysis.file_url}
                                alt="Original"
                                style={{ width: "100%", display: "block", objectFit: "contain", maxHeight: 280 }}
                              />
                            </div>
                          </div>
                          <div>
                            <p style={{
                              fontSize: 10, fontWeight: 700, color: "#16a34a",
                              textTransform: "uppercase", letterSpacing: 1, marginBottom: 6,
                            }}>After</p>
                            <div style={{
                              borderRadius: 8, overflow: "hidden",
                              border: "2px solid #bbf7d0", background: "#000",
                            }}>
                              {lastServiceId === "vectorize_it" && serviceResult.svg_url ? (
                                <img
                                  src={serviceResult.svg_url}
                                  alt="Vectorized"
                                  style={{ width: "100%", display: "block", objectFit: "contain", maxHeight: 280, background: "#fff" }}
                                />
                              ) : (
                                <img
                                  src={serviceResult.output_url}
                                  alt="Processed"
                                  style={{ width: "100%", display: "block", objectFit: "contain", maxHeight: 280 }}
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Download + Actions */}
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {serviceResult.output_url && (
                        <a href={serviceResult.output_url} target="_blank" rel="noopener noreferrer" style={{
                          padding: "10px 24px", background: "#111", color: "#fff", borderRadius: 8,
                          textDecoration: "none", fontSize: 13, fontWeight: 600,
                        }}>
                          ↓ Download Output
                        </a>
                      )}
                      {serviceResult.svg_url && (
                        <a href={serviceResult.svg_url} target="_blank" rel="noopener noreferrer" style={{
                          padding: "10px 24px", background: "#6366f1", color: "#fff", borderRadius: 8,
                          textDecoration: "none", fontSize: 13, fontWeight: 600,
                        }}>
                          ↓ SVG Cut File
                        </a>
                      )}
                      {serviceResult.edge_preview_url && (
                        <a href={serviceResult.edge_preview_url} target="_blank" rel="noopener noreferrer" style={{
                          padding: "10px 24px", background: "#fff", color: "#374151", borderRadius: 8,
                          textDecoration: "none", fontSize: 13, fontWeight: 600, border: "1px solid #e5e7eb",
                        }}>
                          Edge Preview
                        </a>
                      )}
                      <button onClick={() => navigate("/wrapbox")} style={{
                        padding: "10px 24px", background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                        color: "#fff", borderRadius: 8, border: "none",
                        fontSize: 13, fontWeight: 600, cursor: "pointer",
                      }}>
                        View in WrapBox™
                      </button>
                      <button onClick={() => setServiceResult(null)} style={{
                        padding: "10px 24px", background: "#fff", border: "1px solid #e5e7eb",
                        borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#374151",
                      }}>
                        Run Another Service
                      </button>
                    </div>

                    {/* Output format + RIP Compatibility - persistent credibility */}
                    <div style={{ marginTop: 16, padding: "10px 14px", background: "#f9fafb", borderRadius: 8, border: "1px solid #f0f0f0" }}>
                      {serviceResult.output_format && (
                        <p style={{ fontSize: 11, color: "#374151", marginBottom: 6 }}>
                          <span style={{ fontWeight: 700 }}>Output Format:</span> {serviceResult.output_format}
                        </p>
                      )}
                      {serviceResult.description && (
                        <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 6, lineHeight: 1.4 }}>
                          {serviceResult.description}
                        </p>
                      )}
                      {serviceResult.rip_compatible && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                            RIP Compatible
                          </span>
                          {serviceResult.rip_compatible.map((rip: string) => (
                            <span key={rip} style={{
                              fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 4,
                              background: "#f0f0ff", color: "#6366f1", border: "1px solid #e0e0ff",
                            }}>{rip}</span>
                          ))}
                        </div>
                      )}
                      <p style={{ fontSize: 9, color: "#c4c4c4", marginTop: 6 }}>
                        Production-ready output - direct to print, no additional prep needed
                      </p>
                    </div>
                  </div>
                )}

                {/* Recommended Package */}
                {serviceMode === "packages" && analysis.recommendation && (
                  <div
                    style={{
                      background: "#f0f0ff",
                      borderRadius: 12,
                      padding: "24px 28px",
                      marginBottom: 20,
                      border: "2px solid #6366f1",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                        gap: 16,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <p
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#6366f1",
                            textTransform: "uppercase",
                            letterSpacing: 1,
                            marginBottom: 4,
                          }}
                        >
                          Recommended
                        </p>
                        <p
                          style={{
                            fontSize: 20,
                            fontWeight: 800,
                            color: "#111",
                            marginBottom: 4,
                          }}
                        >
                          {analysis.recommendation.package_name}
                        </p>
                        <p
                          style={{
                            fontSize: 13,
                            color: "#6b7280",
                            marginBottom: 12,
                          }}
                        >
                          {analysis.recommendation.description}
                        </p>
                        <div
                          style={{
                            display: "flex",
                            gap: 16,
                            fontSize: 13,
                          }}
                        >
                          <span
                            style={{
                              color: "#16a34a",
                              fontWeight: 600,
                            }}
                          >
                            ⏱{" "}
                            {analysis.recommendation.estimated_time_saved}{" "}
                            saved
                          </span>
                          <span style={{ color: "#374151" }}>
                            Designer equivalent:{" "}
                            {
                              analysis.recommendation
                                .designer_cost_equivalent
                            }
                          </span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p
                          style={{
                            fontSize: 32,
                            fontWeight: 800,
                            color: "#111",
                          }}
                        >
                          {analysis.recommendation.tokens}
                        </p>
                        <p style={{ fontSize: 12, color: "#6b7280" }}>
                          tokens
                        </p>
                        <button
                          onClick={() =>
                            handleRunQuickPrep(
                              analysis.recommendation.package_id
                            )
                          }
                          style={{
                            marginTop: 12,
                            padding: "10px 24px",
                            background: "#6366f1",
                            color: "#fff",
                            borderRadius: 8,
                            border: "none",
                            fontSize: 14,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Run Now
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* All Packages */}
                {serviceMode === "packages" && <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: 16,
                  }}
                >
                  {QUICK_PREP_PACKAGES.map((pkg) => (
                    <div
                      key={pkg.id}
                      style={{
                        background: "#fff",
                        borderRadius: 12,
                        padding: "20px 24px",
                        border:
                          pkg.id ===
                          analysis.recommendation?.package_id
                            ? "2px solid #6366f1"
                            : "1px solid #e5e7eb",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: 8,
                        }}
                      >
                        <p
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: "#111",
                          }}
                        >
                          {pkg.name}
                        </p>
                        <span
                          style={{
                            fontSize: isPrivileged ? 11 : 18,
                            fontWeight: isPrivileged ? 700 : 800,
                            color: isPrivileged ? "#16a34a" : "#6366f1",
                          }}
                        >
                          {isPrivileged ? "Free" : pkg.tokens}
                        </span>
                      </div>
                      <p
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: "#8b5cf6",
                          letterSpacing: 0.5,
                          marginBottom: 6,
                        }}
                      >
                        {pkg.engine}
                      </p>
                      <p
                        style={{
                          fontSize: 12,
                          color: "#6b7280",
                          marginBottom: 12,
                        }}
                      >
                        {pkg.description}
                      </p>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#9ca3af",
                          marginBottom: 12,
                        }}
                      >
                        <p>
                          ⏱ {pkg.timeSaved} saved • Designer cost:{" "}
                          {pkg.designerCost}
                        </p>
                        <p style={{ marginTop: 4 }}>
                          RIP: {pkg.rip.join(", ")}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRunQuickPrep(pkg.id)}
                        disabled={!!processing}
                        style={{
                          width: "100%",
                          padding: "8px",
                          borderRadius: 6,
                          border: analysis?.file_url ? "1px solid #6366f1" : "1px solid #e5e7eb",
                          background: analysis?.file_url ? "#f0f0ff" : "#f9fafb",
                          color: analysis?.file_url ? "#6366f1" : "#9ca3af",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: processing ? "not-allowed" : "pointer",
                          transition: "all 0.15s",
                        }}
                      >
                        {analysis?.file_url ? "Run Package" : "Upload file first"}
                      </button>
                    </div>
                  ))}
                </div>}

                {/* New file button */}
                <div style={{ marginTop: 20, textAlign: "center" }}>
                  <button
                    onClick={() => {
                      setAnalysis(null);
                      setUploadedFile(null);
                    }}
                    style={{
                      padding: "8px 20px",
                      background: "transparent",
                      border: "1px solid #e5e7eb",
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      color: "#6b7280",
                    }}
                  >
                    Upload Different File
                  </button>
                </div>
              </div>
            )}

            {/* Before/After Result */}
            {prepResult && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  padding: "24px 28px",
                  border: "1px solid #e5e7eb",
                }}
              >
                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "#111",
                    marginBottom: 4,
                  }}
                >
                  Production Prep Complete
                </h3>
                {prepResult.estimated_time_saved && (
                  <p
                    style={{
                      fontSize: 13,
                      color: "#16a34a",
                      fontWeight: 600,
                      marginBottom: 20,
                    }}
                  >
                    ⏱ {prepResult.estimated_time_saved} of designer time
                    saved • Designer equivalent:{" "}
                    {prepResult.designer_cost_equivalent}
                  </p>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 24,
                  }}
                >
                  <div
                    style={{
                      padding: 20,
                      background: "#fef2f2",
                      borderRadius: 10,
                    }}
                  >
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#dc2626",
                        textTransform: "uppercase",
                        letterSpacing: 1,
                        marginBottom: 12,
                      }}
                    >
                      Before
                    </p>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#374151",
                        lineHeight: 2,
                      }}
                    >
                      <p>
                        File: {prepResult.before_after?.before?.file_name || uploadedFile?.name}
                      </p>
                      {analysis?.file_analysis &&
                        Object.entries(analysis.file_analysis)
                          .slice(0, 5)
                          .map(([k, v]) => (
                            <p key={k}>
                              {k.replace(/_/g, " ")}: {String(v)}
                            </p>
                          ))}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: 20,
                      background: "#f0fdf4",
                      borderRadius: 10,
                    }}
                  >
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#16a34a",
                        textTransform: "uppercase",
                        letterSpacing: 1,
                        marginBottom: 12,
                      }}
                    >
                      After
                    </p>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#374151",
                        lineHeight: 2,
                      }}
                    >
                      <p>
                        Format:{" "}
                        {prepResult.before_after?.after?.output_format ||
                          "Production PDF"}
                      </p>
                      <p>
                        Steps Completed:{" "}
                        {prepResult.before_after?.steps_completed || 0}/
                        {prepResult.before_after?.steps_total || 0}
                      </p>
                      <p>Tokens Used: {prepResult.tokens_used || 0}</p>
                      {prepResult.rip_compatible && (
                        <p>
                          RIP:{" "}
                          {prepResult.rip_compatible.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* RIP Badges */}
                {prepResult.rip_compatible && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    {prepResult.rip_compatible.map((rip: string) => (
                      <span
                        key={rip}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "4px 10px",
                          borderRadius: 6,
                          background: "#f0f0ff",
                          color: "#6366f1",
                          border: "1px solid #e0e0ff",
                        }}
                      >
                        {rip}
                      </span>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    marginTop: 20,
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  {prepResult.download_url && (
                    <a
                      href={prepResult.download_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: "10px 24px",
                        background: "#111",
                        color: "#fff",
                        borderRadius: 8,
                        border: "none",
                        fontSize: 13,
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      ↓ Download Production File
                    </a>
                  )}
                  <button
                    onClick={() => navigate("/wrapbox")}
                    style={{
                      padding: "10px 24px",
                      background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                      color: "#fff",
                      borderRadius: 8,
                      border: "none",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    View in WrapBox™
                  </button>
                  <button
                    style={{
                      padding: "10px 24px",
                      background: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      color: "#374151",
                    }}
                  >
                    Convert to Production Pack
                  </button>
                  <button
                    onClick={() => {
                      setPrepResult(null);
                      setAnalysis(null);
                      setUploadedFile(null);
                      setSelectedPackage(null);
                    }}
                    style={{
                      padding: "10px 24px",
                      background: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      color: "#374151",
                    }}
                  >
                    New File
                  </button>
                </div>
                <p
                  style={{
                    fontSize: 10,
                    color: "#c4c4c4",
                    marginTop: 20,
                    textAlign: "center",
                    letterSpacing: 0.5,
                  }}
                >
                  Processed by RestyleProAI ProductionFlow™
                </p>
              </div>
            )}
            </>)}
          </div>
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────── */}
      <div
        style={{
          textAlign: "center",
          padding: "32px 0",
          fontSize: 10,
          color: "#fff",
          letterSpacing: 0.5,
          background: "linear-gradient(180deg, hsl(215 70% 18%) 0%, hsl(215 80% 26%) 30%, hsl(215 85% 34%) 60%, hsl(215 90% 42%) 100%)",
          borderRadius: 10,
          marginTop: 16,
        }}
      >
        <span style={{ fontWeight: 700 }}>ProductionFlow™</span> - Powered by Universal Panelizer™ File Output System - All outputs are RIP-compatible production files for VersaWorks, Onyx, Caldera, Flexi, SAi, EFI Fiery
      </div>

      {/* ── Lightbox for viewing RecreatePro renders with arrow navigation ── */}
      {recreateLightboxUrl && (() => {
        const allLightboxImages = [
          ...(recreateAllViews.length > 0
            ? recreateAllViews
            : [{ type: "side", url: recreateRenderUrl || "" }]),
          ...(recreateProofUrl ? [{ type: "2d-proof", url: recreateProofUrl }] : []),
        ];
        const currentIdx = allLightboxImages.findIndex(v => v.url === recreateLightboxUrl);
        const canPrev = currentIdx > 0;
        const canNext = currentIdx < allLightboxImages.length - 1;
        const viewLabel = (t: string) => t === "side" ? "Driver" : t === "passenger-side" ? "Passenger" : t === "hood_detail" ? "Hood" : t === "front" ? "Front" : t === "rear" ? "Rear" : t === "close-up" ? "Close-Up" : t === "roof" ? "Roof" : t === "2d-proof" ? "2D Proof" : t;
        return (
          <div
            onClick={() => setRecreateLightboxUrl(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRecreateLightboxUrl(null);
              if (e.key === "ArrowLeft" && canPrev) setRecreateLightboxUrl(allLightboxImages[currentIdx - 1].url);
              if (e.key === "ArrowRight" && canNext) setRecreateLightboxUrl(allLightboxImages[currentIdx + 1].url);
            }}
            tabIndex={0}
            ref={(el) => el?.focus()}
            style={{
              position: "fixed", inset: 0, zIndex: 9999,
              background: "rgba(0, 0, 0, 0.92)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "zoom-out", padding: 24,
            }}
          >
            {/* Left Arrow */}
            {canPrev && (
              <div
                onClick={(e) => { e.stopPropagation(); setRecreateLightboxUrl(allLightboxImages[currentIdx - 1].url); }}
                style={{
                  position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)",
                  width: 48, height: 48, borderRadius: "50%", background: "rgba(255,255,255,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "#fff", fontSize: 24, fontWeight: 700,
                  backdropFilter: "blur(8px)", transition: "background 0.2s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.3)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.15)"}
              >
                ‹
              </div>
            )}
            {/* Right Arrow */}
            {canNext && (
              <div
                onClick={(e) => { e.stopPropagation(); setRecreateLightboxUrl(allLightboxImages[currentIdx + 1].url); }}
                style={{
                  position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)",
                  width: 48, height: 48, borderRadius: "50%", background: "rgba(255,255,255,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "#fff", fontSize: 24, fontWeight: 700,
                  backdropFilter: "blur(8px)", transition: "background 0.2s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.3)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.15)"}
              >
                ›
              </div>
            )}
            <img
              onClick={(e) => e.stopPropagation()}
              src={recreateLightboxUrl}
              alt="Full-size view"
              style={{ maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain", borderRadius: 8, cursor: "default" }}
            />
            {/* View label */}
            {currentIdx >= 0 && (
              <div style={{
                position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)",
                color: "#fff", fontSize: 14, fontWeight: 600, padding: "6px 16px",
                background: "rgba(0,0,0,0.6)", borderRadius: 8, backdropFilter: "blur(8px)",
              }}>
                {viewLabel(allLightboxImages[currentIdx].type)} - {currentIdx + 1} of {allLightboxImages.length}
              </div>
            )}
            <div
              onClick={(e) => { e.stopPropagation(); setRecreateLightboxUrl(null); }}
              style={{
                position: "absolute", top: 16, right: 24,
                color: "#fff", fontSize: 28, fontWeight: 300, cursor: "pointer",
                textShadow: "0 2px 8px rgba(0,0,0,0.5)",
              }}
            >
              ✕
            </div>
          </div>
        );
      })()}

      {/* ── ProductionPackDialog for inline RecreatePro ── */}
      <ProductionPackDialog
        open={showRecreateProductionDialog}
        onOpenChange={setShowRecreateProductionDialog}
        render={recreateRenderUrl ? {
          // PIPELINE KEY (2026-07-25 fix): the paid pack (useQuickProductionPack)
          // resolves the entice VAULT + 2D proof by querying color_visualizations
          // WHERE id = render.id, then hops to the canonical designiq id via
          // admin_notes.designiq_generation_id. The recreate entice assets — the
          // 2D proof (saveProofUrlToViz) and the per-side panels (buildProductionPanels
          // gid → production_flow_assets.job_id) — are ALL keyed by the
          // color_visualizations id (recreateVisualizationId). Passing the designiq
          // id here made that lookup miss, so the purchase could NOT reuse the entice
          // panels shown in RevisionStudio (it rebuilt them under a different key, or
          // failed the proof lookup) — breaking "auto-run Railway on the SAME entice
          // panels → upscale → hi-res in PanelPro Studio". Pass the vizId first (same
          // convention RevisionStudio uses) so the vault is found and activate-print-
          // worker upscales the exact entice panels. Fall back to the designiq id only
          // if the row insert hasn't landed yet.
          id: recreateVisualizationId || recreateVisualizationIdRef.current || recreateGenerationId || crypto.randomUUID(),
          render_urls: {
            side: recreateRenderUrl,
            ...Object.fromEntries(recreateAllViews.filter(v => v.url).map(v => [v.type, v.url])),
          },
          vehicle_year: recreateYear || "2024",
          vehicle_make: recreateMake,
          vehicle_model: recreateModel,
          design_file_name: "RecreatePro Recreation",
          finish_type: "Gloss",
          custom_design_url: recreateStoredUrl || undefined,
          reference_image_urls: recreateStoredUrls,
          source_type: "recreatepro",
        } : null}
      />

      {/* ── Scoped Styles ─────────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800&display=swap');
        @keyframes pf-pulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(99,102,241,0.2); }
          50% { box-shadow: 0 0 0 8px rgba(99,102,241,0.1); }
        }
        @keyframes pf-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 16px rgba(99, 102, 241, 0.5), 0 0 32px rgba(99, 102, 241, 0.25); }
          50% { box-shadow: 0 0 24px rgba(99, 102, 241, 0.7), 0 0 48px rgba(99, 102, 241, 0.35); }
        }
        @keyframes pipelineNodeGlow {
          0%, 100% { box-shadow: 0 0 8px rgba(0, 100, 200, 0.4), 0 0 16px rgba(0, 80, 180, 0.15); }
          50% { box-shadow: 0 0 14px rgba(0, 120, 220, 0.7), 0 0 28px rgba(0, 100, 200, 0.3); }
        }

        /* ═══ MOBILE RESPONSIVE - Pipeline Stepper ═══ */
        .pf-stepper-wrap { padding: 14px 20px; }
        .pf-stepper-inner { display: flex; align-items: center; gap: 0; }
        .pf-stepper-item { display: flex; align-items: center; flex: 1; min-width: 0; }
        .pf-stepper-circle { width: 28px; height: 28px; font-size: 13px; }
        .pf-stepper-label-full { font-size: 9px; display: block; }
        .pf-stepper-label-short { font-size: 8px; display: none; }
        .pf-stepper-connector { height: 2px; flex: 0 0 12px; margin-bottom: 16px; }

        /* ═══ MOBILE RESPONSIVE - Panelizer Header ═══ */
        .pf-panelizer-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 12px; gap: 8px;
        }
        .pf-panelizer-title {
          font-size: 10px; font-weight: 800; color: #0090dd; letter-spacing: 1.5px;
          text-transform: uppercase; font-family: Inter, sans-serif;
          text-shadow: 0 0 8px rgba(0, 100, 200, 0.5);
        }
        .pf-panelizer-tagline {
          font-size: 8px; font-weight: 700; letter-spacing: 1.2px; color: rgba(0, 100, 180, 0.5);
          text-transform: uppercase; font-family: Inter, sans-serif; white-space: nowrap; flex-shrink: 0;
        }

        /* ═══ MOBILE RESPONSIVE - Hero Nav Buttons ═══ */
        .pf-hero-nav-btn { width: 44px; height: 44px; font-size: 18px; }

        /* ═══ MOBILE RESPONSIVE - Thumbnails ═══ */
        .pf-thumb-btn { width: 90px; }

        /* ═══ MOBILE RESPONSIVE - GlassmorphismPanelOverlay ═══ */
        .gpo-badge { padding: 6px 16px 8px; }
        .gpo-badge-title { font-size: 10px; letter-spacing: 1.2px; }
        .gpo-badge-tagline { font-size: 9px; letter-spacing: 1.5px; }
        .gpo-badge-sqft { font-size: 9px; }
        .gpo-panel-label { font-size: 13px; padding: 4px 12px; }
        .gpo-panel-dims { font-size: 12px; padding: 3px 12px; }
        .gpo-dim-edge { font-size: 12px; }
        .gpo-section-label { font-size: 10px; padding: 3px 10px; }

        @media (max-width: 640px) {
          /* Stepper: shrink circles, use short labels */
          .pf-stepper-wrap { padding: 10px 8px; }
          .pf-stepper-circle { width: 22px; height: 22px; font-size: 10px; }
          .pf-stepper-label-full { display: none; }
          .pf-stepper-label-short { display: block; font-size: 7px; }
          .pf-stepper-connector { flex: 0 0 6px; margin-bottom: 12px; }

          /* Panelizer header: stack vertically */
          .pf-panelizer-header { flex-direction: column; align-items: flex-start; gap: 2px; margin-bottom: 8px; }
          .pf-panelizer-title { font-size: 9px; letter-spacing: 1px; }
          .pf-panelizer-tagline { font-size: 7px; letter-spacing: 0.8px; }

          /* Nav buttons: smaller on mobile */
          .pf-hero-nav-btn { width: 32px; height: 32px; font-size: 14px; }

          /* Thumbnails: smaller on mobile */
          .pf-thumb-btn { width: 64px; }

          /* GlassmorphismPanelOverlay: scale down everything */
          .gpo-badge { padding: 4px 8px 5px; border-radius: 6px; }
          .gpo-badge-title { font-size: 7px; letter-spacing: 0.8px; }
          .gpo-badge-tagline { font-size: 6px; letter-spacing: 0.8px; }
          .gpo-badge-sqft { font-size: 7px; }
          .gpo-panel-label { font-size: 9px; padding: 2px 6px; letter-spacing: 0.8px; }
          .gpo-panel-dims { font-size: 8px; padding: 2px 6px; }
          .gpo-dim-edge { font-size: 8px; padding: 0 4px; }
          .gpo-section-label { font-size: 7px; padding: 2px 5px; }
        }

        @media (max-width: 400px) {
          .pf-stepper-circle { width: 18px; height: 18px; font-size: 8px; }
          .pf-stepper-label-short { font-size: 6px; }
          .pf-stepper-connector { flex: 0 0 4px; margin-bottom: 10px; }
          .pf-hero-nav-btn { width: 28px; height: 28px; font-size: 12px; }
          .pf-thumb-btn { width: 52px; }
          .gpo-badge { padding: 3px 6px 4px; }
          .gpo-badge-title { font-size: 6px; }
          .gpo-badge-tagline { display: none; }
          .gpo-panel-label { font-size: 8px; padding: 1px 4px; }
          .gpo-panel-dims { font-size: 7px; padding: 1px 4px; }
          .gpo-dim-edge { font-size: 7px; }
        }
      `}</style>
      {extractModal && (
        <ExtractElementsModal
          fileUrl={extractModal.url}
          fileName={extractModal.name}
          onClose={() => setExtractModal(null)}
        />
      )}
    </div>
  );
}
