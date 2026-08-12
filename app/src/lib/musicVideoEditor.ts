/**
 * musicVideoEditor — the editor that cuts to a SONG.
 *
 * Owner, 2026-08-06: "there needs to be the music video editor and the new
 * editor intelligence editor" — "two separate editors" — "context should be
 * music video editor think mtv edit install videos for fast" — "to match
 * audio."
 *
 * TWO editorial brains, not one with a mode switch. The intelligence editor
 * cuts a STORY: it has dialogue to protect, and `enforceSpeechCraft` in
 * `brandcastPlanner.ts` exists because chopping mid-sentence and speed-ramping
 * a line made the first live cut unusable. This one cuts a SONG. Its material
 * is install footage — squeegee work, panel lays, heat gun, seams, the peel,
 * then the finished vehicle — which is silent or shop noise, so the track
 * carries the whole piece and there is no speech to defend. That is the clean
 * split: it protects speech, this has none, and neither one should learn the
 * other's rules.
 *
 * ── WHAT WAS ACTUALLY WRONG ────────────────────────────────────────────────
 * `planFastCutScenes` is described as the music-driven cut and has never seen
 * a waveform. Its shot length is `videoBudget / videos.length` clamped — the
 * target duration divided by the clip count. The track is downloaded and mixed
 * in a separate later stage of the render worker, long after the picture is
 * cut and concatenated. So the cuts land where the arithmetic puts them and
 * any relationship to the song is coincidence, which is why a music cut can
 * feel wrong while every clip in it is good.
 *
 * ── "MATCH AUDIO" IS TWO REQUIREMENTS, AND THE SECOND IS THE HARD ONE ──────
 *
 * LEVEL 1 — the CUT lands on the beat. Necessary, and not sufficient.
 *
 * LEVEL 2 — the ACTION inside the shot lands on the accent. A squeegee stroke,
 * a panel snapping down, a heat-gun pass, the peel: each has a moment of
 * impact, and a montage only feels cut to the song when that impact hits the
 * beat. An impact half a beat off the hit is the "technically on the beat,
 * still feels wrong" failure — invisible in review, obvious to watch. So a
 * shot's in-point is NOT "clip start + lead": it is worked BACKWARDS from the
 * accent, `in = peak − accentOffset`, so the peak arrives on the hit.
 *
 * ── THE SHAPE OF AN INSTALL CUT ────────────────────────────────────────────
 * An install video has an arc that is not a story arc: process, process,
 * process, then the finished vehicle. So the pacing is
 *
 *      establish → accelerate through the process work →
 *      hardest cutting into the drop → THE REVEAL LANDS ON THE DROP AND HOLDS
 *
 * The hold is the point. A montage that keeps cutting at the same rate through
 * the reveal throws away the only moment the piece was building to; the
 * release after a run of fast cuts is what makes a reveal read.
 *
 * ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────
 *
 * IT WILL NOT PRETEND TO HAVE FOUND THE BEAT. Below `MIN_GRID_CONFIDENCE` it
 * falls back to the existing arithmetic cut and SAYS SO in `fallback` and
 * `notes`, which the caller and the UI can surface. Cutting a montage to a
 * pulse that is not in the song is worse than not cutting to it at all,
 * because nobody can diagnose it — they just don't like the video.
 *
 * IT WILL NOT PRETEND TO HAVE MATCHED THE ACTION. A clip with no usable motion
 * signal gets its shot boundary on the beat and `alignment: "boundary"`, never
 * a guessed peak. "We matched the action" and "we matched only the cut" stay
 * distinguishable afterwards instead of assumed.
 *
 * IT WILL NOT GUESS WHICH SHOT IS THE REVEAL. It reads the Asset Library's
 * `content_type` — `src/lib/assetContentType.ts` is the ONE classifier and
 * duplicating its rules here would drift — and `vehicle_only` is the finished
 * vehicle. No such clip, no reveal: `revealSceneId` is null and a note says so.
 *
 * IT WILL NOT CUT BELOW THE FLASH-FRAME FLOOR. See the constant.
 *
 * Pure: no database, no network, no clock, no AI, no randomness. Same input
 * gives the same cut, byte for byte. Locked by
 * `tests/music-video-editor.test.ts`.
 */

