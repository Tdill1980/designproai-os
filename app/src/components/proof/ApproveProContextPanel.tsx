/**
 * ApproveProContextPanel
 *
 * A floating "Job context" drawer for RevisionStudioIQ. When the shop opens a
 * customer's proof from ApprovePro (?proof_id=...), the surgical editor loads
 * only the ACTIVE design. This panel surfaces the rest of the story so the shop
 * can refine by hand without hunting: every photo the customer uploaded, the
 * public intake assets, and every past version with its prompt — each loadable
 * straight into the editor.
 *
 * Data comes from the service-role `approvepro-versions` endpoint (RLS-bypass +
 * signed upload URLs), so it works on WPW auto-ingested orders too.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Images, Loader2, X, ExternalLink, Wand2, History, Upload } from "lucide-react";

interface Asset {
  path: string;
  name: string;
  url: string;
  created_at: string | null;
}

interface Version {
  id: string;
  version_number: number;
  created_by_role: string | null;
  is_active: boolean;
  created_at: string | null;
  render_urls: Record<string, unknown> | null;
  prompt_text: string | null;
}

interface Props {
  proofId: string;
  /** Load a chosen version's render set into the editor. */
  onLoadVersion?: (v: Version) => void;
}

function heroUrl(render_urls: Record<string, unknown> | null): string | null {
  if (!render_urls) return null;
  const order = ["hero", "side", "roof", "rear", "front"];
  for (const k of order) {
    const v = render_urls[k];
    if (typeof v === "string" && v) return v;
  }
  for (const v of Object.values(render_urls)) {
    if (typeof v === "string" && v) return v;
  }
  return null;
}

export const ApproveProContextPanel = ({ proofId, onLoadVersion }: Props) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [uploads, setUploads] = useState<Asset[]>([]);
  const [contextAssets, setContextAssets] = useState<Asset[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded || loading) return;
    setLoading(true);
    (async () => {
      try {
        const { data, error: err } = await supabase.functions.invoke("approvepro-versions", {
          body: { proof_id: proofId },
        });
        if (err) throw err;
        setUploads((data?.customer_uploads || []) as Asset[]);
        setContextAssets((data?.context_assets || []) as Asset[]);
        setVersions((data?.versions || []) as Version[]);
        setLoaded(true);
      } catch (e: any) {
        setError(e?.message || "Couldn't load job context.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, loaded, loading, proofId]);

  const allRefs = [...uploads, ...contextAssets];

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-[60] flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white px-4 h-11 text-sm font-bold shadow-lg hover:brightness-110 transition"
        title="Customer uploads, prompts & every version"
      >
        <Images className="w-4 h-4" /> Job context
      </button>

      {open && (
        <div className="fixed inset-0 z-[61] flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/60" onClick={() => setOpen(false)} />
          {/* Drawer */}
          <div className="w-full max-w-md h-full overflow-y-auto bg-zinc-950 border-l border-zinc-800 text-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Images className="w-4 h-4 text-[#ec4899]" /> Job context
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="text-zinc-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {loading && (
              <div className="flex items-center gap-2 text-sm text-zinc-400 py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading uploads, prompts & versions…
              </div>
            )}
            {error && (
              <div className="rounded-md bg-red-950/60 border border-red-900 text-red-300 text-sm p-3">{error}</div>
            )}

            {loaded && (
              <div className="space-y-6">
                {/* Customer references */}
                <section>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold mb-2 flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" /> Customer references ({allRefs.length})
                  </p>
                  {allRefs.length === 0 ? (
                    <p className="text-xs text-zinc-500">No uploads on file for this order.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {allRefs.map((a) => (
                        <a
                          key={a.path}
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group relative aspect-square rounded-md overflow-hidden border border-zinc-800 bg-zinc-900"
                          title={a.name}
                        >
                          <img src={a.url} alt={a.name} className="w-full h-full object-cover" loading="lazy" />
                          <span className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition">
                            <ExternalLink className="w-4 h-4 opacity-0 group-hover:opacity-100" />
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </section>

                {/* Version history */}
                <section>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold mb-2 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" /> Versions & prompts ({versions.length})
                  </p>
                  <div className="space-y-2">
                    {versions.map((v) => {
                      const thumb = heroUrl(v.render_urls);
                      return (
                        <div
                          key={v.id}
                          className={`flex gap-3 rounded-lg border p-2 ${v.is_active ? "border-[#3b82f6] bg-blue-950/30" : "border-zinc-800 bg-zinc-900/50"}`}
                        >
                          {thumb ? (
                            <a href={thumb} target="_blank" rel="noopener noreferrer" className="shrink-0">
                              <img src={thumb} alt={`v${v.version_number}`} className="w-16 h-16 object-cover rounded-md border border-zinc-800" loading="lazy" />
                            </a>
                          ) : (
                            <div className="w-16 h-16 shrink-0 rounded-md bg-zinc-800" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-bold">v{v.version_number}</span>
                              {v.is_active && <span className="text-[10px] text-[#3b82f6] font-semibold">ACTIVE</span>}
                              <span className="text-zinc-500">{v.created_by_role}</span>
                            </div>
                            <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-3">
                              {v.prompt_text || <span className="italic text-zinc-600">no prompt</span>}
                            </p>
                            {onLoadVersion && thumb && (
                              <button
                                type="button"
                                onClick={() => { onLoadVersion(v); setOpen(false); }}
                                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[#ec4899] hover:underline"
                              >
                                <Wand2 className="w-3 h-3" /> Load into editor
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default ApproveProContextPanel;
