import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { QualityStatsCards } from "@/components/admin/QualityStatsCards";
import { RenderQualityTable } from "@/components/admin/RenderQualityTable";
import { RenderQualityRating, QualityStats, ToolFilter, TabFilter } from "@/types/render-quality";

export default function AdminRenderIntelligence() {
  const navigate = useNavigate();
  const [ratings, setRatings] = useState<RenderQualityRating[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toolFilter, setToolFilter] = useState<ToolFilter>("all");
  const [tabFilter, setTabFilter] = useState<TabFilter>("all");

  const fetchRatings = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("render_quality_ratings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      
      // Cast to our type with the new columns
      const typedData = (data || []).map((item) => ({
        ...item,
        fix_deployed_at: (item as any).fix_deployed_at || null,
        fix_notes: (item as any).fix_notes || null,
        customer_notified_at: (item as any).customer_notified_at || null,
        is_v2_feature: (item as any).is_v2_feature || false,
      })) as RenderQualityRating[];
      
      setRatings(typedData);
    } catch (error) {
      console.error("Error fetching ratings:", error);
      toast({
        title: "Error",
        description: "Failed to load quality ratings",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRatings();
  }, []);

  // Apply filters
  const filteredRatings = useMemo(() => {
    let filtered = ratings;

    // Tool filter
    if (toolFilter !== "all") {
      filtered = filtered.filter((r) => r.render_type === toolFilter);
    }

    // Tab filter
    switch (tabFilter) {
      case "flagged":
        filtered = filtered.filter((r) => r.is_flagged && !r.fix_deployed_at);
        break;
      case "needs-reply":
        filtered = filtered.filter(
          (r) => r.is_flagged && r.user_email && !r.customer_notified_at && !r.fix_deployed_at
        );
        break;
      case "v2-features":
        filtered = filtered.filter((r) => r.is_v2_feature);
        break;
    }

    return filtered;
  }, [ratings, toolFilter, tabFilter]);

  // Calculate stats based on tool filter only (not tab filter)
  const stats: QualityStats = useMemo(() => {
    const toolFiltered = toolFilter === "all" 
      ? ratings 
      : ratings.filter((r) => r.render_type === toolFilter);

    const ratingsWithScore = toolFiltered.filter((r) => r.rating !== null);
    const avgScore = ratingsWithScore.length > 0
      ? ratingsWithScore.reduce((sum, r) => sum + (r.rating || 0), 0) / ratingsWithScore.length
      : 0;

    return {
      totalRatings: toolFiltered.length,
      averageScore: avgScore,
      flaggedCount: toolFiltered.filter((r) => r.is_flagged && !r.fix_deployed_at).length,
      autoRegeneratedCount: toolFiltered.filter((r) => r.auto_regenerated).length,
      fixDeployedCount: toolFiltered.filter((r) => r.fix_deployed_at).length,
      needsCustomerReply: toolFiltered.filter(
        (r) => r.is_flagged && r.user_email && !r.customer_notified_at && !r.fix_deployed_at
      ).length,
    };
  }, [ratings, toolFilter]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/admin")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Render Intelligence Dashboard
                </h1>
                <p className="text-sm text-muted-foreground">
                  Track AI quality issues and manage fixes across all tools
                </p>
              </div>
            </div>
            <Button onClick={fetchRatings} variant="outline" size="sm">
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Tool Filter */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Filter by Tool:</span>
          </div>
          <Select value={toolFilter} onValueChange={(v) => setToolFilter(v as ToolFilter)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tools</SelectItem>
              <SelectItem value="colorpro">ColorPro</SelectItem>
              <SelectItem value="designpanelpro">DesignPanelPro</SelectItem>
              <SelectItem value="fadewraps">FadeWraps</SelectItem>
              <SelectItem value="wbty">PatternPro (WBTY)</SelectItem>
              <SelectItem value="approvemode">ApprovePro</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stats Cards */}
        <QualityStatsCards stats={stats} isLoading={isLoading} />

        {/* Issues Table with Tabs */}
        <Tabs value={tabFilter} onValueChange={(v) => setTabFilter(v as TabFilter)}>
          <TabsList>
            <TabsTrigger value="all">
              All Issues ({toolFilter === "all" ? ratings.length : ratings.filter(r => r.render_type === toolFilter).length})
            </TabsTrigger>
            <TabsTrigger value="flagged">
              Flagged Only ({stats.flaggedCount})
            </TabsTrigger>
            <TabsTrigger value="needs-reply">
              Needs Reply ({stats.needsCustomerReply})
            </TabsTrigger>
            <TabsTrigger value="v2-features">
              V2 Features ({ratings.filter(r => r.is_v2_feature && (toolFilter === "all" || r.render_type === toolFilter)).length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tabFilter} className="mt-4">
            <RenderQualityTable 
              ratings={filteredRatings} 
              onUpdate={fetchRatings}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
