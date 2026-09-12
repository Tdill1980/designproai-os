// WallPro's occlusion policy (owner, 2026-09-12: "an exercise bike parked in
// front -- remove. Window -- place around it. Use common sense... should have
// no effect [on] geometry, we still mark points of corners.").
//
// Detection already tells us what is on or in front of the wall
// (detect-wall-openings) and now classifies each item fixed vs movable. This
// module is the one place that turns that classification into what the
// covering actually does with it:
//
//   fixed   -- an installer could never move it (a window, a mounted TV, a
//              mirror, built-in shelving, an architectural niche or mantel).
//              PROTECTED: excluded from paint, restored pixel-for-pixel by
//              the deterministic recomposite in render-wall-view. Guaranteed.
//   movable -- freestanding furniture or equipment that would be carried out
//              of the room before the wrap goes up (a chair, a bed, exercise
//              equipment). DISREGARDED: never protected, and for the AI photo-
//              realistic view, explicitly told to erase it and paint the
//              covering through as if the room had already been cleared.
//              Best effort -- a generative removal is not a deterministic
//              guarantee the way protection is.
//
// This never touches wall corners, the homography, or any other geometry: it
// operates purely on the separate exclusion/mask layer those already feed.
import type { DetectedMask } from './wallpro-masks';

export function splitDetectedMasks(masks: DetectedMask[]): { fixed: DetectedMask[]; movable: DetectedMask[] } {
  const fixed: DetectedMask[] = [], movable: DetectedMask[] = [];
  for (const mask of masks) (mask.class === 'movable' ? movable : fixed).push(mask);
  return { fixed, movable };
}
