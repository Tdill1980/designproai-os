/**
 * ProofViewsStrip — the "PROOF VIEWS" thumbnail strip under the big proof, like
 * the ApprovePro portal mockup. Renders every render view on the active version
 * (driver/passenger/front/rear/hood/roof/close-up…) as a labelled thumbnail;
 * tapping one swaps the big proof above it. Portal-clean, AI-first.
 */

import { Images, X, RotateCw } from "lucide-react";

const VIEW_LABELS: Record<string, string> = {
  hero: "Hero",
  side: "Driver Side",
  driver: "Driver Side",
  driver_side: "Driver Side",
  left: "Driver Side",
  passenger: "Passenger Side",
  passenger_side: "Passenger Side",
  right: "Passenger Side",
  front: "Front",
  rear: "Rear",
  back: "Rear",
  hood: "Hood",
  roof: "Roof",
  top: "Roof",
  closeup: "Close-Up",
  close_up: "Close-Up",
  detail: "Close-Up",
  threequarter: "3/4 View",
  three_quarter: "3/4 View",
};

function labelFor(key: string, i: number): string {
  const k = key.toLowerCase();
  return VIEW_LABELS[k] || key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || `View ${i + 1}`;
}

interface Props {
  renderUrls?: Record<string, string> | null;
  uploadedPaths?: string[] | null;
  activeUrl?: string | null;
  onSelect: (url: string) => void;
  /** Admin-only: remove a single view (e.g. a mislabeled / wrong-angle render). */
  onDelete?: (key: string) => void;
  /** Admin-only: regenerate a single view — "fix this one" without a full redo. */
  onRegenerate?: (key: string) => void;
  /** Key currently being deleted/regenerated, to show a busy state. */
  busyKey?: string | null;
}

export function ProofViewsStrip({ renderUrls, uploadedPaths, activeUrl, onSelect, onDelete, onRegenerate, busyKey }: Props) {
  const entries = Object.entries(renderUrls || {}).filter(([, url]) => !!url);
  // Add any uploaded files that aren't already in render_urls (manual uploads).
  const known = new Set(entries.map(([, u]) => u));
  const uploads = (uploadedPaths || []).filter((u) => u && !known.has(u)).map((u, i) => [`upload_${i + 1}`, u] as [string, string]);
  const all = [...entries, ...uploads];

  if (all.length <= 1) return null; // nothing to switch between

  return (
    <div className="px-4 sm:px-5 py-3 bg-white border-b border-gray-200">
      <div className="flex items-center gap-1.5 mb-2">
        <Images className="w-3.5 h-3.5 text-[#0080dd]" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Proof views</span>
        <span className="text-[11px] text-gray-400">({all.length})</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {all.map(([key, url], i) => {
          const active = activeUrl === url;
          const isUpload = key.startsWith("upload_");
          const canEdit = !isUpload && (!!onDelete || !!onRegenerate);
          const busy = busyKey === key;
          return (
            <div key={`${key}-${i}`} className="shrink-0 w-[88px] relative group">
              <button
                type="button"
                onClick={() => onSelect(url)}
                title={labelFor(key, i)}
                className="w-full text-left focus:outline-none"
              >
                <div className={`rounded-lg overflow-hidden border-2 transition-all ${active ? "border-[#0080dd] ring-2 ring-[#0080dd]/20" : "border-gray-200 group-hover:border-gray-300"}`}>
                  <img src={url} alt={labelFor(key, i)} className={`w-full h-[58px] object-cover bg-gray-100 ${busy ? "opacity-40" : ""}`} loading="lazy" />
                </div>
                <div className={`mt-1 text-[10px] leading-tight truncate ${active ? "text-[#0080dd] font-semibold" : "text-gray-500"}`}>
                  {labelFor(key, i)}
                </div>
              </button>
              {canEdit && (
                <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onRegenerate && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); if (!busy) onRegenerate(key); }}
                      title={`Regenerate ${labelFor(key, i)} — tell AI to fix this view`}
                      className="w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-[#0080dd]"
                    >
                      <RotateCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); if (!busy) onDelete(key); }}
                      title={`Delete ${labelFor(key, i)} view`}
                      className="w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
