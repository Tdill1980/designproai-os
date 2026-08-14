import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Users, Image as ImageIcon, Calendar, Search, Mail, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

type RenderRow = {
  id: string;
  customer_email: string;
  color_hex: string;
  color_name: string;
  finish_type: string;
  mode_type: string | null;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
  render_urls: Record<string, string> | null;
  subscription_tier: string | null;
  created_at: string | null;
};

type UserAggregate = {
  email: string;
  totalRenders: number;
  lastRenderAt: string | null;
  modes: Set<string>;
  tier: string | null;
  thumbnails: string[];
};

const AdminUserRenderDashboard = () => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "count" | "email">("recent");
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);

  // Pull every render — admin-scoped query (RLS already gates this).
  const { data: renders, isLoading } = useQuery({
    queryKey: ["admin_user_render_dashboard"],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("color_visualizations")
        .select(
          "id, customer_email, color_hex, color_name, finish_type, mode_type, vehicle_year, vehicle_make, vehicle_model, render_urls, subscription_tier, created_at"
        )
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as unknown as RenderRow[];
    },
  });

  // Group renders by user email.
  const userMap = useMemo(() => {
    const map = new Map<string, UserAggregate>();
    if (!renders) return map;

    for (const r of renders) {
      const email = r.customer_email || "(unknown)";
      const existing = map.get(email);

      const firstThumb =
        r.render_urls && typeof r.render_urls === "object"
          ? Object.values(r.render_urls)[0] || null
          : null;

      if (!existing) {
        map.set(email, {
          email,
          totalRenders: 1,
          lastRenderAt: r.created_at,
          modes: new Set(r.mode_type ? [r.mode_type] : []),
          tier: r.subscription_tier,
          thumbnails: firstThumb ? [firstThumb] : [],
        });
      } else {
        existing.totalRenders += 1;
        if (r.mode_type) existing.modes.add(r.mode_type);
        if (!existing.tier && r.subscription_tier) existing.tier = r.subscription_tier;
        if (firstThumb && existing.thumbnails.length < 4) {
          existing.thumbnails.push(firstThumb);
        }
        // renders are ordered desc, so the first one we see is already the latest
      }
    }

    return map;
  }, [renders]);

  const sortedUsers = useMemo(() => {
    const users = Array.from(userMap.values());
    const filtered = search.trim()
      ? users.filter((u) => u.email.toLowerCase().includes(search.trim().toLowerCase()))
      : users;

    return filtered.sort((a, b) => {
      if (sortBy === "count") return b.totalRenders - a.totalRenders;
      if (sortBy === "email") return a.email.localeCompare(b.email);
      // recent
      const aTime = a.lastRenderAt ? new Date(a.lastRenderAt).getTime() : 0;
      const bTime = b.lastRenderAt ? new Date(b.lastRenderAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [userMap, search, sortBy]);

  const selectedUserRenders = useMemo(() => {
    if (!selectedEmail || !renders) return [];
    return renders.filter((r) => r.customer_email === selectedEmail);
  }, [selectedEmail, renders]);

  const totalRenders = renders?.length || 0;
  const totalUsers = userMap.size;

  const downloadImage = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      toast({ title: "Error", description: "Failed to download image", variant: "destructive" });
    }
  };

  const getModeColor = (mode: string) => {
    const colors: Record<string, string> = {
      inkfusion: "bg-blue-500",
      ColorPro: "bg-blue-500",
      approvemode: "bg-green-500",
      fadewraps: "bg-orange-500",
      designpanelpro: "bg-purple-500",
      wbty: "bg-pink-500",
    };
    return colors[mode] || "bg-gray-500";
  };

  // ─── User detail view ────────────────────────────────────────────
  if (selectedEmail) {
    return (
      <div className="min-h-screen flex flex-col">
        <main className="flex-1 container mx-auto px-4 py-8">
          <div className="space-y-6">
            <Button variant="ghost" onClick={() => setSelectedEmail(null)}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to All Users
            </Button>

            <div>
              <Badge className="mb-3 bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/20">
                BACKEND · ADMIN ONLY
              </Badge>
              <h1 className="text-3xl font-bold mb-2">{selectedEmail}</h1>
              <p className="text-muted-foreground">
                {selectedUserRenders.length} render{selectedUserRenders.length === 1 ? "" : "s"} on the platform
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {selectedUserRenders.map((render) => (
                <Card key={render.id} className="overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <Badge className={getModeColor(render.mode_type || "")}>
                        {render.mode_type || "Unknown"}
                      </Badge>
                      {render.subscription_tier && (
                        <Badge variant="outline" className="text-xs">
                          {render.subscription_tier}
                        </Badge>
                      )}
                    </div>
                    <CardTitle className="text-base mt-2">
                      {render.vehicle_year} {render.vehicle_make} {render.vehicle_model}
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      {render.render_urls &&
                        typeof render.render_urls === "object" &&
                        Object.entries(render.render_urls)
                          .slice(0, 4)
                          .map(([type, url]) => (
                            <img
                              key={type}
                              src={url}
                              alt={type}
                              className="w-full aspect-video object-cover rounded border border-border"
                            />
                          ))}
                    </div>

                    <div className="space-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded border border-border"
                          style={{ backgroundColor: render.color_hex }}
                        />
                        <span className="font-medium">{render.color_name}</span>
                      </div>
                      <p className="text-muted-foreground">{render.finish_type} finish</p>
                      <p className="text-xs text-muted-foreground">
                        {render.created_at
                          ? formatDistanceToNow(new Date(render.created_at), { addSuffix: true })
                          : "—"}
                      </p>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          if (render.render_urls && typeof render.render_urls === "object") {
                            const urls = Object.entries(render.render_urls);
                            if (urls.length > 0) {
                              downloadImage(
                                urls[0][1],
                                `${render.vehicle_make}_${render.vehicle_model}_${urls[0][0]}.jpg`
                              );
                            }
                          }
                        }}
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {selectedUserRenders.length === 0 && (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No renders found for this user.</p>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ─── User list view ──────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="space-y-6">
          <div>
            <Badge className="mb-3 bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/20">
              BACKEND · ADMIN ONLY
            </Badge>
            <h1 className="text-3xl font-bold mb-2">All User Renders</h1>
            <p className="text-muted-foreground">
              Backend admin view of every user on the platform and the renders they've generated. Click any user to drill into their full gallery.
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Total Users
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{totalUsers}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" />
                  Total Renders
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{totalRenders}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Avg / User
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {totalUsers > 0 ? (totalRenders / totalUsers).toFixed(1) : "0"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-4">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by user email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Most Recent Activity</SelectItem>
                <SelectItem value="count">Most Renders</SelectItem>
                <SelectItem value="email">Email (A–Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* User list */}
          {isLoading ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Loading user renders...</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sortedUsers.map((user) => (
                <Card
                  key={user.email}
                  className="overflow-hidden hover:border-primary transition-colors cursor-pointer"
                  onClick={() => setSelectedEmail(user.email)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                        <CardTitle className="text-sm truncate">{user.email}</CardTitle>
                      </div>
                      {user.tier && (
                        <Badge variant="outline" className="text-xs shrink-0">
                          {user.tier}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    {/* Thumbnails preview */}
                    <div className="grid grid-cols-2 gap-2">
                      {user.thumbnails.length > 0 ? (
                        user.thumbnails.slice(0, 4).map((url, i) => (
                          <img
                            key={i}
                            src={url}
                            alt={`${user.email} render ${i + 1}`}
                            className="w-full aspect-video object-cover rounded border border-border"
                          />
                        ))
                      ) : (
                        <div className="col-span-2 aspect-video flex items-center justify-center bg-muted rounded border border-border">
                          <ImageIcon className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>

                    {/* Stats */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold">
                        {user.totalRenders} render{user.totalRenders === 1 ? "" : "s"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {user.lastRenderAt
                          ? formatDistanceToNow(new Date(user.lastRenderAt), { addSuffix: true })
                          : "—"}
                      </span>
                    </div>

                    {/* Mode badges */}
                    {user.modes.size > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {Array.from(user.modes).map((mode) => (
                          <Badge key={mode} className={`${getModeColor(mode)} text-xs`}>
                            {mode}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!isLoading && sortedUsers.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {search ? "No users match your search." : "No renders on the platform yet."}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminUserRenderDashboard;
