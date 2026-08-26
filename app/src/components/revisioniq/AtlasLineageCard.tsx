/**
 * THE A.T.L.A.S. LINEAGE, IN THE SURFACE THE CUSTOMER REVISES FROM.
 *
 * RevisionStudioIQ's data seam deliberately withheld the master: the note on
 * `revisionstudio-source.ts` reads "A.T.L.A.S. INTERNALS ARE NOT IN HERE ...
 * PanelPro Studio is where the lineage is inspected." That was a reasonable
 * reading of the canonical contract, and the owner has since corrected it --
 * the flattened master and the version record belong in the revision workspace
 * too, because a person deciding what to change needs to see the sheet the
 * change will be made to, and which version they are looking at.
 *
 * So this shows exactly what the server already published for this generation
 * and nothing else:
 *
 *   * every A.T.L.A.S. version, oldest first, never only the newest;
 *   * the customer's own words for each one -- the original brief for V1, the
 *     revision instruction for the rest, both verbatim and labelled for which
 *     they are, because reading one as the other is how a design gets revised
 *     against text nobody typed;
 *   * the exact authoring timestamp;
 *   * the flattened master for the selected version, with its content hash --
 *     the identity every panel and every proof of that version binds to;
 *   * the way through to PanelPro, where the same lineage is validated.
 *
 * It reads `loadDesignVersionHistory` and nothing else, which is the one
 * canonical history PanelPro reads as well. There is no second numbering here
 * and nothing is copied between the two surfaces: V2 means the same version,
 * with the same prompt and the same timestamp, in both, because it is the same
 * record.
 *
 * NOT A PRODUCER. Nothing here generates, re-cuts, uploads or mutates anything.
 * Selecting a version changes what is displayed; it does not change the design.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Layers, Download, ExternalLink, Clock, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  loadDesignVersionHistory,
  exactTimestamp,
  type DesignVersion,
  type DesignVersionHistory,
} from "@/lib/design-version-history";
import { dpApi } from "@/lib/designpro-api";
import { cn } from "@/lib/utils";

/** A hash is an identity, not a paragraph. Show enough of it to compare. */
function shortHash(hash: string | null | undefined): string {
  const value = String(hash || "");
  return value ? `${value.slice(0, 12)}…${value.slice(-6)}` : "—";
}

export function AtlasLineageCard({
  generationId,
  className,
}: {
  generationId: string | null | undefined;
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
      // A design this account cannot open, or one with no A.T.L.A.S. revisions
      // because it ran the Standard pipeline, simply has no lineage to show.
      // Nothing is invented in its place.
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
        <p className="text-[11px] text-zinc-500">Reading the A.T.L.A.S. lineage…</p>
      </div>
    );
  }
  // A Standard-pipeline design has no master. Saying nothing is better than
  // saying something untrue about a design that never had one.
  if (!versions.length) return null;

  const isCurrent = selected?.version === versions[versions.length - 1].version;

  return (
    <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3", className)}>
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-bold text-zinc-200">A.T.L.A.S. Design Lineage</span>
        <span className="ml-auto text-[10px] text-zinc-500">
          {versions.length} version{versions.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="text-[11px] text-zinc-500 leading-snug">
        {history?.designId ? <>Design <span className="font-mono text-zinc-400">{history.designId}</span>. </> : null}
        Every version stays inspectable — a new one never replaces the one before it.
      </p>

      {/* The proofs are withheld by the server, not missing. The design, its
          master and its six panels are unaffected; a new run is what produces a
          servable proof set. Saying which of the two it is turns a blank
          carousel into a decision the customer can make. */}
      {proofsSuperseded && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] font-semibold text-amber-300">
          The 3D proofs for this design were rendered under an earlier A.T.L.A.S.
          architecture and are no longer served. The master and the six print
          panels below are unaffected — submit a revision to render a new proof set.
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
              {version.version === versions[versions.length - 1].version ? (
                <span className="ml-1 text-[9px] font-normal text-emerald-300">current</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {selected ? (
        <div className="space-y-3">
          {/* The flattened master this version produced. It is the design
              authority every panel and every proof of this version descends
              from, which is why its hash is shown beside it rather than left
              somewhere only an operator can find. */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-zinc-300">
                Flattened A.T.L.A.S. master — V{selected.version}
              </span>
              {!isCurrent ? (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                  superseded version
                </span>
              ) : null}
            </div>
            {selected.masterUrl ? (
              <>
                <a href={selected.masterUrl} target="_blank" rel="noreferrer">
                  <img
                    src={selected.masterUrl}
                    alt={`A.T.L.A.S. master, version ${selected.version}`}
                    className="w-full rounded bg-white object-contain"
                    loading="lazy"
                  />
                </a>
                <Button asChild size="sm" variant="outline" className="h-7 border-zinc-700 text-[11px] text-zinc-300">
                  <a href={selected.masterUrl} download={`atlas-master-v${selected.version}.png`}>
                    <Download className="mr-1.5 h-3 w-3" />
                    Download master
                  </a>
                </Button>
              </>
            ) : (
              // The row exists, the signature did not. The hash below is still
              // the truth about this version, so it is shown either way.
              <p className="text-[11px] text-amber-300">
                The master image is still arriving. Its identity is below.
              </p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]">
              <dt className="text-zinc-500">Master hash</dt>
              <dd className="font-mono text-zinc-300" title={selected.masterContentHash}>
                {shortHash(selected.masterContentHash)}
              </dd>
              <dt className="text-zinc-500">Authored</dt>
              <dd className="text-zinc-300">
                <Clock className="mr-1 inline h-2.5 w-2.5 text-zinc-500" />
                {exactTimestamp(selected.createdAt)}
              </dd>
              <dt className="text-zinc-500">Surfaces</dt>
              <dd className="text-zinc-300">{selected.affectedSurfaces.join(" · ") || "—"}</dd>
            </dl>
          </div>

          {/* The customer's own words for this version, verbatim, and labelled
              for which kind they are. */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-[11px] font-bold text-zinc-300">
                {selected.promptKind === "original-brief"
                  ? "Original customer brief"
                  : `What was asked for in V${selected.version}`}
              </span>
            </div>
            {selected.prompt ? (
              <p className="whitespace-pre-wrap text-[11px] leading-snug text-zinc-300">
                {selected.prompt}
              </p>
            ) : (
              <p className="text-[11px] text-zinc-500">
                No text was recorded for this version.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {/* The same lineage, validated against the real vehicle template. Not a
          duplicate surface: PanelPro is where the panels are released, and this
          is the way there from the design the customer is revising. */}
      <Button asChild size="sm" variant="outline" className="h-7 w-full border-zinc-700 text-[11px] text-zinc-300">
        <Link to={`/designpro/jobs/${encodeURIComponent(id)}/panelpro`}>
          <ExternalLink className="mr-1.5 h-3 w-3" />
          Open this design in PanelPro Studio
        </Link>
      </Button>
    </div>
  );
}
