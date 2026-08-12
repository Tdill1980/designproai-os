import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Gauge,
  Settings,
  KeyRound,
  ShieldCheck,
  TrendingUp,
  Plus,
  Loader2,
  Search,
  BarChart3,
  DollarSign,
  Star,
  Zap,
  Globe,
  Layers,
  Calendar,
  FileBarChart,
  MapPin,
} from "lucide-react";

interface BlogPostRow {
  id: string;
  title: string;
  status: string;
  seo_score: number | null;
  updated_at: string;
  published_at: string | null;
  external_url: string | null;
  intent: string;
}

export default function AdminSeoDashboard() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [auditUrl, setAuditUrl] = useState("");

  const conn = useQuery({
    queryKey: ["seo-connection-wp", currentShop?.id],
    enabled: !!currentShop?.id,
    queryFn: async () => {
      if (!currentShop) return null;
      const { data } = await supabase
        .from("tenant_site_connections")
        .select("id, platform, is_active, site_url, metadata")
        .eq("shop_id", currentShop.id)
        .eq("platform", "wordpress")
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
  });

  const recentPosts = useQuery({
    queryKey: ["seo-recent-posts", currentShop?.id],
    enabled: !!currentShop?.id,
    queryFn: async (): Promise<BlogPostRow[]> => {
      if (!currentShop) return [];
      const { data, error } = await supabase
        .from("seo_blog_posts")
        .select("id, title, status, seo_score, updated_at, published_at, external_url, intent")
        .eq("shop_id", currentShop.id)
        .order("updated_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as BlogPostRow[];
    },
  });

  const stats = useQuery({
    queryKey: ["seo-stats", currentShop?.id],
    enabled: !!currentShop?.id,
    queryFn: async () => {
      if (!currentShop) return { drafts: 0, published: 0, avgScore: 0, totalAudits: 0 };
      const [drafts, published, audits] = await Promise.all([
        supabase
          .from("seo_blog_posts")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", currentShop.id)
          .eq("status", "draft"),
        supabase
          .from("seo_blog_posts")
          .select("id, seo_score", { count: "exact" })
          .eq("shop_id", currentShop.id)
          .eq("status", "published"),
        supabase
          .from("seo_audit_runs")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", currentShop.id),
      ]);
      const scores = (published.data ?? [])
        .map((r: { seo_score: number | null }) => r.seo_score)
        .filter((s): s is number => typeof s === "number");
      const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      return {
        drafts: drafts.count ?? 0,
        published: published.count ?? 0,
        avgScore,
        totalAudits: audits.count ?? 0,
      };
    },
  });

  const auditMutation = useMutation({
    mutationFn: async () => {
      if (!currentShop) throw new Error("No shop selected");
      const { data, error } = await supabase.functions.invoke("seo-page-audit", {
        body: { shop_id: currentShop.id, url: auditUrl, persist: true },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as { score: number };
    },
    onSuccess: (data) => {
      toast({ title: `Audit complete — score ${data.score}/100` });
      qc.invalidateQueries({ queryKey: ["seo-stats", currentShop?.id] });
    },
    onError: (e: Error) => {
      toast({ title: "Audit failed", description: e.message, variant: "destructive" });
    },
  });

  const newPostMutation = useMutation({
    mutationFn: async () => {
      if (!currentShop) throw new Error("No shop selected");
      const { data, error } = await supabase
        .from("seo_blog_posts")
        .insert({
          shop_id: currentShop.id,
          title: "Untitled draft",
          slug: `draft-${Date.now()}`,
          status: "draft",
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: { id: string }) => {
      window.location.href = `/admin/seo/blog/${data.id}`;
    },
    onError: (e: Error) =>
      toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  if (!currentShop) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 p-8">
        <p>Select a shop to view its SEO dashboard.</p>
      </div>
    );
  }

  const isConnected = !!conn.data;

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">SEO Dashboard</h1>
            <p className="text-zinc-400 text-sm mt-1">
              {currentShop.name} · {isConnected ? "Connected" : "Not connected"}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo/keywords">
                <KeyRound className="h-4 w-4 mr-1" /> Keywords
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo/reviews">
                <Star className="h-4 w-4 mr-1" /> Reviews
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo/pages">
                <Layers className="h-4 w-4 mr-1" /> Pages
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo/indexing">
                <Globe className="h-4 w-4 mr-1" /> Indexing
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo/gbp-posts">
                <Calendar className="h-4 w-4 mr-1" /> GBP scheduler
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo/reports">
                <FileBarChart className="h-4 w-4 mr-1" /> Reports
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo/ctr-sweep">
                <Zap className="h-4 w-4 mr-1" /> CTR sweep
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo/local-landing">
                <MapPin className="h-4 w-4 mr-1" /> Local pages
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/seo/connections">
                <Settings className="h-4 w-4 mr-1" /> Connections
              </Link>
            </Button>
            <Button asChild size="sm" className="bg-gradient-to-r from-cyan-500 to-blue-600">
              <Link to="/admin/seo/blog/batch">
                <Zap className="h-4 w-4 mr-1" /> Batch Writer
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => newPostMutation.mutate()}
              disabled={newPostMutation.isPending || !isConnected}
            >
              {newPostMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-1" />
              )}
              New post
            </Button>
          </div>
        </div>

        {!isConnected && (
          <Card className="bg-amber-950/30 border-amber-900 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Connect this shop's WordPress to start publishing.</div>
                <p className="text-sm text-zinc-400 mt-1">
                  You can still draft posts and audit URLs without a connection — but you'll
                  need WordPress wired up to push content live.
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link to="/admin/seo/connections">Set up connection</Link>
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Drafts" value={stats.data?.drafts ?? 0} icon={<FileText className="h-4 w-4" />} />
          <StatCard
            label="Published"
            value={stats.data?.published ?? 0}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <StatCard
            label="Avg score"
            value={stats.data?.avgScore ?? 0}
            suffix="/100"
            icon={<Gauge className="h-4 w-4" />}
          />
          <StatCard
            label="Audits run"
            value={stats.data?.totalAudits ?? 0}
            icon={<KeyRound className="h-4 w-4" />}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 bg-zinc-950 border-zinc-800 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Recent posts</h2>
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin/seo/blog">View all</Link>
              </Button>
            </div>
            {recentPosts.isLoading ? (
              <p className="text-zinc-500 text-sm">Loading…</p>
            ) : (recentPosts.data ?? []).length === 0 ? (
              <div className="text-center py-12 text-zinc-500 text-sm">
                No posts yet. Click <strong>New post</strong> to start writing.
              </div>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {(recentPosts.data ?? []).map((p) => (
                  <li key={p.id} className="py-3">
                    <Link
                      to={`/admin/seo/blog/${p.id}`}
                      className="flex items-center justify-between hover:bg-zinc-900 -mx-2 px-2 py-1 rounded"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{p.title || "(untitled)"}</div>
                        <div className="text-xs text-zinc-500 mt-0.5 flex gap-2 items-center">
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {p.status}
                          </Badge>
                          <span className="capitalize">{p.intent.replace(/_/g, " ")}</span>
                          <span>·</span>
                          <span>Updated {new Date(p.updated_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        {p.seo_score !== null && (
                          <div
                            className={`text-2xl font-semibold ${
                              p.seo_score >= 80
                                ? "text-emerald-400"
                                : p.seo_score >= 60
                                ? "text-amber-400"
                                : "text-red-400"
                            }`}
                          >
                            {p.seo_score}
                          </div>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="bg-zinc-950 border-zinc-800 p-5">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Search className="h-5 w-5" /> Quick audit
            </h2>
            <p className="text-sm text-zinc-500 mb-3">
              Score any public URL on this shop's site (or anywhere) against the SEO checklist.
            </p>
            <div className="space-y-2">
              <Input
                placeholder="https://weprintwraps.com/products/3m-2080"
                value={auditUrl}
                onChange={(e) => setAuditUrl(e.target.value)}
              />
              <Button
                onClick={() => auditMutation.mutate()}
                disabled={!auditUrl || auditMutation.isPending}
                className="w-full"
              >
                {auditMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Run audit
              </Button>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <SearchConsoleWidget shopId={currentShop.id} />
          <Ga4SummaryWidget shopId={currentShop.id} />
          <Ga4TopPagesWidget shopId={currentShop.id} />
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard widgets ────────────────────────────────────────────────────
interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function SearchConsoleWidget({ shopId }: { shopId: string }) {
  const q = useQuery({
    queryKey: ["seo-dashboard-gsc", shopId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("seo-google-search-console", {
        body: {
          action: "query",
          shop_id: shopId,
          days: 28,
          dimensions: ["query"],
          row_limit: 10,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return ((data as { rows?: GscRow[] }).rows ?? []).slice(0, 10);
    },
    retry: false,
  });
  return (
    <Card className="bg-zinc-950 border-zinc-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Search className="h-5 w-5 text-cyan-400" />
          Top queries (28d)
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/seo/keywords">All</Link>
        </Button>
      </div>
      {q.isLoading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : q.error ? (
        <WidgetError message={q.error instanceof Error ? q.error.message : "Failed"} />
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-zinc-500 text-sm">No data yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-800 text-sm">
          {(q.data ?? []).map((r, i) => (
            <li key={`${r.keys[0]}-${i}`} className="py-2 flex items-center justify-between gap-3">
              <span className="truncate min-w-0 flex-1">{r.keys[0]}</span>
              <span className="text-zinc-300 tabular-nums">{r.clicks}</span>
              <span className="text-zinc-500 text-xs tabular-nums w-12 text-right">
                #{r.position.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface Ga4Summary {
  sessions: number;
  users: number;
  conversions: number;
  revenue: number;
  transactions: number;
  engagement_rate: number;
}

function Ga4SummaryWidget({ shopId }: { shopId: string }) {
  const q = useQuery({
    queryKey: ["seo-dashboard-ga4-summary", shopId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("seo-google-analytics", {
        body: { action: "summary", shop_id: shopId, days: 28 },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as Ga4Summary;
    },
    retry: false,
  });
  return (
    <Card className="bg-zinc-950 border-zinc-800 p-5">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-cyan-400" />
        Traffic & revenue (28d)
      </h2>
      {q.isLoading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : q.error ? (
        <WidgetError message={q.error instanceof Error ? q.error.message : "Failed"} />
      ) : !q.data ? (
        <p className="text-zinc-500 text-sm">No data yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Sessions" value={q.data.sessions.toLocaleString()} />
          <Metric label="Users" value={q.data.users.toLocaleString()} />
          <Metric label="Conversions" value={q.data.conversions.toLocaleString()} />
          <Metric
            label="Revenue"
            value={q.data.revenue > 0 ? `$${q.data.revenue.toFixed(0)}` : "—"}
            icon={<DollarSign className="h-3.5 w-3.5" />}
          />
          <Metric label="Transactions" value={q.data.transactions.toLocaleString()} />
          <Metric
            label="Engagement"
            value={`${(q.data.engagement_rate * 100).toFixed(0)}%`}
            icon={<Star className="h-3.5 w-3.5" />}
          />
        </div>
      )}
    </Card>
  );
}

interface Ga4Page {
  landing_page: string;
  channel: string;
  sessions: number;
  conversions: number;
  revenue: number;
}

function Ga4TopPagesWidget({ shopId }: { shopId: string }) {
  const q = useQuery({
    queryKey: ["seo-dashboard-ga4-pages", shopId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("seo-google-analytics", {
        body: { action: "top_pages", shop_id: shopId, days: 28, limit: 10 },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return ((data as { rows?: Ga4Page[] }).rows ?? []);
    },
    retry: false,
  });
  return (
    <Card className="bg-zinc-950 border-zinc-800 p-5">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-cyan-400" />
        Top landing pages (28d)
      </h2>
      {q.isLoading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : q.error ? (
        <WidgetError message={q.error instanceof Error ? q.error.message : "Failed"} />
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-zinc-500 text-sm">No data yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-800 text-sm">
          {(q.data ?? []).slice(0, 8).map((r, i) => (
            <li key={`${r.landing_page}-${i}`} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs">{r.landing_page || "/"}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">{r.channel}</div>
              </div>
              <span className="text-zinc-300 tabular-nums">{r.sessions.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function WidgetError({ message }: { message: string }) {
  const isNotConnected = /not connected|set_site|set_property|No site|No GA4|refresh_token/i.test(
    message,
  );
  return (
    <div className="text-xs text-zinc-400 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
      {isNotConnected ? (
        <>
          Not configured.{" "}
          <Link to="/admin/seo/connections" className="text-cyan-400 hover:underline">
            Connect & pick property
          </Link>
        </>
      ) : (
        <span className="text-red-400">{message}</span>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  icon,
}: {
  label: string;
  value: number;
  suffix?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="bg-zinc-950 border-zinc-800 p-4">
      <div className="flex items-center justify-between text-zinc-500 text-xs">
        <span className="uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-semibold mt-2">
        {value}
        {suffix && <span className="text-sm text-zinc-500 ml-1">{suffix}</span>}
      </div>
    </Card>
  );
}
