/**
 * AdminClipDropEvidence — /admin/clipdrop-evidence
 *
 * Loads existing ClipDrop separation results from `extracted_elements` so the
 * heal quality can be evaluated visually IN-APP (the container/CLI can't fetch
 * Supabase storage — host allowlist). Each card shows:
 *   • the ClipDrop Cleanup healed background, with a red box marking the masked
 *     text/logo zone that was healed (judge: does the wrap pattern survive?)
 *   • the Remove-Background transparent cutout (judge: edge quality)
 * Click any image to enlarge.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface ExtractedElement {
  id: string;
  element_type: string | null;
  element_label: string | null;
  created_at: string;
  clean_background_url: string | null;
  transparent_png_url: string | null;
  bounding_box: any;
}

export default function AdminClipDropEvidence() {
  const [rows, setRows] = useState<ExtractedElement[] | null>(null);
  const [enlarge, setEnlarge] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("extracted_elements" as any)
      .select("id, element_type, element_label, created_at, clean_background_url, transparent_png_url, bounding_box")
      .not("clean_background_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(60)
      .then(({ data }) => setRows((data as any[] as ExtractedElement[]) || []));
  }, []);

  if (!rows) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="sticky top-0 z-10 border-b border-zinc-800 bg-black px-6 py-3">
        <h1 className="text-lg font-bold">
          ClipDrop Heal Evidence{" "}
          <span className="text-sm text-zinc-500">· extracted_elements ({rows.length})</span>
        </h1>
        <p className="mt-0.5 text-xs text-zinc-400">
          Each card = a real ClipDrop Cleanup result. The <span className="text-red-400">red box</span> marks the
          masked text/logo zone that was healed — judge whether the wrap pattern survives cleanly (manufacturing
          sharpness) or smudges. Bottom-left thumbnail = the Remove-Background transparent cutout. Click to enlarge.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-zinc-500">No ClipDrop heals found in extracted_elements for your account.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 p-6 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const bb = r.bounding_box || {};
            const xPct = (bb.xPct ?? 0) * 100;
            const yPct = (bb.yPct ?? 0) * 100;
            const wPct = (bb.wPct ?? 0) * 100;
            const hPct = (bb.hPct ?? 0) * 100;
            return (
              <div key={r.id} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                <div className="relative bg-zinc-800">
                  {r.clean_background_url ? (
                    <img
                      src={r.clean_background_url}
                      alt="ClipDrop healed background"
                      className="w-full cursor-zoom-in"
                      onClick={() => setEnlarge(r.clean_background_url!)}
                    />
                  ) : (
                    <div className="aspect-video" />
                  )}
                  {(wPct > 0 || hPct > 0) && (
                    <div
                      className="pointer-events-none absolute border-2 border-red-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.0)]"
                      style={{ left: `${xPct}%`, top: `${yPct}%`, width: `${wPct}%`, height: `${hPct}%` }}
                    />
                  )}
                </div>
                <div className="flex items-center gap-3 p-3">
                  {r.transparent_png_url && (
                    <img
                      src={r.transparent_png_url}
                      alt="transparent cutout"
                      onClick={() => setEnlarge(r.transparent_png_url!)}
                      className="h-16 w-16 shrink-0 cursor-zoom-in rounded border border-zinc-700 object-contain"
                      style={{
                        backgroundImage:
                          "conic-gradient(#333 25%,#222 0 50%,#333 0 75%,#222 0)",
                        backgroundSize: "12px 12px",
                      }}
                    />
                  )}
                  <div className="min-w-0 text-xs">
                    <p className="font-semibold capitalize">
                      {r.element_type || "element"}
                      {r.element_label ? ` · ${r.element_label}` : ""}
                    </p>
                    <p className="text-zinc-400">
                      mask {bb.width ?? "?"}×{bb.height ?? "?"}px · {new Date(r.created_at).toLocaleString()}
                    </p>
                    {r.clean_background_url && (
                      <a
                        href={r.clean_background_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:underline"
                      >
                        open healed bg ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {enlarge && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6"
          onClick={() => setEnlarge(null)}
        >
          <img src={enlarge} alt="enlarged" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}
