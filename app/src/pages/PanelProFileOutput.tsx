import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileImage,
  Layers3,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dpApi, type DesignLibraryEntry } from "@/lib/designpro-api";
import {
  PANEL_OUTPUT_REVIEW_CHECKS,
  PANEL_OUTPUT_SOURCE_APPS,
  PanelOutputApiError,
  panelOutputApi,
  panelOutputHref,
  panelOutputIdentityFromSearch,
  withTemplateVehicleReview,
  type PanelOutputReviewChecks,
  type PanelOutputRun,
  type PanelOutputSourceApp,
} from "@/lib/panelpro-file-output-api";
import {
  panelOutputBlockerCopy,
  panelOutputPreviews,
  panelOutputProgress,
  panelOutputSafeReviewUrl,
  panelOutputRevisionHref,
  panelOutputStageCopy,
  panelOutputStageState,
} from "@/lib/panelpro-file-output-view.mjs";

const CODE = (value: string | { code: string }) =>
  typeof value === "string" ? value : value.code;
const inches = (value: unknown) =>
  Number.isFinite(Number(value)) && Number(value) > 0
    ? `${Number(value).toFixed(2).replace(/\.00$/, "")}″`
    : "Awaiting dimensions";

function BlockedNotice({ codes }: { codes: string[] }) {
  if (!codes.length) return null;
  return (
    <div
      role="status"
      className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-amber-100"
    >
      <div className="flex items-center gap-2 font-semibold">
        <AlertCircle className="h-4 w-4" /> Designer attention needed
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {[...new Set(codes.map(panelOutputBlockerCopy))].map((copy) => (
          <li key={copy}>{copy}</li>
        ))}
      </ul>
    </div>
  );
}

