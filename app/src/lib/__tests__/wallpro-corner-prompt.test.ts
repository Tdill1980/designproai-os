import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