import { planFastCutScenes, type FastClip, type PlannedScene, type PlanOpts } from "./brandcastPlanner";
import type { AssetContentType } from "./assetContentType";

// ── Constants that are decisions, not magic numbers ─────────────────────────

/**
 * The shortest shot this editor will ever emit: 0.4 s, twelve frames at 30 fps.
 *
 * Three reasons that agree on the same number:
 *
 * 1. It is ONE BEAT at 150 BPM, the top of the range where we cut single-beat
 *    shots. Anything shorter is not a fast edit, it is a cut landing INSIDE a
 *    beat — which reads as a strobe, not as rhythm, because there is no
 *    musical event under it.
 * 2. Install footage is texture, not composition: gloved hands, a squeegee on
 *    black vinyl, a seam, a heat gun. Consecutive shots look alike, so the eye
 *    gets no free orientation from contrast and needs roughly a quarter to a
 *    third of a second just to work out what it is looking at. Under that the
 *    viewer registers "something moved" and nothing else, which is exactly the
 *    unreadable-fast-cut failure this floor exists to prevent — "fast" is the
 *    point of an MTV install cut, and this is what stops fast becoming mush.
 * 3. The renderer normalises every segment to 30 fps and re-encodes at CRF 20;
 *    a shot under about twelve frames spends most of its length on its own
 *    keyframe and looks soft next to its neighbours.
 */
export const FLASH_FRAME_FLOOR_SECONDS = 0.4;

/**
 * Below this grid confidence we do not cut to the beat at all.
 *
 * Calibrated against `beatGrid.analyzePcm` on synthetic signals, not chosen by
 * feel — measured confidences were: click tracks at 90/120/128/150 BPM all
 * 1.00; a spoken voice 0.21; white noise 0.00; a sustained ambient pad 0.00;
 * silence 0.00. 0.5 sits in the empty middle of that range, so an ambient bed
 * or a voiceover accidentally attached as "music" falls back instead of
 * driving a cut.
 */
export const MIN_GRID_CONFIDENCE = 0.5;

/**
 * How long the reveal holds: 8 beats, two bars. The release after a run of
 * one-beat cuts is what makes the finished vehicle read as the payoff; cutting
 * away from it on the next beat spends the whole build for nothing.
 */
export const REVEAL_HOLD_BEATS = 8;

/**
 * Where inside a shot its action peak is aimed. A quarter in — so the eye
 * lands, then the impact arrives. On short shots (one or two beats) the
 * nearest beat to that point IS the shot's own start, so the impact falls on
 * the cut, which is the classic hit.
 */
export const ACCENT_TARGET_FRACTION = 0.25;

/**
 * How close the action peak must land to its accent to be called matched:
 * 60 ms, under two frames at 30 fps. Past that the alignment is a claim we
 * cannot back, and the shot is reported as boundary-aligned instead.
 */
export const ACTION_ALIGN_TOLERANCE_SECONDS = 0.06;

/** Below this normalised per-beat energy, a passage is an intro, not a verse. */
const LOW_ENERGY = 0.45;

/**
 * With no detected drop, where the build is assumed to peak: 65% of the way
 * through. Stated so it is arguable — it is a shape, not a measurement, and it
 * only ever applies when the analyser honestly found no drop.
 */
const ASSUMED_BUILD_FRACTION = 0.65;

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * The beat grid, exactly as `worker/video-renderer/beatGrid.js` `analyzePcm`
 * returns it. The two shapes are pinned together by the test — a silent
 * divergence would mean the analyser and the editor disagreed about what a
 * beat is.
 */
export interface BeatGrid {
  bpm: number;
  /** 0..1. Load-bearing: below MIN_GRID_CONFIDENCE this editor stands down. */
  confidence: number;
  beats: number[];
  downbeats: number[];
  phrases: number[];
  energy: Array<{ t: number; v: number }>;
  sections: Array<{ t: number; kind: string; strength: number }>;
  dropTime: number | null;
  vocalEntry: number | null;
  beatsPerBar: number;
  barsPerPhrase: number;
  onsetCount: number;
  duration: number;
  reason: string;
}

