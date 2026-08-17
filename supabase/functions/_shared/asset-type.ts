/**
 * asset-type — `agent_media_assets.asset_type`, decided ONCE, for edge functions.
 *
 * ── THIS IS A RESTATEMENT, NOT A SECOND IMPLEMENTATION ─────────────────────
 * The canonical file is `src/lib/assetContentType.ts` (`resolveAssetType`).
 * That file is browser TypeScript behind the `@/` alias and imports nothing;
 * this is Deno, and an edge function's bundle cannot reach `src/`. There is no
 * import to be had at any price — the same constraint that forced
 * `worker/video-renderer/classify.js` to restate the content classifier.
 *
 * So the logic is restated VERBATIM and PINNED: `tests/asset-type-lock.test.ts`
 * drives both implementations through one shared case table and asserts
 * identical `{assetType, reason}` for every case. That precedent is not
 * decorative — the browser's STOPWORDS list was copied into `contentRunner.js`
 * and quietly corrupted, and the server then matched the wrong footage for
 * weeks with the browser's own tests still green. Two copies of a rule do not
 * announce that they have diverged. DO NOT HAND-EDIT ONE SIDE.
 *
 * ── WHY IT EXISTS AT ALL ───────────────────────────────────────────────────
 * CLAUDE.md: "`asset_type` MUST detect audio. Every uploader needs an explicit
 * audio branch (extension + mime). An mp3 falling through to 'video' or
 * 'image' is why a whole song catalogue 'disappeared' three separate times."
 * Two edge-function ingest paths had no audio branch at all — drive-sync's
 * binary `?action=ingest` hardcoded `"video"`, and wpw-workforce-sweep's
 * `ingest_media` split only image-vs-video. Both now call this.
 *
 * And it CANNOT RETURN `rendered_video`: that value means "a finished cut this
 * system produced", it is excluded from the raw pool by every picker, and an
 * ingest that emits it makes the operator's footage invisible to the entire
 * content side. The return type is the three raw kinds, so no ingest can emit
 * it even by accident.
 */

/** The three kinds of raw material the library pool holds. */
export type RawAssetType = "video" | "image" | "audio";

export const RAW_ASSET_TYPES: RawAssetType[] = ["video", "image", "audio"];

/** Media kind, derived from the URL/filename — audio must never fall through. */
export function detectAssetKind(nameOrUrl: string): "video" | "image" | "audio" | "unknown" {
  const s = String(nameOrUrl || "").toLowerCase().split("?")[0];
  if (/\.(mp3|wav|m4a|aac|flac|ogg)$/.test(s)) return "audio";
  if (/\.(mp4|mov|webm|m4v|avi|mts|mkv)$/.test(s)) return "video";
  if (/\.(jpe?g|png|webp|gif|heic|tiff?)$/.test(s)) return "image";
  return "unknown";
}

export interface AssetTypeInput {
  filename?: string | null;
  mimeType?: string | null;
  url?: string | null;
}

/** A mime type's media family, or null when it says nothing usable. */
function kindFromMime(mime: unknown): RawAssetType | null {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  if (!m) return null;
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  // `application/octet-stream` is "I don't know", never a family.
  return null;
}

/**
 * The `asset_type` for ONE incoming file.
 *
 * Signal order is the policy: filename → mime → url. The filename is what the
 * PERSON's own file says; the mime is a good second opinion and a poor first
 * one (browsers report nothing for unknown types); the URL is usually the only
 * signal a pasted link has.
 *
 * The fallback is `video` on purpose: `image` is silently excluded from the
 * Clip Library query, so a mistyped image is INVISIBLE, while a mistyped video
 * is a broken thumbnail — loud and correctable. It is only reachable when all
 * three signals say nothing, which no audio file can do.
 */
export function resolveAssetType(input: AssetTypeInput): { assetType: RawAssetType; reason: string } {
  const src = input && typeof input === "object" ? input : {};

  const byFilename = detectAssetKind(String(src.filename || ""));
  if (byFilename !== "unknown") return { assetType: byFilename, reason: `filename extension (${src.filename})` };

  const byMime = kindFromMime(src.mimeType);
  if (byMime) return { assetType: byMime, reason: `mime type (${src.mimeType})` };

  const byUrl = detectAssetKind(String(src.url || ""));
  if (byUrl !== "unknown") return { assetType: byUrl, reason: "url extension" };

  return {
    assetType: "video",
    reason: "no filename extension, mime type or url extension identified this file — typed 'video' because it is the VISIBLE fallback (an 'image' row is silently dropped by the Clip Library query); correct it by hand if it is wrong",
  };
}
