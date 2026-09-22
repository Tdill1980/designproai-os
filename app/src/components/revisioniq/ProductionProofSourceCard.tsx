import { AtlasPanelProofSheetLoader } from "@/components/designpanelpro/AtlasPanelProofSheet";
import { PROOF_BRAND } from "@/lib/os-brand";

/**
 * THE SOURCE ARTIFACT, PRESENTED AS SUCH. Owner (Trish 2026-09-22): "Panel
 * production proof is source." The three-zone Production Panel Proof is Call 1
 * and every print panel below it is cut from that one sheet -- so on the
 * customer's RevisionStudio column and on the design team's PanelPro board it
 * sits ABOVE the print panels and the Order button, with a heading that says
 * what it is and which version it belongs to.
 *
 * This is a heading around the ONE reader of that artifact
 * (`AtlasPanelProofSheetLoader`). It is not a second reader and not a second
 * producer: it holds no query of its own, and `ProductionFlowLayersCard`
 * (the print panels) is untouched -- one reader per artifact, RULE 0.21.
 *
 * A revision is its own generation request, so `requestId` already names the
 * revision; `revisionId` only pins an operator's selected version so another
 * version's proof can never be shown under this heading.
 */
export function ProductionProofSourceCard({
  requestId,
  revisionId,
  version,
  pollWhilePending = false,
}: {
  requestId: string;
  revisionId?: string | null;
  /** The server's V-number for this revision, when the caller knows it. */
  version?: number | null;
  pollWhilePending?: boolean;
}) {
  const heading = Number.isFinite(version) && (version as number) > 0
    ? `${PROOF_BRAND.full} · V${version}`
    : PROOF_BRAND.full;
  return (
    <section
      aria-label={heading}
      data-testid="production-proof-source"
      className="rounded-lg border border-gray-200 bg-white p-3 space-y-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-bold text-gray-900">{heading}</h3>
        <span className="text-[11px] text-gray-500">the source of every print panel below</span>
      </div>
      <AtlasPanelProofSheetLoader
        key={requestId}
        requestId={requestId}
        revisionId={revisionId || undefined}
        pollWhilePending={pollWhilePending}
      />
    </section>
  );
}
