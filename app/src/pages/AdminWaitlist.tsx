import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Users, Rocket, Sparkles, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";

const AdminWaitlist = () => {
  const [filter, setFilter] = useState<string | null>(null);

  const { data: subscribers, isLoading } = useQuery({
    queryKey: ["admin_waitlist", filter],
    queryFn: async () => {
      let query = supabase
        .from("email_subscribers")
        .select("*")
        .order("created_at", { ascending: false });

      if (filter) {
        query = query.eq("source", filter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const waitlistCount = subscribers?.filter(s => s.source === "launch_waitlist").length || 0;
  const betaCount = subscribers?.filter(s => s.source === "beta_program").length || 0;
  const otherCount = subscribers?.filter(s => !["launch_waitlist", "beta_program"].includes(s.source)).length || 0;

  const exportCSV = () => {
    if (!subscribers?.length) return;

    const headers = ["Email", "Source", "Signed Up"];
    const rows = subscribers.map(s => [
      s.email,
      s.source,
      format(new Date(s.created_at), "yyyy-MM-dd HH:mm")
    ]);

    const csv = [headers, ...rows].map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waitlist-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link to="/admin">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Waitlist Management</h1>
              <p className="text-muted-foreground">View and export email signups</p>
            </div>
          </div>
          <Button onClick={exportCSV} disabled={!subscribers?.length}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card 
            className={`cursor-pointer transition-all ${filter === null ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setFilter(null)}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="w-4 h-4" />
                Total Signups
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-foreground">{subscribers?.length || 0}</p>
            </CardContent>
          </Card>

          <Card 
            className={`cursor-pointer transition-all ${filter === 'launch_waitlist' ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setFilter('launch_waitlist')}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Rocket className="w-4 h-4 text-primary" />
                Waitlist
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-primary">{waitlistCount}</p>
            </CardContent>
          </Card>

          <Card 
            className={`cursor-pointer transition-all ${filter === 'beta_program' ? 'ring-2 ring-amber-500' : ''}`}
            onClick={() => setFilter('beta_program')}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                Beta Program
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-amber-500">{betaCount}</p>
            </CardContent>
          </Card>

          <Card 
            className={`cursor-pointer transition-all ${filter === 'other' ? 'ring-2 ring-muted-foreground' : ''}`}
            onClick={() => setFilter('freemium_funnel')}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                Other Sources
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-muted-foreground">{otherCount}</p>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Email Subscribers</span>
              {filter && (
                <Badge variant="secondary" className="ml-2">
                  Filtered: {filter}
                  <button onClick={() => setFilter(null)} className="ml-2 hover:text-destructive">×</button>
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : !subscribers?.length ? (
              <div className="text-center py-8 text-muted-foreground">No subscribers yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Email</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Source</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Signed Up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscribers.map((sub) => (
                      <tr key={sub.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-3 px-4 text-foreground">{sub.email}</td>
                        <td className="py-3 px-4">
                          <Badge 
                            variant={sub.source === 'beta_program' ? 'default' : 'secondary'}
                            className={sub.source === 'beta_program' ? 'bg-amber-500' : sub.source === 'launch_waitlist' ? 'bg-primary' : ''}
                          >
                            {sub.source === 'launch_waitlist' ? 'Waitlist' : 
                             sub.source === 'beta_program' ? 'Beta' : sub.source}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {format(new Date(sub.created_at), "MMM d, yyyy h:mm a")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminWaitlist;
