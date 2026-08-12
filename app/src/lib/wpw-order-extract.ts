/**
 * wpw-order-extract — client-side mirror of the parser used by
 * supabase/functions/approvepro-sync-wpw/index.ts (extractBriefAndUploads).
 *
 * Reads `wpw_orders.customer_note` + each line item's `meta` blob and
 * surfaces:
 *   - the customer's order-level note
 *   - the longest descriptive brief inside line-item meta
 *   - any uploaded image URLs (thumbnails)
 *   - any uploaded document URLs (PDF / AI / PSD / EPS / SVG / ZIP / DOC)
 *
 * Pure functions — no network, no Deno APIs, no side effects. Lifted
 * verbatim from the proven ApprovePro sync so the in-app order modal
 * shows exactly what the WPW shop already sees in /approvepro.
 */

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|svg)(\?|$)/i;
const DOC_EXT_RE = /\.(pdf|ai|psd|eps|svg|zip|rar|doc|docx)(\?|$)/i;
const URL_RE = /^https?:\/\/\S+$/i;

export function isImageUrl(s: string): boolean {
  if (!URL_RE.test(s)) return false;
  return IMAGE_EXT_RE.test(s);
}

export function isDocumentUrl(s: string): boolean {
  if (!URL_RE.test(s)) return false;
  return DOC_EXT_RE.test(s);
}

export function extractStringValues(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith("[") || s.startsWith("{")) {
      try {
        const parsed = JSON.parse(s);
        return extractStringValues(parsed);
      } catch {
        return [s];
      }
    }
    return [s];
  }
  if (Array.isArray(v)) return v.flatMap((x) => extractStringValues(x));
  if (typeof v === "object") {
    return Object.values(v as Record<string, unknown>).flatMap((x) => extractStringValues(x));
  }
  return [];
}

export interface BriefAndUploads {
  customerNote: string | null;
  orderNote: string | null;
  itemBrief: string | null;
  uploads: string[];
  documents: string[];
}

interface OrderLike {
  customer_note?: string | null;
}

interface ItemLike {
  meta?: unknown;
}

