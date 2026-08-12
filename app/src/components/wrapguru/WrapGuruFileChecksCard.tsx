import { useQuery } from "@tanstack/react-query";
import { FileCheck2, Loader2, AlertTriangle, CheckCircle2, Wrench, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * WrapGuruFileChecksCard — every print-file check a visitor ran in the chat.
 *
 * Reads public.wrapguru_file_checks (admin RLS), written by the
 * `wrapguru-file-check` edge function. Each row is a REAL byte-level parse
 * (true dimensions, embedded DPI, color space, vector/raster) scored against
 * the wrap's square footage, plus the outcome the customer was routed to:
 * a cart link, a paid prep, or a recreate.
 *
 * `not_usable` / `needs_prep` rows are the ones the design team was emailed
 * about — they are the follow-up queue, so they lead.
 */

const GRADIENT = "linear-gradient(90deg,#3b82f6,#ec4899)";

type Check = {
  id: string;
  session_id: string;
  file_name: string;
  file_size: number | null;
  customer_email: string | null;
  vehicle: string | null;
  sqft: number | null;
  score: number;
  verdict: "print_ready" | "needs_prep" | "not_usable";
  checks: { label: string; value: string; status: "pass" | "warn" | "fail" | "info" }[] | null;
  issues: string[] | null;
  team_notified: boolean;
  notify_channel: string | null;
  created_at: string;
};

const VERDICT = {
  print_ready: { label: "Print-ready", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  needs_prep: { label: "Needs prep", cls: "bg-amber-50 text-amber-700 border-amber-200", Icon: Wrench },
  not_usable: { label: "Not usable", cls: "bg-rose-50 text-rose-700 border-rose-200", Icon: AlertTriangle },
} as const;

const STATUS_CLS = {
  pass: "text-emerald-600",
  warn: "text-amber-600",
  fail: "text-rose-600",
  info: "text-gray-500",
} as const;

function fmt(ts: string) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
function fmtSize(b: number | null) {
  if (!b) return "";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function WrapGuruFileChecksCard() {
  const { data: checks = [], isLoading } = useQuery({
    queryKey: ["wrapguru-file-checks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wrapguru_file_checks" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as Check[];
    },
    refetchInterval: 60_000,
  });

  const needsReview = checks.filter((c) => c.verdict !== "print_ready").length;

  return (
    <div id="file-checks" className="scroll-mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm p-4 sm:p-5 mb-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="flex items-center justify-center w-9 h-9 rounded-lg text-white" style={{ background: GRADIENT }}>
          <FileCheck2 className="w-4.5 h-4.5" />
        </span>
        <div>
          <h2 className="font-semibold">Print-file checks</h2>
          <p className="text-sm text-gray-500">
            Artwork dropped in the chat, scored against the real wrap size
            {needsReview > 0 && <> · <span className="font-semibold text-rose-600">{needsReview} need review</span></>}
          </p>
        </div>
        <span className="ml-auto text-sm text-gray-400">{checks.length}</span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading checks…
        </div>
      ) : checks.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          No files checked yet. Visitors attach artwork with the paperclip in the WrapGuru chat.
        </p>
      ) : (
        <div className="space-y-2.5">
          {checks.map((c) => {
            const v = VERDICT[c.verdict] || VERDICT.needs_prep;
            return (
              <div key={c.id} className="rounded-xl border border-gray-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-full border ${v.cls}`}>
                    <v.Icon className="w-3 h-3" /> {v.label}
                  </span>
                  <span className="font-medium text-sm truncate max-w-[240px]" title={c.file_name}>{c.file_name}</span>
                  <span className="text-xs text-gray-400">{fmtSize(c.file_size)}</span>
                  <span className="ml-auto text-sm font-bold" style={{ color: c.score >= 7 ? "#059669" : c.score >= 5 ? "#d97706" : "#e11d48" }}>
                    {c.score}/10
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  {c.vehicle && <span>{c.vehicle}</span>}
                  {c.sqft && <span>{c.sqft} sq ft</span>}
                  {c.customer_email && <span className="text-gray-700">{c.customer_email}</span>}
                  <span>{fmt(c.created_at)}</span>
                  {/* Say plainly whether anyone was actually reached. A flagged
                      file nobody was told about is the failure worth seeing. */}
                  {c.verdict !== "print_ready" && (
                    c.team_notified ? (
                      <span className="inline-flex items-center gap-1 text-blue-600 font-medium">
                        <Mail className="w-3 h-3" /> team alerted via {c.notify_channel || "email"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                        <AlertTriangle className="w-3 h-3" /> team NOT alerted — needs manual follow-up
                      </span>
                    )
                  )}
                </div>

                {!!c.checks?.length && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {c.checks.map((k, i) => (
                      <span key={i} className="text-gray-500">
                        {k.label}: <span className={`font-semibold ${STATUS_CLS[k.status]}`}>{k.value}</span>
                      </span>
                    ))}
                  </div>
                )}

                {!!c.issues?.length && (
                  <ul className="mt-2 space-y-0.5">
                    {c.issues.map((it, i) => (
                      <li key={i} className="text-xs text-rose-700 flex gap-1.5">
                        <span className="shrink-0">•</span>{it}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
