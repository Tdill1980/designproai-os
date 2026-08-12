import { cn } from "@/lib/utils";

/**
 * Inline SPROKET coaching card for use anywhere on a page where you want a
 * short, on-brand tip from him. Distinct from SproketHelper (the global
 * bottom-left avatar + FAQ panel) — this one sits inline next to specific
 * UI sections so the explanation is visible without a click.
 *
 * Sizing is bulletproof by design: the image is wrapped in a fixed-size box,
 * uses `object-contain`, has explicit width/height HTML attrs, and is capped
 * with max-w/max-h so it can never grow past the wrapper. Past Claudes have
 * accidentally let SPROKET fill the whole page when they relied on intrinsic
 * image dimensions or fluid containers — this component blocks that.
 */
export interface SproketTipProps {
  /** Filename only (e.g. "sproket-camera.png") OR full path. */
  pose: string;
  /** Short headline above the message. Optional. */
  headline?: string;
  /** Body copy. One or two sentences works best. */
  message: string;
  /** Visual size of SPROKET. Defaults to "md" (~64px). */
  size?: "sm" | "md" | "lg";
  /** Visual treatment. "card" = bordered box, "ghost" = transparent. */
  variant?: "card" | "ghost";
  /** Optional extra class names on the outer wrapper. */
  className?: string;
}

const SIZE_MAP = {
  sm: { box: "w-10 h-10 max-w-[40px] max-h-[40px]", px: 40 },
  md: { box: "w-16 h-16 max-w-[64px] max-h-[64px]", px: 64 },
  lg: { box: "w-24 h-24 max-w-[96px] max-h-[96px]", px: 96 },
} as const;

const SPROKET_FOLDER = "/characters/sproket/";

function resolvePose(pose: string): string {
  if (pose.startsWith("/") || pose.startsWith("http")) return pose;
  return `${SPROKET_FOLDER}${pose.replace(/^\/+/, "")}`;
}

export function SproketTip({
  pose,
  headline,
  message,
  size = "md",
  variant = "card",
  className,
}: SproketTipProps) {
  const { box, px } = SIZE_MAP[size];
  const src = resolvePose(pose);

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl",
        variant === "card" && "bg-gray-50 border border-gray-200 p-3 sm:p-4",
        variant === "ghost" && "p-2",
        className,
      )}
    >
      {/* Fixed-size wrapper. Image fills it via object-contain.
          shrink-0 stops flex from collapsing or stretching the box. */}
      <div className={cn(box, "shrink-0")}>
        <img
          src={src}
          alt="SPROKET"
          width={px}
          height={px}
          className="w-full h-full object-contain"
        />
      </div>
      <div className="flex-1 min-w-0">
        {headline && (
          <p className="text-[13px] font-bold text-gray-900 leading-snug mb-0.5">
            {headline}
          </p>
        )}
        <p className="text-xs sm:text-[13px] text-gray-700 leading-snug">
          {message}
        </p>
      </div>
    </div>
  );
}