export function extractBriefAndUploads(
  order: OrderLike | null | undefined,
  items: ItemLike[] | null | undefined,
): BriefAndUploads {
  const uploads: string[] = [];
  const documents: string[] = [];
  let bestNote: string | null = null;
  let bestNoteLen = 0;

  let orderLevelNote: string | null = null;
  const noteSource =
    typeof order?.customer_note === "string" ? order.customer_note : null;
  if (noteSource) {
    const s = noteSource.trim();
    if (s.length > 0) orderLevelNote = s.slice(0, 2000);
  }

  for (const it of items || []) {
    const metaArr = Array.isArray(it.meta) ? it.meta : [];
    for (const m of metaArr) {
      const key = String((m as { key?: unknown; display_key?: unknown })?.key
        || (m as { display_key?: unknown })?.display_key
        || "").trim();
      const keyLower = key.toLowerCase();

      const candidates = [
        ...extractStringValues((m as { value?: unknown })?.value),
        ...extractStringValues((m as { display_value?: unknown })?.display_value),
      ];

      for (const raw of candidates) {
        const trimmed = raw.trim();
        if (!trimmed) continue;

        if (isImageUrl(trimmed)) {
          if (!uploads.includes(trimmed)) uploads.push(trimmed);
          continue;
        }

        if (isDocumentUrl(trimmed)) {
          if (!documents.includes(trimmed)) documents.push(trimmed);
          continue;
        }

        if (URL_RE.test(trimmed)) continue;
        if (/^<[a-z]/i.test(trimmed) || /<\/[a-z]+>/i.test(trimmed)) continue;
        // Strip server filesystem paths that the WP "Extra Product
        // Options" plugin stores alongside the public file URLs (e.g.
        // `/var/www/weprintwraps.com/public_html/wp-content/uploads/...`).
        // Every one of these paths in the data also has the matching
        // https URL, which is already picked up as an upload/document —
        // so skipping them here only removes noise, never real content.
        if (/^\/(?:var|home|srv|opt|usr)\//.test(trimmed)) continue;
        if (/wp-content\/uploads\//.test(trimmed) && !/^https?:\/\//i.test(trimmed)) continue;
        if (trimmed.length < 20) continue;
        if (/^\d+(\.\d+)?$/.test(trimmed)) continue;

        const keyHints =
          keyLower.includes("describe") ||
          keyLower.includes("description") ||
          keyLower.includes("project") ||
          keyLower.includes("brief") ||
          keyLower.includes("note") ||
          keyLower.includes("request") ||
          keyLower.includes("detail") ||
          keyLower.includes("info") ||
          keyLower.includes("design");

        const len = trimmed.length;
        if (keyHints && len >= 20) {
          if (len > bestNoteLen) {
            bestNote = trimmed.slice(0, 4000);
            bestNoteLen = len;
          }
        } else if (len > bestNoteLen && len >= 60) {
          bestNote = trimmed.slice(0, 4000);
          bestNoteLen = len;
        }
      }
    }
  }

  let combined: string | null = bestNote;
  if (orderLevelNote && bestNote && !bestNote.includes(orderLevelNote)) {
    combined = `${orderLevelNote}\n\n${bestNote}`.slice(0, 4000);
  } else if (orderLevelNote && !bestNote) {
    combined = orderLevelNote;
  }

  return {
    customerNote: combined,
    orderNote: orderLevelNote,
    itemBrief: bestNote,
    uploads: uploads.slice(0, 12),
    documents: documents.slice(0, 12),
  };
}

export interface ItemOption {
  label: string;
  value: string;
}

/**
 * Pulls the human-readable product OPTIONS a customer selected on a line
 * item (WooCommerce "Extra Product Options" / variations) out of its meta
 * blob — e.g. "Vehicle: Box Truck", "Material: Cast Vinyl", "Length: 24 ft".
 *
 * The order modal showed only name/SKU/qty/price, hiding the spec the shop
 * actually needs to produce the wrap. This surfaces those key/value pairs.
 *
 * Skips: internal underscore keys, file/URL values (handled as uploads),
 * server filesystem paths, HTML, and long free-text briefs (>200 chars,
 * already shown in the Customer Note section).
 */
export function extractItemOptions(meta: unknown): ItemOption[] {
  const arr = Array.isArray(meta) ? meta : [];
  const out: ItemOption[] = [];
  const seen = new Set<string>();
  for (const m of arr) {
    const label = String(
      (m as { display_key?: unknown })?.display_key ??
        (m as { key?: unknown })?.key ??
        "",
    ).trim();
    if (!label || label.startsWith("_")) continue;

    const vals = [
      ...extractStringValues((m as { display_value?: unknown })?.display_value),
      ...extractStringValues((m as { value?: unknown })?.value),
    ]
      .map((s) => s.trim())
      .filter(
        (s) =>
          s.length > 0 &&
          s.length <= 200 &&
          !URL_RE.test(s) &&
          !IMAGE_EXT_RE.test(s) &&
          !DOC_EXT_RE.test(s) &&
          !/^\/(?:var|home|srv|opt|usr)\//.test(s) &&
          !/wp-content\/uploads\//.test(s) &&
          !/^<[a-z]/i.test(s) &&
          !/<\/[a-z]+>/i.test(s),
      );
    if (vals.length === 0) continue;

    const value = Array.from(new Set(vals)).join(", ");
    const dedupeKey = `${label.toLowerCase()}::${value.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ label, value });
  }
  return out;
}

/**
 * Wraps a customer-artwork URL in our `wpw-file-download` edge function
 * so the browser ALWAYS saves the file (Content-Disposition: attachment)
 * instead of opening cross-origin PDFs / images inline. The edge
 * function strictly allowlists the host before proxying.
 */
export function downloadProxyUrl(rawUrl: string): string {
  const base = (import.meta as { env?: { VITE_SUPABASE_URL?: string } }).env?.VITE_SUPABASE_URL;
  if (!base) return rawUrl;
  return `${base.replace(/\/$/, "")}/functions/v1/wpw-file-download?u=${encodeURIComponent(rawUrl)}`;
}

export function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || url;
    return decodeURIComponent(last);
  } catch {
    const last = url.split("?")[0].split("/").filter(Boolean).pop();
    return last || url;
  }
}

/**
 * Splits free-text into segments that are either plain strings or URLs,
 * so a renderer can wrap URLs in real `<a>` tags. Customer notes from
 * Woo frequently include Dropbox / Drive / WeTransfer links that the
 * production team needs to click — these used to render as plain text.
 *
 * Conservative regex — http(s) only, no FTP/mailto/data, must end at
 * whitespace or end-of-string. Trailing punctuation (`.,;:!?)`) is
 * peeled off so the URL itself stays clean.
 */
const NOTE_URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"`]+$/;

export type NoteSegment =
  | { kind: "text"; value: string }
  | { kind: "url"; value: string };

export function segmentNoteText(text: string | null | undefined): NoteSegment[] {
  if (!text) return [];
  const segments: NoteSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(NOTE_URL_RE)) {
    const start = match.index ?? 0;
    let url = match[0];
    let trailing = "";
    const m = url.match(TRAILING_PUNCT_RE);
    if (m) {
      trailing = m[0];
      url = url.slice(0, -trailing.length);
    }
    if (start > lastIndex) {
      segments.push({ kind: "text", value: text.slice(lastIndex, start) });
    }
    segments.push({ kind: "url", value: url });
    if (trailing) segments.push({ kind: "text", value: trailing });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return segments;
}
