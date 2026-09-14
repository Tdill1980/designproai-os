import { describe, expect, it } from 'vitest';
import { sceneUpsertRow, sceneLayoutFor, mockupCaption, DEFAULT_SCENE_WALL_IN, FULL_FRAME_CORNERS } from '../wallpro-scenes';
import { layoutMetrics } from '../wallpro-geometry';

const owner = '11111111-1111-4111-8111-111111111111';
const corners = [{ x: 0.28, y: 0.05 }, { x: 0.99, y: 0.05 }, { x: 0.99, y: 0.75 }, { x: 0.28, y: 0.75 }];
const draft = { name: 'Beige living room', room: 'living_room', imagePath: 'catalog/33333333-3333-4333-8333-333333333333.jpg', widthPx: 2000, heightPx: 1200, corners, wallWidthIn: 168, wallHeightIn: 108, createdBy: owner };

describe('WallPro room scenes and true-scale mockups', () => {
  it('builds a scene row and refuses what the table would refuse, in words', () => {
    expect(sceneUpsertRow(draft)).toMatchObject({ name: 'Beige living room', room: 'living_room', wall_width_in: 168, wall_height_in: 108, is_active: true, created_by: owner });
    expect(sceneUpsertRow(draft).corners).toHaveLength(4);
    expect(() => sceneUpsertRow({ ...draft, corners: corners.slice(0, 3) })).toThrow('four wall corners');
    expect(() => sceneUpsertRow({ ...draft, corners: FULL_FRAME_CORNERS.map(p => ({ ...p })) })).not.toThrow();
    expect(() => sceneUpsertRow({ ...draft, imagePath: owner + '/uploads/33333333-3333-4333-8333-333333333333.jpg' })).toThrow('copied into the catalog');
    expect(() => sceneUpsertRow({ ...draft, wallWidthIn: 6 })).toThrow('inches');
    expect(() => sceneUpsertRow({ ...draft, name: '' })).toThrow('name');
  });
  it('imposes a repeat at its own tile width on the real wall, and a mural over the whole wall', () => {
    const scene = { wall_width_in: 168, wall_height_in: 108 };
    const tile = sceneLayoutFor({ mode: 'repeat', tile_width_in: 48 }, scene, 24);
    expect(tile).toEqual({ width: 168, height: 108, mode: 'repeat', repeatWidth: 48, mirror: false });
    // On a 14-foot wall the tile stays exactly 48 inches — that is the whole point of the mockup.
    expect(layoutMetrics(tile, 1)).toMatchObject({ artworkWidth: 48, artworkHeight: 48 });
    expect(sceneLayoutFor({ mode: 'repeat', tile_width_in: null }, scene, 24).repeatWidth).toBe(24);
    // The mockup tiles a mirror-published repeat mirrored, exactly as the print does.
    expect(sceneLayoutFor({ mode: 'repeat', tile_width_in: 48, seam: { method: 'mirror' } }, scene, 24).mirror).toBe(true);
    expect(sceneLayoutFor({ mode: 'repeat', tile_width_in: 48, seam: { method: 'verified' } }, scene, 24).mirror).toBe(false);
    expect(sceneLayoutFor({ mode: 'mural', tile_width_in: null, seam: null }, scene, 24).mirror).toBe(false);
    expect(sceneLayoutFor({ mode: 'mural', tile_width_in: null }, scene, 24)).toMatchObject({ mode: 'cover', width: 168, height: 108 });
  });
  it('captions the mockup with the real repeat size and the real wall size', () => {
    const scene = { wall_width_in: 168, wall_height_in: 108 };
    expect(mockupCaption({ mode: 'repeat', tile_width_in: 48 }, scene, 24)).toBe('48-inch repeat, shown at true size on a 14 ft × 9 ft wall');
    expect(mockupCaption({ mode: 'mural', tile_width_in: null }, { wall_width_in: 150, wall_height_in: 96 }, 24)).toBe('One mural sized to a 12 ft 6 in × 8 ft wall');
    expect(DEFAULT_SCENE_WALL_IN).toEqual({ width: 168, height: 108 });
  });
});
