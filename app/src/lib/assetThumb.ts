/**
 * assetThumb — resolve a REAL picture for a library asset card.
 *
 * The Asset Library showed black tiles, for three separate reasons found in
 * the live data (2026-07-30):
 *
 *  1. 139 videos are stored as `drive.google.com/file/d/<id>/view` — that is a
 *     WEB PAGE, not a media file. A <video src> pointed at it can never render
 *     anything. Drive does publish a real JPEG for those files though, at
 *     /thumbnail?id=…, which an <img> can show.
 *  2. 265 videos are real Supabase mp4s, but `<video preload="metadata">` plus
 *     a seek in onLoadedMetadata does NOT reliably paint a frame — browsers
 *     load the header and stop. A `#t=` media fragment in the src does, because
 *     it tells the browser which frame to show as the poster.
 *  3. `agent_media_assets.thumbnail_url` EXISTS and was never read. Rows that
 *     already had a stored poster still rendered black.
 *
 * Order: stored poster → Drive thumbnail → media fragment → honest "no
 * preview" (a labeled placeholder, never a black box, because black reads as
 * broken when it actually means "we have no frame for this").
 */

export type ThumbKind = "image" | "video" | "audio" | "none";

export interface ThumbResult {
  /** How to render it: <img>, <video>, a music tile, or a placeholder. */
  kind: ThumbKind;
  /** The URL to put in the tag. Empty when kind is "none". */
  src: string;
  /** Why this source was chosen — surfaced in a title attr for debugging. */
  via: "stored" | "drive" | "fragment" | "direct" | "none";
}

/** Pull a Drive file id out of any of the URL shapes Drive hands out. */
export function driveFileId(url?: string | null, explicitId?: string | null): string | null {
  if (explicitId && /^[\w-]{10,}$/.test(explicitId)) return explicitId;
  const u = String(url || "");
  if (!/drive\.google\.com|docs\.google\.com/.test(u)) return null;
  const m = u.match(/\/file\/d\/([\w-]{10,})/) || u.match(/[?&]id=([\w-]{10,})/);
  return m ? m[1] : null;
}

/** Drive's own poster JPEG. Works for anything shared "anyone with the link". */
export function driveThumbUrl(id: string, width = 640): string {
  return `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`;
}

export function isImageUrl(u?: string | null): boolean {
  return /\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(String(u || ""));
}

export function isVideoUrl(u?: string | null): boolean {
  return /\.(mp4|mov|webm|m4v|avi)(\?.*)?$/i.test(String(u || ""));
}

export interface ThumbInput {
  asset_type?: string | null;
  storage_url?: string | null;
  thumbnail_url?: string | null;
  drive_file_id?: string | null;
}

/**
 * @param seekSeconds where to grab the poster frame from a playable video.
 *   0.5s, not 0 — the first frame of a clip is often black or a fade-in.
 */
export function assetThumb(a: ThumbInput, seekSeconds = 0.5): ThumbResult {
  // 1. A stored poster always wins — it's a real decoded frame.
  if (a.thumbnail_url) return { kind: "image", src: a.thumbnail_url, via: "stored" };

  const url = a.storage_url || "";
  const isAudio = a.asset_type === "audio" || /\.(mp3|wav|m4a|aac|flac|ogg)(\?.*)?$/i.test(url);
  if (isAudio) return { kind: "audio", src: "", via: "none" };

  // 2. Drive-hosted: the link is a web page, but Drive publishes a JPEG.
  const dId = driveFileId(url, a.drive_file_id);
  if (dId) return { kind: "image", src: driveThumbUrl(dId), via: "drive" };

  if (!url) return { kind: "none", src: "", via: "none" };

  // 3. A real image file renders directly.
  if (a.asset_type === "image" || isImageUrl(url)) return { kind: "image", src: url, via: "direct" };

  // 4. A playable video: the media fragment is what actually paints a frame.
  if (isVideoUrl(url) || a.asset_type === "video" || a.asset_type === "rendered_video") {
    return { kind: "video", src: `${url}#t=${seekSeconds}`, via: "fragment" };
  }

  return { kind: "none", src: "", via: "none" };
}