/** A moment of peak motion in a clip, from `beatGrid.motionActionPeaks`. */
export interface ActionPeak {
  /** Seconds into the source clip. */
  t: number;
  /** 0..1 relative to that clip's strongest motion. */
  strength: number;
}

export interface MusicClip extends FastClip {
  /**
   * The Asset Library's verdict (`agent_media_assets.content_type`).
   * `vehicle_only` is the finished-vehicle reveal; `install` is process work.
   * Read, never re-derived — `assetContentType.ts` is the ONE classifier.
   */
  contentType?: AssetContentType | string | null;
  /** Absent = no motion signal for this clip. Not "no motion" — unknown. */
  actionPeaks?: ActionPeak[];
}

export interface MusicScene extends PlannedScene {
  /** Position on the OUTPUT timeline. Contiguous: outStart[n] === outEnd[n-1]. */
  outStart: number;
  outEnd: number;
  /** Index into `grid.beats` where this shot begins. */
  beatIndex: number;
  /** Shot length in beats. */
  beats: number;
  onDownbeat: boolean;
  onPhrase: boolean;
  /** "action" = the shot's motion peak lands on its accent (level 2).
   *  "boundary" = only the cut is on the beat (level 1). Never assumed. */
  alignment: "action" | "boundary";
  /** Why, when alignment is "boundary". */
  alignmentReason?: string;
  /** Source-clip time of the peak that was aimed at the accent. */
  actionPeak?: number;
  /** Output time of the accent it was aimed at. */
  accentTime?: number;
}

export interface MusicCutOpts extends PlanOpts {
  /** Seconds into the track where the cut begins; snapped to a phrase. */
  musicStart?: number;
}

