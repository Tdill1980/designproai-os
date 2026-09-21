import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wallMaskGuidance, toWallItems } from '../wallpro-items';

const page = readFileSync(fileURLToPath(new URL('../../pages/WallPro.tsx', import.meta.url)), 'utf8');

/**
 * THE CUSTOMER IS ASKED TO TAP, NEVER ASKED TO WAIT.
 *
 * Owner, 2026-09-18, with a photo uploaded and the page sitting on
 * "Detecting…": "It should ask customer to mark corners and they just touch
 * corners."
 *
 * Detection is a convenience. It can be slow, it can fail, and on the live site
 * that night its request never left the browser at all -- zero calls reached
 * detect-wall-openings while the page showed a spinner. Four taps take five
 * seconds, need no network and cannot fail, so they are the instruction from
 * the moment the photo lands. Detection still runs and still wins if it
 * arrives first and the customer has not started.
 *
 * This is the owner's standing ruling applied one step earlier -- 2026-09-11,
 * after auto-masks swallowed a wall: "just have people mark it."
 */
describe('the wall corner prompt', () => {
  it('opens marking mode the moment a photo is uploaded', () => {
    expect(page).toMatch(/setMarking\('wall'\);\s*\n\s*void detectInBackground\(asset, true\);/);
  });

  it('never tells the customer to wait for detection', () => {
    // The two sentences that made a spinner the whole experience.
    expect(page).not.toContain('Working on it. You can enter the wall size now.');
    expect(page).not.toContain('Still looking for your wall in this photo.');
  });

  it('asks for the four taps wherever the corners are not set', () => {
    const asks = page.match(/Tap the four corners of your wall, clockwise from the top left/g) ?? [];
    // The busy notice and the not-found note both have to say it; one alone
    // leaves a state where the page is silent about what to do.
    expect(asks.length).toBeGreaterThanOrEqual(2);
  });

  it('never claims the whole photo is the wall', () => {
    // That sentence told the customer a wall had been chosen when detection had
    // found nothing, and the full frame is the one default that must never be
    // displayed (it paints the design across the whole room).
    expect(page).not.toContain('Using the whole photo as the wall.');
  });
});

describe('a detection landing late cannot undo the customer', () => {
  it('yields to ANY tap, not only to four valid corners', () => {
    // `handMarked` required a complete, valid quad -- so a detection landing
    // after two taps wiped them and dropped the customer back to the start.
    expect(page).toContain("const started = cornersOrigin.current === 'manual' && cornersRef.current.length > 0;");
    expect(page).toContain('const applied = !started && cornersOk;');
  });

  it('closes marking mode only when it actually placed the corners', () => {
    // Closing it on a detection that found nothing leaves no corners AND no
    // prompt, which is the state that reads as a broken page.
    expect(page).toContain('if (applied) setMarking(null);');
  });
});

/**
 * THE FOURTH TAP HANDS OVER TO THE NEXT QUESTION — AND THE QUESTION IS A TAP.
 *
 * Owner, 2026-09-18: "It doesn't let me mask it hides the tools … then ask you
 * if you want to mask … for instance living room wall family photos mounted to
 * wall." Marking the wall and protecting what is mounted on it are two steps of
 * one job, and the page used to go silent between them.
 *
 * CORRECTED 2026-09-21, same owner, on the screenshot that resulted: "No hand
 * drawing I need one touch masks object if its not coded that way then fix it
 * and make sure app is clear on what user does."
 *
 * The 09-18 fix opened the DRAWING tools on the fourth corner, which taught
 * every customer that masking means tracing polygons — and produced a wall
 * carrying three rectangles labelled "Protected 1, 2, 3" while the objects sat
 * already found and already tappable. The handover stays; what it hands over TO
 * changed. These assertions were verified to fail against the pre-fix page.
 */
describe('after the corners are set, the page asks about masking', () => {
  it('shows the overlay so a tap has something to land on', () => {
    expect(page).toContain('setShowMasks(true);');
  });

  it('does NOT open the drawing tools — one touch is the instruction', () => {
    // The pencil is reachable behind its own toggle, for the one case where
    // detection came back with nothing to tap. It is never the handover.
    expect(page).not.toMatch(/setShowMaskTools\(true\);\s*\n\s*setShowMasks\(true\)/);
  });

  it('takes its wording from the one state machine, not from a literal here', () => {
    // Two surfaces describing the same moment in their own words is exactly how
    // "use the mask tools" and "tap any labelled item" came to coexist.
    expect(page).toContain("wallMaskGuidance({ detecting, items, drawnCount: exclusions.length }).headline");
  });

  it('says what is already kept rather than asking for work already done', () => {
    const items = toWallItems([
      { label: 'curtain', box: { x0: 0, y0: 0, x1: 1, y1: 1 }, png: 'data:,', class: 'fixed' },
    ]);
    expect(wallMaskGuidance({ detecting: false, items, drawnCount: 0 }).headline).toContain('Keeping 1');
  });

  it('names real mounted things when there is nothing to tap', () => {
    // The owner's 09-18 point survives the correction: when we have found
    // nothing, the ask has to be concrete or it reads as abstract homework.
    expect(wallMaskGuidance({ detecting: false, items: [], drawnCount: 0 }).headline)
      .toMatch(/a TV, shelves, a framed photo/);
  });

  it('offers skipping as a real answer', () => {
    // Nothing here blocks Generate, and print panels stay full rectangles
    // whatever is masked, so the prompt must not read as a required step.
    expect(page).toMatch(/go straight to describing your design/);
  });

  it('labels the toggle as what it does, not as "Adjust"', () => {
    expect(page).toContain('Change what we keep');
  });
});
