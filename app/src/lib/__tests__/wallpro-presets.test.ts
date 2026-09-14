import { describe, expect, it } from 'vitest';
import { WALL_PRESETS, WALL_CATEGORIES, WALL_CATEGORY_LABELS, RESIDENTIAL_CATEGORIES, presetAsEntry, presetDomain, getRandomWallPresets, generatedBriefAsEntry } from '@/data/wallpro-presets';
import { briefForEntry, batchCreativeBrief, designUpsertRow, libraryEntryDomain, engineForDesignType, planWallBatch, selectLibraryEntries, type WallPromptEntry } from '../wallpro-catalog';
import { seamlessReceipt } from '../wallpro-seamless';
import { wallDesignPrompt } from '../../../../supabase/functions/generate-wall-design/prompt';
import library from '@/data/wallpro-prompt-library.json';

const LIB = library as WallPromptEntry[];
const DESIGN_ID = /^WPB-[0-9A-Z][0-9A-Z-]{3,19}$/;
// The spec-sheet shape the legacy library is written in, and the production
// boilerplate that followed it; neither may reach the consultant from a preset.
const SPEC_SHEET = /Concept:|Visual language:|Visual intensity:|canonical master|panelized|150 effective PPI|54-inch media|1-inch duplicated overlap/i;