export interface MusicVideoCut {
  scenes: MusicScene[];
  /** False whenever the cut is arithmetic rather than beat-driven. */
  beatMatched: boolean;
  fallback: "none" | "no_clips" | "no_grid" | "low_confidence";
  bpm: number;
  confidence: number;
  /** Track time that output t=0 corresponds to — feed the renderer's musicStart. */
  musicStart: number;
  /** null = no clip could be identified as the finished-vehicle reveal. */
  revealSceneId: string | null;
  /** How many shots reached level 2 (action matched), out of scenes.length. */
  actionMatched: number;
  /** Human-readable, surfaceable. Every honest gap says so here. */
  notes: string[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Cut a music video. Deterministic: same clips + same grid → same scenes.
 */
export function planMusicVideoScenes(
  clips: MusicClip[],
  grid: BeatGrid | null | undefined,
  opts: MusicCutOpts,
): MusicVideoCut {
  const usable = (clips || []).filter((c) => c && c.url && (c.kind === "image" || c.duration > 0.8));
  if (!usable.length) {
    return {
      scenes: [], beatMatched: false, fallback: "no_clips", bpm: grid?.bpm ?? 0,
      confidence: grid?.confidence ?? 0, musicStart: opts.musicStart ?? 0,
      revealSceneId: null, actionMatched: 0,
      notes: ["No usable clips — nothing to cut."],
    };
  }

  if (!grid || !Array.isArray(grid.beats) || grid.beats.length < 8) {
    return arithmeticFallback(usable, opts, "no_grid", grid, [
      grid?.reason
        ? `No beat grid: ${grid.reason}. Cut by arithmetic — the cuts are NOT on the beat.`
        : "No beat grid was supplied. Cut by arithmetic — the cuts are NOT on the beat.",
    ]);
  }
  if (!(grid.confidence >= MIN_GRID_CONFIDENCE)) {
    return arithmeticFallback(usable, opts, "low_confidence", grid, [
      `Beat confidence ${grid.confidence} is under ${MIN_GRID_CONFIDENCE} (${grid.reason}). ` +
      "Cut by arithmetic rather than to a pulse we cannot hear — the cuts are NOT on the beat.",
    ]);
  }

  return beatDrivenCut(usable, grid, opts);
}

// ── The beat-driven cut ─────────────────────────────────────────────────────

function beatDrivenCut(clips: MusicClip[], grid: BeatGrid, opts: MusicCutOpts): MusicVideoCut {
  const notes: string[] = [];
  const beats = grid.beats;
  const downbeatSet = new Set(grid.downbeats);
  const phraseSet = new Set(grid.phrases);
  const beatsPerBar = grid.beatsPerBar || 4;

  // ── the anchor: output t=0 lands on a PHRASE, never mid-bar ──────────────
  // Starting a montage on beat 3 of a bar reads as an accident even when every
  // later cut is perfect, because the ear hears the downbeat arrive late.
  const musicStart = Math.max(0, opts.musicStart ?? 0);
  let anchorIdx = beats.findIndex((t) => t >= musicStart && phraseSet.has(t));
  if (anchorIdx < 0) anchorIdx = beats.findIndex((t) => t >= musicStart && downbeatSet.has(t));
  if (anchorIdx < 0) anchorIdx = beats.findIndex((t) => t >= musicStart);
  if (anchorIdx < 0) anchorIdx = 0;
  const anchorTime = beats[anchorIdx];

  // The drop, as a beat index. beatGrid only ever reports a drop that sits on
  // a phrase boundary, so the reveal is phrase-aligned by construction.
  let dropIdx: number | null = null;
  if (grid.dropTime !== null && grid.dropTime > anchorTime) {
    const i = nearestBeatIndex(beats, grid.dropTime);
    if (i > anchorIdx) dropIdx = i;
  }

  const boundaries = planBoundaries(grid, anchorIdx, dropIdx, opts);
  if (boundaries.length < 2) {
    return arithmeticFallback(clips, opts, "no_grid", grid, [
      "The grid is too short to lay a cut on — fell back to arithmetic.",
    ]);
  }

  // ── clip pools ───────────────────────────────────────────────────────────
  // The reveal is the finished vehicle, and the ONLY honest signal for that is
  // the library's own classification.
  const revealPool = clips.filter((c) => c.contentType === "vehicle_only");
  const processPool = clips.filter((c) => c.contentType !== "vehicle_only");
  const pool = processPool.length ? processPool : clips;
  if (!revealPool.length) {
    notes.push(
      "No clip is classified `vehicle_only`, so no reveal shot could be identified — " +
      "the shot on the drop is process footage and the last shot is the payoff by position only.",
    );
  }

  const dropBoundary = dropIdx !== null ? boundaries.indexOf(dropIdx) : -1;
  const useCount = new Map<string, number>();
  const usedPeaks = new Map<string, Set<number>>();
  let poolCursor = 0;
  let revealCursor = 0;

  const scenes: MusicScene[] = [];
  let revealSceneId: string | null = null;
  let actionMatched = 0;
  let shortClipNote = false;

  for (let s = 0; s < boundaries.length - 1; s++) {
    const startIdx = boundaries[s];
    const endIdx = boundaries[s + 1];
    const outStart = round3(beats[startIdx] - anchorTime);
    const outEnd = round3(beats[endIdx] - anchorTime);
    const shotDur = round3(outEnd - outStart);
    const isRevealShot = s === dropBoundary && revealPool.length > 0;
    // Past the drop we stay on the finished vehicle when there is more of it:
    // that section IS the payoff, and cutting back to squeegee work undoes it.
    const preferReveal = revealPool.length > 0 && dropBoundary >= 0 && s >= dropBoundary;

    let clip: MusicClip;
    if (isRevealShot) {
      clip = revealPool[0];
    } else if (preferReveal) {
      const picked = pickClip(revealPool, revealCursor, shotDur);
      revealCursor = picked.cursor + 1;
      clip = picked.clip;
    } else {
      const picked = pickClip(pool, poolCursor, shotDur);
      poolCursor = picked.cursor + 1;
      clip = picked.clip;
    }

    const clipKey = clip.id || clip.url;
    const useIndex = useCount.get(clipKey) || 0;
    useCount.set(clipKey, useIndex + 1);

    // The accent this shot's action is aimed at: the beat nearest a quarter of
    // the way in. On a one- or two-beat shot that resolves to the shot's own
    // start, so the impact lands on the cut.
    const accentIdx = nearestBeatIndexInRange(beats, outStart + anchorTime + ACCENT_TARGET_FRACTION * shotDur, startIdx, endIdx - 1);
    const accentOffset = round3(beats[accentIdx] - beats[startIdx]);

    const inPoint = chooseInPoint(clip, shotDur, accentOffset, usedPeaks, useIndex);
    if (inPoint.alignment === "action") actionMatched++;
    if (inPoint.tooShort) shortClipNote = true;

    const isImage = clip.kind === "image";
    const purpose: PlannedScene["purpose"] = isImage
      ? "pattern_interrupt"
      : isRevealShot ? "reveal"
      : s === 0 ? "hook"
      : s % 2 ? "proof" : "b_roll";

    const scene: MusicScene = {
      sceneId: `mv_${s}`,
      clipId: clipKey,
      clipUrl: clip.url,
      start: isImage ? 0 : inPoint.start,
      end: isImage ? shotDur : round3(inPoint.start + shotDur),
      purpose,
      outStart,
      outEnd,
      beatIndex: startIdx,
      beats: endIdx - startIdx,
      onDownbeat: downbeatSet.has(beats[startIdx]),
      onPhrase: phraseSet.has(beats[startIdx]),
      alignment: isImage ? "boundary" : inPoint.alignment,
      ...(isImage
        ? { alignmentReason: "still image — no action to match" }
        : inPoint.alignment === "boundary"
          ? { alignmentReason: inPoint.reason }
          : { actionPeak: inPoint.peak, accentTime: round3(outStart + accentOffset) }),
      ...(s === 0 && opts.hookText ? { text: opts.hookText, textPosition: "top" as const } : {}),
    };
    if (isRevealShot) revealSceneId = scene.sceneId;
    scenes.push(scene);
  }

  if (scenes.length > 1) {
    const last = scenes[scenes.length - 1];
    // The reveal IS the payoff — do not relabel it into a generic one.
    if (last.purpose !== "reveal") last.purpose = "payoff";
  }

  const unmatched = scenes.filter((s) => s.alignment === "boundary" && s.purpose !== "pattern_interrupt").length;
  if (unmatched) {
    notes.push(
      `${scenes.length - unmatched} of ${scenes.length} shots are matched to their action peak; ` +
      `${unmatched} had no usable motion signal and are aligned at the cut only.`,
    );
  }
  if (dropIdx === null) {
    notes.push(
      "No drop was detected in the track, so the build peaks at an assumed " +
      `${Math.round(ASSUMED_BUILD_FRACTION * 100)}% through rather than on a measured energy change.`,
    );
  }
  if (shortClipNote) {
    notes.push("At least one clip is shorter than the slot it fills; its shot was placed at the clip start.");
  }

  return {
    scenes,
    beatMatched: true,
    fallback: "none",
    bpm: grid.bpm,
    confidence: grid.confidence,
    musicStart: round3(anchorTime),
    revealSceneId,
    actionMatched,
    notes,
  };
}

// ── Where the cuts go ───────────────────────────────────────────────────────

/**
 * The cut points, as indices into `grid.beats`. Pure integer work, which is
 * what makes the floor and the drop-alignment provable rather than emergent.
 *
 * The rate follows the arc, not a flat number: hold to establish, halve into
 * the process work, single beats into the drop, then the reveal holds.
 */
function planBoundaries(
  grid: BeatGrid,
  anchorIdx: number,
  dropIdx: number | null,
  opts: MusicCutOpts,
): number[] {
  const beats = grid.beats;
  const beatsPerBar = grid.beatsPerBar || 4;
  const downbeatSet = new Set(grid.downbeats);
  const anchorTime = beats[anchorIdx];
  const target = Math.max(2, opts.targetDuration || 20);
  const maxScenes = Math.max(1, opts.maxScenes || 24);

  const out: number[] = [anchorIdx];
  let i = anchorIdx;

  while (out.length <= maxScenes) {
    const outTime = beats[i] - anchorTime;
    if (outTime >= target) break;

    const phase = dropIdx !== null && dropIdx > anchorIdx
      ? (i - anchorIdx) / (dropIdx - anchorIdx)
      : outTime / (target * ASSUMED_BUILD_FRACTION);

    let b = i === dropIdx ? REVEAL_HOLD_BEATS : beatsForShot(phase, energyAt(grid, beats[i]));

    // A shot of a bar or more starts and ends on a bar line. Holding for five
    // beats puts the next cut on beat two, which sounds like a stumble.
    if (b >= beatsPerBar) {
      let snapped = b;
      while (snapped < b + beatsPerBar && i + snapped < beats.length && !downbeatSet.has(beats[i + snapped])) snapped++;
      if (i + snapped < beats.length) b = snapped;
    }

    // The floor, enforced in beats so the cut stays on the grid while obeying
    // it. Lengthening is the only legal repair — a sub-floor shot is not an
    // edit, and shortening the NEXT one just moves the problem.
    while (i + b < beats.length && beats[i + b] - beats[i] < FLASH_FRAME_FLOOR_SECONDS) b++;

    let next = i + b;
    // Never cut across the drop: the reveal has to land ON it.
    if (dropIdx !== null && i < dropIdx && next > dropIdx) next = dropIdx;
    if (next >= beats.length) break;
    if (next <= i) break;

    out.push(next);
    i = next;
  }

  // Final floor sweep. `next = dropIdx` above can shorten one shot below the
  // floor; when it does, the fix is to absorb it into its neighbour rather
  // than to move the drop, because the drop is the one fixed point in the cut.
  for (let k = 1; k < out.length; k++) {
    if (beats[out[k]] - beats[out[k - 1]] >= FLASH_FRAME_FLOOR_SECONDS) continue;
    // Drop the boundary that is NOT the drop.
    if (dropIdx !== null && out[k] === dropIdx) out.splice(k - 1, 1);
    else out.splice(k, 1);
    k--;
  }
  return out;
}

/** Shot length in beats for a point in the arc. */
function beatsForShot(phase: number, energy: number): number {
  if (phase >= 1) return 2;                              // after the reveal
  if (phase < 0.25) return energy < LOW_ENERGY ? 8 : 4;  // establish
  if (phase < 0.6) return 2;                             // accelerate
  return 1;                                              // hardest into the drop
}

function energyAt(grid: BeatGrid, t: number): number {
  const e = grid.energy;
  if (!e || !e.length) return 1;
  let best = e[0];
  for (const p of e) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best.v;
}

// ── Where the shot starts inside its clip ───────────────────────────────────

interface InPoint {
  start: number;
  alignment: "action" | "boundary";
  reason?: string;
  peak?: number;
  tooShort?: boolean;
}

/**
 * LEVEL 2. Work backwards from the accent: `in = peak − accentOffset` puts the
 * clip's moment of impact on the beat it was assigned to.
 *
 * A peak is only usable if the whole shot fits around it inside the clip. When
 * none does — or when the clip has no motion signal at all — this returns a
 * plain lead-in and says WHY, so the caller can tell a matched shot from an
 * unmatched one instead of assuming.
 */
function chooseInPoint(
  clip: MusicClip,
  shotDur: number,
  accentOffset: number,
  usedPeaks: Map<string, Set<number>>,
  useIndex: number,
): InPoint {
  const key = clip.id || clip.url;
  const maxStart = round3(Math.max(0, clip.duration - shotDur));
  const tooShort = clip.kind === "video" && clip.duration > 0 && clip.duration < shotDur;

  const peaks = (clip.actionPeaks || []).filter(
    (p) => p && Number.isFinite(p.t) && p.t - accentOffset >= -1e-6 && p.t - accentOffset <= maxStart + 1e-6,
  );
  if (!peaks.length) {
    const lead = Math.min(1.5, Math.max(0, clip.duration) * 0.1);
    return {
      // Successive uses of the same clip walk forward, or a montage that
      // reuses a clip shows the identical frames twice and reads as a mistake.
      start: round3(clamp(lead + useIndex * shotDur, 0, maxStart)),
      alignment: "boundary",
      reason: (clip.actionPeaks || []).length
        ? "no action peak leaves room for the full shot inside this clip"
        : "no motion signal for this clip — action peak unknown, not assumed",
      tooShort,
    };
  }

  // Strongest first, earliest to break ties: deterministic, no randomness.
  const ordered = [...peaks].sort((a, b) => b.strength - a.strength || a.t - b.t);
  const used = usedPeaks.get(key) || new Set<number>();
  const pick = ordered.find((p) => !used.has(p.t)) || ordered[0];
  used.add(pick.t);
  usedPeaks.set(key, used);

  const start = round3(clamp(pick.t - accentOffset, 0, maxStart));
  // Clamping can pull the peak off its accent. If it did, say so rather than
  // reporting an alignment we did not achieve.
  if (Math.abs(start + accentOffset - pick.t) > ACTION_ALIGN_TOLERANCE_SECONDS) {
    return { start, alignment: "boundary", reason: "action peak falls outside the clip once the shot is fitted", tooShort };
  }
  return { start, alignment: "action", peak: round3(pick.t), tooShort };
}

/** First clip from `pool` at/after `cursor` that can fill a `shotDur` slot. */
function pickClip(pool: MusicClip[], cursor: number, shotDur: number): { clip: MusicClip; cursor: number } {
  const n = pool.length;
  for (let k = 0; k < n; k++) {
    const idx = (cursor + k) % n;
    const c = pool[idx];
    if (c.kind === "image" || c.duration >= shotDur) return { clip: c, cursor: idx };
  }
  return { clip: pool[cursor % n], cursor: cursor % n };
}

// ── Honest fallback ─────────────────────────────────────────────────────────

/**
 * The existing arithmetic cut, laid onto a contiguous output timeline and
 * FLAGGED. Not a silent degradation: `beatMatched:false` plus a note saying
 * the cuts are not on the beat, because "we could not find the beat" has to be
 * visible to whoever is looking at the result.
 */
function arithmeticFallback(
  clips: MusicClip[],
  opts: MusicCutOpts,
  fallback: MusicVideoCut["fallback"],
  grid: BeatGrid | null | undefined,
  notes: string[],
): MusicVideoCut {
  const planned = planFastCutScenes(clips as FastClip[], opts);
  let cursor = 0;
  const scenes: MusicScene[] = planned.map((s, i) => {
    const dur = round3(s.end - s.start);
    const outStart = round3(cursor);
    cursor = round3(cursor + dur);
    return {
      ...s,
      outStart,
      outEnd: round3(cursor),
      beatIndex: -1,
      beats: 0,
      onDownbeat: false,
      onPhrase: false,
      alignment: "boundary",
      alignmentReason: "no beat grid — cut by arithmetic",
    };
  });
  return {
    scenes,
    beatMatched: false,
    fallback,
    bpm: grid?.bpm ?? 0,
    confidence: grid?.confidence ?? 0,
    musicStart: opts.musicStart ?? 0,
    revealSceneId: null,
    actionMatched: 0,
    notes,
  };
}

// ── Small helpers ───────────────────────────────────────────────────────────

function nearestBeatIndex(beats: number[], t: number): number {
  let best = 0;
  for (let i = 1; i < beats.length; i++) {
    if (Math.abs(beats[i] - t) < Math.abs(beats[best] - t)) best = i;
  }
  return best;
}

function nearestBeatIndexInRange(beats: number[], t: number, lo: number, hi: number): number {
  let best = lo;
  for (let i = lo; i <= hi && i < beats.length; i++) {
    if (Math.abs(beats[i] - t) < Math.abs(beats[best] - t)) best = i;
  }
  return best;
}
