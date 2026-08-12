import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LOADING_MESSAGES,
  SUCCESS_MESSAGES,
  ERROR_MESSAGES,
  WRAP_FACTS,
} from "@/lib/sproket-config";

type SproketFillerMode = "loading" | "success" | "error";

interface SproketFillerProps {
  mode: SproketFillerMode;
  /** Progress percentage 0-100 (only used in loading mode) */
  progress?: number;
  /** Elapsed seconds (for rotating messages) */
  elapsedSeconds?: number;
  /** Optional override message */
  message?: string;
  /** Called when user clicks retry in error mode */
  onRetry?: () => void;
  /** Called when user dismisses success */
  onDismiss?: () => void;
  /** Compact mode for inline use (no full-width card) */
  compact?: boolean;
}

/**
 * LAYER 3 — Filler Narrator
 * Loading carousels, success celebrations, and error states with SPROKET.
 */
export const SproketFiller = ({
  mode,
  progress = 0,
  elapsedSeconds = 0,
  message,
  onRetry,
  onDismiss,
  compact = false,
}: SproketFillerProps) => {
  const [msgIndex, setMsgIndex] = useState(
    () => Math.floor(Math.random() * LOADING_MESSAGES.length)
  );
  const [factIndex, setFactIndex] = useState(
    () => Math.floor(Math.random() * WRAP_FACTS.length)
  );
  const [fading, setFading] = useState(false);

  // Rotate loading messages every 5s
  useEffect(() => {
    if (mode !== "loading") return;
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setMsgIndex((p) => (p + 1) % LOADING_MESSAGES.length);
        setFactIndex((p) => (p + 1) % WRAP_FACTS.length);
        setFading(false);
      }, 300);
    }, 5000);
    return () => clearInterval(interval);
  }, [mode]);

  const loadingItem = LOADING_MESSAGES[msgIndex % LOADING_MESSAGES.length];
  const successItem =
    SUCCESS_MESSAGES[Math.floor(Math.random() * SUCCESS_MESSAGES.length)];
  const errorItem =
    ERROR_MESSAGES[Math.floor(Math.random() * ERROR_MESSAGES.length)];

  const current =
    mode === "loading"
      ? loadingItem
      : mode === "success"
        ? successItem
        : errorItem;

  const displayMessage = message || current.text;

  if (compact) {
    return (
      <div className="flex items-center gap-3 py-2">
        <img
          src={current.image}
          alt="SPROKET"
          className={cn(
            "w-10 h-10 object-contain shrink-0",
            mode === "loading" && "animate-sproket-bob"
          )}
        />
        <p
          className={cn(
            "text-xs text-muted-foreground transition-opacity duration-300",
            fading ? "opacity-0" : "opacity-100"
          )}
        >
          {displayMessage}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden border border-blue-500/20 bg-card">
      {/* Progress bar (loading only) */}
      {mode === "loading" && (
        <div className="h-2 w-full bg-secondary/50 relative overflow-hidden">
          <div
            className="h-full transition-all duration-1000 ease-out relative"
            style={{ width: `${Math.min(progress, 98)}%` }}
          >
            <div
              className="absolute inset-0 animate-gradient-x"
              style={{
                background:
                  "linear-gradient(90deg, #22d3ee, #a855f7, #d946ef, #22d3ee)",
                backgroundSize: "200% 100%",
              }}
            />
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white/40 to-transparent" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
        </div>
      )}

      {/* Success bar */}
      {mode === "success" && (
        <div className="h-2 w-full bg-emerald-500/80" />
      )}

      {/* Error bar */}
      {mode === "error" && (
        <div className="h-2 w-full bg-red-500/60" />
      )}

      <div className="p-5 sm:p-6 space-y-4">
        {/* Main content */}
        <div className="flex items-center gap-4">
          <img
            src={current.image}
            alt="SPROKET"
            className={cn(
              "w-12 h-12 sm:w-16 sm:h-16 md:w-24 md:h-24 object-contain shrink-0",
              mode === "loading" && "animate-sproket-bob"
            )}
          />
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                "text-sm font-semibold font-poppins transition-opacity duration-300",
                fading ? "opacity-0" : "opacity-100",
                mode === "success"
                  ? "text-emerald-400"
                  : mode === "error"
                    ? "text-red-400"
                    : "text-foreground"
              )}
            >
              {displayMessage}
            </p>
            {mode === "loading" && (
              <p className="text-xs text-muted-foreground mt-1">
                {Math.round(progress)}% complete
              </p>
            )}
          </div>
          {mode === "loading" && (
            <p className="text-xs font-mono text-blue-400 shrink-0">
              {Math.round(progress)}%
            </p>
          )}
        </div>

        {/* Wrap fact (loading only) */}
        {mode === "loading" && (
          <div className="bg-secondary/40 rounded-lg p-3 border border-border/50 min-h-[44px] flex items-center">
            <p
              className={cn(
                "text-xs text-muted-foreground italic leading-relaxed transition-opacity duration-300",
                fading ? "opacity-0" : "opacity-100"
              )}
            >
              &ldquo;{WRAP_FACTS[factIndex]}&rdquo;
            </p>
          </div>
        )}

        {/* Action buttons */}
        {mode === "error" && onRetry && (
          <button
            onClick={onRetry}
            className="w-full py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/30 transition-colors"
          >
            Try Again
          </button>
        )}

        {mode === "success" && onDismiss && (
          <button
            onClick={onDismiss}
            className="w-full py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-sm font-medium hover:bg-emerald-500/30 transition-colors"
          >
            View Render
          </button>
        )}
      </div>
    </div>
  );
};