export function PanelOutputRunView({
  run,
  onReviewed,
  productionRunId,
}: {
  run: PanelOutputRun;
  onReviewed?: () => void;
  productionRunId?: string;
}) {
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState("");
  const stages = run.stages || [];
  const previews = panelOutputPreviews(run.previews || []);
  const progress = panelOutputProgress(stages);
  const reviewUrl = panelOutputSafeReviewUrl(
    run.humanReviewUrl,
    run.generationId,
  );
  const active = stages.find((stage) =>
    ["running", "leased", "waiting", "blocked", "retryable", "failed"].includes(
      stage.state,
    ),
  );
  const wrapboxUrl =
    run.wrapboxUrl?.startsWith("/designpro/wrapbox/") &&
    !run.wrapboxUrl.includes("?")
      ? run.wrapboxUrl
      : null;
  return (
    <div className="space-y-5">
      {run.status === "failed" && <div className="space-y-3 rounded-xl border border-amber-400/30 p-4">
        <p className="text-sm text-amber-100">A step could not finish. Eligible temporary failures can resume from their saved work; input corrections remain with the design team.</p>
        <Button variant="outline" disabled={resuming} onClick={async () => {
          setResuming(true); setResumeError("");
          try {
            const result = await panelOutputApi.resume(run.id);
            if (result.resumed !== true) throw new Error("Resume was not confirmed");
            onReviewed?.();
          } catch (issue) { setResumeError(issue instanceof PanelOutputApiError ? panelOutputBlockerCopy(issue.code) : "The restart was not confirmed. Refresh the saved run before retrying."); }
          finally { setResuming(false); }
        }}>{resuming ? "Requesting resume…" : "Resume eligible failed steps"}</Button>
        {resumeError && <p role="alert" className="text-sm text-amber-100">{resumeError}</p>}
      </div>}
      <div className="rounded-2xl border border-cyan-400/20 bg-slate-950 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">
              {run.sourceApp}
            </p>
            <h2 className="mt-1 text-xl font-bold">
              {run.designId || run.sourceJobId}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {run.orderId ? `Order ${run.orderId} · ` : ""}
              {run.revisionId ? "Saved revision" : "Saved artwork"} ·{" "}
              {panelOutputStageState(run.status)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {run.generationId && (
              <Button variant="outline" asChild>
                <Link
                  to={`/revision-studio?generationId=${encodeURIComponent(run.generationId)}`}
                >
                  RevisionStudioIQ
                </Link>
              </Button>
            )}
            {reviewUrl && (
              <Button variant="outline" asChild>
                <Link to={reviewUrl}>Open PanelPro Studio</Link>
              </Button>
            )}
            {wrapboxUrl && (
              <Button asChild>
                <Link to={wrapboxUrl}>
                  Open WrapBox <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
        <div aria-live="polite" className="mt-5 text-sm text-slate-200">
          {active
            ? ["waiting", "blocked", "failed"].includes(active.state)
              ? `${panelOutputStageState(active.state)} · ${panelOutputStageCopy(active.key)[0]}`
              : panelOutputStageCopy(active.key)[1]
            : progress.total && progress.complete === progress.total
              ? "All reported preparation steps are complete. Approval and delivery are shown in their own recorded stages."
              : "Waiting for the server to report the next step."}
        </div>
        {progress.percent !== null && (
          <>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800"
              role="progressbar"
              aria-label="Reported production steps"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.complete}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-[width]"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {progress.complete} of {progress.total} reported steps complete
            </p>
          </>
        )}
      </div>
      <BlockedNotice codes={(run.blockers || []).map(CODE)} />
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <h3 className="text-sm font-semibold">What is being created</h3>
          {stages.length ? (
            <ol className="mt-4 space-y-4">
              {stages.map((stage) => {
                const [title] = panelOutputStageCopy(stage.key);
                const complete = [
                  "complete",
                  "completed",
                  "succeeded",
                ].includes(stage.state);
                return (
                  <li key={stage.key} className="flex gap-3">
                    {complete ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    ) : ["running", "leased"].includes(stage.state) ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-cyan-400" />
                    ) : (
                      <div className="mt-1 h-3 w-3 shrink-0 rounded-full border border-slate-600" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{title}</p>
                      <p className="text-xs text-slate-400">
                        {panelOutputStageState(stage.state)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-slate-400">
              No execution steps have been recorded yet.
            </p>
          )}
        </aside>
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <h3 className="text-sm font-semibold">Template and artwork</h3>
            <p className="mt-1 text-xs text-slate-400">
              See the template, artwork placement and installation cuts as each
              verified preview is saved. Cut areas remain covered with
              background artwork in the print file.
            </p>
            {previews.length ? (
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {previews.map((preview) => (
                  <figure
                    key={preview.id}
                    className="overflow-hidden rounded-xl border border-slate-800"
                  >
                    <a
                      href={preview.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={preview.signedUrl}
                        alt={`${preview.label}${preview.pieceId ? ` · ${preview.pieceId}` : ""}`}
                        className="max-h-96 w-full bg-slate-900 object-contain"
                        loading="lazy"
                      />
                    </a>
                    <figcaption className="p-3 text-sm">
                      {preview.label}
                      {preview.pieceId ? ` · ${preview.pieceId}` : ""}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
                <FileImage className="mx-auto mb-3 h-8 w-8 text-slate-600" />
                Verified template and artwork previews will appear here.
              </div>
            )}
          </section>
          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <h3 className="text-sm font-semibold">Physical print panels</h3>
            {(run.pieces || []).length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-400">
                      <th className="pb-3 pr-3">Panel</th>
                      <th className="pb-3 pr-3">Trim</th>
                      <th className="pb-3 pr-3">Print with bleed</th>
                      <th className="pb-3 pr-3">Full-size PPI</th>
                      <th className="pb-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.pieces.map((piece) => (
                      <tr
                        key={piece.id}
                        className="border-b border-slate-800/70 align-top"
                      >
                        <td className="py-3 pr-3 font-medium">
                          {piece.label || piece.id}
                        </td>
                        <td className="py-3 pr-3">
                          {inches(piece.trimWidthIn)} ×{" "}
                          {inches(piece.trimHeightIn)}
                        </td>
                        <td className="py-3 pr-3">
                          {inches(piece.printWidthIn)} ×{" "}
                          {inches(piece.printHeightIn)}
                          <div className="mt-1 text-xs text-slate-400">
                            {piece.bleedInches
                              ? `${inches(piece.bleedInches)} each outside edge`
                              : "Bleed check pending"}
                          </div>
                        </td>
                        <td className="py-3 pr-3">
                          {piece.ppi
                            ? `${piece.ppi} ${["complete", "completed", "succeeded"].includes(piece.state) ? "output" : "target"}`
                            : "Pending"}
                        </td>
                        <td className="py-3">
                          {panelOutputStageState(piece.state)}
                          {(piece.blockers || []).map(CODE).map((code) => (
                            <p
                              key={code}
                              className="mt-1 text-xs text-amber-200"
                            >
                              {panelOutputBlockerCopy(code)}
                            </p>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">
                The physical panel list appears after the template and artwork
                have been verified.
              </p>
            )}
          </section>
        </div>
      </div>
      {run.canReview === true && (
        <PanelOutputHumanReview
          key={`${run.id}:${run.artifactSetHash || "pending"}`}
          run={run}
          onReviewed={onReviewed}
        />
      )}
      {run.canReview === true &&
        run.status === "completed" &&
        run.sourceApp === "DesignPro" && (
          <PanelOutputAttach run={run} productionRunId={productionRunId} />
        )}
      {run.canReview === true &&
        run.status !== "completed" &&
        run.sourceApp === "DesignPro" && (
          <PanelOutputProductionReservation productionRunId={productionRunId} />
        )}
    </div>
  );
}

function PanelOutputAttach({
  run,
  productionRunId: initialRunId = "",
}: {
  run: PanelOutputRun;
  productionRunId?: string;
}) {
  const [productionRunId, setProductionRunId] = useState(initialRunId);
  const [busy, setBusy] = useState(false);
  const [attached, setAttached] = useState(false);
  const [error, setError] = useState("");
  const [continuationHref, setContinuationHref] = useState<string | null>(null);
  const valid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      productionRunId.trim(),
    );
  const attach = async () => {
    if (!valid || busy || attached) return;
    setBusy(true);
    setError("");
    setContinuationHref(null);
    try {
      const parentId = productionRunId.trim().toLowerCase();
      const result = await panelOutputApi.attach(run.id, parentId);
      if (result.attached !== true || result.productionRunId !== parentId)
        throw new Error("Attachment not recorded");
      setAttached(true);
    } catch (issue) {
      if (issue instanceof PanelOutputApiError) setContinuationHref(panelOutputRevisionHref(issue.continuation, run.generationId, run.id, run.atlasRevisionId));
      setError(
        issue instanceof PanelOutputApiError
          ? panelOutputBlockerCopy(issue.code)
          : "The package was not attached. Check the selected production run and refresh its review state.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-cyan-400/30 bg-slate-950 p-5">
      <h3 className="text-lg font-semibold">Include with production review</h3>
      <p className="text-sm text-slate-400">
        Add this reviewed physical panel package to the existing production run.
        Its final proof review and delivery checks still apply.
      </p>
      <label className="block text-sm">
        Existing production run ID
        <Input
          className="mt-2 border-slate-700"
          value={productionRunId}
          onChange={(event) => setProductionRunId(event.target.value)}
          disabled={busy || attached}
          placeholder="Production run ID from the saved job"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
      {continuationHref && <Button asChild variant="outline"><Link to={continuationHref}>Continue mapped revision in RevisionStudioIQ</Link></Button>}
      {attached ? (
        <p role="status" className="text-sm text-emerald-300">
          Physical panel package included with this production review.
        </p>
      ) : (
        <Button disabled={!valid || busy} onClick={() => void attach()}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Include
          with production review
        </Button>
      )}
    </section>
  );
}

function PanelOutputProductionReservation({
  productionRunId: initialRunId = "",
}: {
  productionRunId?: string;
}) {
  const [productionRunId, setProductionRunId] = useState(initialRunId);
  const [busy, setBusy] = useState(false);
  const [reserved, setReserved] = useState(false);
  const [error, setError] = useState("");
  const valid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      productionRunId.trim(),
    );
  const reserve = async () => {
    if (!valid || busy || reserved) return;
    setBusy(true);
    setError("");
    try {
      const parentId = productionRunId.trim().toLowerCase();
      const result = await panelOutputApi.reserve(parentId);
      if (result.reserved !== true || result.productionRunId !== parentId)
        throw new Error("Reservation not recorded");
      setReserved(true);
    } catch (issue) {
      setError(
        issue instanceof PanelOutputApiError
          ? panelOutputBlockerCopy(issue.code)
          : "The production wait was not recorded. Check the selected run and your design-team access.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-cyan-400/30 bg-slate-950 p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">
        Internal design team · Optional
      </p>
      <h3 className="text-lg font-semibold">Wait for PanelProFileOutput</h3>
      <p className="text-sm text-slate-400">
        Pause this DesignPro production run at file verification until its
        reviewed physical panel package is attached.
      </p>
      <label className="block text-sm">
        Existing production run ID
        <Input
          className="mt-2 border-slate-700"
          value={productionRunId}
          onChange={(event) => setProductionRunId(event.target.value)}
          disabled={busy || reserved}
          placeholder="Production run ID from the saved job"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
      {reserved ? (
        <p role="status" className="text-sm text-emerald-300">
          This production run will wait for the reviewed physical panel package.
        </p>
      ) : (
        <Button disabled={!valid || busy} onClick={() => void reserve()}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Wait for
          PanelProFileOutput
        </Button>
      )}
    </section>
  );
}

const REVIEW_LABELS: Record<
  (typeof PANEL_OUTPUT_REVIEW_CHECKS)[number],
  string
> = {
  template:
    "I checked the exact vehicle or surface template and its dimensions.",
  fit: "I checked artwork fit and placement on the template.",
  essentialArtworkSafe:
    "Logos, text and important artwork stay clear of installation cuts.",
  backgroundContinuous:
    "Background artwork continuously covers cut areas, the panel and bleed.",
  fiveInchBleed: "Every outside edge has five inches of usable bleed.",
  resolution: "I checked image detail and resolution at the full printed size.",
  physicalPieces:
    "All physical pieces, returns and required splits are included.",
  filesInspected: "I downloaded and inspected the actual production files.",
};

function PanelOutputHumanReview({
  run,
  onReviewed,
}: {
  run: PanelOutputRun;
  onReviewed?: () => void;
}) {
  const [checks, setChecks] = useState<PanelOutputReviewChecks>(
    () =>
      Object.fromEntries(
        PANEL_OUTPUT_REVIEW_CHECKS.map((key) => [key, false]),
      ) as PanelOutputReviewChecks,
  );
  const [approvalRef, setApprovalRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recorded, setRecorded] = useState(false);
  const approvalRecorded =
    recorded ||
    (run.stages || []).some(
      (stage) =>
        stage.key === "await_panelpro_preflight_qc" &&
        ["complete", "completed", "succeeded"].includes(stage.state),
    );
  const files = (run.files || []).filter(
    (file) =>
      /^https:\/\/[^\s]+$/.test(file.signedUrl || "") &&
      /^[a-f0-9]{64}$/i.test(file.contentHash || ""),
  );
  const canSubmit =
    !busy &&
    !approvalRecorded &&
    files.length > 0 &&
    /^[a-f0-9]{64}$/i.test(run.artifactSetHash || "") &&
    approvalRef.trim().length > 0 &&
    PANEL_OUTPUT_REVIEW_CHECKS.every((key) => checks[key]);
  const approve = async () => {
    if (!canSubmit || !run.artifactSetHash) return;
    setBusy(true);
    setError("");
    try {
      const approval = await panelOutputApi.approve(run.id, {
        artifactSetHash: run.artifactSetHash,
        approvalRef: approvalRef.trim(),
        checks,
      });
      if (approval.accepted !== true)
        throw new Error("Approval was not recorded");
      setRecorded(true);
      onReviewed?.();
    } catch (issue) {
      setError(
        issue instanceof PanelOutputApiError && issue.status === 409
          ? "The output changed or is not ready for approval. Refresh and review the active files."
          : "Approval was not recorded. Check the current files and your reviewer access.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-violet-400/30 bg-slate-950 p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-300">
          Internal design team
        </p>
        <h3 className="mt-1 text-lg font-semibold">
          Physical panel quality review
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          Compare these files with the template and your human preparation
          baseline. This records approval of this physical panel output set. The
          operating system's final proof and delivery checks still apply.
        </p>
      </div>
      {files.length ? (
        <ul className="grid gap-2 md:grid-cols-2">
          {files.map((file) => (
            <li key={file.id}>
              <a
                href={file.signedUrl}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-slate-700 p-3 text-sm text-cyan-300"
              >
                {file.filename ||
                  file.label ||
                  [file.pieceId, file.format || file.mimeType?.split("/").pop()]
                    .filter(Boolean)
                    .join(" · ") ||
                  file.name ||
                  "Production file"}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">
          The verified physical production files must be available before this
          review can be approved.
        </p>
      )}
      {!approvalRecorded && (
        <fieldset disabled={busy} className="space-y-3">
          <legend className="mb-3 text-sm font-semibold">
            Record each check after inspection
          </legend>
          {PANEL_OUTPUT_REVIEW_CHECKS.map((key) => (
            <label key={key} className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={checks[key]}
                onChange={(event) =>
                  setChecks((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))
                }
                className="mt-0.5 h-4 w-4 accent-violet-500"
              />
              {REVIEW_LABELS[key]}
            </label>
          ))}
          <label className="block pt-2 text-sm">
            Review reference or notes
            <Input
              className="mt-2 border-slate-700"
              value={approvalRef}
              maxLength={1000}
              onChange={(event) => setApprovalRef(event.target.value)}
              placeholder="Your inspection reference or correction notes"
            />
          </label>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
      {approvalRecorded ? (
        <p role="status" className="text-sm text-emerald-300">
          Physical panel review recorded.
        </p>
      ) : (
        <Button disabled={!canSubmit} onClick={() => void approve()}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record
          physical panel QC approval
        </Button>
      )}
    </section>
  );
}

export default function PanelProFileOutput() {
  const { runId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const source =
    PANEL_OUTPUT_SOURCE_APPS.find(
      (app) =>
        app.toLowerCase() ===
        (search.get("sourceApp") || "designpro").toLowerCase(),
    ) || "DesignPro";
  const [sourceApp, setSourceApp] = useState<PanelOutputSourceApp>(source);
  const [sourceJobId, setSourceJobId] = useState(
    search.get("sourceJobId") || search.get("generationId") || "",
  );
  const [run, setRun] = useState<PanelOutputRun | null>(null);
  const [runs, setRuns] = useState<PanelOutputRun[]>([]);
  const [designs, setDesigns] = useState<DesignLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [readFailed, setReadFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [capabilities, setCapabilities] = useState({ canPrepare: false, canReview: false });
  const identity = useMemo(
    () => panelOutputIdentityFromSearch(search, sourceApp, sourceJobId),
    [sourceApp, sourceJobId, search],
  );

  useEffect(() => {
    setSourceApp(source);
    setSourceJobId(
      search.get("sourceJobId") || search.get("generationId") || "",
    );
  }, [source, search]);
  useEffect(() => {
    let live = true;
    void panelOutputApi.capabilities().then((value) => { if (live) setCapabilities({ canPrepare: value.canPrepare === true, canReview: value.canReview === true }); }).catch(() => { if (live) setCapabilities({ canPrepare: false, canReview: false }); });
    void dpApi
      .listDesignLibrary()
      .then((rows) => {
        if (live) setDesigns(rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setRun(null);
    setRuns([]);
    setCodes([]);
    setLoading(true);
    setReadFailed(false);
    const load = async () => {
      try {
        if (runId) {
          const result = await panelOutputApi.get(runId, controller.signal);
          if (live) setRun(result);
        } else {
          const result = await panelOutputApi.list(
            identity.sourceJobId ? identity : { sourceApp },
            controller.signal,
          );
          if (live) setRuns(result);
        }
        if (live) setReadFailed(false);
      } catch (error) {
        if (live) {
          setReadFailed(true);
          if (error instanceof PanelOutputApiError && error.blockers.length)
            setCodes(error.blockers);
        }
      } finally {
        if (live) {
          setLoading(false);
          timer = setTimeout(load, 5000);
        }
      }
    };
    void load();
    return () => {
      live = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [runId, identity, sourceApp, refresh]);
  const start = async () => {
    if (creating || !identity.sourceJobId) return;
    setCreating(true);
    setCodes([]);
    try {
      const created = await panelOutputApi.create(identity);
      navigate(`/panelpro-file-output/runs/${encodeURIComponent(created.id)}`);
    } catch (error) {
      setCodes(
        error instanceof PanelOutputApiError
          ? [error.code, ...error.blockers]
          : ["panelprofile_request_failed"],
      );
    } finally {
      setCreating(false);
    }
  };
  return (
    <main className="min-h-screen bg-[#080d18] px-4 py-8 text-slate-100 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-cyan-300">
              <Layers3 className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-widest">
                DesignProAI operating system
              </span>
            </div>
            <h1 className="mt-2 text-3xl font-bold">PanelProFileOutput</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Fit saved artwork to validated templates, protect important design
              elements and prepare panels for the design team's quality checks.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </header>
        {(capabilities.canPrepare || capabilities.canReview) && <nav aria-label="Internal output preparation" className="flex flex-wrap gap-3">
          {capabilities.canPrepare && <Button asChild variant="outline"><Link to="/panelpro-file-output/prepare">Prepare an output source</Link></Button>}
          {capabilities.canReview && <Button asChild variant="outline"><Link to="/panelpro-file-output/templates">Prepare or review a template</Link></Button>}
        </nav>}
        {!runId && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
            <h2 className="font-semibold">Continue from an existing app</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto]">
              <label className="text-xs text-slate-400">
                Source app
                <select
                  className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                  value={sourceApp}
                  onChange={(event) => {
                    setSourceApp(event.target.value as PanelOutputSourceApp);
                    setSourceJobId("");
                  }}
                  aria-label="Source app"
                >
                  {PANEL_OUTPUT_SOURCE_APPS.map((app) => (
                    <option key={app}>{app}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-400">
                {sourceApp === "DesignPro"
                  ? "Saved design"
                  : `${sourceApp} job ID`}
                {sourceApp === "DesignPro" && designs.length ? (
                  <select
                    className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                    value={sourceJobId}
                    onChange={(event) => setSourceJobId(event.target.value)}
                    aria-label="Saved design"
                  >
                    <option value="">Choose a saved design</option>
                    {sourceJobId &&
                      !designs.some(
                        (design) => design.generationId === sourceJobId,
                      ) && <option value={sourceJobId}>{sourceJobId}</option>}
                    {designs.map((design) => (
                      <option
                        key={design.generationId}
                        value={design.generationId}
                      >
                        {design.designId} ·{" "}
                        {design.designName ||
                          design.companyName ||
                          [design.vehicle?.make, design.vehicle?.model]
                            .filter(Boolean)
                            .join(" ")}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    className="mt-1 border-slate-700"
                    value={sourceJobId}
                    onChange={(event) => setSourceJobId(event.target.value)}
                    aria-label="Source job ID"
                    placeholder="Existing job ID"
                  />
                )}
              </label>
              <Button
                className="self-end"
                disabled={creating || !identity.sourceJobId}
                onClick={() => void start()}
              >
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="mr-2 h-4 w-4" />
                )}
                Prepare output
              </Button>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              The source app's saved job and revision remain attached to every
              output. A verified artwork and template handoff must be prepared
              before work can start.
            </p>
          </section>
        )}
        <BlockedNotice codes={codes} />
        {readFailed && (
          <p
            role="status"
            className="rounded-lg border border-amber-400/20 p-3 text-sm text-amber-200"
          >
            The latest status could not be loaded. Any previews below are from
            the last successful update.
          </p>
        )}
        {loading && (
          <div role="status" className="flex gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading saved production work…
          </div>
        )}
        {run && (
          <PanelOutputRunView
            productionRunId={search.get("productionRunId") || undefined}
            run={run}
            onReviewed={() => setRefresh((value) => value + 1)}
          />
        )}
        {!runId && !loading && (
          <section className="space-y-3">
            <h2 className="font-semibold">Saved output work</h2>
            {runs.length ? (
              runs.map((item) => (
                <Link
                  className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4 hover:border-cyan-400/40"
                  key={item.id}
                  to={`/panelpro-file-output/runs/${encodeURIComponent(item.id)}`}
                >
                  <div>
                    <p className="font-medium">
                      {item.designId || item.sourceJobId}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {item.sourceApp} · {panelOutputStageState(item.status)}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ))
            ) : (
              <p className="text-sm text-slate-400">
                No output run has been recorded for this selection.
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

/** Internal team tool. The gateway independently authorizes every registration. */
export function PanelProFileOutputPreparation() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [handoff, setHandoff] = useState<Record<string, unknown> | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [variantReviewed, setVariantReviewed] = useState(false);
  const [vehicleReviewRef, setVehicleReviewRef] = useState("");
  const read = async (file?: File) => {
    setHandoff(null);
    setName("");
    setError("");
    setVariantReviewed(false);
    setVehicleReviewRef("");
    if (!file) return;
    try {
      if (file.size > 1024 * 1024)
        throw new Error("The handoff file must be 1 MB or smaller.");
      const value = JSON.parse(await file.text());
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Choose a JSON handoff object.");
      setHandoff(value);
      setName(file.name);
    } catch (issue) {
      setError(
        issue instanceof SyntaxError
          ? "The file is not valid JSON."
          : issue instanceof Error
            ? issue.message
            : "The handoff could not be read.",
      );
    }
  };
  const submit = async () => {
    if (!handoff || busy) return;
    setBusy(true);
    setError("");
    try {
      const identity = await panelOutputApi.registerSource(withTemplateVehicleReview(handoff, {
        confirmed: variantReviewed, reviewId: vehicleReviewRef.trim(),
      }));
      navigate(panelOutputHref(identity));
    } catch (issue) {
      setError(
        issue instanceof PanelOutputApiError
          ? panelOutputBlockerCopy(issue.code)
          : issue instanceof Error ? issue.message : "The verified source handoff could not be registered.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="min-h-screen bg-[#080d18] px-4 py-8 text-slate-100">
      <section className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-slate-800 bg-slate-950 p-6">
        <p className="text-xs uppercase tracking-widest text-cyan-300">
          Internal design team
        </p>
        <h1 className="text-2xl font-bold">Register verified output source</h1>
        <p className="text-sm text-slate-400">
          Import the reviewed source handoff for DesignPro, RecreatePro,
          GraphicsPro or WallPro. It must identify the existing job and
          revision, stored artwork, measured template geometry, branded display,
          installation cut areas and output policy.
        </p>
        <label className="block rounded-lg border border-dashed border-slate-600 p-5 text-sm">
          <Upload className="mb-3 h-6 w-6 text-cyan-400" />
          <span>Verified handoff JSON</span>
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Verified handoff JSON"
            className="mt-3 block w-full text-sm"
            onChange={(event) => void read(event.target.files?.[0])}
          />
        </label>
        {name && <p className="text-sm">Ready to validate: {name}</p>}
        {handoff?.sourceApp === "DesignPro" && <fieldset disabled={busy} className="space-y-3 rounded-lg border border-slate-700 p-4">
          <legend className="px-2 text-sm font-semibold">Additional vehicle variant review</legend>
          <p className="text-xs text-slate-400">Use this only when the saved design omits a vehicle variant that the measured template specifies. A make, model, year or known variant mismatch still blocks output.</p>
          <label className="flex gap-3 text-sm"><input type="checkbox" checked={variantReviewed} onChange={(event) => setVariantReviewed(event.target.checked)} />I checked the actual vehicle and verified every template variant absent from the saved design.</label>
          <label className="block text-sm">Vehicle inspection reference<Input value={vehicleReviewRef} maxLength={160} disabled={!variantReviewed} onChange={(event) => setVehicleReviewRef(event.target.value)} className="mt-2 border-slate-700" /></label>
        </fieldset>}
        {error && (
          <p role="alert" className="text-sm text-amber-200">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button disabled={!handoff || busy || (variantReviewed && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(vehicleReviewRef.trim()))} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Validate and register
          </Button>
          <Button variant="outline" asChild>
            <Link to="/panelpro-file-output">Back to output</Link>
          </Button>
          <Button variant="outline" asChild><Link to="/panelpro-file-output/templates">Prepare or review a template</Link></Button>
        </div>
      </section>
      <div className="mx-auto mt-5 max-w-2xl">
        <PanelOutputProductionReservation
          productionRunId={search.get("productionRunId") || undefined}
        />
      </div>
    </main>
  );
}
