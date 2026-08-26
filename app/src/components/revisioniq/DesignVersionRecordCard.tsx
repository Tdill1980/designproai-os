/**
 * THE DESIGN'S VERSION RECORD — for the customer's own workspace.
 *
 * ⛔ THE A.T.L.A.S. MASTER IS NEVER SHOWN HERE. (Trish 2026-08-26)
 *
 * This file briefly rendered the flattened master, on the reading that a person
 * deciding what to change needs to see the sheet the change is made to. That
 * was wrong and the owner has said so in as many words: the A.T.L.A.S. sheet is
 * NEVER shown to clients. It lives in PanelPro Studio, under the A.T.L.A.S.
 * generation id, because PanelPro is the internal control room where the
 * authority everything descends from is inspected and QC'd.
 *
 * The boundary, stated once so nobody has to re-derive it:
 *
 *   RevisionStudioIQ  = REVIEW / REVISE / APPROVE / BUY
 *                       3D proof ↔ panel preview, versions, prompts, assets,
 *                       the Production Pack CTA.
 *   PanelPro Studio   = ATLAS / ASSETS / LINEAGE / QC / PRODUCTION
 *                       the master, the surface authorities, hashes, findings,
 *                       geometry, output.
 *
 * So what stays here is the design's HISTORY, which is the customer's own
 * record of what they asked for: every version, the words that produced each
 * one, when it was authored, and which one is current. The A.T.L.A.S. master
 * image and its content hash are not history — they are the production
 * authority — and they are absent by design rather than by oversight.
 *
 * WHAT DOES CROSS BOTH SURFACES is identity: the A.T.L.A.S. generation id, the
 * Design ID and the order number appear here AND in PanelPro, so a person on
 * the phone can name the same job from either screen.
 *
 * The version numbering is the server's own revision sequence, read through
 * `loadDesignVersionHistory` -- the one canonical history PanelPro reads too.
 * No second numbering, no second prompt store, nothing copied between surfaces.
 *
 * NOT A PRODUCER. Selecting a version changes what is displayed and nothing
 * else.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { History, ExternalLink, Clock, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  loadDesignVersionHistory,
  exactTimestamp,
  type DesignVersion,
  type DesignVersionHistory,
} from "@/lib/design-version-history";
import { dpApi } from "@/lib/designpro-api";
import { cn } from "@/lib/utils";

export function DesignVersionRecordCard({
  generationId,
  orderNumber,
  className,
}: {
  generationId: string | null | undefined;
  /** The Design Order number, when this job has been ordered. */
  orderNumber?: string | null;
  className?: string;
}) {
  const id = String(generationId || "").trim();
  const [history, setHistory] = useState<DesignVersionHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  // Why the seven-view carousel above may be empty. Two very different reasons
  // look identical from the browser, and the customer is owed the sentence.
  const [proofsSuperseded, setProofsSuperseded] = useState(false);

  useEffect(() => {
    let live = true;
    setProofsSuperseded(false);
    if (!id) return () => { live = false; };
    dpApi.listApprovedViewsWithVerdict(id)
      .then((result) => { if (live) setProofsSuperseded(result.superseded); })
      .catch(() => { if (live) setProofsSuperseded(false); });
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    let live = true;
    setHistory(null);
    setSelectedVersion(null);
    if (!id) return () => { live = false; };
    setLoading(true);
    loadDesignVersionHistory(id)
      .then((result) => { if (live) setHistory(result); })
      // A design this account cannot open, or one with no recorded revisions,
      // simply has no history to show. Nothing is invented in its place.
      .catch(() => { if (live) setHistory(null); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id]);

  const versions = history?.versions ?? [];
  const selected: DesignVersion | null = useMemo(() => {
    if (!versions.length) return null;
    const match = versions.find((version) => version.version === selectedVersion);
    // Unqualified means the newest, which is the design as it stands now.
    return match || versions[versions.length - 1];
  }, [versions, selectedVersion]);

  if (!id) return null;
  if (loading && !history) {
    return (
      <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900 p-4", className)}>
        <p className="text-[11px] text-zinc-500">Reading this design's version record…</p>
      </div>
    );
  }
  if (!versions.length) return null;

  const current = versions[versions.length - 1];
  const isCurrent = selected?.version === current.version;

  return (
    <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3", className)}>
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-bold text-zinc-200">Design versions</span>
        <span className="ml-auto text-[10px] text-zinc-500">
          {versions.length} version{versions.length === 1 ? "" : "s"} · current V{current.version}
        </span>
      </div>

      {/* THE IDENTITY TRIO, ON BOTH SURFACES. The same three values appear in
          PanelPro Studio, so one person can name the job from either screen. */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5 text-[10px]">
        <dt className="text-zinc-500">Generation ID 🧬</dt>
        <dd className="truncate font-mono text-zinc-300" title={id}>{id}</dd>
        <dt className="text-zinc-500">Design ID</dt>
        <dd className="truncate font-mono text-zinc-300">{history?.designId || "—"}</dd>
        <dt className="text-zinc-500">Order number</dt>
        <dd className="truncate font-mono text-zinc-300">
          {orderNumber || history?.orderNumber || "— not ordered yet"}
        </dd>
      </dl>

      <p className="text-[11px] text-zinc-500 leading-snug">
        Every version stays inspectable — a new one never replaces the one before it.
      </p>

      {/* The proofs are withheld by the server, not missing. The design and its
          six surfaces are unaffected; a new run is what produces a servable
          proof set. Saying which of the two it is turns a blank carousel into a
          decision the customer can make. */}
      {proofsSuperseded && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] font-semibold text-amber-300">
          The 3D proofs for this design were rendered under an earlier design
          architecture and are no longer served. Your design and its six surfaces
          are unaffected — submit a revision to render a new proof set.
        </p>
      )}

      {/* Every version, oldest first. V1 is the original design. */}
      <div className="flex flex-wrap gap-1.5">
        {versions.map((version) => {
          const active = selected?.version === version.version;
          return (
            <button
              key={version.revisionId}
              type="button"
              onClick={() => setSelectedVersion(version.version)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                active
                  ? "border-blue-500 bg-blue-500/15 text-blue-200"
                  : "border-zinc-700 bg-zinc-950/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
              )}
            >
              V{version.version}
              {version.version === current.version ? (
                <span className="ml-1 text-[9px] font-normal text-emerald-300">current</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {selected ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-[11px] font-bold text-zinc-300">
              {selected.promptKind === "original-brief"
                ? "Original customer brief"
                : `What was asked for in V${selected.version}`}
            </span>
            {!isCurrent ? (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                superseded version
              </span>
            ) : null}
          </div>
          {/* The customer's own words, verbatim. Never a paraphrase: a revision
              is authored from this text plus the requested change. */}
          {selected.prompt ? (
            <p className="whitespace-pre-wrap text-[11px] leading-snug text-zinc-300">
              {selected.prompt}
            </p>
          ) : (
            <p className="text-[11px] text-zinc-500">No text was recorded for this version.</p>
          )}
          <p className="pt-0.5 text-[10px] text-zinc-500">
            <Clock className="mr-1 inline h-2.5 w-2.5" />
            {exactTimestamp(selected.createdAt)}
          </p>
        </div>
      ) : null}

      {/* PanelPro Studio is where the production record lives — the A.T.L.A.S.
          authority, the surface hashes, the QC findings and the output. This is
          the way there, on the same generation id. */}
      <Button asChild size="sm" variant="outline" className="h-7 w-full border-zinc-700 text-[11px] text-zinc-300">
        <Link to={`/designpro/jobs/${encodeURIComponent(id)}/panelpro`}>
          <ExternalLink className="mr-1.5 h-3 w-3" />
          Open the production record in PanelPro Studio
        </Link>
      </Button>
    </div>
  );
}
