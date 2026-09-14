import { describe, expect, it } from 'vitest';
import { classifyWallDomain, COMMERCIAL_SPACE_TYPES, RESIDENTIAL_SPACE_TYPES, RESIDENTIAL_STYLE_TAXONOMY } from '../../../../supabase/functions/generate-wall-design/domain';
import { wallDesignPrompt, contractDirective, wallComplianceCheckPrompt, type WallDesignContract } from '../../../../supabase/functions/generate-wall-design/prompt';
import { libraryEntryDomain, catalogRowDomain, batchDiversitySummary, selectLibraryEntries, type WallPromptEntry } from '../wallpro-catalog';
import library from '@/data/wallpro-prompt-library.json';

const LIB = library as WallPromptEntry[];

describe('WallPro commercial + residential design domain classifier', () => {
  it('reads library industry/room metadata first, and maps every B2B industry to a real commercial space type', () => {
    for (const e of LIB.filter((x) => x.segment === 'B2B')) {
      const d = classifyWallDomain({ prompt: '', libraryIndustry: e.industry, libraryRoom: e.room, libraryStyle: e.style });
      expect(d.designDomain).toBe('commercial');
      expect(COMMERCIAL_SPACE_TYPES).toContain(d.commercialSpaceType);
      expect(d.residentialSpaceType).toBeNull();
    }
  });
  it('reads B2C library rows as residential, with a real room-level space type', () => {
    for (const e of LIB.filter((x) => x.segment === 'B2C')) {
      const d = classifyWallDomain({ prompt: '', libraryIndustry: e.industry, libraryRoom: e.room, libraryStyle: e.style });
      expect(d.designDomain).toBe('residential');
      expect(RESIDENTIAL_SPACE_TYPES).toContain(d.residentialSpaceType);
      expect(d.commercialSpaceType).toBeNull();
    }
  });
  it('classifies a bare customer prompt by its own words when there is no library metadata', () => {
    expect(classifyWallDomain({ prompt: 'a mural for our new Italian restaurant' })).toMatchObject({ designDomain: 'commercial', commercialSpaceType: 'restaurant' });
    expect(classifyWallDomain({ prompt: 'something for my bedroom' })).toMatchObject({ designDomain: 'residential', residentialSpaceType: 'bedroom' });
    expect(classifyWallDomain({ prompt: 'a church worship hall backdrop' })).toMatchObject({ designDomain: 'commercial', commercialSpaceType: 'worship' });
    expect(classifyWallDomain({ prompt: 'nursery wallpaper with soft clouds' })).toMatchObject({ designDomain: 'residential', residentialSpaceType: 'nursery' });
  });
  it('defaults to commercial when nothing signals a domain — the pre-existing designer behavior is preserved', () => {
    expect(classifyWallDomain({ prompt: 'blush florals with sage leaves' })).toMatchObject({ designDomain: 'commercial', source: 'default' });
  });
  it('matches the longest, most specific residential style first', () => {
    expect(classifyWallDomain({ prompt: 'a contemporary boho bedroom mural' }).designStyle).toBe('Contemporary Boho');
    expect(classifyWallDomain({ prompt: 'a boho bedroom mural' }).designStyle).toBe('Boho');
    expect(classifyWallDomain({ prompt: 'quiet luxury dining room' }).designStyle).toBe('Quiet Luxury');
    for (const style of RESIDENTIAL_STYLE_TAXONOMY) expect(classifyWallDomain({ prompt: `a ${style} living room` }).designStyle).toBe(style);
  });
  it('an explicit override always wins, even over library metadata', () => {
    const d = classifyWallDomain({ prompt: '', libraryIndustry: 'Restaurants & Dining', libraryRoom: 'Main Dining Room', overrideDomain: 'residential', overrideResidentialSpaceType: 'dining_room' });
    expect(d).toMatchObject({ designDomain: 'residential', residentialSpaceType: 'dining_room', commercialSpaceType: null, source: 'override' });
  });
  it('a commercial classification never carries a residential style label — that vocabulary is guidance for the residential persona only (owner spec, section 4)', () => {
    // The residential style taxonomy (Boho, Japandi, Organic Modern, ...) is
    // never handed to the commercial/environmental-graphics persona, which
    // has no reason to know it. Domain classification itself never touches
    // requiredSubjects/Elements/Colors — those come only from the
    // consultant's own extraction (verified in prompt.ts's own tests).
    const d = classifyWallDomain({ prompt: 'large sage green leaves, soft neutral background, woman reclining getting a facial, organic modern spa' });
    expect(d.designDomain).toBe('commercial');
    expect(d.commercialSpaceType).toBe('spa');
    expect(d.designStyle).toBeNull();
  });
});

