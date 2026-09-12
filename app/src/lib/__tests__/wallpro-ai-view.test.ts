import { describe, expect, it } from 'vitest';
import { aiViewAvailable, canCommitFromView, resolveWallView, AI_VIEW_BADGE } from '../wallpro-ai-view';

describe('the AI view is off the customer path', () => {
  // Owner, 2026-09-12: "drop the ai view from customer path". A customer
  // approves what they see; the AI view is a freehand repaint, not the file.
  it('is never available to a customer', () => {
    expect(aiViewAvailable({ staff: false, viewingAsCustomer: false })).toBe(false);
    expect(aiViewAvailable({ staff: false, viewingAsCustomer: true })).toBe(false);
  });

  it('is available to staff', () => {
    expect(aiViewAvailable({ staff: true, viewingAsCustomer: false })).toBe(true);
  });

  // The whole point of View as Customer is that it shows what the customer
  // gets. Leaving a staff-only view visible inside it defeats the toggle.
  it('disappears while staff are previewing the customer path', () => {
    expect(aiViewAvailable({ staff: true, viewingAsCustomer: true })).toBe(false);
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

describe('the badge says what it is', () => {
  it('names it an impression and denies it is the print file', () => {
    expect(AI_VIEW_BADGE).toMatch(/impression/i);
    expect(AI_VIEW_BADGE).toMatch(/not your print file/i);
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
