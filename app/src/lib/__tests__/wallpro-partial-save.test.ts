import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ⚠️ READ RAW, AND DELIBERATELY SO.
 *
 * The first draft of this file stripped block comments before matching, the
 * way sibling locks do, so that prose describing a defect could not satisfy a
 * grep for it. On THIS file that stripper silently deleted working code:
 * WallPro.tsx carries 157 block-comment openers against 156 closers, because
 * one opener lives inside a string literal. A non-greedy strip therefore pairs
 * them off by one and swallows whole spans -- including, measured, the very
 * line this file exists to assert. The test failed while the fix was present
 * and correct.
 *
 * (Writing that sequence out literally here closed THIS comment early and
 * broke the file's parse on the next run. The same character pair, twice, in
 * ten minutes.)
 *
 * That is the same shape as the slice boundary that silently widened when its
 * anchor was deleted. Every string asserted below is code-shaped and appears
 * in no comment in that file, so raw matching is both safe and honest here.
 */
const code = readFileSync(fileURLToPath(new URL('../../pages/WallPro.tsx', import.meta.url)), 'utf8');

/**
 * A SLIDER TOOK AWAY THE DESIGN SHE WAS MATCHING (owner's own project,
 * 2026-09-24, read off production):
 *
 *   patternScale 150 · repeatWidth 108 · referencePath NULL
 *
 * `saveWallProject` upserts one jsonb column, so it REPLACES `config`; it does
 * not merge. Every save that rebuilt its object from React state therefore
 * erased whatever state was not loaded at that instant, and the incidental
 * saves are precisely the ones that fire while something else is still null.
 *
 * The cost is not cosmetic. A `match` project with no `referencePath` cannot
 * be regenerated at all -- `generate` refuses with "Upload the design to match
 * first." Resizing a pattern deleted the design.
 */
describe('a partial save cannot delete the rest of the project', () => {
  it('sends the whole page through one save door', () => {
    // Exactly one direct call survives: the one inside saveProject itself.
    expect((code.match(/saveWallProject\(projectId/g) ?? []).length).toBe(1);
    expect(code).toContain('async function saveProject(owner: string, title: string, patch: Record<string, unknown>)');
  });

  it('merges the patch onto what the project already has', () => {
    expect(code).toContain('const merged = { ...(savedConfig.current ?? liveConfig()), ...patch };');
  });

  it('records what it wrote, so the next patch builds on it', () => {
    expect(code).toContain('savedConfig.current = merged;');
  });

  // THE CASE THAT ACTUALLY BIT. A reopened project fills its state over
  // several async hops; a save landing during them must start from the server's
  // config, not from the half-loaded page.
  it('seeds the baseline from the stored config when a project is reopened', () => {
    expect(code).toContain('savedConfig.current = { ...config };');
  });

  // The regression itself, named: the slider may write only what it owns.
  it('lets the pattern slider write three fields and nothing else', () => {
    expect(code).toContain('saveProject(user.id, name, { placement: next.placement, repeatWidth: next.repeatWidthIn, patternScale: pct })');
    expect(code).not.toMatch(/patternScale: pct, seamPreference/);
  });
});
