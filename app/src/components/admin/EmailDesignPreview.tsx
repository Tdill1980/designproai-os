import { useMemo } from "react";
import { ExternalLink } from "lucide-react";

/**
 * Renders the ACTUAL email design on the Brand Board.
 *
 * Before this, an email card showed its campaign name and subject line and
 * nothing else — "it's just showing the text of the email." The design was
 * never missing: `agent_email_campaigns.body_html` holds it for 186 of 210
 * campaigns. The board simply never selected the column, and a comment in
 * AdminBrandBoard claimed "the rendered design only exists in Klaviyo" —
 * which is true for just the 9 rows that carry a klaviyo_campaign_id.
 *
 * SECURITY: this is stored HTML rendered in the admin. It goes into a
 * `sandbox`ed iframe with no `allow-scripts` and no `allow-same-origin`, so
 * script tags cannot execute and the frame cannot reach this document, its
 * cookies, or its Supabase session. `srcDoc` keeps it off any origin at all.
 * Do not add `allow-scripts` here — an email body never needs JS to render,
 * and combining it with `allow-same-origin` would defeat the sandbox entirely.
 */

type Props = {
  html: string;
  /** "card" scales the full email down into a fixed tile; "full" is readable. */
  mode?: "card" | "full";
  title?: string;
};

/** Email HTML assumes a ~600px canvas; scale that into the tile width. */
const CARD_W = 600;
const CARD_H = 800;
const TILE_W = 260;

export default function EmailDesignPreview({ html, mode = "card", title }: Props) {
  // Neutralise the two things that break an email preview inside an admin:
  // a <base> tag would repoint relative asset URLs, and target="_parent" links
  // would try to navigate the board itself.
  const safeHtml = useMemo(() => {
    const stripped = html.replace(/<base\b[^>]*>/gi, "");
    return `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=${CARD_W}">` +
      `<base target="_blank">` +
      `</head><body style="margin:0">${stripped}</body></html>`;
  }, [html]);

  if (mode === "full") {
    return (
      <iframe
        title={title || "Email design"}
        srcDoc={safeHtml}
        sandbox=""
        loading="lazy"
        className="mx-auto h-[60vh] w-full max-w-[640px] rounded-lg border border-slate-200 bg-white"
      />
    );
  }

  // Card mode fills its container — the board tile is a `relative aspect-square`
  // wrapper, so this pins to it rather than imposing a second aspect ratio.
  const scale = TILE_W / CARD_W;
  return (
    <div className="absolute inset-0 overflow-hidden bg-white">
      <iframe
        title={title || "Email design"}
        srcDoc={safeHtml}
        sandbox=""
        loading="lazy"
        scrolling="no"
        aria-hidden="true"
        style={{
          width: CARD_W,
          height: CARD_H,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/**
 * Landing pages carry a live `url` and no stored HTML, so there is nothing to
 * render inline — most sites refuse to be framed (X-Frame-Options), and a
 * blank box reads as broken. Show the destination and open it instead, which
 * is what "see the landing page" actually needs.
 */
export function LandingPagePreview({ url, title }: { url: string; title?: string }) {
  let host = url;
  try { host = new URL(url).host.replace(/^www\./, ""); } catch { /* keep raw */ }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 hover:bg-sky-100"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-sky-900">{title || host}</span>
        <span className="block truncate text-[11px] text-sky-700">{url}</span>
      </span>
      <ExternalLink className="h-4 w-4 shrink-0 text-sky-600" />
    </a>
  );
}
