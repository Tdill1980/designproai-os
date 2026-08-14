import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RefreshCw,
  Activity,
  Palette,
  Sparkles,
  Layers,
  ImageIcon,
  Clock,
  Loader2,
} from "lucide-react";
import { format, formatDistanceToNow, startOfDay, subDays, isSameDay } from "date-fns";

const TEAM = [
  { name: "Troy", email: "troy@weprintwraps.com" },
  { name: "Lance", email: "lance@weprintwraps.com" },
  { name: "Brice", email: "brice@weprintwraps.com" },
];

const TEAM_EMAILS = TEAM.map((m) => m.email);

type RenderUsageRow = {
  id: string;
  email: string;
  user_id: string;
  render_type: string;
  tier: string;
  created_at: string | null;
};

type DesigniqRow = {
  id: string;
  user_email: string | null;
  user_id: string | null;
  mode: string;
  hero_render_url: string | null;
  panel_url: string | null;
  generation_status: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: string | null;
  created_at: string | null;
};

type RevisionRow = {
  id: string;
  user_id: string | null;
  tool: string;
  created_at: string | null;
};

const toolIcon = (tool: string) => {
  const t = tool.toLowerCase();
  if (t.includes("design")) return <Sparkles className="w-3.5 h-3.5" />;
  if (t.includes("color")) return <Palette className="w-3.5 h-3.5" />;
  if (t.includes("fade")) return <Layers className="w-3.5 h-3.5" />;
  return <Activity className="w-3.5 h-3.5" />;
};

