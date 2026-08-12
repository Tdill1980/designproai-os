/**
 * mediaLinks — the ONE place a share link becomes a URL that returns FILE BYTES.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * A share link is a WEB PAGE. `dropbox.com/scl/fi/…` and
 * `drive.google.com/file/d/…/view` both answer 200 with HTML. Point a parser at
 * one and it downloads the page, stores it as if it were a clip, and every
 * downstream step — transcript, moments, Story Edit, the footage matcher —
 * reads a file that is not a video and finds nothing. The failure is silent by
 * construction: the row looks ingested, the job says complete, and the only
 * visible symptom is "the AI produces nothing from my footage".
 *
 * So the rule here is narrow and absolute:
 *
 *   **A link this cannot convert WITH CONFIDENCE is returned as a failure with
 *   a reason. It is never guessed at.**
 *
 * `{ ok: false, reason }` is a correct answer. A URL that 200s with HTML is a
 * worse outcome than a link that fails loudly, because a loud failure is fixed
 * in ten seconds by the person who pasted it, and a stored HTML page is found
 * weeks later by someone wondering why the library is empty of meaning.
 *
 * ── PURE ───────────────────────────────────────────────────────────────────
 * No network, no clock, no randomness. It never checks whether a URL resolves —
 * it only says whether the SHAPE is one that serves bytes. Whether the bytes
 * arrive is the caller's problem, and the caller is the one holding the fetch.
 *
 * ── THE SHAPES IT KNOWS, AND WHAT PRODUCTION SAYS ──────────────────────────
 * Measured on `agent_media_assets` (video rows) 2026-08-07:
 *   139  drive.google.com/file/d/<id>/view   — HTML pages standing in for clips
 *     8  dropbox.com/scl/fi/…                — Jackson's shoot, pasted by hand
 *   288  already end in a media extension    — Supabase storage and friends
 *     0  unconvertible                        — nothing is lost by being strict
 */

/**
 * Extensions that name a real media FILE.
 *
 * Deliberately a closed list rather than "anything after the last dot": the
 * loose form (`/\.[a-z0-9]{2,5}$/`) accepts `.html` and `.aspx`, which is the
 * exact mistake this module exists to stop.
 */
const MEDIA_EXT =
  /\.(mp4|m4v|mov|qt|webm|avi|mkv|mts|m2ts|mpe?g|wmv|flv|3gp|mxf|jpe?g|jfif|png|webp|gif|avif|heic|heif|tiff?|bmp|mp3|wav|m4a|aac|flac|ogg|oga|opus|aiff?|wma)$/i;

export type MediaLinkKind =
  /** Already serves bytes — nothing to rewrite. */
  | "direct"
  /** A Dropbox single-file share link, asked for its raw bytes. */
  | "dropbox_file"
  /** A Google Drive file, addressed by its direct-download endpoint. */
  | "drive_file";

export interface MediaLinkOk {
  ok: true;
  /** A URL whose response body is the FILE, not a page describing it. */
  url: string;
  kind: MediaLinkKind;
  /** True when the input was rewritten — false means it was already fetchable. */
  changed: boolean;
  /** The Drive file id, when one was recognised. Callers persist it. */
  driveFileId: string | null;
  /** The real filename recovered from the path, when the path carries one. */
  filename: string | null;
  /**
   * Set when the URL is the right shape but may still need help.
   *
   * Never a guess and never a hedge on the shape itself — only a statement of
   * a known, documented condition (Drive's virus-scan interstitial). A caveat
   * is information for the human, not permission to treat a failure as a pass.
   */
  caveat?: string;
}

export interface MediaLinkFail {
  ok: false;
  /** Plain language, and always the next step — never just "invalid URL". */
  reason: string;
}

export type MediaLink = MediaLinkOk | MediaLinkFail;

/**
 * The real filename out of a share URL.
 *
 * Eight clips all titled "Linked footage" are indistinguishable on a shot card,
 * which is what a bare URL produced on a live shoot. Dropbox and Drive both put
 * the name in the path, so it is recoverable without a network call.
 */