describe('WallPro two-domain persona selection', () => {
  const baseContract: WallDesignContract = {
    customerIntent: 'A boho bedroom mural with warm terracotta tones.',
    requiredSubjects: [], requiredElements: ['terracotta arch'], requiredColors: ['terracotta'],
    businessContext: '', designObjective: 'custom residential mural', compositionDirection: 'Centered arch motif.',
    focalHierarchy: 'The arch is dominant.', negativeSpaceZones: 'Open around the arch.', realismLevel: 'editorial realism',
    typography: null, logoTreatment: null, mustPreserve: ['terracotta arch'], forbiddenInventions: ['unrequested text'],
  };
  it('selects the residential persona when the contract carries designDomain residential', () => {
    const contract: WallDesignContract = { ...baseContract, designDomain: 'residential', residentialSpaceType: 'bedroom', designStyle: 'Boho' };
    const design = wallDesignPrompt({ prompt: '', width: 142, height: 96, placement: 'cover', contract });
    expect(design).toMatch(/Senior Residential Interior Designer and Wallcovering Designer/);
    expect(design).not.toMatch(/Senior Environmental Graphic Designer/);
    expect(design.length).toBeLessThan(4000);
  });
  it('keeps the commercial persona — byte for byte the pre-existing text — when domain is commercial or unresolved', () => {
    const contract: WallDesignContract = { ...baseContract, designDomain: 'commercial', commercialSpaceType: 'restaurant' };
    const design = wallDesignPrompt({ prompt: '', width: 142, height: 96, placement: 'cover', contract });
    expect(design).toMatch(/Senior Environmental Graphic Designer and Large-Format Wrap Designer/);
    expect(wallDesignPrompt({ prompt: 'A mountain mural', width: 142, height: 96, placement: 'cover' })).toMatch(/Senior Environmental Graphic Designer and Large-Format Wrap Designer/);
  });
  it('classifies fresh from library hints even with no contract at all (e.g. the batch generator on a library job)', () => {
    const design = wallDesignPrompt({ prompt: 'Warm terracotta arch', width: 96, height: 96, placement: 'repeat', repeatWidthIn: 48, libraryIndustry: 'Homeowner Residential', libraryRoom: 'Primary Bedroom', libraryStyle: 'Boho' });
    expect(design).toMatch(/Senior Residential Interior Designer/);
  });
  it('adds space-type and style guidance lines to the contract directive without displacing the required facts', () => {
    const contract: WallDesignContract = { ...baseContract, designDomain: 'residential', residentialSpaceType: 'bedroom', designStyle: 'Boho' };
    const directive = contractDirective({ ...contract, designDomain: 'residential', commercialSpaceType: null, residentialSpaceType: 'bedroom', designStyle: 'Boho' });
    expect(directive).toMatch(/Room: bedroom/);
    expect(directive).toMatch(/Style guidance \(informs composition, material treatment and palette — never replaces the required subjects\/elements\/colors above\): Boho/);
    expect(directive).toMatch(/REQUIRED ELEMENTS/);
    expect(directive).toMatch(/terracotta arch/);
  });
  it('the advisory compliance-check prompt asks domain-appropriate quality-floor questions and checks AI-slop flags', () => {
    const commercial = wallComplianceCheckPrompt({ ...baseContract, designDomain: 'commercial', commercialSpaceType: 'restaurant', residentialSpaceType: null, designStyle: null });
    expect(commercial).toMatch(/sign\/environmental graphics company/);
    expect(commercial).toMatch(/professionalQualityFloor/);
    expect(commercial).toMatch(/aiSlopFlags/);
    const residential = wallComplianceCheckPrompt({ ...baseContract, designDomain: 'residential', commercialSpaceType: null, residentialSpaceType: 'bedroom', designStyle: 'Boho' });
    expect(residential).toMatch(/boutique wallpaper\/interior studio/);
    // The hard material-fact check is unchanged and stays separate from the
    // advisory quality floor (owner spec, section 6: "Material contract
    // violations remain HARD FAIL. Subjective taste remains advisory...").
    expect(residential).toMatch(/"compliant" is a HARD fact check/);
    expect(residential).toMatch(/ADVISORY, separate from "compliant"/);
  });
});

describe('WallPro batch library domain/diversity helpers', () => {
  it('derives a real domain/space type for every published-catalog-row shape via catalogRowDomain', () => {
    const commercial = catalogRowDomain({ industry: 'Restaurants & Dining', room: 'Main Dining Room', style: 'Modern Organic', segment: 'B2B' });
    expect(commercial).toMatchObject({ designDomain: 'commercial', commercialSpaceType: 'restaurant' });
    const residential = catalogRowDomain({ industry: 'Homeowner Residential', room: 'Primary Bedroom', style: 'Japandi', segment: 'B2C' });
    expect(residential).toMatchObject({ designDomain: 'residential', residentialSpaceType: 'bedroom' });
  });
  it('filters library entries by domain', () => {
    const commercialOnly = selectLibraryEntries(LIB, { domain: 'commercial' }, new Set());
    expect(commercialOnly.every((e) => libraryEntryDomain(e).designDomain === 'commercial')).toBe(true);
    const residentialOnly = selectLibraryEntries(LIB, { domain: 'residential' }, new Set());
    expect(residentialOnly.every((e) => libraryEntryDomain(e).designDomain === 'residential')).toBe(true);
    expect(commercialOnly.length + residentialOnly.length).toBe(LIB.length);
  });
  it('reports batch diversity signals across domain, style and palette family', () => {
    const sample = LIB.slice(0, 20);
    const d = batchDiversitySummary(sample);
    expect(d.count).toBe(20);
    expect(Object.values(d.domains).reduce((a, b) => a + b, 0)).toBe(20);
    expect(Object.values(d.styles).reduce((a, b) => a + b, 0)).toBe(20);
    // A batch converged on one style should be visibly reported as such.
    const converged = batchDiversitySummary(sample.map((e) => ({ ...e, style: 'Quiet Luxury' })));
    expect(converged.styles).toEqual({ 'Quiet Luxury': 20 });
  });
});
