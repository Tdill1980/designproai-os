/**
 * AffiliateAdminAnalytics — admin-side "everyone's sales at a glance"
 * panel for /admin/affiliates. Light theme, matches ApprovePro /
 * /admin/try-landing visual language.
 *
 * Four surfaces stacked top-to-bottom:
 *
 *   1. KPI row (4 cards):
 *      - Commission paid this period
 *      - Active reps (status='active' OR 'approved')
 *      - Top performer (most commission this period)
 *      - Total referrals this period
 *
 *   2. Stacked bar chart of monthly commission per rep (last 6 months).
 *      Each bar segment uses the rep's brand accent when the rep is
 *      in WPW_REPS; otherwise a fallback palette cycles.
 *
 *   3. Leaderboard table — rep · referrals this period · commission
 *      this period · all-time commission · "Open landing" link.
 *
 *   4. Quick-share rail — every rep with their /wpw/<slug> landing
 *      URL plus the /affiliate/login bank-connect URL, each with a
 *      copy button so the admin can text either link from the
 *      browser. Phones treat the copied text as a link.
 *
 * Period selector: 30d / 90d / 6mo / YTD. Drives the KPI row + the
 * leaderboard. The chart always shows the last 6 months for shape.
 *
 * Data sources: affiliate_partners (already typed) + affiliate_commissions
 * + affiliate_referrals. The two commission/referral tables aren't in
 * the generated types.ts yet so queries cast through `as any` (project
 * pattern; see useAffiliatePartners).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DollarSign,
  Users,
  Trophy,
  TrendingUp,
  ExternalLink,
  Loader2,
  Copy,
  Check,
  Landmark,
  Link as LinkIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAffiliatePartners } from "@/hooks/useAffiliatePartners";
import { WPW_REPS, getWpwRepByPartnerCode } from "@/lib/wpw-reps";
import { cn } from "@/lib/utils";
import type {
  AffiliatePartner,
  AffiliateCommission,
  AffiliateReferral,
} from "@/types/affiliate";

type Period = "30d" | "90d" | "6mo" | "ytd";

const PERIOD_LABEL: Record<Period, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "6mo": "Last 6 months",
  ytd: "Year to date",
};

const FALLBACK_PALETTE = [
  "#0EA5E9", "#22C55E", "#F97316", "#EC4899",
  "#7C3AED", "#E11D48", "#06B6D4", "#D97706",
  "#A855F7", "#16A34A", "#F59E0B", "#3B82F6",
];

const CHART_MONTHS = 6;

const startOf = (period: Period): Date => {
  const now = new Date();
  switch (period) {
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "6mo":
      return new Date(now.getFullYear(), now.getMonth() - 6, 1);
    case "ytd":
      return new Date(now.getFullYear(), 0, 1);
  }
};

const monthsAgo = (n: number): Date => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - n, 1);
};

const monthKey = (d: Date | string): string => {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};

const monthLabel = (key: string): string => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "2-digit",
  });
};

const fmt = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const origin = () =>
  typeof window !== "undefined"
    ? window.location.origin
    : "https://restyleproai.com";

interface AffiliateAdminAnalyticsProps {
  className?: string;
}

export const AffiliateAdminAnalytics = ({
  className,
}: AffiliateAdminAnalyticsProps) => {
  const [period, setPeriod] = useState<Period>("30d");
  const navigate = useNavigate();

  const { data: partners = [], isLoading: partnersLoading } =
    useAffiliatePartners();

  const { data: commissions = [], isLoading: commissionsLoading } = useQuery({
    queryKey: ["admin-affiliate-commissions", "6mo"],
    queryFn: async (): Promise<AffiliateCommission[]> => {
      const sixMonthsAgo = monthsAgo(CHART_MONTHS).toISOString();
      const { data, error } = await (
        supabase.from("affiliate_commissions" as never) as unknown as {
          select: (q: string) => {
            gte: (
              c: string,
              v: string,
            ) => Promise<{
              data: AffiliateCommission[] | null;
              error: unknown;
            }>;
          };
        }
      )
        .select("*")
        .gte("created_at", sixMonthsAgo);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const { data: referrals = [], isLoading: referralsLoading } = useQuery({
    queryKey: ["admin-affiliate-referrals", "6mo"],
    queryFn: async (): Promise<AffiliateReferral[]> => {
      const sixMonthsAgo = monthsAgo(CHART_MONTHS).toISOString();
      const { data, error } = await (
        supabase.from("affiliate_referrals" as never) as unknown as {
          select: (q: string) => {
            gte: (
              c: string,
              v: string,
            ) => Promise<{
              data: AffiliateReferral[] | null;
              error: unknown;
            }>;
          };
        }
      )
        .select("*")
        .gte("created_at", sixMonthsAgo);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const loading = partnersLoading || commissionsLoading || referralsLoading;

  // ── derived metrics ───────────────────────────────────────
  const periodStart = startOf(period);
  const periodStartTs = periodStart.getTime();

  const partnerById = useMemo(() => {
    const m = new Map<string, AffiliatePartner>();
    for (const p of partners) m.set(p.id, p);
    return m;
  }, [partners]);

  const accentFor = (partner: AffiliatePartner, idx: number): string => {
    const rep =
      WPW_REPS[partner.referral_code?.toLowerCase() ?? ""] ??
      getWpwRepByPartnerCode(partner.referral_code);
    if (rep?.accent) return rep.accent;
    return FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
  };

  const commissionsInPeriod = commissions.filter(
    (c) => new Date(c.created_at).getTime() >= periodStartTs,
  );
  const referralsInPeriod = referrals.filter(
    (r) => new Date(r.created_at).getTime() >= periodStartTs,
  );

  const totalCommissionInPeriod = commissionsInPeriod.reduce(
    (sum, c) => sum + Number(c.amount || 0),
    0,
  );

  const activeRepCount = partners.filter(
    (p) => p.status === "active" || p.status === "approved",
  ).length;

  const repTotalsInPeriod = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of commissionsInPeriod) {
      m.set(c.affiliate_id, (m.get(c.affiliate_id) ?? 0) + Number(c.amount || 0));
    }
    return m;
  }, [commissionsInPeriod]);

  const repReferralsInPeriod = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of referralsInPeriod) {
      m.set(r.affiliate_id, (m.get(r.affiliate_id) ?? 0) + 1);
    }
    return m;
  }, [referralsInPeriod]);

  const topPerformerEntry = useMemo(() => {
    let bestId: string | null = null;
    let bestAmount = 0;
    for (const [id, amt] of repTotalsInPeriod) {
      if (amt > bestAmount) {
        bestAmount = amt;
        bestId = id;
      }
    }
    if (!bestId) return null;
    return { partner: partnerById.get(bestId), amount: bestAmount };
  }, [repTotalsInPeriod, partnerById]);

  const chartData = useMemo(() => {
    const buckets: { month: string; label: string }[] = [];
    for (let i = CHART_MONTHS - 1; i >= 0; i--) {
      const d = monthsAgo(i);
      const key = monthKey(d);
      buckets.push({ month: key, label: monthLabel(key) });
    }
    const grouped = new Map<string, Map<string, number>>();
    for (const c of commissions) {
      const k = monthKey(c.created_at);
      const repMap = grouped.get(k) ?? new Map();
      repMap.set(c.affiliate_id, (repMap.get(c.affiliate_id) ?? 0) + Number(c.amount || 0));
      grouped.set(k, repMap);
    }
    const repIdsInWindow = new Set<string>();
    for (const repMap of grouped.values()) {
      for (const id of repMap.keys()) repIdsInWindow.add(id);
    }
    const series = Array.from(repIdsInWindow)
      .map((id, idx) => {
        const partner = partnerById.get(id);
        if (!partner) return null;
        return {
          id,
          name: partner.full_name,
          color: accentFor(partner, idx),
        };
      })
      .filter((x): x is { id: string; name: string; color: string } => !!x);

    const rows = buckets.map((b) => {
      const row: Record<string, string | number> = { month: b.label };
      const repMap = grouped.get(b.month);
      for (const s of series) {
        row[s.name] = repMap?.get(s.id) ?? 0;
      }
      return row;
    });

    return { rows, series };
  }, [commissions, partnerById]);

  const leaderboardRows = useMemo(() => {
    return partners
      .map((p, idx) => ({
        partner: p,
        accent: accentFor(p, idx),
        referrals: repReferralsInPeriod.get(p.id) ?? 0,
        periodCommission: repTotalsInPeriod.get(p.id) ?? 0,
        allTimeCommission: Number(p.total_earned ?? 0),
      }))
      .sort((a, b) => b.periodCommission - a.periodCommission);
  }, [partners, repReferralsInPeriod, repTotalsInPeriod]);

  return (
    <div className={cn("space-y-5 text-gray-900", className)}>
      {/* Header + period selector */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold leading-none text-gray-900">
            Sales Analytics
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Everyone&apos;s commission, referrals, and ranking — at a glance.
          </p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-[170px] bg-white border-gray-200 text-gray-900">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
              <SelectItem key={p} value={p}>
                {PERIOD_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Commission paid"
          sub={PERIOD_LABEL[period]}
          value={loading ? "…" : fmt(totalCommissionInPeriod)}
          accent="emerald"
        />
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          label="Active reps"
          sub="status: active or approved"
          value={loading ? "…" : String(activeRepCount)}
          accent="sky"
        />
        <KpiCard
          icon={<Trophy className="h-4 w-4" />}
          label="Top performer"
          sub={
            topPerformerEntry?.partner
              ? `${fmt(topPerformerEntry.amount)} ${PERIOD_LABEL[period].toLowerCase()}`
              : "no commission yet"
          }
          value={
            loading
              ? "…"
              : topPerformerEntry?.partner?.full_name ?? "—"
          }
          accent="amber"
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Referrals"
          sub={PERIOD_LABEL[period]}
          value={loading ? "…" : String(referralsInPeriod.length)}
          accent="fuchsia"
        />
      </div>

      {/* Stacked bar chart */}
      <Card className="bg-white border-gray-200 shadow-sm">
        <CardHeader className="pb-2 border-b border-gray-100">
          <CardTitle className="text-base text-gray-900">
            Commission by rep · last 6 months
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {loading ? (
            <div className="h-72 flex items-center justify-center text-sm text-gray-500 gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : chartData.series.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-sm text-gray-500">
              No commission recorded in the last 6 months.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData.rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#475569" }} />
                <YAxis
                  tick={{ fontSize: 12, fill: "#475569" }}
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip
                  cursor={{ fill: "rgba(15, 23, 42, 0.04)" }}
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{
                    background: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    color: "#0f172a",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: "#475569" }} />
                {chartData.series.map((s) => (
                  <Bar
                    key={s.id}
                    dataKey={s.name}
                    stackId="rep"
                    fill={s.color}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Leaderboard */}
      <Card className="bg-white border-gray-200 shadow-sm">
        <CardHeader className="pb-2 border-b border-gray-100">
          <CardTitle className="text-base text-gray-900">
            Leaderboard · {PERIOD_LABEL[period]}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-500">
              Loading…
            </div>
          ) : leaderboardRows.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              No affiliates yet.
            </div>
          ) : (
            <div className="rounded-md border border-gray-200 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="text-gray-700">Rep</TableHead>
                    <TableHead className="text-gray-700">Status</TableHead>
                    <TableHead className="text-right text-gray-700">
                      Referrals · period
                    </TableHead>
                    <TableHead className="text-right text-gray-700">
                      Commission · period
                    </TableHead>
                    <TableHead className="text-right text-gray-700">
                      Commission · all time
                    </TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboardRows.map((row, idx) => (
                    <TableRow key={row.partner.id} className="hover:bg-gray-50">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ background: row.accent }}
                          />
                          <div>
                            <div className="font-semibold text-sm leading-tight text-gray-900">
                              {row.partner.full_name}
                              {idx === 0 && row.periodCommission > 0 && (
                                <Trophy className="inline h-3.5 w-3.5 ml-1.5 text-amber-500" />
                              )}
                            </div>
                            <div className="text-[11px] text-gray-500 leading-tight">
                              {row.partner.referral_code}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase tracking-wider border-gray-300 text-gray-700 bg-white"
                        >
                          {row.partner.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-gray-900">
                        {row.referrals}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-emerald-600">
                        {fmt(row.periodCommission)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-gray-600">
                        {fmt(row.allTimeCommission)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate(
                              `/wpw/${row.partner.referral_code.toLowerCase()}`,
                            )
                          }
                          className="gap-1 text-xs h-7 border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          Landing
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick-share rail — text-friendly links per rep */}
      <Card className="bg-white border-gray-200 shadow-sm">
        <CardHeader className="pb-2 border-b border-gray-100">
          <CardTitle className="text-base text-gray-900 flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-sky-500" />
            Quick-share links per rep
          </CardTitle>
          <p className="text-xs text-gray-500 mt-1">
            Tap any link to copy. Paste into an iMessage / WhatsApp / SMS —
            phones render both URLs as taps. The bank-connect link sends the
            rep to <span className="font-mono">/affiliate/login</span>; if
            they have no account yet it bounces them to{" "}
            <span className="font-mono">/affiliate/join</span>.
          </p>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          {partners.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              No affiliates yet.
            </div>
          ) : (
            partners.map((p, idx) => {
              const slug = p.referral_code.toLowerCase();
              const landing = `${origin()}/wpw/${slug}`;
              const bank = `${origin()}/affiliate/login`;
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-gray-200 bg-gray-50/50 p-3 sm:p-4"
                >
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: accentFor(p, idx) }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-gray-900 leading-tight truncate">
                        {p.full_name}
                      </div>
                      <div className="text-[11px] text-gray-500 leading-tight">
                        {p.email}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase tracking-wider border-gray-300 text-gray-700 bg-white shrink-0"
                    >
                      {p.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <CopyRow
                      label="Landing page"
                      url={landing}
                      icon={<LinkIcon className="h-3.5 w-3.5" />}
                      accent={accentFor(p, idx)}
                    />
                    <CopyRow
                      label="Bank connect"
                      url={bank}
                      icon={<Landmark className="h-3.5 w-3.5" />}
                      accent="#0F172A"
                    />
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ── KpiCard ───────────────────────────────────────────────

const ACCENT: Record<
  "emerald" | "sky" | "amber" | "fuchsia",
  { bg: string; ring: string; text: string }
> = {
  emerald: { bg: "bg-emerald-50",  ring: "ring-emerald-200",  text: "text-emerald-600" },
  sky:     { bg: "bg-sky-50",      ring: "ring-sky-200",      text: "text-sky-600" },
  amber:   { bg: "bg-amber-50",    ring: "ring-amber-200",    text: "text-amber-600" },
  fuchsia: { bg: "bg-fuchsia-50",  ring: "ring-fuchsia-200",  text: "text-fuchsia-600" },
};

const KpiCard = ({
  icon,
  label,
  sub,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  value: string;
  accent: keyof typeof ACCENT;
}) => {
  const a = ACCENT[accent];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center justify-center w-7 h-7 rounded-md ring-1",
            a.bg,
            a.ring,
            a.text,
          )}
        >
          {icon}
        </span>
        <div className="text-[10px] uppercase tracking-wider font-bold text-gray-500">
          {label}
        </div>
      </div>
      <div
        className="text-2xl font-extrabold leading-none truncate text-gray-900"
        title={value}
      >
        {value}
      </div>
      <div className="text-[11px] text-gray-500 truncate" title={sub}>
        {sub}
      </div>
    </div>
  );
};

// ── CopyRow ───────────────────────────────────────────────

const CopyRow = ({
  label,
  url,
  icon,
  accent,
}: {
  label: string;
  url: string;
  icon: React.ReactNode;
  accent: string;
}) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(`${label} link copied`);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — select manually");
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="group flex items-center gap-2 w-full rounded-lg border border-gray-200 bg-white hover:border-gray-300 px-3 py-2 text-left transition"
    >
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded text-white shrink-0"
        style={{ background: accent }}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider font-bold text-gray-500">
          {label}
        </div>
        <div className="text-xs font-mono text-gray-700 truncate">{url}</div>
      </div>
      {copied ? (
        <Check className="h-4 w-4 text-emerald-600 shrink-0" />
      ) : (
        <Copy className="h-4 w-4 text-gray-400 group-hover:text-gray-700 shrink-0" />
      )}
    </button>
  );
};
