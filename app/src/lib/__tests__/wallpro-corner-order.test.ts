/**
 * FOUR TAPS ARE A WALL IN WHATEVER ORDER THEY ARRIVE (owner, Trish 2026-09-23).
 *
 * She was standing in front of a wall she needed to show a printer in the
 * morning: "I'm trying to wrap this wall the white wall and it won't do it."
 * Her four corners were correct. Their ORDER was not — she had tapped
 * top-left, top-right, bottom-LEFT, bottom-RIGHT, which is reading order and
 * what a person actually does, while slots 3 and 4 are bottom-right and
 * bottom-left. The quad crossed itself, `validWallCorners` returned false,
 * "Wall area: not set" never cleared, and the design could never be placed.
 *
 * The app's answer was a sentence asking her to do it again, clockwise. The
 * four points already describe exactly one convex quadrilateral; the tap order
 * carries no information the geometry needs. So the code sorts them.
 *
 * THE NUMBERS BELOW ARE HERS, off the Adjust-corner-positions panel in her own
 * screenshot, so this suite fails against the build that was live that night
 * and passes against the fix. A synthetic square could not have caught it:
 * every fixture in this repo had been written in the correct order.
 */
import { describe, it, expect } from 'vitest';
import { orderWallCorners, validWallCorners, type Point } from '../wallpro-geometry';

/** Exactly what her four fields read, as fractions. */
const HERS: Point[] = [
  { x: 0.1093, y: 0.1931 }, // 1. top left      — correct
  { x: 0.8415, y: 0.1724 }, // 2. top right     — correct
  { x: 0.1831, y: 0.6400 }, // 3. "bottom right" — actually on the LEFT
  { x: 0.6694, y: 0.6436 }, // 4. "bottom left"  — actually on the RIGHT
];

describe("the live failure, from the owner's own screenshot", () => {
  it('reproduces it: as tapped, the quad is invalid', () => {
    expect(validWallCorners(HERS)).toBe(false);
  });

  it('orders those exact points into a wall the app accepts', () => {
    const fixed = orderWallCorners(HERS);
    expect(fixed).not.toBeNull();
    expect(validWallCorners(fixed!)).toBe(true);
  });

  it('keeps her four points, moving none of them', () => {
    const fixed = orderWallCorners(HERS)!;
    const key = (p: Point) => `${p.x},${p.y}`;
    expect(new Set(fixed.map(key))).toEqual(new Set(HERS.map(key)));
  });

  it('puts them in the order every consumer expects: TL, TR, BR, BL', () => {
    const [tl, tr, br, bl] = orderWallCorners(HERS)!;
    expect(tl).toEqual({ x: 0.1093, y: 0.1931 });
    expect(tr).toEqual({ x: 0.8415, y: 0.1724 });
    expect(br).toEqual({ x: 0.6694, y: 0.6436 }); // the right-hand bottom point
    expect(bl).toEqual({ x: 0.1831, y: 0.6400 }); // the left-hand bottom point
  });
});

describe('every tap order a person can produce lands on the same wall', () => {
  const canonical: Point[] = [
    { x: 0.10, y: 0.20 }, { x: 0.84, y: 0.17 },
    { x: 0.67, y: 0.64 }, { x: 0.18, y: 0.64 },
  ];

  it('agrees across all 24 permutations', () => {
    const permute = (xs: Point[]): Point[][] =>
      xs.length <= 1 ? [xs] : xs.flatMap((x, i) =>
        permute([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [x, ...rest]));
    const orders = permute(canonical);
    expect(orders).toHaveLength(24);
    for (const order of orders) {
      const fixed = orderWallCorners(order);
      expect(fixed, `order ${JSON.stringify(order)} produced no wall`).not.toBeNull();
      expect(validWallCorners(fixed!)).toBe(true);
      // Not merely valid — the SAME wall, whichever way it was tapped.
      expect(fixed).toEqual(canonical);
    }
  });

  it('leaves an already-correct set exactly as it was', () => {
    expect(orderWallCorners(canonical)).toEqual(canonical);
  });
});

describe('it refuses rather than inventing a wall', () => {
  it('returns null when one point sits inside the other three', () => {
    // No ordering makes this convex, so there is no wall to find. Guessing one
    // would place the design on a shape the customer never marked.
    expect(orderWallCorners([
      { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }, { x: 0.5, y: 0.3 },
    ])).toBeNull();
  });

  it('returns null for a sliver with no real area', () => {
    expect(orderWallCorners([
      { x: 0.10, y: 0.50 }, { x: 0.90, y: 0.50 },
      { x: 0.90, y: 0.501 }, { x: 0.10, y: 0.501 },
    ])).toBeNull();
  });

  it('returns null on the wrong count or a non-finite value', () => {
    expect(orderWallCorners([{ x: 0.1, y: 0.1 }])).toBeNull();
    expect(orderWallCorners([
      { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: NaN, y: 0.9 },
    ])).toBeNull();
  });
});
