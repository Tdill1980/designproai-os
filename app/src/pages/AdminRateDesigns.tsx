import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ArrowRight, Star, Download, ChevronLeft, ChevronRight, Filter, BarChart3, Wand2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useRatableDesigns, useSubmitRating, useRatingStats, type RatingFilter } from "@/hooks/useDesignRatings";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import { cn } from "@/lib/utils";

// ============================================================================
// Star Rating Component - Big clickable buttons
// ============================================================================

function StarRating({
  value,
  onChange,
  size = "lg",
}: {
  value: number | null;
  onChange: (rating: number) => void;
  size?: "sm" | "lg";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const displayValue = hover ?? value ?? 0;

  const starSize = size === "lg" ? "w-12 h-12" : "w-6 h-6";

  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={cn(
            "transition-all duration-150 hover:scale-110",
            starSize
          )}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(null)}
          onClick={() => onChange(star)}
        >
          <Star
            className={cn(
              "w-full h-full transition-colors",
              star <= displayValue
                ? "fill-yellow-400 text-yellow-400"
                : "fill-transparent text-gray-500"
            )}
          />
        </button>
      ))}
      {value && (
        <span className="ml-2 text-lg font-semibold text-white">
          {value}/5
        </span>
      )}
    </div>
  );
}

// ============================================================================
// Render View Gallery - Shows all angles for a single render
// ============================================================================

