// Room scenes and true-scale listing mockups for the WallPro catalog (owner,
// 2026-09-14: "we need to create images where they can see pattern size on
// a typical wall room"). Pure contract helpers, no I/O; the composite itself
// is the customer page's own `renderWallPreview`, unchanged.
import { validWallCorners, validWallSize, type Point, type WallLayout } from './wallpro-geometry';
import type { WallCatalogRow } from './wallpro-catalog';

export type WallCatalogScene = {
  id: string; name: string; room: string | null; image_path: string; width_px: number; height_px: number;
  corners: Point[]; wall_width_in: number; wall_height_in: number; sort_order: number; is_active: boolean;
  created_by: string; created_at: string; updated_at: string;
};
export type WallMockup = { scene_id: string; path: string; caption: string };

/** A typical feature wall, when the curator has not measured the photograph's. */
export const DEFAULT_SCENE_WALL_IN = { width: 168, height: 108 } as const;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WallSceneDraft = {
  name: string; room?: string | null; imagePath: string; widthPx: number; heightPx: number;
  corners: Point[]; wallWidthIn: number; wallHeightIn: number; createdBy: string; sortOrder?: number;
};

/** Builds the insert row and refuses what the table would refuse, in words. */
export function sceneUpsertRow(draft: WallSceneDraft) {
  const name = draft.name.trim();
  if (!name || name.length > 80) throw new Error('Give the scene a name of 1 to 80 characters.');
  if (!/^catalog\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(draft.imagePath)) throw new Error('The scene photo must be copied into the catalog first.');
  if (!(draft.widthPx > 0 && draft.heightPx > 0)) throw new Error('The scene photo size is missing.');
  if (!validWallCorners(draft.corners)) throw new Error('Mark the four wall corners clockwise, starting at the top left.');
  if (!validWallSize(draft.wallWidthIn, draft.wallHeightIn) || draft.wallWidthIn < 12 || draft.wallHeightIn < 12) throw new Error('Enter the wall size in inches, 12 to 2,400 each way.');
  if (!uuid.test(draft.createdBy)) throw new Error('Sign in as a curator to save a scene.');
  return {
    name, room: draft.room?.trim() || null, image_path: draft.imagePath, width_px: draft.widthPx, height_px: draft.heightPx,
    corners: draft.corners.map(p => ({ x: p.x, y: p.y })), wall_width_in: draft.wallWidthIn, wall_height_in: draft.wallHeightIn,
    sort_order: draft.sortOrder ?? 0, is_active: true, created_by: draft.createdBy, updated_at: new Date().toISOString(),
  };
}

/**
 * The layout that imposes a catalog design on a scene at TRUE size: a repeat
 * prints at its own tile width on the scene's real wall inches, a mural
 * covers the wall. Identical to what the customer page builds for their own
 * photo, so the mockup shows exactly what they would get.
 */
export function sceneLayoutFor(design: Pick<WallCatalogRow, 'mode' | 'tile_width_in'>, scene: Pick<WallCatalogScene, 'wall_width_in' | 'wall_height_in'>, fallbackTileIn: number): WallLayout {
  const repeatWidth = design.mode === 'repeat' ? design.tile_width_in ?? fallbackTileIn : scene.wall_width_in;
  return { width: scene.wall_width_in, height: scene.wall_height_in, mode: design.mode === 'repeat' ? 'repeat' : 'cover', repeatWidth };
}

const feet = (inches: number) => {
  const ft = Math.floor(inches / 12), rest = Math.round(inches - ft * 12);
  return rest ? `${ft} ft ${rest} in` : `${ft} ft`;
};

/** The one sentence a listing needs beside the mockup: how big the pattern is
 * and how big the wall it is shown on is — real numbers, not "large". */
export function mockupCaption(design: Pick<WallCatalogRow, 'mode' | 'tile_width_in'>, scene: Pick<WallCatalogScene, 'wall_width_in' | 'wall_height_in'>, fallbackTileIn: number): string {
  const wall = `${feet(scene.wall_width_in)} × ${feet(scene.wall_height_in)} wall`;
  if (design.mode === 'repeat') return `${design.tile_width_in ?? fallbackTileIn}-inch repeat, shown at true size on a ${wall}`;
  return `One mural sized to a ${wall}`;
}

/** Corners of a full-frame wall — the starting point before detection or a
 * curator's own marks land, never a scene that should be saved as-is. */
export const FULL_FRAME_CORNERS: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
