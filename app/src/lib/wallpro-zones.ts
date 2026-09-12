// Wrap two areas of ONE photo (owner, 2026-09-12: "iterate a 2nd pass to wrap
// fireplace in a diff design... you can get two in same photo upload, it's
// fair"). A living room is rarely one flat rectangle: the main wall takes a
// mural and the fireplace surround takes brick, each its own design, each its
// own print files, each its own purchase.
//
// A zone is deliberately NOT a new data model. It is another wallpro_projects
// row that carries the SAME wallPath and points at its group with
// `parentProjectId` -- so every existing system keeps working untouched:
// versions, approval, production panels and entitlements all key on
// project_id/version_id and neither knows nor cares that two projects share a
// photograph. Two zones is therefore two purchases through the price ladder
// that already exists ("additional wall, same system"), with no new SKU, no
// migration, and no second pipeline.
import type { Placement, Point } from './wallpro-geometry';

export type WallProjectRow = { id: string; name: string; config: any; updated_at?: string };
export type WallZone = {
  projectId: string;
  name: string;
  /** null on the main wall; the customer's own words on an accent zone. */
  zoneLabel: string | null;
  isAccent: boolean;
  wallPath: string | null;
  artworkPath: string | null;
  corners: Point[];
  width: number;
  height: number;
  placement: Placement;
  repeatWidth: number;
  patternScale: number;
};

/** A fireplace surround, a chimney breast or a niche is a fraction of the wall
 * it sits in. Inheriting the main wall's inches is the one mistake that
 * silently ruins the print (brick at a third scale), so an accent zone starts
 * at its own modest default and the page asks for the real measurement. */
export const ACCENT_DEFAULT_WIDTH_IN = 60;
export const ACCENT_DEFAULT_HEIGHT_IN = 48;

export const isAccentZone = (config: any): boolean =>
  typeof config?.parentProjectId === 'string' && config.parentProjectId.length > 0;

/** The id every zone of one photo hangs off: the main wall's own project id. */
export function zoneGroupId(projectId: string, config: any): string {
  return isAccentZone(config) ? String(config.parentProjectId) : projectId;
}

function toZone(row: WallProjectRow): WallZone {
  const c = row.config || {};
  return {
    projectId: row.id,
    name: row.name || 'Wall design',
    zoneLabel: typeof c.zoneLabel === 'string' && c.zoneLabel.trim() ? c.zoneLabel.trim().slice(0, 40) : null,
    isAccent: isAccentZone(c),
    wallPath: typeof c.wallPath === 'string' ? c.wallPath : null,
    artworkPath: typeof c.artworkPath === 'string' ? c.artworkPath : null,
    corners: Array.isArray(c.corners) ? c.corners : [],
    width: Number(c.width) || 120,
    height: Number(c.height) || 96,
    placement: (['cover', 'contain', 'repeat'] as const).includes(c.placement) ? c.placement : 'cover',
    repeatWidth: Number(c.repeatWidth) || 24,
    patternScale: Number(c.patternScale) || 100,
  };
}

/**
 * Every zone sharing the current project's group, main wall first. The current
 * project is included even when it has not been saved yet, so the switcher
 * shows the zone you are standing in from the moment it exists.
 */
export function zonesInGroup(rows: WallProjectRow[], projectId: string, config: any): WallZone[] {
  const group = zoneGroupId(projectId, config);
  const zones = rows
    .filter(row => row.id === group || zoneGroupId(row.id, row.config || {}) === group)
    .map(toZone);
  if (!zones.some(z => z.projectId === projectId)) zones.push(toZone({ id: projectId, name: 'This zone', config }));
  // The main wall anchors the group; accent zones follow in creation order.
  return zones.sort((a, b) => Number(a.isAccent) - Number(b.isAccent));
}

/** Zones OTHER than the one open, that actually have artwork to draw. Only
 * these can appear in the combined on-photo preview. */
export function otherZonesWithArtwork(zones: WallZone[], projectId: string): WallZone[] {
  return zones.filter(z => z.projectId !== projectId && z.artworkPath && z.corners.length === 4);
}

/**
 * The starting config for a new accent zone on the same photograph.
 *
 * It keeps the photo and nothing else that would mislead: no artwork, no
 * version history, no design id, and -- critically -- no masks. The main
 * wall's detection correctly protects the fireplace as fixed architecture,
 * and carrying that into the zone whose whole purpose is to wrap the
 * fireplace would protect the thing the customer is trying to cover.
 */
export function accentZoneConfig(parentConfig: any, groupId: string, zoneLabel: string): Record<string, unknown> {
  return {
    wallPath: typeof parentConfig?.wallPath === 'string' ? parentConfig.wallPath : null,
    parentProjectId: groupId,
    zoneLabel: zoneLabel.trim().slice(0, 40) || 'Accent zone',
    artworkPath: null,
    referencePath: null,
    currentVersionId: null,
    designId: null,
    corners: [],
    exclusions: [],
    maskPath: null,
    removeMaskPath: null,
    width: ACCENT_DEFAULT_WIDTH_IN,
    height: ACCENT_DEFAULT_HEIGHT_IN,
    placement: 'cover',
    repeatWidth: 24,
    patternScale: 100,
    prompt: '',
    designMode: 'ai',
  };
}
