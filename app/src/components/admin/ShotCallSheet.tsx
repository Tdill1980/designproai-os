/**
 * ShotCallSheet — today's shoot, and nothing else.
 *
 * The Shot List is a 97-item backlog. This is the short list: the shots dated
 * today, grouped under the script whose words get spoken, so the crew opens
 * one card and knows what to shoot and what to say — instead of scrolling a
 * board where everything looks equally urgent.
 *
 * It reads `due_date` (see `shootDay.ts`) — the same date the board already
 * sorts by — so "put it on today's list" and "date this shot" stay one idea.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Copy, Film, Camera, Check } from "lucide-react";
import { toast } from "sonner";
import { brandMeta } from "@/lib/content-tags";
import { buildCallSheet, callSheetText } from "@/lib/shootDay";
import { scriptBody, scriptLabel, shotCardLink, needsScript, type ShotRow } from "@/lib/shotScriptLink";

export default function ShotCallSheet({ rows }: { rows: ShotRow[] }) {
  const sheet = useMemo(() => buildCallSheet(rows), [rows]);

  if (!sheet.total) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
        <p className="text-sm font-semibold text-gray-700">Nothing is dated today.</p>
        <p className="mt-1 text-xs text-gray-500">
          Open a shot and tap <b>Today</b> to put it on the day's list — that's what the crew films.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-gray-900">
            Today's shoot — {sheet.total} shot{sheet.total === 1 ? "" : "s"}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {sheet.shot} of {sheet.total} already have footage
            {sheet.missingScript.length > 0 && (
              <span className="ml-1 font-semibold text-rose-600">
                · {sheet.missingScript.length} video shot{sheet.missingScript.length === 1 ? "" : "s"} with no script
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(callSheetText(sheet));
            toast.success("Call sheet copied — paste it to the crew.");
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-blue-400 hover:text-blue-600"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy for the crew
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {sheet.groups.map((g, i) => (
          <div key={g.script?.id || `unscripted-${i}`} className="rounded-lg border border-gray-200">
            {/* The words first — a crew reads the script, then shoots the list. */}
            <div className={g.script ? "border-b border-gray-200 bg-blue-50/60 p-2.5" : "border-b border-gray-200 bg-amber-50 p-2.5"}>
              {g.script ? (
                <>
                  <div className="text-[13px] font-bold text-gray-900">📜 {scriptLabel(g.script)}</div>
                  {scriptBody(g.script) && (
                    <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-[12px] leading-snug text-gray-700">
                      {scriptBody(g.script)}
                    </p>
                  )}
                </>
              ) : (
                <div className="text-[13px] font-bold text-amber-800">No script linked</div>
              )}
            </div>

            <ul className="divide-y divide-gray-100">
              {g.shots.map((s) => {
                const files = s.raw_asset_ids?.length ?? 0;
                const medium = needsScript(s) ? "video" : "photo";
                return (
                  <li key={s.id}>
                    <Link
                      to={shotCardLink(s.id)}
                      className="flex items-center gap-2 px-2.5 py-2 text-sm hover:bg-gray-50"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: brandMeta(s.brand as string).color }}
                        title={brandMeta(s.brand as string).label}
                      />
                      {medium === "video"
                        ? <Film className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                        : <Camera className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
                      <span className="truncate text-gray-800">{String(s.shot_title || "Untitled shot")}</span>
                      {files > 0 ? (
                        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-600">
                          <Check className="h-3 w-3" />{files}
                        </span>
                      ) : (
                        <span className="ml-auto shrink-0 text-[11px] text-gray-400">upload →</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
