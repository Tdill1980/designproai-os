import { Link } from "react-router-dom";
import { Camera, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useRecentRenders } from "@/hooks/useRecentRenders";

export const RecentRendersStrip = () => {
  const { data: renders, isLoading } = useRecentRenders(8);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-[#60A5FA]" />
          <h3 className="text-sm font-bold text-white uppercase tracking-[0.15em]">
            Your recent designs & renders
          </h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="text-white/80 hover:text-white hover:bg-rp-elevated h-7 text-xs font-semibold"
        >
          <Link to="/my-renders">
            View all
            <ArrowRight className="w-3 h-3 ml-1" />
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton
              key={i}
              className="w-48 h-28 rounded-xl bg-rp-elevated shrink-0"
            />
          ))}
        </div>
      ) : !renders || renders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#48484a] bg-rp-surface py-8 text-center">
          <Camera className="w-6 h-6 text-white/50 mx-auto mb-2" />
          <div className="text-sm text-white/80 font-inter">No renders yet</div>
          <div className="text-xs text-white/80 mt-0.5 font-inter">
            Open any Visualizer tool to create your first render.
          </div>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x snap-mandatory">
          {renders.map((r) => (
            <Link
              key={r.id}
              to={`/my-renders?id=${r.id}`}
              className="group relative w-44 sm:w-52 h-28 sm:h-32 shrink-0 rounded-xl overflow-hidden border border-[#48484a] hover:border-[#48484a] transition snap-start bg-rp-surface"
            >
              <img
                src={r.imageUrl}
                alt={r.vehicleLabel || "Render"}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = "0.3";
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
              <div className="absolute bottom-1.5 left-2 right-2 text-[11px] text-white truncate font-semibold drop-shadow font-inter">
                {r.vehicleLabel || "Untitled"}
              </div>
              <span className="absolute top-1.5 right-1.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-white bg-gradient-rp-pop tracking-wide">
                {r.toolType}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
};
