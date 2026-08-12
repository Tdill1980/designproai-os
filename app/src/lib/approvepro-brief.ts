/**
 * approvepro-brief — the single source of truth for "does this design order
 * actually have usable instructions?"
 *
 * WooCommerce design products attach add-on form fields whose RAW value lands
 * in metadata.line_item_brief even when the customer typed NOTHING — e.g.
 *   "Other | Please note in box below how you will provide files_2"
 * That is form scaffolding, NOT a brief. Treating it as a real brief makes the
 * agent try to DESIGN a blind order instead of inviting the customer to add
 * their details. This predicate strips the scaffolding and decides if real
 * descriptive content remains.
 *
 * Used by the row tag (computeAgentState), the GO button label, and mirrored
 * server-side in supabase/functions/_shared/approvepro-brief.ts so the agent
 * (agent-go / autogen-design / followup-sweep) decides the same way.
 */

// Remove the WooCommerce add-on field scaffolding so we can judge the remainder.
function stripScaffolding(text: string): string {
  return String(text)
    // option label prefix: "Other | ...", "Yes | ...", etc.
    .replace(/^\s*[a-z][a-z /]{0,20}\|/i, " ")
    // the two known empty-prompt fragments (consume to the next pipe or end)
    .replace(/please note in (the )?box below[^|]*/gi, " ")
    .replace(/how you will provide (the )?files[^|]*/gi, " ")
    // trailing field keys like "_2"
    .replace(/_\d+\s*$/g, " ")
    .replace(/[|]+/g, " ")
    .trim();
}

// Whole-string placeholders that never carry a brief.
const NULL_BRIEFS = new Set(["", "n/a", "na", "none", "no", "tbd", "test", "."]);

/** True only when the text contains real, customer-written design direction. */
export function briefIsMeaningful(text?: string | null): boolean {
  if (!text) return false;
  const raw = String(text).trim();
  if (NULL_BRIEFS.has(raw.toLowerCase())) return false;
  const stripped = stripScaffolding(raw);
  if (NULL_BRIEFS.has(stripped.toLowerCase())) return false;
  // Need at least 3 real words (2+ letters each) of actual content.
  const words = stripped.split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w));
  return words.length >= 3;
}

// ────────────────────────────────────────────────────────────────────────────
// CUT-CONTOUR / FILE-OUTPUT ORDERS — the customer has ALREADY supplied finished
// artwork (a print-ready preview + the vector source) and is paying ONLY for
// production-ready cut-contour file output. These are NOT creative design jobs:
// A.C.E must NEVER invent a wrap for them. Mirrored server-side in
// supabase/functions/_shared/approvepro-brief.ts so the agent and the UI agree.
// Deterministic on the WooCommerce SKU / product id (DSFO / 289 = "Design
// Setup / File Output"), with a tight cut-contour instruction-text fallback.
// ────────────────────────────────────────────────────────────────────────────
const CUT_CONTOUR_SKUS = new Set(["DSFO"]);
const CUT_CONTOUR_PRODUCT_IDS = new Set([289]);

export function isCutContourFileOutputOrder(md: any): boolean {
  if (!md) return false;
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
  const text = [md?.line_item_brief, md?.customer_note, md?.order_customer_note]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(cut[\s-]*contour|contour[\s-]*cut|cut[\s-]*lines?\s*only|print output for cut)\b/.test(text);
}

/**
 * Classify a proof's intake. `hasBrief` is TRUE when there's either a
 * meaningful typed brief OR uploaded reference art (RecreatePro recreates art
 * even with no words). `hasArt` lets callers pick recreate vs design.
 */
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
