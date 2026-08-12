import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, DollarSign, Clock, Megaphone } from "lucide-react";
import { useAffiliatePartnerCount } from "@/hooks/useAffiliatePartners";
import { useMonthlyCommissionTotal } from "@/hooks/useAffiliateTransactions";
import { usePendingPayoutCount } from "@/hooks/useAffiliatePayouts";
import { usePartnerAdCount } from "@/hooks/useAffiliateContent";

export function AffiliateStatsCards() {
  const { data: partnerCount } = useAffiliatePartnerCount();
  const { data: monthlyCommission } = useMonthlyCommissionTotal();
  const { data: pendingPayouts } = usePendingPayoutCount();
  const { data: partnerAdCount } = usePartnerAdCount();

  const stats = [
    {
      title: "Total Affiliates",
      value: partnerCount ?? 0,
      icon: Users,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      title: "Monthly Commissions",
      value: `$${((monthlyCommission ?? 0) / 100).toFixed(2)}`,
      icon: DollarSign,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    },
    {
      title: "Pending Payouts",
      value: pendingPayouts ?? 0,
      icon: Clock,
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
    },
    {
      title: "Active Partner Ads",
      value: partnerAdCount ?? 0,
      icon: Megaphone,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
