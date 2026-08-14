import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plug, RefreshCw, Send } from "lucide-react";
import { cn } from "@/lib/utils";

// WHITE UI page (docs/WHITE_UI_STANDARD.md): white surface, dark text,
// blue→magenta gradient as accent only. The global black header/nav frame
// this content area — the page renders no chrome of its own.

const GRADIENT = "bg-gradient-to-r from-[#3b82f6] to-[#ec4899]";

interface AdRow {
  campaign: string;
  adset?: string;
  ad?: string;
  ad_id?: string;
  image?: string | null;     // live creative (full-size when Meta provides it)
  thumbnail?: string | null; // 512px creative thumbnail
  status?: string | null;    // Meta effective_status (ACTIVE, PAUSED, …)
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null; // %
  cpc: number | null;
  frequency: number | null;
  reach: number;
  roas: number | null;
  purchases: number;
  purchase_value: number;
  cpa: number | null;
}

interface Report {
  ok: boolean;
  error?: string;
  credential_source?: string;
  range: string;
  totals: { spend?: number; purchases?: number; purchase_value?: number; blended_roas?: number | null };
  campaigns: AdRow[];
}

// Mirror of marketing-agent ads_audit thresholds so the page and the Jackson
// tasks always agree on what a row's verdict is.
const MIN_SPEND = 50;
const TARGET_ROAS = 2;
const KILL_ROAS = 1;
const FATIGUE_FREQUENCY = 3.5;
const WEAK_CTR = 0.8;

type Verdict = "REMOVE" | "REPLACE" | "KEEP" | "LEARNING";

function verdictFor(r: AdRow): { verdict: Verdict; reason: string } {
  if (r.spend < MIN_SPEND) return { verdict: "LEARNING", reason: `Under $${MIN_SPEND} spend — not enough data yet.` };
  if (r.purchases === 0 && r.spend >= MIN_SPEND * 2)
    return { verdict: "REMOVE", reason: `$${r.spend} spent, zero purchases — pure burn.` };
  if (r.roas !== null && r.roas < KILL_ROAS)
    return { verdict: "REMOVE", reason: `ROAS ${r.roas} < ${KILL_ROAS} — returns less than it costs.` };
  if (r.frequency !== null && r.frequency >= FATIGUE_FREQUENCY)
    return { verdict: "REPLACE", reason: `Frequency ${r.frequency} — audience fatigue, refresh the creative.` };
  if (r.ctr !== null && r.ctr < WEAK_CTR)
    return { verdict: "REPLACE", reason: `CTR ${r.ctr}% — creative isn't stopping the scroll.` };
  if (r.roas !== null && r.roas < TARGET_ROAS)
    return { verdict: "REPLACE", reason: `ROAS ${r.roas} below the ${TARGET_ROAS} target — run a challenger.` };
  return { verdict: "KEEP", reason: `Healthy${r.roas !== null ? ` (ROAS ${r.roas})` : ""} — scale before touching.` };
}

const VERDICT_STYLES: Record<Verdict, string> = {
  REMOVE: "bg-red-50 text-red-700 border border-red-200",
  REPLACE: "bg-amber-50 text-amber-700 border border-amber-200",
  KEEP: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  LEARNING: "bg-gray-100 text-gray-600 border border-gray-200",
};

const DATE_PRESETS = [
  { value: "last_7d", label: "Last 7 days" },
  { value: "last_14d", label: "Last 14 days" },
  { value: "last_30d", label: "Last 30 days" },
  { value: "last_90d", label: "Last 90 days" },
] as const;

