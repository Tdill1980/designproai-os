import { memo } from "react";
import { Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RevisionItem {
  id: string;
  view_type: string;
  revision_prompt: string;
  revised_url: string;
  original_url?: string;
  created_at: string;
}

interface RevisionHistoryTimelineProps {
  history: RevisionItem[];
  onSelect: (item: RevisionItem) => void;
  onRestore?: (item: RevisionItem) => void;
  className?: string;
}

export const RevisionHistoryTimeline = memo(({
  history,
  onSelect,
  onRestore,
  className = ""
}: RevisionHistoryTimelineProps) => {
  if (!history || history.length === 0) return null;

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Clock className="h-4 w-4" />
        <span>Revision History</span>
        <span className="text-xs text-muted-foreground">({history.length})</span>
      </div>

      <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
        {history.map((item, index) => (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className="w-full p-3 bg-background/40 border border-border/40 rounded-lg text-left hover:bg-background/60 hover:border-primary/30 transition-all group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  {item.view_type || 'Main View'} • v{history.length - index}
                </div>
                <p className="text-sm font-medium text-foreground line-clamp-2">
                  {item.revision_prompt}
                </p>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {new Date(item.created_at).toLocaleString()}
                </div>
              </div>
              {onRestore && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore(item);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity h-7 px-2"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Restore
                </Button>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
});
