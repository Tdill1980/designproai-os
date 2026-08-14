/**
 * Layer 2 (Text & Logo) handoff — DesignPro entry → RevisionStudio.
 *
 * The two-box entry page collects the editable text/logo layer separately from
 * the background. The background goes through the (locked) render pipeline; the
 * Layer 2 data rides alongside in sessionStorage keyed by the DesignIQ
 * generation id (the same id RevisionStudio receives as `?id=`). RevisionStudio
 * consumes it once to seed auto-placed, editable logo/text objects, then clears
 * it so it never re-seeds over the user's edits.
 *
 * sessionStorage (not the DB) keeps this off the deep generation save path —
 * it's a same-session create→edit handoff, and once seeded the objects persist
 * normally via admin_notes.logo_layers.
 */

export interface Layer2HandoffLogo {
  /** Storage/public URL of the uploaded logo image. */
  url: string;
  /** Display label (slot name or filename). */
  name?: string;
}

export interface Layer2Handoff {
  /** Typed Layer 2 brief (company name / phone / website / tagline). */
  textPrompt?: string;
  /** Uploaded logo/QR/icon images. */
  logos?: Layer2HandoffLogo[];
}

const KEY_PREFIX = "designpro_layer2_handoff_";

export function setLayer2Handoff(generationId: string, data: Layer2Handoff): void {
  if (!generationId) return;
  const hasContent = (data.logos && data.logos.length > 0) || (data.textPrompt && data.textPrompt.trim());
  if (!hasContent) return;
  try {
    sessionStorage.setItem(KEY_PREFIX + generationId, JSON.stringify(data));
  } catch {
    /* sessionStorage unavailable — non-fatal */
  }
}

export function getLayer2Handoff(generationId: string): Layer2Handoff | null {
  if (!generationId) return null;
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + generationId);
    return raw ? (JSON.parse(raw) as Layer2Handoff) : null;
  } catch {
    return null;
  }
}

export function clearLayer2Handoff(generationId: string): void {
  if (!generationId) return;
  try {
    sessionStorage.removeItem(KEY_PREFIX + generationId);
  } catch {
    /* ignore */
  }
}

/**
 * Split a typed Layer-2 brief into individual pieces, one per non-empty line.
 * Each line becomes its own editable object. A line that looks like a phone,
 * URL, or @handle is treated as plain "text"; the rest are "logo" lockups so
 * the AI gives the company name a proper styled treatment.
 */
export interface Layer2Piece {
  id: string;
  kind: "logo" | "text";
  text: string;
  role?: string;
}

export function parseTextBriefToPieces(brief: string): Layer2Piece[] {
  const lines = brief
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 6);

  return lines.map((line, i) => {
    const isPhone = /^[\d().+\-\s]{7,}$/.test(line);
    const isUrl = /\.(com|net|org|io|co|biz)\b|^https?:\/\/|^www\./i.test(line);
    const isSocial = /^@/.test(line) || /instagram|facebook|tiktok|@/i.test(line);
    const plain = isPhone || isUrl || isSocial;
    return {
      id: `txt_${i}`,
      kind: plain ? "text" : (i === 0 ? "logo" : "text"),
      text: line,
      role: i === 0 ? "company name" : isPhone ? "phone" : isUrl ? "website" : isSocial ? "social" : "tagline",
    } as Layer2Piece;
  });
}
