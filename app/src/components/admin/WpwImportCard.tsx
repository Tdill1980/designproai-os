import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Download, CheckCircle2, AlertCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ImportResult {
  ok: boolean;
  dryRun: boolean;
  fetched: number;
  written: number;
  skipped_no_email: number;
  skipped_unsubscribed: number;
  pages_processed: number;
  last_page_size: number;
  sample: { email: string; first_name: string | null }[];
  error?: string;
}

export function WpwImportCard() {
  const qc = useQueryClient();
  const [running, setRunning] = useState<"idle" | "dry" | "real">("idle");
  const [result, setResult] = useState<ImportResult | null>(null);

  const { data: counts, refetch: refetchCounts } = useQuery({
    queryKey: ["mightymail-subscriber-counts"],
    queryFn: async () => {
      const totalRes = await (supabase as any)
        .from("email_subscribers")
        .select("*", { count: "exact", head: true });
      const wpwRes = await (supabase as any)
        .from("email_subscribers")
        .select("*", { count: "exact", head: true })
        .eq("source", "wpw_past_customer");
      const shopRes = await (supabase as any)
        .from("email_subscribers")
        .select("*", { count: "exact", head: true })
        .eq("source", "shop_onboarding");
      const optedOutRes = await (supabase as any)
        .from("email_subscribers")
        .select("*", { count: "exact", head: true })
        .eq("unsubscribed", true);
      return {
        total: totalRes.count ?? 0,
        wpw: wpwRes.count ?? 0,
        shop: shopRes.count ?? 0,
        optedOut: optedOutRes.count ?? 0,
      };
    },
    refetchInterval: 30_000,
  });

  const runImport = async (dryRun: boolean) => {
    setRunning(dryRun ? "dry" : "real");
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("wpw-customers-import", {
        body: { dryRun },
      });
      if (error) throw error;
      const res = data as ImportResult;
      setResult(res);
      if (res.ok) {
        toast.success(
          dryRun
            ? `Dry-run complete: ${res.fetched} customers across ${res.pages_processed} pages`
            : `Imported ${res.written} customers (${res.skipped_unsubscribed} opt-outs preserved)`,
        );
        if (!dryRun) {
          qc.invalidateQueries({ queryKey: ["mightymail-subscriber-counts"] });
          refetchCounts();
        }
      } else {
        toast.error(res.error || "Import failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Import failed");
      setResult({ ok: false, error: err.message } as ImportResult);
    } finally {
      setRunning("idle");
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 mb-6">
      <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 flex items-center justify-center shrink-0">
          <Users className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-gray-900">Subscriber audience</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <Stat label="Total" value={counts?.total} />
            <Stat label="WPW past customers" value={counts?.wpw} accent />
            <Stat label="Shop onboarding" value={counts?.shop} />
            <Stat label="Opt-outs" value={counts?.optedOut} muted />
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-cyan-200 bg-cyan-50/60 p-4">
        <div className="flex items-start gap-3">
          <Download className="w-5 h-5 text-cyan-700 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">
              Import past WPW customers
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              Pulls every customer from <span className="font-mono">weprintwraps.com</span> via
              the Woo REST API and adds them as <span className="font-mono">wpw_past_customer</span>.
              Existing opt-outs are preserved. Re-running is safe (upsert on email).
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => runImport(true)}
                disabled={running !== "idle"}
              >
                {running === "dry" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Dry-running…
                  </>
                ) : (
                  "Dry-run (count only)"
                )}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (!confirm("Pull and upsert every WPW customer into MightyMail subscribers? Safe to re-run.")) return;
                  runImport(false);
                }}
                disabled={running !== "idle"}
              >
                {running === "real" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Importing…
                  </>
                ) : (
                  "Import all WPW customers"
                )}
              </Button>
            </div>
          </div>
        </div>

        {result && (
          <div className="mt-4 rounded-lg bg-white border border-gray-200 p-3 text-xs text-gray-700">
            <div className="flex items-center gap-2 mb-2">
              {result.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-500" />
              )}
              <span className="font-semibold">
                {result.ok
                  ? result.dryRun
                    ? "Dry-run result"
                    : "Import complete"
                  : "Import failed"}
              </span>
            </div>
            {result.ok ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                  <KV k="Fetched" v={result.fetched} />
                  <KV k="Written" v={result.written} />
                  <KV k="No email" v={result.skipped_no_email} />
                  <KV k="Opt-outs preserved" v={result.skipped_unsubscribed} />
                  <KV k="Pages processed" v={result.pages_processed} />
                  <KV k="Last page size" v={result.last_page_size} />
                </div>
                {result.sample.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-cyan-700 text-xs">
                      Sample ({result.sample.length})
                    </summary>
                    <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-gray-600">
                      {result.sample.map((s, i) => (
                        <li key={i}>
                          {s.first_name ? `${s.first_name} — ` : ""}
                          {s.email}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className="text-red-600">{result.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: number | undefined;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        accent
          ? "border-cyan-200 bg-cyan-50"
          : muted
            ? "border-gray-200 bg-gray-50"
            : "border-gray-200 bg-white"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </div>
      <div
        className={`text-xl font-bold ${
          accent ? "text-cyan-700" : muted ? "text-gray-500" : "text-gray-900"
        }`}
      >
        {value === undefined ? "—" : value.toLocaleString()}
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: number }) {
  return (
    <div>
      <span className="text-gray-500">{k}: </span>
      <span className="font-semibold text-gray-900">{v.toLocaleString()}</span>
    </div>
  );
}
