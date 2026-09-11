import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WALL_GENERATION_MODEL, batchDimensions, planWallBatch, catalogMasterPath, designUpsertRow, provenanceManifest, catalogEffectivePpi, DEFAULT_TILE_WIDTH_IN, engineForDesignType, selectLibraryEntries, type WallPromptEntry } from '../wallpro-catalog';
import library from '@/data/wallpro-prompt-library.json';
import type { SeamlessReceipt } from '../wallpro-seamless';

const LIB = library as WallPromptEntry[];
const gen = '22222222-2222-4222-8222-222222222222';
const owner = '11111111-1111-4111-8111-111111111111';
const hash = 'a'.repeat(64);
const verified: SeamlessReceipt = { contract: 'wallpro.seamless.v1', preference: 'auto', method: 'verified', before: { width: 4096, height: 4096, edge: 1, interior: 1, ratio: 1, seamless: true }, after: null, verified: true };
const unverified: SeamlessReceipt = { ...verified, method: 'blend', before: { ...verified.before, ratio: 12, seamless: false }, after: { ...verified.before, ratio: 6, seamless: false }, verified: false };
const pattern = LIB.find(e => e.designType === 'Seamless Repeat Pattern')!;
const mural = LIB.find(e => e.designType === 'Panoramic Mural')!;
const base = { generationId: gen, promptHash: hash, masterPath: 'catalog/33333333-3333-4333-8333-333333333333.png', masterSha256: hash, widthPx: 4096, heightPx: 4096, createdBy: owner };

