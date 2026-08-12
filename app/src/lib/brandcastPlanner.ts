/**
 * brandcastPlanner — deterministic scene planning for BrandCast, the
 * upload-first AI video editor + multi-channel content creator.
 *
 * Turns the clips a user just uploaded from an install (videos + photos) into
 * a renderable scene list with ZERO AI: real cuts from real footage. Pure
 * functions so tests/brandcast-planner.test.ts can lock the behavior.
 *
 * Editorial shape:
 *   scene 1  = HOOK frame (first video, big overlay text)
 *   middle   = proof / b-roll segments, uploaded photos interleaved as
 *              2s pattern-interrupt stills
 *   last     = PAYOFF (pulled from late in the final clip — the reveal)
 *
 * The AI layers (captions, music match, moment-scored Story Edit) ride on top
 * of this plan; they never decide the cut here.
 */

export interface FastClip {
  /** Public storage URL of the uploaded file. */
  url: string;
  /** Real duration in seconds (browser-probed). 0 = probe failed. */
  duration: number;
  kind: "video" | "image";
  id?: string;
  name?: string;
}

export interface PlannedScene {
  sceneId: string;
  clipId: string;
  clipUrl: string;
  start: number;
  end: number;
  purpose: "hook" | "pattern_interrupt" | "proof" | "payoff" | "b_roll" | "reveal";
  text?: string;
  textPosition?: "top" | "center" | "bottom";
}

