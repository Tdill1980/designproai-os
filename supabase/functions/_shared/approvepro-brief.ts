/**
 * approvepro-brief (shared, Deno) — server-side mirror of
 * src/lib/approvepro-brief.ts. Single source of truth for "does this design
 * order actually have RELEVANT design instructions?"
 *
 * WooCommerce design products dump add-on form scaffolding into
 * metadata.line_item_brief even when the customer typed nothing — e.g.
 *   "Other | Please note in box below how you will provide files_2"
 * That is NOT a brief. The agent must NOT design a blind order off it; instead
 * it (a) auto-searches the design inbox for the customer's email, and only if
 * still nothing (b) sends the request-instructions portal invite.
 *
 * Keep this logic identical to the frontend copy.
 */

function stripScaffolding(text: string): string {
  return String(text)
    .replace(/^\s*[a-z][a-z /]{0,20}\|/i, " ")
    .replace(/please note in (the )?box below[^|]*/gi, " ")
    .replace(/how you will provide (the )?files[^|]*/gi, " ")
    .replace(/_\d+\s*$/g, " ")
    .replace(/[|]+/g, " ")
    .trim();
}

const NULL_BRIEFS = new Set(["", "n/a", "na", "none", "no", "tbd", "test", "."]);

export function briefIsMeaningful(text?: string | null): boolean {
  if (!text) return false;
  const raw = String(text).trim();
  if (NULL_BRIEFS.has(raw.toLowerCase())) return false;
  const stripped = stripScaffolding(raw);
  if (NULL_BRIEFS.has(stripped.toLowerCase())) return false;
  const words = stripped.split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w));
  return words.length >= 3;
}

// Does the customer's brief REFERENCE a reference image / attachment / files
// they intended to provide (but may not have uploaded)? When true and nothing
// was actually attached, ApprovePro auto-asks for it via the portal email so the
// design isn't built off a reference the customer never sent. Kept deliberately
// specific — it must catch "copy the attached reference image", "design I found
// online", "I'll email the logo/files" without firing on every "I want a design".
export function briefExpectsAttachment(text?: string | null): boolean {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return /(see\s+attach|attached|attachment|reference\s+(image|photo|file|pic|design)|copy\s+(the\s+|this\s+|exact\s+)?(attached\s+|reference\s+)?(image|photo|file|design|logo)|replicate\s+(the\s+|this\s+|a\s+)?(attached\s+|reference\s+|design)|design\s+i\s+found|(i(['’]?ll| will| am going to)?\s*(send|email|provide|upload|forward|share)\s+(you\s+)?(the\s+|my\s+)?(files?|images?|photos?|logos?|artwork|reference|design|pics?))|files?\s+to\s+follow)/.test(t);
}

// ────────────────────────────────────────────────────────────────────────────
// CUT-CONTOUR / FILE-OUTPUT ORDERS — the customer has ALREADY supplied finished
// artwork (a print-ready preview + the vector source) and is paying ONLY for
// production-ready cut-contour file output. These are NOT creative design jobs:
// A.C.E must NEVER invent a wrap for them. Running the creative artboard pipeline
// produces "AI slop" painted over the customer's real art — e.g. order #35165
// (SKU DSFO, "print output for cut contour lines only") turned a green FLYMYRIDE
// detailing wrap into an invented blue-wave van + a black-lightning artboard.
//
// Detection is deterministic on the WooCommerce SKU / product id (DSFO / 289 =
// "Design Setup / File Output"), with a tight instruction-text fallback for the
// cut-contour phrasing so legacy rows without product_id are still caught.
// ────────────────────────────────────────────────────────────────────────────
const CUT_CONTOUR_SKUS = new Set(["DSFO"]);
const CUT_CONTOUR_PRODUCT_IDS = new Set([289]);

export function isCutContourFileOutputOrder(md: any): boolean {
  if (!md) return false;
  // Deterministic: WooCommerce SKU / product id on the line items.
  const items = Array.isArray(md?.line_items) ? md.line_items : [];
  if (
    items.some(
      (li: any) =>
        CUT_CONTOUR_PRODUCT_IDS.has(Number(li?.product_id)) ||
        CUT_CONTOUR_SKUS.has(String(li?.sku || "").toUpperCase()),
    )
  ) {
    return true;
  }
  // Fallback: the customer's instructions explicitly say cut-contour / cut-line
  // output. Kept tight so a creative order that merely mentions "print" is safe.
  const text = [md?.line_item_brief, md?.customer_note, md?.order_customer_note]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(cut[\s-]*contour|contour[\s-]*cut|cut[\s-]*lines?\s*only|print output for cut)\b/.test(text);
}

export function classifyIntake(md: any): { hasBrief: boolean; hasArt: boolean; meaningfulText: boolean } {
  // Use ALL the customer's text — line-item brief, checkout order note, and any
  // merged customer note. Any one with real content counts.
  const meaningfulText =
    briefIsMeaningful(md?.line_item_brief) ||
    briefIsMeaningful(md?.customer_note) ||
    briefIsMeaningful(md?.order_customer_note);
  const hasArt = Array.isArray(md?.customer_uploads) && md.customer_uploads.length > 0;
  return { hasBrief: meaningfulText || hasArt, hasArt, meaningfulText };
}
