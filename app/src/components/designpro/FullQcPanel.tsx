/**
 * RUN FULL QC — the stage 3 → 4 gate, inside PanelPro Studio.
 *
 * Owner directive (Trish 2026-08-29): "Run the complete production QC stack
 * automatically against those exact approved panels… If QC fails, keep me in
 * PanelProStudio and tell me exactly which panel/check failed. If QC passes,
 * show CREATE WRAPBOX."
 *
 * So this never navigates on failure and never offers the next door on
 * failure — both would be the same lie in different words. On a pass the
 * WrapBox action appears here, in place, carrying the job identity.
 *
 * WHY IT IS INSTANT. `buildPanelQcReport` compares facts the server stamped at
 * authoring time and already publishes on the revision; there is no upload, no
 * model and no round trip. That is also why it is honest: it reports the
 * artifacts' own numbers rather than measuring a signed preview and forming a
 * browser-side opinion about production artwork.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildPanelQcReport, type PanelQcReport, type QcCheck } from "@/lib/designpro-panel-qc";
import { SURFACE_LABELS } from "@/lib/designpro-surfaces";
import type { FlatAtlasRevision } from "@/lib/designpro-api";
import { cn } from "@/lib/utils";

export type FullQcPanelProps = {
  generationId: string;
  revision: FlatAtlasRevision | null | undefined;
  hasProductionProof: boolean;
  /** Lets the host reflect the verdict in the workflow breadcrumb. */
  onReport?: (report: PanelQcReport | null) => void;
};

function OutcomeIcon({ outcome }: { outcome: QcCheck["outcome"] }) {
  if (outcome === "pass") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />;
  if (outcome === "fail") return <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden />;
  if (outcome === "warn") return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />;
  return <CircleSlash className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />;
}

function CheckRow({ row }: { row: QcCheck }) {
  return (
    <li className="flex items-start gap-2 py-1.5">
      <OutcomeIcon outcome={row.outcome} />
      <span className="min-w-0">
        <span className="text-xs font-semibold text-gray-800">
          {row.surfaceKey ? `${SURFACE_LABELS[row.surfaceKey]} · ` : ""}{row.label}
        </span>
        <span className="block text-xs text-gray-500">{row.detail}</span>
      </span>
    </li>
  );
}

export function FullQcPanel({ generationId, revision, hasProductionProof, onReport }: FullQcPanelProps) {
  const [report, setReport] = useState<PanelQcReport | null>(null);
  const [running, setRunning] = useState(false);

  const run = () => {
    if (!revision) return;
    setRunning(true);
    // Synchronous by nature; the tick exists only so the button can show it ran
    // rather than appearing not to respond.
    window.setTimeout(() => {
      const next = buildPanelQcReport({ generationId, revision, hasProductionProof });
      setReport(next);
      onReport?.(next);
      setRunning(false);
    }, 0);
  };

  return (
    <section id="qc" className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <ShieldCheck className="h-4 w-4 text-gray-500" aria-hidden />
            Full production QC
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Ancestry, hashes, dimensions, bleed, panelization, resolution, readability and the
            required six surfaces — checked against the artifacts the server stamped.
          </p>
        </div>
        <Button onClick={run} disabled={!revision || running} className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
          Run Full QC
        </Button>
      </div>

      {!revision && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          PRODUCTION PANELS NOT CREATED — this design has no A.T.L.A.S. revision, so there is
          nothing to check.
        </p>
      )}

      {report && (
        <div className="mt-4 space-y-3">
          <div
            className={cn(
              "rounded border px-3 py-2 text-xs font-semibold",
              report.passed
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            {report.passed
              ? `QC PASSED · ${report.checks.length} checks · ${report.warnings.length} warning(s) to review on a vehicle template`
              : `QC FAILED · ${report.failures.length} failing check(s)`}
          </div>

          {/* FAILURES FIRST, NAMED. The owner asked to be told exactly which
              panel and which check — not to scroll a list of passes looking. */}
          {report.failures.length > 0 && (
            <div className="rounded border border-red-200 bg-red-50/60 p-3">
              <p className="text-xs font-bold text-red-800">
                Fix these before this job can go to WrapBox
                {report.failedSurfaces.length > 0
                  && ` — affected panels: ${report.failedSurfaces.map((key) => SURFACE_LABELS[key]).join(", ")}`}
              </p>
              <ul className="mt-1 divide-y divide-red-100">
                {report.failures.map((row) => <CheckRow key={row.id} row={row} />)}
              </ul>
            </div>
          )}

          <details className="rounded border border-gray-200 bg-gray-50/60 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-gray-700">
              All {report.checks.length} checks
            </summary>
            <ul className="mt-1 divide-y divide-gray-100">
              {report.checks.map((row) => <CheckRow key={row.id} row={row} />)}
            </ul>
          </details>

          <p className="text-[11px] text-gray-400">
            Master {report.masterContentHash.slice(0, 16)}… · A.T.L.A.S. revision{" "}
            {report.atlasRevisionId} · {new Date(report.checkedAt).toLocaleString()}
          </p>

          {/* THE NEXT DOOR APPEARS ONLY ON A PASS, and it carries the job. */}
          {report.passed && (
            <Button asChild className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-500">
              <Link to={`/designpro/wrapbox?job=${encodeURIComponent(generationId)}`}>
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Create WrapBox
              </Link>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export default FullQcPanel;
