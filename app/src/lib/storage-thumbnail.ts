const SUPABASE_PUBLIC_URL_RE =
  /^(https?:\/\/[^/]+)\/storage\/v1\/object\/public\/(.+)$/;

/**
 * Rewrite a Supabase Storage public URL to use the image-transformation
 * render endpoint, which returns a resized version on the fly. Gallery
 * cards display 8 MB+ WallPro PNGs as ~80 KB JPEGs — small enough for iOS
 * Safari to decode several at once without bailing out with a broken-image
 * placeholder. Non-Supabase URLs (relative paths, external refs) are
 * returned unchanged.
 */
export function thumbnailUrl(
  url: string | undefined | null,
  width = 800,
  quality = 75,
): string {
  if (!url) return "";
  const match = url.match(SUPABASE_PUBLIC_URL_RE);
  if (!match) return url;
  const [, origin, objectPath] = match;
  const cleanPath = objectPath.split("?")[0];
  return `${origin}/storage/v1/render/image/public/${cleanPath}?width=${width}&quality=${quality}`;
}
