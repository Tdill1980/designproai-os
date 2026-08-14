/**
 * Single source of truth for asset slots on /from/weprintwraps.
 *
 * Each slot maps to a `homepage_showcase` row whose `name` follows the
 * convention `wpw-founder:<slot-key>`. The admin uploader at
 * /admin/wpw-founder-assets writes URLs into these rows; the landing
 * page reads them via useWpwFounderAssets().
 */

export type WpwFounderSlotKind = "video" | "image";

export interface WpwFounderSlot {
  key: string;
  rowName: string; // homepage_showcase.name
  label: string;
  kind: WpwFounderSlotKind;
  helper: string;
  ratio: string; // tailwind aspect class, e.g. "aspect-[16/10]"
  accept: string; // file input accept attr
  recommendedSize: string;
}

const tool = (
  key: string,
  label: string,
  helper: string
): WpwFounderSlot => ({
  key,
  rowName: `wpw-founder:tool-${key}`,
  label,
  kind: "image", // tool slots are stills only — only the founder slot is video
  helper,
  ratio: "aspect-[9/16]",
  accept: "image/png,image/jpeg,image/webp",
  recommendedSize: "1080 × 1920 (9:16) still image",
});

const teamVideo = (
  key: string,
  personName: string,
  role: string
): WpwFounderSlot => ({
  key,
  rowName: `wpw-team:${key}`,
  label: `${personName} (${role}) — Reel`,
  kind: "video",
  helper: `9:16 reel-size video of ${personName} on their team card. Same slot type as the founder reel.`,
  ratio: "aspect-[9/16]",
  accept: "video/mp4,video/quicktime,video/webm",
  recommendedSize: "1080 × 1920 (9:16) MP4 — Reel format",
});

const teamPhoto = (
  key: string,
  label: string,
  helper: string,
  ratio: string = "aspect-[4/5]"
): WpwFounderSlot => ({
  key,
  rowName: `wpw-team:${key}`,
  label,
  kind: "image",
  helper,
  ratio,
  accept: "image/png,image/jpeg,image/webp",
  recommendedSize: ratio === "aspect-[4/5]" ? "1080 × 1350 (4:5)" : "1080 × 1920 (9:16)",
});

export const WPW_FOUNDER_SLOTS: WpwFounderSlot[] = [
  {
    key: "video",
    rowName: "wpw-founder:video",
    label: "Founder Video (9:16 Reels)",
    kind: "video",
    helper:
      "Vertical reels-size video that plays right after the 'A note from the founder' intro.",
    ratio: "aspect-[9/16]",
    accept: "video/mp4,video/quicktime,video/webm",
    recommendedSize: "1080 × 1920 (9:16) MP4",
  },
  {
    key: "video-poster",
    rowName: "wpw-founder:video-poster",
    label: "Founder Video Poster",
    kind: "image",
    helper:
      "Optional still frame shown before the video starts playing.",
    ratio: "aspect-[9/16]",
    accept: "image/png,image/jpeg,image/webp",
    recommendedSize: "1080 × 1920 (9:16)",
  },
  tool("designproai", "DesignProAI™", "Full custom wrap design tools"),
  tool("wallpro", "WallPro™", "Wall wrap & environmental graphic tools"),
  tool(
    "graphicspro",
    "GraphicsPro™",
    "Cut contour graphics for vehicles, windows, walls & flat surfaces"
  ),
  tool(
    "myvehiclepro",
    "MyVehiclePro™",
    "Show designs on customer vehicle photos"
  ),
  tool("colorpro", "ColorPro™", "Visualize real manufacturer wrap films"),
  tool("quickquote", "QuickQuote™", "Design and quote at the same time"),
  tool(
    "revisionstudio",
    "RevisionStudioIQ™",
    "Manage revisions & proofs"
  ),
  tool(
    "productionflow",
    "ProductionFlow™",
    "From proof to print workflow"
  ),
  {
    key: "productionpack",
    rowName: "wpw-founder:productionpack",
    label: "Production Pack",
    kind: "image",
    helper:
      "Hero image of a real Production Pack — shown above the $299 Production Packs section on /pricing.",
    ratio: "aspect-[16/9]",
    accept: "image/png,image/jpeg,image/webp",
    recommendedSize: "1920 × 1080 (16:9) product photo or render",
  },
  {
    key: "shopengine",
    rowName: "wpw-founder:tool-shopengine",
    label: "ShopEngine Dashboard",
    kind: "image",
    helper:
      "Screenshot of the ShopEngine dashboard — shown on the Free tier card on /pricing.",
    ratio: "aspect-[16/9]",
    accept: "image/png,image/jpeg,image/webp",
    recommendedSize: "1920 × 1080 (16:9) dashboard screenshot",
  },

  // ── Team cards (Design + Marketing) ─────────────────────────────────
  // Identical structure to the founder card above — just per-person rows.
  teamVideo("troy-video", "Troy", "Designer"),
  teamVideo("lance-video", "Lance", "Designer"),
  teamVideo("rj-video", "RJ", "Designer"),
  teamPhoto(
    "xavier-at-pc",
    "Xavier (Designer) — At the PC",
    "Working photo of Xavier designing in RestyleProAI. Shown on his team card."
  ),
  teamPhoto(
    "amanda-at-pc",
    "Amanda (Marketing) — At the PC",
    "Working photo of Amanda. Shown on her marketing team card."
  ),
  teamPhoto(
    "amanda-design",
    "Amanda (Marketing) — Featured Design",
    "One of Amanda's designs — featured on her marketing card.",
    "aspect-[16/9]"
  ),
];

export const WPW_FOUNDER_TOOL_KEYS = [
  "designproai",
  "wallpro",
  "graphicspro",
  "myvehiclepro",
  "colorpro",
  "quickquote",
  "revisionstudio",
  "productionflow",
] as const;

export type WpwFounderToolKey = (typeof WPW_FOUNDER_TOOL_KEYS)[number];

export const slotByKey = (key: string): WpwFounderSlot | undefined =>
  WPW_FOUNDER_SLOTS.find((s) => s.key === key);

/** Best-effort detection of whether a stored asset URL is a video. */
export const isVideoUrl = (url: string): boolean =>
  /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url);

/**
 * If the URL is a YouTube/Vimeo link, return an embed URL suitable for
 * an <iframe>. Returns null for direct video / image files.
 *
 * Accepted forms:
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/shorts/VIDEO_ID
 *   https://vimeo.com/123456789
 */
export const getEmbedUrl = (url: string): string | null => {
  if (!url) return null;
  const yt =
    url.match(/youtube\.com\/(?:watch\?v=|shorts\/)([A-Za-z0-9_-]{6,})/) ||
    url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (yt) {
    return `https://www.youtube.com/embed/${yt[1]}?rel=0&modestbranding=1&playsinline=1`;
  }
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) {
    return `https://player.vimeo.com/video/${vimeo[1]}?byline=0&portrait=0`;
  }
  return null;
};