describe('WallPro catalog contract', () => {
  it('pins the catalog model to the model the wall Edge handler actually calls', () => {
    const handler = readFileSync(new URL('../../../../supabase/functions/generate-wall-design/handler.ts', import.meta.url), 'utf8');
    expect(handler).toContain(`const MODEL = '${WALL_GENERATION_MODEL}';`);
  });
  it('ships the 500-prompt industry library with permanent DesignIDs and taxonomy beside the prompt', () => {
    expect(LIB.length).toBe(500);
    expect(new Set(LIB.map(e => e.id)).size).toBe(500);
    expect(LIB.every(e => /^WPB-\d{4}$/.test(e.id) && e.prompt.length > 200 && e.prompt.length <= 6000 && e.tags.length > 0)).toBe(true);
    expect(new Set(LIB.map(e => e.segment))).toEqual(new Set(['B2B', 'B2C']));
    expect(new Set(LIB.map(e => e.industry)).size).toBe(30);
    expect(new Set(LIB.map(e => e.intensity))).toEqual(new Set(['Quiet', 'Balanced', 'Statement']));
    // Every prompt carries the production contract in its own words: murals the
    // canonical-master rule, patterns and surfaces the seamless-tile rule.
    expect(LIB.every(e => /Never AI-regenerate/i.test(e.prompt))).toBe(true);
    expect(LIB.filter(e => engineForDesignType(e.designType) === 'mural').every(e => /canonical master|continuous when deterministically panelized/i.test(e.prompt))).toBe(true);
    expect(LIB.filter(e => engineForDesignType(e.designType) === 'repeat').every(e => /seamless/i.test(e.prompt))).toBe(true);
    expect(LIB.filter(e => e.designType === 'Architectural Surface').every(e => /flat photorealistic architectural surface texture/i.test(e.prompt))).toBe(true);
  });
  it('routes seamless patterns to the repeat engine and every other type, surfaces included, to one continuous master', () => {
    expect(engineForDesignType('Seamless Repeat Pattern')).toBe('repeat');
    for (const t of ['Architectural Surface', 'Panoramic Mural', 'Feature Wall Art', 'Graphic Geometry', 'Illustrative Mural', 'Painterly Mural', 'Photographic Fine Art']) expect(engineForDesignType(t)).toBe('mural');
    expect(new Set(LIB.map(e => e.designType)).size).toBe(8);
  });
  it('asks for a square tile for repeats and a 3:2 accent wall for murals, and cycles style examples across the queue', () => {
    expect(batchDimensions('repeat')).toEqual({ width: 96, height: 96, placement: 'repeat' });
    expect(batchDimensions('mural')).toEqual({ width: 144, height: 96, placement: 'cover' });
    const jobs = planWallBatch(LIB.slice(0, 5), 2);
    expect(jobs.map(j => j.referenceIndex)).toEqual([0, 1, 0, 1, 0]);
    expect(jobs.map(j => j.entry.id)).toEqual(['WPB-0001', 'WPB-0002', 'WPB-0003', 'WPB-0004', 'WPB-0005']);
    expect(planWallBatch([pattern], 0)[0]).toMatchObject({ mode: 'repeat', referenceIndex: null });
    expect(() => planWallBatch([], -1)).toThrow();
  });
  it('selects library entries by taxonomy and skips already-published DesignIDs unless told otherwise', () => {
    const gym = selectLibraryEntries(LIB, { industry: 'Gyms & Performance Fitness' }, new Set());
    expect(gym.length).toBeGreaterThan(10); expect(gym.every(e => e.industry === 'Gyms & Performance Fitness')).toBe(true);
    const published = new Set([gym[0].id, gym[1].id]);
    expect(selectLibraryEntries(LIB, { industry: 'Gyms & Performance Fitness' }, published).length).toBe(gym.length - 2);
    expect(selectLibraryEntries(LIB, { industry: 'Gyms & Performance Fitness' }, published, true).length).toBe(gym.length);
    expect(selectLibraryEntries(LIB, { segment: 'B2C', designType: 'Seamless Repeat Pattern', intensity: 'Quiet' }, new Set()).every(e => e.segment === 'B2C' && e.designType === 'Seamless Repeat Pattern' && e.intensity === 'Quiet')).toBe(true);
  });
  it('places catalog masters under catalog/ by file id and refuses other types', () => {
    expect(catalogMasterPath('33333333-3333-4333-8333-333333333333', 'image/png')).toBe('catalog/33333333-3333-4333-8333-333333333333.png');
    expect(() => catalogMasterPath('not-a-uuid', 'image/png')).toThrow();
    expect(() => catalogMasterPath('33333333-3333-4333-8333-333333333333', 'image/gif')).toThrow();
  });
  it('publishes a repeat only with a verified seam, keeps the library DesignID, and versions a republish', () => {
    const row = designUpsertRow({ ...base, entry: pattern, mode: 'repeat', seam: verified });
    expect(row).toMatchObject({ design_id: pattern.id, segment: pattern.segment, industry: pattern.industry, design_type: 'Seamless Repeat Pattern', model: WALL_GENERATION_MODEL, provider: 'google', synthid_expected: true, tile_width_in: DEFAULT_TILE_WIDTH_IN, approval_status: 'approved', master_version: 1 });
    expect(designUpsertRow({ ...base, entry: pattern, mode: 'repeat', seam: verified, previousVersion: 2 }).master_version).toBe(3);
    expect(() => designUpsertRow({ ...base, entry: pattern, mode: 'repeat', seam: unverified })).toThrow('verified seam');
    expect(() => designUpsertRow({ ...base, entry: pattern, mode: 'repeat', seam: null })).toThrow('verified seam');
    expect(() => designUpsertRow({ ...base, entry: pattern, mode: 'mural', seam: null })).toThrow('must be published as repeat');
    expect(designUpsertRow({ ...base, entry: mural, mode: 'mural', seam: null }).seam).toBeNull();
    expect(() => designUpsertRow({ ...base, entry: mural, mode: 'mural', seam: null, generationId: 'x' })).toThrow('generation record');
    expect(() => designUpsertRow({ ...base, entry: mural, mode: 'mural', seam: null, masterSha256: 'short' })).toThrow('provenance');
    expect(() => designUpsertRow({ ...base, entry: mural, mode: 'mural', seam: null, masterPath: owner + '/generated/a.png' })).toThrow('copied into the catalog');
    expect(() => designUpsertRow({ ...base, entry: { ...mural, id: 'bad' }, mode: 'mural', seam: null })).toThrow('DesignID');
    expect(() => designUpsertRow({ ...base, entry: mural, mode: 'mural', seam: null, rating: 7 })).toThrow('Rating');
    expect(() => designUpsertRow({ ...base, entry: pattern, mode: 'repeat', seam: verified, tileWidthIn: 0 })).toThrow('Tile width');
  });
  it('emits a provenance passport keyed by DesignID and GenerationID, and reports print resolution honestly', () => {
    const row = { ...designUpsertRow({ ...base, entry: pattern, mode: 'repeat', seam: verified, collectionId: 'SPA-MODERN-ORGANIC' }), id: 'row', created_at: 'now', sort_order: 0 } as any;
    const passport = provenanceManifest(row);
    expect(passport).toMatchObject({ contract: 'wallpro.provenance.v1', design_id: pattern.id, generation_id: gen, master_sha256: hash, synthid_expected: true, collection_id: 'SPA-MODERN-ORGANIC', industry: pattern.industry });
    expect(catalogEffectivePpi(row)).toBeCloseTo(4096 / 24, 3);
    expect(catalogEffectivePpi({ mode: 'mural', tile_width_in: null, width_px: 4096, height_px: 2731 })).toBeCloseTo(28.44, 1);
  });
});