const AdminTeamUsage = () => {
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);

  const since = useMemo(
    () => startOfDay(subDays(new Date(), windowDays)).toISOString(),
    [windowDays]
  );

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-team-usage", windowDays],
    queryFn: async () => {
      const [usageRes, designRes, revisionsRes] = await Promise.all([
        supabase
          .from("render_usage")
          .select("id, email, user_id, render_type, tier, created_at")
          .in("email", TEAM_EMAILS)
          .gte("created_at", since)
          .order("created_at", { ascending: false }),
        supabase
          .from("designiq_generations")
          .select(
            "id, user_email, user_id, mode, hero_render_url, panel_url, generation_status, vehicle_make, vehicle_model, vehicle_year, created_at"
          )
          .in("user_email", TEAM_EMAILS)
          .gte("created_at", since)
          .order("created_at", { ascending: false }),
        supabase
          .from("design_revision_history")
          .select("id, user_id, tool, created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: false }),
      ]);

      if (usageRes.error) throw usageRes.error;
      if (designRes.error) throw designRes.error;
      if (revisionsRes.error) throw revisionsRes.error;

      return {
        usage: (usageRes.data || []) as RenderUsageRow[],
        designs: (designRes.data || []) as DesigniqRow[],
        revisions: (revisionsRes.data || []) as RevisionRow[],
      };
    },
  });

  const usage = data?.usage || [];
  const designs = data?.designs || [];
  const revisions = data?.revisions || [];

  // Build a user_id → email map from usage rows so we can scope revisions
  const idToEmail = useMemo(() => {
    const m = new Map<string, string>();
    usage.forEach((r) => {
      if (r.user_id && r.email) m.set(r.user_id, r.email.toLowerCase());
    });
    designs.forEach((d) => {
      if (d.user_id && d.user_email) m.set(d.user_id, d.user_email.toLowerCase());
    });
    return m;
  }, [usage, designs]);

  const perPerson = useMemo(() => {
    return TEAM.map(({ name, email }) => {
      const lowerEmail = email.toLowerCase();
      const userUsage = usage.filter((r) => r.email.toLowerCase() === lowerEmail);
      const userDesigns = designs.filter(
        (d) => d.user_email?.toLowerCase() === lowerEmail
      );
      const userRevisions = revisions.filter(
        (r) => r.user_id && idToEmail.get(r.user_id) === lowerEmail
      );

      // Tool breakdown from render_usage
      const byTool: Record<string, number> = {};
      userUsage.forEach((r) => {
        byTool[r.render_type] = (byTool[r.render_type] || 0) + 1;
      });

      // DesignPro count: combine render_usage rows with design-like render_type
      // plus designiq_generations as the source of truth for DesignPro work.
      const designProUsageCount = userUsage.filter((r) =>
        r.render_type.toLowerCase().includes("design")
      ).length;
      const designProCount = Math.max(designProUsageCount, userDesigns.length);

      // Daily activity sparkline buckets
      const buckets: { date: Date; count: number }[] = [];
      for (let i = windowDays - 1; i >= 0; i--) {
        buckets.push({ date: startOfDay(subDays(new Date(), i)), count: 0 });
      }
      const allEvents = [
        ...userUsage.map((r) => r.created_at),
        ...userDesigns.map((d) => d.created_at),
      ].filter(Boolean) as string[];
      allEvents.forEach((ts) => {
        const d = new Date(ts);
        const bucket = buckets.find((b) => isSameDay(b.date, d));
        if (bucket) bucket.count += 1;
      });
      const maxBucket = Math.max(1, ...buckets.map((b) => b.count));

      const lastActiveTs =
        [...userUsage, ...userDesigns]
          .map((r: any) => r.created_at)
          .filter(Boolean)
          .sort()
          .reverse()[0] || null;

      const tier = userUsage[0]?.tier || null;

      return {
        name,
        email,
        totalRenders: userUsage.length,
        designProCount,
        revisionCount: userRevisions.length,
        designs: userDesigns,
        byTool,
        buckets,
        maxBucket,
        lastActiveTs,
        tier,
      };
    });
  }, [usage, designs, revisions, idToEmail, windowDays]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Team Usage</h1>
            <p className="text-sm text-muted-foreground">
              WePrintWraps team activity across all tools
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v) as 7 | 30 | 90)}>
              <TabsList>
                <TabsTrigger value="7">7d</TabsTrigger>
                <TabsTrigger value="30">30d</TabsTrigger>
                <TabsTrigger value="90">90d</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {perPerson.map((p) => (
              <Card key={p.email} className="border-border/50">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-xl">{p.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">{p.email}</p>
                    </div>
                    {p.tier && (
                      <Badge variant="outline" className="capitalize">
                        {p.tier}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Top stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Total renders</p>
                      <p className="text-2xl font-bold">{p.totalRenders}</p>
                    </div>
                    <div className="rounded-lg bg-cyan-500/10 p-3">
                      <p className="text-xs text-muted-foreground">DesignPro</p>
                      <p className="text-2xl font-bold text-cyan-400">{p.designProCount}</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Revisions</p>
                      <p className="text-2xl font-bold">{p.revisionCount}</p>
                    </div>
                  </div>

                  {/* Last active */}
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Last active:</span>
                    <span className="font-medium">
                      {p.lastActiveTs
                        ? `${formatDistanceToNow(new Date(p.lastActiveTs))} ago`
                        : "no activity"}
                    </span>
                  </div>

                  {/* Sparkline */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Daily activity ({windowDays}d)
                    </p>
                    <div className="flex items-end gap-0.5 h-12">
                      {p.buckets.map((b, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-cyan-500/60 rounded-sm min-h-[2px] transition-all hover:bg-cyan-400"
                          style={{
                            height: `${(b.count / p.maxBucket) * 100}%`,
                          }}
                          title={`${format(b.date, "MMM d")}: ${b.count} event${b.count === 1 ? "" : "s"}`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Tool breakdown */}
                  {Object.keys(p.byTool).length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Tools used</p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(p.byTool)
                          .sort(([, a], [, b]) => b - a)
                          .map(([tool, count]) => (
                            <Badge
                              key={tool}
                              variant="secondary"
                              className="flex items-center gap-1 capitalize"
                            >
                              {toolIcon(tool)}
                              {tool}: {count}
                            </Badge>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Recent DesignPro thumbnails */}
                  {p.designs.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">
                        Recent DesignPro work
                      </p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {p.designs.slice(0, 4).map((d) => {
                          const thumb = d.hero_render_url || d.panel_url;
                          return (
                            <div
                              key={d.id}
                              className="aspect-square rounded-md bg-muted/40 overflow-hidden border border-border/40"
                              title={`${d.vehicle_year || ""} ${d.vehicle_make || ""} ${d.vehicle_model || ""} — ${d.mode}`}
                            >
                              {thumb ? (
                                <img
                                  src={thumb}
                                  alt=""
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <ImageIcon className="w-4 h-4 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {p.totalRenders === 0 && p.designs.length === 0 && (
                    <div className="text-sm text-muted-foreground italic text-center py-4">
                      No activity in the last {windowDays} days
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminTeamUsage;
