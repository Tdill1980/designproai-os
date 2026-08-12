/**
 * CardCover — ONE cover face for every Brand Board tile.
 *
 * Owner, 2026-08-07: "see images or video as cover of card."
 *
 * Card faces were inconsistent because the cover came from four different places
 * with three different outcomes. Measured against production the same day, over
 * the 223 `agent_social_posts` rows that carry any media:
 *
 *     96   own image in media_urls          → a picture
 *      3   canva_template_thumbnail_url     → a picture
 *     71   poster joined from the render    → a picture
 *     51   video, no poster anywhere        → a DARK "No poster frame yet" box
 *      2   neither                          → a copy panel
 *
 * So roughly one tile in four wore a completely different face from its
 * neighbours, and the odd one out was the one carrying the most expensive
 * content — a finished video. (`video_render_jobs` is not the problem: all 118
 * complete jobs have a poster. The gap is entirely on posts whose mp4 never came
 * from a render row we can join.)
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A card shows the WORK, and video is work. Three faces, in priority order:
 *
 *   1. a real still            → <img>
 *   2. a playable video        → <video preload="metadata"> seeked to its first
 *                                frame, which IS the cover
 *   3. neither                 → the copy, on a type-tinted panel
 *
 * Face 2 is the change. The previous placeholder was added for a real reason and
 * that reason still stands: `<img src="…mp4">` paints NOTHING while downloading
 * the whole file (live examples here are 23 MB and 38 MB), and that broken tag —
 * not missing data — was the original cause of the blank cards. A `<video>` is
 * not that bug. With `preload="metadata"` and a `#t=` fragment the browser
 * fetches the container header and one frame, not the file, and the frame it
 * paints is the actual first frame of the actual cut. The tile stops apologising
 * and starts showing the work.
 *
 * `playsInline` + `muted` are required or iOS Safari refuses to render the frame
 * inline and shows its own chrome instead. `preload="none"` would defeat the
 * whole thing — nothing is fetched, nothing is painted.
 */

import { cn } from "@/lib/utils";
import { Play } from "lucide-react";
import { thumbnailUrl } from "@/lib/storage-thumbnail";

export interface CardCoverProps {
  /** A real still, already resolved through `posterFor`. */
  poster?: string | null;
  /** A playable video file, when there is one. */
  video?: string | null;
  /** Fallback copy, shown only when there is neither. */
  text?: string | null;
  /** Tint + icon for the copy panel. */
  tintColor: string;
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  /** Pixel width to request from the storage transform. */
  width?: number;
  className?: string;
}

/**
 * Seek fragment. `#t=0.1` rather than `#t=0` because a seek to exactly zero is
 * a no-op in Chrome and leaves the element blank — a tenth of a second in is
 * still the opening frame to any human and reliably decodes.
 */
function firstFrame(url: string): string {
  return url.includes("#") ? url : `${url}#t=0.1`;
}

export default function CardCover({
  poster, video, text, tintColor, icon: Icon, width = 400, className,
}: CardCoverProps) {
  if (poster) {
    return (
      <img
        src={thumbnailUrl(poster, width)}
        alt=""
        loading="lazy"
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }

  if (video) {
    return (
      <div className={cn("relative h-full w-full bg-slate-900", className)}>
        <video
          src={firstFrame(video)}
          // metadata + a seek fragment = one frame, not 23 MB. See the header.
          preload="metadata"
          muted
          playsInline
          // Not `controls`: this is a cover, and the whole tile is the click
          // target. Controls here would swallow the click that opens the card.
          className="h-full w-full object-cover"
          tabIndex={-1}
          aria-hidden="true"
        />
        {/* The play affordance sits ON the frame, so the tile reads as a video
            without hiding what the video looks like — which is the entire
            complaint the dark placeholder caused. */}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
            <Play className="ml-0.5 h-4 w-4 fill-white text-white" />
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn("flex h-full w-full flex-col p-2.5", className)}
      style={{ backgroundColor: `${tintColor}1a` }}
    >
      {Icon && <Icon className="mb-1.5 h-4 w-4 shrink-0" style={{ color: tintColor }} />}
      <p className="line-clamp-6 whitespace-pre-wrap text-[10px] leading-snug text-slate-700">
        {text}
      </p>
    </div>
  );
}