export function mediaFilenameFromUrl(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  try {
    const path = raw.split("?")[0].split("#")[0];
    const last = path.split("/").filter(Boolean).pop() || "";
    const decoded = decodeURIComponent(last);
    return MEDIA_EXT.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** True when the path names a media file, ignoring any query string. */
export function looksLikeMediaFile(input: string | null | undefined): boolean {
  return mediaFilenameFromUrl(input) !== null;
}

/**
 * Hosts that serve a PLAYER or a PREVIEW, never the file.
 *
 * These are listed by name so the failure can say what the link actually is.
 * "youtube.com is not a media file" is actionable; "unrecognised host" is not.
 */
const PAGE_ONLY: { host: string; what: string }[] = [
  { host: "youtube.com", what: "a YouTube watch page" },
  { host: "youtu.be", what: "a YouTube share link" },
  { host: "vimeo.com", what: "a Vimeo player page" },
  { host: "loom.com", what: "a Loom player page" },
  { host: "wistia.com", what: "a Wistia player page" },
  { host: "frame.io", what: "a Frame.io review page" },
  { host: "canva.com", what: "a Canva design page" },
  { host: "wetransfer.com", what: "a WeTransfer download page" },
  { host: "we.tl", what: "a WeTransfer short link" },
  { host: "box.com", what: "a Box preview page" },
  { host: "onedrive.live.com", what: "a OneDrive preview page" },
  { host: "1drv.ms", what: "a OneDrive short link" },
  { host: "sharepoint.com", what: "a SharePoint preview page" },
  { host: "icloud.com", what: "an iCloud preview page" },
];

const DRIVE_CAVEAT =
  "Drive answers a plain fetch with its virus-scan confirmation page for large files; the parser's service-account path handles that, an unauthenticated fetch may not.";

/** Any of the URL shapes Drive hands out. Same patterns as `assetThumb.driveFileId`. */
function driveIdFrom(url: string): string | null {
  const m =
    url.match(/\/file\/d\/([\w-]{10,})/) ||
    url.match(/\/d\/([\w-]{10,})/) ||
    url.match(/[?&]id=([\w-]{10,})/);
  return m ? m[1] : null;
}

/**
 * Turn a pasted link into something a parser can actually download.
 *
 * Deterministic: same input, same output, always. Idempotent on its own output
 * — feeding a converted URL back through returns it unchanged with
 * `changed: false`, so a row can be re-normalised any number of times without
 * drifting.
 */
export function toFetchableMediaUrl(input: string | null | undefined): MediaLink {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, reason: "No link was given." };
  if (!/^https?:\/\//i.test(raw)) {
    return { ok: false, reason: "That is not an http(s) link — paste the full URL, starting with https://." };
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "That is not a URL a browser can parse — check for a missing character or a stray space." };
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const isHost = (d: string) => host === d || host.endsWith(`.${d}`);
  const path = u.pathname;
  const filename = mediaFilenameFromUrl(raw);

  // ── DROPBOX ──────────────────────────────────────────────────────────────
  // A file share link serves the raw bytes with `raw=1`; the default copied
  // link carries `dl=0`, which is the preview PAGE. Some links carry neither,
  // and the rewrite this replaces only ever swapped an EXISTING `dl` — so a
  // link without one passed through untouched and the parser downloaded HTML.
  if (isHost("dropbox.com")) {
    if (/^\/(scl\/fo|sh)\//i.test(path)) {
      return {
        ok: false,
        reason:
          "That is a Dropbox FOLDER link. Dropbox serves a folder as one ZIP, not a clip — ingest it as a folder, or paste the link to a single file.",
      };
    }
    if (!/^\/(scl\/fi|s)\//i.test(path)) {
      return {
        ok: false,
        reason:
          "That is a Dropbox link shape this does not know how to turn into a file. Only single-file share links (/scl/fi/… or /s/…) serve raw bytes.",
      };
    }
    const out = new URL(raw);
    // `dl` and `raw` are mutually exclusive intents; leaving both would leave
    // which one wins up to Dropbox. Delete-then-set is order-preserving, so a
    // link that already reads `…&raw=1` comes back byte-identical.
    out.searchParams.delete("dl");
    out.searchParams.set("raw", "1");
    const url = out.toString();
    return { ok: true, url, kind: "dropbox_file", changed: url !== raw, driveFileId: null, filename };
  }

  // Dropbox's own CDN host already IS the bytes.
  if (isHost("dropboxusercontent.com")) {
    return { ok: true, url: raw, kind: "direct", changed: false, driveFileId: null, filename };
  }

  // ── GOOGLE DRIVE ─────────────────────────────────────────────────────────
  if (isHost("drive.usercontent.google.com")) {
    // Drive's newer direct-download host. Already the bytes endpoint.
    if (/^\/(download|uc)\b/.test(path)) {
      return { ok: true, url: raw, kind: "drive_file", changed: false, driveFileId: driveIdFrom(raw), filename, caveat: DRIVE_CAVEAT };
    }
    return { ok: false, reason: "That Drive user-content link is not a download endpoint — open the file in Drive and copy its share link instead." };
  }

  if (isHost("drive.google.com") || isHost("docs.google.com")) {
    // Checked BEFORE the generic `/d/<id>` id grab, or a Doc would come back
    // as a "file" and the parser would download a document.
    if (/^\/(document|spreadsheets|presentation|forms)\//.test(path)) {
      return { ok: false, reason: "That is a Google Doc/Sheet/Slide, not a media file. Export it, or paste a link to a video or image in Drive." };
    }
    if (/\/folders\//.test(path)) {
      return { ok: false, reason: "That is a Drive FOLDER link, not a single file — queue it as a folder ingest, or paste the link to one clip." };
    }
    const id = driveIdFrom(raw);
    if (!id) {
      return { ok: false, reason: "That is a Drive link with no file id in it — open the file and use Share → Copy link." };
    }
    const url = `https://drive.google.com/uc?export=download&id=${id}`;
    return { ok: true, url, kind: "drive_file", changed: url !== raw, driveFileId: id, filename, caveat: DRIVE_CAVEAT };
  }

  // ── HOSTS THAT ONLY EVER SERVE A PAGE ────────────────────────────────────
  for (const p of PAGE_ONLY) {
    if (isHost(p.host)) {
      return {
        ok: false,
        reason: `That is ${p.what}, not a downloadable media file. Download the clip and upload it, or paste a direct file link.`,
      };
    }
  }

  // ── ANYTHING ELSE ────────────────────────────────────────────────────────
  // The ONLY thing that earns a pass here is a path that names a media file.
  // Supabase storage URLs, CDN links and plain https files all satisfy that;
  // a bare page does not, and guessing on its behalf is how HTML gets stored
  // as a clip.
  if (filename) {
    return { ok: true, url: raw, kind: "direct", changed: false, driveFileId: null, filename };
  }

  return {
    ok: false,
    reason: `${host} is not a share service this converts, and the path does not name a media file (…${path.slice(-40)}). Fetching it would download a web page, not a clip — upload the file, or paste a direct link ending in .mp4 / .mov / .jpg.`,
  };
}

/** The converted URL, or null. For callers that only want the happy path. */
export function fetchableMediaUrlOrNull(input: string | null | undefined): string | null {
  const r = toFetchableMediaUrl(input);
  return r.ok ? r.url : null;
}
