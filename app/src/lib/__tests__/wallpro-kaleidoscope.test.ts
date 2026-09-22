/**
 * THE DESIGN WAS NEVER POOR. THE FALLBACK WAS.
 *
 * Owner, 2026-09-22, on a generated repeat: "Why did it make a poor design?"
 *
 * The customer path's seam decision read, in full:
 *
 *     return report.seamless ? 'verified' : 'mirror';
 *
 * So every tile the measurement did not clear became a MIRROR repeat —
 * alternate tiles flipped, a hard axis of symmetry every repeat width across
 * her wall. On abstract texture that is invisible; on the botanicals, palms
 * and line work WallPro actually generates it is the single most recognisable
 * "AI wallpaper" artefact there is. She was judging the fallback, not the
 * design.
 *
 * ── THE PART THAT MAKES THIS A LOCK AND NOT A PATCH ───────────────────────
 *
 * The BATCH path had already been fixed (`batchSeamDecision`, 2026-09-14) and
 * its own comment names the reason in as many words: mirror "is invisible on
 * abstract texture and plainly wrong on cranes, leaves or lettering". Two
 * copies of one decision, one of them corrected, and nothing asked whether
 * they agreed. There is now ONE ladder (`seamLadder`) and both call it — which
 * is the same rule RULE 0.21 states for artifacts: one producer, published
 * twice, never derived twice.
 *
 * ── WHY `verified` WAS NOT THE BUG, THOUGH IT LOOKED LIKE IT ──────────────
 *
 * A mirrored join places a column against its own copy, so there is provably
 * no seam, and `verified` is the PRINT gate ("does this tile join"). It was
 * answering its own question correctly. Setting it false for mirror would have
 * blocked every mirrored repeat from printing and broken catalog publish, to
 * fix a defect that is not about seams at all. What mirror costs is ARTWORK,
 * so the fix is the ladder plus telling her — not moving a gate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const page = source('../../pages/WallPro.tsx');
const seamless = source('../wallpro-seamless.ts');
const catalog = source('../wallpro-catalog.ts');

describe('one seam ladder, and the customer climbs it', () => {
  it('the straight-to-mirror decision is gone from the module', () => {
    // COMMENTS STRIPPED FIRST, and not as a tidiness measure: `seamLadder`'s
    // own doc quotes the deleted line verbatim so the next reader knows what
    // was removed and why, and the first draft of this assertion convicted
    // that quotation. A lock that cannot tell code from the record of code
    // forces the record to be deleted.
    const code = seamless.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain("return report.seamless ? 'verified' : 'mirror';");
    expect(code).not.toContain('export function chooseSeamlessMethod');
    expect(code).toContain('export function seamLadder');
    // ...and the record IS kept, so this stays explainable a month from now.
    expect(seamless).toContain("return report.seamless ? 'verified' : 'mirror';");
  });

  it('the batch decision delegates rather than keeping a second copy', () => {
    expect(catalog).toContain("seamLadder(before, blendedAfter, 'auto')");
    // The three hand-rolled rungs it used to carry.
    expect(catalog).not.toContain("if (before.seamless) return seamlessReceipt('auto', before, null, 'verified');");
  });

  it('the page RUNS the blend before the ladder decides, not after', () => {
    // `seamLadder` cannot prefer blend over mirror on a promise: whether the
    // crossfade closes THIS tile is a fact about these pixels. A caller that
    // skips the attempt gets mirror, correctly — so the attempt is the fix.
    expect(page).toContain('shouldTryBlend(before, seamPreference)');
    const attempt = page.indexOf('blended = blendSeamless(');
    const decide = page.indexOf('const method = seamLadder(before, after, seamPreference);');
    expect(attempt).toBeGreaterThan(-1);
    expect(decide).toBeGreaterThan(attempt);
  });

  it('never ships a rejected repair as the receipt of what printed', () => {
    // A blend that was measured and did NOT close is evidence about the blend.
    // Carrying it as `after` on a mirror receipt would report the failed
    // repair's numbers as the shipped pixels.
    expect(page).toMatch(/} else \{\n(.*\n)*?\s*after = null;/);
  });

  it('no longer imports the deleted chooser', () => {
    expect(page).not.toContain('chooseSeamlessMethod');
  });
});

describe('a mirrored wall says it is mirrored', () => {
  it('reads the METHOD, because every gate reads verified and stays quiet', () => {
    expect(page).toContain("seamReceipt?.method === 'mirror' && <div");
    expect(page).toContain('This tile is being mirrored to join.');
  });

  it('says what the customer will actually see, in her own terms', () => {
    expect(page).toContain('Every other tile is flipped');
    expect(page).toContain('visible on leaves, figures or lettering');
  });

  it('offers the blended repeat rather than naming a control that does not exist', () => {
    // `wallpro-print-export` has told customers to "Choose Mirror repeat or
    // Blended repeat" since it was written, and NOTHING on the page ever set
    // `seamPreference` — the only call was the project loader. This is the
    // first control that does.
    expect(page).toContain('Use the blended repeat anyway');
    expect(page).toMatch(/setSeamPreference\(seamPreference === 'blend' \? 'auto' : 'blend'\)/);
  });
});
