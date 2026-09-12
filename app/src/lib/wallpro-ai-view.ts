// Who may see the AI view, and what may never be decided from it.
//
// Owner, 2026-09-12, looking at a generated design beside its on-photo picture:
// "Something else disturbing the design it generated and design on photo appear
// to be different that should never be the case." Then: "Do all 3 and drop the
// ai view from customer path."
//
// She is right, and the cause is not a bug that can be prompted away.
//
// WallPro has two ways of putting a design on a room photo, and only one of
// them is the design:
//
//   "On your wall"    renderWallPreview -- the print file, pixel-mapped through
//                     the four marked corners. It CANNOT differ from what
//                     prints, because it is what prints.
//   "Show me with AI" render-wall-view -- the image model is handed the room
//                     photo and the flat master and asked to paint the covering
//                     onto the wall. Its prompt says "do not change the
//                     design's colours or motifs", but that is a REQUEST, not a
//                     constraint: the model redraws the wall freehand and can
//                     only paint something it judges to look like the master.
//                     Different blooms, different spacing, different leaves.
//
// The two sat side by side as peer buttons with nothing saying which was true,
// and the generative one is the prettier of the two. A customer approves what
// they see and receives what prints; that gap is a chargeback, not a nit.
//
// So the AI view leaves the customer path. It stays as an internal tool for
// marketing renders, where a beautiful impression is exactly the point, and it
// is hidden the moment a staff member switches to View as Customer -- otherwise
// the person checking the customer path is the one person who cannot see it.
//
// Pure: no React, no Supabase, so the policy is testable without a browser.

/**
 * Whether this session may reach the AI view at all.
 *
 * Staff only, and never while a staff member is deliberately previewing the
 * customer path — the whole value of that toggle is that it shows what the
 * customer actually gets.
 */
export function aiViewAvailable(input: { staff: boolean; viewingAsCustomer: boolean }): boolean {
  return input.staff && !input.viewingAsCustomer;
}

export type WallViewKey = 'before' | 'design' | 'after' | 'ai' | 'compare';

/**
 * The view to fall back to when the AI view is not available to this session.
 *
 * A staff member who is on the AI view and flips to View as Customer must not
 * be left staring at a picture the customer can never see, so the pane returns
 * to the deterministic composite.
 */
export function resolveWallView(view: WallViewKey, aiAvailable: boolean): WallViewKey {
  return view === 'ai' && !aiAvailable ? 'after' : view;
}

/**
 * Whether a decision that commits money or artwork may be taken from this view.
 *
 * Never from the AI view. Approving, ordering or exporting is a statement about
 * the print file, and the AI view is not the print file — it is a painting of
 * one. This is the guard that survives even if the view is ever put back in
 * front of customers.
 */
export function canCommitFromView(view: WallViewKey): boolean {
  return view !== 'ai';
}

/**
 * WHAT THE STAFF BADGE SAYS, AND WHY IT IS NOT A WARNING.
 *
 * It first read "Artist's impression - not your print file". Owner, 2026-09-12:
 * "What does that even mean? What benefit is there at dating artist impression?
 * Why wouldn't anyone buy it? There is no trust signal."
 *
 * Right twice. "Artist's impression" is estate-agent jargon, and the whole
 * label is a NEGATIVE - it says what the picture is not. That is customer-grade
 * defensive wording stamped on a view customers can no longer reach, while the
 * view they DO buy from carried no positive claim at all.
 *
 * So this names the tool by its job. Staff reach for it to make a render for an
 * ad or a case study; that is what it says.
 */
export const AI_VIEW_BADGE = 'Marketing render';
export const AI_VIEW_EXPLAINER =
  'For ads, case studies and social. The image model repaints the wall freehand, so its motifs will not match the file that prints \u2014 fine here, never fine in front of a customer. Customers only ever see the exact print geometry.';

/**
 * THE TRUST SIGNAL ON THE VIEW CUSTOMERS ACTUALLY BUY FROM.
 *
 * The deterministic composite is not "a preview" and must not be sold as one.
 * It is the print file itself, mapped onto the customer's own wall through the
 * corners they marked - so what they approve is, pixel for pixel, what the
 * press receives. Almost nothing in this market can say that, and WallPro was
 * saying nothing at all.
 *
 * Specific and checkable, never a reassuring adjective: on screen the claim is
 * followed by the panel count, the roll width and the resolution that the same
 * geometry produced.
 */
export const PRINT_TRUTH_BADGE = 'Exact print geometry';
export const PRINT_TRUTH_LINE =
  'This is your actual print file on your wall \u2014 not a simulation of it. What you approve is what the press prints.';