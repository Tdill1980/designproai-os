import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileImage,
  Layers3,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import {
  ApprovedGenerationView,
  dpApi,
  PRODUCTION_SURFACES,
  RENDER_ROLES,
  RenderRole,
  SOURCE_VIEW_TYPE_FOR_ROLE,
  SURFACE_LABEL,
  WorkflowArtifact,
  WorkflowStatus,
} from "@/lib/designpro-api";
import { selectCustomerProof } from "@/lib/designpro-artifact-selectors";
import type { ProductionLayersSource } from "@/lib/designpro-production-layers";
import { ProductionFlowLayersCard } from "@/components/revisioniq/ProductionFlowLayersCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ContentHash, Notice, SaveLink } from "@/components/designpro/surface";
import { cn } from "@/lib/utils";

type StudioMode = "approved" | "proof" | "layers";

const ROLE_ORDER: RenderRole[] = [...RENDER_ROLES];

function valueNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatInches(value: unknown): string {
  const number = valueNumber(value);
  return number == null ? "—" : `${Math.round(number * 100) / 100}″`;
}

function filenameFor(url: string, fallback: string): string {
  try {
    const name = new URL(url).pathname.split("/").pop();
    return name || fallback;
  } catch {
    return fallback;
  }
}

export function ServerRevisionStudio({
  generationId,
  job,
  artifacts,
  artifactsLoading,
  layersSource,
}: {
  generationId: string;
  // The studio survives a job that is not reporting yet: the seven frozen
  // approved views are owned by the generation, not by the production run, and
  // hiding them behind a missing run is what made RevisionStudio look absent.
  job?: WorkflowStatus;
  artifacts: WorkflowArtifact[];
  artifactsLoading: boolean;
  layersSource: ProductionLayersSource | null;
}) {
  const [views, setViews] = useState<ApprovedGenerationView[]>([]);
  const [viewsLoading, setViewsLoading] = useState(true);
  const [viewsError, setViewsError] = useState("");
  const [selectedRole, setSelectedRole] = useState<RenderRole>("driver");
  const [mode, setMode] = useState<StudioMode>("approved");
  const [zoom, setZoom] = useState(100);
  const [revisionInstruction, setRevisionInstruction] = useState("");

  useEffect(() => {
    let live = true;
    setViewsLoading(true);
    dpApi
      .listApprovedViews(generationId)
      .then((rows) => {
        if (!live) return;
        setViews(rows);
        setViewsError("");
      })
      .catch(() => {
        if (live) setViewsError("The seven frozen approved views could not be loaded.");
      })
      .finally(() => {
        if (live) setViewsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [generationId]);

  const viewForRole = useMemo(() => {
    const rows = new Map<RenderRole, ApprovedGenerationView>();
    for (const role of ROLE_ORDER) {
      const sourceType = SOURCE_VIEW_TYPE_FOR_ROLE[role];
      const row = views.find(
        (candidate) =>
          candidate.sourceViewType === sourceType || candidate.surfaceKey === role,
      );
      if (row) rows.set(role, row);
    }
    return rows;
  }, [views]);

  const panels = useMemo(() => {
    const rows = new Map<string, WorkflowArtifact>();
    for (const artifact of artifacts) {
      if (artifact.kind === "panel" && PRODUCTION_SURFACES.includes(artifact.surfaceKey as never)) {
        if (!rows.has(artifact.surfaceKey)) rows.set(artifact.surfaceKey, artifact);
      }
    }
    return rows;
  }, [artifacts]);

  let proof: WorkflowArtifact | null = null;
  let proofConflict = "";
  try {
    proof = selectCustomerProof(artifacts);
  } catch (error) {
    proofConflict = error instanceof Error ? error.message : String(error);
  }

  const layout = artifacts.find(
    (artifact) => artifact.kind === "flat-proof" && artifact.surfaceKey === "flat-wrap-layout",
  );
  const logoArtifacts = artifacts.filter((artifact) => artifact.kind === "logo");
  const selectedView = viewForRole.get(selectedRole) || null;
  const selectedPanel = panels.get(selectedRole) || null;
  const stageUrl = mode === "proof" ? proof?.signedUrl : selectedView?.signedUrl;
  const stageLabel = mode === "proof" ? "2D Production Proof" : SURFACE_LABEL[selectedRole];
  const revisionUrl = `/designpro/revisions/new?source=${encodeURIComponent(generationId)}&instruction=${encodeURIComponent(revisionInstruction.trim())}&surface=${encodeURIComponent(selectedRole)}`;
  const verifiedCount = viewForRole.size;

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-500/30 bg-[#07090d] text-zinc-100 shadow-[0_0_45px_rgba(6,182,212,0.08)]">
      <header className="flex flex-col gap-4 border-b border-zinc-800 bg-gradient-to-r from-zinc-950 via-[#0b1118] to-zinc-950 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-400">
              RevisionStudioIQ™
            </span>
            <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/10">
              <ShieldCheck className="mr-1 h-3 w-3" /> Server verified
            </Badge>
          </div>
          <h2 className="mt-1 truncate text-xl font-black tracking-tight md:text-2xl">
            {job?.designId || "Design not yet in production"}
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            {job
              ? `Order ${job.orderNumber} · Revision ${job.revision} · one frozen source set`
              : "No production run is reporting yet · the approved views below are the frozen Calls 1–7 set"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-300">
            {verifiedCount}/7 approved views
          </span>
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-300">
            {panels.size}/6 panels
          </span>
          {proof && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-emerald-300">
              Proof ready
            </span>
          )}
        </div>
      </header>

      {viewsError && <div className="p-4"><Notice tone="error">{viewsError}</Notice></div>}
      {proofConflict && (
        <div className="p-4">
          <Notice tone="error">The server published conflicting customer proofs: {proofConflict}</Notice>
        </div>
      )}

      <Tabs value={mode} onValueChange={(value) => setMode(value as StudioMode)}>
        <div className="border-b border-zinc-800 px-4 py-3 md:px-6">
          <TabsList className="grid h-auto w-full grid-cols-3 bg-zinc-900 md:w-[560px]">
            <TabsTrigger value="approved" className="gap-2 py-2.5 data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-300">
              <FileImage className="h-4 w-4" /> 3D proof
            </TabsTrigger>
            <TabsTrigger value="proof" className="gap-2 py-2.5 data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-300">
              <Maximize2 className="h-4 w-4" /> 2D proof
            </TabsTrigger>
            <TabsTrigger value="layers" className="gap-2 py-2.5 data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-300">
              <Layers3 className="h-4 w-4" /> Layers
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="layers" className="m-0 p-4 md:p-6">
          {layersSource ? (
            <ProductionFlowLayersCard
              generationId={generationId}
              source={layersSource}
              className="border-zinc-700 bg-zinc-950"
            />
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">
              Production Layers will open here when the server has verified the complete six-panel set.
            </div>
          )}
        </TabsContent>

        <TabsContent value="approved" className="m-0">
          <StudioWorkspace
            selectedRole={selectedRole}
            setSelectedRole={setSelectedRole}
            viewForRole={viewForRole}
            selectedView={selectedView}
            selectedPanel={selectedPanel}
            stageUrl={stageUrl || ""}
            stageLabel={stageLabel}
            zoom={zoom}
            setZoom={setZoom}
            loading={viewsLoading || artifactsLoading}
            layout={layout}
            proof={proof}
            revisionInstruction={revisionInstruction}
            setRevisionInstruction={setRevisionInstruction}
            revisionUrl={revisionUrl}
            logoArtifacts={logoArtifacts}
            generationId={generationId}
          />
        </TabsContent>

        <TabsContent value="proof" className="m-0">
          <StudioWorkspace
            selectedRole={selectedRole}
            setSelectedRole={setSelectedRole}
            viewForRole={viewForRole}
            selectedView={selectedView}
            selectedPanel={selectedPanel}
            stageUrl={stageUrl || ""}
            stageLabel={stageLabel}
            zoom={zoom}
            setZoom={setZoom}
            loading={artifactsLoading}
            layout={layout}
            proof={proof}
            revisionInstruction={revisionInstruction}
            setRevisionInstruction={setRevisionInstruction}
            revisionUrl={revisionUrl}
            logoArtifacts={logoArtifacts}
            generationId={generationId}
            proofMode
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function StudioWorkspace({
  selectedRole,
  setSelectedRole,
  viewForRole,
  selectedView,
  selectedPanel,
  stageUrl,
  stageLabel,
  zoom,
  setZoom,
  loading,
  layout,
  proof,
  revisionInstruction,
  setRevisionInstruction,
  revisionUrl,
  logoArtifacts,
  generationId,
  proofMode = false,
}: {
  selectedRole: RenderRole;
  setSelectedRole: (role: RenderRole) => void;
  viewForRole: Map<RenderRole, ApprovedGenerationView>;
  selectedView: ApprovedGenerationView | null;
  selectedPanel: WorkflowArtifact | null;
  stageUrl: string;
  stageLabel: string;
  zoom: number;
  setZoom: (value: number) => void;
  loading: boolean;
  layout?: WorkflowArtifact;
  proof: WorkflowArtifact | null;
  revisionInstruction: string;
  setRevisionInstruction: (value: string) => void;
  revisionUrl: string;
  logoArtifacts: WorkflowArtifact[];
  generationId: string;
  proofMode?: boolean;
}) {
  const downloadable = proofMode ? proof : selectedView;
  const hash = downloadable?.contentHash || "";

  return (
    <div className="grid min-h-[720px] xl:grid-cols-[190px_minmax(0,1fr)_310px]">
      <aside className="border-b border-zinc-800 bg-zinc-950/70 p-3 xl:border-b-0 xl:border-r">
        <div className="mb-3 px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
          Approved views
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 xl:grid-cols-1">
          {ROLE_ORDER.map((role) => {
            const view = viewForRole.get(role);
            return (
              <button
                key={role}
                type="button"
                onClick={() => setSelectedRole(role)}
                className={cn(
                  "group overflow-hidden rounded-lg border bg-zinc-900 text-left transition",
                  selectedRole === role
                    ? "border-cyan-400 ring-1 ring-cyan-400/40"
                    : "border-zinc-800 hover:border-zinc-600",
                )}
              >
                <div className="aspect-[16/10] bg-black">
                  {view ? (
                    <img src={view.signedUrl} alt={SURFACE_LABEL[role]} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-zinc-700">
                      <FileImage className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  {view && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />}
                  <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-zinc-300">
                    {SURFACE_LABEL[role]}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex min-w-0 flex-col bg-[#090c11]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2.5">
          <div>
            <div className="text-sm font-bold text-white">{stageLabel}</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              {proofMode ? "Call 8 customer proof" : "Frozen approved render"}
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            <button type="button" onClick={() => setZoom(Math.max(50, zoom - 25))} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
            <button type="button" onClick={() => setZoom(100)} className="min-w-14 rounded px-2 py-1 text-xs font-semibold text-zinc-300 hover:bg-zinc-800">{zoom}%</button>
            <button type="button" onClick={() => setZoom(Math.min(200, zoom + 25))} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
            <button type="button" onClick={() => setZoom(100)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="Reset zoom"><RotateCcw className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="relative flex min-h-[430px] flex-1 items-center justify-center overflow-auto bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.06),transparent_55%)] p-4 md:p-8">
          {loading && !stageUrl ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading verified studio assets…</div>
          ) : stageUrl ? (
            <img
              src={stageUrl}
              alt={stageLabel}
              style={{ width: `${zoom}%` }}
              className="max-w-none rounded-lg border border-zinc-700 bg-white object-contain shadow-2xl transition-[width]"
            />
          ) : (
            <div className="max-w-md rounded-xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500">
              {proofMode ? "The 2D Production Proof has not been published yet." : "This approved view is not available."}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-950/70 px-4 py-3">
          <div className="min-w-0">
            {hash ? <ContentHash value={hash} chars={18} /> : <span className="text-xs text-zinc-500">Awaiting immutable hash</span>}
          </div>
          {stageUrl && (
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">
                <a href={stageUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Full size</a>
              </Button>
              <Button asChild size="sm" className="bg-cyan-500 text-black hover:bg-cyan-400">
                <a href={`${stageUrl}${stageUrl.includes("?") ? "&" : "?"}download`} download={filenameFor(stageUrl, `${selectedRole}.png`)}><Download className="mr-1.5 h-3.5 w-3.5" /> Download</a>
              </Button>
            </div>
          )}
        </div>
      </main>

      <aside className="border-t border-zinc-800 bg-zinc-950 p-4 xl:border-l xl:border-t-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-400">Inspector</div>
        <h3 className="mt-1 text-lg font-bold">{proofMode ? "Proof set" : SURFACE_LABEL[selectedRole]}</h3>

        {!proofMode && (
          <div className="mt-4 space-y-3">
            <InspectorRow label="Approved render" value={selectedView ? "Verified" : "Pending"} good={Boolean(selectedView)} />
            <InspectorRow label="Production panel" value={selectedPanel ? "Cut" : "Pending"} good={Boolean(selectedPanel)} />
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Trim width" value={formatInches(selectedPanel?.metadata.trimWidthInches)} />
              <Metric label="Trim height" value={formatInches(selectedPanel?.metadata.trimHeightInches)} />
              <Metric label="Print width" value={formatInches(selectedPanel?.metadata.printWidthInches)} />
              <Metric label="Print height" value={formatInches(selectedPanel?.metadata.printHeightInches)} />
            </div>
            {selectedPanel && (
              <div className="overflow-hidden rounded-lg border border-cyan-500/25 bg-zinc-900/70">
                <a href={selectedPanel.signedUrl} target="_blank" rel="noreferrer" className="block bg-black">
                  <img
                    src={selectedPanel.signedUrl}
                    alt={`${SURFACE_LABEL[selectedRole]} production panel`}
                    className="aspect-video w-full object-contain"
                  />
                </a>
                <div className="p-3">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Panel identity</div>
                <div className="mt-1"><ContentHash value={selectedPanel.contentHash} chars={14} /></div>
                <div className="mt-2"><SaveLink url={selectedPanel.signedUrl} name={`${selectedRole}-panel.png`} /></div>
                </div>
              </div>
            )}
            <Button asChild variant="outline" className="w-full border-cyan-500/30 bg-cyan-500/5 text-cyan-200 hover:bg-cyan-500/10">
              {/* /panel-studio routes to DesignProStudio, a different page. The
                  PanelPro Studio board -- per-side proof beside print panel, the
                  A.T.L.A.S. master and its version history, both QC gates -- is
                  /panelpro. This button sent the design team to the wrong page. */}
              <Link to={`/designpro/jobs/${generationId}/panelpro`}>Open in PanelProStudio</Link>
            </Button>
          </div>
        )}

        {proofMode && (
          <div className="mt-4 space-y-3">
            <InspectorRow label="Customer proof" value={proof ? "Published" : "Pending"} good={Boolean(proof)} />
            <InspectorRow label="Flat layout" value={layout ? "Bound" : "Pending"} good={Boolean(layout)} />
            {proof && <Metric label="Total coverage" value={valueNumber(proof.metadata.totalSqFt)?.toFixed(2).concat(" sq ft") || "—"} />}
            {layout && <SaveLink url={layout.signedUrl} name="approved-flat-wrap-layout.png" />}
          </div>
        )}

        <div className="mt-6 border-t border-zinc-800 pt-5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-fuchsia-400">Entice logo assets</div>
            <span className="text-[10px] text-zinc-500">{logoArtifacts.length} extracted</span>
          </div>
          {logoArtifacts.length ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {logoArtifacts.map((logo, index) => (
                <a
                  key={logo.id}
                  href={logo.signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="group overflow-hidden rounded-lg border border-fuchsia-500/25 bg-[linear-gradient(45deg,#18181b_25%,transparent_25%),linear-gradient(-45deg,#18181b_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#18181b_75%),linear-gradient(-45deg,transparent_75%,#18181b_75%)] bg-[length:12px_12px] hover:border-fuchsia-400"
                  title={String(logo.metadata.displayName || logo.metadata.identityKey || `Logo ${index + 1}`)}
                >
                  <img src={logo.signedUrl} alt={`Extracted logo ${index + 1}`} className="aspect-square w-full object-contain p-1" />
                  <div className="truncate border-t border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[9px] text-zinc-400 group-hover:text-fuchsia-300">
                    {String(logo.metadata.displayName || logo.metadata.identityKey || `Logo ${index + 1}`)}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-[10px] leading-4 text-zinc-500">
              No separated logo assets were published for this proof set. The branded production panel remains available above.
            </p>
          )}
        </div>

        <div className="mt-6 border-t border-zinc-800 pt-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-fuchsia-400">Request revision</div>
          <p className="mt-2 text-xs leading-5 text-zinc-400">
            Describe the exact change. A revision creates a new immutable seven-view source; it never overwrites this approved set.
          </p>
          <Textarea
            value={revisionInstruction}
            onChange={(event) => setRevisionInstruction(event.target.value)}
            rows={5}
            maxLength={2000}
            className="mt-3 border-zinc-700 bg-zinc-900 text-zinc-100 placeholder:text-zinc-600"
            placeholder={`Example: On the ${SURFACE_LABEL[selectedRole].toLowerCase()}, move the phone number above the rear wheel and preserve all approved text exactly.`}
          />
          <Button asChild className="mt-3 w-full bg-gradient-to-r from-blue-600 to-fuchsia-600 text-white">
            <Link to={revisionUrl}>Create new revision source</Link>
          </Button>
          <p className="mt-2 text-[10px] leading-4 text-zinc-600">
            This control does not rerun production or mutate approved files.
          </p>
        </div>
      </aside>
    </div>
  );
}

function InspectorRow({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2.5 text-xs">
      <span className="text-zinc-400">{label}</span>
      <span className={cn("font-semibold", good ? "text-emerald-300" : "text-amber-300")}>{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-bold text-zinc-200">{value}</div>
    </div>
  );
}
