import { Card, CardContent } from "@/components/ui/card";
import { Star, Flag, RefreshCw, CheckCircle, Clock } from "lucide-react";

interface QualityStats {
  totalRatings: number;
  averageScore: number;
  flaggedCount: number;
  autoRegeneratedCount: number;
  fixDeployedCount: number;
  needsCustomerReply: number;
}

interface QualityStatsCardsProps {
  stats: QualityStats;
  isLoading?: boolean;
}

export function QualityStatsCards({ stats, isLoading }: QualityStatsCardsProps) {
  const cards = [
    {
      label: "Total Ratings",
      value: stats.totalRatings,
      icon: Star,
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
    },
    {
      label: "Average Score",
      value: stats.averageScore.toFixed(1) + "★",
      icon: Star,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      label: "Flagged Issues",
      value: stats.flaggedCount,
      icon: Flag,
      color: "text-red-500",
      bgColor: "bg-red-500/10",
    },
    {
      label: "Auto-Regen'd",
      value: stats.autoRegeneratedCount,
      icon: RefreshCw,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
    {
      label: "Fix Deployed",
      value: stats.fixDeployedCount,
      icon: CheckCircle,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    },
    {
      label: "Needs Reply",
      value: stats.needsCustomerReply,
      icon: Clock,
      color: "text-orange-500",
      bgColor: "bg-orange-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map((card) => (
        <Card key={card.label} className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${card.bgColor}`}>
                <card.icon className={`h-5 w-5 ${card.color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {isLoading ? "..." : card.value}
                </p>
                <p className="text-xs text-muted-foreground">{card.label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