export interface PlanOpts {
  /** Seconds of finished video to aim for. */
  targetDuration: number;
  maxScenes: number;
  /** Burned onto scene 1 as the hook frame. */
  hookText?: string;
  /** Seconds each uploaded photo holds on screen (default 2). */
  stillDuration?: number;
  /** Per-video segment length clamp (reel pacing 2.5–6s; long-form 8–20s). */
  minSeg?: number;
  maxSeg?: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Plan a cut from uploaded clips. Deterministic: same inputs → same scenes.
 */
export function planFastCutScenes(clips: FastClip[], opts: PlanOpts): PlannedScene[] {
  const videos = clips.filter((c) => c.kind === "video");
  const images = clips.filter((c) => c.kind === "image");
  if (!videos.length && !images.length) return [];

  const still = opts.stillDuration ?? 2;
  const minSeg = opts.minSeg ?? 2.5;
  const maxSeg = opts.maxSeg ?? 6;

  // Photos eat part of the budget; the rest is split across the videos.
  const stillBudget = Math.min(images.length * still, opts.targetDuration * 0.35);
  const videoBudget = Math.max(opts.targetDuration - stillBudget, opts.targetDuration * 0.5);
  const seg = clamp(videoBudget / Math.max(videos.length, 1), minSeg, maxSeg);

  // Per-video segments. Skip the shaky first moments; long clips contribute a
  // second, late segment (where reveals live).
  type Seg = { clip: FastClip; start: number; end: number };
  const vsegs: Seg[] = [];
  for (const v of videos) {
    const dur = v.duration > 0.8 ? v.duration : seg + 1.5; // probe-fail fallback
    const lead = Math.min(1.5, dur * 0.1);
    const len = Math.min(seg, Math.max(1.2, dur - lead));
    vsegs.push({ clip: v, start: round1(lead), end: round1(lead + len) });
    if (dur > lead + len * 2.5) {
      const late = dur * 0.65;
      vsegs.push({ clip: v, start: round1(late), end: round1(Math.min(dur, late + len)) });
    }
  }

  // Interleave photos evenly AFTER the hook segment.
  const merged: Array<Seg | { image: FastClip }> = [...vsegs];
  if (images.length) {
    const stride = Math.max(1, Math.ceil((vsegs.length + 1) / (images.length + 1)));
    images.forEach((img, i) => {
      const at = Math.min(merged.length, (i + 1) * stride + i);
      merged.splice(Math.max(1, at), 0, { image: img });
    });
  }

  // Assemble scenes until the target duration (with 10% headroom) or the
  // scene cap is hit — but never drop the planned payoff entirely.
  const scenes: PlannedScene[] = [];
  let total = 0;
  for (const item of merged) {
    if (scenes.length >= opts.maxScenes) break;
    if (total >= opts.targetDuration * 1.1 && scenes.length >= 2) break;
    const i = scenes.length;
    if ("image" in item) {
      scenes.push({
        sceneId: `fc_still_${i}`,
        clipId: item.image.id || item.image.url,
        clipUrl: item.image.url,
        start: 0,
        end: still,
        purpose: "pattern_interrupt",
      });
      total += still;
    } else {
      scenes.push({
        sceneId: `fc_scene_${i}`,
        clipId: item.clip.id || item.clip.url,
        clipUrl: item.clip.url,
        start: item.start,
        end: item.end,
        purpose: i === 0 ? "hook" : i % 2 ? "proof" : "b_roll",
        ...(i === 0 && opts.hookText
          ? { text: opts.hookText, textPosition: "top" as const }
          : {}),
      });
      total += item.end - item.start;
    }
  }

  if (scenes.length > 1) scenes[scenes.length - 1].purpose = "payoff";
  return scenes;
}

/**
 * A parsed moment (transcript speech beat or vision-scored money shot) from
 * content_moments, resolved to a playable clip URL.
 */
export interface ParsedMoment {
  clipUrl: string;
  sourceId: string;
  start: number;
  end: number;
  hookScore: number;
  quote?: string;
}

/**
 * EDITING-CRAFT LAYER — the rules a real editor never breaks, enforced in
 * CODE so no AI can violate them (learned the hard way on the first Ghost
 * Industries cut: mid-sentence chops, slow-mo'd dialogue, fake act breaks).
 *
 * mergeMomentsIntoBeats: Whisper emits FRAGMENTS, not lines. Merge adjacent
 * same-source fragments into sentence-complete BEATS (ends on . ! ? or a
 * real pause), so a beat is always a whole spoken thought. The AI may only
 * pick and order beats — a beat is used WHOLE or not at all.
 */
export function mergeMomentsIntoBeats(moments: ParsedMoment[]): ParsedMoment[] {
  const bySource = new Map<string, ParsedMoment[]>();
  for (const m of moments) {
    const list = bySource.get(m.sourceId) || [];
    list.push(m);
    bySource.set(m.sourceId, list);
  }
  const beats: ParsedMoment[] = [];
  for (const list of bySource.values()) {
    list.sort((a, b) => a.start - b.start);
    let cur: ParsedMoment | null = null;
    for (const m of list) {
      const terminal = /[.!?]["')\]]?\s*$/.test((cur?.quote || "").trim());
      if (cur && !terminal && m.start - cur.end < 0.6 && cur.end - cur.start < 18) {
        cur.end = Math.max(cur.end, m.end);
        cur.quote = [cur.quote, m.quote].filter(Boolean).join(" ");
        cur.hookScore = Math.max(cur.hookScore, m.hookScore);
      } else {
        if (cur) beats.push(cur);
        cur = { ...m };
      }
    }
    if (cur) beats.push(cur);
  }
  return beats;
}

/**
 * dedupeTakes: promo/interview shoots repeat the same line many times. Group
 * near-identical quotes (word-overlap similarity) and keep ONE take — prefer
 * the later, longer delivery (later takes are usually the keeper).
 */
export function dedupeTakes(beats: ParsedMoment[]): ParsedMoment[] {
  const words = (q?: string) =>
    new Set(String(q || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2));
  const similar = (a?: string, b?: string) => {
    const wa = words(a), wb = words(b);
    if (wa.size < 3 || wb.size < 3) return false;
    let hit = 0;
    for (const w of wa) if (wb.has(w)) hit++;
    return hit / Math.min(wa.size, wb.size) > 0.65;
  };
  const kept: ParsedMoment[] = [];
  for (const b of beats) {
    const dupIdx = kept.findIndex((k) => similar(k.quote, b.quote));
    if (dupIdx === -1) { kept.push(b); continue; }
    const k = kept[dupIdx];
    const better =
      (b.end - b.start) >= (k.end - k.start) * 0.8 && b.start >= k.start ? b
      : (b.end - b.start) > (k.end - k.start) ? b : k;
    kept[dupIdx] = better;
  }
  return kept;
}

/**
 * enforceSpeechCraft: after ANY AI edit decision, force the craft rules —
 * a beat with speech is used at its exact full bounds, never speed-ramped,
 * never faded over. Visual-only beats keep their freedom.
 */
export function enforceSpeechCraft<T extends { start: number; end: number; speed?: number; fadeIn?: boolean }>(
  scene: T, beat: ParsedMoment,
): T {
  if (!beat.quote?.trim()) return scene;
  return { ...scene, start: beat.start, end: beat.end, speed: undefined, fadeIn: undefined };
}

/**
 * Story Edit — cut the session's parsed moments into a dead-air-free
 * narrative: the top-scored moment opens as the hook, the rest play in
 * chronological order (the story), photos interleave, and everything between
 * moments (silence, fumbling, dead air) is excluded by construction.
 */
export function planStoryEditScenes(
  moments: ParsedMoment[],
  images: FastClip[],
  opts: PlanOpts,
): PlannedScene[] {
  if (!moments.length) return [];
  const pad = 0.3; // breathing room around each beat
  const best = [...moments].sort((a, b) => b.hookScore - a.hookScore)[0];
  const rest = moments
    .filter((m) => m !== best)
    .sort((a, b) => (a.sourceId === b.sourceId ? a.start - b.start : a.sourceId < b.sourceId ? -1 : 1));

  // Merge adjacent beats from the same source when the gap is tiny — a
  // sub-second gap is a breath, not dead air.
  const mergedRest: ParsedMoment[] = [];
  for (const m of rest) {
    const prev = mergedRest[mergedRest.length - 1];
    if (prev && prev.sourceId === m.sourceId && m.start - prev.end < 0.75) {
      prev.end = Math.max(prev.end, m.end);
    } else {
      mergedRest.push({ ...m });
    }
  }

  const ordered = [best, ...mergedRest];
  const still = opts.stillDuration ?? 2;
  const scenes: PlannedScene[] = [];
  let total = 0;
  const stride = images.length ? Math.max(2, Math.ceil(ordered.length / (images.length + 1))) : 0;
  let imgIdx = 0;

  for (let i = 0; i < ordered.length; i++) {
    if (scenes.length >= opts.maxScenes) break;
    if (total >= opts.targetDuration * 1.1 && scenes.length >= 2) break;
    const m = ordered[i];
    const start = round1(Math.max(0, m.start - pad));
    const end = round1(m.end + pad);
    scenes.push({
      sceneId: `se_scene_${i}`,
      clipId: m.sourceId,
      clipUrl: m.clipUrl,
      start,
      end,
      purpose: i === 0 ? "hook" : "proof",
      ...(i === 0 && opts.hookText ? { text: opts.hookText, textPosition: "top" as const } : {}),
    });
    total += end - start;
    if (stride && imgIdx < images.length && (i + 1) % stride === 0 && scenes.length < opts.maxScenes) {
      const img = images[imgIdx++];
      scenes.push({
        sceneId: `se_still_${i}`,
        clipId: img.id || img.url,
        clipUrl: img.url,
        start: 0,
        end: still,
        purpose: "pattern_interrupt",
      });
      total += still;
    }
  }

  if (scenes.length > 1) scenes[scenes.length - 1].purpose = "payoff";
  return scenes;
}
