/**
 * THE MASKING TOOL STOPS BEING FINICKY (owner, Trish 2026-09-23).
 *
 * "Fix wallpro so that the one touch masking tool isn't so finicky should
 * easily allow you to adjust mask size I'm trying to cover the inside of
 * closet so that I can show the outside white wall wrapped and see the pink
 * inside to see it would match."
 *
 * Two separate defects were in the way of that, and neither was the detector:
 *
 *  1. A MASK'S SIZE COULD NOT BE CHANGED AT ALL. `rectangularWallMask` returns
 *     a plain 4-point polygon and keeps no record that it was a rectangle, and
 *     the editor's only editing tool moved ONE vertex. Dragging the corner of
 *     a box over a closet therefore sheared it into a parallelogram. There was
 *     no edge handle, no corner handle, and no way to move a mask either.
 *  2. THE HANDLES WERE THREE PIXELS WIDE. `r=".7"` on a 100-unit viewBox is
 *     0.7% of the photo's width — about 3px on a phone. That is the "finicky".
 *
 * The geometry half is locked here. The editor half (touch radius, the
 * whole-mask drag) is locked in `wallpro-mask-editor.test.ts`, which reads the
 * component source, because the pointer maths needs a DOM this suite has not.
 */
import { describe, it, expect } from 'vitest';
import {
  rectangularWallMask, isRectangularMask, resizeRectangularMask, translateMask,
  type Point,
} from '../wallpro-geometry';

/** A box over a closet door, the shape the owner was trying to adjust. */
const CLOSET = rectangularWallMask({ x: 0.55, y: 0.30 }, { x: 0.80, y: 0.75 });

describe('a rectangle resizes as a rectangle', () => {
  it('reproduces the old behaviour as the defect it was: moving one vertex shears the box', () => {
    // This is what the editor used to do, and why "adjust mask size" was
    // impossible — the result is a parallelogram, not a bigger rectangle.
    const sheared = CLOSET.map((q, j) => (j === 2 ? { x: 0.9, y: 0.9 } : q));
    expect(isRectangularMask(sheared)).toBe(false);
  });

  it('pulls the bottom-right corner and keeps a rectangle, anchored opposite', () => {
    const grown = resizeRectangularMask(CLOSET, 2, { x: 0.92, y: 0.88 })!;
    expect(isRectangularMask(grown)).toBe(true);
    // The corner diagonally opposite the one dragged does not move.
    expect(grown[0]).toEqual(CLOSET[0]);
    expect(grown[2]).toEqual({ x: 0.92, y: 0.88 });
  });

  it('works from every corner, always anchoring the opposite one', () => {
    for (const vertex of [0, 1, 2, 3]) {
      const anchor = CLOSET[(vertex + 2) % 4];
      const out = resizeRectangularMask(CLOSET, vertex, { x: 0.15, y: 0.15 });
      expect(out, `corner ${vertex}`).not.toBeNull();
      expect(isRectangularMask(out!)).toBe(true);
      expect(out!.some(q => q.x === anchor.x && q.y === anchor.y), `corner ${vertex} kept its anchor`).toBe(true);
    }
  });

  it('shrinking past nothing keeps the last good box instead of throwing at a finger', () => {
    // rectangularWallMask refuses a degenerate box; a drag must not surface
    // that as an exception mid-gesture.
    expect(resizeRectangularMask(CLOSET, 2, { x: 0.5500001, y: 0.3000001 })).toBeNull();
  });

  it('leaves a traced polygon alone — per-vertex is the right tool for that shape', () => {
    const traced: Point[] = [
      { x: 0.2, y: 0.2 }, { x: 0.6, y: 0.25 }, { x: 0.55, y: 0.7 }, { x: 0.18, y: 0.6 },
    ];
    expect(isRectangularMask(traced)).toBe(false);
    expect(resizeRectangularMask(traced, 1, { x: 0.7, y: 0.3 })).toBeNull();
  });

  it('recognises a rectangle by its points, whatever produced it', () => {
    expect(isRectangularMask(CLOSET)).toBe(true);
    expect(isRectangularMask([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toBe(true);
    expect(isRectangularMask(CLOSET.slice(0, 3))).toBe(false);
    expect(isRectangularMask([...CLOSET.slice(0, 3), { x: NaN, y: 0.5 }])).toBe(false);
  });
});

describe('a mask can be moved without changing its shape', () => {
  it('translates every point by the same delta', () => {
    const moved = translateMask(CLOSET, 0.05, -0.1);
    expect(isRectangularMask(moved)).toBe(true);
    moved.forEach((q, i) => {
      expect(q.x).toBeCloseTo(CLOSET[i].x + 0.05, 10);
      expect(q.y).toBeCloseTo(CLOSET[i].y - 0.1, 10);
    });
  });

  it('stops at the edge of the photo WITHOUT squashing the near side', () => {
    // Clamping each point independently would flatten the leading edge against
    // the border and silently change the mask's size. The delta is shortened
    // instead, so the shape that arrives is the shape that left.
    const shoved = translateMask(CLOSET, 0.9, 0);
    const width = (m: Point[]) => Math.max(...m.map(q => q.x)) - Math.min(...m.map(q => q.x));
    expect(width(shoved)).toBeCloseTo(width(CLOSET), 10);
    expect(Math.max(...shoved.map(q => q.x))).toBeCloseTo(1, 10);
  });

  it('is a no-op on a delta that is not a number', () => {
    expect(translateMask(CLOSET, NaN, 0)).toEqual(CLOSET);
  });
});
