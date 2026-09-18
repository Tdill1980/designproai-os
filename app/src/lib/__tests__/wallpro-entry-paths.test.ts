/**
 * "Pick a design" may not be offered by a tool that has no designs.
 *
 * Measured 2026-09-18 in designproai-os-prod: `wallpro_designs` 0 rows,
 * `wallpro_catalog_scenes` 0 rows. The catalog read filters
 * `is_active = true AND approval_status = 'approved'`, so it could only ever
 * return nothing — and the option was a PRICED path that opened on an empty
 * grid. These cases were verified to fail against the unconditional five-entry
 * list the page carried before.
 */
import { describe, it, expect } from 'vitest';
import {
  wallEntryPaths,
  resolvedWallEntryMode,
  WALL_SELF_SERVE_PATHS,
  WALL_LIBRARY_PATH,
} from '../wallpro-entry-paths';

const modes = (n: number | null) => wallEntryPaths(n).map(p => p.mode);

describe('wallEntryPaths', () => {
  it('hides the catalog path when no design is published', () => {
    expect(modes(0)).not.toContain('library');
  });

  it('hides it while the catalog is still loading, so it can never flicker away', () => {
    expect(modes(null)).not.toContain('library');
  });

  it('offers it as soon as one design is in hand', () => {
    expect(modes(1)).toContain('library');
    expect(modes(500)).toContain('library');
  });

  it('puts the catalog first when it is offered — it is the cheapest way in', () => {
    expect(wallEntryPaths(12)[0]).toEqual(WALL_LIBRARY_PATH);
  });

  it('always keeps the four paths that need no published row', () => {
    for (const count of [null, 0, 1, 99]) {
      expect(modes(count)).toEqual(
        expect.arrayContaining(['match', 'wall', 'ai', 'upload']),
      );
    }
  });

  it('never drops a self-serve path, whatever the catalog says', () => {
    expect(wallEntryPaths(0)).toEqual([...WALL_SELF_SERVE_PATHS]);
  });

  it('returns a fresh array, so a caller cannot mutate the shared list', () => {
    const first = wallEntryPaths(0);
    first.pop();
    expect(wallEntryPaths(0)).toHaveLength(WALL_SELF_SERVE_PATHS.length);
  });

  it('gives every path a label and a hint — an unlabelled button is not a choice', () => {
    for (const path of wallEntryPaths(3)) {
      expect(path.label.length).toBeGreaterThan(0);
      expect(path.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('resolvedWallEntryMode', () => {
  it('moves a restored library project onto the prompt path when the catalog is empty', () => {
    expect(resolvedWallEntryMode('library', 0)).toBe('ai');
  });

  it('leaves library alone while the catalog is loading — the rows may yet arrive', () => {
    expect(resolvedWallEntryMode('library', null)).toBe('library');
  });

  it('leaves library alone when designs exist', () => {
    expect(resolvedWallEntryMode('library', 7)).toBe('library');
  });

  it('never rewrites a mode the catalog has no say over', () => {
    for (const mode of ['match', 'wall', 'ai', 'upload'] as const) {
      expect(resolvedWallEntryMode(mode, 0)).toBe(mode);
      expect(resolvedWallEntryMode(mode, null)).toBe(mode);
      expect(resolvedWallEntryMode(mode, 4)).toBe(mode);
    }
  });
});
