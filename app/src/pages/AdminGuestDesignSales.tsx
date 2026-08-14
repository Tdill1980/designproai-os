import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, DollarSign, Users, Mail } from "lucide-react";

interface GuestSale {
  id: string;
  created_at: string;
  stripe_session_id: string;
  email: string;
  name: string | null;
  phone: string | null;
  marketing_opt_in: boolean;
  ref: string | null;
  amount_cents: number;
  user_id: string | null;
  paid: boolean;
  paid_at: string | null;
}

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function AdminGuestDesignSales() {
  const navigate = useNavigate();

  const { data: sales, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["guest-design-sales"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("guest_design_sales")
        .select("*")
        .eq("paid", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as GuestSale[];
    },
  });

  const stats = (sales || []).reduce(
    (acc, s) => {
      acc.count += 1;
      acc.revenue += s.amount_cents;
      if (s.marketing_opt_in) acc.optIns += 1;
      return acc;
    },
    { count: 0, revenue: 0, optIns: 0 },
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/admin")}
            className="text-white/60 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Admin
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="border-white/20"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <h1 className="text-2xl font-bold mb-1">$25 Custom Wrap Design Sales</h1>
        <p className="text-sm text-white/50 mb-6">
          Every guest single-design purchase from /try-design and the WPW $25 page.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <Card className="bg-[#141414] border-white/10 p-4 flex items-center gap-3">
            <Users className="w-8 h-8 text-cyan-400" />
            <div>
              <div className="text-2xl font-bold">{stats.count}</div>
              <div className="text-xs text-white/50">Total sales</div>
            </div>
          </Card>
          <Card className="bg-[#141414] border-white/10 p-4 flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-emerald-400" />
            <div>
              <div className="text-2xl font-bold">{fmtMoney(stats.revenue)}</div>
              <div className="text-xs text-white/50">Revenue</div>
            </div>
          </Card>
          <Card className="bg-[#141414] border-white/10 p-4 flex items-center gap-3">
            <Mail className="w-8 h-8 text-fuchsia-400" />
            <div>
              <div className="text-2xl font-bold">{stats.optIns}</div>
              <div className="text-xs text-white/50">Marketing opt-ins</div>
            </div>
          </Card>
        </div>

        {isLoading ? (
          <div className="text-white/50 py-12 text-center">Loading…</div>
        ) : !sales || sales.length === 0 ? (
          <Card className="bg-[#141414] border-white/10 p-12 text-center text-white/50">
            No $25 design sales yet. They'll appear here the moment one completes.
          </Card>
        ) : (
          <Card className="bg-[#141414] border-white/10 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-white/50 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Phone</th>
                    <th className="px-4 py-3 font-medium">Opt-in</th>
                    <th className="px-4 py-3 font-medium">Ref</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 whitespace-nowrap text-white/70">{fmtDate(s.created_at)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{s.name || "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <a href={`mailto:${s.email}`} className="text-cyan-400 hover:underline">
                          {s.email}
                        </a>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-white/70">{s.phone || "—"}</td>
                      <td className="px-4 py-3">
                        {s.marketing_opt_in ? (
                          <Badge className="bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40">Yes</Badge>
                        ) : (
                          <span className="text-white/30">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-white/70">{s.ref || "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-right font-semibold text-emerald-400">
                        {fmtMoney(s.amount_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
