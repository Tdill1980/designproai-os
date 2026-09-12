import { describe, expect, it } from 'vitest';
import {
  WALL_GENERATION_STALL_MS, WALL_QC_CHECKS, canHold, canRelease, currentReview,
  generationOutcome, isRecoverable, releaseState, requiredChecks,
  type WallQcReview,
} from '../wallpro-qc';

const NOW = new Date('2026-09-12T20:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const review = (over: Partial<WallQcReview>): WallQcReview => ({
  id: 'r', version_id: 'v', project_id: 'p', reviewer_id: 'u',
  verdict: 'released', checks: {}, notes: null, created_at: ago(0), ...over,
});

describe('generationOutcome — did it take', () => {
  // THE CASE THIS BOARD EXISTS FOR. The server finished and stored the artwork;
  // the customer's browser gave up before writing the version row, so the
  // design is real and invisible. It must never read as a failure.
  it('calls a completed generation with no version orphaned, and recoverable', () => {
    const outcome = generationOutcome(
      { state: 'completed', artwork_path: 'u/generated/g.png', created_at: ago(90_000) }, false, NOW);
    expect(outcome).toBe('orphaned');
    expect(isRecoverable(outcome)).toBe(true);
  });

  it('calls the same generation landed once its version exists', () => {
    const outcome = generationOutcome(
      { state: 'completed', artwork_path: 'u/generated/g.png', created_at: ago(90_000) }, true, NOW);
    expect(outcome).toBe('landed');
    expect(isRecoverable(outcome)).toBe(false);
  });

  it('does not offer recovery for anything but an orphan', () => {
    for (const outcome of ['landed', 'running', 'stalled', 'failed'] as const) {
      expect(isRecoverable(outcome)).toBe(false);
    }
  });

  it('is running inside the window and stalled past it', () => {
    expect(generationOutcome({ state: 'working', artwork_path: null, created_at: ago(60_000) }, false, NOW)).toBe('running');
    expect(generationOutcome({ state: 'working', artwork_path: null, created_at: ago(WALL_GENERATION_STALL_MS + 1) }, false, NOW)).toBe('stalled');
  });

  it('reports a recorded failure as failed whatever else is true', () => {
    expect(generationOutcome({ state: 'failed', artwork_path: null, created_at: ago(90_000) }, false, NOW)).toBe('failed');
    expect(generationOutcome({ state: 'failed', artwork_path: 'u/generated/g.png', created_at: ago(90_000) }, true, NOW)).toBe('failed');
  });

  // A completed row with no path cannot be handed to anyone: there is nothing
  // to hand over. Calling it orphaned would put a recovery button on a row the
  // RPC would refuse.
  it('treats completed-with-no-artwork as failed, not orphaned', () => {
    expect(generationOutcome({ state: 'completed', artwork_path: null, created_at: ago(90_000) }, false, NOW)).toBe('failed');
  });
});

describe('the release gate', () => {
  it('is unreviewed until somebody looks at it', () => {
    expect(releaseState([])).toBe('unreviewed');
  });

  // Append-only: the newest verdict is the live one in BOTH directions, so a
  // hold entered after a release blocks, and a re-release after a hold clears.
  it('takes the newest verdict, not the first and not the best', () => {
    const released = review({ id: 'a', verdict: 'released', created_at: ago(60_000) });
    const held = review({ id: 'b', verdict: 'hold', created_at: ago(30_000) });
    expect(releaseState([released, held])).toBe('held');
    expect(releaseState([held, released])).toBe('held');
    expect(currentReview([released, held])?.id).toBe('b');

    const rereleased = review({ id: 'c', verdict: 'released', created_at: ago(10_000) });
    expect(releaseState([released, held, rereleased])).toBe('released');
  });
});

describe('the QC checklist', () => {
  const all = Object.fromEntries(WALL_QC_CHECKS.map(([key]) => [key, true]));

  it('requires every check on a repeating design', () => {
    expect(requiredChecks('repeat')).toHaveLength(WALL_QC_CHECKS.length);
    expect(canRelease(all, 'repeat')).toBe(true);
  });

  // A mural has no tile. Demanding a tick for a thing that does not exist is
  // how a team learns to tick without looking.
  it('drops the seam check on a design that does not repeat', () => {
    expect(requiredChecks('cover')).not.toContain('seam');
    const { seam, ...withoutSeam } = all;
    expect(canRelease(withoutSeam, 'cover')).toBe(true);
    expect(canRelease(withoutSeam, 'repeat')).toBe(false);
  });

  it('refuses a release with any applicable box unticked', () => {
    expect(canRelease({ ...all, resolution: false }, 'repeat')).toBe(false);
    expect(canRelease({}, 'cover')).toBe(false);
  });

  it('refuses a hold with no usable reason', () => {
    expect(canHold('')).toBe(false);
    expect(canHold('  bad  ')).toBe(false);
    expect(canHold('Motif prints three feet across')).toBe(true);
  });
});
