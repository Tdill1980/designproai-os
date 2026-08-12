/**
 * AssetVersionCards — the "asset history" container the production/QC UI uses to
 * house EVERY version of a design: the prompt that produced it, the date, and
 * BOTH the 2D proof and the 3D proof side by side. A new version row is written
 * (design_generation_assets, iteration_index) on each major design change — the
 * same versioning RevisionStudio already drives — so this just renders that
 * chain as reviewable cards instead of a single cramped thumbnail.
 *
 * Deterministic: it only reads already-persisted assets (no AI). Pass in the
 * design_generation_assets rows (latest first), the per-version revision prompts,
 * and the original brief; the newest is flagged "Latest".
 */
import { Download, FileImage, Box } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AssetVersion {
  id?: string;
  iteration_index?: number | null;
  is_current?: boolean | null;
  proof_2d_url?: string | null;
  proof_3d_url?: string | null;
  background_url?: string | null;
  created_at?: string | null;
}

export interface VersionPrompt {
  version?: number;
  revision_prompt?: string;
}

interface AssetVersionCardsProps {
  /** design_generation_assets rows, ordered latest-first (is_current === true is newest). */
  assets: AssetVersion[];
  /** Per-version revision prompts (from the color_visualizations version chain). */
  revisions?: VersionPrompt[];
  /** The original V1 brief. */
  originalPrompt?: string;
  className?: string;
}

const fmtDate = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

function ProofThumb({ label, url, icon }: { label: string; url?: string | null; icon: React.ReactNode }) {
  return (
    <a
      href={url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => !url && e.preventDefault()}
      className={cn(
        "group/proof relative flex-1 overflow-hidden rounded-lg border",
        url ? "border-gray-200 hover:border-blue-400" : "border-dashed border-gray-200 pointer-events-none",
      )}
      title={url ? `Open ${label}` : `${label} not available`}
    >
      <div className="flex aspect-video items-center justify-center bg-gray-50">
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="text-[9px] font-medium uppercase tracking-wider text-gray-300">No {label}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">
        <span className="flex items-center gap-1">
          {icon}
          {label}
        </span>
        {url && <Download className="h-3 w-3 opacity-0 transition-opacity group-hover/proof:opacity-100" />}
      </div>
    </a>
  );
}

export function AssetVersionCards({ assets, revisions = [], originalPrompt, className }: AssetVersionCardsProps) {
  if (!assets || assets.length === 0) return null;

  const total = assets.length;

  // Resolve the prompt that produced a given version. iteration_index is the
  // canonical version number; fall back to positional order. V1 = original brief.
  const promptForVersion = (versionNum: number): string => {
    const match = revisions.find((r) => (r.version ?? -1) === versionNum)?.revision_prompt;
    if (match) return match;
    if (versionNum <= 1) return originalPrompt || "";
    return "";
  };

  return (
    <div className={cn("space-y-3", className)}>
      {assets.map((a, i) => {
        // Newest first: derive a human version number (Latest badge for is_current).
        const versionNum = a.iteration_index != null ? a.iteration_index + 1 : total - i;
        const prompt = promptForVersion(versionNum);
        return (
          <div
            key={a.id || i}
            className={cn(
              "overflow-hidden rounded-xl border bg-white",
              a.is_current ? "border-blue-500 shadow-sm" : "border-gray-200",
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  a.is_current
                    ? "bg-gradient-to-r from-blue-500 to-cyan-400 text-white"
                    : "bg-gray-100 text-gray-500",
                )}
              >
                {a.is_current ? "Latest" : `Version ${versionNum}`}
              </span>
              {a.created_at && (
                <span className="text-[10px] font-medium text-gray-400" title={new Date(a.created_at).toLocaleString()}>
                  {fmtDate(a.created_at)}
                </span>
              )}
            </div>

            {prompt && (
              <p className="border-b border-gray-100 px-3 py-2 text-xs leading-snug text-gray-700">
                <span className="font-semibold text-gray-400">Prompt: </span>
                {prompt}
              </p>
            )}

            <div className="flex gap-2 p-2">
              <ProofThumb label="2D Proof" url={a.proof_2d_url} icon={<FileImage className="h-3 w-3" />} />
              <ProofThumb label="3D Proof" url={a.proof_3d_url || a.background_url} icon={<Box className="h-3 w-3" />} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
