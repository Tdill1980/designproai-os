import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Inline notice for a failed Revision Studio full-job read. Small, in place,
 * with a Retry that refetches the job. While it shows, the studio offers no
 * missing-views banner and no Generate action.
 */
export function JobLoadErrorNotice({
  message,
  retrying = false,
  onRetry,
}: {
  message: string;
  retrying?: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="revision-studio-job-load-error"
      className="mb-4 flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200"
    >
      <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-400" />
      <span className="flex-1 min-w-0">
        Couldn&apos;t load this design&apos;s full job. {message}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 px-3 text-xs"
        onClick={onRetry}
        disabled={retrying}
        data-testid="revision-studio-job-load-retry"
      >
        {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Retry
      </Button>
    </div>
  );
}
