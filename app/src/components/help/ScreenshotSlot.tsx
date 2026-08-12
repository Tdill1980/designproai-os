/**
 * ScreenshotSlot — placeholder for a screenshot in a help walkthrough.
 *
 * Shows a dashed-border box with a caption so it's obvious during
 * authoring that a real screenshot needs to be dropped in. When `src`
 * is provided, renders the actual image instead. Lets us ship the
 * walkthrough structure today and swap in real captures later without
 * touching the page code.
 */

import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScreenshotSlotProps {
  /** Short label shown inside the empty slot (e.g. "Affiliate dashboard top"). */
  label: string;
  /** Optional longer note describing what the screenshot should show. */
  note?: string;
  /** When set, renders the image instead of the placeholder. */
  src?: string;
  /** Alt text for the rendered image (required when `src` is set). */
  alt?: string;
  className?: string;
}

export function ScreenshotSlot({
  label,
  note,
  src,
  alt,
  className,
}: ScreenshotSlotProps) {
  if (src) {
    return (
      <figure className={cn("my-6", className)}>
        <img
          src={src}
          alt={alt ?? label}
          className="w-full rounded-xl border border-border shadow-lg"
          loading="lazy"
        />
        {note && (
          <figcaption className="text-xs text-muted-foreground text-center mt-2">
            {note}
          </figcaption>
        )}
      </figure>
    );
  }

  return (
    <div
      className={cn(
        "my-6 rounded-xl border-2 border-dashed border-border bg-muted/30 p-8 flex flex-col items-center justify-center text-center min-h-[180px]",
        className,
      )}
      role="img"
      aria-label={`Screenshot placeholder: ${label}`}
    >
      <ImageIcon className="h-6 w-6 text-muted-foreground/60 mb-2" />
      <div className="text-sm font-semibold text-foreground/70">{label}</div>
      {note && (
        <div className="text-xs text-muted-foreground mt-1 max-w-md">
          {note}
        </div>
      )}
    </div>
  );
}
