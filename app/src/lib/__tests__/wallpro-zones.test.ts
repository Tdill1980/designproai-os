import { describe, expect, it } from 'vitest';
import { accentZoneConfig, isAccentZone, otherZonesWithArtwork, zoneGroupId, zonesInGroup, ACCENT_DEFAULT_WIDTH_IN, type WallProjectRow } from '../wallpro-zones';

const MAIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const wallPath = 'owner/uploads/11111111-1111-4111-8111-111111111111.jpg';
const corners = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }];

const rows: WallProjectRow[] = [
  { id: MAIN, name: 'Living room mural', config: { wallPath, artworkPath: 'owner/generated/a.png', corners, width: 142, height: 96 } },
  { id: ACCENT, name: 'Fireplace brick', config: { wallPath, parentProjectId: MAIN, zoneLabel: 'Fireplace', artworkPath: 'owner/generated/b.png', corners, width: 60, height: 48 } },
  { id: OTHER, name: 'A different room', config: { wallPath: 'owner/uploads/22222222-2222-4222-8222-222222222222.jpg', corners } },
];

describe('WallPro zones — two wraps on one photo', () => {
  it('recognises an accent zone only when it points at a parent', () => {
    expect(isAccentZone({ parentProjectId: MAIN })).toBe(true);
    expect(isAccentZone({})).toBe(false);
    expect(isAccentZone({ parentProjectId: '' })).toBe(false);
    expect(isAccentZone(null)).toBe(false);
  });
  it('hangs every zone off the main wall id, whichever zone is open', () => {
    expect(zoneGroupId(MAIN, rows[0].config)).toBe(MAIN);
    expect(zoneGroupId(ACCENT, rows[1].config)).toBe(MAIN);
  });
  it('groups the zones of one photo, main wall first, and leaves other projects out', () => {
    const fromMain = zonesInGroup(rows, MAIN, rows[0].config);
    expect(fromMain.map(z => z.projectId)).toEqual([MAIN, ACCENT]);
    expect(fromMain[0].isAccent).toBe(false); expect(fromMain[0].zoneLabel).toBeNull();
    expect(fromMain[1].isAccent).toBe(true); expect(fromMain[1].zoneLabel).toBe('Fireplace');
    // Standing in the accent zone sees the same group, not a different one.
    expect(zonesInGroup(rows, ACCENT, rows[1].config).map(z => z.projectId)).toEqual([MAIN, ACCENT]);
    expect(fromMain.some(z => z.projectId === OTHER)).toBe(false);
  });
  it('includes a zone that has not been saved yet, so the switcher shows where you are standing', () => {
    const fresh = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const zones = zonesInGroup(rows, fresh, { wallPath, parentProjectId: MAIN, zoneLabel: 'Chimney breast' });
    expect(zones.map(z => z.projectId)).toContain(fresh);
    expect(zones.find(z => z.projectId === fresh)?.zoneLabel).toBe('Chimney breast');
  });
  it('offers only other zones that actually have artwork and four corners to draw', () => {
    const zones = zonesInGroup(rows, MAIN, rows[0].config);
    expect(otherZonesWithArtwork(zones, MAIN).map(z => z.projectId)).toEqual([ACCENT]);
    // A zone with no artwork yet cannot be composited onto the photo.
    const pending = zonesInGroup([...rows, { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Empty', config: { wallPath, parentProjectId: MAIN, zoneLabel: 'Niche', corners } }], MAIN, rows[0].config);
    expect(otherZonesWithArtwork(pending, MAIN).map(z => z.zoneLabel)).toEqual(['Fireplace']);
  });
  it('starts an accent zone on the same photo, with no artwork, no history and NO inherited masks', () => {
    const config = accentZoneConfig(rows[0].config, MAIN, ' Fireplace ');
    expect(config.wallPath).toBe(wallPath); // same photo, no re-upload
    expect(config.parentProjectId).toBe(MAIN);
    expect(config.zoneLabel).toBe('Fireplace');
    expect(config.artworkPath).toBeNull(); expect(config.currentVersionId).toBeNull(); expect(config.designId).toBeNull();
    expect(config.corners).toEqual([]); // she marks the fireplace herself
    // The main wall's detection protects the fireplace as fixed architecture.
    // Carrying that in would protect the very thing this zone exists to wrap.
    expect(config.maskPath).toBeNull(); expect(config.removeMaskPath).toBeNull(); expect(config.exclusions).toEqual([]);
  });
  it('never inherits the main wall inches, which would print the accent at a fraction of scale', () => {
    const config = accentZoneConfig({ ...rows[0].config, width: 142, height: 96 }, MAIN, 'Fireplace');
    expect(config.width).toBe(ACCENT_DEFAULT_WIDTH_IN);
    expect(config.width).not.toBe(142);
    expect(config.height).not.toBe(96);
  });
});
