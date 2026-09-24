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

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ THE OWNER REVERSED THE RULING ABOVE ON 2026-09-24, KNOWING WHAT IT COST.
//
// Verbatim, in order: "Its only supposed to use ai" · "we use the composit for
// outputting files" · "My design team will have dims" · "and can verify pattern
// and size is correct". Asked directly whether the deterministic composite
// should stay, she chose "Keep it, demoted", and asked for the AI render to be
// on "Everyone, auto on generate".
//
// This is a business decision, not a retraction of the analysis. The gap the
// 09-12 ruling names is REAL and still real: the model repaints the wall
// freehand and can put motifs on screen that the press will not print. What
// changed is who catches it. On 09-12 the only thing standing between that gap
// and a chargeback was the customer's own eye; now a design team reads the
// dimensions and verifies pattern and scale against the flat master before
// anything is printed. A human check that the 09-12 ruling did not have is a
// legitimate reason to move a risk, and moving it is hers to do.
//
// TWO THINGS THAT DID NOT MOVE, AND MUST NOT:
//   1. Approving, ordering and exporting are still statements about the PRINT
//      FILE, and the pane shows the print file when one of them is taken.
//
//      ⚠️ THIS BULLET USED TO READ "`canCommitFromView` is untouched ... still
//      REFUSE the AI view", and that was true for about six hours. Refusing
//      was right while the view was staff-only; on the default view it made
//      Approve eat the first press and left Buy disabled behind a tooltip that
//      was not true. Measured the same day on the owner's own account: 19
//      draft versions, 2 approvals, none in eleven days, and every production
//      job that ever ran succeeded — the file path was never broken, the
//      commit was. `viewIsPrintFile` now tells a caller to SHOW the file
//      rather than to refuse, which keeps the rule and loses the dead button.
//   2. The composite is demoted, never deleted. It is still one tab away, still
//      carries PRINT_TRUTH_BADGE, and is still what the design team and the
//      press read. "Keep it, demoted" is the whole instruction.
//
// The signature keeps its inputs although neither is read any more: the caller
// passes what it knows about the session, and a policy that stops consulting a
// fact is not a reason to make every call site relearn the policy. Re-gating
// this is a one-line change here and nowhere else — which is the point.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Whether this session may reach the AI view at all.
 *
 * Everyone, since 2026-09-24. See the block above for what that reversed and
 * what still holds it closed at the moment money changes hands.
 */
export function aiViewAvailable(_input: { staff: boolean; viewingAsCustomer: boolean }): boolean {
  return true;
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
 * Whether the pane currently shows the PRINT FILE itself.
 *
 * Approving, ordering or exporting is a statement about the print file, and
 * the AI view is not the print file — it is a painting of one. Everything else
 * on this page shows the deterministic composite, which IS the file.
 *
 * ⚠️ THIS WAS `canCommitFromView`, AND REFUSING WAS THE RIGHT SHAPE ONLY WHILE
 * THE AI VIEW WAS STAFF-ONLY (owner, 2026-09-24).
 *
 * Under the 09-12 ruling the AI view was off the customer path, so a commit
 * arriving from it meant something had gone wrong and refusing was correct.
 * The owner then made that view the DEFAULT for everyone — and refusing turned
 * into this, measured on her own account: 19 draft versions, 2 approvals, none
 * since 13 September, and three production jobs that all succeeded. The file
 * path was never broken. Approve simply ate the first press on the default
 * view and sent her to another tab to press it again, and Buy sat DISABLED
 * there behind the tooltip "Generate and save this design first" — which was
 * not true and could not be acted on.
 *
 * The rule the guard exists for is "nobody commits without seeing the real
 * file". That is preserved by SHOWING them the file as part of committing, not
 * by throwing the press away. Callers switch the pane to the print geometry
 * and then proceed, in one press.
 *
 * Renamed rather than re-pointed: a function still called `canCommitFromView`
 * that no longer decides whether you may commit is a lie the next reader has
 * to discover.
 */
export function viewIsPrintFile(view: WallViewKey): boolean {
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
 *
 * \u26a0\ufe0f AND THE WORDING HAD TO CHANGE WITH THE AUDIENCE (2026-09-24). "Marketing
 * render" named the tool by the job STAFF reached for it to do, which was right
 * while staff were the only people who could see it. Now it is the first thing
 * a customer looks at, and telling a customer her room is "marketing" is worse
 * than jargon \u2014 it reads as a stock photo of somebody else's wall.
 *
 * So it names what she is looking at, and the explainer says the one thing she
 * needs in order to act: this is the impression, the flat master is the file,
 * and the exact geometry is one tab away. Still not a warning, still not an
 * apology \u2014 a pointer at the view that carries PRINT_TRUTH_BADGE.
 */
export const AI_VIEW_BADGE = 'AI room view';
export const AI_VIEW_EXPLAINER =
  'Your design painted onto your own photo, the way it will look installed. It is an impression, so its motifs can drift a little from the file \u2014 open Print geometry for the exact print file mapped onto your wall, and that is what the press receives.';

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