const fmtMoney = (n?: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtNum = (n?: number | null) => (n == null ? "—" : n.toLocaleString("en-US"));

// Shared Ads Manager panel — rendered by the standalone /admin/ads-performance
// page AND the Content Director "Ads" tab. One component, so the two surfaces
// can never drift.
export default function AdsPerformancePanel() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const [datePreset, setDatePreset] = useState<string>("last_30d");
  const [level, setLevel] = useState<"campaign" | "ad">("ad");

  const report = useQuery({
    queryKey: ["meta-ads-report", currentShop?.id, datePreset, level],
    queryFn: async (): Promise<Report> => {
      const { data, error } = await supabase.functions.invoke("meta-ads-report", {
        body: {
          date_preset: datePreset,
          level,
          ...(currentShop?.id ? { shop_id: currentShop.id } : {}),
        },
      });
      if (error) throw error;
      return data as Report;
    },
  });

  const notConnected =
    report.data?.ok === false && /No Meta ad account connected/i.test(report.data?.error ?? "");

  const sendToJackson = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: {
          action: "ads_audit",
          date_preset: datePreset,
          ...(currentShop?.id ? { shop_id: currentShop.id } : {}),
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as { cards: { id: string; kind: string }[] };
    },
    onSuccess: (d) => {
      const n = d.cards?.length ?? 0;
      toast({
        title: n ? `${n} task${n === 1 ? "" : "s"} sent to the Marketing Hub` : "Nothing to flag",
        description: n
          ? "Removal + replacement cards are on Jackson's board."
          : "Every ad passed — no removal or replacement tasks needed.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Audit failed", description: e.message, variant: "destructive" }),
  });

  const rows = (report.data?.ok ? report.data.campaigns : []) ?? [];
  const totals = report.data?.ok ? report.data.totals : undefined;

  return (
      <div className="space-y-8 text-gray-900">
        {/* Header */}
        <div className="space-y-3">
          <div className={cn("h-1 w-24 rounded-full", GRADIENT)} />
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              {/* WHITE UI wordmark: black base word + gradient "Pro" suffix,
                  the same treatment as DesignPro / ColorPro / GraphicsPro. */}
              <h2 className="text-3xl font-bold tracking-tight">
                <span className="text-gray-900">Ads</span>
                <span className={cn("bg-clip-text text-transparent", GRADIENT)}>Pro</span>
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                Live Meta ad results with remove / replace / keep verdicts — the same rules that
                build Jackson's task cards.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={datePreset} onValueChange={setDatePreset}>
                <SelectTrigger className="h-9 w-[150px] bg-white border-gray-300 text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex rounded-md border border-gray-300 overflow-hidden">
                {(["ad", "campaign"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLevel(l)}
                    className={cn(
                      "px-3 h-9 text-sm capitalize",
                      level === l ? cn("text-white", GRADIENT) : "bg-white text-gray-600 hover:bg-gray-50",
                    )}
                  >
                    {l === "ad" ? "By ad" : "By campaign"}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() => report.refetch()}
                disabled={report.isFetching}
              >
                <RefreshCw className={cn("h-4 w-4", report.isFetching && "animate-spin")} />
              </Button>
            </div>
          </div>
        </div>

        {/* Not connected */}
        {notConnected && (
          <div className="rounded-xl border border-gray-200 p-10 text-center space-y-4">
            <div className={cn("mx-auto h-12 w-12 rounded-full flex items-center justify-center text-white", GRADIENT)}>
              <Plug className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No Meta ad account connected</h2>
              <p className="text-gray-500 text-sm mt-1 max-w-md mx-auto">
                Connect Meta and pick your ad account — this page lights up with live spend, ROAS,
                and verdicts the moment it's linked.
              </p>
            </div>
            <Button asChild className={cn("text-white border-0", GRADIENT)}>
              <Link to="/admin/seo/connections">Connect Meta</Link>
            </Button>
          </div>
        )}

        {/* Error (other than not-connected) */}
        {report.data?.ok === false && !notConnected && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            {report.data.error}
          </div>
        )}
        {report.error instanceof Error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            {report.error.message}
          </div>
        )}

        {report.isLoading && (
          <div className="flex items-center justify-center gap-2 py-20 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Pulling live ad data…
          </div>
        )}

        {report.data?.ok && (
          <>
            {/* Stat tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Spend", value: fmtMoney(totals?.spend) },
                { label: "Purchases", value: fmtNum(totals?.purchases) },
                { label: "Revenue", value: fmtMoney(totals?.purchase_value) },
                { label: "Blended ROAS", value: totals?.blended_roas != null ? `${totals.blended_roas}×` : "—" },
              ].map((t) => (
                <div key={t.label} className="rounded-xl border border-gray-200 p-5">
                  <div className="text-xs uppercase tracking-wide text-gray-500">{t.label}</div>
                  <div className="text-2xl font-semibold mt-1">{t.value}</div>
                </div>
              ))}
            </div>

            {/* Verdict table */}
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <div>
                  <h2 className="font-semibold">
                    {level === "ad" ? "Ads" : "Campaigns"}{" "}
                    <span className="text-gray-400 font-normal text-sm">· {report.data.range}</span>
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Sorted by spend. Verdicts use the audit thresholds (kill ROAS {KILL_ROAS}, target{" "}
                    {TARGET_ROAS}, fatigue frequency {FATIGUE_FREQUENCY}).
                  </p>
                </div>
                <Button
                  size="sm"
                  className={cn("text-white border-0", GRADIENT)}
                  onClick={() => sendToJackson.mutate()}
                  disabled={sendToJackson.isPending || rows.length === 0}
                >
                  {sendToJackson.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-1.5" />
                  )}
                  Send tasks to Jackson
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                      <th className="px-5 py-3 font-medium">{level === "ad" ? "Ad" : "Campaign"}</th>
                      <th className="px-3 py-3 font-medium text-right">Spend</th>
                      <th className="px-3 py-3 font-medium text-right">Purchases</th>
                      <th className="px-3 py-3 font-medium text-right">Revenue</th>
                      <th className="px-3 py-3 font-medium text-right">ROAS</th>
                      <th className="px-3 py-3 font-medium text-right">CTR</th>
                      <th className="px-3 py-3 font-medium text-right">Freq</th>
                      <th className="px-3 py-3 font-medium text-right">CPA</th>
                      <th className="px-5 py-3 font-medium">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const v = verdictFor(r);
                      return (
                        <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              {level === "ad" && (
                                r.thumbnail || r.image ? (
                                  <a
                                    href={r.image ?? r.thumbnail ?? undefined}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Open live creative"
                                    className="shrink-0"
                                  >
                                    <img
                                      src={r.thumbnail ?? r.image ?? undefined}
                                      alt={r.ad ?? r.campaign}
                                      loading="lazy"
                                      className="h-14 w-14 rounded-md object-cover border border-gray-200"
                                    />
                                  </a>
                                ) : (
                                  <div className="h-14 w-14 shrink-0 rounded-md border border-dashed border-gray-200 flex items-center justify-center text-[10px] text-gray-400">
                                    no img
                                  </div>
                                )
                              )}
                              <div>
                                <div className="font-medium text-gray-900">{r.ad ?? r.campaign}</div>
                                {r.ad && (
                                  <div className="text-xs text-gray-500">
                                    {r.campaign}
                                    {r.adset ? ` · ${r.adset}` : ""}
                                  </div>
                                )}
                                {r.status && r.status !== "ACTIVE" && (
                                  <div className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{r.status}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right">{fmtMoney(r.spend)}</td>
                          <td className="px-3 py-3 text-right">{fmtNum(r.purchases)}</td>
                          <td className="px-3 py-3 text-right">{fmtMoney(r.purchase_value)}</td>
                          <td className="px-3 py-3 text-right font-medium">
                            {r.roas != null ? `${r.roas}×` : "—"}
                          </td>
                          <td className="px-3 py-3 text-right">{r.ctr != null ? `${r.ctr}%` : "—"}</td>
                          <td
                            className={cn(
                              "px-3 py-3 text-right",
                              r.frequency != null && r.frequency >= FATIGUE_FREQUENCY && "text-amber-600 font-medium",
                            )}
                          >
                            {r.frequency ?? "—"}
                          </td>
                          <td className="px-3 py-3 text-right">{fmtMoney(r.cpa)}</td>
                          <td className="px-5 py-3">
                            <Badge className={cn("font-medium shadow-none hover:bg-inherit", VERDICT_STYLES[v.verdict])}>
                              {v.verdict}
                            </Badge>
                            <div className="text-xs text-gray-500 mt-1 max-w-[260px]">{v.reason}</div>
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-5 py-10 text-center text-gray-500">
                          No rows in this range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {report.data.credential_source === "env" && (
              <p className="text-xs text-gray-400">
                Reading from env-secret credentials (fallback). Connect Meta per-shop on{" "}
                <Link to="/admin/seo/connections" className="underline">
                  Connections
                </Link>{" "}
                for the durable path.
              </p>
            )}
          </>
        )}
      </div>
  );
}
