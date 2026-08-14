import { useState, useEffect, useMemo } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Loader2,
  RefreshCw,
  ArrowLeft,
  Activity,
  DollarSign,
  Users,
  Palette,
  Image,
  Search,
  ShieldCheck,
  FlaskConical,
  User,
} from "lucide-react";
import { format, subDays, startOfDay } from "date-fns";

// ── Owner-only email gate ────────────────────────────────────────
const OWNER_EMAIL = "tdill@restyleproai.com";

// ── Types ────────────────────────────────────────────────────────
interface RenderUsageRow {
  id: string;
  user_id: string;
  email: string;
  render_type: string;
  tier: string;
  billing_cycle_start: string;
  created_at: string | null;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  email: string;
  tier: string;
  status: string;
  render_count: number | null;
  billing_cycle_start: string;
  billing_cycle_end: string;
  stripe_subscription_id: string | null;
}

interface UserRoleRow {
  user_id: string;
  role: string;
}

interface RevisionRow {
  id: string;
  user_id: string | null;
  tool: string;
  view_type: string | null;
  revision_prompt: string;
  created_at: string | null;
}

type RoleFilter = "all" | "admin" | "tester" | "customer";
type DateFilter = "today" | "7d" | "30d" | "all";

// ── Component ────────────────────────────────────────────────────
export default function AdminActivityLog() {
  const navigate = useNavigate();

  // Auth state
  const [authStatus, setAuthStatus] = useState<"loading" | "authorized" | "denied">("loading");

  // Data
  const [renderUsage, setRenderUsage] = useState<RenderUsageRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [userRoles, setUserRoles] = useState<UserRoleRow[]>([]);
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("7d");
  const [searchEmail, setSearchEmail] = useState("");

  // ── Auth check: owner only ─────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || user.email?.toLowerCase() !== OWNER_EMAIL) {
        setAuthStatus("denied");
        return;
      }
      setAuthStatus("authorized");
    })();
  }, []);

  // ── Data fetch ─────────────────────────────────────────────────
  const loadData = async () => {
    setLoading(true);
    try {
      const [usageRes, subsRes, rolesRes, revRes] = await Promise.all([
        supabase
          .from("render_usage")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("user_subscriptions")
          .select("*")
          .order("updated_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
        supabase
          .from("design_revision_history")
          .select("id, user_id, tool, view_type, revision_prompt, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      if (usageRes.error) throw usageRes.error;
      if (subsRes.error) throw subsRes.error;
      if (rolesRes.error) throw rolesRes.error;
      if (revRes.error) throw revRes.error;

      setRenderUsage(usageRes.data || []);
      setSubscriptions(subsRes.data || []);
      setUserRoles(rolesRes.data || []);
      setRevisions(revRes.data || []);
    } catch (err) {
      console.error("Error loading activity data:", err);
      toast.error("Failed to load activity data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authStatus === "authorized") loadData();
  }, [authStatus]);

  // ── Derived data ───────────────────────────────────────────────
  const roleMap = useMemo(() => {
    const m: Record<string, string> = {};
    userRoles.forEach((r) => (m[r.user_id] = r.role));
    return m;
  }, [userRoles]);

  // Email → role lookup (includes subscription emails for customers)
  const emailRoleMap = useMemo(() => {
    const m: Record<string, string> = {};
    // Map user_id roles from user_roles
    renderUsage.forEach((r) => {
      const role = roleMap[r.user_id];
      if (role) m[r.email.toLowerCase()] = role;
    });
    return m;
  }, [renderUsage, roleMap]);

  const getUserRole = (email: string, userId?: string | null): string => {
    if (userId && roleMap[userId]) return roleMap[userId];
    if (emailRoleMap[email.toLowerCase()]) return emailRoleMap[email.toLowerCase()];
    return "user"; // customer
  };

  const getRoleLabel = (role: string) => {
    if (role === "admin") return "Admin";
    if (role === "tester") return "Tester";
    return "Customer";
  };

  const getRoleIcon = (role: string) => {
    if (role === "admin") return <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />;
    if (role === "tester") return <FlaskConical className="w-3.5 h-3.5 text-purple-400" />;
    return <User className="w-3.5 h-3.5 text-cyan-400" />;
  };

  const dateCutoff = useMemo(() => {
    if (dateFilter === "today") return startOfDay(new Date());
    if (dateFilter === "7d") return startOfDay(subDays(new Date(), 7));
    if (dateFilter === "30d") return startOfDay(subDays(new Date(), 30));
    return null;
  }, [dateFilter]);

  // Filtered render usage
  const filteredUsage = useMemo(() => {
    let rows = renderUsage;

    // Date filter
    if (dateCutoff) {
      rows = rows.filter(
        (r) => r.created_at && new Date(r.created_at) >= dateCutoff
      );
    }

    // Role filter
    if (roleFilter !== "all") {
      rows = rows.filter((r) => {
        const role = getUserRole(r.email, r.user_id);
        if (roleFilter === "customer") return role === "user";
        return role === roleFilter;
      });
    }

    // Search
    if (searchEmail.trim()) {
      const q = searchEmail.toLowerCase();
      rows = rows.filter((r) => r.email.toLowerCase().includes(q));
    }

    return rows;
  }, [renderUsage, dateCutoff, roleFilter, searchEmail, roleMap, emailRoleMap]);

  // Filtered revisions
  const filteredRevisions = useMemo(() => {
    let rows = revisions;
    if (dateCutoff) {
      rows = rows.filter(
        (r) => r.created_at && new Date(r.created_at) >= dateCutoff
      );
    }
    if (roleFilter !== "all") {
      rows = rows.filter((r) => {
        const role = r.user_id ? roleMap[r.user_id] || "user" : "user";
        if (roleFilter === "customer") return role === "user";
        return role === roleFilter;
      });
    }
    return rows;
  }, [revisions, dateCutoff, roleFilter, roleMap]);

  // ── Stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const uniqueUsers = new Set(filteredUsage.map((r) => r.email.toLowerCase()));
    const totalRenders = filteredUsage.length;
    const byTool: Record<string, number> = {};
    filteredUsage.forEach((r) => {
      byTool[r.render_type] = (byTool[r.render_type] || 0) + 1;
    });

    // Spend estimate: paid customers (not admin/tester) who exceed tier limits
    // Simple: count customer renders × $5 for overage renders
    const customerRenders = filteredUsage.filter((r) => {
      const role = getUserRole(r.email, r.user_id);
      return role === "user";
    }).length;

    const activeSubscriptions = subscriptions.filter(
      (s) => s.status === "active"
    );

    return {
      uniqueUsers: uniqueUsers.size,
      totalRenders,
      byTool,
      customerRenders,
      activeSubscriptions: activeSubscriptions.length,
      revisionCount: filteredRevisions.length,
    };
  }, [filteredUsage, filteredRevisions, subscriptions]);

  // ── Per-user summary ───────────────────────────────────────────
  const userSummaries = useMemo(() => {
    const map: Record<
      string,
      { email: string; role: string; renders: number; tools: Set<string>; lastActive: string | null; tier: string }
    > = {};

    filteredUsage.forEach((r) => {
      const key = r.email.toLowerCase();
      if (!map[key]) {
        map[key] = {
          email: r.email,
          role: getUserRole(r.email, r.user_id),
          renders: 0,
          tools: new Set(),
          lastActive: null,
          tier: r.tier || "free",
        };
      }
      map[key].renders += 1;
      map[key].tools.add(r.render_type);
      if (r.created_at && (!map[key].lastActive || r.created_at > map[key].lastActive!)) {
        map[key].lastActive = r.created_at;
      }
    });

    // Merge subscription tier info
    subscriptions.forEach((s) => {
      const key = s.email.toLowerCase();
      if (map[key]) {
        map[key].tier = s.tier;
      }
    });

    return Object.values(map).sort((a, b) => b.renders - a.renders);
  }, [filteredUsage, subscriptions, roleMap, emailRoleMap]);

  // ── Subscription spend breakdown ───────────────────────────────
  const spendBreakdown = useMemo(() => {
    const tierPrices: Record<string, number> = {
      free: 0,
      starter: 29,
      advanced: 79,
      complete: 149,
      agency: 299,
    };
    const tierLimits: Record<string, number> = {
      free: 0,
      starter: 10,
      advanced: 50,
      complete: 200,
      agency: 999999,
    };

    const activeSubs = subscriptions.filter((s) => s.status === "active");
    let monthlyRecurring = 0;
    let overageEstimate = 0;

    activeSubs.forEach((s) => {
      monthlyRecurring += tierPrices[s.tier] || 0;
      const limit = tierLimits[s.tier] || 0;
      const used = s.render_count || 0;
      if (used > limit) {
        overageEstimate += (used - limit) * 5;
      }
    });

    return { monthlyRecurring, overageEstimate, totalActive: activeSubs.length };
  }, [subscriptions]);

  // ── Render ─────────────────────────────────────────────────────
  if (authStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (authStatus === "denied") return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/admin/dashboard")}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Activity className="w-7 h-7 text-cyan-400" />
                Activity Log
              </h1>
              <p className="text-sm text-muted-foreground">
                Owner-only view — renders, revisions & spend across all users
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={loadData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as RoleFilter)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
              <SelectItem value="tester">Testers</SelectItem>
              <SelectItem value="customer">Customers</SelectItem>
            </SelectContent>
          </Select>

          <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by email..."
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-4 h-4 text-cyan-400" />
                  <p className="text-xs text-muted-foreground">Active Users</p>
                </div>
                <p className="text-2xl font-bold">{stats.uniqueUsers}</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Image className="w-4 h-4 text-cyan-400" />
                  <p className="text-xs text-muted-foreground">Total Renders</p>
                </div>
                <p className="text-2xl font-bold">{stats.totalRenders}</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Palette className="w-4 h-4 text-cyan-400" />
                  <p className="text-xs text-muted-foreground">Revisions</p>
                </div>
                <p className="text-2xl font-bold">{stats.revisionCount}</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  <p className="text-xs text-muted-foreground">MRR</p>
                </div>
                <p className="text-2xl font-bold">${spendBreakdown.monthlyRecurring}</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-amber-400" />
                  <p className="text-xs text-muted-foreground">Overage Est.</p>
                </div>
                <p className="text-2xl font-bold">${spendBreakdown.overageEstimate}</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-4 h-4 text-emerald-400" />
                  <p className="text-xs text-muted-foreground">Active Subs</p>
                </div>
                <p className="text-2xl font-bold">{spendBreakdown.totalActive}</p>
              </Card>
            </div>

            {/* Render-by-tool breakdown */}
            {Object.keys(stats.byTool).length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {Object.entries(stats.byTool)
                  .sort(([, a], [, b]) => b - a)
                  .map(([tool, count]) => (
                    <span
                      key={tool}
                      className="px-3 py-1 rounded-full bg-muted text-sm font-medium capitalize"
                    >
                      {tool}: {count}
                    </span>
                  ))}
              </div>
            )}

            <Tabs defaultValue="users" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="users">
                  Users ({userSummaries.length})
                </TabsTrigger>
                <TabsTrigger value="renders">
                  Render Feed ({filteredUsage.length})
                </TabsTrigger>
                <TabsTrigger value="revisions">
                  Revisions ({filteredRevisions.length})
                </TabsTrigger>
                <TabsTrigger value="subscriptions">
                  Subscriptions ({subscriptions.length})
                </TabsTrigger>
              </TabsList>

              {/* ── Users Tab ── */}
              <TabsContent value="users" className="space-y-2">
                {userSummaries.length === 0 ? (
                  <Card className="p-8 text-center text-muted-foreground">
                    No activity in this period
                  </Card>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium">User</th>
                          <th className="text-left p-3 font-medium">Role</th>
                          <th className="text-left p-3 font-medium">Tier</th>
                          <th className="text-right p-3 font-medium">Renders</th>
                          <th className="text-left p-3 font-medium">Tools Used</th>
                          <th className="text-left p-3 font-medium">Last Active</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {userSummaries.map((u) => (
                          <tr key={u.email} className="hover:bg-muted/30">
                            <td className="p-3 truncate max-w-[220px]" title={u.email}>
                              {u.email}
                            </td>
                            <td className="p-3">
                              <span className="inline-flex items-center gap-1.5">
                                {getRoleIcon(u.role)}
                                {getRoleLabel(u.role)}
                              </span>
                            </td>
                            <td className="p-3 capitalize">{u.tier}</td>
                            <td className="p-3 text-right font-mono font-medium">
                              {u.renders}
                            </td>
                            <td className="p-3">
                              <div className="flex flex-wrap gap-1">
                                {Array.from(u.tools).map((t) => (
                                  <span
                                    key={t}
                                    className="px-2 py-0.5 rounded bg-muted text-xs capitalize"
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="p-3 text-muted-foreground">
                              {u.lastActive
                                ? format(new Date(u.lastActive), "MMM d, h:mm a")
                                : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>

              {/* ── Render Feed Tab ── */}
              <TabsContent value="renders" className="space-y-2">
                {filteredUsage.length === 0 ? (
                  <Card className="p-8 text-center text-muted-foreground">
                    No renders in this period
                  </Card>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium">Time</th>
                          <th className="text-left p-3 font-medium">User</th>
                          <th className="text-left p-3 font-medium">Role</th>
                          <th className="text-left p-3 font-medium">Tool</th>
                          <th className="text-left p-3 font-medium">Tier</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredUsage.slice(0, 200).map((r) => {
                          const role = getUserRole(r.email, r.user_id);
                          return (
                            <tr key={r.id} className="hover:bg-muted/30">
                              <td className="p-3 text-muted-foreground whitespace-nowrap">
                                {r.created_at
                                  ? format(new Date(r.created_at), "MMM d, h:mm a")
                                  : "-"}
                              </td>
                              <td className="p-3 truncate max-w-[220px]" title={r.email}>
                                {r.email}
                              </td>
                              <td className="p-3">
                                <span className="inline-flex items-center gap-1.5">
                                  {getRoleIcon(role)}
                                  {getRoleLabel(role)}
                                </span>
                              </td>
                              <td className="p-3 capitalize">{r.render_type}</td>
                              <td className="p-3 capitalize">{r.tier}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filteredUsage.length > 200 && (
                      <div className="p-3 text-center text-sm text-muted-foreground border-t">
                        Showing 200 of {filteredUsage.length} renders
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ── Revisions Tab ── */}
              <TabsContent value="revisions" className="space-y-2">
                {filteredRevisions.length === 0 ? (
                  <Card className="p-8 text-center text-muted-foreground">
                    No revisions in this period
                  </Card>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium">Time</th>
                          <th className="text-left p-3 font-medium">Tool</th>
                          <th className="text-left p-3 font-medium">View</th>
                          <th className="text-left p-3 font-medium">Prompt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredRevisions.slice(0, 200).map((r) => (
                          <tr key={r.id} className="hover:bg-muted/30">
                            <td className="p-3 text-muted-foreground whitespace-nowrap">
                              {r.created_at
                                ? format(new Date(r.created_at), "MMM d, h:mm a")
                                : "-"}
                            </td>
                            <td className="p-3 capitalize">{r.tool}</td>
                            <td className="p-3 capitalize">{r.view_type || "-"}</td>
                            <td className="p-3 truncate max-w-[400px]" title={r.revision_prompt}>
                              {r.revision_prompt}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>

              {/* ── Subscriptions Tab ── */}
              <TabsContent value="subscriptions" className="space-y-2">
                {subscriptions.length === 0 ? (
                  <Card className="p-8 text-center text-muted-foreground">
                    No subscriptions found
                  </Card>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium">Email</th>
                          <th className="text-left p-3 font-medium">Tier</th>
                          <th className="text-left p-3 font-medium">Status</th>
                          <th className="text-right p-3 font-medium">Renders Used</th>
                          <th className="text-left p-3 font-medium">Cycle</th>
                          <th className="text-left p-3 font-medium">Stripe</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {subscriptions.map((s) => (
                          <tr key={s.id} className="hover:bg-muted/30">
                            <td className="p-3 truncate max-w-[220px]" title={s.email}>
                              {s.email}
                            </td>
                            <td className="p-3 capitalize font-medium">{s.tier}</td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  s.status === "active"
                                    ? "bg-emerald-500/20 text-emerald-400"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {s.status}
                              </span>
                            </td>
                            <td className="p-3 text-right font-mono">
                              {s.render_count ?? 0}
                            </td>
                            <td className="p-3 text-muted-foreground text-xs">
                              {format(new Date(s.billing_cycle_start), "MMM d")} –{" "}
                              {format(new Date(s.billing_cycle_end), "MMM d")}
                            </td>
                            <td className="p-3 text-xs text-muted-foreground truncate max-w-[120px]">
                              {s.stripe_subscription_id ? "Connected" : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}