describe('WallPro brief presets — the RestylePro batch pattern (owner, 2026-09-14: "natural language prompts required")', () => {
  it('carries the 111 RestylePro wall presets plus the residential Etsy families, every id catalog-legal and unique', () => {
    expect(WALL_PRESETS.length).toBeGreaterThanOrEqual(111 + 30);
    const ids = new Set(WALL_PRESETS.map(p => p.id));
    expect(ids.size).toBe(WALL_PRESETS.length);
    for (const p of WALL_PRESETS) {
      expect(p.id).toMatch(DESIGN_ID);
      expect(WALL_CATEGORIES).toContain(p.category);
      expect(['repeat', 'mural']).toContain(p.mode);
    }
    // The RestylePro originals are here verbatim (spot checks on both ends of that file).
    expect(WALL_PRESETS.find(p => p.id === 'WPB-OFF-01')?.prompt).toBe('Abstract fluid art mural — sweeping arcs of navy, silver, and white ink flowing across the entire wall, subtle metallic shimmer in the curves, negative space breathing room, sophisticated corporate energy');
    expect(WALL_PRESETS.find(p => p.id === 'WPB-DES-10')?.prompt).toMatch(/^Corten weathering steel feature wall/);
  });
  it('every preset is a customer-voice brief, never a spec sheet, and states its colours', () => {
    for (const p of WALL_PRESETS) {
      expect(p.prompt.length, p.id).toBeGreaterThanOrEqual(60);
      expect(p.prompt.length, p.id).toBeLessThanOrEqual(900);
      expect(p.prompt, p.id).not.toMatch(SPEC_SHEET);
      // "comic panel wall" is a subject; print panels, bleed and overlap are pipeline words.
      expect(p.prompt, p.id).not.toMatch(/\b(4k|ppi|bleed|overlap|panelis\w*|print panels?)\b/i);
    }
  });
  it('the residential Etsy presets name the three rendering families the owner supplied and a motif size in inches for repeats', () => {
    const etsy = WALL_PRESETS.filter(p => ['bedroom', 'nursery', 'dining', 'powder', 'entry', 'kitchen', 'homeoffice'].includes(p.category) || p.id.startsWith('WPB-LIV-1'));
    expect(etsy.length).toBeGreaterThanOrEqual(30);
    const families = new Set(etsy.map(p => p.rendering));
    expect(families).toContain('flat-bold'); expect(families).toContain('fine-line'); expect(families).toContain('faux-material');
    for (const p of etsy) {
      expect(presetDomain(p.category)).toBe('residential');
      if (p.mode === 'repeat') expect(p.prompt, p.id).toMatch(/\b(inch|inches)\b/);
      if (p.rendering === 'flat-bold') expect(p.prompt, p.id).toMatch(/flat|block print|linocut|screen-print|cut-paper|hand-painted|woodblock|silhouette/i);
      if (p.rendering === 'fine-line') expect(p.prompt, p.id).toMatch(/line|engrav|hatched|toile/i);
      if (p.rendering === 'faux-material') expect(p.prompt, p.id).toMatch(/photoreal/i);
    }
  });
  it('maps a preset to the batch entry shape: domain from its category, mode from its type, and the natural-brief contract', () => {
    const bed = presetAsEntry(WALL_PRESETS.find(p => p.id === 'WPB-BED-03')!);
    expect(bed).toMatchObject({ id: 'WPB-BED-03', segment: 'B2C', industry: 'Bedroom', room: 'Bedroom', designType: 'Seamless Repeat Pattern', brief: 'natural', domain: 'residential', rendering: 'fine-line' });
    expect(libraryEntryDomain(bed).designDomain).toBe('residential');
    const lobby = presetAsEntry(WALL_PRESETS.find(p => p.id === 'WPB-LOB-05')!);
    expect(lobby).toMatchObject({ segment: 'B2B', industry: WALL_CATEGORY_LABELS.lobby, designType: 'Seamless Repeat Pattern', domain: 'commercial' });
    expect(libraryEntryDomain(lobby).designDomain).toBe('commercial');
    const marble = presetAsEntry(WALL_PRESETS.find(p => p.id === 'WPB-ENT-03')!);
    expect(marble.designType).toBe('Architectural Surface');
    expect(engineForDesignType(marble.designType)).toBe('mural');
    for (const c of WALL_CATEGORIES) expect(presetDomain(c)).toBe(RESIDENTIAL_CATEGORIES.includes(c) ? 'residential' : 'commercial');
    // The plan and the filters take presets exactly as they take library rows.
    const entries = WALL_PRESETS.map(presetAsEntry);
    expect(planWallBatch(entries.slice(0, 3), 0).map(j => j.mode)).toEqual(entries.slice(0, 3).map(e => engineForDesignType(e.designType)));
    expect(selectLibraryEntries(entries, { domain: 'residential' }, new Set()).every(e => e.domain === 'residential')).toBe(true);
    expect(selectLibraryEntries(entries, { domain: 'commercial' }, new Set(['WPB-OFF-01'])).some(e => e.id === 'WPB-OFF-01')).toBe(false);
  });
  it('sends a natural brief to the consultant VERBATIM and still rewrites a legacy spec-sheet row', () => {
    const preset = presetAsEntry(WALL_PRESETS.find(p => p.id === 'WPB-DIN-01')!);
    expect(briefForEntry(preset)).toBe(preset.prompt);
    const legacy = LIB[0];
    expect(legacy.brief).toBeUndefined();
    expect(briefForEntry(legacy)).toBe(batchCreativeBrief(legacy));
    expect(briefForEntry(legacy)).not.toMatch(SPEC_SHEET);
  });
  it('every preset assembles under the 4K persona lock through the real prompt builder', () => {
    for (const p of WALL_PRESETS) {
      const e = presetAsEntry(p);
      const mode = engineForDesignType(e.designType);
      const text = wallDesignPrompt({ prompt: briefForEntry(e), width: mode === 'repeat' ? 96 : 144, height: 96, placement: mode === 'repeat' ? 'repeat' : 'cover', repeatWidthIn: mode === 'repeat' ? 48 : undefined, libraryIndustry: e.industry, libraryRoom: e.room, libraryStyle: e.style, designDomain: e.domain });
      expect(text.length, p.id).toBeLessThan(4000);
      expect(text, p.id).toContain(p.prompt);
    }
  });
  it('a preset publishes through the same row builder as a library row, as a repeat or a mural', () => {
    const base = { generationId: '22222222-2222-4222-8222-222222222222', promptHash: 'a'.repeat(64), masterPath: 'catalog/33333333-3333-4333-8333-333333333333.png', masterSha256: 'a'.repeat(64), widthPx: 4096, heightPx: 4096, createdBy: '11111111-1111-4111-8111-111111111111' };
    const clean = { width: 64, height: 64, edge: 1, interior: 1, ratio: 1, seamless: true };
    for (const p of WALL_PRESETS) {
      const entry = presetAsEntry(p);
      const row = designUpsertRow({ ...base, entry, mode: p.mode, tileWidthIn: 48, seam: p.mode === 'repeat' ? seamlessReceipt('auto', clean, null, 'verified') : null });
      expect(row.design_id).toBe(p.id);
      expect(row.prompt).toBe(p.prompt);
      expect(row.mode).toBe(p.mode);
    }
  });
  it('getRandomWallPresets scopes to a category, as RestylePro did', () => {
    const picks = getRandomWallPresets(5, 'nursery');
    expect(picks).toHaveLength(5);
    expect(picks.every(p => p.category === 'nursery')).toBe(true);
    expect(getRandomWallPresets(3).length).toBe(3);
  });
  it('an AI-written brief becomes the same entry shape with the natural contract', () => {
    const e = generatedBriefAsEntry({ id: 'WPB-AI-ABC123-01', name: 'Quiet Fern', subcategory: 'nursery', prompt: 'Fern fronds in one sage ink on cream, tossed half-drop, fronds about eight inches, calm nursery', tags: ['fern', 'sage'], mode: 'repeat', rendering: 'fine-line', domain: 'residential' });
    expect(e).toMatchObject({ id: 'WPB-AI-ABC123-01', segment: 'B2C', room: 'nursery', designType: 'Seamless Repeat Pattern', brief: 'natural', domain: 'residential' });
    expect(briefForEntry(e)).toBe(e.prompt);
    expect(e.id).toMatch(DESIGN_ID);
  });
});