function RenderViewGallery({ renderUrls }: { renderUrls: Record<string, string> | null }) {
  const [activeView, setActiveView] = useState<string>("roof");

  if (!renderUrls) return <div className="text-gray-500">No renders available</div>;

  // Collect all available views
  const views: { key: string; label: string; url: string }[] = [];

  const VIEW_LABELS: Record<string, string> = {
    roof: "Roof",
    side: "Side",
    front: "Front",
    rear: "Rear",
    top: "Top",
    hood_detail: "Hood Detail",
    quarter: "Quarter",
  };

  // Standard views
  for (const [key, url] of Object.entries(renderUrls)) {
    if (key === 'spin_views' && typeof url === 'object') {
      // Handle spin views
      for (const [spinKey, spinUrl] of Object.entries(url as Record<string, string>)) {
        if (typeof spinUrl === 'string' && spinUrl.startsWith('http')) {
          views.push({ key: `spin_${spinKey}`, label: `Spin ${spinKey}`, url: spinUrl });
        }
      }
    } else if (typeof url === 'string' && url.startsWith('http')) {
      views.push({ key, label: VIEW_LABELS[key] || key, url });
    }
  }

  if (views.length === 0) return <div className="text-gray-500">No render images found</div>;

  // Default to first available view
  const currentView = views.find(v => v.key === activeView) || views[0];

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Main image - full screen width */}
      <div className="relative w-full aspect-video bg-black/40 rounded-xl overflow-hidden border border-white/10">
        <img
          src={currentView.url}
          alt={currentView.label}
          className="w-full h-full object-contain"
          loading="eager"
        />
        <div className="absolute top-3 left-3">
          <Badge variant="secondary" className="bg-black/70 text-white border-white/20">
            {currentView.label}
          </Badge>
        </div>
      </div>

      {/* Thumbnail strip */}
      {views.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {views.map((view) => (
            <button
              key={view.key}
              onClick={() => setActiveView(view.key)}
              className={cn(
                "flex-shrink-0 w-24 h-16 rounded-lg overflow-hidden border-2 transition-all",
                view.key === (currentView.key)
                  ? "border-blue-400 ring-2 ring-blue-400/30"
                  : "border-white/10 hover:border-white/30"
              )}
            >
              <img
                src={view.url}
                alt={view.label}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Admin Rate Designs Page
// ============================================================================

export default function AdminRateDesigns() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [pendingRating, setPendingRating] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState("");

  const { data: designs, isLoading } = useRatableDesigns(ratingFilter, 'all', modeFilter);
  const { data: stats } = useRatingStats();
  const submitRating = useSubmitRating();

  const currentDesign = designs?.[currentIndex];
  const totalDesigns = designs?.length || 0;

  // Reset index when filters change
  useEffect(() => {
    setCurrentIndex(0);
    setPendingRating(null);
    setFeedbackText("");
  }, [ratingFilter, modeFilter]);

  // Sync pending rating with current design's existing rating
  useEffect(() => {
    if (currentDesign) {
      setPendingRating(currentDesign.my_rating);
      setFeedbackText(currentDesign.my_feedback || "");
    }
  }, [currentDesign]);

  const goNext = useCallback(() => {
    if (currentIndex < totalDesigns - 1) {
      setCurrentIndex(i => i + 1);
      setPendingRating(null);
      setFeedbackText("");
    }
  }, [currentIndex, totalDesigns]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1);
      setPendingRating(null);
      setFeedbackText("");
    }
  }, [currentIndex]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" || e.key === "n") goNext();
      if (e.key === "ArrowLeft" || e.key === "p") goPrev();
      if (e.key >= "1" && e.key <= "5") setPendingRating(Number(e.key));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev]);

  const handleSubmitRating = async () => {
    if (!currentDesign || !pendingRating) return;

    await submitRating.mutateAsync({
      visualizationId: currentDesign.id,
      rating: pendingRating,
      feedbackText: feedbackText || undefined,
      renderUrls: currentDesign.render_urls,
      vehicleInfo: {
        year: currentDesign.vehicle_year || undefined,
        make: currentDesign.vehicle_make || undefined,
        model: currentDesign.vehicle_model || undefined,
      },
      modeType: currentDesign.mode_type || undefined,
    });

    // Auto-advance to next
    goNext();
  };

  const handleDownloadAll = () => {
    if (!currentDesign?.render_urls) return;
    for (const [key, url] of Object.entries(currentDesign.render_urls)) {
      if (typeof url === 'string' && url.startsWith('http')) {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${currentDesign.vehicle_make || 'render'}_${key}.png`;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
  };

  const vehicleLabel = currentDesign
    ? [currentDesign.vehicle_year, currentDesign.vehicle_make, currentDesign.vehicle_model]
        .filter(Boolean)
        .join(" ") || "Unknown Vehicle"
    : "";

  const progressPercent = stats
    ? Math.round((stats.ratedCount / Math.max(stats.totalDesigns, 1)) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link to="/admin">
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                <ArrowLeft className="w-4 h-4 mr-2" /> Admin
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">Rate Designs</h1>
            <Badge variant="outline" className="border-blue-500/30 text-blue-400">
              DesignIQ RAG
            </Badge>
          </div>

          <Button variant="outline" size="sm" onClick={handleDownloadAll} disabled={!currentDesign}>
            <Download className="w-4 h-4 mr-2" /> Download All
          </Button>
        </div>

        {/* Progress bar */}
        {stats && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <BarChart3 className="w-4 h-4" />
                <span>{stats.ratedCount} of {stats.totalDesigns} rated</span>
              </div>
              <span className="text-sm font-mono text-blue-400">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <Select value={ratingFilter} onValueChange={(v) => setRatingFilter(v as RatingFilter)}>
              <SelectTrigger className="w-40 bg-black border-white/20 text-white">
                <SelectValue placeholder="Filter by rating" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Designs</SelectItem>
                <SelectItem value="unrated">Unrated Only</SelectItem>
                <SelectItem value="rated">Already Rated</SelectItem>
                <SelectItem value="low">Low Rated (&lt;3)</SelectItem>
                <SelectItem value="high">High Rated (4+)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Select value={modeFilter} onValueChange={setModeFilter}>
            <SelectTrigger className="w-48 bg-black border-white/20 text-white">
              <SelectValue placeholder="Filter by tool" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tools</SelectItem>
              <SelectItem value="colorpro">ColorPro</SelectItem>
              <SelectItem value="designpanelpro">DesignProAI</SelectItem>
              <SelectItem value="fadewraps">FadeWraps</SelectItem>
              <SelectItem value="approvemode">ApproveMode</SelectItem>
              <SelectItem value="wbty">PatternPro</SelectItem>
              <SelectItem value="inkfusion">InkFusion</SelectItem>
              <SelectItem value="GraphicsPro">GraphicsPro</SelectItem>
            </SelectContent>
          </Select>

          <div className="ml-auto text-sm text-gray-500">
            {currentIndex + 1} of {totalDesigns}
          </div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="w-full aspect-video rounded-xl" />
            <Skeleton className="h-12 w-64" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && totalDesigns === 0 && (
          <Card className="bg-black/40 border-white/10 p-12 text-center">
            <p className="text-gray-400 text-lg">No designs match your filters.</p>
            <p className="text-gray-500 mt-2">Try changing the filter or generating some renders first.</p>
          </Card>
        )}

        {/* Main rating view */}
        {currentDesign && !isLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Render images - full width on mobile, 2/3 on desktop */}
            <div className="lg:col-span-2">
              <RenderViewGallery renderUrls={currentDesign.render_urls} />
            </div>

            {/* Right: Rating panel */}
            <div className="space-y-6">
              {/* Vehicle info */}
              <Card className="bg-black/40 border-white/10 p-4 space-y-3">
                <h2 className="text-lg font-semibold text-white">{vehicleLabel}</h2>
                <div className="flex flex-wrap gap-2">
                  {currentDesign.mode_type && (
                    <Badge variant="outline" className="border-blue-500/30 text-blue-400">
                      {currentDesign.mode_type}
                    </Badge>
                  )}
                  {currentDesign.color_name && (
                    <Badge variant="outline" className="border-white/20 text-gray-300">
                      {currentDesign.color_name}
                    </Badge>
                  )}
                  {currentDesign.finish_type && (
                    <Badge variant="outline" className="border-white/20 text-gray-300">
                      {currentDesign.finish_type}
                    </Badge>
                  )}
                  {currentDesign.manufacturer && (
                    <Badge variant="outline" className="border-white/20 text-gray-300">
                      {currentDesign.manufacturer}
                    </Badge>
                  )}
                </div>
                {currentDesign.color_hex && (
                  <div className="flex items-center gap-2">
                    <div
                      className="w-6 h-6 rounded-full border border-white/20"
                      style={{ backgroundColor: currentDesign.color_hex }}
                    />
                    <span className="text-sm text-gray-400 font-mono">{currentDesign.color_hex}</span>
                  </div>
                )}
                <p className="text-xs text-gray-500">
                  {new Date(currentDesign.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
                  })}
                </p>
                {currentDesign.avg_rating > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                    <span className="text-white font-semibold">{currentDesign.avg_rating.toFixed(1)}</span>
                    <span className="text-gray-500">({currentDesign.total_ratings} ratings)</span>
                  </div>
                )}
              </Card>

              {/* MyVehiclePro - see this design on a real vehicle */}
              <MyVehicleProInline
                colorName={currentDesign.color_name}
                colorHex={currentDesign.color_hex}
                finishType={currentDesign.finish_type}
                manufacturer={currentDesign.manufacturer}
                modeType={currentDesign.mode_type}
                vehicleYear={currentDesign.vehicle_year}
                vehicleMake={currentDesign.vehicle_make}
                vehicleModel={currentDesign.vehicle_model}
                renderUrl={currentDesign.render_urls?.hero || Object.values(currentDesign.render_urls || {})[0]}
              />

              {/* Star rating */}
              <Card className="bg-black/40 border-white/10 p-6 space-y-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
                  Your Rating
                </h3>
                <StarRating
                  value={pendingRating}
                  onChange={setPendingRating}
                />

                {/* Feedback text */}
                <Textarea
                  placeholder="Optional feedback (what's good, what needs work)..."
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  className="bg-black/60 border-white/10 text-white placeholder:text-gray-600 min-h-[80px]"
                />

                {/* Submit */}
                <Button
                  onClick={handleSubmitRating}
                  disabled={!pendingRating || submitRating.isPending}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                >
                  {submitRating.isPending ? "Saving..." : "Save Rating & Next"}
                </Button>

                {pendingRating != null && pendingRating <= 2 && (
                  <Link to="/admin/ai-auto-fix">
                    <Button
                      variant="outline"
                      className="w-full border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                    >
                      <Wand2 className="w-4 h-4 mr-2" /> Fix Issues with AI Auto-Fix
                    </Button>
                  </Link>
                )}

                <p className="text-xs text-gray-600 text-center">
                  Keyboard: 1-5 to rate, Arrow keys to navigate
                </p>
              </Card>

              {/* Navigation */}
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goPrev}
                  disabled={currentIndex === 0}
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                </Button>

                <span className="text-sm font-mono text-gray-500">
                  {currentIndex + 1} / {totalDesigns}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={goNext}
                  disabled={currentIndex >= totalDesigns - 1}
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
