import { describe, expect, it } from 'vitest';
import { aiViewAvailable, canCommitFromView, resolveWallView, AI_VIEW_BADGE, AI_VIEW_EXPLAINER, PRINT_TRUTH_BADGE, PRINT_TRUTH_LINE } from '../wallpro-ai-view';

describe('the AI view is the on-wall view, for everyone', () => {
  // ⚠️ THIS BLOCK IS AN INVERSION, AND THE ONE IT REPLACED WAS CORRECT WHEN IT
  // WAS WRITTEN. Owner, 2026-09-12: "drop the ai view from customer path" —
  // because a customer approves what they see and receives what prints.
  // Owner, 2026-09-24: "Its only supposed to use ai" / "we use the composit for
  // outputting files" / "My design team will have dims" / "and can verify
  // pattern and size is correct", and, asked directly, "Everyone, auto on
  // generate". The risk did not disappear; a human check moved in front of it.
  //
  // What makes the reversal safe is the block below, not this one: the guard
  // was deliberately put on the ACTION rather than on visibility, precisely so
  // that this day would not need it rewritten. Do not "restore" the staff gate
  // from this comment — read wallpro-ai-view.ts, which records the ruling.
  it('is available to a customer', () => {
    expect(aiViewAvailable({ staff: false, viewingAsCustomer: false })).toBe(true);
    expect(aiViewAvailable({ staff: false, viewingAsCustomer: true })).toBe(true);
  });

  it('is available to staff', () => {
    expect(aiViewAvailable({ staff: true, viewingAsCustomer: false })).toBe(true);
  });

  // View as Customer must now show the SAME pane a customer gets. Hiding the
  // render inside that toggle would make the one person checking the customer
  // path the one person who cannot see what the customer sees — the exact
  // complaint, in mirror image, that put this line here in the first place.
  it('does not disappear while staff preview the customer path', () => {
    expect(aiViewAvailable({ staff: true, viewingAsCustomer: true })).toBe(true);
  });
});

describe('losing access never strands the pane on the AI view', () => {
  it('falls back to the deterministic composite', () => {
    expect(resolveWallView('ai', false)).toBe('after');
  });

  it('leaves the AI view alone when it is available', () => {
    expect(resolveWallView('ai', true)).toBe('ai');
  });

  it('never rewrites a view that was not the AI one', () => {
    for (const view of ['before', 'design', 'after'] as const) {
      expect(resolveWallView(view, false)).toBe(view);
      expect(resolveWallView(view, true)).toBe(view);
    }
  });
});

describe('nothing is committed from a painting of the design', () => {
  // The guard sits on the ACTION, not only on who can see the view, so it
  // holds if the view is ever put back in front of customers.
  it('blocks approval and checkout from the AI view', () => {
    expect(canCommitFromView('ai')).toBe(false);
  });

  it('allows them from every view that shows the real file', () => {
    for (const view of ['before', 'design', 'after'] as const) {
      expect(canCommitFromView(view)).toBe(true);
    }
  });
});

describe('the labels sell rather than disclaim', () => {
  // Owner, 2026-09-12: "What does that even mean? What benefit is there at
  // dating artist impression? Why wouldn't anyone buy it? There is no trust
  // signal." The badge names what is on screen; it is not a warning, and it is
  // not estate-agent jargon.
  //
  // ⚠️ IT ALSO MAY NOT NAME THE AUDIENCE ANY MORE. "Marketing render" was
  // right while staff were the only people who could reach this; stamped on a
  // customer's own room it reads as somebody else's stock photo. The
  // explainer's job is now one pointer, not a disclaimer: it must say where
  // the exact file lives, because that is the action a customer can take.
  it('names what the customer is looking at, and points at the print file', () => {
    expect(AI_VIEW_BADGE).toBe('AI room view');
    expect(AI_VIEW_BADGE).not.toMatch(/impression|not your|marketing/i);
    expect(AI_VIEW_EXPLAINER).toMatch(/print geometry/i);
    expect(AI_VIEW_EXPLAINER).toMatch(/press receives|what prints|the file/i);
    // The 09-12 wording aimed at staff and told customers nothing they could
    // act on. If it comes back, this fails.
    expect(AI_VIEW_EXPLAINER).not.toMatch(/ads|case stud|social/i);
  });

  // The view customers buy from makes a POSITIVE, specific claim: it is the
  // print file, not a picture of one. That is the trust signal that was
  // missing entirely.
  it('claims the print file on the customer view, without hedging', () => {
    expect(PRINT_TRUTH_BADGE).toMatch(/exact print geometry/i);
    expect(PRINT_TRUTH_LINE).toMatch(/actual print file/i);
    expect(PRINT_TRUTH_LINE).toMatch(/what the press prints/i);
    // No weasel words: a trust signal that hedges is not one.
    expect(PRINT_TRUTH_LINE).not.toMatch(/approximate|roughly|should be|preview only|may differ/i);
  });
});

describe('the compare view is a real file view', () => {
  // Before/after is the most screenshot-and-send picture WallPro makes. It is
  // built from the deterministic composite, so it may be committed from; the
  // AI view stays the only view that cannot.
  it('allows approval and checkout from the before/after', () => {
    expect(canCommitFromView('compare')).toBe(true);
  });

  it('is never rewritten when the AI view goes away', () => {
    expect(resolveWallView('compare', false)).toBe('compare');
  });
});
